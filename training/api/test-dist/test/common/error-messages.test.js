import assert from 'node:assert/strict';
import test from 'node:test';
import { ERROR_CODES } from '@training/contracts';
import { getUserFacingMessage } from '../../src/common/error-messages.js';
const CHINESE = /[一-鿿]/;
test('every known error code has a non-empty Chinese user-facing message', () => {
    for (const code of ERROR_CODES) {
        const message = getUserFacingMessage(code);
        assert.equal(typeof message, 'string', `${code} must map to a message`);
        assert.ok(message.length > 0, `${code} message must not be empty`);
        assert.ok(CHINESE.test(message), `${code} message must be Chinese, got: ${message}`);
        assert.equal(message.includes(code), false, `${code} must not echo the raw SCREAMING_SNAKE code to the user`);
    }
});
test('persona / model errors map to safe, user-actionable Chinese copy', () => {
    assert.match(getUserFacingMessage('PERSONA_CONFIG_INVALID'), /画像|参数|设置/);
    assert.match(getUserFacingMessage('MODEL_TIMEOUT'), /超时|稍后|网络|重试/);
    assert.match(getUserFacingMessage('MODEL_SCHEMA_INVALID'), /异常|重试|稍后/);
    assert.match(getUserFacingMessage('CONVERSATION_CLOSED'), /结束|已关闭/);
});
test('an unknown code resolves to undefined so the caller keeps its fallback', () => {
    assert.equal(getUserFacingMessage('NOT_A_REAL_CODE'), undefined);
});
