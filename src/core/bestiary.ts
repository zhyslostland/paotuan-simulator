/**
 * 怪物图鉴 / 战斗投放（R38 的引擎侧真源）。
 *
 * ## 这个文件解决两件事
 * 1. **`castFromBestiary()`** —— 战斗开打时，由**引擎**按敌对者表的数值
 *    初始化 `combat.foes`。以前这件事"名义上"存在（清单第 5 项写着"由
 *    `castFromBestiary` 初始化"），但**函数根本不存在**：`combat.foes`
 *    全靠模型即兴写，同一只东西前后两轮血量、攻击方式都对不上。
 * 2. **结档解锁的图鉴** —— 玩家见过 / 打赢过的东西才进图鉴；
 *    没跑完这一局之前，图鉴不给他看（否则等于开局剧透）。
 *
 * ## 为什么解锁判据不放在 UI 里
 * 与 `wounds.ts` / `insanity.ts` 同一条口径：**判据是纯函数，能单测**。
 * UI 只负责画，不进逻辑。不然"什么时候算见过"这种事会因为改版而漂。
 *
 * ## 剧透约定 G5（本文件是它的落点）
 * 全项目的"不许剧透"散在各处（地图迷雾、`npcNotes` 只写看得见的、
 * 导出默认不含真相、准备页怪物表默认遮罩）。这里把**统一约定**写死成一条，
 * 后面 R30（生涯 / 成就）直接复用：
 *
 * | 对象 | 什么时候可以给玩家看 |
 * |---|---|
 * | 怪物名 / 外观 / 已知行为 | **当场照面**即可见（他确实看见了） |
 * | 怪物数值（血量 / 攻击骰） | **当场照面**即可见（他挨过打，本来就该知道） |
 * | 怪物**弱点**与破解方式 | **交手过之后**才给（那是"活路"，提前给等于送答案） |
 * | 模组真相 / 谜底 | **这一局结档之后**才给（且导出默认不含） |
 * | 未到过的地点 | **去过或听说过**才画（地图迷雾） |
 *
 * 一句话：**玩家此刻能感知到的才给，其余一律等**。
 */

import type { Foe } from './state/gameState.js';

/** 图鉴里一条目的状态。刻意只有两档——"知道有这东西"与"交手过" */
export type SightLevel = 'none' | 'seen' | 'fought';

/**
 * 引擎认识的敌对者。
 *
 * 结构与 `ModuleMonster`（UI 层的模组字段）**故意保持字段同名**，
 * 这样 `castFromBestiary` 可以直接吃模组的表，UI 也不用做字段搬运。
 * 为什么不直接 import UI 的 `ModuleMonster`：那会让 `core` 反向依赖 `ui`，
 * **违反"core 纯函数无 IO"那条硬约定**（见台账第 3 节）。
 */
export interface BestiaryEntry {
  id: string;
  name: string;
  /** 外观 / 声音 / 气味（玩家能感知的） */
  look?: string;
  /** 生命值上限 */
  hp?: number;
  /** 攻击方式与伤害骰 */
  attack?: string;
  /** 行为特点 */
  behavior?: string;
  /** 弱点 / 破解方式（**玩家交手过之后才给看**） */
  weakness?: string;
}

/** 默认血量：表里没写时用的兜底。与 `gameState.ts` 的 foes add 默认值一致，别两处不一样 */
const DEFAULT_HP = 10;

/**
 * 按名字在表里找一条。
 *
 * 匹配刻意**宽松**（精确 → 互相包含），理由与地图节点一致：
 * 模型写的名字常带修饰（"雾中的巨影" vs "巨影"），
 * 严格相等会让"明明表里有，却没投进去"。
 * 但**必须先精确**，否则"小蜘蛛"会命中"蜘蛛女王"。
 */
export function findEntry(
  entries: readonly BestiaryEntry[],
  name: string
): BestiaryEntry | undefined {
  const t = String(name ?? '').trim();
  if (!t) return undefined;
  const exact = entries.find((e) => e.name.trim() === t);
  if (exact) return exact;
  return entries.find((e) => {
    const n = e.name.trim();
    return n.length >= 2 && t.length >= 2 && (n.includes(t) || t.includes(n));
  });
}

/**
 * **`castFromBestiary`** —— 战斗开打时把表里的数值落成 `combat.foes`。
 *
 * 返回的是一串 delta，由调用方走 `applyModelDeltas` 应用。
 * 为什么返回 delta 而不直接改状态：这样才能**复用**那条通道上的全部约束
 * （白名单、名字必填、血量 clamp、被拒理由翻人话），不至于多开一条改状态的路。
 *
 * 几个刻意的地方：
 *   - **表里没有的东西也给一个 delta**（按 `DEFAULT_HP`）——不能因为"作者忘了填"
 *     就让战斗里根本没这只东西，那玩家会在打空气（用户实测报过"敌对生物没有命名"，
 *     同一个道理）。宁可血量是兜底值，也要让它出现在敌人列表里。
 *   - `max` 与 `hp` 一定同时给。只给 `hp` 会让血条上限被下游推成那个数，
 *     之后"回血"就回不过去。
 *   - 名字为空的一律丢掉：`applyDeltas` 会拒，这里先滤掉省得产生一堆 rejected 噪声。
 */
export function castFromBestiary(
  entries: readonly BestiaryEntry[],
  names: readonly string[]
): { target: string; op: 'add'; value: Foe; reason: string }[] {
  const out: { target: string; op: 'add'; value: Foe; reason: string }[] = [];
  const seen = new Set<string>();
  for (const raw of names ?? []) {
    const name = String(raw ?? '').trim();
    if (!name) continue;
    // 同一轮里重复点名同一只 → 只投一次（模型有时会在正文与 delta 里各写一遍）
    const key = name.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    const hit = findEntry(entries, name);
    const hp = Math.max(1, Math.floor(hit?.hp ?? DEFAULT_HP));
    out.push({
      target: 'combat.foes',
      op: 'add',
      value: { name, hp, max: hp },
      reason: hit ? `按敌对者表的数值入场（${name}）` : `敌对者表里没有，按默认生命入场（${name}）`,
    });
  }
  return out;
}

/**
 * 战斗一开始该投哪些敌人。
 *
 * 判据：**表里所有的、有名字的**。听起来粗暴，但这是刻意的——
 * 引擎不会读心，不知道"这一场该来两只还是五只"。让作者用 `castFromBestiary(table, ['甲','乙'])`
 * 显式点名，或在战斗开始时给出当前场景里该出现的那几只。
 * 这个函数只做"表里全部"这一种最常用的取法，供"全部登场"的场合调用。
 */
export function allNamedEntries(entries: readonly BestiaryEntry[]): string[] {
  return (entries ?? []).map((e) => e.name.trim()).filter(Boolean);
}

/**
 * 图鉴可见度。
 *
 * 三档由两个集合推出（都是**事实记录**，不是推断）：
 *   - 玩家**遇到过**（`encountered` 里有它的名字）→ 'seen'：名字、外观、行为都可见；
 *   - 玩家**交过手**（`fought` 里有）→ 'fought'：连弱点也给他看。
 *
 * 为什么"见过"与"交手过"要分开：**弱点是活路**。
 * 只是远远看见一只东西，不该知道"怕火"；真正打起来、试出来了，
 * 那才是玩家自己挣到的信息。提前给 = 把谜底写在谜面上。
 */
export function sightOf(
  name: string,
  encountered: readonly string[],
  fought: readonly string[]
): SightLevel {
  const t = String(name ?? '').trim();
  if (!t) return 'none';
  const has = (list: readonly string[]) =>
    (list ?? []).some((x) => {
      const n = String(x ?? '').trim();
      return n === t || (n.length >= 2 && t.length >= 2 && (n.includes(t) || t.includes(n)));
    });
  if (has(fought)) return 'fought';
  if (has(encountered)) return 'seen';
  return 'none';
}

/**
 * 这一局结档了没有 —— 图鉴的**总开关**。
 *
 * 与导出那条口径完全一致：**没结档就不给看**。
 * 理由不必多想：这一局还在跑，图鉴里的"弱点""怎么退"就是明天的答案。
 */
export function bestiaryUnlocked(ending: { text?: string } | null | undefined): boolean {
  return Boolean(ending && (ending.text ?? '').trim());
}

/**
 * 图鉴条目的一行摘要（只给"解锁之后"的字段）。
 *
 * 注意这里**会**根据可见度裁字段：`seen` 不给 weakness。
 * 这是本文件里唯一一处"按可见度输出"的地方，UI 不许自己再判一次——
 * 判两次迟早会有一处忘了判，然后就漏了。
 */
export interface BestiaryCard {
  name: string;
  look?: string;
  hp?: number;
  attack?: string;
  behavior?: string;
  /** 只有交手过才有值 */
  weakness?: string;
  level: SightLevel;
}

export function bestiaryCard(
  entry: BestiaryEntry,
  encountered: readonly string[],
  fought: readonly string[]
): BestiaryCard {
  const level = sightOf(entry.name, encountered, fought);
  return {
    name: entry.name,
    look: entry.look,
    hp: entry.hp,
    attack: entry.attack,
    behavior: entry.behavior,
    // 没见过就不能有弱点 —— 这一行是 G5 的代码化，别删
    weakness: level === 'fought' ? entry.weakness : undefined,
    level,
  };
}

/** 图鉴整页的视图数据（组件拿去直接画，不需要自己再算一遍） */
export interface BestiaryView {
  /** 结档了才有权看整本 */
  unlocked: boolean;
  cards: BestiaryCard[];
  /** 照过面或交过手的条目数 */
  seen: number;
  /** 真交过手的条目数 */
  fought: number;
  /** 表里的条目总数（含未遭遇的） */
  total: number;
}

/**
 * 把"模组敌对者表 + 两本台账 + 结档状态"算成整页视图。
 *
 * ## 一定要在这里算，不要在组件里现算（2026-09-17 线上事故的教训）
 * 这个函数**每次调用都返回新对象**（`cards` 也是新数组）。
 * React 组件里若这么写：
 *
 * ```tsx
 * const view = useStore((s) => s.bestiary());   // ✗ 死循环
 * ```
 *
 * zustand 默认按 `Object.is` 比引用，新对象永远"不相等" → 每次渲染都触发一次
 * setState → React 抛 `Minified React error #185`（超出最大更新深度）→
 * **根节点直接卸载，整页空白**。手机端还叠上 SW 自愈，表现为"卡在自动更新"。
 *
 * 正确写法：组件选**稳定切片**（`s.module.monsters` / `s.gameState.encountered` …），
 * 再用 `useMemo` 调本函数。
 */
export function buildBestiary(
  entries: readonly BestiaryEntry[],
  encountered: readonly string[] = [],
  fought: readonly string[] = [],
  ending?: { text?: string } | null
): BestiaryView {
  const enc = encountered ?? [];
  const fgt = fought ?? [];
  const cards = (entries ?? [])
    .filter((e) => (e?.name ?? '').trim())
    .map((e) => bestiaryCard(e, enc, fgt));

  // 交过手的排最前，其次见过的，没遭遇的沉底；同档按名字排 —— 顺序必须稳定，
  // 否则每次渲染顺序都可能变（那又是一次无谓的重渲染）
  const rank = (l: SightLevel) => (l === 'fought' ? 0 : l === 'seen' ? 1 : 2);
  cards.sort((a, b) => rank(a.level) - rank(b.level) || a.name.localeCompare(b.name));

  return {
    unlocked: bestiaryUnlocked(ending),
    cards,
    seen: cards.filter((c) => c.level !== 'none').length,
    fought: cards.filter((c) => c.level === 'fought').length,
    total: cards.length,
  };
}
