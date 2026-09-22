import { createRequire } from 'node:module';

import type { EvaluationSqlExecutorPort, TransactionalEvaluationExecutorPort } from '@training/contracts';

interface PgClientLike {
  query<Row extends Record<string, unknown> = Record<string, unknown>>(
    statement: string,
    values?: readonly unknown[],
  ): Promise<{ readonly rows: readonly Row[] }>;
  release(): void;
}

interface PgPoolLike extends EvaluationSqlExecutorPort {
  connect(): Promise<PgClientLike>;
  end(): Promise<void>;
}

interface PgModuleLike {
  readonly Pool: new (options: { readonly connectionString: string }) => PgPoolLike;
}

export interface ManagedEvaluationExecutor extends TransactionalEvaluationExecutorPort {
  close(): Promise<void>;
}

/** Real runtime database adapter. SQL policy remains in the worker job processor. */
export function createPostgresEvaluationExecutor(connectionString: string): ManagedEvaluationExecutor {
  const require = createRequire(import.meta.url);
  const { Pool } = require('pg') as PgModuleLike;
  const pool = new Pool({ connectionString });
  return {
    query: (statement, values) => pool.query(statement, values),
    async transaction<T>(work: (executor: EvaluationSqlExecutorPort) => Promise<T>): Promise<T> {
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        const result = await work(client);
        await client.query('COMMIT');
        return result;
      } catch (error) {
        await client.query('ROLLBACK');
        throw error;
      } finally {
        client.release();
      }
    },
    close: () => pool.end(),
  };
}
