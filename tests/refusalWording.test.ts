import { describe, expect, it } from 'vitest';
import {
  attackRejectedReason,
  HARM_NEEDS_CHECK_REASON,
  type AttackGrant,
} from '../src/core/state/refusal.js';
import { applyDeltas, createInitialState, type GameState } from '../src/core/state/gameState.js';
import { coc7 } from '../src/core/rulesets/index.js';
import { seededRng } from '../src/core/dice/index.js';

/**
 * 🔴 **引擎拒绝时对玩家说的话** —— 2026-09-30 修，用户亲报。
 *
 * ## 现场
 *
 * 玩家：「我要开枪」→ 掷检定 → 卡片显示**成功** → 状态变化里出现
 * 「**这一下没打中**（攻击检定没过），「巨影」不该掉血」。
 *
 * 机制上行得通、话术上自相矛盾：那一句把**"这次伤害申报不成立"**
 * 说成了**"你没打中"**，而玩家手上那张卡片写着成功。
 * 他读到的是"引擎说我打歪了"——于是"我掷过了却说我打歪"。
 *
 * ## 判据
 *
 * 1. 拒绝理由**不许出现判定语言**（没打中 / 打歪 / 落空 …）；
 * 2. 拒绝理由**必须给出路**（下一步能做什么），不能只说"不行"；
 * 3. 三种授权状态（没掷 / 掷过没过 / 掷中）的话术各不相同且都对得上；
 * 4. 走**真实 `applyDeltas` 通道**再验一遍：玩家掷中时伤害落地，没掷时被拒且理由合规。
 */

const base = (): GameState =>
  createInitialState({
    vitals: { hp: 12, san: 65, mp: 13 },
    inventory: [
      { id: 'gun', name: '柯尔特左轮', qty: 1, kind: 'weapon', damage: '1d10', skill: '射击（手枪）' },
    ],
    combat: { active: true, round: 1, foes: [{ name: '雾中的巨影', hp: 20, max: 20 }] },
    location: '仓库',
  });

/** 玩家拒绝话术里**不该出现**的判定语言（他会以为自己掷输了）。 */
const VERDICT_WORDS = /(没打中|没有打中|打歪|打偏|落空|扑空|未命中|没击中|骰|检定没过)/;

describe('武器伤害被拒时的话术：说机制，不说"你没打中"', () => {
  const grants: AttackGrant[] = ['hit', 'miss', 'none'];

  it('三种授权的话术都不含判定语言', () => {
    for (const g of grants) {
      const text = attackRejectedReason('雾中的巨影', g, true);
      expect(VERDICT_WORDS.test(text), `「${g}」的话术仍含判定语言：${text}`).toBe(false);
    }
  });

  it('被拒时必须给出路（下一步能做什么）', () => {
    expect(attackRejectedReason('巨影', 'none', true)).toContain('掷一次攻击检定');
    expect(attackRejectedReason('巨影', 'miss', true)).toContain('重新掷一次攻击检定');
  });

  it('未掷与掷过没过，两句话必须不同（不能混为一谈）', () => {
    const a = attackRejectedReason('巨影', 'none', true);
    const b = attackRejectedReason('巨影', 'miss', true);
    expect(a).not.toBe(b);
    expect(a).toContain('还没掷过');
    expect(b).toContain('未通过');
  });

  it('数值条被拒的话术也是人话 + 给出路（环境伤害那条）', () => {
    expect(HARM_NEEDS_CHECK_REASON).toContain('检定');
    expect(HARM_NEEDS_CHECK_REASON).toContain('写明原因');
    expect(VERDICT_WORDS.test(HARM_NEEDS_CHECK_REASON)).toBe(false);
  });
});

describe('走真实 applyDeltas 通道：玩家掷中就该落地，没掷就该被拒且理由合规', () => {
  it('掷中（hit）→ 伤害落地，敌人掉血', () => {
    const { state, rejected } = applyDeltas(
      base(),
      [{ target: 'combat.foes', op: 'dec', value: '雾中的巨影', weapon: '柯尔特左轮', amount: '1d10' }],
      { ruleset: coc7, rng: seededRng(20260930), foeDamage: 'hit' }
    );
    expect(rejected).toHaveLength(0);
    expect(state.combat.foes[0]!.hp).toBeLessThan(20);
  });

  it('没掷（none）→ 被拒，且理由**不含**"没打中"这种判定语言', () => {
    const { state, rejected } = applyDeltas(
      base(),
      [{ target: 'combat.foes', op: 'dec', value: '雾中的巨影', weapon: '柯尔特左轮', amount: '1d10' }],
      { ruleset: coc7, rng: seededRng(1), foeDamage: 'none' }
    );
    expect(rejected).toHaveLength(1);
    expect(rejected[0]!.reason).not.toMatch(VERDICT_WORDS);
    expect(rejected[0]!.reason).toContain('掷一次攻击检定');
    expect(state.combat.foes[0]!.hp).toBe(20); // 血一点没掉
  });

  it('掷过没过（miss）→ 被拒，理由说的是"这次伤害没落地"，不是"你没打中"', () => {
    const { rejected } = applyDeltas(
      base(),
      [{ target: 'combat.foes', op: 'dec', value: '雾中的巨影', weapon: '柯尔特左轮', amount: '1d10' }],
      { ruleset: coc7, rng: seededRng(2), foeDamage: 'miss' }
    );
    expect(rejected).toHaveLength(1);
    expect(rejected[0]!.reason).not.toMatch(VERDICT_WORDS);
    expect(rejected[0]!.reason).toContain('没有落地');
  });

  it('环境伤害（不写 weapon）不吃这道闸 —— 该掉血就掉血', () => {
    const { state, rejected } = applyDeltas(
      base(),
      [{ target: 'combat.foes', op: 'dec', value: '雾中的巨影', amount: 5 }],
      { ruleset: coc7, rng: seededRng(3), foeDamage: 'none' }
    );
    expect(rejected).toHaveLength(0);
    expect(state.combat.foes[0]!.hp).toBe(15);
  });
});
