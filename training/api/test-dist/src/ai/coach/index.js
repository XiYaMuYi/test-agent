/**
 * Coach Engine - 规则引擎（零模型依赖）
 *
 * 从 Python backend/app/ai/coach.py 移植
 */
export { analyzeMoodQuick } from './mood-engine.js';
export { checkCustomerLeave } from './leave-detector.js';
export { detectEvents } from './event-detector.js';
export { ruleBasedCoachFeedback, } from './rule-coach.js';
export { llmCoachFeedback, buildCoachPrompt, parseCoachFeedback, } from './llm-coach.js';
