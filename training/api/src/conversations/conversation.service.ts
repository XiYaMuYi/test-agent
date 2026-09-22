import crypto from 'node:crypto';

import type { OnModuleDestroy } from '@nestjs/common';
import type { Pool, PoolClient } from 'pg';
import type { ReleaseSnapshot, ReleaseSnapshotV1, AgentOutputV1, CoachFeedbackData, CustomerMood, CustomerState, PersonaConfig, ConversationEndReason } from '@training/contracts';
import { createInitialCustomerState, customerMoodFromState, normalizeAgentConfig, AGENT_CONFIG_MIN_HISTORY_MESSAGES, AGENT_CONFIG_MAX_HISTORY_MESSAGES } from '@training/contracts';

/** 上下文历史消息默认上限（与 DEFAULT_AGENT_CONFIG.historyMessageLimit 一致）。 */
const DEFAULT_HISTORY_MESSAGE_LIMIT = 20;

import type { CurrentPrincipal } from '../identity/identity-context.js';
import { deriveLearnerId } from '../assignments/eligibility.service.js';
import { canEndConversation, decideMessage, type ConversationSnapshot } from './conversation-state.js';
import { OrchestratorError, type AgentOrchestrator } from '../ai/agent-orchestrator.js';
import type { SessionKnowledgeContext } from '../ai/restricted-context.js';
import { ruleBasedCoachFeedback, detectEvents, llmCoachFeedback } from '../ai/coach/index.js';
import type { DetectedEvent } from '../ai/coach/index.js';
import { assessCustomerState, moodLabelOf } from '../ai/coach/customer-state-assessor.js';

export interface ConversationRecord extends ConversationSnapshot {
  readonly createdAt: Date;
  readonly updatedAt: Date;
}

export interface ConversationMessageRecord {
  readonly id: string;
  readonly conversationId: string;
  readonly clientMessageId: string;
  readonly sequence: number;
  readonly content: string;
  readonly requestHash: string;
  readonly responseHash: string | null;
}

export interface SendMessageInput {
  readonly clientMessageId: string;
  readonly sequence: number;
  readonly content: string;
}

export interface ConversationListItem {
  readonly conversationId: string;
  readonly status: string;
  readonly sourceType: 'free' | 'assigned' | string;
  readonly mode: string;
  readonly personaName: string | null;
  readonly basedOnCard: string | null;
  readonly productScenario: string | null;
  readonly difficulty: number | null;
  readonly evaluationStatus: string | null;
  readonly score: number | null;
  readonly createdAt: Date;
}

export interface TranscriptMessage {
  readonly role: 'learner' | 'assistant';
  readonly sequence: number;
  readonly content: string;
  /** Raw response payload for learner turns; miniprogram parses coach feedback / mood from it. */
  readonly responseHash?: string | null;
}

export interface PendingTurn {
  readonly clientMessageId: string;
  readonly sequence: number;
  readonly content: string;
}

export interface ConversationDetailView {
  readonly messages: readonly TranscriptMessage[];
  readonly evaluation: { readonly status: string; readonly score: number | null } | null;
  readonly pendingTurn: PendingTurn | null;
}

export interface MessageResponse {
  readonly conversationId: string;
  readonly status: ConversationRecord['status'];
  readonly version: number;
  readonly messageId: string;
  readonly sequence: number;
  readonly content: string;
  readonly suggestion?: AgentOutputV1;
  /** Customer mood label for the current turn. */
  readonly customerMood?: CustomerMood;
  /** Rule-based coach evaluation for the learner's current turn. */
  readonly coachFeedback?: CoachFeedbackData;
  /** Internal: running mood value persisted in response_hash for next-turn calculation. */
  readonly moodValue?: number;
  readonly customerState?: CustomerState;
  /**
   * true：本轮 customerState 仍是沿用上一轮的占位，异步大模型研判写回后变 false。
   * 前端据此轮询 customer-state 接口并延迟刷新状态条/情绪。
   */
  readonly customerStatePending?: boolean;
  readonly endReason?: ConversationEndReason;
}

export interface OpeningResponse {
  readonly opening: string;
  readonly customerMood: CustomerMood;
  readonly suggestion?: AgentOutputV1;
  /**
   * wait_learner mode: no AI opening is generated and `opening` is empty.
   * The learner (salesperson) must send the first message; the mini-program
   * renders a "you speak first" hint instead of an AI customer bubble.
   */
  readonly learnerFirst?: boolean;
}

export class ConversationService implements OnModuleDestroy {
  private readonly database: Pool;
  private readonly orchestrator: AgentOrchestrator | undefined;

  public constructor(database: Pool, orchestrator?: AgentOrchestrator) {
    this.database = database;
    this.orchestrator = orchestrator;
  }

  async onModuleDestroy(): Promise<void> {
    await this.database.end();
  }

  async getConversation(principal: CurrentPrincipal, conversationId: string): Promise<ConversationRecord | undefined> {
    const { rows } = await this.database.query<ConversationRecord>(
      `SELECT c.id, c.organization_id AS "organizationId", c.status, c.version, c.last_sequence AS "lastSequence",
              c.training_attempt_id AS "trainingAttemptId", c.release_snapshot_id AS "releaseSnapshotId",
              c.training_session_id AS "trainingSessionId", ts.source_type AS "sourceType",
              ts.persona_snapshot AS "personaSnapshot",
              c.opening_response AS "openingResponse",
              c.initial_customer_state AS "initialCustomerState",
              c.current_customer_state AS "currentCustomerState",
              c.end_reason AS "endReason",
              c.created_at AS "createdAt", c.updated_at AS "updatedAt"
       FROM conversation c
       JOIN training_session ts ON ts.id = c.training_session_id AND ts.organization_id = c.organization_id
       WHERE c.id = $1 AND c.organization_id = $2 AND ts.learner_id = $3`,
      [conversationId, principal.organizationId, deriveLearnerId(principal.principalId)],
    );
    return rows[0];
  }

  /**
   * Learner-facing history list: only the caller's own conversations inside their
   * organization, newest first, with a lightweight persona/evaluation summary.
   */
  async listForLearner(
    principal: CurrentPrincipal,
    pagination: { readonly limit: number; readonly offset: number },
  ): Promise<{ readonly items: readonly ConversationListItem[]; readonly total: number }> {
    const learnerId = deriveLearnerId(principal.principalId);
    const fromSql = `FROM conversation c
       JOIN training_session ts ON ts.id = c.training_session_id AND ts.organization_id = c.organization_id
       LEFT JOIN evaluation_report er ON er.conversation_id = c.id AND er.organization_id = c.organization_id`;
    const whereSql = `WHERE c.organization_id = $1 AND ts.learner_id = $2`;
    const { rows } = await this.database.query<ConversationListItem>(
      `SELECT c.id AS "conversationId", c.status, ts.source_type AS "sourceType", ts.mode,
              ts.persona_snapshot->>'name' AS "personaName",
              ts.persona_snapshot->>'basedOnCard' AS "basedOnCard",
              ts.persona_snapshot#>>'{conversation,productScenario}' AS "productScenario",
              NULLIF(ts.persona_snapshot#>>'{conversation,difficulty}', '')::int AS "difficulty",
              er.status AS "evaluationStatus",
              NULLIF(er.report->>'score', '')::float AS "score",
              c.created_at AS "createdAt"
       ${fromSql}
       ${whereSql}
       ORDER BY c.created_at DESC, c.id
       LIMIT $3 OFFSET $4`,
      [principal.organizationId, learnerId, pagination.limit, pagination.offset],
    );
    const count = await this.database.query<{ n: number }>(
      `SELECT COUNT(*)::int AS n ${fromSql} ${whereSql}`,
      [principal.organizationId, learnerId],
    );
    return { items: rows, total: count.rows[0]?.n ?? 0 };
  }

  /**
   * Full learner-facing detail: conversation metadata plus an ordered transcript
   * (each learner turn followed by the persisted assistant reply) and the latest report.
   */
  async getConversationDetail(
    principal: CurrentPrincipal,
    conversationId: string,
  ): Promise<(ConversationRecord & ConversationDetailView) | undefined> {
    const meta = await this.getConversation(principal, conversationId);
    if (meta === undefined) return undefined;

    const { rows } = await this.database.query<{
      sequence: number;
      role: string;
      content: string;
      clientMessageId: string;
      responseHash: string | null;
    }>(
      `SELECT sequence, role, content, client_message_id AS "clientMessageId", response_hash AS "responseHash"
       FROM conversation_message
       WHERE conversation_id = $1 AND organization_id = $2
       ORDER BY sequence ASC`,
      [conversationId, principal.organizationId],
    );
    const transcript: TranscriptMessage[] = [];
    for (const row of rows) {
      transcript.push({ role: 'learner', sequence: row.sequence, content: row.content, responseHash: row.responseHash });
      if (row.responseHash !== null) {
        const replyText = extractAssistantReply(row.responseHash);
        if (replyText !== undefined) {
          transcript.push({ role: 'assistant', sequence: row.sequence, content: replyText });
        }
      }
    }

    const reportRow = await this.database.query<{ status: string; report: { score?: number } }>(
      `SELECT status, report FROM evaluation_report
       WHERE conversation_id = $1 AND organization_id = $2
       ORDER BY created_at DESC LIMIT 1`,
      [conversationId, principal.organizationId],
    );
    const evaluation = reportRow.rows[0]
      ? { status: reportRow.rows[0].status, score: reportRow.rows[0].report?.score ?? null }
      : null;
    const unfinished = meta.status === 'awaiting_model'
      ? rows.find((row) => row.sequence === meta.lastSequence && row.responseHash === null)
      : undefined;
    const pendingTurn = unfinished
      ? {
          clientMessageId: unfinished.clientMessageId,
          sequence: unfinished.sequence,
          content: unfinished.content,
        }
      : null;

    return { ...meta, messages: transcript, evaluation, pendingTurn };
  }

  async startConversation(principal: CurrentPrincipal, conversationId: string): Promise<OpeningResponse | undefined> {
    const conversation = await this.getConversation(principal, conversationId);
    if (conversation === undefined) return undefined;

    const saved = await this.database.query<{ openingResponse: OpeningResponse | null }>(
      `SELECT opening_response AS "openingResponse"
       FROM conversation
       WHERE id = $1 AND organization_id = $2`,
      [conversationId, principal.organizationId],
    );
    if (saved.rows[0]?.openingResponse) return saved.rows[0]?.openingResponse;

    const initialState = createInitialCustomerState(conversation.personaSnapshot);

    // openingMode = wait_learner（等学员先开口）：流程硬分支。
    // 不调用模型生成 AI 开场白，只把会话置为 active 并落一个 learnerFirst 空开场，
    // 前端据此不渲染首条客户气泡，直接等学员（销售员）发第一句。
    if (conversation.personaSnapshot?.conversation?.openingMode === 'wait_learner') {
      const learnerFirstOpening: OpeningResponse = { opening: '', customerMood: 'neutral', learnerFirst: true };
      return this.persistOpening(principal, conversationId, learnerFirstOpening, initialState);
    }

    if (this.orchestrator === undefined) throw new Error('MODEL_UPSTREAM_UNAVAILABLE');

    const knowledgeContext = await this.loadKnowledgeContext(conversation);
    const context = await this.orchestrator.buildAndValidateContext(conversation, knowledgeContext, []);
    const generated = await this.orchestrator.generateDecision(context, 'opening');
    const opening: OpeningResponse = {
      opening: generated.decision.replyText,
      customerMood: 'neutral',
      suggestion: generated.decision,
    };
    return this.persistOpening(principal, conversationId, opening, initialState);
  }

  /**
   * Persist the first opening exactly once (COALESCE converges concurrent retries),
   * initialize the customer state, and move a freshly created conversation to active.
   * Shared by the normal AI-first opening and the wait_learner empty opening.
   */
  private async persistOpening(
    principal: CurrentPrincipal,
    conversationId: string,
    opening: OpeningResponse,
    initialState: CustomerState,
  ): Promise<OpeningResponse | undefined> {
    const persisted = await this.database.query<{ openingResponse: OpeningResponse }>(
      `UPDATE conversation
       SET opening_response = COALESCE(opening_response, $1::jsonb),
           initial_customer_state = COALESCE(initial_customer_state, $4::jsonb),
           current_customer_state = COALESCE(current_customer_state, $4::jsonb),
           status = CASE WHEN status = 'created' THEN 'active' ELSE status END,
           updated_at = CURRENT_TIMESTAMP
       WHERE id = $2 AND organization_id = $3
       RETURNING opening_response AS "openingResponse"`,
      [JSON.stringify(opening), conversationId, principal.organizationId, JSON.stringify(initialState)],
    );
    return persisted.rows[0]?.openingResponse;
  }

  async sendMessage(principal: CurrentPrincipal, conversationId: string, input: SendMessageInput): Promise<MessageResponse> {
    // Phase 1 atomically accepts a new turn or loads an unfinished turn.
    const client = await this.database.connect();
    let conversation: ConversationSnapshot | undefined;
    let messageId: string;
    let processingVersion: number;
    try {
      await client.query('BEGIN');
      conversation = await this.lockConversation(client, principal, conversationId);
      const existing = await this.findExistingMessage(client, conversation.id, input.clientMessageId);
      const decision = decideMessage(conversation, input, existing ?? undefined);

      if (decision.kind === 'closed') {
        throw new Error('CONVERSATION_CLOSED');
      }

      if (decision.kind === 'idempotency_conflict') {
        throw new Error('MESSAGE_IDEMPOTENCY_CONFLICT');
      }

      if (decision.kind === 'sequence_conflict') {
        throw new Error('MESSAGE_SEQUENCE_CONFLICT');
      }

      if (decision.kind === 'replay' && existing !== undefined) {
        if (existing.responseHash !== null) {
          const response = parsePersistedMessageResponse(existing.responseHash, existing, conversation.id);
          await client.query('COMMIT');
          return toClientMessageResponse(response);
        }

        if (conversation.status !== 'awaiting_model') {
          throw new Error('MESSAGE_SEQUENCE_CONFLICT');
        }

        messageId = existing.id;
        processingVersion = conversation.version;
        await client.query('COMMIT');
      } else {
        messageId = crypto.randomUUID();
        await client.query(
          `INSERT INTO conversation_message (id, organization_id, conversation_id, sequence, client_message_id, role, content, request_hash)
           VALUES ($1, $2, $3, $4, $5, 'learner', $6, $7)`,
          [messageId, principal.organizationId, conversation.id, input.sequence, input.clientMessageId, input.content, hashMessage(input)],
        );
        await client.query(
          `UPDATE conversation
           SET status = 'awaiting_model',
               version = version + 1,
               last_sequence = $1,
               updated_at = CURRENT_TIMESTAMP
           WHERE id = $2 AND organization_id = $3`,
          [input.sequence, conversation.id, principal.organizationId],
        );
        processingVersion = conversation.version + 1;
        await client.query('COMMIT');
      }
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }

    const baseResponse: MessageResponse = {
      conversationId: conversation.id,
      status: 'active',
      version: processingVersion,
      messageId,
      sequence: input.sequence,
      content: input.content,
    };

    // Phase 2 deliberately runs outside a database transaction. On failure the
    // durable turn remains awaiting_model and only the same idempotency key can
    // resume it.
    if (this.orchestrator === undefined) {
      return this.finalizeMessage(principal, processingVersion, baseResponse);
    }

    const knowledgeContext = await this.loadKnowledgeContext(conversation);
    // 上下文截取按 agentConfig.historyMessageLimit（2..50，默认 20）执行：
    // 超过上限的旧消息不进入模型上下文，也不进入教练点评/状态研判的输入。
    const historyMessageLimit = knowledgeContext.agentConfig?.historyMessageLimit;
    const effectiveLimit = typeof historyMessageLimit === 'number'
      && Number.isInteger(historyMessageLimit)
      && historyMessageLimit >= AGENT_CONFIG_MIN_HISTORY_MESSAGES
      && historyMessageLimit <= AGENT_CONFIG_MAX_HISTORY_MESSAGES
      ? historyMessageLimit
      : DEFAULT_HISTORY_MESSAGE_LIMIT;
    const recentMessages = await this.loadRecentMessages(conversation.id, effectiveLimit);
    const mappedMessages = toModelMessages(recentMessages);
    // Coach scope ends at the learner utterance just accepted. The customer reply
    // generated below must not leak into an evaluation of that utterance.
    const coachConversationContext = toCoachConversationContext(mappedMessages, conversation.openingResponse);
    const previousCustomerMsg = findPreviousCustomerMessage(coachConversationContext);
    const context = await this.orchestrator.buildAndValidateContext(
      { ...conversation, status: 'awaiting_model', version: processingVersion, lastSequence: input.sequence },
      knowledgeContext,
      mappedMessages,
    );
    const result = await this.orchestrator.generateDecision(context);
    const suggestion = result.decision;
    const stateTransition = suggestion.stateTransition;

    // ── Coach feedback (sync placeholder) & customer state (async LLM) ──────
    const userMsg = input.content;
    const turnCount = input.sequence;
    const events = detectEvents(userMsg, previousCustomerMsg);

    // 客户 12 维状态改由“异步大模型研判”负责（见 generateAndPersistCustomerState），
    // 主回复不等待它、也不再用关键词规则估算情绪。同步阶段先沿用上一轮状态作为占位，
    // 保证顶部状态条不跳变；异步结果写回后由前端轮询 customer-state 接口延迟刷新。
    const previousState: CustomerState =
      context.currentCustomerState ?? createInitialCustomerState(conversation.personaSnapshot);
    const customerMood: CustomerMood = customerMoodFromState(previousState);

    // 同步教练点评仍先给规则兜底文案（临时），异步大模型点评完成后覆盖为最终版。
    const coachResult = ruleBasedCoachFeedback({
      userMsg,
      aiMsg: previousCustomerMsg,
      turnCount,
      customerMood,
      events,
    });

    const shouldAutoEnd = stateTransition?.terminal.shouldEnd === true;
    const enrichedSuggestion: AgentOutputV1 = {
      ...suggestion,
      ...(shouldAutoEnd ? { suggestedAction: 'end' as const } : {}),
      customerMood,
    };

    const response: MessageResponse = {
      ...baseResponse,
      suggestion: enrichedSuggestion,
      // Return the deterministic fallback immediately so the mini-program can
      // render coaching feedback in the same turn. The async write below keeps
      // the feedback available for replay and polling.
      coachFeedback: {
        rating: coachResult.rating,
        feedback: coachResult.feedback,
        improvements: coachResult.improvements,
        // 同步阶段先给规则兜底版（临时），异步大模型点评完成后会覆盖为最终版。
        provisional: true,
      },
      customerMood,
      moodValue: previousState.emotion - 50,
      // 占位为上一轮状态；customerStatePending=true 表示异步研判尚未写回。
      customerState: previousState,
      customerStatePending: true,
    };
    // Phase 3 atomically persists the complete client-visible response and
    // advances the conversation after a version/status recheck.
    const finalized = await this.finalizeMessage(principal, processingVersion, response);
    // 两个大模型后置任务（客户状态研判、教练点评）串行执行而非并发：同步对话已占用一个模型调用，
    // 若两个异步任务再同时发起，会把共享模型账号的瞬时并发顶到 3、容易触发上游限流(429)。
    // 串行后任一时刻最多 1 个异步调用；二者各自兜底，单个失败不影响另一个，也不阻塞返回。
    void (async (): Promise<void> => {
      // 客户状态优先（驱动前端状态条，用户对情绪变化更敏感）。
      try {
        await this.generateAndPersistCustomerState({
          organizationId: principal.organizationId,
          conversationId: conversation.id,
          messageId,
          sequence: input.sequence,
          previous: previousState,
          persona: conversation.personaSnapshot,
          recentMessages: context.recentMessages,
          turnCount,
        });
      } catch {
        // 研判失败维持上一轮状态，前端不跳变。
      }
      try {
        await this.generateAndPersistCoachFeedback({
          organizationId: principal.organizationId,
          messageId,
          userMsg,
          aiMsg: previousCustomerMsg,
          previousCustomerMsg,
          conversationContext: coachConversationContext,
          turnCount,
          customerMood,
          events,
          fallback: {
            rating: coachResult.rating,
            feedback: coachResult.feedback,
            improvements: coachResult.improvements,
          },
        });
      } catch {
        // 点评失败保留同步规则兜底，无需处理。
      }
    })();
    return finalized;
  }

  async getCoachFeedback(
    principal: CurrentPrincipal,
    conversationId: string,
    messageId: string,
  ): Promise<{ readonly status: 'pending' } | { readonly status: 'ready'; readonly coachFeedback: CoachFeedbackData }> {
    const { rows } = await this.database.query<{ responseHash: string | null }>(
      `SELECT message.response_hash::text AS "responseHash"
       FROM conversation_message message
       JOIN conversation c ON c.id = message.conversation_id AND c.organization_id = message.organization_id
       JOIN training_session ts ON ts.id = c.training_session_id AND ts.organization_id = c.organization_id
       WHERE message.id = $1 AND message.conversation_id = $2
         AND message.organization_id = $3 AND ts.learner_id = $4`,
      [messageId, conversationId, principal.organizationId, deriveLearnerId(principal.principalId)],
    );
    const serialized = rows[0]?.responseHash;
    if (!serialized) return { status: 'pending' };
    try {
      const parsed = JSON.parse(serialized) as { coachFeedback?: CoachFeedbackData };
      // 规则兜底临时版（provisional=true）期间继续返回 pending，
      // 直到异步大模型最终版（provisional=false/缺省）写回才判 ready。
      if (parsed.coachFeedback && !parsed.coachFeedback.provisional) {
        return { status: 'ready', coachFeedback: parsed.coachFeedback };
      }
      return { status: 'pending' };
    } catch {
      return { status: 'pending' };
    }
  }

  private async generateAndPersistCoachFeedback(input: {
    organizationId: string;
    messageId: string;
    userMsg: string;
    aiMsg: string;
    previousCustomerMsg: string;
    conversationContext: readonly { readonly role: 'learner' | 'assistant'; readonly content: string }[];
    turnCount: number;
    customerMood: CustomerMood;
    events: readonly unknown[];
    fallback: CoachFeedbackData;
  }): Promise<void> {
    let feedback = input.fallback;
    // 优先用 LLM 生成有上下文理解能力的教练点评；模型不可用或输出非法时
    // llmCoachFeedback 内部会回落到规则引擎，因此这里永远能得到可用结果。
    if (this.orchestrator !== undefined) {
      const llmResult = await llmCoachFeedback(
        (prompt: string) => this.orchestrator!.generateRawText(prompt),
        {
          userMsg: input.userMsg,
          aiMsg: input.aiMsg,
          previousCustomerMsg: input.previousCustomerMsg,
          conversationContext: input.conversationContext,
          turnCount: input.turnCount,
          customerMood: input.customerMood,
          events: input.events as DetectedEvent[],
        },
      );
      feedback = {
        rating: llmResult.rating,
        feedback: llmResult.feedback,
        improvements: llmResult.improvements,
      };
    }
    // 无论采用 LLM 结果还是回落规则，到这里都是“最终版”：去掉临时标记，
    // 轮询接口 getCoachFeedback 才会判定为 ready，前端据此停止轮询并上屏。
    const finalFeedback: CoachFeedbackData = { ...feedback, provisional: false };
    await this.database.query(
      `UPDATE conversation_message
       SET response_hash = jsonb_set(response_hash::jsonb, '{coachFeedback}', $1::jsonb, true)
       WHERE id = $2 AND organization_id = $3 AND response_hash IS NOT NULL`,
      [JSON.stringify(finalFeedback), input.messageId, input.organizationId],
    );
  }

  /**
   * 客户状态轮询接口：异步大模型研判写回（customerStatePending=false）前一直返回 pending，
   * 写回后返回 ready 与本轮研判出的 12 维状态/情绪，前端据此停止轮询并延迟上屏。
   */
  async getCustomerState(
    principal: CurrentPrincipal,
    conversationId: string,
    messageId: string,
  ): Promise<
    | { readonly status: 'pending' }
    | { readonly status: 'ready'; readonly customerState: CustomerState; readonly customerMood: CustomerMood; readonly moodValue: number }
  > {
    const { rows } = await this.database.query<{ responseHash: string | null }>(
      `SELECT message.response_hash::text AS "responseHash"
       FROM conversation_message message
       JOIN conversation c ON c.id = message.conversation_id AND c.organization_id = message.organization_id
       JOIN training_session ts ON ts.id = c.training_session_id AND ts.organization_id = c.organization_id
       WHERE message.id = $1 AND message.conversation_id = $2
         AND message.organization_id = $3 AND ts.learner_id = $4`,
      [messageId, conversationId, principal.organizationId, deriveLearnerId(principal.principalId)],
    );
    const serialized = rows[0]?.responseHash;
    if (!serialized) return { status: 'pending' };
    try {
      const parsed = JSON.parse(serialized) as {
        customerState?: CustomerState;
        customerStatePending?: boolean;
        customerMood?: CustomerMood;
        moodValue?: number;
      };
      if (parsed.customerState && parsed.customerStatePending === false) {
        const state = parsed.customerState;
        return {
          status: 'ready',
          customerState: state,
          customerMood: parsed.customerMood ?? customerMoodFromState(state),
          moodValue: typeof parsed.moodValue === 'number' ? parsed.moodValue : state.emotion - 50,
        };
      }
      return { status: 'pending' };
    } catch {
      return { status: 'pending' };
    }
  }

  /**
   * 异步大模型客户状态研判（不阻塞主回复）。研判结果：
   * 1) 写回本轮消息 response_hash，供 getCustomerState 轮询返回 ready；
   * 2) 只前进不回退地更新 conversation.current_customer_state（仅当本轮仍是最新轮时），
   *    避免更慢返回的旧轮研判覆盖更新轮的状态。
   * 模型失败时 assessCustomerState 返回 null：保留上一轮状态、不写 ready，前端超时后维持原值。
   */
  private async generateAndPersistCustomerState(input: {
    organizationId: string;
    conversationId: string;
    messageId: string;
    sequence: number;
    previous: CustomerState;
    persona: PersonaConfig | null;
    recentMessages: readonly { readonly role: 'learner' | 'assistant'; readonly content: string }[];
    turnCount: number;
  }): Promise<void> {
    if (this.orchestrator === undefined) return;
    const assessed = await assessCustomerState(
      (prompt: string) => this.orchestrator!.generateRawText(prompt),
      { persona: input.persona, previous: input.previous, recentMessages: input.recentMessages, turnCount: input.turnCount },
    );
    if (assessed === null) return;
    const mood = moodLabelOf(assessed);

    await this.database.query(
      `UPDATE conversation_message
       SET response_hash = jsonb_set(
             jsonb_set(
               jsonb_set(COALESCE(response_hash::jsonb, '{}'::jsonb), '{customerState}', $1::jsonb, true),
               '{customerMood}', $2::jsonb, true),
             '{customerStatePending}', 'false'::jsonb, true)
       WHERE id = $3 AND organization_id = $4 AND response_hash IS NOT NULL`,
      [JSON.stringify(assessed), JSON.stringify(mood), input.messageId, input.organizationId],
    );

    await this.database.query(
      `UPDATE conversation c
       SET current_customer_state = $1::jsonb, updated_at = CURRENT_TIMESTAMP
       FROM conversation_message m
       WHERE m.id = $2 AND m.conversation_id = c.id AND c.organization_id = $3
         AND m.sequence = c.last_sequence`,
      [JSON.stringify(assessed), input.messageId, input.organizationId],
    );
  }

  private async finalizeMessage(
    principal: CurrentPrincipal,
    expectedVersion: number,
    response: MessageResponse,
  ): Promise<MessageResponse> {
    const organizationId = principal.organizationId;
    const client = await this.database.connect();
    try {
      await client.query('BEGIN');
      // Lock in the same order as message acceptance/manual end, preventing deadlocks.
      const conversation = await this.lockConversation(client, principal, response.conversationId);
      const terminal = response.suggestion?.stateTransition?.terminal;
      const reason = terminal?.shouldEnd ? terminal.reason : null;
      if (reason) response = { ...response, status: 'ended', version: expectedVersion + 1, endReason: reason };
      const persisted = await client.query(
        `UPDATE conversation_message
         SET response_hash = $1
         WHERE id = $2 AND organization_id = $3 AND response_hash IS NULL`,
        [JSON.stringify(response), response.messageId, organizationId],
      );
      if (persisted.rowCount === 0) {
        const existing = await this.findMessageById(client, response.messageId, organizationId);
        if (existing?.responseHash === null || existing === undefined) {
          throw new Error('MESSAGE_SEQUENCE_CONFLICT');
        }
        const replay = parsePersistedMessageResponse(existing.responseHash, existing, response.conversationId);
        await client.query('COMMIT');
        return toClientMessageResponse(replay);
      }

      const advanced = await client.query(
        `UPDATE conversation
         SET status = $5,
             version = $6,
             end_reason = $7,
             initial_customer_state = COALESCE(initial_customer_state, $8::jsonb),
             current_customer_state = COALESCE($4::jsonb, current_customer_state, $8::jsonb),
             updated_at = CURRENT_TIMESTAMP
         WHERE id = $1 AND organization_id = $2 AND version = $3 AND status = 'awaiting_model'`,
        [response.conversationId, organizationId, expectedVersion, response.customerState ? JSON.stringify(response.customerState) : null, response.status, response.version, reason, JSON.stringify(createInitialCustomerState(conversation.personaSnapshot))],
      );
      if (advanced.rowCount !== 1) {
        throw new Error('MESSAGE_SEQUENCE_CONFLICT');
      }
      if (reason) await this.settleConversation(client, conversation, organizationId);
      await client.query('COMMIT');
      return toClientMessageResponse(response);
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  async endConversation(principal: CurrentPrincipal, conversationId: string, reason: ConversationEndReason = 'manual_end'): Promise<{ readonly conversationId: string; readonly status: 'ended' } | undefined> {
    const client = await this.database.connect();
    try {
      await client.query('BEGIN');
      const conversation = await this.lockConversation(client, principal, conversationId);
      if (!canEndConversation(conversation.status)) {
        await client.query('COMMIT');
        return { conversationId: conversation.id, status: 'ended' };
      }

      await client.query(
        `UPDATE conversation SET status = 'ended', end_reason = $3, version = version + 1, updated_at = CURRENT_TIMESTAMP WHERE id = $1 AND organization_id = $2`,
        [conversation.id, principal.organizationId, reason],
      );

      await this.settleConversation(client, conversation, principal.organizationId);
      await client.query('COMMIT');
      return { conversationId: conversation.id, status: 'ended' };
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  private async settleConversation(client: PoolClient, conversation: ConversationSnapshot, organizationId: string): Promise<void> {
      // Settle the unified session root for BOTH tracks: this releases the global
      // single-active slot so the learner can start the next session.
      await client.query(
        `UPDATE training_session
         SET status = 'ended', finished_at = COALESCE(finished_at, CURRENT_TIMESTAMP)
         WHERE id = $1 AND organization_id = $2 AND status IN ('created', 'active')`,
        [conversation.trainingSessionId, organizationId],
      );

      // Assigned track additionally settles the legacy attempt/eligibility quota once.
      // The free track has no attempt/learner_assignment to settle (contract §3.4).
      if (conversation.sourceType === 'assigned') {
        if (conversation.trainingAttemptId === null) {
          throw new Error('ATTEMPT_SETTLEMENT_CONFLICT');
        }
        const settlement = await client.query(
          `WITH settled_attempt AS (
             UPDATE training_attempt
             SET status = 'ended',
                 finished_at = COALESCE(finished_at, CURRENT_TIMESTAMP),
                 updated_at = CURRENT_TIMESTAMP
             WHERE id = $1
               AND organization_id = $2
               AND status IN ('created', 'active', 'awaiting_model')
             RETURNING learner_assignment_id
           )
           UPDATE learner_assignment learner
           SET active_attempt_id = NULL,
               total_attempts = total_attempts + 1,
               state = 'completed',
               updated_at = CURRENT_TIMESTAMP
           FROM settled_attempt attempt
           WHERE learner.id = attempt.learner_assignment_id
             AND learner.organization_id = $2
             AND learner.active_attempt_id = $1`,
          [conversation.trainingAttemptId, organizationId],
        );
        if (settlement.rowCount !== 1) {
          throw new Error('ATTEMPT_SETTLEMENT_CONFLICT');
        }
      }
      const evaluationJobId = crypto.randomUUID();
      await client.query(
        `INSERT INTO evaluation_job (id, organization_id, conversation_id, status, attempt_count)
         VALUES ($1, $2, $3, 'queued', 0)
         ON CONFLICT (organization_id, conversation_id) DO NOTHING`,
        [evaluationJobId, organizationId, conversation.id],
      );
      await client.query(
        `INSERT INTO outbox_event (id, organization_id, aggregate_type, aggregate_id, event_type, payload, deduplication_key, status)
         VALUES ($1, $2, 'evaluation', $3, 'evaluation.requested', $4::jsonb, $5, 'pending')
         ON CONFLICT (deduplication_key) DO NOTHING`,
        [
          crypto.randomUUID(),
          organizationId,
          conversation.id,
          JSON.stringify({ conversationId: conversation.id, jobId: evaluationJobId }),
          `evaluation:${conversation.id}`,
        ],
      );
  }

  private async lockConversation(client: PoolClient, principal: CurrentPrincipal, conversationId: string): Promise<ConversationSnapshot> {
    const { rows } = await client.query<ConversationSnapshot>(
      `SELECT c.id, c.organization_id AS "organizationId", c.status, c.version, c.last_sequence AS "lastSequence",
              c.training_attempt_id AS "trainingAttemptId", c.release_snapshot_id AS "releaseSnapshotId",
               c.training_session_id AS "trainingSessionId", ts.source_type AS "sourceType",
                ts.persona_snapshot AS "personaSnapshot",
                c.opening_response AS "openingResponse",
                c.initial_customer_state AS "initialCustomerState",
               c.current_customer_state AS "currentCustomerState",
               c.end_reason AS "endReason"
       FROM conversation c
       JOIN training_session ts ON ts.id = c.training_session_id AND ts.organization_id = c.organization_id
       WHERE c.id = $1 AND c.organization_id = $2 AND ts.learner_id = $3
       FOR UPDATE`,
      [conversationId, principal.organizationId, deriveLearnerId(principal.principalId)],
    );
    const conversation = rows[0];
    if (conversation === undefined) {
      throw new Error('CONVERSATION_NOT_FOUND');
    }
    return conversation;
  }

  private async findExistingMessage(client: PoolClient, conversationId: string, clientMessageId: string): Promise<ConversationMessageRecord | undefined> {
    const { rows } = await client.query<ConversationMessageRecord>(
      `SELECT id, conversation_id AS "conversationId", client_message_id AS "clientMessageId", sequence, content, request_hash AS "requestHash", response_hash AS "responseHash"
       FROM conversation_message
       WHERE conversation_id = $1 AND client_message_id = $2`,
      [conversationId, clientMessageId],
    );
    return rows[0];
  }

  private async findMessageById(client: PoolClient, messageId: string, organizationId: string): Promise<ConversationMessageRecord | undefined> {
    const { rows } = await client.query<ConversationMessageRecord>(
      `SELECT id, conversation_id AS "conversationId", client_message_id AS "clientMessageId", sequence, content, request_hash AS "requestHash", response_hash AS "responseHash"
       FROM conversation_message
       WHERE id = $1 AND organization_id = $2`,
      [messageId, organizationId],
    );
    return rows[0];
  }

  private async loadKnowledgeContext(conversation: ConversationSnapshot): Promise<SessionKnowledgeContext> {
    // 会话级冻结的 agentConfig 优先：assigned 会话在启动时已把"快照 agentConfig +
    // 任务覆盖"合并后冻结进 training_session.agent_config（spec §6.4 扩展），
    // 运行时不回退快照，避免任务覆盖改动造成会话参数漂移。
    if (conversation.trainingSessionId) {
      const { rows } = await this.database.query<{ agent_config: unknown }>(
        'SELECT agent_config FROM training_session WHERE id = $1',
        [conversation.trainingSessionId],
      );
      const sessionAgent = rows[0]?.agent_config;
      if (sessionAgent !== null && sessionAgent !== undefined && typeof sessionAgent === 'object' && !Array.isArray(sessionAgent)) {
        const snapshot = conversation.releaseSnapshotId !== null
          ? await this.loadReleaseSnapshot(conversation.releaseSnapshotId)
          : null;
        return {
          releaseSnapshotId: conversation.releaseSnapshotId,
          knowledgeVersions: snapshot?.knowledgeVersions ?? [],
          agentConfig: normalizeAgentConfig(sessionAgent) as unknown as Record<string, unknown>,
        };
      }
    }
    // Assigned sessions load their immutable release snapshot.
    if (conversation.releaseSnapshotId !== null) {
      const snapshot = await this.loadReleaseSnapshot(conversation.releaseSnapshotId);
      return {
        releaseSnapshotId: snapshot.releaseSnapshotId,
        knowledgeVersions: snapshot.knowledgeVersions,
        agentConfig: normalizeAgentConfig(snapshot.agentConfig) as unknown as Record<string, unknown>,
      };
    }
    // A free session may inherit approved knowledge from the template it started from.
    if (conversation.trainingSessionId) {
      const { rows } = await this.database.query<{
        knowledge_versions: readonly string[];
        agent_config: Record<string, unknown>;
      }>(
        `SELECT t.knowledge_versions, t.agent_config
         FROM training_session ts
         JOIN training_template t ON t.id = ts.template_id AND t.organization_id = ts.organization_id
         WHERE ts.id = $1`,
        [conversation.trainingSessionId],
      );
      const template = rows[0];
      if (template !== undefined) {
        return {
          releaseSnapshotId: null,
          knowledgeVersions: template.knowledge_versions ?? [],
          agentConfig: normalizeAgentConfig(template.agent_config) as unknown as Record<string, unknown>,
        };
      }
    }
    // A fully self-configured free session runs with no pre-approved knowledge.
    return { releaseSnapshotId: null, knowledgeVersions: [], agentConfig: {} };
  }

  private async loadReleaseSnapshot(releaseSnapshotId: string): Promise<ReleaseSnapshot> {
    const { rows } = await this.database.query<{ snapshot: ReleaseSnapshot }>(
      'SELECT snapshot FROM release_snapshot WHERE id = $1',
      [releaseSnapshotId],
    );
    if (rows[0] === undefined) {
      throw new Error('RELEASE_SNAPSHOT_NOT_FOUND');
    }
    return rows[0].snapshot;
  }

  private async loadRecentMessages(conversationId: string, limit = 20): Promise<readonly ConversationMessageRecord[]> {
    const { rows } = await this.database.query<ConversationMessageRecord>(
      `SELECT id, conversation_id AS "conversationId", client_message_id AS "clientMessageId", sequence, content, request_hash AS "requestHash", response_hash AS "responseHash"
       FROM conversation_message
       WHERE conversation_id = $1
       ORDER BY sequence DESC
       LIMIT $2`,
      [conversationId, limit],
    );
    return rows.reverse();
  }
}

function extractAssistantReply(serializedResponse: string): string | undefined {
  try {
    const parsed = JSON.parse(serializedResponse) as { suggestion?: { replyText?: unknown } };
    return typeof parsed.suggestion?.replyText === 'string' && parsed.suggestion.replyText.length > 0
      ? parsed.suggestion.replyText
      : undefined;
  } catch {
    return undefined;
  }
}

function toModelMessages(
  messages: readonly ConversationMessageRecord[],
): readonly { readonly role: 'learner' | 'assistant'; readonly content: string }[] {
  const transcript: { role: 'learner' | 'assistant'; content: string }[] = [];
  for (const message of messages) {
    transcript.push({ role: 'learner', content: message.content });
    if (message.responseHash !== null) {
      const assistantReply = extractAssistantReply(message.responseHash);
      if (assistantReply !== undefined) transcript.push({ role: 'assistant', content: assistantReply });
    }
  }
  return transcript;
}

function toCoachConversationContext(
  messages: readonly { readonly role: 'learner' | 'assistant'; readonly content: string }[],
  openingResponse: ConversationSnapshot['openingResponse'],
): readonly { readonly role: 'learner' | 'assistant'; readonly content: string }[] {
  const opening = typeof openingResponse?.opening === 'string' ? openingResponse.opening.trim() : '';
  if (opening === '' || openingResponse?.learnerFirst === true) return messages;
  return [{ role: 'assistant', content: opening }, ...messages];
}

function findPreviousCustomerMessage(
  messages: readonly { readonly role: 'learner' | 'assistant'; readonly content: string }[],
): string {
  let learnerIndex = -1;
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    if (messages[index]?.role === 'learner') {
      learnerIndex = index;
      break;
    }
  }
  for (let index = learnerIndex - 1; index >= 0; index -= 1) {
    const message = messages[index];
    if (message?.role === 'assistant' && message.content.trim() !== '') return message.content;
  }
  return '';
}

function hashMessage(input: SendMessageInput): string {
  return crypto.createHash('sha256').update(JSON.stringify(input)).digest('hex');
}

function parsePersistedMessageResponse(
  serialized: string,
  message: ConversationMessageRecord,
  conversationId: string,
): MessageResponse {
  let value: unknown;
  try {
    value = JSON.parse(serialized);
  } catch {
    throw new OrchestratorError('MODEL_SCHEMA_INVALID', 'The persisted message response is not valid JSON.');
  }
  if (typeof value !== 'object' || value === null) {
    throw new OrchestratorError('MODEL_SCHEMA_INVALID', 'The persisted message response must be an object.');
  }

  const response = value as Record<string, unknown>;
  const validStatus = response.status === 'created'
    || response.status === 'active'
    || response.status === 'awaiting_model'
    || response.status === 'completed'
    || response.status === 'ended'
    || response.status === 'failed';
  if (
    response.conversationId !== conversationId
    || response.messageId !== message.id
    || response.sequence !== message.sequence
    || response.content !== message.content
    || !validStatus
    || !Number.isInteger(response.version)
    || (response.suggestion !== undefined && !isAgentOutputV1(response.suggestion))
  ) {
    throw new OrchestratorError('MODEL_SCHEMA_INVALID', 'The persisted message response is invalid.');
  }
  return response as unknown as MessageResponse;
}

function isAgentOutputV1(value: unknown): value is AgentOutputV1 {
  if (typeof value !== 'object' || value === null) return false;
  const output = value as Record<string, unknown>;
  return output.schemaVersion === 'agent-output/v1'
    && typeof output.replyText === 'string'
    && (output.suggestedAction === 'ask_follow_up' || output.suggestedAction === 'advance' || output.suggestedAction === 'end')
    && Array.isArray(output.knowledgeReferences)
    && output.knowledgeReferences.every((reference) => typeof reference === 'string')
    && typeof output.confidence === 'number'
    && output.confidence >= 0
    && output.confidence <= 1;
}

/**
 * Strip internal-only fields from a turn response before it leaves the API.
 *
 * `moodValue` is the running mood accumulator: it MUST be persisted inside
 * `response_hash` for the next turn, but it is an internal scalar that is never
 * shown to the mini-program user, so it is removed from the HTTP payload. The
 * input object is never mutated (the persisted copy keeps the field).
 */
export function toClientMessageResponse(response: MessageResponse): MessageResponse {
  // `moodValue` is internal bookkeeping persisted in response_hash only; it is
  // removed from the client payload. Destructuring leaves the source object
  // (already serialized for persistence) untouched.
  const { moodValue: _internalMoodValue, ...clientResponse } = response;
  return clientResponse;
}
