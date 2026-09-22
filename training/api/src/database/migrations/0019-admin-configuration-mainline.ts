import type { Migration } from './migration.types.js';

/**
 * B 端配置中心主链路（spec 2026-09-15-training-b-admin-configuration-design §5、§10）。
 *
 * 1. training_template 增加 C 端策略与"当前版本投影"字段：
 *    - learner_override_policy：C 端覆盖策略（locked/allow_list/all + visible/recommended）
 *    - visible / recommended：C 端模板发现用（保留在 policy 内亦可，这里冗余列便于 SQL 过滤）
 * 2. 新建 training_template_revision 追加式修订表；每个模板保存有效修改时追加一条。
 * 3. 迁移现有组织模板：为每条现有 organization 模板创建 revision 1（内容取当前行），
 *    并把当前行作为"当前版本投影"保留（spec §10.3）。
 * 4. scenario_draft.payload 内新增 persona_source 字段（template_revision | inline），
 *    由发布编译器在 v2 快照中冻结；本迁移只做结构兼容，不强制已有草稿补字段。
 */
export const adminConfigurationMainlineMigration: Migration = {
  id: '0019_admin_configuration_mainline',
  description:
    'Add organization template revisions, C-end learner override policy columns, and persona_source support for scenario drafts (release-snapshot/v2 mainline).',

  async up(database): Promise<void> {
    // 1. training_template 增加 C 端策略与投影字段。
    await database.query(`
      ALTER TABLE training_template
        ADD COLUMN IF NOT EXISTS learner_override_policy JSONB NOT NULL DEFAULT '{"mode":"all","visible":true,"recommended":false}'::jsonb,
        ADD COLUMN IF NOT EXISTS visible BOOLEAN NOT NULL DEFAULT TRUE,
        ADD COLUMN IF NOT EXISTS recommended BOOLEAN NOT NULL DEFAULT FALSE
    `);

    // 1b. training_session 记录 v1 快照人设缺失/非法的回退原因（spec §8.1 legacyFallbackReason），
    //     供评估复盘追溯配置来源。
    await database.query(`
      ALTER TABLE training_session
        ADD COLUMN IF NOT EXISTS legacy_fallback_reason VARCHAR(256) NULL
    `);

    // 2. 模板修订表：revision 从 1 开始，按 (organization_id, template_id) 递增。
    await database.query(`
      CREATE TABLE IF NOT EXISTS training_template_revision (
        id UUID PRIMARY KEY,
        organization_id UUID NOT NULL,
        template_id UUID NOT NULL,
        revision INTEGER NOT NULL CHECK (revision >= 1),
        title VARCHAR(128) NOT NULL,
        persona_config JSONB NOT NULL,
        knowledge_versions JSONB NOT NULL DEFAULT '[]'::jsonb,
        scoring_rules JSONB NOT NULL DEFAULT '[]'::jsonb,
        agent_config JSONB NOT NULL DEFAULT '{}'::jsonb,
        learner_override_policy JSONB NOT NULL DEFAULT '{"mode":"all","visible":true,"recommended":false}'::jsonb,
        created_by VARCHAR(256) NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
        UNIQUE (organization_id, template_id, revision),
        FOREIGN KEY (organization_id, template_id)
          REFERENCES training_template (organization_id, id)
          ON DELETE CASCADE
      )
    `);
    await database.query(`
      CREATE INDEX IF NOT EXISTS training_template_revision_template_idx
      ON training_template_revision (organization_id, template_id, revision DESC)
    `);

    // 3. 迁移现有组织模板 → revision 1（内容取当前行作为初始 revision）。
    //    幂等：只补还不存在任何 revision 的模板。
    await database.query(`
      INSERT INTO training_template_revision (
        id, organization_id, template_id, revision, title,
        persona_config, knowledge_versions, scoring_rules, agent_config,
        learner_override_policy, created_at
      )
      SELECT gen_random_uuid(), t.organization_id, t.id, 1, t.title,
             t.persona_config, t.knowledge_versions, t.scoring_rules, t.agent_config,
             t.learner_override_policy, t.created_at
      FROM training_template t
      WHERE t.scope = 'organization'
        AND NOT EXISTS (
          SELECT 1 FROM training_template_revision r
          WHERE r.organization_id = t.organization_id AND r.template_id = t.id
        )
    `);

    // 4. scenario_draft 当前 payload 不含 persona_source；v2 发布编译器会以
    //    'template_revision' 或 'inline' 写回。为兼容 v1 草稿，不在此迁移强制字段，
    //    仅保证列结构可容纳扩展后的 payload（payload 为 jsonb，天然可扩展）。
    //    这里是显式文档化空操作，便于回滚脚本对齐。
  },

  async down(database): Promise<void> {
    await database.query('DROP INDEX IF EXISTS training_template_revision_template_idx');
    await database.query('DROP TABLE IF EXISTS training_template_revision');
    await database.query('ALTER TABLE training_session DROP COLUMN IF EXISTS legacy_fallback_reason');
    await database.query(`
      ALTER TABLE training_template
        DROP COLUMN IF EXISTS learner_override_policy,
        DROP COLUMN IF EXISTS visible,
        DROP COLUMN IF EXISTS recommended
    `);
  },
};
