import crypto from 'node:crypto';

import {
  AGE_CARDS,
  COHORT_CARDS,
  PSYCHOLOGY_CARDS,
  DIFFICULTY_LEVELS,
  PRODUCT_SCENARIOS,
  CUSTOMER_RELATIONS,
  CUSTOMER_COHORTS,
  TRUST_LEVELS,
  SKIN_CONCERNS,
  PRODUCT_SCENARIO_CATEGORIES,
  DEFAULT_COMMUNICATION,
  DEFAULT_CONVERSATION,
  DEFAULT_CONSUMPTION,
  DEFAULT_BASIC,
  getCardPreset,
  getCohortPreset,
  type CardPreset,
  type PersonaConfig,
  type PersonaOverrides,
  type PersonalityConfig,
  type CommunicationConfig,
  type ConsumptionConfig,
  type ConversationConfig,
  type BasicProfile,
} from '@training/contracts';

/** Input for assembling a frozen persona snapshot from presets + learner tweaks. */
export interface BuildPersonaInput {
  /**
   * 年龄卡片 id（方案 B 后可选）。提供基础画像。
   * 与 customerCohort 二选一：传 ageCardId 用经典年龄预设；不传则用 customerCohort 的人群画像默认值驱动生成。
   */
  readonly ageCardId?: string;
  /** Optional psychology card ids; their boosts stack on the base personality (deduplicated). */
  readonly psychologyCardIds?: readonly string[];
  /** Conversation difficulty 1-4. */
  readonly difficulty: ConversationConfig['difficulty'];
  /** Product scenario id; mapped to its display name in the snapshot. */
  readonly productScenarioId: string;
  /** Optional custom persona name; defaults to the age card display name. */
  readonly name?: string;
  /** Absolute learner overrides (sliders, budget, notes, ...). */
  readonly overrides?: PersonaOverrides;
  /** 客户生命周期阶段（可选，v2 商学院反馈 §2.2；显式传入优先于 overrides.basic）。 */
  readonly customerRelation?: BasicProfile['customerRelation'];
  /** 经常购买品类（可选，v2 §2.6，≤50 字）。 */
  readonly purchaseCategory?: string;
  /** 客户信任度 1-5（可选，v2 §2.3；缺省时由运行层按 relation 推算默认）。 */
  readonly trustLevel?: BasicProfile['trustLevel'];
  /** 巨量 DMP 八大人群（可选，v2 §2.1）。 */
  readonly customerCohort?: BasicProfile['customerCohort'];
  /** 城市（可选，≤30 字）。 */
  readonly city?: string;
}

/**
 * 心理卡除 skepticismBoost / priceSensitivityBoost 两个数值之外，对性格维度与消费习惯的
 * 额外影响。此前卡面描述（爱聊家常/研究成分/被动/冲动…）没有接线，这里补齐，
 * 让每张心理卡的行为特征真正进入 PersonaConfig。用户显式 overrides 仍优先于这些倾向。
 */
const PSYCHOLOGY_EXTRA_EFFECT: Record<string, {
  readonly socialActivity?: number;
  readonly decisiveness?: number;
  readonly consumption?: Partial<ConsumptionConfig>;
}> = {
  chatty: { socialActivity: 25 },                 // 故事型：爱聊家常、容易跑题 → 更健谈
  passive: { socialActivity: -25 },               // 被动型：不主动表达 → 更沉默，等销售引导
  impulsive: { decisiveness: 20 },                // 冲动型：容易被说动 → 决策更快
  hesitant: { decisiveness: -20 },                // 犹豫型：问很多但不决定 → 决策更慢
  professional: { consumption: { ingredientFocus: 'focused' } }, // 专业型：研究成分、问得细
  bargain: { consumption: { competitorComparison: 'frequently' } }, // 比价型：频繁对比竞品
};

export interface PersonaValidationIssue {
  readonly path: string;
  readonly reason: string;
}

export interface PersonaValidationResult {
  readonly valid: boolean;
  readonly issues: readonly PersonaValidationIssue[];
}

type BrandLoyalty = ConsumptionConfig['brandLoyalty'];
type CommunicationStyle = CommunicationConfig['style'];
type Verbosity = CommunicationConfig['verbosity'];
type EmotionLevel = CommunicationConfig['emotionLevel'];
type DecisionCycle = ConsumptionConfig['decisionCycle'];

const PERSONALITY_TRAITS = ['friendliness', 'patience', 'priceSensitivity', 'decisiveness', 'skepticism', 'socialActivity', 'emotionalVolatility'] as const;
const DIFFICULTIES = [1, 2, 3, 4] as const;
const COMMUNICATION_STYLES: readonly CommunicationStyle[] = ['direct', 'gentle', 'strong', 'humorous', 'serious'];
const VERBOSITIES: readonly Verbosity[] = ['brief', 'normal', 'verbose'];
const EMOTION_LEVELS: readonly EmotionLevel[] = ['reserved', 'normal', 'expressive'];
const DECISION_CYCLES: readonly DecisionCycle[] = ['impulse', 'same_day', 'few_days', 'long_term'];
const BRAND_LOYALTIES: readonly NonNullable<BrandLoyalty>[] = ['low', 'medium', 'high'];
const DIALECTS: readonly NonNullable<CommunicationConfig['dialect']>[] = ['mandarin', 'southwest', 'northeast', 'cantonese', 'wu'];
const PURCHASE_CHANNELS: readonly NonNullable<ConsumptionConfig['purchaseChannel']>[] = ['wechat_private', 'ecommerce', 'offline', 'live'];
const INGREDIENT_FOCUS: readonly NonNullable<ConsumptionConfig['ingredientFocus']>[] = ['none', 'normal', 'focused'];
const COMPETITOR_COMPARISONS: readonly NonNullable<ConsumptionConfig['competitorComparison']>[] = ['never', 'occasionally', 'frequently'];
const OPENING_MODES: readonly NonNullable<ConversationConfig['openingMode']>[] = ['ai_first', 'wait_learner'];
const GENDERS: readonly NonNullable<PersonaConfig['gender']>[] = ['female', 'male', 'unknown'];
const MARITAL_STATUSES: readonly NonNullable<BasicProfile['maritalStatus']>[] = ['single', 'married', 'unknown'];
const INCOME_LEVELS: readonly NonNullable<BasicProfile['incomeLevel']>[] = ['low', 'medium', 'high'];
const CUSTOMER_RELATION_IDS: readonly NonNullable<BasicProfile['customerRelation']>[] = ['prospect', 'new_follower', 'gift_follower', 'first_order', 'returning'];
const CUSTOMER_COHORT_IDS: readonly NonNullable<BasicProfile['customerCohort']>[] = ['gen_z', 'precision_mom', 'new_white_collar', 'urban_blue_collar', 'town_youth', 'town_senior', 'established_middle_class', 'urban_silver'];
const TRUST_LEVEL_VALUES: readonly NonNullable<BasicProfile['trustLevel']>[] = [1, 2, 3, 4, 5];
const MAX_TURNS_MIN = 1;
const MAX_TURNS_MAX = 100;
const AGE_MIN = 0;
const AGE_MAX = 120;

const SKIN_TYPES: readonly NonNullable<ConsumptionConfig['skinType']>[] = ['dry', 'oily', 'combination', 'mixed_dry', 'mixed_oily', 'sensitive', 'normal'];
const SKIN_CONCERNS_MAX_ITEMS = 10;
const SKIN_CONCERNS_MAX_ITEM_LENGTH = 40;
const HEALTH_GOALS_MAX_ITEMS = 10;
const HEALTH_GOALS_MAX_ITEM_LENGTH = 40;
const ALLERGIES_MAX_ITEMS = 10;
const ALLERGIES_MAX_ITEM_LENGTH = 60;

/** 各层允许的字段集合（spec §9.1：拒绝未知关键字段，防止契约漂移）。 */
const PERSONA_TOP_LEVEL_KEYS = new Set([
  'id', 'name', 'basedOnCard', 'age', 'gender', 'basic', 'occupation',
  'personality', 'communication', 'consumption', 'conversation',
]);

/** 完整人设编辑器共享元数据：枚举 → 运营可读中文（spec §6.1 共享枚举）。 */
const GENDER_LABELS: Readonly<Record<string, string>> = { female: '女', male: '男', unknown: '未知' };
const MARITAL_STATUS_LABELS: Readonly<Record<string, string>> = { single: '未婚', married: '已婚', unknown: '未知' };
const INCOME_LEVEL_LABELS: Readonly<Record<string, string>> = { low: '较低', medium: '中等', high: '较高' };
const PERSONALITY_TRAIT_LABELS: Readonly<Record<string, string>> = {
  friendliness: '友好度',
  patience: '耐心度',
  priceSensitivity: '价格敏感度',
  decisiveness: '决策果断度',
  skepticism: '怀疑程度',
  socialActivity: '社交活跃度',
  emotionalVolatility: '情绪波动度',
};
const COMMUNICATION_STYLE_LABELS: Readonly<Record<string, string>> = {
  direct: '直接', gentle: '温和', strong: '强势', humorous: '幽默', serious: '严肃',
};
const VERBOSITY_LABELS: Readonly<Record<string, string>> = { brief: '话少', normal: '适中', verbose: '话多' };
const EMOTION_LEVEL_LABELS: Readonly<Record<string, string>> = { reserved: '内敛', normal: '平稳', expressive: '外放' };
const DIALECT_LABELS: Readonly<Record<string, string>> = {
  mandarin: '普通话', southwest: '西南官话', northeast: '东北话', cantonese: '粤语', wu: '吴语',
};
const DECISION_CYCLE_LABELS: Readonly<Record<string, string>> = {
  impulse: '冲动型', same_day: '当天决定', few_days: '考虑几天', long_term: '长期观望',
};
const BRAND_LOYALTY_LABELS: Readonly<Record<string, string>> = { low: '低', medium: '中', high: '高' };
const SKIN_TYPE_LABELS: Readonly<Record<string, string>> = {
  dry: '干性', oily: '油性', combination: '混合性', mixed_dry: '混干性', mixed_oily: '混油性', sensitive: '敏感肌', normal: '中性',
};
const PURCHASE_CHANNEL_LABELS: Readonly<Record<string, string>> = {
  wechat_private: '微信私域', ecommerce: '电商平台', offline: '线下门店', live: '直播间',
};
const INGREDIENT_FOCUS_LABELS: Readonly<Record<string, string>> = {
  none: '不关注', normal: '一般关注', focused: '深度研究',
};
const COMPETITOR_COMPARISON_LABELS: Readonly<Record<string, string>> = {
  never: '不比较', occasionally: '偶尔比较', frequently: '频繁比较',
};
const OPENING_MODE_LABELS: Readonly<Record<string, string>> = {
  ai_first: 'AI 先开口', wait_learner: '等学员先开口',
};

function optionize(values: readonly string[], labels: Readonly<Record<string, string>>): readonly { value: string; label: string }[] {
  return values.map((value) => ({ value, label: labels[value] ?? value }));
}
const BASIC_KEYS = new Set([
  'maritalStatus', 'incomeLevel',
  'customerRelation', 'purchaseCategory', 'trustLevel', 'customerCohort', 'city',
]);
const PERSONALITY_TRAIT_SET = new Set<string>(PERSONALITY_TRAITS as readonly string[]);
const COMMUNICATION_KEYS = new Set(['style', 'verbosity', 'emotionLevel', 'dialect', 'catchphrase']);
const CONSUMPTION_KEYS = new Set([
  'budgetMin', 'budgetMax', 'decisionCycle', 'brandLoyalty', 'purchaseChannel',
  'ingredientFocus', 'competitorComparison', 'skinType', 'skinConcerns',
  'healthGoals', 'allergies', 'currentProducts',
]);
const CONVERSATION_KEYS = new Set([
  'difficulty', 'maxTurns', 'background', 'productScenario', 'openingMode', 'customNotes',
]);

function clampTrait(value: number): number {
  return Math.max(0, Math.min(100, Math.round(value)));
}

function isIntegerIn(value: unknown, min: number, max: number): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value >= min && value <= max;
}

function nonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

/** Drop undefined keys so partial overrides never erase defaults with undefined. */
function definedOnly<T extends object>(value: T | undefined): Partial<T> {
  if (value === undefined) return {};
  const result: Record<string, unknown> = {};
  for (const [key, item] of Object.entries(value)) {
    if (item !== undefined) result[key] = item;
  }
  return result as Partial<T>;
}

/**
 * 两级产品场景查找（v2 §2.6）：先匹配旧 8 个平铺 id；未命中再按
 * `categoryId::scene` 编码从 5 大类的 scenes 展开里找（B 端新分组下拉的下发值）。
 * 命中返回与旧场景同形状的 { id, displayName, description }。
 */
function findScenario(inputId: string): { readonly id: string; readonly displayName: string; readonly description: string } | undefined {
  const legacy = PRODUCT_SCENARIOS.find((item) => item.id === inputId);
  if (legacy !== undefined) return legacy;
  const separator = inputId.indexOf('::');
  if (separator <= 0) return undefined;
  const categoryId = inputId.slice(0, separator);
  const scene = inputId.slice(separator + 2);
  const category = PRODUCT_SCENARIO_CATEGORIES.find((item) => item.id === categoryId);
  if (category === undefined || !(category.scenes as readonly string[]).includes(scene)) return undefined;
  return { id: inputId, displayName: scene, description: category.category };
}

function deepFreeze<T>(value: T): T {
  if (value !== null && typeof value === 'object' && !Object.isFrozen(value)) {
    for (const key of Object.keys(value)) {
      deepFreeze((value as Record<string, unknown>)[key]);
    }
    Object.freeze(value);
  }
  return value;
}

/**
 * Age cards carry brand loyalty as a 0-100 number at runtime (a placeholder in the
 * contract data), while a PersonaConfig snapshot requires the tier enum. Normalize
 * either shape into the legal enum.
 */
function normalizeBrandLoyalty(raw: unknown): NonNullable<BrandLoyalty> {
  if (raw === 'low' || raw === 'medium' || raw === 'high') return raw;
  if (typeof raw === 'number') return raw < 40 ? 'low' : raw < 70 ? 'medium' : 'high';
  return 'medium';
}

/**
 * Pure domain service for the C-first persona setup flow: lists the fixed preset
 * options, assembles a frozen PersonaConfig snapshot (age card + stacked psychology
 * boosts + absolute learner overrides), and validates a snapshot's shape/ranges.
 *
 * It holds no database connection; personal-template persistence belongs to the
 * training_template step. Contract: docs/architecture/contracts/c-first-dual-track-contract.md §5.
 */
export class PersonaService {
  getPresetCatalog(): {
    readonly ageCards: readonly CardPreset[];
    /** 方案 B：8 大人群画像默认值（替代年龄卡片成为客户类型主入口）。完整 CardPreset，C 端滑杆联动用。 */
    readonly cohortCards: readonly CardPreset[];
    readonly psychologyCards: typeof PSYCHOLOGY_CARDS;
    readonly difficultyLevels: typeof DIFFICULTY_LEVELS;
    readonly productScenarios: typeof PRODUCT_SCENARIOS;
    // v2 客户画像体系（阶段 C：小程序字典同步，与 getFieldMetadata 同源）
    readonly customerRelations: readonly { readonly value: string; readonly label: string; readonly description: string; readonly goal: string }[];
    readonly customerCohorts: readonly { readonly value: string; readonly label: string; readonly definition: string; readonly salesHint: string }[];
    readonly trustLevels: readonly { readonly value: number; readonly label: string; readonly behavior: string; readonly strategy: string }[];
    readonly skinTypes: readonly { readonly value: string; readonly label: string }[];
    readonly skinConcernsDictionary: typeof SKIN_CONCERNS;
    readonly productScenarioCategories: typeof PRODUCT_SCENARIO_CATEGORIES;
    readonly cityMaxLength: number;
    readonly purchaseCategoryMaxLength: number;
  } {
    return deepFreeze({
      ageCards: AGE_CARDS,
      cohortCards: COHORT_CARDS,
      psychologyCards: PSYCHOLOGY_CARDS,
      difficultyLevels: DIFFICULTY_LEVELS,
      productScenarios: PRODUCT_SCENARIOS,
      customerRelations: CUSTOMER_RELATIONS.map((item) => ({
        value: item.id, label: item.displayName, description: item.description, goal: item.goal,
      })),
      customerCohorts: CUSTOMER_COHORTS.map((item) => ({
        value: item.id, label: item.displayName, definition: item.definition, salesHint: item.salesHint,
      })),
      trustLevels: TRUST_LEVELS.map((item) => ({
        value: item.level, label: item.displayName, behavior: item.behavior, strategy: item.strategy,
      })),
      skinTypes: optionize(SKIN_TYPES, SKIN_TYPE_LABELS),
      skinConcernsDictionary: SKIN_CONCERNS,
      productScenarioCategories: PRODUCT_SCENARIO_CATEGORIES,
      cityMaxLength: 30,
      purchaseCategoryMaxLength: 50,
    });
  }

  /**
   * 完整人设编辑器共享元数据（spec §6.1）：把全部枚举、范围与长度上限暴露给
   * B 端配置中心，禁止 B/C 两端各维护一份选项常量。前端据此渲染表单控件。
   */
  getFieldMetadata(): Record<string, unknown> {
    return deepFreeze({
      basic: {
        genders: optionize(GENDERS, GENDER_LABELS),
        maritalStatuses: optionize(MARITAL_STATUSES, MARITAL_STATUS_LABELS),
        incomeLevels: optionize(INCOME_LEVELS, INCOME_LEVEL_LABELS),
        customerRelations: CUSTOMER_RELATIONS.map((item) => ({
          value: item.id, label: item.displayName, description: item.description, goal: item.goal,
        })),
        customerCohorts: CUSTOMER_COHORTS.map((item) => ({
          value: item.id, label: item.displayName, definition: item.definition, salesHint: item.salesHint,
        })),
        trustLevels: TRUST_LEVELS.map((item) => ({
          value: item.level, label: item.displayName, behavior: item.behavior, strategy: item.strategy,
        })),
        ageRange: { min: AGE_MIN, max: AGE_MAX },
        nameMaxLength: 64,
        occupationMaxLength: 32,
        cityMaxLength: 30,
        purchaseCategoryMaxLength: 50,
      },
      personality: {
        traits: PERSONALITY_TRAITS.map((trait) => ({
          key: trait,
          label: PERSONALITY_TRAIT_LABELS[trait],
          min: 0,
          max: 100,
        })),
      },
      communication: {
        styles: optionize(COMMUNICATION_STYLES, COMMUNICATION_STYLE_LABELS),
        verbosities: optionize(VERBOSITIES, VERBOSITY_LABELS),
        emotionLevels: optionize(EMOTION_LEVELS, EMOTION_LEVEL_LABELS),
        dialects: optionize(DIALECTS, DIALECT_LABELS),
        catchphraseMaxLength: 80,
      },
      consumption: {
        decisionCycles: optionize(DECISION_CYCLES, DECISION_CYCLE_LABELS),
        brandLoyalties: optionize(BRAND_LOYALTIES, BRAND_LOYALTY_LABELS),
        skinTypes: optionize(SKIN_TYPES, SKIN_TYPE_LABELS),
        purchaseChannels: optionize(PURCHASE_CHANNELS, PURCHASE_CHANNEL_LABELS),
        ingredientFocus: optionize(INGREDIENT_FOCUS, INGREDIENT_FOCUS_LABELS),
        competitorComparisons: optionize(COMPETITOR_COMPARISONS, COMPETITOR_COMPARISON_LABELS),
        arrayLimits: {
          skinConcerns: { maxItems: SKIN_CONCERNS_MAX_ITEMS, maxItemLength: SKIN_CONCERNS_MAX_ITEM_LENGTH },
          healthGoals: { maxItems: HEALTH_GOALS_MAX_ITEMS, maxItemLength: HEALTH_GOALS_MAX_ITEM_LENGTH },
          allergies: { maxItems: ALLERGIES_MAX_ITEMS, maxItemLength: ALLERGIES_MAX_ITEM_LENGTH },
        },
        skinConcernsDictionary: SKIN_CONCERNS,
        currentProductsMaxLength: 200,
      },
      conversation: {
        difficulties: DIFFICULTY_LEVELS.map((level) => ({
          value: level.level,
          label: level.name,
          description: level.description,
        })),
        openingModes: optionize(OPENING_MODES, OPENING_MODE_LABELS),
        maxTurnsRange: { min: MAX_TURNS_MIN, max: MAX_TURNS_MAX },
        backgroundMaxLength: 500,
        customNotesMaxLength: 500,
        productScenarioMaxLength: 50,
      },
      presets: {
        ageCards: AGE_CARDS,
        psychologyCards: PSYCHOLOGY_CARDS,
        difficultyLevels: DIFFICULTY_LEVELS,
        productScenarios: PRODUCT_SCENARIOS,
        customerRelations: CUSTOMER_RELATIONS,
        customerCohorts: CUSTOMER_COHORTS,
        trustLevels: TRUST_LEVELS,
        skinConcerns: SKIN_CONCERNS,
        productScenarioCategories: PRODUCT_SCENARIO_CATEGORIES,
      },
    });
  }

  getAgeCard(ageCardId: string): CardPreset {
    const card = getCardPreset(ageCardId);
    if (card === undefined) {
      throw new Error('PERSONA_PRESET_NOT_FOUND');
    }
    return card;
  }

  /**
   * 方案 B：解析基础画像卡片。
   * 优先级：ageCardId（经典年龄预设）> customerCohort（8 大人群画像默认值）。
   * 两者都不传时抛错。
   */
  private resolveBaseCard(input: BuildPersonaInput): CardPreset {
    if (input.ageCardId !== undefined && input.ageCardId !== '') {
      return this.getAgeCard(input.ageCardId);
    }
    if (input.customerCohort !== undefined) {
      const cohortCard = getCohortPreset(input.customerCohort);
      if (cohortCard === undefined) {
        throw new Error('PERSONA_PRESET_NOT_FOUND');
      }
      return cohortCard;
    }
    throw new Error('PERSONA_PRESET_NOT_FOUND');
  }

  buildPersonaConfig(input: BuildPersonaInput): PersonaConfig {
    const card = this.resolveBaseCard(input);

    const selectedPsychology = new Set<string>();
    let skepticismBoost = 0;
    let priceSensitivityBoost = 0;
    let socialActivityBoost = 0;
    let decisivenessBoost = 0;
    const psychologyConsumption: Partial<ConsumptionConfig> = {};
    for (const psychologyId of input.psychologyCardIds ?? []) {
      if (selectedPsychology.has(psychologyId)) continue; // a card applies at most once
      selectedPsychology.add(psychologyId);
      const psychology = PSYCHOLOGY_CARDS.find((item) => item.id === psychologyId);
      if (psychology === undefined) {
        throw new Error('PERSONA_PRESET_NOT_FOUND');
      }
      skepticismBoost += psychology.skepticismBoost;
      priceSensitivityBoost += psychology.priceSensitivityBoost;
      const extra = PSYCHOLOGY_EXTRA_EFFECT[psychology.id];
      if (extra !== undefined) {
        socialActivityBoost += extra.socialActivity ?? 0;
        decisivenessBoost += extra.decisiveness ?? 0;
        if (extra.consumption !== undefined) Object.assign(psychologyConsumption, extra.consumption);
      }
    }

    const scenario = findScenario(input.productScenarioId);
    if (scenario === undefined) {
      throw new Error('PERSONA_PRESET_NOT_FOUND');
    }

    if (!(DIFFICULTIES as readonly number[]).includes(input.difficulty)) {
      throw new Error('PERSONA_CONFIG_INVALID');
    }

    const overrides = input.overrides ?? {};

    const basePersonality: PersonalityConfig = {
      friendliness: clampTrait(card.personality.friendliness),
      patience: clampTrait(card.personality.patience),
      priceSensitivity: clampTrait(card.personality.priceSensitivity + priceSensitivityBoost),
      decisiveness: clampTrait(card.personality.decisiveness + decisivenessBoost),
      skepticism: clampTrait(card.personality.skepticism + skepticismBoost),
      socialActivity: clampTrait(50 + socialActivityBoost),
      emotionalVolatility: 50,
    };
    const mergedPersonality: Record<(typeof PERSONALITY_TRAITS)[number], number> = {
      ...basePersonality,
      ...definedOnly(overrides.personality),
    };
    for (const trait of PERSONALITY_TRAITS) {
      mergedPersonality[trait] = clampTrait(mergedPersonality[trait]);
    }
    const personality: PersonalityConfig = mergedPersonality;

    const communication: CommunicationConfig = {
      ...DEFAULT_COMMUNICATION,
      ...definedOnly(overrides.communication),
    };

    const consumption: ConsumptionConfig = {
      ...DEFAULT_CONSUMPTION,
      ...psychologyConsumption,
      ...card.consumption,
      ...definedOnly(overrides.consumption),
      brandLoyalty: normalizeBrandLoyalty(
        (definedOnly(overrides.consumption).brandLoyalty) ?? card.consumption.brandLoyalty,
      ),
    };

    const conversation: ConversationConfig = {
      difficulty: input.difficulty,
      maxTurns: overrides.conversation?.maxTurns ?? DEFAULT_CONVERSATION.maxTurns,
      background: overrides.conversation?.background ?? DEFAULT_CONVERSATION.background,
      productScenario: scenario.displayName,
      ...(overrides.conversation?.openingMode !== undefined
        ? { openingMode: overrides.conversation.openingMode }
        : DEFAULT_CONVERSATION.openingMode !== undefined ? { openingMode: DEFAULT_CONVERSATION.openingMode } : {}),
      ...(overrides.conversation?.customNotes !== undefined
        ? { customNotes: overrides.conversation.customNotes }
        : {}),
    };

    const basic: BasicProfile = {
      ...DEFAULT_BASIC,
      ...definedOnly(overrides.basic),
      ...(input.customerRelation !== undefined ? { customerRelation: input.customerRelation } : {}),
      ...(input.purchaseCategory !== undefined ? { purchaseCategory: input.purchaseCategory } : {}),
      ...(input.trustLevel !== undefined ? { trustLevel: input.trustLevel } : {}),
      ...(input.customerCohort !== undefined ? { customerCohort: input.customerCohort } : {}),
      ...(input.city !== undefined ? { city: input.city } : {}),
    };

    const config: PersonaConfig = {
      id: this.deriveId(input, selectedPsychology),
      name: input.name ?? card.displayName,
      basedOnCard: card.id,
      age: overrides.age ?? card.age,
      gender: overrides.gender ?? 'female',
      basic,
      occupation: overrides.occupation ?? card.occupation,
      personality,
      communication,
      consumption,
      conversation,
    };

    const validation = this.validatePersonaConfig(config);
    if (!validation.valid) {
      throw new Error('PERSONA_CONFIG_INVALID');
    }
    return deepFreeze(config);
  }

  validatePersonaConfig(raw: unknown): PersonaValidationResult {
    const issues: PersonaValidationIssue[] = [];
    const push = (path: string, reason: string): void => {
      issues.push({ path, reason });
    };
    const rejectUnknownKeys = (value: Record<string, unknown>, allowed: ReadonlySet<string>, path: string): void => {
      for (const key of Object.keys(value)) {
        if (!allowed.has(key)) push(`${path === '' ? '' : `${path}.`}${key}`, 'unknown field');
      }
    };

    if (typeof raw !== 'object' || raw === null) {
      return { valid: false, issues: [{ path: '$', reason: 'persona config must be an object' }] };
    }
    const config = raw as Record<string, unknown>;

    // 拒绝未知关键字段，防止 B/C 端契约继续漂移（spec §9.1）。
    rejectUnknownKeys(config, PERSONA_TOP_LEVEL_KEYS, '');

    if (!nonEmptyString(config.name)) push('name', 'name is required');
    if (config.name !== undefined && typeof config.name === 'string' && config.name.length > 64) {
      push('name', 'must be at most 64 characters');
    }
    if (!nonEmptyString(config.basedOnCard)) push('basedOnCard', 'basedOnCard is required');
    if (!nonEmptyString(config.occupation)) push('occupation', 'occupation is required');
    if (config.occupation !== undefined && typeof config.occupation === 'string' && config.occupation.length > 32) {
      push('occupation', 'must be at most 32 characters');
    }
    if (!isIntegerIn(config.age, AGE_MIN, AGE_MAX)) push('age', `age must be an integer in [${AGE_MIN}, ${AGE_MAX}]`);

    // 验证 gender 枚举
    if (config.gender !== undefined && !(GENDERS as readonly unknown[]).includes(config.gender)) {
      push('gender', 'must be female|male|unknown');
    }

    // 验证 basic 子块
    const basic = config.basic as Record<string, unknown> | undefined;
    if (basic !== undefined) {
      if (typeof basic !== 'object' || basic === null || Array.isArray(basic)) {
        push('basic', 'must be an object');
      } else {
        rejectUnknownKeys(basic, BASIC_KEYS, 'basic');
        if (basic.maritalStatus !== undefined && !(MARITAL_STATUSES as readonly unknown[]).includes(basic.maritalStatus)) {
          push('basic.maritalStatus', 'must be single|married|unknown');
        }
        if (basic.incomeLevel !== undefined && !(INCOME_LEVELS as readonly unknown[]).includes(basic.incomeLevel)) {
          push('basic.incomeLevel', 'must be low|medium|high');
        }
        if (basic.customerRelation !== undefined && !(CUSTOMER_RELATION_IDS as readonly unknown[]).includes(basic.customerRelation)) {
          push('basic.customerRelation', 'must be prospect|new_follower|gift_follower|first_order|returning');
        }
        if (basic.trustLevel !== undefined && !(TRUST_LEVEL_VALUES as readonly unknown[]).includes(basic.trustLevel)) {
          push('basic.trustLevel', 'must be an integer in [1, 5]');
        }
        if (basic.customerCohort !== undefined && !(CUSTOMER_COHORT_IDS as readonly unknown[]).includes(basic.customerCohort)) {
          push('basic.customerCohort', 'must be one of the 8 DMP cohort ids');
        }
        if (basic.city !== undefined) {
          if (typeof basic.city !== 'string') {
            push('basic.city', 'must be a string');
          } else if (basic.city.length > 30) {
            push('basic.city', 'must be at most 30 characters');
          }
        }
        if (basic.purchaseCategory !== undefined) {
          if (typeof basic.purchaseCategory !== 'string') {
            push('basic.purchaseCategory', 'must be a string');
          } else if (basic.purchaseCategory.length > 50) {
            push('basic.purchaseCategory', 'must be at most 50 characters');
          }
        }
      }
    }

    const personality = config.personality as Record<string, unknown> | undefined;
    if (typeof personality !== 'object' || personality === null) {
      push('personality', 'personality block is required');
    } else {
      rejectUnknownKeys(personality, PERSONALITY_TRAIT_SET, 'personality');
      for (const trait of PERSONALITY_TRAITS) {
        const value = personality[trait];
        if (typeof value !== 'number' || value < 0 || value > 100) {
          push(`personality.${trait}`, 'must be a number in [0, 100]');
        }
      }
    }

    const communication = config.communication as Record<string, unknown> | undefined;
    if (typeof communication !== 'object' || communication === null) {
      push('communication', 'communication block is required');
    } else {
      rejectUnknownKeys(communication, COMMUNICATION_KEYS, 'communication');
      if (!(COMMUNICATION_STYLES as readonly unknown[]).includes(communication.style)) push('communication.style', 'unknown style');
      if (!(VERBOSITIES as readonly unknown[]).includes(communication.verbosity)) push('communication.verbosity', 'unknown verbosity');
      if (!(EMOTION_LEVELS as readonly unknown[]).includes(communication.emotionLevel)) push('communication.emotionLevel', 'unknown emotion level');
      if (communication.dialect !== undefined && !(DIALECTS as readonly unknown[]).includes(communication.dialect)) {
        push('communication.dialect', 'must be mandarin|southwest|northeast|cantonese|wu');
      }
      if (communication.catchphrase !== undefined) {
        if (typeof communication.catchphrase !== 'string') {
          push('communication.catchphrase', 'must be a string');
        } else if (communication.catchphrase.length > 80) {
          push('communication.catchphrase', 'must be at most 80 characters');
        }
      }
    }

    const consumption = config.consumption as Record<string, unknown> | undefined;
    if (typeof consumption !== 'object' || consumption === null) {
      push('consumption', 'consumption block is required');
    } else {
      rejectUnknownKeys(consumption, CONSUMPTION_KEYS, 'consumption');
      const { budgetMin, budgetMax } = consumption;
      if (typeof budgetMin !== 'number' || budgetMin < 0) {
        push('consumption.budgetMin', 'must be a non-negative number');
      } else if (typeof budgetMax !== 'number' || budgetMax < budgetMin) {
        push('consumption.budgetMin', 'budgetMin must be <= budgetMax');
      }
      if (typeof budgetMax !== 'number' || budgetMax < 0) push('consumption.budgetMax', 'must be a non-negative number');
      if (!(DECISION_CYCLES as readonly unknown[]).includes(consumption.decisionCycle)) push('consumption.decisionCycle', 'unknown decision cycle');
      if (!(BRAND_LOYALTIES as readonly unknown[]).includes(consumption.brandLoyalty)) push('consumption.brandLoyalty', 'must be low/medium/high');
      if (consumption.purchaseChannel !== undefined && !(PURCHASE_CHANNELS as readonly unknown[]).includes(consumption.purchaseChannel)) {
        push('consumption.purchaseChannel', 'must be wechat_private|ecommerce|offline|live');
      }
      if (consumption.ingredientFocus !== undefined && !(INGREDIENT_FOCUS as readonly unknown[]).includes(consumption.ingredientFocus)) {
        push('consumption.ingredientFocus', 'must be none|normal|focused');
      }
      if (consumption.competitorComparison !== undefined && !(COMPETITOR_COMPARISONS as readonly unknown[]).includes(consumption.competitorComparison)) {
        push('consumption.competitorComparison', 'must be never|occasionally|frequently');
      }
      if (consumption.skinType !== undefined && !(SKIN_TYPES as readonly unknown[]).includes(consumption.skinType)) {
        push('consumption.skinType', 'must be dry|oily|combination|mixed_dry|mixed_oily|sensitive|normal');
      }
      for (const [field, maxItems, maxLength] of [
        ['skinConcerns', SKIN_CONCERNS_MAX_ITEMS, SKIN_CONCERNS_MAX_ITEM_LENGTH],
        ['healthGoals', HEALTH_GOALS_MAX_ITEMS, HEALTH_GOALS_MAX_ITEM_LENGTH],
        ['allergies', ALLERGIES_MAX_ITEMS, ALLERGIES_MAX_ITEM_LENGTH],
      ] as const) {
        const value = consumption[field];
        if (value === undefined) continue;
        if (!Array.isArray(value)) {
          push(`consumption.${field}`, 'must be an array of strings');
          continue;
        }
        if (value.length > maxItems) push(`consumption.${field}`, `must have at most ${maxItems} items`);
        value.forEach((item, index) => {
          if (typeof item !== 'string') {
            push(`consumption.${field}[${index}]`, 'must be a string');
          } else if (item.length > maxLength) {
            push(`consumption.${field}[${index}]`, `must be at most ${maxLength} characters`);
          }
        });
      }
      if (consumption.currentProducts !== undefined) {
        if (typeof consumption.currentProducts !== 'string') {
          push('consumption.currentProducts', 'must be a string');
        } else if (consumption.currentProducts.length > 200) {
          push('consumption.currentProducts', 'must be at most 200 characters');
        }
      }
    }

    const conversation = config.conversation as Record<string, unknown> | undefined;
    if (typeof conversation !== 'object' || conversation === null) {
      push('conversation', 'conversation block is required');
    } else {
      rejectUnknownKeys(conversation, CONVERSATION_KEYS, 'conversation');
      if (!(DIFFICULTIES as readonly number[]).includes(conversation.difficulty as number)) push('conversation.difficulty', 'must be 1|2|3|4');
      if (!isIntegerIn(conversation.maxTurns, MAX_TURNS_MIN, MAX_TURNS_MAX)) push('conversation.maxTurns', `must be an integer in [${MAX_TURNS_MIN}, ${MAX_TURNS_MAX}]`);
      if (!nonEmptyString(conversation.background)) push('conversation.background', 'background is required');
      if (conversation.background !== undefined && typeof conversation.background === 'string' && conversation.background.length > 500) {
        push('conversation.background', 'must be at most 500 characters');
      }
      if (!nonEmptyString(conversation.productScenario)) push('conversation.productScenario', 'productScenario is required');
      if (conversation.productScenario !== undefined && typeof conversation.productScenario === 'string' && conversation.productScenario.length > 50) {
        push('conversation.productScenario', 'must be at most 50 characters');
      }
      if (conversation.openingMode !== undefined && !(OPENING_MODES as readonly unknown[]).includes(conversation.openingMode)) {
        push('conversation.openingMode', 'must be ai_first|wait_learner');
      }
      if (conversation.customNotes !== undefined) {
        if (typeof conversation.customNotes !== 'string') {
          push('conversation.customNotes', 'must be a string');
        } else if (conversation.customNotes.length > 500) {
          push('conversation.customNotes', 'must be at most 500 characters');
        }
      }
    }

    return { valid: issues.length === 0, issues };
  }

  private deriveId(input: BuildPersonaInput, selectedPsychology: ReadonlySet<string>): string {
    const overrides = input.overrides ?? {};
    const seed = JSON.stringify([
      input.ageCardId,
      [...selectedPsychology].sort(),
      input.difficulty,
      input.productScenarioId,
      overrides.age ?? null,
      overrides.gender ?? null,
      overrides.basic ?? null,
      overrides.occupation ?? null,
      overrides.personality ?? null,
      overrides.communication ?? null,
      overrides.consumption ?? null,
      overrides.conversation ?? null,
    ]);
    return `persona-${crypto.createHash('sha256').update(seed).digest('hex').slice(0, 12)}`;
  }
}
