/**
 * 玩家挨的这一下，引擎怎么算（`G25` + `G27` · 协28 §F① 第 6b 条）。
 *
 * ## 病在哪
 * `vitals.*` 的变更**完全由模型申报**，引擎只验"这个数值条存在吗"，从不问"凭什么掉"。
 * 于是两头都坏：
 *   - 模型（叙事取向）倾向不扣玩家的血 → 真机 62 轮 `hp` 一次没动，**"死亡 = 结档"几乎不可达**；
 *   - 反方向它也**随口**扣（没掷过任何检定照扣）—— 属性变更压根没有判据。
 *
 * ## 主人 2026-09-29 拍板（原话）
 * 「掉理智要过检定啊，**动我属性都要检定的**」
 * 「让故事真实往下发展，**该死的时候能死**，守密人不要硬找理由拖着不让死，**改掉属性就掉**」
 * 「死定了就**一次性掉大量属性直接出结局**，暂时死不了就**慢慢掉**给玩家挣扎的机会」
 *
 * ## 翻成两条硬规矩（**不查表、不穷举** —— 主人：「武器表也是一个烂活，穷举不太靠谱」）
 * 1. **不许报 0**：掷过了就得真的掉，低于 1 的按 1 算；
 * 2. **大失败 / 这一下足以打光剩余 → 一次掉到位**（并出结局）。
 *
 * 「该掷哪个检定」**引擎不猜** —— 猜错会弹出不相干的检定（破坏沉浸）、猜不出来又退到体格（数值不对）。
 * 那一半交给模型（在 `dice_requests` 里要一次），引擎只管"**有没有掷**"与"**扣多少算数**"（见 `gameState.ts` 的闸门）。
 */

export interface HarmInput {
  /** 这一下要往下掉多少（模型报的原始值，可能 0 / 小数 / 负数） */
  raw: number;
  /** 这条数值条当前值 */
  before: number;
  /** 这条的下限（生命条通常是 0） */
  floor: number;
  /** 是不是生命条 —— 只有它会"死"（`san` 掉光走的是疯狂那条路，不出结局） */
  life: boolean;
  /** 这一轮掷出的检定是不是大失败 */
  fumble: boolean;
}

export interface HarmPlan {
  /** 实际扣多少（**至少 1**） */
  amount: number;
  /** 这一下是不是"死定了" → 允许跨过濒死冻结、掉到位并出结局 */
  lethal: boolean;
}

/**
 * 把"模型报的数"翻成"引擎认的数"。
 *
 * - 非生命条：只保底 1，不做致死判定（`san` 归零有自己的疯狂规则）。
 * - 生命条：**大失败 或 这一下足以打光剩余** → 一次掉到位（剩余多少就掉多少）+ `lethal`。
 *   其余情况照常扣 —— 这就是"暂时死不了就慢慢掉，给玩家挣扎的机会"。
 *
 * ⚠️ 已经见底（`remaining === 0`）时再挨一下也算 `lethal`：那正是"濒死的人又挨了一刀"，
 * 不该被那道"怕重复结算"的冻结永远护着（冻结的本意是给施救窗口，不是不死之身）。
 */
export function planHarm(input: HarmInput): HarmPlan {
  const raw = Number.isFinite(input.raw) ? input.raw : 0;
  const amount = Math.max(Math.round(raw), 1);
  if (!input.life) return { amount, lethal: false };

  const remaining = Math.max(input.before - input.floor, 0);
  if (input.fumble || amount >= remaining) {
    return { amount: Math.max(remaining, 1), lethal: true };
  }
  return { amount, lethal: false };
}
