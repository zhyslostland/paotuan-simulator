import { describe, expect, it } from 'vitest';
import {
  applyDeltas,
  createInitialState,
  detectStatusEvents,
  type GameState,
} from '../src/core/state/gameState.js';
import { coc7 } from '../src/core/rulesets/index.js';
import { seededRng } from '../src/core/dice/index.js';

const base = (): GameState =>
  createInitialState({
    vitals: { hp: 12, san: 65, mp: 13 },
    companions: [
      {
        id: 'jack',
        name: '老杰克',
        role: '退休铁路工',
        personality: '话少',
        skills: { 体格: 65 },
        vitals: { hp: 14, san: 55, mp: 10 },
        initiative: 'reactive',
        alive: true,
        present: true,
      },
    ],
    inventory: [{ id: 'flashlight', name: '手电筒', qty: 1 }],
    flags: { basementUnlocked: false },
    clues: [],
    location: '走廊',
    npcsAlive: ['汉克'],
  });

describe('数值条变更', () => {
  it('inc / dec 生效', () => {    const { state } = applyDeltas(base(), [{ target: 'vitals.san', op: 'dec', amount: 5 }], {
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

describe('NPC 队友', () => {
  const jack = (s: GameState) => s.companions.find((c) => c.id === 'jack')!;

  it('队友数值条可增减，且表达式由本地掷骰', () => {
    const { state, rolls } = applyDeltas(
      base(),
      [{ target: 'companions.jack.vitals.hp', op: 'dec', amount: '1d6' }],
      { ruleset: coc7, rng: seededRng(8) }
    );
    expect(rolls).toHaveLength(1);
    expect(jack(state).vitals.hp).toBe(14 - rolls[0]!.total);
  });

  it('队友数值同样受规则边界裁剪', () => {
    const { state } = applyDeltas(
      base(),
      [{ target: 'companions.jack.vitals.san', op: 'dec', amount: 999 }],
      { ruleset: coc7 }
    );
    expect(jack(state).vitals.san).toBe(0);
  });

  it('未知队友 id 被拒绝', () => {
    const { rejected, state } = applyDeltas(
      base(),
      [{ target: 'companions.ghost.vitals.hp', op: 'dec', amount: 3 }],
      { ruleset: coc7 }
    );
    expect(rejected).toHaveLength(1);
    expect(rejected[0]!.reason).toContain('队伍中没有');
    expect(jack(state).vitals.hp).toBe(14);
  });

  it('alive / present 只接受 set，且被正确写入', () => {
    const { state } = applyDeltas(
      base(),
      [{ target: 'companions.jack.alive', op: 'set', value: false }],
      { ruleset: coc7 }
    );
    expect(jack(state).alive).toBe(false);

    const bad = applyDeltas(
      base(),
      [{ target: 'companions.jack.alive', op: 'inc', amount: 1 }],
      { ruleset: coc7 }
    );
    expect(bad.rejected).toHaveLength(1);
  });

  it('不允许修改队友的性格、技能等固定字段', () => {
    const { rejected } = applyDeltas(
      base(),
      [
        { target: 'companions.jack.personality', op: 'set', value: '突然很话痨' },
        { target: 'companions.jack.skills', op: 'set', value: {} },
        { target: 'companions.jack', op: 'set', value: null },
      ],
      { ruleset: coc7 }
    );
    expect(rejected).toHaveLength(3);
  });

  it('修改队友不会波及玩家自身状态', () => {
    const { state } = applyDeltas(
      base(),
      [{ target: 'companions.jack.vitals.san', op: 'dec', amount: 10 }],
      { ruleset: coc7 }
    );
    expect(jack(state).vitals.san).toBe(45);
    expect(state.vitals.san).toBe(65);
  });
});

describe('背包', () => {
  it('新增物品会带上简介与武器属性', () => {
    const { state } = applyDeltas(
      base(),
      [
        {
          target: 'inventory',
          op: 'add',
          value: {
            id: 'colt',
            name: '柯尔特左轮',
            qty: 1,
            desc: '六发转轮，枪管有锈',
            kind: 'weapon',
            damage: '1d10',
            skill: '射击（手枪）',
          },
        },
      ]
    );
    const item = state.inventory.find((i) => i.id === 'colt');
    expect(item?.desc).toBe('六发转轮，枪管有锈');
    expect(item?.kind).toBe('weapon');
    expect(item?.damage).toBe('1d10');
    expect(item?.skill).toBe('射击（手枪）');
  });

  it('重复拾取只加数量，并补全后来才知道的属性', () => {
    let s = base();
    ({ state: s } = applyDeltas(s, [
      { target: 'inventory', op: 'add', value: { id: 'flashlight', name: '手电筒', qty: 1 } },
    ]));
    expect(s.inventory.find((i) => i.id === 'flashlight')?.qty).toBe(2);

    ({ state: s } = applyDeltas(s, [
      {
        target: 'inventory',
        op: 'add',
        value: { id: 'flashlight', name: '手电筒', qty: 1, desc: '铜壳，还能用' },
      },
    ]));
    const item = s.inventory.find((i) => i.id === 'flashlight');
    expect(item?.qty).toBe(3);
    expect(item?.desc).toBe('铜壳，还能用');
  });

  it('消耗品可以被扣掉', () => {
    const { state } = applyDeltas(base(), [
      { target: 'inventory', op: 'remove', value: '手电筒' },
    ]);
    expect(state.inventory.find((i) => i.id === 'flashlight')).toBeUndefined();
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

describe('战斗轮', () => {
  it('开局不在战斗中', () => {
    expect(createInitialState().combat).toEqual({ active: false, round: 0, foes: [] });
  });

  it('可以开关战斗并推进轮次', () => {
    let s = base();
    ({ state: s } = applyDeltas(s, [
      { target: 'combat.active', op: 'set', value: true },
      { target: 'combat.round', op: 'set', value: 1 },
    ]));
    expect(s.combat).toEqual({ active: true, round: 1, foes: [] });

    ({ state: s } = applyDeltas(s, [{ target: 'combat.round', op: 'set', value: 2 }]));
    expect(s.combat.round).toBe(2);

    ({ state: s } = applyDeltas(s, [{ target: 'combat.active', op: 'set', value: false }]));
    expect(s.combat.active).toBe(false);
  });

  it('轮次会被强制收敛为非负整数', () => {
    const { state } = applyDeltas(base(), [
      { target: 'combat.round', op: 'set', value: 3.7 },
    ]);
    expect(state.combat.round).toBe(3);

    const neg = applyDeltas(base(), [{ target: 'combat.round', op: 'set', value: -5 }]);
    expect(neg.state.combat.round).toBe(0);
  });

  it('只接受 set，且不接受 active/round 以外的字段', () => {
    const { rejected } = applyDeltas(base(), [
      { target: 'combat.active', op: 'inc', amount: 1 },
      { target: 'combat.initiative', op: 'set', value: ['玩家', '怪物'] },
    ]);
    expect(rejected).toHaveLength(2);
  });

  it('旧存档没有 combat 字段时补默认值，不会崩', () => {
    const legacy = { ...base(), combat: undefined } as unknown as GameState;
    const { state } = applyDeltas(legacy, [
      { target: 'combat.active', op: 'set', value: true },
    ]);
    expect(state.combat.active).toBe(true);
  });
});

describe('战斗敌人（foes）', () => {
  it('敌人登场、扣血、移除', () => {
    let s = base();
    ({ state: s } = applyDeltas(s, [
      { target: 'combat.foes', op: 'add', value: { name: '雾中的巨影', hp: 20, max: 20 } },
    ]));
    expect(s.combat.foes).toHaveLength(1);
    expect(s.combat.foes[0]).toMatchObject({ name: '雾中的巨影', hp: 20, max: 20 });

    ({ state: s } = applyDeltas(s, [
      { target: 'combat.foes', op: 'dec', value: '雾中的巨影', amount: 8 },
    ]));
    expect(s.combat.foes[0]!.hp).toBe(12);

    ({ state: s } = applyDeltas(s, [
      { target: 'combat.foes', op: 'remove', value: '雾中的巨影' },
    ]));
    expect(s.combat.foes).toHaveLength(0);
  });

  it('扣血不会低于 0，且不存在的敌人会被拒绝', () => {
    let s = base();
    ({ state: s } = applyDeltas(s, [
      { target: 'combat.foes', op: 'add', value: { name: '怪物', hp: 5, max: 5 } },
    ]));
    ({ state: s } = applyDeltas(s, [
      { target: 'combat.foes', op: 'dec', value: '怪物', amount: 99 },
    ]));
    expect(s.combat.foes[0]!.hp).toBe(0);

    const r = applyDeltas(base(), [
      { target: 'combat.foes', op: 'dec', value: '不存在的', amount: 3 },
    ]);
    expect(r.rejected).toHaveLength(1);
  });
});

describe('理智疯狂与死亡', () => {
  it('单次理智损失 ≥ 5 → 临时疯狂', () => {
    const report = applyDeltas(
      base(),
      [{ target: 'vitals.san', op: 'dec', amount: 6 }],
      { ruleset: coc7 }
    );
    const events = detectStatusEvents(report.applied, report.state);
    expect(events.some((e) => e.kind === 'temp_insanity')).toBe(true);
  });

  it('理智损失 < 5 不触发临时疯狂', () => {
    const report = applyDeltas(
      base(),
      [{ target: 'vitals.san', op: 'dec', amount: 4 }],
      { ruleset: coc7 }
    );
    const events = detectStatusEvents(report.applied, report.state);
    expect(events.some((e) => e.kind === 'temp_insanity')).toBe(false);
  });

  it('理智归零 → 永久疯狂；生命归零 → 濒死', () => {
    const sanZero = applyDeltas(
      base(),
      [{ target: 'vitals.san', op: 'set', value: 0 }],
      { ruleset: coc7 }
    );
    expect(
      detectStatusEvents(sanZero.applied, sanZero.state).some((e) => e.kind === 'permanent_insanity')
    ).toBe(true);

    const hpZero = applyDeltas(
      base(),
      [{ target: 'vitals.hp', op: 'set', value: 0 }],
      { ruleset: coc7 }
    );
    expect(detectStatusEvents(hpZero.applied, hpZero.state).some((e) => e.kind === 'dying')).toBe(true);
  });
});

describe('地点与"到过的地方"', () => {
  it('改地点会记进 visited（供地图迷雾判断哪些地方玩家知道）', () => {
    const r = applyDeltas(base(), [
      { target: 'location', op: 'set', value: '旧城区' },
    ]);
    expect(r.state.location).toBe('旧城区');
    expect(r.state.visited).toContain('旧城区');
  });

  it('重复去同一个地方不会重复记录', () => {
    let s = applyDeltas(base(), [{ target: 'location', op: 'set', value: '码头' }]).state;
    s = applyDeltas(s, [{ target: 'location', op: 'set', value: '码头' }]).state;
    expect(s.visited!.filter((x) => x === '码头')).toHaveLength(1);
  });

  it('地点不支持 inc / dec，会被拒绝', () => {
    const r = applyDeltas(base(), [{ target: 'location', op: 'inc', amount: 1 }]);
    expect(r.rejected).toHaveLength(1);
  });
});

describe('支线表（threads）', () => {
  it('add / set / remove 维护支线', () => {
    let s = base();
    ({ state: s } = applyDeltas(s, [
      { target: 'threads', op: 'add', value: { name: '寻找妹妹', status: '刚接下的委托' } },
    ]));
    expect(s.threads).toEqual([{ name: '寻找妹妹', status: '刚接下的委托' }]);

    ({ state: s } = applyDeltas(s, [
      { target: 'threads', op: 'set', value: { name: '寻找妹妹', status: '已锁定嫌疑人' } },
    ]));
    expect(s.threads[0]!.status).toBe('已锁定嫌疑人');

    ({ state: s } = applyDeltas(s, [
      { target: 'threads', op: 'remove', value: '寻找妹妹' },
    ]));
    expect(s.threads).toHaveLength(0);
  });

  it('add 支持字符串名；set 到不存在的线会自动建一条', () => {
    let s = base();
    ({ state: s } = applyDeltas(s, [{ target: 'threads', op: 'add', value: '调查井水' }]));
    expect(s.threads).toEqual([{ name: '调查井水', status: '' }]);

    ({ state: s } = applyDeltas(s, [
      { target: 'threads', op: 'set', value: { name: '新线', status: '开始' } },
    ]));
    expect(s.threads.find((t) => t.name === '新线')).toEqual({ name: '新线', status: '开始' });
  });

  it('旧存档没有 threads 字段也能安全应用', () => {
    const legacy = { ...base(), threads: undefined } as unknown as GameState;
    const { state } = applyDeltas(legacy, [
      { target: 'threads', op: 'add', value: { name: '主线', status: '开团' } },
    ]);
    expect(state.threads).toHaveLength(1);
  });
});

describe('背包按数量消耗', () => {
  const withAmmo = (): GameState => ({
    ...base(),
    inventory: [
      { id: 'ammo', name: '子弹', qty: 3 },
      { id: 'bandage', name: '绷带', qty: 1 },
    ],
  });

  it('3 发子弹用掉 1 发后剩 2（qty 递减）', () => {
    const { state, applied } = applyDeltas(withAmmo(), [
      { target: 'inventory', op: 'dec', value: '子弹', amount: 1 },
    ]);
    expect(state.inventory.find((i) => i.name === '子弹')!.qty).toBe(2);
    expect(applied[0]!.resolvedAmount).toBe(1);
  });

  it('只带 value（按名字命中）也支持，不写 amount 时默认扣 1', () => {
    const { state } = applyDeltas(withAmmo(), [
      { target: 'inventory', op: 'dec', value: '子弹' },
    ]);
    expect(state.inventory.find((i) => i.name === '子弹')!.qty).toBe(2);
  });

  it('扣到 0 就从背包里移除（不能留下 0 件或负数）', () => {
    const { state } = applyDeltas(withAmmo(), [
      { target: 'inventory', op: 'dec', value: '子弹', amount: 3 },
    ]);
    expect(state.inventory.some((i) => i.name === '子弹')).toBe(false);

    const over = applyDeltas(withAmmo(), [
      { target: 'inventory', op: 'dec', value: '绷带', amount: 5 },
    ]);
    expect(over.state.inventory.some((i) => i.name === '绷带')).toBe(false);
  });

  it('也接受 target 写成 inventory.<物品名> 的形式', () => {
    const { state } = applyDeltas(withAmmo(), [
      { target: 'inventory.子弹', op: 'dec', amount: 2 },
    ]);
    expect(state.inventory.find((i) => i.name === '子弹')!.qty).toBe(1);
  });

  it('amount 可以是骰子表达式', () => {
    const { state, rolls } = applyDeltas(
      { ...withAmmo(), inventory: [{ id: 'ammo', name: '子弹', qty: 10 }] },
      [{ target: 'inventory', op: 'dec', value: '子弹', amount: '1d6' }],
      { rng: seededRng(5) }
    );
    expect(rolls).toHaveLength(1);
    expect(state.inventory[0]!.qty).toBe(10 - rolls[0]!.total);
  });

  it('inc 可以补给；不存在的物品与非法数量会被拒绝', () => {
    const add = applyDeltas(withAmmo(), [
      { target: 'inventory', op: 'inc', value: '子弹', amount: 4 },
    ]);
    expect(add.state.inventory.find((i) => i.name === '子弹')!.qty).toBe(7);

    const missing = applyDeltas(withAmmo(), [
      { target: 'inventory', op: 'dec', value: '不存在的', amount: 1 },
    ]);
    expect(missing.rejected).toHaveLength(1);

    const bad = applyDeltas(withAmmo(), [
      { target: 'inventory', op: 'dec', value: '子弹', amount: 0 },
    ]);
    expect(bad.rejected).toHaveLength(1);
  });
});
