/**
 * LearnerOverridePolicyV1 — C 端覆盖策略契约（spec §5.4）。
 *
 * C 端自由练习基于组织模板时携带 templateId/revisionId/覆盖 patch；
 * 服务端加载 revision、校验策略、应用允许的 patch，再冻结到 persona_snapshot。
 */

export type LearnerOverrideMode = 'locked' | 'allow_list' | 'all';

export type LearnerOverridePolicyV1 =
  | { readonly mode: 'locked'; readonly visible: boolean; readonly recommended: boolean }
  | {
      readonly mode: 'allow_list';
      readonly visible: boolean;
      readonly recommended: boolean;
      readonly allowedPaths: readonly string[];
    }
  | { readonly mode: 'all'; readonly visible: boolean; readonly recommended: boolean };

export const DEFAULT_LEARNER_OVERRIDE_POLICY: LearnerOverridePolicyV1 = Object.freeze({
  mode: 'all',
  visible: true,
  recommended: false,
});

/**
 * 服务端允许 C 端覆盖的稳定字段路径集合。路径使用点分字段名，
 * 不包含父级通配符、数组下标或原型链相关片段（spec §5.4）。
 * 这里的条目是"前缀"，表示该子树整体允许覆盖；校验时只接受精确命中前缀
 * 或以 'prefix.' 开头的合法路径。
 */
export const ALLOWED_OVERRIDE_PATH_PREFIXES: readonly string[] = Object.freeze([
  // 基础画像
  'age',
  'gender',
  'occupation',
  'name',
  'basic.maritalStatus',
  'basic.incomeLevel',
  // 客户画像维度（v2 设计 §5.2）
  'basic.customerRelation',
  'basic.trustLevel',
  'basic.customerCohort',
  'basic.city',
  'basic.purchaseCategory',
  // 性格参数（全部 7 项）
  'personality.friendliness',
  'personality.patience',
  'personality.priceSensitivity',
  'personality.decisiveness',
  'personality.skepticism',
  'personality.socialActivity',
  'personality.emotionalVolatility',
  // 沟通方式
  'communication.style',
  'communication.verbosity',
  'communication.emotionLevel',
  'communication.catchphrase',
  'communication.dialect',
  // 消费与需求
  'consumption.budgetMin',
  'consumption.budgetMax',
  'consumption.decisionCycle',
  'consumption.brandLoyalty',
  'consumption.skinType',
  'consumption.skinConcerns',
  'consumption.healthGoals',
  'consumption.purchaseChannel',
  'consumption.ingredientFocus',
  'consumption.competitorComparison',
  'consumption.allergies',
  'consumption.currentProducts',
  // 对话控制（maxTurns / openingMode / customNotes；background 与 productScenario 属场景发布内容，不允许学员覆盖）
  'conversation.maxTurns',
  'conversation.openingMode',
  'conversation.customNotes',
]);

/** 拒绝原型链 / 构造器 / 父级通配符等危险片段。 */
const FORBIDDEN_PATH_FRAGMENTS: readonly string[] = [
  '__proto__',
  'prototype',
  'constructor',
  'hasOwnProperty',
  '*',
  '..',
];

export interface LearnerOverridePolicyValidationResult {
  readonly valid: boolean;
  readonly issues: readonly string[];
}

export function validateLearnerOverridePolicy(raw: unknown): LearnerOverridePolicyValidationResult {
  const issues: string[] = [];
  if (typeof raw !== 'object' || raw === null) {
    return { valid: false, issues: ['learner override policy must be an object'] };
  }
  const candidate = raw as Record<string, unknown>;
  const mode = candidate.mode;
  if (mode !== 'locked' && mode !== 'allow_list' && mode !== 'all') {
    issues.push('mode must be locked|allow_list|all');
  }
  if (typeof candidate.visible !== 'boolean') issues.push('visible must be a boolean');
  if (typeof candidate.recommended !== 'boolean') issues.push('recommended must be a boolean');

  if (mode === 'allow_list') {
    if (!Array.isArray(candidate.allowedPaths) || candidate.allowedPaths.length === 0) {
      issues.push('allow_list requires a non-empty allowedPaths array');
    } else {
      for (const entry of candidate.allowedPaths) {
        if (typeof entry !== 'string') {
          issues.push('allowedPaths entries must be strings');
          continue;
        }
        const path = entry as string;
        if (FORBIDDEN_PATH_FRAGMENTS.some((fragment) => path.includes(fragment))) {
          issues.push(`allowedPath '${path}' contains a forbidden fragment`);
          continue;
        }
        const allowed = ALLOWED_OVERRIDE_PATH_PREFIXES.some(
          (prefix) => path === prefix || path.startsWith(`${prefix}.`),
        );
        if (!allowed) issues.push(`allowedPath '${path}' is not an allowed override path`);
      }
    }
  } else if (mode !== undefined && (candidate as Record<string, unknown>).allowedPaths !== undefined) {
    issues.push('allowedPaths is only valid in allow_list mode');
  }

  return { valid: issues.length === 0, issues };
}

export function normalizeLearnerOverridePolicy(raw: unknown): LearnerOverridePolicyV1 {
  if (typeof raw !== 'object' || raw === null) return { ...DEFAULT_LEARNER_OVERRIDE_POLICY };
  const candidate = raw as Record<string, unknown>;
  const mode = candidate.mode;
  const base = {
    visible: typeof candidate.visible === 'boolean' ? candidate.visible : true,
    recommended: typeof candidate.recommended === 'boolean' ? candidate.recommended : false,
  };
  if (mode === 'locked') return { mode: 'locked', ...base };
  if (mode === 'allow_list') {
    const paths = Array.isArray(candidate.allowedPaths)
      ? candidate.allowedPaths.filter((entry): entry is string => typeof entry === 'string')
      : [];
    return { mode: 'allow_list', ...base, allowedPaths: paths };
  }
  return { mode: 'all', ...base };
}
