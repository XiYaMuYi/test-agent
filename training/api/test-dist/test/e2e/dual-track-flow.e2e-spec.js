import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import test from 'node:test';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { buildDefaultConfig } from '@training/contracts';
import { AppModule } from '../../src/app.module.js';
import { deriveLearnerId } from '../../src/assignments/eligibility.service.js';
import { FakeModelAdapter } from '../../src/adapters/fake-model.adapter.js';
import { createPostgresExecutor, MigrationRunner, registeredMigrations } from '../../src/database/migrations/index.js';
import { createPostgresTestSupport } from '../support/postgres.js';
const ORG_A = '11111111-1111-1111-1111-111111111111';
const STREAMER_A = 'fixture:identity:valid';
const STREAMER_A_OTHER = 'fixture:identity:streamer-organization-a-other';
const ADMIN_A = 'fixture:identity:admin-organization-a';
const LEARNER_A = deriveLearnerId('streamer-001');
const freePersona = () => ({
    persona: { ageCardId: 'young-lady', psychologyCardIds: [], difficulty: 2, productScenarioId: 'anti-aging' },
});
async function createApp(databaseUrl, model) {
    process.env.DATABASE_URL = databaseUrl;
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
        .overrideProvider(FakeModelAdapter)
        .useValue(model ?? new FakeModelAdapter({ scenario: 'success' }))
        .compile();
    const app = moduleRef.createNestApplication();
    await app.init();
    return app;
}
async function createScoringWorker(database, generate) {
    let callIndex = 0;
    const loadWorkerModule = new Function('path', 'return import(path)');
    const { createWorkerModule } = await loadWorkerModule('../../../../worker/dist/worker.module.js');
    return createWorkerModule({
        evaluationExecutor: database,
        evaluationGenerator: { async generate() { return generate(++callIndex); } },
    });
}
/** Model that always cites the one knowledge record the default FakeKnowledge catalog approves. */
const citationModel = {
    async generate(request) {
        return {
            content: JSON.stringify({
                schemaVersion: 'agent-output/v1',
                replyText: `cite-reply:${request.sessionId}`,
                suggestedAction: 'ask_follow_up',
                knowledgeReferences: ['knowledge-welcome@v1'],
                confidence: 0.9,
            }),
            modelVersion: 'citation-fake-v1',
        };
    },
};
async function seedLearnerProfile(db) {
    await db.query(`INSERT INTO learner_profile (internal_learner_id, organization_id, external_principal_id, identity_provider)
     VALUES ($2, $1, 'streamer-001', 'gongzhugou') ON CONFLICT DO NOTHING`, [ORG_A, LEARNER_A]);
}
async function seedPersonalTemplate(db, templateId, knowledgeVersions) {
    await seedLearnerProfile(db);
    await db.query(`INSERT INTO training_template
       (id, organization_id, scope, owner_learner_id, title, persona_config, knowledge_versions, status)
     VALUES ($1, $2, 'personal', $3, $4, $5::jsonb, $6::jsonb, 'active')`, [templateId, ORG_A, LEARNER_A, `tpl-${templateId.slice(0, 8)}`, JSON.stringify(buildDefaultConfig()), JSON.stringify(knowledgeVersions)]);
}
test('dual-track end-to-end: a free then an assigned session for one learner converge into one scored profile', { timeout: 180_000 }, async (context) => {
    const postgres = await createPostgresTestSupport().start();
    const db = createPostgresExecutor(postgres.connectionUri);
    await new MigrationRunner(db, registeredMigrations).applyAll();
    const app = await createApp(postgres.connectionUri);
    // Free track scores 80; assigned track scores 60 → merged average 70.
    const worker = await createScoringWorker(db, async (callIndex) => callIndex === 1
        ? { schemaVersion: 'evaluation-report/v1', score: 80, dimensionScores: { opening: 70, closing: 90 } }
        : { schemaVersion: 'evaluation-report/v1', score: 60, dimensionScores: { opening: 50, objection: 70 } });
    context.after(async () => {
        await app.close();
        await db.close();
        await postgres.stop();
    });
    const http = app.getHttpServer();
    // ---- Free track, fully over HTTP ----
    const freeStart = await request(http)
        .post('/me/sessions/free')
        .set('x-access-token', STREAMER_A)
        .set('Idempotency-Key', 'dual-free-1')
        .send(freePersona())
        .expect(201);
    assert.equal(freeStart.body.sourceType, 'free');
    const freeConv = freeStart.body.conversationId;
    const freeSession = freeStart.body.sessionId;
    await request(http)
        .post(`/me/conversations/${freeConv}/messages`)
        .set('x-access-token', STREAMER_A)
        .send({ clientMessageId: 'dual-f-msg-1', sequence: 1, content: '自由陪练开场' })
        .expect(201);
    await request(http).post(`/me/conversations/${freeConv}/end`).set('x-access-token', STREAMER_A).expect(201);
    const freePoll = await worker.pollOnce();
    assert.equal(freePoll.succeeded, 1, 'free evaluation is consumed by the worker');
    // ---- Assigned track, fully over HTTP (draft → publish → assign → attempt) ----
    const draftId = crypto.randomUUID();
    await request(http)
        .post('/admin/scenarios')
        .set('x-access-token', ADMIN_A)
        .send({
        id: draftId,
        payload: {
            title: '双轨 assigned 任务',
            knowledgeVersions: ['knowledge-welcome@v1'],
            scoringRules: ['rule-a'],
            agentConfig: {},
        },
    })
        .expect(201);
    await request(http).post(`/admin/scenarios/${draftId}/publish`).set('x-access-token', ADMIN_A).expect(201);
    const snapshotRows = await db.query('SELECT id FROM release_snapshot WHERE scenario_draft_id = $1', [draftId]);
    const releaseSnapshotId = snapshotRows.rows[0]?.id;
    assert.ok(releaseSnapshotId);
    const assignmentId = crypto.randomUUID();
    await request(http)
        .post('/admin/assignments')
        .set('x-access-token', ADMIN_A)
        .send({
        id: assignmentId,
        releaseSnapshotId,
        name: '双轨投放',
        status: 'active',
        startsAt: new Date(Date.now() - 60_000).toISOString(),
        endsAt: new Date(Date.now() + 3_600_000).toISOString(),
        maxAttempts: 3,
        targetPrincipalIds: ['streamer-001'],
    })
        .expect(201);
    const assignedStart = await request(http)
        .post(`/me/assignments/${assignmentId}/attempts`)
        .set('x-access-token', STREAMER_A)
        .set('Idempotency-Key', 'dual-assigned-1')
        .expect(201);
    const assignedConv = assignedStart.body.conversationId;
    assert.ok(assignedConv);
    assert.notEqual(assignedConv, freeConv);
    await request(http)
        .post(`/me/conversations/${assignedConv}/messages`)
        .set('x-access-token', STREAMER_A)
        .send({ clientMessageId: 'dual-a-msg-1', sequence: 1, content: '任务陪练开场' })
        .expect(201);
    await request(http).post(`/me/conversations/${assignedConv}/end`).set('x-access-token', STREAMER_A).expect(201);
    const assignedPoll = await worker.pollOnce();
    assert.equal(assignedPoll.succeeded, 1, 'assigned evaluation is consumed by the worker');
    // ---- One learner_profile merges BOTH tracks ----
    const profile = await db.query(`SELECT total_free_sessions AS "totalFree", total_assigned_sessions AS "totalAssigned",
            avg_score::text AS avg, dimension_scores AS dims, weak_points AS weak
     FROM learner_profile WHERE internal_learner_id = $1 AND organization_id = $2`, [LEARNER_A, ORG_A]);
    const row = profile.rows[0];
    assert.ok(row);
    assert.equal(row.totalFree, 1, 'free counter incremented once');
    assert.equal(row.totalAssigned, 1, 'assigned counter incremented once');
    assert.equal(Number(row.avg), 70, 'merged average of 80 and 60 is 70');
    assert.deepEqual(row.dims.opening, { score: 60, samples: 2 }, 'opening aggregates across both tracks');
    assert.deepEqual(row.dims.closing, { score: 90, samples: 1 });
    assert.deepEqual(row.dims.objection, { score: 70, samples: 1 });
    assert.deepEqual(row.weak, ['opening', 'objection', 'closing'], 'weak points ordered ascending across tracks');
    const sessions = await db.query(`SELECT source_type AS "sourceType", status FROM training_session
     WHERE learner_id = $1 AND organization_id = $2 ORDER BY started_at`, [LEARNER_A, ORG_A]);
    assert.deepEqual(sessions.rows, [
        { sourceType: 'free', status: 'scored' },
        { sourceType: 'assigned', status: 'scored' },
    ]);
    // Both reports are readable by the owner through the session root, and isolated from peers.
    const freeReport = await request(http).get(`/me/evaluations/${freeConv}`).set('x-access-token', STREAMER_A).expect(200);
    const assignedReport = await request(http).get(`/me/evaluations/${assignedConv}`).set('x-access-token', STREAMER_A).expect(200);
    assert.equal(freeReport.body.conversationId, freeConv);
    assert.equal(assignedReport.body.conversationId, assignedConv);
    for (const convId of [freeConv, assignedConv]) {
        const peer = await request(http).get(`/me/evaluations/${convId}`).set('x-access-token', STREAMER_A_OTHER).expect(404);
        assert.equal(peer.body.code, 'EVALUATION_NOT_FOUND');
    }
    // freeSession id is referenced for traceability.
    assert.ok(freeSession);
});
test('template knowledge: a free session started from a template inherits approved knowledge for model citations', { timeout: 120_000 }, async (context) => {
    const postgres = await createPostgresTestSupport().start();
    const db = createPostgresExecutor(postgres.connectionUri);
    await new MigrationRunner(db, registeredMigrations).applyAll();
    const app = await createApp(postgres.connectionUri, citationModel);
    context.after(async () => {
        await app.close();
        await db.close();
        await postgres.stop();
    });
    const http = app.getHttpServer();
    const templateId = '77777777-7777-7777-7777-777777777701';
    await seedPersonalTemplate(db, templateId, ['knowledge-welcome@v1']);
    const started = await request(http)
        .post('/me/sessions/free')
        .set('x-access-token', STREAMER_A)
        .set('Idempotency-Key', 'tpl-knowledge-1')
        .send({ templateId })
        .expect(201);
    const convId = started.body.conversationId;
    const turn = await request(http)
        .post(`/me/conversations/${convId}/messages`)
        .set('x-access-token', STREAMER_A)
        .send({ clientMessageId: 'tk-1', sequence: 1, content: '引用模板知识' })
        .expect(201);
    assert.deepEqual(turn.body.suggestion.knowledgeReferences, ['knowledge-welcome@v1'], 'the template-approved knowledge enters the allowed citation set and is echoed back');
    const linked = await db.query(`SELECT ts.template_id AS "templateId"
     FROM conversation c JOIN training_session ts ON ts.id = c.training_session_id
     WHERE c.id = $1`, [convId]);
    assert.equal(linked.rows[0]?.templateId, templateId, 'the free session keeps its template link');
});
test('template knowledge: a template-less free session rejects a model citation outside its (empty) approved set', { timeout: 120_000 }, async (context) => {
    const postgres = await createPostgresTestSupport().start();
    const db = createPostgresExecutor(postgres.connectionUri);
    await new MigrationRunner(db, registeredMigrations).applyAll();
    const app = await createApp(postgres.connectionUri, citationModel);
    context.after(async () => {
        await app.close();
        await db.close();
        await postgres.stop();
    });
    const http = app.getHttpServer();
    const started = await request(http)
        .post('/me/sessions/free')
        .set('x-access-token', STREAMER_A)
        .set('Idempotency-Key', 'bare-free-1')
        .send(freePersona())
        .expect(201);
    const convId = started.body.conversationId;
    const turn = await request(http)
        .post(`/me/conversations/${convId}/messages`)
        .set('x-access-token', STREAMER_A)
        .send({ clientMessageId: 'bk-1', sequence: 1, content: '无模板却引用' })
        .expect(422);
    assert.equal(turn.body.code, 'MODEL_SCHEMA_INVALID', 'no template means an empty approved set, so any citation is rejected');
});
test('template knowledge: a template referencing unapproved knowledge fails the turn with KNOWLEDGE_NOT_AVAILABLE', { timeout: 120_000 }, async (context) => {
    const postgres = await createPostgresTestSupport().start();
    const db = createPostgresExecutor(postgres.connectionUri);
    await new MigrationRunner(db, registeredMigrations).applyAll();
    const app = await createApp(postgres.connectionUri, citationModel);
    context.after(async () => {
        await app.close();
        await db.close();
        await postgres.stop();
    });
    const http = app.getHttpServer();
    const badTemplateId = '77777777-7777-7777-7777-777777777702';
    await seedPersonalTemplate(db, badTemplateId, ['knowledge-ghost@v9']); // well-formed ref, no approved record
    const started = await request(http)
        .post('/me/sessions/free')
        .set('x-access-token', STREAMER_A)
        .set('Idempotency-Key', 'tpl-bad-knowledge-1')
        .send({ templateId: badTemplateId })
        .expect(201); // session creation does not eagerly load knowledge
    const convId = started.body.conversationId;
    const turn = await request(http)
        .post(`/me/conversations/${convId}/messages`)
        .set('x-access-token', STREAMER_A)
        .send({ clientMessageId: 'gk-1', sequence: 1, content: '模板知识不存在' })
        .expect(422);
    assert.equal(turn.body.code, 'KNOWLEDGE_NOT_AVAILABLE');
});
