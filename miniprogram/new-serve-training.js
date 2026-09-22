import request from '../index.js';

let requestSequence = 0;
const turnMap = {};
// 在途未确认轮：某条消息发送后、客户回复落库前若请求中断（网络抖动/模型超时/页面刷新），
// 后端会把该轮置为 awaiting_model。必须用同一个 clientMessageId+sequence 重放才能续跑，
// 否则后端判 MESSAGE_SEQUENCE_CONFLICT，整局卡死。这里缓存最近一次未确认轮用于幂等重试。
const pendingSendMap = {};
const nextId = (prefix) => `${prefix}-${Date.now()}-${++requestSequence}`;
const route = (path) => `training/${path}`;
const requestTraining = (url, method = 'get', data, headers) => request({
  url: route(url), method, data, isTraining: true, ...(headers ? { headers } : {}),
});

const asObjectList = (value) => Array.isArray(value)
  ? value.filter((item) => item && typeof item === 'object')
  : [];
const namedPreset = (item) => {
  const candidates = [item.displayName, item.name, item.id];
  const name = candidates.find((value) => typeof value === 'string' && value.trim()) || '未命名';
  return { ...item, name: name.trim() };
};

export const getPersonaPresets = async () => {
  const raw = await requestTraining('bootstrap');
  const payload = raw && typeof raw === 'object' ? raw : {};
  // 场景选项 = 旧 8 经典平铺 + 新 5 大类 22 个子场景展开（id 为 categoryId::scene，
  // 名称带类目前缀便于识别；旧值 id 不变，向后兼容已存模板/任务）。
  const legacyScenarios = asObjectList(payload.productScenarios).map(namedPreset);
  const newScenarios = asObjectList(payload.productScenarioCategories).flatMap((cat) =>
    asObjectList(cat.scenes).map((scene) => ({
      id: `${cat.id}::${scene}`,
      name: `${cat.displayName}·${scene}`,
      categoryId: cat.id,
      categoryLabel: cat.displayName,
    })),
  );
  return {
    enabled: payload.enabled !== false,
    cards: asObjectList(payload.ageCards).map(namedPreset),
    // 方案 B：8 大人群完整画像卡片（含 personality/consumption，用于滑杆联动）
    cohortCards: asObjectList(payload.cohortCards).map(namedPreset),
    psychology: asObjectList(payload.psychologyCards).map(namedPreset),
    difficulty: asObjectList(payload.difficultyLevels),
    scenarios: [...legacyScenarios, ...newScenarios],
    // v2 客户画像体系（阶段 C：小程序字典同步，与 B 端 getFieldMetadata 同源）
    customerRelations: asObjectList(payload.customerRelations),
    customerCohorts: asObjectList(payload.customerCohorts),
    trustLevels: asObjectList(payload.trustLevels),
    skinTypes: asObjectList(payload.skinTypes),
    skinConcernsDictionary: asObjectList(payload.skinConcernsDictionary),
    cityMaxLength: payload.cityMaxLength || 30,
    purchaseCategoryMaxLength: payload.purchaseCategoryMaxLength || 50,
  };
};
export const getCards = async () => { const presets = await getPersonaPresets(); return { items: presets.cards, presets }; };
export const getTemplates = async () => {
  const raw = await requestTraining('persona-templates');
  return { items: (raw.items || []).map((item) => ({ id: item.id, name: item.title, updated_at: item.updatedAt || item.createdAt, personaConfig: item.personaConfig })) };
};
export const saveTemplate = (data) => requestTraining('persona-templates', 'post', { title: data.name || data.title, personaConfig: data.personaConfig || data.overrides || {} });
export const previewPersona = (selection) => requestTraining('persona/preview', 'post', selection);

export const createConversation = async (input = {}) => {
  const data = input.templateId || input.template_id
    ? { templateId: input.templateId || input.template_id, mode: input.mode }
    : { persona: input.persona || input.persona_config, mode: input.mode };
  const response = await requestTraining('sessions/free', 'post', data, { 'Idempotency-Key': nextId('free-session') });
  turnMap[response.conversationId] = 0;
  pendingSendMap[response.conversationId] = null;
  return { id: response.conversationId, conversationId: response.conversationId, sessionId: response.sessionId, sourceType: response.sourceType };
};
export const getActiveConversation = async () => {
  const response = await requestTraining('conversations?limit=20&offset=0');
  return (response.items || []).find((item) => ['created', 'active', 'awaiting_model'].includes(item.status)) || null;
};
export const startConversation = (id, data = {}) => requestTraining(`conversations/${encodeURIComponent(id)}/opening`, 'post', data);
export const resumeConversation = async (id) => {
  const detail = await getConversationDetail(id);
  turnMap[id] = Number(detail.lastSequence) || (detail.messages || []).filter((message) => message.role === 'learner').length;
  // 恢复时若服务端存在未完成轮，预置同样的幂等凭据，随后“重试”即可续跑而不是触发序号冲突。
  pendingSendMap[id] = detail.pendingTurn && detail.pendingTurn.clientMessageId
    ? {
      clientMessageId: detail.pendingTurn.clientMessageId,
      sequence: Number(detail.pendingTurn.sequence),
      content: detail.pendingTurn.content,
    }
    : null;
  const messages = detail.messages || [];
  let learnerFirst = false;
  // 只要会话仍在进行且一条消息都没有，说明开场白上次没生成成功（可能中断在 created/active/awaiting_model），
  // 继续时补生成开场白，避免“继续上一场”进去仍是空白气泡。
  if (messages.length === 0 && ['created', 'active', 'awaiting_model'].includes(detail.status)) {
    try {
      const opening = await startConversation(id);
      if (opening && opening.learnerFirst) {
        // 等学员先开口（wait_learner）：后端刻意不生成 AI 开场白，保持空对话，等学员先发。
        learnerFirst = true;
      } else {
        messages.push({ role: 'assistant', content: opening.opening, customerMood: opening.customerMood || 'neutral' });
      }
    } catch (e) {
      // 补开场白失败不阻断恢复，交由页面提示/重试
      console.warn('resumeConversation: 补开场白失败', e && e.code, e && e.message);
    }
  }
  return { ...detail, conversationId: id, messages, learnerFirst, active: ['created', 'active', 'awaiting_model'].includes(detail.status) };
};
export const sendMessage = async (id, content, replayRef = null) => {
  const text = typeof content === 'string' ? content : content.content;
  const fallbackSequence = (turnMap[id] || 0) + 1;
  // 重放优先级：页面恢复出的未完成轮凭据 > 本次生命周期内发送失败的在途轮 > 全新一轮。
  // 三者都保证“中断后续跑”使用与首次完全相同的 clientMessageId+sequence，后端才会幂等续跑。
  const held = pendingSendMap[id];
  const useHeld = held && held.content === text;
  const sequence = replayRef && replayRef.clientMessageId
    ? (Number(replayRef.sequence) || fallbackSequence)
    : useHeld ? held.sequence : fallbackSequence;
  const clientMessageId = replayRef && replayRef.clientMessageId
    ? replayRef.clientMessageId
    : useHeld ? held.clientMessageId : nextId('message');
  try {
    const response = await requestTraining(`conversations/${encodeURIComponent(id)}/messages`, 'post', { clientMessageId, sequence, content: text });
    turnMap[id] = response.sequence || sequence;
    pendingSendMap[id] = null;
    const suggestion = response.suggestion || {};
    return { ...response, reply: suggestion.replyText || response.reply || '……', reply_parts: [suggestion.replyText || response.reply || '……'], current_turn: response.sequence, customerMood: response.customerMood || 'neutral', status: response.status || 'active' };
  } catch (error) {
    // 留下在途轮凭据：下一次同内容“重试”会原样重放，续上 awaiting_model 的未完成轮。
    pendingSendMap[id] = { clientMessageId, sequence, content: text };
    throw error;
  }
};
export const getCoachFeedback = (id, messageId) => requestTraining(`conversations/${encodeURIComponent(id)}/messages/${encodeURIComponent(messageId)}/coach-feedback`);
export const getCustomerState = (id, messageId) => requestTraining(`conversations/${encodeURIComponent(id)}/messages/${encodeURIComponent(messageId)}/customer-state`);
export const endConversation = async (id) => {
  try {
    return await requestTraining(`conversations/${encodeURIComponent(id)}/end`, 'post');
  } finally {
    turnMap[id] = 0;
    pendingSendMap[id] = null;
  }
};
export const getConversation = (id) => getConversationDetail(id);
export const getConversationDetail = async (id) => {
  const response = await requestTraining(`conversations/${encodeURIComponent(id)}`);
  return { ...response, messages: (response.messages || []).map((message) => ({ role: message.role === 'learner' ? 'user' : 'assistant', content: message.content, sequence: message.sequence })) };
};
export const getResult = async (id, personaConfig, options = {}) => {
  const maxAttempts = options.maxAttempts || 8; const interval = options.interval || 1200; let lastError;
  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    try { const response = await requestTraining(`evaluations/${encodeURIComponent(id)}`); if (response.report) return { ...response.report, persona_config: personaConfig || null }; } catch (error) { lastError = error; }
    await new Promise((resolve) => setTimeout(resolve, interval));
  }
  throw lastError || new Error('评估报告还在生成中，请稍后查看');
};
export const getHistory = async (page = 0, pageSize = 20) => {
  const response = await requestTraining(`conversations?limit=${pageSize}&offset=${page * pageSize}`);
  return { items: response.items || [], total: response.total };
};

// ===== 团队任务（B端投放 → C端接收） =====
// 注意：任务路由在后端是 /v1/me/assignments，不带 training/ 前缀，所以直接用 request 而非 requestTraining
export const getMyAssignments = async () => {
  const response = await request({ url: 'me/assignments', method: 'get', isTraining: true });
  return { items: response.items || [] };
};
export const startAssignmentAttempt = async (assignmentId) => {
  const response = await request({
    url: `me/assignments/${encodeURIComponent(assignmentId)}/attempts`,
    method: 'post',
    data: {},
    isTraining: true,
    headers: { 'Idempotency-Key': nextId('assignment-attempt') },
  });
  return { attemptId: response.attemptId, conversationId: response.conversationId };
};
export const getActiveAssignmentConversation = async (assignmentId) => {
  const response = await request({
    url: `me/assignments/${encodeURIComponent(assignmentId)}/active-conversation`,
    method: 'get',
    isTraining: true,
  });
  return response || null;
};

export default { getPersonaPresets, getCards, getTemplates, saveTemplate, previewPersona, createConversation, getActiveConversation, startConversation, resumeConversation, sendMessage, getCoachFeedback, getCustomerState, endConversation, getConversation, getConversationDetail, getResult, getHistory, getMyAssignments, startAssignmentAttempt, getActiveAssignmentConversation };
