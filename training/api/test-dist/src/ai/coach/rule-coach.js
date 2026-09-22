/**
 * 规则教练点评引擎 - 基于规则的对话质量评分与改进建议
 *
 * 移植自 backend/app/ai/coach.py 的 _rule_based_coach_feedback，
 * 使用 mood-engine 和 leave-detector 进行情绪与离开检测。
 */
import { analyzeMoodQuick } from './mood-engine.js';
import { checkCustomerLeave } from './leave-detector.js';
// ── 关键词表 ──────────────────────────────────────────────
/** 侮辱性关键词 — 命中直接 0 分 */
const RUDE_KEYWORDS = [
    '滚', '傻', '笨', '白痴', '智障', '老姥', '洗洗睡',
    '闭嘴', '烦死了', '滚蛋',
];
/** 占位符模式 — 敷衍回复 */
const PLACEHOLDER_PATTERNS = ['***', 'xxx', '。。。', '...', '？？？', '!!!'];
/** 产品相关关键词 */
const PRODUCT_KEYWORDS = [
    '产品', '成分', '效果', '功效', '特点', '优势', '推荐', '适合',
    '片', '胶囊', '口服液', '精华', '乳液', '面膜',
];
/** 礼貌用语 */
const POLITE_KEYWORDS = ['您好', '请', '谢谢', '感谢', '麻烦', '帮'];
// ── 工具函数 ──────────────────────────────────────────────
function clamp(value, min, max) {
    return Math.max(min, Math.min(max, value));
}
function anyMatch(text, keywords) {
    return keywords.some((kw) => text.includes(kw));
}
// ── 主函数 ────────────────────────────────────────────────
/**
 * 基于规则的教练点评
 *
 * 评分规则（从 Python 移植）：
 * - 基础分 50
 * - 侮辱词 → rating=0（直接返回）
 * - 占位符 -20
 * - 第2轮起未提产品词 -10
 * - 回复<10字 -15，<20字 -5，>100字 +5
 * - 礼貌词 +3，否则 -3
 * - 事件加减分（need+8 / objection-5 / trust+10 / closing+15）
 * - 情绪 delta>10 +3，<-10 -15
 * - 客户要离开 -30
 * - 最终 clamp 0-100
 */
export function ruleBasedCoachFeedback(params) {
    const { userMsg, aiMsg, turnCount, events } = params;
    const feedbackParts = [];
    let rating = 50;
    // ── 1. 侮辱性语言检测（直接 0 分） ──────────────────────
    const hasRude = anyMatch(userMsg, RUDE_KEYWORDS);
    if (hasRude) {
        return {
            rating: 0,
            feedback: '严重失误：使用了侮辱性语言，这是销售大忌。客户可能会直接离开并投诉。',
            improvements: [
                '立即停止使用任何侮辱性或情绪化语言',
                '向客户真诚道歉，挽回信任',
                '重新学习基本的销售沟通礼仪',
            ],
            events,
            moodDelta: -50,
        };
    }
    // ── 2. 占位符检测 ──────────────────────────────────────
    const hasPlaceholder = anyMatch(userMsg, PLACEHOLDER_PATTERNS);
    if (hasPlaceholder) {
        feedbackParts.push('✗ 回复中包含占位符，没有提供具体信息');
        rating -= 20;
    }
    // ── 3. 产品信息检测 ────────────────────────────────────
    const hasProductDetail = anyMatch(userMsg, PRODUCT_KEYWORDS);
    if (!hasProductDetail && turnCount >= 2) {
        feedbackParts.push('⚠ 未提及具体产品信息，回复缺乏说服力');
        rating -= 10;
    }
    // ── 4. 回复长度检测 ────────────────────────────────────
    const userMsgLen = userMsg.length;
    if (userMsgLen < 10) {
        feedbackParts.push('✗ 回复过于简短，显得敷衍');
        rating -= 15;
    }
    else if (userMsgLen < 20) {
        feedbackParts.push('⚠ 回复较短，可能信息不足');
        rating -= 5;
    }
    else if (userMsgLen > 100) {
        feedbackParts.push('✓ 回复详细，展示了专业知识');
        rating += 5;
    }
    // ── 5. 礼貌用语检测 ────────────────────────────────────
    const hasPolite = anyMatch(userMsg, POLITE_KEYWORDS);
    if (hasPolite) {
        feedbackParts.push('✓ 礼貌用语使用得当');
        rating += 3;
    }
    else {
        feedbackParts.push('⚠ 缺少礼貌用语，可能显得生硬');
        rating -= 3;
    }
    // ── 6. 事件加减分 ──────────────────────────────────────
    for (const event of events) {
        switch (event.type) {
            case 'need_revealed':
                feedbackParts.push('✓ 成功引导客户透露需求');
                rating += 8;
                break;
            case 'objection_raised':
                feedbackParts.push('⚠ 客户提出异议，需要注意应对方式');
                rating -= 5;
                break;
            case 'trust_built':
                feedbackParts.push('✓ 成功建立了信任关系');
                rating += 10;
                break;
            case 'closing_signal':
                feedbackParts.push('✓ 客户发出成交信号，可以推进成交');
                rating += 15;
                break;
            case 'professional_question':
                feedbackParts.push('⚠ 客户提出专业问题，需要展示专业性');
                break;
        }
    }
    // ── 7. 情绪分析 ────────────────────────────────────────
    const moodAnalysis = analyzeMoodQuick(aiMsg);
    if (moodAnalysis.moodDelta > 10) {
        feedbackParts.push('✓ 客户情绪积极，对话进展顺利');
        rating += 3;
    }
    else if (moodAnalysis.moodDelta < -10) {
        feedbackParts.push('✗ 客户情绪变差，需要调整策略');
        rating -= 15;
    }
    // ── 8. 客户离开检测 ────────────────────────────────────
    const leaveCheck = checkCustomerLeave(aiMsg);
    if (leaveCheck.leaving) {
        rating -= 30;
        feedbackParts.push('✗ 客户表示要离开，需要立即挽回');
    }
    // ── 9. 生成改进建议 ────────────────────────────────────
    const improvements = buildImprovements({
        hasPlaceholder,
        hasProductDetail,
        turnCount,
        hasPolite,
        userMsgLen,
        events,
        moodDelta: moodAnalysis.moodDelta,
        leaving: leaveCheck.leaving,
    });
    return {
        rating: clamp(rating, 0, 100),
        feedback: feedbackParts.length > 0 ? feedbackParts.join(' | ') : '对话正常进行中',
        improvements,
        events,
        moodDelta: moodAnalysis.moodDelta,
    };
}
function buildImprovements(params) {
    const { hasPlaceholder, hasProductDetail, turnCount, hasPolite, userMsgLen, events, moodDelta, leaving, } = params;
    const improvements = [];
    // 占位符建议
    if (hasPlaceholder) {
        improvements.push('回复中使用了占位符，没有提供具体信息，客户无法了解产品');
        improvements.push("✅ 正确示范：'我们这款维生素C片含有天然针叶樱桃提取物，每片含1000mg维C，纯度很高。'");
    }
    // 缺少产品信息建议
    if (!hasProductDetail && turnCount >= 2 && !hasPlaceholder) {
        improvements.push('未提及具体产品名称或特点，回复缺乏说服力');
        improvements.push("✅ 正确示范：'我推荐您试试我们的XX产品，它含有XX成分，专门针对您说的这个问题。'");
    }
    // 开场阶段建议
    if (turnCount <= 2) {
        improvements.push('开场阶段，建议先建立信任关系，不要急于推销产品');
        improvements.push("✅ 正确示范：'您好！很高兴为您服务。您今天想看看哪方面的产品呢？'");
    }
    // 事件相关建议
    const hasNeedRevealed = events.some((e) => e.type === 'need_revealed');
    const hasObjection = events.some((e) => e.type === 'objection_raised');
    const hasClosing = events.some((e) => e.type === 'closing_signal');
    if (!hasNeedRevealed && turnCount >= 3) {
        improvements.push('客户尚未透露具体需求，建议用开放式提问引导');
        improvements.push("✅ 正确示范：'您主要想解决什么问题呢？方便的话可以跟我说说，我帮您看看有没有合适的产品。'");
    }
    if (hasObjection) {
        improvements.push('客户有异议，先认同再解释，不要直接反驳');
        improvements.push("✅ 正确示范：'您说得对，很多客户一开始也有这个顾虑。不过我给您介绍一下，很多用过的客户反馈...'");
    }
    if (hasClosing) {
        improvements.push('客户有购买意向，可以适时推进成交');
        improvements.push("✅ 正确示范：'那您看这个方案挺适合您的，我帮您下单？今天下单还有优惠哦。'");
    }
    // 情绪变差建议
    if (moodDelta < 0) {
        improvements.push('客户情绪变差，建议先安抚情绪，再解决问题');
        improvements.push("✅ 正确示范：'非常理解您的感受，换作是我也会这样想。您别着急，我们一起看看怎么解决。'");
    }
    // 离开意向建议
    if (leaving) {
        improvements.push('客户有离开意向，需要立即道歉并挽回');
        improvements.push("✅ 正确示范：'真的很抱歉给您带来不好的体验！您先别走，我看看能为您做些什么。'");
    }
    // 回复过短且缺礼貌
    if (!hasPolite && userMsgLen < 20) {
        improvements.push('回复过于简短且缺少礼貌用语，建议更热情一些');
        improvements.push("✅ 正确示范：'您好，感谢您的信任！关于您说的这个问题，我来帮您分析一下...'");
    }
    // 开场阶段回复过长
    if (userMsgLen > 100 && turnCount <= 2) {
        improvements.push('开场阶段回复过长，建议简洁一些，让客户多说');
        improvements.push("✅ 正确示范：'好的，您具体是什么情况呢？'（简短引导，让客户主动说需求）");
    }
    // 通用建议
    if (improvements.length === 0) {
        improvements.push('继续保持，注意观察客户情绪变化');
        improvements.push("✅ 下一步可以尝试：'您还有其他什么顾虑吗？我可以帮您解答。'");
    }
    return improvements;
}
