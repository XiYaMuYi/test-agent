import assert from 'node:assert/strict';
import test from 'node:test';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../../src/app.module.js';
import { deriveLearnerId } from '../../src/assignments/eligibility.service.js';
import { createPostgresExecutor, MigrationRunner, registeredMigrations } from '../../src/database/migrations/index.js';
import { createPostgresTestSupport } from '../support/postgres.js';
async function createApp(databaseUrl) {
    process.env.DATABASE_URL = databaseUrl;
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    const app = moduleRef.createNestApplication();
    await app.init();
    return app;
}
async function createEvaluationWorker(database, options = {}) {
    const loadWorkerModule = new Function('path', 'return import(path)');
    const { createWorkerModule } = await loadWorkerModule('../../../../worker/dist/worker.module.js');
    return createWorkerModule({
        evaluationExecutor: database,
        ...(options.generator === undefined ? {} : { evaluationGenerator: options.generator }),
        ...(options.leaseDurationMs === undefined ? {} : { evaluationLeaseDurationMs: options.leaseDurationMs }),
        ...(options.now === undefined ? {} : { now: options.now }),
    });
}
function interceptTransactionQueries(database, beforeQuery) {
    return {
        query(statement, values) {
            return database.query(statement, values);
        },
        transaction(work) {
            return database.transaction((transaction) => work({
                async query(statement, values) {
                    await beforeQuery(statement);
                    return transaction.query(statement, values);
                },
            }));
        },
    };
}
async function createRuntimeEvaluationWorker(databaseUrl) {
    const loadWorkerMain = new Function('path', 'return import(path)');
    const previousDatabaseUrl = process.env.DATABASE_URL;
    process.env.DATABASE_URL = databaseUrl;
    try {
        const { bootstrapWorker } = await loadWorkerMain('../../../../worker/dist/main.js');
        return await bootstrapWorker();
    }
    finally {
        if (previousDatabaseUrl === undefined)
            delete process.env.DATABASE_URL;
        else
            process.env.DATABASE_URL = previousDatabaseUrl;
    }
}
const ORG_A = '11111111-1111-1111-1111-111111111111';
const ORG_B = '22222222-2222-2222-2222-222222222222';
const STREAMER_A = 'fixture:identity:valid';
const STREAMER_A_OTHER = 'fixture:identity:streamer-organization-a-other';
const ADMIN_A = 'fixture:identity:admin-organization-a';
const ADMIN_B = 'fixture:identity:cross-organization';
const CONV_ID = '11111111-1111-1111-1111-111111111160';
const JOB_ID = '11111111-1111-1111-1111-111111111170';
const OUTBOX_ID = '11111111-1111-1111-1111-111111111180';
async function seedEvaluationFixture(dbUrl) {
    const db = createPostgresExecutor(dbUrl);
    await db.query(`INSERT INTO scenario_draft (id, organization_id, title, payload)
     VALUES ('11111111-1111-1111-1111-111111111110', $1, 'draft',
       '{"title":"draft","knowledgeVersions":["knowledge-welcome@v1"],"scoringRules":["rule-a"],"agentConfig":{}}'::jsonb)`, [ORG_A]);
    await db.query(`INSERT INTO release_snapshot (id, scenario_draft_id, organization_id, schema_version, snapshot)
     VALUES ('11111111-1111-1111-1111-111111111120', '11111111-1111-1111-1111-111111111110', $1, 'release-snapshot/v1',
       '{"schemaVersion":"release-snapshot/v1","releaseSnapshotId":"11111111-1111-1111-1111-111111111120","scenarioDraftId":"11111111-1111-1111-1111-111111111110","compiledAt":"2026-07-28T00:00:00.000Z","title":"draft","knowledgeVersions":["knowledge-welcome@v1"],"scoringRules":["rule-a"],"agentConfig":{}}'::jsonb)`, [ORG_A]);
    await db.query(`INSERT INTO assignment (id, organization_id, release_snapshot_id, name, status, starts_at, ends_at, max_attempts, target_principal_ids)
     VALUES ('11111111-1111-1111-1111-111111111130', $1, '11111111-1111-1111-1111-111111111120', 'assign', 'active',
       CURRENT_TIMESTAMP, CURRENT_TIMESTAMP + INTERVAL '1 day', 3, '[]'::jsonb)`, [ORG_A]);
    await db.query(`INSERT INTO learner_assignment (id, organization_id, assignment_id, learner_id, state, total_attempts, active_attempt_id)
     VALUES ('11111111-1111-1111-1111-111111111140', $1, '11111111-1111-1111-1111-111111111130', $2, 'active', 0, '11111111-1111-1111-1111-111111111150')`, [ORG_A, deriveLearnerId('streamer-001')]);
    await db.query(`INSERT INTO training_attempt (id, organization_id, learner_assignment_id, idempotency_key, status)
     VALUES ('11111111-1111-1111-1111-111111111150', $1, '11111111-1111-1111-1111-111111111140', 'start-1', 'created')`, [ORG_A]);
    await db.query(`INSERT INTO learner_profile (internal_learner_id, organization_id, external_principal_id, identity_provider)
     VALUES ($2, $1, 'streamer-001', 'gongzhugou') ON CONFLICT DO NOTHING`, [ORG_A, deriveLearnerId('streamer-001')]);
    await db.query(`INSERT INTO training_session (id, organization_id, learner_id, source_type, mode, release_snapshot_id, assignment_id, learner_assignment_id, training_attempt_id, persona_snapshot, status, idempotency_key)
     VALUES ('11111111-1111-1111-1111-111111111171', $1, $2, 'assigned', 'practice',
             '11111111-1111-1111-1111-111111111120', '11111111-1111-1111-1111-111111111130',
             '11111111-1111-1111-1111-111111111140', '11111111-1111-1111-1111-111111111150',
             '{}'::jsonb, 'ended', 'seed-eval-session')`, [ORG_A, deriveLearnerId('streamer-001')]);
    await db.query(`INSERT INTO conversation (id, organization_id, training_attempt_id, release_snapshot_id, training_session_id, status, version, last_sequence)
     VALUES ($1, $2, '11111111-1111-1111-1111-111111111150', '11111111-1111-1111-1111-111111111120', '11111111-1111-1111-1111-111111111171', 'ended', 2, 1)`, [CONV_ID, ORG_A]);
    await db.query(`INSERT INTO conversation_message (id, organization_id, conversation_id, sequence, client_message_id, role, content, request_hash)
     VALUES ('11111111-1111-1111-1111-111111111190', $1, $2, 1, 'msg-1', 'learner', 'hello', 'hash1')`, [ORG_A, CONV_ID]);
    await db.query(`INSERT INTO evaluation_job (id, organization_id, conversation_id, status, attempt_count)
     VALUES ($1, $2, $3, 'queued', 0)`, [JOB_ID, ORG_A, CONV_ID]);
    await db.query(`INSERT INTO outbox_event (id, organization_id, aggregate_type, aggregate_id, event_type, payload, deduplication_key, status)
     VALUES ($1, $2, 'evaluation', $3, 'evaluation.requested', $4::jsonb, $5, 'pending')`, [OUTBOX_ID, ORG_A, CONV_ID, JSON.stringify({ conversationId: CONV_ID, jobId: JOB_ID }), `evaluation:${CONV_ID}`]);
    await db.close();
}
test('worker idempotency: duplicate outbox delivery generates only one report', { timeout: 120_000 }, async (context) => {
    const postgres = await createPostgresTestSupport().start();
    const db = createPostgresExecutor(postgres.connectionUri);
    const runner = new MigrationRunner(db, registeredMigrations);
    await runner.applyAll();
    await seedEvaluationFixture(postgres.connectionUri);
    context.after(async () => {
        await db.close();
        await postgres.stop();
    });
    const consumer = await createEvaluationWorker(db);
    const first = await consumer.pollOnce();
    assert.equal(first.scanned, 1);
    assert.equal(first.dispatched, 1);
    const { rows: reports } = await db.query('SELECT COUNT(*)::text AS count FROM evaluation_report WHERE conversation_id = $1', [CONV_ID]);
    assert.equal(reports[0]?.count, '1');
    const second = await consumer.pollOnce();
    assert.equal(second.scanned, 0);
    const { rows: reportsAfter } = await db.query('SELECT COUNT(*)::text AS count FROM evaluation_report WHERE conversation_id = $1', [CONV_ID]);
    assert.equal(reportsAfter[0]?.count, '1');
});
test('runtime bootstrap consumes evaluation events using DATABASE_URL configuration', { timeout: 120_000 }, async (context) => {
    const postgres = await createPostgresTestSupport().start();
    const db = createPostgresExecutor(postgres.connectionUri);
    const runner = new MigrationRunner(db, registeredMigrations);
    await runner.applyAll();
    await seedEvaluationFixture(postgres.connectionUri);
    const worker = await createRuntimeEvaluationWorker(postgres.connectionUri);
    context.after(async () => {
        await worker.close?.();
        await db.close();
        await postgres.stop();
    });
    assert.equal((await worker.pollOnce()).dispatched, 1);
    const { rows } = await db.query('SELECT COUNT(*)::text AS count FROM evaluation_report WHERE conversation_id = $1', [CONV_ID]);
    assert.equal(rows[0]?.count, '1');
});
test('an expired evaluation claim is reclaimed and the abandoned owner cannot publish a second report', { timeout: 120_000 }, async (context) => {
    const postgres = await createPostgresTestSupport().start();
    const db = createPostgresExecutor(postgres.connectionUri);
    const runner = new MigrationRunner(db, registeredMigrations);
    await runner.applyAll();
    await seedEvaluationFixture(postgres.connectionUri);
    const firstDatabase = createPostgresExecutor(postgres.connectionUri);
    const recoveryDatabase = createPostgresExecutor(postgres.connectionUri);
    const leaseDurationMs = 60_000;
    let currentTime = new Date('2026-07-31T00:00:00.000Z');
    let firstCalls = 0;
    let recoveryCalls = 0;
    let releaseFirst;
    const firstGate = new Promise((resolve) => { releaseFirst = resolve; });
    const now = () => currentTime;
    const firstWorker = await createEvaluationWorker(firstDatabase, {
        leaseDurationMs,
        now,
        generator: {
            async generate() {
                firstCalls += 1;
                await firstGate;
                return { schemaVersion: 'evaluation-report/v1', score: 10, owner: 'abandoned' };
            },
        },
    });
    const recoveryWorker = await createEvaluationWorker(recoveryDatabase, {
        leaseDurationMs,
        now,
        generator: {
            async generate() {
                recoveryCalls += 1;
                return { schemaVersion: 'evaluation-report/v1', score: 100, owner: 'recovery' };
            },
        },
    });
    context.after(async () => {
        await firstDatabase.close();
        await recoveryDatabase.close();
        await db.close();
        await postgres.stop();
    });
    const abandonedPoll = firstWorker.pollOnce();
    while (firstCalls === 0)
        await new Promise((resolve) => setTimeout(resolve, 5));
    const claimedState = await db.query(`SELECT event.status AS "eventStatus", job.status AS "jobStatus"
     FROM outbox_event event
     JOIN evaluation_job job ON job.id = $1 AND job.organization_id = event.organization_id
     WHERE event.id = $2 AND event.organization_id = $3`, [JOB_ID, OUTBOX_ID, ORG_A]);
    assert.deepEqual(claimedState.rows[0], { eventStatus: 'processing', jobStatus: 'running' });
    currentTime = new Date(currentTime.getTime() + leaseDurationMs + 1);
    let recovered;
    try {
        recovered = await recoveryWorker.pollOnce();
        assert.equal(recovered.scanned, 1);
        assert.equal(recovered.dispatched, 1);
        assert.equal(recoveryCalls, 1);
    }
    finally {
        releaseFirst();
    }
    const abandoned = await abandonedPoll;
    assert.equal(abandoned.dispatched, 0, 'an owner fenced by a newer claim must discard its generated result');
    const finalState = await db.query(`SELECT event.status AS "eventStatus",
            job.status AS "jobStatus",
            job.attempt_count::text AS "attemptCount",
            COUNT(report.id)::text AS "reportCount",
            MAX(report.report->>'owner') AS "reportOwner"
     FROM outbox_event event
     JOIN evaluation_job job ON job.id = $1 AND job.organization_id = event.organization_id
     LEFT JOIN evaluation_report report ON report.evaluation_job_id = job.id
       AND report.organization_id = job.organization_id
     WHERE event.id = $2 AND event.organization_id = $3
     GROUP BY event.status, job.status, job.attempt_count`, [JOB_ID, OUTBOX_ID, ORG_A]);
    assert.deepEqual(finalState.rows[0], {
        eventStatus: 'published',
        jobStatus: 'succeeded',
        attemptCount: '2',
        reportCount: '1',
        reportOwner: 'recovery',
    });
});
test('an event reclaimed before its job lease expires remains recoverable until the job can be reclaimed', { timeout: 120_000 }, async (context) => {
    const postgres = await createPostgresTestSupport().start();
    const db = createPostgresExecutor(postgres.connectionUri);
    const runner = new MigrationRunner(db, registeredMigrations);
    await runner.applyAll();
    await seedEvaluationFixture(postgres.connectionUri);
    await db.query(`UPDATE outbox_event
     SET status = 'processing',
         claimed_at = '2026-07-31T00:00:00.000Z',
         lease_expires_at = '2026-07-31T00:01:00.000Z',
         claim_token = $1
     WHERE id = $1 AND organization_id = $2`, [OUTBOX_ID, ORG_A]);
    await db.query(`UPDATE evaluation_job
     SET status = 'running',
         attempt_count = 1,
         updated_at = '2026-07-31T00:00:00.000Z',
         claimed_at = '2026-07-31T00:00:00.000Z',
         lease_expires_at = '2026-07-31T00:01:10.000Z',
         claim_token = $1
     WHERE id = $1 AND organization_id = $2`, [JOB_ID, ORG_A]);
    let currentTime = new Date('2026-07-31T00:01:05.000Z');
    let generatorCalls = 0;
    const worker = await createEvaluationWorker(db, {
        now: () => currentTime,
        generator: {
            async generate() {
                generatorCalls += 1;
                return { schemaVersion: 'evaluation-report/v1', score: 100, owner: 'recovery' };
            },
        },
    });
    context.after(async () => {
        await db.close();
        await postgres.stop();
    });
    const deferred = await worker.pollOnce();
    const { rows: deferredRows } = await db.query(`SELECT event.status AS "eventStatus",
            job.status AS "jobStatus",
            COUNT(report.id)::text AS "reportCount"
     FROM outbox_event event
     JOIN evaluation_job job ON job.id = $1 AND job.organization_id = event.organization_id
     LEFT JOIN evaluation_report report ON report.evaluation_job_id = job.id
       AND report.organization_id = job.organization_id
     WHERE event.id = $2 AND event.organization_id = $3
     GROUP BY event.status, job.status`, [JOB_ID, OUTBOX_ID, ORG_A]);
    assert.deepEqual({
        generatorCalls,
        result: deferred,
        state: deferredRows[0],
    }, {
        generatorCalls: 0,
        result: { scanned: 1, dispatched: 0, succeeded: 0, failed: 0 },
        state: { eventStatus: 'processing', jobStatus: 'running', reportCount: '0' },
    }, 'reclaiming only the event must not publish work that the generator never performed');
    currentTime = new Date('2026-07-31T00:01:11.000Z');
    assert.deepEqual(await worker.pollOnce(), { scanned: 1, dispatched: 1, succeeded: 1, failed: 0 });
    assert.equal(generatorCalls, 1);
    const { rows: finalRows } = await db.query(`SELECT event.status AS "eventStatus",
            job.status AS "jobStatus",
            job.attempt_count::text AS "attemptCount",
            COUNT(report.id)::text AS "reportCount"
     FROM outbox_event event
     JOIN evaluation_job job ON job.id = $1 AND job.organization_id = event.organization_id
     LEFT JOIN evaluation_report report ON report.evaluation_job_id = job.id
       AND report.organization_id = job.organization_id
     WHERE event.id = $2 AND event.organization_id = $3
     GROUP BY event.status, job.status, job.attempt_count`, [JOB_ID, OUTBOX_ID, ORG_A]);
    assert.deepEqual(finalRows[0], {
        eventStatus: 'published',
        jobStatus: 'succeeded',
        attemptCount: '2',
        reportCount: '1',
    });
    assert.equal((await worker.pollOnce()).scanned, 0);
});
test('a recovery claim fences an abandoned owner before either worker can persist a report', { timeout: 120_000 }, async (context) => {
    const postgres = await createPostgresTestSupport().start();
    const db = createPostgresExecutor(postgres.connectionUri);
    const runner = new MigrationRunner(db, registeredMigrations);
    await runner.applyAll();
    await seedEvaluationFixture(postgres.connectionUri);
    const firstDatabase = createPostgresExecutor(postgres.connectionUri);
    const recoveryDatabase = createPostgresExecutor(postgres.connectionUri);
    const leaseDurationMs = 60_000;
    let currentTime = new Date('2026-07-31T00:00:00.000Z');
    let firstCalls = 0;
    let recoveryCalls = 0;
    let releaseFirstGeneration;
    const firstGenerationGate = new Promise((resolve) => { releaseFirstGeneration = resolve; });
    let announceRecoveryClaim;
    const recoveryClaimReached = new Promise((resolve) => { announceRecoveryClaim = resolve; });
    let releaseRecoveryClaim;
    const recoveryClaimGate = new Promise((resolve) => { releaseRecoveryClaim = resolve; });
    let announceAbandonedPersistence;
    const abandonedPersistenceReached = new Promise((resolve) => { announceAbandonedPersistence = resolve; });
    let recoveryPaused = false;
    let abandonedPaused = false;
    const firstExecutor = interceptTransactionQueries(firstDatabase, async (statement) => {
        if (!abandonedPaused
            && statement.includes('SELECT id')
            && statement.includes('FROM outbox_event')
            && statement.includes('FOR UPDATE')) {
            abandonedPaused = true;
            announceAbandonedPersistence();
        }
    });
    const recoveryExecutor = interceptTransactionQueries(recoveryDatabase, async (statement) => {
        if (!recoveryPaused && statement.includes('SELECT COUNT(message.id)')) {
            recoveryPaused = true;
            announceRecoveryClaim();
            await recoveryClaimGate;
        }
    });
    const now = () => currentTime;
    const firstWorker = await createEvaluationWorker(firstExecutor, {
        leaseDurationMs,
        now,
        generator: {
            async generate() {
                firstCalls += 1;
                await firstGenerationGate;
                return { schemaVersion: 'evaluation-report/v1', score: 10, owner: 'abandoned' };
            },
        },
    });
    const recoveryWorker = await createEvaluationWorker(recoveryExecutor, {
        leaseDurationMs,
        now,
        generator: {
            async generate() {
                recoveryCalls += 1;
                return { schemaVersion: 'evaluation-report/v1', score: 100, owner: 'recovery' };
            },
        },
    });
    context.after(async () => {
        await firstDatabase.close();
        await recoveryDatabase.close();
        await db.close();
        await postgres.stop();
    });
    const abandonedPoll = firstWorker.pollOnce();
    while (firstCalls === 0)
        await new Promise((resolve) => setTimeout(resolve, 5));
    currentTime = new Date(currentTime.getTime() + leaseDurationMs + 1);
    const recoveryPoll = recoveryWorker.pollOnce();
    await recoveryClaimReached;
    releaseFirstGeneration();
    await abandonedPersistenceReached;
    releaseRecoveryClaim();
    while (recoveryCalls === 0)
        await new Promise((resolve) => setTimeout(resolve, 5));
    const [abandoned, recovered] = await Promise.all([abandonedPoll, recoveryPoll]);
    assert.equal(abandoned.succeeded, 0);
    assert.equal(recovered.succeeded, 1);
    const { rows } = await db.query(`SELECT COUNT(*)::text AS count, MAX(report->>'owner') AS owner
     FROM evaluation_report
     WHERE conversation_id = $1 AND organization_id = $2`, [CONV_ID, ORG_A]);
    assert.deepEqual(rows[0], { count: '1', owner: 'recovery' });
});
test('an expired claim at the attempt limit becomes terminal without another generator call', { timeout: 120_000 }, async (context) => {
    const postgres = await createPostgresTestSupport().start();
    const db = createPostgresExecutor(postgres.connectionUri);
    const runner = new MigrationRunner(db, registeredMigrations);
    await runner.applyAll();
    await seedEvaluationFixture(postgres.connectionUri);
    await db.query(`UPDATE outbox_event
     SET status = 'processing',
         claimed_at = '2026-07-30T00:00:00.000Z',
         lease_expires_at = '2026-07-30T00:01:00.000Z',
         claim_token = $1
     WHERE id = $1 AND organization_id = $2`, [OUTBOX_ID, ORG_A]);
    await db.query(`UPDATE evaluation_job
     SET status = 'running',
         attempt_count = 3,
         updated_at = '2026-07-30T00:00:00.000Z',
         claimed_at = '2026-07-30T00:00:00.000Z',
         lease_expires_at = '2026-07-30T00:01:00.000Z',
         claim_token = $1
     WHERE id = $1 AND organization_id = $2`, [JOB_ID, ORG_A]);
    let generatorCalls = 0;
    const worker = await createEvaluationWorker(db, {
        now: () => new Date('2026-07-31T00:00:00.000Z'),
        generator: {
            async generate() {
                generatorCalls += 1;
                return { schemaVersion: 'evaluation-report/v1', score: 100 };
            },
        },
    });
    context.after(async () => {
        await db.close();
        await postgres.stop();
    });
    const result = await worker.pollOnce();
    assert.deepEqual(result, { scanned: 1, dispatched: 1, succeeded: 0, failed: 1 });
    assert.equal(generatorCalls, 0, 'a fourth evaluation attempt must never start');
    const { rows: jobRows } = await db.query('SELECT status, attempt_count::text AS "attemptCount" FROM evaluation_job WHERE id = $1 AND organization_id = $2', [JOB_ID, ORG_A]);
    assert.deepEqual(jobRows[0], { status: 'failed', attemptCount: '3' });
    const { rows: eventRows } = await db.query('SELECT status FROM outbox_event WHERE id = $1 AND organization_id = $2', [OUTBOX_ID, ORG_A]);
    assert.equal(eventRows[0]?.status, 'failed');
    assert.equal((await worker.pollOnce()).scanned, 0, 'terminal crash exhaustion must not be replayed');
});
test('two workers do not invoke the generator twice for duplicate evaluation events', { timeout: 120_000 }, async (context) => {
    const postgres = await createPostgresTestSupport().start();
    const db = createPostgresExecutor(postgres.connectionUri);
    const runner = new MigrationRunner(db, registeredMigrations);
    await runner.applyAll();
    await seedEvaluationFixture(postgres.connectionUri);
    const duplicateEventId = '11111111-1111-1111-1111-111111111181';
    await db.query(`INSERT INTO outbox_event (id, organization_id, aggregate_type, aggregate_id, event_type, payload, deduplication_key, status)
     VALUES ($1, $2, 'evaluation', $3, 'evaluation.requested', $4::jsonb, $5, 'pending')`, [duplicateEventId, ORG_A, CONV_ID, JSON.stringify({ conversationId: CONV_ID, jobId: JOB_ID }), `evaluation:${CONV_ID}:duplicate`]);
    let calls = 0;
    let release;
    const gate = new Promise((resolve) => { release = resolve; });
    const generator = {
        async generate() {
            calls += 1;
            await gate;
            return { schemaVersion: 'evaluation-report/v1', score: 100 };
        },
    };
    const firstDatabase = createPostgresExecutor(postgres.connectionUri);
    const secondDatabase = createPostgresExecutor(postgres.connectionUri);
    const first = await createEvaluationWorker(firstDatabase, { generator });
    const second = await createEvaluationWorker(secondDatabase, { generator });
    context.after(async () => {
        await firstDatabase.close();
        await secondDatabase.close();
        await db.close();
        await postgres.stop();
    });
    const firstPoll = first.pollOnce();
    while (calls === 0)
        await new Promise((resolve) => setTimeout(resolve, 5));
    const secondPoll = second.pollOnce();
    try {
        await new Promise((resolve) => setTimeout(resolve, 25));
        assert.equal(calls, 1, 'the second worker must not invoke generator while job is running');
    }
    finally {
        release();
    }
    await Promise.all([firstPoll, secondPoll]);
    const { rows: reports } = await db.query('SELECT COUNT(*)::text AS count FROM evaluation_report WHERE conversation_id = $1', [CONV_ID]);
    assert.equal(reports[0]?.count, '1');
    const { rows: duplicateEvents } = await db.query('SELECT status FROM outbox_event WHERE id = $1', [duplicateEventId]);
    assert.equal(duplicateEvents[0]?.status, 'published');
});
test('same conversation cannot produce two evaluation reports', { timeout: 120_000 }, async (context) => {
    const postgres = await createPostgresTestSupport().start();
    const db = createPostgresExecutor(postgres.connectionUri);
    const runner = new MigrationRunner(db, registeredMigrations);
    await runner.applyAll();
    await seedEvaluationFixture(postgres.connectionUri);
    context.after(async () => {
        await db.close();
        await postgres.stop();
    });
    const consumer = await createEvaluationWorker(db);
    await consumer.pollOnce();
    const outboxId2 = '11111111-1111-1111-1111-111111111181';
    await db.query(`INSERT INTO outbox_event (id, organization_id, aggregate_type, aggregate_id, event_type, payload, deduplication_key, status)
     VALUES ($1, $2, 'evaluation', $3, 'evaluation.requested', $4::jsonb, $5, 'pending')`, [outboxId2, ORG_A, CONV_ID, JSON.stringify({ conversationId: CONV_ID, jobId: JOB_ID }), `evaluation:${CONV_ID}:2`]);
    const secondAttempt = await consumer.pollOnce();
    assert.equal(secondAttempt.scanned, 1);
    const { rows: reports } = await db.query('SELECT COUNT(*)::text AS count FROM evaluation_report WHERE conversation_id = $1', [CONV_ID]);
    assert.equal(reports[0]?.count, '1');
});
test('published evaluation_report cannot be updated or deleted (DB constraint)', { timeout: 120_000 }, async (context) => {
    const postgres = await createPostgresTestSupport().start();
    const db = createPostgresExecutor(postgres.connectionUri);
    const runner = new MigrationRunner(db, registeredMigrations);
    await runner.applyAll();
    await seedEvaluationFixture(postgres.connectionUri);
    context.after(async () => {
        await db.close();
        await postgres.stop();
    });
    const consumer = await createEvaluationWorker(db);
    await consumer.pollOnce();
    const { rows: reportRows } = await db.query('SELECT id FROM evaluation_report WHERE conversation_id = $1', [CONV_ID]);
    const reportId = reportRows[0]?.id;
    assert.ok(reportId, 'Report should exist');
    let updateError;
    try {
        await db.query('UPDATE evaluation_report SET report = \'{}\'::jsonb WHERE id = $1', [reportId]);
    }
    catch (error) {
        updateError = error;
    }
    assert.ok(updateError, 'UPDATE should be rejected by trigger');
    let deleteError;
    try {
        await db.query('DELETE FROM evaluation_report WHERE id = $1', [reportId]);
    }
    catch (error) {
        deleteError = error;
    }
    assert.ok(deleteError, 'DELETE should be rejected by trigger');
});
test('worker retries a transient evaluator failure up to its successful delivery', { timeout: 120_000 }, async (context) => {
    const postgres = await createPostgresTestSupport().start();
    const db = createPostgresExecutor(postgres.connectionUri);
    const runner = new MigrationRunner(db, registeredMigrations);
    await runner.applyAll();
    context.after(async () => {
        await db.close();
        await postgres.stop();
    });
    await seedEvaluationFixture(postgres.connectionUri);
    let callCount = 0;
    const consumer = await createEvaluationWorker(db, {
        generator: {
            async generate() {
                callCount += 1;
                if (callCount < 3) {
                    throw Object.assign(new Error('temporary evaluator failure'), { retryable: true });
                }
                return { schemaVersion: 'evaluation-report/v1', score: 100 };
            },
        },
    });
    await consumer.pollOnce();
    let jobRows = await db.query('SELECT status, attempt_count::text AS "attemptCount" FROM evaluation_job WHERE id = $1', [JOB_ID]);
    assert.deepEqual(jobRows.rows[0], { status: 'retryable_failed', attemptCount: '1' });
    await consumer.pollOnce();
    jobRows = await db.query('SELECT status, attempt_count::text AS "attemptCount" FROM evaluation_job WHERE id = $1', [JOB_ID]);
    assert.deepEqual(jobRows.rows[0], { status: 'retryable_failed', attemptCount: '2' });
    await consumer.pollOnce();
    const { rows: completedJobRows } = await db.query('SELECT status, attempt_count::text AS "attemptCount" FROM evaluation_job WHERE id = $1', [JOB_ID]);
    assert.deepEqual(completedJobRows[0], { status: 'succeeded', attemptCount: '3' });
    assert.equal((await consumer.pollOnce()).scanned, 0, 'succeeded job must not be retried');
});
test('worker terminally fails an always-retryable evaluator after the retry limit', { timeout: 120_000 }, async (context) => {
    const postgres = await createPostgresTestSupport().start();
    const db = createPostgresExecutor(postgres.connectionUri);
    const runner = new MigrationRunner(db, registeredMigrations);
    await runner.applyAll();
    await seedEvaluationFixture(postgres.connectionUri);
    context.after(async () => {
        await db.close();
        await postgres.stop();
    });
    const consumer = await createEvaluationWorker(db, {
        generator: { async generate() { throw Object.assign(new Error('temporary evaluator failure'), { retryable: true }); } },
    });
    await consumer.pollOnce();
    await consumer.pollOnce();
    await consumer.pollOnce();
    const { rows: jobRows } = await db.query('SELECT status, attempt_count::text AS "attemptCount" FROM evaluation_job WHERE id = $1', [JOB_ID]);
    assert.deepEqual(jobRows[0], { status: 'failed', attemptCount: '3' });
    const { rows: eventRows } = await db.query('SELECT status FROM outbox_event WHERE id = $1', [OUTBOX_ID]);
    assert.equal(eventRows[0]?.status, 'failed');
    assert.equal((await consumer.pollOnce()).scanned, 0, 'terminal failure must not be retried');
});
test('C-end streamer can only read own evaluation report', { timeout: 120_000 }, async (context) => {
    const postgres = await createPostgresTestSupport().start();
    const db = createPostgresExecutor(postgres.connectionUri);
    const runner = new MigrationRunner(db, registeredMigrations);
    await runner.applyAll();
    await seedEvaluationFixture(postgres.connectionUri);
    const app = await createApp(postgres.connectionUri);
    context.after(async () => {
        await app.close();
        await db.close();
        await postgres.stop();
    });
    const consumer = await createEvaluationWorker(db);
    await consumer.pollOnce();
    const ok = await request(app.getHttpServer())
        .get(`/me/evaluations/${CONV_ID}`)
        .set('x-access-token', STREAMER_A)
        .expect(200);
    assert.ok(ok.body.id);
    const other = await request(app.getHttpServer())
        .get(`/me/evaluations/${CONV_ID}`)
        .set('x-access-token', STREAMER_A_OTHER)
        .expect(404);
    assert.equal(other.body.code, 'EVALUATION_NOT_FOUND');
    const crossOrg = await request(app.getHttpServer())
        .get(`/me/evaluations/${CONV_ID}`)
        .set('x-access-token', ADMIN_B)
        .expect(404);
    assert.equal(crossOrg.body.code, 'EVALUATION_NOT_FOUND');
});
test('admin can only read evaluations from own organization', { timeout: 120_000 }, async (context) => {
    const postgres = await createPostgresTestSupport().start();
    const db = createPostgresExecutor(postgres.connectionUri);
    const runner = new MigrationRunner(db, registeredMigrations);
    await runner.applyAll();
    await seedEvaluationFixture(postgres.connectionUri);
    const app = await createApp(postgres.connectionUri);
    context.after(async () => {
        await app.close();
        await db.close();
        await postgres.stop();
    });
    const consumer = await createEvaluationWorker(db);
    await consumer.pollOnce();
    const adminA = await request(app.getHttpServer())
        .get('/admin/evaluations')
        .set('x-access-token', ADMIN_A)
        .expect(200);
    assert.ok(!Array.isArray(adminA.body), 'T22 起评估列表为分页包裹结构');
    assert.ok(Array.isArray(adminA.body.items));
    assert.ok(adminA.body.items.length >= 1);
    assert.ok(adminA.body.items[0].conversationId, '列表行以 conversationId 串联回放');
    const orgAConversationIds = new Set(adminA.body.items.map((e) => e.conversationId));
    const adminB = await request(app.getHttpServer())
        .get('/admin/evaluations')
        .set('x-access-token', ADMIN_B)
        .expect(200);
    assert.ok(Array.isArray(adminB.body.items));
    const orgBSeesOrgA = adminB.body.items.some((e) => orgAConversationIds.has(e.conversationId));
    assert.equal(orgBSeesOrgA, false, 'Admin B should not see Org A evaluations');
});
test('conversation end triggers evaluation_job and outbox_event creation', { timeout: 120_000 }, async (context) => {
    const postgres = await createPostgresTestSupport().start();
    const db = createPostgresExecutor(postgres.connectionUri);
    const runner = new MigrationRunner(db, registeredMigrations);
    await runner.applyAll();
    await seedEvaluationFixture(postgres.connectionUri);
    const app = await createApp(postgres.connectionUri);
    context.after(async () => {
        await app.close();
        await db.close();
        await postgres.stop();
    });
    const CONV_ID_NEW = '33333333-3333-3333-3333-333333333360';
    const LEARNER_ASSIGNMENT_NEW = '33333333-3333-3333-3333-333333333340';
    const ATTEMPT_NEW = '33333333-3333-3333-3333-333333333350';
    const SESSION_NEW = '33333333-3333-3333-3333-333333333370';
    await db.query(`INSERT INTO learner_assignment (id, organization_id, assignment_id, learner_id, state, total_attempts, active_attempt_id)
     VALUES ($1, $2, '11111111-1111-1111-1111-111111111130', $3, 'active', 0, $4)`, [LEARNER_ASSIGNMENT_NEW, ORG_A, deriveLearnerId('streamer-002'), ATTEMPT_NEW]);
    await db.query(`INSERT INTO learner_profile (internal_learner_id, organization_id, external_principal_id, identity_provider)
     VALUES ($1, $2, 'streamer-002', 'gongzhugou') ON CONFLICT DO NOTHING`, [deriveLearnerId('streamer-002'), ORG_A]);
    await db.query(`INSERT INTO training_attempt (id, organization_id, learner_assignment_id, idempotency_key, status)
     VALUES ($1, $2, $3, 'start-new', 'created')`, [ATTEMPT_NEW, ORG_A, LEARNER_ASSIGNMENT_NEW]);
    await db.query(`INSERT INTO training_session (id, organization_id, learner_id, source_type, mode, release_snapshot_id, assignment_id, learner_assignment_id, training_attempt_id, persona_snapshot, status, idempotency_key)
     VALUES ($1, $2, $3, 'assigned', 'practice', '11111111-1111-1111-1111-111111111120', '11111111-1111-1111-1111-111111111130', $4, $5, '{}'::jsonb, 'active', 'end-eval-session')`, [SESSION_NEW, ORG_A, deriveLearnerId('streamer-002'), LEARNER_ASSIGNMENT_NEW, ATTEMPT_NEW]);
    await db.query(`INSERT INTO conversation (id, organization_id, training_attempt_id, release_snapshot_id, training_session_id, status, version, last_sequence)
     VALUES ($1, $2, $3, '11111111-1111-1111-1111-111111111120', $4, 'active', 1, 0)`, [CONV_ID_NEW, ORG_A, ATTEMPT_NEW, SESSION_NEW]);
    await request(app.getHttpServer())
        .post(`/me/conversations/${CONV_ID_NEW}/end`)
        .set('x-access-token', 'fixture:identity:streamer-organization-a-other')
        .expect(201);
    const { rows: jobs } = await db.query('SELECT id FROM evaluation_job WHERE conversation_id = $1', [CONV_ID_NEW]);
    assert.equal(jobs.length, 1, 'evaluation_job should be created');
    const { rows: outbox } = await db.query("SELECT id, event_type AS \"eventType\", status FROM outbox_event WHERE aggregate_id = $1 AND event_type = 'evaluation.requested'", [CONV_ID_NEW]);
    assert.equal(outbox.length, 1, 'outbox_event should be created');
    assert.equal(outbox[0]?.status, 'pending');
});
test('learner can read a free-session evaluation report through the session root, others cannot', { timeout: 120_000 }, async (context) => {
    const postgres = await createPostgresTestSupport().start();
    const db = createPostgresExecutor(postgres.connectionUri);
    const runner = new MigrationRunner(db, registeredMigrations);
    await runner.applyAll();
    const app = await createApp(postgres.connectionUri);
    context.after(async () => {
        await app.close();
        await db.close();
        await postgres.stop();
    });
    const CONV_FREE = '44444444-4444-4444-4444-444444444460';
    const SESSION_FREE = '44444444-4444-4444-4444-444444444470';
    const JOB_FREE = '44444444-4444-4444-4444-444444444471';
    const REPORT_FREE = '44444444-4444-4444-4444-444444444472';
    await db.query(`INSERT INTO learner_profile (internal_learner_id, organization_id, external_principal_id, identity_provider)
     VALUES ($2, $1, 'streamer-001', 'gongzhugou') ON CONFLICT DO NOTHING`, [ORG_A, deriveLearnerId('streamer-001')]);
    await db.query(`INSERT INTO training_session (id, organization_id, learner_id, source_type, mode, persona_snapshot, status, idempotency_key)
     VALUES ($1, $2, $3, 'free', 'practice', '{}'::jsonb, 'ended', 'free-report-session')`, [SESSION_FREE, ORG_A, deriveLearnerId('streamer-001')]);
    await db.query(`INSERT INTO conversation (id, organization_id, training_session_id, status, version, last_sequence)
     VALUES ($1, $2, $3, 'ended', 1, 1)`, [CONV_FREE, ORG_A, SESSION_FREE]);
    await db.query(`INSERT INTO evaluation_job (id, organization_id, conversation_id, status, attempt_count)
     VALUES ($1, $2, $3, 'succeeded', 1)`, [JOB_FREE, ORG_A, CONV_FREE]);
    await db.query(`INSERT INTO evaluation_report (id, organization_id, conversation_id, evaluation_job_id, status, report)
     VALUES ($1, $2, $3, $4, 'published', '{"schemaVersion":"evaluation-report/v1","score":88}'::jsonb)`, [REPORT_FREE, ORG_A, CONV_FREE, JOB_FREE]);
    const mine = await request(app.getHttpServer())
        .get(`/me/evaluations/${CONV_FREE}`)
        .set('x-access-token', STREAMER_A)
        .expect(200);
    assert.equal(mine.body.id, REPORT_FREE);
    const otherLearner = await request(app.getHttpServer())
        .get(`/me/evaluations/${CONV_FREE}`)
        .set('x-access-token', STREAMER_A_OTHER)
        .expect(404);
    assert.equal(otherLearner.body.code, 'EVALUATION_NOT_FOUND');
    const crossOrg = await request(app.getHttpServer())
        .get(`/me/evaluations/${CONV_FREE}`)
        .set('x-access-token', ADMIN_B)
        .expect(404);
    assert.equal(crossOrg.body.code, 'EVALUATION_NOT_FOUND');
});
async function seedScoringChain(dbUrl, kind, ids) {
    const db = createPostgresExecutor(dbUrl);
    const messageId = `${ids.conversation.slice(0, -1)}9`;
    const assignmentId = `${ids.conversation.slice(0, -1)}3`;
    await db.query(`INSERT INTO learner_profile (internal_learner_id, organization_id, external_principal_id, identity_provider)
     VALUES ($2, $1, 'streamer-001', 'gongzhugou') ON CONFLICT DO NOTHING`, [ORG_A, deriveLearnerId('streamer-001')]);
    if (kind === 'free') {
        await db.query(`INSERT INTO training_session (id, organization_id, learner_id, source_type, mode, persona_snapshot, status, idempotency_key)
       VALUES ($1, $2, $3, 'free', 'practice', '{}'::jsonb, 'ended', $4)`, [ids.session, ORG_A, deriveLearnerId('streamer-001'), `key-${ids.session}`]);
        await db.query(`INSERT INTO conversation (id, organization_id, training_session_id, status, version, last_sequence)
       VALUES ($1, $2, $3, 'ended', 1, 1)`, [ids.conversation, ORG_A, ids.session]);
    }
    else {
        await db.query(`INSERT INTO assignment (id, organization_id, release_snapshot_id, name, status, starts_at, ends_at, max_attempts, target_principal_ids)
       VALUES ($1, $2, '11111111-1111-1111-1111-111111111120', 'second assigned task', 'active',
         CURRENT_TIMESTAMP, CURRENT_TIMESTAMP + INTERVAL '1 day', 3, '[]'::jsonb)`, [assignmentId, ORG_A]);
        await db.query(`INSERT INTO learner_assignment (id, organization_id, assignment_id, learner_id, state, total_attempts, active_attempt_id)
       VALUES ($1, $2, $3, $4, 'active', 0, $5)`, [ids.learnerAssignment, ORG_A, assignmentId, deriveLearnerId('streamer-001'), ids.attempt]);
        await db.query(`INSERT INTO training_attempt (id, organization_id, learner_assignment_id, idempotency_key, status)
       VALUES ($1, $2, $3, $4, 'created')`, [ids.attempt, ORG_A, ids.learnerAssignment, `key-${ids.attempt}`]);
        await db.query(`INSERT INTO training_session (id, organization_id, learner_id, source_type, mode, release_snapshot_id, assignment_id, learner_assignment_id, training_attempt_id, persona_snapshot, status, idempotency_key)
       VALUES ($1, $2, $3, 'assigned', 'practice', '11111111-1111-1111-1111-111111111120', $4, $5, $6, '{}'::jsonb, 'ended', $7)`, [ids.session, ORG_A, deriveLearnerId('streamer-001'), assignmentId, ids.learnerAssignment, ids.attempt, `key-${ids.session}`]);
        await db.query(`INSERT INTO conversation (id, organization_id, training_attempt_id, release_snapshot_id, training_session_id, status, version, last_sequence)
       VALUES ($1, $2, $3, '11111111-1111-1111-1111-111111111120', $4, 'ended', 1, 1)`, [ids.conversation, ORG_A, ids.attempt, ids.session]);
    }
    await db.query(`INSERT INTO conversation_message (id, organization_id, conversation_id, sequence, client_message_id, role, content, request_hash)
     VALUES ($1, $2, $3, 1, 'm-1', 'learner', 'hello', 'h1')`, [messageId, ORG_A, ids.conversation]);
    await db.query(`INSERT INTO evaluation_job (id, organization_id, conversation_id, status, attempt_count)
     VALUES ($1, $2, $3, 'queued', 0)`, [ids.job, ORG_A, ids.conversation]);
    await db.query(`INSERT INTO outbox_event (id, organization_id, aggregate_type, aggregate_id, event_type, payload, deduplication_key, status)
     VALUES ($1, $2, 'evaluation', $3, 'evaluation.requested', $4::jsonb, $5, 'pending')`, [ids.event, ORG_A, ids.conversation, JSON.stringify({ conversationId: ids.conversation, jobId: ids.job }), `evaluation:${ids.conversation}`]);
    await db.close();
}
test('free evaluation writes back the free counter/score once, aggregates dimensions and scores the session', { timeout: 120_000 }, async (context) => {
    const postgres = await createPostgresTestSupport().start();
    const db = createPostgresExecutor(postgres.connectionUri);
    await new MigrationRunner(db, registeredMigrations).applyAll();
    const ids = {
        conversation: '55555555-5555-5555-5555-555555555560',
        session: '55555555-5555-5555-5555-555555555570',
        job: '55555555-5555-5555-5555-555555555571',
        event: '55555555-5555-5555-5555-555555555572',
    };
    await seedScoringChain(postgres.connectionUri, 'free', ids);
    context.after(async () => {
        await db.close();
        await postgres.stop();
    });
    let calls = 0;
    const worker = await createEvaluationWorker(db, {
        generator: {
            async generate() {
                calls += 1;
                return { schemaVersion: 'evaluation-report/v1', score: 80, dimensionScores: { opening: 70, closing: 90 } };
            },
        },
    });
    const first = await worker.pollOnce();
    assert.deepEqual(first, { scanned: 1, dispatched: 1, succeeded: 1, failed: 0 });
    const profile = await db.query(`SELECT total_free_sessions AS "total_free", total_assigned_sessions AS "total_assigned",
            avg_score::text AS avg, dimension_scores AS dims, weak_points AS weak
     FROM learner_profile WHERE internal_learner_id = $1 AND organization_id = $2`, [deriveLearnerId('streamer-001'), ORG_A]);
    assert.equal(profile.rows[0]?.total_free, 1);
    assert.equal(profile.rows[0]?.total_assigned, 0);
    assert.equal(Number(profile.rows[0]?.avg), 80);
    assert.deepEqual(profile.rows[0]?.dims, { opening: { score: 70, samples: 1 }, closing: { score: 90, samples: 1 } });
    assert.deepEqual(profile.rows[0]?.weak, ['opening', 'closing']);
    const session = await db.query('SELECT status FROM training_session WHERE id = $1', [ids.session]);
    assert.equal(session.rows[0]?.status, 'scored');
    // Re-polling the already-published event must not double-count.
    const second = await worker.pollOnce();
    assert.equal(second.scanned, 0);
    assert.equal(calls, 1);
    const after = await db.query('SELECT total_free_sessions AS "total_free" FROM learner_profile WHERE internal_learner_id = $1', [deriveLearnerId('streamer-001')]);
    assert.equal(after.rows[0]?.total_free, 1);
});
test('assigned evaluations increment the assigned counter and incrementally average score and dimensions', { timeout: 120_000 }, async (context) => {
    const postgres = await createPostgresTestSupport().start();
    const db = createPostgresExecutor(postgres.connectionUri);
    await new MigrationRunner(db, registeredMigrations).applyAll();
    await seedEvaluationFixture(postgres.connectionUri); // supplies snapshot/assignment + learner profile + its own queued job
    context.after(async () => {
        await db.close();
        await postgres.stop();
    });
    // First assigned completion uses the fixture's own conversation/job/event (score 60).
    const secondChain = {
        conversation: '66666666-6666-6666-6666-666666666660',
        session: '66666666-6666-6666-6666-666666666670',
        job: '66666666-6666-6666-6666-666666666671',
        event: '66666666-6666-6666-6666-666666666672',
        learnerAssignment: '66666666-6666-6666-6666-666666666640',
        attempt: '66666666-6666-6666-6666-666666666650',
    };
    await seedScoringChain(postgres.connectionUri, 'assigned', secondChain);
    let calls = 0;
    const worker = await createEvaluationWorker(db, {
        generator: {
            async generate() {
                calls += 1;
                return calls === 1
                    ? { schemaVersion: 'evaluation-report/v1', score: 60, dimensionScores: { opening: 60 } }
                    : { schemaVersion: 'evaluation-report/v1', score: 80, dimensionScores: { opening: 80, objection: 100 } };
            },
        },
    });
    await worker.pollOnce(); // fixture conversation (CONV_ID)
    await worker.pollOnce(); // secondChain
    const profile = await db.query(`SELECT total_free_sessions AS "total_free", total_assigned_sessions AS "total_assigned",
            avg_score::text AS avg, dimension_scores AS dims, weak_points AS weak
     FROM learner_profile WHERE internal_learner_id = $1 AND organization_id = $2`, [deriveLearnerId('streamer-001'), ORG_A]);
    assert.equal(profile.rows[0]?.total_assigned, 2);
    assert.equal(profile.rows[0]?.total_free, 0);
    assert.equal(Number(profile.rows[0]?.avg), 70, 'average of 60 and 80 is 70');
    assert.deepEqual(profile.rows[0]?.dims.opening, { score: 70, samples: 2 });
    assert.deepEqual(profile.rows[0]?.dims.objection, { score: 100, samples: 1 });
    assert.deepEqual(profile.rows[0]?.weak, ['opening', 'objection']);
});
