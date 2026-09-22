import type { Migration } from './migration.types.js';

/**
 * 评分模板维度自由组合 + 模板级权重覆盖。
 *
 * scoring_template_dimension 增加 weight 字段：
 * - NULL 表示使用维度的全局权重
 * - 非 NULL 表示模板级权重覆盖（0-100）
 */
export const scoringTemplateDimensionWeightMigration: Migration = {
  id: '0023_scoring_template_dimension_weight',
  description:
    'Add weight column to scoring_template_dimension for template-level weight override, enabling free dimension combination per template.',

  async up(database): Promise<void> {
    await database.query(`
      ALTER TABLE scoring_template_dimension
      ADD COLUMN IF NOT EXISTS weight INTEGER NULL
    `);
    await database.query(`
      COMMENT ON COLUMN scoring_template_dimension.weight IS
      'Template-level weight override (0-100). NULL = use dimension global weight.'
    `);
  },

  async down(database): Promise<void> {
    await database.query(`
      ALTER TABLE scoring_template_dimension
      DROP COLUMN IF EXISTS weight
    `);
  },
};
