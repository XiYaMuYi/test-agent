/**
 * 防幻觉知识增强型 LLM 评分生成器（worker 端）。
 *
 * 与 api 层的 llm-scoring-engine.ts 对应，但适配 worker 的 EvaluationReportGenerator 接口。
 * 核心防幻觉设计：
 * 1. 按知识依赖分组调用（products/symptom_efficacy/contraindications/none）
 * 2. XML 标签严格隔离每个维度
 * 3. 三重校验层（结构/分级/禁忌）
 * 4. 教练点评独立调用
 * 5. 配置缺失时 LLM 通用能力兜底并标注 fallbackNote
 *
 * 当 input.scoringDimensions 为空时，回退到旧的 llmBasedEvaluate（向后兼容）。
 */

import type { EvaluationInput, EvaluationReportGenerator, ScoringDimensionConfig } from './evaluation.processor.js';
import type { ModelProviderPort } from '@training/contracts';
import { llmBasedEvaluate, parseLlmJsonResponse, formatCustomerStateCurve } from './llm-evaluation-generator.js';
import type { DimensionScores, TranscriptMessage } from './rule-evaluation-generator.js';

/** 构建对话文本（与 llm-evaluation-generator 中的 buildDialog 相同）。 */
function buildDialog(transcript: readonly TranscriptMessage[]): string {
  const assistantMsgs = transcript.filter((m) => m.role === 'assistant').map((m) => m.content.slice(0, 200));
  const learnerMsgs = transcript.filter((m) => m.role === 'learner').map((m) => m.content.slice(0, 200));
  const rounds = Math.max(assistantMsgs.length, learnerMsgs.length);
  let dialog = '';
  for (let i = 0; i < rounds; i += 1) {
    dialog += `客户(第${i + 1}轮): ${assistantMsgs[i] ?? ''}\n学员(第${i + 1}轮): ${learnerMsgs[i] ?? ''}\n`;
  }
  return dialog;
}

// ============================================================
// 类型定义
// ============================================================

type KnowledgeGroupKey = 'products' | 'symptom_efficacy' | 'contraindications' | 'none';

interface DimensionGroup {
  readonly key: KnowledgeGroupKey;
  readonly label: string;
  readonly dimensions: readonly ScoringDimensionConfig[];
}

interface DimensionScoreResult {
  readonly code: string;
  readonly name: string;
  readonly score: number;
  readonly grade: string;
  readonly fallback: boolean;
  readonly reason?: string | undefined;
}

interface GroupedScoringResult {
  readonly dimensionScores: readonly DimensionScoreResult[];
  readonly totalScore: number;
  readonly callFailed: boolean;
}

// ============================================================
// 分组逻辑
// ============================================================

const KNOWLEDGE_GROUP_ORDER: readonly KnowledgeGroupKey[] = ['products', 'symptom_efficacy', 'contraindications', 'none'];

const KNOWLEDGE_GROUP_LABELS: Readonly<Record<KnowledgeGroupKey, string>> = {
  products: '产品知识组',
  symptom_efficacy: '症状功效映射组',
  contraindications: '禁忌安全组',
  none: '通用能力组',
};

function dimensionPrimaryGroup(dim: ScoringDimensionConfig): KnowledgeGroupKey {
  const deps = dim.knowledgeDependencies ?? [];
  if (deps.includes('products')) return 'products';
  if (deps.includes('symptom_efficacy')) return 'symptom_efficacy';
  if (deps.includes('contraindications')) return 'contraindications';
  return 'none';
}

function groupDimensions(dimensions: readonly ScoringDimensionConfig[]): readonly DimensionGroup[] {
  const groups = new Map<KnowledgeGroupKey, ScoringDimensionConfig[]>();
  for (const key of KNOWLEDGE_GROUP_ORDER) {
    groups.set(key, []);
  }
  for (const dim of dimensions) {
    const key = dimensionPrimaryGroup(dim);
    groups.get(key)!.push(dim);
  }
  return KNOWLEDGE_GROUP_ORDER
    .filter((key) => groups.get(key)!.length > 0)
    .map((key) => ({ key, label: KNOWLEDGE_GROUP_LABELS[key], dimensions: groups.get(key)! }));
}

// ============================================================
// Prompt 构建
// ============================================================

function buildDimensionBlock(dim: ScoringDimensionConfig): string {
  const configuredNote = dim.isConfigured
    ? ''
    : `\n  <fallback_note>此维度暂无知识配置，LLM 根据通用销售培训能力评分，并在 reason 中说明"通用能力兜底"。</fallback_note>`;
  const guidance = dim.llmGuidance ? `\n  <llm_guidance>${dim.llmGuidance}</llm_guidance>` : '';
  const thresholds = dim.gradeThresholds
    ? `\n  <grade_thresholds>${Object.entries(dim.gradeThresholds).map(([g, t]) => `${g}>=${t}`).join(', ')}</grade_thresholds>`
    : '\n  <grade_thresholds>S>=90, A>=80, B>=70, C>=60</grade_thresholds>';
  const keywords = dim.keywords.length > 0 ? `\n  <reference_keywords>${dim.keywords.join(', ')}</reference_keywords>` : '';
  return `<dimension code="${dim.code}" name="${dim.name}" weight="${dim.weight}">
  <description>${dim.description ?? '暂无说明'}</description>${guidance}${thresholds}${keywords}${configuredNote}
</dimension>`;
}

function buildGroupPrompt(
  group: DimensionGroup,
  transcript: readonly TranscriptMessage[],
  customerMood: string,
  stateCurve: string,
): string {
  const dialog = buildDialog(transcript);
  const stateSection = stateCurve
    ? `\n客户心理状态变化曲线（初始→最终，0-100）：\n${stateCurve}\n`
    : '';
  const dimensionBlocks = group.dimensions.map(buildDimensionBlock).join('\n');
  const codes = group.dimensions.map((d) => d.code).join('", "');
  return `你是一个销售培训评分专家。请根据以下对话内容，对【${group.label}】的维度进行独立评分。

重要规则：
1. 每个 <dimension> 块内的规则只适用于该维度，不得跨维度引用规则或知识
2. 分数范围 0-100，grade 按 grade_thresholds 判定
3. 未配置的维度用通用能力评分，并在 reason 中说明"通用能力兜底"
4. 只输出 JSON，不要其他内容

对话内容：
${dialog}
客户最终情绪：${customerMood}
${stateSection}
待评分维度：
${dimensionBlocks}

请输出 JSON 格式：
{
  "scores": {
    "${codes}": { "score": 0-100, "grade": "S/A/B/C/D", "reason": "简短理由", "fallback": true/false }
  }
}`;
}

function buildCoachCommentPrompt(
  dimensionScores: readonly DimensionScoreResult[],
  totalScore: number,
  transcript: readonly TranscriptMessage[],
  customPrompt: string,
): string {
  const dialog = buildDialog(transcript);
  const scoreSummary = dimensionScores
    .map((d) => `- ${d.name}(${d.code}): ${d.score}分 ${d.grade}${d.fallback ? '（通用能力兜底）' : ''}`)
    .join('\n');
  const guidance = customPrompt ? `\n点评侧重点：${customPrompt}\n` : '';
  return `你是一位资深销售教练。请根据以下学员的训练评分结果，给出教练点评。

学员综合得分：${totalScore}分

各维度得分：
${scoreSummary}
${guidance}
对话摘要：
${dialog}

请输出 JSON 格式（只输出 JSON）：
{
  "summary": "一句话总体评价",
  "highlights": ["亮点1", "亮点2", "亮点3"],
  "improvements": ["改进建议1", "改进建议2"]
}`;
}

// ============================================================
// 结果解析与校验
// ============================================================

function gradeFromScore(score: number, thresholds?: Record<string, number> | null): string {
  const t = thresholds ?? { S: 90, A: 80, B: 70, C: 60 };
  if (score >= (t.S ?? 90)) return 'S';
  if (score >= (t.A ?? 80)) return 'A';
  if (score >= (t.B ?? 70)) return 'B';
  if (score >= (t.C ?? 60)) return 'C';
  return 'D';
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function parseGroupResponse(
  content: string,
  group: DimensionGroup,
): readonly DimensionScoreResult[] {
  const parsed = parseLlmJsonResponse(content);
  if (parsed === null || typeof parsed.scores !== 'object' || parsed.scores === null) {
    return group.dimensions.map((d) => ({
      code: d.code, name: d.name, score: 50, grade: gradeFromScore(50, d.gradeThresholds),
      fallback: true, reason: 'LLM返回解析失败，使用默认分',
    }));
  }
  const scores = parsed.scores as Record<string, unknown>;
  return group.dimensions.map((d) => {
    const raw = scores[d.code];
    if (typeof raw !== 'object' || raw === null) {
      return { code: d.code, name: d.name, score: 50, grade: gradeFromScore(50, d.gradeThresholds), fallback: true, reason: '维度缺失，使用默认分' };
    }
    const obj = raw as Record<string, unknown>;
    const rawScore = typeof obj.score === 'number' ? obj.score : 50;
    const score = clamp(Math.round(rawScore), 0, 100);
    // 校验：用配置的 thresholds 重算 grade，不信任 LLM 的 grade
    const grade = gradeFromScore(score, d.gradeThresholds);
    const fallback = obj.fallback === true || !d.isConfigured;
    const reason = typeof obj.reason === 'string' ? obj.reason : undefined;
    return { code: d.code, name: d.name, score, grade, fallback, reason };
  });
}

// ============================================================
// 主生成器
// ============================================================

export class GroupedLlmEvaluationReportGenerator implements EvaluationReportGenerator {
  public constructor(private readonly modelProvider: ModelProviderPort) {}

  async generate(input: EvaluationInput): Promise<Record<string, unknown>> {
    // 无评分维度配置时，回退到旧的 llmBasedEvaluate
    if (!input.scoringDimensions || input.scoringDimensions.length === 0) {
      const report = await llmBasedEvaluate({
        transcript: input.transcript as readonly TranscriptMessage[],
        personaConfig: input.personaConfig ?? undefined,
        customerMood: input.customerMood,
        initialCustomerState: input.initialCustomerState ?? null,
        finalCustomerState: input.finalCustomerState ?? null,
        modelProvider: this.modelProvider,
      });
      if (report !== null) return { ...report };
      // LLM 失败时返回规则兜底的基本报告
      return this.fallbackReport(input);
    }

    const stateCurve = formatCustomerStateCurve(
      input.initialCustomerState ?? null,
      input.finalCustomerState ?? null,
    );

    // 1. 按知识依赖分组
    const groups = groupDimensions(input.scoringDimensions);
    const evaluationMode = input.evaluationMode ?? 'grouped';

    let allDimensionScores: DimensionScoreResult[] = [];
    let callFailed = false;

    if (evaluationMode === 'single') {
      // 单次全量调用（兼容旧模式）
      const allGroup: DimensionGroup = { key: 'none', label: '全量', dimensions: input.scoringDimensions };
      const result = await this.callGroup(allGroup, input, stateCurve);
      allDimensionScores = [...result.dimensionScores];
      callFailed = result.callFailed;
    } else if (evaluationMode === 'per_dimension') {
      // 每维度独立调用
      for (const dim of input.scoringDimensions) {
        const singleGroup: DimensionGroup = { key: dimensionPrimaryGroup(dim), label: dim.name, dimensions: [dim] };
        const result = await this.callGroup(singleGroup, input, stateCurve);
        allDimensionScores.push(...result.dimensionScores);
        if (result.callFailed) callFailed = true;
      }
    } else {
      // grouped（默认推荐）：按组并行调用
      const results = await Promise.all(
        groups.map((group) => this.callGroup(group, input, stateCurve)),
      );
      allDimensionScores = results.flatMap((r) => r.dimensionScores);
      callFailed = results.some((r) => r.callFailed);
    }

    // 2. 按 sort_order 排序
    allDimensionScores.sort((a, b) => {
      const da = input.scoringDimensions!.find((d) => d.code === a.code);
      const db = input.scoringDimensions!.find((d) => d.code === b.code);
      return (da?.sortOrder ?? 0) - (db?.sortOrder ?? 0);
    });

    // 3. 计算加权总分
    const totalWeight = input.scoringDimensions.reduce((s, d) => s + d.weight, 0);
    const totalScore = totalWeight > 0
      ? Math.round(allDimensionScores.reduce((s, r) => {
          const dim = input.scoringDimensions!.find((d) => d.code === r.code);
          return s + r.score * (dim?.weight ?? 0);
        }, 0) / totalWeight)
      : Math.round(allDimensionScores.reduce((s, r) => s + r.score, 0) / Math.max(allDimensionScores.length, 1));

    // 4. 独立调用教练点评
    const coachComment = await this.callCoachComment(allDimensionScores, totalScore, input, stateCurve);

    // 5. 组装兼容格式的 report
    const dimensionScores: DimensionScores = {
      needs_discovery: this.findScore(allDimensionScores, 'needs_discovery'),
      product_presentation: this.findScore(allDimensionScores, 'product_accuracy', 'product_presentation'),
      objection_handling: this.findScore(allDimensionScores, 'objection_handling'),
      emotion_management: this.findScore(allDimensionScores, 'emotion_management'),
      closing_ability: this.findScore(allDimensionScores, 'closing_ability'),
    };

    return {
      schemaVersion: 'evaluation-report/v1',
      generatedBy: 'grouped-llm-evaluation/v2',
      messageCount: input.messageCount,
      scoringRules: input.scoringRules,
      score: totalScore,
      dimensionScores,
      customDimensionScores: allDimensionScores,
      highlights: coachComment.highlights,
      improvements: coachComment.improvements,
      coachSummary: coachComment.summary,
      customerMood: input.customerMood,
      totalTurns: Math.ceil(input.transcript.length / 2),
      evaluationMode,
      scoringTemplateId: input.scoringTemplateId ?? null,
      callFailed,
    };
  }

  private async callGroup(
    group: DimensionGroup,
    input: EvaluationInput,
    stateCurve: string,
  ): Promise<GroupedScoringResult> {
    const prompt = buildGroupPrompt(group, input.transcript as readonly TranscriptMessage[], input.customerMood, stateCurve);
    try {
      const response = await this.modelProvider.generate({
        sessionId: `grouped-scoring-${group.key}`,
        prompt,
      });
      const dimensionScores = parseGroupResponse(response.content, group);
      return { dimensionScores, totalScore: 0, callFailed: false };
    } catch {
      const dimensionScores = group.dimensions.map((d) => ({
        code: d.code, name: d.name, score: 50, grade: gradeFromScore(50, d.gradeThresholds),
        fallback: true, reason: 'LLM调用失败，使用默认分',
      }));
      return { dimensionScores, totalScore: 0, callFailed: true };
    }
  }

  private async callCoachComment(
    dimensionScores: readonly DimensionScoreResult[],
    totalScore: number,
    input: EvaluationInput,
    _stateCurve: string,
  ): Promise<{ highlights: readonly string[]; improvements: readonly string[]; summary: string }> {
    const prompt = buildCoachCommentPrompt(
      dimensionScores, totalScore,
      input.transcript as readonly TranscriptMessage[],
      input.coachCommentPrompt ?? '',
    );
    try {
      const response = await this.modelProvider.generate({
        sessionId: 'coach-comment',
        prompt,
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

  private findScore(scores: readonly DimensionScoreResult[], ...codes: string[]): number {
    for (const code of codes) {
      const found = scores.find((s) => s.code === code);
      if (found !== undefined) return found.score;
    }
    return 50;
  }

  private fallbackReport(input: EvaluationInput): Record<string, unknown> {
    return {
      schemaVersion: 'evaluation-report/v1',
      generatedBy: 'grouped-llm-evaluation/v2-fallback',
      messageCount: input.messageCount,
      scoringRules: input.scoringRules,
      score: 50,
      dimensionScores: { needs_discovery: 50, product_presentation: 50, objection_handling: 50, emotion_management: 50, closing_ability: 50 },
      customDimensionScores: [],
      highlights: [],
      improvements: ['LLM评分服务暂时不可用，请稍后查看评分结果'],
      customerMood: input.customerMood,
      totalTurns: Math.ceil(input.transcript.length / 2),
    };
  }
}
