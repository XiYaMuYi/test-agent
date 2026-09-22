import assert from 'node:assert/strict';
import test from 'node:test';
import { createPostgresExecutor, MigrationRunner, schemaMigrationsBaseline, coreMvpSchemaMigration, workerEvaluationLeaseMigration, } from '../../src/database/migrations/index.js';
import { createPostgresTestSupport } from '../support/postgres.js';
async function applyCoreSchema(connectionUri) {
    const client = createPostgresExecutor(connectionUri);
    const runner = new MigrationRunner(client, [schemaMigrationsBaseline, coreMvpSchemaMigration]);
    await runner.applyAll();
    return client;
}
async function seedCoreRows(client) {
    await client.query(`INSERT INTO scenario_draft (id, organization_id, title) VALUES ('00000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000010', 'draft')`);
    await client.query(`INSERT INTO release_snapshot (id, scenario_draft_id, organization_id, schema_version, snapshot) VALUES ('00000000-0000-0000-0000-000000000002', '00000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000010', 'release-snapshot/v1', '{}'::jsonb)`);
    await client.query(`INSERT INTO assignment (id, organization_id, release_snapshot_id, name, status, starts_at, ends_at) VALUES ('00000000-0000-0000-0000-000000000003', '00000000-0000-0000-0000-000000000010', '00000000-0000-0000-0000-000000000002', 'assignment', 'active', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP + INTERVAL '1 day')`);
    await client.query(`INSERT INTO learner_assignment (id, organization_id, assignment_id, learner_id, state) VALUES ('00000000-0000-0000-0000-000000000004', '00000000-0000-0000-0000-000000000010', '00000000-0000-0000-0000-000000000003', '00000000-0000-0000-0000-000000000020', 'created')`);
    await client.query(`INSERT INTO training_attempt (id, organization_id, learner_assignment_id, idempotency_key, status) VALUES ('00000000-0000-0000-0000-000000000005', '00000000-0000-0000-0000-000000000010', '00000000-0000-0000-0000-000000000004', 'idem-1', 'created')`);
    await client.query(`INSERT INTO conversation (id, organization_id, training_attempt_id, release_snapshot_id, status) VALUES ('00000000-0000-0000-0000-000000000006', '00000000-0000-0000-0000-000000000010', '00000000-0000-0000-0000-000000000005', '00000000-0000-0000-0000-000000000002', 'active')`);
    await client.query(`INSERT INTO conversation_message (id, organization_id, conversation_id, sequence, client_message_id, role, content, request_hash) VALUES ('00000000-0000-0000-0000-000000000007', '00000000-0000-0000-0000-000000000010', '00000000-0000-0000-0000-000000000006', 1, 'msg-1', 'learner', 'hello', 'hash-1')`);
    await client.query(`INSERT INTO evaluation_job (id, organization_id, conversation_id, status) VALUES ('00000000-0000-0000-0000-000000000008', '00000000-0000-0000-0000-000000000010', '00000000-0000-0000-0000-000000000006', 'queued')`);
    await client.query(`INSERT INTO evaluation_report (id, organization_id, conversation_id, evaluation_job_id, status, report) VALUES ('00000000-0000-0000-0000-000000000009', '00000000-0000-0000-0000-000000000010', '00000000-0000-0000-0000-000000000006', '00000000-0000-0000-0000-000000000008', 'published', '{}'::jsonb)`);
}
test('core MVP migration creates expected tables', { timeout: 120_000 }, async () => {
    const postgres = await createPostgresTestSupport().start();
    const client = await applyCoreSchema(postgres.connectionUri);
    try {
        const result = await client.query(`
      SELECT COUNT(*)::text AS count
      FROM information_schema.tables
      WHERE table_schema = 'public'
        AND table_name IN (
          'scenario_draft',
          'release_snapshot',
          'assignment',
          'learner_assignment',
          'training_attempt',
          'conversation',
          'conversation_message',
          'evaluation_job',
          'evaluation_report',
          'outbox_event'
        )
    `);
        assert.equal(result.rows[0]?.count, '10');
    }
    finally {
        await client.close();
        await postgres.stop();
    }
});
test('core MVP constraints reject cross-organization relations, immutable records, and duplicate active attempts', { timeout: 120_000 }, async () => {
    const postgres = await createPostgresTestSupport().start();
    const client = await applyCoreSchema(postgres.connectionUri);
    try {
        await seedCoreRows(client);
        await assert.rejects(client.query(`INSERT INTO release_snapshot (id, scenario_draft_id, organization_id, schema_version, snapshot) VALUES ('00000000-0000-0000-0000-000000000021', '00000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000099', 'release-snapshot/v1', '{}'::jsonb)`));
        await assert.doesNotReject(client.query(`INSERT INTO release_snapshot (id, scenario_draft_id, organization_id, schema_version, snapshot) VALUES ('00000000-0000-0000-0000-000000000024', '00000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000010', 'release-snapshot/v1', '{}'::jsonb)`));
        await assert.rejects(client.query(`INSERT INTO conversation (id, organization_id, training_attempt_id, release_snapshot_id, status) VALUES ('00000000-0000-0000-0000-000000000022', '00000000-0000-0000-0000-000000000010', '00000000-0000-0000-0000-000000000005', '00000000-0000-0000-0000-000000000002', 'active')`));
        await assert.rejects(client.query(`INSERT INTO evaluation_job (id, organization_id, conversation_id, status) VALUES ('00000000-0000-0000-0000-000000000023', '00000000-0000-0000-0000-000000000010', '00000000-0000-0000-0000-000000000006', 'queued')`));
        await assert.rejects(client.query(`UPDATE release_snapshot SET snapshot = '{"changed":true}'::jsonb WHERE id = '00000000-0000-0000-0000-000000000002'`));
        await assert.rejects(client.query(`UPDATE evaluation_report SET report = '{"changed":true}'::jsonb WHERE id = '00000000-0000-0000-0000-000000000009'`));
        await assert.rejects(client.query(`DELETE FROM evaluation_report WHERE id = '00000000-0000-0000-0000-000000000009'`));
        await assert.rejects(client.query(`INSERT INTO training_attempt (id, organization_id, learner_assignment_id, idempotency_key, status) VALUES ('00000000-0000-0000-0000-000000000011', '00000000-0000-0000-0000-000000000010', '00000000-0000-0000-0000-000000000004', 'idem-2', 'active')`));
        await assert.rejects(client.query(`INSERT INTO conversation_message (id, organization_id, conversation_id, sequence, client_message_id, role, content, request_hash) VALUES ('00000000-0000-0000-0000-000000000012', '00000000-0000-0000-0000-000000000010', '00000000-0000-0000-0000-000000000006', 1, 'msg-2', 'learner', 'hello again', 'hash-2')`));
        await assert.rejects(client.query(`INSERT INTO evaluation_report (id, organization_id, conversation_id, evaluation_job_id, status, report) VALUES ('00000000-0000-0000-0000-000000000013', '00000000-0000-0000-0000-000000000010', '00000000-0000-0000-0000-000000000006', '00000000-0000-0000-0000-000000000008', 'published', '{}'::jsonb)`));
    }
    finally {
        await client.close();
        await postgres.stop();
    }
});
test('worker lease migration backfills in-flight work with a grace lease and rolls back cleanly', { timeout: 120_000 }, async () => {
    const postgres = await createPostgresTestSupport().start();
    const client = await applyCoreSchema(postgres.connectionUri);
    try {
        await seedCoreRows(client);
        await client.query(`
      UPDATE evaluation_job
      SET status = 'running'
      WHERE id = '00000000-0000-0000-0000-000000000008'
        AND organization_id = '00000000-0000-0000-0000-000000000010'
    `);
        await client.query(`
      INSERT INTO outbox_event (
        id,
        organization_id,
        aggregate_type,
        aggregate_id,
        event_type,
        payload,
        deduplication_key,
        status
      )
      VALUES (
        '00000000-0000-0000-0000-000000000014',
        '00000000-0000-0000-0000-000000000010',
        'evaluation',
        '00000000-0000-0000-0000-000000000006',
        'evaluation.requested',
        '{"conversationId":"00000000-0000-0000-0000-000000000006","jobId":"00000000-0000-0000-0000-000000000008"}'::jsonb,
        'evaluation:lease-upgrade',
        'processing'
      )
    `);
        const runner = new MigrationRunner(client, [
            schemaMigrationsBaseline,
            coreMvpSchemaMigration,
            workerEvaluationLeaseMigration,
        ]);
        assert.deepEqual(await runner.applyAll(), ['0003_worker_evaluation_lease']);
        const leases = await client.query(`
      SELECT 'event' AS source,
             claim_token::text AS "claimToken",
             EXTRACT(EPOCH FROM (lease_expires_at - clock_timestamp()))::float8 AS "remainingSeconds"
      FROM outbox_event
      WHERE id = '00000000-0000-0000-0000-000000000014'
      UNION ALL
      SELECT 'job' AS source,
             claim_token::text AS "claimToken",
             EXTRACT(EPOCH FROM (lease_expires_at - clock_timestamp()))::float8 AS "remainingSeconds"
      FROM evaluation_job
      WHERE id = '00000000-0000-0000-0000-000000000008'
      ORDER BY source
    `);
        assert.equal(leases.rows.length, 2);
        for (const lease of leases.rows) {
            assert.ok(lease.claimToken, `${lease.source} should receive a durable claim token`);
            assert.ok(lease.remainingSeconds > 50 && lease.remainingSeconds <= 60, `${lease.source} should receive a fresh 60-second grace lease`);
        }
        await client.query(`
      UPDATE outbox_event
      SET status = 'pending',
          claimed_at = '2026-07-30T00:00:00.000Z',
          lease_expires_at = '2026-07-30T00:01:00.000Z',
          claim_token = '00000000-0000-0000-0000-000000000099'
      WHERE id = '00000000-0000-0000-0000-000000000014'
    `);
        await client.query(`
      UPDATE evaluation_job
      SET status = 'retryable_failed',
          claimed_at = '2026-07-30T00:00:00.000Z',
          lease_expires_at = '2026-07-30T00:01:00.000Z',
          claim_token = '00000000-0000-0000-0000-000000000098'
      WHERE id = '00000000-0000-0000-0000-000000000008'
    `);
        await client.query(`
      UPDATE outbox_event
      SET status = 'processing'
      WHERE id = '00000000-0000-0000-0000-000000000014'
    `);
        await client.query(`
      UPDATE evaluation_job
      SET status = 'running'
      WHERE id = '00000000-0000-0000-0000-000000000008'
    `);
        const legacyClaims = await client.query(`
      SELECT 'event' AS source,
             claim_token::text AS "claimToken",
             EXTRACT(EPOCH FROM (lease_expires_at - clock_timestamp()))::float8 AS "remainingSeconds"
      FROM outbox_event
      WHERE id = '00000000-0000-0000-0000-000000000014'
      UNION ALL
      SELECT 'job' AS source,
             claim_token::text AS "claimToken",
             EXTRACT(EPOCH FROM (lease_expires_at - clock_timestamp()))::float8 AS "remainingSeconds"
      FROM evaluation_job
      WHERE id = '00000000-0000-0000-0000-000000000008'
      ORDER BY source
    `);
        assert.deepEqual(legacyClaims.rows.map(({ source, claimToken }) => ({ source, claimToken })), [
            { source: 'event', claimToken: '00000000-0000-0000-0000-000000000014' },
            { source: 'job', claimToken: '00000000-0000-0000-0000-000000000008' },
        ], 'legacy status-only claims should receive database-managed leases instead of retaining stale claims');
        for (const lease of legacyClaims.rows) {
            assert.ok(lease.remainingSeconds > 50 && lease.remainingSeconds <= 60, `${lease.source} legacy claim should receive a fresh grace lease`);
        }
        assert.equal(await runner.rollbackLast(), '0003_worker_evaluation_lease');
        const columns = await client.query(`
      SELECT COUNT(*)::text AS count
      FROM information_schema.columns
      WHERE table_schema = 'public'
        AND table_name IN ('outbox_event', 'evaluation_job')
        AND column_name IN ('claimed_at', 'lease_expires_at', 'claim_token')
    `);
        assert.equal(columns.rows[0]?.count, '0');
        const objects = await client.query(`
      SELECT (
        (SELECT COUNT(*) FROM pg_trigger WHERE tgname IN (
          'outbox_processing_lease_trigger',
          'evaluation_job_running_lease_trigger'
        ))
        + (SELECT COUNT(*) FROM pg_proc WHERE proname IN (
          'ensure_outbox_processing_lease',
          'ensure_evaluation_job_running_lease'
        ))
        + (SELECT COUNT(*) FROM pg_constraint WHERE conname IN (
          'outbox_event_processing_has_lease',
          'evaluation_job_running_has_lease'
        ))
        + (SELECT COUNT(*) FROM pg_indexes WHERE indexname IN (
          'outbox_evaluation_claim_lease_idx',
          'evaluation_job_claim_lease_idx'
        ))
      )::text AS count
    `);
        assert.equal(objects.rows[0]?.count, '0');
    }
    finally {
        await client.close();
        await postgres.stop();
    }
});
