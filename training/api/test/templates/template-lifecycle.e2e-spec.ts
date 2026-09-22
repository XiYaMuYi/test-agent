import assert from 'node:assert/strict';
import test from 'node:test';

import { Test } from '@nestjs/testing';
import request from 'supertest';

import { buildDefaultConfig } from '@training/contracts';

import { AppModule } from '../../src/app.module.js';
import { FakeModelAdapter } from '../../src/adapters/fake-model.adapter.js';
import { createPostgresExecutor, MigrationRunner, registeredMigrations } from '../../src/database/migrations/index.js';
import { createPostgresTestSupport } from '../support/postgres.js';

const STREAMER = 'fixture:identity:valid';
const ADMIN = 'fixture:identity:admin-organization-a';
const ADMIN_OTHER_ORG = 'fixture:identity:cross-organization';
const PLATFORM_ORG = '00000000-0000-0000-0000-000000000001';

async function boot() {
  const postgres = await createPostgresTestSupport().start();
  const db = createPostgresExecutor(postgres.connectionUri);
  await new MigrationRunner(db, registeredMigrations).applyAll();
  process.env.DATABASE_URL = postgres.connectionUri;
  const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
    .overrideProvider(FakeModelAdapter)
    .useValue(new FakeModelAdapter({ scenario: 'success' }))
    .compile();
  const app = moduleRef.createNestApplication();
  await app.init();
  return { postgres, db, app };
}

async function createOrgTemplate(app: Awaited<ReturnType<typeof boot>>['app'], title: string) {
  const res = await request(app.getHttpServer())
    .post('/admin/templates')
    .set('x-access-token', ADMIN)
    .send({ title, personaConfig: buildDefaultConfig() })
    .expect(201);
  return res.body as { id: string; status: string; scope: string };
}

test('admin filters organization templates by status, edits, archives and reactivates', { timeout: 120_000 }, async (context) => {
  const { postgres, db, app } = await boot();
  context.after(async () => { await app.close(); await db.close(); await postgres.stop(); });
  const http = app.getHttpServer();

  const tpl = await createOrgTemplate(app, '抗老主推模板');
  assert.equal(tpl.status, 'active');

  // 默认与显式 active 只列生效中；archived 初始为空；all 能看到
  assert.equal((await request(http).get('/admin/templates').set('x-access-token', ADMIN).expect(200)).body.items.length, 1);
  assert.equal((await request(http).get('/admin/templates?status=active').set('x-access-token', ADMIN).expect(200)).body.items.length, 1);
  assert.equal((await request(http).get('/admin/templates?status=archived').set('x-access-token', ADMIN).expect(200)).body.items.length, 0);
  assert.equal((await request(http).get('/admin/templates?status=all').set('x-access-token', ADMIN).expect(200)).body.items.length, 1);

  // 编辑：改标题与知识/评分要点
  const patched = await request(http).patch(`/admin/templates/${tpl.id}`).set('x-access-token', ADMIN)
    .send({ title: '抗老主推模板-改', knowledgeVersions: ['k1@v1', 'k2@v1'], scoringRules: ['开场'] })
    .expect(200);
  assert.equal(patched.body.title, '抗老主推模板-改');
  assert.deepEqual(patched.body.knowledgeVersions, ['k1@v1', 'k2@v1']);
  assert.deepEqual(patched.body.scoringRules, ['开场']);

  // 归档：生效列表消失、归档列表出现、学习者不可见
  const archived = await request(http).post(`/admin/templates/${tpl.id}/archive`).set('x-access-token', ADMIN).expect(200);
  assert.equal(archived.body.status, 'archived');
  assert.equal((await request(http).get('/admin/templates').set('x-access-token', ADMIN).expect(200)).body.items.length, 0);
  const archivedList = await request(http).get('/admin/templates?status=archived').set('x-access-token', ADMIN).expect(200);
  assert.equal(archivedList.body.items.length, 1);
  const learnerVisible = await request(http).get('/me/templates').set('x-access-token', STREAMER).expect(200);
  assert.equal(learnerVisible.body.items.length, 0, 'archived organization template is hidden from learners');

  // 重新启用：生效列表与学习者可见性恢复
  const reactivated = await request(http).post(`/admin/templates/${tpl.id}/activate`).set('x-access-token', ADMIN).expect(200);
  assert.equal(reactivated.body.status, 'active');
  assert.equal((await request(http).get('/admin/templates').set('x-access-token', ADMIN).expect(200)).body.items.length, 1);
  assert.equal((await request(http).get('/me/templates').set('x-access-token', STREAMER).expect(200)).body.items.length, 1);
});

test('template maintenance validates input, is organization-isolated and admin-only', { timeout: 120_000 }, async (context) => {
  const { postgres, db, app } = await boot();
  context.after(async () => { await app.close(); await db.close(); await postgres.stop(); });
  const http = app.getHttpServer();
  const tpl = await createOrgTemplate(app, '隔离测试模板');

  // 非法 status 筛选参数
  await request(http).get('/admin/templates?status=bogus').set('x-access-token', ADMIN).expect(400);
  // 空标题编辑拒绝
  await request(http).patch(`/admin/templates/${tpl.id}`).set('x-access-token', ADMIN).send({ title: '   ' }).expect(400);
  // 空 patch 拒绝
  await request(http).patch(`/admin/templates/${tpl.id}`).set('x-access-token', ADMIN).send({}).expect(400);
  // 不存在的模板：编辑/归档均 404
  const missing = '99999999-9999-9999-9999-999999999999';
  await request(http).patch(`/admin/templates/${missing}`).set('x-access-token', ADMIN).send({ title: 'x' }).expect(404);
  await request(http).post(`/admin/templates/${missing}/archive`).set('x-access-token', ADMIN).expect(404);

  // 跨组织管理员看不到也动不了（404，不泄露存在性）
  await request(http).post(`/admin/templates/${tpl.id}/archive`).set('x-access-token', ADMIN_OTHER_ORG).expect(404);
  assert.equal((await request(http).get('/admin/templates?status=all').set('x-access-token', ADMIN_OTHER_ORG).expect(200)).body.items.length, 0);

  // 主播无权维护
  await request(http).patch(`/admin/templates/${tpl.id}`).set('x-access-token', STREAMER).send({ title: 'hacked' }).expect(403);
  await request(http).post(`/admin/templates/${tpl.id}/archive`).set('x-access-token', STREAMER).expect(403);

  // 平台模板不属于组织管理员可维护范围 → 404
  await db.query(
    `INSERT INTO training_template (id, organization_id, scope, owner_learner_id, title, persona_config)
     VALUES ($1, $2, 'platform', NULL, '官方模板', $3::jsonb)`,
    ['aaaaaaaa-0000-0000-0000-000000000001', PLATFORM_ORG, JSON.stringify(buildDefaultConfig())],
  );
  await request(http).post('/admin/templates/aaaaaaaa-0000-0000-0000-000000000001/archive').set('x-access-token', ADMIN).expect(404);
});
