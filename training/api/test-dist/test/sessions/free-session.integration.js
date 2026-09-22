import assert from 'node:assert/strict';
import test from 'node:test';
import { Pool } from 'pg';
import { buildDefaultConfig } from '@training/contracts';
import { PersonaService } from '../../src/persona/persona.service.js';
import { SessionService } from '../../src/sessions/session.service.js';
import { TemplateService } from '../../src/templates/template.service.js';
import { deriveLearnerId, EligibilityService } from '../../src/assignments/eligibility.service.js';
import { createPostgresExecutor, MigrationRunner, registeredMigrations } from '../../src/database/migrations/index.js';
import { createPostgresTestSupport } from '../support/postgres.js';
const ORG = '11111111-1111-1111-1111-111111111111';
const PRINCIPAL_ID = 'streamer-001';
function principal(overrides = {}) {
    return {
        principalId: PRINCIPAL_ID,
        organizationId: ORG,
        roles: ['streamer'],
        status: 'active',
        ...overrides,
    };
}
const personaInput = () => ({
    ageCardId: 'young-lady',
    psychologyCardIds: ['hesitant'],
    difficulty: 2,
    productScenarioId: 'anti-aging',
});
async function migrate(uri) {
    const db = createPostgresExecutor(uri);
    await new MigrationRunner(db, registeredMigrations).applyAll();
    await db.close();
}
test('startFreeSession creates a session + conversation + learner profile with no assignment chain and freezes persona', { timeout: 120_000 }, async () => {
    const postgres = await createPostgresTestSupport().start();
    await migrate(postgres.connectionUri);
    const pool = new Pool({ connectionString: postgres.connectionUri });
    const sessions = new SessionService(pool, new PersonaService(), new EligibilityService(), new TemplateService(pool, new PersonaService()));
    try {
        const started = await sessions.startFreeSession(principal(), { persona: personaInput() }, 'free-key-1');
        assert.equal(started.sourceType, 'free');
        assert.ok(started.sessionId);
        assert.ok(started.conversationId);
        const session = await pool.query(`SELECT source_type, learner_id, mode, status, assignment_id, learner_assignment_id,
              training_attempt_id, release_snapshot_id, template_id, persona_snapshot, idempotency_key
       FROM training_session WHERE id = $1`, [started.sessionId]);
        const row = session.rows[0];
        assert.ok(row, 'session persisted');
        assert.equal(row.source_type, 'free');
        assert.equal(row.mode, 'practice', 'defaults to practice mode');
        assert.equal(row.status, 'created');
        assert.equal(row.learner_id, deriveLearnerId(PRINCIPAL_ID), 'maps to the same internal learner id as assigned track');
        assert.equal(row.assignment_id, null);
        assert.equal(row.learner_assignment_id, null);
        assert.equal(row.training_attempt_id, null);
        assert.equal(row.release_snapshot_id, null);
        assert.equal(row.template_id, null);
        assert.equal(row.persona_snapshot.basedOnCard, 'young-lady');
        assert.equal(row.persona_snapshot.conversation.productScenario, '抗老咨询');
        const conversation = await pool.query(`SELECT training_session_id, training_attempt_id, release_snapshot_id, status
       FROM conversation WHERE id = $1`, [started.conversationId]);
        assert.deepEqual(conversation.rows[0], {
            training_session_id: started.sessionId,
            training_attempt_id: null,
            release_snapshot_id: null,
            status: 'created',
        });
        const profile = await pool.query(`SELECT internal_learner_id, external_principal_id, identity_provider FROM learner_profile
       WHERE organization_id = $1 AND external_principal_id = $2`, [ORG, PRINCIPAL_ID]);
        assert.equal(profile.rows.length, 1);
        assert.equal(profile.rows[0]?.internal_learner_id, deriveLearnerId(PRINCIPAL_ID));
        assert.equal(profile.rows[0]?.identity_provider, 'gongzhugou');
    }
    finally {
        await pool.end();
        await postgres.stop();
    }
});
test('startFreeSession replays the same idempotency key and blocks a second distinct session while one is active', { timeout: 120_000 }, async () => {
    const postgres = await createPostgresTestSupport().start();
    await migrate(postgres.connectionUri);
    const pool = new Pool({ connectionString: postgres.connectionUri });
    const sessions = new SessionService(pool, new PersonaService(), new EligibilityService(), new TemplateService(pool, new PersonaService()));
    try {
        const first = await sessions.startFreeSession(principal(), { persona: personaInput() }, 'idem-key');
        const replay = await sessions.startFreeSession(principal(), { persona: personaInput() }, 'idem-key');
        assert.deepEqual(replay, first, 'same key returns the identical session');
        const sessionCount = await pool.query('SELECT COUNT(*)::int AS count FROM training_session');
        assert.equal(sessionCount.rows[0].count, 1, 'replay must not insert a second session');
        const conversationCount = await pool.query('SELECT COUNT(*)::int AS count FROM conversation');
        assert.equal(conversationCount.rows[0].count, 1);
        await assert.rejects(() => sessions.startFreeSession(principal(), { persona: personaInput() }, 'different-key'), /SESSION_ALREADY_ACTIVE/);
    }
    finally {
        await pool.end();
        await postgres.stop();
    }
});
test('startFreeSession allows another session after the previous ends, reuses the profile, and persists exam mode', { timeout: 120_000 }, async () => {
    const postgres = await createPostgresTestSupport().start();
    await migrate(postgres.connectionUri);
    const pool = new Pool({ connectionString: postgres.connectionUri });
    const sessions = new SessionService(pool, new PersonaService(), new EligibilityService(), new TemplateService(pool, new PersonaService()));
    try {
        const first = await sessions.startFreeSession(principal(), { persona: personaInput() }, 'k-1');
        // Simulate the end-of-session transition (implemented in a later step).
        await pool.query(`UPDATE training_session SET status = 'ended' WHERE id = $1`, [first.sessionId]);
        const second = await sessions.startFreeSession(principal(), { persona: personaInput(), mode: 'exam' }, 'k-2');
        assert.notEqual(second.sessionId, first.sessionId);
        const mode = await pool.query(`SELECT mode FROM training_session WHERE id = $1`, [second.sessionId]);
        assert.equal(mode.rows[0]?.mode, 'exam');
        const profileCount = await pool.query('SELECT COUNT(*)::int AS count FROM learner_profile');
        assert.equal(profileCount.rows[0].count, 1, 'learner profile is upserted, not duplicated');
    }
    finally {
        await pool.end();
        await postgres.stop();
    }
});
test('startFreeSession starts from a visible template, records template_id, prefers inline persona, rejects hidden templates', { timeout: 120_000 }, async () => {
    const postgres = await createPostgresTestSupport().start();
    await migrate(postgres.connectionUri);
    const pool = new Pool({ connectionString: postgres.connectionUri });
    const personas = new PersonaService();
    const templates = new TemplateService(pool, personas);
    const sessions = new SessionService(pool, personas, new EligibilityService(), templates);
    try {
        const ownTemplate = await templates.createPersonalTemplate(principal(), {
            title: '我的模板',
            personaConfig: { ...buildDefaultConfig(), name: '模板客户' },
        });
        // Template-only start: freeze the template persona and remember the template.
        const fromTemplate = await sessions.startFreeSession(principal(), { templateId: ownTemplate.id }, 'from-template');
        const fromTemplateRow = await pool.query('SELECT template_id, persona_snapshot FROM training_session WHERE id = $1', [fromTemplate.sessionId]);
        assert.equal(fromTemplateRow.rows[0]?.template_id, ownTemplate.id);
        assert.equal(fromTemplateRow.rows[0]?.persona_snapshot.name, '模板客户');
        await pool.query(`UPDATE training_session SET status = 'ended' WHERE id = $1`, [fromTemplate.sessionId]);
        // Both templateId and inline persona: persona wins, template_id is still recorded.
        const both = await sessions.startFreeSession(principal(), { templateId: ownTemplate.id, persona: personaInput() }, 'both');
        const bothRow = await pool.query('SELECT template_id, persona_snapshot FROM training_session WHERE id = $1', [both.sessionId]);
        assert.equal(bothRow.rows[0]?.template_id, ownTemplate.id);
        assert.equal(bothRow.rows[0]?.persona_snapshot.basedOnCard, 'young-lady', 'inline persona overrides the template persona');
        // Another learner's personal template is invisible -> unavailable, regardless of active session.
        const foreignTemplate = await templates.createPersonalTemplate(principal({ principalId: 'streamer-002' }), { title: '别人的模板', personaConfig: buildDefaultConfig() });
        await assert.rejects(() => sessions.startFreeSession(principal(), { templateId: foreignTemplate.id }, 'hidden'), /FREE_SESSION_TEMPLATE_UNAVAILABLE/);
        // Neither templateId nor persona supplied.
        await assert.rejects(() => sessions.startFreeSession(principal(), {}, 'neither'), /SCHEMA_INVALID/);
    }
    finally {
        await pool.end();
        await postgres.stop();
    }
});
