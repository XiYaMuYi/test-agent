import type { PersonaConfig } from './persona/config.js';
import type { AgentConfigV1 } from './agent-config.js';
import type { LearnerOverridePolicyV1 } from './learner-override-policy.js';

/**
 * 组织模板修订契约（spec §5.1）。
 *
 * 组织模板保留稳定 templateId，可变内容写入追加式 revision。每个 revision
 * 至少包含以下完整配置。保存有效修改时创建新 revision；归档和启用属于
 * 模板生命周期状态，不覆盖历史 revision。复制后生成新的 templateId 和 revision 1。
 */
export interface OrganizationTemplateRevisionV1 {
  readonly revisionId: string;
  readonly templateId: string;
  readonly revision: number;
  readonly title: string;
  readonly personaConfig: PersonaConfig;
  readonly knowledgeVersions: readonly string[];
  readonly scoringRules: readonly string[];
  readonly agentConfig: AgentConfigV1;
  readonly learnerOverridePolicy: LearnerOverridePolicyV1;
  readonly createdBy: string;
  readonly createdAt: string;
}

/** 模板 revision 之间的字段级差异项（spec §6.2 revision 差异展示）。 */
export interface TemplateRevisionDiffEntry {
  readonly path: string;
  readonly before: unknown;
  readonly after: unknown;
}

/** 计算两个 revision 之间全部可枚举路径的字段差异，用于 B 端版本对比。 */
export function diffTemplateRevisions(
  before: OrganizationTemplateRevisionV1,
  after: OrganizationTemplateRevisionV1,
): readonly TemplateRevisionDiffEntry[] {
  const entries: TemplateRevisionDiffEntry[] = [];
  const walk = (a: unknown, b: unknown, path: string): void => {
    if (Object.is(a, b)) return;
    if (typeof a === 'object' && a !== null && typeof b === 'object' && b !== null
      && !Array.isArray(a) && !Array.isArray(b)) {
      const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
      for (const key of keys) {
        walk(
          (a as Record<string, unknown>)[key],
          (b as Record<string, unknown>)[key],
          path === '' ? key : `${path}.${key}`,
        );
      }
      return;
    }
    entries.push({ path, before: a, after: b });
  };
  walk(before, after, '');
  return entries;
}
