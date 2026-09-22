import type { Migration } from './migration.types.js';

/**
 * knowledge_product 增加「适用场景/人群」列 suitable_scenarios（jsonb）。
 *
 * B 端前端、contracts 与 knowledge.service 早已读写该字段，但建表迁移（0021）
 * 及后续迁移均未补列。此迁移幂等补齐：线上库若已有该列则无操作。
 * 值取自固定标签集（熬夜党/长期加班/健身人群/免疫力低下/孕期哺乳期 等），
 * 由运营在产品知识页勾选或批量导入。
 */
export const knowledgeProductScenariosMigration: Migration = {
  id: '0025_knowledge_product_scenarios',
  description:
    'Add suitable_scenarios (jsonb) column to knowledge_product for applicable scenarios / user groups.',

  async up(database): Promise<void> {
    await database.query(`
      ALTER TABLE knowledge_product
      ADD COLUMN IF NOT EXISTS suitable_scenarios JSONB NOT NULL DEFAULT '[]'::jsonb
    `);
    await database.query(`
      COMMENT ON COLUMN knowledge_product.suitable_scenarios IS
      'Applicable scenarios / user groups tags (e.g. 熬夜党, 健身人群, 孕期/哺乳期). Free-form tag set from the product knowledge page.'
    `);
  },

  async down(database): Promise<void> {
    await database.query(`
      ALTER TABLE knowledge_product DROP COLUMN IF EXISTS suitable_scenarios
    `);
  },
};
