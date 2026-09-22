import { toReportRecord } from './evaluation.processor.js';
/**
 * Re-export the pure rule-based evaluator and its types from the shared
 * `@training/contracts` package. This keeps existing imports inside the worker
 * (and its tests) working while ensuring a single source of truth for the
 * scoring logic — the API and the worker can never drift apart.
 */
export { ruleBasedEvaluate, } from '@training/contracts';
import { ruleBasedEvaluate, } from '@training/contracts';
/**
 * Production-ready adapter that turns the pure `ruleBasedEvaluate` function into
 * an `EvaluationReportGenerator`.  All per-evaluation data (transcript, mood,
 * persona) is read from the `EvaluationInput` passed to `generate()`; the
 * constructor is intentionally argument-free so the class can be composed into
 * the worker module without needing to know anything about a specific
 * conversation up-front.
 *
 * Earlier revisions accepted transcript/mood/persona via the constructor.  That
 * shape was incompatible with dependency injection (the worker module is built
 * once, before any evaluation input exists) and was therefore narrowed to a
 * no-arg constructor in T29.3.
 */
export class RuleBasedEvaluationReportGenerator {
    async generate(input) {
        const report = ruleBasedEvaluate({
            transcript: input.transcript,
            customerMood: input.customerMood,
            personaConfig: input.personaConfig,
            scoringRules: input.scoringRules,
        });
        // Widen the concrete report via a typed shallow-copy helper (no double assertion).
        return toReportRecord(report);
    }
}
