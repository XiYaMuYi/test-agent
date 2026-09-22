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
const STREAMER_OTHER = 'fixture:identity:streamer-organization-a-other';
const ADMIN = 'fixture:identity:admin-organization-a';
const PLATFORM_ORG = '00000000-0000-0000-0000-000000000001';
const PLATFORM_TEMPLATE = 'aaaaaaaa-0000-0000-0000-000000000001';
async function createApp(databaseUrl) {
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
test('learner saves personal templates, lists only own, and persona/title are validated', { timeout: 120_000 }, async (context) => {
    const { postgres, db, app } = await boot();
    context.after(async () => {
        await app.close();
        await db.close();
        await postgres.stop();
    });
    const saved = await request(app.getHttpServer())
        .post('/me/persona-templates')
        .set('x-access-token', STREAMER)
        .send({ title: '我的专属画像', personaConfig: buildDefaultConfig() })
        .expect(201);
    assert.equal(saved.body.scope, 'personal');
    assert.equal(typeof saved.body.id, 'string');
    const duplicate = await request(app.getHttpServer())
        .post('/me/persona-templates')
        .set('x-access-token', STREAMER)
        .send({ title: '我的专属画像', personaConfig: buildDefaultConfig() })
        .expect(409);
    assert.equal(duplicate.body.code, 'TEMPLATE_TITLE_CONFLICT');
    const invalidPersona = await request(app.getHttpServer())
        .post('/me/persona-templates')
        .set('x-access-token', STREAMER)
        .send({ title: '坏模板', personaConfig: { not: 'a persona' } })
        .expect(422);
    assert.equal(invalidPersona.body.code, 'PERSONA_CONFIG_INVALID');
    const missingTitle = await request(app.getHttpServer())
        .post('/me/persona-templates')
        .set('x-access-token', STREAMER)
        .send({ personaConfig: buildDefaultConfig() })
        .expect(400);
    assert.equal(missingTitle.body.code, 'SCHEMA_INVALID');
    const mine = await request(app.getHttpServer())
        .get('/me/persona-templates')
        .set('x-access-token', STREAMER)
        .expect(200);
    assert.equal(mine.body.items.length, 1);
    assert.equal(mine.body.items[0].id, saved.body.id);
    const otherLearner = await request(app.getHttpServer())
        .get('/me/persona-templates')
        .set('x-access-token', STREAMER_OTHER)
        .expect(200);
    assert.equal(otherLearner.body.items.length, 0, 'another learner cannot see this personal template');
});
test('platform/organization templates are visible to learners while admin maintenance is role-gated', { timeout: 120_000 }, async (context) => {
    const { postgres, db, app } = await boot();
    await db.query(`INSERT INTO training_template (id, organization_id, scope, owner_learner_id, title, persona_config)
     VALUES ($1, $2, 'platform', NULL, '官方模板', $3::jsonb)`, [PLATFORM_TEMPLATE, PLATFORM_ORG, JSON.stringify(buildDefaultConfig())]);
    context.after(async () => {
        await app.close();
        await db.close();
        await postgres.stop();
    });
    const orgTemplate = await request(app.getHttpServer())
        .post('/admin/templates')
        .set('x-access-token', ADMIN)
        .send({ title: '组织主推场景', personaConfig: buildDefaultConfig() })
        .expect(201);
    assert.equal(orgTemplate.body.scope, 'organization');
    assert.equal(orgTemplate.body.ownerLearnerId, null);
    await request(app.getHttpServer())
        .post('/admin/templates')
        .set('x-access-token', STREAMER)
        .send({ title: 'x', personaConfig: buildDefaultConfig() })
        .expect(403);
    const visible = await request(app.getHttpServer())
        .get('/me/templates')
        .set('x-access-token', STREAMER)
        .expect(200);
    const scopes = visible.body.items.map((item) => item.scope).sort();
    assert.deepEqual(scopes, ['organization', 'platform']);
    const adminList = await request(app.getHttpServer())
        .get('/admin/templates')
        .set('x-access-token', ADMIN)
        .expect(200);
    assert.deepEqual(adminList.body.items.map((item) => item.id), [orgTemplate.body.id], 'admin maintenance list shows only organization templates');
});
