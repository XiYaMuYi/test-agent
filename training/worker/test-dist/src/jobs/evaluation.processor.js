import { randomUUID } from 'node:crypto';
import { buildTranscriptFromMessages } from './transcript-loader.js';
import { RuleBasedEvaluationReportGenerator } from './rule-evaluation-generator.js';
const MAX_EVALUATION_ATTEMPTS = 3;
const DEFAULT_EVALUATION_LEASE_DURATION_MS = 60_000;
/**
 * Widen a concrete, fully-known report object to the generic record shape the
 * generator interface returns. Spreading an `object` yields a fresh shallow
 * copy typed as an open record, so callers never need a double assertion
 * (`as unknown as`) to bridge a named report interface to Record<string, unknown>.
 */
export function toReportRecord(value) {
    return { ...value };
}
export class FakeEvaluationReportGenerator {
    async generate(input) {
        return {
            schemaVersion: 'evaluation-report/v1',
            messageCount: input.messageCount,
            scoringRules: input.scoringRules,
            score: 100,
            generatedBy: 'fake-evaluation/v1',
        };
    }
}
/**
 * The worker-owned transactional evaluator.  Contracts provide ports only;
 * all SQL, outbox state transitions and retry policy live here.
 */
export class TransactionalEvaluationProcessor {
    database;
    generator;
    leaseDurationMs;
    now;
    constructor(database, 
    // Safe default: a missing/forgotten generator still scores with the real
    // rule-based five-dimension evaluator (never the constant-100 Fake). Tests
    // that specifically need the Fake inject it explicitly.
    generator = new RuleBasedEvaluationReportGenerator(), options = {}) {
        this.database = database;
        this.generator = generator;
        this.leaseDurationMs = options.leaseDurationMs ?? DEFAULT_EVALUATION_LEASE_DURATION_MS;
        this.now = options.now;
        if (!Number.isFinite(this.leaseDurationMs) || this.leaseDurationMs <= 0) {
            throw new Error('Evaluation lease duration must be a positive finite number');
        }
    }
    async pollOnce() {
        const claimed = await this.database.transaction(async (transaction) => {
            const event = await this.claimNext(transaction, this.now?.(), newUuid());
            if (event === undefined)
                return { scanned: 0, succeeded: 0, failed: 0 };
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
        if ('scanned' in claimed)
            return claimed;
        try {
            const report = await this.generator.generate(claimed.input);
            return this.database.transaction(async (transaction) => {
                if (!(await this.ownsEvent(transaction, claimed.event))) {
                    return { scanned: 1, succeeded: 0, failed: 0 };
                }
                const completed = await transaction.query(`UPDATE evaluation_job
           SET status = 'succeeded', updated_at = CURRENT_TIMESTAMP
           WHERE id = $1 AND organization_id = $2 AND status = 'running' AND claim_token = $3
           RETURNING id`, [claimed.jobId, claimed.event.organizationId, claimed.event.claimToken]);
                if (completed.rows[0] === undefined) {
                    return { scanned: 1, succeeded: 0, failed: 0 };
                }
                const inserted = await transaction.query(`INSERT INTO evaluation_report (id, organization_id, conversation_id, evaluation_job_id, status, report)
           VALUES ($1, $2, $3, $4, 'published', $5::jsonb)
           ON CONFLICT (organization_id, conversation_id) DO NOTHING
           RETURNING id`, [
                    newUuid(),
                    claimed.event.organizationId,
                    claimed.conversationId,
                    claimed.jobId,
                    JSON.stringify(report),
                ]);
                if (inserted.rows[0] !== undefined) {
                    await this.applyLearnerProfileWriteback(transaction, claimed.event.organizationId, claimed.conversationId, report);
                }
                await this.publishCompletedJobEvents(transaction, claimed.event.organizationId, claimed.conversationId, claimed.jobId);
                return { scanned: 1, succeeded: 1, failed: 0 };
            });
        }
        catch (error) {
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
    async claimNext(transaction, claimedAtOverride, claimToken) {
        const { rows } = await transaction.query(`WITH claim_clock AS (
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
                 event.lease_expires_at AS "leaseExpiresAt"`, [claimedAtOverride ?? null, this.leaseDurationMs, claimToken]);
        const row = rows[0];
        const claimedAt = toDate(row?.claimedAt);
        const leaseExpiresAt = toDate(row?.leaseExpiresAt);
        if (row === undefined
            || typeof row.id !== 'string'
            || typeof row.organizationId !== 'string'
            || typeof row.payload !== 'object'
            || row.payload === null
            || claimedAt === undefined
            || leaseExpiresAt === undefined) {
            return undefined;
        }
        return {
            id: row.id,
            organizationId: row.organizationId,
            payload: row.payload,
            claimToken,
            claimedAt,
            leaseExpiresAt,
        };
    }
    async startJob(transaction, event, jobId) {
        const claimed = await transaction.query(`UPDATE evaluation_job
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
       RETURNING status`, [
            jobId,
            event.organizationId,
            MAX_EVALUATION_ATTEMPTS,
            event.claimedAt,
            event.leaseExpiresAt,
            event.claimToken,
        ]);
        if (claimed.rows[0] !== undefined)
            return 'running';
        const terminalized = await transaction.query(`UPDATE evaluation_job
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
       RETURNING status`, [
            jobId,
            event.organizationId,
            MAX_EVALUATION_ATTEMPTS,
            event.claimedAt,
            event.leaseExpiresAt,
            event.claimToken,
        ]);
        if (terminalized.rows[0] !== undefined)
            return 'failed';
        const { rows } = await transaction.query(`SELECT status FROM evaluation_job WHERE id = $1 AND organization_id = $2`, [jobId, event.organizationId]);
        const status = rows[0]?.status;
        if (status === undefined)
            return 'missing';
        if (status === 'succeeded' || status === 'failed')
            return status;
        return 'already_running';
    }
    async deferEventUntilJobLeaseExpires(transaction, event, jobId) {
        await transaction.query(`UPDATE outbox_event event
       SET lease_expires_at = job.lease_expires_at
       FROM evaluation_job job
       WHERE event.id = $1
         AND event.organization_id = $2
         AND event.status = 'processing'
         AND event.claim_token = $3
         AND job.id = $4
         AND job.organization_id = event.organization_id
         AND job.status = 'running'
         AND job.lease_expires_at > event.claimed_at`, [event.id, event.organizationId, event.claimToken, jobId]);
    }
    async loadEvaluationInput(transaction, organizationId, conversationId) {
        const { rows: metaRows } = await transaction.query(`SELECT COUNT(message.id)::text AS "messageCount",
              ts.persona_snapshot AS "personaSnapshot",
              snapshot.snapshot AS "releaseSnapshot"
       FROM conversation c
       JOIN training_session ts
         ON ts.id = c.training_session_id AND ts.organization_id = c.organization_id
       LEFT JOIN release_snapshot snapshot
         ON snapshot.id = c.release_snapshot_id AND snapshot.organization_id = c.organization_id
       LEFT JOIN conversation_message message
         ON message.conversation_id = c.id AND message.organization_id = c.organization_id
       WHERE c.id = $1 AND c.organization_id = $2
       GROUP BY ts.persona_snapshot, snapshot.snapshot`, [conversationId, organizationId]);
        const meta = metaRows[0];
        if (meta === undefined || typeof meta.messageCount !== 'string')
            return undefined;
        const releaseSnapshot = (meta.releaseSnapshot ?? null);
        const personaSnapshot = (meta.personaSnapshot ?? null);
        const { rows: messageRows } = await transaction.query(`SELECT sequence, content, response_hash AS "responseHash"
       FROM conversation_message
       WHERE conversation_id = $1 AND organization_id = $2
       ORDER BY sequence ASC`, [conversationId, organizationId]);
        const { transcript, customerMood } = buildTranscriptFromMessages(messageRows);
        return {
            messageCount: Number(meta.messageCount),
            // Free sessions have no release snapshot; they are evaluated against an empty rule set.
            scoringRules: releaseSnapshot !== null && Array.isArray(releaseSnapshot.scoringRules)
                ? releaseSnapshot.scoringRules
                : [],
            transcript,
            personaConfig: personaSnapshot,
            customerMood,
        };
    }
    async failRetryably(transaction, event, jobId) {
        if (!(await this.ownsEvent(transaction, event)))
            return 'lost';
        const { rows } = await transaction.query(`UPDATE evaluation_job
       SET status = CASE WHEN attempt_count >= $3 THEN 'failed' ELSE 'retryable_failed' END,
           updated_at = CURRENT_TIMESTAMP
       WHERE id = $1 AND organization_id = $2 AND status = 'running' AND claim_token = $4
       RETURNING status`, [jobId, event.organizationId, MAX_EVALUATION_ATTEMPTS, event.claimToken]);
        if (rows[0] === undefined)
            return 'lost';
        const terminal = rows[0]?.status === 'failed';
        await transaction.query(`UPDATE outbox_event
       SET status = $3, processed_at = CASE WHEN $3 = 'failed' THEN CURRENT_TIMESTAMP ELSE NULL END
       WHERE id = $1 AND organization_id = $2 AND claim_token = $4`, [event.id, event.organizationId, terminal ? 'failed' : 'pending', event.claimToken]);
        return terminal ? 'terminal' : 'retryable';
    }
    async failTerminal(transaction, event, jobId) {
        if (!(await this.ownsEvent(transaction, event)))
            return false;
        if (jobId !== undefined) {
            await transaction.query(`UPDATE evaluation_job
         SET status = 'failed', updated_at = CURRENT_TIMESTAMP
         WHERE id = $1 AND organization_id = $2 AND claim_token = $3`, [jobId, event.organizationId, event.claimToken]);
        }
        const failed = await transaction.query(`UPDATE outbox_event
       SET status = 'failed', processed_at = CURRENT_TIMESTAMP
       WHERE id = $1 AND organization_id = $2 AND claim_token = $3
       RETURNING id`, [event.id, event.organizationId, event.claimToken]);
        return failed.rows[0] !== undefined;
    }
    async publishEvent(transaction, event) {
        await transaction.query(`UPDATE outbox_event
       SET status = 'published', processed_at = CURRENT_TIMESTAMP
       WHERE id = $1 AND organization_id = $2 AND status = 'processing' AND claim_token = $3`, [event.id, event.organizationId, event.claimToken]);
    }
    async publishCompletedJobEvents(transaction, organizationId, conversationId, jobId) {
        await transaction.query(`UPDATE outbox_event
       SET status = 'published', processed_at = CURRENT_TIMESTAMP
       WHERE organization_id = $1
         AND event_type = 'evaluation.requested'
         AND status IN ('pending', 'processing')
         AND payload->>'conversationId' = $2
         AND payload->>'jobId' = $3`, [organizationId, conversationId, jobId]);
    }
    /**
     * Incrementally fold one published report into the learner's training profile.
     *
     * Runs inside the report-publication transaction and is reached only when a new
     * report was actually inserted (duplicate deliveries skip it), so counters stay
     * idempotent. Missing roots are tolerated and never block report publication.
     */
    async applyLearnerProfileWriteback(transaction, organizationId, conversationId, report) {
        const sessionResult = await transaction.query(`SELECT ts.id, ts.learner_id AS "learnerId", ts.source_type AS "sourceType"
       FROM conversation c
       JOIN training_session ts ON ts.id = c.training_session_id
         AND ts.organization_id = c.organization_id
       WHERE c.id = $1 AND c.organization_id = $2`, [conversationId, organizationId]);
        const session = sessionResult.rows[0];
        if (session === undefined)
            return;
        const profileResult = await transaction.query(`SELECT total_free_sessions AS "totalFree", total_assigned_sessions AS "totalAssigned",
              avg_score AS "avgScore", dimension_scores AS "dimensionScores"
       FROM learner_profile
       WHERE internal_learner_id = $1 AND organization_id = $2
       FOR UPDATE`, [session.learnerId, organizationId]);
        const profile = profileResult.rows[0];
        if (profile === undefined)
            return;
        const completedBefore = Number(profile.totalFree) + Number(profile.totalAssigned);
        const totalFree = Number(profile.totalFree) + (session.sourceType === 'free' ? 1 : 0);
        const totalAssigned = Number(profile.totalAssigned) + (session.sourceType === 'assigned' ? 1 : 0);
        const incomingScore = typeof report.score === 'number' && Number.isFinite(report.score) ? report.score : undefined;
        let nextAvg = profile.avgScore === null || profile.avgScore === undefined ? null : Number(profile.avgScore);
        if (incomingScore !== undefined) {
            nextAvg = nextAvg === null
                ? incomingScore
                : roundTwo((nextAvg * completedBefore + incomingScore) / (completedBefore + 1));
        }
        const previousDimensions = (isDimensionAggregateMap(profile.dimensionScores)
            ? profile.dimensionScores
            : {});
        const nextDimensions = { ...previousDimensions };
        if (isDimensionAggregateMap(report.dimensionScores)) {
            for (const [dimension, rawValue] of Object.entries(report.dimensionScores)) {
                if (typeof rawValue !== 'number' || !Number.isFinite(rawValue))
                    continue;
                const previous = nextDimensions[dimension];
                const previousSamples = previous?.samples ?? 0;
                const previousScore = previous?.score ?? null;
                const samples = previousSamples + 1;
                const score = previousScore === null
                    ? roundTwo(rawValue)
                    : roundTwo((previousScore * previousSamples + rawValue) / samples);
                nextDimensions[dimension] = { score, samples };
            }
        }
        const weakPoints = Object.entries(nextDimensions)
            .filter(([, value]) => value.samples > 0)
            .sort((left, right) => left[1].score - right[1].score)
            .slice(0, 3)
            .map(([dimension]) => dimension);
        await transaction.query(`UPDATE learner_profile
       SET total_free_sessions = $3,
           total_assigned_sessions = $4,
           avg_score = $5,
           dimension_scores = $6::jsonb,
           weak_points = $7::jsonb,
           last_trained_at = CURRENT_TIMESTAMP,
           updated_at = CURRENT_TIMESTAMP
       WHERE internal_learner_id = $1 AND organization_id = $2`, [
            session.learnerId,
            organizationId,
            totalFree,
            totalAssigned,
            nextAvg,
            JSON.stringify(nextDimensions),
            JSON.stringify(weakPoints),
        ]);
        await transaction.query(`UPDATE training_session
       SET status = 'scored'
       WHERE id = $1 AND organization_id = $2 AND status = 'ended'`, [session.id, organizationId]);
    }
    async ownsEvent(transaction, event) {
        const { rows } = await transaction.query(`SELECT id
       FROM outbox_event
       WHERE id = $1 AND organization_id = $2 AND status = 'processing' AND claim_token = $3
       FOR UPDATE`, [event.id, event.organizationId, event.claimToken]);
        return rows[0] !== undefined;
    }
}
function roundTwo(value) {
    return Math.round(value * 100) / 100;
}
function isDimensionAggregateMap(value) {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}
function isRetryable(error) {
    return typeof error === 'object' && error !== null && 'retryable' in error && error.retryable === true;
}
function newUuid() {
    return randomUUID();
}
function toDate(value) {
    if (value instanceof Date && Number.isFinite(value.getTime()))
        return value;
    if (typeof value !== 'string')
        return undefined;
    const parsed = new Date(value);
    return Number.isFinite(parsed.getTime()) ? parsed : undefined;
}
