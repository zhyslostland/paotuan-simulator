/**
 * 结构化游戏状态 —— 唯一真相来源
 *
 * 关键设计：模型输出的只是"变更意图"（state_delta），
 * 真正的数值计算与边界裁剪全部发生在这里，模型算的数一律不作数。
 */

import { roll, type Rng } from '../dice/index.js';
import { findWeapon, isLifeVital, type Ruleset } from '../rulesets/types.js';
import { planHarm } from './harm.js';
/*
 * 拒绝话术的**单一真源**（2026-09-30）：
 * 引擎拒绝本身是对的，但"用什么话拒绝"必须只有一处，否则又会出现
 * 「卡片说成功、状态变化说没打中」这种自相矛盾（用户亲报）。
 */
import { attackRejectedReason, HARM_NEEDS_CHECK_REASON, type AttackGrant } from './refusal.js';
import { type Wound } from '../wounds.js';
import { type BestiaryEntry } from '../bestiary.js';
import { type Deadline, type StoryClock, normalizeClock, tickClock, clockLabel } from '../clock.js';

export type { Wound };
export type { BestiaryEntry };
export type { StoryClock, Deadline };

/**
 * 濒死冻结时被拒的理由文案。
 * 引擎与 UI 都要认它（store 靠它判断要不要弹"本轮生命已冻结"），
 * 所以抽成常量，别两处各写一份字符串。
 */
export const DYING_FREEZE_REASON = '濒死：本轮生命已冻结，不再下降';

/**
 * 背包里的一件东西
 *
 * 除了名字与数量，还带"这是什么"和"能干嘛"——
 * 玩家点开就能看到简介；是武器的还带伤害骰与对应技能，方便直接起检定。
 */
export interface InventoryItem {
  id: string;
  name: string;
  qty: number;
  note?: string;
  /** 一句话简介：点开物品时展示（回答"这是什么东西"） */
  desc?: string;
  /** 类别，决定展示哪些字段 */
  kind?: 'weapon' | 'tool' | 'clue' | 'consumable' | 'other';
  /** 武器伤害：骰子表达式（如 "1d6"、"1d10+2"）。战斗轮里一次攻击＝一次伤害掷骰 */
  damage?: string;
  /** 这把武器用哪个技能检定（如"射击（手枪）""格斗（斗殴）"） */
  skill?: string;
  /**
   * 单件重量（负重单位，缺省 1）。旧存档没有这个字段，一律按 1 兜底。
   * 总负重 = Σ（weight × qty），超过规则包给的上限就要吃惩罚。
   */
  weight?: number;
}

/**
 * NPC 队友
 *
 * initiative 是防抢戏的关键旋钮：
 * - reactive  只有在被点名、或情境逼迫时才开口（默认）
 * - balanced  偶尔主动补一句，但不擅自行动
 * - proactive 会主动行动，但依然不做重大决策
 */
export interface Companion {
  id: string;
  name: string;
  role: string;
  /** 性格与说话方式，直接喂给模型 */
  personality: string;
  /** 该角色此刻知道的、玩家可能不知道的事（用于制造信息差） */
  secret?: string;
  /** 他自己的目的 / 打算（不能喧宾夺主，用于让他像个活人） */
  agenda?: string;
  /** 与玩家的关系 / 入队缘由（如"雇主""旧识""临时搭档"） */
  bond?: string;
  skills: Record<string, number>;
  vitals: Record<string, number>;
  /** 状态条上限（入队时按初始值记录；缺省视为与 vitals 相同） */
  vitalsMax?: Record<string, number>;
  initiative: 'reactive' | 'balanced' | 'proactive';
  alive: boolean;
  /** 是否暂时离队 */
  present: boolean;
  /** 是否已经与玩家见过面（未见面不可入队，避免"凭空拉人"） */
  met?: boolean;
  /** 队友头像（生图结果 URL / data URI） */
  portrait?: string;
  /**
   * 外貌锚点：只写长相，供**生图**用。
   *
   * 队友以前拿 `${role}。${personality}` 去画（里面没有一个字写长相），
   * 所以每次重生成都是一张陌生的脸。有了它，同一名队友跨局仍是同一套外貌描述。
   * 取法与兜底见 `core/appearance.ts`。可选字段，不升 `SAVE_VERSION`。
   */
  appearance?: string;
  /** 由「模组包」AI 生成（重新生成时只替换这类，不动用户手写的） */
  fromModule?: boolean;
}

/**
 * 战斗状态（方案 B：轻量回合 + 玩家自由窗口）
 *
 * 设计取舍：**回合是给"世界"用的，不是给玩家用的**。
 * 敌人与环境每个战斗轮推进一次，玩家则在自己的窗口里自由描述动作——
 * 不设先攻、不强制"轮到你才能动"，把扮演的自由完整留给玩家。
 */
export interface CombatState {
  /** 是否处于战斗中 */
  active: boolean;
  /** 当前第几轮（战斗开始时置 1，每推进一轮 +1） */
  round: number;
  /** 战斗中的敌人/怪物：血量由引擎权威，防止 GM 文本描述导致前后漂 */
  foes: Foe[];
}

/** 战斗中的一个敌人 */
export interface Foe {
  name: string;
  hp: number;
  max: number;
}

/**
 * 模型写了 `combat.foes add` 却没写 `name` 时的兜底名字。
 *
 * 刻意选一个**明显是占位**的说法，而不是编一个像样的名字：
 * "黑暗中的东西"这种名字读起来像作者起的，玩家会以为这就是它的名字；
 * "不明的东西"一眼就知道"引擎也不知道这是什么"，
 * 反倒诚实——而且模型下一轮描述里出现真名时，改起来没有歧义。
 *
 * 导出是为了让测试与 UI 共用同一个字符串，别到处各写一份。
 */
export const UNNAMED_FOE = '不明的东西';

/**
 * 一条支线（story thread）。
 *
 * 回答"网状叙事会不会超出 AI 能力"：**全开放网状会**（线一多就忘、前后矛盾），
 * **有界网状可行**——关键是把"网"显式收敛成几张便签。每条支线只有名字 + 一句状态，
 * GM 每轮维护、引擎持久化、界面常驻显示。模型只需记住这几张便签，而不是整张网。
 */
export interface Thread {
  name: string;
  /** 一句话状态，如"刚接下的委托" / "已锁定嫌疑人" / "已了结" */
  status: string;
}

/**
 * 一个 NPC 的档案（旁挂在 `GameState.npcNotes` 上）。
 * 三项都可选——知道多少写多少，档案本来就该是慢慢补全的。
 */
export interface NpcNote {
  /** 身份/职业，如"码头工头" / "失踪船长的女儿" */
  role?: string;
  /** 玩家观察到的、或守密人认为该记下的细节 */
  note?: string;
  /** 第几回合首次照面（用于卡片上显示"第 N 回认识"） */
  met?: number;
  /**
   * **最后一次接触**的回合（引擎写，模型不写）。
   *
   * 用途只有一处：档案超上限时判断"谁最久没接触"（见 `core/npcNotes.ts`）。
   * 可选新增字段 —— 旧档没有它时退回 `met`，**不升 `SAVE_VERSION`**。
   */
  seen?: number;
}

/**
 * 一场游戏的结局（结档）。
 *
 * 用户定调：**死亡 = 结档**，这段故事就此结束——不是弹一个"你死了"的窗，
 * 也不是读档当没发生。回溯能力永远在系统里，玩家想重来随时可以退回去。
 */
export interface Ending {
  /**
   * 结档类型。
   * - `death` / `insanity`：引擎裁决（生命耗尽 / 理智归零），模型不得声明
   * - `success` / `failure` / `grey`：**模组自己写的收束**，由守密人在契约里声明
   *   （模组的 `endings` 就是这三条：成功 / 失败 / 灰色）
   * - `other`：兜底
   */
  kind: 'death' | 'insanity' | 'success' | 'failure' | 'grey' | 'other';
  /** 结局正文（由守密人写的一段收束叙事，不是系统提示语） */
  text: string;
  /** 结档时刻 */
  at: string;
  /** 模型声明收束时给的一句话理由（如"你上了救生艇并划离了货船"），结档页展示 */
  reason?: string;
}

export interface GameState {
  /** 生命 / 理智 / 魔法等数值条，key 由规则包定义 */
  vitals: Record<string, number>;
  /**
   * 是否处于"濒死"状态（引擎内部标记，模型不可改）。
   * 生命归零的**第一轮**只算濒死（还有救）；下一个结算点还是 0 → 结档。
   */
  dying?: boolean;
  /** 结档信息（非空即这一局已经结束） */
  ending?: Ending | null;
  /** 数值条上限（HP/MP 由属性派生，SAN 通常是 99）。模型不可修改 */
  vitalsMax?: Record<string, number>;
  /** NPC 队友 */
  companions: Companion[];
  inventory: InventoryItem[];
  /** 任意剧情开关，如 { metHank: true, basementUnlocked: false } */
  flags: Record<string, unknown>;
  /** 已获得的线索 */
  clues: string[];
  /**
   * 进行中的支线（与主线并列、可推进可收束）。引擎持久化、GM 维护，
   * 让"网状叙事"变成有界的几条线，而不是无限发散。
   */
  threads: Thread[];
  /** 当前地点 */
  location: string;
  /**
   * 到过的地点（由引擎在 location 变化时自动记录，模型不可改）。
   * 用途：地图迷雾——只把玩家知道的地方画出来，避免开局就把整张图摊开剧透。
   */
  visited?: string[];
  /** 在场/存活的 NPC（死亡即移除，但事件日志会留痕） */
  npcsAlive: string[];
  /**
   * NPC 档案（**旁挂**，不动 `npcsAlive` 结构）。
   *
   * `npcsAlive` 仍是"谁在场"的唯一真源；这里只记**额外信息**，键 = 名字。
   * 稀疏的——没档案的 NPC 照样能登场，卡片只是显示得少一点。
   *
   * 为什么用旁挂映射而不是把 `npcsAlive` 改成对象数组：
   * 后者会牵动地图、检定面板、提示词，且**必须升 `SAVE_VERSION`**；
   * 这个是可选新增字段，旧档读到是 `undefined`，卡片退化成"只有名字"，不损坏任何数据。
   *
   * 前缀制天然支持 `npcNotes.<名字>.role` 这种写法，所以守密人能在 `state_delta` 里
   * 为**临时登场**的 NPC 补档案，不必改结构。
   */
  npcNotes?: Record<string, NpcNote>;
  /**
   * 伤口（引擎侧持续伤害的来源）。
   *
   * 可选新增字段 —— 旧档读到是 `undefined`（按"没有伤口"处理），**不需要升 `SAVE_VERSION`**。
   * 由两路产生：① 引擎在本轮主生命条掉到阈值以上时自动记一处；
   * ② 守密人通过 `flags.伤口` 显式申报（"左臂被划开"）。
   * 引擎每轮按 `totalBleed()` 扣一次血，处理到位后**由这里清掉**，flag 跟着消失。
   */
  wounds?: Wound[];
  /**
   * 图鉴解锁台账（R38）：玩家**遇见过**的敌对者名字。
   *
   * 可选新增字段 —— 旧档读到 `undefined` 按"什么都没见过"处理，
   * 与 `npcNotes` / `wounds` 同一判据，**不升 `SAVE_VERSION`**。
   *
   * 为什么是"名字数组"而不是 id：玩家在故事里认的是一只东西的**叫法**
   * （"舱里的东西""雾中的巨影"），id 是准备页才有的东西，两者对不上。
   * 表里的条目靠宽松匹配（见 `bestiary.findEntry`）找回来。
   */
  encountered?: string[];
  /**
   * 真正**交过手**的敌对者名字。
   *
   * 与 `encountered` 分开是 G5 的一部分：只是远远看见，不该知道它怕什么。
   * 交手过（挨过打 / 打出过血 / 它死在这一局里）才算把弱点挣到手。
   */
  fought?: string[];
  /**
   * 当前跑到**第几幕**（0 起）。R14 进章按需展开用。
   *
   * 可选：旧档没有就按 0（第一幕）算 —— **可选新增不升 `SAVE_VERSION`**（既定判据）。
   * 短模组 / 手写模组没有幕结构时，这个字段有值也没关系，引擎静默不用它。
   */
  actIndex?: number;
  /**
   * 各幕的**导演稿**（已展开的那一份），键是幕下标（字符串）。
   *
   * 与 `actIndex` 同理是可选字段。**这是 GM 内部资料，绝不能给玩家看**
   * （里面写着这一幕谁会先动手、要露哪些线索）—— UI 必须遮罩，与「真相」同一档。
   */
  actDetails?: Record<string, string>;
  /**
   * 这一局是**接在哪个世界后面**（世界层 Phase 2）。
   *
   * 可选：没有它就是"从头开的一局"。有值时，守密人要按"接着上次"来写
   * （别把在场的人当陌生人、别重演已经发生过的事）——
   * 真源只有一个：**开新团那一刻由引擎写死**，模型不可改、也不进 `ALLOWED_ROOTS`。
   *
   * 与 `actIndex` / `actDetails` 同一判据：可选新增字段，**不升 `SAVE_VERSION`**。
   */
  carriedFrom?: string;
  /**
   * 故事时钟 —— **引擎权威的"现在是什么时候"**。
   *
   * 可选新增字段（旧档没有就按 `DEFAULT_CLOCK` 起步），**不升 `SAVE_VERSION`**。
   *
   * 为什么它必须在状态里、而不是靠模型记：
   * 模组的 `urgency` 写着"雨季还有二十三天结束"，但那只是一句形容词，
   * 没有任何东西在数它。玩家睡一觉、走三小时山道、在茶棚坐到天黑，
   * 系统全都不知道 —— 长篇跑到中段倒计时还是"二十三天"（主人 2026-09-17 报的
   * "没有时间表/时钟""系统似乎没有时间概念"）。
   *
   * **模型不许改它**（不进 `ALLOWED_ROOTS`）：它只能在契约里写 `elapsed`
   * （"三个小时""一整夜"），由引擎折算后推进。与骰子同一条分工：
   * 模型报剧情里的量，数数的是引擎。
   */
  clock?: StoryClock;
  /**
   * 期限倒计时（`urgency` 的数字版）。
   *
   * 为什么单独存一个、不从 `urgency` 文本解析：「雨季还有二十三天结束」
   * 用正则猜日期**一定会错**；让守密人显式声明 `deadline_days`，
   * 引擎每轮按实际推进量减。减到 0 就是"期限到了"。
   */
  deadline?: Deadline | null;
  /** 战斗轮状态 */
  combat: CombatState;
}

/**
 * 🔴 `G24`（协28 §F① 第 3 条）：**敌人还活着，不许把战斗静默关掉**。
 *
 * 真机：`combat` 从 `{active:true, foes:[苏醒的深潜者群 30/40]}` 直接变成
 * `{active:false, foes:[同一个 30/40]}` —— 横幅没了，对面还在满血移动，玩家以为战斗被吞了。
 *
 * 引擎只认一条：`foes` 里还有 `hp>0` 时，`active=false` 必须带**说得通的理由**
 * （逃走 / 投降 / 脱离 —— 玩家真的脱离了这场战斗）。没有理由＝模型把战斗静默吞了，拒掉并翻成人话。
 * 不受影响的两条路：先把敌人 `remove` 干净再关；或者把 hp 打到 0（引擎自己收场）。
 */
const EXIT_REASON_RE = /逃|撤|退|脱离|投降|认输|放走|制服|擒|绑|带走|拖走|战败|结束/;

export type DeltaOp = 'set' | 'inc' | 'dec' | 'add' | 'remove';

export interface StateDelta {
  /** 点路径，如 vitals.san / flags.metHank / inventory / clues */
  target: string;
  op: DeltaOp;
  /** inc / dec 用，可以是数字或骰子表达式（如 "1d6"），由本地引擎求值 */
  amount?: number | string;
  /** set / add / remove 用 */
  value?: unknown;
  /** 变更理由，写进事件日志，便于回溯 */
  reason?: string;
  /**
   * 这一击用的是哪把武器（1.0 阶段 C，**可选**）。
   *
   * 模型在 `combat.foes dec` 上写了它，引擎就**按规则包的武器表掷伤害**
   * （模型给的 `amount` 会被忽略）—— 伤害不再由模型随口报。
   * **不写就完全走现状**，老契约一行都不用改。
   */
  weapon?: string;
  /*
   * ⚠️ 这里曾经有过一个 `announce?: boolean`（意为"我在正文里写过了，别弹提示"），
   * **2026-09-17 已删除**。理由见 `store.ts` 的 `describeChanges()`：
   * 状态变化提示是**框架的可见性**，不是特效。
   * 少一条提示不会让画面变干净，只会让玩家不知道东西到底进没进背包。
   *
   * 判据：**宁可重复，不可缺失。** 别再加回来了。
   */
}

export interface AppliedDelta {
  delta: StateDelta;
  /** 表达式求值后的实际数值（仅 inc/dec） */
  resolvedAmount?: number;
  before: unknown;
  after: unknown;
}

export interface RejectedDelta {
  delta: StateDelta;
  reason: string;
}

export interface ApplyReport {
  state: GameState;
  applied: AppliedDelta[];
  rejected: RejectedDelta[];
  /**
   * `G27`：这一轮里打出过**致命一击**（生命条被一次打光 / 大失败）——
   * 调用方据此结档出结局。只有 `ctx.harm` 那条路会产生它。
   */
  lethal?: boolean;
  /** 本轮掷过的骰子，用于渲染骰点动画 */
  rolls: { expression: string; total: number }[];
}

/*
 * =====================================================================
 * delta 目标白名单 —— **整个项目只在这一处声明**
 * =====================================================================
 *
 * ## 为什么要有这三份清单（2026-09-30 基础完善 · 批次 A 的现场取证）
 *
 * 体检前这里只有一个 `const ALLOWED_ROOTS`（**没导出**），而 `prompt.ts` 里
 * 把同一份事实**照样手写了一遍**。实测差集（判据跑出来的，不是眼看的）：
 *
 * ```
 * 引擎白名单(11)：vitals companions inventory flags clues location npcsAlive npcNotes combat threads wounds
 * 引擎有 / 提示词没提：location  threads  wounds        ← 提示词与引擎各说一套
 * 引擎接受 / 却没有专属分支：wounds                     ← 更糟的一种，见下
 * ```
 *
 * 第二条比第一条严重：`applyDeltas` 里**没有任何 `wounds` 分支**，于是模型写
 * `{target:'wounds', op:'set', value:[...]}` 会掉进"自由字段"兜底分支，
 * **把伤口数组整包照抄进状态** —— 绕过 `core/wounds.ts` 的档位/流失量真源。
 * 也就是说：白名单写着"模型可以写"，而引擎其实"只会照抄"。
 *
 * ## 三份清单的分工（一个根只能归一份，判据在 `tests/contract.test.ts`）
 *
 * | 清单 | 含义 | 谁写 |
 * |---|---|---|
 * | `MODEL_WRITABLE_ROOTS` | 模型可以在 `state_delta` 里写的根 | 引擎处理 + 提示词教 |
 * | `FREE_FIELD_ROOTS` | 允许写、但**只支持 `set` 且不做语义校验**的旁挂字段 | 模型 |
 * | `ENGINE_ONLY_ROOTS` | **只由引擎写**：模型写了就拒（并说明为什么） | 只有引擎 |
 *
 * ⚠️ **加新根的做法**：只在这一处加。提示词由 `MODEL_WRITABLE_TARGET_TEXT` 自动带上，
 * 不需要手改 `prompt.ts`；忘了给它写处理分支，`tests/contract.test.ts` 会红
 * （判据："可写根必须有归宿"）。
 */

/** 模型可以在 `state_delta` 里写的根（都有专属处理分支）。 */
export const MODEL_WRITABLE_ROOTS = [
  'vitals',
  'companions',
  'inventory',
  'flags',
  'clues',
  'location',
  'npcsAlive',
  'npcNotes',
  'combat',
  'threads',
] as const;

/**
 * 允许写、但**只支持 `set`、不做语义校验**的旁挂字段。
 *
 * 它们没有专属分支，走 `applyDeltas` 末尾那个"自由字段"兜底：
 * `flags` 是任意剧情开关；`npcsAlive` 是"谁在场"的字符串表；
 * `npcNotes` 是 NPC 档案的稀疏映射（前缀制天然支持 `npcNotes.<名字>.role`）。
 */
export const FREE_FIELD_ROOTS = ['flags', 'npcsAlive', 'npcNotes'] as const;

/**
 * **只由引擎写**的根：模型写了就拒。
 *
 * 判据（原来只写在注释里，现在成了代码）：**凡"只由引擎写"的表，一律不进可写白名单。**
 * - `wounds`：伤口档位/流失量的真源是 `core/wounds.ts`；引擎从"生命条掉到阈值"
 *   与 `flags.伤口` 两路产生。**模型不准自带伤口数组**（本次就是从可写清单里挪出来的）。
 * - `clock`：模型只能申报 `elapsed`，由引擎折算（`core/clock.ts`）。
 * - `deadline`：同上，模型只能申报 `deadline_days`。
 * - `encountered` / `fought`：图鉴台账（`G5`）——只记玩家**真见过/真交过手**的，
 *   放进可写清单等于让模型把"听说过的东西"塞进图鉴。
 * - `carriedFrom` / `actIndex` / `actDetails`：世界层与幕结构，开团时由引擎写死。
 * - `vitalsMax` / `dying` / `ending`：派生值 / 濒死标记 / 收档，全部引擎独占。
 */
export const ENGINE_ONLY_ROOTS = [
  'wounds',
  'clock',
  'deadline',
  'encountered',
  'fought',
  'carriedFrom',
  'actIndex',
  'actDetails',
  'vitalsMax',
  'dying',
  'ending',
] as const;

/** 判据用的集合（原来是手写 `new Set([...])`，现在由上面的清单派生）。 */
export const ALLOWED_ROOTS: ReadonlySet<string> = new Set<string>([
  ...MODEL_WRITABLE_ROOTS,
  ...FREE_FIELD_ROOTS,
]);

/**
 * 提示词里"允许的 target 前缀"那一段的**展示串** —— 由 `MODEL_WRITABLE_ROOTS` 派生。
 *
 * 为什么要有它：提示词与引擎必须说同一件事，而"手写一遍列表"必然分叉（本次实测漏了三个根）。
 * `orchestrator/prompt.ts` 直接插值它，于是**加一个根只需要改上面那一处**。
 *
 * 写法是给人（模型）看的：`vitals.` 带点表示"还能往下写"；
 * `combat` 展开成它允许的三个字段（模型容易只写 `combat.active` 就以为完事）。
 */
export const MODEL_WRITABLE_TARGET_TEXT: string = [
  'vitals.',
  'companions.<id>.vitals.',
  'companions.<id>.alive',
  'companions.<id>.present',
  'inventory',
  'flags.',
  'clues',
  'location.',
  'npcsAlive',
  'npcNotes.',
  'threads.',
  'combat.active',
  'combat.round',
  'combat.foes',
].join(' / ');


/**
 * 武器「明确失去」的理由白名单（见 inventory remove 分支）。
 * 命中 = 放行删除；未命中（含空 reason）= 拒绝。
 *
 * 注意这里刻意**不含**使用语义的词：`开火时炸膛` 因为含"炸膛"而放行，
 * 而单写 `开火`/`射出` 之类不会放行——那才是模型绕道删枪的写法。
 *
 * ## 为什么不能写裸的单字 `送`（协作方第 6 版 §2.2）
 * 上一版为了兜住 `送给老霍华德防身` 写了单字 `送`，结果会误命中
 * **`护送`/`传送`/`运送`/`呈送`** —— 这四个都不表示"失去武器"，
 * 尤其"护送"是玩家在**做**一件事，却让引擎放行删枪。
 * 改成有目标的 `送给|送人`，再补 `赠予|赠与`。
 *
 * `交给` **保留**：东西从**玩家背包**移走（队友背包不在这个 `inventory` 模型里），
 * 确实算失去；`交给同伴保管` 也等于玩家手里没有了。
 */
const LOSS_RE =
  /缴械|被夺|夺走|抢夺|抢走|没收|上缴|送给|送人|赠送|赠予|赠与|交给|留给|留作|递给|转交|丢失|遗失|丢了|掉落|掉进|掉入|掉下|沉入|损坏|摔坏|炸膛|炸毁|报废|毁坏|损毁|烧毁|焚毁|断裂|折断|出售|卖掉|交易|典当|丢弃|丢掉|丢进|扔掉|扔进|扔下|抛掉|丢下|投弃|抵押|捐赠|上交/;

export function createInitialState(overrides: Partial<GameState> = {}): GameState {
    return {
      vitals: {},
      vitalsMax: {},
      dying: false,
      ending: null,
      companions: [],
      inventory: [],
      flags: {},
      clues: [],
      threads: [],
      location: '',
      visited: [],
      npcsAlive: [],
      wounds: [],
      encountered: [],
      fought: [],
      combat: { active: false, round: 0, foes: [] },
      ...overrides,
    };
}
function deepClone<T>(v: T): T {
  return JSON.parse(JSON.stringify(v)) as T;
}

function getPath(root: unknown, path: string): unknown {
  return path.split('.').reduce<unknown>((acc, key) => {
    if (acc === null || typeof acc !== 'object') return undefined;
    return (acc as Record<string, unknown>)[key];
  }, root);
}

function setPath(root: Record<string, unknown>, path: string, value: unknown): void {
  const keys = path.split('.');
  let cur: Record<string, unknown> = root;
  for (let i = 0; i < keys.length - 1; i++) {
    const k = keys[i]!;
    if (cur[k] === null || typeof cur[k] !== 'object') cur[k] = {};
    cur = cur[k] as Record<string, unknown>;
  }
  cur[keys[keys.length - 1]!] = value;
}

function clamp(n: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, n));
}

/**
 * 应用一批 delta。不会抛异常 —— 非法变更一律进 rejected，
 * 保证一轮对话不会因为模型输出一个离谱字段就整个崩掉。
 *
 * `ctx.elapsed` 是这一轮**剧情里过去了多久**（守密人申报的自然语言量，
 * 如"三个小时""一整夜"）。它不进 delta 白名单，而是由引擎折算后推时钟——
 * 详见 `core/clock.ts`。不传就是"时间原地不动"（回溯、读档、测试灌数据都走这条）。
 */
export function applyDeltas(
  state: GameState,
  deltas: StateDelta[],
  ctx: {
    rng?: Rng;
    ruleset?: Ruleset;
    vitalsMax?: Record<string, number>;
    elapsed?: string;
    /*
     * 🔴 命中授权（P1-5 阶段二 · 主人 2026-09-28 拍板「骰子说了算」）。
     *
     * 病：伤害是守密人**另写一条** `combat.foes dec` 申报的，跟玩家掷没掷中**毫无关系** ——
     * 于是「检定成功却描述没打中、血照样扣」和「不检定也扣血」同时成立。
     *
     * 现在：**带 `weapon` 的攻击**（＝守密人明确在演"某人用某物打过去"）必须有命中授权：
     *   - `'hit'`  → 掷中过，放行（伤害照旧由引擎按武器表掷）；
     *   - `'miss'` → 这一轮掷过但**没中**，拒绝并说明；
     *   - `'none'` → 这一轮压根没掷，拒绝并说明。
     * 不传（`undefined`）＝老路径：完全走现状（单测、旧调用方、环境类伤害都不受影响）。
     *
     * ⚠️ 刻意只在**带 weapon** 时才管：推倒书架砸它、它自己摔下悬崖这类
     * 「不是玩家命中检定决定的伤害」仍然照旧，别把叙事自由一起收走。
     */
    foeDamage?: 'hit' | 'miss' | 'none';
    /*
     * 🔴 属性变更授权（`G25` · 协28 §F① 第 6b 条 · 主人 2026-09-29 拍板「**动我属性都要检定的**」）。
     *
     * 病：`vitals.*` 的下降完全由模型申报，引擎从不问"凭什么掉" —— 真机 62 轮 `hp` 一次没动
     * （模型叙事取向倾向不扣血 → "死亡 = 结档"几乎不可达）；反过来它也能随口扣。
     *
     * 现在：模型申报的**下降**必须已经掷过检定（`checked`），或有显式 `reason`（环境类伤害）。
     *   - `checked: true`  → 掷过了，放行；扣多少由 `planHarm()` 定（保底 1 / 大失败一次到位）
     *   - `checked: false` → 没掷、又没理由 → **拒落地并说明**（不替它补一个检定 —— 猜不准）
     *   - `fumble: true`   → 这一轮掷出大失败 → 生命条一次掉到位并出结局
     *
     * ⚠️ **不传（`undefined`）＝老路径**：引擎自己写的账（`P1-3` 状态结算、伤口渗血、濒死冻结）
     * 与老调用方一律不受影响 —— 这道闸是给**模型**立的，不是给引擎自己立的。
     */
    harm?: { checked: boolean; fumble: boolean };
    /**
     * 🔴 `G17`：这一轮的**目标时刻**（绝对分钟）。玩家说了「等到午夜」时由 store 算出。
     * 它**同时是下限与上限**（协30 §2.4）—— 不许提前（那等于"等"没发生），
     * 也不许冲过头（真机冲到过次日 14:30，而叙事只过了一两小时）。
     */
    clockFloor?: number;
  } = {}
): ApplyReport {
  const next = deepClone(state);
  // 兼容旧存档：早期保存的状态没有 combat / threads 字段，这里补默认值
  if (!next.combat) next.combat = { active: false, round: 0, foes: [] };
  if (!Array.isArray(next.combat.foes)) next.combat.foes = [];
  if (!Array.isArray(next.threads)) next.threads = [];
  /*
   * 故事时钟与倒计时也是后加的（可选字段，不升 SAVE_VERSION）。
   * 旧档没有就按"第 1 天上午九点"起步 —— 这里只做类型兜底，
   * 真正的推进在函数的最后（`tickClock`）。
   */
  if (!next.clock) next.clock = { day: 1, minute: 9 * 60 };
  else next.clock = normalizeClock(next.clock);
  const applied: AppliedDelta[] = [];
  const rejected: RejectedDelta[] = [];
  const rolls: { expression: string; total: number }[] = [];
  /** `G27`：这一轮里出现过"致命一击"（生命条被一次打光 / 大失败）→ store 据此结档 */
  let lethal = false;
  const rng = ctx.rng ?? Math.random;

  for (const delta of deltas) {
    if (!delta || typeof delta.target !== 'string') {
      rejected.push({ delta, reason: 'delta 缺少合法的 target' });
      continue;
    }

    const [root, ...rest] = delta.target.split('.');
    if (!root || !ALLOWED_ROOTS.has(root)) {
      /*
       * 拒的时候**说清该走哪条路**，别只丢一句"不允许"。
       *
       * `wounds` 是本次收口的重点：它原来在可写白名单里、却没有处理分支，
       * 于是模型写 `wounds` 会被**照抄**进状态（绕过 `core/wounds.ts` 的档位真源）。
       * 现在它归 `ENGINE_ONLY_ROOTS`，并且这里顺手把正路告诉模型 ——
       * 否则模型只会反复试同一个错根（真机上 `P2-10` 家族就是这么来回磨的）。
       */
      const hint =
        root === 'wounds'
          ? '伤口由引擎记账：请用 `flags.伤口` 申报"新添了一处伤口"，档位与失血引擎自己算'
          : root === 'encountered' || root === 'fought'
            ? '图鉴台账只记玩家真见过 / 真交过手的东西，由引擎在战斗里写'
            : root === 'clock' || root === 'deadline'
              ? '时间只能通过契约里的 `elapsed` / `deadline_days` 申报，引擎折算'
              : null;
      rejected.push({
        delta,
        reason: `不允许修改的路径根：${root ?? '(空)'}${hint ? ` —— ${hint}` : ''}`,
      });
      continue;
    }

    // --- 数值条：只接受 set / inc / dec，且做边界裁剪 ---
    if (root === 'vitals') {
      const vitalKey = rest[0];
      if (!vitalKey) {
        rejected.push({ delta, reason: 'vitals 变更缺少字段名' });
        continue;
      }
      const def = ctx.ruleset?.vitalDefs.find((v) => v.key === vitalKey);
      // 提供了规则包时，模型不能凭空造出规则里没有的数值条（如 vitals.gold）
      if (ctx.ruleset && !def) {
        rejected.push({
          delta,
          reason: `规则包 ${ctx.ruleset.id} 未定义数值条「${vitalKey}」`,
        });
        continue;
      }
      const before = (next.vitals[vitalKey] ?? def?.min ?? 0) as number;

      let after: number;
      let resolvedAmount: number | undefined;
      /** `G27`：这一条是不是"致命一击"（生命条被打光 / 大失败） */
      let lethalHit = false;
      /** 这一次往下掉多少（> 0 才算下降；回升、set 到更高都是 ≤ 0） */
      let drop: number;

      if (delta.op === 'set') {
        const v = typeof delta.value === 'number' ? delta.value : Number(delta.value);
        if (!Number.isFinite(v)) {
          rejected.push({ delta, reason: 'set 需要一个有限数值' });
          continue;
        }
        after = v;
        drop = before - v;
      } else if (delta.op === 'inc' || delta.op === 'dec') {
        if (delta.amount === undefined) {
          rejected.push({ delta, reason: `${delta.op} 缺少 amount` });
          continue;
        }
        if (typeof delta.amount === 'number') {
          resolvedAmount = delta.amount;
        } else {
          const outcome = roll(delta.amount, rng);
          rolls.push({ expression: outcome.expression, total: outcome.total });
          resolvedAmount = outcome.total;
        }
        after = delta.op === 'inc' ? before + resolvedAmount : before - resolvedAmount;
        drop = delta.op === 'inc' ? -resolvedAmount : resolvedAmount;
      } else {
        rejected.push({ delta, reason: `vitals 不支持操作 ${delta.op}` });
        continue;
      }

      /*
       * 🔴 `G25`（协28 §F① 第 6b 条）：**模型申报的下降必须先掷过检定**。
       *
       * `ctx.harm` 只有一条来路 —— `applyModelDeltas`（模型回话落地）。引擎自己写的账
       * 根本不传它，所以天然不受这道闸影响（那道边界很重要：闸门是给模型立的）。
       *
       * 两条出口：
       *   - 掷过检定 → 放行，扣多少交给 `planHarm()`（保底 1 / 大失败一次到位）；
       *   - 没掷但写了 `reason`（坠落、窒息、被推下楼梯这类**环境伤害**）→ 也放行 ——
       *     与 `G24`「逃走 / 投降须显式理由」同一条口径：**显式说出来就认，静默吞掉不认**。
       */
      /*
       * 判据是**操作方向**而不是算出来的差值：`dec 0` 也是"想往下扣"（模型想说掉了却报 0），
       * 那种要按下面 `planHarm` 的保底算成 1 —— 用差值判的话它会被漏过去（"改掉属性就掉"落空）。
       */
      const isDown = delta.op === 'dec' || (delta.op === 'set' && drop > 0);
      if (isDown && ctx.harm) {
        const why = String(delta.reason ?? '').trim();
        if (!ctx.harm.checked && !why) {
          rejected.push({
            delta,
            reason: HARM_NEEDS_CHECK_REASON,
          });
          continue;
        }
        const plan = planHarm({
          raw: drop,
          before,
          floor: def?.min ?? 0,
          life: isLifeVital(def, vitalKey),
          fumble: ctx.harm.fumble,
        });
        resolvedAmount = plan.amount;
        after = before - plan.amount;
        lethalHit = plan.lethal;
      }

      /*
       * 濒死冻结：主生命条已经见底时，这一轮**不再接受任何下降**。
       *
       * 为什么要引擎拦：数值本来就被 clamp 在 min，扣不动——但模型不知道，
       * 它会一轮里连发两条 hp dec，叙事上就变成"你已经倒地不起了，又挨了一刀"。
       * 更糟的是玩家在界面上看到一次"生命值变化"，却根本不知道发生了什么。
       * 这里直接拒掉，让 store 有机会把"本轮生命已冻结"翻成人话告诉玩家，
       * 并触发一次性的施救引导（见 DYING_NOTE）。
       *
       * 两个触发条件：
       *   ① 进入本轮时已经是濒死（dying === true）——玩家正在争取那一线生机；
       *   ② 本轮刚把血扣到 min（同一批 delta 里后面还有一下）——伤势见底就不再叠加。
       * 回升一律放行：施救/自救本来就该让它涨回去。
       *
       * 🔴 `G27`：**"死定了"的那一下要能跨过去**。这道冻结的本意是给玩家一个施救窗口，
       * 不是不死之身 —— 所以`lethalHit`（大失败 / 这一下足以打光剩余）时不拦，
       * 让它一次掉到位、由 store 结档出结局。挤牙膏式的 1 点 1 点扣仍然被拦（窗口还在）。
       */
      if (isLifeVital(def, vitalKey) && after < before && !lethalHit) {
        const floor = def?.min ?? 0;
        if (next.dying === true || before <= floor) {
          rejected.push({
            delta,
            reason: DYING_FREEZE_REASON,
          });
          continue;
        }
      }

      if (def) {
        // 上限优先用实时派生的 vitalsMax（HP/MP 由属性决定，不能超过），缺省退回规则包的 max
        const max = ctx.vitalsMax?.[vitalKey] ?? def.max;
        after = clamp(after, def.min, max);
      }
      next.vitals[vitalKey] = after;
      applied.push({ delta, resolvedAmount, before, after });
      if (lethalHit) lethal = true;
      continue;
    }

    // --- NPC 队友：companions.<id>.vitals.<key> / .alive / .present ---
    if (root === 'companions') {
      const id = rest[0];
      if (!id) {
        rejected.push({ delta, reason: 'companions 变更缺少队友 id' });
        continue;
      }
      const c = next.companions.find((x) => x.id === id);
      if (!c) {
        rejected.push({ delta, reason: `队伍中没有 id 为「${id}」的队友` });
        continue;
      }

      const field = rest[1];

      if (field === 'vitals') {
        const vitalKey = rest[2];
        if (!vitalKey) {
          rejected.push({ delta, reason: 'companions 数值条变更缺少字段名' });
          continue;
        }
        const def = ctx.ruleset?.vitalDefs.find((v) => v.key === vitalKey);
        if (ctx.ruleset && !def) {
          rejected.push({ delta, reason: `规则包未定义数值条「${vitalKey}」` });
          continue;
        }
        const before = c.vitals[vitalKey] ?? def?.min ?? 0;
        let after: number;
        let resolvedAmount: number | undefined;

        if (delta.op === 'set') {
          const v = typeof delta.value === 'number' ? delta.value : Number(delta.value);
          if (!Number.isFinite(v)) {
            rejected.push({ delta, reason: 'set 需要一个有限数值' });
            continue;
          }
          after = v;
        } else if (delta.op === 'inc' || delta.op === 'dec') {
          if (delta.amount === undefined) {
            rejected.push({ delta, reason: `${delta.op} 缺少 amount` });
            continue;
          }
          if (typeof delta.amount === 'number') {
            resolvedAmount = delta.amount;
          } else {
            const outcome = roll(delta.amount, rng);
            rolls.push({ expression: outcome.expression, total: outcome.total });
            resolvedAmount = outcome.total;
          }
          after = delta.op === 'inc' ? before + resolvedAmount : before - resolvedAmount;
        } else {
          rejected.push({ delta, reason: `companions 数值条不支持操作 ${delta.op}` });
          continue;
        }

        if (def) {
          const max = c.vitalsMax?.[vitalKey] ?? def.max;
          after = clamp(after, def.min, max);
        }
        c.vitals[vitalKey] = after;
        applied.push({ delta, resolvedAmount, before, after });
        continue;
      }

      if (field === 'alive' || field === 'present') {
        if (delta.op !== 'set') {
          rejected.push({ delta, reason: `${field} 只支持 set` });
          continue;
        }
        const v = Boolean(delta.value);
        const beforeVal = c[field];
        c[field] = v;
        applied.push({ delta, before: beforeVal, after: v });
        continue;
      }

      rejected.push({
        delta,
        reason: `companions 不支持修改「${rest.slice(1).join('.') || '(空)'}」`,
      });
      continue;
    }

    // --- 支线：threads（{name, status} 列表） ---
    if (root === 'threads') {
      const list = next.threads;
      const before = deepClone(list);
      const nameOf = (v: unknown) =>
        (typeof v === 'string' ? v : (v as Partial<Thread> | undefined)?.name ?? '').trim();

      if (delta.op === 'add' || delta.op === 'set') {
        const name = nameOf(delta.value);
        if (!name) {
          rejected.push({ delta, reason: `threads ${delta.op} 需要 name` });
          continue;
        }
        const status =
          typeof delta.value === 'object' && delta.value !== null
            ? String((delta.value as Partial<Thread>).status ?? '')
            : '';
        const existing = list.find((x) => x.name === name);
        if (existing) {
          // set 只改状态；add 到已存在则补状态
          if (status) existing.status = status;
        } else {
          list.push({ name, status });
        }
      } else if (delta.op === 'remove') {
        const name = String(delta.value ?? '').trim();
        const idx = list.findIndex((x) => x.name === name);
        if (idx < 0) {
          rejected.push({ delta, reason: `支线不存在 "${name}"` });
          continue;
        }
        list.splice(idx, 1);
      } else {
        rejected.push({ delta, reason: `threads 不支持操作 ${delta.op}` });
        continue;
      }
      applied.push({ delta, before, after: deepClone(list) });
      continue;
    }

    // --- 列表类：inventory / clues / npcsAlive ---
    if (root === 'inventory' || root === 'clues' || root === 'npcsAlive') {
      const list = next[root] as unknown[];
      const before = deepClone(list);

      /*
       * 物品"按数量"增减。
       *
       * 为什么必须支持：模型天然会写"用掉一发子弹"，早期只支持整件 add/remove，
       * 结果消耗品被消耗时会静默失败——东西永远用不完，很出戏。
       * 写法：{ target: "inventory", op: "dec", value: "子弹", amount: 1 }
       * 也接受 { target: "inventory.子弹", op: "dec", amount: 1 }（模型两种都会写）。
       */
      if (root === 'inventory' && (delta.op === 'dec' || delta.op === 'inc')) {
        const raw = delta.value;
        const fromValue =
          typeof raw === 'object' && raw !== null
            ? String((raw as InventoryItem).id ?? (raw as InventoryItem).name ?? '')
            : raw == null
              ? ''
              : String(raw);
        const key = (fromValue || rest.join('.')).trim();
        if (!key) {
          rejected.push({ delta, reason: 'inventory 数量变更缺少物品名' });
          continue;
        }
        const idx = (list as InventoryItem[]).findIndex((i) => i.id === key || i.name === key);
        if (idx < 0) {
          rejected.push({ delta, reason: `背包中不存在物品 ${key}` });
          continue;
        }
        let amount: number;
        if (delta.amount === undefined) amount = 1;
        else if (typeof delta.amount === 'number') amount = delta.amount;
        else {
          const outcome = roll(delta.amount, rng);
          rolls.push({ expression: outcome.expression, total: outcome.total });
          amount = outcome.total;
        }
        if (!Number.isFinite(amount) || amount <= 0) {
          rejected.push({ delta, reason: '数量变更需要正数 amount' });
          continue;
        }
        const item = (list as InventoryItem[])[idx]!;
        /*
         * **武器不按数量消耗。**
         *
         * 模型天然会写"我开了一枪"，然后按"用掉一件东西"扣数量——扣的却是那把枪。
         * 用户 2026-09-16 实测："开一枪把我手枪消耗掉了"，而且枪没了之后
         * 系统还在给他触发手枪检定，整局都崩了。
         *
         * 弹药才是消耗品，枪本身不该因为使用而消失。要丢掉武器请用 remove，
         * 并写明理由（被缴械 / 送人 / 掉进水里）。
         */
        if (item.kind === 'weapon') {
          rejected.push({
            delta,
            reason: `「${item.name}」是武器，不按数量消耗（开枪用掉的是弹药，不是枪本身）`,
          });
          continue;
        }
        const current = Number.isFinite(item.qty) ? item.qty : 1;
        const after = delta.op === 'dec' ? current - amount : current + amount;
        if (after <= 0) {
          // 用光了就从背包里移除；"永远用不完"和"扣到负数"一样出戏
          (list as InventoryItem[]).splice(idx, 1);
        } else {
          item.qty = after;
        }
        applied.push({ delta, resolvedAmount: amount, before, after: deepClone(list) });
        continue;
      }

      if (delta.op === 'add') {
        if (delta.value === undefined || delta.value === null || delta.value === '') {
          rejected.push({ delta, reason: 'add 需要 value' });
          continue;
        }
        if (root === 'inventory') {
          const item = delta.value as Partial<InventoryItem>;
          if (!item.id && !item.name) {
            rejected.push({ delta, reason: '物品至少需要 id 或 name' });
            continue;
          }
          const id = item.id ?? item.name!;
          const existing = (list as InventoryItem[]).find((i) => i.id === id);
          if (existing) {
            existing.qty += item.qty ?? 1;
            // 补全后来才知道的信息（简介、伤害等），但别把已有的覆盖成空
            if (item.desc) existing.desc = item.desc;
            if (item.kind) existing.kind = item.kind;
            if (item.damage) existing.damage = item.damage;
            if (item.skill) existing.skill = item.skill;
            if (item.note) existing.note = item.note;
            if (typeof item.weight === 'number') existing.weight = item.weight;
          } else {
            (list as InventoryItem[]).push({
              id,
              name: item.name ?? id,
              qty: item.qty ?? 1,
              note: item.note,
              desc: item.desc,
              kind: item.kind,
              damage: item.damage,
              skill: item.skill,
              // 没写重量的一律 1；itemWeight() 读的时候还会再兜一次
              weight: typeof item.weight === 'number' ? item.weight : 1,
            });
          }
        } else {
          const v = String(delta.value);
          if (!(list as string[]).includes(v)) (list as string[]).push(v);
        }
      } else if (delta.op === 'remove') {
        if (root === 'inventory') {
          // 模型天然会写物品**名字**（"用掉一个绷带"），所以 id 与 name 都要能命中，
          // 否则"消耗品被消耗"会静默失败、东西永远用不完。
          const raw = delta.value;
          const key =
            typeof raw === 'object' && raw !== null
              ? String((raw as InventoryItem).id ?? (raw as InventoryItem).name ?? '')
              : String(raw ?? '');
          let idx = (list as InventoryItem[]).findIndex((i) => i.id === key);
          if (idx < 0) idx = (list as InventoryItem[]).findIndex((i) => i.name === key);
          if (idx < 0) {
            rejected.push({ delta, reason: `背包中不存在物品 ${key}` });
            continue;
          }
          /*
           * 丢弃武器是合法的（被缴械、送人、炸膛、掉进水里），
           * 但"**因为用了一下**就整件消失"不是——那是 dec 被拒之后的另一种绕法。
           *
           * 判据用**失去理由白名单**，不用"使用词黑名单"：
           * 模型经常干脆不写 reason，黑名单就被绕过去了（用户报的"枪没了"正是这条）；
           * 而白名单下，只有明确写了失去理由才放行，空 reason 一律拒。
           * 顺带修掉黑名单的误伤：「开火时炸膛」含"开火"会被拦，但它其实是枪该坏的合法剧情——
           * 现在因为含"炸膛"而正确放行。
           */
          const removing = (list as InventoryItem[])[idx] as InventoryItem;
          if (removing.kind === 'weapon' && !LOSS_RE.test(String(delta.reason ?? ''))) {
            rejected.push({
              delta,
              reason: `「${removing.name}」是武器，不会因为使用而消失（要丢掉请写明缴械 / 送人 / 损坏 / 丢失）`,
            });
            continue;
          }
          list.splice(idx, 1);
        } else {
          const v = delta.value === undefined ? undefined : String(delta.value);
          const idx = (list as string[]).indexOf(v ?? '');
          if (idx < 0) {
            rejected.push({ delta, reason: `${root} 中不存在 "${v}"` });
            continue;
          }
          list.splice(idx, 1);
        }
      } else if (delta.op === 'set') {
        rejected.push({ delta, reason: `${root} 不支持整体 set（请用 add/remove）` });
        continue;
      } else {
        rejected.push({ delta, reason: `${root} 不支持操作 ${delta.op}` });
        continue;
      }

      applied.push({ delta, before, after: deepClone(next[root]) });
      continue;
    }

    // --- 战斗轮：combat.active / combat.round / combat.foes ---
    if (root === 'combat') {
      const field = rest[0];

      // 开关战斗 + 推进轮次
      if (field === 'active' || field === 'round') {
        if (delta.op !== 'set') {
          rejected.push({ delta, reason: `combat.${field} 只支持 set` });
          continue;
        }
        const before = field === 'active' ? next.combat.active : next.combat.round;
        if (field === 'active') {
          const want = Boolean(delta.value);
          /*
           * `G24`：关战斗之前先问一句"场上还有活的敌人吗"。
           * 没理由就关＝模型把战斗静默吞了（真机那次敌人 30/40 满血）。
           */
          if (!want && next.combat.active) {
            const alive = (next.combat.foes ?? []).filter((f) => Number(f.hp) > 0);
            const why = String(delta.reason ?? '').trim();
            if (alive.length > 0 && !EXIT_REASON_RE.test(why)) {
              rejected.push({
                delta,
                reason:
                  `场上还有活着的敌人（${alive.map((f) => f.name).join('、')}），战斗不算结束；` +
                  `真要收场就写明理由（逃走 / 投降 / 脱离）`,
              });
              continue;
            }
          }
          next.combat.active = want;
        } else {
          /*
           * 🔴 `G1`（协30 §2.1）：**`combat.round` 由引擎独占** —— 模型写的值一律不算数。
           *
           * 真机 `0 → 2 → 4`（两次战斗行动各 +2）就出在这里：模型写一个值、引擎在它上面再 +1。
           * 处置选的是**忽略**而不是"拒"：
           *   - 轮次不是玩家身上的东西（不是血、不是物品、不是状态），引擎自己会写正确值，
           *     忽略不会让玩家看到任何错的东西；
           *   - 若记成 `rejected`，玩家的"状态变化"里每轮都会多一句系统话术 ——
           *     那是**噪音**，不是"状态可见"。⚠️ 这与「别加『少弹提示』的优化」不冲突：
           *     那条护的是**玩家的账**必须可见，这里护的是玩家的屏幕别被模型越权刷屏。
           * 留一条 console 便于开发者发现模型没听提示词。
           */
          console.warn('[跑团] 忽略模型申报的 combat.round（轮次由引擎独占）', delta.value);
          continue;
        }
        applied.push({
          delta,
          before,
          after: field === 'active' ? next.combat.active : next.combat.round,
        });
        continue;
      }

      // 敌人列表 combat.foes：add（{name,hp,max}）/ remove（名字）/ dec（value=名字,amount=伤害）
      if (field === 'foes') {
        /*
         * 图鉴台账的**唯一写入点**。
         *
         * 放在这里而不是 store/UI：`combat.foes` 是"敌人存在过"的唯一真源，
         * 谁让它进了列表，谁就该记这一笔。三条路（模型 add、引擎 castFromBestiary、
         * 测试沙盒）都汇到这一个分支，不会漏。
         *
         * `encountered` = 它出现在战斗里（玩家见到了）；
         * `fought` = 它挨过打或死了（玩家真的跟它交过手，弱点才解锁）。
         */
        const markSeen = (name: string) => {
          const n = String(name ?? '').trim();
          if (!n) return;
          if (!Array.isArray(next.encountered)) next.encountered = [];
          if (!next.encountered.includes(n)) next.encountered.push(n);
        };
        const markFought = (name: string) => {
          const n = String(name ?? '').trim();
          if (!n) return;
          if (!Array.isArray(next.fought)) next.fought = [];
          if (!next.fought.includes(n)) next.fought.push(n);
          // 交手过必然也见过 —— 别让两张表互相矛盾
          markSeen(n);
        };

        if (delta.op === 'add') {
          // `value` 可能压根不是对象（模型写了个字符串、或整个忘了）
          // —— 一律当作"什么都没给"，走占位名 + 缺省血量，不许崩。
          const f = (delta.value && typeof delta.value === 'object' ? delta.value : {}) as Partial<Foe>;
          /*
           * 模型忘了起名字怎么办 —— **不许拒绝**。
           *
           * 原来这里直接 reject，后果是：模型正文里写"阴影里扑出一只东西"、
           * delta 里却忘了填 `name`，于是敌人根本没进列表，玩家**对着空气打**
           * （用户 2026-09-16 实测报过）。
           * 对一个把"接得住合理行动"当北极星的项目来说，这是最不该出现的一类失败：
           * 模型漏一个字段，代价不该由玩家承担。
           *
           * 所以退到「不明的东西」：它照样进列表、照样能被打、血条照样显示。
           * 名字丑一点无所谓 —— **玩家能开打** 远比名字好听重要。
           * 模型下一轮想给它起名，用 add 同名/改名的路径即可，不会卡死。
           */
          const rawName = String(f?.name ?? '').trim();
          const name = rawName || UNNAMED_FOE;
          const existing = next.combat.foes.find((x) => x.name === name);
          if (existing) {
            /*
             * 🔴 同名已存在 → **只收窄，绝不覆盖**（用户拍板 · 协作方第 21 版 P2-7）。
             *
             * 以前这里是直接覆盖 `hp` / `max`，于是模型**每轮重复 add 同一个敌人**
             * （非常常见的写法：它只是想确认"它还在场上"）就等于悄悄回满血。
             * 叠加 `fillFoeNumbers` 按模组表补数值，伤害被打回去、战斗永远打不完，
             * 而"状态变化"卡一个字都不提 —— 正踩「引擎权威」与「状态可见」两条。
             *
             * 现在的方向只有一边：
             *   - `hp` 取**小**：新申报的只能把它往下压，永远不能往上抬（绝不回血）；
             *   - `max` 取**大**：上限只许放宽，不许缩（缩上限等于凭空判它更脆）。
             * 字段没申报 → 一个字都不动。
             *
             * 想要一个满血的新敌人，正确路径是先 `remove` 再 `add`（那时的确是新建）。
             */
            if (typeof f.hp === 'number') existing.hp = Math.min(existing.hp, f.hp);
            if (typeof f.max === 'number') existing.max = Math.max(existing.max, f.max);
            // 上限放宽后，当前血量仍不许越过它
            if (existing.hp > existing.max) existing.hp = existing.max;
          } else {
            next.combat.foes.push({
              name,
              hp: typeof f.hp === 'number' ? f.hp : 10,
              max: typeof f.max === 'number' ? f.max : (typeof f.hp === 'number' ? f.hp : 10),
            });
          }
          markSeen(name);
          applied.push({ delta, before: null, after: deepClone(next.combat.foes) });
          continue;
        }
        if (delta.op === 'remove') {
          const name =
            typeof delta.value === 'string'
              ? delta.value
              : String((delta.value as Partial<Foe>)?.name ?? '');
          const idx = next.combat.foes.findIndex((x) => x.name === name);
          if (idx < 0) {
            rejected.push({ delta, reason: `战斗中不存在敌人「${name}」` });
            continue;
          }
          // 从战斗里被移除通常是"它死了"——死在这一局里，弱点当然算挣到了
          markFought(name);
          next.combat.foes.splice(idx, 1);
          /*
           * 🔴 `G24` 反面：**最后一个敌人被摘走 → 当场收场**，与 `dec` 打到 0 同口径。
           *
           * 真机那条"正文打死敌人、横幅还在、卡了三轮"就是漏了这一步：
           * 自动收场原来只挂在 `dec` 打到 0 那条路上，`remove` 走的是另一条。
           */
          if (next.combat.foes.length === 0) next.combat.active = false;
          applied.push({ delta, before: null, after: deepClone(next.combat.foes) });
          continue;
        }
        if (delta.op === 'dec' || delta.op === 'inc') {
          // value = 敌人名字，amount = 伤害/治疗（可骰子表达式）
          const name = String(delta.value ?? '');
          const foe = next.combat.foes.find((x) => x.name === name);
          if (!foe) {
            rejected.push({ delta, reason: `战斗中不存在敌人「${name}」` });
            continue;
          }
          /*
           * 1.0 阶段 C：**伤害由引擎按武器表掷**。
           *
           * 以前伤害是模型申报的（模型说扣 7 就扣 7）—— 权威在模型手里，
           * 而「引擎权威」是本项目第一条铁律。现在只要在 delta 上写了 `weapon`，
           * 引擎就查规则包的武器表、按那把武器的伤害骰掷一个出来。
           *
           * ⚠️ 两点刻意的取舍：
           *   ① **渐进增强**：没写 `weapon`（老契约、自定义包没填武器表）→ 完全走现状，一行不变；
           *   ② 认不出这把武器 → **照旧用模型给的 amount**，不 reject（模型漏字段不该由玩家承担）。
           */
          /*
           * 命中闸门：**用武器打**这一条路，先问"掷中了吗"。
           * 判据在 `ctx.foeDamage`（由 store 按"最近一次玩家检定"给出），
           * 只在守密人写了 weapon 时生效 —— 环境类伤害不吃这一闸。
           */
          if (delta.weapon?.trim() && ctx.foeDamage && ctx.foeDamage !== 'hit') {
            rejected.push({
              delta,
              /*
               * ⚠️ **话术单一真源**在 `core/state/refusal.ts`。
               * 这里原来是「这一下没打中（攻击检定没过）」—— 把"伤害不成立"说成了
               * "你没打中"，而玩家卡片上那一掷可能显示**成功**，于是屏幕上两句话打架
               * （用户 2026-09-30 亲报的"检定通过却说我打歪了"）。
               */
              reason: attackRejectedReason(name, ctx.foeDamage as AttackGrant, true),
            });
            continue;
          }
          let amount: number;
          const wd = delta.weapon?.trim() ? findWeapon(ctx.ruleset, delta.weapon) : undefined;
          if (wd) {
            const outcome = roll(wd.damage, rng);
            rolls.push({ expression: outcome.expression, total: outcome.total });
            amount = outcome.total;
          } else if (typeof delta.amount === 'number') {
            amount = delta.amount;
          } else if (typeof delta.amount === 'string') {
            const outcome = roll(delta.amount, rng);
            rolls.push({ expression: outcome.expression, total: outcome.total });
            amount = outcome.total;
          } else {
            rejected.push({ delta, reason: 'combat.foes dec 缺少 amount 或 weapon' });
            continue;
          }
          const before = foe.hp;
          foe.hp =
            delta.op === 'dec'
              ? Math.max(0, foe.hp - amount)
              : Math.min(foe.max, foe.hp + amount);
          /*
           * "打过"只认**造成伤害**这一种。
           * 被治疗（inc）不算交手——那只是有人在给它续命。
           * 玩家朝它开了一枪（哪怕没打中，扣血的是它）= 真的试过深浅了。
           */
          if (delta.op === 'dec' && foe.hp < before) markFought(name);
          applied.push({ delta, before, after: foe.hp });

          /*
           * 🔴 打空即倒下 —— **引擎自己判**（P1-5 阶段 1，主人 2026-09-27 真机）。
           *
           * 以前这里只是把数字减到 0 就完事：`combat.foes` 里那条还在，
           * 血条停在 0、战斗不结束、轮次也不再动 —— 玩家的原话是
           * "敌人血量归零还活着，战斗轮还在，血条不消失，一直停留在第一轮"。
           *
           * 为什么必须由引擎判而不是等守密人写 `remove`：这正是 `P2-10` 那个老坑
           * （字段与读取都有，**没人写它**）。守密人忘写一次，这场架就永远打不完。
           * 引擎手里已经有"它只剩 0 血"这个事实，判据就该在这里落地。
           *
           * 两句刻意的：
           *   ① **移除整条**（不是标个"已倒下"）—— 空血的敌人留在 `combat.foes` 里
           *      会继续被提示词当成"在场"，守密人下一轮还在演它行动；
           *   ② **最后一个倒下 → 自动收场**（`combat.active=false`）。
           *      战斗结束不再依赖守密人记得写那一句；他仍可以**提前**收场（逃走 / 投降 / 玩家脱离），
           *      那条路一点没变。
           */
          if (foe.hp <= 0) {
            next.combat.foes = next.combat.foes.filter((x) => x.name !== name);
            if (next.combat.foes.length === 0) next.combat.active = false;
          }
          continue;
        }
        rejected.push({ delta, reason: `combat.foes 不支持操作 ${delta.op}` });
        continue;
      }

      rejected.push({ delta, reason: `combat 不支持修改「${field ?? '(空)'}」` });
      continue;
    }

    // --- 地点：location（顺带记录到 visited，供地图迷雾用） ---
    if (root === 'location') {
      if (delta.op !== 'set') {
        rejected.push({ delta, reason: 'location 只支持 set' });
        continue;
      }
      const before = next.location;
      next.location = String(delta.value ?? '');
      // 去过的地方记下来：地图只展示"玩家知道的地方"，避免开局把整张图摊开剧透
      if (next.location.trim()) {
        if (!next.visited) next.visited = [];
        if (!next.visited.includes(next.location.trim())) next.visited.push(next.location.trim());
      }
      applied.push({ delta, before, after: next.location });
      continue;
    }

    // --- 自由字段：flags / npcsAlive ---
    if (delta.op !== 'set') {
      rejected.push({ delta, reason: `${root} 只支持 set` });
      continue;
    }
    const before = getPath(next, delta.target);
    setPath(next as unknown as Record<string, unknown>, delta.target, delta.value);
    applied.push({ delta, before, after: delta.value });
  }

  /*
   * ── 故事时钟推进（引擎侧，最后统一做一次）────────────────────
   *
   * 为什么放在最后、而不是当成一条 delta：时间**不是**模型能直接改的字段
   * （`clock` 不进 `ALLOWED_ROOTS`）。它只能申报"过了多久"，
   * 由这里折算并推进 —— 与骰子同一条分工：模型报量，引擎数数。
   *
   * 时钟真的动了的话，**记一条 applied**：界面上的"状态变化"提示、
   * 以及编年史都靠它才知道"这一轮时间过去了"（状态可见属于框架，不是特效）。
   */
  if (ctx.elapsed !== undefined) {
    const beforeClock = next.clock;
    const tick = tickClock(beforeClock, next.deadline, ctx.elapsed, {
      floorMinutes: ctx.clockFloor,
      capMinutes: ctx.clockFloor,
    });
    if (tick.elapsedMinutes > 0) {
      next.clock = tick.clock;
      next.deadline = tick.deadline;
      /*
       * 只有"值得说一声"的推进才记账（跨天 / 换了时段）。
       * 理由：每一轮都推个十分钟是正常的，每轮都弹一条"时间过去了十分钟"
       * 就成了噪声；而跨天、入夜是**玩家真的会关心**的变化。
       */
      if (tick.noteworthy) {
        applied.push({
          delta: {
            target: 'clock',
            op: 'set',
            value: clockLabel(tick.clock),
            reason: '时间推进',
          },
          before: clockLabel(beforeClock),
          after: clockLabel(tick.clock),
        });
      }
    }
  }

  /*
   * 🔴 `G24` **反面**（协30 §2.2）：**空场不许保持战斗** —— 在收口处按**最终结果**归一。
   *
   * 真机：正文把敌人打死了 → `foes: []`，而 `active` 仍是 true，横幅「战斗中 · 第 4 轮」卡了三轮
   * （自动收场原来只挂在 `dec` 打到 0 那条路上，`remove` 走的是另一条）。
   *
   * ⚠️ 刻意**不逐条拒** `active=true`：模型不保证写成"先 add 敌人、再开打"，
   * 「先写 `active=true`、同一批里再 `add` 敌人」是完全合法的顺序，
   * 逐条判会把它当"空场开战"误杀（我第一版就是这么写的，被既有用例逮到）。
   * 放到这里按最终结果归一：效果等同于"拒"，但不会给玩家的状态栏刷噪音。
   */
  if (next.combat?.active && (next.combat.foes ?? []).length === 0) {
    next.combat.active = false;
  }

  return { state: next, applied, rejected, rolls, lethal };
}

/** 理智/生命触发的状态事件，由引擎检测、模型只负责演出 */
export interface StatusEvent {
  kind: 'temp_insanity' | 'permanent_insanity' | 'dying' | 'death';
  text: string;
}

/**
 * 从本轮 applied 变更里检测触发的状态事件（COC 核心机制）：
 * - 单次理智损失 ≥ 5 → 临时疯狂
 * - 理智归零 → 永久疯狂
 * - 生命归零 → 濒死；生命 < 0 → 死亡
 */
export function detectStatusEvents(applied: AppliedDelta[], state: GameState): StatusEvent[] {
  const events: StatusEvent[] = [];
  for (const a of applied) {
    if (
      a.delta.target === 'vitals.san' &&
      typeof a.before === 'number' &&
      typeof a.after === 'number'
    ) {
      const loss = a.before - a.after;
      if (loss >= 5) {
        events.push({ kind: 'temp_insanity', text: `理智骤降 ${loss} 点，陷入临时疯狂` });
      }
    }
  }
  const san = state.vitals.san;
  if (typeof san === 'number' && san <= 0) {
    events.push({ kind: 'permanent_insanity', text: '理智归零，永久疯狂' });
  }
  const hp = state.vitals.hp;
  if (typeof hp === 'number' && hp < 0) {
    events.push({ kind: 'death', text: '生命值跌破零点，濒临死亡' });
  } else if (typeof hp === 'number' && hp === 0) {
    events.push({ kind: 'dying', text: '生命值归零，濒死' });
  }
  return events;
}

/*
 * 注：伤口的**检测**逻辑没有放在这里，而是在 `src/ui/store.ts` 的
 * `applyModelDeltas` 里就地做。原因是它需要的东西这里没有也不能有：
 * 角色卡的技能（判"会不会急救"）、背包（判"有没有医疗物品"）、
 * 以及"出生那一轮不重复失血"这种跟调用时序相关的状态。
 * 纯数学部分（档位、流失量、止血判据）都在 `core/wounds.ts`，那里是可单测的真源；
 * 这里只 re-export 类型，让 `GameState.wounds` 有出处。
 */
export type { WoundTier } from '../wounds.js';
