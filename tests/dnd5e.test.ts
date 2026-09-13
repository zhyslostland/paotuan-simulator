import { describe, expect, it } from 'vitest';
import { dnd5e, dndModifier, resolveDndCheck } from '../src/core/rulesets/index.js';

describe('DnD 5e（轻量）规则包', () => {
  it('属性分值折算成加值', () => {
    expect(dndModifier(10)).toBe(0);
    expect(dndModifier(15)).toBe(2);
    expect(dndModifier(8)).toBe(-1);
    expect(dndModifier(18)).toBe(4);
  });

  it('自然 20 为大成功、自然 1 为大失败', () => {
    expect(resolveDndCheck(20, 0).tier).toBe('critical');
    expect(resolveDndCheck(1, 5).tier).toBe('fumble');
  });

  it('d20 + 加值 ≥ DC 才算成功（DC 10/15/18）', () => {
    expect(resolveDndCheck(10, 0, 'regular').success).toBe(true); // 10 >= 10
    expect(resolveDndCheck(9, 0, 'regular').success).toBe(false); // 9 < 10

    expect(resolveDndCheck(13, 2, 'hard').success).toBe(true); // 15 >= 15
    expect(resolveDndCheck(12, 2, 'hard').success).toBe(false); // 14 < 15

    expect(resolveDndCheck(14, 4, 'extreme').success).toBe(true); // 18 >= 18
  });

  it('远超 DC 记为强成功', () => {
    expect(resolveDndCheck(15, 0, 'regular').tier).toBe('hard'); // 15 >= 10+5
  });

  it('生命值 = 10 + 体质加值', () => {
    expect(dnd5e.deriveVitals({ con: 10 })).toEqual({ hp: 10 });
    expect(dnd5e.deriveVitals({ con: 14 })).toEqual({ hp: 12 });
  });

  it('主骰是 1d20，技能加值原样返回、属性折算', () => {
    expect(dnd5e.mainDice).toBe('1d20');
    expect(dnd5e.toModifier!('调查', 5)).toBe(5); // 技能已是加值
    expect(dnd5e.toModifier!('力量', 15)).toBe(2); // 属性折算
  });
});
