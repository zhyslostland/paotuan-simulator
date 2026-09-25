import { lazy, Suspense, useEffect, useRef, useState } from 'react';
import {
  useStore,
  addressOf,
  resolveCheckTarget,
  checkTargetText,
  currentWorldName,
  isLifeFull,
} from './store';
import { findWorld } from '../core/campaign.js';
import { chronicleKeepFrom, shouldFold } from '../core/chronicle.js';
import { consumeLoadError } from './state/loaders.js';
import { statusNote as statusEffectsNote } from '../core/statusEffects.js';
import { Chat } from './Chat';
import { ImageJobsBadge } from './ImageJobsBadge';
import { CharacterSheet, CheckDialog, type Difficulty } from './CharacterSheet';
import { WorldPanel } from './WorldPanel';
import { ConfirmDialog } from './ConfirmDialog';
/*
 * 三个最大的弹层改成**按需加载**（`React.lazy`）。
 *
 * 为什么：主包 700KB，`Preparation` 88KB / `Settings` 66KB / `TestSandbox` 22KB
 * 全都打在里面，而它们**不是首屏必需的**（有进行中的局时准备页根本不打开、
 * 测试沙盒只有开发者模式才用）。拆出去后首屏要解析的 JS 少四分之一。
 *
 * 两条边界（别顺手扩大范围）：
 *   1. **帮助 / 更新日志 / 结档页不拆** —— 帮助是首次进入就要显示的，
 *      结档页是"故事收束"那一屏，让它们等一次网络请求是拿体验换字节数。
 *   2. `Settings` 仍然是**打开过就保持挂载**（下面 `settingsMounted`），
 *      不然每次打开都跳回顶部、正在生成的图片也会丢（协作方 R40）。
 */
const Settings = lazy(() => import('./Settings').then((m) => ({ default: m.Settings })));
const Preparation = lazy(() => import('./Preparation').then((m) => ({ default: m.Preparation })));
const TestSandbox = lazy(() => import('./TestSandbox').then((m) => ({ default: m.TestSandbox })));
/** 分包还在路上时的占位 —— 一行字就够，别为它做动画 */
const ChunkLoading = () => (
  <div className="fixed inset-0 z-[80] flex items-center justify-center bg-ink-950/60 text-[12px] text-mist-400">
    载入中…
  </div>
);
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
import {
  FOLD_SYSTEM,
  actionImagePrompt,
  endingSystemPrompt,
} from '../orchestrator/generate.js';
import { EndingScreen } from './EndingScreen';
import { applyUpdate, checkForUpdate, watchForUpdates } from '../update.js';
import { anchorReasons } from './anchorReasons.js';
import { parseActs, normalizeActIndex } from '../core/acts.js';
import { ChangelogDialog, hasUnreadChangelog, markChangelogRead } from './Changelog';
import { HelpDialog } from './HelpGuide';
import { getRuleset } from '../core/rulesets/index.js';
import { getGenre } from '../core/genres.js';
import type { Ending } from '../core/state/gameState.js';
import { encumbranceNote } from '../core/encumbrance.js';
import { isHealOnlyConsumable, itemsMentionedIn } from '../core/items.js';

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

/**
 * 编年史折叠阈值（P2-6＝P3-5，协作方第 20 版）。
 *
 * 旧判据是**条数**（`CHRONICLE_FOLD_AT = 50` / `CHRONICLE_KEEP = 20`），原文裁定
 * 「正常玩不到」—— 一条编年史短则十几个字、长则几百字，按条数算既可能白折、
 * 也可能早就撑爆提示词。现在**按字符**：合计 ≥ 4000 字折一次，保留近 2000 字。
 * 判据本体在 `core/chronicle.ts`（纯函数，可单测）。
 */
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
  /** 设置页是不是已经加载过（加载过就一直挂着，见文件头那两条边界） */
  const [settingsMounted, setSettingsMounted] = useState(false);
  useEffect(() => {
    if (showSettings) setSettingsMounted(true);
  }, [showSettings]);
  const [showPrep, setShowPrep] = useState(false);
  const [mobilePanel, setMobilePanel] = useState<Panel>('chat');
  const [draft, setDraft] = useState('');
  const [checkSkill, setCheckSkill] = useState<string | null>(null);
  const [pendingStart, setPendingStart] = useState(false);
  const [toast, setToast] = useState('');
  /**
   * 统一的浮字。**每条都要自己收**（`setTimeout` 清掉），
   * 免得出现一个永远挂在屏幕上方的提示 —— 那种东西玩家最后会当成装饰。
   */
  const toastFor = (text: string, ms = 2400) => {
    setToast(text);
    setTimeout(() => setToast(''), ms);
  };
  /** 每次 +1 = 请故事页的输入框聚焦（点背包「使用」时用；不开新弹层，复用草稿） */
  const [chatFocus, setChatFocus] = useState(0);
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
  /*
   * P3-2：没填 Key 时**自动弹设置页**，整个会话只许弹一次。
   *
   * 病灶：`sendToGm` 里一句 `setShowSettings(true)`，而它有几个来路 ——
   * 玩家点发送、点「一次全掷」、点地图移步、点使用道具（`handleSend`）。
   * 于是"没配 Key"时，随便点什么都会**把设置页糊到脸上**：
   * 刚掷出的点数还没看清就被盖住，撞的就是本项目那条铁律「状态可见」。
   *
   * 现在分两档：
   *   - **玩家明确点发送** → 弹设置（他就是要说话，正需要知道为什么发不出去）；
   *   - 其余来路（全掷 / 移步 / 用药） → **只给一句提示**，不抢屏幕。
   * 且**每会话一次**：弹过一次之后就只提示，不再反复糊。
   *
   * 为什么用 ref 不用 state：它只影响"要不要弹"，不需要触发重渲染；
   * 也刻意**不进存档**——刷新一次重来一遍是合理的（那时玩家确实该去配了）。
   */
  const settingsAutoOpenedRef = useRef(false);

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

  /*
   * 后台留的提示（P2-3）。
   *
   * 生图是**后台任务**：它可能在玩家正翻着设置页时落盘，
   * 组件里那句 `setToast` 不在场 —— 所以 store 自己留一句话，这里取走并弹出。
   * 取完即清（`takeNotice`），刷新不会重复弹。
   */
  const uiNotice = useStore((s) => s.uiNotice);
  useEffect(() => {
    if (!uiNotice) return;
    toastFor(uiNotice, 6000);
    useStore.getState().takeNotice();
  }, [uiNotice]);

  /*
   * 坏档提示（P2-8）。
   *
   * 存档读不出来时，界面以前是**一切正常、内容却悄悄退回新局** ——
   * 玩家发现背包少了东西、地点和时间都变了，却完全不知道为什么。
   * 现在启动后立刻说一句实话（坏串已经由 `loadJson` 搬到 `trpg.broken.*` 留底了）。
   * 取完即清，刷新不会重复弹。
   */
  useEffect(() => {
    const msg = consumeLoadError();
    if (msg) toastFor(msg, 8000);
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
  /**
   * 这一局已经结档（正文可能还没写完）。
   * 交给 `Chat` 去禁用输入框并写明原因（P3-4）——以前结档后还能打字、按回车什么都不发生。
   */
  const ended = Boolean(gameState.ending);
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

  /**
   * 编年史累计到阈值时，把早期的折进摘要层，只留近期明细。
   *
   * P2-6＝P3-5（协作方第 20 版）：判据从**条数**改成**字符**（见 `core/chronicle.ts`），
   * 并且**成功失败都要让玩家知道** —— 以前失败只 `console.warn`，玩家眼前什么都不发生，
   * 于是提示词越撑越满也没人察觉。
   */
  const foldChronicleIfNeeded = async () => {
    const s = useStore.getState();
    /*
     * `shouldFold` 同时挡住两种「其实没得折」的情形：没到阈值、以及最新那条自己就够长
     * （折了它玩家眼前的事会凭空消失）。这两种都**不发请求、不 toast**。
     */
    if (!shouldFold(s.chronicle)) return;
    const keepFrom = chronicleKeepFrom(s.chronicle);
    const head = s.chronicle.slice(0, keepFrom);
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
      if (merged.trim()) {
        useStore.getState().foldChronicle(keepFrom, merged.trim());
        toastFor('前情已折进摘要', 2600);
      }
    } catch (e) {
      // 压缩失败不是致命问题：日志还在，下次会重试。但**必须告诉玩家** ——
      // 静默失败会让提示词一路撑到被砍序裁掉（P2-6 原文：「压缩失败静默」）。
      console.warn('[跑团] 摘要压缩失败，保留完整日志', e);
      toastFor('摘要没折成，完整日志还留着', 3200);
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

  /**
   * 发一轮给守密人。
   *
   * `opts.playerInitiated` ＝ 这一轮是**玩家明确点了发送**（而不是全掷 / 移步 / 用药触发的）。
   * 只有它是 true 时，缺 Key 才会自动弹设置页 —— 见 `settingsAutoOpenedRef` 那段注释（P3-2）。
   */
  const sendToGm = async (engineNote?: string, opts?: { playerInitiated?: boolean }) => {
    if (streaming) return;
    if (blockedByEnding()) return;
    if (!config.apiKey) {
      addMessage({
        role: 'system',
        content: '请先在设置里填写 API Key',
      });
      /*
       * P3-2：**只有玩家自己点发送**、且这个会话还没弹过，才把设置页推上来。
       * 其余来路只留一句提示 —— 别去盖住他刚掷出的点数 / 刚看到的画面。
       */
      if (opts?.playerInitiated && !settingsAutoOpenedRef.current) {
        settingsAutoOpenedRef.current = true;
        setShowSettings(true);
      } else {
        setToast('还没配 API Key —— 去「设置」里填一下');
        setTimeout(() => setToast(''), 3000);
      }
      return;
    }

    const rs = getRuleset(rulesetId);
    const snapshot = useStore.getState().messages;
    // 回合开始：拍下状态快照，供「回溯 / 重掷」恢复
    const lastPlayer = [...snapshot].reverse().find((m) => m.role === 'player');
    if (lastPlayer) useStore.getState().snapshotTurn(lastPlayer.id);
    /*
     * 第 17 版 D：玩家这一句点名了哪些背包物品。
     *
     * 在这一层算（而不是在 `handleSend` 里顺着参数传一路）：
     * `handleSend` 那条路只覆盖"玩家打字"，而地图移步、全掷走的是别的入口 ——
     * 它们同样会写一条 player 消息。从**消息本身上**读，所有来路一网打尽。
     *
     * 它的唯一用途是"模型忘了扣就说一声"（见 `applyModelDeltas` 里的反馈）；
     * **不会**据此替玩家扣东西。
     */
    const mentionedItems = lastPlayer
      ? itemsMentionedIn(lastPlayer.content, useStore.getState().gameState.inventory)
      : [];
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
    /*
     * 伤口提示：与超重同理，**每轮都跟着**——伤口是持续状态，
     * 而守密人特别容易"这一轮忘了它"，于是要么完全不提、要么下一轮又突然想起，
     * 变成"止住了又渗血"。这里每轮把现状与处置依据说清楚。
     */
    const woundNote = useStore.getState().woundStatus().note;
    /*
     * 临时疯狂提示：同样是持续状态，每轮都跟着。
     * 它现在有数值后果（检定吃惩罚），守密人必须知道、并在叙事里演出他的失控，
     * 否则玩家只会看到"目标值怎么莫名低了"。
     */
    const madNote = useStore.getState().insanity().note;
    /*
     * 状态效果提示（1.0 阶段 C）：**每轮都跟着**，而且是**防双计的关键一环**。
     *
     * 中毒 / 燃烧这些后果现在是引擎扣的 —— 如果不同时告诉守密人"这一刀已经算过"，
     * 它会在正文里再写一遍"你又吐了一口血"，玩家就被扣了两次。
     * 协作方第 24 版把这条点名了：C 的风险不在掷骰，在双计。
     */
    const statusNote = statusEffectsNote(rs, useStore.getState().gameState.flags);
    const notes = [engineNote, dyingNote, loadNote, woundNote, madNote, statusNote].filter(
      Boolean
    ) as string[];
    const finalNote = notes.length ? notes.join('\n\n') : undefined;
    // 世界书只注入命中关键词的条目，全量塞进去会撑爆上下文
    const context = snapshot.slice(-4).map((m) => m.content);
    if (finalNote) context.push(finalNote);

    const systemPrompt = buildSystemPrompt({
      rulesetName: rs.name,
      // 规则包本体（属性标签/技能量纲/派生值都要按它分岔，光有名字不够）
      ruleset: rs,
      genre: getGenre(useStore.getState().genreId, useStore.getState().customGenres),
      // 守密人口吻（R8）：只改"怎么说"，不改任何规则；没选过就是默认那一个
      gmVoice: useStore.getState().gmVoice,
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
       * 而不是在上百条消息里翻。
       *
       * **判据在 `anchorReasons.ts`（纯函数、可单测）** —— 这里只负责喂数据。
       * 2026-09-17 主人拍板走**精简版**：掷骰只在**没过**时记（成功不记），
       * 受伤 / 理智受创**不再记**（那是结算，不是选择），
       * 位移只记**首次到访**、战斗 / 新线索 / 新支线照记。
       */
      if (lastPlayer) {
        const reasons = anchorReasons({
          check: lastPlayer.check,
          deltas: contract?.state_delta ?? [],
          visited: useStore.getState().gameState.visited ?? [],
        });
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
            /*
             * 带图战报（G）：关键节点到了，如果总开关开着，就给这一轮的叙事配一张图。
             *
             * 三条刻意的：
             * - **默认关**（`autoIllustrate` 缺省 false）：每张图都是真金白银的调用，
             *   默认开着等于替主人决定支出。
             * - **不 await**：图是留给"回看这一局"的，不该让玩家为了它多等一秒。
             * - **失败静默**：没配生图模型 / 接口报错都只是少一张图，绝不弹错打断回合。
             */
            if (useStore.getState().autoIllustrate) {
              /*
               * 走**生图队列**（R40），不再在这里 await 一次网络请求。
               * 以前这段是就地 await：一张在飞的图完全不可见，切页签回来也不知道画没画完；
               * 现在它进队列 → 右上角角标转圈 → 画好了自动落到那条消息上。
               * 没配生图模型时 `queueImage` 返回 null，这里当无事发生（少一张图而已）。
               */
              useStore.getState().queueImage({
                kind: 'action',
                target: gmId,
                label: `第 ${Math.max(1, useStore.getState().chronicle.length)} 回的分镜`,
                prompt: actionImagePrompt(
                  finalBody,
                  { gender: character.gender, description: character.description },
                  getGenre(useStore.getState().genreId, useStore.getState().customGenres)
                ),
              });
            }
          }
        }
      }
      /*
       * R14：守密人声明"这一幕收束了" → 推进到下一幕，并展开下一幕的导演稿。
       *
       * 三条刻意的：
       * - **只在真有下一幕时推进**（最后一幕声明了也不越界，免得幕号跑到范围外）。
       * - **展开是异步的、不等它**：这一轮的叙事已经给了玩家，不能为了幕后材料让他多等。
       * - **失败无所谓**：展开不了只是这一章少一份导演稿，故事照跑（世界面板上还能手动补）。
       */
      if (contract?.act_done === true) {
        const acts = parseActs(useStore.getState().module.acts);
        const curIdx = normalizeActIndex(useStore.getState().gameState.actIndex);
        if (acts.length > 0 && curIdx + 1 < acts.length) {
          useStore.getState().setActIndex(curIdx + 1);
          void useStore.getState().expandAct(curIdx + 1);
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
        /*
         * 故事时钟：把守密人这一轮申报的"过了多久"交给引擎折算。
         *
         * 只在这里的第一条调用里传（`applyModelDeltas` 自己会去重窗口内的重复），
         * 因为 `state_delta` 与 `location` 是分开两条调的，传两遍时间就翻倍。
         * 契约里的 `deadline_days` 是**修正**用的，单独走 `setDeadlineDays`。
         */
        if (contract.deadline_days !== undefined) {
          useStore.getState().setDeadlineDays(contract.deadline_days);
        }
        if (contract.state_delta?.length) {
          applyModelDeltas(contract.state_delta as never, {
            elapsed: contract.elapsed,
            mentionedItems,
          });
        } else if (contract.elapsed) {
          // 这一轮没有状态变更，但时间照样在走 —— 空数组也能推进时钟
          applyModelDeltas([], { elapsed: contract.elapsed, mentionedItems });
        } else if (mentionedItems.length > 0) {
          /*
           * 既没 elapsed 也没 state_delta，但玩家确实点名了东西 ——
           * 还是要走一次（空数组），好让"「××」还在背包里"那句提示出得来。
           * 少了这一支，最常见的"我看看绷带"就永远等不到那句确认。
           */
          applyModelDeltas([], { mentionedItems });
        }
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
  /*
   * R13/R30：结档时把这一局记进**生涯**（跨局累计 + 成就）。
   *
   * 用 `ending.at` 去重 —— 一次结档只记一次，回溯后重新结档又是新的 `at`，会正常再记一局。
   * 放在这个 effect（而不是结局正文回来之后）是因为统计读的是引擎已有的账：
   * 编年史、检定卡、线索、交手记录在结档那一刻就已经定稿了。
   */
  const runRecordedRef = useRef('');
  useEffect(() => {
    if (!endingAt || runRecordedRef.current === endingAt) return;
    runRecordedRef.current = endingAt;
    useStore.getState().recordCurrentRun();
  }, [endingAt]);
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
    /*
     * P1-1（🔴 协作方第 18 版裁「修。P1」）：流式期间的**静默吞掉**。
     *
     * 以前这里没有这道闸：`addMessage` 先把玩家这句话写进对话，
     * 隔几行的 `sendToGm` 首行再 `if (streaming) return` 把它扔掉 ——
     * 玩家看到自己说了话，守密人永远不回。点「使用道具」更狠：
     * 道具**已经扣了**（`CharacterSheet` 那条路径），这一轮却没发出去。
     * 契约窗口 14–90 秒，撞上的概率很高。
     *
     * 现在三道一起：**不写消息、不清草稿、给一句人话**。
     * 界面侧的置灰在 `Chat` / `CharacterSheet` / 地图上（同一刀）。
     */
    if (streaming) {
      setToast('守密人还在写 —— 等这一轮写完再动');
      setTimeout(() => setToast(''), 2400);
      return;
    }
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
    /*
     * 自由行动里**点到了**背包物品（协作方第 17 版 C）。
     *
     * 判据是"这句话里出现了这件东西的全名"，**刻意不做动词表**（拿出/铺开/交给…）：
     * 「看看绷带上的字」不能扣，「把绷带铺在地上」要扣——枚举不完。
     * 所以引擎只报名单 + 一条判据，扣不扣交给守密人；引擎自己只做**一件**事，
     * 就是纯回血药在**已经满血**时别扣（主人拍板：「没掉血就不能用，数量不减」）。
     *
     * 为什么和 A+B 同一刀（协作方原本把它排在后面的第 4 刀）：
     * A+B 撤掉了"点使用就本地预扣"，实物（绷带）从此**只能靠这一轮的契约扣**。
     * 少了这条名单，就会出现"东西永远用不完"——那是比白扣更老的 bug。两者必须一起上。
     */
    const snap = useStore.getState();
    const mentioned = itemsMentionedIn(text, snap.gameState.inventory);
    let itemNote = '';
    if (mentioned.length > 0) {
      const isHealOnly = (n: string) =>
        isHealOnlyConsumable(snap.gameState.inventory.find((i) => i.name === n));
      const healOnly = mentioned.filter(isHealOnly);
      const lifeFull = isLifeFull(snap.gameState, snap.character, snap.rulesetId);
      if (healOnly.length > 0 && !lifeFull) {
        snap.applyModelDeltas(
          healOnly.map((n) => ({
            target: 'inventory',
            op: 'dec',
            value: n,
            amount: 1,
          })) as never
        );
      }
      itemNote =
        `【引擎核对】这句话点到了背包里的：${mentioned.join('、')}。` +
        '被用掉 / 拆开 / 铺开 / 交出去 → 必须 `inventory dec`；只是看一眼 → 不要扣。' +
        '没有的东西（比如衣服不在背包里）不要编进背包。' +
        (healOnly.length > 0 && lifeFull
          ? `（其中 ${healOnly.join('、')} 只能回血，此刻他没有受伤 —— 本轮不要扣它。）`
          : '');
    }
    addMessage({ role: 'player', content: text });
    await sendToGm(itemNote || undefined, { playerInitiated: true });
  };

  const handleCheck = async (
    skill: string,
    difficulty: Difficulty,
    target = '',
    action = '',
    bonus = 0,
    reason = ''
  ) => {
    if (streaming) return;
    if (blockedByEnding()) return;
    const badge = skillCheck(skill, difficulty, bonus);
    /*
     * §6.4：守密人给这次检定的理由跟着卡片一起落库。
     * 它此前只活在"待掷"那张卡片上，掷完就丢 —— 记录层里只剩冷冰冰的数字。
     */
    if (reason.trim()) badge.reason = reason.trim();
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
    // 先把理由取出来再出队 —— 出队后那张卡片就没了，理由也就跟着丢了（§6.4）
    const reason = useStore.getState().pendingChecks[index]?.reason ?? '';
    useStore.getState().removePendingCheck(index);
    await handleCheck(skill, (difficulty as Difficulty) ?? 'regular', '', '', 0, reason);
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
    // 理由跟着卡片走（§6.4）—— `list` 是出队前的快照，这里还拿得到
    const badges = list.map((pc) => {
      const b = useStore.getState().skillCheck(pc.skill, (pc.difficulty as Difficulty) ?? 'regular');
      if (pc.reason?.trim()) b.reason = pc.reason.trim();
      return b;
    });
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
    /*
     * 世界层（Phase 2）：开团前先看清"会不会接上上次的事" ——
     * 这句话要写给玩家看（状态可见），别让他事后自己猜为什么开场多了几个人。
     */
    const before = useStore.getState();
    const carriedWorld = before.carryWorld
      ? findWorld(Object.values(before.worlds), currentWorldName(before))
      : undefined;
    const willCarry = Boolean(carriedWorld?.snapshot);
    useStore.getState().startNewGame();
    /*
     * R14：开新团就把**第一幕**的导演稿展开（长篇尤其需要）。
     * 同样不等它 —— 玩家该立刻看到开场白；稿子到了自然会在下一轮的提示词里生效。
     * 没有幕结构时 `expandAct` 自己会静默返回，不会白花一次调用。
     */
    void useStore.getState().expandAct(0);
    setPendingStart(false);
    setShowPrep(false);
    setShowSettings(false);
    setShowEnding(false);
    setMobilePanel('chat');
    setDraft('');
    setToast(
      willCarry ? `已开新团 · 接上了《${carriedWorld!.name}》上次的事` : '已开新团，按模组开场'
    );
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
   * 点背包里的「使用」：把**意图**写进对话草稿，切回故事页并聚焦（协作方第 17 版 A）。
   *
   * 复用对话草稿，**不开新弹层**（抄的是上面那个 `promptCompanion`）。
   * 以前是直接发一句无主语的「（使用：××）」——守密人只能猜玩家要拿它干什么，
   * 而"拿它干什么"恰恰是这件东西的全部乐趣（主人拍板：实物有自由度，
   * 「拿出绷带止血」要扣、「撕破衣服止血」不扣）。
   */
  const promptUse = (text: string) => {
    setDraft((d) => (d.trim() ? d : text));
    setMobilePanel('chat');
    setChatFocus((c) => c + 1);
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
    // 流式期间点地图：以前是"点了毫无变化"，现在是置灰 + 一句人话（P1-1）
    if (streaming) {
      setToast('守密人还在写 —— 等这一轮写完再动');
      setTimeout(() => setToast(''), 2400);
      return;
    }
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
            onPromptUse={promptUse}
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
              ended={ended}
              focusSignal={chatFocus}
            />
          </div>
          <div className={mobilePanel === 'character' ? 'h-full lg:hidden' : 'hidden'}>
            <div className="h-full overflow-y-auto">
              <CharacterSheet
                onRequestCheck={setCheckSkill}
                onPromptUse={promptUse}
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
       * `settingsMounted` 只决定"要不要**第一次**加载它" —— 打开过一次之后就不再卸载。
       */}
      {settingsMounted && (
        <div className={showSettings ? '' : 'hidden'} aria-hidden={!showSettings}>
          <Suspense fallback={<ChunkLoading />}>
            <Settings onClose={() => setShowSettings(false)} />
          </Suspense>
        </div>
      )}
      {showPrep && (
        <Suspense fallback={<ChunkLoading />}>
          <Preparation onClose={() => setShowPrep(false)} onStartNew={startNew} />
        </Suspense>
      )}
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
      {showSandbox && (
        <Suspense fallback={<ChunkLoading />}>
          <TestSandbox onClose={() => setShowSandbox(false)} />
        </Suspense>
      )}
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
      {/*
        生图进度角标（R40）：放在**所有弹层之后**渲染，z-index 也高过弹层 ——
        在准备页生成立绘时切去看聊天，进度照样看得见。
      */}
      <ImageJobsBadge />
    </div>
  );
}
