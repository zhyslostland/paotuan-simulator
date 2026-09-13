/**
 * 生图立绘字段：展示当前图 + 一键生成。
 * 角色立绘和场景立绘共用这一套（都是"给 prompt，生成一张图，存一个 URL"）。
 */
import { useState } from 'react';
import { useStore } from './store';
import { generateImage, ModelError } from '../providers/model.js';

export function ImageField({
  label,
  prompt,
  value,
  onSave,
  onClear,
  aspect = 'aspect-square',
}: {
  label: string;
  prompt: string;
  value?: string;
  onSave: (url: string) => void;
  onClear?: () => void;
  aspect?: string;
}) {
  const config = useStore((s) => s.config);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');

  const run = async () => {
    if (!config.apiKey) {
      setErr('请先在设置里填 API Key');
      return;
    }
    if (!config.imageModel?.trim()) {
      setErr('请先在设置里填「生图模型」');
      return;
    }
    setBusy(true);
    setErr('');
    try {
      const url = await generateImage(prompt, {
        ...config,
        model: config.imageModel.trim(),
        size: config.imageSize || '1024x1024',
      });
      if (url) onSave(url);
      else setErr('生图接口没有返回图片，换一个生图模型试试');
    } catch (e) {
      setErr(e instanceof ModelError ? e.message : `生图失败：${(e as Error).message}`);
    } finally {
      setBusy(false);
    }
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
            disabled={busy}
            className="text-[11px] text-gold-400 transition hover:text-gold-500 disabled:opacity-50"
          >
            {busy ? '生成中…' : value ? '重新生成' : '生成'}
          </button>
        </div>
      </div>
      {value ? (
        <img
          src={value}
          alt={label}
          className={`${aspect} w-full rounded-lg border border-ink-600 object-cover`}
        />
      ) : (
        <div
          className={`${aspect} flex w-full items-center justify-center rounded-lg border border-dashed border-ink-600 text-[11px] text-mist-500`}
        >
          暂无立绘
        </div>
      )}
      {err && <p className="mt-1 text-[10px] leading-snug text-blood-400">{err}</p>}
    </div>
  );
}
