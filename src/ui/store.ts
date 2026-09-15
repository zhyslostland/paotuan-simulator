import { create } from 'zustand';
import { SCALE_LABEL } from '../orchestrator/generate.js';
import type { ModuleScale } from '../orchestrator/generate.js';
import {
  applyDeltas,
  createInitialState,
  detectStatusEvents,
  type AppliedDelta,
  type Companion,
  type Ending,
  type GameState,
  type InventoryItem,
  type StateDelta,
  type Thread,
} from '../core/state/gameState.js';

export type { Companion };
import { roll, type DieGroup } from '../core/dice/index.js';
import { rollPercentile } from '../core/rulesets/coc7.js';
import { getRuleset, listRulesets, loadCustomRulesets } from '../core/rulesets/index.js';
import { getGenre, listGenres, type Genre } from '../core/genres.js';

// 先注册 localStorage 里存的自定义规则包，再初始化 store（否则 loadRulesetId 认不到它们）
loadCustomRulesets();
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

export type { AudioConfig };

export interface DiceBadge {
  expression: string;
  total: number;
  groups: { sides: number; results: number[] }[];
}

export interface CheckBadge {
  skill: string;
  target: number;
  roll: number;
  label: string;
  tier: string;
  success: boolean;
  /** 请求时的难度，重掷要用它复现 */
  difficulty?: 'regular' | 'hard' | 'extreme';
  /** 主骰表达式（"1d100" / "1d20"），UI 据此决定显示 % 还是 +加值 */
  mainDice?: string;
  /** 描述加权给出的目标值修正量（正数＝更容易）；重掷时沿用 */
  bonus?: number;
}

/** 模型返回的同行者发言，单独渲染，不混进 GM 叙事 */
export interface NpcLine {
  id: string;
  name: string;
  action?: string;
  line?: string;
}

/**
 * 检定目标值的显示文案。
 *
 * 为什么要有它：目标值的含义随规则包而变——COC 的 d100 是"成功率百分比"，
 * DnD 的 d20 是"检定加值"。早期 UI 与引擎提示里写死了 `%`，
 * 换到 DnD 就会出现"目标值 +2%"这种自相矛盾的文案。
 */
export function checkTargetText(b: { target: number; mainDice?: string }): string {
  return b.mainDice === '1d20'
    ? `加值 ${b.target >= 0 ? '+' : ''}${b.target}`
    : `目标值 ${b.target}%`;
}

/** 守密人要求、等待玩家掷骰的检定 */
export interface PendingCheck {
  skill: string;
  difficulty?: string;
  reason?: string;
}

/** 主页面"状态变化"提示里的一行 */
export interface StateChangeLine {
  text: string;
  /** down = 变坏（掉血 / 掉理智 / 失去物品），up = 变好，info = 中性 */
  tone: 'down' | 'up' | 'info';
}

/**
 * 一轮结束后给玩家看的状态变化摘要。
 *
 * 为什么需要：状态栏（左侧角色卡）更新是"静默"的——玩家摔了一跤、
 * 血掉了 3 点，主页面完全没有提示，等发现时已经不知道是什么时候变的。
 */
export interface StateChangeNotice {
  id: string;
  ts: number;
  lines: StateChangeLine[];
}

/** 世界书条目。keys 命中时才注入提示词，避免撑爆上下文 */
export interface WorldbookEntry {
  id: string;
  keys: string[];
  content: string;
  /** 数值越大越优先，超预算时优先保留 */
  priority: number;
  enabled: boolean;
  /** 由「模组包」派生（重新生成时只替换这类，不动用户手写的） */
  fromModule?: boolean;
}

/**
 * 事件日志 —— 长期记忆的真相来源。
 *
 * 每轮只存一句客观事实（约 20 字），所以哪怕跑几百轮也塞得下。
 * 原文层会被裁剪，摘要层会丢细节，唯独这层从头保留到尾。
 */
export interface ChronicleEntry {
  turn: number;
  text: string;
  location?: string;
}

/**
 * 回合快照 —— 每个回合开始时的状态存档，供"回溯 / 重掷"使用。
 * 以触发该回合的玩家消息 id 为键。
 */
export interface TurnSnapshot {
  gameState: GameState;
  chronicle: ChronicleEntry[];
  summary: string;
  /**
   * 是否为**关键决策点**（回溯锚点）。
   * 普通快照是"每一回合都能退回去"，锚点是"值得退回去的那几个岔路口"——
   * 结档时玩家要从这里选从哪一步重来。
   */
  key?: boolean;
  /** 锚点的一句话说明（如"掷骰：潜行"、"进入战斗"、"受伤 -3"） */
  label?: string;
  /**
   * 这一回合结束时留下的待掷检定队列。
   * 回溯要能把它一起恢复，否则"GM 一次要了 2 个检定、掷了 1 个、想退回去重来"时，
   * 另一个检定就再也找不回来了（协作方 F）。
   */
  pendingChecks?: PendingCheck[];
}

/** 快照最多保留的回合数，超出的从最旧的开始丢 */
const SNAPSHOT_LIMIT = 60;

export interface Message {
  id: string;
  role: 'gm' | 'player' | 'system';
  content: string;
  dice?: DiceBadge[];
  check?: CheckBadge;
  /**
   * 一次行动里的多次检定（"一次全掷"）。
   * 保留 `check` 字段是为了兼容老存档与已有的渲染/重掷逻辑——
   * 单次检定仍然走 `check`，只有两次以上才用 `checks`。
   */
  checks?: CheckBadge[];
  npcLines?: NpcLine[];
  /** 该条 GM 回复配的动作场景小图（生图结果，可空） */
  sceneImage?: string;
  ts: number;
}

export interface ApiConfig {
  baseUrl: string;
  apiKey: string;
  model: string;
  temperature: number;
  maxTokens: number;
  /** 采样参数 top_p（0-1，空则用服务商默认） */
  topP?: number;
  /** 是否开启思考模式（DeepSeek enable_thinking），默认关 */
  thinking?: boolean;
  /** 生图模型（与对话模型分开），如硅基流动的 black-forest-labs/FLUX.1-schnell */
  imageModel?: string;
  /** 生图尺寸，如 1024x1024 */
  imageSize?: string;
}

/**
 * 角色卡
 *
 * 叙事层：对齐 SillyTavern Character Card V2 的字段命名
 * （description / personality / scenario / first_mes / mes_example）
 * 数值层：由规则包的 characteristicDefs + 技能表定义，换规则只换这一层
 */
export interface CharacterProfile {
  // —— 叙事层（V2）——
  name: string;
  /** 性别，用于推导称呼 */
  gender?: string;
  /** 描述：外貌、年龄、职业、来历，一段自然语言 */
  description: string;
  /** 性格 */
  personality: string;
  /** 对话示例（可选） */
  mes_example: string;
  /** 开局处境：开局时人在何处、正在做什么（V2 字段；也用作开局地点的兜底） */
  scenario?: string;

  // —— 数值层（规则驱动）——
  /** 属性，键由规则包的 characteristicDefs 决定（COC 是 str/con/…） */
  characteristics: Record<string, number>;
  /** 技能 */
  skills: Record<string, number>;
  /** 随身物品/装备（开团时会放进背包）。只存名字，供手改 */
  items?: string[];
  /**
   * 物品详情（AI 生成时一并产出）：名字 → 简介 / 类别 / 武器属性。
   * 手改物品只动 items，这里保留生成时的说明，开团时合并进背包。
   */
  itemDetails?: { name: string; desc?: string; kind?: string; damage?: string; skill?: string }[];

  // —— 应用内部 ——
  /** 他人如何称呼你；留空则按姓名 + 性别推导 */
  address?: string;
  /** 角色立绘（生图结果 URL / data URI） */
  portrait?: string;
}

const FEMALE_RE = /女|female|woman|girl|^f$/i;

/**
 * 从姓名 + 性别推一个得体的默认称呼。
 * 西式译名按"名字·姓氏"取最后一段作姓："艾伦·霍尔特" → "霍尔特先生"。
 * 单名直接用："卢卡斯" → "卢卡斯先生"。用户可随时手动改。
 */
export function deriveAddress(name: string, gender?: string): string {
  const honorific = FEMALE_RE.test((gender ?? '').trim()) ? '女士' : '先生';
  const n = name.trim();
  if (!n) return honorific;
  const parts = n.split(/[·・.\s]+/).filter(Boolean);
  const surname = parts.length > 1 ? parts[parts.length - 1]! : n;
  return `${surname}${honorific}`;
}

/** 取角色的称呼：优先用用户自定义的，没有就从姓名 + 性别推导 */
export function addressOf(c: CharacterProfile): string {
  return c.address?.trim() || deriveAddress(c.name, c.gender);
}

/**
 * 把模组/模型文本里残留的占位符替换成真实值。
 *
 * 为什么需要：模组开场白支持 `{{称呼}}` 占位符，但模型有时会把它**漏到状态里**
 * （用户报过"当前地点：{{称呼}}的公寓房间"）。凡是模型产出的文本进入
 * 显示或状态之前，都要过一遍这里。
 */
export function fillPlayerTokens(text: string, c: CharacterProfile): string {
  if (!text || !text.includes('{{')) return text;
  return text
    .replace(/\{\{\s*称呼\s*\}\}/g, addressOf(c))
    .replace(/\{\{\s*(name|玩家名|姓名|char)\s*\}\}/gi, c.name);
}

/** 一段文本里是否还残留占位符（用于"只在需要时才重建对象"的短路判断） */
function hasToken(text: string | undefined): boolean {
  return !!text && text.includes('{{');
}

/**
 * 把游戏状态里所有会**显示给玩家**的文本过一遍占位符替换。
 * 只在真的含 `{{` 时才重建对象，避免每轮都换新引用导致无谓重渲染。
 */
export function sanitizeStateTokens(s: GameState, c: CharacterProfile): GameState {
  const dirty =
    hasToken(s.location) ||
    s.npcsAlive.some(hasToken) ||
    s.clues.some(hasToken) ||
    s.inventory.some((i) => hasToken(i.name) || hasToken(i.desc) || hasToken(i.note)) ||
    Object.keys(s.flags).some(hasToken) ||
    Object.values(s.flags).some((v) => typeof v === 'string' && hasToken(v));
  if (!dirty) return s;
  const f = (t: string) => fillPlayerTokens(t, c);
  const flags: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(s.flags)) {
    flags[f(k)] = typeof v === 'string' ? f(v) : v;
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
  };
}

/** 模组里的关键人物。玩家只看到表面，动机与秘密是 GM 内部参考 */
export interface ModuleNpc {
  id: string;
  name: string;
  role: string;
  motive: string;
  secret: string;
}

/** 地图上的一个地点节点（空间信息的最小单位） */
export interface MapNode {
  name: string;
  /** 与之相通的地点名（无向；界面上连成线，表示"走得到"） */
  links?: string[];
  /** 一句话说明（如"码头区，夜里没人敢去"） */
  note?: string;
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

/**
 * 模组（团 / 剧本）—— 这一局"讲的是什么故事"。
 *
 * 注意：这**不是一份完整剧本，而是故事骨架**。AI 守密人会据此即兴生成
 * 场景、NPC 对白与线索；骨架的作用是保证几十轮不跑偏、不前后矛盾。
 * 世界书是它的细节层（关键词触发的设定条目），不是故事本身。
 */
export interface Module {
  /** 模组名 */
  title: string;
  /** 前言 / 引子：玩家听得到的开局背景 */
  premise: string;
  /** 开场白：第一幕的场景文本；留空则用内置场景模板 */
  opening: string;
  /** 真相：幕后到底发生了什么（**绝不可直接告知玩家**） */
  truth: string;
  /** 关键人物 */
  npcs: ModuleNpc[];
  /** 关键地点（一行一个） */
  locations: string;
  /**
   * 开局地点：第一幕玩家身处何处。开团时直接写进"当前地点"，
   * 避免开局面板空着、要玩家先动一下才刷新。留空则取 locations 第一行。
   */
  startLocation?: string;
  /**
   * 地图节点与可达关系（给"空间信息"用）：
   * 地点是节点，links 是与之相通的地点（无向）。界面上画成关系图，点节点即动身。
   * 留空则由 locations 自动生成节点（无连线）。
   */
  mapNodes?: MapNode[];
  /** 线索链：哪条线索通向哪里，防止卡关 */
  clueChain: string;
  /** 幕结构 / 推进节点 */
  acts: string;
  /** 结局与失败条件 */
  endings: string;
  /** GM 自由备注（内部） */
  notes: string;
  /**
   * 玩家目标：这个调查员在这个故事里**要达成什么**。
   * 回答"我要干嘛"——这是玩家最容易迷茫的一环，模组必须给出明确方向。
   */
  goal?: string;
  /** 赌注：不做、或失败会付出什么代价（给行动以重量） */
  stakes?: string;
  /** 紧迫感：为什么是现在，不能再等（推着玩家往前走，避免站着聊半天） */
  urgency?: string;
  /** 来源说明：这张卡是"按原版还原"还是"AI 自创"（生成时由模型诚实标注） */
  sourceNote?: string;
  /** 题材标签（内置模组用）：决定"选了某题材时，哪些模组最合适" */
  genre?: string;
  /**
   * 篇幅（决定时间尺度与地点/幕的数量）。
   *
   * 为什么要显式区分：早期不分篇幅，模型默认把"紧迫感"写成
   * 「只剩 15 分钟 / 天亮之前」——短篇合适，长篇就完全对不上：
   * 横跨几周的调查被塞进 15 分钟，玩家一出门就"时间到"。
   */
  scale?: ModuleScale;
  /**
   * 怪物 / 敌对者表（R38 的第一半）。
   *
   * 和道具表同一思路：**单独生成**。以前怪物的数值全靠模型临场发挥，
   * 同一个东西前后两轮血量、攻击方式都对不上，玩家打赢了也不知道赢在哪。
   * 定下来之后，数值是引擎的事实，模型照此演出。
   */
  monsters?: ModuleMonster[];
  /**
   * 道具表：**单独生成**的一张"这个模组里会出现的东西"清单（含作用）。
   *
   * 为什么和角色卡的个人物品分开：塞进角色生成里会让模型一次想太多东西，
   * 结果物品说明短、作用含糊、拾取后不知道能干嘛。分开生成准确率明显更高。
   */
  items?: ModuleItem[];
}

/** 模组篇幅（定义在 orchestrator/generate，这里只是再导出，避免 UI 反向依赖） */
export type { ModuleScale };

/**
 * 模组里的一个敌对者。**数值一旦定下就是事实**（引擎会拿它初始化 `combat.foes`），
 * 模型不得临场改。
 */
export interface ModuleMonster {
  id: string;
  name: string;
  /** 外观 / 气味 / 声音——玩家能感知到的东西 */
  look?: string;
  /** 生命值上限 */
  hp?: number;
  /** 攻击方式与伤害（如"爪击 1d6"） */
  attack?: string;
  /** 行为特点：怎么打、什么时候退、怕什么 */
  behavior?: string;
  /** 弱点 / 破解方式（这一条是给玩家的活路） */
  weakness?: string;
}

/** 模组道具表条目（作用由 AI 单独生成，玩家拿到就能看懂能干嘛） */
export interface ModuleItem {
  id: string;
  name: string;
  /** 一句话外观 / 来历 */
  look?: string;
  /** 作用：用掉它会怎样、检定时给什么便利 —— 这一条是玩家最需要的 */
  effect?: string;
  kind?: 'weapon' | 'tool' | 'clue' | 'consumable' | 'other';
}

const DEFAULT_MODULE: Module = {
  title: '失踪的玛乔丽',
  premise:
    '1924 年 3 月，马萨诸塞州。老霍华德的女儿玛乔丽已失踪十一天，警方认定她是自行离家。她从不离身的那台相机却留在了家里——这不合常理。老霍华德辗转找到你，因为他听说你处理过一些"不寻常的事"。',
  opening: '',
  truth:
    '玛乔丽并非离家出走。她在冲洗自己拍的照片时，无意间拍到了旧城区「圣烛照相馆」暗房里的一场仪式——那个圈子借冲洗的由头聚在暗房，做的却不是摄影的事。她带着底片想找人帮忙，随即被对方发现并扣下。老霍华德隐约知道女儿沾上了不该碰的东西，却不敢对警察开口。',
  npcs: [
    {
      id: 'mod-npc-1',
      name: '老霍华德',
      role: '委托人 / 工厂主',
      motive: '找回女儿，同时掩盖自己与那个圈子的旧交情',
      secret: '他早年给圣烛照相馆捐过钱，知道"暗房冲洗服务"是什么，却一直装作不知情。',
    },
    {
      id: 'mod-npc-2',
      name: '圣烛照相馆店主',
      role: '暗房主人',
      motive: '守住仪式的秘密，追回玛乔丽带走的底片',
      secret: '他不是唯一的主事者；真正的幕后另有其人，且从不见客。',
    },
  ],
  locations: '霍尔特的侦探事务所（接待室 / 盥洗室）\n旧城区 · 圣烛照相馆（门面 / 暗房）\n玛乔丽的公寓\n码头区的旧仓库',
  mapNodes: [
    { name: '事务所', links: ['旧城区', '玛乔丽的公寓'], note: '你的地盘，安全但没什么线索' },
    { name: '旧城区', links: ['事务所', '圣烛照相馆', '码头区'], note: '圣烛照相馆在这条街上' },
    { name: '圣烛照相馆', links: ['旧城区'], note: '门面正常，暗房在里间' },
    { name: '玛乔丽的公寓', links: ['事务所'], note: '已被翻动过' },
    { name: '码头区', links: ['旧城区'], note: '夜里没什么人' },
  ],
  clueChain:
    '盥洗室的血迹与刮痕 → 老霍华德知情却撒谎 → 玛乔丽遗留的相机里有未冲洗的胶卷 → 冲出的照片指向圣烛照相馆 → "暗房冲洗服务"是切口 → 暗房仪式 → 玛乔丽的下落',
  acts: '第一幕 · 接案与试探：委托人对真相有所隐瞒，玩家从细节里发现破绽。\n第二幕 · 追查：循着相机、底片与照片，线索指向旧城区。\n第三幕 · 暗房：进入圣烛照相馆，直面仪式与真相，做出选择。',
  endings:
    '成功：找到玛乔丽并带出证据（她可能已精神崩溃）。\n失败：证据被毁、玛乔丽失踪，或玩家自身理智耗尽。\n灰色：救出人但代价惨重，或与圈子达成某种交易。',
  notes: '基调：克制的悬疑与不安，不写血腥猎奇。让"相机 / 冲洗 / 影像"反复作为意象出现。',
  startLocation: '霍尔特的侦探事务所',
  // 注意：goal/stakes/urgency 只能写"玩家开局就知道的事"，绝不点破真相与关键物品——
  // 之前这里写了"胶卷""圣烛照相馆正在清理痕迹"，等于开局剧透。
  goal: '查出玛乔丽失踪的真相，把她带回家。',
  stakes: '她已失踪十一天，警方正准备以"自行离家"结案。一旦结案，就再没人会去找她了。',
  urgency:
    '失踪满两周，警局就会归档。老霍华德能给你的时间，只剩这几天。',
  genre: 'coc',
};

/** 第二套内置模组：雾港灯塔（可玩的成品模组） */
const MODULE_LIGHTHOUSE: Module = {
  title: '雾港灯塔',
  premise:
    '1922 年 11 月，缅因州雾港镇。入冬后，守塔人连续三晚没点灯，过往的货船差点触礁。镇议会请你去看看——报酬不多，但据说那塔里最近总能听见海雾里有人在唱歌。',
  opening: `海雾压得很低。你站在雾港镇的码头上，脚下的木板被潮气泡得发软。

渡船把你放在这里就匆匆开走了，说是"雾天不进港"。渔具店的灯还亮着，一个系围裙的女人正在收摊，看见你便停下手里的活。

"你也是来看灯塔的？"她打量你，"三晚没亮了。镇议会贴了告示，可没人敢去。"

远处海面上，那座灯塔的黑影一动不动。雾里传来一种很轻的声音，像有人在很远的地方哼歌。

她把卷帘门拉下一半，又停住。"先生，"她说，"天黑了就回客栈。晚上别往海边去。"`,
  truth:
    '守塔人不是失职，是被"海雾里的歌声"逼疯了。他半个月前在海滩上捡到一尊被海水泡得发绿的青铜小像，从此夜夜梦见海底的钟声。小像其实是"深潜者"信徒的祭器，会把持有者慢慢拖向海底。守塔人已经把塔顶的灯换成了信号，招引雾中的东西上岸。',
  npcs: [
    {
      id: 'lh-npc-1',
      name: '守塔人老马林',
      role: '灯塔看守',
      motive: '守住那尊青铜小像，完成"召唤"',
      secret: '他早已不是人了——夜里会走到礁石滩，对着海雾说话。',
    },
    {
      id: 'lh-npc-2',
      name: '米莉安',
      role: '镇上的渔具店老板娘',
      motive: '劝你赶紧离开这个镇子',
      secret: '她父亲就是十年前在灯塔上失踪的，她认得海雾里的歌声。',
    },
  ],
  locations: '雾港镇码头（渔具店 / 客栈）\n海边的老灯塔（塔底 / 塔顶灯室）\n礁石滩\n守塔人的小屋',
  mapNodes: [
    { name: '雾港码头', links: ['渔具店', '老灯塔'], note: '镇上的中心，白天有人' },
    { name: '渔具店', links: ['雾港码头'], note: '米莉安的店' },
    { name: '老灯塔', links: ['雾港码头', '礁石滩', '守塔人的小屋'], note: '三晚没点灯' },
    { name: '礁石滩', links: ['老灯塔'], note: '退潮时才走得过去' },
    { name: '守塔人的小屋', links: ['老灯塔'], note: '门窗紧闭' },
  ],
  clueChain:
    '灯塔为何不点灯 → 老马林形迹可疑、拒绝开门 → 小屋里的盐渍、湿脚印与青铜小像 → 米莉安认出歌声、说起十年前失踪的父亲 → 塔顶的灯被改装成信号 → 雾夜里的东西上岸 → 抉择',
  acts: '第一幕 · 登塔探访：雾港的怪谈与老马林的异常。\n第二幕 · 真相浮现：青铜小像、海雾歌声与十年前的旧案。\n第三幕 · 雾夜：信号已经发出，必须在天亮前做出选择。',
  endings:
    '成功：毁掉小像或让灯恢复原状，赶在雾散前救下守塔人（或给他一个了断）。\n失败：歌声把你拖向礁石滩，或雾中的东西登上了岸。\n灰色：你活着逃出雾港，但把"它"引到了别处。',
  notes: '基调：潮湿、咸腥、孤独的海雾。反复用"雾、盐、钟声、湿脚印"做意象。',
  startLocation: '雾港镇码头',
  goal: '查清灯塔为何停摆，找到守塔人，让雾夜里的船安全进港。',
  stakes: '今夜海雾最浓，灯若再不亮，下一班货船就会撞上礁石。',
  urgency: '天亮前有货船经过雾港，米莉安说海里的歌声一夜比一夜近——你只剩今晚。',
  sourceNote: '原创内置模组',
  genre: 'coc',
};

/**
 * 奇幻内置模组（配「剑与魔法」题材 + DnD 规则）。
 * 和 COC 模组一样是完整的一套：目标三件套、开局地点、地图关系，开箱即可跑。
 */
const MODULE_FANTASY: Module = {
  title: '枯井之约',
  premise:
    '铁砧镇是商道边上的一个小镇。入夏后，那口干了二十年的老井重新出水——喝过的人夜里会做同一个梦：有人在水底叫他们的名字。镇长悬赏查清水源的来历，赏金够你走完下一段路；够不够买你这条命，就不好说了。',
  opening: `铁砧镇的井台边围了一圈人。井绳湿漉漉地垂着，井口冒出的水腥气里混着一股说不清的甜味。

镇长是个矮胖的中年人。他把一袋定金塞进你手里，眼睛却不敢看那口井。

"三天里，已经有七个人做了同样的梦。"他压低声音，"梦里有人叫他们的名字。先生，我们不敢再喝了。"

井台另一头，一个披灰斗篷的年轻女人始终没说话。你注意到她的靴子——沾着的泥是镇子外围那片沼地的颜色。她去过不该去的地方。

围观的人都在等你开口。`,
  truth:
    '井底连通着沼地深处的一座封石神殿。神殿里封着一头"低语者"——它离不开水，却能顺着水脉把名字送进梦里。二十年前的大旱让它沉睡，如今地下水脉重新贯通，它醒了。灰斗篷女人瑟琳是神殿守誓者的后裔，一直在暗中试图重新封住水脉，但她需要有人替她下井。最早喝水的七个人，若在梦里被叫到名字时应了一声，就已经被"标记"了。而二十年前下令封井、把守誓者一家赶出镇子的，正是镇长的父亲。',
  npcs: [
    {
      id: 'fj-npc-1',
      name: '镇长·巴尔',
      role: '铁砧镇镇长 / 委托人',
      motive: '尽快压下井水的事，保住镇子和自己的位子',
      secret: '二十年前下令封井、并把守誓者一家赶出镇子的是他父亲；他知道井底有什么，却不敢说。',
    },
    {
      id: 'fj-npc-2',
      name: '瑟琳',
      role: '披灰斗篷的年轻女人 / 守誓者后裔',
      motive: '重新封住水脉，哪怕要拿喝过水的人做代价',
      secret: '她手里有一卷残缺的封石咒文，缺的正是最关键的一页——那一页在她叛逃的兄长手里。',
    },
    {
      id: 'fj-npc-3',
      name: '柯尔',
      role: '沼地里的猎手 / 瑟琳的兄长',
      motive: '把低语者放出来，用它换回被神殿夺走的一切',
      secret: '他已经应了梦里那个名字。',
    },
  ],
  locations:
    '铁砧镇（井台 / 镇长宅 / 铁匠铺）\n镇外的沼地\n沼地深处的封石神殿（外殿 / 水室）\n猎人的窝棚',
  mapNodes: [
    { name: '铁砧镇', links: ['沼地'], note: '井台边围满了人' },
    { name: '沼地', links: ['铁砧镇', '猎人的窝棚', '封石神殿'], note: '泥泞难行，夜里起雾' },
    { name: '猎人的窝棚', links: ['沼地'], note: '挂满风干的皮子' },
    { name: '封石神殿', links: ['沼地'], note: '大半没入水下' },
  ],
  clueChain:
    '井水发甜、带腥气 → 七人同梦、梦里被叫名字 → 镇长的父亲当年下令封井 → 斗篷女人靴上的沼地泥 → 沼地旧界碑（守誓者被除名） → 猎人的窝棚与缺失的那页咒文 → 封石神殿水室 → 低语者与"应名"的真相',
  acts:
    '第一幕 · 井台：接下委托，察觉镇长与斗篷女人各怀心事。\n第二幕 · 沼地：循着泥与界碑找到守誓者与叛逃的兄长，拿到咒文残页。\n第三幕 · 水室：下到井底神殿，在低语者彻底醒来前做出选择。',
  endings:
    '成功：补全咒文重新封石，井水变回死水，做过梦的人一夜之间忘了那个名字。\n失败：有人应了名字，低语者顺着水脉进入镇上的每一口井。\n灰色：封住了井，却把低语者引向沼地另一侧的村子。',
  notes: '基调：潮湿、甜腥、慢性的不安。反复用"水、名字、回声、泥"做意象。',
  startLocation: '铁砧镇',
  goal: '查清井水为何重新出水，在更多人做同一个梦之前把水源的事解决掉。',
  stakes: '已经有七个人做了同样的梦。若有人应了梦里那一声，就不只是做梦那么简单了。',
  urgency: '今夜是第七夜——梦里叫名字的声音，一夜比一夜清楚。',
  sourceNote: '原创内置模组',
  genre: 'fantasy',
};

/** 内置模组库：开新团时可一键套用 */
export const BUILTIN_MODULES: Module[] = [DEFAULT_MODULE, MODULE_LIGHTHOUSE, MODULE_FANTASY];

/**
 * 示例角色：每个题材一份，供"开箱即玩"（不用先想人设）。
 * 只管叙事层；数值层在套用时按当前规则包重建，避免和规则对不上。
 */
export const STARTER_CHARACTERS: Record<string, Partial<CharacterProfile>> = {
  coc: {
    name: '艾伦·霍尔特',
    gender: '男',
    description:
      '34 岁，私家侦探，曾是战地记者，左腿落下旧伤。常穿一件洗得发白的风衣，随身带着一台禄来福来双反相机。',
    personality:
      '沉默寡言，观察力强。因三年前一桩始终没查清的失踪案，他对"无法解释的事"有近乎偏执的兴趣。',
    scenario: '深夜，你独自在事务所整理卷宗，门外传来迟疑的敲门声。',
    items: ['笔记本', '.38 左轮手枪', '禄来福来双反相机', '手电筒'],
    itemDetails: [
      { name: '笔记本', desc: '记录案子的随身本，边角磨得起了毛。', kind: 'clue' },
      {
        name: '.38 左轮手枪',
        desc: '警用制式左轮，六发装填，握把缠了防滑胶带。',
        kind: 'weapon',
        damage: '1d10',
        skill: '射击（手枪）',
      },
      { name: '禄来福来双反相机', desc: '从战地一起带回来的老相机，还能用。', kind: 'tool' },
      { name: '手电筒', desc: '黄铜外壳的旧手电，光有点发黄但照得远。', kind: 'tool' },
    ],
  },
  tokyo: {
    name: '佐仓真白',
    gender: '女',
    description:
      '24 岁，自由撰稿人，专写都市怪谈与失踪案。总背着一个塞满录音笔的旧帆布包，眼睛常年熬得发红。',
    personality:
      '嘴上大大咧咧、爱开玩笑，其实比谁都怕黑。收集别人的故事，是为了不去想自己那一件。',
    scenario: '凌晨一点，你在便利店门口等人，手机里那条读者私信还亮着：别去那栋公寓。',
    items: ['录音笔', '旧帆布包', '数码相机', '罐装咖啡'],
    itemDetails: [
      { name: '录音笔', desc: '采访用的小录音笔，能连续录十几个小时。', kind: 'tool' },
      { name: '旧帆布包', desc: '塞满备用电池和稿纸的帆布包，侧袋里藏着一把折叠伞。', kind: 'tool' },
      { name: '数码相机', desc: '二手单反，闪光灯坏了，白天拍得清楚。', kind: 'tool' },
      { name: '罐装咖啡', desc: '便利店买的黑咖啡，一口下去能再撑两小时。', kind: 'consumable' },
    ],
  },
  fantasy: {
    name: '凯尔·渡鸦',
    gender: '男',
    description:
      '29 岁的流浪剑客，前王国斥候，因违抗命令被除名。一身磨损的皮甲，左手小指缺了一截，背着一把用旧了的长剑。',
    personality:
      '话不多，但答应的事一定做到。讨厌贵族和神棍，对钱却算得很清楚——因为欠着债。',
    scenario: '你在铁砧镇的酒馆里啃着干面包，盘算着赏金还差多少能还清那笔债。',
    items: ['用旧的长剑', '磨损的皮甲', '干粮', '一枚褪色的雇兵徽章'],
    itemDetails: [
      {
        name: '用旧的长剑',
        desc: '剑刃上满是修磨的痕迹，握柄缠着旧布条，重心很顺手。',
        kind: 'weapon',
        damage: '1d8+2',
        skill: '格斗（斗殴）',
      },
      { name: '磨损的皮甲', desc: '前胸有一道没补好的裂口，但还能挡几下。', kind: 'tool' },
      { name: '干粮', desc: '硬得能敲桌子的黑面包和一条肉干。', kind: 'consumable' },
      { name: '一枚褪色的雇兵徽章', desc: '你不想再戴却一直没扔的旧徽章。', kind: 'clue' },
    ],
  },
  acg: {
    name: '神代遥',
    gender: '女',
    description:
      '17 岁，高二学生，文艺部部员，有点近视。总把校服袖口拉到手心，书包上挂着一整串没什么用的挂件。',
    personality:
      '嘴硬心软，遇事爱吐槽但从不缺席。对"讲不通的事"有种不服输的执拗。',
    scenario: '放课后的活动室只剩你一个人，窗外天色暗得比平时早。',
    items: ['书包', '手机', '文艺部活动记录本', '一盒薄荷糖'],
    itemDetails: [
      { name: '书包', desc: '挂着整串没用的挂件，侧袋里塞着伞和充电宝。', kind: 'tool' },
      { name: '手机', desc: '屏幕角上贴了防摔膜，聊天记录里存着那几条怪事。', kind: 'tool' },
      { name: '文艺部活动记录本', desc: '部里传下来的旧本子，最后几页的字迹不是部员的。', kind: 'clue' },
      { name: '一盒薄荷糖', desc: '提神用，还剩小半盒。', kind: 'consumable' },
    ],
  },
  urban: {
    name: '江临',
    gender: '男',
    description:
      '23 岁，无业，靠接些"处理麻烦"的私活过活。能短暂强化自己的速度和反应，但用多了会流鼻血。左耳戴着一只从不摘的旧耳机。',
    personality:
      '表面吊儿郎当、爱贫嘴，真到要紧关头比谁都冷静。讨厌"组织"和说教，却对街上无家可归的孩子格外心软。',
    scenario: '凌晨的便利店，你盯着货架发呆，手机里那条匿名消息又亮了：今晚别坐 7 号线。',
    items: ['旧耳机', '手机', '一次性打火机', '便利店饭团'],
    itemDetails: [
      { name: '旧耳机', desc: '左耳那只从没摘下来过，线皮已经开胶。', kind: 'tool' },
      { name: '手机', desc: '屏幕右上角碎了一小块，那条匿名消息还在。', kind: 'tool' },
      { name: '一次性打火机', desc: '便利店顺手拿的，火苗忽大忽小。', kind: 'tool' },
      { name: '便利店饭团', desc: '刚买的，还温着。', kind: 'consumable' },
    ],
  },
};

/** 取某个题材的示例角色（没有就返回 undefined） */
export function starterCharacterOf(genreId: string): Partial<CharacterProfile> | undefined {
  return STARTER_CHARACTERS[genreId];
}

const DEFAULT_CONFIG: ApiConfig = {
  baseUrl: 'https://api.deepseek.com/v1',
  apiKey: '',
  model: 'deepseek-chat',
  temperature: 0.9,
  // 留足余量：若输出被 max_tokens 截断，尾部 JSON 契约会残缺，状态就同步不了
  maxTokens: 3072,
};

/** 属性默认值由规则包提供，换规则就自动换一套属性 */
export function defaultCharacteristics(rulesetId = 'coc7'): Record<string, number> {
  return Object.fromEntries(
    getRuleset(rulesetId).characteristicDefs.map((d) => [d.key, d.default])
  );
}

/**
 * 常见技能别名 —— 模型与老档里写过的非规范名，映射到规则包技能表里的标准名。
 *
 * 为什么需要：`skillCatalog` 里叫「射击（手枪）」「图书馆使用」，
 * 但模型（和老角色卡）经常写成「手枪」「图书馆学」。
 * 名字对不上，就查不到基础值、算不准技能点预算，未受训技能还会被兜底成 50%。
 */
export const SKILL_ALIAS: Record<string, string> = {
  手枪: '射击（手枪）',
  左轮: '射击（手枪）',
  射击: '射击（手枪）',
  步枪: '射击（步枪/霰弹枪）',
  霰弹枪: '射击（步枪/霰弹枪）',
  图书馆学: '图书馆使用',
  图书馆: '图书馆使用',
  侦察: '侦查',
  聆听: '聆听',
  急救术: '急救',
  医疗: '医学',
  电脑使用: '计算机使用',
  电子学: '电子学',
  母语: '母语',
  外语: '外语（其他）',
  攀爬: '攀爬',
  闪避: '闪避',
  驾驶: '汽车驾驶',
};

/** 把技能名规范化成规则包里的标准名（找不到就原样返回） */
export function canonicalSkillName(name: string, rs: ReturnType<typeof getRuleset>): string {
  const key = name.trim();
  const aliased = SKILL_ALIAS[key] ?? key;
  if (rs.skillCatalog.some((s) => s.name === key)) return key;
  if (rs.skillCatalog.some((s) => s.name === aliased)) return aliased;
  // 再退一步：包含关系（"手枪" ⊂ "射击（手枪）"）
  const partial = rs.skillCatalog.find((s) => s.name.includes(key) || key.includes(s.name));
  return partial?.name ?? aliased;
}

/**
 * 按"技能名 或 属性键/中文标签"解析检定目标值。
 *
 * 技能查表的顺序是**角色卡的技能 → 规则包技能表的基础值 → 属性**。
 * 中间这一步很关键：角色卡里没写「游泳」，不代表不能游泳——
 * 规则包里「游泳」的基础值是 20%，未受训就按基础值掷，
 * 而不是兜底成 50%（那等于白送 30 个百分点）。
 *
 * 找不到返回 null（调用方自行决定回退值）。
 */
export function resolveCheckTarget(
  name: string,
  character: CharacterProfile,
  rs: ReturnType<typeof getRuleset>
): number | null {
  const key = name.trim();
  if (character.skills[key] != null) return character.skills[key];
  // 别名/规范名再查一次角色卡（"手枪" → 卡里可能存的是"射击（手枪）"）
  const canon = canonicalSkillName(key, rs);
  if (canon !== key && character.skills[canon] != null) return character.skills[canon];
  // 规则包技能表的基础值：未受训也能掷，只是低
  const sk = rs.skillCatalog.find((s) => s.name === canon || s.name === key);
  if (sk) return sk.base;
  const ch = character.characteristics;
  if (ch[key] != null) return ch[key];
  // 属性可能用中文标签（"力量"→str），或反过来用键
  const def = rs.characteristicDefs.find((d) => d.label === key || d.key === key);
  if (def && ch[def.key] != null) return ch[def.key] ?? null;
  return null;
}

/**
 * 技能点预算（COC 7e）：职业技能点 = 教育×4，兴趣点 = 智力×2。
 * 每个技能的"投入点数"＝技能值 − 基础值（基础值从标准技能表查，查不到按 0）。
 * 已用超过预算就不能再加点。
 */
export function skillBudget(
  character: CharacterProfile,
  rulesetId: string
): { total: number; spent: number; remaining: number } {
  const rs = getRuleset(rulesetId);
  const edu = character.characteristics.edu ?? 50;
  const int = character.characteristics.int ?? 50;
  const total = edu * 4 + int * 2;
  // 名字要先规范化，否则"手枪"查不到「射击（手枪）」的基础值，
  // 会把 20 点基础当成投入点数，预算直接算错。
  const baseMap = new Map(rs.skillCatalog.map((s) => [s.name, s.base]));
  let spent = 0;
  for (const [name, value] of Object.entries(character.skills)) {
    const base = baseMap.get(canonicalSkillName(name, rs)) ?? 0;
    spent += Math.max(0, value - base);
  }
  return { total, spent, remaining: total - spent };
}

const DEFAULT_CHARACTER: CharacterProfile = {
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

export type ThemeName = 'midnight' | 'ash' | 'parchment';

/** 正文排版设置 */
export interface Typography {
  /** 正文缩放（0.9 – 1.4） */
  scale: number;
  /** 行距倍数（1.5 – 2.4） */
  lineHeight: number;
  /** 首行缩进两字 */
  indent: boolean;
}

export const TYPOGRAPHY_PRESETS: { id: string; name: string; value: Typography }[] = [
  { id: 'compact', name: '紧凑', value: { scale: 0.95, lineHeight: 1.65, indent: false } },
  { id: 'standard', name: '标准', value: { scale: 1, lineHeight: 1.9, indent: false } },
  { id: 'loose', name: '宽松', value: { scale: 1.08, lineHeight: 2.1, indent: false } },
  { id: 'book', name: '书卷', value: { scale: 1.05, lineHeight: 2, indent: true } },
];

const DEFAULT_TYPOGRAPHY: Typography = TYPOGRAPHY_PRESETS[1]!.value;

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

const DEFAULT_WORLDBOOK: WorldbookEntry[] = [
  {
    id: 'sample-town',
    keys: ['敦威治', '小镇', '邓里奇'],
    content:
      '马萨诸塞州北部的小镇，人口不足四百。1890 年代起便有关于"山那边"的传闻，居民对外人沉默而警惕。镇上有一间杂货铺、一座浸礼会教堂，以及一间常年落锁的旧校舍。',
    priority: 50,
    enabled: true,
  },
];

function loadWorldbook(): WorldbookEntry[] {
  try {
    const raw = localStorage.getItem('trpg.worldbook');
    if (raw) return JSON.parse(raw) as WorldbookEntry[];
  } catch {
    /* 忽略损坏数据 */
  }
  return DEFAULT_WORLDBOOK;
}

function loadJson<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    if (raw) return JSON.parse(raw) as T;
  } catch {
    /* 忽略损坏数据 */
  }
  return fallback;
}

function saveJson(key: string, value: unknown): void {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch (e) {
    console.warn(`[跑团] 持久化 ${key} 失败（可能超出存储配额）`, e);
  }
}

/**
 * 消息在流式输出期间每几百毫秒就变一次，每次都全量序列化整个数组会把主线程卡住。
 * 这里做节流：流式期间最多每 800ms 落盘一次。
 */
let saveTimer: ReturnType<typeof setTimeout> | null = null;
function scheduleSaveMessages(get: () => Store): void {
  if (saveTimer) clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    saveTimer = null;
    saveJson('trpg.messages', get().messages);
  }, 800);
}

function loadMessages(): Message[] {
  const opening = openingText(loadCharacter(), loadModule(), loadGenreId());
  const saved = loadJson<Message[] | null>('trpg.messages', null);
  if (Array.isArray(saved) && saved.length > 0) {
    // 迁移：早期开场白是写死的，这里按当前角色卡 + 模组同步一次
    return saved.map((m) => (m.id === WELCOME_ID ? { ...m, content: opening } : m));
  }
  return [{ id: WELCOME_ID, role: 'gm', content: opening, ts: Date.now() }];
}

function loadGameState(): GameState {
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
    return reconcileVitals(saved, loadCharacter(), rid);
  }
  return createInitialState({
    vitals: { hp: 12, san: 70, mp: 14 },
    vitalsMax: { hp: 12, san: 99, mp: 14 },
    // 开团不带任何队友：队友只能来自模组包候选或玩家自己招募
    companions: [],
    inventory: [
      { id: 'camera', name: '禄来福来双反相机', qty: 1 },
      { id: 'revolver', name: '.38 左轮手枪', qty: 1 },
      { id: 'notebook', name: '牛皮纸笔记本', qty: 1 },
    ],
    flags: {},
    clues: [],
    location: '霍尔特的侦探事务所',
    npcsAlive: ['委托人：老霍华德'],
  });
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

const WELCOME_ID = 'welcome';

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

/** 开局地点：优先模组的 startLocation，其次地点表第一行 */
export function initialLocation(m: Module, c?: CharacterProfile): string {
  const explicit = m.startLocation?.trim();
  const raw = explicit || m.locations?.split('\n').map((s) => s.trim()).filter(Boolean)[0] || '';
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
 * 各题材的兜底开场白（模组没写 opening 时用）。
 *
 * 为什么不能只有一个：内置兜底原来写死了"1924 年 / 老霍华德"，
 * 拿它去开一个奇幻或校园模组会非常出戏。
 */
const FALLBACK_OPENINGS: Record<string, (c: CharacterProfile) => string> = {
  coc: (c) => `这是一间没有窗户的接待室。壁炉里的火早就熄了，空气里残留着冷烟草和旧纸的味道。

坐在你对面的老人把一份卷宗推过来，指节发白。

"${addressOf(c)}，我女儿失踪十一天了。警察说她是自己走的。"他停顿了一下，"但她从不会不带上那台相机。"

卷宗封面上的日期是——**1924 年 3 月 7 日**。`,
  tokyo: () => `手机在兜里震了一下，是读者发来的私信，只有一行字：别去那栋公寓。

你抬头。那栋楼就在街对面，六层，外墙的瓷砖掉了大半，三楼那扇窗户亮着灯——你记得很清楚，这栋楼三年前就封了。

末班电车从身后驶过，卷起一阵风。站台上只剩你一个人。

雨开始下了。`,
  acg: () => `放课后的活动室只剩下你一个人。夕阳把黑板照成暖橘色，走廊里还有社团收拾东西的动静。

你手机亮了一下，是群里的消息：「明天的事，真的要去吗？」

窗外，天暗得比平时早。`,
  pink: () => `雨还在下。你站在车站的屋檐下，看着水在台阶上汇成一小股，流进下水口。

她撑着一把透明的伞走过来，在你半步远的地方停下。

"……你没带伞啊。"她说，顿了一下，"那，一起走吧。伞小了点。"

伞面往你这边偏了偏。`,
  fantasy: () => `酒馆的门被风吹开又合上。火塘里的柴噼啪响了两声。

你把最后一块干面包咽下去，盘算着口袋里的银币还够走几天。

对面的桌子旁，一个披灰斗篷的人一直没动，只是看着你。你注意到对方的靴子上沾着泥——镇子外围那片沼地的泥。`,
};

/**
 * 开场白 —— 属于模组（第一幕），不是角色卡。
 * 模组里填了 opening 就用它；否则用当前题材的兜底场景，并按"称呼"填充。
 */
function openingText(c: CharacterProfile, m: Module, genreId = 'coc'): string {
  const raw = m.opening?.trim();
  const body = raw
    ? // 模组开场里可用 {{称呼}} / {{name}} 指代玩家
      raw
        .replace(/\{\{\s*称呼\s*\}\}/g, addressOf(c))
        .replace(/\{\{\s*name\s*\}\}/gi, c.name)
    : (FALLBACK_OPENINGS[genreId] ?? FALLBACK_OPENINGS.fantasy ?? FALLBACK_OPENINGS.coc!)(c);

  // 把"我要干嘛"直接摆到玩家眼前——这是最容易让人卡住的一环，不能只靠侧栏
  if (!m.goal?.trim()) return body;
  const lines = [`> **你要做的事**：${m.goal.trim()}`];
  if (m.stakes?.trim()) lines.push(`> **赌注**：${m.stakes.trim()}`);
  if (m.urgency?.trim()) lines.push(`> **时间**：${m.urgency.trim()}`);
  return `${body}\n\n${lines.join('\n')}`;
}

function loadTheme(): ThemeName {
  const t = localStorage.getItem('trpg.theme');
  return t === 'ash' || t === 'parchment' ? t : 'midnight';
}

function loadRulesetId(): string {
  const id = localStorage.getItem('trpg.rulesetId');
  // 只有注册过的规则包 id 才算数，否则回退 COC
  return id && listRulesets().some((r) => r.id === id) ? id : 'coc7';
}

/** 自建/导入的题材（存 localStorage，和内置题材合并使用） */
export function loadCustomGenres(): Genre[] {
  const list = loadJson<Genre[]>('trpg.customGenres', []);
  return Array.isArray(list) ? list.filter((g) => g?.id && g?.name) : [];
}

function loadGenreId(): string {
  const id = localStorage.getItem('trpg.genreId');
  return id && listGenres(loadCustomGenres()).some((g) => g.id === id) ? id : 'coc';
}

function loadTypography(): Typography {
  try {
    const raw = localStorage.getItem('trpg.typography');
    if (raw) return { ...DEFAULT_TYPOGRAPHY, ...JSON.parse(raw) };
  } catch {
    /* 忽略 */
  }
  return DEFAULT_TYPOGRAPHY;
}

function loadConfig(): ApiConfig {
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
function migrateCharacter(p: Record<string, unknown>): CharacterProfile {
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

function loadCharacter(): CharacterProfile {
  return mergeCharacter(localStorage.getItem('trpg.character'));
}

/**
 * 解析模组存档，兼容早期结构（只有 title/premise/opening/outline）。
 *
 * 老存档缺的新字段一律给空，而**不是**套 DEFAULT_MODULE ——
 * 否则会把默认模组的剧情内容混进用户自己的模组里。
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
    };
  } catch {
    return DEFAULT_MODULE;
  }
}

function loadModule(): Module {
  // 读盘时也过一遍占位符：老存档里可能残留 {{称呼}}
  return sanitizeModuleTokens(mergeModule(localStorage.getItem('trpg.module')), loadCharacter());
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

interface Store {
  messages: Message[];
  gameState: GameState;
  config: ApiConfig;
  character: CharacterProfile;
  /** 模组（团）：这一局讲的是什么故事 */
  module: Module;
  rulesetId: string;
  /** 题材预设：决定守密人写法、画风、模组与队友倾向（与规则包正交） */
  genreId: string;
  /** 自建/导入的题材（内置题材之外） */
  customGenres: Genre[];
  streaming: boolean;
  panel: 'chat' | 'character' | 'world';
  theme: ThemeName;
  worldbook: WorldbookEntry[];
  chronicle: ChronicleEntry[];
  /** 远期剧情压缩后的段落，摘要层 */
  summary: string;
  /** 回合快照表：玩家消息 id → 回合开始时的状态 */
  snapshots: Record<string, TurnSnapshot>;
  /** 「模组包」生成的队友候选，等玩家挑谁入队 */
  companionCandidates: Companion[];
  /** 场景立绘：地点 → 图片（存 IndexedDB，避免 localStorage 超配额丢图） */
  sceneImages: Record<string, string>;
  /** 剧情消息上的动作小图：消息 id → 图片（同样存 IndexedDB） */
  messageImages: Record<string, string>;
  /** 地图总览图（data URI，存 IndexedDB） */
  mapImage: string;
  /**
   * 守密人要求的、等待玩家掷骰的检定。
   *
   * 为什么是队列：一轮里守密人可能同时要求多个检定（如"潜行"与"聆听"）。
   * 早期只取 `dice_requests[0]`，后面的请求会被整个丢掉——玩家永远掷不到。
   */
  pendingChecks: PendingCheck[];
  /** 最近一轮的状态变化摘要，主页面用它弹提示 */
  lastChanges: StateChangeNotice | null;
  /** 正文排版设置 */
  typography: Typography;
  /** 音频设置（氛围音 / 自配 BGM / 判定音效） */
  audio: AudioConfig;

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
  setSceneImage(location: string, url: string): void;
  /** 给某条 GM 回复挂/删一张动作场景小图 */
  setMessageSceneImage(msgId: string, url: string): void;
  /** 设置 / 清除地图总览图 */
  setMapImage(url: string): void;
  /** 启动时把 IndexedDB 里的图片读回内存（异步，故不能放在初始化里） */
  hydrateImages(): Promise<void>;
  /** 覆盖整条待掷检定队列（守密人一次要求多个时用） */
  setPendingChecks(list: PendingCheck[]): void;
  /** 掷掉队列里的第 index 个 */
  removePendingCheck(index: number): void;
  /** 清空整条队列 */
  clearPendingChecks(): void;
  /** 清掉主页面的状态变化提示 */
  clearChanges(): void;
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
  /** 更新音频设置（会同步启动/停止氛围音与 BGM） */
  setAudio(patch: Partial<AudioConfig>): void;
  addChronicle(text: string, location?: string): void;
  /** 把前若干条日志压成摘要，剩下的保留为明细 */
  foldChronicle(keepFrom: number, summary: string): void;
  clearProgress(): void;
  /** 用当前的模组 + 角色卡开一团新游戏：清空剧情与进度，重新生成开场 */
  startNewGame(): void;

  /** 本地掷骰（不经过模型） */
  rollExpression(expr: string): DiceBadge;
  /** 技能检定：本地掷骰 + 规则包判定 */
  /**
   * 掷一次技能检定。
   * `bonus` 是描述加权给出的目标值修正量（正数＝更容易），由引擎在**掷骰之前**加进目标值，
   * 所以判定、成功率与结果标签都是一致的 —— 不是事后改数。
   */
  skillCheck(skill: string, difficulty?: 'regular' | 'hard' | 'extreme', bonus?: number): CheckBadge;
  /** 应用模型返回的状态变更 */
  applyModelDeltas(deltas: StateDelta[]): void;
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
   */
  forceEnding(kind: Ending['kind']): void;
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

export interface SaveFile {
  version: number;
  exportedAt: string;
  character: CharacterProfile;
  module?: Module;
  gameState: GameState;
  messages: Message[];
  chronicle?: ChronicleEntry[];
  summary?: string;
  worldbook?: WorldbookEntry[];
  /**
   * 队友候选（准备页「同行者」里那些还没入队的）。
   * 早先它只活在当前浏览器的 localStorage 里，任何换档 / 导档 / 清缓存都会丢——
   * 玩家看到的就是"准备页的同行者不见了"。
   */
  companionCandidates?: Companion[];
  snapshots?: Record<string, TurnSnapshot>;
}

/**
 * 存档结构版本号。
 *
 * 改动存档结构时把它 +1，并在 `migrateSave` 里补一条迁移 ——
 * 否则玩家读旧档时会因为缺字段而报错，看起来就像"存档坏了"。
 */
export const SAVE_VERSION = 3;

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
    if (!gs.flags || typeof gs.flags !== 'object') gs = { ...gs, flags: {} };
    // 濒死标记与结档信息是后加的
    if (typeof gs.dying !== 'boolean') gs = { ...gs, dying: false };
    if (gs.ending === undefined) gs = { ...gs, ending: null };
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
const MERGE_MODULE_DEFAULTS: Module = {
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
  pendingChecks: [],
  lastChanges: null,
  typography: loadTypography(),
  audio: loadAudioConfig(),

  addMessage(m) {
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
    saveJson('trpg.messages', []);
    saveJson('trpg.snapshots', {});
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
    // 清掉已被删除消息的快照，并按回合数上限裁剪（丢最旧的）
    const alive = new Set(s.messages.map((m) => m.id));
    const entries = Object.entries(next).filter(([k]) => alive.has(k));
    while (entries.length > SNAPSHOT_LIMIT) entries.shift();
    const pruned = Object.fromEntries(entries);
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

  forceEnding(kind) {
    const gs: GameState = {
      ...get().gameState,
      dying: false,
      ending: { kind, text: '', at: new Date().toISOString() },
    };
    saveJson('trpg.gameState', gs);
    set({ gameState: gs });
  },

  setEnding(kind, text) {
    const s = get();
    const ending: Ending = { kind, text: text.trim(), at: new Date().toISOString() };
    const gameState: GameState = { ...s.gameState, ending };
    saveJson('trpg.gameState', gameState);
    set({ gameState });
  },

  clearEnding() {
    const s = get();
    if (!s.gameState.ending) return;
    const gameState: GameState = { ...s.gameState, ending: null, dying: false };
    saveJson('trpg.gameState', gameState);
    set({ gameState });
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
    saveJson('trpg.messages', kept);
    saveJson('trpg.gameState', gameState);
    saveJson('trpg.chronicle', chronicle);
    saveJson('trpg.summary', summary);
    saveJson('trpg.snapshots', snapshots);
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
    });
  },

  setConfig(patch) {
    const next = { ...get().config, ...patch };
    localStorage.setItem('trpg.config', JSON.stringify(next));
    set({ config: next });
  },

  setRuleset(id) {
    const rs = getRuleset(id);
    localStorage.setItem('trpg.rulesetId', id);
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
    localStorage.setItem('trpg.character', JSON.stringify(nextChar));
    saveJson('trpg.gameState', gameState);
    set({ rulesetId: id, character: nextChar, gameState });
  },

  setGenre(id) {
    localStorage.setItem('trpg.genreId', id);
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
    localStorage.setItem('trpg.character', JSON.stringify(next));
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

  setModule(patch) {
    const next = sanitizeModuleTokens({ ...get().module, ...patch }, get().character);
    saveJson('trpg.module', next);
    set({ module: next });
    // 开场白属于模组（第一幕），改了要同步首条消息
    if (patch.opening !== undefined) {
      const opening = openingText(get().character, next, get().genreId);
      const messages = get().messages.map((m) =>
        m.id === WELCOME_ID ? { ...m, content: opening } : m
      );
      saveJson('trpg.messages', messages);
      set({ messages });
    }
  },

  setStreaming: (v) => set({ streaming: v }),
  setPanel: (p) => set({ panel: p }),

  upsertWorldbookEntry(e) {
    const list = get().worldbook;
    const idx = list.findIndex((x) => x.id === e.id);
    const next = idx >= 0 ? list.map((x) => (x.id === e.id ? e : x)) : [...list, e];
    localStorage.setItem('trpg.worldbook', JSON.stringify(next));
    set({ worldbook: next });
  },

  removeWorldbookEntry(id) {
    const next = get().worldbook.filter((x) => x.id !== id);
    localStorage.setItem('trpg.worldbook', JSON.stringify(next));
    set({ worldbook: next });
  },

  setWorldbookEntries(list) {
    localStorage.setItem('trpg.worldbook', JSON.stringify(list));
    set({ worldbook: list });
  },

  /**
   * 清掉"由 AI 生成的世界书条目"（`fromModule`）。
   *
   * 这是 N6 的手动入口：世界书在跨档读档时取并集，不同模组的条目会累积，
   * 需要一个手动清理的口子。用户手写的条目与内置示例条目**不动**。
   */
  clearModuleWorldbook() {
    const kept = get().worldbook.filter((e) => !e.fromModule);
    localStorage.setItem('trpg.worldbook', JSON.stringify(kept));
    set({ worldbook: kept });
  },

  /**
   * **换模组**时调用：清掉属于"上一个模组"的派生数据（世界书 fromModule 条目 + 队友候选）。
   *
   * 触发点只有这一个（AI 生成模组 / 贴文本导入 / 应用整套预设），
   * 开新团与读档都**不**清——它们不换模组（协作方 N2）。
   */
  setDevMode(on) {
    localStorage.setItem('trpg.devMode', on ? '1' : '0');
    set({ devMode: on });
  },

  setModuleItems(list) {
    const s = get();
    const module: Module = { ...s.module, items: list };
    saveJson('trpg.module', module);
    set({ module });
  },

  devMode: localStorage.getItem('trpg.devMode') === '1',

  clearModuleDerived() {
    const kept = get().worldbook.filter((e) => !e.fromModule && !e.id.startsWith('sample-'));
    localStorage.setItem('trpg.worldbook', JSON.stringify(kept));
    saveJson('trpg.companionCandidates', []);
    set({ worldbook: kept, companionCandidates: [] });
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
    void idbSet('sceneImages', next);
  },

  setMessageSceneImage(msgId, url) {
    const next = { ...get().messageImages };
    if (url) next[msgId] = url;
    else delete next[msgId];
    set({ messageImages: next });
    void idbSet('messageImages', next);
    // 老数据可能把图直接塞在消息里，顺手清掉，避免消息数组被 base64 撑爆
    const messages = get().messages.map((m) =>
      m.id === msgId && m.sceneImage ? { ...m, sceneImage: undefined } : m
    );
    if (messages.some((m) => m.id === msgId && !m.sceneImage)) {
      saveJson('trpg.messages', messages);
      set({ messages });
    }
  },

  setMapImage(url) {
    set({ mapImage: url });
    void idbSet('mapImage', url);
  },

  async hydrateImages() {
    const [sceneImages, messageImages, mapImage] = await Promise.all([
      idbGet<Record<string, string>>('sceneImages'),
      idbGet<Record<string, string>>('messageImages'),
      idbGet<string>('mapImage'),
    ]);
    const patch: Partial<Store> = {
      sceneImages: sceneImages ?? {},
      messageImages: messageImages ?? {},
      mapImage: mapImage ?? '',
    };
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

  setTypography(patch) {
    const next = { ...get().typography, ...patch };
    saveJson('trpg.typography', next);
    set({ typography: next });
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
    localStorage.setItem('trpg.chronicle', JSON.stringify(next));
    set({ chronicle: next });
  },

  foldChronicle(keepFrom, summary) {
    const next = get().chronicle.slice(keepFrom);
    localStorage.setItem('trpg.chronicle', JSON.stringify(next));
    localStorage.setItem('trpg.summary', JSON.stringify(summary));
    set({ chronicle: next, summary });
  },

  clearProgress() {
    localStorage.removeItem('trpg.chronicle');
    localStorage.removeItem('trpg.summary');
    set({ chronicle: [], summary: '' });
  },

  startNewGame() {
    const s = get();
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
      visited: (() => {
        const here = initialLocation(s.module, s.character).trim();
        return here ? [here] : [];
      })(),
    });
    saveJson('trpg.messages', messages);
    saveJson('trpg.gameState', gameState);
    saveJson('trpg.chronicle', []);
    saveJson('trpg.summary', '');
    saveJson('trpg.snapshots', {});
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
      gameState,
      chronicle: [],
      summary: '',
      snapshots: {},
      companionCandidates: keptCandidates,
      worldbook: keptWorldbook,
      messageImages: {},
      mapImage: '',
      // 上一局遗留的待掷检定与状态提示也一并清掉
      pendingChecks: [],
      lastChanges: null,
    });
  },

  setTheme(t) {
    localStorage.setItem('trpg.theme', t);
    set({ theme: t });
  },

  rollExpression(expr) {
    const outcome = roll(expr);
    return {
      expression: outcome.expression,
      total: outcome.total,
      groups: outcome.groups.map((g: DieGroup) => ({ sides: g.sides, results: g.results })),
    };
  },

  skillCheck(skill, difficulty = 'regular', bonus = 0) {
    const key = skill.trim();
    const rs = getRuleset(get().rulesetId);
    // 目标值可从角色卡技能 / 规则包基础值 / 属性表里解析（属性也可检定）
    const raw = resolveCheckTarget(key, get().character, rs) ?? 0;
    // DnD 要把属性分值折算成加值（15 → +2）；技能本身已是加值则原样
    const base = rs.toModifier ? rs.toModifier(key, raw) : raw;
    /*
     * 描述加权：**在掷骰之前**加进目标值。
     * 放在这里（而不是事后改结果）才能保证判定、成功率与结果标签三者一致。
     */
    const target = base + (bonus || 0);
    // COC 走百分骰；其它规则包退回主骰表达式（如 d20）
    const percentile = rs.mainDice === '1d100';
    if (percentile) {
      const pr = rollPercentile();
      const res = rs.resolveCheck(pr.value, target, difficulty);
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

  applyModelDeltas(deltas) {
    const { gameState, rulesetId, character } = get();
    const report = applyDeltas(gameState, deltas, {
      ruleset: getRuleset(rulesetId),
      vitalsMax: deriveVitalsMax(character, rulesetId),
    });
    // 模型偶尔会把模组里的 {{称呼}} 占位符漏进状态（地点/线索/物品名）。
    // 状态是要显示给玩家的，进库前统一替换成真实值。
    report.state = sanitizeStateTokens(report.state, character);
    // 理智骤降 / 永久疯狂 / 濒死 / 死亡：引擎检测，写进 flags 让 GM 演出、UI 显示
    const events = detectStatusEvents(report.applied, report.state);
    if (events.length > 0) {
      const flags = { ...report.state.flags };
      for (const e of events) {
        if (e.kind === 'temp_insanity') flags['临时疯狂'] = e.text;
        else if (e.kind === 'permanent_insanity') flags['永久疯狂'] = true;
        else if (e.kind === 'dying') flags['濒死'] = true;
        else if (e.kind === 'death') flags['濒临死亡'] = true;
      }
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
        if (nextState.dying) kind = 'death';
        else nextState = { ...nextState, dying: true };
      } else if (typeof hp === 'number' && hp > 0 && nextState.dying) {
        // 救回来了，解除濒死
        nextState = { ...nextState, dying: false };
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
    if (data.character) localStorage.setItem('trpg.character', JSON.stringify(data.character));
    if (data.module) saveJson('trpg.module', data.module);
    if (data.gameState) saveJson('trpg.gameState', data.gameState);
    if (data.messages) saveJson('trpg.messages', data.messages);
    if (data.chronicle)
      localStorage.setItem('trpg.chronicle', JSON.stringify(data.chronicle));
    if (data.summary) localStorage.setItem('trpg.summary', JSON.stringify(data.summary));
    localStorage.setItem('trpg.worldbook', JSON.stringify(worldbook));
    saveJson('trpg.companionCandidates', candidates);
    if (data.snapshots) saveJson('trpg.snapshots', data.snapshots);
  },
}));
