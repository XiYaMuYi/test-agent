import { createRuntimeWorkerModule, type WorkerModule } from './worker.module.js';
import { fileURLToPath } from 'node:url';

/**
 * A deliberately small bootstrap boundary.  Runtime scheduling and database
 * wiring are added only after the outbox migration exists (B-06).
 */
export async function bootstrapWorker(connectionString = process.env.DATABASE_URL): Promise<WorkerModule> {
  if (connectionString === undefined || connectionString.length === 0) {
    throw new Error('DATABASE_URL is required to start the evaluation worker');
  }
  return createRuntimeWorkerModule(connectionString);
}

export const workerSkeleton = {
  application: 'worker',
  runtime: 'node',
  stage: 'bootstrap',
} as const;

/**
 * Keep consuming queued evaluation jobs when this file is launched by the
 * package `start` script.  Previously the executable only exported
 * `bootstrapWorker`, so `pnpm --filter @training/worker start` exited without
 * processing the queue and the mini-program could only see a permanent 404.
 */
async function runWorker(): Promise<void> {
  const worker = await bootstrapWorker();
  let stopping = false;
  const stop = async (): Promise<void> => {
    if (stopping) return;
    stopping = true;
    await worker.close?.();
    process.exit(0);
  };
  process.once('SIGINT', () => void stop());
  process.once('SIGTERM', () => void stop());

  while (!stopping) {
    const result = await worker.pollOnce();
    await new Promise((resolve) => setTimeout(resolve, result.scanned > 0 ? 50 : 500));
  }
}

if (process.argv[1] !== undefined && fileURLToPath(import.meta.url) === process.argv[1]) {
  void runWorker().catch((error: unknown) => {
    console.error('Evaluation worker failed to start', error);
    process.exit(1);
  });
}
