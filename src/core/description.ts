/**
 * 描述加权 —— 玩家"想怎么做"写得越**可行**，这次检定越容易。
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
 * ## 打分规则：以**可行性**为主
 * 用户拍板的口径是"**描述越科学、合理、可行，成功率越高**"——要的是质量，不是字数。
 * 早期版本以长度为主（`>=15字 +1` / `>=45字 +1`），结果"我开门"硬凑到 45 字能拿满分，
 * 而"我用撬棍卡进门缝、肩膀顶住慢慢加力"短一点反而低分，**奖励了字数、没奖励可行性**。
 * 现在：
 * - **可行性**（各 +1）：用了背包里真实的工具／点到环境的可操作特征／有明确步骤顺序／有风险规避
 * - **提及**（+1）：点到了场上真实存在的人、地、线索、物品
 * - **题材极性** `rationalityBias`：克苏鲁类题材里"用科学原理解题"反而是减分项
 * - 长度降为**次要**信号，只在明显偏长且无其他得分点时给半分（见 `lengthNudge`）
 * - 需要武器但手里没有 → −2（硬伤，不是"没写清楚"）
 * 总分封顶 ±2；空描述不奖不罚（想直接点技能掷骰是玩法的一部分，不逼人写作文）。
 *
 * ## 为什么放在本地、不问模型
 * 模型打分要额外一次请求、几百毫秒延迟，还会随机波动（同样的描述两次结果不同，玩家会困惑）。
 * 这里全是确定性规则，同一句描述永远同一结果。
 */
export type Difficulty = 'regular' | 'hard' | 'extreme';

/**
 * 题材的"理性极性"。
 * 克苏鲁的信条是"知道得越多越危险"，用科学原理解题反而更容易招致代价；
 * 主流冒险题材则奖励科学解法；日常/情感题材不做要求。
 */
export type RationalityBias = 'reward' | 'punish' | 'neutral';

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
  /** 环境的可操作特征（门锁 / 窗 / 通风口…），点到算可行性 */
  features?: string[];
  /** 题材极性，默认 neutral */
  rationalityBias?: RationalityBias;
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

/*
 * 可行性信号。
 * 这些是"玩家真的想清楚了"的证据，比字数可靠得多——
 * 说明他读了场上信息、知道自己手里有什么、也想了怎么做。
 */

/** 用了手里的东西："用撬棍"「拿绳子」"点着打火机" */
const TOOL_VERB_RE = /用|拿|抓起|掏出|取出|举起|握着|借助|靠着|借助|点上|点燃|打开|拧|撬/;
/** 有步骤顺序："先…然后…再…"「……之后」 */
const SEQUENCE_RE = /先.{0,20}(然后|再|接着|之后)|然后|接着|之后|随即|紧接着/;
/** 有风险规避："小心"「屏住呼吸」「压低声音」「贴着」「慢慢」 */
const CAUTION_RE = /小心|留意|谨慎|屏住呼吸|压低声音|贴着|慢慢|轻轻|悄悄|试探|稳|避开|躲|掩护|掩体/;
/** 理性／科学解题的表述 —— 受题材极性影响 */
const RATIONAL_RE = /科学|物理|化学|生物|计算|测量|公式|原理|仪器|数据|理性|推导|实验|药理|解剖学|工程学/;

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

  // ---- 可行性：主信号 ----

  // 1) 用了背包里真实存在的工具／物品（动词 + 物品名同现）
  const items = (ctx.items ?? []).map((n) => (n ?? '').trim()).filter((n) => n.length >= 2);
  const usedItem = TOOL_VERB_RE.test(text) ? items.find((n) => text.includes(n)) : undefined;
  if (usedItem) {
    score += 1;
    reasons.push(`用上了「${usedItem}」`);
  }

  // 2) 点到了环境的可操作特征（门锁 / 窗 / 通风口…）
  const features = (ctx.features ?? []).map((n) => (n ?? '').trim()).filter((n) => n.length >= 2);
  const hitFeature = features.find((n) => text.includes(n));
  if (hitFeature) {
    score += 1;
    reasons.push(`针对了「${hitFeature}」`);
  }

  // 3) 有明确步骤 / 顺序
  if (SEQUENCE_RE.test(text)) {
    score += 1;
    reasons.push('说清了做法步骤');
  }

  // 4) 有风险规避意识
  if (CAUTION_RE.test(text)) {
    score += 1;
    reasons.push('顾及了风险');
  }

  // ---- 题材极性：科学解题在克苏鲁里是负担，在冒险题材里是加分 ----
  const bias = ctx.rationalityBias ?? 'neutral';
  if (bias !== 'neutral' && RATIONAL_RE.test(text)) {
    if (bias === 'punish') {
      score -= 1;
      reasons.push('这里的答案不在书本上（越讲道理越容易被注意到）');
    } else {
      score += 1;
      reasons.push('思路讲得有理有据');
    }
  }

  // ---- 提及场上真实存在的东西（人物 / 地点 / 线索）----
  const named = [
    ...(ctx.npcs ?? []),
    ...(ctx.visited ?? []),
    ...(ctx.clues ?? []),
  ]
    .map((n) => (n ?? '').trim())
    .filter((n) => n.length >= 2 && !items.includes(n));
  const hit = named.find((n) => text.includes(n));
  if (hit) {
    score += 1;
    reasons.push(`点到了「${hit}」`);
  }

  /*
   * 长度：**降为次要信号**。
   * 只有在"没有别的可行性证据、但确实写了不少"时才补一分，
   * 且不能把一个本来为负的分抬起来——避免回到"凑字数就赢"。
   */
  if (score === 0 && text.length >= 40) {
    score += 1;
    reasons.push('描述比较详细');
  }

  // ---- 硬伤：提到了需要武器、但手里根本没有 ----
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
