import api from '../../../new-serve/api/training';
import { requireLogin } from '../../../utils/training-auth';

const DIFFICULTY_TEXT = { 1: '友好型', 2: '普通型', 3: '刁钻型', 4: '难缠型' }

Page({
  data: {
    items: [],
    loading: true,
    hasMore: true,
    page: 0,
    pageSize: 20,
    errored: false,
  },

  onLoad() {
    if (!requireLogin()) return;
    this.loadHistory()
  },

  onPullDownRefresh() {
    this.setData({ page: 0, hasMore: true, items: [] })
    this.loadHistory().then(() => wx.stopPullDownRefresh())
  },

  async loadHistory() {
    this.setData({ loading: true, errored: false })
    try {
      const res = await api.getHistory(this.data.page, this.data.pageSize)
      const items = (res.items || []).map((item) => ({
        id: item.conversationId,
        status: item.status,
        evaluationStatus: item.evaluationStatus || null,
        title: [item.personaName, item.productScenario].filter(Boolean).join(' · ') || '自由陪练',
        difficultyText: DIFFICULTY_TEXT[item.difficulty] || '',
        finished: item.status === 'ended' || item.status === 'scored',
        statusText: item.status === 'scored' || item.score !== null ? '已评分' : item.status === 'ended' ? '已结束' : '进行中',
        score: item.score === null || item.score === undefined ? null : Math.round(Number(item.score)),
        actionText: item.status === 'ended' || item.status === 'scored'
          ? (item.score === null || item.score === undefined ? '查看报告进度 ›' : '查看完整报告 ›')
          : '继续练习 ›',
        timeText: this.formatTime(item.createdAt),
      }))
      this.setData({
        items: this.data.page === 0 ? items : this.data.items.concat(items),
        loading: false,
        hasMore: items.length >= this.data.pageSize,
      })
    } catch (e) {
      this.setData({ loading: false, errored: true })
      wx.showToast({ title: e.message || '加载失败', icon: 'none' })
    }
  },

  onLoadMore() {
    if (!this.data.hasMore || this.data.loading) return
    this.setData({ page: this.data.page + 1 })
    this.loadHistory()
  },

  onItemTap(e) {
    const id = e.currentTarget.dataset.id
    const item = this.data.items.find((candidate) => candidate.id === id)
    const finished = item && (item.status === 'ended' || item.status === 'scored')
    wx.navigateTo({
      url: finished
        ? `/pages/training/result/result?conversationId=${id}`
        : `/pages/training/conversation/conversation?conversationId=${id}`,
    })
  },

  onGoPractice() {
    wx.reLaunch({ url: '/pages/training/index/index' })
  },

  formatTime(dateStr) {
    if (!dateStr) return ''
    const date = new Date(dateStr)
    const now = new Date()
    const diff = now.getTime() - date.getTime()
    if (diff < 60 * 1000) return '刚刚'
    if (diff < 3600 * 1000) return `${Math.floor(diff / 60000)}分钟前`
    if (diff < 24 * 3600 * 1000) return `${Math.floor(diff / 3600000)}小时前`
    if (diff < 7 * 24 * 3600 * 1000) return `${Math.floor(diff / 86400000)}天前`
    return `${date.getMonth() + 1}月${date.getDate()}日`
  },
})
