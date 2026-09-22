import type { Migration } from './migration.types.js';

/**
 * 任务级参数覆盖（spec 2026-09-15-training-b-admin-configuration-design §6.4 扩展）。
 *
 * 用户已拍板：任务可对已发布快照叠加"覆盖参数"（AgentConfigV1 6 项 +
 * conversation.maxTurns/openingMode/background），任务可编辑该覆盖；
 * 只影响之后新开的会话，历史会话冻结，每个会话冻结实际生效配置。
 *
 * 1. assignment.override_patch：任务级覆盖 patch（jsonb，NULL=无覆盖）。
 *    - agentConfig：Partial<AgentConfigV1>（缺省字段表示不覆盖）
 *    - conversation：{ maxTurns?, openingMode?, background? }
 * 2. training_session.agent_config：会话启动时冻结的"生效 AgentConfig"
 *    （快照 agentConfig + 任务覆盖合并后），运行时上下文直接读该列，
 *    避免对话过程中任务覆盖被改造成会话参数漂移。
 */
export const assignmentTaskOverrideMigration: Migration = {
  id: '0020_assignment_task_override',
  description:
    'Add assignment.override_patch (task-level parameter override) and training_session.agent_config (frozen effective agent config per session).',

  async up(database): Promise<void> {
    await database.query(`
      ALTER TABLE assignment
        ADD COLUMN IF NOT EXISTS override_patch JSONB NULL
    `);
    await database.query(`
      ALTER TABLE training_session
        ADD COLUMN IF NOT EXISTS agent_config JSONB NULL
    `);
  },

  async down(database): Promise<void> {
    await database.query('ALTER TABLE assignment DROP COLUMN IF EXISTS override_patch');
    await database.query('ALTER TABLE training_session DROP COLUMN IF EXISTS agent_config');
  },
};
