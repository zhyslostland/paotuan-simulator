/**
 * 生图字段：展示当前图 + 一键生成。
 * 角色立绘、队友头像、区域地图、地点场景共用这一套
 * （都是"给一段 prompt，生成一张图，存到某个位置"）。
 *
 * ## R40 起它不再自己发请求
 * 以前这里是一次 `await`：按下去转圈，你一翻页签回来，组件卸载了 ——
 * 图既不知道画没画完，也不知道最后落哪儿去了。
 * 现在它只**把任务排进 store 的队列**（`queueImage`），真正的执行与落图都在 store 里；
 * 所以"生成中"是从队列读出来的**同一份状态**：切走再回来，它照样转着。
 * 结果落哪儿也由队列按 `kind` + `target` 决定（见 `store.applyImageResult`），
 * 这里不需要再传 `onSave` —— **往哪儿写只有一处说法**。
 */
import { useState } from 'react';
import { useStore } from './store';
import { jobAt, kindLabel, type ImageJobKind } from './imageJobs';
import { ImageLightbox } from './ImageLightbox';
import { aspectRatioOf } from '../core/artSpec.js';

export function ImageField({
  label,
  prompt,
  value,
  job,
  onClear,
  ratio,
}: {
  label: string;
  prompt: string;
  /** 这张图是给谁画的：决定排队与结果落到哪儿 */
  job: { kind: ImageJobKind; target: string };
  value?: string;
  onClear?: () => void;
  /**
   * 展示比例（CSS `aspect-ratio` 的值，如 `'3 / 4'`）。
   * **不传＝按图类型自动**（立绘 3/4 · 场景 16/9 · 地图与插画 1/1），与生图尺寸同源。
   */
  ratio?: string;
}) {
  const queueImage = useStore((s) => s.queueImage);
  const retryImageJob = useStore((s) => s.retryImageJob);
  // 选的是数组里的**元素**（稳定引用），不是新造的对象
  const active = useStore((s) => jobAt(s.imageJobs, job.kind, job.target));
  const [err, setErr] = useState('');
  const busy = active?.status === 'running';
  const queued = active?.status === 'queued';
  /*
   * 🔴 `G12`（协28 §F① 第 13 条）：这条图**失败了**，但只有顶栏角标会变成 `⚠ N` ——
   * 站在这个按钮前面的人不知道发生了什么，只觉得"按了没反应"。
   * 失败就地说出来 + 按钮变「重试」。
   */
  const failed = active?.status === 'failed';
  /*
   * 🔴 展示比例必须与**生成尺寸**一致（`aspectRatioOf` 从 `ART_SIZES` 推，同源）。
   *
   * 以前这里写死 `aspect-square`：3:4 的竖版立绘塞进方框 + `object-cover`
   * → 上下各裁一半 → 玩家看到"**头顶少一截**"。生成换成竖版之后，
   * 容器没跟着换，这个坑就冒出来了。
   */
  const boxRatio = ratio ?? aspectRatioOf(job.kind);

  const run = () => {
    /*
     * 失败的那条**还在队列里** —— 直接 `queueImage` 会被同键去重挡掉（按了没反应），
     * 得走 `retryImageJob` 才真的重排（与角标上那颗「重试」同一动作）。
     */
    if (failed && active) {
      retryImageJob(active.id);
      setErr('');
      return;
    }
    const j = queueImage({ kind: job.kind, target: job.target, prompt, label });
    // 没配 Key / 生图模型时 store 不排空任务，这里把原因说出来
    setErr(j ? '' : '请先在设置里填好 API Key 与「生图模型」');
  };

  return (
    <div>
      <div className="mb-1.5 flex items-center justify-between">
        <span className="text-[11px] text-mist-400">{label}</span>
        <div className="flex gap-2">
          {value && (
            <button
              onClick={onClear}
              className="text-[11px] text-mist-500 transition hover:text-blood-400"
            >
              清除
            </button>
          )}
          <button
            onClick={run}
            disabled={busy || queued}
            className="text-[11px] text-gold-400 transition hover:text-gold-500 disabled:opacity-50"
          >
            {busy ? '生成中…' : queued ? '排队中…' : failed ? '重试' : value ? '重新生成' : '生成'}
          </button>
        </div>
      </div>
      {value ? (
        <ImageLightbox src={value}>
          <img
            src={value}
            alt={label}
            style={{ aspectRatio: boxRatio }}
            className="w-full rounded-lg border border-ink-600 object-cover"
          />
        </ImageLightbox>
      ) : (
        <div
          style={{ aspectRatio: boxRatio }}
          className="flex w-full items-center justify-center rounded-lg border border-dashed border-ink-600 text-[11px] text-mist-500"
        >
          {/*
            占位文案按图类型说：这里原来写死「暂无立绘」，
            地图和场景空着的时候也显示"暂无立绘"，读起来像报错。
          */}
          {busy || queued ? '正在画…' : `暂无${kindLabel(job.kind)}`}
        </div>
      )}
      {(failed || err) && (
        <p className="mt-1 text-[10px] leading-snug text-blood-400">
          {failed ? `${active?.error ?? '生成失败'}（点「重试」再画一次）` : err}
        </p>
      )}
    </div>
  );
}
