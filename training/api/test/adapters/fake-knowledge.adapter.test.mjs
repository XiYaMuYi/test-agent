import assert from 'node:assert/strict';
import test from 'node:test';

import { FakeKnowledgeAdapter } from '../../dist/adapters/fake-knowledge.adapter.js';
import {
  unapprovedKnowledgeRecordsFixture,
  versionedKnowledgeRecordsFixture,
} from '@training/test-fixtures';

test('FakeKnowledgeAdapter returns only an approved item matching the requested version', async () => {
  const adapter = new FakeKnowledgeAdapter(versionedKnowledgeRecordsFixture());

  const item = await adapter.getApprovedItem({ itemId: 'welcome', version: 'v2', organizationId: '11111111-1111-1111-1111-111111111111' });

  assert.deepEqual(item, {
    id: 'welcome',
    version: 'v2',
    status: 'approved',
    content: 'approved v2',
  });
});

test('FakeKnowledgeAdapter rejects non-approved and missing versioned entries', async () => {
  const adapter = new FakeKnowledgeAdapter(unapprovedKnowledgeRecordsFixture());

  await assert.rejects(
    () => adapter.getApprovedItem({ itemId: 'draft', version: 'v1', organizationId: '11111111-1111-1111-1111-111111111111' }),
    { code: 'FAKE_KNOWLEDGE_NOT_FOUND' },
  );
  await assert.rejects(
    () => adapter.getApprovedItem({ itemId: 'draft', version: 'v2', organizationId: '11111111-1111-1111-1111-111111111111' }),
    { code: 'FAKE_KNOWLEDGE_NOT_FOUND' },
  );
});
