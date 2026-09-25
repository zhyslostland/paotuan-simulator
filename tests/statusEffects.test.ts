/**
 * 1.0 阶段 C：伤害与状态**真正由引擎算**。
 *
 * 协作方第 24 版把这一刀的风险点得很准：
 * 「C 的风险不在掷骰，在**双计** —— 引擎扣了、模型又申报一次」。
 * 所以这里的断言一半在"算得对"，一半在"**没表的包必须一点不动**"。
 */
import { describe, expect, it } from 'vitest';
import { applyDeltas, createInitialState, type StateDelta } from '../src/core/state/gameState.js';
import { coc7 } from '../src/core/rulesets/coc7.js';
import { createCustomRuleset } from '../src/core/rulesets/custom.js';
import { findWeapon } from '../src/core/rulesets/types.js';
import { statusNote, tickStatusEffects, turnsKeyOf } from '../src/core/statusEffects.js';

/** 固定骰：永远掷出 1（让断言可复现） */
const rngOne = () => 0;

function baseState() {
  return createInitialState({
    vitals: { hp: 10, mp: 10, san: 60 },
    inventory: [],
    clues: [],
    threads: [],
    location: '某地',
    npcsAlive: [],
    visited: [],
  });
}

describe('阶段 C：伤害由引擎按武器骰掷', () => {
  it('🔴 写了 weapon → 按武器表的骰子掷（模型给的 amount 不作数）', () => {
    const st = baseState();
    st.combat = { active: true, round: 1, foes: [{ name: '黑影', hp: 30, max: 30 }] };
    // 手枪 = 1d10，固定骰掷出 1；模型却申报了 999
    const rep = applyDeltas(
      st,
      [{ target: 'combat.foes', op: 'dec', value: '黑影', amount: 999, weapon: '手枪' }],
      { ruleset: coc7, rng: rngOne }
    );
    expect(rep.rejected).toHaveLength(0);
    expect(rep.applied[0]!.after).toBe(29); // 30 - 1
    expect(rep.rolls.length).toBeGreaterThan(0);
  });

  it('不写 weapon → 完全走现状（用模型给的 amount）', () => {
    const st = baseState();
    st.combat = { active: true, round: 1, foes: [{ name: '黑影', hp: 30, max: 30 }] };
    const rep = applyDeltas(
      st,
      [{ target: 'combat.foes', op: 'dec', value: '黑影', amount: 7 }],
      { ruleset: coc7, rng: rngOne }
    );
    expect(rep.applied[0]!.after).toBe(23); // 30 - 7
  });

  it('认不出这把武器 → 照旧用 amount，不 reject（漏字段不该玩家承担）', () => {
    const st = baseState();
    st.combat = { active: true, round: 1, foes: [{ name: '黑影', hp: 30, max: 30 }] };
    const rep = applyDeltas(
      st,
      [{ target: 'combat.foes', op: 'dec', value: '黑影', amount: 5, weapon: '激光炮' }],
      { ruleset: coc7, rng: rngOne }
    );
    expect(rep.rejected).toHaveLength(0);
    expect(rep.applied[0]!.after).toBe(25);
  });

  it('🔴 自定义包没填武器表 → 写了 weapon 也不会掷（行为一点不变）', () => {
    const custom = createCustomRuleset({
      id: 'custom-now',
      name: '没表的包',
      mainDice: '1d100',
      mode: 'under',
      characteristics: [{ key: '力量', label: '力量', default: 50 }],
      skills: [{ name: '射击', base: 30 }],
      vitals: [{ key: 'hp', label: '生命', default: 10 }],
    });
    expect(custom.weaponTable).toBeUndefined();
    const st = baseState();
    st.combat = { active: true, round: 1, foes: [{ name: '黑影', hp: 30, max: 30 }] };
    const rep = applyDeltas(
      st,
      [{ target: 'combat.foes', op: 'dec', value: '黑影', amount: 5, weapon: '手枪' }],
      { ruleset: custom, rng: rngOne }
    );
    expect(rep.applied[0]!.after).toBe(25);
    expect(rep.rolls).toHaveLength(0);
  });

  it('COC 手枪是 1d10（表本身没错）', () => {
    expect(findWeapon(coc7, '手枪')?.damage).toBe('1d10');
  });
});

describe('阶段 C：状态效果每轮结算', () => {
  it('🔴 中毒 → 每轮扣 1 血，三轮后解除', () => {
    const flags: Record<string, unknown> = { 中毒: true };
    const t1 = tickStatusEffects(flags, coc7, rngOne);
    expect(t1.deltas[0]).toMatchObject({ target: 'vitals.hp', op: 'dec', amount: 1 });
    expect(t1.cleared).toEqual([]);

    // 第二轮：轮数记在引擎的记账键上
    const t2 = tickStatusEffects({ ...flags, [turnsKeyOf('中毒')]: 1 }, coc7, rngOne);
    expect(t2.cleared).toEqual(['中毒']);
  });

  it('🔴 规则包没填状态表 → 一律不动（老包行为不变）', () => {
    const custom = createCustomRuleset({
      id: 'custom-ns',
      name: '没状态表',
      mainDice: '1d100',
      mode: 'under',
      characteristics: [{ key: '力量', label: '力量', default: 50 }],
      skills: [{ name: '侦查', base: 20 }],
      vitals: [{ key: 'hp', label: '生命', default: 10 }],
    });
    const t = tickStatusEffects({ 中毒: true }, custom, rngOne);
    expect(t.deltas).toEqual([]);
    expect(t.cleared).toEqual([]);
  });

  it('规则包压根没给 → 也什么都不做', () => {
    expect(tickStatusEffects({ 中毒: true }, undefined, rngOne).deltas).toEqual([]);
  });

  it('没中的状态不算数（false / 空串 / 0 都是"没中"）', () => {
    for (const v of [false, '', 0, null]) {
      expect(tickStatusEffects({ 中毒: v }, coc7, rngOne).deltas).toEqual([]);
    }
  });

  it('引擎的记账键（xx轮数）不会被当成状态', () => {
    expect(tickStatusEffects({ 中毒轮数: 2 }, coc7, rngOne).deltas).toEqual([]);
  });

  it('骰表达式的后果也认（燃烧 1d4，固定骰＝1）', () => {
    const t = tickStatusEffects({ 燃烧: true }, createCustomRuleset({
      id: 'c-burn',
      name: '带燃烧',
      mainDice: '1d100',
      mode: 'under',
      characteristics: [{ key: '力量', label: '力量', default: 50 }],
      skills: [{ name: '侦查', base: 20 }],
      vitals: [{ key: 'hp', label: '生命', default: 10 }],
      statuses: ['燃烧=hp-1d4|3|扑灭'],
    }), rngOne);
    expect(t.deltas[0]).toMatchObject({ target: 'vitals.hp', op: 'dec', amount: 1 });
  });

  it('duration=0 的状态不会自己解除（要等 cure）', () => {
    const t = tickStatusEffects({ 昏迷: true }, coc7, rngOne);
    expect(t.cleared).toEqual([]);
    expect(t.remaining[0]!.name).toBe('昏迷');
  });
});

describe('阶段 C：防双计 —— 必须告诉守密人"已经算过了"', () => {
  it('🔴 提示里要点明"后果已由引擎算过，不要重复扣血"', () => {
    const note = statusNote(coc7, { 中毒: true, [turnsKeyOf('中毒')]: 2 });
    expect(note).toContain('中毒（还剩 2 轮）');
    expect(note).toContain('不要重复扣血');
  });

  it('解除的那一轮要说清楚（不然守密人还在演症状）', () => {
    const note = statusNote(coc7, { 中毒: true, [turnsKeyOf('中毒')]: 1 });
    expect(note).toContain('已在本轮解除');
  });

  it('没有状态时不许输出空话', () => {
    expect(statusNote(coc7, {})).toBe('');
    expect(statusNote(coc7, undefined)).toBe('');
  });
});
