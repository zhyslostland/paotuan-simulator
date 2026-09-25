/**
 * 带戳导航 —— **所有"重新载入"都必须走这里，不许 `location.reload()`**。
 *
 * ## 为什么要单独一个文件
 * 它要被界面层（`ErrorBoundary` / `Settings`）直接调用，而 `update.ts` 导了
 * `virtual:pwa-register`（**测试里一 import 就炸**）。把这十行抽出来，界面就不必碰那条边。
 *
 * ## 为什么不能 `location.reload()`
 * `reload()` 会被**旧 Service Worker 接管** —— 你以为在刷新，拿到的还是缓存里那个旧包，
 * 于是"崩了 → 点重新载入 → 还是崩"的死循环。2026-09-19 之前 `ErrorBoundary` 的
 * 「重新载入」按钮正是这么写的：白屏时玩家按的偏偏就是它。
 *
 * ## 两件事一起做
 * 1. **加 `_v` 时间戳**：连 CDN 边缘缓存一起绕开（平台 CDN 不看 Last-Modified）。
 * 2. **把 pathname 归一化到根**：线上 `/index.html` 与 `/` 是**两条独立缓存**，
 *    平台每次部署只刷 `/`，`/index.html` 那条长期残留着很早的旧包。
 *    从那条路进来的玩家必须被挪走，否则怎么刷新都是旧的。
 *
 * 用 `replace` 而不是 `assign`：不会在历史里留下"后退又触发一次"的记录。
 */
export function navigateFresh(): void {
  try {
    const url = new URL(location.href);
    url.pathname = url.pathname.replace(/\/index\.html$/, '/');
    url.searchParams.set('_v', Date.now().toString(36));
    location.replace(url.toString());
  } catch {
    location.reload();
  }
}
