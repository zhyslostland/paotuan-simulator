/**
 * 编年史（事件日志）的折叠判据 —— **全项目只有这一份**。
 *
 * ## 为什么要有它（P2-6＝P3-5，协作方第 20 版）
 * 原来的判据是**条数**：`CHRONICLE_FOLD_AT = 50`、`CHRONICLE_KEEP = 20`
 * （`App.tsx:100-102`）。原文裁定：
 *
 * > `CHRONICLE_FOLD_AT=50` 正常玩不到；C″ 从尾砍 → 早期既没进摘要又被裁。压缩失败静默。
 * > 改按**字符**：编年史合计 ≥ 4000 字就折，保留近 2000 字。`40000`/砍序不动。
 * > 折完 toast「前情已折进摘要」。失败 toast。
 *
 * ## 为什么条数不行
 * 一条编年史的长度**差得很远**：短的一句「推开门」十几个字，长的能有几百字的场景描写。
 * 按条数算的话，50 条既可能是 800 字（远没到该折的时候，白折一次还多花一次模型调用），
 * 也可能是 15000 字（提示词早就撑爆了还没折）。**玩家真正在意的是"进去多少字"**，
 * 而提示词预算（`PROMPT_BUDGET_CHARS`）也是按字符算的 —— 判据得和预算同一把尺子。
 *
 * ## 折叠的方向：从**头**折，保**尾**
 * 保留的是**最近**的近 2000 字（`keepFrom` 从前向后累计到 `KEEP_CHARS` 就停）。
 * 为什么不能从尾砍：越早的事件越容易没进摘要层，砍尾＝把近处的事丢了，
 * 而远处的旧账反而可能已经在 `summary` 里 —— 这正是原判据「C″ 从尾砍」的病。
 *
 * ## 两处原文没定义的判据（实现方按项目判断定，已留档在协作清单）
 * 原文只说「合计 ≥ 4000 字」，没说「合计」怎么算、也没提单条超长怎么办。定如下：
 *   1. **合计只算 `text`**（不算 `turn` / `location`）—— `text` 才是真正进提示词、
 *      真正占预算的部分，判据与 `PROMPT_BUDGET_CHARS` 同一把尺子。
 *   2. **单条自己就超过保留阈值时，那条也保留**（`keepFrom` 会等于 `entries.length`）。
 *      宁可这次折得少一点，也不能把玩家刚看到的那条折走 —— 折了它眼前的事会凭空消失。
 *      调用方用 `shouldFold()` 判断，这种"一条都不该折"的情况**不发请求、不 toast**。
 *
 * ## 纯函数、无 IO
 * 这里只算「该折几条」，不碰 store、不落盘、不发请求 —— 调用方（`App.tsx`）负责。
 */
import type { ChronicleEntry } from './types.js';

/** 编年史合计到这个字符数就该折了 */
export const FOLD_AT_CHARS = 4000;

/** 折叠后保留的近期明细字符数（从尾部往前算） */
export const KEEP_CHARS = 2000;

/**
 * 编年史合计多少字。
 * 只算 `text` —— `turn` 是数字、`location` 很短，都不是提示词里的大头。
 */
export function chronicleChars(entries: readonly ChronicleEntry[]): number {
  let n = 0;
  for (const e of entries) n += e.text.length;
  return n;
}

/**
 * 该从第几条开始保留（返回值就是 `foldChronicle(keepFrom, ...)` 的 `keepFrom`）。
 *
 * - 合计 **不足** `FOLD_AT_CHARS` → 返回 `0`，表示**不用折**。
 * - 合计够了 → 从**尾部**往前数够 `KEEP_CHARS`，返回那条的下标。
 *
 * ⚠️ 返回值有两种「别折」的情形，调用方别搞混：
 *   - `0` ＝ 没到阈值，不用折；
 *   - `>= entries.length` ＝ 到了阈值，但最新那条自己就够长，**一条都不该折**。
 *   两种情况都该早退 —— 用 `shouldFold()` 判断最省心。
 */
export function chronicleKeepFrom(entries: readonly ChronicleEntry[]): number {
  const total = chronicleChars(entries);
  if (total < FOLD_AT_CHARS) return 0; // 没到阈值：不折

  /*
   * 从尾部往前走，累计到 KEEP_CHARS 就停 —— 返回**刚加进去那条的下标**。
   *
   * ⚠️ 这里最容易差一条：`acc` 加上第 `i` 条之后若已够，保留范围就是 `[i, 末尾]`，
   * 所以返回的必须是 `i`（不是 `i - 1`）。差一条的后果是保下来的字数**少于承诺的 2000**
   * —— 玩家近处的事被多折掉一件（这个 bug 是写测试时抓出来的）。
   */
  let acc = 0;
  for (let i = entries.length - 1; i >= 0; i--) {
    acc += entries[i]!.text.length;
    if (acc >= KEEP_CHARS) {
      /*
       * `i === 0` ＝ 光最后一条就够 2000 字了。
       *
       * 这时**不能返回 0** —— `0` 的语义是「不用折」，而此刻的情况恰恰相反。
       * 按项目判断（原文没定义，已留档）：**宁愿一条都不折**，也不能把玩家刚看到的那条折走
       * —— 折了它，眼前的事会凭空消失。返回 `length` 让调用方早退。
       */
      return i === 0 ? entries.length : i;
    }
  }
  /*
   * 理论上走不到这儿（`total >= 4000 > KEEP_CHARS`）。真到了，同样取安全的一侧：
   * 返回 `length`（一条都不折），绝不返回 0。
   */
  return entries.length;
}

/**
 * 这次折叠是不是**真的会折掉东西**。
 *
 * `chronicleKeepFrom` 返回 `0`（没到阈值）或 `entries.length`（一条都不该折）时，
 * 都不该发请求、不该 toast —— 否则玩家会看到「前情已折进摘要」但什么都没变。
 */
export function shouldFold(entries: readonly ChronicleEntry[]): boolean {
  const keepFrom = chronicleKeepFrom(entries);
  return keepFrom > 0 && keepFrom < entries.length;
}
