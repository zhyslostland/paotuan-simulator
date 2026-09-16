import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { VitePWA } from 'vite-plugin-pwa';
import { APP_VERSION } from './src/version.js';

/**
 * 构建号。每次构建都不一样，只用来区分"同一版本下的第几次构建"，
 * 排查"我明明发布了怎么还是旧的"时有用。
 *
 * **版本号是另一回事**：给玩家看的语义化版本在 `src/version.ts`（`APP_VERSION`），
 * 更新检测比对的是它。构建号每次都变，版本号只在"改了东西"时才变。
 *
 * 为什么需要独立探测：Service Worker 的更新检测并不可靠（浏览器什么时候去取新的 sw.js
 * 有它自己的策略，内嵌浏览器、部分手机上更是不一定触发）。于是"我改了、你打开链接还是旧的"
 * 会反复发生。用版本号做**独立于 SW 的一次探测**：应用一启动/回到前台就顺手拉一下 version.json
 * （no-store、带时间戳，绕过所有缓存），对不上就提示更新——比只靠 SW 稳。
 */
const BUILD_ID = `${Date.now().toString(36)}`;

export default defineConfig({
  // 相对路径：同一份 dist/ 可在任意静态托管（GitHub Pages 项目页/用户页、Netlify、Vercel、Cloudflare Pages、拖拽托管）直接跑，无需按平台改 base
  base: './',
  define: {
    __BUILD_ID__: JSON.stringify(BUILD_ID),
  },
  plugins: [
    react(),
    tailwindcss(),
    /**
     * 把版本号写成一个静态文件。
     * 注意它**不在** precache 的 globPatterns 里（那里只有 js/css/html/svg/woff2），
     * 所以不会被 Service Worker 缓存住——否则探测到的永远是旧版本号，这个机制就废了。
     *
     * 同时带上 `version`（语义化）与 `id`（构建号）：前者给玩家与更新检测用，
     * 后者只用于确认"线上跑的是哪一次构建"。
     */
    {
      name: 'emit-version-json',
      apply: 'build',
      generateBundle() {
        this.emitFile({
          type: 'asset',
          fileName: 'version.json',
          source: JSON.stringify({
            version: APP_VERSION,
            id: BUILD_ID,
            at: new Date().toISOString(),
          }),
        });
      },
    },
    VitePWA({
      /*
       * **autoUpdate**：新 SW 一装好就 `skipWaiting()` + `clients.claim()`，立刻接管旧页面。
       *
       * 为什么从 `prompt` 改过来：prompt 模式下新 SW 会**一直等在 waiting 里**，
       * 而这期间旧 SW 继续用它那份旧 precache 响应所有导航 —— 玩家于是永远停在旧包，
       * 只能指望他自己去点横幅。可"点了没反应 / 没看到 / 不知道要点"这三种情况都真实发生过，
       * 已经两次卡住用户。现在改成自动接管：**他只要再打开/刷新一次就是新版**。
       *
       * 玩家侧的"有新版本"横幅与硬重置（`update.ts`）照旧保留 —— 那是另一条独立的路，
       * 负责"探测到线上更新就主动清一次缓存"，两者互不冲突。
       */
      registerType: 'autoUpdate',
      includeAssets: ['icon.svg'],
      manifest: {
        name: '跑团模拟器',
        short_name: '跑团',
        description: 'AI 主持的单人跑团模拟器',
        theme_color: '#0e1014',
        background_color: '#0e1014',
        display: 'standalone',
        start_url: './',
        icons: [
          { src: 'icon.svg', sizes: 'any', type: 'image/svg+xml', purpose: 'any' },
        ],
      },
      workbox: {
        /*
         * **关键：`html` 故意不进 precache。**
         * precache 是 CacheFirst —— index.html 一旦被钉进 precache，
         * 浏览器就会一直拿那份旧的 HTML（它引用的还是旧 hash 的 JS），
         * 于是"我明明发布了，你打开还是旧版"必然复发，只能靠玩家手动点更新。
         * 现在 HTML 改走下面的 NetworkFirst：每次打开先问网络，拿到的是最新 HTML，
         * 它引用的就是最新 JS —— **打开即最新**，不必等人点。
         * 离线时退到 `html` 运行时缓存（在线访问过一次就有），离线能力不丢。
         */
        /*
         * **入口纠正脚本排在 workbox 前面执行**（`importScripts` 会注入到 sw.js 顶部）。
         * 它把 `/index.html` 的导航请求改写成根路径 —— 那条路径上服务器一直给 09-15 的旧包，
         * 而那一版的"立即更新"是坏的。详见 `public/entry-redirect.js` 顶部的说明。
         */
        importScripts: ['entry-redirect.js'],
        globPatterns: ['**/*.{js,css,svg,woff2}'],
        /*
         * **不要设 `navigateFallback`**：workbox 会为它注册一条优先级最高的 NavigationRoute，
         * 用 `createHandlerBoundToURL('index.html')` 去 precache 里找——而 index.html 已经不在
         * precache 里了，那条路由只能失败（导航失败比"用旧版"更糟）。
         * 下面 NetworkFirst 会把成功的导航写进 `html` 运行时缓存，离线时照样有兜底。
         */
        navigateFallback: undefined,
        runtimeCaching: [
          {
            // 导航（打开页面 / 前进后退）→ 网络优先，拿不到再用缓存
            urlPattern: ({ request }: { request: Request }) => request.mode === 'navigate',
            handler: 'NetworkFirst',
            options: {
              cacheName: 'html',
              networkTimeoutSeconds: 4,
              expiration: { maxEntries: 8, maxAgeSeconds: 30 * 24 * 60 * 60 },
            },
          },
          {
            // 版本探测必须走网络，绝不能被任何一层缓存接管
            urlPattern: /version\.json$/,
            handler: 'NetworkOnly',
          },
        ],
      },
    }),
  ],
  server: {
    host: true, // 允许手机通过局域网访问
    // 云端发布走反向代理域名，Vite 默认的 Host 校验会把它挡掉（Blocked request. This host is not allowed.）
    allowedHosts: true,
    port: 5173,
  },
  build: {
    outDir: 'dist',
    target: 'es2022',
  },
  // 云端托管用 `vite preview` 起服务；preview 也要同样的 host 放行，否则点开链接是 403
  preview: {
    host: true,
    allowedHosts: true,
  },
});
