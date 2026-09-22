import test from 'node:test';
import assert from 'node:assert/strict';

import {
  ruleBasedEvaluate,
  RuleBasedEvaluationReportGenerator,
} from '../src/jobs/rule-evaluation-generator.js';
import type { TranscriptMessage } from '../src/jobs/rule-evaluation-generator.js';

function buildTranscript(pairs: Array<{ learner?: string; assistant?: string }>): TranscriptMessage[] {
  const transcript: TranscriptMessage[] = [];
  for (const pair of pairs) {
    if (pair.learner !== undefined) {
      transcript.push({ role: 'learner', content: pair.learner });
    }
    if (pair.assistant !== undefined) {
      transcript.push({ role: 'assistant', content: pair.assistant });
    }
  }
  return transcript;
}

test('rule-based score is not hardcoded to 100 for a typical transcript', () => {
  const transcript = buildTranscript([
    { learner: '你好，请问有什么可以帮助您的？', assistant: '我想看看有没有合适的护肤品。' },
  ]);

  const report = ruleBasedEvaluate({ transcript, customerMood: 'neutral' });

  assert.notEqual(report.score, 100, 'score should not be hardcoded to 100');
  assert.ok(report.score < 100, 'score for minimal keyword transcript should be below 100');
});

test('five dimensions are present and their average equals the total score', () => {
  const transcript = buildTranscript([
    { learner: '您的需求是什么？我们的这款产品效果很好，推荐给您，要不要购买？' },
    { assistant: '因为价格确实有点高。' },
  ]);

  const report = ruleBasedEvaluate({ transcript, customerMood: 'neutral' });

  const dims = report.dimensionScores;
  const keys: Array<keyof typeof dims> = [
    'needs_discovery',
    'product_presentation',
    'objection_handling',
    'emotion_management',
    'closing_ability',
  ];
  for (const key of keys) {
    assert.ok(typeof dims[key] === 'number', `dimension ${key} should be a number`);
  }

  const sum = dims.needs_discovery
    + dims.product_presentation
    + dims.objection_handling
    + dims.emotion_management
    + dims.closing_ability;
  const expected = Math.round(sum / 5);
  assert.equal(report.score, expected, 'score should equal rounded average of five dimensions');
});

test('keyword hits increase dimension scores', () => {
  const lowTranscript = buildTranscript([
    { learner: '你好' },
  ]);
  const highTranscript = buildTranscript([
    { learner: '需求 需要 想要 关注 在意 预算 肤质 皮肤 问题 困扰' },
  ]);

  const low = ruleBasedEvaluate({ transcript: lowTranscript, customerMood: 'neutral' });
  const high = ruleBasedEvaluate({ transcript: highTranscript, customerMood: 'neutral' });

  assert.ok(
    high.dimensionScores.needs_discovery > low.dimensionScores.needs_discovery,
    'more keyword hits should raise needs_discovery',
  );
  assert.equal(high.dimensionScores.needs_discovery, 100, 'ten keyword hits cap at 100');
});

test('empty transcript yields a guaranteed minimum score per dimension', () => {
  const report = ruleBasedEvaluate({ transcript: [], customerMood: 'neutral' });

  for (const value of Object.values(report.dimensionScores)) {
    assert.ok(value >= 20, `dimension value ${value} should be at least 20`);
  }
  assert.equal(report.messageCount, 0);
  assert.equal(report.totalTurns, 0);
});

test('highlights and improvements are Chinese string arrays', () => {
  const transcript = buildTranscript([
    { learner: '您的需求是什么？这款产品效果不错，推荐给您。' },
    { assistant: '因为我们的成分确实很好，您可以试试看。' },
  ]);

  const report = ruleBasedEvaluate({ transcript, customerMood: 'positive' });

  assert.ok(Array.isArray(report.highlights), 'highlights should be an array');
  assert.ok(Array.isArray(report.improvements), 'improvements should be an array');
  for (const item of report.highlights) {
    assert.equal(typeof item, 'string');
    assert.ok(/[一-龥]/.test(item), `highlight "${item}" should contain Chinese characters`);
  }
  for (const item of report.improvements) {
    assert.equal(typeof item, 'string');
    assert.ok(/[一-龥]/.test(item), `improvement "${item}" should contain Chinese characters`);
  }
});

test('mood=positive sets emotion_management to 85', () => {
  const transcript = buildTranscript([
    { learner: '你好' },
  ]);

  const report = ruleBasedEvaluate({ transcript, customerMood: 'positive' });

  assert.equal(report.dimensionScores.emotion_management, 85);
  assert.ok(report.highlights.includes('客户最终态度积极'));
});

test('each dimension is guaranteed a floor of 20 even with empty transcript and negative mood', () => {
  const report = ruleBasedEvaluate({ transcript: [], customerMood: 'negative' });

  for (const [key, value] of Object.entries(report.dimensionScores)) {
    assert.ok(value >= 20, `dimension ${key} = ${value} should be at least 20`);
  }
  // negative mood → raw 40, still >= 20
  assert.equal(report.dimensionScores.emotion_management, 40);
  // no assistant text → objection not handled → raw 30
  assert.equal(report.dimensionScores.objection_handling, 30);
  // no keyword hits → raw 0, floored to 20
  assert.equal(report.dimensionScores.needs_discovery, 20);
  assert.equal(report.dimensionScores.product_presentation, 20);
  assert.equal(report.dimensionScores.closing_ability, 20);
});

test('RuleBasedEvaluationReportGenerator implements EvaluationReportGenerator interface', async () => {
  const transcript = buildTranscript([
    { learner: '您需要什么产品？推荐这款效果好的。要不要下单？' },
    { assistant: '因为我们的成分确实不错，您可以试试。' },
  ]);

  const generator = new RuleBasedEvaluationReportGenerator();
  const report = await generator.generate({
    messageCount: transcript.length,
    scoringRules: [],
    transcript,
    personaConfig: null,
    customerMood: 'neutral',
  });

  assert.equal(report.schemaVersion, 'evaluation-report/v1');
  assert.equal(report.generatedBy, 'rule-evaluation/v1');
  assert.equal(typeof report.score, 'number');
  assert.ok(report.dimensionScores !== undefined);
});
