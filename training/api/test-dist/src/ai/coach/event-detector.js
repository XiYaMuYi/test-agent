/**
 * 事件检测器 - 检测对话中的关键事件信号
 *
 * 移植自 backend/app/ai/coach.py 的 EVENT_PATTERNS，
 * 针对用户消息（userMsg）和 AI 消息（aiMsg）分别做关键词匹配，
 * 每类事件只取第一个命中的关键词，命中后即 break。
 */
/**
 * EVENT_PATTERNS 五类事件关键词：
 *   need_revealed:        用户需求暴露（检测 userMsg），quality=70
 *   objection_raised:     客户异议（检测 aiMsg 中客户回复的引用，quality=undefined）
 *   trust_built:          信任建立（检测 aiMsg），quality=85
 *   closing_signal:       成交信号（检测 userMsg），quality=90
 *   professional_question:专业问题（检测 userMsg），quality=undefined
 */
const EVENT_PATTERNS = {
    need_revealed: {
        target: 'user',
        keywords: ['我想', '我需要', '我想要', '我的问题是', '我最近', '我在找', '帮我推荐'],
        quality: 70,
    },
    objection_raised: {
        target: 'ai',
        keywords: ['但是', '不过', '太贵', '不划算', '别的品牌', '效果不好', '不确定'],
    },
    trust_built: {
        target: 'ai',
        keywords: ['你说得对', '有道理', '我相信你', '专业', '懂我', '理解我'],
        quality: 85,
    },
    closing_signal: {
        target: 'user',
        keywords: ['多少钱', '怎么买', '下单', '购买', '成交', '就这个'],
        quality: 90,
    },
    professional_question: {
        target: 'user',
        keywords: ['成分', '功效', '原理', '怎么用', '副作用', '适合什么肤质'],
    },
};
/**
 * 检测对话中发生的事件
 *
 * 遍历 EVENT_PATTERNS，按 target 选择检测 userMsg 或 aiMsg。
 * 每类事件只取第一个命中的关键词，命中后即 break 进入下一类。
 * 未命中任何关键词的事件类型不会出现在结果中。
 */
export function detectEvents(userMsg, aiMsg) {
    const events = [];
    for (const [type, pattern] of Object.entries(EVENT_PATTERNS)) {
        const text = pattern.target === 'user' ? userMsg : aiMsg;
        let matched;
        for (const kw of pattern.keywords) {
            if (text.includes(kw)) {
                matched = kw;
                break;
            }
        }
        if (matched) {
            const event = {
                type,
                detail: matched,
            };
            if (pattern.quality !== undefined) {
                event.quality = pattern.quality;
            }
            events.push(event);
        }
    }
    return events;
}
