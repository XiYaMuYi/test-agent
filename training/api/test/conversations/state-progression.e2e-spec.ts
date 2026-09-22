import assert from 'node:assert/strict';
import test from 'node:test';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { createInitialCustomerState, type AgentRequest } from '@training/contracts';
import { AppModule } from '../../src/app.module.js';
import { FakeModelAdapter } from '../../src/adapters/fake-model.adapter.js';
import { createPostgresExecutor, MigrationRunner, registeredMigrations } from '../../src/database/migrations/index.js';
import { createPostgresTestSupport } from '../support/postgres.js';

test('automatic termination rolls back as one transaction and retries with one report job', { timeout: 120_000 }, async context => {
  const postgres = await createPostgresTestSupport().start();
  const db = createPostgresExecutor(postgres.connectionUri);
  await new MigrationRunner(db, registeredMigrations).applyAll();
  process.env.DATABASE_URL = postgres.connectionUri;
  const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).overrideProvider(FakeModelAdapter).useValue({
    async generate(input: AgentRequest) {
      const before = input.simulation?.currentCustomerState ?? createInitialCustomerState(input.simulation?.personaSnapshot);
      return { modelVersion: 'state-test', content: JSON.stringify({
        schemaVersion: 'agent-output/v1', replyText: '谢谢，今天就到这里。', suggestedAction: 'ask_follow_up', confidence: .9, knowledgeReferences: [],
        stateTransition: { schemaVersion: 'customer-state-transition/v1', before, after: { ...before, emotion: before.emotion + 20 }, changes: { emotion: 20 }, knowledgeAssessment: {}, capabilityEvidence: [], terminal: { shouldEnd: true, reason: 'natural_end', confidence: .9 } },
      }) };
    },
  }).compile();
  const app = moduleRef.createNestApplication();
  await app.init();
  context.after(async () => { await app.close(); await db.close(); await postgres.stop(); });
  const token = 'fixture:identity:valid';
  const created = await request(app.getHttpServer()).post('/me/sessions/free').set('x-access-token', token).set('Idempotency-Key', 'atomic-state-test').send({ persona: { ageCardId: 'young-lady', psychologyCardIds: [], difficulty: 2, productScenarioId: 'anti-aging' } }).expect(201);
  const id = created.body.conversationId as string;
  await db.query(`CREATE FUNCTION fail_evaluation() RETURNS trigger AS $$ BEGIN RAISE EXCEPTION 'injected evaluation failure'; END; $$ LANGUAGE plpgsql`);
  await db.query(`CREATE TRIGGER fail_evaluation BEFORE INSERT ON evaluation_job FOR EACH ROW EXECUTE FUNCTION fail_evaluation()`);
  const body = { clientMessageId: 'atomic-turn', sequence: 1, content: '谢谢咨询' };
  await request(app.getHttpServer()).post(`/me/conversations/${id}/messages`).set('x-access-token', token).send(body).expect(500);
  const failed = await db.query<{ status: string; response: string | null }>(`SELECT c.status, m.response_hash AS response FROM conversation c JOIN conversation_message m ON m.conversation_id = c.id WHERE c.id = $1`, [id]);
  assert.equal(failed.rows[0]?.status, 'awaiting_model', 'failed settlement must preserve resumable turn');
  assert.equal(failed.rows[0]?.response, null, 'reply and state must roll back with the job');
  await db.query('DROP TRIGGER fail_evaluation ON evaluation_job');
  const sent = await request(app.getHttpServer()).post(`/me/conversations/${id}/messages`).set('x-access-token', token).send(body).expect(201);
  assert.equal(sent.body.status, 'ended');
  assert.equal(sent.body.endReason, 'natural_end');
  assert.equal(sent.body.customerMood, 'positive');
  const replay = await request(app.getHttpServer()).post(`/me/conversations/${id}/messages`).set('x-access-token', token).send(body).expect(201);
  assert.equal(replay.body.status, 'ended');
  assert.equal(replay.body.version, sent.body.version);
  assert.equal(replay.body.endReason, 'natural_end');
  const detail = await request(app.getHttpServer()).get(`/me/conversations/${id}`).set('x-access-token', token).expect(200);
  assert.equal(detail.body.initialCustomerState.emotion, 50);
  assert.equal(detail.body.currentCustomerState.emotion, 70);
  const jobs = await db.query<{ count: string }>('SELECT COUNT(*)::text AS count FROM evaluation_job WHERE conversation_id=$1', [id]);
  assert.equal(jobs.rows[0]?.count, '1');
  const sessions = await db.query<{ status: string }>('SELECT status FROM training_session WHERE id=$1', [created.body.trainingSessionId ?? created.body.sessionId]);
  // The next session creation is the public proof that the active slot was freed.
  await request(app.getHttpServer()).post('/me/sessions/free').set('x-access-token', token).set('Idempotency-Key', 'atomic-next-session').send({ persona: { ageCardId: 'young-lady', psychologyCardIds: [], difficulty: 2, productScenarioId: 'anti-aging' } }).expect(201);
});
