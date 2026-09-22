import assert from 'node:assert/strict';
import test from 'node:test';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../../src/app.module.js';
import { FakeModelAdapter } from '../../src/adapters/fake-model.adapter.js';
import { createPostgresExecutor, MigrationRunner, registeredMigrations } from '../../src/database/migrations/index.js';
import { createPostgresTestSupport } from '../support/postgres.js';
const STREAMER = 'fixture:identity:valid';
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
test('GET /me/persona/presets returns the four frozen option groups', { timeout: 120_000 }, async (context) => {
    const postgres = await createPostgresTestSupport().start();
    const db = createPostgresExecutor(postgres.connectionUri);
    await new MigrationRunner(db, registeredMigrations).applyAll();
    const app = await createApp(postgres.connectionUri);
    context.after(async () => {
        await app.close();
        await db.close();
        await postgres.stop();
    });
    const response = await request(app.getHttpServer())
        .get('/me/persona/presets')
        .set('x-access-token', STREAMER)
        .expect(200);
    assert.equal(response.body.ageCards.length, 6);
    assert.equal(response.body.psychologyCards.length, 8);
    assert.equal(response.body.difficultyLevels.length, 4);
    assert.equal(response.body.productScenarios.length, 8);
});
test('POST /me/persona/preview builds a validated snapshot', { timeout: 120_000 }, async (context) => {
    const postgres = await createPostgresTestSupport().start();
    const db = createPostgresExecutor(postgres.connectionUri);
    await new MigrationRunner(db, registeredMigrations).applyAll();
    const app = await createApp(postgres.connectionUri);
    context.after(async () => {
        await app.close();
        await db.close();
        await postgres.stop();
    });
    const response = await request(app.getHttpServer())
        .post('/me/persona/preview')
        .set('x-access-token', STREAMER)
        .send({
        ageCardId: 'light-mature',
        psychologyCardIds: ['hesitant', 'skeptical'],
        difficulty: 3,
        productScenarioId: 'whitening',
        overrides: { personality: { friendliness: 88 } },
    })
        .expect(201);
    assert.equal(response.body.basedOnCard, 'light-mature');
    assert.equal(response.body.conversation.difficulty, 3);
    assert.equal(response.body.conversation.productScenario, '美白淡斑');
    assert.equal(response.body.personality.skepticism, 100, 'stacked boosts clamp at 100');
    assert.equal(response.body.personality.friendliness, 88, 'override wins');
    assert.equal(response.body.consumption.brandLoyalty, 'medium');
});
test('POST /me/persona/preview rejects an unknown preset with 422 PERSONA_PRESET_NOT_FOUND', { timeout: 120_000 }, async (context) => {
    const postgres = await createPostgresTestSupport().start();
    const db = createPostgresExecutor(postgres.connectionUri);
    await new MigrationRunner(db, registeredMigrations).applyAll();
    const app = await createApp(postgres.connectionUri);
    context.after(async () => {
        await app.close();
        await db.close();
        await postgres.stop();
    });
    const response = await request(app.getHttpServer())
        .post('/me/persona/preview')
        .set('x-access-token', STREAMER)
        .send({ ageCardId: 'ghost', difficulty: 1, productScenarioId: 'acne' })
        .expect(422);
    assert.equal(response.body.code, 'PERSONA_PRESET_NOT_FOUND');
});
test('persona endpoints require an authenticated principal', { timeout: 120_000 }, async (context) => {
    const postgres = await createPostgresTestSupport().start();
    const db = createPostgresExecutor(postgres.connectionUri);
    await new MigrationRunner(db, registeredMigrations).applyAll();
    const app = await createApp(postgres.connectionUri);
    context.after(async () => {
        await app.close();
        await db.close();
        await postgres.stop();
    });
    await request(app.getHttpServer()).get('/me/persona/presets').expect(401);
});
