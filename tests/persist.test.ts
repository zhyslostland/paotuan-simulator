/**
 * 落盘节流（协作方 §五 性能三连 ①）的断言。
 *
 * 为什么要单独一个文件：store.test.ts 那份桩是**模块级共享**的，
 * 而这里要动 `vi.useFakeTimers()` —— 混进同一个文件会污染别处的定时器。
 *
 * 守的是两件事，缺一不可：
 *   ① **不要每次写都落盘**（否则长局里全量序列化整个 messages 会把主线程卡住）；
 *   ② **最后一次一定要落盘**（否则关标签页就丢内容 —— 节流最容易踩的就是这个坑）。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

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

const mem = new MemStorage();
vi.stubGlobal('localStorage', mem);
vi.stubGlobal('indexedDB', undefined);

// 必须在 import store 之前把桩装好（store 模块加载时就会读盘）
const { useStore } = await import('../src/ui/store.js');
const { flushSaves } = await import('../src/ui/store.js');
const { loadJson, consumeLoadError } = await import('../src/ui/state/loaders.js');

const readMessages = (): unknown[] => {
  const raw = mem.getItem('trpg.messages');
  return raw ? (JSON.parse(raw) as unknown[]) : [];
};

/*
 * P2-8（协作方第 22 版）：**坏档静默回退**。
 *
 * `trpg.gameState` 写成坏 JSON 时，界面一切正常、内容却退回新局
 * （背包 6→3、地点和时间都变了），而坏串**还留在 localStorage 里**
 * → 每次刷新再退一次。玩家永远不知道发生了什么。
 *
 * 修法两条：① 坏串搬到 `trpg.broken.<原键>` 留底并清掉原键（别反复作祟）；
 * ② 留一句话给界面说（`consumeLoadError` 取走）。
 */
describe('P2-8：坏档要说实话，坏串不许原地作祟', () => {
  it('读不出来的串 → 搬到 trpg.broken.* 留底，并清掉原键', () => {
    mem.setItem('trpg.badtest', '{这不是合法JSON');
    const got = loadJson('trpg.badtest', 'FALLBACK');

    expect(got).toBe('FALLBACK');
    // 原键清掉了 —— 否则每次刷新再坏一次
    expect(mem.getItem('trpg.badtest')).toBeNull();
    // 坏串留了底，玩家想捞还能捞回来
    expect(mem.getItem('trpg.broken.trpg.badtest')).toBe('{这不是合法JSON');
  });

  it('坏档会留一句话（取完即清，不会重复弹）', () => {
    mem.setItem('trpg.badtest2', '{{{');
    loadJson('trpg.badtest2', null);

    const msg = consumeLoadError();
    expect(msg).toBeTruthy();
    expect(msg).toContain('读不出来');
    // 取完即清 —— 刷新不会重复弹同一句
    expect(consumeLoadError()).toBeNull();
  });

  it('好档**不会**误报（没有坏串就不许说话）', () => {
    mem.setItem('trpg.oktest', '{"a":1}');
    expect(loadJson('trpg.oktest', null)).toEqual({ a: 1 });
    expect(consumeLoadError()).toBeNull();
  });
});

describe('落盘节流：同一 key 窗口内只落最后一次', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    mem.clear();
    useStore.setState({ messages: [] });
  });

  afterEach(() => {
    flushSaves();
    vi.useRealTimers();
  });

  it('连续写多次，定时器没到之前一次都不落盘（这才是省下的开销）', () => {
    useStore.getState().addMessage({ role: 'player', content: '一' } as never);
    useStore.getState().addMessage({ role: 'player', content: '二' } as never);
    useStore.getState().addMessage({ role: 'player', content: '三' } as never);
    expect(readMessages()).toHaveLength(0);
  });

  it('窗口到了 → 落盘，而且是**最新**那份（不是中间态）', () => {
    useStore.getState().addMessage({ role: 'player', content: '一' } as never);
    useStore.getState().addMessage({ role: 'player', content: '二' } as never);
    useStore.getState().addMessage({ role: 'player', content: '三' } as never);
    vi.advanceTimersByTime(900);
    const saved = readMessages();
    expect(saved).toHaveLength(3);
    expect((saved[2] as { content: string }).content).toBe('三');
  });

  it('flushSaves() 立刻把待写的都落盘（页面隐藏 / 卸载时用）', () => {
    useStore.getState().addMessage({ role: 'player', content: '马上要走了' } as never);
    expect(readMessages()).toHaveLength(0);
    flushSaves();
    expect(readMessages()).toHaveLength(1);
  });

  it('结构性操作（清空）立刻落盘，且不会被之前的待写盖回去', () => {
    // 先攒一个待写（还没到点）
    useStore.getState().addMessage({ role: 'player', content: '旧消息' } as never);
    // 立刻清空 —— 必须马上落盘，并取消上面那个待写
    useStore.getState().clearMessages();
    expect(readMessages()).toHaveLength(0);
    // 就算定时器走到，也不能把旧消息写回来
    vi.advanceTimersByTime(2000);
    expect(readMessages()).toHaveLength(0);
  });
});
