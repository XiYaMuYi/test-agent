export const workerEvaluationLeaseMigration = {
    id: '0003_worker_evaluation_lease',
    description: 'Add recoverable, fenced leases to evaluation outbox claims and jobs.',
    async up(database) {
        await database.query(`
      ALTER TABLE outbox_event
        ADD COLUMN claimed_at TIMESTAMPTZ NULL,
        ADD COLUMN lease_expires_at TIMESTAMPTZ NULL,
        ADD COLUMN claim_token UUID NULL
    `);
        await database.query(`
      ALTER TABLE evaluation_job
        ADD COLUMN claimed_at TIMESTAMPTZ NULL,
        ADD COLUMN lease_expires_at TIMESTAMPTZ NULL,
        ADD COLUMN claim_token UUID NULL
    `);
        await database.query(`
      CREATE FUNCTION ensure_outbox_processing_lease()
      RETURNS trigger
      LANGUAGE plpgsql
      AS $$
      BEGIN
        IF NEW.status = 'processing' THEN
          IF TG_OP = 'INSERT'
            OR NEW.claimed_at IS NULL
            OR NEW.lease_expires_at IS NULL
            OR NEW.claim_token IS NULL
            OR (
              OLD.status <> 'processing'
              AND NEW.claimed_at IS NOT DISTINCT FROM OLD.claimed_at
              AND NEW.lease_expires_at IS NOT DISTINCT FROM OLD.lease_expires_at
              AND NEW.claim_token IS NOT DISTINCT FROM OLD.claim_token
            )
          THEN
            NEW.claimed_at := clock_timestamp();
            NEW.lease_expires_at := NEW.claimed_at + INTERVAL '60 seconds';
            NEW.claim_token := NEW.id;
          END IF;
        END IF;
        RETURN NEW;
      END;
      $$
    `);
        await database.query(`
      CREATE TRIGGER outbox_processing_lease_trigger
      BEFORE INSERT OR UPDATE ON outbox_event
      FOR EACH ROW
      EXECUTE FUNCTION ensure_outbox_processing_lease()
    `);
        await database.query(`
      CREATE FUNCTION ensure_evaluation_job_running_lease()
      RETURNS trigger
      LANGUAGE plpgsql
      AS $$
      BEGIN
        IF NEW.status = 'running' THEN
          IF TG_OP = 'INSERT'
            OR NEW.claimed_at IS NULL
            OR NEW.lease_expires_at IS NULL
            OR NEW.claim_token IS NULL
            OR (
              OLD.status <> 'running'
              AND NEW.claimed_at IS NOT DISTINCT FROM OLD.claimed_at
              AND NEW.lease_expires_at IS NOT DISTINCT FROM OLD.lease_expires_at
              AND NEW.claim_token IS NOT DISTINCT FROM OLD.claim_token
            )
          THEN
            NEW.claimed_at := clock_timestamp();
            NEW.lease_expires_at := NEW.claimed_at + INTERVAL '60 seconds';
            NEW.claim_token := NEW.id;
          END IF;
        END IF;
        RETURN NEW;
      END;
      $$
    `);
        await database.query(`
      CREATE TRIGGER evaluation_job_running_lease_trigger
      BEFORE INSERT OR UPDATE ON evaluation_job
      FOR EACH ROW
      EXECUTE FUNCTION ensure_evaluation_job_running_lease()
    `);
        await database.query(`
      UPDATE outbox_event
      SET claimed_at = clock_timestamp(),
          lease_expires_at = clock_timestamp() + INTERVAL '60 seconds',
          claim_token = id
      WHERE status = 'processing'
    `);
        await database.query(`
      UPDATE evaluation_job
      SET claimed_at = clock_timestamp(),
          lease_expires_at = clock_timestamp() + INTERVAL '60 seconds',
          claim_token = id
      WHERE status = 'running'
    `);
        await database.query(`
      ALTER TABLE outbox_event
        ADD CONSTRAINT outbox_event_processing_has_lease
        CHECK (
          status <> 'processing'
          OR (claimed_at IS NOT NULL AND lease_expires_at IS NOT NULL AND claim_token IS NOT NULL)
        )
    `);
        await database.query(`
      ALTER TABLE evaluation_job
        ADD CONSTRAINT evaluation_job_running_has_lease
        CHECK (
          status <> 'running'
          OR (claimed_at IS NOT NULL AND lease_expires_at IS NOT NULL AND claim_token IS NOT NULL)
        )
    `);
        await database.query(`
      CREATE INDEX outbox_evaluation_claim_lease_idx
      ON outbox_event (status, lease_expires_at, created_at)
      WHERE event_type = 'evaluation.requested' AND status IN ('pending', 'processing')
    `);
        await database.query(`
      CREATE INDEX evaluation_job_claim_lease_idx
      ON evaluation_job (organization_id, status, lease_expires_at)
      WHERE status IN ('queued', 'retryable_failed', 'running')
    `);
        await database.query(`
      UPDATE outbox_event
      SET claimed_at = clock_timestamp(),
          lease_expires_at = clock_timestamp() + INTERVAL '60 seconds'
      WHERE status = 'processing'
    `);
        await database.query(`
      UPDATE evaluation_job
      SET claimed_at = clock_timestamp(),
          lease_expires_at = clock_timestamp() + INTERVAL '60 seconds'
      WHERE status = 'running'
    `);
    },
    async down(database) {
        await database.query('DROP INDEX IF EXISTS evaluation_job_claim_lease_idx');
        await database.query('DROP INDEX IF EXISTS outbox_evaluation_claim_lease_idx');
        await database.query('ALTER TABLE evaluation_job DROP CONSTRAINT IF EXISTS evaluation_job_running_has_lease');
        await database.query('ALTER TABLE outbox_event DROP CONSTRAINT IF EXISTS outbox_event_processing_has_lease');
        await database.query('DROP TRIGGER IF EXISTS evaluation_job_running_lease_trigger ON evaluation_job');
        await database.query('DROP FUNCTION IF EXISTS ensure_evaluation_job_running_lease()');
        await database.query('DROP TRIGGER IF EXISTS outbox_processing_lease_trigger ON outbox_event');
        await database.query('DROP FUNCTION IF EXISTS ensure_outbox_processing_lease()');
        await database.query('ALTER TABLE evaluation_job DROP COLUMN IF EXISTS claim_token');
        await database.query('ALTER TABLE evaluation_job DROP COLUMN IF EXISTS lease_expires_at');
        await database.query('ALTER TABLE evaluation_job DROP COLUMN IF EXISTS claimed_at');
        await database.query('ALTER TABLE outbox_event DROP COLUMN IF EXISTS claim_token');
        await database.query('ALTER TABLE outbox_event DROP COLUMN IF EXISTS lease_expires_at');
        await database.query('ALTER TABLE outbox_event DROP COLUMN IF EXISTS claimed_at');
    },
};
