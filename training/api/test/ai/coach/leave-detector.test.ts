import assert from 'node:assert/strict';
import test from 'node:test';

import { checkCustomerLeave } from '../../../src/ai/coach/leave-detector.js';

// ── strong 命中 ──────────────────────────────────────────────

test('strong 命中：再见', () => {
  const result = checkCustomerLeave('好的，再见');
  assert.equal(result.leaving, true);
  assert.equal(result.strength, 'strong');
  assert.equal(result.keyword, '再见');
  assert.ok(result.reason?.includes('再见'));
});

test('strong 命中：拜拜', () => {
  const result = checkCustomerLeave('拜拜，不送了');
  assert.equal(result.leaving, true);
  assert.equal(result.strength, 'strong');
  assert.equal(result.keyword, '拜拜');
});

test('strong 命中：不买了', () => {
  const result = checkCustomerLeave('太贵了，不买了');
  assert.equal(result.leaving, true);
  assert.equal(result.strength, 'strong');
  assert.equal(result.keyword, '不买了');
});

test('strong 命中：走了', () => {
  const result = checkCustomerLeave('我走了');
  assert.equal(result.leaving, true);
  assert.equal(result.strength, 'strong');
  assert.equal(result.keyword, '走了');
});

test('strong 命中：再也不来', () => {
  const result = checkCustomerLeave('我再也不来了');
  assert.equal(result.leaving, true);
  assert.equal(result.strength, 'strong');
  assert.equal(result.keyword, '再也不来');
});

test('strong 命中：拉黑', () => {
  const result = checkCustomerLeave('我要拉黑你');
  assert.equal(result.leaving, true);
  assert.equal(result.strength, 'strong');
  assert.equal(result.keyword, '拉黑');
});

test('strong 命中：投诉你', () => {
  const result = checkCustomerLeave('我要投诉你');
  assert.equal(result.leaving, true);
  assert.equal(result.strength, 'strong');
  assert.equal(result.keyword, '投诉你');
});

test('strong 命中：去别家', () => {
  const result = checkCustomerLeave('我去别家看看');
  assert.equal(result.leaving, true);
  assert.equal(result.strength, 'strong');
  assert.equal(result.keyword, '去别家');
});

test('strong 命中：不跟你说了', () => {
  const result = checkCustomerLeave('好了，不跟你说了');
  assert.equal(result.leaving, true);
  assert.equal(result.strength, 'strong');
  assert.equal(result.keyword, '不跟你说了');
});

// ── mild 命中 ──────────────────────────────────────────────

test('mild 命中：我去看看别的', () => {
  const result = checkCustomerLeave('我去看看别的吧');
  assert.equal(result.leaving, true);
  assert.equal(result.strength, 'mild');
  assert.equal(result.keyword, '我去看看别的');
  assert.ok(result.reason?.includes('我去看看别的'));
});

test('mild 命中：我去别处', () => {
  const result = checkCustomerLeave('我去别处转转');
  assert.equal(result.leaving, true);
  assert.equal(result.strength, 'mild');
  assert.equal(result.keyword, '我去别处');
});

test('mild 命中：我先走了（被 strong 先行匹配）', () => {
  // "我先走了" 包含 "走了"（strong），会被先行匹配为 strong
  const result = checkCustomerLeave('我先走了');
  assert.equal(result.leaving, true);
  assert.equal(result.strength, 'strong');
  assert.equal(result.keyword, '走了');
});

test('mild 命中：不考虑了', () => {
  const result = checkCustomerLeave('不考虑了，谢谢');
  assert.equal(result.leaving, true);
  assert.equal(result.strength, 'mild');
  assert.equal(result.keyword, '不考虑了');
});

test('mild 命中：不需要了', () => {
  const result = checkCustomerLeave('不需要了');
  assert.equal(result.leaving, true);
  assert.equal(result.strength, 'mild');
  assert.equal(result.keyword, '不需要了');
});

test('mild 命中：没兴趣了', () => {
  const result = checkCustomerLeave('没兴趣了');
  assert.equal(result.leaving, true);
  assert.equal(result.strength, 'mild');
  assert.equal(result.keyword, '没兴趣了');
});

// ── 未命中 ──────────────────────────────────────────────────

test('未命中：普通对话', () => {
  const result = checkCustomerLeave('今天天气真好');
  assert.equal(result.leaving, false);
  assert.equal(result.strength, undefined);
  assert.equal(result.keyword, undefined);
  assert.equal(result.reason, undefined);
});

test('未命中：空字符串', () => {
  const result = checkCustomerLeave('');
  assert.equal(result.leaving, false);
});

test('未命中：购物相关但无离开意图', () => {
  const result = checkCustomerLeave('这个多少钱');
  assert.equal(result.leaving, false);
});

// ── reason 包含关键词 ──────────────────────────────────────

test('reason 包含命中的关键词', () => {
  const keywords = ['再见', '拜拜', '不买了', '走了', '算了', '再也不来', '拉黑', '投诉你', '去别家', '不跟你说了'];
  for (const kw of keywords) {
    const result = checkCustomerLeave(kw);
    assert.equal(result.leaving, true, `关键词 "${kw}" 应命中`);
    assert.ok(result.reason?.includes(kw), `reason 应包含关键词 "${kw}"，实际为 "${result.reason}"`);
  }
});

// ── strong 优先于 mild ──────────────────────────────────────

test('strong 优先于 mild：文本同时包含两者时返回 strong', () => {
  // "我先走了"(mild) 和 "再见"(strong) 同时存在
  const result = checkCustomerLeave('我先走了，再见');
  assert.equal(result.leaving, true);
  assert.equal(result.strength, 'strong');
});
