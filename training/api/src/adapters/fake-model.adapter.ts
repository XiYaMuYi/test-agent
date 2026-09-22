import type { AgentRequest, AgentResponse, ModelProviderPort } from '@training/contracts';

export type FakeModelScenario = 'success' | 'timeout' | 'schema-error';

export interface FakeModelAdapterOptions {
  readonly modelVersion?: string;
  readonly scenario?: FakeModelScenario;
  readonly action?: 'ask_follow_up' | 'advance' | 'end';
}

class FakeModelError extends Error {
  readonly code: 'FAKE_MODEL_TIMEOUT' | 'FAKE_MODEL_SCHEMA_ERROR';

  constructor(
    code: 'FAKE_MODEL_TIMEOUT' | 'FAKE_MODEL_SCHEMA_ERROR',
    message: string,
  ) {
    super(message);
    this.code = code;
    this.name = 'FakeModelError';
  }
}

export function isFakeModelError(value: unknown): value is FakeModelError {
  return value instanceof FakeModelError;
}

/** Deterministic, network-free G1 substitute for a future model provider. */
export class FakeModelAdapter implements ModelProviderPort {
  private readonly modelVersion: string;
  private readonly scenario: FakeModelScenario;
  private readonly action: 'ask_follow_up' | 'advance' | 'end';

  constructor(options: FakeModelAdapterOptions = {}) {
    this.modelVersion = options.modelVersion ?? 'fake-model-v1';
    this.scenario = options.scenario ?? 'success';
    this.action = options.action ?? 'ask_follow_up';
  }

  async generate(request: AgentRequest): Promise<AgentResponse> {
    if (this.scenario === 'timeout') {
      throw new FakeModelError('FAKE_MODEL_TIMEOUT', 'The fake model timed out.');
    }

    if (this.scenario === 'schema-error' || request.sessionId.length === 0 || request.prompt.length === 0) {
      throw new FakeModelError('FAKE_MODEL_SCHEMA_ERROR', 'The fake model request failed schema validation.');
    }

    // Offline stand-in for the simulated customer: natural Chinese lines keyed by the
    // chosen action. Deliberately contains no session/conversation id so local demos
    // never leak internal identifiers into the learner-facing chat.
    const replyByAction: Record<'ask_follow_up' | 'advance' | 'end', string> = {
      ask_follow_up: '嗯……我再了解一下，这款真的适合我的情况吗？用起来会不会有什么不舒服的反应？',
      advance: '听你这么介绍我有点心动了，那先拿一套试试看吧。',
      end: '好的，谢谢你的耐心介绍，我先了解到这里。',
    };

    const decision = {
      schemaVersion: 'agent-output/v1',
      replyText: replyByAction[this.action],
      suggestedAction: this.action,
      knowledgeReferences: [],
      confidence: 0.9,
    };

    return {
      content: JSON.stringify(decision),
      modelVersion: this.modelVersion,
    };
  }
}
