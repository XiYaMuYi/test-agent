import test from 'node:test';
import assert from 'node:assert/strict';

import type { EvaluationInput, EvaluationReportGenerator } from '../src/jobs/evaluation.processor.js';
import { CompositeEvaluationGenerator } from '../src/jobs/composite-evaluation-generator.js';

function makeInput(): EvaluationInput {
  return {
    messageCount: 2,
    scoringRules: [],
    transcript: [
      { role: 'learner' as const, content: '您好' },
      { role: 'assistant' as const, content: '你好' },
    ],
    personaConfig: null,
    customerMood: 'neutral',
  };
}

const LLM_REPORT: Record<string, unknown> = {
  schemaVersion: 'evaluation-report/v1',
  generatedBy: 'llm-evaluation/v1',
  score: 85,
};

const RULE_REPORT: Record<string, unknown> = {
  schemaVersion: 'evaluation-report/v1',
  generatedBy: 'rule-evaluation/v1',
  score: 60,
};

function successGenerator(report: Record<string, unknown>): EvaluationReportGenerator {
  return {
    async generate(): Promise<Record<string, unknown>> {
      return report;
    },
  };
}

function throwingGenerator(error: Error = new Error('LLM_FAILED')): EvaluationReportGenerator {
  return {
    async generate(): Promise<Record<string, unknown>> {
      throw error;
    },
  };
}

function nullGenerator(): EvaluationReportGenerator {
  return {
    async generate(): Promise<Record<string, unknown>> {
      return null as unknown as Record<string, unknown>;
    },
  };
}

test('CompositeEvaluationGenerator: returns LLM result when LLM succeeds', async () => {
  const composite = new CompositeEvaluationGenerator(
    successGenerator(LLM_REPORT),
    successGenerator(RULE_REPORT),
  );

  const report = await composite.generate(makeInput());
  assert.equal(report.generatedBy, 'llm-evaluation/v1');
  assert.equal(report.score, 85);
});

test('CompositeEvaluationGenerator: falls back to rules when LLM throws', async () => {
  const composite = new CompositeEvaluationGenerator(
    throwingGenerator(),
    successGenerator(RULE_REPORT),
  );

  const report = await composite.generate(makeInput());
  assert.equal(report.generatedBy, 'rule-evaluation/v1');
  assert.equal(report.score, 60);
});

test('CompositeEvaluationGenerator: falls back to rules when LLM returns null', async () => {
  const composite = new CompositeEvaluationGenerator(
    nullGenerator(),
    successGenerator(RULE_REPORT),
  );

  const report = await composite.generate(makeInput());
  assert.equal(report.generatedBy, 'rule-evaluation/v1');
});

test('CompositeEvaluationGenerator: throws when both generators fail', async () => {
  const composite = new CompositeEvaluationGenerator(
    throwingGenerator(new Error('LLM_FAILED')),
    throwingGenerator(new Error('RULE_FAILED')),
  );

  await assert.rejects(
    () => composite.generate(makeInput()),
    { message: 'RULE_FAILED' },
  );
});

test('CompositeEvaluationGenerator: fallback emits one structured log event', async () => {
  const events: Array<Record<string, unknown>> = [];
  const composite = new CompositeEvaluationGenerator(
    throwingGenerator(),
    successGenerator(RULE_REPORT),
    (entry) => events.push(entry),
  );

  await composite.generate(makeInput());

  assert.equal(events.length, 1, 'exactly one fallback event must be emitted');
  assert.equal(events[0]!.event, 'llm_evaluation_fallback');
  assert.equal(events[0]!.level, 'warn');
  assert.equal(events[0]!.generator, 'CompositeEvaluationGenerator');
  assert.equal(typeof events[0]!.at, 'string');
});

test('CompositeEvaluationGenerator: no fallback log when LLM succeeds', async () => {
  const events: Array<Record<string, unknown>> = [];
  const composite = new CompositeEvaluationGenerator(
    successGenerator(LLM_REPORT),
    successGenerator(RULE_REPORT),
    (entry) => events.push(entry),
  );

  await composite.generate(makeInput());
  assert.equal(events.length, 0);
});
