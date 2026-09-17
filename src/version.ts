/**
 * 版本号 —— 全项目**唯一**的版本真源。
 *
 * ## 为什么要有这个文件
 * 以前有三套"版本"各说各话：
 * 1. `vite.config.ts` 的 `BUILD_ID` = 构建时间戳（`mu3m5cif` 这种），只管"两次构建是不是同一份"；
 * 2. `Changelog.tsx` 的 `id` = `2026-09-15d` 日期串，只管"这页日志读没读过"；
 * 3. 玩家在设置里看到的"当前版本"是第一套 —— 一串乱码，看不出新旧、也看不出改了什么。
 *
 * 现在统一成**语义化版本**（`主.次.修订`），三处共用：
 * - 设置里显示 `v0.1.0`，一眼知道新旧；
 * - 更新检测比对的就是它（`version.json` 里的 `version`）；
 * - 更新日志按它归档（`0.1.0` 这一个版本对应一段条目）。
 *
 * ## 数字怎么走
 * - **修订**（第三位）：修 bug、调文案、改体验 → `0.1.0` → `0.1.1`
 * - **次版本**（第二位）：加功能、加内置内容（新题材 / 新规则包 / 新面板）→ `0.1.x` → `0.2.0`
 * - **主版本**（第一位）：存档结构不兼容、玩法大改（需要玩家重新开团的级别）→ `1.0.0`
 *
 * ## 发版时要做的事（只有两步，别漏）
 * 1. 改下面 `APP_VERSION`
 * 2. 在 `src/ui/Changelog.tsx` 最前面加一段同 `version` 的条目
 */

/** 当前版本。改动玩家能感知的东西就往上走一位。 */
export const APP_VERSION = '0.5.0';

/**
 * 构建号（构建时由 vite 注入的那串时间戳）。
 * 它**不是**给玩家看的版本号，只用来区分"同一个 APP_VERSION 下的第几次构建"，
 * 排查"我明明发布了怎么还是旧的"时有用。
 */
export const BUILD_ID: string =
  typeof __BUILD_ID__ === 'string' ? __BUILD_ID__ : 'dev';

/**
 * 这次构建的时间（ISO 串，构建时注入）。
 * 与 `version.json` 里的 `at` 同源，用于**不依赖字符串长度假设**地比较新鲜度（见 `isNewer`）。
 */
export const BUILD_AT: string =
  typeof __BUILD_AT__ === 'string' ? __BUILD_AT__ : '';

/** 完整版本串，如 `v0.1.0`；开发环境下会带上构建号后缀便于自查 */
export function versionLabel(): string {
  return BUILD_ID === 'dev' ? `v${APP_VERSION} (dev)` : `v${APP_VERSION}`;
}

/**
 * 比较两个语义化版本号。`a > b` 返回正数，`a < b` 返回负数，相等返回 0。
 * 只解析前三段数字，预发布后缀（`-beta` 之类）不参与比较——本项目不用那个。
 *
 * 放在这里而不是 `update.ts`：那边依赖 PWA 的虚拟模块，纯函数放这儿才能单测。
 */
export function compareVersions(a: string, b: string): number {
  const parse = (v: string) =>
    v
      .replace(/^v/, '')
      .split('.')
      .map((s) => Number.parseInt(s, 10) || 0);
  const [a1 = 0, a2 = 0, a3 = 0] = parse(a);
  const [b1 = 0, b2 = 0, b3 = 0] = parse(b);
  return a1 - b1 || a2 - b2 || a3 - b3;
}

/**
 * 判断线上那份是不是比当前这份新 —— 更新检测的核心判据。
 *
 * ## 为什么两个都要看（协作方 P0-1 抓到的口径漏洞）
 * - 只比**语义化版本**会漏：发布时忘了改 `APP_VERSION`，版本没变 → **永远不提示更新**，
 *   "我改了你还是旧的"原样复发。
 * - 只比**构建号**又分不出方向（不知道是线上新还是我新）。
 *
 * 所以：**先比版本定方向，版本相同再看新鲜度**。
 *
 * ## 新鲜度怎么比：优先时间戳，退回构建号（协作方第 6 版 §2.4）
 * 构建号是 `Date.now().toString(36)`，靠"同长度 base36 的字典序 = 时间序"来比 ——
 * 这个假设**哪年长度进位就失效**（8 位 → 9 位时字符串比较会得到错误结论）。
 * `version.json` 已经带了 `at`（ISO 时间），所以改成：
 * **① 线上有 `at` → 直接比时间戳；② 没有 `at`（老部署）→ 退回字符串比较 `id`，保持兼容。**
 * 这同时让"忘了改版本号"的场景更稳。
 *
 * ## 规矩
 * **发版要改 `APP_VERSION`**（那样更新日志才有新条目）；
 * 但即使忘了，构建号/时间戳兜底也会照样提示更新，不会静默漏掉。
 *
 * 放在这里而不是 `update.ts`：那边依赖 PWA 的虚拟模块，纯函数放这儿才能单测。
 */
export function isNewer(
  online: { version?: string; id?: string; at?: string },
  currentVersion = APP_VERSION,
  currentBuild = BUILD_ID,
  currentAt = BUILD_AT
): 'newer' | 'latest' | 'unknown' {
  // 版本号变大 → 一定有新东西
  if (online.version) {
    const cmp = compareVersions(online.version, currentVersion);
    if (cmp > 0) return 'newer';
    // 线上版本更旧（回滚 / 玩家在更新前的构建上）→ 不打扰
    if (cmp < 0) return 'latest';
  }

  // ---- 版本相同（或线上没给版本号）：比新鲜度 ----

  /*
   * ① 有明确的时间戳就比时间戳 —— 不依赖任何字符串长度假设。
   * 线上时间新于本地构建时间 → 有新东西。
   */
  const onlineMs = parseTime(online.at);
  const currentMs = parseTime(currentAt);
  if (onlineMs !== null && currentMs !== null) {
    return onlineMs > currentMs ? 'newer' : 'latest';
  }

  /*
   * ② 退回构建号字符串比较（老部署没有 `at`）。
   * 开发环境（BUILD_ID === 'dev'）没有真实构建号可比；
   * 这时又没时间戳，只能认"判断不了"——比误报成有新版本好。
   */
  if (online.id && currentBuild !== 'dev') {
    return online.id > currentBuild ? 'newer' : 'latest';
  }
  return online.version ? 'latest' : 'unknown';
}

/** 解析 ISO 时间串；解析不出来返回 null（不抛异常——探测链路上不许炸） */
function parseTime(v: string | undefined): number | null {
  if (!v) return null;
  const t = Date.parse(v);
  return Number.isFinite(t) ? t : null;
}
