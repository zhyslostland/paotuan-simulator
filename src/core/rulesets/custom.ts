/**
 * 自定义规则包（"第三方自由预设"）
 *
 * 让用户不写代码就能定义一套自己的规则：主骰、判定方式、属性、技能、数值条。
 * 配合 COC / DnD 一起出现在规则切换里，满足"泛用规则兼容 + 自创房规"的原始需求。
 */

import type {
  CharacteristicDef,
  CheckResult,
  CheckTier,
  Difficulty,
  Ruleset,
} from './types.js';

export interface CustomRulesetConfig {
  id: string;
  name: string;
  /** 主骰表达式，如 "1d100" / "1d20" / "2d6" */
  mainDice: string;
  /** 'under'＝点数 ≤ 目标值成功（百分比/COC 风格）；'over'＝点数 ≥ 目标值成功（d20 风格） */
  mode: 'under' | 'over';
  /** 属性：名称=默认值 */
  characteristics: { key: string; label: string; default: number }[];
  /** 技能：名称=基础值 */
  skills: { name: string; base: number }[];
  /** 数值条：名称=默认值 */
  vitals: { key: string; label: string; default: number }[];
}

const TIER_LABELS: Record<CheckTier, string> = {
  critical: '大成功',
  extreme: '极难成功',
  hard: '困难成功',
  regular: '成功',
  failure: '失败',
  fumble: '大失败',
};

function clamp(n: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, n));
}

function underResolve(roll: number, target: number, difficulty: Difficulty): CheckResult {
  const r = clamp(Math.floor(roll), 1, 999);
  const t = Math.max(0, Math.floor(target));
  const hardTarget = Math.floor(t / 2);
  const extremeTarget = Math.floor(t / 5);
  const effectiveTarget =
    difficulty === 'hard' ? hardTarget : difficulty === 'extreme' ? extremeTarget : t;

  let tier: CheckTier;
  if (r === 100 || (r >= 96 && t < 50)) tier = 'fumble';
  else if (r === 1) tier = 'critical';
  else if (r <= extremeTarget && r <= effectiveTarget) tier = 'extreme';
  else if (r <= hardTarget && r <= effectiveTarget) tier = 'hard';
  else if (r <= effectiveTarget) tier = 'regular';
  else tier = 'failure';

  return {
    roll: r,
    target: t,
    effectiveTarget,
    difficulty,
    tier,
    success: tier !== 'failure' && tier !== 'fumble',
    label: TIER_LABELS[tier],
  };
}

function overResolve(roll: number, bonus: number, difficulty: Difficulty, isD20: boolean): CheckResult {
  const r = clamp(Math.floor(roll), 1, 999);
  const dc = difficulty === 'hard' ? 15 : difficulty === 'extreme' ? 18 : 10;
  const total = r + Math.floor(bonus);

  let tier: CheckTier;
  if (isD20 && r === 20) tier = 'critical';
  else if (isD20 && r === 1) tier = 'fumble';
  else if (total >= dc + 5) tier = 'hard';
  else if (total >= dc) tier = 'regular';
  else tier = 'failure';

  return {
    roll: r,
    target: bonus,
    effectiveTarget: dc,
    difficulty,
    tier,
    success: tier !== 'failure' && tier !== 'fumble',
    label: TIER_LABELS[tier],
  };
}

export function createCustomRuleset(cfg: CustomRulesetConfig): Ruleset {
  const isD20 = cfg.mainDice.trim() === '1d20';
  const isOver = cfg.mode === 'over';

  const characteristicDefs: CharacteristicDef[] = cfg.characteristics.map((c) => ({
    key: c.key,
    label: c.label,
    min: 1,
    max: 99,
    default: c.default,
  }));

  return {
    id: cfg.id,
    name: cfg.name,
    mainDice: cfg.mainDice.trim(),
    beginnerGuide: isOver
      ? `掷 ${cfg.mainDice}，点数 + 加值 ≥ 目标（DC）就算成功（常规 10 / 困难 15 / 极难 18）。`
      : `掷 ${cfg.mainDice}，点数 ≤ 目标值就算成功；困难＝目标值的一半、极难＝五分之一。掷出 1 是大成功。`,
    vitalDefs: cfg.vitals.map((v, i) => ({
      key: v.key,
      label: v.label,
      min: 0,
      max: 99,
      default: v.default,
      // 自定义包没有显式的"主生命"字段：key 叫 hp 就是它，否则取第一条（多半就是血）
      isLife: v.key === 'hp' || (i === 0 && !cfg.vitals.some((x) => x.key === 'hp')),
    })),
    characteristicDefs,
    skillCatalog: cfg.skills.map((s) => ({ name: s.name, base: s.base })),
    deriveVitals: () => Object.fromEntries(cfg.vitals.map((v) => [v.key, v.default])),
    resolveCheck(roll, target, difficulty = 'regular') {
      return isOver ? overResolve(roll, target, difficulty, isD20) : underResolve(roll, target, difficulty);
    },
    tierLabel: (t) => TIER_LABELS[t],
  };
}
