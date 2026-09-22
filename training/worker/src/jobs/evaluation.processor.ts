import { randomUUID } from 'node:crypto';

import type {
  EvaluationSqlExecutorPort,
  TransactionalEvaluationExecutorPort,
} from '@training/contracts';

import { buildTranscriptFromMessages, type RawMessageRow, type TranscriptEntry } from './transcript-loader.js';
import { RuleBasedEvaluationReportGenerator } from './rule-evaluation-generator.js';

const MAX_EVALUATION_ATTEMPTS = 3;
// 评分含「研判 + 串行分组评分（每组最多有限重试补全缺失维度）+ 教练点评」，
// 实测正常约 45–55s；遇网关限流/截断触发组内重试时会更长。租约需覆盖正常 +
// 有限重试的 P99 耗时，避免评分仍在运行时租约过期被重复认领（重复消耗大模型调用）。
const DEFAULT_EVALUATION_LEASE_DURATION_MS = 120_000;

export interface EvaluationPollResult {
  readonly scanned: number;
  readonly succeeded: number;
  readonly failed: number;
}

export interface EvaluationReportGenerator {
  generate(input: EvaluationInput): Promise<Record<string, unknown>>;
}

/**
 * Widen a concrete, fully-known report object to the generic record shape the
 * generator interface returns. Spreading an `object` yields a fresh shallow
 * copy typed as an open record, so callers never need a double assertion
 * (`as unknown as`) to bridge a named report interface to Record<string, unknown>.
 */
export function toReportRecord(value: object): Record<string, unknown> {
  return { ...value };
}

export interface EvaluationLeaseOptions {
  readonly leaseDurationMs?: number;
  readonly now?: () => Date;
}

export class FakeEvaluationReportGenerator implements EvaluationReportGenerator {
  async generate(input: EvaluationInput): Promise<Record<string, unknown>> {
    return {
      schemaVersion: 'evaluation-report/v1',
      messageCount: input.messageCount,
      scoringRules: input.scoringRules,
      score: 100,
      generatedBy: 'fake-evaluation/v1',
    };
  }
}

interface ClaimedEvent {
  readonly id: string;
  readonly organizationId: string;
  readonly payload: { readonly conversationId?: string; readonly jobId?: string };
  readonly claimToken: string;
  readonly claimedAt: Date;
  readonly leaseExpiresAt: Date;
}

export interface EvaluationInput {
  readonly messageCount: number;
  readonly scoringRules: readonly unknown[];
  /** Ordered learner/assistant transcript reconstructed from conversation_message rows. */
  readonly transcript: readonly TranscriptEntry[];
  /** Persona snapshot from training_session.persona_snapshot (null for legacy rows). */
  readonly personaConfig: Record<string, unknown> | null;
  /** Final customer mood observed on the conversation; defaults to 'neutral'. */
  readonly customerMood: string;
  readonly initialCustomerState?: Record<string, unknown> | null;
  readonly finalCustomerState?: Record<string, unknown> | null;
  readonly stateTransitions?: readonly Record<string, unknown>[];
  readonly endReason?: string | null;
  /** 评分模板 ID（来自 assignment.scoring_template_id，NULL 时用组织默认模板）。 */
  readonly scoringTemplateId?: string | null;
  /** 评分模板关联的维度配置（含权重/知识依赖/分级标准/LLM引导语）。空数组表示无配置，回退旧引擎。 */
  readonly scoringDimensions?: readonly ScoringDimensionConfig[];
  /** 评分模板的 evaluation_mode：grouped/per_dimension/single。 */
  readonly evaluationMode?: 'grouped' | 'per_dimension' | 'single';
  /** 评分模板的教练点评引导语。 */
  readonly coachCommentPrompt?: string;
  /** 评分知识上下文（产品/症状/禁忌），按维度知识依赖按需加载；无知识依赖时为 null。 */
  readonly knowledgeContext?: ScoringKnowledgeContext | null;
}

/** worker 内部使用的评分维度配置（从 scoring_dimension + scoring_template_dimension 读取）。 */
export interface ScoringDimensionConfig {
  readonly id: string;
  readonly code: string;
  readonly name: string;
  readonly description: string | null;
  readonly weight: number;
  readonly sortOrder: number;
  readonly knowledgeDependencies: readonly string[];
  readonly llmGuidance: string | null;
  readonly gradeThresholds: Record<string, number> | null;
  readonly keywords: readonly string[];
  readonly isConfigured: boolean;
}

/** 评分用产品事实（knowledge_product 行，仅取评分需要的列）。 */
export interface ScoringProductFact {
  readonly id: string;
  readonly name: string;
  readonly aliases: readonly string[];
  readonly category: string;
  readonly coreEfficacies: readonly string[];
  readonly suitableSkinTypes: readonly string[];
  readonly suitableScenarios: readonly string[];
  readonly suitableAudience: string;
  readonly priceRange: string;
  readonly keyIngredients: readonly string[];
  readonly keySellingPoints: string;
  readonly contraindicatedSkinTypes: readonly string[];
  readonly contraindicatedAudience: string;
  readonly associatedProductIds: readonly string[];
}

/** 症状-功效映射（客户大白话 → 功效需求），语义参考用，不做关键词硬匹配。 */
export interface ScoringSymptomMapping {
  readonly id: string;
  readonly customerExpressions: readonly string[];
  readonly efficacyNeed: string;
  readonly severityWeight: number;
}

/** 禁忌规则（安全底线）。 */
export interface ScoringContraindication {
  readonly id: string;
  readonly customerCondition: string;
  readonly forbiddenProductIds: readonly string[];
  readonly forbiddenIngredients: readonly string[];
  readonly reason: string;
  readonly severity: 'warning' | 'critical';
}

/** 评分知识上下文：按维度知识依赖按需加载的三张知识库快照。 */
export interface ScoringKnowledgeContext {
  readonly products: readonly ScoringProductFact[];
  readonly symptoms: readonly ScoringSymptomMapping[];
  readonly contraindications: readonly ScoringContraindication[];
}

interface ClaimedWork {
  readonly event: ClaimedEvent;
  readonly conversationId: string;
  readonly jobId: string;
  readonly input: EvaluationInput;
}

/**
 * The worker-owned transactional evaluator.  Contracts provide ports only;
 * all SQL, outbox state transitions and retry policy live here.
 */
export class TransactionalEvaluationProcessor {
  private readonly leaseDurationMs: number;
  private readonly now: (() => Date) | undefined;

  public constructor(
    private readonly database: TransactionalEvaluationExecutorPort,
    // Safe default: a missing/forgotten generator still scores with the real
    // rule-based five-dimension evaluator (never the constant-100 Fake). Tests
    // that specifically need the Fake inject it explicitly.
    private readonly generator: EvaluationReportGenerator = new RuleBasedEvaluationReportGenerator(),
    options: EvaluationLeaseOptions = {},
  ) {
    this.leaseDurationMs = options.leaseDurationMs ?? DEFAULT_EVALUATION_LEASE_DURATION_MS;
    this.now = options.now;
    if (!Number.isFinite(this.leaseDurationMs) || this.leaseDurationMs <= 0) {
      throw new Error('Evaluation lease duration must be a positive finite number');
    }
  }

  async pollOnce(): Promise<EvaluationPollResult> {
    const claimed = await this.database.transaction(async (transaction): Promise<EvaluationPollResult | ClaimedWork> => {
      const event = await this.claimNext(transaction, this.now?.(), newUuid());
      if (event === undefined) return { scanned: 0, succeeded: 0, failed: 0 };

      const { conversationId, jobId } = event.payload;
      if (typeof conversationId !== 'string' || typeof jobId !== 'string') {
        await this.failTerminal(transaction, event, undefined);
        return { scanned: 1, succeeded: 0, failed: 1 };
      }

      const jobState = await this.startJob(transaction, event, jobId);
      if (jobState === 'succeeded') {
        await this.publishEvent(transaction, event);
        return { scanned: 1, succeeded: 1, failed: 0 };
      }
      if (jobState === 'already_running') {
        await this.deferEventUntilJobLeaseExpires(transaction, event, jobId);
        return { scanned: 1, succeeded: 0, failed: 0 };
      }
      if (jobState === 'failed' || jobState === 'missing') {
        await this.failTerminal(transaction, event, jobState === 'missing' ? undefined : jobId);
        return { scanned: 1, succeeded: 0, failed: 1 };
      }

      const input = await this.loadEvaluationInput(transaction, event.organizationId, conversationId);
      if (input === undefined) {
        await this.failTerminal(transaction, event, jobId);
        return { scanned: 1, succeeded: 0, failed: 1 };
      }

      return { event, conversationId, jobId, input };
    });

    if ('scanned' in claimed) return claimed;

    try {
      const report = await this.generator.generate(claimed.input);
      return this.database.transaction(async (transaction) => {
        if (!(await this.ownsEvent(transaction, claimed.event))) {
          return { scanned: 1, succeeded: 0, failed: 0 };
        }
        const completed = await transaction.query<{ id: string }>(
          `UPDATE evaluation_job
           SET status = 'succeeded', updated_at = CURRENT_TIMESTAMP
           WHERE id = $1 AND organization_id = $2 AND status = 'running' AND claim_token = $3
           RETURNING id`,
          [claimed.jobId, claimed.event.organizationId, claimed.event.claimToken],
        );
        if (completed.rows[0] === undefined) {
          return { scanned: 1, succeeded: 0, failed: 0 };
        }
        const inserted = await transaction.query<{ id: string }>(
          `INSERT INTO evaluation_report (id, organization_id, conversation_id, evaluation_job_id, status, report)
           VALUES ($1, $2, $3, $4, 'published', $5::jsonb)
           ON CONFLICT (organization_id, conversation_id) DO NOTHING
           RETURNING id`,
          [
            newUuid(),
            claimed.event.organizationId,
            claimed.conversationId,
            claimed.jobId,
            JSON.stringify(report),
          ],
        );
        if (inserted.rows[0] !== undefined) {
          await this.applyLearnerProfileWriteback(
            transaction,
            claimed.event.organizationId,
            claimed.conversationId,
            report,
          );
        }
        await this.publishCompletedJobEvents(
          transaction,
          claimed.event.organizationId,
          claimed.conversationId,
          claimed.jobId,
        );
        return { scanned: 1, succeeded: 1, failed: 0 };
      });
    } catch (error) {
      return this.database.transaction(async (transaction) => {
        if (isRetryable(error)) {
          const outcome = await this.failRetryably(transaction, claimed.event, claimed.jobId);
          return {
            scanned: 1,
            succeeded: 0,
            failed: outcome === 'terminal' ? 1 : 0,
          };
        }
        const failed = await this.failTerminal(transaction, claimed.event, claimed.jobId);
        return { scanned: 1, succeeded: 0, failed: failed ? 1 : 0 };
      });
    }
  }

  private async claimNext(
    transaction: EvaluationSqlExecutorPort,
    claimedAtOverride: Date | undefined,
    claimToken: string,
  ): Promise<ClaimedEvent | undefined> {
    const { rows } = await transaction.query<Record<string, unknown>>(
      `WITH claim_clock AS (
         SELECT COALESCE($1::timestamptz, clock_timestamp()) AS claimed_at
       ),
       next_event AS (
         SELECT event.id, claim_clock.claimed_at
         FROM outbox_event event
         CROSS JOIN claim_clock
         WHERE event.event_type = 'evaluation.requested'
           AND (
             event.status = 'pending'
             OR (event.status = 'processing' AND event.lease_expires_at <= claim_clock.claimed_at)
           )
         ORDER BY event.created_at
         FOR UPDATE SKIP LOCKED
         LIMIT 1
       )
       UPDATE outbox_event event
       SET status = 'processing',
           claimed_at = next_event.claimed_at,
           lease_expires_at = next_event.claimed_at + ($2::double precision * INTERVAL '1 millisecond'),
           claim_token = $3
       FROM next_event
       WHERE event.id = next_event.id
       RETURNING event.id,
                 event.organization_id AS "organizationId",
                 event.payload,
                 event.claimed_at AS "claimedAt",
                 event.lease_expires_at AS "leaseExpiresAt"`,
      [claimedAtOverride ?? null, this.leaseDurationMs, claimToken],
    );
    const row = rows[0];
    const claimedAt = toDate(row?.claimedAt);
    const leaseExpiresAt = toDate(row?.leaseExpiresAt);
    if (
      row === undefined
      || typeof row.id !== 'string'
      || typeof row.organizationId !== 'string'
      || typeof row.payload !== 'object'
      || row.payload === null
      || claimedAt === undefined
      || leaseExpiresAt === undefined
    ) {
      return undefined;
    }
    return {
      id: row.id,
      organizationId: row.organizationId,
      payload: row.payload as ClaimedEvent['payload'],
      claimToken,
      claimedAt,
      leaseExpiresAt,
    };
  }

  private async startJob(
    transaction: EvaluationSqlExecutorPort,
    event: ClaimedEvent,
    jobId: string,
  ): Promise<'running' | 'already_running' | 'succeeded' | 'failed' | 'missing'> {
    const claimed = await transaction.query<{ status: string }>(
      `UPDATE evaluation_job
       SET status = 'running',
           attempt_count = attempt_count + 1,
           updated_at = $4,
           claimed_at = $4,
           lease_expires_at = $5,
           claim_token = $6
       WHERE id = $1
         AND organization_id = $2
         AND attempt_count < $3
         AND (
           status IN ('queued', 'retryable_failed')
           OR (status = 'running' AND lease_expires_at <= $4)
         )
       RETURNING status`,
      [
        jobId,
        event.organizationId,
        MAX_EVALUATION_ATTEMPTS,
        event.claimedAt,
        event.leaseExpiresAt,
        event.claimToken,
      ],
    );
    if (claimed.rows[0] !== undefined) return 'running';

    const terminalized = await transaction.query<{ status: string }>(
      `UPDATE evaluation_job
       SET status = 'failed',
           updated_at = $4,
           claimed_at = $4,
           lease_expires_at = $5,
           claim_token = $6
       WHERE id = $1
         AND organization_id = $2
         AND attempt_count >= $3
         AND (
           status IN ('queued', 'retryable_failed')
           OR (status = 'running' AND lease_expires_at <= $4)
         )
       RETURNING status`,
      [
        jobId,
        event.organizationId,
        MAX_EVALUATION_ATTEMPTS,
        event.claimedAt,
        event.leaseExpiresAt,
        event.claimToken,
      ],
    );
    if (terminalized.rows[0] !== undefined) return 'failed';

    const { rows } = await transaction.query<{ status: string }>(
      `SELECT status FROM evaluation_job WHERE id = $1 AND organization_id = $2`,
      [jobId, event.organizationId],
    );
    const status = rows[0]?.status;
    if (status === undefined) return 'missing';
    if (status === 'succeeded' || status === 'failed') return status;
    return 'already_running';
  }

  private async deferEventUntilJobLeaseExpires(
    transaction: EvaluationSqlExecutorPort,
    event: ClaimedEvent,
    jobId: string,
  ): Promise<void> {
    await transaction.query(
      `UPDATE outbox_event event
       SET lease_expires_at = job.lease_expires_at
       FROM evaluation_job job
       WHERE event.id = $1
         AND event.organization_id = $2
         AND event.status = 'processing'
         AND event.claim_token = $3
         AND job.id = $4
         AND job.organization_id = event.organization_id
         AND job.status = 'running'
         AND job.lease_expires_at > event.claimed_at`,
      [event.id, event.organizationId, event.claimToken, jobId],
    );
  }

  private async loadEvaluationInput(
    transaction: EvaluationSqlExecutorPort,
    organizationId: string,
    conversationId: string,
  ): Promise<EvaluationInput | undefined> {
    const { rows: metaRows } = await transaction.query<Record<string, unknown>>(
      `SELECT COUNT(message.id)::text AS "messageCount",
              ts.persona_snapshot AS "personaSnapshot",
                snapshot.snapshot AS "releaseSnapshot",
                c.initial_customer_state AS "initialCustomerState",
                c.current_customer_state AS "finalCustomerState",
                c.end_reason AS "endReason",
                a.scoring_template_id AS "scoringTemplateId"
       FROM conversation c
       JOIN training_session ts
         ON ts.id = c.training_session_id AND ts.organization_id = c.organization_id
       LEFT JOIN release_snapshot snapshot
         ON snapshot.id = c.release_snapshot_id AND snapshot.organization_id = c.organization_id
       LEFT JOIN conversation_message message
         ON message.conversation_id = c.id AND message.organization_id = c.organization_id
       LEFT JOIN assignment a
         ON a.id = ts.assignment_id AND a.organization_id = c.organization_id
       WHERE c.id = $1 AND c.organization_id = $2
         GROUP BY ts.persona_snapshot, snapshot.snapshot, c.initial_customer_state, c.current_customer_state, c.end_reason, a.scoring_template_id`,
      [conversationId, organizationId],
    );
    const meta = metaRows[0];
    if (meta === undefined || typeof meta.messageCount !== 'string') return undefined;

    const releaseSnapshot = (meta.releaseSnapshot ?? null) as Record<string, unknown> | null;
    const personaSnapshot = (meta.personaSnapshot ?? null) as Record<string, unknown> | null;

    // 加载评分模板配置：assignment.scoring_template_id → 默认模板 → 维度列表
    let scoringTemplateId: string | null = null;
    let evaluationMode: 'grouped' | 'per_dimension' | 'single' = 'grouped';
    let coachCommentPrompt = '';
    let scoringDimensions: ScoringDimensionConfig[] = [];

    const rawTemplateId = meta.scoringTemplateId;
    if (typeof rawTemplateId === 'string' && rawTemplateId.length > 0) {
      scoringTemplateId = rawTemplateId;
    } else {
      // 无任务级模板时，查询组织默认模板
      const { rows: defaultRows } = await transaction.query<{ id: string; evaluation_mode: string; coach_comment_prompt: string }>(
        `SELECT id, evaluation_mode, coach_comment_prompt
         FROM scoring_template
         WHERE organization_id = $1 AND is_default = true AND status = 'active'
         LIMIT 1`,
        [organizationId],
      );
      if (defaultRows[0] !== undefined) {
        scoringTemplateId = defaultRows[0].id;
        evaluationMode = (defaultRows[0].evaluation_mode as 'grouped' | 'per_dimension' | 'single') ?? 'grouped';
        coachCommentPrompt = defaultRows[0].coach_comment_prompt ?? '';
      }
    }

    if (scoringTemplateId !== null) {
      // 如果是从 assignment 来的模板，需要查询模板的 evaluation_mode
      if (typeof rawTemplateId === 'string') {
        const { rows: tplRows } = await transaction.query<{ evaluation_mode: string; coach_comment_prompt: string }>(
          `SELECT evaluation_mode, coach_comment_prompt FROM scoring_template WHERE id = $1 AND organization_id = $2`,
          [scoringTemplateId, organizationId],
        );
        if (tplRows[0] !== undefined) {
          evaluationMode = (tplRows[0].evaluation_mode as 'grouped' | 'per_dimension' | 'single') ?? 'grouped';
          coachCommentPrompt = tplRows[0].coach_comment_prompt ?? '';
        }
      }
      // 加载模板关联的维度配置（含模板级权重覆盖）
      const { rows: dimRows } = await transaction.query<Record<string, unknown>>(
        `SELECT d.id, d.code, d.name, d.description, d.weight AS global_weight, d.knowledge_dependencies,
                d.llm_prompt, d.grading_rubric, d.keywords, d.is_configured,
                td.sort_order, td.weight AS template_weight
         FROM scoring_dimension d
         JOIN scoring_template_dimension td ON td.dimension_id = d.id
         WHERE td.template_id = $1 AND d.organization_id = $2 AND d.status = 'active'
         ORDER BY td.sort_order ASC`,
        [scoringTemplateId, organizationId],
      );
      scoringDimensions = dimRows.map((row) => {
        const globalWeight = Number(row.global_weight ?? 0);
        const templateWeight = row.template_weight !== null ? Number(row.template_weight) : null;
        return {
          id: String(row.id),
          code: String(row.code),
          name: String(row.name),
          description: row.description === null ? null : String(row.description),
          weight: templateWeight !== null ? templateWeight : globalWeight,
          sortOrder: Number(row.sort_order ?? 0),
          knowledgeDependencies: Array.isArray(row.knowledge_dependencies) ? row.knowledge_dependencies as string[] : [],
          llmGuidance: row.llm_prompt === null ? null : String(row.llm_prompt),
          gradeThresholds: row.grading_rubric !== null && typeof row.grading_rubric === 'object' ? row.grading_rubric as Record<string, number> : null,
          keywords: Array.isArray(row.keywords) ? row.keywords as string[] : [],
          isConfigured: row.is_configured === true,
        };
      });
    }

    // 按维度知识依赖，按需加载产品/症状/禁忌三张知识库（配置驱动：评分才查，不依赖不查）。
    const knowledgeContext = await this.loadKnowledgeContext(transaction, organizationId, scoringDimensions);

    const { rows: messageRows } = await transaction.query<RawMessageRow>(
      `SELECT sequence, content, response_hash AS "responseHash"
       FROM conversation_message
       WHERE conversation_id = $1 AND organization_id = $2
       ORDER BY sequence ASC`,
      [conversationId, organizationId],
    );

      const { transcript, customerMood } = buildTranscriptFromMessages(messageRows);
      const stateTransitions = messageRows.flatMap((row) => {
        if (row.responseHash === null) return [];
        try {
          const parsed = JSON.parse(row.responseHash) as { suggestion?: { stateTransition?: unknown } };
          const transition = parsed.suggestion?.stateTransition;
          return typeof transition === 'object' && transition !== null
            ? [{ sequence: row.sequence, ...(transition as Record<string, unknown>) }]
            : [];
        } catch {
          return [];
        }
      });

    return {
      messageCount: Number(meta.messageCount),
      // Free sessions have no release snapshot; they are evaluated against an empty rule set.
      scoringRules: releaseSnapshot !== null && Array.isArray(releaseSnapshot.scoringRules)
        ? releaseSnapshot.scoringRules
        : [],
      transcript,
      personaConfig: personaSnapshot,
        customerMood,
        initialCustomerState: (meta.initialCustomerState ?? null) as Record<string, unknown> | null,
        finalCustomerState: (meta.finalCustomerState ?? null) as Record<string, unknown> | null,
        stateTransitions,
        endReason: typeof meta.endReason === 'string' ? meta.endReason : null,
        scoringTemplateId,
        scoringDimensions,
        evaluationMode,
        coachCommentPrompt,
        knowledgeContext,
      };
  }

  /**
   * 按评分维度声明的知识依赖，按需加载该组织的产品/症状/禁忌知识库快照。
   * 任一维度依赖 products/product_associations 才查产品；依赖 symptom_efficacy 才查症状；
   * 依赖 contraindications 才查禁忌。无任何知识依赖时返回 null（评分不注入事实参考）。
   * JSONB 列由 pg 自动解析；NUMERIC 权重统一转 number；行级容错，不因脏数据中断评分。
   */
  private async loadKnowledgeContext(
    transaction: EvaluationSqlExecutorPort,
    organizationId: string,
    dimensions: readonly ScoringDimensionConfig[],
  ): Promise<ScoringKnowledgeContext | null> {
    const deps = new Set<string>(dimensions.flatMap((d) => d.knowledgeDependencies));
    const needProducts = deps.has('products') || deps.has('product_associations');
    const needSymptoms = deps.has('symptom_efficacy');
    const needContra = deps.has('contraindications');
    if (!needProducts && !needSymptoms && !needContra) return null;

    const asStringArray = (value: unknown): string[] =>
      Array.isArray(value) ? value.filter((v): v is string => typeof v === 'string') : [];

    let products: ScoringProductFact[] = [];
    let symptoms: ScoringSymptomMapping[] = [];
    let contraindications: ScoringContraindication[] = [];

    if (needProducts) {
      const { rows } = await transaction.query<Record<string, unknown>>(
        `SELECT id, name, aliases, category, core_efficacies, suitable_skin_types,
                suitable_scenarios, suitable_audience, price_range, key_ingredients, key_selling_points,
                contraindicated_skin_types, contraindicated_audience, associated_product_ids
         FROM knowledge_product
         WHERE organization_id = $1 AND status = 'active'
         ORDER BY created_at ASC`,
        [organizationId],
      );
      products = rows.map((r) => ({
        id: String(r.id),
        name: String(r.name),
        aliases: asStringArray(r.aliases),
        category: String(r.category ?? '其他'),
        coreEfficacies: asStringArray(r.core_efficacies),
        suitableSkinTypes: asStringArray(r.suitable_skin_types),
        suitableScenarios: asStringArray(r.suitable_scenarios),
        suitableAudience: typeof r.suitable_audience === 'string' ? r.suitable_audience : '',
        priceRange: typeof r.price_range === 'string' ? r.price_range : '',
        keyIngredients: asStringArray(r.key_ingredients),
        keySellingPoints: typeof r.key_selling_points === 'string' ? r.key_selling_points : '',
        contraindicatedSkinTypes: asStringArray(r.contraindicated_skin_types),
        contraindicatedAudience: typeof r.contraindicated_audience === 'string' ? r.contraindicated_audience : '',
        associatedProductIds: asStringArray(r.associated_product_ids),
      }));
    }

    if (needSymptoms) {
      const { rows } = await transaction.query<Record<string, unknown>>(
        `SELECT id, customer_expressions, efficacy_need, severity_weight
         FROM knowledge_symptom_efficacy
         WHERE organization_id = $1 AND status = 'active'
         ORDER BY severity_weight DESC, created_at ASC`,
        [organizationId],
      );
      symptoms = rows.map((r) => ({
        id: String(r.id),
        customerExpressions: asStringArray(r.customer_expressions),
        efficacyNeed: String(r.efficacy_need),
        severityWeight: Number(r.severity_weight ?? 1),
      }));
    }

    if (needContra) {
      const { rows } = await transaction.query<Record<string, unknown>>(
        `SELECT id, customer_condition, forbidden_product_ids, forbidden_ingredients, reason, severity
         FROM knowledge_contraindication
         WHERE organization_id = $1 AND status = 'active'
         ORDER BY severity DESC, created_at ASC`,
        [organizationId],
      );
      contraindications = rows.map((r) => ({
        id: String(r.id),
        customerCondition: String(r.customer_condition),
        forbiddenProductIds: asStringArray(r.forbidden_product_ids),
        forbiddenIngredients: asStringArray(r.forbidden_ingredients),
        reason: typeof r.reason === 'string' ? r.reason : '',
        severity: r.severity === 'critical' ? 'critical' : 'warning',
      }));
    }

    return { products, symptoms, contraindications };
  }

  private async failRetryably(
    transaction: EvaluationSqlExecutorPort,
    event: ClaimedEvent,
    jobId: string,
  ): Promise<'retryable' | 'terminal' | 'lost'> {
    if (!(await this.ownsEvent(transaction, event))) return 'lost';
    const { rows } = await transaction.query<{ status: string }>(
      `UPDATE evaluation_job
       SET status = CASE WHEN attempt_count >= $3 THEN 'failed' ELSE 'retryable_failed' END,
           updated_at = CURRENT_TIMESTAMP
       WHERE id = $1 AND organization_id = $2 AND status = 'running' AND claim_token = $4
       RETURNING status`,
      [jobId, event.organizationId, MAX_EVALUATION_ATTEMPTS, event.claimToken],
    );
    if (rows[0] === undefined) return 'lost';
    const terminal = rows[0]?.status === 'failed';
    await transaction.query(
      `UPDATE outbox_event
       SET status = $3, processed_at = CASE WHEN $3 = 'failed' THEN CURRENT_TIMESTAMP ELSE NULL END
       WHERE id = $1 AND organization_id = $2 AND claim_token = $4`,
      [event.id, event.organizationId, terminal ? 'failed' : 'pending', event.claimToken],
    );
    return terminal ? 'terminal' : 'retryable';
  }

  private async failTerminal(
    transaction: EvaluationSqlExecutorPort,
    event: ClaimedEvent,
    jobId: string | undefined,
  ): Promise<boolean> {
    if (!(await this.ownsEvent(transaction, event))) return false;
    if (jobId !== undefined) {
      await transaction.query(
        `UPDATE evaluation_job
         SET status = 'failed', updated_at = CURRENT_TIMESTAMP
         WHERE id = $1 AND organization_id = $2 AND claim_token = $3`,
        [jobId, event.organizationId, event.claimToken],
      );
    }
    const failed = await transaction.query<{ id: string }>(
      `UPDATE outbox_event
       SET status = 'failed', processed_at = CURRENT_TIMESTAMP
       WHERE id = $1 AND organization_id = $2 AND claim_token = $3
       RETURNING id`,
      [event.id, event.organizationId, event.claimToken],
    );
    return failed.rows[0] !== undefined;
  }

  private async publishEvent(transaction: EvaluationSqlExecutorPort, event: ClaimedEvent): Promise<void> {
    await transaction.query(
      `UPDATE outbox_event
       SET status = 'published', processed_at = CURRENT_TIMESTAMP
       WHERE id = $1 AND organization_id = $2 AND status = 'processing' AND claim_token = $3`,
      [event.id, event.organizationId, event.claimToken],
    );
  }

  private async publishCompletedJobEvents(
    transaction: EvaluationSqlExecutorPort,
    organizationId: string,
    conversationId: string,
    jobId: string,
  ): Promise<void> {
    await transaction.query(
      `UPDATE outbox_event
       SET status = 'published', processed_at = CURRENT_TIMESTAMP
       WHERE organization_id = $1
         AND event_type = 'evaluation.requested'
         AND status IN ('pending', 'processing')
         AND payload->>'conversationId' = $2
         AND payload->>'jobId' = $3`,
      [organizationId, conversationId, jobId],
    );
  }

  /**
   * Incrementally fold one published report into the learner's training profile.
   *
   * Runs inside the report-publication transaction and is reached only when a new
   * report was actually inserted (duplicate deliveries skip it), so counters stay
   * idempotent. Missing roots are tolerated and never block report publication.
   */
  private async applyLearnerProfileWriteback(
    transaction: EvaluationSqlExecutorPort,
    organizationId: string,
    conversationId: string,
    report: Record<string, unknown>,
  ): Promise<void> {
    const sessionResult = await transaction.query<Record<string, unknown>>(
      `SELECT ts.id, ts.learner_id AS "learnerId", ts.source_type AS "sourceType"
       FROM conversation c
       JOIN training_session ts ON ts.id = c.training_session_id
         AND ts.organization_id = c.organization_id
       WHERE c.id = $1 AND c.organization_id = $2`,
      [conversationId, organizationId],
    );
    const session = sessionResult.rows[0] as SessionOwnershipRow | undefined;
    if (session === undefined) return;

    const profileResult = await transaction.query<Record<string, unknown>>(
      `SELECT total_free_sessions AS "totalFree", total_assigned_sessions AS "totalAssigned",
              avg_score AS "avgScore", dimension_scores AS "dimensionScores"
       FROM learner_profile
       WHERE internal_learner_id = $1 AND organization_id = $2
       FOR UPDATE`,
      [session.learnerId, organizationId],
    );
    const profile = profileResult.rows[0] as ProfileAggregateRow | undefined;
    if (profile === undefined) return;

    const completedBefore = Number(profile.totalFree) + Number(profile.totalAssigned);
    const totalFree = Number(profile.totalFree) + (session.sourceType === 'free' ? 1 : 0);
    const totalAssigned = Number(profile.totalAssigned) + (session.sourceType === 'assigned' ? 1 : 0);

    const incomingScore = typeof report.score === 'number' && Number.isFinite(report.score) ? report.score : undefined;
    let nextAvg: number | null = profile.avgScore === null || profile.avgScore === undefined ? null : Number(profile.avgScore);
    if (incomingScore !== undefined) {
      nextAvg = nextAvg === null
        ? incomingScore
        : roundTwo((nextAvg * completedBefore + incomingScore) / (completedBefore + 1));
    }

    const previousDimensions = (isDimensionAggregateMap(profile.dimensionScores)
      ? profile.dimensionScores
      : {}) as Record<string, DimensionAggregate>;
    const nextDimensions: Record<string, DimensionAggregate> = { ...previousDimensions };
    
    // 优先使用自定义评分模板的维度（customDimensionScores），没有则回退到旧五维
    let dimensionEntries: Array<[string, number]> = [];
    const customDims = (report as { customDimensionScores?: unknown }).customDimensionScores;
    if (Array.isArray(customDims) && customDims.length > 0) {
      dimensionEntries = customDims
        .map((item) => {
          if (typeof item !== 'object' || item === null) return null;
          const obj = item as Record<string, unknown>;
          if (obj.applicable === false) return null;
          const code = obj.code ?? obj.dimensionCode ?? undefined;
          const score = obj.score ?? obj.value ?? undefined;
          if (typeof code !== 'string' || typeof score !== 'number' || !Number.isFinite(score)) return null;
          return [code, score] as [string, number];
        })
        .filter((item): item is [string, number] => item !== null);
    }
    if (dimensionEntries.length === 0) {
      dimensionEntries = normalizeDimensionScores(report.dimensionScores);
    }
    for (const [dimension, rawValue] of dimensionEntries) {
      if (typeof rawValue !== 'number' || !Number.isFinite(rawValue)) continue;
      const previous = nextDimensions[dimension];
      const previousSamples = previous?.samples ?? 0;
      const previousScore = previous?.score ?? null;
      const samples = previousSamples + 1;
      const score = previousScore === null
        ? roundTwo(rawValue)
        : roundTwo((previousScore * previousSamples + rawValue) / samples);
      nextDimensions[dimension] = { score, samples };
    }
    // 薄弱点只从“本次报告实际使用的维度”（当前模板 active 维度）里选最低三项，
    // 不被历史遗留、现已停用(inactive)的旧维度低分长期占据。
    const incomingCodes = new Set(dimensionEntries.map(([code]) => code));
    const weakPoints = [...incomingCodes]
      .flatMap((code) => {
        const agg = nextDimensions[code];
        return agg !== undefined && agg.samples > 0 ? [{ code, score: agg.score }] : [];
      })
      .sort((left, right) => left.score - right.score)
      .slice(0, 3)
      .map((entry) => entry.code);

    await transaction.query(
      `UPDATE learner_profile
       SET total_free_sessions = $3,
           total_assigned_sessions = $4,
           avg_score = $5,
           dimension_scores = $6::jsonb,
           weak_points = $7::jsonb,
           last_trained_at = CURRENT_TIMESTAMP,
           updated_at = CURRENT_TIMESTAMP
       WHERE internal_learner_id = $1 AND organization_id = $2`,
      [
        session.learnerId,
        organizationId,
        totalFree,
        totalAssigned,
        nextAvg,
        JSON.stringify(nextDimensions),
        JSON.stringify(weakPoints),
      ],
    );

    await transaction.query(
      `UPDATE training_session
       SET status = 'scored'
       WHERE id = $1 AND organization_id = $2 AND status = 'ended'`,
      [session.id, organizationId],
    );
  }

  private async ownsEvent(transaction: EvaluationSqlExecutorPort, event: ClaimedEvent): Promise<boolean> {
    const { rows } = await transaction.query<{ id: string }>(
      `SELECT id
       FROM outbox_event
       WHERE id = $1 AND organization_id = $2 AND status = 'processing' AND claim_token = $3
       FOR UPDATE`,
      [event.id, event.organizationId, event.claimToken],
    );
    return rows[0] !== undefined;
  }
}

interface DimensionAggregate {
  readonly score: number;
  readonly samples: number;
}

interface SessionOwnershipRow {
  readonly id: string;
  readonly learnerId: string;
  readonly sourceType: 'free' | 'assigned';
}

interface ProfileAggregateRow {
  readonly totalFree: number | string;
  readonly totalAssigned: number | string;
  readonly avgScore: number | string | null;
  readonly dimensionScores: unknown;
}

function roundTwo(value: number): number {
  return Math.round(value * 100) / 100;
}

function isDimensionAggregateMap(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * 将不同格式的维度评分统一转换为 [dimension, score] 数组
 * 支持两种格式：
 * 1. 对象格式：{ needs_discovery: 50, product_presentation: 60 }
 * 2. 数组格式：[{ code: 'needs_discovery', score: 50 }, { dimensionCode: 'product_presentation', score: 60 }]
 */
function normalizeDimensionScores(value: unknown): Array<[string, number]> {
  if (typeof value !== 'object' || value === null) return [];
  
  // 对象格式
  if (!Array.isArray(value)) {
    return Object.entries(value)
      .filter(([, v]) => typeof v === 'number' && Number.isFinite(v)) as Array<[string, number]>;
  }
  
  // 数组格式
  return (value as unknown[])
    .map((item) => {
      if (typeof item !== 'object' || item === null) return null;
      const obj = item as Record<string, unknown>;
      const code = obj.code ?? obj.dimensionCode ?? obj.dimension ?? undefined;
      const score = obj.score ?? obj.value ?? undefined;
      if (typeof code !== 'string' || typeof score !== 'number' || !Number.isFinite(score)) return null;
      return [code, score] as [string, number];
    })
    .filter((item): item is [string, number] => item !== null);
}

function isRetryable(error: unknown): boolean {
  return typeof error === 'object' && error !== null && 'retryable' in error && (error as { retryable?: unknown }).retryable === true;
}

function newUuid(): string {
  return randomUUID();
}

function toDate(value: unknown): Date | undefined {
  if (value instanceof Date && Number.isFinite(value.getTime())) return value;
  if (typeof value !== 'string') return undefined;
  const parsed = new Date(value);
  return Number.isFinite(parsed.getTime()) ? parsed : undefined;
}
