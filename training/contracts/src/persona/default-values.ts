import type { PersonaConfig, PersonalityConfig, CommunicationConfig, ConsumptionConfig, ConversationConfig, BasicProfile } from './config.js';

export const DEFAULT_BASIC: BasicProfile = {
  maritalStatus: 'unknown',
  incomeLevel: 'medium',
};

export const DEFAULT_PERSONALITY: PersonalityConfig = {
  friendliness: 60,
  patience: 50,
  priceSensitivity: 50,
  decisiveness: 50,
  skepticism: 40,
  socialActivity: 50,
  emotionalVolatility: 50,
};

export const DEFAULT_COMMUNICATION: CommunicationConfig = {
  style: 'gentle',
  verbosity: 'normal',
  emotionLevel: 'normal',
  dialect: 'mandarin',
};

export const DEFAULT_CONSUMPTION: ConsumptionConfig = {
  budgetMin: 100,
  budgetMax: 500,
  decisionCycle: 'same_day',
  brandLoyalty: 'medium',
};

export const DEFAULT_CONVERSATION: ConversationConfig = {
  difficulty: 2,
  maxTurns: 15,
  background: '这位客户通过朋友圈了解到产品信息，想进一步咨询。',
  productScenario: '护肤品',
  openingMode: 'ai_first',
};

export function buildDefaultConfig(overrides: Partial<PersonaConfig> = {}): PersonaConfig {
  return {
    id: overrides.id || '',
    name: overrides.name || '默认客户',
    basedOnCard: overrides.basedOnCard || 'lady',
    age: overrides.age || 30,
    gender: overrides.gender || 'female',
    basic: { ...DEFAULT_BASIC, ...overrides.basic },
    occupation: overrides.occupation || '白领',
    personality: { ...DEFAULT_PERSONALITY, ...overrides.personality },
    communication: { ...DEFAULT_COMMUNICATION, ...overrides.communication },
    consumption: { ...DEFAULT_CONSUMPTION, ...overrides.consumption },
    conversation: { ...DEFAULT_CONVERSATION, ...overrides.conversation },
  };
}
