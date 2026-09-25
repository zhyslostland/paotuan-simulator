/**
 * 生图角标的渲染冒烟（R40）。
 *
 * ## 为什么单独测它
 * 与设置页 / 准备页同一条理由：角标**平时完全不渲染**（队列空就 `return null`），
 * 而"上线前真渲染验证"抓的是默认页面 —— 它默认状态下永远测不到。
 *
 * ## 一个 SSR 的坑（记下来免得下次再踩）
 * `react-dom/server` 渲染 zustand 时读的是**初始状态**（`getInitialState`），
 * 不是当前状态 —— 所以 `useStore.setState(...)` 之后渲染**看不到效果**。
 * 想在冒烟里喂它一份队列，只能**在 import store 之前放进 localStorage**
 * （队列本来就是从那儿读回来的），再 `vi.resetModules()` 重新加载一次。
 */
import { describe, expect, it, vi } from 'vitest';

class MemStorage {
  private m = new Map<string, string>();
  getItem(k: string) {
    return this.m.has(k) ? this.m.get(k)! : null;
  }
  setItem(k: string, v: string) {
    this.m.set(k, String(v));
  }
  removeItem(k: string) {
    this.m.delete(k);
  }
  clear() {
    this.m.clear();
  }
  get length() {
    return this.m.size;
  }
  key(i: number) {
    return [...this.m.keys()][i] ?? null;
  }
}

const storage = new MemStorage();
vi.stubGlobal('localStorage', storage);
vi.stubGlobal('indexedDB', undefined);
vi.mock('virtual:pwa-register', () => ({ registerSW: () => () => {} }));

const { createElement } = await import('react');
// browser 版：node 版在本机 Node 22 下会因相对路径读自身文件而抛错（见设置页冒烟）
const { renderToString } = await import('react-dom/server.browser');

/** 先在盘上放一份队列，再重新加载 store 与角标，然后把它渲染一遍 */
async function renderWith(jobs: unknown[]): Promise<string> {
  storage.setItem('trpg.imageJobs', JSON.stringify(jobs));
  vi.resetModules();
  const { ImageJobsBadge } = await import('../src/ui/ImageJobsBadge.js');
  return renderToString(createElement(ImageJobsBadge));
}

const job = (over: Record<string, unknown> = {}) => ({
  id: 'j1',
  kind: 'action',
  target: 'm1',
  prompt: 'p',
  label: '第 1 回的分镜',
  status: 'queued',
  at: 1,
  ...over,
});

describe('生图角标能被画出来（冒烟）', () => {
  it('队列空 → 一个节点都不画（平时不占屏幕一角）', async () => {
    const html = await renderWith([]);
    expect(html).not.toContain('<button');
  });

  it('有任务 → 画出角标，标题是人话', async () => {
    const html = await renderWith([job()]);
    expect(html).toContain('<button');
    expect(html).toContain('正在画 1 张');
  });

  it('画失败 → 也画出来（红色角标），标题说明"没画出来"', async () => {
    const html = await renderWith([job({ status: 'failed', error: '生图失败 500' })]);
    expect(html).toContain('1 张没画出来');
    // 失败用血色，跟"正在画"的金色区分开
    expect(html).toContain('blood');
  });

  it('上次关页面时中断的任务：读回来是"可以重试"，不是永远转圈', async () => {
    // 盘上留下的是 `running` —— 进程都没了，必须降级
    const html = await renderWith([job({ status: 'running' })]);
    expect(html).toContain('1 张没画出来');
  });
});
