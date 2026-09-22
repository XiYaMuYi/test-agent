/**
 * 评分配置管理页面（B 端运营）— v2 重新设计
 *
 * 设计：统计卡片 + 维度卡片列表（权重进度条）+ 模态框编辑 + 新增/删除维度
 */
const KNOWLEDGE_DEP_OPTIONS = [
  { v: 'none', l: '无（纯通用能力）', icon: '⚪' },
  { v: 'products', l: '产品库', icon: '📦' },
  { v: 'symptom_efficacy', l: '症状功效映射', icon: '🔗' },
  { v: 'contraindications', l: '禁忌库', icon: '⚠️' },
  { v: 'product_associations', l: '产品关联规则', icon: '🔀' },
];

export class ScoringPage {
  constructor(client) {
    this.client = client;
    this.dimensions = [];
    this.templates = [];
    this.editingId = null; // null=关闭, 'new'=新增, id=编辑维度
    this.editingTemplateId = null; // null=关闭, id=编辑模板
    this.templateDimensions = []; // 当前编辑模板的维度配置（含模板级权重）
    this.loading = false;
    this.deletingId = null;
  }

  async load() {
    this.loading = true;
    try {
      const [dims, tpls] = await Promise.all([
        this.client.get('/scoring/dimensions'),
        this.client.get('/scoring/templates'),
      ]);
      this.dimensions = dims.dimensions ?? [];
      this.templates = tpls.templates ?? [];
    } finally {
      this.loading = false;
    }
  }

  get totalWeight() { return this.dimensions.reduce((s, d) => s + (d.weight || 0), 0); }
  get configuredCount() { return this.dimensions.filter((d) => d.isConfigured).length; }

  render() {
    return `
      <div class="k-page">
        <div class="k-header">
          <div>
            <h2 class="k-title">评分配置</h2>
            <p class="k-subtitle">配置 AI 评分维度与权重。未配置的维度由 LLM 通用能力兜底评分并标注。</p>
          </div>
          <button class="k-btn k-btn-primary" data-s-action="new">
            <span class="k-btn-icon">+</span> 新增维度
          </button>
        </div>
        <div class="k-stats">
          <div class="k-stat-card">
            <div class="k-stat-value">${this.dimensions.length}</div>
            <div class="k-stat-label">评分维度</div>
          </div>
          <div class="k-stat-card">
            <div class="k-stat-value k-stat-green">${this.configuredCount}/${this.dimensions.length}</div>
            <div class="k-stat-label">已配置维度</div>
          </div>
          <div class="k-stat-card">
            <div class="k-stat-value ${this.totalWeight === 100 ? 'k-stat-green' : 'k-stat-orange'}">${this.totalWeight}%</div>
            <div class="k-stat-label">权重合计${this.totalWeight !== 100 ? '（建议100%）' : ''}</div>
          </div>
          <div class="k-stat-card">
            <div class="k-stat-value">${this.templates.length}</div>
            <div class="k-stat-label">评分模板</div>
          </div>
        </div>
        <h3 class="k-section-title">评分维度</h3>
        ${this.dimensions.length === 0 ? '<div class="k-empty"><p class="k-empty-title">暂无评分维度</p></div>' : `
          <div class="k-dim-list">
            ${this.dimensions.map((d) => this.renderDimensionCard(d)).join('')}
          </div>
        `}
        <h3 class="k-section-title">评分模板</h3>
        <div class="k-table-wrap">
          <table class="k-table">
            <thead><tr><th>模板名称</th><th>说明</th><th>评分策略</th><th>关联任务</th><th>默认</th><th>操作</th></tr></thead>
            <tbody>
              ${this.templates.map((t) => `
                <tr>
                  <td class="k-cell-bold">${this.escape(t.name)}</td>
                  <td>${this.escape(t.description || '-')}</td>
                  <td><span class="k-badge ${t.evaluationMode === 'grouped' ? 'k-badge-blue' : t.evaluationMode === 'per_dimension' ? 'k-badge-purple' : 'k-badge-gray'}">${this.evaluationModeLabel(t.evaluationMode)}</span></td>
                  <td>${t.linkedAssignmentCount ? `<span class="k-badge k-badge-blue">${t.linkedAssignmentCount}个任务</span>` : '<span style="color:#94a3b8">未使用</span>'}</td>
                  <td>${t.isDefault ? '<span class="k-badge k-badge-green">默认</span>' : ''}</td>
                  <td><button class="k-btn k-btn-ghost k-btn-sm" data-s-action="edit-template" data-template-id="${t.id}">编辑</button></td>
                </tr>
              `).join('')}
            </tbody>
          </table>
        </div>
        ${this.editingId !== null ? this.renderModal() : ''}
        ${this.editingTemplateId !== null ? this.renderTemplateModal() : ''}
      </div>
    `;
  }

  renderDimensionCard(d) {
    const isDeleting = this.deletingId === d.id;
    const weightPct = Math.min(d.weight, 100);
    return `
      <div class="k-dim-card${!d.isConfigured ? ' unconfigured' : ''}">
        <div class="k-dim-head">
          <div class="k-dim-title-row">
            <h4 class="k-dim-name">${this.escape(d.name)}</h4>
            ${d.isConfigured
              ? '<span class="k-badge k-badge-green">已配置</span>'
              : '<span class="k-badge k-badge-yellow">未配置 · LLM兜底</span>'}
          </div>
          <span class="k-dim-code">${this.escape(d.code)}</span>
        </div>
        <p class="k-dim-desc">${this.escape(d.description || '暂无说明')}</p>
        <div class="k-dim-weight-row">
          <span class="k-dim-weight-label">权重</span>
          <div class="k-dim-weight-bar"><div class="k-dim-weight-fill" style="width:${weightPct}%"></div></div>
          <span class="k-dim-weight-value">${d.weight}%</span>
        </div>
        <div class="k-dim-meta">
          <div class="k-dim-meta-item">
            <span class="k-dim-meta-label">知识依赖</span>
            <span>${(d.knowledgeDependencies ?? []).map((k) => {
              const opt = KNOWLEDGE_DEP_OPTIONS.find((o) => o.v === k);
              return `<span class="k-tag ${k === 'none' ? 'k-tag-gray' : 'k-tag-blue'}">${opt ? opt.icon + ' ' + opt.l : this.escape(k)}</span>`;
            }).join(' ') || '<span class="k-tag k-tag-gray">未设置</span>'}</span>
          </div>
          <div class="k-dim-meta-item">
            <span class="k-dim-meta-label">分级标准</span>
            <span class="k-dim-grades">
              S≥${d.gradingRubric?.excellent ?? 90} ·
              A≥${d.gradingRubric?.good ?? 80} ·
              B≥${d.gradingRubric?.fair ?? 70} ·
              C≥${d.gradingRubric?.pass ?? 60}
            </span>
          </div>
        </div>
        ${(d.keywords ?? []).length > 0 ? `<div class="k-dim-keywords"><span class="k-dim-meta-label">参考关键词</span>${(d.keywords ?? []).map((k) => `<span class="k-tag k-tag-gray">${this.escape(k)}</span>`).join(' ')}</div>` : ''}
        <div class="k-dim-actions">
          <button class="k-btn k-btn-ghost" data-s-edit="${d.id}">✏️ 编辑</button>
          <button class="k-btn k-btn-danger${isDeleting ? ' confirming' : ''}" data-s-delete="${d.id}">
            ${isDeleting ? '确认删除？' : '🗑️ 删除'}
          </button>
        </div>
      </div>
    `;
  }

  renderModal() {
    const isNew = this.editingId === 'new';
    const d = isNew ? {
      name: '', code: '', description: '', weight: 10, isConfigured: false,
      knowledgeDependencies: ['none'], llmPrompt: '', keywords: [],
      gradingRubric: { excellent: 90, good: 80, fair: 70, pass: 60 },
    } : this.dimensions.find((x) => x.id === this.editingId) ?? {};
    return `
      <div class="k-modal-overlay" data-s-modal-close>
        <div class="k-modal k-modal-wide" onclick="event.stopPropagation()">
          <div class="k-modal-head">
            <h3>${isNew ? '新增评分维度' : '编辑评分维度'}</h3>
            <button class="k-modal-close" data-s-action="close">×</button>
          </div>
          <form class="k-modal-body" id="s-dim-form">
            <div class="k-form-group">
              <label>维度名称 <span class="k-required">*</span></label>
              <input type="text" name="name" value="${this.escape(d.name || '')}" placeholder="如：产品推荐准确性" required autocomplete="off" />
            </div>
            <div class="k-form-group">
              <label>维度说明</label>
              <textarea name="description" rows="2" placeholder="描述这个维度考察学员的什么能力" autocomplete="off">${this.escape(d.description || '')}</textarea>
            </div>
            <div class="k-form-row">
              <div class="k-form-group">
                <label>权重 (%)</label>
                <input type="number" name="weight" value="${d.weight ?? 10}" min="0" max="100" autocomplete="off" />
              </div>
              <div class="k-form-group">
                <label>配置状态</label>
                <select name="isConfigured" autocomplete="off">
                  <option value="true"${d.isConfigured ? ' selected' : ''}>已配置（按配置+知识库评分）</option>
                  <option value="false"${!d.isConfigured ? ' selected' : ''}>未配置（LLM 通用能力兜底）</option>
                </select>
              </div>
            </div>
            <div class="k-form-group">
              <label>知识依赖（多选）</label>
              <div class="k-chip-group">
                ${KNOWLEDGE_DEP_OPTIONS.map((o) => `
                  <label class="k-chip${(d.knowledgeDependencies ?? []).includes(o.v) ? ' selected' : ''}">
                    <input type="checkbox" name="knowledgeDependencies" value="${o.v}"${(d.knowledgeDependencies ?? []).includes(o.v) ? ' checked' : ''} />
                    ${o.icon} ${o.l}
                  </label>
                `).join('')}
              </div>
            </div>
            <div class="k-form-group">
              <label>LLM 评分引导语（可选，为空时用通用引导）</label>
              <textarea name="llmPrompt" rows="3" placeholder="如：重点关注学员是否根据客户肤质推荐对症产品，错误推荐需大幅扣分" autocomplete="off">${this.escape(d.llmPrompt || '')}</textarea>
            </div>
            <div class="k-form-group">
              <label>参考词（逗号分隔）<span class="k-form-hint">仅供 AI 理解语境，不按是否命中给分/扣分</span></label>
              <input type="text" name="keywords" value="${(d.keywords ?? []).join(',')}" placeholder="如：补水,保湿,玻尿酸（可留空）" autocomplete="off" />
            </div>
            <h4 class="k-form-subtitle">分级标准（S/A/B/C/D）</h4>
            <div class="k-form-row k-form-row-4">
              <div class="k-form-group">
                <label>S 级下限</label>
                <input type="number" name="rubric_excellent" value="${d.gradingRubric?.excellent ?? 90}" autocomplete="off" />
              </div>
              <div class="k-form-group">
                <label>A 级下限</label>
                <input type="number" name="rubric_good" value="${d.gradingRubric?.good ?? 80}" autocomplete="off" />
              </div>
              <div class="k-form-group">
                <label>B 级下限</label>
                <input type="number" name="rubric_fair" value="${d.gradingRubric?.fair ?? 70}" autocomplete="off" />
              </div>
              <div class="k-form-group">
                <label>C 级下限（及格线）</label>
                <input type="number" name="rubric_pass" value="${d.gradingRubric?.pass ?? 60}" autocomplete="off" />
              </div>
            </div>
          </form>
          <div class="k-modal-foot">
            <button class="k-btn k-btn-ghost" data-s-action="close">取消</button>
            <button class="k-btn k-btn-primary" data-s-action="save">${isNew ? '创建维度' : '保存修改'}</button>
          </div>
        </div>
      </div>
    `;
  }

  evaluationModeLabel(mode) {
    const labels = { grouped: '分组调用（推荐）', per_dimension: '每维度独立', single: '单次全量' };
    return labels[mode] || '分组调用（推荐）';
  }

  /** 加载指定模板的维度配置（含模板级权重），用于编辑模态框。 */
  async loadTemplateDimensions(templateId) {
    try {
      const result = await this.client.get(`/scoring/templates/${templateId}/dimensions`);
      this.templateDimensions = result.dimensions ?? [];
    } catch {
      this.templateDimensions = [];
    }
  }

  renderTemplateModal() {
    const t = this.templates.find((x) => x.id === this.editingTemplateId);
    if (!t) return '';
    const selectedIds = new Set(this.templateDimensions.map((d) => d.dimensionId));
    const weightMap = new Map(this.templateDimensions.map((d) => [d.dimensionId, d.templateWeight]));
    return `
      <div class="k-modal-overlay" data-s-modal-close>
        <div class="k-modal k-modal-lg" onclick="event.stopPropagation()">
          <div class="k-modal-head">
            <h3>编辑评分模板</h3>
            <button class="k-modal-close" data-s-action="close-template">×</button>
          </div>
          <form class="k-modal-body" id="s-tpl-form">
            <div class="k-form-row">
              <div class="k-form-group">
                <label>模板名称</label>
                <input type="text" name="name" value="${this.escape(t.name)}" required autocomplete="off" />
              </div>
              <div class="k-form-group">
                <label>评分策略</label>
                <select name="evaluationMode" autocomplete="off">
                  <option value="grouped"${t.evaluationMode === 'grouped' ? ' selected' : ''}>分组调用（推荐）</option>
                  <option value="per_dimension"${t.evaluationMode === 'per_dimension' ? ' selected' : ''}>每维度独立</option>
                  <option value="single"${t.evaluationMode === 'single' ? ' selected' : ''}>单次全量</option>
                </select>
              </div>
            </div>
            <div class="k-form-group">
              <label>模板说明</label>
              <textarea name="description" rows="2" placeholder="描述这个评分模板的适用场景" autocomplete="off">${this.escape(t.description || '')}</textarea>
            </div>
            <div class="k-form-group">
              <label>教练点评引导语 <span class="k-form-hint">可选，为空时用通用引导</span></label>
              <textarea name="coachCommentPrompt" rows="2" placeholder="如：重点关注学员在产品推荐准确性上的表现" autocomplete="off">${this.escape(t.coachCommentPrompt || '')}</textarea>
            </div>

            <div class="k-form-group">
              <label>维度组合 <span class="k-form-hint">自由勾选本模板包含哪些维度；权重留空则使用维度全局权重</span></label>
              <div class="k-tpl-dim-list">
                ${this.dimensions.map((d, idx) => {
                  const checked = selectedIds.has(d.id);
                  const tplWeight = weightMap.get(d.id);
                  const weightValue = tplWeight !== null && tplWeight !== undefined ? tplWeight : '';
                  return `
                  <div class="k-tpl-dim-row${checked ? ' selected' : ''}">
                    <label class="k-tpl-dim-check">
                      <input type="checkbox" name="tpl_dim_${d.id}" value="${d.id}"${checked ? ' checked' : ''} data-dim-index="${idx}" />
                      <span class="k-tpl-dim-name">${this.escape(d.name)}</span>
                      <span class="k-tpl-dim-code">${this.escape(d.code)}</span>
                      ${d.isConfigured ? '<span class="k-badge k-badge-green" style="margin-left:6px">已配置</span>' : '<span class="k-badge k-badge-yellow" style="margin-left:6px">LLM兜底</span>'}
                    </label>
                    <div class="k-tpl-dim-weight">
                      <span class="k-tpl-dim-global">全局${d.weight}%</span>
                      <input type="number" name="tpl_weight_${d.id}" min="0" max="100" value="${weightValue}" placeholder="覆盖权重" class="k-tpl-weight-input" ${checked ? '' : 'disabled'} />
                      <span class="k-tpl-dim-effective">→ ${weightValue !== '' ? weightValue + '%' : d.weight + '%'}</span>
                    </div>
                  </div>`;
                }).join('')}
              </div>
              <div class="k-form-hint" style="margin-top:8px">已选 <span id="tpl-dim-count">${selectedIds.size}</span> / ${this.dimensions.length} 个维度</div>
            </div>
          </form>
          <div class="k-modal-foot">
            <button class="k-btn k-btn-ghost" data-s-action="close-template">取消</button>
            <button class="k-btn k-btn-primary" data-s-action="save-template">保存修改</button>
          </div>
        </div>
      </div>
    `;
  }

  escape(str) {
    return String(str ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }
}
