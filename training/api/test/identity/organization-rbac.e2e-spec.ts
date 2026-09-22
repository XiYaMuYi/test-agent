import assert from 'node:assert/strict';
import test from 'node:test';

import { Test } from '@nestjs/testing';
import request from 'supertest';

import { AppModule } from '../../src/app.module.js';
import { createPostgresExecutor, MigrationRunner, registeredMigrations } from '../../src/database/migrations/index.js';
import { createPostgresTestSupport } from '../support/postgres.js';

async function createApp(databaseUrl: string) {
  process.env.DATABASE_URL = databaseUrl;
  const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
  const app = moduleRef.createNestApplication();
  await app.init();
  return app;
}

test('GET /admin/scenarios without token returns 401', async (context) => {
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

  await request(app.getHttpServer()).post('/admin/scenarios').expect(401);
});

test('streamer cannot access admin endpoint', async (context) => {
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

  await request(app.getHttpServer())
    .post('/admin/scenarios')
    .set('x-access-token', 'fixture:identity:valid')
    .send({ id: '22222222-2222-2222-2222-222222222222', payload: { title: 't', knowledgeVersions: ['knowledge-welcome@v1'], scoringRules: ['r1'], agentConfig: {} } })
    .expect(403);
});

test('admin from another organization is rejected on existing draft', async (context) => {
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

  const orgA = '11111111-1111-1111-1111-111111111111';
  const orgBToken = 'fixture:identity:cross-organization';
  const draftId = '44444444-4444-4444-4444-444444444444';

  await request(app.getHttpServer())
    .post('/admin/scenarios')
    .set('x-access-token', 'fixture:identity:admin-organization-a')
    .send({
      id: draftId,
      payload: { title: 't', knowledgeVersions: ['knowledge-welcome@v1'], scoringRules: ['r1'], agentConfig: {} },
    })
    .expect(201);

  const draftRow = await db.query<{ organization_id: string; id: string }>('SELECT organization_id, id FROM scenario_draft WHERE id = $1', [draftId]);
  assert.equal(draftRow.rows[0]?.organization_id, orgA);

  await request(app.getHttpServer())
    .post(`/admin/scenarios/${draftId}/validate`)
    .set('x-access-token', orgBToken)
    .expect(403);
});
