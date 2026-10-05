/**
 * 1-E 地图合并 · 「谁在哪」的**建键口径**断言。
 *
 * 守的是一条**真事故**（2026-10-02 主人报「地图看不见人名」）：
 * 地图按**节点名**取值（`MapGraph` 里 `occupants.get(nd.name)`，如「事务所」），
 * 而建键曾经用 `location` 原文（如「霍尔特的侦探事务所」，模组 `start_location` 原样）。
 * 两者**不同源、几乎不相等** —— 于是玩家自己和同行者的名字
 * **一次都没有画到过地图上**（只有走过归并的关键人物画得出）。
 *
 * 全是纯函数，import 即可测（不碰 store、不碰 DOM）。
 */

import { describe, expect, it } from 'vitest';
import {
  createInitialState,
  occupantsOf,
  snapPlaceToNode,
  type Companion,
} from '../src/core/state/gameState.js';

function mate(over: Partial<Companion> = {}): Companion {
  return {
    id: 'c1',
    name: '老陈',
    role: '码头工人',
    personality: '话少',
    skills: {},
    vitals: { hp: 10 },
    initiative: 'balanced',
    alive: true,
    present: true,
    ...over,
  };
}

/** 与内置模组《枯井之约》同款：节点是简称，`start_location` 是全名 */
const NODES = [{ name: '事务所' }, { name: '旧城区' }, { name: '码头区' }];

describe('1-E · snapPlaceToNode：叙事地名 → 地图节点名', () => {
  it('全名含节点简称 → 归并到节点名（内置模组就是这种）', () => {
    expect(snapPlaceToNode('霍尔特的侦探事务所', NODES)).toBe('事务所');
  });

  it('全等优先，别名不会被更宽的节点抢走', () => {
    expect(snapPlaceToNode('旧城区', NODES)).toBe('旧城区');
  });

  it('节点名含它也算（"旧城" → "旧城区"）', () => {
    expect(snapPlaceToNode('旧城', NODES)).toBe('旧城区');
  });

  it('归并不上就**原样返回** —— 不硬塞到某个节点上指错地方', () => {
    expect(snapPlaceToNode('河边的废弃澡堂', NODES)).toBe('河边的废弃澡堂');
  });

  it('空白返回空串（调用方据此不建键，而不是建一个 "" 键）', () => {
    expect(snapPlaceToNode('   ', NODES)).toBe('');
    expect(snapPlaceToNode('', NODES)).toBe('');
  });

  it('不会被"空名节点"吸走（`t.includes("")` 恒真，必须先挡掉）', () => {
    expect(snapPlaceToNode('事务所', [{ name: '' }])).toBe('事务所');
    expect(snapPlaceToNode('事务所', [{ name: '   ' }])).toBe('事务所');
  });
});

describe('1-E · occupantsOf：谁在哪', () => {
  it('🔴 回归：location 是全名、节点是简称时，玩家与同行者仍落在地图节点上', () => {
    const st = createInitialState({
      location: '霍尔特的侦探事务所',
      companions: [mate({ name: '老陈' })],
    });
    const out = occupantsOf(st, '林墨', NODES);

    // 能不能在地图上取到 —— 取值口径与建键口径必须一致，这正是旧实现的错处
    expect(out.get('事务所')).toEqual(['林墨', '老陈']);
    // 旧实现建的是这个键，地图永远取不到它
    expect(out.has('霍尔特的侦探事务所')).toBe(false);
  });

  it('同行者：暂时离队 / 已死的不入表', () => {
    const st = createInitialState({
      location: '事务所',
      companions: [
        mate({ id: 'a', name: '跟班的' }),
        mate({ id: 'b', name: '留守的', present: false }),
        mate({ id: 'c', name: '死了的', alive: false }),
      ],
    });
    expect(occupantsOf(st, '林墨', NODES).get('事务所')).toEqual(['林墨', '跟班的']);
  });

  it('关键人物：写过去处就落到那处（含归并），没写就跟着玩家', () => {
    const st = createInitialState({
      location: '霍尔特的侦探事务所',
      npcsAlive: ['玛丽', '老霍华德'],
      npcWhere: { 玛丽: '旧城区' },
    });
    const out = occupantsOf(st, '林墨', NODES);

    expect(out.get('旧城区')).toEqual(['玛丽']);
    expect(out.get('事务所')).toEqual(['林墨', '老霍华德']);
  });

  it('关键人物的去处是全名/别名时，同样归并到节点名', () => {
    const st = createInitialState({
      location: '事务所',
      npcsAlive: ['玛丽'],
      npcWhere: { 玛丽: '旧城区的照相馆' },
    });
    expect(occupantsOf(st, '林墨', NODES).get('旧城区')).toEqual(['玛丽']);
  });

  it('当前地点为空 → 空表（不产生空键，也不凭空生成玩家）', () => {
    const st = createInitialState({ location: '', companions: [mate()] });
    expect(occupantsOf(st, '林墨', NODES).size).toBe(0);
  });

  it('空名字不入表（模型可能给出空串）', () => {
    const st = createInitialState({ location: '事务所', npcsAlive: ['', '   ', '玛丽'] });
    const out = occupantsOf(st, '', NODES);
    expect(out.get('事务所')).toEqual(['玛丽']);
  });

  it('建出来的键只可能是"地图节点名"或"归并不上的原样地名"', () => {
    const st = createInitialState({
      location: '霍尔特的侦探事务所',
      companions: [mate()],
      npcsAlive: ['玛丽'],
      npcWhere: { 玛丽: '河边的废弃澡堂' },
    });
    const nodeNames = new Set(NODES.map((n) => n.name));
    for (const key of occupantsOf(st, '林墨', NODES).keys()) {
      expect(nodeNames.has(key) || key === '河边的废弃澡堂').toBe(true);
    }
  });
});
