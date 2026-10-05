import { create } from 'zustand';

/* E 档 E1b：读档与初值装配已搬到 ui/state/。此处 import + 转发 —— 调用点零改动 */
import {
  loadJson,
  loadWorldbook,
  loadMessages,
  loadGameState,
  loadTheme,
  loadRulesetId,
  loadCustomGenres,
  loadGenreId,
  loadTypography,
  loadCareer,
  loadWorlds,
  loadWorldName,
  loadArchive,
  loadImageJobs,
  loadFlag,
  loadGmVoice,
  loadConfig,
  loadCharacter,
  loadModule,
  SAVE_VERSION,
  MERGE_MODULE_DEFAULTS,
  mergeCharacter,
  migrateCharacter,
  mergeModule,
  mergeWorldbook,
  migrateSave,
  fallbackState,
  deriveVitalsMax,
  deriveVitalsFor,
  isLifeFull,
  reconcileVitals,
  sanitizeModuleTokens,
  initialLocation,
  initialNpcs,
  deadlineOf,
  modDeadlineLabel,
  cnNumber,
  FALLBACK_OPENINGS,
  firstLocationLine,
  moduleOpening,
  openingText,
  DEFAULT_WORLDBOOK,
  WELCOME_ID,
  DEFAULT_TYPOGRAPHY,
  DEFAULT_CONFIG,
  DEFAULT_CHARACTER,
  TYPOGRAPHY_PRESETS,
} from './state/loaders.js';
export {
  loadCustomGenres,
  SAVE_VERSION,
  mergeCharacter,
  mergeModule,
  mergeWorldbook,
  migrateSave,
  deriveVitalsMax,
  deriveVitalsFor,
  isLifeFull,
  reconcileVitals,
  sanitizeModuleTokens,
  initialLocation,
  initialNpcs,
  deadlineOf,
  modDeadlineLabel,
  firstLocationLine,
  moduleOpening,
  openingText,
  TYPOGRAPHY_PRESETS,
};
import {
  deriveAddress,
  addressOf,
  fillPlayerTokens,
} from './state/tokens.js';
export {
  fillPlayerTokens,
  addressOf,
  deriveAddress,
};
import type { StoreState } from './state/storeState.js';

/* 内置模组与起始角色已搬到 core/seeds.ts（D 档批 2），这里只做转发 */
import { DEFAULT_MODULE, MODULE_LIGHTHOUSE, MODULE_FANTASY, BUILTIN_MODULES, STARTER_CHARACTERS } from '../core/seeds.js';
export { BUILTIN_MODULES, STARTER_CHARACTERS };


/* 类型定义已搬到 core/types.ts（D 档批 0），这里只做转发 —— 调用点不用改 */
import type {
  DiceBadge, CheckBadge, NpcLine, PendingCheck, StateChangeLine, StateChangeNotice, WorldbookEntry, ChronicleEntry, TurnSnapshot, Message, ApiConfig, CharacterProfile, ModuleNpc, MapNode, Module, ModuleMonster, ModuleItem, ThemeName, Typography, SaveFile,
} from '../core/types.js';
export type {
  DiceBadge, CheckBadge, NpcLine, PendingCheck, StateChangeLine, StateChangeNotice, WorldbookEntry, ChronicleEntry, TurnSnapshot, Message, ApiConfig, CharacterProfile, ModuleNpc, MapNode, Module, ModuleMonster, ModuleItem, ThemeName, Typography, SaveFile,
};

/* 技能与属性：实现已搬到 core/skills.ts（D 档），这里只做转发 —— 调用点不用改 */
import {
  SKILL_ALIAS,
  canonicalSkillName,
  characteristicBudget,
  checkTargetText,
  defaultCharacteristics,
  resolveCheckTarget,
  requiredWeaponFor,
  skillBudget,
  weaponMissingFor,
} from '../core/skills.js';
export {
  SKILL_ALIAS,
  canonicalSkillName,
  characteristicBudget,
  checkTargetText,
  defaultCharacteristics,
  resolveCheckTarget,
  requiredWeaponFor,
  skillBudget,
  weaponMissingFor,
};

import {
  SCALE_LABEL,
  actExpandSystemPrompt,
  actExpandUserPrompt,
  generateJson,
} from '../orchestrator/generate.js';
import { actAt, isActExpanded, normalizeActIndex, parseActs } from '../core/acts.js';
import type { ModuleScale } from '../orchestrator/generate.js';
import {
  applyDeltas,
  createInitialState,
  detectStatusEvents,
  DYING_FREEZE_REASON,
  type AppliedDelta,
  type Companion,
  type Ending,
  type Foe,
  type GameState,
  type InventoryItem,
  type StateDelta,
  type Thread,
  type Wound,
  type Deadline,
  type StoryClock,
} from '../core/state/gameState.js';
import {
  DEFAULT_CLOCK,
  clockLabel,
  deadlineFromDays,
  normalizeClock,
  tickClock,
  waitTargetMinutes,
} from '../core/clock.js';
import { isLifeVital } from '../core/rulesets/types.js';
import { statusFlagLines, tickStatusEffects, turnsKeyOf } from '../core/statusEffects.js';
import {
  INSANITY_TURNS,
  insanityNote,
  insanityOf,
  tickInsanity,
} from '../core/insanity.js';
import {
  bleedDelta,
  defaultWoundText,
  healBasis,
  healedByTime,
  parseWound,
  shouldBleed,
  totalBleed,
  woundFlagText,
  woundFromDamage,
  woundNote,
  woundRelief,
  type HealBasis,
} from '../core/wounds.js';
import {
  allNamedEntries,
  buildBestiary,
  castFromBestiary,
  findEntry,
  type BestiaryCard,
  type BestiaryEntry,
} from '../core/bestiary.js';

export type { Companion };
import { DYING_NOTE } from '../orchestrator/prompt.js';
import { roll, seededRng, type DieGroup } from '../core/dice/index.js';
import { rollPercentile } from '../core/rulesets/coc7.js';
/*
 * 本局的**运行期随机源**（种子派生 + 调用日志）。
 *
 * ⚠️ 只 import `currentRng`（getter）与 `reseedRun`，**绝不 import 一个 `let` 源** ——
 * 第一版就是那么写的，结果"换了种子还在用旧源"（绑定旧值），
 * 且让 `startNewGame()` 之后的用例失去 `Math.random` 桩。详见 `ui/runRng.ts` 头部。
 */
import { currentRng, reseedRun } from './runRng.js';
import { getRuleset, listRulesets, registerCustomRulesetsFrom } from '../core/rulesets/index.js';
import { getGenre, listGenres, type Genre } from '../core/genres.js';
import { DEFAULT_GM_VOICE, gmVoiceOf, type GmVoice } from '../core/voices.js';
import { emptyCareer, recordRun, type AchievementDef, type Career } from '../core/career.js';
import { stripModuleWorldbook } from '../core/worldbook.js';
import { summarizeRun } from './runSummary.js';
import {
  applySnapshot,
  defaultWorldName,
  findWorld,
  harvest,
  worldKey,
  type World,
} from '../core/campaign.js';
import {
  findCharacter as findArchivedCharacter,
  removeCharacter,
  upsertCharacter,
  type ArchivedCharacter,
} from './archive.js';
import {
  beginJob,
  dropJob,
  enqueueJob,
  failJob,
  hasRoom,
  jobKey,
  nextQueued,
  reviveJobs,
  stalledJobs,
  type ImageJob,
  type ImageJobKind,
} from './imageJobs.js';
import { encumbranceOf, encumbranceNote, type Encumbrance } from '../core/encumbrance.js';
import { presentNpcNames, pruneNpcNotes, touchNpcNotes } from '../core/npcNotes.js';
import { defaultImageSizeFor } from '../core/artSpec.js';

export type { Encumbrance };

/*
 * 先注册本地存的自定义规则包，再初始化 store（否则 `loadRulesetId` 认不到它们）。
 *
 * ⚠️ **读盘那一半在 UI 层**（`readLocal`）：2026-09-30 架构体检发现，
 * `core/rulesets/index.ts` 原来自己在 core 里调 `localStorage.getItem` ——
 * 而它自己第 45 行还写着「core 不许有 IO」。现在 core 只收**原始 JSON 串**做纯注册，
 * 边界闸门（`scripts/check-contract.mjs`）盯着这条不让它长回去。
 */
registerCustomRulesetsFrom(readLocal('trpg.customRulesets'));
import {
  loadAudioConfig,
  saveAudioConfig,
  setBgmVolume,
  setMasterVolume,
  startAmbience,
  startBgm,
  stopBgm,
  type AudioConfig,
} from './audio.js';
import { idbGet, idbSet } from './idb.js';
import { readLocal, removeLocal, writeLocal } from './state/storage.js';
import { pruneSnapshots } from './snapshotPrune.js';
import { generateImage, fetchImageAsLocal, ModelError } from '../providers/model.js';
import { isSelfContainedImage, isStoreableImage } from '../core/imageData.js';

export type { AudioConfig };

/** 快照最多保留的回合数，超出的从最旧的开始丢 */
const SNAPSHOT_LIMIT = 60;





/** 一段文本里是否还残留占位符（用于"只在需要时才重建对象"的短路判断） */
function hasToken(text: string | undefined): boolean {
  return !!text && text.includes('{{');
}

/**
 * 把游戏状态里所有会**显示给玩家**的文本过一遍占位符替换。
 * 只在真的含 `{{` 时才重建对象，避免每轮都换新引用导致无谓重渲染。
 */
export function sanitizeStateTokens(s: GameState, c: CharacterProfile): GameState {
  const notes = s.npcNotes ?? {};
  const dirty =
    hasToken(s.location) ||
    s.npcsAlive.some(hasToken) ||
    s.clues.some(hasToken) ||
    s.inventory.some((i) => hasToken(i.name) || hasToken(i.desc) || hasToken(i.note)) ||
    Object.keys(s.flags).some(hasToken) ||
    Object.values(s.flags).some((v) => typeof v === 'string' && hasToken(v)) ||
    // 档案的键就是 NPC 名字，值也常写"你认识的那个{{称呼}}"，同样要洗
    Object.entries(notes).some(
      ([k, v]) =>
        hasToken(k) ||
        hasToken(v?.role) ||
        hasToken(v?.note)
    );
  if (!dirty) return s;
  const f = (t: string) => fillPlayerTokens(t, c);
  const flags: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(s.flags)) {
    flags[f(k)] = typeof v === 'string' ? f(v) : v;
  }
  const npcNotes: Record<string, { role?: string; note?: string; met?: number }> = {};
  for (const [k, v] of Object.entries(notes)) {
    npcNotes[f(k)] = {
      role: v?.role ? f(v.role) : v?.role,
      note: v?.note ? f(v.note) : v?.note,
      met: v?.met,
    };
  }
  return {
    ...s,
    location: f(s.location),
    npcsAlive: s.npcsAlive.map(f),
    clues: s.clues.map(f),
    inventory: s.inventory.map((i) => ({
      ...i,
      name: f(i.name),
      desc: i.desc ? f(i.desc) : i.desc,
      note: i.note ? f(i.note) : i.note,
    })),
    flags,
    npcNotes: Object.keys(npcNotes).length ? npcNotes : s.npcNotes,
  };
}

/**
 * 由 locations 兜底生成地图节点（没有显式关系图时用）。
 *
 * 关键点：**兜底也必须给出可达关系**。
 * 早期这里只给节点、不给 links，结果"地图迷雾"因为"这个模组没有关系图"
 * 而被整块关掉 —— 开局就把所有地点名摊在玩家眼前（用户报的"迷雾失效"）。
 * 而地点表的书写顺序通常就是剧情推进顺序，所以这里按"一条线"串起来：
 * 站在当前位置只能看见并走到相邻的下一个，走一步亮一片，既不剧透也不锁死。
 */
export function mapNodesOf(m: Module): MapNode[] {
  const explicit = (m.mapNodes ?? [])
    .filter((n) => n?.name?.trim())
    .map((n) => ({
      name: n.name.trim(),
      links: (n.links ?? []).map((x) => String(x).trim()).filter(Boolean),
      note: n.note?.trim(),
    }));
  if (explicit.length > 0) {
    // 有关系图就照用它；一个 links 都没给，同样按顺序串成一条线
    return explicit.some((n) => n.links.length > 0) ? explicit : chainNodes(explicit);
  }

  const names: string[] = [];
  for (const line of (m.locations ?? '').split('\n')) {
    // 去掉"（接待室 / 盥洗室）"这类细节与"1. / - "这类列表符号，节点名要干净才画得下
    const name = line
      .split(/[（(]/)[0]!
      .replace(/^\s*(?:[-*·•—]+|\d+\s*[.、)）])\s*/, '')
      .trim();
    if (name && !names.includes(name)) names.push(name);
    if (names.length >= 9) break;
  }
  return names.length > 1
    ? chainNodes(names.map((name) => ({ name })))
    : names.map((name) => ({ name }));
}

/** 把一串地点按书写顺序连成一条线（相邻可走）——没有显式关系图时的兜底 */
function chainNodes(nodes: MapNode[]): MapNode[] {
  return nodes.map((n, i) => ({
    ...n,
    links: [nodes[i - 1]?.name, nodes[i + 1]?.name].filter((x): x is string => Boolean(x)),
  }));
}

/** 模组篇幅（定义在 orchestrator/generate，这里只是再导出，避免 UI 反向依赖） */
export type { ModuleScale };

/** 取某个题材的示例角色（没有就返回 undefined） */
export function starterCharacterOf(genreId: string): Partial<CharacterProfile> | undefined {
  return STARTER_CHARACTERS[genreId];
}

/*
 * ---------------------------------------------------------------------------
 * 示例角色的**技能** —— 一人一套，跟着人设走
 * ---------------------------------------------------------------------------
 * 主人 2026-09-17 报的：「属性技能与人设不匹配」。
 *
 * 病灶：原来"套用示例角色"时技能一律取 `rs.starterSkills`
 * （规则包给的**通用起始 8 项**），于是：
 *   - 奇幻的流浪剑客（凯尔·渡鸦）拿到的是「侦查 / 图书馆使用 / 聆听 / 说服」——
 *     一个背长剑的斥候不识字也不打架，这不是"数值对不上"，是**人设塌了**；
 *   - 灯塔模组的记者拿到同一套，也不合身。
 *
 * 规矩改成：**技能属于"人设"，不属于"规则包"**。
 * 规则包只负责回答"这个名字合不合法、基础值多少"，
 * 具体练了哪几项由人设说了算。
 *
 * 两条硬约束（都在 `starterSkillsFor` 里兜住）：
 *   ① 名字必须是当前规则包 `skillCatalog` 上有的（过 `canonicalSkillName` 规范化），
 *      否则角色卡上会出现一条查不到基础值的野技能 —— 掷不出来。
 *   ② 名字在规则包上找不到时**退回该规则包的通用起始项**，
 *      而不是硬塞一个野名字（宁可不合身，不能让角色卡坏掉）。
 *
 * 数值的尺度也随规则包变：COC 是百分比（70 = 70%），DnD 是加值（+3）。
 * 所以每个题材给两套数，用 `mainDice` 判据选。
 */
interface StarterSkillProfile {
  /** COC（1d100 百分比）用的一套 */
  coc: Record<string, number>;
  /** DnD（d20 加值）用的一套 */
  dnd: Record<string, number>;
}

const STARTER_SKILLS: Record<string, StarterSkillProfile> = {
  coc: {
    // 私家侦探：查案的本事是吃饭家伙
    coc: {
      侦查: 70,
      图书馆使用: 55,
      心理学: 60,
      说服: 50,
      潜行: 45,
      锁匠: 30,
      '射击（手枪）': 40,
      急救: 40,
    },
    dnd: {},
  },
  tokyo: {
    // 记者：跑现场、挖料、跟人磨
    coc: {
      侦查: 65,
      图书馆使用: 60,
      说服: 60,
      心理学: 50,
      聆听: 55,
      摄影: 50,
      母语: 60,
      潜行: 35,
    },
    dnd: {},
  },
  acg: {
    // 高中生：文艺部，观察力好但没什么战斗力
    coc: {
      侦查: 55,
      聆听: 50,
      图书馆使用: 45,
      说服: 45,
      母语: 60,
      闪避: 45,
      跳跃: 35,
      心理学: 35,
    },
    dnd: {},
  },
  urban: {
    // 街头"处理麻烦"的人：跑得快、下手狠、嘴也利
    coc: {
      潜行: 65,
      侦查: 55,
      闪避: 55,
      '格斗（斗殴）': 55,
      聆听: 50,
      说服: 45,
      心理学: 40,
      追踪: 35,
    },
    dnd: {},
  },
  fantasy: {
    // 流浪剑客 / 前斥候：会打、会潜、会看路
    coc: {
      '格斗（斗殴）': 70,
      '射击（步枪）': 55,
      潜行: 60,
      侦查: 55,
      追踪: 55,
      聆听: 50,
      闪避: 60,
      急救: 40,
    },
    // DnD 那一侧用加值（不是百分比）
    dnd: {
      运动: 3,
      隐匿: 3,
      察觉: 3,
      生存: 2,
      威吓: 2,
      调查: 1,
    },
  },
};

/**
 * 把题材的技能配方**适配到当前规则包**上。
 *
 * 为什么必须适配而不能直接用：同一份人设可能在两套规则下跑
 * （奇幻可以配 DnD，也可以配 COC —— 题材×规则是正交的，这是项目铁律）。
 * 配方里的 COC 百分比名（「格斗（斗殴）」）与 DnD 加值名（「运动」）
 * 属于两套**不同的词汇表**，硬套会把对方的名字写成野技能。
 *
 * 找不到该规则包对应的那一套 → 退到规则包自己的 `starterSkills`
 * （通用但不野，至少每一项都能掷）。
 * `rs` 为 `specificRuleset ?? mainDiceRuleset`：
 * 优先看当前规则包有没有专属那一套（如 fantasy 的 dnd），
 * 没有就退回规则包自带的通用项。
 */
export function starterSkillsFor(
  genreId: string,
  rulesetId: string
): Record<string, number> {
  const rs = getRuleset(rulesetId);
  const profile = STARTER_SKILLS[genreId];
  const isPercent = rs.mainDice === '1d100';
  const want = profile ? (isPercent ? profile.coc : profile.dnd) : undefined;

  // 规则包自己的通用起始项：永远是"合法的"，作为兜底
  const fallback = Object.fromEntries((rs.starterSkills ?? []).map((s) => [s.name, s.value]));

  if (!want || Object.keys(want).length === 0) return fallback;

  /*
   * 逐项对照规则包：名字不在技能表上的丢掉（写进角色卡也掷不出来）。
   * 用 `canonicalSkillName` 而不是精确匹配 —— 它能认别名
   * （"手枪" → "射击（手枪）"），也能认包含关系。
   */
  const known = new Set(rs.skillCatalog.map((s) => s.name));
  const out: Record<string, number> = {};
  for (const [rawName, value] of Object.entries(want)) {
    const name = canonicalSkillName(rawName, rs);
    if (!known.has(name)) continue;
    out[name] = value;
  }
  /*
   * 一项都没对上（比如换了个完全不同的规则包）→ 退到通用项。
   * 不做"部分保留"：留下半套残配方会比通用项更不像样。
   */
  return Object.keys(out).length > 0 ? out : fallback;
}





/**
 * 内置的两个示例队友（老杰克 / 米拉·陈）——**只在需要演示时用**。
 *
 * 注意：它们**不能**作为开团的默认同行者。之前 `startNewGame` 会把当前
 * `gameState.companions` 原样带进新团，导致开新团还留着上一局的队友
 * （用户报的"老杰克和米拉陈怎么一直在"）。
 * 现在新团的队友只能来自「模组包生成的候选」+ 玩家自己招募。
 */
export const SAMPLE_COMPANIONS: Companion[] = [
  {
    id: 'jack',
    name: '老杰克·霍洛威',
    role: '退休铁路工',
    personality:
      '话很少，相信直觉胜过证据。怕黑但要面子，死不承认。紧张时会突然讲一段修铁轨的旧事。不识字，看到文字会下意识依赖别人。',
    secret: '',
    skills: { 体格: 65, 锁匠: 40, 手枪: 30, 侦查: 35 },
    vitals: { hp: 14, san: 55, mp: 10 },
    initiative: 'reactive',
    alive: true,
    present: true,
  },
  {
    id: 'mira',
    name: '米拉·陈',
    role: '报社记者',
    personality:
      '好奇心压过判断力，嘴快，爱追问细节。为了独家新闻敢冒险，但真见到血会当场吐。习惯把一切记在小本子上。',
    secret: '',
    skills: { 侦查: 60, 说服: 55, 图书馆学: 45, 心理学: 40 },
    vitals: { hp: 10, san: 62, mp: 13 },
    initiative: 'balanced',
    alive: true,
    present: true,
  },
];




/**
 * 真正的写入（同步、可能抛配额异常）—— 实现在 `ui/state/storage.ts`。
 *
 * 这个薄壳留着是为了让 `saveJson` / `flushSaves` 的调用点不用改；
 * 写盘本身只有那一个入口，别在这里再写一遍 `localStorage`。
 */
function writeNow(key: string, value: unknown): void {
  writeLocal(key, JSON.stringify(value));
}

/*
 * ---------------------------------------------------------------------
 * 落盘节流（协作方 §五 性能三连 ①）
 * ---------------------------------------------------------------------
 *
 * 长局里 `trpg.messages` 会攒到几百条（还挂着 base64 图），
 * 而消息在流式输出期间**每几百毫秒就变一次** —— 每次都全量 `JSON.stringify`
 * 一个几 MB 的数组，主线程被它一顿顿卡住，打字和滚动都发涩。
 *
 * 做法：**同一个 key 在窗口内只落最后一次**（trailing）。
 * 中间那些中间态本来就没人会读——下一次写入马上又把它盖掉。
 *
 * ## 三条必须守住的
 * 1. **最后一次一定写**：窗口内只更新待写的值，定时器到点写**最新**那份，
 *    绝不写某个中间态。
 * 2. **页面要走之前必须 flush**：否则关标签页 / 手机切后台会丢掉最后 800ms 的内容。
 *    绑 `pagehide` + `visibilitychange`（hidden 时）—— 手机上切应用走的是后者。
 * 3. **结构性操作走 `saveJsonNow`**：清空、回溯、开新团、导入存档这类
 *    "后面还会写别的 key"的动作，必须**立刻**落盘并取消同 key 的待写，
 *    否则待写的旧值会在之后把新值盖回去（回溯后旧消息复活，就是这么来的）。
 */
const SAVE_THROTTLE_MS = 800;
const pendingSaves = new Map<string, unknown>();
const saveTimers = new Map<string, ReturnType<typeof setTimeout>>();
let persistGuardsBound = false;

/** 把待写的全部立刻落盘（页面隐藏 / 卸载 / 结构性操作前调用） */
export function flushSaves(): void {
  for (const t of saveTimers.values()) clearTimeout(t);
  saveTimers.clear();
  const entries = [...pendingSaves.entries()];
  pendingSaves.clear();
  for (const [k, v] of entries) writeNow(k, v);
}

/** 绑一次"走之前 flush"的兜底。没 `window`（单测）就跳过。 */
function bindPersistGuards(): void {
  if (persistGuardsBound || typeof window === 'undefined') return;
  persistGuardsBound = true;
  const flush = () => flushSaves();
  window.addEventListener('pagehide', flush);
  window.addEventListener('beforeunload', flush);
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') flush();
  });
}

function saveJson(key: string, value: unknown): void {
  bindPersistGuards();
  // 已经有待写 → 只把值换成最新的，不动定时器（否则会被无限推迟）
  if (saveTimers.has(key)) {
    pendingSaves.set(key, value);
    return;
  }
  pendingSaves.set(key, value);
  saveTimers.set(
    key,
    setTimeout(() => {
      saveTimers.delete(key);
      const latest = pendingSaves.get(key);
      pendingSaves.delete(key);
      writeNow(key, latest);
    }, SAVE_THROTTLE_MS)
  );
}

/**
 * 立刻落盘（并取消这个 key 的待写）。
 * 清空 / 回溯 / 开新团 / 导入存档这类**会连带改别的 key**的操作必须走它。
 */
function saveJsonNow(key: string, value: unknown): void {
  const t = saveTimers.get(key);
  if (t) clearTimeout(t);
  saveTimers.delete(key);
  pendingSaves.delete(key);
  writeNow(key, value);
}

/**
 * 流式输出期间的消息落盘：走同一个节流通道
 * （它与 `scheduleSaveMessages` 的关系见下——这里只负责"把当前值排进去"）。
 */
function scheduleSaveMessages(get: () => Store): void {
  saveJson('trpg.messages', get().messages);
}

/*
 * ── 生图队列（R40）的模块级零件 ─────────────────────────────────
 * 三条刻意的：
 * - **并发 2**：生图接口本来就慢（十几秒起），一次堆十个只会更慢、还容易撞限流。
 * - **`pumping` 重入锁**：一条跑完会再叫一次泵，不能让两个泵同时抢同一条排队任务。
 * - **队列立刻落盘**（`saveJsonNow`）：它是结构性的 —— 应用关掉之后再打开，
 *   你还得看得见"上次有两张没画完"。
 */
const IMAGE_CONCURRENCY = 2;
let pumping = false;

/**
 * 🔴 一次生图的**硬上限**（毫秒）—— 主人 2026-09-27 真机那条的直接答案。
 *
 * 症状是：「画图还在排队，一直不成功也不失败」，隔夜才冒出一句失败。
 * 根因：请求发出去之后**没有人给它计时**。服务端连上了但不回话（网关挂起 / 流式卡住 / 网络半死），
 * 那条任务就永远停在 `running` —— 占着并发槽，**排在它后面的图一张也开不了工**，
 * 玩家看到的是"正在画 N 张"和一个永远不动的队列。
 *
 * 取 3 分钟：正常的生图十几秒到一分钟；硅基流动偶尔会排到两分钟往上。
 * 再短会误杀慢但正常的请求，再长就是把"卡住"拖到玩家已经不想等了。
 */
export const IMAGE_TIMEOUT_MS = 180_000;

/**
 * 超时回收的宽限：单条任务自己会在 `IMAGE_TIMEOUT_MS` 处停下，
 * 只有"请假条没打上"的漏网（`stalledJobs`）才轮到这里。
 * 多给 30 秒，免得两条判据在同一毫秒打架。
 */
const IMAGE_STALL_MS = IMAGE_TIMEOUT_MS + 30_000;

/*
 * 🔴 `H26`（协28 §F① 第 20 条 · 协29 补裁）：**正在跑的那条也要能当场停**。
 *
 * 排队中的 `dismissImageJob` 一直能用；`running` 那条以前只有角标上一句「画着…」，
 * 玩家只能干等（或等 3 分钟硬闸）—— 自动配图连着画好几张、他突然改主意的时候没有出口。
 *
 * 句柄只活在内存里（不落盘）：刷新页面本来就没人接着跑，存它没意义。
 */
const imageAborts = new Map<string, AbortController>();

/** 超时时给玩家的那句人话（要能照着做下一步，不是一句"失败了"） */
export const IMAGE_TIMEOUT_NOTE =
  '这张图画超过 3 分钟还没回来，已经停下 —— 可以重试一次；' +
  '要是每次都这样，去「设置」换个生图模型（或把尺寸调小一点）会快得多。';

/**
 * 回收飞太久的任务，让它们**失败得看得见**，并把并发槽让出来给后面的图。
 *
 * 返回回收后的队列；一条都没到点就返回 `null`（调用方据此决定要不要落盘）。
 */
function reclaimStalled(list: readonly ImageJob[]): ImageJob[] | null {
  const now = Date.now();
  const stale = stalledJobs(list, now, IMAGE_STALL_MS);
  if (stale.length === 0) return null;
  let out = [...list];
  for (const j of stale) out = failJob(out, j.id, IMAGE_TIMEOUT_NOTE);
  return out;
}

function persistImageJobs(list: ImageJob[]): void {
  saveJsonNow('trpg.imageJobs', list);
}

/**
 * 把一张图写进 IndexedDB，并**把结果说出来**（P2-3）。
 *
 * `idbSet` 自己吞掉了异常（它不能把界面搞崩），于是"存不下"和"存好了"
 * 在调用方看来一模一样 —— 但这两件事对玩家的后果差得远：
 * 存好了＝这张图以后一直在；存不下＝**只有内存里这份，刷新就没了**。
 * 后者必须让玩家当场知道，否则他会以为图已经妥了。
 *
 * 返回 `true` 表示**图真的落到了盘上**。
 */
function putImageBlob(key: string, value: unknown): Promise<boolean> {
  return idbSet(key, value).then(
    () => true,
    () => false
  );
}

/** 存不下时的统一交代（只有一处说法） */
const IMAGE_STORE_FAILED = '存不进本地数据库了（可能空间已满），这张图刷新后会丢。';

/**
 * 落盘前的归一化（P2-3）：把生图接口给的**任意形态**变成能存下来的东西。
 *
 * - data URI → 直接就是图，原样返回；
 * - http 链接 → 试着 `fetch` 回来转 data URI（同源 / 允许 CORS 就能成）；
 *   抓不回来就**如实标成 remote** —— 调用方据此改口径说"临时链接"。
 *
 * **不做代理、不重试**：跨源被 CORS 挡是常态，绕过它等于替玩家做了一个
 * 他不知情的转发，而且会把他的 key 暴露给一个中间层。不值得。
 */
async function normalizeImage(
  raw: string
): Promise<{ kind: 'local' | 'remote'; value: string }> {
  if (isSelfContainedImage(raw)) return { kind: 'local', value: raw };
  const r = await fetchImageAsLocal(raw);
  if (r.kind === 'self') return { kind: 'local', value: r.value };
  return { kind: 'remote', value: raw };
}







/**
 * 把队友的数值规范到规则包定义的键（hp/san/mp），并记录状态条上限。
 * 模型生成的队友可能带脏键（如重复的 hp），这里统一清洗。
 */
export function normalizeCompanion(c: Companion, rulesetId = 'coc7'): Companion {
  const rs = getRuleset(rulesetId);
  const vitals: Record<string, number> = {};
  for (const def of rs.vitalDefs) {
    const v = c.vitals?.[def.key];
    vitals[def.key] = Number.isFinite(v) ? (v as number) : def.default;
  }
  return {
    ...c,
    vitals,
    vitalsMax: c.vitalsMax ?? { ...vitals },
    met: c.met ?? false,
  };
}





























/**
 * 把本轮的 applied 变更翻译成"人话"，给主页面的状态变化提示用。
 *
 * 只挑玩家真正关心的：数值条、背包、线索、在场人物、支线、地点。
 * flags 与战斗轮不在这里报（它们各自有常驻界面）。
 */
function describeChanges(
  applied: AppliedDelta[],
  after: GameState,
  vitalLabel: (key: string) => string
): StateChangeLine[] {
  const lines: StateChangeLine[] = [];
  const seen = new Set<string>();
  const push = (text: string, tone: StateChangeLine['tone']) => {
    if (!text || seen.has(text)) return;
    seen.add(text);
    lines.push({ text, tone });
  };

  for (const a of applied) {
    const t = a.delta.target;

    /*
     * ⚠️ **这里绝不做"少弹提示"的优化**（2026-09-17 主人当场纠正过一次）。
     *
     * 曾经加过一个 `announce` 开关：守密人声明"这件事我在正文里写过了"，
     * 就不弹这条状态变化提示，理由是"同一件事说两遍出戏"。
     * **那是错的，已经撤掉。** 主人的原话：
     * 「获得新物品的提示很朴素一个弹窗啊」——
     * 「状态可见」属于**框架**，不属于特效；它是玩家确认"系统真的把这笔账记上了"的唯一凭据。
     * 少一条提示不会让画面变干净，只会让玩家**莫名其妙**：
     * 东西到底进没进背包？血到底掉没掉？他只能自己猜。
     *
     * 判据（写死在这里，别再有人加回来）：
     * **宁可重复，不可缺失。** 叙事里写过一遍，不妨碍这里再确认一遍；
     *  反过来，叙事里含糊带过、提示又没了，就是纯粹的信息丢失。
     */

    if (t.startsWith('vitals.')) {
      const key = t.slice('vitals.'.length);
      const b = typeof a.before === 'number' ? a.before : null;
      const af = typeof a.after === 'number' ? a.after : null;
      if (b === null || af === null || b === af) continue;
      const diff = af - b;
      push(
        `${vitalLabel(key)} ${b} → ${af}（${diff > 0 ? '+' : ''}${diff}）`,
        diff > 0 ? 'up' : 'down'
      );
      continue;
    }

    if (t.startsWith('companions.')) {
      const [, id, field, vitalKey] = t.split('.');
      const name = after.companions.find((c) => c.id === id)?.name ?? id ?? '队友';
      if (field === 'vitals' && vitalKey) {
        const b = typeof a.before === 'number' ? a.before : null;
        const af = typeof a.after === 'number' ? a.after : null;
        if (b === null || af === null || b === af) continue;
        push(
          `${name} · ${vitalLabel(vitalKey)} ${b} → ${af}`,
          af > b ? 'up' : 'down'
        );
      } else if (field === 'alive' && a.after === false) {
        push(`${name} 倒下了`, 'down');
      } else if (field === 'present') {
        push(a.after ? `${name} 归队` : `${name} 离队`, a.after ? 'up' : 'info');
      }
      continue;
    }

    if (t === 'location') {
      const af = String(a.after ?? '');
      if (af && af !== a.before) push(`移步：${af}`, 'info');
      continue;
    }

    if (t === 'inventory') {
      const b = Array.isArray(a.before) ? (a.before as InventoryItem[]) : [];
      const af = Array.isArray(a.after) ? (a.after as InventoryItem[]) : [];
      if (!Array.isArray(a.before) || !Array.isArray(a.after)) continue;
      for (const item of af) {
        const prev = b.find((x) => x.id === item.id || x.name === item.name);
        if (!prev) push(`获得：${item.name}${item.qty > 1 ? ` ×${item.qty}` : ''}`, 'up');
        else if (prev.qty !== item.qty)
          push(`${item.name} ×${prev.qty} → ×${item.qty}`, 'info');
      }
      for (const item of b) {
        if (!af.find((x) => x.id === item.id || x.name === item.name))
          push(`失去：${item.name}`, 'down');
      }
      continue;
    }

    if (t === 'clues') {
      const b = Array.isArray(a.before) ? (a.before as string[]) : [];
      const af = Array.isArray(a.after) ? (a.after as string[]) : [];
      if (!Array.isArray(a.before) || !Array.isArray(a.after)) continue;
      for (const c of af) if (!b.includes(c)) push(`新线索：${c}`, 'up');
      for (const c of b) if (!af.includes(c)) push(`线索作废：${c}`, 'info');
      continue;
    }

    if (t === 'npcsAlive') {
      const b = Array.isArray(a.before) ? (a.before as string[]) : [];
      const af = Array.isArray(a.after) ? (a.after as string[]) : [];
      if (!Array.isArray(a.before) || !Array.isArray(a.after)) continue;
      for (const n of af) if (!b.includes(n)) push(`${n} 登场`, 'info');
      for (const n of b) if (!af.includes(n)) push(`${n} 离场`, 'info');
      continue;
    }

    if (t === 'threads') {
      const b = Array.isArray(a.before) ? (a.before as Thread[]) : [];
      const af = Array.isArray(a.after) ? (a.after as Thread[]) : [];
      if (!Array.isArray(a.before) || !Array.isArray(a.after)) continue;
      for (const x of af) {
        const prev = b.find((y) => y.name === x.name);
        if (!prev) push(`支线：${x.name}`, 'info');
        else if (prev.status !== x.status)
          push(`支线 · ${x.name}：${x.status || '（无状态）'}`, 'info');
      }
      for (const x of b) if (!af.find((y) => y.name === x.name)) push(`支线了结：${x.name}`, 'up');
      continue;
    }
  }
  return lines;
}

/** 同一轮里可能分几次调用 applyModelDeltas（状态 + 地点），在这个窗口内的提示合并 */
const CHANGE_MERGE_MS = 4000;

/**
 * 这一轮的"时间已经推过了"标记。
 *
 * 为什么需要：一轮回复里 `applyModelDeltas` 会被调**不止一次**
 * （状态一次、地点一次）。`elapsed` 是**整轮的量**，
 * 传两遍就等于把"三个小时"算成六个小时，倒计时会凭空掉得更快。
 *
 * 用"最后一次推进的时间戳 + 同一个合并窗口"来去重：
 * 窗口内的第二次调用认为"这一轮已经推过了"。
 * 与状态提示的合并共用 `CHANGE_MERGE_MS`，两者口径一致。
 */
/**
 * `N2-余`：时钟推进这一轮算过没有（与战斗轮 / 状态 / 伤口**分开**消费）。
 *
 * ⚠️ 四个标记各管一段，共用一个就会"先消费的把后到的饿死"（协30 §2.3 明写）。
 */
let clockTickPending = false;

/*
 * 🔴 状态结算也要去重（第 12 轮测出的 P1-3 后遗症）。
 *
 * `applyModelDeltas` 一轮里会被调**不止一次**（状态一次、地点一次），
 * 于是"中毒每轮扣 1"被算成了扣 2、轮数一次减 2（2 → 0 → 当场解除）。
 * 测试方实测：注入 `{中毒, 中毒轮数:2}` → 推一轮 → hp 掉 2 且一轮即清除，
 * 与 COC7 的表（`perRound{hp:-1} / duration 3`）对不上。
 *
 * 与时钟推进同一个道理：**一轮只算一次**。
 * 这里复用同一个合并窗口，口径一致。
 */
/*
 * 🔴 `N2`（协30 §2.3）：状态结算与伤口失血改成**一次玩家行动只算一次**（与 `G1` 同口径）。
 *
 * 病：`shouldTickStatus` 一直是**4 秒时间窗**。而真机一轮 32–121 秒，
 * 同一轮里 `applyModelDeltas` 必然被调多次（正文一次、地点一次、漏契约补一次），
 * 相隔 >4 秒就再扣一次 —— 真机看到的是「声明每轮 −1，实际 −2～−3」。
 * 第 13 轮给「状态半边」的已验是短回合注入，挡不住真 LLM 回合。
 *
 * ⚠️ **三个标记必须分开消费**（协30 明写"不要共用一个标记，先消费的会把后到的饿死"）：
 * 战斗轮、状态效果、伤口失血发生在同一轮的不同位置，共用标记的话第一个消费掉的
 * 就把另外两个饿死了。
 *
 * 📌 时钟推进原来是唯一还留着 4 秒窗的（`N2` 那一版没打回它），
 * 协31 §F① 第 1 条点名同病同治 —— 现在四个标记口径一致了，时间窗在本文件里彻底退场。
 */
let statusTickPending = false;
/** `N2`：伤口失血本轮算过没有（与状态结算分开消费） */
let bleedTickPending = false;

/*
 * 🔴 战斗轮也由**引擎**推进（P1-5 阶段 1，主人 2026-09-27 真机）。
 *
 * 以前 `combat.round` 只有一条路：提示词里请守密人自己写
 * （"玩家行动结算后把 combat.round 加 1"）。他忘了写，界面就永远"第 1 轮"——
 * 玩家的原话：「战斗轮还在，且一直停留在第一轮」。
 * 与 `P2-10`（`startClock` 有字段有读取、**没人写它**）是同一个坑。
 *
 * 为什么放在这里：`applyModelDeltas` 正是"这一轮落地"的那一刻 ——
 * 玩家行动 → 守密人回合 → 本轮变化落库 → **轮次 +1**，然后笔停在等玩家行动。
 *
 * ⚠️ 一轮里 `applyModelDeltas` 会被调多次（状态一次、地点一次）——
 * 所以去重不是"多久一次"，而是"**一次玩家行动只算一次**"（`G1`，见下）。
 */
let combatRoundPending = false;

/*
 * 🔴 `G17`：「等到某个时刻」的引擎落点。
 *
 * 玩家落消息时算出目标**绝对分钟**记在这，本轮结算时交给 `tickClock` ——
 * 它**同时当下限与上限**（协30 §2.4）：不许提前、也不许冲过头（真机冲到过次日 14:30）。
 * 一次性：用过就清。
 */
let pendingClockTarget: number | null = null;

/*
 * 🔴 `G23` + `G19`（**仅阶段 A**）：收束自检引导 —— 一次性，取走即清。
 *
 * 结算点守密人既没声明 `ending`、也没声明 `act_done` 时挂上；下一轮把
 * 「模组 endings ＋ 当前幕原文」再塞回提示词，逼他对照着自检一遍（只补通道，不硬判剧情）。
 * 用模块级而不是 store 字段：它**不该落盘**，属于"这一轮"的上下文（与 `foeDamageGrant` 同类）。
 */
let selfCheckNote: string | null = null;

export function setSelfCheckNote(note: string | null): void {
  selfCheckNote = note;
}

export function consumeSelfCheckNote(): string | null {
  const n = selfCheckNote;
  selfCheckNote = null;
  return n;
}

/*
 * 🔴 命中授权（`P1-5` 阶段二 · 主人 2026-09-28 拍板「骰子说了算」）。
 *
 * 玩家掷完一次检定，就把"这一轮掷没掷中"记下来；守密人回话落地时
 * （`applyModelDeltas`）把它交给引擎：**带 weapon 的攻击没有命中授权就不许扣血**。
 *
 * 为什么用时间窗：一次检定到守密人回话之间就是"这一轮"。
 * 2 分钟够任何一轮走完（生图那条链路都不止这个数），过期当"没掷过"。
 */
let lastCheckAt = 0;
let lastCheckSuccess = false;
/** `G27`：这一轮掷出**大失败**了吗（要"一次掉到位"用） */
let lastCheckFumble = false;
const CHECK_GRANT_MS = 120_000;

function noteCheckOutcome(ok: boolean, fumble = false): void {
  lastCheckAt = Date.now();
  lastCheckSuccess = ok;
  lastCheckFumble = fumble;
}

/** 给引擎的命中授权：'hit' 掷中 / 'miss' 掷了没过 / 'none' 这一轮没掷 */
function foeDamageGrant(): 'hit' | 'miss' | 'none' {
  if (Date.now() - lastCheckAt > CHECK_GRANT_MS) return 'none';
  return lastCheckSuccess ? 'hit' : 'miss';
}

/*
 * 🔴 属性变更授权（`G25` · 协28 §F① 第 6b 条 · 主人 2026-09-29：「**动我属性都要检定的**」）。
 *
 * 与 `foeDamageGrant` 同一手法（同一个窗口、同一份掷骰记录），判据更松一档：
 * **只要掷过**就算数 —— 引擎**不猜"该掷哪个检定"**（主人：「武器表也是一个烂活，穷举不太靠谱」；
 * 猜错会弹出不相干的检定、猜不出来又退到体格，两头都更糟）。那一半交回模型：
 * 要扣属性就在 `dice_requests` 里要一次检定，否则引擎拒落地。
 *
 * ⚠️ 与 `foeDamage` 的两处不同：
 *   1. **不限定战斗**（掉理智、坠落受伤都在战斗外）；
 *   2. 只管"有没有掷"和"是不是大失败"，不管成败 —— 掷没过也可能挨打
 *      （躲闪失败本来就该挨打）；成败影响的是"该不该掉"，那是叙事层的事。
 */
function harmGrant(): { checked: boolean; fumble: boolean } {
  return {
    checked: Date.now() - lastCheckAt <= CHECK_GRANT_MS,
    fumble: lastCheckFumble,
  };
}

/** **仅供测试**：清掉命中授权窗口（与 `resetStatusTickForTest` 同理） */
export function resetCheckGrantForTest(): void {
  lastCheckAt = 0;
  lastCheckSuccess = false;
  lastCheckFumble = false;
}

/*
 * 🔴 `G1`（协28 §F① 第 2 条 · 真机 4 次里复现 3 次）：**一次玩家行动只许计一轮**。
 *
 * 旧判据问的是「距上次推进够 4 秒了吗」—— 一次行动里只要出现两个相隔 >4 秒的结算点
 * （正文一轮 ＋ 漏契约时"只补契约"的兜底），轮次就 +2：真机跑出 `1→3→5→7`。
 * 规格原文是「你行动完、他叙述完，这一轮就结束」⇒ 期望 **+1**。
 *
 * 现在按**行动**计：玩家消息落盘时置标记，结算点消费掉。与 `shouldTickStatus` 同语义 ——
 * **按行动，不按秒**。这也是 `P2-10` 的兄弟款：得追问「什么时候算一次」。
 */
function markPlayerActed(): void {
  combatRoundPending = true;
  statusTickPending = true;
  bleedTickPending = true;
  clockTickPending = true;
}

/** 状态效果结算：这一轮算过没有（消费即清） */
function consumeStatusTick(): boolean {
  if (!statusTickPending) return false;
  statusTickPending = false;
  return true;
}

/** 伤口失血：这一轮算过没有（与上面**分开**消费 —— 共用会互相饿死） */
function consumeBleedTick(): boolean {
  if (!bleedTickPending) return false;
  bleedTickPending = false;
  return true;
}

/** 结算点：这一轮已经计过 → false（同一次行动里的第二、三次结算不再推进） */
function consumeCombatRoundTick(): boolean {
  if (!combatRoundPending) return false;
  combatRoundPending = false;
  return true;
}

/**
 * **仅供测试**：把"本轮已结算"的窗口清掉。
 *
 * 那个窗口是 4 秒，而测试是连着跑的 —— 不清的话前一个用例刚 tick 过，
 * 下一个用例就永远轮不到结算，断言会莫名其妙地失败。
 * 战斗轮那道窗口同理（同一个函数里清，免得测试只清一半）。
 */
export function resetStatusTickForTest(): void {
  statusTickPending = false;
  bleedTickPending = false;
  clockTickPending = false;
  combatRoundPending = false;
}

/**
 * 🔴 `N2-余`（协31 §F① 第 1 条 · P3）：**时钟推进也从 4 秒窗改成行动标记**。
 *
 * 这是 14.38 自己报备的遗留：`N2` 把状态结算与伤口失血改成"一次行动只算一次"，
 * 唯独时钟还留着 4 秒窗 —— **同一个病**（真机一轮 32–121 秒，一轮里 `applyModelDeltas`
 * 会被调多次）。同病同治，别让同一处判据留两种口径。
 */
function consumeClockTick(): boolean {
  if (!clockTickPending) return false;
  clockTickPending = false;
  return true;
}

/**
 * 引擎自己记的临时疯狂轮数（`flags.疯狂轮数`）。
 *
 * 为什么需要它：引擎写 `flags.临时疯狂` 时写的是**一句描述**
 * （"理智骤降 6 点，陷入临时疯狂"），里面没有轮数；
 * 真正的计数存在 `疯狂轮数` 这个键上（写入点在下面 `applyModelDeltas` 的推进处）。
 * 只读 `临时疯狂` 会让 `insanity().turns` **永远等于默认的 3**（协作方第 7 版 §2.1）。
 *
 * 这里统一取一份，给 `insanity()` 与检定惩罚两处用 ——
 * 口径与 `tickInsanity(flags, prevTurns)` 一致：**引擎记的轮数是真源**。
 */
function insanityTurnsHint(flags: Record<string, unknown> | undefined): number | undefined {
  const n = Number(flags?.['疯狂轮数']);
  return Number.isFinite(n) && n > 0 ? n : undefined;
}

/**
 * 模型即兴开打的敌人，血量用**敌对者表**兜底（协作方第 7 版 §4）。
 *
 * ## 为什么需要它
 * `castFromBestiary` 只有作者手动点「投入战斗」时才走。实战里模型用
 * `combat.foes add` 开打时，血量取它临场写的值（没写就缺省 10），
 * 而图鉴里显示的 `hp` 来自模组表 —— **同一只东西，打的时候一个数、图鉴里另一个数**。
 * 提示词已经要求"照表写、不得临场改"，但那靠模型自觉；这里补一道引擎兜底，
 * 守住 R38"数值别飘"的初衷。
 *
 * ## 规矩
 * **模型显式给了就以模型为准**，只补它没给的（hp 或 max 缺哪个补哪个）。
 * 表里也没有的，一律原样放行，让 `applyDeltas` 按它自己的缺省处理。
 *
 * ## 为什么放在这里而不是 `gameState.ts`
 * 模组表 `module.monsters` 在 UI 层，core 不该反向依赖 UI（这条边界是自己定的，别破）。
 * 名字匹配复用 `core` 的 `findEntry`（宽松匹配：精确 → 互相包含），不另写一份。
 */
function fillFoeNumbers(
  deltas: StateDelta[],
  monsters: readonly ModuleMonster[] | undefined
): StateDelta[] {
  if (!monsters?.length) return deltas;
  const table: BestiaryEntry[] = monsters.map((m) => ({
    id: m.id,
    name: m.name,
    look: m.look,
    hp: m.hp,
    attack: m.attack,
    behavior: m.behavior,
    weakness: m.weakness,
  }));

  let touched = false;
  const out = deltas.map((d) => {
    if (!d || d.target !== 'combat.foes' || d.op !== 'add') return d;
    const v = d.value;
    if (!v || typeof v !== 'object') return d;
    const foe = v as Foe & { max?: number };
    const name = String(foe.name ?? '').trim();
    if (!name) return d;
    const hit = findEntry(table, name);
    if (!hit) return d;

    const num = (x: unknown): number | null => {
      const n = Number(x);
      return Number.isFinite(n) && n > 0 ? n : null;
    };
    const givenHp = num(foe.hp);
    const givenMax = num(foe.max);
    const tableHp = num(hit.hp);

    // 模型两个都给了 → 原样放行
    if (givenHp !== null && givenMax !== null) return d;
    // 表里也没有 → 补不了，原样放行
    if (givenHp === null && tableHp === null) return d;

    touched = true;
    const hp = givenHp ?? tableHp!;
    /*
     * 🔴 `max`（上限）**绝不能拿"当前血量"来补**（主人 2026-09-27 真机："敌人血量与状态不符"）。
     *
     * 老写法是 `max: givenMax ?? hp` —— 守密人每轮"记一笔血量"时只写 `hp`
     * （他写的是"它现在还剩多少"，不是"它最多多少"），于是**上限被补成当前值**：
     *   敌人满血 20 → 打掉 12 剩 8 → 下一轮 add 只写 hp:8 → 补出 max:8
     *   → 血条渲染成 `8/8`（满格）→ 玩家看到的血量**跟他刚打掉的伤害对不上**。
     *
     * 现在按"这三点哪个最可信"排：
     *   ① 模型显式给了 → 用它的；
     *   ② 表里那只的满血值（作者填的、不随战斗漂）→ 用它；
     *   ③ 前两个都没有（自定义敌人且模型只写 hp）→ 才退到当前 hp。
     * 最后再夹一道"上限不小于当前值"，免得显示成 8/5 这种倒挂。
     */
    const max = Math.max(givenMax ?? tableHp ?? hp, hp);
    return { ...d, value: { ...foe, hp, max } };
  });
  return touched ? out : deltas;
}

/**
 * 模型写了 `combat.foes add` 却忘了 `name` —— 从它**自己刚写的正文**里把名字捞回来。
 *
 * ## 为什么是"从正文捞"而不是"从模组表挑"
 * 用户 2026-09-16 实测报的是「敌对者没有命名」。
 * 模型的行为模式很固定：正文里已经把那只东西描述得清清楚楚
 * （"泥水里站起来一个瘦长的身影，正是你们在井底见过的那个东西"），
 * 但它把 `combat.foes add` 当成"记一笔血量"，`name` 那栏就空着。
 *
 * 这时候**正确答案就在正文里**，只是没被填进结构。
 * 从模组表里随便挑一只塞给它是最糟的做法：表里三只东西，挑错了
 * 玩家就要打一个跟剧情无关的怪，而且图鉴（`encountered`）会记错人。
 * 所以这里只做一件事：**找正文里出现过的、模组敌对者表里的名字**。
 *
 * ## 判据
 * - 只在**缺 name** 时动手（模型填了的一律不动）。
 * - 候选来源：这一轮正文/理由里出现过的、`module.monsters` 表上的名字。
 *   表是"这个世界里合法存在的敌人"，从表里选不会凭空造出不存在的东西。
 * - 只命中**一个**才用。命中两个以上说明分不清是谁 —— 宁可交给下游的
 *   「不明的东西」兜底，也不赌。
 * - 正文一个字都没有 / 一个都对不上 → 原样放行（交给核心层的兜底名字）。
 *
 * 注意这里的"捞名字"**不是**在猜剧情：正文是模型自己写的，表是作者填的，
 * 我们只是把两者对上，不引入任何第三者信息。
 */
function patchUnnamedFoes(deltas: StateDelta[], narration: string | undefined): StateDelta[] {
  const hasUnnamed = deltas.some(
    (d) =>
      d &&
      d.target === 'combat.foes' &&
      d.op === 'add' &&
      d.value &&
      typeof d.value === 'object' &&
      !String((d.value as Partial<Foe>).name ?? '').trim()
  );
  if (!hasUnnamed) return deltas;

  const monsters = getStateModuleMonsters();
  if (!monsters?.length) return deltas;

  const text = String(narration ?? '');
  if (!text.trim()) return deltas;

  // 正文里点到名的、且确实在表上的 —— 命中唯一才敢用
  const hit = monsters
    .map((m) => m.name.trim())
    .filter((n) => n.length >= 2 && text.includes(n));
  const unique = Array.from(new Set(hit));
  if (unique.length !== 1) return deltas;
  const name = unique[0];

  /*
   * 只补这一个字段，`hp` / `max` 一律不动 —— 后面 `fillFoeNumbers`
   * 会因为名字对上了表而把数值补成表里的值，分工干净。
   */
  return deltas.map((d) => {
    if (
      !d ||
      d.target !== 'combat.foes' ||
      d.op !== 'add' ||
      !d.value ||
      typeof d.value !== 'object'
    ) {
      return d;
    }
    const foe = d.value as Partial<Foe>;
    if (String(foe.name ?? '').trim()) return d;
    return { ...d, value: { ...foe, name } };
  });
}

/**
 * `patchUnnamedFoes` 要用的模组敌对者表。
 *
 * 单独取一个函数是因为调用点在 `applyModelDeltas` 内部，
 * 那时候 `get()` 已经解构过了 —— 与其在参数里再穿一层，
 * 不如就地拿一次，语义也更清楚："此刻生效的模组是谁"。
 */
function getStateModuleMonsters(): readonly ModuleMonster[] | undefined {
  return useStore.getState().module?.monsters;
}

interface Store extends StoreState {

  addMessage(m: Omit<Message, 'id' | 'ts'>): string;
  updateMessage(id: string, patch: Partial<Message>): void;
  clearMessages(): void;

  setConfig(patch: Partial<ApiConfig>): void;
  /** 切换规则包（COC / DnD），并清空不兼容的旧属性/技能值，避免换规则后残留脏数据 */
  setRuleset(id: string): void;
  /** 切换题材预设（写法 / 画风 / 队友倾向都会跟着变） */
  setGenre(id: string): void;
  /** 保存一个自建/导入的题材（同 id 覆盖） */
  saveCustomGenre(g: Genre): void;
  removeCustomGenre(id: string): void;
  setCharacter(patch: Partial<CharacterProfile>): void;
  setModule(patch: Partial<Module>): void;
  /**
   * 处理契约里的 `deadline_days`（P2-5：期限归引擎，模型只许**定初值**、不许**改现值**）。
   *
   * - **已经有一个期限对象在**（不论剩多少、哪怕 `remain` 已归零）→ **整条忽略**。
   *   推进、到点、收尾只由 `applyModelDeltas` 的时钟结算按 `elapsed` 负责 ——
   *   否则模型一句「还剩 21 天」就能把倒计时续回来。
   * - **还没有期限**（开局模组推不出来）→ 才把这次申报当初值用，给短篇一个下限。
   * - 传非正数 / 非有限数＝设成无期限（`null`）；**但已有期限时同样忽略**，
   *   要清期限得走 `setDeadline(null)`（引擎侧的动作，不归模型）。
   */
  setDeadlineDays(days: number | undefined): void;
  /** 直接设定期限（含说明文字），开团时把模组的长线倒计时摆上 */
  setDeadline(d: Deadline | null): void;
  /**
   * **换模组**的完整动作（推荐用它，别自己拼 `setModule`）：
   * 改模组 + 撤掉上一个模组的世界书 + 装上这一个模组自带的世界书 + 同步开场白。
   *
   * `keepDerived` = true 时不动队友候选与 AI 生成的世界书条目
   * （用于"只改模组里某个字段"这种不算换模组的场景）。
   */
  applyModule(patch: Partial<Module>, opts?: { keepDerived?: boolean; affectsOpening?: boolean }): void;
  setStreaming(v: boolean): void;
  setPanel(p: Store['panel']): void;
  setTheme(t: ThemeName): void;
  upsertWorldbookEntry(e: WorldbookEntry): void;
  removeWorldbookEntry(id: string): void;
  /** 覆盖整份世界书（模组包派生词条时用） */
  setWorldbookEntries(list: WorldbookEntry[]): void;
  upsertCompanion(c: Companion): void;
  removeCompanion(id: string): void;
  /** 覆盖整份队友候选（模组包生成时用） */
  setCompanionCandidates(list: Companion[]): void;
  /** 把某个候选正式拉进队伍 */
  recruitCompanion(id: string): void;
  /** 无视某个候选 */
  dismissCompanionCandidate(id: string): void;
  /** 剧情里出现某候选的名字时，标记为"已登场"（未登场不可入队） */
  markCandidatesMet(text: string): void;
  /** 保存某地点的场景立绘 */
  /** 落盘成功返回 true（存不下＝刷新就丢，调用方可能要提示玩家） */
  setSceneImage(location: string, url: string): Promise<boolean>;
  /** 给某条 GM 回复挂/删一张动作场景小图 */
  setMessageSceneImage(msgId: string, url: string): Promise<boolean>;
  /** 设置 / 清除地图总览图 */
  setMapImage(url: string): Promise<boolean>;
  /** 启动时把 IndexedDB 里的图片读回内存（异步，故不能放在初始化里） */
  hydrateImages(): Promise<void>;
  /*
   * ── 生图队列（R40）────────────────────────────────────────────
   * 以前生图是**组件里的一次 await**：切个页签回来，组件卸载了，
   * 那张图既看不见进度、也不知道最后落哪儿去了。现在它住在这里。
   */
  /**
   * 排一个生图任务。返回排进去/命中的那条；
   * **没配 API Key 或没填生图模型时返回 null**（调用方负责说人话，不排空任务）。
   */
  queueImage(job: {
    kind: ImageJobKind;
    target: string;
    prompt: string;
    label: string;
  }): ImageJob | null;
  /** 重试一条失败的任务 */
  retryImageJob(id: string): void;
  /** 不管了 —— 从队列里去掉（失败的那条 / 排队中的那条） */
  dismissImageJob(id: string): void;
  /**
   * `H26`：**正在跑的那条也停掉** —— 掐断请求并出队（玩家改主意了就是不要了）。
   * 与 `dismissImageJob` 分开：那个只管"别画了，从队列里去掉"，
   * 它管"把已经在飞的这一张也拉回来"。
   */
  cancelImageJob(id: string): void;
  /** 推一把队列：把排队的按并发上限发出去（多余的等前面跑完自动续） */
  pumpImageJobs(): Promise<void>;
  /**
   * 跑一条任务（**内部用**，公开只因为 zustand 的方法都挂在同一个对象上）。
   * 成功后结果直接落到该在的位置并出队；失败留在队列里等重试。
   */
  runImageJob(job: ImageJob): Promise<void>;
  /**
   * 把生成好的图**送到它该在的位置**（消息小图 / 地点场景 / 地图 / 立绘）。
   * 抽出来是为了"往哪儿写"只有一处说法 —— 以后加新的图种只改这里。
   *
   * **只收已经落地的图**：调用方必须先过 `normalizeImage()`。
   * 这里再保一道闸（`isSelfContainedImage`）—— 一个 http 链接从这道门进去，
   * 就意味着导出会撒谎说"已内嵌"。
   */
  /**
   * **返回 `boolean`**：`true` = 落下了；`false` = 被闸门拒了（P1-2）。
   * 拒落时调用方必须走 `failJob`，不能照常 `dropJob` —— 否则玩家什么也看不到。
   */
  applyImageResult(job: ImageJob, url: string): Promise<boolean>;
  /**
   * 把一张形象图落到 `gameState.foeArt[名字]`（怪物与关键人物共用）。
   *
   * 名字键与 `combat.foes[].name` / `npcsAlive` 同一套，所以图鉴卡与档案卡
   * 都能用同一个名字取到图。传空串＝删掉这张（「移除」按钮走这条路）。
   */
  setFoeArt(name: string, url: string): void;
  /** 覆盖整条待掷检定队列（守密人一次要求多个时用） */
  setPendingChecks(list: PendingCheck[]): void;
  /** 掷掉队列里的第 index 个 */
  removePendingCheck(index: number): void;
  /** 清空整条队列 */
  clearPendingChecks(): void;
  /** 清掉主页面的状态变化提示 */
  clearChanges(): void;
  /** 取走后台留下的一句提示（取完即清，不会重复弹） */
  takeNotice(): void;
  /**
   * 冒一句给玩家看的话（`App.tsx` 会 toast 出来）。
   *
   * 用途：**可见降级** —— 出了玩家该知道、但系统没法自动补救的事，
   * 用一句人话说清"发生了什么 + 你现在能做什么"（不是技术错误信息）。
   */
  notify(message: string): void;
  /** 当前负重（界面与提示词共用同一份计算，别各算一遍） */
  encumbrance(): Encumbrance;
  /**
   * 伤口现状 + 止血依据（界面与提示词共用同一份计算）。
   * 返回的 `note` 已经是可以直接拼进提示词的整段话（没伤口时是 null）。
   */
  woundStatus(): { wounds: Wound[]; basis: HealBasis; relief: 'stop' | 'relief' | 'none'; note: string | null };
  /** 临时疯狂现状（有界可恢复的数值惩罚），`note` 可直接拼进提示词 */
  insanity(): {
    active: boolean;
    turns: number;
    penalty: number;
    label: string;
    note: string | null;
  };
  /**
   * 图鉴现状（R38）。
   *
   * `cards` 已经把"没交过手就不给弱点"这件事做完（见 `bestiaryCard`），
   * UI 直接画，**不要再自己判一次可见度**——判两处迟早漏一处。
   */
  bestiary(): {
    unlocked: boolean;
    cards: BestiaryCard[];
    seen: number;
    fought: number;
    total: number;
  };
  /**
   * 按敌对者表的数值把它们放进战斗（`castFromBestiary` 的落点）。
   *
   * 传空数组＝投放表里**全部**有名字的。返回真正投进去的名字，
   * 调用方可以据此给一句"XX 已入场"的反馈。
   */
  startCombatFrom(entries: BestiaryEntry[], names?: string[]): string[];
  /** 取走待注入的濒死引导（取完即清，保证只说一次） */
  consumeDyingNote(): string | null;
  /** 内部用：设置 / 清掉濒死引导 */
  setDyingNote(note: string | null): void;
  /** 开发者模式：打开后才显示测试沙盒入口（灌测试存档 / 脚本化模组） */
  devMode: boolean;
  /** 切换开发者模式 */
  setDevMode(on: boolean): void;
  /** 写入模组的道具表（作用单独生成） */
  setModuleItems(list: ModuleItem[]): void;
  /** 手动清理由 AI 生成的世界书条目（手写条目保留） */
  clearModuleWorldbook(): void;
  /** 换模组时调用：清掉属于上一个模组的世界书条目与队友候选 */
  clearModuleDerived(): void;
  /** 更新正文排版设置 */
  setTypography(patch: Partial<Typography>): void;
  /** 换守密人口吻（R8）。只影响"怎么讲"，不影响任何规则与数值 */
  setGmVoice(id: GmVoice): void;
  /** 带图战报总开关（关键节点自动生图）。默认关 —— 开了会真的花钱 */
  setAutoIllustrate(on: boolean): void;
  /**
   * 世界层（Phase 2）：改"这一局属于哪个世界"。
   *
   * 空字符串＝跟着模组名走（见 `currentWorldName()`）。改名**不会丢留档**：
   * 留档按 `worldKey(name)` 找，只有玩家**主动点了一个已有世界**或
   * **打了一个新名字**才会换 —— 准备页就是这么给的。
   */
  setWorldName(name: string): void;
  /** 开新团时要不要接着上一次跑 */
  setCarryWorld(on: boolean): void;
  /** 忘掉一个世界的留档（名字与履历一起删）。**只是世界的事，不碰任何存档** */
  forgetWorld(id: string): void;
  /**
   * 角色档案库：把**当前这张卡**存进去（同名＝更新）。
   * @returns 入库的那条 + 是不是覆盖了同名卡
   */
  archiveCurrentCharacter(): { entry: ArchivedCharacter; replaced: boolean };
  /**
   * 从档案库取一张卡当当前角色卡。
   *
   * **只换人设与数值，不动这一局正在跑的剧情** ——
   * 换卡是准备页的事，真要按新卡开局得开新团（`startNewGame`）。
   */
  useArchivedCharacter(id: string): boolean;
  /** 从档案库删一张卡 */
  deleteArchivedCharacter(id: string): void;
  /**
   * R13/R30：把**这一局**记进生涯（并结算成就）。
   *
   * 只该在**结档时调用一次** —— 它会 +1 局。返回这一局**新解锁**的成就
   * （已经拿过的不再返回，用户要的"一次性防刷"）。
   * 幂等性靠调用方保证：`App.tsx` 只在 `ending.at` 变化那一次调。
   */
  recordCurrentRun(): AchievementDef[];
  /** R14：把当前幕号设成 `index`（0 起） */
  setActIndex(index: number): void;
  /**
   * R14：展开第 `index` 幕的导演稿（不传就用当前幕号）。
   *
   * 会自动跳过"已经展开过"的那一幕（**不重复花钱**）。
   * 返回是否拿到了稿子；没拿到（没配 Key / 模型没给 / 幕不存在）一律返回 false，
   * **不抛异常、也不挡游戏** —— 展开失败只是少一份幕后材料，故事照跑。
   */
  expandAct(index?: number): Promise<boolean>;
  /** 更新音频设置（会同步启动/停止氛围音与 BGM） */
  setAudio(patch: Partial<AudioConfig>): void;
  addChronicle(text: string, location?: string): void;
  /** 把前若干条日志压成摘要，剩下的保留为明细 */
  foldChronicle(keepFrom: number, summary: string): void;
  clearProgress(): void;
  /** 用当前的模组 + 角色卡开一团新游戏：清空剧情与进度，重新生成开场 */
  startNewGame(): void;

  /** 本地掷骰（不经过模型）。`seed` 只给测试注入；省略时用本局的运行期随机源。 */
  rollExpression(expr: string, seed?: number): DiceBadge;
  /** 技能检定：本地掷骰 + 规则包判定 */
  /**
   * 掷一次技能检定。
   * `bonus` 是描述加权给出的目标值修正量（正数＝更容易），由引擎在**掷骰之前**加进目标值，
   * 所以判定、成功率与结果标签都是一致的 —— 不是事后改数。
   */
  skillCheck(
    skill: string,
    difficulty?: 'regular' | 'hard' | 'extreme',
    bonus?: number,
    seed?: number
  ): CheckBadge;
  /**
   * 应用模型返回的状态变更。
   *
   * `opts.elapsed` ＝ 这一轮剧情里过去了多久（守密人申报的自然语言量）。
   * 引擎会折算成分钟推进故事时钟、并扣减期限倒计时；同一轮的第二次调用会被去重。
   *
   * `opts.mentionedItems` ＝ 玩家这一句里**点名**到的背包物品（由 `itemsMentionedIn()` 算出）。
   * 只用来做「模型忘了扣」的可见反馈（协作方第 17 版 D）：
   * 点了全名、契约里却没有对应的 `inventory dec` → 状态变化里说一句「「××」还在背包里」。
   * **绝不**据此替玩家扣东西 —— 那是 A+B 明令禁止的本地预扣。
   */
  applyModelDeltas(
    deltas: StateDelta[],
    opts?: { elapsed?: string; mentionedItems?: string[] }
  ): void;
  /** 记录回合开始时的状态快照（以该回合的玩家消息 id 为键），供回溯使用 */
  snapshotTurn(playerMsgId: string): void;
  /** 把某个回合标成"关键决策点"（回溯锚点） */
  markSnapshotKey(playerMsgId: string, label?: string): void;
  /** 把待掷检定队列写进该回合的快照（回溯时可原样恢复） */
  setSnapshotPendingChecks(playerMsgId: string, list: PendingCheck[]): void;
  /**
   * 引擎强制结档（求死、放弃抵抗等）。
   * 不走模型：模型对自杀有安全对齐，会产出软拒绝把剧情拉回来，
   * 玩家的意志反而被"救"了——这种事必须由引擎说了算。
   *
   * 也是**守密人声明收束**（契约里的 `ending`）的落点：那种情况同样只需要
   * 写下一个"空正文的 ending"，结局正文由 App 的唯一出口去要。
   */
  forceEnding(kind: Ending['kind'], reason?: string): void;
  /** 结档：写一段守密人给的结局正文 */
  setEnding(kind: Ending['kind'], text: string): void;
  /** 清除结档状态（开新团、或玩家从结档页回溯时） */
  clearEnding(): void;
  /** 回溯到某条玩家消息之前：恢复当时的状态并截断其后所有消息 */
  rewindBefore(msgId: string): void;
  /** 从导出的存档恢复（会自动做版本迁移） */
  loadSave(raw: unknown): void;
  /**
   * 序列化"这一局的全部战役数据"。
   *
   * 导出存档、存槽位**必须共用它**——分开写两份字段清单，迟早会漏掉一个
   * （`companionCandidates` 就是这么漏的）。
   */
  buildSave(): SaveFile;
}



/**
 * 这一局**实际**用哪个世界名。
 *
 * 玩家没写过就跟着模组名走 —— 这样"不填"永远是合理的默认，
 * 而不是一个叫"未命名"的世界（那对玩家没有任何意义）。
 */
export function currentWorldName(s: { worldName: string; module: { title: string } }): string {
  const explicit = (s.worldName ?? '').trim();
  return explicit || defaultWorldName(s.module?.title ?? '');
}



let seq = 0;
const uid = () => `${Date.now().toString(36)}-${(seq++).toString(36)}`;

export const useStore = create<Store>((set, get) => ({
  messages: loadMessages(),
  gameState: loadGameState(),
  config: loadConfig(),
  character: loadCharacter(),
  module: loadModule(),
  rulesetId: loadRulesetId(),
  genreId: loadGenreId(),
  customGenres: loadCustomGenres(),
  streaming: false,
  panel: 'chat',
  theme: loadTheme(),
  worldbook: loadWorldbook(),
  chronicle: loadJson<ChronicleEntry[]>('trpg.chronicle', []),
  summary: loadJson<string>('trpg.summary', ''),
  snapshots: loadJson<Record<string, TurnSnapshot>>('trpg.snapshots', {}),
  companionCandidates: loadJson<Companion[]>('trpg.companionCandidates', []),
  // 图片走 IndexedDB，这里先给空值，由 hydrateImages() 异步灌入
  sceneImages: {},
  messageImages: {},
  mapImage: '',
  imageJobs: loadImageJobs(),
  pendingChecks: [],
  lastChanges: null,
  dyingNote: null,
  uiNotice: null,
  typography: loadTypography(),
  gmVoice: loadGmVoice(),
  autoIllustrate: loadFlag('trpg.autoIllustrate', false),
  career: loadCareer(),
  lastUnlocked: [],
  worlds: loadWorlds(),
  worldName: loadWorldName(),
  // 默认**开**：有留档就接着跑，正是这东西存在的理由；准备页会明写会带什么过去
  carryWorld: loadFlag('trpg.carryWorld', true),
  characterArchive: loadArchive(),
  audio: loadAudioConfig(),

  addMessage(m) {
    /*
     * `G1`：玩家落了一条行动 → 这一轮的战斗轮"还没计过"。
     * 标记在这里置、在 `applyModelDeltas` 的结算点消费，**一次行动只推一轮**。
     */
    if (m.role === 'player') {
      markPlayerActed();
      // `G17`：这一句若写了「等到 X」，算出时钟下限（本轮结算时交给 `tickClock`）
      pendingClockTarget = waitTargetMinutes(
        String(m.content ?? ''),
        get().gameState.clock ?? DEFAULT_CLOCK
      );
    }
    const id = uid();
    set((s) => {
      const next = [...s.messages, { ...m, id, ts: Date.now() }];
      saveJson('trpg.messages', next);
      return { messages: next };
    });
    return id;
  },

  updateMessage(id, patch) {
    set((s) => ({
      messages: s.messages.map((m) => (m.id === id ? { ...m, ...patch } : m)),
    }));
    // 流式期间高频调用，走节流
    scheduleSaveMessages(get);
  },

  clearMessages() {
    // 结构性操作：立刻落盘，避免待写的旧消息稍后把它盖回来
    saveJsonNow('trpg.messages', []);
    saveJsonNow('trpg.snapshots', {});
    set({ messages: [], snapshots: {} });
  },

  snapshotTurn(playerMsgId) {
    const s = get();
    const next: Record<string, TurnSnapshot> = {
      ...s.snapshots,
      [playerMsgId]: {
        gameState: s.gameState,
        chronicle: s.chronicle,
        summary: s.summary,
        // 该回合产生的待掷队列会在 GM 回复后由 setSnapshotPendingChecks 补写进来
        pendingChecks: [],
      },
    };
    /*
     * 清掉已被删除消息的快照，再按回合数上限裁剪。
     *
     * **锚点豁免**（G1）：剪辑只从最旧的**非锚点**开刀。
     * 原来是一律丢最旧的，长局里会把早期关键抉择一起裁掉 ——
     * 那正是玩家最想回去的岔路口，回溯功能等于只对最近一截有效。
     * 判据在 `pruneSnapshots()`（纯函数、可单测），这里只负责喂数据。
     */
    const alive = new Set(s.messages.map((m) => m.id));
    const entries = Object.entries(next).filter(([k]) => alive.has(k));
    const pruned = Object.fromEntries(pruneSnapshots(entries, SNAPSHOT_LIMIT));
    saveJson('trpg.snapshots', pruned);
    set({ snapshots: pruned });
  },

  markSnapshotKey(playerMsgId, label) {
    const s = get();
    const snap = s.snapshots[playerMsgId];
    if (!snap || snap.key) return;
    const next = {
      ...s.snapshots,
      [playerMsgId]: { ...snap, key: true, label: label ?? snap.label ?? '' },
    };
    saveJson('trpg.snapshots', next);
    set({ snapshots: next });
  },

  setSnapshotPendingChecks(playerMsgId, list) {
    const snap = get().snapshots[playerMsgId];
    if (!snap) return;
    const next = { ...get().snapshots, [playerMsgId]: { ...snap, pendingChecks: list } };
    saveJson('trpg.snapshots', next);
    set({ snapshots: next });
  },

  forceEnding(kind, reason) {
    const gs: GameState = {
      ...get().gameState,
      dying: false,
      ending: {
        kind,
        text: '',
        at: new Date().toISOString(),
        ...(reason?.trim() ? { reason: reason.trim() } : {}),
      },
    };
    // 结档是结构性操作：必须**立刻**落盘（节流窗口内重开会把结局丢掉 —— `G26` 就是这么丢的）
    saveJsonNow('trpg.gameState', gs);
    set({ gameState: gs });
  },

  setEnding(kind, text) {
    const s = get();
    const ending: Ending = {
      kind,
      text: text.trim(),
      at: new Date().toISOString(),
      // 声明收束时的理由要留着——结档页要回答"为什么故事到这里就结束了"
      ...(s.gameState.ending?.reason ? { reason: s.gameState.ending.reason } : {}),
    };
    const gameState: GameState = { ...s.gameState, ending };
    // 结局正文也是结档的一部分，同样立刻落盘（`G26`）
    saveJsonNow('trpg.gameState', gameState);
    set({ gameState });
  },

  clearEnding() {
    const s = get();
    if (!s.gameState.ending) return;
    const gameState: GameState = { ...s.gameState, ending: null, dying: false };
    // 清结档也是结构性操作（回溯要立刻作数，别被待写的旧值盖回来）
    saveJsonNow('trpg.gameState', gameState);
    // 濒死解除了，那条一次性引导也就没了意义
    set({ gameState, dyingNote: null });
  },

  rewindBefore(msgId) {
    const s = get();
    const idx = s.messages.findIndex((m) => m.id === msgId);
    if (idx < 0) return;
    const snap = s.snapshots[msgId];
    const kept = s.messages.slice(0, idx);
    const keptIds = new Set(kept.map((m) => m.id));
    const snapshots = Object.fromEntries(
      Object.entries(s.snapshots).filter(([k]) => keptIds.has(k))
    );
    // 没有快照（例如导入的旧存档）时保留当前状态，只做消息截断
    const gameState = snap?.gameState ?? s.gameState;
    const chronicle = snap?.chronicle ?? s.chronicle;
    const summary = snap?.summary ?? s.summary;
    // 回溯是结构性操作：立刻落盘（待写的旧消息不能晚一步盖回来）
    saveJsonNow('trpg.messages', kept);
    saveJsonNow('trpg.gameState', gameState);
    saveJsonNow('trpg.chronicle', chronicle);
    saveJsonNow('trpg.summary', summary);
    saveJsonNow('trpg.snapshots', snapshots);
    /*
     * 待掷队列要按快照恢复，不能一律清空。
     * 否则"GM 一次要求 2 个检定 → 掷掉 1 个 → 想退回去重来"时，另一个检定就永远找不回来了。
     */
    set({
      messages: kept,
      gameState,
      chronicle,
      summary,
      snapshots,
      pendingChecks: snap?.pendingChecks ?? [],
      lastChanges: null,
      // 回溯后濒死状态由快照决定，一次性引导跟着快照走（旧状态没在濒死就别再说）
      dyingNote: gameState.dying ? DYING_NOTE : null,
    });
  },

  setConfig(patch) {
    const next = { ...get().config, ...patch };
    writeLocal('trpg.config', JSON.stringify(next));
    set({ config: next });
  },

  setRuleset(id) {
    const rs = getRuleset(id);
    writeLocal('trpg.rulesetId', id);
    const character = get().character;
    // 换规则包 = 换一套属性与技能。旧值对不上新规则，直接按新规则重置，
    // 否则会带着 COC 的百分比技能跑 DnD。
    // 技能只给"起始几项"，绝不把整张技能表倒进去（那会让角色卡塞满几十项没练过的技能）。
    const characteristics = Object.fromEntries(
      rs.characteristicDefs.map((d) => [d.key, d.default])
    );
    const skills = Object.fromEntries(
      (rs.starterSkills ?? []).map((s) => [s.name, s.value])
    );
    const nextChar = { ...character, characteristics, skills };
    // 数值条也要跟着换：新规则的键可能旧存档里没有（缺键会显示成 0）。
    // 按新规则的属性派生值重建，彻底避免"MP/SAN = 0"。
    const vitals = rs.deriveVitals(characteristics);
    for (const def of rs.vitalDefs) {
      if (!Number.isFinite(vitals[def.key])) vitals[def.key] = def.default;
    }
    const gameState: GameState = {
      ...get().gameState,
      vitals,
      vitalsMax: deriveVitalsMax(nextChar, id),
    };
    writeLocal('trpg.character', JSON.stringify(nextChar));
    saveJson('trpg.gameState', gameState);
    set({ rulesetId: id, character: nextChar, gameState });
  },

  setGenre(id) {
    writeLocal('trpg.genreId', id);
    set({ genreId: id });
    // 兜底开场白是按题材给的：换题材时同步一次，否则会拿旧题材的场景开场
    const opening = openingText(get().character, get().module, id);
    const messages = get().messages.map((m) =>
      m.id === WELCOME_ID ? { ...m, content: opening } : m
    );
    if (messages.some((m, i) => m.content !== get().messages[i]!.content)) {
      saveJson('trpg.messages', messages);
      set({ messages });
    }
  },

  saveCustomGenre(g) {
    const next = [...get().customGenres.filter((x) => x.id !== g.id), g];
    saveJson('trpg.customGenres', next);
    set({ customGenres: next });
  },

  removeCustomGenre(id) {
    const next = get().customGenres.filter((x) => x.id !== id);
    saveJson('trpg.customGenres', next);
    set({ customGenres: next, genreId: get().genreId === id ? 'coc' : get().genreId });
  },

  setCharacter(patch) {
    const next = { ...get().character, ...patch };
    // 改名或改性别就重置称呼（除非本次同时指定了称呼），否则旧称呼会粘着不走
    if ((patch.name !== undefined || patch.gender !== undefined) && patch.address === undefined) {
      next.address = undefined;
    }
    // 属性夹到规则包允许的范围（COC 1-99），防止手改到离谱数值
    if (patch.characteristics) {
      const rs = getRuleset(get().rulesetId);
      const clamped = { ...next.characteristics };
      for (const def of rs.characteristicDefs) {
        const v = clamped[def.key];
        if (v == null) continue;
        // 非有限数（空输入 / 手输 1e999）一律回落到默认值：
        // 否则会存进一个看不见的 NaN，派生出来的血/蓝/理智全变成 NaN。
        clamped[def.key] = Number.isFinite(v)
          ? Math.max(def.min, Math.min(def.max, Math.round(v)))
          : def.default;
      }
      next.characteristics = clamped;
    }
    // 技能值夹到规则包允许的范围：COC 0-99（百分比），DnD -5~+15（加值）
    if (patch.skills) {
      const isPercent = getRuleset(get().rulesetId).mainDice === '1d100';
      const [lo, hi] = isPercent ? [0, 99] : [-5, 15];
      const clamped: Record<string, number> = {};
      for (const [k, v] of Object.entries(next.skills)) {
        clamped[k] = Math.max(lo, Math.min(hi, Math.round(Number(v) || 0)));
      }
      next.skills = clamped;
    }
    writeLocal('trpg.character', JSON.stringify(next));
    set({ character: next });
    // 姓名/性别/称呼变化会影响开场白里的喊法，同步一次
    if (patch.name !== undefined || patch.gender !== undefined || patch.address !== undefined) {
      const opening = openingText(next, get().module, get().genreId);
      const messages = get().messages.map((m) =>
        m.id === WELCOME_ID ? { ...m, content: opening } : m
      );
      saveJson('trpg.messages', messages);
      set({ messages });
    }
  },

  /**
   * 改模组里的字段。
   *
   * ⚠️ **它不是"换模组"** —— 它只动你给的那几个键，
   * 既不撤上一个模组的世界书、也不装新模组自带的那份。
   * 真要换一个模组（内置模组按钮 / 测试沙盒 / AI 生成 / 贴文本导入 / 应用预设）
   * 一律走 `applyModule()`，否则会出现"换了模组世界观还是上一个的"。
   *
   * 这里保留 `setModule` 是给"编辑当前模组的某个字段"用的（准备页那一堆输入框）。
   */
  setModule(patch) {
    const next = sanitizeModuleTokens({ ...get().module, ...patch }, get().character);
    saveJson('trpg.module', next);
    set({ module: next });
    /*
     * 开场白属于模组（第一幕），改了要同步首条消息。
     *
     * 原来只判断 `patch.opening !== undefined`，于是**任何"不带 opening 的换模组"
     * 都会把上一条开场白留在屏幕上**——测试沙盒的「切到某个脚本化模组」按钮就是这样，
     * 玩家看到的还是上一个模组的前言（用户 2026-09-16 实测："换模组后文案没清"）。
     * 而 `openingText()` 里其实还拼了 goal / stakes / urgency 三行，它们变了同样得同步。
     *
     * 09-17 再补三条：**没写 opening 的模组**，开场白是用它自己的
     * `premise` / `startLocation` / `locations` 拼出来的（见 `moduleOpening`），
     * 所以这三样变了也得重算——否则又是一次"文案没清"。
     */
    const affectsOpening =
      patch.opening !== undefined ||
      patch.goal !== undefined ||
      patch.stakes !== undefined ||
      patch.urgency !== undefined ||
      patch.premise !== undefined ||
      patch.startLocation !== undefined ||
      patch.locations !== undefined;
    if (affectsOpening) {
      const opening = openingText(get().character, next, get().genreId);
      const current = get().messages;
      const messages = current.map((m) => (m.id === WELCOME_ID ? { ...m, content: opening } : m));
      // 内容没变就不写盘（换模组时反复点同一个按钮不该产生无谓的序列化）
      if (messages.some((m, i) => m.content !== current[i]!.content)) {
        saveJson('trpg.messages', messages);
        set({ messages });
      }
    }
  },

  setStreaming: (v) => set({ streaming: v }),
  setPanel: (p) => set({ panel: p }),

  setDeadlineDays(days) {
    /*
     * P2-5（协作方第 20 版）：期限是**引擎的**，不是模型的。
     *
     * 病灶：以前这里无条件接受契约里的 `deadline_days` —— 于是模型每轮随口报一个
     * 「还剩 21 天」，玩家就永远卡在 21 天（时钟走了、期限不走，实测 4 轮 09:00→09:03
     * 而期限一步没动）。同时 label 取不到就写 `?? ''`，一空永空，界面只能显示
     * 「期限：这件事 · 还剩 21 天」（连这是什么期限都说不出来）。
     *
     * 现在分两条：
     *   ① **已经有一个期限对象在**（不论剩多少、**哪怕已归零**）→ 申报**整条忽略**。
     *      推进、到点、结束只由 `applyModelDeltas` 的时钟结算按 `elapsed` 负责。
     *      为什么连 `remain === 0` 也挡：到点了意味着该走模组的「结局与失败条件」，
     *      这时模型一句「还剩 21 天」就能把倒计时续回来 —— 那正是这条要防的事。
     *   ② **还没有期限**（开局模组推不出来）→ 才把申报当前值用，给短篇一个下限。
     *
     * 玩家真需要新期限 / 想清掉期限时，走引擎侧的 `setDeadline`，不归模型管。
     */
    const cur = get().gameState.deadline;
    if (cur) return; // 已经有期限：时钟说了算，模型一个字都改不动

    const d =
      Number.isFinite(days as number) && (days as number) > 0
        ? {
            remain: Math.round((days as number) * 60 * 24),
            /*
             * label 回落：模组 `urgency` 首句（与 `deadlineOf` 共用 `modDeadlineLabel`，
             * 判据只有一份）→ 都没有时写「期限」。
             * 以前这里是 `?? ''`，一空永空 → 界面显示「期限：这件事 · 还剩 21 天」。
             */
            label: modDeadlineLabel(get().module),
          }
        : null;
    const next = { ...get().gameState, deadline: d };
    // 期限是结构性的（影响倒计时与结局判断），立刻落盘
    saveJsonNow('trpg.gameState', next);
    set({ gameState: next });
  },

  setDeadline(d) {
    const next = { ...get().gameState, deadline: d };
    saveJsonNow('trpg.gameState', next);
    set({ gameState: next });
  },

  upsertWorldbookEntry(e) {
    const list = get().worldbook;
    const idx = list.findIndex((x) => x.id === e.id);
    const next = idx >= 0 ? list.map((x) => (x.id === e.id ? e : x)) : [...list, e];
    writeLocal('trpg.worldbook', JSON.stringify(next));
    set({ worldbook: next });
  },

  removeWorldbookEntry(id) {
    const next = get().worldbook.filter((x) => x.id !== id);
    writeLocal('trpg.worldbook', JSON.stringify(next));
    set({ worldbook: next });
  },

  setWorldbookEntries(list) {
    writeLocal('trpg.worldbook', JSON.stringify(list));
    set({ worldbook: list });
  },

  /**
   * 清掉"属于某个模组"的世界书条目。
   *
   * 这是 N6 的手动入口：世界书在跨档读档时取并集，不同模组的条目会累积，
   * 需要一个手动清理的口子。**只留玩家自己手写的**（判据在 `core/worldbook.ts`）。
   *
   * ⚠️ 这里以前只滤 `fromModule`，**漏了 `mw-`（模组自带）** —— 于是手动清理清不干净
   * （协作方第 14 版 §2 抓到的漏网）。判据必须只有一份，别再手写过滤条件。
   */
  clearModuleWorldbook() {
    const kept = stripModuleWorldbook(get().worldbook);
    writeLocal('trpg.worldbook', JSON.stringify(kept));
    set({ worldbook: kept });
  },

  /**
   * **换模组**时调用：清掉属于"上一个模组"的派生数据（世界书 fromModule 条目 + 队友候选）。
   *
   * 触发点只有这一个（AI 生成模组 / 贴文本导入 / 应用整套预设），
   * 开新团与读档都**不**清——它们不换模组（协作方 N2）。
   */
  setDevMode(on) {
    writeLocal('trpg.devMode', on ? '1' : '0');
    set({ devMode: on });
  },

  setModuleItems(list) {
    const s = get();
    const module: Module = { ...s.module, items: list };
    saveJson('trpg.module', module);
    set({ module });
  },

  devMode: readLocal('trpg.devMode') === '1',

  clearModuleDerived() {
    // 同上：判据用 `core/worldbook.ts` 那一份（这里以前漏了 `mw-`）
    const kept = stripModuleWorldbook(get().worldbook);
    writeLocal('trpg.worldbook', JSON.stringify(kept));
    saveJson('trpg.companionCandidates', []);
    set({ worldbook: kept, companionCandidates: [] });
  },

  /*
   * ── 换模组（applyModule）──────────────────────────────────────
   *
   * **换模组是一个动作，不是一次赋值。**
   *
   * 以前"套用模组"散在四个地方，每个都自己拼一坨 `setModule({...})`：
   * 内置模组按钮、测试沙盒、AI 生成、贴文本导入。
   * 结果它们**各漏各的**：内置模组按钮忘了清上一个模组的派生数据，
   * 脚本化模组忘了清、也忘了装世界书 —— 于是主人 2026-09-17 实测到：
   * "预设模组的世界书没显示""换模组了世界观还是上一个的"。
   *
   * 现在收成一个入口：**改模组 + 撤旧世界书 + 装新世界书**，一次做完。
   * 谁要换模组都走这里，别再各写各的。
   */
  applyModule(patch, opts) {
    const s = get();
    /*
     * 世界书**不继承上一个模组的**。
     *
     * 主人 2026-09-20 试玩撞到的：AI 一键生成了一个新模组，上一个模组的地点
     * 还留在世界书里。根因就是这里 —— `patch` 里没有 `worldbook` 时，
     * `{...s.module, ...patch}` 把**旧模组的世界书留了下来**，紧接着下面 ② 又给它
     * 打上 `mw-` 装回去，等于"换模组却带着上一个世界的地图"。
     *
     * 换模组＝换一个世界：世界书以 `patch` 为准，没给就是没有。
     * 唯一的例外是 `keepDerived`（同一模组内补派生数据），那时才保留。
     * （"开新团不清世界书"那条铁律说的是**重开同一局**，走的是别的路径，不受这里影响。）
     */
    const merged = sanitizeModuleTokens(
      { ...s.module, ...patch, worldbook: patch.worldbook ?? (opts?.keepDerived ? s.module.worldbook : []) },
      s.character
    );

    /*
     * ① 撤掉**上一个模组**的世界书条目。
     *
     * 判据只有一份：`core/worldbook.ts` 的 `stripModuleWorldbook()`。
     * （以前这里和 `Preparation` 各写一份、口径还不一样 —— 撤了又被加回来，永远清不掉。）
     * 撤的是：模组派生的（`fromModule`）、模组自带的（`mw-`）、开局示例（`sample-`）；
     * **留下来的只有玩家自己手加的**（协作方第 14 版指出上面那句"留内置示例"的注释已过时）。
     */
    const baseWorldbook = opts?.keepDerived ? s.worldbook : stripModuleWorldbook(s.worldbook);

    /*
     * ② 装上**新模组自带**的世界书。
     *
     * id 前缀 `mw-`（module worldbook）：这是"模组自带的"标记，
     * 下次换模组时靠它认领撤掉；`fromModule` 留给 AI 单独生成的那一批
     * （它们由 `clearModuleDerived()` 管），两者分开才好各撤各的。
     */
    const own: WorldbookEntry[] = (merged.worldbook ?? [])
      .filter((e) => e.content?.trim())
      .map((e, i) => ({
        ...e,
        id: e.id?.startsWith('mw-') ? e.id : `mw-${i}-${e.keys?.[0] ?? 'entry'}`,
        keys: e.keys?.length ? e.keys : [e.content.slice(0, 6)],
        priority: e.priority ?? 50,
        enabled: e.enabled ?? true,
      }));
    const worldbook = [...baseWorldbook, ...own];

    writeLocal('trpg.worldbook', JSON.stringify(worldbook));
    saveJson('trpg.module', merged);
    set({ module: merged, worldbook });

    /*
     * ③ 队友候选：和 `clearModuleDerived()` 同一条件 —— 换了模组就清。
     * （队友候选全是"上一个模组推荐的人"，留着会冒出不相干的人。）
     */
    if (!opts?.keepDerived) {
      saveJson('trpg.companionCandidates', []);
      set({ companionCandidates: [] });
    }

    /*
     * ④ 开场白同步。
     *
     * 这里比 `setModule` 多认三样：`premise` / `startLocation` / `locations`。
     * 为什么必须认出它们：模组没写 `opening` 时，开场白是**用它自己的**
     * 前提与起始地点拼出来的（`moduleOpening`）——
     * 只盯着 `opening` 字段的话，"换了个没写开场白的模组"就会把上一家的开场白留在屏幕上。
     */
    const affectsOpening =
      opts?.affectsOpening ??
      (patch.opening !== undefined ||
        patch.goal !== undefined ||
        patch.stakes !== undefined ||
        patch.urgency !== undefined ||
        patch.premise !== undefined ||
        patch.startLocation !== undefined ||
        patch.locations !== undefined ||
        patch.title !== undefined);
    if (affectsOpening) {
      const opening = openingText(s.character, merged, s.genreId);
      const current = get().messages;
      const messages = current.map((m) => (m.id === WELCOME_ID ? { ...m, content: opening } : m));
      if (messages.some((m, i) => m.content !== current[i]!.content)) {
        saveJson('trpg.messages', messages);
        set({ messages });
      }
    }
  },

  upsertCompanion(c) {
    const next = normalizeCompanion(c, get().rulesetId);
    const list = get().gameState.companions;
    const idx = list.findIndex((x) => x.id === next.id);
    const companions =
      idx >= 0 ? list.map((x) => (x.id === next.id ? next : x)) : [...list, next];
    set((s) => {
      const gs = { ...s.gameState, companions };
      saveJson('trpg.gameState', gs);
      return { gameState: gs };
    });
  },

  removeCompanion(id) {
    set((s) => {
      const next = {
        ...s.gameState,
        companions: s.gameState.companions.filter((x) => x.id !== id),
      };
      saveJson('trpg.gameState', next);
      return { gameState: next };
    });
  },

  setCompanionCandidates(list) {
    saveJson('trpg.companionCandidates', list);
    set({ companionCandidates: list });
  },

  recruitCompanion(id) {
    const c = get().companionCandidates.find((x) => x.id === id);
    if (!c) return;
    // 未见过面的角色不能入队（避免"凭空拉人"）
    if (c.met === false) return;
    get().upsertCompanion({ ...c, met: true });
    const rest = get().companionCandidates.filter((x) => x.id !== id);
    saveJson('trpg.companionCandidates', rest);
    set({ companionCandidates: rest });
  },

  markCandidatesMet(text) {
    const list = get().companionCandidates;
    if (list.length === 0 || !text.trim()) return;
    let changed = false;
    const next = list.map((c) => {
      if (c.met) return c;
      // 剧情里出现了这个角色的名字（去掉姓氏分隔符后逐段匹配）也要认
      const parts = c.name.split(/[·・.\s]+/).filter(Boolean);
      const hit = parts.some((p) => p.length >= 2 && text.includes(p));
      if (hit) {
        changed = true;
        return { ...c, met: true };
      }
      return c;
    });
    if (!changed) return;
    saveJson('trpg.companionCandidates', next);
    set({ companionCandidates: next });
  },

  dismissCompanionCandidate(id) {
    const rest = get().companionCandidates.filter((x) => x.id !== id);
    saveJson('trpg.companionCandidates', rest);
    set({ companionCandidates: rest });
  },

  setSceneImage(location, url) {
    const next = { ...get().sceneImages };
    if (url) next[location] = url;
    else delete next[location];
    set({ sceneImages: next });
    // 存不下就当场说（静默失败会让玩家以为图妥了，实际刷新就没）
    return putImageBlob('sceneImages', next).then((ok) => {
      if (!ok && url) set({ uiNotice: IMAGE_STORE_FAILED });
      return ok;
    });
  },

  setMessageSceneImage(msgId, url) {
    const next = { ...get().messageImages };
    if (url) next[msgId] = url;
    else delete next[msgId];
    set({ messageImages: next });
    // 老数据可能把图直接塞在消息里，顺手清掉，避免消息数组被 base64 撑爆
    const messages = get().messages.map((m) =>
      m.id === msgId && m.sceneImage ? { ...m, sceneImage: undefined } : m
    );
    if (messages.some((m) => m.id === msgId && !m.sceneImage)) {
      saveJson('trpg.messages', messages);
      set({ messages });
    }
    return putImageBlob('messageImages', next).then((ok) => {
      if (!ok && url) set({ uiNotice: IMAGE_STORE_FAILED });
      return ok;
    });
  },

  setMapImage(url) {
    set({ mapImage: url });
    return putImageBlob('mapImage', url).then((ok) => {
      if (!ok && url) set({ uiNotice: IMAGE_STORE_FAILED });
      return ok;
    });
  },

  queueImage({ kind, target, prompt, label }) {
    const s = get();
    /*
     * 没配 Key / 没填生图模型 → **不排空任务**，返回 null 让调用方说人话。
     * 排一条注定失败的任务只会让角标上多一个红点，玩家还得自己去猜为什么。
     */
    if (!s.config.apiKey) return null;
    if (!s.config.imageModel?.trim()) return null;

    const job: ImageJob = {
      id: uid(),
      kind,
      target,
      // 提示词在**排队那一刻**就定下来：之后改配置、改模组都不该影响已排的队
      prompt,
      label,
      status: 'queued',
      at: Date.now(),
    };
    const next = enqueueJob(s.imageJobs, job);
    /*
     * 已经有一条同位置的活跃任务 → `enqueueJob` 会原样返回列表。
     * 这时要把它**找出来返回**（调用方据此显示"排队中"），而不是返回新造的那条。
     */
    const picked = next.find((j) => jobKey(j) === jobKey(job));
    set({ imageJobs: next });
    persistImageJobs(next);
    void get().pumpImageJobs();
    return picked ?? job;
  },

  retryImageJob(id) {
    const next = get().imageJobs.map((j) =>
      j.id === id ? { ...j, status: 'queued' as const, error: undefined } : j
    );
    set({ imageJobs: next });
    persistImageJobs(next);
    void get().pumpImageJobs();
  },

  dismissImageJob(id) {
    const next = dropJob(get().imageJobs, id);
    set({ imageJobs: next });
    persistImageJobs(next);
  },

  cancelImageJob(id) {
    /*
     * `H26`：先把请求掐掉，再出队。
     *
     * 顺序有讲究：`abort()` 会让 `runImageJob` 里那个 race 抛出来走 `catch`，
     * 而那时这条**已经不在队列里**了 —— `failJob` 是按 id `map` 的，找不到就原样返回，
     * 所以不会把出队的任务又"标红复活"。
     * 出队之后立刻 `pumpImageJobs()`：槽位当场让出来，后面排着的那张立刻开画
     * （与超时那条路同一个口径 —— 玩家看到的是"我刚停掉，下一张就动起来了"）。
     */
    imageAborts.get(id)?.abort();
    imageAborts.delete(id);
    const next = dropJob(get().imageJobs, id);
    set({ imageJobs: next });
    persistImageJobs(next);
    void get().pumpImageJobs();
  },

  async pumpImageJobs() {
    // 重入保护：并发那一轮自己会再叫一次，不能让两个 pump 同时抢同一条任务
    if (pumping) return;
    pumping = true;
    try {
      /*
       * 🔴 推之前先把"卡住的任务"收回来（主人 2026-09-27 真机）。
       *
       * 单条任务有自己的硬超时，但定时器可能被浏览器节流（后台标签页），
       * 也可能那条 promise 压根漏在 race 之外 —— 那种永远挂在 `running` 的任务
       * 会**永久占着并发槽**，队列后面排着的图一张也轮不上。
       * 收成失败（看得见、能重试）之后，下面的循环立刻就能把位置让给下一条。
       */
      const reclaimed = reclaimStalled(get().imageJobs);
      if (reclaimed) {
        set({ imageJobs: reclaimed });
        persistImageJobs(reclaimed);
      }
      // 一次把还能开的都开出去（上限 IMAGE_CONCURRENCY）；跑完一条会自动续
      for (;;) {
        const s = get();
        if (!hasRoom(s.imageJobs, IMAGE_CONCURRENCY)) break;
        const job = nextQueued(s.imageJobs);
        if (!job) break;
        set({ imageJobs: beginJob(s.imageJobs, job.id) });
        // **不 await**：图上头这一秒不该挡着后面的任务出队
        void get().runImageJob(job);
      }
    } finally {
      pumping = false;
    }
  },

  async runImageJob(job) {
    const s = get();
    /*
     * 任务排着的时候消息可能已经被清掉 / 回溯掉了。
     * 那种情况下这张图已经没有地方可落 —— 悄悄出队，别浪费一次调用。
     */
    if (job.kind === 'action' && !s.messages.some((m) => m.id === job.target)) {
      const next = dropJob(get().imageJobs, job.id);
      set({ imageJobs: next });
      persistImageJobs(next);
      return;
    }

    /*
     * 🔴 每一张图自己带一道硬闸（主人 2026-09-27 真机那条的根因）。
     *
     * `fetch` 本身不知道"该等多久"：服务端连上了不回话的时候，请求会**无限挂着**，
     * 这条任务就永远停在 `running` —— 占着并发槽，后面排队的图一张也开不了工，
     * 玩家看到的是"还排队呢"，一等就是一整夜。
     * 所以：到点就 abort 掉那个请求，并把这条任务交给下面那个 `catch` 当失败处理
     * （失败是**看得见且能重试**的，悬挂则什么都不是）。
     */
    const controller = new AbortController();
    // `H26`：把句柄挂上 —— 角标上那颗「不画了」就是通过它把在飞的请求掐掉的
    imageAborts.set(job.id, controller);
    let timer: ReturnType<typeof setTimeout> | undefined;
    const guard = new Promise<never>((_, reject) => {
      timer = setTimeout(() => {
        controller.abort();
        reject(new ModelError(IMAGE_TIMEOUT_NOTE));
      }, IMAGE_TIMEOUT_MS);
    });

    const work = async (): Promise<void> => {
      const raw = await generateImage(job.prompt, {
        ...s.config,
        model: s.config.imageModel!.trim(),
        /*
         * 🔴 切图规格（阶段 0-2）：**按图类型取尺寸**，不再四类共用一张方图。
         *
         * 以前一律 `config.imageSize || '1024x1024'` → 立绘被裁成半身、
         * 场景没有广角。现在：
         * - 玩家**手动填过** `imageSize` → 尊重他的选择（旧配置照跑，不搞突然袭击）；
         * - 没填（绝大多数人）→ 按 `kind` 自动取（立绘 3:4 / 场景 16:9 / 地图·插画 1:1）。
         *
         * 规格真源在 `core/artSpec.ts`，`Settings` 的提示文案也读它，三处不会再说岔。
         */
        size: s.config.imageSize?.trim() || defaultImageSizeFor(job.kind),
        // 超时就把这个请求掐掉，不让它在后台继续挂着占连接
        signal: controller.signal,
      });
      if (!raw) throw new ModelError('生图接口没有返回图片，换一个生图模型试试');
      /*
       * 落盘前**归一化**（P2-3）：手里得是真图（data URI），不能是个链接。
       *
       * 服务商只给 url 时先抓一次（同源 / 允许 CORS 就能成）。
       * 抓不回来**不是失败** —— 这张图现在确实看得到，只是过一阵会失效，
       * 所以照常落盘，但把它标记成链接并在界面上说清楚。骗玩家说"已内嵌"才是错的。
       */
      const local = await normalizeImage(raw);
      const landed = await get().applyImageResult(job, local.value);
      /*
       * 🔴 P1-2：闸门拒落时**必须留在队列里**。
       *
       * 以前这里照常 `dropJob`（因为 `applyImageResult` 是 `Promise<void>`，
       * 拒落和成功看起来一模一样）→ 玩家只看见"转了 40 秒然后没了"。
       * 现在拒落走 `failJob`：任务留在队列上标红，玩家能看见、能重试。
       */
      if (!landed) {
        const next = failJob(
          get().imageJobs,
          job.id,
          '这张图没能保存下来（接口返回的不是图片数据）。可以重试一次，或去「设置」换个生图模型。'
        );
        set({ imageJobs: next });
        persistImageJobs(next);
        return;
      }
      if (local.kind === 'remote') {
        set({
          uiNotice: '这张图只有服务商的临时链接（过一阵可能失效）；要长期保存就重新生成一次。',
        });
      }
      // 成功即出队：图已经落在它该在的地方，那才是玩家要看的反馈
      const next = dropJob(get().imageJobs, job.id);
      set({ imageJobs: next });
      persistImageJobs(next);
    };

    try {
      await Promise.race([work(), guard]);
    } catch (e) {
      const msg = e instanceof ModelError ? e.message : `生图失败：${(e as Error).message}`;
      // 失败**留在队列里**：这是最需要被看见的状态，还得能重试
      const next = failJob(get().imageJobs, job.id, msg);
      set({ imageJobs: next });
      persistImageJobs(next);
    } finally {
      // 这条已经落地了（不管成功还是失败），硬闸可以拆了
      if (timer) clearTimeout(timer);
      imageAborts.delete(job.id);
      /*
       * 空出一个位置就接着推（无论成功失败）。
       *
       * 🔴 主人那条「第三张排队的画始终没开工」正是靠这一行解：
       * 前面那条超时/失败之后，槽位在这一刻让出来，后面排着的立刻开画，
       * 不用等到下一次交互。
       */
      void get().pumpImageJobs();
    }
  },

  applyImageResult(job, url) {
    /*
     * 保一道闸，但**只拦"根本不像图"的东西**。
     *
     * 为什么不能"不是自包含就拒"：抓不回来的 http 链接是**正当的降级态** ——
     * 图现在确实看得见，只是过一阵会失效，导出侧会如实说明。
     * 拦掉它等于让生图整个失败，那是把小问题变成大问题。
     * 真正该拦的是相对路径、非图片串这类脏数据（它们连今天都显示不出来）。
     */
    if (!isStoreableImage(url)) {
      /*
       * 🔴 P1-2：拒落**不许静默**。
       *
       * 以前这里 `console.warn` 然后 `Promise.resolve()`，而调用方紧接着照常 `dropJob` ——
       * 玩家视角就是"点了生成、转了 40 秒、然后什么都没发生"，零提示、零重试。
       * 正踩「状态变化必须可见」：一次失败比一次成功更需要被看见。
       *
       * 现在返回 `false`，由 `runImageJob` 把它交给 `failJob`（留队 + 可重试 + 说人话）。
       */
      console.warn('[跑团] 拒绝落一份不像图的数据（生图接口返回了非图片串）', job.kind);
      set({
        uiNotice:
          '这张图没能保存下来 —— 接口返回的不是图片数据。可以重试一次，或去「设置」换个生图模型。',
      });
      return Promise.resolve(false);
    }
    const done: Promise<unknown>[] = [];
    switch (job.kind) {
      case 'action':
        done.push(get().setMessageSceneImage(job.target, url));
        break;
      case 'scene':
        done.push(get().setSceneImage(job.target, url));
        break;
      case 'map':
        done.push(get().setMapImage(url));
        break;
      case 'monster':
        /*
         * 怪物形象（1-F）：落在 `gameState.foeArt[名字]`。
         *
         * 走 `saveJsonNow` 而不是节流落盘 —— 与上面队友那条同一个理由：
         * 生成一张图要等几十秒，中间玩家很可能就关页面了，节流窗口里丢掉的
         * 是**他刚刚花掉的一次调用**。结构性写入必须立刻落盘。
         */
        get().setFoeArt(job.target, url);
        break;
      case 'avatar':
        /*
         * 关键人物头像（阶段 2 · 计划 2-3）：`target = 'npc:<名字>'`。
         *
         * 为什么单开一个 case 而不是并进 `portrait` 的 `npc:` 分支：
         * 两者**取规格与提示词都不同**（768×768 方版头像 vs 768×1024 竖版立绘），
         * 而落点这一步与它**逐字相同** —— 所以这里只做这一件事，
         * 提示词的分叉留在 `generate.ts` 那侧（`npcAvatarPrompt`）。
         */
        get().setFoeArt(job.target.replace(/^npc:/, ''), url);
        break;
      case 'portrait':
        /*
         * 立绘有两个人：玩家自己（target = 'character'）与队友（target = 队友 id）。
         * 队友那条**两个名单都要打**：他可能还在候选里，也可能已经入队了 ——
         * 只打一个的话，玩家切到另一个列表会看到"没生成"。
         */
        if (job.target === 'character') {
          get().setCharacter({ portrait: url });
          // 立绘原本只在 localStorage 里，一张 base64 立绘能有几百 KB ——
          // 塞进 localStorage 会直接顶到配额，表现成"立绘莫名其妙没了"。
          // 与场景 / 消息图同一条口径：**大件走 IndexedDB**。
          done.push(putImageBlob('characterPortrait', url));
        } else if (job.target.startsWith('npc:')) {
          /*
           * 关键剧情人物（1-F）：`target = 'npc:<名字>'`。
           *
           * 为什么复用 `portrait` 而不是新开 kind：这类图与立绘**尺寸、构图、画法全同**
           * （768×1024 竖版半身，`characterImagePrompt` 直接吃），差别只在落点。
           * 新开一类会让尺寸表、提示词、`kindLabel` 三处都要分叉 —— 加东西不加分支。
           *
           * 落点仍在 `gameState.foeArt`：那是个"名字 → 图"的通用映射，
           * 人物与怪物共用一份，图鉴/档案卡都从它取图。
           */
          get().setFoeArt(job.target.slice(4), url);
        } else {
          // 队友在**两个名单**里都可能：已入队的在 gameState.companions，还没入队的在候选里
          const gs = get().gameState;
          if (gs.companions.some((c) => c.id === job.target)) {
            const next: GameState = {
              ...gs,
              companions: gs.companions.map((c) =>
                c.id === job.target ? { ...c, portrait: url } : c
              ),
            };
            saveJsonNow('trpg.gameState', next);
            set({ gameState: next });
          }
          const cands = get().companionCandidates;
          if (cands.some((c) => c.id === job.target)) {
            get().setCompanionCandidates(
              cands.map((c) => (c.id === job.target ? { ...c, portrait: url } : c))
            );
          }
        }
        break;
    }
    return Promise.all(done).then(() => true);
  },

  setFoeArt(name, url) {
    const key = String(name ?? '').trim();
    if (!key) return;
    const gs = get().gameState;
    /*
     * 传空串＝**删掉这一条**，不是写一个空值进去。
     * `autoArtCount` 与 `artCandidates` 都按"有值才算画过"判，
     * 留一个 `''` 会让"已经画过"和"没画过"两种判断都错。
     */
    const cur = { ...(gs.foeArt ?? {}) };
    if (url) cur[key] = url;
    else delete cur[key];
    const next: GameState = { ...gs, foeArt: cur };
    // 结构性写入（图是玩家的资产）必须立刻落盘，不等节流窗口
    saveJsonNow('trpg.gameState', next);
    set({ gameState: next });
  },

  async hydrateImages() {
    const [sceneImages, messageImages, mapImage, portrait] = await Promise.all([
      idbGet<Record<string, string>>('sceneImages'),
      idbGet<Record<string, string>>('messageImages'),
      idbGet<string>('mapImage'),
      idbGet<string>('characterPortrait'),
    ]);
    const patch: Partial<Store> = {
      sceneImages: sceneImages ?? {},
      messageImages: messageImages ?? {},
      mapImage: mapImage ?? '',
    };
    /*
     * 立绘（P2-3）：新数据存 IndexedDB，老数据还在 localStorage 的角色卡里。
     * 两处都认 —— IndexedDB 优先；那里没有而内存里有，说明是老档，顺手搬过去。
     *
     * 搬迁**不回写 localStorage**（角色卡照旧保留，读档逻辑不用动），
     * 只是让下次刷新能从 IndexedDB 拿回来：一张 base64 立绘几百 KB，
     * 长期压在 localStorage 那 5MB 里迟早把别的东西挤掉。
     */
    const memPortrait = get().character.portrait;
    if (portrait) {
      patch.character = { ...get().character, portrait };
    } else if (memPortrait) {
      void putImageBlob('characterPortrait', memPortrait);
      if (!isSelfContainedImage(memPortrait)) {
        patch.uiNotice = '这张立绘来自临时链接，过一阵可能失效；要长期保存就重新生成一次。';
      }
    }
    // 一次性迁移：老存档把小图直接存在消息里，搬到 IndexedDB 并瘦身消息
    const msgs = get().messages;
    const migrated: Record<string, string> = { ...(messageImages ?? {}) };
    let changed = false;
    const nextMsgs = msgs.map((m) => {
      if (m.sceneImage && !migrated[m.id]) {
        migrated[m.id] = m.sceneImage;
        changed = true;
        return { ...m, sceneImage: undefined };
      }
      return m;
    });
    if (changed) {
      saveJson('trpg.messages', nextMsgs);
      void idbSet('messageImages', migrated);
      patch.messages = nextMsgs;
      patch.messageImages = migrated;
    }
    set(patch);
  },

  setPendingChecks(list) {
    set({ pendingChecks: list });
  },

  removePendingCheck(index) {
    set((s) => ({ pendingChecks: s.pendingChecks.filter((_, i) => i !== index) }));
  },

  clearPendingChecks() {
    set({ pendingChecks: [] });
  },

  clearChanges() {
    set({ lastChanges: null });
  },

  takeNotice() {
    set({ uiNotice: null });
  },

  /**
   * 冒一句给玩家看的话（`App.tsx` 会把它 toast 出来，用 `takeNotice` 取走）。
   *
   * 为什么要加这个 action：原来 `uiNotice` 只有**内部写**（生图链路四处 `set({uiNotice})`），
   * 别的模块想说一句人话只能 `useStore.setState(...)` —— 那是绕过 store 的暗门。
   * 2026-09-30 补"叙述违规用尽重试后的可见降级"时需要它，就补成正式入口。
   */
  notify(message) {
    set({ uiNotice: message });
  },

  encumbrance() {
    const rs = getRuleset(get().rulesetId);
    return encumbranceOf(
      get().gameState.inventory,
      rs.carryCapacity ? rs.carryCapacity(get().character.characteristics) : null,
      rs.mainDice === '1d100' ? 'percent' : 'modifier'
    );
  },

  /**
   * 临时疯狂现状（界面与提示词共用同一份计算）。
   * `note` 已经是可以直接拼进提示词的整段话（没疯时是 null）。
   */
  insanity() {
    const rs = getRuleset(get().rulesetId);
    const mode = rs.mainDice === '1d100' ? 'percent' : 'modifier';
    const flags = get().gameState.flags;
    const ins = insanityOf(flags, mode, insanityTurnsHint(flags));
    return { ...ins, note: insanityNote(ins) };
  },

  /**
   * 伤口现状 + 止血依据。给两处用：
   *   - `App.tsx` 拼本轮提示词（有伤口才注入 `woundNote`）；
   *   - 角色卡/状态面板要知道"现在能不能止住"。
   * 纯读，不改状态。
   */
  woundStatus() {
    const { gameState, character } = get();
    const wounds = gameState.wounds ?? [];
    const basis: HealBasis = healBasis(gameState.inventory, character.skills);
    const relief = woundRelief(basis);
    return { wounds, basis, relief, note: woundNote(wounds, basis, relief) };
  },

  /**
   * 图鉴（R38）。
   *
   * 三件事按顺序做完才算数：
   *   ① **总开关**：这一局结档了没有（没结档一律不给看，见 `bestiaryUnlocked`）；
   *   ② 表里每一条按台账算出可见档位；
   *   ③ 由 `bestiaryCard()` **统一裁字段**（没见过就不给弱点）。
   *
   * 为什么把 ②③ 都放在 core 的纯函数里：判据要能单测。
   * UI 只负责画卡片，不许自己再判一次"能不能看弱点"——
   * 那种判据一旦有两份，迟早会有一处忘了改。
   *
   * ⚠️ **这个方法每次调用都返回新对象，禁止直接塞进 zustand 选择器**
   * （`useStore((s) => s.bestiary())` 会无限重渲染 → 整页空白，
   * 2026-09-17 线上真出过一次）。组件请改用 `buildBestiary` + `useMemo`，
   * 或者选稳定切片（`s.module.monsters` 等）再自己算。
   * 这里保留方法只是为了测试与非组件代码方便。
   */
  bestiary() {
    const { module: mod, gameState } = get();
    return buildBestiary(
      (mod.monsters ?? []).map((m) => ({
        id: m.id,
        name: m.name,
        look: m.look,
        hp: m.hp,
        attack: m.attack,
        behavior: m.behavior,
        weakness: m.weakness,
      })),
      gameState.encountered ?? [],
      gameState.fought ?? [],
      gameState.ending
    );
  },

  /**
   * 按敌对者表投放战斗。
   *
   * 与 `flags` 那条口径一致：**引擎负责把数值落成事实，模型只负责演**。
   * 走 `applyModelDeltas` 而不是自己改 state —— 这样血量 clamp、名字必填、
   * 图鉴台账（`encountered`）全都自动生效，不会多开一条绕过校验的路。
   */
  startCombatFrom(entries, names) {
    const table: BestiaryEntry[] = (entries ?? []).map((m) => ({
      id: m.id,
      name: m.name,
      look: m.look,
      hp: m.hp,
      attack: m.attack,
      behavior: m.behavior,
      weakness: m.weakness,
    }));
    // 不点名 = 表里全部有名字的一起上（"这一场该来几只"只有作者知道，不猜）
    const picked = (names && names.length > 0 ? names : allNamedEntries(table)).slice();
    const deltas = castFromBestiary(table, picked);
    if (deltas.length === 0) return [];
    get().applyModelDeltas([
      { target: 'combat.active', op: 'set', value: true },
      ...deltas,
    ] as never);
    /*
     * 🔴 `G1`（协30 §2.1）：**轮次是引擎独占的**，所以开打那一刻由引擎自己写 1 ——
     * 不走 delta（那条路已经统一忽略 `combat.round` 的写法，模型写了也没用）。
     * 开打是结构性操作（横幅与轮次要当场对）：立刻落盘。
     */
    const gs = get().gameState;
    const opened = { ...gs, combat: { ...gs.combat, round: 1 } };
    saveJsonNow('trpg.gameState', opened);
    set({ gameState: opened });
    return deltas.map((d) => d.value.name);
  },

  consumeDyingNote() {
    const note = get().dyingNote;
    if (note) set({ dyingNote: null });
    return note;
  },

  setDyingNote(note) {
    set({ dyingNote: note });
  },

  setTypography(patch) {
    const next = { ...get().typography, ...patch };
    saveJson('trpg.typography', next);
    set({ typography: next });
  },

  setGmVoice(id) {
    // 认不出来的一律退回默认，不让一个坏值把提示词写坏
    const safe = gmVoiceOf(id).id;
    saveJsonNow('trpg.gmVoice', safe);
    set({ gmVoice: safe });
  },

  recordCurrentRun() {
    const s = get();
    const run = summarizeRun(s.messages, s.gameState, s.chronicle);
    const { career, unlocked } = recordRun(s.career, run);
    // 生涯是"记录"：立刻落盘，别让它跟别的待写混在一起
    saveJsonNow('trpg.career', career);
    set({ career, lastUnlocked: unlocked });

    /*
     * 世界层（Phase 2）：顺手把这一局**收回世界**（铁律①的另一半）。
     *
     * 时机与生涯完全一致 —— 结档那一刻，编年史 / 线索 / 支线都已定稿；
     * 去重也靠同一个 `ending.at`（调用方保证只调一次）。
     * **没有 ending 就不收**：留档必须以"这一局真的结束了"为准，
     * 否则半途开个新团会把"跑了一半的状态"当成世界的现状记下来。
     */
    const ending = s.gameState.ending;
    if (ending?.at) {
      const name = currentWorldName(s);
      const id = worldKey(name);
      const world = harvest(s.worlds[id], name, s.gameState, {
        moduleTitle: s.module.title,
        characterName: s.character.name,
        outcome: run.outcome,
        turns: run.turns,
        at: ending.at,
        note: ending.reason,
      });
      const worlds = { ...s.worlds, [id]: world };
      // 世界留档同样是"记录"：立刻落盘
      saveJsonNow('trpg.worlds', worlds);
      set({ worlds });
    }
    return unlocked;
  },

  setWorldName(name) {
    const t = (name ?? '').trim();
    // 世界名决定"这一局的留档落到哪个世界"：属于结构，立刻落盘
    saveJsonNow('trpg.worldName', t);
    set({ worldName: t });
  },

  setCarryWorld(on) {
    const v = Boolean(on);
    saveJsonNow('trpg.carryWorld', v);
    set({ carryWorld: v });
  },

  forgetWorld(id) {
    const key = worldKey(id);
    if (!get().worlds[key]) return;
    const worlds = { ...get().worlds };
    delete worlds[key];
    saveJsonNow('trpg.worlds', worlds);
    set({ worlds });
  },

  archiveCurrentCharacter() {
    const s = get();
    const { list, entry, replaced } = upsertCharacter(s.characterArchive, s.character, {
      rulesetId: s.rulesetId,
    });
    saveJsonNow('trpg.archive', list);
    set({ characterArchive: list });
    return { entry, replaced };
  },

  useArchivedCharacter(id) {
    const entry = findArchivedCharacter(get().characterArchive, id);
    if (!entry) return false;
    /*
     * 取出来时**再深拷一层**：档案库那份必须是不会被后续编辑改到的。
     * 只换人设与数值，**不动这一局正在跑的剧情**——
     * 换卡是准备页的事，真要按新卡开局得开新团。
     */
    const profile: CharacterProfile = {
      ...entry.profile,
      characteristics: { ...entry.profile.characteristics },
      skills: { ...entry.profile.skills },
      items: [...(entry.profile.items ?? [])],
      itemDetails: (entry.profile.itemDetails ?? []).map((d) => ({ ...d })),
    };
    writeLocal('trpg.character', JSON.stringify(profile));
    set({ character: profile });
    return true;
  },

  deleteArchivedCharacter(id) {
    const list = removeCharacter(get().characterArchive, id);
    saveJsonNow('trpg.archive', list);
    set({ characterArchive: list });
  },

  setAutoIllustrate(on) {
    saveJsonNow('trpg.autoIllustrate', Boolean(on));
    set({ autoIllustrate: Boolean(on) });
  },

  setActIndex(index) {
    const n = Math.max(0, Math.floor(Number(index) || 0));
    if (normalizeActIndex(get().gameState.actIndex) === n) return;
    const next = { ...get().gameState, actIndex: n };
    // 幕号是**结构**：换幕之后马上要展开新的一幕，立刻落盘免得中间态被后面的写盖掉
    saveJsonNow('trpg.gameState', next);
    set({ gameState: next });
  },

  async expandAct(index) {
    const s = get();
    const acts = parseActs(s.module.acts);
    const idx = index ?? normalizeActIndex(s.gameState.actIndex);
    const cur = actAt(acts, idx);
    // 没有幕结构 / 幕号越界 → 静默不做（短模组与手写模组走这条路）
    if (!cur) return false;
    // 已经展开过就别再花钱了
    if (isActExpanded(s.gameState.actDetails?.[String(idx)])) return true;
    if (!s.config.apiKey) return false;

    const genre = getGenre(s.genreId, s.customGenres);
    /*
     * 喂给模型的"既成事实"：编年史是唯一的客观事实源（摘要只是索引）。
     * 取最近 40 条足够这一段用，再多也只是烧 token。
     */
    const facts = [
      ...s.chronicle.slice(-40).map((c) => `${c.turn}. ${c.text}`),
      s.summary ? `（更早的事：${s.summary}）` : '',
    ]
      .filter(Boolean)
      .join('\n');

    try {
      const out = await generateJson<{ detail?: string }>(
        actExpandSystemPrompt(
          genre,
          s.module.title,
          s.module.acts,
          idx + 1,
          acts.length,
          cur.title,
          cur.summary
        ),
        actExpandUserPrompt(s.module.title, idx + 1, facts),
        s.config
      );
      const detail = String(out?.detail ?? '').trim();
      if (!detail) return false;
      const next = {
        ...get().gameState,
        actDetails: { ...(get().gameState.actDetails ?? {}), [String(idx)]: detail },
      };
      saveJsonNow('trpg.gameState', next);
      set({ gameState: next });
      return true;
    } catch {
      // 展开失败不该影响这一局 —— 只是这一章少一份幕后材料
      return false;
    }
  },

  setAudio(patch) {
    const next = { ...get().audio, ...patch };
    saveAudioConfig(next);
    set({ audio: next });
    // 立刻让设置生效（浏览器可能拦截，等下一次手势会再唤醒）
    setMasterVolume(next.master);
    if (next.enabled) {
      startAmbience(next.ambience, next.ambienceVol);
      void startBgm(next);
    } else {
      startAmbience('none', 0);
      stopBgm();
    }
    setBgmVolume(next.bgmVol);
  },

  addChronicle(text, location) {
    const t = text.trim();
    if (!t) return;
    const list = get().chronicle;
    /*
     * 回合号必须用"现有最大号 + 1"，不能用 length + 1。
     *
     * 原因：`foldChronicle` 会把早期条目折进摘要、只留最近 20 条，
     * 此时 length 已经小于实际回合数。若还用 length+1，新条目会拿到一个
     * 比现有条目更小的号（如已有 31..50，新条目却编号 21），
     * 事件日志在提示词里就成了乱序，`key={c.turn}` 也会撞车。
     */
    const lastTurn = list.reduce(
      (m, c) => (Number.isFinite(c.turn) && c.turn > m ? c.turn : m),
      0
    );
    const next = [...list, { turn: lastTurn + 1, text: t, location }];
    writeLocal('trpg.chronicle', JSON.stringify(next));
    set({ chronicle: next });
  },

  foldChronicle(keepFrom, summary) {
    const next = get().chronicle.slice(keepFrom);
    writeLocal('trpg.chronicle', JSON.stringify(next));
    writeLocal('trpg.summary', JSON.stringify(summary));
    set({ chronicle: next, summary });
  },

  clearProgress() {
    removeLocal('trpg.chronicle');
    removeLocal('trpg.summary');
    set({ chronicle: [], summary: '' });
  },

  startNewGame() {
    const s = get();
    /*
     * 🔴 **开一局就播一次种子**（2026-09-30 修）。
     *
     * 为什么要在这里：引擎本来就支持注入随机源（`applyDeltas` 的 `ctx.rng`、
     * `rollPercentile`/`roll` 的 `rng` 参数），但**生产侧一处都没传**，
     * 于是走 `Math.random` —— 玩家报"我那次掷出 96 之后状态就乱了"永远复现不了。
     *
     * 现在这一局的骰子全部来自这一个种子派生的源，日志留在内存里；
     * 玩家报问题时把种子给我，引擎那一段就能在本地重放。
     * ⚠️ 只有**引擎侧**可复现 —— 模型写什么故事不可复现（见 `ui/runRng.ts` 头部）。
     */
    reseedRun(Date.now() >>> 0);
    const opening = openingText(s.character, s.module, s.genreId);
    const messages: Message[] = [
      { id: WELCOME_ID, role: 'gm', content: opening, ts: Date.now() },
    ];
    // 满状态开局；线索 / 物品 / 地点 / 在场人物都清空，由 GM 在剧情里逐步带出
    const rs = getRuleset(s.rulesetId);
    const vitals = rs.deriveVitals(s.character.characteristics);
    // 数值条上限：HP/MP 以派生值为上限；SAN 上限给 99（COC 惯例，理智可高于起始值）
    const vitalsMax = Object.fromEntries(
      rs.vitalDefs.map((v) => [
        v.key,
        v.key === 'san' ? 99 : (vitals[v.key] ?? v.default),
      ])
    );
    // 补齐数值条：属性派生值里没有的键（自定义规则包可能缺）按默认值补，杜绝"显示 0"
    for (const def of rs.vitalDefs) {
      if (!Number.isFinite(vitals[def.key])) vitals[def.key] = def.default;
    }
    // 物品详情：把角色卡里 AI 生成的简介 / 武器属性一并带进背包
    const detailOf = (name: string) =>
      s.character.itemDetails?.find((d) => d.name?.trim() === name);
    const gameState = createInitialState({
      vitals,
      vitalsMax,
      // 开新团＝从头开始：上一局的队友与候选一律不带过来（否则会一直留着上局的人）
      companions: [],
      // 开局把角色卡里的随身物品塞进背包（否则玩家开局"裸着"）
      inventory: (s.character.items ?? [])
        .filter((name) => name?.trim())
        .map((name) => {
          const d = detailOf(name.trim());
          return {
            id: `item-${name.trim()}`,
            name: name.trim(),
            qty: 1,
            desc: d?.desc,
            kind: (d?.kind as 'weapon' | 'tool' | 'clue' | 'consumable' | 'other') ?? undefined,
            damage: d?.damage,
            skill: d?.skill,
          };
        }),
      flags: {},
      clues: [],
      // 开局面板不再空着：地点与在场人物直接摆出来，玩家一眼就知道"我在哪、谁在"
      location: initialLocation(s.module, s.character),
      npcsAlive: initialNpcs(s.module, s.character),
      /*
       * 故事时钟：**开新团＝从头开始数**。
       * 上一局的"第 27 天"不带过来 —— 那和"开新团不带上局的队友"是同一条道理。
       * 期限从模组推（见 `deadlineOf`），推不出来就没有期限。
       */
      /*
       * P2-10：开局时刻**以模组申报的为准**（`clock.start`），没申报才用默认值。
       * 兑现 `core/clock.ts` 头注释里承诺了但从没实现的那条。
       */
      clock: s.module.startClock ? { ...s.module.startClock } : { ...DEFAULT_CLOCK },
      deadline: deadlineOf(s.module),
      visited: (() => {
        const here = initialLocation(s.module, s.character).trim();
        return here ? [here] : [];
      })(),
    });
    /*
     * 世界层（Phase 2）：**只在会话边界搬运**（铁律①）。
     *
     * 接着上一次跑＝把这四样灌进来：地点 / 在场人物 / 未结的支线 / 标记。
     * 只在玩家开着开关、且这个世界确实有留档时生效；
     * 没有留档（第一次跑这个世界）时 `applySnapshot` 原样返回，什么都不改。
     *
     * 读留档**不删留档** —— 玩家可能反复开团试不同的走法，
     * 真正的"收回"只发生在结档那一刻（见 `recordCurrentRun`）。
     */
    const resolvedWorldName = currentWorldName(s);
    const world = findWorld(Object.values(s.worlds), resolvedWorldName);
    const willCarry = s.carryWorld && Boolean(world?.snapshot);
    const carriedState = willCarry ? applySnapshot(gameState, world?.snapshot) : gameState;
    /*
     * 留一个"这一局从哪接上来的"的记号给守密人看（`carriedFrom`）。
     * 没有它，模型会以为玩家是第一次站在这条甲板上 ——
     * 明明在场的人都认识他，它却要重新自我介绍一遍。
     */
    const finalState = willCarry ? { ...carriedState, carriedFrom: world!.name } : carriedState;
    // 开新团：立刻落盘
    saveJsonNow('trpg.messages', messages);
    saveJsonNow('trpg.gameState', finalState);
    saveJsonNow('trpg.chronicle', []);
    saveJsonNow('trpg.summary', '');
    saveJsonNow('trpg.snapshots', {});
    /*
     * **"清 fromModule 类数据"不属于开新团**（协作方 B3 + N2）。
     *
     * 开新团时模组并没有换，AI 生成的世界书与队友候选都是 `fromModule`、
     * 都属于**当前**模组，一删就空——用户看到的"准备页世界书/同行者没了"就是这么来的。
     * 世界书与候选都不在这里清；真正该清它们的时机是**模组真的换了**，
     * 那一步由 `clearModuleDerived()` 负责（AI 生成模组 / 贴文本导入 / 应用整套预设时调用）。
     */
    const keptWorldbook = s.worldbook;
    const keptCandidates = s.companionCandidates;
    // 动作小图与旧地图：都属于上一局，清掉（图片在 IndexedDB 里，要一起清）
    void idbSet('messageImages', {});
    void idbSet('mapImage', '');
    set({
      messages,
      gameState: finalState,
      chronicle: [],
      summary: '',
      snapshots: {},
      companionCandidates: keptCandidates,
      worldbook: keptWorldbook,
      messageImages: {},
      mapImage: '',
      // 上一局遗留的待掷检定、状态提示与濒死引导也一并清掉
      pendingChecks: [],
      lastChanges: null,
      uiNotice: null,
      dyingNote: null,
    });
  },

  setTheme(t) {
    writeLocal('trpg.theme', t);
    set({ theme: t });
  },

  rollExpression(expr, seed) {
    const outcome = roll(expr, seed === undefined ? currentRng() : seededRng(seed));
    return {
      expression: outcome.expression,
      total: outcome.total,
      groups: outcome.groups.map((g: DieGroup) => ({ sides: g.sides, results: g.results })),
    };
  },

  skillCheck(skill, difficulty = 'regular', bonus = 0, seed) {
    /*
     * ⚠️ **每次现取**当前源（`currentRng()`），不要提前存进变量 ——
     * 一局里 `reseedRun()` 可能被调用（开新团），存下来的会是旧源。
     */
    const rng = seed === undefined ? currentRng() : seededRng(seed);
    const key = skill.trim();
    const rs = getRuleset(get().rulesetId);
    // 目标值可从角色卡技能 / 规则包基础值 / 属性表里解析（属性也可检定）
    const raw = resolveCheckTarget(key, get().character, rs) ?? 0;
    // DnD 要把属性分值折算成加值（15 → +2）；技能本身已是加值则原样
    const base = rs.toModifier ? rs.toModifier(key, raw) : raw;
    const mode = rs.mainDice === '1d100' ? 'percent' : 'modifier';
    /*
     * 超重惩罚：**在掷骰之前**减进目标值。
     * 身上扛太多东西，做什么都该更吃力——这是物理，不是难度选择。
     * 规则包没给 `carryCapacity` 时不启用（自定义规则包大多如此），那就不罚。
     */
    const enc = encumbranceOf(
      get().gameState.inventory,
      rs.carryCapacity ? rs.carryCapacity(get().character.characteristics) : null,
      mode
    );
    /*
     * 临时疯狂惩罚：同样在掷骰前减进目标值（用户 09-16 拍板"状态要有数值后果"）。
     * 有界、可恢复，解除即消除 —— 判据全在 `core/insanity.ts`，这里只取数。
     */
    const ins = insanityOf(get().gameState.flags, mode, insanityTurnsHint(get().gameState.flags));
    /*
     * 描述加权：**在掷骰之前**加进目标值。
     * 放在这里（而不是事后改结果）才能保证判定、成功率与结果标签三者一致。
     */
    const target = base + (bonus || 0) + enc.penalty + ins.penalty;
    // COC 走百分骰；其它规则包退回主骰表达式（如 d20）
    const percentile = rs.mainDice === '1d100';
    if (percentile) {
      const pr = rollPercentile();
      const res = rs.resolveCheck(pr.value, target, difficulty);
      // 掷完把结果记下来：守密人回话时引擎据此决定收不收伤害、能不能扣属性（G25/G27）
      noteCheckOutcome(res.success, res.tier === 'fumble');
      return {
        skill,
        target: res.target,
        roll: pr.value,
        label: res.label,
        tier: res.tier,
        success: res.success,
        difficulty,
        mainDice: rs.mainDice,
        bonus: bonus || undefined,
      };
    }
    const outcome = roll(rs.mainDice);
    const res = rs.resolveCheck(outcome.total, target, difficulty);
    noteCheckOutcome(res.success, res.tier === 'fumble');
    return {
      skill,
      target: res.target,
      roll: outcome.total,
      label: res.label,
      tier: res.tier,
      success: res.success,
      difficulty,
      mainDice: rs.mainDice,
      bonus: bonus || undefined,
    };
  },

  applyModelDeltas(deltas, opts) {
    const { gameState, rulesetId, character } = get();
    const tickNow = opts?.elapsed !== undefined && consumeClockTick();
    /*
     * `G17`：时钟下限只在"真的会推进"的那一次传，传完就清 ——
     * `applyModelDeltas` 一轮里会被调多次（状态一次、地点一次），传两遍就等于等两次。
     */
    const clockFloor = tickNow ? pendingClockTarget ?? undefined : undefined;
    if (tickNow) pendingClockTarget = null;
    /*
     * 命中授权（P1-5 阶段二）：这一轮玩家掷没掷中，交给引擎判"武器伤害算不算"。
     * 只在战斗里给（不在战斗中就没有敌人可打；传了也无害，但少一条路径就少一个坑）。
     */
    const foeDamage = get().gameState.combat?.active ? foeDamageGrant() : undefined;
    /*
     * 敌人兜底，**两道**，顺序有讲究：
     *
     *   1. `patchUnnamedFoes` —— 模型忘了写 name 的，从这一轮的正文里把名字捞回来。
     *      （核心层还有一道"不许拒绝"的兜底，这里是把名字尽量救回来的机会）
     *   2. `fillFoeNumbers` —— 名字对得上模组敌对者表的，把 hp / max 补成表里的值。
     *
     * 顺序不能反：第一步给不出名字，第二步再宽松匹配也是白搭。
     * 两步都只"补缺"，模型显式给了的一律不动（判据在各自的函数头）。
     */
    const withNames = patchUnnamedFoes(deltas, opts?.elapsed);
    const report = applyDeltas(gameState, fillFoeNumbers(withNames, get().module.monsters), {
      ruleset: getRuleset(rulesetId),
      vitalsMax: deriveVitalsMax(character, rulesetId),
      // 本局随机源（种子派生）：伤害骰 / 失血 / 状态结算都走它，整局可复现
      rng: currentRng(),
      /*
       * 故事时钟：把守密人申报的"过了多久"交给引擎折算。
       * 只在**这一轮的第一次调用**里传 —— 一轮里可能分几次调
       * （状态一次、地点一次），传两遍会把时间算两次。
       */
      ...(tickNow ? { elapsed: opts!.elapsed } : {}),
      // 命中授权（P1-5 阶段二）：带 weapon 的攻击没掷中就不许扣血
      ...(foeDamage ? { foeDamage } : {}),
      // `G17`：玩家说了「等到 X」→ 这一轮时钟至少走到那个点
      ...(clockFloor !== undefined ? { clockFloor } : {}),
      // `G25`：模型申报的属性下降要有检定授权（引擎自己的账不传这一项，天然不受影响）
      harm: harmGrant(),
    });
    // 模型偶尔会把模组里的 {{称呼}} 占位符漏进状态（地点/线索/物品名）。
    // 状态是要显示给玩家的，进库前统一替换成真实值。
    report.state = sanitizeStateTokens(report.state, character);

    /*
     * ---------------------------------------------------------------------
     * 伤口：先"记账"，再"结算"
     * ---------------------------------------------------------------------
     * 顺序不能反。本轮模型造成的伤害要先变成伤口，本轮才谈得上失血——
     * 反过来的话，新伤口要等下一轮才生效，玩家会觉得"我明明刚被砍了却没掉血"。
     *
     * 这一步只动 `wounds`，不改 vitals —— 血的增减统一走下面的 applyDeltas，
     * 这样"濒死冻结"那道闸门对它一样有效（倒地的人不该被伤口继续放血）。
     */
    const rsForWounds = getRuleset(rulesetId);
    const lifeDef = rsForWounds.vitalDefs.find((v) => isLifeVital(v, v.key));
    const lifeKey = lifeDef?.key ?? 'hp';
    const lifeMin = lifeDef?.min ?? 0;
    const hpNow = report.state.vitals[lifeKey];

    /*
     * ① 守密人**显式申报**的伤口（`flags.受伤` = "左臂被划开的口子"）。
     *
     * 注意这里读的是 `受伤` 而不是 `伤口` —— 引擎自己写的显示用 flag 叫 `伤口`
     * （值形如"伤口·每轮 -1"）。两者**必须是不同的键**，否则引擎下一轮会把自己的
     * 显示文案当成一次新申报读回来，伤口一轮接一轮自我复制。
     * 一个键只承担一个职责：`受伤` 是输入（守密人写），`伤口` 是输出（引擎写）。
     */
    const declared = report.state.flags?.['受伤'];
    const declaredList =
      typeof declared === 'string'
        ? [declared]
        : Array.isArray(declared)
          ? declared.map((x) => String(x))
          : [];
    let wounds: Wound[] = [...(report.state.wounds ?? [])];
    let bornThisTurn = false;
    for (const text of declaredList) {
      const w = parseWound(fillPlayerTokens(text, character), wounds);
      if (w) {
        wounds.push(w);
        bornThisTurn = true;
      }
    }
    /*
     * ② 引擎**自己推**的伤口：本轮主生命条一次掉了 2 点以上。
     * 已经流着血的（wounds 非空）不再叠加——一轮连挨两下不该变成两处流血，
     * 那只会让本来就很薄的 10 滴血更快见底。
     */
    if (wounds.length === 0 && !report.state.dying && !report.state.ending) {
      for (const a of report.applied) {
        if (a.delta.target !== `vitals.${lifeKey}`) continue;
        if (typeof a.before !== 'number' || typeof a.after !== 'number') continue;
        const tier = woundFromDamage(a.before - a.after);
        if (!tier) continue;
        const text = a.delta.reason?.trim() || defaultWoundText(tier);
        wounds.push({
          id: `auto-${text.slice(0, 12)}`,
          text,
          tier,
          turns: 0,
        });
        bornThisTurn = true;
        break;
      }
    }

    /*
     * ③ 失血结算：**每轮一次**，额度固定（见 wounds.ts「为什么额度这么小」）。
     * 濒死 / 已结档 / 血已见底一律不流 —— 与濒死冻结同一条口径。
     *
     * **刚造成的伤口当轮不流血**：这一轮它已经用"掉那几点血"付过账了，
     * 再补一次失血就是同一件事扣两遍，玩家会觉得系统在趁火打劫。
     * 从**下一轮**起才开始按轮结算（这正是"持续伤害"该有的样子）。
     *
     * 为什么用不着再掷骰：额度是常数，掷骰只会让"流血"变成一场随机数游戏，
     * 而玩家能做的处置（止血）本来就该是决定性的，不该赌。
     */
    let bleedNote: string | null = null;
    if (
      !bornThisTurn &&
      /*
       * `N2`：先判"该不该流血"（纯函数），再消费行动标记 ——
       * 顺序反了的话，不该流血的那一轮也会把标记吃掉（那一轮就永远不结算）。
       */
      shouldBleed({
        wounds,
        hp: hpNow,
        hpMin: lifeMin,
        dying: report.state.dying,
        ending: Boolean(report.state.ending),
      }) &&
      consumeBleedTick()
    ) {
      const amount = totalBleed(wounds);
      const bleedReport = applyDeltas(
        { ...report.state, wounds },
        [bleedDelta(amount)],
        { ruleset: rsForWounds, vitalsMax: deriveVitalsMax(character, rulesetId), rng: currentRng() }
      );
      report.state = bleedReport.state;
      report.applied.push(...bleedReport.applied);
      report.rejected.push(...bleedReport.rejected);
      if (bleedReport.applied.length > 0) {
        bleedNote = `伤口失血 ${amount} 点`;
      }
      wounds = wounds.map((w) => ({ ...w, turns: w.turns + 1 }));

      /*
       * 结痂：光靠时间自己收口的，这一轮之后就不再算了
       * （判据在 `healedByTime`，轻的快、重的不会自己好）。
       *
       * 为什么不让人为处理才有意义：一处擦伤若永远流着，
       * "既无医疗物品又不会急救"的角色就会稳定地流到死 —— 那正是用户报过的
       * "我总共就 10 滴血，也太刺激了"。自愈让轻伤有终点，重伤仍需人处理。
       *
       * 清掉之后 `woundFlagText` 会变 null，下面那段会自动把 `flags.伤口` 删掉，
       * 状态栏不会再挂着"还在流"。
       */
      const scabbed = wounds.filter(healedByTime);
      if (scabbed.length > 0) {
        wounds = wounds.filter((w) => !healedByTime(w));
        const scabText = `伤口自己结痂、止住了（${scabbed.map((w) => w.text).join('、')}）`;
        bleedNote = bleedNote ? `${bleedNote}；${scabText}` : scabText;
      }
    }

    /*
     * ④ 止血：依据够不够（见 `healBasis` / `woundRelief`）。
     *
     * 触发条件是**守密人写了处理动作**，而不是"引擎觉得够了就自动止住"——
     * 止不止得住是一件发生在故事里的事，引擎只负责在它发生之后把账结掉。
     * 判据是 `flags.伤口处理`（守密人申报），处理完就清掉它。
     */
    const treating = Boolean(report.state.flags?.['伤口处理']);
    if (wounds.length > 0 && treating) {
      const basis = healBasis(report.state.inventory, character.skills);
      const relief = woundRelief(basis);
      if (relief === 'stop') {
        wounds = [];
        bleedNote = '伤口已止住';
      } else if (relief === 'relief') {
        // 只剩轻伤：临时处理压住了大半，降一档而不是清零
        wounds = wounds.map((w) => ({
          ...w,
          tier: w.tier === 'severe' ? 'wound' : 'scratch',
        }));
      }
    }

    if (wounds.length > 0) {
      report.state = { ...report.state, wounds };
    } else if (report.state.wounds?.length) {
      report.state = { ...report.state, wounds: [] };
    }

    // 理智骤降 / 永久疯狂 / 濒死 / 死亡：引擎检测，写进 flags 让 GM 演出、UI 显示
    const events = detectStatusEvents(report.applied, report.state);
    let insanityLine: string | null = null;
    {
      const flags = { ...report.state.flags };
      const beforeIns = { ...flags };

      /*
       * 临时疯狂：**先推进窗口，再接受本轮新触发的**。
       *
       * 顺序要紧。若先写新值再推进，刚发疯的这一轮就会被立刻减掉一轮；
       * 而"本轮理智骤降 ≥5"和"上一轮的疯狂还在计时"是两件事，
       * 前者是天数 1 的开始，后者才该 −1。
       *
       * 为什么用 `prevTurns` 而不是每次都从 flag 读：守密人常把 flag 写成
       * 一句描述（"他抓着头发喃喃自语"），那句子里没有轮数。每次都从 flag 读
       * 会永远读到默认值、永远解除不掉。所以引擎把自己记的轮数（存在 `疯狂轮数`）
       * 当作真源，守密人的描述只当开窗的触发。
       */
      /* ────────────────────────────────────────────────────────────
       * 状态效果结算（1.0 阶段 C 的**接线** —— P1-3 回归）。
       *
       * 🔴 这一段以前**根本没写**：`tickStatusEffects` 纯函数在、单测在、
       * `statusNote` 也接进了提示词，唯独"推进一轮"这里从没调用它。
       * 结果引擎一边对守密人说"后果我已算过、别重复扣"，一边**什么都没扣** ——
       * 中毒永久挂在身上。这比没做更糟：它把权威宣示出去了，行为却是空。
       *
       * ⚠️ 顺序（协作方第 25 版钉死，与 `tickInsanity` 同构）：
       * **用「上一轮」的 flags 推进**，再收本轮的新申报。
       * 若拿本轮的 flags 推进，模型刚写 `中毒轮数:2` 会被立刻 tick 成 1，
       * 玩家在状态栏看到的和守密人申报的对不上。
       * ──────────────────────────────────────────────────────────── */
      {
        const rs = getRuleset(rulesetId);
        const prevFlags = get().gameState.flags ?? {};
        // ⚠️ 一轮只结算一次（`applyModelDeltas` 一轮会被调多次，见 `shouldTickStatus`）
        const seTick = consumeStatusTick()
          ? tickStatusEffects(prevFlags, rs, currentRng())
          : { deltas: [], cleared: [], remaining: [] };
        if (seTick.deltas.length > 0) {
          const seReport = applyDeltas(report.state, seTick.deltas, {
            ruleset: rs,
            vitalsMax: deriveVitalsMax(character, rulesetId),
            rng: currentRng(),
          });
          report.state = seReport.state;
          report.applied.push(...seReport.applied);
          report.rejected.push(...seReport.rejected);
        }
        // 回写：到期的删掉（连记账键一起），还在持续的写回剩余轮数
        const after = { ...report.state.flags };
        for (const c of seTick.cleared) {
          delete after[c];
          delete after[turnsKeyOf(c)];
        }
        for (const r of seTick.remaining) after[turnsKeyOf(r.name)] = r.turns;
        report.state = { ...report.state, flags: after };
        /*
         * ⚠️ `flags` 是上面那个块的局部变量，回写后必须**完全跟上** ——
         * 否则下面伤口那段结尾的 `report.state = {... , flags}` 会把旧内容盖回去。
         * 而且必须**先清空再拷**：`Object.assign` 只覆盖不删除，
         * 光 assign 的话"到期删掉"的键会原地复活（中毒永远好不了）。
         */
        for (const k of Object.keys(flags)) delete flags[k];
        Object.assign(flags, after);
      }

      /*
       * 🔴 战斗轮 +1（P1-5 阶段 1）—— **引擎自己走，不等守密人记得写**。
       *
       * ⚠️ 判据用**上一轮**的 `combat.active`（`get().gameState`），不是本轮的：
       * 「刚进入战斗」那一次（false → true，模型写 active=true + round=1）**不算走完一轮**，
       * 否则开打的第一秒界面就写着"第 2 轮"。只有"这一轮开始前就已经在打"才推进。
       * 同理，战斗结束后（active 落 false）也不再往上加。
       */
      const prevCombat = get().gameState.combat;
      if (
        prevCombat?.active &&
        report.state.combat?.active &&
        (report.state.combat.foes?.length ?? 0) > 0 &&
        consumeCombatRoundTick()
      ) {
        /*
         * 🔴 `G1`（协30 §2.1）：基数取**引擎上一拍**的值，不取模型申报的、也不能 `|| 1`。
         *
         * 两处病叠在一起才出现真机那条 `0 → 2 → 4`：
         *   ① `Number(report.state.combat.round) || 1` —— `0` 是**合法轮次**，
         *      被 `|| 1` 折叠成 1，再 +1 就是 2（对得上真机的第一次 +2）；
         *   ② 模型照抄旧提示词在契约里写了 round，引擎在**它写的值**上再加。
         */
        const prevRoundRaw = Number(prevCombat.round);
        const prevRound = Number.isFinite(prevRoundRaw) ? Math.max(0, Math.floor(prevRoundRaw)) : 0;
        report.state = {
          ...report.state,
          combat: { ...report.state.combat, round: prevRound + 1 },
        };
      }

      const tick = tickInsanity(flags, insanityTurnsHint(flags));
      if (tick.next === false) {
        delete flags['临时疯狂'];
        delete flags['疯狂轮数'];
      } else {
        flags['疯狂轮数'] = tick.next;
      }

      for (const e of events) {
        if (e.kind === 'temp_insanity') {
          flags['临时疯狂'] = e.text;
          flags['疯狂轮数'] = INSANITY_TURNS;
          insanityLine = e.text;
        } else if (e.kind === 'permanent_insanity') flags['永久疯狂'] = true;
        else if (e.kind === 'dying') flags['濒死'] = true;
        else if (e.kind === 'death') flags['濒临死亡'] = true;
      }

      /*
       * 守密人把 `flags.临时疯狂` 设成 `false` = **提前解除**（用户要的"解除即消除"）。
       * 注意判据必须放在上面那轮推进**之后**：推进只删键、不写 `false`，
       * 所以这里读到 `false` 只可能是守密人自己写的。
       */
      if (beforeIns['临时疯狂'] === false) {
        delete flags['临时疯狂'];
        delete flags['疯狂轮数'];
      }

      /*
       * 伤口进 flags：状态栏是**动态渲染全部中文 flags** 的，
       * 所以只要把这句话写进去，玩家就能看见"伤口·每轮 -1"，
       * 不用再动任何 UI —— 这正是"状态变化必须可见"那条硬约定要的效果。
       *
       * 三个键的分工要分清（混用会出事，见 ①里的说明）：
       *   - `受伤`：**输入**通道，守密人申报新伤口用；
       *   - `伤口处理`：**输入**通道，守密人申报"我处理了"用，一次性，处理完就删；
       *   - `伤口`：**输出**通道，引擎写的显示文案，永远不读回来。
       * 伤口清空时把输出 flag 一并删掉，否则会出现"伤好了但状态栏还写着流血"。
       */
      const woundText = woundFlagText(wounds);
      if (woundText) flags['伤口'] = woundText;
      else delete flags['伤口'];
      delete flags['伤口处理'];
      // `受伤` 是守密人本轮写的输入，消费掉——留着下一轮会被当成一次新申报
      delete flags['受伤'];
      report.state = { ...report.state, flags };
    }
    /*
     * 结档判定。
     *
     * 用户定调（2026-09-14）：**死亡 = 结档**，这段故事就此结束。
     * 但"归零的那一瞬间"还不算——先给一轮"濒死"的演出机会，
     * 到下一个结算点生命仍是 0，才真的结档。理智归零同理直接结档（永久疯狂）。
     *
     * 注意：数值条被规则包裁剪在 min（hp 的 min 是 0），所以 `hp < 0` 永远不会发生，
     * 早期 `detectStatusEvents` 里的"死亡"分支其实是死代码。
     */
    let nextState = report.state;
    if (!nextState.ending) {
      const hp = nextState.vitals.hp;
      const san = nextState.vitals.san;
      let kind: Ending['kind'] | null = null;
      if (typeof san === 'number' && san <= 0) {
        kind = 'insanity';
      } else if (typeof hp === 'number' && hp <= 0) {
        /*
         * 🔴 `G27`（协28 §F① 第 6b 条）：**致命一击直接出结局**，不给"下一轮再看一眼"的缓冲。
         *
         * 主人原话：「该死的时候能死，守密人不要硬找理由拖着不让死」「死定了就一次性掉大量属性直接出结局」。
         * 以前无论怎么死都要先挂一轮濒死（`dying`），中间模型给一口回血就又活过来了 ——
         * "死亡 = 结档"这条设计在真机上几乎不可达（62 轮里 hp 一次没动）。
         * 现在：引擎认出这一下是**打光的那一击**（`planHarm` 的 `lethal`）→ 当场结档。
         * 逐点掉血那套照旧：血见底但还不是致命一击，仍然先给一轮施救窗口。
         */
        if (report.lethal) kind = 'death';
        else if (nextState.dying) kind = 'death';
        else {
          nextState = { ...nextState, dying: true };
          /*
           * 刚进入濒死：挂一条**一次性**的施救引导，下一轮发给守密人。
           * 不给它菜单、也不替玩家定成败——只要求守密人在叙境内给出"还有一口气可以争"的路。
           */
          set({ dyingNote: DYING_NOTE });
        }
      } else if (typeof hp === 'number' && hp > 0 && nextState.dying) {
        // 救回来了，解除濒死
        nextState = { ...nextState, dying: false };
        set({ dyingNote: null });
      }
      if (kind) {
        // 正文留空：App 会拿它当信号，向守密人要一段结局叙事再填进来
        nextState = { ...nextState, ending: { kind, text: '', at: new Date().toISOString() } };
      }
    }

    /*
     * 拾到模组道具表里的东西时，把它的「作用」自动带进背包说明。
     *
     * 以前玩家捡到一件东西，背包里只有一个名字——不知道能干嘛，等于白捡。
     * 作用已经在道具表里单独生成好了，这里直接取，不用再麻烦模型。
     */
    const itemTable = get().module.items ?? [];
    if (itemTable.length > 0) {
      let filled = false;
      const inventory = nextState.inventory.map((it) => {
        if (it.desc) return it;
        const def = itemTable.find((d) => d.name.trim() === it.name.trim());
        if (!def) return it;
        filled = true;
        return {
          ...it,
          desc: def.effect || def.look || it.desc,
          kind: it.kind ?? def.kind,
        };
      });
      if (filled) nextState = { ...nextState, inventory };
    }

    /*
     * 人物档案（`npcNotes`）的容量：**先打时间戳，再淘汰**。
     *
     * 顺序要紧 —— 先打时间戳，本轮刚接触过的人就不会被当成"最久未接触"踢掉。
     * 判据是用户 09-17 拍板的三条：上限 30 / 淘汰最久未接触者 / **在场者永不淘汰**
     * （详见 `core/npcNotes.ts` 文件头）。
     *
     * 回合号与 `addChronicle` 同一算法（现有最大号 + 1，不能用 length+1，
     * 早期条目折进摘要后 length 会小于实际回合数）。
     */
    {
      const lastTurn = get().chronicle.reduce(
        (m, c) => (Number.isFinite(c.turn) && c.turn > m ? c.turn : m),
        0
      );
      const present = presentNpcNames(nextState);
      const touched = touchNpcNotes(nextState.npcNotes, present, lastTurn + 1);
      const pruned = pruneNpcNotes(touched, present);
      if (pruned.notes !== nextState.npcNotes) {
        nextState = { ...nextState, npcNotes: pruned.notes };
      }
      // 淘汰的是"早就离场、久未接触"的人，玩家不需要为它弹提示（那是内部清理）；
      // 留在 console 里是为了以后排查"我的档案怎么没了"。
      if (pruned.dropped.length > 0) {
        console.warn('[跑团] 人物档案超上限，已淡出：', pruned.dropped.join('、'));
      }
    }

    saveJson('trpg.gameState', nextState);
    set({ gameState: nextState });

    /*
     * 主页面"状态变化"提示。
     * 角色卡里的数值是静默更新的——玩家摔了一跤、血掉了 3 点，
     * 如果主页面不提示，等他偶然翻到角色卡时已经不知道是什么时候变的。
     */
    const lines = describeChanges(report.applied, nextState, (k) => {
      const def = getRuleset(rulesetId).vitalDefs.find((v) => v.key === k);
      return def?.label ?? k.toUpperCase();
    });
    /*
     * 被引擎拦下的变更也要给玩家看见。
     * 典型是武器：模型想"用掉"手枪被拒，但玩家只会发现"东西怎么没扣/枪还在"——
     * 引擎内部记账不算反馈，这里把它翻成一句人话放进同一条"状态变化"提示里。
     */
    for (const r of report.rejected) {
      // 濒死冻结：这是**好消息**，别用告警色吓人，但要让玩家看见"血没有再掉"
      if (r.reason === DYING_FREEZE_REASON) {
        lines.push({ text: '已经倒下了 —— 这一轮生命不再下降，还有一口气', tone: 'good' });
        continue;
      }
      if (r.delta?.target !== 'inventory') {
        /*
         * 🔴 非物品的拦下**也要说一声**（`G25` / `G24` 都靠这一句被看见）。
         *
         * 以前这里只处理 `inventory`（"武器不按数量消耗"那一套），其余一律 `continue` ——
         * 于是"这一下没算数"是**静默**的（只 `console.warn`）。而它恰恰是玩家最需要看到的：
         * 守密人写着"你被撞得骨头生疼"，血却没动，不说等于让玩家以为系统坏了。
         * `G24`（敌人还活着不许关战斗）拒掉时同理。
         */
        lines.push({ text: r.reason ?? '这一下被引擎拦下了', tone: 'warn' });
        continue;
      }
      const name = String(r.delta.value ?? '物品');
      lines.push({
        text: r.reason?.includes('武器')
          ? `守密人想处理「${name}」，已忽略（武器不按数量消耗）`
          : `「${name}」的变更被忽略（${r.reason ?? '无效变更'}）`,
        tone: 'warn',
      });
    }
    /*
     * 伤口在这一轮发生了什么，要说清楚。
     *
     * 数值条的变化本身已经有一条（"生命 5 → 4"），但玩家看不出**为什么**又掉了——
     * 那是伤口在放血。用户报的原话就是"我包扎了，怎么还隔段时间掉血"，
     * 补充这一句正好回答那个疑问。止住了也要报，那是好消息。
     */
    if (bleedNote) {
      lines.push({ text: bleedNote, tone: bleedNote.includes('止住') ? 'good' : 'down' });
    }
    /*
     * P3-2/D 之外，这里补第 17 版 D：**模型点名了却没扣**的情况要说出来。
     *
     * 场景：玩家写了「把绷带铺在地上」，引擎把"点到了止血绷带"报给守密人
     * （提示词红线二之五），但这一轮的契约里**忘了写 `inventory dec`**。
     * 引擎**不替他扣**（A+B 撤掉了本地预扣，实物的用法引擎猜不出来），
     * 但也不能一声不吭 —— 那样玩家会以为"这东西是无限的"。
     *
     * 判据：`opts.mentionedItems` 里点了全名、而 `report.applied` 里
     * **没有**该物品的 `inventory` `dec` → 说一句"它还在背包里"。
     * 措辞刻意是**陈述**不是告警：这不是错误，只是把账摊开给玩家看。
     */
    for (const name of opts?.mentionedItems ?? []) {
      const consumed = report.applied.some(
        (a) =>
          a.delta.target === 'inventory' &&
          a.delta.op === 'dec' &&
          String(a.delta.value ?? '') === name
      );
      if (!consumed) {
        lines.push({ text: `「${name}」还在背包里`, tone: 'info' });
      }
    }
    /*
     * 疯没疯、缓过来没有，也要说一声。
     * 它直接改检定目标值，玩家如果只在状态栏上看到一个标签、
     * 却不知道"为什么这一掷平白无故难了 20"，那这条机制就是隐形的。
     */
    if (insanityLine) {
      lines.push({ text: `${insanityLine}（检定会受影响，过一阵会缓过来）`, tone: 'warn' });
    }
    const now = Date.now();
    const prev = get().lastChanges;
    const sameTurn = Boolean(prev) && now - prev!.ts < CHANGE_MERGE_MS;
    const merged: StateChangeLine[] = sameTurn ? [...prev!.lines] : [];
    for (const l of lines) if (!merged.some((x) => x.text === l.text)) merged.push(l);
    set({
      lastChanges: merged.length
        ? { id: sameTurn ? prev!.id : uid(), ts: now, lines: merged }
        : null,
    });

    if (report.rejected.length > 0) {
      console.warn('[跑团] 被拒绝的状态变更：', report.rejected);
    }
    // 事件写进编年史，让 GM 与玩家都看见"这一刻发生了什么"
    for (const e of events) get().addChronicle(e.text, get().gameState.location);
  },

  buildSave() {
    const s = get();
    return {
      version: SAVE_VERSION,
      exportedAt: new Date().toISOString(),
      character: s.character,
      module: s.module,
      gameState: s.gameState,
      messages: s.messages,
      chronicle: s.chronicle,
      summary: s.summary,
      worldbook: s.worldbook,
      companionCandidates: s.companionCandidates,
      snapshots: s.snapshots,
    };
  },

  loadSave(raw) {
    // 先过一遍迁移：任何历史版本的存档都要能读进来
    const data = migrateSave(raw);
    /*
     * 读档 = **只补不删**。
     * 世界书取并集而不是整体替换（替换＝把我现在的东西删掉），
     * 队友候选也一并恢复（以前完全没恢复，准备页就"空了"）。
     */
    const worldbook = mergeWorldbook(get().worldbook, data.worldbook);
    const candidates = data.companionCandidates ?? get().companionCandidates;
    set((s) => ({
      character: data.character ? { ...s.character, ...data.character } : s.character,
      module: data.module ?? s.module,
      gameState: data.gameState ?? s.gameState,
      messages: data.messages ?? s.messages,
      chronicle: data.chronicle ?? s.chronicle,
      summary: data.summary ?? s.summary,
      worldbook,
      companionCandidates: candidates,
      snapshots: data.snapshots ?? s.snapshots,
    }));
    if (data.character) writeLocal('trpg.character', JSON.stringify(data.character));
    // 导入存档：整份替换，立刻落盘
    if (data.module) saveJsonNow('trpg.module', data.module);
    if (data.gameState) saveJsonNow('trpg.gameState', data.gameState);
    if (data.messages) saveJsonNow('trpg.messages', data.messages);
    if (data.chronicle)
      writeLocal('trpg.chronicle', JSON.stringify(data.chronicle));
    if (data.summary) writeLocal('trpg.summary', JSON.stringify(data.summary));
    writeLocal('trpg.worldbook', JSON.stringify(worldbook));
    saveJson('trpg.companionCandidates', candidates);
    if (data.snapshots) saveJson('trpg.snapshots', data.snapshots);
  },
}));
