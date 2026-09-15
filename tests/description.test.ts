import { describe, expect, it } from 'vitest';
import { weighDescription, type WeighContext } from '../src/core/description.js';

const ctx: WeighContext = {
  npcs: ['老霍华德'],
  visited: ['码头'],
  clues: ['灯塔第六夜不亮'],
  items: ['撬棍'],
};

describe('描述加权（改的是目标值，不是难度档位）', () => {
  it('没有描述 → 不加不减，也不逼玩家写作文', () => {
    expect(weighDescription('', ctx).bonus).toBe(0);
    expect(weighDescription('开门', ctx).bonus).toBe(0);
  });

  it('写得越多分越高（用户报的问题：以前写两句 +1、写一堆 +0）', () => {
    const two = weighDescription('我撬门', ctx);
    const many = weighDescription(
      '我把撬棍卡进门缝，肩膀顶住，先慢慢加力听听里面的动静，再猛地一压',
      ctx
    );
    expect(many.score).toBeGreaterThan(two.score);
    expect(many.bonus).toBeGreaterThan(two.bonus);
  });

  it('长度达标 +1，详细 +1，提到场上真实存在的东西再 +1（封顶 +2）', () => {
    const w = weighDescription('我在码头跟老霍华德打听灯塔的事，问他那卷胶卷到底给了谁', ctx);
    expect(w.score).toBe(2);
    expect(w.bonus).toBe(15);
  });

  it('百分比规则与加值规则的修正量不同', () => {
    const long = '我把撬棍卡进门缝，肩膀顶住，先慢慢加力听听里面的动静，再猛地一压';
    expect(weighDescription(long, ctx, 'percent').bonus).toBe(15);
    expect(weighDescription(long, ctx, 'modifier').bonus).toBe(2);
  });

  it('手里没有需要的武器 → 直接扣到负', () => {
    const w = weighDescription(
      '我举枪瞄准他，慢慢扣下扳机',
      { ...ctx, requiredWeapon: '射击（手枪）', hasWeapon: false },
      'percent'
    );
    expect(w.score).toBe(-2);
    expect(w.bonus).toBe(-15);
    expect(w.reasons.join()).toContain('手里没有');
  });

  it('有武器时不因为"提到枪"被扣分', () => {
    const w = weighDescription(
      '我举枪瞄准他，慢慢扣下扳机',
      { ...ctx, requiredWeapon: '射击（手枪）', hasWeapon: true },
      'percent'
    );
    expect(w.bonus).toBeGreaterThanOrEqual(0);
  });
});
