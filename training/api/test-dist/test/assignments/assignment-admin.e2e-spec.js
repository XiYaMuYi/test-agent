import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import test from 'node:test';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../../src/app.module.js';
import { createPostgresExecutor, MigrationRunner, registeredMigrations } from '../../src/database/migrations/index.js';
import { createPostgresTestSupport } from '../support/postgres.js';
const ORGANIZATION_A = '11111111-1111-1111-1111-111111111111';
const ADMIN_A = 'fixture:identity:admin-organization-a';
const STREAMER_A = 'fixture:identity:valid';
const ADMIN_B = 'fixture:identity:cross-organization';
async function boot(context, draftTitle = '抗老咨询场景') {
    const postgres = await createPostgresTestSupport().start();
    const db = createPostgresExecutor(postgres.connectionUri);
    await new MigrationRunner(db, registeredMigrations).applyAll();
    process.env.DATABASE_URL = postgres.connectionUri;
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    const app = moduleRef.createNestApplication();
    await app.init();
    context.after(async () => { await app.close(); await db.close(); await postgres.stop(); });
    const draftId = crypto.randomUUID();
    const releaseSnapshotId = crypto.randomUUID();
    await db.query(`INSERT INTO scenario_draft (id, organization_id, title, payload)
     VALUES ($1, $2, $3, '{}'::jsonb)`, [draftId, ORGANIZATION_A, draftTitle]);
    await db.query(`INSERT INTO release_snapshot (id, scenario_draft_id, organization_id, schema_version, snapshot)
     VALUES ($1, $2, $3, 'release-snapshot/v1', '{}'::jsonb)`, [releaseSnapshotId, draftId, ORGANIZATION_A]);
    return { app, db, releaseSnapshotId };
}
function body(releaseSnapshotId, targets, overrides = {}) {
    return {
        releaseSnapshotId,
        name: '新品抗老陪练任务',
        status: 'active',
        startsAt: new Date(Date.now() - 60_000).toISOString(),
        endsAt: new Date(Date.now() + 60 * 60_000).toISOString(),
        maxAttempts: 2,
        targetPrincipalIds: targets,
        ...overrides,
    };
}
test('assignment id is server-generated, admin list joins scenario title and aggregates learners, detail returns roster', { timeout: 120_000 }, async (context) => {
    const { app, db, releaseSnapshotId } = await boot(context);
    const http = app.getHttpServer();
    // 不传 id：后端生成 UUID 并返回
    const withoutId = await request(http).post('/admin/assignments').set('x-access-token', ADMIN_A)
        .send(body(releaseSnapshotId, ['streamer-001', 'streamer-002'])).expect(201);
    const assignmentId = withoutId.body.assignmentId;
    assert.match(assignmentId, /^[0-9a-f-]{36}$/, 'id 由后端生成 UUID');
    // 显式 id 仍兼容
    const explicitId = crypto.randomUUID();
    await request(http).post('/admin/assignments').set('x-access-token', ADMIN_A)
        .send(body(releaseSnapshotId, ['streamer-003'], { id: explicitId, status: 'paused', name: '暂停中的任务' })).expect(201);
    // 其中一名学员标记完成，验证聚合
    await db.query(`UPDATE learner_assignment SET state = 'completed', total_attempts = 1 WHERE assignment_id = $1 AND learner_id IN
                  (SELECT learner_id FROM learner_assignment WHERE assignment_id = $1 LIMIT 1)`, [assignmentId]);
    const list = await request(http).get('/admin/assignments').set('x-access-token', ADMIN_A).expect(200);
    assert.equal(list.body.items.length, 2, '默认返回全部状态任务');
    const first = list.body.items.find((item) => item.id === assignmentId);
    assert.equal(first.scenarioTitle, '抗老咨询场景', 'JOIN 出场景业务名');
    assert.equal(first.targetCount, 2);
    assert.equal(first.assignedCount, 2);
    assert.equal(first.completedCount, 1);
    assert.equal(first.status, 'active');
    assert.ok(!('targetPrincipalIds' in first), '列表不回传投放名单明细');
    const pausedOnly = await request(http).get('/admin/assignments?status=paused').set('x-access-token', ADMIN_A).expect(200);
    assert.deepEqual(pausedOnly.body.items.map((i) => i.id), [explicitId]);
    // 详情：回传投放名单与学员明细
    const detail = await request(http).get(`/admin/assignments/${assignmentId}`).set('x-access-token', ADMIN_A).expect(200);
    assert.equal(detail.body.name, '新品抗老陪练任务');
    assert.equal(detail.body.scenarioTitle, '抗老咨询场景');
    assert.deepEqual([...detail.body.targetPrincipalIds].sort(), ['streamer-001', 'streamer-002']);
    assert.equal(detail.body.learners.length, 2);
    const states = detail.body.learners.map((l) => l.state).sort();
    assert.deepEqual(states, ['completed', 'eligible']);
});
test('assignment status machine enforces legal transitions and is isolated/admin-only', { timeout: 120_000 }, async (context) => {
    const { app, releaseSnapshotId } = await boot(context);
    const http = app.getHttpServer();
    const created = await request(http).post('/admin/assignments').set('x-access-token', ADMIN_A)
        .send(body(releaseSnapshotId, ['streamer-001'])).expect(201);
    const id = created.body.assignmentId;
    const pause = async (status) => request(http).post(`/admin/assignments/${id}/status`).set('x-access-token', ADMIN_A).send({ status });
    // active → paused → active → ended
    assert.equal((await pause('paused')).body.status, 'paused');
    assert.equal((await pause('active')).body.status, 'active');
    assert.equal((await pause('ended')).body.status, 'ended');
    // ended 是终态
    const illegal = await request(http).post(`/admin/assignments/${id}/status`).set('x-access-token', ADMIN_A).send({ status: 'active' }).expect(409);
    assert.equal(illegal.body.code, 'ASSIGNMENT_ILLEGAL_TRANSITION');
    // 非法目标状态
    const bogus = await request(http).post(`/admin/assignments/${id}/status`).set('x-access-token', ADMIN_A).send({ status: 'deleted' }).expect(400);
    assert.equal(bogus.body.code, 'SCHEMA_INVALID');
    const missing = '99999999-9999-9999-9999-999999999999';
    await request(http).post(`/admin/assignments/${missing}/status`).set('x-access-token', ADMIN_A).send({ status: 'paused' }).expect(404);
    await request(http).get(`/admin/assignments/${missing}`).set('x-access-token', ADMIN_A).expect(404);
    // 跨组织：列表为空、详情与状态操作 404
    assert.equal((await request(http).get('/admin/assignments').set('x-access-token', ADMIN_B).expect(200)).body.items.length, 0);
    await request(http).get(`/admin/assignments/${id}`).set('x-access-token', ADMIN_B).expect(404);
    await request(http).post(`/admin/assignments/${id}/status`).set('x-access-token', ADMIN_B).send({ status: 'paused' }).expect(404);
    // 主播无权管理
    await request(http).get('/admin/assignments').set('x-access-token', STREAMER_A).expect(403);
    await request(http).post(`/admin/assignments/${id}/status`).set('x-access-token', STREAMER_A).send({ status: 'paused' }).expect(403);
});
test('task-level parameter override: create with patch, update it, reject invalid & ended', { timeout: 120_000 }, async (context) => {
    const { app, releaseSnapshotId } = await boot(context);
    const http = app.getHttpServer();
    // 创建时携带覆盖：AgentConfigV1 部分字段 + 关键对话参数
    const created = await request(http).post('/admin/assignments').set('x-access-token', ADMIN_A)
        .send(body(releaseSnapshotId, ['streamer-001'], {
        overridePatch: {
            agentConfig: { historyMessageLimit: 5, closingTendency: 'resistant' },
            conversation: { maxTurns: 8, openingMode: 'wait_learner', background: '35岁敏感肌宝妈，预算500元内' },
        },
    })).expect(201);
    const id = created.body.assignmentId;
    // 列表与详情回传覆盖（缺省字段不回传或为 undefined）
    const list = await request(http).get('/admin/assignments').set('x-access-token', ADMIN_A).expect(200);
    const row = list.body.items.find((item) => item.id === id);
    assert.equal(row.overridePatch.agentConfig.historyMessageLimit, 5);
    assert.equal(row.overridePatch.agentConfig.closingTendency, 'resistant');
    assert.equal(row.overridePatch.conversation.maxTurns, 8);
    assert.equal(row.overridePatch.conversation.openingMode, 'wait_learner');
    // 更新覆盖（任务可编辑；未覆盖字段不修改）
    const updated = await request(http).patch(`/admin/assignments/${id}/override`).set('x-access-token', ADMIN_A)
        .send({ overridePatch: { agentConfig: { responseLength: 'detailed' } } }).expect(200);
    assert.equal(updated.body.overridePatch.agentConfig.historyMessageLimit, 5, '原覆盖字段保留');
    assert.equal(updated.body.overridePatch.agentConfig.responseLength, 'detailed', '新增覆盖字段生效');
    assert.equal(updated.body.overridePatch.conversation.maxTurns, 8, 'conversation 覆盖不受影响');
    // 清空覆盖
    const cleared = await request(http).patch(`/admin/assignments/${id}/override`).set('x-access-token', ADMIN_A)
        .send({ overridePatch: null }).expect(200);
    assert.equal(cleared.body.overridePatch, null);
    // 非法覆盖拒绝：未知字段 / 越界 / 错误枚举
    await request(http).patch(`/admin/assignments/${id}/override`).set('x-access-token', ADMIN_A)
        .send({ overridePatch: { agentConfig: { modelName: 'gpt-4' } } }).expect(400);
    await request(http).patch(`/admin/assignments/${id}/override`).set('x-access-token', ADMIN_A)
        .send({ overridePatch: { agentConfig: { historyMessageLimit: 1 } } }).expect(400);
    await request(http).patch(`/admin/assignments/${id}/override`).set('x-access-token', ADMIN_A)
        .send({ overridePatch: { conversation: { openingMode: 'silent' } } }).expect(400);
    await request(http).patch(`/admin/assignments/${id}/override`).set('x-access-token', ADMIN_A)
        .send({ overridePatch: { agentConfig: {} } }).expect(400);
    // 已结束任务禁止再改覆盖
    await request(http).post(`/admin/assignments/${id}/status`).set('x-access-token', ADMIN_A).send({ status: 'ended' }).expect(200);
    await request(http).patch(`/admin/assignments/${id}/override`).set('x-access-token', ADMIN_A)
        .send({ overridePatch: { conversation: { maxTurns: 5 } } }).expect(409);
});
test('task-level override is frozen into a newly started assigned session; later edits do not touch it', { timeout: 120_000 }, async (context) => {
    const { app, db, releaseSnapshotId } = await boot(context);
    const http = app.getHttpServer();
    // 目标学员 = fixture:identity:valid（subjectId streamer-001，属于 org-a）
    const created = await request(http).post('/admin/assignments').set('x-access-token', ADMIN_A)
        .send(body(releaseSnapshotId, ['streamer-001'], {
        overridePatch: {
            agentConfig: { historyMessageLimit: 5, closingTendency: 'resistant' },
            conversation: { maxTurns: 8, openingMode: 'wait_learner', background: '35岁敏感肌宝妈' },
        },
    })).expect(201);
    const id = created.body.assignmentId;
    // C 端学员启动第一个会话
    const firstResponse = await request(http).post(`/me/assignments/${id}/attempts`)
        .set('x-access-token', 'fixture:identity:valid')
        .set('Idempotency-Key', 'stage3-freeze-1');
    if (firstResponse.status !== 201) {
        // eslint-disable-next-line no-console
        console.error('DIAG first attempt status=', firstResponse.status, 'body=', JSON.stringify(firstResponse.body));
    }
    assert.equal(firstResponse.status, 201, 'first assigned attempt must be created');
    const first = firstResponse;
    const firstSession = (await db.query(`SELECT training_session_id FROM conversation WHERE id = $1`, [first.body.conversationId])).rows[0]?.training_session_id;
    assert.ok(firstSession !== undefined, 'conversation must be bound to a training_session');
    const frozen = await db.query(`SELECT persona_snapshot AS persona, agent_config AS agent FROM training_session WHERE id = $1`, [firstSession]);
    const row = frozen.rows[0];
    assert.ok(row !== undefined, 'training_session must exist');
    const persona = row.persona;
    const agent = row.agent;
    assert.equal(persona.conversation.maxTurns, 8, 'conversation.maxTurns override frozen into persona_snapshot');
    assert.equal(persona.conversation.openingMode, 'wait_learner');
    assert.equal(persona.conversation.background, '35岁敏感肌宝妈');
    assert.equal(agent.historyMessageLimit, 5, 'agentConfig override frozen into training_session.agent_config');
    assert.equal(agent.closingTendency, 'resistant');
    assert.equal(agent.responseLength, 'normal', 'non-overridden agentConfig field keeps snapshot default');
    // 更新覆盖 → 第二个会话用新值，第一个会话保持冻结
    await request(http).patch(`/admin/assignments/${id}/override`).set('x-access-token', ADMIN_A)
        .send({ overridePatch: { conversation: { maxTurns: 12 } } }).expect(200);
    // 先结束第一个会话（单学员全局单活跃会话），再启动第二个
    await request(http).post(`/me/conversations/${first.body.conversationId}/end`)
        .set('x-access-token', 'fixture:identity:valid').expect(201);
    const second = await request(http).post(`/me/assignments/${id}/attempts`)
        .set('x-access-token', 'fixture:identity:valid')
        .set('Idempotency-Key', 'stage3-freeze-2')
        .expect(201);
    const secondSession = (await db.query(`SELECT training_session_id FROM conversation WHERE id = $1`, [second.body.conversationId])).rows[0]?.training_session_id;
    assert.ok(secondSession !== undefined, 'second conversation must be bound to a training_session');
    const secondRow = (await db.query(`SELECT persona_snapshot AS persona FROM training_session WHERE id = $1`, [secondSession])).rows[0];
    assert.ok(secondRow !== undefined, 'second training_session must exist');
    const secondPersona = secondRow.persona;
    assert.equal(secondPersona.conversation.maxTurns, 12, 'new session picks up the updated override');
    const firstRowAfter = (await db.query(`SELECT persona_snapshot AS persona FROM training_session WHERE id = $1`, [firstSession])).rows[0];
    assert.ok(firstRowAfter !== undefined, 'first training_session must still exist');
    const firstPersonaAfter = firstRowAfter.persona;
    assert.equal(firstPersonaAfter.conversation.maxTurns, 8, 'historical session stays frozen at the original override');
});
