import type { Migration } from './migration.types.js';

/**
 * 私域经营能力评分模型（8 维，配置驱动 + 客户阶段自适应）。
 *
 * 背景：旧的 5 维（需求挖掘/产品准确性/异议/情绪/成交）是“销售话术考试”视角。
 * 新模型以“帮客户解决问题的能力”为第一核心，覆盖私域 1v1 经营的完整能力面，并由
 * worker 的 ContextAwareEvaluationReportGenerator 结合客户画像阶段与产品/禁忌知识
 * 做语义评分（非关键词匹配）。
 *
 * 本迁移对“已存在评分维度”的每个组织：
 * 1. upsert 8 个新维度（按 (organization_id, code) 幂等）；
 * 2. 停用旧 5 维（status=inactive，保留行以便回滚）并从模板解绑；
 * 3. 把 8 个新维度按 sort_order 挂到该组织所有 active 评分模板（默认模板）。
 *
 * 可重复执行；down 恢复旧 5 维并停用新维度。
 */
export const privateDomainScoringModelMigration: Migration = {
  id: '0024_private_domain_scoring_model',
  description:
    'Introduce the 8-dimension private-domain capability scoring model (problem-solving first), retire the legacy 5 dimensions, and relink active scoring templates.',

  async up(database): Promise<void> {
    const legacyCodes =
      "('needs_discovery','product_accuracy','objection_handling','emotion_management','closing_ability')";
    const newCodes =
      "('problem_solving','professionalism','needs_insight','trust_building','closing','rapport_stickiness','campaign_timeliness','communication_experience')";

    // 1. 对每个已有评分维度的组织，upsert 新 8 维。
    await database.query(`
      WITH defs(code, name, description, weight, deps, sort_order, llm_prompt, keywords) AS (
        VALUES
          ('problem_solving','问题解决力',
           $$第一核心。学员是否真正听懂客户当下的问题与诉求，给出对症、可执行、客户听得懂并愿意接受的解决方案；不追求话术面面俱到，而看问题有没有被有效解决。$$,
           30, '["products","symptom_efficacy","contraindications"]'::jsonb, 1,
           $$以“帮客户解决问题”为最高标准：先看学员是否抓住客户真实困扰（皮肤问题/健康目标/顾虑），再看方案是否对症、可落地、客户能理解接受。客户意思被接住、方向正确就应给高分，不要求把卖点逐条讲全，不因没说某个词扣分；答非所问、回避问题、方案与诉求无关则低分。须对照产品事实判断对症与否，乱推荐、踩禁忌在本维度重扣。$$,
           '["解决","适合","建议","针对","可以用","方案","您这个"]'::jsonb),
          ('professionalism','专业度',
           $$产品功效、成分、用法、适用与禁忌人群讲得是否准确清楚；不编造、不夸大、不把护肤品/食品说成治病。高成分关注客户、老客户尤其看重。$$,
           15, '["products","contraindications"]'::jsonb, 2,
           $$严格依据产品事实参考判断：功效、成分、用法、适用肤质/人群是否与知识库一致。编造成分、夸大功效、宣称治病或绝对安全、张冠李戴属硬伤，本维度大幅扣分并在红线标注；客户成分关注高或为老客户时标准从严。讲得通俗准确即可，不堆术语。$$,
           '["成分","功效","适合肤质","用法","浓度","含"]'::jsonb),
          ('needs_insight','需求洞察与客户分层',
           $$能否判断客户是谁、处于私域关系的哪个阶段、真实需求是什么，并据此调整沟通，而不是对所有人套同一套话术。$$,
           12, '["symptom_efficacy"]'::jsonb, 3,
           $$看学员是否通过提问/倾听识别客户类型（陌生潜客/新粉/礼品粉/首单/老客）、信任程度与真实诉求，并据此调整策略：老客不必重新破冰、应直接进入专业咨询；礼品粉要挖出真实需求；新客要先了解情况。识别准确、分层应对得当给高分，机械走流程、无视客户阶段则低分。$$,
           '["什么肤质","之前用过","第一次","主要想","您是","需求"]'::jsonb),
          ('trust_building','信任建立',
           $$是否真诚、专业、有温度地建立与维护信任，持续输出有用价值而非硬推群发；低信任客户先建信任，老客户重在维护深化。$$,
           12, '["none"]'::jsonb, 4,
           $$依据客户初始信任度判断：低信任客户是否先给资质/案例/售后承诺、输出有用内容而非急于推销；高信任老客户是否自然维护、不破坏既有信任。真诚、站在客户角度给建议给高分；群发感、套路、硬推、夸大其词扣分。$$,
           '["放心","案例","售后","很多客户","保证","我自己也"]'::jsonb),
          ('closing','成交推进与连带',
           $$是否在合适时机自然推进成交、给出搭配/连带建议；不强逼、不漏单，决策周期长的客户不急于逼单。$$,
           10, '["product_associations"]'::jsonb, 5,
           $$结合客户决策周期与购买信号判断推进是否合时宜：客户已认可、问题已解决时，是否自然给出下单/套餐/搭配建议；客户尚犹豫或决策周期长时，是否给空间、做铺垫而非硬逼。强逼引起反感扣分，时机成熟却完全不推进、漏掉合理连带也扣分。$$,
           '["下单","试试","搭配","套餐","活动价","复购","给您留"]'::jsonb),
          ('rapport_stickiness','联系与粘性',
           $$破冰、日常互动、情绪接住、建立私域联系与粘性。对陌生/新粉关键；对已是老客户、高信任客户通常无需破冰，本维度可判不适用。$$,
           10, '["none"]'::jsonb, 6,
           $$仅当客户处于关系前段（陌生潜客/新粉/礼品粉或信任度低）时重点考察：开场是否自然、有没有建立联系、让客户愿意继续聊。对老客户/高信任客户判“不适用”，不要因没有破冰话术而扣分。$$,
           '["在吗","您好","我是","朋友圈","回头客","常来"]'::jsonb),
          ('campaign_timeliness','营销活动与时效',
           $$是否准确、适时地传递活动政策、优惠、产品时效等信息，抓住客户决策窗口；不错讲、不滥用活动施压。$$,
           8, '["none"]'::jsonb, 7,
           $$看学员是否在客户有购买意向时准确说明活动/优惠/时效并用对时机促成决策；讲错、虚构活动、或与客户问题无关地硬塞活动信息扣分。对话未涉及活动时不因没提活动而扣分，可给中性偏上。$$,
           '["活动","优惠","限时","赠品","会员","今天","截止"]'::jsonb),
          ('communication_experience','沟通体验',
           $$微信私聊的语气、节奏、分寸与表达清晰度，像真人顾问而非客服机器人或问卷调查。$$,
           3, '["none"]'::jsonb, 8,
           $$看回复是否口语化、有温度、节奏自然、一次不堆砌过长信息、能接住客户情绪与口头禅/方言情境。生硬机械、答非所问、长篇说教扣分。$$,
           '[]'::jsonb)
      ),
      orgs AS (SELECT DISTINCT organization_id FROM scoring_dimension)
      INSERT INTO scoring_dimension
        (id, organization_id, code, name, description, weight, knowledge_dependencies,
         grading_rubric, keywords, llm_prompt, is_configured, sort_order, status)
      SELECT gen_random_uuid(), o.organization_id, d.code, d.name, d.description, d.weight, d.deps,
             '{"excellent":90,"good":80,"fair":70,"pass":60}'::jsonb,
             d.keywords, d.llm_prompt, true, d.sort_order, 'active'
      FROM orgs o CROSS JOIN defs d
      ON CONFLICT (organization_id, code) DO UPDATE SET
        name = EXCLUDED.name,
        description = EXCLUDED.description,
        weight = EXCLUDED.weight,
        knowledge_dependencies = EXCLUDED.knowledge_dependencies,
        grading_rubric = EXCLUDED.grading_rubric,
        keywords = EXCLUDED.keywords,
        llm_prompt = EXCLUDED.llm_prompt,
        is_configured = true,
        sort_order = EXCLUDED.sort_order,
        status = 'active',
        updated_at = CURRENT_TIMESTAMP
    `);

    // 2. 停用旧 5 维并从所有模板解绑（保留行用于回滚）。
    await database.query(`
      UPDATE scoring_dimension SET status = 'inactive', updated_at = CURRENT_TIMESTAMP
      WHERE code IN ${legacyCodes}
    `);
    await database.query(`
      DELETE FROM scoring_template_dimension
      WHERE dimension_id IN (SELECT id FROM scoring_dimension WHERE code IN ${legacyCodes})
    `);

    // 3. 把新 8 维挂到所有 active 模板（默认模板），幂等。
    await database.query(`
      INSERT INTO scoring_template_dimension (template_id, dimension_id, sort_order)
      SELECT t.id, d.id, d.sort_order
      FROM scoring_template t
      JOIN scoring_dimension d ON d.organization_id = t.organization_id AND d.code IN ${newCodes}
      WHERE t.status = 'active'
      ON CONFLICT DO NOTHING
    `);

    // 4. 默认模板说明更新为新模型。
    await database.query(`
      UPDATE scoring_template
      SET description = '私域经营能力评分：以问题解决力为核心，按客户阶段自适应，共 8 维',
          updated_at = CURRENT_TIMESTAMP
      WHERE is_default = true AND status = 'active'
    `);
  },

  async down(database): Promise<void> {
    const legacyCodes =
      "('needs_discovery','product_accuracy','objection_handling','emotion_management','closing_ability')";
    const newCodes =
      "('problem_solving','professionalism','needs_insight','trust_building','closing','rapport_stickiness','campaign_timeliness','communication_experience')";

    // 解绑并停用新 8 维。
    await database.query(`
      DELETE FROM scoring_template_dimension
      WHERE dimension_id IN (SELECT id FROM scoring_dimension WHERE code IN ${newCodes})
    `);
    await database.query(`
      UPDATE scoring_dimension SET status = 'inactive', updated_at = CURRENT_TIMESTAMP
      WHERE code IN ${newCodes}
    `);

    // 恢复旧 5 维并重新挂到 active 模板。
    await database.query(`
      UPDATE scoring_dimension SET status = 'active', updated_at = CURRENT_TIMESTAMP
      WHERE code IN ${legacyCodes}
    `);
    await database.query(`
      INSERT INTO scoring_template_dimension (template_id, dimension_id, sort_order)
      SELECT t.id, d.id, d.sort_order
      FROM scoring_template t
      JOIN scoring_dimension d ON d.organization_id = t.organization_id AND d.code IN ${legacyCodes}
      WHERE t.status = 'active'
      ON CONFLICT DO NOTHING
    `);
  },
};
