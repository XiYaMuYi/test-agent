import test from 'node:test';
import assert from 'node:assert/strict';
import {
  CONTRACT_SCHEMA_IDS,
  ContractSchemaNotFoundError,
  loadVersionedJsonSchema,
} from '../dist/index.js';

test('loads the registered v1 agent request JSON Schema fixture', () => {
  const schema = loadVersionedJsonSchema('v1', 'agent-request');

  assert.equal(schema.version, 'v1');
  assert.equal(schema.id, CONTRACT_SCHEMA_IDS.agentRequest);
  assert.equal(schema.schema.type, 'object');
  assert.deepEqual(schema.schema.required, ['sessionId', 'prompt']);
});

test('rejects an unregistered schema fixture instead of returning a generic schema', () => {
  assert.throws(
    () => loadVersionedJsonSchema('v1', 'unknown-fixture'),
    ContractSchemaNotFoundError,
  );
});

test('rejects a schema version that has not been registered', () => {
  assert.throws(
    () => loadVersionedJsonSchema('v999', 'agent-request'),
    ContractSchemaNotFoundError,
  );
});
