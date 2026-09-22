/**
 * 配置驱动 + 客户阶段自适应的私域陪练评分引擎（worker 端，v1）。
 *
 * 设计目标（与“开始陪练”注入的客户画像配置首尾呼应，随配置变化，不写死一套考卷）：
 * 1. 以“帮客户解决问题的能力”为第一核心，其余维度都服务于解决问题；
 * 2. 私域经营是网状、非线性的旅程：先用语义研判判定客户类型 / 所处阶段（陌生潜客 / 新粉 /
 *    礼品粉 / 首单 / 老客，信任度 1-5），再按“该阶段该做的事”打分；老客不必重新破冰，
 *    不适用的前段维度判 N/A 并把权重归一到适用维度；
 * 3. 纯 LLM 语义判断，不做关键词命中 / 文本相似度硬匹配：真实私聊随意灵活，意思到位、
 *    客户能听懂接住、方向正确即给分，不因没说某个词、没讲全卖点而扣分；
 * 4. 产品 / 症状 / 禁忌知识库只作为“事实参考系”：用于识别乱描述产品、乱推荐、踩禁忌等
 *    红线，而不是关键词清单；红线由 LLM 语义发现、代码确定性执行处罚；
 * 5. 维度、权重、知识依赖仍完全由 B 端评分配置（scoring_dimension / scoring_template）驱动。
 *
 * 流程：
 *   Call 0 客户与情境研判（语义：阶段 / 真实诉求 / 提到的产品 / 安全条件 / 维度适用性）
 *   → 仅加载被提到产品的完整事实 + 禁忌规则
 *   → Call 1..n 分组维度评分（知识组带事实，通用组带画像与阶段）
 *   → 代码：N/A 权重重分配、红线确定性处罚、加权总分
 *   → Call 教练点评（阶段 / 诉求解决情况 / 红线感知）。
 *
 * 当 input.scoringDimensions 为空时，回退到旧的 llmBasedEvaluate（向后兼容）。
 */

import type { ModelProviderPort } from '@training/contracts';
import { CUSTOMER_COHORTS, CUSTOMER_RELATIONS, TRUST_LEVELS } from '@training/contracts';
import type {
  EvaluationInput,
  EvaluationReportGenerator,
  ScoringContraindication,
  ScoringDimensionConfig,
  ScoringKnowledgeContext,
  ScoringProductFact,
} from './evaluation.processor.js';
import { formatCustomerStateCurve, llmBasedEvaluate, parseLlmJsonResponse } from './llm-evaluation-generator.js';
import type { DimensionScores, TranscriptMessage } from './rule-evaluation-generator.js';

// ============================================================
// 基础工具
// ============================================================

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

function asObject(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function asString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim().length > 0 ? value : undefined;
}

function asNumber(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

function asStringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((v): v is string => typeof v === 'string' && v.trim().length > 0) : [];
}

function buildDialog(transcript: readonly TranscriptMessage[], perMessageCap = 400): string {
  const assistantMsgs = transcript.filter((m) => m.role === 'assistant').map((m) => m.content.slice(0, perMessageCap));
  const learnerMsgs = transcript.filter((m) => m.role === 'learner').map((m) => m.content.slice(0, perMessageCap));
  const rounds = Math.max(assistantMsgs.length, learnerMsgs.length);
  let dialog = '';
  for (let i = 0; i < rounds; i += 1) {
    dialog += `客户(第${i + 1}轮): ${assistantMsgs[i] ?? ''}\n学员(第${i + 1}轮): ${learnerMsgs[i] ?? ''}\n`;
  }
  return dialog;
}

function gradeFromScore(score: number, thresholds?: Record<string, number> | null): string {
  const t = thresholds ?? { S: 90, A: 80, B: 70, C: 60 };
  // grading_rubric 可能存成 excellent/good/fair/pass，也可能存成 S/A/B/C，两种都兼容。
  const s = t.S ?? t.excellent ?? 90;
  const a = t.A ?? t.good ?? 80;
  const b = t.B ?? t.fair ?? 70;
  const c = t.C ?? t.pass ?? 60;
  if (score >= s) return 'S';
  if (score >= a) return 'A';
  if (score >= b) return 'B';
  if (score >= c) return 'C';
  return 'D';
}

// ============================================================
// 客户画像 → 评分情境简报（确定性，读“开始陪练”注入的同一份配置）
// ============================================================

type EntryStage = 'early' | 'mid' | 'late' | 'unknown';

interface PersonaBrief {
  readonly text: string;
  readonly relationId: string | null;
  readonly trustLevel: number | null;
  readonly entryStage: EntryStage;
  /** 客户明确声明的安全相关条件（过敏 / 肤质 / 人群），用于红线判断。 */
  readonly safetyAnchors: readonly string[];
}

const SKIN_LABEL: Record<string, string> = {
  dry: '干性', oily: '油性', combination: '混合性', sensitive: '敏感性', normal: '中性',
  mixed_dry: '混干性', mixed_oily: '混油性',
};
const INGREDIENT_LABEL: Record<string, string> = { none: '不关注成分', normal: '一般关注成分', focused: '非常关注成分、会逐个追问' };
const DECISION_LABEL: Record<string, string> = {
  impulse: '冲动决策', same_day: '当日决策', few_days: '需几天考虑', long_term: '长期比较、决策慢',
};

function deriveEntryStage(relationId: string | null, trust: number | null): EntryStage {
  if (relationId === 'returning' || relationId === 'first_order' || (trust !== null && trust >= 4)) return 'late';
  if (relationId === 'gift_follower' || (trust !== null && trust === 3)) return 'mid';
  if (relationId === 'prospect' || relationId === 'new_follower' || (trust !== null && trust <= 2)) return 'early';
  return 'unknown';
}

function buildPersonaBrief(rawPersona: Record<string, unknown> | null): PersonaBrief {
  const persona = asObject(rawPersona) ?? {};
  const basic = asObject(persona.basic) ?? {};
  const personality = asObject(persona.personality) ?? {};
  const communication = asObject(persona.communication) ?? {};
  const consumption = asObject(persona.consumption) ?? {};
  const conversation = asObject(persona.conversation) ?? {};

  const relationId = asString(basic.customerRelation) ?? null;
  const trustLevel = asNumber(basic.trustLevel) ?? null;
  const cohortId = asString(basic.customerCohort) ?? null;
  const relation = CUSTOMER_RELATIONS.find((r) => r.id === relationId);
  const trust = TRUST_LEVELS.find((t) => t.level === trustLevel);
  const cohort = CUSTOMER_COHORTS.find((c) => c.id === cohortId);
  const entryStage = deriveEntryStage(relationId, trustLevel);

  const skinType = asString(consumption.skinType);
  const skinConcerns = asStringArray(consumption.skinConcerns);
  const healthGoals = asStringArray(consumption.healthGoals);
  const allergies = asStringArray(consumption.allergies);
  const currentProducts = asString(consumption.currentProducts);
  const ingredientFocus = asString(consumption.ingredientFocus);
  const decisionCycle = asString(consumption.decisionCycle);

  const safetyAnchors = [
    skinType ? `肤质=${SKIN_LABEL[skinType] ?? skinType}` : '',
    ...allergies.map((a) => `过敏/禁忌：${a}`),
    ...skinConcerns.map((s) => `皮肤问题：${s}`),
    ...healthGoals.map((g) => `健康关注：${g}`),
  ].filter((s) => s.length > 0);

  const lines: string[] = [];
  const idLine: string[] = [];
  if (relation) idLine.push(`生命周期=${relation.displayName}（${relation.description}；本单目标：${relation.goal}）`);
  if (trust) idLine.push(`信任度=${trust.level}/5 ${trust.displayName}（表现：${trust.behavior}；推进策略：${trust.strategy}）`);
  if (cohort) idLine.push(`人群=${cohort.displayName}（${cohort.definition}；${cohort.salesHint}）`);
  if (idLine.length > 0) lines.push(`【客户定位】${idLine.join('；')}。`);

  const stageLabel: Record<EntryStage, string> = {
    early: '关系前段（陌生/新粉，重点在破冰建立联系与信任）',
    mid: '关系中段（已建立初步联系，重点在挖真实需求、给专业方案）',
    late: '关系后段（首单/老客、高信任，重点在专业咨询、升级连带与复购，无需重新破冰）',
    unknown: '阶段未知（按对话实际表现判断）',
  };
  lines.push(`【所处阶段判定】${stageLabel[entryStage]}`);

  if (asNumber(persona.age) !== undefined) lines.push(`【基本画像】${asNumber(persona.age)}岁${asString(persona.gender) === 'male' ? '男性' : asString(persona.gender) === 'unknown' ? '' : '女性'}，职业：${asString(persona.occupation) ?? '未设定'}。`);

  const problemLine: string[] = [];
  if (skinType) problemLine.push(`肤质 ${SKIN_LABEL[skinType] ?? skinType}`);
  if (skinConcerns.length > 0) problemLine.push(`皮肤问题：${skinConcerns.join('、')}`);
  if (healthGoals.length > 0) problemLine.push(`健康目标：${healthGoals.join('、')}`);
  if (allergies.length > 0) problemLine.push(`过敏史：${allergies.join('、')}`);
  if (currentProducts) problemLine.push(`在用产品：${currentProducts}`);
  if (problemLine.length > 0) lines.push(`【客户要解决的问题锚点】${problemLine.join('；')}。`);

  const leverLine: string[] = [];
  const priceSensitivity = asNumber(personality.priceSensitivity);
  const skepticism = asNumber(personality.skepticism);
  if (priceSensitivity !== undefined && priceSensitivity >= 65) leverLine.push('价格敏感（重点看价值塑造与预算应对）');
  if (skepticism !== undefined && skepticism >= 65) leverLine.push('戒备/怀疑度高（重点看信任建立与证据）');
  if (ingredientFocus) leverLine.push(INGREDIENT_LABEL[ingredientFocus] ?? ingredientFocus);
  if (decisionCycle) leverLine.push(DECISION_LABEL[decisionCycle] ?? decisionCycle);
  const competitor = asString(consumption.competitorComparison);
  if (competitor === 'frequently') leverLine.push('频繁对比竞品（看专业对比与异议处理）');
  const budgetMin = asNumber(consumption.budgetMin);
  const budgetMax = asNumber(consumption.budgetMax);
  if (budgetMin !== undefined && budgetMax !== undefined) leverLine.push(`预算约${budgetMin}-${budgetMax}元`);
  if (leverLine.length > 0) lines.push(`【沟通杠杆】${leverLine.join('；')}。`);

  const scenario = asString(conversation.productScenario);
  const background = asString(conversation.background);
  const customNotes = asString(conversation.customNotes);
  const scenarioLine: string[] = [];
  if (scenario) scenarioLine.push(`产品场景：${scenario}`);
  if (background) scenarioLine.push(`背景：${background}`);
  if (customNotes) scenarioLine.push(`备注：${customNotes}`);
  const difficulty = asNumber(conversation.difficulty);
  if (difficulty !== undefined) scenarioLine.push(`客户难缠度${difficulty}/4（仅作情境参考，不直接加减分）`);
  if (scenarioLine.length > 0) lines.push(`【本单场景】${scenarioLine.join('；')}。`);

  return {
    text: lines.join('\n'),
    relationId,
    trustLevel,
    entryStage,
    safetyAnchors,
  };
}

// ============================================================
// 知识快照渲染（事实参考系，不是关键词清单）
// ============================================================

function buildCompactProductIndex(products: readonly ScoringProductFact[]): string {
  if (products.length === 0) return '（产品库暂无产品，无法核对产品事实）';
  return products.map((p) => {
    const alias = p.aliases.length > 0 ? `（又称：${p.aliases.join('/')}）` : '';
    const contra = p.contraindicatedAudience ? `；禁忌：${p.contraindicatedAudience}` : '';
    const contraSkin = p.contraindicatedSkinTypes.length > 0 ? `；禁忌肤质：${p.contraindicatedSkinTypes.join('/')}` : '';
    return `- [${p.id}] ${p.name}${alias}｜${p.category}｜功效：${p.coreEfficacies.join('/') || '未标注'}｜适用肤质：${p.suitableSkinTypes.join('/') || '未标注'}${contraSkin}${contra}`;
  }).join('\n');
}

function buildProductFactSheet(product: ScoringProductFact, allProducts: readonly ScoringProductFact[]): string {
  const assocNames = product.associatedProductIds
    .map((id) => allProducts.find((p) => p.id === id)?.name)
    .filter((n): n is string => typeof n === 'string');
  return [
    `■ ${product.name}（${product.category}${product.aliases.length > 0 ? `；别称：${product.aliases.join('/')}` : ''}）`,
    `  - 核心功效：${product.coreEfficacies.join('、') || '未标注'}`,
    `  - 主要成分：${product.keyIngredients.join('、') || '未标注'}`,
    `  - 适用肤质：${product.suitableSkinTypes.join('、') || '未标注'}`,
    `  - 适用人群：${product.suitableAudience || '未标注'}`,
    `  - 适用场景/人群：${product.suitableScenarios?.length ? product.suitableScenarios.join('、') : '未标注'}`,
    `  - 价格区间：${product.priceRange || '未标注'}`,
    `  - 卖点参考：${product.keySellingPoints || '未标注'}`,
    `  - 禁忌肤质：${product.contraindicatedSkinTypes.join('、') || '无'}`,
    `  - 禁忌人群：${product.contraindicatedAudience || '无'}`,
    `  - 可连带搭配：${assocNames.join('、') || '无'}`,
  ].join('\n');
}

function buildContraSheet(
  contra: readonly ScoringContraindication[],
  products: readonly ScoringProductFact[],
): string {
  if (contra.length === 0) return '（禁忌库暂无规则；仍需依据每个产品的“禁忌肤质/禁忌人群”判断）';
  return contra.map((c) => {
    const productNames = c.forbiddenProductIds
      .map((id) => products.find((p) => p.id === id)?.name)
      .filter((n): n is string => typeof n === 'string');
    return `- 客户条件「${c.customerCondition}」→ 禁推产品：${productNames.join('、') || '（见产品名单）'}${c.forbiddenIngredients.length > 0 ? `；禁忌成分：${c.forbiddenIngredients.join('、')}` : ''}（${c.severity === 'critical' ? '严重' : '一般'}；原因：${c.reason || '未说明'}）`;
  }).join('\n');
}

// ============================================================
// Call 0：客户与情境研判
// ============================================================

interface StageAnalysis {
  readonly relationId: string | null;
  readonly trustLevel: number | null;
  readonly entryStage: EntryStage;
  readonly stageLabel: string;
  readonly stageRationale: string;
  readonly expressedProblems: readonly ExpressedProblem[];
  readonly mentionedProductIds: readonly string[];
  readonly customerConditions: readonly string[];
  readonly applicability: Readonly<Record<string, { applicable: boolean; reason: string }>>;
  readonly degraded: boolean;
}

interface ExpressedProblem {
  readonly problem: string;
  readonly configAnchor: string;
  readonly addressed: boolean;
  readonly detail: string;
}

function applicabilityHints(brief: PersonaBrief, dimensions: readonly ScoringDimensionConfig[]): string {
  // 给研判模型的“倾向性提示”，最终是否适用由模型结合真实对话裁定。
  // 仅对能从 code/name 识别出的“前段关系类维度”给 N/A 倾向，其余一律保持适用。
  return dimensions.map((d) => {
    const haystack = `${d.code} ${d.name}`;
    const isRapport = /rapport|stickiness|联系|粘性|破冰|建立联系/.test(haystack);
    const isTrust = /trust|信任/.test(haystack);
    let hint = '默认适用';
    if (brief.entryStage === 'late') {
      if (isRapport) hint = '倾向不适用：老客/高信任客户无需重新破冰，若学员未做破冰不应扣分';
      else if (isTrust) hint = '仍适用但侧重“维护/深化既有信任”，而非从零建立';
    } else if (brief.entryStage === 'early') {
      if (isRapport || isTrust) hint = '重点适用：陌生/新粉阶段，破冰与建立联系是关键';
    }
    return `  - ${d.code}（${d.name}）：${hint}`;
  }).join('\n');
}

function buildStagePrompt(
  input: EvaluationInput,
  brief: PersonaBrief,
  dimensions: readonly ScoringDimensionConfig[],
  knowledge: ScoringKnowledgeContext | null,
): string {
  const dialog = buildDialog(input.transcript as readonly TranscriptMessage[], 400);
  const dimLines = dimensions.map((d) => `- ${d.code}（${d.name}）：${d.description ?? ''}`).join('\n');
  const productIndex = knowledge && knowledge.products.length > 0
    ? `\n【产品速查表（用于语义识别学员提到的是哪款产品，允许叫法不标准；matchedProductId 必须填左方 id，不确定填空）】\n${buildCompactProductIndex(knowledge.products)}`
    : '';
  return `你是私域经营陪练的资深裁判，正在复盘一段模拟微信/企微 1v1 私聊（客户由 AI 扮演，学员是星推官/销售）。
请先做“客户与情境研判”，为后续评分提供事实底座。全程语义理解，禁止用关键词命中或文本相似度做机械判断；真实私聊口语化、信息零散，要按意思理解。

${brief.text}

【待研判维度】
${dimLines}
【维度适用性倾向（仅供参考，请结合对话实际裁定）】
${applicabilityHints(brief, dimensions)}
${productIndex}
【对话记录】
${dialog}

请只输出 JSON（不要输出任何其他内容）：
{
  "stage": {
    "relation": "prospect|new_follower|gift_follower|first_order|returning|unknown",
    "trustLevel": 0,
    "entryStage": "early|mid|late|unknown",
    "label": "一句话概括这是哪类客户、处于私域关系的哪个阶段",
    "rationale": "依据对话与画像的判断理由"
  },
  "expressedProblems": [
    { "problem": "客户在对话中真实表达的问题/诉求（按意思概括）", "configAnchor": "对应画像里的皮肤问题/健康目标，没有则留空", "addressed": true, "detail": "学员是否、以及如何解决它；未解决写明原因" }
  ],
  "mentionedProducts": [
    { "saidName": "学员原话里提到/推荐的产品叫法", "matchedProductId": "产品速查表里的 id，无法确定填\"\"", "confidence": 0 }
  ],
  "customerConditions": ["从对话语义识别出的、与安全相关的客户条件，如：敏感肌、孕期、哺乳期、痘痘急性期、对某成分过敏；没有则空数组"],
  "applicability": {
    "${dimensions[0]?.code ?? 'code'}": { "applicable": true, "reason": "该客户阶段下本维度是否需要考察" }
  },
  "notes": "其他评分时应注意的客户特征或情境"
}`;
}

function parseStageAnalysis(
  content: string,
  brief: PersonaBrief,
  dimensions: readonly ScoringDimensionConfig[],
  knowledge: ScoringKnowledgeContext | null,
): StageAnalysis {
  const parsed = parseLlmJsonResponse(content);
  const validProductIds = new Set((knowledge?.products ?? []).map((p) => p.id));

  const stageObj = parsed !== null ? asObject(parsed.stage) : null;
  const relationRaw = asString(stageObj?.relation);
  const relationId = relationRaw && relationRaw !== 'unknown' ? relationRaw : brief.relationId;
  const trustNum = asNumber(stageObj?.trustLevel);
  const trustLevel = trustNum !== null && trustNum !== undefined && trustNum >= 1 && trustNum <= 5 ? Math.round(trustNum) : brief.trustLevel;
  const stageRaw = asString(stageObj?.entryStage);
  const entryStage: EntryStage = stageRaw === 'early' || stageRaw === 'mid' || stageRaw === 'late' ? stageRaw : brief.entryStage;

  const expressedProblems: ExpressedProblem[] = [];
  const problemsRaw = parsed !== null ? parsed.expressedProblems : null;
  if (Array.isArray(problemsRaw)) {
    for (const item of problemsRaw) {
      const obj = asObject(item);
      const problem = obj ? asString(obj.problem) : undefined;
      if (!problem) continue;
      expressedProblems.push({
        problem,
        configAnchor: asString(obj?.configAnchor) ?? '',
        addressed: obj?.addressed === true,
        detail: asString(obj?.detail) ?? '',
      });
    }
  }

  const mentionedProductIds: string[] = [];
  const mentionedRaw = parsed !== null ? parsed.mentionedProducts : null;
  if (Array.isArray(mentionedRaw)) {
    for (const item of mentionedRaw) {
      const obj = asObject(item);
      const id = asString(obj?.matchedProductId);
      const confidence = asNumber(obj?.confidence) ?? 0;
      if (id && validProductIds.has(id) && confidence >= 0.6 && !mentionedProductIds.includes(id)) {
        mentionedProductIds.push(id);
      }
    }
  }

  const customerConditions: string[] = [];
  if (Array.isArray(parsed?.customerConditions)) {
    for (const c of (parsed?.customerConditions as unknown[])) {
      const v = asString(c);
      if (v) customerConditions.push(v);
    }
  }

  const applicability: Record<string, { applicable: boolean; reason: string }> = {};
  const appRaw = parsed !== null ? asObject(parsed.applicability) : null;
  for (const d of dimensions) {
    const cell = appRaw ? asObject(appRaw[d.code]) : null;
    if (cell && typeof cell.applicable === 'boolean') {
      applicability[d.code] = { applicable: cell.applicable, reason: asString(cell.reason) ?? '' };
    } else {
      applicability[d.code] = { applicable: true, reason: '' };
    }
  }

  return {
    relationId,
    trustLevel,
    entryStage,
    stageLabel: asString(stageObj?.label) ?? '',
    stageRationale: asString(stageObj?.rationale) ?? '',
    expressedProblems,
    mentionedProductIds,
    customerConditions,
    applicability,
    degraded: false,
  };
}

/** 研判调用失败时的兜底：用画像确定性推导阶段，维度全部保持适用，不丢分也不误判 N/A。 */
function fallbackStageAnalysis(brief: PersonaBrief, dimensions: readonly ScoringDimensionConfig[]): StageAnalysis {
  const applicability: Record<string, { applicable: boolean; reason: string }> = {};
  for (const d of dimensions) applicability[d.code] = { applicable: true, reason: '' };
  const labelMap: Record<EntryStage, string> = { early: '关系前段客户', mid: '关系中段客户', late: '关系后段老客', unknown: '阶段未知客户' };
  return {
    relationId: brief.relationId,
    trustLevel: brief.trustLevel,
    entryStage: brief.entryStage,
    stageLabel: labelMap[brief.entryStage],
    stageRationale: '研判服务暂不可用，阶段依据客户画像配置推导。',
    expressedProblems: brief.safetyAnchors.map((a) => ({ problem: a, configAnchor: a, addressed: false, detail: '' })),
    mentionedProductIds: [],
    customerConditions: brief.safetyAnchors,
    applicability,
    degraded: true,
  };
}

// ============================================================
// 维度评分
// ============================================================

interface RedLineViolation {
  readonly severity: 'critical' | 'warning';
  readonly type: 'misrepresentation' | 'wrong_recommendation' | 'contraindication' | 'false_promise' | string;
  readonly description: string;
  readonly evidence: string;
}

interface DimensionScoreResult {
  readonly code: string;
  readonly name: string;
  readonly score: number;
  readonly grade: string;
  readonly applicable: boolean;
  readonly applicabilityReason: string;
  readonly fallback: boolean;
  readonly reason: string;
  readonly evidence: string;
  readonly redLines: readonly RedLineViolation[];
}

const RED_LINE_TYPE_LABEL: Record<string, string> = {
  misrepresentation: '乱描述产品',
  wrong_recommendation: '乱推荐产品',
  contraindication: '触犯禁忌',
  false_promise: '虚假/绝对化承诺',
};

function dimensionNeedsKnowledge(dim: ScoringDimensionConfig): boolean {
  return dim.knowledgeDependencies.some((d) => d !== 'none');
}

function buildDimensionBlock(dim: ScoringDimensionConfig): string {
  const guidance = dim.llmGuidance ? `\n  <评分指引>${dim.llmGuidance}</评分指引>` : '';
  const thresholds = dim.gradeThresholds
    ? `\n  <分级线>${Object.entries(dim.gradeThresholds).map(([g, t]) => `${g}>=${t}`).join(', ')}</分级线>`
    : '\n  <分级线>S>=90, A>=80, B>=70, C>=60</分级线>';
  const keywords = dim.keywords.length > 0
    ? `\n  <参考词汇 仅作理解参考，禁止按是否出现这些词给分或扣分>${dim.keywords.join('、')}</参考词汇>`
    : '';
  return `<dimension code="${dim.code}" name="${dim.name}" weight="${dim.weight}">
  <说明>${dim.description ?? '暂无说明'}</说明>${guidance}${thresholds}${keywords}
</dimension>`;
}

const SCORING_PHILOSOPHY = `【评分总原则——必须严格遵守】
1. 第一核心是“帮客户解决问题的能力”：客户的真实问题有没有被听懂、被对症解决、客户能不能听明白并接受。其他一切（信任、专业、粘性、活动、成交）都服务于解决问题。
2. 这是真实微信/企微私聊，不是考试：客户和销售的表达都口语化、零散、灵活。必须按语义判断，严禁用关键词命中或句子相似度做机械评分。只要意思到位、方向正确、客户接得住，就应给应得的分；不要求把产品卖点逐条讲全，不得因为“没说某个词”而扣分。
3. 私域经营是网状、非线性的：不同客户进入的阶段不同（陌生潜客/新粉/礼品粉/首单/老客）。请严格依据“客户阶段研判”，只考察该客户当前阶段该做的事。对研判为不适用(applicable=false)的维度，直接返回 applicable=false、score=0，不要因为没做该阶段之外的事而扣分。
4. 打分要引用对话原话作为 evidence，理由具体、不空泛。分数严格对照分级线，避免普遍虚高。`;

function buildScoringPrompt(
  groupLabel: string,
  dimensions: readonly ScoringDimensionConfig[],
  input: EvaluationInput,
  brief: PersonaBrief,
  stage: StageAnalysis,
  knowledge: ScoringKnowledgeContext | null,
  stateCurve: string,
  withFacts: boolean,
): string {
  const dialog = buildDialog(input.transcript as readonly TranscriptMessage[], 500);
  const appLines = dimensions
    .map((d) => {
      const app = stage.applicability[d.code];
      return `- ${d.code}（${d.name}）：${app?.applicable === false ? `不适用（${app.reason}）` : '适用'}`;
    })
    .join('\n');
  const problemLines = stage.expressedProblems.length > 0
    ? stage.expressedProblems.map((p, i) => `${i + 1}. 诉求：${p.problem}${p.configAnchor ? `（对应配置：${p.configAnchor}）` : ''}；学员是否解决：${p.addressed ? '是' : '否/不充分'}${p.detail ? `；${p.detail}` : ''}`).join('\n')
    : '（未明确研判出客户诉求，请从对话中自行判断）';

  let factsSection = '';
  if (withFacts) {
    const parts: string[] = ['【事实参考系——只用于判断对错，不是必须复述的标准答案】'];
    // 研判识别到的产品给完整事实；识别失败/未命中时退化为全量速查表，保证可核对。
    const matched = (knowledge?.products ?? []).filter((p) => stage.mentionedProductIds.includes(p.id));
    if (matched.length > 0) {
      parts.push('学员在对话中提到/推荐的产品事实如下：');
      parts.push(matched.map((p) => buildProductFactSheet(p, knowledge?.products ?? [])).join('\n'));
    } else if (knowledge && knowledge.products.length > 0) {
      parts.push('未能预先定位具体产品，附全量产品速查表，请自行语义比对学员所述：');
      parts.push(buildCompactProductIndex(knowledge.products));
    } else {
      parts.push('（产品库为空，无法核对产品事实；请勿臆造产品信息，仅就销售应对质量评分）');
    }
    parts.push('禁忌规则：');
    parts.push(buildContraSheet(knowledge?.contraindications ?? [], knowledge?.products ?? []));
    if (stage.customerConditions.length > 0) parts.push(`客户安全相关条件（语义识别）：${stage.customerConditions.join('、')}`);
    if (brief.safetyAnchors.length > 0) parts.push(`画像声明的安全锚点：${brief.safetyAnchors.join('；')}`);
    if ((knowledge?.symptoms ?? []).length > 0) {
      parts.push('客户表达→可能功效需求的参考（语义理解用，严禁按字面关键词匹配）：');
      parts.push(knowledge!.symptoms.map((s) => `- 客户可能说“${s.customerExpressions.join(' / ')}”→诉求“${s.efficacyNeed}”`).join('\n'));
    }
    parts.push(`【红线判定规则】对照事实参考，发现以下情况必须在该维度 redLines 中逐条标注：
- misrepresentation 乱描述产品：功效/成分/用法与事实不符、张冠李戴、编造信息；
- wrong_recommendation 乱推荐：所推产品与客户诉求/肤质/条件明显不符；
- contraindication 触犯禁忌：给禁忌条件客户推荐了禁推产品/成分（critical=孕妇/破损/急性期等硬禁忌；warning=肤质不太适配等软禁忌）；
- false_promise 虚假承诺：宣称治病/根治/绝对安全/立刻见效等。
没有问题就返回空数组，严禁为凑数虚构红线。`);
    factsSection = `\n${parts.join('\n')}\n`;
  }

  const stateSection = stateCurve
    ? `\n客户12维心理状态变化（初始→最终）：\n${stateCurve}\n（可作为信任/购买意愿是否被推进的旁证，但不要替代你对对话本身的判断）\n`
    : '';

  return `你是私域经营（模拟微信/企微 1v1 私聊）的资深评分教练，正在对【${groupLabel}】打分。
${SCORING_PHILOSOPHY}

【客户阶段研判】
- 阶段：${stage.stageLabel || brief.entryStage}（entryStage=${stage.entryStage}；信任度=${stage.trustLevel ?? '未知'}）
- 研判理由：${stage.stageRationale}
${brief.text}
【本通对话客户的真实诉求与解决情况】
${problemLines}
【各维度在本客户阶段是否适用】
${appLines}
${factsSection}${stateSection}
【对话记录】
${dialog}

【待评分维度】
${dimensions.map(buildDimensionBlock).join('\n')}

只输出 JSON，不要任何其他内容。
必须为下面每一个维度都输出一个条目，维度 code 一个都不能少：${dimensions.map((d) => d.code).join('、')}。
每个 reason 控制在 80 字以内，evidence 只引用一句最关键的对话原话（可留空字符串），没有红线问题时 redLines 返回空数组，优先保证 JSON 完整不被截断：
{
  "scores": {
    "${dimensions[0]?.code ?? 'code'}": {
      "score": 0,
      "applicable": true,
      "reason": "结合该客户阶段与对话原话的具体评分理由（80字内）",
      "evidence": "引用的一句对话原话",
      "redLines": [ { "severity": "critical|warning", "type": "misrepresentation|wrong_recommendation|contraindication|false_promise", "description": "问题描述", "evidence": "对话原话" } ]
    }
  }
}`;
}

interface ParsedScoringResponse {
  readonly results: readonly DimensionScoreResult[];
  /** LLM 响应中整项缺失或 score 非数字的维度 code（不包括 isConfigured=false 的通用兜底）。 */
  readonly missingCodes: readonly string[];
  /** 响应 JSON 是否完全无法解析（通常是被 max_tokens 截断或网关返回了非评分内容）。 */
  readonly unparseable: boolean;
}

function parseScoringResponse(content: string, dimensions: readonly ScoringDimensionConfig[]): ParsedScoringResponse {
  const parsed = parseLlmJsonResponse(content);
  const scores = parsed !== null ? asObject(parsed.scores) : null;
  const missingCodes: string[] = [];
  if (scores === null) {
    dimensions.forEach((d) => missingCodes.push(d.code));
    return {
      results: dimensions.map((d): DimensionScoreResult => ({
        code: d.code, name: d.name, score: 50, grade: gradeFromScore(50, d.gradeThresholds),
        applicable: true, applicabilityReason: '', fallback: true, reason: '评分响应解析失败，使用默认分', evidence: '', redLines: [],
      })),
      missingCodes,
      unparseable: true,
    };
  }
  const results = dimensions.map((d): DimensionScoreResult => {
    const raw = asObject(scores[d.code]);
    if (raw === null) {
      missingCodes.push(d.code);
      return {
        code: d.code, name: d.name, score: 50, grade: gradeFromScore(50, d.gradeThresholds),
        applicable: true, applicabilityReason: '', fallback: true, reason: '该维度评分缺失，使用默认分', evidence: '', redLines: [],
      };
    }
    const hasNumericScore = typeof raw.score === 'number';
    if (!hasNumericScore) missingCodes.push(d.code);
    const applicable = raw.applicable !== false;
    const rawScore = hasNumericScore ? (raw.score as number) : 50;
    const score = applicable ? clamp(Math.round(rawScore), 0, 100) : 0;
    const redLines: RedLineViolation[] = [];
    if (Array.isArray(raw.redLines)) {
      for (const item of raw.redLines) {
        const obj = asObject(item);
        const description = obj ? asString(obj.description) : undefined;
        if (!description) continue;
        const severity = obj?.severity === 'critical' ? 'critical' : 'warning';
        const type = asString(obj?.type) ?? 'misrepresentation';
        const evidence = asString(obj?.evidence) ?? '';
        redLines.push({ severity, type, description, evidence });
      }
    }
    return {
      code: d.code,
      name: d.name,
      score,
      grade: gradeFromScore(score, d.gradeThresholds),
      applicable,
      applicabilityReason: asString(raw.applicabilityReason) ?? '',
      // 缺分数值视为兜底；维度未配置知识依赖时也标记为通用能力打分。
      fallback: !hasNumericScore || !d.isConfigured,
      reason: asString(raw.reason) ?? '',
      evidence: asString(raw.evidence) ?? '',
      redLines,
    };
  });
  return { results, missingCodes, unparseable: false };
}

// ============================================================
// 教练点评
// ============================================================

function buildCoachPrompt(
  input: EvaluationInput,
  brief: PersonaBrief,
  stage: StageAnalysis,
  results: readonly DimensionScoreResult[],
  totalScore: number,
  warnings: readonly string[],
  customPrompt: string,
): string {
  const dialog = buildDialog(input.transcript as readonly TranscriptMessage[], 300);
  const scoreLines = results
    .map((r) => `- ${r.name}（${r.code}）：${r.applicable ? `${r.score}分 ${r.grade}` : '本阶段不适用'}${r.reason ? `；${r.reason}` : ''}`)
    .join('\n');
  const problemLines = stage.expressedProblems
    .map((p, i) => `${i + 1}. ${p.problem}——${p.addressed ? '已解决/已回应' : '未有效解决'}${p.detail ? `（${p.detail}）` : ''}`)
    .join('\n');
  const warningBlock = warnings.length > 0 ? `\n【必须在改进建议首要指出的红线/警告问题】\n${warnings.map((w) => `- ${w}`).join('\n')}\n` : '';
  const focus = customPrompt ? `\n运营指定点评侧重：${customPrompt}\n` : '';
  return `你是一位资深私域销售教练，正在给星推官的陪练对话做复盘点评。
学员综合得分：${totalScore}分。客户阶段：${stage.stageLabel || brief.entryStage}（信任度${stage.trustLevel ?? '未知'}）。
点评主线：以“有没有帮客户把问题解决”为第一核心，并结合该客户所处私域阶段该做的事来评价；不要用关键词或话术完整度苛求学员，要肯定真实、有效、客户接得住的应对。

【客户诉求与解决情况】
${problemLines || '（无明确研判诉求）'}
${warningBlock}
【各维度得分】
${scoreLines}
${focus}
【对话记录】
${dialog}

只输出 JSON：
{
  "summary": "一句话总体评价（点明客户类型/阶段与核心问题）",
  "highlights": ["具体亮点1（引用做对了什么）", "亮点2", "亮点3"],
  "improvements": ["可执行的改进建议1", "建议2"]
}`;
}

// ============================================================
// 主生成器
// ============================================================

export class ContextAwareEvaluationReportGenerator implements EvaluationReportGenerator {
  public constructor(private readonly modelProvider: ModelProviderPort) {}

  async generate(input: EvaluationInput): Promise<Record<string, unknown>> {
    const dimensions = input.scoringDimensions ?? [];
    if (dimensions.length === 0) {
      const report = await llmBasedEvaluate({
        transcript: input.transcript as readonly TranscriptMessage[],
        personaConfig: input.personaConfig ?? undefined,
        customerMood: input.customerMood,
        initialCustomerState: input.initialCustomerState ?? null,
        finalCustomerState: input.finalCustomerState ?? null,
        modelProvider: this.modelProvider,
      });
      if (report !== null) return { ...report };
      return this.fallbackReport(input);
    }

    const knowledge = input.knowledgeContext ?? null;
    const brief = buildPersonaBrief(input.personaConfig);
    const stateCurve = formatCustomerStateCurve(input.initialCustomerState ?? null, input.finalCustomerState ?? null);

    // ── Call 0：客户与情境研判 ──
    let stage: StageAnalysis;
    try {
      const response = await this.modelProvider.generate({
        sessionId: 'context-scoring-stage',
        prompt: buildStagePrompt(input, brief, dimensions, knowledge),
        maxTokens: 4096,
      });
      stage = parseStageAnalysis(response.content, brief, dimensions, knowledge);
    } catch {
      stage = fallbackStageAnalysis(brief, dimensions);
    }

    // ── Call 1..n：维度评分（按是否依赖知识分组；尊重模板配置的 evaluation_mode） ──
    const mode = input.evaluationMode ?? 'grouped';
    const knowledgeDims = dimensions.filter(dimensionNeedsKnowledge);
    const generalDims = dimensions.filter((d) => !dimensionNeedsKnowledge(d));

    const calls: Array<{ label: string; dims: readonly ScoringDimensionConfig[]; withFacts: boolean }> = [];
    if (mode === 'single') {
      calls.push({ label: '全部维度', dims: dimensions, withFacts: knowledgeDims.length > 0 });
    } else if (mode === 'per_dimension') {
      for (const dim of dimensions) calls.push({ label: dim.name, dims: [dim], withFacts: dimensionNeedsKnowledge(dim) });
    } else {
      if (knowledgeDims.length > 0) calls.push({ label: '问题解决与专业知识组', dims: knowledgeDims, withFacts: true });
      if (generalDims.length > 0) calls.push({ label: '关系经营与沟通组', dims: generalDims, withFacts: false });
    }

    // 串行执行各评分组（避免瞬时并发触发网关限流）；每组内部对“缺失维度”有限重试并合并已得结果，
    // 只有多次仍拿不到的维度才用默认分兜底，避免一次截断/限流就让大半维度变成 50 分。
    const scoreGroup = async (
      call: { label: string; dims: readonly ScoringDimensionConfig[]; withFacts: boolean },
    ): Promise<{ results: DimensionScoreResult[]; failed: boolean }> => {
      const accepted = new Map<string, DimensionScoreResult>();
      const maxAttempts = 3;
      let hardFailure = false;

      for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
        const remaining = call.dims.filter((d) => !accepted.has(d.code));
        if (remaining.length === 0) break;
        if (attempt > 0) {
          // 退避 + 抖动，降低再次撞限流/截断的概率。
          await sleep(500 * attempt + Math.round(Math.random() * 300));
        }
        let prompt = buildScoringPrompt(call.label, remaining, input, brief, stage, knowledge, stateCurve, call.withFacts);
        if (attempt > 0) {
          const missingNames = remaining.map((d) => `${d.code}（${d.name}）`).join('、');
          prompt += `\n\n【重要·补全要求】你上一次的输出遗漏了以下维度：${missingNames}。`
            + '本次必须为上面列出的每一个维度都输出完整 score/reason/evidence，一个都不能少；'
            + 'reason 控制在 80 字以内、evidence 只引一句原话，优先保证 JSON 完整。';
        }
        try {
          const response = await this.modelProvider.generate({
            sessionId: `context-scoring-${call.label}`,
            prompt,
            maxTokens: 8192,
          });
          const parsed = parseScoringResponse(response.content, remaining);
          for (const r of parsed.results) {
            // 只采纳本次真正拿到分数的维度；missingCodes 中的仍是默认分，不写入、留待重试。
            if (!parsed.missingCodes.includes(r.code)) accepted.set(r.code, r);
          }
          hardFailure = false;
          if (parsed.missingCodes.length === 0) break;
        } catch {
          // 限流/超时/网络错误：退避后重试。
          hardFailure = true;
        }
      }

      const results = call.dims.map((d): DimensionScoreResult => {
        const got = accepted.get(d.code);
        if (got) return got;
        return {
          code: d.code, name: d.name, score: 50, grade: gradeFromScore(50, d.gradeThresholds),
          applicable: true, applicabilityReason: '', fallback: true,
          reason: '评分服务多次未返回该维度，使用默认分', evidence: '', redLines: [],
        };
      });
      // 仅当整组一个有效维度都没拿到时，才标记该组失败。
      return { results, failed: hardFailure && accepted.size === 0 };
    };

    const callResults: Array<{ results: DimensionScoreResult[]; failed: boolean }> = [];
    for (const call of calls) {
      // eslint-disable-next-line no-await-in-loop
      callResults.push(await scoreGroup(call));
    }
    const callFailed = callResults.some((r) => r.failed);
    let results = callResults.flatMap((r) => r.results);
    // 按配置 sort_order 排序
    results = [...results].sort((a, b) => {
      const da = dimensions.find((d) => d.code === a.code);
      const db = dimensions.find((d) => d.code === b.code);
      return (da?.sortOrder ?? 0) - (db?.sortOrder ?? 0);
    });

    // ── 代码确定性执行：红线处罚 + N/A 权重重分配 + 加权总分 ──
    const knowledgeDimCodes = new Set(knowledgeDims.map((d) => d.code));
    const warnings: string[] = [];
    let hasCritical = false;
    let hasWarning = false;

    const enforced = results.map((r) => {
      // 只有知识组维度携带的红线才采信（通用组没有事实依据，不据此判红线）。
      const redLines = knowledgeDimCodes.has(r.code) ? r.redLines : [];
      let score = r.score;
      const notes: string[] = [];
      for (const line of redLines) {
        const label = RED_LINE_TYPE_LABEL[line.type] ?? '产品事实问题';
        warnings.push(`【${line.severity === 'critical' ? '严重红线' : '提醒'}·${label}】${line.description}${line.evidence ? `（原话：${line.evidence}）` : ''}`);
        if (line.severity === 'critical') {
          hasCritical = true;
          score = 0;
          notes.push('触犯严重红线，本维度计0分');
        } else {
          hasWarning = true;
          score = Math.min(score, 60);
          notes.push('存在产品/适配提醒，本维度上限60分');
        }
      }
      return { ...r, redLines, score, grade: gradeFromScore(score, dimensions.find((d) => d.code === r.code)?.gradeThresholds ?? null), enforceNote: notes.join('；') };
    });

    const applicable = enforced.filter((r) => r.applicable);
    const weightedSum = applicable.reduce((sum, r) => {
      const w = dimensions.find((d) => d.code === r.code)?.weight ?? 0;
      return sum + r.score * w;
    }, 0);
    const totalWeight = applicable.reduce((sum, r) => sum + (dimensions.find((d) => d.code === r.code)?.weight ?? 0), 0);
    let totalScore = totalWeight > 0
      ? Math.round(weightedSum / totalWeight)
      : Math.round(applicable.reduce((s, r) => s + r.score, 0) / Math.max(applicable.length, 1));
    // 红线全局处罚（按最严重档执行一次，避免叠加成负分）。
    if (hasCritical) totalScore = clamp(totalScore - 15, 0, 100);
    else if (hasWarning) totalScore = clamp(totalScore - 5, 0, 100);

    // ── 教练点评 ──
    const coach = await this.callCoach(input, brief, stage, enforced, totalScore, warnings, input.coachCommentPrompt ?? '');

    // ── 组装报告（保留旧五维 dimensionScores 以兼容 C 端固定五维与学员画像聚合） ──
    const dimensionScores = this.projectLegacyDimensions(enforced, dimensions);
    const customDimensionScores = enforced.map((r) => ({
      code: r.code,
      name: r.name,
      score: r.score,
      grade: r.grade,
      applicable: r.applicable,
      weight: dimensions.find((d) => d.code === r.code)?.weight ?? 0,
      reason: [r.reason, r.enforceNote].filter(Boolean).join('；'),
      evidence: r.evidence,
      fallback: r.fallback,
      redLines: r.redLines,
    }));

    return {
      schemaVersion: 'evaluation-report/v1',
      generatedBy: 'context-aware-llm-evaluation/v1',
      messageCount: input.messageCount,
      scoringRules: input.scoringRules,
      score: totalScore,
      dimensionScores,
      customDimensionScores,
      customerStage: {
        relation: stage.relationId,
        trustLevel: stage.trustLevel,
        entryStage: stage.entryStage,
        label: stage.stageLabel,
        rationale: stage.stageRationale,
        degraded: stage.degraded,
      },
      expressedProblems: stage.expressedProblems,
      redLineViolations: enforced.flatMap((r) => r.redLines.map((l) => ({ dimensionCode: r.code, ...l }))),
      knowledgeWarnings: warnings,
      highlights: coach.highlights,
      improvements: coach.improvements,
      coachSummary: coach.summary,
      customerMood: input.customerMood,
      totalTurns: Math.ceil(input.transcript.length / 2),
      evaluationMode: mode,
      scoringTemplateId: input.scoringTemplateId ?? null,
      callFailed,
    };
  }

  private projectLegacyDimensions(
    results: readonly DimensionScoreResult[],
    dimensions: readonly ScoringDimensionConfig[],
  ): DimensionScores {
    const byCode = new Map(results.map((r) => [r.code, r]));
    const scoreOf = (codes: readonly string[]): number => {
      for (const code of codes) {
        const r = byCode.get(code) ?? results.find((x) => x.code === code);
        if (r && r.applicable) return r.score;
      }
      // 语义化兜底：按名称关键字找最接近的适用维度
      for (const code of codes) {
        const dim = dimensions.find((d) => d.code === code);
        if (!dim) continue;
        const keyword = dim.name.slice(0, 2);
        const candidate = results.find((r) => r.applicable && r.name.includes(keyword));
        if (candidate) return candidate.score;
      }
      const problem = byCode.get('problem_solving');
      if (problem?.applicable) return problem.score;
      const anyApplicable = results.find((r) => r.applicable);
      return anyApplicable?.score ?? 50;
    };
    return {
      needs_discovery: scoreOf(['needs_insight', 'needs_discovery']),
      product_presentation: scoreOf(['professionalism', 'product_accuracy', 'product_presentation']),
      objection_handling: scoreOf(['problem_solving', 'objection_handling']),
      emotion_management: scoreOf(['communication_experience', 'rapport_stickiness', 'emotion_management']),
      closing_ability: scoreOf(['closing', 'closing_ability']),
    };
  }

  private async callCoach(
    input: EvaluationInput,
    brief: PersonaBrief,
    stage: StageAnalysis,
    results: readonly DimensionScoreResult[],
    totalScore: number,
    warnings: readonly string[],
    customPrompt: string,
  ): Promise<{ summary: string; highlights: readonly string[]; improvements: readonly string[] }> {
    try {
      const response = await this.modelProvider.generate({
        sessionId: 'context-coach-comment',
        prompt: buildCoachPrompt(input, brief, stage, results, totalScore, warnings, customPrompt),
        maxTokens: 3000,
      });
      const parsed = parseLlmJsonResponse(response.content);
      if (parsed !== null) {
        return {
          summary: typeof parsed.summary === 'string' ? parsed.summary : '',
          highlights: Array.isArray(parsed.highlights) ? parsed.highlights.filter((x): x is string => typeof x === 'string') : [],
          improvements: Array.isArray(parsed.improvements) ? parsed.improvements.filter((x): x is string => typeof x === 'string') : [],
        };
      }
    } catch {
      // 点评失败不影响评分
    }
    return { summary: '', highlights: [], improvements: [] };
  }

  private fallbackReport(input: EvaluationInput): Record<string, unknown> {
    return {
      schemaVersion: 'evaluation-report/v1',
      generatedBy: 'context-aware-llm-evaluation/v1-fallback',
      messageCount: input.messageCount,
      scoringRules: input.scoringRules,
      score: 50,
      dimensionScores: { needs_discovery: 50, product_presentation: 50, objection_handling: 50, emotion_management: 50, closing_ability: 50 },
      customDimensionScores: [],
      highlights: [],
      improvements: ['评分服务暂时不可用，请稍后查看评分结果'],
      customerMood: input.customerMood,
      totalTurns: Math.ceil(input.transcript.length / 2),
    };
  }
}
