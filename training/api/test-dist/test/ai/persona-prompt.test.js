import assert from 'node:assert/strict';
import test from 'node:test';
import { buildPersonaSystemSection } from '../../src/ai/persona-prompt.js';
function basePersona(overrides = {}) {
    return {
        id: 'persona-1',
        name: '李阿姨',
        basedOnCard: 'card-1',
        age: 42,
        gender: 'female',
        occupation: '白领',
        basic: { maritalStatus: 'married', incomeLevel: 'medium' },
        personality: {
            friendliness: 50,
            patience: 50,
            priceSensitivity: 50,
            decisiveness: 50,
            skepticism: 50,
            socialActivity: 50,
            emotionalVolatility: 50,
        },
        communication: {
            style: 'gentle',
            verbosity: 'normal',
            emotionLevel: 'normal',
        },
        consumption: {
            budgetMin: 200,
            budgetMax: 500,
            decisionCycle: 'few_days',
            brandLoyalty: 'medium',
        },
        conversation: {
            difficulty: 2,
            maxTurns: 20,
            background: '她最近经常加班，皮肤状态不太好。',
            productScenario: '护肤',
        },
        ...overrides,
    };
}
test('基础人设段包含职业、年龄、性别', () => {
    const out = buildPersonaSystemSection(basePersona());
    assert.match(out, /42岁/);
    assert.match(out, /白领上班族/);
    assert.match(out, /女性/);
    assert.match(out, /已婚/);
    assert.match(out, /中等.*水平/);
    assert.match(out, /护肤/);
});
test('七维性格区间文案：<35偏低、>65偏高、中间中等', () => {
    const lowPersona = basePersona({
        personality: {
            friendliness: 20,
            patience: 20,
            priceSensitivity: 20,
            decisiveness: 20,
            skepticism: 20,
            socialActivity: 20,
            emotionalVolatility: 20,
        },
    });
    const lowOut = buildPersonaSystemSection(lowPersona);
    assert.match(lowOut, /友好度.*20\/100.*偏冷淡疏离/);
    assert.match(lowOut, /耐心度.*20\/100.*偏急躁/);
    assert.match(lowOut, /价格敏感度.*20\/100.*偏不在意价格/);
    assert.match(lowOut, /决策果断度.*20\/100.*偏犹豫不决/);
    assert.match(lowOut, /怀疑程度.*20\/100.*偏容易相信/);
    assert.match(lowOut, /社交活跃度.*20\/100.*偏内向安静/);
    assert.match(lowOut, /情绪稳定性.*20\/100.*偏情绪非常稳定/);
    const midPersona = basePersona();
    const midOut = buildPersonaSystemSection(midPersona);
    assert.match(midOut, /友好度.*50\/100.*中等/);
    assert.match(midOut, /耐心度.*50\/100.*中等/);
    const highPersona = basePersona({
        personality: {
            friendliness: 80,
            patience: 80,
            priceSensitivity: 80,
            decisiveness: 80,
            skepticism: 80,
            socialActivity: 80,
            emotionalVolatility: 80,
        },
    });
    const highOut = buildPersonaSystemSection(highPersona);
    assert.match(highOut, /友好度.*80\/100.*偏热情亲切/);
    assert.match(highOut, /耐心度.*80\/100.*偏耐心倾听/);
    assert.match(highOut, /价格敏感度.*80\/100.*偏非常在意价格/);
    assert.match(highOut, /决策果断度.*80\/100.*偏果断干脆/);
    assert.match(highOut, /怀疑程度.*80\/100.*偏高度警惕/);
    assert.match(highOut, /社交活跃度.*80\/100.*偏健谈外放/);
    assert.match(highOut, /情绪稳定性.*80\/100.*偏容易情绪化/);
});
test('难度1-4指令正确生成', () => {
    const d1 = buildPersonaSystemSection(basePersona({ conversation: { difficulty: 1, maxTurns: 20, background: '', productScenario: '护肤' } }));
    assert.match(d1, /1-2个问题后就决定购买/);
    const d2 = buildPersonaSystemSection(basePersona({ conversation: { difficulty: 2, maxTurns: 20, background: '', productScenario: '护肤' } }));
    assert.match(d2, /提出一些常见疑虑/);
    const d3 = buildPersonaSystemSection(basePersona({ conversation: { difficulty: 3, maxTurns: 20, background: '', productScenario: '护肤' } }));
    assert.match(d3, /频繁对比竞品品牌/);
    const d4 = buildPersonaSystemSection(basePersona({ conversation: { difficulty: 4, maxTurns: 20, background: '', productScenario: '护肤' } }));
    assert.match(d4, /几乎不可能被说服/);
});
test('wait_learner时包含"等对方先开口"', () => {
    const out = buildPersonaSystemSection(basePersona({
        conversation: {
            difficulty: 2,
            maxTurns: 20,
            background: '',
            productScenario: '护肤',
            openingMode: 'wait_learner',
        },
    }));
    assert.match(out, /等对方先开口/);
});
test('ai_first时包含"AI 先向学员打招呼"', () => {
    const out = buildPersonaSystemSection(basePersona({
        conversation: {
            difficulty: 2,
            maxTurns: 20,
            background: '',
            productScenario: '护肤',
            openingMode: 'ai_first',
        },
    }));
    assert.match(out, /AI 先向学员打招呼/);
});
test('口头禅/方言/购买渠道等新字段正确注入', () => {
    const out = buildPersonaSystemSection(basePersona({
        communication: {
            style: 'humorous',
            verbosity: 'verbose',
            emotionLevel: 'expressive',
            dialect: 'northeast',
            catchphrase: '整挺好',
        },
        consumption: {
            budgetMin: 100,
            budgetMax: 300,
            decisionCycle: 'impulse',
            brandLoyalty: 'low',
            purchaseChannel: 'live',
            ingredientFocus: 'focused',
            competitorComparison: 'frequently',
        },
    }));
    assert.match(out, /口头禅：经常说'整挺好'/);
    assert.match(out, /方言倾向：东北话/);
    assert.match(out, /购买渠道偏好：直播间/);
    assert.match(out, /你会频繁提到其他品牌进行对比/);
    assert.match(out, /你会逐个问每种成分的作用和来源/);
    assert.match(out, /冲动型/);
});
test('离开触发条件完整（5种情况 + 离开信号词）', () => {
    const out = buildPersonaSystemSection(basePersona());
    assert.match(out, /使用侮辱性语言/);
    assert.match(out, /态度极其恶劣/);
    assert.match(out, /明显不耐烦/);
    assert.match(out, /连续两次无视你的需求/);
    assert.match(out, /给出明显不合理的价格/);
    assert.match(out, /算了/);
    assert.match(out, /不买了/);
    assert.match(out, /再见/);
    assert.match(out, /去别家/);
});
test('错误/正确示范存在', () => {
    const out = buildPersonaSystemSection(basePersona());
    assert.match(out, /错误示范/);
    assert.match(out, /❌/);
    assert.match(out, /正确示范/);
    assert.match(out, /✅/);
});
test('customNotes注入到行为指引', () => {
    const out = buildPersonaSystemSection(basePersona({
        conversation: {
            difficulty: 2,
            maxTurns: 20,
            background: '',
            productScenario: '护肤',
            customNotes: '她对酒精成分过敏，不要推荐含酒精产品',
        },
    }));
    assert.match(out, /她对酒精成分过敏/);
});
test('肤质/健康信息正确渲染', () => {
    const out = buildPersonaSystemSection(basePersona({
        consumption: {
            budgetMin: 200,
            budgetMax: 500,
            decisionCycle: 'few_days',
            brandLoyalty: 'medium',
            skinType: 'sensitive',
            skinConcerns: ['泛红', '干燥'],
            healthGoals: ['抗老'],
            allergies: ['酒精', '香精'],
            currentProducts: '某牌保湿霜',
        },
    }));
    assert.match(out, /皮肤\/健康/);
    assert.match(out, /敏感性/);
    assert.match(out, /泛红、干燥/);
    assert.match(out, /抗老/);
    assert.match(out, /酒精、香精/);
    assert.match(out, /某牌保湿霜/);
});
// 回归：B 端指派旧链路 / 历史会话的 persona_snapshot 可能是 null、'{}' 或缺块的残缺对象，
// 人设段构建必须安全降级，绝不能抛 TypeError（曾导致这些会话发消息直接 500）。
for (const [label, input] of [
    ['null', null],
    ['undefined', undefined],
    ['空对象 {}', {}],
    ['只有 conversation 块', { conversation: { difficulty: 2 } }],
    ['只有 personality 块', { personality: { friendliness: 80 } }],
]) {
    test(`残缺画像快照不抛错并安全降级：${label}`, () => {
        let out;
        assert.doesNotThrow(() => {
            out = buildPersonaSystemSection(input);
        });
        assert.ok(typeof out === 'string' && out.length > 0, '必须产出非空人设段');
        // 即使缺数据也保留核心骨架，保证模型仍被约束为顾客角色。
        assert.match(out, /【你的身份】/);
        assert.match(out, /【对话规则/);
    });
}
// =============================================================================
// v2 客户画像情境注入（商学院反馈，persona-prompt §5.1）
// =============================================================================
test('v2 情境 block 渲染生命周期/信任度/人群/城市', () => {
    const out = buildPersonaSystemSection(basePersona({
        basic: {
            maritalStatus: 'married',
            incomeLevel: 'medium',
            customerRelation: 'returning',
            trustLevel: 4,
            customerCohort: 'precision_mom',
            city: '杭州',
            purchaseCategory: '护肤精华',
        },
        conversation: { ...basePersona().conversation, productScenario: '抗老咨询' },
        consumption: { ...basePersona().consumption, skinType: 'mixed_dry', skinConcerns: ['黄褐斑', '痘印'] },
    }));
    assert.match(out, /【客户情境】/);
    assert.match(out, /老客户/);
    assert.match(out, /信任度 4\/5（个人信任）/);
    assert.match(out, /精致妈妈人群/);
    assert.match(out, /城市：杭州/);
    assert.match(out, /【本单目标】/);
    assert.match(out, /升级推荐/); // returning.goal
    assert.match(out, /可直入成交/); // trustLevel>=4 行为约束
    assert.match(out, /【产品范围】/);
    assert.match(out, /日常护肤类产品（抗老咨询）/);
    assert.match(out, /经常购买：护肤精华/);
    assert.match(out, /混干性/);
    assert.match(out, /黄褐斑、痘印/);
});
test('信任度 1-2 级注入先建信任约束，且不出现在 4-5 级', () => {
    const low = buildPersonaSystemSection(basePersona({ basic: { maritalStatus: 'married', incomeLevel: 'medium', customerRelation: 'prospect', trustLevel: 1 } }));
    assert.match(low, /戒备心强/);
    assert.match(low, /不急于推销/);
    const high = buildPersonaSystemSection(basePersona({ basic: { maritalStatus: 'married', incomeLevel: 'medium', customerRelation: 'returning', trustLevel: 5 } }));
    assert.match(high, /可自然推进成交/);
    assert.doesNotMatch(high, /戒备心强/);
});
test('无 v2 字段时情境 block 不渲染（旧模板零影响）', () => {
    const out = buildPersonaSystemSection(basePersona());
    assert.doesNotMatch(out, /【客户情境】/);
    assert.doesNotMatch(out, /【本单目标】/);
    assert.doesNotMatch(out, /【产品范围】/);
    assert.match(out, /【你的身份】/); // 核心骨架仍在
});
