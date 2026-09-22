import type { OnModuleDestroy } from '@nestjs/common';
import type { Pool, QueryResultRow } from 'pg';

import type { CurrentPrincipal } from '../identity/identity-context.js';

export interface LearnerListQuery {
  readonly q?: string;
  readonly limit: number;
  readonly offset: number;
}

export interface LearnerSummary {
  readonly learnerId: string;
  readonly principalId: string;
  readonly displayName: string | null;
  readonly identityProvider: string;
  readonly totalFreeSessions: number;
  readonly totalAssignedSessions: number;
  readonly avgScore: number | null;
  readonly lastTrainedAt: string | null;
  readonly createdAt: string;
}

export interface LearnerRecentSession {
  readonly id: string;
  readonly sourceType: 'free' | 'assigned';
  readonly mode: 'practice' | 'exam';
  readonly status: string;
  readonly scenarioTitle: string | null;
  readonly assignmentName: string | null;
  readonly score: number | null;
  readonly startedAt: string;
  readonly finishedAt: string | null;
}

export interface LearnerDetail extends LearnerSummary {
  readonly dimensionScores: Record<string, number>;
  readonly dimensionLabels?: Record<string, string>;
  readonly weakPoints: readonly string[];
  readonly recentSessions: readonly LearnerRecentSession[];
}

export interface LearnerListResult {
  readonly items: readonly LearnerSummary[];
  readonly total: number;
  readonly limit: number;
  readonly offset: number;
}

const RECENT_SESSION_LIMIT = 20;

function toIso(value: Date | string | null | undefined): string | null {
  if (value === null || value === undefined) return null;
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
}

function toNumber(value: unknown): number | null {
  if (value === null || value === undefined || value === '') return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function toSummary(row: QueryResultRow): LearnerSummary {
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

export class LearnerService implements OnModuleDestroy {
  public constructor(private readonly database: Pool) {}

  async onModuleDestroy(): Promise<void> {
    await this.database.end();
  }

  /** 运营查看本组织学员档案列表，支持按账号/姓名模糊搜索与分页。 */
  public async listLearners(principal: CurrentPrincipal, query: LearnerListQuery): Promise<LearnerListResult> {
    const hasQuery = typeof query.q === 'string' && query.q.trim().length > 0;
    const term = hasQuery ? `%${query.q!.trim()}%` : null;
    const filterClause = hasQuery
      ? 'AND (external_principal_id ILIKE $2 OR display_name ILIKE $2)'
      : '';
    const listParams: unknown[] = hasQuery
      ? [principal.organizationId, term, query.limit, query.offset]
      : [principal.organizationId, query.limit, query.offset];
    // 参数序号随是否有搜索词变化。
    const limitIndex = hasQuery ? '$3' : '$2';
    const offsetIndex = hasQuery ? '$4' : '$3';

    const countResult = await this.database.query<{ count: string }>(
      `SELECT COUNT(*)::text AS count FROM learner_profile
       WHERE organization_id = $1 ${filterClause}`,
      hasQuery ? [principal.organizationId, term] : [principal.organizationId],
    );
    const listResult = await this.database.query(
      `SELECT ${SELECT_COLUMNS}
       FROM learner_profile
       WHERE organization_id = $1 ${filterClause}
       ORDER BY last_trained_at DESC NULLS LAST, created_at DESC
       LIMIT ${limitIndex} OFFSET ${offsetIndex}`,
      listParams,
    );
    return {
      items: listResult.rows.map(toSummary),
      total: Number(countResult.rows[0]?.count ?? 0),
      limit: query.limit,
      offset: query.offset,
    };
  }

  /** 单个学员成长档案：画像汇总 + 近 20 次训练（JOIN 场景/任务业务名、最近一次评分）。 */
  public async getLearnerDetail(principal: CurrentPrincipal, learnerId: string): Promise<LearnerDetail> {
    const profileResult = await this.database.query(
      `SELECT ${SELECT_COLUMNS}, dimension_scores AS "dimensionScores", weak_points AS "weakPoints"
       FROM learner_profile
       WHERE organization_id = $1 AND internal_learner_id = $2`,
      [principal.organizationId, learnerId],
    );
    const profileRow = profileResult.rows[0];
    if (profileRow === undefined) throw new Error('LEARNER_PROFILE_NOT_FOUND');

    const sessionsResult = await this.database.query(
      `SELECT ts.id,
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
       LIMIT ${RECENT_SESSION_LIMIT}`,
      [principal.organizationId, learnerId],
    );

    const recentSessions: LearnerRecentSession[] = sessionsResult.rows.map((row) => ({
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

    // 查询组织内 active 状态的维度白名单（过滤掉逻辑删除/废弃的维度）
    const dimResult = await this.database.query(
      `SELECT code, name FROM scoring_dimension WHERE organization_id = $1 AND status = 'active'`,
      [principal.organizationId],
    );
    const activeDimMap = new Map<string, string>(
      dimResult.rows.map((r) => [String(r.code), String(r.name)]),
    );

    // 将存储的 { score, samples } 格式转换为纯数字分数，且只保留 active 维度
    const rawDimensions = (profileRow.dimensionScores ?? {}) as Record<string, { score: number; samples: number } | number>;
    const dimensionScores: Record<string, number> = {};
    const dimensionLabels: Record<string, string> = {};
    for (const [key, value] of Object.entries(rawDimensions)) {
      // 只返回 active 状态的维度，过滤掉废弃维度
      if (!activeDimMap.has(key)) continue;
      let score: number | null = null;
      if (typeof value === 'number') {
        score = value;
      } else if (typeof value === 'object' && value !== null && typeof value.score === 'number') {
        score = value.score;
      }
      if (score !== null) {
        dimensionScores[key] = score;
        dimensionLabels[key] = activeDimMap.get(key) ?? key;
      }
    }

    // 薄弱点也只保留 active 维度
    const rawWeakPoints = Array.isArray(profileRow.weakPoints) ? (profileRow.weakPoints as string[]) : [];
    const weakPoints = rawWeakPoints.filter((p) => activeDimMap.has(p));

    return {
      ...toSummary(profileRow),
      dimensionScores,
      dimensionLabels,
      weakPoints,
      recentSessions,
    };
  }
}
