import { ModelProviderError } from '@training/contracts';

import { toReportRecord, type EvaluationInput, type EvaluationReportGenerator } from './evaluation.processor.js';

interface PythonEvaluationConfiguration {
  readonly baseUrl: string;
  readonly token: string;
  readonly timeoutMs: number;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function readScore(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) ? Math.round(Math.max(0, Math.min(100, value))) : 50;
}

/** Calls the Python/FastAPI evaluator; its caller supplies the rule-based fallback. */
export class PythonEvaluationReportGenerator implements EvaluationReportGenerator {
  public constructor(private readonly config: PythonEvaluationConfiguration) {}

  public async generate(input: EvaluationInput): Promise<Record<string, unknown>> {
    let response: Response;
    try {
      response = await fetch(`${this.config.baseUrl.replace(/\/+$/, '')}/internal/v1/evaluation`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-internal-token': this.config.token },
        body: JSON.stringify({
          schemaVersion: 'evaluation-request/v1',
          conversationId: 'worker-evaluation',
          personaSnapshot: input.personaConfig,
          messages: input.transcript.map((message) => ({ role: message.role, content: message.content })),
          customerMood: input.customerMood,
          initialCustomerState: input.initialCustomerState,
          finalCustomerState: input.finalCustomerState,
          stateTransitions: input.stateTransitions ?? [],
          endReason: input.endReason,
        }),
        signal: AbortSignal.timeout(this.config.timeoutMs),
      });
    } catch (error) {
      throw new ModelProviderError(
        error instanceof Error && error.name === 'TimeoutError' ? 'MODEL_TIMEOUT' : 'MODEL_UPSTREAM_UNAVAILABLE',
        'Python evaluation service could not be reached.',
      );
    }
    if (!response.ok) {
      throw new ModelProviderError('MODEL_UPSTREAM_UNAVAILABLE', `Python evaluation service returned HTTP ${response.status}.`);
    }
    const payload: unknown = await response.json().catch(() => undefined);
    if (!isRecord(payload) || !isRecord(payload.dimensionScores)) {
      throw new ModelProviderError('MODEL_RESPONSE_INVALID', 'Python evaluation response has an invalid shape.');
    }
    const dims = payload.dimensionScores;
    const dimensionScores = Object.fromEntries(
      Object.entries(dims).map(([name, value]) => [name, readScore(value)]),
    );
    const score = readScore(payload.score);
    const strings = (value: unknown): string[] => Array.isArray(value)
      ? value.filter((item): item is string => typeof item === 'string' && item.trim().length > 0)
      : [];
    return toReportRecord({
      schemaVersion: 'evaluation-report/v1',
      generatedBy: 'llm-evaluation/v1',
      messageCount: input.transcript.length,
      scoringRules: input.scoringRules,
      score,
      dimensionScores,
      highlights: strings(payload.highlights),
      improvements: strings(payload.improvements),
      customerMood: typeof payload.customerMood === 'string' ? payload.customerMood : input.customerMood,
      totalTurns: typeof payload.totalTurns === 'number' ? payload.totalTurns : input.transcript.filter((m) => m.role === 'assistant').length,
      stateComparison: isRecord(payload.stateComparison)
        ? payload.stateComparison
        : { initial: input.initialCustomerState, final: input.finalCustomerState },
      capabilityEvidence: Array.isArray(payload.capabilityEvidence) ? payload.capabilityEvidence : [],
      endReason: typeof payload.endReason === 'string' ? payload.endReason : input.endReason,
    });
  }
}
