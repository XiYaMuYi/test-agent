/* eslint-disable no-unused-vars -- TypeScript contract parameters describe a SQL boundary. */

/** The minimal database boundary used by migrations and their local tests. */
export interface SqlQueryResult<Row extends Record<string, unknown> = Record<string, unknown>> {
  readonly rows: readonly Row[];
}

export interface SqlExecutor {
  query<Row extends Record<string, unknown> = Record<string, unknown>>(
    statement: string,
    values?: readonly unknown[],
  ): Promise<SqlQueryResult<Row>>;
}

export interface Migration {
  readonly id: string;
  readonly description: string;
  up(database: SqlExecutor): Promise<void>;
  down(database: SqlExecutor): Promise<void>;
}
