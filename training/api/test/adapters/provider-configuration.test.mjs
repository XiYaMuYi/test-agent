import assert from 'node:assert/strict';
import test from 'node:test';

import { readAiProviderConfiguration } from '../../dist/adapters/provider-configuration.js';

test('defaults to the offline fake providers when no environment is provided', () => {
  const config = readAiProviderConfiguration({});
  assert.equal(config.modelProvider, 'fake');
  assert.equal(config.knowledgeProvider, 'fake');
  assert.equal(config.model, undefined);
  assert.equal(config.externalKnowledge, undefined);
});

test('production cannot silently fall back to the fake model', () => {
  assert.throws(
    () => readAiProviderConfiguration({ NODE_ENV: 'production' }),
    /MODEL_PROVIDER is required in production/,
  );
});

test('reads a complete HTTP model configuration and applies the default timeout', () => {
  const config = readAiProviderConfiguration({
    MODEL_PROVIDER: 'http',
    MODEL_BASE_URL: 'https://coding.dashscope.aliyuncs.com/v1',
    MODEL_API_KEY: 'sk-test',
    MODEL_NAME: 'qwen3.7-plus',
  });
  assert.equal(config.modelProvider, 'http');
  assert.deepEqual(config.model, {
    baseUrl: 'https://coding.dashscope.aliyuncs.com/v1',
    apiKey: 'sk-test',
    model: 'qwen3.7-plus',
    timeoutMs: 30000,
  });
});

test('reads the internal Python AI engine configuration and fails fast when incomplete', () => {
  const config = readAiProviderConfiguration({
    MODEL_PROVIDER: 'python',
    PYTHON_AI_BASE_URL: 'http://127.0.0.1:8000',
    PYTHON_AI_TOKEN: 'internal-test-token',
  });
  assert.equal(config.modelProvider, 'python');
  assert.deepEqual(config.pythonAi, {
    baseUrl: 'http://127.0.0.1:8000',
    internalToken: 'internal-test-token',
    timeoutMs: 30000,
  });
  assert.throws(
    () => readAiProviderConfiguration({ MODEL_PROVIDER: 'python' }),
    /PYTHON_AI_BASE_URL/,
  );
});

test('honors an explicit positive model timeout', () => {
  const config = readAiProviderConfiguration({
    MODEL_PROVIDER: 'http',
    MODEL_BASE_URL: 'u',
    MODEL_API_KEY: 'k',
    MODEL_NAME: 'm',
    MODEL_TIMEOUT_MS: '4200',
  });
  assert.equal(config.model.timeoutMs, 4200);
});

for (const missing of ['MODEL_BASE_URL', 'MODEL_API_KEY', 'MODEL_NAME']) {
  test(`selecting the HTTP model without ${missing} fails fast at startup`, () => {
    const env = { MODEL_PROVIDER: 'http', MODEL_BASE_URL: 'u', MODEL_API_KEY: 'k', MODEL_NAME: 'm' };
    delete env[missing];
    assert.throws(() => readAiProviderConfiguration(env), new RegExp(missing));
  });
}

test('rejects an unknown MODEL_PROVIDER value and a non-positive timeout', () => {
  assert.throws(
    () => readAiProviderConfiguration({ MODEL_PROVIDER: 'magic' }),
    /MODEL_PROVIDER/,
  );
  assert.throws(
    () => readAiProviderConfiguration({ MODEL_PROVIDER: 'http', MODEL_BASE_URL: 'u', MODEL_API_KEY: 'k', MODEL_NAME: 'm', MODEL_TIMEOUT_MS: '0' }),
    /MODEL_TIMEOUT_MS/,
  );
});

test('reads external knowledge configuration for the future weknora integration', () => {
  const config = readAiProviderConfiguration({
    KNOWLEDGE_PROVIDER: 'external',
    EXTERNAL_KNOWLEDGE_BASE_URL: 'http://weknora.internal/api',
    EXTERNAL_KNOWLEDGE_API_KEY: 'wk-token',
  });
  assert.equal(config.knowledgeProvider, 'external');
  assert.deepEqual(config.externalKnowledge, {
    baseUrl: 'http://weknora.internal/api',
    apiKey: 'wk-token',
    timeoutMs: 10000,
  });
});

test('external knowledge requires a base url and rejects unknown provider values', () => {
  assert.throws(
    () => readAiProviderConfiguration({ KNOWLEDGE_PROVIDER: 'external' }),
    /EXTERNAL_KNOWLEDGE_BASE_URL/,
  );
  assert.throws(
    () => readAiProviderConfiguration({ KNOWLEDGE_PROVIDER: 'weknora-v2' }),
    /KNOWLEDGE_PROVIDER/,
  );
});
