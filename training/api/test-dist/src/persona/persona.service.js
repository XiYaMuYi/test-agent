import crypto from 'node:crypto';
import { AGE_CARDS, COHORT_CARDS, PSYCHOLOGY_CARDS, DIFFICULTY_LEVELS, PRODUCT_SCENARIOS, CUSTOMER_RELATIONS, CUSTOMER_COHORTS, TRUST_LEVELS, SKIN_CONCERNS, PRODUCT_SCENARIO_CATEGORIES, DEFAULT_COMMUNICATION, DEFAULT_CONVERSATION, DEFAULT_CONSUMPTION, DEFAULT_BASIC, getCardPreset, getCohortPreset, } from '@training/contracts';
/**
 * 心理卡除 skepticismBoost / priceSensitivityBoost 两个数值之外，对性格维度与消费习惯的
 * 额外影响。此前卡面描述（爱聊家常/研究成分/被动/冲动…）没有接线，这里补齐，
 * 让每张心理卡的行为特征真正进入 PersonaConfig。用户显式 overrides 仍优先于这些倾向。
 */
const PSYCHOLOGY_EXTRA_EFFECT = {
    chatty: { socialActivity: 25 }, // 故事型：爱聊家常、容易跑题 → 更健谈
    passive: { socialActivity: -25 }, // 被动型：不主动表达 → 更沉默，等销售引导
    impulsive: { decisiveness: 20 }, // 冲动型：容易被说动 → 决策更快
    hesitant: { decisiveness: -20 }, // 犹豫型：问很多但不决定 → 决策更慢
    professional: { consumption: { ingredientFocus: 'focused' } }, // 专业型：研究成分、问得细
    bargain: { consumption: { competitorComparison: 'frequently' } }, // 比价型：频繁对比竞品
};
const PERSONALITY_TRAITS = ['friendliness', 'patience', 'priceSensitivity', 'decisiveness', 'skepticism', 'socialActivity', 'emotionalVolatility'];
const DIFFICULTIES = [1, 2, 3, 4];
const COMMUNICATION_STYLES = ['direct', 'gentle', 'strong', 'humorous', 'serious'];
const VERBOSITIES = ['brief', 'normal', 'verbose'];
const EMOTION_LEVELS = ['reserved', 'normal', 'expressive'];
const DECISION_CYCLES = ['impulse', 'same_day', 'few_days', 'long_term'];
const BRAND_LOYALTIES = ['low', 'medium', 'high'];
const DIALECTS = ['mandarin', 'southwest', 'northeast', 'cantonese', 'wu'];
const PURCHASE_CHANNELS = ['wechat_private', 'ecommerce', 'offline', 'live'];
const INGREDIENT_FOCUS = ['none', 'normal', 'focused'];
const COMPETITOR_COMPARISONS = ['never', 'occasionally', 'frequently'];
const OPENING_MODES = ['ai_first', 'wait_learner'];
const GENDERS = ['female', 'male', 'unknown'];
const MARITAL_STATUSES = ['single', 'married', 'unknown'];
const INCOME_LEVELS = ['low', 'medium', 'high'];
const CUSTOMER_RELATION_IDS = ['prospect', 'new_follower', 'gift_follower', 'first_order', 'returning'];
const CUSTOMER_COHORT_IDS = ['gen_z', 'precision_mom', 'new_white_collar', 'urban_blue_collar', 'town_youth', 'town_senior', 'established_middle_class', 'urban_silver'];
const TRUST_LEVEL_VALUES = [1, 2, 3, 4, 5];
const MAX_TURNS_MIN = 1;
const MAX_TURNS_MAX = 100;
const AGE_MIN = 0;
const AGE_MAX = 120;
const SKIN_TYPES = ['dry', 'oily', 'combination', 'mixed_dry', 'mixed_oily', 'sensitive', 'normal'];
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
const GENDER_LABELS = { female: '女', male: '男', unknown: '未知' };
const MARITAL_STATUS_LABELS = { single: '未婚', married: '已婚', unknown: '未知' };
const INCOME_LEVEL_LABELS = { low: '较低', medium: '中等', high: '较高' };
const PERSONALITY_TRAIT_LABELS = {
    friendliness: '友好度',
    patience: '耐心度',
    priceSensitivity: '价格敏感度',
    decisiveness: '决策果断度',
    skepticism: '怀疑程度',
    socialActivity: '社交活跃度',
    emotionalVolatility: '情绪波动度',
};
const COMMUNICATION_STYLE_LABELS = {
    direct: '直接', gentle: '温和', strong: '强势', humorous: '幽默', serious: '严肃',
};
const VERBOSITY_LABELS = { brief: '话少', normal: '适中', verbose: '话多' };
const EMOTION_LEVEL_LABELS = { reserved: '内敛', normal: '平稳', expressive: '外放' };
const DIALECT_LABELS = {
    mandarin: '普通话', southwest: '西南官话', northeast: '东北话', cantonese: '粤语', wu: '吴语',
};
const DECISION_CYCLE_LABELS = {
    impulse: '冲动型', same_day: '当天决定', few_days: '考虑几天', long_term: '长期观望',
};
const BRAND_LOYALTY_LABELS = { low: '低', medium: '中', high: '高' };
const SKIN_TYPE_LABELS = {
    dry: '干性', oily: '油性', combination: '混合性', mixed_dry: '混干性', mixed_oily: '混油性', sensitive: '敏感肌', normal: '中性',
};
const PURCHASE_CHANNEL_LABELS = {
    wechat_private: '微信私域', ecommerce: '电商平台', offline: '线下门店', live: '直播间',
};
const INGREDIENT_FOCUS_LABELS = {
    none: '不关注', normal: '一般关注', focused: '深度研究',
};
const COMPETITOR_COMPARISON_LABELS = {
    never: '不比较', occasionally: '偶尔比较', frequently: '频繁比较',
};
const OPENING_MODE_LABELS = {
    ai_first: 'AI 先开口', wait_learner: '等学员先开口',
};
function optionize(values, labels) {
    return values.map((value) => ({ value, label: labels[value] ?? value }));
}
const BASIC_KEYS = new Set([
    'maritalStatus', 'incomeLevel',
    'customerRelation', 'purchaseCategory', 'trustLevel', 'customerCohort', 'city',
]);
const PERSONALITY_TRAIT_SET = new Set(PERSONALITY_TRAITS);
const COMMUNICATION_KEYS = new Set(['style', 'verbosity', 'emotionLevel', 'dialect', 'catchphrase']);
const CONSUMPTION_KEYS = new Set([
    'budgetMin', 'budgetMax', 'decisionCycle', 'brandLoyalty', 'purchaseChannel',
    'ingredientFocus', 'competitorComparison', 'skinType', 'skinConcerns',
    'healthGoals', 'allergies', 'currentProducts',
]);
const CONVERSATION_KEYS = new Set([
    'difficulty', 'maxTurns', 'background', 'productScenario', 'openingMode', 'customNotes',
]);
function clampTrait(value) {
    return Math.max(0, Math.min(100, Math.round(value)));
}
function isIntegerIn(value, min, max) {
    return typeof value === 'number' && Number.isInteger(value) && value >= min && value <= max;
}
function nonEmptyString(value) {
    return typeof value === 'string' && value.trim().length > 0;
}
/** Drop undefined keys so partial overrides never erase defaults with undefined. */
function definedOnly(value) {
    if (value === undefined)
        return {};
    const result = {};
    for (const [key, item] of Object.entries(value)) {
        if (item !== undefined)
            result[key] = item;
    }
    return result;
}
/**
 * 两级产品场景查找（v2 §2.6）：先匹配旧 8 个平铺 id；未命中再按
 * `categoryId::scene` 编码从 5 大类的 scenes 展开里找（B 端新分组下拉的下发值）。
 * 命中返回与旧场景同形状的 { id, displayName, description }。
 */
function findScenario(inputId) {
    const legacy = PRODUCT_SCENARIOS.find((item) => item.id === inputId);
    if (legacy !== undefined)
        return legacy;
    const separator = inputId.indexOf('::');
    if (separator <= 0)
        return undefined;
    const categoryId = inputId.slice(0, separator);
    const scene = inputId.slice(separator + 2);
    const category = PRODUCT_SCENARIO_CATEGORIES.find((item) => item.id === categoryId);
    if (category === undefined || !category.scenes.includes(scene))
        return undefined;
    return { id: inputId, displayName: scene, description: category.category };
}
function deepFreeze(value) {
    if (value !== null && typeof value === 'object' && !Object.isFrozen(value)) {
        for (const key of Object.keys(value)) {
            deepFreeze(value[key]);
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
function normalizeBrandLoyalty(raw) {
    if (raw === 'low' || raw === 'medium' || raw === 'high')
        return raw;
    if (typeof raw === 'number')
        return raw < 40 ? 'low' : raw < 70 ? 'medium' : 'high';
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
    getPresetCatalog() {
        return deepFreeze({
            ageCards: AGE_CARDS,
            cohortCards: COHORT_CARDS.map((card) => ({
                id: card.id,
                displayName: card.displayName,
                description: card.description,
                age: card.age,
                occupation: card.occupation,
                budgetMin: card.consumption.budgetMin,
                budgetMax: card.consumption.budgetMax,
            })),
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
    getFieldMetadata() {
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
    getAgeCard(ageCardId) {
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
    resolveBaseCard(input) {
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
    buildPersonaConfig(input) {
        const card = this.resolveBaseCard(input);
        const selectedPsychology = new Set();
        let skepticismBoost = 0;
        let priceSensitivityBoost = 0;
        let socialActivityBoost = 0;
        let decisivenessBoost = 0;
        const psychologyConsumption = {};
        for (const psychologyId of input.psychologyCardIds ?? []) {
            if (selectedPsychology.has(psychologyId))
                continue; // a card applies at most once
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
                if (extra.consumption !== undefined)
                    Object.assign(psychologyConsumption, extra.consumption);
            }
        }
        const scenario = findScenario(input.productScenarioId);
        if (scenario === undefined) {
            throw new Error('PERSONA_PRESET_NOT_FOUND');
        }
        if (!DIFFICULTIES.includes(input.difficulty)) {
            throw new Error('PERSONA_CONFIG_INVALID');
        }
        const overrides = input.overrides ?? {};
        const basePersonality = {
            friendliness: clampTrait(card.personality.friendliness),
            patience: clampTrait(card.personality.patience),
            priceSensitivity: clampTrait(card.personality.priceSensitivity + priceSensitivityBoost),
            decisiveness: clampTrait(card.personality.decisiveness + decisivenessBoost),
            skepticism: clampTrait(card.personality.skepticism + skepticismBoost),
            socialActivity: clampTrait(50 + socialActivityBoost),
            emotionalVolatility: 50,
        };
        const mergedPersonality = {
            ...basePersonality,
            ...definedOnly(overrides.personality),
        };
        for (const trait of PERSONALITY_TRAITS) {
            mergedPersonality[trait] = clampTrait(mergedPersonality[trait]);
        }
        const personality = mergedPersonality;
        const communication = {
            ...DEFAULT_COMMUNICATION,
            ...definedOnly(overrides.communication),
        };
        const consumption = {
            ...DEFAULT_CONSUMPTION,
            ...psychologyConsumption,
            ...card.consumption,
            ...definedOnly(overrides.consumption),
            brandLoyalty: normalizeBrandLoyalty((definedOnly(overrides.consumption).brandLoyalty) ?? card.consumption.brandLoyalty),
        };
        const conversation = {
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
        const basic = {
            ...DEFAULT_BASIC,
            ...definedOnly(overrides.basic),
            ...(input.customerRelation !== undefined ? { customerRelation: input.customerRelation } : {}),
            ...(input.purchaseCategory !== undefined ? { purchaseCategory: input.purchaseCategory } : {}),
            ...(input.trustLevel !== undefined ? { trustLevel: input.trustLevel } : {}),
            ...(input.customerCohort !== undefined ? { customerCohort: input.customerCohort } : {}),
            ...(input.city !== undefined ? { city: input.city } : {}),
        };
        const config = {
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
    validatePersonaConfig(raw) {
        const issues = [];
        const push = (path, reason) => {
            issues.push({ path, reason });
        };
        const rejectUnknownKeys = (value, allowed, path) => {
            for (const key of Object.keys(value)) {
                if (!allowed.has(key))
                    push(`${path === '' ? '' : `${path}.`}${key}`, 'unknown field');
            }
        };
        if (typeof raw !== 'object' || raw === null) {
            return { valid: false, issues: [{ path: '$', reason: 'persona config must be an object' }] };
        }
        const config = raw;
        // 拒绝未知关键字段，防止 B/C 端契约继续漂移（spec §9.1）。
        rejectUnknownKeys(config, PERSONA_TOP_LEVEL_KEYS, '');
        if (!nonEmptyString(config.name))
            push('name', 'name is required');
        if (config.name !== undefined && typeof config.name === 'string' && config.name.length > 64) {
            push('name', 'must be at most 64 characters');
        }
        if (!nonEmptyString(config.basedOnCard))
            push('basedOnCard', 'basedOnCard is required');
        if (!nonEmptyString(config.occupation))
            push('occupation', 'occupation is required');
        if (config.occupation !== undefined && typeof config.occupation === 'string' && config.occupation.length > 32) {
            push('occupation', 'must be at most 32 characters');
        }
        if (!isIntegerIn(config.age, AGE_MIN, AGE_MAX))
            push('age', `age must be an integer in [${AGE_MIN}, ${AGE_MAX}]`);
        // 验证 gender 枚举
        if (config.gender !== undefined && !GENDERS.includes(config.gender)) {
            push('gender', 'must be female|male|unknown');
        }
        // 验证 basic 子块
        const basic = config.basic;
        if (basic !== undefined) {
            if (typeof basic !== 'object' || basic === null || Array.isArray(basic)) {
                push('basic', 'must be an object');
            }
            else {
                rejectUnknownKeys(basic, BASIC_KEYS, 'basic');
                if (basic.maritalStatus !== undefined && !MARITAL_STATUSES.includes(basic.maritalStatus)) {
                    push('basic.maritalStatus', 'must be single|married|unknown');
                }
                if (basic.incomeLevel !== undefined && !INCOME_LEVELS.includes(basic.incomeLevel)) {
                    push('basic.incomeLevel', 'must be low|medium|high');
                }
                if (basic.customerRelation !== undefined && !CUSTOMER_RELATION_IDS.includes(basic.customerRelation)) {
                    push('basic.customerRelation', 'must be prospect|new_follower|gift_follower|first_order|returning');
                }
                if (basic.trustLevel !== undefined && !TRUST_LEVEL_VALUES.includes(basic.trustLevel)) {
                    push('basic.trustLevel', 'must be an integer in [1, 5]');
                }
                if (basic.customerCohort !== undefined && !CUSTOMER_COHORT_IDS.includes(basic.customerCohort)) {
                    push('basic.customerCohort', 'must be one of the 8 DMP cohort ids');
                }
                if (basic.city !== undefined) {
                    if (typeof basic.city !== 'string') {
                        push('basic.city', 'must be a string');
                    }
                    else if (basic.city.length > 30) {
                        push('basic.city', 'must be at most 30 characters');
                    }
                }
                if (basic.purchaseCategory !== undefined) {
                    if (typeof basic.purchaseCategory !== 'string') {
                        push('basic.purchaseCategory', 'must be a string');
                    }
                    else if (basic.purchaseCategory.length > 50) {
                        push('basic.purchaseCategory', 'must be at most 50 characters');
                    }
                }
            }
        }
        const personality = config.personality;
        if (typeof personality !== 'object' || personality === null) {
            push('personality', 'personality block is required');
        }
        else {
            rejectUnknownKeys(personality, PERSONALITY_TRAIT_SET, 'personality');
            for (const trait of PERSONALITY_TRAITS) {
                const value = personality[trait];
                if (typeof value !== 'number' || value < 0 || value > 100) {
                    push(`personality.${trait}`, 'must be a number in [0, 100]');
                }
            }
        }
        const communication = config.communication;
        if (typeof communication !== 'object' || communication === null) {
            push('communication', 'communication block is required');
        }
        else {
            rejectUnknownKeys(communication, COMMUNICATION_KEYS, 'communication');
            if (!COMMUNICATION_STYLES.includes(communication.style))
                push('communication.style', 'unknown style');
            if (!VERBOSITIES.includes(communication.verbosity))
                push('communication.verbosity', 'unknown verbosity');
            if (!EMOTION_LEVELS.includes(communication.emotionLevel))
                push('communication.emotionLevel', 'unknown emotion level');
            if (communication.dialect !== undefined && !DIALECTS.includes(communication.dialect)) {
                push('communication.dialect', 'must be mandarin|southwest|northeast|cantonese|wu');
            }
            if (communication.catchphrase !== undefined) {
                if (typeof communication.catchphrase !== 'string') {
                    push('communication.catchphrase', 'must be a string');
                }
                else if (communication.catchphrase.length > 80) {
                    push('communication.catchphrase', 'must be at most 80 characters');
                }
            }
        }
        const consumption = config.consumption;
        if (typeof consumption !== 'object' || consumption === null) {
            push('consumption', 'consumption block is required');
        }
        else {
            rejectUnknownKeys(consumption, CONSUMPTION_KEYS, 'consumption');
            const { budgetMin, budgetMax } = consumption;
            if (typeof budgetMin !== 'number' || budgetMin < 0) {
                push('consumption.budgetMin', 'must be a non-negative number');
            }
            else if (typeof budgetMax !== 'number' || budgetMax < budgetMin) {
                push('consumption.budgetMin', 'budgetMin must be <= budgetMax');
            }
            if (typeof budgetMax !== 'number' || budgetMax < 0)
                push('consumption.budgetMax', 'must be a non-negative number');
            if (!DECISION_CYCLES.includes(consumption.decisionCycle))
                push('consumption.decisionCycle', 'unknown decision cycle');
            if (!BRAND_LOYALTIES.includes(consumption.brandLoyalty))
                push('consumption.brandLoyalty', 'must be low/medium/high');
            if (consumption.purchaseChannel !== undefined && !PURCHASE_CHANNELS.includes(consumption.purchaseChannel)) {
                push('consumption.purchaseChannel', 'must be wechat_private|ecommerce|offline|live');
            }
            if (consumption.ingredientFocus !== undefined && !INGREDIENT_FOCUS.includes(consumption.ingredientFocus)) {
                push('consumption.ingredientFocus', 'must be none|normal|focused');
            }
            if (consumption.competitorComparison !== undefined && !COMPETITOR_COMPARISONS.includes(consumption.competitorComparison)) {
                push('consumption.competitorComparison', 'must be never|occasionally|frequently');
            }
            if (consumption.skinType !== undefined && !SKIN_TYPES.includes(consumption.skinType)) {
                push('consumption.skinType', 'must be dry|oily|combination|mixed_dry|mixed_oily|sensitive|normal');
            }
            for (const [field, maxItems, maxLength] of [
                ['skinConcerns', SKIN_CONCERNS_MAX_ITEMS, SKIN_CONCERNS_MAX_ITEM_LENGTH],
                ['healthGoals', HEALTH_GOALS_MAX_ITEMS, HEALTH_GOALS_MAX_ITEM_LENGTH],
                ['allergies', ALLERGIES_MAX_ITEMS, ALLERGIES_MAX_ITEM_LENGTH],
            ]) {
                const value = consumption[field];
                if (value === undefined)
                    continue;
                if (!Array.isArray(value)) {
                    push(`consumption.${field}`, 'must be an array of strings');
                    continue;
                }
                if (value.length > maxItems)
                    push(`consumption.${field}`, `must have at most ${maxItems} items`);
                value.forEach((item, index) => {
                    if (typeof item !== 'string') {
                        push(`consumption.${field}[${index}]`, 'must be a string');
                    }
                    else if (item.length > maxLength) {
                        push(`consumption.${field}[${index}]`, `must be at most ${maxLength} characters`);
                    }
                });
            }
            if (consumption.currentProducts !== undefined) {
                if (typeof consumption.currentProducts !== 'string') {
                    push('consumption.currentProducts', 'must be a string');
                }
                else if (consumption.currentProducts.length > 200) {
                    push('consumption.currentProducts', 'must be at most 200 characters');
                }
            }
        }
        const conversation = config.conversation;
        if (typeof conversation !== 'object' || conversation === null) {
            push('conversation', 'conversation block is required');
        }
        else {
            rejectUnknownKeys(conversation, CONVERSATION_KEYS, 'conversation');
            if (!DIFFICULTIES.includes(conversation.difficulty))
                push('conversation.difficulty', 'must be 1|2|3|4');
            if (!isIntegerIn(conversation.maxTurns, MAX_TURNS_MIN, MAX_TURNS_MAX))
                push('conversation.maxTurns', `must be an integer in [${MAX_TURNS_MIN}, ${MAX_TURNS_MAX}]`);
            if (!nonEmptyString(conversation.background))
                push('conversation.background', 'background is required');
            if (conversation.background !== undefined && typeof conversation.background === 'string' && conversation.background.length > 500) {
                push('conversation.background', 'must be at most 500 characters');
            }
            if (!nonEmptyString(conversation.productScenario))
                push('conversation.productScenario', 'productScenario is required');
            if (conversation.productScenario !== undefined && typeof conversation.productScenario === 'string' && conversation.productScenario.length > 50) {
                push('conversation.productScenario', 'must be at most 50 characters');
            }
            if (conversation.openingMode !== undefined && !OPENING_MODES.includes(conversation.openingMode)) {
                push('conversation.openingMode', 'must be ai_first|wait_learner');
            }
            if (conversation.customNotes !== undefined) {
                if (typeof conversation.customNotes !== 'string') {
                    push('conversation.customNotes', 'must be a string');
                }
                else if (conversation.customNotes.length > 500) {
                    push('conversation.customNotes', 'must be at most 500 characters');
                }
            }
        }
        return { valid: issues.length === 0, issues };
    }
    deriveId(input, selectedPsychology) {
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
