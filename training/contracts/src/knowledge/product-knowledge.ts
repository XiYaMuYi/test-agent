/**
 * 结构化知识库类型定义（评分知识依赖层）。
 *
 * 设计原则：
 * - 产品知识结构化存储，评分时精确查询（非纯RAG，保证评分可复现）
 * - 运营在 B 端可维护，支持批量导入
 * - 所有字段可选：未配置的维度 LLM 通用能力兜底评分并标注
 */

/** 肤质字典（与 persona skinType 同源） */
export const SKIN_TYPES = ['dry', 'oily', 'combination', 'sensitive', 'normal', 'mixed_dry', 'mixed_oily'] as const;
export type SkinType = (typeof SKIN_TYPES)[number];

/**
 * 适用场景/人群字典（保健品主要用这个，护肤类也可辅助使用）
 * 覆盖生活方式、健康状态、生理阶段等维度
 */
export const SUITABLE_SCENARIOS = [
  // 生活方式
  '熬夜党', '长期加班', '健身人群', '素食者',
  // 健康状态
  '亚健康人群', '免疫力低下', '肠胃不适', '睡眠不好',
  // 年龄/生理阶段
  '青少年', '中年人群', '老年人群', '更年期女性', '孕期/哺乳期',
  // 其他
  '术后康复', '换季敏感', '换季干燥',
] as const;
export type SuitableScenario = (typeof SUITABLE_SCENARIOS)[number];

/** 功效字典（护肤+保健，可扩展，B 端可维护） */
export const CORE_EFFICACIES = [
  // 护肤功效
  '补水保湿', '屏障修护', '舒缓敏感', '控油祛痘', '抗皱紧致',
  '提亮美白', '收缩毛孔', '去角质', '防晒防护', '眼部护理',
  '身体护理', '头皮护理',
  // 保健功效
  '增强免疫力', '改善睡眠', '缓解疲劳', '调节肠胃', '抗氧化',
  '抗衰老', '补钙健骨', '护肝', '护眼', '改善记忆',
  '补充能量', '调节内分泌', '美容养颜(内服)', '减肥瘦身',
] as const;
export type CoreEfficacy = (typeof CORE_EFFICACIES)[number];

/** 产品品类字典（护肤化妆品 + 保健品/膳食补充剂） */
export const PRODUCT_CATEGORIES = [
  // 护肤化妆品
  '精华', '面霜', '乳液', '爽肤水', '洁面', '面膜', '眼霜',
  '防晒', '身体乳', '洗发水', '护发素', '套装', '仪器',
  // 保健品/膳食补充剂
  '维生素/矿物质', '蛋白粉', '鱼油/Omega3', '益生菌', '胶原蛋白肽',
  '酵素', '膳食纤维', '草本提取物', '功能性饮品', '代餐/食品',
  // 其他
  '其他',
] as const;
export type ProductCategory = (typeof PRODUCT_CATEGORIES)[number];

/**
 * 产品库条目。
 * 评分时根据学员推荐的产品名检索此表，获取功效/肤质/禁忌等知识。
 */
export interface Product {
  readonly id: string;
  /** 产品名称（学员话术中提到的名称，支持别名匹配） */
  readonly name: string;
  /** 别名列表（如"小棕瓶"、"修护精华"），评分时用于模糊匹配 */
  readonly aliases: readonly string[];
  readonly category: ProductCategory;
  /** 核心功效（多选，来自功效字典） */
  readonly coreEfficacies: readonly CoreEfficacy[];
  /** 适用肤质（多选，护肤类产品使用） */
  readonly suitableSkinTypes: readonly SkinType[];
  /** 适用场景/人群（多选，保健品主要使用，护肤类可辅助） */
  readonly suitableScenarios: readonly SuitableScenario[];
  /** 适用人群描述（如"25+初抗老"、"干皮友好"） */
  readonly suitableAudience: string;
  /** 价格区间（如"100-300元"） */
  readonly priceRange: string;
  /** 主要成分（如"神经酰胺、角鲨烷"） */
  readonly keyIngredients: readonly string[];
  /** 核心卖点（FAB 话术参考） */
  readonly keySellingPoints: string;
  /** 禁忌肤质（如"重度油性"、"痘痘急性期"） */
  readonly contraindicatedSkinTypes: readonly SkinType[];
  /** 禁忌人群描述（如"孕妇禁用"、"敏感肌急性期禁用"） */
  readonly contraindicatedAudience: string;
  /** 关联产品 ID（搭配推荐，如精华搭面霜） */
  readonly associatedProductIds: readonly string[];
  readonly status: 'active' | 'inactive';
  readonly createdAt: string;
  readonly updatedAt: string;
}

/**
 * 症状-功效映射。
 * 评分的翻译层：把客户说的大白话翻译成"功效需求"，然后去产品库找匹配。
 */
export interface SymptomEfficacyMapping {
  readonly id: string;
  /** 客户表达关键词（如"脸上干"、"起皮"、"卡粉"） */
  readonly customerExpressions: readonly string[];
  /** 对应功效需求（来自功效字典） */
  readonly efficacyNeed: CoreEfficacy;
  /** 严重程度权重 0.5-1.5（如"敏感泛红"权重1.2，高优先级） */
  readonly severityWeight: number;
  readonly status: 'active' | 'inactive';
}

/** 禁忌严重程度 */
export type ContraindicationSeverity = 'warning' | 'critical';

/**
 * 禁忌规则库。
 * 评分安全底线：客户条件 + 学员推荐产品 → 命中禁忌则扣分/critical维度0分。
 */
export interface Contraindication {
  readonly id: string;
  /** 客户条件（如"孕妇"、"敏感肌急性期"、"重度油性"） */
  readonly customerCondition: string;
  /** 禁止推荐的产品 ID 列表 */
  readonly forbiddenProductIds: readonly string[];
  /** 禁止成分（如"维A醇"、"高浓度酸类"） */
  readonly forbiddenIngredients: readonly string[];
  /** 原因说明（用于点评中解释为什么是错误推荐） */
  readonly reason: string;
  /** warning=扣分提示；critical=该维度直接0分并高亮警告 */
  readonly severity: ContraindicationSeverity;
  readonly status: 'active' | 'inactive';
}

/** 知识依赖类型（评分维度可关联哪些知识库） */
export type KnowledgeDependency = 'products' | 'symptom_efficacy' | 'contraindications' | 'product_associations' | 'none';

/**
 * 知识匹配检测结果（评分引擎输出，注入 LLM prompt 作为事实依据）。
 */
export interface KnowledgeMatchResult {
  /** 学员话术中识别到的产品 */
  readonly mentionedProducts: readonly {
    readonly productId: string;
    readonly productName: string;
    readonly matchedByName: string; // 学员原话中提到的名称
  }[];
  /** 客户表达的需求 → 功效需求映射 */
  readonly customerEfficacyNeeds: readonly {
    readonly expression: string;
    readonly efficacyNeed: CoreEfficacy;
    readonly severityWeight: number;
  }[];
  /** 产品对症度：每个推荐产品覆盖了客户哪些功效需求 */
  readonly productEfficacyMatch: readonly {
    readonly productId: string;
    readonly productName: string;
    readonly coveredNeeds: readonly CoreEfficacy[];
    readonly missedNeeds: readonly CoreEfficacy[];
    readonly matchScore: number; // 0-100
  }[];
  /** 禁忌命中 */
  readonly contraindicationHits: readonly {
    readonly customerCondition: string;
    readonly productName: string;
    readonly reason: string;
    readonly severity: ContraindicationSeverity;
  }[];
  /** 连带推荐检测：是否有关联产品推荐 */
  readonly associationRecommendation: {
    readonly hasAssociation: boolean;
    readonly recommendedProductIds: readonly string[];
    readonly suggestedAssociations: readonly string[]; // 应该搭配但没推荐的产品
  };
}
