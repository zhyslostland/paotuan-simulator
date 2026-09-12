import { describe, expect, it } from 'vitest';
import {
  DiceParseError,
  distribution,
  expectedValue,
  parseDice,
  roll,
  seededRng,
} from '../src/core/dice/index.js';

describe('表达式解析', () => {
  it('解析常见写法', () => {
    expect(parseDice('2d6')).toEqual({ type: 'dice', count: 2, sides: 6 });
    expect(parseDice('d20')).toEqual({ type: 'dice', count: 1, sides: 20 });
    expect(parseDice('d%')).toEqual({ type: 'dice', count: 1, sides: 100 });
    expect(parseDice('1d100')).toEqual({ type: 'dice', count: 1, sides: 100 });
  });

  it('裸数字与四则运算', () => {
    expect(roll('2+3*4').total).toBe(14);
    expect(roll('(1+2)*3').total).toBe(9);
    expect(roll('-5+2').total).toBe(-3);
    expect(roll('7/2').total).toBe(3);
  });

  it('忽略空白与大小写', () => {
    expect(parseDice(' 2D6 + 1 ')).toEqual({
      type: 'bin',
      op: '+',
      left: { type: 'dice', count: 2, sides: 6 },
      right: { type: 'num', value: 1 },
    });
  });

  it('非法输入抛错', () => {
    expect(() => parseDice('')).toThrow(DiceParseError);
    expect(() => parseDice('2d')).toThrow(DiceParseError);
    expect(() => parseDice('2d6+')).toThrow(DiceParseError);
    expect(() => parseDice('(2d6')).toThrow(DiceParseError);
    expect(() => parseDice('1d0')).toThrow(DiceParseError);
    expect(() => parseDice('*5')).toThrow(DiceParseError);
  });
});

describe('掷骰求值', () => {
  it('结果落在合法值域内', () => {
    const rng = seededRng(42);
    for (let i = 0; i < 5000; i++) {
      const r = roll('3d6', rng);
      expect(r.total).toBeGreaterThanOrEqual(3);
      expect(r.total).toBeLessThanOrEqual(18);
      expect(r.groups).toHaveLength(1);
      expect(r.groups[0]!.results).toHaveLength(3);
    }
  });

  it('分组按顺序记录，便于做骰点动画', () => {
    const r = roll('2d6+1d4+3', seededRng(7));
    expect(r.groups).toHaveLength(2);
    expect(r.groups[0]).toMatchObject({ count: 2, sides: 6 });
    expect(r.groups[1]).toMatchObject({ count: 1, sides: 4 });
    expect(r.total).toBe(r.groups[0]!.sum + r.groups[1]!.sum + 3);
  });

  it('同一 seed 结果可复现（回溯/重掷的基础）', () => {
    const a = roll('4d6', seededRng(1234));
    const b = roll('4d6', seededRng(1234));
    expect(a.total).toBe(b.total);
    expect(a.groups).toEqual(b.groups);
  });
});

describe('分布与公平性', () => {
  it('1d6 均匀分布', () => {
    const d = distribution('1d6');
    expect(d.size).toBe(6);
    for (const v of [1, 2, 3, 4, 5, 6]) expect(d.get(v)).toBe(1);
  });

  it('2d6 组合数正确（和为 7 有 6 种）', () => {
    const d = distribution('2d6');
    expect(d.get(7)).toBe(6);
    expect(d.get(2)).toBe(1);
    expect(d.get(12)).toBe(1);
    expect([...d.values()].reduce((a, b) => a + b, 0)).toBe(36);
  });

  it('期望值正确', () => {
    expect(expectedValue('1d6')).toBeCloseTo(3.5, 10);
    expect(expectedValue('2d6')).toBeCloseTo(7, 10);
    expect(expectedValue('1d6+2')).toBeCloseTo(5.5, 10);
  });

  it('10 万次 1d6 通过卡方检验（p > 0.01）', () => {
    const N = 100_000;
    const rng = seededRng(20260912);
    const counts = new Array(6).fill(0) as number[];
    for (let i = 0; i < N; i++) {
      const idx = roll('1d6', rng).total - 1;
      counts[idx] = counts[idx]! + 1;
    }
    const expected = N / 6;
    const chi2 = counts.reduce((acc, o) => acc + ((o - expected) ** 2) / expected, 0);
    // 自由度 5，显著性 0.01 的临界值约 15.09
    expect(chi2).toBeLessThan(15.09);
  });

  it('样本均值收敛到理论期望', () => {
    const N = 50_000;
    const rng = seededRng(99);
    let sum = 0;
    for (let i = 0; i < N; i++) sum += roll('3d6', rng).total;
    expect(sum / N).toBeCloseTo(10.5, 1);
  });
});
