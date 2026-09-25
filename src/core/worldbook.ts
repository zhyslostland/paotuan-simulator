/**
 * 世界书条目的**来源判据**（换模组时谁该撤、谁该留）。
 *
 * ## 为什么要有这一份
 * 主人 2026-09-20 试玩时撞到：**用「AI 一键生成模组」换了一个新模组，上一个模组的地点还留在世界书里**。
 * 根因是"哪些条目属于上一个模组"这个判据散在两处、而且两处写得不一样：
 * - `store.applyModule()` 撤 `fromModule` + `mw-` + `sample-` 前缀；
 * - `Preparation` 生成完模组包后，只按 `!fromModule` 保留 —— **把刚装上、带 `mw-` 前缀的又加回去了**。
 *
 * 于是撤了又装回来，旧模组的地点永远清不掉。判据必须**只有一份**，两边共用。
 *
 * ## 三类来源
 * | 来源 | 标记 | 换模组时 |
 * |---|---|---|
 * | AI 单独生成的模组包（`fromModule: true`） | `fromModule` | **撤** |
 * | 模组自带的世界书（装回时统一打 `mw-` 前缀） | id 前缀 `mw-` | **撤** |
 * | 内置示例（`sample-`，开局给玩家看的示范条目） | id 前缀 `sample-` | **撤**（它属于开局那个示例世界，不是玩家写的） |
 * | 玩家自己手加的 | 以上都没有 | **不动**（"开新团不清世界书"那条铁律保的就是它） |
 *
 * ⚠️ 上面这行 `sample-` 曾写错过一次（注释写"不动"、代码写"撤"）。
 * **以代码为准**：示范条目跟着模组一起撤，换到一个新世界时不该留着"示例小镇"。
 *
 * ## 与「开新团不清世界书」的关系
 * 那条铁律说的是**同一个模组重开**：那是这个世界的记忆，要留。
 * 这里说的是**换了一个模组**：上一个世界的地点、人物不该跟着搬过来。
 * 两者不冲突 —— 清理只在"换模组"这一个动作上发生（`applyModule` 及其配套装载）。
 */

import type { WorldbookEntry } from './types.js';

/** 模组自带的条目：装回世界书时统一打这个前缀，靠它认领 */
export const MODULE_WB_PREFIX = 'mw-';
/** 内置示例条目：开局给玩家看的示范，跟着模组一起撤（不含玩家写的东西） */
export const SAMPLE_WB_PREFIX = 'sample-';

/** 这条是不是**玩家自己手加**的（换模组时要保住） */
export function isManualWorldbookEntry(e: WorldbookEntry): boolean {
  if (e.fromModule) return false;
  const id = e.id ?? '';
  return !id.startsWith(MODULE_WB_PREFIX) && !id.startsWith(SAMPLE_WB_PREFIX);
}

/** 撤掉"属于某个模组"的条目，只留玩家手写的与内置示例 */
export function stripModuleWorldbook(list: WorldbookEntry[]): WorldbookEntry[] {
  return list.filter(isManualWorldbookEntry);
}

/* ============================================================
 * 1.0 阶段 A：注入的**时机与位置**由玩家说了算。
 *
 * 以前只有「关键词命中 + 优先级 + 上限 8 条」一种玩法：
 *   - 世界底层设定（魔法规则、城市规矩）**提起来才在**，不提就不在 —— 最反直觉的一处；
 *   - `limit=8` 数的是**条数**不是字数，一条超长条目能把预算吃光。
 *
 * 现在四件事都能控制：
 *   ① `constant` 常驻 —— 不看关键词，每轮都在；
 *   ② `budget` 预算 —— 按字数抢占，超了先裁优先级低的；
 *   ③ `depth` 插入深度 —— 0 贴着 system，越大越靠近当前对话；
 *   ④ `group` 分组 —— 整组开关。
 *
 * ⚠️ 这个函数从 `orchestrator/prompt.ts` 搬过来：core 是纯函数、不许反向依赖 ui，
 *    判据只有一份，界面与提示词共用。
 * ============================================================ */

/** 一条目该占多少字（预算没给就按实际长度算） */
function costOf(e: WorldbookEntry): number {
  const c = e.content?.length ?? 0;
  const b = typeof e.budget === 'number' && e.budget > 0 ? e.budget : 0;
  return b > 0 ? Math.min(c, b) : c;
}

/** 命中关键词了吗（常驻条目一律算命中） */
function hits(e: WorldbookEntry, text: string): boolean {
  if (e.constant) return true;
  return e.keys.some((k) => k.trim() !== '' && text.includes(k.trim()));
}

/**
 * 挑出这一轮要注入的世界书条目，并按 `depth` 分好层。
 *
 * 返回**按深度分好的组**：`[0]` 是最靠 system 的一层，下标越大越靠近当前对话。
 * 调用方（提示词）只管按顺序拼进去，不再自己判关键词。
 *
 * @param entries 全部条目
 * @param context 最近几轮的正文（用来判关键词命中）
 * @param limit 最多几条（**条数**，与 `budget` 的字数预算是两回事）
 * @param totalBudget 总字数预算（0 ＝ 不限制）
 */
export function selectWorldbook(
  entries: readonly WorldbookEntry[],
  context: readonly string[],
  limit = 8,
  totalBudget = 0
): WorldbookEntry[] {
  const text = context.join('\n');
  const picked: WorldbookEntry[] = [];
  let spent = 0;

  // 优先级高的先挑；同优先级时**常驻优先**（它是世界的底层设定，不该被临时的条目挤掉）
  const sorted = entries
    .filter((e) => e.enabled)
    .filter((e) => hits(e, text))
    .sort((a, b) => {
      if (b.priority !== a.priority) return b.priority - a.priority;
      return Number(!!b.constant) - Number(!!a.constant);
    });

  for (const e of sorted) {
    if (picked.length >= limit) break;
    const c = costOf(e);
    // 总预算用尽就停 —— 但**别为了塞更多条目去砍内容**：宁少勿爆
    if (totalBudget > 0 && spent + c > totalBudget) continue;
    picked.push(e);
    spent += c;
  }
  return picked;
}

/**
 * 按插入深度分层：`0` 贴 system，数字越大越靠近当前对话。
 *
 * 为什么要有它：全塞在同一处时，刚生成的内容最容易盖掉世界设定 ——
 * 而世界设定恰恰是"不能被盖掉"的那种。
 */
export function worldbookByDepth(list: readonly WorldbookEntry[]): WorldbookEntry[][] {
  const buckets = new Map<number, WorldbookEntry[]>();
  for (const e of list) {
    const d = Math.max(0, Math.floor(e.depth ?? 0));
    const arr = buckets.get(d) ?? [];
    arr.push(e);
    buckets.set(d, arr);
  }
  return [...buckets.entries()].sort((a, b) => a[0] - b[0]).map(([, v]) => v);
}

/** 这一组里有哪些分组名（给界面做整组开关用） */
export function worldbookGroups(list: readonly WorldbookEntry[]): string[] {
  return [...new Set(list.map((e) => e.group?.trim()).filter((g): g is string => !!g))];
}
