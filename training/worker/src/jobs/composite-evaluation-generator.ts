import type { EvaluationInput, EvaluationReportGenerator } from './evaluation.processor.js';

/** Structured log sink so fallback events are machine-parseable and testable. */
export type EvaluationLogSink = (entry: {
  readonly event: string;
  readonly level: 'warn';
  readonly generator: string;
  readonly at: string;
  readonly reason?: string;
}) => void;

/** Default sink: emit a single structured JSON line on stderr (log-agent friendly). */
const defaultLogSink: EvaluationLogSink = (entry) => {
  // eslint-disable-next-line no-console
  console.warn(JSON.stringify(entry));
};

/**
 * Composite evaluation generator that tries LLM-based evaluation first and
 * transparently falls back to rule-based evaluation when the LLM generator
 * fails (throws an exception or returns null / a non-LLM report).
 *
 * Implements the same `EvaluationReportGenerator` interface as the individual
 * generators, so it can be dropped into the worker module interchangeably.
 */
export class CompositeEvaluationGenerator implements EvaluationReportGenerator {
  public constructor(
    private readonly llmGenerator: EvaluationReportGenerator,
    private readonly ruleGenerator: EvaluationReportGenerator,
    private readonly logSink: EvaluationLogSink = defaultLogSink,
  ) {}

  public async generate(input: EvaluationInput): Promise<Record<string, unknown>> {
    let fallbackReason = 'llm_returned_invalid_report';
    // 接受所有“真正由 LLM 成功生成”的报告标识；
    // 显式排除各生成器内部的 *-fallback 兜底报告（那些维度多为默认分，交给规则引擎更可靠）。
    const acceptedLLMGenerators = new Set<string>([
      'llm-evaluation/v1',
      'context-aware-llm-evaluation/v1',
      'grouped-llm-evaluation/v2',
    ]);
    try {
      const report = await this.llmGenerator.generate(input);
      if (report != null && typeof report.generatedBy === 'string' && acceptedLLMGenerators.has(report.generatedBy)) {
        return report;
      }
    } catch (error) {
      fallbackReason = error instanceof Error ? error.message : 'llm_generator_threw';
    }
    // Structured fallback event instead of a free-form console.log line.
    this.logSink({
      event: 'llm_evaluation_fallback',
      level: 'warn',
      generator: 'CompositeEvaluationGenerator',
      at: new Date().toISOString(),
      reason: fallbackReason,
    });
    return this.ruleGenerator.generate(input);
  }
}
