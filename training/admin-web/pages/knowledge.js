/**
 * 产品知识库管理页面（B 端运营）— v2 重新设计
 *
 * 设计：卡片列表 + 搜索筛选 + 模态框编辑 + 完整 CRUD
 */
const SKIN_TYPE_LABELS = { dry: '干性', oily: '油性', combination: '混合', sensitive: '敏感', normal: '中性' };
const CATEGORY_OPTIONS = [
  // 护肤化妆品
  '精华', '面霜', '乳液', '爽肤水', '洁面', '面膜', '眼霜', '防晒', '身体乳', '洗发水', '护发素', '套装', '仪器',
  // 保健品/膳食补充剂
  '维生素/矿物质', '蛋白粉', '鱼油/Omega3', '益生菌', '胶原蛋白肽', '酵素', '膳食纤维', '草本提取物', '功能性饮品', '代餐/食品',
  // 其他
  '其他'
];
const EFFICACY_OPTIONS = [
  // 护肤功效
  '补水保湿', '屏障修护', '舒缓敏感', '控油祛痘', '抗皱紧致',
  '提亮美白', '收缩毛孔', '去角质', '防晒防护', '眼部护理',
  '身体护理', '头皮护理',
  // 保健功效
  '增强免疫力', '改善睡眠', '缓解疲劳', '调节肠胃', '抗氧化',
  '抗衰老', '补钙健骨', '护肝', '护眼', '改善记忆',
  '补充能量', '调节内分泌', '美容养颜(内服)', '减肥瘦身',
];
const SCENARIO_OPTIONS = [
  // 生活方式
  '熬夜党', '长期加班', '健身人群', '素食者',
  // 健康状态
  '亚健康人群', '免疫力低下', '肠胃不适', '睡眠不好',
  // 年龄/生理阶段
  '青少年', '中年人群', '老年人群', '更年期女性', '孕期/哺乳期',
  // 其他
  '术后康复', '换季敏感', '换季干燥',
];

export class KnowledgePage {
  constructor(client) {
    this.client = client;
    this.products = [];
    this.symptomMappings = [];
    this.contraindications = [];
    this.tab = 'products';
    this.search = '';
    this.filterCategory = '';
    this.editingProduct = null; // null=关闭, 'new'=新增, product=编辑
    this.loading = false;
    this.deletingId = null;
  }

  async load() {
    this.loading = true;
    try {
      const [products, mappings, cis] = await Promise.all([
        this.client.get('/knowledge/products'),
        this.client.get('/knowledge/symptom-efficacy'),
        this.client.get('/knowledge/contraindications'),
      ]);
      this.products = products.products ?? [];
      this.symptomMappings = mappings.mappings ?? [];
      this.contraindications = cis.contraindications ?? [];
    } finally {
      this.loading = false;
    }
  }

  get filteredProducts() {
    let list = this.products;
    if (this.search) {
      const q = this.search.toLowerCase();
      list = list.filter((p) =>
        p.name.toLowerCase().includes(q) ||
        (p.aliases ?? []).some((a) => a.toLowerCase().includes(q)) ||
        (p.coreEfficacies ?? []).some((e) => e.toLowerCase().includes(q))
      );
    }
    if (this.filterCategory) list = list.filter((p) => p.category === this.filterCategory);
    return list;
  }

  render() {
    return `
      <div class="k-page">
        <div class="k-header">
          <div>
            <h2 class="k-title">产品知识库</h2>
            <p class="k-subtitle">录入神首集团产品知识，作为 AI 评分的知识依赖。未录入时评分维度自动兜底。</p>
          </div>
          <button class="k-btn k-btn-primary" data-k-action="new">
            <span class="k-btn-icon">+</span> 新增产品
          </button>
        </div>
        <div class="k-tabs">
          <button class="k-tab${this.tab === 'products' ? ' active' : ''}" data-k-tab="products">产品库 <span class="k-tab-count">${this.products.length}</span></button>
          <button class="k-tab${this.tab === 'symptoms' ? ' active' : ''}" data-k-tab="symptoms">症状功效映射 <span class="k-tab-count">${this.symptomMappings.length}</span></button>
          <button class="k-tab${this.tab === 'contra' ? ' active' : ''}" data-k-tab="contra">禁忌库 <span class="k-tab-count">${this.contraindications.length}</span></button>
        </div>
        ${this.tab === 'products' ? this.renderProductsTab() : ''}
        ${this.tab === 'symptoms' ? this.renderSymptomsTab() : ''}
        ${this.tab === 'contra' ? this.renderContraTab() : ''}
        ${this.editingProduct ? this.renderModal() : ''}
      </div>
    `;
  }

  renderProductsTab() {
    if (this.products.length === 0) {
      return `
        <div class="k-empty">
          <div class="k-empty-icon">📦</div>
          <p class="k-empty-title">暂无产品数据</p>
          <p class="k-empty-desc">点击右上角「新增产品」录入神首集团产品知识</p>
        </div>
      `;
    }
    const categories = [...new Set(this.products.map((p) => p.category))];
    return `
      <div class="k-toolbar">
        <div class="k-search">
          <span class="k-search-icon">🔍</span>
          <input type="text" placeholder="搜索产品名称、别名、功效…" value="${this.escape(this.search)}" data-k-search autocomplete="off" />
        </div>
        <select class="k-select" data-k-filter>
          <option value="">全部品类</option>
          ${categories.map((c) => `<option value="${c}"${this.filterCategory === c ? ' selected' : ''}>${c}</option>`).join('')}
        </select>
        <span class="k-result-count">共 ${this.filteredProducts.length} 个产品</span>
      </div>
      ${this.filteredProducts.length === 0 ? '<div class="k-empty"><p class="k-empty-title">没有匹配的产品</p></div>' : `
        <div class="k-card-grid">
          ${this.filteredProducts.map((p) => this.renderProductCard(p)).join('')}
        </div>
      `}
    `;
  }

  renderProductCard(p) {
    const isDeleting = this.deletingId === p.id;
    return `
      <div class="k-product-card${p.status !== 'active' ? ' inactive' : ''}">
        <div class="k-product-head">
          <div class="k-product-cat">${this.escape(p.category)}</div>
          ${p.status === 'active' ? '<span class="k-badge k-badge-green">启用</span>' : '<span class="k-badge k-badge-gray">停用</span>'}
        </div>
        <h3 class="k-product-name">${this.escape(p.name)}</h3>
        ${(p.aliases ?? []).length > 0 ? `<p class="k-product-aliases">别名：${(p.aliases ?? []).map((a) => this.escape(a)).join('、')}</p>` : ''}
        <div class="k-product-tags">
          ${(p.coreEfficacies ?? []).slice(0, 4).map((e) => `<span class="k-tag k-tag-blue">${this.escape(e)}</span>`).join('')}
          ${(p.coreEfficacies ?? []).length > 4 ? `<span class="k-tag k-tag-gray">+${(p.coreEfficacies ?? []).length - 4}</span>` : ''}
        </div>
        <div class="k-product-meta">
          <span>🧴 ${(p.suitableSkinTypes ?? []).map((s) => SKIN_TYPE_LABELS[s] || s).join('、') || '未设置'}</span>
          <span>👥 ${(p.suitableScenarios ?? []).join('、') || '未设置'}</span>
          <span>💰 ${this.escape(p.priceRange || '未设置')}</span>
        </div>
        ${p.keySellingPoints ? `<p class="k-product-selling">${this.escape(p.keySellingPoints)}</p>` : ''}
        <div class="k-product-actions">
          <button class="k-btn k-btn-ghost" data-k-edit="${p.id}">✏️ 编辑</button>
          <button class="k-btn k-btn-danger${isDeleting ? ' confirming' : ''}" data-k-delete="${p.id}">
            ${isDeleting ? '确认删除？' : '🗑️ 删除'}
          </button>
        </div>
      </div>
    `;
  }

  renderSymptomsTab() {
    if (this.symptomMappings.length === 0) {
      return `<div class="k-empty"><div class="k-empty-icon">🔗</div><p class="k-empty-title">暂无症状功效映射</p><p class="k-empty-desc">后续可通过 API 批量导入客户表达→功效需求的映射规则</p></div>`;
    }
    return `
      <div class="k-table-wrap">
        <table class="k-table">
          <thead><tr><th>客户表达关键词</th><th>对应功效需求</th><th>严重度权重</th></tr></thead>
          <tbody>
            ${this.symptomMappings.map((m) => `
              <tr>
                <td>${(m.customerExpressions ?? []).map((e) => `<span class="k-tag k-tag-orange">${this.escape(e)}</span>`).join(' ')}</td>
                <td><span class="k-tag k-tag-green">${this.escape(m.efficacyNeed)}</span></td>
                <td><span class="k-weight">${m.severityWeight}</span></td>
              </tr>
            `).join('')}
          </tbody>
        </table>
      </div>
    `;
  }

  renderContraTab() {
    if (this.contraindications.length === 0) {
      return `<div class="k-empty"><div class="k-empty-icon">⚠️</div><p class="k-empty-title">暂无禁忌规则</p><p class="k-empty-desc">后续可录入敏感肌/孕妇等禁忌推荐规则，命中时评分自动降分</p></div>`;
    }
    return `
      <div class="k-table-wrap">
        <table class="k-table">
          <thead><tr><th>客户条件</th><th>禁止成分</th><th>原因</th><th>严重度</th></tr></thead>
          <tbody>
            ${this.contraindications.map((c) => `
              <tr>
                <td class="k-cell-bold">${this.escape(c.customerCondition)}</td>
                <td>${(c.forbiddenIngredients ?? []).map((i) => `<span class="k-tag k-tag-red">${this.escape(i)}</span>`).join(' ')}</td>
                <td>${this.escape(c.reason)}</td>
                <td><span class="k-badge ${c.severity === 'critical' ? 'k-badge-red' : 'k-badge-yellow'}">${c.severity === 'critical' ? '严重' : '警告'}</span></td>
              </tr>
            `).join('')}
          </tbody>
        </table>
      </div>
    `;
  }

  renderModal() {
    const isNew = this.editingProduct === 'new';
    const p = isNew ? {
      name: '', aliases: [], category: '精华', coreEfficacies: [], suitableSkinTypes: [], suitableScenarios: [],
      priceRange: '', keyIngredients: [], keySellingPoints: '', contraindicatedAudience: '',
    } : this.editingProduct;
    return `
      <div class="k-modal-overlay" data-k-modal-close>
        <div class="k-modal" onclick="event.stopPropagation()">
          <div class="k-modal-head">
            <h3>${isNew ? '新增产品' : '编辑产品'}</h3>
            <button class="k-modal-close" data-k-action="close">×</button>
          </div>
          <form class="k-modal-body" id="k-product-form">
            <div class="k-form-row">
              <div class="k-form-group">
                <label>产品名称 <span class="k-required">*</span></label>
                <input type="text" name="name" value="${this.escape(p.name)}" placeholder="如：神首修护精华" autocomplete="off" required />
              </div>
              <div class="k-form-group">
                <label>品类</label>
                <select name="category">
                  ${CATEGORY_OPTIONS.map((c) => `<option value="${c}"${p.category === c ? ' selected' : ''}>${c}</option>`).join('')}
                </select>
              </div>
            </div>
            <div class="k-form-group">
              <label>别名（逗号分隔，用于学员话术中的模糊匹配）</label>
              <input type="text" name="aliases" value="${(p.aliases ?? []).join(',')}" placeholder="如：修护精华,小棕瓶" autocomplete="off" />
            </div>
            <div class="k-form-group">
              <label>核心功效（按住 Ctrl/Cmd 多选）</label>
              <div class="k-chip-group">
                ${EFFICACY_OPTIONS.map((e) => `
                  <label class="k-chip${(p.coreEfficacies ?? []).includes(e) ? ' selected' : ''}">
                    <input type="checkbox" name="coreEfficacies" value="${e}"${(p.coreEfficacies ?? []).includes(e) ? ' checked' : ''} />
                    ${e}
                  </label>
                `).join('')}
              </div>
            </div>
            <div class="k-form-row">
              <div class="k-form-group">
                <label>适用肤质（护肤类产品）</label>
                <div class="k-chip-group">
                  ${Object.entries(SKIN_TYPE_LABELS).map(([v, l]) => `
                    <label class="k-chip${(p.suitableSkinTypes ?? []).includes(v) ? ' selected' : ''}">
                      <input type="checkbox" name="suitableSkinTypes" value="${v}"${(p.suitableSkinTypes ?? []).includes(v) ? ' checked' : ''} />
                      ${l}
                    </label>
                  `).join('')}
                </div>
              </div>
              <div class="k-form-group">
                <label>价格区间</label>
                <input type="text" name="priceRange" value="${this.escape(p.priceRange || '')}" placeholder="如：200-500元" autocomplete="off" />
              </div>
            </div>
            <div class="k-form-group">
              <label>适用场景/人群（保健品主要使用，护肤类可辅助）</label>
              <div class="k-chip-group">
                ${SCENARIO_OPTIONS.map((s) => `
                  <label class="k-chip${(p.suitableScenarios ?? []).includes(s) ? ' selected' : ''}">
                    <input type="checkbox" name="suitableScenarios" value="${s}"${(p.suitableScenarios ?? []).includes(s) ? ' checked' : ''} />
                    ${s}
                  </label>
                `).join('')}
              </div>
            </div>
            <div class="k-form-group">
              <label>主要成分（逗号分隔）</label>
              <input type="text" name="keyIngredients" value="${(p.keyIngredients ?? []).join(',')}" placeholder="如：神经酰胺,角鲨烷,积雪草" autocomplete="off" />
            </div>
            <div class="k-form-group">
              <label>核心卖点（FAB 话术参考）</label>
              <textarea name="keySellingPoints" rows="2" placeholder="如：三重修护，敏感肌可用，7天改善泛红" autocomplete="off">${this.escape(p.keySellingPoints || '')}</textarea>
            </div>
            <div class="k-form-group">
              <label>禁忌人群描述</label>
              <input type="text" name="contraindicatedAudience" value="${this.escape(p.contraindicatedAudience || '')}" placeholder="如：孕妇禁用，敏感肌急性期禁用" autocomplete="off" />
            </div>
          </form>
          <div class="k-modal-foot">
            <button class="k-btn k-btn-ghost" data-k-action="close">取消</button>
            <button class="k-btn k-btn-primary" data-k-action="save">${isNew ? '创建产品' : '保存修改'}</button>
          </div>
        </div>
      </div>
    `;
  }

  escape(str) {
    return String(str ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }
}
