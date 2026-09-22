import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import test from 'node:test';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../../src/app.module.js';
import { createPostgresExecutor, MigrationRunner, registeredMigrations } from '../../src/database/migrations/index.js';
import { createPostgresTestSupport } from '../support/postgres.js';
const ORGANIZATION_A = '11111111-1111-1111-1111-111111111111';
const ORGANIZATION_B = '22222222-2222-2222-2222-222222222222';
const ADMIN_A = 'fixture:identity:admin-organization-a';
const STREAMER_A = 'fixture:identity:valid';
const ADMIN_B = 'fixture:identity:cross-organization';
async function createApp(databaseUrl) {
    process.env.DATABASE_URL = databaseUrl;
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    const app = moduleRef.createNestApplication();
    await app.init();
    return app;
}
async function createFixture(context) {
    const postgres = await createPostgresTestSupport().start();
    const db = createPostgresExecutor(postgres.connectionUri);
    await new MigrationRunner(db, registeredMigrations).applyAll();
    const app = await createApp(postgres.connectionUri);
    context.after(async () => {
        await app.close();
        await db.close();
        await postgres.stop();
    });
    const releaseSnapshotId = crypto.randomUUID();
    await db.query(`INSERT INTO scenario_draft (id, organization_id, title, payload)
     VALUES ($1, $2, 'fixture draft', '{"title":"fixture draft","knowledgeVersions":["knowledge-welcome@v1"],"scoringRules":["r1"],"agentConfig":{}}'::jsonb)`, [crypto.randomUUID(), ORGANIZATION_A]);
    const draft = await db.query('SELECT id FROM scenario_draft WHERE organization_id = $1', [ORGANIZATION_A]);
    await db.query(`INSERT INTO release_snapshot (id, scenario_draft_id, organization_id, schema_version, snapshot)
     VALUES ($1, $2, $3, 'release-snapshot/v1', '{"schemaVersion":"release-snapshot/v1"}'::jsonb)`, [releaseSnapshotId, draft.rows[0]?.id, ORGANIZATION_A]);
    return { app, db, releaseSnapshotId };
}
function activeAssignmentBody(releaseSnapshotId, targetPrincipalIds, overrides = {}) {
    return {
        id: crypto.randomUUID(),
        releaseSnapshotId,
        name: '主播新品陪练',
        status: 'active',
        startsAt: new Date(Date.now() - 60_000).toISOString(),
        endsAt: new Date(Date.now() + 60 * 60_000).toISOString(),
        maxAttempts: 2,
        targetPrincipalIds,
        ...overrides,
    };
}
test('duplicate authorized targets merge to one learner assignment and streamer sees only own task', { timeout: 120_000 }, async (context) => {
    const { app, db, releaseSnapshotId } = await createFixture(context);
    const create = await request(app.getHttpServer())
        .post('/admin/assignments')
        .set('x-access-token', ADMIN_A)
        .send(activeAssignmentBody(releaseSnapshotId, ['streamer-001', 'streamer-001']))
        .expect(201);
    const learners = await db.query('SELECT learner_id FROM learner_assignment');
    assert.equal(learners.rows.length, 1);
    const tasks = await request(app.getHttpServer())
        .get('/me/assignments')
        .set('x-access-token', STREAMER_A)
        .expect(200);
    assert.equal(tasks.body.items.length, 1);
    assert.equal(tasks.body.items[0].assignmentId, create.body.assignmentId);
});
test('expired or paused assignment cannot start an attempt', { timeout: 120_000 }, async (context) => {
    const { app, releaseSnapshotId } = await createFixture(context);
    const expired = await request(app.getHttpServer())
        .post('/admin/assignments')
        .set('x-access-token', ADMIN_A)
        .send(activeAssignmentBody(releaseSnapshotId, ['streamer-001'], {
        endsAt: new Date(Date.now() - 1_000).toISOString(),
        startsAt: new Date(Date.now() - 60_000).toISOString(),
    }))
        .expect(201);
    await request(app.getHttpServer())
        .post(`/me/assignments/${expired.body.assignmentId}/attempts`)
        .set('x-access-token', STREAMER_A)
        .set('Idempotency-Key', 'expired-start')
        .expect(409);
    const pausedAssignment = await request(app.getHttpServer())
        .post('/admin/assignments')
        .set('x-access-token', ADMIN_A)
        .send(activeAssignmentBody(releaseSnapshotId, ['streamer-001'], { status: 'paused' }))
        .expect(201);
    const paused = await request(app.getHttpServer())
        .post(`/me/assignments/${pausedAssignment.body.assignmentId}/attempts`)
        .set('x-access-token', STREAMER_A)
        .set('Idempotency-Key', 'paused-start')
        .expect(409);
    assert.equal(paused.body.code, 'ASSIGNMENT_NOT_ACTIVE');
});
test('parallel starts use database active-attempt constraint and replay returns the original attempt', { timeout: 120_000 }, async (context) => {
    const { app, releaseSnapshotId } = await createFixture(context);
    const assignment = await request(app.getHttpServer())
        .post('/admin/assignments')
        .set('x-access-token', ADMIN_A)
        .send(activeAssignmentBody(releaseSnapshotId, ['streamer-001']))
        .expect(201);
    const url = `/me/assignments/${assignment.body.assignmentId}/attempts`;
    const [first, second] = await Promise.all([
        request(app.getHttpServer()).post(url).set('x-access-token', STREAMER_A).set('Idempotency-Key', 'parallel-a'),
        request(app.getHttpServer()).post(url).set('x-access-token', STREAMER_A).set('Idempotency-Key', 'parallel-b'),
    ]);
    // Which request wins the learner_assignment row lock first is scheduling-dependent;
    // the invariant is that exactly one starts and the other is rejected, then the winner replays.
    const winner = first.status === 201 ? first : second;
    const loser = first.status === 201 ? second : first;
    const winnerKey = first.status === 201 ? 'parallel-a' : 'parallel-b';
    assert.equal(winner.status, 201);
    assert.equal(loser.status, 409);
    assert.equal(loser.body.code, 'ATTEMPT_ALREADY_ACTIVE');
    assert.equal(typeof winner.body.conversationId, 'string');
    const replay = await request(app.getHttpServer())
        .post(url)
        .set('x-access-token', STREAMER_A)
        .set('Idempotency-Key', winnerKey)
        .expect(201);
    assert.equal(replay.body.attemptId, winner.body.attemptId);
    assert.equal(replay.body.conversationId, winner.body.conversationId);
});
test('starting an assignment atomically creates a conversation bound to its attempt and release snapshot', { timeout: 120_000 }, async (context) => {
    const { app, db, releaseSnapshotId } = await createFixture(context);
    const assignment = await request(app.getHttpServer())
        .post('/admin/assignments')
        .set('x-access-token', ADMIN_A)
        .send(activeAssignmentBody(releaseSnapshotId, ['streamer-001']))
        .expect(201);
    const response = await request(app.getHttpServer())
        .post(`/me/assignments/${assignment.body.assignmentId}/attempts`)
        .set('x-access-token', STREAMER_A)
        .set('Idempotency-Key', 'creates-conversation')
        .expect(201);
    assert.equal(typeof response.body.attemptId, 'string');
    assert.equal(typeof response.body.conversationId, 'string');
    const conversation = await db.query('SELECT training_attempt_id, release_snapshot_id, organization_id FROM conversation WHERE id = $1', [response.body.conversationId]);
    assert.deepEqual(conversation.rows[0], {
        training_attempt_id: response.body.attemptId,
        release_snapshot_id: releaseSnapshotId,
        organization_id: ORGANIZATION_A,
    });
});
test('conversation creation failure rolls back its attempt atomically', { timeout: 120_000 }, async (context) => {
    const { app, db, releaseSnapshotId } = await createFixture(context);
    const assignment = await request(app.getHttpServer())
        .post('/admin/assignments')
        .set('x-access-token', ADMIN_A)
        .send(activeAssignmentBody(releaseSnapshotId, ['streamer-001']))
        .expect(201);
    await db.query(`
    CREATE OR REPLACE FUNCTION reject_test_conversation_insert()
    RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'test conversation insert failure'; END; $$
  `);
    await db.query(`
    CREATE TRIGGER reject_test_conversation_insert_trigger
    BEFORE INSERT ON conversation FOR EACH ROW EXECUTE FUNCTION reject_test_conversation_insert()
  `);
    await request(app.getHttpServer())
        .post(`/me/assignments/${assignment.body.assignmentId}/attempts`)
        .set('x-access-token', STREAMER_A)
        .set('Idempotency-Key', 'rollback-conversation')
        .expect(500);
    const attempts = await db.query('SELECT COUNT(*)::text AS count FROM training_attempt WHERE organization_id = $1', [ORGANIZATION_A]);
    assert.equal(attempts.rows[0]?.count, '0');
});
test('another organization cannot list or start organization A assignment', { timeout: 120_000 }, async (context) => {
    const { app, releaseSnapshotId } = await createFixture(context);
    const assignment = await request(app.getHttpServer())
        .post('/admin/assignments')
        .set('x-access-token', ADMIN_A)
        .send(activeAssignmentBody(releaseSnapshotId, ['streamer-001']))
        .expect(201);
    const list = await request(app.getHttpServer())
        .get('/me/assignments')
        .set('x-access-token', ADMIN_B)
        .expect(200);
    assert.deepEqual(list.body.items, []);
    const denied = await request(app.getHttpServer())
        .post(`/me/assignments/${assignment.body.assignmentId}/attempts`)
        .set('x-access-token', ADMIN_B)
        .set('Idempotency-Key', 'cross-org')
        .expect(403);
    assert.equal(denied.body.code, 'ORG_SCOPE_FORBIDDEN');
    assert.equal(denied.body.status, 403);
    assert.equal(typeof denied.body.type, 'string');
});
test('starting an assignment requires an Idempotency-Key Problem Details response', { timeout: 120_000 }, async (context) => {
    const { app, releaseSnapshotId } = await createFixture(context);
    const assignment = await request(app.getHttpServer())
        .post('/admin/assignments')
        .set('x-access-token', ADMIN_A)
        .send(activeAssignmentBody(releaseSnapshotId, ['streamer-001']))
        .expect(201);
    const response = await request(app.getHttpServer())
        .post(`/me/assignments/${assignment.body.assignmentId}/attempts`)
        .set('x-access-token', STREAMER_A)
        .expect(400);
    assert.equal(response.body.code, 'IDEMPOTENCY_KEY_REQUIRED');
    assert.equal(response.body.status, 400);
    assert.equal(typeof response.body.type, 'string');
});
