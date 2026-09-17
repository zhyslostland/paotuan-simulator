/**
 * 伤口 / 流血系统（引擎侧持续伤害 DOT）。
 *
 * ## 为什么要有这一层
 * 用户 2026-09-16 实测报过两件事：
 *   - "我包扎了，怎么还隔段时间掉血？"
 *   - "我总共就 10 滴血，也太刺激了。"
 * 根因是：**流血完全由模型自由发挥**，引擎里根本没有"伤口"这个概念。
 * 它可能这一轮说止住了、下一轮又忘了；也可能一路扣到死，扣多少全凭手感。
 *
 * 这一层把"伤口"从叙事里拎进引擎：
 *   - 伤口由**引擎**检测（本轮主生命条掉到一定幅度）或**守密人**显式申报；
 *   - 每轮结算点按**固定小额度**扣血，扣多少由这里定，不由模型即兴；
 *   - **止血三依据**（有医疗物品 / 有急救类技能 / 两样都没有）决定能不能止、止得多快；
 *   - 解除后必须清 flag，状态栏跟着消失（"状态变化必须可见"）。
 *
 * ## 为什么额度这么小
 * "扣血幅度克制"是用户的原话。10 滴血的角色每轮被扣 3 点，两轮就死了——
 * 那不是紧张，那是劝退。所以：
 *   - 出血**固定 1 点/轮**（不掷骰、不叠加、不受规则包影响）；
 *   - **重伤**才会到 2 点/轮，且必须真的发生过大幅伤害；
 *   - 濒死（主生命见底）时**一律冻结**，与 `DYING_FREEZE_REASON` 同一条口径。
 *
 * ## 与濒死冻结的关系
 * `gameState.ts` 的濒死冻结拦的是**模型发来的**生命下降。这里的 DOT 是**引擎自己**发的，
 * 走同一条 `applyDeltas` 通道也一样会被拒——这是**故意的**：
 * 已经倒地的人不该被伤口继续放血。见 `shouldBleed()`。
 */

import type { InventoryItem } from './state/gameState.js';

/**
 * 伤口结构。**这里只是结构定义**——`GameState.wounds` 引用这个类型，
 * 所以定义在 `wounds.ts`（低层）而不是 `gameState.ts`（高层），
 * 否则两边互相 import 会成环。
 */
export interface Wound {
  /** 稳定 id，用于去重与"止住哪一处" */
  id: string;
  /** 一句话描述（"左臂被划开的口子"），界面直接显示 */
  text: string;
  tier: WoundTier;
  /** 已经流了几轮 */
  turns: number;
}

/** 伤口档位 */
export type WoundTier = 'scratch' | 'wound' | 'severe';

/** 每轮流失量：刻意的克制。用户原话"10 滴血太刺激了" */
const BLEED_PER_TURN: Record<WoundTier, number> = {
  scratch: 1,
  wound: 1,
  severe: 2,
};

/** 档位中文名（告警色 / 状态栏用） */
const TIER_LABEL: Record<WoundTier, string> = {
  scratch: '擦伤',
  wound: '伤口',
  severe: '重伤',
};

/** 单次伤害达到多少算"留下伤口"。与 `detectStatusEvents` 的理智阈值同思路，但更宽——血比理智经得住掉 */
const WOUND_THRESHOLD = 2;
/** 单次伤害达到多少算"重伤" */
const SEVERE_THRESHOLD = 4;

/**
 * 医疗物品判据。
 *
 * 只认**明确的医疗品**，不认"任何物品"——否则玩家拿着一把枪也算"有医疗物品"，
 * 止血就变成了必然成功，三依据就退化成一条。
 */
const MEDICAL_ITEM_RE =
  /绷带|纱布|止血|药|酒精|消毒|碘|绷|shears|医疗|急救箱|药膏|消炎|缝针|针线|血浆|绷|创可贴|敷料/;

/**
 * 急救类技能判据。
 *
 * 技能名走 `canonicalSkillName()` 之后是规则包里的标准名，
 * COC 是「急救」「医学」，DnD 是「医药」。这里同时覆盖简繁与常见别名。
 */
const FIRST_AID_SKILL_RE = /急救|医学|医疗|医药|治疗|护理|外科|first\s*aid|medicine/i;

export interface HealBasis {
  /** 有医疗物品吗 */
  item: boolean;
  /** 命中的医疗物品名（给文案用） */
  itemName?: string;
  /** 有急救类技能吗 */
  skill: boolean;
  /** 命中的技能名 + 值 */
  skillName?: string;
  /** 技能值（用于判断"医术好"能不能一次止住） */
  skillValue?: number;
}

/**
 * 止血三依据：从背包与技能表里读出"玩家能不能止住血"。
 *
 * 三档结果（与 `woundRelief()` 配合）：
 *   - 有物品 + 有技能 → 一次就止住；
 *   - 只有一样 → 需要两轮（或守密人给个理由也能一轮）；
 *   - 两样都没有 → **止不住**，只能等伤势自己收（或去找人帮忙）。
 *
 * 为什么"两样都没有"也允许存在：这是用户报的原场景——
 * "简单包扎、无技能无物品时不该要求检定"。我们既不要求检定，也不假装成功：
 * 伤口就这么流着，直到有人给它一个真正的处理。
 *
 * ## 判据只看**角色卡**
 * 早期版本还去翻规则包的 `skillCatalog`，想着"卡上没写全时兜一下"。
 * 那是错的：COC 的目录里**人人都列着「急救」**（基础值 30%），
 * 于是每个角色都被判成"会急救"，三依据退化成一依据，止不住那条路根本走不到。
 * 会不会急救是**这个人**的属性，只能看他卡上真的投过点没有。
 */
export function healBasis(
  inventory: readonly InventoryItem[],
  skills: Record<string, number> | undefined
): HealBasis {
  const hitItem = (inventory ?? []).find((it) => MEDICAL_ITEM_RE.test(it?.name ?? ''));
  const entries = Object.entries(skills ?? {}).filter(([, v]) => Number(v) > 0);
  const hitSkill = entries.find(([name]) => FIRST_AID_SKILL_RE.test(name));
  return {
    item: Boolean(hitItem),
    itemName: hitItem?.name,
    skill: Boolean(hitSkill),
    skillName: hitSkill?.[0],
    skillValue: hitSkill ? Number(hitSkill[1]) || 0 : undefined,
  };
}

/**
 * 一轮能"收"掉多少。
 *
 * 全依据（物品 + 技能）→ 直接止住（返回 'stop'）；
 * 只有一半依据 → 每轮推进一档（'relief'）；
 * 什么都没有 → 没进展（'none'）。
 *
 * 注意这里回的是**定性**结果，不是数字——"止住"由调用方改成 flag 与叙事，
 * 引擎不替守密人写"你包扎得很成功"。
 */
export type Relief = 'stop' | 'relief' | 'none';

export function woundRelief(basis: HealBasis): Relief {
  if (basis.item && basis.skill) return 'stop';
  if (basis.item || basis.skill) return 'relief';
  return 'none';
}

/** 从一轮里受到的伤害推出伤口（null = 没伤到留伤口） */
export function woundFromDamage(amount: number): WoundTier | null {
  if (!Number.isFinite(amount) || amount < WOUND_THRESHOLD) return null;
  return amount >= SEVERE_THRESHOLD ? 'severe' : 'wound';
}

/** 从文本里认一个伤口档位（守密人显式申报 `flags.伤口` 时用） */
export function woundTierFromText(text: string): WoundTier {
  if (/重伤|大出血|动脉|贯穿|碎裂|重度/.test(text)) return 'severe';
  if (/擦伤|划痕|轻微|浅浅/.test(text)) return 'scratch';
  return 'wound';
}

/** 稳定 id：同一处伤口在多轮里要能被认出来（用于去重与"止住哪一处"） */
function woundId(text: string): string {
  const t = text.trim().replace(/[「」【】\s]/g, '');
  return t.slice(0, 12) || 'wound';
}

/** 从文本造一处伤口（自动去重：同名不重复计） */
export function parseWound(text: string, existing: readonly Wound[] = []): Wound | null {
  const t = String(text ?? '').trim();
  if (!t) return null;
  const id = woundId(t);
  if (existing.some((w) => w.id === id)) return null;
  return { id, text: t, tier: woundTierFromText(t), turns: 0 };
}

/** 该处伤口每轮流多少 */
export function bleedAmount(w: Pick<Wound, 'tier'>): number {
  return BLEED_PER_TURN[w.tier] ?? 1;
}

/** 全部伤口每轮合计流多少 —— 但是**不叠加**：取最大值，见文件头"克制" */
export function totalBleed(wounds: readonly Pick<Wound, 'tier'>[]): number {
  if (!wounds?.length) return 0;
  return Math.max(...wounds.map(bleedAmount));
}

/** 档位中文名 */
export function woundLabel(tier: WoundTier): string {
  return TIER_LABEL[tier] ?? '伤口';
}

/**
 * 结痂：哪些伤口会**光靠时间自己收口**，以及各要几轮。
 * 没列进来的（`severe`／重伤）＝**不会自己好**，必须有人处理。
 *
 * ## 为什么必须有这一档（协作方第 7 版 §2.2 抓到的）
 * v0.3.0 只做了"止血三依据"，**没有按轮自愈**。于是"既没有医疗物品、也不会急救"
 * 的角色，一处擦伤会一直流到死（10 滴血 ≈ 10 轮见底）——
 * 这正是用户报过的"我总共就 10 滴血，也太刺激了"，只是这一次由引擎在**稳定地**执行，
 * 比模型即兴扣血更难躲。更新日志里我还写了"伤口会自己慢慢结痂"，更是等于承诺了没做的东西。
 *
 * ## 为什么 `wound` 也自愈（比协作方建议的"只给 scratch"多一档 —— 这是我的判断）
 * 引擎自己检出的伤口走 `woundFromDamage()`：单次 2~3 点伤害得到的是 **`wound`**，
 * `scratch` 只在守密人写明"擦伤/划痕/轻微"时才出现。
 * 只让 `scratch` 自愈的话，**最常见的那一档照样流到死**，用户那条抱怨原样复发。
 * 现实里普通伤口也会凝血结痂，只是慢一些；最重的 `severe`（贯穿 / 大出血）留着给人处理 ——
 * 这样"止血三依据"对真正危险的那档依然有意义，不至于退化成"等等就好"。
 */
const SELF_HEAL_TURNS: Partial<Record<WoundTier, number>> = {
  scratch: 3,
  wound: 6,
};

/** 这处伤口**单纯靠时间**结痂了没有（只看档位与已经流了几轮） */
export function healedByTime(w: Pick<Wound, 'tier' | 'turns'>): boolean {
  const n = SELF_HEAL_TURNS[w?.tier];
  return n !== undefined && (w?.turns ?? 0) >= n;
}

/**
 * 没写理由时给伤口的默认描述。
 *
 * 守密人（模型）写 `state_delta` 时经常不填 `reason`，那时伤口不能没有名字——
 * 界面要显示、叙事要引用。这里给一个**中性、不编造具体部位**的兜底：
 * 我们不知道它是被咬的还是被摔的，就不该假装知道。
 */
export function defaultWoundText(tier: WoundTier): string {
  return tier === 'severe' ? '身上的重伤' : tier === 'scratch' ? '身上的擦伤' : '身上未处理的伤口';
}

/**
 * 状态栏用的一句话（进 `flags.伤口`）。
 * 带上档位与轮数，玩家一眼能看出"还在流 / 流了多久"。
 */
export function woundFlagText(wounds: readonly Wound[]): string | null {
  if (!wounds?.length) return null;
  const worst = [...wounds].sort((a, b) => bleedAmount(b) - bleedAmount(a))[0]!;
  const extra = wounds.length > 1 ? `（共 ${wounds.length} 处）` : '';
  return `${woundLabel(worst.tier)}·每轮 -${bleedAmount(worst)}${extra}`;
}

/**
 * 这一轮该不该真的扣血。
 *
 * 两个否决条件（都是"别把人往死里逼"）：
 *   ① **濒死/归零**：主生命条已经见底 —— 与濒死冻结同一条口径，倒地的人不再被放血；
 *   ② 已经在本轮的 delta 里被扣到见底 —— 由调用方按 min 判断。
 *
 * 剩下的：一次扣 `totalBleed()`，不改难度档、不改上限，就是一个确定性的 dec。
 */
export function shouldBleed(opts: {
  wounds: readonly Wound[];
  hp: number | undefined;
  hpMin: number;
  dying?: boolean;
  ending?: boolean;
}): boolean {
  if (opts.ending) return false;
  if (!opts.wounds?.length) return false;
  if (opts.dying) return false;
  if (typeof opts.hp !== 'number') return false;
  return opts.hp > opts.hpMin;
}

/** 造一条"流失"的 delta（引擎自己发的，reason 会进 rejected 判据但不走白名单） */
export function bleedDelta(amount: number): {
  target: string;
  op: 'dec';
  amount: number;
  reason: string;
} {
  return {
    target: 'vitals.hp',
    op: 'dec',
    amount,
    reason: `伤口持续失血（每轮 -${amount}）`,
  };
}

/**
 * 给守密人的一句话（只在有伤口时注入）。
 * 与 `encumbranceNote` 同理：**不给数字**，只交代体感与可行的处置方式，
 * 且明确"止血要看依据"——避免它写得比引擎还狠。
 */
export function woundNote(
  wounds: readonly Wound[],
  basis: HealBasis,
  relief: Relief
): string | null {
  if (!wounds?.length) return null;
  const worst = [...wounds].sort((a, b) => bleedAmount(b) - bleedAmount(a))[0]!;
  const head =
    `【伤口】玩家身上有未处理的伤：${wounds.map((w) => w.text).join('、')}（最重的是${woundLabel(worst.tier)}）。` +
    `引擎会按轮给他持续失血（**每轮固定 ${bleedAmount(worst)} 点，不会更多**），这不是你能加的，也不要替他加重。\n`;
  const tail =
    relief === 'stop'
      ? '- 他手上有医疗用品、也会急救 —— **这一轮可以让他真正止住血**（他描述到位就写成止住，引擎会跟着清掉状态）。\n'
      : relief === 'relief'
        ? '- 他手上有医疗条件但不够充分 —— 可以做**临时处理**（压住、缠紧），血会慢慢收，但别写成"完全好了"。\n'
        : '- 他**既没有医疗物品、也不会急救** —— 简单的按一按、扯块布缠上**止不住**这个伤。' +
          '你可以把这件事写成场景里的一个事实（血很快又渗出来），但**不要要求他掷骰**，也不要替他宣告失败。';
  return (
    head +
    tail +
    '- **不要写任何数字**，不要出现"流血/持续伤害/每轮扣血"这类系统词；把它写成身体的感觉（发凉、发黏、视野边缘发暗）。\n' +
    '- 不要因为伤口替他做决定：他可以忍着继续走、可以找人帮忙、也可以就地处理。\n' +
    '- 伤口处理到位时，请通过叙事明确"止住了"，并让引擎把状态清掉——**别一边说止住了、一边还在渗血**。'
  );
}
