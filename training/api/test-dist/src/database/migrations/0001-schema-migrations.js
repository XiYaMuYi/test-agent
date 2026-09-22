/**
 * The only B-06 migration. Business tables intentionally start in the next
 * phase, after the Phase 0 contracts have been implemented as real features.
 */
export const schemaMigrationsBaseline = {
    id: '0001_schema_migrations',
    description: 'Create the migration ledger for future application migrations.',
    async up(database) {
        await database.query(`
      CREATE TABLE IF NOT EXISTS schema_migrations (
        id TEXT PRIMARY KEY,
        applied_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
      )
    `);
    },
    async down(database) {
        await database.query('DROP TABLE IF EXISTS schema_migrations');
    },
};
