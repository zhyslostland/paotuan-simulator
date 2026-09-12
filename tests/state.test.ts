import { describe, expect, it } from 'vitest';
import { applyDeltas, createInitialState, type GameState } from '../src/core/state/gameState.js';
import { coc7 } from '../src/core/rulesets/index.js';
import { seededRng } from '../src/core/dice/index.js';

const base = (): GameState =>
  createInitialState({
    vitals: { hp: 12, san: 65, mp: 13 },
    inventory: [{ id: 'flashlight', name: '手电筒', qty: 1 }],
    flags: { basementUnlocked: false },
    clues: [],
    location: '走廊',
    npcsAlive: ['汉克'],
  });

describe('数值条变更', () => {
  it('inc / dec 生效', () => {
    const { state } = applyDeltas(base(), [{ target: 'vitals.san', op: 'dec', amount: 5 }], {
      ruleset: coc7,
    });
    expect(state.vitals.san).toBe(60);
  });

  it('amount 可以是骰子表达式，且由本地引擎求值', () => {
    const { state, rolls, applied } = applyDeltas(
      base(),
      [{ target: 'vitals.san', op: 'dec', amount: '1d6' }],
      { ruleset: coc7, rng: seededRng(11) }
    );
    expect(rolls).toHaveLength(1);
    expect(rolls[0]!.expression).toBe('1d6');
    expect(state.vitals.san).toBe(65 - rolls[0]!.total);
    expect(applied[0]!.resolvedAmount).toBe(rolls[0]!.total);
  });

  it('边界裁剪：不会掉到 0 以下，也不会超过 99', () => {
    const low = applyDeltas(base(), [{ target: 'vitals.hp', op: 'dec', amount: 999 }], {
      ruleset: coc7,
    });
    expect(low.state.vitals.hp).toBe(0);

    const high = applyDeltas(base(), [{ target: 'vitals.san', op: 'inc', amount: 999 }], {
      ruleset: coc7,
    });
    expect(high.state.vitals.san).toBe(99);
  });

  it('set 直接赋值', () => {
    const { state } = applyDeltas(base(), [{ target: 'vitals.san', op: 'set', value: 42 }], {
      ruleset: coc7,
    });
    expect(state.vitals.san).toBe(42);
  });
});

describe('非法变更一律拒绝，不抛异常', () => {
  it('拒绝未知路径根', () => {
    const { state, rejected } = applyDeltas(base(), [
      { target: 'password', op: 'set', value: 'hacked' },
      { target: '__proto__.x', op: 'set', value: 1 },
    ]);
    expect(rejected).toHaveLength(2);
    expect(state).toEqual(base());
  });

  it('拒绝数值条上的非法操作', () => {
    const { rejected } = applyDeltas(base(), [
      { target: 'vitals.san', op: 'add', value: 1 },
      { target: 'vitals.san', op: 'dec' },
      { target: 'vitals.san', op: 'set', value: 'abc' },
    ]);
    expect(rejected).toHaveLength(3);
  });

  it('拒绝规则包未定义的数值条（防模型凭空造字段）', () => {
    const { rejected, state } = applyDeltas(
      base(),
      [{ target: 'vitals.gold', op: 'inc', amount: 9999 }],
      { ruleset: coc7 }
    );
    expect(rejected).toHaveLength(1);
    expect(rejected[0]!.reason).toContain('未定义数值条');
    expect(state.vitals.gold).toBeUndefined();
  });

  it('拒绝删除不存在的物品 / NPC', () => {
    const { rejected } = applyDeltas(base(), [
      { target: 'inventory', op: 'remove', value: { id: 'chainsaw' } },
      { target: 'npcsAlive', op: 'remove', value: '不存在的人' },
    ]);
    expect(rejected).toHaveLength(2);
  });

  it('模型给了离谱 delta 也不会让一轮对话崩溃', () => {
    const { state, applied, rejected } = applyDeltas(
      base(),
      [
        { target: 'vitals.san', op: 'dec', amount: '1d6' },
        { target: 'unknown.thing', op: 'set', value: 1 },
        { target: 'clues', op: 'add', value: '地下室的血迹' },
      ],
      { ruleset: coc7, rng: seededRng(2) }
    );
    expect(applied).toHaveLength(2);
    expect(rejected).toHaveLength(1);
    expect(state.clues).toContain('地下室的血迹');
  });
});

describe('列表与标志位', () => {
  it('物品可叠加数量，不重复插入', () => {
    const { state } = applyDeltas(base(), [
      { target: 'inventory', op: 'add', value: { id: 'flashlight', name: '手电筒', qty: 2 } },
      { target: 'inventory', op: 'add', value: { id: 'knife', name: '匕首' } },
    ]);
    expect(state.inventory).toHaveLength(2);
    expect(state.inventory.find((i) => i.id === 'flashlight')?.qty).toBe(3);
    expect(state.inventory.find((i) => i.id === 'knife')?.qty).toBe(1);
  });

  it('NPC 死亡即从在场列表移除', () => {
    const { state } = applyDeltas(base(), [
      { target: 'npcsAlive', op: 'remove', value: '汉克' },
    ]);
    expect(state.npcsAlive).toEqual([]);
  });

  it('flags 支持嵌套路径', () => {
    const { state } = applyDeltas(base(), [
      { target: 'flags.basementUnlocked', op: 'set', value: true },
      { target: 'flags.met.hank', op: 'set', value: '1923-04-01' },
    ]);
    expect(state.flags.basementUnlocked).toBe(true);
    expect((state.flags.met as Record<string, unknown>).hank).toBe('1923-04-01');
  });
});

describe('不可变性', () => {
  it('applyDeltas 不修改传入的 state', () => {
    const original = base();
    const snapshot = JSON.parse(JSON.stringify(original));
    applyDeltas(
      original,
      [
        { target: 'vitals.san', op: 'dec', amount: 10 },
        { target: 'inventory', op: 'add', value: { id: 'key', name: '铜钥匙' } },
      ],
      { ruleset: coc7 }
    );
    expect(original).toEqual(snapshot);
  });
});
