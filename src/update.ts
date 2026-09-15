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

/** 当前正在运行的这份构建的标识 */
export const BUILD_ID: string =
  typeof __BUILD_ID__ === 'string' ? __BUILD_ID__ : 'dev';

export type UpdateCheckResult =
  | 'newer' // 服务器上有更新的版本
  | 'latest' // 已是最新
  | 'unknown'; // 取不到（离线 / 文件不存在 / 老版本还没发布过 version.json）

/** 探测一次线上版本。永远不抛异常——探测失败不该打扰玩家。 */
export async function checkForUpdate(): Promise<UpdateCheckResult> {
  if (typeof window === 'undefined') return 'unknown';
  try {
    const url = new URL('version.json', document.baseURI);
    // 时间戳 + no-store：任何一层缓存（HTTP 缓存、SW、中间代理）都不许给我旧答案
    url.searchParams.set('t', Date.now().toString(36));
    const res = await fetch(url.toString(), { cache: 'no-store' });
    if (!res.ok) return 'unknown';
    const data = (await res.json()) as { id?: string };
    if (!data?.id) return 'unknown';
    // 上一次发布的版本还没带 version.json（老客户端）→ 也算"不是最新"
    return data.id === BUILD_ID ? 'latest' : 'newer';
  } catch {
    return 'unknown';
  }
}

/**
 * 应用更新。
 * 先让 Service Worker 接管新版本（`updateSW(true)` = skipWaiting + 重新加载），
 * 拿不到 SW 就退回一次普通刷新。
 */
export async function applyUpdate(): Promise<void> {
  try {
    await updateSW(true);
  } catch {
    /* 没有 SW（比如用 file:// 打开）时下面的刷新兜底 */
  }
  // updateSW 正常会自己刷新；万一没刷（或没有 SW），这里补救一次
  window.setTimeout(() => {
    location.reload();
  }, 800);
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
