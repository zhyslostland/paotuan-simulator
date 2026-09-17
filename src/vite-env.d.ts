/// <reference types="vite-plugin-pwa/client" />

/**
 * 构建标识，由 vite.config.ts 的 `define` 注入（见 src/update.ts）。
 * 每次构建都不同，用来判断"浏览器里跑的这份是不是最新的"。
 */
declare const __BUILD_ID__: string;

/**
 * 本次构建的时间（ISO 串），同样由 vite.config.ts 的 `define` 注入。
 * 与 `version.json` 的 `at` 同源，`isNewer` 用它比较新鲜度（不依赖构建号的字符串长度）。
 */
declare const __BUILD_AT__: string;
