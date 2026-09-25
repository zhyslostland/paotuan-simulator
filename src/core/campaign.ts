/**
 * 世界层（Phase 2）：让**故事能接着上一次跑**。
 *
 * ## 它解决的是哪一类"合理期待"
 * 玩家跑完一个模组、开了新团，会自然地期待"这个世界记得上次的事"——
 * 上次离开的那个地方还在、当时活着的人还活着、没结的支线还挂着。
 * 现在开新团是**一律清空**的，世界每次都被重置成第一天。
 * 按北极星①：这是"框架该接住的一类行动"，不是花活。
 *
 * ## 三条铁律（写死，免得后来膨胀）
 * 1. **只在会话边界搬运**：进团时把四样灌进 `GameState`、结档时收回来。
 *    **局中绝不双写** —— 否则又多出一个"两个真源"，迟早对不上。
 * 2. **不放进 `GameState` 里面**：世界是**外面**的一层。
 *    `GameState` 一变结构就要动 `SAVE_VERSION` + 写迁移，那是最贵的改动。
 * 3. **跨团传递的只有四样**：地点 / 在场人物 / 支线 / 标记。
 *    别把背包、数值、伤口也搬过去 —— 那是**这一局**的事，不是世界的事。
 *
 * ## 为什么世界按"名字"认
 * 一个人自用，脑子里认的就是"我那个雾港的故事"。
 * 所以世界的钥匙＝**归一化之后的名字**：界面只提供"选一个已有的世界"或
 * "打一个新名字"，玩家永远不会在不知情的情况下丢掉一整个世界的历史。
 */

import type { GameState, Thread } from './state/gameState.js';
import type { OutcomeKind } from './career.js';
import { OUTCOME_LABEL } from './career.js';

/**
 * 跨局传递的**四样**（铁律③）。
 *
 * 每一项都能回答"世界还记得什么"：
 * 上次在哪儿、谁还活着、什么事没办完、拉过哪些开关。
 */
export interface WorldSnapshot {
  location: string;
  npcsAlive: string[];
  threads: Thread[];
  flags: Record<string, unknown>;
}

/** 一局跑完之后记在世界履历上的一笔 */
export interface WorldRun {
  moduleTitle: string;
  characterName: string;
  outcome: OutcomeKind;
  /** 跑了多少回 */
  turns: number;
  /** 结档时刻（`Ending.at`），同时用于去重与排序 */
  at: string;
  /** 守密人给的收束理由（"你上了救生艇并划离了货船"），可空 */
  note?: string;
}

export interface World {
  /** ＝`worldKey(name)`。名字就是钥匙 */
  id: string;
  name: string;
  /** 最后一次收档的时间（列表排序用） */
  updatedAt: string;
  /** 收上来的那四样。**还没结过档的世界没有它** */
  snapshot?: WorldSnapshot;
  /** 履历，**最近的在前**。上限 `WORLD_RUN_LIMIT` */
  runs: WorldRun[];
  /** 在这个世界里跑过的模组名（去重），用来提示"这个模组你已经跑过" */
  modules: string[];
}

/** 履历上限。留下"我在这里干过什么"，但不无限长 */
export const WORLD_RUN_LIMIT = 30;

/**
 * **每局账**：这些东西绝不能跨团带过去。
 *
 * 它们是**上一局的伤势与状态**：把 `伤口` 带进新团，玩家一开局就在流血；
 * 带上 `临时疯狂`，新团第一轮就带着理智惩罚 —— 那不是连续性，那是 bug。
 * （键名与引擎在 `store` 里写的保持一致，改引擎时记得同步这里。）
 *
 * ⚠️ 2026-09-19：这张表现在**只用于文档与断言**，实际过滤已改由 `WORLD_FLAG_PREFIX`
 * 白名单完成 —— 黑名单挡不住模型发明的新键名（写个「邪祟缠身」照样漏网），
 * 所以反过来：**没有显式声明 `世界.` 前缀的标记，一律不带过局**。
 */
export const RUN_SCOPED_FLAGS: readonly string[] = [
  '临时疯狂',
  '疯狂轮数',
  '伤口',
  '受伤',
  '伤口处理',
  '永久疯狂',
  '濒死',
  '濒临死亡',
];

/**
 * 跨局标记的**唯一通道**：只有 `世界.xxx` 这种键名会被世界记住。
 *
 * 为什么是白名单：模型能发明任意键名，任何"已知每局账"的清单都赶不上它。
 * 反过来约定 —— **想让下一局还记得，就显式写 `世界.某某`**；
 * 没写前缀的一律是"这一局的事"（伤口、中毒、流血、临时状态，全在此列）。
 *
 * 界面显示时前缀保留（玩家看到「世界.船主的账本」也知道它是跨局的），
 * 引擎不剥前缀 —— 剥了就分不清是谁声明的。
 */
export const WORLD_FLAG_PREFIX = '世界.';

/** 世界名归一：全角空格、连续空白、大小写都不算区别 */
export function worldKey(name: string): string {
  return name.trim().replace(/[\s\u3000]+/g, ' ').toLowerCase();
}

/** 世界名默认取模组名（玩家没起名时） */
export function defaultWorldName(moduleTitle: string): string {
  const t = (moduleTitle ?? '').trim();
  return t || '未命名的世界';
}

/** 按名字找回一个世界（认不出返回 undefined，调用方据此当"新世界"） */
export function findWorld(worlds: readonly World[], name: string): World | undefined {
  const key = worldKey(name);
  if (!key) return undefined;
  return worlds.find((w) => w.id === key);
}

/** 新世界：只有名字，没有留档、没有履历 */
export function emptyWorld(name: string, now: string = new Date().toISOString()): World {
  const display = (name ?? '').trim() || '未命名的世界';
  return { id: worldKey(display), name: display, updatedAt: now, runs: [], modules: [] };
}

/** 世界列表：按最后收档时间倒序（界面直接用这个顺序） */
export function listWorlds(worlds: Record<string, World>): World[] {
  return Object.values(worlds).sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : -1));
}

/** 去掉空白与重复，保持原顺序 */
function dedupe(list: readonly string[] | undefined): string[] {
  const out: string[] = [];
  for (const raw of list ?? []) {
    const t = (raw ?? '').trim();
    if (!t || out.includes(t)) continue;
    out.push(t);
  }
  return out;
}

/**
 * 还没了结的支线。
 *
 * 只有"已了结 / 已完成 / 已解决 / 结束"这类字样的算结清 —— 判据故意**宽进严出**：
 * 认不出来的状态一律当**还挂着**（带过去顶多多一行提示），
 * 反过来把没办完的事当办完了，玩家就永远想不起它来。
 */
export function openThreads(threads: readonly Thread[] | undefined): Thread[] {
  const CLOSED = /已了结|已完成|已解决|已结束|已放弃|结清|closed|done/i;
  return (threads ?? [])
    .filter((t) => (t?.name ?? '').trim())
    .filter((t) => !CLOSED.test(t.status ?? ''))
    .map((t) => ({ name: t.name.trim(), status: (t.status ?? '').trim() }));
}

/** 能跨团带的标记：**只放行 `世界.` 前缀**（白名单，不是黑名单） */
export function carriedFlags(
  flags: Record<string, unknown> | undefined
): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(flags ?? {})) {
    if (!k.startsWith(WORLD_FLAG_PREFIX)) continue;
    out[k] = v;
  }
  return out;
}

/**
 * 把世界留档灌进**刚开的**这一局（铁律①：只在会话边界做一次）。
 *
 * 合并口径（每一处都说明了为什么）：
 * - **地点**：用上次离开的地方。模组自己的开场地点会留在"去过的地方"里，
 *   地图不会因此丢东西。
 * - **在场人物**：**取并集**（本局开场的人 + 世界记得还活着的人，本局的在前）。
 *   取并集而不是替换：世界记得的人不该因为换了模组就凭空消失；
 *   本局开场的人也必须真在场。
 * - **支线**：只带**没结清**的（见 `openThreads`）。
 * - **标记**：世界那份在下、本局开局那份在上（撞键以本局为准）；
 *   每局账（伤口 / 疯狂）一律不进来。
 */
export function applySnapshot(
  gs: GameState,
  snapshot: WorldSnapshot | undefined
): GameState {
  if (!snapshot) return gs;

  const carried = (snapshot.location ?? '').trim();
  const here = carried || (gs.location ?? '').trim();
  const visited = dedupe([...(gs.visited ?? []), here]);

  return {
    ...gs,
    location: here || gs.location,
    visited,
    npcsAlive: dedupe([...(gs.npcsAlive ?? []), ...(snapshot.npcsAlive ?? [])]),
    threads: openThreads(snapshot.threads),
    flags: { ...carriedFlags(snapshot.flags), ...(gs.flags ?? {}) },
  };
}

/**
 * 结档时把这一局**收回**世界（铁律①的另一半）。
 *
 * 这是**唯一**写世界的地方。收什么＝`applySnapshot` 认的那四样，
 * 两边刻意用同一份口径 —— 能带出去的，就是当初能带进来的。
 */
export function harvest(
  world: World | undefined,
  name: string,
  gs: GameState,
  run: WorldRun
): World {
  const base = world ?? emptyWorld(name, run.at);
  const moduleTitle = (run.moduleTitle ?? '').trim();

  return {
    ...base,
    // 名字以玩家这次写的为准（选中已有世界时两者本来就一样）
    name: (name ?? '').trim() || base.name,
    updatedAt: run.at,
    snapshot: {
      location: (gs.location ?? '').trim(),
      npcsAlive: dedupe(gs.npcsAlive),
      threads: openThreads(gs.threads),
      flags: carriedFlags(gs.flags),
    },
    modules:
      moduleTitle && !base.modules.includes(moduleTitle)
        ? [...base.modules, moduleTitle]
        : base.modules,
    // 最近的在前；超上限丢最旧的（履历是回忆，不是账本）
    runs: [run, ...base.runs].slice(0, WORLD_RUN_LIMIT),
  };
}

/** 界面上最多列几个名字（再多就成流水账了） */
export const CARRY_PREVIEW_LIMIT = 6;

/**
 * 给界面看的"会带什么过去"。
 *
 * 没有留档返回 `null` —— 界面据此显示"这个世界还没有留档"，
 * 而不是显示一堆空行让人以为坏了。
 */
export function carryPreview(world: World | undefined): {
  location: string;
  npcs: string[];
  npcsMore: number;
  threads: Thread[];
  fallbackLocation: string;
} | null {
  const snap = world?.snapshot;
  if (!snap) return null;
  const npcs = (snap.npcsAlive ?? []).filter(Boolean);
  return {
    location: (snap.location ?? '').trim(),
    npcs: npcs.slice(0, CARRY_PREVIEW_LIMIT),
    npcsMore: Math.max(0, npcs.length - CARRY_PREVIEW_LIMIT),
    threads: openThreads(snap.threads),
    // 上次没记地点时界面给一句解释，别显示空白
    fallbackLocation: '（上次没记下地点）',
  };
}

/** 履历一行的人话（界面与导出共用，免得两处各写一遍） */
export function runLabel(run: WorldRun): string {
  const moduleTitle = (run.moduleTitle ?? '').trim() || '（未命名模组）';
  return `${moduleTitle} · ${OUTCOME_LABEL[run.outcome] ?? '收束'}`;
}

/** 这个世界跑过几局 */
export function worldRunCount(world: World | undefined): number {
  return world?.runs.length ?? 0;
}
