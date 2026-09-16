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
}
