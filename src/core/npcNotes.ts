/**
 * NPC 档案（`GameState.npcNotes`）的**名字匹配**与**容量淘汰**。
 *
 * ## 为什么要有这个文件
 *
 * 档案是守密人**一轮一轮随手记**的（"老霍华德 role = 码头工头"）。长局跑下来
 * 它会无限长，而它会被写进提示词 —— 一份 80 人的名单塞给模型，
 * 只会把真正还在场的那几个人淹掉。所以要有个上限。
 *
 * ## 淘汰判据（用户 09-17 拍板，不许改）
 *
 * 1. **上限 30 条**；
 * 2. 淘汰"**最久未接触**"的那一条；
 * 3. **在场者永不淘汰** —— 一个人还站在你面前，他的档案就不能被丢掉
 *    （丢了他就变成"你只知道有这么个人"的陌生人，等于凭空失忆）。
 *
 * ## "最久未接触"怎么算
 *
 * 档案上只有两个时间信号：`met`（首次照面的回合）与 `seen`（最后一次接触的回合，
 * **引擎写**，本文件新增）。`seen` 更准，所以排序键是 `seen ?? met`，
 * **越小 = 越久没接触 = 越先淘汰**；两个都没有的当作最久（`−Infinity`）先走。
 *
 * ## 为什么 `seen` 是可选新增字段
 *
 * 旧存档里没有它，读到是 `undefined`，`seen ?? met` 自动退回首次照面的回合 ——
 * **不升 `SAVE_VERSION`**（既定判据：可选新增不升，替换/重命名才升）。
 */

import type { Companion, NpcNote } from './state/gameState.js';

/** 档案上限。超过就开始淘汰"最久未接触且不在场"的人 */
export const NPC_NOTES_LIMIT = 30;

/** 名字上常见的称呼后缀（"霍华德先生"）*/
const NAME_SUFFIX_RE =
  /(先生|女士|小姐|太太|夫人|老板|师傅|大叔|大婶|大妈|大爷|大娘|同学|老师|医生|探长|警长|队长)$/;
/** 名字上常见的亲昵前缀（"老霍华德""小王"）*/
const NAME_PREFIX_RE = /^(老|小|阿)/;

/**
 * 名字的"核心"，用来做宽松匹配。
 *
 * 模型写人名很不统一：同一轮里可能一会儿"老霍华德"、一会儿"霍华德先生"。
 * 严格相等会让档案经常对不上人（在场名单里叫"霍华德"，档案键是"老霍华德"，
 * 于是**在场判定失效**、档案被当成离场者淘汰掉）。
 */
export function npcNameKey(raw: string): string {
  return raw.trim().replace(NAME_PREFIX_RE, '').replace(NAME_SUFFIX_RE, '').trim();
}

/** 两个名字指的是不是同一个人 */
export function sameNpcName(a: string, b: string): boolean {
  if (a === b) return true;
  const ka = npcNameKey(a);
  const kb = npcNameKey(b);
  if (ka === kb) return true;
  // 核心太短（一两个字）时不比"包含"，避免"王"对上"汪三"
  if (ka.length < 2 || kb.length < 2) return false;
  return ka.includes(kb) || kb.includes(ka);
}

/**
 * 此刻"在场"的人 —— 在场名单 + 同行者（在世且跟着的）。
 *
 * 同行者算在场：他一路跟着玩家，说"最久未接触"时不该把他算进去。
 */
export function presentNpcNames(gs: {
  npcsAlive?: readonly string[];
  companions?: readonly Companion[];
}): string[] {
  const alive = gs.npcsAlive ?? [];
  const mates = (gs.companions ?? [])
    .filter((c) => c.alive !== false && c.present !== false)
    .map((c) => c.name);
  return [...alive, ...mates];
}

/** 档案上一次"接触"的回合（没有则退回首次照面；都没有就是最久） */
export function lastContact(n: NpcNote | undefined): number {
  if (!n) return Number.NEGATIVE_INFINITY;
  if (typeof n.seen === 'number' && Number.isFinite(n.seen)) return n.seen;
  if (typeof n.met === 'number' && Number.isFinite(n.met)) return n.met;
  return Number.NEGATIVE_INFINITY;
}

/**
 * 给**在场**的人打上"本轮接触过"的时间戳。
 *
 * 只在真的有人被更新时才返回新对象（否则返回原引用）——
 * 引擎每轮都会过这里，返回新引用会让 React 无谓重渲染。
 */
export function touchNpcNotes(
  notes: Record<string, NpcNote> | undefined,
  present: readonly string[],
  turn: number
): Record<string, NpcNote> {
  if (!notes || Object.keys(notes).length === 0) return notes ?? {};
  if (present.length === 0) return notes;

  let changed = false;
  const next: Record<string, NpcNote> = {};
  for (const [name, note] of Object.entries(notes)) {
    const isPresent = present.some((p) => sameNpcName(p, name));
    if (isPresent && note.seen !== turn) {
      next[name] = { ...note, seen: turn };
      changed = true;
    } else {
      next[name] = note;
    }
  }
  return changed ? next : notes;
}

/**
 * 超限时淘汰"最久未接触且不在场"的人。
 *
 * - **在场者永不淘汰**：候选里没有离场者时（全员在场），**宁可超限也不删** ——
 *   删一个站在你面前的人的档案，比名单长一点糟糕得多。
 * - 同分时按名字排序，保证**同一个输入永远得到同一个结果**（便于单测，也免得
 *   档案顺序在界面上乱跳）。
 */
export function pruneNpcNotes(
  notes: Record<string, NpcNote> | undefined,
  present: readonly string[],
  limit: number = NPC_NOTES_LIMIT
): { notes: Record<string, NpcNote>; dropped: string[] } {
  const src = notes ?? {};
  const keys = Object.keys(src);
  if (keys.length <= limit) return { notes: src, dropped: [] };

  const isPresent = (name: string) => present.some((p) => sameNpcName(p, name));
  const candidates = keys.filter((k) => !isPresent(k));
  if (candidates.length === 0) return { notes: src, dropped: [] };

  candidates.sort((a, b) => {
    const d = lastContact(src[a]) - lastContact(src[b]);
    return d !== 0 ? d : a.localeCompare(b);
  });

  const overflow = keys.length - limit;
  const dropped = candidates.slice(0, overflow);
  if (dropped.length === 0) return { notes: src, dropped: [] };

  const out: Record<string, NpcNote> = {};
  for (const k of keys) {
    if (dropped.includes(k)) continue;
    const note = src[k];
    if (note) out[k] = note;
  }
  return { notes: out, dropped };
}
