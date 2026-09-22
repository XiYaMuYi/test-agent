import assert from 'node:assert/strict';
import test from 'node:test';

import {
  ruleBasedCoachFeedback,
  analyzeMoodQuick,
  detectEvents,
} from '../../src/ai/coach/index.js';
import type { CoachFeedbackData, CustomerMood } from '@training/contracts';

/**
 * T28.2: Coach feedback integration tests.
 *
 * These tests verify the pure-function layer that the conversation service
 * composes: ruleBasedCoachFeedback, analyzeMoodQuick, detectEvents, plus the
 * mood-accumulation derivation that sendMessage uses to compute customerMood.
 */

/** Mirror the derivation in conversation.service.ts sendMessage. */
function deriveCustomerMood(moodValue: number): CustomerMood {
  return moodValue > 10 ? 'positive' : moodValue < -10 ? 'negative' : 'neutral';
}

test('coach feedback: response has rating/feedback/improvements', () => {
  const result = ruleBasedCoachFeedback({
    userMsg: '您好，我来帮您分析一下这个产品的成分和效果',
    aiMsg: '听起来不错，我想了解一下',
    turnCount: 2,
    customerMood: 'neutral',
    events: [],
  });

  assert.equal(typeof result.rating, 'number');
  assert.ok(result.rating >= 0 && result.rating <= 100, 'rating must be in 0-100');
  assert.equal(typeof result.feedback, 'string');
  assert.ok(result.feedback.length > 0, 'feedback must be non-empty');
  assert.ok(Array.isArray(result.improvements));
  assert.ok(result.improvements.length > 0, 'improvements must have entries');
  for (const item of result.improvements) {
    assert.equal(typeof item, 'string');
  }
  assert.equal(typeof result.moodDelta, 'number');
});

test('coach feedback: rude language yields rating=0', () => {
  const result = ruleBasedCoachFeedback({
    userMsg: '你傻吗，滚蛋吧',
    aiMsg: '什么态度，我要投诉',
    turnCount: 3,
    customerMood: 'negative',
    events: [],
  });

  assert.equal(result.rating, 0);
  assert.equal(result.moodDelta, -50);
});

test('coach feedback: polite product-aware turn scores well', () => {
  const result = ruleBasedCoachFeedback({
    userMsg:
      '您好！我推荐您试试我们的维生素C产品，含有天然针叶樱桃提取物，效果非常好，很多客户反馈满意。',
    aiMsg: '太好了，我非常满意，就这个了！',
    turnCount: 4,
    customerMood: 'neutral',
    events: [
      { type: 'need_revealed', detail: '我想' },
      { type: 'closing_signal', detail: '就这个' },
    ],
  });

  assert.ok(result.rating >= 60, `expected good rating, got ${result.rating}`);
});

test('coach feedback result can be narrowed to CoachFeedbackData', () => {
  const result = ruleBasedCoachFeedback({
    userMsg: '我想了解一下你们的产品',
    aiMsg: '不错，可以看看',
    turnCount: 1,
    customerMood: 'neutral',
    events: [],
  });

  const coachFeedback: CoachFeedbackData = {
    rating: result.rating,
    feedback: result.feedback,
    improvements: result.improvements,
  };
  assert.equal(typeof coachFeedback.rating, 'number');
  assert.equal(typeof coachFeedback.feedback, 'string');
  assert.ok(Array.isArray(coachFeedback.improvements));
});

test('analyzeMoodQuick: positive text yields positive delta', () => {
  const result = analyzeMoodQuick('太好了，我非常满意，就这个了！');
  assert.ok(result.moodDelta > 0, `expected positive delta, got ${result.moodDelta}`);
  assert.ok(result.matched.length > 0);
});

test('analyzeMoodQuick: negative text yields negative delta', () => {
  const result = analyzeMoodQuick('太贵了，不要了，算了');
  assert.ok(result.moodDelta < 0, `expected negative delta, got ${result.moodDelta}`);
});

test('analyzeMoodQuick: neutral text yields zero or low delta', () => {
  const result = analyzeMoodQuick('今天天气不错');
  assert.ok(Math.abs(result.moodDelta) <= 10, `expected low delta, got ${result.moodDelta}`);
});

test('detectEvents: picks up need_revealed and closing_signal', () => {
  const events = detectEvents(
    '我想买一款适合敏感肌的产品，多少钱？',
    '你说得对，这个确实不错',
  );
  const types = events.map((e) => e.type);
  assert.ok(types.includes('need_revealed'), `expected need_revealed, got ${types.join(',')}`);
  assert.ok(types.includes('closing_signal'), `expected closing_signal, got ${types.join(',')}`);
  assert.ok(types.includes('trust_built'), `expected trust_built, got ${types.join(',')}`);
});

test('mood accumulation: moodValue → customerMood label', () => {
  assert.equal(deriveCustomerMood(0), 'neutral');
  assert.equal(deriveCustomerMood(10), 'neutral');
  assert.equal(deriveCustomerMood(11), 'positive');
  assert.equal(deriveCustomerMood(100), 'positive');
  assert.equal(deriveCustomerMood(-10), 'neutral');
  assert.equal(deriveCustomerMood(-11), 'negative');
  assert.equal(deriveCustomerMood(-100), 'negative');
});

test('mood accumulation: multi-turn scenario stays consistent', () => {
  // Turn 1: positive customer reply
  let moodValue = 0;
  const events1 = detectEvents(
    '您好，我想看看护肤品',
    '太好了，我非常满意',
  );
  const coach1 = ruleBasedCoachFeedback({
    userMsg: '您好，我想看看护肤品',
    aiMsg: '太好了，我非常满意',
    turnCount: 1,
    customerMood: deriveCustomerMood(moodValue),
    events: events1,
  });
  moodValue += coach1.moodDelta;
  const mood1 = deriveCustomerMood(moodValue);
  assert.equal(['positive', 'neutral', 'negative'].includes(mood1), true);

  // Turn 2: negative customer reply
  const events2 = detectEvents(
    '这个产品太贵了，算了',
    '太贵了，不要了',
  );
  const coach2 = ruleBasedCoachFeedback({
    userMsg: '这个产品太贵了，算了',
    aiMsg: '太贵了，不要了',
    turnCount: 2,
    customerMood: deriveCustomerMood(moodValue),
    events: events2,
  });
  moodValue += coach2.moodDelta;
  const mood2 = deriveCustomerMood(moodValue);
  assert.equal(['positive', 'neutral', 'negative'].includes(mood2), true);

  // Verify mood label matches the numeric thresholds.
  if (moodValue > 10) assert.equal(mood2, 'positive');
  else if (moodValue < -10) assert.equal(mood2, 'negative');
  else assert.equal(mood2, 'neutral');
});

test('end-to-end enrichment shape matches MessageResponse contract', () => {
  // Simulate what conversation.service.ts sendMessage does after orchestrator returns.
  const suggestion = {
    schemaVersion: 'agent-output/v1' as const,
    replyText: '太好了，我非常满意，就这个了！',
    suggestedAction: 'advance' as const,
    knowledgeReferences: [] as string[],
    confidence: 0.9,
  };

  const userMsg = '您好，我想买一款产品，多少钱？';
  const aiMsg = suggestion.replyText;
  const turnCount = 3;
  const previousMoodValue = 5;

  const events = detectEvents(userMsg, aiMsg);
  const coachResult = ruleBasedCoachFeedback({
    userMsg,
    aiMsg,
    turnCount,
    customerMood: deriveCustomerMood(previousMoodValue),
    events,
  });

  const newMoodValue = previousMoodValue + coachResult.moodDelta;
  const customerMood: CustomerMood = deriveCustomerMood(newMoodValue);
  const coachFeedback: CoachFeedbackData = {
    rating: coachResult.rating,
    feedback: coachResult.feedback,
    improvements: coachResult.improvements,
  };

  const enrichedSuggestion = {
    ...suggestion,
    customerMood,
    coachFeedback,
  };

  // The enriched suggestion is still a valid AgentOutputV1 (required fields intact).
  assert.equal(enrichedSuggestion.schemaVersion, 'agent-output/v1');
  assert.equal(typeof enrichedSuggestion.replyText, 'string');
  assert.ok(['ask_follow_up', 'advance', 'end'].includes(enrichedSuggestion.suggestedAction));
  assert.ok(Array.isArray(enrichedSuggestion.knowledgeReferences));
  assert.equal(typeof enrichedSuggestion.confidence, 'number');

  // Coach fields present.
  assert.equal(['positive', 'neutral', 'negative'].includes(enrichedSuggestion.customerMood!), true);
  assert.equal(typeof enrichedSuggestion.coachFeedback!.rating, 'number');
  assert.equal(typeof enrichedSuggestion.coachFeedback!.feedback, 'string');
  assert.ok(Array.isArray(enrichedSuggestion.coachFeedback!.improvements));

  // Top-level MessageResponse shape.
  const messageResponse = {
    conversationId: 'conv-1',
    status: 'active' as const,
    version: 2,
    messageId: 'msg-1',
    sequence: turnCount,
    content: userMsg,
    suggestion: enrichedSuggestion,
    customerMood,
    coachFeedback,
    moodValue: newMoodValue,
  };

  assert.equal(['positive', 'neutral', 'negative'].includes(messageResponse.customerMood!), true);
  assert.equal(typeof messageResponse.coachFeedback!.rating, 'number');
  assert.equal(typeof messageResponse.coachFeedback!.feedback, 'string');
  assert.ok(Array.isArray(messageResponse.coachFeedback!.improvements));
  assert.equal(typeof messageResponse.moodValue, 'number');
});
