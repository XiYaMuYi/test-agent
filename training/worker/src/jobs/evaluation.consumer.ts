import type { TransactionalEvaluationExecutorPort } from '@training/contracts';
import {
  TransactionalEvaluationProcessor,
  type EvaluationLeaseOptions,
  type EvaluationPollResult,
  type EvaluationReportGenerator,
} from './evaluation.processor.js';
import { RuleBasedEvaluationReportGenerator } from './rule-evaluation-generator.js';

/** Worker entry point. Scheduling remains outside this domain consumer. */
export class EvaluationConsumer {
  private readonly processor: TransactionalEvaluationProcessor;

  public constructor(
    database: TransactionalEvaluationExecutorPort,
    // Safe default consistent with TransactionalEvaluationProcessor: a missing
    // generator still runs the real rule-based scorer, never a constant-100 fake.
    generator: EvaluationReportGenerator = new RuleBasedEvaluationReportGenerator(),
    leaseOptions: EvaluationLeaseOptions = {},
  ) {
    this.processor = new TransactionalEvaluationProcessor(database, generator, leaseOptions);
  }

  pollOnce(): Promise<EvaluationPollResult> {
    return this.processor.pollOnce();
  }
}
