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

/* ============================================================
 * 🔴 「flags 里哪些算**正在生效的状态**」—— **判据全仓只此一份**
 *
 * ## 为什么要把这三行抽出来（`H20·残留2`，协作方第 26 版）
 * 以前 `tickStatusEffects` / `statusNote` / `statusFlagLines` **各写一遍**
 * 「跳过 `<名字>轮数`」+「跳过没中的值」。三份判据当时口径一致，
 * 但 `H16·残留` 的成因就是这么来的：改一处、漏两处 → 同一状态两种说法。
 * 所以过滤本身也被抽成一个函数，谁都别再内联一遍。
 * ============================================================ */

/** 引擎记账键一律不当状态（`<名字>轮数`） */
export function isTurnsKey(key: string): boolean {
  return key.endsWith('轮数');
}

/** 这个 flag 值算不算"没中"（与 `insanityOf` 同一口径） */
export function isStatusOff(v: unknown): boolean {
  return v === false || v === '' || v === 0 || v == null;
}

/**
 * 正在生效的状态条目（已滤掉记账键与"没中"的）。
 *
 * 结算（`tickStatusEffects`）、给守密人的话（`statusNote`）、
 * 给玩家的那一行（`statusFlagLines`）**三处都走这一份**。
 */
export function liveStatusEntries(
  flags: Record<string, unknown> | undefined
): [string, unknown][] {
  if (!flags) return [];
  const out: [string, unknown][] = [];
  for (const [key, value] of Object.entries(flags)) {
    if (isTurnsKey(key)) continue;
    if (isStatusOff(value)) continue;
    out.push([key, value]);
  }
  return out;
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

  // 判据只有一份：`liveStatusEntries`（滤掉记账键与"没中"的）
  for (const [key] of liveStatusEntries(flags)) {
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

  // 与 `tickStatusEffects` / `statusFlagLines` 共用同一份过滤（`H20·残留2`）
  for (const [key] of liveStatusEntries(flags)) {
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

/* ============================================================
 * 「flags → 玩家看得懂的那一行」
 *
 * 🔴 H20（协作方第 25 版）：**判据只许有一份**。
 *
 * 以前两个面板各写一份过滤：只认字面 `INSANITY_TURNS_FLAG`（`疯狂轮数`），
 * 于是别的引擎记账键（`中毒轮数`）照样显示成「中毒轮数：2」，
 * 而布尔状态 `中毒: true` 还会把 `true` 这个英文字甩到界面上。
 * `H16·残留` / `§6.4` 反复分叉，教训就是**判据分两份**。
 *
 * 现在：过滤所有「轮数」结尾的键；布尔状态若配了轮数就渲染成「（还剩 N 轮）」。
 * `statusNote` 与两个面板三处共用这一份 —— 过滤本身也是共用的
 * （`liveStatusEntries`），不再是"三处各写一遍同样的两行"（`H20·残留2`）。
 * ============================================================ */

export interface StatusFlagLine {
  /** 状态名 */
  key: string;
  /** 给玩家看的一行（已拼好轮数，布尔值不会再露出 `true`） */
  text: string;
  /** 是不是引擎/守密人标出的严重状态 */
  severe: boolean;
}

/** 能放在界面上显示的状态行（过滤掉记账键与"没中"的） */
export function statusFlagLines(flags: Record<string, unknown> | undefined): StatusFlagLine[] {  if (!flags) return [];
  const out: StatusFlagLine[] = [];
  for (const [key, value] of liveStatusEntries(flags)) {
    const turns = Number(flags[turnsKeyOf(key)]);
    const hasTurns = Number.isFinite(turns) && turns > 0;
    // `true` 是引擎/守密人打的标记 —— 对玩家只显示状态名，绝不显示 `true`
    const body = value === true ? key : String(value);
    out.push({
      key,
      text: hasTurns ? `${body}（还剩 ${Math.floor(turns)} 轮）` : body,
      severe: value === true,
    });
  }
  return out;
}

/* ============================================================
 * 🔴 `P3-8`（协作方第 27 版 · 主人 2026-09-28 拍板「按是不是状态过滤」）
 *
 * ## 病在哪
 * `P3-7` 撤掉那层「只留中文键」的过滤是对的（语言不该决定藏不藏状态），
 * 但那层过滤**顺带**还在挡一件事：守密人（模型）顺手写进 `flags` 的**非状态键**
 * —— `notes: '...'`、`quest: '...'` 这类。撤掉之后它们会当成状态列进世界页「剧情标记」。
 * 所以要做的是：**删掉"语言"这个错误判据，换成一个说得通的判据**，不是把判据一起删掉。
 *
 * ## 判据：什么算"一个状态"
 * 四条**任一**成立即算（够宽，宁可多认也不漏真状态）：
 *   ① 规则包声明过（`statusEffects` 里找得到）；
 *   ② 引擎在给它记账（存在配对的 `<名字>轮数` 键）；
 *   ③ 是**引擎自己写**的那几个键（`ENGINE_STATUS_KEYS`）—— 它们不是模型即兴写的；
 *   ④ 值是**布尔真**（`true` 是明确的开关型标记，`notes: '...'` 那种长文本不是）。
 *
 * ## 🔴 一道安全阀：规则包没有状态表 → **一律显示**（老行为）
 * 自定义规则包大多没填 `statusEffects`。那种包下"什么算状态"无从判断，
 * 这时按老规矩**全部显示**，绝不因为一个判断不了就把它藏了
 * —— 藏状态是本项目踩过的坑（早期用户的「流血状态界面不显示」）。
 * ============================================================ */

/**
 * 引擎自己会写进 `flags` 的状态键（`store.ts` 的结算处）。
 * 它们必须一律当状态：不是模型即兴键，是引擎的账。
 */
export const ENGINE_STATUS_KEYS = ['临时疯狂', '永久疯狂', '濒死', '濒临死亡', '伤口'] as const;

/**
 * 有没有配对的"轮数"键（`中毒` ← `中毒轮数`）。
 *
 * ⚠️ 刻意用**后缀匹配**而不是精确的 `turnsKeyOf(key)`：
 * `临时疯狂` 的记账键是 `疯狂轮数`，而 `turnsKeyOf('临时疯狂')` 算出来的是
 * `临时疯狂轮数`（**全仓没人写它**，见 `P4-5`）。只认精确匹配的话，
 * `H16·残留` 那条"临时疯狂（还剩 N 轮）"就会从世界页消失 —— 那是在修新 bug 的路上踩回旧 bug。
 */
function hasTurnsPair(flags: Record<string, unknown> | undefined, key: string): boolean {
  if (!flags) return false;
  return Object.keys(flags).some((k) => isTurnsKey(k) && key.endsWith(k.slice(0, -'轮数'.length)));
}

/** 这个 flag 算不算"一个状态"（判据只有这一份，见上面那段） */
export function isStatusKey(
  rs: Ruleset | undefined,
  flags: Record<string, unknown> | undefined,
  key: string
): boolean {
  if (findStatusEffect(rs, key)) return true;
  if (hasTurnsPair(flags, key)) return true;
  if ((ENGINE_STATUS_KEYS as readonly string[]).includes(key)) return true;
  if (flags?.[key] === true) return true;
  // 规则包没状态表 → 判断不了 → 按老行为全部显示（安全阀）
  return !hasStatusTable(rs);
}

/**
 * 「剧情标记」那种地方要的那一份：**只列"算状态"的**。
 *
 * 与 `statusFlagLines` 共用同一份渲染判据（拼轮数、藏 `true`），
 * 只是在外面多一道"这是不是状态"。两处用同一个函数，口径不会再分叉。
 */
export function declaredStatusLines(
  flags: Record<string, unknown> | undefined,
  rs: Ruleset | undefined
): StatusFlagLine[] {
  return statusFlagLines(flags).filter((l) => isStatusKey(rs, flags, l.key));
}

/** 导出给测试用的类型（避免测不到内部行为） */
export type { StatusEffectDef };
