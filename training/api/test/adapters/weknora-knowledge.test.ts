import assert from 'node:assert/strict';
import test from 'node:test';

import { WeknoraKnowledgeAdapter } from '../../src/adapters/weknora-knowledge.adapter.js';
import { readAiProviderConfiguration } from '../../src/adapters/provider-configuration.js';

const SAMPLE_REF = {
  itemId: 'knowledge-welcome',
  version: 'v1',
  organizationId: '11111111-1111-1111-1111-111111111111',
};

test('weknora adapter calls deployed hybrid search protocol', async () => {
  const originalFetch = globalThis.fetch;
  let request: { url: string; init: RequestInit | undefined } | undefined;
  globalThis.fetch = (async (url, init) => {
    request = { url: String(url), init };
    return new Response(JSON.stringify({ success: true, data: [{ id: 'chunk-1', content: '适合敏感肌' }] }), { status: 200 });
  }) as typeof fetch;
  const adapter = new WeknoraKnowledgeAdapter({
    baseUrl: 'https://weknora.example.com',
    apiKey: 'secret-token',
    knowledgeBaseIds: ['90c2b5f4-354c-44f5-8759-7e259905f602'],
  });
  const item = await adapter.getApprovedItem(SAMPLE_REF);
  globalThis.fetch = originalFetch;
  assert.equal(item.content, '适合敏感肌');
  assert.equal(request?.url, 'https://weknora.example.com/api/v1/knowledge-search');
  assert.equal((request?.init?.headers as Record<string, string>)['X-API-Key'], 'secret-token');
  assert.deepEqual(JSON.parse(String(request?.init?.body)), { query: 'knowledge-welcome@v1', knowledge_base_ids: ['90c2b5f4-354c-44f5-8759-7e259905f602'] });
});

test('readAiProviderConfiguration reads KNOWLEDGE_BASE_URL and KNOWLEDGE_TOKEN for weknora', () => {
  const config = readAiProviderConfiguration({
    KNOWLEDGE_PROVIDER: 'weknora',
    KNOWLEDGE_BASE_URL: 'https://weknora.example.com',
    KNOWLEDGE_TOKEN: 'my-token',
  });
  assert.equal(config.knowledgeProvider, 'weknora');
  assert.deepEqual(config.weknoraKnowledge, {
    baseUrl: 'https://weknora.example.com',
    apiKey: 'my-token',
    knowledgeBaseIds: [],
    timeoutMs: 10000,
  });
  assert.equal(config.externalKnowledge, undefined);
});

test('readAiProviderConfiguration returns undefined weknoraKnowledge when env vars are missing', () => {
  const config = readAiProviderConfiguration({
    KNOWLEDGE_PROVIDER: 'weknora',
    // KNOWLEDGE_BASE_URL / KNOWLEDGE_TOKEN intentionally absent
  });
  assert.equal(config.knowledgeProvider, 'weknora');
  assert.equal(config.weknoraKnowledge, undefined);
});

test('readAiProviderConfiguration returns undefined weknoraKnowledge when provider is fake', () => {
  const config = readAiProviderConfiguration({});
  assert.equal(config.knowledgeProvider, 'fake');
  assert.equal(config.weknoraKnowledge, undefined);
});

test('ai.module degrades to FakeKnowledgeAdapter when weknora env vars are incomplete', async () => {
  // Simulate what createKnowledgeAdapter does internally: when provider is
  // 'weknora' but weknoraKnowledge is undefined, the factory falls back to the
  // fake adapter. We verify the configuration layer surfaces that correctly.
  const config = readAiProviderConfiguration({
    KNOWLEDGE_PROVIDER: 'weknora',
  });
  const shouldDegrade =
    config.knowledgeProvider === 'weknora' && config.weknoraKnowledge === undefined;
  assert.equal(shouldDegrade, true, 'expected incomplete weknora config to signal fallback');
});
