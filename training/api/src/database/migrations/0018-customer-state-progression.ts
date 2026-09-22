import type { Migration } from './migration.types.js';

export const customerStateProgressionMigration: Migration = {
  id: '0018_customer_state_progression',
  description: 'Persist initial/current customer state and the terminal reason for stateful coaching.',

  async up(database): Promise<void> {
    await database.query(`
      ALTER TABLE conversation
      ADD COLUMN IF NOT EXISTS initial_customer_state JSONB,
      ADD COLUMN IF NOT EXISTS current_customer_state JSONB,
      ADD COLUMN IF NOT EXISTS end_reason TEXT
    `);
  },

  async down(database): Promise<void> {
    await database.query(`
      ALTER TABLE conversation
      DROP COLUMN IF EXISTS end_reason,
      DROP COLUMN IF EXISTS current_customer_state,
      DROP COLUMN IF EXISTS initial_customer_state
    `);
  },
};
