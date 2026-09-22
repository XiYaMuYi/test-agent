import { AdminApiClient, AdminApiProblem, escapeHtml, } from '../api/client.js';
import { dimensionLabel, formatDateTime, modeLabel, scoreBand, sourceLabel } from '../labels.js';
const PAGE_SIZE = 20;
/** 现算当前评估集合的已评分数、平均分、达标率（≥60），忽略尚未评分场次。 */
export function summarizeReview(items) {
    const scores = items.map((item) => item.score).filter((score) => score !== null);
    if (scores.length === 0)
        return { scoredCount: 0, avgScore: null, passRate: null };
    const avg = Math.round((scores.reduce((sum, score) => sum + score, 0) / scores.length) * 10) / 10;
    const passRate = Math.round((scores.filter((score) => score >= 60).length / scores.length) * 100);
    return { scoredCount: scores.length, avgScore: avg, passRate };
}
const FRIENDLY_ERRORS = {
    CONVERSATION_NOT_FOUND: '这场训练记录不存在或已被调整，请返回列表刷新。',
};
function friendlyProblem(problem) {
    return FRIENDLY_ERRORS[problem.code] ?? '操作未成功，请稍后重试。';
}
function contentText(item) {
    const parts = [item.assignmentName, item.scenarioTitle]
        .filter((value) => typeof value === 'string' && value.length > 0);
    const deduped = [...new Set(parts)];
    return deduped.length === 0 ? '—' : deduped.join(' · ');
}
export class AnalyticsPage {
    api;
    problem;
    items = [];
    total = 0;
    limit = PAGE_SIZE;
    offset = 0;
    source = 'all';
    selected;
    constructor(api) {
        this.api = api;
    }
    /** 拉取当前来源筛选与分页下的评估结果。 */
    async load() {
        this.problem = undefined;
        try {
            const result = await this.api.listEvaluations({
                ...(this.source === 'all' ? {} : { source: this.source }),
                limit: this.limit,
                offset: this.offset,
            });
            this.items = result.items;
            this.total = result.total;
            this.limit = result.limit;
            this.offset = result.offset;
        }
        catch (error) {
            if (error instanceof AdminApiProblem)
                this.problem = error;
            else
                throw error;
        }
    }
    /** 切换来源筛选并回到第一页。 */
    async setSource(source) {
        this.source = source;
        this.offset = 0;
        await this.load();
    }
    async openReplay(conversationId) {
        this.problem = undefined;
        try {
            this.selected = await this.api.getConversationReplay(conversationId);
        }
        catch (error) {
            if (error instanceof AdminApiProblem)
                this.problem = error;
            else
                throw error;
        }
    }
    closeReplay() {
        this.selected = undefined;
    }
    async nextPage() {
        this.offset += this.limit;
        await this.load();
    }
    async prevPage() {
        this.offset = Math.max(0, this.offset - this.limit);
        await this.load();
    }
    goPage(direction) {
        return direction === 'next' ? this.nextPage() : this.prevPage();
    }
    render() {
        if (this.selected !== undefined)
            return this.renderReplay(this.selected);
        return `${this.header()}${this.errorBlock()}${this.renderFilters()}${this.renderStats()}${this.renderTable()}${this.renderPager()}`;
    }
    header() {
        return '<div class="page-header"><div class="page-title">结果复盘</div><div class="page-sub">汇总自由练习与团队任务的陪练评估，按来源筛选、逐场回放对话，定位主播的成长与短板。</div></div>';
    }
    errorBlock() {
        if (this.problem === undefined)
            return '';
        return `<div class="alert alert-error" role="alert">${escapeHtml(friendlyProblem(this.problem))}<span class="error-code">错误编号：${escapeHtml(this.problem.code)}</span></div>`;
    }
    renderFilters() {
        const tab = (value, label) => {
            const active = this.source === value ? ' is-active' : '';
            return `<form data-action="evaluation-filter" class="filter-tab-form"><input name="source" type="hidden" value="${value}" /><button type="submit" class="filter-tab${active}">${label}</button></form>`;
        };
        return `<div class="filter-tabs">${tab('all', '全部')}${tab('free', '自由练习')}${tab('assigned', '团队任务')}</div>`;
    }
    renderStats() {
        if (this.items.length === 0)
            return '';
        const summary = summarizeReview(this.items);
        const stat = (label, value) => `<div class="stat"><div class="stat-value">${escapeHtml(value)}</div><div class="stat-label">${label}</div></div>`;
        return `<section class="stat-grid">
      ${stat('评估总场次', String(this.total))}
      ${stat('已评分场次', String(summary.scoredCount))}
      ${stat('平均分', summary.avgScore === null ? '—' : String(summary.avgScore))}
      ${stat('达标率', summary.passRate === null ? '—' : `${summary.passRate}%`)}
    </section>`;
    }
    renderTable() {
        if (this.items.length === 0) {
            return '<section class="card"><div class="empty"><div class="empty-title">暂无评估结果</div><div class="empty-desc">主播完成一次陪练并评分后，结果会自动汇总到这里。</div></div></section>';
        }
        return `<section class="card">
      <div class="table-wrap"><table class="table">
        <thead><tr><th>评估时间</th><th>主播</th><th>来源</th><th>形式</th><th>使用内容</th><th>得分</th><th>操作</th></tr></thead>
        <tbody>${this.items.map((item) => this.renderRow(item)).join('')}</tbody>
      </table></div>
    </section>`;
    }
    renderRow(item) {
        const band = scoreBand(item.score);
        const scoreCell = item.score === null || band === null
            ? '<span class="text-muted">暂无评分</span>'
            : `<span class="badge badge-${band.tone === 'good' ? 'active' : band.tone === 'warn' ? 'draft' : 'neutral'}">${band.label} ${Math.round(item.score)}</span>`;
        const anchor = item.displayName === null
            ? `${escapeHtml(item.principalId ?? '—')} <span class="text-muted">（未设置）</span>`
            : `${escapeHtml(item.principalId ?? '—')}（${escapeHtml(item.displayName)}）`;
        const content = contentText(item);
        return `<tr>
      <td class="text-muted">${escapeHtml(formatDateTime(item.evaluatedAt))}</td>
      <td class="cell-strong">${anchor}</td>
      <td>${escapeHtml(sourceLabel(item.sourceType))}</td>
      <td>${escapeHtml(modeLabel(item.mode))}</td>
      <td>${content === '—' ? '<span class="text-muted">—</span>' : escapeHtml(content)}</td>
      <td>${scoreCell}</td>
      <td>
        <form data-action="evaluation-replay" class="row-actions">
          <input name="conversationId" type="hidden" value="${escapeHtml(item.conversationId)}" />
          <button type="submit" class="btn btn-ghost btn-sm">查看回放</button>
        </form>
      </td>
    </tr>`;
    }
    renderPager() {
        if (this.total <= this.limit)
            return '';
        const from = this.offset + 1;
        const to = Math.min(this.total, this.offset + this.limit);
        const prevDisabled = this.offset === 0;
        const nextDisabled = this.offset + this.limit >= this.total;
        return `<section class="card pager-card">
      <span class="pager-info">共 ${this.total} 场，当前第 ${from}–${to} 场</span>
      <div class="pager-actions">
        <form data-action="evaluation-page" class="row-actions">
          <input name="direction" type="hidden" value="prev" />
          <button type="submit" class="btn btn-secondary btn-sm"${prevDisabled ? ' disabled' : ''}>上一页</button>
        </form>
        <form data-action="evaluation-page" class="row-actions">
          <input name="direction" type="hidden" value="next" />
          <button type="submit" class="btn btn-secondary btn-sm"${nextDisabled ? ' disabled' : ''}>下一页</button>
        </form>
      </div>
    </section>`;
    }
    renderReplay(replay) {
        const score = typeof replay.report?.score === 'number' ? replay.report.score : null;
        const band = scoreBand(score);
        const parts = [replay.assignmentName, replay.scenarioTitle].filter((v) => typeof v === 'string' && v.length > 0);
        const content = parts.length === 0 ? '—' : [...new Set(parts)].join(' · ');
        const anchor = replay.displayName === null
            ? (replay.principalId ?? '—')
            : `${replay.principalId ?? '—'}（${replay.displayName}）`;
        return `${this.header()}${this.errorBlock()}
      <section class="card">
        <div class="detail-topline">
          <div>
            <div class="detail-name">对话回放</div>
            <div class="text-muted">主播：${escapeHtml(anchor)} · ${escapeHtml(sourceLabel(replay.sourceType))} · ${escapeHtml(modeLabel(replay.mode))}</div>
          </div>
          <form data-action="evaluation-close"><button type="submit" class="btn btn-secondary btn-sm">返回列表</button></form>
        </div>
        <div class="replay-meta">
          <span class="chip">使用内容：${escapeHtml(content)}</span>
          <span class="chip">开始：${replay.startedAt === null ? '—' : escapeHtml(formatDateTime(replay.startedAt))}</span>
          <span class="chip">综合评分：${band === null || score === null ? '暂无评分' : `${band.label} ${Math.round(score)} 分`}</span>
        </div>
      </section>
      ${this.renderReport(replay.report)}
      <section class="card">
        <div class="card-title">对话过程<span class="card-hint">按时间顺序还原学员与 AI 陪练的完整对话</span></div>
        <div class="chat-thread">${replay.messages.map((message) => this.renderBubble(message)).join('')}</div>
      </section>`;
    }
    /** 渲染评估报告：综合点评、能力维度分、表现亮点、改进建议，供运营直接复盘。 */
    renderReport(report) {
        if (report === null || report === undefined)
            return '';
        const toStringArray = (value) => Array.isArray(value) ? value.filter((item) => typeof item === 'string') : [];
        const dimensions = report.dimensionScores && typeof report.dimensionScores === 'object'
            ? Object.entries(report.dimensionScores)
            : [];
        const strengths = toStringArray(report.strengths);
        const improvements = toStringArray(report.improvements);
        const summary = typeof report.summary === 'string' ? report.summary.trim() : '';
        if (dimensions.length === 0 && strengths.length === 0 && improvements.length === 0 && summary.length === 0) {
            return '<section class="card"><div class="card-title">评估报告</div><div class="empty"><div class="empty-desc">这场训练还没有生成结构化评估报告。</div></div></section>';
        }
        const dimensionBlock = dimensions.length === 0 ? '' : `<div class="detail-block">
      <div class="detail-block-title">能力维度</div>
      <div class="dim-bars">${dimensions.map(([key, value]) => {
            const scoreValue = Math.round(Number(value) || 0);
            const tone = scoreValue >= 85 ? 'good' : scoreValue >= 60 ? 'warn' : 'bad';
            const width = Math.max(0, Math.min(100, scoreValue));
            return `<div class="dim-bar">
          <span class="dim-bar-name">${escapeHtml(dimensionLabel(key))}</span>
          <span class="dim-bar-track"><span class="dim-bar-fill dim-bar-${tone}" style="width:${width}%"></span></span>
          <span class="dim-bar-score">${scoreValue}</span>
        </div>`;
        }).join('')}</div>
    </div>`;
        const listBlock = (title, items, tone) => items.length === 0 ? '' : `<div class="detail-block">
        <div class="detail-block-title">${title}</div>
        <ul class="report-list report-${tone}">${items.map((item) => `<li>${escapeHtml(item)}</li>`).join('')}</ul>
      </div>`;
        const summaryBlock = summary.length === 0 ? '' : `<div class="report-summary">${escapeHtml(summary)}</div>`;
        return `<section class="card">
      <div class="card-title">评估报告<span class="card-hint">由系统根据本场对话自动生成</span></div>
      ${summaryBlock}${dimensionBlock}${listBlock('表现亮点', strengths, 'good')}${listBlock('改进建议', improvements, 'warn')}
    </section>`;
    }
    renderBubble(message) {
        if (message.role === 'assistant') {
            return `<div class="chat-row chat-coach"><div class="chat-role">AI 陪练</div><div class="bubble bubble-coach">${escapeHtml(message.content)}</div></div>`;
        }
        return `<div class="chat-row chat-learner"><div class="chat-role">学员</div><div class="bubble bubble-learner">${escapeHtml(message.content)}</div></div>`;
    }
}
