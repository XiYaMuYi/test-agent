import api from '../../../new-serve/api/training';
import { requireLogin } from '../../../utils/training-auth';

// 七维性格滑杆定义（与后端契约 PersonalityConfig 对齐）。
const TRAIT_DEFS = [
  { key: 'friendliness', label: '友好度' },
  { key: 'patience', label: '耐心度' },
  { key: 'priceSensitivity', label: '价格敏感度' },
  { key: 'decisiveness', label: '决策果断度' },
  { key: 'skepticism', label: '怀疑程度' },
  { key: 'socialActivity', label: '社交活跃度' },
  { key: 'emotionalVolatility', label: '情绪波动度' },
]

const COMM_STYLE_OPTIONS = [
  { value: 'default', label: '默认' },
  { value: 'direct', label: '直接' },
  { value: 'gentle', label: '温和' },
  { value: 'strong', label: '强势' },
  { value: 'humorous', label: '幽默' },
  { value: 'serious', label: '严肃' },
]
const VERBOSITY_OPTIONS = [
  { value: 'default', label: '默认' },
  { value: 'brief', label: '简洁' },
  { value: 'normal', label: '适中' },
  { value: 'verbose', label: '详细' },
]
const EMOTION_OPTIONS = [
  { value: 'default', label: '默认' },
  { value: 'reserved', label: '内敛' },
  { value: 'normal', label: '正常' },
  { value: 'expressive', label: '外放' },
]
const SKIN_OPTIONS = [
  { value: 'default', label: '默认' },
  { value: 'dry', label: '干性' },
  { value: 'oily', label: '油性' },
  { value: 'combination', label: '混合' },
  { value: 'mixed_dry', label: '混干性' },
  { value: 'mixed_oily', label: '混油性' },
  { value: 'sensitive', label: '敏感' },
  { value: 'normal', label: '中性' },
]

// T25 新增字段选项（value 与后端 PersonaConfig 契约对齐，label 为中文展示）
const GENDER_OPTIONS = [
  { value: 'default', label: '默认' },
  { value: 'female', label: '女' },
  { value: 'male', label: '男' },
]
const MARITAL_STATUS_OPTIONS = [
  { value: 'default', label: '默认' },
  { value: 'single', label: '未婚' },
  { value: 'married', label: '已婚' },
]
const INCOME_LEVEL_OPTIONS = [
  { value: 'default', label: '默认' },
  { value: 'low', label: '低' },
  { value: 'medium', label: '中' },
  { value: 'high', label: '高' },
]
const DIALECT_OPTIONS = [
  { value: 'default', label: '默认' },
  { value: 'mandarin', label: '普通话' },
  { value: 'southwest', label: '西南' },
  { value: 'northeast', label: '东北' },
  { value: 'cantonese', label: '粤语' },
  { value: 'wu', label: '吴语' },
]
const PURCHASE_CHANNEL_OPTIONS = [
  { value: 'default', label: '默认' },
  { value: 'wechat_private', label: '微信私域' },
  { value: 'ecommerce', label: '电商' },
  { value: 'offline', label: '线下' },
  { value: 'live', label: '直播' },
]
const INGREDIENT_FOCUS_OPTIONS = [
  { value: 'default', label: '默认' },
  { value: 'none', label: '不关注' },
  { value: 'normal', label: '一般' },
  { value: 'focused', label: '非常关注' },
]
const COMPETITOR_COMPARISON_OPTIONS = [
  { value: 'default', label: '默认' },
  { value: 'never', label: '从不' },
  { value: 'occasionally', label: '偶尔' },
  { value: 'frequently', label: '频繁' },
]
const OPENING_MODE_OPTIONS = [
  { value: 'default', label: '默认' },
  { value: 'ai_first', label: 'AI先开口' },
  { value: 'wait_learner', label: '等学员先开口' },
]

// v2 客户画像体系（商学院反馈，阶段 C）：默认折叠于高级区，value 与后端契约对齐。
// 运行时优先使用 presets 下发字典（与 B 端同源），以下为接口异常时的兜底。
const CUSTOMER_RELATION_OPTIONS = [
  { value: 'default', label: '默认' },
  { value: 'prospect', label: '陌生潜客' },
  { value: 'new_follower', label: '新粉' },
  { value: 'gift_follower', label: '礼品粉' },
  { value: 'first_order', label: '首单客户' },
  { value: 'returning', label: '老客户' },
]
const TRUST_LEVEL_OPTIONS = [
  { value: 0, label: '默认' },
  { value: 1, label: '1·陌生戒备' },
  { value: 2, label: '2·认识认可' },
  { value: 3, label: '3·专业信任' },
  { value: 4, label: '4·个人信任' },
  { value: 5, label: '5·同盟转介' },
]
const CUSTOMER_COHORT_OPTIONS = [
  { value: 'default', label: '默认' },
  { value: 'gen_z', label: 'Z世代' },
  { value: 'precision_mom', label: '精致妈妈' },
  { value: 'new_white_collar', label: '新锐白领' },
  { value: 'urban_blue_collar', label: '都市蓝领' },
  { value: 'town_youth', label: '小镇青年' },
  { value: 'town_senior', label: '小镇中老年' },
  { value: 'established_middle_class', label: '资深中产' },
  { value: 'urban_silver', label: '都市银发' },
]

function buildTraits(personality, touched) {
  return TRAIT_DEFS.map((def) => ({
    key: def.key,
    label: def.label,
    value: Math.round(Number(personality[def.key]) || 50),
    touched: !!touched,
  }))
}

function objectList(value) {
  return Array.isArray(value) ? value.filter((item) => item && typeof item === 'object') : []
}

function namedOptions(value) {
  return objectList(value).map((item) => {
    const candidates = [item.name, item.displayName, item.id]
    const name = candidates.find((candidate) => typeof candidate === 'string' && candidate.trim()) || '未命名'
    return { ...item, name: name.trim() }
  })
}

// 8 大人群 emoji 映射（卡片主视觉）
const COHORT_EMOJI = {
  gen_z: '🎮',
  precision_mom: '👶',
  new_white_collar: '💼',
  urban_blue_collar: '🔧',
  town_youth: '🌾',
  town_senior: '🏠',
  established_middle_class: '💎',
  urban_silver: '🌿',
}

// 经典 6 年龄卡片 emoji（与 8 大人群不重复）
const CLASSIC_EMOJI = {
  'young-lady': '🌸',
  'light-mature': '💄',
  mom: '🍼',
  'boss-lady': '👑',
  'big-sister': '🌻',
  auntie: '☕',
}

function cardOptions(value) {
  return namedOptions(value).map((card) => {
    const emoji = COHORT_EMOJI[card.id] || CLASSIC_EMOJI[card.id]
    return {
      ...card,
      avatarText: emoji || card.name.charAt(0) || '客',
      isCohort: !!COHORT_EMOJI[card.id],
    }
  })
}

/**
 * 服务端字典（{value,label,...}）转选项列表；接口缺字段时回退本地常量兜底。
 * trustLevels 数字 value 保持数字，与后端契约一致。
 */
function optionList(serverItems, fallback, valueKey, labelKey) {
  const items = objectList(serverItems)
  if (items.length === 0) return fallback
  return [{ value: 'default', label: '默认' }].concat(
    items.map((item) => ({ value: item[valueKey], label: item[labelKey], ...item })),
  )
}

/** 皮肤问题 6 类词表转分组勾选模型：[{category, items:[{name, selected}]}]。 */
function concernGroups(dictionary) {
  return objectList(dictionary).map((group) => ({
    category: group.category || group.label || '其他',
    // items 是字符串数组（如 ['闭口粉刺','黑头']），不能用 objectList（会过滤字符串），直接判数组
    items: (Array.isArray(group.items) ? group.items : []).map((name) => ({ name: String(name), selected: false })),
  }))
}

/** 按选中皮肤问题名回填分组勾选态。 */
function markConcernGroups(groups, selected) {
  const set = new Set(Array.isArray(selected) ? selected : [])
  return groups.map((group) => ({
    ...group,
    items: group.items.map((item) => ({ ...item, selected: set.has(item.name) })),
  }))
}

Page({
  data: {
    cardId: null,
    templateId: null,
    // 方案 B：客户类型主入口为 8 大人群（cohort），经典年龄卡片（classic）作为切换
    cardMode: 'cohort',
    cohortCards: [],
    classicCards: [],
    cards: [],
    psychology: [],
    difficulty: [],
    scenarios: [],
    selectedCard: null,
    selectedScenario: null,
    selectedDifficulty: 2,
    selectedPsychology: [],
    templateName: '',
    loading: true,
    starting: false,
    saving: false,
    // 高级自定义（默认收起，主路径保持一键开始）
    showAdvanced: false,
    traits: buildTraits({}, false),
    ageText: '',
    occupationText: '',
    backgroundText: '',
    notesText: '',
    maxTurnsText: '',
    budgetMinText: '',
    budgetMaxText: '',
    commStyle: 'default',
    verbosity: 'default',
    emotionLevel: 'default',
    skinType: 'default',
    // T25 新增字段状态
    gender: 'default',
    maritalStatus: 'default',
    incomeLevel: 'default',
    dialect: 'default',
    purchaseChannel: 'default',
    ingredientFocus: 'default',
    competitorComparison: 'default',
    openingMode: 'default',
    catchphraseText: '',
    allergiesText: '',
    currentProductsText: '',
    commStyleOptions: COMM_STYLE_OPTIONS,
    verbosityOptions: VERBOSITY_OPTIONS,
    emotionOptions: EMOTION_OPTIONS,
    skinOptions: SKIN_OPTIONS,
    genderOptions: GENDER_OPTIONS,
    maritalStatusOptions: MARITAL_STATUS_OPTIONS,
    incomeLevelOptions: INCOME_LEVEL_OPTIONS,
    dialectOptions: DIALECT_OPTIONS,
    purchaseChannelOptions: PURCHASE_CHANNEL_OPTIONS,
    ingredientFocusOptions: INGREDIENT_FOCUS_OPTIONS,
    competitorComparisonOptions: COMPETITOR_COMPARISON_OPTIONS,
    openingModeOptions: OPENING_MODE_OPTIONS,
    // v2 客户画像体系（阶段 C）
    customerRelation: 'default',
    trustLevel: 0,
    customerCohort: 'default',
    cityText: '',
    purchaseCategoryText: '',
    skinConcernGroups: [],
    customerRelationOptions: CUSTOMER_RELATION_OPTIONS,
    trustLevelOptions: TRUST_LEVEL_OPTIONS,
    customerCohortOptions: CUSTOMER_COHORT_OPTIONS,
    cityMaxLength: 30,
    purchaseCategoryMaxLength: 50,
  },

  onLoad(options) {
    if (!requireLogin()) return;
    this.bootstrap(options || {})
  },

  async bootstrap(options) {
    this.setData({ loading: true })
    try {
      const rawPresets = await api.getPersonaPresets()
      const presets = rawPresets && typeof rawPresets === 'object' ? rawPresets : {}
      // 方案 B：8 大人群卡片为主入口，经典年龄卡片作为切换
      const cohortCards = cardOptions(presets.cohortCards)
      const classicCards = cardOptions(presets.cards)
      const cards = cohortCards.length > 0 ? cohortCards : classicCards
      const psychologyOptions = namedOptions(presets.psychology)
      const difficultyOptions = objectList(presets.difficulty)
      const scenarioOptions = namedOptions(presets.scenarios)
      const patch = {
        cohortCards,
        classicCards,
        cards,
        psychology: psychologyOptions,
        difficulty: difficultyOptions,
        scenarios: scenarioOptions,
        loading: false,
      }
      // v2 字典优先取服务端下发（与 B 端同源），接口缺字段时回退本地常量兜底。
      patch.customerRelationOptions = optionList(presets.customerRelations, CUSTOMER_RELATION_OPTIONS, 'value', 'label')
      patch.customerCohortOptions = optionList(presets.customerCohorts, CUSTOMER_COHORT_OPTIONS, 'value', 'label')
      patch.trustLevelOptions = optionList(presets.trustLevels, TRUST_LEVEL_OPTIONS, 'value', 'label')
      const serverSkin = objectList(presets.skinTypes).map((s) => ({ value: s.value, label: s.label }))
      patch.skinOptions = [{ value: 'default', label: '默认' }].concat(serverSkin.length > 0 ? serverSkin : SKIN_OPTIONS.slice(1))
      patch.skinConcernGroups = concernGroups(presets.skinConcernsDictionary)
      if (typeof presets.cityMaxLength === 'number') patch.cityMaxLength = presets.cityMaxLength
      if (typeof presets.purchaseCategoryMaxLength === 'number') patch.purchaseCategoryMaxLength = presets.purchaseCategoryMaxLength
      if (options.cardId) {
        patch.selectedCard = options.cardId
        patch.cardId = options.cardId
      } else if (cards.length > 0) {
        patch.selectedCard = cards[0].id
      }
      if (difficultyOptions.length >= 2) patch.selectedDifficulty = difficultyOptions[1].level
      if (scenarioOptions.length > 0) patch.selectedScenario = scenarioOptions[0].id

      // 滑杆默认跟随当前客户卡片。
      const firstCard = cards.find((c) => c.id === patch.selectedCard) || cards[0]
      patch.traits = buildTraits((firstCard && firstCard.personality) || {}, false)

      if (options.templateId) {
        patch.templateId = options.templateId
        const tplRes = await api.getTemplates()
        const tpl = (tplRes.items || []).find((t) => t.id === options.templateId)
        if (tpl && tpl.personaConfig) {
          this.applyTemplateToPatch(patch, tpl, presets)
        }
      }
      const selectedPsych = patch.selectedPsychology || []
      patch.psychology = psychologyOptions.map((p) => ({ ...p, selected: selectedPsych.includes(p.id) }))
      this.setData(patch)
    } catch (e) {
      this.setData({ loading: false })
      wx.showToast({ title: e.message || '加载失败', icon: 'none' })
    }
  },

  // 从完整 PersonaConfig 快照回填选择项与高级自定义。
  applyTemplateToPatch(patch, tpl, presets) {
    const cfg = tpl.personaConfig
    patch.selectedCard = cfg.basedOnCard || patch.selectedCard
    patch.selectedDifficulty = (cfg.conversation && cfg.conversation.difficulty) || patch.selectedDifficulty
    // 完整快照里场景是中文名，按名称反查选项 id。
    // 旧场景选项 name 即 displayName；新场景选项 name 带"类目·"前缀，按 id 后缀匹配。
    const scenarioName = cfg.conversation && cfg.conversation.productScenario
    if (scenarioName) {
      const matched = (presets.scenarios || []).find((s) => s.name === scenarioName || s.id === scenarioName ||
        (typeof s.id === 'string' && s.id.endsWith(`::${scenarioName}`)))
      if (matched) patch.selectedScenario = matched.id
    }
    patch.templateName = tpl.name || ''
    if (typeof cfg.age === 'number') patch.ageText = String(cfg.age)
    if (cfg.occupation) patch.occupationText = cfg.occupation
    if (cfg.personality) patch.traits = buildTraits(cfg.personality, true)
    if (cfg.communication) {
      patch.commStyle = cfg.communication.style || 'default'
      patch.verbosity = cfg.communication.verbosity || 'default'
      patch.emotionLevel = cfg.communication.emotionLevel || 'default'
      // T25 新增：方言 / 口头禅回填
      if (cfg.communication.dialect && cfg.communication.dialect !== 'mandarin') patch.dialect = cfg.communication.dialect
      if (cfg.communication.catchphrase) patch.catchphraseText = cfg.communication.catchphrase
    }
    if (cfg.consumption) {
      if (typeof cfg.consumption.budgetMin === 'number') patch.budgetMinText = String(cfg.consumption.budgetMin)
      if (typeof cfg.consumption.budgetMax === 'number') patch.budgetMaxText = String(cfg.consumption.budgetMax)
      if (cfg.consumption.skinType) patch.skinType = cfg.consumption.skinType
      // T25 新增：购买渠道 / 成分关注 / 竞品比较 / 过敏史 / 在用产品
      if (cfg.consumption.purchaseChannel && cfg.consumption.purchaseChannel !== 'wechat_private') patch.purchaseChannel = cfg.consumption.purchaseChannel
      if (cfg.consumption.ingredientFocus && cfg.consumption.ingredientFocus !== 'none') patch.ingredientFocus = cfg.consumption.ingredientFocus
      if (cfg.consumption.competitorComparison && cfg.consumption.competitorComparison !== 'never') patch.competitorComparison = cfg.consumption.competitorComparison
      if (Array.isArray(cfg.consumption.allergies) && cfg.consumption.allergies.length > 0) patch.allergiesText = cfg.consumption.allergies.join(', ')
      if (cfg.consumption.currentProducts) patch.currentProductsText = cfg.consumption.currentProducts
    }
    if (cfg.conversation) {
      patch.backgroundText = cfg.conversation.background || ''
      patch.notesText = cfg.conversation.customNotes || ''
      if (typeof cfg.conversation.maxTurns === 'number') patch.maxTurnsText = String(cfg.conversation.maxTurns)
      // T25 新增：开场方式
      if (cfg.conversation.openingMode && cfg.conversation.openingMode !== 'ai_first') patch.openingMode = cfg.conversation.openingMode
    }
    // T25 新增：顶层 gender / basic 回填
    if (cfg.gender && cfg.gender !== 'female') patch.gender = cfg.gender
    if (cfg.basic) {
      if (cfg.basic.maritalStatus && cfg.basic.maritalStatus !== 'unknown') patch.maritalStatus = cfg.basic.maritalStatus
      if (cfg.basic.incomeLevel && cfg.basic.incomeLevel !== 'medium') patch.incomeLevel = cfg.basic.incomeLevel
      // v2 客户画像体系（阶段 C）回填
      if (cfg.basic.customerRelation) patch.customerRelation = cfg.basic.customerRelation
      if (typeof cfg.basic.trustLevel === 'number' && cfg.basic.trustLevel >= 1 && cfg.basic.trustLevel <= 5) patch.trustLevel = cfg.basic.trustLevel
      if (cfg.basic.customerCohort) patch.customerCohort = cfg.basic.customerCohort
      if (cfg.basic.city) patch.cityText = cfg.basic.city
      if (cfg.basic.purchaseCategory) patch.purchaseCategoryText = cfg.basic.purchaseCategory
    }
    if (cfg.consumption && Array.isArray(cfg.consumption.skinConcerns) && cfg.consumption.skinConcerns.length > 0) {
      patch.skinConcernGroups = markConcernGroups(patch.skinConcernGroups || [], cfg.consumption.skinConcerns)
    }
    // 已填自定义内容时自动展开高级区，让用户看得到模板的完整设置。
    // T25 更新：新增字段也纳入判断（仅非默认值才触发，避免后端默认填充误展开）
    if (
      patch.ageText || patch.occupationText || patch.backgroundText || patch.notesText ||
      (patch.gender && patch.gender !== 'default') ||
      (patch.maritalStatus && patch.maritalStatus !== 'default') ||
      (patch.incomeLevel && patch.incomeLevel !== 'default') ||
      (patch.dialect && patch.dialect !== 'default') ||
      (patch.purchaseChannel && patch.purchaseChannel !== 'default') ||
      (patch.ingredientFocus && patch.ingredientFocus !== 'default') ||
      (patch.competitorComparison && patch.competitorComparison !== 'default') ||
      (patch.openingMode && patch.openingMode !== 'default') ||
      (patch.customerRelation && patch.customerRelation !== 'default') ||
      (patch.customerCohort && patch.customerCohort !== 'default') ||
      (patch.trustLevel && patch.trustLevel !== 0) ||
      patch.cityText || patch.purchaseCategoryText ||
      (patch.skinConcernGroups || []).some((group) => group.items.some((item) => item.selected)) ||
      patch.catchphraseText || patch.allergiesText || patch.currentProductsText
    ) {
      patch.showAdvanced = true
    }
  },

  onSelectCard(e) {
    const selectedCard = e.currentTarget.dataset.id
    // 切换客户类型时，未手动调整过的滑杆跟随新卡片；已手动调过的保留用户选择。
    const card = this.data.cards.find((c) => c.id === selectedCard)
    const base = (card && card.personality) || {}
    const traits = this.data.traits.map((t) => (t.touched ? t : { ...t, value: Math.round(Number(base[t.key]) || t.value) }))
    this.setData({ selectedCard, traits })
  },

  // 方案 B：切换 8 大人群 / 经典年龄预设
  onToggleCardMode() {
    const nextMode = this.data.cardMode === 'cohort' ? 'classic' : 'cohort'
    const nextCards = nextMode === 'cohort' ? this.data.cohortCards : this.data.classicCards
    if (nextCards.length === 0) {
      wx.showToast({ title: '该类型暂无选项', icon: 'none' })
      return
    }
    const selectedCard = nextCards[0].id
    const base = (nextCards[0] && nextCards[0].personality) || {}
    const traits = this.data.traits.map((t) => (t.touched ? t : { ...t, value: Math.round(Number(base[t.key]) || t.value) }))
    this.setData({ cardMode: nextMode, cards: nextCards, selectedCard, traits })
  },

  onSelectScenario(e) {
    this.setData({ selectedScenario: e.currentTarget.dataset.id })
  },

  onSelectDifficulty(e) {
    this.setData({ selectedDifficulty: Number(e.currentTarget.dataset.level) })
  },

  onTogglePsychology(e) {
    const id = e.currentTarget.dataset.id
    const current = this.data.selectedPsychology
    const next = current.includes(id) ? current.filter((x) => x !== id) : current.concat(id)
    const psychology = this.data.psychology.map((p) => ({ ...p, selected: next.includes(p.id) }))
    this.setData({ selectedPsychology: next, psychology })
  },

  onToggleAdvanced() {
    this.setData({ showAdvanced: !this.data.showAdvanced })
  },

  onNameInput(e) {
    this.setData({ templateName: e.detail.value })
  },
  onAgeInput(e) { this.setData({ ageText: e.detail.value }) },
  onOccupationInput(e) { this.setData({ occupationText: e.detail.value }) },
  onBackgroundInput(e) { this.setData({ backgroundText: e.detail.value }) },
  onNotesInput(e) { this.setData({ notesText: e.detail.value }) },
  onMaxTurnsInput(e) { this.setData({ maxTurnsText: e.detail.value }) },
  onBudgetMinInput(e) { this.setData({ budgetMinText: e.detail.value }) },
  onBudgetMaxInput(e) { this.setData({ budgetMaxText: e.detail.value }) },

  onTraitChange(e) {
    const key = e.currentTarget.dataset.key
    const value = e.detail.value
    const traits = this.data.traits.map((t) => (t.key === key ? { ...t, value, touched: true } : t))
    this.setData({ traits })
  },

  onResetTraits() {
    const card = this.data.cards.find((c) => c.id === this.data.selectedCard)
    this.setData({ traits: buildTraits((card && card.personality) || {}, false) })
    wx.showToast({ title: '已恢复为该客户类型默认', icon: 'none' })
  },

  onPickComm(e) { this.setData({ commStyle: e.currentTarget.dataset.value }) },
  onPickVerbosity(e) { this.setData({ verbosity: e.currentTarget.dataset.value }) },
  onPickEmotion(e) { this.setData({ emotionLevel: e.currentTarget.dataset.value }) },
  onPickSkin(e) { this.setData({ skinType: e.currentTarget.dataset.value }) },
  // T25 新增 pick / input 事件
  onPickGender(e) { this.setData({ gender: e.currentTarget.dataset.value }) },
  onPickMaritalStatus(e) { this.setData({ maritalStatus: e.currentTarget.dataset.value }) },
  onPickIncomeLevel(e) { this.setData({ incomeLevel: e.currentTarget.dataset.value }) },
  onPickDialect(e) { this.setData({ dialect: e.currentTarget.dataset.value }) },
  onPickPurchaseChannel(e) { this.setData({ purchaseChannel: e.currentTarget.dataset.value }) },
  onPickIngredientFocus(e) { this.setData({ ingredientFocus: e.currentTarget.dataset.value }) },
  onPickCompetitorComparison(e) { this.setData({ competitorComparison: e.currentTarget.dataset.value }) },
  onPickOpeningMode(e) { this.setData({ openingMode: e.currentTarget.dataset.value }) },
  onCatchphraseInput(e) { this.setData({ catchphraseText: e.detail.value }) },
  onAllergiesInput(e) { this.setData({ allergiesText: e.detail.value }) },
  onCurrentProductsInput(e) { this.setData({ currentProductsText: e.detail.value }) },
  // v2 客户画像体系（阶段 C）事件
  onPickCustomerRelation(e) { this.setData({ customerRelation: e.currentTarget.dataset.value }) },
  onPickTrustLevel(e) { this.setData({ trustLevel: Number(e.currentTarget.dataset.value) }) },
  onPickCustomerCohort(e) { this.setData({ customerCohort: e.currentTarget.dataset.value }) },
  onCityInput(e) { this.setData({ cityText: e.detail.value }) },
  onPurchaseCategoryInput(e) { this.setData({ purchaseCategoryText: e.detail.value }) },
  onToggleSkinConcern(e) {
    const { group, name } = e.currentTarget.dataset
    const groups = this.data.skinConcernGroups.map((g) => {
      if (g.category !== group) return g
      return {
        ...g,
        items: g.items.map((item) => (item.name === name ? { ...item, selected: !item.selected } : item)),
      }
    })
    this.setData({ skinConcernGroups: groups })
  },

  // 仅收集用户实际填写/调整过的内容，未动的维度交由卡片默认值决定。
  collectOverrides() {
    const d = this.data
    const overrides = {}

    const age = parseInt(d.ageText, 10)
    if (Number.isInteger(age) && age >= 0 && age <= 120) overrides.age = age
    const occupation = d.occupationText.trim()
    if (occupation) overrides.occupation = occupation

    // T25 新增：顶层枚举字段
    if (d.gender && d.gender !== 'default') overrides.gender = d.gender

    // T25 新增：basic 子对象（婚姻、收入）
    const basic = {}
    if (d.maritalStatus && d.maritalStatus !== 'default') basic.maritalStatus = d.maritalStatus
    if (d.incomeLevel && d.incomeLevel !== 'default') basic.incomeLevel = d.incomeLevel
    // v2 客户画像体系（阶段 C）：仅收集用户实际选择的维度，未动的不落覆盖
    if (d.customerRelation && d.customerRelation !== 'default') basic.customerRelation = d.customerRelation
    if (typeof d.trustLevel === 'number' && d.trustLevel >= 1 && d.trustLevel <= 5) basic.trustLevel = d.trustLevel
    if (d.customerCohort && d.customerCohort !== 'default') basic.customerCohort = d.customerCohort
    const city = (d.cityText || '').trim()
    if (city) basic.city = city
    const purchaseCategory = (d.purchaseCategoryText || '').trim()
    if (purchaseCategory) basic.purchaseCategory = purchaseCategory
    if (Object.keys(basic).length > 0) overrides.basic = basic

    const personality = {}
    d.traits.forEach((t) => { if (t.touched) personality[t.key] = t.value })
    if (Object.keys(personality).length > 0) overrides.personality = personality

    const consumption = {}
    const bMin = parseInt(d.budgetMinText, 10)
    const bMax = parseInt(d.budgetMaxText, 10)
    if (Number.isInteger(bMin) && bMin >= 0) consumption.budgetMin = bMin
    if (Number.isInteger(bMax) && bMax >= 0) consumption.budgetMax = bMax
    if (d.skinType && d.skinType !== 'default') consumption.skinType = d.skinType
    // v2 客户画像体系（阶段 C）：皮肤问题词表多选
    const skinConcerns = []
    d.skinConcernGroups.forEach((group) => {
      group.items.forEach((item) => { if (item.selected) skinConcerns.push(item.name) })
    })
    if (skinConcerns.length > 0) consumption.skinConcerns = skinConcerns
    // T25 新增：购买渠道 / 成分关注 / 竞品比较 / 过敏史 / 在用产品
    if (d.purchaseChannel && d.purchaseChannel !== 'default') consumption.purchaseChannel = d.purchaseChannel
    if (d.ingredientFocus && d.ingredientFocus !== 'default') consumption.ingredientFocus = d.ingredientFocus
    if (d.competitorComparison && d.competitorComparison !== 'default') consumption.competitorComparison = d.competitorComparison
    const allergies = (d.allergiesText || '').split(/[,，]/).map((s) => s.trim()).filter(Boolean)
    if (allergies.length > 0) consumption.allergies = allergies
    const currentProducts = (d.currentProductsText || '').trim()
    if (currentProducts) consumption.currentProducts = currentProducts
    if (Object.keys(consumption).length > 0) overrides.consumption = consumption

    const communication = {}
    if (d.commStyle && d.commStyle !== 'default') communication.style = d.commStyle
    if (d.verbosity && d.verbosity !== 'default') communication.verbosity = d.verbosity
    if (d.emotionLevel && d.emotionLevel !== 'default') communication.emotionLevel = d.emotionLevel
    // T25 新增：方言 / 口头禅
    if (d.dialect && d.dialect !== 'default') communication.dialect = d.dialect
    const catchphrase = (d.catchphraseText || '').trim()
    if (catchphrase) communication.catchphrase = catchphrase
    if (Object.keys(communication).length > 0) overrides.communication = communication

    const conversation = {}
    const background = d.backgroundText.trim()
    if (background) conversation.background = background
    const notes = d.notesText.trim()
    if (notes) conversation.customNotes = notes
    const maxTurns = parseInt(d.maxTurnsText, 10)
    if (Number.isInteger(maxTurns) && maxTurns >= 1 && maxTurns <= 100) conversation.maxTurns = maxTurns
    // T25 新增：开场方式
    if (d.openingMode && d.openingMode !== 'default') conversation.openingMode = d.openingMode
    if (Object.keys(conversation).length > 0) overrides.conversation = conversation

    return overrides
  },

  // 组装后端 BuildPersonaInput（四步选择 + overrides）。
  // 方案 B：cohort 模式传 customerCohort（不传 ageCardId），classic 模式传 ageCardId。
  buildInput() {
    const input = {
      psychologyCardIds: this.data.selectedPsychology,
      difficulty: this.data.selectedDifficulty,
      productScenarioId: this.data.selectedScenario,
      overrides: this.collectOverrides(),
    }
    if (this.data.cardMode === 'cohort') {
      input.customerCohort = this.data.selectedCard
    } else {
      input.ageCardId = this.data.selectedCard
    }
    return input
  },

  validate() {
    if (!this.data.selectedCard) {
      wx.showToast({ title: '请选择客户类型', icon: 'none' })
      return false
    }
    if (!this.data.selectedScenario) {
      wx.showToast({ title: '请选择产品场景', icon: 'none' })
      return false
    }
    const bMin = parseInt(this.data.budgetMinText, 10)
    const bMax = parseInt(this.data.budgetMaxText, 10)
    if (this.data.budgetMinText && !Number.isInteger(bMin)) {
      wx.showToast({ title: '最低预算请填整数', icon: 'none' }); return false
    }
    if (this.data.budgetMaxText && !Number.isInteger(bMax)) {
      wx.showToast({ title: '最高预算请填整数', icon: 'none' }); return false
    }
    if (Number.isInteger(bMin) && Number.isInteger(bMax) && bMax < bMin) {
      wx.showToast({ title: '最高预算不能低于最低预算', icon: 'none' }); return false
    }
    return true
  },

  async onStartPractice() {
    if (!this.validate() || this.data.starting) return
    this.setData({ starting: true })
    try {
      const input = this.buildInput()
      // 预生成画像，取客户背景作为开场白（用户手填背景时优先用手填）。
      let background = this.data.backgroundText.trim()
      try {
        const preview = await api.previewPersona(input)
        background = background || (preview.conversation && preview.conversation.background) || ''
      } catch (e) {
        /* 背景非必需，失败则使用默认开场白 */
      }
      const params = [`persona=${encodeURIComponent(JSON.stringify(input))}`]
      if (background) params.push(`background=${encodeURIComponent(background)}`)
      wx.navigateTo({ url: `/pages/training/conversation/conversation?${params.join('&')}` })
    } finally {
      this.setData({ starting: false })
    }
  },

  async onSaveTemplate() {
    if (!this.validate() || this.data.saving) return
    const name = this.data.templateName.trim() || this.autoName()
    this.setData({ saving: true })
    try {
      // 后端模板要求存「完整画像快照」，先用选择项 + 自定义预览出完整 config 再保存。
      const fullConfig = await api.previewPersona(this.buildInput())
      await api.saveTemplate({ name, personaConfig: fullConfig })
      wx.showToast({ title: '已保存到我的模板', icon: 'success' })
      this.setData({ templateName: name })
    } catch (e) {
      wx.showToast({ title: e.message || '保存失败', icon: 'none' })
    } finally {
      this.setData({ saving: false })
    }
  },

  autoName() {
    const card = this.data.cards.find((c) => c.id === this.data.selectedCard)
    const scenario = this.data.scenarios.find((s) => s.id === this.data.selectedScenario)
    const cardName = card ? card.name : '客户'
    const scenarioName = scenario ? scenario.name : ''
    return `${cardName}·${scenarioName}`.replace(/·$/, '')
  },

  onRetry() {
    this.bootstrap({ cardId: this.data.cardId, templateId: this.data.templateId || undefined })
  },
})
