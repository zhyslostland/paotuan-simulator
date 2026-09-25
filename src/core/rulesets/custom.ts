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
  StatusEffectDef,
  WeaponDef,
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
  /**
   * 武器表（1.0 阶段 B，可选）。**不填就走现状**（伤害由模型申报）。
   * 文本行写法：`名字=伤害骰|技能名|手数|弹药`，后两项可省。
   */
  weapons?: string[];
  /**
   * 状态效果表（1.0 阶段 B，可选）。
   * 文本行写法：`名字=数值变化|轮数|解除条件`，如 `中毒=hp-1|3|找到解毒剂`。
   */
  statuses?: string[];
}

/**
 * 解析武器行：`手枪=1d10|射击（手枪）|1|7`
 * 后两段（手数、弹药）可省；解析不了的行**整条跳过**（宁可少一把，也别给个错的）。
 */
export function parseWeaponLines(text: string): WeaponDef[] {
  const out: WeaponDef[] = [];
  for (const raw of text.split('\n')) {
    const line = raw.trim();
    if (!line) continue;
    const eq = line.indexOf('=');
    if (eq <= 0) continue;
    const name = line.slice(0, eq).trim();
    const rest = line.slice(eq + 1);
    const parts = rest.split('|').map((s) => s.trim());
    const damage = parts[0] ?? '';
    const skill = parts[1] ?? '';
    if (!name || !damage || !skill) continue;
    const hands = Number(parts[2] ?? '1');
    const ammoRaw = Number(parts[3] ?? '');
    const w: WeaponDef = { name, damage, skill };
    if (hands === 1 || hands === 2) w.hands = hands;
    if (Number.isFinite(ammoRaw) && ammoRaw > 0) w.ammo = Math.floor(ammoRaw);
    out.push(w);
  }
  return out;
}

/**
 * 解析状态行：`中毒=hp-1|3|找到解毒剂`
 * 数值变化支持多种写法：`hp-1` / `hp:-1` / `hp-1d4`；轮数缺省 0（＝直到解除）。
 */
export function parseStatusLines(text: string): StatusEffectDef[] {
  const out: StatusEffectDef[] = [];
  for (const raw of text.split('\n')) {
    const line = raw.trim();
    if (!line) continue;
    const eq = line.indexOf('=');
    if (eq <= 0) continue;
    const name = line.slice(0, eq).trim();
    const parts = line.slice(eq + 1).split('|').map((s) => s.trim());
    const perRound: Record<string, number | string> = {};
    // `hp-1` / `hp:-1` / `san-1d4` 都认；也允许逗号分隔多个（`hp-1,san-1`）
    for (const bit of (parts[0] ?? '').split(/[,，]/)) {
      const m = /^([A-Za-z_\u4e00-\u9fa5]+)\s*[:：]?\s*([+-]?)(\d+(?:d\d+)?)$/.exec(bit.trim());
      if (!m) continue;
      const amount = m[3]!;
      /*
       * 纯数字 → **数字**（带符号，`hp-1` 就是 -1）；
       * 骰表达式 `1d4` → **字符串**，且不带符号 —— 掷出来的本来就是"扣多少"，
       * 写成 `-1d4` 反而会让引擎不知道该拿骰点做加还是做减。
       */
      perRound[m[1]!] = /d/i.test(amount) ? amount : (m[2] === '-' ? -1 : 1) * Number(amount);
    }
    const dur = Number(parts[1] ?? '0');
    out.push({
      name,
      perRound,
      duration: Number.isFinite(dur) && dur > 0 ? Math.floor(dur) : 0,
      cure: parts[2] ?? '自行缓解',
    });
  }
  return out;
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
    /*
     * 1.0 阶段 B：两张表**可选**。老自定义包没有它们 → 不填 → 走现状，行为一点不变。
     * （真正生效在阶段 C；这里只是"让包能声明"。）
     */
    weaponTable: cfg.weapons?.length ? parseWeaponLines(cfg.weapons.join('\n')) : undefined,
    statusEffects: cfg.statuses?.length ? parseStatusLines(cfg.statuses.join('\n')) : undefined,
  };
}
