/**
 * Persistence port used by asynchronous evaluation consumers.  It describes
 * only transaction capability; SQL and business implementation stay in the
 * owning application layer.
 */
export interface EvaluationSqlExecutorPort {
  query<Row extends Record<string, unknown> = Record<string, unknown>>(
    statement: string,
    values?: readonly unknown[],
  ): Promise<{ readonly rows: readonly Row[] }>;
}

export interface TransactionalEvaluationExecutorPort extends EvaluationSqlExecutorPort {
  transaction<T>(work: (executor: EvaluationSqlExecutorPort) => Promise<T>): Promise<T>;
}
