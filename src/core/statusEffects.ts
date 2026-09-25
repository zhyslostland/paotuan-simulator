/**
 * 状态效果的**每轮结算**（1.0 阶段 C）。
 *
 * ## 为什么要有这一份
 * 以前「我中毒了」只是 `flags` 里多一行字 —— **引擎不知道该扣什么、每轮扣多少**，
 * 只能交给模型自觉。那等于把「引擎权威」这条铁律让出去了：
 * 中毒掉不掉血，全看守密人这一轮心情好不好。
 *
 * 阶段 B 让规则包**能声明**（`statusEffects`），这一份负责把它**真正算出来**。
 *
 * ## 三条刻意守住的边界
 * 1. **只在规则包填了表时才生效** —— 老包 / 自定义包没填 → 一律不动，行为与现状一致。
 * 2. **只在"推进了一轮"时结算**，不挂在每次对话上 —— 否则玩家说两句话就扣两次血。
 * 3. **计数键沿用 `疯狂轮数` 那套写法**（引擎记账用 `<名字>轮数`），UI 侧已有过滤常量。
 *
 * ⚠️ 纯函数：不碰 IO、不改传入的对象，返回新的一份。
 */

import { findStatusEffect, type Ruleset, type StatusEffectDef } from './rulesets/types.js';
import type { StateDelta } from './state/gameState.js';

/** 引擎记账用的轮数键：`中毒` → `中毒轮数` */
export function turnsKeyOf(name: string): string {
  return `${name}轮数`;
}

export interface StatusTick {
  /** 这一轮真正造成的数值变化（key → 增量，负数＝扣） */
  deltas: StateDelta[];
  /** 这一轮结束后被解除的状态名 */
  cleared: string[];
  /** 还在持续的状态（名字 → 剩余轮数，0＝直到解除） */
  remaining: { name: string; turns: number }[];
}

/**
 * 推进一轮：把当前 flags 里的状态按规则包的表结算一遍。
 *
 * @param flags 当前状态标记（只读）
 * @param rs 规则包（没填 `statusEffects` 就什么都不做）
 * @param rng 骰子（用于 `1d4` 这类骰表达式）
 */
export function tickStatusEffects(
  flags: Record<string, unknown> | undefined,
  rs: Ruleset | undefined,
  rng?: () => number
): StatusTick {
  const empty: StatusTick = { deltas: [], cleared: [], remaining: [] };
  // 规则包没声明状态表 → 完全不动（老包 / 自定义包的行为必须一点不变）
  if (!rs?.statusEffects?.length || !flags) return empty;

  const deltas: StateDelta[] = [];
  const cleared: string[] = [];
  const remaining: { name: string; turns: number }[] = [];

  for (const [key, value] of Object.entries(flags)) {
    // `false` / 空串 / 0 / null 一律算没中（与 insanityOf 同一口径）
    if (value === false || value === '' || value === 0 || value == null) continue;
    // 引擎自己的记账键不是状态
    if (key.endsWith('轮数')) continue;

    const def = findStatusEffect(rs, key);
    if (!def) continue;

    // ---- 每轮后果 ----
    for (const [vital, raw] of Object.entries(def.perRound ?? {})) {
      const amount = resolveAmount(raw, rng);
      if (amount === 0) continue;
      deltas.push({
        target: `vitals.${vital}`,
        op: amount < 0 ? 'dec' : 'inc',
        amount: Math.abs(amount),
        reason: `${key}：每轮${amount < 0 ? '扣' : '回'} ${Math.abs(amount)} ${vital}`,
      });
    }

    // ---- 倒计时 ----
    const cur = Number(flags[turnsKeyOf(key)]);
    const left = Number.isFinite(cur) && cur > 0 ? Math.floor(cur) - 1 : Math.max(0, def.duration) - 1;
    if (left <= 0 && def.duration > 0) {
      cleared.push(key);
    } else {
      remaining.push({ name: key, turns: left });
    }
  }

  return { deltas, cleared, remaining };
}

/**
 * 把 `-1` / `1` / `"1d4"` 都算成一个**增量**（负数＝扣）。
 *
 * ⚠️ 骰表达式一律当**扣**：状态效果里的骰子基本都是伤害（燃烧每轮 1d4），
 * 而 `perRound` 写的是"增量"，正数会被读成回血 —— 那正好反了。
 * 算不出来当 0（宁可不扣，也别扣错）。
 */
function resolveAmount(raw: number | string, rng?: () => number): number {
  if (typeof raw === 'number') return Math.trunc(raw);
  const m = /^(\d+)d(\d+)$/i.exec(raw.trim());
  if (!m) {
    const n = Number(raw);
    return Number.isFinite(n) ? Math.trunc(n) : 0;
  }
  const count = Number(m[1]);
  const sides = Number(m[2]);
  if (count <= 0 || sides <= 0) return 0;
  let total = 0;
  for (let i = 0; i < count; i++) {
    // 没给 rng 就用 Math.random —— 纯展示场景也别崩
    total += 1 + Math.floor((rng ?? Math.random)() * sides);
  }
  return -total;
}

/** 这个规则包有没有声明状态表（UI 与提示词据此决定要不要提这件事） */
export function hasStatusTable(rs: Ruleset | undefined): boolean {
  return (rs?.statusEffects?.length ?? 0) > 0;
}

/**
 * 给守密人的一句话：此刻哪些状态在生效、还剩几轮。
 *
 * ⚠️ 轮数显示的是**此刻**的值（不是"再过一轮还剩多少"）——
 * 玩家在状态栏看到"还剩 2 轮"，守密人听到的也该是 2，两边必须对得上。
 */
export function statusNote(rs: Ruleset | undefined, flags: Record<string, unknown> | undefined): string {
  if (!rs?.statusEffects?.length || !flags) return '';

  const live: string[] = [];
  const gone: string[] = [];

  for (const [key, value] of Object.entries(flags)) {
    if (value === false || value === '' || value === 0 || value == null) continue;
    if (key.endsWith('轮数')) continue;
    const def = findStatusEffect(rs, key);
    if (!def) continue;

    const cur = Number(flags[turnsKeyOf(key)]);
    const turns = Number.isFinite(cur) && cur > 0 ? Math.floor(cur) : Math.max(0, def.duration);
    // 轮数已经归零、且这个状态是有期限的 → 这一轮就该解除
    if (turns <= 1 && def.duration > 0) gone.push(key);
    else live.push(turns > 0 ? `${key}（还剩 ${turns} 轮）` : key);
  }

  return [
    live.length
      ? `【引擎判定】以下状态正在生效：${live.join('、')}。后果已由引擎算过，不要重复扣血。`
      : '',
    gone.length ? `【引擎判定】${gone.join('、')} 已在本轮解除，恢复常态。` : '',
  ]
    .filter(Boolean)
    .join('\n');
}

/** 导出给测试用的类型（避免测不到内部行为） */
export type { StatusEffectDef };
