import type { Migration, SqlExecutor } from './migration.types.js';

const BASELINE_MIGRATION_ID = '0001_schema_migrations';

interface AppliedMigrationRow extends Record<string, unknown> {
  readonly id: string;
}

interface RelationRow extends Record<string, unknown> {
  readonly table_name: string | null;
}

/** Executes ordered, append-only PostgreSQL migrations with a reversible local baseline. */
export class MigrationRunner {
  private readonly migrationsById: ReadonlyMap<string, Migration>;
  private readonly database: SqlExecutor;
  private readonly migrations: readonly Migration[];

  constructor(database: SqlExecutor, migrations: readonly Migration[]) {
    this.database = database;
    this.migrations = migrations;
    const ids = migrations.map((migration) => migration.id);
    if (new Set(ids).size !== ids.length) {
      throw new Error('Migration ids must be unique.');
    }
    this.migrationsById = new Map(migrations.map((migration) => [migration.id, migration]));
  }

  async applyAll(): Promise<readonly string[]> {
    const applied = await this.getAppliedMigrationIds();
    const executed: string[] = [];

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

  async rollbackLast(): Promise<string | undefined> {
    if (!(await this.hasMigrationLedger())) {
      return undefined;
    }

    const result = await this.database.query<AppliedMigrationRow>(
      'SELECT id FROM schema_migrations ORDER BY applied_at DESC, id DESC LIMIT 1',
    );
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

  private async getAppliedMigrationIds(): Promise<ReadonlySet<string>> {
    if (!(await this.hasMigrationLedger())) {
      return new Set();
    }

    const result = await this.database.query<AppliedMigrationRow>('SELECT id FROM schema_migrations');
    return new Set(result.rows.map((row) => row.id));
  }

  private async hasMigrationLedger(): Promise<boolean> {
    const result = await this.database.query<RelationRow>(
      "SELECT to_regclass('public.schema_migrations') AS table_name",
    );
    return result.rows[0]?.table_name !== null && result.rows[0]?.table_name !== undefined;
  }

  private async inTransaction(operation: () => Promise<void>): Promise<void> {
    await this.database.query('BEGIN');
    try {
      await operation();
      await this.database.query('COMMIT');
    } catch (error) {
      await this.database.query('ROLLBACK');
      throw error;
    }
  }
}
