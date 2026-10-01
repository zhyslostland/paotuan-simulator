import { describe, expect, it } from 'vitest';
import {
  createCustomRuleset,
  isBuiltinRuleset,
  listRulesets,
  registerCustomRuleset,
  unregisterCustomRuleset,
  registerCustomRulesetsFrom,
  parseStatusLines,
  parseWeaponLines,
} from '../src/core/rulesets/index.js';
import { findStatusEffect, findWeapon } from '../src/core/rulesets/types.js';
import { coc7 } from '../src/core/rulesets/coc7.js';
import { dnd5e } from '../src/core/rulesets/dnd5e.js';

describe('自定义规则包（自由预设）', () => {
  const base = {
    id: 'custom-test',
    name: '测试房规',
    mainDice: '1d100',
    mode: 'under' as const,
    characteristics: [{ key: '力量', label: '力量', default: 50 }],
    skills: [{ name: '侦查', base: 20 }],
    vitals: [{ key: '生命', label: '生命', default: 12 }],
  };

  it('under 模式：点数 ≤ 目标值成功', () => {
    const rs = createCustomRuleset(base);
    expect(rs.mainDice).toBe('1d100');
    expect(rs.resolveCheck(50, 60).success).toBe(true);
    expect(rs.resolveCheck(61, 60).success).toBe(false);
    expect(rs.resolveCheck(1, 60).tier).toBe('critical');
  });

  it('over 模式：点数 + 加值 ≥ DC 成功', () => {
    const rs = createCustomRuleset({ ...base, mainDice: '1d20', mode: 'over' });
    expect(rs.resolveCheck(10, 0, 'regular').success).toBe(true);
    expect(rs.resolveCheck(9, 0, 'regular').success).toBe(false);
    expect(rs.resolveCheck(20, 0).tier).toBe('critical');
  });

  it('数值条由默认值派生', () => {
    const rs = createCustomRuleset(base);
    expect(rs.deriveVitals({})).toEqual({ 生命: 12 });
  });

  it('🔴 老自定义包（没填两张表）行为完全不变', () => {
    const rs = createCustomRuleset(base);
    expect(rs.weaponTable).toBeUndefined();
    expect(rs.statusEffects).toBeUndefined();
    // 判定时一样 —— 阶段 B 只扩接口，不动行为
    expect(rs.resolveCheck(50, 60).success).toBe(true);
  });
});

/*
 * 1.0 阶段 B：让规则包能"说清后果"。
 *
 * 以前"我中毒了"只是 flags 里多一行字，**引擎不知道该扣什么**，只能交给模型自觉 ——
 * 那等于放弃了「引擎权威」。这两张表就是给引擎的那份依据。
 *
 * ⚠️ 本阶段**只声明、不生效**（真正落地在阶段 C）。所以这里测的都还是"能不能表达"。
 */
describe('阶段 B：规则包能声明武器与状态', () => {
  it('两个内置包都填了武器表与状态表', () => {
    for (const rs of [coc7, dnd5e]) {
      expect(rs.weaponTable?.length ?? 0).toBeGreaterThan(0);
      expect(rs.statusEffects?.length ?? 0).toBeGreaterThan(0);
    }
  });

  it('每条不超过 6 个字段（别让它变成规则书入库）', () => {
    for (const rs of [coc7, dnd5e]) {
      for (const w of rs.weaponTable ?? []) expect(Object.keys(w).length).toBeLessThanOrEqual(6);
      for (const s of rs.statusEffects ?? []) expect(Object.keys(s).length).toBeLessThanOrEqual(6);
    }
  });

  it('按名字能查到武器（COC 手枪 1d10）', () => {
    const w = findWeapon(coc7, '手枪');
    expect(w?.damage).toBe('1d10');
    expect(w?.skill).toBe('射击（手枪）');
  });

  it('模糊名字也能认（"我掏出手枪"）', () => {
    expect(findWeapon(coc7, '我掏出手枪')?.name).toBe('手枪');
  });

  it('没这把武器时返回 undefined（调用方走现状，不许瞎猜）', () => {
    expect(findWeapon(coc7, '激光炮')).toBeUndefined();
  });

  it('状态效果也能查（中毒每轮扣 1 血、三轮）', () => {
    const s = findStatusEffect(coc7, '中毒');
    expect(s?.perRound).toEqual({ hp: -1 });
    expect(s?.duration).toBe(3);
  });

  it('文本行解析：武器 `名字=伤害骰|技能|手数|弹药`', () => {
    const list = parseWeaponLines('手枪=1d10|射击（手枪）|1|7\n撬棍=1d6|格斗（斗殴）');
    expect(list).toHaveLength(2);
    expect(list[0]).toMatchObject({ name: '手枪', damage: '1d10', hands: 1, ammo: 7 });
    // 省略的两项不该被填成 0
    expect(list[1]!.ammo).toBeUndefined();
  });

  it('文本行解析：残缺的行整条跳过（宁可少一把，也别给个错的）', () => {
    expect(parseWeaponLines('手枪=1d10')).toEqual([]);
    expect(parseWeaponLines('乱七八糟')).toEqual([]);
  });

  it('文本行解析：状态 `名字=数值变化|轮数|解除条件`', () => {
    const list = parseStatusLines('中毒=hp-1|3|找到解毒剂');
    expect(list[0]).toMatchObject({ name: '中毒', perRound: { hp: -1 }, duration: 3 });
    expect(list[0]!.cure).toContain('解毒剂');
  });

  it('骰表达式的伤害也认（`hp-1d4`）', () => {
    const s = parseStatusLines('燃烧=hp-1d4|3|扑灭')[0];
    expect(s?.perRound).toEqual({ hp: '1d4' });
  });

  it('轮数缺省 = 0（直到解除）', () => {
    expect(parseStatusLines('昏迷=|0|摇醒')[0]!.duration).toBe(0);
  });
});

/*
 * 自建规则包**能建就该能删**（协作方第 14 版 §1③）。
 * 以前 `registerCustomRuleset` 单向：设置页能建、能选，建错的规则包删不掉，
 * 只能一直挂在列表里 —— 与"自建题材能删"是对称的两件事，做法也照抄题材。
 */
describe('自建规则包的注销', () => {
  const cfg = {
    id: 'custom-del',
    name: '要被删的房规',
    mainDice: '1d100' as const,
    mode: 'under' as const,
    characteristics: [{ key: '力量', label: '力量', default: 50 }],
    skills: [{ name: '侦查', base: 20 }],
    vitals: [{ key: '生命', label: '生命', default: 12 }],
  };

  it('注册得进来，也注销得掉', () => {
    registerCustomRuleset(cfg);
    expect(listRulesets().some((r) => r.id === cfg.id)).toBe(true);
    expect(unregisterCustomRuleset(cfg.id)).toBe(true);
    expect(listRulesets().some((r) => r.id === cfg.id)).toBe(false);
  });

  it('内置的两个删不掉 —— 判据是"是不是内置"，不是"注册表里有没有"', () => {
    expect(isBuiltinRuleset('coc7')).toBe(true);
    expect(isBuiltinRuleset('dnd5e')).toBe(true);
    expect(unregisterCustomRuleset('coc7')).toBe(false);
    expect(unregisterCustomRuleset('dnd5e')).toBe(false);
    // 删不掉就得还在，玩家不该因为手滑丢掉内置规则
    expect(listRulesets().some((r) => r.id === 'coc7')).toBe(true);
    expect(listRulesets().some((r) => r.id === 'dnd5e')).toBe(true);
  });

  it('删一个压根不存在的：返回 false，不抛异常', () => {
    expect(unregisterCustomRuleset('查无此包')).toBe(false);
  });

  it('删了之后 getRuleset 拿不到它（不留空指向）', () => {
    registerCustomRuleset(cfg);
    unregisterCustomRuleset(cfg.id);
    expect(() => listRulesets().find((r) => r.id === cfg.id)).not.toThrow();
    expect(listRulesets().find((r) => r.id === cfg.id)).toBeUndefined();
  });
});

/**
 * 🔴 **边界迁移的断言（2026-09-30 架构体检 · 阶段 1）**
 *
 * 原来 `loadCustomRulesets()` 自己住在 `core/rulesets/index.ts` 里、自己读 `localStorage`
 * —— 而同一个文件第 45 行还写着「core 不许有 IO」。铁律只写在注释里，编译器看不见，
 * 于是它一直这么活着（体检报告 §3 · S4）。
 *
 * 现在拆成两半：**UI 层读盘**（`readLocal('trpg.customRulesets')`），
 * **core 只做纯注册**（`registerCustomRulesetsFrom(raw)`）。
 * 这一组断言把新的接缝钉住：读盘那一半必须在 UI，core 这半必须能脱离浏览器跑。
 */
describe('自定义规则包：读盘在 UI 层，core 只做纯注册（边界迁移的钉子）', () => {
  const ping = {
    id: 'custom-boundary',
    name: '边界测试包',
    mainDice: '1d100',
    mode: 'under' as const,
    characteristics: [{ key: '力量', label: '力量', default: 50 }],
    skills: [{ name: '侦查', base: 20 }],
    vitals: [{ key: '生命', label: '生命', default: 12 }],
  };

  it('喂一段原始 JSON 串就能注册（core 不需要 localStorage）', () => {
    registerCustomRulesetsFrom(JSON.stringify([ping]));
    expect(listRulesets().some((r) => r.id === ping.id)).toBe(true);
    unregisterCustomRuleset(ping.id);
  });

  it('null / 空串 / 坏 JSON / 非法条目：一律安静跳过，不抛', () => {
    expect(() => registerCustomRulesetsFrom(null)).not.toThrow();
    expect(() => registerCustomRulesetsFrom('')).not.toThrow();
    expect(() => registerCustomRulesetsFrom('{不是 JSON')).not.toThrow();
    expect(() => registerCustomRulesetsFrom(JSON.stringify([{ nope: 1 }, null, 42]))).not.toThrow();
    // 坏数据不许在注册表里留下半个条目
    expect(listRulesets().some((r) => r.id === 'custom-boundary')).toBe(false);
  });

  it('坏条目夹在好条目中间时，好的照样注册（一条坏的别把整份名单带走）', () => {
    registerCustomRulesetsFrom(JSON.stringify([{ nope: 1 }, ping]));
    expect(listRulesets().some((r) => r.id === ping.id)).toBe(true);
    unregisterCustomRuleset(ping.id);
  });
});
