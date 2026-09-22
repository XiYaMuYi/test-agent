/**
 * 异步客户状态研判器（LLM）。
 *
 * 设计原则（对应产品要求）：
 * 1. 模拟客户的 12 维心理状态“必须由大模型结合对话研判”，不再使用关键词规则或写死档位；
 * 2. 它是反馈侧的异步旁路，主回复不等待它，结果由调用方写回、前端轮询后延迟渲染，
 *    因此不增加模拟对话主链路的延时（与异步教练点评 generateAndPersistCoachFeedback 同构）；
 * 3. 模型不可用或输出非法时返回 null，由调用方沿用上一轮状态，保证界面不崩、不回退到规则打分。
 */
import {
  CUSTOMER_STATE_KEYS,
  customerMoodFromState,
  type CustomerState,
  type PersonaConfig,
} from '@training/contracts';

/**
 * 单轮单维最大变化幅度。仅用于“防抖”，避免模型一帧把数值打满或乱跳，
 * 它不判断情绪本身（情绪方向与数值仍完全由模型给出），不是规则评分。
 */
const MAX_TURN_DELTA = 25;

export interface CustomerStateAssessmentParams {
  readonly persona: PersonaConfig | null;
  readonly previous: CustomerState;
  /** 截至本轮的近期对话（最后一条通常是顾客本轮回应）。 */
  readonly recentMessages: readonly { readonly role: 'learner' | 'assistant'; readonly content: string }[];
  readonly turnCount: number;
}

const DIMENSION_HINTS: Record<(typeof CUSTOMER_STATE_KEYS)[number], string> = {
  emotion: '情绪：顾客当下心情，越高越愉悦放松，越低越冷淡/不悦',
  trust: '信任度：对眼前这位销售的信任，越高越相信其专业与诚意',
  patience: '耐心：继续聊下去的耐心，越高越愿意慢慢听，越低越想尽快结束',
  consultationIntent: '咨询意愿：继续了解产品/方案的意愿强弱',
  purchaseIntent: '购买倾向：当下产生购买的倾向，越高越接近想买',
  decisionReadiness: '决策成熟度：是否已到可做决定的阶段（信息够不够、顾虑解没解）',
  priceAcceptance: '价格接受度：对当前价格/预算的接受程度，越高越能接受',
  needClarity: '需求清晰度：顾客自身需求被梳理、被明确的程度',
  productFitBelief: '产品适配信念：顾客相信“这款产品适合我、能解决我问题”的程度',
  informationConfidence: '信息确信度：顾客认为已获得的产品信息是否充分、可信',
  riskConcern: '风险担忧：对成分/安全/效果/踩坑的担忧，越高越担心（负面维度）',
  objectionLevel: '异议强度：当前抗拒/反驳/挑刺的强度，越高越抗拒（负面维度）',
};

const clamp0100 = (value: number): number => Math.max(0, Math.min(100, value));

function personaBrief(persona: PersonaConfig | null): string {
  if (persona === null || persona === undefined) return '（无固定人设基线）';
  const p = persona.personality ?? {};
  const c = persona.consumption ?? {};
  const parts: string[] = [];
  const push = (label: string, value: unknown) => {
    if (typeof value === 'number' && Number.isFinite(value)) parts.push(`${label}=${value}`);
  };
  push('怀疑度 skepticism', p.skepticism);
  push('友善度 friendliness', p.friendliness);
  push('果断性 decisiveness', p.decisiveness);
  push('耐心 patience', p.patience);
  push('价格敏感 priceSensitivity', p.priceSensitivity);
  if (typeof c.skinType === 'string') parts.push(`肤质 skinType=${c.skinType}`);
  return parts.length > 0 ? parts.join('，') : '（人设未提供量化基线）';
}

/** 构造让大模型研判“本轮结束后客户 12 维状态绝对值”的 prompt。 */
export function buildCustomerStatePrompt(params: CustomerStateAssessmentParams): string {
  const previousLines = CUSTOMER_STATE_KEYS
    .map((key) => `- ${key}：${DIMENSION_HINTS[key]}；上一轮=${params.previous[key]}`)
    .join('\n');
  const dialog = params.recentMessages
    .slice(-10)
    .map((message) => `${message.role === 'learner' ? '销售员(学员)' : '顾客(AI)'}：${message.content}`)
    .join('\n');
  const keysSchema = CUSTOMER_STATE_KEYS.map((key) => `"${key}": 0到100的整数`).join(', ');

  return [
    '你是资深消费者心理分析师。下面是一段销售新人与“由 AI 扮演的模拟顾客”的对话。',
    '请你站在这位【模拟顾客】的内心角度，研判其在本轮结束后的真实心理状态（共 12 维，均为 0-100）。',
    '判断依据是“销售员本轮如何回应”——是否共情、是否答中需求、是否专业可信、是否引起反感或顾虑；不要只看顾客自己说了什么，也禁止给一成不变的固定值。',
    '',
    '【顾客人设基线（固有倾向，仅供参考，实际状态以对话推进为准）】',
    personaBrief(params.persona),
    '',
    '【近期对话（最后一条是顾客本轮回应）】',
    dialog || '（对话刚开始）',
    '',
    `【12 个维度含义与上一轮数值】（当前第 ${params.turnCount} 轮）`,
    previousLines,
    '',
    `要求：输出每个维度的当前绝对值（0-100 整数）；相对上一轮单维变化幅度一般不超过 ${MAX_TURN_DELTA}，除非对话出现非常明确的强信号。`,
    '其中 riskConcern、objectionLevel 是负面维度：销售员处理得好时应下降，处理得差时上升。',
    '只输出一个 JSON 对象，不要输出推理过程、Markdown 代码块或任何多余文字，格式：',
    `{ ${keysSchema} }`,
  ].join('\n');
}

/** 从模型原始输出中提取最外层 JSON 对象（容忍围栏与前后缀文字）。 */
function extractFirstJsonObject(raw: string): Record<string, unknown> | null {
  const text = raw.trim().replace(/^﻿/, '').trim();
  const firstBrace = text.indexOf('{');
  const lastBrace = text.lastIndexOf('}');
  if (firstBrace === -1 || lastBrace <= firstBrace) return null;
  try {
    const parsed = JSON.parse(text.slice(firstBrace, lastBrace + 1));
    if (typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>;
    }
  } catch {
    return null;
  }
  return null;
}

/**
 * 解析并归一化模型研判结果。
 * - 每个维度必须是有限数值，否则沿用上一轮值（补缺，不轻易丢维度）；
 * - 相对上一轮的变化量被限制在 ±MAX_TURN_DELTA 内（防抖），再钳制到 0-100；
 * - 三个列表字段（disclosedNeeds 等）不在本轮由情绪模型产出，沿用上一轮。
 * 返回 null 表示模型输出完全无法使用，调用方据此放弃本轮更新。
 */
export function parseCustomerStateAssessment(raw: string, previous: CustomerState): CustomerState | null {
  const obj = extractFirstJsonObject(raw);
  if (obj === null) return null;

  const next = { ...previous };
  let validDimensionCount = 0;
  for (const key of CUSTOMER_STATE_KEYS) {
    const value = obj[key];
    if (typeof value === 'number' && Number.isFinite(value)) {
      validDimensionCount += 1;
      const delta = Math.max(-MAX_TURN_DELTA, Math.min(MAX_TURN_DELTA, value - previous[key]));
      next[key] = Math.round(clamp0100(previous[key] + delta));
    } else {
      next[key] = previous[key];
    }
  }
  // 一个合法维度都没有，视为无效输出。
  if (validDimensionCount === 0) return null;

  return {
    ...next,
    schemaVersion: 'customer-state/v1',
    disclosedNeeds: previous.disclosedNeeds,
    activeObjections: previous.activeObjections,
    unresolvedQuestions: previous.unresolvedQuestions,
  };
}

/** 异步主入口：调模型研判；任何异常/非法输出都返回 null（不抛出，绝不影响主链路）。 */
export async function assessCustomerState(
  generate: (prompt: string) => Promise<string>,
  params: CustomerStateAssessmentParams,
): Promise<CustomerState | null> {
  try {
    const raw = await generate(buildCustomerStatePrompt(params));
    return parseCustomerStateAssessment(raw, params.previous);
  } catch {
    return null;
  }
}

export function moodLabelOf(state: CustomerState): 'positive' | 'neutral' | 'negative' {
  return customerMoodFromState(state);
}
