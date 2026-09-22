import test from 'node:test';
import assert from 'node:assert/strict';
import { buildTranscriptFromMessages, } from '../src/jobs/transcript-loader.js';
function row(sequence, content, responseHash = null) {
    return { sequence, content, responseHash };
}
function responseHash(payload) {
    return JSON.stringify(payload);
}
test('buildTranscriptFromMessages returns empty transcript and neutral mood for no rows', () => {
    const result = buildTranscriptFromMessages([]);
    assert.deepEqual(result.transcript, []);
    assert.equal(result.customerMood, 'neutral');
});
test('buildTranscriptFromMessages emits learner entries even without a response_hash', () => {
    const result = buildTranscriptFromMessages([
        row(1, '你好'),
        row(2, '请问有什么可以帮助您？'),
    ]);
    assert.equal(result.transcript.length, 2);
    assert.deepEqual(result.transcript[0], { role: 'learner', content: '你好' });
    assert.deepEqual(result.transcript[1], { role: 'learner', content: '请问有什么可以帮助您？' });
    assert.equal(result.customerMood, 'neutral');
});
test('buildTranscriptFromMessages interleaves assistant reply from response_hash.suggestion.replyText', () => {
    const result = buildTranscriptFromMessages([
        row(1, '你好，我想看看护肤品', responseHash({
            conversationId: 'c1',
            suggestion: { schemaVersion: 'agent-output/v1', replyText: '好的，请问您有什么肤质需求？' },
            customerMood: 'neutral',
        })),
    ]);
    assert.equal(result.transcript.length, 2);
    assert.deepEqual(result.transcript[0], { role: 'learner', content: '你好，我想看看护肤品' });
    assert.deepEqual(result.transcript[1], {
        role: 'assistant',
        content: '好的，请问您有什么肤质需求？',
    });
});
test('buildTranscriptFromMessages picks the last customerMood seen across turns', () => {
    const result = buildTranscriptFromMessages([
        row(1, '你好', responseHash({ suggestion: { replyText: '你好' }, customerMood: 'neutral' })),
        row(2, '你们的东西太贵了', responseHash({ suggestion: { replyText: '抱歉' }, customerMood: 'negative' })),
        row(3, '好吧，我再看看', responseHash({ suggestion: { replyText: '好的' }, customerMood: 'positive' })),
    ]);
    assert.equal(result.customerMood, 'positive');
});
test('buildTranscriptFromMessages defaults customerMood to neutral when no turn recorded one', () => {
    const result = buildTranscriptFromMessages([
        row(1, '你好', responseHash({ suggestion: { replyText: '您好' } })),
        row(2, '再见'),
    ]);
    assert.equal(result.customerMood, 'neutral');
});
test('buildTranscriptFromMessages tolerates malformed response_hash without throwing', () => {
    const result = buildTranscriptFromMessages([
        row(1, '你好', 'not-json'),
        row(2, '继续', responseHash({ suggestion: { replyText: '好的' }, customerMood: 'positive' })),
    ]);
    // Malformed row produces only the learner entry, no assistant; second row is fine.
    assert.equal(result.transcript.length, 3);
    assert.equal(result.transcript[0].role, 'learner');
    assert.equal(result.transcript[1].role, 'learner');
    assert.equal(result.transcript[2].role, 'assistant');
    assert.equal(result.customerMood, 'positive');
});
test('buildTranscriptFromMessages ignores empty replyText (no assistant entry emitted)', () => {
    const result = buildTranscriptFromMessages([
        row(1, '你好', responseHash({ suggestion: { replyText: '' } })),
        row(2, '还在吗', responseHash({ suggestion: { replyText: '在的' } })),
    ]);
    // First row: learner only (empty replyText suppressed); second row: learner + assistant.
    assert.equal(result.transcript.length, 3);
    assert.equal(result.transcript[0].role, 'learner');
    assert.equal(result.transcript[1].role, 'learner');
    assert.equal(result.transcript[2].role, 'assistant');
    assert.equal(result.transcript[2].content, '在的');
});
