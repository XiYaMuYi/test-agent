import test from 'node:test';
import assert from 'node:assert/strict';

test('a worker module performs one empty outbox poll without running a business job', async () => {
  const { createWorkerModule } = await import('../dist/worker.module.js');
  const worker = createWorkerModule();

  const result = await worker.pollOnce();

  assert.deepEqual(result, { scanned: 0, dispatched: 0 });
});

test('an outbox consumer reports scanned records but deliberately dispatches none', async () => {
  const { OutboxConsumer } = await import('../dist/jobs/outbox.consumer.js');
  const consumer = new OutboxConsumer({
    async pollPending() {
      return [{ id: 'outbox-001' }, { id: 'outbox-002' }];
    },
  });

  const result = await consumer.pollOnce();

  assert.deepEqual(result, { scanned: 2, dispatched: 0 });
});

test('bootstrap fails explicitly when DATABASE_URL is not configured', async () => {
  const { bootstrapWorker } = await import('../dist/main.js');
  const previousDatabaseUrl = process.env.DATABASE_URL;
  delete process.env.DATABASE_URL;
  try {
    await assert.rejects(() => bootstrapWorker(), /DATABASE_URL/);
  } finally {
    if (previousDatabaseUrl === undefined) delete process.env.DATABASE_URL;
    else process.env.DATABASE_URL = previousDatabaseUrl;
  }
});

test('bootstrap accepts an explicit connection string without reading DATABASE_URL', async () => {
  const { bootstrapWorker } = await import('../dist/main.js');
  const previousDatabaseUrl = process.env.DATABASE_URL;
  delete process.env.DATABASE_URL;
  try {
    const worker = await bootstrapWorker('postgres://postgres:postgres@127.0.0.1:5432/training');
    await worker.close?.();
  } finally {
    if (previousDatabaseUrl === undefined) delete process.env.DATABASE_URL;
    else process.env.DATABASE_URL = previousDatabaseUrl;
  }
});

test('evaluation generator runs outside database transactions', async () => {
  const { TransactionalEvaluationProcessor } = await import('../dist/jobs/evaluation.processor.js');
  let transactionActive = false;
  let queryStep = 0;
  const database = {
    async transaction(work) {
      transactionActive = true;
      try {
        return await work({
          async query(statement) {
            queryStep += 1;
            if (queryStep === 1) {
              return {
                rows: [{
                  id: 'event-1',
                  organizationId: 'org-1',
                  payload: { conversationId: 'conversation-1', jobId: 'job-1' },
                  claimedAt: new Date('2026-07-31T00:00:00.000Z'),
                  leaseExpiresAt: new Date('2026-07-31T00:01:00.000Z'),
                }],
              };
            }
            if (queryStep === 2) return { rows: [{ status: 'running' }] };
            if (queryStep === 3) return { rows: [{ messageCount: '1', snapshot: { scoringRules: [] } }] };
            if (statement.includes('FROM outbox_event') && statement.includes('FOR UPDATE')) return { rows: [{ id: 'event-1' }] };
            if (statement.includes("SET status = 'succeeded'")) return { rows: [{ id: 'job-1' }] };
            return { rows: [] };
          },
        });
      } finally {
        transactionActive = false;
      }
    },
  };
  const processor = new TransactionalEvaluationProcessor(database, {
    async generate() {
      assert.equal(transactionActive, false, 'generator must not execute inside a database transaction');
      return { schemaVersion: 'evaluation-report/v1', score: 100 };
    },
  });

  const result = await processor.pollOnce();

  assert.deepEqual(result, { scanned: 1, succeeded: 1, failed: 0 });
});
