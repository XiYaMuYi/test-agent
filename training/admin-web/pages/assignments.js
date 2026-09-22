import { AdminApiClient, AdminApiProblem, escapeHtml, } from '../api/client.js';
import { assignmentStatusLabel, formatDateTime } from '../labels.js';
const FILTERS = [
    { value: 'all', label: '全部' },
    { value: 'active', label: '进行中' },
    { value: 'paused', label: '已暂停' },
    { value: 'ended', label: '已结束' },
];
const FRIENDLY_ERRORS = {
    ASSIGNMENT_TARGETS_EMPTY: '未解析到可投放的主播，请检查填写的账号。',
    RELEASE_SNAPSHOT_NOT_FOUND: '未找到对应的已发布场景，请先在「场景管理」发布后再投放。',
    ASSIGNMENT_ILLEGAL_TRANSITION: '当前任务状态不允许这个操作，请刷新列表后重试。',
    ASSIGNMENT_NOT_FOUND: '该任务可能已被调整，请刷新任务列表后重试。',
};
function friendlyProblem(problem) {
    return FRIENDLY_ERRORS[problem.code] ?? '操作未成功，请检查后重试。';
}
export class AssignmentPage {
    api;
    problem;
    learnerCount = 0;
    notice = '';
    snapshots = [];
    items = [];
    filter = 'all';
    candidates = [];
    resolvedTargets = [];
    editingOverrideId = null;
    scoringTemplates = [];
    currentStep = 1; // 1=选择人员, 2=配置任务
    selectedCandidateIds = new Set(); // 第1步勾选的历史主播ID
    constructor(api) {
        this.api = api;
    }
    /** 拉取可投放的已发布快照、现有任务与已沉淀主播，供下拉/列表/勾选使用。 */
    async load() {
        const [snapshots, assignments, learners, scoringTemplates] = await Promise.all([
            this.api.listReleaseSnapshots().catch((error) => {
                if (error instanceof AdminApiProblem) {
                    this.problem = error;
                    return [];
                }
                throw error;
            }),
            this.api.listAssignments(this.filter).catch((error) => {
                if (error instanceof AdminApiProblem) {
                    this.problem = error;
                    return [];
                }
                throw error;
            }),
            this.api.listLearners({ limit: 100 }).catch(() => ({ items: [], total: 0, limit: 100, offset: 0 })),
            this.api.get('/scoring/templates').catch(() => ({ templates: [] })),
        ]);
        this.snapshots = snapshots.filter((snapshot) => snapshot.isActive);
        this.items = assignments;
        this.candidates = learners.items;
        this.scoringTemplates = Array.isArray(scoringTemplates?.templates) ? scoringTemplates.templates : (Array.isArray(scoringTemplates) ? scoringTemplates : []);
    }
    async reloadList() {
        this.items = await this.api.listAssignments(this.filter);
    }
    async setFilter(filter) {
        if (filter === this.filter)
            return;
        this.filter = filter;
        await this.reloadList();
    }
    async preview(targetPrincipalIds) {
        await this.run('已解析出可投放主播，已进入第 2 步配置任务。', async () => {
            const preview = await this.api.post('/admin/assignments/preview', { targetPrincipalIds });
            this.learnerCount = preview.learnerIds.length;
            this.resolvedTargets = targetPrincipalIds;
            this.currentStep = 2;
        });
    }
    async create(input) {
        await this.run('任务已下发，主播可在小程序「团队任务」中看到。', async () => {
            await this.api.createAssignment(input);
            this.filter = 'all';
            this.currentStep = 1;
            this.resolvedTargets = [];
            this.selectedCandidateIds = new Set();
            await this.reloadList();
        });
    }
    async changeStatus(id, target) {
        this.problem = undefined;
        try {
            const updated = await this.api.changeAssignmentStatus(id, target);
            this.notice = `任务「${escapeHtml(updated.name)}」已更新为${assignmentStatusLabel(target)}。`;
            await this.reloadList();
        }
        catch (error) {
            if (error instanceof AdminApiProblem)
                this.problem = error;
            else
                throw error;
        }
    }
    /** 保存/清空任务级参数覆盖：只影响之后新开的会话，历史会话冻结。 */
    async updateOverride(id, overridePatch) {
        await this.run(overridePatch === null ? '任务参数覆盖已清空，之后新开的会话回到场景默认配置。' : '任务参数覆盖已保存，只影响之后新开的会话；历史会话保持冻结不变。', async () => {
            await this.api.updateAssignmentOverride(id, overridePatch);
            this.editingOverrideId = null;
            await this.reloadList();
        });
    }
    toggleOverrideEditor(id) {
        this.editingOverrideId = this.editingOverrideId === id ? null : id;
    }
    render() {
        return `${this.header()}${this.errorBlock()}
      ${this.renderStepIndicator()}
      ${this.currentStep === 1 ? this.renderStep1() : this.renderStep2()}
      ${this.renderTaskList()}`;
    }

    /** 步骤指示器 */
    renderStepIndicator() {
        const steps = [
            { n: 1, label: '选择人员', desc: '填写或勾选主播账号' },
            { n: 2, label: '配置任务', desc: '场景、评分、时间、次数' },
            { n: 3, label: '确认下发', desc: '核对后提交' },
        ];
        return `<div class="k-step-bar">
      ${steps.map((s) => {
            const isActive = this.currentStep === s.n;
            const isDone = this.currentStep > s.n;
            return `<div class="k-step${isActive ? ' active' : ''}${isDone ? ' done' : ''}">
          <div class="k-step-num">${isDone ? '✓' : s.n}</div>
          <div class="k-step-text">
            <div class="k-step-label">${s.label}</div>
            <div class="k-step-desc">${s.desc}</div>
          </div>
        </div>${s.n < 3 ? '<div class="k-step-line"></div>' : ''}`;
        }).join('')}
    </div>`;
    }

    /** 第1步：选择人员 */
    renderStep1() {
        return `<section class="card k-step-card">
        <div class="card-title">选择投放人员<span class="card-hint">填写主播账号，或从已沉淀主播中勾选；系统会解析出可投放的人</span></div>
        <form data-action="preview-assignment">
          <div class="k-form-group">
            <label>投放主播账号 <span class="k-form-hint">每行一个账号，例如 streamer-001</span></label>
            <textarea id="as-preview-targets" name="targetPrincipalIds" rows="3" class="k-textarea" placeholder="每行一个账号，例如：&#10;streamer-001&#10;streamer-002"></textarea>
          </div>
          ${this.renderCandidates()}
          <div class="k-form-actions">
            <button type="submit" class="k-btn k-btn-primary k-btn-lg">确认人员，下一步 →</button>
            <span class="k-form-hint">点击后系统解析账号，进入任务配置</span>
          </div>
        </form>
      </section>`;
    }

    /** 第2步：配置任务 */
    renderStep2() {
        const canSubmit = this.resolvedTargets.length > 0 && this.snapshots.length > 0;
        return `<section class="card k-step-card">
        <div class="card-title">配置陪练任务<span class="card-hint">选择已发布场景、评分规则，设置时间与练习次数</span></div>

        ${this.renderSelectedPeopleChips()}

        <form data-action="create-assignment">
          <input type="hidden" name="targetPrincipalIds" value="${escapeHtml(this.resolvedTargets.join('\n'))}" />

          <div class="k-form-section">
            <div class="k-form-section-title">基本信息</div>
            <div class="k-form-row">
              <div class="k-form-group">
                <label>任务名称 <span class="k-form-hint">便于后续管理和检索</span></label>
                <input id="as-name" name="name" required class="k-input" placeholder="例如：9月抗老开场专项" />
              </div>
              <div class="k-form-group">
                <label>选择已发布场景 <span class="k-form-hint">来自「场景管理」发布的可用版本</span></label>
                ${this.renderSnapshotSelect()}
              </div>
            </div>
            <div class="k-form-group">
              <label>评分规则 <span class="k-form-hint">决定本次任务学员的评分维度和标准</span></label>
              ${this.renderScoringTemplateSelect()}
            </div>
          </div>

          <div class="k-form-section">
            <div class="k-form-section-title">时间与练习设置</div>
            <div class="k-form-row">
              <div class="k-form-group">
                <label>投放状态</label>
                <select id="as-status" name="status" class="k-select" onchange="window.__asToggleTime(this.value)">
                  <option value="active" selected>立即生效</option>
                  <option value="scheduled">定时生效</option>
                  <option value="draft">存为草稿</option>
                  <option value="paused">先暂停</option>
                </select>
              </div>
              <div class="k-form-group">
                <label>每位主播可练习次数</label>
                <input id="as-attempts" name="maxAttempts" type="number" min="1" value="1" required class="k-input" />
              </div>
            </div>
            <div class="k-form-row" id="as-time-row" style="display:none">
              <div class="k-form-group">
                <label>开始时间</label>
                <input id="as-start" name="startsAt" type="datetime-local" class="k-input" />
              </div>
              <div class="k-form-group">
                <label>结束时间</label>
                <input id="as-end" name="endsAt" type="datetime-local" class="k-input" />
              </div>
            </div>
          </div>

          ${this.renderOverrideSection(null)}

          <div class="k-form-actions">
            <button type="button" class="k-btn k-btn-ghost" data-action="back-to-step1">← 返回修改人员</button>
            <button type="submit" class="k-btn k-btn-primary k-btn-lg"${canSubmit ? '' : ' disabled title="请先确认人员并选择场景"'}>确认下发任务</button>
          </div>
          ${!canSubmit ? '<div class="k-form-hint k-form-warning">请先选择已发布场景；人员已确认 ' + this.resolvedTargets.length + ' 人</div>' : ''}
        </form>
        <div class="status-line">${escapeHtml(this.notice)}</div>
      </section>`;
    }

    /** 已选人员 chip 展示（第2步顶部） */
    renderSelectedPeopleChips() {
        if (this.resolvedTargets.length === 0) return '';
        const chips = this.resolvedTargets.map((id) => {
            const learner = this.candidates.find((c) => c.principalId === id || c.id === id);
            const name = learner?.name || learner?.displayName || id;
            return `<span class="k-chip k-chip-sm selected">
          <span class="k-chip-text">${escapeHtml(name)}</span>
          <span class="k-chip-meta">${escapeHtml(id)}</span>
        </span>`;
        }).join('');
        return `<div class="k-selected-people">
        <div class="k-selected-people-label">已确认投放人员（${this.resolvedTargets.length} 人）</div>
        <div class="k-chip-list">${chips}</div>
      </div>`;
    }
    header() {
        return `<div class="page-header"><div class="page-title">任务投放</div><div class="page-sub">把已发布的场景作为团队任务下发给指定主播；主播也可以随时在小程序自由练习，两条路径共用同一份成长档案。</div></div>`;
    }
    errorBlock() {
        if (this.problem === undefined)
            return '';
        return `<div class="alert alert-error" role="alert">${escapeHtml(friendlyProblem(this.problem))}<span class="error-code">错误编号：${escapeHtml(this.problem.code)}</span></div>`;
    }
    renderSnapshotSelect() {
        if (this.snapshots.length === 0) {
            return `<select id="as-snapshot" name="releaseSnapshotId" disabled class="k-select">
        <option value="">暂无已发布场景，请先在「场景管理」发布</option>
      </select>
      <div class="k-form-hint">还没有可投放的场景版本，先在「场景管理」发布一个场景后再回来投放。</div>`;
        }
        return `<select id="as-snapshot" name="releaseSnapshotId" required class="k-select">
      <option value="" selected disabled>请选择已发布场景</option>
      ${this.snapshots
            .map((snapshot) => `<option value="${escapeHtml(snapshot.id)}">${escapeHtml(snapshot.title)} · ${escapeHtml(this.snapshotDigest(snapshot))} · 发布于 ${escapeHtml(formatDateTime(snapshot.createdAt))}</option>`)
            .join('')}
    </select>
    <div class="k-form-hint">配置摘要：人设名称 · 模板版本 / 独立配置 · 知识/评分条数 · 历史消息条数，避免仅凭场景名误投。</div>`;
    }
    /** 评分模板选择器：默认模板优先，显示维度数和关联任务数。 */
    renderScoringTemplateSelect() {
        if (this.scoringTemplates.length === 0) {
            return `<select id="as-scoring" name="scoringTemplateId">
        <option value="">使用默认评分规则</option>
      </select>
      <div class="field-hint">暂无评分模板配置，将使用系统默认评分规则。可在「评分配置」中创建自定义模板。</div>`;
        }
        const defaultTemplate = this.scoringTemplates.find((t) => t.isDefault);
        const options = this.scoringTemplates
            .sort((a, b) => (b.isDefault ? 1 : 0) - (a.isDefault ? 1 : 0))
            .map((t) => {
                const defaultBadge = t.isDefault ? '（默认）' : '';
                const linked = t.linkedAssignmentCount ? ` · 已用于${t.linkedAssignmentCount}个任务` : '';
                return `<option value="${escapeHtml(t.id)}">${escapeHtml(t.name)}${defaultBadge}${linked}</option>`;
            })
            .join('');
        return `<select id="as-scoring" name="scoringTemplateId" class="k-select">
      <option value="" selected>使用默认评分规则${defaultTemplate ? `（${escapeHtml(defaultTemplate.name)}）` : ''}</option>
      ${options}
    </select>
    <div class="k-form-hint">选择后本次任务所有学员的训练都将使用该评分规则。不选则使用组织默认评分模板。</div>`;
    }
    /** 快照配置摘要（spec §6.4）：人设 + 模板版本 + 知识/评分 + AI 行为。 */
    snapshotDigest(snapshot) {
        const persona = snapshot.personaName
            ? `${snapshot.personaName}${snapshot.personaDifficulty ? `（难度${snapshot.personaDifficulty}）` : ''}`
            : '人设—';
        const source = snapshot.templateRevision
            ? `模板 v${snapshot.templateRevision}`
            : (snapshot.personaSourceKind === 'inline' ? '独立配置' : '来源—');
        const resources = `知识${snapshot.knowledgeCount}/评分${snapshot.scoringCount}`;
        const agent = snapshot.historyMessageLimit ? `历史${snapshot.historyMessageLimit}条` : '';
        return `${persona} · ${source} · ${resources}${agent ? ` · ${agent}` : ''}`;
    }
    /** 任务级参数覆盖表单（spec §6.4 扩展）：缺省字段=不覆盖。value 为 null 表示全新表单。 */
    renderOverrideSection(value) {
        const patch = value?.overridePatch ?? null;
        const agent = patch?.agentConfig ?? null;
        const conv = patch?.conversation ?? null;
        const field = (name, label, options, current) => `<div class="k-form-group">
          <label>${label}<span class="k-form-hint">留空=不覆盖</span></label>
          <select id="${name}" name="${name}" class="k-select">
            <option value="">不覆盖（用场景默认）</option>
            ${options.map((option) => `<option value="${option.value}"${current === option.value ? ' selected' : ''}>${option.label}</option>`).join('')}
          </select>
        </div>`;
        const numberField = (name, label, current, min, max, hint) => `<div class="k-form-group">
          <label>${label}<span class="k-form-hint">留空=不覆盖</span></label>
          <input id="${name}" name="${name}" type="number" min="${min}" max="${max}"${typeof current === 'number' ? ` value="${current}"` : ''} placeholder="${hint}" class="k-input" />
        </div>`;
        return `<details class="k-override-panel">
        <summary>高级选项：对话参数覆盖（可选）<span class="k-form-hint">只影响之后新开的会话；历史会话保持冻结不变。通常无需填写</span></summary>
        <div class="k-override-grid">
          ${numberField('agentHistoryMessageLimit', '历史消息条数', agent?.historyMessageLimit, 2, 50, '2-50')}
          ${field('agentResponseLength', '回复长度', [
            { value: 'short', label: '简短（一句话以内）' },
            { value: 'normal', label: '适中（1-2 句）' },
            { value: 'detailed', label: '详细（2-3 句）' },
        ], agent?.responseLength)}
          ${field('agentKnowledgeStrictness', '知识严谨度', [
            { value: 'strict', label: '严格（只引用知识条目）' },
            { value: 'balanced', label: '均衡（可结合常识）' },
        ], agent?.knowledgeStrictness)}
          ${field('agentConversationPace', '对话推进速度', [
            { value: 'slow', label: '缓慢（需多次引导）' },
            { value: 'normal', label: '正常' },
            { value: 'fast', label: '较快' },
        ], agent?.conversationPace)}
          ${field('agentClosingTendency', '成交倾向', [
            { value: 'resistant', label: '抗拒（难成交）' },
            { value: 'neutral', label: '中性' },
            { value: 'receptive', label: '易成交' },
        ], agent?.closingTendency)}
          <div class="k-form-group k-form-wide">
            <label>额外行为指令<span class="k-form-hint">最多 1000 字</span></label>
            <textarea id="agentAdditionalInstructions" name="agentAdditionalInstructions" rows="2" maxlength="1000" placeholder="例如：对价格特别敏感，会反复比价" class="k-textarea">${escapeHtml(agent?.additionalInstructions ?? '')}</textarea>
          </div>
          ${numberField('conversationMaxTurns', '最大轮数', conv?.maxTurns, 1, 100, '1-100')}
          ${field('conversationOpeningMode', '开场方式', [
            { value: 'ai_first', label: 'AI 先开口' },
            { value: 'wait_learner', label: '等学员先开口' },
        ], conv?.openingMode)}
          <div class="k-form-group k-form-wide">
            <label>客户背景<span class="k-form-hint">最多 500 字，覆盖场景人设背景</span></label>
            <textarea id="conversationBackground" name="conversationBackground" rows="2" maxlength="500" placeholder="例如：一位 35 岁敏感肌宝妈，预算 500 元内" class="k-textarea">${escapeHtml(conv?.background ?? '')}</textarea>
          </div>
        </div>
      </details>`;
    }
    /** 行内覆盖编辑表单：预填当前覆盖，提交保存/清空。 */
    renderOverrideEditor(item) {
        return `<section class="card override-editor">
        <div class="card-title">调整「${escapeHtml(item.name)}」的对话参数覆盖<span class="card-hint">只影响之后新开的会话；已开始的会话保持冻结不变</span></div>
        <form data-action="assignment-override-op">
          <input name="assignmentId" type="hidden" value="${escapeHtml(item.id)}" />
          ${this.renderOverrideSection(item)}
          <div class="form-actions">
            <button type="submit" class="btn btn-primary">保存覆盖</button>
            <button type="submit" name="clearOverride" value="1" class="btn btn-ghost">清空覆盖</button>
          </div>
        </form>
      </section>`;
    }
    renderPreview() {
        if (this.learnerCount === 0)
            return '';
        return `<div class="preview-result"><div class="preview-title">共解析出 <strong>${this.learnerCount}</strong> 名可投放主播</div></div>`;
    }
    /** 已沉淀主播勾选区：勾选账号会与手填账号合并去重；不暴露内部 learnerId。 */
    renderCandidates() {
        if (this.candidates.length === 0) {
            return '<div class="k-form-hint">还没有已沉淀的主播可勾选，可直接在上方填写账号；主播在小程序练习后会自动沉淀。</div>';
        }
        const options = this.candidates.map((learner) => {
            const name = learner.displayName || learner.name || learner.principalId;
            const id = learner.principalId || learner.id;
            return `<label class="k-check-pill">
        <input name="selectedPrincipal" type="checkbox" value="${escapeHtml(id)}" />
        <span class="k-check-pill-name">${escapeHtml(name)}</span>
        <span class="k-check-pill-id">${escapeHtml(id)}</span>
      </label>`;
        }).join('');
        return `<div class="k-form-group">
      <label>从已沉淀主播选择 <span class="k-form-hint">勾选后与上方手填账号一起解析，自动去重</span></label>
      <div class="k-check-grid">${options}</div>
    </div>`;
    }
    renderTaskList() {
        const tabs = `<form data-action="assignment-filter" class="filter-tabs">
      ${FILTERS.map((filter) => `<button type="submit" name="status" value="${filter.value}" class="filter-tab${this.filter === filter.value ? ' is-active' : ''}"${this.filter === filter.value ? ' aria-current="true"' : ''}>${filter.label}</button>`).join('')}
    </form>`;
        const body = this.items.length === 0
            ? '<div class="empty"><div class="empty-title">暂无任务</div><div class="empty-desc">在上方选择已发布场景并下发第一个团队任务。</div></div>'
            : `<div class="table-wrap"><table class="table">
          <thead><tr><th>任务名称</th><th>使用场景</th><th>学员进度</th><th>任务周期</th><th>状态</th><th>操作</th></tr></thead>
          <tbody>${this.items.map((item) => this.renderRow(item)).join('')}</tbody>
        </table>${this.editingOverrideId === null ? '' : this.renderOverrideEditor(this.items.find((item) => item.id === this.editingOverrideId) ?? this.items[0])}</div>`;
        return `<section class="card">
      <div class="card-title">任务列表<span class="card-hint">共 ${this.items.length} 个</span></div>
      ${tabs}
      ${body}
    </section>`;
    }
    renderRow(item) {
        const badgeClass = item.status === 'active' ? 'badge-active' : item.status === 'paused' ? 'badge-draft' : 'badge-neutral';
        const overrideBadge = item.overridePatch !== null
            ? `<span class="badge badge-active override-badge" title="${escapeHtml(this.overrideSummary(item.overridePatch))}">已调参</span>`
            : '';
        return `<tr>
      <td class="cell-strong">${escapeHtml(item.name)}${overrideBadge}</td>
      <td>${escapeHtml(item.scenarioTitle ?? '—')}</td>
      <td>投放 ${item.targetCount} · 完成 ${item.completedCount} · 进行中 ${item.inProgressCount}</td>
      <td class="text-muted">${escapeHtml(formatDateTime(item.startsAt))} 至 ${escapeHtml(formatDateTime(item.endsAt))}</td>
      <td><span class="badge ${badgeClass}">${escapeHtml(assignmentStatusLabel(item.status))}</span></td>
      <td>${this.renderRowActions(item)}</td>
    </tr>`;
    }
    /** 覆盖摘要（hover 提示）：列出实际覆盖的字段，缺省字段不显示。 */
    overrideSummary(patch) {
        const parts = [];
        const agent = patch?.agentConfig;
        if (agent !== undefined) {
            if (typeof agent.historyMessageLimit === 'number')
                parts.push(`历史${agent.historyMessageLimit}条`);
            if (agent.responseLength !== undefined)
                parts.push(`回复${agent.responseLength === 'short' ? '简短' : agent.responseLength === 'detailed' ? '详细' : '适中'}`);
            if (agent.knowledgeStrictness !== undefined)
                parts.push(`知识${agent.knowledgeStrictness === 'strict' ? '严格' : '均衡'}`);
            if (agent.conversationPace !== undefined)
                parts.push(`节奏${agent.conversationPace === 'slow' ? '缓慢' : agent.conversationPace === 'fast' ? '较快' : '正常'}`);
            if (agent.closingTendency !== undefined)
                parts.push(`成交${agent.closingTendency === 'resistant' ? '抗拒' : agent.closingTendency === 'receptive' ? '易' : '中性'}`);
            if (agent.additionalInstructions !== undefined && agent.additionalInstructions.length > 0)
                parts.push('额外指令');
        }
        const conv = patch?.conversation;
        if (conv !== undefined) {
            if (typeof conv.maxTurns === 'number')
                parts.push(`最多${conv.maxTurns}轮`);
            if (conv.openingMode !== undefined)
                parts.push(conv.openingMode === 'ai_first' ? 'AI 先开口' : '等学员先开口');
            if (conv.background !== undefined && conv.background.length > 0)
                parts.push('客户背景');
        }
        return parts.length > 0 ? `覆盖：${parts.join(' · ')}` : '已设置覆盖';
    }
    renderRowActions(item) {
        const actions = [];
        if (item.status === 'active')
            actions.push({ target: 'paused', label: '暂停', danger: false }, { target: 'ended', label: '结束', danger: true });
        else if (item.status === 'paused')
            actions.push({ target: 'active', label: '恢复', danger: false }, { target: 'ended', label: '结束', danger: true });
        else if (item.status === 'draft')
            actions.push({ target: 'active', label: '启动', danger: false }, { target: 'ended', label: '结束', danger: true });
        if (actions.length === 0)
            return '<span class="text-muted">已结束</span>';
        return `<form data-action="assignment-status-op" class="row-actions">
      <input name="assignmentId" type="hidden" value="${escapeHtml(item.id)}" />
      ${actions
            .map((action) => `<button type="submit" name="status" value="${action.target}" class="btn btn-ghost btn-sm${action.danger ? ' btn-danger-ghost' : ''}">${action.label}</button>`)
            .join('')}
    </form>
    <form data-action="assignment-override-toggle" class="row-actions">
      <input name="assignmentId" type="hidden" value="${escapeHtml(item.id)}" />
      <button type="submit" class="btn btn-ghost btn-sm">${this.editingOverrideId === item.id ? '收起调参' : '调参'}</button>
    </form>`;
    }
    async run(notice, request) {
        this.problem = undefined;
        try {
            await request();
            this.notice = notice;
        }
        catch (error) {
            if (error instanceof AdminApiProblem)
                this.problem = error;
            else
                throw error;
        }
    }
}
