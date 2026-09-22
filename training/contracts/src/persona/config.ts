/**
 * 客户生命周期阶段（商学院反馈 v2 设计 §3.1）。
 * prospect=陌生潜客（私域外冷启动）；new_follower=新粉；gift_follower=礼品粉；
 * first_order=首单客户；returning=老客户（复购）。
 */
export type CustomerRelation =
  | 'prospect'
  | 'new_follower'
  | 'gift_follower'
  | 'first_order'
  | 'returning';

/**
 * 巨量引擎 DMP 八大人群（官方口径，v2 设计 §2.1）。
 * gen_z=Z世代 / precision_mom=精致妈妈 / new_white_collar=新锐白领 / urban_blue_collar=都市蓝领 /
 * town_youth=小镇青年 / town_senior=小镇中老年 / established_middle_class=资深中产 / urban_silver=都市银发。
 */
export type CustomerCohort =
  | 'gen_z'
  | 'precision_mom'
  | 'new_white_collar'
  | 'urban_blue_collar'
  | 'town_youth'
  | 'town_senior'
  | 'established_middle_class'
  | 'urban_silver';

/** 信任阶梯五级（v2 设计 §2.3）：1 陌生戒备 → 2 认识认可 → 3 专业信任 → 4 个人信任 → 5 同盟转介。 */
export type TrustLevel = 1 | 2 | 3 | 4 | 5;

export interface BasicProfile {
  readonly maritalStatus?: 'single' | 'married' | 'unknown';
  readonly incomeLevel?: 'low' | 'medium' | 'high';
  /** 客户生命周期阶段（可选，缺省不落快照）。 */
  readonly customerRelation?: CustomerRelation;
  /** 经常购买品类（≤50 字，可选）。 */
  readonly purchaseCategory?: string;
  /** 客户信任度 1-5（可选；缺省时由运行层按 relation 推算默认）。 */
  readonly trustLevel?: TrustLevel;
  /** 巨量 DMP 八大人群（可选）。 */
  readonly customerCohort?: CustomerCohort;
  /** 城市（≤30 字，可选）。 */
  readonly city?: string;
}

export interface PersonalityConfig {
  readonly friendliness: number;    // 友好度 0-100
  readonly patience: number;        // 耐心度 0-100
  readonly priceSensitivity: number; // 价格敏感度 0-100
  readonly decisiveness: number;    // 决策果断度 0-100
  readonly skepticism: number;      // 怀疑程度 0-100
  readonly socialActivity: number;  // 社交活跃度 0-100
  readonly emotionalVolatility: number; // 情绪波动度 0-100
}

export interface CommunicationConfig {
  readonly style: 'direct' | 'gentle' | 'strong' | 'humorous' | 'serious';
  readonly verbosity: 'brief' | 'normal' | 'verbose';
  readonly emotionLevel: 'reserved' | 'normal' | 'expressive';
  readonly catchphrase?: string;  // 口头禅（可选）
  readonly dialect?: 'mandarin' | 'southwest' | 'northeast' | 'cantonese' | 'wu'; // 方言
}

export interface ConsumptionConfig {
  readonly budgetMin: number;
  readonly budgetMax: number;
  readonly decisionCycle: 'impulse' | 'same_day' | 'few_days' | 'long_term';
  readonly brandLoyalty: 'low' | 'medium' | 'high';
  readonly skinType?: 'dry' | 'oily' | 'combination' | 'mixed_dry' | 'mixed_oily' | 'sensitive' | 'normal';
  readonly skinConcerns?: readonly string[];
  readonly healthGoals?: readonly string[];
  readonly purchaseChannel?: 'wechat_private' | 'ecommerce' | 'offline' | 'live'; // 购买渠道
  readonly ingredientFocus?: 'none' | 'normal' | 'focused'; // 成分关注
  readonly competitorComparison?: 'never' | 'occasionally' | 'frequently'; // 竞品比较
  readonly allergies?: readonly string[]; // 过敏史
  readonly currentProducts?: string; // 在用产品
}

export interface ConversationConfig {
  readonly difficulty: 1 | 2 | 3 | 4;
  readonly maxTurns: number;
  readonly background: string;
  readonly productScenario: string;
  readonly customNotes?: string;
  readonly openingMode?: 'ai_first' | 'wait_learner'; // 开场方式
}

export interface PersonaConfig {
  readonly id: string;
  readonly name: string;
  readonly basedOnCard: string;
  readonly age: number;
  readonly gender?: 'female' | 'male' | 'unknown'; // 性别
  readonly basic?: BasicProfile; // 基础信息扩展
  readonly occupation: string;
  readonly personality: PersonalityConfig;
  readonly communication: CommunicationConfig;
  readonly consumption: ConsumptionConfig;
  readonly conversation: ConversationConfig;
}

export type PersonaOverrides = {
  readonly age?: number;
  readonly gender?: PersonaConfig['gender'];
  readonly basic?: Partial<BasicProfile>;
  readonly occupation?: string;
  readonly personality?: Partial<PersonalityConfig>;
  readonly communication?: Partial<CommunicationConfig>;
  readonly consumption?: Partial<ConsumptionConfig>;
  readonly conversation?: Partial<ConversationConfig>;
};

export interface PersonaTemplate {
  readonly id: string;
  readonly userId: string;
  readonly name: string;
  readonly basedOnCard: string;
  readonly overrides: PersonaOverrides;
  readonly createdAt: Date;
  readonly updatedAt: Date;
  readonly deletedAt?: Date;
}

export interface CreateTemplateInput {
  readonly name: string;
  readonly basedOnCard: string;
  readonly overrides?: PersonaOverrides;
}

export interface UpdateTemplateInput {
  readonly name?: string;
  readonly overrides?: PersonaOverrides;
}
