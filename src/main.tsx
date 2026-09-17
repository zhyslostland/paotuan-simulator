import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './ui/App';
import './ui/theme.css';
import './pwa';
import { ErrorBoundary } from './ui/ErrorBoundary';
import { initUpdateSelfHeal, cleanStampFromUrl } from './update.js';

/*
 * ============================================================
 * 入口自愈：把从 `/index.html` 进来的玩家挪到根路径
 *
 * 起因（2026-09-16 实测）：线上 `/index.html` 与 `/` 是**两条独立缓存**，
 * 平台每次部署只刷新了 `/`；`/index.html` 那条长期残留着 09-15 的旧包，
 * 而那个版本的「有新版本」横幅点了没有用（它的更新逻辑还处在 `reload()` 死循环形态）。
 * 玩家一旦从那条路进来，**怎么刷新都出不去** —— 这就是"更新问题"反复复发的真身。
 *
 * 这里在渲染之前就把 URL 归一化到根路径，别再让任何人从那扇旧门进来。
 * 保留原有的查询串（带戳的那些要留着，它们正是绕过缓存用的）。
 * ============================================================
 */
const fromLegacyPath = /\/index\.html$/.test(window.location.pathname);

if (fromLegacyPath) {
  window.location.replace(`${window.location.origin}/${window.location.search}`);
} else {
  // SW 换了主人时带戳重来一次（配合 autoUpdate：卡在旧包的玩家打开即被带到新版）
  initUpdateSelfHeal();

  /*
   * 抹掉地址栏上的 `_v=` / `t=` 戳：那是绕缓存用的，任务已完成，
   * 留着会让玩家存的书签、转发的链接带一串时间戳（见 update.ts 的说明）。
   */
  cleanStampFromUrl();

  /*
   * 套一层错误边界：界面里任何一处渲染抛错，都显示成一句人话 + 重载按钮，
   * **不再变成整页空白**（2026-09-17 图鉴那次无限重渲染就害得 PC 全白、
   * 手机卡在自动更新里，玩家连"是什么错了"都看不到）。
   */
  createRoot(document.getElementById('root')!).render(
    <StrictMode>
      <ErrorBoundary>
        <App />
      </ErrorBoundary>
    </StrictMode>
  );
}
