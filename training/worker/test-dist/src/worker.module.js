import { OutboxConsumer } from './jobs/outbox.consumer.js';
import { EvaluationConsumer } from './jobs/evaluation.consumer.js';
import { RuleBasedEvaluationReportGenerator } from './jobs/rule-evaluation-generator.js';
import { LlmBasedEvaluationReportGenerator } from './jobs/llm-evaluation-generator.js';
import { CompositeEvaluationGenerator } from './jobs/composite-evaluation-generator.js';
import { HttpModelAdapter, defaultHttpFetch } from '@training/contracts';
import { createPostgresEvaluationExecutor } from './database/postgres-evaluation-executor.js';
import { readModelConfig } from './config.js';
const emptyOutboxPoller = {
    async pollPending() {
        return [];
    },
};
/**
 * Composition root for the worker.  The default implementation intentionally
 * has no database side effect: B-06 supplies the persisted outbox adapter.
 */
export function createWorkerModule(options = emptyOutboxPoller) {
    if ('evaluationExecutor' in options) {
        const evaluationConsumer = new EvaluationConsumer(options.evaluationExecutor, options.evaluationGenerator, {
            ...(options.evaluationLeaseDurationMs === undefined
                ? {}
                : { leaseDurationMs: options.evaluationLeaseDurationMs }),
            ...(options.now === undefined ? {} : { now: options.now }),
        });
        return {
            async pollOnce() {
                const result = await evaluationConsumer.pollOnce();
                return { scanned: result.scanned, dispatched: result.succeeded + result.failed, succeeded: result.succeeded, failed: result.failed };
            },
        };
    }
    const outboxConsumer = new OutboxConsumer(options);
    return {
        pollOnce: () => outboxConsumer.pollOnce(),
    };
}
/** Runtime composition root: a configured worker always has a real evaluation consumer. */
export function createRuntimeWorkerModule(connectionString) {
    const database = createPostgresEvaluationExecutor(connectionString);
    // Read model configuration from environment
    const modelConfig = readModelConfig();
    let generator;
    if (modelConfig.provider === 'http') {
        // Use composite generator with LLM + rule fallback
        const modelAdapter = new HttpModelAdapter(defaultHttpFetch, {
            baseUrl: modelConfig.baseUrl,
            apiKey: modelConfig.apiKey,
            model: modelConfig.modelName,
            timeoutMs: modelConfig.timeoutMs,
        });
        const llmGenerator = new LlmBasedEvaluationReportGenerator(modelAdapter);
        const ruleGenerator = new RuleBasedEvaluationReportGenerator();
        generator = new CompositeEvaluationGenerator(llmGenerator, ruleGenerator);
    }
    else {
        // Use rule-based generator only (fake or no model provider)
        generator = new RuleBasedEvaluationReportGenerator();
    }
    const worker = createWorkerModule({ evaluationExecutor: database, evaluationGenerator: generator });
    return { ...worker, close: () => database.close() };
}
