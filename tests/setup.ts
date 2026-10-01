/**
 * 测试公共环境 —— vitest `setupFiles` 入口（在**每个测试文件 import 之前**执行）。
 *
 * ## 为什么必须在这里装 localStorage
 *
 * `ui/store.ts`、`ui/state/loaders.ts` 在**模块加载时**就会读盘（`loadCharacter()` 等）。
 * 所以桩必须在"测试文件 import store"之前就位 —— 这正是 `setupFiles` 的时机。
 * 以前 9 个测试文件各自复制一份 `MemStorage` + `vi.stubGlobal`，
 * 结果是：新增测试要抄 25 行桩；桩与桩之间一旦不一致，就会出现"本地绿、CI 红"这类假绿。
 *
 * ## 用法
 *
 * 不需要做任何事：`npm test` 自动带上。要**清空**存储（模拟全新玩家）就调 `resetStorage()`。
 * 需要**独立实例**（例如测"跨实例读不到"）时，自己 `vi.stubGlobal('localStorage', new MemStorage())`，
 * 用完 `resetStorage()` 恢复 —— 不要在文件里再复制一份类。
 */
import { vi } from 'vitest';

/** 内存版 Storage：够用即可（`store.ts` 只用 get/set/remove/clear/key/length）。 */
export class MemStorage implements Storage {
  private m = new Map<string, string>();

  get length(): number {
    return this.m.size;
  }

  clear(): void {
    this.m.clear();
  }

  getItem(key: string): string | null {
    return this.m.has(key) ? this.m.get(key)! : null;
  }

  key(index: number): string | null {
    return [...this.m.keys()][index] ?? null;
  }

  removeItem(key: string): void {
    this.m.delete(key);
  }

  setItem(key: string, value: string): void {
    this.m.set(key, String(value));
  }
}

/** 当前这份内存存储（`resetStorage()` 会换一个新的）。 */
let current = new MemStorage();

// 在测试文件 import 之前就把桩装好。
vi.stubGlobal('localStorage', current);
/*
 * `indexedDB` 在 node 里不存在，而 store 的图片链路会碰它。
 * 8 个测试文件原来各自写了这一行，现在收在这里。
 * 需要"能用的假 IndexedDB"的用例，自己再 `vi.stubGlobal('indexedDB', ...)` 覆盖。
 */
vi.stubGlobal('indexedDB', undefined);

/** 清空存储内容（同一个实例）。 */
export function clearStorage(): void {
  current.clear();
}

/**
 * 换一份**全新**的存储实例（比 `clear()` 更彻底：连"谁建的实例"都换掉），
 * 用于需要"全新玩家"语义的用例。
 */
export function resetStorage(): MemStorage {
  current = new MemStorage();
  vi.stubGlobal('localStorage', current);
  return current;
}
