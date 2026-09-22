import { parseLines } from './labels.js';
const NAV_ITEMS = [
    { route: 'templates', label: '陪练模板' },
    { route: 'scenarios', label: '场景管理' },
    { route: 'assignments', label: '任务投放' },
    { route: 'learners', label: '学员档案' },
    { route: 'analytics', label: '结果复盘' },
    { route: 'knowledge', label: '产品知识库' },
    { route: 'scoring', label: '评分配置' },
];
function renderShell(application) {
    const nav = NAV_ITEMS.map((item) => {
        const active = application.currentRoute === item.route ? ' active' : '';
        return `<button type="button" class="nav-item${active}" data-route="${item.route}"><span class="nav-dot"></span>${item.label}</button>`;
    }).join('');
    return `<div class="app-shell">
    <aside class="sidebar">
      <div class="brand"><span class="brand-name">神首公主购陪练</span><span class="brand-sub">运营管理端</span></div>
      ${nav}
      <div class="sidebar-footer">公主购 AI 陪练 · 内部运营端</div>
    </aside>
    <main class="content">${application.render()}</main>
  </div>`;
}
export function mountAdminApplication(root, application) {
    const rerender = () => {
        root.innerHTML = renderShell(application);
        bindHandlers();
    };
    const bindHandlers = () => {
        root.querySelectorAll('button[data-route]').forEach((button) => {
            button.addEventListener('click', () => {
                const route = button.dataset.route;
                application.navigate(route);
                rerender();
                if (route === 'templates')
                    void application.templates.load().then(rerender);
                else if (route === 'scenarios')
                    void application.scenarios.load().then(rerender);
                else if (route === 'assignments')
                    void application.assignments.load().then(rerender);
                else if (route === 'learners')
                    void application.learners.load().then(rerender);
                else if (route === 'analytics')
                    void application.analytics.load().then(rerender);
                else if (route === 'knowledge')
                    void application.knowledge.load().then(rerender);
                else if (route === 'scoring')
                    void application.scoring.load().then(rerender);
            });
        });
        root.querySelectorAll('form[data-action]').forEach((form) => {
            form.addEventListener('submit', (event) => {
                event.preventDefault();
                // 传入 event.submitter，被点击的提交按钮（如 name=status / name=op）才会进入 FormData。
                const values = new FormData(form, event.submitter ?? undefined);
                void submitForm(application, form, values).then(rerender).catch((error) => {
                    root.innerHTML = renderFatal(error);
                    // 错误页仍保留左侧导航，运营可直接切换菜单恢复，无需整页刷新
                    bindHandlers();
                });
            });
        });
        // 方案 B：快速创建页「经典年龄预设」切换 + 人群/年龄卡互斥
        const toggleBtn = root.querySelector('#toggle-classic-cards');
        if (toggleBtn !== null) {
            const cohortGrid = root.querySelector('#cohort-grid');
            const ageGrid = root.querySelector('#age-card-grid');
            toggleBtn.addEventListener('click', () => {
                const showingClassic = ageGrid !== null && ageGrid.style.display !== 'none';
                if (showingClassic) {
                    if (cohortGrid !== null) cohortGrid.style.display = '';
                    if (ageGrid !== null) ageGrid.style.display = 'none';
                    toggleBtn.textContent = '使用经典年龄预设（小姐姐/御姐…）';
                } else {
                    if (cohortGrid !== null) cohortGrid.style.display = 'none';
                    if (ageGrid !== null) ageGrid.style.display = '';
                    toggleBtn.textContent = '返回 8 大人群选择';
                }
            });
            // 互斥：选人群时清除年龄卡，选年龄卡时清除人群
            root.querySelectorAll('input[name="cohort"]').forEach((radio) => {
                radio.addEventListener('change', () => {
                    root.querySelectorAll('input[name="ageCard"]').forEach((r) => { r.checked = false; });
                });
            });
            root.querySelectorAll('input[name="ageCard"]').forEach((radio) => {
                radio.addEventListener('change', () => {
                    root.querySelectorAll('input[name="cohort"]').forEach((r) => { r.checked = false; });
                });
            });
        }
        // ===== 产品知识库页面（v2）=====
        root.querySelectorAll('button[data-k-tab]').forEach((btn) => {
            btn.addEventListener('click', () => { application.knowledge.tab = btn.dataset.kTab; application.knowledge.editingProduct = null; application.knowledge.deletingId = null; rerender(); });
        });
        root.querySelectorAll('button[data-k-action]').forEach((btn) => {
            btn.addEventListener('click', async () => {
                const action = btn.dataset.kAction;
                if (action === 'new') { application.knowledge.editingProduct = 'new'; rerender(); }
                else if (action === 'close') { application.knowledge.editingProduct = null; rerender(); }
                else if (action === 'save') { await saveKnowledgeProduct(application, rerender); }
            });
        });
        root.querySelectorAll('button[data-k-edit]').forEach((btn) => {
            btn.addEventListener('click', () => {
                const p = application.knowledge.products.find((x) => x.id === btn.dataset.kEdit);
                if (p) { application.knowledge.editingProduct = p; rerender(); }
            });
        });
        root.querySelectorAll('button[data-k-delete]').forEach((btn) => {
            btn.addEventListener('click', async () => {
                const id = btn.dataset.kDelete;
                if (application.knowledge.deletingId === id) {
                    await application.client.delete(`/knowledge/products/${id}`);
                    application.knowledge.deletingId = null;
                    await application.knowledge.load();
                    rerender();
                } else {
                    application.knowledge.deletingId = id;
                    rerender();
                    setTimeout(() => { if (application.knowledge.deletingId === id) { application.knowledge.deletingId = null; rerender(); } }, 3000);
                }
            });
        });
        const kSearch = root.querySelector('input[data-k-search]');
        if (kSearch !== null) {
            kSearch.addEventListener('input', (e) => { application.knowledge.search = e.target.value; rerender(); });
        }
        const kFilter = root.querySelector('select[data-k-filter]');
        if (kFilter !== null) {
            kFilter.addEventListener('change', (e) => { application.knowledge.filterCategory = e.target.value; rerender(); });
        }
        root.querySelectorAll('[data-k-modal-close]').forEach((el) => {
            el.addEventListener('click', () => { application.knowledge.editingProduct = null; rerender(); });
        });
        // chip 点击切换
        root.querySelectorAll('.k-chip input[type="checkbox"]').forEach((cb) => {
            cb.addEventListener('change', () => { cb.closest('.k-chip').classList.toggle('selected', cb.checked); });
        });

        // 评分模板维度组合 - checkbox 联动权重输入
        root.querySelectorAll('input[name^="tpl_dim_"]').forEach((cb) => {
            cb.addEventListener('change', () => {
                const dimId = cb.value;
                const weightInput = root.querySelector(`input[name="tpl_weight_${dimId}"]`);
                const row = cb.closest('.k-tpl-dim-row');
                if (weightInput) weightInput.disabled = !cb.checked;
                if (row) row.classList.toggle('selected', cb.checked);
                const countEl = root.querySelector('#tpl-dim-count');
                if (countEl) {
                    const checked = root.querySelectorAll('input[name^="tpl_dim_"]:checked').length;
                    countEl.textContent = checked;
                }
            });
        });

        // ===== 任务投放页：返回第1步按钮 =====
        bindAssignmentBackButton(root, application, rerender);

        // ===== 评分配置页面（v2）=====
        root.querySelectorAll('button[data-s-action]').forEach((btn) => {
            btn.addEventListener('click', async () => {
                const action = btn.dataset.sAction;
                if (action === 'new') { application.scoring.editingId = 'new'; rerender(); }
                else if (action === 'close') { application.scoring.editingId = null; rerender(); }
                else if (action === 'save') { await saveScoringDimension(application, rerender); }
                else if (action === 'edit-template') {
                    application.scoring.editingTemplateId = btn.dataset.templateId;
                    await application.scoring.loadTemplateDimensions(btn.dataset.templateId);
                    rerender();
                }
                else if (action === 'close-template') { application.scoring.editingTemplateId = null; rerender(); }
                else if (action === 'save-template') { await saveScoringTemplate(application, rerender); }
            });
        });
        root.querySelectorAll('button[data-s-edit]').forEach((btn) => {
            btn.addEventListener('click', () => { application.scoring.editingId = btn.dataset.sEdit; rerender(); });
        });
        root.querySelectorAll('button[data-s-delete]').forEach((btn) => {
            btn.addEventListener('click', async () => {
                const id = btn.dataset.sDelete;
                if (application.scoring.deletingId === id) {
                    await application.client.delete(`/scoring/dimensions/${id}`);
                    application.scoring.deletingId = null;
                    await application.scoring.load();
                    rerender();
                } else {
                    application.scoring.deletingId = id;
                    rerender();
                    setTimeout(() => { if (application.scoring.deletingId === id) { application.scoring.deletingId = null; rerender(); } }, 3000);
                }
            });
        });
        root.querySelectorAll('[data-s-modal-close]').forEach((el) => {
            el.addEventListener('click', () => { application.scoring.editingId = null; application.scoring.editingTemplateId = null; rerender(); });
        });
    };
    // Paint the shell synchronously first, then refresh data-driven views
    // asynchronously, so a slow or failed initial load never leaves a blank page.
    rerender();
    void application.templates.load().then(rerender);
}
async function submitForm(application, _form, values) {
    const action = _form.dataset.action;
    if (action === 'create-template') {
        if (readOptionalText(values, 'mode') === 'full')
            return application.templates.beginCreate();
        return application.templates.createFromSelection(toTemplateSelection(values));
    }
    if (action === 'template-save-full') {
        if (readOptionalText(values, 'cancel') === '1') {
            application.templates.cancelEdit();
            return;
        }
        return application.templates.saveFullEditor(toFullTemplateEdit(values));
    }
    if (action === 'template-filter')
        return application.templates.setFilter(readTemplateFilter(values));
    if (action === 'template-row-op') {
        const { id, op } = readTemplateRowOp(values);
        return application.templates.rowOp(id, op);
    }
    if (action === 'template-save-full')
        return application.templates.saveFullEditor(toFullTemplateEdit(values));
    if (action === 'template-diff') {
        const { id, from, to } = readTemplateDiff(values);
        return application.templates.computeDiff(id, from, to);
    }
    if (action === 'template-close-panel') {
        application.templates.closePanel();
        return;
    }
    if (action === 'template-cancel') {
        application.templates.cancelEdit();
        return;
    }
    if (action === 'create-scenario') {
        await application.scenarios.create(toScenarioDraftPayload(values));
        return;
    }
    if (action === 'scenario-op') {
        const { selectedId, op } = readScenarioOperation(values);
        return application.scenarios.runOp(selectedId, op);
    }
    if (action === 'scenario-upgrade') {
        const id = readText(values, 'scenarioId');
        return application.scenarios.upgradeTemplate(id);
    }
    if (action === 'update-scenario') {
        await application.scenarios.updateSelected(toScenarioUpdate(values));
        return;
    }
    if (action === 'preview-assignment')
        return application.assignments.preview(toAssignmentTargets(values));
    if (action === 'create-assignment')
        return application.assignments.create(toAssignmentCreate(values));
    if (action === 'assignment-filter')
        return application.assignments.setFilter(readAssignmentFilter(values));
    if (action === 'assignment-status-op') {
        const { id, status } = readAssignmentStatusOp(values);
        return application.assignments.changeStatus(id, status);
    }
    if (action === 'assignment-override-op') {
        const { id, overridePatch } = readAssignmentOverrideOp(values);
        return application.assignments.updateOverride(id, overridePatch);
    }
    if (action === 'assignment-override-toggle') {
        const id = readOptionalText(values, 'assignmentId');
        if (id === undefined || id.length === 0)
            throw new Error('An assignment is required for this operation.');
        application.assignments.toggleOverrideEditor(id);
        return;
    }
    if (action === 'learner-search')
        return application.learners.search(readLearnerSearch(values));
    if (action === 'learner-open') {
        const { id } = readLearnerOpen(values);
        return application.learners.openLearner(id);
    }
    if (action === 'learner-page')
        return application.learners.goPage(readLearnerPage(values));
    if (action === 'learner-close') {
        application.learners.closeLearner();
        return;
    }
    if (action === 'evaluation-filter')
        return application.analytics.setSource(readEvaluationFilter(values));
    if (action === 'evaluation-replay') {
        const { id } = readEvaluationReplay(values);
        return application.analytics.openReplay(id);
    }
    if (action === 'evaluation-page')
        return application.analytics.goPage(readEvaluationPage(values));
    if (action === 'evaluation-close') {
        application.analytics.closeReplay();
        return;
    }
    throw new Error('Unknown administrator form action.');
}
/**
 * 把引导式建模板表单（业务 name）整理成 TemplateSelection：
 * 心理倾向多选、知识/评分多行解析；不读取、也不要求任何 JSON。
 */
export function toTemplateSelection(values) {
    const psychologyCardIds = values.getAll('psychology').filter((entry) => typeof entry === 'string');
    const selection = {
        // 方案 B：ageCardId 可选（经典年龄预设），customerCohort 为主选择（8 大人群）
        ageCardId: readOptionalText(values, 'ageCard') ?? '',
        psychologyCardIds,
        difficulty: Number(readOptionalText(values, 'difficulty') ?? 0),
        productScenarioId: readOptionalText(values, 'scenario') ?? '',
    };
    // 方案 B：第一选择区的人群卡片（name=cohort），作为主选择驱动画像生成
    const cohort = readOptionalText(values, 'cohort');
    if (cohort !== undefined && cohort.length > 0)
        selection.customerCohort = cohort;
    // v2 可选维度：城市 / 客户定位 / 信任度（仅选中时下发）
    const city = readOptionalText(values, 'city');
    if (city !== undefined && city.trim().length > 0)
        selection.city = city.trim();
    const customerRelation = readOptionalText(values, 'customerRelation');
    if (customerRelation !== undefined && customerRelation.length > 0)
        selection.customerRelation = customerRelation;
    const trustLevel = readOptionalText(values, 'trustLevel');
    if (trustLevel !== undefined && trustLevel.length > 0)
        selection.trustLevel = Number(trustLevel);
    const title = readOptionalText(values, 'title');
    if (title !== undefined && title.length > 0)
        selection.title = title;
    const knowledgeVersions = parseLines(readOptionalText(values, 'knowledge') ?? '');
    if (knowledgeVersions.length > 0)
        selection.knowledgeVersions = knowledgeVersions;
    const scoringRules = parseLines(readOptionalText(values, 'rules') ?? '');
    if (scoringRules.length > 0)
        selection.scoringRules = scoringRules;
    return selection;
}
/** 模板库状态筛选：只接受三个合法值，其余视为编程错误。 */
export function readTemplateFilter(values) {
    const status = readOptionalText(values, 'status');
    if (status === 'active' || status === 'archived' || status === 'all')
        return status;
    throw new Error('Unsupported template status filter.');
}
/** 单行操作：隐藏 templateId 串联行，提交按钮决定 edit/archive/activate/duplicate/history/bindings。 */
export function readTemplateRowOp(values) {
    const id = readOptionalText(values, 'templateId');
    if (id === undefined || id.length === 0)
        throw new Error('A template is required for this operation.');
    const op = readOptionalText(values, 'op');
    if (op !== 'edit' && op !== 'archive' && op !== 'activate'
        && op !== 'duplicate' && op !== 'history' && op !== 'bindings')
        throw new Error('Unsupported template operation.');
    return { id, op };
}
/** revision 历史面板的差异对比：读两个版本号（from < to）。 */
export function readTemplateDiff(values) {
    const id = readOptionalText(values, 'templateId');
    if (id === undefined || id.length === 0)
        throw new Error('A template is required for this operation.');
    const from = readOptionalText(values, 'from') ?? '';
    const to = readOptionalText(values, 'to') ?? '';
    return { id, from, to };
}
/** 完整编辑器表单：把所有带 name 的控件收进扁平 Map，供页面组装 PersonaConfig。 */
export function toFullTemplateEdit(values) {
    const edit = {};
    const entries = values.entries();
    for (const [name, raw] of entries) {
        if (typeof raw !== 'string')
            continue;
        if (name === 'policy_visible' || name === 'policy_recommended') {
            // 隐藏 input 保证未勾选也有值（"false"），勾选时 checkbox 的 "true" 覆盖。
            edit[name] = raw === 'true';
            continue;
        }
        if (name === 'skinConcern') {
            // 皮肤问题词表多选：同名 checkbox 收成数组，与自定义补充框合并。
            if (!Array.isArray(edit.skinConcernsList))
                edit.skinConcernsList = [];
            edit.skinConcernsList.push(raw);
            continue;
        }
        if (name === 'recommendedScoringTemplateIds') {
            // 推荐评分模板多选：同名 checkbox 收成数组。
            if (!Array.isArray(edit.recommendedScoringTemplateIds))
                edit.recommendedScoringTemplateIds = [];
            edit.recommendedScoringTemplateIds.push(raw);
            continue;
        }
        edit[name] = raw;
    }
    return edit;
}
/** 内联编辑表单：标题去空白、要点按行拆分，空字段不下发。 */
export function toTemplateEdit(values) {
    const id = readOptionalText(values, 'templateId');
    if (id === undefined || id.length === 0)
        throw new Error('A template is required for this operation.');
    const edit = { id };
    const title = readOptionalText(values, 'title');
    if (title !== undefined && title.length > 0)
        edit.title = title;
    const knowledgeVersions = parseLines(readOptionalText(values, 'knowledge') ?? '');
    if (knowledgeVersions.length > 0)
        edit.knowledgeVersions = knowledgeVersions;
    const scoringRules = parseLines(readOptionalText(values, 'rules') ?? '');
    if (scoringRules.length > 0)
        edit.scoringRules = scoringRules;
    return edit;
}
/** 新建场景表单：业务内容 + 人设来源（模板版本绑定或独立配置 JSON）；agentConfig 对运营隐藏，缺省空对象。 */
export function toScenarioDraftPayload(values) {
    const title = readOptionalText(values, 'title');
    if (title === undefined || title.length === 0)
        throw new Error('Scenario title is required.');
    const agentConfig = readOptionalText(values, 'agentConfig');
    const payload = {
        title,
        knowledgeVersions: parseLines(readOptionalText(values, 'knowledgeVersions') ?? ''),
        scoringRules: parseLines(readOptionalText(values, 'scoringRules') ?? ''),
        agentConfig: agentConfig === undefined || agentConfig.length === 0 ? {} : readJsonObject(agentConfig),
    };
    const personaSource = readPersonaSource(values);
    if (personaSource !== undefined)
        payload.personaSource = personaSource;
    return payload;
}
/** 从创建/编辑表单读人设来源：template_revision 需要模板 id 与版本；inline 需要完整 JSON。 */
export function readPersonaSource(values) {
    const kind = readOptionalText(values, 'personaSourceKind');
    if (kind === 'template_revision') {
        const raw = readOptionalText(values, 'personaTemplateId');
        if (raw === undefined || raw.length === 0)
            return undefined;
        // 选项值编码为 templateId::revision，拆分还原；缺版本号视为未选。
        const [templateId, revisionText] = raw.split('::');
        const revision = Number(revisionText);
        if (templateId === undefined || templateId.length === 0 || !Number.isInteger(revision) || revision < 1)
            return undefined;
        return { kind: 'template_revision', templateId, revision };
    }
    if (kind === 'inline') {
        const raw = readOptionalText(values, 'personaConfigJson');
        if (raw === undefined || raw.length === 0)
            return undefined;
        const personaConfig = readJsonObject(raw);
        return { kind: 'inline', personaConfig };
    }
    return undefined;
}
/** 草稿列表上的「检查 / 发布预览 / 发布」操作：从选中的单选行取草稿，从提交按钮取操作类型。 */
export function readScenarioOperation(values) {
    const selectedId = readOptionalText(values, 'selectedScenario');
    const op = readOptionalText(values, 'op');
    if (selectedId === undefined || selectedId.length === 0) {
        throw new Error('Please select a scenario before checking or publishing.');
    }
    if (op !== 'validate' && op !== 'publish' && op !== 'publish-preview')
        throw new Error('Unsupported scenario operation.');
    return { selectedId, op };
}
export function toScenarioUpdate(values) {
    const update = {};
    const title = readOptionalText(values, 'title');
    const knowledgeVersions = readOptionalText(values, 'knowledgeVersions');
    const scoringRules = readOptionalText(values, 'scoringRules');
    const agentConfig = readOptionalText(values, 'agentConfig');
    if (title !== undefined && title.length > 0)
        update.title = title;
    if (knowledgeVersions !== undefined && knowledgeVersions.length > 0)
        update.knowledgeVersions = parseLines(knowledgeVersions);
    if (scoringRules !== undefined && scoringRules.length > 0)
        update.scoringRules = parseLines(scoringRules);
    if (agentConfig !== undefined && agentConfig.length > 0)
        update.agentConfig = readJsonObject(agentConfig);
    const personaSource = readPersonaSource(values);
    if (personaSource !== undefined)
        update.personaSource = personaSource;
    return update;
}
/** 下发任务表单：不读取内部 id（后端生成）；datetime-local 转 ISO；账号按行去重。 */
export function toAssignmentCreate(values) {
    const status = readText(values, 'status');
    const isScheduled = status === 'scheduled';
    const startsAt = isScheduled ? toIso(readText(values, 'startsAt')) : null;
    const endsAt = isScheduled ? toIso(readText(values, 'endsAt')) : null;
    const scoringTemplateId = readOptionalText(values, 'scoringTemplateId');
    return {
        releaseSnapshotId: readText(values, 'releaseSnapshotId'),
        name: readText(values, 'name'),
        status: isScheduled ? 'active' : status, // scheduled 在前端只是控制时间显示，后端用 active + startsAt
        startsAt,
        endsAt,
        maxAttempts: Number(readText(values, 'maxAttempts')),
        targetPrincipalIds: parseLines(readOptionalText(values, 'targetPrincipalIds') ?? ''),
        overridePatch: readOverridePatchFields(values),
        scoringTemplateId: scoringTemplateId && scoringTemplateId.length > 0 ? scoringTemplateId : null,
    };
}
/**
 * 任务级参数覆盖（spec §6.4 扩展）：表单缺省字段表示不覆盖，返回 null 表示无覆盖。
 * 覆盖范围 = AgentConfigV1 6 项 + conversation.maxTurns/openingMode/background。
 */
export function readOverridePatchFields(values) {
    const agentConfig = {};
    const historyMessageLimit = readOptionalText(values, 'agentHistoryMessageLimit');
    if (historyMessageLimit !== undefined && historyMessageLimit.trim().length > 0) {
        const parsed = Number(historyMessageLimit);
        if (!Number.isInteger(parsed) || parsed < 2 || parsed > 50)
            throw new Error('历史消息条数需为 2-50 的整数。');
        agentConfig.historyMessageLimit = parsed;
    }
    const responseLength = readOptionalText(values, 'agentResponseLength');
    if (responseLength !== undefined && responseLength !== '')
        agentConfig.responseLength = responseLength;
    const knowledgeStrictness = readOptionalText(values, 'agentKnowledgeStrictness');
    if (knowledgeStrictness !== undefined && knowledgeStrictness !== '')
        agentConfig.knowledgeStrictness = knowledgeStrictness;
    const conversationPace = readOptionalText(values, 'agentConversationPace');
    if (conversationPace !== undefined && conversationPace !== '')
        agentConfig.conversationPace = conversationPace;
    const closingTendency = readOptionalText(values, 'agentClosingTendency');
    if (closingTendency !== undefined && closingTendency !== '')
        agentConfig.closingTendency = closingTendency;
    const additionalInstructions = readOptionalText(values, 'agentAdditionalInstructions');
    if (additionalInstructions !== undefined && additionalInstructions.trim().length > 0) {
        if (additionalInstructions.length > 1000)
            throw new Error('额外行为指令最多 1000 字符。');
        agentConfig.additionalInstructions = additionalInstructions;
    }

    const conversation = {};
    const maxTurns = readOptionalText(values, 'conversationMaxTurns');
    if (maxTurns !== undefined && maxTurns.trim().length > 0) {
        const parsed = Number(maxTurns);
        if (!Number.isInteger(parsed) || parsed < 1 || parsed > 100)
            throw new Error('最大轮数需为 1-100 的整数。');
        conversation.maxTurns = parsed;
    }
    const openingMode = readOptionalText(values, 'conversationOpeningMode');
    if (openingMode !== undefined && openingMode !== '')
        conversation.openingMode = openingMode;
    const background = readOptionalText(values, 'conversationBackground');
    if (background !== undefined && background.trim().length > 0) {
        if (background.length > 500)
            throw new Error('客户背景最多 500 字符。');
        conversation.background = background;
    }

    const patch = {};
    if (Object.keys(agentConfig).length > 0)
        patch.agentConfig = agentConfig;
    if (Object.keys(conversation).length > 0)
        patch.conversation = conversation;
    return Object.keys(patch).length > 0 ? patch : null;
}
/** 编辑任务覆盖表单：hidden assignmentId + 覆盖字段；未填字段表示不修改。clearOverride=1 表示清空覆盖。 */
export function readAssignmentOverrideOp(values) {
    const id = readOptionalText(values, 'assignmentId');
    if (id === undefined || id.length === 0)
        throw new Error('An assignment is required for this operation.');
    const clear = values.get('clearOverride') === '1';
    return { id, overridePatch: clear ? null : readOverridePatchFields(values) };
}
/** 任务列表行状态动作：隐藏 assignmentId 串联行，提交按钮决定目标状态。 */
export function readAssignmentStatusOp(values) {
    const id = readOptionalText(values, 'assignmentId');
    if (id === undefined || id.length === 0)
        throw new Error('An assignment is required for this operation.');
    const status = readOptionalText(values, 'status');
    if (status !== 'active' && status !== 'paused' && status !== 'ended' && status !== 'draft') {
        throw new Error('Unsupported assignment status.');
    }
    return { id, status };
}
export function readAssignmentFilter(values) {
    const status = readOptionalText(values, 'status') ?? 'all';
    if (status !== 'all' && status !== 'active' && status !== 'paused' && status !== 'ended' && status !== 'draft') {
        throw new Error('Unsupported assignment status filter.');
    }
    return status;
}
/**
 * 投放对象解析：手填多行账号 + 已沉淀主播勾选合并，去空、去重、保序。
 */
export function toAssignmentTargets(values) {
    const manual = parseLines(readOptionalText(values, 'targetPrincipalIds') ?? '');
    const selected = values.getAll('selectedPrincipal').filter((entry) => typeof entry === 'string').map((entry) => entry.trim());
    const seen = new Set();
    const result = [];
    for (const account of [...manual, ...selected]) {
        if (account.length === 0 || seen.has(account))
            continue;
        seen.add(account);
        result.push(account);
    }
    return result;
}
/** 学员搜索词：去空白；空串表示清空搜索。 */
export function readLearnerSearch(values) {
    return readOptionalText(values, 'q') ?? '';
}
/** 打开学员档案：隐藏 learnerId 串联行。 */
export function readLearnerOpen(values) {
    const id = readOptionalText(values, 'learnerId');
    if (id === undefined || id.length === 0)
        throw new Error('A learner is required for this operation.');
    return { id };
}
/** 学员列表翻页方向，只接受 next/prev。 */
export function readLearnerPage(values) {
    const direction = readOptionalText(values, 'direction');
    if (direction !== 'next' && direction !== 'prev')
        throw new Error('Unsupported learner page direction.');
    return direction;
}
/** 复盘来源筛选：只接受全部/自由练习/团队任务三个合法值。 */
export function readEvaluationFilter(values) {
    const source = readOptionalText(values, 'source') ?? 'all';
    if (source !== 'all' && source !== 'free' && source !== 'assigned') {
        throw new Error('Unsupported evaluation source filter.');
    }
    return source;
}
/** 打开对话回放：隐藏 conversationId 串联行。 */
export function readEvaluationReplay(values) {
    const id = readOptionalText(values, 'conversationId');
    if (id === undefined || id.length === 0)
        throw new Error('A conversation is required for replay.');
    return { id };
}
/** 复盘列表翻页方向，只接受 next/prev。 */
export function readEvaluationPage(values) {
    const direction = readOptionalText(values, 'direction');
    if (direction !== 'next' && direction !== 'prev')
        throw new Error('Unsupported evaluation page direction.');
    return direction;
}
function toIso(localValue) {
    const date = new Date(localValue);
    if (Number.isNaN(date.getTime()))
        throw new Error('A valid date time is required.');
    return date.toISOString();
}
function readText(values, name) {
    const value = readOptionalText(values, name);
    if (value === undefined || value.length === 0)
        throw new Error(`${name} is required.`);
    return value;
}
function readOptionalText(values, name) {
    const value = values.get(name);
    return typeof value === 'string' ? value.trim() : undefined;
}
function readJsonObject(value) {
    const parsed = JSON.parse(value);
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed))
        throw new Error('Configuration must be a JSON object.');
    return parsed;
}
function renderFatal(error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    const safe = message.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;');
    const nav = NAV_ITEMS.map((item) => `<button type="button" class="nav-item" data-route="${item.route}"><span class="nav-dot"></span>${item.label}</button>`).join('');
    return `<div class="app-shell">
    <aside class="sidebar">
      <div class="brand"><span class="brand-name">神首公主购陪练</span><span class="brand-sub">运营管理端</span></div>
      ${nav}
      <div class="sidebar-footer">公主购 AI 陪练 · 内部运营端</div>
    </aside>
    <main class="content">
      <div class="page-header"><div class="page-title">操作未完成</div></div>
      <div class="alert alert-error" role="alert"><strong>操作失败，请重试</strong>${safe}<span class="text-muted" style="display:block;margin-top:8px">可通过左侧菜单切换页面继续操作，无需刷新整个页面。</span></div>
    </main>
  </div>`;
}

// ===== v2 页面保存辅助函数 =====
function collectChipValues(root, name) {
    return Array.from(root.querySelectorAll(`input[name="${name}"]:checked`)).map((i) => i.value);
}
function collectCsv(value) {
    return String(value || '').split(',').map((s) => s.trim()).filter(Boolean);
}
async function saveKnowledgeProduct(application, rerender) {
    const root = document;
    const form = root.querySelector('#k-product-form');
    if (!form) return;
    const fd = new FormData(form);
    const payload = {
        name: String(fd.get('name') || ''),
        aliases: collectCsv(fd.get('aliases')),
        category: String(fd.get('category') || '其他'),
        coreEfficacies: collectChipValues(root, 'coreEfficacies'),
        suitableSkinTypes: collectChipValues(root, 'suitableSkinTypes'),
        priceRange: String(fd.get('priceRange') || ''),
        keyIngredients: collectCsv(fd.get('keyIngredients')),
        keySellingPoints: String(fd.get('keySellingPoints') || ''),
        contraindicatedSkinTypes: [],
        contraindicatedAudience: String(fd.get('contraindicatedAudience') || ''),
    };
    const isNew = application.knowledge.editingProduct === 'new';
    if (isNew) { await application.client.post('/knowledge/products', payload); }
    else { await application.client.put(`/knowledge/products/${application.knowledge.editingProduct.id}`, payload); }
    application.knowledge.editingProduct = null;
    await application.knowledge.load();
    rerender();
}
async function saveScoringDimension(application, rerender) {
    const root = document;
    const form = root.querySelector('#s-dim-form');
    if (!form) return;
    const fd = new FormData(form);
    const payload = {
        name: String(fd.get('name') || ''),
        description: String(fd.get('description') || ''),
        weight: Number(fd.get('weight') || 0),
        isConfigured: String(fd.get('isConfigured')) === 'true',
        knowledgeDependencies: collectChipValues(root, 'knowledgeDependencies'),
        llmPrompt: String(fd.get('llmPrompt') || ''),
        keywords: collectCsv(fd.get('keywords')),
        gradingRubric: {
            excellent: Number(fd.get('rubric_excellent') || 90),
            good: Number(fd.get('rubric_good') || 80),
            fair: Number(fd.get('rubric_fair') || 70),
            pass: Number(fd.get('rubric_pass') || 60),
        },
    };
    const isNew = application.scoring.editingId === 'new';
    if (isNew) { await application.client.post('/scoring/dimensions', payload); }
    else { await application.client.put(`/scoring/dimensions/${application.scoring.editingId}`, payload); }
    application.scoring.editingId = null;
    await application.scoring.load();
    rerender();
}

async function saveScoringTemplate(application, rerender) {
    const root = document.getElementById('app-root');
    const form = root.querySelector('#s-tpl-form');
    if (!form) return;
    const fd = new FormData(form);
    const templateId = application.scoring.editingTemplateId;

    // 1. 保存基本配置
    const payload = {
        name: String(fd.get('name') || ''),
        description: String(fd.get('description') || ''),
        evaluationMode: String(fd.get('evaluationMode') || 'grouped'),
        coachCommentPrompt: String(fd.get('coachCommentPrompt') || ''),
    };
    await application.client.put(`/scoring/templates/${templateId}`, payload);

    // 2. 保存维度组合（收集勾选的维度 + 模板级权重）
    const dimensions = [];
    const checkboxes = form.querySelectorAll('input[name^="tpl_dim_"]');
    let sortOrder = 0;
    checkboxes.forEach((cb) => {
        if (cb.checked) {
            const dimId = cb.value;
            const weightInput = form.querySelector(`input[name="tpl_weight_${dimId}"]`);
            const weightVal = weightInput ? weightInput.value.trim() : '';
            dimensions.push({
                dimensionId: dimId,
                weight: weightVal !== '' ? Number(weightVal) : null,
                sortOrder: sortOrder++,
            });
        }
    });
    await application.client.put(`/scoring/templates/${templateId}/dimensions`, { dimensions });

    application.scoring.editingTemplateId = null;
    application.scoring.templateDimensions = [];
    await application.scoring.load();
    rerender();
}

// ===== 任务投放页：投放状态切换时间显示 =====
window.__asToggleTime = function (status) {
    const row = document.getElementById('as-time-row');
    if (row) row.style.display = status === 'scheduled' ? 'flex' : 'none';
};

// ===== 任务投放页：返回第1步 =====
function bindAssignmentBackButton(root, application, rerender) {
    const btn = root.querySelector('button[data-action="back-to-step1"]');
    if (btn) {
        btn.addEventListener('click', () => {
            application.assignments.currentStep = 1;
            rerender();
        });
    }
}
