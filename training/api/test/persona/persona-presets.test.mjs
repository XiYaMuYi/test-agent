import assert from 'node:assert/strict';
import test from 'node:test';

import { PersonaService } from '../../dist/persona/persona.service.js';

function service() {
  return new PersonaService();
}

const baseInput = (overrides = {}) => ({
  ageCardId: 'young-lady',
  psychologyCardIds: [],
  difficulty: 2,
  productScenarioId: 'anti-aging',
  ...overrides,
});

test('preset catalog exposes the four fixed option groups', () => {
  const catalog = service().getPresetCatalog();
  assert.equal(catalog.ageCards.length, 6, 'six age cards');
  assert.equal(catalog.psychologyCards.length, 8, 'eight psychology cards');
  assert.equal(catalog.difficultyLevels.length, 4, 'four difficulty levels');
  assert.equal(catalog.productScenarios.length, 8, 'eight product scenarios');
  // Catalog is read-only so callers cannot mutate shared presets.
  assert.ok(Object.isFrozen(catalog));
  assert.ok(Object.isFrozen(catalog.ageCards));
});

test('builds a persona from an age card and normalizes numeric brand loyalty to a tier', () => {
  const persona = service().buildPersonaConfig(baseInput());

  assert.equal(persona.basedOnCard, 'young-lady');
  assert.equal(persona.age, 22);
  assert.equal(persona.occupation, '学生');
  // personality inherited verbatim from the age card (with the two extra T24 dimensions defaulted to 50)
  assert.deepEqual(persona.personality, {
    friendliness: 70,
    patience: 40,
    priceSensitivity: 80,
    decisiveness: 60,
    skepticism: 30,
    socialActivity: 50,
    emotionalVolatility: 50,
  });
  // age card stores brandLoyalty as a 0-100 number at runtime; the snapshot must carry the legal tier enum
  assert.equal(persona.consumption.brandLoyalty, 'low');
  assert.equal(persona.consumption.decisionCycle, 'impulse');
  // product scenario id maps to its display name
  assert.equal(persona.conversation.productScenario, '抗老咨询');
  assert.equal(persona.conversation.difficulty, 2);
});

test('numeric brand loyalty maps to low/medium/high across age cards', () => {
  assert.equal(service().buildPersonaConfig(baseInput({ ageCardId: 'light-mature' })).consumption.brandLoyalty, 'medium');
  assert.equal(service().buildPersonaConfig(baseInput({ ageCardId: 'mom' })).consumption.brandLoyalty, 'high');
  assert.equal(service().buildPersonaConfig(baseInput({ ageCardId: 'boss-lady' })).consumption.brandLoyalty, 'high');
});

test('psychology cards stack their boosts onto the age-card personality and clamp at 100', () => {
  // light-mature baseline: skepticism 50, priceSensitivity 40
  // hesitant (+20 skepticism,+10 price) + skeptical (+35 skepticism,+5 price) => skepticism 105 -> 100
  const persona = service().buildPersonaConfig(
    baseInput({ ageCardId: 'light-mature', psychologyCardIds: ['hesitant', 'skeptical'] }),
  );
  assert.equal(persona.personality.skepticism, 100);
  assert.equal(persona.personality.priceSensitivity, 55);
  // untouched dimensions keep the baseline
  assert.equal(persona.personality.friendliness, 60);
});

test('negative psychology boosts lower a dimension without going below 0, and duplicate card ids apply only once', () => {
  // impulsive = skepticism -10 / price -15; passing it twice must not double-apply
  const once = service().buildPersonaConfig(
    baseInput({ ageCardId: 'young-lady', psychologyCardIds: ['impulsive'] }),
  );
  const twice = service().buildPersonaConfig(
    baseInput({ ageCardId: 'young-lady', psychologyCardIds: ['impulsive', 'impulsive'] }),
  );
  assert.equal(once.personality.skepticism, 20); // 30 - 10
  assert.equal(once.personality.priceSensitivity, 65); // 80 - 15
  assert.deepEqual(twice.personality, once.personality);
  assert.ok(once.personality.skepticism >= 0 && once.personality.priceSensitivity >= 0);
});

test('user overrides win over card defaults for sliders, budget, communication and conversation options', () => {
  const persona = service().buildPersonaConfig(baseInput({
    name: '我的定制客户',
    overrides: {
      age: 27,
      personality: { friendliness: 92 },
      communication: { style: 'direct', verbosity: 'brief' },
      consumption: { budgetMin: 300, budgetMax: 1200 },
      conversation: { maxTurns: 25, customNotes: '最近做过医美' },
    },
  }));

  assert.equal(persona.name, '我的定制客户');
  assert.equal(persona.age, 27);
  assert.equal(persona.personality.friendliness, 92);
  // overridden slider leaves sibling dimensions intact
  assert.equal(persona.personality.patience, 40);
  assert.equal(persona.communication.style, 'direct');
  assert.equal(persona.communication.verbosity, 'brief');
  // unspecified communication field keeps the default
  assert.equal(persona.communication.emotionLevel, 'normal');
  assert.equal(persona.consumption.budgetMin, 300);
  assert.equal(persona.consumption.budgetMax, 1200);
  assert.equal(persona.conversation.maxTurns, 25);
  assert.equal(persona.conversation.customNotes, '最近做过医美');
});

test('the built snapshot is deeply frozen and passes validation', () => {
  const persona = service().buildPersonaConfig(baseInput());
  assert.ok(Object.isFrozen(persona));
  assert.ok(Object.isFrozen(persona.personality));
  assert.ok(Object.isFrozen(persona.communication));
  assert.ok(Object.isFrozen(persona.consumption));
  assert.ok(Object.isFrozen(persona.conversation));
  const result = service().validatePersonaConfig(persona);
  assert.equal(result.valid, true);
  assert.deepEqual(result.issues, []);
});

test('identical inputs produce a deterministic persona id; different inputs differ', () => {
  const a = service().buildPersonaConfig(baseInput());
  const b = service().buildPersonaConfig(baseInput());
  const other = service().buildPersonaConfig(baseInput({ difficulty: 4 }));
  assert.equal(a.id, b.id);
  assert.notEqual(a.id, other.id);
});

test('unknown age / psychology / scenario ids and illegal difficulty are rejected with stable error codes', () => {
  assert.throws(
    () => service().buildPersonaConfig(baseInput({ ageCardId: 'nope' })),
    /PERSONA_PRESET_NOT_FOUND/,
  );
  assert.throws(
    () => service().buildPersonaConfig(baseInput({ psychologyCardIds: ['ghost'] })),
    /PERSONA_PRESET_NOT_FOUND/,
  );
  assert.throws(
    () => service().buildPersonaConfig(baseInput({ productScenarioId: 'ghost' })),
    /PERSONA_PRESET_NOT_FOUND/,
  );
  assert.throws(
    () => service().buildPersonaConfig(baseInput({ difficulty: 9 })),
    /PERSONA_CONFIG_INVALID/,
  );
});

test('validatePersonaConfig reports every out-of-range or malformed field', () => {
  const valid = service().buildPersonaConfig(baseInput());
  const broken = {
    ...valid,
    age: -3,
    personality: { ...valid.personality, friendliness: 140 },
    communication: { ...valid.communication, style: 'shouting' },
    consumption: { ...valid.consumption, budgetMin: 900, budgetMax: 100, brandLoyalty: 'ultra' },
    conversation: { ...valid.conversation, difficulty: 7, maxTurns: 0, productScenario: '' },
  };
  const result = service().validatePersonaConfig(broken);
  assert.equal(result.valid, false);
  const paths = result.issues.map((issue) => issue.path);
  for (const expected of [
    'age',
    'personality.friendliness',
    'communication.style',
    'consumption.budgetMin',
    'consumption.brandLoyalty',
    'conversation.difficulty',
    'conversation.maxTurns',
    'conversation.productScenario',
  ]) {
    assert.ok(paths.includes(expected), `should flag ${expected}; got ${JSON.stringify(paths)}`);
  }
});
