/** Default sink: emit a single structured JSON line on stderr (log-agent friendly). */
const defaultLogSink = (entry) => {
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
export class CompositeEvaluationGenerator {
    llmGenerator;
    ruleGenerator;
    logSink;
    constructor(llmGenerator, ruleGenerator, logSink = defaultLogSink) {
        this.llmGenerator = llmGenerator;
        this.ruleGenerator = ruleGenerator;
        this.logSink = logSink;
    }
    async generate(input) {
        let fallbackReason = 'llm_returned_invalid_report';
        try {
            const report = await this.llmGenerator.generate(input);
            if (report != null && report.generatedBy === 'llm-evaluation/v1') {
                return report;
            }
        }
        catch (error) {
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
