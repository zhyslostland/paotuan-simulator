import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { VitePWA } from 'vite-plugin-pwa';

/**
 * 构建标识。每次构建都不一样，随应用一起发布，也写进 dist/version.json。
 *
 * 为什么需要它：Service Worker 的更新检测并不可靠（浏览器什么时候去取新的 sw.js 有它自己的策略，
 * 内嵌浏览器、部分手机上更是不一定触发）。于是"我改了、你打开链接还是旧的"会反复发生。
 * 用这个版本号做**独立于 SW 的一次探测**：应用一启动/回到前台就顺手拉一下 version.json
 * （no-store、带时间戳，绕过所有缓存），对不上就提示刷新——比只靠 SW 稳。
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
     */
    {
      name: 'emit-version-json',
      apply: 'build',
      generateBundle() {
        this.emitFile({
          type: 'asset',
          fileName: 'version.json',
          source: JSON.stringify({ id: BUILD_ID, at: new Date().toISOString() }),
        });
      },
    },
    VitePWA({
      // prompt：检测到新版本时提示用户点一下"更新"，而不是静默等下次打开才生效
      registerType: 'prompt',
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
        globPatterns: ['**/*.{js,css,html,svg,woff2}'],
        // 版本探测必须走网络，绝不能被缓存接管
        navigateFallbackDenylist: [/version\.json$/],
      },
    }),
  ],
  server: {
    host: true, // 允许手机通过局域网访问
    port: 5173,
  },
  build: {
    outDir: 'dist',
    target: 'es2022',
  },
});
