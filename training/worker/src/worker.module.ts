import { OutboxConsumer, type OutboxPoller } from './jobs/outbox.consumer.js';
import { EvaluationConsumer } from './jobs/evaluation.consumer.js';
import type { EvaluationReportGenerator } from './jobs/evaluation.processor.js';
import { RuleBasedEvaluationReportGenerator } from './jobs/rule-evaluation-generator.js';
import { ContextAwareEvaluationReportGenerator } from './jobs/context-aware-evaluation-generator.js';
import { CompositeEvaluationGenerator } from './jobs/composite-evaluation-generator.js';
import { PythonEvaluationReportGenerator } from './jobs/python-evaluation-generator.js';
import { HttpModelAdapter, defaultHttpFetch } from '@training/contracts';
import type { TransactionalEvaluationExecutorPort } from '@training/contracts';
import { createPostgresEvaluationExecutor } from './database/postgres-evaluation-executor.js';
import { readModelConfig } from './config.js';

export interface WorkerModule {
  pollOnce(): Promise<{ scanned: number; dispatched: number; succeeded?: number; failed?: number }>;
  close?(): Promise<void>;
}

export interface EvaluationWorkerOptions {
  readonly evaluationExecutor: TransactionalEvaluationExecutorPort;
  readonly evaluationGenerator?: EvaluationReportGenerator;
  readonly evaluationLeaseDurationMs?: number;
  readonly now?: () => Date;
}

const emptyOutboxPoller: OutboxPoller = {
  async pollPending() {
    return [];
  },
};

/**
 * Composition root for the worker.  The default implementation intentionally
 * has no database side effect: B-06 supplies the persisted outbox adapter.
 */
export function createWorkerModule(options: OutboxPoller | EvaluationWorkerOptions = emptyOutboxPoller): WorkerModule {
  if ('evaluationExecutor' in options) {
    const evaluationConsumer = new EvaluationConsumer(
      options.evaluationExecutor,
      options.evaluationGenerator,
      {
        ...(options.evaluationLeaseDurationMs === undefined
          ? {}
          : { leaseDurationMs: options.evaluationLeaseDurationMs }),
        ...(options.now === undefined ? {} : { now: options.now }),
      },
    );
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
export function createRuntimeWorkerModule(connectionString: string): WorkerModule {
  const database = createPostgresEvaluationExecutor(connectionString);

  // Read model configuration from environment
  const modelConfig = readModelConfig();
  let generator: EvaluationReportGenerator;

  if (modelConfig.provider === 'python') {
    const pythonBaseUrl = process.env.PYTHON_AI_BASE_URL;
    const pythonToken = process.env.PYTHON_AI_TOKEN;
    if (!pythonBaseUrl || !pythonToken) {
      throw new Error('PYTHON_AI_BASE_URL and PYTHON_AI_TOKEN are required when MODEL_PROVIDER=python');
    }
    generator = new CompositeEvaluationGenerator(
      new PythonEvaluationReportGenerator({
        baseUrl: pythonBaseUrl,
        token: pythonToken,
        timeoutMs: modelConfig.timeoutMs,
      }),
      new RuleBasedEvaluationReportGenerator(),
    );
  } else if (modelConfig.provider === 'http') {
    // Use composite generator with context-aware LLM (配置驱动 + 客户阶段自适应 + 知识事实红线) + rule fallback
    const modelAdapter = new HttpModelAdapter(defaultHttpFetch, {
      baseUrl: modelConfig.baseUrl,
      apiKey: modelConfig.apiKey,
      model: modelConfig.modelName,
      timeoutMs: modelConfig.timeoutMs,
      maxTokens: modelConfig.maxTokens,
      maxRetries: modelConfig.maxRetries,
    });
    const llmGenerator = new ContextAwareEvaluationReportGenerator(modelAdapter);
    const ruleGenerator = new RuleBasedEvaluationReportGenerator();
    generator = new CompositeEvaluationGenerator(llmGenerator, ruleGenerator);
  } else {
    // Use rule-based generator only (fake or no model provider)
    generator = new RuleBasedEvaluationReportGenerator();
  }

  const worker = createWorkerModule({ evaluationExecutor: database, evaluationGenerator: generator });
  return { ...worker, close: () => database.close() };
}
