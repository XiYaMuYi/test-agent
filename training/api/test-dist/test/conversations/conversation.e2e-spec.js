import assert from 'node:assert/strict';
import test from 'node:test';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../../src/app.module.js';
import { FakeModelAdapter } from '../../src/adapters/fake-model.adapter.js';
import { deriveLearnerId } from '../../src/assignments/eligibility.service.js';
import { createPostgresExecutor, MigrationRunner, registeredMigrations } from '../../src/database/migrations/index.js';
import { createPostgresTestSupport } from '../support/postgres.js';
async function createApp(databaseUrl, modelScenario = 'success') {
    process.env.DATABASE_URL = databaseUrl;
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
        .overrideProvider(FakeModelAdapter)
        .useValue(new FakeModelAdapter({ scenario: modelScenario }))
        .compile();
    const app = moduleRef.createNestApplication();
    await app.init();
    return app;
}
const ORGANIZATION_A = '11111111-1111-1111-1111-111111111111';
const ORGANIZATION_B = '22222222-2222-2222-2222-222222222222';
const STREAMER_A = 'fixture:identity:valid';
const STREAMER_A_OTHER = 'fixture:identity:streamer-organization-a-other';
const ADMIN_B = 'fixture:identity:cross-organization';
const CONVERSATION_ID = '11111111-1111-1111-1111-111111111160';
function withoutAsyncCoachFeedback(value) {
    const { coachFeedback: _rootFeedback, suggestion, ...stable } = value;
    if (typeof suggestion !== 'object' || suggestion === null)
        return stable;
    const { coachFeedback: _suggestionFeedback, ...stableSuggestion } = suggestion;
    return { ...stable, suggestion: stableSuggestion };
}
async function seedConversation(dbUrl) {
    const db = createPostgresExecutor(dbUrl);
    await db.query(`INSERT INTO scenario_draft (id, organization_id, title, payload) VALUES ('11111111-1111-1111-1111-111111111110', $1, 'draft', '{"title":"draft","knowledgeVersions":["knowledge-welcome@v1"],"scoringRules":["r1"],"agentConfig":{}}'::jsonb)`, [ORGANIZATION_A]);
    await db.query(`INSERT INTO release_snapshot (id, scenario_draft_id, organization_id, schema_version, snapshot) VALUES ('11111111-1111-1111-1111-111111111120', '11111111-1111-1111-1111-111111111110', $1, 'release-snapshot/v1', '{"schemaVersion":"release-snapshot/v1","releaseSnapshotId":"11111111-1111-1111-1111-111111111120","scenarioDraftId":"11111111-1111-1111-1111-111111111110","compiledAt":"2026-07-28T00:00:00.000Z","title":"draft","knowledgeVersions":["knowledge-welcome@v1"],"scoringRules":["r1"],"agentConfig":{}}'::jsonb)`, [ORGANIZATION_A]);
    await db.query(`INSERT INTO assignment (id, organization_id, release_snapshot_id, name, status, starts_at, ends_at, max_attempts, target_principal_ids) VALUES ('11111111-1111-1111-1111-111111111130', $1, '11111111-1111-1111-1111-111111111120', 'assign', 'active', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP + INTERVAL '1 day', 3, '[]'::jsonb)`, [ORGANIZATION_A]);
    await db.query(`INSERT INTO learner_assignment (id, organization_id, assignment_id, learner_id, state, total_attempts, active_attempt_id) VALUES ('11111111-1111-1111-1111-111111111140', $1, '11111111-1111-1111-1111-111111111130', $2, 'active', 0, '11111111-1111-1111-1111-111111111150')`, [ORGANIZATION_A, deriveLearnerId('streamer-001')]);
    await db.query(`INSERT INTO learner_profile (internal_learner_id, organization_id, external_principal_id, identity_provider) VALUES ($2, $1, 'streamer-001', 'gongzhugou') ON CONFLICT DO NOTHING`, [ORGANIZATION_A, deriveLearnerId('streamer-001')]);
    await db.query(`INSERT INTO training_attempt (id, organization_id, learner_assignment_id, idempotency_key, status) VALUES ('11111111-1111-1111-1111-111111111150', $1, '11111111-1111-1111-1111-111111111140', 'start-1', 'created')`, [ORGANIZATION_A]);
    await db.query(`INSERT INTO training_session (id, organization_id, learner_id, source_type, mode, release_snapshot_id, assignment_id, learner_assignment_id, training_attempt_id, persona_snapshot, status, idempotency_key) VALUES ('11111111-1111-1111-1111-111111111170', $1, $2, 'assigned', 'practice', '11111111-1111-1111-1111-111111111120', '11111111-1111-1111-1111-111111111130', '11111111-1111-1111-1111-111111111140', '11111111-1111-1111-1111-111111111150', '{}'::jsonb, 'active', 'seed-session')`, [ORGANIZATION_A, deriveLearnerId('streamer-001')]);
    await db.query(`INSERT INTO conversation (id, organization_id, training_attempt_id, release_snapshot_id, training_session_id, status, version, client_message_id, last_sequence) VALUES ($1, $2, '11111111-1111-1111-1111-111111111150', '11111111-1111-1111-1111-111111111120', '11111111-1111-1111-1111-111111111170', 'created', 1, NULL, 0)`, [CONVERSATION_ID, ORGANIZATION_A]);
    await db.close();
}
test('conversation flow enforces idempotency, sequence and ownership', { timeout: 120_000 }, async (context) => {
    const postgres = await createPostgresTestSupport().start();
    const db = createPostgresExecutor(postgres.connectionUri);
    const runner = new MigrationRunner(db, registeredMigrations);
    await runner.applyAll();
    await seedConversation(postgres.connectionUri);
    const app = await createApp(postgres.connectionUri);
    context.after(async () => {
        await app.close();
        await db.close();
        await postgres.stop();
    });
    const token = STREAMER_A;
    const conversationId = CONVERSATION_ID;
    const getResponse = await request(app.getHttpServer())
        .get(`/me/conversations/${conversationId}`)
        .set('x-access-token', token)
        .expect(200);
    assert.equal(getResponse.body.id, conversationId);
    const message1 = await request(app.getHttpServer())
        .post(`/me/conversations/${conversationId}/messages`)
        .set('x-access-token', token)
        .send({ clientMessageId: 'msg-1', sequence: 1, content: 'hello' })
        .expect(201);
    assert.equal(message1.body.sequence, 1);
    const replay = await request(app.getHttpServer())
        .post(`/me/conversations/${conversationId}/messages`)
        .set('x-access-token', token)
        .send({ clientMessageId: 'msg-1', sequence: 1, content: 'hello' })
        .expect(201);
    assert.deepEqual(withoutAsyncCoachFeedback(replay.body), withoutAsyncCoachFeedback(message1.body));
    const persistedResponse = await db.query(`SELECT response_hash AS response
     FROM conversation_message
     WHERE conversation_id = $1 AND client_message_id = 'msg-1'`, [conversationId]);
    // P2-1 contract: the persisted response_hash KEEPS the internal running
    // moodValue for next-turn accumulation, while the HTTP payload strips it.
    // So the persisted object equals the client body *plus* a numeric moodValue.
    const persistedTurn = JSON.parse(persistedResponse.rows[0]?.response ?? 'null');
    assert.equal(typeof persistedTurn.moodValue, 'number', 'moodValue must be persisted');
    const { moodValue: _persistedMoodValue, ...persistedClientView } = persistedTurn;
    assert.deepEqual(withoutAsyncCoachFeedback(persistedClientView), withoutAsyncCoachFeedback(message1.body));
    assert.equal('moodValue' in message1.body, false, 'moodValue must not be sent to the client');
    const idempotencyConflict = await request(app.getHttpServer())
        .post(`/me/conversations/${conversationId}/messages`)
        .set('x-access-token', token)
        .send({ clientMessageId: 'msg-1', sequence: 1, content: 'changed' })
        .expect(409);
    assert.equal(idempotencyConflict.body.code, 'MESSAGE_IDEMPOTENCY_CONFLICT');
    const sequenceConflict = await request(app.getHttpServer())
        .post(`/me/conversations/${conversationId}/messages`)
        .set('x-access-token', token)
        .send({ clientMessageId: 'msg-2', sequence: 3, content: 'skip sequence' })
        .expect(409);
    assert.equal(sequenceConflict.body.code, 'MESSAGE_SEQUENCE_CONFLICT');
    await request(app.getHttpServer())
        .post(`/me/conversations/${conversationId}/end`)
        .set('x-access-token', token)
        .expect(201);
    const closed = await request(app.getHttpServer())
        .post(`/me/conversations/${conversationId}/messages`)
        .set('x-access-token', token)
        .send({ clientMessageId: 'msg-3', sequence: 2, content: 'after end' })
        .expect(409);
    assert.equal(closed.body.code, 'CONVERSATION_CLOSED');
});
test('ending attempts settles quota once, permits the second attempt, and rejects a third after quota exhaustion', { timeout: 120_000 }, async (context) => {
    const postgres = await createPostgresTestSupport().start();
    const db = createPostgresExecutor(postgres.connectionUri);
    const runner = new MigrationRunner(db, registeredMigrations);
    await runner.applyAll();
    await seedConversation(postgres.connectionUri);
    const app = await createApp(postgres.connectionUri);
    context.after(async () => {
        await app.close();
        await db.close();
        await postgres.stop();
    });
    await db.query(`UPDATE assignment
     SET max_attempts = 2
     WHERE id = '11111111-1111-1111-1111-111111111130' AND organization_id = $1`, [ORGANIZATION_A]);
    await request(app.getHttpServer())
        .post(`/me/conversations/${CONVERSATION_ID}/messages`)
        .set('x-access-token', STREAMER_A)
        .send({ clientMessageId: 'settle-first-message', sequence: 1, content: 'first valid answer' })
        .expect(201);
    await request(app.getHttpServer())
        .post(`/me/conversations/${CONVERSATION_ID}/end`)
        .set('x-access-token', STREAMER_A)
        .expect(201);
    const firstSettlement = await db.query(`SELECT attempt.status,
            attempt.finished_at AS "finishedAt",
            learner.state AS "learnerState",
            learner.total_attempts AS "totalAttempts",
            learner.active_attempt_id AS "activeAttemptId"
     FROM training_attempt attempt
     JOIN learner_assignment learner
       ON learner.id = attempt.learner_assignment_id
      AND learner.organization_id = attempt.organization_id
     WHERE attempt.id = '11111111-1111-1111-1111-111111111150'
       AND attempt.organization_id = $1`, [ORGANIZATION_A]);
    assert.equal(firstSettlement.rows[0]?.status, 'ended');
    assert.ok(firstSettlement.rows[0]?.finishedAt instanceof Date);
    assert.equal(firstSettlement.rows[0]?.learnerState, 'completed');
    assert.equal(firstSettlement.rows[0]?.totalAttempts, 1);
    assert.equal(firstSettlement.rows[0]?.activeAttemptId, null);
    await request(app.getHttpServer())
        .post(`/me/conversations/${CONVERSATION_ID}/end`)
        .set('x-access-token', STREAMER_A)
        .expect(201);
    const afterReplay = await db.query(`SELECT learner.total_attempts AS "totalAttempts",
            (SELECT COUNT(*)::text FROM evaluation_job WHERE conversation_id = $1 AND organization_id = $2) AS "jobCount",
            (SELECT COUNT(*)::text FROM outbox_event WHERE deduplication_key = $3) AS "outboxCount"
     FROM learner_assignment learner
     WHERE learner.id = '11111111-1111-1111-1111-111111111140'
       AND learner.organization_id = $2`, [CONVERSATION_ID, ORGANIZATION_A, `evaluation:${CONVERSATION_ID}`]);
    assert.deepEqual(afterReplay.rows[0], {
        totalAttempts: 1,
        jobCount: '1',
        outboxCount: '1',
    });
    const second = await request(app.getHttpServer())
        .post('/me/assignments/11111111-1111-1111-1111-111111111130/attempts')
        .set('x-access-token', STREAMER_A)
        .set('Idempotency-Key', 'settle-second-attempt')
        .expect(201);
    await request(app.getHttpServer())
        .post(`/me/conversations/${second.body.conversationId}/messages`)
        .set('x-access-token', STREAMER_A)
        .send({ clientMessageId: 'settle-second-message', sequence: 1, content: 'second valid answer' })
        .expect(201);
    await request(app.getHttpServer())
        .post(`/me/conversations/${second.body.conversationId}/end`)
        .set('x-access-token', STREAMER_A)
        .expect(201);
    const completed = await db.query(`SELECT attempt.status AS "attemptStatus",
            attempt.finished_at AS "finishedAt",
            learner.state AS "learnerState",
            learner.total_attempts AS "totalAttempts",
            learner.active_attempt_id AS "activeAttemptId"
     FROM training_attempt attempt
     JOIN learner_assignment learner
       ON learner.id = attempt.learner_assignment_id
      AND learner.organization_id = attempt.organization_id
     WHERE attempt.id = $1 AND attempt.organization_id = $2`, [second.body.attemptId, ORGANIZATION_A]);
    assert.equal(completed.rows[0]?.attemptStatus, 'ended');
    assert.ok(completed.rows[0]?.finishedAt instanceof Date);
    assert.equal(completed.rows[0]?.learnerState, 'completed');
    assert.equal(completed.rows[0]?.totalAttempts, 2);
    assert.equal(completed.rows[0]?.activeAttemptId, null);
    const exhausted = await request(app.getHttpServer())
        .post('/me/assignments/11111111-1111-1111-1111-111111111130/attempts')
        .set('x-access-token', STREAMER_A)
        .set('Idempotency-Key', 'settle-third-attempt')
        .expect(409);
    assert.equal(exhausted.body.code, 'ASSIGNMENT_QUOTA_EXHAUSTED');
});
test('concurrent messages can advance a conversation only once for a sequence', { timeout: 120_000 }, async (context) => {
    const postgres = await createPostgresTestSupport().start();
    const db = createPostgresExecutor(postgres.connectionUri);
    const runner = new MigrationRunner(db, registeredMigrations);
    await runner.applyAll();
    await seedConversation(postgres.connectionUri);
    const app = await createApp(postgres.connectionUri);
    context.after(async () => {
        await app.close();
        await db.close();
        await postgres.stop();
    });
    const responses = await Promise.all([
        request(app.getHttpServer())
            .post(`/me/conversations/${CONVERSATION_ID}/messages`)
            .set('x-access-token', STREAMER_A)
            .send({ clientMessageId: 'concurrent-a', sequence: 1, content: 'first' }),
        request(app.getHttpServer())
            .post(`/me/conversations/${CONVERSATION_ID}/messages`)
            .set('x-access-token', STREAMER_A)
            .send({ clientMessageId: 'concurrent-b', sequence: 1, content: 'second' }),
    ]);
    assert.deepEqual(responses.map((response) => response.status).sort(), [201, 409]);
    const rejected = responses.find((response) => response.status === 409);
    assert.equal(rejected?.body.code, 'MESSAGE_SEQUENCE_CONFLICT');
    const messages = await db.query('SELECT COUNT(*)::text AS count FROM conversation_message WHERE conversation_id = $1', [CONVERSATION_ID]);
    assert.equal(messages.rows[0]?.count, '1');
});
test('conversation ownership and error responses do not leak another learner or organization', { timeout: 120_000 }, async (context) => {
    const postgres = await createPostgresTestSupport().start();
    const db = createPostgresExecutor(postgres.connectionUri);
    const runner = new MigrationRunner(db, registeredMigrations);
    await runner.applyAll();
    await seedConversation(postgres.connectionUri);
    const app = await createApp(postgres.connectionUri);
    context.after(async () => {
        await app.close();
        await db.close();
        await postgres.stop();
    });
    for (const token of [STREAMER_A_OTHER, ADMIN_B]) {
        const get = await request(app.getHttpServer())
            .get(`/me/conversations/${CONVERSATION_ID}`)
            .set('x-access-token', token)
            .expect(404);
        assert.equal(get.body.code, 'CONVERSATION_NOT_FOUND');
        assert.equal(get.body.status, 404);
        const post = await request(app.getHttpServer())
            .post(`/me/conversations/${CONVERSATION_ID}/messages`)
            .set('x-access-token', token)
            .send({ clientMessageId: `foreign-${token}`, sequence: 1, content: 'not mine' })
            .expect(404);
        assert.equal(post.body.code, 'CONVERSATION_NOT_FOUND');
        const end = await request(app.getHttpServer())
            .post(`/me/conversations/${CONVERSATION_ID}/end`)
            .set('x-access-token', token)
            .expect(404);
        assert.equal(end.body.code, 'CONVERSATION_NOT_FOUND');
    }
    const missing = await request(app.getHttpServer())
        .get('/me/conversations/33333333-3333-3333-3333-333333333333')
        .set('x-access-token', STREAMER_A)
        .expect(404);
    assert.equal(missing.body.code, 'CONVERSATION_NOT_FOUND');
});
for (const failure of [
    { scenario: 'timeout', status: 408, code: 'MODEL_TIMEOUT' },
    { scenario: 'schema-error', status: 422, code: 'MODEL_SCHEMA_INVALID' },
]) {
    test(`model ${failure.scenario} leaves one recoverable pending turn and same-key retry completes it`, { timeout: 120_000 }, async (context) => {
        const postgres = await createPostgresTestSupport().start();
        const db = createPostgresExecutor(postgres.connectionUri);
        const runner = new MigrationRunner(db, registeredMigrations);
        await runner.applyAll();
        await seedConversation(postgres.connectionUri);
        const failingApp = await createApp(postgres.connectionUri, failure.scenario);
        const recoveryApp = await createApp(postgres.connectionUri, 'success');
        context.after(async () => {
            await recoveryApp.close();
            await failingApp.close();
            await db.close();
            await postgres.stop();
        });
        const input = { clientMessageId: `recover-${failure.scenario}`, sequence: 1, content: 'retry me' };
        const failed = await request(failingApp.getHttpServer())
            .post(`/me/conversations/${CONVERSATION_ID}/messages`)
            .set('x-access-token', STREAMER_A)
            .send(input)
            .expect(failure.status);
        assert.equal(failed.body.code, failure.code);
        const stateAfterFailure = await db.query(`SELECT c.status,
              c.version,
              c.last_sequence AS "lastSequence",
              COUNT(cm.id)::text AS "messageCount",
              MAX(cm.response_hash) AS response
       FROM conversation c
       LEFT JOIN conversation_message cm ON cm.conversation_id = c.id
       WHERE c.id = $1
       GROUP BY c.id`, [CONVERSATION_ID]);
        assert.deepEqual(stateAfterFailure.rows[0], {
            status: 'awaiting_model',
            version: 2,
            lastSequence: 1,
            messageCount: '1',
            response: null,
        });
        const pendingDetail = await request(recoveryApp.getHttpServer())
            .get(`/me/conversations/${CONVERSATION_ID}`)
            .set('x-access-token', STREAMER_A)
            .expect(200);
        assert.deepEqual(pendingDetail.body.pendingTurn, input);
        const nextKeyWhilePending = await request(recoveryApp.getHttpServer())
            .post(`/me/conversations/${CONVERSATION_ID}/messages`)
            .set('x-access-token', STREAMER_A)
            .send({ clientMessageId: `next-${failure.scenario}`, sequence: 2, content: 'must wait' })
            .expect(409);
        assert.equal(nextKeyWhilePending.body.code, 'MESSAGE_SEQUENCE_CONFLICT');
        const recovered = await request(recoveryApp.getHttpServer())
            .post(`/me/conversations/${CONVERSATION_ID}/messages`)
            .set('x-access-token', STREAMER_A)
            .send(input)
            .expect(201);
        assert.equal(recovered.body.status, 'active');
        assert.equal(recovered.body.version, 2);
        assert.equal(recovered.body.sequence, 1);
        assert.equal(recovered.body.content, input.content);
        assert.equal(recovered.body.suggestion.schemaVersion, 'agent-output/v1');
        const stateAfterRecovery = await db.query(`SELECT c.status,
              c.version,
              c.last_sequence AS "lastSequence",
              COUNT(cm.id)::text AS "messageCount",
              MAX(cm.response_hash) AS response
       FROM conversation c
       LEFT JOIN conversation_message cm ON cm.conversation_id = c.id
       WHERE c.id = $1
       GROUP BY c.id`, [CONVERSATION_ID]);
        assert.equal(stateAfterRecovery.rows[0]?.status, 'active');
        assert.equal(stateAfterRecovery.rows[0]?.version, 2);
        assert.equal(stateAfterRecovery.rows[0]?.lastSequence, 1);
        assert.equal(stateAfterRecovery.rows[0]?.messageCount, '1');
        // P2-1: persisted hash keeps internal moodValue; the recovered HTTP body strips it.
        const persistedRecovery = JSON.parse(stateAfterRecovery.rows[0]?.response ?? 'null');
        assert.equal(typeof persistedRecovery.moodValue, 'number', 'moodValue must be persisted');
        const { moodValue: _recoveryMoodValue, ...recoveryClientView } = persistedRecovery;
        assert.deepEqual(withoutAsyncCoachFeedback(recoveryClientView), withoutAsyncCoachFeedback(recovered.body));
        assert.equal('moodValue' in recovered.body, false, 'moodValue must not be sent to the client');
        const replay = await request(recoveryApp.getHttpServer())
            .post(`/me/conversations/${CONVERSATION_ID}/messages`)
            .set('x-access-token', STREAMER_A)
            .send(input)
            .expect(201);
        assert.deepEqual(withoutAsyncCoachFeedback(replay.body), withoutAsyncCoachFeedback(recovered.body));
    });
}
