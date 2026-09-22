/**
 * LLM 评分引擎 - 防幻觉知识增强型大模型评分（v2）。
 *
 * 核心防幻觉设计：
 * 1. 按知识依赖分组调用：不同知识类型的维度分开 LLM 调用，避免规则交叉污染
 * 2. XML 标签严格隔离每个维度：LLM 必须按每个 dimension 块内的规则独立评分
 * 3. 知识按维度精准注入：只给需要产品知识的维度看产品库，不全局注入
 * 4. 三重校验层：结构校验 / 分级一致性校验 / 禁忌硬规则校验，LLM 输出不直接信任
 * 5. 教练点评独立调用：点评阶段不注入维度知识，只基于评分结果展开
 * 6. 配置缺失兜底标注：未配置维度明确告知 LLM 用通用能力评分并标注 fallbackNote
 *
 * evaluation_mode：
 * - grouped（默认推荐）：按知识依赖分组并行调用，平衡质量和延迟
 * - per_dimension：每个维度独立调用，质量最高但延迟最长
 * - single：单次全量调用（兼容旧模式，延迟最低但有混淆风险）
 */

import type {
  Grade,
  KnowledgeMatchResult,
  LLMDimensionScore,
  LLMEvaluationReport,
  LLMPromptContext,
  ModelProviderPort,
  ScoringDimension,
} from '@training/contracts';
import { DEFAULT_GLOBAL_RULES, gradeFromScore } from '@training/contracts';

// ============================================================
// 分组类型
// ============================================================

type KnowledgeGroupKey = 'products' | 'symptom_efficacy' | 'contraindications' | 'none';

interface DimensionGroup {
  readonly key: KnowledgeGroupKey;
  readonly label: string;
  readonly dimensions: readonly ScoringDimension[];
}

interface GroupScoringResult {
  readonly groupKey: KnowledgeGroupKey;
  readonly dimensionScores: readonly LLMDimensionScore[];
  readonly rawResponse: string;
  readonly callFailed: boolean;
}

interface CoachComment {
  readonly highlights: readonly string[];
  readonly improvements: readonly string[];
  readonly summary: string;
}

// ============================================================
// 1. 按知识依赖分组
// ============================================================

const KNOWLEDGE_GROUP_ORDER: readonly KnowledgeGroupKey[] = ['products', 'symptom_efficacy', 'contraindications', 'none'];

const KNOWLEDGE_GROUP_LABELS: Readonly<Record<KnowledgeGroupKey, string>> = {
  products: '产品知识组',
  symptom_efficacy: '症状功效映射组',
  contraindications: '禁忌安全组',
  none: '通用能力组',
};

function dimensionPrimaryGroup(dim: ScoringDimension): KnowledgeGroupKey {
  const deps = dim.knowledgeDependencies ?? [];
  if (deps.includes('products')) return 'products';
  if (deps.includes('symptom_efficacy')) return 'symptom_efficacy';
  if (deps.includes('contraindications')) return 'contraindications';
  return 'none';
}

/**
 * 按知识依赖类型分组维度。
 * - product 组：依赖产品库的维度
 * - symptom 组：依赖症状功效映射的维度
 * - contraindication 组：依赖禁忌库的维度
 * - none 组：无知识依赖的维度（纯通用能力）
 *
 * 同组维度共享知识上下文，合并到一次 LLM 调用；
 * 不同组分开调用，避免知识交叉污染。
 */
export function groupDimensionsByKnowledge(dimensions: readonly ScoringDimension[]): readonly DimensionGroup[] {
  const groupsMap = new Map<KnowledgeGroupKey, ScoringDimension[]>();
  for (const key of KNOWLEDGE_GROUP_ORDER) {
    groupsMap.set(key, []);
  }
  for (const dim of dimensions) {
    const key = dimensionPrimaryGroup(dim);
    groupsMap.get(key)!.push(dim);
  }
  return KNOWLEDGE_GROUP_ORDER
    .filter((key) => (groupsMap.get(key)?.length ?? 0) > 0)
    .map((key) => ({
      key,
      label: KNOWLEDGE_GROUP_LABELS[key],
      dimensions: groupsMap.get(key)!,
    }));
}

// ============================================================
// 2. 知识按维度精准注入
// ============================================================

function filterKnowledgeForGroup(
  knowledge: KnowledgeMatchResult | null,
  groupKey: KnowledgeGroupKey,
): string {
  if (!knowledge) return '';
  const lines: string[] = [];

  if (groupKey === 'products') {
    if (knowledge.mentionedProducts.length > 0) {
      lines.push(`学员推荐的产品：${knowledge.mentionedProducts.map((p) => `${p.productName}（原话提到"${p.matchedByName}"）`).join('、')}`);
    }
    if (knowledge.productEfficacyMatch.length > 0) {
      lines.push(...knowledge.productEfficacyMatch.map((m) =>
        `产品对症度：${m.productName} 匹配度${m.matchScore}%（覆盖：${m.coveredNeeds.join('、') || '无'}；遗漏：${m.missedNeeds.join('、') || '无'}）`,
      ));
    }
    if (knowledge.associationRecommendation.suggestedAssociations.length > 0) {
      lines.push(`建议连带推荐但未推荐：${knowledge.associationRecommendation.suggestedAssociations.join('、')}`);
    }
  }

  if (groupKey === 'symptom_efficacy') {
    if (knowledge.customerEfficacyNeeds.length > 0) {
      lines.push(`客户表达的功效需求：${knowledge.customerEfficacyNeeds.map((n) => `${n.expression}→${n.efficacyNeed}`).join('、')}`);
    }
  }

  if (groupKey === 'contraindications') {
    if (knowledge.contraindicationHits.length > 0) {
      lines.push(`⚠️ 禁忌命中：${knowledge.contraindicationHits.map((h) => `${h.customerCondition}→${h.productName}（${h.reason}，严重度：${h.severity}）`).join('；')}`);
    }
  }

  return lines.length > 0 ? lines.join('\n') : '';
}

// ============================================================
// 3. 分组 prompt 构建（XML 标签严格隔离每个维度）
// ============================================================

function buildTranscriptText(transcript: LLMPromptContext['transcript']): string {
  return transcript
    .map((m) => `${m.role === 'learner' ? '学员（销售员）' : '客户（AI 顾客）'}：${m.content}`)
    .join('\n');
}

function buildDimensionXml(dim: ScoringDimension, knowledgeText: string): string {
  const configuredLabel = dim.isConfigured ? 'true' : 'false';
  const rubric = dim.gradingRubric;
  const knowledgeBlock = knowledgeText
    ? `    <knowledge>
${knowledgeText.split('\n').map((l) => `      ${l}`).join('\n')}
    </knowledge>`
    : '';
  const guidance = dim.llmPrompt ? `    <llm_guidance>${dim.llmPrompt}</llm_guidance>` : '';
  const keywords = dim.keywords.length > 0 ? `    <reference_keywords>${dim.keywords.join('、')}</reference_keywords>` : '';

  return `  <dimension code="${dim.code}" name="${dim.name}" weight="${dim.weight}" configured="${configuredLabel}">
    <description>${dim.description || '无'}</description>
    <rubric>S≥${rubric.excellent} A≥${rubric.good} B≥${rubric.fair} C≥${rubric.pass} D<${rubric.pass}</rubric>
${knowledgeBlock}
${guidance}
${keywords}
  </dimension>`;
}

/**
 * 为一组维度构建独立的评分 prompt。
 *
 * 关键防幻觉指令：
 * - 必须严格按照每个 dimension 块内的规则和知识独立评分
 * - 不得跨维度引用规则或知识
 * - 每个 dimension 的 knowledge 块仅对该维度有效
 * - 未配置维度（configured=false）必须 isFallback=true 并填写 fallbackNote
 */
export function buildGroupScoringPrompt(
  group: DimensionGroup,
  transcript: LLMPromptContext['transcript'],
  knowledge: KnowledgeMatchResult | null,
  globalRules: readonly string[],
): string {
  const transcriptText = buildTranscriptText(transcript);
  const knowledgeText = filterKnowledgeForGroup(knowledge, group.key);

  const dimensionsXml = group.dimensions
    .map((dim) => buildDimensionXml(dim, filterKnowledgeForGroup(knowledge, dimensionPrimaryGroup(dim))))
    .join('\n');

  const rulesText = (globalRules.length > 0 ? globalRules : DEFAULT_GLOBAL_RULES)
    .map((r, i) => `${i + 1}. ${r}`)
    .join('\n');

  const knowledgeSection = knowledgeText
    ? `【本组知识依据（仅对本组维度有效，不得跨组引用）】
${knowledgeText}`
    : '【本组知识依据】本组维度不依赖外部知识库，按通用销售能力评分。';

  return [
    `你是一名资深的销售培训评审官，正在对「${group.label}」的维度进行评分。`,
    '你的评分是最终权威评分，必须严格按照下方每个 dimension 块内的规则和知识独立执行。',
    '',
    '【重要防混淆规则】',
    '1. 必须严格按照每个 <dimension> 块内的规则和知识独立评分，不得跨维度引用规则或知识。',
    '2. 每个 dimension 的 <knowledge> 块仅对该维度有效，其他维度不得引用。',
    '3. configured="false" 的维度表示该维度配置暂未完善，你必须根据通用销售能力评分，并在 fallbackNote 中标注。',
    '',
    '【对话记录】',
    transcriptText,
    '',
    knowledgeSection,
    '',
    '【本组评分维度配置】',
    '<dimensions>',
    dimensionsXml,
    '</dimensions>',
    '',
    '【全局评分规则】',
    rulesText,
    '',
    '【输出要求 - 必须严格遵守】',
    '1. 输出纯 JSON，不要任何额外文字、解释或 markdown 代码块标记。',
    '2. JSON 结构如下：',
    '{',
    '  "dimensionScores": [',
    '    {',
    '      "code": "维度code",',
    '      "score": 0-100整数,',
    '      "rationale": "评分依据，必须引用对话中的具体话术原文，不得空泛",',
    '      "isFallback": true/false,',
    '      "fallbackNote": "仅当 isFallback=true 时填写，格式：【该维度配置因为暂时没有配置，LLM根据通用能力打出xx分】",',
    '      "knowledgeEvidence": "可选，引用知识依据中的具体证据"',
    '    }',
    '  ]',
    '}',
    '3. 每个维度的 isFallback 必须与上方配置的 configured 属性一致。',
    '4. rationale 必须具体，禁止"表现良好"、"有待提高"这类空泛评价。',
  ].join('\n');
}

// ============================================================
// 4. 教练点评独立调用 prompt
// ============================================================

export function buildCoachCommentPrompt(
  dimensionScores: readonly LLMDimensionScore[],
  transcript: LLMPromptContext['transcript'],
  coachCommentPrompt: string,
): string {
  const transcriptText = buildTranscriptText(transcript);
  const scoresText = dimensionScores
    .map((ds) => {
      const fallback = ds.isFallback ? `（LLM 通用能力兜底：${ds.fallbackNote ?? ''}）` : '';
      return `- ${ds.dimensionName}：${ds.score}分（${ds.grade}）${fallback}\n  依据：${ds.rationale}`;
    })
    .join('\n');

  const guidance = coachCommentPrompt?.trim()
    ? `【点评引导】\n${coachCommentPrompt}`
    : '';

  return [
    '你是一名资深的销售培训教练，正在根据学员的模拟陪练评分结果生成教练点评。',
    '你的点评必须基于以下评分结果展开，不得凭空生成与评分结果矛盾的评价。',
    '',
    guidance,
    '',
    '【各维度评分结果】',
    scoresText,
    '',
    '【对话记录摘要】',
    transcriptText,
    '',
    '【输出要求 - 必须严格遵守】',
    '1. 输出纯 JSON，不要任何额外文字、解释或 markdown 代码块标记。',
    '2. JSON 结构如下：',
    '{',
    '  "highlights": ["亮点1（必须基于评分结果中的具体表现）", "亮点2"],',
    '  "improvements": ["改进建议1（必须针对评分结果中的不足）", "改进建议2"],',
    '  "summary": "总体评价一句话，必须与总分和各维度表现一致"',
    '}',
    '3. highlights 和 improvements 各 2-3 条，必须具体，禁止空泛。',
    '4. summary 必须与总分一致：高分（≥80）以肯定为主，中分（60-79）肯定+改进，低分（<60）以改进为主。',
  ].filter(Boolean).join('\n');
}

// ============================================================
// 5. 三重校验层
// ============================================================

interface RawDimensionScore {
  readonly code?: string;
  readonly score?: number;
  readonly rationale?: string;
  readonly isFallback?: boolean;
  readonly fallbackNote?: string;
  readonly knowledgeEvidence?: string;
}

/**
 * 三重校验单个维度评分：
 * 1. 结构校验：分数 0-100，isFallback 与配置一致
 * 2. 分级校验：用配置的 rubric 重新计算 grade，不信任 LLM
 * 3. 禁忌校验：禁忌命中(critical)的维度得分不得超过 30
 *
 * 校验不通过时自动修正，修正记录体现在 rationale 中。
 */
export function validateDimensionScore(
  raw: RawDimensionScore | undefined,
  dim: ScoringDimension,
  hasCriticalContraindication: boolean,
): LLMDimensionScore {
  // 结构校验：分数越界 clamp，缺失用 50 兜底
  const rawScore = typeof raw?.score === 'number' && Number.isFinite(raw.score) ? raw.score : 50;
  let score = Math.max(0, Math.min(100, Math.round(rawScore)));

  // 结构校验：isFallback 必须与配置一致
  const isFallback = !dim.isConfigured;

  // 禁忌校验：禁忌命中(critical)的维度得分不得超过 30
  let rationale = raw?.rationale?.trim() || '（LLM 未提供该维度评分依据）';
  if (hasCriticalContraindication && dimensionPrimaryGroup(dim) === 'contraindications' && score > 30) {
    score = 30;
    rationale += '（系统强制：禁忌命中，得分上限30）';
  }

  // 分级校验：用配置的 rubric 重新计算 grade
  const grade = gradeFromScore(score, dim.gradingRubric);

  const fallbackNote = isFallback
    ? raw?.fallbackNote?.trim() || `【${dim.name}维度配置因为暂时没有配置，LLM根据通用能力打出${score}分】`
    : null;

  const knowledgeEvidence = raw?.knowledgeEvidence?.trim() || null;

  return {
    dimensionCode: dim.code,
    dimensionName: dim.name,
    score,
    grade,
    rationale,
    isFallback,
    ...(fallbackNote ? { fallbackNote } : {}),
    ...(knowledgeEvidence ? { knowledgeEvidence } : {}),
  };
}

function parseGroupResponse(raw: string): RawDimensionScore[] {
  try {
    let jsonStr = raw.trim();
    const codeBlockMatch = jsonStr.match(/```(?:json)?\s*([\s\S]*?)```/i);
    if (codeBlockMatch && codeBlockMatch[1]) {
      jsonStr = codeBlockMatch[1].trim();
    }
    const firstBrace = jsonStr.indexOf('{');
    const lastBrace = jsonStr.lastIndexOf('}');
    if (firstBrace >= 0 && lastBrace > firstBrace) {
      jsonStr = jsonStr.slice(firstBrace, lastBrace + 1);
    }
    const parsed = JSON.parse(jsonStr) as { dimensionScores?: RawDimensionScore[] };
    return Array.isArray(parsed.dimensionScores) ? parsed.dimensionScores : [];
  } catch {
    return [];
  }
}

function parseCoachCommentResponse(raw: string): CoachComment {
  try {
    let jsonStr = raw.trim();
    const codeBlockMatch = jsonStr.match(/```(?:json)?\s*([\s\S]*?)```/i);
    if (codeBlockMatch && codeBlockMatch[1]) {
      jsonStr = codeBlockMatch[1].trim();
    }
    const firstBrace = jsonStr.indexOf('{');
    const lastBrace = jsonStr.lastIndexOf('}');
    if (firstBrace >= 0 && lastBrace > firstBrace) {
      jsonStr = jsonStr.slice(firstBrace, lastBrace + 1);
    }
    const parsed = JSON.parse(jsonStr) as {
      highlights?: unknown[];
      improvements?: unknown[];
      summary?: string;
    };
    return {
      highlights: Array.isArray(parsed.highlights)
        ? parsed.highlights.filter((item): item is string => typeof item === 'string').slice(0, 3)
        : [],
      improvements: Array.isArray(parsed.improvements)
        ? parsed.improvements.filter((item): item is string => typeof item === 'string').slice(0, 3)
        : [],
      summary: typeof parsed.summary === 'string' ? parsed.summary : '',
    };
  } catch {
    return { highlights: [], improvements: [], summary: '' };
  }
}

// ============================================================
// 6. 防幻觉评分服务实现
// ============================================================

export interface GroupedScoringParams {
  readonly context: LLMPromptContext;
  readonly modelProvider: ModelProviderPort;
  /** 评分策略：grouped/per_dimension/single */
  readonly evaluationMode?: 'grouped' | 'per_dimension' | 'single';
  /** 教练点评全局引导语 */
  readonly coachCommentPrompt?: string;
  /** 会话 ID（用于模型调用追踪） */
  readonly sessionId?: string;
}

/**
 * 防幻觉 LLM 评分服务。
 *
 * 执行流程：
 * 1. 按 evaluationMode 分组维度
 * 2. 每组并行调用 LLM（XML 隔离 + 知识精准注入）
 * 3. 三重校验每组返回的维度评分
 * 4. 汇总所有维度评分，计算加权总分
 * 5. 独立调用 LLM 生成教练点评（不注入知识，只基于评分结果）
 */
export class GroupedLLMScoringService {
  async score(params: GroupedScoringParams): Promise<LLMEvaluationReport> {
    const { context, modelProvider, evaluationMode = 'grouped', coachCommentPrompt = '', sessionId = 'llm-scoring' } = params;
    const { transcript, dimensions, knowledgeMatch, globalRules } = context;
    const knowledge = knowledgeMatch ?? null;

    const hasCriticalContraindication = (knowledge?.contraindicationHits ?? [])
      .some((h) => h.severity === 'critical');

    // 1. 按模式分组
    let groups: readonly DimensionGroup[];
    if (evaluationMode === 'per_dimension') {
      // 每维度独立一组
      groups = dimensions.map((dim) => ({
        key: dimensionPrimaryGroup(dim),
        label: `${dim.name}（独立评分）`,
        dimensions: [dim],
      }));
    } else if (evaluationMode === 'single') {
      // 单次全量（兼容旧模式）
      groups = [{ key: 'none', label: '全量评分', dimensions }];
    } else {
      // grouped（默认）：按知识依赖分组
      groups = groupDimensionsByKnowledge(dimensions);
    }

    // 2. 每组并行调用 LLM
    const groupResults = await Promise.all(
      groups.map(async (group): Promise<GroupScoringResult> => {
        const prompt = buildGroupScoringPrompt(group, transcript, knowledge, globalRules);
        try {
          const response = await modelProvider.generate({
            sessionId: `${sessionId}-group-${group.key}`,
            prompt,
          });
          const rawScores = parseGroupResponse(response.content);
          const dimensionScores = group.dimensions.map((dim) => {
            const raw = rawScores.find((r) => r.code === dim.code);
            return validateDimensionScore(raw, dim, hasCriticalContraindication);
          });
          return { groupKey: group.key, dimensionScores, rawResponse: response.content, callFailed: false };
        } catch {
          // 该组调用失败：所有维度用 50 分兜底，标记 fallback
          const dimensionScores = group.dimensions.map((dim) => validateDimensionScore(undefined, dim, hasCriticalContraindication));
          return { groupKey: group.key, dimensionScores, rawResponse: '', callFailed: true };
        }
      }),
    );

    // 3. 汇总所有维度评分
    const allDimensionScores: LLMDimensionScore[] = [];
    for (const gr of groupResults) {
      allDimensionScores.push(...gr.dimensionScores);
    }
    // 按配置维度顺序对齐
    const orderedDimensionScores = dimensions.map((dim) => {
      const found = allDimensionScores.find((ds) => ds.dimensionCode === dim.code);
      return found ?? validateDimensionScore(undefined, dim, hasCriticalContraindication);
    });

    // 4. 计算加权总分
    const totalWeight = orderedDimensionScores.reduce((sum, ds) => {
      const dim = dimensions.find((d) => d.code === ds.dimensionCode);
      return sum + (dim?.weight ?? 0);
    }, 0);
    const totalScore = totalWeight > 0
      ? Math.round(
          orderedDimensionScores.reduce((sum, ds) => {
            const dim = dimensions.find((d) => d.code === ds.dimensionCode);
            return sum + ds.score * (dim?.weight ?? 0);
          }, 0) / totalWeight,
        )
      : Math.round(orderedDimensionScores.reduce((s, d) => s + d.score, 0) / Math.max(orderedDimensionScores.length, 1));

    const fallbackDimensions = orderedDimensionScores.filter((d) => d.isFallback).map((d) => d.dimensionCode);

    // 5. 独立调用 LLM 生成教练点评
    let coachComment: CoachComment = { highlights: [], improvements: [], summary: '' };
    try {
      const commentPrompt = buildCoachCommentPrompt(orderedDimensionScores, transcript, coachCommentPrompt);
      const commentResponse = await modelProvider.generate({
        sessionId: `${sessionId}-coach-comment`,
        prompt: commentPrompt,
      });
      coachComment = parseCoachCommentResponse(commentResponse.content);
    } catch {
      // 点评调用失败：用维度评分生成简单摘要
      coachComment = {
        highlights: orderedDimensionScores.filter((d) => d.score >= 80).map((d) => `${d.dimensionName}表现优秀（${d.score}分）`),
        improvements: orderedDimensionScores.filter((d) => d.score < 60).map((d) => `${d.dimensionName}需要加强（${d.score}分）`),
        summary: `本次模拟陪练总评 ${totalScore} 分，${totalScore >= 80 ? '整体表现优秀' : totalScore >= 60 ? '整体表现中等，有提升空间' : '整体表现有待加强'}。`,
      };
    }

    return {
      schemaVersion: 'llm-evaluation/v2',
      totalScore: Math.max(0, Math.min(100, totalScore)),
      totalGrade: gradeFromScore(totalScore),
      dimensionScores: orderedDimensionScores,
      highlights: coachComment.highlights,
      improvements: coachComment.improvements,
      summary: coachComment.summary,
      fallbackDimensions,
      knowledgeWarnings: hasCriticalContraindication ? ['存在禁忌命中，相关维度得分已被系统强制上限30分'] : [],
    };
  }
}

// ============================================================
// 兼容旧模式（single 模式使用的旧函数，保留用于向后兼容）
// ============================================================

/** @deprecated 使用 buildGroupScoringPrompt 替代，此函数仅用于 single 模式兼容 */
export function buildScoringPrompt(context: LLMPromptContext): string {
  const { transcript, dimensions, knowledgeMatch, globalRules } = context;
  const group: DimensionGroup = { key: 'none', label: '全量评分', dimensions };
  return buildGroupScoringPrompt(group, transcript, knowledgeMatch ?? null, globalRules);
}

/** @deprecated 使用 validateDimensionScore + GroupedLLMScoringService 替代 */
export function parseLLMScoringResponse(
  raw: string,
  dimensions: readonly ScoringDimension[],
): LLMEvaluationReport | null {
  const rawScores = parseGroupResponse(raw);
  if (rawScores.length === 0) return null;
  const dimensionScores = dimensions.map((dim) => {
    const raw = rawScores.find((r) => r.code === dim.code);
    return validateDimensionScore(raw, dim, false);
  });
  const totalWeight = dimensionScores.reduce((sum, ds) => {
    const dim = dimensions.find((d) => d.code === ds.dimensionCode);
    return sum + (dim?.weight ?? 0);
  }, 0);
  const totalScore = totalWeight > 0
    ? Math.round(dimensionScores.reduce((sum, ds) => {
        const dim = dimensions.find((d) => d.code === ds.dimensionCode);
        return sum + ds.score * (dim?.weight ?? 0);
      }, 0) / totalWeight)
    : Math.round(dimensionScores.reduce((s, d) => s + d.score, 0) / dimensionScores.length);
  return {
    schemaVersion: 'llm-evaluation/v1',
    totalScore: Math.max(0, Math.min(100, totalScore)),
    totalGrade: gradeFromScore(totalScore),
    dimensionScores,
    highlights: [],
    improvements: [],
    summary: '',
    fallbackDimensions: dimensionScores.filter((d) => d.isFallback).map((d) => d.dimensionCode),
    knowledgeWarnings: [],
  };
}

/** @deprecated 使用 GroupedLLMScoringService 替代 */
export interface LLMScoringService {
  score(context: LLMPromptContext): Promise<LLMEvaluationReport>;
}
