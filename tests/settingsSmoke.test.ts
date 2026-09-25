/**
 * 设置页的渲染冒烟（G6）。
 *
 * ## 为什么要单独测它
 * 设置是个**弹层**，而"上线前真渲染验证"（无头 Chrome `--dump-dom`）抓的是默认页面
 * —— 设置页崩了它一点都看不出来（这正是 0.3.0 白屏那次学到的：
 * **门禁全绿 + 首页正常 ≠ 每个界面都能开**）。
 *
 * 这里用 `react-dom/server` 把它**真渲染一遍**：不用 jsdom、不装额外依赖，
 * 只回答一个问题 —— **它能不能被画出来而不抛异常**。
 * （`react-dom/server` 不跑 `useEffect`，所以这一条管不到副作用，
 *  但足以拦住"选择器写错 / JSX 不平衡 / 组件里直接炸"这类会让整页空白的错。）
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

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

vi.stubGlobal('localStorage', new MemStorage());
vi.stubGlobal('indexedDB', undefined);

/*
 * `Settings.tsx` → `update.js` → `pwa.ts` → **`virtual:pwa-register`**。
 * 那个虚拟模块由 `vite-plugin-pwa` 在构建时注入，node 测试里没有 →
 * 直接 import 会炸（这条规矩本来就记在 `purgeScope.ts` 的注释里）。
 * 这里把它挡掉：我们只关心"组件能不能画出来"，不关心 SW 注册。
 */
vi.mock('virtual:pwa-register', () => ({
  registerSW: () => () => {},
}));

const { createElement } = await import('react');
/*
 * 用 `react-dom/server.browser` 而不是 `react-dom/server`：
 * 后者在这个 Node 环境下会走 `.node` 那份构建，内部按**相对路径**去读自己的文件，
 * Node 22 会直接抛 "The argument 'filename' must be … absolute path string"。
 * 浏览器版是纯 JS、不碰文件系统，正好够做"能不能画出来"这一条。
 */
const { renderToString } = await import('react-dom/server.browser');
const { Settings } = await import('../src/ui/Settings.js');

describe('设置页能被画出来（冒烟）', () => {
  beforeEach(() => {
    // 什么都不用重置：每次 renderToString 都是全新一遍
  });

  it('渲染不抛异常，并且真的画出了内容', () => {
    const html = renderToString(createElement(Settings, { onClose: () => {} }));
    expect(html.length).toBeGreaterThan(1000);
  });

  it('九个小节标题都在（折叠只影响展开与否，标题必须在）', () => {
    const html = renderToString(createElement(Settings, { onClose: () => {} }));
    for (const t of [
      '生涯与成就',
      '规则与题材',
      '外观与排版',
      '音频',
      '模型与接口',
      '数据与存档',
      '安装到设备',
      '自动配图（带图战报）',
      '开发者',
      '快捷键',
    ]) {
      expect(html).toContain(t);
    }
  });

  /*
   * 生涯 / 成就这一块以前**只活在结档页** —— 不跑完一局就永远看不到，
   * 而它记的恰恰是跨所有局的那本账。这条断言钉住它现在的常驻位置，
   * 免得哪天有人把它挪回结档页，又变回"做了但玩家看不见"。
   */
  it('生涯与成就默认可见（第 0 条铁律：玩家看不见＝没做）', () => {
    const html = renderToString(createElement(Settings, { onClose: () => {} }));
    // 标题在目录里也会出现，**统计格里的内容**才证明这一节真的画出来了
    expect(html).toContain('生涯与成就');
    expect(html).toContain('跑过的局');
    expect(html).toContain('累计回数');
    // 空态也要有话说：一次都没跑过的玩家看到的是"为什么还没有"，而不是一片空白
    expect(html).toContain('还没有解锁的成就');
  });

  /*
   * H18（协作方第 23 版）：**JSX 不解析 Markdown**。
   * 生图说明里那句「会 **静默失败**」写成了 Markdown 的加粗，
   * 结果界面上原样显示两对星号 —— 看着像乱码。
   * 判据就是：渲染出来的 HTML 里不许再有字面的 `**`。
   */
  it('H18：渲染结果里没有字面的 Markdown 星号', () => {
    const html = renderToString(createElement(Settings, { onClose: () => {} }));
    expect(html).not.toContain('**');
    // 那句提醒**本身**还要在（星号去掉了，字不能一起没了）
    expect(html).toContain('静默失败');
  });

  it('搜索框在（G6 的入口）', () => {
    const html = renderToString(createElement(Settings, { onClose: () => {} }));
    expect(html).toContain('找设置项');
  });

  it('目录里的分组与页面上的分组对得上（点一下不会跳空）', () => {
    const html = renderToString(createElement(Settings, { onClose: () => {} }));
    // 每个目录 id 都要在页面里真实存在
    for (const id of [
      'sec-career',
      'sec-rules',
      'sec-look',
      'sec-audio',
      'sec-api',
      'sec-data',
      'sec-install',
      'sec-illustrate',
      'sec-dev',
      'sec-keys',
    ]) {
      expect(html).toContain(`id="${id}"`);
    }
  });
});
