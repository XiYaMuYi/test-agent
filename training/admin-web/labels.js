/**
 * 业务词汇与展示格式化层。
 *
 * 目标：让页面只出现运营能看懂的中文业务概念，绝不把后端枚举、技术字段名、
 * 原始 UUID / 时间戳直接抛给用户。所有页面共用这里的映射与格式化函数，
 * 保证同一概念在任何页面措辞一致。纯函数、无 DOM，便于单测。
 */
const PLACEHOLDER = '—';
/** 对话难度 1-4 → 中文难度名。 */
const DIFFICULTY_LABELS = {
    1: '友好型',
    2: '普通型',
    3: '刁钻型',
    4: '难缠型',
};
export function difficultyLabel(level) {
    if (typeof level === 'number') {
        return DIFFICULTY_LABELS[level] ?? PLACEHOLDER;
    }
    return PLACEHOLDER;
}
const SCOPE_LABELS = {
    platform: '平台',
    organization: '组织',
    personal: '个人',
};
export function scopeLabel(scope) {
    return typeof scope === 'string' ? (SCOPE_LABELS[scope] ?? PLACEHOLDER) : PLACEHOLDER;
}
const TEMPLATE_STATUS_LABELS = {
    active: '生效中',
    archived: '已归档',
};
export function templateStatusLabel(status) {
    return typeof status === 'string' ? (TEMPLATE_STATUS_LABELS[status] ?? PLACEHOLDER) : PLACEHOLDER;
}
const ASSIGNMENT_STATUS_LABELS = {
    draft: '未开始',
    active: '进行中',
    paused: '已暂停',
    ended: '已结束',
};
export function assignmentStatusLabel(status) {
    return typeof status === 'string' ? (ASSIGNMENT_STATUS_LABELS[status] ?? PLACEHOLDER) : PLACEHOLDER;
}
const SOURCE_LABELS = {
    free: '自由练习',
    assigned: '团队任务',
};
export function sourceLabel(source) {
    return typeof source === 'string' ? (SOURCE_LABELS[source] ?? PLACEHOLDER) : PLACEHOLDER;
}
const MODE_LABELS = {
    practice: '练习',
    exam: '考核',
};
/** 训练模式 practice/exam → 中文。 */
export function modeLabel(mode) {
    return typeof mode === 'string' ? (MODE_LABELS[mode] ?? PLACEHOLDER) : PLACEHOLDER;
}
/**
 * 能力维度 / 薄弱点枚举 → 运营可读中文。
 * 后端 dimensionScores 的键与 weakPoints 取值共用这一套枚举，
 * 绝不能把 needs_discovery 这类技术标识直接展示给运营。
 */
const DIMENSION_LABELS = {
    // 旧版五维（历史报告 / 学员画像聚合沿用，保留映射）
    needs_discovery: '需求挖掘',
    product_presentation: '产品讲解',
    objection_handling: '异议处理',
    emotion_management: '情绪管理与共情',
    closing_ability: '成交推进与连带',
    // 私域经营能力模型（新 8 维）
    problem_solving: '问题解决力',
    professionalism: '专业度',
    needs_insight: '需求洞察与客户分层',
    trust_building: '信任建立',
    closing: '成交推进与连带',
    rapport_stickiness: '联系与粘性',
    campaign_timeliness: '营销活动与时效',
    communication_experience: '沟通体验',
    // 扩展维度
    product_accuracy: '产品知识准确性',
};
/** 能力维度枚举 → 中文；未知枚举回退原值，避免出现空白。 */
export function dimensionLabel(key) {
    if (typeof key !== 'string' || key.length === 0)
        return PLACEHOLDER;
    return DIMENSION_LABELS[key] ?? key;
}
const SESSION_STATUS_LABELS = {
    created: '未开始',
    active: '进行中',
    ended: '已结束',
    scored: '已评分',
};
/** 训练会话状态 → 中文。 */
export function sessionStatusLabel(status) {
    return typeof status === 'string' ? (SESSION_STATUS_LABELS[status] ?? PLACEHOLDER) : PLACEHOLDER;
}
/** 分数 → 业务等级 + 配色语义；非有限分数返回 null（调用方据此隐藏分数块）。 */
export function scoreBand(score) {
    if (typeof score !== 'number' || !Number.isFinite(score))
        return null;
    if (score >= 85)
        return { label: '优秀', tone: 'good' };
    if (score >= 60)
        return { label: '达标', tone: 'warn' };
    return { label: '待提升', tone: 'bad' };
}
const pad2 = (value) => String(value).padStart(2, '0');
/** ISO 时间 → 本地「YYYY-MM-DD HH:mm」；非法输入回退占位。 */
export function formatDateTime(value) {
    if (typeof value !== 'string' && !(value instanceof Date))
        return PLACEHOLDER;
    const date = value instanceof Date ? value : new Date(value);
    if (!Number.isFinite(date.getTime()))
        return PLACEHOLDER;
    return `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())} `
        + `${pad2(date.getHours())}:${pad2(date.getMinutes())}`;
}
/** 长 UUID 只展示前 8 位大写作为次要编号。 */
export function shortId(id) {
    if (typeof id !== 'string' || id.length === 0)
        return PLACEHOLDER;
    return id.slice(0, 8).toUpperCase();
}
/**
 * 把一个多行文本框解析成去空、去重、保序的列表；同时容忍英文逗号、
 * 中文逗号与空白分隔，让运营不必记分隔符约定。
 */
export function parseLines(text) {
    if (typeof text !== 'string')
        return [];
    const seen = new Set();
    const result = [];
    for (const raw of text.split(/[\s,，、;；]+/u)) {
        const item = raw.trim();
        if (item.length === 0 || seen.has(item))
            continue;
        seen.add(item);
        result.push(item);
    }
    return result;
}
/** 依据所选客户类型与产品场景，自动拼出好读的模板名。 */
export function buildTemplateName(ageLabel, scenarioLabel) {
    return `${ageLabel}·${scenarioLabel}陪练`;
}
/** 从预设目录中按 id 取中文名，未知回退占位。 */
export function labelOf(options, id) {
    if (typeof id !== 'string')
        return PLACEHOLDER;
    return options.find((option) => option.id === id)?.displayName ?? PLACEHOLDER;
}
/** 把冻结画像快照压成「客户类型 · 难度 · 场景」一句中文摘要，供列表展示。 */
export function summarizePersona(persona, ageCatalog = []) {
    if (typeof persona !== 'object' || persona === null)
        return PLACEHOLDER;
    const data = persona;
    const card = typeof data.basedOnCard === 'string'
        ? (labelOf(ageCatalog, data.basedOnCard) === PLACEHOLDER ? data.basedOnCard : labelOf(ageCatalog, data.basedOnCard))
        : PLACEHOLDER;
    const difficulty = difficultyLabel(data.conversation?.difficulty);
    const scenario = typeof data.conversation?.productScenario === 'string' ? data.conversation.productScenario : PLACEHOLDER;
    return [card, difficulty, scenario].join(' · ');
}

/** 人设来源 → 中文：模板绑定 / 独立配置（spec §5.2）。 */
const PERSONA_SOURCE_LABELS = {
    template_revision: '绑定模板',
    inline: '独立配置',
};
export function personaSourceLabel(kind) {
    return typeof kind === 'string' ? (PERSONA_SOURCE_LABELS[kind] ?? PLACEHOLDER) : PLACEHOLDER;
}

/** 性别枚举 → 中文。 */
const GENDER_LABELS = { female: '女', male: '男', unknown: '未知' };
export function genderLabel(value) {
    return typeof value === 'string' ? (GENDER_LABELS[value] ?? PLACEHOLDER) : PLACEHOLDER;
}

/** 婚姻状态 → 中文。 */
const MARITAL_STATUS_LABELS = { single: '未婚', married: '已婚', unknown: '未知' };
export function maritalStatusLabel(value) {
    return typeof value === 'string' ? (MARITAL_STATUS_LABELS[value] ?? PLACEHOLDER) : PLACEHOLDER;
}

/** 收入水平 → 中文。 */
const INCOME_LEVEL_LABELS = { low: '较低', medium: '中等', high: '较高' };
export function incomeLevelLabel(value) {
    return typeof value === 'string' ? (INCOME_LEVEL_LABELS[value] ?? PLACEHOLDER) : PLACEHOLDER;
}

/** 性格参数名 → 中文（与后端共享元数据一致）。 */
const PERSONALITY_TRAIT_LABELS = {
    friendliness: '友好度',
    patience: '耐心度',
    priceSensitivity: '价格敏感度',
    decisiveness: '决策果断度',
    skepticism: '怀疑程度',
    socialActivity: '社交活跃度',
    emotionalVolatility: '情绪波动度',
};
export function personalityTraitLabel(key) {
    return typeof key === 'string' ? (PERSONALITY_TRAIT_LABELS[key] ?? key) : PLACEHOLDER;
}

/** 沟通方式枚举 → 中文。 */
const COMMUNICATION_STYLE_LABELS = { direct: '直接', gentle: '温和', strong: '强势', humorous: '幽默', serious: '严肃' };
const VERBOSITY_LABELS = { brief: '话少', normal: '适中', verbose: '话多' };
const EMOTION_LEVEL_LABELS = { reserved: '内敛', normal: '平稳', expressive: '外放' };
const DIALECT_LABELS = { mandarin: '普通话', southwest: '西南官话', northeast: '东北话', cantonese: '粤语', wu: '吴语' };
export function communicationStyleLabel(value) {
    return typeof value === 'string' ? (COMMUNICATION_STYLE_LABELS[value] ?? PLACEHOLDER) : PLACEHOLDER;
}
export function verbosityLabel(value) {
    return typeof value === 'string' ? (VERBOSITY_LABELS[value] ?? PLACEHOLDER) : PLACEHOLDER;
}
export function emotionLevelLabel(value) {
    return typeof value === 'string' ? (EMOTION_LEVEL_LABELS[value] ?? PLACEHOLDER) : PLACEHOLDER;
}
export function dialectLabel(value) {
    return typeof value === 'string' ? (DIALECT_LABELS[value] ?? PLACEHOLDER) : PLACEHOLDER;
}

/** 消费与需求枚举 → 中文。 */
const DECISION_CYCLE_LABELS = { impulse: '冲动型', same_day: '当天决定', few_days: '考虑几天', long_term: '长期观望' };
const BRAND_LOYALTY_LABELS = { low: '低', medium: '中', high: '高' };
const SKIN_TYPE_LABELS = { dry: '干性', oily: '油性', combination: '混合性', sensitive: '敏感肌', normal: '中性' };
const PURCHASE_CHANNEL_LABELS = { wechat_private: '微信私域', ecommerce: '电商平台', offline: '线下门店', live: '直播间' };
const INGREDIENT_FOCUS_LABELS = { none: '不关注', normal: '一般关注', focused: '深度研究' };
const COMPETITOR_COMPARISON_LABELS = { never: '不比较', occasionally: '偶尔比较', frequently: '频繁比较' };
export function decisionCycleLabel(value) {
    return typeof value === 'string' ? (DECISION_CYCLE_LABELS[value] ?? PLACEHOLDER) : PLACEHOLDER;
}
export function brandLoyaltyLabel(value) {
    return typeof value === 'string' ? (BRAND_LOYALTY_LABELS[value] ?? PLACEHOLDER) : PLACEHOLDER;
}
export function skinTypeLabel(value) {
    return typeof value === 'string' ? (SKIN_TYPE_LABELS[value] ?? PLACEHOLDER) : PLACEHOLDER;
}
export function purchaseChannelLabel(value) {
    return typeof value === 'string' ? (PURCHASE_CHANNEL_LABELS[value] ?? PLACEHOLDER) : PLACEHOLDER;
}
export function ingredientFocusLabel(value) {
    return typeof value === 'string' ? (INGREDIENT_FOCUS_LABELS[value] ?? PLACEHOLDER) : PLACEHOLDER;
}
export function competitorComparisonLabel(value) {
    return typeof value === 'string' ? (COMPETITOR_COMPARISON_LABELS[value] ?? PLACEHOLDER) : PLACEHOLDER;
}

/** 对话控制枚举 → 中文。 */
const OPENING_MODE_LABELS = { ai_first: 'AI 先开口', wait_learner: '等学员先开口' };
export function openingModeLabel(value) {
    return typeof value === 'string' ? (OPENING_MODE_LABELS[value] ?? PLACEHOLDER) : PLACEHOLDER;
}

/** AgentConfigV1 枚举 → 中文（spec §5.5）。 */
const RESPONSE_LENGTH_LABELS = { short: '简洁', normal: '适中', detailed: '详尽' };
const KNOWLEDGE_STRICTNESS_LABELS = { strict: '严格（只讲知识要点）', balanced: '平衡（可补充常识）' };
const CONVERSATION_PACE_LABELS = { slow: '慢节奏', normal: '正常', fast: '快节奏' };
const CLOSING_TENDENCY_LABELS = { resistant: '抗成交', neutral: '中性', receptive: '易成交' };
export function responseLengthLabel(value) {
    return typeof value === 'string' ? (RESPONSE_LENGTH_LABELS[value] ?? PLACEHOLDER) : PLACEHOLDER;
}
export function knowledgeStrictnessLabel(value) {
    return typeof value === 'string' ? (KNOWLEDGE_STRICTNESS_LABELS[value] ?? PLACEHOLDER) : PLACEHOLDER;
}
export function conversationPaceLabel(value) {
    return typeof value === 'string' ? (CONVERSATION_PACE_LABELS[value] ?? PLACEHOLDER) : PLACEHOLDER;
}
export function closingTendencyLabel(value) {
    return typeof value === 'string' ? (CLOSING_TENDENCY_LABELS[value] ?? PLACEHOLDER) : PLACEHOLDER;
}

/** C 端覆盖策略模式 → 中文（spec §5.4）。 */
const OVERRIDE_MODE_LABELS = {
    locked: '锁定',
    allow_list: '白名单',
    all: '全部开放',
};
export function overrideModeLabel(value) {
    return typeof value === 'string' ? (OVERRIDE_MODE_LABELS[value] ?? PLACEHOLDER) : PLACEHOLDER;
}
