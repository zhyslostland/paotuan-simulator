import { describe, expect, it } from 'vitest';
import {
  bleedAmount,
  defaultWoundText,
  healBasis,
  healedByTime,
  parseWound,
  shouldBleed,
  totalBleed,
  woundFlagText,
  woundFromDamage,
  woundLabel,
  woundNote,
  woundRelief,
  type Wound,
} from '../src/core/wounds.js';
import type { InventoryItem } from '../src/core/state/gameState.js';

const bag = (...names: string[]): InventoryItem[] =>
  names.map((n) => ({ id: n, name: n, qty: 1 }));

const w = (tier: Wound['tier'], text = '伤口'): Wound => ({
  id: text,
  text,
  tier,
  turns: 0,
});

describe('伤口：档位与流失量', () => {
  it('单次掉 2 点起算伤口，4 点起算重伤，1 点不算', () => {
    expect(woundFromDamage(0)).toBeNull();
    expect(woundFromDamage(1)).toBeNull();
    expect(woundFromDamage(2)).toBe('wound');
    expect(woundFromDamage(3)).toBe('wound');
    expect(woundFromDamage(4)).toBe('severe');
    expect(woundFromDamage(9)).toBe('severe');
  });

  it('非有限数不产生伤口（引擎不该被 NaN 搞出个流血状态）', () => {
    expect(woundFromDamage(Number.NaN)).toBeNull();
    expect(woundFromDamage(Number.POSITIVE_INFINITY)).toBeNull();
  });

  it('流失量刻意的克制：擦伤/普通伤口 1 点，重伤 2 点', () => {
    expect(bleedAmount({ tier: 'scratch' })).toBe(1);
    expect(bleedAmount({ tier: 'wound' })).toBe(1);
    expect(bleedAmount({ tier: 'severe' })).toBe(2);
  });

  it('多处置伤**不叠加**：取最重的那处（10 滴血经不起叠）', () => {
    expect(totalBleed([])).toBe(0);
    expect(totalBleed([w('wound'), w('wound')])).toBe(1);
    expect(totalBleed([w('wound'), w('severe')])).toBe(2);
    expect(totalBleed([w('scratch'), w('scratch'), w('scratch')])).toBe(1);
  });
});

describe('伤口：从文本解析（守密人显式申报那一路）', () => {
  it('从文本认出档位', () => {
    expect(parseWound('左臂被划开一道口子')?.tier).toBe('wound');
    expect(parseWound('大腿动脉大出血')?.tier).toBe('severe');
    expect(parseWound('手臂上一道浅浅的擦痕')?.tier).toBe('scratch');
  });

  it('同一处伤口重复申报只记一次（去重要稳）', () => {
    const first = parseWound('左臂的伤口', []);
    expect(first).not.toBeNull();
    const again = parseWound('左臂的伤口', [first!]);
    expect(again).toBeNull();
    // 空白与书名号之类的噪声不该把它变成"两处"
    expect(parseWound('「左臂的伤口」', [first!])).toBeNull();
  });

  it('空文本不产生伤口', () => {
    expect(parseWound('')).toBeNull();
    expect(parseWound('   ')).toBeNull();
  });

  it('归档时档位中文名可读', () => {
    expect(woundLabel('scratch')).toBe('擦伤');
    expect(woundLabel('wound')).toBe('伤口');
    expect(woundLabel('severe')).toBe('重伤');
  });

  it('没写理由时给中性兜底，不编造部位', () => {
    expect(defaultWoundText('severe')).toContain('重伤');
    expect(defaultWoundText('wound')).toContain('伤口');
    // 引擎不知道是被咬的还是摔的，就不该假装知道
    expect(defaultWoundText('severe')).not.toMatch(/臂|腿|头|胸|腹/);
  });
});

describe('伤口：止血三依据', () => {
  it('有医疗物品 → item 命中', () => {
    expect(healBasis(bag('绷带'), {}).item).toBe(true);
    expect(healBasis(bag('急救箱'), {}).item).toBe(true);
    expect(healBasis(bag('碘酒'), {}).item).toBe(true);
    expect(healBasis(bag('绷带'), {}).itemName).toBe('绷带');
  });

  it('日常物品不算医疗品（否则三依据退化成一依据）', () => {
    expect(healBasis(bag('手枪', '手电筒', '笔记本', '钥匙'), {}).item).toBe(false);
    expect(healBasis(bag('威士忌'), {}).item).toBe(false);
  });

  it('有急救/医学技能 → skill 命中，且带出技能值', () => {
    const b = healBasis([], { 急救: 60 });
    expect(b.skill).toBe(true);
    expect(b.skillName).toBe('急救');
    expect(b.skillValue).toBe(60);
    // DnD 的写法
    expect(healBasis([], { 医药: 5 }).skill).toBe(true);
  });

  it('技能值为 0 不算"会急救"（角色卡上挂着但没点过）', () => {
    expect(healBasis([], { 急救: 0 }).skill).toBe(false);
  });

  it('**规则包目录里有「急救」不算会急救** —— 判据只看角色卡', () => {
    /*
     * COC 的 skillCatalog 里人人都列着「急救」（基础值 30%）。
     * 早期版本把它当兜底，结果每个角色都被判成"会急救"，
     * 三依据退化成一条，"止不住"那条路根本走不到。
     */
    expect(healBasis([], {}).skill).toBe(false);
    expect(healBasis([], { 侦查: 50 }).skill).toBe(false);
  });

  it('三档结果：全依据止住 / 一半缓解 / 都没有没进展', () => {
    expect(woundRelief(healBasis(bag('绷带'), { 急救: 50 }))).toBe('stop');
    expect(woundRelief(healBasis(bag('绷带'), {}))).toBe('relief');
    expect(woundRelief(healBasis([], { 急救: 50 }))).toBe('relief');
    // 用户报过的原场景：简单包扎、无技能无物品 —— 既不要求检定，也不假装成功
    expect(woundRelief(healBasis([], {}))).toBe('none');
    expect(woundRelief(healBasis(bag('手枪'), {}))).toBe('none');
  });
});

describe('伤口：什么时候真的扣血', () => {
  it('没伤口不扣', () => {
    expect(shouldBleed({ wounds: [], hp: 10, hpMin: 0 })).toBe(false);
  });

  it('有伤口、血还在 → 扣', () => {
    expect(shouldBleed({ wounds: [w('wound')], hp: 10, hpMin: 0 })).toBe(true);
  });

  it('濒死那一轮一律冻结 —— 倒地的人不该被伤口继续放血', () => {
    expect(shouldBleed({ wounds: [w('severe')], hp: 0, hpMin: 0 })).toBe(false);
    expect(shouldBleed({ wounds: [w('severe')], hp: 1, hpMin: 0, dying: true })).toBe(false);
  });

  it('已经结档 / 血量取不到时不扣', () => {
    expect(shouldBleed({ wounds: [w('wound')], hp: 5, hpMin: 0, ending: true })).toBe(false);
    expect(shouldBleed({ wounds: [w('wound')], hp: undefined, hpMin: 0 })).toBe(false);
  });
});

describe('伤口：状态栏文案与守密人提示', () => {
  it('状态栏一句话带档位与每轮流失，多处会标总数', () => {
    expect(woundFlagText([])).toBeNull();
    expect(woundFlagText([w('wound')])).toBe('伤口·每轮 -1');
    expect(woundFlagText([w('severe')])).toBe('重伤·每轮 -2');
    expect(woundFlagText([w('wound', 'a'), w('severe', 'b')])).toContain('每轮 -2');
    expect(woundFlagText([w('wound', 'a'), w('wound', 'b')])).toContain('共 2 处');
  });

  it('给守密人的提示：没伤口时为 null', () => {
    expect(woundNote([], healBasis([], {}), 'none')).toBeNull();
  });

  it('提示里说清了"每轮固定几点，不是你能加的" —— 防它写得更狠', () => {
    const note = woundNote([w('wound')], healBasis([], {}), 'none')!;
    expect(note).toContain('每轮固定 1 点');
    expect(note).toContain('不要替他加重');
  });

  it('两样都没有时明确"止不住"，且不要求检定', () => {
    const note = woundNote([w('wound')], healBasis(bag('手枪'), {}), 'none')!;
    expect(note).toContain('止不住');
    expect(note).toContain('不要要求他掷骰');
  });

  it('全依据时明确"这一轮可以真正止住"', () => {
    const note = woundNote([w('wound')], healBasis(bag('绷带'), { 急救: 60 }), 'stop')!;
    expect(note).toContain('止住');
  });

  it('提示里**给守密人的叙事要求**不出现数字（不许它写"每轮 -1"）', () => {
    const note = woundNote([w('severe')], healBasis([], {}), 'none')!;
    /*
     * 元指令里允许出现"每轮固定 2 点"（那是给守密人看的口径），
     * 但"写进故事"的那一段不能带数字——玩家看到的正文里不该有血量算术。
     * 判据取"把它写成身体的感觉"之后的部分。
     */
    const storytelling = note.split('把它写成身体的感觉')[1] ?? '';
    expect(storytelling).not.toMatch(/每轮\s*-?\d/);
  });

      it('提示里明确禁止把系统词写进故事（跳戏）', () => {
        const note = woundNote([w('severe')], healBasis([], {}), 'none')!;
        expect(note).toContain('不要写任何数字');
        expect(note).toMatch(/不要出现["「]?流血/);
      });
    });

/*
 * ============================================================
 * 结痂自愈（协作方第 7 版 §2.2）
 *
 * v0.3.0 只有"止血三依据"，没有按轮自愈 —— 于是"既无医疗物品、也不会急救"
 * 的角色，一处擦伤会**一直流到死**（10 滴血 ≈ 10 轮见底）。
 * 这正是用户报过的"我总共就 10 滴血，也太刺激了"，只是这次由引擎稳定地执行。
 *
 * 判据：擦伤 3 轮、普通伤口 6 轮自己结痂；**重伤不自己好**，必须有人处理
 * （否则"止血三依据"对最危险的那档就没意义了）。
 * ============================================================
 */
describe('结痂：轻伤会自己收口，重伤不会', () => {
  const at = (tier: Wound['tier'], turns: number) => ({ tier, turns });

  it('擦伤第 3 轮结痂', () => {
    expect(healedByTime(at('scratch', 2))).toBe(false);
    expect(healedByTime(at('scratch', 3))).toBe(true);
  });

  it('普通伤口第 6 轮结痂（最常见的那一档也得有终点）', () => {
    expect(healedByTime(at('wound', 5))).toBe(false);
    expect(healedByTime(at('wound', 6))).toBe(true);
  });

  it('重伤永远不自己好 —— 必须有人处理', () => {
    expect(healedByTime(at('severe', 6))).toBe(false);
    expect(healedByTime(at('severe', 100))).toBe(false);
  });

  it('刚留下的伤口（0 轮）一律还没结痂', () => {
    expect(healedByTime(at('scratch', 0))).toBe(false);
    expect(healedByTime(at('wound', 0))).toBe(false);
    expect(healedByTime(at('severe', 0))).toBe(false);
  });
});
