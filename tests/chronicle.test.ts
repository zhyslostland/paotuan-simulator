import { describe, expect, it } from 'vitest';
import {
  FOLD_AT_CHARS,
  KEEP_CHARS,
  chronicleChars,
  chronicleKeepFrom,
  shouldFold,
} from '../src/core/chronicle.js';
import type { ChronicleEntry } from '../src/core/types.js';

/** 造一条编年史，`text` 长度＝`n`（用单个汉字凑，1 字＝1 字符） */
const e = (turn: number, n: number): ChronicleEntry => ({ turn, text: '字'.repeat(n) });

/** 造一串，让合计刚好是 `total` 字（每条最多 100 字，便于观察折点） */
const many = (total: number, per = 100): ChronicleEntry[] => {
  const out: ChronicleEntry[] = [];
  let left = total;
  let turn = 1;
  while (left > 0) {
    const n = Math.min(per, left);
    out.push(e(turn++, n));
    left -= n;
  }
  return out;
};

describe('编年史折叠判据：按字符不按条数（P2-6＝P3-5）', () => {
  it('阈值常量就是协作方定的 4000 / 2000', () => {
    expect(FOLD_AT_CHARS).toBe(4000);
    expect(KEEP_CHARS).toBe(2000);
  });

  it('合计只算 text，不算 turn / location', () => {
    const list: ChronicleEntry[] = [
      { turn: 12345, text: '一二三', location: '某个很长的地点名字' },
    ];
    expect(chronicleChars(list)).toBe(3);
  });

  it('没到 4000 字 → 不折（keepFrom = 0）', () => {
    const list = many(3999);
    expect(chronicleChars(list)).toBe(3999);
    expect(chronicleKeepFrom(list)).toBe(0);
    expect(shouldFold(list)).toBe(false);
  });

  it('刚好到 4000 字 → 该折了', () => {
    const list = many(4000);
    expect(chronicleKeepFrom(list)).toBeGreaterThan(0);
    expect(shouldFold(list)).toBe(true);
  });

  it('折完保留的是**尾部**近 2000 字，前面的从头部折走', () => {
    // 20 条 × 200 字 ＝ 4000 字
    const list: ChronicleEntry[] = [];
    for (let i = 1; i <= 20; i++) list.push(e(i, 200));
    const keepFrom = chronicleKeepFrom(list);
    // 从尾往前凑够 2000 字＝ 10 条（第 11–20 条），所以 keepFrom = 10
    expect(keepFrom).toBe(10);
    const kept = list.slice(keepFrom);
    expect(chronicleChars(kept)).toBe(2000); // 恰好 2000，不多不少
    // 保下来的是**后面**那些（turn 大）
    expect(kept[0]!.turn).toBe(11);
    expect(kept[kept.length - 1]!.turn).toBe(20);
    // 折掉的是前面那些
    expect(list.slice(0, keepFrom).map((x) => x.turn)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
  });

  it('保下来的字数**永远不少于** 2000（差一条的 bug 就在这儿）', () => {
    const list = many(10000, 300);
    const kept = list.slice(chronicleKeepFrom(list));
    expect(chronicleChars(kept)).toBeGreaterThanOrEqual(KEEP_CHARS);
    // 最多多一条：再多留一条就会超过 2000 + 单条最大长度
    expect(chronicleChars(kept)).toBeLessThan(KEEP_CHARS + 300);
  });

  it('只有一条、且它自己就超阈值 → 返回 length（一条都不折，别把眼前的事折走）', () => {
    const list: ChronicleEntry[] = [e(1, 5000)];
    // i 走到 0 就够 2000 字了 —— 此刻返回 0 会被误读成"不用折"，
    // 所以显式返回 length，语义＝"该折但一条都留不起"
    expect(chronicleKeepFrom(list)).toBe(list.length);
    expect(shouldFold(list)).toBe(false);
  });

  it('总共两条、第二条就够长 → 折掉第一条，保住第二条', () => {
    const list: ChronicleEntry[] = [e(1, 3000), e(2, 3000)];
    // 从尾：第一条（下标 1）就够 2000 → 返回 1 → 折掉第 1 条
    expect(chronicleKeepFrom(list)).toBe(1);
    expect(shouldFold(list)).toBe(true);
  });

  it('最后一条自己就超 KEEP_CHARS 时，它一人就是"近 2000 字"，前面全折掉', () => {
    const list: ChronicleEntry[] = [e(1, 100), e(2, 200), e(3, 5000)];
    // 从尾数第一条 5000 字就 ≥ 2000，停 → 保留最后一条（下标 2），前面两条折走
    expect(chronicleKeepFrom(list)).toBe(2);
    expect(chronicleChars(list.slice(2))).toBe(5000);
    expect(shouldFold(list)).toBe(true);
  });

  it('最后一条略短于 KEEP_CHARS 时，会连它前面那条一起保下来', () => {
    // 造一批足够触发折叠的：前 8 条各 600 字（合计 4800），最后一条 1500 字
    const list: ChronicleEntry[] = [];
    for (let i = 1; i <= 8; i++) list.push(e(i, 600));
    list.push(e(9, 1500)); // 合计 6300，≥ 4000 该折
    // 从尾：1500 < 2000 → 再加 600 = 2100 ≥ 2000 → 停 → 保留 2 条（第 8、9 条）→ keepFrom = 7
    expect(chronicleKeepFrom(list)).toBe(7);
    expect(chronicleChars(list.slice(7))).toBe(2100);
    expect(shouldFold(list)).toBe(true);
  });

  it('尾部凑够 2000 时，折点落在正确的那条上', () => {
    // 7 条 × 600 字 ＝ 4200，≥ 4000 该折
    const list: ChronicleEntry[] = [];
    for (let i = 1; i <= 7; i++) list.push(e(i, 600));
    // 从尾数：600×4 = 2400 ≥ 2000 → 保留 4 条（第 4–7 条）→ keepFrom = 3
    expect(chronicleKeepFrom(list)).toBe(3);
    expect(chronicleChars(list.slice(3))).toBe(2400);
    expect(shouldFold(list)).toBe(true);
  });

  it('空列表 / 一条都没有 → 不折，且不炸', () => {
    expect(chronicleChars([])).toBe(0);
    expect(chronicleKeepFrom([])).toBe(0);
    expect(shouldFold([])).toBe(false);
  });

  it('按条数的旧判据会误判的两种情形，按字符都判对了', () => {
    // ① 50 条但每条只有 10 字 ＝ 500 字：旧判据会折（白花一次模型调用），新判据不折
    const short: ChronicleEntry[] = [];
    for (let i = 1; i <= 50; i++) short.push(e(i, 10));
    expect(short.length).toBe(50);
    expect(shouldFold(short)).toBe(false); // 500 字，远没到

    // ② 只有 15 条但每条 500 字 ＝ 7500 字：旧判据（<50）不折，新判据该折
    const long: ChronicleEntry[] = [];
    for (let i = 1; i <= 15; i++) long.push(e(i, 500));
    expect(long.length).toBe(15);
    expect(shouldFold(long)).toBe(true); // 7500 字，早该折了
  });
});
