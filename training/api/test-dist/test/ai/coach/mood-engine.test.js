import assert from 'node:assert/strict';
import test from 'node:test';
import { analyzeMoodQuick } from '../../../src/ai/coach/mood-engine.js';
// ── positive ──────────────────────────────────────────────
test('positive strong 命中：多个 strong 累加', () => {
    const result = analyzeMoodQuick('太好了，就这个了！');
    // 太好了(+15) + 就这个了(+15) = 30
    assert.equal(result.moodDelta, 30);
    assert.ok(result.matched.includes('太好了'));
    assert.ok(result.matched.includes('就这个了'));
    assert.equal(result.confidence, 'high');
});
test('positive mild 命中：多个 mild 累加到 high', () => {
    const result = analyzeMoodQuick('还不错，可以了解一下');
    // 不错(+5) + 可以(+5) + 了解一下(+5) = 15
    assert.equal(result.moodDelta, 15);
    assert.ok(result.matched.includes('不错'));
    assert.ok(result.matched.includes('可以'));
    assert.ok(result.matched.includes('了解一下'));
    assert.equal(result.confidence, 'high');
});
test('positive single mild → moodDelta=5, confidence=low', () => {
    const result = analyzeMoodQuick('还行吧');
    assert.equal(result.moodDelta, 5);
    assert.ok(result.matched.includes('还行'));
    assert.equal(result.confidence, 'low');
});
// ── negative ──────────────────────────────────────────────
test('negative strong 命中：多个 strong 累加', () => {
    const result = analyzeMoodQuick('太贵了，不要了');
    // 太贵了(-15) + 不要了(-15) = -30
    assert.equal(result.moodDelta, -30);
    assert.ok(result.matched.includes('太贵了'));
    assert.ok(result.matched.includes('不要了'));
    assert.equal(result.confidence, 'high');
});
test('negative mild 命中：多个 mild 累加到 high', () => {
    const result = analyzeMoodQuick('有点贵，再想想');
    // 有点贵(-5) + 再想想(-5) = -10
    assert.equal(result.moodDelta, -10);
    assert.ok(result.matched.includes('有点贵'));
    assert.ok(result.matched.includes('再想想'));
    assert.equal(result.confidence, 'high');
});
test('negative single mild → moodDelta=-5, confidence=low', () => {
    const result = analyzeMoodQuick('考虑考虑');
    assert.equal(result.moodDelta, -5);
    assert.ok(result.matched.includes('考虑考虑'));
    assert.equal(result.confidence, 'low');
});
// ── angry ─────────────────────────────────────────────────
test('angry strong 命中：多个 strong 累加', () => {
    const result = analyzeMoodQuick('什么态度！我要投诉！骗人！');
    // 什么态度(-25) + 投诉(-25) + 骗人(-25) = -75
    assert.equal(result.moodDelta, -75);
    assert.ok(result.matched.includes('什么态度'));
    assert.ok(result.matched.includes('投诉'));
    assert.ok(result.matched.includes('骗人'));
    assert.equal(result.confidence, 'high');
});
test('angry strong 单个 → moodDelta=-35（子串重叠累加）, confidence=high', () => {
    // '太失望了' 同时匹配 angry strong '太失望了'(-25) 和 angry mild '失望'(-10)
    // 子串匹配会命中两个关键词，与 Python 原版行为一致
    const result = analyzeMoodQuick('太失望了');
    assert.equal(result.moodDelta, -35);
    assert.ok(result.matched.includes('太失望了'));
    assert.ok(result.matched.includes('失望'));
    assert.equal(result.confidence, 'high');
});
test('angry mild 单个 → moodDelta=-10, confidence=high', () => {
    // angry mild delta 为 -10，绝对值刚好达到 10，所以 confidence=high
    const result = analyzeMoodQuick('有点失望');
    assert.equal(result.moodDelta, -10);
    assert.ok(result.matched.includes('失望'));
    assert.equal(result.confidence, 'high');
});
test('angry mild 命中 → matched 包含关键词', () => {
    const result = analyzeMoodQuick('不太舒服');
    assert.equal(result.moodDelta, -10);
    assert.ok(result.matched.includes('不太舒服'));
    assert.equal(result.confidence, 'high');
});
// ── 无命中 / 空字符串 ────────────────────────────────────
test('无命中返回 0, matched 为空, confidence=low', () => {
    const result = analyzeMoodQuick('今天天气真好');
    assert.equal(result.moodDelta, 0);
    assert.deepEqual(result.matched, []);
    assert.equal(result.confidence, 'low');
});
test('空字符串返回 0', () => {
    const result = analyzeMoodQuick('');
    assert.equal(result.moodDelta, 0);
    assert.deepEqual(result.matched, []);
    assert.equal(result.confidence, 'low');
});
// ── 多关键词累加（混合类别） ──────────────────────────────
test('positive + negative 混合：互相抵消', () => {
    const result = analyzeMoodQuick('不错，但是有点贵');
    // 不错(+5) + 有点贵(-5) = 0
    assert.equal(result.moodDelta, 0);
    assert.ok(result.matched.includes('不错'));
    assert.ok(result.matched.includes('有点贵'));
    assert.equal(result.confidence, 'low');
});
test('positive + negative 混合：strong 互相抵消', () => {
    const result = analyzeMoodQuick('太棒了，但是不要了');
    // 太棒了(+15) + 不要了(-15) = 0
    assert.equal(result.moodDelta, 0);
    assert.ok(result.matched.includes('太棒了'));
    assert.ok(result.matched.includes('不要了'));
    assert.equal(result.confidence, 'low');
});
test('两个 positive strong 累加', () => {
    const result = analyzeMoodQuick('完美！太棒了！');
    // 完美(+15) + 太棒了(+15) = 30
    assert.equal(result.moodDelta, 30);
    assert.ok(result.matched.includes('完美'));
    assert.ok(result.matched.includes('太棒了'));
    assert.equal(result.confidence, 'high');
});
// ── confidence 边界 ───────────────────────────────────────
test('confidence 边界：abs(moodDelta) >= 10 → high', () => {
    const result = analyzeMoodQuick('不错，可以，还行');
    // 3 * 5 = 15
    assert.equal(result.moodDelta, 15);
    assert.equal(result.confidence, 'high');
});
test('confidence 边界：abs(moodDelta) < 10 → low', () => {
    const result = analyzeMoodQuick('不错');
    // 单个 mild = 5, abs(5) < 10
    assert.equal(result.moodDelta, 5);
    assert.equal(result.confidence, 'low');
});
