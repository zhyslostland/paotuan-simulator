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
import { jobAt, type ImageJobKind } from './imageJobs';
import { ImageLightbox } from './ImageLightbox';

export function ImageField({
  label,
  prompt,
  value,
  job,
  onClear,
  aspect = 'aspect-square',
}: {
  label: string;
  prompt: string;
  /** 这张图是给谁画的：决定排队与结果落到哪儿 */
  job: { kind: ImageJobKind; target: string };
  value?: string;
  onClear?: () => void;
  aspect?: string;
}) {
  const queueImage = useStore((s) => s.queueImage);
  // 选的是数组里的**元素**（稳定引用），不是新造的对象
  const active = useStore((s) => jobAt(s.imageJobs, job.kind, job.target));
  const [err, setErr] = useState('');
  const busy = active?.status === 'running';
  const queued = active?.status === 'queued';

  const run = () => {
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
            {busy ? '生成中…' : queued ? '排队中…' : value ? '重新生成' : '生成'}
          </button>
        </div>
      </div>
      {value ? (
        <ImageLightbox src={value}>
          <img
            src={value}
            alt={label}
            className={`${aspect} w-full rounded-lg border border-ink-600 object-cover`}
          />
        </ImageLightbox>
      ) : (
        <div
          className={`${aspect} flex w-full items-center justify-center rounded-lg border border-dashed border-ink-600 text-[11px] text-mist-500`}
        >
          {busy || queued ? '正在画…' : '暂无立绘'}
        </div>
      )}
      {err && <p className="mt-1 text-[10px] leading-snug text-blood-400">{err}</p>}
    </div>
  );
}
