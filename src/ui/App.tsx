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
import { playSfx, resumeAudio, startAmbience, startBgm } from './audio.js';
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
import { getRuleset } from '../core/rulesets/index.js';
import { getGenre } from '../core/genres.js';

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
  const [showEnding, setShowEnding] = useState(false);
  /** 被识别为"主动求死"的那句话，等玩家二次确认 */
  const [pendingSuicide, setPendingSuicide] = useState<string | null>(null);
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
   * 重新打开页面时，如果这一局已经结档了（结局正文也写好了），把结档页顶上来。
   * 只看 `text` 有值的：空 text 表示"结论已定但守密人还没写结局"，那还是留在故事页。
   */
  const endedText = gameState.ending?.text ?? '';
  useEffect(() => {
    if (endedText) setShowEnding(true);
  }, [endedText]);

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
        .flatMap((m) => m.checks ?? (m.check ? [m.check] : []))
        .slice(-6)
        .map((b) => ({ skill: b.skill, roll: b.roll, label: b.label })),
    });

    const turns = buildMessages(systemPrompt, snapshot);
    if (engineNote) turns.push({ role: 'user', content: engineNote });

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
       */
      if (lastPlayer) {
        const reasons: string[] = [];
        if (lastPlayer.check) reasons.push(`掷骰：${lastPlayer.check.skill}`);
        for (const d of contract?.state_delta ?? []) {
          if (d.target === 'combat.active') reasons.push(d.value ? '进入战斗' : '战斗结束');
          else if (d.target === 'location') reasons.push(`移步：${String(d.value ?? '')}`);
          else if (d.target === 'clues' && d.op === 'add') reasons.push('新线索');
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
          useStore
            .getState()
            .markSnapshotKey(lastPlayer.id, `第${turnNo}回 · ${snippet} · ${reasons[0]}`);
        }
      }
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
     * 结档：引擎检测到生命/理智走到尽头时，`ending.text` 是空的——拿它当信号，
     * 让守密人写一段收束叙事再填进去。写不出来也给一句兜底，绝不留白屏。
     */
    const pending = useStore.getState().gameState.ending;
    if (pending && !pending.text) {
      await requestEnding(pending.kind);
      setShowEnding(true);
    }
  };

  /** 向守密人要一段结局正文（结档页用） */
  const requestEnding = async (kind: 'death' | 'insanity' | 'other') => {
    const s = useStore.getState();
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
    action = ''
  ) => {
    if (streaming) return;
    if (blockedByEnding()) return;
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
        .skillCheck(pm.check.skill, pm.check.difficulty ?? 'regular');
      useStore.getState().addMessage({ role: 'player', content: pm.content, check: badge });
      await sendToGm(
        `【引擎判定，不可更改】玩家进行${pm.check.skill}检定，${checkTargetText(badge)}，` +
          `掷出 ${badge.roll}，结果：${badge.label}。请严格依据这个结果续写剧情，` +
          `不要在正文里复述“检定/判定/成功/失败”等字样。`
      );
    } else if (pm.checks?.length) {
      // 一次全掷过的那一轮：重掷就把每一条都重新掷一遍
      const badges = pm.checks.map((c) =>
        useStore.getState().skillCheck(c.skill, c.difficulty ?? 'regular')
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
              onRollAll={rollAllChecks}
            />
          </div>
          <div className={mobilePanel === 'character' ? 'h-full lg:hidden' : 'hidden'}>
            <div className="h-full overflow-y-auto">
              <CharacterSheet onRequestCheck={setCheckSkill} />
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
                    : l.tone === 'up'
                      ? 'text-moss-400'
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
        <div className="fixed inset-x-0 bottom-20 z-[75] flex justify-center px-4">
          <button
            onClick={() => void updateSW(true)}
            className="rounded-full border border-gold-500/60 bg-ink-900/95 px-4 py-2 text-[13px] text-gold-300 shadow-lg backdrop-blur"
          >
            有新版本 · 点击立即更新
          </button>
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
