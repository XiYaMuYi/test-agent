import { createRuntimeWorkerModule } from './worker.module.js';
/**
 * A deliberately small bootstrap boundary.  Runtime scheduling and database
 * wiring are added only after the outbox migration exists (B-06).
 */
export async function bootstrapWorker(connectionString = process.env.DATABASE_URL) {
    if (connectionString === undefined || connectionString.length === 0) {
        throw new Error('DATABASE_URL is required to start the evaluation worker');
    }
    return createRuntimeWorkerModule(connectionString);
}
export const workerSkeleton = {
    application: 'worker',
    runtime: 'node',
    stage: 'bootstrap',
};
