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
}

export interface Ruleset {
  id: string;
  name: string;
  /** 主检定骰表达式 */
  mainDice: string;
  vitalDefs: VitalDef[];
  resolveCheck(roll: number, target: number, difficulty?: Difficulty): CheckResult;
  tierLabel(tier: CheckTier): string;
}
