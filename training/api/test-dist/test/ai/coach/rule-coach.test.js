import assert from 'node:assert/strict';
import test from 'node:test';
import { ruleBasedCoachFeedback } from '../../../src/ai/coach/rule-coach.js';
// ── 辅助函数 ──────────────────────────────────────────────
function defaultParams(overrides = {}) {
    return {
        userMsg: '您好，我想了解一下你们的产品',
        aiMsg: '好的，您想看看哪方面的产品呢？',
        turnCount: 1,
        customerMood: 'neutral',
        events: [],
        ...overrides,
    };
}
// ── 侮辱性语言直接 0 分 ────────────────────────────────────
test('侮辱性语言 → rating=0，直接返回', () => {
    const result = ruleBasedCoachFeedback(defaultParams({ userMsg: '你滚吧，傻逼' }));
    assert.equal(result.rating, 0);
    assert.ok(result.feedback.includes('侮辱性语言'));
    assert.equal(result.moodDelta, -50);
    assert.ok(result.improvements.length >= 3);
});
test('侮辱性语言：智障 → rating=0', () => {
    const result = ruleBasedCoachFeedback(defaultParams({ userMsg: '你智障吗' }));
    assert.equal(result.rating, 0);
});
test('侮辱性语言：闭嘴 → rating=0', () => {
    const result = ruleBasedCoachFeedback(defaultParams({ userMsg: '闭嘴吧你' }));
    assert.equal(result.rating, 0);
});
// ── 占位符扣分 ────────────────────────────────────────────
test('占位符 *** → rating 扣 20', () => {
    const result = ruleBasedCoachFeedback(defaultParams({ userMsg: '我们的***很好', turnCount: 2 }));
    // 基础50 - 20(占位符) - 10(无产品词 turnCount>=2) + 3(有礼貌词:无) → 50-20-10-3=17
    assert.ok(result.rating <= 30);
    assert.ok(result.feedback.includes('占位符'));
});
test('占位符 ... → rating 扣 20', () => {
    const result = ruleBasedCoachFeedback(defaultParams({ userMsg: '嗯...', turnCount: 1 }));
    // 基础50 - 20(占位符) - 15(<10字) - 3(无礼貌) = 12
    assert.ok(result.rating <= 30);
});
test('占位符 ？？？ → rating 扣 20', () => {
    const result = ruleBasedCoachFeedback(defaultParams({ userMsg: '？？？', turnCount: 1 }));
    assert.ok(result.rating <= 30);
});
// ── 回复过短扣分 ──────────────────────────────────────────
test('回复<10字 → 扣 15', () => {
    const result = ruleBasedCoachFeedback(defaultParams({ userMsg: '嗯', turnCount: 1 }));
    // 基础50 - 15(<10字) - 3(无礼貌) = 32
    assert.ok(result.feedback.includes('过于简短'));
    assert.ok(result.rating < 50);
});
test('回复<20字（≥10字）→ 扣 5', () => {
    // "我想看看你们的产品怎么样呢" = 13 chars, ≥10 and <20
    const result = ruleBasedCoachFeedback(defaultParams({ userMsg: '我想看看你们的产品怎么样呢', turnCount: 1 }));
    assert.ok(result.feedback.includes('较短'));
});
test('回复>100字 → 加 5', () => {
    const longMsg = '您好，我对你们的维生素C片非常感兴趣，听说效果很好，我想了解一下具体的成分和功效，适合什么肤质呢？'.repeat(3);
    const result = ruleBasedCoachFeedback(defaultParams({ userMsg: longMsg, turnCount: 1 }));
    assert.ok(result.feedback.includes('详细'));
    assert.ok(result.rating >= 50);
});
// ── 礼貌用语加分 ──────────────────────────────────────────
test('有礼貌用语 → 加 3', () => {
    // 24 chars: >20 so no length penalty, +3 for polite, rating=53
    const result = ruleBasedCoachFeedback(defaultParams({ userMsg: '您好，请帮我推荐一下你们的产品吧，我对这个很感兴趣', turnCount: 1 }));
    assert.ok(result.feedback.includes('礼貌用语使用得当'));
    assert.ok(result.rating >= 50);
});
test('无礼貌用语 → 扣 3', () => {
    const result = ruleBasedCoachFeedback(defaultParams({ userMsg: '给我看看那个东西', turnCount: 1 }));
    assert.ok(result.feedback.includes('缺少礼貌用语'));
});
// ── 事件加减分 ────────────────────────────────────────────
test('need_revealed 事件 → 加 8', () => {
    const events = [{ type: 'need_revealed', detail: '我想', quality: 70 }];
    const result = ruleBasedCoachFeedback(defaultParams({ events }));
    assert.ok(result.feedback.includes('透露需求'));
    assert.ok(result.rating >= 50);
});
test('objection_raised 事件 → 扣 5', () => {
    const events = [{ type: 'objection_raised', detail: '太贵' }];
    const result = ruleBasedCoachFeedback(defaultParams({ events }));
    assert.ok(result.feedback.includes('异议'));
});
test('trust_built 事件 → 加 10', () => {
    const events = [{ type: 'trust_built', detail: '专业', quality: 85 }];
    const result = ruleBasedCoachFeedback(defaultParams({ events }));
    assert.ok(result.feedback.includes('信任'));
    assert.ok(result.rating >= 50);
});
test('closing_signal 事件 → 加 15', () => {
    const events = [{ type: 'closing_signal', detail: '下单', quality: 90 }];
    const result = ruleBasedCoachFeedback(defaultParams({ events }));
    assert.ok(result.feedback.includes('成交信号'));
    assert.ok(result.rating >= 50);
});
// ── 客户离开扣 30 分 ──────────────────────────────────────
test('客户离开（strong）→ 扣 30', () => {
    const result = ruleBasedCoachFeedback(defaultParams({ aiMsg: '再见，我不买了' }));
    assert.ok(result.feedback.includes('离开'));
    // 基础50 + 5(>100字? no) + 3(礼貌:无->-3) - 30(离开)
    // aiMsg has "再见" and "不买了" -> leave detected
    assert.ok(result.rating <= 30);
});
test('客户离开（mild）→ 扣 30', () => {
    const result = ruleBasedCoachFeedback(defaultParams({ aiMsg: '我去看看别的' }));
    assert.ok(result.feedback.includes('离开'));
});
// ── 情绪影响评分 ──────────────────────────────────────────
test('客户情绪积极（delta>10）→ 加 3', () => {
    const result = ruleBasedCoachFeedback(defaultParams({ aiMsg: '太好了，非常满意' }));
    assert.ok(result.feedback.includes('情绪积极'));
    assert.ok(result.moodDelta > 10);
});
test('客户情绪变差（delta<-10）→ 扣 15', () => {
    const result = ruleBasedCoachFeedback(defaultParams({ aiMsg: '太贵了，不要了，浪费时间' }));
    assert.ok(result.feedback.includes('情绪变差'));
    assert.ok(result.moodDelta < -10);
});
// ── 分数 clamp 0-100 ─────────────────────────────────────
test('分数 clamp 下限 0', () => {
    // 多个扣分项叠加，确保 rating 不会低于 0
    const result = ruleBasedCoachFeedback(defaultParams({
        userMsg: '嗯',
        aiMsg: '再见，不买了',
        turnCount: 3,
        events: [{ type: 'objection_raised', detail: '太贵' }],
    }));
    assert.ok(result.rating >= 0);
    assert.ok(result.rating <= 100);
});
test('分数 clamp 上限 100', () => {
    // 多个加分项叠加，确保 rating 不会超过 100
    const longMsg = '您好，我对你们的维生素C片非常感兴趣，听说效果很好，我想了解一下具体的成分和功效，适合什么肤质呢？'.repeat(2);
    const result = ruleBasedCoachFeedback(defaultParams({
        userMsg: longMsg,
        aiMsg: '太好了，非常满意，就这个了',
        turnCount: 1,
        events: [
            { type: 'need_revealed', detail: '我想', quality: 70 },
            { type: 'trust_built', detail: '专业', quality: 85 },
            { type: 'closing_signal', detail: '下单', quality: 90 },
        ],
    }));
    assert.ok(result.rating >= 0);
    assert.ok(result.rating <= 100);
});
// ── improvements 包含正确示范 ─────────────────────────────
test('improvements 包含占位符示范', () => {
    const result = ruleBasedCoachFeedback(defaultParams({ userMsg: '我们的***很好', turnCount: 2 }));
    const hasDemo = result.improvements.some((i) => i.includes('✅ 正确示范'));
    assert.ok(hasDemo, 'improvements 应包含正确示范');
});
test('improvements 包含缺产品信息示范', () => {
    const result = ruleBasedCoachFeedback(defaultParams({ userMsg: '这个挺好的你觉得呢', turnCount: 3 }));
    const hasDemo = result.improvements.some((i) => i.includes('✅ 正确示范'));
    assert.ok(hasDemo, 'improvements 应包含正确示范');
});
test('improvements 包含开场阶段示范', () => {
    const result = ruleBasedCoachFeedback(defaultParams({ turnCount: 1 }));
    const hasDemo = result.improvements.some((i) => i.includes('✅ 正确示范'));
    assert.ok(hasDemo, 'improvements 应包含正确示范');
});
test('improvements 包含异议处理示范', () => {
    const events = [{ type: 'objection_raised', detail: '太贵' }];
    const result = ruleBasedCoachFeedback(defaultParams({ events }));
    const hasDemo = result.improvements.some((i) => i.includes('先认同再解释'));
    assert.ok(hasDemo, 'improvements 应包含异议处理示范');
});
test('improvements 包含成交推进示范', () => {
    const events = [{ type: 'closing_signal', detail: '下单', quality: 90 }];
    const result = ruleBasedCoachFeedback(defaultParams({ events }));
    const hasDemo = result.improvements.some((i) => i.includes('推进成交'));
    assert.ok(hasDemo, 'improvements 应包含成交推进示范');
});
test('improvements 包含情绪安抚示范', () => {
    const result = ruleBasedCoachFeedback(defaultParams({ aiMsg: '太贵了，不要了' }));
    const hasDemo = result.improvements.some((i) => i.includes('安抚情绪'));
    assert.ok(hasDemo, 'improvements 应包含情绪安抚示范');
});
test('improvements 包含离开挽回示范', () => {
    const result = ruleBasedCoachFeedback(defaultParams({ aiMsg: '再见，不跟你说了' }));
    const hasDemo = result.improvements.some((i) => i.includes('道歉并挽回'));
    assert.ok(hasDemo, 'improvements 应包含离开挽回示范');
});
test('improvements 包含过短+无礼貌示范', () => {
    const result = ruleBasedCoachFeedback(defaultParams({ userMsg: '嗯', turnCount: 3 }));
    const hasDemo = result.improvements.some((i) => i.includes('更热情一些'));
    assert.ok(hasDemo, 'improvements 应包含过短+无礼貌示范');
});
// ── 无事件时通用建议 ──────────────────────────────────────
test('无具体问题时给通用建议', () => {
    const result = ruleBasedCoachFeedback(defaultParams({
        userMsg: '您好，我想了解一下你们的维生素C片，听说效果不错',
        aiMsg: '不错，可以了解一下',
        turnCount: 1,
    }));
    // 有礼貌词、有产品词、长度>20、turnCount<=2 → 有开场建议
    // 但情绪 mild positive (5) 不触发 < 0
    assert.ok(result.improvements.length > 0);
});
// ── events 透传 ───────────────────────────────────────────
test('events 原样透传到结果中', () => {
    const events = [
        { type: 'need_revealed', detail: '我想', quality: 70 },
        { type: 'closing_signal', detail: '下单', quality: 90 },
    ];
    const result = ruleBasedCoachFeedback(defaultParams({ events }));
    assert.deepEqual(result.events, events);
});
