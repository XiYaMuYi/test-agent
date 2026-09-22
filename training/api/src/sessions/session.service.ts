import crypto from 'node:crypto';

import { HttpStatus, type OnModuleDestroy } from '@nestjs/common';
import type { Pool, PoolClient } from 'pg';
import { buildDefaultConfig, normalizeAgentConfig, type AgentConfigV1, type PersonaConfig } from '@training/contracts';

import { AssignmentProblem, deriveLearnerId, EligibilityService } from '../assignments/eligibility.service.js';
import { type AssignmentOverridePatchV1, parseOverridePatch } from '../assignments/assignment.service.js';
import { assertOrganizationScope } from '../identity/organization-context.js';
import type { CurrentPrincipal } from '../identity/identity-context.js';
import type { BuildPersonaInput, PersonaService } from '../persona/persona.service.js';
import type { TemplateService, TemplateView } from '../templates/template.service.js';

/** Request to start a free (self-initiated, assignment-free) practice session. */
export interface StartFreeSessionInput {
  /** Inline persona setup; when omitted a visible templateId must supply the persona. */
  readonly persona?: BuildPersonaInput;
  /** Optional visible template whose persona/knowledge the session inherits. */
  readonly templateId?: string;
  readonly mode?: 'practice' | 'exam';
}

/** Result of starting either track's session. */
export interface StartedSession {
  readonly sessionId: string;
  readonly conversationId: string;
  readonly sourceType: 'free' | 'assigned';
}

/** Assigned start additionally returns the legacy attempt identifier. */
export interface StartedAssignedSession {
  readonly sessionId: string;
  readonly attemptId: string;
  readonly conversationId: string;
}

interface AssignmentRow {
  readonly organization_id: string;
  readonly release_snapshot_id: string;
  readonly status: string;
  readonly starts_at: Date;
  readonly ends_at: Date;
  readonly max_attempts: number;
  readonly override_patch: unknown;
}

interface LearnerAssignmentRow {
  readonly id: string;
  readonly state: string;
  readonly total_attempts: number;
  readonly active_attempt_id: string | null;
}

const IN_FLIGHT_STATUSES = ['created', 'active'] as const;

function isUniqueViolation(error: unknown): error is { readonly code: string } {
  return typeof error === 'object' && error !== null && 'code' in error && error.code === '23505';
}

/**
 * Unified training-session root for the C-first dual-track model. Free sessions
 * need no assignment; assigned sessions keep the legacy attempt/eligibility chain.
 * Both resolve to the same learner_profile and share one in-flight session per learner.
 * Contract: docs/architecture/contracts/c-first-dual-track-contract.md §4, §6.
 */
export class SessionService implements OnModuleDestroy {
  public constructor(
    private readonly database: Pool,
    private readonly personas: PersonaService,
    private readonly eligibility: EligibilityService,
    private readonly templates: TemplateService,
  ) {}

  async onModuleDestroy(): Promise<void> {
    await this.database.end();
  }

  async startFreeSession(
    principal: CurrentPrincipal,
    input: StartFreeSessionInput,
    idempotencyKey: string,
  ): Promise<StartedSession> {
    const mode = input.mode ?? 'practice';
    if (mode !== 'practice' && mode !== 'exam') {
      throw new Error('SCHEMA_INVALID');
    }

    // Resolve an optional template against the visibility matrix before opening a
    // transaction: a hidden/archived template rejects without touching the database.
    let resolvedTemplate: TemplateView | undefined;
    if (input.templateId !== undefined) {
      resolvedTemplate = await this.templates.resolveVisibleTemplate(principal, input.templateId);
    }

    // Build + validate the frozen snapshot before opening a transaction: an invalid
    // persona rejects with PERSONA_* without touching the database. An inline persona
    // wins over the template persona (contract §7.1); otherwise the template supplies it.
    let personaSnapshot: PersonaConfig;
    if (input.persona !== undefined) {
      personaSnapshot = this.personas.buildPersonaConfig(input.persona);
    } else if (resolvedTemplate !== undefined) {
      personaSnapshot = this.freezeValidPersona(resolvedTemplate.personaConfig);
    } else {
      throw new Error('SCHEMA_INVALID');
    }

    const learnerId = deriveLearnerId(principal.principalId);
    const organizationId = principal.organizationId;
    const client = await this.database.connect();
    try {
      await client.query('BEGIN');

      // displayName 传 null：学员真实昵称应来自身份系统，不能用客户画像名称（personaSnapshot.name）填充
      await this.upsertLearnerProfile(client, principal, learnerId, null);

      // Idempotent replay takes precedence over the single-active guard.
      const existing = await client.query<{ id: string; conversation_id: string | null }>(
        `SELECT ts.id, c.id AS conversation_id
         FROM training_session ts
         LEFT JOIN conversation c
           ON c.organization_id = ts.organization_id
          AND c.training_session_id = ts.id
         WHERE ts.organization_id = $1 AND ts.learner_id = $2 AND ts.idempotency_key = $3`,
        [organizationId, learnerId, idempotencyKey],
      );
      if (existing.rows[0] !== undefined) {
        const row = existing.rows[0];
        let conversationId = row.conversation_id;
        if (conversationId === null) {
          conversationId = crypto.randomUUID();
          await client.query(
            `INSERT INTO conversation (id, organization_id, training_session_id, status)
             VALUES ($1, $2, $3, 'created')`,
            [conversationId, organizationId, row.id],
          );
        }
        await client.query('COMMIT');
        return { sessionId: row.id, conversationId, sourceType: 'free' };
      }

      await this.assertNoInFlightSession(client, organizationId, learnerId, 'SESSION_ALREADY_ACTIVE');

      const sessionId = crypto.randomUUID();
      const conversationId = crypto.randomUUID();
      await client.query(
        `INSERT INTO training_session (
           id, organization_id, learner_id, source_type, mode,
           template_id, release_snapshot_id, assignment_id, learner_assignment_id,
           training_attempt_id, persona_snapshot, status, idempotency_key
         )
         VALUES ($1, $2, $3, 'free', $4, $7, NULL, NULL, NULL, NULL, $5::jsonb, 'created', $6)`,
        [sessionId, organizationId, learnerId, mode, JSON.stringify(personaSnapshot), idempotencyKey, resolvedTemplate?.id ?? null],
      );

      // Free conversation carries no attempt/snapshot; it is owned by the session root.
      await client.query(
        `INSERT INTO conversation (
           id, organization_id, training_attempt_id, release_snapshot_id,
           training_session_id, status
         )
         VALUES ($1, $2, NULL, NULL, $3, 'created')`,
        [conversationId, organizationId, sessionId],
      );

      await client.query('COMMIT');
      return { sessionId, conversationId, sourceType: 'free' };
    } catch (error) {
      await client.query('ROLLBACK');
      // The partial unique index training_session_one_active_per_learner catches concurrent starts.
      if (isUniqueViolation(error)) {
        throw new Error('SESSION_ALREADY_ACTIVE');
      }
      throw error;
    } finally {
      client.release();
    }
  }

  async startAssignedSession(
    principal: CurrentPrincipal,
    assignmentId: string,
    idempotencyKey: string,
  ): Promise<StartedAssignedSession> {
    const learnerId = deriveLearnerId(principal.principalId);
    const organizationId = principal.organizationId;
    const client = await this.database.connect();
    try {
      await client.query('BEGIN');

      // 第一层防护：自动清理超时的卡住会话（30分钟无活动自动结束）
      await client.query(
        `UPDATE learner_assignment
         SET active_attempt_id = NULL, updated_at = CURRENT_TIMESTAMP
         WHERE organization_id = $1 AND assignment_id = $2 AND learner_id = $3
           AND active_attempt_id IS NOT NULL
           AND updated_at < CURRENT_TIMESTAMP - INTERVAL '30 minutes'`,
        [organizationId, assignmentId, learnerId],
      );
      await client.query(
        `UPDATE training_attempt
         SET status = 'timeout', updated_at = CURRENT_TIMESTAMP
         WHERE organization_id = $1 AND learner_assignment_id IN (
           SELECT id FROM learner_assignment
           WHERE organization_id = $1 AND assignment_id = $2 AND learner_id = $3
         ) AND status IN ('created', 'active', 'awaiting_model')
           AND updated_at < CURRENT_TIMESTAMP - INTERVAL '30 minutes'`,
        [organizationId, assignmentId, learnerId],
      );

      const assignmentResult = await client.query<AssignmentRow>(
        `SELECT organization_id, release_snapshot_id, status, starts_at, ends_at, max_attempts, override_patch
         FROM assignment WHERE id = $1`,
        [assignmentId],
      );
      const assignment = assignmentResult.rows[0];
      if (assignment === undefined) {
        throw new AssignmentProblem('ASSIGNMENT_NOT_FOUND', HttpStatus.NOT_FOUND, 'The assignment was not found.');
      }
      assertOrganizationScope(principal, assignment.organization_id);

      const learnerResult = await client.query<LearnerAssignmentRow>(
        `SELECT id, state, total_attempts, active_attempt_id
         FROM learner_assignment
         WHERE organization_id = $1 AND assignment_id = $2 AND learner_id = $3
         FOR UPDATE`,
        [organizationId, assignmentId, learnerId],
      );
      const learnerAssignment = learnerResult.rows[0];
      if (learnerAssignment === undefined) {
        throw new AssignmentProblem('ASSIGNMENT_NOT_ELIGIBLE', HttpStatus.FORBIDDEN, 'The current principal is not an authorized target.');
      }

      // Idempotent replay on the legacy attempt key, joining the new session root.
      const existing = await client.query<{
        id: string;
        learner_assignment_id: string;
        conversation_id: string | null;
        session_id: string | null;
      }>(
        `SELECT attempt.id, attempt.learner_assignment_id,
                conversation.id AS conversation_id, conversation.training_session_id AS session_id
         FROM training_attempt attempt
         LEFT JOIN conversation
           ON conversation.organization_id = attempt.organization_id
          AND conversation.training_attempt_id = attempt.id
         WHERE attempt.organization_id = $1 AND attempt.idempotency_key = $2`,
        [organizationId, idempotencyKey],
      );
      if (existing.rows[0] !== undefined) {
        const row = existing.rows[0];
        if (row.learner_assignment_id !== learnerAssignment.id) {
          throw new AssignmentProblem('ATTEMPT_ALREADY_ACTIVE', HttpStatus.CONFLICT, 'The idempotency key belongs to another assignment.');
        }
        let conversationId = row.conversation_id;
        if (conversationId === null) {
          conversationId = crypto.randomUUID();
          await client.query(
            `INSERT INTO conversation (id, organization_id, training_attempt_id, release_snapshot_id, training_session_id, status)
             VALUES ($1, $2, $3, $4, $5, 'created')`,
            [conversationId, organizationId, row.id, assignment.release_snapshot_id, row.session_id],
          );
        }
        await client.query('COMMIT');
        if (row.session_id === null || conversationId === null) {
          throw new AssignmentProblem('ATTEMPT_ALREADY_ACTIVE', HttpStatus.CONFLICT, 'Inconsistent assigned session state.');
        }
        return { sessionId: row.session_id, attemptId: row.id, conversationId };
      }

      this.eligibility.assertStartable({
        assignmentStatus: assignment.status,
        startsAt: assignment.starts_at,
        endsAt: assignment.ends_at,
        learnerState: learnerAssignment.state,
        completedAttempts: learnerAssignment.total_attempts,
        maxAttempts: assignment.max_attempts,
        activeAttemptId: learnerAssignment.active_attempt_id,
      }, new Date());

      // Global single-active guard across BOTH tracks (a free session blocks assigned and vice versa).
      await this.assertNoInFlightSession(client, organizationId, learnerId, 'ATTEMPT_ALREADY_ACTIVE');

      await this.upsertLearnerProfile(client, principal, learnerId, null);

      // A task may carry its own persona in the compiled release snapshot.
      // v2 snapshots must contain a valid complete persona (spec §8.1): refuse to
      // start when absent/invalid (RELEASE_SNAPSHOT_INVALID). v1 snapshots keep the
      // legacy fallback and record why (legacyFallbackReason).
      const snapshotResult = await client.query<{ snapshot: { schemaVersion?: string; personaConfig?: unknown; agentConfig?: unknown } | null }>(
        `SELECT snapshot FROM release_snapshot
         WHERE id = $1 AND organization_id = $2`,
        [assignment.release_snapshot_id, organizationId],
      );
      const snapshot = snapshotResult.rows[0]?.snapshot ?? null;
      const { persona, legacyFallbackReason } = this.resolveTaskPersona(snapshot);

      // 任务级参数覆盖（spec §6.4 扩展，用户已拍板）：任务可对已发布快照叠加覆盖
      // （AgentConfigV1 6 项 + conversation.maxTurns/openingMode/background）。
      // 覆盖只影响"本次启动的新会话"：persona 覆盖合并进 persona_snapshot 冻结，
      // agentConfig 覆盖合并进 training_session.agent_config 冻结；历史会话不受影响。
      const override = parseOverridePatch(assignment.override_patch);
      // 再次经 freezeValidPersona 校验并深冻结，保证合并结果与快照人设同级可信。
      const effectivePersona = this.freezeValidPersona(applyPersonaOverride(persona, override));
      const effectiveAgentConfig = applyAgentConfigOverride(snapshot?.agentConfig, override);

      const attemptId = crypto.randomUUID();
      const sessionId = crypto.randomUUID();
      const conversationId = crypto.randomUUID();

      await client.query(
        `INSERT INTO training_attempt (id, organization_id, learner_assignment_id, idempotency_key, status)
         VALUES ($1, $2, $3, $4, 'created')`,
        [attemptId, organizationId, learnerAssignment.id, idempotencyKey],
      );

      // Assigned sessions carry the task persona (from the release snapshot) or the default.
      await client.query(
        `INSERT INTO training_session (
           id, organization_id, learner_id, source_type, mode, template_id,
           release_snapshot_id, assignment_id, learner_assignment_id,
           training_attempt_id, persona_snapshot, agent_config, legacy_fallback_reason, status, idempotency_key
         )
         VALUES ($1, $2, $3, 'assigned', 'practice', NULL, $4, $5, $6, $7, $8::jsonb, $9::jsonb, $10, 'created', $11)`,
        [
          sessionId, organizationId, learnerId, assignment.release_snapshot_id,
          assignmentId, learnerAssignment.id, attemptId,
          JSON.stringify(effectivePersona), JSON.stringify(effectiveAgentConfig), legacyFallbackReason, idempotencyKey,
        ],
      );

      // Conversation is bound to BOTH the legacy attempt chain and the new session root.
      await client.query(
        `INSERT INTO conversation (
           id, organization_id, training_attempt_id, release_snapshot_id,
           training_session_id, status
         )
         VALUES ($1, $2, $3, $4, $5, 'created')`,
        [conversationId, organizationId, attemptId, assignment.release_snapshot_id, sessionId],
      );

      await client.query(
        `UPDATE learner_assignment
         SET active_attempt_id = $1, state = 'active', updated_at = CURRENT_TIMESTAMP
         WHERE id = $2 AND organization_id = $3`,
        [attemptId, learnerAssignment.id, organizationId],
      );

      await client.query('COMMIT');
      return { sessionId, attemptId, conversationId };
    } catch (error) {
      await client.query('ROLLBACK');
      if (isUniqueViolation(error)) {
        throw new AssignmentProblem('ATTEMPT_ALREADY_ACTIVE', HttpStatus.CONFLICT, 'An attempt/session is already active.');
      }
      throw error;
    } finally {
      client.release();
    }
  }

  private async assertNoInFlightSession(
    client: PoolClient,
    organizationId: string,
    learnerId: string,
    code: 'SESSION_ALREADY_ACTIVE' | 'ATTEMPT_ALREADY_ACTIVE',
  ): Promise<void> {
    // 联表查询：只有 session in-flight 且对应 conversation 也活跃，才算真正的 in-flight
    // 避免孤儿 session（session 是 created/active 但 conversation 已 ended）阻塞新会话创建
    const trulyActive = await client.query(
      `SELECT 1 FROM training_session s
       JOIN conversation c ON c.training_session_id = s.id
         AND c.status IN ('created', 'active', 'awaiting_model')
       WHERE s.organization_id = $1 AND s.learner_id = $2 AND s.status = ANY($3)
       LIMIT 1`,
      [organizationId, learnerId, IN_FLIGHT_STATUSES],
    );
    if (trulyActive.rows.length > 0) {
      if (code === 'SESSION_ALREADY_ACTIVE') {
        throw new Error('SESSION_ALREADY_ACTIVE');
      }
      throw new AssignmentProblem('ATTEMPT_ALREADY_ACTIVE', HttpStatus.CONFLICT, 'A training session is already active.');
    }
    // 自动清理孤儿 session：session in-flight 但没有活跃 conversation（异常数据自愈）
    await client.query(
      `UPDATE training_session SET status = 'ended', finished_at = CURRENT_TIMESTAMP
       WHERE organization_id = $1 AND learner_id = $2 AND status = ANY($3)
       AND id NOT IN (
         SELECT DISTINCT training_session_id FROM conversation
         WHERE status IN ('created', 'active', 'awaiting_model')
       )`,
      [organizationId, learnerId, IN_FLIGHT_STATUSES],
    );
  }

  private async upsertLearnerProfile(
    client: PoolClient,
    principal: CurrentPrincipal,
    learnerId: string,
    displayName: string | null,
  ): Promise<void> {
    await client.query(
      `INSERT INTO learner_profile (
         internal_learner_id, organization_id, external_principal_id,
         identity_provider, display_name, last_trained_at
       )
       VALUES ($1, $2, $3, 'gongzhugou', $4, CURRENT_TIMESTAMP)
       ON CONFLICT (organization_id, internal_learner_id) DO UPDATE
       SET external_principal_id = EXCLUDED.external_principal_id,
           identity_provider = EXCLUDED.identity_provider,
           display_name = COALESCE($4, learner_profile.display_name),
           last_trained_at = CURRENT_TIMESTAMP,
           updated_at = CURRENT_TIMESTAMP`,
      [learnerId, principal.organizationId, principal.principalId, displayName],
    );
  }

  /** Freeze a stored/template persona after validating it; reject malformed configs. */
  private freezeValidPersona(raw: unknown): PersonaConfig {
    const validation = this.personas.validatePersonaConfig(raw);
    if (!validation.valid) {
      throw new Error('PERSONA_CONFIG_INVALID');
    }
    const config = raw as PersonaConfig;
    deepFreezeValue(config);
    return config;
  }

  /**
   * Task persona carried by a release snapshot.
   * - v2: personaConfig must be present AND valid; otherwise refuse to start (RELEASE_SNAPSHOT_INVALID).
   * - v1: optional persona; when absent/invalid use the safe default and report legacyFallbackReason.
   */
  private resolveTaskPersona(snapshot: { schemaVersion?: string; personaConfig?: unknown } | null): {
    persona: PersonaConfig;
    legacyFallbackReason: string | null;
  } {
    const schemaVersion = snapshot?.schemaVersion;
    const raw = snapshot?.personaConfig;
    if (schemaVersion === 'release-snapshot/v2') {
      if (raw === undefined || raw === null || !this.personas.validatePersonaConfig(raw).valid) {
        throw new AssignmentProblem(
          'RELEASE_SNAPSHOT_INVALID',
          HttpStatus.UNPROCESSABLE_ENTITY,
          'The v2 release snapshot does not carry a valid personaConfig; refusing to start the assigned session.',
        );
      }
      return { persona: this.freezeValidPersona(raw), legacyFallbackReason: null };
    }
    if (raw !== undefined && raw !== null && this.personas.validatePersonaConfig(raw).valid) {
      return { persona: this.freezeValidPersona(raw), legacyFallbackReason: null };
    }
    return {
      persona: buildDefaultConfig(),
      legacyFallbackReason: raw === undefined || raw === null
        ? 'v1 snapshot has no personaConfig'
        : 'v1 snapshot personaConfig failed validation',
    };
  }
}

/**
 * 把任务覆盖的 conversation 三字段（maxTurns/openingMode/background）叠加到快照人设上，
 * 生成会话冻结用的有效人设。覆盖值已在创建/更新时校验；合并结果仍走 freezeValidPersona
 * 再校验并深冻结，避免任何非法组合进入会话。
 */
function applyPersonaOverride(persona: PersonaConfig, override: AssignmentOverridePatchV1 | null): PersonaConfig {
  if (override?.conversation === undefined) return persona;
  const { maxTurns, openingMode, background } = override.conversation;
  if (maxTurns === undefined && openingMode === undefined && background === undefined) return persona;
  return {
    ...persona,
    conversation: {
      ...persona.conversation,
      ...(maxTurns !== undefined ? { maxTurns } : {}),
      ...(openingMode !== undefined ? { openingMode } : {}),
      ...(background !== undefined ? { background } : {}),
    },
  };
}

/**
 * 合并快照 agentConfig 与任务覆盖的 agentConfig，得到会话冻结的生效 AgentConfig。
 * 覆盖缺省字段保留快照原值；整体经 normalizeAgentConfig 归一化兜底。
 */
function applyAgentConfigOverride(snapshotAgentConfig: unknown, override: AssignmentOverridePatchV1 | null): AgentConfigV1 {
  const base = typeof snapshotAgentConfig === 'object' && snapshotAgentConfig !== null
    ? (snapshotAgentConfig as Record<string, unknown>)
    : {};
  const patch = override?.agentConfig ?? {};
  return normalizeAgentConfig({ ...base, ...patch });
}

function deepFreezeValue<T>(value: T): T {
  if (value !== null && typeof value === 'object' && !Object.isFrozen(value)) {
    for (const key of Object.keys(value)) {
      deepFreezeValue((value as Record<string, unknown>)[key]);
    }
    Object.freeze(value);
  }
  return value;
}
