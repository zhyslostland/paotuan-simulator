import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * 🔴 **全链路测试（契约 → 引擎 → 存档）** —— 2026-09-30 架构体检后新增的"阶段 2"。
 *
 * ## 为什么必须有它（体检报告 §2.4）
 *
 * 项目原本 1074 条断言，绝大多数测**纯函数**，而纯函数本来就对。
 * `statusEffects.test.ts` 自己写着结论：
 *
 * > 协作方第 25 版点名：1.0 门禁里只有纯函数测试，于是「**纯函数对、但压根没接线**」
 * > 这种错**一路漏到上线**。
 *
 * 三次上线事故（白屏 / 生图必失败 / 状态不推进）全都发生在门禁全绿时，
 * 因为它们都发生在**两层的接缝**上：
 *
 * | 接缝 | 以前靠什么发现 |
 * |---|---|
 * | 「模型申报的契约」→「引擎真的改了状态」 | 人肉真机 19 轮 |
 * | 「引擎改了状态」→「玩家看得见」 | 人肉 |
 * | 「状态」→「存档往返回来还是同一份」 | 人肉 + 偶发用户报障 |
 *
 * 这个文件把这三条缝**在本地钉住**：不联网、不塞假 provider，
 * 直接把"一份合法契约"喂给**真实的 store 通道**，然后断言**玩家能观察到的最终状态**。
 *
 * ## 边界（2026-09-30 用户拍板）
 *
 * **止于「契约 JSON → 引擎 → 存档」**：不碰真实网络、不拼假模型。
 * 真机侧仍归现有游玩测试链。所以这里只测"接缝"，不重复测纯函数。
 *
 * ## ⚠️ 写法约束（踩过的坑）
 *
 * 1. **别硬编血/理智的绝对值** —— 初始值是从角色卡推导的（默认 hp 7 / mp 11 / san 55），
 *    硬编会在角色卡一改就假红。一律**先读基线、再断言相对变化**。
 * 2. 结局 `at` 必须是 ISO 串 —— 当年写成数字时 `ending.at.slice` 直接把整页搞白。
 */


let store: typeof import('../src/ui/store.js').useStore;
let buildSystemPrompt: typeof import('../src/orchestrator/prompt.js').buildSystemPrompt;
let getRuleset: typeof import('../src/core/rulesets/index.js').getRuleset;
let deriveVitalsMax: typeof import('../src/ui/state/loaders.js').deriveVitalsMax;
let resetCheckGrantForTest: typeof import('../src/ui/store.js').resetCheckGrantForTest;

beforeAll(async () => {
  const mod = await import('../src/ui/store.js');
  store = mod.useStore;
  resetCheckGrantForTest = mod.resetCheckGrantForTest;
  buildSystemPrompt = (await import('../src/orchestrator/prompt.js')).buildSystemPrompt;
  getRuleset = (await import('../src/core/rulesets/index.js')).getRuleset;
  deriveVitalsMax = (await import('../src/ui/state/loaders.js')).deriveVitalsMax;
});

/**
 * 一局干净的起点。
 *
 * ⚠️ 初始数值**不自己算**：走 store 换规则包那条真实路径的同一套引擎函数
 * （`ruleset.deriveVitals` + `deriveVitalsMax`），否则测试算一套、应用算一套，
 * 又会变成"两处各写一份判据"——正是本项目踩了无数次的坑。
 */
function resetRun(): void {
  const s = store.getState();
  const ruleset = getRuleset(s.rulesetId);
  const vitals = ruleset.deriveVitals(s.character.characteristics);
  for (const def of ruleset.vitalDefs) {
    if (!Number.isFinite(vitals[def.key])) vitals[def.key] = def.default;
  }
  store.getState().clearMessages();
  store.setState({
    gameState: {
      ...s.gameState,
      vitals,
      vitalsMax: deriveVitalsMax(s.character, s.rulesetId),
      flags: {},
      inventory: [],
      clues: [],
      threads: [],
      wounds: [],
      combat: { active: false, round: 0, foes: [] },
      ending: null,
      dying: false,
    },
  });
}

const hp = (): number => store.getState().gameState.vitals.hp ?? 0;

/** 玩家落一条行动 → 引擎结算这一次（`N2` 之后"一轮"由玩家行动定义）。 */
function actThen(deltas: unknown[] = [], opts?: { elapsed?: string }): void {
  store.getState().addMessage({ role: 'player', content: '我继续行动。' });
  store.getState().applyModelDeltas(deltas as never, opts);
}

/** 让检定必然命中（`Math.random` 固定成 0.5 → 普通成功档）。 */
function grantCheck(skill = '格斗（斗殴）'): void {
  const spy = vi.spyOn(Math, 'random').mockReturnValue(0.5);
  store.getState().skillCheck(skill);
  spy.mockRestore();
}

beforeEach(() => {
  resetRun();
  /*
   * 🔴 关键前提：**清掉上一次检定留下的授权窗口**。
   * 不清的话，上一条用例掷过的检定会给这一条"续命"（`CHECK_GRANT_MS` 窗口内），
   * "没掷就扣不动血"那条就会假绿 —— 那种假绿正是本项目最怕的。
   */
  resetCheckGrantForTest();
});

describe('全链路 · 契约 → 引擎（玩家能观察到的最终状态）', () => {
  it('契约里的 vitals 扣减，掷过检定后真的落到玩家身上', () => {
    const before = hp();
    grantCheck();
    actThen([{ target: 'vitals.hp', op: 'dec', amount: 3, reason: '被咬了一口' }]);
    expect(hp()).toBe(before - 3);
  });

  it('引擎权威：没掷检定、又没写明理由，模型扣不动玩家的血（G25/G27 的接缝）', () => {
    const before = hp();
    // ⚠️ 不写 `reason`：闸门的判据是"没掷过 **且** 没理由"（`gameState.ts:626`）
    actThen([{ target: 'vitals.hp', op: 'dec', amount: 3 }]);
    expect(hp()).toBe(before);
  });

  it('环境伤害那一档是**故意**放行的：没掷检定但写明了理由，就该扣', () => {
    const before = hp();
    actThen([{ target: 'vitals.hp', op: 'dec', amount: 3, reason: '从二楼摔下去' }]);
    expect(hp()).toBe(before - 3);
  });

  it('契约里的 flags 状态落到玩家身上（状态可见的前提）', () => {
    actThen([{ target: 'flags.中毒', op: 'set', value: true }]);
    expect(store.getState().gameState.flags['中毒']).toBe(true);
  });

  it('消耗品按数量扣：契约 dec 一次，背包真的少一个（扣到 0 就从背包消失）', () => {
    store.setState({
      gameState: {
        ...store.getState().gameState,
        inventory: [{ id: '子弹', name: '子弹', qty: 2 }],
      },
    });
    actThen([{ target: 'inventory', op: 'dec', value: '子弹', amount: 1 }]);
    expect(store.getState().gameState.inventory.find((i) => i.name === '子弹')?.qty).toBe(1);

    actThen([{ target: 'inventory', op: 'dec', value: '子弹', amount: 1 }]);
    expect(store.getState().gameState.inventory.find((i) => i.name === '子弹')).toBeUndefined();
  });

  it('战斗轮次由引擎推进：模型申报的 combat.round 一律被忽略（G1）', () => {
    actThen([
      { target: 'combat.active', op: 'set', value: true },
      { target: 'combat.foes', op: 'add', value: { name: '雾中的巨影', hp: 20, max: 20 } },
      // ⚠️ 模型照老习惯写轮次 —— 引擎必须当它没写
      { target: 'combat.round', op: 'set', value: 99 },
    ]);
    const combat = store.getState().gameState.combat;
    expect(combat?.active).toBe(true);
    expect(combat?.round).not.toBe(99);
  });

  it('结档：引擎收档并留下可读的 kind，且 at 是 ISO 串（当年写成数字整页白）', () => {
    store.getState().forceEnding('success', '你带着真相走出了灯塔。');
    const ending = store.getState().gameState.ending;
    expect(ending?.kind).toBe('success');
    expect(typeof ending?.at).toBe('string');
    expect(Number.isNaN(Date.parse(ending!.at))).toBe(false);
  });
});

describe('全链路 · 引擎 → 存档（往返之后还是同一份事实）', () => {
  it('buildSave → loadSave 往返：血、状态、背包、时钟都不丢', () => {
    grantCheck();
    actThen(
      [
        { target: 'vitals.hp', op: 'dec', amount: 2, reason: '擦伤' },
        { target: 'flags.诅咒缠身', op: 'set', value: true },
        { target: 'inventory', op: 'add', value: { id: '黄铜钥匙', name: '黄铜钥匙', qty: 1 } },
      ],
      { elapsed: '十分钟' }
    );

    const saved = store.getState().buildSave();
    const hpBefore = hp();
    const hpMaxBefore = store.getState().gameState.vitalsMax?.hp ?? hpBefore;
    const clockBefore = store.getState().gameState.clock;
    // 扣减必须真的发生过，否则这条"往返"测的是两个满血
    expect(hpBefore).toBeLessThan(hpMaxBefore);

    resetRun();
    store.getState().loadSave(saved);

    expect(hp()).toBe(hpBefore);
    expect(store.getState().gameState.flags['诅咒缠身']).toBe(true);
    expect(store.getState().gameState.inventory.some((i) => i.name === '黄铜钥匙')).toBe(true);
    expect(store.getState().gameState.clock).toEqual(clockBefore);
  });

  it('坏档不许把玩家现有的那一局静默重置掉（P2-8 家族）', () => {
    grantCheck();
    actThen([{ target: 'vitals.hp', op: 'dec', amount: 2, reason: '擦伤' }]);
    const before = hp();
    const hpMaxBefore = store.getState().gameState.vitalsMax?.hp ?? before;
    expect(before).toBeLessThan(hpMaxBefore);

    expect(() => store.getState().loadSave({ version: 999, nonsense: true })).not.toThrow();
    // 关键：坏档不能把"正在玩的这一局"悄悄变成满血新局
    expect(hp()).toBe(before);
  });
});

describe('全链路 · 提示词 → 引擎（登记表要求的内容真的在提示词里）', () => {
  it('真实通道构造出的系统提示词，带着登记表里每一条锚点', async () => {
    const { FACT_REGISTRY } = await import('../src/core/contract.js');
    const { getRuleset: getRs } = await import('../src/core/rulesets/index.js');
    const { getGenre } = await import('../src/core/genres.js');
    const s = store.getState();
    /*
     * ⚠️ 形状照抄 `prompt.test.ts` 的 `buildPrompt()`（那份是既有事实上的口径）。
     * 这里刻意走**真实 store 的角色 / 模组 / 状态**，而不是手搓一份假的 ——
     * 否则测的是"我编的上下文能出锚点"，不是"玩家那一局能出锚点"。
     */
    const prompt = buildSystemPrompt({
      rulesetName: getRs(s.rulesetId).name,
      ruleset: getRs(s.rulesetId),
      genre: getGenre(s.genreId),
      module: s.module,
      character: s.character,
      playerAddress: s.character.name || '你',
      gameState: s.gameState,
      worldbook: [],
      chronicle: [],
    } as never);

    // 提示词是真字符串，不是空壳
    expect(prompt.length).toBeGreaterThan(2000);
    // 每条登记事实的提示词锚点，必须真的能在**构造出来的提示词**里找到
    // （归一：反引号在源码里是转义序列、粗体在源码里是拼接 —— 构造出来才是真字符）
    const flat = prompt.split('\\').join('').split('**').join('*');
    const { promptAnchors } = await import('../src/core/contract.js');
    const missing = promptAnchors().filter(
      (a) => !flat.includes(a.split('\\').join('').split('**').join('*'))
    );
    expect(missing, `提示词里缺少登记表要求的内容：${missing.join(' | ')}`).toEqual([]);
    // 登记表本身非空（防"登记表被清空"这种假绿）
    expect(FACT_REGISTRY.length).toBeGreaterThan(10);
    // 且至少有一条真的带提示词锚点（防"全被写成 null"这种假绿）
    expect(promptAnchors().length).toBeGreaterThan(10);
  });
});
