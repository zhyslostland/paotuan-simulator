/**
 * 龙与地下城 5e（轻量版）规则包
 *
 * 定位是"辅以 dnd"——不需要还原整套 DnD 的专长、法术位、动作经济，
 * 只要把最核心的 d20 检定手感接进来：掷 1d20 + 加值，跟 DC 比大小。
 * 数值维度同样刻意压低，方便模型不犯错。
 */

import type {
  CharacteristicDef,
  CheckResult,
  CheckTier,
  Difficulty,
  Ruleset,
  SkillDef,
  VitalDef,
} from './types.js';

const TIER_LABELS: Record<CheckTier, string> = {
  critical: '大成功（暴击）',
  extreme: '极难成功',
  hard: '强成功',
  regular: '成功',
  failure: '失败',
  fumble: '大失败',
};

function clamp(n: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, n));
}

/** 属性 3-18 → 加值（DnD 标准：每 2 点一个加值） */
export function dndModifier(score: number): number {
  return Math.floor((score - 10) / 2);
}

export function resolveDndCheck(
  roll: number,
  modifier: number,
  difficulty: Difficulty = 'regular'
): CheckResult {
  const r = clamp(Math.floor(roll), 1, 20);
  const mod = Math.floor(modifier);
  // 难度 → DC：常规 10 / 困难 15 / 极难 18
  const dc = difficulty === 'hard' ? 15 : difficulty === 'extreme' ? 18 : 10;
  const total = r + mod;

  let tier: CheckTier;
  if (r === 20) tier = 'critical';
  else if (r === 1) tier = 'fumble';
  else if (total >= dc + 5) tier = 'hard';
  else if (total >= dc) tier = 'regular';
  else tier = 'failure';

  return {
    roll: r,
    target: mod,
    effectiveTarget: dc,
    difficulty,
    tier,
    success: tier !== 'failure' && tier !== 'fumble',
    label: TIER_LABELS[tier],
  };
}

const DND_VITALS: VitalDef[] = [
  { key: 'hp', label: '生命值', min: 0, max: 99, default: 12, isLife: true },
];

const DND_CHARACTERISTICS: CharacteristicDef[] = [
  { key: 'str', label: '力量', min: 3, max: 18, default: 10, desc: '肌肉与体能，用于近战、负重、强行破门' },
  { key: 'dex', label: '敏捷', min: 3, max: 18, default: 10, desc: '灵活与反应，用于闪避、隐匿、远程' },
  { key: 'con', label: '体质', min: 3, max: 18, default: 10, desc: '健康与耐力，决定生命值上限、抗毒抗病' },
  { key: 'int', label: '智力', min: 3, max: 18, default: 10, desc: '逻辑与学识，用于调查、奥秘、推理' },
  { key: 'wis', label: '感知', min: 3, max: 18, default: 10, desc: '直觉与洞察，用于察觉、生存、识破谎言' },
  { key: 'cha', label: '魅力', min: 3, max: 18, default: 10, desc: '气场与口才，用于说服、威吓、表演' },
];

/**
 * DnD 技能＝加值（不是百分比）。base 一律 0＝没受训。
 * 玩家/模型直接给加值，比如"调查 +5"。
 */
const DND_SKILLS: SkillDef[] = [
  { name: '运动', base: 0, desc: '攀爬、跳跃、游泳、推拉重物（力量）' },
  { name: '杂技', base: 0, desc: '平衡、翻滚、走窄道、灵巧闪避（敏捷）' },
  { name: '巧手', base: 0, desc: '扒窃、开锁、藏东西、精细操作（敏捷）' },
  { name: '隐匿', base: 0, desc: '悄悄移动、躲藏、不被发现（敏捷）' },
  { name: '奥秘', base: 0, desc: '魔法、符文、位面的学识（智力）' },
  { name: '历史', base: 0, desc: '史实、王朝、传说与古物（智力）' },
  { name: '调查', base: 0, desc: '搜索线索、推理现场、找关键信息（智力）' },
  { name: '自然', base: 0, desc: '地形、动植物、天气的学识（智力）' },
  { name: '宗教', base: 0, desc: '神祇、教义、仪式与圣物（智力）' },
  { name: '察觉', base: 0, desc: '留意细节、发现隐藏、听见响动（感知）' },
  { name: '生存', base: 0, desc: '野外找路、觅食、追踪、扎营（感知）' },
  { name: '说服', base: 0, desc: '用道理与诚意说服对方（魅力）' },
  { name: '威吓', base: 0, desc: '用气势与威胁逼对方就范（魅力）' },
  { name: '表演', base: 0, desc: '演奏、歌舞、演说、伪装身份（魅力）' },
  { name: '欺瞒', base: 0, desc: '撒谎、误导、藏住真实意图（魅力）' },
];

const ATTR_KEYS = new Set(DND_CHARACTERISTICS.map((d) => d.key));

/** 取属性值，缺省回退 10（未填的属性按常人水平处理） */
function g(ch: Record<string, number>, key: string): number {
  const v = ch[key];
  return typeof v === 'number' && Number.isFinite(v) ? v : 10;
}

export const dnd5e: Ruleset = {
  id: 'dnd5e',
  name: '龙与地下城 5e（轻量）',
  mainDice: '1d20',
  beginnerGuide:
    '检定＝掷 1d20，加上技能的加值，跟难度等级（DC）比大小：常规 DC 10、困难 15、极难 18，达到就成功。掷出 20 是大成功、1 是大失败。属性是 3–18 的分值，越接近 18 越强；技能是加值（如"调查 +5"），越高越强。',
  vitalDefs: DND_VITALS,
  characteristicDefs: DND_CHARACTERISTICS,
  skillCatalog: DND_SKILLS,
  // 换到 DnD 时的默认技能：6 项常用加值，由高到低
  starterSkills: [
    { name: '调查', value: 3 },
    { name: '察觉', value: 2 },
    { name: '说服', value: 2 },
    { name: '隐匿', value: 2 },
    { name: '运动', value: 1 },
    { name: '历史', value: 1 },
  ],
  deriveVitals(ch) {
    return { hp: Math.max(1, 10 + dndModifier(g(ch, 'con'))) };
  },
  deriveExtras(ch) {
    return { 护甲等级: 10 + dndModifier(g(ch, 'dex')) };
  },
  /** 属性→加值；技能本身已经是加值，原样返回 */
  toModifier(name, rawValue) {
    if (ATTR_KEYS.has(name) || DND_CHARACTERISTICS.some((d) => d.label === name)) {
      return dndModifier(rawValue);
    }
    return rawValue;
  },
  resolveCheck: resolveDndCheck,
  tierLabel: (t) => TIER_LABELS[t],
  /*
   * 负重上限：力量决定（与"运动"检定同源）。
   * 量纲同上（一件小东西 1 点）：力量 10（常人）＝ 50 点，18 的壮汉 74 点。
   */
  carryCapacity(ch) {
    return Math.max(10, Math.round(20 + g(ch, 'str') * 3));
  },
};
