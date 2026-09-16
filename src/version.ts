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
export const APP_VERSION = '0.1.0';

/**
 * 构建号（构建时由 vite 注入的那串时间戳）。
 * 它**不是**给玩家看的版本号，只用来区分"同一个 APP_VERSION 下的第几次构建"，
 * 排查"我明明发布了怎么还是旧的"时有用。
 */
export const BUILD_ID: string =
  typeof __BUILD_ID__ === 'string' ? __BUILD_ID__ : 'dev';

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
