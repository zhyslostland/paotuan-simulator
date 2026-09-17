/**
 * 界面错误边界 —— **让"崩溃"变成能看懂的一句话，而不是一片空白**。
 *
 * ## 为什么值得单独一个组件（2026-09-17 线上事故）
 * 那次的问题是图鉴组件在 zustand 选择器里返回了新对象 → 无限重渲染 →
 * React 抛 `Minified React error #185` → 根节点整个卸载。
 * 玩家看到的是：**PC 打开全白**、手机卡在自动更新里转圈 ——
 * 既没有报错、也不知道该找谁，只能来问"打不开了"。
 *
 * React 的错误边界正好补这一刀：渲染期抛出的异常会被它接住，
 * 显示成一段人话 + 两个按钮，并把原始错误打进控制台备查。
 *
 * ## 两条必须守住的
 * 1. **绝不能说"数据丢了"这种吓人的话，也不能真丢** —— 存档在浏览器本地
 *    （localStorage / IndexedDB），跟界面崩不崩没关系。这里要明确告诉玩家这一点。
 * 2. **提供"再试一次"** —— 很多崩溃是某一份数据触发的，把出错的子树丢掉重挂
 *    往往就好了，不必逼人刷新（刷新还会连带重走一遍更新检测）。
 *
 * 用 class 写是因为 React 至今只有 class 组件能当错误边界（没有 hooks 版本）。
 */
import { Component, type ErrorInfo, type ReactNode } from 'react';

interface Props {
  children: ReactNode;
}

interface State {
  error: Error | null;
}

export class ErrorBoundary extends Component<Props, State> {
  override state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  override componentDidCatch(error: Error, info: ErrorInfo): void {
    // 控制台留一份完整的，玩家截图过来就能定位
    console.error('[跑团模拟器] 界面渲染出错：', error, info?.componentStack);
  }

  override render(): ReactNode {
    const { error } = this.state;
    if (!error) return this.props.children;

    return (
      <div className="flex min-h-screen items-center justify-center bg-ink-900 px-4">
        <div className="w-full max-w-md rounded-lg border border-ink-700 bg-ink-850 px-4 py-5">
          <h1 className="text-[15px] text-mist-100">界面出了点问题</h1>
          <p className="mt-2 text-[12px] leading-relaxed text-mist-400">
            这一处没能画出来。<strong className="text-mist-200">你的存档没事</strong>
            —— 它存在浏览器本地，跟界面的成败无关，重载之后照旧。
          </p>

          <pre className="mt-3 max-h-32 overflow-auto rounded border border-ink-700 bg-ink-900 px-2 py-1.5 text-[10px] leading-relaxed text-blood-300">
            {error.message || String(error)}
          </pre>

          <div className="mt-4 flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => this.setState({ error: null })}
              className="rounded border border-gold-600/60 bg-gold-500/10 px-3 py-1.5 text-[12px] text-gold-300 hover:bg-gold-500/20"
            >
              再试一次
            </button>
            <button
              type="button"
              onClick={() => window.location.reload()}
              className="rounded border border-ink-600 px-3 py-1.5 text-[12px] text-mist-300 hover:bg-ink-800"
            >
              重新载入
            </button>
          </div>

          <p className="mt-3 text-[10px] leading-relaxed text-mist-500/80">
            如果反复出现，按 <code>F12</code> 打开控制台，把红色的那条报错截给开发者。
          </p>
        </div>
      </div>
    );
  }
}
