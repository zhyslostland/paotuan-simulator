import { memo, useCallback, useEffect, useRef, useState } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import {
  useStore,
  type CheckBadge,
  type DiceBadge,
  type Message,
  type NpcLine,
  type Typography,
} from './store';
import { generateImage, ModelError } from '../providers/model.js';
import { actionImagePrompt } from '../orchestrator/generate.js';
import { getGenre } from '../core/genres.js';
import { ImageLightbox } from './ImageLightbox';

function Die({ value, sides }: { value: number; sides: number }) {
  const critical = value === sides || value === 1;
  return (
    <span
      className={`inline-flex h-7 w-7 items-center justify-center rounded-md border text-[12px] font-medium tabular-nums dice-pop ${
        critical
          ? 'border-gold-500/60 bg-gold-500/15 text-gold-400'
          : 'border-ink-600 bg-ink-800 text-mist-300'
      }`}
    >
      {value}
    </span>
  );
}

function DiceCard({ badge }: { badge: DiceBadge }) {
  return (
    <div className="mt-2 inline-flex flex-col gap-1.5 rounded-lg border border-ink-600 bg-ink-850/80 px-3 py-2">
      <div className="flex flex-wrap items-center gap-1.5">
        {badge.groups.flatMap((g, gi) =>
          g.results.map((r, ri) => <Die key={`${gi}-${ri}`} value={r} sides={g.sides} />)
        )}
      </div>
      <div className="text-[11px] text-mist-500">
        {badge.expression} = <span className="text-mist-300">{badge.total}</span>
      </div>
    </div>
  );
}

const TIER_STYLE: Record<string, string> = {
  critical: 'border-gold-500/60 bg-gold-500/10 text-gold-400',
  extreme: 'border-moss-400/50 bg-moss-400/10 text-moss-400',
  hard: 'border-arcane-400/50 bg-arcane-400/10 text-arcane-400',
  regular: 'border-ink-500 bg-ink-800 text-mist-300',
  failure: 'border-ink-600 bg-ink-850 text-mist-400',
  fumble: 'border-blood-400/60 bg-blood-400/10 text-blood-400',
};

function CheckCard({ badge }: { badge: CheckBadge }) {
  const style = TIER_STYLE[badge.tier] ?? TIER_STYLE.regular!;
  // d20 规则包（DnD）显示"加值"，百分骰（COC）显示"成功率"
  const isD20 = badge.mainDice === '1d20';
  const targetText = isD20
    ? `${badge.target >= 0 ? '+' : ''}${badge.target}`
    : `${badge.target}%`;
  return (
    <div className={`mt-2 inline-block rounded-lg border px-3 py-2 dice-pop ${style}`}>
      <div className="flex items-baseline gap-2">
        <span className="text-[13px] font-medium">{badge.skill}</span>
        <span className="text-[11px] opacity-70">{targetText}</span>
      </div>
      <div className="mt-1 flex items-baseline gap-2">
        <span className="text-xl font-semibold tabular-nums">
          {isD20 ? `d20 ` : ''}
          {badge.roll}
        </span>
        <span className="text-[12px]">{badge.label}</span>
      </div>
      {/* 描述加权：标出来，玩家才知道这个目标值为什么跟技能表里不一样 */}
      {badge.bonus ? (
        <div className="mt-1 text-[10px] opacity-75">
          含描述{` `}
          {badge.bonus > 0 ? '加分' : '扣分'} {badge.bonus > 0 ? '+' : ''}
          {badge.bonus}
        </div>
      ) : null}
    </div>
  );
}

function NpcLines({ lines }: { lines: NpcLine[] }) {
  return (
    <div className="mt-3 space-y-2">
      {lines.map((l, i) => (
        <div
          key={i}
          className="rounded-lg border-l-2 border-arcane-600 bg-ink-800 px-3 py-2"
        >
          <div className="text-[12px] font-medium text-arcane-400">{l.name}</div>
          {l.action && <p className="mt-0.5 text-[12px] text-mist-400">{l.action}</p>}
          {l.line && (
            <p className="mt-1 text-[14px] leading-relaxed text-mist-100">「{l.line}」</p>
          )}
        </div>
      ))}
    </div>
  );
}

function TypingDots() {
  return (
    <div className="flex items-center gap-1.5 py-1">
      {[0, 1, 2].map((i) => (
        <span
          key={i}
          className="thinking-dot h-1.5 w-1.5 rounded-full bg-mist-500"
          style={{ animationDelay: `${i * 0.18}s` }}
        />
      ))}
    </div>
  );
}

function GhostBtn({
  onClick,
  title,
  children,
}: {
  onClick: () => void;
  title?: string;
  children: React.ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      title={title}
      className="rounded-md border border-ink-700 bg-ink-900/60 px-2 py-0.5 text-[11px] text-mist-500 transition hover:border-gold-600/50 hover:text-gold-400"
    >
      {children}
    </button>
  );
}

/** 正文里的"动作场景小图"：给某段 GM 回复配一张第三视角插画 */
function InlineSceneImage({
  msgId,
  content,
  value,
}: {
  msgId: string;
  content: string;
  value?: string;
}) {
  const config = useStore((s) => s.config);
  const character = useStore((s) => s.character);
  const genreId = useStore((s) => s.genreId);
  const customGenres = useStore((s) => s.customGenres);
  const setMessageSceneImage = useStore((s) => s.setMessageSceneImage);
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
      const url = await generateImage(
        actionImagePrompt(
          content,
          {
            gender: character.gender,
            description: character.description,
          },
          getGenre(genreId, customGenres)
        ),
        { ...config, model: config.imageModel.trim(), size: config.imageSize || '1024x1024' }
      );
      if (url) setMessageSceneImage(msgId, url);
      else setErr('生图接口没有返回图片');
    } catch (e) {
      setErr(e instanceof ModelError ? e.message : `生图失败：${(e as Error).message}`);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="mt-3">
      {value ? (
        <div className="space-y-1.5">
          <ImageLightbox src={value}>
            <img
              src={value}
              alt="场景插画"
              className="max-h-64 w-auto rounded-lg border border-ink-600 object-cover"
            />
          </ImageLightbox>
          <div className="flex gap-2">
            <GhostBtn onClick={run} title="重新生成这张图">
              {busy ? '生成中…' : '重配'}
            </GhostBtn>
            <GhostBtn onClick={() => setMessageSceneImage(msgId, '')} title="移除这张图">
              移除
            </GhostBtn>
          </div>
        </div>
      ) : (
        <GhostBtn onClick={run} title="为这一段配一张第三视角插画">
          {busy ? '生成中…' : '🎨 配图'}
        </GhostBtn>
      )}
      {err && <p className="mt-1 text-[10px] text-blood-400">{err}</p>}
    </div>
  );
}

/**
 * 单条消息。
 *
 * 为什么单独抽出来并 memo：流式输出时最后一条消息每几百毫秒就变一次，
 * 若不 memo，整屏（最多 120 条）的 Markdown 都要重新解析一遍，手机上直接卡住。
 * props 全部是原始值或稳定引用，所以只有内容真的变了的那一条会重渲染。
 */
const MessageRow = memo(function MessageRow({
  m,
  streaming,
  isLast,
  isLastGm,
  hasPlayer,
  canRewind,
  imageUrl,
  typography,
  onRewind,
  onReroll,
}: {
  m: Message;
  streaming: boolean;
  isLast: boolean;
  isLastGm: boolean;
  hasPlayer: boolean;
  canRewind: boolean;
  imageUrl?: string;
  typography: Typography;
  onRewind: (id: string) => void;
  onReroll: () => void;
}) {
  if (m.role === 'system') {
    return (
      <div className="text-center">
        <span className="rounded-full bg-ink-800 px-3 py-1 text-[11px] text-mist-500">
          {m.content}
        </span>
      </div>
    );
  }

  if (m.role === 'player') {
    return (
      <div className="rise-in flex justify-end">
        <div className="max-w-[85%]">
          <div className="rounded-2xl rounded-br-md border border-gold-600/40 bg-ink-800/90 px-4 py-2.5 text-[14px] leading-relaxed text-mist-100">
            {m.content}
          </div>
          {m.check && (
            <div className="flex justify-end">
              <CheckCard badge={m.check} />
            </div>
          )}
          {m.checks?.map((b, i) => (
            <div key={i} className="flex justify-end">
              <CheckCard badge={b} />
            </div>
          ))}
          {m.dice?.map((d, i) => (
            <div key={i} className="flex justify-end">
              <DiceCard badge={d} />
            </div>
          ))}
          {!streaming && canRewind && (
            <div className="mt-1 flex justify-end">
              <GhostBtn
                onClick={() => onRewind(m.id)}
                title="回到这一步，重新来过（内容会填回输入框）"
              >
                ↺ 回溯到这里
              </GhostBtn>
            </div>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="rise-in">
      <div className="mb-1.5 flex items-center gap-2">
        <span className="h-px w-5 bg-gold-600/50" />
        <span className="text-[11px] tracking-wide text-gold-500/80">守密人</span>
      </div>
      <div
        className={`prose-trpg font-serif text-mist-300 ${typography.indent ? 'prose-indent' : ''}`}
        style={{
          fontSize: `${(15 * typography.scale).toFixed(1)}px`,
          lineHeight: typography.lineHeight,
        }}
      >
        <ReactMarkdown remarkPlugins={[remarkGfm]}>{m.content}</ReactMarkdown>
      </div>
      {m.npcLines && m.npcLines.length > 0 && <NpcLines lines={m.npcLines} />}
      {(!streaming || !isLast) && (
        <InlineSceneImage msgId={m.id} content={m.content} value={imageUrl} />
      )}
      {streaming && isLast && <TypingDots />}
      {!streaming && hasPlayer && isLastGm && (
        <div className="mt-2">
          <GhostBtn
            onClick={onReroll}
            title="用同一行动重新生成一次；若该轮过了检定，会重掷骰子"
          >
            ↻ 重掷这一轮
          </GhostBtn>
        </div>
      )}
    </div>
  );
});

export function Chat({
  onSend,
  onAbort,
  draft,
  setDraft,
  onRewind,
  onReroll,
  onQuickCheck,
  onRollAll,
}: {
  onSend: (text: string) => void;
  onAbort: () => void;
  draft: string;
  setDraft: (v: string) => void;
  onRewind: (id: string) => void;
  onReroll: () => void;
  onQuickCheck: (skill: string, difficulty?: string, index?: number) => void;
  /** 把待掷队列里的检定一次全部掷掉（只发一轮 GM） */
  onRollAll: () => void;
}) {
  const messages = useStore((s) => s.messages);
  const streaming = useStore((s) => s.streaming);
  const snapshots = useStore((s) => s.snapshots);
  const pendingChecks = useStore((s) => s.pendingChecks);
  const typography = useStore((s) => s.typography);
  const combat = useStore((s) => s.gameState.combat);
  const messageImages = useStore((s) => s.messageImages);
  const endRef = useRef<HTMLDivElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const taRef = useRef<HTMLTextAreaElement>(null);
  // 移动端长对话虚拟化：默认只渲染最近 120 条，点「加载更早」再往前翻
  const [renderCount, setRenderCount] = useState(120);
  const visibleMessages = messages.slice(Math.max(0, messages.length - renderCount));

  /*
   * 上层每次 render 都会新建 onRewind / onReroll 这两个函数，
   * 直接传给 memo 过的 MessageRow 会让 memo 完全失效。
   * 这里用 ref 转一手，拿到一个身份稳定的回调。
   */
  const rewindRef = useRef(onRewind);
  rewindRef.current = onRewind;
  const rerollRef = useRef(onReroll);
  rerollRef.current = onReroll;
  const rewind = useCallback((id: string) => rewindRef.current(id), []);
  const reroll = useCallback(() => rerollRef.current(), []);

  // 流式输出时消息长度不变，必须在"内容"变化时也滚动；
  // 但只有当用户本来就在底部附近时才自动滚，避免打断向上翻看。
  const lastContent = messages[messages.length - 1]?.content ?? '';
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const nearBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 160;
    if (nearBottom) el.scrollTop = el.scrollHeight;
  }, [messages.length, lastContent, streaming]);

  const submit = () => {
    const text = draft.trim();
    if (!text || streaming) return;
    setDraft('');
    if (taRef.current) taRef.current.style.height = 'auto';
    onSend(text);
  };

  // 最后一条守密人回复（重掷挂它上面）与是否已有玩家行动
  let lastGmId: string | null = null;
  for (let i = messages.length - 1; i >= 0; i--) {
    if (messages[i]!.role === 'gm') {
      lastGmId = messages[i]!.id;
      break;
    }
  }
  const hasPlayer = messages.some((m) => m.role === 'player');

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div ref={scrollRef} className="min-h-0 flex-1 overflow-y-auto px-4 py-5 sm:px-8">
        <div className="mx-auto max-w-3xl space-y-6">
          {messages.length > renderCount && (
            <div className="text-center">
              <button
                onClick={() => setRenderCount((c) => c + 120)}
                className="rounded-full border border-ink-600 bg-ink-850 px-4 py-1.5 text-[11px] text-mist-400 transition hover:border-gold-600/50 hover:text-mist-100"
              >
                加载更早的 {Math.min(120, messages.length - renderCount)} 条消息
              </button>
            </div>
          )}
          {visibleMessages.map((m) => (
            <MessageRow
              key={m.id}
              m={m}
              streaming={streaming}
              isLast={m.id === messages[messages.length - 1]?.id}
              isLastGm={m.id === lastGmId}
              hasPlayer={hasPlayer}
              canRewind={Boolean(snapshots[m.id])}
              imageUrl={messageImages[m.id] ?? m.sceneImage}
              typography={typography}
              onRewind={rewind}
              onReroll={reroll}
            />
          ))}
          {streaming && messages[messages.length - 1]?.role === 'player' && (
            <div>
              <div className="mb-1.5 flex items-center gap-2">
                <span className="h-px w-5 bg-gold-600/50" />
                <span className="text-[11px] tracking-wide text-gold-500/80">守密人</span>
              </div>
              <TypingDots />
            </div>
          )}
          <div ref={endRef} />
        </div>
      </div>

      {combat?.active && (
        <div className="shrink-0 border-t border-blood-400/30 bg-blood-400/5 px-4 py-1.5 sm:px-8">
          <div className="mx-auto max-w-3xl">
            <div className="flex items-center justify-between gap-3">
              <span className="shrink-0 text-[12px] text-blood-300">
                ⚔ 战斗中 · 第 {combat.round || 1} 轮
              </span>
              <span className="min-w-0 truncate text-[11px] text-mist-500">
                尽情描述你的动作，想做几件都行——轮次是给世界用的
              </span>
            </div>
            {combat.foes && combat.foes.length > 0 && (
              <div className="mt-1.5 flex flex-wrap gap-x-4 gap-y-1.5">
                {combat.foes.map((f) => {
                  const pct = Math.max(0, Math.min(100, (f.hp / Math.max(f.max, 1)) * 100));
                  return (
                    <div key={f.name} className="flex items-center gap-1.5">
                      <span className="text-[11px] text-mist-300">{f.name}</span>
                      <div className="h-1.5 w-16 overflow-hidden rounded-full bg-ink-700">
                        <div
                          className={`h-full rounded-full ${
                            pct <= 25 ? 'bg-blood-400' : 'bg-blood-400/70'
                          }`}
                          style={{ width: `${pct}%` }}
                        />
                      </div>
                      <span className="text-[10px] tabular-nums text-mist-400">
                        {f.hp}/{f.max}
                      </span>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      )}

      {pendingChecks.length > 0 && !streaming && (
        <div className="shrink-0 border-t border-gold-600/30 bg-gold-500/5 px-4 py-2.5 sm:px-8">
          <div className="mx-auto max-w-3xl space-y-2">
            {pendingChecks.length > 1 && (
              <div className="flex items-center justify-between gap-2">
                <span className="text-[11px] text-mist-400">
                  守密人要求了 {pendingChecks.length} 次检定
                </span>
                <span className="flex gap-2">
                  {/* 一次全掷：连续检定不用来回点，结果合成一条消息只让 GM 回一轮 */}
                  <button
                    onClick={onRollAll}
                    className="rounded-lg bg-gold-500 px-3 py-1.5 text-[12px] font-medium text-ink-950 transition hover:bg-gold-400"
                  >
                    一次全掷
                  </button>
                  <GhostBtn
                    onClick={() => useStore.getState().clearPendingChecks()}
                    title="把这一轮要求的所有检定都忽略"
                  >
                    全部忽略
                  </GhostBtn>
                </span>
              </div>
            )}
            {pendingChecks.map((pc, i) => (
              <div key={`${pc.skill}-${i}`} className="flex items-center justify-between gap-3">
                <div className="min-w-0">
                  <div className="text-[12px] text-mist-200">
                    守密人要求一次 <b className="text-gold-400">{pc.skill}</b> 检定
                    {pc.difficulty && pc.difficulty !== 'regular'
                      ? `（${pc.difficulty === 'hard' ? '困难' : '极难'}）`
                      : ''}
                  </div>
                  {pc.reason && (
                    <div className="mt-0.5 truncate text-[11px] text-mist-500">{pc.reason}</div>
                  )}
                </div>
                <div className="flex shrink-0 gap-2">
                  <button
                    onClick={() => onQuickCheck(pc.skill, pc.difficulty, i)}
                    className="rounded-lg bg-gold-500 px-3 py-1.5 text-[12px] font-medium text-ink-950 transition hover:bg-gold-400"
                  >
                    掷骰
                  </button>
                  <GhostBtn
                    onClick={() => useStore.getState().removePendingCheck(i)}
                    title="忽略这一次检定"
                  >
                    忽略
                  </GhostBtn>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="safe-bottom border-t border-ink-700 bg-ink-900/95 px-4 py-3 backdrop-blur sm:px-8">
        <div className="mx-auto max-w-3xl">
          <div className="flex items-end gap-2 rounded-xl border border-ink-600 bg-ink-850 p-2 focus-within:border-gold-600/60">
            <textarea
              ref={taRef}
              value={draft}
              onChange={(e) => {
                setDraft(e.target.value);
                const el = e.target;
                el.style.height = 'auto';
                el.style.height = `${Math.min(el.scrollHeight, 160)}px`;
              }}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
                  e.preventDefault();
                  submit();
                  return;
                }
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault();
                  submit();
                  return;
                }
                // 输入框为空时按 ↑：取回自己上一条行动（跟聊天软件一样）
                if (e.key === 'ArrowUp' && !draft.trim()) {
                  const last = [...useStore.getState().messages]
                    .reverse()
                    .find((m) => m.role === 'player');
                  if (last) {
                    e.preventDefault();
                    setDraft(last.content);
                  }
                }
              }}
              rows={1}
              placeholder="你要做什么，或直接说你角色的话（Enter 发送 · Shift+Enter 换行 · ↑ 取回上一条）"
              className="max-h-40 flex-1 resize-none bg-transparent px-2 py-2 text-[15px] text-mist-100 outline-none placeholder:text-mist-500"
            />
            {streaming ? (
              <button
                onClick={onAbort}
                className="shrink-0 rounded-lg border border-ink-600 px-4 py-2 text-[13px] text-mist-300 transition hover:border-blood-400/60 hover:text-blood-400"
              >
                停止
              </button>
            ) : (
              <button
                onClick={submit}
                disabled={!draft.trim()}
                className="shrink-0 rounded-lg bg-gold-500 px-5 py-2 text-[14px] font-medium text-ink-950 transition hover:bg-gold-400 disabled:cursor-not-allowed disabled:bg-ink-700 disabled:text-mist-500"
              >
                行动
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
