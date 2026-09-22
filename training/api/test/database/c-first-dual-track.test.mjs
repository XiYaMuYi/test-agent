import assert from 'node:assert/strict';
import test from 'node:test';

import {
  cFirstDualTrackMigration,
  registeredMigrations,
  personaTemplatesMigration,
} from '../../dist/database/migrations/index.js';

class RecordingExecutor {
  statements = [];

  async query(statement) {
    this.statements.push(statement.replace(/\s+/g, ' ').trim());
    return { rows: [] };
  }
}

function tableCreateIndex(statements, table) {
  return statements.findIndex((s) => new RegExp(`CREATE TABLE IF NOT EXISTS ${table}\\b`, 'i').test(s));
}

test('0015 migration exposes stable id and reversible hooks', () => {
  assert.equal(cFirstDualTrackMigration.id, '0015_c_first_dual_track');
  assert.equal(typeof cFirstDualTrackMigration.up, 'function');
  assert.equal(typeof cFirstDualTrackMigration.down, 'function');
});

test('0015 is registered after the reserved 0014 no-op', () => {
  const ids = registeredMigrations.map((m) => m.id);
  assert.ok(ids.includes('0014_persona_templates'));
  assert.ok(ids.includes('0015_c_first_dual_track'));
  assert.ok(ids.indexOf('0014_persona_templates') < ids.indexOf('0015_c_first_dual_track'));
  // 0014 stays an explicit no-op.
  assert.equal(personaTemplatesMigration.id, '0014_persona_templates');
});

test('0015 up creates tables in dependency order: profile → template → session → conversation', async () => {
  const db = new RecordingExecutor();
  await cFirstDualTrackMigration.up(db);
  const s = db.statements;

  const profile = tableCreateIndex(s, 'learner_profile');
  const template = tableCreateIndex(s, 'training_template');
  const session = tableCreateIndex(s, 'training_session');
  const alterConversation = s.findIndex((x) => x.includes('ALTER TABLE conversation'));

  assert.ok(profile >= 0, 'learner_profile created');
  assert.ok(template > profile, 'training_template after profile');
  assert.ok(session > template, 'training_session after template');
  assert.ok(alterConversation > session, 'conversation altered after session tables exist');
});

test('0015 up defines the external→internal mapping and dual-track consistency constraints', async () => {
  const db = new RecordingExecutor();
  await cFirstDualTrackMigration.up(db);
  const all = db.statements.join('\n');

  assert.match(all, /UNIQUE \(identity_provider, external_principal_id\)/i);
  assert.match(all, /source_type TEXT NOT NULL CHECK \(source_type IN \('free', 'assigned'\)\)/i);
  // free track must not carry the assigned chain
  assert.match(all, /source_type = 'free'[\s\S]*assignment_id IS NULL/i);
  // assigned track must carry the full chain
  assert.match(all, /source_type = 'assigned'[\s\S]*training_attempt_id IS NOT NULL/i);
  // three-layer template scope
  assert.match(all, /scope IN \('platform', 'organization', 'personal'\)/i);
  // personal template ownership consistency
  assert.match(all, /scope = 'personal' AND owner_learner_id IS NOT NULL/i);
});

test('0015 up relaxes assigned-only NOT NULLs, backfills, then enforces session NOT NULL', async () => {
  const db = new RecordingExecutor();
  await cFirstDualTrackMigration.up(db);
  const s = db.statements;
  const all = s.join('\n');

  assert.ok(s.some((x) => /ADD COLUMN IF NOT EXISTS training_session_id UUID/i.test(x)));
  assert.ok(s.some((x) => /ALTER COLUMN training_attempt_id DROP NOT NULL/i.test(x)));
  assert.ok(s.some((x) => /ALTER COLUMN release_snapshot_id DROP NOT NULL/i.test(x)));
  // legacy learners get a profile before sessions reference them (composite FK)
  const profileBackfill = s.findIndex((x) => /INSERT INTO learner_profile[\s\S]*FROM learner_assignment/i.test(x));
  const sessionBackfill = s.findIndex((x) => /INSERT INTO training_session[\s\S]*FROM conversation c/i.test(x));
  assert.ok(profileBackfill >= 0, 'learner_profile backfilled from legacy eligibility rows');
  assert.ok(sessionBackfill > profileBackfill, 'profile backfill precedes session backfill');
  // backfill derives assigned sessions from legacy conversation→attempt→eligibility
  assert.match(all, /INSERT INTO training_session[\s\S]*FROM conversation c[\s\S]*JOIN training_attempt/i);
  // expand-and-contract: 0015 keeps the new column nullable; a later finalize migration enforces NOT NULL
  assert.ok(!s.some((x) => /ALTER COLUMN training_session_id SET NOT NULL/i.test(x)), '0015 must not force session NOT NULL yet');
  // composite FK keeps organization isolation
  assert.match(all, /CONSTRAINT conversation_training_session_fk[\s\S]*FOREIGN KEY \(organization_id, training_session_id\)/i);
});

test('0015 up adds idempotency and single-active-session indexes', async () => {
  const db = new RecordingExecutor();
  await cFirstDualTrackMigration.up(db);
  const all = db.statements.join('\n');

  assert.match(all, /UNIQUE \(organization_id, learner_id, idempotency_key\)/i);
  assert.match(all, /CREATE UNIQUE INDEX IF NOT EXISTS training_session_one_active_per_learner[\s\S]*WHERE status IN \('created', 'active'\)/i);
  assert.match(all, /training_template_visibility_idx/i);
});

test('0015 down detaches conversation, restores legacy NOT NULLs, and drops new tables', async () => {
  const db = new RecordingExecutor();
  await cFirstDualTrackMigration.down(db);
  const s = db.statements;
  const all = s.join('\n');

  assert.ok(s.some((x) => /DROP CONSTRAINT IF EXISTS conversation_training_session_fk/i.test(x)));
  assert.ok(s.some((x) => /DROP COLUMN IF EXISTS training_session_id/i.test(x)));
  assert.ok(s.some((x) => /ALTER COLUMN training_attempt_id SET NOT NULL/i.test(x)));
  assert.ok(s.some((x) => /ALTER COLUMN release_snapshot_id SET NOT NULL/i.test(x)));

  const dropSession = s.findIndex((x) => /DROP TABLE IF EXISTS training_session CASCADE/i.test(x));
  const dropTemplate = s.findIndex((x) => /DROP TABLE IF EXISTS training_template CASCADE/i.test(x));
  const dropProfile = s.findIndex((x) => /DROP TABLE IF EXISTS learner_profile CASCADE/i.test(x));
  assert.ok(dropSession >= 0 && dropTemplate > dropSession && dropProfile > dropTemplate, 'drops reverse dependency order');
});
