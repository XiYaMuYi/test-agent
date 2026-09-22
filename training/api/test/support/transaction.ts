export interface TransactionClient {
  begin(): Promise<void>;
  commit(): Promise<void>;
  rollback(): Promise<void>;
}

/** Runs work atomically and never masks the original work error with rollback noise. */
export async function runInTransaction<T>(
  client: TransactionClient,
  work: (client: TransactionClient) => Promise<T>,
): Promise<T> {
  await client.begin();
  try {
    const result = await work(client);
    await client.commit();
    return result;
  } catch (error) {
    try {
      await client.rollback();
    } catch {
      // Preserve the error that caused the transaction to fail.
    }
    throw error;
  }
}
