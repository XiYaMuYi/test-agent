/* eslint-disable no-unused-vars -- Constructor argument exists only in the dynamic pg module shape. */
import { createRequire } from 'node:module';
/**
 * Real PostgreSQL executor used by `pnpm --filter @training/api migrate:up`.
 * The dynamic load keeps pure migration tests independent of a live database.
 */
export function createPostgresExecutor(connectionString) {
    const require = createRequire(import.meta.url);
    const { Pool } = require('pg');
    const pool = new Pool({ connectionString });
    return {
        query: (statement, values) => pool.query(statement, values),
        async transaction(work) {
            const client = await pool.connect();
            try {
                await client.query('BEGIN');
                const result = await work(client);
                await client.query('COMMIT');
                return result;
            }
            catch (error) {
                await client.query('ROLLBACK');
                throw error;
            }
            finally {
                client.release();
            }
        },
        close: () => pool.end(),
    };
}
