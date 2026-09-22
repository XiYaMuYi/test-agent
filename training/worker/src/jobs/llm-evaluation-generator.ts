import { toReportRecord, type EvaluationInput, type EvaluationReportGenerator } from './evaluation.processor.js';
import type { ModelProviderPort } from '@training/contracts';
import {
  ruleBasedEvaluate,
  type DimensionScores,
  type TranscriptMessage,
} from './rule-evaluation-generator.js';

export interface LlmBasedEvaluateParams {
  readonly transcript: readonly TranscriptMessage[];
  readonly personaConfig?: unknown;
  readonly customerMood: string;
  /** 对话开始时的客户 12 维状态（由对话中异步大模型逐轮研判落库）。 */
  readonly initialCustomerState?: Record<string, unknown> | null;
  /** 对话结束时的客户 12 维状态，用于衡量学员对客户心理的推动效果。 */
  readonly finalCustomerState?: Record<string, unknown> | null;
  readonly modelProvider: ModelProviderPort;
}

export interface LlmEvaluationReport {
  readonly schemaVersion: 'evaluation-report/v1';
  readonly generatedBy: 'llm-evaluation/v1';
  readonly messageCount: number;
  readonly scoringRules: readonly unknown[];
  readonly score: number;
  readonly dimensionScores: DimensionScores;
  readonly highlights: readonly string[];
  readonly improvements: readonly string[];
  readonly customerMood: string;
  readonly totalTurns: number;
}

/**
 * Build a dialog string from the transcript, pairing assistant (customer) and
 * learner turns round by round.  Mirrors the Python evaluator's layout so the
 * LLM sees the same structure.
 */
function buildDialog(transcript: readonly TranscriptMessage[]): string {
  const assistantMsgs = transcript
    .filter((message) => message.role === 'assistant')
    .map((message) => message.content.slice(0, 200));
  const learnerMsgs = transcript
    .filter((message) => message.role === 'learner')
    .map((message) => message.content.slice(0, 200));

  const rounds = Math.max(assistantMsgs.length, learnerMsgs.length);
  let dialog = '';
  for (let index = 0; index < rounds; index += 1) {
    const assistantText = assistantMsgs[index] ?? '';
    const learnerText = learnerMsgs[index] ?? '';
    dialog += `客户(第${index + 1}轮): ${assistantText}\n学员(第${index + 1}轮): ${learnerText}\n`;
  }
  return dialog;
}

const STATE_DIMENSION_LABELS: ReadonlyArray<readonly [string, string]> = [
  ['emotion', '情绪'],
  ['trust', '信任度'],
  ['patience', '耐心'],
  ['consultationIntent', '咨询意愿'],
  ['purchaseIntent', '购买倾向'],
  ['decisionReadiness', '决策成熟度'],
  ['priceAcceptance', '价格接受度'],
  ['needClarity', '需求清晰度'],
  ['productFitBelief', '产品适配信念'],
  ['informationConfidence', '信息确信度'],
  ['riskConcern', '风险担忧(越低越好)'],
  ['objectionLevel', '异议强度(越低越好)'],
];

function stateNumber(value: Record<string, unknown> | null | undefined, key: string): number | null {
  if (!value) return null;
  const raw = value[key];
  return typeof raw === 'number' && Number.isFinite(raw) ? Math.round(raw) : null;
}

/** 把客户 12 维状态的“初始→最终（变化量）”整理成给评分模型看的曲线文本。 */
export function formatCustomerStateCurve(
  initial: Record<string, unknown> | null | undefined,
  final: Record<string, unknown> | null | undefined,
): string {
  if (!final) return '';
  const lines: string[] = [];
  for (const [key, label] of STATE_DIMENSION_LABELS) {
    const end = stateNumber(final, key);
    if (end === null) continue;
    const start = stateNumber(initial, key);
    if (start === null) {
      lines.push(`- ${label}(${key})：最终=${end}`);
    } else {
      const delta = end - start;
      const sign = delta > 0 ? `+${delta}` : `${delta}`;
      lines.push(`- ${label}(${key})：${start} → ${end}（${sign}）`);
    }
  }
  return lines.join('\n');
}

function buildPrompt(
  transcript: readonly TranscriptMessage[],
  customerMood: string,
  stateCurve: string,
): string {
  const dialog = buildDialog(transcript);
  const stateSection = stateCurve
    ? `\n客户心理状态变化曲线（对话中由大模型逐轮研判，初始→最终，0-100）：\n${stateCurve}\n`
      + '评分时请结合状态变化：emotion_management 看学员是否稳住/提升了客户情绪(emotion)、耐心(patience)，并降低风险担忧(riskConcern)与异议强度(objectionLevel)；'
      + 'objection_handling 结合异议强度/风险担忧的下降程度；closing_ability 结合购买倾向(purchaseIntent)、决策成熟度(decisionReadiness)、价格接受度(priceAcceptance)的提升。\n'
    : '';
  return `你是一个销售培训评分专家。请根据以下对话内容，给出五维度评分。

对话内容：
${dialog}
客户最终情绪：${customerMood}
${stateSection}
请输出 JSON 格式（只输出 JSON，不要其他内容）：
{
  "needs_discovery": 0-100,
  "product_presentation": 0-100,
  "objection_handling": 0-100,
  "emotion_management": 0-100,
  "closing_ability": 0-100,
  "highlights": ["亮点1", "亮点2"],
  "improvements": ["改进建议1", "改进建议2"]
}`;
}

/**
 * Parse a raw LLM response string into a JSON object, tolerating markdown code
 * fences, leading/trailing prose, and other minor formatting noise.
 *
 * Returns `null` when no valid JSON object can be extracted.
 */
export function parseLlmJsonResponse(content: string): Record<string, unknown> | null {
  let cleaned = content.trim();

  // Strip markdown code fences: ```json ... ``` or ``` ... ```
  cleaned = cleaned.replace(/^```(?:json)?\s*\n?/i, '').replace(/\n?```\s*$/i, '').trim();

  // Extract the outermost { ... } block.
  const firstBrace = cleaned.indexOf('{');
  const lastBrace = cleaned.lastIndexOf('}');
  if (firstBrace === -1 || lastBrace === -1 || lastBrace <= firstBrace) {
    return null;
  }
  const candidate = cleaned.slice(firstBrace, lastBrace + 1);

  try {
    const parsed: unknown = JSON.parse(candidate);
    if (typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>;
    }
    return null;
  } catch {
    return null;
  }
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function toNumberOr(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

/**
 * Pure function: call an LLM to evaluate a transcript and return a fully-formed
 * report, or `null` when the model call fails / returns unparseable output.
 *
 * Returning `null` on failure lets the caller decide whether to fall back to
 * rule-based evaluation, retry, or surface an error.
 */
export async function llmBasedEvaluate(
  params: LlmBasedEvaluateParams,
): Promise<LlmEvaluationReport | null> {
  const { transcript, customerMood, initialCustomerState, finalCustomerState, modelProvider } = params;

  const stateCurve = formatCustomerStateCurve(initialCustomerState, finalCustomerState);
  const prompt = buildPrompt(transcript, customerMood, stateCurve);

  let response;
  try {
    response = await modelProvider.generate({
      sessionId: 'llm-evaluation',
      prompt,
    });
  } catch {
    // Model timeout / upstream failure → caller decides what to do.
    return null;
  }

  const parsed = parseLlmJsonResponse(response.content);
  if (parsed === null) return null;

  const rawDimensions = {
    needs_discovery: toNumberOr(parsed.needs_discovery, 50),
    product_presentation: toNumberOr(parsed.product_presentation, 50),
    objection_handling: toNumberOr(parsed.objection_handling, 50),
    emotion_management: toNumberOr(parsed.emotion_management, 50),
    closing_ability: toNumberOr(parsed.closing_ability, 50),
  };

  const dimensionScores: DimensionScores = {
    needs_discovery: clamp(Math.round(rawDimensions.needs_discovery), 0, 100),
    product_presentation: clamp(Math.round(rawDimensions.product_presentation), 0, 100),
    objection_handling: clamp(Math.round(rawDimensions.objection_handling), 0, 100),
    emotion_management: clamp(Math.round(rawDimensions.emotion_management), 0, 100),
    closing_ability: clamp(Math.round(rawDimensions.closing_ability), 0, 100),
  };

  const score = Math.round(
    (dimensionScores.needs_discovery
      + dimensionScores.product_presentation
      + dimensionScores.objection_handling
      + dimensionScores.emotion_management
      + dimensionScores.closing_ability)
    / 5,
  );

  const highlights = Array.isArray(parsed.highlights)
    ? parsed.highlights.filter((item): item is string => typeof item === 'string')
    : [];
  const improvements = Array.isArray(parsed.improvements)
    ? parsed.improvements.filter((item): item is string => typeof item === 'string')
    : [];

  const totalTurns = transcript.filter((message) => message.role === 'assistant').length;

  return {
    schemaVersion: 'evaluation-report/v1',
    generatedBy: 'llm-evaluation/v1',
    messageCount: transcript.length,
    scoringRules: [],
    score,
    dimensionScores,
    highlights,
    improvements,
    customerMood,
    totalTurns,
  };
}

/**
 * Production adapter: tries the LLM evaluator first and transparently falls
 * back to the rule-based evaluator when the model returns invalid output or
 * throws.  Implements the same `EvaluationReportGenerator` interface as
 * `RuleBasedEvaluationReportGenerator` so the two are interchangeable in the
 * worker module.
 */
export class LlmBasedEvaluationReportGenerator implements EvaluationReportGenerator {
  public constructor(private readonly modelProvider: ModelProviderPort) {}

  public async generate(input: EvaluationInput): Promise<Record<string, unknown>> {
    const llmReport = await llmBasedEvaluate({
      transcript: input.transcript,
      customerMood: input.customerMood,
      personaConfig: input.personaConfig,
      initialCustomerState: input.initialCustomerState ?? null,
      finalCustomerState: input.finalCustomerState ?? null,
      modelProvider: this.modelProvider,
    });

    if (llmReport !== null) {
      return toReportRecord(llmReport);
    }

    // Fallback: rule-based evaluation when LLM output is unusable.
    const fallback = ruleBasedEvaluate({
      transcript: input.transcript,
      customerMood: input.customerMood,
      personaConfig: input.personaConfig,
      scoringRules: input.scoringRules,
    });
    return toReportRecord(fallback);
  }
}
