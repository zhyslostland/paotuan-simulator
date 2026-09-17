import { useMemo, useState } from 'react';
import { useStore, type TurnSnapshot } from './store';
import { getRuleset } from '../core/rulesets/index.js';
import { passRate, unlockedAchievements, OUTCOME_LABEL, type AchievementDef } from '../core/career.js';
import { summarizeRun } from './runSummary.js';
import {
  buildArchiveMarkdown,
  buildIllustratedReportHtml,
  buildJourneyMarkdown,
  buildResultMarkdown,
  copyText,
  downloadHtml,
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

/** 一格统计 */
function Stat({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="rounded-lg border border-ink-700 bg-ink-900/60 px-3 py-2">
      <div className="text-[10px] tracking-wider text-mist-500">{label}</div>
      <div className="mt-0.5 text-[15px] tabular-nums text-mist-100">{value}</div>
      {hint && <div className="mt-0.5 text-[10px] text-mist-500/80">{hint}</div>}
    </div>
  );
}

/**
 * 这一局的账 + 跨局生涯 + 成就（R13/R30）。
 *
 * 全部读**引擎已有的账**（编年史 / 检定卡 / 线索 / 交手记录），不新增埋点 ——
 * 所以它跟玩家实际玩过的永远对得上。
 *
 * 成就刻意**只记不奖**：本项目还没有成长系统，发一个用不掉的"成长点"
 * 等于凭空造一个假机制。等真有成长曲线了，在这里挂消耗。
 */
function RunAndCareer() {
  const messages = useStore((s) => s.messages);
  const gameState = useStore((s) => s.gameState);
  const chronicle = useStore((s) => s.chronicle);
  const career = useStore((s) => s.career);
  const lastUnlocked = useStore((s) => s.lastUnlocked);

  const run = useMemo(
    () => summarizeRun(messages, gameState, chronicle),
    [messages, gameState, chronicle]
  );
  const all = useMemo(() => unlockedAchievements(career), [career]);
  const t = career.totals;
  const rate = passRate(run);
  const careerRate = passRate(t);
  const newIds = new Set(lastUnlocked.map((a) => a.id));

  return (
    <>
      {/* 本局统计 */}
      <div className="mt-7 rounded-xl border border-ink-700 bg-ink-900/50 p-4">
        <h2 className="text-[12px] tracking-wider text-mist-400">这一局的账</h2>
        <div className="mt-2.5 grid grid-cols-2 gap-2 sm:grid-cols-4">
          <Stat label="回数" value={`${run.turns}`} hint="守密人记下的每一回" />
          <Stat
            label="检定"
            value={`${run.checks}`}
            hint={rate === null ? undefined : `过了 ${run.passed} 次 · ${rate}%`}
          />
          <Stat label="留下的线索" value={`${run.clues}`} />
          <Stat label="交过手的" value={`${run.foes}`} hint="种" />
        </div>
        <p className="mt-2 text-[11px] text-mist-500">
          结局：<span className="text-mist-300">{OUTCOME_LABEL[run.outcome]}</span>
        </p>

        {/* 冲这一局来的成就 */}
        {lastUnlocked.length > 0 && (
          <div className="mt-3 rounded-lg border border-gold-600/50 bg-gold-500/10 px-3 py-2">
            <div className="text-[11px] tracking-wider text-gold-300">这一局新解锁</div>
            <ul className="mt-1 space-y-0.5">
              {lastUnlocked.map((a: AchievementDef) => (
                <li key={a.id} className="text-[12px] text-gold-200">
                  · {a.name} <span className="text-gold-500/80">— {a.desc}</span>
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>

      {/* 生涯（跨所有局，开新团不清） */}
      <div className="mt-4 rounded-xl border border-ink-700 bg-ink-900/50 p-4">
        <h2 className="text-[12px] tracking-wider text-mist-400">你的生涯</h2>
        <div className="mt-2.5 grid grid-cols-2 gap-2 sm:grid-cols-4">
          <Stat label="跑过的局" value={`${t.runs}`} />
          <Stat label="累计回数" value={`${t.turns}`} />
          <Stat
            label="累计检定"
            value={`${t.checks}`}
            hint={careerRate === null ? undefined : `过了 ${careerRate}%`}
          />
          <Stat label="成就" value={`${all.length} / ${all.length + 0}`} hint="达成即记，不重复" />
        </div>
        <p className="mt-2 text-[11px] leading-relaxed text-mist-500">
          结局记录：达成 {t.outcomes.success} · 灰色 {t.outcomes.grey} · 失守 {t.outcomes.failure} ·
          殒命 {t.outcomes.death} · 理智尽头 {t.outcomes.insanity}
        </p>

        {all.length > 0 && (
          <details className="mt-2.5">
            <summary className="cursor-pointer text-[11px] text-mist-400 hover:text-mist-200">
              已解锁的成就（{all.length}）
            </summary>
            <ul className="mt-1.5 space-y-0.5">
              {all.map(({ def, at }) => (
                <li key={def.id} className="text-[11px] text-mist-500">
                  <span className={newIds.has(def.id) ? 'text-gold-300' : 'text-mist-300'}>
                    {def.name}
                  </span>
                  <span className="ml-1 text-mist-600">{at.slice(0, 10)}</span>
                  <span className="ml-1">— {def.desc}</span>
                </li>
              ))}
            </ul>
          </details>
        )}
      </div>
    </>
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
  const messageImages = useStore((s) => s.messageImages);
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
  /*
   * 带图战报的画面：**配了图的那些守密人回合**，按发生顺序。
   * 图是自动（关键节点）或手动挂在那条消息上的，这里只管把它们按顺序串起来。
   */
  const scenes = messages
    .filter((m) => m.role === 'gm' && (messageImages[m.id] || m.sceneImage))
    .map((m, i) => ({
      label: `第 ${i + 1} 个画面`,
      // 兜底：万一正文里还留着契约块，别把它印进战报
      text: String(m.content ?? '').replace(/```json[\s\S]*$/i, '').trim(),
      image: messageImages[m.id] ?? m.sceneImage,
    }));
  const exportInput: ExportInput = {
    scenes,
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

  const doExport = async (
    kind: 'result' | 'journey' | 'archive',
    action: 'copy' | 'download'
  ) => {
    const md =
      kind === 'result'
        ? buildResultMarkdown(exportInput)
        : kind === 'archive'
          ? buildArchiveMarkdown(exportInput)
          : buildJourneyMarkdown(exportInput);
    if (action === 'download') {
      const suffix = kind === 'result' ? '结算' : kind === 'archive' ? '完整留档' : '全程';
      downloadMarkdown(`${fileBase}-${suffix}.md`, md);
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

        {/* R13/R30：这一局的账 + 生涯 + 成就 */}
        <RunAndCareer />

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
            Markdown 文本，复制或存成文件都行。前两份
            <span className="text-mist-400">不含守密人的内部真相</span>，可以直接发给别人；
            「完整留档」才带真相，且放在末尾的折叠块里。
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
            <div className="rounded-lg border border-gold-600/30 bg-gold-500/[0.04] p-3 sm:col-span-2">
              <div className="flex items-baseline gap-2">
                <span className="text-[12px] text-mist-300">完整留档</span>
                <span className="text-[10px] text-gold-400/80">含守密人真相</span>
              </div>
              <div className="mt-0.5 text-[10px] leading-relaxed text-mist-500">
                同上，末尾多一段折叠起来的真相。留给自己，或发给已经跑完这一局的人 ——
                别发给还在跑的人。
              </div>
              <div className="mt-2.5 flex gap-1.5">
                <button
                  onClick={() => void doExport('archive', 'copy')}
                  className="rounded-md border border-gold-600/60 px-2.5 py-1 text-[11px] text-gold-300 transition hover:border-gold-500 hover:text-gold-200"
                >
                  复制
                </button>
                <button
                  onClick={() => void doExport('archive', 'download')}
                  className="rounded-md border border-ink-600 px-2.5 py-1 text-[11px] text-mist-400 transition hover:border-gold-600/50 hover:text-mist-100"
                >
                  存为文件
                </button>
              </div>
            </div>
          </div>
          {/*
           * 带图战报（G）：把这些画面串成一个**自包含**的 HTML。
           * 单独一块、不用上面那个 Markdown 网格 —— 它是另一种东西（有图、能直接发给人看）。
           */}
          <div className="mt-3 rounded-lg border border-ink-700 p-3">
            <div className="text-[12px] text-mist-300">带图战报（HTML）</div>
            <div className="mt-0.5 text-[10px] leading-relaxed text-mist-500">
              {scenes.length > 0
                ? `把这一局留下的 ${scenes.length} 个画面连同当时的叙事串成一份网页，图片已内嵌，单个文件就能发给别人。`
                : '这一局还没有配图。在设置里打开「带图战报」，或对某一条消息点「配图」，之后再来导出。'}
            </div>
            <div className="mt-2.5 flex gap-1.5">
              <button
                disabled={scenes.length === 0}
                onClick={() => {
                  downloadHtml(
                    `${fileBase}-带图战报.html`,
                    buildIllustratedReportHtml(exportInput)
                  );
                  setExportMsg('已导出带图战报（.html，在下载目录）');
                }}
                className="rounded-md border border-gold-600/60 px-2.5 py-1 text-[11px] text-gold-300 transition hover:border-gold-500 hover:text-gold-200 disabled:cursor-not-allowed disabled:opacity-40"
              >
                存为文件
              </button>
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
              这一局还没有被标记为关键的抉择点（检定没过、进入战斗、首次到某地、拿到新线索或新支线时会自动标记）。
            </p>
          )}
        </div>
      </div>
    </div>
  );
}
