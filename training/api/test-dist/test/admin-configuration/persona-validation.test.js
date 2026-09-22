import assert from 'node:assert/strict';
import test from 'node:test';
import { PersonaService } from '../../src/persona/persona.service.js';
const service = new PersonaService();
const BASE_INPUT = {
    ageCardId: 'light-mature',
    difficulty: 2,
    productScenarioId: 'whitening',
};
function validConfig() {
    return service.buildPersonaConfig(BASE_INPUT);
}
// =============================================================================
// spec §9.1 PersonaConfig 服务端校验增强
// =============================================================================
test('rejects unknown top-level keys (contract drift guard)', () => {
    const config = { ...validConfig(), rogueField: 'x' };
    const result = service.validatePersonaConfig(config);
    assert.equal(result.valid, false);
    assert.ok(result.issues.some((i) => i.path === 'rogueField'));
});
test('rejects unknown nested keys in each block', () => {
    const personality = { ...validConfig(), personality: { ...validConfig().personality, moody: 90 } };
    assert.equal(service.validatePersonaConfig(personality).valid, false);
    const consumption = { ...validConfig(), consumption: { ...validConfig().consumption, fancy: 'x' } };
    const result = service.validatePersonaConfig(consumption);
    assert.equal(result.valid, false);
    assert.ok(result.issues.some((i) => i.path === 'consumption.fancy'));
});
test('rejects invalid skinType enum', () => {
    const config = {
        ...validConfig(),
        consumption: { ...validConfig().consumption, skinType: 'oily-ish' },
    };
    const result = service.validatePersonaConfig(config);
    assert.equal(result.valid, false);
    assert.ok(result.issues.some((i) => i.path === 'consumption.skinType'));
});
test('accepts legal skinConcerns/healthGoals/allergies string arrays', () => {
    const config = {
        ...validConfig(),
        consumption: {
            ...validConfig().consumption,
            skinType: 'sensitive',
            skinConcerns: ['泛红', '干燥'],
            healthGoals: ['补水'],
            allergies: ['酒精'],
        },
    };
    const result = service.validatePersonaConfig(config);
    assert.equal(result.valid, true);
});
test('rejects non-array and over-limit array fields', () => {
    const nonArray = {
        ...validConfig(),
        consumption: { ...validConfig().consumption, skinConcerns: '泛红' },
    };
    assert.equal(service.validatePersonaConfig(nonArray).valid, false);
    const tooMany = {
        ...validConfig(),
        consumption: {
            ...validConfig().consumption,
            healthGoals: Array.from({ length: 11 }, (_, i) => `goal-${i}`),
        },
    };
    assert.equal(service.validatePersonaConfig(tooMany).valid, false);
    const tooLong = {
        ...validConfig(),
        consumption: { ...validConfig().consumption, allergies: ['x'.repeat(61)] },
    };
    assert.equal(service.validatePersonaConfig(tooLong).valid, false);
});
test('rejects over-length text fields', () => {
    const catchphrase = {
        ...validConfig(),
        communication: { ...validConfig().communication, catchphrase: 'x'.repeat(81) },
    };
    assert.equal(service.validatePersonaConfig(catchphrase).valid, false);
    const background = {
        ...validConfig(),
        conversation: { ...validConfig().conversation, background: 'x'.repeat(501) },
    };
    assert.equal(service.validatePersonaConfig(background).valid, false);
    const customNotes = {
        ...validConfig(),
        conversation: { ...validConfig().conversation, customNotes: 'x'.repeat(501) },
    };
    assert.equal(service.validatePersonaConfig(customNotes).valid, false);
});
test('rejects non-object nested blocks', () => {
    const badBasic = { ...validConfig(), basic: 'single' };
    assert.equal(service.validatePersonaConfig(badBasic).valid, false);
});
