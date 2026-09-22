import assert from 'node:assert/strict';
import test from 'node:test';
import { Pool } from 'pg';
import { buildDefaultConfig } from '@training/contracts';
import { deriveLearnerId } from '../../src/assignments/eligibility.service.js';
import { PersonaService } from '../../src/persona/persona.service.js';
import { TemplateService } from '../../src/templates/template.service.js';
import { createPostgresExecutor, MigrationRunner, registeredMigrations } from '../../src/database/migrations/index.js';
import { createPostgresTestSupport } from '../support/postgres.js';
const ORG_A = '11111111-1111-1111-1111-111111111111';
const ORG_B = '22222222-2222-2222-2222-222222222222';
const PLATFORM_ORG = '00000000-0000-0000-0000-000000000001';
const LEARNER_A1 = deriveLearnerId('streamer-001');
const LEARNER_A2 = deriveLearnerId('streamer-002');
const LEARNER_B = deriveLearnerId('streamer-b-001');
const T_PLATFORM = 'aaaaaaaa-0000-0000-0000-000000000001';
const T_PLATFORM_ARCHIVED = 'aaaaaaaa-0000-0000-0000-000000000002';
const T_ORG_A = 'bbbbbbbb-0000-0000-0000-000000000001';
const T_ORG_B = 'bbbbbbbb-0000-0000-0000-000000000002';
const T_PERSONAL_A1 = 'cccccccc-0000-0000-0000-000000000001';
const T_PERSONAL_A2 = 'cccccccc-0000-0000-0000-000000000002';
const T_MISSING = 'dddddddd-0000-0000-0000-000000000099';
function principal(principalId, organizationId, roles = ['streamer']) {
    return { principalId, organizationId, roles, status: 'active' };
}
async function seedTemplate(pool, id, organizationId, scope, ownerLearnerId, title, status = 'active') {
    await pool.query(`INSERT INTO training_template (id, organization_id, scope, owner_learner_id, title, persona_config, status)
     VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7)`, [id, organizationId, scope, ownerLearnerId, title, JSON.stringify(buildDefaultConfig()), status]);
}
async function prepareDatabase(uri) {
    const executor = createPostgresExecutor(uri);
    await new MigrationRunner(executor, registeredMigrations).applyAll();
    await executor.close();
    const pool = new Pool({ connectionString: uri });
    // personal templates require the owning learner_profile to exist.
    for (const [learner, org, external] of [
        [LEARNER_A1, ORG_A, 'streamer-001'],
        [LEARNER_A2, ORG_A, 'streamer-002'],
        [LEARNER_B, ORG_B, 'streamer-b-001'],
    ]) {
        await pool.query(`INSERT INTO learner_profile (internal_learner_id, organization_id, external_principal_id, identity_provider)
       VALUES ($1, $2, $3, 'gongzhugou') ON CONFLICT DO NOTHING`, [learner, org, external]);
    }
    await seedTemplate(pool, T_PLATFORM, PLATFORM_ORG, 'platform', null, '官方通用模板');
    await seedTemplate(pool, T_PLATFORM_ARCHIVED, PLATFORM_ORG, 'platform', null, '已下线官方模板', 'archived');
    await seedTemplate(pool, T_ORG_A, ORG_A, 'organization', null, '组织A模板');
    await seedTemplate(pool, T_ORG_B, ORG_B, 'organization', null, '组织B模板');
    await seedTemplate(pool, T_PERSONAL_A1, ORG_A, 'personal', LEARNER_A1, '主播1个人模板');
    await seedTemplate(pool, T_PERSONAL_A2, ORG_A, 'personal', LEARNER_A2, '主播2个人模板');
    return pool;
}
test('learner sees platform + own-organization + own-personal templates only', { timeout: 120_000 }, async () => {
    const postgres = await createPostgresTestSupport().start();
    const pool = await prepareDatabase(postgres.connectionUri);
    const service = new TemplateService(pool, new PersonaService());
    try {
        const a1 = await service.listVisibleTemplates(principal('streamer-001', ORG_A));
        assert.deepEqual(a1.map((item) => item.id).sort(), [T_ORG_A, T_PERSONAL_A1, T_PLATFORM].sort(), 'learner A1 sees platform, org A and only their own personal template');
        const a2 = await service.listVisibleTemplates(principal('streamer-002', ORG_A));
        assert.deepEqual(a2.map((item) => item.id).sort(), [T_ORG_A, T_PERSONAL_A2, T_PLATFORM].sort(), 'learner A2 cannot see A1 personal template');
        const b = await service.listVisibleTemplates(principal('streamer-b-001', ORG_B));
        assert.deepEqual(b.map((item) => item.id).sort(), [T_ORG_B, T_PLATFORM].sort(), 'org B learner cannot see org A templates');
    }
    finally {
        await pool.end();
        await postgres.stop();
    }
});
test('scope filter narrows visible templates and archived templates stay hidden', { timeout: 120_000 }, async () => {
    const postgres = await createPostgresTestSupport().start();
    const pool = await prepareDatabase(postgres.connectionUri);
    const service = new TemplateService(pool, new PersonaService());
    try {
        const personalOnly = await service.listVisibleTemplates(principal('streamer-001', ORG_A), { scope: 'personal' });
        assert.deepEqual(personalOnly.map((item) => item.id), [T_PERSONAL_A1]);
        const platformOnly = await service.listVisibleTemplates(principal('streamer-001', ORG_A), { scope: 'platform' });
        assert.deepEqual(platformOnly.map((item) => item.id), [T_PLATFORM], 'archived platform template is hidden');
    }
    finally {
        await pool.end();
        await postgres.stop();
    }
});
test('resolveVisibleTemplate enforces the same visibility matrix for free-session selection', { timeout: 120_000 }, async () => {
    const postgres = await createPostgresTestSupport().start();
    const pool = await prepareDatabase(postgres.connectionUri);
    const service = new TemplateService(pool, new PersonaService());
    try {
        for (const visible of [T_PLATFORM, T_ORG_A, T_PERSONAL_A1]) {
            const resolved = await service.resolveVisibleTemplate(principal('streamer-001', ORG_A), visible);
            assert.equal(resolved.id, visible);
        }
        for (const hidden of [T_PERSONAL_A2, T_ORG_B, T_PLATFORM_ARCHIVED, T_MISSING]) {
            await assert.rejects(() => service.resolveVisibleTemplate(principal('streamer-001', ORG_A), hidden), /FREE_SESSION_TEMPLATE_UNAVAILABLE/);
        }
    }
    finally {
        await pool.end();
        await postgres.stop();
    }
});
test('createPersonalTemplate persists an owned personal template and rejects invalid persona or duplicate title', { timeout: 120_000 }, async () => {
    const postgres = await createPostgresTestSupport().start();
    const pool = await prepareDatabase(postgres.connectionUri);
    const service = new TemplateService(pool, new PersonaService());
    try {
        const created = await service.createPersonalTemplate(principal('streamer-001', ORG_A), {
            title: '我保存的画像',
            personaConfig: buildDefaultConfig(),
        });
        assert.equal(created.scope, 'personal');
        assert.equal(created.ownerLearnerId, LEARNER_A1);
        assert.equal(created.organizationId, ORG_A);
        assert.equal(created.status, 'active');
        const persisted = await pool.query('SELECT scope, owner_learner_id FROM training_template WHERE id = $1', [created.id]);
        assert.equal(persisted.rows[0]?.scope, 'personal');
        assert.equal(persisted.rows[0]?.owner_learner_id, LEARNER_A1);
        await assert.rejects(() => service.createPersonalTemplate(principal('streamer-001', ORG_A), { title: 'bad', personaConfig: { not: 'a persona' } }), /PERSONA_CONFIG_INVALID/);
        await assert.rejects(() => service.createPersonalTemplate(principal('streamer-001', ORG_A), { title: '我保存的画像', personaConfig: buildDefaultConfig() }), /TEMPLATE_TITLE_CONFLICT/);
    }
    finally {
        await pool.end();
        await postgres.stop();
    }
});
test('createOrganizationTemplate persists an owner-less organization template for admins', { timeout: 120_000 }, async () => {
    const postgres = await createPostgresTestSupport().start();
    const pool = await prepareDatabase(postgres.connectionUri);
    const service = new TemplateService(pool, new PersonaService());
    try {
        const created = await service.createOrganizationTemplate(principal('admin-001', ORG_A, ['admin']), {
            title: '组织主推场景',
            personaConfig: buildDefaultConfig(),
        });
        assert.equal(created.scope, 'organization');
        assert.equal(created.ownerLearnerId, null);
        assert.equal(created.organizationId, ORG_A);
        // It becomes visible to every learner in the organization, not other orgs.
        const a1 = await service.listVisibleTemplates(principal('streamer-001', ORG_A));
        assert.ok(a1.some((item) => item.id === created.id));
        const b = await service.listVisibleTemplates(principal('streamer-b-001', ORG_B));
        assert.ok(!b.some((item) => item.id === created.id));
    }
    finally {
        await pool.end();
        await postgres.stop();
    }
});
