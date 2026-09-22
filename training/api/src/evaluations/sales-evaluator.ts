import type {
  DimensionScores,
  ModelProviderPort,
  PersonaConfig,
  RuleBasedEvaluationReport,
  TranscriptMessage,
} from '@training/contracts';
import { ruleBasedEvaluate } from '@training/contracts';

/**
 * Structural result of a sales-performance evaluation.
 *
 * The shape is a thin projection of `RuleBasedEvaluationReport` from
 * `@training/contracts`: the API and the worker share the same rubric, the same
 * five dimensions, and the same highlight/improvement strings. The only
 * API-specific additions are `conversationId` (so callers can correlate the
 * result back to the conversation) and `passed` (a convenience flag for
 * downstream UI/service logic).
 */
export interface SalesScore {
  readonly conversationId: string;
  readonly totalScore: number;
  readonly dimensionScores: DimensionScores;
  readonly highlights: readonly string[];
  readonly improvements: readonly string[];
  readonly passed: boolean;
  readonly summary: string;
}

const PASS_THRESHOLD = 60;

/**
 * Score a conversation using the shared rule-based rubric from
 * `@training/contracts`.
 *
 * The evaluator no longer fabricates a neutral zero score — it runs the same
 * keyword-driven rubric the worker uses, guaranteeing that an evaluation
 * produced here is byte-for-byte consistent (modulo the `conversationId`
 * wrapper) with one produced asynchronously by the worker.
 *
 * The `model` parameter is retained for interface compatibility with future
 * LLM-augmented scoring but is currently unused.
 */
export class SalesEvaluator {
  public constructor(private readonly model: ModelProviderPort) {
    void this.model;
  }

  async evaluate(
    conversationId: string,
    messages: readonly { readonly role: string; readonly content: string }[],
    personaConfig: PersonaConfig,
  ): Promise<SalesScore> {
    void personaConfig;

    const transcript: TranscriptMessage[] = messages
      .filter(
        (message): message is { readonly role: TranscriptMessage['role']; readonly content: string } =>
          message.role === 'learner' || message.role === 'assistant',
      )
      .map((message) => ({ role: message.role, content: message.content }));

    // The API path does not persist per-turn customer mood the way the worker
    // does (the worker reads it from the response_hash of each assistant turn).
    // Default to 'neutral' so the emotion_management dimension is evaluated
    // conservatively rather than optimistically.
    const customerMood = 'neutral';

    const report: RuleBasedEvaluationReport = ruleBasedEvaluate({
      transcript,
      customerMood,
      personaConfig,
    });

    return {
      conversationId,
      totalScore: report.score,
      dimensionScores: report.dimensionScores,
      highlights: report.highlights,
      improvements: report.improvements,
      passed: report.score >= PASS_THRESHOLD,
      summary: buildSummary(report),
    };
  }
}

function buildSummary(report: RuleBasedEvaluationReport): string {
  const parts: string[] = [];
  if (report.highlights.length > 0) {
    parts.push(`亮点：${report.highlights.join('、')}`);
  }
  if (report.improvements.length > 0) {
    parts.push(`改进：${report.improvements.join('、')}`);
  }
  return parts.join('；') || `总分 ${report.score}`;
}
