import assert from 'node:assert/strict';
import test from 'node:test';
import { PersonaService } from '../../src/persona/persona.service.js';
const service = new PersonaService();
const BASE_INPUT = {
    ageCardId: 'light-mature',
    difficulty: 2,
    productScenarioId: 'whitening',
};
// =============================================================================
// T24: 画像自定义字段补回测试
// =============================================================================
test('buildPersonaConfig merges new extra fields from overrides', () => {
    const input = {
        ...BASE_INPUT,
        overrides: {
            gender: 'male',
            basic: {
                maritalStatus: 'married',
                incomeLevel: 'high',
            },
            personality: {
                socialActivity: 80,
                emotionalVolatility: 70,
            },
            communication: {
                catchphrase: '这个嘛...',
                dialect: 'northeast',
            },
            consumption: {
                purchaseChannel: 'ecommerce',
                ingredientFocus: 'focused',
                competitorComparison: 'frequently',
                allergies: ['花粉', '酒精'],
                currentProducts: 'SK-II 神仙水',
            },
            conversation: {
                openingMode: 'wait_learner',
            },
        },
    };
    const config = service.buildPersonaConfig(input);
    // 顶层 gender 字段
    assert.equal(config.gender, 'male');
    // basic 子块
    assert.equal(config.basic?.maritalStatus, 'married');
    assert.equal(config.basic?.incomeLevel, 'high');
    // personality 新增维度
    assert.equal(config.personality.socialActivity, 80);
    assert.equal(config.personality.emotionalVolatility, 70);
    // communication 新增字段
    assert.equal(config.communication.catchphrase, '这个嘛...');
    assert.equal(config.communication.dialect, 'northeast');
    // consumption 新增字段
    assert.equal(config.consumption.purchaseChannel, 'ecommerce');
    assert.equal(config.consumption.ingredientFocus, 'focused');
    assert.equal(config.consumption.competitorComparison, 'frequently');
    assert.deepEqual(config.consumption.allergies, ['花粉', '酒精']);
    assert.equal(config.consumption.currentProducts, 'SK-II 神仙水');
    // conversation 新增字段
    assert.equal(config.conversation.openingMode, 'wait_learner');
});
test('buildPersonaConfig applies defaults when new fields are omitted (backward compatibility)', () => {
    const config = service.buildPersonaConfig(BASE_INPUT);
    // gender 默认 female
    assert.equal(config.gender, 'female');
    // basic 子块默认
    assert.equal(config.basic?.maritalStatus, 'unknown');
    assert.equal(config.basic?.incomeLevel, 'medium');
    // personality 新增维度默认 50
    assert.equal(config.personality.socialActivity, 50);
    assert.equal(config.personality.emotionalVolatility, 50);
    // communication 新增字段默认
    assert.equal(config.communication.catchphrase, undefined);
    assert.equal(config.communication.dialect, 'mandarin');
    // consumption 新增字段默认
    assert.equal(config.consumption.purchaseChannel, undefined);
    assert.equal(config.consumption.ingredientFocus, undefined);
    assert.equal(config.consumption.competitorComparison, undefined);
    assert.equal(config.consumption.allergies, undefined);
    assert.equal(config.consumption.currentProducts, undefined);
    // conversation 新增字段默认
    assert.equal(config.conversation.openingMode, 'ai_first');
});
test('validatePersonaConfig rejects invalid gender enum', () => {
    // 先构建一个有效配置，然后修改 gender 为非法值
    const validConfig = service.buildPersonaConfig(BASE_INPUT);
    const invalidConfig = { ...validConfig, gender: 'other' };
    const result = service.validatePersonaConfig(invalidConfig);
    assert.equal(result.valid, false);
    const genderIssue = result.issues.find((i) => i.path === 'gender');
    assert.ok(genderIssue, 'should have gender validation issue');
});
test('validatePersonaConfig rejects invalid maritalStatus enum', () => {
    const validConfig = service.buildPersonaConfig(BASE_INPUT);
    const invalidConfig = {
        ...validConfig,
        basic: { maritalStatus: 'divorced', incomeLevel: 'medium' },
    };
    const result = service.validatePersonaConfig(invalidConfig);
    assert.equal(result.valid, false);
    const issue = result.issues.find((i) => i.path === 'basic.maritalStatus');
    assert.ok(issue, 'should have maritalStatus validation issue');
});
test('validatePersonaConfig rejects invalid incomeLevel enum', () => {
    const validConfig = service.buildPersonaConfig(BASE_INPUT);
    const invalidConfig = {
        ...validConfig,
        basic: { maritalStatus: 'unknown', incomeLevel: 'rich' },
    };
    const result = service.validatePersonaConfig(invalidConfig);
    assert.equal(result.valid, false);
    const issue = result.issues.find((i) => i.path === 'basic.incomeLevel');
    assert.ok(issue, 'should have incomeLevel validation issue');
});
test('validatePersonaConfig rejects personality traits out of 0-100 range', () => {
    const validConfig = service.buildPersonaConfig(BASE_INPUT);
    // 直接构造越界值
    const invalidConfig = {
        ...validConfig,
        personality: { ...validConfig.personality, socialActivity: 150 },
    };
    const result = service.validatePersonaConfig(invalidConfig);
    assert.equal(result.valid, false);
    const issue = result.issues.find((i) => i.path === 'personality.socialActivity');
    assert.ok(issue, 'should have socialActivity range issue');
});
test('validatePersonaConfig rejects invalid dialect enum', () => {
    const validConfig = service.buildPersonaConfig(BASE_INPUT);
    const invalidConfig = {
        ...validConfig,
        communication: { ...validConfig.communication, dialect: 'hokkien' },
    };
    const result = service.validatePersonaConfig(invalidConfig);
    assert.equal(result.valid, false);
    const issue = result.issues.find((i) => i.path === 'communication.dialect');
    assert.ok(issue, 'should have dialect validation issue');
});
test('validatePersonaConfig rejects invalid purchaseChannel enum', () => {
    const validConfig = service.buildPersonaConfig(BASE_INPUT);
    const invalidConfig = {
        ...validConfig,
        consumption: { ...validConfig.consumption, purchaseChannel: 'tiktok' },
    };
    const result = service.validatePersonaConfig(invalidConfig);
    assert.equal(result.valid, false);
    const issue = result.issues.find((i) => i.path === 'consumption.purchaseChannel');
    assert.ok(issue, 'should have purchaseChannel validation issue');
});
test('validatePersonaConfig rejects invalid ingredientFocus enum', () => {
    const validConfig = service.buildPersonaConfig(BASE_INPUT);
    const invalidConfig = {
        ...validConfig,
        consumption: { ...validConfig.consumption, ingredientFocus: 'obsessed' },
    };
    const result = service.validatePersonaConfig(invalidConfig);
    assert.equal(result.valid, false);
    const issue = result.issues.find((i) => i.path === 'consumption.ingredientFocus');
    assert.ok(issue, 'should have ingredientFocus validation issue');
});
test('validatePersonaConfig rejects invalid competitorComparison enum', () => {
    const validConfig = service.buildPersonaConfig(BASE_INPUT);
    const invalidConfig = {
        ...validConfig,
        consumption: { ...validConfig.consumption, competitorComparison: 'always' },
    };
    const result = service.validatePersonaConfig(invalidConfig);
    assert.equal(result.valid, false);
    const issue = result.issues.find((i) => i.path === 'consumption.competitorComparison');
    assert.ok(issue, 'should have competitorComparison validation issue');
});
test('validatePersonaConfig rejects invalid openingMode enum', () => {
    const validConfig = service.buildPersonaConfig(BASE_INPUT);
    const invalidConfig = {
        ...validConfig,
        conversation: { ...validConfig.conversation, openingMode: 'learner_first' },
    };
    const result = service.validatePersonaConfig(invalidConfig);
    assert.equal(result.valid, false);
    const issue = result.issues.find((i) => i.path === 'conversation.openingMode');
    assert.ok(issue, 'should have openingMode validation issue');
});
test('buildPersonaConfig clamps personality traits to 0-100', () => {
    const configLow = service.buildPersonaConfig({
        ...BASE_INPUT,
        overrides: { personality: { socialActivity: -10, emotionalVolatility: -5 } },
    });
    assert.equal(configLow.personality.socialActivity, 0);
    assert.equal(configLow.personality.emotionalVolatility, 0);
    const configHigh = service.buildPersonaConfig({
        ...BASE_INPUT,
        overrides: { personality: { socialActivity: 150, emotionalVolatility: 200 } },
    });
    assert.equal(configHigh.personality.socialActivity, 100);
    assert.equal(configHigh.personality.emotionalVolatility, 100);
});
test('validatePersonaConfig accepts valid complete config with all new fields', () => {
    const config = service.buildPersonaConfig({
        ...BASE_INPUT,
        overrides: {
            gender: 'female',
            basic: {
                maritalStatus: 'single',
                incomeLevel: 'low',
            },
            personality: {
                socialActivity: 60,
                emotionalVolatility: 40,
            },
            communication: {
                catchphrase: '嗯嗯',
                dialect: 'cantonese',
            },
            consumption: {
                purchaseChannel: 'offline',
                ingredientFocus: 'normal',
                competitorComparison: 'occasionally',
                allergies: ['芒果'],
                currentProducts: '无',
            },
            conversation: {
                openingMode: 'ai_first',
            },
        },
    });
    const result = service.validatePersonaConfig(config);
    assert.equal(result.valid, true, `Expected valid but got issues: ${JSON.stringify(result.issues)}`);
});
test('deriveId includes new fields in hash seed', () => {
    const config1 = service.buildPersonaConfig({
        ...BASE_INPUT,
        overrides: { gender: 'male' },
    });
    const config2 = service.buildPersonaConfig({
        ...BASE_INPUT,
        overrides: { gender: 'female' },
    });
    // Different gender should produce different persona id
    assert.notEqual(config1.id, config2.id);
});
test('deriveId includes personality new dimensions in hash seed', () => {
    const config1 = service.buildPersonaConfig({
        ...BASE_INPUT,
        overrides: { personality: { socialActivity: 80 } },
    });
    const config2 = service.buildPersonaConfig({
        ...BASE_INPUT,
        overrides: { personality: { socialActivity: 20 } },
    });
    assert.notEqual(config1.id, config2.id);
});
