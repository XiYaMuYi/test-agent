import assert from 'node:assert/strict';
import test from 'node:test';
import { DEFAULT_AGENT_CONFIG, normalizeAgentConfig, validateAgentConfigV1, validateAgentConfigOverrideV1, } from '@training/contracts';
import { ALLOWED_OVERRIDE_PATH_PREFIXES, DEFAULT_LEARNER_OVERRIDE_POLICY, normalizeLearnerOverridePolicy, validateLearnerOverridePolicy, } from '@training/contracts';
import { diffTemplateRevisions } from '@training/contracts';
import { isReleaseSnapshotV2, loadReleaseSnapshotSchemaV2 } from '@training/contracts';
// =============================================================================
// spec 2026-09-15 §9.2 AgentConfigV1 校验
// =============================================================================
test('AgentConfigV1 default is valid and normalized', () => {
    const validation = validateAgentConfigV1(DEFAULT_AGENT_CONFIG);
    assert.equal(validation.valid, true);
    assert.deepEqual(normalizeAgentConfig(undefined), DEFAULT_AGENT_CONFIG);
});
test('AgentConfigV1 rejects out-of-range historyMessageLimit', () => {
    const result = validateAgentConfigV1({ ...DEFAULT_AGENT_CONFIG, historyMessageLimit: 1 });
    assert.equal(result.valid, false);
    assert.ok(result.issues.some((issue) => issue.path === 'historyMessageLimit'));
});
test('AgentConfigV1 rejects unknown fields (contract drift guard)', () => {
    const result = validateAgentConfigV1({ ...DEFAULT_AGENT_CONFIG, modelName: 'gpt-4' });
    assert.equal(result.valid, false);
    assert.ok(result.issues.some((issue) => issue.path === 'modelName'));
});
test('AgentConfigV1 rejects invalid enums and long additionalInstructions', () => {
    const badEnum = validateAgentConfigV1({ ...DEFAULT_AGENT_CONFIG, responseLength: 'verylong' });
    assert.equal(badEnum.valid, false);
    const longText = validateAgentConfigV1({ ...DEFAULT_AGENT_CONFIG, additionalInstructions: 'x'.repeat(1001) });
    assert.equal(longText.valid, false);
    assert.ok(longText.issues.some((issue) => issue.path === 'additionalInstructions'));
    const ctrl = validateAgentConfigV1({ ...DEFAULT_AGENT_CONFIG, additionalInstructions: 'a\u0007b' });
    assert.equal(ctrl.valid, false);
});
// =============================================================================
// spec §6.4 扩展：任务级参数覆盖的 AgentConfig 部分校验
// =============================================================================
test('AgentConfig override accepts partial fields (missing = no override)', () => {
    const partial = validateAgentConfigOverrideV1({ historyMessageLimit: 5, closingTendency: 'resistant' });
    assert.equal(partial.valid, true);
    const empty = validateAgentConfigOverrideV1({});
    assert.equal(empty.valid, true);
    const undefinedInput = validateAgentConfigOverrideV1(undefined);
    assert.equal(undefinedInput.valid, false);
});
test('AgentConfig override rejects invalid partial values and unknown fields', () => {
    const badLimit = validateAgentConfigOverrideV1({ historyMessageLimit: 1 });
    assert.equal(badLimit.valid, false);
    assert.ok(badLimit.issues.some((issue) => issue.path === 'historyMessageLimit'));
    const badEnum = validateAgentConfigOverrideV1({ responseLength: 'verylong' });
    assert.equal(badEnum.valid, false);
    const unknown = validateAgentConfigOverrideV1({ modelName: 'gpt-4' });
    assert.equal(unknown.valid, false);
    assert.ok(unknown.issues.some((issue) => issue.path === 'modelName'));
    const longText = validateAgentConfigOverrideV1({ additionalInstructions: 'x'.repeat(1001) });
    assert.equal(longText.valid, false);
    const wrongSchema = validateAgentConfigOverrideV1({ schemaVersion: 'agent-config/v2' });
    assert.equal(wrongSchema.valid, false);
});
// =============================================================================
// spec §5.4 LearnerOverridePolicyV1 校验
// =============================================================================
test('LearnerOverridePolicy default is all/visible/non-recommended', () => {
    assert.deepEqual(DEFAULT_LEARNER_OVERRIDE_POLICY, { mode: 'all', visible: true, recommended: false });
    const validation = validateLearnerOverridePolicy(DEFAULT_LEARNER_OVERRIDE_POLICY);
    assert.equal(validation.valid, true);
});
test('LearnerOverridePolicy allow_list requires non-empty allowed paths within whitelist', () => {
    const empty = validateLearnerOverridePolicy({ mode: 'allow_list', visible: true, recommended: false, allowedPaths: [] });
    assert.equal(empty.valid, false);
    const valid = validateLearnerOverridePolicy({
        mode: 'allow_list',
        visible: true,
        recommended: false,
        allowedPaths: ['personality.friendliness', 'communication.catchphrase', 'consumption.budgetMin'],
    });
    assert.equal(valid.valid, true);
    const forbidden = validateLearnerOverridePolicy({
        mode: 'allow_list',
        visible: true,
        recommended: false,
        allowedPaths: ['conversation.background'],
    });
    assert.equal(forbidden.valid, false);
    assert.ok(forbidden.issues.some((issue) => issue.includes('conversation.background')));
    const proto = validateLearnerOverridePolicy({
        mode: 'allow_list',
        visible: true,
        recommended: false,
        allowedPaths: ['__proto__.polluted'],
    });
    assert.equal(proto.valid, false);
});
test('LearnerOverridePolicy whitelist covers the stable override surface', () => {
    assert.ok(ALLOWED_OVERRIDE_PATH_PREFIXES.includes('personality.emotionalVolatility'));
    assert.ok(ALLOWED_OVERRIDE_PATH_PREFIXES.includes('communication.style'));
    assert.ok(ALLOWED_OVERRIDE_PATH_PREFIXES.includes('conversation.maxTurns'));
    // 场景发布内容不允许学员覆盖
    assert.ok(!ALLOWED_OVERRIDE_PATH_PREFIXES.includes('conversation.background'));
    assert.ok(!ALLOWED_OVERRIDE_PATH_PREFIXES.includes('conversation.productScenario'));
});
test('LearnerOverridePolicy normalize merges defaults for legacy records', () => {
    assert.deepEqual(normalizeLearnerOverridePolicy(undefined), DEFAULT_LEARNER_OVERRIDE_POLICY);
    assert.deepEqual(normalizeLearnerOverridePolicy({ mode: 'locked' }), {
        mode: 'locked',
        visible: true,
        recommended: false,
    });
});
// =============================================================================
// spec §5.1 OrganizationTemplateRevisionV1 差异计算
// =============================================================================
const REVISION_1 = {
    revisionId: 'r1',
    templateId: 't1',
    revision: 1,
    title: '初版',
    personaConfig: {
        id: 'persona-1',
        name: '客户A',
        basedOnCard: 'lady',
        age: 30,
        gender: 'female',
        basic: { maritalStatus: 'unknown', incomeLevel: 'medium' },
        occupation: '白领',
        personality: {
            friendliness: 50, patience: 50, priceSensitivity: 50, decisiveness: 50,
            skepticism: 40, socialActivity: 50, emotionalVolatility: 50,
        },
        communication: { style: 'gentle', verbosity: 'normal', emotionLevel: 'normal', dialect: 'mandarin' },
        consumption: { budgetMin: 100, budgetMax: 500, decisionCycle: 'same_day', brandLoyalty: 'medium' },
        conversation: { difficulty: 2, maxTurns: 15, background: '背景', productScenario: '护肤品', openingMode: 'ai_first' },
    },
    knowledgeVersions: ['k1@v1'],
    scoringRules: ['s1'],
    agentConfig: { schemaVersion: 'agent-config/v1', historyMessageLimit: 20, responseLength: 'normal', knowledgeStrictness: 'balanced', conversationPace: 'normal', closingTendency: 'neutral' },
    learnerOverridePolicy: { mode: 'all', visible: true, recommended: false },
    createdBy: 'admin',
    createdAt: '2026-01-01T00:00:00.000Z',
};
test('diffTemplateRevisions reports only changed leaf paths', () => {
    const diff = diffTemplateRevisions(REVISION_1, {
        ...REVISION_1,
        revision: 2,
        title: '初版-改',
        personaConfig: { ...REVISION_1.personaConfig, age: 31 },
        knowledgeVersions: ['k1@v1', 'k2@v1'],
    });
    const paths = diff.map((entry) => entry.path).sort();
    assert.deepEqual(paths, ['knowledgeVersions', 'personaConfig.age', 'revision', 'title']);
});
test('diffTemplateRevisions reports empty when unchanged', () => {
    assert.deepEqual(diffTemplateRevisions(REVISION_1, REVISION_1), []);
});
// =============================================================================
// spec §5.3 release-snapshot/v2 判别与加载
// =============================================================================
test('isReleaseSnapshotV2 discriminates on schemaVersion', () => {
    assert.equal(isReleaseSnapshotV2({ schemaVersion: 'release-snapshot/v2' }), true);
    assert.equal(isReleaseSnapshotV2({ schemaVersion: 'release-snapshot/v1' }), false);
    assert.equal(isReleaseSnapshotV2(null), false);
});
test('loadReleaseSnapshotSchemaV2 requires the 13 frozen fields', () => {
    const schema = loadReleaseSnapshotSchemaV2();
    assert.equal(schema.schemaVersion, 'release-snapshot/v2');
    const required = schema.schema.required;
    for (const field of ['schemaVersion', 'personaConfig', 'personaSource', 'agentConfig', 'learnerOverridePolicy']) {
        assert.ok(required.includes(field), `missing required field ${field}`);
    }
    assert.equal(schema.schema.additionalProperties, false);
});
