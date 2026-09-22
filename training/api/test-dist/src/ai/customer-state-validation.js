import { CUSTOMER_STATE_KEYS, createInitialCustomerState } from '@training/contracts';
const listKeys = ['disclosedNeeds', 'activeObjections', 'unresolvedQuestions'];
const reasons = ['purchase_confirmed', 'no_consultation_intent', 'customer_angry', 'safety_boundary', 'max_turns', 'natural_end'];
const dimensions = ['needDiscovery', 'listeningAndUnderstanding', 'productKnowledge', 'answerAccuracy', 'answerCompleteness', 'knowledgeGrounding', 'personalizedRecommendation', 'safetyAndCompliance', 'objectionHandling', 'emotionManagement', 'communicationClarity', 'trustBuilding', 'closingAbility'];
const record = (v) => typeof v === 'object' && v !== null && !Array.isArray(v);
const number = (v, min, max) => typeof v === 'number' && Number.isFinite(v) && v >= min && v <= max;
const strings = (v) => Array.isArray(v) && v.length <= 20 && v.every(s => typeof s === 'string');
const clamp = (v) => Math.max(0, Math.min(100, v));
export function validateCustomerTransition(value, context) {
    const invalid = () => { throw new Error('Invalid customer state transition'); };
    const current = context.currentCustomerState ?? createInitialCustomerState(context.personaSnapshot);
    if (!record(value) || value.schemaVersion !== 'customer-state-transition/v1' || !record(value.before) || !record(value.after) || !record(value.changes) || !record(value.terminal))
        return invalid();
    const { before, after, changes, terminal } = value;
    if (before.schemaVersion !== 'customer-state/v1' || after.schemaVersion !== 'customer-state/v1')
        return invalid();
    if (Object.keys(changes).some(key => !CUSTOMER_STATE_KEYS.includes(key)))
        return invalid();
    for (const key of CUSTOMER_STATE_KEYS) {
        const delta = changes[key] ?? 0;
        if (!number(before[key], 0, 100) || before[key] !== current[key] || !number(delta, -20, 20) || !number(after[key], 0, 100) || after[key] !== clamp(current[key] + delta))
            return invalid();
    }
    for (const key of listKeys) {
        if (!strings(before[key]) || !strings(after[key]) || JSON.stringify(before[key]) !== JSON.stringify(current[key]))
            return invalid();
    }
    if (typeof terminal.shouldEnd !== 'boolean' || !number(terminal.confidence, 0, 1)
        || (terminal.shouldEnd ? !reasons.includes(String(terminal.reason)) : terminal.reason !== null))
        return invalid();
    const approved = new Set(context.approvedKnowledge.map(k => `${k.ref.itemId}@${k.ref.version}`));
    const refsValid = (refs) => strings(refs) && refs.every(ref => approved.has(ref));
    if (!record(value.knowledgeAssessment) || !Array.isArray(value.capabilityEvidence))
        return invalid();
    const knowledge = { topicsAsked: [], topicsAnswered: [], unansweredTopics: [], referencesUsed: [], accuracy: 50, completeness: 50, evidenceQuality: 0, personalization: 50, safetyCompliance: 50, hallucinationRisk: 50, conflict: false, ...value.knowledgeAssessment };
    if (!refsValid(knowledge.referencesUsed) || !strings(knowledge.topicsAsked) || !strings(knowledge.topicsAnswered) || !strings(knowledge.unansweredTopics) || typeof knowledge.conflict !== 'boolean')
        return invalid();
    for (const key of ['accuracy', 'completeness', 'evidenceQuality', 'personalization', 'safetyCompliance', 'hallucinationRisk'])
        if (!number(knowledge[key], 0, 100))
            return invalid();
    for (const evidence of value.capabilityEvidence) {
        if (!record(evidence) || !dimensions.includes(String(evidence.dimension)) || !number(evidence.impact, -20, 20) || !number(evidence.confidence, 0, 1) || typeof evidence.reason !== 'string' || !refsValid(evidence.knowledgeReferences))
            return invalid();
    }
    return { ...value, knowledgeAssessment: knowledge };
}
/** Older model providers still produce a complete, conservative state record. */
export function fallbackCustomerTransition(decision, context) {
    const before = context.currentCustomerState ?? createInitialCustomerState(context.personaSnapshot);
    const maxTurns = context.personaSnapshot?.conversation?.maxTurns ?? 15;
    const reason = context.lastSequence >= maxTurns ? 'max_turns' : decision.suggestedAction === 'end' ? 'natural_end' : null;
    return {
        schemaVersion: 'customer-state-transition/v1', before, after: { ...before }, changes: {},
        knowledgeAssessment: { topicsAsked: [], topicsAnswered: [], unansweredTopics: [], referencesUsed: [...decision.knowledgeReferences], accuracy: 50, completeness: 50, evidenceQuality: 0, personalization: 50, safetyCompliance: 50, hallucinationRisk: 50, conflict: false },
        capabilityEvidence: [], terminal: { shouldEnd: reason !== null, reason, confidence: reason === null ? 0 : 1 },
    };
}
