import { deriveLearnerId } from '../assignments/eligibility.service.js';
import { SalesEvaluator } from './sales-evaluator.js';
const ADMIN_EVALUATION_JOIN = `
  FROM evaluation_report er
  JOIN conversation c ON c.organization_id = er.organization_id AND c.id = er.conversation_id
  JOIN training_session ts ON ts.organization_id = c.organization_id AND ts.id = c.training_session_id
  LEFT JOIN learner_profile lp ON lp.organization_id = ts.organization_id AND lp.internal_learner_id = ts.learner_id
  LEFT JOIN release_snapshot rs ON rs.organization_id = ts.organization_id AND rs.id = ts.release_snapshot_id
  LEFT JOIN scenario_draft sd ON sd.organization_id = rs.organization_id AND sd.id = rs.scenario_draft_id
  LEFT JOIN assignment a ON a.organization_id = ts.organization_id AND a.id = ts.assignment_id`;
const ADMIN_EVALUATION_COLUMNS = `
  er.id AS "evaluationId",
  er.conversation_id AS "conversationId",
  ts.learner_id AS "learnerId",
  lp.external_principal_id AS "principalId",
  lp.display_name AS "displayName",
  ts.source_type AS "sourceType",
  ts.mode AS "mode",
  sd.title AS "scenarioTitle",
  a.name AS "assignmentName",
  er.report->>'score' AS "scoreRaw",
  ts.started_at AS "sessionStartedAtRaw",
  er.created_at AS "evaluatedAtRaw"`;
function toIso(value) {
    if (value === null || value === undefined)
        return null;
    return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
}
function toNumber(value) {
    if (value === null || value === undefined || value === '')
        return null;
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
}
/** 从持久化的 MessageResponse（response_hash JSONB）中安全取出 AI 回复文本。 */
function readAssistantReply(serialized) {
    if (serialized === null)
        return null;
    try {
        const parsed = JSON.parse(serialized);
        if (typeof parsed !== 'object' || parsed === null)
            return null;
        const suggestion = parsed.suggestion;
        if (typeof suggestion !== 'object' || suggestion === null)
            return null;
        const replyText = suggestion.replyText;
        return typeof replyText === 'string' && replyText.length > 0 ? replyText : null;
    }
    catch {
        return null;
    }
}
function toAdminEvaluationItem(row) {
    return {
        evaluationId: row.evaluationId,
        conversationId: row.conversationId,
        learnerId: row.learnerId,
        principalId: row.principalId ?? null,
        displayName: row.displayName ?? null,
        sourceType: row.sourceType,
        mode: row.mode,
        scenarioTitle: row.scenarioTitle ?? null,
        assignmentName: row.assignmentName ?? null,
        score: toNumber(row.scoreRaw),
        sessionStartedAt: toIso(row.sessionStartedAtRaw),
        evaluatedAt: toIso(row.evaluatedAtRaw) ?? '',
    };
}
export class EvaluationService {
    database;
    salesEvaluator;
    constructor(database, model) {
        this.database = database;
        if (model) {
            this.salesEvaluator = new SalesEvaluator(model);
        }
    }
    onModuleDestroy() {
        return this.database.end();
    }
    async evaluateSalesPerformance(input) {
        if (!this.salesEvaluator) {
            return undefined;
        }
        return this.salesEvaluator.evaluate(input.conversationId, input.messages, input.personaConfig);
    }
    async getForLearner(principal, conversationId) {
        const { rows } = await this.database.query(`SELECT report.id, report.organization_id AS "organizationId", report.conversation_id AS "conversationId",
              report.evaluation_job_id AS "evaluationJobId", report.report, report.created_at AS "createdAt"
       FROM evaluation_report report
       JOIN conversation ON conversation.id = report.conversation_id AND conversation.organization_id = report.organization_id
       JOIN training_session ts ON ts.id = conversation.training_session_id AND ts.organization_id = conversation.organization_id
       WHERE report.conversation_id = $1 AND report.organization_id = $2 AND ts.learner_id = $3`, [conversationId, principal.organizationId, deriveLearnerId(principal.principalId)]);
        return rows[0];
    }
    /** A queued/running job is a normal transient state, not a missing-report error. */
    async getPendingStatusForLearner(principal, conversationId) {
        const { rows } = await this.database.query(`SELECT job.status
       FROM evaluation_job job
       JOIN conversation c ON c.id = job.conversation_id AND c.organization_id = job.organization_id
       JOIN training_session ts ON ts.id = c.training_session_id AND ts.organization_id = c.organization_id
       WHERE job.conversation_id = $1
         AND job.organization_id = $2
         AND ts.learner_id = $3
         AND job.status IN ('queued', 'running')`, [conversationId, principal.organizationId, deriveLearnerId(principal.principalId)]);
        return rows[0]?.status;
    }
    async listForOrganization(principal) {
        const { rows } = await this.database.query(`SELECT id, organization_id AS "organizationId", conversation_id AS "conversationId",
              evaluation_job_id AS "evaluationJobId", report, created_at AS "createdAt"
       FROM evaluation_report WHERE organization_id = $1 ORDER BY created_at DESC`, [principal.organizationId]);
        return rows;
    }
    /**
     * 管理端复盘列表：评估报告 JOIN 训练会话/学员画像/场景/任务，输出运营可读的业务字段，
     * 支持按来源（自由练习/团队任务）、学员筛选与分页；严格按组织隔离。
     */
    async listAdminEvaluations(principal, query) {
        const conditions = ['er.organization_id = $1'];
        const params = [principal.organizationId];
        if (query.source !== undefined) {
            params.push(query.source);
            conditions.push(`ts.source_type = $${params.length}`);
        }
        if (query.learnerId !== undefined) {
            params.push(query.learnerId);
            conditions.push(`ts.learner_id = $${params.length}`);
        }
        const whereClause = `WHERE ${conditions.join(' AND ')}`;
        const countResult = await this.database.query(`SELECT COUNT(*)::text AS count ${ADMIN_EVALUATION_JOIN} ${whereClause}`, params);
        params.push(query.limit, query.offset);
        const limitIndex = `$${params.length - 1}`;
        const offsetIndex = `$${params.length}`;
        const listResult = await this.database.query(`SELECT ${ADMIN_EVALUATION_COLUMNS} ${ADMIN_EVALUATION_JOIN} ${whereClause}
       ORDER BY er.created_at DESC, er.id DESC
       LIMIT ${limitIndex} OFFSET ${offsetIndex}`, params);
        return {
            items: listResult.rows.map(toAdminEvaluationItem),
            total: Number(countResult.rows[0]?.count ?? 0),
            limit: query.limit,
            offset: query.offset,
        };
    }
    /** 管理端单场对话回放：会话元信息 + 有序 learner/assistant 轮次 + 评估报告（可能尚未评分）。 */
    async getConversationReplay(principal, conversationId) {
        const metaResult = await this.database.query(`SELECT c.id AS "conversationId", c.status,
              ts.source_type AS "sourceType", ts.mode,
              ts.learner_id AS "learnerId",
              lp.external_principal_id AS "principalId", lp.display_name AS "displayName",
              sd.title AS "scenarioTitle", a.name AS "assignmentName",
              ts.started_at AS "startedAtRaw", ts.finished_at AS "finishedAtRaw"
       FROM conversation c
       JOIN training_session ts ON ts.organization_id = c.organization_id AND ts.id = c.training_session_id
       LEFT JOIN learner_profile lp ON lp.organization_id = ts.organization_id AND lp.internal_learner_id = ts.learner_id
       LEFT JOIN release_snapshot rs ON rs.organization_id = ts.organization_id AND rs.id = ts.release_snapshot_id
       LEFT JOIN scenario_draft sd ON sd.organization_id = rs.organization_id AND sd.id = rs.scenario_draft_id
       LEFT JOIN assignment a ON a.organization_id = ts.organization_id AND a.id = ts.assignment_id
       WHERE c.id = $1 AND c.organization_id = $2`, [conversationId, principal.organizationId]);
        const meta = metaResult.rows[0];
        if (meta === undefined)
            throw new Error('CONVERSATION_NOT_FOUND');
        const messageResult = await this.database.query(`SELECT sequence, content, response_hash AS "responseHash"
       FROM conversation_message
       WHERE conversation_id = $1 AND organization_id = $2
       ORDER BY sequence ASC, created_at ASC`, [conversationId, principal.organizationId]);
        const messages = [];
        for (const row of messageResult.rows) {
            messages.push({ role: 'learner', sequence: row.sequence, content: row.content });
            const assistantText = readAssistantReply(row.responseHash);
            if (assistantText !== null) {
                messages.push({ role: 'assistant', sequence: row.sequence, content: assistantText });
            }
        }
        const reportResult = await this.database.query(`SELECT report FROM evaluation_report WHERE conversation_id = $1 AND organization_id = $2`, [conversationId, principal.organizationId]);
        return {
            conversationId: meta.conversationId,
            status: meta.status,
            sourceType: meta.sourceType,
            mode: meta.mode,
            learnerId: meta.learnerId,
            principalId: meta.principalId ?? null,
            displayName: meta.displayName ?? null,
            scenarioTitle: meta.scenarioTitle ?? null,
            assignmentName: meta.assignmentName ?? null,
            startedAt: toIso(meta.startedAtRaw),
            finishedAt: toIso(meta.finishedAtRaw),
            messages,
            report: reportResult.rows[0]?.report ?? null,
        };
    }
}
