import assert from 'node:assert/strict';
import test from 'node:test';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../src/app.module.js';
async function createTestApplication() {
    const testingModule = await Test.createTestingModule({ imports: [AppModule] }).compile();
    const app = testingModule.createNestApplication();
    await app.init();
    return app;
}
test('GET /health reports API readiness', async (context) => {
    const app = await createTestApplication();
    context.after(async () => app.close());
    const response = await request(app.getHttpServer()).get('/health').expect(200);
    assert.deepEqual(response.body, { status: 'ok', service: 'api' });
});
test('GET /health preserves a caller request id', async (context) => {
    const app = await createTestApplication();
    context.after(async () => app.close());
    const response = await request(app.getHttpServer())
        .get('/health')
        .set('x-request-id', 'caller-request-42')
        .expect(200);
    assert.equal(response.headers['x-request-id'], 'caller-request-42');
});
test('GET /health assigns a request id when none is supplied', async (context) => {
    const app = await createTestApplication();
    context.after(async () => app.close());
    const response = await request(app.getHttpServer()).get('/health').expect(200);
    assert.match(response.headers['x-request-id'] ?? '', /^[0-9a-f-]{36}$/i);
});
