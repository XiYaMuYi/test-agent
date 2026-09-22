import { createRequire } from 'node:module';
/** Real runtime database adapter. SQL policy remains in the worker job processor. */
export function createPostgresEvaluationExecutor(connectionString) {
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
