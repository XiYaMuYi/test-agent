import assert from 'node:assert/strict';
import test from 'node:test';

import { Test } from '@nestjs/testing';
import request from 'supertest';

import { AppModule } from '../../src/app.module.js';
import { FakeModelAdapter } from '../../src/adapters/fake-model.adapter.js';
import { createPostgresExecutor, MigrationRunner, registeredMigrations } from '../../src/database/migrations/index.js';
import { createPostgresTestSupport } from '../support/postgres.js';

const STREAMER = 'fixture:identity:valid';
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

async function boot() {
  const postgres = await createPostgresTestSupport().start();
  const db = createPostgresExecutor(postgres.connectionUri);
  await new MigrationRunner(db, registeredMigrations).applyAll();
  const app = await createApp(postgres.connectionUri);
  return { postgres, db, app };
}

test('POST /me/sessions/free creates once, replays the same key, and rejects a concurrent second session', { timeout: 120_000 }, async (context) => {
  const { postgres, db, app } = await boot();
  context.after(async () => {
    await app.close();
    await db.close();
    await postgres.stop();
  });

  const first = await request(app.getHttpServer())
    .post('/me/sessions/free')
    .set('x-access-token', STREAMER)
    .set('Idempotency-Key', 'free-1')
    .send(validBody())
    .expect(201);
  assert.equal(typeof first.body.sessionId, 'string');
  assert.equal(typeof first.body.conversationId, 'string');
  assert.equal(first.body.sourceType, 'free');

  const replay = await request(app.getHttpServer())
    .post('/me/sessions/free')
    .set('x-access-token', STREAMER)
    .set('Idempotency-Key', 'free-1')
    .send(validBody())
    .expect(201);
  assert.deepEqual(replay.body, first.body, 'idempotent replay returns the same result');

  const conflict = await request(app.getHttpServer())
    .post('/me/sessions/free')
    .set('x-access-token', STREAMER)
    .set('Idempotency-Key', 'free-2')
    .send(validBody())
    .expect(409);
  assert.equal(conflict.body.code, 'SESSION_ALREADY_ACTIVE');
});

test('POST /me/sessions/free enforces idempotency header, persona validity and authentication', { timeout: 120_000 }, async (context) => {
  const { postgres, db, app } = await boot();
  context.after(async () => {
    await app.close();
    await db.close();
    await postgres.stop();
  });

  const missingKey = await request(app.getHttpServer())
    .post('/me/sessions/free')
    .set('x-access-token', STREAMER)
    .send(validBody())
    .expect(400);
  assert.equal(missingKey.body.code, 'IDEMPOTENCY_KEY_REQUIRED');

  const badPersona = await request(app.getHttpServer())
    .post('/me/sessions/free')
    .set('x-access-token', STREAMER)
    .set('Idempotency-Key', 'bad-persona')
    .send({ persona: { ageCardId: 'ghost', difficulty: 2, productScenarioId: 'acne' } })
    .expect(422);
  assert.equal(badPersona.body.code, 'PERSONA_PRESET_NOT_FOUND');

  await request(app.getHttpServer())
    .post('/me/sessions/free')
    .set('Idempotency-Key', 'no-auth')
    .send(validBody())
    .expect(401);
});
