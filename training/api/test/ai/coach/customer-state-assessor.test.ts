import assert from 'node:assert/strict';
import test from 'node:test';

import { createInitialCustomerState } from '@training/contracts';
import {
  assessCustomerState,
  buildCustomerStatePrompt,
  moodLabelOf,
  parseCustomerStateAssessment,
} from '../../../src/ai/coach/customer-state-assessor.js';

function previous() {
  return createInitialCustomerState(null);
}

function fullStateJson(overrides: Record<string, number> = {}): string {
  const base: Record<string, number> = {
    emotion: 62, trust: 58, patience: 55, consultationIntent: 60,
    purchaseIntent: 57, decisionReadiness: 52, priceAcceptance: 50,
    needClarity: 55, productFitBelief: 53, informationConfidence: 54,
    riskConcern: 40, objectionLevel: 35,
  };
  return JSON.stringify({ ...base, ...overrides });
}

test('合法全维输出被正确解析为 12 维状态', () => {
  const next = parseCustomerStateAssessment(fullStateJson(), previous());
  assert.ok(next);
  assert.equal(next!.emotion, 62);
  assert.equal(next!.objectionLevel, 35);
  assert.equal(next!.schemaVersion, 'customer-state/v1');
  // 列表字段沿用上一轮。
  assert.deepEqual(next!.unresolvedQuestions, previous().unresolvedQuestions);
});

test('单轮变化被限制在 ±25 内（防抖，不允许一帧打满）', () => {
  // 上一轮 emotion=50，模型直接给 999 → 最多 +25 → 75。
  const next = parseCustomerStateAssessment(fullStateJson({ emotion: 999 }), previous());
  assert.ok(next);
  assert.equal(next!.emotion, 75);
  // 模型给 1（-49）→ 最多 -25 → 25。
  const down = parseCustomerStateAssessment(fullStateJson({ emotion: 1 }), previous());
  assert.equal(down!.emotion, 25);
});

test('缺失维度沿用上一轮值，不丢维度', () => {
  const prev = previous();
  const partial = JSON.stringify({ emotion: 70, trust: 60 });
  const next = parseCustomerStateAssessment(partial, prev);
  assert.ok(next);
  assert.equal(next!.emotion, 70);
  // 未给出的维度保持上一轮。
  assert.equal(next!.patience, prev.patience);
  assert.equal(next!.purchaseIntent, prev.purchaseIntent);
});

test('完全无法解析 / 没有任何合法维度 → null', () => {
  assert.equal(parseCustomerStateAssessment('not json at all', previous()), null);
  assert.equal(parseCustomerStateAssessment(JSON.stringify({ foo: 1, bar: 2 }), previous()), null);
});

test('容忍 Markdown 代码围栏与前后缀文字', () => {
  const raw = '好的，研判如下：\n```json\n' + fullStateJson({ emotion: 66 }) + '\n```';
  const next = parseCustomerStateAssessment(raw, previous());
  assert.ok(next);
  assert.equal(next!.emotion, 66);
});

test('assessCustomerState：模型成功时返回状态，模型抛错时返回 null（不抛出）', async () => {
  const ok = await assessCustomerState(async () => fullStateJson({ emotion: 70 }), {
    persona: null, previous: previous(), recentMessages: [{ role: 'learner', content: '你好' }], turnCount: 1,
  });
  assert.ok(ok);
  assert.equal(ok!.emotion, 70);

  const failed = await assessCustomerState(async () => {
    throw new Error('model timeout');
  }, { persona: null, previous: previous(), recentMessages: [], turnCount: 1 });
  assert.equal(failed, null);
});

test('moodLabelOf 按状态 emotion 派生情绪档位', () => {
  const positive = parseCustomerStateAssessment(fullStateJson({ emotion: 80 }), previous())!;
  const negative = parseCustomerStateAssessment(fullStateJson({ emotion: 10 }), previous())!;
  const neutral = parseCustomerStateAssessment(fullStateJson({ emotion: 50 }), previous())!;
  assert.equal(moodLabelOf(positive), 'positive');
  assert.equal(moodLabelOf(negative), 'negative');
  assert.equal(moodLabelOf(neutral), 'neutral');
});

test('buildCustomerStatePrompt 包含人设、对话与上一轮数值', () => {
  const prompt = buildCustomerStatePrompt({
    persona: null,
    previous: previous(),
    recentMessages: [
      { role: 'learner', content: '我想了解美白' },
      { role: 'assistant', content: '好的，您是什么肤质呢' },
    ],
    turnCount: 2,
  });
  assert.ok(prompt.includes('我想了解美白'));
  assert.ok(prompt.includes('emotion'));
  assert.ok(prompt.includes('objectionLevel'));
});
