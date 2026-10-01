/**
 * 主要界面的渲染冒烟 —— **"它能不能被画出来而不抛异常"**。
 *
 * ## 为什么值得单独一个文件
 * 上线前那套"真渲染验证"（无头 Chrome `--dump-dom`）抓的只是**默认首页**。
 * v0.3.0 白屏那次就是：首页在别的构建里看着正常，一进图鉴就整页空白。
 * 门禁全绿 + 首页能开 ≠ 每个界面都能开。
 *
 * ## 为什么覆盖面这么窄（2026-09-19 定的口径）
 * 只挑「**打开就会挂、且 mock 成本低**」的：这些组件都从 store 读状态、props 都是回调。
 * `App.tsx` 要 mock 流式与 PWA、`Preparation.tsx` 要 mock 生图，性价比差，先不碰。
 *
 * 判据只有两条：**不抛异常** + **画出了内容**（`> 800` 字符）。
 * 不断言具体文案 —— 那是组件测试的事，这里只管"能不能打开"。
 * 不写快照：一改文案就红，审 diff 比手写断言还贵。
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';


vi.mock('virtual:pwa-register', () => ({ registerSW: () => () => {} }));

const { createElement } = await import('react');
const { renderToString } = await import('react-dom/server.browser');

const { useStore } = await import('../src/ui/store.js');
const { CharacterSheet } = await import('../src/ui/CharacterSheet.js');
const { Chat } = await import('../src/ui/Chat.js');
const { EndingScreen } = await import('../src/ui/EndingScreen.js');
const { WorldPanel } = await import('../src/ui/WorldPanel.js');

const noop = () => {};

describe('主要界面能被画出来（冒烟）', () => {
  beforeEach(() => {
    // 每个用例都从"刚开团"的状态开始，避免互相影响
    useStore.setState({ messages: [], streaming: false });
  });

  it('角色卡能画出来（概况 / 技能 / 背包 三块一次全展开）', () => {
    const html = renderToString(
      createElement(CharacterSheet, { onRequestCheck: noop, onPromptUse: noop })
    );
    expect(html.length).toBeGreaterThan(800);
    /*
     * 2026-09-26 主人拍板**去掉三页签、全部展开** —— 所以现在三块是**同时**渲染的。
     * 这条按"三块的内容都在"来断言（换了结构会红，是提醒不是噪音）。
     * ⚠️ 「概况」不再是按钮文案，改成断言技能/背包两个**区块标题**。
     */
    expect(html).toContain('技能');
    expect(html).toContain('背包');
  });

  const chatProps = {
    onSend: noop,
    onAbort: noop,
    draft: '',
    setDraft: noop,
    onRewind: noop,
    onReroll: noop,
    onQuickCheck: noop,
    onRollAll: noop,
    ended: false,
    focusSignal: 0,
  };

  it('对话区能画出来（输入框与发送入口都在）', () => {
    const html = renderToString(createElement(Chat, chatProps));
    expect(html.length).toBeGreaterThan(800);
  });

  /*
   * ⚠️ H2（流式期间检定卡**留着**、只是置灰）**没法制成这里的断言**，原因值得记住：
   *
   *   zustand v5 的 SSR 快照取的是 `getInitialState()`（见 `node_modules/zustand/react.js`
   *   第 11 行），而 `renderToString` 走的就是服务端那条路 —— 也就是说
   *   **`useStore.setState(...)` 在 SSR 冒烟里根本看不见**（2026-09-20 实测，
   *   我为这条写的断言红了，第一反应以为是代码错，其实是测法无效）。
   *
   * 所以：SSR 冒烟只能守"**初始态**"，凡是靠 store 状态切换才出现的界面
   * （H2 的置灰态、流式中的提示、结档后的禁令）都得靠**真浏览器**验证。
   * H2 的真渲染验证记录在当天部署验收里（`Chat.tsx` 的 `pendingChecks.length > 0 &&` 那条）。
   */

  it('P3-4：结档之后输入框禁用，并把"为什么发不出去"写在占位里', () => {
    const html = renderToString(createElement(Chat, { ...chatProps, ended: true }));
    // 占位文案是单个属性值，SSR 不会插入 <!-- -->，可以整句比对
    expect(html).toContain('这一局已经结档');
  });

  it('结档页：没有结局时什么都不画，且不抛异常', () => {
    /*
     * ⚠️ 这一条只能测"空态"：`renderToString` 是 SSR，而 zustand 的 `useStore`
     * 在服务端快照上取的是 **`getInitialState()`** —— 测试里 `setState` 塞的
     * "假装已经结档"它根本看不到。有结局那一支要真跑起来才验得了（本地/线上点开就行）。
     * 这里钉住的是另一半：**跑了一半时它必须安静地不画，而不是炸**。
     */
    const html = renderToString(
      createElement(EndingScreen, { onClose: noop, onRewind: noop, onNewGame: noop })
    );
    expect(html).toBe('');
  });

  /*
   * 世界面板（第 11 版说"余下下一批"，全盘彻查阶段 4 补上）。
   * 三个回调在阶段 1 已改**必传** —— 这里漏传一个，类型就红，等于顺手钉住了调用点。
   */
  it('世界面板能画出来（目标 / 地图 / 关键抉择三块都在）', () => {
    const html = renderToString(
      createElement(WorldPanel, {
        onPromptCompanion: noop,
        onTravel: noop,
        onRewind: noop,
      })
    );
    expect(html.length).toBeGreaterThan(800);
    expect(html).toContain('关键抉择');
  });
});
