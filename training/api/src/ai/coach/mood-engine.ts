/**
 * 情绪检测引擎 - 基于关键词规则快速分析客户情绪变化
 *
 * 移植自 backend/app/ai/coach.py 的 analyze_mood_quick，
 * 返回 moodDelta（情绪变化值）、matched（命中的关键词）、confidence（置信度）。
 */

type MoodStrength = 'strong' | 'mild';

interface MoodLevel {
  keywords: string[];
  delta: number;
}

interface MoodCategory {
  strong: MoodLevel;
  mild: MoodLevel;
}

/**
 * MOOD_PATTERNS 三级分类：
 *   positive: strong(+15), mild(+5)
 *   negative: strong(-15), mild(-5)
 *   angry:    strong(-25), mild(-10)
 */
const MOOD_PATTERNS: Record<string, MoodCategory> = {
  positive: {
    strong: {
      keywords: ['太好了', '非常满意', '就这个了', '太喜欢了', '完美', '太棒了', '正是我想要的'],
      delta: 15,
    },
    mild: {
      keywords: ['不错', '可以', '还行', '有意思', '了解一下', '听起来不错', '有道理'],
      delta: 5,
    },
  },
  negative: {
    strong: {
      keywords: ['太贵了', '不要了', '算了', '不买了', '浪费时间', '没兴趣', '不需要'],
      delta: -15,
    },
    mild: {
      keywords: ['有点贵', '再想想', '不太合适', '考虑考虑', '不太确定', '还要比较一下'],
      delta: -5,
    },
  },
  angry: {
    strong: {
      keywords: ['什么态度', '投诉', '骗人', '虚假宣传', '再也不来', '太失望了', '气死了'],
      delta: -25,
    },
    mild: {
      keywords: ['不满意', '失望', '不高兴', '怎么回事', '不太舒服', '有点过分'],
      delta: -10,
    },
  },
};

export interface MoodQuickResult {
  moodDelta: number;
  matched: string[];
  confidence: 'high' | 'low';
}

/**
 * 快速情绪分析（规则，0延迟）
 *
 * 遍历 MOOD_PATTERNS，对输入文本做子串匹配，累加情绪值。
 * confidence: abs(moodDelta) >= 10 为 'high'，否则 'low'
 */
export function analyzeMoodQuick(text: string): MoodQuickResult {
  let moodDelta = 0;
  const matched: string[] = [];

  for (const category of Object.values(MOOD_PATTERNS)) {
    for (const strength of ['strong', 'mild'] as MoodStrength[]) {
      const level = category[strength];
      for (const kw of level.keywords) {
        if (text.includes(kw)) {
          matched.push(kw);
          moodDelta += level.delta;
        }
      }
    }
  }

  return {
    moodDelta,
    matched,
    confidence: Math.abs(moodDelta) >= 10 ? 'high' : 'low',
  };
}
