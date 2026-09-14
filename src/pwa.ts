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

/* ============================================================
 * 「安装到设备」
 *
 * 手机上是重点：装到主屏之后才没有地址栏、能离线开、也不容易被系统清缓存。
 * - Android / 桌面 Chrome 会派发 `beforeinstallprompt`：我们截下来存住，
 *   等用户主动点"安装"时再调 `prompt()`（浏览器要求必须由用户手势触发）。
 * - iOS / Safari 不支持这套 API，只能在界面上给一条文字指引。
 * ============================================================ */
type InstallPromptEvent = Event & {
  prompt: () => Promise<void>;
  userChoice?: Promise<{ outcome: 'accepted' | 'dismissed' }>;
};

let deferred: InstallPromptEvent | null = null;
const listeners = new Set<() => void>();

/** 在应用启动时调用一次 */
export function initInstallPrompt(): void {
  if (typeof window === 'undefined') return;
  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();
    deferred = e as InstallPromptEvent;
    listeners.forEach((l) => l());
  });
  window.addEventListener('appinstalled', () => {
    deferred = null;
    listeners.forEach((l) => l());
  });
}

/** 是否已经以"独立应用"的方式在跑（装过或从主屏打开） */
export function isStandalone(): boolean {
  if (typeof window === 'undefined') return false;
  const nav = window.navigator as Navigator & { standalone?: boolean };
  return (
    window.matchMedia?.('(display-mode: standalone)').matches === true || nav.standalone === true
  );
}

/** 当前能不能弹出系统安装提示（iOS 上永远是 false，要走文字指引） */
export function canInstall(): boolean {
  return Boolean(deferred) && !isStandalone();
}

/** 订阅"安装可用性"变化，返回取消订阅函数 */
export function onInstallAvailable(fn: () => void): () => void {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
}

/** 弹出系统安装提示；返回是否真的弹了 */
export async function promptInstall(): Promise<boolean> {
  if (!deferred) return false;
  const evt = deferred;
  try {
    await evt.prompt();
    await evt.userChoice;
  } catch {
    /* 用户取消或浏览器拒绝：不算错误 */
  }
  deferred = null;
  listeners.forEach((l) => l());
  return true;
}

