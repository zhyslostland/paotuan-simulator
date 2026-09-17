/**
 * 更新清理的**作用域判据** —— 纯函数，单独成文件只为一个理由：**能单测**。
 *
 * 为什么不能留在 `update.ts`：那边 import 了 `vite-plugin-pwa` 的虚拟模块
 * （`virtual:pwa-register`），单测一 import 就抛
 * `The argument 'filename' must be a file URL object...`。
 * 与 `version.ts` 当初把 `compareVersions` / `isNewer` 挪出来的原因完全一样。
 *
 * ## 为什么需要作用域过滤（协作方第 6 版 §2.3）
 * `caches.keys()` 与 `getRegistrations()` 都是**同源全局**的：
 * 原来的 `purgeEverything` 把整个源的缓存与 SW 全清掉。
 * 本项目 base 是 `./`、部署在自己的域名下，现在没问题；
 * 但**同域下万一挂了别的东西**（平台自己的页、以后可能的别的应用），
 * 玩家点一下"强制重载"就把人家清了，属于误伤。
 *
 * 于是加两道过滤：**缓存按名字前缀、SW 按注册文件路径**。
 * 为什么不按 SW 的 scope 过滤：base 是 `./` 时根路径那条 scope 就是整个源，
 * 按 scope 过滤等于没过滤 —— 文件路径才是真正区分"谁注册的"。
 */

/**
 * 本应用自己的缓存名前缀。
 * - `workbox-precache-v2-...` / `workbox-runtime-...`：workbox 默认前缀
 * - `html`：`vite.config.ts` 里导航 `NetworkFirst` 的 `cacheName`
 * - `paotuan`：本项目自定义缓存名的保留前缀（以后加缓存用它开头就自动纳入）
 */
export const OWN_CACHE_PREFIXES = ['workbox', 'html', 'paotuan'] as const;

/** 我们自己注册过的 SW 文件名（`sw-v2.js` 是现名，`sw.js` 是历史名 + 镜像名） */
export const OWN_SW_FILES = ['sw.js', 'sw-v2.js'] as const;
/** 文件名前缀（workbox 自己注册的运行时 SW 带 hash 后缀，不能靠 endsWith） */
export const OWN_SW_PREFIXES = ['workbox-'] as const;

/** 这个缓存名是不是本应用的？ */
export function isOwnCache(name: string): boolean {
  return OWN_CACHE_PREFIXES.some((p) => name.startsWith(p));
}

/**
 * 这个 SW 注册是不是本应用的？（按注册文件路径判，不是 scope —— 见文件头）
 *
 * 两步：先取路径最后一段（文件名），再比固定名与前缀。
 * `workbox-abc123.js` 这种带 hash 的只能用**前缀**匹配文件名。
 */
export function isOwnRegistration(fileUrl: string): boolean {
  if (!fileUrl) return false;
  const base = fileUrl.split('?')[0]!.split('#')[0]!.split('/').pop() ?? '';
  if (!base) return false;
  return (
    OWN_SW_FILES.some((f) => base === f) || OWN_SW_PREFIXES.some((p) => base.startsWith(p))
  );
}
