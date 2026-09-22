import { AdminApiClient, AdminApiProblem, escapeHtml, } from '../api/client.js';
import {
    brandLoyaltyLabel,
    buildTemplateName,
    closingTendencyLabel,
    communicationStyleLabel,
    competitorComparisonLabel,
    conversationPaceLabel,
    decisionCycleLabel,
    dialectLabel,
    difficultyLabel,
    emotionLevelLabel,
    formatDateTime,
    genderLabel,
    incomeLevelLabel,
    ingredientFocusLabel,
    knowledgeStrictnessLabel,
    labelOf,
    maritalStatusLabel,
    openingModeLabel,
    overrideModeLabel,
    personalityTraitLabel,
    purchaseChannelLabel,
    responseLengthLabel,
    shortId,
    skinTypeLabel,
    summarizePersona,
    templateStatusLabel,
    verbosityLabel,
} from '../labels.js';
const FILTERS = [
    { value: 'active', label: '生效中' },
    { value: 'archived', label: '已归档' },
    { value: 'all', label: '全部' },
];
/**
 * 旧 8 个平铺产品场景 → 新 5 大类的分组映射（展示层辅助，与 contracts
 * PRODUCT_SCENARIO_LEGACY_CATEGORY_MAP 保持一致；后端 meta 后续暴露后可切换为动态数据）。
 */
const LEGACY_SCENARIO_CATEGORY = Object.freeze({
    'anti-aging': 'daily-skincare',
    'whitening': 'daily-skincare',
    'acne': 'problem-skin',
    'health': 'wellness',
    'weight-loss': 'wellness',
    'body-care': 'bath-body',
    'sensitive': 'problem-skin',
    'hair-care': 'bath-body',
});
const FRIENDLY_ERRORS = {
    TEMPLATE_TITLE_CONFLICT: '已存在同名模板，请换一个名称后再试。',
    PERSONA_CONFIG_INVALID: '客户画像校验未通过，请检查年龄、性格参数、必填文本与各项枚举后重试。',
    AGENT_CONFIG_INVALID: 'AI 行为配置校验未通过，请检查历史消息条数与各项枚举。',
    LEARNER_OVERRIDE_POLICY_INVALID: 'C 端覆盖策略校验未通过，请检查白名单路径。',
    TEMPLATE_REVISION_NOT_FOUND: '未找到该模板版本，可能已被清理，请刷新后重试。',
    TEMPLATE_ARCHIVED: '该模板已归档，请先重新启用后再编辑。',
    MODEL_UPSTREAM_UNAVAILABLE: '智能服务暂时不可用，请稍后重试。',
    MODEL_TIMEOUT: '智能服务响应超时，请稍后重试。',
};
function friendlyProblem(problem) {
    return FRIENDLY_ERRORS[problem.code] ?? '操作未成功，请检查后重试。';
}
/** 把当前模板行转成完整编辑器的初始值（含各子块与 AI 行为、C 端策略）。 */
function editorStateFromTemplate(item) {
    const persona = item.personaConfig ?? {};
    const conversation = persona.conversation ?? {};
    const consumption = persona.consumption ?? {};
    const communication = persona.communication ?? {};
    const personality = persona.personality ?? {};
    const basic = persona.basic ?? {};
    const agent = item.agentConfig ?? {};
    const policy = item.learnerOverridePolicy ?? {};
    return {
        title: item.title,
        name: persona.name ?? '',
        age: persona.age ?? 30,
        gender: persona.gender ?? 'female',
        occupation: persona.occupation ?? '',
        basic_maritalStatus: basic.maritalStatus ?? 'unknown',
        basic_incomeLevel: basic.incomeLevel ?? 'medium',
        basic_customerRelation: basic.customerRelation ?? '',
        basic_trustLevel: basic.trustLevel ?? '',
        basic_customerCohort: basic.customerCohort ?? '',
        basic_city: basic.city ?? '',
        basic_purchaseCategory: basic.purchaseCategory ?? '',
        personality_friendliness: personality.friendliness ?? 50,
        personality_patience: personality.patience ?? 50,
        personality_priceSensitivity: personality.priceSensitivity ?? 50,
        personality_decisiveness: personality.decisiveness ?? 50,
        personality_skepticism: personality.skepticism ?? 40,
        personality_socialActivity: personality.socialActivity ?? 50,
        personality_emotionalVolatility: personality.emotionalVolatility ?? 50,
        communication_style: communication.style ?? 'gentle',
        communication_verbosity: communication.verbosity ?? 'normal',
        communication_emotionLevel: communication.emotionLevel ?? 'normal',
        communication_dialect: communication.dialect ?? 'mandarin',
        communication_catchphrase: communication.catchphrase ?? '',
        consumption_budgetMin: consumption.budgetMin ?? 100,
        consumption_budgetMax: consumption.budgetMax ?? 500,
        consumption_decisionCycle: consumption.decisionCycle ?? 'same_day',
        consumption_brandLoyalty: consumption.brandLoyalty ?? 'medium',
        consumption_skinType: consumption.skinType ?? 'normal',
        consumption_skinConcerns: (consumption.skinConcerns ?? []).join('\n'),
        consumption_healthGoals: (consumption.healthGoals ?? []).join('\n'),
        consumption_purchaseChannel: consumption.purchaseChannel ?? 'wechat_private',
        consumption_ingredientFocus: consumption.ingredientFocus ?? 'normal',
        consumption_competitorComparison: consumption.competitorComparison ?? 'occasionally',
        consumption_allergies: (consumption.allergies ?? []).join('\n'),
        consumption_currentProducts: consumption.currentProducts ?? '',
        conversation_difficulty: conversation.difficulty ?? 2,
        conversation_maxTurns: conversation.maxTurns ?? 15,
        conversation_background: conversation.background ?? '',
        conversation_productScenario: conversation.productScenario ?? '',
        conversation_openingMode: conversation.openingMode ?? 'ai_first',
        conversation_customNotes: conversation.customNotes ?? '',
        knowledge: (item.knowledgeVersions ?? []).join('\n'),
        rules: (item.scoringRules ?? []).join('\n'),
        agent_historyMessageLimit: agent.historyMessageLimit ?? 20,
        agent_responseLength: agent.responseLength ?? 'normal',
        agent_knowledgeStrictness: agent.knowledgeStrictness ?? 'balanced',
        agent_conversationPace: agent.conversationPace ?? 'normal',
        agent_closingTendency: agent.closingTendency ?? 'neutral',
        agent_additionalInstructions: agent.additionalInstructions ?? '',
        policy_visible: policy.visible !== false,
        policy_recommended: policy.recommended === true,
        policy_mode: policy.mode ?? 'all',
        policy_allowedPaths: (Array.isArray(policy.allowedPaths) ? policy.allowedPaths : []).join('\n'),
        recommendedScoringTemplateIds: Array.isArray(item.recommendedScoringTemplateIds) ? item.recommendedScoringTemplateIds : [],
    };
}
export class TemplatePage {
    api;
    problem;
    fieldError;
    status;
    items = [];
    catalog;
    meta;
    filter = 'active';
    editingId;
    /** 完整编辑器状态（新建时为未持久化的空状态，编辑时为该行当前值）。 */
    editorState;
    /** revision 治理面板：正在查看的模板 id 与面板类型。 */
    panelId;
    panelType;
    revisions = [];
    bindings = [];
    diffItems = [];
    diffFrom;
    diffTo;
    scoringTemplates = [];
    constructor(api) {
        this.api = api;
    }
    /** 拉取业务选项目录、配置元数据与现有模板；目录失败不阻塞列表展示。 */
    async load() {
        try {
            const [catalog, meta] = await Promise.all([
                this.api.getPersonaPresets().catch((error) => {
                    if (error instanceof AdminApiProblem)
                        this.problem = error;
                    else
                        throw error;
                    return undefined;
                }),
                this.api.getConfigMeta().catch((error) => {
                    if (error instanceof AdminApiProblem)
                        this.problem = error;
                    else
                        throw error;
                    return undefined;
                }),
            ]);
            if (catalog !== undefined)
                this.catalog = catalog;
            if (meta !== undefined)
                this.meta = meta;
            const scoringTpls = await this.api.get('/scoring/templates').catch(() => ({ templates: [] }));
            this.scoringTemplates = Array.isArray(scoringTpls?.templates) ? scoringTpls.templates : [];
        }
        catch (error) {
            if (error instanceof AdminApiProblem)
                this.problem = error;
            else
                throw error;
        }
        await this.loadList();
    }
    async ensureCatalog() {
        if (this.catalog === undefined)
            this.catalog = await this.api.getPersonaPresets();
        if (this.meta === undefined)
            this.meta = await this.api.getConfigMeta();
    }
    async loadList() {
        try {
            this.items = await this.api.listOrganizationTemplates(this.filter);
        }
        catch (error) {
            if (error instanceof AdminApiProblem)
                this.problem = error;
            else
                throw error;
        }
    }
    /** 切换状态筛选并重新拉取；切换时退出编辑态。 */
    async setFilter(filter) {
        if (filter === this.filter)
            return;
        this.filter = filter;
        this.editingId = undefined;
        this.panelId = undefined;
        await this.loadList();
    }
    /** 行动作统一入口：编辑切本地完整编辑器，其余请求后端后刷新。 */
    async rowOp(id, op) {
        if (op === 'edit') {
            await this.beginEdit(id);
            return;
        }
        if (op === 'duplicate') {
            await this.runRowOp(id, async () => {
                const updated = await this.api.duplicateOrganizationTemplate(id);
                this.status = `已复制为「${escapeHtml(updated.title)}」（新模板版本从 1 开始），可在列表中查看。`;
            });
            return;
        }
        if (op === 'history') {
            await this.openPanel(id, 'history');
            return;
        }
        if (op === 'bindings') {
            await this.openPanel(id, 'bindings');
            return;
        }
        this.problem = undefined;
        this.fieldError = undefined;
        this.status = undefined;
        try {
            if (op === 'archive') {
                const updated = await this.api.archiveOrganizationTemplate(id);
                this.status = `模板「${escapeHtml(updated.title)}」已归档，主播端不再展示，历史练习记录仍保留。`;
            }
            else {
                const updated = await this.api.activateOrganizationTemplate(id);
                this.status = `模板「${escapeHtml(updated.title)}」已重新启用，主播端可再次选用。`;
            }
            this.editingId = undefined;
            await this.loadList();
        }
        catch (error) {
            if (error instanceof AdminApiProblem)
                this.problem = error;
            else
                throw error;
        }
    }
    async runRowOp(id, request) {
        this.problem = undefined;
        this.fieldError = undefined;
        this.status = undefined;
        try {
            await request();
            this.editingId = undefined;
            await this.loadList();
        }
        catch (error) {
            if (error instanceof AdminApiProblem)
                this.problem = error;
            else
                throw error;
        }
    }
    async beginEdit(id) {
        const item = this.items.find((entry) => entry.id === id);
        if (item === undefined)
            return;
        this.editingId = id;
        this.problem = undefined;
        this.fieldError = undefined;
        this.editorState = editorStateFromTemplate(item);
        await this.ensureCatalog();
    }
    /** 新建完整模板：进入空编辑器。 */
    async beginCreate() {
        this.editingId = null;
        this.panelId = undefined;
        this.problem = undefined;
        this.fieldError = undefined;
        this.editorState = {
            title: '',
            name: '',
            age: 30,
            gender: 'female',
            occupation: '白领',
            basic_maritalStatus: 'unknown',
            basic_incomeLevel: 'medium',
            basic_customerRelation: '',
            basic_trustLevel: '',
            basic_customerCohort: '',
            basic_city: '',
            basic_purchaseCategory: '',
            personality_friendliness: 50,
            personality_patience: 50,
            personality_priceSensitivity: 50,
            personality_decisiveness: 50,
            personality_skepticism: 40,
            personality_socialActivity: 50,
            personality_emotionalVolatility: 50,
            communication_style: 'gentle',
            communication_verbosity: 'normal',
            communication_emotionLevel: 'normal',
            communication_dialect: 'mandarin',
            communication_catchphrase: '',
            consumption_budgetMin: 100,
            consumption_budgetMax: 500,
            consumption_decisionCycle: 'same_day',
            consumption_brandLoyalty: 'medium',
            consumption_skinType: 'normal',
            consumption_skinConcerns: '',
            consumption_healthGoals: '',
            consumption_purchaseChannel: 'wechat_private',
            consumption_ingredientFocus: 'normal',
            consumption_competitorComparison: 'occasionally',
            consumption_allergies: '',
            consumption_currentProducts: '',
            conversation_difficulty: 2,
            conversation_maxTurns: 15,
            conversation_background: '',
            conversation_productScenario: '',
            conversation_openingMode: 'ai_first',
            conversation_customNotes: '',
            knowledge: '',
            rules: '',
            agent_historyMessageLimit: 20,
            agent_responseLength: 'normal',
            agent_knowledgeStrictness: 'balanced',
            agent_conversationPace: 'normal',
            agent_closingTendency: 'neutral',
            agent_additionalInstructions: '',
            policy_visible: true,
            policy_recommended: false,
            policy_mode: 'all',
            policy_allowedPaths: '',
            recommendedScoringTemplateIds: [],
        };
        await this.ensureCatalog();
    }
    cancelEdit() {
        this.editingId = undefined;
        this.editorState = undefined;
    }
    async openPanel(id, type) {
        this.panelId = id;
        this.panelType = type;
        this.problem = undefined;
        try {
            if (type === 'history') {
                this.revisions = await this.api.listTemplateRevisions(id);
                this.diffItems = [];
                this.diffFrom = undefined;
                this.diffTo = undefined;
            }
            else {
                this.bindings = await this.api.listTemplateBindings(id);
            }
        }
        catch (error) {
            if (error instanceof AdminApiProblem)
                this.problem = error;
            else
                throw error;
        }
    }
    closePanel() {
        this.panelId = undefined;
        this.panelType = undefined;
        this.revisions = [];
        this.bindings = [];
        this.diffItems = [];
    }
    async computeDiff(id, from, to) {
        const fromNum = Number.parseInt(from, 10);
        const toNum = Number.parseInt(to, 10);
        if (!Number.isInteger(fromNum) || !Number.isInteger(toNum) || fromNum < 1 || toNum <= fromNum) {
            this.fieldError = '请选择两个版本号且前一个小于后一个。';
            return;
        }
        this.fieldError = undefined;
        this.problem = undefined;
        try {
            this.diffFrom = fromNum;
            this.diffTo = toNum;
            this.diffItems = await this.api.diffTemplateRevisions(id, fromNum, toNum);
        }
        catch (error) {
            if (error instanceof AdminApiProblem)
                this.problem = error;
            else
                throw error;
        }
    }
    /** 保存完整编辑器：新建或更新（更新追加 revision），成功后退出编辑并刷新。 */
    async saveFullEditor(edit) {
        const title = edit.title?.trim();
        if (title === undefined || title.length === 0) {
            this.fieldError = '请填写模板名称。';
            return;
        }
        const personaConfig = collectPersonaConfig(edit, this.catalog?.productScenarios ?? []);
        if (personaConfig === undefined) {
            this.fieldError = '请选择产品场景。';
            return;
        }
        const agentConfig = {
            schemaVersion: 'agent-config/v1',
            historyMessageLimit: clampInt(edit.agent_historyMessageLimit, 2, 50, 20),
            responseLength: edit.agent_responseLength,
            knowledgeStrictness: edit.agent_knowledgeStrictness,
            conversationPace: edit.agent_conversationPace,
            closingTendency: edit.agent_closingTendency,
            ...(typeof edit.agent_additionalInstructions === 'string' && edit.agent_additionalInstructions.trim().length > 0
                ? { additionalInstructions: edit.agent_additionalInstructions.trim() }
                : {}),
        };
        const learnerOverridePolicy = {
            mode: edit.policy_mode,
            visible: edit.policy_visible !== false,
            recommended: edit.policy_recommended === true,
            ...(edit.policy_mode === 'allow_list'
                ? { allowedPaths: parseLines(edit.policy_allowedPaths ?? '') }
                : {}),
        };
        const input = {
            title,
            personaConfig,
            agentConfig,
            learnerOverridePolicy,
            knowledgeVersions: parseLines(edit.knowledge ?? ''),
            scoringRules: parseLines(edit.rules ?? ''),
            recommendedScoringTemplateIds: Array.isArray(edit.recommendedScoringTemplateIds) ? edit.recommendedScoringTemplateIds : [],
        };
        this.problem = undefined;
        this.fieldError = undefined;
        this.status = undefined;
        try {
            if (this.editingId === null) {
                const created = await this.api.createOrganizationTemplate(input);
                this.status = `模板「${escapeHtml(created.title)}」已创建（版本 1），本组织主播可在小程序陪练时选用。`;
            }
            else if (typeof this.editingId === 'string') {
                const updated = await this.api.updateOrganizationTemplate(this.editingId, input);
                this.status = `模板「${escapeHtml(updated.title)}」的修改已保存为新版本 v${updated.currentRevision ?? '?'}，旧版本与已发布任务不受影响。`;
            }
            this.editingId = undefined;
            this.editorState = undefined;
            this.filter = 'active';
            await this.loadList();
        }
        catch (error) {
            if (error instanceof AdminApiProblem)
                this.problem = error;
            else
                throw error;
        }
    }
    /** 引导式创建：校验业务选择 → 后端预览组装画像 → 创建组织模板 → 刷新列表。 */
    async createFromSelection(selection) {
        const missing = [];
        // 方案 B：客户类型 = 8 大人群（主）或经典年龄预设（次），二选一
        if (!selection.customerCohort && !selection.ageCardId)
            missing.push('客户类型');
        if (![1, 2, 3, 4].includes(selection.difficulty))
            missing.push('沟通难度');
        if (!selection.productScenarioId)
            missing.push('产品场景');
        if (missing.length > 0) {
            this.fieldError = `请选择${missing.join('、')}。`;
            return;
        }
        this.problem = undefined;
        this.fieldError = undefined;
        this.status = undefined;
        try {
            await this.ensureCatalog();
            const previewInput = {
                psychologyCardIds: selection.psychologyCardIds,
                difficulty: selection.difficulty,
                productScenarioId: selection.productScenarioId,
            };
            // 方案 B：经典年龄预设优先（显式传 ageCardId），否则用 8 大人群驱动
            if (selection.ageCardId)
                previewInput.ageCardId = selection.ageCardId;
            if (selection.customerCohort !== undefined)
                previewInput.customerCohort = selection.customerCohort;
            if (selection.city !== undefined)
                previewInput.city = selection.city;
            if (selection.customerRelation !== undefined)
                previewInput.customerRelation = selection.customerRelation;
            if (selection.trustLevel !== undefined)
                previewInput.trustLevel = selection.trustLevel;
            const personaConfig = await this.api.previewPersona(previewInput);
            // 方案 B：模板名优先用人群名，其次用年龄卡名
            const typeLabel = selection.customerCohort
                ? labelOf(this.catalog?.cohortCards ?? [], selection.customerCohort)
                : labelOf(this.catalog?.ageCards ?? [], selection.ageCardId);
            const scenarioLabel = labelOf(this.catalog?.productScenarios ?? [], selection.productScenarioId);
            const title = selection.title?.trim() || buildTemplateName(typeLabel, scenarioLabel);
            const input = {
                title,
                personaConfig,
                // 快速创建不展示 AI 行为分区，按 AgentConfigV1 默认值落库（后端要求 agentConfig 必填且合法）。
                agentConfig: {
                    schemaVersion: 'agent-config/v1',
                    historyMessageLimit: 20,
                    responseLength: 'normal',
                    knowledgeStrictness: 'balanced',
                    conversationPace: 'normal',
                    closingTendency: 'neutral',
                },
                learnerOverridePolicy: { mode: 'all', visible: true, recommended: false },
            };
            if (selection.knowledgeVersions && selection.knowledgeVersions.length > 0) {
                input.knowledgeVersions = selection.knowledgeVersions;
            }
            if (selection.scoringRules && selection.scoringRules.length > 0) {
                input.scoringRules = selection.scoringRules;
            }
            await this.api.createOrganizationTemplate(input);
            this.status = `模板「${escapeHtml(title)}」已创建（版本 1），本组织主播可在小程序陪练时选用。`;
            this.filter = 'active';
            this.editingId = undefined;
            await this.loadList();
        }
        catch (error) {
            if (error instanceof AdminApiProblem)
                this.problem = error;
            else
                throw error;
        }
    }
    render() {
        return `${this.renderHeader()}${this.renderAlerts()}${this.renderEditorPanel()}${this.renderBuilder()}${this.renderList()}`;
    }
    renderHeader() {
        return `<div class="page-header">
      <div class="page-title">陪练模板</div>
      <div class="page-sub">选择客户特征即可生成陪练模板，也可用完整编辑器精细调校人设、AI 行为与 C 端策略；供主播在小程序自由练习与团队任务复用。</div>
    </div>`;
    }
    renderAlerts() {
        const parts = [];
        if (this.fieldError !== undefined) {
            parts.push(`<div class="alert alert-warn" role="alert">${escapeHtml(this.fieldError)}</div>`);
        }
        if (this.problem !== undefined) {
            const message = friendlyProblem(this.problem);
            parts.push(`<div class="alert alert-error" role="alert">${escapeHtml(message)}<span class="error-code">错误编号：${escapeHtml(this.problem.code)}</span></div>`);
        }
        if (this.status !== undefined) {
            parts.push(`<div class="alert alert-success" role="status">${this.status}</div>`);
        }
        return parts.join('');
    }
    renderEditorPanel() {
        if (this.editingId === undefined)
            return '';
        const isNew = this.editingId === null;
        const item = !isNew ? this.items.find((entry) => entry.id === this.editingId) : undefined;
        const state = this.editorState ?? {};
        const title = isNew ? '新建完整模板' : `编辑模板「${escapeHtml(item?.title ?? '')}」`;
        const hint = isNew
            ? '完整编辑器：八个分区一次配齐人设、AI 行为与 C 端策略，保存后生成版本 1。'
            : `当前版本 v${item?.currentRevision ?? '?'}；保存后追加新版本，旧版本与已发布任务不受影响。`;
        return `<section class="card editor-card">
      <div class="card-title">${title}<span class="card-hint">${hint}</span></div>
      <form data-action="template-save-full" class="builder">
        ${this.renderEditorSections(state)}
        <div class="form-actions">
          <button type="submit" class="btn btn-primary">${isNew ? '创建模板' : '保存为新版本'}</button>
          <button type="submit" name="cancel" value="1" class="btn btn-ghost">取消</button>
        </div>
      </form>
    </section>`;
    }
    renderEditorSections(state) {
        const meta = this.meta;
        if (meta === undefined) {
            return '<div class="loading-inline">正在加载完整编辑器选项…</div>';
        }
        const persona = meta.persona ?? {};
        const basic = persona.basic ?? {};
        const agent = meta.agentConfig ?? {};
        const override = meta.overridePolicy ?? {};
        const scenarios = this.catalog?.productScenarios ?? persona.presets?.productScenarios ?? [];
        const difficulties = this.catalog?.difficultyLevels ?? persona.presets?.difficultyLevels ?? [];
        const opt = (options, value) => options.map((option) => {
            const selected = String(option.value) === String(value) ? ' selected' : '';
            return `<option value="${escapeHtml(String(option.value))}"${selected}>${escapeHtml(option.label)}</option>`;
        }).join('');
        const range = (key, label, value, min, max) => `
          <div class="field">
            <label for="pe-${key}">${escapeHtml(label)}<span class="label-hint">${min}-${max}</span></label>
            <input id="pe-${key}" name="${key}" type="number" min="${min}" max="${max}" value="${escapeHtml(String(value))}" />
          </div>`;
        return `
      <fieldset class="builder-step">
        <legend><span class="step-no">1</span>基础画像</legend>
        <div class="form-grid">
          <div class="field"><label for="pe-title">模板名称</label><input id="pe-title" name="title" value="${escapeHtml(state.title ?? '')}" placeholder="例如：抗老专项提升模板" /></div>
          <div class="field"><label for="pe-name">客户姓名</label><input id="pe-name" name="name" value="${escapeHtml(state.name ?? '')}" maxlength="${escapeHtml(String(basic.nameMaxLength ?? 64))}" /></div>
          <div class="field"><label for="pe-age">年龄</label><input id="pe-age" name="age" type="number" min="${escapeHtml(String(basic.ageRange?.min ?? 0))}" max="${escapeHtml(String(basic.ageRange?.max ?? 120))}" value="${escapeHtml(String(state.age ?? 30))}" /></div>
          <div class="field"><label for="pe-gender">性别</label><select id="pe-gender" name="gender">${opt(basic.genders ?? [], state.gender ?? 'female')}</select></div>
          <div class="field"><label for="pe-occupation">职业</label><input id="pe-occupation" name="occupation" value="${escapeHtml(state.occupation ?? '')}" maxlength="${escapeHtml(String(basic.occupationMaxLength ?? 32))}" /></div>
          <div class="field"><label for="pe-basic_maritalStatus">婚姻状况</label><select id="pe-basic_maritalStatus" name="basic_maritalStatus">${opt(basic.maritalStatuses ?? [], state.basic_maritalStatus ?? 'unknown')}</select></div>
          <div class="field"><label for="pe-basic_incomeLevel">收入水平</label><select id="pe-basic_incomeLevel" name="basic_incomeLevel">${opt(basic.incomeLevels ?? [], state.basic_incomeLevel ?? 'medium')}</select></div>
          <div class="field"><label for="pe-basic_city">所在城市</label><input id="pe-basic_city" name="basic_city" value="${escapeHtml(state.basic_city ?? '')}" maxlength="${escapeHtml(String(basic.cityMaxLength ?? 30))}" placeholder="例如：杭州" /></div>
        </div>
      </fieldset>

      <fieldset class="builder-step">
        <legend><span class="step-no">2</span>性格参数<span class="step-hint">0-100，数字越大越明显</span></legend>
        <div class="form-grid">
          ${(persona.personality?.traits ?? []).map((trait) => range(`personality_${trait.key}`, trait.label, state[`personality_${trait.key}`] ?? 50, trait.min, trait.max)).join('')}
        </div>
      </fieldset>

      <fieldset class="builder-step">
        <legend><span class="step-no">3</span>沟通方式</legend>
        <div class="form-grid">
          <div class="field"><label for="pe-communication_style">语言风格</label><select id="pe-communication_style" name="communication_style">${opt(persona.communication?.styles ?? [], state.communication_style ?? 'gentle')}</select></div>
          <div class="field"><label for="pe-communication_verbosity">话量</label><select id="pe-communication_verbosity" name="communication_verbosity">${opt(persona.communication?.verbosities ?? [], state.communication_verbosity ?? 'normal')}</select></div>
          <div class="field"><label for="pe-communication_emotionLevel">情绪表达</label><select id="pe-communication_emotionLevel" name="communication_emotionLevel">${opt(persona.communication?.emotionLevels ?? [], state.communication_emotionLevel ?? 'normal')}</select></div>
          <div class="field"><label for="pe-communication_dialect">方言</label><select id="pe-communication_dialect" name="communication_dialect">${opt(persona.communication?.dialects ?? [], state.communication_dialect ?? 'mandarin')}</select></div>
          <div class="field full"><label for="pe-communication_catchphrase">口头禅</label><input id="pe-communication_catchphrase" name="communication_catchphrase" value="${escapeHtml(state.communication_catchphrase ?? '')}" maxlength="${escapeHtml(String(persona.communication?.catchphraseMaxLength ?? 80))}" /></div>
        </div>
      </fieldset>

      <fieldset class="builder-step">
        <legend><span class="step-no">4</span>消费与需求<span class="step-hint">顶部为客户定位三要素，直接影响陪练话术</span></legend>
        <div class="form-grid">
          <div class="field"><label for="pe-basic_customerRelation">客户定位<span class="label-hint">生命周期阶段，选填</span></label><select id="pe-basic_customerRelation" name="basic_customerRelation"><option value="" ${!state.basic_customerRelation ? 'selected' : ''}>不设置</option>${(basic.customerRelations ?? []).map((item) => `<option value="${escapeHtml(String(item.value))}" ${String(item.value) === String(state.basic_customerRelation ?? '') ? 'selected' : ''}>${escapeHtml(item.label)}</option>`).join('')}</select><span class="field-hint">${(basic.customerRelations ?? []).filter((item) => String(item.value) === String(state.basic_customerRelation ?? '')).map((item) => escapeHtml(String(item.description ?? '') + '；目标：' + String(item.goal ?? ''))).join('') || '如「老客户：有复购记录，目标升级推荐」'}</span></div>
          <div class="field"><label for="pe-basic_trustLevel">信任度<span class="label-hint">1-5 级，仅影响话术与推进策略，不计入评分</span></label><select id="pe-basic_trustLevel" name="basic_trustLevel"><option value="" ${!state.basic_trustLevel ? 'selected' : ''}>不设置</option>${(basic.trustLevels ?? []).map((item) => `<option value="${escapeHtml(String(item.value))}" title="${escapeHtml(String(item.behavior ?? ''))}｜${escapeHtml(String(item.strategy ?? ''))}" ${String(item.value) === String(state.basic_trustLevel ?? '') ? 'selected' : ''}>${escapeHtml(String(item.value))} · ${escapeHtml(item.label)}</option>`).join('')}</select><span class="field-hint">悬停可见客户表现与推进策略</span></div>
          <div class="field"><label for="pe-basic_purchaseCategory">经常购买品类<span class="label-hint">≤${escapeHtml(String(basic.purchaseCategoryMaxLength ?? 50))} 字，选填</span></label><input id="pe-basic_purchaseCategory" name="basic_purchaseCategory" value="${escapeHtml(state.basic_purchaseCategory ?? '')}" maxlength="${escapeHtml(String(basic.purchaseCategoryMaxLength ?? 50))}" placeholder="例如：抗老精华、口服胶原蛋白" /></div>
          <div class="field"><label for="pe-consumption_budgetMin">预算下限（元）</label><input id="pe-consumption_budgetMin" name="consumption_budgetMin" type="number" min="0" value="${escapeHtml(String(state.consumption_budgetMin ?? 100))}" /></div>
          <div class="field"><label for="pe-consumption_budgetMax">预算上限（元）</label><input id="pe-consumption_budgetMax" name="consumption_budgetMax" type="number" min="0" value="${escapeHtml(String(state.consumption_budgetMax ?? 500))}" /></div>
          <div class="field"><label for="pe-consumption_decisionCycle">决策周期</label><select id="pe-consumption_decisionCycle" name="consumption_decisionCycle">${opt(persona.consumption?.decisionCycles ?? [], state.consumption_decisionCycle ?? 'same_day')}</select></div>
          <div class="field"><label for="pe-consumption_brandLoyalty">品牌忠诚</label><select id="pe-consumption_brandLoyalty" name="consumption_brandLoyalty">${opt(persona.consumption?.brandLoyalties ?? [], state.consumption_brandLoyalty ?? 'medium')}</select></div>
          <div class="field"><label for="pe-consumption_skinType">肤质</label><select id="pe-consumption_skinType" name="consumption_skinType">${opt(persona.consumption?.skinTypes ?? [], state.consumption_skinType ?? 'normal')}</select></div>
          <div class="field"><label for="pe-consumption_purchaseChannel">购买渠道</label><select id="pe-consumption_purchaseChannel" name="consumption_purchaseChannel">${opt(persona.consumption?.purchaseChannels ?? [], state.consumption_purchaseChannel ?? 'wechat_private')}</select></div>
          <div class="field"><label for="pe-consumption_ingredientFocus">成分关注</label><select id="pe-consumption_ingredientFocus" name="consumption_ingredientFocus">${opt(persona.consumption?.ingredientFocus ?? [], state.consumption_ingredientFocus ?? 'normal')}</select></div>
          <div class="field"><label for="pe-consumption_competitorComparison">竞品倾向</label><select id="pe-consumption_competitorComparison" name="consumption_competitorComparison">${opt(persona.consumption?.competitorComparisons ?? [], state.consumption_competitorComparison ?? 'occasionally')}</select></div>
          <div class="field full"><label>皮肤问题<span class="label-hint">从专业词表勾选（可多选），词表外的可写在下方补充框，最多 ${escapeHtml(String(persona.consumption?.arrayLimits?.skinConcerns?.maxItems ?? 10))} 项</span></label><div class="concern-groups">${(persona.consumption?.skinConcernsDictionary ?? []).map((group) => `<div class="concern-group"><span class="concern-group-label">${escapeHtml(group.category)}</span><div class="chip-grid">${group.items.map((item) => `<label class="chip"><input type="checkbox" name="skinConcern" value="${escapeHtml(item)}" ${(state.consumption_skinConcerns ?? '').split(/[\s,，、;；]+/u).filter(Boolean).includes(item) ? 'checked' : ''} /><span>${escapeHtml(item)}</span></label>`).join('')}</div></div>`).join('')}</div><textarea id="pe-consumption_skinConcerns" name="consumption_skinConcerns" rows="2" placeholder="补充词表外的皮肤问题，每行一个">${escapeHtml((state.consumption_skinConcerns ?? '').split(/[\s,，、;；]+/u).filter((entry) => !(persona.consumption?.skinConcernsDictionary ?? []).some((group) => group.items.includes(entry))).join('\n'))}</textarea></div>
          <div class="field"><label for="pe-consumption_healthGoals">健康目标<span class="label-hint">每行一个，最多 ${escapeHtml(String(persona.consumption?.arrayLimits?.healthGoals?.maxItems ?? 10))} 项</span></label><textarea id="pe-consumption_healthGoals" name="consumption_healthGoals" rows="2">${escapeHtml(state.consumption_healthGoals ?? '')}</textarea></div>
          <div class="field"><label for="pe-consumption_allergies">过敏信息<span class="label-hint">每行一个，最多 ${escapeHtml(String(persona.consumption?.arrayLimits?.allergies?.maxItems ?? 10))} 项</span></label><textarea id="pe-consumption_allergies" name="consumption_allergies" rows="2">${escapeHtml(state.consumption_allergies ?? '')}</textarea></div>
          <div class="field full"><label for="pe-consumption_currentProducts">当前在用产品</label><textarea id="pe-consumption_currentProducts" name="consumption_currentProducts" rows="2" maxlength="${escapeHtml(String(persona.consumption?.currentProductsMaxLength ?? 200))}">${escapeHtml(state.consumption_currentProducts ?? '')}</textarea></div>
        </div>
      </fieldset>

      <fieldset class="builder-step">
        <legend><span class="step-no">5</span>对话控制</legend>
        <div class="form-grid">
          <div class="field full"><label for="pe-conversation_productScenario">产品场景<span class="label-hint">按五大类分组，可同时看到经典场景</span></label><select id="pe-conversation_productScenario" name="conversation_productScenario" required><option value="" selected disabled>请选择产品场景</option>${(persona.presets?.productScenarioCategories ?? []).map((category) => { const legacy = scenarios.filter((item) => LEGACY_SCENARIO_CATEGORY[item.id] === category.id); const sceneOptions = category.scenes.map((scene) => `<option value="${escapeHtml(scene)}" ${String(scene) === String(state.conversation_productScenario ?? '') ? 'selected' : ''}>${escapeHtml(scene)}</option>`).join(''); const legacyOptions = legacy.map((item) => `<option value="${escapeHtml(item.displayName)}" ${String(item.displayName) === String(state.conversation_productScenario ?? '') ? 'selected' : ''}>${escapeHtml(item.displayName)}（经典）</option>`).join(''); return `<optgroup label="${escapeHtml(category.displayName)}（${escapeHtml(category.category)}）">${sceneOptions}${legacyOptions}</optgroup>`; }).join('')}</select></div>
          <div class="field"><label for="pe-conversation_difficulty">沟通难度</label><select id="pe-conversation_difficulty" name="conversation_difficulty">${difficulties.map((item) => `<option value="${escapeHtml(String(item.level))}" ${String(item.level) === String(state.conversation_difficulty ?? 2) ? 'selected' : ''}>${escapeHtml(item.name)}</option>`).join('')}</select></div>
          <div class="field"><label for="pe-conversation_maxTurns">最大轮数</label><input id="pe-conversation_maxTurns" name="conversation_maxTurns" type="number" min="${escapeHtml(String(persona.conversation?.maxTurnsRange?.min ?? 1))}" max="${escapeHtml(String(persona.conversation?.maxTurnsRange?.max ?? 100))}" value="${escapeHtml(String(state.conversation_maxTurns ?? 15))}" /></div>
          <div class="field"><label for="pe-conversation_openingMode">开场方</label><select id="pe-conversation_openingMode" name="conversation_openingMode">${opt(persona.conversation?.openingModes ?? [], state.conversation_openingMode ?? 'ai_first')}</select></div>
          <div class="field full"><label for="pe-conversation_background">客户背景<span class="label-hint">必填，最多 ${escapeHtml(String(persona.conversation?.backgroundMaxLength ?? 500))} 字</span></label><textarea id="pe-conversation_background" name="conversation_background" rows="3" maxlength="${escapeHtml(String(persona.conversation?.backgroundMaxLength ?? 500))}">${escapeHtml(state.conversation_background ?? '')}</textarea></div>
          <div class="field full"><label for="pe-conversation_customNotes">补充备注</label><textarea id="pe-conversation_customNotes" name="conversation_customNotes" rows="2" maxlength="${escapeHtml(String(persona.conversation?.customNotesMaxLength ?? 500))}">${escapeHtml(state.conversation_customNotes ?? '')}</textarea></div>
        </div>
      </fieldset>

      <fieldset class="builder-step">
        <legend><span class="step-no">6</span>训练资源</legend>
        <div class="form-grid">
          <div class="field"><label for="pe-knowledge">关联知识要点<span class="label-hint">每行一个，例如：抗老精华成分@1</span></label><textarea id="pe-knowledge" name="knowledge" rows="3">${escapeHtml(state.knowledge ?? '')}</textarea></div>
          <div class="field"><label for="pe-rules">评分要点<span class="label-hint">每行一个</span></label><textarea id="pe-rules" name="rules" rows="3">${escapeHtml(state.rules ?? '')}</textarea></div>
        </div>
      </fieldset>

      <fieldset class="builder-step">
        <legend><span class="step-no">6b</span>推荐评分规则<span class="step-hint">任务投放时优先推荐这些评分模板，可多选</span></legend>
        <div class="form-grid">
          <div class="field full">
            ${this.scoringTemplates.length === 0
                ? '<div class="field-hint">暂无评分模板，可在「评分配置」中创建。</div>'
                : `<div class="k-chip-group">
                    ${this.scoringTemplates.map((t) => {
                        const checked = Array.isArray(state.recommendedScoringTemplateIds) && state.recommendedScoringTemplateIds.includes(t.id);
                        return `<label class="k-chip${checked ? ' selected' : ''}">
                          <input type="checkbox" name="recommendedScoringTemplateIds" value="${escapeHtml(t.id)}"${checked ? ' checked' : ''} style="display:none" />
                          <span class="k-chip-text">${escapeHtml(t.name)}${t.isDefault ? '（默认）' : ''}</span>
                          <span class="k-chip-meta">${t.dimensionIds?.length ?? '-'}维度</span>
                        </label>`;
                    }).join('')}
                  </div>`}
          </div>
        </div>
      </fieldset>

      <fieldset class="builder-step">
        <legend><span class="step-no">7</span>AI 行为<span class="step-hint">控制陪练 AI 的回复与节奏（AgentConfigV1）</span></legend>
        <div class="form-grid">
          <div class="field"><label for="pe-agent_historyMessageLimit">携带历史消息数</label><input id="pe-agent_historyMessageLimit" name="agent_historyMessageLimit" type="number" min="${escapeHtml(String(agent.historyMessageLimitRange?.min ?? 2))}" max="${escapeHtml(String(agent.historyMessageLimitRange?.max ?? 50))}" value="${escapeHtml(String(state.agent_historyMessageLimit ?? 20))}" /></div>
          <div class="field"><label for="pe-agent_responseLength">回复长度</label><select id="pe-agent_responseLength" name="agent_responseLength">${opt(agent.responseLengths ?? [], state.agent_responseLength ?? 'normal')}</select></div>
          <div class="field"><label for="pe-agent_knowledgeStrictness">知识严格度</label><select id="pe-agent_knowledgeStrictness" name="agent_knowledgeStrictness">${opt(agent.knowledgeStrictnesses ?? [], state.agent_knowledgeStrictness ?? 'balanced')}</select></div>
          <div class="field"><label for="pe-agent_conversationPace">对话节奏</label><select id="pe-agent_conversationPace" name="agent_conversationPace">${opt(agent.conversationPaces ?? [], state.agent_conversationPace ?? 'normal')}</select></div>
          <div class="field"><label for="pe-agent_closingTendency">成交倾向</label><select id="pe-agent_closingTendency" name="agent_closingTendency">${opt(agent.closingTendencies ?? [], state.agent_closingTendency ?? 'neutral')}</select></div>
          <div class="field full"><label for="pe-agent_additionalInstructions">额外行为指令<span class="label-hint">最多 ${escapeHtml(String(agent.additionalInstructionsMaxLength ?? 1000))} 字，仅作用于角色行为，不覆盖安全与知识边界</span></label><textarea id="pe-agent_additionalInstructions" name="agent_additionalInstructions" rows="2" maxlength="${escapeHtml(String(agent.additionalInstructionsMaxLength ?? 1000))}">${escapeHtml(state.agent_additionalInstructions ?? '')}</textarea></div>
        </div>
      </fieldset>

      <fieldset class="builder-step">
        <legend><span class="step-no">8</span>C 端策略<span class="step-hint">决定主播在小程序选用此模板时，可修改哪些字段</span></legend>
        <div class="form-grid">
          <div class="field"><label><input type="hidden" name="policy_visible" value="false" /><input type="checkbox" name="policy_visible" value="true" ${state.policy_visible !== false ? 'checked' : ''} /> 对主播可见</label><span class="field-hint">关闭后该模板不在小程序展示，但已发布任务不受影响</span></div>
          <div class="field"><label><input type="hidden" name="policy_recommended" value="false" /><input type="checkbox" name="policy_recommended" value="true" ${state.policy_recommended === true ? 'checked' : ''} /> 设为推荐</label><span class="field-hint">推荐模板在主播端优先展示</span></div>
          <div class="field"><label for="pe-policy_mode">可覆盖策略</label><select id="pe-policy_mode" name="policy_mode">${opt(override.modes ?? [], state.policy_mode ?? 'all')}</select></div>
          <div class="field full"><label for="pe-policy_allowedPaths">允许覆盖字段<span class="label-hint">仅「白名单」模式生效，每行一个字段路径</span></label><textarea id="pe-policy_allowedPaths" name="policy_allowedPaths" rows="3" placeholder="例如：&#10;personality.friendliness&#10;conversation.maxTurns">${escapeHtml(state.policy_allowedPaths ?? '')}</textarea>
            <div class="field-hint">可选路径：${(override.allowedPaths ?? []).slice(0, 8).map((entry) => `<code class="mono">${escapeHtml(entry.path)}</code>`).join('、')}…（保存时后端会校验白名单合法性）</div>
          </div>
        </div>
      </fieldset>`;
    }
    renderBuilder() {
        if (this.catalog === undefined && this.meta === undefined) {
            return `<section class="card"><div class="loading-inline">正在加载客户画像选项…</div></section>`;
        }
        const catalog = this.catalog;
        if (catalog === undefined) {
            return `<section class="card"><div class="loading-inline">正在加载客户画像选项…</div></section>`;
        }
        const metaBasic = this.meta?.persona?.basic;
        const metaPresets = this.meta?.persona?.presets;
        const relations = metaBasic?.customerRelations ?? [];
        const trustLevels = metaBasic?.trustLevels ?? [];
        const categories = metaPresets?.productScenarioCategories ?? [];
        const relationOptions = relations.map((item) => `<option value="${escapeHtml(String(item.value))}">${escapeHtml(item.label)}</option>`).join('');
        const trustOptions = trustLevels.map((item) => `<option value="${escapeHtml(String(item.value))}">${escapeHtml(String(item.value))} · ${escapeHtml(item.label)}</option>`).join('');
        const scenarioGroups = categories.length > 0
            ? categories.map((category) => { const legacy = catalog.productScenarios.filter((item) => LEGACY_SCENARIO_CATEGORY[item.id] === category.id); const sceneOptions = category.scenes.map((scene) => `<option value="${escapeHtml(`${category.id}::${scene}`)}">${escapeHtml(scene)}</option>`).join(''); const legacyOptions = legacy.map((item) => `<option value="${escapeHtml(item.id)}" title="${escapeHtml(item.description)}">${escapeHtml(item.displayName)}（经典）</option>`).join(''); return `<optgroup label="${escapeHtml(category.displayName)}（${escapeHtml(category.category)}）">${sceneOptions}${legacyOptions}</optgroup>`; }).join('')
            : catalog.productScenarios.map((item) => `<option value="${escapeHtml(item.id)}" title="${escapeHtml(item.description)}">${escapeHtml(item.displayName)}</option>`).join('');
        const cohortCards = catalog.cohortCards ?? [];
        const cohortCardOptions = cohortCards.map((card) => `
              <label class="option-card cohort-card">
                <input type="radio" name="cohort" value="${escapeHtml(card.id)}" />
                <span class="option-title">${escapeHtml(card.displayName)}</span>
                <span class="option-desc">${escapeHtml(card.description)}</span>
                <span class="option-meta">${card.age}岁 · ${escapeHtml(card.occupation)} · 预算${card.consumption.budgetMin}-${card.consumption.budgetMax}</span>
              </label>`).join('');
        const ageCardOptions = catalog.ageCards.map((card) => `
              <label class="option-card">
                <input type="radio" name="ageCard" value="${escapeHtml(card.id)}" />
                <span class="option-title">${escapeHtml(card.displayName)}</span>
                <span class="option-desc">${escapeHtml(card.description)}</span>
              </label>`).join('');
        return `<section class="card">
      <div class="card-title">快速创建模板<span class="card-hint">三步选择，系统自动生成客户画像；或用下方「完整编辑器」精细调校</span></div>
      <form data-action="create-template" class="builder">
        <fieldset class="builder-step">
          <legend><span class="step-no">1</span>选择客户类型<span class="step-hint">单选，按巨量 DMP 八大人群直接生成年龄、职业与消费底色</span></legend>
          <div class="option-grid" id="cohort-grid">
            ${cohortCardOptions || '<span class="text-muted">人群选项加载中…</span>'}
          </div>
          <div class="option-grid" id="age-card-grid" style="display:none">
            ${ageCardOptions}
          </div>
          <div class="builder-toggle">
            <button type="button" class="btn btn-ghost btn-sm" id="toggle-classic-cards">使用经典年龄预设（小姐姐/御姐…）</button>
          </div>
        </fieldset>

        <fieldset class="builder-step">
          <legend><span class="step-no">1b</span>所在城市<span class="step-hint">选填，如「杭州」</span></legend>
          <div class="form-grid">
            <div class="field">
              <label for="tpl-city">城市</label>
              <input id="tpl-city" name="city" maxlength="30" placeholder="例如：杭州" />
            </div>
          </div>
        </fieldset>

        <fieldset class="builder-step">
          <legend><span class="step-no">2</span>客户心理倾向<span class="step-hint">可多选，也可留空</span></legend>
          <div class="chip-grid">
            ${catalog.psychologyCards.map((card) => `
              <label class="chip">
                <input type="checkbox" name="psychology" value="${escapeHtml(card.id)}" />
                <span>${escapeHtml(card.displayName)}</span>
              </label>`).join('')}
          </div>
        </fieldset>

        <fieldset class="builder-step">
          <legend><span class="step-no">3</span>沟通难度与产品场景</legend>
          <div class="segmented">
            ${catalog.difficultyLevels.map((level) => `
              <label class="segment">
                <input type="radio" name="difficulty" value="${level.level}" ${level.level === 2 ? 'checked' : ''} />
                <span class="segment-title">${escapeHtml(level.name)}</span>
                <span class="segment-desc">${escapeHtml(level.description)}</span>
              </label>`).join('')}
          </div>
          <div class="form-grid">
            <div class="field">
              <label for="tpl-scenario">产品场景<span class="label-hint">按五大类分组</span></label>
              <select id="tpl-scenario" name="scenario" required>
                <option value="" selected disabled>请选择产品场景</option>
                ${scenarioGroups}
              </select>
            </div>
            <div class="field">
              <label for="tpl-title">模板名称<span class="label-hint">选填，留空自动命名</span></label>
              <input id="tpl-title" name="title" placeholder="例如：抗老专项提升模板" />
            </div>
          </div>
        </fieldset>

        <details class="advanced">
          <summary>客户定位与信任度（可选）</summary>
          <div class="form-grid">
            <div class="field">
              <label for="tpl-customerRelation">客户定位<span class="label-hint">生命周期阶段</span></label>
              <select id="tpl-customerRelation" name="customerRelation">
                <option value="" selected>不设置</option>
                ${relationOptions}
              </select>
            </div>
            <div class="field">
              <label for="tpl-trustLevel">信任度<span class="label-hint">1-5 级，影响话术与推进策略</span></label>
              <select id="tpl-trustLevel" name="trustLevel">
                <option value="" selected>不设置</option>
                ${trustOptions}
              </select>
            </div>
          </div>
        </details>

        <details class="advanced">
          <summary>高级设置：关联知识要点 / 评分要点（通常无需填写）</summary>
          <div class="form-grid">
            <div class="field">
              <label for="tpl-knowledge">关联知识要点</label>
              <textarea id="tpl-knowledge" name="knowledge" rows="3" placeholder="每行一个，例如：抗老精华成分@1"></textarea>
            </div>
            <div class="field">
              <label for="tpl-rules">评分要点</label>
              <textarea id="tpl-rules" name="rules" rows="3" placeholder="每行一个评分要点，可留空"></textarea>
            </div>
          </div>
        </details>

        <div class="form-actions">
          <button type="submit" class="btn btn-primary">创建陪练模板</button>
          <button type="submit" name="mode" value="full" class="btn btn-secondary">使用完整编辑器…</button>
        </div>
      </form>
    </section>`;
    }
    renderList() {
        const tabs = `<form data-action="template-filter" class="filter-tabs">
      ${FILTERS.map((filter) => `<button type="submit" name="status" value="${filter.value}" class="filter-tab${this.filter === filter.value ? ' is-active' : ''}"${this.filter === filter.value ? ' aria-current="true"' : ''}>${filter.label}</button>`).join('')}
    </form>`;
        const emptyDesc = this.filter === 'archived'
            ? '还没有已归档的模板；归档不会删除历史练习记录。'
            : this.filter === 'all'
                ? '还没有陪练模板，在上方选择客户特征创建第一个。'
                : '当前没有生效中的模板，可切换到「全部」查看已归档模板。';
        const body = this.items.length === 0
            ? `<div class="empty"><div class="empty-title">暂无模板</div><div class="empty-desc">${emptyDesc}</div></div>`
            : `<div class="table-wrap"><table class="table">
          <thead><tr><th>模板名称</th><th>客户画像</th><th>知识要点</th><th>版本</th><th>状态</th><th>创建时间</th><th>操作</th></tr></thead>
          <tbody>${this.items.map((item) => this.renderRow(item)).join('')}</tbody>
        </table></div>`;
        return `<section class="card">
      <div class="card-title">模板库<span class="card-hint">共 ${this.items.length} 个 · 组织内主播可见</span></div>
      ${tabs}
      ${body}
      ${this.renderPanel()}
    </section>`;
    }
    renderRow(item) {
        const knowledge = item.knowledgeVersions.length === 0
            ? '<span class="text-muted">未关联</span>'
            : `<span class="badge badge-neutral">${item.knowledgeVersions.length} 条</span>`;
        const statusClass = item.status === 'active' ? 'badge-active' : 'badge-draft';
        const revision = typeof item.currentRevision === 'number'
            ? `<span class="badge badge-neutral">v${item.currentRevision}</span>`
            : '<span class="text-muted">—</span>';
        const persona = item.personaConfig ?? {};
        const personaSummary = summarizePersona(persona, this.catalog?.ageCards ?? [])
            + (persona.conversation?.openingMode ? ` · ${openingModeLabel(persona.conversation.openingMode)}` : '')
            + summarizeCustomerSituation(persona, this.meta?.persona?.basic);
        const actions = item.status === 'active'
            ? `<button type="submit" name="op" value="edit" class="btn btn-ghost btn-sm">编辑</button>
         <button type="submit" name="op" value="history" class="btn btn-ghost btn-sm">版本</button>
         <button type="submit" name="op" value="bindings" class="btn btn-ghost btn-sm">绑定场景</button>
         <button type="submit" name="op" value="duplicate" class="btn btn-ghost btn-sm">复制</button>
         <button type="submit" name="op" value="archive" class="btn btn-ghost btn-sm btn-danger-ghost">归档</button>`
            : `<button type="submit" name="op" value="activate" class="btn btn-ghost btn-sm">重新启用</button>
         <button type="submit" name="op" value="history" class="btn btn-ghost btn-sm">版本</button>`;
        return `<tr>
      <td class="cell-strong">${escapeHtml(item.title)}</td>
      <td>${escapeHtml(personaSummary)}</td>
      <td>${knowledge}</td>
      <td>${revision}</td>
      <td><span class="badge ${statusClass}">${escapeHtml(templateStatusLabel(item.status))}</span></td>
      <td class="text-muted">${escapeHtml(item.createdAt ? formatDateTime(item.createdAt) : '—')}</td>
      <td><form data-action="template-row-op" class="row-actions">
        <input name="templateId" type="hidden" value="${escapeHtml(item.id)}" />
        ${actions}
      </form></td>
    </tr>`;
    }
    renderPanel() {
        if (this.panelId === undefined || this.panelType === undefined)
            return '';
        const item = this.items.find((entry) => entry.id === this.panelId);
        if (item === undefined)
            return '';
        if (this.panelType === 'history') {
            return this.renderHistoryPanel(item);
        }
        return this.renderBindingsPanel(item);
    }
    renderHistoryPanel(item) {
        const revisionOptions = (selectedRevision) => this.revisions.map((r) => `<option value="${escapeHtml(String(r.revision))}"${r.revision === selectedRevision ? ' selected' : ''}>v${escapeHtml(String(r.revision))} · ${escapeHtml(formatDateTime(r.createdAt))}</option>`).join('');
        const diffBlock = this.diffItems.length > 0
            ? `<div class="table-wrap" style="margin-top:12px"><table class="table">
          <thead><tr><th>字段</th><th>v${escapeHtml(String(this.diffFrom ?? ''))}</th><th>v${escapeHtml(String(this.diffTo ?? ''))}</th></tr></thead>
          <tbody>${this.diffItems.map((entry) => `<tr>
            <td class="cell-strong">${escapeHtml(entry.path)}</td>
            <td>${formatDiffValue(entry.before)}</td>
            <td>${formatDiffValue(entry.after)}</td>
          </tr>`).join('')}</tbody>
        </table></div>`
            : '';
        const revisionsBody = this.revisions.length === 0
            ? '<div class="empty"><div class="empty-title">暂无版本记录</div></div>'
            : `<div class="table-wrap"><table class="table">
          <thead><tr><th>版本</th><th>模板名称</th><th>客户画像</th><th>知识</th><th>评分</th><th>修改时间</th></tr></thead>
          <tbody>${this.revisions.map((r) => `<tr>
            <td><span class="badge badge-neutral">v${escapeHtml(String(r.revision))}</span></td>
            <td class="cell-strong">${escapeHtml(r.title)}</td>
            <td>${escapeHtml(summarizePersona(r.personaConfig, this.catalog?.ageCards ?? []))}</td>
            <td>${r.knowledgeVersions.length > 0 ? `${r.knowledgeVersions.length} 条` : '<span class="text-muted">无</span>'}</td>
            <td>${r.scoringRules.length > 0 ? `${r.scoringRules.length} 条` : '<span class="text-muted">无</span>'}</td>
            <td class="text-muted">${escapeHtml(formatDateTime(r.createdAt))}</td>
          </tr>`).join('')}</tbody>
        </table></div>`;
        return `<section class="card">
      <div class="card-title">模板「${escapeHtml(item.title)}」版本历史<span class="card-hint">共 ${this.revisions.length} 个版本，修改模板只追加新版本，不影响已发布任务</span></div>
      <form data-action="template-diff" class="inline-actions" style="margin-bottom:12px">
        <input name="templateId" type="hidden" value="${escapeHtml(item.id)}" />
        <div class="inline-form">
          <label>对比：从 <select name="from">${revisionOptions(this.diffFrom)}</select> 到 <select name="to">${revisionOptions(this.diffTo)}</select></label>
          <button type="submit" class="btn btn-secondary btn-sm">查看差异</button>
        </div>
      </form>
      ${diffBlock}
      ${revisionsBody}
      <form data-action="template-close-panel" class="inline-cancel-form"><button type="submit" class="btn btn-ghost">关闭</button></form>
    </section>`;
    }
    renderBindingsPanel(item) {
        const body = this.bindings.length === 0
            ? '<div class="empty"><div class="empty-title">暂无场景绑定</div><div class="empty-desc">还没有场景草稿使用此模板；可到「场景管理」创建场景时选择绑定。</div></div>'
            : `<div class="table-wrap"><table class="table">
          <thead><tr><th>场景草稿</th><th>绑定版本</th></tr></thead>
          <tbody>${this.bindings.map((binding) => `<tr>
            <td class="cell-strong">${escapeHtml(binding.title)}</td>
            <td>${typeof binding.revision === 'number' ? `<span class="badge badge-neutral">v${binding.revision}</span>` : '<span class="text-muted">—</span>'}</td>
          </tr>`).join('')}</tbody>
        </table></div>`;
        return `<section class="card">
      <div class="card-title">模板「${escapeHtml(item.title)}」的绑定场景<span class="card-hint">已绑定的场景保留当前版本，升级需在场景管理中显式操作</span></div>
      ${body}
      <form data-action="template-close-panel" class="inline-cancel-form"><button type="submit" class="btn btn-ghost">关闭</button></form>
    </section>`;
    }
}
/** 收集完整编辑器表单 → 冻结 PersonaConfig；缺产品场景时返回 undefined。 */
/** 客户定位摘要（v2 P0 三要素）：客户定位 / 信任度 / 人群类型，有值才展示。 */
function summarizeCustomerSituation(persona, metaBasic) {
    const basic = persona.basic ?? {};
    const parts = [];
    const relation = (metaBasic?.customerRelations ?? []).find((item) => String(item.value) === String(basic.customerRelation ?? ''));
    if (relation !== undefined)
        parts.push(relation.label);
    if (basic.trustLevel !== undefined)
        parts.push(`信任${String(basic.trustLevel)}`);
    const cohort = (metaBasic?.customerCohorts ?? []).find((item) => String(item.value) === String(basic.customerCohort ?? ''));
    if (cohort !== undefined)
        parts.push(cohort.label);
    if (typeof basic.city === 'string' && basic.city.length > 0)
        parts.push(basic.city);
    if (typeof basic.purchaseCategory === 'string' && basic.purchaseCategory.length > 0)
        parts.push(basic.purchaseCategory);
    return parts.length === 0 ? '' : ` · ${parts.join(' / ')}`;
}
function collectPersonaConfig(edit, scenarios) {
    const productScenario = typeof edit.conversation_productScenario === 'string' && edit.conversation_productScenario.length > 0
        ? edit.conversation_productScenario
        : undefined;
    if (productScenario === undefined)
        return undefined;
    return {
        id: '',
        name: edit.name?.trim() || '未命名客户',
        // 完整编辑器不经过客户类型卡片，basedOnCard 无真实卡片 id；
        // 后端仅要求非空（元数据字段），会话侧不会据此查找卡片。
        basedOnCard: 'custom-editor',
        age: clampInt(edit.age, 0, 120, 30),
        gender: edit.gender,
        basic: {
            maritalStatus: edit.basic_maritalStatus,
            incomeLevel: edit.basic_incomeLevel,
            ...(typeof edit.basic_customerRelation === 'string' && edit.basic_customerRelation.length > 0
                ? { customerRelation: edit.basic_customerRelation } : {}),
            ...(typeof edit.basic_trustLevel === 'string' && edit.basic_trustLevel.length > 0
                ? { trustLevel: Number(edit.basic_trustLevel) } : {}),
            ...(typeof edit.basic_customerCohort === 'string' && edit.basic_customerCohort.length > 0
                ? { customerCohort: edit.basic_customerCohort } : {}),
            ...(typeof edit.basic_city === 'string' && edit.basic_city.trim().length > 0
                ? { city: edit.basic_city.trim() } : {}),
            ...(typeof edit.basic_purchaseCategory === 'string' && edit.basic_purchaseCategory.trim().length > 0
                ? { purchaseCategory: edit.basic_purchaseCategory.trim() } : {}),
        },
        occupation: edit.occupation?.trim() || '未知',
        personality: {
            friendliness: clampInt(edit.personality_friendliness, 0, 100, 50),
            patience: clampInt(edit.personality_patience, 0, 100, 50),
            priceSensitivity: clampInt(edit.personality_priceSensitivity, 0, 100, 50),
            decisiveness: clampInt(edit.personality_decisiveness, 0, 100, 50),
            skepticism: clampInt(edit.personality_skepticism, 0, 100, 40),
            socialActivity: clampInt(edit.personality_socialActivity, 0, 100, 50),
            emotionalVolatility: clampInt(edit.personality_emotionalVolatility, 0, 100, 50),
        },
        communication: {
            style: edit.communication_style,
            verbosity: edit.communication_verbosity,
            emotionLevel: edit.communication_emotionLevel,
            dialect: edit.communication_dialect,
            ...(typeof edit.communication_catchphrase === 'string' && edit.communication_catchphrase.trim().length > 0
                ? { catchphrase: edit.communication_catchphrase.trim() }
                : {}),
        },
        consumption: {
            budgetMin: clampInt(edit.consumption_budgetMin, 0, 1_000_000, 100),
            budgetMax: clampInt(edit.consumption_budgetMax, 0, 1_000_000, 500),
            decisionCycle: edit.consumption_decisionCycle,
            brandLoyalty: edit.consumption_brandLoyalty,
            ...(typeof edit.consumption_skinType === 'string' ? { skinType: edit.consumption_skinType } : {}),
            skinConcerns: mergeSkinConcerns(edit.skinConcernsList, edit.consumption_skinConcerns),
            healthGoals: parseLines(edit.consumption_healthGoals ?? ''),
            ...(typeof edit.consumption_purchaseChannel === 'string' ? { purchaseChannel: edit.consumption_purchaseChannel } : {}),
            ...(typeof edit.consumption_ingredientFocus === 'string' ? { ingredientFocus: edit.consumption_ingredientFocus } : {}),
            ...(typeof edit.consumption_competitorComparison === 'string' ? { competitorComparison: edit.consumption_competitorComparison } : {}),
            allergies: parseLines(edit.consumption_allergies ?? ''),
            ...(typeof edit.consumption_currentProducts === 'string' && edit.consumption_currentProducts.trim().length > 0
                ? { currentProducts: edit.consumption_currentProducts.trim() }
                : {}),
        },
        conversation: {
            difficulty: clampInt(edit.conversation_difficulty, 1, 4, 2),
            maxTurns: clampInt(edit.conversation_maxTurns, 1, 100, 15),
            background: edit.conversation_background?.trim() || '这位客户通过朋友圈了解到产品信息，想进一步咨询。',
            productScenario,
            ...(typeof edit.conversation_openingMode === 'string' ? { openingMode: edit.conversation_openingMode } : {}),
            ...(typeof edit.conversation_customNotes === 'string' && edit.conversation_customNotes.trim().length > 0
                ? { customNotes: edit.conversation_customNotes.trim() }
                : {}),
        },
    };
}
function clampInt(value, min, max, fallback) {
    const number = Number(value);
    if (!Number.isFinite(number))
        return fallback;
    return Math.min(max, Math.max(min, Math.round(number)));
}
function parseLines(text) {
    if (typeof text !== 'string')
        return [];
    const seen = new Set();
    const result = [];
    for (const raw of text.split(/[\s,，、;；]+/u)) {
        const item = raw.trim();
        if (item.length === 0 || seen.has(item))
            continue;
        seen.add(item);
        result.push(item);
    }
    return result;
}
/** 皮肤问题 = 词表勾选项（skinConcernsList）+ 自定义补充（textarea），合并去重。 */
function mergeSkinConcerns(list, customText) {
    const result = [];
    const seen = new Set();
    const push = (item) => {
        const value = typeof item === 'string' ? item.trim() : '';
        if (value.length === 0 || seen.has(value))
            return;
        seen.add(value);
        result.push(value);
    };
    (Array.isArray(list) ? list : []).forEach(push);
    parseLines(customText ?? '').forEach(push);
    return result;
}
function formatDiffValue(value) {
    if (value === undefined)
        return '<span class="text-muted">—（新增）</span>';
    if (value === null)
        return '<span class="text-muted">—（移除）</span>';
    if (Array.isArray(value))
        return value.length === 0 ? '<span class="text-muted">空数组</span>' : escapeHtml(value.join('、'));
    if (typeof value === 'object')
        return '<code class="mono">' + escapeHtml(JSON.stringify(value)) + '</code>';
    return escapeHtml(String(value));
}
