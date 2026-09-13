/**
 * 应用内确认弹窗。
 *
 * 为什么不用原生 window.confirm()：在 iframe 沙箱 / PWA 独立窗口里它会被静默拦截
 * （直接返回 false），导致"点了没反应"。这里用 React 弹窗替代，任何环境都可靠。
 */

export function ConfirmDialog({
  title,
  body,
  confirmText = '确定',
  danger = false,
  onCancel,
  onConfirm,
}: {
  title: string;
  body: string;
  confirmText?: string;
  danger?: boolean;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  return (
    <div
      className="fixed inset-0 z-[60] flex items-center justify-center bg-ink-950/80 p-4 backdrop-blur-sm"
      onClick={(e) => {
        e.stopPropagation();
        onCancel();
      }}
    >
      <div
        className="w-full max-w-sm rounded-2xl border border-ink-600 bg-ink-900 p-5"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 className="font-serif text-base text-mist-100">{title}</h2>
        <p className="mt-2 whitespace-pre-line text-[13px] leading-relaxed text-mist-400">{body}</p>
        <div className="mt-4 flex justify-end gap-2">
          <button
            onClick={onCancel}
            className="rounded-lg border border-ink-600 px-3.5 py-2 text-[13px] text-mist-300 transition hover:border-ink-500 hover:text-mist-100"
          >
            取消
          </button>
          <button
            onClick={onConfirm}
            className={`rounded-lg px-3.5 py-2 text-[13px] font-medium transition ${
              danger
                ? 'bg-blood-400 text-ink-950 hover:opacity-85'
                : 'bg-gold-500 text-ink-950 hover:bg-gold-400'
            }`}
          >
            {confirmText}
          </button>
        </div>
      </div>
    </div>
  );
}
