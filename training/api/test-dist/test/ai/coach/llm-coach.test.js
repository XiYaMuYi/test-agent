import assert from 'node:assert/strict';
import test from 'node:test';
import { buildCoachPrompt } from '../../../src/ai/coach/llm-coach.js';
test('coach prompt reviews the learner against the previous customer message without seeing the generated reply', () => {
    const params = {
        userMsg: '我推荐您使用外涂护肤品。',
        aiMsg: 'LATEST_GENERATED_REPLY：我问的是内服调理，不是护肤品。',
        previousCustomerMsg: 'PREVIOUS_CUSTOMER_MESSAGE：我想咨询抗老产品。',
        conversationContext: [
            { role: 'assistant', content: 'PREVIOUS_CUSTOMER_MESSAGE：我想咨询抗老产品。' },
            { role: 'learner', content: '我推荐您使用外涂护肤品。' },
        ],
        turnCount: 1,
        customerMood: 'neutral',
        events: [],
    };
    const prompt = buildCoachPrompt(params);
    assert.match(prompt, /PREVIOUS_CUSTOMER_MESSAGE/);
    assert.match(prompt, /我推荐您使用外涂护肤品/);
    assert.doesNotMatch(prompt, /LATEST_GENERATED_REPLY/);
});
test('coach prompt treats the first wait-learner turn as an opening without inventing a customer message', () => {
    const params = {
        userMsg: '您好，请问您今天想了解哪方面？',
        aiMsg: 'LATEST_GENERATED_REPLY：我想了解内服抗老。',
        previousCustomerMsg: '',
        conversationContext: [
            { role: 'learner', content: '您好，请问您今天想了解哪方面？' },
        ],
        turnCount: 1,
        customerMood: 'neutral',
        events: [],
    };
    const prompt = buildCoachPrompt(params);
    assert.match(prompt, /学员主动开场/);
    assert.doesNotMatch(prompt, /LATEST_GENERATED_REPLY/);
});
