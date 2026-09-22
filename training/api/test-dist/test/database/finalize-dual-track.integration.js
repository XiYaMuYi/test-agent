import assert from 'node:assert/strict';
import test from 'node:test';
import { createPostgresExecutor, MigrationRunner, schemaMigrationsBaseline, coreMvpSchemaMigration, workerEvaluationLeaseMigration, personaTemplatesMigration, cFirstDualTrackMigration, finalizeDualTrackMigration, } from '../../src/database/migrations/index.js';
import { createPostgresTestSupport } from '../support/postgres.js';
const ORG = '00000000-0000-0000-0000-000000000010';
const DRAFT = '00000000-0000-0000-0000-000000000001';
const SNAPSHOT = '00000000-0000-0000-0000-000000000002';
const ASSIGNMENT = '00000000-0000-0000-0000-000000000003';
const LEARNER_ASSIGNMENT = '00000000-0000-0000-0000-000000000004';
const ATTEMPT = '00000000-0000-0000-0000-000000000005';
const CONVERSATION = '00000000-0000-0000-0000-000000000006';
const LEARNER = '00000000-0000-0000-0000-000000000020';
const ORPHAN = '00000000-0000-0000-0000-000000000030';
const THROUGH_0015 = [
    schemaMigrationsBaseline,
    coreMvpSchemaMigration,
    workerEvaluationLeaseMigration,
    personaTemplatesMigration,
    cFirstDualTrackMigration,
];
const ALL = [...THROUGH_0015, finalizeDualTrackMigration];
async function seedAssignedChain(client) {
    await client.query(`INSERT INTO scenario_draft (id, organization_id, title) VALUES ($1, $2, 'draft')`, [DRAFT, ORG]);
    await client.query(`INSERT INTO release_snapshot (id, scenario_draft_id, organization_id, schema_version, snapshot)
     VALUES ($1, $2, $3, 'release-snapshot/v1', '{}'::jsonb)`, [SNAPSHOT, DRAFT, ORG]);
    await client.query(`INSERT INTO assignment (id, organization_id, release_snapshot_id, name, status, starts_at, ends_at)
     VALUES ($1, $2, $3, 'assignment', 'active', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP + INTERVAL '1 day')`, [ASSIGNMENT, ORG, SNAPSHOT]);
    await client.query(`INSERT INTO learner_assignment (id, organization_id, assignment_id, learner_id, state)
     VALUES ($1, $2, $3, $4, 'created')`, [LEARNER_ASSIGNMENT, ORG, ASSIGNMENT, LEARNER]);
    await client.query(`INSERT INTO training_attempt (id, organization_id, learner_assignment_id, idempotency_key, status)
     VALUES ($1, $2, $3, 'idem-1', 'completed')`, [ATTEMPT, ORG, LEARNER_ASSIGNMENT]);
    await client.query(`INSERT INTO conversation (id, organization_id, training_attempt_id, release_snapshot_id, status)
     VALUES ($1, $2, $3, $4, 'ended')`, [CONVERSATION, ORG, ATTEMPT, SNAPSHOT]);
}
async function nullability(client, column) {
    const result = await client.query(`SELECT is_nullable AS "isNullable" FROM information_schema.columns
     WHERE table_schema='public' AND table_name='conversation' AND column_name=$1`, [column]);
    return result.rows[0]?.isNullable ?? 'MISSING';
}
test('0016 enforces conversation.training_session_id NOT NULL while free-track columns stay nullable', { timeout: 120_000 }, async () => {
    const postgres = await createPostgresTestSupport().start();
    const client = createPostgresExecutor(postgres.connectionUri);
    await new MigrationRunner(client, ALL).applyAll();
    try {
        assert.equal(await nullability(client, 'training_session_id'), 'NO', 'session root becomes mandatory');
        assert.equal(await nullability(client, 'training_attempt_id'), 'YES', 'free sessions never carry an attempt');
        assert.equal(await nullability(client, 'release_snapshot_id'), 'YES', 'free sessions never carry a release snapshot');
    }
    finally {
        await client.close();
        await postgres.stop();
    }
});
test('0016 backfills conversations the legacy write path created during the transition window', { timeout: 120_000 }, async () => {
    const postgres = await createPostgresTestSupport().start();
    const client = createPostgresExecutor(postgres.connectionUri);
    // Schema through 0015 only (column still nullable), then a legacy write inserts without a session.
    await new MigrationRunner(client, THROUGH_0015).applyAll();
    await seedAssignedChain(client);
    const before = await client.query('SELECT training_session_id AS "sessionId" FROM conversation WHERE id=$1', [CONVERSATION]);
    assert.equal(before.rows[0]?.sessionId, null);
    const applied = await new MigrationRunner(client, ALL).applyAll();
    try {
        assert.deepEqual(applied, ['0016_finalize_dual_track']);
        const linked = await client.query('SELECT training_session_id AS "sessionId" FROM conversation WHERE id=$1', [CONVERSATION]);
        assert.ok(linked.rows[0]?.sessionId, 'straggler conversation gains a session');
        const session = await client.query(`SELECT source_type AS "sourceType", learner_id AS "learnerId"
       FROM training_session WHERE training_attempt_id=$1`, [ATTEMPT]);
        assert.equal(session.rows[0]?.sourceType, 'assigned');
        assert.equal(session.rows[0]?.learnerId, LEARNER);
        assert.equal(await nullability(client, 'training_session_id'), 'NO');
    }
    finally {
        await client.close();
        await postgres.stop();
    }
});
test('0016 aborts and stays nullable when an unlinkable orphan conversation remains', { timeout: 120_000 }, async () => {
    const postgres = await createPostgresTestSupport().start();
    const client = createPostgresExecutor(postgres.connectionUri);
    await new MigrationRunner(client, THROUGH_0015).applyAll();
    // Orphan: no attempt chain AND no session root — nothing safe to backfill from.
    await client.query(`INSERT INTO conversation (id, organization_id, status) VALUES ($1, $2, 'created')`, [ORPHAN, ORG]);
    await assert.rejects(() => new MigrationRunner(client, ALL).applyAll(), /training_session_id|orphan/i);
    try {
        assert.equal(await nullability(client, 'training_session_id'), 'YES', 'failed finalize must roll back SET NOT NULL');
        const orphan = await client.query('SELECT id FROM conversation WHERE id=$1', [ORPHAN]);
        assert.equal(orphan.rows.length, 1, 'orphan row is left untouched for manual triage');
    }
    finally {
        await client.close();
        await postgres.stop();
    }
});
test('0016 down relaxes NOT NULL without dropping backfilled data', { timeout: 120_000 }, async () => {
    const postgres = await createPostgresTestSupport().start();
    const client = createPostgresExecutor(postgres.connectionUri);
    const runner = new MigrationRunner(client, ALL);
    await runner.applyAll();
    try {
        assert.equal(await runner.rollbackLast(), '0016_finalize_dual_track');
        assert.equal(await nullability(client, 'training_session_id'), 'YES');
    }
    finally {
        await client.close();
        await postgres.stop();
    }
});
