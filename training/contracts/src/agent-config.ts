/**
 * AgentConfigV1 — AI 行为配置契约（B 端配置中心 → 发布快照 → 训练运行时）。
 *
 * 第一版只引入当前训练运行时能够确定执行的配置；不暴露模型名、供应商、
 * 温度和 token 数等能力，避免暴露当前供应商不一致的能力（spec §5.5）。
 */

export type ResponseLength = 'short' | 'normal' | 'detailed';
export type KnowledgeStrictness = 'strict' | 'balanced';
export type ConversationPace = 'slow' | 'normal' | 'fast';
export type ClosingTendency = 'resistant' | 'neutral' | 'receptive';

export interface AgentConfigV1 {
  readonly schemaVersion: 'agent-config/v1';
  /** 运行上下文携带的历史消息数量，2..50。 */
  readonly historyMessageLimit: number;
  readonly responseLength: ResponseLength;
  readonly knowledgeStrictness: KnowledgeStrictness;
  readonly conversationPace: ConversationPace;
  readonly closingTendency: ClosingTendency;
  /** 角色行为区域的额外指令，最长 1000 字符；不直接拼接为系统级越权指令。 */
  readonly additionalInstructions?: string;
}

export const AGENT_CONFIG_MIN_HISTORY_MESSAGES = 2;
export const AGENT_CONFIG_MAX_HISTORY_MESSAGES = 50;
export const AGENT_CONFIG_MAX_ADDITIONAL_INSTRUCTIONS = 1000;

export const RESPONSE_LENGTHS: readonly ResponseLength[] = ['short', 'normal', 'detailed'];
export const KNOWLEDGE_STRICTNESSES: readonly KnowledgeStrictness[] = ['strict', 'balanced'];
export const CONVERSATION_PACES: readonly ConversationPace[] = ['slow', 'normal', 'fast'];
export const CLOSING_TENDENCIES: readonly ClosingTendency[] = ['resistant', 'neutral', 'receptive'];

export const DEFAULT_AGENT_CONFIG: AgentConfigV1 = Object.freeze({
  schemaVersion: 'agent-config/v1',
  historyMessageLimit: 20,
  responseLength: 'normal',
  knowledgeStrictness: 'balanced',
  conversationPace: 'normal',
  closingTendency: 'neutral',
});

export interface AgentConfigValidationIssue {
  readonly path: string;
  readonly reason: string;
}

export interface AgentConfigValidationResult {
  readonly valid: boolean;
  readonly issues: readonly AgentConfigValidationIssue[];
}

const AGENT_CONFIG_KEYS = new Set([
  'schemaVersion',
  'historyMessageLimit',
  'responseLength',
  'knowledgeStrictness',
  'conversationPace',
  'closingTendency',
  'additionalInstructions',
]);

function isIntegerIn(value: unknown, min: number, max: number): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value >= min && value <= max;
}

/**
 * 校验 AgentConfigV1：字段类型、枚举、边界、额外指令长度与控制字符，并拒绝未知字段。
 * 未知字段拒绝防止 B/C 端契约继续漂移（spec §9.2 AGENT_CONFIG_INVALID）。
 */
export function validateAgentConfigV1(raw: unknown): AgentConfigValidationResult {
  const issues: AgentConfigValidationIssue[] = [];
  const push = (path: string, reason: string): void => { issues.push({ path, reason }); };

  if (typeof raw !== 'object' || raw === null) {
    return { valid: false, issues: [{ path: '$', reason: 'agent config must be an object' }] };
  }
  const config = raw as Record<string, unknown>;

  for (const key of Object.keys(config)) {
    if (!AGENT_CONFIG_KEYS.has(key)) push(key, `unknown field '${key}'`);
  }

  if (config.schemaVersion !== 'agent-config/v1') {
    push('schemaVersion', 'must be agent-config/v1');
  }
  if (!isIntegerIn(config.historyMessageLimit, AGENT_CONFIG_MIN_HISTORY_MESSAGES, AGENT_CONFIG_MAX_HISTORY_MESSAGES)) {
    push('historyMessageLimit', `must be an integer in [${AGENT_CONFIG_MIN_HISTORY_MESSAGES}, ${AGENT_CONFIG_MAX_HISTORY_MESSAGES}]`);
  }
  if (!(RESPONSE_LENGTHS as readonly unknown[]).includes(config.responseLength)) {
    push('responseLength', 'must be short|normal|detailed');
  }
  if (!(KNOWLEDGE_STRICTNESSES as readonly unknown[]).includes(config.knowledgeStrictness)) {
    push('knowledgeStrictness', 'must be strict|balanced');
  }
  if (!(CONVERSATION_PACES as readonly unknown[]).includes(config.conversationPace)) {
    push('conversationPace', 'must be slow|normal|fast');
  }
  if (!(CLOSING_TENDENCIES as readonly unknown[]).includes(config.closingTendency)) {
    push('closingTendency', 'must be resistant|neutral|receptive');
  }
  if (config.additionalInstructions !== undefined) {
    if (typeof config.additionalInstructions !== 'string') {
      push('additionalInstructions', 'must be a string');
    } else {
      const text = config.additionalInstructions as string;
      if (text.length > AGENT_CONFIG_MAX_ADDITIONAL_INSTRUCTIONS) {
        push('additionalInstructions', `must be at most ${AGENT_CONFIG_MAX_ADDITIONAL_INSTRUCTIONS} characters`);
      }
      if (/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(text)) {
        push('additionalInstructions', 'must not contain control characters');
      }
    }
  }

  return { valid: issues.length === 0, issues };
}

/** 兼容读旧 agentConfig（v1 快照中的 Record<string, unknown>）：合并到默认值并校验。 */
export function normalizeAgentConfig(raw: unknown): AgentConfigV1 {
  if (typeof raw !== 'object' || raw === null) return { ...DEFAULT_AGENT_CONFIG };
  const candidate = { ...DEFAULT_AGENT_CONFIG, ...(raw as Record<string, unknown>) } as unknown;
  const validation = validateAgentConfigV1(candidate);
  if (validation.valid) return candidate as AgentConfigV1;
  return { ...DEFAULT_AGENT_CONFIG };
}

/**
 * 任务级参数覆盖的 AgentConfig 部分校验（spec §6.4 扩展：任务可叠加覆盖 patch）。
 * 与完整校验不同：缺省字段表示"不覆盖"，保留快照原值；提供的字段必须类型/枚举/范围合法，
 * 并拒绝未知字段，防止契约漂移。schemaVersion 若提供必须为 agent-config/v1。
 */
export function validateAgentConfigOverrideV1(raw: unknown): AgentConfigValidationResult {
  const issues: AgentConfigValidationIssue[] = [];
  const push = (path: string, reason: string): void => { issues.push({ path, reason }); };

  if (typeof raw !== 'object' || raw === null) {
    return { valid: false, issues: [{ path: '$', reason: 'agent config override must be an object' }] };
  }
  const config = raw as Record<string, unknown>;

  for (const key of Object.keys(config)) {
    if (!AGENT_CONFIG_KEYS.has(key)) push(key, `unknown field '${key}'`);
  }

  if (config.schemaVersion !== undefined && config.schemaVersion !== 'agent-config/v1') {
    push('schemaVersion', 'must be agent-config/v1');
  }
  if (config.historyMessageLimit !== undefined
    && !isIntegerIn(config.historyMessageLimit, AGENT_CONFIG_MIN_HISTORY_MESSAGES, AGENT_CONFIG_MAX_HISTORY_MESSAGES)) {
    push('historyMessageLimit', `must be an integer in [${AGENT_CONFIG_MIN_HISTORY_MESSAGES}, ${AGENT_CONFIG_MAX_HISTORY_MESSAGES}]`);
  }
  if (config.responseLength !== undefined && !(RESPONSE_LENGTHS as readonly unknown[]).includes(config.responseLength)) {
    push('responseLength', 'must be short|normal|detailed');
  }
  if (config.knowledgeStrictness !== undefined && !(KNOWLEDGE_STRICTNESSES as readonly unknown[]).includes(config.knowledgeStrictness)) {
    push('knowledgeStrictness', 'must be strict|balanced');
  }
  if (config.conversationPace !== undefined && !(CONVERSATION_PACES as readonly unknown[]).includes(config.conversationPace)) {
    push('conversationPace', 'must be slow|normal|fast');
  }
  if (config.closingTendency !== undefined && !(CLOSING_TENDENCIES as readonly unknown[]).includes(config.closingTendency)) {
    push('closingTendency', 'must be resistant|neutral|receptive');
  }
  if (config.additionalInstructions !== undefined) {
    if (typeof config.additionalInstructions !== 'string') {
      push('additionalInstructions', 'must be a string');
    } else {
      const text = config.additionalInstructions as string;
      if (text.length > AGENT_CONFIG_MAX_ADDITIONAL_INSTRUCTIONS) {
        push('additionalInstructions', `must be at most ${AGENT_CONFIG_MAX_ADDITIONAL_INSTRUCTIONS} characters`);
      }
      if (/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(text)) {
        push('additionalInstructions', 'must not contain control characters');
      }
    }
  }

  return { valid: issues.length === 0, issues };
}
