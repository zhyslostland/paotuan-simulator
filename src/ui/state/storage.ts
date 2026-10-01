/**
 * 本地存储的**唯一入口** —— 全 `src/` 里只有这个文件可以直接碰 `localStorage`。
 *
 * ## 为什么要收（2026-09-30 架构体检 §3 · S1）
 *
 * 体检实测：`store.ts` 一个文件里就有 **23 处** `localStorage.setItem` 直接调用，
 * 而 `store.ts:570` 的注释明明白白写着「只有 `saveJson` / `flushSaves` 该调它 ——
 * 别在别处直接 `localStorage.setItem`」。
 *
 * 同一条规矩在别处也写着，实测却散在 **7 个文件 31 处**：
 *
 * ```
 * store.ts 23 · Settings.tsx 6 · App.tsx 5 · preset.ts 2 · loaders.ts 1 · audio.ts 1 · Changelog.tsx 1
 * ```
 *
 * 这就是本项目反复复发的病根的一个标准样本：**规矩写在注释里，编译器看不见。**
 * 于是"唯一写档口"是一句愿望，不是机制 —— 谁顺手写一句 `setItem` 都不会红。
 *
 * ## 这个文件做的事
 *
 * 1. 把读/写/删收成三个函数，**并且是唯一被允许碰 `localStorage` 的地方**；
 * 2. `scripts/check-contract.mjs` 的边界闸门会扫 `src/**`：
 *    除本文件外任何 `localStorage` / `indexedDB` 直接调用 = 构建失败。
 *    要写盘就走这里，**要新开写档口就得先改闸门**（改闸门会留下痕迹，这正是我们要的摩擦）。
 *
 * ## 为什么不用模块级 `const ls = globalThis.localStorage`
 *
 * 单测里 `localStorage` 是**装桩之后**才存在的（`vi.stubGlobal` 在 import 之后跑），
 * 模块加载时就抓一份引用会抓到 `undefined`。所以这里**每次调用都现取**。
 *
 * ## 这里**不做** JSON 序列化
 *
 * `saveJson` 那套（节流 + 结构性立刻落盘）才是状态层的主通道，它自己管序列化。
 * 这个模块只负责"真的把字符串放进浏览器存储"这一层，避免出现第二套序列化口径。
 * 传进来的必须是字符串 —— 传对象会被 `String()` 成 `[object Object]`，
 * 那是**能在开发时就发现的**（值读出来不对），比静默丢字段好。
 */

/** 现取 localStorage；没有（node / SSR / 隐私模式禁掉）就返回 null。 */
function store(): Storage | null {
  try {
    return typeof localStorage === 'undefined' ? null : localStorage;
  } catch {
    // 某些浏览器在"阻止第三方存储"时会**抛异常**而不是返回 undefined
    return null;
  }
}

/** 读一条。没有存储、没有这个键、读失败 → 一律返回 `null`。 */
export function readLocal(key: string): string | null {
  const s = store();
  if (!s) return null;
  try {
    return s.getItem(key);
  } catch {
    return null;
  }
}

/**
 * 写一条（同步、立刻落盘）。
 *
 * ⚠️ 配额超限会**抛异常**，这里吞掉并 `console.warn` ——
 * 与 `store.ts` 原来的 `writeNow` 同一口径：存不下不该把界面搞崩。
 * 但要注意：吞掉之后**调用方看不出失败**，所以大件（图、长局消息）必须走
 * `saveJson` / IndexedDB 那条路，别拿这个函数存图。
 */
export function writeLocal(key: string, value: string): void {
  const s = store();
  if (!s) return;
  try {
    s.setItem(key, value);
  } catch (e) {
    console.warn(`[跑团] 持久化 ${key} 失败（可能超出存储配额）`, e);
  }
}

/** 删一条。没有存储、删失败 → 静默（见下面 catch 里的理由）。 */
export function removeLocal(key: string): void {
  const s = store();
  if (!s) return;
  try {
    s.removeItem(key);
  } catch {
    /* 静默：删不掉不影响玩 —— 顶多是某条旧键留着，下次写盘会覆盖它 */
  }
}
