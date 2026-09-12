/**
 * 克苏鲁的呼唤 第七版（Call of Cthulhu 7th）规则包
 *
 * 之所以推荐它作为第一套规则：百分币检定、成功等级表、SAN 值，
 * 数值维度少，模型最容易"不犯错"。
 */

import type { Rng } from '../dice/roll.js';
import {
  type CheckResult,
  type CheckTier,
  type Difficulty,
  type Ruleset,
  type VitalDef,
} from './types.js';

const TIER_LABELS: Record<CheckTier, string> = {
  critical: '大成功',
  extreme: '极难成功',
  hard: '困难成功',
  regular: '成功',
  failure: '失败',
  fumble: '大失败',
};

export interface PercentileRoll {
  /** 最终点数 1-100 */
  value: number;
  /** 掷出的所有十位骰（含默认那颗），便于审计与动画 */
  tens: number[];
  /** 个位骰 0-9 */
  ones: number;
  /** 采用的十位骰（奖励骰取最小、惩罚骰取最大） */
  keptTen: number;
  /** net > 0 为奖励骰，< 0 为惩罚骰 */
  net: number;
}

/**
 * COC 的百分骰：一颗十位骰（00/10/.../90）+ 一颗个位骰（0-9）
 * 00 + 0 视为 100。
 * 奖励骰：额外掷十位骰取最小；惩罚骰：额外掷十位骰取最大。
 * bonus 与 penalty 会相互抵消。
 */
export function rollPercentile(
  opts: { bonus?: number; penalty?: number } = {},
  rng: Rng = Math.random
): PercentileRoll {
  const bonus = Math.max(0, Math.floor(opts.bonus ?? 0));
  const penalty = Math.max(0, Math.floor(opts.penalty ?? 0));
  const net = bonus - penalty;
  const extra = Math.min(Math.abs(net), 10);

  const rollTen = () => Math.floor(rng() * 10) * 10; // 0,10,...,90
  const tens: number[] = [rollTen()];
  for (let i = 0; i < extra; i++) tens.push(rollTen());

  const ones = Math.floor(rng() * 10); // 0-9
  const keptTen = net > 0 ? Math.min(...tens) : net < 0 ? Math.max(...tens) : tens[0]!;

  let value = keptTen + ones;
  if (value === 0) value = 100;

  return { value, tens, ones, keptTen, net };
}

function clampTarget(target: number): number {
  if (Number.isNaN(target)) return 0;
  return Math.max(0, Math.min(100, Math.floor(target)));
}

export function resolveCocCheck(
  roll: number,
  rawTarget: number,
  difficulty: Difficulty = 'regular'
): CheckResult {
  const target = clampTarget(rawTarget);
  const r = Math.max(1, Math.min(100, Math.floor(roll)));

  const hardTarget = Math.floor(target / 2);
  const extremeTarget = Math.floor(target / 5);
  const effectiveTarget =
    difficulty === 'hard' ? hardTarget : difficulty === 'extreme' ? extremeTarget : target;

  let tier: CheckTier;

  // 大失败优先判定（规则书：100 必为大失败；技能值 < 50 时 96-100 亦为大失败）
  if (r === 100 || (r >= 96 && target < 50)) {
    tier = 'fumble';
  } else if (r === 1) {
    tier = 'critical';
  } else if (r <= extremeTarget && r <= effectiveTarget) {
    tier = 'extreme';
  } else if (r <= hardTarget && r <= effectiveTarget) {
    tier = 'hard';
  } else if (r <= effectiveTarget) {
    tier = 'regular';
  } else {
    tier = 'failure';
  }

  const success = tier !== 'failure' && tier !== 'fumble';

  return {
    roll: r,
    target,
    effectiveTarget,
    difficulty,
    tier,
    success,
    label: TIER_LABELS[tier],
  };
}

const COC_VITALS: VitalDef[] = [
  { key: 'hp', label: '生命值', min: 0, max: 99 },
  { key: 'mp', label: '魔法值', min: 0, max: 99 },
  { key: 'san', label: '理智值', min: 0, max: 99 },
];

export const coc7: Ruleset = {
  id: 'coc7',
  name: '克苏鲁的呼唤 第七版',
  mainDice: '1d100',
  vitalDefs: COC_VITALS,
  resolveCheck: resolveCocCheck,
  tierLabel: (t) => TIER_LABELS[t],
};
