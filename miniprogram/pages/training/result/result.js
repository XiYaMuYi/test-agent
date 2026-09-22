import api from '../../../new-serve/api/training';
import { requireLogin } from '../../../utils/training-auth';
import { customerMoodTone, translateCustomerMood } from '../../../utils/training-i18n';

// T32.1：五维评分中文名称（严格对齐产品定义的五项能力维度）。
const DIMENSION_NAME = {
  needs_discovery: '需求挖掘',
  product_presentation: '产品介绍',
  objection_handling: '异议处理',
  emotion_management: '情绪管理',
  closing_ability: '成交推进',
  // 兼容旧后端可能输出的别名
  friendliness: '友好度',
  patience: '耐心度',
  decisiveness: '果断度',
}

// 五维固定展示顺序（确保页面展示顺序一致，不依赖后端字段顺序）。
const FIVE_DIMENSIONS = [
  'needs_discovery',
  'product_presentation',
  'objection_handling',
  'emotion_management',
  'closing_ability',
]
const CAPABILITY_NAME = {
  needDiscovery: '需求挖掘', listeningAndUnderstanding: '倾听理解', productKnowledge: '产品知识',
  answerAccuracy: '回答准确性', answerCompleteness: '回答完整性', knowledgeGrounding: '知识依据',
  personalizedRecommendation: '个性化建议', safetyAndCompliance: '安全合规', objectionHandling: '异议处理',
  emotionManagement: '情绪管理', communicationClarity: '表达清晰', trustBuilding: '建立信任', closingAbility: '成交推进',
  needs_discovery: '需求挖掘', product_knowledge: '产品知识', answer_accuracy: '回答准确性',
}
const STATE_NAME = { emotion: '情绪', trust: '信任度', patience: '耐心', consultationIntent: '咨询意向', purchaseIntent: '购买意向', decisionReadiness: '决策成熟度', priceAcceptance: '价格接受度', needClarity: '需求清晰度', productFitBelief: '产品适配信念', informationConfidence: '信息信心', riskConcern: '风险担忧', objectionLevel: '异议强度' }
const END_REASON_NAME = { purchase_confirmed: '确认购买', no_consultation_intent: '无咨询意向', customer_angry: '客户情绪恶化', safety_boundary: '触发安全边界', max_turns: '达到最大轮次', natural_end: '自然结束', manual_end: '手动结束' }

function gradeOf(score) {
  if (score >= 90) return { label: '优秀', tone: 'great' }
  if (score >= 75) return { label: '良好', tone: 'good' }
  if (score >= 60) return { label: '合格', tone: 'normal' }
  return { label: '继续加油', tone: 'weak' }
}

Page({
  data: {
    conversationId: null,
    selection: null,
    evaluation: null,
    dimensions: [],
    highlights: [],
    improvements: [],
    suggestions: [],
    gradeLabel: '',
    gradeTone: '',
    customerMoodText: '中性',
    customerMoodTone: 'neutral',
    capabilityDimensions: [], stateTrends: [], turnEvidence: [], endReasonText: '',
    // 私域能力模型（context-aware 引擎）：新 8 维富结构、客户阶段、产品/安全红线提醒。
    useCustomModel: false,
    customDimensions: [],
    customerStageText: '',
    knowledgeWarnings: [],
    loading: true,
    error: null,
  },

  onLoad(options) {
    if (!requireLogin()) return;
    const selection = options.selection ? JSON.parse(decodeURIComponent(options.selection)) : null
    this.setData({ conversationId: options.conversationId, selection })
    this.loadResult(options.conversationId, selection)
  },

  async loadResult(conversationId, selection) {
    this.setData({ loading: true, error: null })
    try {
      // LLM 评估通常需要十几秒；给 worker 足够的生成窗口，避免报告尚未完成就误报失败。
      const res = await api.getResult(conversationId, selection, { maxAttempts: 30, interval: 2000 })
      const scores = res.dimensionScores || res.dimensions || {}
      // T32.1：按固定五维顺序构建展示数据，缺失维度补 0 分。
      const dimensions = FIVE_DIMENSIONS.map((key) => ({
        key,
        name: DIMENSION_NAME[key] || key,
        score: Math.round(Number(scores[key]) || 0),
      }))
      // 新私域能力模型：后端返回 customDimensionScores 时优先展示（含不适用、等级、评分理由）。
      const customRaw = Array.isArray(res.customDimensionScores) ? res.customDimensionScores : []
      const useCustomModel = customRaw.length > 0
      const customDimensions = customRaw.map((d) => {
        const applicable = d.applicable !== false
        const score = Math.round(Number(d.score) || 0)
        const g = applicable ? gradeOf(score) : { label: '不适用', tone: 'na' }
        return {
          key: d.code || d.name,
          name: d.name || d.code,
          score,
          applicable,
          gradeLabel: g.label,
          gradeTone: g.tone,
          reason: typeof d.reason === 'string' ? d.reason : '',
        }
      })
      const stage = res.customerStage && typeof res.customerStage === 'object' ? res.customerStage : null
      const customerStageText = stage && typeof stage.label === 'string' ? stage.label : ''
      const knowledgeWarnings = Array.isArray(res.knowledgeWarnings)
        ? res.knowledgeWarnings.filter((s) => typeof s === 'string')
        : []
      const grade = gradeOf(Number(res.score) || 0)
      // T32.2：将客户情绪转换为中文展示文本。
      const moodValue = res.customerMood || res.customer_mood || 'neutral'
      const customerMoodText = translateCustomerMood(moodValue)
      const moodTone = customerMoodTone(moodValue)
      const capabilityScores = scores
      const capabilityDimensions = Object.keys(capabilityScores).filter((key) => CAPABILITY_NAME[key]).map((key) => ({ key, name: CAPABILITY_NAME[key], score: Math.round(Number(capabilityScores[key]) || 0) }))
      const initial = res.stateComparison && res.stateComparison.initial
      const final = res.stateComparison && res.stateComparison.final
      const stateTrends = initial && final ? Object.keys(initial).filter((key) => typeof initial[key] === 'number' && typeof final[key] === 'number' && STATE_NAME[key]).map((key) => ({ key, label: STATE_NAME[key], initial: initial[key], final: final[key], delta: final[key] - initial[key], trend: final[key] > initial[key] ? 'up' : final[key] < initial[key] ? 'down' : 'flat' })) : []
      const turnEvidence = []
      ;(Array.isArray(res.capabilityEvidence) ? res.capabilityEvidence : []).forEach((entry) => {
        if (!entry || typeof entry !== 'object') return
        const list = Array.isArray(entry.evidence) ? entry.evidence : [entry]
        const first = list.find((item) => item && typeof item === 'object' && (item.dimension || item.reason))
        if (!first) return
        turnEvidence.push({
          sequence: entry.sequence,
          dimensionLabel: CAPABILITY_NAME[first.dimension] || first.dimension || '',
          reason: typeof first.reason === 'string' ? first.reason : '',
        })
      })
      this.setData({
        evaluation: {
          score: Math.round(Number(res.score) || 0),
          messageCount: res.messageCount || 0,
        },
        dimensions,
        highlights: Array.isArray(res.highlights)
          ? res.highlights.filter((s) => typeof s === 'string')
          : [],
        improvements: Array.isArray(res.improvements)
          ? res.improvements.filter((s) => typeof s === 'string')
          : [],
        suggestions: Array.isArray(res.suggestions) ? res.suggestions.filter((s) => typeof s === 'string') : [],
        gradeLabel: grade.label,
        gradeTone: grade.tone,
        customerMoodText,
        customerMoodTone: moodTone,
        capabilityDimensions,
        stateTrends,
        turnEvidence,
        endReasonText: END_REASON_NAME[res.endReason] || '',
        useCustomModel,
        customDimensions,
        customerStageText,
        knowledgeWarnings,
        loading: false,
      })
    } catch (e) {
      this.setData({ loading: false, error: { message: e.message || '获取结果失败' } })
    }
  },

  onRetry() {
    if (this.data.selection) {
      const persona = encodeURIComponent(JSON.stringify(this.data.selection))
      wx.redirectTo({ url: `/pages/training/conversation/conversation?persona=${persona}` })
    } else {
      wx.reLaunch({ url: '/pages/training/index/index' })
    }
  },

  onBack() {
    wx.reLaunch({ url: '/pages/training/index/index' })
  },

  onViewConversation() {
      wx.navigateTo({ url: `/pages/training/history/detail?id=${this.data.conversationId}` })
  },

  onDismissError() {
    this.setData({ error: null })
  },
})
