import assert from 'node:assert/strict';
import test from 'node:test';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../../src/app.module.js';
import { createPostgresExecutor, MigrationRunner, registeredMigrations } from '../../src/database/migrations/index.js';
import { createPostgresTestSupport } from '../support/postgres.js';
const ADMIN_A = 'fixture:identity:admin-organization-a';
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/u;
async function boot(context) {
    const postgres = await createPostgresTestSupport().start();
    const db = createPostgresExecutor(postgres.connectionUri);
    const runner = new MigrationRunner(db, registeredMigrations);
    await runner.applyAll();
    process.env.DATABASE_URL = postgres.connectionUri;
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    const app = moduleRef.createNestApplication();
    await app.init();
    context.after(async () => {
        await app.close();
        await db.close();
        await postgres.stop();
    });
    return { app, http: app.getHttpServer() };
}
function validDraft(title) {
    return {
        payload: {
            title,
            knowledgeVersions: ['knowledge-welcome@v1', 'knowledge-product@v1'],
            scoringRules: ['opening'],
            agentConfig: {},
        },
    };
}
test('admin scenario lifecycle: server-generated id, draft list/detail, published counts and snapshot list', { timeout: 120_000 }, async (context) => {
    const { http } = await boot(context);
    // 1) 创建时不传 id，由后端生成并返回
    const created = await request(http).post('/admin/scenarios').set('x-access-token', ADMIN_A).send(validDraft('抗老开场')).expect(201);
    const draftId = created.body.id;
    assert.match(draftId, UUID_RE, 'draft id must be a server-generated UUID');
    assert.equal(created.body.status, 'created');
    // 兼容：显式传 id 仍可用
    const explicitId = '66666666-6666-6666-6666-666666666666';
    await request(http).post('/admin/scenarios').set('x-access-token', ADMIN_A)
        .send({ id: explicitId, payload: { title: '美白异议', knowledgeVersions: ['k@v1'], scoringRules: ['r'], agentConfig: {} } })
        .expect(201);
    // 2) 草稿列表，字段业务化、含知识/规则计数
    const list = await request(http).get('/admin/scenarios').set('x-access-token', ADMIN_A).expect(200);
    assert.equal(list.body.items.length, 2);
    const first = list.body.items.find((item) => item.id === draftId);
    assert.equal(first.title, '抗老开场');
    assert.equal(first.knowledgeCount, 2);
    assert.equal(first.scoringCount, 1);
    assert.equal(first.publishedCount, 0);
    assert.equal(first.latestSnapshotId, null);
    assert.ok(typeof first.updatedAt === 'string');
    // 3) 草稿详情
    const detail = await request(http).get(`/admin/scenarios/${draftId}`).set('x-access-token', ADMIN_A).expect(200);
    assert.equal(detail.body.id, draftId);
    assert.equal(detail.body.title, '抗老开场');
    assert.deepEqual(detail.body.payload.knowledgeVersions, ['knowledge-welcome@v1', 'knowledge-product@v1']);
    // 4) 校验 + 发布后，列表计数与最新快照更新
    await request(http).post(`/admin/scenarios/${draftId}/validate`).set('x-access-token', ADMIN_A).expect(200);
    await request(http).post(`/admin/scenarios/${draftId}/publish`).set('x-access-token', ADMIN_A).expect(201);
    const listAfter = await request(http).get('/admin/scenarios').set('x-access-token', ADMIN_A).expect(200);
    const firstAfter = listAfter.body.items.find((item) => item.id === draftId);
    assert.equal(firstAfter.publishedCount, 1);
    assert.match(firstAfter.latestSnapshotId, UUID_RE);
    // 5) 已发布快照列表（JOIN 出场景标题），支持按草稿过滤
    const snapshots = await request(http).get('/admin/release-snapshots').set('x-access-token', ADMIN_A).expect(200);
    assert.equal(snapshots.body.items.length, 1);
    assert.equal(snapshots.body.items[0].scenarioDraftId, draftId);
    assert.equal(snapshots.body.items[0].title, '抗老开场');
    assert.equal(snapshots.body.items[0].isActive, true);
    const filtered = await request(http).get(`/admin/release-snapshots?scenarioDraftId=${explicitId}`).set('x-access-token', ADMIN_A).expect(200);
    assert.equal(filtered.body.items.length, 0);
});
test('scenario admin reads are organization-isolated and admin-only', { timeout: 120_000 }, async (context) => {
    const { http } = await boot(context);
    const created = await request(http).post('/admin/scenarios').set('x-access-token', ADMIN_A).send(validDraft('org-a 场景')).expect(201);
    const draftId = created.body.id;
    // 跨组织管理员看不到草稿详情（404，不泄露存在性），其列表为空
    await request(http).get(`/admin/scenarios/${draftId}`).set('x-access-token', 'fixture:identity:cross-organization').expect(404);
    const otherList = await request(http).get('/admin/scenarios').set('x-access-token', 'fixture:identity:cross-organization').expect(200);
    assert.equal(otherList.body.items.length, 0);
    const otherSnapshots = await request(http).get('/admin/release-snapshots').set('x-access-token', 'fixture:identity:cross-organization').expect(200);
    assert.equal(otherSnapshots.body.items.length, 0);
    // 主播无权访问管理端列表
    await request(http).get('/admin/scenarios').set('x-access-token', 'fixture:identity:valid').expect(403);
    await request(http).get('/admin/release-snapshots').set('x-access-token', 'fixture:identity:valid').expect(403);
});
