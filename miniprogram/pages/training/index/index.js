import api from '../../../new-serve/api/training';
import { requireLogin, isLoggedIn } from '../../../utils/training-auth';
import { formatTime, translateCardId } from '../../../utils/training-i18n';

// 方案 B：默认客户为 Z世代（8 大人群主入口）
const DEFAULT_TEST_CARD = {
  id: 'gen_z',
  name: 'Z世代',
  age: 21,
  occupation: '学生/职场新人',
  emoji: '🎮',
};

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
};

Page({
  data: {
    error: null,
    loading: true,
    cards: [DEFAULT_TEST_CARD],
    templates: [],
    assignments: [],
    hasAssignments: false,
    selectedCardId: DEFAULT_TEST_CARD.id,
    selectedCard: DEFAULT_TEST_CARD,
    selectedCardName: DEFAULT_TEST_CARD.name,
    selectedCardAge: `${DEFAULT_TEST_CARD.age}岁`,
    starting: false,
    startingAssignmentId: '',
    // 会话恢复模态框（用户中途退出后再次进入任务时）
    recoveryModalVisible: false,
    recoveryAssignmentId: '',
    recoveryConversationId: '',
    recoveryLoading: false,
  },

  onLoad() {
    if (!requireLogin()) {
      this.setData({ loginRedirected: true });
      return;
    }
    this.loadData();
  },

  onShow() {
    if (this.data.loginRedirected && isLoggedIn()) {
      this.setData({ loginRedirected: false });
      this.loadData();
    }
  },

  async loadData() {
    this.setData({ loading: true, error: null });

    try {
      // 方案 B：从 presets 获取 8 大人群卡片（cohortCards），替代原 6 年龄卡片
      const presetsRes = await api.getPersonaPresets();
      const rawCards = presetsRes.cohortCards && presetsRes.cohortCards.length > 0
        ? presetsRes.cohortCards
        : (presetsRes.cards || []);
      // 为每个人群注入 emoji 主视觉
      const cards = rawCards.map((card) => ({
        ...card,
        emoji: COHORT_EMOJI[card.id] || '👤',
      }));
      const selectedCard = cards[0] || DEFAULT_TEST_CARD;
      this.setData({
        cards: cards.length ? cards : [DEFAULT_TEST_CARD],
        selectedCardId: selectedCard.id,
        selectedCard,
        selectedCardName: selectedCard.name,
        selectedCardAge: `${selectedCard.age}岁`,
      });
    } catch (error) {
      console.error('[TrainingIndex] Load cards failed:', error);
      this.setData({
        cards: [DEFAULT_TEST_CARD],
        selectedCardId: DEFAULT_TEST_CARD.id,
        selectedCard: DEFAULT_TEST_CARD,
        selectedCardName: DEFAULT_TEST_CARD.name,
        selectedCardAge: `${DEFAULT_TEST_CARD.age}岁`,
      });
    }

    try {
      const templatesRes = await api.getTemplates();
      const templates = (templatesRes.items || []).map((template) => ({
        ...template,
        based_on_card_display: translateCardId(template.based_on_card),
        updated_at_display: formatTime(template.updated_at),
      }));
      this.setData({ templates });
    } catch (error) {
      console.error('[TrainingIndex] Load templates failed:', error);
    }

    // 加载团队任务（B端投放的任务）
    try {
      const assignmentsRes = await api.getMyAssignments();
      const now = Date.now();
      const assignments = (assignmentsRes.items || [])
        .filter((item) => item.status === 'active')
        .filter((item) => {
          const starts = new Date(item.startsAt).getTime();
          const ends = new Date(item.endsAt).getTime();
          return now >= starts && now <= ends;
        })
        .map((item) => ({
          ...item,
          remainingAttempts: Math.max(0, item.maxAttempts - item.completedAttempts),
          isCompleted: item.completedAttempts >= item.maxAttempts,
          deadlineDisplay: formatTime(item.endsAt),
        }));
      this.setData({ assignments, hasAssignments: assignments.length > 0 });
    } catch (error) {
      console.error('[TrainingIndex] Load assignments failed:', error);
    }

    this.setData({ loading: false });
  },

  onRetry() {
    this.loadData();
  },

  onCardTap(event) {
    const cardId = event.currentTarget.dataset.id;
    const selectedCard = this.data.cards.find((card) => card.id === cardId) || DEFAULT_TEST_CARD;
    this.setData({
      selectedCardId: cardId,
      selectedCard,
      selectedCardName: selectedCard.name,
      selectedCardAge: `${selectedCard.age}岁`,
    });
  },

  onStartPractice() {
    if (this.data.starting) return;
    const cardId = this.data.selectedCardId || DEFAULT_TEST_CARD.id;
    this.setData({ starting: true });
    wx.navigateTo({
      url: `/pages/training/persona-edit/persona-edit?cardId=${encodeURIComponent(cardId)}`,
      fail: (error) => {
        console.error('[TrainingIndex] Navigate to persona editor failed:', error);
        wx.showToast({ title: '页面打开失败，请重新编译', icon: 'none' });
      },
      complete: () => this.setData({ starting: false }),
    });
  },

  onCustomTap() {
    wx.navigateTo({ url: '/pages/training/persona-edit/persona-edit' });
  },

  onHistoryTap() {
    wx.navigateTo({ url: '/pages/training/history/history' });
  },

  onTemplateTap(event) {
    const templateId = event.currentTarget.dataset.id;
    if (!templateId) return;
    wx.navigateTo({
      url: `/pages/training/conversation/conversation?templateId=${encodeURIComponent(templateId)}`,
    });
  },

  async onAssignmentTap(event) {
    const assignmentId = event.currentTarget.dataset.id;
    if (!assignmentId || this.data.starting || this.data.recoveryModalVisible) return;
    const assignment = this.data.assignments.find((a) => a.assignmentId === assignmentId);
    if (!assignment) return;
    if (assignment.isCompleted) {
      wx.showToast({ title: '该任务已完成全部练习次数', icon: 'none' });
      return;
    }
    // 先检查是否有未完成的活跃会话（用户可能上次中途退出了）
    try {
      const active = await api.getActiveAssignmentConversation(assignmentId);
      if (active && active.conversationId) {
        this.setData({
          recoveryModalVisible: true,
          recoveryAssignmentId: assignmentId,
          recoveryConversationId: active.conversationId,
        });
        return;
      }
    } catch (e) {
      console.warn('[TrainingIndex] Check active conversation failed, proceed to start:', e);
    }
    this.startAssignment(assignmentId, assignment);
  },

  async startAssignment(assignmentId, assignment) {
    this.setData({ starting: true, startingAssignmentId: assignmentId });
    wx.showLoading({ title: '正在进入任务...', mask: true });
    try {
      const result = await api.startAssignmentAttempt(assignmentId);
      wx.hideLoading();
      wx.navigateTo({
        url: `/pages/training/conversation/conversation?conversationId=${encodeURIComponent(result.conversationId)}&assignmentName=${encodeURIComponent(assignment.name)}`,
      });
    } catch (error) {
      wx.hideLoading();
      console.error('[TrainingIndex] Start assignment failed:', error);
      // 如果是 already active 错误，自动弹出恢复模态框，让用户选择继续或重新开始
      const errCode = error && error.code;
      const errMsg = error && error.message ? error.message : '';
      if (errCode === 'ATTEMPT_ALREADY_ACTIVE' || errMsg.includes('already active')) {
        try {
          const active = await api.getActiveAssignmentConversation(assignmentId);
          if (active && active.conversationId) {
            this.setData({
              recoveryModalVisible: true,
              recoveryAssignmentId: assignmentId,
              recoveryConversationId: active.conversationId,
            });
            return;
          }
        } catch (e2) {
          console.warn('[TrainingIndex] Failed to get active conversation for recovery:', e2);
        }
      }
      const msg = error && error.message ? error.message : '进入任务失败，请重试';
      wx.showToast({ title: msg, icon: 'none' });
    } finally {
      this.setData({ starting: false, startingAssignmentId: '' });
    }
  },

  // 恢复模态框：继续上次练习
  onRecoveryResume() {
    const { recoveryConversationId, recoveryAssignmentId } = this.data;
    const assignment = this.data.assignments.find((a) => a.assignmentId === recoveryAssignmentId);
    this.setData({ recoveryModalVisible: false });
    wx.navigateTo({
      url: `/pages/training/conversation/conversation?conversationId=${encodeURIComponent(recoveryConversationId)}&assignmentName=${encodeURIComponent(assignment ? assignment.name : '团队任务')}`,
    });
  },

  // 恢复模态框：结束上次会话并重新开始
  async onRecoveryEndAndRestart() {
    const { recoveryConversationId, recoveryAssignmentId } = this.data;
    const assignment = this.data.assignments.find((a) => a.assignmentId === recoveryAssignmentId);
    this.setData({ recoveryLoading: true });
    try {
      await api.endConversation(recoveryConversationId);
    } catch (e) {
      // CONVERSATION_CLOSED 表示已经结束了，其他错误记录但继续
      if (e.code !== 'CONVERSATION_CLOSED') {
        console.warn('[TrainingIndex] End old conversation failed:', e);
      }
    }
    this.setData({ recoveryModalVisible: false, recoveryLoading: false });
    if (assignment) {
      this.startAssignment(recoveryAssignmentId, assignment);
    }
  },

  // 恢复模态框：取消
  onRecoveryCancel() {
    this.setData({ recoveryModalVisible: false, recoveryConversationId: '' });
  },
});
