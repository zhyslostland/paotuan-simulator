import { useState } from 'react';
import { useStore, type TurnSnapshot } from './store';
import { getRuleset } from '../core/rulesets/index.js';
import {
  buildJourneyMarkdown,
  buildResultMarkdown,
  copyText,
  downloadMarkdown,
  safeFilename,
  type ExportInput,
} from './exportGame.js';

const KIND_TITLE: Record<string, string> = {
  death: '终幕 · 殒命',
  insanity: '终幕 · 理智尽头',
  success: '终幕 · 达成',
  failure: '终幕 · 失守',
  grey: '终幕 · 灰色',
  other: '终幕',
};

const KIND_NOTE: Record<string, string> = {
  death: '这段故事到这里结束了。',
  insanity: '这段故事到这里结束了。',
  success: '你要做的事做成了，故事在这里收束。',
  failure: '该来的终究来了，故事在这里收束。',
  grey: '你脱身了，代价也留下了。故事在这里收束。',
  other: '这段故事到这里结束了。',
};

/** 关键节点列表：结档页与常规 UI 共用 */
export function AnchorList({
  anchors,
  onRewind,
}: {
  anchors: { id: string; label?: string; snap: TurnSnapshot }[];
  onRewind: (id: string) => void;
}) {
  if (anchors.length === 0) return null;
  return (
    <ul className="space-y-1.5">
      {anchors.map((a) => (
        <li key={a.id}>
          <button
            onClick={() => onRewind(a.id)}
            className="flex w-full items-center justify-between gap-2 rounded-md border border-ink-600 bg-ink-850 px-2.5 py-1.5 text-left transition hover:border-gold-600/60 hover:bg-ink-800"
            title="退回这一步，从这一刻重来"
          >
            <span className="min-w-0 truncate text-[12px] text-mist-300">
              {a.label || '关键抉择'}
            </span>
            <span className="shrink-0 text-[11px] text-gold-500/80">↺ 回到这里</span>
          </button>
        </li>
      ))}
    </ul>
  );
}

/**
 * 结档界面。
 *
 * 用户定调（2026-09-14）：**死亡 = 结档**——这段故事收束，不是弹一个"你死了"的窗，
 * 也不是读档当没发生。回溯能力永远在系统里，想重来随时能退回去。
 */
export function EndingScreen({
  onClose,
  onRewind,
  onNewGame,
}: {
  onClose: () => void;
  onRewind: (id: string) => void;
  onNewGame: () => void;
}) {
  const gameState = useStore((s) => s.gameState);
  const messages = useStore((s) => s.messages);
  const snapshots = useStore((s) => s.snapshots);
  const chronicle = useStore((s) => s.chronicle);
  const summary = useStore((s) => s.summary);
  const character = useStore((s) => s.character);
  const module = useStore((s) => s.module);
  const rulesetId = useStore((s) => s.rulesetId);
  const ending = gameState.ending;
  const [exportMsg, setExportMsg] = useState('');
  if (!ending) return null;

  // 关键节点按消息顺序排（玩家从后往前挑要退回哪一步）
  const anchors = messages
    .filter((m) => m.role === 'player' && snapshots[m.id]?.key)
    .map((m) => ({ id: m.id, label: snapshots[m.id]!.label, snap: snapshots[m.id]! }))
    .reverse();

  /*
   * 导出（用户 2026-09-16 拍板：Markdown / 文本，分成"结算分享"与"整体流程分享"）。
   * 两份都**不含模组的 truth** —— 导出物可能被转发，默认不剧透。
   */
  const rs = getRuleset(rulesetId);
  const exportInput: ExportInput = {
    character,
    module,
    gameState,
    chronicle,
    summary,
    anchors: anchors.map((a) => ({ label: a.label || '关键抉择' })),
    rulesetName: rs.name,
    mainDice: rs.mainDice,
    characteristicLabels: Object.fromEntries(
      rs.characteristicDefs.map((d) => [d.key, d.label])
    ),
  };
  const fileBase = safeFilename(`${module.title || '跑团'}-${character.name || ''}`);

  const doExport = async (kind: 'result' | 'journey', action: 'copy' | 'download') => {
    const md =
      kind === 'result' ? buildResultMarkdown(exportInput) : buildJourneyMarkdown(exportInput);
    if (action === 'download') {
      downloadMarkdown(`${fileBase}-${kind === 'result' ? '结算' : '全程'}.md`, md);
      setExportMsg('已导出为 .md 文件（在下载目录）');
      return;
    }
    const ok = await copyText(md);
    setExportMsg(ok ? '已复制，可直接粘到任何地方' : '复制失败，请改用「存为文件」');
  };

  return (
    <div className="fixed inset-0 z-[85] overflow-y-auto bg-ink-950">
      <div className="mx-auto max-w-2xl px-5 py-10 sm:py-16">
        <div className="mb-6 flex items-center gap-3">
          <span className="h-px w-8 bg-gold-600/60" />
          <span className="text-[11px] tracking-[0.2em] text-gold-500/80">结档</span>
        </div>

        <h1 className="font-serif text-[26px] leading-snug text-mist-100">
          {KIND_TITLE[ending.kind] ?? KIND_TITLE.other}
        </h1>
        <p className="mt-1 text-[12px] text-mist-500">
          {KIND_NOTE[ending.kind] ?? KIND_NOTE.other}
          {ending.at ? ` · ${ending.at.slice(0, 10)}` : ''}
        </p>

        {/* 守密人声明收束时写的一句话：让玩家知道"为什么故事到这里就结束了" */}
        {ending.reason && (
          <p className="mt-3 rounded-md border-l-2 border-gold-600/60 bg-ink-850 px-3 py-2 text-[12px] leading-relaxed text-mist-400">
            {ending.reason}
          </p>
        )}

        <div className="prose-trpg mt-6 font-serif text-[15px] leading-[1.9] text-mist-300">
          {ending.text.split(/\n+/).map((p, i) => (
            <p key={i} className="mb-4">
              {p}
            </p>
          ))}
        </div>

        <div className="mt-8 flex flex-wrap gap-2">
          <button
            onClick={onNewGame}
            className="rounded-lg bg-gold-500 px-4 py-2 text-[13px] font-medium text-ink-950 transition hover:bg-gold-400"
          >
            用这个模组再开一局
          </button>
          <button
            onClick={onClose}
            className="rounded-lg border border-ink-600 px-4 py-2 text-[13px] text-mist-300 transition hover:border-gold-600/50 hover:text-mist-100"
          >
            回到故事（看看经过）
          </button>
        </div>

        {/* 导出这一局（用户 2026-09-16 拍板：Markdown / 文本，分两份） */}
        <div className="mt-7 rounded-xl border border-ink-700 bg-ink-900/50 p-4">
          <h2 className="text-[12px] tracking-wider text-mist-400">导出这一局</h2>
          <p className="mt-1 text-[11px] leading-relaxed text-mist-500">
            Markdown 文本，复制或存成文件都行。
            <span className="text-mist-400">不含守密人的内部真相</span>，可以直接发给别人。
          </p>
          <div className="mt-3 grid gap-2 sm:grid-cols-2">
            <div className="rounded-lg border border-ink-700 p-3">
              <div className="text-[12px] text-mist-300">结算分享</div>
              <div className="mt-0.5 text-[10px] leading-relaxed text-mist-500">
                结局 + 这一局的账。短，适合直接发出去
              </div>
              <div className="mt-2.5 flex gap-1.5">
                <button
                  onClick={() => void doExport('result', 'copy')}
                  className="rounded-md border border-gold-600/60 px-2.5 py-1 text-[11px] text-gold-300 transition hover:border-gold-500 hover:text-gold-200"
                >
                  复制
                </button>
                <button
                  onClick={() => void doExport('result', 'download')}
                  className="rounded-md border border-ink-600 px-2.5 py-1 text-[11px] text-mist-400 transition hover:border-gold-600/50 hover:text-mist-100"
                >
                  存为文件
                </button>
              </div>
            </div>
            <div className="rounded-lg border border-ink-700 p-3">
              <div className="text-[12px] text-mist-300">整体流程分享</div>
              <div className="mt-0.5 text-[10px] leading-relaxed text-mist-500">
                角色、模组、编年史、关键抉择、结局。完整经过
              </div>
              <div className="mt-2.5 flex gap-1.5">
                <button
                  onClick={() => void doExport('journey', 'copy')}
                  className="rounded-md border border-gold-600/60 px-2.5 py-1 text-[11px] text-gold-300 transition hover:border-gold-500 hover:text-gold-200"
                >
                  复制
                </button>
                <button
                  onClick={() => void doExport('journey', 'download')}
                  className="rounded-md border border-ink-600 px-2.5 py-1 text-[11px] text-mist-400 transition hover:border-gold-600/50 hover:text-mist-100"
                >
                  存为文件
                </button>
              </div>
            </div>
          </div>
          {exportMsg && <p className="mt-2.5 text-[11px] text-moss-400">{exportMsg}</p>}
        </div>

        <div className="mt-9 border-t border-ink-700 pt-5">
          <h2 className="mb-1 text-[12px] tracking-wider text-mist-400">
            回到某个关键抉择
          </h2>
          <p className="mb-3 text-[11px] leading-relaxed text-mist-500">
            系统一直保留着回溯能力。挑一个岔路口退回去，从那一刻重来——这一局之后发生的事会被抹掉。
          </p>
          {anchors.length > 0 ? (
            <AnchorList anchors={anchors} onRewind={onRewind} />
          ) : (
            <p className="text-[12px] text-mist-500/70">
              这一局还没有被标记为关键的抉择点（掷骰、进入战斗、转移地点、拿到新线索都会自动标记）。
            </p>
          )}
        </div>
      </div>
    </div>
  );
}
