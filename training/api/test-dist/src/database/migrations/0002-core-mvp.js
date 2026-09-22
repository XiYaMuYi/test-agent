const TABLES = [
    'conversation_message',
    'conversation',
    'training_attempt',
    'learner_assignment',
    'assignment',
    'evaluation_report',
    'evaluation_job',
    'outbox_event',
    'release_snapshot',
    'scenario_draft',
];
export const coreMvpSchemaMigration = {
    id: '0002_core_mvp_schema',
    description: 'Create the production-shaped MVP fact model and constraints.',
    async up(database) {
        await database.query(`
      CREATE TABLE IF NOT EXISTS scenario_draft (
        id UUID PRIMARY KEY,
        organization_id UUID NOT NULL,
        title TEXT NOT NULL,
        payload JSONB NOT NULL DEFAULT '{}'::jsonb,
        version INTEGER NOT NULL DEFAULT 1,
        created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
        UNIQUE (organization_id, id)
      )
    `);
        await database.query(`
      CREATE TABLE IF NOT EXISTS release_snapshot (
        id UUID PRIMARY KEY,
        scenario_draft_id UUID NOT NULL,
        organization_id UUID NOT NULL,
        schema_version TEXT NOT NULL,
        snapshot JSONB NOT NULL,
        is_active BOOLEAN NOT NULL DEFAULT TRUE,
        created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
        immutable_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
        UNIQUE (organization_id, id),
        FOREIGN KEY (organization_id, scenario_draft_id)
          REFERENCES scenario_draft (organization_id, id)
          ON DELETE RESTRICT
      )
    `);
        await database.query(`
      CREATE TABLE IF NOT EXISTS assignment (
        id UUID PRIMARY KEY,
        organization_id UUID NOT NULL,
        release_snapshot_id UUID NOT NULL,
        name TEXT NOT NULL,
        status TEXT NOT NULL CHECK (status IN ('draft', 'active', 'paused', 'ended')),
        starts_at TIMESTAMPTZ NOT NULL,
        ends_at TIMESTAMPTZ NOT NULL,
        max_attempts INTEGER NOT NULL DEFAULT 1 CHECK (max_attempts > 0),
        target_principal_ids JSONB NOT NULL DEFAULT '[]'::jsonb,
        created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
        UNIQUE (organization_id, id),
        FOREIGN KEY (organization_id, release_snapshot_id)
          REFERENCES release_snapshot (organization_id, id)
          ON DELETE RESTRICT,
        CHECK (ends_at > starts_at)
      )
    `);
        await database.query(`
      CREATE TABLE IF NOT EXISTS learner_assignment (
        id UUID PRIMARY KEY,
        organization_id UUID NOT NULL,
        assignment_id UUID NOT NULL,
        learner_id UUID NOT NULL,
        state TEXT NOT NULL CHECK (state IN ('eligible', 'created', 'active', 'completed', 'expired', 'blocked')),
        total_attempts INTEGER NOT NULL DEFAULT 0 CHECK (total_attempts >= 0),
        active_attempt_id UUID NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
        UNIQUE (organization_id, id),
        UNIQUE (organization_id, assignment_id, learner_id),
        FOREIGN KEY (organization_id, assignment_id)
          REFERENCES assignment (organization_id, id)
          ON DELETE RESTRICT
      )
    `);
        await database.query(`
      CREATE TABLE IF NOT EXISTS training_attempt (
        id UUID PRIMARY KEY,
        organization_id UUID NOT NULL,
        learner_assignment_id UUID NOT NULL,
        idempotency_key TEXT NOT NULL,
        status TEXT NOT NULL CHECK (status IN ('created', 'active', 'awaiting_model', 'completed', 'ended', 'failed')),
        started_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
        finished_at TIMESTAMPTZ NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
        UNIQUE (organization_id, id),
        UNIQUE (organization_id, idempotency_key),
        FOREIGN KEY (organization_id, learner_assignment_id)
          REFERENCES learner_assignment (organization_id, id)
          ON DELETE RESTRICT
      )
    `);
        await database.query(`
      CREATE TABLE IF NOT EXISTS conversation (
        id UUID PRIMARY KEY,
        organization_id UUID NOT NULL,
        training_attempt_id UUID NOT NULL,
        release_snapshot_id UUID NOT NULL,
        status TEXT NOT NULL CHECK (status IN ('created', 'active', 'awaiting_model', 'completed', 'ended', 'failed')),
        version INTEGER NOT NULL DEFAULT 1,
        client_message_id TEXT NULL,
        last_sequence INTEGER NOT NULL DEFAULT 0,
        created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
        UNIQUE (organization_id, id),
        UNIQUE (organization_id, training_attempt_id),
        FOREIGN KEY (organization_id, training_attempt_id)
          REFERENCES training_attempt (organization_id, id)
          ON DELETE RESTRICT,
        FOREIGN KEY (organization_id, release_snapshot_id)
          REFERENCES release_snapshot (organization_id, id)
          ON DELETE RESTRICT
      )
    `);
        await database.query(`
      CREATE TABLE IF NOT EXISTS conversation_message (
        id UUID PRIMARY KEY,
        organization_id UUID NOT NULL,
        conversation_id UUID NOT NULL,
        sequence INTEGER NOT NULL,
        client_message_id TEXT NOT NULL,
        role TEXT NOT NULL CHECK (role IN ('learner', 'assistant', 'system')),
        content TEXT NOT NULL,
        request_hash TEXT NOT NULL,
        response_hash TEXT NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
        UNIQUE (conversation_id, sequence),
        UNIQUE (conversation_id, client_message_id),
        FOREIGN KEY (organization_id, conversation_id)
          REFERENCES conversation (organization_id, id)
          ON DELETE RESTRICT
      )
    `);
        await database.query(`
      CREATE TABLE IF NOT EXISTS evaluation_job (
        id UUID PRIMARY KEY,
        organization_id UUID NOT NULL,
        conversation_id UUID NOT NULL,
        status TEXT NOT NULL CHECK (status IN ('queued', 'running', 'succeeded', 'retryable_failed', 'failed')),
        attempt_count INTEGER NOT NULL DEFAULT 0 CHECK (attempt_count >= 0),
        created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
        UNIQUE (organization_id, id),
        UNIQUE (organization_id, conversation_id),
        FOREIGN KEY (organization_id, conversation_id)
          REFERENCES conversation (organization_id, id)
          ON DELETE RESTRICT
      )
    `);
        await database.query(`
      CREATE TABLE IF NOT EXISTS evaluation_report (
        id UUID PRIMARY KEY,
        organization_id UUID NOT NULL,
        conversation_id UUID NOT NULL,
        evaluation_job_id UUID NOT NULL,
        status TEXT NOT NULL CHECK (status IN ('draft', 'published', 'failed')),
        report JSONB NOT NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
        UNIQUE (organization_id, id),
        UNIQUE (organization_id, conversation_id),
        UNIQUE (organization_id, evaluation_job_id),
        FOREIGN KEY (organization_id, conversation_id)
          REFERENCES conversation (organization_id, id)
          ON DELETE RESTRICT,
        FOREIGN KEY (organization_id, evaluation_job_id)
          REFERENCES evaluation_job (organization_id, id)
          ON DELETE RESTRICT
      )
    `);
        await database.query(`
      CREATE TABLE IF NOT EXISTS outbox_event (
        id UUID PRIMARY KEY,
        organization_id UUID NOT NULL,
        aggregate_type TEXT NOT NULL,
        aggregate_id UUID NOT NULL,
        event_type TEXT NOT NULL,
        payload JSONB NOT NULL,
        deduplication_key TEXT NOT NULL,
        status TEXT NOT NULL CHECK (status IN ('pending', 'processing', 'published', 'failed')),
        created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
        processed_at TIMESTAMPTZ NULL,
        UNIQUE (organization_id, id),
        UNIQUE (deduplication_key)
      )
    `);
        await database.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS training_attempt_one_active_per_learner_assignment
      ON training_attempt (learner_assignment_id)
      WHERE status IN ('created', 'active', 'awaiting_model')
    `);
        await database.query(`
      CREATE INDEX IF NOT EXISTS training_attempt_learner_assignment_status_idx
      ON training_attempt (learner_assignment_id, status)
    `);
        await database.query(`
      CREATE INDEX IF NOT EXISTS conversation_status_version_idx
      ON conversation (status, version)
    `);
        await database.query(`
      CREATE INDEX IF NOT EXISTS conversation_message_conversation_sequence_idx
      ON conversation_message (conversation_id, sequence)
    `);
        await database.query(`
      CREATE INDEX IF NOT EXISTS outbox_event_status_created_at_idx
      ON outbox_event (status, created_at)
    `);
        await database.query(`
      CREATE OR REPLACE FUNCTION prevent_immutable_release_snapshot_changes()
      RETURNS trigger
      LANGUAGE plpgsql
      AS $$
      BEGIN
        RAISE EXCEPTION 'release_snapshot is immutable';
      END;
      $$
    `);
        await database.query(`
      CREATE TRIGGER release_snapshot_immutable_trigger
      BEFORE UPDATE OR DELETE ON release_snapshot
      FOR EACH ROW
      EXECUTE FUNCTION prevent_immutable_release_snapshot_changes()
    `);
        await database.query(`
      CREATE OR REPLACE FUNCTION prevent_published_report_changes()
      RETURNS trigger
      LANGUAGE plpgsql
      AS $$
      BEGIN
        IF TG_OP = 'DELETE' THEN
          IF OLD.status = 'published' THEN
            RAISE EXCEPTION 'evaluation_report is immutable once published';
          END IF;
          RETURN OLD;
        END IF;

        IF OLD.status = 'published' THEN
          RAISE EXCEPTION 'evaluation_report is immutable once published';
        END IF;

        RETURN NEW;
      END;
      $$
    `);
        await database.query(`
      CREATE TRIGGER evaluation_report_immutable_trigger
      BEFORE UPDATE OR DELETE ON evaluation_report
      FOR EACH ROW
      EXECUTE FUNCTION prevent_published_report_changes()
    `);
    },
    async down(database) {
        await database.query('DROP TRIGGER IF EXISTS evaluation_report_immutable_trigger ON evaluation_report');
        await database.query('DROP FUNCTION IF EXISTS prevent_published_report_changes()');
        await database.query('DROP TRIGGER IF EXISTS release_snapshot_immutable_trigger ON release_snapshot');
        await database.query('DROP FUNCTION IF EXISTS prevent_immutable_release_snapshot_changes()');
        for (const table of TABLES) {
            await database.query(`DROP TABLE IF EXISTS ${table} CASCADE`);
        }
    },
};
