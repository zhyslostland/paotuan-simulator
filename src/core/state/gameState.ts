/**
 * 结构化游戏状态 —— 唯一真相来源
 *
 * 关键设计：模型输出的只是"变更意图"（state_delta），
 * 真正的数值计算与边界裁剪全部发生在这里，模型算的数一律不作数。
 */

import { roll, type Rng } from '../dice/index.js';
import { isLifeVital, type Ruleset } from '../rulesets/types.js';
import { type Wound } from '../wounds.js';
import { type BestiaryEntry } from '../bestiary.js';

export type { Wound };
export type { BestiaryEntry };

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
  /** 战斗轮状态 */
  combat: CombatState;
}

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
  /** 本轮掷过的骰子，用于渲染骰点动画 */
  rolls: { expression: string; total: number }[];
}

const ALLOWED_ROOTS = new Set([
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
  'wounds',
  /*
   * 注意这里**没有** `encountered` / `fought`。
   *
   * 这两张图鉴台账（R38）是**引擎独占**的：`combat.foes` 分支里直接改 `next`，
   * 不经过白名单。放进白名单就等于给模型开了一扇门——它会顺手把"听说过的东西"
   * 塞进来，图鉴就变成它自己的记忆本，而不是玩家真见过的清单（G5）。
   * 模型写出这两个根＝落到下面的 `不允许修改的路径根` 拒绝分支。
   * 判据：凡"只由引擎写"的表，一律不进 ALLOWED_ROOTS。
   */
]);

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
 */
export function applyDeltas(
  state: GameState,
  deltas: StateDelta[],
  ctx: { rng?: Rng; ruleset?: Ruleset; vitalsMax?: Record<string, number> } = {}
): ApplyReport {
  const next = deepClone(state);
  // 兼容旧存档：早期保存的状态没有 combat / threads 字段，这里补默认值
  if (!next.combat) next.combat = { active: false, round: 0, foes: [] };
  if (!Array.isArray(next.combat.foes)) next.combat.foes = [];
  if (!Array.isArray(next.threads)) next.threads = [];
  const applied: AppliedDelta[] = [];
  const rejected: RejectedDelta[] = [];
  const rolls: { expression: string; total: number }[] = [];
  const rng = ctx.rng ?? Math.random;

  for (const delta of deltas) {
    if (!delta || typeof delta.target !== 'string') {
      rejected.push({ delta, reason: 'delta 缺少合法的 target' });
      continue;
    }

    const [root, ...rest] = delta.target.split('.');
    if (!root || !ALLOWED_ROOTS.has(root)) {
      rejected.push({ delta, reason: `不允许修改的路径根：${root ?? '(空)'}` });
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
        rejected.push({ delta, reason: `vitals 不支持操作 ${delta.op}` });
        continue;
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
       */
      if (isLifeVital(def, vitalKey) && after < before) {
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
          next.combat.active = Boolean(delta.value);
        } else {
          const n = Number(delta.value);
          next.combat.round = Number.isFinite(n) ? Math.max(0, Math.floor(n)) : next.combat.round;
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
          const f = delta.value as Partial<Foe>;
          if (!f?.name) {
            rejected.push({ delta, reason: 'combat.foes add 需要 name' });
            continue;
          }
          const existing = next.combat.foes.find((x) => x.name === f.name);
          if (existing) {
            existing.hp = typeof f.hp === 'number' ? f.hp : existing.hp;
            existing.max = typeof f.max === 'number' ? f.max : existing.max;
          } else {
            next.combat.foes.push({
              name: f.name,
              hp: typeof f.hp === 'number' ? f.hp : 10,
              max: typeof f.max === 'number' ? f.max : (typeof f.hp === 'number' ? f.hp : 10),
            });
          }
          markSeen(f.name);
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
          let amount: number;
          if (typeof delta.amount === 'number') amount = delta.amount;
          else if (typeof delta.amount === 'string') {
            const outcome = roll(delta.amount, rng);
            rolls.push({ expression: outcome.expression, total: outcome.total });
            amount = outcome.total;
          } else {
            rejected.push({ delta, reason: 'combat.foes dec 缺少 amount' });
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

  return { state: next, applied, rejected, rolls };
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
