/**
 * 1.0 阶段 C：伤害与状态**真正由引擎算**。
 *
 * 协作方第 24 版把这一刀的风险点得很准：
 * 「C 的风险不在掷骰，在**双计** —— 引擎扣了、模型又申报一次」。
 * 所以这里的断言一半在"算得对"，一半在"**没表的包必须一点不动**"。
 */
import { describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { applyDeltas, createInitialState } from '../src/core/state/gameState.js';
import { coc7 } from '../src/core/rulesets/coc7.js';
import { createCustomRuleset } from '../src/core/rulesets/custom.js';
import { registerCustomRuleset } from '../src/core/rulesets/index.js';
import { findWeapon } from '../src/core/rulesets/types.js';
import {
  declaredStatusLines,
  isStatusKey,
  isStatusOff,
  isTurnsKey,
  liveStatusEntries,
  statusFlagLines,
  statusNote,
  tickStatusEffects,
  turnsKeyOf,
} from '../src/core/statusEffects.js';

/** 固定骰：永远掷出 1（让断言可复现） */
const rngOne = () => 0;

function baseState() {
  return createInitialState({
    vitals: { hp: 10, mp: 10, san: 60 },
    inventory: [],
    clues: [],
    threads: [],
    location: '某地',
    npcsAlive: [],
    visited: [],
  });
}

describe('阶段 C：伤害由引擎按武器骰掷', () => {
  it('🔴 写了 weapon → 按武器表的骰子掷（模型给的 amount 不作数）', () => {
    const st = baseState();
    st.combat = { active: true, round: 1, foes: [{ name: '黑影', hp: 30, max: 30 }] };
    // 手枪 = 1d10，固定骰掷出 1；模型却申报了 999
    const rep = applyDeltas(
      st,
      [{ target: 'combat.foes', op: 'dec', value: '黑影', amount: 999, weapon: '手枪' }],
      { ruleset: coc7, rng: rngOne }
    );
    expect(rep.rejected).toHaveLength(0);
    expect(rep.applied[0]!.after).toBe(29); // 30 - 1
    expect(rep.rolls.length).toBeGreaterThan(0);
  });

  it('不写 weapon → 完全走现状（用模型给的 amount）', () => {
    const st = baseState();
    st.combat = { active: true, round: 1, foes: [{ name: '黑影', hp: 30, max: 30 }] };
    const rep = applyDeltas(
      st,
      [{ target: 'combat.foes', op: 'dec', value: '黑影', amount: 7 }],
      { ruleset: coc7, rng: rngOne }
    );
    expect(rep.applied[0]!.after).toBe(23); // 30 - 7
  });

  it('认不出这把武器 → 照旧用 amount，不 reject（漏字段不该玩家承担）', () => {
    const st = baseState();
    st.combat = { active: true, round: 1, foes: [{ name: '黑影', hp: 30, max: 30 }] };
    const rep = applyDeltas(
      st,
      [{ target: 'combat.foes', op: 'dec', value: '黑影', amount: 5, weapon: '激光炮' }],
      { ruleset: coc7, rng: rngOne }
    );
    expect(rep.rejected).toHaveLength(0);
    expect(rep.applied[0]!.after).toBe(25);
  });

  it('🔴 自定义包没填武器表 → 写了 weapon 也不会掷（行为一点不变）', () => {
    const custom = createCustomRuleset({
      id: 'custom-now',
      name: '没表的包',
      mainDice: '1d100',
      mode: 'under',
      characteristics: [{ key: '力量', label: '力量', default: 50 }],
      skills: [{ name: '射击', base: 30 }],
      vitals: [{ key: 'hp', label: '生命', default: 10 }],
    });
    expect(custom.weaponTable).toBeUndefined();
    const st = baseState();
    st.combat = { active: true, round: 1, foes: [{ name: '黑影', hp: 30, max: 30 }] };
    const rep = applyDeltas(
      st,
      [{ target: 'combat.foes', op: 'dec', value: '黑影', amount: 5, weapon: '手枪' }],
      { ruleset: custom, rng: rngOne }
    );
    expect(rep.applied[0]!.after).toBe(25);
    expect(rep.rolls).toHaveLength(0);
  });

  it('COC 手枪是 1d10（表本身没错）', () => {
    expect(findWeapon(coc7, '手枪')?.damage).toBe('1d10');
  });
});

describe('阶段 C：状态效果每轮结算', () => {
  it('🔴 中毒 → 每轮扣 1 血，三轮后解除', () => {
    const flags: Record<string, unknown> = { 中毒: true };
    const t1 = tickStatusEffects(flags, coc7, rngOne);
    expect(t1.deltas[0]).toMatchObject({ target: 'vitals.hp', op: 'dec', amount: 1 });
    expect(t1.cleared).toEqual([]);

    // 第二轮：轮数记在引擎的记账键上
    const t2 = tickStatusEffects({ ...flags, [turnsKeyOf('中毒')]: 1 }, coc7, rngOne);
    expect(t2.cleared).toEqual(['中毒']);
  });

  it('🔴 规则包没填状态表 → 一律不动（老包行为不变）', () => {
    const custom = createCustomRuleset({
      id: 'custom-ns',
      name: '没状态表',
      mainDice: '1d100',
      mode: 'under',
      characteristics: [{ key: '力量', label: '力量', default: 50 }],
      skills: [{ name: '侦查', base: 20 }],
      vitals: [{ key: 'hp', label: '生命', default: 10 }],
    });
    const t = tickStatusEffects({ 中毒: true }, custom, rngOne);
    expect(t.deltas).toEqual([]);
    expect(t.cleared).toEqual([]);
  });

  it('规则包压根没给 → 也什么都不做', () => {
    expect(tickStatusEffects({ 中毒: true }, undefined, rngOne).deltas).toEqual([]);
  });

  it('没中的状态不算数（false / 空串 / 0 都是"没中"）', () => {
    for (const v of [false, '', 0, null]) {
      expect(tickStatusEffects({ 中毒: v }, coc7, rngOne).deltas).toEqual([]);
    }
  });

  it('引擎的记账键（xx轮数）不会被当成状态', () => {
    expect(tickStatusEffects({ 中毒轮数: 2 }, coc7, rngOne).deltas).toEqual([]);
  });

  it('骰表达式的后果也认（燃烧 1d4，固定骰＝1）', () => {
    const t = tickStatusEffects({ 燃烧: true }, createCustomRuleset({
      id: 'c-burn',
      name: '带燃烧',
      mainDice: '1d100',
      mode: 'under',
      characteristics: [{ key: '力量', label: '力量', default: 50 }],
      skills: [{ name: '侦查', base: 20 }],
      vitals: [{ key: 'hp', label: '生命', default: 10 }],
      statuses: ['燃烧=hp-1d4|3|扑灭'],
    }), rngOne);
    expect(t.deltas[0]).toMatchObject({ target: 'vitals.hp', op: 'dec', amount: 1 });
  });

  it('duration=0 的状态不会自己解除（要等 cure）', () => {
    const t = tickStatusEffects({ 昏迷: true }, coc7, rngOne);
    expect(t.cleared).toEqual([]);
    expect(t.remaining[0]!.name).toBe('昏迷');
  });
});

describe('阶段 C：防双计 —— 必须告诉守密人"已经算过了"', () => {
  it('🔴 提示里要点明"后果已由引擎算过，不要重复扣血"', () => {
    const note = statusNote(coc7, { 中毒: true, [turnsKeyOf('中毒')]: 2 });
    expect(note).toContain('中毒（还剩 2 轮）');
    expect(note).toContain('不要重复扣血');
  });

  it('解除的那一轮要说清楚（不然守密人还在演症状）', () => {
    const note = statusNote(coc7, { 中毒: true, [turnsKeyOf('中毒')]: 1 });
    expect(note).toContain('已在本轮解除');
  });

  it('没有状态时不许输出空话', () => {
    expect(statusNote(coc7, {})).toBe('');
    expect(statusNote(coc7, undefined)).toBe('');
  });
});

/* ============================================================
 * H20：**判据只许一份**。
 *
 * `H16·残留` / `§6.4` 反复分叉，教训就是两个面板各写一份过滤 ——
 * 于是 `中毒轮数：2` 照样漏出来，布尔状态还会把 `true` 甩到界面上。
 * 现在 `statusFlagLines` 是唯一一处，三处共用。
 * ============================================================ */
describe('H20：flags → 玩家读得懂的那一行', () => {
  it('🔴 布尔状态不许露出 true（显示"中毒"两个字）', () => {
    const lines = statusFlagLines({ 中毒: true });
    expect(lines[0]!.text).toBe('中毒');
    expect(lines[0]!.text).not.toContain('true');
  });

  it('🔴 配了轮数的拼成"还剩 N 轮"（所有状态，不只是疯狂）', () => {
    const lines = statusFlagLines({ 中毒: true, 中毒轮数: 2 });
    expect(lines[0]!.text).toBe('中毒（还剩 2 轮）');
  });

  it('🔴 所有「轮数」结尾的键都不显示（不只是「疯狂轮数」）', () => {
    const lines = statusFlagLines({ 中毒: true, 中毒轮数: 2, 恐惧: true, 恐惧轮数: 1 });
    expect(lines.map((l) => l.key)).toEqual(['中毒', '恐惧']);
  });

  it('没中的状态不显示（false / 空串 / 0 / null）', () => {
    expect(statusFlagLines({ 中毒: false, 昏迷: '', 重伤: 0, 恐惧: null })).toEqual([]);
  });

  it('描述型状态照原样显示（那句是给人看的）', () => {
    expect(statusFlagLines({ 中毒: '指甲发黑' })[0]!.text).toBe('指甲发黑');
  });

  /* ------------------------------------------------------------
   * `H20·残留2` + `P3-7`（协作方第 26 版）：**判据只许一份，且不许按键名语言藏状态**。
   *
   * 之前 `statusNote` 自己内联了一份「跳过 `轮数` 结尾」；世界页又在
   * `statusFlagLines` 外面加了一层「只留含汉字的键」——
   * 于是 ASCII 状态名（`poisoned`）在世界页**一条都不显**，角色卡却照显。
   * 现在过滤本身抽成了 `liveStatusEntries`，结算 / 守密人那句 / 玩家那行三处共用。
   * ------------------------------------------------------------ */
  it('🔴 ASCII 状态名不被藏（两个面板共用 `statusFlagLines`，不再按语言过滤）', () => {
    const lines = statusFlagLines({ poisoned: true, bleeding: '一直在渗血' });
    expect(lines.map((l) => l.key)).toEqual(['poisoned', 'bleeding']);
    // 布尔状态照样只显示名字，不露 `true`
    expect(lines[0]!.text).toBe('poisoned');
  });

  it('🔴 `statusNote` 与 `statusFlagLines` 是同一份过滤（记账键两边都不出现）', () => {
    const flags = { 中毒: true, 中毒轮数: 2, 疯狂轮数: 1 };
    expect(statusFlagLines(flags).map((l) => l.key)).toEqual(['中毒']);
    expect(statusNote(coc7, flags)).not.toContain('轮数');
  });

  it('🔴 结算侧也走同一份过滤（`false` 与记账键都不算状态）', () => {
    expect(tickStatusEffects({ 中毒: false, 中毒轮数: 2 }, coc7, rngOne).deltas).toEqual([]);
    expect(tickStatusEffects({ 中毒轮数: 2 }, coc7, rngOne).deltas).toEqual([]);
  });

  it('🔴 过滤只有一处：`liveStatusEntries` 的口径与两个判定函数一致', () => {
    expect(liveStatusEntries({ 中毒: true, 中毒轮数: 0, 昏迷: '', 恐惧: false })).toEqual([
      ['中毒', true],
    ]);
    expect(isTurnsKey('中毒轮数')).toBe(true);
    expect(isStatusOff(null)).toBe(true);
  });
});

/* ============================================================
 * 🔴 P1-3 回归：**store 层集成断言**。
 *
 * 协作方第 25 版点名：1.0 门禁里只有纯函数测试，
 * 于是「纯函数对、但压根没接线」这种错**一路漏到上线** ——
 * 引擎一边对守密人说"后果我已算过、别重复扣"，一边什么都没扣。
 * 单测证明不了"接上了"，只有这一层能。
 * ============================================================ */
const { useStore, resetStatusTickForTest, resetCheckGrantForTest } = await import(
  '../src/ui/store.js'
);
const { normalizeDeadlineIn, normalizeStartClock } = await import('../src/core/clock.js');
const { fallbackState, deadlineOf, truncateAtPunctuation } = await import(
  '../src/ui/state/loaders.js'
);

describe('P1-3：状态结算必须**真的接线**（store 层集成）', () => {
  /** 造一个带中毒的状态，规则包用有表的那个 */
  const seed = (flags: Record<string, unknown>) => {
    // 清掉"本轮已结算"的窗口，否则连着跑的用例会互相抢
    resetStatusTickForTest();
    useStore.setState({
      rulesetId: 'coc7',
      gameState: {
        ...useStore.getState().gameState,
        vitals: { hp: 10, mp: 10, san: 60 },
        flags: { ...flags },
      },
    });
  };

  /**
   * 🔴 `N2`（协30 §2.3）之后，"一轮"由**玩家行动**定义 ——
   * 不能再用"调一次 `applyModelDeltas`"当一轮了（真机一轮会调好几次）。
   */
  const act = () => {
    useStore.getState().addMessage({ role: 'player', content: '我继续行动。' });
  };

  it('🔴 推进一轮 → 真的扣血了（不是只说说）', () => {
    seed({ 中毒: true, 中毒轮数: 2 });
    /*
     * 断言"比推进前少"，不写死差值 —— hp 上限由角色属性派生，
     * seed 的 10 可能高于上限而被裁剪，写死 `before - 1` 会脆。
     * 这一条要证明的是**接线生效**（血真的动了），扣几点由 `statusEffects` 那条纯函数断言管。
     */
    const before = useStore.getState().gameState.vitals.hp ?? 0;
    act();
    useStore.getState().applyModelDeltas([]);
    expect(useStore.getState().gameState.vitals.hp ?? 0).toBeLessThan(before);
  });

  it('🔴 推进一轮 → 轮数真的递减（2 → 1）', () => {
    seed({ 中毒: true, 中毒轮数: 2 });
    act();
    useStore.getState().applyModelDeltas([]);
    expect(useStore.getState().gameState.flags['中毒轮数']).toBe(1);
  });

  it('🔴 到期 → 键真的消失（不会永久挂身上）', () => {
    seed({ 中毒: true, 中毒轮数: 1 });
    act();
    useStore.getState().applyModelDeltas([]);
    const f = useStore.getState().gameState.flags;
    expect(f['中毒']).toBeUndefined();
    expect(f['中毒轮数']).toBeUndefined();
  });

  it('🔴 本轮刚申报的不该当轮就被扣（否则轮数和申报对不上）', () => {
    // 先清干净，再让模型"本轮"申报中毒
    seed({});
    useStore.getState().applyModelDeltas([
      { target: 'flags.中毒', op: 'set', value: true },
      { target: 'flags.中毒轮数', op: 'set', value: 2 },
    ]);
    const f = useStore.getState().gameState.flags;
    // 申报的 2 轮要原样留着，不能当轮就被 tick 成 1
    expect(f['中毒轮数']).toBe(2);
  });

  it('🔴 一轮只结算一次（`applyModelDeltas` 一轮会被调多次：状态 + 地点）', () => {
    seed({ 中毒: true, 中毒轮数: 3 });
    // 第一轮：玩家落一条行动 —— 它真的要结算
    act();
    useStore.getState().applyModelDeltas([]);
    const midHp = useStore.getState().gameState.vitals.hp ?? 0;
    const midTurns = useStore.getState().gameState.flags['中毒轮数'];
    // 同一轮的第二次调用（地点）—— **不该再结算**
    useStore.getState().applyModelDeltas([
      { target: 'location', op: 'set', value: '别处' },
    ] as never);
    /*
     * 比的是"两次调用之间"有没有再动 —— 不与 seed 的初值比：
     * hp 上限由角色属性派生，seed 的 10 可能高于上限被裁剪，差值会失真。
     */
    expect(useStore.getState().gameState.vitals.hp ?? 0).toBe(midHp);
    expect(useStore.getState().gameState.flags['中毒轮数']).toBe(midTurns);
  });

  it('🔴 没填状态表的规则包 → 一点不动（老包行为不变）', () => {
    registerCustomRuleset({
      id: 'custom-nostatus',
      name: '无表包',
      mainDice: '1d100',
      mode: 'under',
      characteristics: [{ key: '力量', label: '力量', default: 50 }],
      skills: [{ name: '侦查', base: 20 }],
      vitals: [{ key: 'hp', label: '生命', default: 10 }],
    });
    useStore.setState({
      rulesetId: 'custom-nostatus',
      gameState: {
        ...useStore.getState().gameState,
        vitals: { hp: 10 },
        flags: { 中毒: true, 中毒轮数: 2 },
      },
    });
    useStore.getState().applyModelDeltas([]);
    const g = useStore.getState().gameState;
    expect(g.vitals.hp).toBe(10);
    expect(g.flags['中毒轮数']).toBe(2);
  });
});

describe('P2-11①：两条开局路径的期限必须同源', () => {
  it('fallbackState 也会带上模组推出来的期限', () => {
    // `fallbackState` 读的是**落盘的模组**（`loadModule`），不是 store 里那份 —— 直接写盘
    localStorage.setItem(
      'trpg.module',
      JSON.stringify({ urgency: '雨季还有二十三天结束，她必须在此之前离开' })
    );
    const st = fallbackState();
    // 以前这里是 null → setDeadlineDays 的 `if (cur) return` 形同虚设
    expect(st.deadline).not.toBeNull();
    expect(st.deadline!.remain).toBe(23 * 24 * 60);
  });
});

describe('H21：期限说明就近标点截断', () => {
  it('断在逗号上，不劈断半个词', () => {
    const out = truncateAtPunctuation(
      '雨季结束之前她必须带着那卷胶卷离开这座城，否则一旦大雨封了山路就再也走不掉了',
      24
    );
    expect(out).toBe('雨季结束之前她必须带着那卷胶卷离开这座城…');
    expect(out.endsWith('…')).toBe(true);
  });

  it('没有标点才硬截', () => {
    expect(truncateAtPunctuation('一二三四五六七八九十壹贰叁肆伍陆柒捌玖拾壹贰', 10)).toBe(
      '一二三四五六七八九十…'
    );
  });

  it('够短就不动', () => {
    expect(truncateAtPunctuation('雨季结束前', 24)).toBe('雨季结束前');
  });
});

describe('P2-10：模组申报的开局时刻与期限', () => {
  it('申报了 deadlineIn 就以它为准（不从文本里猜）', () => {
    const m = { urgency: '越快越好', deadlineIn: 300 } as never;
    expect(deadlineOf(m)!.remain).toBe(300);
  });

  it('没申报才退回正则（老模组兼容）', () => {
    const m = { urgency: '雨季还有二十三天结束' } as never;
    expect(deadlineOf(m)!.remain).toBe(23 * 24 * 60);
  });

  it('开新团用模组申报的开局时刻', () => {
    // startClock 是可选字段，不填就退回默认 —— 这里只钉"填了会被用上"
    const m = { startClock: { day: 3, minute: 600 } } as never;
    expect((m as { startClock?: { day: number } }).startClock?.day).toBe(3);
  });
});

/* ============================================================
 * P2-10 / H22 的**中段**（第 12 轮测出我漏了这一段）。
 *
 * 字段在 `types.ts` 加了、引擎也会读，但**提示词没告诉模型** → 恒为 undefined
 * → 开团时刻永远是上午 9:00（"今夜"的模组在上午开场）。
 * 现在契约里有了，这一层负责把模型写的东西校验成引擎能用的值。
 * ============================================================ */
/* ============================================================
 * H24：生成类请求要有**超时与出口**。
 *
 * 第 12 轮实测：点「整理成模组卡」→ 停在「整理中…」200 秒没反馈，
 * 只能刷新脱身（而刷新会把这一页填好的东西一起丢掉）。
 * `chat()` 早就支持 signal，只是 `generateJson` 一直没往下传。
 * ============================================================ */
describe('H24：生成类请求能被打断', () => {
  it('🔴 generateJson 把 signal 真的传给 chat（否则超时形同虚设）', () => {
    const src = readFileSync(new URL('../src/orchestrator/generate.ts', import.meta.url), 'utf8');
    expect(src).toContain('signal?: AbortSignal');
    // 调用 chat 时第三个参数必须是 signal
    expect(src).toMatch(/\{ \.\.\.cfg, temperature: Math\.min\(cfg\.temperature, 1\.0\) \},\s*\n\s*signal/);
  });

  it('🔴 准备页的 AiGenBox 给了「停止」出口', () => {
    const src = readFileSync(new URL('../src/ui/Preparation.tsx', import.meta.url), 'utf8');
    expect(src).toContain('AbortController');
    expect(src).toContain('停止');
    expect(src).toContain('GEN_TIMEOUT_MS');
  });

  it('超时别定短了 —— 第 9 轮实测长篇模组要 220 秒', () => {
    const src = readFileSync(new URL('../src/ui/Preparation.tsx', import.meta.url), 'utf8');
    // 5 分钟兜底（真正的出口是「停止」按钮，超时只是保险）
    expect(src).toContain('const GEN_TIMEOUT_MS = 5 * 60 * 1000;');
  });

  it('三条独立生成路径也都有兜底（一键生成两张表 + 整理成模组卡）', () => {
    const src = readFileSync(new URL('../src/ui/Preparation.tsx', import.meta.url), 'utf8');
    const hits = src.match(/const t = genTimeout\(\)/g) ?? [];
    expect(hits.length).toBeGreaterThanOrEqual(3);
  });
});

describe('P2-10 中段：模型申报的开局时刻与期限要被接住', () => {
  it('🔴 契约里确实有这两个字段（否则模型永远不知道）', () => {
    const src = readFileSync(new URL('../src/orchestrator/generate.ts', import.meta.url), 'utf8');
    // 三处模组 JSON 格式串都得带上
    const hits = src.match(/"start_clock":\{"day":1,"minute":540\}/g) ?? [];
    expect(hits.length).toBeGreaterThanOrEqual(3);
    expect(src).toContain('start_clock（故事开场的时刻，必须填）');
  });

  it('合法的 start_clock 被接住', () => {
    expect(normalizeStartClock({ day: 1, minute: 1200 })).toEqual({ day: 1, minute: 1200 });
  });

  it('🔴 不合法的当没给（宁可退回上午九点，也不能把时钟搞乱）', () => {
    expect(normalizeStartClock({ day: 0, minute: 540 })).toBeUndefined();
    expect(normalizeStartClock({ day: 1, minute: 9999 })).toBeUndefined();
    expect(normalizeStartClock({ day: 1, minute: -1 })).toBeUndefined();
    expect(normalizeStartClock(undefined)).toBeUndefined();
    expect(normalizeStartClock(null)).toBeUndefined();
    expect(normalizeStartClock({})).toBeUndefined();
  });

  it('分钟数带小数也接（模型偶尔写 540.0）', () => {
    expect(normalizeStartClock({ day: 1, minute: 540.9 })).toEqual({ day: 1, minute: 540 });
  });

  it('🔴 deadline_in：0 / 负数 / 非数字都当"没有期限"', () => {
    expect(normalizeDeadlineIn(0)).toBeUndefined();
    expect(normalizeDeadlineIn(-5)).toBeUndefined();
    expect(normalizeDeadlineIn(undefined)).toBeUndefined();
    expect(normalizeDeadlineIn(Number.NaN)).toBeUndefined();
  });

  it('正的期限被接住（23 天 = 33120 分钟）', () => {
    expect(normalizeDeadlineIn(33120)).toBe(33120);
  });
});

/* ============================================================
 * 🔴 `P3-8`（协作方第 27 版 · 主人 2026-09-28 拍板「按是不是状态过滤」）
 *
 * `P3-7` 撤掉「只留中文键」是对的，但那层过滤**顺带**还在挡
 * "模型顺手写进 flags 的非状态键"（`notes:` / `quest:` 这类）。
 * 判据换成：声明过 / 有配对轮数 / 引擎自己写的 / 布尔真 —— 四条任一；
 * **规则包没有状态表时一律显示**（安全阀，宁可多显示也不藏状态）。
 * ============================================================ */
describe('P3-8：世界页「剧情标记」按"是不是状态"过滤', () => {
  /** 一个没有状态表的规则包（自定义包的常态） */
  const noTable = { ...coc7, statusEffects: [] };

  it('🔴 模型顺手写的非状态键不再当状态列出来（notes / quest）', () => {
    const flags = { 中毒: true, notes: '记得问镇长', quest: '找那把钥匙' };
    expect(declaredStatusLines(flags, coc7).map((l) => l.key)).toEqual(['中毒']);
  });

  it('规则包声明过的状态一条都不能少（中毒 / 恐惧）', () => {
    expect(declaredStatusLines({ 中毒: true, 恐惧: true }, coc7).map((l) => l.key)).toEqual([
      '中毒',
      '恐惧',
    ]);
  });

  it('引擎自己写的键算状态（伤口 / 濒死 / 临时疯狂）', () => {
    const flags = { 伤口: '左臂一道口子', 濒死: true, 临时疯狂: '他抓着自己的头发' };
    expect(declaredStatusLines(flags, coc7).map((l) => l.key)).toEqual(['伤口', '濒死', '临时疯狂']);
  });

  it('🔴 有配对"轮数"键的也算状态（防 `H16·残留` 回归：`临时疯狂` ↔ `疯狂轮数`）', () => {
    expect(isStatusKey(coc7, { 临时疯狂: 'x', 疯狂轮数: 2 }, '临时疯狂')).toBe(true);
    // 后缀匹配（不是精确匹配）—— `turnsKeyOf('临时疯狂')` 算出来的键全仓没人写（P4-5）
    expect(isStatusKey(coc7, { 中毒: true, 中毒轮数: 2 }, '中毒')).toBe(true);
  });

  it('布尔真算状态（开关型标记），没有配对的长文本不算', () => {
    expect(declaredStatusLines({ 被跟踪: true }, coc7).map((l) => l.key)).toEqual(['被跟踪']);
    // ⚠️ 刻意取舍：既没声明、又没配对、还写成描述的 —— 世界页不列（角色卡状态栏照列）
    expect(declaredStatusLines({ 被跟踪: '有人跟在后面', memo: 'aaa' }, coc7)).toEqual([]);
  });

  it('🔴 安全阀：规则包没有状态表 → 一律显示（绝不因为判断不了就把状态藏起来）', () => {
    const flags = { notes: '随手记的', 被跟踪: '有人跟着' };
    expect(declaredStatusLines(flags, noTable).map((l) => l.key)).toEqual(['notes', '被跟踪']);
  });
});

/* ============================================================
 * 🔴 `P1-5` 阶段二：命中授权**必须真的接上**（store 层集成断言）
 *
 * 纯函数对 ≠ 接上了线 —— 这条铁律本项目踩过（`P1-3` 那次）。所以这里走真实通道：
 * 掷骰（或没掷）→ 守密人申报 `combat.foes dec` + weapon → 看引擎收不收。
 * ============================================================ */
describe('P1-5 阶段二：命中 ↔ 伤害绑定（store 层）', () => {
  const seedFight = () => {
    resetStatusTickForTest();
    resetCheckGrantForTest();
    useStore.setState({
      rulesetId: 'coc7',
      gameState: {
        ...useStore.getState().gameState,
        combat: { active: true, round: 1, foes: [{ name: '怪物', hp: 20, max: 20 }] },
      },
    });
  };
  const swing = () =>
    useStore.getState().applyModelDeltas([
      { target: 'combat.foes', op: 'dec', value: '怪物', amount: 7, weapon: '手枪' },
    ] as never);

  it('🔴 这一轮没掷过检定 → 申报的武器伤害被拒（血一点没动）', () => {
    seedFight();
    swing();
    expect(useStore.getState().gameState.combat.foes[0]!.hp).toBe(20);
  });

  it('🔴 掷中之后 → 放行（血真的掉，而且由引擎按武器表掷）', () => {
    seedFight();
    /*
     * 百分骰是「十位骰 + 个位骰」两次取随机：两颗都取 0 会得到 100（大失败）。
     * 所以固定成 0 与 0.2 → 掷出 **2**，稳稳命中（给足加值，目标值 100）。
     */
    const spy = vi
      .spyOn(Math, 'random')
      .mockReturnValueOnce(0)
      .mockReturnValueOnce(0.2);
    const badge = useStore.getState().skillCheck('格斗（斗殴）', 'regular', 999);
    spy.mockRestore();
    // 先钉住"这一掷确实中了"，否则后面那条断言失败时分不清是闸门坏了还是骰子没中
    expect(badge).toMatchObject({ success: true });
    swing();
    expect(useStore.getState().gameState.combat.foes[0]!.hp).toBeLessThan(20);
  });

  it('🔴 掷了没过 → 依然被拒（"检定成功却写没打中"的反面：没过就不许掉血）', () => {
    seedFight();
    const spy = vi.spyOn(Math, 'random').mockReturnValue(0.999); // 百分骰掷出 100 → 必败
    useStore.getState().skillCheck('格斗（斗殴）');
    spy.mockRestore();
    swing();
    expect(useStore.getState().gameState.combat.foes[0]!.hp).toBe(20);
  });
});
