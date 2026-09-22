const RECENT_SESSION_LIMIT = 20;
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
function toSummary(row) {
    return {
        learnerId: row.learnerId,
        principalId: row.principalId,
        displayName: row.displayName ?? null,
        identityProvider: row.identityProvider,
        totalFreeSessions: Number(row.totalFreeSessions),
        totalAssignedSessions: Number(row.totalAssignedSessions),
        avgScore: toNumber(row.avgScoreRaw),
        lastTrainedAt: toIso(row.lastTrainedAtRaw),
        createdAt: toIso(row.createdAtRaw) ?? '',
    };
}
const SELECT_COLUMNS = `
  internal_learner_id AS "learnerId",
  external_principal_id AS "principalId",
  display_name AS "displayName",
  identity_provider AS "identityProvider",
  total_free_sessions AS "totalFreeSessions",
  total_assigned_sessions AS "totalAssignedSessions",
  avg_score AS "avgScoreRaw",
  last_trained_at AS "lastTrainedAtRaw",
  created_at AS "createdAtRaw"`;
export class LearnerService {
    database;
    constructor(database) {
        this.database = database;
    }
    async onModuleDestroy() {
        await this.database.end();
    }
    /** 运营查看本组织学员档案列表，支持按账号/姓名模糊搜索与分页。 */
    async listLearners(principal, query) {
        const hasQuery = typeof query.q === 'string' && query.q.trim().length > 0;
        const term = hasQuery ? `%${query.q.trim()}%` : null;
        const filterClause = hasQuery
            ? 'AND (external_principal_id ILIKE $2 OR display_name ILIKE $2)'
            : '';
        const listParams = hasQuery
            ? [principal.organizationId, term, query.limit, query.offset]
            : [principal.organizationId, query.limit, query.offset];
        // 参数序号随是否有搜索词变化。
        const limitIndex = hasQuery ? '$3' : '$2';
        const offsetIndex = hasQuery ? '$4' : '$3';
        const countResult = await this.database.query(`SELECT COUNT(*)::text AS count FROM learner_profile
       WHERE organization_id = $1 ${filterClause}`, hasQuery ? [principal.organizationId, term] : [principal.organizationId]);
        const listResult = await this.database.query(`SELECT ${SELECT_COLUMNS}
       FROM learner_profile
       WHERE organization_id = $1 ${filterClause}
       ORDER BY last_trained_at DESC NULLS LAST, created_at DESC
       LIMIT ${limitIndex} OFFSET ${offsetIndex}`, listParams);
        return {
            items: listResult.rows.map(toSummary),
            total: Number(countResult.rows[0]?.count ?? 0),
            limit: query.limit,
            offset: query.offset,
        };
    }
    /** 单个学员成长档案：画像汇总 + 近 20 次训练（JOIN 场景/任务业务名、最近一次评分）。 */
    async getLearnerDetail(principal, learnerId) {
        const profileResult = await this.database.query(`SELECT ${SELECT_COLUMNS}, dimension_scores AS "dimensionScores", weak_points AS "weakPoints"
       FROM learner_profile
       WHERE organization_id = $1 AND internal_learner_id = $2`, [principal.organizationId, learnerId]);
        const profileRow = profileResult.rows[0];
        if (profileRow === undefined)
            throw new Error('LEARNER_PROFILE_NOT_FOUND');
        const sessionsResult = await this.database.query(`SELECT ts.id,
              ts.source_type AS "sourceType",
              ts.mode,
              ts.status,
              sd.title AS "scenarioTitle",
              a.name AS "assignmentName",
              (
                SELECT er.report->>'score'
                FROM conversation c
                JOIN evaluation_report er
                  ON er.organization_id = c.organization_id AND er.conversation_id = c.id
                WHERE c.organization_id = ts.organization_id AND c.training_session_id = ts.id
                ORDER BY er.created_at DESC
                LIMIT 1
              ) AS "scoreRaw",
              ts.started_at AS "startedAtRaw",
              ts.finished_at AS "finishedAtRaw"
       FROM training_session ts
       LEFT JOIN release_snapshot rs
         ON rs.organization_id = ts.organization_id AND rs.id = ts.release_snapshot_id
       LEFT JOIN scenario_draft sd
         ON sd.organization_id = rs.organization_id AND sd.id = rs.scenario_draft_id
       LEFT JOIN assignment a
         ON a.organization_id = ts.organization_id AND a.id = ts.assignment_id
       WHERE ts.organization_id = $1 AND ts.learner_id = $2
       ORDER BY ts.started_at DESC, ts.id DESC
       LIMIT ${RECENT_SESSION_LIMIT}`, [principal.organizationId, learnerId]);
        const recentSessions = sessionsResult.rows.map((row) => ({
            id: row.id,
            sourceType: row.sourceType,
            mode: row.mode,
            status: row.status,
            scenarioTitle: row.scenarioTitle ?? null,
            assignmentName: row.assignmentName ?? null,
            score: toNumber(row.scoreRaw),
            startedAt: toIso(row.startedAtRaw) ?? '',
            finishedAt: toIso(row.finishedAtRaw),
        }));
        return {
            ...toSummary(profileRow),
            dimensionScores: (profileRow.dimensionScores ?? {}),
            weakPoints: Array.isArray(profileRow.weakPoints) ? profileRow.weakPoints : [],
            recentSessions,
        };
    }
}
