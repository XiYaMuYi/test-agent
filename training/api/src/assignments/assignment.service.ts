import crypto from 'node:crypto';

import type { OnModuleDestroy } from '@nestjs/common';
import { HttpStatus } from '@nestjs/common';
import type { Pool } from 'pg';

import { validateAgentConfigOverrideV1 } from '@training/contracts';
import { assertOrganizationScope } from '../identity/organization-context.js';
import type { CurrentPrincipal } from '../identity/identity-context.js';
import { AssignmentProblem, deriveLearnerId } from './eligibility.service.js';

export interface AssignmentConversationOverride {
  readonly maxTurns?: number;
  readonly openingMode?: 'ai_first' | 'wait_learner';
  readonly background?: string;
}

/** 任务级参数覆盖 patch（spec §6.4 扩展）：缺省字段表示不覆盖，保留快照原值。 */
export interface AssignmentOverridePatchV1 {
  readonly agentConfig?: Readonly<Record<string, unknown>>;
  readonly conversation?: AssignmentConversationOverride;
}

export interface CreateAssignmentInput {
  readonly id?: string;
  readonly releaseSnapshotId: string;
  readonly name: string;
  readonly status: 'draft' | 'active' | 'paused' | 'ended';
  readonly startsAt: string;
  readonly endsAt: string;
  readonly maxAttempts: number;
  readonly targetPrincipalIds: readonly string[];
  readonly overridePatch?: AssignmentOverridePatchV1 | null;
  /** 选定的评分模板 ID；缺省/null=使用组织默认评分模板。 */
  readonly scoringTemplateId?: string | null;
}

/** 任务覆盖的对话关键参数常量（对齐 persona.service validatePersonaConfig）。 */
const OVERRIDE_MAX_TURNS_MIN = 1;
const OVERRIDE_MAX_TURNS_MAX = 100;
const OVERRIDE_MAX_BACKGROUND = 500;
const OVERRIDE_OPENING_MODES: readonly string[] = ['ai_first', 'wait_learner'];
const OVERRIDE_AGENT_CONFIG_KEYS: readonly string[] = [
  'schemaVersion', 'historyMessageLimit', 'responseLength', 'knowledgeStrictness',
  'conversationPace', 'closingTendency', 'additionalInstructions',
];
const OVERRIDE_CONVERSATION_KEYS: readonly string[] = ['maxTurns', 'openingMode', 'background'];

/**
 * 校验并归一任务级覆盖 patch。返回 null 表示无覆盖。
 * 非法覆盖抛 SCHEMA_INVALID（400）：未知键拒绝、枚举/范围/长度按契约校验。
 */
export function normalizeOverridePatchV1(raw: unknown): AssignmentOverridePatchV1 | null {
  if (raw === undefined || raw === null) return null;
  if (typeof raw !== 'object' || Array.isArray(raw)) {
    throw new AssignmentProblem('SCHEMA_INVALID', HttpStatus.BAD_REQUEST, 'overridePatch must be an object.');
  }
  const patch = raw as Record<string, unknown>;
  const agentConfig = patch.agentConfig;
  const conversation = patch.conversation;

  if (agentConfig !== undefined) {
    if (typeof agentConfig !== 'object' || agentConfig === null || Array.isArray(agentConfig)) {
      throw new AssignmentProblem('SCHEMA_INVALID', HttpStatus.BAD_REQUEST, 'overridePatch.agentConfig must be an object.');
    }
    if (Object.keys(agentConfig as Record<string, unknown>).length === 0) {
      throw new AssignmentProblem('SCHEMA_INVALID', HttpStatus.BAD_REQUEST, 'overridePatch.agentConfig must set at least one field.');
    }
    const validation = validateAgentConfigOverrideV1(agentConfig);
    if (!validation.valid) {
      const detail = validation.issues.map((issue) => `${issue.path}: ${issue.reason}`).join('; ');
      throw new AssignmentProblem('SCHEMA_INVALID', HttpStatus.BAD_REQUEST, `overridePatch.agentConfig is invalid: ${detail}`);
    }
  }

  let normalizedConversation: AssignmentConversationOverride | undefined;
  if (conversation !== undefined) {
    if (typeof conversation !== 'object' || conversation === null || Array.isArray(conversation)) {
      throw new AssignmentProblem('SCHEMA_INVALID', HttpStatus.BAD_REQUEST, 'overridePatch.conversation must be an object.');
    }
    const conv = conversation as Record<string, unknown>;
    for (const key of Object.keys(conv)) {
      if (!OVERRIDE_CONVERSATION_KEYS.includes(key)) {
        throw new AssignmentProblem('SCHEMA_INVALID', HttpStatus.BAD_REQUEST, `overridePatch.conversation has unknown field '${key}'.`);
      }
    }
    if (Object.keys(conv).length === 0) {
      throw new AssignmentProblem('SCHEMA_INVALID', HttpStatus.BAD_REQUEST, 'overridePatch.conversation must set at least one field.');
    }
    if (conv.maxTurns !== undefined
      && (typeof conv.maxTurns !== 'number' || !Number.isInteger(conv.maxTurns)
        || conv.maxTurns < OVERRIDE_MAX_TURNS_MIN || conv.maxTurns > OVERRIDE_MAX_TURNS_MAX)) {
      throw new AssignmentProblem('SCHEMA_INVALID', HttpStatus.BAD_REQUEST, `overridePatch.conversation.maxTurns must be an integer in [${OVERRIDE_MAX_TURNS_MIN}, ${OVERRIDE_MAX_TURNS_MAX}].`);
    }
    if (conv.openingMode !== undefined && !OVERRIDE_OPENING_MODES.includes(conv.openingMode as string)) {
      throw new AssignmentProblem('SCHEMA_INVALID', HttpStatus.BAD_REQUEST, 'overridePatch.conversation.openingMode must be ai_first|wait_learner.');
    }
    if (conv.background !== undefined) {
      if (typeof conv.background !== 'string') {
        throw new AssignmentProblem('SCHEMA_INVALID', HttpStatus.BAD_REQUEST, 'overridePatch.conversation.background must be a string.');
      }
      if (conv.background.length > OVERRIDE_MAX_BACKGROUND) {
        throw new AssignmentProblem('SCHEMA_INVALID', HttpStatus.BAD_REQUEST, `overridePatch.conversation.background must be at most ${OVERRIDE_MAX_BACKGROUND} characters.`);
      }
      if (/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(conv.background)) {
        throw new AssignmentProblem('SCHEMA_INVALID', HttpStatus.BAD_REQUEST, 'overridePatch.conversation.background must not contain control characters.');
      }
    }
    normalizedConversation = {
      ...(conv.maxTurns !== undefined ? { maxTurns: conv.maxTurns as number } : {}),
      ...(conv.openingMode !== undefined ? { openingMode: conv.openingMode as 'ai_first' | 'wait_learner' } : {}),
      ...(conv.background !== undefined ? { background: conv.background as string } : {}),
    };
  }

  if (agentConfig === undefined && normalizedConversation === undefined) {
    throw new AssignmentProblem('SCHEMA_INVALID', HttpStatus.BAD_REQUEST, 'overridePatch must set at least one field.');
  }

  return {
    ...(agentConfig !== undefined ? { agentConfig: agentConfig as Readonly<Record<string, unknown>> } : {}),
    ...(normalizedConversation !== undefined ? { conversation: normalizedConversation } : {}),
  };
}

/** 序列化 overridePatch：agentConfig 只保留契约允许的键（防 DB 里混入未知键）。 */
export function serializeOverridePatch(patch: AssignmentOverridePatchV1 | null | undefined): string | null {
  if (patch === undefined || patch === null) return null;
  const agentConfig = patch.agentConfig === undefined
    ? undefined
    : Object.fromEntries(Object.entries(patch.agentConfig).filter(([key]) => OVERRIDE_AGENT_CONFIG_KEYS.includes(key)));
  const serialized: Record<string, unknown> = {};
  if (agentConfig !== undefined) serialized.agentConfig = agentConfig;
  if (patch.conversation !== undefined) serialized.conversation = patch.conversation;
  return JSON.stringify(serialized);
}

export function parseOverridePatch(raw: unknown): AssignmentOverridePatchV1 | null {
  if (typeof raw !== 'object' || raw === null) return null;
  const patch = raw as Record<string, unknown>;
  const agentConfig = patch.agentConfig !== undefined && typeof patch.agentConfig === 'object' && patch.agentConfig !== null
    ? (patch.agentConfig as Readonly<Record<string, unknown>>)
    : undefined;
  let conversation: AssignmentConversationOverride | undefined;
  if (patch.conversation !== undefined && typeof patch.conversation === 'object' && patch.conversation !== null) {
    const conv = patch.conversation as Record<string, unknown>;
    conversation = {
      ...(typeof conv.maxTurns === 'number' ? { maxTurns: conv.maxTurns } : {}),
      ...(conv.openingMode === 'ai_first' || conv.openingMode === 'wait_learner' ? { openingMode: conv.openingMode } : {}),
      ...(typeof conv.background === 'string' ? { background: conv.background } : {}),
    };
    if (Object.keys(conversation).length === 0) conversation = undefined;
  }
  return agentConfig !== undefined || conversation !== undefined
    ? { ...(agentConfig !== undefined ? { agentConfig } : {}), ...(conversation !== undefined ? { conversation } : {}) }
    : null;
}

/**
 * 合并两个覆盖 patch（部分更新语义）：缺省字段保留原覆盖值；
 * incoming=null 表示清空（返回 null）。合并结果不在此处重新校验——
 * 双方都来自已校验的持久化值/入参，逐字段拼接不会产生新非法值。
 */
function mergeOverridePatches(current: AssignmentOverridePatchV1 | null, incoming: AssignmentOverridePatchV1 | null): AssignmentOverridePatchV1 | null {
  if (incoming === null) return null;
  if (current === null) return incoming;
  const agentConfig = incoming.agentConfig !== undefined
    ? { ...(current.agentConfig ?? {}), ...incoming.agentConfig }
    : current.agentConfig;
  const conversation = incoming.conversation !== undefined
    ? { ...(current.conversation ?? {}), ...incoming.conversation }
    : current.conversation;
  if (agentConfig === undefined && conversation === undefined) return null;
  return {
    ...(agentConfig !== undefined ? { agentConfig } : {}),
    ...(conversation !== undefined ? { conversation } : {}),
  };
}

export type AssignmentStatus = 'draft' | 'active' | 'paused' | 'ended';
export type AssignmentStatusFilter = AssignmentStatus | 'all';

/** 运营列表行：业务化场景名 + 学员进度聚合，不含投放名单明细。 */
export interface AssignmentSummary {
  readonly id: string;
  readonly name: string;
  readonly status: AssignmentStatus;
  readonly scenarioTitle: string | null;
  readonly releaseSnapshotId: string;
  readonly startsAt: string;
  readonly endsAt: string;
  readonly maxAttempts: number;
  readonly targetCount: number;
  readonly assignedCount: number;
  readonly completedCount: number;
  readonly inProgressCount: number;
  readonly createdAt: string;
  /** 任务级参数覆盖（快照之外的叠加配置）；null=无覆盖。 */
  readonly overridePatch: AssignmentOverridePatchV1 | null;
  /** 任务选定的评分模板 ID；null=使用组织默认评分模板。 */
  readonly scoringTemplateId: string | null;
}

export interface AssignmentLearnerView {
  readonly learnerId: string;
  readonly state: string;
  readonly totalAttempts: number;
}

export interface AssignmentDetail extends AssignmentSummary {
  readonly targetPrincipalIds: readonly string[];
  readonly learners: readonly AssignmentLearnerView[];
}

interface AssignmentSnapshotRow {
  readonly organization_id: string;
}

/** 合法状态迁移表：ended 为终态。 */
const ALLOWED_TRANSITIONS: Record<AssignmentStatus, readonly AssignmentStatus[]> = {
  draft: ['active', 'paused', 'ended'],
  active: ['paused', 'ended'],
  paused: ['active', 'ended'],
  ended: [],
};

const SUMMARY_SELECT = `
  SELECT a.id, a.name, a.status, a.release_snapshot_id, a.starts_at, a.ends_at, a.max_attempts,
         a.created_at, a.target_principal_ids, a.override_patch, a.scoring_template_id, sd.title AS scenario_title,
         jsonb_array_length(a.target_principal_ids) AS target_count,
         COUNT(la.id) AS assigned_count,
         COUNT(la.id) FILTER (WHERE la.state = 'completed') AS completed_count,
         COUNT(la.id) FILTER (WHERE la.state IN ('created', 'active')) AS in_progress_count
  FROM assignment a
  LEFT JOIN release_snapshot rs ON rs.organization_id = a.organization_id AND rs.id = a.release_snapshot_id
  LEFT JOIN scenario_draft sd ON sd.organization_id = rs.organization_id AND sd.id = rs.scenario_draft_id
  LEFT JOIN learner_assignment la ON la.organization_id = a.organization_id AND la.assignment_id = a.id`;

export class AssignmentService implements OnModuleDestroy {
  private readonly database: Pool;

  public constructor(database: Pool) {
    this.database = database;
  }

  async onModuleDestroy(): Promise<void> {
    await this.database.end();
  }

  async previewTargets(principal: CurrentPrincipal, targetPrincipalIds: readonly string[]): Promise<{ readonly learnerIds: readonly string[] }> {
    void principal;
    const learnerIds = [...new Set(targetPrincipalIds)].map(deriveLearnerId);
    return { learnerIds };
  }

  async createAssignment(principal: CurrentPrincipal, input: CreateAssignmentInput): Promise<{ readonly assignmentId: string }> {
    const assignmentId = input.id ?? crypto.randomUUID();
    const client = await this.database.connect();
    try {
      await client.query('BEGIN');
      const snapshot = await client.query<AssignmentSnapshotRow>('SELECT organization_id FROM release_snapshot WHERE id = $1', [input.releaseSnapshotId]);
      if (snapshot.rows[0] === undefined) {
        throw new AssignmentProblem('ASSIGNMENT_NOT_FOUND', HttpStatus.NOT_FOUND, 'The release snapshot was not found.');
      }
      assertOrganizationScope(principal, snapshot.rows[0].organization_id);
      const targets = [...new Set(input.targetPrincipalIds)];
      const overridePatch = serializeOverridePatch(input.overridePatch ?? null);
      await client.query(
        `INSERT INTO assignment (id, organization_id, release_snapshot_id, name, status, starts_at, ends_at, max_attempts, target_principal_ids, override_patch, scoring_template_id)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9::jsonb, $10::jsonb, $11)`,
        [assignmentId, principal.organizationId, input.releaseSnapshotId, input.name, input.status, input.startsAt, input.endsAt, input.maxAttempts, JSON.stringify(targets), overridePatch, input.scoringTemplateId ?? null],
      );
      for (const targetPrincipalId of targets) {
        await client.query(
          `INSERT INTO learner_assignment (id, organization_id, assignment_id, learner_id, state)
           VALUES ($1, $2, $3, $4, 'eligible')
           ON CONFLICT (organization_id, assignment_id, learner_id) DO NOTHING`,
          [crypto.randomUUID(), principal.organizationId, assignmentId, deriveLearnerId(targetPrincipalId)],
        );
      }
      await client.query('COMMIT');
      return { assignmentId };
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  /** 运营任务列表：JOIN 场景名 + 聚合学员进度；可按状态筛选，组织隔离。 */
  async listAssignments(principal: CurrentPrincipal, statusFilter: AssignmentStatusFilter = 'all'): Promise<{ readonly items: readonly AssignmentSummary[] }> {
    const conditions = ['a.organization_id = $1'];
    const params: unknown[] = [principal.organizationId];
    if (statusFilter !== 'all') {
      params.push(statusFilter);
      conditions.push(`a.status = $${params.length}`);
    }
    const { rows } = await this.database.query(
      `${SUMMARY_SELECT}
       WHERE ${conditions.join(' AND ')}
       GROUP BY a.id, a.name, a.status, a.release_snapshot_id, a.starts_at, a.ends_at,
                a.max_attempts, a.created_at, a.target_principal_ids, a.override_patch, a.scoring_template_id, sd.title
       ORDER BY a.created_at DESC, a.id ASC`,
      params,
    );
    return { items: rows.map(toSummary) };
  }

  /** 任务详情：基础信息 + 投放名单 + 学员明细；跨组织读返回 404。 */
  async getAssignmentDetail(principal: CurrentPrincipal, assignmentId: string): Promise<AssignmentDetail> {
    const { rows } = await this.database.query(
      `${SUMMARY_SELECT}
       WHERE a.organization_id = $1 AND a.id = $2
       GROUP BY a.id, a.name, a.status, a.release_snapshot_id, a.starts_at, a.ends_at,
                a.max_attempts, a.created_at, a.target_principal_ids, a.override_patch, a.scoring_template_id, sd.title`,
      [principal.organizationId, assignmentId],
    );
    const row = rows[0];
    if (row === undefined) {
      throw new AssignmentProblem('ASSIGNMENT_NOT_FOUND', HttpStatus.NOT_FOUND, 'The assignment was not found.');
    }
    const learnerRows = await this.database.query<{ learner_id: string; state: string; total_attempts: number }>(
      `SELECT learner_id, state, total_attempts FROM learner_assignment
       WHERE organization_id = $1 AND assignment_id = $2 ORDER BY created_at ASC`,
      [principal.organizationId, assignmentId],
    );
    const targetPrincipalIds = Array.isArray(row.target_principal_ids)
      ? (row.target_principal_ids as unknown[]).filter((entry): entry is string => typeof entry === 'string')
      : [];
    return {
      ...toSummary(row),
      targetPrincipalIds,
      learners: learnerRows.rows.map((learner) => ({
        learnerId: learner.learner_id,
        state: learner.state,
        totalAttempts: Number(learner.total_attempts),
      })),
    };
  }

  /** 任务状态机：校验合法迁移后更新；非法迁移 409，任务不存在/跨组织 404。 */
  async transitionStatus(principal: CurrentPrincipal, assignmentId: string, target: AssignmentStatus): Promise<AssignmentSummary> {
    const client = await this.database.connect();
    try {
      await client.query('BEGIN');
      const current = await client.query<{ status: AssignmentStatus }>(
        'SELECT status FROM assignment WHERE organization_id = $1 AND id = $2 FOR UPDATE',
        [principal.organizationId, assignmentId],
      );
      const currentRow = current.rows[0];
      if (currentRow === undefined) {
        throw new AssignmentProblem('ASSIGNMENT_NOT_FOUND', HttpStatus.NOT_FOUND, 'The assignment was not found.');
      }
      if (!ALLOWED_TRANSITIONS[currentRow.status].includes(target)) {
        throw new AssignmentProblem(
          'ASSIGNMENT_ILLEGAL_TRANSITION',
          HttpStatus.CONFLICT,
          `Cannot move an assignment from ${currentRow.status} to ${target}.`,
        );
      }
      await client.query(
        'UPDATE assignment SET status = $1, updated_at = CURRENT_TIMESTAMP WHERE organization_id = $2 AND id = $3',
        [target, principal.organizationId, assignmentId],
      );
      await client.query('COMMIT');
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
    const { items } = await this.listAssignments(principal, 'all');
    const updated = items.find((item) => item.id === assignmentId);
    if (updated === undefined) {
      throw new AssignmentProblem('ASSIGNMENT_NOT_FOUND', HttpStatus.NOT_FOUND, 'The assignment was not found.');
    }
    return updated;
  }

  /**
   * 更新任务级参数覆盖（spec §6.4 扩展）：已结束任务禁止再改覆盖；
   * 部分更新与已有覆盖**合并**（agentConfig/conversation 各自浅合并），
   * 只影响之后新开的会话，历史会话冻结不受影响。patch=null 表示清空覆盖。
   */
  async updateAssignmentOverride(principal: CurrentPrincipal, assignmentId: string, patch: AssignmentOverridePatchV1 | null): Promise<AssignmentSummary> {
    const client = await this.database.connect();
    try {
      await client.query('BEGIN');
      const current = await client.query<{ status: AssignmentStatus; override_patch: unknown }>(
        'SELECT status, override_patch FROM assignment WHERE organization_id = $1 AND id = $2 FOR UPDATE',
        [principal.organizationId, assignmentId],
      );
      const currentRow = current.rows[0];
      if (currentRow === undefined) {
        throw new AssignmentProblem('ASSIGNMENT_NOT_FOUND', HttpStatus.NOT_FOUND, 'The assignment was not found.');
      }
      if (currentRow.status === 'ended') {
        throw new AssignmentProblem(
          'ASSIGNMENT_ILLEGAL_TRANSITION',
          HttpStatus.CONFLICT,
          'Cannot change the parameter override of an ended assignment.',
        );
      }
      const merged = mergeOverridePatches(parseOverridePatch(currentRow.override_patch), patch);
      await client.query(
        'UPDATE assignment SET override_patch = $1, updated_at = CURRENT_TIMESTAMP WHERE organization_id = $2 AND id = $3',
        [serializeOverridePatch(merged), principal.organizationId, assignmentId],
      );
      await client.query('COMMIT');
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
    const { items } = await this.listAssignments(principal, 'all');
    const updated = items.find((item) => item.id === assignmentId);
    if (updated === undefined) {
      throw new AssignmentProblem('ASSIGNMENT_NOT_FOUND', HttpStatus.NOT_FOUND, 'The assignment was not found.');
    }
    return updated;
  }

  async listMyAssignments(principal: CurrentPrincipal): Promise<{ readonly items: readonly Record<string, unknown>[] }> {
    const learnerId = deriveLearnerId(principal.principalId);
    const { rows } = await this.database.query<{
      assignment_id: string;
      name: string;
      status: string;
      starts_at: Date;
      ends_at: Date;
      max_attempts: number;
      total_attempts: number;
      learner_state: string;
    }>(
      `SELECT a.id AS assignment_id, a.name, a.status, a.starts_at, a.ends_at, a.max_attempts,
              la.total_attempts, la.state AS learner_state
       FROM learner_assignment la
       JOIN assignment a ON a.id = la.assignment_id AND a.organization_id = la.organization_id
       WHERE la.organization_id = $1 AND la.learner_id = $2
       ORDER BY a.created_at ASC`,
      [principal.organizationId, learnerId],
    );
    return {
      items: rows.map((row) => ({
        assignmentId: row.assignment_id,
        name: row.name,
        status: row.status,
        startsAt: row.starts_at.toISOString(),
        endsAt: row.ends_at.toISOString(),
        maxAttempts: row.max_attempts,
        completedAttempts: row.total_attempts,
        learnerState: row.learner_state,
      })),
    };
  }
}

interface AssignmentSummaryRow {
  readonly id: string;
  readonly name: string;
  readonly status: AssignmentStatus;
  readonly release_snapshot_id: string;
  readonly starts_at: Date;
  readonly ends_at: Date;
  readonly max_attempts: number;
  readonly created_at: Date;
  readonly target_principal_ids: unknown;
  readonly override_patch: unknown;
  readonly scoring_template_id: string | null;
  readonly scenario_title: string | null;
  readonly target_count: number;
  readonly assigned_count: string;
  readonly completed_count: string;
  readonly in_progress_count: string;
}

function toSummary(raw: AssignmentSummaryRow): AssignmentSummary {
  return {
    id: raw.id,
    name: raw.name,
    status: raw.status,
    scenarioTitle: raw.scenario_title,
    releaseSnapshotId: raw.release_snapshot_id,
    startsAt: new Date(raw.starts_at).toISOString(),
    endsAt: new Date(raw.ends_at).toISOString(),
    maxAttempts: Number(raw.max_attempts),
    targetCount: Number(raw.target_count),
    assignedCount: Number(raw.assigned_count),
    completedCount: Number(raw.completed_count),
    inProgressCount: Number(raw.in_progress_count),
    createdAt: new Date(raw.created_at).toISOString(),
    overridePatch: parseOverridePatch(raw.override_patch),
    scoringTemplateId: raw.scoring_template_id ?? null,
  };
}
