import assert from 'node:assert/strict';
import test from 'node:test';

import { AgentOrchestrator, OrchestratorError } from '../../src/ai/agent-orchestrator.js';
import { FakeKnowledgeAdapter, type FakeKnowledgeRecord } from '../../src/adapters/fake-knowledge.adapter.js';
import { createInitialCustomerState, ModelProviderError, type AgentRequest, type AgentResponse, type ModelProviderPort } from '@training/contracts';
import type { RestrictedContext } from '../../src/ai/restricted-context.js';

const ORGANIZATION_A = '11111111-1111-1111-1111-111111111111';
const ORGANIZATION_B = '22222222-2222-2222-2222-222222222222';

class CountingModel implements ModelProviderPort {
  public calls = 0;

  async generate(_request: AgentRequest) {
    this.calls += 1;
    return {
      content: JSON.stringify({
        schemaVersion: 'agent-output/v1',
        replyText: 'ok',
        suggestedAction: 'ask_follow_up',
        knowledgeReferences: [],
        confidence: 1,
      }),
      modelVersion: 'counting-model/v1',
    };
  }
}

test('knowledge belonging to another organization is rejected before the model is called', async () => {
  const knowledge = new FakeKnowledgeAdapter([{
    id: 'knowledge-welcome',
    version: 'v1',
    organizationId: ORGANIZATION_A,
    status: 'approved',
    content: 'org-a only',
  } as unknown as FakeKnowledgeRecord]);
  const model = new CountingModel();
  const orchestrator = new AgentOrchestrator(knowledge, model);

  await assert.rejects(
    () => orchestrator.buildAndValidateContext(
      {
        id: 'conversation-1',
        organizationId: ORGANIZATION_B,
        status: 'active',
        version: 2,
        lastSequence: 1,
        trainingAttemptId: 'attempt-1',
        releaseSnapshotId: 'snapshot-1',
        trainingSessionId: 'session-1',
        sourceType: 'assigned',
        personaSnapshot: null,
        initialCustomerState: null,
        currentCustomerState: null,
        endReason: null,
      },
      {
        releaseSnapshotId: 'snapshot-1',
        knowledgeVersions: ['knowledge-welcome@v1'],
        agentConfig: {},
      },
      [],
    ),
    (error: unknown) => error instanceof OrchestratorError && error.code === 'KNOWLEDGE_NOT_AVAILABLE',
  );
  assert.equal(model.calls, 0);
});

class ThrowingModel implements ModelProviderPort {
  public constructor(private readonly error: Error) {}
  async generate(_request: AgentRequest): Promise<AgentResponse> {
    throw this.error;
  }
}

function minimalContext(): RestrictedContext {
  return {
    organizationId: ORGANIZATION_A,
    conversationId: 'conversation-1',
    conversationVersion: 1,
    conversationStatus: 'active',
    lastSequence: 0,
    releaseSnapshotId: null,
    knowledgeVersions: [],
    agentConfig: {},
    approvedKnowledge: [],
    recentMessages: [],
    canAdvance: true,
    personaSnapshot: null,
    currentCustomerState: null,
  };
}

test('orchestrator preserves a valid customer state transition returned by Python', async () => {
  const state = createInitialCustomerState(null);
  const model: ModelProviderPort = {
    async generate() {
      return {
        content: JSON.stringify({
          schemaVersion: 'agent-output/v1', replyText: '我愿意继续了解。',
          suggestedAction: 'ask_follow_up', knowledgeReferences: [], confidence: 0.8,
          stateTransition: {
            schemaVersion: 'customer-state-transition/v1', before: state,
            after: { ...state, trust: state.trust + 5 }, changes: { trust: 5 },
            knowledgeAssessment: {}, capabilityEvidence: [],
            terminal: { shouldEnd: false, reason: null, confidence: 0.9 },
          },
        }),
        modelVersion: 'stateful/v1',
      };
    },
  };
  const result = await new AgentOrchestrator(new FakeKnowledgeAdapter(), model).generateDecision(minimalContext());
  assert.equal(result.decision.stateTransition?.after.trust, state.trust + 5);
});

test('orchestrator rejects stale states, forged deltas and evidence references', () => {
  const state = createInitialCustomerState(null);
  const orchestrator = new AgentOrchestrator(new FakeKnowledgeAdapter(), new CountingModel());
  const transition = {
    schemaVersion: 'customer-state-transition/v1', before: state, after: state, changes: {},
    knowledgeAssessment: {}, capabilityEvidence: [],
    terminal: { shouldEnd: false, reason: null, confidence: 0.9 },
  };
  const decision = { schemaVersion: 'agent-output/v1', replyText: '好的', suggestedAction: 'ask_follow_up', knowledgeReferences: [], confidence: .8 };
  for (const corrupt of [
    { before: { ...state, trust: state.trust - 1 } },
    { after: { ...state, trust: 99 } },
    { changes: { trust: 30 }, after: { ...state, trust: state.trust + 30 } },
    { terminal: { shouldEnd: true, reason: 'invented', confidence: 1 } },
    { knowledgeAssessment: { referencesUsed: ['unknown@v1'] } },
    { capabilityEvidence: [{ dimension: 'answerAccuracy', impact: 2, reason: '依据', confidence: 1, knowledgeReferences: ['unknown@v1'] }] },
  ]) {
    assert.throws(() => orchestrator.validateAgentDecision({ ...decision, stateTransition: { ...transition, ...corrupt } }, minimalContext()), /state transition/i);
  }
});

test('legacy model output receives a state fallback and an absolute turn number', async () => {
  const model = new CapturingModel();
  const result = await new AgentOrchestrator(new FakeKnowledgeAdapter(), model).generateDecision({ ...minimalContext(), lastSequence: 25 });
  assert.ok(result.decision.stateTransition, 'legacy responses must not break state history');
  assert.equal((model.lastRequest?.simulation as unknown as { turnNumber: number }).turnNumber, 25);
});

test('orchestrator maps a real provider timeout onto MODEL_TIMEOUT', async () => {
  const orchestrator = new AgentOrchestrator(
    new FakeKnowledgeAdapter(),
    new ThrowingModel(new ModelProviderError('MODEL_TIMEOUT', 'timed out')),
  );
  await assert.rejects(
    () => orchestrator.generateDecision(minimalContext()),
    (error: unknown) => error instanceof OrchestratorError && error.code === 'MODEL_TIMEOUT',
  );
});

test('orchestrator maps an upstream outage onto MODEL_UPSTREAM_UNAVAILABLE', async () => {
  const orchestrator = new AgentOrchestrator(
    new FakeKnowledgeAdapter(),
    new ThrowingModel(new ModelProviderError('MODEL_UPSTREAM_UNAVAILABLE', 'gateway 502')),
  );
  await assert.rejects(
    () => orchestrator.generateDecision(minimalContext()),
    (error: unknown) => error instanceof OrchestratorError && error.code === 'MODEL_UPSTREAM_UNAVAILABLE',
  );
});

test('orchestrator maps a malformed provider response onto MODEL_SCHEMA_INVALID', async () => {
  const orchestrator = new AgentOrchestrator(
    new FakeKnowledgeAdapter(),
    new ThrowingModel(new ModelProviderError('MODEL_RESPONSE_INVALID', 'bad shape')),
  );
  await assert.rejects(
    () => orchestrator.generateDecision(minimalContext()),
    (error: unknown) => error instanceof OrchestratorError && error.code === 'MODEL_SCHEMA_INVALID',
  );
});

class CapturingModel implements ModelProviderPort {
  public lastRequest: AgentRequest | undefined;
  async generate(request: AgentRequest): Promise<AgentResponse> {
    this.lastRequest = request;
    return {
      content: JSON.stringify({
        schemaVersion: 'agent-output/v1',
        replyText: '好的',
        suggestedAction: 'ask_follow_up',
        knowledgeReferences: [],
        confidence: 0.8,
      }),
      modelVersion: 'capture/v1',
    };
  }
}

test('prompt teaches a real LLM the full agent-output/v1 JSON contract', async () => {
  const model = new CapturingModel();
  const orchestrator = new AgentOrchestrator(new FakeKnowledgeAdapter(), model);
  await orchestrator.generateDecision(minimalContext());
  const prompt = model.lastRequest?.prompt ?? '';
  for (const token of [
    'agent-output/v1',
    'replyText',
    'suggestedAction',
    'ask_follow_up',
    'advance',
    'end',
    'knowledgeReferences',
    'confidence',
  ]) {
    assert.ok(prompt.includes(token), `real-model prompt must describe the "${token}" contract field`);
  }
  assert.ok(/json/i.test(prompt), 'prompt must require a JSON response');
});

class FencedJsonModel implements ModelProviderPort {
  async generate(_request: AgentRequest): Promise<AgentResponse> {
    // Reasoning models often wrap the JSON in a code fence with surrounding prose.
    return {
      content: '好的，下面是我的判断：\n```json\n{"schemaVersion":"agent-output/v1","replyText":"亲，这款很适合你哦","suggestedAction":"ask_follow_up","knowledgeReferences":[],"confidence":0.72}\n```\n以上。',
      modelVersion: 'fenced/v1',
    };
  }
}

test('extracts a valid decision from JSON wrapped in markdown fences or prose', async () => {
  const orchestrator = new AgentOrchestrator(new FakeKnowledgeAdapter(), new FencedJsonModel());
  const result = await orchestrator.generateDecision(minimalContext());
  assert.equal(result.kind, 'accepted');
  assert.equal(result.decision.replyText, '亲，这款很适合你哦');
  assert.equal(result.decision.suggestedAction, 'ask_follow_up');
});

// =============================================================================
// spec §8.2：AgentConfigV1 行为注入 prompt
// =============================================================================

test('AgentConfigV1 behavior block is injected into the prompt (enums → controlled lines)', async () => {
  const model = new CapturingModel();
  const orchestrator = new AgentOrchestrator(new FakeKnowledgeAdapter(), model);
  await orchestrator.generateDecision({
    ...minimalContext(),
    agentConfig: {
      schemaVersion: 'agent-config/v1',
      historyMessageLimit: 8,
      responseLength: 'short',
      knowledgeStrictness: 'strict',
      conversationPace: 'slow',
      closingTendency: 'resistant',
    },
  });
  const prompt = model.lastRequest?.prompt ?? '';
  assert.ok(prompt.includes('【AI 行为配置】'), 'prompt must carry the behavior block header');
  assert.ok(prompt.includes('一句话以内'), 'responseLength=short must map to the short-reply line');
  assert.ok(prompt.includes('绝不编造知识'), 'knowledgeStrictness=strict must map to the strict line');
  assert.ok(prompt.includes('推进缓慢'), 'conversationPace=slow must map to the slow line');
  assert.ok(prompt.includes('强力说服'), 'closingTendency=resistant must map to the resistant line');
});

test('additionalInstructions appear only inside the role-behavior section, never as system commands', async () => {
  const model = new CapturingModel();
  const orchestrator = new AgentOrchestrator(new FakeKnowledgeAdapter(), model);
  await orchestrator.generateDecision({
    ...minimalContext(),
    agentConfig: {
      schemaVersion: 'agent-config/v1',
      historyMessageLimit: 20,
      responseLength: 'normal',
      knowledgeStrictness: 'balanced',
      conversationPace: 'normal',
      closingTendency: 'neutral',
      additionalInstructions: '对价格特别敏感，会反复比价',
    },
  });
  const prompt = model.lastRequest?.prompt ?? '';
  assert.ok(prompt.includes('【额外行为指令】'), 'additionalInstructions must have its own section');
  assert.ok(prompt.includes('对价格特别敏感，会反复比价'), 'additionalInstructions text must be present');
  // 该指令只约束角色行为，不得改变 JSON 输出契约
  assert.ok(prompt.includes('只输出一个 JSON 对象'), 'JSON contract must remain authoritative');
});

test('empty or missing agentConfig produces no behavior block', async () => {
  const model = new CapturingModel();
  const orchestrator = new AgentOrchestrator(new FakeKnowledgeAdapter(), model);
  await orchestrator.generateDecision(minimalContext());
  const prompt = model.lastRequest?.prompt ?? '';
  assert.ok(!prompt.includes('【AI 行为配置】'), 'no behavior block when agentConfig is empty');
});
