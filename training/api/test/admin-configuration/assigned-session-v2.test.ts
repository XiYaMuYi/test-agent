import assert from 'node:assert/strict';
import test from 'node:test';
import { HttpStatus } from '@nestjs/common';
import type { Pool, PoolClient, QueryResultRow } from 'pg';

import { AssignmentProblem, EligibilityService } from '../../src/assignments/eligibility.service.js';
import { PersonaService } from '../../src/persona/persona.service.js';
import { SessionService } from '../../src/sessions/session.service.js';
import type { TemplateService } from '../../src/templates/template.service.js';

// =============================================================================
// spec §8.1 assigned session：v2 严格校验 / v1 兼容回退
// =============================================================================

const personas = new PersonaService();
const eligibility = new EligibilityService();

const PRINCIPAL = {
  principalId: 'admin-1',
  organizationId: 'org-1',
  roles: ['admin' as const],
  status: 'active' as const,
};

/** 可编程的假 Pool：按查询顺序返回注册的响应。 */
function fakePool(responders: Array<(statement: string, values?: readonly unknown[]) => { rows: unknown[] }>): Pool {
  let index = 0;
  const client = {
    query: async (statement: string, values?: readonly unknown[]) => {
      const responder = responders[index];
      index += 1;
      if (responder === undefined) {
        throw new Error(`Unexpected query #${index - 1}: ${statement.slice(0, 120)}`);
      }
      return responder(statement, values);
    },
    release: () => {},
  };
  return {
    connect: async () => client,
    query: async () => {
      throw new Error('unexpected pool-level query');
    },
    end: async () => {},
  } as unknown as Pool;
}

const EMPTY_TEMPLATES = {} as TemplateService;

function sessionServiceWith(database: Pool): SessionService {
  return new SessionService(database, personas, eligibility, EMPTY_TEMPLATES);
}

function ok(rows: unknown[]): { rows: unknown[] } {
  return { rows };
}

test('v2 snapshot with valid personaConfig starts and freezes it (no fallback)', async () => {
  const persona = personas.buildPersonaConfig({ ageCardId: 'light-mature', difficulty: 2, productScenarioId: 'whitening' });
  const snapshot = {
    schemaVersion: 'release-snapshot/v2',
    releaseSnapshotId: 'snap-1',
    scenarioDraftId: 'draft-1',
    compiledAt: '2026-09-15T00:00:00.000Z',
    compiledBy: 'admin',
    title: 'v2 场景',
    personaConfig: persona,
    personaSource: { kind: 'inline' },
    knowledgeVersions: ['k1@v1'],
    scoringRules: ['s1'],
    agentConfig: { schemaVersion: 'agent-config/v1', historyMessageLimit: 20, responseLength: 'normal', knowledgeStrictness: 'balanced', conversationPace: 'normal', closingTendency: 'neutral' },
    learnerOverridePolicy: { mode: 'all', visible: true, recommended: false },
  };
  const database = fakePool([
    () => ok([]), // BEGIN
    () => ok([{ organization_id: 'org-1', release_snapshot_id: 'snap-1', status: 'active', starts_at: new Date(0), ends_at: new Date(2100, 0, 1), max_attempts: 3 }]),
    () => ok([{ id: 'la-1', state: 'available', total_attempts: 0, active_attempt_id: null }]),
    () => ok([]), // idempotent replay check
    () => ok([]), // assertNoInFlightSession
    () => ok([]), // upsertLearnerProfile
    () => ok([{ snapshot }]),
    () => ok([]), // insert training_attempt
    () => ok([]), // insert training_session
    () => ok([]), // insert conversation
    () => ok([]), // update learner_assignment
    () => ok([]), // COMMIT
  ]);
  const service = sessionServiceWith(database);
  const result = await service.startAssignedSession(PRINCIPAL, 'assign-1', 'idem-1');
  assert.equal(result.attemptId.length > 0, true);
});

test('v2 snapshot without valid personaConfig refuses to start (RELEASE_SNAPSHOT_INVALID)', async () => {
  const snapshot = {
    schemaVersion: 'release-snapshot/v2',
    releaseSnapshotId: 'snap-bad',
    scenarioDraftId: 'draft-1',
    compiledAt: '2026-09-15T00:00:00.000Z',
    compiledBy: 'admin',
    title: '坏的 v2',
    personaConfig: {},
    personaSource: { kind: 'inline' },
    knowledgeVersions: ['k1@v1'],
    scoringRules: ['s1'],
    agentConfig: { schemaVersion: 'agent-config/v1', historyMessageLimit: 20, responseLength: 'normal', knowledgeStrictness: 'balanced', conversationPace: 'normal', closingTendency: 'neutral' },
    learnerOverridePolicy: { mode: 'all', visible: true, recommended: false },
  };
  const database = fakePool([
    () => ok([]), // BEGIN
    () => ok([{ organization_id: 'org-1', release_snapshot_id: 'snap-bad', status: 'active', starts_at: new Date(0), ends_at: new Date(2100, 0, 1), max_attempts: 3 }]),
    () => ok([{ id: 'la-1', state: 'available', total_attempts: 0, active_attempt_id: null }]),
    () => ok([]), // idempotent replay check
    () => ok([]), // assertNoInFlightSession
    () => ok([]), // upsertLearnerProfile
    () => ok([{ snapshot }]), // resolveTaskPersona throws here
    () => ok([]), // ROLLBACK
  ]);
  const service = sessionServiceWith(database);
  await assert.rejects(
    () => service.startAssignedSession(PRINCIPAL, 'assign-1', 'idem-2'),
    (error: unknown) => {
      assert.ok(error instanceof AssignmentProblem, 'expected AssignmentProblem');
      const body = (error as AssignmentProblem).getResponse() as { code: string };
      assert.equal(body.code, 'RELEASE_SNAPSHOT_INVALID');
      return true;
    },
  );
});

test('v1 snapshot without personaConfig falls back to default and records legacyFallbackReason', async () => {
  const snapshot = {
    schemaVersion: 'release-snapshot/v1',
    releaseSnapshotId: 'snap-legacy',
    scenarioDraftId: 'draft-1',
    compiledAt: '2026-09-15T00:00:00.000Z',
    title: 'v1 场景',
    knowledgeVersions: ['k1@v1'],
    scoringRules: ['s1'],
    agentConfig: {},
  };
  let insertedSession: { persona: unknown; fallback: unknown } | null = null;
  const database = fakePool([
    () => ok([]), // BEGIN
    () => ok([{ organization_id: 'org-1', release_snapshot_id: 'snap-legacy', status: 'active', starts_at: new Date(0), ends_at: new Date(2100, 0, 1), max_attempts: 3 }]),
    () => ok([{ id: 'la-1', state: 'available', total_attempts: 0, active_attempt_id: null }]),
    () => ok([]), // idempotent replay check
    () => ok([]), // assertNoInFlightSession
    () => ok([]), // upsertLearnerProfile
    () => ok([{ snapshot }]),
    () => ok([]), // insert training_attempt
    (statement, values) => {
      insertedSession = {
        persona: typeof values?.[7] === 'string' ? JSON.parse(values[7] as string) : values?.[7],
        fallback: values?.[9],
      };
      return ok([]);
    }, // insert training_session
    () => ok([]), // insert conversation
    () => ok([]), // update learner_assignment
    () => ok([]), // COMMIT
  ]);
  const service = sessionServiceWith(database);
  await service.startAssignedSession(PRINCIPAL, 'assign-1', 'idem-3');
  assert.notEqual(insertedSession, null, 'training_session insert must have happened');
  const captured = insertedSession as unknown as { persona: { name: string }; fallback: unknown };
  assert.equal(captured.persona.name, '默认客户');
  assert.equal(captured.fallback, 'v1 snapshot has no personaConfig');
});

test('task-level override merges into the frozen session persona and agentConfig', async () => {
  const persona = personas.buildPersonaConfig({ ageCardId: 'light-mature', difficulty: 2, productScenarioId: 'whitening' });
  const snapshot = {
    schemaVersion: 'release-snapshot/v2',
    releaseSnapshotId: 'snap-1',
    scenarioDraftId: 'draft-1',
    compiledAt: '2026-09-15T00:00:00.000Z',
    compiledBy: 'admin',
    title: 'v2 场景',
    personaConfig: persona,
    personaSource: { kind: 'inline' },
    knowledgeVersions: ['k1@v1'],
    scoringRules: ['s1'],
    agentConfig: { schemaVersion: 'agent-config/v1', historyMessageLimit: 20, responseLength: 'normal', knowledgeStrictness: 'balanced', conversationPace: 'normal', closingTendency: 'neutral' },
    learnerOverridePolicy: { mode: 'all', visible: true, recommended: false },
  };
  const overridePatch = {
    agentConfig: { historyMessageLimit: 5, closingTendency: 'resistant' },
    conversation: { maxTurns: 8, openingMode: 'wait_learner', background: '35岁敏感肌宝妈，预算500元内' },
  };
  let insertedSession: { persona: unknown; agentConfig: unknown } | null = null;
  const database = fakePool([
    () => ok([]), // BEGIN
    () => ok([{ organization_id: 'org-1', release_snapshot_id: 'snap-1', status: 'active', starts_at: new Date(0), ends_at: new Date(2100, 0, 1), max_attempts: 3, override_patch: overridePatch }]),
    () => ok([{ id: 'la-1', state: 'available', total_attempts: 0, active_attempt_id: null }]),
    () => ok([]), // idempotent replay check
    () => ok([]), // assertNoInFlightSession
    () => ok([]), // upsertLearnerProfile
    () => ok([{ snapshot }]),
    () => ok([]), // insert training_attempt
    (statement, values) => {
      insertedSession = {
        persona: typeof values?.[7] === 'string' ? JSON.parse(values[7] as string) : values?.[7],
        agentConfig: typeof values?.[8] === 'string' ? JSON.parse(values[8] as string) : values?.[8],
      };
      return ok([]);
    }, // insert training_session
    () => ok([]), // insert conversation
    () => ok([]), // update learner_assignment
    () => ok([]), // COMMIT
  ]);
  const service = sessionServiceWith(database);
  await service.startAssignedSession(PRINCIPAL, 'assign-1', 'idem-4');
  assert.notEqual(insertedSession, null, 'training_session insert must have happened');
  const captured = insertedSession as unknown as {
    persona: { conversation: { maxTurns: number; openingMode: string; background: string }; name: string };
    agentConfig: { historyMessageLimit: number; closingTendency: string; responseLength: string };
  };
  // conversation 覆盖三字段生效，未覆盖字段保留快照原值
  assert.equal(captured.persona.conversation.maxTurns, 8);
  assert.equal(captured.persona.conversation.openingMode, 'wait_learner');
  assert.equal(captured.persona.conversation.background, '35岁敏感肌宝妈，预算500元内');
  assert.equal(captured.persona.name, persona.name);
  // agentConfig 合并：覆盖字段生效，未覆盖字段保留快照值
  assert.equal(captured.agentConfig.historyMessageLimit, 5);
  assert.equal(captured.agentConfig.closingTendency, 'resistant');
  assert.equal(captured.agentConfig.responseLength, 'normal');
});
