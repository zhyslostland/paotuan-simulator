/**
 * 回合快照裁剪的锚点豁免（G1）。
 *
 * 事故形态：长局里裁剪一律"丢最旧的"，于是**早期锚点被裁掉** ——
 * 玩家最想回去的那几个岔路口没了，回溯只对最近一截有效。
 */
import { describe, expect, it } from 'vitest';
import { isAnchor, pruneSnapshots, type PrunableSnapshot } from '../src/ui/snapshotPrune.js';

/** 造一串快照：`keys` 里的下标标成锚点 */
const make = (n: number, keys: number[] = []): [string, PrunableSnapshot][] =>
  Array.from({ length: n }, (_, i) => [`m${i}`, keys.includes(i) ? { key: true } : {}]);

const ids = (e: [string, unknown][]) => e.map(([id]) => id);

describe('pruneSnapshots：锚点豁免', () => {
  it('没超上限 → 原样返回', () => {
    const e = make(5);
    expect(pruneSnapshots(e, 60)).toBe(e);
  });

  it('isAnchor：只有 key === true 才算锚点', () => {
    expect(isAnchor({ key: true })).toBe(true);
    expect(isAnchor({})).toBe(false);
    expect(isAnchor({ key: false })).toBe(false);
    expect(isAnchor(undefined)).toBe(false);
  });

  it('超上限时**先丢最旧的普通快照**，锚点一个不动', () => {
    // 10 条，第 0/1 条是早期锚点，上限 5
    const e = make(10, [0, 1]);
    const out = pruneSnapshots(e, 5);
    expect(out).toHaveLength(5);
    // 两个早期锚点都在
    expect(ids(out)).toContain('m0');
    expect(ids(out)).toContain('m1');
    // 丢的是靠前的普通快照（m2、m3、m4），保留最近的
    expect(ids(out)).toEqual(['m0', 'm1', 'm7', 'm8', 'm9']);
  });

  it('顺序保持不变（调用方按时间序给的）', () => {
    const out = pruneSnapshots(make(10, [3]), 4);
    const seq = ids(out);
    expect([...seq].sort()).toEqual(seq); // 已按 m0..m9 的自然序排好
  });

  it('全是锚点又超上限 → 只能保留最近的 limit 条（兜底，不是常态）', () => {
    const e = make(10, [0, 1, 2, 3, 4, 5, 6, 7, 8, 9]);
    const out = pruneSnapshots(e, 4);
    expect(ids(out)).toEqual(['m6', 'm7', 'm8', 'm9']);
  });

  it('limit 为 0 / 负数 → 空（不会因为参数怪就爆）', () => {
    expect(pruneSnapshots(make(3, [0]), 0)).toEqual([]);
    expect(pruneSnapshots(make(3, [0]), -1)).toEqual([]);
  });

  it('没有锚点时，行为与原来的"丢最旧"一致（不改变既有体感）', () => {
    const out = pruneSnapshots(make(10), 3);
    expect(ids(out)).toEqual(['m7', 'm8', 'm9']);
  });
});
