/**
 * 离开检测器 - 检测客户是否表达了离开意图
 *
 * 移植自 backend/app/ai/coach.py 的 check_customer_leave，
 * 返回 leaving（是否离开）、strength（强度）、keyword（命中关键词）、reason（原因）。
 */
/**
 * LEAVE_PATTERNS 两级关键词：
 *   strong: 明确的离开/决裂信号（再见/拜拜/不买了/走了/算了/再也不来/拉黑/投诉你/再也不见/去别家/去其他店/不跟你说了）
 *   mild:   委婉的离开信号（我去看看别的/我去别处/我先走了/不考虑了/不需要了/没兴趣了）
 */
const LEAVE_PATTERNS = {
    strong: [
        '再见',
        '拜拜',
        '不买了',
        '走了',
        '算了',
        '再也不来',
        '拉黑',
        '投诉你',
        '再也不见',
        '去别家',
        '去其他店',
        '不跟你说了',
    ],
    mild: [
        '我去看看别的',
        '我去别处',
        '我先走了',
        '不考虑了',
        '不需要了',
        '没兴趣了',
    ],
};
/**
 * 检查客户是否要离开
 *
 * 遍历 LEAVE_PATTERNS，对输入文本做子串匹配。
 * 命中时返回 { leaving: true, strength, keyword, reason }。
 * 未命中返回 { leaving: false }。
 *
 * 注意：strong 优先检测，先于 mild 匹配。
 */
export function checkCustomerLeave(text) {
    for (const strength of ['strong', 'mild']) {
        for (const kw of LEAVE_PATTERNS[strength]) {
            if (text.includes(kw)) {
                return {
                    leaving: true,
                    strength,
                    keyword: kw,
                    reason: `客户说了${kw}，表示要离开`,
                };
            }
        }
    }
    return { leaving: false };
}
