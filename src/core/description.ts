/**
 * 描述加权 —— 玩家"想怎么做"写得越用心，这次检定越容易。
 *
 * ## 为什么要做
 * 规则包只管"用什么技能、目标值多少"，但它不知道玩家**怎么做**。
 * "我开门"和"我用撬棍卡进门缝，肩膀顶住，慢慢加力"在规则上完全一样，
 * 在沉浸感上却差很远。加权是给"愿意描述"的玩家一点回报。
 *
 * ## 它改的是"目标值"，不是"难度档位"
 * 早期版本改的是难度档（普通 / 困难 / 极难），但那需要玩家先选一个难度才有东西可改，
 * 而**难度本来就不该由玩家来选**（等于让玩家决定这件事有多难，属于元游戏），
 * 玩家自己发起的检定默认是"普通"，再降也没处降——加权形同虚设。
 * 所以改成：在引擎算出的目标值上，加一个**封顶、可见、确定性**的修正量。
 * 引擎仍然是唯一权威（数还是引擎算的），模型看不到这个调整。
 *
 * ## 打分规则（必须"写得越多越有分"）
 * 前一版判据太取巧（只看有没有命中几个关键词），出现了"写两句 +1、写一堆 +0"的荒谬结果。
 * 现在以**长度**为主、内容为辅，符合直觉：
 * - 15 字以上 +1，45 字以上再 +1（写得多＝想得细）
 * - 提到场上真实存在的东西（人物 / 地点 / 线索 / 随身物品）再 +1
 * - 提到需要武器、但手里根本没有 → 直接 −2（这是硬伤，不是"没写清楚"）
 * 总分封顶 ±2；空描述不奖不罚（想直接点技能掷骰是玩法的一部分，不逼人写作文）。
 *
 * ## 为什么放在本地、不问模型
 * 模型打分要额外一次请求、几百毫秒延迟，还会随机波动（同样的描述两次结果不同，玩家会困惑）。
 * 这里全是确定性规则，同一句描述永远同一结果。
 */
export type Difficulty = 'regular' | 'hard' | 'extreme';

/** 判定用的上下文：场上"真实存在"的东西，只有提到它们才算数 */
export interface WeighContext {
  /** 在场人物 */
  npcs?: string[];
  /** 去过的地方 */
  visited?: string[];
  /** 已获得的线索 */
  clues?: string[];
  /** 背包里的物品名 */
  items?: string[];
  /** 这次检定需要的武器名（如"射击（手枪）"对应的枪） */
  requiredWeapon?: string | null;
  /** 背包里有没有能用的武器 */
  hasWeapon?: boolean;
}

export interface DescriptionWeight {
  /** -2 ~ +2 */
  score: number;
  /** 每一分都是什么原因，界面上直接给玩家看 */
  reasons: string[];
  /**
   * 目标值的修正量。
   * 百分比规则（d100）下是 +10 / +15 这类；加值规则（d20）下是 +1 / +2。
   * 正数＝更容易。
   */
  bonus: number;
}

/** 长度门槛：写得多就是想得细，这是最直观、也最难"钻空子"的一条 */
const LENGTH_OK = 15;
const LENGTH_GOOD = 45;

/** 目标值修正量：百分比规则（d100） */
const BONUS_PERCENT: Record<number, number> = { 2: 15, 1: 10, 0: 0, [-1]: -10, [-2]: -15 };
/** 目标值修正量：加值规则（d20 之类） */
const BONUS_MODIFIER: Record<number, number> = { 2: 2, 1: 1, 0: 0, [-1]: -1, [-2]: -2 };

export function weighDescription(
  action: string,
  ctx: WeighContext = {},
  mode: 'percent' | 'modifier' = 'percent'
): DescriptionWeight {
  const text = (action ?? '').trim();
  const table = mode === 'percent' ? BONUS_PERCENT : BONUS_MODIFIER;

  /*
   * 空描述**不罚**。
   * 玩家想直接点一个技能掷骰，那是他玩法的一部分；因为没写字就扣难度，等于逼人写作文。
   */
  if (text.length < 6) {
    return { score: 0, reasons: ['没有描述，按原始目标值掷'], bonus: 0 };
  }

  const reasons: string[] = [];
  let score = 0;

  // 长度：写得越多越有分
  if (text.length >= LENGTH_OK) {
    score += 1;
    reasons.push('写了具体做法');
  }
  if (text.length >= LENGTH_GOOD) {
    score += 1;
    reasons.push('描述很详细');
  }

  // 提到了场上真实存在的东西（人物 / 地点 / 线索 / 随身物品）
  const named = [
    ...(ctx.npcs ?? []),
    ...(ctx.visited ?? []),
    ...(ctx.clues ?? []),
    ...(ctx.items ?? []),
  ]
    .map((n) => (n ?? '').trim())
    .filter((n) => n.length >= 2);
  const hit = named.find((n) => text.includes(n));
  if (hit) {
    score += 1;
    reasons.push(`点到了「${hit}」`);
  }

  // 提到了需要武器、但手里根本没有 —— 硬伤，直接扣到负
  if (ctx.requiredWeapon && ctx.hasWeapon === false) {
    score -= 2;
    reasons.push(`手里没有${ctx.requiredWeapon}`);
  }

  score = Math.max(-2, Math.min(2, score));
  if (reasons.length === 0) reasons.push('描述偏简略');

  return { score, reasons, bonus: table[score] ?? (score > 0 ? table[1]! : table[-1]!) };
}

export const DIFFICULTY_LABEL: Record<Difficulty, string> = {
  regular: '普通',
  hard: '困难',
  extreme: '极难',
};
