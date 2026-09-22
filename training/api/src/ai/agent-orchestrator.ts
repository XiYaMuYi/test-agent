import type { KnowledgeProviderPort, ModelProviderPort, AgentOutputV1 } from '@training/contracts';
import { isModelProviderError, parseKnowledgeVersionReferenceV1 } from '@training/contracts';
import type { RestrictedContext, ApprovedKnowledgeEntry, SessionKnowledgeContext } from './restricted-context.js';
import type { ConversationSnapshot } from '../conversations/conversation-state.js';
import { isFakeModelError } from '../adapters/fake-model.adapter.js';
import { buildPersonaSystemSection } from './persona-prompt.js';
import { fallbackCustomerTransition, validateCustomerTransition } from './customer-state-validation.js';

export interface OrchestratorDecision {
  readonly kind: 'accepted' | 'safe_fallback';
  readonly decision: AgentOutputV1;
}

export class AgentOrchestrator {
  private readonly knowledge: KnowledgeProviderPort;
  private readonly model: ModelProviderPort;

  public constructor(knowledge: KnowledgeProviderPort, model: ModelProviderPort) {
    this.knowledge = knowledge;
    this.model = model;
  }

  async buildAndValidateContext(
    conversation: ConversationSnapshot,
    snapshot: SessionKnowledgeContext,
    recentMessages: readonly { readonly role: 'learner' | 'assistant'; readonly content: string }[],
  ): Promise<RestrictedContext> {
    const approvedKnowledge = await this.loadApprovedKnowledge(snapshot.knowledgeVersions, conversation.organizationId);
    return {
      organizationId: conversation.organizationId,
      conversationId: conversation.id,
      conversationVersion: conversation.version,
      conversationStatus: conversation.status,
      lastSequence: conversation.lastSequence,
      releaseSnapshotId: snapshot.releaseSnapshotId,
      knowledgeVersions: snapshot.knowledgeVersions,
      agentConfig: snapshot.agentConfig,
      approvedKnowledge,
      recentMessages,
      canAdvance: conversation.status === 'active' || conversation.status === 'awaiting_model',
      personaSnapshot: conversation.personaSnapshot,
      ...(conversation.currentCustomerState != null ? { currentCustomerState: conversation.currentCustomerState } : {}),
    };
  }

  /**
   * 供非客户决策场景（如 LLM 教练点评）复用同一个模型端口，返回模型原始文本。
   * 调用方自行解析输出并准备降级方案。
   */
  async generateRawText(prompt: string): Promise<string> {
    const response = await this.model.generate({ sessionId: 'coach-feedback', prompt });
    return response.content;
  }

  async generateDecision(context: RestrictedContext, mode: 'opening' | 'reply' = 'reply'): Promise<OrchestratorDecision> {
    const prompt = this.buildPrompt(context, mode);
    const latest = context.recentMessages.at(-1);
    const hasCurrentLearnerMessage = mode === 'reply' && latest?.role === 'learner';
    const recentMessages = hasCurrentLearnerMessage ? context.recentMessages.slice(0, -1) : context.recentMessages;
    let response;
    try {
      response = await this.model.generate({
        sessionId: context.conversationId,
        prompt,
        simulation: {
          mode,
          turnNumber: mode === 'opening' ? 0 : context.lastSequence,
          conversationId: context.conversationId,
          personaSnapshot: context.personaSnapshot,
          recentMessages,
          ...(hasCurrentLearnerMessage ? { learnerMessage: latest.content } : {}),
           approvedKnowledge: context.approvedKnowledge.map((entry) => ({
            reference: `${entry.ref.itemId}@${entry.ref.version}`,
            content: entry.content,
           })),
           ...(context.currentCustomerState != null ? { currentCustomerState: context.currentCustomerState } : {}),
        },
      });
    } catch (error: unknown) {
      if (isFakeModelError(error)) {
        if (error.code === 'FAKE_MODEL_TIMEOUT') {
          throw new OrchestratorError('MODEL_TIMEOUT', error.message);
        }
        throw new OrchestratorError('MODEL_SCHEMA_INVALID', error.message);
      }
      if (isModelProviderError(error)) {
        if (error.code === 'MODEL_TIMEOUT') {
          throw new OrchestratorError('MODEL_TIMEOUT', error.message);
        }
        if (error.code === 'MODEL_UPSTREAM_UNAVAILABLE') {
          throw new OrchestratorError('MODEL_UPSTREAM_UNAVAILABLE', error.message);
        }
        throw new OrchestratorError('MODEL_SCHEMA_INVALID', error.message);
      }
      throw error;
    }

    let parsed: unknown;
    try {
      parsed = this.parseModelContent(response.content);
    } catch (error) {
      if (error instanceof OrchestratorError) throw error;
      throw new OrchestratorError('MODEL_SCHEMA_INVALID', 'The model response is not valid JSON.');
    }

    let decision = this.validateAgentDecision(parsed, context);
    if (mode === 'reply' && !decision.stateTransition) decision = { ...decision, stateTransition: fallbackCustomerTransition(decision, context) };

    // 服务端硬收束：达到配置的最大轮数 maxTurns 时，无论模型自判是否结束都强制收尾，
    // 保证 maxTurns 不依赖模型自觉（模型常忽略结构化 turnNumber）。
    if (mode === 'reply' && decision.stateTransition) {
      const maxTurns = context.personaSnapshot?.conversation?.maxTurns ?? 15;
      if (context.lastSequence >= maxTurns && decision.stateTransition.terminal.shouldEnd !== true) {
        decision = {
          ...decision,
          suggestedAction: 'end',
          stateTransition: {
            ...decision.stateTransition,
            terminal: { shouldEnd: true, reason: 'max_turns', confidence: 1 },
          },
        };
      }
    }

    if (decision.suggestedAction === 'advance' && !context.canAdvance) {
      return {
        kind: 'safe_fallback',
        decision: {
          ...decision,
          suggestedAction: 'ask_follow_up',
          replyText: '请继续补充说明。',
        },
      };
    }

    return { kind: 'accepted', decision };
  }

  private buildPrompt(context: RestrictedContext, mode: 'opening' | 'reply' = 'reply'): string {
    const knowledgeBlock = context.approvedKnowledge
      .map((k) => `[${k.ref.itemId}@${k.ref.version}] ${k.content}`)
      .join('\n');
    const historyBlock = context.recentMessages
      .map((m) => `${m.role === 'learner' ? '销售员(学员)' : '客户(AI)'}: ${m.content}`)
      .join('\n');
    const allowedRefIds = context.approvedKnowledge.map((k) => `${k.ref.itemId}@${k.ref.version}`);
    // Defense in depth: only inject when we hold an object snapshot. The builder
    // itself deep-normalizes null/'{}'/partial snapshots, so a legacy assigned
    // session with an empty persona still gets a safe default customer instead
    // of crashing prompt assembly (which previously surfaced as a 500).
    const personaSnapshot = context.personaSnapshot;
    const hasPersonaSnapshot = typeof personaSnapshot === 'object' && personaSnapshot !== null;
    const personaBlock = hasPersonaSnapshot
      ? ['', buildPersonaSystemSection(personaSnapshot), ''].join('\n')
      : '';
    // AgentConfigV1 行为注入（spec §5.5/§8.2）：把任务配置的行为参数翻译为受控的
    // 角色行为约束（枚举→固定模板文案，不拼接任意用户文本）；additionalInstructions
    // 只进入角色行为区，不进入系统级指令区，避免越权指令。
    const behaviorBlock = buildAgentBehaviorBlock(context.agentConfig);
    // 轮次控制（reply 才需要）：把"第几轮/共几轮"显式写进 prompt，让模型配合收尾；
    // 配合 generateDecision 里的服务端硬收束，双保险保证 maxTurns 真正生效。
    let turnGuidance = '';
    if (mode === 'reply') {
      const configuredMax = hasPersonaSnapshot ? personaSnapshot?.conversation?.maxTurns : undefined;
      const effectiveMaxTurns = typeof configuredMax === 'number' && configuredMax > 0 ? configuredMax : 15;
      const tailHint = context.lastSequence >= effectiveMaxTurns
        ? '已达到本次模拟的最大轮数：suggestedAction 必须为 "end"，并在 replyText 里自然收尾（如表示今天先了解到这里、准备离开或给出最终决定）。'
        : context.lastSequence >= effectiveMaxTurns - 2
          ? '已接近最大轮数，请开始引导成交或明确去留，不要无限拖延对话。'
          : '请在最大轮数内自然推进对话，到达上限时必须结束。';
      turnGuidance = ['', '【轮次控制】', `当前为第 ${context.lastSequence}/${effectiveMaxTurns} 轮（学员每发一条算一轮）。`, tailHint].join('\n');
    }
    return [
      '你正在扮演一名真实顾客，与一位销售新人进行销售话术模拟陪练。始终用第一人称、以顾客口吻自然回应，不要跳出角色、不要替销售员说话。',
      personaBlock,
      behaviorBlock,
      '【对话背景】',
      `conversation_status=${context.conversationStatus}`,
      `release_snapshot_id=${context.releaseSnapshotId}`,
      '',
      '【可用产品知识（仅可引用下列条目，禁止编造未给出的信息）】',
      knowledgeBlock.length > 0 ? knowledgeBlock : '（本次未提供产品知识）',
      '',
      '【对话历史】',
      historyBlock.length > 0 ? historyBlock : '（对话刚开始，由你先以顾客身份回应）',
      turnGuidance,
      '',
      '【输出要求】只输出一个 JSON 对象，不要输出推理过程、Markdown 代码块或任何多余文字。JSON 必须严格符合 agent-output/v1：',
      '{',
      '  "schemaVersion": "agent-output/v1",   // 固定值，必须是 agent-output/v1',
      '  "replyText": "string",                // 你作为顾客说的话，中文，自然口语',
      '  "suggestedAction": "ask_follow_up" | "advance" | "end", // ask_follow_up=继续以顾客身份追问/犹豫/回应；advance=你已被说服、可进入成交或下一环节；end=对话结束',
      '  "knowledgeReferences": ["itemId@version"], // 只能从下面允许列表里原样选取；没有用到产品知识时必须为空数组 []',
      '  "confidence": 0.0                     // 你作为顾客被销售员说服的程度，0 到 1 之间的数字',
      '}',
      `knowledgeReferences 允许列表：${allowedRefIds.length > 0 ? allowedRefIds.join(', ') : '（空，只能输出 []）'}`,
      '示例输出：{"schemaVersion":"agent-output/v1","replyText":"这款真的适合敏感肌吗？我有点担心泛红。","suggestedAction":"ask_follow_up","knowledgeReferences":[],"confidence":0.3}',
      'respond_with_json',
    ].join('\n');
  }

  /**
   * Real LLMs (especially reasoning models) may wrap the JSON in markdown fences
   * or surround it with prose. Tolerate that by trying the raw text, a fenced
   * code block, and the outermost {...} span in order, while still rejecting
   * genuinely non-JSON responses.
   */
  private parseModelContent(raw: string): unknown {
    const text = raw.trim().replace(/^﻿/, '').trim();
    const candidates: string[] = [text];
    const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
    if (fenced !== null && typeof fenced[1] === 'string') candidates.unshift(fenced[1].trim());
    const firstBrace = text.indexOf('{');
    const lastBrace = text.lastIndexOf('}');
    if (firstBrace !== -1 && lastBrace > firstBrace) candidates.push(text.slice(firstBrace, lastBrace + 1));

    let lastError: unknown;
    for (const candidate of candidates) {
      try {
        return JSON.parse(candidate);
      } catch (error) {
        lastError = error;
      }
    }
    throw lastError instanceof Error ? lastError : new Error('MODEL_RESPONSE_NOT_JSON');
  }

  validateAgentDecision(value: unknown, context: RestrictedContext): AgentOutputV1 {
    if (typeof value !== 'object' || value === null) {
      throw new OrchestratorError('MODEL_SCHEMA_INVALID', 'The model decision must be an object.');
    }
    const obj = value as Record<string, unknown>;
    if (obj.schemaVersion !== 'agent-output/v1') {
      throw new OrchestratorError('MODEL_SCHEMA_INVALID', 'The model decision schemaVersion must be agent-output/v1.');
    }
    if (typeof obj.replyText !== 'string') {
      throw new OrchestratorError('MODEL_SCHEMA_INVALID', 'The model decision replyText must be a string.');
    }
    const validActions = ['ask_follow_up', 'advance', 'end'];
    if (typeof obj.suggestedAction !== 'string' || !validActions.includes(obj.suggestedAction)) {
      throw new OrchestratorError('MODEL_SCHEMA_INVALID', 'The model decision suggestedAction is invalid.');
    }
    if (!Array.isArray(obj.knowledgeReferences)) {
      throw new OrchestratorError('MODEL_SCHEMA_INVALID', 'The model decision knowledgeReferences must be an array.');
    }
    if (typeof obj.confidence !== 'number' || obj.confidence < 0 || obj.confidence > 1) {
      throw new OrchestratorError('MODEL_SCHEMA_INVALID', 'The model decision confidence must be a number between 0 and 1.');
    }

    const approvedIds = new Set(context.approvedKnowledge.map((k) => `${k.ref.itemId}@${k.ref.version}`));
    for (const ref of obj.knowledgeReferences as unknown[]) {
      if (typeof ref !== 'string' || !approvedIds.has(ref)) {
        throw new OrchestratorError('MODEL_SCHEMA_INVALID', `The model referenced unknown knowledge: ${String(ref)}.`);
      }
    }

    let stateTransition;
    if (obj.stateTransition != null) {
      try { stateTransition = validateCustomerTransition(obj.stateTransition, context); }
      catch { throw new OrchestratorError('MODEL_SCHEMA_INVALID', 'Invalid customer state transition'); }
    }
    return {
      schemaVersion: 'agent-output/v1',
      replyText: obj.replyText as string,
      suggestedAction: obj.suggestedAction as 'ask_follow_up' | 'advance' | 'end',
      knowledgeReferences: obj.knowledgeReferences as string[],
      confidence: obj.confidence as number,
      ...(stateTransition ? { stateTransition } : {}),
    };
  }

  private async loadApprovedKnowledge(knowledgeVersions: readonly string[], organizationId: string): Promise<readonly ApprovedKnowledgeEntry[]> {
    const entries: ApprovedKnowledgeEntry[] = [];
    for (const kv of knowledgeVersions) {
      const reference = parseKnowledgeVersionReferenceV1(kv);
      if (reference === undefined) {
        throw new OrchestratorError('KNOWLEDGE_NOT_AVAILABLE', `Invalid knowledge version format: ${kv}`);
      }
      try {
        const item = await this.knowledge.getApprovedItem({ ...reference, organizationId });
        entries.push({ ref: { ...reference, organizationId }, content: item.content });
      } catch (error: unknown) {
        const detail = error instanceof Error ? error.message : 'Knowledge could not be loaded.';
        throw new OrchestratorError('KNOWLEDGE_NOT_AVAILABLE', detail);
      }
    }
    return entries;
  }
}

export class OrchestratorError extends Error {
  readonly code: string;
  constructor(code: string, message: string) {
    super(message);
    this.name = 'OrchestratorError';
    this.code = code;
  }
}

/**
 * AgentConfigV1 → 受控行为约束（spec §5.5/§8.2）。
 * 枚举参数翻译为固定模板文案；additionalInstructions 单独成区，只约束角色行为，
 * 不进入系统级指令区。agentConfig 缺失/异常时返回空串（运行时不受影响）。
 */
function buildAgentBehaviorBlock(agentConfig: Readonly<Record<string, unknown>> | undefined): string {
  if (agentConfig === undefined || agentConfig === null || typeof agentConfig !== 'object') return '';
  const responseLength = typeof agentConfig.responseLength === 'string' ? agentConfig.responseLength : undefined;
  const knowledgeStrictness = typeof agentConfig.knowledgeStrictness === 'string' ? agentConfig.knowledgeStrictness : undefined;
  const conversationPace = typeof agentConfig.conversationPace === 'string' ? agentConfig.conversationPace : undefined;
  const closingTendency = typeof agentConfig.closingTendency === 'string' ? agentConfig.closingTendency : undefined;
  const additionalInstructions = typeof agentConfig.additionalInstructions === 'string' ? agentConfig.additionalInstructions : undefined;

  // 完全空配置（无任何行为字段）保持向后兼容：不渲染行为块，prompt 与旧版一致。
  const hasAnyBehavior = responseLength !== undefined || knowledgeStrictness !== undefined
    || conversationPace !== undefined || closingTendency !== undefined
    || (additionalInstructions !== undefined && additionalInstructions.length > 0);
  if (!hasAnyBehavior) return '';
  const lines: string[] = [];

  switch (responseLength) {
    case 'short': lines.push('- 回复尽量简短，通常一句话以内。'); break;
    case 'detailed': lines.push('- 可以回复 2-3 句话，必要时展开说明。'); break;
    default: lines.push('- 每次回复 1-2 句话，保持自然。'); break;
  }
  switch (knowledgeStrictness) {
    case 'strict': lines.push('- 只有产品知识条目明确包含时才提及成分、功效等细节，绝不编造知识。'); break;
    default: lines.push('- 可结合常识自然回应，但不得编造产品知识条目之外的新信息。'); break;
  }
  switch (conversationPace) {
    case 'slow': lines.push('- 推进缓慢：需要销售员多次引导才深入话题，不急于进入实质讨论。'); break;
    case 'fast': lines.push('- 推进较快：销售员引导几次后即可进入实质讨论。'); break;
    default: lines.push('- 按正常节奏对话，跟随销售员的引导自然推进。'); break;
  }
  switch (closingTendency) {
    case 'resistant': lines.push('- 成交倾向低：需要销售员强力说服才考虑购买，常见疑虑较多。'); break;
    case 'receptive': lines.push('- 成交倾向高：较容易被说服，条件合适时倾向成交。'); break;
    default: lines.push('- 成交倾向中性：是否购买视对话情况自然决定。'); break;
  }

  if (lines.length === 0 && (additionalInstructions === undefined || additionalInstructions.length === 0)) return '';

  const behaviorSection = ['【AI 行为配置】', ...lines].join('\n');
  const additional = additionalInstructions !== undefined && additionalInstructions.length > 0
    ? ['', '【额外行为指令】', additionalInstructions].join('\n')
    : '';
  return behaviorSection + additional;
}
