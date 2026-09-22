import assert from 'node:assert/strict';
import test from 'node:test';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../../src/app.module.js';
import { FakeModelAdapter } from '../../src/adapters/fake-model.adapter.js';
import { createPostgresExecutor, MigrationRunner, registeredMigrations } from '../../src/database/migrations/index.js';
import { createPostgresTestSupport } from '../support/postgres.js';
const STREAMER = 'fixture:identity:valid';
const STREAMER_OTHER = 'fixture:identity:streamer-organization-a-other';
const personaBody = () => ({
    persona: { ageCardId: 'young-lady', psychologyCardIds: [], difficulty: 2, productScenarioId: 'anti-aging' },
});
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
async function holdFinishedConversation(app, key) {
    const started = await request(app.getHttpServer())
        .post('/me/sessions/free')
        .set('x-access-token', STREAMER)
        .set('Idempotency-Key', key)
        .send(personaBody())
        .expect(201);
    const conversationId = started.body.conversationId;
    for (let seq = 1; seq <= 2; seq += 1) {
        await request(app.getHttpServer())
            .post(`/me/conversations/${conversationId}/messages`)
            .set('x-access-token', STREAMER)
            .send({ clientMessageId: `${key}-msg-${seq}`, sequence: seq, content: `主播发言 ${seq}` })
            .expect(201);
    }
    await request(app.getHttpServer())
        .post(`/me/conversations/${conversationId}/end`)
        .set('x-access-token', STREAMER)
        .expect(201);
    return conversationId;
}
test('learner lists own conversations with persona summary, ordered newest first, and never sees another learner', { timeout: 120_000 }, async (context) => {
    const postgres = await createPostgresTestSupport().start();
    const db = createPostgresExecutor(postgres.connectionUri);
    await new MigrationRunner(db, registeredMigrations).applyAll();
    const app = await createApp(postgres.connectionUri);
    context.after(async () => {
        await app.close();
        await db.close();
        await postgres.stop();
    });
    const firstId = await holdFinishedConversation(app, 'history-1');
    const secondId = await holdFinishedConversation(app, 'history-2');
    const list = await request(app.getHttpServer())
        .get('/me/conversations?limit=20&offset=0')
        .set('x-access-token', STREAMER)
        .expect(200);
    assert.ok(Array.isArray(list.body.items));
    assert.equal(list.body.items.length, 2);
    assert.equal(list.body.total, 2);
    // Newest first.
    assert.equal(list.body.items[0].conversationId, secondId);
    const top = list.body.items[0];
    assert.equal(top.sourceType, 'free');
    assert.equal(top.status, 'ended');
    assert.equal(top.personaName, '小姐姐');
    assert.equal(top.basedOnCard, 'young-lady');
    assert.equal(top.productScenario, '抗老咨询');
    assert.equal(top.difficulty, 2);
    assert.equal(top.score, null, 'score stays null until the worker writes a report');
    // A finished report surfaces its score in the list.
    await db.query(`INSERT INTO evaluation_report (id, organization_id, conversation_id, evaluation_job_id, status, report)
     SELECT gen_random_uuid(), organization_id, conversation_id, id, 'published',
            '{"schemaVersion":"evaluation-report/v1","score":88,"messageCount":2,"scoringRules":[]}'::jsonb
     FROM evaluation_job WHERE conversation_id = $1`, [secondId]);
    const scored = await request(app.getHttpServer())
        .get('/me/conversations')
        .set('x-access-token', STREAMER)
        .expect(200);
    const scoredItem = scored.body.items.find((i) => i.conversationId === secondId);
    assert.equal(scoredItem.score, 88);
    assert.equal(scoredItem.evaluationStatus, 'published');
    // Organization-mate learner cannot see the other learner's history.
    const foreign = await request(app.getHttpServer())
        .get('/me/conversations')
        .set('x-access-token', STREAMER_OTHER)
        .expect(200);
    assert.equal(foreign.body.items.length, 0);
    assert.ok(!foreign.body.items.some((i) => i.conversationId === firstId));
    // Pagination.
    const page = await request(app.getHttpServer())
        .get('/me/conversations?limit=1&offset=0')
        .set('x-access-token', STREAMER)
        .expect(200);
    assert.equal(page.body.items.length, 1);
    assert.equal(page.body.total, 2);
});
test('learner opens a conversation detail with an ordered learner/assistant transcript', { timeout: 120_000 }, async (context) => {
    const postgres = await createPostgresTestSupport().start();
    const db = createPostgresExecutor(postgres.connectionUri);
    await new MigrationRunner(db, registeredMigrations).applyAll();
    const app = await createApp(postgres.connectionUri);
    context.after(async () => {
        await app.close();
        await db.close();
        await postgres.stop();
    });
    const conversationId = await holdFinishedConversation(app, 'detail-1');
    const detail = await request(app.getHttpServer())
        .get(`/me/conversations/${conversationId}`)
        .set('x-access-token', STREAMER)
        .expect(200);
    // Existing metadata stays intact (backward compatible).
    assert.equal(detail.body.id, conversationId);
    assert.equal(detail.body.trainingAttemptId, null);
    assert.ok(Array.isArray(detail.body.messages), 'detail now carries the replay transcript');
    assert.equal(detail.body.messages.length, 4, 'two learner turns each followed by an assistant reply');
    assert.equal(detail.body.messages[0].role, 'learner');
    assert.equal(detail.body.messages[1].role, 'assistant');
    assert.equal(detail.body.messages[0].content, '主播发言 1');
    assert.ok(typeof detail.body.messages[1].content === 'string' && detail.body.messages[1].content.length > 0);
    assert.deepEqual(detail.body.messages.map((m) => m.sequence), [1, 1, 2, 2], 'messages interleave within each turn and stay ordered by sequence');
    const foreign = await request(app.getHttpServer())
        .get(`/me/conversations/${conversationId}`)
        .set('x-access-token', STREAMER_OTHER)
        .expect(404);
    assert.equal(foreign.body.code, 'CONVERSATION_NOT_FOUND');
});
