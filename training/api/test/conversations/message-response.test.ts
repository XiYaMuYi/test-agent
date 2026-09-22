import assert from 'node:assert/strict';
import test from 'node:test';

import { toClientMessageResponse } from '../../src/conversations/conversation.service.js';
import type { MessageResponse } from '../../src/conversations/conversation.service.js';

function baseResponse(overrides: Partial<MessageResponse> = {}): MessageResponse {
  return {
    conversationId: 'c-1',
    status: 'active',
    version: 2,
    messageId: 'm-1',
    sequence: 1,
    content: '我想了解一下这款产品',
    customerMood: 'neutral',
    ...overrides,
  };
}

test('client response omits the internal moodValue but keeps user-visible fields', () => {
  const persisted = baseResponse({
    moodValue: 12,
    coachFeedback: { rating: 60, feedback: '不错', improvements: ['多问需求'] },
  });

  const client = toClientMessageResponse(persisted);

  assert.equal('moodValue' in client, false, 'moodValue must never be sent to the client');
  assert.equal(client.customerMood, 'neutral');
  assert.deepEqual(client.coachFeedback, { rating: 60, feedback: '不错', improvements: ['多问需求'] });
  assert.equal(client.content, '我想了解一下这款产品');
});

test('stripping does not mutate the persisted object (response_hash keeps moodValue)', () => {
  const persisted = baseResponse({ moodValue: -5 });
  toClientMessageResponse(persisted);
  assert.equal(persisted.moodValue, -5, 'the source/persisted object must keep moodValue');
});

test('a response without moodValue passes through unchanged shape', () => {
  const response = baseResponse();
  const client = toClientMessageResponse(response);
  assert.equal('moodValue' in client, false);
  assert.equal(client.messageId, 'm-1');
});
