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
import type { CheckBadge } from '../core/types.js';
import type { RunSummary, OutcomeKind } from '../core/career.js';

/**
 * 消息上可能挂着的检定（单条 `check` 与一次多掷的 `checks` 都要算）。
 *
 * **就是引擎掷完写上去的那张卡本身**（`core/types.ts` 的 `CheckBadge`），
 * 不另造一个形状：
 * - 显示侧要的 `checkTargetText()` 认的正是它（`target` 必填、`mainDice` 可选）；
 * - 若这里另写一个「字段差不多」的接口，调用点就得靠 `as` 掰回去 ——
 *   那等于抽了个假真源（P2-1 修的就是这种"同一件事两套读法"）。
 *
 * 之所以单独起 `CheckLike` 这个别名而不是到处写 `CheckBadge`：
 * 这里的语义是"**消息上挂的**检定卡"（读的入口），将来若检定的存法再演进，
 * 只有这个别名要改，两个调用点不动。
 */
export type CheckLike = CheckBadge;

export interface MessageLike {
  role: string;
  check?: CheckLike | null;
  checks?: CheckLike[] | null;
}

/**
 * 一条消息上挂着的**全部**检定（P2-1）。
 *
 * ## 为什么这必须是唯一真源
 * 检定的记法有两种：单掷写 `check`，一次多掷写 `checks`（数组）。
 * 早先「检定记录」那两处（`WorldPanel` 的列表、`Settings` 的复制记录）
 * **只读了 `m.check`** —— 玩家点「一次全掷」掷出来的那些**一条都不进记录**，
 * 而生涯统计那边读的是两个都算。同一件事两套读法，必然对不上。
 *
 * 顺序照消息本身来：`check` 在前（它是这条消息的主检定），
 * `checks` 跟在后面（补掷的），跟玩家看到的顺序一致。
 */
export function checksOf(m: MessageLike | null | undefined): CheckLike[] {
  if (!m) return [];
  const out: CheckLike[] = [];
  if (m.check) out.push(m.check);
  if (Array.isArray(m.checks)) out.push(...m.checks);
  return out;
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
    for (const c of checksOf(m)) {
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
