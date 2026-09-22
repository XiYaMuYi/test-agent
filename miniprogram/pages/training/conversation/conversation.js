import api from '../../../new-serve/api/training';
import { requireLogin } from '../../../utils/training-auth';
import { translateCustomerMood } from '../../../utils/training-i18n';

const CUSTOMER_STATE_LABELS = {
  emotion: '情绪', trust: '信任度', patience: '耐心', consultationIntent: '咨询意愿',
  purchaseIntent: '购买倾向', decisionReadiness: '决策成熟度', priceAcceptance: '价格接受度',
  needClarity: '需求清晰度', productFitBelief: '产品适配信念', informationConfidence: '信息确信度',
  riskConcern: '风险担忧', objectionLevel: '异议强度',
}

function moodFromState(state, fallback = 'neutral') {
  if (!state || typeof state.emotion !== 'number') return fallback
  // 阈值与后端 contracts customerMoodFromState 保持一致（>=65 积极、<=35 消极），
  // 避免前端(60/40)与后端(65/35)在同一 emotion 下判出不同情绪。
  if (state.emotion >= 65) return 'positive'
  if (state.emotion <= 35) return 'negative'
  return 'neutral'
}

function stateView(state) {
  if (!state) return { customerStateItems: [], unresolvedQuestions: [] }
  return {
    customerStateItems: Object.keys(CUSTOMER_STATE_LABELS)
      .filter((key) => typeof state[key] === 'number')
      .map((key) => ({ key, label: CUSTOMER_STATE_LABELS[key], value: Math.round(state[key]) })),
    unresolvedQuestions: Array.isArray(state.unresolvedQuestions) ? state.unresolvedQuestions : [],
  }
}

function moodView(state, fallback) {
  const mood = moodFromState(state, fallback)
  const moodClassMap = { positive: 'mood-positive', neutral: 'mood-neutral', negative: 'mood-negative' }
  return { customerMood: mood, customerMoodText: translateCustomerMood(mood), customerMoodClass: moodClassMap[mood] }
}

Page({
  data: {
    conversationId: null,
    selection: null,
    background: '',
    messages: [],
    // 等学员先开口（openingMode=wait_learner）：无 AI 开场白，空对话 + 引导学员先发言。
    learnerFirst: false,
    inputText: '',
    isTyping: false,
    active: false,
    currentTurn: 0,
    loading: true,
    error: null,
    ending: false,
    pendingTurn: null,
    // T28.3：客户情绪（原始值 + 中文文本 + 样式类名），顶部状态栏使用。
    customerMood: 'neutral',
    customerMoodText: '中性',
    customerMoodClass: 'mood-neutral',
    customerStateItems: [],
    unresolvedQuestions: [],
    // 客户 12 维状态是否正在后台异步研判（控制“评估中”轻提示）。
    customerStatePending: false,
    scrollTarget: 'bottom',
  },

  async onLoad(options) {
    if (!requireLogin()) return;
    const config = wx.getStorageSync('gzg_config') || {}
    if (config.training_enabled === false || config.training_enabled === 'false') {
      this.setData({ loading: false, error: { message: '训练功能暂未开放' } })
      return
    }
    if (options.conversationId) {
      await this.resumeExistingConversation(options.conversationId)
    } else if (options.templateId) {
      this.startWithTemplate(options.templateId)
    } else if (options.persona) {
      const selection = JSON.parse(decodeURIComponent(options.persona))
      const background = options.background ? decodeURIComponent(options.background) : ''
      this.setData({ selection, background })
      this.startWithSelection(selection, background)
    } else {
      try {
        const presets = await api.getPersonaPresets()
        if (!presets.enabled) throw new Error('训练功能暂未开放')
        const card = presets.cards[0]
        const scenario = presets.scenarios[0]
        const difficulty = presets.difficulty[0]
        if (!card || !scenario) throw new Error('训练预设暂不可用，请稍后重试')
        await this.startWithSelection({
          ageCardId: card.id,
          psychologyCardIds: [],
          difficulty: difficulty ? difficulty.level : 2,
          productScenarioId: scenario.id,
        }, '')
      } catch (error) {
        this.setData({ loading: false, error: { message: error.message || '训练预设加载失败' } })
      }
    }
  },

  async resumeExistingConversation(conversationId) {
    try {
      const restored = await api.resumeConversation(conversationId)
      if (!restored.active) {
        wx.redirectTo({ url: `/pages/training/result/result?conversationId=${conversationId}` })
        return
      }
      const moodMessage = [...restored.messages].reverse().find((message) => message.customerMood)
      const fallbackMood = moodMessage ? moodMessage.customerMood : 'neutral'
      this.setData({
        conversationId,
        selection: restored.personaSnapshot || this.data.selection,
        messages: restored.messages,
        learnerFirst: restored.learnerFirst === true && restored.messages.length === 0,
        currentTurn: Number(restored.lastSequence) || 0,
        ...moodView(restored.currentCustomerState, fallbackMood),
        ...stateView(restored.currentCustomerState),
        customerStatePending: false,
        active: true,
        loading: false,
        pendingTurn: restored.pendingTurn || null,
        error: restored.pendingTurn
          ? { message: '上一轮回复中断，可点击重试继续本轮，或直接结束练习' }
          : null,
      })
      this.enableBackWarning()
      this.scrollToBottom()
    } catch (error) {
      this.setData({ loading: false, error: { message: error.message || '恢复练习失败，请重试' } })
    }
  },

  async startWithSelection(selection, background, skipActiveCheck = false) {
    try {
      if (!skipActiveCheck) {
        const active = await api.getActiveConversation()
        if (active) {
          await this.resolveActiveSession(() => this.startWithSelection(selection, background, true), active)
          return
        }
      }
      const conv = await api.createConversation({ persona: selection })
      await this.afterCreated(conv, background)
    } catch (e) {
      if (e.code === 'SESSION_ALREADY_ACTIVE') {
        await this.resolveActiveSession(() => this.startWithSelection(selection, background))
        return
      }
      this.setData({ loading: false, error: { message: e.message || '创建练习失败' } })
    }
  },

  async startWithTemplate(templateId, skipActiveCheck = false) {
    try {
      if (!skipActiveCheck) {
        const active = await api.getActiveConversation()
        if (active) {
          await this.resolveActiveSession(() => this.startWithTemplate(templateId, true), active)
          return
        }
      }
      const conv = await api.createConversation({ templateId })
      await this.afterCreated(conv, '')
    } catch (e) {
      if (e.code === 'SESSION_ALREADY_ACTIVE') {
        await this.resolveActiveSession(() => this.startWithTemplate(templateId))
        return
      }
      this.setData({ loading: false, error: { message: e.message || '创建练习失败' } })
    }
  },

  async afterCreated(conv, background) {
    this.setData({ conversationId: conv.conversationId })
    const opening = await api.startConversation(conv.conversationId, { conversation: { background } })
    // 等学员先开口：后端不生成 AI 开场白，保持空对话并给出"由你先开口"引导，等学员发第一句。
    if (opening && opening.learnerFirst) {
      this.setData({ messages: [], learnerFirst: true, active: true, loading: false, isTyping: false })
      this.enableBackWarning()
      return
    }
    this.setData({
      learnerFirst: false,
      messages: [{ role: 'assistant', content: opening.opening }],
      ...moodView(opening.customerState, opening.customerMood),
      ...stateView(opening.customerState),
      customerStatePending: false,
      active: true,
      loading: false,
    })
    this.enableBackWarning()
    this.scrollToBottom()
  },

  // 启用系统返回键警告（Android硬件返回 / iOS左滑返回）
  enableBackWarning() {
    if (this._alertBeforeUnloadEnabled) return
    try {
      wx.enableAlertBeforeUnload({ message: '练习尚未结束，确定要离开吗？' })
      this._alertBeforeUnloadEnabled = true
    } catch (e) {
      // 低版本不支持时静默降级，自定义返回按钮仍有确认
    }
  },

  async resolveActiveSession(retryCreate, discoveredActive = null) {
    try {
      const active = discoveredActive || await api.getActiveConversation()
      if (!active) {
        // 没有活跃会话时（如旧会话已异常结束），直接创建新会话，避免死胡同
        this.setData({ loading: true, error: null, conversationId: null })
        await retryCreate()
        return
      }
      const continuePrevious = await new Promise((resolve) => {
        const interrupted = active.status === 'awaiting_model'
        wx.showModal({
          title: interrupted ? '上次练习回复中断' : '已有进行中的练习',
          content: interrupted
            ? '继续上次练习可重试中断的回复；也可以结束后创建当前客户。'
            : '继续上次练习可以保留对话记录；也可以结束上次练习并创建当前客户。',
          confirmText: interrupted ? '继续并重试' : '继续上次',
          cancelText: '结束并新建',
          success: (result) => resolve(result.confirm),
          fail: () => resolve(true),
        })
      })
      if (continuePrevious) {
        const restored = await api.resumeConversation(active.conversationId)
        const moodMessage = [...restored.messages].reverse().find((message) => message.customerMood)
        const fallbackMood = moodMessage ? moodMessage.customerMood : 'neutral'
        this.setData({
          conversationId: active.conversationId,
          selection: restored.personaSnapshot || this.data.selection,
          messages: restored.messages,
          currentTurn: Number(restored.lastSequence) || 0,
          ...moodView(restored.currentCustomerState, fallbackMood),
          ...stateView(restored.currentCustomerState),
          customerStatePending: false,
          active: restored.active,
          loading: false,
          pendingTurn: restored.pendingTurn || null,
          error: restored.pendingTurn
            ? { message: '上一轮回复中断，可点击重试继续本轮，或直接结束练习' }
            : null,
        })
        return
      }
      await api.endConversation(active.conversationId)
      this.setData({ loading: true, error: null })
      await retryCreate()
    } catch (error) {
      this.setData({ loading: false, error: { message: error.message || '恢复练习失败，请重试' } })
    }
  },

  onInputChange(e) {
    this.setData({ inputText: e.detail.value })
  },

  onKeyboardHeightChange() {
    this.scrollToBottom()
  },

  scrollToBottom() {
    // Resetting first retriggers scroll-into-view after the DOM has appended a message.
    this.setData({ scrollTarget: '' }, () => {
      this.setData({ scrollTarget: 'bottom' })
    })
  },

  async onSend() {
    const pendingTurn = this.data.pendingTurn
    const text = (pendingTurn ? pendingTurn.content : this.data.inputText).trim()
    if (!text || this.data.isTyping || !this.data.active) return
    const optimistic = pendingTurn
      ? [...this.data.messages]
      : [...this.data.messages, { role: 'user', content: text }]
    this.setData({ messages: optimistic, inputText: '', isTyping: true, error: null })
    this.scrollToBottom()
    try {
      // 若本轮来自“中断未完成轮”（恢复会话或上次发送失败），带上原 clientMessageId/sequence 幂等重放，
      // 后端会续跑 awaiting_model 的轮次，而不是判 MESSAGE_SEQUENCE_CONFLICT 导致整局卡死。
      const replayRef = pendingTurn && pendingTurn.clientMessageId ? pendingTurn : null
      const res = await api.sendMessage(this.data.conversationId, text, replayRef)
      let current = [...this.data.messages]

      let learnerIndex = -1
      for (let i = current.length - 1; i >= 0; i -= 1) {
        if (current[i].role === 'user') {
          learnerIndex = i
          // 同步规则兜底点评先上屏（仍标记“复盘中”），随后由 pollCoachFeedback 替换为大模型版。
          current[i] = {
            ...current[i],
            messageId: res.messageId,
            coachFeedbackPending: true,
            ...(res.coachFeedback ? { coachFeedback: res.coachFeedback, coachFeedbackExpanded: false } : {}),
          }
          break
        }
      }

      const parts = res.reply_parts || [res.reply]
      for (let i = 0; i < parts.length; i += 1) {
        current = [...current, { role: 'assistant', content: parts[i] }]
        this.setData({ messages: current })
        this.scrollToBottom()
        if (i < parts.length - 1) await new Promise((r) => setTimeout(r, 400))
      }

      // T28.3：更新顶部客户情绪状态。同步先沿用上一轮状态（占位、不跳变），
      // 异步大模型研判写回后由 pollCustomerState 延迟刷新为最新状态/情绪。
      this.setData({
        isTyping: false,
        pendingTurn: null,
        currentTurn: res.current_turn || this.data.currentTurn + 1,
        customerStatePending: true,
        ...moodView(res.customerState, res.customerMood || 'neutral'),
        ...stateView(res.customerState),
      })
      this.scrollToBottom()
      if (learnerIndex >= 0 && res.messageId) {
        this.pollCoachFeedback(learnerIndex, res.messageId)
        this._latestStateMessageId = res.messageId
        this.pollCustomerState(res.messageId)
      }

      // 模型主动判断成交/结束：自动收尾并进入结果页。
      if (res.status === 'ended' || res.status === 'completed') {
        this.data.active = false
        this.gotoResult()
      }
    } catch (e) {
      // 序号冲突意味着后端还停在上一轮 awaiting_model（上次请求在客户回复落库前中断）。
      // 主动拉回服务端记录的未完成轮，下一次点“重试”即用同一凭据幂等续跑，而不是反复冲突卡死。
      if (e.code === 'MESSAGE_SEQUENCE_CONFLICT' && this.data.conversationId) {
        try {
          const restored = await api.resumeConversation(this.data.conversationId)
          const serverPending = restored.pendingTurn || null
          this.setData({
            isTyping: false,
            pendingTurn: serverPending || { content: text },
            error: { message: serverPending ? '上一轮被中断，点“重试”继续本轮，或结束练习后重开' : (e.message || '发送失败') },
          })
          return
        } catch (_) {
          // 拉取失败则落到下面的通用提示，仍保留内容可再次重试。
        }
      }
      this.setData({
        isTyping: false,
        pendingTurn: pendingTurn || { content: text },
        error: { message: e.message || '发送失败' },
      })
    }
  },

  async pollCoachFeedback(messageIndex, messageId) {
    const apply = (cf, pending) => {
      const key = `messages[${messageIndex}]`
      const message = this.data.messages[messageIndex]
      if (message && message.messageId === messageId) {
        this.setData({
          [key]: { ...message, coachFeedback: cf, coachFeedbackPending: pending, coachFeedbackExpanded: false },
        })
      }
    }
    // 同步规则兜底版已由 onSend 先上屏（显示“教练正在复盘…”）。后端在大模型最终点评写回前
    // 一直返回 pending；一旦返回 ready 即为结合本轮语义的最终点评，直接替换并停止。
    // 客户回复与教练点评是两次串行大模型调用，慢时需十余秒，这里最多等待约 60s。
    for (let attempt = 0; attempt < 40; attempt += 1) {
      try {
        const result = await api.getCoachFeedback(this.data.conversationId, messageId)
        if (result.status === 'ready' && result.coachFeedback) {
          apply(result.coachFeedback, false)
          return
        }
      } catch (e) {
        // A later poll can recover from a transient request failure.
      }
      await new Promise((resolve) => setTimeout(resolve, 1500))
    }
    // 超时仍未拿到最终版：保留同步规则兜底，仅结束“教练正在复盘…”状态。
    const message = this.data.messages[messageIndex]
    if (message && message.messageId === messageId) {
      this.setData({ [`messages[${messageIndex}].coachFeedbackPending`]: false })
    }
  },

  // 客户 12 维状态由后端“异步大模型研判”：客户回复先上屏、状态条先沿用上一轮值，
  // 这里轮询直到 ready 再延迟刷新顶部状态条与情绪标签，全程不阻塞对话主链路。
  async pollCustomerState(messageId) {
    for (let attempt = 0; attempt < 40; attempt += 1) {
      try {
        const result = await api.getCustomerState(this.data.conversationId, messageId)
        if (result.status === 'ready' && result.customerState) {
          // 防乱序：只有当前最新一轮的研判结果才上屏，慢返回的旧轮不覆盖新轮。
          if (this._latestStateMessageId === messageId) {
            this.setData({
              customerStatePending: false,
              ...moodView(result.customerState, result.customerMood || 'neutral'),
              ...stateView(result.customerState),
            })
          }
          return
        }
      } catch (e) {
        // 瞬时请求失败可由下一次轮询恢复。
      }
      await new Promise((resolve) => setTimeout(resolve, 1500))
    }
    // 超时（模型不可用等）：维持上一轮状态，仅关闭“评估中”提示，不报错打断。
    if (this._latestStateMessageId === messageId) {
      this.setData({ customerStatePending: false })
    }
  },

  async onEndPractice() {
    if (this.data.ending || !this.data.conversationId) return
    this.setData({ ending: true })
    this.finishAndGotoResult()
  },

  async finishAndGotoResult() {
    try {
      await api.endConversation(this.data.conversationId)
    } catch (e) {
      // 只有服务端明确表示已结束时才能继续；其他失败不能伪装成已结束，
      // 否则会跳到没有评估任务的结果页并反复请求 404。
      if (e.code !== 'CONVERSATION_CLOSED') {
        this.setData({ ending: false, error: { message: e.message || '结束陪练失败，请重试' } })
        return
      }
    }
    this.setData({ ending: false })
    if (this._alertBeforeUnloadEnabled) {
      wx.disableAlertBeforeUnload()
      this._alertBeforeUnloadEnabled = false
    }
    this.gotoResult()
  },

  gotoResult() {
    const id = this.data.conversationId
    const selection = this.data.selection ? encodeURIComponent(JSON.stringify(this.data.selection)) : ''
    wx.redirectTo({ url: `/pages/training/result/result?conversationId=${id}&selection=${selection}` })
  },

  onRetry() {
    this.setData({ error: null })
    if (!this.data.conversationId) {
      // 没有有效会话时，用已有参数创建新会话；没有参数则返回选择页
      if (this.data.selection) {
        this.startWithSelection(this.data.selection, this.data.background)
      } else {
        wx.navigateBack()
      }
    } else {
      this.onSend()
    }
  },

  onDismissError() {
    this.setData({ error: null })
  },

  onBack() {
    // 如果会话仍在进行中，弹出确认，避免用户误操作丢失进度
    if (this.data.active && this.data.conversationId && !this.data.ending) {
      wx.showModal({
        title: '练习尚未结束',
        content: '离开后练习进度会保留，下次可继续。确定要离开吗？',
        confirmText: '结束并离开',
        cancelText: '继续练习',
        success: (res) => {
          if (res.confirm) {
            this.finishAndGotoResult()
          }
        },
      })
      return
    }
    wx.navigateBack({ delta: 1 })
  },

  onUnload() {
    if (this._alertBeforeUnloadEnabled) {
      wx.disableAlertBeforeUnload()
      this._alertBeforeUnloadEnabled = false
    }
  },

  // T28.3：切换某轮学员消息的教练点评展开/折叠。
  onToggleCoachFeedback(e) {
    const idx = e.currentTarget.dataset.index
    if (idx === undefined || idx === null || !this.data.messages[idx].coachFeedback) return
    const key = `messages[${idx}].coachFeedbackExpanded`
    this.setData({ [key]: !this.data.messages[idx].coachFeedbackExpanded })
  },
})
