/**
 * PWA 注册：用「prompt」模式，检测到新版本时发事件给 App，
 * App 弹一条"有新版本"横幅，用户点一下就刷新并激活新版本。
 * 否则用户会一直卡在旧版本里（就是"找不到新功能"的元凶）。
 */
import { registerSW } from 'virtual:pwa-register';

export const updateSW = registerSW({
  onNeedRefresh() {
    window.dispatchEvent(new Event('trpg:update-ready'));
  },
  onOfflineReady() {
    window.dispatchEvent(new Event('trpg:offline-ready'));
  },
});
