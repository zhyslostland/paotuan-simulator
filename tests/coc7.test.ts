import { describe, expect, it } from 'vitest';
import { coc7, resolveCocCheck, rollPercentile } from '../src/core/rulesets/index.js';
import { seededRng } from '../src/core/dice/index.js';

describe('COC 7th 成功等级', () => {
  it('掷出 1 为大成功', () => {
    const r = resolveCocCheck(1, 60);
    expect(r.tier).toBe('critical');
    expect(r.success).toBe(true);
    expect(r.label).toBe('大成功');
  });

  it('掷出 100 必为大失败', () => {
    expect(resolveCocCheck(100, 90).tier).toBe('fumble');
    expect(resolveCocCheck(100, 10).tier).toBe('fumble');
  });

  it('技能值低于 50 时 96-99 亦为大失败', () => {
    expect(resolveCocCheck(96, 45).tier).toBe('fumble');
    expect(resolveCocCheck(99, 45).tier).toBe('fumble');
    // 技能值 >= 50 时 96-99 只是普通失败
    expect(resolveCocCheck(96, 60).tier).toBe('failure');
  });

  it('三档成功等级界限正确（技能 60）', () => {
    expect(resolveCocCheck(60, 60).tier).toBe('regular'); // <= 60
    expect(resolveCocCheck(61, 60).tier).toBe('failure');
    expect(resolveCocCheck(30, 60).tier).toBe('hard'); // <= 60/2
    expect(resolveCocCheck(31, 60).tier).toBe('regular');
    expect(resolveCocCheck(12, 60).tier).toBe('extreme'); // <= 60/5
    expect(resolveCocCheck(13, 60).tier).toBe('hard');
  });

  it('难度参数折算通过线', () => {
    const hard = resolveCocCheck(30, 60, 'hard');
    expect(hard.effectiveTarget).toBe(30);
    expect(hard.success).toBe(true);

    const hardFail = resolveCocCheck(31, 60, 'hard');
    expect(hardFail.success).toBe(false);
    expect(hardFail.tier).toBe('failure');

    const extreme = resolveCocCheck(12, 60, 'extreme');
    expect(extreme.effectiveTarget).toBe(12);
    expect(extreme.success).toBe(true);
    expect(extreme.tier).toBe('extreme');
  });

  it('目标值越界会被裁剪', () => {
    expect(resolveCocCheck(50, 150).target).toBe(100);
    expect(resolveCocCheck(50, -10).target).toBe(0);
  });

  it('规则包接口完整', () => {
    expect(coc7.id).toBe('coc7');
    expect(coc7.mainDice).toBe('1d100');
    expect(coc7.vitalDefs.map((v) => v.key)).toEqual(['hp', 'mp', 'san']);
    expect(coc7.tierLabel('fumble')).toBe('大失败');
  });
});

describe('百分骰与奖励骰 / 惩罚骰', () => {
  it('结果落在 1-100', () => {
    const rng = seededRng(5);
    for (let i = 0; i < 20000; i++) {
      const v = rollPercentile({}, rng).value;
      expect(v).toBeGreaterThanOrEqual(1);
      expect(v).toBeLessThanOrEqual(100);
    }
  });

  it('十位 00 且个位 0 视为 100', () => {
    // 固定 rng：每次都返回接近 0 的数
    const r = rollPercentile({}, () => 0);
    expect(r.tens[0]).toBe(0);
    expect(r.ones).toBe(0);
    expect(r.value).toBe(100);
  });

  it('奖励骰取最小十位，惩罚骰取最大十位', () => {
    let seq = [0.95, 0.05, 0.55, 0.5];
    let i = 0;
    const rng = () => seq[i++] ?? 0.5;

    const bonus = rollPercentile({ bonus: 1 }, rng);
    expect(bonus.tens).toHaveLength(2);
    expect(bonus.keptTen).toBe(Math.min(...bonus.tens));
    expect(bonus.net).toBe(1);

    i = 0;
    const penalty = rollPercentile({ penalty: 1 }, rng);
    expect(penalty.keptTen).toBe(Math.max(...penalty.tens));
    expect(penalty.net).toBe(-1);
  });

  it('奖励骰与惩罚骰相互抵消', () => {
    const r = rollPercentile({ bonus: 2, penalty: 2 }, seededRng(3));
    expect(r.net).toBe(0);
    expect(r.tens).toHaveLength(1);
  });

  it('奖励骰统计上确实更优（均值更低）', () => {
    const N = 30000;
    let s = 1;
    const plain = mean(N, () => rollPercentile({}, seededRng(s++)).value);
    const bonus = mean(N, () => rollPercentile({ bonus: 1 }, seededRng(s++)).value);
    expect(bonus).toBeLessThan(plain - 5);
  });
});

function mean(n: number, f: () => number): number {
  let s = 0;
  for (let i = 0; i < n; i++) s += f();
  return s / n;
}
