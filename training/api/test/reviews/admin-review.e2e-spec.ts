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

  async function insertLearner(organizationId: string, principalId: string, displayName: string | null) {
    const learnerId = crypto.randomUUID();
    await db.query(
      `INSERT INTO learner_profile
        (internal_learner_id, organization_id, external_principal_id, identity_provider, display_name,
         total_free_sessions, total_assigned_sessions, dimension_scores, weak_points)
       VALUES ($1,$2,$3,'gongzhugou',$4,0,0,'{}'::jsonb,'[]'::jsonb)`,
      [learnerId, organizationId, principalId, displayName],
    );
    return learnerId;
  }

  // assigned 训练链：场景→快照→任务→学员任务→尝试→会话
  async function insertAssignedSession(organizationId: string, learnerId: string, scenarioTitle: string, assignmentName: string) {
    const draftId = crypto.randomUUID();
    const snapshotId = crypto.randomUUID();
    const assignmentId = crypto.randomUUID();
    const learnerAssignmentId = crypto.randomUUID();
    const attemptId = crypto.randomUUID();
    const sessionId = crypto.randomUUID();
    await db.query(`INSERT INTO scenario_draft (id, organization_id, title, payload) VALUES ($1,$2,$3,'{}'::jsonb)`, [draftId, organizationId, scenarioTitle]);
    await db.query(`INSERT INTO release_snapshot (id, scenario_draft_id, organization_id, schema_version, snapshot) VALUES ($1,$2,$3,'release-snapshot/v1','{}'::jsonb)`, [snapshotId, draftId, organizationId]);
    await db.query(
      `INSERT INTO assignment (id, organization_id, release_snapshot_id, name, status, starts_at, ends_at, max_attempts, target_principal_ids)
       VALUES ($1,$2,$3,$4,'ended',NOW()-INTERVAL '10 days',NOW()-INTERVAL '9 days',2,'[]'::jsonb)`,
      [assignmentId, organizationId, snapshotId, assignmentName],
    );
    await db.query(
      `INSERT INTO learner_assignment (id, organization_id, assignment_id, learner_id, state, total_attempts)
       VALUES ($1,$2,$3,$4,'completed',1)`,
      [learnerAssignmentId, organizationId, assignmentId, learnerId],
    );
    await db.query(
      `INSERT INTO training_attempt (id, organization_id, learner_assignment_id, idempotency_key, status)
       VALUES ($1,$2,$3,$4,'completed')`,
      [attemptId, organizationId, learnerAssignmentId, `att-${sessionId}`],
    );
    await db.query(
      `INSERT INTO training_session (id, organization_id, learner_id, source_type, mode, release_snapshot_id, assignment_id, learner_assignment_id, training_attempt_id, persona_snapshot, status, idempotency_key, started_at, finished_at)
       VALUES ($1,$2,$3,'assigned','exam',$4,$5,$6,$7,'{}'::jsonb,'scored',$8,NOW()-INTERVAL '2 days',NOW()-INTERVAL '2 days'+INTERVAL '10 minutes')`,
      [sessionId, organizationId, learnerId, snapshotId, assignmentId, learnerAssignmentId, attemptId, `sess-${sessionId}`],
    );
    return { sessionId, snapshotId, attemptId };
  }

  async function insertFreeSession(organizationId: string, learnerId: string, startedAgo = '1 hour') {
    const sessionId = crypto.randomUUID();
    await db.query(
      `INSERT INTO training_session (id, organization_id, learner_id, source_type, mode, persona_snapshot, status, idempotency_key, started_at)
       VALUES ($1,$2,$3,'free','practice','{}'::jsonb,'ended',$4,NOW()-INTERVAL '${startedAgo}')`,
      [sessionId, organizationId, learnerId, `free-${sessionId}`],
    );
    return sessionId;
  }

  async function insertConversation(
    organizationId: string,
    sessionId: string,
    chain: { attemptId: string | null; snapshotId: string | null },
  ) {
    const conversationId = crypto.randomUUID();
    await db.query(
      `INSERT INTO conversation (id, organization_id, training_attempt_id, release_snapshot_id, training_session_id, status, version, last_sequence)
       VALUES ($1,$2,$3,$4,$5,'ended',1,0)`,
      [conversationId, organizationId, chain.attemptId, chain.snapshotId, sessionId],
    );
    return conversationId;
  }

  async function insertMessage(organizationId: string, conversationId: string, sequence: number, learnerText: string, replyText: string | null) {
    const messageId = crypto.randomUUID();
    const responseHash = replyText === null ? null : JSON.stringify({
      conversationId,
      status: 'active',
      version: sequence,
      messageId,
      sequence,
      content: learnerText,
      suggestion: {
        schemaVersion: 'agent-output/v1',
        replyText,
        suggestedAction: 'advance',
        knowledgeReferences: [],
        confidence: 0.9,
      },
    });
    await db.query(
      `INSERT INTO conversation_message (id, organization_id, conversation_id, sequence, client_message_id, role, content, request_hash, response_hash)
       VALUES ($1,$2,$3,$4,$5,'learner',$6,$7,$8)`,
      [messageId, organizationId, conversationId, sequence, `cm-${messageId}`, learnerText, `req-${messageId}`, responseHash],
    );
  }

  async function insertReport(organizationId: string, conversationId: string, score: number, createdAt?: string) {
    const jobId = crypto.randomUUID();
    const reportId = crypto.randomUUID();
    await db.query(
      `INSERT INTO evaluation_job (id, organization_id, conversation_id, status, attempt_count)
       VALUES ($1,$2,$3,'succeeded',1)`,
      [jobId, organizationId, conversationId],
    );
    await db.query(
      `INSERT INTO evaluation_report (id, organization_id, conversation_id, evaluation_job_id, status, report${createdAt ? ', created_at' : ''})
       VALUES ($1,$2,$3,$4,'published',$5::jsonb${createdAt ? ', $6' : ''})`,
      createdAt
        ? [reportId, organizationId, conversationId, jobId, JSON.stringify({ schemaVersion: 'evaluation-report/v1', score }), createdAt]
        : [reportId, organizationId, conversationId, jobId, JSON.stringify({ schemaVersion: 'evaluation-report/v1', score })],
    );
    return reportId;
  }

  return { app, db, insertLearner, insertAssignedSession, insertFreeSession, insertConversation, insertMessage, insertReport };
}

test('admin evaluation list joins business fields, filters by source/learner, paginates and is isolated', { timeout: 120_000 }, async (context) => {
  const helpers = await boot(context);
  const { app } = helpers;
  const http = app.getHttpServer();

  const learnerA = await helpers.insertLearner(ORGANIZATION_A, 'streamer-001', '张三');
  const assigned = await helpers.insertAssignedSession(ORGANIZATION_A, learnerA, '抗老咨询场景', '9月抗老开场专项');
  const assignedConv = await helpers.insertConversation(ORGANIZATION_A, assigned.sessionId, { attemptId: assigned.attemptId, snapshotId: assigned.snapshotId });
  await helpers.insertReport(ORGANIZATION_A, assignedConv, 92, new Date(Date.now() - 1000 * 60 * 60).toISOString());

  const freeSessionId = await helpers.insertFreeSession(ORGANIZATION_A, learnerA);
  const freeConv = await helpers.insertConversation(ORGANIZATION_A, freeSessionId, { attemptId: null, snapshotId: null });
  await helpers.insertReport(ORGANIZATION_A, freeConv, 70, new Date().toISOString());

  // 跨组织一条，用于隔离断言
  const learnerB = await helpers.insertLearner(ORGANIZATION_B, 'streamer-b-1', '隔壁');
  const bSession = await helpers.insertFreeSession(ORGANIZATION_B, learnerB);
  const bConv = await helpers.insertConversation(ORGANIZATION_B, bSession, { attemptId: null, snapshotId: null });
  await helpers.insertReport(ORGANIZATION_B, bConv, 55);

  const all = await request(http).get('/admin/evaluations').set('x-access-token', ADMIN_A).expect(200);
  assert.ok(!Array.isArray(all.body), 'T22 起列表为分页包裹结构');
  assert.equal(all.body.total, 2, '只统计本组织');
  assert.equal(all.body.limit, 20);
  assert.equal(all.body.offset, 0);
  assert.equal(all.body.items.length, 2);
  // 最新评估在前（free 70 刚创建）
  assert.equal(all.body.items[0].conversationId, freeConv);
  const newest = all.body.items[0];
  assert.equal(newest.learnerId, learnerA);
  assert.equal(newest.principalId, 'streamer-001');
  assert.equal(newest.displayName, '张三');
  assert.equal(newest.sourceType, 'free');
  assert.equal(newest.mode, 'practice');
  assert.equal(newest.scenarioTitle, null, '自由练习无场景');
  assert.equal(newest.assignmentName, null);
  assert.equal(newest.score, 70);
  assert.ok(newest.sessionStartedAt, '带训练开始时间');
  assert.ok(newest.evaluatedAt, '带评估时间');
  assert.ok(newest.evaluationId, '带评估 id 供前端串联');

  const assignedRow = all.body.items.find((r: { conversationId: string }) => r.conversationId === assignedConv);
  assert.equal(assignedRow.sourceType, 'assigned');
  assert.equal(assignedRow.mode, 'exam');
  assert.equal(assignedRow.scenarioTitle, '抗老咨询场景');
  assert.equal(assignedRow.assignmentName, '9月抗老开场专项');
  assert.equal(assignedRow.score, 92);

  // 按来源筛选
  const onlyAssigned = await request(http).get('/admin/evaluations?source=assigned').set('x-access-token', ADMIN_A).expect(200);
  assert.equal(onlyAssigned.body.total, 1);
  assert.equal(onlyAssigned.body.items[0].sourceType, 'assigned');
  const onlyFree = await request(http).get('/admin/evaluations?source=free').set('x-access-token', ADMIN_A).expect(200);
  assert.equal(onlyFree.body.total, 1);
  // 按学员筛选
  const byLearner = await request(http).get(`/admin/evaluations?learnerId=${learnerA}`).set('x-access-token', ADMIN_A).expect(200);
  assert.equal(byLearner.body.total, 2);
  // 分页：total 不受影响
  const paged = await request(http).get('/admin/evaluations?limit=1').set('x-access-token', ADMIN_A).expect(200);
  assert.equal(paged.body.items.length, 1);
  assert.equal(paged.body.total, 2);

  // 跨组织看不到
  const orgB = await request(http).get('/admin/evaluations').set('x-access-token', ADMIN_B).expect(200);
  assert.equal(orgB.body.total, 1);
  assert.equal(orgB.body.items[0].conversationId, bConv);
  // 主播 403、非法筛选/分页 400
  await request(http).get('/admin/evaluations').set('x-access-token', STREAMER_A).expect(403);
  await request(http).get('/admin/evaluations?source=weird').set('x-access-token', ADMIN_A).expect(400);
  await request(http).get('/admin/evaluations?limit=0').set('x-access-token', ADMIN_A).expect(400);
  await request(http).get('/admin/evaluations?offset=-2').set('x-access-token', ADMIN_A).expect(400);
});

test('admin conversation replay returns ordered turns and report, and is isolated/admin-only', { timeout: 120_000 }, async (context) => {
  const helpers = await boot(context);
  const { app } = helpers;
  const http = app.getHttpServer();

  const learner = await helpers.insertLearner(ORGANIZATION_A, 'streamer-001', '张三');
  const freeSessionId = await helpers.insertFreeSession(ORGANIZATION_A, learner);
  const freeConv = await helpers.insertConversation(ORGANIZATION_A, freeSessionId, { attemptId: null, snapshotId: null });
  await helpers.insertMessage(ORGANIZATION_A, freeConv, 1, '你好，我想了解抗老产品', '您好，欢迎了解我们的抗老系列。');
  await helpers.insertMessage(ORGANIZATION_A, freeConv, 2, '多少钱一套', '这款套装活动价 999 元。');

  const replay = await request(http).get(`/admin/conversations/${freeConv}`).set('x-access-token', ADMIN_A).expect(200);
  assert.equal(replay.body.conversationId, freeConv);
  assert.equal(replay.body.status, 'ended');
  assert.equal(replay.body.sourceType, 'free');
  assert.equal(replay.body.mode, 'practice');
  assert.equal(replay.body.learnerId, learner);
  assert.equal(replay.body.principalId, 'streamer-001');
  assert.equal(replay.body.displayName, '张三');
  assert.equal(replay.body.scenarioTitle, null);
  assert.equal(replay.body.assignmentName, null);
  assert.equal(replay.body.report, null, '尚未评分时 report 为 null');
  assert.equal(replay.body.messages.length, 4, '两轮对话还原为 learner/assistant 共 4 条');
  assert.deepEqual(
    replay.body.messages.map((m: { role: string; content: string }) => [m.role, m.content]),
    [
      ['learner', '你好，我想了解抗老产品'],
      ['assistant', '您好，欢迎了解我们的抗老系列。'],
      ['learner', '多少钱一套'],
      ['assistant', '这款套装活动价 999 元。'],
    ],
  );

  // assigned 对话回放带业务名与评估报告
  const assigned = await helpers.insertAssignedSession(ORGANIZATION_A, learner, '抗老咨询场景', '9月抗老开场专项');
  const assignedConv = await helpers.insertConversation(ORGANIZATION_A, assigned.sessionId, { attemptId: assigned.attemptId, snapshotId: assigned.snapshotId });
  await helpers.insertMessage(ORGANIZATION_A, assignedConv, 1, '开场', '你好，我是你的专属顾问。');
  await helpers.insertReport(ORGANIZATION_A, assignedConv, 92);
  const assignedReplay = await request(http).get(`/admin/conversations/${assignedConv}`).set('x-access-token', ADMIN_A).expect(200);
  assert.equal(assignedReplay.body.sourceType, 'assigned');
  assert.equal(assignedReplay.body.scenarioTitle, '抗老咨询场景');
  assert.equal(assignedReplay.body.assignmentName, '9月抗老开场专项');
  assert.equal(assignedReplay.body.report.score, 92);
  assert.equal(assignedReplay.body.messages.length, 2);

  // 跨组织 / 不存在 404，主播 403
  const cross = await request(http).get(`/admin/conversations/${freeConv}`).set('x-access-token', ADMIN_B).expect(404);
  assert.equal(cross.body.code, 'CONVERSATION_NOT_FOUND');
  await request(http).get('/admin/conversations/99999999-9999-9999-9999-999999999999').set('x-access-token', ADMIN_A).expect(404);
  await request(http).get(`/admin/conversations/${freeConv}`).set('x-access-token', STREAMER_A).expect(403);
});
