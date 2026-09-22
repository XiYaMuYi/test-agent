/**
 * 中英文映射工具
 */

// 基础属性映射
const basicMappings = {
  occupation: {
    student: '学生',
    white_collar: '白领',
    full_time_mom: '全职妈妈',
    executive: '企业高管',
    business_owner: '个体老板',
    retired: '退休人员',
    teacher: '教师',
    doctor: '医生',
    freelancer: '自由职业',
  },
  marital_status: {
    unmarried: '未婚',
    married: '已婚',
    divorced: '离异',
    // T25：新契约枚举
    single: '未婚',
    unknown: '默认',
  },
  income_level: {
    low: '较低',
    low_medium: '中低',
    medium: '中等',
    medium_high: '中高',
    high: '较高',
  },
  gender: {
    male: '男',
    female: '女',
    unknown: '默认',
  },
}

// 消费行为映射
const consumptionMappings = {
  brand_loyalty: {
    low: '低',
    medium: '中等',
    high: '高',
  },
  competitor_comparison: {
    none: '不会',
    occasional: '偶尔',
    frequent: '经常',
    // T25：新契约枚举
    never: '从不',
    occasionally: '偶尔',
    frequently: '频繁',
  },
  decision_cycle: {
    impulse: '冲动消费',
    same_day: '当天决定',
    few_days: '考虑几天',
    long_term: '长期考虑',
  },
  purchase_channel: {
    wechat: '微信私域',
    offline: '线下门店',
    ecommerce: '电商平台',
    // T25：新契约枚举
    wechat_private: '微信私域',
    live: '直播',
  },
  ingredient_focus: {
    low: '不太关注',
    moderate: '一般关注',
    high: '比较关注',
    very_high: '非常关注',
    // T25：新契约枚举
    none: '不关注',
    normal: '一般',
    focused: '非常关注',
  },
}

// 对话设置映射
const conversationMappings = {
  difficulty: {
    1: '友好',
    2: '普通',
    3: '刁钻',
    4: '难缠',
  },
  product_scenario: {
    'skincare consultation': '护肤品咨询',
    'anti-aging consultation': '抗衰咨询',
    'health supplements': '保健养生',
    'weight management': '减重塑形',
    'sensitive repair': '敏感修复',
  },
  opening_mode: {
    ai_first: 'AI先开口',
    user_first: '用户先开口',
    // T25：新契约枚举
    wait_learner: '等学员先开口',
  },
  dialect: {
    mandarin: '普通话',
    southwest: '西南',
    northeast: '东北',
    cantonese: '粤语',
    wu: '吴语',
  },
}

// 沟通方式映射
const communicationMappings = {
  style: {
    polite: '温和有礼貌',
    direct: '直接干脆',
    casual: '随意轻松',
    formal: '正式严谨',
  },
  verbosity: {
    short: '简短',
    moderate: '适中',
    verbose: '啰嗦',
  },
  emotion_level: {
    reserved: '含蓄',
    normal: '正常',
    expressive: '丰富',
  },
}

// 皮肤健康映射
const skinHealthMappings = {
  skin_type: {
    oily: '油性',
    dry: '干性',
    combination: '混合性',
    normal: '中性',
    sensitive: '敏感性',
  },
  skin_concerns: {
    acne: '痘痘',
    large_pores: '毛孔粗大',
    wrinkles: '皱纹',
    dullness: '暗沉',
    sensitive: '敏感',
    spots: '色斑',
  },
  health_focus: {
    anti_aging: '抗衰老',
    immunity: '免疫力',
    sleep: '睡眠',
    joints: '关节',
    bones: '骨骼',
    weight_loss: '减肥',
  },
}

// 情绪状态映射
const moodMappings = {
  neutral: '中性',
  positive: '积极',
  negative: '消极',
  happy: '开心',
  angry: '生气',
  anxious: '焦虑',
}

// T32.1：五维评分中文名称映射（产品定义的五项能力维度）。
const dimensionNameMappings = {
  needs_discovery: '需求挖掘',
  product_presentation: '产品介绍',
  objection_handling: '异议处理',
  emotion_management: '情绪管理',
  closing_ability: '成交推进',
}

// T28.3：客户情绪专用映射（对话页顶部状态栏），仅保留三档友好中文。
const customerMoodMappings = {
  positive: '积极',
  neutral: '中性',
  negative: '消极',
}

// 卡片ID映射（兼容新旧两套 id）
const cardIdMappings = {
  // 新后端英文枚举
  'young-lady': '小姐姐',
  'light-mature': '轻熟女',
  mom: '宝妈',
  'boss-lady': '御姐',
  'big-sister': '大姐',
  auntie: '阿姨',
  // 早期拼音 id
  xiaojiejie: '小姐姐',
  qingshounv: '轻熟女',
  baoma: '宝妈',
  yujie: '御姐',
  dajie: '大姐',
  ayi: '阿姨',
  custom: '自定义',
}

// 自定义备注翻译映射
const customNotesMappings = {
  'very concerned about ingredient safety, asks about each ingredient': '非常关心成分安全，会逐一询问每种成分',
  'frequently mentions competitor brands for comparison': '经常提到竞品品牌进行对比',
  'likes to chat about daily life, easily moved by stories': '喜欢聊日常生活，容易被故事打动',
  'has plenty of time, enjoys chatting, trusts recommendations from acquaintances': '时间充裕，喜欢聊天，信任熟人推荐',
}

/**
 * 通用翻译函数
 */
function translate(category, value, mappings) {
  if (!mappings[category] || !mappings[category][value]) {
    return value
  }
  return mappings[category][value]
}

/**
 * 翻译配置对象
 */
function translateConfig(config) {
  if (!config) return config

  const translated = JSON.parse(JSON.stringify(config))

  // 翻译基础属性
  if (translated.basic) {
    translated.basic.occupation = translate('occupation', translated.basic.occupation, basicMappings)
    translated.basic.marital_status = translate('marital_status', translated.basic.marital_status, basicMappings)
    translated.basic.income_level = translate('income_level', translated.basic.income_level, basicMappings)
    translated.basic.gender = translate('gender', translated.basic.gender, basicMappings)
    // T25：新契约 camelCase 字段
    translated.basic.maritalStatus = translate('marital_status', translated.basic.maritalStatus, basicMappings)
    translated.basic.incomeLevel = translate('income_level', translated.basic.incomeLevel, basicMappings)
  }
  // T25：顶层 gender
  if (translated.gender) {
    translated.gender = translate('gender', translated.gender, basicMappings)
  }

  // 翻译消费行为
  if (translated.consumption) {
    translated.consumption.brand_loyalty = translate('brand_loyalty', translated.consumption.brand_loyalty, consumptionMappings)
    translated.consumption.competitor_comparison = translate('competitor_comparison', translated.consumption.competitor_comparison, consumptionMappings)
    translated.consumption.decision_cycle = translate('decision_cycle', translated.consumption.decision_cycle, consumptionMappings)
    translated.consumption.purchase_channel = translate('purchase_channel', translated.consumption.purchase_channel, consumptionMappings)
    translated.consumption.ingredient_focus = translate('ingredient_focus', translated.consumption.ingredient_focus, consumptionMappings)
    // T25：新契约 camelCase 字段
    translated.consumption.purchaseChannel = translate('purchase_channel', translated.consumption.purchaseChannel, consumptionMappings)
    translated.consumption.ingredientFocus = translate('ingredient_focus', translated.consumption.ingredientFocus, consumptionMappings)
    translated.consumption.competitorComparison = translate('competitor_comparison', translated.consumption.competitorComparison, consumptionMappings)
  }

  // 翻译对话设置
  if (translated.conversation) {
    // difficulty 保持数字，在显示层翻译
    translated.conversation.product_scenario = translate('product_scenario', translated.conversation.product_scenario, conversationMappings)
    translated.conversation.opening_mode = translate('opening_mode', translated.conversation.opening_mode, conversationMappings)
    // T25：新契约 camelCase 字段
    translated.conversation.openingMode = translate('opening_mode', translated.conversation.openingMode, conversationMappings)

    // 翻译 custom_notes
    if (translated.conversation.custom_notes && customNotesMappings[translated.conversation.custom_notes]) {
      translated.conversation.custom_notes = customNotesMappings[translated.conversation.custom_notes]
    }
  }

  // 翻译沟通方式
  if (translated.communication) {
    translated.communication.style = translate('style', translated.communication.style, communicationMappings)
    translated.communication.verbosity = translate('verbosity', translated.communication.verbosity, communicationMappings)
    translated.communication.emotion_level = translate('emotion_level', translated.communication.emotion_level, communicationMappings)
    // T25：方言映射
    translated.communication.dialect = translate('dialect', translated.communication.dialect, conversationMappings)
  }

  // 翻译皮肤健康
  if (translated.skin_health) {
    translated.skin_health.skin_type = translate('skin_type', translated.skin_health.skin_type, skinHealthMappings)
    if (Array.isArray(translated.skin_health.skin_concerns)) {
      translated.skin_health.skin_concerns = translated.skin_health.skin_concerns.map(
        item => translate('skin_concerns', item, skinHealthMappings)
      )
    }
    if (Array.isArray(translated.skin_health.health_focus)) {
      translated.skin_health.health_focus = translated.skin_health.health_focus.map(
        item => translate('health_focus', item, skinHealthMappings)
      )
    }
  }

  return translated
}

/**
 * T32.1：翻译五维评分名称（英文 key -> 中文名称）
 */
function translateDimensionName(key) {
  return dimensionNameMappings[key] || key
}

/**
 * 翻译情绪状态
 */
function translateMood(mood) {
  return moodMappings[mood] || mood
}

/**
 * T28.3：翻译客户情绪（对话页顶部状态栏专用，三档：积极/中性/消极）
 */
function translateCustomerMood(mood) {
  return customerMoodMappings[mood] || customerMoodMappings.neutral
}

/**
 * 将客户情绪转换成可安全用于 WXSS 类名的 ASCII 标识。
 */
function customerMoodTone(mood) {
  return Object.prototype.hasOwnProperty.call(customerMoodMappings, mood) ? mood : 'neutral'
}

/**
 * 翻译卡片ID
 */
function translateCardId(cardId) {
  return cardIdMappings[cardId] || cardId
}

/**
 * 格式化时间
 */
function formatTime(timeStr) {
  if (!timeStr) return ''
  const date = new Date(timeStr)
  const now = new Date()
  const diff = now - date

  // 1分钟内
  if (diff < 60 * 1000) return '刚刚'
  // 1小时内
  if (diff < 60 * 60 * 1000) return Math.floor(diff / 60000) + '分钟前'
  // 24小时内
  if (diff < 24 * 60 * 60 * 1000) return Math.floor(diff / 3600000) + '小时前'
  // 7天内
  if (diff < 7 * 24 * 60 * 60 * 1000) return Math.floor(diff / 86400000) + '天前'

  // 超过7天显示日期
  const month = date.getMonth() + 1
  const day = date.getDate()
  return `${month}月${day}日`
}

module.exports = {
  translateConfig,
  translateMood,
  translateCustomerMood,
  customerMoodTone,
  translateCardId,
  translateDimensionName,
  formatTime,
  basicMappings,
  consumptionMappings,
  conversationMappings,
  communicationMappings,
  skinHealthMappings,
  moodMappings,
  customerMoodMappings,
  cardIdMappings,
  dimensionNameMappings,
}
