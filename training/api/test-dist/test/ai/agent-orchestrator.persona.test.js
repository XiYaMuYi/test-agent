import assert from 'node:assert/strict';
import test from 'node:test';
import { AgentOrchestrator } from '../../src/ai/agent-orchestrator.js';
import { FakeKnowledgeAdapter } from '../../src/adapters/fake-knowledge.adapter.js';
class CapturingModel {
    lastRequest;
    async generate(request) {
        this.lastRequest = request;
        return {
            content: JSON.stringify({
                schemaVersion: 'agent-output/v1',
                replyText: '好的',
                suggestedAction: 'ask_follow_up',
                knowledgeReferences: [],
                confidence: 0.5,
            }),
            modelVersion: 'capture/v1',
        };
    }
}
function minimalPersona() {
    return {
        id: 'persona-1',
        name: '李阿姨',
        basedOnCard: 'card-1',
        age: 42,
        gender: 'female',
        occupation: '白领',
        basic: { maritalStatus: 'married', incomeLevel: 'medium' },
        personality: {
            friendliness: 80,
            patience: 50,
            priceSensitivity: 70,
            decisiveness: 50,
            skepticism: 50,
            socialActivity: 70,
            emotionalVolatility: 50,
        },
        communication: {
            style: 'gentle',
            verbosity: 'normal',
            emotionLevel: 'normal',
            catchphrase: '你说呢',
            dialect: 'northeast',
        },
        consumption: {
            budgetMin: 200,
            budgetMax: 500,
            decisionCycle: 'few_days',
            brandLoyalty: 'medium',
            purchaseChannel: 'wechat_private',
            ingredientFocus: 'normal',
            competitorComparison: 'occasionally',
        },
        conversation: {
            difficulty: 3,
            maxTurns: 20,
            background: '她最近经常加班，皮肤状态不太好。',
            productScenario: '护肤',
        },
    };
}
function minimalContext(persona) {
    return {
        organizationId: '11111111-1111-1111-1111-111111111111',
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
        personaSnapshot: persona,
    };
}
test('当 personaSnapshot 存在时，prompt 包含人设段', async () => {
    const model = new CapturingModel();
    const orchestrator = new AgentOrchestrator(new FakeKnowledgeAdapter(), model);
    await orchestrator.generateDecision(minimalContext(minimalPersona()));
    const prompt = model.lastRequest?.prompt ?? '';
    assert.match(prompt, /42岁/);
    assert.match(prompt, /白领上班族/);
    assert.match(prompt, /女性/);
    assert.match(prompt, /你的身份/);
    assert.match(prompt, /性格特征/);
    assert.match(prompt, /沟通风格/);
    assert.match(prompt, /消费习惯/);
    assert.match(prompt, /对话规则/);
    assert.match(prompt, /行为指引/);
});
test('当 personaSnapshot 为 null 时，prompt 不包含人设段', async () => {
    const model = new CapturingModel();
    const orchestrator = new AgentOrchestrator(new FakeKnowledgeAdapter(), model);
    await orchestrator.generateDecision(minimalContext(null));
    const prompt = model.lastRequest?.prompt ?? '';
    assert.doesNotMatch(prompt, /42岁/);
    assert.doesNotMatch(prompt, /白领上班族/);
    assert.doesNotMatch(prompt, /你的身份/);
});
test('注入人设后 agent-output/v1 JSON schema 约束仍在', async () => {
    const model = new CapturingModel();
    const orchestrator = new AgentOrchestrator(new FakeKnowledgeAdapter(), model);
    await orchestrator.generateDecision(minimalContext(minimalPersona()));
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
        assert.ok(prompt.includes(token), `prompt 必须包含 "${token}" 契约字段`);
    }
    assert.ok(/json/i.test(prompt), 'prompt 必须要求 JSON 响应');
});
test('buildAndValidateContext 将 personaSnapshot 透传到 RestrictedContext', async () => {
    const orchestrator = new AgentOrchestrator(new FakeKnowledgeAdapter(), new CapturingModel());
    const ctx = await orchestrator.buildAndValidateContext({
        id: 'conversation-1',
        organizationId: '11111111-1111-1111-1111-111111111111',
        status: 'active',
        version: 1,
        lastSequence: 0,
        trainingAttemptId: null,
        releaseSnapshotId: null,
        trainingSessionId: 'session-1',
        sourceType: 'free',
        personaSnapshot: minimalPersona(),
    }, { releaseSnapshotId: null, knowledgeVersions: [], agentConfig: {} }, []);
    assert.notEqual(ctx.personaSnapshot, null);
    assert.equal(ctx.personaSnapshot?.name, '李阿姨');
    assert.equal(ctx.personaSnapshot?.age, 42);
});
