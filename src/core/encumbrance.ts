/**
 * 负重系统。
 *
 * 三件事：
 *   ① 每件东西有重量（缺省 1）——旧档没有这个字段，一律按 1 兜底；
 *   ② 上限由**规则包**派生（COC 看力量+体格，DnD 看力量）——规则包没给就不启用，不惩罚；
 *   ③ 超重影响**检定目标值**与叙事（移动）——罚的是目标值，跟描述加权同一套量纲。
 *
 * 为什么罚目标值而不是"难度档"：与 `description.ts` 同理，
 * 难度不是玩家能选的东西，改它等于让系统替玩家宣布"这次很难"。
 * 改目标值则是确定性的、可见的、引擎算的。
 */

import type { InventoryItem } from './state/gameState.js';

/** 单件重量：老存档没这个字段时按 1 兜底（一件小东西 = 1 单位） */
export function itemWeight(it: Pick<InventoryItem, 'weight'> | undefined): number {
  const w = Number(it?.weight);
  return Number.isFinite(w) && w > 0 ? w : 1;
}

/** 背包总负重 = Σ（单件重量 × 数量） */
export function totalLoad(inventory: readonly Pick<InventoryItem, 'weight' | 'qty'>[]): number {
  return (inventory ?? []).reduce(
    (sum, it) => sum + itemWeight(it) * Math.max(1, Number(it?.qty) || 1),
    0
  );
}

/** 超重档位：0 未超 / 1 超重 / 2 严重超重 */
export type EncumbranceTier = 0 | 1 | 2;

export interface Encumbrance {
  /** 当前负重 */
  load: number;
  /** 上限；规则包没给（null）＝这套规则不启用负重 */
  capacity: number | null;
  tier: EncumbranceTier;
  /** 目标值修正量，**负数＝更难** */
  penalty: number;
  /** 一句话状态，界面直接显示 */
  label: string;
}

/** 目标值修正量：百分比规则（d100） */
const PENALTY_PERCENT: Record<EncumbranceTier, number> = { 0: 0, 1: -10, 2: -20 };
/** 目标值修正量：加值规则（d20 之类） */
const PENALTY_MODIFIER: Record<EncumbranceTier, number> = { 0: 0, 1: -1, 2: -2 };

/**
 * 超过上限多少算"严重"。
 * 1.5 倍：留一档缓冲，玩家多捡一两件不该立刻被打死，
 * 但也不能太宽——宽了这条规则就形同不存在。
 */
const HEAVY_RATIO = 1.5;

/** 保留一位小数，去掉 0（7.0 → 7） */
function trim(n: number): string {
  return String(Math.round(n * 10) / 10);
}

export function encumbranceOf(
  inventory: readonly Pick<InventoryItem, 'weight' | 'qty'>[],
  capacity: number | null,
  mode: 'percent' | 'modifier' = 'percent'
): Encumbrance {
  const load = totalLoad(inventory);
  // 规则包没给上限 → 这套规则不管负重，一律不惩罚（"无上限则不惩罚"）
  if (capacity === null || !Number.isFinite(capacity) || capacity <= 0) {
    return { load, capacity: null, tier: 0, penalty: 0, label: '不限负重' };
  }
  const tier: EncumbranceTier = load <= capacity ? 0 : load <= capacity * HEAVY_RATIO ? 1 : 2;
  const table = mode === 'percent' ? PENALTY_PERCENT : PENALTY_MODIFIER;
  const label =
    tier === 0
      ? `负重 ${trim(load)} / ${trim(capacity)}`
      : tier === 1
        ? `超重 ${trim(load)} / ${trim(capacity)}`
        : `严重超重 ${trim(load)} / ${trim(capacity)}`;
  return { load, capacity, tier, penalty: table[tier], label };
}

/**
 * 给守密人的一句话（只在超重时注入）。
 * 刻意**不给数字**：负重是一种体感，写"目标值 -10"会跳出故事。
 */
export function encumbranceNote(e: Encumbrance): string | null {
  if (e.tier === 0 || e.capacity === null) return null;
  const level = e.tier === 2 ? '严重超重' : '超重';
  return (
    `【负重】玩家身上带的东西${level}了（${e.label}）。` +
    '这会在故事里体现出来：走路更慢、更容易喘、爬高钻低会碍事，' +
    '被追时甩不掉人，长时间赶路会累。**不要写任何数字或"负重/惩罚"这类词**，' +
    '只把它写成身体上的吃力与不顺手。也不要因此替玩家做决定——' +
    '他可以就地扔东西、找人帮忙，或者硬扛。'
  );
}
