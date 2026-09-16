import { useEffect, useRef, useState } from 'react';
import { useStore, addressOf, resolveCheckTarget, checkTargetText } from './store';
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
  stripTravelEcho,
  dedupeNpcLines,
  isRefusal,
  isCheckLeak,
  RETRY_NOTE,
  CHECK_RETRY_NOTE,
  CONTRACT_ONLY_NOTE,
} from '../orchestrator/prompt.js';
import { playSfx, resumeAudio, startAmbience, startBgm, stopBgm, stopAmbience, stopSfx } from './audio.js';
import {
  canInstall,
  initInstallPrompt,
  onInstallAvailable,
  promptInstall,
  updateSW,
} from '../pwa.js';
import { streamChat, chat, ModelError, type ChatTurn } from '../providers/model.js';
import { FOLD_SYSTEM, endingSystemPrompt } from '../orchestrator/generate.js';
import { EndingScreen } from './EndingScreen';
import { TestSandbox } from './TestSandbox';
import { applyUpdate, checkForUpdate, watchForUpdates } from '../update.js';
import { ChangelogDialog, hasUnreadChangelog, markChangelogRead } from './Changelog';
import { HelpDialog } from './HelpGuide';
import { getRuleset } from '../core/rulesets/index.js';
import { getGenre } from '../core/genres.js';
import type { Ending } from '../core/state/gameState.js';
import { encumbranceNote } from '../core/encumbrance.js';

type Panel = 'chat' | 'character' | 'world';

/**
 * 主动求死的识别。
 * 刻意偏窄——必须明确表达"要结束自己的角色"，单纯的冒险/试探（"我跳河看看"）不算。
 */
const SUICIDE_RE =
  /(自杀|自尽|寻死|想死|不想活|活不下去|了结自己|了结这一切|结束这一切|放弃抵抗|不再挣扎|任由(自己)?沉|求死|自我了断)/;

/** 结局正文要不来时的兜底：必须是"故事里的句子"，不能变成程序提示 */
const FALLBACK_ENDING: Record<string, string> = {
  death:
    '意识一层层退下去，最后剩下的是很远处的声音。故事在这里断了线——具体断在哪一处，要看你自己记得的那一段。',
  insanity:
    '他终于看清了那件东西本来的样子。只是从这一刻起，再也分不清哪些是眼前的、哪些不是了。',
  success: '你要做的那件事做成了。身后的事还在继续，但对你来说，它已经结束了。',
  failure: '最后还是没有拦住。该来的都来了，你只能看着它发生。',
  grey: '你活着出来了，但不是全身而退——有些东西留在了那里，再也拿不回来。',
  other: '事情告一段落。留下来的东西比带走的要多。',
};

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
    lastChanges,
  } = useStore();

  const [showSettings, setShowSettings] = useState(false);
  const [showPrep, setShowPrep] = useState(false);
  const [mobilePanel, setMobilePanel] = useState<Panel>('chat');
  const [draft, setDraft] = useState('');
  const [checkSkill, setCheckSkill] = useState<string | null>(null);
  const [pendingStart, setPendingStart] = useState(false);
  const [toast, setToast] = useState('');
  const [updateReady, setUpdateReady] = useState(false);
  const [autoUpdating, setAutoUpdating] = useState(false);
  const [showEnding, setShowEnding] = useState(false);
  /** 被识别为"主动求死"的那句话，等玩家二次确认 */
  const [pendingSuicide, setPendingSuicide] = useState<string | null>(null);
  const [showSandbox, setShowSandbox] = useState(false);
  const [showChangelog, setShowChangelog] = useState(false);
  const [showHelp, setShowHelp] = useState(false);
  /** 音频开关的界面状态（与 store 里的 audio.enabled 同步） */
  const [audioOn, setAudioOn] = useState(() => useStore.getState().audio.enabled);
  const devMode = useStore((s) => s.devMode);
  const [installable, setInstallable] = useState(false);
  /** 安装提示被玩家关掉后就不再烦他（记在 localStorage） */
  const [installHintHidden, setInstallHintHidden] = useState(
    () => localStorage.getItem('trpg.installHint') === '1'
  );
  const [welcome, setWelcome] = useState(() => !localStorage.getItem('trpg.welcomed'));
  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
  }, [theme]);

  // PWA：截住浏览器的"可安装"事件，攒着等用户主动点安装
  useEffect(() => {
    initInstallPrompt();
    const sync = () => setInstallable(canInstall());
    sync();
    return onInstallAvailable(sync);
  }, []);

  /* 状态变化提示：自动收起（玩家也可以手动关） */
  useEffect(() => {
    if (!lastChanges) return;
    const t = setTimeout(() => useStore.getState().clearChanges(), 9000);
    return () => clearTimeout(t);
  }, [lastChanges?.id]);

  /*
   * 新版本进来时自动弹一次更新日志。
   * 跳过"全新用户"——那种情况欢迎页更重要，两个弹窗叠在一起很烦。
   */
  useEffect(() => {
    if (localStorage.getItem('trpg.welcomed') !== '1') return;
    if (hasUnreadChangelog()) setShowChangelog(true);
  }, []);

  /*
   * 重新打开页面时，如果这一局已经结档了（结局正文也写好了），把结档页顶上来。
   * 只看 `text` 有值的：空 text 表示"结论已定但守密人还没写结局"，那还是留在故事页。
   */
  const endedText = gameState.ending?.text ?? '';
  useEffect(() => {
    if (endedText) setShowEnding(true);
  }, [endedText]);

  /*
   * 新版本检测，两条独立的路都汇到同一个横幅：
   * 1. Service Worker 报"有新版本"（registerType: 'prompt'）
   * 2. **版本号探测**：启动 / 回到前台 / 每 5 分钟各探一次 version.json
   *
   * 只做第 1 条是不够的——内嵌浏览器（在微信里打开）与部分手机上 SW 的更新检测未必触发，
   * 玩家就会一直卡在旧版本里，然后问"我改了你怎么还是旧的"。
   */
  useEffect(() => {
    /**
     * **自动更新一次**（自愈）。
     *
     * 为什么需要：横幅要玩家点，而"点了没反应 / 根本没弹 / 不知道要点"这三种情况
     * 都会让他一直卡在旧包里——这就是"更新问题"反复复发的样子。
     * 现在探测到线上确实更新时，**主动替他清缓存重来一次**，他要做的只是等三秒。
     *
     * 为什么不会死循环：`localStorage` 记了上次自动更新的时间，10 分钟内不再自动。
     * 万一这次硬重置还是没换到新版，横幅照样在，他还能手动点或去设置里强制重载。
     */
    const AUTO_KEY = 'trpg:autoUpdateAt';
    const COOLDOWN = 10 * 60 * 1000;
    const maybeAutoUpdate = () => {
      try {
        const last = Number(localStorage.getItem(AUTO_KEY) ?? 0);
        if (Date.now() - last < COOLDOWN) return;
        localStorage.setItem(AUTO_KEY, String(Date.now()));
      } catch {
        return; // 存不了就别自动了，交给手动
      }
      setAutoUpdating(true);
      window.setTimeout(() => void applyUpdate(), 2500);
    };

    const onUpdate = () => {
      setUpdateReady(true);
      maybeAutoUpdate();
    };
    window.addEventListener('trpg:update-ready', onUpdate);
    const stop = watchForUpdates(onUpdate);
    return () => {
      window.removeEventListener('trpg:update-ready', onUpdate);
      stop();
    };
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

  /** 音频控制坞用：随时一键静音 / 恢复（BGM + 氛围音 + 正在播的音效） */
  const toggleAudio = () => {
    const a = useStore.getState().audio;
    const setAudio = useStore.getState().setAudio;
    if (a.enabled) {
      stopBgm();
      stopAmbience();
      stopSfx();
      setAudio({ enabled: false });
      setAudioOn(false);
      return;
    }
    setAudio({ enabled: true });
    setAudioOn(true);
    void resumeAudio().then(() => {
      const cur = useStore.getState().audio;
      startAmbience(cur.ambience, cur.ambienceVol);
      void startBgm(cur);
    });
  };

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

  /**
   * 流式过程中屏蔽尚未写完的 JSON 契约块，并清掉模型偶发的"过程性"文字。
   * 模板清洗也放在这里：落库前再洗一次已经太晚，流式时玩家已经看见了（协作方 N1）。
   */
  const visible = (raw: string) => {
    const i = raw.search(/```json/i);
    return stripTravelEcho(stripMeta(i >= 0 ? raw.slice(0, i) : raw));
  };

  /**
   * 结档之后不再接受新行动。
   *
   * 用户定调"死亡 = 结档"：这段故事已经收束，继续往里输入只会破坏它。
   * 想继续玩，走回溯或开新团——两条路都在结档页上摆着。
   */
  const blockedByEnding = () => {
    if (!useStore.getState().gameState.ending) return false;
    setToast('这一局已经结档了 —— 回溯到关键抉择，或用这个模组再开一局');
    setTimeout(() => setToast(''), 3200);
    return true;
  };

  const sendToGm = async (engineNote?: string) => {
    if (streaming) return;
    if (blockedByEnding()) return;
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
    /*
     * 濒死引导：**一次性**，取走即清。
     * 上一轮结束时引擎把玩家标成了濒死并冻结了生命，这一轮要守密人给出施救的路，
     * 而不是直接收束。放在 engineNote 之后——它是本轮最要紧的一条。
     */
    const dyingNote = useStore.getState().consumeDyingNote();
    /*
     * 超重提示：只在真的超重时才说，且不报数字。
     * 它是持续状态（不是一次性事件），所以每轮都跟着——守密人很容易忘掉"你还扛着一箱子东西"。
     */
    const loadNote = encumbranceNote(useStore.getState().encumbrance());
    const notes = [engineNote, dyingNote, loadNote].filter(Boolean) as string[];
    const finalNote = notes.length ? notes.join('\n\n') : undefined;
    // 世界书只注入命中关键词的条目，全量塞进去会撑爆上下文
    const context = snapshot.slice(-4).map((m) => m.content);
    if (finalNote) context.push(finalNote);

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
        .flatMap((m) => m.checks ?? (m.check ? [m.check] : []))
        .slice(-6)
        .map((b) => ({ skill: b.skill, roll: b.roll, label: b.label })),
    });

    const turns = buildMessages(systemPrompt, snapshot);
    if (finalNote) turns.push({ role: 'user', content: finalNote });

    const gmId = addMessage({ role: 'gm', content: '' });
    setStreaming(true);
    const ctrl = new AbortController();
    abortRef.current = ctrl;

    /*
     * 流式输出：网络中途断开时自动重试一次。
     *
     * **重试绝不清屏**（协作方 B4）：早期这里先 `out=''` 再把消息清空，
     * 玩家看到的就是"写了一半突然没了"。现在保留已显示的内容，
     * 只在末尾挂一条提示；等新内容长到超过旧内容再整体替换，
     * 屏幕上永远是"在变长"，不会闪一下空白。
     */
    const streamFull = async (ts: ChatTurn[]): Promise<string> => {
      let shown = '';
      for (let attempt = 0; ; attempt++) {
        let buf = '';
        try {
          for await (const chunk of streamChat(ts, config, ctrl.signal)) {
            buf += chunk;
            if (attempt === 0 || buf.length >= shown.length) {
              shown = buf;
              updateMessage(gmId, { content: visible(buf) });
            }
          }
          return buf;
        } catch (e) {
          if ((e as Error).name === 'AbortError') throw e;
          // 明确的服务端错误（有 status）不重试；网络抖动（无 status）重试一次
          const isHttpError = e instanceof ModelError && typeof e.status === 'number';
          if (isHttpError || attempt >= 1) throw e;
          shown = buf;
          updateMessage(gmId, {
            content: visible(buf) ? `${visible(buf)}\n\n_（网络中断，正在重试…）_` : '（网络中断，正在重试…）',
          });
        }
      }
    };

    let full = '';
    try {
      full = await streamFull(turns);

      let { body, contract } = extractContract(full);

      // 兜底：模型偶尔会拒绝玩家，或抢在引擎前把"检定结果"写进正文。
      // 这两类都破坏沉浸感，这里追加纠正指令重新生成一次。
      // 同样**不清屏**：新内容长过旧内容才替换。
      const retryWith = async (note: string) => {
        let buf = '';
        const retryTurns = [...turns, { role: 'user' as const, content: note }];
        // 重写期间给一句可见的反馈：不然屏幕上内容一动不动，像卡死了（协作方 N5 折中）
        if (full.trim()) {
          updateMessage(gmId, { content: `${visible(full)}\n\n_（守密人在重写这一段…）_` });
        }
        for await (const chunk of streamChat(retryTurns, config, ctrl.signal)) {
          buf += chunk;
          if (buf.length >= full.length) updateMessage(gmId, { content: visible(buf) });
        }
        full = buf;
        ({ body, contract } = extractContract(full));
      };

      /**
       * 只缺 JSON 契约时**不要重写正文**（协作方 B4）：
       * 整段重写会让屏幕上闪一下空白，代价远大于"这一轮状态不推进"。
       * 改成单独向模型要一个 JSON 块，正文原样保留；要不来就接受本轮无契约。
       */
      const requestContractOnly = async (bodyText: string) => {
        try {
          const raw = await chat(
            [
              ...turns,
              { role: 'assistant' as const, content: bodyText },
              { role: 'user' as const, content: CONTRACT_ONLY_NOTE },
            ],
            { ...config, maxTokens: 1024, temperature: 0.3 }
          );
          return extractContract(raw).contract;
        } catch {
          return null;
        }
      };

      if (isRefusal(stripMeta(body))) {
        await retryWith(RETRY_NOTE);
      } else if (isCheckLeak(stripMeta(body))) {
        await retryWith(CHECK_RETRY_NOTE);
      } else if (!contract && stripMeta(body).trim()) {
        const only = await requestContractOnly(stripMeta(body));
        if (only) contract = only;
      }

      const npcLines = contract?.npc_lines ?? [];
      const finalBody = dedupeNpcLines(stripTravelEcho(stripMeta(body)), npcLines);
      updateMessage(gmId, {
        content: finalBody || '（模型没有返回叙事内容）',
        npcLines,
      });

      /*
       * 关键决策点（回溯锚点）。
       * 结档时玩家要能从"值得重来的那几个岔路口"里挑一个退回去，
       * 而不是在上百条消息里翻。标记规则刻意保守：只标真正改变走向的回合。
       *
       * **事件与位移要分开对待**（协作方 3.2）：
       * - **位移**（location）：只在**首次到访该地点**时记。长局里来回跑腿几十次，
       *   每次都记会让结档页变成一串"移步：走廊"，把真正的岔路口淹没掉。
       * - **事件**（掷骰 / 战斗 / 新线索 / 新支线 / 受伤 / 理智受创）：**保持全记**，
       *   这些才是玩家真想回退的地方。
       */
      if (lastPlayer) {
        const reasons: string[] = [];
        if (lastPlayer.check) reasons.push(`掷骰：${lastPlayer.check.skill}`);
        for (const d of contract?.state_delta ?? []) {
          if (d.target === 'combat.active') reasons.push(d.value ? '进入战斗' : '战斗结束');
          else if (d.target === 'location') {
            // 首次到访才算锚点：走去过的地方不记，避免锚点被通勤淹没
            const dest = String(d.value ?? '');
            const known = useStore.getState().gameState.visited ?? [];
            if (dest && !known.includes(dest)) reasons.push(`移步：${dest}`);
          } else if (d.target === 'clues' && d.op === 'add') reasons.push('新线索');
          else if (d.target === 'threads' && d.op === 'add') reasons.push('新支线');
          else if (d.target === 'vitals.hp' && d.op === 'dec') {
            // 数值型只认"掉了不少"；骰子表达式（"1d6"这种真挨了一下）一律算
            if (typeof d.amount === 'string' || (typeof d.amount === 'number' && d.amount >= 3))
              reasons.push('受伤');
          } else if (d.target === 'vitals.san' && d.op === 'dec') {
            if (typeof d.amount === 'string' || (typeof d.amount === 'number' && d.amount >= 3))
              reasons.push('理智受创');
          }
        }
        if (reasons.length > 0) {
          /*
           * label 要能"一眼认出是哪一个岔路口"：只有"新线索"三个字，
           * 玩家在结档页看到一列相同的标签根本不知道该退回哪一步（协作方 H）。
           */
          const turnNo = useStore.getState().chronicle.length;
          const acted = lastPlayer.content
            .replace(/[（(][^）)]*[）)]\s*$/, '')
            .trim();
          const snippet = (acted || lastPlayer.check?.skill || '抉择').slice(0, 16);
          const label = `第${turnNo}回 · ${snippet} · ${reasons[0]}`;
          /*
           * 连续两条完全相同的 label 折叠成一条：
           * "掷骰：侦查 → 新线索 → 掷骰：侦查"这种连续同质回合不值得各占一格。
           * 拿**上一次被标记的那条**比（不是上一条快照）。
           */
          const snaps = useStore.getState().snapshots;
          const labels = Object.values(snaps)
            .filter((s) => s.key)
            .map((s) => s.label ?? '');
          if (labels[labels.length - 1] !== label) {
            useStore.getState().markSnapshotKey(lastPlayer.id, label);
          }
        }
      }
      // 剧情里出现了候选队友的名字 → 标记为"已登场"（未登场不可入队）
      useStore.getState().markCandidatesMet(finalBody);

      if (contract) {
        /*
         * 音效触发点：受伤 / 理智受创 / 进入战斗。
         * 在这一层做（而不是放在 store 里）是因为只有这里分得清"这一轮到底发生了什么"——
         * 读档、回溯、测试沙盒灌数据时不该响音效。
         */
        const before = useStore.getState().gameState;
        if (contract.state_delta?.length) applyModelDeltas(contract.state_delta as never);
        if (contract.location && contract.location !== gameState.location) {
          applyModelDeltas([
            { target: 'location', op: 'set', value: contract.location },
          ] as never);
        }
        if (contract.summary_delta) addChronicle(contract.summary_delta);

        /*
         * 收束声明：守密人判断模组预设的某个结局成立了。
         *
         * 以前**没有任何路径**能让"玩家达成了目标"这件事结束一局——
         * 引擎只会因为生命/理智归零而结档，模组里那三条 endings 纯粹是给模型看的文本。
         * 于是玩家上了救生艇、划远了（本来就是模组写的"成功：跳船逃生"），
         * 故事却继续往一个模组里没有的荒岛续写，最后在荒岛上流血而死（用户 2026-09-16 实测）。
         *
         * 这里只负责写下"空正文的 ending"，结局正文由下面的唯一出口去要。
         * **死亡与疯狂优先**：引擎已经判了 death / insanity 时，不接受模型来"降级"成 success。
         */
        const declared = contract.ending?.kind;
        const declaredKind =
          declared === 'success' || declared === 'failure' || declared === 'grey'
            ? declared
            : null;
        if (declaredKind) {
          const cur = useStore.getState().gameState.ending;
          const severe = cur?.kind === 'death' || cur?.kind === 'insanity';
          if (!cur || (!severe && !cur.text)) {
            useStore.getState().forceEnding(declaredKind, contract.ending?.reason);
          }
        }

        const after = useStore.getState().gameState;
        const now = useStore.getState().audio;
        if (now.enabled) {
          const hpDrop = (before.vitals.hp ?? 0) - (after.vitals.hp ?? 0);
          const sanDrop = (before.vitals.san ?? 0) - (after.vitals.san ?? 0);
          if (!before.combat.active && after.combat.active) {
            void playSfx('combat', now.sfxVol);
          } else if (hpDrop >= 2) {
            void playSfx('hurt', now.sfxVol);
          } else if (sanDrop >= 2) {
            void playSfx('sanloss', now.sfxVol);
          }
        }
        /*
         * 一键掷骰：把**全部**检定请求挂进队列，界面逐个给出「掷骰」按钮。
         * 早期只取 dice_requests[0]，一轮里要求两个检定时后一个会被整个丢掉。
         * 与队列里已有的项合并（按技能去重、最多留 6 条），避免手滑漏掉某一条。
         */
        if (contract.dice_requests?.length) {
          const store = useStore.getState();
          const merged = [...store.pendingChecks];
          for (const r of contract.dice_requests) {
            if (!merged.some((x) => x.skill === r.skill)) {
              merged.push({ skill: r.skill, difficulty: r.difficulty, reason: r.reason });
            }
          }
          const queue = merged.slice(-6);
          store.setPendingChecks(queue);
          // 同一份队列也写进这一回合的快照：回溯回来时它还在
          if (lastPlayer) store.setSnapshotPendingChecks(lastPlayer.id, queue);
        }
      }
    } catch (e) {
      // 请求没成功就把一次性引导还回去，玩家重试时还能拿到（失败不该消耗掉它）
      if (dyingNote) useStore.getState().setDyingNote(dyingNote);
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

    /*
     * 结档不在这里触发——统一由下面的「结档唯一出口」处理。
     * 以前只有这条路会去要结局正文，于是别的来源置上 ending 时什么都不会发生。
     */
  };

  /** 向守密人要一段结局正文（结档页用） */
  const requestEnding = async (kind: Ending['kind']) => {
    const s = useStore.getState();
    // 结档音：缓慢下行的长音，让"到这里结束了"这件事落地
    if (s.audio.enabled) void playSfx('ending', s.audio.sfxVol);
    try {
      const text = await chat(
        [
          {
            role: 'system',
            content: endingSystemPrompt(
              kind,
              getGenre(s.genreId, s.customGenres),
              s.module,
              s.character
            ),
          },
          {
            role: 'user',
            content:
              `这是这一局最后发生的事：\n${s.chronicle
                .slice(-10)
                .map((c) => `${c.turn}. ${c.text}`)
                .join('\n')}\n\n请写结局。`,
          },
        ],
        { ...s.config, maxTokens: 900, temperature: 0.9 }
      );
      useStore.getState().setEnding(kind, text.trim());
    } catch {
      /* 要不到正文也要结档，给一句不跳出戏的兜底 */
      useStore.getState().setEnding(kind, FALLBACK_ENDING[kind] ?? FALLBACK_ENDING.other!);
    }
  };

  /*
   * 结档的**唯一出口**。
   *
   * 引擎只负责把 `ending = { kind, text: '' }` 写上（正文永远是空），
   * "去要一段结局正文"这件事以前只写在两条路上：守密人回合结束、主动求死。
   * 于是任何**别的**来源把 ending 置上（测试沙盒把生命清零、以后可能加的其它裁决）
   * 都只会静默写下一个空 ending —— 屏幕上什么都不发生，玩家以为没结档。
   *
   * 现在统一在这里兜住：只要出现"没有正文的 ending"，就去找守密人要一段。
   * 用 at 时间戳去重，避免同一次结档被要两遍。
   */
  const endingAt = useStore((s) => s.gameState.ending?.at ?? '');
  const endingText = useStore((s) => s.gameState.ending?.text ?? '');
  const endingKind = useStore((s) => s.gameState.ending?.kind ?? 'other');
  const endingAskedRef = useRef('');
  useEffect(() => {
    if (!endingAt || endingText) return;
    if (endingAskedRef.current === endingAt) return;
    endingAskedRef.current = endingAt;
    void (async () => {
      await requestEnding(endingKind);
      setShowEnding(true);
    })();
  }, [endingAt, endingText, endingKind]);

  const handleSend = async (text: string) => {
    // 先拦，避免留下一条永远等不到回应的玩家消息
    if (blockedByEnding()) return;
    /*
     * 主动求死：**引擎直接结算，不发给模型**。
     *
     * 为什么：模型对自杀有安全对齐，最常见的反应是写一段劝诫、或者让旁人"刚好"把你救起来。
     * 玩家的意志被系统否决，既出戏又冒犯人。这件事必须由引擎说了算。
     * 但要先确认一次——"我跳河看看"和"我跳河自尽"是两回事。
     */
    if (SUICIDE_RE.test(text)) {
      setPendingSuicide(text);
      return;
    }
    addMessage({ role: 'player', content: text });
    await sendToGm();
  };

  const handleCheck = async (
    skill: string,
    difficulty: Difficulty,
    target = '',
    action = '',
    bonus = 0
  ) => {
    if (streaming) return;
    if (blockedByEnding()) return;
    const badge = skillCheck(skill, difficulty, bonus);
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
    const note =
      `【引擎判定，不可更改】玩家${targetText}进行${skill}检定（难度：${difficultyLabel}），` +
      `${checkTargetText(badge)}，掷出 ${badge.roll}，结果：${badge.label}。` +
      `${action.trim() ? `玩家想做的是：${action.trim()}。` : ''}` +
      '请严格依据这个结果续写剧情，不要替玩家发起新动作。' +
      '**这条结果已经由界面上的卡片单独呈现，你的正文里一个字都不要提' +
      '“检定/判定/掷骰/成功/失败”——把结论化成事实写出来即可。**';
    await sendToGm(note);
  };

  const abort = () => abortRef.current?.abort();

  /**
   * 一键掷骰：响应守密人请求的检定，不用再选难度/对象。
   * `index` 是它在待掷队列里的位置——掷掉它，后面的继续排队。
   */
  const quickCheck = async (skill: string, difficulty?: string, index = 0) => {
    useStore.getState().removePendingCheck(index);
    await handleCheck(skill, (difficulty as Difficulty) ?? 'regular', '', '');
  };

  /**
   * 一次全掷：把待掷队列里的检定全部掷掉，结果合成**一条玩家消息**（多张卡片），
   * 只让守密人回一轮。否则连着两次检定要来回两次，剧情被切碎（协作方 R39）。
   */
  const rollAllChecks = async () => {
    if (streaming || blockedByEnding()) return;
    const store = useStore.getState();
    const list = [...store.pendingChecks];
    if (list.length === 0) return;
    store.clearPendingChecks();
    const badges = list.map((pc) =>
      useStore.getState().skillCheck(pc.skill, (pc.difficulty as Difficulty) ?? 'regular')
    );
    addMessage({ role: 'player', content: `（连续检定：${badges.map((b) => b.skill).join('、')}）`, checks: badges });
    const lines = badges
      .map((b) => `${b.skill}：${checkTargetText(b)}，掷出 ${b.roll}，结果 ${b.label}`)
      .join('；');
    await sendToGm(
      `【引擎判定，不可更改】玩家连续做了 ${badges.length} 次检定 —— ${lines}。` +
        '请严格依据这些结果续写剧情，不要替玩家发起新动作，' +
        '也不要在正文里复述"检定/判定/成功/失败"等字样——结果已经由界面卡片单独展示。'
    );
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
    setShowEnding(false);
    setMobilePanel('chat');
    setDraft('');
    setToast('已开新团，按模组开场');
    setTimeout(() => setToast(''), 2200);
    // 开团音：翻开了第一页
    const a = useStore.getState().audio;
    if (a.enabled) void playSfx('start', a.sfxVol);
  };

  /** 回溯到某条玩家消息之前：恢复当时状态、截断其后消息，并把内容填回输入框以便改完重发 */
  const rewindTo = (msgId: string) => {
    if (streaming) return;
    const s = useStore.getState();
    const pm = s.messages.find((m) => m.id === msgId);
    if (!pm || pm.role !== 'player') return;
    s.rewindBefore(msgId);
    /*
     * 回溯 = 把这段故事退回去，所以结档状态必须一起清掉。
     * 不清的话，玩家从结档页退回到中途，界面还会顶着"终幕"。
     */
    useStore.getState().clearEnding();
    setShowEnding(false);
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
        .skillCheck(pm.check.skill, pm.check.difficulty ?? 'regular', pm.check.bonus ?? 0);
      useStore.getState().addMessage({ role: 'player', content: pm.content, check: badge });
      await sendToGm(
        `【引擎判定，不可更改】玩家进行${pm.check.skill}检定，${checkTargetText(badge)}，` +
          `掷出 ${badge.roll}，结果：${badge.label}。请严格依据这个结果续写剧情，` +
          `不要在正文里复述“检定/判定/成功/失败”等字样。`
      );
    } else if (pm.checks?.length) {
      // 一次全掷过的那一轮：重掷就把每一条都重新掷一遍
      const badges = pm.checks.map((c) =>
        useStore.getState().skillCheck(c.skill, c.difficulty ?? 'regular', c.bonus ?? 0)
      );
      useStore.getState().addMessage({ role: 'player', content: pm.content, checks: badges });
      const lines = badges
        .map((b) => `${b.skill}：${checkTargetText(b)}，掷出 ${b.roll}，结果 ${b.label}`)
        .join('；');
      await sendToGm(
        `【引擎判定，不可更改】玩家连续做了 ${badges.length} 次检定 —— ${lines}。` +
          '请严格依据这些结果续写剧情，不要在正文里复述“检定/判定/成功/失败”等字样。'
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

  /**
   * 点地图上的地点：发出的是**意图**，不是"已经到达"。
   *
   * 为什么改：以前直接写成「我前往X」，等于替玩家落定了行程，
   * 守密人只能顺着演，于是玩家可以在地图上反复横跳、想去哪就去哪，
   * 模组的时间压力与封锁形同虚设。现在把决定权交回给世界——
   * 路封了、天黑了、有人拦着、他根本不知道路，都可以用剧情里的理由挡下来。
   */
  const travelTo = (location: string) => {
    if (streaming) return;
    setMobilePanel('chat');
    /*
     * 只发**最简意图**。
     * 早期把"这只是打算、去不了请用剧情理由拦下我"整段规则也写进玩家消息，
     * 结果模型最常见的反应就是把它**原样抄进正文**（协作方 B2 确诊）——
     * 玩家看到自己的括号被念出来，非常出戏。
     * 规则只留在系统提示词的【红线二之四】里，玩家消息不重复。
     */
    void handleSend(`（意图：前往「${location}」）`);
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
          {/* 常驻帮助入口：别只依赖"首次进入"那一次弹窗（协作方 R42） */}
          <button
            onClick={() => setShowHelp(true)}
            className="rounded-md border border-ink-600 px-2.5 py-1.5 text-[12px] text-mist-400 transition hover:border-gold-600/50 hover:text-mist-100"
            title="怎么玩（随时可看）"
          >
            ?
          </button>
          {/* 音频控制坞：玩的时候不用翻设置就能一键静音 / 掐掉正在播的音效 */}
          <button
            onClick={toggleAudio}
            className={`rounded-md border px-2 py-1.5 text-[12px] transition ${
              audioOn
                ? 'border-gold-600/50 text-gold-400 hover:bg-gold-500/10'
                : 'border-ink-600 text-mist-500 hover:text-mist-300'
            }`}
            title={audioOn ? '静音（背景音与音效一起）' : '打开音频'}
          >
            {audioOn ? '🔊' : '🔈'}
          </button>
          {audioOn && (
            <button
              onClick={() => stopSfx()}
              className="rounded-md border border-ink-600 px-2 py-1.5 text-[12px] text-mist-500 transition hover:text-mist-300"
              title="掐掉正在播的音效（上传了整首歌时很有用）"
            >
              ⏹
            </button>
          )}
          {/* 开发者模式：一键把测试环境摆好，省得每次测功能都从头建角色想模组 */}
          {devMode && (
            <button
              onClick={() => setShowSandbox(true)}
              className="rounded-md border border-ink-600 px-2.5 py-1.5 text-[12px] text-mist-300 transition hover:border-gold-600/50 hover:text-mist-100"
              title="测试沙盒：灌入测试存档 / 脚本化模组 / 调数值 / 触发结档"
            >
              🧪
            </button>
          )}
          {/* 结档后常驻一个入口：关掉结档页看记录之后，还回得去（协作方 I） */}
          {gameState.ending?.text && (
            <button
              onClick={() => setShowEnding(true)}
              className="rounded-md border border-gold-600/50 px-2.5 py-1.5 text-[12px] text-gold-400 transition hover:bg-gold-500/10"
              title="回到这一局的结局"
            >
              终幕
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
          <CharacterSheet
            onRequestCheck={setCheckSkill}
            onUseItem={(text) => void handleSend(text)}
          />
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
              onRollAll={rollAllChecks}
            />
          </div>
          <div className={mobilePanel === 'character' ? 'h-full lg:hidden' : 'hidden'}>
            <div className="h-full overflow-y-auto">
              <CharacterSheet
                onRequestCheck={setCheckSkill}
                onUseItem={(text) => void handleSend(text)}
              />
            </div>
          </div>
          <div className={mobilePanel === 'world' ? 'h-full lg:hidden' : 'hidden'}>
            <div className="h-full overflow-y-auto">
              <WorldPanel
                onPromptCompanion={promptCompanion}
                onTravel={travelTo}
                onRewind={rewindTo}
              />
            </div>
          </div>
        </main>

        <aside className="hidden w-64 shrink-0 overflow-y-auto border-l border-ink-700 bg-ink-900 lg:block xl:w-72">
          <WorldPanel
            onPromptCompanion={promptCompanion}
            onTravel={travelTo}
            onRewind={rewindTo}
          />
        </aside>
      </div>

      <nav className="safe-bottom flex shrink-0 border-t border-ink-700 bg-ink-900 lg:hidden">
        {panelBtn('character', '角色', '⌘1')}
        {panelBtn('chat', '故事', '⌘2')}
        {panelBtn('world', '世界', '⌘3')}
      </nav>

      {/*
       * 设置**保持挂载**、用 hidden 切换：设置项很多，每次打开都跳回顶部很烦，
       * 而且挂载着才能保住"正在生成图片"这类进行中的状态（协作方 R40）。
       */}
      <div className={showSettings ? '' : 'hidden'} aria-hidden={!showSettings}>
        <Settings onClose={() => setShowSettings(false)} />
      </div>
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
      {lastChanges && lastChanges.lines.length > 0 && (
        <div
          key={lastChanges.id}
          className="rise-in fixed left-1/2 top-16 z-[68] w-[min(92vw,340px)] -translate-x-1/2 rounded-xl border border-ink-600 bg-ink-900/97 p-3 shadow-2xl"
        >
          <div className="mb-1.5 flex items-center justify-between gap-2">
            <span className="text-[11px] tracking-wider text-gold-400">状态变化</span>
            <button
              onClick={() => useStore.getState().clearChanges()}
              className="text-[11px] text-mist-500 transition hover:text-mist-200"
              title="收起"
            >
              ✕
            </button>
          </div>
          <ul className="space-y-1">
            {lastChanges.lines.map((l) => (
              <li
                key={l.text}
                className={`text-[12px] leading-relaxed ${
                  l.tone === 'down'
                    ? 'text-blood-300'
                    : l.tone === 'up' || l.tone === 'good'
                      ? 'text-moss-400'
                      : l.tone === 'warn'
                        ? 'text-gold-300'
                        : 'text-mist-300'
                }`}
              >
                {l.text}
              </li>
            ))}
          </ul>
        </div>
      )}
      {toast && (
        <div className="pointer-events-none fixed left-1/2 top-32 z-[70] -translate-x-1/2 rounded-full border border-moss-400/40 bg-ink-900/95 px-4 py-2 text-[12px] text-moss-400 shadow-lg">
          {toast}
        </div>
      )}
      {updateReady && (
        <div className="fixed inset-x-0 bottom-20 z-[75] flex justify-center gap-2 px-4">
          {autoUpdating ? (
            <div className="rounded-full border border-gold-500/60 bg-ink-900/95 px-4 py-2 text-[13px] text-gold-300 shadow-lg backdrop-blur">
              发现新版本，正在自动更新…
            </div>
          ) : (
            <>
              <button
                onClick={() => void applyUpdate()}
                className="rounded-full border border-gold-500/60 bg-ink-900/95 px-4 py-2 text-[13px] text-gold-300 shadow-lg backdrop-blur"
                title="更新到最新版本（页面会重新加载）"
              >
                有新版本 · 点击立即更新
              </button>
              <button
                onClick={() => setUpdateReady(false)}
                className="rounded-full border border-ink-600 bg-ink-900/95 px-3 py-2 text-[12px] text-mist-400 shadow-lg backdrop-blur"
                title="先不更新，等这一轮跑完再说"
              >
                稍后
              </button>
            </>
          )}
        </div>
      )}
      {/* 装到主屏之后才没有地址栏、能离线开，也不容易被系统清缓存——手机上是重点 */}
      {installable && !installHintHidden && !updateReady && (
        <div className="fixed inset-x-0 bottom-16 z-[74] flex justify-center px-4 lg:hidden">
          <div className="flex items-center gap-2 rounded-full border border-ink-600 bg-ink-900/95 px-3 py-1.5 shadow-lg">
            <span className="text-[11px] text-mist-300">装到手机主屏，像 App 一样用</span>
            <button
              onClick={async () => {
                const ok = await promptInstall();
                if (!ok) {
                  localStorage.setItem('trpg.installHint', '1');
                  setInstallHintHidden(true);
                }
              }}
              className="shrink-0 rounded-full bg-gold-500 px-2.5 py-0.5 text-[11px] font-medium text-ink-950"
            >
              安装
            </button>
            <button
              onClick={() => {
                localStorage.setItem('trpg.installHint', '1');
                setInstallHintHidden(true);
              }}
              className="shrink-0 text-[11px] text-mist-500"
            >
              以后
            </button>
          </div>
        </div>
      )}
      {(welcome || showHelp) && (
        <HelpDialog
          firstTime={welcome}
          onClose={() => {
            if (welcome) {
              localStorage.setItem('trpg.welcomed', '1');
              setWelcome(false);
            }
            setShowHelp(false);
          }}
        />
      )}
      {checkSkill && (
        <CheckDialog
          skill={checkSkill}
          onCancel={() => setCheckSkill(null)}
          onConfirm={(target, action, bonus) => {
            const skill = checkSkill;
            setCheckSkill(null);
            void handleCheck(skill, 'regular', target, action, bonus ?? 0);
          }}
        />
      )}
      {/* 主动求死的二次确认：这是不可逆的一步，值得多问一句 */}
      {pendingSuicide && (
        <ConfirmDialog
          title="要让这段故事到这里结束吗？"
          body={`「${pendingSuicide}」\n\n确认后这一局会立刻结档，守密人会给出一段结局；你随时可以从结档页回到任何一个关键抉择重来。`}
          confirmText="确认，走向终结"
          danger
          onCancel={() => setPendingSuicide(null)}
          onConfirm={() => {
            const text = pendingSuicide;
            setPendingSuicide(null);
            // 引擎直接结算，不给模型劝诫或"刚好救人"的机会
            useStore.getState().forceEnding('death');
            useStore.getState().addMessage({ role: 'player', content: text });
            void (async () => {
              await requestEnding('death');
              setShowEnding(true);
            })();
          }}
        />
      )}
      {/*
       * 结档页：死亡 / 理智归零 = 这段故事结束。
       * 它不是"你死了，请重来"的弹窗，而是一屏收束叙事 + 回溯入口。
       */}
      {showSandbox && <TestSandbox onClose={() => setShowSandbox(false)} />}
      {showChangelog && (
        <ChangelogDialog
          onClose={() => {
            markChangelogRead();
            setShowChangelog(false);
          }}
        />
      )}
      {showEnding && gameState.ending?.text && (
        <EndingScreen
          onClose={() => setShowEnding(false)}
          onRewind={rewindTo}
          onNewGame={() => {
            setShowEnding(false);
            startNew();
          }}
        />
      )}
    </div>
  );
}
