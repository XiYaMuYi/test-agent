import { ruleBasedEvaluate } from '@training/contracts';
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
    model;
    constructor(model) {
        this.model = model;
        void this.model;
    }
    async evaluate(conversationId, messages, personaConfig) {
        void personaConfig;
        const transcript = messages
            .filter((message) => message.role === 'learner' || message.role === 'assistant')
            .map((message) => ({ role: message.role, content: message.content }));
        // The API path does not persist per-turn customer mood the way the worker
        // does (the worker reads it from the response_hash of each assistant turn).
        // Default to 'neutral' so the emotion_management dimension is evaluated
        // conservatively rather than optimistically.
        const customerMood = 'neutral';
        const report = ruleBasedEvaluate({
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
function buildSummary(report) {
    const parts = [];
    if (report.highlights.length > 0) {
        parts.push(`亮点：${report.highlights.join('、')}`);
    }
    if (report.improvements.length > 0) {
        parts.push(`改进：${report.improvements.join('、')}`);
    }
    return parts.join('；') || `总分 ${report.score}`;
}
