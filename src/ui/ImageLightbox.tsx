import { useEffect, useState } from 'react';

/**
 * 全屏看图。
 *
 * 立绘、动作小图、区域地图这些图在侧栏里都只有一百多像素宽，
 * 想看清细节只能另存下来——那就不是"我在玩"了。点一下看大图是基本需求。
 *
 * 用法有两种：
 * - 包一层：`<ImageLightbox src={url}>{缩略图}</ImageLightbox>`
 * - 只挂遮罩：`<LightboxOverlay src={url} onClose={...} />`（配合自己的按钮）
 */
export function LightboxOverlay({ src, onClose }: { src: string; onClose: () => void }) {
  const [zoom, setZoom] = useState(1);

  // Esc 关闭 + 锁住背后的滚动，看完关掉时不会发现页面跳到了别处
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      window.removeEventListener('keydown', onKey);
      document.body.style.overflow = prev;
    };
  }, [onClose]);

  return (
    <div
      className="fixed inset-0 z-[90] flex items-center justify-center bg-black/85 p-4"
      onMouseDown={(e) => {
        // 只有点在遮罩本体（不是图上）才关，避免拖动/缩放时误关
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="relative flex max-h-full max-w-full flex-col items-center gap-3">
        <img
          src={src}
          alt=""
          className="max-h-[80vh] max-w-[92vw] rounded-lg object-contain shadow-2xl"
          style={{ transform: `scale(${zoom})`, transition: 'transform 0.15s ease-out' }}
          onDoubleClick={() => setZoom((z) => (z > 1 ? 1 : 2))}
        />
        <div className="flex items-center gap-1.5 rounded-full border border-white/15 bg-black/70 px-2 py-1">
          <button
            onClick={() => setZoom((z) => Math.max(1, Number((z - 0.25).toFixed(2))))}
            className="h-7 w-7 text-[15px] leading-none text-white/70 transition hover:text-white"
            title="缩小"
          >
            －
          </button>
          <span className="w-10 text-center text-[11px] tabular-nums text-white/60">
            {Math.round(zoom * 100)}%
          </span>
          <button
            onClick={() => setZoom((z) => Math.min(4, Number((z + 0.25).toFixed(2))))}
            className="h-7 w-7 text-[15px] leading-none text-white/70 transition hover:text-white"
            title="放大"
          >
            ＋
          </button>
          <button
            onClick={onClose}
            className="ml-1 rounded-full border border-white/20 px-2.5 py-0.5 text-[11px] text-white/70 transition hover:text-white"
          >
            关闭（Esc）
          </button>
        </div>
      </div>
    </div>
  );
}

/** 包一层：点击子元素即全屏看图 */
export function ImageLightbox({
  src,
  children,
  className,
}: {
  src?: string;
  children: React.ReactNode;
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  if (!src) return <>{children}</>;
  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className={`block max-w-full cursor-zoom-in ${className ?? ''}`}
        title="点击看大图"
      >
        {children}
      </button>
      {open && <LightboxOverlay src={src} onClose={() => setOpen(false)} />}
    </>
  );
}
