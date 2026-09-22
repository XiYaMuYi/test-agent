import assert from 'node:assert/strict';
import test from 'node:test';
import { detectEvents } from '../../../src/ai/coach/event-detector.js';
// ── 五类事件各一例 ──────────────────────────────────────────────
test('need_revealed：检测用户需求暴露', () => {
    const events = detectEvents('我想买一款面霜', '');
    assert.equal(events.length, 1);
    assert.equal(events[0].type, 'need_revealed');
    assert.equal(events[0].detail, '我想');
    assert.equal(events[0].quality, 70);
});
test('objection_raised：检测客户异议', () => {
    const events = detectEvents('', '但是太贵了');
    assert.equal(events.length, 1);
    assert.equal(events[0].type, 'objection_raised');
    assert.equal(events[0].detail, '但是');
    assert.equal(events[0].quality, undefined);
});
test('trust_built：检测信任建立', () => {
    const events = detectEvents('', '你说得对，很专业');
    assert.equal(events.length, 1);
    assert.equal(events[0].type, 'trust_built');
    assert.equal(events[0].detail, '你说得对');
    assert.equal(events[0].quality, 85);
});
test('closing_signal：检测成交信号', () => {
    const events = detectEvents('多少钱？我要下单', '');
    assert.equal(events.length, 1);
    assert.equal(events[0].type, 'closing_signal');
    assert.equal(events[0].detail, '多少钱');
    assert.equal(events[0].quality, 90);
});
test('professional_question：检测专业问题', () => {
    const events = detectEvents('这个成分是什么', '');
    assert.equal(events.length, 1);
    assert.equal(events[0].type, 'professional_question');
    assert.equal(events[0].detail, '成分');
    assert.equal(events[0].quality, undefined);
});
// ── 无事件返回空数组 ──────────────────────────────────────────────
test('无事件：双方消息均无关键词时返回空数组', () => {
    const events = detectEvents('今天天气不错', '是的呢');
    assert.equal(events.length, 0);
    assert.deepEqual(events, []);
});
test('无事件：空字符串返回空数组', () => {
    const events = detectEvents('', '');
    assert.deepEqual(events, []);
});
// ── 每类只返回第一个命中 ──────────────────────────────────────────
test('每类只返回第一个命中的关键词', () => {
    // userMsg 同时包含 need_revealed 的多个关键词：'我想'、'我需要'、'我的问题是'
    // 应该只返回第一个命中的 '我想'
    const events = detectEvents('我想我需要，我的问题是', '');
    const needEvents = events.filter((e) => e.type === 'need_revealed');
    assert.equal(needEvents.length, 1);
    assert.equal(needEvents[0].detail, '我想');
    // aiMsg 同时包含 objection_raised 的多个关键词：'但是'、'不过'、'太贵'
    // 应该只返回第一个命中的 '但是'
    const events2 = detectEvents('', '但是不过太贵');
    const objEvents = events2.filter((e) => e.type === 'objection_raised');
    assert.equal(objEvents.length, 1);
    assert.equal(objEvents[0].detail, '但是');
});
// ── 多事件同时触发 ──────────────────────────────────────────────
test('多事件同时触发：userMsg 和 aiMsg 各含不同事件', () => {
    const events = detectEvents('我想买面霜', '你说得对');
    assert.equal(events.length, 2);
    const types = events.map((e) => e.type);
    assert.ok(types.includes('need_revealed'));
    assert.ok(types.includes('trust_built'));
});
