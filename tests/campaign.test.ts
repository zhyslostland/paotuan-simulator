import { describe, expect, it } from 'vitest';
import { createInitialState, type GameState, type Thread } from '../src/core/state/gameState.js';
import {
  applySnapshot,
  carriedFlags,
  carryPreview,
  CARRY_PREVIEW_LIMIT,
  defaultWorldName,
  emptyWorld,
  findWorld,
  harvest,
  listWorlds,
  openThreads,
  runLabel,
  worldKey,
  WORLD_RUN_LIMIT,
  RUN_SCOPED_FLAGS,
  WORLD_FLAG_PREFIX,
  type World,
  type WorldRun,
} from '../src/core/campaign.js';

/*
 * ============================================================
 * 世界层（Phase 2）的判据
 *
 * 这一组测试要钉住的是**三条铁律**（文件头写着）：
 *   ① 只在会话边界搬运 —— 灌进去 / 收回来用的是同一份口径；
 *   ② 跨局只带四样：地点 / 在场人物 / 未结的支线 / 标记；
 *   ③ **每局账绝不跨团**（伤口、临时疯狂带过去就是 bug）。
 * ============================================================
 */

const gs = (over: Partial<GameState> = {}): GameState =>
  createInitialState({ vitals: { hp: 10, san: 60, mp: 10 }, ...over });

const th = (name: string, status: string): Thread => ({ name, status });

const run = (over: Partial<WorldRun> = {}): WorldRun => ({
  moduleTitle: '雾港',
  characterName: '霍尔特',
  outcome: 'success',
  turns: 12,
  at: '2026-09-17T12:00:00.000Z',
  ...over,
});

describe('世界名怎么认（世界按名字当钥匙）', () => {
  it('首尾空白、连续空白、全角空格、大小写都不算区别', () => {
    expect(worldKey('  雾港  ')).toBe('雾港');
    expect(worldKey('The  雾港')).toBe(worldKey('the 雾港'));
    expect(worldKey('雾港\u3000')).toBe('雾港');
    expect(worldKey('A  B')).toBe('a b');
  });

  it('名字全空 → 认不出世界（调用方当"新世界"处理）', () => {
    expect(worldKey('   ')).toBe('');
    expect(findWorld([emptyWorld('雾港')], '   ')).toBeUndefined();
  });

  it('模组名留空时给一句人话，而不是空字符串', () => {
    expect(defaultWorldName('')).toBe('未命名的世界');
    expect(defaultWorldName('   ')).toBe('未命名的世界');
    expect(defaultWorldName('雾港')).toBe('雾港');
  });

  it('名字写得潦草也找得回来（同一个世界不会因为多打一个空格就分家）', () => {
    const w = emptyWorld('雾港');
    expect(findWorld([w], ' 雾港 ')?.id).toBe(w.id);
  });

  it('世界列表按最后收档时间倒序（最近跑过的排最前）', () => {
    const a: World = { ...emptyWorld('甲'), updatedAt: '2026-09-01T00:00:00.000Z' };
    const b: World = { ...emptyWorld('乙'), updatedAt: '2026-09-17T00:00:00.000Z' };
    expect(listWorlds({ [a.id]: a, [b.id]: b }).map((w) => w.name)).toEqual(['乙', '甲']);
  });
});

describe('哪些事还没办完（支线）', () => {
  it('写着"已了结/已完成"的不带过去', () => {
    const out = openThreads([
      th('找回妹妹', '已了结'),
      th('查清船主的账', '还在查'),
      th('旧码头那扇门', '已完成'),
    ]);
    expect(out.map((t) => t.name)).toEqual(['查清船主的账']);
  });

  it('状态**认不出来**的一律当还挂着（宽进严出：宁可多带一条）', () => {
    expect(openThreads([th('旧码头那扇门', '')]).length).toBe(1);
    expect(openThreads([th('旧码头那扇门', '悬着')]).length).toBe(1);
  });

  it('没有名字的丢掉（空行不是支线）', () => {
    expect(openThreads([th('  ', '还在查')]).length).toBe(0);
  });
});

describe('每局账不跨团（这是 bug 防线，不是洁癖）', () => {
  it('伤口 / 疯狂 / 濒死这类标记一律滤掉', () => {
    const out = carriedFlags({
      临时疯狂: '理智骤降 6 点',
      疯狂轮数: 2,
      伤口: '左臂被划开',
      受伤: '小腿',
      伤口处理: '已包扎',
      濒死: true,
      永久疯狂: '怕水',
      见过了船长: true,
    });
    expect(out).toEqual({});
  });

  it('只带 `世界.` 前缀：模型发明的新状态词也漏不过去（白名单，不是黑名单）', () => {
    const out = carriedFlags({
      '世界.门开了': true,
      '世界.欠了人情': 3,
      流血: '还在滴',
      中毒: true,
      邪祟缠身: '说不清的东西',
      昏迷: false,
    });
    expect(Object.keys(out).sort()).toEqual(['世界.欠了人情', '世界.门开了']);
  });

  it('RUN_SCOPED_FLAGS 里点名的每个键都不带过局（这份清单不许失效）', () => {
    const flags: Record<string, unknown> = {};
    for (const k of RUN_SCOPED_FLAGS) flags[k] = 'x';
    expect(carriedFlags(flags)).toEqual({});
  });

  it('标记为 undefined 时给空对象，不炸', () => {
    expect(carriedFlags(undefined)).toEqual({});
  });
});

describe('把世界灌进新开的一局（applySnapshot）', () => {
  const snap = {
    location: '旧码头',
    npcsAlive: ['老杰克', '船长的女儿'],
    threads: [th('查清船主的账', '还在查'), th('找回妹妹', '已了结')],
    // 一个**带** `世界.` 前缀（带得过来）、一个**不带**（每局账，留在上一局）。
    // ⚠️ 协作方第 12 版指出：原先两个都不带前缀，`carriedFlags` 滤完是空对象，
    //    下面那条「撞键」断言就退化成"空盖本局"，根本没测到键碰撞。
    flags: { '世界.门开了': true, 伤口: '上一局的伤' },
  };

  it('没有留档就原样返回（第一次跑这个世界，什么都不改）', () => {
    const base = gs({ location: '自家公寓' });
    expect(applySnapshot(base, undefined)).toBe(base);
  });

  it('地点用上次的落脚点，并且它还留在"去过的地方"里（地图不会因此丢东西）', () => {
    const out = applySnapshot(gs({ location: '自家公寓', visited: ['自家公寓'] }), snap);
    expect(out.location).toBe('旧码头');
    expect(out.visited).toEqual(['自家公寓', '旧码头']);
  });

  it('在场人物取并集、本局开场的在前、不重复', () => {
    const out = applySnapshot(gs({ npcsAlive: ['老杰克', '新来的巡警'] }), snap);
    expect(out.npcsAlive).toEqual(['老杰克', '新来的巡警', '船长的女儿']);
  });

  it('只带没结清的支线', () => {
    expect(applySnapshot(gs(), snap).threads.map((t) => t.name)).toEqual(['查清船主的账']);
  });

  it('标记合并：撞键以**本局开局**的为准（留档盖不过本局）', () => {
    const out = applySnapshot(gs({ flags: { '世界.门开了': false, 本局的: 1 } }), snap);
    expect(out.flags).toEqual({ '世界.门开了': false, 本局的: 1 });
  });

  it('只有 `世界.` 前缀的标记带得过来，没前缀的（每局账）进不来', () => {
    const out = applySnapshot(gs({ flags: {} }), snap);
    expect(out.flags).toEqual({ '世界.门开了': true });
    expect(out.flags['伤口']).toBeUndefined();
  });

  it('留档里没有地点就继续用模组给的开场地点（不写成空）', () => {
    const out = applySnapshot(gs({ location: '自家公寓', visited: ['自家公寓'] }), {
      ...snap,
      location: '   ',
    });
    expect(out.location).toBe('自家公寓');
    expect(out.visited).toEqual(['自家公寓']);
  });
});

describe('结档时把这一局收回去（harvest）', () => {
  const state = gs({
    location: '货船甲板',
    npcsAlive: ['老杰克', '老杰克'],
    threads: [th('查清船主的账', '还在查'), th('找回妹妹', '已了结')],
    flags: { '世界.门开了': true, 伤口: '左臂被划开' },
  });

  it('第一次收：世界从零建起来，名字取自本次', () => {
    const w = harvest(undefined, '雾港', state, run({ at: '2026-09-17T12:00:00.000Z' }));
    expect(w.name).toBe('雾港');
    expect(w.updatedAt).toBe('2026-09-17T12:00:00.000Z');
    expect(w.snapshot).toEqual({
      location: '货船甲板',
      npcsAlive: ['老杰克'],
      threads: [{ name: '查清船主的账', status: '还在查' }],
      flags: { '世界.门开了': true },
    });
  });

  it('第二次收：履历最近的在最前，模组名去重，留档被覆盖成最新的', () => {
    const first = harvest(undefined, '雾港', state, run({ at: '2026-09-01T00:00:00.000Z' }));
    const second = harvest(first, '雾港', gs({ location: '灯塔' }), run({ at: '2026-09-17T00:00:00.000Z' }));
    expect(second.runs.map((r) => r.at)).toEqual([
      '2026-09-17T00:00:00.000Z',
      '2026-09-01T00:00:00.000Z',
    ]);
    expect(second.modules).toEqual(['雾港']);
    expect(second.snapshot?.location).toBe('灯塔');
  });

  it('履历有上限（回忆不是账本，不无限长）', () => {
    let w: World = emptyWorld('雾港');
    for (let i = 0; i < WORLD_RUN_LIMIT + 5; i++) {
      w = harvest(w, '雾港', gs(), run({ at: `2026-09-${(i % 28 + 1).toString().padStart(2, '0')}` }));
    }
    expect(w.runs.length).toBe(WORLD_RUN_LIMIT);
  });

  it('换个模组跑：模组名并进列表，留档照旧是四样', () => {
    const first = harvest(undefined, '雾港', state, run());
    const second = harvest(first, '雾港', state, run({ moduleTitle: '孤岛上的灯' }));
    expect(second.modules).toEqual(['雾港', '孤岛上的灯']);
  });
});

describe('给界面看的"会带什么过去"', () => {
  it('没有留档 → null（界面据此显示"还没有留档"，而不是一堆空行）', () => {
    expect(carryPreview(emptyWorld('雾港'))).toBeNull();
    expect(carryPreview(undefined)).toBeNull();
  });

  it('人太多时截断，并把总数告诉界面', () => {
    const many = Array.from({ length: CARRY_PREVIEW_LIMIT + 4 }, (_, i) => `路人${i}`);
    const w = harvest(undefined, '雾港', gs({ npcsAlive: many }), run());
    const preview = carryPreview(w)!;
    expect(preview.npcs.length).toBe(CARRY_PREVIEW_LIMIT);
    expect(preview.npcsMore).toBe(4);
  });

  it('上次没记地点时给一句解释（界面不用自己编话）', () => {
    const w = harvest(undefined, '雾港', gs({ location: '' }), run());
    const preview = carryPreview(w)!;
    expect(preview.location).toBe('');
    expect(preview.fallbackLocation).toContain('没记下地点');
  });
});

describe('履历一行的人话', () => {
  it('模组名 + 结局', () => {
    expect(runLabel(run({ moduleTitle: '雾港', outcome: 'death' }))).toContain('雾港');
    expect(runLabel(run({ outcome: 'death' }))).toContain('死');
  });

  it('模组名空着也不显示成空白', () => {
    expect(runLabel(run({ moduleTitle: '  ' }))).toContain('未命名模组');
  });
});
