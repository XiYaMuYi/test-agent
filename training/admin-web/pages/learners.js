import { AdminApiClient, AdminApiProblem, escapeHtml, } from '../api/client.js';
import { dimensionLabel, formatDateTime, modeLabel, scoreBand, sessionStatusLabel, sourceLabel } from '../labels.js';
const PAGE_SIZE = 20;
const FRIENDLY_ERRORS = {
    LEARNER_PROFILE_NOT_FOUND: '未找到该学员档案，可能已被调整，请返回列表刷新。',
};
function friendlyProblem(problem) {
    return FRIENDLY_ERRORS[problem.code] ?? '操作未成功，请稍后重试。';
}
export class LearnerPage {
    api;
    problem;
    items = [];
    total = 0;
    limit = PAGE_SIZE;
    offset = 0;
    query = '';
    selected;
    constructor(api) {
        this.api = api;
    }
    /** 拉取当前搜索词与分页下的学员列表。 */
    async load() {
        this.problem = undefined;
        try {
            const result = await this.api.listLearners({
                ...(this.query.length > 0 ? { q: this.query } : {}),
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
    /** 关键词搜索（账号或姓名），搜索后回到第一页。 */
    async search(keyword) {
        this.query = keyword.trim();
        this.offset = 0;
        await this.load();
    }
    async openLearner(id) {
        this.problem = undefined;
        try {
            this.selected = await this.api.getLearnerDetail(id);
        }
        catch (error) {
            if (error instanceof AdminApiProblem)
                this.problem = error;
            else
                throw error;
        }
    }
    closeLearner() {
        this.selected = undefined;
    }
    /** 结束卡住的会话 */
    async endSession(sessionId) {
        try {
            await this.api.post(`/conversations/${sessionId}/end`, {});
            if (this.selected !== undefined) {
                await this.openLearner(this.selected.id);
            }
            alert('会话已结束，用户可以重新开始。');
        }
        catch (error) {
            alert('结束会话失败：' + (error.message || '未知错误'));
        }
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
            return this.renderDetail(this.selected);
        return `${this.header()}${this.errorBlock()}${this.renderSearch()}${this.renderList()}${this.renderPager()}`;
    }
    header() {
        return `<div class="page-header"><div class="page-title">学员档案</div><div class="page-sub">每位主播在自由练习与团队任务中的成长记录都沉淀到同一份档案，可按账号或姓名检索。</div></div>`;
    }
    errorBlock() {
        if (this.problem === undefined)
            return '';
        return `<div class="alert alert-error" role="alert">${escapeHtml(friendlyProblem(this.problem))}<span class="error-code">错误编号：${escapeHtml(this.problem.code)}</span></div>`;
    }
    renderSearch() {
        return `<section class="card">
      <form data-action="learner-search" class="toolbar-form">
        <div class="search-field">
          <input type="search" name="q" placeholder="输入主播账号或姓名搜索" value="${escapeHtml(this.query)}" aria-label="搜索主播账号或姓名" />
          <button type="submit" class="btn btn-primary">搜索</button>
        </div>
      </form>
    </section>`;
    }
    renderList() {
        if (this.items.length === 0) {
            return `<section class="card"><div class="empty"><div class="empty-title">暂无学员</div><div class="empty-desc">${this.query ? '没有匹配的主播，换个关键词试试。' : '主播在小程序完成首次练习后，档案会自动沉淀到这里。'}</div></div></section>`;
        }
        return `<section class="card">
      <div class="table-wrap"><table class="table">
        <thead><tr><th>头像</th><th>学员昵称</th><th>训练次数</th><th>平均水平</th><th>最近练习</th><th>操作</th></tr></thead>
        <tbody>${this.items.map((item) => this.renderRow(item)).join('')}</tbody>
      </table></div>
    </section>`;
    }
    /** 圆形头像：有头像URL则显示图片，否则显示灰色占位。 */
    renderAvatar(url, size = 38) {
        const s = `${size}px`;
        if (url) {
            return `<img src="${escapeHtml(url)}" alt="" style="width:${s};height:${s};border-radius:50%;object-fit:cover;background:#e9ecef;display:block;" />`;
        }
        return `<span style="display:inline-flex;width:${s};height:${s};border-radius:50%;background:#e9ecef;align-items:center;justify-content:center;font-size:12px;color:#adb5bd;">头像</span>`;
    }
    renderRow(item) {
        const band = scoreBand(item.avgScore);
        const average = band === null
            ? '—'
            : `${band.label}（${Math.round(item.avgScore ?? 0)} 分）`;
        const nameHtml = item.displayName
            ? escapeHtml(item.displayName)
            : '<span class="text-muted">未设置昵称</span>';
        return `<tr>
      <td>${this.renderAvatar(item.avatarUrl)}</td>
      <td class="cell-strong">${nameHtml}</td>
      <td>自由 ${item.totalFreeSessions} · 任务 ${item.totalAssignedSessions}</td>
      <td>${average}</td>
      <td class="text-muted">${item.lastTrainedAt === null ? '尚未练习' : escapeHtml(formatDateTime(item.lastTrainedAt))}</td>
      <td>
        <form data-action="learner-open" class="row-actions">
          <input name="learnerId" type="hidden" value="${escapeHtml(item.learnerId)}" />
          <button type="submit" class="btn btn-ghost btn-sm">查看档案</button>
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
      <span class="pager-info">共 ${this.total} 名，当前第 ${from}–${to} 名</span>
      <div class="pager-actions">
        <form data-action="learner-page" class="row-actions">
          <input name="direction" type="hidden" value="prev" />
          <button type="submit" class="btn btn-secondary btn-sm"${prevDisabled ? ' disabled' : ''}>上一页</button>
        </form>
        <form data-action="learner-page" class="row-actions">
          <input name="direction" type="hidden" value="next" />
          <button type="submit" class="btn btn-secondary btn-sm"${nextDisabled ? ' disabled' : ''}>下一页</button>
        </form>
      </div>
    </section>`;
    }
    renderDetail(learner) {
        const band = scoreBand(learner.avgScore);
        const dimensions = Object.entries(learner.dimensionScores);
        const dimLabels = learner.dimensionLabels ?? {};
        const dimName = (code) => dimLabels[code] ?? dimensionLabel(code);
        return `${this.header()}${this.errorBlock()}
      <section class="card">
        <div class="detail-topline">
          <div style="display:flex;align-items:center;gap:14px;">
            ${this.renderAvatar(learner.avatarUrl, 56)}
            <div>
              <div class="detail-name">${escapeHtml(learner.displayName ?? learner.principalId)}</div>
              <div class="text-muted">账号：${escapeHtml(learner.principalId)}</div>
            </div>
          </div>
          <form data-action="learner-close"><button type="submit" class="btn btn-secondary btn-sm">返回列表</button></form>
        </div>
        <div class="stat-grid">
          <div class="stat"><div class="stat-label">自由练习</div><div class="stat-value">${learner.totalFreeSessions}</div></div>
          <div class="stat"><div class="stat-label">团队任务</div><div class="stat-value">${learner.totalAssignedSessions}</div></div>
          <div class="stat"><div class="stat-label">平均水平</div><div class="stat-value">${band === null ? '—' : `${band.label} ${Math.round(learner.avgScore ?? 0)}`}</div></div>
          <div class="stat"><div class="stat-label">最近练习</div><div class="stat-value stat-value-sm">${learner.lastTrainedAt === null ? '尚未练习' : escapeHtml(formatDateTime(learner.lastTrainedAt))}</div></div>
        </div>
        <div class="detail-block">
          <div class="detail-block-title">能力维度</div>
          ${dimensions.length === 0 ? '<span class="text-muted">暂无维度评估</span>' : `
            <div style="display: flex; flex-direction: column; align-items: center; gap: 24px;">
              ${this.renderRadarChart(dimensions)}
              <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(110px, 1fr)); gap: 10px; width: 100%; max-width: 550px;">
                ${dimensions.map(([name, score]) => `
                  <div style="text-align: center; padding: 12px 8px; background: #f8f9fa; border-radius: 8px; border: 1px solid #e9ecef;">
                    <div style="font-size: 12px; color: #666; margin-bottom: 6px;">${escapeHtml(dimName(name))}</div>
                    <div style="font-size: 18px; font-weight: 600; color: ${score >= 80 ? '#10b981' : score >= 60 ? '#f59e0b' : '#ef4444'};">${Math.round(score)}</div>
                    <div style="font-size: 11px; color: #999; margin-top: 2px;">${score >= 80 ? '优秀' : score >= 60 ? '良好' : '待提升'}</div>
                  </div>
                `).join('')}
              </div>
            </div>
          `}
        </div>
        <div class="detail-block">
          <div class="detail-block-title">薄弱点</div>
          <div class="chip-row">${learner.weakPoints.length === 0 ? '<span class="text-muted">暂无明显薄弱点</span>' : learner.weakPoints.map((point) => `<span class="chip chip-warn">${escapeHtml(dimName(point))}</span>`).join('')}</div>
        </div>
      </section>
      <section class="card">
        <div class="card-title">近 20 次训练<span class="card-hint">自由练习与团队任务统一记录</span></div>
        ${this.renderSessions(learner)}
      </section>`;
    }
    /** 渲染能力雷达图 */
    renderRadarChart(dimensions) {
        // 更大的画布，留出充足边距放标签
        const size = 320;
        const center = size / 2;
        const radius = 80;
        const labelPadding = 40; // 标签距离边缘的 padding
        const count = dimensions.length;
        
        if (count < 3) {
            return `<div style="width: ${size}px; height: ${size}px; display: flex; align-items: center; justify-content: center; color: #999; font-size: 14px;">维度不足，无法绘制雷达图</div>`;
        }
        
        // 计算每个维度的坐标
        const angleStep = (2 * Math.PI) / count;
        const startAngle = -Math.PI / 2; // 从顶部开始
        
        const points = dimensions.map(([name, score], i) => {
            const angle = startAngle + i * angleStep;
            const r = (score / 100) * radius;
            return {
                name,
                score,
                x: center + r * Math.cos(angle),
                y: center + r * Math.sin(angle),
                labelX: center + (radius + labelPadding) * Math.cos(angle),
                labelY: center + (radius + labelPadding) * Math.sin(angle),
            };
        });
        
        // 绘制背景网格（5层）
        const gridLevels = [0.2, 0.4, 0.6, 0.8, 1.0];
        const gridPolygons = gridLevels.map((level) => {
            const points = dimensions.map((_, i) => {
                const angle = startAngle + i * angleStep;
                const r = radius * level;
                return `${center + r * Math.cos(angle)},${center + r * Math.sin(angle)}`;
            }).join(' ');
            return `<polygon points="${points}" fill="none" stroke="#e5e7eb" stroke-width="1" />`;
        }).join('');
        
        // 绘制轴线
        const axes = dimensions.map((_, i) => {
            const angle = startAngle + i * angleStep;
            const x = center + radius * Math.cos(angle);
            const y = center + radius * Math.sin(angle);
            return `<line x1="${center}" y1="${center}" x2="${x}" y2="${y}" stroke="#e5e7eb" stroke-width="1" />`;
        }).join('');
        
        // 绘制数据多边形
        const dataPoints = points.map(p => `${p.x},${p.y}`).join(' ');
        const dataPolygon = `<polygon points="${dataPoints}" fill="rgba(59, 130, 246, 0.25)" stroke="#3b82f6" stroke-width="2" stroke-linejoin="round" />`;
        
        // 绘制数据点
        const dataDots = points.map(p => `<circle cx="${p.x}" cy="${p.y}" r="4" fill="#3b82f6" stroke="white" stroke-width="2" />`).join('');
        
        // 绘制标签 - 完整显示，根据位置自动对齐
        const labels = points.map(p => {
            const label = dimName(p.name);
            // 根据x坐标位置自动调整文本对齐
            let anchor = 'middle';
            if (p.labelX < center - 20) anchor = 'end';
            else if (p.labelX > center + 20) anchor = 'start';
            return `<text x="${p.labelX}" y="${p.labelY}" text-anchor="${anchor}" dominant-baseline="middle" font-size="13" fill="#374151" font-weight="500">${label}</text>`;
        }).join('');
        
        return `<svg width="${size}" height="${size}" viewBox="0 0 ${size} ${size}" style="max-width: 100%; height: auto;">
          ${gridPolygons}
          ${axes}
          ${dataPolygon}
          ${dataDots}
          ${labels}
        </svg>`;
    }
    renderSessions(learner) {
        if (learner.recentSessions.length === 0) {
            return '<div class="empty"><div class="empty-desc">该主播还没有训练记录。</div></div>';
        }
        return `<div class="table-wrap"><table class="table">
      <thead><tr><th>开始时间</th><th>来源</th><th>形式</th><th>使用内容</th><th>评分</th><th>状态</th><th>操作</th></tr></thead>
      <tbody>${learner.recentSessions.map((session) => {
            const band = scoreBand(session.score);
            const contentParts = [session.assignmentName, session.scenarioTitle]
                .filter((value) => typeof value === 'string' && value.length > 0);
            const deduped = [...new Set(contentParts)];
            const content = deduped.length === 0 ? '—' : deduped.join(' · ');
            const scoreText = session.score === null || band === null ? '—' : `${band.label}（${Math.round(session.score)} 分）`;
            return `<tr>
          <td class="text-muted">${escapeHtml(formatDateTime(session.startedAt))}</td>
          <td>${escapeHtml(sourceLabel(session.sourceType))}</td>
          <td>${escapeHtml(modeLabel(session.mode))}</td>
          <td>${content === '—' ? '<span class="text-muted">—</span>' : escapeHtml(content)}</td>
          <td>${scoreText}</td>
          <td>${escapeHtml(sessionStatusLabel(session.status))}</td>
          <td>${(session.status === 'active' || session.status === 'in_progress' || session.status === 'awaiting_model') ? `<form data-action="learner-end-session" class="row-actions"><input type="hidden" name="sessionId" value="${escapeHtml(session.id)}" /><button type="submit" class="btn btn-sm btn-danger">结束会话</button></form>` : '—'}</td>
        </tr>`;
        }).join('')}</tbody>
    </table></div>`;
    }
}
