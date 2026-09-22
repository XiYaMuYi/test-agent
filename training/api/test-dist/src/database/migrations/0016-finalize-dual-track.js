/**
 * Finalize the C-first dual-track expand-and-contract migration.
 *
 * 0015 introduced conversation.training_session_id as NULLABLE so legacy assigned
 * write paths kept working while the service layer moved onto training_session
 * (steps T3–T7). By now every conversation creation populates the session root.
 * This finalize migration:
 *   1. backfills any straggler assigned conversations left by the transition window,
 *   2. fails loudly if an unlinkable orphan conversation (no session, no attempt) remains,
 *   3. enforces conversation.training_session_id NOT NULL.
 *
 * Free-track columns training_attempt_id/release_snapshot_id stay nullable forever.
 * Contract: docs/architecture/contracts/c-first-dual-track-contract.md §10.
 */
export const finalizeDualTrackMigration = {
    id: '0016_finalize_dual_track',
    description: 'Backfill remaining conversation.training_session_id links and enforce NOT NULL to finalize the dual-track contract.',
    async up(database) {
        // 1a. Legacy learners still need a profile before a session can reference them.
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
        // 1b. Derive an assigned session for every legacy conversation still missing one.
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
          'migration-0016:conversation:' || c.id::text,
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
        // 1c. Link the backfilled sessions to their conversations.
        await database.query(`
      UPDATE conversation c
      SET training_session_id = ts.id
      FROM training_session ts
      WHERE ts.organization_id = c.organization_id
        AND ts.training_attempt_id = c.training_attempt_id
        AND c.training_session_id IS NULL
    `);
        // 2. Fail loudly on unlinkable orphans (no session root and no assigned chain).
        //    SET NOT NULL below would otherwise fail opaquely; surface the row count for
        //    manual triage instead. The whole migration runs in one transaction and rolls back.
        const orphanResult = await database.query(`
      SELECT COUNT(*)::text AS count FROM conversation WHERE training_session_id IS NULL
    `);
        const remaining = Number(orphanResult.rows[0]?.count ?? '0');
        if (remaining > 0) {
            throw new Error(`Cannot finalize dual-track: ${remaining} orphan conversation row(s) still lack training_session_id and have no assigned chain to backfill from; triage manually before re-running.`);
        }
        // 3. Contract: every conversation now belongs to exactly one training_session root.
        await database.query(`
      ALTER TABLE conversation ALTER COLUMN training_session_id SET NOT NULL
    `);
    },
    async down(database) {
        // Relax only the NOT NULL contract; backfilled rows/sessions are retained.
        await database.query(`
      ALTER TABLE conversation ALTER COLUMN training_session_id DROP NOT NULL
    `);
    },
};
