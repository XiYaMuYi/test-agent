import test from 'node:test';
import assert from 'node:assert/strict';

import {
  TransactionalEvaluationProcessor,
  type EvaluationInput,
  type EvaluationReportGenerator,
} from '../src/jobs/evaluation.processor.js';
import type {
  EvaluationSqlExecutorPort,
  TransactionalEvaluationExecutorPort,
} from '@training/contracts';

/**
 * Minimal fake database that answers each query by matching on a keyword in the
 * SQL text. Good enough to exercise loadEvaluationInput without standing up a
 * real Postgres instance.
 */
class FakeDatabase implements TransactionalEvaluationExecutorPort {
  private readonly answers: Array<{ keyword: string; rows: readonly Record<string, unknown>[] }> = [];

  /** Captures the report JSON written to evaluation_report ($5), if any. */
  public persistedReport: Record<string, unknown> | null = null;

  public addAnswer(keyword: string, rows: readonly Record<string, unknown>[]): this {
    this.answers.push({ keyword, rows });
    return this;
  }

  public async query<Row extends Record<string, unknown> = Record<string, unknown>>(
    statement: string,
    params?: readonly unknown[],
  ): Promise<{ readonly rows: readonly Row[] }> {
    if (statement.includes('INSERT INTO evaluation_report') && Array.isArray(params)) {
      try {
        this.persistedReport = JSON.parse(String(params[4])) as Record<string, unknown>;
      } catch {
        // Leave persistedReport null when the payload is not JSON.
      }
    }
    for (const answer of this.answers) {
      if (statement.includes(answer.keyword)) {
        return { rows: answer.rows as readonly Row[] };
      }
    }
    // Default: empty result (safe no-op for write queries we don't care about).
    return { rows: [] as readonly Row[] };
  }

  public async transaction<T>(work: (executor: EvaluationSqlExecutorPort) => Promise<T>): Promise<T> {
    return work(this);
  }
}

const ORG_ID = '00000000-0000-0000-0000-000000000001';
const CONVERSATION_ID = '00000000-0000-0000-0000-000000000010';
const JOB_ID = '00000000-0000-0000-0000-000000000099';

function buildFakeDatabase(): FakeDatabase {
  const responseHash = (payload: Record<string, unknown>): string => JSON.stringify(payload);

  return new FakeDatabase()
    // claimNext: FOR UPDATE SKIP LOCKED on outbox_event
    .addAnswer('FOR UPDATE SKIP LOCKED', [
      {
        id: 'e0000000-0000-0000-0000-000000000001',
        organizationId: ORG_ID,
        payload: { conversationId: CONVERSATION_ID, jobId: JOB_ID },
        claimedAt: new Date('2026-01-01T00:00:00Z'),
        leaseExpiresAt: new Date('2026-01-01T00:01:00Z'),
      },
    ])
    // startJob: UPDATE evaluation_job ... RETURNING status — first call succeeds → 'running'
    .addAnswer('RETURNING status', [{ status: 'running' }])
    // loadEvaluationInput meta: GROUP BY ts.persona_snapshot, snapshot.snapshot
    .addAnswer('GROUP BY ts.persona_snapshot', [
      {
        messageCount: '3',
        personaSnapshot: {
          name: '小张',
          basedOnCard: 'card-1',
          conversation: { productScenario: '护肤品推荐' },
        },
        releaseSnapshot: {
          scoringRules: [{ dimension: 'needs_discovery', weight: 1 }],
        },
      },
    ])
    // loadEvaluationInput messages: ORDER BY sequence ASC
    .addAnswer('ORDER BY sequence ASC', [
      {
        sequence: 1,
        content: '你好，我想看看护肤品',
        responseHash: responseHash({
          suggestion: { replyText: '好的，请问您有什么肤质需求？' },
          customerMood: 'neutral',
        }),
      },
      {
        sequence: 2,
        content: '我是干性皮肤，想要保湿的',
        responseHash: responseHash({
          suggestion: { replyText: '推荐这款保湿霜' },
          customerMood: 'neutral',
        }),
      },
      {
        sequence: 3,
        content: '好的，听起来不错',
        responseHash: responseHash({
          suggestion: { replyText: '谢谢您的认可' },
          customerMood: 'positive',
        }),
      },
    ])
    // ownsEvent: FOR UPDATE on outbox_event (non-FOR UPDATE SKIP LOCKED)
    .addAnswer('FOR UPDATE', [{ id: 'e0000000-0000-0000-0000-000000000001' }])
    // Complete job UPDATE evaluation_job SET status = 'succeeded' ... RETURNING id
    .addAnswer("status = 'succeeded'", [{ id: JOB_ID }])
    // INSERT evaluation_report ... RETURNING id
    .addAnswer('evaluation_report', [{ id: 'r0000000-0000-0000-0000-000000000001' }]);
}

test('loadEvaluationInput populates transcript, personaConfig and customerMood on EvaluationInput', async () => {
  const captured: { input?: EvaluationInput } = {};
  const capturingGenerator: EvaluationReportGenerator = {
    async generate(input) {
      captured.input = input;
      return {
        schemaVersion: 'evaluation-report/v1',
        messageCount: input.messageCount,
        scoringRules: input.scoringRules,
        score: 50,
        generatedBy: 'test',
      };
    },
  };

  const processor = new TransactionalEvaluationProcessor(
    buildFakeDatabase(),
    capturingGenerator,
    { leaseDurationMs: 60_000 },
  );

  const result = await processor.pollOnce();

  assert.equal(result.scanned, 1);
  assert.equal(result.succeeded, 1);
  assert.equal(result.failed, 0);

  const input = captured.input;
  assert.ok(input !== undefined, 'generator should have been invoked with an EvaluationInput');

  // messageCount and scoringRules preserved
  assert.equal(input.messageCount, 3);
  assert.deepEqual(input.scoringRules, [{ dimension: 'needs_discovery', weight: 1 }]);

  // transcript: 3 learner + 3 assistant interleaved
  assert.equal(input.transcript.length, 6, 'transcript should interleave learner and assistant');
  assert.deepEqual(input.transcript[0], { role: 'learner', content: '你好，我想看看护肤品' });
  assert.deepEqual(input.transcript[1], { role: 'assistant', content: '好的，请问您有什么肤质需求？' });
  assert.deepEqual(input.transcript[4], { role: 'learner', content: '好的，听起来不错' });
  assert.deepEqual(input.transcript[5], { role: 'assistant', content: '谢谢您的认可' });

  // personaConfig from training_session.persona_snapshot
  assert.ok(input.personaConfig !== null, 'personaConfig should come from training_session');
  assert.equal(input.personaConfig?.name, '小张');
  assert.equal((input.personaConfig as { conversation?: { productScenario?: string } } | null)?.conversation?.productScenario, '护肤品推荐');

  // customerMood: last learner row's response_hash.customerMood
  assert.equal(input.customerMood, 'positive');
});

test('loadEvaluationInput returns empty transcript and neutral mood when conversation has no messages', async () => {
  const captured: { input?: EvaluationInput } = {};
  const capturingGenerator: EvaluationReportGenerator = {
    async generate(input) {
      captured.input = input;
      return { score: 0 };
    },
  };

  const db = new FakeDatabase()
    .addAnswer('FOR UPDATE SKIP LOCKED', [
      {
        id: 'e0000000-0000-0000-0000-000000000002',
        organizationId: ORG_ID,
        payload: { conversationId: CONVERSATION_ID, jobId: JOB_ID },
        claimedAt: new Date('2026-01-01T00:00:00Z'),
        leaseExpiresAt: new Date('2026-01-01T00:01:00Z'),
      },
    ])
    .addAnswer('RETURNING status', [{ status: 'running' }])
    .addAnswer('GROUP BY ts.persona_snapshot', [
      {
        messageCount: '0',
        personaSnapshot: null,
        releaseSnapshot: null,
      },
    ])
    .addAnswer('ORDER BY sequence ASC', [])
    .addAnswer('FOR UPDATE', [{ id: 'e0000000-0000-0000-0000-000000000002' }])
    .addAnswer("status = 'succeeded'", [{ id: JOB_ID }])
    .addAnswer('evaluation_report', [{ id: 'r0000000-0000-0000-0000-000000000002' }]);

  const processor = new TransactionalEvaluationProcessor(db, capturingGenerator);
  await processor.pollOnce();

  const input = captured.input;
  assert.ok(input !== undefined);
  assert.equal(input.messageCount, 0);
  assert.deepEqual(input.transcript, []);
  assert.equal(input.personaConfig, null);
  assert.equal(input.customerMood, 'neutral');
  assert.deepEqual(input.scoringRules, []);
});

// 安全默认：漏传 generator 时也必须走"规则五维评分"，而不是 Fake 的恒 100、无维度。
// 评分系统绝不能因为装配遗漏而静默给出满分。
test('default generator (no argument) produces a rule-based five-dimension report, not a constant-100 fake', async () => {
  const db = buildFakeDatabase();
  // Intentionally omit the generator argument: exercise the safe default.
  const processor = new TransactionalEvaluationProcessor(db);

  await processor.pollOnce();

  const report = db.persistedReport;
  assert.ok(report !== null, 'a report must have been persisted');
  assert.equal(report.generatedBy, 'rule-evaluation/v1', 'default generator must be the rule evaluator');
  const dimensions = report.dimensionScores as Record<string, number> | undefined;
  assert.ok(dimensions !== undefined, 'rule report must carry dimensionScores');
  for (const dim of [
    'needs_discovery',
    'product_presentation',
    'objection_handling',
    'emotion_management',
    'closing_ability',
  ]) {
    assert.equal(typeof dimensions[dim], 'number', `${dim} must be numeric`);
  }
  assert.equal(typeof report.score, 'number');
});
