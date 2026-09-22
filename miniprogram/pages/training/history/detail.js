import api from '../../../new-serve/api/training';
import { requireLogin } from '../../../utils/training-auth';

function gradeOf(score) {
  if (score >= 90) return '优秀'
  if (score >= 75) return '良好'
  if (score >= 60) return '合格'
  return '继续加油'
}

// T32.3：客户情绪 -> 中文展示文本
function moodText(mood) {
  if (mood === 'positive') return '积极'
  if (mood === 'negative') return '消极'
  return '中性'
}

// T32.3：客户情绪 -> 样式类名
function moodClass(mood) {
  if (mood === 'positive') return 'mood-positive'
  if (mood === 'negative') return 'mood-negative'
  return 'mood-neutral'
}

Page({
  data: {
    conversationId: null,
    messages: [],
    score: null,
    gradeText: '',
    loading: true,
    error: null,
    // T32.3：整体客户情绪（取最后一条学员消息的情绪作为回放摘要）
    overallMood: null,
    overallMoodText: '',
    overallMoodClass: '',
  },

  onLoad(options) {
    if (!requireLogin()) return;
    if (options.id) {
      this.setData({ conversationId: options.id })
      this.loadDetail(options.id)
    }
  },

  async loadDetail(id) {
    this.setData({ loading: true, error: null })
    try {
      const res = await api.getConversationDetail(id)
      const messages = (res.messages || []).map((m) => {
        const feedback = m.coachFeedback || null
        const mood = m.customerMood || null
        return {
          role: m.role,
          content: m.content,
          // T32.3：教练点评卡片字段（规范化，避免 WXML 中出现 undefined）
          hasCoachFeedback: !!(feedback && (feedback.feedback || feedback.rating !== undefined || (feedback.improvements && feedback.improvements.length > 0))),
          coachFeedback: feedback ? {
            rating: typeof feedback.rating === 'number' ? feedback.rating : null,
            feedback: feedback.feedback || '',
            improvements: Array.isArray(feedback.improvements) ? feedback.improvements : [],
          } : null,
          // T32.3：客户情绪标签
          hasCustomerMood: !!mood,
          customerMood: mood,
          customerMoodText: moodText(mood),
          customerMoodClass: moodClass(mood),
          // T32.3：默认折叠
          coachFeedbackExpanded: false,
        }
      })

      // T32.3：取最后一条学员消息的情绪作为整体情绪摘要
      let overallMood = null
      for (let i = messages.length - 1; i >= 0; i -= 1) {
        if (messages[i].role === 'user' && messages[i].customerMood) {
          overallMood = messages[i].customerMood
          break
        }
      }

      const score = res.evaluation && res.evaluation.score !== null && res.evaluation.score !== undefined
        ? Math.round(Number(res.evaluation.score))
        : null
      this.setData({
        messages,
        score,
        gradeText: score === null ? '评估生成中' : gradeOf(score),
        overallMood,
        overallMoodText: moodText(overallMood),
        overallMoodClass: moodClass(overallMood),
        loading: false,
      })
    } catch (e) {
      this.setData({ loading: false, error: { message: e.message || '加载失败' } })
    }
  },

  // T32.3：切换教练点评卡片展开/折叠
  onToggleCoachFeedback(e) {
    const index = e.currentTarget.dataset.index
    if (index === undefined || index === null) return
    const current = this.data.messages[index]
    if (!current) return
    const key = 'messages[' + index + '].coachFeedbackExpanded'
    this.setData({ [key]: !current.coachFeedbackExpanded })
  },

  onBack() {
    wx.navigateBack()
  },

  onRetry() {
    if (this.data.conversationId) this.loadDetail(this.data.conversationId)
  },
})
