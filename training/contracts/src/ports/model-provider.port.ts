import type { PersonaConfig } from '../persona/config.js';
import type { CustomerState } from '../customer-state.js';

export interface AgentSimulationContext {
  readonly mode: 'opening' | 'reply';
  readonly turnNumber?: number;
  readonly conversationId: string;
  readonly personaSnapshot: PersonaConfig | null;
  readonly recentMessages: readonly { readonly role: 'learner' | 'assistant'; readonly content: string }[];
  readonly learnerMessage?: string;
  readonly approvedKnowledge: readonly { readonly reference: string; readonly content: string }[];
  readonly currentCustomerState?: CustomerState;
}

export interface AgentRequest {
  readonly sessionId: string;
  readonly prompt: string;
  /** Structured context for an internal simulation engine; generic HTTP providers may ignore it. */
  readonly simulation?: AgentSimulationContext;
  /** 单次生成的最大输出 token；缺省由适配器/模型默认值决定。评分等长 JSON 场景可调大以防截断。 */
  readonly maxTokens?: number;
}

export interface AgentResponse {
  readonly content: string;
  readonly modelVersion: string;
  /** OpenAI 兼容的 finish_reason，例如 stop / length；用于识别输出被 max_tokens 截断。 */
  readonly finishReason?: string;
  /** true 表示输出因达到 max_tokens 被截断（finish_reason=length），JSON 可能不完整。 */
  readonly truncated?: boolean;
}

export interface ModelProviderPort {
  generate(request: AgentRequest): Promise<AgentResponse>;
}

/**
 * Transport-level failure raised by a concrete model provider.
 *
 * This is intentionally provider-agnostic: every adapter (in-memory fake,
 * OpenAI-compatible HTTP gateway, future internal router) maps its own
 * transport/timeout/shape failures onto these codes so the orchestrator can
 * translate them into the public problem-details contract without knowing the
 * provider implementation.
 */
export type ModelProviderErrorCode =
  | 'MODEL_TIMEOUT'
  | 'MODEL_RATE_LIMITED'
  | 'MODEL_UPSTREAM_UNAVAILABLE'
  | 'MODEL_RESPONSE_INVALID';

export class ModelProviderError extends Error {
  readonly code: ModelProviderErrorCode;

  public constructor(code: ModelProviderErrorCode, message: string) {
    super(message);
    this.name = 'ModelProviderError';
    this.code = code;
  }
}

export function isModelProviderError(value: unknown): value is ModelProviderError {
  return value instanceof ModelProviderError;
}
