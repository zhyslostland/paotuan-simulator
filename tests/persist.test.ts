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

const readMessages = (): unknown[] => {
  const raw = mem.getItem('trpg.messages');
  return raw ? (JSON.parse(raw) as unknown[]) : [];
};

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
