import type { PersonalityConfig, ConsumptionConfig } from './config.js';

export interface CardPreset {
  readonly id: string;
  readonly name: string;
  readonly displayName: string;
  readonly description: string;
  readonly age: number;
  readonly occupation: string;
  readonly personality: PersonalityConfig;
  readonly consumption: ConsumptionConfig;
}

export const AGE_CARDS: readonly CardPreset[] = [
  {
    id: 'young-lady',
    name: 'young-lady',
    displayName: '小姐姐',
    description: '18-25岁，学生/职场新人，预算有限，追新追潮',
    age: 22,
    occupation: '学生',
    personality: {
      friendliness: 70,
      patience: 40,
      priceSensitivity: 80,
      decisiveness: 60,
      skepticism: 30,
      socialActivity: 75,
      emotionalVolatility: 60,
    },
    consumption: {
      budgetMin: 50,
      budgetMax: 200,
      decisionCycle: 'impulse',
      brandLoyalty: 30 as unknown as 'low',
    },
  },
  {
    id: 'light-mature',
    name: 'light-mature',
    displayName: '轻熟女',
    description: '26-32岁，职场主力，有消费力，注重成分和效果',
    age: 29,
    occupation: '白领',
    personality: {
      friendliness: 60,
      patience: 50,
      priceSensitivity: 40,
      decisiveness: 70,
      skepticism: 50,
      socialActivity: 55,
      emotionalVolatility: 40,
    },
    consumption: {
      budgetMin: 200,
      budgetMax: 800,
      decisionCycle: 'same_day',
      brandLoyalty: 60 as unknown as 'medium',
    },
  },
  {
    id: 'mom',
    name: 'mom',
    displayName: '宝妈',
    description: '28-38岁，家庭消费决策者，关注安全和性价比',
    age: 33,
    occupation: '全职妈妈',
    personality: {
      friendliness: 65,
      patience: 55,
      priceSensitivity: 70,
      decisiveness: 50,
      skepticism: 40,
      socialActivity: 60,
      emotionalVolatility: 50,
    },
    consumption: {
      budgetMin: 100,
      budgetMax: 500,
      decisionCycle: 'few_days',
      brandLoyalty: 70 as unknown as 'high',
    },
  },
  {
    id: 'boss-lady',
    name: 'boss-lady',
    displayName: '御姐',
    description: '33-42岁，高消费力，品牌意识强，要求高',
    age: 38,
    occupation: '企业主管',
    personality: {
      friendliness: 40,
      patience: 40,
      priceSensitivity: 30,
      decisiveness: 80,
      skepticism: 60,
      socialActivity: 45,
      emotionalVolatility: 35,
    },
    consumption: {
      budgetMin: 500,
      budgetMax: 2000,
      decisionCycle: 'same_day',
      brandLoyalty: 70 as unknown as 'high',
    },
  },
  {
    id: 'big-sister',
    name: 'big-sister',
    displayName: '大姐',
    description: '40-55岁，注重养生保健，信任熟人推荐',
    age: 48,
    occupation: '个体户',
    personality: {
      friendliness: 70,
      patience: 60,
      priceSensitivity: 60,
      decisiveness: 50,
      skepticism: 30,
      socialActivity: 70,
      emotionalVolatility: 45,
    },
    consumption: {
      budgetMin: 200,
      budgetMax: 1000,
      decisionCycle: 'few_days',
      brandLoyalty: 80 as unknown as 'high',
    },
  },
  {
    id: 'auntie',
    name: 'auntie',
    displayName: '阿姨',
    description: '50-65岁，退休/半退休，时间充裕，喜欢聊天',
    age: 58,
    occupation: '退休',
    personality: {
      friendliness: 75,
      patience: 70,
      priceSensitivity: 50,
      decisiveness: 40,
      skepticism: 20,
      socialActivity: 80,
      emotionalVolatility: 30,
    },
    consumption: {
      budgetMin: 100,
      budgetMax: 600,
      decisionCycle: 'long_term',
      brandLoyalty: 85 as unknown as 'high',
    },
  },
];

export const PSYCHOLOGY_CARDS = [
  { id: 'hesitant', displayName: '犹豫型', description: '问很多问题但不决定', skepticismBoost: 20, priceSensitivityBoost: 10 },
  { id: 'bargain', displayName: '比价型', description: '到处对比，只看价格', skepticismBoost: 15, priceSensitivityBoost: 30 },
  { id: 'skeptical', displayName: '怀疑型', description: '不信任推销，保持距离', skepticismBoost: 35, priceSensitivityBoost: 5 },
  { id: 'impulsive', displayName: '冲动型', description: '容易被说动，但容易反悔', skepticismBoost: -10, priceSensitivityBoost: -15 },
  { id: 'professional', displayName: '专业型', description: '研究成分，问得很细', skepticismBoost: 25, priceSensitivityBoost: 0 },
  { id: 'chatty', displayName: '故事型', description: '喜欢聊家常，跑题', skepticismBoost: 0, priceSensitivityBoost: 5 },
  { id: 'complaining', displayName: '抱怨型', description: '对之前的产品不满', skepticismBoost: 30, priceSensitivityBoost: 15 },
  { id: 'passive', displayName: '被动型', description: '不主动表达，等你说', skepticismBoost: 10, priceSensitivityBoost: 0 },
] as const;

export const DIFFICULTY_LEVELS = [
  { level: 1 as const, name: '友好型', description: '随和，容易被打动，1-2个问题后就成交' },
  { level: 2 as const, name: '普通型', description: '有常见疑虑，需要解释清楚' },
  { level: 3 as const, name: '刁钻型', description: '多次质疑，对比竞品，需要强力说服' },
  { level: 4 as const, name: '难缠型', description: '非常难缠，反复砍价，几乎不可能被说服' },
] as const;

export const PRODUCT_SCENARIOS = [
  { id: 'anti-aging', displayName: '抗老咨询', description: '精华/面霜' },
  { id: 'whitening', displayName: '美白淡斑', description: '美白精华/面膜' },
  { id: 'acne', displayName: '祛痘控油', description: '祛痘产品' },
  { id: 'health', displayName: '保健养生', description: '保健品/滋补品' },
  { id: 'weight-loss', displayName: '减重塑形', description: '代餐/酵素' },
  { id: 'body-care', displayName: '身体护理', description: '身体乳/精油' },
  { id: 'sensitive', displayName: '敏感修复', description: '修复霜/喷雾' },
  { id: 'hair-care', displayName: '护发养发', description: '洗护/生发' },
] as const;

// =============================================================================
// v2 共享字典（商学院反馈 v2 设计 §3.2）：B/C 两端共用同一元数据。
// 全部为只读常量，禁止 B/C 各维护一份。
// =============================================================================

/**
 * 客户生命周期阶段（v2 设计 §2.2 / §3.1）。
 * goal 为销售目标话术提示，进入 prompt 注入。
 */
export const CUSTOMER_RELATIONS = [
  { id: 'prospect', displayName: '陌生潜客', description: '私域外/刚接触，冷启动', goal: '先建立首次信任，争取破冰首聊' },
  { id: 'new_follower', displayName: '新粉', description: '刚关注/进私域', goal: '建立专业认知，引导首单尝试' },
  { id: 'gift_follower', displayName: '礼品粉', description: '通过活动/礼品获取', goal: '借礼品建立好感，挖掘真实需求' },
  { id: 'first_order', displayName: '首单客户', description: '完成首次购买', goal: '使用指导与售后关怀，铺垫复购' },
  { id: 'returning', displayName: '老客户', description: '有复购记录', goal: '升级推荐/套餐/会员权益' },
] as const;

/**
 * 巨量引擎 DMP 八大人群（v2 设计 §2.1）。definition 为官方口径，salesHint 为话术提示。
 */
export const CUSTOMER_COHORTS = [
  { id: 'gen_z', displayName: 'Z世代', definition: '三线及以上城市年轻群体', salesHint: '追新追潮，颜值消费，重体验与情绪价值' },
  { id: 'precision_mom', displayName: '精致妈妈', definition: '三线及以上城市，备孕或已生育白领女性', salesHint: '家庭消费决策者，重成分安全与性价比' },
  { id: 'new_white_collar', displayName: '新锐白领', definition: '三线及以上城市，青年白领/IT/金融群体', salesHint: '消费力中高，线上购物，重便利省时' },
  { id: 'urban_blue_collar', displayName: '都市蓝领', definition: '三线及以上城市，消费能力中等群体', salesHint: '务实，重性价比' },
  { id: 'town_youth', displayName: '小镇青年', definition: '四线及以下城市青年群体', salesHint: '下沉主力，跟风消费，易被种草' },
  { id: 'town_senior', displayName: '小镇中老年', definition: '四线及以下城市中老年群体', salesHint: '务实、品牌忠诚、为家庭购买' },
  { id: 'established_middle_class', displayName: '资深中产', definition: '三线及以上城市，中年白领/IT/金融群体', salesHint: '高消费力，重品质与服务' },
  { id: 'urban_silver', displayName: '都市银发', definition: '三线及以上城市，中老年群体', salesHint: '时间充裕，信任熟人推荐，重养生' },
] as const;

/**
 * 信任阶梯五级（v2 设计 §2.3）。behavior 为客户可观察表现，strategy 为推进策略。
 */
export const TRUST_LEVELS = [
  { level: 1 as const, displayName: '陌生戒备', behavior: '冷淡、套话、戒备、只问价格', strategy: '先建信任：讲资质/案例/售后承诺，不急于推销' },
  { level: 2 as const, displayName: '认识认可', behavior: '愿意聊需求，认可专业度', strategy: '给洞察、给判断，输出有用内容' },
  { level: 3 as const, displayName: '专业信任', behavior: '相信推荐，开始问具体产品', strategy: '价值展示：成分/效果/对比，给方案' },
  { level: 4 as const, displayName: '个人信任', behavior: '主动透露信息，接受建议', strategy: '可直入成交/升单/套餐' },
  { level: 5 as const, displayName: '同盟转介', behavior: '复购、转介绍、维护品牌', strategy: '会员权益、老客专属、请其推荐' },
] as const;

/**
 * 皮肤问题专业词表（v2 设计 §2.5），6 大类 × 子项。用于 skinConcerns 字典多选。
 */
export const SKIN_CONCERNS = [
  { category: '痤疮类', items: ['闭口粉刺', '黑头', '炎性痘痘', '脓疱', '痘印', '痘坑'] },
  { category: '色斑类', items: ['雀斑', '黄褐斑', '晒斑', '炎症后色素沉着'] },
  { category: '敏感类', items: ['红血丝', '泛红发热', '刺痛紧绷', '干燥脱屑'] },
  { category: '老化类', items: ['细纹', '皱纹', '法令纹', '松弛下垂'] },
  { category: '质地类', items: ['毛孔粗大', '暗沉发黄', '粗糙', '出油旺盛'] },
  { category: '其他', items: ['黑眼圈', '眼袋', '唇部暗沉', '身体干燥'] },
] as const;

/**
 * 产品场景两级类目（v2 设计 §2.6，对齐电商大快消类目）。
 * 旧 8 个 PRODUCT_SCENARIOS 平铺 id 全部保留映射到 categoryId（sceneId 或 legacy 映射）。
 */
export const PRODUCT_SCENARIO_CATEGORIES = [
  { id: 'daily-skincare', displayName: '日常护肤', category: '美容护肤/美体', scenes: ['补水保湿', '清洁去角质', '抗老紧致', '美白提亮', '防晒隔离', '眼部护理'] },
  { id: 'problem-skin', displayName: '问题肌调理', category: '功效护肤', scenes: ['祛痘控油', '敏感修复', '淡斑祛印', '屏障修护', '毛孔管理'] },
  { id: 'wellness', displayName: '保健养生', category: '保健食品/口服美容', scenes: ['减脂代餐', '口服内调', '滋补调理', '助眠安神'] },
  { id: 'children', displayName: '儿童', category: '母婴', scenes: ['成长饮', '儿童护肤', '儿童洗护'] },
  { id: 'bath-body', displayName: '洗护沐', category: '个人护理/家清', scenes: ['洗发护发', '身体护理', '口腔护理', '家清日化'] },
] as const;

/** 旧 PRODUCT_SCENARIOS id → 新大类 id 的兼容映射（全部 8 个值必须命中）。 */
export const PRODUCT_SCENARIO_LEGACY_CATEGORY_MAP = Object.freeze({
  'anti-aging': 'daily-skincare',
  'whitening': 'daily-skincare',
  'acne': 'problem-skin',
  'health': 'wellness',
  'weight-loss': 'wellness',
  'body-care': 'bath-body',
  'sensitive': 'problem-skin',
  'hair-care': 'bath-body',
} as const);

export function getCardPreset(cardId: string): CardPreset | undefined {
  return AGE_CARDS.find(card => card.id === cardId);
}

// =============================================================================
// 方案 B：8 大人群画像默认值（替代 6 年龄卡片成为客户类型主入口）。
// 每个人群内置完整画像（年龄/职业/性格7维/消费），直接驱动新模板生成。
// 原 6 年龄卡片降级为完整编辑器"经典预设"。
// 口径依据：巨量引擎 DMP 八大消费者官方定义 + 电商大快消消费特征。
// =============================================================================

export const COHORT_CARDS: readonly CardPreset[] = [
  {
    id: 'gen_z',
    name: 'gen_z',
    displayName: 'Z世代',
    description: '18-25岁，三线及以上城市年轻群体，追新追潮，颜值消费，重体验与情绪价值',
    age: 21,
    occupation: '学生/职场新人',
    personality: {
      friendliness: 70,
      patience: 40,
      priceSensitivity: 75,
      decisiveness: 65,
      skepticism: 25,
      socialActivity: 80,
      emotionalVolatility: 60,
    },
    consumption: {
      budgetMin: 50,
      budgetMax: 300,
      decisionCycle: 'impulse',
      brandLoyalty: 30 as unknown as 'low',
    },
  },
  {
    id: 'precision_mom',
    name: 'precision_mom',
    displayName: '精致妈妈',
    description: '28-38岁，三线及以上城市备孕或已生育白领女性，家庭消费决策者，重成分安全与性价比',
    age: 33,
    occupation: '白领/全职妈妈',
    personality: {
      friendliness: 65,
      patience: 60,
      priceSensitivity: 55,
      decisiveness: 45,
      skepticism: 50,
      socialActivity: 55,
      emotionalVolatility: 45,
    },
    consumption: {
      budgetMin: 200,
      budgetMax: 1000,
      decisionCycle: 'few_days',
      brandLoyalty: 60 as unknown as 'medium',
    },
  },
  {
    id: 'new_white_collar',
    name: 'new_white_collar',
    displayName: '新锐白领',
    description: '25-32岁，三线及以上城市青年白领/IT/金融群体，消费力中高，重品质与效率，轻奢消费',
    age: 28,
    occupation: '白领/IT/金融',
    personality: {
      friendliness: 55,
      patience: 50,
      priceSensitivity: 35,
      decisiveness: 70,
      skepticism: 55,
      socialActivity: 60,
      emotionalVolatility: 40,
    },
    consumption: {
      budgetMin: 200,
      budgetMax: 800,
      decisionCycle: 'same_day',
      brandLoyalty: 55 as unknown as 'medium',
    },
  },
  {
    id: 'urban_blue_collar',
    name: 'urban_blue_collar',
    displayName: '都市蓝领',
    description: '25-45岁，三线及以上城市消费能力中等群体，务实，重性价比，实用主义',
    age: 32,
    occupation: '蓝领/服务业',
    personality: {
      friendliness: 70,
      patience: 50,
      priceSensitivity: 80,
      decisiveness: 60,
      skepticism: 30,
      socialActivity: 55,
      emotionalVolatility: 50,
    },
    consumption: {
      budgetMin: 50,
      budgetMax: 300,
      decisionCycle: 'impulse',
      brandLoyalty: 35 as unknown as 'low',
    },
  },
  {
    id: 'town_youth',
    name: 'town_youth',
    displayName: '小镇青年',
    description: '18-30岁，四线及以下城市青年群体，下沉主力，跟风消费，易被种草，重娱乐',
    age: 24,
    occupation: '自由职业/服务业',
    personality: {
      friendliness: 75,
      patience: 45,
      priceSensitivity: 80,
      decisiveness: 65,
      skepticism: 25,
      socialActivity: 75,
      emotionalVolatility: 55,
    },
    consumption: {
      budgetMin: 50,
      budgetMax: 200,
      decisionCycle: 'impulse',
      brandLoyalty: 25 as unknown as 'low',
    },
  },
  {
    id: 'town_senior',
    name: 'town_senior',
    displayName: '小镇中老年',
    description: '45-65岁，四线及以下城市中老年群体，务实，品牌忠诚，为家庭购买，重养生重实惠',
    age: 55,
    occupation: '退休/务农',
    personality: {
      friendliness: 70,
      patience: 65,
      priceSensitivity: 75,
      decisiveness: 45,
      skepticism: 35,
      socialActivity: 60,
      emotionalVolatility: 45,
    },
    consumption: {
      budgetMin: 50,
      budgetMax: 300,
      decisionCycle: 'few_days',
      brandLoyalty: 50 as unknown as 'medium',
    },
  },
  {
    id: 'established_middle_class',
    name: 'established_middle_class',
    displayName: '资深中产',
    description: '35-50岁，三线及以上城市中年白领/IT/金融群体，高消费力，重品质与品牌，要求高',
    age: 42,
    occupation: '企业中层/专业人士',
    personality: {
      friendliness: 45,
      patience: 55,
      priceSensitivity: 25,
      decisiveness: 65,
      skepticism: 65,
      socialActivity: 50,
      emotionalVolatility: 35,
    },
    consumption: {
      budgetMin: 500,
      budgetMax: 3000,
      decisionCycle: 'few_days',
      brandLoyalty: 75 as unknown as 'high',
    },
  },
  {
    id: 'urban_silver',
    name: 'urban_silver',
    displayName: '都市银发',
    description: '55-70岁，三线及以上城市中老年群体，时间充裕，信任熟人推荐，重养生重健康',
    age: 62,
    occupation: '退休',
    personality: {
      friendliness: 75,
      patience: 70,
      priceSensitivity: 55,
      decisiveness: 40,
      skepticism: 40,
      socialActivity: 65,
      emotionalVolatility: 40,
    },
    consumption: {
      budgetMin: 100,
      budgetMax: 500,
      decisionCycle: 'few_days',
      brandLoyalty: 55 as unknown as 'medium',
    },
  },
];

/** 按人群 id 获取画像默认值（方案 B 主入口）。 */
export function getCohortPreset(cohortId: string): CardPreset | undefined {
  return COHORT_CARDS.find(card => card.id === cohortId);
}
