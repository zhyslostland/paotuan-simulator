/**
 * 回溯锚点判据（2026-09-17 主人拍板的"精简版"）。
 *
 * 守的是一件事：**记"选择"，不记"结算"。**
 * 这条一旦松掉，长局里回溯菜单会退化成一列上百条"掷骰失败：侦查"，等于没有。
 */
import { describe, expect, it } from 'vitest';
import { anchorReasons, ROLL_FAIL_REASON_PREFIX } from '../src/ui/anchorReasons.js';

describe('锚点判据：掷骰只在没过时记', () => {
  it('掷骰失败 → 记', () => {
    const r = anchorReasons({ check: { skill: '侦查', success: false } });
    expect(r).toEqual([`${ROLL_FAIL_REASON_PREFIX}侦查`]);
  });

  it('掷骰成功 → **不记**（成功的那次不需要回到）', () => {
    expect(anchorReasons({ check: { skill: '侦查', success: true } })).toEqual([]);
  });

  it('没有 success 字段（旧消息）→ 保守地不记', () => {
    expect(anchorReasons({ check: { skill: '侦查' } })).toEqual([]);
  });

  it('技能名为空 / 没有检定 → 不记', () => {
    expect(anchorReasons({ check: { skill: '  ', success: false } })).toEqual([]);
    expect(anchorReasons({})).toEqual([]);
    expect(anchorReasons({ check: null })).toEqual([]);
  });
});

describe('锚点判据：受伤与理智受创不再记（那是结算，不是选择）', () => {
  it('掉血不记 —— 哪怕是骰子表达式那种真挨了一下', () => {
    expect(anchorReasons({ deltas: [{ target: 'vitals.hp', op: 'dec', amount: '1d6' }] })).toEqual(
      []
    );
  });

  it('掉理智也不记', () => {
    expect(anchorReasons({ deltas: [{ target: 'vitals.san', op: 'dec', amount: '1d6' }] })).toEqual(
      []
    );
  });
});

describe('锚点判据：照旧记的几件（局面真的变了）', () => {
  it('进入战斗 / 战斗结束', () => {
    expect(anchorReasons({ deltas: [{ target: 'combat.active', value: true }] })).toEqual([
      '进入战斗',
    ]);
    expect(anchorReasons({ deltas: [{ target: 'combat.active', value: false }] })).toEqual([
      '战斗结束',
    ]);
  });

  it('新线索 / 新支线（只有 add 才算）', () => {
    expect(anchorReasons({ deltas: [{ target: 'clues', op: 'add' }] })).toEqual(['新线索']);
    expect(anchorReasons({ deltas: [{ target: 'clues', op: 'remove' }] })).toEqual([]);
    expect(anchorReasons({ deltas: [{ target: 'threads', op: 'add' }] })).toEqual(['新支线']);
  });

  it('移步：只在**首次到访**时记', () => {
    const d = { target: 'location', value: '河边的仓库' };
    expect(anchorReasons({ deltas: [d], visited: [] })).toEqual(['移步：河边的仓库']);
    expect(anchorReasons({ deltas: [d], visited: ['河边的仓库'] })).toEqual([]);
  });
});

describe('锚点判据：多件事同一回合', () => {
  it('掷骰失败 + 新线索 → 两条都出，且顺序稳定（掷骰优先）', () => {
    const r = anchorReasons({
      check: { skill: '聆听', success: false },
      deltas: [{ target: 'clues', op: 'add' }],
    });
    expect(r).toEqual([`${ROLL_FAIL_REASON_PREFIX}聆听`, '新线索']);
  });

  it('重复的同一条理由只出一次', () => {
    const r = anchorReasons({
      deltas: [
        { target: 'clues', op: 'add' },
        { target: 'clues', op: 'add' },
      ],
    });
    expect(r).toEqual(['新线索']);
  });

  it('什么都不沾 → 空数组（不记锚点）', () => {
    expect(
      anchorReasons({
        check: { skill: '侦查', success: true },
        deltas: [
          { target: 'vitals.hp', op: 'dec', amount: 5 },
          { target: 'flags.某个标记', op: 'set', value: true },
          { target: 'location', value: '走廊' },
        ],
        visited: ['走廊'],
      })
    ).toEqual([]);
  });
});
