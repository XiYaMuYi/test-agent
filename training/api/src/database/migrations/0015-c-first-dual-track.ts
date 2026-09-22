import type { Migration } from './migration.types.js';

/**
 * C-first dual-track training schema.
 *
 * Introduces the unified training_session root so a learner can start a free
 * practice session without an assignment, while assigned (B-end投放) sessions
 * keep using the existing assignment → learner_assignment → training_attempt
 * chain. Adds three-layer training templates (platform/organization/personal)
 * and the local learner_profile training projection that maps an external
 * principal id to a stable internal learner id.
 *
 * Contract: docs/architecture/contracts/c-first-dual-track-contract.md
 *
 * Forward order matters:
 *   1. learner_profile      (referenced by template/session)
 *   2. training_template    (personal templates reference learner_profile)
 *   3. training_session     (references profile + existing assigned chain)
 *   4. conversation         gains a NULLABLE training_session_id; legacy NOT NULLs relax
 *   5. backfill legacy learner profiles, then assigned sessions, then link conversations
 *   6. indexes (the new column stays nullable here; a later finalize migration enforces NOT NULL)
 */
export const cFirstDualTrackMigration: Migration = {
  id: '0015_c_first_dual_track',
  description:
    'Add training_session/training_template/learner_profile and decouple conversation from the assigned-only chain for C-first free practice.',

  async up(database): Promise<void> {
    // 1. learner_profile: local training projection + external→internal mapping.
    //    It is NOT the authoritative identity (that stays with the account system).
    await database.query(`
      CREATE TABLE IF NOT EXISTS learner_profile (
        internal_learner_id UUID PRIMARY KEY,
        organization_id UUID NOT NULL,
        external_principal_id VARCHAR(256) NOT NULL,
        identity_provider VARCHAR(64) NOT NULL DEFAULT 'gongzhugou',
        display_name VARCHAR(128) NULL,
        total_free_sessions INTEGER NOT NULL DEFAULT 0 CHECK (total_free_sessions >= 0),
        total_assigned_sessions INTEGER NOT NULL DEFAULT 0 CHECK (total_assigned_sessions >= 0),
        avg_score NUMERIC(5,2) NULL CHECK (avg_score IS NULL OR (avg_score >= 0 AND avg_score <= 100)),
        dimension_scores JSONB NOT NULL DEFAULT '{}'::jsonb,
        weak_points JSONB NOT NULL DEFAULT '[]'::jsonb,
        last_trained_at TIMESTAMPTZ NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
        UNIQUE (organization_id, internal_learner_id),
        UNIQUE (identity_provider, external_principal_id)
      )
    `);

    // 2. training_template: platform / organization / personal three-layer supply.
    await database.query(`
      CREATE TABLE IF NOT EXISTS training_template (
        id UUID PRIMARY KEY,
        organization_id UUID NOT NULL,
        scope TEXT NOT NULL CHECK (scope IN ('platform', 'organization', 'personal')),
        owner_learner_id UUID NULL,
        title VARCHAR(128) NOT NULL,
        persona_config JSONB NOT NULL,
        knowledge_versions JSONB NOT NULL DEFAULT '[]'::jsonb,
        scoring_rules JSONB NOT NULL DEFAULT '[]'::jsonb,
        agent_config JSONB NOT NULL DEFAULT '{}'::jsonb,
        status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'archived')),
        created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
        UNIQUE (organization_id, id),
        UNIQUE (organization_id, owner_learner_id, title),
        FOREIGN KEY (organization_id, owner_learner_id)
          REFERENCES learner_profile (organization_id, internal_learner_id)
          ON DELETE RESTRICT,
        CHECK (
          (scope = 'personal' AND owner_learner_id IS NOT NULL)
          OR (scope <> 'personal' AND owner_learner_id IS NULL)
        )
      )
    `);

    // 3. training_session: unified root for both free and assigned tracks.
    await database.query(`
      CREATE TABLE IF NOT EXISTS training_session (
        id UUID PRIMARY KEY,
        organization_id UUID NOT NULL,
        learner_id UUID NOT NULL,
        source_type TEXT NOT NULL CHECK (source_type IN ('free', 'assigned')),
        mode TEXT NOT NULL DEFAULT 'practice' CHECK (mode IN ('practice', 'exam')),
        template_id UUID NULL,
        release_snapshot_id UUID NULL,
        assignment_id UUID NULL,
        learner_assignment_id UUID NULL,
        training_attempt_id UUID NULL,
        persona_snapshot JSONB NOT NULL,
        status TEXT NOT NULL CHECK (status IN ('created', 'active', 'ended', 'scored')),
        idempotency_key TEXT NOT NULL,
        started_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
        finished_at TIMESTAMPTZ NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
        UNIQUE (organization_id, id),
        UNIQUE (organization_id, learner_id, idempotency_key),
        FOREIGN KEY (organization_id, learner_id)
          REFERENCES learner_profile (organization_id, internal_learner_id)
          ON DELETE RESTRICT,
        FOREIGN KEY (organization_id, template_id)
          REFERENCES training_template (organization_id, id)
          ON DELETE RESTRICT,
        FOREIGN KEY (organization_id, release_snapshot_id)
          REFERENCES release_snapshot (organization_id, id)
          ON DELETE RESTRICT,
        FOREIGN KEY (organization_id, assignment_id)
          REFERENCES assignment (organization_id, id)
          ON DELETE RESTRICT,
        FOREIGN KEY (organization_id, learner_assignment_id)
          REFERENCES learner_assignment (organization_id, id)
          ON DELETE RESTRICT,
        FOREIGN KEY (organization_id, training_attempt_id)
          REFERENCES training_attempt (organization_id, id)
          ON DELETE RESTRICT,
        -- Track consistency: free carries no assigned chain; assigned carries all of it.
        CHECK (
          (
            source_type = 'free'
            AND assignment_id IS NULL
            AND learner_assignment_id IS NULL
            AND training_attempt_id IS NULL
          )
          OR
          (
            source_type = 'assigned'
            AND release_snapshot_id IS NOT NULL
            AND assignment_id IS NOT NULL
            AND learner_assignment_id IS NOT NULL
            AND training_attempt_id IS NOT NULL
          )
        )
      )
    `);

    // 4. conversation: attach to the unified session root and relax assigned-only NOT NULLs.
    await database.query(`
      ALTER TABLE conversation
        ADD COLUMN IF NOT EXISTS training_session_id UUID
    `);
    await database.query(`
      ALTER TABLE conversation ALTER COLUMN training_attempt_id DROP NOT NULL
    `);
    await database.query(`
      ALTER TABLE conversation ALTER COLUMN release_snapshot_id DROP NOT NULL
    `);

    // 5. Backfill: every legacy conversation belongs to the assigned track.
    //    5a. training_session.learner_id has a composite FK to learner_profile, so
    //        every learner referenced by an existing eligibility row needs a
    //        profile first. Legacy rows carry no external principal id (the old
    //        code derived a UUID via SHA-256), so use an explicit legacy placeholder
    //        that the real identity mapping backfills later.
    await database.query(`
      INSERT INTO learner_profile (
        internal_learner_id,
        organization_id,
        external_principal_id,
        identity_provider
      )
      SELECT DISTINCT la.learner_id, la.organization_id, 'legacy:' || la.learner_id::text, 'legacy-backfill'
      FROM learner_assignment la
      WHERE NOT EXISTS (
        SELECT 1 FROM learner_profile lp
        WHERE lp.organization_id = la.organization_id
          AND lp.internal_learner_id = la.learner_id
      )
    `);

    //    5b. Derive one assigned session per legacy conversation via attempt → eligibility.
    await database.query(`
      INSERT INTO training_session (
        id,
        organization_id,
        learner_id,
        source_type,
        mode,
        template_id,
        release_snapshot_id,
        assignment_id,
        learner_assignment_id,
        training_attempt_id,
        persona_snapshot,
        status,
        idempotency_key,
        started_at,
        finished_at,
        created_at
      )
      SELECT
        gen_random_uuid(),
        c.organization_id,
        la.learner_id,
        'assigned',
        'practice',
        NULL,
        c.release_snapshot_id,
        la.assignment_id,
        la.id,
        ta.id,
        '{}'::jsonb,
        CASE WHEN c.status IN ('completed', 'ended', 'failed') THEN 'ended' ELSE 'active' END,
        'migration-0015:conversation:' || c.id::text,
        c.created_at,
        CASE WHEN c.status IN ('completed', 'ended', 'failed') THEN c.updated_at ELSE NULL END,
        c.created_at
      FROM conversation c
      JOIN training_attempt ta
        ON ta.organization_id = c.organization_id
       AND ta.id = c.training_attempt_id
      JOIN learner_assignment la
        ON la.organization_id = ta.organization_id
       AND la.id = ta.learner_assignment_id
      WHERE c.training_session_id IS NULL
    `);

    await database.query(`
      UPDATE conversation c
      SET training_session_id = ts.id
      FROM training_session ts
      WHERE ts.organization_id = c.organization_id
        AND ts.training_attempt_id = c.training_attempt_id
        AND c.training_session_id IS NULL
    `);

    // Expand-and-contract: training_session_id is intentionally NULLABLE in this
    // migration. Legacy assigned write paths (AssignmentService.startAttempt and
    // their tests) do not populate it yet; the TDD service steps (T3/T5) move all
    // conversation creation onto training_session. A finalize migration then
    // backfills any stragglers and SETs NOT NULL. Existing rows were linked above.

    await database.query(`
      ALTER TABLE conversation
        ADD CONSTRAINT conversation_training_session_fk
        FOREIGN KEY (organization_id, training_session_id)
        REFERENCES training_session (organization_id, id)
        ON DELETE RESTRICT
    `);

    // 6. Indexes.
    await database.query(`
      CREATE INDEX IF NOT EXISTS learner_profile_organization_idx
      ON learner_profile (organization_id)
    `);
    await database.query(`
      CREATE INDEX IF NOT EXISTS training_template_visibility_idx
      ON training_template (organization_id, scope, status)
    `);
    await database.query(`
      CREATE INDEX IF NOT EXISTS training_template_owner_idx
      ON training_template (organization_id, owner_learner_id)
      WHERE scope = 'personal'
    `);
    await database.query(`
      CREATE INDEX IF NOT EXISTS training_session_learner_status_idx
      ON training_session (organization_id, learner_id, status, started_at DESC)
    `);
    await database.query(`
      CREATE INDEX IF NOT EXISTS training_session_assigned_chain_idx
      ON training_session (organization_id, assignment_id, learner_assignment_id)
      WHERE source_type = 'assigned'
    `);
    // Idempotency is already enforced by the composite UNIQUE above; this partial
    // unique index guarantees a learner has at most one in-flight session.
    await database.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS training_session_one_active_per_learner
      ON training_session (organization_id, learner_id)
      WHERE status IN ('created', 'active')
    `);
    await database.query(`
      CREATE INDEX IF NOT EXISTS conversation_training_session_idx
      ON conversation (organization_id, training_session_id)
    `);
  },

  async down(database): Promise<void> {
    // Reverse order: detach conversation, drop sessions/templates/profiles.
    await database.query(`
      ALTER TABLE conversation DROP CONSTRAINT IF EXISTS conversation_training_session_fk
    `);
    await database.query(`
      DROP INDEX IF EXISTS conversation_training_session_idx
    `);
    await database.query(`
      ALTER TABLE conversation DROP COLUMN IF EXISTS training_session_id
    `);
    // Restore the assigned-only invariants for the legacy schema.
    await database.query(`
      ALTER TABLE conversation ALTER COLUMN training_attempt_id SET NOT NULL
    `);
    await database.query(`
      ALTER TABLE conversation ALTER COLUMN release_snapshot_id SET NOT NULL
    `);

    await database.query('DROP INDEX IF EXISTS training_session_one_active_per_learner');
    await database.query('DROP INDEX IF EXISTS training_session_assigned_chain_idx');
    await database.query('DROP INDEX IF EXISTS training_session_learner_status_idx');
    await database.query('DROP INDEX IF EXISTS training_template_owner_idx');
    await database.query('DROP INDEX IF EXISTS training_template_visibility_idx');
    await database.query('DROP INDEX IF EXISTS learner_profile_organization_idx');

    await database.query('DROP TABLE IF EXISTS training_session CASCADE');
    await database.query('DROP TABLE IF EXISTS training_template CASCADE');
    await database.query('DROP TABLE IF EXISTS learner_profile CASCADE');
  },
};
