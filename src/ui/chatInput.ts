/**
 * 输入框的「现在能不能发」判据（`G8`）。
 *
 * ## 为什么单独放一个模块
 * 这条判据要能被单测盯住 —— 它上一版是**结构性缺陷**：`sendToGm` 里没有任何
 * 「队列非空就先拦下」的门，而待掷队列的消费只发生在 `roll*Checks` 两处，
 * 于是"不掷骰直接发下一句"会让那张检定卡**永远挂着**（真机：未掷骰就继续下一步，检定框不消失）。
 * 写成纯函数，判据就只有一份、且能断言。
 *
 * ## 为什么是「拦」而不是「替他掷」
 * 替玩家把骰子掷掉＝替他做决定，还顺手拿走他挑加值的机会 —— 那正是本项目
 * 「凡替玩家做决定的机制先问一句『他的显式意图会不会被盖住』」要拦的那类。
 * 而拦**拦不死人**：出口就在那张卡上（掷骰 / 忽略 / 全部忽略）。
 */

/** 手里还捏着没掷的检定时，输入框上方那句话 */
export const PENDING_CHECK_BLOCK_NOTE =
  '先把守密人要的检定掷掉（或点上面的「忽略」）—— 骰子的结果会影响他接下来怎么写。';

export interface ChatGateState {
  /** 草稿里有字（空草稿不用提示，按钮本来就是灰的） */
  hasText: boolean;
  /** 守密人还在写 */
  streaming: boolean;
  /** 这一局已经结档 */
  ended: boolean;
  /** 待掷检定的条数 */
  pendingChecks: number;
}

/**
 * 现在能不能把玩家这一句送出去；不能则回一句给人看的话（`null` ＝ 可以发）。
 *
 * 流式 / 结档**不在这里给提示**：那两种情况的回执早就各有一句（P1-1 的流式回执、
 * 结档后的输入框说明），这里只管 `G8` 这一个新理由。
 */
export function draftBlockReason(s: ChatGateState): string | null {
  if (!s.hasText || s.streaming || s.ended) return null;
  if (s.pendingChecks > 0) return PENDING_CHECK_BLOCK_NOTE;
  return null;
}
