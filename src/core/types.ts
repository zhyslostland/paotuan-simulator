/**
 * 类型定义 —— 从 `ui/store.ts` 搬出来的（2026-09-19 · 优化计划 D 档批 0）。
 *
 * ## 为什么单独一个文件
 * `store.ts` 里的类型又被 `orchestrator/` 与 `core/` 用到。它们住在 ui 层的话，
 * 别处一引用就形成 **core → ui 的反向依赖**（铁律 13 明令禁止）。
 * 类型本来就该住在一个谁都能引、谁也不依赖的地方。
 *
 * `ui/store.ts` 仍把这些名字 re-export 出去，**调用点一行都不用改**。
 */
import type { Companion, GameState } from './state/gameState.js';
// clock.ts 不依赖 types.ts，所以这里 import 它不会成环
import type { StoryClock } from './clock.js';

/**
 * 模组篇幅（短篇 / 中篇 / 长篇）。
 * 原本定义在 `orchestrator/generate.ts` —— 搬到这里是为了不让 `core` 反向依赖编排层。
 */
export type ModuleScale = 'short' | 'medium' | 'long';

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
  /**
   * 这一次检定**由何而来**（§6.4）。
   *
   * 守密人在 `dice_requests` 里写的理由（"门后传来响动，先听听"）此前只挂在
   * 待掷卡片上，**掷完就消失了** —— 玩家回头看记录只看到"侦查 60% 掷 22 成功"，
   * 看不出当时是在干什么。现在跟着卡片一起落库，导出时一并带上。
   */
  reason?: string;
}
/** 模型返回的同行者发言，单独渲染，不混进 GM 叙事 */
export interface NpcLine {
  id: string;
  name: string;
  action?: string;
  line?: string;
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
  /**
   * down = 变坏（掉血 / 掉理智 / 失去物品），up = 变好，info = 中性，
   * warn = 引擎拦下的变更，good = 引擎特意留的一线生机（濒死冻结）。
   */
  tone: 'down' | 'up' | 'info' | 'warn' | 'good';
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
  /**
   * **常驻**：不看关键词，**每一轮都注入**（1.0 阶段 A）。
   *
   * 没有它的时候，玩家写了「这个世界的魔法规则」却只能等正文里出现"魔法"两个字才生效 ——
   * 世界的底层设定居然是"提起来才在"，这是最反直觉的一处。
   */
  constant?: boolean;
  /**
   * 本条目的**字数预算**（0 或省略＝不限制）。
   *
   * ⚠️ 必须与 `constant` 同刀：**常驻不看关键词，全都进**，
   * 没有预算的话长局会直接撑爆上下文。
   */
  budget?: number;
  /**
   * 插入深度：`0` ＝ 贴着 system 尾部（最稳、最不容易被最近的对话盖过）；
   * 越大越靠近当前对话。省略＝ 0。
   */
  depth?: number;
  /** 分组名（用于整组开关，如"这个模组""主角的过去"） */
  group?: string;
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
  /**
   * 外貌锚点：只写长相（发型发色、眼神、衣着、一眼能记住的特征），供**生图**用。
   *
   * 为什么要从 `description` 里单独拆一个字段：`description` 里混着身份与来历
   * （"曾是战地记者"这类进不了画面），而队友以前连这段都没有 ——
   * 拆出来之后"画什么脸"有唯一一处说法（见 `core/appearance.ts`）。
   *
   * 可选字段：没有它时生图按老样子兜底，所以**不升 `SAVE_VERSION`**。
   */
  appearance?: string;

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
  /**
   * 开局时刻（1.0 阶段 C 补的第四块，P2-10）。
   *
   * 兑现 `core/clock.ts` 头注释里**承诺了但从没实现**的那条：
   * 「模组可以给 `clock.start`（故事从哪天几点开始），引擎只负责往前走」。
   * 留空则退回 `DEFAULT_CLOCK`（第 1 天上午九点）—— 老模组不受影响。
   */
  startClock?: StoryClock;
  /**
   * 期限还剩多久（P2-10）：分钟数。
   *
   * ⚠️ **不解析 `urgency` 或 `opening` 的文本去猜日期** ——
   * `clock.ts` 自己写着"猜日期必错"。这里给的是**模组显式申报**的期限，
   * 申报了就用它，没申报才退回现有的正则（老模组兼容）。
   */
  deadlineIn?: number;
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
  /**
   * 模组**自带的世界书**（设定条目：地名、行话、组织、旧事）。
   *
   * 为什么挂在模组上：世界书原本是"单独生成 / 玩家手加"的一堆散条目，
   * 换模组时既不会被换掉、也不会跟着走 —— 结果就是**换了模组世界观还是上一个的**
   * （主人 2026-09-17 报的："预设模组的世界书没显示"）。
   * 现在模组自己带一份，`applyModule()` 换模组时一起装上、旧的一起撤掉。
   */
  worldbook?: WorldbookEntry[];
}
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
/**
 * 主题名。
 *
 * ⚠️ 2026-09-25 主人定：**只留羊皮纸一套**。
 * ⚠️ **2026-09-26 主人重申口径，我上一轮读错了**：
 * 「羊皮纸是改进字体…另外两套是优化合并成一套，所以最终主题还是**两套**，简单加法」。
 * 我曾把这句读成"只留羊皮纸"并把两套删了 —— 已恢复。
 *
 * 现在 = **羊皮纸（浅，默认）** + **午夜（深 ＝ 原「午夜 · 暗金」主干 +「冷灰」灰阶）**。
 *
 * 保留成联合类型是为了：以后加主题时，**改这一行 + `theme.css` 加一段**就能接上，
 * 其余代码（`loadTheme` / `setTheme` / `App.tsx` 的 `data-theme`）不用动。
 */
export type ThemeName = 'midnight' | 'parchment';
/** 正文排版设置 */
export interface Typography {
  /** 正文缩放（0.9 – 1.4） */
  scale: number;
  /** 行距倍数（1.5 – 2.4） */
  lineHeight: number;
  /** 首行缩进两字 */
  indent: boolean;
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
