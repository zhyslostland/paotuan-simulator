import { useEffect, useRef, useState } from 'react';
import { useStore, addressOf, resolveCheckTarget } from './store';
import { Chat } from './Chat';
import { CharacterSheet, CheckDialog, type Difficulty } from './CharacterSheet';
import { WorldPanel } from './WorldPanel';
import { Settings } from './Settings';
import { Preparation } from './Preparation';
import { ConfirmDialog } from './ConfirmDialog';
import {
  buildSystemPrompt,
  buildMessages,
  extractContract,
  selectWorldbook,
  stripMeta,
  dedupeNpcLines,
  isRefusal,
  isCheckLeak,
  RETRY_NOTE,
  CHECK_RETRY_NOTE,
  CONTRACT_RETRY_NOTE,
} from '../orchestrator/prompt.js';
import { playSfx, resumeAudio, startAmbience, startBgm } from './audio.js';
import { updateSW } from '../pwa.js';
import { streamChat, chat, ModelError, type ChatTurn } from '../providers/model.js';
import { FOLD_SYSTEM } from '../orchestrator/generate.js';
import { getRuleset } from '../core/rulesets/index.js';
import { getGenre } from '../core/genres.js';

type Panel = 'chat' | 'character' | 'world';

/** 事件日志超过这个条数就把早期的折进摘要 */
const CHRONICLE_FOLD_AT = 50;
/** 折叠后保留的近期明细条数 */
const CHRONICLE_KEEP = 20;

export default function App() {
  const {
    messages,
    config,
    character,
    module: gameModule,
    gameState,
    rulesetId,
    genreId,
    customGenres,
    streaming,
    theme,
    worldbook,
    addMessage,
    updateMessage,
    setStreaming,
    skillCheck,
    applyModelDeltas,
    addChronicle,
    summary,
    chronicle,
  } = useStore();

  const [showSettings, setShowSettings] = useState(false);
  const [showPrep, setShowPrep] = useState(false);
  const [mobilePanel, setMobilePanel] = useState<Panel>('chat');
  const [draft, setDraft] = useState('');
  const [checkSkill, setCheckSkill] = useState<string | null>(null);
  const [pendingStart, setPendingStart] = useState(false);
  const [toast, setToast] = useState('');
  const [updateReady, setUpdateReady] = useState(false);
  const [welcome, setWelcome] = useState(() => !localStorage.getItem('trpg.welcomed'));
  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
  }, [theme]);

  // PWA 有新版本 → 弹更新横幅，否则用户会一直卡在旧版本
  useEffect(() => {
    const onUpdate = () => setUpdateReady(true);
    window.addEventListener('trpg:update-ready', onUpdate);
    return () => window.removeEventListener('trpg:update-ready', onUpdate);
  }, []);

  /**
   * 全局快捷键（输入框里也能用，所以挂在 window 上）：
   * - Esc            关闭当前弹层（检定 → 准备 → 设置，从最上面一层开始）
   * - Cmd/Ctrl + ,   打开设置
   * - Cmd/Ctrl + 1/2/3 切换 角色 / 故事 / 世界
   */
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        if (checkSkill) return setCheckSkill(null);
        if (showPrep) return setShowPrep(false);
        if (showSettings) return setShowSettings(false);
        if (pendingStart) return setPendingStart(false);
        return;
      }
      const mod = e.metaKey || e.ctrlKey;
      if (mod && e.key === ',') {
        e.preventDefault();
        setShowSettings(true);
        return;
      }
      if (mod && (e.key === '1' || e.key === '2' || e.key === '3')) {
        e.preventDefault();
        setMobilePanel(e.key === '1' ? 'character' : e.key === '2' ? 'chat' : 'world');
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [checkSkill, showPrep, showSettings, pendingStart]);

  // 图片存在 IndexedDB 里（localStorage 装不下 base64），启动时异步读回
  useEffect(() => {
    void useStore.getState().hydrateImages();
  }, []);

  // 数据防丢提醒：有进度但 7 天内没提醒过，就提一次"记得导出备份"
  useEffect(() => {
    const s = useStore.getState();
    const hasProgress = s.messages.length > 5 || s.chronicle.length > 0;
    if (!hasProgress) return;
    const last = Number(localStorage.getItem('trpg.backupRemind') || 0);
    if (Date.now() - last < 7 * 86400_000) return;
    localStorage.setItem('trpg.backupRemind', String(Date.now()));
    setToast('进度存在本机浏览器里，建议去「设置 → 存档与记录」导出备份');
    setTimeout(() => setToast(''), 5200);
  }, []);

  /**
   * 音频：浏览器禁止无交互自动播放，所以先试着起一次（多半被拦），
   * 再挂一个"首次交互后就唤醒"的监听——用户点任何地方之后声音就来了。
   */
  useEffect(() => {
    const a = useStore.getState().audio;
    if (!a.enabled) return;
    const kick = () => {
      void resumeAudio().then(() => {
        const cur = useStore.getState().audio;
        if (!cur.enabled) return;
        startAmbience(cur.ambience, cur.ambienceVol);
        void startBgm(cur);
      });
    };
    kick();
    window.addEventListener('pointerdown', kick, { once: true });
    window.addEventListener('keydown', kick, { once: true });
    return () => {
      window.removeEventListener('pointerdown', kick);
      window.removeEventListener('keydown', kick);
    };
  }, []);

  /** 事件日志超过阈值时，把早期的折进摘要层，只留近期明细 */
  const foldChronicleIfNeeded = async () => {
    const s = useStore.getState();
    const total = s.chronicle.length;
    if (total < CHRONICLE_FOLD_AT) return;
    const foldCount = total - CHRONICLE_KEEP;
    const head = s.chronicle.slice(0, foldCount);
    const events = head.map((c) => `${c.turn}. ${c.text}`).join('\n');
    try {
      const merged = await chat(
        [
          { role: 'system', content: FOLD_SYSTEM },
          {
            role: 'user',
            content: `已有摘要：\n${s.summary || '（无）'}\n\n新增事件：\n${events}`,
          },
        ],
        { ...s.config, maxTokens: 1024, temperature: 0.4 }
      );
      if (merged.trim()) useStore.getState().foldChronicle(foldCount, merged.trim());
    } catch (e) {
      // 压缩失败不是致命问题：日志还在，下次会重试
      console.warn('[跑团] 摘要压缩失败，保留完整日志', e);
    }
  };

  /** 流式过程中屏蔽尚未写完的 JSON 契约块，并清掉模型偶发的"过程性"文字 */
  const visible = (raw: string) => {
    const i = raw.search(/```json/i);
    return stripMeta(i >= 0 ? raw.slice(0, i) : raw);
  };

  const sendToGm = async (engineNote?: string) => {
    if (streaming) return;
    if (!config.apiKey) {
      addMessage({
        role: 'system',
        content: '请先在设置里填写 API Key',
      });
      setShowSettings(true);
      return;
    }

    const rs = getRuleset(rulesetId);
    const snapshot = useStore.getState().messages;
    // 回合开始：拍下状态快照，供「回溯 / 重掷」恢复
    const lastPlayer = [...snapshot].reverse().find((m) => m.role === 'player');
    if (lastPlayer) useStore.getState().snapshotTurn(lastPlayer.id);
    // 世界书只注入命中关键词的条目，全量塞进去会撑爆上下文
    const context = snapshot.slice(-4).map((m) => m.content);
    if (engineNote) context.push(engineNote);

    const systemPrompt = buildSystemPrompt({
      rulesetName: rs.name,
      genre: getGenre(useStore.getState().genreId, useStore.getState().customGenres),
      module: gameModule,
      character,
      playerAddress: addressOf(character),
      gameState,
      worldbook: selectWorldbook(worldbook, context),
      chronicle,
      summary,
      recentChecks: snapshot
        .filter((m) => m.check)
        .slice(-6)
        .map((m) => ({
          skill: m.check!.skill,
          roll: m.check!.roll,
          label: m.check!.label,
        })),
    });

    const turns = buildMessages(systemPrompt, snapshot);
    if (engineNote) turns.push({ role: 'user', content: engineNote });

    const gmId = addMessage({ role: 'gm', content: '' });
    setStreaming(true);
    const ctrl = new AbortController();
    abortRef.current = ctrl;

    /** 流式输出：网络中途断开时自动重试一次（从头再来，避免留下半截内容） */
    const streamFull = async (ts: ChatTurn[]): Promise<string> => {
      let out = '';
      for (let attempt = 0; ; attempt++) {
        try {
          for await (const chunk of streamChat(ts, config, ctrl.signal)) {
            out += chunk;
            updateMessage(gmId, { content: visible(out) });
          }
          return out;
        } catch (e) {
          if ((e as Error).name === 'AbortError') throw e;
          // 明确的服务端错误（有 status）不重试；网络抖动（无 status）重试一次
          const isHttpError = e instanceof ModelError && typeof e.status === 'number';
          if (isHttpError || attempt >= 1) throw e;
          out = '';
          updateMessage(gmId, { content: '（网络中断，重试中…）' });
        }
      }
    };

    let full = '';
    try {
      full = await streamFull(turns);

      let { body, contract } = extractContract(full);

      // 兜底：模型偶尔会拒绝玩家，或抢在引擎前把"检定结果"写进正文。
      // 这两类都破坏沉浸感，这里追加纠正指令重新生成一次。
      const retryWith = async (note: string) => {
        full = '';
        updateMessage(gmId, { content: '' });
        const retryTurns = [...turns, { role: 'user' as const, content: note }];
        for await (const chunk of streamChat(retryTurns, config, ctrl.signal)) {
          full += chunk;
          updateMessage(gmId, { content: visible(full) });
        }
        ({ body, contract } = extractContract(full));
      };

      if (isRefusal(stripMeta(body))) {
        await retryWith(RETRY_NOTE);
      } else if (isCheckLeak(stripMeta(body))) {
        await retryWith(CHECK_RETRY_NOTE);
      } else if (!contract && stripMeta(body).trim()) {
        // 正文写好了却漏了 JSON 契约：这一轮的状态会整个丢掉，值得重写一次
        await retryWith(CONTRACT_RETRY_NOTE);
      }

      const npcLines = contract?.npc_lines ?? [];
      const finalBody = dedupeNpcLines(stripMeta(body), npcLines);
      updateMessage(gmId, {
        content: finalBody || '（模型没有返回叙事内容）',
        npcLines,
      });
      // 剧情里出现了候选队友的名字 → 标记为"已登场"（未登场不可入队）
      useStore.getState().markCandidatesMet(finalBody);

      if (contract) {
        if (contract.state_delta?.length) applyModelDeltas(contract.state_delta as never);
        if (contract.location && contract.location !== gameState.location) {
          applyModelDeltas([
            { target: 'location', op: 'set', value: contract.location },
          ] as never);
        }
        if (contract.summary_delta) addChronicle(contract.summary_delta);
        if (contract.dice_requests?.length) {
          const req = contract.dice_requests[0]!;
          // 一键掷骰：把请求挂起来，界面给一个直接的「掷骰」按钮
          useStore.getState().setPendingCheck({
            skill: req.skill,
            difficulty: req.difficulty,
            reason: req.reason,
          });
        }
      }
    } catch (e) {
      if ((e as Error).name === 'AbortError') {
        updateMessage(gmId, { content: visible(full) + '\n\n_（已中断）_' });
      } else {
        const msg = e instanceof ModelError ? e.message : `出错了：${(e as Error).message}`;
        updateMessage(gmId, { content: `> ${msg}` });
      }
    } finally {
      setStreaming(false);
      abortRef.current = null;
    }

    // 放在流结束之后：玩家已经在读文本了，压缩不占用等待时间
    await foldChronicleIfNeeded();
  };

  const handleSend = async (text: string) => {
    addMessage({ role: 'player', content: text });
    await sendToGm();
  };

  const handleCheck = async (
    skill: string,
    difficulty: Difficulty,
    target = '',
    action = ''
  ) => {
    if (streaming) return;
    const badge = skillCheck(skill, difficulty);
    // 判定音效：只在大成功 / 大失败这两个"值得记住的瞬间"响
    const audioCfg = useStore.getState().audio;
    if (audioCfg.enabled) {
      if (badge.tier === 'critical') void playSfx('critical', audioCfg.sfxVol);
      else if (badge.tier === 'fumble') void playSfx('fumble', audioCfg.sfxVol);
    }
    const difficultyText =
      difficulty === 'hard' ? '（困难）' : difficulty === 'extreme' ? '（极难）' : '';
    const difficultyLabel =
      difficulty === 'hard' ? '困难' : difficulty === 'extreme' ? '极难' : '常规';
    const targetText = target ? `对${target}` : '';
    // 玩家写了行为描述就优先用它（行为+检定合一）；没写才用默认文案
    const content = action.trim()
      ? `${action.trim()}（${skill}${difficultyText}${targetText ? '·' + targetText : ''}）`
      : `${targetText}进行${skill}检定${difficultyText}`;
    addMessage({
      role: 'player',
      content,
      check: badge,
    });
    const note = `【引擎判定，不可更改】玩家${targetText}进行${skill}检定（难度：${difficultyLabel}），目标值 ${
      badge.target
    }%，掷出 ${badge.roll}，结果：${badge.label}。${
      action.trim() ? `玩家想做的是：${action.trim()}` : ''
    } 请严格依据这个结果续写剧情，不要替玩家发起新动作。`;
    await sendToGm(note);
  };

  const abort = () => abortRef.current?.abort();

  /** 一键掷骰：响应守密人请求的检定，不用再选难度/对象 */
  const quickCheck = async (skill: string, difficulty?: string) => {
    useStore.getState().setPendingCheck(null);
    await handleCheck(skill, (difficulty as Difficulty) ?? 'regular', '', '');
  };

  /** 用当前模组 + 角色卡开一团新游戏：清空剧情与进度，重新生成开场 */
  const startNew = () => {
    if (streaming) return;
    const s = useStore.getState();
    const hasProgress =
      s.messages.length > 1 ||
      s.chronicle.length > 0 ||
      s.gameState.clues.length > 0 ||
      s.gameState.inventory.length > 0;
    if (hasProgress) {
      setPendingStart(true);
      return;
    }
    doStartNew();
  };

  const doStartNew = () => {
    useStore.getState().startNewGame();
    setPendingStart(false);
    setShowPrep(false);
    setShowSettings(false);
    setMobilePanel('chat');
    setDraft('');
    setToast('已开新团，按模组开场');
    setTimeout(() => setToast(''), 2200);
  };

  /** 回溯到某条玩家消息之前：恢复当时状态、截断其后消息，并把内容填回输入框以便改完重发 */
  const rewindTo = (msgId: string) => {
    if (streaming) return;
    const s = useStore.getState();
    const pm = s.messages.find((m) => m.id === msgId);
    if (!pm || pm.role !== 'player') return;
    s.rewindBefore(msgId);
    setDraft(pm.content);
    setMobilePanel('chat');
  };

  /** 重掷：回溯到触发上一条 GM 回复的玩家消息，然后重新执行（检定则重掷骰子） */
  const rerollLast = async () => {
    if (streaming) return;
    const s = useStore.getState();
    const msgs = s.messages;
    let gi = -1;
    for (let i = msgs.length - 1; i >= 0; i--) {
      if (msgs[i]!.role === 'gm') {
        gi = i;
        break;
      }
    }
    if (gi < 0) return;
    let pi = -1;
    for (let i = gi - 1; i >= 0; i--) {
      if (msgs[i]!.role === 'player') {
        pi = i;
        break;
      }
    }
    if (pi < 0) return;
    const pm = msgs[pi]!;
    s.rewindBefore(pm.id);
    setMobilePanel('chat');
    if (pm.check) {
      const badge = useStore
        .getState()
        .skillCheck(pm.check.skill, pm.check.difficulty ?? 'regular');
      useStore.getState().addMessage({ role: 'player', content: pm.content, check: badge });
      await sendToGm(
        `【引擎判定，不可更改】玩家进行${pm.check.skill}检定，目标值 ${badge.target}%，掷出 ${badge.roll}，结果：${badge.label}。请严格依据这个结果续写剧情。`
      );
    } else {
      useStore.getState().addMessage({ role: 'player', content: pm.content });
      await sendToGm();
    }
  };

  /** 点击队友：在输入框唤起 TA，并切回故事页 */
  const promptCompanion = (name: string) => {
    setDraft((d) => (d.trim() ? d : `让${name}：`));
    setMobilePanel('chat');
  };

  /** 点地图上的地点即动身：直接发给守密人，路上的转场由他替你演 */
  const travelTo = (location: string) => {
    if (streaming) return;
    setMobilePanel('chat');
    void handleSend(`（我前往${location}）`);
  };

  const panelBtn = (key: Panel, label: string, hint: string) => (
    <button
      key={key}
      onClick={() => setMobilePanel(key)}
      className={`relative flex-1 py-3 text-[13px] transition ${
        mobilePanel === key ? 'text-gold-400' : 'text-mist-400'
      }`}
    >
      {label}
      <span className="ml-1 hidden text-[10px] text-mist-500/70 sm:inline">{hint}</span>
      {mobilePanel === key && (
        <span className="absolute inset-x-6 top-0 h-0.5 rounded-full bg-gold-500" />
      )}
    </button>
  );

  return (
    <div className="flex h-full flex-col bg-ink-950">
      <header className="safe-top flex shrink-0 items-center justify-between gap-2 border-b border-ink-700 bg-ink-900/90 px-4 py-2 backdrop-blur">
        <div className="flex min-w-0 items-baseline gap-2.5">
          <h1 className="shrink-0 font-serif text-[16px] tracking-wide text-mist-100">
            跑团模拟器
          </h1>
          <span className="truncate text-[11px] text-mist-400">
            {getRuleset(rulesetId).name} · {getGenre(genreId, customGenres).name}
          </span>
        </div>
        <div className="flex shrink-0 items-center gap-1.5">
          {!config.apiKey && (
            <button
              onClick={() => setShowSettings(true)}
              className="rounded-full border border-gold-600/50 bg-gold-500/10 px-2.5 py-1 text-[11px] text-gold-400 transition hover:bg-gold-500/20"
            >
              未配置 API
            </button>
          )}
          <button
            onClick={startNew}
            className="rounded-md border border-gold-600/60 bg-gold-500/10 px-3 py-1.5 text-[13px] font-medium text-gold-400 transition hover:bg-gold-500/20"
          >
            开团
          </button>
          <button
            onClick={() => setShowPrep(true)}
            className="rounded-md border border-ink-600 px-3 py-1.5 text-[13px] text-mist-300 transition hover:border-gold-600/50 hover:text-mist-100"
          >
            准备
          </button>
          <button
            onClick={() => setShowSettings(true)}
            className="rounded-md border border-ink-600 px-3 py-1.5 text-[13px] text-mist-300 transition hover:border-gold-600/50 hover:text-mist-100"
            title="快捷键：Cmd/Ctrl + ,"
          >
            设置
          </button>
        </div>
      </header>

      <div className="flex min-h-0 flex-1">
        <aside className="hidden w-64 shrink-0 overflow-y-auto border-r border-ink-700 bg-ink-900 lg:block xl:w-72">
          <CharacterSheet onRequestCheck={setCheckSkill} />
        </aside>

        <main className="min-w-0 flex-1">
          <div className={mobilePanel === 'chat' ? 'h-full' : 'hidden h-full lg:block'}>
            <Chat
              onSend={handleSend}
              onAbort={abort}
              draft={draft}
              setDraft={setDraft}
              onRewind={rewindTo}
              onReroll={rerollLast}
              onQuickCheck={quickCheck}
            />
          </div>
          <div className={mobilePanel === 'character' ? 'h-full lg:hidden' : 'hidden'}>
            <div className="h-full overflow-y-auto">
              <CharacterSheet onRequestCheck={setCheckSkill} />
            </div>
          </div>
          <div className={mobilePanel === 'world' ? 'h-full lg:hidden' : 'hidden'}>
            <div className="h-full overflow-y-auto">
              <WorldPanel onPromptCompanion={promptCompanion} onTravel={travelTo} />
            </div>
          </div>
        </main>

        <aside className="hidden w-64 shrink-0 overflow-y-auto border-l border-ink-700 bg-ink-900 lg:block xl:w-72">
          <WorldPanel onPromptCompanion={promptCompanion} onTravel={travelTo} />
        </aside>
      </div>

      <nav className="safe-bottom flex shrink-0 border-t border-ink-700 bg-ink-900 lg:hidden">
        {panelBtn('character', '角色', '⌘1')}
        {panelBtn('chat', '故事', '⌘2')}
        {panelBtn('world', '世界', '⌘3')}
      </nav>

      {showSettings && <Settings onClose={() => setShowSettings(false)} />}
      {showPrep && <Preparation onClose={() => setShowPrep(false)} onStartNew={startNew} />}
      {pendingStart && (
        <ConfirmDialog
          title={gameModule.title ? `开新团 · ${gameModule.title}` : '开新团'}
          body={`${
            gameModule.premise ? `${gameModule.premise}\n\n` : ''
          }（会清空当前剧情、线索与进度。角色卡、模组、世界书、队友都会保留。）`}
          confirmText="开团"
          onCancel={() => setPendingStart(false)}
          onConfirm={doStartNew}
        />
      )}
      {toast && (
        <div className="pointer-events-none fixed left-1/2 top-16 z-[70] -translate-x-1/2 rounded-full border border-moss-400/40 bg-ink-900/95 px-4 py-2 text-[12px] text-moss-400 shadow-lg">
          {toast}
        </div>
      )}
      {updateReady && (
        <div className="fixed inset-x-0 bottom-20 z-[75] flex justify-center px-4">
          <button
            onClick={() => void updateSW(true)}
            className="rounded-full border border-gold-500/60 bg-ink-900/95 px-4 py-2 text-[13px] text-gold-300 shadow-lg backdrop-blur"
          >
            有新版本 · 点击立即更新
          </button>
        </div>
      )}
      {welcome && (
        <div className="fixed inset-0 z-[80] flex items-center justify-center bg-black/70 p-4">
          <div className="max-h-[90vh] w-full max-w-md overflow-y-auto rounded-2xl border border-ink-600 bg-ink-900 p-6 shadow-2xl">
            <h2 className="font-serif text-lg text-gold-300">欢迎来到跑团模拟器</h2>
            <p className="mt-2 text-[13px] leading-relaxed text-mist-300">
              你是唯一的玩家，AI 当守密人。用自然语言描述你的行动，它会把故事接下去。
            </p>
            <ul className="mt-3 space-y-2 text-[12px] leading-relaxed text-mist-400">
              <li>
                <b className="text-mist-200">① 先在「准备」里</b>
                建一张角色卡、生成一个模组（或从文本导入）。
              </li>
              <li>
                <b className="text-mist-200">② 在「设置」里</b>
                填 API Key 和模型。
              </li>
              <li>
                <b className="text-mist-200">③ 开场后</b>
                直接用大白话行动——"我推门进去""我问他女儿什么时候失踪的"，不用加任何标记。
              </li>
              <li>
                <b className="text-mist-200">④ 要检定时</b>
                点角色卡里的技能，或者等守密人弹出"掷骰"按钮。
              </li>
              <li>
                <b className="text-mist-200">⑤ 迷路了？</b>
                看左侧「世界」面板顶部的「当前目标」——你要做什么、为什么是现在，都写在那儿。
              </li>
            </ul>
            <button
              onClick={() => {
                localStorage.setItem('trpg.welcomed', '1');
                setWelcome(false);
              }}
              className="mt-4 w-full rounded-lg bg-gold-500 px-4 py-2 text-[13px] font-medium text-ink-950 transition hover:bg-gold-400"
            >
              开始冒险
            </button>
          </div>
        </div>
      )}
      {checkSkill && (
        <CheckDialog
          skill={checkSkill}
          onCancel={() => setCheckSkill(null)}
          onConfirm={(target, action) => {
            const skill = checkSkill;
            setCheckSkill(null);
            void handleCheck(skill, 'regular', target, action);
          }}
        />
      )}
    </div>
  );
}
