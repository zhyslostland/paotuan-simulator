/**
 * 技能与属性 —— 从 `ui/store.ts` 搬出来的**纯函数**（2026-09-19 · 优化计划 D 档）。
 *
 * ## 为什么搬
 * `store.ts` 长到 14 万字符，改一处得先读几千行才敢下手；而这些函数：
 * 不碰 store、不碰 IO、只吃参数吐结果 —— 它们本来就该住在 `core/`。
 *
 * ## 与 store 的关系
 * 签名里的角色卡原来写的是 `CharacterProfile`（定义在 `ui/store.ts`）。
 * 这里换成**结构类型** `SkillHolder`：只声明真正用到的两个字段。
 * TS 是结构化类型，`CharacterProfile` 自动满足它 ——
 * 于是 **core 不需要反向 import ui**（铁律 13 守住了）。
 *
 * `store.ts` 仍把这些名字 re-export 出去，**调用点一行都不用改**。
 */
import { getRuleset } from './rulesets/index.js';

/**
 * 这里只声明真正用到的字段，不引用 `ui/store.ts` 的 `CharacterProfile`。
 * （结构类型：谁有这两样，谁就能传进来。）
 */
export interface SkillHolder {
  characteristics: Record<string, number>;
  skills: Record<string, number>;
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
/**
 * 属性默认值由规则包提供，换规则就自动换一套属性。
 *
 * **不能直接填 `d.default`**：COC 的 default 是 50，八个属性全套 50
 * 意味着"力量、体质、智力、教育完全一样"——那不是一个活人，是一张表格。
 * （用户 2026-09-16 实测反馈："默认模组里面的人物属性是不是太平均了"。）
 *
 * 这里按 `(rulesetId, 属性下标)` 做一次**确定性散列**，给每个属性一个固定的偏移。
 * 为什么必须确定性：这个函数在"缺省回退"（角色卡里没填的属性）与"新建角色"两处被调用，
 * 每次返回不同的值会让界面上的数字自己跳。
 *
 * 摆幅按规则包的属性全幅算：COC（1-99）得到 ±20，落在 30-70；
 * DnD（3-18）全幅小，改用更大的比例，得到 ±6，落在 4-16（贴近标准数组的手感）。
 */
export function defaultCharacteristics(rulesetId = 'coc7'): Record<string, number> {
  const rs = getRuleset(rulesetId);
  return Object.fromEntries(
    rs.characteristicDefs.map((d, i) => {
      const span = Math.max(d.max - d.min, 1);
      const swing = Math.max(3, Math.round(span * (span < 20 ? 0.4 : 0.2)));
      const off = Math.round(deterministicUnit(`${rulesetId}#${d.key}`) * swing);
      const v = Math.max(d.min, Math.min(d.max, d.default + off));
      return [d.key, v];
    })
  );
}
/**
 * 属性点预算 —— "给多少点、现在用了多少"。
 *
 * ## 用户报的问题
 * 主人 2026-09-17 报「属性上限/总额设定」：属性栏只有一个一个数字，
 * 没有任何东西告诉玩家"这套属性总共该是多少点"。
 * 玩家（和模型）可以随手把每一项都拉到 90 —— 那是一个神，不是调查员，
 * 而且他**不知道自己在做一件超出规则的事**。
 *
 * ## COC 7e 的口径
 * 规则书给的是"八项属性总计 460 点"（平均 57.5），单项上限 99、
 * 且**教育（EDU）另算**（年龄与学历决定，不参与 460 分配）。
 * 这里就按这个口径：上限 = 460，参与项 = 除 edu 之外的全部。
 *
 * ## DnD 那一侧
 * 标准数组是 15/14/13/12/10/8（总 72），但玩家常按 27 点购点。
 * 两者都常见，硬选一个会误伤另一半人 —— 所以**DnD 只给每项的范围校验，
 * 不给总额约束**（`total: null`），界面上只显示"单项 3-18"。
 *
 * 判据：**规则包没给的就不要编**（与负重、carryCapacity 同一条纪律）。
 * 自定义规则包大多没有这条规矩，那就什么都不显示、什么都不拦。
 */
export function characteristicBudget(
  rulesetId: string,
  characteristics: Record<string, number>
): { total: number | null; spent: number; remaining: number | null; min: number; max: number } {
  const rs = getRuleset(rulesetId);
  const defs = rs.characteristicDefs;
  const min = defs.length ? Math.min(...defs.map((d) => d.min)) : 0;
  const max = defs.length ? Math.max(...defs.map((d) => d.max)) : 0;
  const spent = defs.reduce((sum, d) => {
    const v = characteristics[d.key];
    return sum + (typeof v === 'number' && Number.isFinite(v) ? v : 0);
  }, 0);

  /*
   * 只给 COC 这一套（1d100 量纲）算总额。
   * DnD 用 d20、属性是 3-18 的小数字，460 这个数对它毫无意义。
   */
  if (rs.mainDice !== '1d100') return { total: null, spent, remaining: null, min, max };

  const total = 460;
  return { total, spent, remaining: total - spent, min, max };
}
/** 由字符串得到 [-1, 1] 的确定性伪随机数（同一个串永远同一个值） */
function deterministicUnit(seed: string): number {
  let h = 2166136261;
  for (let i = 0; i < seed.length; i++) {
    h ^= seed.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return ((h >>> 0) % 2001) / 1000 - 1;
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
/**
 * 需要武器才能掷的技能名（射击 / 投掷 / 弓）。
 *
 * ⚠️ 2026-09-19 全盘彻查：这个正则原本在 `CharacterSheet.tsx` **写了两遍**
 * （描述加权一处、技能按钮一处），两处各自 `some()` 判背包 —— 同一判断两个真源，
 * 改一处漏一处就会出现"这边禁用了、那边还让掷"。现在收成下面两个函数，
 * **UI 只 import，不许再自己写 `/射击|投掷|弓/`**。
 */
export const WEAPON_SKILL_RE = /射击|投掷|弓/;

/** 这个技能需不需要武器？需要就返回技能名（拿去跟背包的 `skill` 对），不需要返回 null */
export function requiredWeaponFor(skillName: string): string | null {
  const n = (skillName ?? '').trim();
  return n && WEAPON_SKILL_RE.test(n) ? n : null;
}

/** 结构类型：只声明"是不是武器、绑哪个技能"，避免 core 反向依赖 ui 的 `InventoryItem` */
export interface WeaponLike {
  kind?: string;
  skill?: string;
}

/**
 * 需要武器但手里没有 —— 这是**硬闸门**，不是提示。
 * 技能值不等于手里有东西：没有枪就不该有这一次掷骰
 * （用户 2026-09-16 实测：手枪被误扣后系统还在给他触发手枪检定）。
 */
export function weaponMissingFor(skillName: string, items: readonly WeaponLike[]): boolean {
  const need = requiredWeaponFor(skillName);
  if (need == null) return false;
  return !(items ?? []).some((i) => i.kind === 'weapon' && (i.skill ?? '').trim() === need);
}

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
  character: SkillHolder,
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
  character: SkillHolder,
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

/**
 * `G10` + `G22`（协30 §2.5）：**AI 生成的技能表在落盘前按预算封顶**。
 *
 * ## 病在哪
 * 手工加点走 `setSkillValue` 的 `skillBudget` 封顶，**AI 生成那条路没有走**——
 * 真机生成出来的是「已用 333 / 剩余 −23」（预算 310）。与 `P2-10` / `G1` 同一类坑：
 * **写了约束 ≠ 引擎在执行**（v1.7.9 只加了提示词"用尽但绝不超支"）。
 *
 * ## 怎么削
 * 投入点数（值 − 该技能在规则包里的基础值）**从多到少**依次削，削到不超为止；
 * 最多把某一项削回它的基础值（不会把它削到基础值以下 —— 那等于改了这张卡的设定）。
 * 已经在预算内的原样返回（不动一个字）。
 */
export function capSkillsToBudget(
  skills: Record<string, number>,
  characteristics: Record<string, number>,
  rulesetId: string
): Record<string, number> {
  const rs = getRuleset(rulesetId);
  const total = skillBudget({ characteristics, skills }, rulesetId).total;
  const baseMap = new Map(rs.skillCatalog.map((s) => [s.name, s.base]));
  const rows = Object.entries(skills).map(([name, value]) => {
    const base = baseMap.get(canonicalSkillName(name, rs)) ?? 0;
    return { name, value, spent: Math.max(0, value - base) };
  });
  let over = rows.reduce((sum, r) => sum + r.spent, 0) - total;
  if (over <= 0) return skills;

  const out: Record<string, number> = { ...skills };
  for (const r of [...rows].sort((a, b) => b.spent - a.spent)) {
    if (over <= 0) break;
    if (r.spent <= 0) continue;
    const cut = Math.min(r.spent, over);
    out[r.name] = r.value - cut;
    over -= cut;
  }
  return out;
}
