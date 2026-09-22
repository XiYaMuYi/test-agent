const BASELINE_MIGRATION_ID = '0001_schema_migrations';
/** Executes ordered, append-only PostgreSQL migrations with a reversible local baseline. */
export class MigrationRunner {
    migrationsById;
    database;
    migrations;
    constructor(database, migrations) {
        this.database = database;
        this.migrations = migrations;
        const ids = migrations.map((migration) => migration.id);
        if (new Set(ids).size !== ids.length) {
            throw new Error('Migration ids must be unique.');
        }
        this.migrationsById = new Map(migrations.map((migration) => [migration.id, migration]));
    }
    async applyAll() {
        const applied = await this.getAppliedMigrationIds();
        const executed = [];
        for (const migration of this.migrations) {
            if (applied.has(migration.id)) {
                continue;
            }
            await this.inTransaction(async () => {
                await migration.up(this.database);
                await this.database.query('INSERT INTO schema_migrations (id) VALUES ($1)', [migration.id]);
            });
            executed.push(migration.id);
        }
        return executed;
    }
    async rollbackLast() {
        if (!(await this.hasMigrationLedger())) {
            return undefined;
        }
        const result = await this.database.query('SELECT id FROM schema_migrations ORDER BY applied_at DESC, id DESC LIMIT 1');
        const id = result.rows[0]?.id;
        if (id === undefined) {
            return undefined;
        }
        const migration = this.migrationsById.get(id);
        if (migration === undefined) {
            throw new Error(`Cannot roll back unknown migration: ${id}`);
        }
        await this.inTransaction(async () => {
            // The baseline owns the table that records it, so remove its record
            // before dropping that table. Later migrations use the normal ordering.
            if (migration.id === BASELINE_MIGRATION_ID) {
                await this.database.query('DELETE FROM schema_migrations WHERE id = $1', [migration.id]);
                await migration.down(this.database);
                return;
            }
            await migration.down(this.database);
            await this.database.query('DELETE FROM schema_migrations WHERE id = $1', [migration.id]);
        });
        return migration.id;
    }
    async getAppliedMigrationIds() {
        if (!(await this.hasMigrationLedger())) {
            return new Set();
        }
        const result = await this.database.query('SELECT id FROM schema_migrations');
        return new Set(result.rows.map((row) => row.id));
    }
    async hasMigrationLedger() {
        const result = await this.database.query("SELECT to_regclass('public.schema_migrations') AS table_name");
        return result.rows[0]?.table_name !== null && result.rows[0]?.table_name !== undefined;
    }
    async inTransaction(operation) {
        await this.database.query('BEGIN');
        try {
            await operation();
            await this.database.query('COMMIT');
        }
        catch (error) {
            await this.database.query('ROLLBACK');
            throw error;
        }
    }
}
