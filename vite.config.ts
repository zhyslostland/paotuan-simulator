import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { VitePWA } from 'vite-plugin-pwa';

export default defineConfig({
  // 相对路径：同一份 dist/ 可在任意静态托管（GitHub Pages 项目页/用户页、Netlify、Vercel、Cloudflare Pages、拖拽托管）直接跑，无需按平台改 base
  base: './',
  plugins: [
    react(),
    tailwindcss(),
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
