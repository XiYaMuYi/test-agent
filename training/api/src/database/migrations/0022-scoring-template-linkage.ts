import type { Migration } from './migration.types.js';

/**
 * 评分模板关联体系 + 防幻觉评分引擎配置。
 *
 * 1. assignment 增加 scoring_template_id：任务级选定评分模板（NULL=用默认模板）
 * 2. training_template 增加 recommended_scoring_template_ids：陪练模板推荐的评分模板（多对多，JSONB数组）
 * 3. scoring_template 增加 evaluation_mode：评分策略（grouped按知识依赖分组/per_dimension每维度独立/single单次全量）
 * 4. scoring_template 增加 coach_comment_prompt：教练点评全局引导语
 */
export const scoringTemplateLinkageMigration: Migration = {
  id: '0022_scoring_template_linkage',
  description:
    'Add assignment.scoring_template_id, training_template.recommended_scoring_template_ids, scoring_template.evaluation_mode and coach_comment_prompt for scoring template linkage and anti-hallucination evaluation.',

  async up(database): Promise<void> {
    // 1. assignment 增加评分模板字段
    await database.query(`
      ALTER TABLE assignment
      ADD COLUMN IF NOT EXISTS scoring_template_id UUID NULL
    `);
    await database.query(`
      CREATE INDEX IF NOT EXISTS assignment_scoring_template_idx
      ON assignment (organization_id, scoring_template_id)
    `);

    // 2. training_template 增加推荐评分模板
    await database.query(`
      ALTER TABLE training_template
      ADD COLUMN IF NOT EXISTS recommended_scoring_template_ids JSONB NOT NULL DEFAULT '[]'::jsonb
    `);

    // 3. scoring_template 增加评分策略 + 教练点评引导语
    await database.query(`
      ALTER TABLE scoring_template
      ADD COLUMN IF NOT EXISTS evaluation_mode VARCHAR(32) NOT NULL DEFAULT 'grouped'
    `);
    await database.query(`
      ALTER TABLE scoring_template
      ADD COLUMN IF NOT EXISTS coach_comment_prompt TEXT NOT NULL DEFAULT ''
    `);
  },

  async down(database): Promise<void> {
    await database.query('DROP INDEX IF EXISTS assignment_scoring_template_idx');
    await database.query('ALTER TABLE assignment DROP COLUMN IF EXISTS scoring_template_id');
    await database.query('ALTER TABLE training_template DROP COLUMN IF EXISTS recommended_scoring_template_ids');
    await database.query('ALTER TABLE scoring_template DROP COLUMN IF EXISTS evaluation_mode');
    await database.query('ALTER TABLE scoring_template DROP COLUMN IF EXISTS coach_comment_prompt');
  },
};
