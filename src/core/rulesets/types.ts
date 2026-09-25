/**
 * 规则包通用接口
 *
 * 规则体系必须是可插拔的：第一版只实现 COC 7th，
 * 但引擎层只依赖这个接口，将来加 DND 5e 不需要改引擎。
 */

export type Difficulty = 'regular' | 'hard' | 'extreme';

export type CheckTier =
  | 'critical'
  | 'extreme'
  | 'hard'
  | 'regular'
  | 'failure'
  | 'fumble';

export interface CheckResult {
  /** 实际掷出的点数 */
  roll: number;
  /** 技能/属性目标值 */
  target: number;
  /** 依据难度折算后的通过线 */
  effectiveTarget: number;
  difficulty: Difficulty;
  tier: CheckTier;
  success: boolean;
  /** 可直接展示的中文标签 */
  label: string;
}

export interface VitalDef {
  key: string;
  label: string;
  min: number;
  max: number;
  /** 新开一团时的初始值（满状态） */
  default: number;
  /**
   * 这是"主生命条"吗？濒死 / 死亡判定与「濒死轮冻结扣血」只作用于它。
   * COC 与 DnD 都是 hp；自定义规则包若没标，按 key === 'hp' 兜底。
   */
  isLife?: boolean;
}

/**
 * 判断某条数值是不是"主生命"。
 * 规则包没标 `isLife`（老自定义包）时退回 `key === 'hp'`，绝不能退回"第一条"——
 * 法则包里第一条不一定是血。
 */
export function isLifeVital(def: VitalDef | undefined, key: string): boolean {
  return def ? def.isLife === true : key === 'hp';
}

/** 属性定义（COC 是 STR/CON/…，DnD 是 STR/DEX/CON/INT/WIS/CHA）——由规则包提供 */
export interface CharacteristicDef {
  key: string;
  label: string;
  min: number;
  max: number;
  /** 新建角色卡时的默认值 */
  default: number;
  /** 一句话说明这个属性管什么（用于检定框与角色卡科普） */
  desc?: string;
}

/** 技能定义：名字 + 基础值（未投入点数时的起始成功率）+ 一句简介 */
export interface SkillDef {
  name: string;
  /** 基础值，就是"没专门练过时也有多少成功率" */
  base: number;
  /** 一句话说明这个技能管什么（检定框科普用） */
  desc?: string;
}

/* ============================================================
 * 1.0 阶段 B：让规则包能"说清后果"。
 *
 * 以前 `Ruleset` 只能表达属性、技能表、数值派生与判定 ——
 * 于是"我中毒了"只是 flags 里多一行字，**引擎不知道该扣什么、每回合扣多少**，
 * 只能交给模型自觉（那等于放弃了「引擎权威」这条铁律）。
 *
 * 两张表只放**引擎要解释的字段**，原则来自协作方第 24 版 §4③：
 * 「只放引擎要解释的（伤害、扣减、时长、解除）；中毒长什么样交给模型 / 世界书」，
 * 每条 ≤6 字段 —— 别让它变成"规则书入库"（版权三层铁律）。
 * ============================================================ */

export interface WeaponDef {
  name: string;
  /** 伤害骰表达式（如 `1d10`、`1d8+2`），与 `core/dice/roll.ts` 同一套写法 */
  damage: string;
  /** 这把武器用哪个技能检定（如「格斗（斗殴）」「射击（手枪）」） */
  skill: string;
  /** 单手还是双手 */
  hands?: 1 | 2;
  /** 弹药：空 / 不填 = 近战或无限 */
  ammo?: number;
  /** 标签，便于界面分组与提示（如「近战」「枪械」） */
  tags?: string[];
}

export interface StatusEffectDef {
  name: string;
  /**
   * 每轮的后果。键是数值条 key（如 `hp` / `san`），值是**增量**（负数＝扣）或骰表达式。
   */
  perRound: Record<string, number | string>;
  /** 持续轮数；0 = 直到被解除 */
  duration: number;
  /** 解除条件（一句人话，给界面和守密人看） */
  cure: string;
  /** 能不能叠（同一状态再来一次是叠加还是续期） */
  stacks?: boolean;
}

export interface Ruleset {
  id: string;
  name: string;
  /** 主检定骰表达式 */
  mainDice: string;
  /**
   * 新手引导：用大白话解释"技能是什么 / 判定怎么算 / 难度 / 通过线"。
   * 显示在角色卡与检定面板，也喂给 GM——用户明确要求"傻瓜式"。
   */
  beginnerGuide?: string;
  vitalDefs: VitalDef[];
  /** 数值层的属性集，换规则只换这里 */
  characteristicDefs: CharacteristicDef[];
  /** 标准技能表（含基础值），供创建角色卡时挑选 */
  skillCatalog: SkillDef[];
  /**
   * 起始技能：换到这套规则时给角色卡的**默认几项**（6-9 项为宜）。
   * 不能把整张 skillCatalog 倒进去——那样角色卡会塞满几十项没用过的技能。
   */
  starterSkills?: { name: string; value: number }[];
  /**
   * 由属性派生起始数值条（HP/MP/SAN 等），开新团时用。
   * 这是"数值派生"的核心：属性一变，血/蓝/理智自动跟着算。
   */
  deriveVitals(characteristics: Record<string, number>): Record<string, number>;
  /**
   * 由属性派生其它衍生值（伤害加成、体格等），用于展示与检定参考。
   * 键用中文标签，值可以是数字或字符串。
   */
  deriveExtras?(characteristics: Record<string, number>): Record<string, number | string>;
  /**
   * 可选：把属性/技能的原始值折算成"检定加值"。
   * DnD 需要它（属性 15 → +2；技能本身已是加值则原样返回）；COC 不需要。
   */
  toModifier?(name: string, rawValue: number): number;
  /**
   * 负重上限：由属性派生（COC 看力量+体格，DnD 看力量）。
   * **不提供 = 这套规则不启用负重**，玩家带多少都不罚 —— 自定义规则包大多走这条。
   */
  carryCapacity?(characteristics: Record<string, number>): number;
  resolveCheck(roll: number, target: number, difficulty?: Difficulty): CheckResult;
  tierLabel(tier: CheckTier): string;
  /**
   * 武器表（1.0 阶段 B）。**可选** —— 没填就走现状（伤害由模型申报）。
   * 阶段 C 之前它只用于展示，不改变任何行为。
   */
  weaponTable?: WeaponDef[];
  /**
   * 状态效果表（1.0 阶段 B）。**可选** —— 没填就走现状（flags 只是自由文本）。
   */
  statusEffects?: StatusEffectDef[];
}

/** 按名字找一把武器；没有就返回 undefined（调用方自行走现状） */
export function findWeapon(rs: Ruleset | undefined, name: string): WeaponDef | undefined {
  const want = name.trim();
  if (!want || !rs?.weaponTable?.length) return undefined;
  return (
    rs.weaponTable.find((w) => w.name === want) ??
    rs.weaponTable.find((w) => want.includes(w.name) || w.name.includes(want))
  );
}

/** 按名字找一个状态效果；没有就返回 undefined */
export function findStatusEffect(rs: Ruleset | undefined, name: string): StatusEffectDef | undefined {
  const want = name.trim();
  if (!want || !rs?.statusEffects?.length) return undefined;
  return (
    rs.statusEffects.find((s) => s.name === want) ??
    rs.statusEffects.find((s) => want.includes(s.name) || s.name.includes(want))
  );
}
