/**
 * 更新检测。
 *
 * ## 为什么不能只靠 Service Worker
 * SW 什么时候去取新的 sw.js 是浏览器说了算：桌面 Chrome 大体可靠，
 * 内嵌浏览器（微信/QQ 里打开）、部分国产手机上经常不触发；
 * 而 index.html 是被 precache 缓存的，于是"我明明改了，你打开还是旧版"会反复发生。
 *
 * ## 做法：两条独立的路
 * 1. **SW 路线**（原有）：`registerSW({ registerType: 'prompt' })` → 检测到新版本发事件 → 弹横幅 → 点一下刷新。
 * 2. **版本号路线**（新增，与 SW 无关）：构建时把 `version.json` 一起发布，
 *    应用启动 / 回到前台 / 每隔几分钟就 `no-store` 拉一次（带时间戳绕缓存）。
 *    拉到的 id 和当前运行的 `__BUILD_ID__` 不一样 → 说明有新版本。
 *
 * 两条路任一命中都会亮出「有新版本」横幅，用户可以立刻更新，也可以去设置里手动点「检查更新」。
 */
import { updateSW } from './pwa.js';
import { APP_VERSION, BUILD_ID as BUILD_ID_RAW, compareVersions } from './version.js';

/** 当前正在运行的这份构建的标识（构建号，排查用） */
export const BUILD_ID: string = BUILD_ID_RAW;

/** 当前运行的应用版本号（`0.1.0`）。玩家在设置里看到、更新检测比对的都是它。 */
export const CURRENT_VERSION: string = APP_VERSION;

export type UpdateCheckResult =
  | 'newer' // 服务器上有更新的版本
  | 'latest' // 已是最新
  | 'unknown'; // 取不到（离线 / 文件不存在 / 老版本还没发布过 version.json）

export { compareVersions };
/** 玩家可读的版本串（`v0.1.0`），UI 上显示当前版本用这个 */
export { versionLabel } from './version.js';

/** 探测一次线上版本。永远不抛异常——探测失败不该打扰玩家。 */
export async function checkForUpdate(): Promise<UpdateCheckResult> {
  if (typeof window === 'undefined') return 'unknown';
  try {
    const url = new URL('version.json', document.baseURI);
    // 时间戳 + no-store：任何一层缓存（HTTP 缓存、SW、中间代理）都不许给我旧答案
    url.searchParams.set('t', Date.now().toString(36));
    const res = await fetch(url.toString(), { cache: 'no-store' });
    if (!res.ok) return 'unknown';
    const data = (await res.json()) as { version?: string; id?: string };
    /*
     * 认 `version`（语义化版本）为主。
     * 老部署只写了 `id`（构建号），那种情况下**无法判断新旧**——
     * 构建号是随机的，比对它只会得出"永远有新版本"的假阳性。
     * 所以老格式一律回 `unknown`（设置里会提示"探测不到版本信息，可强制更新"），
     * 而不是误报有新版本。
     */
    if (!data?.version) return 'unknown';
    const cmp = compareVersions(data.version, CURRENT_VERSION);
    return cmp > 0 ? 'newer' : 'latest';
  } catch {
    return 'unknown';
  }
}

/**
 * 应用更新 —— **硬重置**，不依赖 Service Worker 自己换版本。
 *
 * ## 为什么不能只调 `updateSW(true)` + `reload()`
 * `index.html` 和打包出来的 JS 都在 precache 里（`vite.config.ts` 的 workbox `globPatterns` 含 `html`）。
 * 浏览器没去取新的 `sw.js` 时（内嵌浏览器、部分国产手机很常见），**根本没有 waiting SW**，
 * `updateSW(true)` 无事可做，紧接着的 `reload()` 又落回旧 precache：
 * 新包永远进不来 → `BUILD_ID` 永远是旧的 → `version.json` 永远算"更新" → **弹窗死循环**。
 * 更新日志当然也不变，因为跑的还是旧包。
 *
 * ## 做法：注销 SW + 清 Cache Storage + 带戳导航
 * 强制下一次导航真走网络拿到新 `index.html` 和新包；
 * SW 会在下次加载时由 `main.tsx → ./pwa` 自动重新注册，离线能力自动恢复，代价为零。
 */
export async function applyUpdate(): Promise<void> {
  // 1) 有 waiting SW 就让位（有则更好，没有也不影响下面的兜底）
  try {
    await updateSW(true);
  } catch {
    /* 没有 SW（比如用 file:// 打开）*/
  }

  // 2) 主动拆掉旧 SW 与所有缓存
  try {
    if ('serviceWorker' in navigator) {
      const regs = await navigator.serviceWorker.getRegistrations();
      await Promise.all(regs.map((r) => r.unregister().catch(() => {})));
    }
    if (typeof caches !== 'undefined') {
      const keys = await caches.keys();
      await Promise.all(keys.map((k) => caches.delete(k).catch(() => {})));
    }
  } catch {
    /* 尽力而为，清不掉也要往下刷新 */
  }

  // 3) 带戳导航：连 CDN 边缘缓存一起绕开
  //    用 replace 而非 reload —— reload 正是被旧 SW 接管的那个动作，也是死循环的一半；
  //    replace 还不会在历史里留一条会被"后退"重新触发的记录。
  try {
    const url = new URL(location.href);
    url.searchParams.set('_v', Date.now().toString(36));
    location.replace(url.toString());
  } catch {
    location.reload();
  }
}

/**
 * 定时探测。
 * - 应用回到前台时立刻探一次（手机上最常见的场景：切出去再切回来）
 * - 每隔 `intervalMs` 探一次
 * 返回取消函数。
 */
export function watchForUpdates(
  onFound: () => void,
  intervalMs = 5 * 60 * 1000
): () => void {
  let stopped = false;
  let lastCheck = 0;

  const run = async (force = false) => {
    if (stopped) return;
    const now = Date.now();
    // 回前台会连着触发几次，别把服务器打爆
    if (!force && now - lastCheck < 30_000) return;
    lastCheck = now;
    const r = await checkForUpdate();
    if (r === 'newer') onFound();
  };

  const onVisible = () => {
    if (document.visibilityState === 'visible') void run();
  };

  document.addEventListener('visibilitychange', onVisible);
  const timer = window.setInterval(() => void run(), intervalMs);
  void run(true);

  return () => {
    stopped = true;
    document.removeEventListener('visibilitychange', onVisible);
    window.clearInterval(timer);
  };
}
