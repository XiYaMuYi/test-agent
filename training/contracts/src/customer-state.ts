import type { PersonaConfig } from './persona/config.js';

export const CUSTOMER_STATE_KEYS = Object.freeze([
  'emotion',
  'trust',
  'patience',
  'consultationIntent',
  'purchaseIntent',
  'decisionReadiness',
  'priceAcceptance',
  'needClarity',
  'productFitBelief',
  'informationConfidence',
  'riskConcern',
  'objectionLevel',
] as const);

export type CustomerStateKey = (typeof CUSTOMER_STATE_KEYS)[number];

export interface CustomerState extends Record<CustomerStateKey, number> {
  readonly schemaVersion: 'customer-state/v1';
  readonly disclosedNeeds: readonly string[];
  readonly activeObjections: readonly string[];
  readonly unresolvedQuestions: readonly string[];
}

export type CapabilityDimension =
  | 'needDiscovery'
  | 'listeningAndUnderstanding'
  | 'productKnowledge'
  | 'answerAccuracy'
  | 'answerCompleteness'
  | 'knowledgeGrounding'
  | 'personalizedRecommendation'
  | 'safetyAndCompliance'
  | 'objectionHandling'
  | 'emotionManagement'
  | 'communicationClarity'
  | 'trustBuilding'
  | 'closingAbility';

export interface CapabilityEvidence {
  readonly dimension: CapabilityDimension;
  readonly impact: number;
  readonly reason: string;
  readonly knowledgeReferences: readonly string[];
  readonly confidence: number;
}

export interface KnowledgeAssessment {
  readonly topicsAsked: readonly string[];
  readonly topicsAnswered: readonly string[];
  readonly unansweredTopics: readonly string[];
  readonly referencesUsed: readonly string[];
  readonly accuracy: number;
  readonly completeness: number;
  readonly evidenceQuality: number;
  readonly personalization: number;
  readonly safetyCompliance: number;
  readonly hallucinationRisk: number;
  readonly conflict: boolean;
}

export type ConversationEndReason =
  | 'purchase_confirmed'
  | 'no_consultation_intent'
  | 'customer_angry'
  | 'safety_boundary'
  | 'max_turns'
  | 'natural_end'
  | 'manual_end';

export interface TerminalAssessment {
  readonly shouldEnd: boolean;
  readonly reason: ConversationEndReason | null;
  readonly confidence: number;
}

export interface CustomerStateTransition {
  readonly schemaVersion: 'customer-state-transition/v1';
  readonly before: CustomerState;
  readonly after: CustomerState;
  readonly changes: Readonly<Partial<Record<CustomerStateKey, number>>>;
  readonly knowledgeAssessment: KnowledgeAssessment;
  readonly capabilityEvidence: readonly CapabilityEvidence[];
  readonly terminal: TerminalAssessment;
}

const clamp = (value: number): number => Math.round(Math.max(0, Math.min(100, value)));

/** Create the hidden initial customer state from the frozen persona snapshot. */
export function createInitialCustomerState(persona: PersonaConfig | null | undefined): CustomerState {
  const personality = persona?.personality;
  const consumption = persona?.consumption;
  const skepticism = personality?.skepticism ?? 40;
  const friendliness = personality?.friendliness ?? 60;
  const decisiveness = personality?.decisiveness ?? 50;
  const priceSensitivity = personality?.priceSensitivity ?? 50;
  const hasSafetyConcern = (consumption?.allergies?.length ?? 0) > 0 || consumption?.skinType === 'sensitive';

  return {
    schemaVersion: 'customer-state/v1',
    emotion: 50,
    trust: clamp(45 - skepticism * 0.25 + friendliness * 0.15),
    patience: clamp(personality?.patience ?? 50),
    consultationIntent: 65,
    purchaseIntent: clamp(20 + decisiveness * 0.15),
    decisionReadiness: clamp(15 + decisiveness * 0.2),
    priceAcceptance: clamp(85 - priceSensitivity * 0.6),
    needClarity: 10,
    productFitBelief: 20,
    informationConfidence: 15,
    riskConcern: hasSafetyConcern ? 65 : 35,
    objectionLevel: clamp(20 + skepticism * 0.35),
    disclosedNeeds: [],
    activeObjections: [],
    unresolvedQuestions: [],
  };
}

export function customerMoodFromState(state: CustomerState): 'positive' | 'neutral' | 'negative' {
  if (state.emotion >= 65) return 'positive';
  if (state.emotion <= 35) return 'negative';
  return 'neutral';
}
