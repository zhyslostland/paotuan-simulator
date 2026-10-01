/**
 * 前期准备（弹层）的渲染冒烟 —— 尤其是新的「世界」那一页（Phase 2）。
 *
 * ## 为什么要单独测它
 * 与 `settingsSmoke.test.ts` 同一条理由：准备页是**弹层**，
 * "上线前真渲染验证"（无头 Chrome `--dump-dom`）抓的是默认页面，
 * 弹层崩了它一点都看不出来 —— 这正是 0.3.0 白屏学到的：
 * **门禁全绿 + 首页正常 ≠ 每个界面都能开**。
 *
 * 这里用 `react-dom/server` 把它**真渲染一遍**（不跑 useEffect，但足以拦住
 * "选择器写错 / JSX 不平衡 / 组件里直接炸"这类会让整页空白的错）。
 */
import { describe, expect, it, vi } from 'vitest';



// 与设置页同一条：图里可能有 `virtual:pwa-register`，node 测试里挡掉
vi.mock('virtual:pwa-register', () => ({
  registerSW: () => () => {},
}));

const { createElement } = await import('react');
// 用 browser 版：node 版在本机 Node 22 下会因相对路径读自身文件而抛错（见设置页冒烟）
const { renderToString } = await import('react-dom/server.browser');
const { Preparation, modulePackPartialNote, modulePackStoppedNote } = await import(
  '../src/ui/Preparation.js'
);

const noop = () => {};

describe('准备页能被画出来（冒烟）', () => {
  it('默认页签渲染不抛异常，且真的画出了内容', () => {
    const html = renderToString(createElement(Preparation, { onClose: noop, onStartNew: noop }));
    expect(html.length).toBeGreaterThan(1000);
  });

  it('五个页签都在（含新增的「世界」）', () => {
    const html = renderToString(createElement(Preparation, { onClose: noop, onStartNew: noop }));
    for (const t of ['模组', '角色卡', '同行者', '世界书', '世界']) {
      expect(html).toContain(t);
    }
  });

  it('「世界」那一页能画出来，且三块内容都在', () => {
    const html = renderToString(
      createElement(Preparation, { onClose: noop, onStartNew: noop, initialTab: 'world' })
    );
    // 世界名 / 接着上一次跑 / 角色档案库 —— 少一块都说明这一页写坏了
    expect(html).toContain('这一局的世界');
    expect(html).toContain('接着上一次跑');
    expect(html).toContain('角色档案库');
  });

  it('没有留档时给的是"还没有留档"，不是一堆空行', () => {
    const html = renderToString(
      createElement(Preparation, { onClose: noop, onStartNew: noop, initialTab: 'world' })
    );
    expect(html).toContain('还没有留档');
  });

  /*
   * 下面两条对应 2026-09-17 的三处新界面。
   *
   * 为什么要单测：它们都在**弹层里的非默认页签**上，
   * `--dump-dom` 抓不到（那正是 0.3.0 白屏的教训——
   * "门禁全绿 + 首页正常"不等于每个界面都能开）。
   */
  it('角色卡页显示属性点预算（用户报「属性上限/总额设定」）', () => {
    const html = renderToString(
      createElement(Preparation, { onClose: noop, onStartNew: noop, initialTab: 'character' })
    );
    // COC 的口径：八项共 460
    expect(html).toContain('总计');
    expect(html).toContain('460');
  });

  it('模组页有「一键生成两张表」按钮（用户报"需要手动生成"）', () => {
    const html = renderToString(
      createElement(Preparation, { onClose: noop, onStartNew: noop, initialTab: 'module' })
    );
    expect(html).toContain('一键生成两张表');
    // 单独的两个按钮要留着（一键失败时可以单独重试那一张）
    expect(html).toContain('生成敌对者');
    expect(html).toContain('生成道具表');
  });

  /*
   * ⚠️ 这一条是踩过坑才补的，别删。
   *
   * 上面那条测试**曾经是绿的假象**吗？不是 —— 但它一开始是红的，根因很值钱：
   * 生成按钮原先写在 `{revealed && ( … )}` 里面（`revealed` 默认 false），
   * 于是**玩家不点「显示剧透」根本看不见按钮** —— 功能等于不存在。
   * 换句话说"生成了两张表的功能"写完了，用户还是得手动。
   *
   * 所以这里断言的是**遮罩外面也看得见**：`revealed` 默认关，
   * 渲染出来必须同时有「显示剧透」和三个生成按钮 —— 两者共存才算对。
   *
   * （裸 `indexOf` 判存在性，别用 `toContain('一键生成两张表')` 之外的拼接串，
   *   React SSR 会在相邻文本节点间插 `<!-- -->`。）
   */
  it('生成按钮在剧透遮罩外面 —— 不点「显示剧透」也看得见（这次真踩到的坑）', () => {
    const html = renderToString(
      createElement(Preparation, { onClose: noop, onStartNew: noop, initialTab: 'module' })
    );
    // 默认是"剧透已隐藏"的状态
    expect(html).toContain('显示剧透');
    expect(html).not.toContain('隐藏剧透');
    // 而生成按钮必须在场（这就是那次 bug：按钮被一起藏进去了）
    expect(html.indexOf('一键生成两张表')).toBeGreaterThan(0);
    /*
     * 遮罩关着的时候，剧透内容本身仍然不该露出来。
     * 判据用**只有剧透块里才有**的字样：
     * 「线索链」不能用 —— GM 内部资料的标题提示里就写着「…线索链 / 幕结构 / 结局」，
     * 那是遮罩外面本来就该看见的说明文字（第一版这条断言就是栽在这上面）。
     */
    expect(html).not.toContain('送往山里的供品');
    expect(html).not.toContain('＋ 手动加一个');
    expect(html).not.toContain('＋ 手动加一件');
  });

  /*
   * H13：战斗入口藏两层剧透后（协作方第 21 版）。
   *
   * 「投入战斗」原本只在两层遮罩（`revealed` ＋ 敌对者表的 `monstersRevealed`）
   * 都打开之后才出现，等于玩家不先点两次「显示剧透」就不知道有这条路 ——
   * 「引擎权威」那条路被藏死，正踩「玩家看不见＝没做」。
   *
   * 这里钉的是：**默认（剧透关着）也能看见这个入口**，
   * 同时下面那句「只给操作、不给名字与数值」必须在场 ——
   * 只断言「投入战斗」四个字不够：遮罩里那个 per-monster 按钮也写着它。
   */
  it('H13：「投入战斗」在两层遮罩外面 —— 不点「显示剧透」也看得见', () => {
    const html = renderToString(
      createElement(Preparation, { onClose: noop, onStartNew: noop, initialTab: 'module' })
    );
    // 默认是"剧透已隐藏"
    expect(html).toContain('显示剧透');
    expect(html).not.toContain('隐藏剧透');
    // 入口本身在（<span>投入战斗</span> 不受有没有敌对者影响，恒在场）
    expect(html.indexOf('投入战斗')).toBeGreaterThan(0);
    // 且是遮罩外那一块专属的说明文字
    expect(html).toContain('这里只给操作、不给名字与数值');
  });
});

/*
 * 🔴 `H23`（协28 §F① 第 19 条 · 协29 补裁）：模组包是**两通**，
 * 界面不许在第一通落盘时就说"已生成"。
 *
 * 真机：第一通出骨架（约 80 秒）→ 界面报「已生成，记得检查并微调」，
 * 而第二通（世界书 + 队友）还在跑、失败还静默 —— 玩家的印象是
 * "已生成，但世界书是空的、同行者没生成"。
 *
 * 这里钉的是**语义**：第二通没成时，那句话里**不许出现"已生成"**，
 * 而且必须点名是谁没生成上、并告诉他下一步能做什么。
 */
describe('H23：模组包第二通没成时，不许说"已生成"', () => {
  it('🔴 第二通失败 → 明说世界书/队友没生成上，并给下一步', () => {
    const note = modulePackPartialNote('模型返回的不是合法 JSON');
    expect(note).toContain('模组已好'); // 骨架确实在，先说清楚
    expect(note).toContain('世界书');
    expect(note).toContain('队友');
    expect(note).toContain('模型返回的不是合法 JSON'); // 原因要带上，别吞
    expect(note).toContain('再点一次');
    // 最要紧的一条：不许出现那句"全好了"
    expect(note).not.toContain('已生成，记得检查并微调');
  });

  it('没带原因时也不许空口（仍然说明是谁没成）', () => {
    const note = modulePackPartialNote();
    expect(note).toContain('世界书');
    expect(note).not.toContain('已生成，记得检查并微调');
  });

  it('被停下（超时 / 点停止）与"失败"分开说 —— 免得像坏了', () => {
    const stopped = modulePackStoppedNote();
    expect(stopped).toContain('停下了');
    expect(stopped).toContain('模组已好');
    expect(stopped).not.toContain('已生成，记得检查并微调');
  });
});
