import assert from 'node:assert/strict';
import test from 'node:test';

import { FakeIdentityAdapter, FakeIdentityError } from '../../dist/adapters/fake-identity.adapter.js';
import {
  crossOrganizationIdentityTokenFixture,
  disabledIdentityTokenFixture,
  expiredIdentityTokenFixture,
  validIdentityTokenFixture,
} from '@training/test-fixtures';

test('returns an active principal for the valid offline token', async () => {
  const adapter = new FakeIdentityAdapter();

  const principal = await adapter.verifyAccessToken(validIdentityTokenFixture());

  assert.deepEqual(principal, {
    subjectId: 'streamer-001',
    organizationId: '11111111-1111-1111-1111-111111111111',
    status: 'active',
  });
});

test('rejects the expired offline token with an explicit expired identity error', async () => {
  const adapter = new FakeIdentityAdapter();

  await assert.rejects(
    () => adapter.verifyAccessToken(expiredIdentityTokenFixture()),
    (error) => error instanceof FakeIdentityError && error.code === 'IDENTITY_TOKEN_EXPIRED',
  );
});

test('rejects the disabled offline token with an explicit disabled identity error', async () => {
  const adapter = new FakeIdentityAdapter();

  await assert.rejects(
    () => adapter.verifyAccessToken(disabledIdentityTokenFixture()),
    (error) => error instanceof FakeIdentityError && error.code === 'IDENTITY_SUBJECT_DISABLED',
  );
});

test('returns a distinct cross-organization principal without treating it as the active organization', async () => {
  const adapter = new FakeIdentityAdapter();

  const principal = await adapter.verifyAccessToken(crossOrganizationIdentityTokenFixture());

  assert.deepEqual(principal, {
    subjectId: 'admin-002',
    organizationId: '22222222-2222-2222-2222-222222222222',
    status: 'active',
  });
  assert.notEqual(principal.organizationId, '11111111-1111-1111-1111-111111111111');
});
