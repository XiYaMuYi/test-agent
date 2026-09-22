import assert from 'node:assert/strict';
import test from 'node:test';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../../src/app.module.js';
import { createPostgresExecutor, MigrationRunner, registeredMigrations } from '../../src/database/migrations/index.js';
import { createPostgresTestSupport } from '../support/postgres.js';
async function createApp(databaseUrl) {
    process.env.DATABASE_URL = databaseUrl;
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    const app = moduleRef.createNestApplication();
    await app.init();
    return app;
}
test('publish flow creates snapshot and outbox and preserves immutability', { timeout: 120_000 }, async (context) => {
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
    const adminToken = 'fixture:identity:admin-organization-a';
    const draftId = '55555555-5555-5555-5555-555555555555';
    await request(app.getHttpServer())
        .post('/admin/scenarios')
        .set('x-access-token', adminToken)
        .send({
        id: draftId,
        payload: {
            title: 'draft',
            knowledgeVersions: ['knowledge-welcome@v1'],
            scoringRules: ['r1'],
            agentConfig: {},
        },
    })
        .expect(201);
    const validate = await request(app.getHttpServer())
        .post(`/admin/scenarios/${draftId}/validate`)
        .set('x-access-token', adminToken)
        .expect(200);
    assert.equal(validate.body.valid, true);
    await request(app.getHttpServer())
        .post(`/admin/scenarios/${draftId}/publish`)
        .set('x-access-token', adminToken)
        .expect(201);
    const snapshotRows = await db.query('SELECT id, organization_id, scenario_draft_id, snapshot FROM release_snapshot ORDER BY created_at');
    assert.equal(snapshotRows.rows.length, 1);
    assert.equal(snapshotRows.rows[0]?.organization_id, '11111111-1111-1111-1111-111111111111');
    assert.equal(snapshotRows.rows[0]?.scenario_draft_id, draftId);
    const outboxRows = await db.query('SELECT event_type, status FROM outbox_event ORDER BY created_at');
    assert.equal(outboxRows.rows.length, 1);
    assert.equal(outboxRows.rows[0]?.event_type, 'release.published');
    assert.equal(outboxRows.rows[0]?.status, 'pending');
    await request(app.getHttpServer())
        .post(`/admin/scenarios/${draftId}/publish`)
        .set('x-access-token', adminToken)
        .expect(201);
    const snapshotRowsAfter = await db.query('SELECT id FROM release_snapshot ORDER BY created_at');
    assert.equal(snapshotRowsAfter.rows.length, 2);
    assert.notEqual(snapshotRowsAfter.rows[0]?.id, snapshotRowsAfter.rows[1]?.id);
    const outboxRowsAfter = await db.query('SELECT id FROM outbox_event ORDER BY created_at');
    assert.equal(outboxRowsAfter.rows.length, 2);
    assert.notEqual(outboxRowsAfter.rows[0]?.id, outboxRowsAfter.rows[1]?.id);
    await assert.rejects(db.query(`UPDATE release_snapshot SET title = 'changed' WHERE organization_id = '11111111-1111-1111-1111-111111111111'`));
    await assert.rejects(db.query(`DELETE FROM release_snapshot WHERE organization_id = '11111111-1111-1111-1111-111111111111'`));
});
