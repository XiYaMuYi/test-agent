export class AdminApiProblem extends Error {
    code;
    detail;
    status;
    constructor(problem) {
        super(problem.detail);
        this.name = 'AdminApiProblem';
        this.code = problem.code;
        this.detail = problem.detail;
        this.status = problem.status;
    }
}
const defaultRequestIdFactory = () => `admin-${Date.now()}-${Math.random().toString(16).slice(2)}`;
export class AdminApiClient {
    fetcher;
    options;
    constructor(fetcher, options) {
        this.fetcher = fetcher;
        this.options = {
            adminToken: options?.adminToken ?? '',
            requestIdFactory: options?.requestIdFactory ?? defaultRequestIdFactory,
        };
    }
    get(path) {
        return this.request(path, { method: 'GET' });
    }
    post(path, body) {
        return body === undefined
            ? this.request(path, { method: 'POST' })
            : this.request(path, { method: 'POST', body: JSON.stringify(body) });
    }
    patch(path, body) {
        return this.request(path, { method: 'PATCH', body: JSON.stringify(body) });
    }
    put(path, body) {
        return body === undefined
            ? this.request(path, { method: 'PUT' })
            : this.request(path, { method: 'PUT', body: JSON.stringify(body) });
    }
    delete(path) {
        return this.request(path, { method: 'DELETE' });
    }
    async listOrganizationTemplates(statusFilter) {
        const path = statusFilter && statusFilter !== 'active'
            ? `/admin/templates?status=${encodeURIComponent(statusFilter)}`
            : '/admin/templates';
        const payload = await this.get(path);
        if (typeof payload !== 'object' || payload === null || !Array.isArray(payload.items)) {
            throw new AdminApiProblem({ code: 'API_RESPONSE_INVALID', detail: 'Template list must be wrapped in an items array.', status: 502 });
        }
        return (payload.items).map(normalizeTemplateSummary);
    }
    async createOrganizationTemplate(input) {
        const payload = await this.post('/admin/templates', input);
        return normalizeTemplateSummary(payload);
    }
    /** 部分编辑组织模板（标题/知识/评分要点），画像配置不可改。 */
    async updateOrganizationTemplate(id, patch) {
        const payload = await this.patch(`/admin/templates/${encodeURIComponent(id)}`, patch);
        return normalizeTemplateSummary(payload);
    }
    /** 归档：对小程序学习者隐藏（不删除，保留历史会话）。 */
    archiveOrganizationTemplate(id) {
        return this.post(`/admin/templates/${encodeURIComponent(id)}/archive`).then(normalizeTemplateSummary);
    }
    /** 重新启用已归档模板。 */
    activateOrganizationTemplate(id) {
        return this.post(`/admin/templates/${encodeURIComponent(id)}/activate`).then(normalizeTemplateSummary);
    }
    /** 复制组织模板：生成新 templateId + revision 1（spec §6.2）。 */
    duplicateOrganizationTemplate(id) {
        return this.post(`/admin/templates/${encodeURIComponent(id)}/duplicate`).then(normalizeTemplateSummary);
    }
    /** 模板 revision 历史（按 revision 降序），含完整冻结配置。 */
    async listTemplateRevisions(id) {
        const payload = await this.get(`/admin/templates/${encodeURIComponent(id)}/revisions`);
        if (typeof payload !== 'object' || payload === null || !Array.isArray(payload.items)) {
            throw invalidResponse('Template revision list must be wrapped in an items array.');
        }
        return payload.items.map(normalizeTemplateRevision);
    }
    /** 任意两个 revision 的字段差异列表。 */
    async diffTemplateRevisions(id, from, to) {
        const payload = await this.get(`/admin/templates/${encodeURIComponent(id)}/diff?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`);
        if (typeof payload !== 'object' || payload === null || !Array.isArray(payload.items)) {
            throw invalidResponse('Template revision diff must be wrapped in an items array.');
        }
        return payload.items;
    }
    /** 哪些场景绑定了当前模板的（最新）revision。 */
    async listTemplateBindings(id) {
        const payload = await this.get(`/admin/templates/${encodeURIComponent(id)}/bindings`);
        if (typeof payload !== 'object' || payload === null || !Array.isArray(payload.items)) {
            throw invalidResponse('Template bindings must be wrapped in an items array.');
        }
        return payload.items;
    }
    /** B 端配置中心共享元数据（persona/agentConfig/override 枚举与范围，spec §6.1）。 */
    async getConfigMeta() {
        return this.get('/admin/config-meta');
    }
    /** 拉取画像预设业务目录（客户类型/心理/难度/产品场景），供引导式建模板。 */
    async getPersonaPresets() {
        const payload = await this.get('/me/persona/presets');
        return normalizePresetCatalog(payload);
    }
    /** 把用户的业务选择交给后端组装成冻结 PersonaConfig，前端不手写 JSON。 */
    async previewPersona(selection) {
        const payload = await this.post('/me/persona/preview', selection);
        return normalizePersonaSnapshot(payload);
    }
    /** 场景草稿列表（运营只看业务字段，内部 id 仅用于串联操作）。 */
    async listScenarios() {
        const payload = await this.get('/admin/scenarios');
        if (typeof payload !== 'object' || payload === null || !Array.isArray(payload.items)) {
            throw invalidResponse('Scenario list must be wrapped in an items array.');
        }
        return payload.items.map(normalizeScenarioDraftSummary);
    }
    /** 单个场景草稿详情（含 personaSource / agentConfig / 知识 / 评分），供编辑面板回显。 */
    async getScenarioDraft(id) {
        const payload = await this.get(`/admin/scenarios/${encodeURIComponent(id)}`);
        return normalizeScenarioDraftDetail(payload);
    }
    /** 发布前完整校验：返回 { valid, reason? }。 */
    async publishPreviewScenario(id) {
        return this.post(`/admin/scenarios/${encodeURIComponent(id)}/publish-preview`);
    }
    /** 把场景绑定升级到模板最新 revision：返回 { status: 'upgraded'|'noop' }。 */
    async upgradeScenarioTemplate(id) {
        return this.post(`/admin/scenarios/${encodeURIComponent(id)}/upgrade-template`);
    }
    /** 已发布不可变快照列表，供投放选择；可按草稿过滤。 */
    async listReleaseSnapshots(scenarioDraftId) {
        const path = scenarioDraftId
            ? `/admin/release-snapshots?scenarioDraftId=${encodeURIComponent(scenarioDraftId)}`
            : '/admin/release-snapshots';
        const payload = await this.get(path);
        if (typeof payload !== 'object' || payload === null || !Array.isArray(payload.items)) {
            throw invalidResponse('Release snapshot list must be wrapped in an items array.');
        }
        return payload.items.map(normalizeReleaseSnapshotSummary);
    }
    /** 创建场景草稿：不发送内部 id，由后端生成并返回。 */
    async createScenarioDraft(payload) {
        const result = await this.post('/admin/scenarios', { payload });
        if (typeof result !== 'object' || result === null || typeof result.id !== 'string') {
            throw invalidResponse('Scenario creation must return the server-generated id.');
        }
        return { id: result.id };
    }
    /** 运营任务列表（可按状态筛选），行内含场景名与学员进度聚合。 */
    async listAssignments(statusFilter) {
        const path = statusFilter && statusFilter !== 'all'
            ? `/admin/assignments?status=${encodeURIComponent(statusFilter)}`
            : '/admin/assignments';
        const payload = await this.get(path);
        if (typeof payload !== 'object' || payload === null || !Array.isArray(payload.items)) {
            throw invalidResponse('Assignment list must be wrapped in an items array.');
        }
        return payload.items.map(normalizeAssignmentSummary);
    }
    /** 创建任务：不发送内部 id，由后端生成并返回 assignmentId。 */
    async createAssignment(input) {
        const result = await this.post('/admin/assignments', input);
        if (typeof result !== 'object' || result === null || typeof result.assignmentId !== 'string') {
            throw invalidResponse('Assignment creation must return the server-generated assignmentId.');
        }
        return { assignmentId: result.assignmentId };
    }
    /** 任务状态机动作（active/paused/ended），动作端点返回 200。 */
    async changeAssignmentStatus(id, status) {
        const payload = await this.post(`/admin/assignments/${encodeURIComponent(id)}/status`, { status });
        return normalizeAssignmentSummary(payload);
    }
    /** 更新任务级参数覆盖：只影响之后新开的会话，历史会话冻结。 */
    async updateAssignmentOverride(id, overridePatch) {
        const payload = await this.patch(`/admin/assignments/${encodeURIComponent(id)}/override`, { overridePatch });
        return normalizeAssignmentSummary(payload);
    }
    /** 学员档案列表：按账号/姓名搜索 + 分页，返回业务字段与 total。 */
    async listLearners(query = {}) {
        const params = new URLSearchParams();
        if (typeof query.q === 'string' && query.q.trim().length > 0)
            params.set('q', query.q.trim());
        params.set('limit', String(query.limit ?? 20));
        params.set('offset', String(query.offset ?? 0));
        const payload = await this.get(`/admin/learners?${params.toString()}`);
        if (typeof payload !== 'object' || payload === null || !Array.isArray(payload.items)) {
            throw invalidResponse('Learner list must be wrapped in an items array.');
        }
        const data = payload;
        return {
            items: data.items.map(normalizeLearnerSummary),
            total: readCount(data.total),
            limit: readCount(data.limit) || (query.limit ?? 20),
            offset: readCount(data.offset),
        };
    }
    /** 单个学员成长档案（维度/薄弱点 + 近 20 次训练）。 */
    async getLearnerDetail(id) {
        const payload = await this.get(`/admin/learners/${encodeURIComponent(id)}`);
        return normalizeLearnerDetail(payload);
    }
    /** 结果复盘列表：来源/学员筛选 + 分页，返回业务化扁平评估行。 */
    async listEvaluations(query = {}) {
        const params = new URLSearchParams();
        if (query.source !== undefined)
            params.set('source', query.source);
        if (typeof query.learnerId === 'string' && query.learnerId.length > 0)
            params.set('learnerId', query.learnerId);
        params.set('limit', String(query.limit ?? 20));
        params.set('offset', String(query.offset ?? 0));
        const payload = await this.get(`/admin/evaluations?${params.toString()}`);
        if (typeof payload !== 'object' || payload === null || !Array.isArray(payload.items)) {
            throw invalidResponse('Evaluation list must be wrapped in an items array.');
        }
        const data = payload;
        return {
            items: data.items.map(normalizeEvaluationItem),
            total: readCount(data.total),
            limit: readCount(data.limit) || (query.limit ?? 20),
            offset: readCount(data.offset),
        };
    }
    /** 单场对话回放：会话元信息 + 有序轮次 + 评估报告。 */
    async getConversationReplay(id) {
        const payload = await this.get(`/admin/conversations/${encodeURIComponent(id)}`);
        return normalizeConversationReplay(payload);
    }
    async request(path, init) {
        const headers = {
            'x-request-id': this.options.requestIdFactory(),
        };
        if (this.options.adminToken.length > 0)
            headers.authorization = `Bearer ${this.options.adminToken}`;
        if (init.method !== 'GET')
            headers['content-type'] = 'application/json';
        const response = await this.fetcher(path, { ...init, headers });
        const payload = await response.json();
        if (!response.ok)
            throw new AdminApiProblem(toProblemDetails(payload, response.status));
        return payload;
    }
}
function toProblemDetails(payload, status) {
    if (typeof payload === 'object' && payload !== null) {
        const candidate = payload;
        if (typeof candidate.code === 'string' && typeof candidate.detail === 'string') {
            return { code: candidate.code, detail: candidate.detail, status: candidate.status ?? status };
        }
    }
    return { code: 'API_RESPONSE_INVALID', detail: 'The API returned an invalid error response.', status };
}
export function renderProblemDetails(problem) {
    return `<section role="alert"><strong>${escapeHtml(problem.code)}</strong><p>${escapeHtml(problem.detail)}</p></section>`;
}
export function escapeHtml(value) {
    return value.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;').replaceAll("'", '&#39;');
}
function readStringArray(value) {
    return Array.isArray(value) ? value.filter((entry) => typeof entry === 'string') : [];
}
export function normalizeTemplateSummary(value) {
    if (typeof value !== 'object' || value === null) {
        throw new AdminApiProblem({ code: 'API_RESPONSE_INVALID', detail: 'A template entry must be an object.', status: 502 });
    }
    const candidate = value;
    if (typeof candidate.id !== 'string' || typeof candidate.title !== 'string') {
        throw new AdminApiProblem({ code: 'API_RESPONSE_INVALID', detail: 'A template entry is missing id/title.', status: 502 });
    }
    return {
        id: candidate.id,
        scope: typeof candidate.scope === 'string' ? candidate.scope : 'organization',
        title: candidate.title,
        status: typeof candidate.status === 'string' ? candidate.status : 'active',
        personaConfig: typeof candidate.personaConfig === 'object' && candidate.personaConfig !== null
            ? candidate.personaConfig
            : {},
        knowledgeVersions: readStringArray(candidate.knowledgeVersions),
        scoringRules: readStringArray(candidate.scoringRules),
        agentConfig: typeof candidate.agentConfig === 'object' && candidate.agentConfig !== null
            ? candidate.agentConfig
            : {},
        learnerOverridePolicy: typeof candidate.learnerOverridePolicy === 'object' && candidate.learnerOverridePolicy !== null
            ? candidate.learnerOverridePolicy
            : {},
        currentRevision: typeof candidate.currentRevision === 'number' ? candidate.currentRevision : null,
        currentRevisionId: typeof candidate.currentRevisionId === 'string' ? candidate.currentRevisionId : null,
        ...(typeof candidate.createdAt === 'string' ? { createdAt: candidate.createdAt } : {}),
    };
}
export function normalizeTemplateRevision(value) {
    if (typeof value !== 'object' || value === null) {
        throw invalidResponse('A template revision must be an object.');
    }
    const candidate = value;
    if (typeof candidate.revision !== 'number' || typeof candidate.revisionId !== 'string') {
        throw invalidResponse('A template revision is missing revision/revisionId.');
    }
    return {
        revisionId: candidate.revisionId,
        templateId: typeof candidate.templateId === 'string' ? candidate.templateId : '',
        revision: candidate.revision,
        title: typeof candidate.title === 'string' ? candidate.title : '',
        personaConfig: typeof candidate.personaConfig === 'object' && candidate.personaConfig !== null
            ? candidate.personaConfig
            : {},
        knowledgeVersions: readStringArray(candidate.knowledgeVersions),
        scoringRules: readStringArray(candidate.scoringRules),
        agentConfig: typeof candidate.agentConfig === 'object' && candidate.agentConfig !== null
            ? candidate.agentConfig
            : {},
        learnerOverridePolicy: typeof candidate.learnerOverridePolicy === 'object' && candidate.learnerOverridePolicy !== null
            ? candidate.learnerOverridePolicy
            : {},
        createdBy: typeof candidate.createdBy === 'string' ? candidate.createdBy : null,
        createdAt: typeof candidate.createdAt === 'string' ? candidate.createdAt : '',
    };
}
export function normalizeScenarioDraftSummary(value) {
    if (typeof value !== 'object' || value === null)
        throw invalidResponse('A scenario entry must be an object.');
    const candidate = value;
    if (typeof candidate.id !== 'string' || typeof candidate.title !== 'string') {
        throw invalidResponse('A scenario entry is missing id/title.');
    }
    return {
        id: candidate.id,
        title: candidate.title,
        version: readCount(candidate.version),
        personaSourceKind: typeof candidate.personaSourceKind === 'string' ? candidate.personaSourceKind : null,
        knowledgeCount: readCount(candidate.knowledgeCount),
        scoringCount: readCount(candidate.scoringCount),
        publishedCount: readCount(candidate.publishedCount),
        latestSnapshotId: typeof candidate.latestSnapshotId === 'string' ? candidate.latestSnapshotId : null,
        createdAt: typeof candidate.createdAt === 'string' ? candidate.createdAt : '',
        updatedAt: typeof candidate.updatedAt === 'string' ? candidate.updatedAt : '',
    };
}
export function normalizeScenarioDraftDetail(value) {
    if (typeof value !== 'object' || value === null) {
        throw invalidResponse('A scenario draft detail must be an object.');
    }
    const candidate = value;
    if (typeof candidate.id !== 'string' || typeof candidate.title !== 'string') {
        throw invalidResponse('A scenario draft detail is missing id/title.');
    }
    const payload = typeof candidate.payload === 'object' && candidate.payload !== null
        ? candidate.payload
        : {};
    return {
        id: candidate.id,
        organizationId: typeof candidate.organizationId === 'string' ? candidate.organizationId : '',
        title: typeof candidate.title === 'string' ? candidate.title : '',
        payload: {
            title: typeof payload.title === 'string' ? payload.title : candidate.title,
            knowledgeVersions: readStringArray(payload.knowledgeVersions),
            scoringRules: readStringArray(payload.scoringRules),
            agentConfig: typeof payload.agentConfig === 'object' && payload.agentConfig !== null
                ? payload.agentConfig
                : {},
            personaSource: typeof payload.personaSource === 'object' && payload.personaSource !== null
                ? payload.personaSource
                : undefined,
        },
    };
}
export function normalizeLearnerSummary(value) {
    if (typeof value !== 'object' || value === null)
        throw invalidResponse('A learner entry must be an object.');
    const candidate = value;
    if (typeof candidate.learnerId !== 'string' || typeof candidate.principalId !== 'string') {
        throw invalidResponse('A learner entry is missing required fields.');
    }
    const avg = typeof candidate.avgScore === 'number' && Number.isFinite(candidate.avgScore) ? candidate.avgScore : null;
    return {
        learnerId: candidate.learnerId,
        principalId: candidate.principalId,
        displayName: typeof candidate.displayName === 'string' ? candidate.displayName : null,
        avatarUrl: typeof candidate.avatarUrl === 'string' ? candidate.avatarUrl : null,
        identityProvider: typeof candidate.identityProvider === 'string' ? candidate.identityProvider : 'gongzhugou',
        totalFreeSessions: readCount(candidate.totalFreeSessions),
        totalAssignedSessions: readCount(candidate.totalAssignedSessions),
        avgScore: avg,
        lastTrainedAt: typeof candidate.lastTrainedAt === 'string' ? candidate.lastTrainedAt : null,
        createdAt: typeof candidate.createdAt === 'string' ? candidate.createdAt : '',
    };
}
export function normalizeLearnerDetail(value) {
    const summary = normalizeLearnerSummary(value);
    const candidate = (value ?? {});
    const dimensions = {};
    if (typeof candidate.dimensionScores === 'object' && candidate.dimensionScores !== null) {
        for (const [key, score] of Object.entries(candidate.dimensionScores)) {
            if (typeof score === 'number' && Number.isFinite(score))
                dimensions[key] = score;
        }
    }
    const recent = Array.isArray(candidate.recentSessions)
        ? candidate.recentSessions.map((entry) => {
            const row = (entry ?? {});
            return {
                id: typeof row.id === 'string' ? row.id : '',
                sourceType: typeof row.sourceType === 'string' ? row.sourceType : 'free',
                mode: typeof row.mode === 'string' ? row.mode : 'practice',
                status: typeof row.status === 'string' ? row.status : '',
                scenarioTitle: typeof row.scenarioTitle === 'string' ? row.scenarioTitle : null,
                assignmentName: typeof row.assignmentName === 'string' ? row.assignmentName : null,
                score: typeof row.score === 'number' && Number.isFinite(row.score) ? row.score : null,
                startedAt: typeof row.startedAt === 'string' ? row.startedAt : '',
                finishedAt: typeof row.finishedAt === 'string' ? row.finishedAt : null,
            };
        })
        : [];
    return {
        ...summary,
        dimensionScores: dimensions,
        weakPoints: Array.isArray(candidate.weakPoints)
            ? candidate.weakPoints.filter((entry) => typeof entry === 'string')
            : [],
        recentSessions: recent,
    };
}
export function normalizeEvaluationItem(value) {
    if (typeof value !== 'object' || value === null)
        throw invalidResponse('An evaluation entry must be an object.');
    const row = value;
    if (typeof row.conversationId !== 'string')
        throw invalidResponse('An evaluation entry is missing conversationId.');
    const score = typeof row.score === 'number' && Number.isFinite(row.score) ? row.score : null;
    return {
        evaluationId: typeof row.evaluationId === 'string' ? row.evaluationId : '',
        conversationId: row.conversationId,
        learnerId: typeof row.learnerId === 'string' ? row.learnerId : '',
        principalId: typeof row.principalId === 'string' ? row.principalId : null,
        displayName: typeof row.displayName === 'string' ? row.displayName : null,
        sourceType: typeof row.sourceType === 'string' ? row.sourceType : 'free',
        mode: typeof row.mode === 'string' ? row.mode : 'practice',
        scenarioTitle: typeof row.scenarioTitle === 'string' ? row.scenarioTitle : null,
        assignmentName: typeof row.assignmentName === 'string' ? row.assignmentName : null,
        score,
        sessionStartedAt: typeof row.sessionStartedAt === 'string' ? row.sessionStartedAt : null,
        evaluatedAt: typeof row.evaluatedAt === 'string' ? row.evaluatedAt : '',
    };
}
export function normalizeConversationReplay(value) {
    if (typeof value !== 'object' || value === null)
        throw invalidResponse('A conversation replay must be an object.');
    const row = value;
    if (typeof row.conversationId !== 'string')
        throw invalidResponse('A replay is missing conversationId.');
    const messages = Array.isArray(row.messages)
        ? row.messages.map((entry) => {
            const m = (entry ?? {});
            return {
                role: typeof m.role === 'string' ? m.role : 'learner',
                sequence: readCount(m.sequence),
                content: typeof m.content === 'string' ? m.content : '',
            };
        })
        : [];
    return {
        conversationId: row.conversationId,
        status: typeof row.status === 'string' ? row.status : '',
        sourceType: typeof row.sourceType === 'string' ? row.sourceType : 'free',
        mode: typeof row.mode === 'string' ? row.mode : 'practice',
        learnerId: typeof row.learnerId === 'string' ? row.learnerId : '',
        principalId: typeof row.principalId === 'string' ? row.principalId : null,
        displayName: typeof row.displayName === 'string' ? row.displayName : null,
        scenarioTitle: typeof row.scenarioTitle === 'string' ? row.scenarioTitle : null,
        assignmentName: typeof row.assignmentName === 'string' ? row.assignmentName : null,
        startedAt: typeof row.startedAt === 'string' ? row.startedAt : null,
        finishedAt: typeof row.finishedAt === 'string' ? row.finishedAt : null,
        messages,
        report: typeof row.report === 'object' && row.report !== null ? row.report : null,
    };
}
export function normalizeAssignmentSummary(value) {
    if (typeof value !== 'object' || value === null)
        throw invalidResponse('An assignment entry must be an object.');
    const candidate = value;
    if (typeof candidate.id !== 'string' || typeof candidate.name !== 'string' || typeof candidate.releaseSnapshotId !== 'string') {
        throw invalidResponse('An assignment entry is missing required fields.');
    }
    const status = typeof candidate.status === 'string' ? candidate.status : 'draft';
    return {
        id: candidate.id,
        name: candidate.name,
        status,
        scenarioTitle: typeof candidate.scenarioTitle === 'string' ? candidate.scenarioTitle : null,
        releaseSnapshotId: candidate.releaseSnapshotId,
        startsAt: typeof candidate.startsAt === 'string' ? candidate.startsAt : '',
        endsAt: typeof candidate.endsAt === 'string' ? candidate.endsAt : '',
        maxAttempts: readCount(candidate.maxAttempts),
        targetCount: readCount(candidate.targetCount),
        assignedCount: readCount(candidate.assignedCount),
        completedCount: readCount(candidate.completedCount),
        inProgressCount: readCount(candidate.inProgressCount),
        createdAt: typeof candidate.createdAt === 'string' ? candidate.createdAt : '',
        overridePatch: normalizeOverridePatch(candidate.overridePatch),
    };
}
/** 任务级参数覆盖归一化：服务端返回原始 patch，前端只读取契约字段。 */
export function normalizeOverridePatch(value) {
    if (typeof value !== 'object' || value === null)
        return null;
    const patch = value;
    const agentConfig = typeof patch.agentConfig === 'object' && patch.agentConfig !== null ? patch.agentConfig : null;
    const conversation = typeof patch.conversation === 'object' && patch.conversation !== null ? patch.conversation : null;
    if (agentConfig === null && conversation === null)
        return null;
    return {
        agentConfig: agentConfig === null ? undefined : {
            historyMessageLimit: typeof agentConfig.historyMessageLimit === 'number' ? agentConfig.historyMessageLimit : undefined,
            responseLength: typeof agentConfig.responseLength === 'string' ? agentConfig.responseLength : undefined,
            knowledgeStrictness: typeof agentConfig.knowledgeStrictness === 'string' ? agentConfig.knowledgeStrictness : undefined,
            conversationPace: typeof agentConfig.conversationPace === 'string' ? agentConfig.conversationPace : undefined,
            closingTendency: typeof agentConfig.closingTendency === 'string' ? agentConfig.closingTendency : undefined,
            additionalInstructions: typeof agentConfig.additionalInstructions === 'string' ? agentConfig.additionalInstructions : undefined,
        },
        conversation: conversation === null ? undefined : {
            maxTurns: typeof conversation.maxTurns === 'number' ? conversation.maxTurns : undefined,
            openingMode: typeof conversation.openingMode === 'string' ? conversation.openingMode : undefined,
            background: typeof conversation.background === 'string' ? conversation.background : undefined,
        },
    };
}
function readCount(value) {
    return typeof value === 'number' && Number.isFinite(value) ? value : 0;
}
export function normalizeReleaseSnapshotSummary(value) {
    if (typeof value !== 'object' || value === null)
        throw invalidResponse('A release snapshot entry must be an object.');
    const candidate = value;
    if (typeof candidate.id !== 'string' || typeof candidate.scenarioDraftId !== 'string' || typeof candidate.title !== 'string') {
        throw invalidResponse('A release snapshot entry is missing required fields.');
    }
    return {
        id: candidate.id,
        scenarioDraftId: candidate.scenarioDraftId,
        title: candidate.title,
        isActive: candidate.isActive !== false,
        schemaVersion: typeof candidate.schemaVersion === 'string' ? candidate.schemaVersion : 'release-snapshot/v1',
        personaSourceKind: typeof candidate.personaSourceKind === 'string' ? candidate.personaSourceKind : null,
        personaName: typeof candidate.personaName === 'string' ? candidate.personaName : null,
        personaProductScenario: typeof candidate.personaProductScenario === 'string' ? candidate.personaProductScenario : null,
        personaDifficulty: typeof candidate.personaDifficulty === 'number' ? candidate.personaDifficulty : null,
        templateTitle: typeof candidate.templateTitle === 'string' ? candidate.templateTitle : null,
        templateRevision: typeof candidate.templateRevision === 'number' ? candidate.templateRevision : null,
        knowledgeCount: readCount(candidate.knowledgeCount),
        scoringCount: readCount(candidate.scoringCount),
        historyMessageLimit: typeof candidate.historyMessageLimit === 'number' ? candidate.historyMessageLimit : null,
        createdAt: typeof candidate.createdAt === 'string' ? candidate.createdAt : '',
    };
}
function invalidResponse(detail) {
    return new AdminApiProblem({ code: 'API_RESPONSE_INVALID', detail, status: 502 });
}
function normalizeNamedOptions(value, label) {
    if (!Array.isArray(value))
        throw invalidResponse(`${label} catalog must be an array.`);
    const options = [];
    for (const entry of value) {
        if (typeof entry !== 'object' || entry === null)
            continue;
        const item = entry;
        if (typeof item.id === 'string' && typeof item.displayName === 'string') {
            options.push({ id: item.id, displayName: item.displayName, description: typeof item.description === 'string' ? item.description : '' });
        }
    }
    return options;
}
export function normalizePresetCatalog(value) {
    if (typeof value !== 'object' || value === null) {
        throw invalidResponse('Persona preset catalog must be an object.');
    }
    const raw = value;
    const ageCards = normalizeNamedOptions(raw.ageCards, 'Age card');
    // 方案 B：8 大人群完整画像卡片（保留 age/occupation/consumption，B 端卡片摘要显示用）
    const cohortCards = [];
    if (Array.isArray(raw.cohortCards)) {
        for (const entry of raw.cohortCards) {
            if (typeof entry !== 'object' || entry === null) continue;
            const item = entry;
            if (typeof item.id === 'string' && typeof item.displayName === 'string') {
                cohortCards.push({
                    id: item.id,
                    displayName: item.displayName,
                    description: typeof item.description === 'string' ? item.description : '',
                    age: typeof item.age === 'number' ? item.age : 0,
                    occupation: typeof item.occupation === 'string' ? item.occupation : '',
                    consumption: typeof item.consumption === 'object' && item.consumption !== null ? item.consumption : {},
                });
            }
        }
    }
    const psychologyCards = normalizeNamedOptions(raw.psychologyCards, 'Psychology card');
    const productScenarios = normalizeNamedOptions(raw.productScenarios, 'Product scenario');
    const difficultyLevels = [];
    if (Array.isArray(raw.difficultyLevels)) {
        for (const entry of raw.difficultyLevels) {
            if (typeof entry !== 'object' || entry === null)
                continue;
            const item = entry;
            if (typeof item.level === 'number' && [1, 2, 3, 4].includes(item.level) && typeof item.name === 'string') {
                difficultyLevels.push({
                    level: item.level,
                    name: item.name,
                    description: typeof item.description === 'string' ? item.description : '',
                });
            }
        }
    }
    else {
        throw invalidResponse('Difficulty levels catalog must be an array.');
    }
    // 客户类型是建模板的必选项，目录为空时无法引导，直接失败。
    if (ageCards.length === 0 || productScenarios.length === 0 || difficultyLevels.length === 0) {
        throw invalidResponse('Persona preset catalog is incomplete.');
    }
    return { ageCards, cohortCards, psychologyCards, difficultyLevels, productScenarios };
}
export function normalizePersonaSnapshot(value) {
    if (typeof value !== 'object' || value === null) {
        throw invalidResponse('Persona preview must return an object.');
    }
    const snapshot = value;
    if (typeof snapshot.basedOnCard !== 'string' || typeof snapshot.conversation !== 'object') {
        throw invalidResponse('Persona preview snapshot is malformed.');
    }
    return snapshot;
}
