import assert from 'node:assert/strict';
import test from 'node:test';

import {
  createPostgresExecutor,
  MigrationRunner,
  schemaMigrationsBaseline,
  coreMvpSchemaMigration,
  workerEvaluationLeaseMigration,
  personaTemplatesMigration,
  cFirstDualTrackMigration,
} from '../../src/database/migrations/index.js';
import { createPostgresTestSupport } from '../support/postgres.js';

const ORG = '00000000-0000-0000-0000-000000000010';
const ORG_OTHER = '00000000-0000-0000-0000-000000000099';
const DRAFT = '00000000-0000-0000-0000-000000000001';
const SNAPSHOT = '00000000-0000-0000-0000-000000000002';
const ASSIGNMENT = '00000000-0000-0000-0000-000000000003';
const LEARNER_ASSIGNMENT = '00000000-0000-0000-0000-000000000004';
const ATTEMPT = '00000000-0000-0000-0000-000000000005';
const CONVERSATION = '00000000-0000-0000-0000-000000000006';
const LEARNER = '00000000-0000-0000-0000-000000000020';

const ALL_MIGRATIONS = [
  schemaMigrationsBaseline,
  coreMvpSchemaMigration,
  workerEvaluationLeaseMigration,
  personaTemplatesMigration,
  cFirstDualTrackMigration,
];

type CountRow = Record<string, unknown> & { count: string };

async function applyAll(connectionUri: string) {
  const client = createPostgresExecutor(connectionUri);
  const runner = new MigrationRunner(client, ALL_MIGRATIONS);
  await runner.applyAll();
  return client;
}

/** Seeds the legacy assigned chain (draft → snapshot → assignment → eligibility → attempt → conversation). */
async function seedAssignedChain(client: Awaited<ReturnType<typeof applyAll>>): Promise<void> {
  await client.query(
    `INSERT INTO scenario_draft (id, organization_id, title) VALUES ($1, $2, 'draft')`,
    [DRAFT, ORG],
  );
  await client.query(
    `INSERT INTO release_snapshot (id, scenario_draft_id, organization_id, schema_version, snapshot)
     VALUES ($1, $2, $3, 'release-snapshot/v1', '{}'::jsonb)`,
    [SNAPSHOT, DRAFT, ORG],
  );
  await client.query(
    `INSERT INTO assignment (id, organization_id, release_snapshot_id, name, status, starts_at, ends_at)
     VALUES ($1, $2, $3, 'assignment', 'active', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP + INTERVAL '1 day')`,
    [ASSIGNMENT, ORG, SNAPSHOT],
  );
  await client.query(
    `INSERT INTO learner_assignment (id, organization_id, assignment_id, learner_id, state)
     VALUES ($1, $2, $3, $4, 'created')`,
    [LEARNER_ASSIGNMENT, ORG, ASSIGNMENT, LEARNER],
  );
  await client.query(
    `INSERT INTO training_attempt (id, organization_id, learner_assignment_id, idempotency_key, status)
     VALUES ($1, $2, $3, 'idem-1', 'completed')`,
    [ATTEMPT, ORG, LEARNER_ASSIGNMENT],
  );
  await client.query(
    `INSERT INTO conversation (id, organization_id, training_attempt_id, release_snapshot_id, status)
     VALUES ($1, $2, $3, $4, 'ended')`,
    [CONVERSATION, ORG, ATTEMPT, SNAPSHOT],
  );
}

test('0015 creates the three dual-track tables', { timeout: 120_000 }, async () => {
  const postgres = await createPostgresTestSupport().start();
  const client = await applyAll(postgres.connectionUri);
  try {
    const result = await client.query<CountRow>(`
      SELECT COUNT(*)::text AS count
      FROM information_schema.tables
      WHERE table_schema = 'public'
        AND table_name IN ('learner_profile', 'training_template', 'training_session')
    `);
    assert.equal(result.rows[0]?.count, '3');
  } finally {
    await client.close();
    await postgres.stop();
  }
});

test('0015 backfills legacy assigned conversations into assigned sessions', { timeout: 120_000 }, async () => {
  const postgres = await createPostgresTestSupport().start();
  // Apply only the legacy schema first, then seed an assigned conversation.
  const legacy = createPostgresExecutor(postgres.connectionUri);
  const legacyRunner = new MigrationRunner(legacy, [
    schemaMigrationsBaseline,
    coreMvpSchemaMigration,
    workerEvaluationLeaseMigration,
    personaTemplatesMigration,
  ]);
  await legacyRunner.applyAll();
  await seedAssignedChain(legacy);

  // Now apply 0015 over the seeded legacy schema.
  const upgradeRunner = new MigrationRunner(legacy, ALL_MIGRATIONS);
  const applied = await upgradeRunner.applyAll();
  try {
    assert.deepEqual(applied, ['0015_c_first_dual_track']);

    const linked = await legacy.query<{ trainingSessionId: string | null }>(
      `SELECT training_session_id AS "trainingSessionId" FROM conversation WHERE id = $1`,
      [CONVERSATION],
    );
    assert.ok(linked.rows[0]?.trainingSessionId, 'legacy conversation gains a session');

    const session = await legacy.query<{ sourceType: string; learnerId: string; assignmentId: string | null }>(
      `SELECT source_type AS "sourceType", learner_id AS "learnerId", assignment_id AS "assignmentId"
       FROM training_session WHERE training_attempt_id = $1`,
      [ATTEMPT],
    );
    assert.equal(session.rows[0]?.sourceType, 'assigned');
    assert.equal(session.rows[0]?.learnerId, LEARNER);
    assert.equal(session.rows[0]?.assignmentId, ASSIGNMENT);
  } finally {
    await legacy.close();
    await postgres.stop();
  }
});

test('0015 keeps conversation.training_session_id nullable during the expand-and-contract transition', { timeout: 120_000 }, async () => {
  const postgres = await createPostgresTestSupport().start();
  const client = await applyAll(postgres.connectionUri);
  try {
    // seedAssignedChain inserts a conversation WITHOUT training_session_id (the
    // legacy assigned write path). It must keep succeeding until the service layer
    // is migrated in later TDD steps — a NOT NULL constraint here would throw.
    await assert.doesNotReject(seedAssignedChain(client));

    const seeded = await client.query<{ sessionId: string | null }>(
      `SELECT training_session_id AS "sessionId" FROM conversation WHERE id = $1`,
      [CONVERSATION],
    );
    assert.equal(seeded.rows[0]?.sessionId, null, 'legacy path leaves session_id null until backfill/service writes it');

    const nullable = await client.query<{ isNullable: string }>(
      `SELECT is_nullable AS "isNullable" FROM information_schema.columns
       WHERE table_schema='public' AND table_name='conversation' AND column_name='training_session_id'`,
    );
    assert.equal(nullable.rows[0]?.isNullable, 'YES');
  } finally {
    await client.close();
    await postgres.stop();
  }
});

test('0015 enforces dual-track consistency: free rejects assigned chain and vice versa', { timeout: 120_000 }, async () => {
  const postgres = await createPostgresTestSupport().start();
  const client = await applyAll(postgres.connectionUri);
  try {
    await client.query(
      `INSERT INTO learner_profile (internal_learner_id, organization_id, external_principal_id)
       VALUES ($1, $2, 'pgu-1')`,
      [LEARNER, ORG],
    );

    // Valid free session: no assigned chain columns at all.
    await assert.doesNotReject(
      client.query(
        `INSERT INTO training_session
           (id, organization_id, learner_id, source_type, persona_snapshot, status, idempotency_key)
         VALUES (gen_random_uuid(), $1, $2, 'free', '{}'::jsonb, 'ended', 'free-1')`,
        [ORG, LEARNER],
      ),
    );

    // Invalid free session: carries an assignment_id → CHECK rejects.
    await assert.rejects(
      client.query(
        `INSERT INTO training_session
           (id, organization_id, learner_id, source_type, assignment_id, persona_snapshot, status, idempotency_key)
         VALUES (gen_random_uuid(), $1, $2, 'free', $3, '{}'::jsonb, 'ended', 'free-2')`,
        [ORG, LEARNER, ASSIGNMENT],
      ),
    );

    // Invalid assigned session: declares assigned but omits the chain → CHECK rejects.
    await assert.rejects(
      client.query(
        `INSERT INTO training_session
           (id, organization_id, learner_id, source_type, persona_snapshot, status, idempotency_key)
         VALUES (gen_random_uuid(), $1, $2, 'assigned', '{}'::jsonb, 'ended', 'assigned-bad')`,
        [ORG, LEARNER],
      ),
    );
  } finally {
    await client.close();
    await postgres.stop();
  }
});

test('0015 rejects cross-organization learner reference via composite foreign key', { timeout: 120_000 }, async () => {
  const postgres = await createPostgresTestSupport().start();
  const client = await applyAll(postgres.connectionUri);
  try {
    // Learner belongs to ORG_OTHER.
    await client.query(
      `INSERT INTO learner_profile (internal_learner_id, organization_id, external_principal_id)
       VALUES ($1, $2, 'pgu-x')`,
      [LEARNER, ORG_OTHER],
    );
    // Session in ORG referencing that learner → composite FK rejects.
    await assert.rejects(
      client.query(
        `INSERT INTO training_session
           (id, organization_id, learner_id, source_type, persona_snapshot, status, idempotency_key)
         VALUES (gen_random_uuid(), $1, $2, 'free', '{}'::jsonb, 'active', 'cross-1')`,
        [ORG, LEARNER],
      ),
    );
  } finally {
    await client.close();
    await postgres.stop();
  }
});

test('0015 allows only one in-flight session per learner', { timeout: 120_000 }, async () => {
  const postgres = await createPostgresTestSupport().start();
  const client = await applyAll(postgres.connectionUri);
  try {
    await client.query(
      `INSERT INTO learner_profile (internal_learner_id, organization_id, external_principal_id)
       VALUES ($1, $2, 'pgu-2')`,
      [LEARNER, ORG],
    );
    await client.query(
      `INSERT INTO training_session
         (id, organization_id, learner_id, source_type, persona_snapshot, status, idempotency_key)
       VALUES (gen_random_uuid(), $1, $2, 'free', '{}'::jsonb, 'active', 'a-1')`,
      [ORG, LEARNER],
    );
    // Second in-flight session for the same learner is rejected.
    await assert.rejects(
      client.query(
        `INSERT INTO training_session
           (id, organization_id, learner_id, source_type, persona_snapshot, status, idempotency_key)
         VALUES (gen_random_uuid(), $1, $2, 'free', '{}'::jsonb, 'created', 'a-2')`,
        [ORG, LEARNER],
      ),
    );
    // A finished session does not occupy the in-flight slot.
    await assert.doesNotReject(
      client.query(
        `INSERT INTO training_session
           (id, organization_id, learner_id, source_type, persona_snapshot, status, idempotency_key)
         VALUES (gen_random_uuid(), $1, $2, 'free', '{}'::jsonb, 'ended', 'a-3')`,
        [ORG, LEARNER],
      ),
    );
  } finally {
    await client.close();
    await postgres.stop();
  }
});

test('0015 enforces personal template ownership and rejects cross-scope owner misuse', { timeout: 120_000 }, async () => {
  const postgres = await createPostgresTestSupport().start();
  const client = await applyAll(postgres.connectionUri);
  try {
    await client.query(
      `INSERT INTO learner_profile (internal_learner_id, organization_id, external_principal_id)
       VALUES ($1, $2, 'pgu-3')`,
      [LEARNER, ORG],
    );
    // personal without owner → reject
    await assert.rejects(
      client.query(
        `INSERT INTO training_template (id, organization_id, scope, title, persona_config)
         VALUES (gen_random_uuid(), $1, 'personal', 'mine', '{}'::jsonb)`,
        [ORG],
      ),
    );
    // organization with an owner → reject
    await assert.rejects(
      client.query(
        `INSERT INTO training_template (id, organization_id, scope, owner_learner_id, title, persona_config)
         VALUES (gen_random_uuid(), $1, 'organization', $2, 'org-tpl', '{}'::jsonb)`,
        [ORG, LEARNER],
      ),
    );
    // valid personal template
    await assert.doesNotReject(
      client.query(
        `INSERT INTO training_template (id, organization_id, scope, owner_learner_id, title, persona_config)
         VALUES (gen_random_uuid(), $1, 'personal', $2, 'mine', '{}'::jsonb)`,
        [ORG, LEARNER],
      ),
    );
  } finally {
    await client.close();
    await postgres.stop();
  }
});

test('0015 rolls back cleanly: new tables and conversation column removed, legacy NOT NULL restored', { timeout: 120_000 }, async () => {
  const postgres = await createPostgresTestSupport().start();
  const client = createPostgresExecutor(postgres.connectionUri);
  const runner = new MigrationRunner(client, ALL_MIGRATIONS);
  await runner.applyAll();
  try {
    assert.equal(await runner.rollbackLast(), '0015_c_first_dual_track');

    const tables = await client.query<CountRow>(`
      SELECT COUNT(*)::text AS count FROM information_schema.tables
      WHERE table_schema = 'public'
        AND table_name IN ('learner_profile', 'training_template', 'training_session')
    `);
    assert.equal(tables.rows[0]?.count, '0');

    const addedColumn = await client.query<CountRow>(`
      SELECT COUNT(*)::text AS count FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = 'conversation'
        AND column_name = 'training_session_id'
    `);
    assert.equal(addedColumn.rows[0]?.count, '0');

    const nullability = await client.query<{ columnName: string; isNullable: string }>(`
      SELECT column_name AS "columnName", is_nullable AS "isNullable"
      FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = 'conversation'
        AND column_name IN ('training_attempt_id', 'release_snapshot_id')
      ORDER BY column_name
    `);
    assert.equal(nullability.rows.length, 2);
    for (const row of nullability.rows) {
      assert.equal(row.isNullable, 'NO', `${row.columnName} restored to NOT NULL`);
    }
  } finally {
    await client.close();
    await postgres.stop();
  }
});
