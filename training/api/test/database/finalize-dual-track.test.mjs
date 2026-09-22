import assert from 'node:assert/strict';
import test from 'node:test';

import { finalizeDualTrackMigration, registeredMigrations } from '../../dist/database/migrations/index.js';

class RecordingExecutor {
  statements = [];

  async query(statement) {
    this.statements.push(statement.replace(/\s+/g, ' ').trim());
    return { rows: [] };
  }
}

test('0016 migration exposes stable id and reversible hooks', () => {
  assert.equal(finalizeDualTrackMigration.id, '0016_finalize_dual_track');
  assert.equal(typeof finalizeDualTrackMigration.up, 'function');
  assert.equal(typeof finalizeDualTrackMigration.down, 'function');
});

test('0016 is registered last, after 0015', () => {
  const ids = registeredMigrations.map((m) => m.id);
  assert.ok(ids.indexOf('0015_c_first_dual_track') < ids.indexOf('0016_finalize_dual_track'));
  assert.equal(ids.at(-1), '0016_finalize_dual_track');
});

test('0016 up backfills profiles/sessions, links conversations, guards orphans, then SETs NOT NULL', async () => {
  const db = new RecordingExecutor();
  await finalizeDualTrackMigration.up(db);
  const s = db.statements;
  const all = s.join('\n');

  const profileBackfill = s.findIndex((x) => /INSERT INTO learner_profile[\s\S]*FROM learner_assignment/i.test(x));
  const sessionBackfill = s.findIndex((x) => /INSERT INTO training_session[\s\S]*FROM conversation c/i.test(x));
  const link = s.findIndex((x) => /UPDATE conversation c[\s\S]*SET training_session_id/i.test(x));
  const enforce = s.findIndex((x) => /ALTER COLUMN training_session_id SET NOT NULL/i.test(x));

  assert.ok(profileBackfill >= 0, 'legacy profiles backfilled');
  assert.ok(sessionBackfill > profileBackfill, 'session backfill after profile backfill');
  assert.ok(link > sessionBackfill, 'conversation link after session backfill');
  assert.ok(enforce > link, 'NOT NULL enforced only after backfill/link');
  assert.match(all, /WHERE c\.training_session_id IS NULL/i, 'backfill is idempotent, only null rows');
});

test('0016 down only relaxes NOT NULL, keeping backfilled data', async () => {
  const db = new RecordingExecutor();
  await finalizeDualTrackMigration.down(db);
  const all = db.statements.join('\n');
  assert.match(all, /ALTER COLUMN training_session_id DROP NOT NULL/i);
  assert.ok(!/DROP (TABLE|COLUMN)/i.test(all), 'down must not drop data');
});
