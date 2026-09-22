import test from 'node:test';
import assert from 'node:assert/strict';
import { CONTRACT_VERSION, isKnownErrorCode } from '../dist/index.js';

test('exports the initial contract version and recognises registered error codes', () => {
  assert.equal(CONTRACT_VERSION, 'v1');
  assert.equal(isKnownErrorCode('INVALID_TOKEN'), true);
  assert.equal(isKnownErrorCode('UNREGISTERED_ERROR'), false);
});
