/**
 * 结构化游戏状态 —— 唯一真相来源
 *
 * 关键设计：模型输出的只是"变更意图"（state_delta），
 * 真正的数值计算与边界裁剪全部发生在这里，模型算的数一律不作数。
 */

import { roll, type Rng } from '../dice/index.js';
import type { Ruleset } from '../rulesets/types.js';

export interface InventoryItem {
  id: string;
  name: string;
  qty: number;
  note?: string;
}

export interface GameState {
  /** 生命 / 理智 / 魔法等数值条，key 由规则包定义 */
  vitals: Record<string, number>;
  inventory: InventoryItem[];
  /** 任意剧情开关，如 { metHank: true, basementUnlocked: false } */
  flags: Record<string, unknown>;
  /** 已获得的线索 */
  clues: string[];
  /** 当前地点 */
  location: string;
  /** 在场/存活的 NPC（死亡即移除，但事件日志会留痕） */
  npcsAlive: string[];
}

export type DeltaOp = 'set' | 'inc' | 'dec' | 'add' | 'remove';

export interface StateDelta {
  /** 点路径，如 vitals.san / flags.metHank / inventory / clues */
  target: string;
  op: DeltaOp;
  /** inc / dec 用，可以是数字或骰子表达式（如 "1d6"），由本地引擎求值 */
  amount?: number | string;
  /** set / add / remove 用 */
  value?: unknown;
  /** 变更理由，写进事件日志，便于回溯 */
  reason?: string;
}

export interface AppliedDelta {
  delta: StateDelta;
  /** 表达式求值后的实际数值（仅 inc/dec） */
  resolvedAmount?: number;
  before: unknown;
  after: unknown;
}

export interface RejectedDelta {
  delta: StateDelta;
  reason: string;
}

export interface ApplyReport {
  state: GameState;
  applied: AppliedDelta[];
  rejected: RejectedDelta[];
  /** 本轮掷过的骰子，用于渲染骰点动画 */
  rolls: { expression: string; total: number }[];
}

const ALLOWED_ROOTS = new Set([
  'vitals',
  'inventory',
  'flags',
  'clues',
  'location',
  'npcsAlive',
]);

export function createInitialState(overrides: Partial<GameState> = {}): GameState {
  return {
    vitals: {},
    inventory: [],
    flags: {},
    clues: [],
    location: '',
    npcsAlive: [],
    ...overrides,
  };
}

function deepClone<T>(v: T): T {
  return JSON.parse(JSON.stringify(v)) as T;
}

function getPath(root: unknown, path: string): unknown {
  return path.split('.').reduce<unknown>((acc, key) => {
    if (acc === null || typeof acc !== 'object') return undefined;
    return (acc as Record<string, unknown>)[key];
  }, root);
}

function setPath(root: Record<string, unknown>, path: string, value: unknown): void {
  const keys = path.split('.');
  let cur: Record<string, unknown> = root;
  for (let i = 0; i < keys.length - 1; i++) {
    const k = keys[i]!;
    if (cur[k] === null || typeof cur[k] !== 'object') cur[k] = {};
    cur = cur[k] as Record<string, unknown>;
  }
  cur[keys[keys.length - 1]!] = value;
}

function clamp(n: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, n));
}

/**
 * 应用一批 delta。不会抛异常 —— 非法变更一律进 rejected，
 * 保证一轮对话不会因为模型输出一个离谱字段就整个崩掉。
 */
export function applyDeltas(
  state: GameState,
  deltas: StateDelta[],
  ctx: { rng?: Rng; ruleset?: Ruleset } = {}
): ApplyReport {
  const next = deepClone(state);
  const applied: AppliedDelta[] = [];
  const rejected: RejectedDelta[] = [];
  const rolls: { expression: string; total: number }[] = [];
  const rng = ctx.rng ?? Math.random;

  for (const delta of deltas) {
    if (!delta || typeof delta.target !== 'string') {
      rejected.push({ delta, reason: 'delta 缺少合法的 target' });
      continue;
    }

    const [root, ...rest] = delta.target.split('.');
    if (!root || !ALLOWED_ROOTS.has(root)) {
      rejected.push({ delta, reason: `不允许修改的路径根：${root ?? '(空)'}` });
      continue;
    }

    // --- 数值条：只接受 set / inc / dec，且做边界裁剪 ---
    if (root === 'vitals') {
      const vitalKey = rest[0];
      if (!vitalKey) {
        rejected.push({ delta, reason: 'vitals 变更缺少字段名' });
        continue;
      }
      const def = ctx.ruleset?.vitalDefs.find((v) => v.key === vitalKey);
      // 提供了规则包时，模型不能凭空造出规则里没有的数值条（如 vitals.gold）
      if (ctx.ruleset && !def) {
        rejected.push({
          delta,
          reason: `规则包 ${ctx.ruleset.id} 未定义数值条「${vitalKey}」`,
        });
        continue;
      }
      const before = (next.vitals[vitalKey] ?? def?.min ?? 0) as number;

      let after: number;
      let resolvedAmount: number | undefined;

      if (delta.op === 'set') {
        const v = typeof delta.value === 'number' ? delta.value : Number(delta.value);
        if (!Number.isFinite(v)) {
          rejected.push({ delta, reason: 'set 需要一个有限数值' });
          continue;
        }
        after = v;
      } else if (delta.op === 'inc' || delta.op === 'dec') {
        if (delta.amount === undefined) {
          rejected.push({ delta, reason: `${delta.op} 缺少 amount` });
          continue;
        }
        if (typeof delta.amount === 'number') {
          resolvedAmount = delta.amount;
        } else {
          const outcome = roll(delta.amount, rng);
          rolls.push({ expression: outcome.expression, total: outcome.total });
          resolvedAmount = outcome.total;
        }
        after = delta.op === 'inc' ? before + resolvedAmount : before - resolvedAmount;
      } else {
        rejected.push({ delta, reason: `vitals 不支持操作 ${delta.op}` });
        continue;
      }

      if (def) after = clamp(after, def.min, def.max);
      next.vitals[vitalKey] = after;
      applied.push({ delta, resolvedAmount, before, after });
      continue;
    }

    // --- 列表类：inventory / clues / npcsAlive ---
    if (root === 'inventory' || root === 'clues' || root === 'npcsAlive') {
      const list = next[root] as unknown[];
      const before = deepClone(list);

      if (delta.op === 'add') {
        if (delta.value === undefined || delta.value === null || delta.value === '') {
          rejected.push({ delta, reason: 'add 需要 value' });
          continue;
        }
        if (root === 'inventory') {
          const item = delta.value as Partial<InventoryItem>;
          if (!item.id && !item.name) {
            rejected.push({ delta, reason: '物品至少需要 id 或 name' });
            continue;
          }
          const id = item.id ?? item.name!;
          const existing = (list as InventoryItem[]).find((i) => i.id === id);
          if (existing) existing.qty += item.qty ?? 1;
          else (list as InventoryItem[]).push({ id, name: item.name ?? id, qty: item.qty ?? 1, note: item.note });
        } else {
          const v = String(delta.value);
          if (!(list as string[]).includes(v)) (list as string[]).push(v);
        }
      } else if (delta.op === 'remove') {
        const v = delta.value === undefined ? undefined : String(delta.value);
        if (root === 'inventory') {
          const id = String((delta.value as InventoryItem)?.id ?? v ?? '');
          const idx = (list as InventoryItem[]).findIndex((i) => i.id === id);
          if (idx < 0) {
            rejected.push({ delta, reason: `背包中不存在物品 ${id}` });
            continue;
          }
          list.splice(idx, 1);
        } else {
          const idx = (list as string[]).indexOf(v ?? '');
          if (idx < 0) {
            rejected.push({ delta, reason: `${root} 中不存在 "${v}"` });
            continue;
          }
          list.splice(idx, 1);
        }
      } else if (delta.op === 'set') {
        rejected.push({ delta, reason: `${root} 不支持整体 set（请用 add/remove）` });
        continue;
      } else {
        rejected.push({ delta, reason: `${root} 不支持操作 ${delta.op}` });
        continue;
      }

      applied.push({ delta, before, after: deepClone(next[root]) });
      continue;
    }

    // --- 自由字段：flags / location ---
    if (delta.op !== 'set') {
      rejected.push({ delta, reason: `${root} 只支持 set` });
      continue;
    }
    const before = getPath(next, delta.target);
    setPath(next as unknown as Record<string, unknown>, delta.target, delta.value);
    applied.push({ delta, before, after: delta.value });
  }

  return { state: next, applied, rejected, rolls };
}
