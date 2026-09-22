/**
 * LLM 教练点评引擎 - 用大模型生成有上下文理解能力的点评。
 *
 * 移植自 Python backend/app/ai/coach.py 的 _llm_coach_feedback /
 * generate_coach_feedback_async：每轮优先使用 LLM，模型不可用或返回非法时
 * 降级到规则引擎 ruleBasedCoachFeedback，保证点评永远可用。
 */
import { analyzeMoodQuick } from './mood-engine.js';
import { ruleBasedCoachFeedback, } from './rule-coach.js';
/** 构造教练点评 prompt（移植自 Python _llm_coach_feedback，并强化角色边界）。 */
export function buildCoachPrompt(params) {
    const { userMsg, turnCount, customerMood, events } = params;
    // An explicitly empty previousCustomerMsg means wait_learner: the learner opened
    // the conversation and there is no earlier customer sentence to evaluate against.
    const previousCustomerMsg = params.previousCustomerMsg === undefined
        ? params.aiMsg
        : params.previousCustomerMsg;
    const contextDesc = params.conversationContext && params.conversationContext.length > 0
        ? params.conversationContext
            .map((message) => `${message.role === 'learner' ? '学员（销售员）' : '客户（AI 顾客）'}：${message.content}`)
            .join('\n')
        : '（无更早对话）';
    const eventsDesc = events.length > 0
        ? events.map((event) => `- ${event.detail}`).join('\n')
        : '无特殊事件';
    return [
        '你是一名资深的销售培训教练，正在点评一位销售新人在「模拟陪练」中的本轮表现。',
        '注意角色：「学员回复」是销售员（新人）说的话，「客户回复」是 AI 扮演的顾客说的话；你只评价销售员的表现，不要评价顾客。',
        '点评上下文严格截止到本轮学员发言，不包含学员发言之后才生成的客户回复。',
        '',
        '【截至本轮学员发言的对话上下文】',
        contextDesc,
        '',
        '【本轮待点评内容】',
        `客户上一句：${previousCustomerMsg || '（学员主动开场，此前没有客户发言）'}`,
        `学员（销售员）回复：${userMsg}`,
        '',
        '【当前状态】',
        `客户情绪：${customerMood}`,
        `对话轮数：第 ${turnCount} 轮`,
        '',
        '【系统检测到的关键事件（仅供参考，可结合，但不要盲从）】',
        eventsDesc,
        '',
        '点评要求：',
        '1. feedback：2-3 句话，先肯定做得好的地方（如有），再指出最关键的 1-2 个问题，必须结合本轮真实对话内容，不要说套话、不要复述固定模板；',
        '2. rating：0-100 的整数评分，销售员确实提到了具体产品名/卖点/需求回应时，不要误判为“未提及产品”；若销售员推荐的产品与客户表达的需求不匹配，应指出“需求错配”；',
        '3. improvements：2-4 条可操作建议，每条先写问题描述，再另起一条以「✅ 正确示范：」开头，给出贴合当前对话语境的具体话术示例（用单引号包裹），话术要自然、有温度。',
        '',
        '只输出一个 JSON 对象，不要输出 Markdown 代码块、推理过程或任何多余文字，格式如下：',
        '{',
        '  "feedback": "结合本轮内容的点评，2-3句话",',
        '  "rating": 75,',
        '  "improvements": ["问题描述1", "✅ 正确示范：\'贴合当前对话的话术1\'"]',
        '}',
    ].join('\n');
}
/** 从模型原始输出中提取第一个合法 JSON 对象（容忍 markdown 围栏与前后缀文字）。 */
function extractJsonObject(raw) {
    const text = raw.trim().replace(/^﻿/, '').trim();
    const candidates = [text];
    const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
    if (fenced !== null && typeof fenced[1] === 'string')
        candidates.unshift(fenced[1].trim());
    const firstBrace = text.indexOf('{');
    const lastBrace = text.lastIndexOf('}');
    if (firstBrace !== -1 && lastBrace > firstBrace)
        candidates.push(text.slice(firstBrace, lastBrace + 1));
    for (const candidate of candidates) {
        try {
            const parsed = JSON.parse(candidate);
            if (typeof parsed === 'object' && parsed !== null)
                return parsed;
        }
        catch {
            // try next candidate
        }
    }
    return null;
}
/** 校验并归一化模型输出；任何字段非法都返回 null 以便上层降级。 */
export function parseCoachFeedback(raw, params) {
    const obj = extractJsonObject(raw);
    if (obj === null)
        return null;
    const feedback = obj.feedback;
    const rating = obj.rating;
    const improvements = obj.improvements;
    if (typeof feedback !== 'string' || feedback.trim() === '')
        return null;
    if (typeof rating !== 'number' || Number.isNaN(rating))
        return null;
    if (!Array.isArray(improvements))
        return null;
    const normalizedImprovements = improvements
        .filter((item) => typeof item === 'string' && item.trim() !== '');
    if (normalizedImprovements.length === 0)
        return null;
    const moodDelta = analyzeMoodQuick(params.aiMsg).moodDelta;
    return {
        rating: Math.max(0, Math.min(100, Math.round(rating))),
        feedback: feedback.trim(),
        improvements: normalizedImprovements,
        events: params.events,
        moodDelta,
    };
}
/**
 * LLM 教练点评主入口：优先用模型生成，任何异常/非法输出都回落到规则引擎。
 * @param generate 模型生成函数（prompt 文本 -> 模型原始输出），由调用方注入
 */
export async function llmCoachFeedback(generate, params) {
    const fallback = ruleBasedCoachFeedback(params);
    try {
        const raw = await generate(buildCoachPrompt(params));
        return parseCoachFeedback(raw, params) ?? fallback;
    }
    catch (error) {
        console.error('[Coach] LLM feedback failed, falling back to rules:', error);
        return fallback;
    }
}
