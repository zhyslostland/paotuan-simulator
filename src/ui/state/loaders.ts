/**
 * **启动期读档与初值装配**（E 档 E1b，从 `ui/store.ts` 搬出）。
 *
 * 四类东西同住一个文件，按区域分开（将来要再细分，就按区域拆）：
 *
 *   区域 1 · 默认值      DEFAULT_CONFIG / DEFAULT_CHARACTER / DEFAULT_TYPOGRAPHY /
 *                        DEFAULT_WORLDBOOK / TYPOGRAPHY_PRESETS / SAMPLE_COMPANIONS / WELCOME_ID
 *   区域 2 · 读档 loader  load*（19 个）+ `loadJson`
 *   区域 3 · 模组→初值     fallbackState / deriveVitals* / reconcileVitals /
 *                        sanitizeModuleTokens / initialLocation / initialNpcs / deadlineOf /
 *                        cnNumber / FALLBACK_OPENINGS / firstLocationLine / moduleOpening / openingText
 *   区域 4 · 合并与迁移    mergeCharacter / migrateCharacter / mergeModule / mergeWorldbook /
 *                        migrateSave / SAVE_VERSION / MERGE_MODULE_DEFAULTS
 *
 * ⚠️ **为什么同住**：`loadConfig` 要用 `DEFAULT_CONFIG`、`mergeCharacter` 要用
 *    `DEFAULT_CHARACTER`…… 拆成两个文件就变成 store ↔ X 循环 import。
 *    这几类在依赖上是一整块：**读盘 → 补默认 → 按版本迁移**。
 *
 * ⚠️ **写侧不在这里**：`saveJson` / `saveJsonNow` / `flushSaves` / `writeNow` 仍在
 *    `store.ts`（本文件只管**读**）。
 */

import {
  DEFAULT_MODULE,
} from '../../core/seeds.js';
import type { WorldbookEntry, Message, ApiConfig, CharacterProfile, Module, ThemeName, Typography, SaveFile } from '../../core/types.js';
import {
  defaultCharacteristics,
} from '../../core/skills.js';
import {
  createInitialState,
  type GameState,
  type Deadline,
} from '../../core/state/gameState.js';
import {
  DEFAULT_CLOCK,
  deadlineFromDays,
  normalizeClock,
} from '../../core/clock.js';
import {
  getRuleset,
  listRulesets,
} from '../../core/rulesets/index.js';
import { isLifeVital } from '../../core/rulesets/types.js';
import {
  listGenres,
  type Genre,
} from '../../core/genres.js';
import {
  DEFAULT_GM_VOICE,
  gmVoiceOf,
  type GmVoice,
} from '../../core/voices.js';
import {
  emptyCareer,
  type Career,
} from '../../core/career.js';
import {
  type World,
} from '../../core/campaign.js';
import {
  type ArchivedCharacter,
} from '../archive.js';
import {
  reviveJobs,
  type ImageJob,
} from '../imageJobs.js';
import {
  fillPlayerTokens,
} from './tokens.js';


export const DEFAULT_CONFIG: ApiConfig = {
  baseUrl: 'https://api.deepseek.com/v1',
  apiKey: '',
  model: 'deepseek-chat',
  temperature: 0.9,
  // 留足余量：若输出被 max_tokens 截断，尾部 JSON 契约会残缺，状态就同步不了
  maxTokens: 3072,
};

export const DEFAULT_CHARACTER: CharacterProfile = {
  name: '艾伦·霍尔特',
  // gender / address 留空：这两个会随用户输入变化，写死默认值会盖掉老存档里的设置
  gender: '',
  description:
    '34 岁，私家侦探，曾是战地记者，左腿落下旧伤。常穿一件洗得发白的风衣，随身带着一台禄来福来双反相机。',
  personality:
    '沉默寡言，观察力强。因三年前一桩始终没查清的失踪案，他对"无法解释的事"有近乎偏执的兴趣；面对超自然现象时，用职业性的冷静掩饰内心的动摇。',
  mes_example: '',
  characteristics: defaultCharacteristics(),
  // 技能名一律用规则包 skillCatalog 里的**标准名**
  skills: {
    侦查: 70,
    图书馆使用: 55,
    说服: 50,
    心理学: 60,
    潜行: 45,
    锁匠: 30,
    '射击（手枪）': 40,
    克苏鲁神话: 8,
  },
  items: ['笔记本', '.38 左轮手枪', '禄来福来双反相机'],
  itemDetails: [
    { name: '笔记本', desc: '记录案子的随身本，边角磨得起了毛。', kind: 'clue' },
    {
      name: '.38 左轮手枪',
      desc: '警用制式左轮，六发装填，握把缠了防滑胶带。',
      kind: 'weapon',
      damage: '1d10',
      skill: '射击（手枪）',
    },
    { name: '禄来福来双反相机', desc: '从战地一起带回来的老相机，还能用。', kind: 'clue' },
  ],
};

export const TYPOGRAPHY_PRESETS: { id: string; name: string; value: Typography }[] = [
  { id: 'compact', name: '紧凑', value: { scale: 0.95, lineHeight: 1.65, indent: false } },
  { id: 'standard', name: '标准', value: { scale: 1, lineHeight: 1.9, indent: false } },
  { id: 'loose', name: '宽松', value: { scale: 1.08, lineHeight: 2.1, indent: false } },
  { id: 'book', name: '书卷', value: { scale: 1.05, lineHeight: 2, indent: true } },
];

export const DEFAULT_TYPOGRAPHY: Typography = TYPOGRAPHY_PRESETS[1]!.value;

export const DEFAULT_WORLDBOOK: WorldbookEntry[] = [
  {
    id: 'sample-town',
    keys: ['敦威治', '小镇', '邓里奇'],
    content:
      '马萨诸塞州北部的小镇，人口不足四百。1890 年代起便有关于"山那边"的传闻，居民对外人沉默而警惕。镇上有一间杂货铺、一座浸礼会教堂，以及一间常年落锁的旧校舍。',
    priority: 50,
    enabled: true,
  },
];

export function loadWorldbook(): WorldbookEntry[] {
  try {
    const raw = localStorage.getItem('trpg.worldbook');
    if (raw) return JSON.parse(raw) as WorldbookEntry[];
  } catch {
    /* 忽略损坏数据 */
  }
  return DEFAULT_WORLDBOOK;
}

/** 读不出来的存档搬到这个前缀下留底 —— 原地留着会**每次刷新再坏一次**（P2-8） */
export const BROKEN_SAVE_PREFIX = 'trpg.broken.';

/** 最近一次"存档读不出来"的提示；取完即清（与 `uiNotice` 一个用法） */
let lastLoadError: string | null = null;

/** 取走读档失败的提示（取完即清），没有就返回 `null` */
export function consumeLoadError(): string | null {
  const v = lastLoadError;
  lastLoadError = null;
  return v;
}

/**
 * 读一条存档。读不出来时 —— 🔴 **不许静默**（P2-8）。
 *
 * 以前这里 `catch` 里只有一句注释、然后 `return fallback`：
 * 界面一切正常、内容却悄悄退回新局（背包 6→3、地点和时间都变了），
 * 而**坏串还留在 localStorage 里** → 每次刷新再退一次，玩家永远不知道发生了什么。
 *
 * 现在做两件事：① 坏串搬到 `trpg.broken.<原键>` 留底并清掉原键，别让它反复作祟；
 * ② 留一句话给界面说（由 `consumeLoadError` 取走）。
 */
export function loadJson<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    if (raw) return JSON.parse(raw) as T;
  } catch {
    const raw = safeGetRaw(key);
    if (raw !== null) {
      try {
        localStorage.setItem(`${BROKEN_SAVE_PREFIX}${key}`, raw);
        localStorage.removeItem(key);
      } catch {
        /* 连备份都写不进去就算了，别因为"想留个底"把启动搞崩 */
      }
      lastLoadError =
        '存档读不出来，已经回到新的一局。坏掉的那份已备份在本地（键名以 trpg.broken. 开头），可以直接删掉。';
    }
  }
  return fallback;
}

/** 取原始串；连 localStorage 本身都抛异常时返回 null（测试沙盒/隐私模式） */
function safeGetRaw(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

export function loadMessages(): Message[] {
  const opening = openingText(loadCharacter(), loadModule(), loadGenreId());
  const saved = loadJson<Message[] | null>('trpg.messages', null);
  if (Array.isArray(saved) && saved.length > 0) {
    // 迁移：早期开场白是写死的，这里按当前角色卡 + 模组同步一次
    return saved.map((m) => (m.id === WELCOME_ID ? { ...m, content: opening } : m));
  }
  return [{ id: WELCOME_ID, role: 'gm', content: opening, ts: Date.now() }];
}

/**
 * 兜底初始状态 —— 只在**完全没有存档**时走到（第一次打开应用）。
 *
 * ⚠️ 这里曾经写死了《失踪的玛乔丽》的东西：背包固定「相机 / 手枪 / 笔记本」、
 * 地点固定「霍尔特的侦探事务所」、在场人物固定「老霍华德」。
 * 后果是主人 2026-09-17 报的两个 bug：
 *   - "背包是老三样"（换任何模组、任何角色，开局包里都是那三件）；
 *   - "AI 自动生成地点 / 场景仍显示霍尔特的侦探事务所"
 *     （本该由当前模组决定的地点，被这里的写死值顶住了）。
 *
 * 现在**一件东西都不写死**：背包从角色卡来、地点从模组来、在场人物从开场白来。
 * 真源各自只有一个，这里只负责"派生不出来时给个空"。
 *
 * 为什么不是"删掉这个函数"：完全没有存档时要有个能跑起来的骨架，
 * 否则首屏会因为缺 `vitals` 直接崩。但它必须**中性**——不替玩家做任何设定。
 */
export function fallbackState(): GameState {
  const c = loadCharacter();
  const rid = loadRulesetId();
  const vitals = deriveVitalsFor(c, rid);
  const m = loadModule();
  return createInitialState({
    vitals,
    vitalsMax: deriveVitalsMax(c, rid),
    companions: [],
    // 背包＝角色卡的随身物品（没有就是空，绝不塞别人的东西）
    inventory: (c.items ?? [])
      .filter((n) => n?.trim())
      .map((name) => ({ id: `item-${name.trim()}`, name: name.trim(), qty: 1 })),
    flags: {},
    clues: [],
    // 地点与在场人物都从当前模组派生（模组没写就是空）
    location: initialLocation(m, c),
    npcsAlive: initialNpcs(m, c),
    visited: initialLocation(m, c).trim() ? [initialLocation(m, c).trim()] : [],
  });
}

export function loadGameState(): GameState {
  const saved = loadJson<GameState | null>('trpg.gameState', null);
  if (saved && typeof saved === 'object' && saved.vitals) {
    // 血上限实时由属性派生，老存档里的 vitalsMax 快照一律忽略并重算
    const rid = loadRulesetId();
    const max = deriveVitalsMax(loadCharacter(), rid);
    saved.vitalsMax = max;
    // 当前血量若超过派生上限（旧数据可能偏高），裁剪回去
    for (const [k, v] of Object.entries(saved.vitals)) {
      const m = max[k];
      if (m != null && v > m) saved.vitals[k] = m;
    }
    // 缺键补齐：旧存档 / 换过规则包的档，vitals 可能缺 mp、san，界面上会显示成 0
    const gs = reconcileVitals(saved, loadCharacter(), rid);
    /*
     * P2-5·边界：**启动**这条腿也要补 label（另一条腿在 `migrateSave`）。
     *
     * v0.10.6 我只挂在 `migrateSave`（导入存档），可玩家**正常刷新**走的是这里 ——
     * 于是空 label 永远补不上，界面一直是「期限：这件事」（协作方第 22 版把它重开了）。
     * 判据与导入那条腿共用 `withDeadlineLabel`，别再各写一遍。
     */
    return withDeadlineLabel(gs, loadModule());
  }
  return fallbackState();
}

/** 由角色属性派生数值条上限（血/蓝由属性决定；SAN 上限固定 99） */
export function deriveVitalsMax(c: CharacterProfile, rulesetId: string): Record<string, number> {
  const rs = getRuleset(rulesetId);
  const vitals = rs.deriveVitals(c.characteristics);
  return Object.fromEntries(
    rs.vitalDefs.map((v) => [v.key, v.key === 'san' ? 99 : (vitals[v.key] ?? v.default)])
  );
}

/** 由角色属性派生数值条的**当前起始值**（血/蓝/理智各是多少） */
export function deriveVitalsFor(c: CharacterProfile, rulesetId: string): Record<string, number> {
  return getRuleset(rulesetId).deriveVitals(c.characteristics);
}

/**
 * 「生命现在是不是满的」—— **只有这一份**。
 *
 * 为什么要有它：界面上那根血条和「纯回血消耗品能不能用」问的是**同一个问题**
 * （关键的那条由规则包的 `isLife` 标出，老自定义包没标就退回 `hp`）。
 * 主人 2026-09-20 拍板「没掉血就不能用、数量不减」之后，它从"显示细节"变成了**规则**，
 * 那就只能有一处真源。两处各算一遍，迟早不一致。
 *
 * ⚠️ 上限必须走 `deriveVitalsMax`（由属性派生），**不能**用 `vitalDefs` 里那个静态最大值：
 * COC 的血上限是 (体质+体型)/10 算出来的，不是 99。
 */
export function isLifeFull(
  gs: Pick<GameState, 'vitals'>,
  character: CharacterProfile,
  rulesetId: string
): boolean {
  const lifeKey = getRuleset(rulesetId).vitalDefs.find((v) => isLifeVital(v, v.key))?.key ?? 'hp';
  const max = deriveVitalsMax(character, rulesetId)[lifeKey] ?? 99;
  return (gs.vitals[lifeKey] ?? max) >= max;
}

/**
 * 把 gameState 的数值条补齐到当前规则包的所有键。
 *
 * 为什么需要：换规则包、或读早期存档时，vitals 可能缺键（比如 DnD 只存了 hp）。
 * 缺键在界面上会显示成 0（`vitals[key] ?? 0`），看起来像"MP/SAN 掉了"——
 * 其实只是没有这个键。这里按属性派生值补上，缺什么补什么。
 */
export function reconcileVitals(
  state: GameState,
  character: CharacterProfile,
  rulesetId: string
): GameState {
  const rs = getRuleset(rulesetId);
  const derived = rs.deriveVitals(character.characteristics);
  const vitals: Record<string, number> = { ...state.vitals };
  let changed = false;
  for (const def of rs.vitalDefs) {
    const cur = vitals[def.key];
    if (!Number.isFinite(cur)) {
      vitals[def.key] = derived[def.key] ?? def.default;
      changed = true;
    }
  }
  // 旧存档可能没有 threads 字段（网状叙事的支线表是后加的）
  const threads = Array.isArray(state.threads) ? state.threads : [];
  return changed || threads !== state.threads ? { ...state, vitals, threads } : state;
}

export const WELCOME_ID = 'welcome';

/**
 * 模组里的 `{{称呼}}` 只允许留在开场白里（渲染时替换）。
 * 其它字段（especially startLocation / locations / mapNodes）是要直接显示的，
 * 一律提前替成真实值——否则会出现"当前地点：{{称呼}}的公寓房间"这种穿帮。
 */
export function sanitizeModuleTokens(m: Module, c: CharacterProfile): Module {
  const f = (t: string | undefined) => (t ? fillPlayerTokens(t, c) : t);
  return {
    ...m,
    startLocation: f(m.startLocation),
    locations: f(m.locations) ?? m.locations,
    mapNodes: m.mapNodes?.map((n) => ({ ...n, name: f(n.name) ?? n.name, note: f(n.note) })),
    npcs: m.npcs.map((n) => ({ ...n, name: f(n.name) ?? n.name, role: f(n.role) ?? n.role })),
  };
}

/**
 * 开局地点：优先模组的 startLocation，其次地点表第一行。
 *
 * 地点表第一行走 `firstLocationLine()` 而不是"整行照搬"——
 * 与开场白兜底用同一套解析，免得两处对"第一行是什么"给出不同答案。
 */
export function initialLocation(m: Module, c?: CharacterProfile): string {
  const explicit = m.startLocation?.trim();
  const raw = explicit || firstLocationLine(m.locations);
  return c ? fillPlayerTokens(raw, c) : raw;
}

/**
 * 开局在场人物：模组里在开场白 / 前言中点名出现的人。
 * 为什么不直接全填：没登场的人不该出现在"在场人物"里（会诱导 GM 拉人、也污染检定对象）。
 */
export function initialNpcs(m: Module, c?: CharacterProfile): string[] {
  const raw = `${m.opening ?? ''}\n${m.premise ?? ''}`;
  if (!raw.trim()) return [];
  const text = c ? fillPlayerTokens(raw, c) : raw;
  return m.npcs.filter((n) => n.name && text.includes(n.name)).map((n) => n.name);
}

/**
 * 从模组的 `urgency` 里推出"期限还有多久"。
 *
 * ## 为什么敢从文本里推
 * 有人会问：不是说不猜日期吗？
 * 不猜的是**绝对日期**（"3 月 7 日"——那要算今天是哪天、模组是哪年的，必错）。
 * 这里抽的是**相对期限**（"还有二十三天""只剩今晚""三天后船就开了"），
 * 它是一个**时长**，而且 `urgency` 的写法由我们的提示词规定过尺度
 * （短篇＝小时、中篇＝天、长篇＝周/月），所以抽取是稳定的。
 *
 * ## 抽不出来怎么办
 * **不编**。没有期限就是没有期限（`urgency` 写成"这件事拖得越久越糟"这种
 * 没有数字的说法时），界面不显示倒计时，模组照跑。
 * 宁可少一个倒计时，也不能凭空造一个假的时限吓玩家。
 *
 * ## 与契约里 `deadline_days` 的关系
 * 这里给的是**开局初值**；之后守密人可以在契约里用 `deadline_days` 修正，
 * 引擎每轮按 `elapsed` 往下减。
 */
export function deadlineOf(m: Module): Deadline | null {
  const text = `${m.urgency ?? ''}\n${m.stakes ?? ''}`.trim();
  if (!text) return null;
  const label = modDeadlineLabel(m);

  /*
   * 优先级：先找"天"（长篇/中篇），再找"小时/分钟"（短篇）。
   * 反过来的话，"二十三天"会被"三"这个数字抢走。
   */
  const dayMatch =
    /([一二两三四五六七八九十\d]+(?:\.\d+)?)\s*(?:个)?\s*(天|日|周|星期|礼拜)/.exec(text);
  if (dayMatch) {
    const n = cnNumber(dayMatch[1]!);
    if (n && n > 0) {
      const mult = /周|星期|礼拜/.test(dayMatch[2]!) ? 7 : 1;
      return deadlineFromDays(n * mult, label);
    }
  }
  // "今晚""天亮之前""今夜"这类短篇写法：折成到当天深夜（约 12 小时）
  if (/今晚|今夜|天亮之前|天亮前|今天之内|今日之内/.test(text)) {
    return { remain: 12 * 60, label };
  }
  const hourMatch = /([一二两三四五六七八九十\d]+(?:\.\d+)?)\s*(?:个)?\s*(小时|钟头)/.exec(text);
  if (hourMatch) {
    const n = cnNumber(hourMatch[1]!);
    if (n && n > 0) return { remain: Math.round(n * 60), label };
  }
  const minMatch = /([一二两三四五六七八九十\d]+(?:\.\d+)?)\s*(?:个)?\s*分钟/.exec(text);
  if (minMatch) {
    const n = cnNumber(minMatch[1]!);
    if (n && n > 0) return { remain: Math.round(n), label };
  }
  return null;
}

/**
 * 期限的说明文字：取模组 `urgency` 的第一句，截 24 字。
 *
 * ## 为什么单独抽出来（P2-5，协作方第 20 版）
 * `setDeadlineDays` 在"模型申报了 `deadline_days`、但模组推不出期限"时也要给 label ——
 * 以前那里写 `?? ''`，于是 label 一旦为空就**永远是空**，界面只能显示
 * 「期限：这件事 · 还剩 21 天」（连这是什么期限都说不出来）。
 * 现在两处共用这一个函数，判据只有一份，不会再分叉。
 */
export function modDeadlineLabel(m: Module): string {
  return (m.urgency ?? '').split(/[。；;\n]/)[0]?.trim().slice(0, 24) || '期限';
}

/**
 * 期限的说明文字为空时补一次 —— **判据只有这一处**。
 *
 * ## 为什么要跑在两条腿上（P2-5·边界，协作方第 22 版把它重开了）
 * 存档进内存有**两条路**：导入存档走 `migrateSave`、**正常刷新**走 `loadGameState`。
 * v0.10.6 我只挂在前者 → 玩家刷新后空 label 永远补不上，界面一直是「期限：这件事」。
 * 这不是"没修"，是**修在了错的那条腿**。
 *
 * 两条腿都调用这个函数，判据才真的只有一份。
 *
 * **不升 `SAVE_VERSION`** —— 给可选字段补值不是结构变。
 * 已有 label 的一律**不动**（只补不删）。
 */
export function withDeadlineLabel(gs: GameState, m: Module | undefined): GameState {
  if (!gs.deadline) return gs;
  if (String(gs.deadline.label ?? '').trim()) return gs;
  if (!m) return gs;
  return { ...gs, deadline: { ...gs.deadline, label: modDeadlineLabel(m) } };
}

/** 中文/阿拉伯数字 → 数字（只认个位到百位，够用） */
export function cnNumber(s: string): number | null {
  const t = s.trim();
  if (/^\d+(\.\d+)?$/.test(t)) return Number(t);
  const D: Record<string, number> = { 一: 1, 两: 2, 二: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9 };
  const m = /^([一二两三四五六七八九])?十([一二三四五六七八九])?$/.exec(t);
  if (m) return (m[1] ? (D[m[1]] ?? 1) : 1) * 10 + (m[2] ? (D[m[2]] ?? 0) : 0);
  if (D[t] != null) return D[t]!;
  return null;
}

/**
 * 各题材的兜底开场白 —— **只写"场景"，绝不写"情节"**。
 *
 * ⚠️ 这里踩过一次真实的坑（2026-09-17 主人报的）：
 * 原来 `coc` 那份写的是**默认模组《失踪的玛乔丽》的情节**
 * （"我女儿失踪十一天了" + "1924 年 3 月 7 日"）。于是任何**没写开场白**的模组
 * （测试模组、AI 生成的骨架、玩家自己写的）开局都会套上这一段 ——
 * 玩家看到的是**另一个故事的开头**，还顺手剧透了那个模组。
 *
 * 现在的规矩：**兜底只描述"你此刻所处的环境"，不出现任何具体人物、委托或事件**。
 * 而且它只是**最后一层**：模组自己有 `premise` / 起始地点时，优先用模组信息拼（见 `moduleOpening`）。
 */
export const FALLBACK_OPENINGS: Record<string, (c: CharacterProfile) => string> = {
  coc: () => `雨停了一阵，街上还湿着。屋里的灯是这层楼唯一亮着的东西，桌上摊着昨天没收拾完的纸。

窗玻璃上有一道旧裂纹，夜风从那里挤进来，把灯影吹得一晃一晃。`,
  tokyo: () => `末班电车从身后驶过，卷起一阵风。站台上只剩你一个人。

雨开始下了，打在铁皮顶棚上，声音很密。`,
  acg: () => `放课后的活动室只剩下你一个人。夕阳把黑板照成暖橘色，走廊里还有社团收拾东西的动静。

窗外，天暗得比平时早。`,
  pink: () => `雨还在下。你站在车站的屋檐下，看着水在台阶上汇成一小股，流进下水口。

伞面往你这边偏了偏。`,
  fantasy: () => `酒馆的门被风吹开又合上。火塘里的柴噼啪响了两声，屋里其他人都在低声说话。

你把最后一块干面包咽下去，盘算着口袋里的银币还够走几天。`,
};

/**
 * 从 locations 里取第一行当兜底的"你现在在哪"。
 *
 * 为什么要剥括号与列表符号：`locations` 是**多行人类文本**
 * （如 `霍尔特的侦探事务所（接待室 / 盥洗室）\n旧城区 · 圣烛照相馆…`），
 * 直接整行塞进开场白会变成"你此刻在**某某事务所（接待室 / 盥洗室）**"——很出戏。
 */
export function firstLocationLine(locations: string | undefined): string {
  for (const line of (locations ?? '').split('\n')) {
    const name = line
      .split(/[（(]/)[0]!
      .replace(/^\s*(?:[-*·•—]+|\d+\s*[.、)）])\s*/, '')
      .trim();
    if (name) return name;
  }
  return '';
}

/**
 * 模组没写开场白时，用它**自己的**前提与开局地点拼一段。
 *
 * 关键：这一层**只搬模组已有的字**（premise / startLocation / locations），
 * 不替它编情节 —— 拼出来的东西永远"属于这个模组"，不会串到别的故事上去。
 */
export function moduleOpening(c: CharacterProfile, m: Module, genreId: string): string {
  const premise = fillPlayerTokens(m.premise?.trim() ?? '', c);
  const here = m.startLocation?.trim() || firstLocationLine(m.locations);
  if (!premise && !here) return (FALLBACK_OPENINGS[genreId] ?? FALLBACK_OPENINGS.coc!)(c);

  const parts: string[] = [];
  if (premise) parts.push(premise);
  parts.push(here ? `你此刻在**${here}**。故事就从这里开始。` : '故事就从这里开始。');
  return parts.join('\n\n');
}

/**
 * 开场白 —— **属于模组**（第一幕），不是角色卡。
 *
 * 取法按优先级：
 * ① 模组自己写了 `opening` → 用它（作者最知道该怎么开场）；
 * ② 没写 → **用模组自己的信息拼**（前提 + 起始地点）；
 * ③ 连前提和地点都没有（空骨架）→ 才退到题材兜底（只有场景、没有情节）。
 *
 * 为什么不干脆要求"必须有开场白"：手写模组与 AI 生成的骨架都可能没这一项，
 * 而"开局一片空白"比"开场白朴素一点"糟得多。
 */
export function openingText(c: CharacterProfile, m: Module, genreId = 'coc'): string {
  const raw = m.opening?.trim();
  const body = raw ? fillPlayerTokens(raw, c) : moduleOpening(c, m, genreId);

  // 把"我要干嘛"直接摆到玩家眼前——这是最容易让人卡住的一环，不能只靠侧栏
  if (!m.goal?.trim()) return body;
  const lines = [`> **你要做的事**：${m.goal.trim()}`];
  if (m.stakes?.trim()) lines.push(`> **赌注**：${m.stakes.trim()}`);
  if (m.urgency?.trim()) lines.push(`> **时间**：${m.urgency.trim()}`);
  return `${body}\n\n${lines.join('\n')}`;
}

export function loadTheme(): ThemeName {
  const t = localStorage.getItem('trpg.theme');
  return t === 'ash' || t === 'parchment' ? t : 'midnight';
}

export function loadRulesetId(): string {
  const id = localStorage.getItem('trpg.rulesetId');
  // 只有注册过的规则包 id 才算数，否则回退 COC
  return id && listRulesets().some((r) => r.id === id) ? id : 'coc7';
}

/** 自建/导入的题材（存 localStorage，和内置题材合并使用） */
export function loadCustomGenres(): Genre[] {
  const list = loadJson<Genre[]>('trpg.customGenres', []);
  return Array.isArray(list) ? list.filter((g) => g?.id && g?.name) : [];
}

export function loadGenreId(): string {
  const id = localStorage.getItem('trpg.genreId');
  return id && listGenres(loadCustomGenres()).some((g) => g.id === id) ? id : 'coc';
}

export function loadTypography(): Typography {
  try {
    const raw = localStorage.getItem('trpg.typography');
    if (raw) return { ...DEFAULT_TYPOGRAPHY, ...JSON.parse(raw) };
  } catch {
    /* 忽略 */
  }
  return DEFAULT_TYPOGRAPHY;
}

/**
 * 守密人口吻（R8）。
 *
 * 为什么单独存一个 key 而不是塞进 `config`：它是**玩法口味**，不是 API 配置，
 * 不该跟着"导出配置"一起走（导出配置是给换机器/换模型用的）。
 * 读不出来一律退回默认 —— 默认口吻必须与"没做这个功能之前"的调子一致，
 * 这样没选过的人不会被平白换一种声音。
 */
/**
 * 生涯记录（R13/R30）。
 *
 * **单独一个 key**（`trpg.career`），不跟单局存档混在一起 ——
 * 单局会被"开新团"清掉、被回溯重写，而"我一共跑过多少场、有哪些成就"
 * 是跨所有局的，混进去就会一开新团就归零。
 *
 * 读坏了就退回空生涯：**宁可履历丢了，也不能让存档打不开**。
 */
export function loadCareer(): Career {
  try {
    const raw = localStorage.getItem('trpg.career');
    if (!raw) return emptyCareer();
    const p = JSON.parse(raw) as Partial<Career>;
    const base = emptyCareer();
    return {
      totals: { ...base.totals, ...(p.totals ?? {}), outcomes: { ...base.totals.outcomes, ...(p.totals?.outcomes ?? {}) } },
      achievements: p.achievements ?? {},
    };
  } catch {
    return emptyCareer();
  }
}

/**
 * 世界层（Phase 2）：**所有世界的留档**。
 *
 * 与生涯同一条口径 —— **单独一个 key**（`trpg.worlds`），不进单局存档。
 * 理由更硬：单局存档会被"开新团"整个清掉，而世界留档恰恰是**开新团时要读的**东西，
 * 混在一起就是自己吃掉自己。
 *
 * 读坏了宁可退回空世界集：**宁可不带留档开局，也不能让存档打不开**。
 */
export function loadWorlds(): Record<string, World> {
  try {
    const raw = localStorage.getItem('trpg.worlds');
    if (!raw) return {};
    const p = JSON.parse(raw) as Record<string, World>;
    if (!p || typeof p !== 'object') return {};
    const out: Record<string, World> = {};
    for (const [k, w] of Object.entries(p)) {
      if (!w || typeof w !== 'object') continue;
      const name = (w.name ?? '').trim() || k;
      out[k] = {
        id: w.id ?? k,
        name,
        updatedAt: w.updatedAt ?? '',
        snapshot: w.snapshot,
        runs: Array.isArray(w.runs) ? w.runs : [],
        modules: Array.isArray(w.modules) ? w.modules : [],
      };
    }
    return out;
  } catch {
    return {};
  }
}

/** 当前选中的世界名（空＝还没选过，界面按"跟着模组名走"处理） */
export function loadWorldName(): string {
  try {
    return localStorage.getItem('trpg.worldName') ?? '';
  } catch {
    return '';
  }
}

/**
 * 角色档案库（Phase 2）。同样**单独一个 key**（`trpg.archive`）——
 * 单局存档会被清、会被回溯重写，而"我捏过的那几张卡"该一直留着。
 */
export function loadArchive(): ArchivedCharacter[] {
  try {
    const raw = localStorage.getItem('trpg.archive');
    if (!raw) return [];
    const p = JSON.parse(raw) as ArchivedCharacter[];
    return Array.isArray(p) ? p.filter((c) => c && c.id && c.profile) : [];
  } catch {
    return [];
  }
}

/**
 * 生图队列（R40）。**单独一个 key**（`trpg.imageJobs`）。
 *
 * 读回来时把 `running` 一律降级成"中断"（见 `reviveJobs`）：
 * 进程已经没了，那条请求不可能还在飞；留在 `running` 只会让角标永远转圈。
 */
export function loadImageJobs(): ImageJob[] {
  try {
    const raw = localStorage.getItem('trpg.imageJobs');
    if (!raw) return [];
    const p = JSON.parse(raw) as ImageJob[];
    if (!Array.isArray(p)) return [];
    return reviveJobs(p.filter((j) => j && j.id && j.kind && typeof j.prompt === 'string'));
  } catch {
    return [];
  }
}

/** 读一个布尔开关（缺省 / 读坏都退回 `fallback`，绝不因为一个坏值把启动弄挂） */
export function loadFlag(key: string, fallback: boolean): boolean {  try {
    const raw = localStorage.getItem(key);
    if (raw == null) return fallback;
    const v = JSON.parse(raw);
    return typeof v === 'boolean' ? v : fallback;
  } catch {
    return fallback;
  }
}

export function loadGmVoice(): GmVoice {
  try {
    const raw = localStorage.getItem('trpg.gmVoice');
    if (raw) {
      const id = JSON.parse(raw);
      if (typeof id === 'string') return gmVoiceOf(id).id;
    }
  } catch {
    /* 忽略 */
  }
  return DEFAULT_GM_VOICE;
}

export function loadConfig(): ApiConfig {
  try {
    const raw = localStorage.getItem('trpg.config');
    if (raw) return { ...DEFAULT_CONFIG, ...JSON.parse(raw) };
  } catch {
    /* 忽略损坏的配置 */
  }
  return DEFAULT_CONFIG;
}

/**
 * 把存档解析成角色卡，并兼容早期版本的结构。
 *
 * 注意：默认值里不能放"会随用户输入变化"的字段（如 address / gender），
 * 否则老存档缺这个键时会被默认值填上、盖掉用户改过的内容。
 */
export function mergeCharacter(raw: string | null): CharacterProfile {
  if (!raw) return DEFAULT_CHARACTER;
  try {
    return migrateCharacter(JSON.parse(raw) as Record<string, unknown>);
  } catch {
    return DEFAULT_CHARACTER;
  }
}

/** 兼容早期角色卡：occupation / age / portrait / background → description */
export function migrateCharacter(p: Record<string, unknown>): CharacterProfile {
  const base = DEFAULT_CHARACTER;
  const l = p as {
    name?: string;
    gender?: string;
    address?: string;
    description?: string;
    personality?: string;
    scenario?: string;
    first_mes?: string;
    mes_example?: string;
    characteristics?: Record<string, number>;
    skills?: Record<string, number>;
    occupation?: string;
    age?: number;
    portrait?: string;
    background?: string;
    items?: string[];
  };
  const description =
    l.description ??
    [
      l.age ? `${l.age} 岁` : '',
      l.occupation ?? '',
      l.portrait ? `外貌：${l.portrait}` : '',
      l.background ?? '',
    ]
      .filter(Boolean)
      .join('。');
  return {
    name: l.name ?? base.name,
    gender: l.gender ?? '',
    description,
    personality: l.personality ?? '',
    mes_example: l.mes_example ?? '',
    characteristics: { ...base.characteristics, ...(l.characteristics ?? {}) },
    skills: l.skills ?? base.skills,
    address: l.address,
    portrait: l.portrait ?? '',
    items: Array.isArray(l.items) ? l.items : [],
  };
}

export function loadCharacter(): CharacterProfile {
  return mergeCharacter(localStorage.getItem('trpg.character'));
}

/**
 * 解析模组存档，兼容早期结构（只有 title/premise/opening/outline）。
 *
 * 老存档缺的新字段一律给空，而**不是**套 DEFAULT_MODULE ——
 * 否则会把默认模组的剧情内容混进用户自己的模组里。
 *
 * ⚠️ 这里**必须逐字带上新字段**。踩过一次：`worldbook` 加进了 `Module`
 * 却忘了在这里接住，于是"存盘 → 读盘"一次，模组自带的世界书就没了，
 * 表现成"世界书时有时无"。
 * **判据：凡 `Module` 上的可选字段，这里都要有一行**（写盘是全量 JSON，读盘却是白名单）。
 */
export function mergeModule(raw: string | null): Module {
  if (!raw) return DEFAULT_MODULE;
  try {
    const s = JSON.parse(raw) as Partial<Module> & { outline?: string };
    return {
      title: s.title ?? '',
      premise: s.premise ?? '',
      opening: s.opening ?? '',
      truth: s.truth ?? s.outline ?? '',
      npcs: Array.isArray(s.npcs) ? s.npcs : [],
      locations: s.locations ?? '',
      clueChain: s.clueChain ?? '',
      acts: s.acts ?? '',
      endings: s.endings ?? '',
      notes: s.notes ?? '',
      // 以下是后来陆续加的字段，同样不能在这里丢
      ...(s.startLocation !== undefined ? { startLocation: s.startLocation } : {}),
      ...(s.goal !== undefined ? { goal: s.goal } : {}),
      ...(s.stakes !== undefined ? { stakes: s.stakes } : {}),
      ...(s.urgency !== undefined ? { urgency: s.urgency } : {}),
      ...(s.scale !== undefined ? { scale: s.scale } : {}),
      ...(s.sourceNote !== undefined ? { sourceNote: s.sourceNote } : {}),
      ...(s.genre !== undefined ? { genre: s.genre } : {}),
      ...(Array.isArray(s.mapNodes) ? { mapNodes: s.mapNodes } : {}),
      ...(Array.isArray(s.items) ? { items: s.items } : {}),
      ...(Array.isArray(s.monsters) ? { monsters: s.monsters } : {}),
      // 模组自带的世界书：丢了它就等于"套用内置模组后世界观不跟着走"
      ...(Array.isArray(s.worldbook) ? { worldbook: s.worldbook } : {}),
    };
  } catch {
    return DEFAULT_MODULE;
  }
}

export function loadModule(): Module {
  // 读盘时也过一遍占位符：老存档里可能残留 {{称呼}}
  return sanitizeModuleTokens(mergeModule(localStorage.getItem('trpg.module')), loadCharacter());
}

/**
 * 存档结构版本号。
 *
 * 改动存档结构时把它 +1，并在 `migrateSave` 里补一条迁移 ——
 * 否则玩家读旧档时会因为缺字段而报错，看起来就像"存档坏了"。
 */
export const SAVE_VERSION = 4;

/**
 * 世界书合并：取**并集**（按 id 优先、其次按正文去重），而不是整体替换。
 *
 * 为什么：整体替换意味着"读一个条目更少的档 = 删掉我现在的东西"，
 * 玩家看到的就是"世界书消失了"。读档一律只补不删。
 */
export function mergeWorldbook(
  current: WorldbookEntry[],
  incoming?: WorldbookEntry[]
): WorldbookEntry[] {
  if (!incoming?.length) return current;
  const out = [...current];
  for (const e of incoming) {
    const idx = out.findIndex((x) => x.id === e.id || x.content === e.content);
    if (idx >= 0) out[idx] = { ...out[idx]!, ...e };
    else out.push(e);
  }
  return out;
}

/**
 * 存档迁移：把任意历史版本的存档补成当前结构。
 *
 * 原则是**只补不删**：旧档里没有的新字段一律给安全默认值，
 * 已有字段原样保留，绝不静默丢弃玩家的进度。
 */
export function migrateSave(raw: unknown): Partial<SaveFile> {
  const data = { ...((raw ?? {}) as Partial<SaveFile>) };
  const rid = loadRulesetId();
  const character = data.character
    ? migrateCharacter(data.character as unknown as Record<string, unknown>)
    : loadCharacter();
  if (data.character) data.character = character;

  if (data.module) {
    data.module = sanitizeModuleTokens(
      { ...MERGE_MODULE_DEFAULTS, ...data.module } as Module,
      character
    );
  }

  if (data.gameState && typeof data.gameState === 'object') {
    let gs = data.gameState as GameState;
    // 1) 数值条补齐到当前规则包的全集（缺键在界面上会显示成 0）
    gs = reconcileVitals(gs, character, rid);
    // 2) 地图迷雾的"去过的地方"是后加的
    if (!Array.isArray(gs.visited)) {
      gs = { ...gs, visited: gs.location?.trim() ? [gs.location.trim()] : [] };
    }
    // 3) 支线表与战斗轮也是后加的
    if (!Array.isArray(gs.threads)) gs = { ...gs, threads: [] };
    if (!gs.combat || typeof gs.combat !== 'object') {
      gs = { ...gs, combat: { active: false, round: 0, foes: [] } };
    } else if (!Array.isArray(gs.combat.foes)) {
      gs = { ...gs, combat: { ...gs.combat, foes: [] } };
    }
    if (!Array.isArray(gs.companions)) gs = { ...gs, companions: [] };
    if (!Array.isArray(gs.inventory)) gs = { ...gs, inventory: [] };
    if (!Array.isArray(gs.clues)) gs = { ...gs, clues: [] };
    if (!Array.isArray(gs.npcsAlive)) gs = { ...gs, npcsAlive: [] };
    /*
     * 伤口是 09-17 加的可选字段：旧档没有就是"没有伤口"，**不需要升 `SAVE_VERSION`**
     * （可选新增字段不升，替换/重命名结构才升 —— 判据见台账第 4 节）。
     * 这里只是把类型拢一下，避免下游到处写 `?? []`。
     */
    if (!Array.isArray(gs.wounds)) gs = { ...gs, wounds: [] };
    /*
     * 图鉴台账（R38）同样是可选新增字段：旧档没有就是"什么都没见过"。
     * 与 `wounds` / `npcNotes` 同一判据 —— **不升 `SAVE_VERSION`**。
     */
    if (!Array.isArray(gs.encountered)) gs = { ...gs, encountered: [] };
    if (!Array.isArray(gs.fought)) gs = { ...gs, fought: [] };
    /*
     * 5) 故事时钟（09-17 加的可选字段）。
     * 旧档没有就按"第 1 天上午九点"起步 —— **不升 `SAVE_VERSION`**
     * （可选新增字段不升，替换/重命名才升）。
     */
    gs = { ...gs, clock: normalizeClock(gs.clock ?? DEFAULT_CLOCK) };
    if (gs.deadline === undefined) gs = { ...gs, deadline: null };
    gs = withDeadlineLabel(gs, data.module);
    if (!gs.flags || typeof gs.flags !== 'object') gs = { ...gs, flags: {} };
    // 濒死标记与结档信息是后加的
    if (typeof gs.dying !== 'boolean') gs = { ...gs, dying: false };
    if (gs.ending === undefined) gs = { ...gs, ending: null };
    /*
     * 4) 负重：v4 给每件物品补 `weight`。
     * 老存档没有这个字段，缺了会被 `itemWeight()` 当成 1 兜底（结果一样），
     * 但补上之后玩家在背包里能看到重量、也能手动改，不必等他捡到新东西才有。
     */
    if (gs.inventory.some((it) => typeof it.weight !== 'number')) {
      gs = {
        ...gs,
        inventory: gs.inventory.map((it) =>
          typeof it.weight === 'number' ? it : { ...it, weight: 1 }
        ),
      };
    }
    data.gameState = gs;
  }

  // 队友候选是后来才纳入存档的（早期只存在 localStorage，换档就丢）
  if (!Array.isArray(data.companionCandidates)) data.companionCandidates = [];

  // 编年史：早期版本折叠后回合号会错乱，这里统一修正成单调递增
  if (Array.isArray(data.chronicle) && data.chronicle.length > 0) {
    let prev = 0;
    data.chronicle = data.chronicle.map((c, i) => {
      const turn = Number.isFinite(c?.turn) && c.turn > prev ? c.turn : prev + 1;
      prev = turn;
      return { ...c, turn };
    });
  }

  data.version = SAVE_VERSION;
  return data;
}

/** 读档时给模组补的最小默认值（只补键，不塞剧情内容） */
export const MERGE_MODULE_DEFAULTS: Module = {
  title: '',
  premise: '',
  opening: '',
  truth: '',
  npcs: [],
  locations: '',
  clueChain: '',
  acts: '',
  endings: '',
  notes: '',
};
