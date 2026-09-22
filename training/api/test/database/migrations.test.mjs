import assert from 'node:assert/strict';
import test from 'node:test';

import {
  MigrationRunner,
  schemaMigrationsBaseline,
} from '../../dist/database/migrations/index.js';

class RecordingPostgres {
  statements = [];
  migrationIds = [];
  hasLedger = false;

  async query(statement, values = []) {
    this.statements.push({ statement: statement.replace(/\s+/g, ' ').trim(), values: [...values] });

    if (statement.includes('to_regclass')) {
      return { rows: [{ table_name: this.hasLedger ? 'schema_migrations' : null }] };
    }
    if (statement.includes('CREATE TABLE IF NOT EXISTS schema_migrations')) {
      this.hasLedger = true;
      return { rows: [] };
    }
    if (statement.includes('SELECT id FROM schema_migrations')) {
      return { rows: this.migrationIds.map((id) => ({ id })) };
    }
    if (statement.includes('INSERT INTO schema_migrations')) {
      this.migrationIds.push(values[0]);
      return { rows: [] };
    }
    if (statement.includes('SELECT id FROM schema_migrations ORDER BY')) {
      return { rows: this.migrationIds.length === 0 ? [] : [{ id: this.migrationIds.at(-1) }] };
    }
    if (statement.includes('DELETE FROM schema_migrations')) {
      this.migrationIds = this.migrationIds.filter((id) => id !== values[0]);
      return { rows: [] };
    }
    if (statement.includes('DROP TABLE IF EXISTS schema_migrations')) {
      this.hasLedger = false;
      return { rows: [] };
    }
    return { rows: [] };
  }
}

test('applies the schema_migrations baseline to an empty PostgreSQL database', async () => {
  const database = new RecordingPostgres();
  const runner = new MigrationRunner(database, [schemaMigrationsBaseline]);

  await runner.applyAll();

  assert.equal(database.hasLedger, true);
  assert.deepEqual(database.migrationIds, ['0001_schema_migrations']);
  assert.match(
    database.statements.find(({ statement }) => statement.startsWith('CREATE TABLE'))?.statement ?? '',
    /^CREATE TABLE IF NOT EXISTS schema_migrations/i,
  );
});

test('rolls back the schema_migrations baseline without leaving the tracking table', async () => {
  const database = new RecordingPostgres();
  const runner = new MigrationRunner(database, [schemaMigrationsBaseline]);

  await runner.applyAll();
  await runner.rollbackLast();

  assert.equal(database.hasLedger, false);
  assert.deepEqual(database.migrationIds, []);
});
