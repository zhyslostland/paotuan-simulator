import { beforeEach, describe, expect, it } from 'vitest';
import {
  currentRng,
  reseedRun,
  rngCallCount,
  rngLog,
  runSeed,
  RNG_LOG_LIMIT,
} from '../src/ui/runRng.js';

/**
 * 「真机问题可复现」这条线的基础设施。
 *
 * ## 为什么要有它（2026-09-30 · 用户亲报"我那次掷出 96 之后状态就乱了"）
 *
 * 引擎本来就是确定性的（`core/dice/roll.ts` 头部写着"随机数都在这里产生、RNG 可注入"），
 * 但生产侧**一处都没传** `rng` → 全走 `Math.random` → 玩家报的问题永远复现不了。
 *
 * ## ⚠️ 这组用例里最重要的一条是"换源之后必须立刻生效"
 *
 * 第一版实现导出了 `export let runRng`，调用点 `import { runRng }` ——
 * 那是**绑定当时的那个函数**：`reseedRun()` 之后调用点拿到的还是旧源。
 * 后果不只是"复现功能没生效"，还把 `store.test.ts` 搞成**顺序相关**的红。
 * 所以判据里专门钉住：**每次 `currentRng()` 都必须拿到当前那个源**。
 */
describe('运行期随机源：可复现', () => {
  beforeEach(() => {
    reseedRun(12345); // 每条用例都从确定起点开始
  });

  it('同一种子 → 同一串随机数（这才是"可复现"的定义）', () => {
    const a: number[] = [];
    for (let i = 0; i < 5; i += 1) a.push(currentRng()());
    reseedRun(12345);
    const b: number[] = [];
    for (let i = 0; i < 5; i += 1) b.push(currentRng()());
    expect(b).toEqual(a);
  });

  it('不同种子 → 不同序列（否则种子没起作用）', () => {
    const a = [currentRng()(), currentRng()(), currentRng()()];
    reseedRun(999);
    const b = [currentRng()(), currentRng()(), currentRng()()];
    expect(b).not.toEqual(a);
  });

  it('🔴 **换源之后立刻生效**：currentRng() 必须返回当前那个源（第一版就栽在这里）', () => {
    reseedRun(111);
    expect(runSeed()).toBe(111);
    const first = currentRng()();
    reseedRun(111);
    // 换回同一个种子：下一次调用应回到序列开头（若拿的是旧源，这里就会不相等）
    expect(currentRng()()).toBe(first);

    // 换一个种子后，紧接着取到的源必须已经是新的
    reseedRun(222);
    expect(runSeed()).toBe(222);
    const afterSwitch = currentRng()();
    reseedRun(222);
    expect(afterSwitch).toBe(currentRng()());
  });

  it('不给种子 = 透传 Math.random（测试桩仍然能生效）', () => {
    const unseeded = reseedRun();
    expect(unseeded).toBeNull();
    expect(runSeed()).toBeNull();
    // 值仍然落在 [0,1)；并且**不抛**
    const v = currentRng()();
    expect(v).toBeGreaterThanOrEqual(0);
    expect(v).toBeLessThan(1);
  });
});

describe('随机调用日志：出问题那一下要看得见', () => {
  beforeEach(() => {
    reseedRun(7);
  });

  it('每次调用都记一条，序号从 1 连续递增', () => {
    for (let i = 0; i < 4; i += 1) currentRng()();
    const log = rngLog();
    expect(log.map((c) => c.n)).toEqual([1, 2, 3, 4]);
    expect(rngCallCount()).toBe(4);
  });

  it('日志是**复制**出来的（调用方改不到内部状态）', () => {
    currentRng()();
    const a = rngLog();
    a.push({ n: 999, value: 0 });
    a[0]!.value = -1;
    expect(rngLog()).toHaveLength(1);
    expect(rngLog()[0]!.value).toBeGreaterThanOrEqual(0);
  });

  it('环形缓冲：只留最近 N 条，但计数不丢', () => {
    const n = RNG_LOG_LIMIT + 25;
    for (let i = 0; i < n; i += 1) currentRng()();
    const log = rngLog();
    expect(log).toHaveLength(RNG_LOG_LIMIT);
    // 留下的是"最近的"，计数照旧是全量 —— 复现只需要最后那几步
    expect(log[log.length - 1]!.n).toBe(n);
    expect(rngCallCount()).toBe(n);
  });

  it('换一局（reseed）会清空日志与计数 —— 否则日志里混着两局的调用', () => {
    currentRng()();
    currentRng()();
    reseedRun(8);
    expect(rngLog()).toEqual([]);
    expect(rngCallCount()).toBe(0);
  });
});
