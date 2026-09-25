import { describe, expect, it } from 'vitest';
import { parseElapsed } from '../src/core/clock.js';

describe('parseElapsed：「几」＝3（协作方第 18 版 P3-3）', () => {
  it('「几分钟」≈ 3 分钟（以前被算成 1 分钟）', () => {
    expect(parseElapsed('几分钟')).toBe(3);
    expect(parseElapsed('等了几分钟')).toBe(3);
    expect(parseElapsed('过了几分钟')).toBe(3);
  });

  it('「几个小时」≈ 3 小时', () => {
    expect(parseElapsed('几个小时')).toBe(180);
    expect(parseElapsed('过了几小时')).toBe(180);
    expect(parseElapsed('几个钟头')).toBe(180);
  });

  it('真数字仍然照数字算（「几」不许影响它们）', () => {
    expect(parseElapsed('三个小时')).toBe(180);
    expect(parseElapsed('十分钟')).toBe(10);
    expect(parseElapsed('半小时')).toBe(30);
    expect(parseElapsed('一个半钟头')).toBe(90);
  });

  it('认不出来仍退到 5 分钟（头注释与 return 5 对齐）', () => {
    expect(parseElapsed('说不清多久')).toBe(5);
    expect(parseElapsed('好久')).toBe(5);
  });

  it('没申报（空 / undefined）＝ 0 分钟，不是 5 —— 那是"没说过"，不是"说了但认不出"', () => {
    // 这条区分很重要：空串走的是开头的 `if (!raw) return 0`，
    // 与"说了句认不出的"（末尾 return 5）不是同一条路。
    expect(parseElapsed('')).toBe(0);
    expect(parseElapsed(undefined)).toBe(0);
    expect(parseElapsed(null)).toBe(0);
    expect(parseElapsed('   ')).toBe(0);
  });
});
