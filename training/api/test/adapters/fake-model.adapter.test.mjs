import assert from 'node:assert/strict';
import test from 'node:test';

import { FakeModelAdapter } from '../../dist/adapters/fake-model.adapter.js';
import {
  fakeModelSchemaErrorOptionsFixture,
  fakeModelSuccessOptionsFixture,
  fakeModelTimeoutOptionsFixture,
  validModelRequestFixture,
} from '@training/test-fixtures';

test('FakeModelAdapter returns a deterministic versioned structured response', async () => {
  const adapter = new FakeModelAdapter(fakeModelSuccessOptionsFixture());

  const result = await adapter.generate(validModelRequestFixture());

  assert.equal(result.modelVersion, 'fake-model-v1');
  assert.deepEqual(JSON.parse(result.content), {
    schemaVersion: 'agent-output/v1',
    replyText: '嗯……我再了解一下，这款真的适合我的情况吗？用起来会不会有什么不舒服的反应？',
    suggestedAction: 'ask_follow_up',
    knowledgeReferences: [],
    confidence: 0.9,
  });
});

test('FakeModelAdapter produces a timeout result without contacting a model service', async () => {
  const adapter = new FakeModelAdapter(fakeModelTimeoutOptionsFixture());

  await assert.rejects(
    () => adapter.generate(validModelRequestFixture()),
    { code: 'FAKE_MODEL_TIMEOUT' },
  );
});

test('FakeModelAdapter produces a schema error for invalid request input', async () => {
  const adapter = new FakeModelAdapter(fakeModelSchemaErrorOptionsFixture());

  await assert.rejects(
    () => adapter.generate({ sessionId: '', prompt: '' }),
    { code: 'FAKE_MODEL_SCHEMA_ERROR' },
  );
});
