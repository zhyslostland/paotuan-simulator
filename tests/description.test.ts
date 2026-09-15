import { describe, expect, it } from 'vitest';
import { weighDescription, DIFFICULTY_LABEL, type WeighContext } from '../src/core/description.js';

const ctx: WeighContext = {
  npcs: ['老霍华德'],
  visited: ['码头'],
  clues: ['灯塔第六夜不亮'],
  items: ['撬棍'],
};

describe('描述加权（每一次检定都算，但只调难度档位）', () => {
  it('空描述不奖不罚 —— 不逼玩家写作文', () => {
    expect(weighDescription('', ctx).score).toBe(0);
    expect(weighDescription('开门', ctx).difficulty).toBe('regular');
    expect(weighDescription('', ctx).reasons.join()).toContain('难度不变');
  });

  it('点到了场上真实存在的东西 +1', () => {
    const w = weighDescription('我向老霍华德打听灯塔的事', ctx);
    expect(w.score).toBe(1);
    expect(w.reasons.join()).toContain('老霍华德');
  });

  it('写明具体做法 +1', () => {
    expect(weighDescription('我慢慢把门推开一条缝', ctx).score).toBe(1);
  });

  it('两条都占满 → 难度降一档', () => {
    // 撬棍（随身物品）+1、"用 / 慢慢"（做法）+1
    const w = weighDescription('我用撬棍卡进门缝，慢慢加力', ctx, 'hard');
    expect(w.score).toBe(2);
    expect(w.difficulty).toBe('regular');
    expect(weighDescription('我用撬棍卡进门缝，慢慢加力', ctx, 'extreme').difficulty).toBe('hard');
  });

  it('普通难度不能再降（幅度封顶一档）', () => {
    expect(weighDescription('我用撬棍卡进门缝，慢慢加力', ctx, 'regular').difficulty).toBe(
      'regular'
    );
  });

  it('手里没有需要的武器 → 扣分并升一档', () => {
    const w = weighDescription(
      '我举枪瞄准他',
      { ...ctx, requiredWeapon: '射击（手枪）', hasWeapon: false },
      'regular'
    );
    expect(w.score).toBeLessThanOrEqual(-1);
    expect(w.difficulty).toBe('hard');
    expect(w.reasons.join()).toContain('手里没有');
  });

  it('有武器时不会因为"提到枪"被扣分', () => {
    const w = weighDescription(
      '我举枪瞄准他',
      { ...ctx, requiredWeapon: '射击（手枪）', hasWeapon: true },
      'regular'
    );
    expect(w.score).toBeGreaterThanOrEqual(0);
  });

  it('写得长但没有实质内容 → 不加分（防刷描述）', () => {
    const w = weighDescription('我要想办法把这件事给办了，总之一定要成功才行啊', ctx);
    expect(w.score).toBeLessThan(2);
    expect(w.difficulty).toBe('regular');
  });

  it('难度标签齐全', () => {
    expect(Object.values(DIFFICULTY_LABEL)).toEqual(['普通', '困难', '极难']);
  });
});
