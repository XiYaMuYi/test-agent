import assert from 'node:assert/strict';
import test from 'node:test';

import { isModelProviderError } from '@training/contracts';
import { PythonAiAdapter } from '../../dist/adapters/python-ai.adapter.js';

const configuration = {
  baseUrl: 'http://python-ai.internal/',
  internalToken: 'test-token',
  timeoutMs: 5000,
};

const simulation = {
  mode: 'reply',
  conversationId: 'conversation-1',
  personaSnapshot: null,
  recentMessages: [],
  learnerMessage: '你好',
  approvedKnowledge: [],
};

test('PythonAiAdapter posts structured context and returns agent-output/v1 as model content', async () => {
  const seen = [];
  const output = {
    schemaVersion: 'agent-output/v1',
    replyText: '你好，我想看看产品。',
    suggestedAction: 'ask_follow_up',
    knowledgeReferences: [],
    confidence: 0.2,
    modelVersion: 'qwen-test',
    usage: { inputTokens: 10, outputTokens: 5 },
  };
  const adapter = new PythonAiAdapter(async (url, init) => {
    seen.push({ url, init });
    return { ok: true, status: 200, json: async () => output };
  }, configuration);

  const result = await adapter.generate({ sessionId: 'conversation-1', prompt: 'legacy prompt', simulation });

  assert.equal(seen[0].url, 'http://python-ai.internal/internal/v1/customer/reply');
  assert.equal(seen[0].init.headers['x-internal-token'], 'test-token');
  const body = JSON.parse(seen[0].init.body);
  assert.equal(body.schemaVersion, 'customer-simulation-request/v1');
  assert.deepEqual(body.approvedKnowledge, []);
  assert.equal(JSON.parse(result.content).replyText, output.replyText);
  assert.equal(result.modelVersion, 'qwen-test');
});

test('PythonAiAdapter rejects missing context and invalid upstream output', async () => {
  const adapter = new PythonAiAdapter(
    async () => ({ ok: true, status: 200, json: async () => ({ replyText: 'missing schema' }) }),
    configuration,
  );
  await assert.rejects(
    () => adapter.generate({ sessionId: 'conversation-1', prompt: 'x' }),
    (error) => isModelProviderError(error) && error.code === 'MODEL_RESPONSE_INVALID',
  );
  await assert.rejects(
    () => adapter.generate({ sessionId: 'conversation-1', prompt: 'x', simulation }),
    (error) => isModelProviderError(error) && error.code === 'MODEL_RESPONSE_INVALID',
  );
});
