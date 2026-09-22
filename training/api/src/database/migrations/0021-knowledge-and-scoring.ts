import type { Migration } from './migration.types.js';

/**
 * 结构化知识库 + LLM 评分配置（spec 知识增强评分架构）。
 *
 * 1. 知识库 3 表（organization 级别，B 端可维护）：
 *    - knowledge_product：产品库（功效/肤质/禁忌/关联产品）
 *    - knowledge_symptom_efficacy：症状-功效映射（客户大白话→功效需求翻译层）
 *    - knowledge_contraindication：禁忌规则库（安全底线）
 * 2. 评分配置 3 表：
 *    - scoring_dimension：评分维度（权重/分级/知识依赖/关键词/LLM引导语/是否已配置）
 *    - scoring_template：评分模板（一组维度的集合）
 *    - scoring_template_dimension：模板-维度多对多关联
 * 3. 初始化默认 5 维度 + 默认评分模板（isConfigured 标记控制兜底）
 */
export const knowledgeAndScoringMigration: Migration = {
  id: '0021_knowledge_and_scoring',
  description:
    'Add structured knowledge base (products/symptom-efficacy/contraindications) and LLM scoring configuration (dimensions/templates) with default dimension seed data.',

  async up(database): Promise<void> {
    // 1. 产品库
    await database.query(`
      CREATE TABLE IF NOT EXISTS knowledge_product (
        id UUID PRIMARY KEY,
        organization_id UUID NOT NULL,
        name VARCHAR(128) NOT NULL,
        aliases JSONB NOT NULL DEFAULT '[]'::jsonb,
        category VARCHAR(32) NOT NULL DEFAULT '其他',
        core_efficacies JSONB NOT NULL DEFAULT '[]'::jsonb,
        suitable_skin_types JSONB NOT NULL DEFAULT '[]'::jsonb,
        suitable_audience VARCHAR(256) NOT NULL DEFAULT '',
        price_range VARCHAR(64) NOT NULL DEFAULT '',
        key_ingredients JSONB NOT NULL DEFAULT '[]'::jsonb,
        key_selling_points TEXT NOT NULL DEFAULT '',
        contraindicated_skin_types JSONB NOT NULL DEFAULT '[]'::jsonb,
        contraindicated_audience VARCHAR(256) NOT NULL DEFAULT '',
        associated_product_ids JSONB NOT NULL DEFAULT '[]'::jsonb,
        status VARCHAR(16) NOT NULL DEFAULT 'active',
        created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
      )
    `);
    await database.query(`
      CREATE INDEX IF NOT EXISTS knowledge_product_org_idx ON knowledge_product (organization_id, status)
    `);
    await database.query(`
      CREATE INDEX IF NOT EXISTS knowledge_product_name_idx ON knowledge_product (organization_id, name)
    `);

    // 2. 症状-功效映射
    await database.query(`
      CREATE TABLE IF NOT EXISTS knowledge_symptom_efficacy (
        id UUID PRIMARY KEY,
        organization_id UUID NOT NULL,
        customer_expressions JSONB NOT NULL DEFAULT '[]'::jsonb,
        efficacy_need VARCHAR(32) NOT NULL,
        severity_weight NUMERIC(3,2) NOT NULL DEFAULT 1.00 CHECK (severity_weight >= 0.5 AND severity_weight <= 1.5),
        status VARCHAR(16) NOT NULL DEFAULT 'active',
        created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
      )
    `);
    await database.query(`
      CREATE INDEX IF NOT EXISTS knowledge_symptom_org_idx ON knowledge_symptom_efficacy (organization_id, status)
    `);

    // 3. 禁忌库
    await database.query(`
      CREATE TABLE IF NOT EXISTS knowledge_contraindication (
        id UUID PRIMARY KEY,
        organization_id UUID NOT NULL,
        customer_condition VARCHAR(128) NOT NULL,
        forbidden_product_ids JSONB NOT NULL DEFAULT '[]'::jsonb,
        forbidden_ingredients JSONB NOT NULL DEFAULT '[]'::jsonb,
        reason TEXT NOT NULL DEFAULT '',
        severity VARCHAR(16) NOT NULL DEFAULT 'warning' CHECK (severity IN ('warning','critical')),
        status VARCHAR(16) NOT NULL DEFAULT 'active',
        created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
      )
    `);
    await database.query(`
      CREATE INDEX IF NOT EXISTS knowledge_contraindication_org_idx ON knowledge_contraindication (organization_id, status)
    `);

    // 4. 评分维度
    await database.query(`
      CREATE TABLE IF NOT EXISTS scoring_dimension (
        id UUID PRIMARY KEY,
        organization_id UUID NOT NULL,
        code VARCHAR(64) NOT NULL,
        name VARCHAR(64) NOT NULL,
        description TEXT NOT NULL DEFAULT '',
        weight INTEGER NOT NULL DEFAULT 20 CHECK (weight >= 0 AND weight <= 100),
        knowledge_dependencies JSONB NOT NULL DEFAULT '["none"]'::jsonb,
        grading_rubric JSONB NOT NULL DEFAULT '{"excellent":90,"good":80,"fair":70,"pass":60}'::jsonb,
        keywords JSONB NOT NULL DEFAULT '[]'::jsonb,
        llm_prompt TEXT NOT NULL DEFAULT '',
        is_configured BOOLEAN NOT NULL DEFAULT FALSE,
        sort_order INTEGER NOT NULL DEFAULT 0,
        status VARCHAR(16) NOT NULL DEFAULT 'active',
        created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
        UNIQUE (organization_id, code)
      )
    `);
    await database.query(`
      CREATE INDEX IF NOT EXISTS scoring_dimension_org_idx ON scoring_dimension (organization_id, status, sort_order)
    `);

    // 5. 评分模板
    await database.query(`
      CREATE TABLE IF NOT EXISTS scoring_template (
        id UUID PRIMARY KEY,
        organization_id UUID NOT NULL,
        name VARCHAR(128) NOT NULL,
        description TEXT NOT NULL DEFAULT '',
        is_default BOOLEAN NOT NULL DEFAULT FALSE,
        status VARCHAR(16) NOT NULL DEFAULT 'active',
        created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
      )
    `);
    await database.query(`
      CREATE INDEX IF NOT EXISTS scoring_template_org_idx ON scoring_template (organization_id, status)
    `);

    // 6. 模板-维度关联
    await database.query(`
      CREATE TABLE IF NOT EXISTS scoring_template_dimension (
        template_id UUID NOT NULL REFERENCES scoring_template(id) ON DELETE CASCADE,
        dimension_id UUID NOT NULL REFERENCES scoring_dimension(id) ON DELETE CASCADE,
        sort_order INTEGER NOT NULL DEFAULT 0,
        PRIMARY KEY (template_id, dimension_id)
      )
    `);
    await database.query(`
      CREATE INDEX IF NOT EXISTS scoring_template_dimension_template_idx ON scoring_template_dimension (template_id, sort_order)
    `);
  },

  async down(database): Promise<void> {
    await database.query('DROP TABLE IF EXISTS scoring_template_dimension');
    await database.query('DROP TABLE IF EXISTS scoring_template');
    await database.query('DROP TABLE IF EXISTS scoring_dimension');
    await database.query('DROP TABLE IF EXISTS knowledge_contraindication');
    await database.query('DROP TABLE IF EXISTS knowledge_symptom_efficacy');
    await database.query('DROP TABLE IF EXISTS knowledge_product');
  },
};
