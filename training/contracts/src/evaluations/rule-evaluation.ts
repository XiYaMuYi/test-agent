/**
 * Pure, side-effect-free rule-based sales evaluation.
 *
 * This is the single source of truth for the keyword-driven rubric used by both
 * the API (synchronous on-demand scoring) and the worker (async report
 * generation). Extracting it into `@training/contracts` prevents the two
 * consumers from drifting apart: they share the same keywords, the same caps,
 * and the same dimension floor.
 */

export interface TranscriptMessage {
  readonly role: 'learner' | 'assistant';
  readonly content: string;
}

export interface RuleBasedEvaluateParams {
  readonly transcript: readonly TranscriptMessage[];
  readonly personaConfig?: unknown;
  readonly customerMood: string;
  readonly scoringRules?: readonly unknown[];
}

export interface DimensionScores {
  readonly needs_discovery: number;
  readonly product_presentation: number;
  readonly objection_handling: number;
  readonly emotion_management: number;
  readonly closing_ability: number;
}

export interface RuleBasedEvaluationReport {
  readonly schemaVersion: 'evaluation-report/v1';
  readonly generatedBy: 'rule-evaluation/v1';
  readonly messageCount: number;
  readonly scoringRules: readonly unknown[];
  readonly score: number;
  readonly dimensionScores: DimensionScores;
  readonly highlights: readonly string[];
  readonly improvements: readonly string[];
  readonly customerMood: string;
  readonly totalTurns: number;
}

const DISCOVERY_KEYWORDS: readonly string[] = [
  '需求', '需要', '想要', '关注', '在意', '预算', '肤质', '皮肤', '问题', '困扰',
];

const PRODUCT_KEYWORDS: readonly string[] = [
  '产品', '成分', '效果', '功效', '特点', '优势', '推荐', '适合', '精华', '面霜', '套装', '护肤', '抗老', '美白',
];

const OBJECTION_KEYWORDS: readonly string[] = [
  '因为', '我们的', '您可以', '确实',
];

const CLOSING_KEYWORDS: readonly string[] = [
  '购买', '下单', '试试', '买', '成交', '订购',
];

const DIMENSION_FLOOR = 20;

function keywordScore(text: string, keywords: readonly string[], perHit: number, cap: number): number {
  let raw = 0;
  for (const kw of keywords) {
    if (text.includes(kw)) {
      raw += perHit;
    }
  }
  return Math.min(cap, raw);
}

function joinText(messages: readonly TranscriptMessage[], role: TranscriptMessage['role']): string {
  return messages
    .filter((message) => message.role === role)
    .map((message) => message.content)
    .join(' ');
}

function excerpt(content: string, maxLength = 22): string {
  const normalized = content.replace(/\s+/g, ' ').trim();
  return normalized.length > maxLength ? `${normalized.slice(0, maxLength)}...` : normalized;
}

function latestLearnerMessage(transcript: readonly TranscriptMessage[]): string {
  return [...transcript].reverse().find((message) => message.role === 'learner')?.content ?? '';
}

function latestAssistantMessage(transcript: readonly TranscriptMessage[]): string {
  return [...transcript].reverse().find((message) => message.role === 'assistant')?.content ?? '';
}

function learnerMessageWith(
  transcript: readonly TranscriptMessage[],
  keywords: readonly string[],
): string | undefined {
  return [...transcript]
    .reverse()
    .find((message) => message.role === 'learner' && keywords.some((keyword) => message.content.includes(keyword)))
    ?.content;
}

export function ruleBasedEvaluate(params: RuleBasedEvaluateParams): RuleBasedEvaluationReport {
  const { transcript, customerMood, scoringRules = [] } = params;

  const learnerText = joinText(transcript, 'learner');
  const assistantText = joinText(transcript, 'assistant');

  const needsDiscoveryRaw = keywordScore(learnerText, DISCOVERY_KEYWORDS, 15, 100);
  const productPresentationRaw = keywordScore(learnerText, PRODUCT_KEYWORDS, 15, 100);

  const objectionHandled = OBJECTION_KEYWORDS.some((keyword) => assistantText.includes(keyword));
  const objectionHandlingRaw = objectionHandled ? 60 : 30;

  const emotionByMood: Record<string, number> = { positive: 85, neutral: 60, negative: 40 };
  const emotionManagementRaw = emotionByMood[customerMood] ?? 60;

  const closingAbilityRaw = keywordScore(learnerText, CLOSING_KEYWORDS, 20, 100);

  const dimensionScores: DimensionScores = {
    needs_discovery: Math.max(DIMENSION_FLOOR, needsDiscoveryRaw),
    product_presentation: Math.max(DIMENSION_FLOOR, productPresentationRaw),
    objection_handling: Math.max(DIMENSION_FLOOR, objectionHandlingRaw),
    emotion_management: Math.max(DIMENSION_FLOOR, emotionManagementRaw),
    closing_ability: Math.max(DIMENSION_FLOOR, closingAbilityRaw),
  };

  const score = Math.round(
    (dimensionScores.needs_discovery
      + dimensionScores.product_presentation
      + dimensionScores.objection_handling
      + dimensionScores.emotion_management
      + dimensionScores.closing_ability)
    / 5,
  );

  const highlights: string[] = [];
  const improvements: string[] = [];
  const latestLearner = latestLearnerMessage(transcript);
  const latestAssistant = latestAssistantMessage(transcript);
  const learnerContext = latestLearner || '本场尚未发送销售话术';
  const customerContext = latestAssistant || '客户暂未给出进一步回应';
  const discoveryMessage = learnerMessageWith(transcript, DISCOVERY_KEYWORDS);
  const productMessage = learnerMessageWith(transcript, PRODUCT_KEYWORDS);

  if (dimensionScores.needs_discovery >= 60) {
    highlights.push(`你用“${excerpt(discoveryMessage ?? learnerContext)}”主动触及了客户需求。`);
  } else {
    improvements.push(`针对“${excerpt(learnerContext)}”，下一句可追问肤质、预算或当前困扰，先确认需求再推荐。`);
  }

  if (dimensionScores.product_presentation >= 60) {
    highlights.push(`你提到了“${excerpt(productMessage ?? learnerContext)}”，已经开始把产品与客户场景关联。`);
  } else {
    improvements.push(`在“${excerpt(learnerContext)}”后，补充一个具体产品卖点，并说明它如何解决客户刚提到的问题。`);
  }

  if (dimensionScores.emotion_management >= 70) {
    highlights.push('客户最终态度积极，你保持了顺畅的沟通节奏。');
  } else {
    improvements.push(`客户回应“${excerpt(customerContext)}”仍在观望；先确认这项顾虑，再用一句对应卖点回应，不要连续堆叠卖点。`);
  }

  if (dimensionScores.closing_ability >= 60) {
    highlights.push(`你在“${excerpt(learnerMessageWith(transcript, CLOSING_KEYWORDS) ?? learnerContext)}”中尝试推进下一步。`);
  } else {
    improvements.push(`在客户回应“${excerpt(customerContext)}”后，可接“要不要我按你的需求推荐一款？”这类低压力问题，推进下一步。`);
  }

  if (customerMood === 'positive') {
    highlights.push('客户最终态度积极');
  }

  const totalTurns = transcript.filter((message) => message.role === 'assistant').length;

  return {
    schemaVersion: 'evaluation-report/v1',
    generatedBy: 'rule-evaluation/v1',
    messageCount: transcript.length,
    scoringRules,
    score,
    dimensionScores,
    highlights,
    improvements,
    customerMood,
    totalTurns,
  };
}
