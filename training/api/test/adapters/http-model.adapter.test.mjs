import assert from 'node:assert/strict';
import test from 'node:test';

import { HttpModelAdapter, isModelProviderError } from '@training/contracts';
import { validModelRequestFixture } from '@training/test-fixtures';

function config(overrides = {}) {
  return {
    baseUrl: 'https://model.example.test/v1/',
    apiKey: 'test-secret',
    model: 'qwen-test',
    timeoutMs: 5000,
    ...overrides,
  };
}

function chatCompletion(body) {
  return { ok: true, status: 200, json: async () => body };
}

test('HttpModelAdapter posts an OpenAI-compatible chat completion and returns the message content', async () => {
  const seen = [];
  const fetcher = async (url, init) => {
    seen.push({ url, init });
    return chatCompletion({
      model: 'qwen-test-2026',
      choices: [{ message: { role: 'assistant', content: '{"schemaVersion":"agent-output/v1"}' } }],
    });
  };
  const adapter = new HttpModelAdapter(fetcher, config());

  const result = await adapter.generate(validModelRequestFixture());

  assert.equal(seen.length, 1);
  assert.equal(seen[0].url, 'https://model.example.test/v1/chat/completions', 'trailing slash is collapsed before appending the path');
  assert.equal(seen[0].init.method, 'POST');
  assert.equal(seen[0].init.headers.authorization, 'Bearer test-secret');
  assert.equal(seen[0].init.headers['content-type'], 'application/json');
  assert.deepEqual(JSON.parse(seen[0].init.body), {
    model: 'qwen-test',
    messages: [{ role: 'user', content: validModelRequestFixture().prompt }],
    response_format: { type: 'json_object' },
    enable_thinking: false,
  }, 'requests strict JSON mode so reasoning models return a parseable object; thinking off for latency');
  assert.equal(result.content, '{"schemaVersion":"agent-output/v1"}');
  assert.equal(result.modelVersion, 'qwen-test-2026', 'modelVersion echoes the upstream model id when present');
});

test('HttpModelAdapter omits enable_thinking only when enableThinking is explicitly true', async () => {
  const seen = [];
  const fetcher = async (url, init) => {
    seen.push({ url, init });
    return chatCompletion({ choices: [{ message: { content: 'ok' } }] });
  };
  const adapter = new HttpModelAdapter(fetcher, config({ enableThinking: true }));
  await adapter.generate(validModelRequestFixture());
  const body = JSON.parse(seen[0].init.body);
  assert.equal('enable_thinking' in body, false, 'opt-in keeps the model default thinking behavior');
});

test('HttpModelAdapter falls back to the configured model name when upstream omits model', async () => {
  const fetcher = async () => chatCompletion({ choices: [{ message: { content: 'reply' } }] });
  const adapter = new HttpModelAdapter(fetcher, config());
  const result = await adapter.generate(validModelRequestFixture());
  assert.equal(result.modelVersion, 'qwen-test');
});

test('HttpModelAdapter maps a non-2xx upstream response to MODEL_UPSTREAM_UNAVAILABLE without leaking the key', async () => {
  const fetcher = async () => ({ ok: false, status: 401, json: async () => ({ error: { message: 'invalid api key test-secret' } }) });
  const adapter = new HttpModelAdapter(fetcher, config());
  await assert.rejects(
    () => adapter.generate(validModelRequestFixture()),
    (error) => isModelProviderError(error) && error.code === 'MODEL_UPSTREAM_UNAVAILABLE' && !error.message.includes('test-secret'),
  );
});

test('HttpModelAdapter maps a response without a usable message to MODEL_RESPONSE_INVALID', async () => {
  const bodies = [{}, { choices: [] }, { choices: [{ message: {} }] }, { choices: [{ message: { content: '' } }] }];
  for (const body of bodies) {
    const fetcher = async () => chatCompletion(body);
    const adapter = new HttpModelAdapter(fetcher, config());
    await assert.rejects(
      () => adapter.generate(validModelRequestFixture()),
      (error) => isModelProviderError(error) && error.code === 'MODEL_RESPONSE_INVALID',
    );
  }
});

test('HttpModelAdapter maps an abort/timeout rejection to MODEL_TIMEOUT', async () => {
  const aborted = new Error('The operation was aborted');
  aborted.name = 'AbortError';
  const fetcher = async () => { throw aborted; };
  const adapter = new HttpModelAdapter(fetcher, config());
  await assert.rejects(
    () => adapter.generate(validModelRequestFixture()),
    (error) => isModelProviderError(error) && error.code === 'MODEL_TIMEOUT',
  );
});

test('HttpModelAdapter maps any other network failure to MODEL_UPSTREAM_UNAVAILABLE', async () => {
  const fetcher = async () => { throw new TypeError('fetch failed'); };
  const adapter = new HttpModelAdapter(fetcher, config());
  await assert.rejects(
    () => adapter.generate(validModelRequestFixture()),
    (error) => isModelProviderError(error) && error.code === 'MODEL_UPSTREAM_UNAVAILABLE',
  );
});
