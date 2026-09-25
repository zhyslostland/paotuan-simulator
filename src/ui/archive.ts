/**
 * 角色档案库（Phase 2）：**换团不丢人设**。
 *
 * ## 为什么需要它
 * 现在一张角色卡只活在 `trpg.character` 这一个格子里：换一张卡，上一张就没了。
 * 一个人自用玩久了必然会出现"这张卡我还想再跑一个模组"——
 * 按北极星①，让玩家**攒得下自己捏过的人**，属于框架该接住的一类合理期待。
 *
 * ## 三条口径
 * 1. **档案库独立于单局存档**：它跟生涯一样，活在**单独一个 key** 里。
 *    单局存档会被"开新团"清、会被回溯重写，档案库不该跟着动。
 * 2. **同一个名字＝同一张卡**：再存一次是**更新**（沿用原 id 与创建时间），
 *    不是新开一张 —— 否则改一个字就多出一张重名卡，列表很快就没法看了。
 * 3. **纯函数**：喂一个数组就能算，不碰 store、不碰 localStorage，
 *    所以判据能单测（与 `snapshotPrune` / `runSummary` 同一条口径）。
 */

import type { CharacterProfile } from './store.js';

export interface ArchivedCharacter {
  /** ＝归一化后的名字（见 `characterKey`）。名字就是钥匙 */
  id: string;
  name: string;
  /** 第一次存进来的时刻 */
  createdAt: string;
  /** 最后一次更新的时刻 */
  savedAt: string;
  /** 存档时用的规则包（换规则后提示"这张卡不是按当前规则算的"） */
  rulesetId?: string;
  profile: CharacterProfile;
}

/** 档案库上限。超了丢**最久没动过**的那张，不是丢最旧的（常用的要留住） */
export const ARCHIVE_LIMIT = 24;

/** 名字归一：首尾空白与连续空白不算区别，大小写也不算 */
export function characterKey(name: string): string {
  return (name ?? '').trim().replace(/[\s\u3000]+/g, ' ').toLowerCase();
}

/** 按 id 取一张卡 */
export function findCharacter(
  list: readonly ArchivedCharacter[],
  id: string
): ArchivedCharacter | undefined {
  return list.find((c) => c.id === id);
}

/**
 * 存一张卡（同名＝更新）。
 *
 * @returns 新的列表、入库的那条、以及**是不是覆盖了原有的同名卡**
 */
export function upsertCharacter(
  list: readonly ArchivedCharacter[],
  profile: CharacterProfile,
  opts: { rulesetId?: string; now?: string } = {}
): { list: ArchivedCharacter[]; entry: ArchivedCharacter; replaced: boolean } {
  const now = opts.now ?? new Date().toISOString();
  const name = (profile?.name ?? '').trim() || '无名的调查员';
  const id = characterKey(name);

  const prev = findCharacter(list, id);
  const entry: ArchivedCharacter = {
    id,
    name,
    createdAt: prev?.createdAt ?? now,
    savedAt: now,
    rulesetId: opts.rulesetId ?? prev?.rulesetId,
    /*
     * 存的是**一份快照**（深拷一层）而不是引用。
     * 引用会让"我在准备页继续改属性"实时改到档案库里那张卡上 ——
     * 存档这件事必须留痕，否则玩家想把卡改回去时就没有"原来那张"了。
     * 只需一层：`characteristics` / `skills` 这类是会被整体替换的平面对象，
     * 引擎改属性时一律造新对象（`{ ...c, characteristics: {...} }`），不会原地改。
     */
    profile: {
      ...profile,
      characteristics: { ...(profile.characteristics ?? {}) },
      skills: { ...(profile.skills ?? {}) },
      items: [...(profile.items ?? [])],
      itemDetails: (profile.itemDetails ?? []).map((d) => ({ ...d })),
    },
  };

  const rest = list.filter((c) => c.id !== id);
  const next = [entry, ...rest];
  return {
    list: next.length > ARCHIVE_LIMIT ? pruneArchive(next) : next,
    entry,
    replaced: Boolean(prev),
  };
}

/**
 * 裁剪：超上限时丢**最久没动过**的那张。
 *
 * 为什么不是"丢最旧的"：`createdAt` 早的那张很可能是玩家一直在用的主角卡，
 * 而按 `savedAt` 丢，丢掉的必然是**最久没碰**的。
 * 而当前正在用的那张由调用方先存进来（`savedAt` 最新），天然受保护。
 */
export function pruneArchive(
  list: readonly ArchivedCharacter[],
  limit: number = ARCHIVE_LIMIT
): ArchivedCharacter[] {
  if (list.length <= limit) return [...list];
  const sorted = [...list].sort((a, b) => (a.savedAt < b.savedAt ? 1 : -1));
  return sorted.slice(0, limit);
}

/** 删一张卡 */
export function removeCharacter(
  list: readonly ArchivedCharacter[],
  id: string
): ArchivedCharacter[] {
  return list.filter((c) => c.id !== id);
}

/** 列表排序：最近动过的在前（界面直接用这个顺序） */
export function listArchive(list: readonly ArchivedCharacter[]): ArchivedCharacter[] {
  return [...list].sort((a, b) => (a.savedAt < b.savedAt ? 1 : -1));
}

/** 卡片上那句简介：取描述的开头一小截（没有描述时给一句人话，不显示空白） */
export function archiveBlurb(entry: ArchivedCharacter, max = 28): string {
  const raw = (entry.profile?.description ?? '').trim().replace(/\s+/g, ' ');
  if (!raw) return '（没有写描述）';
  return raw.length > max ? `${raw.slice(0, max)}…` : raw;
}

/**
 * 这张卡跟当前的规则包**对不对得上**。
 *
 * 换规则包是允许的（规则可插拔），但属性/技能是按当时的规则算的，
 * 直接拿来用会得到一堆对不上的技能名。界面据此给一句提示，
 * **不阻止玩家用**（那是他的卡，他有权决定）。
 */
export function matchesRuleset(
  entry: ArchivedCharacter,
  rulesetId: string | undefined
): boolean {
  if (!entry.rulesetId || !rulesetId) return true;
  return entry.rulesetId === rulesetId;
}
