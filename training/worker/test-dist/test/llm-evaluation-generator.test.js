import test from 'node:test';
import assert from 'node:assert/strict';
import { llmBasedEvaluate, parseLlmJsonResponse, LlmBasedEvaluationReportGenerator, } from '../src/jobs/llm-evaluation-generator.js';
function buildTranscript(pairs) {
    const transcript = [];
    for (const pair of pairs) {
        if (pair.learner !== undefined) {
            transcript.push({ role: 'learner', content: pair.learner });
        }
        if (pair.assistant !== undefined) {
            transcript.push({ role: 'assistant', content: pair.assistant });
        }
    }
    return transcript;
}
/** Build a fake ModelProviderPort that returns the given content string. */
function fakeModel(content) {
    return {
        async generate(_request) {
            return { content, modelVersion: 'fake-model/v1' };
        },
    };
}
/** Build a fake ModelProviderPort that throws an error (simulates timeout). */
function throwingModel(error = new Error('MODEL_TIMEOUT')) {
    return {
        async generate(_request) {
            throw error;
        },
    };
}
const FIXED_JSON = JSON.stringify({
    needs_discovery: 80,
    product_presentation: 70,
    objection_handling: 60,
    emotion_management: 90,
    closing_ability: 50,
    highlights: ['亮点一', '亮点二'],
    improvements: ['改进一'],
});
const SAMPLE_TRANSCRIPT = buildTranscript([
    { learner: '您好，请问有什么可以帮您的？', assistant: '我想找一款护肤品。' },
    { learner: '您的肤质是什么？有什么具体需求吗？', assistant: '我是干性皮肤，想要保湿效果好的。' },
]);
// ─── parseLlmJsonResponse ────────────────────────────────────────────────────
test('parseLlmJsonResponse: parses clean JSON', () => {
    const result = parseLlmJsonResponse(FIXED_JSON);
    assert.notEqual(result, null);
    assert.equal(result.needs_discovery, 80);
});
test('parseLlmJsonResponse: strips markdown code fence', () => {
    const fenced = '```json\n' + FIXED_JSON + '\n```';
    const result = parseLlmJsonResponse(fenced);
    assert.notEqual(result, null);
    assert.equal(result.needs_discovery, 80);
});
test('parseLlmJsonResponse: extracts JSON from surrounding prose', () => {
    const wrapped = '以下是评分结果：\n' + FIXED_JSON + '\n希望对你有帮助。';
    const result = parseLlmJsonResponse(wrapped);
    assert.notEqual(result, null);
    assert.equal(result.needs_discovery, 80);
});
test('parseLlmJsonResponse: returns null for completely invalid input', () => {
    assert.equal(parseLlmJsonResponse('not json at all'), null);
    assert.equal(parseLlmJsonResponse(''), null);
    assert.equal(parseLlmJsonResponse('123'), null, 'non-object JSON returns null');
    assert.equal(parseLlmJsonResponse('"just a string"'), null);
    assert.equal(parseLlmJsonResponse('[1,2,3]'), null, 'JSON array returns null');
});
test('parseLlmJsonResponse: empty object is valid JSON', () => {
    // `{}` is a valid JSON object — the parser accepts it; callers must validate required fields.
    const result = parseLlmJsonResponse('{}');
    assert.notEqual(result, null);
    assert.deepEqual(result, {});
});
// ─── llmBasedEvaluate ────────────────────────────────────────────────────────
test('llmBasedEvaluate: fixed JSON from model yields correct five-dimension scores', async () => {
    const model = fakeModel(FIXED_JSON);
    const report = await llmBasedEvaluate({
        transcript: SAMPLE_TRANSCRIPT,
        customerMood: 'neutral',
        modelProvider: model,
    });
    assert.notEqual(report, null, 'report should not be null');
    assert.equal(report.generatedBy, 'llm-evaluation/v1');
    assert.equal(report.dimensionScores.needs_discovery, 80);
    assert.equal(report.dimensionScores.product_presentation, 70);
    assert.equal(report.dimensionScores.objection_handling, 60);
    assert.equal(report.dimensionScores.emotion_management, 90);
    assert.equal(report.dimensionScores.closing_ability, 50);
    const expectedScore = Math.round((80 + 70 + 60 + 90 + 50) / 5);
    assert.equal(report.score, expectedScore, 'score should equal average of five dimensions');
});
test('llmBasedEvaluate: parses response wrapped in markdown code fence', async () => {
    const fenced = '```json\n' + FIXED_JSON + '\n```';
    const model = fakeModel(fenced);
    const report = await llmBasedEvaluate({
        transcript: SAMPLE_TRANSCRIPT,
        customerMood: 'positive',
        modelProvider: model,
    });
    assert.notEqual(report, null, 'report should not be null when response is fenced');
    assert.equal(report.dimensionScores.needs_discovery, 80);
    assert.equal(report.customerMood, 'positive');
});
test('llmBasedEvaluate: returns null when model returns bad JSON', async () => {
    const model = fakeModel('this is not valid json {{{');
    const report = await llmBasedEvaluate({
        transcript: SAMPLE_TRANSCRIPT,
        customerMood: 'neutral',
        modelProvider: model,
    });
    assert.equal(report, null, 'report should be null for unparseable JSON');
});
test('llmBasedEvaluate: returns null when model throws (timeout)', async () => {
    const model = throwingModel(new Error('MODEL_TIMEOUT'));
    const report = await llmBasedEvaluate({
        transcript: SAMPLE_TRANSCRIPT,
        customerMood: 'neutral',
        modelProvider: model,
    });
    assert.equal(report, null, 'report should be null when model throws');
});
test('llmBasedEvaluate: five-dimension scores are clamped to 0-100', async () => {
    const outOfRange = JSON.stringify({
        needs_discovery: 150,
        product_presentation: -20,
        objection_handling: 200,
        emotion_management: 0,
        closing_ability: 100,
        highlights: [],
        improvements: [],
    });
    const model = fakeModel(outOfRange);
    const report = await llmBasedEvaluate({
        transcript: SAMPLE_TRANSCRIPT,
        customerMood: 'neutral',
        modelProvider: model,
    });
    assert.notEqual(report, null);
    assert.equal(report.dimensionScores.needs_discovery, 100, '150 clamped to 100');
    assert.equal(report.dimensionScores.product_presentation, 0, '-20 clamped to 0');
    assert.equal(report.dimensionScores.objection_handling, 100, '200 clamped to 100');
    assert.equal(report.dimensionScores.emotion_management, 0, '0 stays at 0');
    assert.equal(report.dimensionScores.closing_ability, 100, '100 stays at 100');
});
test('llmBasedEvaluate: score equals rounded average of five clamped dimensions', async () => {
    const json = JSON.stringify({
        needs_discovery: 80,
        product_presentation: 70,
        objection_handling: 60,
        emotion_management: 90,
        closing_ability: 50,
    });
    const model = fakeModel(json);
    const report = await llmBasedEvaluate({
        transcript: SAMPLE_TRANSCRIPT,
        customerMood: 'neutral',
        modelProvider: model,
    });
    assert.notEqual(report, null);
    const dims = report.dimensionScores;
    const expectedAverage = Math.round((dims.needs_discovery + dims.product_presentation + dims.objection_handling
        + dims.emotion_management + dims.closing_ability) / 5);
    assert.equal(report.score, expectedAverage);
});
test('llmBasedEvaluate: highlights and improvements are string arrays from JSON', async () => {
    const model = fakeModel(FIXED_JSON);
    const report = await llmBasedEvaluate({
        transcript: SAMPLE_TRANSCRIPT,
        customerMood: 'neutral',
        modelProvider: model,
    });
    assert.notEqual(report, null);
    assert.deepEqual(report.highlights, ['亮点一', '亮点二']);
    assert.deepEqual(report.improvements, ['改进一']);
});
test('llmBasedEvaluate: missing dimension fields default to 50', async () => {
    const partial = JSON.stringify({
        needs_discovery: 80,
        // other dimensions missing
    });
    const model = fakeModel(partial);
    const report = await llmBasedEvaluate({
        transcript: SAMPLE_TRANSCRIPT,
        customerMood: 'neutral',
        modelProvider: model,
    });
    assert.notEqual(report, null);
    assert.equal(report.dimensionScores.needs_discovery, 80);
    assert.equal(report.dimensionScores.product_presentation, 50, 'missing dim defaults to 50');
    assert.equal(report.dimensionScores.objection_handling, 50);
    assert.equal(report.dimensionScores.emotion_management, 50);
    assert.equal(report.dimensionScores.closing_ability, 50);
});
// ─── LlmBasedEvaluationReportGenerator ───────────────────────────────────────
test('LlmBasedEvaluationReportGenerator: uses LLM when model returns valid JSON', async () => {
    const model = fakeModel(FIXED_JSON);
    const generator = new LlmBasedEvaluationReportGenerator(model);
    const report = await generator.generate({
        messageCount: SAMPLE_TRANSCRIPT.length,
        scoringRules: [],
        transcript: SAMPLE_TRANSCRIPT,
        personaConfig: null,
        customerMood: 'neutral',
    });
    assert.equal(report.generatedBy, 'llm-evaluation/v1');
    assert.equal(report.schemaVersion, 'evaluation-report/v1');
    assert.equal(typeof report.score, 'number');
});
test('LlmBasedEvaluationReportGenerator: falls back to rule-based on bad JSON', async () => {
    const model = fakeModel('bad json');
    const generator = new LlmBasedEvaluationReportGenerator(model);
    const report = await generator.generate({
        messageCount: SAMPLE_TRANSCRIPT.length,
        scoringRules: [],
        transcript: SAMPLE_TRANSCRIPT,
        personaConfig: null,
        customerMood: 'neutral',
    });
    // Fallback is rule-based, which uses 'rule-evaluation/v1' as generatedBy.
    assert.equal(report.generatedBy, 'rule-evaluation/v1');
    assert.equal(report.schemaVersion, 'evaluation-report/v1');
});
test('LlmBasedEvaluationReportGenerator: falls back to rule-based on model timeout', async () => {
    const model = throwingModel(new Error('MODEL_TIMEOUT'));
    const generator = new LlmBasedEvaluationReportGenerator(model);
    const report = await generator.generate({
        messageCount: SAMPLE_TRANSCRIPT.length,
        scoringRules: [],
        transcript: SAMPLE_TRANSCRIPT,
        personaConfig: null,
        customerMood: 'negative',
    });
    assert.equal(report.generatedBy, 'rule-evaluation/v1');
});
test('LlmBasedEvaluationReportGenerator: totalTurns counts assistant messages', async () => {
    const model = fakeModel(FIXED_JSON);
    const generator = new LlmBasedEvaluationReportGenerator(model);
    const report = await generator.generate({
        messageCount: SAMPLE_TRANSCRIPT.length,
        scoringRules: [],
        transcript: SAMPLE_TRANSCRIPT,
        personaConfig: null,
        customerMood: 'neutral',
    });
    const assistantCount = SAMPLE_TRANSCRIPT.filter((m) => m.role === 'assistant').length;
    assert.equal(report.totalTurns, assistantCount);
});
