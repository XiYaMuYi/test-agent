import crypto from 'node:crypto';

import type { OnModuleDestroy } from '@nestjs/common';
import type { Pool, PoolClient } from 'pg';
import type {
  AgentConfigV1,
  LearnerOverridePolicyV1,
  OrganizationTemplateRevisionV1,
  PersonaConfig,
  TemplateRevisionDiffEntry,
} from '@training/contracts';
import {
  DEFAULT_LEARNER_OVERRIDE_POLICY,
  diffTemplateRevisions as diffRevisions,
  normalizeAgentConfig,
  normalizeLearnerOverridePolicy,
  validateAgentConfigV1,
  validateLearnerOverridePolicy,
} from '@training/contracts';

import { deriveLearnerId } from '../assignments/eligibility.service.js';
import type { CurrentPrincipal } from '../identity/identity-context.js';
import type { PersonaService } from '../persona/persona.service.js';

export type TemplateScope = 'platform' | 'organization' | 'personal';

export interface TemplateView {
  readonly id: string;
  readonly organizationId: string;
  readonly scope: TemplateScope;
  readonly ownerLearnerId: string | null;
  readonly title: string;
  readonly personaConfig: PersonaConfig;
  readonly knowledgeVersions: readonly unknown[];
  readonly scoringRules: readonly unknown[];
  readonly agentConfig: AgentConfigV1;
  readonly learnerOverridePolicy: LearnerOverridePolicyV1;
  readonly status: 'active' | 'archived';
  readonly createdAt: Date;
  /** 当前版本投影：最新 revision 号与 revision id（组织模板有值；个人/平台模板为 null）。 */
  readonly currentRevision: number | null;
  readonly currentRevisionId: string | null;
  /** 推荐评分模板 ID 列表（B 端运营在编辑模板时配置，任务投放时作为默认推荐）。 */
  readonly recommendedScoringTemplateIds: readonly string[];
}

export interface CreateTemplateInput {
  readonly title: string;
  readonly personaConfig: unknown;
  readonly knowledgeVersions?: readonly unknown[];
  readonly scoringRules?: readonly unknown[];
  readonly agentConfig?: Record<string, unknown>;
  readonly learnerOverridePolicy?: unknown;
}

export interface ListTemplateFilter {
  readonly scope?: TemplateScope;
  readonly productScenario?: string;
}

export type AdminTemplateStatusFilter = 'active' | 'archived' | 'all';

export interface UpdateOrganizationTemplateInput {
  readonly title?: string;
  readonly personaConfig?: unknown;
  readonly knowledgeVersions?: readonly unknown[];
  readonly scoringRules?: readonly unknown[];
  readonly agentConfig?: Record<string, unknown>;
  readonly learnerOverridePolicy?: unknown;
  readonly recommendedScoringTemplateIds?: readonly string[];
}

export interface TemplateRevisionView {
  readonly revisionId: string;
  readonly templateId: string;
  readonly revision: number;
  readonly title: string;
  readonly personaConfig: PersonaConfig;
  readonly knowledgeVersions: readonly unknown[];
  readonly scoringRules: readonly unknown[];
  readonly agentConfig: AgentConfigV1;
  readonly learnerOverridePolicy: LearnerOverridePolicyV1;
  readonly createdBy: string | null;
  readonly createdAt: Date;
}

interface TemplateRow {
  readonly id: string;
  readonly organization_id: string;
  readonly scope: TemplateScope;
  readonly owner_learner_id: string | null;
  readonly title: string;
  readonly persona_config: PersonaConfig;
  readonly knowledge_versions: readonly unknown[];
  readonly scoring_rules: readonly unknown[];
  readonly agent_config: unknown;
  readonly learner_override_policy: unknown;
  readonly recommended_scoring_template_ids: readonly string[];
  readonly status: 'active' | 'archived';
  readonly created_at: Date;
  readonly current_revision: number | null;
  readonly current_revision_id: string | null;
}

function isUniqueViolation(error: unknown): error is { readonly code: string } {
  return typeof error === 'object' && error !== null && 'code' in error && error.code === '23505';
}

function toView(row: TemplateRow): TemplateView {
  return {
    id: row.id,
    organizationId: row.organization_id,
    scope: row.scope,
    ownerLearnerId: row.owner_learner_id,
    title: row.title,
    personaConfig: row.persona_config,
    knowledgeVersions: row.knowledge_versions ?? [],
    scoringRules: row.scoring_rules ?? [],
    agentConfig: normalizeAgentConfig(row.agent_config),
    learnerOverridePolicy: normalizeLearnerOverridePolicy(row.learner_override_policy),
    recommendedScoringTemplateIds: row.recommended_scoring_template_ids ?? [],
    status: row.status,
    createdAt: row.created_at,
    currentRevision: row.current_revision,
    currentRevisionId: row.current_revision_id,
  };
}

const SELECT_COLUMNS = `
  t.id, t.organization_id AS organization_id, t.scope, t.owner_learner_id, t.title,
  t.persona_config, t.knowledge_versions, t.scoring_rules, t.agent_config,
  t.learner_override_policy, t.recommended_scoring_template_ids, t.status, t.created_at,
  (SELECT MAX(r.revision) FROM training_template_revision r
     WHERE r.organization_id = t.organization_id AND r.template_id = t.id) AS current_revision,
  (SELECT r.id FROM training_template_revision r
     WHERE r.organization_id = t.organization_id AND r.template_id = t.id
     ORDER BY r.revision DESC LIMIT 1) AS current_revision_id
`;

/**
 * Three-layer training-template supply (platform / organization / personal) plus
 * the B 端组织模板 revision 治理（spec 2026-09-15 §5.1、§6.2）。
 *
 * 组织模板：稳定 templateId + 追加式 revision。保存有效修改时创建新 revision，
 * 归档/启用属于生命周期状态，不覆盖历史 revision。模板支持复制。
 * C 端消费组织模板时附带 learnerOverridePolicy（visible/recommended/可覆盖字段）。
 */
export class TemplateService implements OnModuleDestroy {
  public constructor(
    private readonly database: Pool,
    private readonly personas: PersonaService,
  ) {}

  async onModuleDestroy(): Promise<void> {
    await this.database.end();
  }

  async listVisibleTemplates(principal: CurrentPrincipal, filter: ListTemplateFilter = {}): Promise<readonly TemplateView[]> {
    const learnerId = deriveLearnerId(principal.principalId);
    const conditions = [
      `t.status = 'active'`,
      `(t.scope = 'platform'
        OR (t.scope = 'organization' AND t.organization_id = $1 AND t.visible = TRUE)
        OR (t.scope = 'personal' AND t.owner_learner_id = $2))`,
    ];
    const values: unknown[] = [principal.organizationId, learnerId];
    if (filter.scope !== undefined) {
      values.push(filter.scope);
      conditions.push(`t.scope = $${values.length}`);
    }
    if (filter.productScenario !== undefined) {
      values.push(filter.productScenario);
      conditions.push(`t.persona_config -> 'conversation' ->> 'productScenario' = $${values.length}`);
    }
    const { rows } = await this.database.query<TemplateRow>(
      `SELECT ${SELECT_COLUMNS}
       FROM training_template t
       WHERE ${conditions.join(' AND ')}
       ORDER BY t.recommended DESC, t.scope ASC, t.created_at DESC`,
      values,
    );
    return rows.map(toView);
  }

  /** Resolve a template a learner may start a free session against; hidden/archived/foreign look identical. */
  async resolveVisibleTemplate(principal: CurrentPrincipal, templateId: string): Promise<TemplateView> {
    const learnerId = deriveLearnerId(principal.principalId);
    const { rows } = await this.database.query<TemplateRow>(
      `SELECT ${SELECT_COLUMNS}
       FROM training_template t
       WHERE t.id = $3 AND t.status = 'active'
         AND (t.scope = 'platform'
              OR (t.scope = 'organization' AND t.organization_id = $1 AND t.visible = TRUE)
              OR (t.scope = 'personal' AND t.owner_learner_id = $2))`,
      [principal.organizationId, learnerId, templateId],
    );
    const row = rows[0];
    if (row === undefined) {
      throw new Error('FREE_SESSION_TEMPLATE_UNAVAILABLE');
    }
    return toView(row);
  }

  async createPersonalTemplate(principal: CurrentPrincipal, input: CreateTemplateInput): Promise<TemplateView> {
    const learnerId = deriveLearnerId(principal.principalId);
    const client = await this.database.connect();
    try {
      await this.ensureLearnerProfile(client, principal, learnerId);
      return await this.insertTemplate(client, principal.organizationId, 'personal', learnerId, input);
    } finally {
      client.release();
    }
  }

  /**
   * 创建组织模板：事务内写入 training_template（当前投影）+ 创建 revision 1（spec §10.1）。
   */
  async createOrganizationTemplate(principal: CurrentPrincipal, input: CreateTemplateInput): Promise<TemplateView> {
    const client = await this.database.connect();
    try {
      await client.query('BEGIN');
      const view = await this.insertTemplate(client, principal.organizationId, 'organization', null, input);
      const revision = toRevisionRow(view, principal, 1);
      await client.query(
        `INSERT INTO training_template_revision (
           id, organization_id, template_id, revision, title, persona_config,
           knowledge_versions, scoring_rules, agent_config, learner_override_policy, created_by
         ) VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7::jsonb, $8::jsonb, $9::jsonb, $10::jsonb, $11)`,
        [
          revision.revisionId, view.organizationId, view.id, 1, view.title,
          JSON.stringify(view.personaConfig), JSON.stringify(view.knowledgeVersions),
          JSON.stringify(view.scoringRules), JSON.stringify(view.agentConfig),
          JSON.stringify(view.learnerOverridePolicy), principal.principalId,
        ],
      );
      await client.query('COMMIT');
      return this.requireOrganizationTemplate(principal, view.id);
    } catch (error) {
      await client.query('ROLLBACK');
      if (isUniqueViolation(error)) throw new Error('TEMPLATE_TITLE_CONFLICT');
      throw error;
    } finally {
      client.release();
    }
  }

  /** Admin maintenance list: only the organization's own templates, status filterable (default active). */
  async listOrganizationTemplates(principal: CurrentPrincipal, statusFilter: AdminTemplateStatusFilter = 'active'): Promise<readonly TemplateView[]> {
    const conditions = [`t.scope = 'organization'`, `t.organization_id = $1`];
    const values: unknown[] = [principal.organizationId];
    if (statusFilter !== 'all') {
      values.push(statusFilter);
      conditions.push(`t.status = $${values.length}`);
    }
    const { rows } = await this.database.query<TemplateRow>(
      `SELECT ${SELECT_COLUMNS}
       FROM training_template t
       WHERE ${conditions.join(' AND ')}
       ORDER BY t.created_at DESC, t.id ASC`,
      values,
    );
    return rows.map(toView);
  }

  /**
   * 编辑组织模板：任何有效字段修改都创建新 revision（追加式），并同步当前投影（spec §10.3）。
   * personaConfig 现在可编辑（spec §6.1 完整人设编辑器）；知识/评分传空数组代表明确清空。
   */
  async updateOrganizationTemplate(principal: CurrentPrincipal, templateId: string, patch: UpdateOrganizationTemplateInput): Promise<TemplateView> {
    const client = await this.database.connect();
    try {
      await client.query('BEGIN');
      const current = await client.query<TemplateRow>(
        `SELECT ${SELECT_COLUMNS}
         FROM training_template t
         WHERE organization_id = $1 AND id = $2 AND scope = 'organization'
         FOR UPDATE`,
        [principal.organizationId, templateId],
      );
      const row = current.rows[0];
      if (row === undefined) throw new Error('TEMPLATE_NOT_FOUND');
      if (row.status === 'archived') throw new Error('TEMPLATE_ARCHIVED');

      const next = {
        title: patch.title !== undefined ? patch.title.trim() : row.title,
        personaConfig: patch.personaConfig !== undefined
          ? this.validatePersonaOrThrow(patch.personaConfig)
          : row.persona_config,
        knowledgeVersions: patch.knowledgeVersions ?? row.knowledge_versions ?? [],
        scoringRules: patch.scoringRules ?? row.scoring_rules ?? [],
        agentConfig: patch.agentConfig !== undefined
          ? this.validateAgentConfigOrThrow(patch.agentConfig)
          : normalizeAgentConfig(row.agent_config),
        learnerOverridePolicy: patch.learnerOverridePolicy !== undefined
          ? this.validatePolicyOrThrow(patch.learnerOverridePolicy)
          : normalizeLearnerOverridePolicy(row.learner_override_policy),
        recommendedScoringTemplateIds: patch.recommendedScoringTemplateIds ?? row.recommended_scoring_template_ids ?? [],
      };

      await client.query(
        `UPDATE training_template SET
           title = $1, persona_config = $2::jsonb, knowledge_versions = $3::jsonb,
           scoring_rules = $4::jsonb, agent_config = $5::jsonb,
           learner_override_policy = $6::jsonb, recommended_scoring_template_ids = $7::jsonb,
           updated_at = CURRENT_TIMESTAMP
         WHERE organization_id = $8 AND id = $9 AND scope = 'organization'`,
        [
          next.title, JSON.stringify(next.personaConfig), JSON.stringify(next.knowledgeVersions),
          JSON.stringify(next.scoringRules), JSON.stringify(next.agentConfig),
          JSON.stringify(next.learnerOverridePolicy), JSON.stringify(next.recommendedScoringTemplateIds),
          principal.organizationId, templateId,
        ],
      );

      const nextRevision = (row.current_revision ?? 0) + 1;
      const revisionId = crypto.randomUUID();
      await client.query(
        `INSERT INTO training_template_revision (
           id, organization_id, template_id, revision, title, persona_config,
           knowledge_versions, scoring_rules, agent_config, learner_override_policy, created_by
         ) VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7::jsonb, $8::jsonb, $9::jsonb, $10::jsonb, $11)`,
        [
          revisionId, principal.organizationId, templateId, nextRevision, next.title,
          JSON.stringify(next.personaConfig), JSON.stringify(next.knowledgeVersions),
          JSON.stringify(next.scoringRules), JSON.stringify(next.agentConfig),
          JSON.stringify(next.learnerOverridePolicy), principal.principalId,
        ],
      );
      await client.query('COMMIT');
      return this.requireOrganizationTemplate(principal, templateId);
    } catch (error) {
      await client.query('ROLLBACK');
      if (isUniqueViolation(error)) throw new Error('TEMPLATE_TITLE_CONFLICT');
      throw error;
    } finally {
      client.release();
    }
  }

  /** 复制组织模板：新 templateId + revision 1，内容取当前版本（spec §5.1）。 */
  async duplicateOrganizationTemplate(principal: CurrentPrincipal, templateId: string): Promise<TemplateView> {
    const client = await this.database.connect();
    try {
      await client.query('BEGIN');
      const current = await client.query<TemplateRow>(
        `SELECT ${SELECT_COLUMNS}
         FROM training_template t
         WHERE organization_id = $1 AND id = $2 AND scope = 'organization'
         FOR UPDATE`,
        [principal.organizationId, templateId],
      );
      const row = current.rows[0];
      if (row === undefined) throw new Error('TEMPLATE_NOT_FOUND');
      const newId = crypto.randomUUID();
      await client.query(
        `INSERT INTO training_template (
           id, organization_id, scope, owner_learner_id, title, persona_config,
           knowledge_versions, scoring_rules, agent_config, learner_override_policy,
           visible, recommended, status
         ) VALUES ($1, $2, 'organization', NULL, $3, $4::jsonb, $5::jsonb, $6::jsonb, $7::jsonb, $8::jsonb, $9, $10, 'active')`,
        [
          newId, principal.organizationId, `${row.title}（副本）`,
          JSON.stringify(row.persona_config), JSON.stringify(row.knowledge_versions ?? []),
          JSON.stringify(row.scoring_rules ?? []), JSON.stringify(normalizeAgentConfig(row.agent_config)),
          JSON.stringify(normalizeLearnerOverridePolicy(row.learner_override_policy)),
          true, false,
        ],
      );
      await client.query(
        `INSERT INTO training_template_revision (
           id, organization_id, template_id, revision, title, persona_config,
           knowledge_versions, scoring_rules, agent_config, learner_override_policy, created_by
         ) VALUES ($1, $2, $3, 1, $4, $5::jsonb, $6::jsonb, $7::jsonb, $8::jsonb, $9::jsonb, $10)`,
        [
          crypto.randomUUID(), principal.organizationId, newId, `${row.title}（副本）`,
          JSON.stringify(row.persona_config), JSON.stringify(row.knowledge_versions ?? []),
          JSON.stringify(row.scoring_rules ?? []), JSON.stringify(normalizeAgentConfig(row.agent_config)),
          JSON.stringify(normalizeLearnerOverridePolicy(row.learner_override_policy)), principal.principalId,
        ],
      );
      await client.query('COMMIT');
      return this.requireOrganizationTemplate(principal, newId);
    } catch (error) {
      await client.query('ROLLBACK');
      if (isUniqueViolation(error)) throw new Error('TEMPLATE_TITLE_CONFLICT');
      throw error;
    } finally {
      client.release();
    }
  }

  /** Archive (hide from learners) or reactivate an organization template. */
  async setOrganizationTemplateStatus(principal: CurrentPrincipal, templateId: string, status: 'active' | 'archived'): Promise<TemplateView> {
    const { rows } = await this.database.query<TemplateRow>(
      `UPDATE training_template SET status = $1, updated_at = CURRENT_TIMESTAMP
       WHERE organization_id = $2 AND id = $3 AND scope = 'organization'
       RETURNING ${SELECT_COLUMNS.replace(/\bt\./g, '')}`,
      [status, principal.organizationId, templateId],
    );
    const row = rows[0];
    if (row === undefined) throw new Error('TEMPLATE_NOT_FOUND');
    return toView(row);
  }

  /** 查看模板 revision 历史（spec §6.2）。 */
  async listTemplateRevisions(principal: CurrentPrincipal, templateId: string): Promise<readonly TemplateRevisionView[]> {
    const { rows } = await this.database.query<TemplateRevisionView>(
      `SELECT id AS "revisionId", template_id AS "templateId", revision, title,
              persona_config AS "personaConfig", knowledge_versions AS "knowledgeVersions",
              scoring_rules AS "scoringRules", agent_config AS "agentConfig",
              learner_override_policy AS "learnerOverridePolicy", created_by AS "createdBy", created_at AS "createdAt"
       FROM training_template_revision
       WHERE organization_id = $1 AND template_id = $2
       ORDER BY revision DESC`,
      [principal.organizationId, templateId],
    );
    return rows.map((row) => ({
      ...row,
      agentConfig: normalizeAgentConfig(row.agentConfig),
      learnerOverridePolicy: normalizeLearnerOverridePolicy(row.learnerOverridePolicy),
    }));
  }

  /** 加载指定 revision（组织隔离 + 存在性校验），供场景绑定与发布冻结使用。 */
  async getTemplateRevision(principal: CurrentPrincipal, templateId: string, revisionId: string): Promise<TemplateRevisionView> {
    const { rows } = await this.database.query<TemplateRevisionView>(
      `SELECT r.id AS "revisionId", r.template_id AS "templateId", r.revision, r.title,
              r.persona_config AS "personaConfig", r.knowledge_versions AS "knowledgeVersions",
              r.scoring_rules AS "scoringRules", r.agent_config AS "agentConfig",
              r.learner_override_policy AS "learnerOverridePolicy", r.created_by AS "createdBy", r.created_at AS "createdAt"
       FROM training_template_revision r
       JOIN training_template t ON t.organization_id = r.organization_id AND t.id = r.template_id
       WHERE r.organization_id = $1 AND r.template_id = $2 AND r.id = $3`,
      [principal.organizationId, templateId, revisionId],
    );
    const row = rows[0];
    if (row === undefined) throw new Error('TEMPLATE_REVISION_NOT_FOUND');
    return {
      ...row,
      agentConfig: normalizeAgentConfig(row.agentConfig),
      learnerOverridePolicy: normalizeLearnerOverridePolicy(row.learnerOverridePolicy),
    };
  }

  /** 查看哪些场景绑定了当前模板的指定（或最新）revision（spec §6.2）。 */
  async listTemplateScenarioBindings(principal: CurrentPrincipal, templateId: string): Promise<readonly { readonly draftId: string; readonly title: string; readonly revisionId: string | null; readonly revision: number | null }[]> {
    const { rows } = await this.database.query<{
      draft_id: string;
      title: string;
      revision_id: string | null;
      revision: number | null;
    }>(
      `SELECT d.id AS draft_id, d.title,
              d.payload -> 'personaSource' ->> 'revisionId' AS revision_id,
              (d.payload -> 'personaSource' ->> 'revision')::int AS revision
       FROM scenario_draft d
       WHERE d.organization_id = $1
         AND d.payload -> 'personaSource' ->> 'kind' = 'template_revision'
         AND d.payload -> 'personaSource' ->> 'templateId' = $2`,
      [principal.organizationId, templateId],
    );
    return rows.map((row) => ({
      draftId: row.draft_id,
      title: row.title,
      revisionId: row.revision_id,
      revision: row.revision,
    }));
  }

  /** 计算两个 revision 的字段差异（spec §6.2）。 */
  async diffTemplateRevisions(
    principal: CurrentPrincipal,
    templateId: string,
    revisionA: number,
    revisionB: number,
  ): Promise<readonly TemplateRevisionDiffEntry[]> {
    const { rows } = await this.database.query<{ persona_config: unknown; knowledge_versions: unknown; scoring_rules: unknown; agent_config: unknown; learner_override_policy: unknown }>(
      `SELECT persona_config, knowledge_versions, scoring_rules, agent_config, learner_override_policy
       FROM training_template_revision
       WHERE organization_id = $1 AND template_id = $2 AND revision IN ($3, $4)
       ORDER BY revision ASC`,
      [principal.organizationId, templateId, revisionA, revisionB],
    );
    if (rows.length !== 2) throw new Error('TEMPLATE_REVISION_NOT_FOUND');
    const [older, newer] = rows as [typeof rows[0], typeof rows[0]];
    const before: OrganizationTemplateRevisionV1 = {
      revisionId: '',
      templateId,
      revision: revisionA,
      title: '',
      personaConfig: older.persona_config as PersonaConfig,
      knowledgeVersions: (older.knowledge_versions as readonly string[]) ?? [],
      scoringRules: (older.scoring_rules as readonly string[]) ?? [],
      agentConfig: normalizeAgentConfig(older.agent_config),
      learnerOverridePolicy: normalizeLearnerOverridePolicy(older.learner_override_policy),
      createdBy: '',
      createdAt: '',
    };
    const after: OrganizationTemplateRevisionV1 = {
      ...before,
      revision: revisionB,
      personaConfig: newer.persona_config as PersonaConfig,
      knowledgeVersions: (newer.knowledge_versions as readonly string[]) ?? [],
      scoringRules: (newer.scoring_rules as readonly string[]) ?? [],
      agentConfig: normalizeAgentConfig(newer.agent_config),
      learnerOverridePolicy: normalizeLearnerOverridePolicy(newer.learner_override_policy),
    };
    return diffRevisions(before, after);
  }

  private async requireOrganizationTemplate(principal: CurrentPrincipal, templateId: string): Promise<TemplateView> {
    const { rows } = await this.database.query<TemplateRow>(
      `SELECT ${SELECT_COLUMNS}
       FROM training_template t
       WHERE organization_id = $1 AND id = $2 AND scope = 'organization'`,
      [principal.organizationId, templateId],
    );
    const row = rows[0];
    if (row === undefined) throw new Error('TEMPLATE_NOT_FOUND');
    return toView(row);
  }

  private validatePersonaOrThrow(raw: unknown): PersonaConfig {
    const validation = this.personas.validatePersonaConfig(raw);
    if (!validation.valid) throw new Error('PERSONA_CONFIG_INVALID');
    return raw as PersonaConfig;
  }

  private validateAgentConfigOrThrow(raw: unknown): AgentConfigV1 {
    const validation = validateAgentConfigV1(raw);
    if (!validation.valid) throw new Error('AGENT_CONFIG_INVALID');
    return raw as AgentConfigV1;
  }

  private validatePolicyOrThrow(raw: unknown): LearnerOverridePolicyV1 {
    const validation = validateLearnerOverridePolicy(raw);
    if (!validation.valid) throw new Error('LEARNER_OVERRIDE_POLICY_INVALID');
    return raw as LearnerOverridePolicyV1;
  }

  private async ensureLearnerProfile(client: PoolClient, principal: CurrentPrincipal, learnerId: string): Promise<void> {
    await client.query(
      `INSERT INTO learner_profile (internal_learner_id, organization_id, external_principal_id, identity_provider)
       VALUES ($1, $2, $3, 'gongzhugou')
       ON CONFLICT (organization_id, internal_learner_id) DO NOTHING`,
      [learnerId, principal.organizationId, principal.principalId],
    );
  }

  private validateTemplateInput(input: CreateTemplateInput): PersonaConfig {
    if (typeof input.title !== 'string' || input.title.trim().length === 0) {
      throw new Error('SCHEMA_INVALID');
    }
    return this.validatePersonaOrThrow(input.personaConfig);
  }

  private async insertTemplate(
    client: PoolClient,
    organizationId: string,
    scope: TemplateScope,
    ownerLearnerId: string | null,
    input: CreateTemplateInput,
  ): Promise<TemplateView> {
    const personaConfig = this.validateTemplateInput(input);
    const agentConfig = this.validateAgentConfigOrThrow(input.agentConfig ?? {});
    const policy = this.validatePolicyOrThrow(input.learnerOverridePolicy ?? DEFAULT_LEARNER_OVERRIDE_POLICY);
    const id = crypto.randomUUID();
    try {
      const { rows } = await client.query<TemplateRow>(
        `INSERT INTO training_template (
           id, organization_id, scope, owner_learner_id, title, persona_config,
           knowledge_versions, scoring_rules, agent_config, learner_override_policy, status
         )
         VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7::jsonb, $8::jsonb, $9::jsonb, $10::jsonb, 'active')
         RETURNING ${SELECT_COLUMNS.replace(/\bt\./g, '')}`,
        [
          id,
          organizationId,
          scope,
          ownerLearnerId,
          input.title.trim(),
          JSON.stringify(personaConfig),
          JSON.stringify(input.knowledgeVersions ?? []),
          JSON.stringify(input.scoringRules ?? []),
          JSON.stringify(agentConfig),
          JSON.stringify(policy),
        ],
      );
      const row = rows[0];
      if (row === undefined) {
        throw new Error('TEMPLATE_NOT_FOUND');
      }
      return toView(row);
    } catch (error) {
      if (isUniqueViolation(error)) {
        throw new Error('TEMPLATE_TITLE_CONFLICT');
      }
      throw error;
    }
  }
}

function toRevisionRow(view: TemplateView, principal: CurrentPrincipal, revision: number): OrganizationTemplateRevisionV1 {
  return {
    revisionId: crypto.randomUUID(),
    templateId: view.id,
    revision,
    title: view.title,
    personaConfig: view.personaConfig,
    knowledgeVersions: view.knowledgeVersions as readonly string[],
    scoringRules: view.scoringRules as readonly string[],
    agentConfig: view.agentConfig,
    learnerOverridePolicy: view.learnerOverridePolicy,
    createdBy: principal.principalId,
    createdAt: new Date().toISOString(),
  };
}
