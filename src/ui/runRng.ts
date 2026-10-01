/**
 * 运行期随机源 + **随机调用日志** —— 让"真机出的问题能被复现"。
 *
 * ## 为什么要有它（2026-09-30 · 用户亲报"我那次掷出 96 之后状态就乱了"）
 *
 * 引擎**本来就是确定性的**：`core/dice/roll.ts` 头部写着
 * 「铁律：所有随机数都在这里产生，且 RNG 可注入」，`applyDeltas` 也收 `ctx.rng`。
 * 但实测：生产侧几处调用**一处都没传**（`skillCheck` 的 `rollPercentile()`/`roll()`、
 * `applyDeltas` × 3、`tickStatusEffects(..., Math.random)`），
 * 于是全部回落到 `Math.random` —— **玩家报的问题永远复现不了**。
 *
 * ## ⚠️ 上一版为什么被撤回（这个文件的关键设计约束）
 *
 * 第一版导出了 `export let runRng`，调用点写 `import { runRng }` ——
 * **那是绑定当时的那个函数**。`reseedRun()` 之后变量指向新函数，
 * 但调用点拿到的仍是旧的 ⇒ **换了种子还在用旧源**；
 * 而 `startNewGame()` 一旦被某个用例调用，后续用例对 `Math.random` 的桩也就失效，
 * `store.test.ts` 出现**顺序相关**的红（HEAD 连跑 3 次全绿、那一版 1～3 条红）。
 *
 * 所以这里**只暴露 getter** `currentRng()`：调用点每次都现取，永远拿到当前那个源。
 * **谁也不许再导出可变的 `let` 随机源。**
 *
 * ## 诚实的边界（别让人误以为"整局可重放"）
 *
 * **只有引擎侧可复现**：骰子、伤害、失血量、时钟折算由种子决定。
 * **模型输出永远不可复现** —— 同一份输入，模型每次写的故事都可能不同。
 * 用途是：**"给我种子和那几步日志，我能在本地把引擎那一段重放出来"**。
 *
 * ⚠️ 日志只留内存（环形缓冲），**绝不上盘**：它每几秒就变，写进 localStorage
 * 就是又一个"长局变重"的来源。
 */
import { seededRng, type Rng } from '../core/dice/roll.js';

/** 日志保留的调用次数（够看清"出问题那一下"，又不吃内存）。 */
export const RNG_LOG_LIMIT = 200;

/** 一次随机调用。 */
export interface RngCall {
  /** 第几次调用（从 1 开始，按这一局的顺序） */
  n: number;
  /** 归一化取值 `[0, 1)`；乘上骰面数就能还原掷点 */
  value: number;
}

let seed: number | null = null;
let internal: Rng = Math.random;
let callCount = 0;
let log: RngCall[] = [];

/** 每次调用都记一条日志 —— 日志**不参与随机**，所以它不影响掷点结果。 */
function wrap(base: Rng): Rng {
  return () => {
    const value = base();
    callCount += 1;
    log.push({ n: callCount, value });
    if (log.length > RNG_LOG_LIMIT) log.shift();
    return value;
  };
}

/**
 * 重设这一局的随机源。
 *
 * - 给种子 → 用 `seededRng` 派生（**可复现**）。
 * - **不给种子 → 透传 `Math.random`**（不自己造种子）。
 *
 *   为什么透传：既有测试用 `vi.spyOn(Math, 'random')` 固定掷点
 *   （例如"这一掷必须命中"才能验下游掉血闸门）。偷偷换源会让那些 spy 失效、
 *   测试变得不可预测 —— 第一版就是这么把 3 条既有用例搞红的。
 *   **真开一局时由 `startNewGame()` 显式播种**，所以生产路径仍然可复现。
 *
 * 返回实际使用的种子；透传模式返回 `null`（= 这一局没有种子、不可复现）。
 */
export function reseedRun(next?: number): number | null {
  callCount = 0;
  log = [];
  if (next === undefined) {
    seed = null;
    internal = wrap(Math.random);
    return null;
  }
  const s = next >>> 0;
  seed = s;
  internal = wrap(seededRng(s));
  return s;
}

/**
 * **取当前这一局的随机源**。
 *
 * ⚠️ 调用点必须**每次现取**（不要把它存进变量、也不要 import 一个 `let`）——
 * 否则 `reseedRun()` 之后你手里还是旧源。这就是第一版撤回的原因，别再犯。
 */
export function currentRng(): Rng {
  return internal;
}

/** 当前种子；`null` = 这一局没有种子（不可复现，例如单测或未播种）。 */
export function runSeed(): number | null {
  return seed;
}

/** 取一份日志快照（复制，调用方改不到内部状态）。 */
export function rngLog(): RngCall[] {
  return log.map((c) => ({ ...c }));
}

/** 这一局已经调过多少次随机（含已滚出日志窗口的）。 */
export function rngCallCount(): number {
  return callCount;
}
