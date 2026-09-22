import crypto from 'node:crypto';
import { isKnowledgeVersionReferenceV1, loadReleaseSnapshotSchemaV1, loadReleaseSnapshotSchemaV2, normalizeAgentConfig, normalizeLearnerOverridePolicy, } from '@training/contracts';
import { assertOrganizationScope } from '../identity/organization-context.js';
import { compileReleaseSnapshot, compileReleaseSnapshotV2, } from './release-compiler.js';
const releaseSnapshotSchema = loadReleaseSnapshotSchemaV1();
const releaseSnapshotV2Schema = loadReleaseSnapshotSchemaV2();
/**
 * 场景草稿与发布（spec §5.2、§5.3、§6.3）。
 *
 * - 草稿支持两种互斥人设来源：template_revision（绑定组织模板 revision）或 inline（独立完整人设）。
 * - 草稿阶段知识和评分允许为空；发布时至少各有一项（SCENARIO_RELEASE_INCOMPLETE）。
 * - 发布时解析并冻结完整配置为 release-snapshot/v2，自包含、可复现；
 *   旧 v1 草稿（缺 personaSource）在首次编辑/发布时被要求补齐人设来源（spec §10.6）。
 */
export class ScenarioService {
    database;
    templates;
    constructor(database, templates) {
        this.database = database;
        this.templates = templates;
    }
    async onModuleDestroy() {
        await this.database.end();
    }
    async createDraft(principal, input) {
        assertOrganizationScope(principal, input.organizationId);
        const id = input.id ?? crypto.randomUUID();
        await this.database.query(`INSERT INTO scenario_draft (id, organization_id, title, payload) VALUES ($1, $2, $3, $4::jsonb)`, [id, input.organizationId, input.payload.title, JSON.stringify(input.payload)]);
        return { id };
    }
    /** Organization-scoped draft list for the admin console, with published-version aggregates. */
    async listDrafts(principal) {
        const { rows } = await this.database.query(`SELECT d.id, d.title, d.version,
              d.payload -> 'personaSource' ->> 'kind' AS persona_source_kind,
              COALESCE(jsonb_array_length(d.payload -> 'knowledgeVersions'), 0) AS knowledge_count,
              COALESCE(jsonb_array_length(d.payload -> 'scoringRules'), 0) AS scoring_count,
              (SELECT COUNT(*)::int FROM release_snapshot rs
                 WHERE rs.scenario_draft_id = d.id AND rs.organization_id = d.organization_id) AS published_count,
              (SELECT rs2.id FROM release_snapshot rs2
                 WHERE rs2.scenario_draft_id = d.id AND rs2.organization_id = d.organization_id
                 ORDER BY rs2.created_at DESC, rs2.id DESC LIMIT 1) AS latest_snapshot_id,
              d.created_at, d.updated_at
       FROM scenario_draft d
       WHERE d.organization_id = $1
       ORDER BY d.updated_at DESC, d.id ASC`, [principal.organizationId]);
        return rows.map((row) => ({
            id: row.id,
            title: row.title,
            version: row.version,
            personaSourceKind: row.persona_source_kind,
            knowledgeCount: row.knowledge_count,
            scoringCount: row.scoring_count,
            publishedCount: row.published_count,
            latestSnapshotId: row.latest_snapshot_id,
            createdAt: row.created_at.toISOString(),
            updatedAt: row.updated_at.toISOString(),
        }));
    }
    /** Immutable released snapshots for the assignment picker; optionally narrowed to one draft. */
    async listSnapshots(principal, scenarioDraftId) {
        const conditions = ['rs.organization_id = $1'];
        const values = [principal.organizationId];
        if (scenarioDraftId !== undefined && scenarioDraftId !== '') {
            values.push(scenarioDraftId);
            conditions.push(`rs.scenario_draft_id = $${values.length}`);
        }
        const { rows } = await this.database.query(`SELECT rs.id, rs.scenario_draft_id, d.title, rs.is_active, rs.schema_version, rs.created_at,
              rs.snapshot -> 'personaSource' ->> 'kind' AS persona_source_kind,
              rs.snapshot -> 'personaConfig' ->> 'name' AS persona_name,
              rs.snapshot -> 'personaConfig' -> 'conversation' ->> 'productScenario' AS persona_product_scenario,
              (rs.snapshot -> 'personaConfig' -> 'conversation' ->> 'difficulty')::int AS persona_difficulty,
              t.title AS template_title,
              (rs.snapshot -> 'personaSource' ->> 'revision')::int AS template_revision,
              COALESCE(jsonb_array_length(rs.snapshot -> 'knowledgeVersions'), 0) AS knowledge_count,
              COALESCE(jsonb_array_length(rs.snapshot -> 'scoringRules'), 0) AS scoring_count,
              (rs.snapshot -> 'agentConfig' ->> 'historyMessageLimit')::int AS history_message_limit
       FROM release_snapshot rs
       JOIN scenario_draft d ON d.id = rs.scenario_draft_id AND d.organization_id = rs.organization_id
       LEFT JOIN training_template t ON t.organization_id = rs.organization_id
         AND t.id::text = rs.snapshot -> 'personaSource' ->> 'templateId'
       WHERE ${conditions.join(' AND ')}
       ORDER BY rs.created_at DESC, rs.id ASC`, values);
        return rows.map((row) => ({
            id: row.id,
            scenarioDraftId: row.scenario_draft_id,
            title: row.title,
            isActive: row.is_active,
            schemaVersion: row.schema_version,
            createdAt: row.created_at.toISOString(),
            personaSourceKind: row.persona_source_kind,
            personaName: row.persona_name,
            personaProductScenario: row.persona_product_scenario,
            personaDifficulty: row.persona_difficulty,
            templateTitle: row.template_title,
            templateRevision: row.template_revision,
            knowledgeCount: row.knowledge_count,
            scoringCount: row.scoring_count,
            historyMessageLimit: row.history_message_limit,
        }));
    }
    async updateDraft(principal, draftId, organizationId, patch) {
        assertOrganizationScope(principal, organizationId);
        const sets = [];
        const values = [];
        if (patch.title !== undefined) {
            values.push(patch.title);
            sets.push(`title = $${values.length}`);
        }
        const payloadPatch = {};
        if (patch.personaSource !== undefined)
            payloadPatch.personaSource = patch.personaSource;
        if (patch.knowledgeVersions !== undefined)
            payloadPatch.knowledgeVersions = patch.knowledgeVersions;
        if (patch.scoringRules !== undefined)
            payloadPatch.scoringRules = patch.scoringRules;
        if (patch.agentConfig !== undefined)
            payloadPatch.agentConfig = patch.agentConfig;
        if (Object.keys(payloadPatch).length > 0) {
            values.push(JSON.stringify(payloadPatch));
            sets.push(`payload = payload || $${values.length}::jsonb`);
        }
        if (sets.length === 0)
            return;
        values.push(draftId, organizationId);
        await this.database.query(`UPDATE scenario_draft SET ${sets.join(', ')}, updated_at = CURRENT_TIMESTAMP WHERE id = $${values.length - 1} AND organization_id = $${values.length}`, values);
    }
    /** 草稿校验：结构和字段合法性（不含发布级完整性要求；发布由 publishDraft 单独强校验）。 */
    async validateDraft(principal, draftId, client) {
        const queryable = client ?? this.database;
        const { rows } = await queryable.query(`SELECT organization_id, payload FROM scenario_draft WHERE id = $1`, [draftId]);
        const draft = rows[0];
        if (draft === undefined) {
            return { valid: false, errors: [{ path: '$', reason: 'SCENARIO_DRAFT_NOT_FOUND' }] };
        }
        assertOrganizationScope(principal, draft.organization_id);
        const payload = draft.payload;
        const errors = [];
        if (typeof payload.title !== 'string' || payload.title.length === 0) {
            errors.push({ path: 'title', reason: 'title is required' });
        }
        if (payload.knowledgeVersions !== undefined) {
            if (!Array.isArray(payload.knowledgeVersions)) {
                errors.push({ path: 'knowledgeVersions', reason: 'must be an array' });
            }
            else if (!payload.knowledgeVersions.every(isKnowledgeVersionReferenceV1)) {
                errors.push({ path: 'knowledgeVersions', reason: 'entries must be itemId@version references' });
            }
        }
        if (payload.scoringRules !== undefined && !Array.isArray(payload.scoringRules)) {
            errors.push({ path: 'scoringRules', reason: 'must be an array' });
        }
        if (payload.agentConfig !== undefined && (typeof payload.agentConfig !== 'object' || payload.agentConfig === null)) {
            errors.push({ path: 'agentConfig', reason: 'must be an object' });
        }
        if (payload.personaSource !== undefined) {
            const sourceErrors = validatePersonaSource(payload.personaSource);
            errors.push(...sourceErrors);
        }
        return { valid: errors.length === 0, errors };
    }
    /** 发布校验：知识与评分至少各有一项 + 人设来源完整 + 字段合法（spec §6.3、§9.2 SCENARIO_RELEASE_INCOMPLETE）。 */
    async validateDraftForRelease(principal, draftId, client) {
        const base = await this.validateDraft(principal, draftId, client);
        if (!base.valid)
            return base;
        const queryable = client ?? this.database;
        const { rows } = await queryable.query(`SELECT payload FROM scenario_draft WHERE id = $1`, [draftId]);
        const payload = rows[0]?.payload;
        if (payload === undefined)
            return { valid: false, errors: [{ path: '$', reason: 'SCENARIO_DRAFT_NOT_FOUND' }] };
        const errors = [...base.errors];
        if (!Array.isArray(payload.knowledgeVersions) || payload.knowledgeVersions.length === 0) {
            errors.push({ path: 'knowledgeVersions', reason: '发布时至少需要一项知识版本' });
        }
        if (!Array.isArray(payload.scoringRules) || payload.scoringRules.length === 0) {
            errors.push({ path: 'scoringRules', reason: '发布时至少需要一项评分规则' });
        }
        if (payload.personaSource === undefined) {
            errors.push({ path: 'personaSource', reason: '发布前必须选择人设来源（模板 revision 或独立配置）' });
        }
        return { valid: errors.length === 0, errors };
    }
    async getDraftForOrganization(principal, draftId) {
        const { rows } = await this.database.query(`SELECT id, organization_id AS "organizationId", title, payload FROM scenario_draft WHERE id = $1 AND organization_id = $2`, [draftId, principal.organizationId]);
        return rows[0];
    }
    async getDraftById(draftId) {
        const { rows } = await this.database.query(`SELECT id, organization_id AS "organizationId", title, payload FROM scenario_draft WHERE id = $1`, [draftId]);
        return rows[0];
    }
    /** 升级场景绑定到模板最新 revision（spec §6.3：模板产生新 revision 时不会自动漂移，可显式升级）。 */
    async upgradeDraftToLatestRevision(principal, draftId) {
        const client = await this.database.connect();
        try {
            await client.query('BEGIN');
            const draftResult = await client.query(`SELECT organization_id, payload FROM scenario_draft WHERE id = $1 FOR UPDATE`, [draftId]);
            const draft = draftResult.rows[0];
            if (draft === undefined)
                throw new Error('SCENARIO_DRAFT_NOT_FOUND');
            assertOrganizationScope(principal, draft.organization_id);
            const source = draft.payload.personaSource;
            if (source === undefined || source.kind !== 'template_revision') {
                throw new Error('SCENARIO_PERSONA_SOURCE_NOT_TEMPLATE');
            }
            const revisions = await this.templates.listTemplateRevisions(principal, source.templateId);
            const latest = revisions[0];
            if (latest === undefined)
                throw new Error('TEMPLATE_REVISION_NOT_FOUND');
            if (latest.revision === source.revision) {
                await client.query('COMMIT');
                return { updated: false };
            }
            await client.query(`UPDATE scenario_draft SET payload = jsonb_set(
           payload,
           '{personaSource}',
           $2::jsonb,
           true
         ), updated_at = CURRENT_TIMESTAMP
         WHERE id = $1 AND organization_id = $3`, [
                draftId,
                JSON.stringify({
                    kind: 'template_revision',
                    templateId: source.templateId,
                    revisionId: latest.revisionId,
                    revision: latest.revision,
                }),
                principal.organizationId,
            ]);
            await client.query('COMMIT');
            return { updated: true };
        }
        catch (error) {
            await client.query('ROLLBACK');
            throw error;
        }
        finally {
            client.release();
        }
    }
    /** 发布：解析人设来源 → 校验 → 冻结 v2 快照（spec §5.3、§10.4、§10.5）。 */
    async publishDraft(principal, draftId) {
        const client = await this.database.connect();
        try {
            await client.query('BEGIN');
            const draftResult = await client.query(`SELECT id, organization_id AS "organizationId", title, payload FROM scenario_draft WHERE id = $1 FOR UPDATE`, [draftId]);
            const draft = draftResult.rows[0];
            if (draft === undefined)
                throw new Error('SCENARIO_DRAFT_NOT_FOUND');
            assertOrganizationScope(principal, draft.organizationId);
            const validation = await this.validateDraftForRelease(principal, draftId, client);
            if (!validation.valid) {
                throw new Error(`SCENARIO_RELEASE_INCOMPLETE: ${validation.errors.map((e) => `${e.path}:${e.reason}`).join('; ')}`);
            }
            const snapshot = await this.compileV2Snapshot(principal, draft);
            if (!releaseSnapshotV2Schema.validate(snapshot)) {
                throw new Error('SCENARIO_INVALID_RELEASE');
            }
            await client.query(`INSERT INTO release_snapshot (id, scenario_draft_id, organization_id, schema_version, snapshot) VALUES ($1, $2, $3, $4, $5::jsonb)`, [snapshot.releaseSnapshotId, draft.id, draft.organizationId, snapshot.schemaVersion, JSON.stringify(snapshot)]);
            await client.query(`INSERT INTO outbox_event (id, organization_id, aggregate_type, aggregate_id, event_type, payload, deduplication_key, status) VALUES ($1, $2, 'scenario_draft', $3, 'release.published', $4::jsonb, $5, 'pending')`, [crypto.randomUUID(), draft.organizationId, draft.id, JSON.stringify(snapshot), `release.published:${snapshot.releaseSnapshotId}`]);
            await client.query('COMMIT');
            return { snapshotId: snapshot.releaseSnapshotId, schemaVersion: snapshot.schemaVersion };
        }
        catch (error) {
            await client.query('ROLLBACK');
            throw error;
        }
        finally {
            client.release();
        }
    }
    /** 兼容读取 v1 快照（旧代码路径保留）。 */
    async loadV1Snapshot(releaseSnapshotId) {
        const { rows } = await this.database.query('SELECT snapshot FROM release_snapshot WHERE id = $1', [releaseSnapshotId]);
        if (rows[0] === undefined)
            throw new Error('RELEASE_SNAPSHOT_NOT_FOUND');
        const snapshot = rows[0].snapshot;
        if (!releaseSnapshotSchema.validate(snapshot))
            throw new Error('RELEASE_SNAPSHOT_INVALID');
        return snapshot;
    }
    async compileV2Snapshot(principal, draft) {
        const source = draft.payload.personaSource;
        if (source === undefined) {
            throw new Error('SCENARIO_RELEASE_INCOMPLETE: personaSource is required');
        }
        let personaConfig;
        let personaSource;
        let agentConfig;
        let learnerOverridePolicy;
        if (source.kind === 'template_revision') {
            const revision = await this.loadRevisionForRelease(principal, source);
            personaConfig = revision.personaConfig;
            personaSource = { kind: 'template_revision', templateId: source.templateId, revisionId: source.revisionId, revision: source.revision };
            agentConfig = revision.agentConfig;
            learnerOverridePolicy = revision.learnerOverridePolicy;
        }
        else {
            personaConfig = source.personaConfig;
            personaSource = { kind: 'inline', personaConfig };
            agentConfig = normalizeAgentConfig(draft.payload.agentConfig);
            learnerOverridePolicy = normalizeLearnerOverridePolicy(undefined);
        }
        return compileReleaseSnapshotV2({
            draft,
            compiledBy: principal.principalId,
            personaConfig,
            personaSource,
            agentConfig,
            learnerOverridePolicy,
        });
    }
    async loadRevisionForRelease(principal, source) {
        // revisionId 是内部指针，客户端只保证提供 templateId + revision（业务稳定键）；
        // 缺 revisionId 时按版本号解析，保证发布冻结到确定版本（spec §6.3 不自动漂移）。
        const revisionId = typeof source.revisionId === 'string' && source.revisionId.length > 0
            ? source.revisionId
            : await this.resolveRevisionId(principal, source.templateId, source.revision);
        const template = await this.templates.getTemplateRevision(principal, source.templateId, revisionId);
        if (template.revision !== source.revision) {
            throw new Error('TEMPLATE_REVISION_NOT_FOUND');
        }
        return template;
    }
    async resolveRevisionId(principal, templateId, revision) {
        const revisions = await this.templates.listTemplateRevisions(principal, templateId);
        const match = revisions.find((entry) => entry.revision === revision);
        if (match === undefined)
            throw new Error('TEMPLATE_REVISION_NOT_FOUND');
        return match.revisionId;
    }
}
function validatePersonaSource(value) {
    if (typeof value !== 'object' || value === null) {
        return [{ path: 'personaSource', reason: 'must be an object' }];
    }
    const candidate = value;
    if (candidate.kind === 'template_revision') {
        const errors = [];
        if (typeof candidate.templateId !== 'string' || candidate.templateId.length === 0) {
            errors.push({ path: 'personaSource.templateId', reason: 'templateId is required' });
        }
        // revisionId 为内部指针，允许缺省：发布时按 templateId + revision 解析（见 loadRevisionForRelease）。
        if (candidate.revisionId !== undefined && (typeof candidate.revisionId !== 'string' || candidate.revisionId.length === 0)) {
            errors.push({ path: 'personaSource.revisionId', reason: 'revisionId must be a non-empty string when present' });
        }
        if (typeof candidate.revision !== 'number' || !Number.isInteger(candidate.revision) || candidate.revision < 1) {
            errors.push({ path: 'personaSource.revision', reason: 'revision must be a positive integer' });
        }
        return errors;
    }
    if (candidate.kind === 'inline') {
        if (typeof candidate.personaConfig !== 'object' || candidate.personaConfig === null) {
            return [{ path: 'personaSource.personaConfig', reason: 'inline personaConfig is required' }];
        }
        return [];
    }
    return [{ path: 'personaSource.kind', reason: 'must be template_revision or inline' }];
}
