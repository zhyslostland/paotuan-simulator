import { describe, expect, it } from 'vitest';
import {
  insanityNote,
  insanityOf,
  INSANITY_TURNS,
  tickInsanity,
} from '../src/core/insanity.js';

/*
 * ============================================================
 * 协作方第 7 版 §2.1：轮数要认引擎记的那份，不能认守密人的描述句
 *
 * 引擎写的是：`flags.临时疯狂` = 一句描述（"理智骤降 6 点，陷入临时疯狂"），
 * 真正的轮数在 `flags.疯狂轮数`。旧实现只读 `临时疯狂` → `Number(描述句)` = NaN
 * → 退回默认 3 → **`turns` 恒为 3、`label` 恒为"还剩 3 轮"，不随 `疯狂轮数` 递减。**
 *
 * 之前那条测的是"守密人直接写数字"（`insanityOf({ 临时疯狂: 3 })`），
 * **恰好绕开了引擎自己的写法**，所以没抓到 —— 这组就是把它补上。
 * ============================================================
 */
describe('轮数必须跟着引擎记的 疯狂轮数 走（§2.1 潜伏 bug）', () => {
  it('引擎的写法：描述句 + 疯狂轮数=2 → turns 是 2，不是默认的 3', () => {
    const ins = insanityOf(
      { 临时疯狂: '理智骤降 6 点，陷入临时疯狂', 疯狂轮数: 2 },
      'percent',
      2
    );
    expect(ins.turns).toBe(2);
    expect(ins.label).toContain('还剩 2 轮');
  });

  it('不给 hint 时退回默认窗口（与旧行为一致，不破坏原来的用例）', () => {
    const ins = insanityOf({ 临时疯狂: '理智骤降 6 点，陷入临时疯狂' }, 'percent');
    expect(ins.turns).toBe(INSANITY_TURNS);
  });

  it('非法 hint（NaN / 0 / 负数）一律忽略，退回从 flag 读', () => {
    const flags = { 临时疯狂: '疯了', 疯狂轮数: 0 };
    expect(insanityOf(flags, 'percent', Number.NaN).turns).toBe(INSANITY_TURNS);
    expect(insanityOf(flags, 'percent', 0).turns).toBe(INSANITY_TURNS);
    expect(insanityOf(flags, 'percent', -1).turns).toBe(INSANITY_TURNS);
  });

  it('与 tickInsanity 同口径：推进后的轮数，insanityOf 也要报同一个数', () => {
    const flags = { 临时疯狂: '理智骤降 6 点，陷入临时疯狂', 疯狂轮数: 3 };
    const tick = tickInsanity(flags, 3);
    expect(tick.next).toBe(2);
    const next = typeof tick.next === 'number' ? tick.next : undefined;
    const ins = insanityOf({ ...flags, 疯狂轮数: next }, 'percent', next);
    expect(ins.turns).toBe(2);
  });

  it('守密人直接写数字的旧写法仍然认（第三参不该把它顶掉）', () => {
    expect(insanityOf({ 临时疯狂: 3 }, 'percent').turns).toBe(3);
    expect(insanityOf({ 临时疯狂: 5 }, 'percent', undefined).turns).toBe(5);
  });
});

describe('临时疯狂：有界、可恢复的数值惩罚（用户 09-16 拍板）', () => {
  it('没疯时不罚', () => {
    expect(insanityOf({}, 'percent').active).toBe(false);
    expect(insanityOf({}, 'percent').penalty).toBe(0);
    expect(insanityOf({}, 'modifier').penalty).toBe(0);
    expect(insanityOf(undefined, 'percent').active).toBe(false);
  });

  it('疯了就吃惩罚：d100 -20，d20 -2', () => {
    expect(insanityOf({ 临时疯狂: '理智骤降 6 点' }, 'percent').penalty).toBe(-20);
    expect(insanityOf({ 临时疯狂: '理智骤降 6 点' }, 'modifier').penalty).toBe(-2);
  });

  it('**有界**：无论疯几次、描述多长，罚额都是一个档，绝不叠加', () => {
    const a = insanityOf({ 临时疯狂: '疯了' }, 'percent').penalty;
    const b = insanityOf({ 临时疯狂: 99 }, 'percent').penalty;
    const c = insanityOf({ 临时疯狂: { turns: 5, text: '很长很长的描述' } }, 'percent').penalty;
    expect(a).toBe(b);
    expect(b).toBe(c);
  });

  it('`false` / 空串 / 0 / null 一律算**解除即消除**', () => {
    for (const v of [false, '', 0, null, undefined]) {
      const ins = insanityOf({ 临时疯狂: v }, 'percent');
      expect(ins.active).toBe(false);
      expect(ins.penalty).toBe(0);
    }
  });

  it('能读出剩余轮数，界面上显示出来', () => {
    expect(insanityOf({ 临时疯狂: 3 }, 'percent').turns).toBe(3);
    expect(insanityOf({ 临时疯狂: 3 }, 'percent').label).toContain('还剩 3 轮');
    expect(insanityOf({ 临时疯狂: { turns: 2 } }, 'percent').turns).toBe(2);
  });

  it('读不出轮数时用默认窗口，**绝不返回 0**（0 会被当成已解除）', () => {
    const ins = insanityOf({ 临时疯狂: '他抓着头发喃喃自语' }, 'percent');
    expect(ins.active).toBe(true);
    expect(ins.turns).toBe(INSANITY_TURNS);
  });
});

describe('临时疯狂：逐轮推进', () => {
  it('没疯时推进不做任何事', () => {
    expect(tickInsanity({}, undefined).next).toBe(false);
    expect(tickInsanity(undefined, undefined).turns).toBe(0);
  });

  it('有轮数就减一，减到 0 解除', () => {
    expect(tickInsanity({ 临时疯狂: 3 }, undefined).next).toBe(2);
    expect(tickInsanity({ 临时疯狂: 3 }, 3).next).toBe(2);
    expect(tickInsanity({ 临时疯狂: 1 }, 1).next).toBe(false);
  });

  it('引擎自己记的轮数优先于 flag 上的值（守密人写的是描述句时尤其重要）', () => {
    // flag 是一句描述（读不出数字），但引擎记得还剩 2 轮
    expect(tickInsanity({ 临时疯狂: '他抓着头发喃喃自语' }, 2).next).toBe(1);
  });

  it('守密人写了描述句且引擎没轮数时，起一个默认窗口（不会永远解除不掉）', () => {
    const first = tickInsanity({ 临时疯狂: '他抓着头发喃喃自语' }, undefined);
    expect(first.turns).toBe(INSANITY_TURNS - 1);
    // 下一轮用引擎记的轮数继续递减
    const second = tickInsanity({ 临时疯狂: '他抓着头发喃喃自语' }, first.turns);
    expect(second.turns).toBe(INSANITY_TURNS - 2);
  });

  it('从触发到解除刚好走满 INSANITY_TURNS 轮', () => {
    let turns = INSANITY_TURNS;
    let n = 0;
    while (turns > 0) {
      const t = tickInsanity({ 临时疯狂: '疯了' }, turns);
      turns = t.turns;
      n++;
      if (t.next === false) break;
      if (n > 50) throw new Error('解除不掉');
    }
    expect(n).toBe(INSANITY_TURNS);
  });
});

describe('临时疯狂：给守密人的提示', () => {
  it('没疯时为 null', () => {
    expect(insanityNote(insanityOf({}, 'percent'))).toBeNull();
  });

  it('提示里说清"这是暂时的"与"怎么提前解除"，且不带数字', () => {
    const note = insanityNote(insanityOf({ 临时疯狂: '疯了' }, 'percent'))!;
    expect(note).toContain('暂时的');
    expect(note).toContain('flags.临时疯狂');
    expect(note).toContain('false');
    expect(note).not.toMatch(/-\d+/);
  });

  it('明确"不要替他做决定"（失控的是身体与感知，不是选择）', () => {
    const note = insanityNote(insanityOf({ 临时疯狂: '疯了' }, 'percent'))!;
    expect(note).toContain('不要替他做决定');
  });
});
