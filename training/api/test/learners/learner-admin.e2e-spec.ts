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
const ADMIN_B = 'fixture:identity:cross-organization';
const STREAMER_A = 'fixture:identity:valid';

async function boot(context: test.TestContext) {
  const postgres = await createPostgresTestSupport().start();
  const db = createPostgresExecutor(postgres.connectionUri);
  await new MigrationRunner(db, registeredMigrations).applyAll();
  process.env.DATABASE_URL = postgres.connectionUri;
  const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
  const app = moduleRef.createNestApplication();
  await app.init();
  context.after(async () => { await app.close(); await db.close(); await postgres.stop(); });

  async function insertLearner(organizationId: string, principalId: string, displayName: string | null, patch: Record<string, string> = {}) {
    const learnerId = crypto.randomUUID();
    await db.query(
      `INSERT INTO learner_profile
        (internal_learner_id, organization_id, external_principal_id, identity_provider, display_name,
         total_free_sessions, total_assigned_sessions, avg_score, dimension_scores, weak_points, last_trained_at)
       VALUES ($1,$2,$3,'gongzhugou',$4,$5,$6,$7,$8::jsonb,$9::jsonb,$10)`,
      [
        learnerId, organizationId, principalId, displayName,
        patch.totalFree ?? '0', patch.totalAssigned ?? '0', patch.avg ?? null,
        patch.dimensions ?? '{}', patch.weak ?? '[]', patch.lastTrained ?? null,
      ],
    );
    return learnerId;
  }

  return { app, db, insertLearner };
}

test('admin learner list searches by account/name, paginates and is organization-isolated/admin-only', { timeout: 120_000 }, async (context) => {
  const { app, insertLearner } = await boot(context);
  const http = app.getHttpServer();

  await insertLearner(ORGANIZATION_A, 'streamer-001', '张三', {
    totalFree: '3', totalAssigned: '1', avg: '82.50',
    dimensions: '{"开场":80}', weak: '["开场"]', lastTrained: new Date().toISOString(),
  });
  await insertLearner(ORGANIZATION_A, 'streamer-002', null);
  await insertLearner(ORGANIZATION_B, 'streamer-b-1', '隔壁主播');

  const all = await request(http).get('/admin/learners').set('x-access-token', ADMIN_A).expect(200);
  assert.equal(all.body.total, 2, '只统计本组织');
  assert.equal(all.body.items.length, 2);
  assert.equal(all.body.limit, 20);
  assert.equal(all.body.offset, 0);
  // 最近练习过的排前面
  assert.equal(all.body.items[0].principalId, 'streamer-001');
  assert.equal(all.body.items[0].displayName, '张三');
  assert.equal(all.body.items[0].totalFreeSessions, 3);
  assert.equal(all.body.items[0].totalAssignedSessions, 1);
  assert.equal(all.body.items[0].avgScore, 82.5);
  assert.ok(all.body.items[0].learnerId, '列表行带内部 learnerId');
  assert.ok(!('dimensionScores' in all.body.items[0]), '列表不展开维度明细');
  // 未沉淀姓名时为 null 而非报错
  assert.equal(all.body.items[1].displayName, null);

  const byAccount = await request(http).get('/admin/learners?q=streamer-001').set('x-access-token', ADMIN_A).expect(200);
  assert.equal(byAccount.body.total, 1);
  assert.equal(byAccount.body.items[0].principalId, 'streamer-001');
  const byName = await request(http).get('/admin/learners?q=%E5%BC%A0').set('x-access-token', ADMIN_A).expect(200);
  assert.equal(byName.body.total, 1, '支持按中文姓名模糊搜索');
  const none = await request(http).get('/admin/learners?q=nobody').set('x-access-token', ADMIN_A).expect(200);
  assert.equal(none.body.total, 0);

  const page1 = await request(http).get('/admin/learners?limit=1').set('x-access-token', ADMIN_A).expect(200);
  assert.equal(page1.body.items.length, 1);
  assert.equal(page1.body.total, 2, 'total 不受分页影响');
  const page2 = await request(http).get('/admin/learners?limit=1&offset=1').set('x-access-token', ADMIN_A).expect(200);
  assert.equal(page2.body.items[0].principalId, 'streamer-002');

  // 跨组织只看到自己的主播
  const orgB = await request(http).get('/admin/learners').set('x-access-token', ADMIN_B).expect(200);
  assert.equal(orgB.body.total, 1);
  assert.equal(orgB.body.items[0].principalId, 'streamer-b-1');

  // 主播无权访问
  await request(http).get('/admin/learners').set('x-access-token', STREAMER_A).expect(403);
  // 非法分页参数
  await request(http).get('/admin/learners?limit=0').set('x-access-token', ADMIN_A).expect(400);
  await request(http).get('/admin/learners?limit=abc').set('x-access-token', ADMIN_A).expect(400);
  await request(http).get('/admin/learners?offset=-1').set('x-access-token', ADMIN_A).expect(400);
});

test('admin learner detail returns profile plus recent sessions and is isolated/admin-only', { timeout: 120_000 }, async (context) => {
  const { app, db, insertLearner } = await boot(context);
  const http = app.getHttpServer();

  const learnerId = await insertLearner(ORGANIZATION_A, 'streamer-001', '张三', {
    totalFree: '2', totalAssigned: '1', avg: '88.00',
    dimensions: '{"开场":90,"异议处理":70}', weak: '["异议处理"]', lastTrained: new Date().toISOString(),
  });
  const idleLearnerId = await insertLearner(ORGANIZATION_A, 'streamer-002', null);

  // 场景 + 快照 + 任务，用于 assigned 训练的业务名 JOIN
  const draftId = crypto.randomUUID();
  const snapshotId = crypto.randomUUID();
  const assignmentId = crypto.randomUUID();
  await db.query(`INSERT INTO scenario_draft (id, organization_id, title, payload) VALUES ($1,$2,$3,'{}'::jsonb)`, [draftId, ORGANIZATION_A, '抗老咨询场景']);
  await db.query(`INSERT INTO release_snapshot (id, scenario_draft_id, organization_id, schema_version, snapshot) VALUES ($1,$2,$3,'release-snapshot/v1','{}'::jsonb)`, [snapshotId, draftId, ORGANIZATION_A]);
  await db.query(
    `INSERT INTO assignment (id, organization_id, release_snapshot_id, name, status, starts_at, ends_at, max_attempts, target_principal_ids)
     VALUES ($1,$2,$3,$4,'ended',NOW()-INTERVAL '10 days',NOW()-INTERVAL '9 days',2,'[]'::jsonb)`,
    [assignmentId, ORGANIZATION_A, snapshotId, '9月抗老开场专项'],
  );

  const assignedSessionId = crypto.randomUUID();
  const freeSessionId = crypto.randomUUID();
  // assigned 训练必须带齐 learner_assignment + training_attempt 链（DB CHECK 约束）
  const learnerAssignmentId = crypto.randomUUID();
  const attemptId = crypto.randomUUID();
  await db.query(
    `INSERT INTO learner_assignment (id, organization_id, assignment_id, learner_id, state, total_attempts)
     VALUES ($1,$2,$3,$4,'completed',1)`,
    [learnerAssignmentId, ORGANIZATION_A, assignmentId, learnerId],
  );
  await db.query(
    `INSERT INTO training_attempt (id, organization_id, learner_assignment_id, idempotency_key, status)
     VALUES ($1,$2,$3,'att-assigned','completed')`,
    [attemptId, ORGANIZATION_A, learnerAssignmentId],
  );
  await db.query(
    `INSERT INTO training_session (id, organization_id, learner_id, source_type, mode, release_snapshot_id, assignment_id, learner_assignment_id, training_attempt_id, persona_snapshot, status, idempotency_key, started_at, finished_at)
     VALUES ($1,$2,$3,'assigned','exam',$4,$5,$6,$7,'{}'::jsonb,'scored','key-assigned',NOW()-INTERVAL '2 days',NOW()-INTERVAL '2 days'+INTERVAL '10 minutes')`,
    [assignedSessionId, ORGANIZATION_A, learnerId, snapshotId, assignmentId, learnerAssignmentId, attemptId],
  );
  await db.query(
    `INSERT INTO training_session (id, organization_id, learner_id, source_type, mode, persona_snapshot, status, idempotency_key, started_at)
     VALUES ($1,$2,$3,'free','practice','{}'::jsonb,'ended','key-free',NOW()-INTERVAL '1 hour')`,
    [freeSessionId, ORGANIZATION_A, learnerId],
  );

  const detail = await request(http).get(`/admin/learners/${learnerId}`).set('x-access-token', ADMIN_A).expect(200);
  assert.equal(detail.body.learnerId, learnerId);
  assert.equal(detail.body.principalId, 'streamer-001');
  assert.equal(detail.body.displayName, '张三');
  assert.deepEqual(detail.body.dimensionScores, { 开场: 90, 异议处理: 70 });
  assert.deepEqual(detail.body.weakPoints, ['异议处理']);
  assert.equal(detail.body.recentSessions.length, 2, '近 20 条训练');
  // 最近开始的自由练习排第一，无场景/任务时安全返回 null
  assert.equal(detail.body.recentSessions[0].id, freeSessionId);
  assert.equal(detail.body.recentSessions[0].sourceType, 'free');
  assert.equal(detail.body.recentSessions[0].scenarioTitle, null);
  assert.equal(detail.body.recentSessions[0].assignmentName, null);
  assert.equal(detail.body.recentSessions[0].score, null, '暂无评分报告时为 null');
  // assigned 训练 JOIN 出场景名与任务名
  const assigned = detail.body.recentSessions[1];
  assert.equal(assigned.id, assignedSessionId);
  assert.equal(assigned.sourceType, 'assigned');
  assert.equal(assigned.mode, 'exam');
  assert.equal(assigned.scenarioTitle, '抗老咨询场景');
  assert.equal(assigned.assignmentName, '9月抗老开场专项');

  // 没有训练记录的学员详情正常返回空数组
  const idle = await request(http).get(`/admin/learners/${idleLearnerId}`).set('x-access-token', ADMIN_A).expect(200);
  assert.deepEqual(idle.body.recentSessions, []);

  // 跨组织 404、不存在 404、主播 403
  const cross = await request(http).get(`/admin/learners/${learnerId}`).set('x-access-token', ADMIN_B).expect(404);
  assert.equal(cross.body.code, 'LEARNER_PROFILE_NOT_FOUND');
  await request(http).get('/admin/learners/99999999-9999-9999-9999-999999999999').set('x-access-token', ADMIN_A).expect(404);
  await request(http).get(`/admin/learners/${learnerId}`).set('x-access-token', STREAMER_A).expect(403);
});
