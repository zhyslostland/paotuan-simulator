/**
 * 生图进度角标（R40）：**不管你在哪个页面都能看见"图还在画"**。
 *
 * ## 为什么要有它
 * 生图最难受的一点是"看不见"：以前它躲在某个按钮的转圈里，
 * 一翻页签就不知道跑没跑完、落哪儿去了；自动配图更是一张在飞的图完全不可见。
 * 现在队列住进 store，这个角标就是它在界面上的**唯一出口**：
 * 有活在跑就转圈、失败了就红着、点开能重试。
 *
 * ## 四条刻意的
 * - **没任务就完全不渲染**（`return null`）—— 平时不该占着屏幕一角。
 * - **收起时只留一个很小的圆角标**（转圈 + 数字）：它要长期挂在屏幕右上角，
 *   写一整句话会挡住正文；要看细节就点开。
 * - **失败也要显示**，而且**要用红色**：那是最需要被看见的状态
 *   （"为什么这个地点一直没有图"——因为它没画出来，不是因为你没点）。
 * - **红点要一直留着**，直到玩家自己重试或点"不画了"：
 *   悄悄消失等于"我明明点了却没反应"。
 * - **z-index 高过弹层**（`z-[76]`，弹层是 50）：在准备页里生成立绘时，
 *   你切去看聊天也照样能看见进度。
 */
import { useState } from 'react';
import { useStore } from './store';
import { activeCount, badgeText, failedCount, kindLabel, statusText } from './imageJobs';

export function ImageJobsBadge() {
  const jobs = useStore((s) => s.imageJobs);
  const retry = useStore((s) => s.retryImageJob);
  const dismiss = useStore((s) => s.dismissImageJob);
  const cancel = useStore((s) => s.cancelImageJob);
  const [open, setOpen] = useState(false);

  // 空队列什么都不显示：平时不该占着屏幕一角
  if (jobs.length === 0) return null;

  const active = activeCount(jobs);
  const failed = failedCount(jobs);
  const tone = active > 0 ? 'gold' : 'blood';

  return (
    <div className="fixed right-2 top-14 z-[76] flex flex-col items-end gap-1.5">
      {/* 收起时只留一个很小的圆角标：它要长期挂在屏幕角上，别挡住正文 */}
      <button
        onClick={() => setOpen((v) => !v)}
        title={badgeText(jobs)}
        className={`flex items-center gap-1 rounded-full border px-2 py-1 text-[11px] shadow-lg backdrop-blur transition ${
          tone === 'gold'
            ? 'border-gold-500/50 bg-ink-900/95 text-gold-300'
            : 'border-blood-700/60 bg-ink-900/95 text-blood-300'
        }`}
      >
        {active > 0 ? (
          <span
            className="inline-block h-3 w-3 shrink-0 animate-spin rounded-full border-2 border-gold-500/30 border-t-gold-400"
            aria-hidden
          />
        ) : (
          <span className="shrink-0">⚠</span>
        )}
        <span className="tabular-nums">{active > 0 ? active : failed}</span>
      </button>

      {open && (
        <div className="w-[min(84vw,300px)] rounded-xl border border-ink-600 bg-ink-900/95 p-2.5 shadow-xl backdrop-blur">
          <p className="mb-1.5 text-[11px] text-mist-400">{badgeText(jobs)}</p>
          <ul className="space-y-1.5">
            {jobs.map((j) => (
              <li key={j.id} className="flex items-start gap-2">
                <div className="min-w-0 flex-1">
                  <p className="truncate text-[11px] text-mist-200">
                    <span className="text-mist-500">{kindLabel(j.kind)} · </span>
                    {j.label}
                  </p>
                  <p
                    className={`mt-0.5 text-[10px] leading-snug ${
                      j.status === 'failed' ? 'text-blood-400' : 'text-mist-500'
                    }`}
                  >
                    {statusText(j)}
                  </p>
                </div>
                {j.status === 'failed' ? (
                  <div className="flex shrink-0 gap-1">
                    <button
                      onClick={() => retry(j.id)}
                      className="rounded-md border border-gold-600/60 px-1.5 py-0.5 text-[10px] text-gold-300 transition hover:bg-gold-500/10"
                    >
                      重试
                    </button>
                    <button
                      onClick={() => dismiss(j.id)}
                      className="rounded-md border border-ink-600 px-1.5 py-0.5 text-[10px] text-mist-500 transition hover:text-mist-300"
                    >
                      不画了
                    </button>
                  </div>
                ) : j.status === 'running' ? (
                  /*
                   * `H26`：正在画的那条**也要有出口**。
                   * 以前这里只有一句「画着…」—— 玩家改主意时只能干等（或等 3 分钟硬闸）。
                   * 点它就是 `abort()` + 出队，后面排着的那张当场开工。
                   */
                  <div className="flex shrink-0 items-center gap-1">
                    <span className="pt-0.5 text-[10px] text-mist-500">画着…</span>
                    <button
                      onClick={() => cancel(j.id)}
                      className="rounded-md border border-ink-600 px-1.5 py-0.5 text-[10px] text-mist-500 transition hover:border-blood-400/60 hover:text-blood-400"
                    >
                      不画了
                    </button>
                  </div>
                ) : (
                  <span className="shrink-0 pt-0.5 text-[10px] text-mist-500">等着</span>
                )}
              </li>
            ))}
          </ul>
          {failed > 0 && active === 0 && (
            <button
              onClick={() => jobs.filter((j) => j.status === 'failed').forEach((j) => retry(j.id))}
              className="mt-2 w-full rounded-lg border border-gold-600/50 py-1.5 text-[11px] text-gold-300 transition hover:bg-gold-500/10"
            >
              全部重试（{failed}）
            </button>
          )}
        </div>
      )}
    </div>
  );
}
