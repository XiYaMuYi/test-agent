import { TransactionalEvaluationProcessor, } from './evaluation.processor.js';
import { RuleBasedEvaluationReportGenerator } from './rule-evaluation-generator.js';
/** Worker entry point. Scheduling remains outside this domain consumer. */
export class EvaluationConsumer {
    processor;
    constructor(database, 
    // Safe default consistent with TransactionalEvaluationProcessor: a missing
    // generator still runs the real rule-based scorer, never a constant-100 fake.
    generator = new RuleBasedEvaluationReportGenerator(), leaseOptions = {}) {
        this.processor = new TransactionalEvaluationProcessor(database, generator, leaseOptions);
    }
    pollOnce() {
        return this.processor.pollOnce();
    }
}
