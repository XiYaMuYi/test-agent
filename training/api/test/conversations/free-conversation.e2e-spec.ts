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
const validBody = () => ({
  persona: { ageCardId: 'young-lady', psychologyCardIds: [], difficulty: 2, productScenarioId: 'anti-aging' },
});

async function createApp(databaseUrl: string) {
  process.env.DATABASE_URL = databaseUrl;
  const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
    .overrideProvider(FakeModelAdapter)
    .useValue(new FakeModelAdapter({ scenario: 'success' }))
    .compile();
  const app = moduleRef.createNestApplication();
  await app.init();
  return app;
}

test('free conversation is learner-owned, exchanges messages without an assigned chain, and frees the active slot on end', { timeout: 120_000 }, async (context) => {
  const postgres = await createPostgresTestSupport().start();
  const db = createPostgresExecutor(postgres.connectionUri);
  await new MigrationRunner(db, registeredMigrations).applyAll();
  const app = await createApp(postgres.connectionUri);
  context.after(async () => {
    await app.close();
    await db.close();
    await postgres.stop();
  });

  const started = await request(app.getHttpServer())
    .post('/me/sessions/free')
    .set('x-access-token', STREAMER)
    .set('Idempotency-Key', 'free-conv-1')
    .send(validBody())
    .expect(201);
  const conversationId: string = started.body.conversationId;
  assert.equal(started.body.sourceType, 'free');

  // Ownership now resolves through training_session, not the assigned attempt chain.
  const fetched = await request(app.getHttpServer())
    .get(`/me/conversations/${conversationId}`)
    .set('x-access-token', STREAMER)
    .expect(200);
  assert.equal(fetched.body.id, conversationId);
  assert.equal(fetched.body.trainingAttemptId, null);
  assert.equal(fetched.body.releaseSnapshotId, null);

  // A different learner in the SAME organization still cannot see or touch it.
  const foreign = await request(app.getHttpServer())
    .get(`/me/conversations/${conversationId}`)
    .set('x-access-token', STREAMER_OTHER)
    .expect(404);
  assert.equal(foreign.body.code, 'CONVERSATION_NOT_FOUND');

  // A free turn runs with no release snapshot / approved knowledge.
  const message = await request(app.getHttpServer())
    .post(`/me/conversations/${conversationId}/messages`)
    .set('x-access-token', STREAMER)
    .send({ clientMessageId: 'free-msg-1', sequence: 1, content: '你好，客户' })
    .expect(201);
  assert.equal(message.body.sequence, 1);
  assert.equal(message.body.suggestion.schemaVersion, 'agent-output/v1');
  // P2-1: the internal running mood scalar is persisted for the next turn but
  // must never be returned to the mini-program; user-visible mood/coach stay.
  assert.equal('moodValue' in message.body, false, 'internal moodValue must not be sent to the client');
  assert.ok(
    ['positive', 'neutral', 'negative'].includes(message.body.customerMood),
    'client still receives the customerMood label',
  );
  assert.ok(message.body.coachFeedback !== undefined, 'client still receives coach feedback');

  await request(app.getHttpServer())
    .post(`/me/conversations/${conversationId}/end`)
    .set('x-access-token', STREAMER)
    .expect(201);

  // Ending closes the conversation and settles the session (no assigned chain exists).
  const closed = await request(app.getHttpServer())
    .post(`/me/conversations/${conversationId}/messages`)
    .set('x-access-token', STREAMER)
    .send({ clientMessageId: 'free-msg-2', sequence: 2, content: '结束后再发' })
    .expect(409);
  assert.equal(closed.body.code, 'CONVERSATION_CLOSED');
  // P2-4: the machine code is kept for branching; the user-facing detail is
  // Chinese copy and must not echo the raw SCREAMING_SNAKE code or English.
  assert.equal(closed.body.detail.includes('CONVERSATION_CLOSED'), false);
  assert.match(String(closed.body.detail), /[一-鿿]/);

  const chainCounts = await db.query<{ attempts: string; assignments: string; jobs: string; sessionStatus: string }>(
    `SELECT
       (SELECT COUNT(*)::text FROM training_attempt) AS attempts,
       (SELECT COUNT(*)::text FROM learner_assignment) AS assignments,
       (SELECT COUNT(*)::text FROM evaluation_job WHERE conversation_id = $1) AS jobs,
       (SELECT status FROM training_session WHERE id = $2) AS "sessionStatus"`,
    [conversationId, started.body.sessionId],
  );
  assert.deepEqual(chainCounts.rows[0], {
    attempts: '0',
    assignments: '0',
    jobs: '1',
    sessionStatus: 'ended',
  }, 'free track creates no attempt/eligibility rows, still requests evaluation, and ends its session');

  // Ending the session releases the global single-active slot.
  const next = await request(app.getHttpServer())
    .post('/me/sessions/free')
    .set('x-access-token', STREAMER)
    .set('Idempotency-Key', 'free-conv-2')
    .send(validBody())
    .expect(201);
  assert.ok(next.body.conversationId);
  assert.notEqual(next.body.conversationId, conversationId);
});
