import type { AgentRequest, AgentResponse, ModelProviderPort } from '../ports/model-provider.port.js';
import { ModelProviderError } from '../ports/model-provider.port.js';

export interface HttpModelConfiguration {
  /** OpenAI-compatible API root, e.g. https://coding.dashscope.aliyuncs.com/v1 */
  readonly baseUrl: string;
  readonly apiKey: string;
  /** Deployment/model id sent in the chat-completion request, e.g. qwen3.7-plus. */
  readonly model: string;
  readonly timeoutMs: number;
  /**
   * 是否允许推理模型输出思维链（DashScope/Qwen3 的 enable_thinking）。
   * 默认 false：思维链会产生大量 reasoning_tokens，把单次生成拖到数十秒，
   * 不适合实时陪练；仅当显式置为 true 时才保留模型默认的思考行为。
   */
  readonly enableThinking?: boolean;
  /** 单次生成最大输出 token，默认 4096；评分等长 JSON 场景应调大到 8192，避免 JSON 被截断。 */
  readonly maxTokens?: number;
  /** 可重试错误（429/5xx/超时/网关限流）的最大重试次数，默认 2（即最多请求 3 次）。 */
  readonly maxRetries?: number;
}

export interface HttpFetchResponse {
  readonly ok: boolean;
  readonly status: number;
  json(): Promise<unknown>;
}

export interface HttpFetchInit {
  readonly method: 'POST';
  readonly headers: Readonly<Record<string, string>>;
  readonly body: string;
  readonly signal: AbortSignal;
}

export type HttpFetchLike = (url: string, init: HttpFetchInit) => Promise<HttpFetchResponse>;

/** Production fetch binding; injected in tests so no network or secret is required there. */
export const defaultHttpFetch: HttpFetchLike = (url, init) =>
  fetch(url, init) as unknown as Promise<HttpFetchResponse>;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function extractContent(payload: unknown): string | undefined {
  if (!isRecord(payload) || !Array.isArray(payload.choices) || payload.choices.length === 0) return undefined;
  const first = payload.choices[0];
  if (!isRecord(first) || !isRecord(first.message)) return undefined;
  const content = first.message.content;
  return typeof content === 'string' && content.length > 0 ? content : undefined;
}

function extractFinishReason(payload: unknown): string | undefined {
  if (!isRecord(payload) || !Array.isArray(payload.choices) || payload.choices.length === 0) return undefined;
  const first = payload.choices[0];
  return isRecord(first) && typeof first.finish_reason === 'string' ? first.finish_reason : undefined;
}

function extractModel(payload: unknown): string | undefined {
  return isRecord(payload) && typeof payload.model === 'string' && payload.model.length > 0 ? payload.model : undefined;
}

/**
 * 部分网关（如通义灵码 coding.dashscope）在限流/配额耗尽时仍返回 HTTP 200，
 * 把错误包在 body 的 error / code / message 字段里（如 ResourceExhausted、429、quota）。
 * 返回可重试的归一化错误码；非错误返回 undefined。
 */
function extractUpstreamError(payload: unknown): 'rate_limited' | 'upstream_error' | undefined {
  if (!isRecord(payload)) return undefined;
  const err = isRecord(payload.error) ? payload.error : undefined;
  const code = String(err?.code ?? payload.code ?? '').toLowerCase();
  const message = String(err?.message ?? payload.message ?? '').toLowerCase();
  const haystack = `${code} ${message}`;
  if (/rate.?limit|resource.?exhaust|quota|too many requests|429|throttl|并发|限流/.test(haystack)) {
    return 'rate_limited';
  }
  if (err !== undefined || /internal.?error|bad.?gateway|service.?unavailable|5\d{2}/.test(haystack)) {
    return 'upstream_error';
  }
  return undefined;
}

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

function toTransportError(error: unknown): ModelProviderError {
  if (error instanceof ModelProviderError) return error;
  if (error instanceof Error && error.name === 'AbortError') {
    return new ModelProviderError('MODEL_TIMEOUT', 'The model upstream timed out.');
  }
  // Never surface the underlying network message verbatim: it can embed URLs or credentials.
  return new ModelProviderError('MODEL_UPSTREAM_UNAVAILABLE', 'The model upstream could not be reached.');
}

/**
 * ModelProviderPort over any OpenAI-compatible /chat/completions gateway
 * (Aliyun DashScope, OpenAI, self-hosted compatible routers, ...).
 * Transport and shape failures are normalized onto ModelProviderError so the
 * orchestrator stays independent of the concrete provider.
 */
export class HttpModelAdapter implements ModelProviderPort {
  public constructor(
    private readonly fetcher: HttpFetchLike,
    private readonly config: HttpModelConfiguration,
  ) {}

  public async generate(request: AgentRequest): Promise<AgentResponse> {
    const url = `${this.config.baseUrl.replace(/\/+$/, '')}/chat/completions`;
    const maxTokens = request.maxTokens ?? this.config.maxTokens ?? 4096;
    const maxRetries = this.config.maxRetries ?? 2;

    let lastError: ModelProviderError | null = null;

    for (let attempt = 0; attempt <= maxRetries; attempt += 1) {
      if (attempt > 0) {
        // 指数退避 + 抖动：0.6s, 1.4s, 3s …，避免并发请求同时重试再次打爆限流。
        const backoffMs = Math.round(300 * 2 ** attempt + Math.random() * 300);
        await sleep(backoffMs);
      }

      let response: HttpFetchResponse;
      try {
        response = await this.fetcher(url, {
          method: 'POST',
          headers: {
            authorization: `Bearer ${this.config.apiKey}`,
            'content-type': 'application/json',
          },
          body: JSON.stringify({
            model: this.config.model,
            messages: [{ role: 'user', content: request.prompt }],
            // OpenAI-compatible gateways (DashScope/Qwen, OpenAI, ...) honor this to return strict JSON.
            response_format: { type: 'json_object' },
            max_tokens: maxTokens,
            // Qwen3 等推理模型默认先输出大量思维链(reasoning_tokens)，单次生成会被拖到数十秒；
            // 实时陪练默认关闭思维链以提速，显式 enableThinking=true 时不发送该字段、保留思考。
            ...(this.config.enableThinking === true ? {} : { enable_thinking: false }),
          }),
          signal: AbortSignal.timeout(this.config.timeoutMs),
        });
      } catch (error) {
        // 网络层失败 / 超时：可重试。
        lastError = toTransportError(error);
        if (attempt < maxRetries && this.isRetryable(lastError)) continue;
        throw lastError;
      }

      // HTTP 429 / 5xx：可重试；其余 4xx 直接失败。
      if (!response.ok) {
        const retryable = response.status === 429 || response.status >= 500;
        lastError = new ModelProviderError(
          response.status === 429 ? 'MODEL_RATE_LIMITED' : 'MODEL_UPSTREAM_UNAVAILABLE',
          `The model upstream responded with HTTP ${response.status}.`,
        );
        if (attempt < maxRetries && retryable) continue;
        throw lastError;
      }

      // eslint-disable-next-line no-await-in-loop
      const payload = await response.json().catch((): undefined => undefined);

      // HTTP 200 但 body 内是限流/上游错误（通义灵码网关的非标准行为）：可重试。
      const upstreamError = extractUpstreamError(payload);
      if (upstreamError !== undefined) {
        lastError = new ModelProviderError(
          upstreamError === 'rate_limited' ? 'MODEL_RATE_LIMITED' : 'MODEL_UPSTREAM_UNAVAILABLE',
          'The model upstream returned an error in the response body.',
        );
        if (attempt < maxRetries) continue;
        throw lastError;
      }

      const content = extractContent(payload);
      if (content === undefined) {
        lastError = new ModelProviderError(
          'MODEL_RESPONSE_INVALID',
          'The model upstream response does not contain choices[0].message.content.',
        );
        // 空响应有时是网关瞬时抖动，重试一次。
        if (attempt < maxRetries) continue;
        throw lastError;
      }

      const finishReason = extractFinishReason(payload);
      return {
        content,
        modelVersion: extractModel(payload) ?? this.config.model,
        ...(finishReason ? { finishReason } : {}),
        truncated: finishReason === 'length',
      };
    }

    throw lastError ?? new ModelProviderError('MODEL_UPSTREAM_UNAVAILABLE', 'The model upstream call failed.');
  }

  private isRetryable(error: ModelProviderError): boolean {
    return error.code === 'MODEL_TIMEOUT'
      || error.code === 'MODEL_RATE_LIMITED'
      || error.code === 'MODEL_UPSTREAM_UNAVAILABLE';
  }
}
