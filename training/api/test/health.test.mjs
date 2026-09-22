import assert from 'node:assert/strict';
import test from 'node:test';

import { healthResponse } from '../dist/health.js';

test('health response identifies the API as ready for local development', () => {
  assert.deepEqual(healthResponse(), { status: 'ok', service: 'api' });
});
