/**
 * 生涯记录、成就、以及"一局的账"怎么算（R13/R30）。
 *
 * 守两件事：
 *   ① **生涯必须跨局**：开新团不清（所以它活在单独一个 key 里，不在单局存档里）；
 *   ② **成就一次性**：重复结算同一局不会再解锁、也不会把解锁时间刷成新的（用户要的"防刷"）。
 */
import { describe, expect, it } from 'vitest';
import {
  ACHIEVEMENTS,
  emptyCareer,
  mergeRun,
  OUTCOME_LABEL,
  passRate,
  recordRun,
  unlockedAchievements,
  type RunSummary,
} from '../src/core/career.js';
import { outcomeOf, summarizeRun } from '../src/ui/runSummary.js';

const run = (patch: Partial<RunSummary> = {}): RunSummary => ({
  turns: 1,
  checks: 1,
  passed: 1,
  clues: 0,
  foes: 0,
  outcome: 'other',
  ...patch,
});

describe('生涯累计：纯加法，不改原对象', () => {
  it('空生涯一切为零', () => {
    const c = emptyCareer();
    expect(c.totals.runs).toBe(0);
    expect(c.totals.outcomes.success).toBe(0);
    expect(Object.keys(c.achievements)).toHaveLength(0);
  });

  it('并进一局：各项相加、结局计数各归各位', () => {
    const c = mergeRun(emptyCareer(), run({ turns: 10, checks: 4, passed: 3, clues: 2, foes: 1, outcome: 'death' }));
    expect(c.totals.runs).toBe(1);
    expect(c.totals.turns).toBe(10);
    expect(c.totals.checks).toBe(4);
    expect(c.totals.passed).toBe(3);
    expect(c.totals.outcomes.death).toBe(1);
    expect(c.totals.outcomes.success).toBe(0);
  });

  it('不修改传进来的那份（纯函数）', () => {
    const base = emptyCareer();
    mergeRun(base, run({ turns: 99 }));
    expect(base.totals.turns).toBe(0);
  });
});

describe('成就：一次性、不刷、判据看并账之后的数', () => {
  it('第一局就解锁"开过一次团"', () => {
    const { unlocked, career } = recordRun(emptyCareer(), run());
    expect(unlocked.map((a) => a.id)).toContain('first_run');
    expect(career.achievements.first_run).toBeTruthy();
  });

  it('**同一局重复结算不会再解锁**、也不刷新时间（防刷）', () => {
    const first = recordRun(emptyCareer(), run(), '2026-01-01T00:00:00.000Z');
    const second = recordRun(first.career, run(), '2026-09-17T00:00:00.000Z');
    expect(second.unlocked).toHaveLength(0);
    expect(second.career.achievements.first_run).toBe('2026-01-01T00:00:00.000Z');
    // 但局数**照记**（那是事实，不该因为成就有过就不算）
    expect(second.career.totals.runs).toBe(2);
  });

  it('单局跑到 50 回解锁"坐得住"', () => {
    const { unlocked } = recordRun(emptyCareer(), run({ turns: 50 }));
    expect(unlocked.map((a) => a.id)).toContain('turns_50');
  });

  it('交过手 5 种解锁"见过血"', () => {
    const { unlocked } = recordRun(emptyCareer(), run({ foes: 5 }));
    expect(unlocked.map((a) => a.id)).toContain('lion_heart');
  });

  it('"活着出来了"看的是累计达成次数', () => {
    const a = recordRun(emptyCareer(), run({ outcome: 'death' }));
    expect(a.unlocked.map((x) => x.id)).not.toContain('survivor');
    const b = recordRun(a.career, run({ outcome: 'success' }));
    expect(b.unlocked.map((x) => x.id)).toContain('survivor');
  });

  it('成就 id 不重复', () => {
    const ids = ACHIEVEMENTS.map((a) => a.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('每一条都有名字与说明（界面要直接显示）', () => {
    for (const a of ACHIEVEMENTS) {
      expect(a.name.length).toBeGreaterThan(0);
      expect(a.desc.length).toBeGreaterThan(0);
    }
  });
});

describe('派生计算', () => {
  it('passRate：没有检定时返回 null（免得界面显示刺眼的 0%）', () => {
    expect(passRate({ checks: 0, passed: 0 })).toBeNull();
    expect(passRate({ checks: 4, passed: 3 })).toBe(75);
  });

  it('已解锁成就按时间倒序（最近的在前）', () => {
    const a = recordRun(emptyCareer(), run(), '2026-01-01T00:00:00.000Z');
    const b = recordRun(a.career, run({ turns: 100 }), '2026-02-01T00:00:00.000Z');
    const list = unlockedAchievements(b.career);
    expect(list[0]!.at >= list[list.length - 1]!.at).toBe(true);
  });

  it('每种结局都有中文说法（界面上不能出现裸英文 key）', () => {
    for (const k of ['success', 'failure', 'death', 'insanity', 'grey', 'other'] as const) {
      expect(OUTCOME_LABEL[k]).toBeTruthy();
    }
  });
});

describe('这一局的账：全部读引擎已有的账', () => {
  it('检定同时算 check 与 checks（一次多掷也要数进去）', () => {
    const msgs = [
      { role: 'player', check: { success: true } },
      { role: 'player', checks: [{ success: false }, { success: true }] },
      { role: 'gm' }, // GM 的消息不带检定，不该被算
    ];
    const s = summarizeRun(msgs, { clues: [], fought: [], ending: undefined }, [1, 2, 3]);
    expect(s.checks).toBe(3);
    expect(s.passed).toBe(2);
    expect(s.turns).toBe(3);
  });

  it('老消息没有 success 字段 → 不计数进"过了"，但照样算作一次检定', () => {
    const s = summarizeRun(
      [{ role: 'player', check: {} }],
      { clues: [], fought: [], ending: undefined },
      []
    );
    expect(s.checks).toBe(1);
    expect(s.passed).toBe(0);
  });

  it('线索与交手记录取自 gameState', () => {
    const s = summarizeRun(
      [],
      { clues: ['a', 'b'], fought: ['巨影'], ending: { kind: 'success', text: '', at: '' } },
      []
    );
    expect(s.clues).toBe(2);
    expect(s.foes).toBe(1);
    expect(s.outcome).toBe('success');
  });

  it('认不出的结局 kind → 归 other（统计不能崩）', () => {
    expect(outcomeOf('莫名其妙')).toBe('other');
    expect(outcomeOf(undefined)).toBe('other');
    expect(outcomeOf('grey')).toBe('grey');
  });
});
