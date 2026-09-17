/**
 * 怪物图鉴 / 战斗投放（R38）与统一剧透约定 G5 的断言。
 *
 * 这一组测试守的是**两件容易飘的事**：
 *   ① `castFromBestiary` 必须真能把表落成 `combat.foes` 的 delta
 *      （清单里写了这个函数名，但它曾经**根本不存在**，敌人全靠模型即兴写）；
 *   ② **G5 的可见度判据**：没见过就不给弱点。这条一旦松了，
 *      图鉴就变成了"开局送答案"。
 */

import { describe, expect, it } from 'vitest';
import {
  allNamedEntries,
  bestiaryCard,
  bestiaryUnlocked,
  buildBestiary,
  castFromBestiary,
  findEntry,
  sightOf,
  type BestiaryEntry,
} from '../src/core/bestiary.js';

const TABLE: BestiaryEntry[] = [
  {
    id: 'm1',
    name: '雾中的巨影',
    look: '湿漉漉的一团，比门框还高',
    hp: 20,
    attack: '爪击 1d8',
    behavior: '先逼近，受伤后退到雾里',
    weakness: '怕火',
  },
  {
    id: 'm2',
    name: '舱里的东西',
    look: '看不出形状',
    hp: 12,
    attack: '撞击 1d6',
    behavior: '只在暗处动',
    weakness: '强光',
  },
];

describe('findEntry 按名字找回表里的条目', () => {
  it('精确匹配优先', () => {
    expect(findEntry(TABLE, '雾中的巨影')?.id).toBe('m1');
  });

  it('宽松匹配：模型写的名字带修饰也能认出来', () => {
    // 模型常写"巨影"，严格相等会漏
    expect(findEntry(TABLE, '巨影')?.id).toBe('m1');
    expect(findEntry(TABLE, '雾中的巨影（那东西）')?.id).toBe('m1');
  });

  it('先精确再宽松，不会让"小蜘蛛"错认成"蜘蛛女王"', () => {
    const t: BestiaryEntry[] = [
      { id: 'a', name: '蜘蛛女王', hp: 30 },
      { id: 'b', name: '小蜘蛛', hp: 2 },
    ];
    expect(findEntry(t, '小蜘蛛')?.id).toBe('b');
  });

  it('空名字/找不到返回 undefined', () => {
    expect(findEntry(TABLE, '')).toBeUndefined();
    expect(findEntry(TABLE, '不存在的东西')).toBeUndefined();
  });
});

describe('castFromBestiary：把敌对者表的数值落成战斗敌人', () => {
  it('表里有就照表的血量来，max 与 hp 一起给', () => {
    const deltas = castFromBestiary(TABLE, ['雾中的巨影']);
    expect(deltas).toHaveLength(1);
    const d = deltas[0]!;
    expect(d.target).toBe('combat.foes');
    expect(d.op).toBe('add');
    expect(d.value.name).toBe('雾中的巨影');
    expect(d.value.hp).toBe(20);
    // max 必须一起给，否则血条上限被推成当前值，之后回不满
    expect(d.value.max).toBe(20);
  });

  it('表里没有的也给一个 delta（按默认生命），不能让它消失在战斗里', () => {
    const deltas = castFromBestiary(TABLE, ['临时加进来的东西']);
    expect(deltas).toHaveLength(1);
    expect(deltas[0]!.value.name).toBe('临时加进来的东西');
    expect(deltas[0]!.value.hp).toBeGreaterThan(0);
    // 理由要说清是兜底，方便排查"这只怎么血这么少"
    expect(deltas[0]!.reason).toContain('默认');
  });

  it('同一轮重复点名同一只只投一次', () => {
    const deltas = castFromBestiary(TABLE, ['雾中的巨影', '雾中的巨影', '巨影']);
    // "巨影"宽松匹配到同一条，但名字不同 —— 只按**点名**去重
    expect(deltas.filter((d) => d.value.name === '雾中的巨影')).toHaveLength(1);
  });

  it('空名字一律丢掉（applyDeltas 会拒，先滤掉省得刷一堆 rejected）', () => {
    expect(castFromBestiary(TABLE, ['', '  ', '雾中的巨影'])).toHaveLength(1);
  });

  it('表里写了负数/0 的血量，clamp 到至少 1', () => {
    const bad: BestiaryEntry[] = [{ id: 'x', name: '不该这么脆', hp: 0 }];
    expect(castFromBestiary(bad, ['不该这么脆'])[0]!.value.hp).toBe(1);
  });

  it('不给名字列表时，用 allNamedEntries 取表里全部', () => {
    expect(allNamedEntries(TABLE)).toEqual(['雾中的巨影', '舱里的东西']);
    expect(castFromBestiary(TABLE, allNamedEntries(TABLE))).toHaveLength(2);
  });
});

describe('sightOf：见过 / 交过手 / 没见过', () => {
  it('两本台账都没有 → none', () => {
    expect(sightOf('雾中的巨影', [], [])).toBe('none');
  });

  it('在 encountered 里 → seen', () => {
    expect(sightOf('雾中的巨影', ['雾中的巨影'], [])).toBe('seen');
  });

  it('在 fought 里 → fought（优先级高于 seen）', () => {
    expect(sightOf('雾中的巨影', ['雾中的巨影'], ['雾中的巨影'])).toBe('fought');
  });

  it('名字宽松匹配：台账里写的是带修饰的叫法也算', () => {
    expect(sightOf('雾中的巨影', ['巨影'], [])).toBe('seen');
  });

  it('空名字 → none（不许拿空串蒙过去）', () => {
    expect(sightOf('', ['雾中的巨影'], [])).toBe('none');
  });
});

describe('G5：没见过就不给弱点（图鉴的核心约定）', () => {
  it('没见过 → 连名字都不给（返回 none，UI 画成 ？）', () => {
    const c = bestiaryCard(TABLE[0]!, [], []);
    expect(c.level).toBe('none');
    expect(c.weakness).toBeUndefined();
  });

  it('只是见过 → 外观/攻击/习性给，**弱点不给**', () => {
    const c = bestiaryCard(TABLE[0]!, ['雾中的巨影'], []);
    expect(c.level).toBe('seen');
    expect(c.look).toBeTruthy();
    expect(c.attack).toBeTruthy();
    // 弱点是活路：没交手就不该出现在卡片上
    expect(c.weakness).toBeUndefined();
  });

  it('交过手 → 弱点才给', () => {
    const c = bestiaryCard(TABLE[0]!, ['雾中的巨影'], ['雾中的巨影']);
    expect(c.level).toBe('fought');
    expect(c.weakness).toBe('怕火');
  });
});

describe('bestiaryUnlocked：图鉴的总开关是"这一局结档了"', () => {
  it('没有 ending → 锁着', () => {
    expect(bestiaryUnlocked(null)).toBe(false);
    expect(bestiaryUnlocked(undefined)).toBe(false);
  });

  it('有 ending 但正文还没写（等守密人的那一段）→ 仍然锁着', () => {
    // 引擎先写 { kind, text: '' } 当信号，这时不该解锁
    expect(bestiaryUnlocked({ text: '' })).toBe(false);
    expect(bestiaryUnlocked({ text: '   ' })).toBe(false);
  });

  it('结局正文写好了 → 解锁', () => {
    expect(bestiaryUnlocked({ text: '意识一层层退下去。' })).toBe(true);
  });
});

/*
 * ============================================================
 * buildBestiary —— 整页视图（2026-09-17 线上事故的回归测试）
 *
 * 事故：组件里写成 `useStore((s) => s.bestiary())`，
 * 选择器每次都返回**新对象** → zustand 按引用比较永远判定"变了"
 * → 无限重渲染 → React #185 → 根节点卸载 → 整页空白。
 *
 * 修法是把"算整页视图"挪进纯函数，组件改选稳定切片 + useMemo。
 * 这里钉住这个函数的**输出口径与排序稳定性**——
 * 顺序不稳会让 UI 每次都"看起来变了"，是同一类问题的温床。
 * ============================================================
 */
describe('buildBestiary：整页视图（顺序必须稳定）', () => {
  it('按 交过手 > 见过 > 没遭遇 排序，同档按名字', () => {
    const v = buildBestiary(TABLE, ['雾中的巨影'], ['雾中的巨影']);
    expect(v.total).toBe(TABLE.length);
    expect(v.cards[0]!.name).toBe('雾中的巨影');
    expect(v.cards[0]!.level).toBe('fought');
    // 其余没遭遇的沉底
    expect(v.cards.slice(1).every((c) => c.level === 'none')).toBe(true);
  });

  it('seen / fought / total 三个计数口径一致', () => {
    const v = buildBestiary(TABLE, ['雾中的巨影'], []);
    expect(v.seen).toBe(1);
    expect(v.fought).toBe(0);
    expect(v.total).toBe(TABLE.length);
    const w = buildBestiary(TABLE, ['雾中的巨影'], ['雾中的巨影']);
    expect(w.seen).toBe(1);
    expect(w.fought).toBe(1);
  });

  it('同一份输入算两次，顺序完全一样（否则 UI 会无谓重渲染）', () => {
    const a = buildBestiary(TABLE, ['雾中的巨影'], ['雾中的巨影']);
    const b = buildBestiary(TABLE, ['雾中的巨影'], ['雾中的巨影']);
    expect(a.cards.map((c) => c.name)).toEqual(b.cards.map((c) => c.name));
  });

  it('没见过的一律不给弱点（G5 走的是 bestiaryCard，别绕过）', () => {
    const v = buildBestiary(TABLE, ['雾中的巨影'], []);
    const c = v.cards.find((x) => x.name === '雾中的巨影')!;
    expect(c.weakness).toBeUndefined();
  });

  it('结档状态决定 unlocked；没结档仍然锁着', () => {
    expect(buildBestiary(TABLE, [], [], null).unlocked).toBe(false);
    expect(buildBestiary(TABLE, [], [], { text: '完了。' }).unlocked).toBe(true);
  });

  it('表为空 / 名字为空白 → 不产条目', () => {
    expect(buildBestiary([], [], []).total).toBe(0);
    const blank: BestiaryEntry[] = [{ id: 'x', name: '   ' }];
    expect(buildBestiary(blank, [], []).total).toBe(0);
  });
});
