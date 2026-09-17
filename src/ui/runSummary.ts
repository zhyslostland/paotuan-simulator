/**
 * 把"这一局游戏的状态"算成一份可入账的统计（R13）。
 *
 * 住在 `src/` 而非 `core/`：入参是 UI 层的消息与 `GameState`；
 * 但函数本身是纯的（不碰 store、不碰 localStorage），可以直接喂数组测。
 *
 * ## 为什么全部读"引擎已有的账"
 * 不新增埋点、不让模型上报。回合数看**编年史**（引擎每轮记一条客观事实）、
 * 检定看**消息上的检定卡**（引擎掷完写上去的）、线索看 `gameState.clues`、
 * 交手过谁看 `gameState.fought`。
 * 这样统计**永远不会跟实际玩的对不上** —— 它读的就是同一份事实，
 * 而不是另记一份"统计专用"的数（那种数迟早会漂）。
 */
import type { GameState } from '../core/state/gameState.js';
import type { RunSummary, OutcomeKind } from '../core/career.js';

/** 消息上可能挂着的检定（单条 `check` 与一次多掷的 `checks` 都要算） */
export interface CheckLike {
  success?: boolean;
}

export interface MessageLike {
  role: string;
  check?: CheckLike | null;
  checks?: CheckLike[] | null;
}

/** 结局 kind → 统计用的 outcome（未知一律归 'other'，不让统计崩） */
export function outcomeOf(kind: string | undefined): OutcomeKind {
  switch (kind) {
    case 'success':
    case 'failure':
    case 'death':
    case 'insanity':
    case 'grey':
      return kind;
    default:
      return 'other';
  }
}

export function summarizeRun(
  messages: readonly MessageLike[],
  gameState: Pick<GameState, 'clues' | 'fought' | 'ending'>,
  chronicle: readonly unknown[]
): RunSummary {
  let checks = 0;
  let passed = 0;
  for (const m of messages) {
    if (m?.role !== 'player') continue;
    const list: CheckLike[] = [];
    if (m.check) list.push(m.check);
    if (Array.isArray(m.checks)) list.push(...m.checks);
    for (const c of list) {
      checks += 1;
      // 没写 success 的（老存档）算"没通过"会让命中率偏低 —— 干脆不计入分子
      if (c?.success === true) passed += 1;
    }
  }
  return {
    turns: chronicle.length,
    checks,
    passed,
    clues: (gameState.clues ?? []).length,
    foes: (gameState.fought ?? []).length,
    outcome: outcomeOf(gameState.ending?.kind),
  };
}
