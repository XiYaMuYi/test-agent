import assert from 'node:assert/strict';
import test from 'node:test';
import { createPostgresExecutor, MigrationRunner, schemaMigrationsBaseline, } from '../../src/database/migrations/index.js';
import { createPostgresTestSupport } from '../support/postgres.js';
test('applies and rolls back the baseline against an isolated Testcontainers PostgreSQL', { timeout: 120_000 }, async () => {
    const postgres = await createPostgresTestSupport().start();
    const client = createPostgresExecutor(postgres.connectionUri);
    try {
        const runner = new MigrationRunner(client, [schemaMigrationsBaseline]);
        assert.deepEqual(await runner.applyAll(), ['0001_schema_migrations']);
        const applied = await client.query('SELECT id FROM schema_migrations ORDER BY id');
        assert.deepEqual(applied.rows, [{ id: '0001_schema_migrations' }]);
        assert.equal(await runner.rollbackLast(), '0001_schema_migrations');
        const ledger = await client.query("SELECT to_regclass('public.schema_migrations') AS table_name");
        assert.equal(ledger.rows[0]?.table_name, null);
    }
    finally {
        try {
            await client.close();
        }
        finally {
            await postgres.stop();
        }
    }
});
