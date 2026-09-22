import { toReportRecord } from './evaluation.processor.js';
import { ruleBasedEvaluate, } from './rule-evaluation-generator.js';
/**
 * Build a dialog string from the transcript, pairing assistant (customer) and
 * learner turns round by round.  Mirrors the Python evaluator's layout so the
 * LLM sees the same structure.
 */
function buildDialog(transcript) {
    const assistantMsgs = transcript
        .filter((message) => message.role === 'assistant')
        .map((message) => message.content.slice(0, 200));
    const learnerMsgs = transcript
        .filter((message) => message.role === 'learner')
        .map((message) => message.content.slice(0, 200));
    const rounds = Math.max(assistantMsgs.length, learnerMsgs.length);
    let dialog = '';
    for (let index = 0; index < rounds; index += 1) {
        const assistantText = assistantMsgs[index] ?? '';
        const learnerText = learnerMsgs[index] ?? '';
        dialog += `客户(第${index + 1}轮): ${assistantText}\n学员(第${index + 1}轮): ${learnerText}\n`;
    }
    return dialog;
}
function buildPrompt(transcript, customerMood) {
    const dialog = buildDialog(transcript);
    return `你是一个销售培训评分专家。请根据以下对话内容，给出五维度评分。

对话内容：
${dialog}
客户情绪：${customerMood}

请输出 JSON 格式（只输出 JSON，不要其他内容）：
{
  "needs_discovery": 0-100,
  "product_presentation": 0-100,
  "objection_handling": 0-100,
  "emotion_management": 0-100,
  "closing_ability": 0-100,
  "highlights": ["亮点1", "亮点2"],
  "improvements": ["改进建议1", "改进建议2"]
}`;
}
/**
 * Parse a raw LLM response string into a JSON object, tolerating markdown code
 * fences, leading/trailing prose, and other minor formatting noise.
 *
 * Returns `null` when no valid JSON object can be extracted.
 */
export function parseLlmJsonResponse(content) {
    let cleaned = content.trim();
    // Strip markdown code fences: ```json ... ``` or ``` ... ```
    cleaned = cleaned.replace(/^```(?:json)?\s*\n?/i, '').replace(/\n?```\s*$/i, '').trim();
    // Extract the outermost { ... } block.
    const firstBrace = cleaned.indexOf('{');
    const lastBrace = cleaned.lastIndexOf('}');
    if (firstBrace === -1 || lastBrace === -1 || lastBrace <= firstBrace) {
        return null;
    }
    const candidate = cleaned.slice(firstBrace, lastBrace + 1);
    try {
        const parsed = JSON.parse(candidate);
        if (typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed)) {
            return parsed;
        }
        return null;
    }
    catch {
        return null;
    }
}
function clamp(value, min, max) {
    return Math.max(min, Math.min(max, value));
}
function toNumberOr(value, fallback) {
    return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}
/**
 * Pure function: call an LLM to evaluate a transcript and return a fully-formed
 * report, or `null` when the model call fails / returns unparseable output.
 *
 * Returning `null` on failure lets the caller decide whether to fall back to
 * rule-based evaluation, retry, or surface an error.
 */
export async function llmBasedEvaluate(params) {
    const { transcript, customerMood, modelProvider } = params;
    const prompt = buildPrompt(transcript, customerMood);
    let response;
    try {
        response = await modelProvider.generate({
            sessionId: 'llm-evaluation',
            prompt,
        });
    }
    catch {
        // Model timeout / upstream failure → caller decides what to do.
        return null;
    }
    const parsed = parseLlmJsonResponse(response.content);
    if (parsed === null)
        return null;
    const rawDimensions = {
        needs_discovery: toNumberOr(parsed.needs_discovery, 50),
        product_presentation: toNumberOr(parsed.product_presentation, 50),
        objection_handling: toNumberOr(parsed.objection_handling, 50),
        emotion_management: toNumberOr(parsed.emotion_management, 50),
        closing_ability: toNumberOr(parsed.closing_ability, 50),
    };
    const dimensionScores = {
        needs_discovery: clamp(Math.round(rawDimensions.needs_discovery), 0, 100),
        product_presentation: clamp(Math.round(rawDimensions.product_presentation), 0, 100),
        objection_handling: clamp(Math.round(rawDimensions.objection_handling), 0, 100),
        emotion_management: clamp(Math.round(rawDimensions.emotion_management), 0, 100),
        closing_ability: clamp(Math.round(rawDimensions.closing_ability), 0, 100),
    };
    const score = Math.round((dimensionScores.needs_discovery
        + dimensionScores.product_presentation
        + dimensionScores.objection_handling
        + dimensionScores.emotion_management
        + dimensionScores.closing_ability)
        / 5);
    const highlights = Array.isArray(parsed.highlights)
        ? parsed.highlights.filter((item) => typeof item === 'string')
        : [];
    const improvements = Array.isArray(parsed.improvements)
        ? parsed.improvements.filter((item) => typeof item === 'string')
        : [];
    const totalTurns = transcript.filter((message) => message.role === 'assistant').length;
    return {
        schemaVersion: 'evaluation-report/v1',
        generatedBy: 'llm-evaluation/v1',
        messageCount: transcript.length,
        scoringRules: [],
        score,
        dimensionScores,
        highlights,
        improvements,
        customerMood,
        totalTurns,
    };
}
/**
 * Production adapter: tries the LLM evaluator first and transparently falls
 * back to the rule-based evaluator when the model returns invalid output or
 * throws.  Implements the same `EvaluationReportGenerator` interface as
 * `RuleBasedEvaluationReportGenerator` so the two are interchangeable in the
 * worker module.
 */
export class LlmBasedEvaluationReportGenerator {
    modelProvider;
    constructor(modelProvider) {
        this.modelProvider = modelProvider;
    }
    async generate(input) {
        const llmReport = await llmBasedEvaluate({
            transcript: input.transcript,
            customerMood: input.customerMood,
            personaConfig: input.personaConfig,
            modelProvider: this.modelProvider,
        });
        if (llmReport !== null) {
            return toReportRecord(llmReport);
        }
        // Fallback: rule-based evaluation when LLM output is unusable.
        const fallback = ruleBasedEvaluate({
            transcript: input.transcript,
            customerMood: input.customerMood,
            personaConfig: input.personaConfig,
            scoringRules: input.scoringRules,
        });
        return toReportRecord(fallback);
    }
}
