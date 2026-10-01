/**
 * 故事时钟单测（用户 2026-09-17 报「测试模组没有时间表/没有时钟」）。
 *
 * 这个文件守的是三条判据，每条都对应一类真实翻车方式：
 *
 * ① **模糊量必须接得住**。模型写"一会儿""过了很久""折腾了半天"都要能折算；
 *    认不出来时退到最小推进（5 分钟），**绝不原地不动** ——
 *    原地不动＝长篇倒计时永远不动，那正是要修的毛病。
 *
 * ② **时间不能倒退着出界**。往回的推进（"折返半小时"）不能把时钟推到第 0 天；
 *    分钟的溢出要进位到天。
 *
 * ③ **倒计时减到 0 就停**。0 的含义是"期限到了"；
 *    至于是不是真的结束一局，那是守密人的 ending 说了算，引擎不许越权收档。
 */
import { describe, expect, it } from 'vitest';
import {
  DEFAULT_CLOCK,
  MINUTES_PER_DAY,
  absoluteMinutes,
  advanceClock,
  clockDetail,
  clockFromMinutes,
  clockLabel,
  deadlineFromDays,
  deadlineLabel,
  minutesBetween,
  normalizeClock,
  parseElapsed,
  phaseOf,
  tickClock,
  waitTargetMinutes,
} from '../src/core/clock.js';

describe('normalizeClock / 时刻规整', () => {
  it('缺省与非法值退到第 1 天 00:00 的合法形态', () => {
    expect(normalizeClock(undefined).day).toBe(1);
    expect(normalizeClock(null).minute).toBe(0);
    expect(normalizeClock({ day: 0, minute: 0 }).day).toBe(1);
    expect(normalizeClock({ day: -3, minute: 10 }).day).toBe(1);
    expect(normalizeClock({ day: NaN, minute: NaN as unknown as number }).day).toBe(1);
  });

  it('分钟溢出进位到天', () => {
    expect(normalizeClock({ day: 1, minute: MINUTES_PER_DAY })).toEqual({ day: 2, minute: 0 });
    expect(normalizeClock({ day: 1, minute: MINUTES_PER_DAY + 90 })).toEqual({
      day: 2,
      minute: 90,
    });
  });

  it('负数分钟退到前一天，但不早于第 1 天', () => {
    expect(normalizeClock({ day: 3, minute: -30 })).toEqual({ day: 2, minute: MINUTES_PER_DAY - 30 });
    // 第 1 天的更早 —— 夹到第 1 天 00:00，不许出现"第 0 天"
    expect(normalizeClock({ day: 1, minute: -30 })).toEqual({ day: 1, minute: 0 });
  });

  it('小数一律向下取整', () => {
    expect(normalizeClock({ day: 2.9, minute: 10.8 })).toEqual({ day: 2, minute: 10 });
  });
});

describe('绝对分钟 / 差值', () => {
  it('第 1 天 00:00 为 0', () => {
    expect(absoluteMinutes({ day: 1, minute: 0 })).toBe(0);
    expect(absoluteMinutes(DEFAULT_CLOCK)).toBe(9 * 60);
    expect(absoluteMinutes({ day: 2, minute: 0 })).toBe(MINUTES_PER_DAY);
  });

  it('往返一致', () => {
    for (const m of [0, 1, 599, MINUTES_PER_DAY - 1, MINUTES_PER_DAY, 5000]) {
      expect(absoluteMinutes(clockFromMinutes(m))).toBe(m);
    }
  });

  it('差值可以为负（剧情往回放）', () => {
    expect(minutesBetween({ day: 1, minute: 100 }, { day: 1, minute: 40 })).toBe(-60);
    expect(minutesBetween({ day: 1, minute: 100 }, { day: 2, minute: 40 })).toBe(
      MINUTES_PER_DAY - 60
    );
  });
});

describe('advanceClock / 推进', () => {
  it('同一时段内平移', () => {
    expect(advanceClock({ day: 1, minute: 9 * 60 }, 180)).toEqual({ day: 1, minute: 12 * 60 });
  });

  it('跨天进位', () => {
    expect(advanceClock({ day: 1, minute: 23 * 60 }, 120)).toEqual({ day: 2, minute: 60 });
  });

  it('往回推不会出界到第 0 天', () => {
    const back = advanceClock({ day: 1, minute: 30 }, -120);
    expect(back.day).toBe(1);
    expect(back.minute).toBe(0);
  });

  it('0 分钟不动', () => {
    expect(advanceClock(DEFAULT_CLOCK, 0)).toEqual(DEFAULT_CLOCK);
  });
});

describe('clockLabel / clockDetail / phaseOf', () => {
  it('时段划分覆盖全天且边界正确', () => {
    expect(phaseOf({ day: 1, minute: 3 * 60 })).toBe('深夜');
    expect(phaseOf({ day: 1, minute: 7 * 60 })).toBe('清晨');
    expect(phaseOf({ day: 1, minute: 9 * 60 })).toBe('上午');
    expect(phaseOf({ day: 1, minute: 12 * 60 })).toBe('正午');
    expect(phaseOf({ day: 1, minute: 15 * 60 })).toBe('下午');
    expect(phaseOf({ day: 1, minute: 18 * 60 })).toBe('傍晚');
    expect(phaseOf({ day: 1, minute: 21 * 60 })).toBe('夜里');
    expect(phaseOf({ day: 1, minute: 23 * 60 })).toBe('深夜');
  });

  it('人话格式', () => {
    expect(clockLabel({ day: 3, minute: 18 * 60 })).toBe('第 3 天 · 傍晚');
    expect(clockDetail({ day: 3, minute: 18 * 60 + 40 })).toBe('第 3 天 18:40');
    expect(clockDetail({ day: 2, minute: 5 })).toBe('第 2 天 00:05');
  });
});

describe('parseElapsed / 把守密人写的"过了多久"折算成分钟', () => {
  it('小时的各种说法', () => {
    expect(parseElapsed('三个小时')).toBe(180);
    expect(parseElapsed('3 小时')).toBe(180);
    expect(parseElapsed('三小时')).toBe(180);
    expect(parseElapsed('一小时')).toBe(60);
    expect(parseElapsed('两个小时')).toBe(120);
    expect(parseElapsed('十小时')).toBe(600);
  });

  it('半小时与一个半钟头', () => {
    expect(parseElapsed('半小时')).toBe(30);
    expect(parseElapsed('一个半钟头')).toBe(90);
    expect(parseElapsed('半个钟头')).toBe(30);
  });

  it('天与夜', () => {
    expect(parseElapsed('三天')).toBe(3 * MINUTES_PER_DAY);
    expect(parseElapsed('第二天的清晨')).toBe(MINUTES_PER_DAY);
    expect(parseElapsed('一整夜')).toBe(8 * 60);
    expect(parseElapsed('通宵')).toBe(8 * 60);
    expect(parseElapsed('过夜')).toBe(8 * 60);
    expect(parseElapsed('一整天')).toBe(MINUTES_PER_DAY);
    expect(parseElapsed('一天一夜')).toBe(MINUTES_PER_DAY);
  });

  it('一周的说法按 7 天算', () => {
    expect(parseElapsed('一周')).toBe(7 * MINUTES_PER_DAY);
    expect(parseElapsed('两个星期')).toBe(14 * MINUTES_PER_DAY);
  });

  it('小时优先于天 —— "三天" 不会被"日"抢走', () => {
    // "三个小时"里既有量词也有"小时"，必须走小时那条
    expect(parseElapsed('三个小时')).toBe(180);
  });

  it('模糊的小量给中间值（十分钟量级），不是 0', () => {
    for (const s of ['一会儿', '片刻', '没多久', '不久', '稍作休息']) {
      const v = parseElapsed(s);
      expect(v).toBeGreaterThan(0);
      expect(v).toBeLessThanOrEqual(30);
    }
  });

  it('口语的"半天"不是 12 小时，是一段"挺久但没准数"的时间', () => {
    // "折腾了半天" 说这话的人指的是几个钟头，不是字面的 12 小时
    expect(parseElapsed('半天')).toBe(4 * 60);
    expect(parseElapsed('大半天')).toBe(6 * 60);
    // 但字面意义的"十二个小时"照旧
    expect(parseElapsed('十二个小时')).toBe(12 * 60);
  });

  it('分钟量级', () => {
    expect(parseElapsed('十分钟')).toBe(10);
    expect(parseElapsed('5 分钟')).toBe(5);
  });

  it('认不出来时退到 5 分钟，绝不原地不动', () => {
    expect(parseElapsed('折腾了很久')).toBe(5);
    expect(parseElapsed('不知过了多久')).toBe(5);
    expect(parseElapsed('???')).toBe(5);
  });

  it('空值＝没推进（0），与"认不出来"要分开', () => {
    expect(parseElapsed(undefined)).toBe(0);
    expect(parseElapsed(null)).toBe(0);
    expect(parseElapsed('')).toBe(0);
    expect(parseElapsed('   ')).toBe(0);
  });
});

describe('deadlineFromDays / deadlineLabel', () => {
  it('非正数或非数字一律返回 null（不编期限）', () => {
    expect(deadlineFromDays(undefined, '雨季')).toBeNull();
    expect(deadlineFromDays(0, '雨季')).toBeNull();
    expect(deadlineFromDays(-3, '雨季')).toBeNull();
    expect(deadlineFromDays(NaN, '雨季')).toBeNull();
  });

  it('天数折算成分钟并保留说明', () => {
    expect(deadlineFromDays(23, '雨季结束')).toEqual({
      remain: 23 * MINUTES_PER_DAY,
      label: '雨季结束',
    });
  });

  it('人话分档：长剩天、短剩小时、最后一小时报分钟', () => {
    expect(deadlineLabel(deadlineFromDays(22, 'x')!)).toBe('还剩 22 天');
    expect(deadlineLabel({ remain: 6 * 60, label: 'x' })).toBe('还剩 6 小时');
    expect(deadlineLabel({ remain: 40, label: 'x' })).toBe('只剩 40 分钟');
    // 3 天以内带上小时，紧迫感更具体
    expect(deadlineLabel({ remain: 2 * MINUTES_PER_DAY + 5 * 60, label: 'x' })).toBe(
      '还剩 2 天 5 小时'
    );
  });

  it('到点或空值返回空串', () => {
    expect(deadlineLabel(null)).toBe('');
    expect(deadlineLabel(undefined)).toBe('');
    expect(deadlineLabel({ remain: 0, label: 'x' })).toBe('');
  });
});

describe('tickClock / 一次推进做三件事', () => {
  it('时钟前进、倒计时同量减少', () => {
    const r = tickClock({ day: 1, minute: 9 * 60 }, { remain: 5 * 60, label: '天亮' }, '三个小时');
    expect(r.elapsedMinutes).toBe(180);
    expect(r.clock).toEqual({ day: 1, minute: 12 * 60 });
    expect(r.deadline!.remain).toBe(5 * 60 - 180);
  });

  it('倒计时减到 0 就停，绝不为负', () => {
    const r = tickClock({ day: 1, minute: 9 * 60 }, { remain: 60, label: '天亮' }, '三个小时');
    expect(r.deadline!.remain).toBe(0);
  });

  it('没有倒计时时 deadline 保持 null', () => {
    const r = tickClock(DEFAULT_CLOCK, null, '一个小时');
    expect(r.deadline).toBeNull();
  });

  it('跨天才算 daysPassed，同一天内走动不算', () => {
    expect(tickClock({ day: 1, minute: 9 * 60 }, null, '三个小时').daysPassed).toBe(0);
    expect(tickClock({ day: 1, minute: 23 * 60 }, null, '三个小时').daysPassed).toBe(1);
    expect(tickClock({ day: 1, minute: 9 * 60 }, null, '三天').daysPassed).toBe(3);
  });

  it('noteworthy 只在跨天或跨时段时为真（免得每轮都刷提示）', () => {
    // 9:00 → 9:10，同一时段，不值得提
    expect(tickClock({ day: 1, minute: 9 * 60 }, null, '十分钟').noteworthy).toBe(false);
    // 9:00 → 12:00，上午 → 正午，值得提
    expect(tickClock({ day: 1, minute: 9 * 60 }, null, '三个小时').noteworthy).toBe(true);
    // 跨天一定值得提
    expect(tickClock({ day: 1, minute: 23 * 60 }, null, '三个小时').noteworthy).toBe(true);
  });

  it('空 elapsed 不推进（调用方压根没申报）', () => {
    const r = tickClock(DEFAULT_CLOCK, { remain: 1000, label: 'x' }, undefined);
    expect(r.elapsedMinutes).toBe(0);
    expect(r.clock).toEqual(DEFAULT_CLOCK);
    expect(r.deadline!.remain).toBe(1000);
    expect(r.noteworthy).toBe(false);
  });

  it('认不出来的量也推 5 分钟 —— 长篇倒计时不许卡死', () => {
    const r = tickClock(DEFAULT_CLOCK, { remain: 1000, label: 'x' }, '不知过了多久');
    expect(r.elapsedMinutes).toBe(5);
    expect(r.clock.minute).toBe(9 * 60 + 5);
    expect(r.deadline!.remain).toBe(995);
  });
});


/* ============================================================
 * 🔴 `G17`（协28 §F① 第 8 条）：玩家说「我等到 X」时，**引擎给一个时钟下限**。
 * 以前完全没有落点 —— 时钟走多少全看守密人填的 `elapsed`，
 * 于是"等到"这个动作在引擎侧等于不存在。
 * ============================================================ */
describe('G17：等到某个时刻 → 时钟下限', () => {
  it('「等到午夜」：那个点已经过了就顺延到之后', () => {
    // 基准与 absoluteMinutes 同一套（第 1 天 00:00 = 0）：09:00 = 540 → 今天的 0 点已过
    // → 顺延到「第 2 天 00:00」= 1440
    expect(waitTargetMinutes('我在钟楼里等到午夜。', { day: 1, minute: 9 * 60 })).toBe(1440);
  });

  it('「睡到天亮」：按当天凌晨 5 点算', () => {
    // 第 1 天 23:00 = 1380；天亮 = 300（已过）→ 顺延到第二天 05:00 = 1740
    expect(waitTargetMinutes('我睡到天亮再说。', { day: 1, minute: 23 * 60 })).toBe(1740);
  });

  it('没有"等"的意思就不认（叙事里出现"午夜"不算）', () => {
    expect(waitTargetMinutes('午夜的海面很平静。', { day: 1, minute: 9 * 60 })).toBeNull();
  });

  it('认不出时刻词也不认（宁可交给模型）', () => {
    expect(waitTargetMinutes('我一直等到他回来。', { day: 1, minute: 9 * 60 })).toBeNull();
  });

  it('🔴 tickClock 带下限：只抬不压', () => {
    const raised = tickClock({ day: 1, minute: 9 * 60 }, null, '一会儿', { floorMinutes: 1440 });
    expect(raised.clock.day).toBe(2);
    expect(raised.clock.minute).toBe(0);
    // 模型报的更久 → 照它的（下限不反过来把时间压短）
    const kept = tickClock({ day: 1, minute: 9 * 60 }, null, '一整天', { floorMinutes: 1440 });
    expect(kept.clock.day).toBe(2);
    expect(kept.clock.minute).toBe(9 * 60);
  });
});

/* ============================================================
 * 🔴 `G17` 的另一半（协30 §2.4）：玩家申报的目标时刻**既是下限也是上限**。
 *
 * 真机：15:00 说等到傍晚六点，下限算对了，但模型报的 `elapsed` 更久就照它的 ——
 * 时钟一路走到**次日 14:30**（+23.5 小时），而叙事只过了 1～3 小时。
 * 玩家说"我等到六点"，他就该在六点。
 * ============================================================ */
describe('G17：等到 X ＝ 上下限（不许提前，也不许冲过头）', () => {
  // 第 1 天 15:00 = 900；目标 18:00 = 1080
  const at = { day: 1, minute: 15 * 60 };
  const target = 18 * 60;

  it('🔴 模型报的 `elapsed` 更久 → 压到目标时刻（不再冲到次日）', () => {
    const r = tickClock(at, null, '一整夜', { floorMinutes: target, capMinutes: target });
    expect(r.clock.day).toBe(1);
    expect(r.clock.minute).toBe(18 * 60);
  });

  it('模型报得更短 → 抬到目标（下限那一半仍在）', () => {
    const r = tickClock(at, null, '一会儿', { floorMinutes: target, capMinutes: target });
    expect(r.clock.day).toBe(1);
    expect(r.clock.minute).toBe(18 * 60);
  });

  it('没申报目标时刻（只有 elapsed）→ 维持"只抬不压"的老口径', () => {
    const r = tickClock(at, null, '三个小时');
    expect(r.clock.day).toBe(1);
    expect(r.clock.minute).toBe(18 * 60); // 15:00 + 3h
  });
});
