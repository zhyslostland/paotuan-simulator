/**
 * 描述加权 —— 玩家"想怎么做"写得越具体，这次检定越容易。
 *
 * ## 为什么要做
 * 规则包只管"用什么技能、目标值多少"，但它不知道玩家**怎么做**。
 * "我开门"和"我用撬棍卡进门缝，肩膀顶住，慢慢加力"在规则上完全一样，
 * 在沉浸感上却差很远。加权是给"愿意描述"的玩家一点回报。
 *
 * ## 为什么只调难度档位、不动数值
 * - 难度档（普通 / 困难 / 极难）是**规则包本身就有的概念**，用它不会破坏规则权威；
 * - 目标值仍由规则包算出，引擎仍是唯一权威，模型也看不到这个调整；
 * - 幅度封顶在一档，避免"写一段小说就能必过"。
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
  /** 加权后的难度 */
  difficulty: Difficulty;
}

const ORDER: Difficulty[] = ['regular', 'hard', 'extreme'];

const easier = (d: Difficulty): Difficulty =>
  ORDER[Math.max(0, ORDER.indexOf(d) - 1)] ?? 'regular';
const harder = (d: Difficulty): Difficulty =>
  ORDER[Math.min(ORDER.length - 1, ORDER.indexOf(d) + 1)] ?? 'extreme';

/** "具体做法"的用词。命中即说明玩家写明了怎么做，而不是只写了个目的。 */
const METHOD_RE =
  /(用|拿|抓|撬|拧|掀|按住|压住|顺着|沿着|贴着|靠着|借着|屏住|蹲下|侧身|弯腰|慢慢|轻轻|先[^，。]{0,6}再|一边[^，。]{0,6}一边)/;

export function weighDescription(
  action: string,
  ctx: WeighContext = {},
  difficulty: Difficulty = 'regular'
): DescriptionWeight {
  const text = (action ?? '').trim();
  const reasons: string[] = [];

  /*
   * 空描述**不罚**。
   * 玩家想直接点一个技能掷骰，那是他玩法的一部分；因为没写字就加难度，等于逼人写作文。
   */
  if (text.length < 4) {
    return { score: 0, reasons: ['没写具体做法，难度不变'], difficulty };
  }

  let score = 0;

  // 提到了场上真实存在的东西（人物 / 地点 / 线索 / 随身物品）
  const named = [...(ctx.npcs ?? []), ...(ctx.visited ?? []), ...(ctx.clues ?? []), ...(ctx.items ?? [])]
    .map((n) => (n ?? '').trim())
    .filter((n) => n.length >= 2);
  const hit = named.find((n) => text.includes(n));
  if (hit) {
    score += 1;
    reasons.push(`点到了「${hit}」`);
  }

  // 写明了具体做法
  if (METHOD_RE.test(text)) {
    score += 1;
    reasons.push('写明了怎么做');
  }

  // 提到了需要武器、但手里根本没有
  if (ctx.requiredWeapon && ctx.hasWeapon === false) {
    score -= 1;
    reasons.push(`手里没有${ctx.requiredWeapon}`);
  }

  score = Math.max(-2, Math.min(2, score));

  let next = difficulty;
  if (score >= 2) next = easier(difficulty);
  else if (score <= -1) next = harder(difficulty);

  if (next === difficulty) reasons.push('难度不变');
  return { score, reasons, difficulty: next };
}

export const DIFFICULTY_LABEL: Record<Difficulty, string> = {
  regular: '普通',
  hard: '困难',
  extreme: '极难',
};
