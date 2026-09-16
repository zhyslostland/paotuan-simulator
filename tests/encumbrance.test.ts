import { describe, expect, it } from 'vitest';
import {
  encumbranceNote,
  encumbranceOf,
  itemWeight,
  totalLoad,
} from '../src/core/encumbrance.js';
import { coc7, dnd5e } from '../src/core/rulesets/index.js';

const bag = (items: { name: string; qty?: number; weight?: number }[]) =>
  items.map((i) => ({ id: i.name, name: i.name, qty: i.qty ?? 1, ...(i.weight === undefined ? {} : { weight: i.weight }) }));

describe('负重', () => {
  it('没写重量的物品按 1 兜底（旧档不会有这个字段）', () => {
    expect(itemWeight({} as never)).toBe(1);
    expect(itemWeight({ weight: 0 } as never)).toBe(1);
    expect(itemWeight({ weight: -3 } as never)).toBe(1);
    expect(itemWeight({ weight: 4 } as never)).toBe(4);
  });

  it('总负重 = 单件重量 × 数量', () => {
    expect(totalLoad(bag([{ name: '子弹', qty: 6 }, { name: '铁箱', weight: 8 }]))).toBe(14);
  });

  it('没超重就不罚', () => {
    const e = encumbranceOf(bag([{ name: '手电筒' }]), 10, 'percent');
    expect(e.tier).toBe(0);
    expect(e.penalty).toBe(0);
  });

  it('超重一档：d100 目标值 -10，d20 加值 -1', () => {
    const items = bag([{ name: '一箱书', weight: 12 }]);
    expect(encumbranceOf(items, 10, 'percent').penalty).toBe(-10);
    expect(encumbranceOf(items, 10, 'modifier').penalty).toBe(-1);
    expect(encumbranceOf(items, 10, 'percent').tier).toBe(1);
  });

  it('严重超重（1.5 倍以上）：d100 -20，d20 -2', () => {
    const items = bag([{ name: '一具尸体', weight: 20 }]);
    const e = encumbranceOf(items, 10, 'percent');
    expect(e.tier).toBe(2);
    expect(e.penalty).toBe(-20);
    expect(encumbranceOf(items, 10, 'modifier').penalty).toBe(-2);
  });

  it('规则包没给上限 → 不启用，一律不惩罚', () => {
    const e = encumbranceOf(bag([{ name: '一整座房子', weight: 999 }]), null, 'percent');
    expect(e.capacity).toBeNull();
    expect(e.tier).toBe(0);
    expect(e.penalty).toBe(0);
    expect(encumbranceNote(e)).toBeNull();
  });

  it('上限由规则包从属性派生：COC 看力量+体格，DnD 看力量', () => {
    // 常人各 50 → 50 点（一件小东西算 1 点，够装一身行头加补给）
    expect(coc7.carryCapacity?.({ str: 50, siz: 50 })).toBe(50);
    // 壮汉
    expect(coc7.carryCapacity?.({ str: 80, siz: 80 })).toBe(80);
    // DnD：力量 10 → 50，18 → 74
    expect(dnd5e.carryCapacity?.({ str: 10 })).toBe(50);
    expect(dnd5e.carryCapacity?.({ str: 18 })).toBe(74);
  });

  it('一身行头加弹药不该被判超重（宁可宽，不要误伤）', () => {
    const everyday = bag([
      { name: '手电筒' },
      { name: '笔记本' },
      { name: '钢笔' },
      { name: '火柴', qty: 3 },
      { name: '钱包' },
      { name: '钥匙' },
      { name: '左轮', weight: 2 },
      { name: '子弹', qty: 12 },
      { name: '风衣', weight: 2 },
    ]);
    const e = encumbranceOf(everyday, coc7.carryCapacity!({ str: 50, siz: 50 }), 'percent');
    expect(e.tier).toBe(0);
  });

  it('给守密人的提示只在超重时出现，且不报数字', () => {
    const over = encumbranceOf(bag([{ name: '铁箱', weight: 12 }]), 10, 'percent');
    const note = encumbranceNote(over)!;
    expect(note).toContain('超重');
    expect(note).not.toMatch(/-\d+/);
    expect(note).not.toContain('负重单位');
    expect(encumbranceNote(encumbranceOf(bag([{ name: '手电筒' }]), 10))).toBeNull();
  });
});
