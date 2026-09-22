import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import test from 'node:test';
import { Pool } from 'pg';
import { buildDefaultConfig } from '@training/contracts';
import { PersonaService } from '../../src/persona/persona.service.js';
import { SessionService } from '../../src/sessions/session.service.js';
import { TemplateService } from '../../src/templates/template.service.js';
import { AssignmentProblem, deriveLearnerId, EligibilityService } from '../../src/assignments/eligibility.service.js';
import { createPostgresExecutor, MigrationRunner, registeredMigrations } from '../../src/database/migrations/index.js';
import { createPostgresTestSupport } from '../support/postgres.js';
const ORG = '11111111-1111-1111-1111-111111111111';
const LEARNER = deriveLearnerId('streamer-001');
function principal() {
    return { principalId: 'streamer-001', organizationId: ORG, roles: ['streamer'], status: 'active' };
}
const freePersona = () => ({
    ageCardId: 'young-lady',
    psychologyCardIds: [],
    difficulty: 2,
    productScenarioId: 'anti-aging',
});
async function seedAssignment(pool, options = {}) {
    const draftId = crypto.randomUUID();
    const snapshotId = crypto.randomUUID();
    const assignmentId = crypto.randomUUID();
    const laId = crypto.randomUUID();
    await pool.query(`INSERT INTO scenario_draft (id, organization_id, title, payload)
     VALUES ($1, $2, 'd', '{"title":"d","knowledgeVersions":["k@v1"],"scoringRules":["r1"],"agentConfig":{}}'::jsonb)`, [draftId, ORG]);
    const snapshot = { schemaVersion: 'release-snapshot/v1', ...(options.snapshotPersona === undefined ? {} : { personaConfig: options.snapshotPersona }) };
    await pool.query(`INSERT INTO release_snapshot (id, scenario_draft_id, organization_id, schema_version, snapshot)
     VALUES ($1, $2, $3, 'release-snapshot/v1', $4::jsonb)`, [snapshotId, draftId, ORG, JSON.stringify(snapshot)]);
    await pool.query(`INSERT INTO assignment (id, organization_id, release_snapshot_id, name, status, starts_at, ends_at, max_attempts, target_principal_ids)
     VALUES ($1, $2, $3, 'a', $4, $5, $6, $7, '[]'::jsonb)`, [
        assignmentId, ORG, snapshotId,
        options.status ?? 'active',
        new Date(Date.now() - 60_000),
        options.endsAt ?? new Date(Date.now() + 3_600_000),
        options.maxAttempts ?? 2,
    ]);
    await pool.query(`INSERT INTO learner_assignment (id, organization_id, assignment_id, learner_id, state, total_attempts, active_attempt_id)
     VALUES ($1, $2, $3, $4, $5, $6, $7)`, [laId, ORG, assignmentId, LEARNER, options.learnerState ?? 'eligible', options.totalAttempts ?? 0, options.activeAttemptId ?? null]);
    return { assignmentId, snapshotId, laId };
}
async function newService(uri) {
    const db = createPostgresExecutor(uri);
    await new MigrationRunner(db, registeredMigrations).applyAll();
    await db.close();
    const pool = new Pool({ connectionString: uri });
    return { pool, sessions: new SessionService(pool, new PersonaService(), new EligibilityService(), new TemplateService(pool, new PersonaService())) };
}
test('startAssignedSession creates attempt + assigned session + conversation in one transaction and is idempotent', { timeout: 120_000 }, async () => {
    const postgres = await createPostgresTestSupport().start();
    const { pool, sessions } = await newService(postgres.connectionUri);
    try {
        const { assignmentId, snapshotId, laId } = await seedAssignment(pool);
        const started = await sessions.startAssignedSession(principal(), assignmentId, 'assigned-key-1');
        assert.ok(started.sessionId);
        assert.ok(started.attemptId);
        assert.ok(started.conversationId);
        const session = await pool.query(`SELECT source_type, status, assignment_id, learner_assignment_id, training_attempt_id,
              release_snapshot_id, learner_id, persona_snapshot
       FROM training_session WHERE id = $1`, [started.sessionId]);
        const srow = session.rows[0];
        assert.equal(srow?.source_type, 'assigned');
        assert.equal(srow?.status, 'created');
        assert.equal(srow?.assignment_id, assignmentId);
        assert.equal(srow?.learner_assignment_id, laId);
        assert.equal(srow?.training_attempt_id, started.attemptId);
        assert.equal(srow?.release_snapshot_id, snapshotId);
        assert.equal(srow?.learner_id, LEARNER);
        assert.ok(srow?.persona_snapshot && typeof srow.persona_snapshot === 'object', 'assigned session carries a persona snapshot');
        const conversation = await pool.query(`SELECT training_attempt_id, release_snapshot_id, training_session_id FROM conversation WHERE id = $1`, [started.conversationId]);
        assert.deepEqual(conversation.rows[0], {
            training_attempt_id: started.attemptId,
            release_snapshot_id: snapshotId,
            training_session_id: started.sessionId,
        }, 'conversation is bound to the legacy attempt chain AND the new session root');
        const la = await pool.query(`SELECT active_attempt_id, state FROM learner_assignment WHERE id = $1`, [laId]);
        assert.equal(la.rows[0]?.active_attempt_id, started.attemptId);
        assert.equal(la.rows[0]?.state, 'active');
        const profile = await pool.query('SELECT 1 FROM learner_profile WHERE organization_id = $1 AND internal_learner_id = $2', [ORG, LEARNER]);
        assert.equal(profile.rows.length, 1);
        // Idempotent replay: same key → identical ids, no duplicate rows.
        const replay = await sessions.startAssignedSession(principal(), assignmentId, 'assigned-key-1');
        assert.deepEqual(replay, started);
        for (const table of ['training_session', 'training_attempt', 'conversation']) {
            const count = await pool.query(`SELECT COUNT(*)::int AS count FROM ${table}`);
            assert.equal(count.rows[0].count, 1, `${table} not duplicated on replay`);
        }
    }
    finally {
        await pool.end();
        await postgres.stop();
    }
});
test('an in-flight free session blocks an assigned start until it ends (global single-active across tracks)', { timeout: 120_000 }, async () => {
    const postgres = await createPostgresTestSupport().start();
    const { pool, sessions } = await newService(postgres.connectionUri);
    try {
        const { assignmentId } = await seedAssignment(pool);
        await sessions.startFreeSession(principal(), { persona: freePersona() }, 'free-active');
        await assert.rejects(() => sessions.startAssignedSession(principal(), assignmentId, 'assigned-while-free'), (error) => error instanceof AssignmentProblem
            && error.getResponse().code === 'ATTEMPT_ALREADY_ACTIVE');
        await pool.query(`UPDATE training_session SET status = 'ended' WHERE source_type = 'free'`);
        const started = await sessions.startAssignedSession(principal(), assignmentId, 'assigned-after-free');
        assert.ok(started.attemptId);
    }
    finally {
        await pool.end();
        await postgres.stop();
    }
});
test('startAssignedSession freezes the task persona from the release snapshot, defaulting when absent', { timeout: 120_000 }, async () => {
    const postgres = await createPostgresTestSupport().start();
    const { pool, sessions } = await newService(postgres.connectionUri);
    try {
        const withTaskPersona = await seedAssignment(pool, {
            snapshotPersona: { ...buildDefaultConfig(), name: '任务指定客户' },
        });
        const first = await sessions.startAssignedSession(principal(), withTaskPersona.assignmentId, 'task-persona');
        const taskRow = await pool.query('SELECT persona_snapshot FROM training_session WHERE id = $1', [first.sessionId]);
        assert.equal(taskRow.rows[0]?.persona_snapshot.name, '任务指定客户', 'assigned session uses the persona carried by the task snapshot');
        await pool.query(`UPDATE training_session SET status = 'ended' WHERE id = $1`, [first.sessionId]);
        const withoutPersona = await seedAssignment(pool);
        const second = await sessions.startAssignedSession(principal(), withoutPersona.assignmentId, 'default-persona');
        const defaultRow = await pool.query('SELECT persona_snapshot FROM training_session WHERE id = $1', [second.sessionId]);
        assert.equal(defaultRow.rows[0]?.persona_snapshot.basedOnCard, buildDefaultConfig().basedOnCard, 'falls back to the valid default persona');
    }
    finally {
        await pool.end();
        await postgres.stop();
    }
});
