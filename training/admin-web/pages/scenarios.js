import { AdminApiClient, AdminApiProblem, escapeHtml, } from '../api/client.js';
import { difficultyLabel, formatDateTime, openingModeLabel, personaSourceLabel, summarizePersona } from '../labels.js';
const FRIENDLY_ERRORS = {
    SCENARIO_DRAFT_NOT_FOUND: '未找到该场景，可能已被删除，请刷新列表后重试。',
    SCENARIO_INVALID_RELEASE: '场景内容还没达到发布要求，请补充知识要点或评分要点后重新检查。',
    SCENARIO_RELEASE_INCOMPLETE: '场景内容还没达到发布要求：发布前必须有人设来源，且知识要点、评分要点至少各一项。',
    SCENARIO_DRAFT_CONFLICT: '已存在同名场景草稿，请换一个场景名称。',
    SCENARIO_PERSONA_SOURCE_NOT_TEMPLATE: '该场景不是绑定模板人设，无法执行「升级到最新版本」。',
    TEMPLATE_REVISION_NOT_FOUND: '模板版本不存在或已被清理，请重新选择模板版本。',
};
function friendlyProblem(problem) {
    return FRIENDLY_ERRORS[problem.code] ?? '操作未成功，请检查后重试。';
}
export class ScenarioPage {
    api;
    drafts = [];
    snapshots = [];
    selectedId = null;
    loaded = false;
    problem;
    status = '先在上方创建场景草稿，再在列表中选中它，依次「检查内容」「发布上线」。';
    templates = [];
    detail;
    previewResult;
    constructor(api) {
        this.api = api;
    }
    /** 拉取草稿列表、已发布版本与组织模板（供绑定选择）；任何写操作后都重新加载。 */
    async load() {
        try {
            const [drafts, snapshots, templates] = await Promise.all([
                this.api.listScenarios(),
                this.api.listReleaseSnapshots(),
                this.api.listOrganizationTemplates('active').catch(() => []),
            ]);
            this.drafts = drafts;
            this.snapshots = snapshots;
            this.templates = templates;
            this.loaded = true;
            this.problem = undefined;
            if (this.selectedId !== null && !this.drafts.some((draft) => draft.id === this.selectedId)) {
                this.selectedId = null;
                this.detail = undefined;
            }
            if (this.selectedId !== null && this.detail !== undefined && this.detail.id !== this.selectedId) {
                this.detail = undefined;
            }
        }
        catch (error) {
            if (error instanceof AdminApiProblem)
                this.problem = error;
            else
                throw error;
        }
    }
    async select(id) {
        if (!this.drafts.some((draft) => draft.id === id))
            return;
        this.selectedId = id;
        this.previewResult = undefined;
        try {
            this.detail = await this.api.getScenarioDraft(id);
        }
        catch (error) {
            if (error instanceof AdminApiProblem)
                this.problem = error;
            else
                throw error;
        }
    }
    /** 创建草稿：运营只给业务内容，内部 id 由后端生成，创建后自动选中并刷新。 */
    async create(payload) {
        this.problem = undefined;
        try {
            const created = await this.api.createScenarioDraft(payload);
            this.selectedId = created.id;
            this.status = '场景草稿已创建，已为你选中，可设置人设来源后「检查内容」「发布上线」。';
            await this.load();
            await this.select(created.id);
        }
        catch (error) {
            if (error instanceof AdminApiProblem)
                this.problem = error;
            else
                throw error;
        }
    }
    /** 对选中草稿执行检查 / 发布 / 发布预览，随后刷新列表计数与已发布版本。 */
    async runOp(id, op) {
        await this.select(id);
        this.problem = undefined;
        try {
            if (op === 'publish') {
                await this.api.post(`/admin/scenarios/${id}/publish`);
                this.status = '场景已发布上线，生成了一个不可变版本，可在「任务投放」中选择。';
            }
            else if (op === 'publish-preview') {
                const result = await this.api.publishPreviewScenario(id);
                this.previewResult = result;
                this.status = result.valid
                    ? '发布前检查通过：人设、知识、评分、AI 行为与 C 端策略均完整，可以发布上线。'
                    : '发布前检查未通过，请查看下方提示补齐后再发布。';
            }
            else {
                await this.api.post(`/admin/scenarios/${id}/validate`);
                this.status = '内容检查通过，可以发布上线。';
            }
            await this.load();
            this.selectedId = id;
        }
        catch (error) {
            if (error instanceof AdminApiProblem)
                this.problem = error;
            else
                throw error;
        }
    }
    /** 修改当前选中草稿（部分更新），运营无需输入编号。 */
    async updateSelected(update) {
        if (this.selectedId === null) {
            this.status = '请先在列表中选择要修改的场景。';
            return;
        }
        this.problem = undefined;
        try {
            await this.api.patch(`/admin/scenarios/${this.selectedId}`, update);
            this.status = '选中场景的草稿已更新。';
            await this.load();
            await this.select(this.selectedId);
        }
        catch (error) {
            if (error instanceof AdminApiProblem)
                this.problem = error;
            else
                throw error;
        }
    }
    /** 升级绑定到模板最新 revision（spec §6.3）。 */
    async upgradeTemplate(id) {
        this.problem = undefined;
        try {
            const result = await this.api.upgradeScenarioTemplate(id);
            this.status = result.status === 'upgraded'
                ? '已把该场景的人设绑定升级到模板最新版本。'
                : '当前已绑定模板最新版本，无需升级。';
            await this.load();
            await this.select(id);
        }
        catch (error) {
            if (error instanceof AdminApiProblem)
                this.problem = error;
            else
                throw error;
        }
    }
    render() {
        return `${this.header()}${this.errorBlock()}
      <section class="card">
        <div class="card-title">新建场景草稿<span class="card-hint">填写场景名称与要点，再选择人设来源（绑定模板版本或独立配置）</span></div>
        <form data-action="create-scenario">
          <div class="field">
            <label for="sc-draft-name">场景名称</label>
            <input id="sc-draft-name" name="title" required placeholder="例如：抗老产品开场异议处理" />
          </div>
          <details class="advanced">
            <summary>高级设置：关联知识要点 / 评分要点（按需填写）</summary>
            <div class="form-grid">
              <div class="field">
                <label for="sc-draft-knowledge">关联知识要点</label>
                <textarea id="sc-draft-knowledge" name="knowledgeVersions" rows="3" placeholder="每行一个，例如：抗老精华成分@1"></textarea>
              </div>
              <div class="field">
                <label for="sc-draft-rules">评分要点</label>
                <textarea id="sc-draft-rules" name="scoringRules" rows="3" placeholder="每行一个评分要点，可留空"></textarea>
              </div>
            </div>
          </details>
          ${this.renderPersonaSourcePicker(undefined)}
          <div class="form-actions"><button type="submit" class="btn btn-primary">创建场景草稿</button></div>
        </form>
      </section>
      <section class="card">
        <div class="card-title">场景草稿列表<span class="card-hint">点选一条场景，再检查、发布预览或发布；发布前必须绑定人设来源</span></div>
        ${this.renderDraftList()}
        ${this.renderSelectedDetail()}
        ${this.renderSelectedSnapshots()}
        ${this.renderEditPanel()}
        <div class="status-line">${escapeHtml(this.status)}</div>
      </section>`;
    }
    renderPersonaSourcePicker(detail) {
        const current = detail?.payload?.personaSource;
        const kind = current?.kind ?? 'template_revision';
        const templateOptions = this.templates.map((tpl) => {
            const revisionBadge = typeof tpl.currentRevision === 'number' ? `（当前 v${tpl.currentRevision}）` : '';
            const selected = current?.kind === 'template_revision' && current.templateId === tpl.id ? ' selected' : '';
            // 值编码 templateId::revision，提交时原样还原，保证绑定到确定版本（spec §6.3 不自动漂移）。
            const value = `${tpl.id}::${typeof tpl.currentRevision === 'number' ? tpl.currentRevision : ''}`;
            return `<option value="${escapeHtml(value)}"${selected}>${escapeHtml(tpl.title)}${escapeHtml(revisionBadge)}</option>`;
        }).join('');
        const boundTemplate = current?.kind === 'template_revision'
            ? this.templates.find((tpl) => tpl.id === current.templateId)
            : undefined;
        const boundRevision = current?.kind === 'template_revision' ? current.revision : undefined;
        const isStale = boundTemplate !== undefined && typeof boundTemplate.currentRevision === 'number'
            && typeof boundRevision === 'number' && boundTemplate.currentRevision > boundRevision;
        const staleHint = isStale
            ? `<div class="alert alert-warn" style="margin-top:8px">模板「${escapeHtml(boundTemplate.title)}」已有新版本 v${boundTemplate.currentRevision}，当前绑定 v${boundRevision}。如要使用新版本，请在下方点击「升级到最新版本」。</div>`
            : '';
        return `<fieldset class="builder-step">
      <legend><span class="step-no">人设来源</span><span class="step-hint">发布时会冻结完整人设到快照；选择模板版本后模板修改不会自动影响已发布场景</span></legend>
      <div class="form-grid">
        <div class="field">
          <label for="ps-kind">来源方式</label>
          <select id="ps-kind" name="personaSourceKind">
            <option value="template_revision"${kind === 'template_revision' ? ' selected' : ''}>绑定组织模板版本</option>
            <option value="inline"${kind === 'inline' ? ' selected' : ''}>独立配置完整人设</option>
          </select>
        </div>
        <div class="field" data-persona-field="template">
          <label for="ps-template">组织模板</label>
          ${templateOptions.length === 0
            ? '<div class="field-hint">还没有生效中的组织模板，请先到「陪练模板」创建。</div><select id="ps-template" name="personaTemplateId" disabled><option value="">暂无模板</option></select>'
            : `<select id="ps-template" name="personaTemplateId">${templateOptions}</select>`}
        </div>
        ${staleHint}
        <div class="field field-full" data-persona-field="inline" style="display:none">
          <label for="ps-inline">独立完整人设（JSON）</label>
          <textarea id="ps-inline" name="personaConfigJson" rows="6" placeholder='{"id":"","name":"客户","basedOnCard":"","age":30,"gender":"female","basic":{"maritalStatus":"unknown","incomeLevel":"medium"},"occupation":"白领","personality":{"friendliness":50,"patience":50,"priceSensitivity":50,"decisiveness":50,"skepticism":40,"socialActivity":50,"emotionalVolatility":50},"communication":{"style":"gentle","verbosity":"normal","emotionLevel":"normal","dialect":"mandarin"},"consumption":{"budgetMin":100,"budgetMax":500,"decisionCycle":"same_day","brandLoyalty":"medium"},"conversation":{"difficulty":2,"maxTurns":15,"background":"客户背景","productScenario":"护肤品","openingMode":"ai_first"}}'>${escapeHtml(current?.kind === 'inline' ? JSON.stringify(current.personaConfig ?? {}, null, 2) : '')}</textarea>
          <div class="field-hint">只在「独立配置」模式下生效；JSON 需包含完整人设字段，保存时后端会校验。</div>
        </div>
      </div>
    </fieldset>`;
    }
    renderDraftList() {
        if (!this.loaded) {
            return '<div class="loading-inline">正在加载场景列表…</div>';
        }
        if (this.drafts.length === 0) {
            return '<div class="empty-state"><div class="empty-title">还没有场景草稿</div><div class="empty-desc">在上方填写场景名称，创建第一条草稿吧。</div></div>';
        }
        const rows = this.drafts.map((draft) => {
            const checked = draft.id === this.selectedId ? ' checked' : '';
            const publishedTone = draft.publishedCount > 0 ? 'stat-good' : 'stat-muted';
            const sourceLabel = personaSourceLabel(draft.personaSourceKind);
            const sourceTag = draft.personaSourceKind === null
                ? '<span class="dim-tag badge-draft">未设置人设</span>'
                : `<span class="dim-tag">${escapeHtml(sourceLabel)}</span>`;
            return `<label class="table-row-select">
        <input type="radio" name="selectedScenario" value="${escapeHtml(draft.id)}"${checked} />
        <span class="cell-title">${escapeHtml(draft.title)}</span>
        ${sourceTag}
        <span class="dim-tag">知识 ${draft.knowledgeCount} 条</span>
        <span class="dim-tag">评分 ${draft.scoringCount} 条</span>
        <span class="badge ${publishedTone}">已发布 ${draft.publishedCount} 版</span>
        <span class="cell-time">最近更新：${escapeHtml(formatDateTime(draft.updatedAt))}</span>
      </label>`;
        }).join('');
        return `<form data-action="scenario-op" class="select-list">
      ${rows}
      <div class="form-actions">
        <button type="submit" name="op" value="validate" class="btn btn-secondary">检查选中场景</button>
        <button type="submit" name="op" value="publish-preview" class="btn btn-secondary">发布前预览</button>
        <button type="submit" name="op" value="publish" class="btn btn-primary">发布选中场景</button>
      </div>
    </form>`;
    }
    renderSelectedDetail() {
        if (this.selectedId === null)
            return '';
        const selected = this.drafts.find((draft) => draft.id === this.selectedId);
        const detail = this.detail;
        if (selected === undefined)
            return '';
        const source = detail?.payload?.personaSource;
        let sourceSummary = '<span class="text-muted">尚未设置人设来源（发布前必须设置）</span>';
        let upgradeButton = '';
        if (source?.kind === 'template_revision') {
            const template = this.templates.find((tpl) => tpl.id === source.templateId);
            const templateName = template?.title ?? '（模板已归档或不存在）';
            const isStale = template !== undefined && typeof template.currentRevision === 'number'
                && typeof source.revision === 'number' && template.currentRevision > source.revision;
            sourceSummary = `<span>绑定模板「${escapeHtml(templateName)}」v${escapeHtml(String(source.revision))}</span>${isStale ? `<span class="dim-tag" style="background:var(--warning-bg);color:var(--warning-text)">有新版本 v${template.currentRevision}</span>` : '<span class="dim-tag">已是最新</span>'}`;
            if (isStale) {
                upgradeButton = `<form data-action="scenario-upgrade" class="inline-cancel-form"><input name="scenarioId" type="hidden" value="${escapeHtml(selected.id)}" /><button type="submit" class="btn btn-secondary btn-sm">升级到最新版本</button></form>`;
            }
        }
        else if (source?.kind === 'inline') {
            sourceSummary = '<span>独立配置人设</span>';
        }
        const agent = detail?.payload?.agentConfig ?? {};
        const agentSummary = Object.keys(agent).length === 0
            ? '<span class="text-muted">默认</span>'
            : `<span>历史消息 ${escapeHtml(String(agent.historyMessageLimit ?? '—'))} 条 · 回复 ${escapeHtml(String(agent.responseLength ?? '—'))} · 知识 ${escapeHtml(String(agent.knowledgeStrictness ?? '—'))} · 节奏 ${escapeHtml(String(agent.conversationPace ?? '—'))} · 成交 ${escapeHtml(String(agent.closingTendency ?? '—'))}</span>`;
        const previewBlock = this.previewResult !== undefined && this.previewResult.valid === false
            ? `<div class="alert alert-error" role="alert" style="margin-top:10px"><strong>发布前检查未通过</strong>${escapeHtml(this.previewResult.reason ?? '')}</div>`
            : this.previewResult !== undefined && this.previewResult.valid === true
                ? '<div class="alert alert-success" role="status" style="margin-top:10px">发布前检查通过，配置完整可发布。</div>'
                : '';
        return `<div class="inline-note" style="margin-top:12px">
      <div class="list-subtitle">「${escapeHtml(selected.title)}」配置摘要</div>
      <div class="stat-row">
        <div class="stat"><div class="stat-label">人设来源</div><div class="stat-value" style="font-size:15px">${sourceSummary}</div></div>
        <div class="stat"><div class="stat-label">AI 行为</div><div class="stat-value" style="font-size:15px">${agentSummary}</div></div>
      </div>
      ${upgradeButton}
      ${previewBlock}
    </div>`;
    }
    renderSelectedSnapshots() {
        const selected = this.drafts.find((draft) => draft.id === this.selectedId);
        if (selected === undefined)
            return '';
        const mine = this.snapshots.filter((snapshot) => snapshot.scenarioDraftId === selected.id);
        if (mine.length === 0) {
            return `<div class="inline-note">「${escapeHtml(selected.title)}」尚未发布任何版本。</div>`;
        }
        const items = mine
            .map((snapshot) => `<li><span class="dim-tag">${escapeHtml(snapshot.isActive ? '当前可用' : '已停用')}</span><span>${escapeHtml(snapshot.personaName ? `人设：${snapshot.personaName}` : '人设：—')} · ${escapeHtml(snapshot.templateRevision ? `模板 v${snapshot.templateRevision}` : '独立配置')} · 发布时间：${escapeHtml(formatDateTime(snapshot.createdAt))}</span></li>`)
            .join('');
        return `<div class="snapshot-list"><div class="list-subtitle">「${escapeHtml(selected.title)}」的已发布版本</div><ul>${items}</ul></div>`;
    }
    renderEditPanel() {
        const selected = this.drafts.find((draft) => draft.id === this.selectedId);
        const target = selected === undefined ? '（请先在上方选择一条场景）' : `「${selected.title}」`;
        return `<details class="advanced"${this.detail !== undefined ? ' open' : ''}>
      <summary>修改选中场景的草稿内容${escapeHtml(target)}</summary>
      ${this.detail !== undefined ? this.renderPersonaSourcePicker(this.detail) : ''}
      <form data-action="update-scenario" class="form-grid">
        <div class="field"><label for="sc-up-title">新的场景名称（留空则不改）</label><input id="sc-up-title" name="title" value="${escapeHtml(this.detail?.title ?? '')}" /></div>
        <div class="field"><label for="sc-up-knowledge">知识要点（每行一个，填写则整体覆盖，留空保持原值）</label><textarea id="sc-up-knowledge" name="knowledgeVersions" rows="2">${escapeHtml((this.detail?.payload?.knowledgeVersions ?? []).join('\n'))}</textarea></div>
        <div class="field"><label for="sc-up-rules">评分要点（每行一个，填写则整体覆盖，留空保持原值）</label><textarea id="sc-up-rules" name="scoringRules" rows="2">${escapeHtml((this.detail?.payload?.scoringRules ?? []).join('\n'))}</textarea></div>
        <div class="field full form-actions"><button type="submit" class="btn btn-secondary">保存对选中场景的修改</button></div>
      </form>
    </details>`;
    }
    header() {
        return `<div class="page-header"><div class="page-title">场景管理</div><div class="page-sub">把一套陪练内容沉淀为场景：草稿经检查、发布预览后成为不可变版本，供任务投放反复使用。人设来源在发布时冻结，模板后续修改不会影响已发布版本。</div></div>`;
    }
    errorBlock() {
        if (this.problem === undefined)
            return '';
        return `<div class="alert alert-error" role="alert">${escapeHtml(friendlyProblem(this.problem))}<span class="error-code">错误编号：${escapeHtml(this.problem.code)}</span></div>`;
    }
}
