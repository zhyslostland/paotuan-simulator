import { describe, expect, it } from 'vitest';
import {
  applyDeltas,
  createInitialState,
  detectStatusEvents,
  DYING_FREEZE_REASON,
  UNNAMED_FOE,
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
    /*
     * 被拒之后状态**实质**不变。
     *
     * 注意不能拿整个对象去比 `base()` —— `applyDeltas` 会给时钟补初值
     * （`clock` 原先没有，进来后被填成"第 1 天 09:00"）。
     * 那是**约定的补齐**，不是"被拒绝的 delta 生效了"，
     * 所以这里只比那些可能被篡改的字段。
     */
    const b = base();
    expect(state).toEqual({ ...b, clock: state.clock });
    expect(state.clock).toEqual({ day: 1, minute: 9 * 60 });
  });

  /**
   * 🔴 **`wounds` 不许由模型自带** —— 2026-09-30 基础完善（批次 A）补的闸门行为断言。
   *
   * 收口前的真实形态（取证脚本跑出来的）：`wounds` 在 `ALLOWED_ROOTS` 里，
   * 而 `applyDeltas` **没有任何 `wounds` 分支** → 它掉进"自由字段"兜底，
   * 把模型给的值**整包照抄**进 `state.wounds`，绕过 `core/wounds.ts` 的档位/流失量真源。
   * 也就是说：白名单写着"可以写"，引擎其实只会照抄。
   *
   * 现在它归 `ENGINE_ONLY_ROOTS`：**拒掉，并且告诉模型该走哪条路**（`flags.伤口`）。
   * 后半句同样重要 —— 只说"不允许"会让模型反复试同一个错根（`P2-10` 家族就是这么磨的）。
   */
  it('模型不许自带 wounds：拒掉，且提示它改用 flags.伤口', () => {
    const { state, rejected } = applyDeltas(base(), [
      { target: 'wounds', op: 'set', value: [{ tier: 'grievous' }] },
      { target: 'wounds.0', op: 'set', value: { tier: 'grievous' } },
    ]);
    expect(rejected).toHaveLength(2);
    expect(state.wounds ?? []).toEqual([]);
    for (const r of rejected) {
      expect(r.reason).toContain('不允许修改的路径根');
      expect(r.reason).toContain('flags.伤口');
    }
  });

  it('引擎独占的其他根也一律拒（clock / deadline / 图鉴台账）', () => {
    const { rejected } = applyDeltas(base(), [
      { target: 'clock.minute', op: 'set', value: 600 },
      { target: 'deadline.remain', op: 'set', value: 1 },
      { target: 'encountered', op: 'add', value: '雾中的巨影' },
      { target: 'fought', op: 'add', value: '雾中的巨影' },
    ]);
    expect(rejected).toHaveLength(4);
    // 每条都要给出路，而不是一句干巴巴的"不允许"
    expect(rejected[0]!.reason).toContain('elapsed');
    expect(rejected[2]!.reason).toContain('图鉴');
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

  it('可以开打与收场（收场要看理由）', () => {
    let s = base();
    ({ state: s } = applyDeltas(s, [
      { target: 'combat.foes', op: 'add', value: { name: '怪物', hp: 5, max: 5 } },
      { target: 'combat.active', op: 'set', value: true },
    ]));
    expect(s.combat.active).toBe(true);
    expect(s.combat.foes).toHaveLength(1);

    // 有活敌人在场要关战斗 → 必须带说得通的理由（`G24` 正面）
    const noReason = applyDeltas(s, [{ target: 'combat.active', op: 'set', value: false }]);
    expect(noReason.rejected).toHaveLength(1);
    expect(noReason.state.combat.active).toBe(true);

    const fled = applyDeltas(s, [
      { target: 'combat.active', op: 'set', value: false, reason: '它夺路逃走了' },
    ] as never);
    expect(fled.state.combat.active).toBe(false);
  });

  it('🔴 `G1`：模型写的 `combat.round` 一律被忽略（轮次是引擎独占的）', () => {
    /*
     * 真机 `0 → 2 → 4` 的第二个成因：模型照抄旧提示词在契约里写了 round，
     * 引擎在**它写的值**上再 +1。现在模型写什么都无效 —— 轮次只由 store 推进。
     */
    const s0 = base();
    const r = applyDeltas(s0, [
      { target: 'combat.foes', op: 'add', value: { name: '怪物', hp: 5, max: 5 } },
      { target: 'combat.round', op: 'set', value: 7 },
    ]);
    expect(r.state.combat.round).toBe(s0.combat.round); // 一位都没动
    // 也不该当成"被拒的变更"报到玩家脸上（那只是模型多写的一笔，不是玩家的账）
    expect(r.rejected).toHaveLength(0);
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
      { target: 'combat.foes', op: 'add', value: { name: '怪物', hp: 5, max: 5 } },
      { target: 'combat.active', op: 'set', value: true },
    ]);
    expect(state.combat.active).toBe(true);
    expect(state.combat.foes).toHaveLength(1);
  });

  it('🔴 `G24` 反面：空场不许保持战斗（收口按最终结果归一）', () => {
    // 开打 → 把最后一个敌人摘走 → 战斗当场收场（横幅该消失）
    let s = base();
    ({ state: s } = applyDeltas(s, [
      { target: 'combat.foes', op: 'add', value: { name: '怪物', hp: 5, max: 5 } },
      { target: 'combat.active', op: 'set', value: true },
    ]));
    expect(s.combat.active).toBe(true);

    const after = applyDeltas(s, [{ target: 'combat.foes', op: 'remove', value: '怪物' }]);
    expect(after.state.combat.foes).toHaveLength(0);
    expect(after.state.combat.active).toBe(false);

    // 空场还硬要开着战斗 → 归一掉（模型绕不过去）
    const empty = applyDeltas(base(), [{ target: 'combat.active', op: 'set', value: true }]);
    expect(empty.state.combat.active).toBe(false);
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

  /*
   * 🔴 主人 2026-09-27 真机改了这条的行为：「敌人血量归零还活着」。
   *
   * 以前引擎只把数字减到 0 就完事，那条空血的敌人**还留在 `combat.foes` 里** ——
   * 血条停在 0、战斗不结束、守密人下一轮还在演它行动。
   * 现在：**打空即移除**（连"少于 0"都不可能存在了，判据比原来更硬）；
   * 场上最后一个倒下时，引擎顺手收场（`combat.active = false`）。
   */
  it('血被打空 → 敌人当场倒下（移出战斗），只剩它一个时战斗同时结束', () => {
    let s = base();
    ({ state: s } = applyDeltas(s, [
      { target: 'combat.foes', op: 'add', value: { name: '怪物', hp: 5, max: 5 } },
    ]));
    ({ state: s } = applyDeltas(s, [
      { target: 'combat.foes', op: 'dec', value: '怪物', amount: 99 },
    ]));
    expect(s.combat.foes).toHaveLength(0);
    expect(s.combat.active).toBe(false);
    // 已经倒下的敌人再挨一下 → 拒绝（它不在场上了，不是静默吞掉）
    const after = applyDeltas(s, [
      { target: 'combat.foes', op: 'dec', value: '怪物', amount: 3 },
    ]);
    expect(after.rejected).toHaveLength(1);
    expect(after.rejected[0]!.reason).toContain('怪物');

    const r = applyDeltas(base(), [
      { target: 'combat.foes', op: 'dec', value: '不存在的', amount: 3 },
    ]);
    expect(r.rejected).toHaveLength(1);
  });

  /* ------------------------------------------------------------
   * 🔴 `P1-5` 阶段二：命中 ↔ 伤害绑定（主人 2026-09-28 拍板「骰子说了算」）
   *
   * 症状原话：「开枪检定成功，描述没打中，敌人血量扣除」「换撬棍打，没触发检定，
   * 描述没打中，敌人血量扣除了」。伤害是守密人另写一条 dec 申报的，跟掷没掷中毫无关系。
   * 现在：**带 weapon 的攻击**必须有命中授权；环境类伤害（不带 weapon）照旧。
   * ------------------------------------------------------------ */
  const foeBase = () => {
    let st = base();
    ({ state: st } = applyDeltas(st, [
      { target: 'combat.active', op: 'set', value: true },
      { target: 'combat.foes', op: 'add', value: { name: '怪物', hp: 20, max: 20 } },
    ]));
    return st;
  };
  const swing = (weapon?: string) => [
    { target: 'combat.foes', op: 'dec' as const, value: '怪物', amount: 5, ...(weapon ? { weapon } : {}) },
  ];

  it('🔴 掷了没过（miss）→ 带武器的伤害被拒，理由说人话', () => {
    const r = applyDeltas(foeBase(), swing('手枪') as never, { ruleset: coc7, foeDamage: 'miss' });
    expect(r.rejected).toHaveLength(1);
    /*
     * ⚠️ **2026-09-30 有意改掉那句旧话术**（不是为了让测试变绿而放宽断言）。
     *
     * 原来断言的是 `toContain('没打中')`，因为当时的理由是
     * 「这一下没打中（攻击检定没过），「怪物」不该掉血」。
     * 用户随后亲报：「我说我要开枪、**检定通过**，他说我打歪了」——
     * 那句话把**"这次伤害申报不成立"**说成了**"你没打中"**，
     * 而玩家卡片上那一掷可能显示**成功**，屏幕上两句话自相矛盾。
     *
     * 现在的话术（真源在 `core/state/refusal.ts`）陈述**机制事实**并给出路；
     * 完整判据在 `tests/refusalWording.test.ts`（含"三种授权话术都不许含判定语言"）。
     * **别再改回"没打中"** —— 那正是这次要修的 bug。
     */
    expect(r.rejected[0]!.reason).toContain('没有落地');
    expect(r.rejected[0]!.reason).not.toContain('没打中');
    expect(r.rejected[0]!.reason).toContain('重新掷一次攻击检定');
    expect(r.state.combat.foes[0]!.hp).toBe(20);
  });

  it('🔴 这一轮压根没掷（none）→ 也拒，并说清"还没掷过"', () => {
    const r = applyDeltas(foeBase(), swing('手枪') as never, { ruleset: coc7, foeDamage: 'none' });
    expect(r.rejected).toHaveLength(1);
    expect(r.rejected[0]!.reason).toContain('还没掷过');
  });

  it('🔴 掷中了（hit）→ 放行，伤害照旧由引擎按武器表掷', () => {
    const r = applyDeltas(foeBase(), swing('手枪') as never, {
      ruleset: coc7,
      foeDamage: 'hit',
      rng: () => 0,
    });
    expect(r.rejected).toHaveLength(0);
    expect(r.applied[0]!.after).toBe(19); // 手枪 1d10，固定骰掷出 1
  });

  it('不带 weapon 的伤害不吃这一闸（推倒书架砸它、它自己摔下去都照旧）', () => {
    const r = applyDeltas(foeBase(), swing() as never, { ruleset: coc7, foeDamage: 'miss' });
    expect(r.rejected).toHaveLength(0);
    expect(r.state.combat.foes[0]!.hp).toBe(15);
  });

  it('不传 foeDamage（老调用方 / 单测）→ 完全走现状', () => {
    const r = applyDeltas(foeBase(), swing('手枪') as never, { ruleset: coc7, rng: () => 0 });
    expect(r.rejected).toHaveLength(0);
  });

  /* ------------------------------------------------------------
   * 🔴 `G24`（协28 §F① 第 3 条）：敌人还活着，不许把战斗静默关掉。
   *
   * 真机：`combat` 从 `{active:true, foes:[深潜者群 30/40]}` 直接变 `{active:false, 同一个 30/40}`
   * —— 横幅没了、对面还在满血移动，玩家以为战斗被吞了。
   * ------------------------------------------------------------ */
  const closeIt = (reason?: string) => [
    {
      target: 'combat.active',
      op: 'set' as const,
      value: false,
      ...(reason ? { reason } : {}),
    },
  ];

  it('🔴 G24：场上还有活敌人 → `active=false` 被拒，战斗保持开着', () => {
    const r = applyDeltas(foeBase(), closeIt() as never, { ruleset: coc7 });
    expect(r.rejected).toHaveLength(1);
    expect(r.rejected[0]!.reason).toContain('还有活着的敌人');
    expect(r.state.combat.active).toBe(true);
  });

  it('🔴 G24：写明理由（逃走 / 投降 / 脱离）→ 放行', () => {
    const r = applyDeltas(foeBase(), closeIt('它夺路逃走了') as never, { ruleset: coc7 });
    expect(r.rejected).toHaveLength(0);
    expect(r.state.combat.active).toBe(false);
  });

  it('G24：敌人已经清空 → 正常收场不受影响（引擎自己也会关）', () => {
    const r = applyDeltas(
      foeBase(),
      [
        { target: 'combat.foes', op: 'dec', value: '怪物', amount: 99 },
        { target: 'combat.active', op: 'set', value: false },
      ] as never,
      { ruleset: coc7 }
    );
    expect(r.rejected).toHaveLength(0);
    expect(r.state.combat.active).toBe(false);
  });

  /* ------------------------------------------------------------
   * 🔴 `G25` + `G27`（协28 §F① 第 6b 条 · 主人 2026-09-29 拍板）：
   * **动玩家属性要先过检定；死定了就一次掉到位。**
   *
   * 病：`vitals.*` 的变更完全由模型申报，引擎从不问"凭什么掉" ——
   * 真机 62 轮 `hp` 一次没动（模型倾向不扣血 → "死亡 = 结档"几乎不可达），
   * 反过来它也能随口扣。`ctx.harm` 只有 `applyModelDeltas` 会传，
   * **引擎自己写的账不传** —— 所以这道闸只管模型。
   * ------------------------------------------------------------ */
  const blood = (hp = 10) =>
    createInitialState({
      vitals: { hp, san: 60, mp: 10 },
      vitalsMax: { hp: 10, san: 99, mp: 10 },
    });
  const hurt = (amount: number, extra: Record<string, unknown> = {}) =>
    applyDeltas(
      blood(),
      [{ target: 'vitals.hp', op: 'dec', amount, ...extra }] as never,
      { ruleset: coc7, harm: { checked: true, fumble: false } }
    );
  const hurtNoCheck = (amount: number, extra: Record<string, unknown> = {}) =>
    applyDeltas(blood(), [{ target: 'vitals.hp', op: 'dec', amount, ...extra }] as never, {
      ruleset: coc7,
      harm: { checked: false, fumble: false },
    });

  it('🔴 `G25`：这一轮没掷过检定 → 扣血被拒，并说清"要先过检定"', () => {
    const r = hurtNoCheck(3);
    expect(r.rejected).toHaveLength(1);
    expect(r.rejected[0]!.reason).toContain('检定');
    expect(r.state.vitals.hp).toBe(10); // 一点没动
  });

  it('🔴 `G25`：掷过了 → 放行，血真的掉', () => {
    const r = hurt(3);
    expect(r.rejected).toHaveLength(0);
    expect(r.state.vitals.hp).toBe(7);
  });

  it('环境伤害（写明 reason）可以不给检定 —— 与 `G24` 同一条口径', () => {
    const r = hurtNoCheck(3, { reason: '从二楼的窗户摔下去' });
    expect(r.rejected).toHaveLength(0);
    expect(r.state.vitals.hp).toBe(7);
  });

  it('🔴 保底 1：报 0 也得真的掉（「改掉属性就掉」）', () => {
    const r = hurt(0);
    expect(r.state.vitals.hp).toBe(9);
  });

  it('🔴 `G27`：这一下足以打光剩余 → 一次掉到位，并标成致命', () => {
    const r = hurt(12);
    expect(r.state.vitals.hp).toBe(0);
    expect(r.applied[0]!.after).toBe(0);
    expect(r.lethal).toBe(true);
  });

  it('🔴 `G27`：大失败 → 即使伤害数字不大也一次掉到位', () => {
    const r = applyDeltas(
      blood(),
      [{ target: 'vitals.hp', op: 'dec', amount: 2 }] as never,
      { ruleset: coc7, harm: { checked: true, fumble: true } }
    );
    expect(r.state.vitals.hp).toBe(0);
    expect(r.lethal).toBe(true);
  });

  it('没打光就不是致命一击 —— 照常扣，玩家还有挣扎的余地', () => {
    const r = hurt(4);
    expect(r.state.vitals.hp).toBe(6);
    expect(r.lethal).toBeFalsy();
  });

  it('🔴 致命一击能跨过"濒死冻结"，挤牙膏不能', () => {
    // 濒死（还剩 3 点血）：1 点的小扣被冻结拦住（给施救窗口）
    const nearDeath = { ...blood(3), dying: true };
    const nibble = applyDeltas(
      nearDeath,
      [{ target: 'vitals.hp', op: 'dec', amount: 1 }] as never,
      { ruleset: coc7, harm: { checked: true, fumble: false } }
    );
    expect(nibble.rejected).toHaveLength(1);
    expect(nibble.lethal).toBeFalsy();
    // 而"打光剩余"的那一下越过它（死亡不该被那道闸护住）
    const finisher = applyDeltas(
      nearDeath,
      [{ target: 'vitals.hp', op: 'dec', amount: 9 }] as never,
      { ruleset: coc7, harm: { checked: true, fumble: false } }
    );
    expect(finisher.state.vitals.hp).toBe(0);
    expect(finisher.lethal).toBe(true);
  });

  it('回血不受这道闸管（往上涨不会让谁莫名送命）', () => {
    const r = applyDeltas(blood(4), [{ target: 'vitals.hp', op: 'inc', amount: 5 }] as never, {
      ruleset: coc7,
      harm: { checked: false, fumble: false },
    });
    expect(r.rejected).toHaveLength(0);
    expect(r.state.vitals.hp).toBe(9);
  });

  it('理智不吃"致命"那一档（归零走疯狂那条路，不是死）', () => {
    const r = applyDeltas(blood(), [{ target: 'vitals.san', op: 'dec', amount: 99 }] as never, {
      ruleset: coc7,
      harm: { checked: true, fumble: true },
    });
    expect(r.state.vitals.san).toBe(0);
    expect(r.lethal).toBeFalsy();
  });

  it('不传 `harm`（引擎自己的账 / 老调用方）→ 完全走现状', () => {
    const r = applyDeltas(blood(), [
      { target: 'vitals.hp', op: 'dec', amount: 3 },
    ] as never);
    expect(r.rejected).toHaveLength(0);
    expect(r.state.vitals.hp).toBe(7);
  });

  it('还有别的敌人活着 → 倒下一个也不收场（别提前结束）', () => {
    let s = base();
    ({ state: s } = applyDeltas(s, [
      { target: 'combat.active', op: 'set', value: true },
      { target: 'combat.foes', op: 'add', value: { name: '甲', hp: 3, max: 3 } },
      { target: 'combat.foes', op: 'add', value: { name: '乙', hp: 3, max: 3 } },
    ]));
    ({ state: s } = applyDeltas(s, [
      { target: 'combat.foes', op: 'dec', value: '甲', amount: 5 },
    ]));
    expect(s.combat.foes.map((f) => f.name)).toEqual(['乙']);
    expect(s.combat.active).toBe(true);
    // 第二个也倒下 → 这时才收场
    ({ state: s } = applyDeltas(s, [
      { target: 'combat.foes', op: 'dec', value: '乙', amount: 5 },
    ]));
    expect(s.combat.foes).toHaveLength(0);
    expect(s.combat.active).toBe(false);
  });

  /*
   * 用户 2026-09-16 实测：「敌对者没有命名」。
   *
   * 模型的固定行为是：正文里把那只东西描述得清清楚楚，
   * `combat.foes add` 的 `name` 却空着 —— 因为它把这条 delta
   * 当成"记一笔血量"。原来引擎直接 reject，于是玩家**对着空气打**。
   *
   * 判据：**模型漏一个字段，代价不该由玩家承担**。
   * 缺名字也要让它进列表，能被打、有血条。
   */
  it('模型忘了写 name —— 照样进列表，不许拒绝（退到占位名）', () => {
    const r = applyDeltas(base(), [
      { target: 'combat.foes', op: 'add', value: { hp: 12, max: 12 } as never },
    ]);
    expect(r.rejected).toHaveLength(0);
    expect(r.state.combat.foes).toHaveLength(1);
    expect(r.state.combat.foes[0]!.name).toBe(UNNAMED_FOE);
    expect(r.state.combat.foes[0]!.hp).toBe(12);
    // 图鉴台账也要照记 —— 玩家确实见到了它
    expect(r.state.encountered).toContain(UNNAMED_FOE);
  });

  it('name 是空白串也按缺名字处理', () => {
    const r = applyDeltas(base(), [
      { target: 'combat.foes', op: 'add', value: { name: '   ', hp: 5, max: 5 } as never },
    ]);
    expect(r.rejected).toHaveLength(0);
    expect(r.state.combat.foes[0]!.name).toBe(UNNAMED_FOE);
  });

  it('value 整个不是对象时也不崩，照样兜住', () => {
    const r = applyDeltas(base(), [
      { target: 'combat.foes', op: 'add', value: undefined as never },
    ]);
    expect(r.rejected).toHaveLength(0);
    expect(r.state.combat.foes[0]!.name).toBe(UNNAMED_FOE);
    // 没给血量 → 缺省 10
    expect(r.state.combat.foes[0]!.hp).toBe(10);
  });

  it('占位名接得住后续的扣血与移除（能开打，不是死路）', () => {
    let s = base();
    ({ state: s } = applyDeltas(s, [
      { target: 'combat.foes', op: 'add', value: { hp: 8, max: 8 } as never },
    ]));
    ({ state: s } = applyDeltas(s, [
      { target: 'combat.foes', op: 'dec', value: UNNAMED_FOE, amount: 3 },
    ]));
    expect(s.combat.foes[0]!.hp).toBe(5);
    // 扣血 = 交手过，弱点该解锁了
    expect(s.fought).toContain(UNNAMED_FOE);

    ({ state: s } = applyDeltas(s, [
      { target: 'combat.foes', op: 'remove', value: UNNAMED_FOE },
    ]));
    expect(s.combat.foes).toHaveLength(0);
  });

  it('模型写了 name 的一律尊重，不会被占位名覆盖', () => {
    const r = applyDeltas(base(), [
      { target: 'combat.foes', op: 'add', value: { name: '井底的东西', hp: 20, max: 20 } },
    ]);
    expect(r.state.combat.foes[0]!.name).toBe('井底的东西');
  });

  it('同一轮里两次无名的 add 会合并成同一只（都叫占位名）', () => {
    let s = base();
    ({ state: s } = applyDeltas(s, [
      { target: 'combat.foes', op: 'add', value: { hp: 10, max: 10 } as never },
    ]));
    ({ state: s } = applyDeltas(s, [
      { target: 'combat.foes', op: 'add', value: { hp: 6, max: 6 } as never },
    ]));
    // 同名走"已存在"分支，只更新数值，不会堆出两只无名的东西
    expect(s.combat.foes).toHaveLength(1);
    expect(s.combat.foes[0]!.hp).toBe(6);
  });

  /*
   * 用户拍板 · 协作方第 21 版 P2-7：敌人静默回满血。
   *
   * 模型最常见的写法是**每轮都把场上的敌人再 add 一遍**（它只是想确认"它还在"）。
   * 以前这条直接覆盖 hp/max，叠加 `fillFoeNumbers` 按模组表补数值，
   * 结果就是玩家打掉的伤害被悄悄还回去（状态变化卡一个字不提）＋ 战斗永远打不完。
   *
   * 判据：**同名 add 只收窄，绝不覆盖** —— hp 取小、max 取大、没申报的不动。
   */
  it('同名重复 add 绝不回血（打掉的伤害不会被还回来）', () => {
    let s = base();
    ({ state: s } = applyDeltas(s, [
      { target: 'combat.foes', op: 'add', value: { name: '货舱里的东西', hp: 14, max: 14 } },
    ]));
    ({ state: s } = applyDeltas(s, [
      { target: 'combat.foes', op: 'dec', value: '货舱里的东西', amount: 11 },
    ]));
    expect(s.combat.foes[0]!.hp).toBe(3);
    // 下一轮模型又 add 了同一只，还照模组表写了满值
    ({ state: s } = applyDeltas(s, [
      { target: 'combat.foes', op: 'add', value: { name: '货舱里的东西', hp: 14, max: 14 } },
    ]));
    expect(s.combat.foes).toHaveLength(1);
    expect(s.combat.foes[0]!.hp).toBe(3);
  });

  it('同名 add 不会把 max 往小改（上限只许放宽，不许缩）', () => {
    let s = base();
    ({ state: s } = applyDeltas(s, [
      { target: 'combat.foes', op: 'add', value: { name: '巨影', hp: 20, max: 20 } },
    ]));
    ({ state: s } = applyDeltas(s, [
      { target: 'combat.foes', op: 'add', value: { name: '巨影', hp: 2, max: 2 } },
    ]));
    expect(s.combat.foes[0]!.max).toBe(20);
    // hp 取小，所以这条确实生效了
    expect(s.combat.foes[0]!.hp).toBe(2);
  });

  it('第一次 add 才是新建（满血进场）', () => {
    const r = applyDeltas(base(), [
      { target: 'combat.foes', op: 'add', value: { name: '井底的东西', hp: 14, max: 14 } },
    ]);
    expect(r.state.combat.foes[0]).toMatchObject({ name: '井底的东西', hp: 14, max: 14 });
  });

  it('remove 之后重新 add 是新建，此时才是满血', () => {
    let s = base();
    ({ state: s } = applyDeltas(s, [
      { target: 'combat.foes', op: 'add', value: { name: '巨影', hp: 20, max: 20 } },
    ]));
    ({ state: s } = applyDeltas(s, [
      { target: 'combat.foes', op: 'dec', value: '巨影', amount: 18 },
    ]));
    ({ state: s } = applyDeltas(s, [{ target: 'combat.foes', op: 'remove', value: '巨影' }]));
    ({ state: s } = applyDeltas(s, [
      { target: 'combat.foes', op: 'add', value: { name: '巨影', hp: 20, max: 20 } },
    ]));
    expect(s.combat.foes).toHaveLength(1);
    expect(s.combat.foes[0]!.hp).toBe(20);
  });

  it('没申报的字段一个字都不动', () => {
    let s = base();
    ({ state: s } = applyDeltas(s, [
      { target: 'combat.foes', op: 'add', value: { name: '巨影', hp: 20, max: 20 } },
    ]));
    ({ state: s } = applyDeltas(s, [
      { target: 'combat.foes', op: 'dec', value: '巨影', amount: 7 },
    ]));
    // 只给了 name，没给 hp / max
    ({ state: s } = applyDeltas(s, [
      { target: 'combat.foes', op: 'add', value: { name: '巨影' } as never },
    ]));
    expect(s.combat.foes[0]!.hp).toBe(13);
    expect(s.combat.foes[0]!.max).toBe(20);
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

describe('武器不会被"用掉"', () => {
  /*
   * 用户 2026-09-16 实测："开一枪把我手枪消耗掉了。"
   * 模型天然会写"我开了一枪"然后按消耗品的写法扣数量，扣的却是那把枪；
   * 枪没了之后系统还在给他触发手枪检定，整局都崩了。
   */
  const withGun = (): GameState => ({
    ...base(),
    inventory: [
      { id: 'gun', name: '柯尔特左轮', qty: 1, kind: 'weapon', damage: '1d10', skill: '射击（手枪）' },
      { id: 'ammo', name: '子弹', qty: 6 },
    ],
  });

  it('dec 命中武器一律拒绝，武器数量不变', () => {
    const { state, rejected } = applyDeltas(withGun(), [
      { target: 'inventory', op: 'dec', value: '柯尔特左轮', amount: 1 },
    ]);
    expect(rejected).toHaveLength(1);
    expect(rejected[0]!.reason).toContain('武器');
    expect(state.inventory.find((i) => i.name === '柯尔特左轮')?.qty).toBe(1);
  });

  it('remove 写着"使用/射击"这类理由时也拒绝（那是 dec 被拒后的绕法）', () => {
    const { state, rejected } = applyDeltas(withGun(), [
      { target: 'inventory', op: 'remove', value: '柯尔特左轮', reason: '开枪使用后消耗' },
    ]);
    expect(rejected).toHaveLength(1);
    expect(state.inventory.some((i) => i.name === '柯尔特左轮')).toBe(true);
  });

  it('【回归】remove 不带 reason 也拒绝 —— 模型常常干脆不写理由', () => {
    const { state, rejected } = applyDeltas(withGun(), [
      { target: 'inventory', op: 'remove', value: '柯尔特左轮' },
    ]);
    expect(rejected).toHaveLength(1);
    expect(state.inventory.some((i) => i.name === '柯尔特左轮')).toBe(true);
  });

  it('【回归】"开火时炸膛"这种合理损坏要放行（旧黑名单会误伤）', () => {
    const { state } = applyDeltas(withGun(), [
      { target: 'inventory', op: 'remove', value: '柯尔特左轮', reason: '开火时炸膛，枪管报废' },
    ]);
    expect(state.inventory.some((i) => i.name === '柯尔特左轮')).toBe(false);
  });

  it('真正的丢枪（缴械 / 送人 / 丢失 / 扔进水里）照常放行', () => {
    for (const reason of ['被押运员夺走', '送给老霍华德防身', '掉进水里了', '扔进海里']) {
      const { state } = applyDeltas(withGun(), [
        { target: 'inventory', op: 'remove', value: '柯尔特左轮', reason },
      ]);
      expect(state.inventory.some((i) => i.name === '柯尔特左轮')).toBe(false);
    }
  });

  it('【回归 · 协作方 §2.2】裸字"送"不再误放行：护送/传送/运送 都不算失去武器', () => {
    /*
     * 上一版为了兜住 `送给老霍华德防身` 写了**单字** `送`，
     * 于是"护送""传送""运送""呈送"全被误判成"失去武器"——
     * 尤其是"护送"，玩家明明是在**做一件事**，引擎却把枪删了。
     * 现在改成有目标的 `送给|送人` + `赠予|赠与`。
     */
    for (const reason of ['护送老霍华德回家', '传送到船上', '运送货物过去', '呈送文件给船长']) {
      const { state, rejected } = applyDeltas(withGun(), [
        { target: 'inventory', op: 'remove', value: '柯尔特左轮', reason },
      ]);
      expect(rejected).toHaveLength(1);
      expect(state.inventory.some((i) => i.name === '柯尔特左轮')).toBe(true);
    }
    // 而"真的送出去"仍然放行
    for (const reason of ['送给老霍华德防身', '送人了', '赠予同伴', '赠与同伴']) {
      const { state } = applyDeltas(withGun(), [
        { target: 'inventory', op: 'remove', value: '柯尔特左轮', reason },
      ]);
      expect(state.inventory.some((i) => i.name === '柯尔特左轮')).toBe(false);
    }
  });

  it('【补充】"丢进/丢掉"这类也在失去清单里（穷举正反例时发现漏了）', () => {
    for (const reason of ['丢进海里', '丢掉了']) {
      const { state } = applyDeltas(withGun(), [
        { target: 'inventory', op: 'remove', value: '柯尔特左轮', reason },
      ]);
      expect(state.inventory.some((i) => i.name === '柯尔特左轮')).toBe(false);
    }
  });

  it('弹药仍然可以正常消耗（别把消耗品一起管死）', () => {
    const { state } = applyDeltas(withGun(), [
      { target: 'inventory', op: 'dec', value: '子弹', amount: 1 },
    ]);
    expect(state.inventory.find((i) => i.name === '子弹')!.qty).toBe(5);
  });
});

describe('NPC 档案（旁挂映射，不动 npcsAlive 结构）', () => {
  /*
   * 用户要"点击在地人物弹卡片"，但 npcsAlive 只有名字。
   * 用旁挂的 npcNotes 记额外档案：npcsAlive 仍是"谁在场"的唯一真源，
   * 地图/检定/提示词一行都不用改，且是可选字段 → 不升 SAVE_VERSION。
   */
  const withNpc = (): GameState => ({
    ...base(),
    npcsAlive: ['老霍华德', '米拉'],
  });

  it('可以为在场 NPC 补档案（前缀写法天然支持）', () => {
    const { state, rejected } = applyDeltas(withNpc(), [
      { target: 'npcNotes.老霍华德.role', op: 'set', value: '码头工头' },
      { target: 'npcNotes.老霍华德.note', op: 'set', value: '右手指节有老茧，说话时不敢看人' },
    ]);
    expect(rejected).toHaveLength(0);
    expect(state.npcNotes?.['老霍华德']?.role).toBe('码头工头');
    expect(state.npcNotes?.['老霍华德']?.note).toContain('老茧');
  });

  it('临时登场的 NPC 也能补（不在 npcsAlive 里照样能记）', () => {
    const { state } = applyDeltas(withNpc(), [
      { target: 'npcNotes.路人甲.role', op: 'set', value: '醉汉' },
    ]);
    expect(state.npcNotes?.['路人甲']?.role).toBe('醉汉');
    // 在场名单不受影响 —— 这是"旁挂"的意义
    expect(state.npcsAlive).toEqual(['老霍华德', '米拉']);
  });

  it('没档案的 NPC 不受影响（稀疏映射，旧档读到 undefined 也不坏）', () => {
    const { state } = applyDeltas(withNpc(), []);
    expect(state.npcNotes).toBeUndefined();
    expect(state.npcsAlive).toEqual(['老霍华德', '米拉']);
  });

  it('首次照面的回合数可以记下来', () => {
    const { state } = applyDeltas(withNpc(), [
      { target: 'npcNotes.米拉.met', op: 'set', value: 3 },
    ]);
    expect(state.npcNotes?.['米拉']?.met).toBe(3);
  });
});

describe('濒死当轮冻结扣血', () => {
  /*
   * 用户要的是"濒死那一轮还有一口气"：血见底之后，这一轮**不允许再掉**。
   * 数值本来就被 clamp 在 0，真正的价值在两处——
   *   ① 拒绝掉这条 delta，玩家界面上就不会再冒出一次莫名其妙的"生命值变化"；
   *   ② rejected 里带上固定理由，store 才能翻成人话并触发一次性施救引导。
   */
  const opt = { ruleset: coc7 };

  it('血扣到 0 之后，同一轮里再来一下也不掉（见底即冻结）', () => {
    const { state, rejected, applied } = applyDeltas(
      base(),
      [
        { target: 'vitals.hp', op: 'dec', amount: 20 },
        { target: 'vitals.hp', op: 'dec', amount: 3 },
      ],
      opt
    );
    expect(state.vitals.hp).toBe(0);
    expect(applied).toHaveLength(1);
    expect(rejected).toHaveLength(1);
    expect(rejected[0]!.reason).toBe(DYING_FREEZE_REASON);
  });

  it('进入本轮时已经是濒死 → 一切下降都冻结', () => {
    const dying: GameState = { ...base(), vitals: { hp: 0, san: 65, mp: 13 }, dying: true };
    const { state, rejected } = applyDeltas(
      dying,
      [{ target: 'vitals.hp', op: 'dec', amount: 1 }],
      opt
    );
    expect(state.vitals.hp).toBe(0);
    expect(rejected).toHaveLength(1);
  });

  it('回升一律放行 —— 施救/自救要能把它拉回来', () => {
    const dying: GameState = { ...base(), vitals: { hp: 0, san: 65, mp: 13 }, dying: true };
    const { state, rejected } = applyDeltas(
      dying,
      [{ target: 'vitals.hp', op: 'inc', amount: 4 }],
      opt
    );
    expect(rejected).toHaveLength(0);
    expect(state.vitals.hp).toBe(4);
  });

  it('只有主生命条冻结，理智/魔法照常结算', () => {
    const dying: GameState = { ...base(), vitals: { hp: 0, san: 40, mp: 10 }, dying: true };
    const { state, rejected } = applyDeltas(
      dying,
      [
        { target: 'vitals.san', op: 'dec', amount: 5 },
        { target: 'vitals.mp', op: 'dec', amount: 2 },
      ],
      opt
    );
    expect(rejected).toHaveLength(0);
    expect(state.vitals.san).toBe(35);
    expect(state.vitals.mp).toBe(8);
  });

  it('没标濒死、血也没见底时，正常扣血不受影响', () => {
    const { state, rejected } = applyDeltas(
      base(),
      [{ target: 'vitals.hp', op: 'dec', amount: 5 }],
      opt
    );
    expect(rejected).toHaveLength(0);
    expect(state.vitals.hp).toBe(7);
  });

  it('没给规则包时按 key=hp 兜底，同样冻结', () => {
    const dying: GameState = { ...base(), vitals: { hp: 0, san: 65, mp: 13 }, dying: true };
    const { rejected } = applyDeltas(dying, [
      { target: 'vitals.hp', op: 'dec', amount: 2 },
    ]);
    expect(rejected).toHaveLength(1);
    expect(rejected[0]!.reason).toBe(DYING_FREEZE_REASON);
  });
});
