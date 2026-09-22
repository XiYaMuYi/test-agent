import type { Migration } from './migration.types.js';

export const conversationOpeningMigration: Migration = {
  id: '0017_conversation_opening',
  description: 'Persist one generated AI customer opening per conversation.',

  async up(database): Promise<void> {
    await database.query(`
      ALTER TABLE conversation
      ADD COLUMN IF NOT EXISTS opening_response JSONB
    `);
  },

  async down(database): Promise<void> {
    await database.query(`
      ALTER TABLE conversation
      DROP COLUMN IF EXISTS opening_response
    `);
  },
};
