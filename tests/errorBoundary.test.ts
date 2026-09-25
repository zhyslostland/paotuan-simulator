/**
 * 错误边界 —— **白屏的最后一道兜底**，以前从来没被验证过。
 *
 * ## 为什么这么测（而不是"塞个会炸的子树"）
 * `renderToString` **不跑错误边界**：SSR 下子树抛异常会直接冒到调用方，
 * `getDerivedStateFromError` 不会被调用（那是客户端 reconciler 的行为）。
 * 所以这里分两步，正好对应它真实工作的两个环节：
 * 1. **静态方法**把异常收成 state（这是 React 调它的那条路）；
 * 2. 拿这个 state 去渲染，断言**玩家看到的是人话，不是空白**。
 *
 * 判据里的两句话是刻意的：**绝不能吓唬玩家说"数据丢了"**（存档在本地，跟界面崩不崩无关），
 * 而且必须给出能按的出口。
 */
import { describe, expect, it } from 'vitest';

const { createElement } = await import('react');
const { renderToString } = await import('react-dom/server.browser');
const { ErrorBoundary } = await import('../src/ui/ErrorBoundary.js');

describe('错误边界（崩溃要变成能看懂的一句话）', () => {
  it('getDerivedStateFromError 把异常收成 state', () => {
    const state = ErrorBoundary.getDerivedStateFromError(new Error('boom'));
    expect(state.error).toBeInstanceOf(Error);
    expect(state.error!.message).toBe('boom');
  });

  it('错误态渲染出人话与出口，而不是空白', () => {
    // 构造实例只为拿到带 error 的那份 state（React 在客户端也是这么喂它的）
    const inst = new ErrorBoundary({ children: null });
    inst.state = { error: new Error('Minified React error #185') };
    const html = renderToString(inst.render() as never);

    expect(html.length).toBeGreaterThan(200);
    // 必须明确告诉玩家"存档没事" —— 不能说成数据丢了
    expect(html).toContain('存档');
    // 两个出口都要在
    expect(html).toContain('再试一次');
    expect(html).toContain('重新载入');
    // 原始错误要露出来，玩家截图就能定位
    expect(html).toContain('185');
  });
});
