/**
 * 生涯记录与成就（R13/R30）。
 *
 * ## 为什么生涯独立于单局存档
 * 单局存档会被"开新团"清掉、会被回溯重写。而"我一共跑过多少场、掷过多少次骰、
 * 有几个成就"是**跨越所有局**的东西 —— 它必须活在**另一个** key 里，
 * 否则每开一次新团，履历就归零。这是 R30 的地基，也是 Phase 2 世界层的前置。
 *
 * ## 三条设计约束
 * 1. **不发明数值经济。** 这一版**只记不奖**：成就不给"成长点"这种东西 ——
 *    本项目还没有成长系统，发一个用不掉的点数等于凭空造一个假机制。
 *    等真有成长曲线了，再在这里挂"消耗"。
 * 2. **成就一次性、不可重复解锁**（用户要的"防刷"）：`unlockAchievements` 只往里加，
 *    已经有的一律不动（连解锁时间都不覆盖）—— 否则反复开新团就能把时间刷成最新的。
 * 3. **判据是纯函数**，喂一份统计就能算，不碰 localStorage、不碰 store。
 *
 * ## 一局怎么统计
 * 全部取**引擎已有的账**，不新增埋点：回合数看编年史、检定看消息上的检定卡、
 * 线索看 `gameState.clues`、交手过的看 `gameState.fought`。
 * 这样统计永远不会跟实际玩的对不上 —— 它读的就是同一份事实。
 */

/** 结局种类（与 `Ending.kind` 对齐；这里刻意用宽松字符串，免得 core 反向依赖 UI） */
export type OutcomeKind = 'success' | 'failure' | 'death' | 'insanity' | 'grey' | 'other';

export const OUTCOME_LABEL: Record<OutcomeKind, string> = {
  success: '带着答案走出来了',
  failure: '没能做到',
  death: '死在了里面',
  insanity: '神志没能带回来',
  grey: '带着代价脱身',
  other: '收束',
};

/** 一局的账 */
export interface RunSummary {
  /** 用了多少回（编年史条数 —— 引擎每轮记一条客观事实） */
  turns: number;
  /** 掷过多少次骰 / 其中过了几次 */
  checks: number;
  passed: number;
  /** 手上留着的线索 */
  clues: number;
  /** 真正交过手的敌对者种数 */
  foes: number;
  /** 结局 */
  outcome: OutcomeKind;
}

/** 跨局累计 */
export interface CareerTotals {
  runs: number;
  turns: number;
  checks: number;
  passed: number;
  clues: number;
  foes: number;
  outcomes: Record<OutcomeKind, number>;
}

export interface Career {
  totals: CareerTotals;
  /** 成就 id → 解锁时间（ISO）。**只加不改** */
  achievements: Record<string, string>;
}

export function emptyCareer(): Career {
  return {
    totals: {
      runs: 0,
      turns: 0,
      checks: 0,
      passed: 0,
      clues: 0,
      foes: 0,
      outcomes: { success: 0, failure: 0, death: 0, insanity: 0, grey: 0, other: 0 },
    },
    achievements: {},
  };
}

/** 把一局的账并进生涯（纯加法，不改动传进来的那份） */
export function mergeRun(career: Career, run: RunSummary): Career {
  const t = career.totals;
  const outcomes = { ...t.outcomes };
  outcomes[run.outcome] = (outcomes[run.outcome] ?? 0) + 1;
  return {
    achievements: { ...career.achievements },
    totals: {
      runs: t.runs + 1,
      turns: t.turns + run.turns,
      checks: t.checks + run.checks,
      passed: t.passed + run.passed,
      clues: t.clues + run.clues,
      foes: t.foes + run.foes,
      outcomes,
    },
  };
}

export interface AchievementDef {
  id: string;
  name: string;
  desc: string;
  /** 达成判据：拿**并进之后**的累计值 + 本局的账一起判 */
  reached: (totals: CareerTotals, run: RunSummary) => boolean;
}

/**
 * 成就表。
 *
 * 刻意做成"**记录你干过什么**"，而不是"给你奖励"：
 * 前者是履历，后者需要一套数值经济（这一版不做，见文件头）。
 * 判据尽量用**引擎的账**，别用模型说过什么 —— 那不可靠。
 */
export const ACHIEVEMENTS: readonly AchievementDef[] = [
  {
    id: 'first_run',
    name: '开过一次团',
    desc: '跑完了第一局。',
    reached: (t) => t.runs >= 1,
  },
  {
    id: 'run_5',
    name: '常客',
    desc: '累计跑满 5 局。',
    reached: (t) => t.runs >= 5,
  },
  {
    id: 'turns_50',
    name: '坐得住',
    desc: '单局跑到 50 回以上。',
    reached: (_t, r) => r.turns >= 50,
  },
  {
    id: 'turns_100',
    name: '长夜漫漫',
    desc: '单局跑到 100 回以上。',
    reached: (_t, r) => r.turns >= 100,
  },
  {
    id: 'checks_30',
    name: '手气不错',
    desc: '单局掷过 30 次检定。',
    reached: (_t, r) => r.checks >= 30,
  },
  {
    id: 'lion_heart',
    name: '见过血',
    desc: '单局里有 5 种以上的东西跟你交过手。',
    reached: (_t, r) => r.foes >= 5,
  },
  {
    id: 'scholar',
    name: '笔记做满了',
    desc: '单局结束时手上留着 12 条以上线索。',
    reached: (_t, r) => r.clues >= 12,
  },
  {
    id: 'survivor',
    name: '活着出来了',
    desc: '第一次带着答案走出模组。',
    reached: (t) => t.outcomes.success >= 1,
  },
  {
    id: 'witness',
    name: '见过的太多了',
    desc: '有一局是神志先没的。',
    reached: (t) => t.outcomes.insanity >= 1,
  },
  {
    id: 'no_regrets',
    name: '不改命',
    desc: '有一局真的死于其中。',
    reached: (t) => t.outcomes.death >= 1,
  },
];

/**
 * 并进一局，并算出**这一局新解锁**的成就（第一次算解锁，重复的不再返回）。
 *
 * 顺序：先并账 → 再判据（判据看的是并进去之后的数，所以"第一局就解锁 first_run"成立）。
 */
export function recordRun(
  career: Career,
  run: RunSummary,
  now: string = new Date().toISOString()
): { career: Career; unlocked: AchievementDef[] } {
  const merged = mergeRun(career, run);
  const unlocked: AchievementDef[] = [];
  for (const a of ACHIEVEMENTS) {
    if (merged.achievements[a.id]) continue; // **一次性**：已有的一律不动（防刷）
    if (a.reached(merged.totals, run)) {
      merged.achievements[a.id] = now;
      unlocked.push(a);
    }
  }
  return { career: merged, unlocked };
}

/** 命中率（没有检定记录时返回 null，界面据此不显示"0%"这种难看的数） */
export function passRate(t: { checks: number; passed: number }): number | null {
  if (!t.checks) return null;
  return Math.round((t.passed / t.checks) * 100);
}

/** 已经解锁的成就，按解锁时间排（界面用） */
export function unlockedAchievements(
  career: Career
): { def: AchievementDef; at: string }[] {
  return ACHIEVEMENTS.filter((a) => career.achievements[a.id])
    .map((a) => ({ def: a, at: career.achievements[a.id]! }))
    .sort((x, y) => (x.at < y.at ? 1 : -1));
}
