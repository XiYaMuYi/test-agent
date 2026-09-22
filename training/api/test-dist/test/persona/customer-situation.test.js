import assert from 'node:assert/strict';
import test from 'node:test';
import { PersonaService } from '../../src/persona/persona.service.js';
import { CUSTOMER_RELATIONS, CUSTOMER_COHORTS, TRUST_LEVELS, SKIN_CONCERNS, PRODUCT_SCENARIOS, PRODUCT_SCENARIO_CATEGORIES, PRODUCT_SCENARIO_LEGACY_CATEGORY_MAP, ALLOWED_OVERRIDE_PATH_PREFIXES, } from '@training/contracts';
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
// v2 客户画像维度（商学院反馈 v2 设计 §3）：客户生命周期 / 信任阶梯 / 八大人群 / 城市 / 购买品类
// =============================================================================
test('accepts a full v2 customer-situation persona', () => {
    const config = {
        ...validConfig(),
        basic: {
            ...validConfig().basic,
            customerRelation: 'returning',
            trustLevel: 4,
            customerCohort: 'precision_mom',
            city: '杭州',
            purchaseCategory: '护肤精华',
        },
        consumption: {
            ...validConfig().consumption,
            skinType: 'mixed_dry',
            skinConcerns: ['黄褐斑', '痘印'],
        },
    };
    const result = service.validatePersonaConfig(config);
    assert.equal(result.valid, true);
});
test('legacy persona without any v2 fields still validates', () => {
    const result = service.validatePersonaConfig(validConfig());
    assert.equal(result.valid, true);
});
test('rejects invalid customerRelation enum', () => {
    const config = {
        ...validConfig(),
        basic: { ...validConfig().basic, customerRelation: 'vip' },
    };
    const result = service.validatePersonaConfig(config);
    assert.equal(result.valid, false);
    assert.ok(result.issues.some((i) => i.path === 'basic.customerRelation'));
});
test('rejects trustLevel out of range or non-integer', () => {
    const tooHigh = {
        ...validConfig(),
        basic: { ...validConfig().basic, trustLevel: 6 },
    };
    assert.equal(service.validatePersonaConfig(tooHigh).valid, false);
    const zero = {
        ...validConfig(),
        basic: { ...validConfig().basic, trustLevel: 0 },
    };
    assert.equal(service.validatePersonaConfig(zero).valid, false);
    const float = {
        ...validConfig(),
        basic: { ...validConfig().basic, trustLevel: 3.5 },
    };
    assert.equal(service.validatePersonaConfig(float).valid, false);
});
test('accepts every legal trustLevel 1..5', () => {
    for (const level of [1, 2, 3, 4, 5]) {
        const config = {
            ...validConfig(),
            basic: { ...validConfig().basic, trustLevel: level },
        };
        assert.equal(service.validatePersonaConfig(config).valid, true, `trustLevel=${level}`);
    }
});
test('rejects unknown customerCohort', () => {
    const config = {
        ...validConfig(),
        basic: { ...validConfig().basic, customerCohort: 'gen_x' },
    };
    const result = service.validatePersonaConfig(config);
    assert.equal(result.valid, false);
    assert.ok(result.issues.some((i) => i.path === 'basic.customerCohort'));
});
test('accepts every legal cohort id (8 DMP cohorts)', () => {
    for (const cohort of CUSTOMER_COHORTS) {
        const config = {
            ...validConfig(),
            basic: { ...validConfig().basic, customerCohort: cohort.id },
        };
        assert.equal(service.validatePersonaConfig(config).valid, true, `cohort=${cohort.id}`);
    }
});
test('rejects over-length city and purchaseCategory', () => {
    const longCity = {
        ...validConfig(),
        basic: { ...validConfig().basic, city: 'x'.repeat(31) },
    };
    const cityResult = service.validatePersonaConfig(longCity);
    assert.equal(cityResult.valid, false);
    assert.ok(cityResult.issues.some((i) => i.path === 'basic.city'));
    const longCategory = {
        ...validConfig(),
        basic: { ...validConfig().basic, purchaseCategory: 'x'.repeat(51) },
    };
    const categoryResult = service.validatePersonaConfig(longCategory);
    assert.equal(categoryResult.valid, false);
    assert.ok(categoryResult.issues.some((i) => i.path === 'basic.purchaseCategory'));
});
test('rejects unknown keys inside basic block (contract drift guard)', () => {
    const config = {
        ...validConfig(),
        basic: { ...validConfig().basic, cohortLabel: 'x' },
    };
    const result = service.validatePersonaConfig(config);
    assert.equal(result.valid, false);
    assert.ok(result.issues.some((i) => i.path === 'basic.cohortLabel'));
});
test('accepts new mixed skin types and rejects unknown', () => {
    for (const skinType of ['mixed_dry', 'mixed_oily']) {
        const config = {
            ...validConfig(),
            consumption: { ...validConfig().consumption, skinType },
        };
        assert.equal(service.validatePersonaConfig(config).valid, true, `skinType=${skinType}`);
    }
    const bad = {
        ...validConfig(),
        consumption: { ...validConfig().consumption, skinType: 'mixed' },
    };
    assert.equal(service.validatePersonaConfig(bad).valid, false);
});
// =============================================================================
// v2 共享字典完整性（商学院反馈 v2 设计 §3.2）：B/C 两端共用同一元数据
// =============================================================================
test('customer-relation dictionary covers 5 lifecycle stages', () => {
    assert.equal(CUSTOMER_RELATIONS.length, 5);
    const ids = CUSTOMER_RELATIONS.map((item) => item.id);
    assert.deepEqual(ids, ['prospect', 'new_follower', 'gift_follower', 'first_order', 'returning']);
    for (const item of CUSTOMER_RELATIONS) {
        assert.ok(item.displayName.length > 0);
        assert.ok(item.goal.length > 0);
    }
});
test('customer-cohort dictionary covers 8 DMP cohorts with definitions', () => {
    assert.equal(CUSTOMER_COHORTS.length, 8);
    for (const item of CUSTOMER_COHORTS) {
        assert.ok(item.definition.length > 0);
        assert.ok(item.salesHint.length > 0);
    }
});
test('trust-level dictionary covers 5 levels with behavior and strategy', () => {
    assert.equal(TRUST_LEVELS.length, 5);
    assert.deepEqual(TRUST_LEVELS.map((item) => item.level), [1, 2, 3, 4, 5]);
    for (const item of TRUST_LEVELS) {
        assert.ok(item.behavior.length > 0);
        assert.ok(item.strategy.length > 0);
    }
});
test('skin-concerns dictionary covers 6 categories with items', () => {
    assert.equal(SKIN_CONCERNS.length, 6);
    const allItems = SKIN_CONCERNS.flatMap((group) => group.items);
    assert.ok(allItems.length >= 20);
    for (const item of allItems) {
        assert.ok(item.length > 0);
        assert.ok(item.length <= 40, `item too long: ${item}`);
    }
});
test('product-scenario categories preserve all legacy 8 flat ids', () => {
    const legacyIds = PRODUCT_SCENARIOS.map((item) => item.id);
    assert.equal(legacyIds.length, 8);
    for (const legacyId of legacyIds) {
        const categoryId = PRODUCT_SCENARIO_LEGACY_CATEGORY_MAP[legacyId];
        assert.ok(categoryId !== undefined, `legacy scenario ${legacyId} has no category mapping`);
        assert.ok(PRODUCT_SCENARIO_CATEGORIES.some((category) => category.id === categoryId), `category ${categoryId} of ${legacyId} must exist`);
    }
    assert.ok(PRODUCT_SCENARIO_CATEGORIES.length >= 5);
});
test('learner override policy allows the new basic.* paths', () => {
    const newPaths = [
        'basic.customerRelation',
        'basic.trustLevel',
        'basic.customerCohort',
        'basic.city',
        'basic.purchaseCategory',
    ];
    for (const path of newPaths) {
        assert.ok(ALLOWED_OVERRIDE_PATH_PREFIXES.includes(path), `${path} must be allowed`);
    }
});
test('field metadata exposes the new v2 dictionaries', () => {
    const meta = service.getFieldMetadata();
    const basic = meta.basic;
    assert.equal(basic.customerRelations.length, 5);
    assert.equal(basic.customerCohorts.length, 8);
    assert.equal(basic.trustLevels.length, 5);
    assert.equal(basic.cityMaxLength, 30);
    assert.equal(basic.purchaseCategoryMaxLength, 50);
    const consumption = meta.consumption;
    assert.equal(consumption.skinTypes.some((s) => s.value === 'mixed_dry'), true);
    assert.equal(consumption.skinConcernsDictionary.length, 6);
    const presets = meta.presets;
    assert.equal(presets.productScenarioCategories.length, 5);
});
// =============================================================================
// 阶段 B 支撑：buildPersonaConfig 接收 v2 维度（快速创建通道）与两级场景 id
// =============================================================================
test('buildPersonaConfig merges v2 customer dimensions from preview input', () => {
    const config = service.buildPersonaConfig({
        ...BASE_INPUT,
        customerRelation: 'returning',
        purchaseCategory: '抗老精华',
        trustLevel: 4,
        customerCohort: 'precision_mom',
        city: '杭州',
    });
    const basic = config.basic ?? {};
    assert.equal(basic.customerRelation, 'returning');
    assert.equal(basic.purchaseCategory, '抗老精华');
    assert.equal(basic.trustLevel, 4);
    assert.equal(basic.customerCohort, 'precision_mom');
    assert.equal(basic.city, '杭州');
});
test('buildPersonaConfig maps new two-level scenario id to scene display name', () => {
    const config = service.buildPersonaConfig({
        ...BASE_INPUT,
        productScenarioId: 'children::成长饮',
    });
    assert.equal(config.conversation.productScenario, '成长饮');
});
test('buildPersonaConfig accepts every new category scene via encoded id', () => {
    for (const category of PRODUCT_SCENARIO_CATEGORIES) {
        for (const scene of category.scenes) {
            const config = service.buildPersonaConfig({
                ...BASE_INPUT,
                productScenarioId: `${category.id}::${scene}`,
            });
            assert.equal(config.conversation.productScenario, scene, `${category.id}::${scene}`);
        }
    }
});
test('buildPersonaConfig rejects unknown scenario id', () => {
    assert.throws(() => service.buildPersonaConfig({ ...BASE_INPUT, productScenarioId: 'children::不存在的场景' }), (error) => error.message === 'PERSONA_PRESET_NOT_FOUND');
});
test('preset catalog exposes v2 dictionaries to the C-end mini program', () => {
    const catalog = service.getPresetCatalog();
    assert.equal(catalog.customerRelations.length, 5);
    assert.equal(catalog.customerCohorts.length, 8);
    assert.equal(catalog.trustLevels.length, 5);
    assert.ok(catalog.skinTypes.some((s) => s.value === 'mixed_dry'));
    assert.equal(catalog.skinConcernsDictionary.length, 6);
    assert.ok(catalog.productScenarioCategories.length >= 5);
    assert.equal(catalog.cityMaxLength, 30);
    assert.equal(catalog.purchaseCategoryMaxLength, 50);
    for (const relation of catalog.customerRelations) {
        assert.ok(relation.value.length > 0 && relation.label.length > 0 && relation.goal.length > 0);
    }
});
