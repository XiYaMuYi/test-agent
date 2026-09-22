import {
  buildDefaultConfig,
  CUSTOMER_RELATIONS,
  CUSTOMER_COHORTS,
  TRUST_LEVELS,
  PRODUCT_SCENARIOS,
  PRODUCT_SCENARIO_CATEGORIES,
  PRODUCT_SCENARIO_LEGACY_CATEGORY_MAP,
  type PersonaConfig,
} from '@training/contracts';

const OCCUPATION_MAP: Record<string, string> = {
  '学生': '学生',
  '白领': '白领上班族',
  '自由职业': '自由职业者',
  '教师': '教师',
  '医生': '医疗工作者',
  '全职妈妈': '全职妈妈',
  '退休': '退休人士',
  '企业管理者': '企业管理者',
  '个体经营': '个体经营者',
};

function ageDescription(age: number): string {
  if (age >= 18 && age <= 25) return '年轻';
  if (age >= 26 && age <= 32) return '正处于事业上升期';
  if (age >= 33 && age <= 38) return '有丰富的生活阅历';
  if (age >= 39 && age <= 48) return '成熟稳重';
  if (age >= 49 && age <= 65) return '人生经验丰富';
  return '成熟';
}

const DIFFICULTY_RULES: Record<1 | 2 | 3 | 4, string> = {
  1: '保持友好，容易被打动，1-2个问题后就决定购买。',
  2: '提出一些常见疑虑，需要解释清楚后才会考虑。',
  3: '提出多个刁钻问题，频繁对比竞品品牌，需要强有力的说服。',
  4: '非常难缠，反复质疑价格和效果，提出不合理要求，几乎不可能被说服。',
};

const VERBOSITY_MAP: Record<string, string> = {
  brief: '说话简洁，每次回复不超过两三句话',
  normal: '正常交流长度',
  verbose: '喜欢说很多细节，每次回复较长，会跑题聊家常',
};

const GENDER_MAP: Record<string, string> = {
  female: '女性',
  male: '男性',
  unknown: '人',
};

const MARITAL_MAP: Record<string, string> = {
  single: '未婚',
  married: '已婚',
  unknown: '未知',
};

const INCOME_MAP: Record<string, string> = {
  low: '较低',
  medium: '中等',
  high: '较高',
};

const STYLE_MAP: Record<string, string> = {
  direct: '直接',
  gentle: '温和',
  strong: '强势',
  humorous: '幽默',
  serious: '严肃',
};

const EMOTION_LEVEL_MAP: Record<string, string> = {
  reserved: '含蓄',
  normal: '正常',
  expressive: '外露',
};

const DIALECT_MAP: Record<string, string> = {
  mandarin: '普通话',
  southwest: '西南方言',
  northeast: '东北话',
  cantonese: '粤语',
  wu: '吴语',
};

const DECISION_CYCLE_MAP: Record<string, string> = {
  impulse: '冲动型',
  same_day: '当日决策',
  few_days: '几天考虑',
  long_term: '长期比较',
};

const BRAND_LOYALTY_MAP: Record<string, string> = {
  low: '低',
  medium: '中',
  high: '高',
};

const PURCHASE_CHANNEL_MAP: Record<string, string> = {
  wechat_private: '微信私域',
  ecommerce: '电商平台',
  offline: '线下门店',
  live: '直播间',
};

const INGREDIENT_FOCUS_MAP: Record<string, string> = {
  none: '不关注',
  normal: '一般关注',
  focused: '非常关注',
};

const COMPETITOR_COMPARISON_MAP: Record<string, string> = {
  never: '从不',
  occasionally: '偶尔',
  frequently: '经常',
};

const SKIN_TYPE_MAP: Record<string, string> = {
  dry: '干性',
  oily: '油性',
  combination: '混合性',
  sensitive: '敏感性',
  normal: '中性',
  mixed_dry: '混干性',
  mixed_oily: '混油性',
};

interface DimensionLabel {
  readonly label: string;
  readonly low: string;
  readonly high: string;
}

const PERSONALITY_DIMENSIONS: Array<[keyof PersonaConfig['personality'], DimensionLabel]> = [
  ['friendliness', { label: '友好度', low: '冷淡疏离', high: '热情亲切' }],
  ['patience', { label: '耐心度', low: '急躁', high: '耐心倾听' }],
  ['priceSensitivity', { label: '价格敏感度', low: '不在意价格', high: '非常在意价格' }],
  ['decisiveness', { label: '决策果断度', low: '犹豫不决', high: '果断干脆' }],
  ['skepticism', { label: '怀疑程度', low: '容易相信', high: '高度警惕' }],
  ['socialActivity', { label: '社交活跃度', low: '内向安静', high: '健谈外放' }],
  ['emotionalVolatility', { label: '情绪稳定性', low: '情绪非常稳定', high: '容易情绪化' }],
];

function personalityBlock(persona: PersonaConfig): string {
  const lines: string[] = [];
  const p = persona.personality;
  for (const [key, meta] of PERSONALITY_DIMENSIONS) {
    const val = p[key];
    let desc: string;
    if (val < 35) desc = `偏${meta.low}`;
    else if (val > 65) desc = `偏${meta.high}`;
    else desc = '中等';
    lines.push(`  - ${meta.label}：${val}/100（${desc}）`);
  }
  return lines.join('\n');
}

function behaviorRules(persona: PersonaConfig): string[] {
  const rules: string[] = [];
  const p = persona.personality;

  if (p.friendliness > 70) rules.push('- 你比较热情，愿意主动聊家常、分享生活');
  else if (p.friendliness < 30) rules.push('- 你比较冷淡，不太愿意多说，回复简短');

  if (p.patience < 30) rules.push('- 你耐心很差，销售稍显啰嗦、绕圈子或答不上来时就会不耐烦，想尽快结束');
  else if (p.patience > 70) rules.push('- 你很有耐心，愿意听销售慢慢讲解、多方比较，不急于结束对话');

  if (p.priceSensitivity > 70) rules.push('- 你会反复问价格，要求打折或赠品，预算有限');
  if (p.skepticism > 70) rules.push('- 你不太信任推销，会质疑每个说法，要求看证据');

  if (p.decisiveness < 30) rules.push("- 你做决定很慢，喜欢说'再考虑考虑'、'我回去想想'");
  if (p.decisiveness > 75) rules.push('- 你做决定很快，要么当场买要么直接走');

  if (p.emotionalVolatility > 70) rules.push('- 你情绪波动大，容易被说动也容易生气');

  if (p.socialActivity > 70) rules.push('- 你很健谈，会主动聊很多家常和生活琐事');
  else if (p.socialActivity < 30) rules.push('- 你不太爱说话，对方问什么才回答什么');

  const cc = persona.consumption;
  const compRule: Record<string, string> = {
    frequently: '- 你会频繁提到其他品牌进行对比',
    occasionally: '- 你偶尔会提到其他品牌',
    never: '- 你基本不会拿其他品牌来对比，只关注当前这款是否适合自己',
  };
  if (cc.competitorComparison !== undefined) {
    const rule = compRule[cc.competitorComparison];
    if (rule !== undefined) rules.push(rule);
  }

  const ingRule: Record<string, string> = {
    focused: '- 你会逐个问每种成分的作用和来源',
    normal: '- 你会适当关注成分和功效，但不会逐一深究',
    none: '- 你不太关心成分，更看重效果和口碑',
  };
  if (cc.ingredientFocus !== undefined) {
    const rule = ingRule[cc.ingredientFocus];
    if (rule !== undefined) rules.push(rule);
  }

  if (persona.conversation.customNotes !== undefined && persona.conversation.customNotes.length > 0) {
    rules.push(`- ${persona.conversation.customNotes}`);
  }

  return rules;
}

function skinHealthBlock(persona: PersonaConfig): string {
  const lines: string[] = [];
  const c = persona.consumption;
  if (c.skinType !== undefined) {
    lines.push(`  - 肤质：${SKIN_TYPE_MAP[c.skinType] ?? c.skinType}`);
  }
  if (c.skinConcerns !== undefined && c.skinConcerns.length > 0) {
    lines.push(`  - 皮肤问题：${[...c.skinConcerns].join('、')}`);
  }
  if (c.healthGoals !== undefined && c.healthGoals.length > 0) {
    lines.push(`  - 健康关注：${[...c.healthGoals].join('、')}`);
  }
  if (c.allergies !== undefined && c.allergies.length > 0) {
    lines.push(`  - 过敏史：${[...c.allergies].join('、')}`);
  }
  if (c.currentProducts !== undefined && c.currentProducts.length > 0) {
    lines.push(`  - 正在使用：${c.currentProducts}`);
  }
  if (lines.length === 0) return '';
  return '\n【皮肤/健康状况】\n' + lines.join('\n');
}

/**
 * 客户画像情境 block（v2 设计 §5.1，商学院反馈）：把生命周期 / 信任度 / 人群 /
 * 城市 / 产品范围注入系统提示，产生可观察的话术差异。
 *
 * 全部字段可选：未设置的片段不渲染，旧模板 / 旧快照生成的 prompt 与升级前完全一致。
 * 信任度只影响话术与推进策略（行为约束），不进评分规则。
 */
function customerSituationBlock(persona: PersonaConfig): string {
  const basic = persona.basic ?? {};
  const lines: string[] = [];

  // 【客户情境】生命周期 + 信任度 + 人群 + 城市
  const situation: string[] = [];
  const relation = CUSTOMER_RELATIONS.find((item) => item.id === basic.customerRelation);
  if (relation !== undefined) situation.push(relation.displayName);
  const trust = TRUST_LEVELS.find((item) => item.level === basic.trustLevel);
  if (trust !== undefined) situation.push(`信任度 ${trust.level}/5（${trust.displayName}）`);
  const cohort = CUSTOMER_COHORTS.find((item) => item.id === basic.customerCohort);
  if (cohort !== undefined) situation.push(`${cohort.displayName}人群（${cohort.definition}）`);
  if (typeof basic.city === 'string' && basic.city.length > 0) situation.push(`城市：${basic.city}`);
  if (situation.length > 0) lines.push(`【客户情境】${situation.join('；')}。`);

  // 【本单目标】生命周期目标 + 信任推进策略 + 信任度行为约束
  const goals: string[] = [];
  if (relation !== undefined) goals.push(`按客户关系：${relation.goal}`);
  if (trust !== undefined) goals.push(`按信任度：${trust.strategy}`);
  if (basic.trustLevel !== undefined) {
    const trustRule = basic.trustLevel <= 2
      ? '客户戒备心强：先讲资质、案例与售后承诺建立信任，不急于推销'
      : basic.trustLevel >= 4
        ? '客户信任度高：可自然推进成交、升单、套餐或复购推荐'
        : '客户信任度中等：正常介绍产品价值，循序渐进';
    goals.push(`信任度行为：${trustRule}`);
  }
  if (goals.length > 0) lines.push(`【本单目标】${goals.join('；')}。`);

  // 【产品范围】类目归属 + 经常购买品类 + 肤质 + 皮肤问题。
  // 场景本身已由【你的身份】覆盖（"正在考虑购买 X 相关产品"），这里只补充
  // 类目归属（新场景直接命中 / 旧 8 场景经 legacy 映射）与新维度；
  // 纯旧场景且无任何新维度时整段不渲染（旧模板 prompt 零差异）。
  const scope: string[] = [];
  const scenario = persona.conversation.productScenario;
  if (scenario !== undefined && scenario.length > 0) {
    let categoryLabel: string | undefined;
    const cat = PRODUCT_SCENARIO_CATEGORIES.find((item) => (item.scenes as readonly string[]).includes(scenario));
    if (cat !== undefined) {
      categoryLabel = cat.displayName;
    } else {
      // 旧 8 场景快照存 displayName：displayName → legacy id → 5 大类 id
      const legacy = PRODUCT_SCENARIOS.find((item) => item.displayName === scenario);
      const legacyId = legacy?.id;
      const catId =
        legacyId !== undefined
          ? PRODUCT_SCENARIO_LEGACY_CATEGORY_MAP[legacyId as keyof typeof PRODUCT_SCENARIO_LEGACY_CATEGORY_MAP]
          : undefined;
      const legacyCat = catId !== undefined ? PRODUCT_SCENARIO_CATEGORIES.find((item) => item.id === catId) : undefined;
      if (legacyCat !== undefined) categoryLabel = legacyCat.displayName;
    }
    if (categoryLabel !== undefined) scope.push(`${categoryLabel}类产品（${scenario}）`);
  }
  if (typeof basic.purchaseCategory === 'string' && basic.purchaseCategory.length > 0) {
    scope.push(`经常购买：${basic.purchaseCategory}`);
  }
  const c = persona.consumption;
  if (c.skinType !== undefined) scope.push(`肤质：${SKIN_TYPE_MAP[c.skinType] ?? c.skinType}`);
  if (c.skinConcerns !== undefined && c.skinConcerns.length > 0) scope.push(`皮肤问题：${[...c.skinConcerns].join('、')}`);
  if (scope.length > 0) lines.push(`【产品范围】${scope.join('；')}。`);

  return lines.length === 0 ? '' : '\n' + lines.join('\n');
}

/**
 * 根据客户画像动态生成多样化开场白示例。
 * 按职业/年龄/产品场景/沟通风格生成不同切入角度的开场白，
 * 避免 LLM 每次都只说"你好"。示例只作参考，LLM 应在此基础上自由发挥。
 */
function openingExamples(persona: PersonaConfig): string {
  const age = persona.age;
  const occupation = OCCUPATION_MAP[persona.occupation] ?? persona.occupation;
  const scenario = persona.conversation.productScenario || '护肤';
  const style = persona.communication.style;

  const examples: string[] = [];

  // 1. 生活场景型：从一个真实的生活片段切入
  if (occupation === '全职妈妈') {
    examples.push('"你好呀，我家孩子最近皮肤老是干干的"');
    examples.push('"在吗？带娃熬夜熬的我这脸都没法看了"');
  } else if (occupation === '白领上班族') {
    examples.push('"你好，最近天天加班，皮肤状态好差"');
    examples.push('"哈喽，天天对着电脑，感觉脸都黄了"');
  } else if (occupation === '学生') {
    examples.push('"你好，我是学生党，预算不多想看看基础的"');
    examples.push('"在吗？最近熬夜复习，冒了好多痘"');
  } else if (occupation === '退休人士') {
    examples.push('"你好，我这个年纪了，想看看保养的"');
    examples.push('"在吗？最近感觉皮肤越来越松了"');
  } else {
    examples.push('"你好，最近换季皮肤有点干"');
    examples.push('"在吗？感觉最近皮肤状态不太好"');
  }

  // 2. 模糊需求型：说一个大方向，不暴露具体细节
  examples.push(`"你好，想看看有没有适合${age}岁左右用的"`);
  examples.push('"哈喽，最近想好好保养一下，有什么推荐吗"');

  // 3. 直接问题型：问一个具体但不暴露全部需求的问题
  examples.push(`"你好，你们家${scenario}类的产品有哪些呀"`);
  examples.push('"在吗？想问下敏感肌能不能用你们家的"');

  // 4. 情绪表达型：带一点情绪色彩
  if (style === 'humorous') {
    examples.push('"你好，再不好好保养我就要成黄脸婆了哈哈"');
  } else if (style === 'direct') {
    examples.push('"你好，直接说，你们家什么产品卖得最好"');
  } else {
    examples.push('"你好，最近皮肤状态好差，愁死我了"');
  }

  // 5. 简单打招呼型（保留，但放在最后，不作为首选）
  examples.push('"你好"');
  examples.push('"在吗"');

  return examples.map((e, i) => `${i + 1}. ${e}`).join('\n');
}

/**
 * Build the persona-specific system prompt section. Pure function: no I/O,
 * no randomness. Given the same PersonaConfig it always produces the same
 * string, which keeps prompt caching warm and makes tests deterministic.
 *
 * Defensive by contract: it accepts a complete PersonaConfig OR a partial /
 * empty / nullish snapshot (legacy assigned sessions and older rows may persist
 * `persona_snapshot = '{}'`). Missing blocks/fields fall back to the shared
 * defaults instead of throwing, so prompt building never 500s on stale data.
 */
export function buildPersonaSystemSection(
  rawPersona: PersonaConfig | Partial<PersonaConfig> | null | undefined,
): string {
  // Deep-normalize so null / '{}' / partial snapshots (legacy assigned sessions,
  // older rows) never crash prompt building: every nested block/field is filled
  // from the shared defaults, while any provided value is preserved.
  const persona = buildDefaultConfig(rawPersona ?? {});
  const age = persona.age;
  const occupation = OCCUPATION_MAP[persona.occupation] ?? persona.occupation;
  const ageDesc = ageDescription(age);
  const difficulty = persona.conversation.difficulty;
  const difficultyRules = DIFFICULTY_RULES[difficulty] ?? DIFFICULTY_RULES[2];
  const verbosityDesc = VERBOSITY_MAP[persona.communication.verbosity] ?? '正常交流长度';

  const genderDesc = GENDER_MAP[persona.gender ?? 'unknown'] ?? '人';
  const maritalDesc = MARITAL_MAP[persona.basic?.maritalStatus ?? 'unknown'] ?? '未知';
  const incomeDesc = INCOME_MAP[persona.basic?.incomeLevel ?? 'medium'] ?? '中等';

  const dialect = persona.communication.dialect;
  const dialectLine =
    dialect !== undefined && dialect !== 'mandarin'
      ? `\n- 方言倾向：${DIALECT_MAP[dialect] ?? dialect}`
      : '';

  const catchphrase = persona.communication.catchphrase;
  const catchphraseLine =
    catchphrase !== undefined && catchphrase.length > 0 ? `\n- 口头禅：经常说'${catchphrase}'` : '';

  const budgetDesc = `${persona.consumption.budgetMin}-${persona.consumption.budgetMax}元`;
  const decisionCycleDesc = DECISION_CYCLE_MAP[persona.consumption.decisionCycle] ?? persona.consumption.decisionCycle;
  const brandLoyaltyDesc = BRAND_LOYALTY_MAP[persona.consumption.brandLoyalty] ?? persona.consumption.brandLoyalty;
  const purchaseChannelDesc =
    persona.consumption.purchaseChannel !== undefined
      ? (PURCHASE_CHANNEL_MAP[persona.consumption.purchaseChannel] ?? persona.consumption.purchaseChannel)
      : '不限';

  const skinHealth = skinHealthBlock(persona);
  const customerSituation = customerSituationBlock(persona);

  const behavior = behaviorRules(persona);
  const behaviorBlock = behavior.length > 0 ? behavior.join('\n') : '- 你是一个普通的消费者，表现正常';

  const openingRule =
    persona.conversation.openingMode === 'ai_first'
      ? '2. **开场白要有个性**：AI 先开口，要自然、符合你的身份和当前情境。可以从生活场景、模糊需求、直接问题或情绪表达切入，不要总是说"你好"。但不要一次性倒出所有具体信息（年龄、症状、预算等），那些要被销售引导才说。每次对话的开场白都要不同。'
      : persona.conversation.openingMode === 'wait_learner'
        ? '2. **等对方先开口**：你先不要说话，等学员（销售员）先打招呼，然后你再以顾客身份简短回应。回应要有个性，符合你的身份，不要总是说"你好"。'
        : '2. **开场白要有个性**：要自然、符合你的身份和当前情境。可以从生活场景、模糊需求、直接问题或情绪表达切入，不要总是说"你好"。但不要一次性倒出所有具体信息。每次对话的开场白都要不同。';

  const background =
    persona.conversation.background.length > 0
      ? persona.conversation.background
      : '无特殊背景，你是一个普通的潜在客户。';

  const opening = openingExamples(persona);

  const prompt = `${customerSituation}
【你的身份】
你是一个${ageDesc}的${age}岁${occupation}${genderDesc}。
你正在考虑购买${persona.conversation.productScenario}相关的产品。
你的月收入大约是${incomeDesc}水平，婚姻状况：${maritalDesc}。

【性格特征】
${personalityBlock(persona)}

【沟通风格】
- 语言风格：${STYLE_MAP[persona.communication.style] ?? persona.communication.style}
- 说话长度：${verbosityDesc}
- 情绪表达：${EMOTION_LEVEL_MAP[persona.communication.emotionLevel] ?? persona.communication.emotionLevel}${dialectLine}${catchphraseLine}

【消费习惯】
- 预算范围：${budgetDesc}
- 决策风格：${decisionCycleDesc}
- 品牌忠诚度：${brandLoyaltyDesc}
- 购买渠道偏好：${purchaseChannelDesc}
- 成分关注度：${INGREDIENT_FOCUS_MAP[persona.consumption.ingredientFocus ?? 'normal'] ?? '一般关注'}
- 竞品对比倾向：${COMPETITOR_COMPARISON_MAP[persona.consumption.competitorComparison ?? 'occasionally'] ?? '偶尔'}${skinHealth}

【对话规则 - 极其重要】
1. 你是来咨询产品的客户，不是销售
${openingRule}
3. **不要一次性说出所有情况**：你的需求、症状、预算等信息需要被销售引导才说
4. **像真实微信聊天**：每次回复1-2句话，口语化，不要写长段落
5. **被动回应**：等销售问你问题再回答，不要主动倒豆子
6. **只说中文**：绝对不要说英文或其他外语，你是中国客户
7. 根据对方的回答决定是否购买
8. 保持角色，不要跳出角色说"我是AI"之类的话
9. ${difficultyRules}

【错误示范 - 绝对不要这样】
❌ "你好，我今年58岁，刚退休，膝盖不好，皮肤干，免疫力差，预算几百块，想看看保健品"
这是问卷调查，不是真实客户！
❌ 每次都只说"你好"或"在吗"，没有任何个性和情境感
真实客户不会这样说话！

【开场白参考 - 结合你的身份从中选择或自由发挥，不要重复】
${opening}

【正确对话节奏示范】
✅ 开场："你好，最近换季皮肤有点干"
✅ 销售问"您是什么肤质呀"再回答"我是混合皮，T区容易出油"
✅ 销售推荐产品后说"这个多少钱呀，有点贵"
✅ 不要主动说"我预算300块"，等销售问了再说

【客户离开的触发条件】
如果销售人员出现以下情况，你应该立即表示要离开：
1. 使用侮辱性语言
2. 态度极其恶劣
3. 明显不耐烦
4. 连续两次无视你的需求
5. 给出明显不合理的价格

离开时回复必须包含："算了"、"不买了"、"再见"、"去别家"等。

【行为指引】
${behaviorBlock}

【对话背景】
${background}

现在请开始对话，记住：开场白要有个性、符合你的身份，不要总是说"你好"，但也不要一次性倒出所有需求！`;

  return prompt.trim();
}
