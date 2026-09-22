import assert from 'node:assert/strict';
import test from 'node:test';

import { GongzhugouIdentityAdapter } from '../../src/adapters/gongzhugou-identity.adapter.js';

test('verifies a first-party signed mini-program token through the marketplace current-user endpoint', async () => {
  let request: { url: string; init?: RequestInit } | undefined;
  const adapter = new GongzhugouIdentityAdapter(
    '11111111-1111-1111-1111-111111111111',
    1_000,
    async (url, init) => {
      request = { url: String(url), ...(init === undefined ? {} : { init }) };
      return new Response(JSON.stringify({ code: 0, data: { customer_id: 42 } }), { status: 200 });
    },
  );

  const principal = await adapter.verifyAccessToken('marketplace-token', {
    openId: 'wx-open-id',
    deviceId: 'device-id',
  });

  assert.deepEqual(principal, {
    subjectId: '42',
    organizationId: '11111111-1111-1111-1111-111111111111',
    status: 'active',
  });
  assert.match(request?.url ?? '', /^https:\/\/rapi\.gongzhugou\.vip\/v1\/customer\/info\/get\?/);
  assert.match(request?.url ?? '', /(?:\?|&)sign=[A-F0-9]{32}(?:&|$)/);
  assert.equal((request?.init?.headers as Record<string, string>)['x-token'], 'marketplace-token');
  assert.equal((request?.init?.headers as Record<string, string>).device_id, 'device-id');
});

test('rejects a marketplace token that the current-user endpoint marks invalid', async () => {
  const adapter = new GongzhugouIdentityAdapter('11111111-1111-1111-1111-111111111111', 1_000, async () => (
    new Response(JSON.stringify({ code: 1101 }), { status: 200 })
  ));

  await assert.rejects(
    () => adapter.verifyAccessToken('invalid-token', { openId: 'wx-open-id', deviceId: 'device-id' }),
    /invalid/i,
  );
});
