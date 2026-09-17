/**
 * 临时疯狂（COC 核心机制）—— **有界的数值惩罚**。
 *
 * ## 为什么要给它数值后果
 * 用户 2026-09-16 拍板。在此之前，临时疯狂只是一句 `flags['临时疯狂']`——
 * 状态栏上挂着"理智骤降 6 点，陷入临时疯狂"，但引擎完全不理它：
 * 玩家疯了跟没疯一个样，检定照样掷。那是**假状态**：看得见，摸不着。
 * 用户要的是"状态有数值后果"——这也是"状态变化必须可见"的另一半。
 *
 * ## 三条硬约束（用户拍板）
 * 1. **有界**：最多一个大档，绝不叠加。疯三次不会变成 -30。
 * 2. **可恢复**：它是**临时**的。给一个明确的轮数窗口，到点自动解除；
 *    守密人也可以提前宣布"他缓过来了"（`flags.临时疯狂` 设 false）。
 * 3. **解除即消除**：窗口结束或提前解除，惩罚立刻归零，flag 一并消失。
 *
 * ## 为什么罚目标值而不是难度档
 * 与 `description.ts` / `encumbrance.ts` 完全相同的一条口径：
 * 难度不是玩家能选的东西，改它等于系统替玩家宣布"这次很难"。
 * 改目标值才是确定性的、可见的、引擎算的。
 */

/** 临时疯狂的持续轮数。COC 原文是"一段时间"，这里给一个有界窗口 */
export const INSANITY_TURNS = 3;

/** 目标值修正量：百分比规则（d100） */
const PENALTY_PERCENT = -20;
/** 目标值修正量：加值规则（d20 之类） */
const PENALTY_MODIFIER = -2;

export interface InsanityState {
  /** 还剩余几轮 */
  turns: number;
  /** 当初为什么发疯（给界面显示） */
  text: string;
}

export interface Insanity {
  /** 是否处于临时疯狂 */
  active: boolean;
  /** 剩余轮数 */
  turns: number;
  /** 目标值修正量，**负数＝更难**；未疯狂时为 0 */
  penalty: number;
  /** 一句话状态，界面直接显示 */
  label: string;
}

/**
 * 从 flags 里读出临时疯狂状态。
 *
 * 判据刻意宽松：`flags.临时疯狂` 只要是**真值**（true / 非空字符串）就算，
 * 因为守密人可能把它写成"他抓着自己的头发喃喃自语"这种描述，
 * 之前 `flags['临时疯狂'] = e.text` 也是这么写的。
 * **`false` / 空串 / 0 / null 一律算解除** —— 这是用户要的"解除即消除"。
 */
export function insanityOf(
  flags: Record<string, unknown> | undefined,
  mode: 'percent' | 'modifier' = 'percent',
  turnsHint?: number
): Insanity {
  const raw = flags?.['临时疯狂'];
  const active = raw !== false && raw !== '' && raw !== 0 && raw != null;
  if (!active) return { active: false, turns: 0, penalty: 0, label: '神志清醒' };
  const turns = resolveTurns(raw, turnsHint);
  const penalty = mode === 'percent' ? PENALTY_PERCENT : PENALTY_MODIFIER;
  const label =
    turns > 0 ? `临时疯狂（还剩 ${turns} 轮）` : '临时疯狂';
  return { active: true, turns, penalty, label };
}

/**
 * 轮数取哪个：引擎记的优先，守密人的描述只当"开窗的触发"。
 *
 * ## 为什么必须有这个第三参（协作方第 7 版 §2.1 抓到的潜伏 bug）
 * 引擎自己写 `flags.临时疯狂` 时写的是**一句描述**（"理智骤降 6 点，陷入临时疯狂"），
 * 真正的轮数存在另一个键 `flags.疯狂轮数` 里。
 * 于是 `readTurns` 对那句描述 `Number(...)` 得 `NaN` → 退回默认 `INSANITY_TURNS = 3`。
 * 结果：**`insanity().turns` 恒为 3、`label` 恒为"还剩 3 轮"，不随 `疯狂轮数` 递减。**
 *
 * 之所以一直没露馅：UI 只取 `.note`，没人显示 `label`。
 * 但等 R30 生涯页或任何面板开始用 `turns`，立刻穿帮。
 *
 * 口径与 `tickInsanity(flags, prevTurns)` **完全一致**：
 * 引擎记的轮数是真源，守密人的描述句只负责"这一轮他疯了"这个事实。
 */
function resolveTurns(raw: unknown, hint?: number): number {
  if (typeof hint === 'number' && Number.isFinite(hint) && hint > 0) {
    return Math.max(0, Math.floor(hint));
  }
  return readTurns(raw);
}

/**
 * 从 flag 的值里读剩余轮数。
 *
 * 两种写法都收：
 *   - 数字 / 数字串（`flags.临时疯狂 = 3`）—— 守密人显式给窗口；
 *   - 对象（`{ turns: 3, text: "…" }`）—— 引擎自己写的结构化写法。
 * 读不出来就退回默认窗口 `INSANITY_TURNS`，绝不返回 0——
 * 0 会被下游当成"已解除"，那等于让"忘了写轮数"变成"没疯狂"。
 */
function readTurns(raw: unknown): number {
  if (typeof raw === 'number' && Number.isFinite(raw)) {
    return Math.max(0, Math.floor(raw));
  }
  if (typeof raw === 'string') {
    const n = Number(raw);
    if (Number.isFinite(n)) return Math.max(0, Math.floor(n));
  }
  if (raw && typeof raw === 'object') {
    const n = Number((raw as { turns?: unknown }).turns);
    if (Number.isFinite(n)) return Math.max(0, Math.floor(n));
  }
  return INSANITY_TURNS;
}

/**
 * 推进一轮：返回新的临时疯狂 flag 值（`false` = 已解除）。
 *
 * 调用点是**每个结算点**（与伤口失血同一处）。三件事：
 *   - 没疯 → 原样返回（不乱动）；
 *   - 疯了但轮数读不出来（守密人写的是描述句而非数字）→ 起一个默认窗口；
 *   - 疯了且有轮数 → 减 1，减到 0 就解除。
 *
 * 为什么把"起窗口"和"递减"放在同一个函数里：它们必须原子地一起发生。
 * 拆开的话，"守密人写了描述句"那条路上会每一轮都被当成"刚发疯"，永远解除不掉。
 */
export function tickInsanity(
  flags: Record<string, unknown> | undefined,
  prevTurns?: number
): { next: number | false; turns: number } {
  const raw = flags?.['临时疯狂'];
  const active = raw !== false && raw !== '' && raw !== 0 && raw != null;
  if (!active) return { next: false, turns: 0 };
  // 优先用引擎自己记的轮数（`prevTurns`）；没有才从 flag 上读
  const base = typeof prevTurns === 'number' && prevTurns > 0 ? prevTurns : readTurns(raw);
  const left = base - 1;
  if (left <= 0) return { next: false, turns: 0 };
  return { next: left, turns: left };
}

/**
 * 给守密人的一句话（只在临时疯狂时注入）。
 * 与 `encumbranceNote` / `woundNote` 同理：**不给数字**，只交代体感与恢复的路径。
 */
export function insanityNote(ins: Insanity): string | null {
  if (!ins.active) return null;
  return (
    '【临时疯狂】玩家正处在精神失控的状态里，脑子里的东西还没落回原位。' +
    '这会在故事里体现出来：他看见的东西不太对、听错话、手抖、判断失准、' +
    '对熟悉的人一时认不出来。**不要写任何数字或"惩罚/目标值"这类词**，' +
    '把它写成他的感知与身体出了偏差。\n' +
    '- 这是**暂时的**，他会缓过来（引擎会在一段时间后自动解除）。' +
    '你也可以在合适的时候让他提前回神——把 `flags.临时疯狂` 设成 `false` 即可，' +
    '引擎会立刻把惩罚与状态标签一起清掉。\n' +
    '- **不要替他做决定**：失控的是身体与感知，不是他的选择。' +
    '他可以硬撑着继续，也可以让自己冷静下来。'
  );
}
