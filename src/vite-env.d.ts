/// <reference types="vite-plugin-pwa/client" />

/**
 * 构建标识，由 vite.config.ts 的 `define` 注入（见 src/update.ts）。
 * 每次构建都不同，用来判断"浏览器里跑的这份是不是最新的"。
 */
declare const __BUILD_ID__: string;
