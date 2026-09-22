import crypto from 'node:crypto';

import type { AgentRequest, AgentResponse, ModelProviderPort } from '@training/contracts';
import { ModelProviderError } from '@training/contracts';
import type { HttpFetchLike, HttpFetchResponse } from '@training/contracts';

export interface PythonAiConfiguration {
  readonly baseUrl: string;
  readonly internalToken: string;
  readonly timeoutMs: number;
}

export const defaultPythonAiFetch: HttpFetchLike = (url, init) =>
  fetch(url, init) as unknown as Promise<HttpFetchResponse>;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isAgentOutput(value: unknown): value is Record<string, unknown> {
  if (!isRecord(value)) return false;
  return value.schemaVersion === 'agent-output/v1'
    && typeof value.replyText === 'string'
    && (value.suggestedAction === 'ask_follow_up' || value.suggestedAction === 'advance' || value.suggestedAction === 'end')
    && Array.isArray(value.knowledgeReferences)
    && typeof value.confidence === 'number';
}

function transportError(error: unknown): ModelProviderError {
  if (error instanceof ModelProviderError) return error;
  if (error instanceof Error && error.name === 'AbortError') {
    return new ModelProviderError('MODEL_TIMEOUT', 'The Python AI engine timed out.');
  }
  return new ModelProviderError('MODEL_UPSTREAM_UNAVAILABLE', 'The Python AI engine could not be reached.');
}

export class PythonAiAdapter implements ModelProviderPort {
  public constructor(
    private readonly fetcher: HttpFetchLike,
    private readonly config: PythonAiConfiguration,
  ) {}

  public async generate(request: AgentRequest): Promise<AgentResponse> {
    if (request.simulation === undefined) {
      throw new ModelProviderError('MODEL_RESPONSE_INVALID', 'Structured simulation context is required.');
    }
    const mode = request.simulation.mode;
    const url = `${this.config.baseUrl.replace(/\/+$/, '')}/internal/v1/customer/${mode}`;
    let response: HttpFetchResponse;
    try {
      response = await this.fetcher(url, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-internal-token': this.config.internalToken,
        },
        body: JSON.stringify({
          schemaVersion: 'customer-simulation-request/v1',
          requestId: crypto.randomUUID(),
          ...request.simulation,
        }),
        signal: AbortSignal.timeout(this.config.timeoutMs),
      });
    } catch (error) {
      throw transportError(error);
    }
    if (!response.ok) {
      throw new ModelProviderError(
        'MODEL_UPSTREAM_UNAVAILABLE',
        `The Python AI engine responded with HTTP ${response.status}.`,
      );
    }
    const payload = await response.json().catch((): undefined => undefined);
    if (!isAgentOutput(payload)) {
      throw new ModelProviderError('MODEL_RESPONSE_INVALID', 'The Python AI engine returned an invalid agent-output/v1 response.');
    }
    return {
      content: JSON.stringify(payload),
      modelVersion: typeof payload.modelVersion === 'string' ? payload.modelVersion : 'python-ai-engine',
    };
  }
}
