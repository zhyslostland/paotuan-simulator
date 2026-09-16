/**
 * 克苏鲁的呼唤 第七版（Call of Cthulhu 7th）规则包
 *
 * 之所以推荐它作为第一套规则：百分币检定、成功等级表、SAN 值，
 * 数值维度少，模型最容易"不犯错"。
 */

import type { Rng } from '../dice/roll.js';
import {
  type CharacteristicDef,
  type CheckResult,
  type CheckTier,
  type Difficulty,
  type Ruleset,
  type SkillDef,
  type VitalDef,
} from './types.js';

const TIER_LABELS: Record<CheckTier, string> = {
  critical: '大成功',
  extreme: '极难成功',
  hard: '困难成功',
  regular: '成功',
  failure: '失败',
  fumble: '大失败',
};

export interface PercentileRoll {
  /** 最终点数 1-100 */
  value: number;
  /** 掷出的所有十位骰（含默认那颗），便于审计与动画 */
  tens: number[];
  /** 个位骰 0-9 */
  ones: number;
  /** 采用的十位骰（奖励骰取最小、惩罚骰取最大） */
  keptTen: number;
  /** net > 0 为奖励骰，< 0 为惩罚骰 */
  net: number;
}

/**
 * COC 的百分骰：一颗十位骰（00/10/.../90）+ 一颗个位骰（0-9）
 * 00 + 0 视为 100。
 * 奖励骰：额外掷十位骰取最小；惩罚骰：额外掷十位骰取最大。
 * bonus 与 penalty 会相互抵消。
 */
export function rollPercentile(
  opts: { bonus?: number; penalty?: number } = {},
  rng: Rng = Math.random
): PercentileRoll {
  const bonus = Math.max(0, Math.floor(opts.bonus ?? 0));
  const penalty = Math.max(0, Math.floor(opts.penalty ?? 0));
  const net = bonus - penalty;
  const extra = Math.min(Math.abs(net), 10);

  const rollTen = () => Math.floor(rng() * 10) * 10; // 0,10,...,90
  const tens: number[] = [rollTen()];
  for (let i = 0; i < extra; i++) tens.push(rollTen());

  const ones = Math.floor(rng() * 10); // 0-9
  const keptTen = net > 0 ? Math.min(...tens) : net < 0 ? Math.max(...tens) : tens[0]!;

  let value = keptTen + ones;
  if (value === 0) value = 100;

  return { value, tens, ones, keptTen, net };
}

function clampTarget(target: number): number {
  if (Number.isNaN(target)) return 0;
  return Math.max(0, Math.min(100, Math.floor(target)));
}

export function resolveCocCheck(
  roll: number,
  rawTarget: number,
  difficulty: Difficulty = 'regular'
): CheckResult {
  const target = clampTarget(rawTarget);
  const r = Math.max(1, Math.min(100, Math.floor(roll)));

  const hardTarget = Math.floor(target / 2);
  const extremeTarget = Math.floor(target / 5);
  const effectiveTarget =
    difficulty === 'hard' ? hardTarget : difficulty === 'extreme' ? extremeTarget : target;

  let tier: CheckTier;

  // 大失败优先判定（规则书：100 必为大失败；技能值 < 50 时 96-100 亦为大失败）
  if (r === 100 || (r >= 96 && target < 50)) {
    tier = 'fumble';
  } else if (r === 1) {
    tier = 'critical';
  } else if (r <= extremeTarget && r <= effectiveTarget) {
    tier = 'extreme';
  } else if (r <= hardTarget && r <= effectiveTarget) {
    tier = 'hard';
  } else if (r <= effectiveTarget) {
    tier = 'regular';
  } else {
    tier = 'failure';
  }

  const success = tier !== 'failure' && tier !== 'fumble';

  return {
    roll: r,
    target,
    effectiveTarget,
    difficulty,
    tier,
    success,
    label: TIER_LABELS[tier],
  };
}

const COC_VITALS: VitalDef[] = [
  { key: 'hp', label: '生命值', min: 0, max: 99, default: 12, isLife: true },
  { key: 'mp', label: '魔法值', min: 0, max: 99, default: 14 },
  { key: 'san', label: '理智值', min: 0, max: 99, default: 70 },
];

/** COC 7th 八大属性，1-99（常规生成落在 20-90） */
const COC_CHARACTERISTICS: CharacteristicDef[] = [
  { key: 'str', label: '力量', min: 1, max: 99, default: 50, desc: '力气与体能，用于举重、肉搏、挣脱' },
  { key: 'con', label: '体质', min: 1, max: 99, default: 50, desc: '健康与耐力，决定生命值上限、抗毒抗病' },
  { key: 'siz', label: '体型', min: 1, max: 99, default: 50, desc: '身高体格，和体质一起决定生命值' },
  { key: 'dex', label: '敏捷', min: 1, max: 99, default: 50, desc: '灵巧与反应，用于闪避、潜行、逃跑' },
  { key: 'app', label: '外貌', min: 1, max: 99, default: 50, desc: '仪表魅力，用于魅惑、取信、留下印象' },
  { key: 'int', label: '智力', min: 1, max: 99, default: 50, desc: '逻辑与学习，用于推理、图书馆使用' },
  { key: 'pow', label: '意志', min: 1, max: 99, default: 50, desc: '精神力量，决定理智值与魔法值、抵抗恐惧' },
  { key: 'edu', label: '教育', min: 1, max: 99, default: 50, desc: '学识背景，决定母语、知识类技能与技能点' },
];

/**
 * COC 7th 标准技能表与基础值。
 *
 * "基础值"＝完全没专门练过时也有的成功率。创建角色卡时从这张表里挑，
 * 挑中即按基础值起步，再往上加点。
 * 注：规则书里"闪避"＝DEX/2、"母语"＝EDU，这里给的是常见默认值，可手动调。
 */
const COC_SKILLS: SkillDef[] = [
  { name: '会计', base: 5, desc: '查账、识别财务造假' },
  { name: '人类学', base: 1, desc: '判断陌生习俗、原始文化与人种特征' },
  { name: '估价', base: 5, desc: '一眼看出物品值多少钱或是否赝品' },
  { name: '考古学', base: 1, desc: '辨认古迹、年代与出土文物' },
  { name: '艺术与手艺', base: 5, desc: '绘画、雕塑、乐器、写作等手艺与创作' },
  { name: '魅惑', base: 15, desc: '用魅力与暧昧换取好感或情报' },
  { name: '攀爬', base: 20, desc: '爬墙、爬树、攀越障碍' },
  { name: '信用评级', base: 0, desc: '你的社会地位与财力；判定能否动用人脉、借贷、赊账' },
  { name: '克苏鲁神话', base: 0, desc: '对禁忌知识的了解——越高越懂真相，但也意味着你已经疯了那么久' },
  { name: '乔装', base: 5, desc: '易容、换装、伪装成另一个人' },
  { name: '闪避', base: 25, desc: '躲开攻击、躲避坠落物' },
  { name: '汽车驾驶', base: 20, desc: '开车、飙车、在恶劣路况保命' },
  { name: '电气维修', base: 10, desc: '修电路、接电线、（1920s）对付电闸' },
  { name: '话术', base: 5, desc: '用花言巧语快速骗过对方' },
  { name: '格斗（斗殴）', base: 25, desc: '拳脚、棍棒等近身肉搏' },
  { name: '射击（手枪）', base: 20, desc: '用手枪命中目标' },
  { name: '射击（步枪/霰弹枪）', base: 25, desc: '用长枪命中目标' },
  { name: '急救', base: 30, desc: '止血、包扎、处理外伤，稳定濒死的人' },
  { name: '历史', base: 5, desc: '回忆史实、年代与旧事' },
  { name: '恐吓', base: 15, desc: '用威胁逼对方就范' },
  { name: '跳跃', base: 20, desc: '跳过裂缝、越过障碍' },
  { name: '母语', base: 50, desc: '母语的读写与理解能力' },
  { name: '外语', base: 1, desc: '理解与使用一门外语' },
  { name: '法律', base: 5, desc: '知道法律条文、程序与你的权利' },
  { name: '图书馆使用', base: 20, desc: '在图书馆或档案堆里找到关键资料' },
  { name: '聆听', base: 20, desc: '听见细微的声音——脚步、低语、呼吸' },
  { name: '锁匠', base: 1, desc: '开锁、撬锁、处理机械锁' },
  { name: '机械维修', base: 10, desc: '修理机械装置' },
  { name: '医学', base: 1, desc: '诊断疾病、辨认死因、专业医疗处置' },
  { name: '博物学', base: 10, desc: '辨认动植物、矿物与自然现象' },
  { name: '导航', base: 10, desc: '看地图、辨方向、在野外不迷路' },
  { name: '神秘学', base: 5, desc: '对传说、符号、邪教与仪式的了解' },
  { name: '操作重型机械', base: 1, desc: '开起重设备、火车、工程机械' },
  { name: '说服', base: 10, desc: '用道理与诚意让对方接受你的说法' },
  { name: '驾驶（飞行器）', base: 1, desc: '驾驶飞机' },
  { name: '驾驶（船只）', base: 1, desc: '驾驶帆船、汽船等水上载具' },
  { name: '精神分析', base: 1, desc: '安抚精神崩溃者、进行治疗' },
  { name: '心理学', base: 10, desc: '看穿对方的情绪、动机与是否在撒谎' },
  { name: '读唇语', base: 1, desc: '透过口型判断对方在说什么' },
  { name: '骑术', base: 5, desc: '骑马、驾驭牲畜' },
  { name: '科学', base: 1, desc: '某一领域的科学知识（生物/化学/物理等）' },
  { name: '妙手', base: 10, desc: '扒窃、藏物、快速做小动作' },
  { name: '侦查', base: 25, desc: '观察细节、发现隐藏的东西' },
  { name: '潜行', base: 20, desc: '悄悄移动、不被发现' },
  { name: '生存', base: 10, desc: '野外找水找食、辨认方向、应付恶劣环境' },
  { name: '游泳', base: 20, desc: '在水中保命、游动' },
  { name: '投掷', base: 20, desc: '投掷物品命中目标' },
  { name: '追踪', base: 10, desc: '循着足迹与痕迹追踪目标' },
];

export const coc7: Ruleset = {
  id: 'coc7',
  name: '克苏鲁的呼唤 第七版',
  mainDice: '1d100',
  beginnerGuide:
    '技能值＝成功率（百分比，越高越好）。检定＝掷 1d100，点数 ≤ 技能值就成功；难度分常规（≤技能值）、困难（≤一半）、极难（≤五分之一），由守密人按剧情定。掷出 01 是大成功，96–100（技能低于 50 时）是大失败。',
  vitalDefs: COC_VITALS,
  characteristicDefs: COC_CHARACTERISTICS,
  skillCatalog: COC_SKILLS,
  // 换到 COC 时的默认技能：8 项常用调查技能，由高到低
  starterSkills: [
    { name: '侦查', value: 60 },
    { name: '图书馆使用', value: 55 },
    { name: '聆听', value: 50 },
    { name: '说服', value: 50 },
    { name: '潜行', value: 45 },
    { name: '心理学', value: 40 },
    { name: '急救', value: 40 },
    { name: '格斗（斗殴）', value: 40 },
  ],
  deriveVitals: deriveCocVitals,
  deriveExtras: deriveCocExtras,
  resolveCheck: resolveCocCheck,
  tierLabel: (t) => TIER_LABELS[t],
  /*
   * 负重上限：力量 + 体格越大扛得越多（与伤害加成同一组属性）。
   *
   * 量纲＝"一件随身小东西 1 点"（手电筒、笔记本、一盒子弹都算这个级别）。
   * 常人（各 50）＝ 50 点：够装一身行头加几份补给，只有真扛了沉家伙才会顶到上限。
   * 刻意给得宽——早期按 10 点算，玩家带 12 发子弹就直接"超重"了，那是误伤不是玩法。
   */
  carryCapacity(ch) {
    return Math.max(10, Math.round((g(ch, 'str') + g(ch, 'siz')) / 2));
  },
};

/** 取属性值，缺省回退 50（未填的属性按常人水平处理） */
function g(ch: Record<string, number>, key: string): number {
  const v = ch[key];
  return Number.isFinite(v) ? (v as number) : 50;
}

/**
 * COC 7e 数值派生（起始值）：
 * - 生命值 HP = (体质 CON + 体型 SIZ) / 10，向下取整
 * - 魔法值 MP = 意志 POW / 5，向下取整
 * - 理智值 SAN（起始）= 意志 POW
 */
export function deriveCocVitals(ch: Record<string, number>): Record<string, number> {
  const con = g(ch, 'con');
  const siz = g(ch, 'siz');
  const pow = g(ch, 'pow');
  return {
    hp: Math.max(0, Math.floor((con + siz) / 10)),
    mp: Math.max(0, Math.floor(pow / 5)),
    san: Math.max(0, Math.floor(pow)),
  };
}

/**
 * 伤害加成 / 体格，由 STR + SIZ 查表（COC 7e）。
 * 数值是中文标签，方便直接展示；检定用不到，仅参考。
 */
export function deriveCocExtras(ch: Record<string, number>): Record<string, number | string> {
  const total = g(ch, 'str') + g(ch, 'siz');
  let db: string;
  let build: number;
  if (total <= 64) {
    db = '-2';
    build = -2;
  } else if (total <= 84) {
    db = '-1';
    build = -1;
  } else if (total <= 124) {
    db = '0';
    build = 0;
  } else if (total <= 164) {
    db = '+1d4';
    build = 1;
  } else if (total <= 204) {
    db = '+1d6';
    build = 2;
  } else {
    db = '+2d6';
    build = 3;
  }
  return { 伤害加成: db, 体格: build };
}
