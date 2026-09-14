/**
 * 结构化游戏状态 —— 唯一真相来源
 *
 * 关键设计：模型输出的只是"变更意图"（state_delta），
 * 真正的数值计算与边界裁剪全部发生在这里，模型算的数一律不作数。
 */

import { roll, type Rng } from '../dice/index.js';
import type { Ruleset } from '../rulesets/types.js';

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

export interface GameState {
  /** 生命 / 理智 / 魔法等数值条，key 由规则包定义 */
  vitals: Record<string, number>;
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
  'combat',
  'threads',
]);

export function createInitialState(overrides: Partial<GameState> = {}): GameState {
    return {
      vitals: {},
      vitalsMax: {},
      companions: [],
      inventory: [],
      flags: {},
      clues: [],
      threads: [],
      location: '',
      visited: [],
      npcsAlive: [],
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
