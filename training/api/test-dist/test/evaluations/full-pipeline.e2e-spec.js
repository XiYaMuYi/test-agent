import assert from 'node:assert/strict';
import test from 'node:test';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../../src/app.module.js';
import { FakeModelAdapter } from '../../src/adapters/fake-model.adapter.js';
import { createPostgresExecutor, MigrationRunner, registeredMigrations } from '../../src/database/migrations/index.js';
import { createPostgresTestSupport } from '../support/postgres.js';
const STREAMER = 'fixture:identity:valid';
async function createApp(databaseUrl) {
    process.env.DATABASE_URL = databaseUrl;
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
        .overrideProvider(FakeModelAdapter)
        .useValue(new FakeModelAdapter({ scenario: 'success' }))
        .compile();
    const app = moduleRef.createNestApplication();
    await app.init();
    return app;
}
async function createEvaluationWorker(database) {
    const dynamicImport = new Function('path', 'return import(path)');
    const workerModule = await dynamicImport('../../../../worker/dist/worker.module.js');
    // Explicitly wire the real rule-based generator so the e2e asserts the actual
    // five-dimension scoring path (never relying on — or hiding regressions in —
    // the processor's default selection).
    const generatorModule = await dynamicImport('../../../../worker/dist/jobs/rule-evaluation-generator.js');
    const Generator = generatorModule.RuleBasedEvaluationReportGenerator;
    const createWorkerModule = workerModule.createWorkerModule;
    return createWorkerModule({ evaluationExecutor: database, evaluationGenerator: new Generator() });
}
function validBody() {
    return {
        persona: { ageCardId: 'young-lady', psychologyCardIds: [], difficulty: 2, productScenarioId: 'anti-aging' },
    };
}
async function waitForPublishedReport(db, conversationId, timeoutMs = 30_000) {
    const started = Date.now();
    while (Date.now() - started < timeoutMs) {
        const { rows } = await db.query('SELECT status FROM outbox_event WHERE aggregate_id = $1 AND event_type = $2', [conversationId, 'evaluation.requested']);
        if (rows[0]?.status === 'published')
            return;
        if (rows[0]?.status === 'failed')
            throw new Error('outbox_event reached failed status');
        await new Promise((resolve) => setTimeout(resolve, 100));
    }
    throw new Error(`evaluation_report not published within ${timeoutMs}ms`);
}
test('full pipeline: free session -> messages -> end -> published report with five-dimension scores and learner profile write-back', { timeout: 180_000 }, async (context) => {
    const postgres = await createPostgresTestSupport().start();
    const db = createPostgresExecutor(postgres.connectionUri);
    await new MigrationRunner(db, registeredMigrations).applyAll();
    const app = await createApp(postgres.connectionUri);
    context.after(async () => {
        await app.close();
        await db.close();
        await postgres.stop();
    });
    // 1. Create free session.
    const started = await request(app.getHttpServer())
        .post('/me/sessions/free')
        .set('x-access-token', STREAMER)
        .set('Idempotency-Key', 'full-pipeline-free-1')
        .send(validBody())
        .expect(201);
    const conversationId = started.body.conversationId;
    assert.equal(started.body.sourceType, 'free');
    // 2. Send several messages containing evaluation-triggering keywords.
    //    The rule-based evaluator scores based on DISCOVERY/PRODUCT/CLOSING keywords
    //    in learner text and OBJECTION keywords in assistant text.
    const messages = [
        { sequence: 1, content: '你好，我想了解下你们这款抗衰老的产品，不知道适不适合我的需求？' },
        { sequence: 2, content: '我主要关注皮肤松弛和细纹问题，预算在500左右，有什么成分推荐吗？' },
        { sequence: 3, content: '听起来不错，因为你们的产品口碑挺好的，可以给我详细介绍下吗？' },
        { sequence: 4, content: '好的，那我先下单试试，想购买一套看看效果。' },
    ];
    for (const msg of messages) {
        const sent = await request(app.getHttpServer())
            .post(`/me/conversations/${conversationId}/messages`)
            .set('x-access-token', STREAMER)
            .send({ clientMessageId: `full-pipeline-msg-${msg.sequence}`, sequence: msg.sequence, content: msg.content })
            .expect(201);
        assert.equal(sent.body.sequence, msg.sequence);
        assert.equal(sent.body.suggestion.schemaVersion, 'agent-output/v1');
    }
    // 3. Trigger end — this creates the evaluation_job and outbox_event.
    await request(app.getHttpServer())
        .post(`/me/conversations/${conversationId}/end`)
        .set('x-access-token', STREAMER)
        .expect(201);
    // Verify evaluation_job and outbox_event were created.
    const { rows: jobsAfterEnd } = await db.query('SELECT id, status FROM evaluation_job WHERE conversation_id = $1', [conversationId]);
    assert.equal(jobsAfterEnd.length, 1, 'evaluation_job must be created on end');
    const { rows: outboxAfterEnd } = await db.query("SELECT id, status FROM outbox_event WHERE aggregate_id = $1 AND event_type = 'evaluation.requested'", [conversationId]);
    assert.equal(outboxAfterEnd.length, 1, 'outbox_event must be created on end');
    assert.equal(outboxAfterEnd[0]?.status, 'pending');
    // 4. Poll the evaluation worker until the report is published.
    const worker = await createEvaluationWorker(db);
    for (let iterations = 0; iterations < 30; iterations += 1) {
        await worker.pollOnce();
        const { rows } = await db.query('SELECT status FROM outbox_event WHERE aggregate_id = $1 AND event_type = $2', [conversationId, 'evaluation.requested']);
        if (rows[0]?.status === 'published')
            break;
        if (rows[0]?.status === 'failed')
            throw new Error('evaluation outbox reached failed status');
    }
    // 5. Assert outbox_event status is 'published'.
    await waitForPublishedReport(db, conversationId);
    // 6. Fetch the report and assert structure.
    const { rows: reportRows } = await db.query('SELECT id, status, report FROM evaluation_report WHERE conversation_id = $1', [conversationId]);
    assert.equal(reportRows.length, 1, 'exactly one evaluation_report must be persisted');
    const report = reportRows[0];
    assert.ok(report, 'report must exist');
    assert.equal(report.status, 'published');
    const body = report.report;
    assert.equal(body.schemaVersion, 'evaluation-report/v1');
    // 6a. Five-dimension dimensionScores.
    const expectedDimensions = [
        'needs_discovery',
        'product_presentation',
        'objection_handling',
        'emotion_management',
        'closing_ability',
    ];
    assert.ok(body.dimensionScores, 'report must contain dimensionScores');
    for (const dim of expectedDimensions) {
        assert.ok(dim in (body.dimensionScores ?? {}), `dimensionScores must contain ${dim}`);
        const value = body.dimensionScores[dim];
        assert.equal(typeof value, 'number', `${dim} must be a number`);
        assert.ok(value >= 0 && value <= 100, `${dim} must be in [0, 100]`);
    }
    // 6b. Score is not hardcoded to 100 or 0 — it must reflect the transcript content.
    assert.equal(typeof body.score, 'number');
    const score = body.score;
    assert.ok(score >= 0 && score <= 100, 'score must be within [0, 100]');
    // With the seeded keyword-rich transcript the rule evaluator should land
    // strictly between the degenerate bounds (not all-zero, not perfect).
    assert.notEqual(score, 0, 'score must not be 0 for a keyword-rich transcript');
    assert.notEqual(score, 100, 'score must not be 100 for a realistic transcript');
    // 6c. highlights/improvements are Chinese arrays.
    assert.ok(Array.isArray(body.highlights), 'highlights must be an array');
    assert.ok(Array.isArray(body.improvements), 'improvements must be an array');
    assert.ok(body.highlights.length > 0 || body.improvements.length > 0, 'at least one of highlights/improvements must be non-empty');
    const chineseRegex = /[一-龥]/;
    for (const item of body.highlights) {
        assert.equal(typeof item, 'string');
        assert.match(item, chineseRegex, `highlight "${item}" must contain Chinese characters`);
    }
    for (const item of body.improvements) {
        assert.equal(typeof item, 'string');
        assert.match(item, chineseRegex, `improvement "${item}" must contain Chinese characters`);
    }
    // 7. Assert learner_profile.dimension_scores was written back.
    const { rows: profileRows } = await db.query(`SELECT total_free_sessions, total_assigned_sessions, avg_score::text AS avg_score,
            dimension_scores, weak_points
     FROM learner_profile
     WHERE external_principal_id = 'streamer-001' AND identity_provider = 'gongzhugou'`);
    assert.equal(profileRows.length, 1, 'learner_profile must exist for the streamer');
    const profile = profileRows[0];
    assert.ok(profile, 'learner_profile row must exist');
    assert.equal(profile.total_free_sessions, 1, 'free session counter must be incremented');
    assert.equal(profile.total_assigned_sessions, 0);
    assert.ok(profile.avg_score !== null, 'avg_score must be set after first evaluation');
    assert.equal(Number(profile.avg_score), score, 'avg_score must match the just-published report score');
    // dimension_scores is an aggregate map (dimension -> { score, samples }).
    assert.ok(typeof profile.dimension_scores === 'object' && profile.dimension_scores !== null);
    for (const dim of expectedDimensions) {
        const entry = profile.dimension_scores[dim];
        assert.ok(entry, `learner_profile.dimension_scores must contain ${dim}`);
        assert.equal(typeof entry.score, 'number');
        assert.equal(typeof entry.samples, 'number');
        assert.equal(entry.samples, 1);
    }
    assert.ok(Array.isArray(profile.weak_points));
});
