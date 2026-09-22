import process from 'node:process';
import { readDatabaseConfiguration } from './database.module.js';
import { createPostgresExecutor, MigrationRunner, registeredMigrations } from './migrations/index.js';
async function main() {
    const configuration = readDatabaseConfiguration();
    const database = createPostgresExecutor(configuration.connectionString);
    try {
        const runner = new MigrationRunner(database, registeredMigrations);
        if (process.argv.includes('--down')) {
            const rolledBack = await runner.rollbackLast();
            process.stdout.write(`Rolled back migration: ${rolledBack ?? 'none'}\n`);
            return;
        }
        const applied = await runner.applyAll();
        process.stdout.write(`Applied migrations: ${applied.join(', ') || 'none'}\n`);
    }
    finally {
        await database.close();
    }
}
void main().catch((error) => {
    const message = error instanceof Error ? error.stack ?? error.message : String(error);
    process.stderr.write(`${message}\n`);
    process.exitCode = 1;
});
