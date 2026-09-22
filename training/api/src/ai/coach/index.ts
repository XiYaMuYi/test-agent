/**
 * Coach Engine - 规则引擎（零模型依赖）
 *
 * 从 Python backend/app/ai/coach.py 移植
 */

export { analyzeMoodQuick, type MoodQuickResult } from './mood-engine.js';
export { checkCustomerLeave, type CheckCustomerLeaveResult } from './leave-detector.js';
export { detectEvents, type DetectedEvent } from './event-detector.js';
export {
  ruleBasedCoachFeedback,
  type CoachFeedbackParams,
  type CoachFeedbackResult,
} from './rule-coach.js';
export {
  llmCoachFeedback,
  buildCoachPrompt,
  parseCoachFeedback,
} from './llm-coach.js';
