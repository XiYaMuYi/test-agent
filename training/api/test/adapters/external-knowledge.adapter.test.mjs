import assert from 'node:assert/strict';
import test from 'node:test';

import { ExternalHttpKnowledgeAdapter } from '../../dist/adapters/external-knowledge.adapter.js';

const REF = { itemId: 'knowledge-welcome', version: 'v1', organizationId: 'org-a' };

function config(overrides = {}) {
  return { baseUrl: 'http://weknora.internal/api/', timeoutMs: 5000, ...overrides };
}

test('requests an approved item by id/version with organization scoping and bearer token', async () => {
  const seen = [];
  const fetcher = async (url, init) => {
    seen.push({ url, init });
    return { ok: true, status: 200, json: async () => ({ id: 'knowledge-welcome', version: 'v1', status: 'approved', content: '你好' }) };
  };
  const adapter = new ExternalHttpKnowledgeAdapter(fetcher, config({ apiKey: 'wk-token' }));

  const item = await adapter.getApprovedItem(REF);

  assert.equal(seen[0].url, 'http://weknora.internal/api/items/knowledge-welcome/versions/v1?organizationId=org-a');
  assert.equal(seen[0].init.method, 'GET');
  assert.equal(seen[0].init.headers.authorization, 'Bearer wk-token');
  assert.deepEqual(item, { id: 'knowledge-welcome', version: 'v1', status: 'approved', content: '你好' });
});

test('encodes reference components and omits authorization when no key is configured', async () => {
  const seen = [];
  const fetcher = async (url, init) => {
    seen.push({ url, init });
    return { ok: true, status: 200, json: async () => ({ id: 'a b', version: 'v1', status: 'approved', content: 'c' }) };
  };
  const adapter = new ExternalHttpKnowledgeAdapter(fetcher, config());
  await adapter.getApprovedItem({ itemId: 'a b', version: 'v 1', organizationId: 'org/x' });
  assert.equal(seen[0].url, 'http://weknora.internal/api/items/a%20b/versions/v%201?organizationId=org%2Fx');
  assert.equal(seen[0].init.headers.authorization, undefined);
});

test('rejects a non-approved item even when the call succeeds', async () => {
  const fetcher = async () => ({ ok: true, status: 200, json: async () => ({ id: 'x', version: 'v1', status: 'draft', content: 'not approved' }) });
  const adapter = new ExternalHttpKnowledgeAdapter(fetcher, config());
  await assert.rejects(() => adapter.getApprovedItem(REF), /approved/i);
});

test('rejects non-2xx responses and malformed bodies', async () => {
  const errorStatus = new ExternalHttpKnowledgeAdapter(
    async () => ({ ok: false, status: 503, json: async () => ({}) }),
    config(),
  );
  await assert.rejects(() => errorStatus.getApprovedItem(REF), /503/);

  const malformed = new ExternalHttpKnowledgeAdapter(
    async () => ({ ok: true, status: 200, json: async () => ({ status: 'approved' }) }),
    config(),
  );
  await assert.rejects(() => malformed.getApprovedItem(REF));
});
