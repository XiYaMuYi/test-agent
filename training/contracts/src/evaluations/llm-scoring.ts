/**
 * LLM 评分配置与结果类型。
 *
 * 核心设计：
 * - LLM 是最终评分主体，规则/知识是约束注入
 * - 配置缺失时 LLM 通用能力兜底，并明确标注 isFallback + fallbackNote
 * - 每个维度分数必须有依据（rationale），评分可解释
 * - 知识层检测结果作为事实依据注入 LLM prompt，LLM 不得违背
 */

import type { KnowledgeDependency, KnowledgeMatchResult } from '../knowledge/product-knowledge.js';

/** 评分等级 */
export type Grade = 'S' | 'A' | 'B' | 'C' | 'D';

/** 分级标准（每个维度可配置） */
export interface GradingRubric {
  /** S 级下限（默认90） */
  readonly excellent: number;
  /** A 级下限（默认80） */
  readonly good: number;
  /** B 级下限（默认70） */
  readonly fair: number;
  /** C 级下限（默认60） */
  readonly pass: number;
  /** D 级：< pass */
}

/** 默认分级标准 */
export const DEFAULT_GRADING_RUBRIC: GradingRubric = {
  excellent: 90,
  good: 80,
  fair: 70,
  pass: 60,
};

/** 根据分数和分级标准计算等级 */
export function gradeFromScore(score: number, rubric: GradingRubric = DEFAULT_GRADING_RUBRIC): Grade {
  if (score >= rubric.excellent) return 'S';
  if (score >= rubric.good) return 'A';
  if (score >= rubric.fair) return 'B';
  if (score >= rubric.pass) return 'C';
  return 'D';
}

/**
 * 评分维度配置（B 端可维护）。
 * 每个维度可独立配置权重/分级/知识依赖/关键词/LLM引导语。
 * isConfigured=false 时，LLM 通用能力兜底评分并标注。
 */
export interface ScoringDimension {
  readonly id: string;
  /** 维度编码（如 needs_discovery, product_accuracy, objection_handling） */
  readonly code: string;
  readonly name: string;
  readonly description: string;
  /** 权重 0-100（所有维度权重之和应为100，评分时归一化） */
  readonly weight: number;
  /** 知识依赖（该维度评分需要哪些知识库；none=纯通用能力） */
  readonly knowledgeDependencies: readonly KnowledgeDependency[];
  /** 分级标准 */
  readonly gradingRubric: GradingRubric;
  /** 检测关键词（规则层辅助，可空） */
  readonly keywords: readonly string[];
  /** LLM 评分引导语（可空，空则用通用引导） */
  readonly llmPrompt: string;
  /** 是否已配置（false 时 LLM 兜底并标注） */
  readonly isConfigured: boolean;
  readonly sortOrder: number;
  readonly status: 'active' | 'inactive';
}

/**
 * 评分模板（一组维度的集合，不同培训场景可用不同模板）。
 */
export interface ScoringTemplate {
  readonly id: string;
  readonly name: string;
  readonly description: string;
  /** 关联的维度 ID 列表（按 sortOrder 排序） */
  readonly dimensionIds: readonly string[];
  readonly isDefault: boolean;
  readonly status: 'active' | 'inactive';
  /** 评分策略：grouped按知识依赖分组（默认）/per_dimension每维度独立/single单次全量 */
  readonly evaluationMode: 'grouped' | 'per_dimension' | 'single';
  /** 教练点评全局引导语（为空时用通用引导） */
  readonly coachCommentPrompt: string;
  /** 关联统计：被多少任务使用（列表页填充，详情页可能为 undefined） */
  readonly linkedAssignmentCount?: number;
}

/**
 * LLM 单个维度评分结果。
 */
export interface LLMDimensionScore {
  readonly dimensionCode: string;
  readonly dimensionName: string;
  readonly score: number;
  readonly grade: Grade;
  /** 评分依据（必须有，LLM 输出时强制要求） */
  readonly rationale: string;
  /** 是否为 LLM 通用能力兜底（该维度配置未配置） */
  readonly isFallback: boolean;
  /** 兜底标注：【某项配置因为暂时没有配置，LLM根据通用能力打出xx分】 */
  readonly fallbackNote?: string;
  /** 知识层检测证据（如"推荐了修护精华，对症客户干燥需求，匹配度85%"） */
  readonly knowledgeEvidence?: string;
}

/**
 * LLM 完整评分报告。
 */
export interface LLMEvaluationReport {
  readonly schemaVersion: 'llm-evaluation/v1' | 'llm-evaluation/v2';
  readonly totalScore: number;
  readonly totalGrade: Grade;
  readonly dimensionScores: readonly LLMDimensionScore[];
  readonly highlights: readonly string[];
  readonly improvements: readonly string[];
  readonly summary: string;
  /** 哪些维度是兜底评分（配置未配置） */
  readonly fallbackDimensions: readonly string[];
  /** 知识层警告（禁忌推荐、错误功效等） */
  readonly knowledgeWarnings: readonly string[];
  /** 使用的评分模板 ID */
  readonly templateId?: string;
  /** 知识匹配结果（原始数据，供调试/展示） */
  readonly knowledgeMatch?: KnowledgeMatchResult;
}

/**
 * LLM 评分 prompt 注入的数据结构。
 * 评分引擎把对话+配置+知识匹配结果组装成此结构，渲染成 prompt 发给 LLM。
 */
export interface LLMPromptContext {
  /** 对话记录（学员+客户） */
  readonly transcript: readonly { role: 'learner' | 'assistant'; content: string }[];
  /** 客户画像配置（用于理解客户身份） */
  readonly personaConfig?: unknown;
  /** 评分维度配置（只传 active 的） */
  readonly dimensions: readonly ScoringDimension[];
  /** 知识匹配结果（事实依据，LLM 不得违背） */
  readonly knowledgeMatch?: KnowledgeMatchResult;
  /** 评分模板信息 */
  readonly template?: { id: string; name: string };
  /** 全局评分规则（如"知识层检测到禁忌推荐时该维度最高30分"） */
  readonly globalRules: readonly string[];
}

/** 默认全局评分规则 */
export const DEFAULT_GLOBAL_RULES: readonly string[] = [
  '知识匹配结果中标记的禁忌命中（critical），对应维度得分不得超过30分，且必须在rationale中明确说明。',
  '知识匹配结果中标记的产品对症度，必须作为产品相关维度评分的核心依据。',
  '每个维度的rationale必须引用对话中的具体话术原文，不得空泛评价。',
  '评分必须严格按照该维度的gradingRubric分级，不得随意给分。',
  '未配置的维度（isConfigured=false），你根据通用销售能力评分，但必须在fallbackNote中标注。',
];

/**
 * 默认评分维度（系统初始化时写入，B 端可编辑）。
 * 私域经营能力模型：以“帮客户解决问题”为第一核心，按客户阶段自适应（网状非线性旅程），
 * 纯 LLM 语义评分（非关键词踩点），产品/禁忌知识作为事实参考系。
 * 与迁移 0024_private_domain_scoring_model 的种子保持一致。
 */
export const DEFAULT_SCORING_DIMENSIONS: readonly Omit<ScoringDimension, 'id' | 'createdAt' | 'updatedAt'>[] = [
  {
    code: 'problem_solving',
    name: '问题解决力',
    description: '第一核心：是否真正听懂客户当下的问题与诉求，给出对症、可执行、客户听得懂并愿意接受的解决方案',
    weight: 30,
    knowledgeDependencies: ['products', 'symptom_efficacy', 'contraindications'],
    gradingRubric: DEFAULT_GRADING_RUBRIC,
    keywords: [],
    llmPrompt: '以“帮客户解决问题”为最高标准：先看是否抓住客户真实困扰，再看方案是否对症、可落地、客户能理解接受。意思被接住、方向正确就给高分，不要求讲全卖点，不因没说某个词扣分；答非所问、回避问题、乱推荐、踩禁忌则低分。',
    isConfigured: true,
    sortOrder: 1,
    status: 'active',
  },
  {
    code: 'professionalism',
    name: '专业度',
    description: '产品功效、成分、用法、适用与禁忌人群讲得是否准确清楚；不编造、不夸大、不宣称治病',
    weight: 15,
    knowledgeDependencies: ['products', 'contraindications'],
    gradingRubric: DEFAULT_GRADING_RUBRIC,
    keywords: [],
    llmPrompt: '严格依据产品事实判断：功效、成分、用法、适用肤质/人群是否准确。编造成分、夸大功效、宣称治病或绝对安全、张冠李戴属硬伤，本维度大幅扣分并在红线标注；客户成分关注高或为老客时标准从严。',
    isConfigured: true,
    sortOrder: 2,
    status: 'active',
  },
  {
    code: 'needs_insight',
    name: '需求洞察与客户分层',
    description: '能否判断客户是谁、处于私域关系哪个阶段、真实需求是什么，并据此调整沟通',
    weight: 12,
    knowledgeDependencies: ['symptom_efficacy'],
    gradingRubric: DEFAULT_GRADING_RUBRIC,
    keywords: [],
    llmPrompt: '看是否通过提问/倾听识别客户类型、信任度与真实诉求并调整策略：老客不必重新破冰、应直接专业咨询；礼品粉要挖真实需求；新客先了解情况。识别准确、分层应对得当给高分，机械走流程则低分。',
    isConfigured: true,
    sortOrder: 3,
    status: 'active',
  },
  {
    code: 'trust_building',
    name: '信任建立',
    description: '是否真诚、专业、有温度地建立与维护信任，持续输出有用价值而非硬推群发',
    weight: 12,
    knowledgeDependencies: ['none'],
    gradingRubric: DEFAULT_GRADING_RUBRIC,
    keywords: [],
    llmPrompt: '依据客户初始信任度判断：低信任客户先给资质/案例/售后承诺、输出有用内容而非急于推销；高信任老客户重在维护深化。真诚站在客户角度给建议给高分；群发感、套路、硬推扣分。',
    isConfigured: true,
    sortOrder: 4,
    status: 'active',
  },
  {
    code: 'closing',
    name: '成交推进与连带',
    description: '是否在合适时机自然推进成交、给出搭配连带；不强逼、不漏单，决策周期长的客户不急于逼单',
    weight: 10,
    knowledgeDependencies: ['product_associations'],
    gradingRubric: DEFAULT_GRADING_RUBRIC,
    keywords: [],
    llmPrompt: '结合客户决策周期与购买信号判断推进是否合时宜：客户已认可、问题已解决时自然给下单/套餐/搭配建议；尚犹豫或决策周期长时给空间做铺垫而非硬逼。硬逼引起反感扣分，时机成熟却不推进、漏掉合理连带也扣分。',
    isConfigured: true,
    sortOrder: 5,
    status: 'active',
  },
  {
    code: 'rapport_stickiness',
    name: '联系与粘性',
    description: '破冰、日常互动、情绪接住、建立私域联系与粘性；对老客/高信任客户通常判不适用',
    weight: 10,
    knowledgeDependencies: ['none'],
    gradingRubric: DEFAULT_GRADING_RUBRIC,
    keywords: [],
    llmPrompt: '仅当客户处于关系前段（陌生/新粉/礼品粉或信任度低）时重点考察：开场是否自然、有没有建立联系、让客户愿意继续聊。对老客/高信任客户判“不适用”，不因没有破冰话术扣分。',
    isConfigured: true,
    sortOrder: 6,
    status: 'active',
  },
  {
    code: 'campaign_timeliness',
    name: '营销活动与时效',
    description: '是否准确适时传递活动政策、优惠、产品时效，抓住决策窗口；不错讲、不滥用活动施压',
    weight: 8,
    knowledgeDependencies: ['none'],
    gradingRubric: DEFAULT_GRADING_RUBRIC,
    keywords: [],
    llmPrompt: '看是否在客户有购买意向时准确说明活动/优惠/时效并抓住时机促成；讲错、虚构活动、或与客户问题无关地硬塞活动扣分。对话未涉及活动时不因没提活动而扣分。',
    isConfigured: true,
    sortOrder: 7,
    status: 'active',
  },
  {
    code: 'communication_experience',
    name: '沟通体验',
    description: '微信私聊的语气、节奏、分寸与表达清晰度，像真人顾问而非客服机器人或问卷调查',
    weight: 3,
    knowledgeDependencies: ['none'],
    gradingRubric: DEFAULT_GRADING_RUBRIC,
    keywords: [],
    llmPrompt: '看回复是否口语化、有温度、节奏自然、一次不堆砌过长信息、能接住客户情绪。生硬机械、答非所问、长篇说教扣分。',
    isConfigured: true,
    sortOrder: 8,
    status: 'active',
  },
];
