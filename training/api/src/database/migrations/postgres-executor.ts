/* eslint-disable no-unused-vars -- Constructor argument exists only in the dynamic pg module shape. */

import { createRequire } from 'node:module';

import type { SqlExecutor } from './migration.types.js';
import type { EvaluationSqlExecutorPort, TransactionalEvaluationExecutorPort } from '@training/contracts';

interface PgPoolLike {
  query: SqlExecutor['query'];
  connect(): Promise<PgClientLike>;
  end(): Promise<void>;
}

interface PgClientLike {
  query: SqlExecutor['query'];
  release(): void;
}

interface PgModuleLike {
  readonly Pool: new (...args: readonly [{ readonly connectionString: string }]) => PgPoolLike;
}

export interface ManagedSqlExecutor extends SqlExecutor, TransactionalEvaluationExecutorPort {
  close(): Promise<void>;
}

/**
 * Real PostgreSQL executor used by `pnpm --filter @training/api migrate:up`.
 * The dynamic load keeps pure migration tests independent of a live database.
 */
export function createPostgresExecutor(connectionString: string): ManagedSqlExecutor {
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
