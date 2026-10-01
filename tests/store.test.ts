import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { getRuleset } from '../src/core/rulesets/index.js';
import { getGenre, type Genre } from '../src/core/genres.js';
import { MemStorage } from './setup.js';

/**
 * 回溯/重掷依赖 localStorage。node 环境没有它，这里放一个最小桩，
 * 必须在 import store 之前装好——store 在模块加载时就会读盘。
 */

let store: typeof import('../src/ui/store.js').useStore;
let deriveAddress: typeof import('../src/ui/store.js').deriveAddress;
let addressOf: typeof import('../src/ui/store.js').addressOf;
let mergeCharacter: typeof import('../src/ui/store.js').mergeCharacter;
let mergeModule: typeof import('../src/ui/store.js').mergeModule;
let resolveCheckTarget: typeof import('../src/ui/store.js').resolveCheckTarget;
let skillBudget: typeof import('../src/ui/store.js').skillBudget;
let normalizeCompanion: typeof import('../src/ui/store.js').normalizeCompanion;
let reconcileVitals: typeof import('../src/ui/store.js').reconcileVitals;
let initialLocation: typeof import('../src/ui/store.js').initialLocation;
let initialNpcs: typeof import('../src/ui/store.js').initialNpcs;
let createInitialState: typeof import('../src/core/state/gameState.js').createInitialState;
let mapNodesOf: typeof import('../src/ui/store.js').mapNodesOf;
let starterCharacterOf: typeof import('../src/ui/store.js').starterCharacterOf;
let applyPreset: typeof import('../src/ui/preset.js').applyPreset;
let fillPlayerTokens: typeof import('../src/ui/store.js').fillPlayerTokens;
let sanitizeStateTokens: typeof import('../src/ui/store.js').sanitizeStateTokens;
let sanitizeModuleTokens: typeof import('../src/ui/store.js').sanitizeModuleTokens;
let checkTargetText: typeof import('../src/ui/store.js').checkTargetText;
let canonicalSkillName: typeof import('../src/ui/store.js').canonicalSkillName;
let migrateSave: typeof import('../src/ui/store.js').migrateSave;
let SAVE_VERSION: typeof import('../src/ui/store.js').SAVE_VERSION;
let defaultCharacteristics: typeof import('../src/ui/store.js').defaultCharacteristics;
let openingText: typeof import('../src/ui/store.js').openingText;
let starterSkillsFor: typeof import('../src/ui/store.js').starterSkillsFor;
let characteristicBudget: typeof import('../src/ui/store.js').characteristicBudget;
let loadGameState: typeof import('../src/ui/state/loaders.js').loadGameState;
/*
 * `P4-4`：这里以前 import 的是 `INSANITY_TURNS_FLAG` 这个**死常量**（src 里没人用它），
 * 断言也只是"常量等于那个字面值"—— 同义反复，什么都没守住。
 * 现在断的是真正的那条链：**引擎写进去的键，必须被状态过滤认出来**。
 */
let turnsKeyOf: typeof import('../src/core/statusEffects.js').turnsKeyOf;
let isTurnsKey: typeof import('../src/core/statusEffects.js').isTurnsKey;
let statusFlagLines: typeof import('../src/core/statusEffects.js').statusFlagLines;
let resetStatusTickForTest: typeof import('../src/ui/store.js').resetStatusTickForTest;
let resetCheckGrantForTest: typeof import('../src/ui/store.js').resetCheckGrantForTest;
let capSkillsToBudget: typeof import('../src/core/skills.js').capSkillsToBudget;
let migrateCharacter: typeof import('../src/ui/state/loaders.js').migrateCharacter;

/**
 * 🔴 `G25`（协28 §F① 第 6b 条 · 主人 2026-09-29「**动我属性都要检定的**」）：
 * **要动玩家属性，得先真的掷过一次检定。**
 *
 * 下面若干组用例验的是"血归零 / 疯狂 / 伤口"这条**下游行为**，不是闸门本身 ——
 * 所以先给它们一张通行证。闸门自己的判据在 `state.test.ts`（核心层）与
 * `statusEffects.test.ts`（接线层），那两处才是"没掷就该拒"的地方。
 */
const grantHarmCheck = () => {
  const spy = vi.spyOn(Math, 'random').mockReturnValue(0.5);
  store.getState().skillCheck('格斗（斗殴）');
  spy.mockRestore();
};

/**
 * 🔴 `N2`（协30 §2.3）之后，"一轮"由**玩家行动**定义（不再是"调一次 `applyModelDeltas`"）。
 * 下面这几组用例原本靠"调一次"当一轮 —— 现在得真的落一条玩家消息，引擎才认这一轮。
 * 与 `grantHarmCheck` 一样，这是**前提**，不是被测的东西。
 */
const actThen = (deltas: unknown[] = []) => {
  store.getState().addMessage({ role: 'player', content: '我继续行动。' });
  return store.getState().applyModelDeltas(deltas as never);
};


beforeAll(async () => {
  const mod = await import('../src/ui/store.js');
  loadGameState = (await import('../src/ui/state/loaders.js')).loadGameState;
  migrateCharacter = (await import('../src/ui/state/loaders.js')).migrateCharacter;
  const se = await import('../src/core/statusEffects.js');
  turnsKeyOf = se.turnsKeyOf;
  isTurnsKey = se.isTurnsKey;
  statusFlagLines = se.statusFlagLines;
  store = mod.useStore;
  resetStatusTickForTest = mod.resetStatusTickForTest;
  resetCheckGrantForTest = mod.resetCheckGrantForTest;
  capSkillsToBudget = (await import('../src/core/skills.js')).capSkillsToBudget;
  deriveAddress = mod.deriveAddress;
  addressOf = mod.addressOf;
  mergeCharacter = mod.mergeCharacter;
  mergeModule = mod.mergeModule;
  resolveCheckTarget = mod.resolveCheckTarget;
  skillBudget = mod.skillBudget;
  normalizeCompanion = mod.normalizeCompanion;
  reconcileVitals = mod.reconcileVitals;
  initialLocation = mod.initialLocation;
  initialNpcs = mod.initialNpcs;
  createInitialState = (await import('../src/core/state/gameState.js')).createInitialState;
  mapNodesOf = mod.mapNodesOf;
  starterCharacterOf = mod.starterCharacterOf;
  applyPreset = (await import('../src/ui/preset.js')).applyPreset;
  fillPlayerTokens = mod.fillPlayerTokens;
  sanitizeStateTokens = mod.sanitizeStateTokens;
  sanitizeModuleTokens = mod.sanitizeModuleTokens;
  checkTargetText = mod.checkTargetText;
  canonicalSkillName = mod.canonicalSkillName;
  migrateSave = mod.migrateSave;
  SAVE_VERSION = mod.SAVE_VERSION;
  defaultCharacteristics = mod.defaultCharacteristics;
  openingText = mod.openingText;
  starterSkillsFor = mod.starterSkillsFor;
  characteristicBudget = mod.characteristicBudget;
});

beforeEach(() => {
  store.getState().clearMessages();
  store.setState({
    gameState: {
      ...store.getState().gameState,
      vitals: { ...store.getState().gameState.vitals, san: 70 },
    },
  });
});

/** 直接改 san，模拟模型返回 state_delta 之后的落库结果 */
const setSan = (v: number) =>
  store.setState({
    gameState: {
      ...store.getState().gameState,
      vitals: { ...store.getState().gameState.vitals, san: v },
    },
  });

/**
 * 🔴 **可见降级通道**（2026-09-30 加）。
 *
 * 起因：`App.tsx` 的纠正回路用尽后，正文照给（玩家不能空等），但若它仍推翻玩家操作，
 * 必须让玩家知道 —— 原来 `uiNotice` 只有**内部写**（生图那四处 `set({uiNotice})`），
 * 别的模块想说一句人话只能 `useStore.setState(...)`（绕过 store 的暗门）。
 * 现在补成正式 action：`notify` 写、`takeNotice` 取。
 */
describe('给玩家的一句话：notify / takeNotice', () => {
  it('notify 写进去，takeNotice 取走并清空（取完即清，不重复弹）', () => {
    store.getState().notify('这一段可能在替你改剧情，可以点「回溯」退回这一步。');
    expect(store.getState().uiNotice).toContain('回溯');
    expect(store.getState().takeNotice()).toBeUndefined(); // action 返回 void
    expect(store.getState().uiNotice).toBeNull();
    expect(store.getState().takeNotice()).toBeUndefined();
  });

  it('空串也能写（由调用方决定要不要给玩家看）—— 但取走后必须回到 null', () => {
    store.getState().notify('');
    store.getState().takeNotice();
    expect(store.getState().uiNotice).toBeNull();
  });
});

describe('回合快照与回溯', () => {
  it('回溯会恢复当时的状态，并截断其后所有消息', () => {
    const p1 = store.getState().addMessage({ role: 'player', content: '行动一' });
    store.getState().snapshotTurn(p1);
    setSan(60);
    store.getState().addMessage({ role: 'gm', content: '结果一' });

    const p2 = store.getState().addMessage({ role: 'player', content: '行动二' });
    store.getState().snapshotTurn(p2);
    setSan(50);
    store.getState().addMessage({ role: 'gm', content: '结果二' });

    expect(store.getState().messages).toHaveLength(4);

    // 回溯到「行动二」之前
    store.getState().rewindBefore(p2);

    const s = store.getState();
    expect(s.messages).toHaveLength(2);
    expect(s.messages.map((m) => m.content)).toEqual(['行动一', '结果一']);
    expect(s.gameState.vitals.san).toBe(60); // 恢复到行动二发生前的状态
  });

  it('回溯到第一条玩家消息之前时清空消息，状态回到初始', () => {
    const p1 = store.getState().addMessage({ role: 'player', content: '行动一' });
    store.getState().snapshotTurn(p1);
    setSan(40);
    store.getState().addMessage({ role: 'gm', content: '结果一' });

    store.getState().rewindBefore(p1);

    const s = store.getState();
    expect(s.messages).toHaveLength(0);
    expect(s.gameState.vitals.san).toBe(70);
  });

  it('被截断消息的快照会被一并清理，不会残留', () => {
    const p1 = store.getState().addMessage({ role: 'player', content: '行动一' });
    store.getState().snapshotTurn(p1);
    const p2 = store.getState().addMessage({ role: 'player', content: '行动二' });
    store.getState().snapshotTurn(p2);
    const p3 = store.getState().addMessage({ role: 'player', content: '行动三' });
    store.getState().snapshotTurn(p3);

    expect(Object.keys(store.getState().snapshots).sort()).toEqual([p1, p2, p3].sort());

    store.getState().rewindBefore(p2);

    // p2 及其后的快照都应消失，只剩 p1
    expect(Object.keys(store.getState().snapshots)).toEqual([p1]);
  });

  it('quick 清空消息时快照一并清空', () => {
    const p1 = store.getState().addMessage({ role: 'player', content: '行动一' });
    store.getState().snapshotTurn(p1);
    expect(Object.keys(store.getState().snapshots)).toHaveLength(1);

    store.getState().clearMessages();
    expect(store.getState().snapshots).toEqual({});
  });

  it('回溯到不存在的消息 id 时不做任何改动', () => {
    const p1 = store.getState().addMessage({ role: 'player', content: '行动一' });
    store.getState().snapshotTurn(p1);
    const before = store.getState().messages;

    store.getState().rewindBefore('不存在');

    expect(store.getState().messages).toBe(before);
  });
});

describe('开场白跟随角色姓名与称呼', () => {
  it('西式译名推导出姓氏敬称，而不是直呼全名', () => {
    expect(deriveAddress('艾伦·霍尔特')).toBe('霍尔特先生');
    expect(deriveAddress('卢卡斯')).toBe('卢卡斯先生');
  });

  it('性别为女时用"女士"，不会叫成先生', () => {
    expect(deriveAddress('卢卡斯', '女')).toBe('卢卡斯女士');
    expect(deriveAddress('艾琳·布莱克', '女')).toBe('布莱克女士');
  });

  /*
   * ⚠️ 这两条测的是**旧设计**（开场白里永远有玩家称呼），2026-09-17 改了口径：
   *
   * 主人报的 bug ①「开场白串味」—— 测试模组没写开场白时，
   * 开局居然显示的是**默认模组**（霍尔特侦探事务所）的开场白。
   * 修法是让开场白**属于模组**：模组自己写了就用它的，没写就用
   * **它自己的** premise + 起始地点拼，都不够才退到"只有场景没有情节"的题材兜底。
   *
   * 于是"开场白里必然出现玩家称呼"这个前提不再成立 ——
   * 没写 `{{称呼}}` 的开场白就是没有称呼，这是**对的**。
   * 但**占位符替换本身**必须照旧生效，所以这两条改成测替换。
   */
  it('开场白里的 {{称呼}} 会按新名字重推导', () => {
    store.setState({
      messages: [
        { id: 'welcome', role: 'gm', content: '开场白，称呼是霍尔特。', ts: 0 },
      ],
      module: { ...store.getState().module, opening: '「{{称呼}}，你总算来了。」' },
    });

    store.getState().setCharacter({ name: '卢卡斯' });

    expect(store.getState().messages[0]!.content).toContain('卢卡斯先生');
    expect(store.getState().messages[0]!.content).not.toContain('{{');
  });

  it('手填的称呼优先于推导值', () => {
    store.setState({
      messages: [{ id: 'welcome', role: 'gm', content: '开场白。', ts: 0 }],
      module: { ...store.getState().module, opening: '「{{称呼}}。」' },
    });

    store.getState().setCharacter({ address: '陈小姐' });

    expect(store.getState().messages[0]!.content).toContain('陈小姐');
  });

  /*
   * bug ① 的回归测试：没写开场白的模组**绝不许**套用默认模组那段。
   * 判据是"出现默认模组的独有内容"——「霍尔特的侦探事务所」「玛乔丽」都是。
   */
  it('没写开场白的模组不会套用默认模组的开场白（防串味）', () => {
    const s = store.getState();
    const bare = {
      ...s.module,
      opening: '',
      premise: '',
      startLocation: '',
      locations: '',
      goal: '',
      stakes: '',
      urgency: '',
    };
    const text = openingText(store.getState().character, bare, 'coc');
    expect(text).not.toContain('霍尔特');
    expect(text).not.toContain('玛乔丽');
    expect(text).not.toContain('侦探事务所');
  });

  it('没写开场白但有自己的前提时，用前提拼（不串到别的模组）', () => {
    const s = store.getState();
    const m = {
      ...s.module,
      opening: '',
      premise: '雨已经下了十九天。',
      // `startLocation` 优先于 `locations`，这里两个都给上同一个地方
      startLocation: '山城旅店',
      locations: '山城旅店',
    };
    const text = openingText(store.getState().character, m, 'coc');
    expect(text).toContain('雨已经下了十九天');
    expect(text).toContain('山城旅店');
    expect(text).not.toContain('霍尔特');
  });

  it('旧存档缺 address 字段时按姓名推导，不会套用默认的"霍尔特先生"', () => {
    // 用户改名早于「称呼」字段上线，存档里没有 address
    const c = mergeCharacter(JSON.stringify({ name: '卢卡斯' }));
    expect(addressOf(c)).toBe('卢卡斯先生');
  });

  it('旧结构存档（occupation/age/background）会迁移成 description，并补齐属性', () => {
    const c = mergeCharacter(
      JSON.stringify({
        name: '林深',
        gender: '女',
        occupation: '记者',
        age: 28,
        background: '追查一桩无人敢碰的旧案。',
      })
    );
    expect(c.description).toContain('记者');
    expect(c.description).toContain('28 岁');
    expect(c.description).toContain('追查一桩无人敢碰的旧案');
    expect(c.personality).toBe('');
    expect(Object.keys(c.characteristics)).toContain('str');
    expect(addressOf(c)).toBe('林深女士');
  });

  it('换模组（改 goal）也会同步开场白，不用重新开团', () => {
    /*
     * 用户 2026-09-16 实测："换模组后上一条模组的文案没清。"
     * 根因：setModule 只判断 `patch.opening !== undefined`，
     * 于是任何"不带 opening 的换模组"（测试沙盒的切模组按钮就是）
     * 都会把上一个模组的开场白留在屏幕上。
     */
    store.setState({
      messages: [{ id: 'welcome', role: 'gm', content: '上一个模组的开场白。', ts: 0 }],
    });
    store.getState().setModule({ goal: '找到灯塔并点亮它' });
    expect(store.getState().messages[0]!.content).toContain('找到灯塔并点亮它');
  });

  it('换模组不会动到后面已经玩出来的消息', () => {
    store.setState({
      messages: [
        { id: 'welcome', role: 'gm', content: '旧开场白。', ts: 0 },
        { id: 'p1', role: 'player', content: '我推门进去。', ts: 1 },
        { id: 'g1', role: 'gm', content: '门开了。', ts: 2 },
      ],
    });
    store.getState().setModule({ goal: '拿到那卷胶卷' });
    const msgs = store.getState().messages;
    expect(msgs).toHaveLength(3);
    expect(msgs[1]!.content).toBe('我推门进去。');
    expect(msgs[2]!.content).toBe('门开了。');
  });
});

describe('属性默认值要有起伏（用户："默认属性太平均了"）', () => {
  /*
   * 原来 defaultCharacteristics 直接返回每个属性的 default —— COC 全是 50，
   * 八个属性一模一样，那不是一个人，是一张表格。
   */
  it('COC 的属性不全相等，且都落在规则包范围内', () => {
    const ch = defaultCharacteristics('coc7');
    const rs = getRuleset('coc7');
    const values = Object.values(ch);
    expect(values).toHaveLength(rs.characteristicDefs.length);
    expect(new Set(values).size).toBeGreaterThan(1);
    for (const def of rs.characteristicDefs) {
      expect(ch[def.key]).toBeGreaterThanOrEqual(def.min);
      expect(ch[def.key]).toBeLessThanOrEqual(def.max);
    }
  });

  it('确定性：同一个规则包每次得到同一套（属性不会自己跳）', () => {
    expect(defaultCharacteristics('coc7')).toEqual(defaultCharacteristics('coc7'));
  });

  it('换规则包按各自的属性表生成（DnD 是 3-18）', () => {
    const ch = defaultCharacteristics('dnd5e');
    const rs = getRuleset('dnd5e');
    for (const def of rs.characteristicDefs) {
      expect(ch[def.key]).toBeGreaterThanOrEqual(def.min);
      expect(ch[def.key]).toBeLessThanOrEqual(def.max);
    }
  });
});

/*
 * 用户 2026-09-17 报「属性上限/总额设定」。
 * 原来一排数字没有任何总额概念，玩家把每项都拉到 90 也不知道自己超了规则。
 */
describe('属性点预算（COC 八项共 460）', () => {
  it('COC 给出总额 460，并正确算出已用与剩余', () => {
    const ch = { str: 60, con: 60, siz: 60, dex: 60, app: 60, int: 60, pow: 60, edu: 60 };
    const b = characteristicBudget('coc7', ch);
    expect(b.total).toBe(460);
    expect(b.spent).toBe(480);
    expect(b.remaining).toBe(-20);
  });

  it('默认属性**不超预算**（不然一开局就是违规角色）', () => {
    const b = characteristicBudget('coc7', defaultCharacteristics('coc7'));
    expect(b.remaining).toBeGreaterThanOrEqual(0);
  });

  it('DnD 不给总额约束（460 对 3-18 的量纲毫无意义）', () => {
    const b = characteristicBudget('dnd5e', { str: 14, dex: 12, con: 12, int: 10, wis: 10, cha: 10 });
    expect(b.total).toBeNull();
    expect(b.remaining).toBeNull();
    // 但单项范围照旧给
    expect(b.min).toBe(3);
    expect(b.max).toBe(18);
  });

  it('缺键按 0 计，不会算出 NaN', () => {
    const b = characteristicBudget('coc7', { str: 50 });
    expect(Number.isFinite(b.spent)).toBe(true);
    expect(b.spent).toBe(50);
  });

  it('非 1d100 量纲的规则包不给总额（460 只适用于 COC 那一套）', () => {
    // DnD 用的是 d20，属性 3-18 —— 总额约束按量纲关掉
    const b = characteristicBudget('dnd5e', { str: 18, dex: 18, con: 18, int: 18, wis: 18, cha: 18 });
    expect(b.total).toBeNull();
    expect(b.spent).toBe(108);
  });
});

describe('开团 startNewGame', () => {
  it('清空剧情/线索/进度，按当前模组的开场白重置首条消息，并把数值恢复满', () => {
    store.getState().startNewGame();
    store.getState().addMessage({ role: 'player', content: '我推开门' });
    store.getState().addMessage({ role: 'gm', content: '门后一片漆黑。' });
    store.getState().addChronicle('玩家推开了门');
    store.setState({
      gameState: {
        ...store.getState().gameState,
        clues: ['一条旧线索'],
        location: '旧城区',
        vitals: { ...store.getState().gameState.vitals, san: 20 },
      },
    });

    store.getState().setModule({ opening: '{{称呼}}，故事从这里开始。', startLocation: '某事务所' });
    // 数值派生：SAN 起始 = POW，把意志设为 70 以便断言
    store.getState().setCharacter({
      characteristics: { ...store.getState().character.characteristics, pow: 70, con: 50, siz: 50 },
    });
    store.getState().startNewGame();

    const s = store.getState();
    expect(s.messages).toHaveLength(1);
    expect(s.messages[0]!.content).toContain('故事从这里开始');
    expect(s.messages[0]!.content).not.toContain('{{称呼}}');
    expect(s.chronicle).toHaveLength(0);
    expect(s.gameState.clues).toEqual([]);
    // 开局面板不再空着：地点取模组的 startLocation，在场人物取开场白/前言里点名的人
    expect(s.gameState.location).toBe('某事务所');
    expect(s.gameState.vitals.san).toBe(70);
    expect(s.gameState.vitals.hp).toBe(10); // (50+50)/10
    expect(s.gameState.vitalsMax?.san).toBe(99);
    expect(s.gameState.vitalsMax?.hp).toBe(10);
    expect(s.snapshots).toEqual({});
  });

  it('开团把角色卡里的物品连简介一起带进背包', () => {
    store.getState().setCharacter({
      items: ['柯尔特左轮', '牛皮纸笔记本'],
      itemDetails: [
        { name: '柯尔特左轮', desc: '六发左轮，关键时刻能保命', kind: 'weapon', damage: '1d10', skill: '射击（手枪）' },
      ],
    });
    store.getState().startNewGame();
    const inv = store.getState().gameState.inventory;
    const gun = inv.find((i) => i.name === '柯尔特左轮');
    expect(gun?.desc).toBe('六发左轮，关键时刻能保命');
    expect(gun?.kind).toBe('weapon');
    expect(gun?.damage).toBe('1d10');
    expect(gun?.skill).toBe('射击（手枪）');
    // 没配详情的物品照常进背包，只是没有简介
    expect(inv.find((i) => i.name === '牛皮纸笔记本')).toBeDefined();
  });
});

describe('数值条缺键补齐（MP/SAN 显示 0 的根因）', () => {
  it('旧存档只有 hp 时，按属性派生值补出 mp 与 san，不再显示 0', () => {
    const c = mergeCharacter(JSON.stringify({ characteristics: { pow: 60, con: 50, siz: 50 } }));
    const state = createInitialState({ vitals: { hp: 5 } }); // 缺 mp / san
    const fixed = reconcileVitals(state, c, 'coc7');
    expect(fixed.vitals.mp).toBe(12); // 60 / 5
    expect(fixed.vitals.san).toBe(60); // 起始 SAN = POW
    expect(fixed.vitals.hp).toBe(5); // 已有的值不动
  });

  it('键齐全时原样返回，不做多余改写', () => {
    const c = mergeCharacter(JSON.stringify({ characteristics: { pow: 60 } }));
    const state = createInitialState({ vitals: { hp: 10, mp: 12, san: 44 } });
    const fixed = reconcileVitals(state, c, 'coc7');
    expect(fixed.vitals).toEqual({ hp: 10, mp: 12, san: 44 });
  });
});

describe('开局地点与在场人物', () => {
  it('开局地点优先 startLocation，其次地点表第一行', () => {
    expect(
      initialLocation({
        title: '',
        premise: '',
        opening: '',
        truth: '',
        npcs: [],
        locations: '码头\n灯塔',
        clueChain: '',
        acts: '',
        endings: '',
        notes: '',
      })
    ).toBe('码头');
    expect(
      initialLocation({
        title: '',
        premise: '',
        opening: '',
        truth: '',
        npcs: [],
        locations: '码头\n灯塔',
        startLocation: '守塔人的小屋',
        clueChain: '',
        acts: '',
        endings: '',
        notes: '',
      })
    ).toBe('守塔人的小屋');
  });

  it('在场人物只取开场白/前言里点过名的人，未登场的不会被拉进来', () => {
    const mk = { id: '1', name: '老马林', role: '', motive: '', secret: '' };
    const other = { id: '2', name: '米莉安', role: '', motive: '', secret: '' };
    const base = {
      title: '',
      truth: '',
      locations: '',
      clueChain: '',
      acts: '',
      endings: '',
      notes: '',
      npcs: [mk, other],
    };
    expect(
      initialNpcs({ ...base, premise: '守塔人老马林不见踪影。', opening: '海雾很重。' })
    ).toEqual(['老马林']);
    expect(initialNpcs({ ...base, premise: '', opening: '' })).toEqual([]);
  });
});

describe('模组（团）', () => {
  it('设置开场白会同步到首条消息，并把 {{称呼}} 替换成玩家的称呼', () => {
    store.setState({
      messages: [{ id: 'welcome', role: 'gm', content: '旧的开场', ts: 0 }],
    });

    store.getState().setModule({ opening: '{{称呼}}，有人在暗房里等你。' });

    const first = store.getState().messages[0]!;
    expect(first.content).toContain('，有人在暗房里等你。');
    expect(first.content).not.toContain('{{称呼}}');
  });

  it('旧模组存档（outline）迁移成 truth，新字段留空而不是套默认模组', () => {
    const m = mergeModule(
      JSON.stringify({ title: '旧模组', premise: '引言', opening: '开场', outline: '这就是真相' })
    );
    expect(m.truth).toBe('这就是真相');
    expect(m.npcs).toEqual([]);
    expect(m.locations).toBe('');
    expect(m.clueChain).toBe('');
  });
});


describe('检定目标解析（技能 + 属性）', () => {
  it('技能名优先于属性', () => {
    const c = mergeCharacter(JSON.stringify({ skills: { 侦查: 70 }, characteristics: { str: 55 } }));
    expect(resolveCheckTarget('侦查', c, getRuleset('coc7'))).toBe(70);
  });

  it('属性可用英文键解析', () => {
    const c = mergeCharacter(JSON.stringify({ characteristics: { str: 55, dex: 60 } }));
    expect(resolveCheckTarget('str', c, getRuleset('coc7'))).toBe(55);
  });

  it('属性可用中文标签解析', () => {
    const c = mergeCharacter(JSON.stringify({ characteristics: { dex: 60 } }));
    expect(resolveCheckTarget('敏捷', c, getRuleset('coc7'))).toBe(60);
  });

  it('找不到返回 null', () => {
    const c = mergeCharacter(JSON.stringify({ skills: {}, characteristics: {} }));
    expect(resolveCheckTarget('不存在的技能', c, getRuleset('coc7'))).toBeNull();
  });
});

describe('技能点预算', () => {
  it('总预算 = 教育×4 + 智力×2', () => {
    const c = mergeCharacter(JSON.stringify({ characteristics: { edu: 60, int: 50 } }));
    const b = skillBudget(c, 'coc7');
    expect(b.total).toBe(60 * 4 + 50 * 2);
  });

  it('已用 = Σ(技能值 − 基础值)，不把低于基础值的算成负数', () => {
    // 侦查基础 25 → 70 用掉 45；心理学基础 10 → 60 用掉 50
    const c = mergeCharacter(
      JSON.stringify({ characteristics: { edu: 60, int: 50 }, skills: { 侦查: 70, 心理学: 60 } })
    );
    const b = skillBudget(c, 'coc7');
    expect(b.spent).toBe(45 + 50);
  });

  it('自定义技能基础值按 0 计', () => {
    const c = mergeCharacter(
      JSON.stringify({ characteristics: { edu: 50, int: 50 }, skills: { 自定义技能: 30 } })
    );
    expect(skillBudget(c, 'coc7').spent).toBe(30);
  });
});

describe('同伴数值规范化与入队门槛', () => {
  it('把脏键清洗成规则包定义的 hp/san/mp，并记录上限', () => {
    const c = normalizeCompanion({
      id: 'x',
      name: '某人',
      role: '记者',
      personality: '话多',
      skills: {},
      vitals: { hp: 12, san: 60, 血: 999 } as never,
      initiative: 'reactive',
      alive: true,
      present: true,
    });
    expect(Object.keys(c.vitals).sort()).toEqual(['hp', 'mp', 'san']);
    expect(c.vitals.hp).toBe(12);
    expect(c.vitalsMax).toEqual(c.vitals);
    expect(c.met).toBe(false);
  });

  it('剧情里出现候选名字后才会被标记为已登场', () => {
    store.getState().setCompanionCandidates([
      {
        id: 'cand1',
        name: '米拉·陈',
        role: '记者',
        personality: '',
        skills: {},
        vitals: { hp: 10, san: 60, mp: 10 },
        initiative: 'reactive',
        alive: true,
        present: true,
        met: false,
      },
    ]);
    // 未出现 → 仍不可入队
    store.getState().markCandidatesMet('你推开门，屋里空无一人。');
    expect(store.getState().companionCandidates[0]!.met).toBe(false);
    store.getState().recruitCompanion('cand1');
    expect(store.getState().gameState.companions.find((c) => c.id === 'cand1')).toBeUndefined();

    // 名字出现 → 已登场，可入队
    store.getState().markCandidatesMet('米拉抬起头，看了你一眼。');
    expect(store.getState().companionCandidates[0]!.met).toBe(true);
    store.getState().recruitCompanion('cand1');
    expect(store.getState().gameState.companions.find((c) => c.id === 'cand1')).toBeDefined();
  });
});

describe('地图节点（空间信息）', () => {
  it('模组给了 mapNodes 就用它，并清洗空值', () => {
    const nodes = mapNodesOf({
      title: '',
      premise: '',
      opening: '',
      truth: '',
      npcs: [],
      locations: '甲\n乙',
      mapNodes: [
        { name: ' 甲 ', links: ['乙', ' '], note: '起点' },
        { name: '乙', links: ['甲'] },
        { name: '   ' },
      ],
      clueChain: '',
      acts: '',
      endings: '',
      notes: '',
    });
    expect(nodes.map((n) => n.name)).toEqual(['甲', '乙']);
    expect(nodes[0]!.links).toEqual(['乙']);
    expect(nodes[0]!.note).toBe('起点');
  });

  it('没有 mapNodes 时从「关键地点」兜底：清洗名字并按顺序连成一条线', () => {
    const nodes = mapNodesOf({
      title: '',
      premise: '',
      opening: '',
      truth: '',
      npcs: [],
      locations: '1. 码头\n- 灯塔\n\n旧仓库',
      clueChain: '',
      acts: '',
      endings: '',
      notes: '',
    });
    // 列表符号与括号里的细节都要清掉，节点名要干净
    expect(nodes.map((n) => n.name)).toEqual(['码头', '灯塔', '旧仓库']);
    /*
     * 兜底**必须**给出可达关系：早期这里没有 links，
     * 结果地图迷雾因为"没有关系图"被整块关掉，开局就把所有地点摊给玩家。
     * 现在按地点书写顺序连成一条线，走一步亮一片。
     */
    expect(nodes[0]!.links).toEqual(['灯塔']);
    expect(nodes[1]!.links).toEqual(['码头', '旧仓库']);
    expect(nodes[2]!.links).toEqual(['灯塔']);
  });

  it('mapNodes 存在但一个 links 都没给时，同样按顺序补上连线', () => {
    const nodes = mapNodesOf({
      title: '',
      premise: '',
      opening: '',
      truth: '',
      npcs: [],
      locations: '',
      mapNodes: [{ name: '甲' }, { name: '乙' }, { name: '丙' }],
      clueChain: '',
      acts: '',
      endings: '',
      notes: '',
    });
    expect(nodes.map((n) => n.links)).toEqual([['乙'], ['甲', '丙'], ['乙']]);
  });

  it('地点名里的括号细节与列表符号会被清掉', () => {
    const nodes = mapNodesOf({
      title: '',
      premise: '',
      opening: '',
      truth: '',
      npcs: [],
      locations: '霍尔特的侦探事务所（接待室 / 盥洗室）\n2、码头区',
      clueChain: '',
      acts: '',
      endings: '',
      notes: '',
    });
    expect(nodes.map((n) => n.name)).toEqual(['霍尔特的侦探事务所', '码头区']);
  });
});

describe('示例角色', () => {
  it('经典克苏鲁与剑与魔法各有一份，且都带姓名与描述', () => {
    for (const id of ['coc', 'fantasy']) {
      const c = starterCharacterOf(id);
      // 🔴 真判据：不是"有值就行"，是**真的填了非空白的文字**（挡住 `" "` / 空串）
      expect(c?.name, `${id} 的示例角色没名字`).toMatch(/\S/);
      expect(c?.description, `${id} 的示例角色没描述`).toMatch(/\S/);
    }
  });

  it('没有示例角色的题材返回 undefined（界面不显示按钮）', () => {
    expect(starterCharacterOf('not-a-genre')).toBeUndefined();
  });
});

/*
 * 用户 2026-09-17 报「属性技能与人设不匹配」。
 *
 * 病灶：套用示例角色时技能一律取 `rs.starterSkills`（规则包通用 8 项），
 * 于是流浪剑客的技能表里是「侦查 / 图书馆使用 / 聆听」—— 人设直接塌掉。
 * 修法：技能跟着**人设**走，只把名字适配到当前规则包的词汇表上。
 */
describe('示例角色的技能要跟人设对得上', () => {
  it('奇幻剑客拿到的是打斗与野外那一套，不是调查员的技能', () => {
    const skills = starterSkillsFor('fantasy', 'coc7');
    // 人设是"前王国斥候 / 流浪剑客" → 必须有战斗与潜行
    expect(skills).toHaveProperty('格斗（斗殴）');
    expect(skills).toHaveProperty('潜行');
    expect(skills).toHaveProperty('追踪');
    // 但不该有"图书馆使用"这种调查员专属技能
    expect(skills).not.toHaveProperty('图书馆使用');
  });

  it('私家侦探拿到的是查案那一套', () => {
    const skills = starterSkillsFor('coc', 'coc7');
    expect(skills).toHaveProperty('侦查');
    expect(skills).toHaveProperty('心理学');
    expect(skills).toHaveProperty('图书馆使用');
  });

  it('技能名必须是当前规则包技能表上的（不然掷不出来）', () => {
    const rs = getRuleset('coc7');
    const known = new Set(rs.skillCatalog.map((s) => s.name));
    for (const genre of ['coc', 'tokyo', 'acg', 'urban', 'fantasy']) {
      const skills = starterSkillsFor(genre, 'coc7');
      for (const name of Object.keys(skills)) {
        expect(known.has(name), `${genre} 的技能「${name}」不在 COC 技能表上`).toBe(true);
      }
    }
  });

  it('题材没有对应配方时退回规则包通用起始项（宁可不合身，不能坏掉）', () => {
    const skills = starterSkillsFor('not-a-genre', 'coc7');
    const rs = getRuleset('coc7');
    for (const s of rs.starterSkills ?? []) {
      expect(skills[s.name]).toBe(s.value);
    }
  });

  it('没配 DnD 那一套的题材，退回 DnD 规则包的通用项', () => {
    const skills = starterSkillsFor('coc', 'dnd5e');
    const rs = getRuleset('dnd5e');
    for (const s of rs.starterSkills ?? []) {
      expect(skills[s.name]).toBe(s.value);
    }
  });

  it('奇幻配 DnD 时给的是加值那一套，且不带 COC 百分比名', () => {
    const skills = starterSkillsFor('fantasy', 'dnd5e');
    expect(skills).toHaveProperty('运动');
    expect(skills).toHaveProperty('隐匿');
    // COC 的括号式技能名不属于 DnD 词汇表，一个都不许出现
    expect(Object.keys(skills).some((k) => k.includes('（'))).toBe(false);
    // DnD 是加值不是百分比：都在个位数
    expect(Math.max(...Object.values(skills))).toBeLessThan(10);
  });

  it('COC 的数值是百分比尺度（几十），不是 DnD 的个位数', () => {
    const skills = starterSkillsFor('fantasy', 'coc7');
    expect(Math.max(...Object.values(skills))).toBeGreaterThanOrEqual(50);
  });
});

describe('游玩预设（导入文本 → 整套预设）', () => {
  it('应用预设后：题材、模组、地图、世界书、队友候选都换好了', () => {
    applyPreset({
      name: '赛博侦探',
      genre: {
        name: '赛博朋克',
        blurb: '霓虹与义体',
        setting: '近未来的巨型都市',
        tone: '冷硬、潮湿、信息过载',
        imageStyle: '霓虹赛博风',
        castHint: '黑客、义体佣兵、企业密探',
      },
      module: {
        title: '霓虹之下',
        premise: '一名义体医生失踪了。',
        opening: '雨落在霓虹广告牌上。',
        start_location: '下城区',
        goal: '找到失踪的义体医生',
        stakes: '再拖下去，她的义体记忆会被覆盖。',
        urgency: '今晚就是数据清理的窗口。',
        truth: '她被自己的雇主灭口了。',
        npcs: [{ name: '委托人', role: '诊所前台', motive: '找人', secret: '她收了封口费' }],
        locations: '下城区\n企业塔',
        map_nodes: [
          { name: '下城区', links: ['企业塔'], note: '霓虹最密的地方' },
          { name: '企业塔', links: ['下城区'] },
        ],
        clueChain: 'A → B',
        acts: '三幕',
        endings: '三种',
        notes: '霓虹',
        source_note: 'AI 自创',
      },
      worldbook: [{ keys: ['义体'], content: '义体是植入人体的机械部件。', priority: 70 }],
      companions: [
        {
          name: '凛',
          role: '黑客',
          bond: '旧识',
          personality: '嘴上不饶人',
          secret: '她欠着企业一笔债',
          agenda: '想借你脱身',
          initiative: 'balanced',
          skills: { 调查: 60 },
          vitals: { hp: 11, san: 55, mp: 12 },
        },
      ],
      ruleset: null,
    });

    const s = store.getState();
    expect(s.genreId).toBe('genre-赛博朋克');
    expect(s.customGenres.some((g) => g.name === '赛博朋克')).toBe(true);

    expect(s.module.title).toBe('霓虹之下');
    expect(s.module.startLocation).toBe('下城区');
    expect(s.module.mapNodes).toHaveLength(2);
    expect(s.module.npcs).toHaveLength(1);

    expect(s.worldbook.some((e) => e.content.includes('机械部件'))).toBe(true);
    expect(s.companionCandidates.some((c) => c.name === '凛')).toBe(true);
    // 未登场不可入队——沿用原有的入队门槛
    expect(s.companionCandidates.find((c) => c.name === '凛')!.met).toBe(false);
  });
});

describe('占位符 {{称呼}} 不能漏到状态里', () => {
  // 注意：mergeCharacter 在 beforeAll 里才赋值，所以这里必须懒取，不能在 describe 本体里调
  const mkChar = () => mergeCharacter(JSON.stringify({ name: '艾伦·霍尔特', gender: '男' }));

  it('按称呼 / 姓名替换', () => {
    const c = mkChar();
    expect(fillPlayerTokens('{{称呼}}的公寓房间', c)).toBe('霍尔特先生的公寓房间');
    expect(fillPlayerTokens('{{name}} 走进门', c)).toBe('艾伦·霍尔特 走进门');
    expect(fillPlayerTokens('没有占位符', c)).toBe('没有占位符');
  });

  it('状态里的地点 / 线索 / 物品名 / 标记键都会被清洗', () => {
    const c = mkChar();
    const s = sanitizeStateTokens(
      createInitialState({
        location: '{{称呼}}的公寓房间',
        clues: ['{{称呼}}留下的字条'],
        npcsAlive: ['{{称呼}}的房东'],
        inventory: [{ id: 'x', name: '{{称呼}}的表', qty: 1, desc: '{{name}}的遗物' }],
        flags: { '{{称呼}}已到场': true },
      }),
      c
    );
    expect(s.location).toBe('霍尔特先生的公寓房间');
    expect(s.clues).toEqual(['霍尔特先生留下的字条']);
    expect(s.npcsAlive).toEqual(['霍尔特先生的房东']);
    expect(s.inventory[0]!.name).toBe('霍尔特先生的表');
    expect(s.inventory[0]!.desc).toBe('艾伦·霍尔特的遗物');
    expect(Object.keys(s.flags)).toEqual(['霍尔特先生已到场']);
  });

  it('没有占位符时原样返回同一个对象（不做无谓重建）', () => {
    const s = createInitialState({ location: '旧城区' });
    expect(sanitizeStateTokens(s, mkChar())).toBe(s);
  });

  it('模组里除开场白之外的字段也清洗（开场白要留占位符给渲染时替换）', () => {
    const c = mkChar();
    const m = sanitizeModuleTokens(
      {
        title: 't',
        premise: '',
        opening: '{{称呼}}，故事从这里开始。',
        truth: '',
        npcs: [{ id: '1', name: '{{称呼}}的老友', role: '旧识', motive: '', secret: '' }],
        locations: '{{称呼}}的公寓',
        startLocation: '{{称呼}}的公寓',
        mapNodes: [{ name: '{{称呼}}的公寓', links: [], note: '' }],
        clueChain: '',
        acts: '',
        endings: '',
        notes: '',
      },
      c
    );
    expect(m.startLocation).toBe('霍尔特先生的公寓');
    expect(m.locations).toBe('霍尔特先生的公寓');
    expect(m.npcs[0]!.name).toBe('霍尔特先生的老友');
    expect(m.mapNodes![0]!.name).toBe('霍尔特先生的公寓');
    // 开场白保留占位符（由 openingText 在渲染时替换）
    expect(m.opening).toContain('{{称呼}}');
  });
});

describe('开新团要清干净上一局的东西', () => {
  it('清空队友与队友候选，避免老杰克／米拉陈一直跟着', () => {
    store.setState({
      gameState: {
        ...store.getState().gameState,
        companions: [
          {
            id: 'jack',
            name: '老杰克·霍洛威',
            role: '',
            personality: '',
            skills: {},
            vitals: { hp: 10, san: 50, mp: 10 },
            initiative: 'reactive',
            alive: true,
            present: true,
          },
        ],
      },
    });
    store.getState().setCompanionCandidates([
      {
        id: 'cand-x',
        name: '米拉·陈',
        role: '',
        personality: '',
        skills: {},
        vitals: { hp: 10, san: 50, mp: 10 },
        initiative: 'reactive',
        alive: true,
        present: true,
        met: true,
      },
    ]);

    store.getState().startNewGame();

    // 已入队的队友清掉（否则老杰克会跟着进新团）
    expect(store.getState().gameState.companions).toEqual([]);
    /*
     * 但**队友候选要保留**（协作方 N2）：开新团时模组没换，
     * 候选是随当前模组生成的，一清准备页的「同行者」就空了。
     */
    expect(store.getState().companionCandidates.map((c) => c.name)).toEqual(['米拉·陈']);
  });
});

describe('未受训技能按规则包基础值掷（协作方 G）', () => {
  const rs = getRuleset('coc7');
  const mk = () => mergeCharacter(JSON.stringify({ name: '甲' }));

  it('角色卡里没有的技能，落到规则包的基础值而不是 50', () => {
    const c = mk();
    expect(c.skills['游泳']).toBeUndefined();
    // COC 游泳基础值 20%（早期会兜底成 50）
    expect(resolveCheckTarget('游泳', c, rs)).toBe(20);
  });

  it('别名能对上规范技能名（手枪 → 射击（手枪））', () => {
    const picked = rs.skillCatalog.find((s) => s.name === '射击（手枪）')!;
    expect(canonicalSkillName('手枪', rs)).toBe('射击（手枪）');
    expect(canonicalSkillName('图书馆学', rs)).toBe('图书馆使用');
    // 卡上存的是规范名 → 用别名去问也能问到卡上的值
    expect(resolveCheckTarget('手枪', mk(), rs)).toBe(40);
    // 卡上完全没有这项 → 落到规则包基础值
    const bare = { ...mk(), skills: {} };
    expect(resolveCheckTarget('手枪', bare, rs)).toBe(picked.base);
    expect(resolveCheckTarget('游泳', bare, rs)).toBe(20);
  });

  it('角色卡里已有的技能仍以卡上数值为准', () => {
    const c = { ...mk(), skills: { 侦查: 73 } };
    expect(resolveCheckTarget('侦查', c, rs)).toBe(73);
  });

  it('属性检定不受影响', () => {
    const c = mk();
    expect(resolveCheckTarget('力量', c, rs)).toBe(c.characteristics.str);
    expect(resolveCheckTarget('str', c, rs)).toBe(c.characteristics.str);
  });

  it('技能点预算也认别名（否则会把基础值当成投入点数）', () => {
    const c = { ...mk(), skills: { '射击（手枪）': 40 } };
    const withCanon = skillBudget(c, 'coc7');
    const withAlias = skillBudget({ ...c, skills: { 手枪: 40 } }, 'coc7');
    expect(withAlias.spent).toBe(withCanon.spent);
  });
});

describe('回溯要恢复待掷检定队列（协作方 F）', () => {
  it('快照能存队列，回溯时按快照恢复而不是一律清空', () => {
    const id = store.getState().addMessage({ role: 'player', content: '我同时看和听' });
    store.getState().snapshotTurn(id);
    store.getState().setSnapshotPendingChecks(id, [{ skill: '侦查' }, { skill: '聆听' }]);
    expect(store.getState().snapshots[id]!.pendingChecks).toHaveLength(2);

    // 掷掉一个
    store.getState().setPendingChecks([{ skill: '聆听' }]);
    expect(store.getState().pendingChecks).toHaveLength(1);

    // 回溯 → 两个都回来了
    store.getState().rewindBefore(id);
    expect(store.getState().pendingChecks.map((c) => c.skill)).toEqual(['侦查', '聆听']);
  });
});

describe('生命归零 → 结档信号（App 的"结档唯一出口"依赖这个契约）', () => {
  const base = () =>
    createInitialState({
      vitals: { hp: 1, san: 60, mp: 10 },
      vitalsMax: { hp: 10, san: 99, mp: 10 },
    });

  // `G25`：属性变更要有检定授权，这些用例只关心归零之后的下游
  beforeEach(() => grantHarmCheck());

  it('🔴 `G27`：打光剩余的那一下**当场结档**（不再挂一轮濒死等人来救）', () => {
    store.setState({ gameState: base() });
    store.getState().applyModelDeltas([{ target: 'vitals.hp', op: 'set', value: 0 }] as never);
    const gs = store.getState().gameState;
    expect(gs.vitals.hp).toBe(0);
    // 主人原话：「该死的时候能死，守密人不要硬找理由拖着不让死」
    expect(gs.ending?.kind).toBe('death');
    expect(gs.dying).toBe(false);
  });

  it('致命一击给出的 ending **正文留空**（等守密人写结局），`at` 能被解析', () => {
    store.setState({ gameState: base() });
    store.getState().applyModelDeltas([{ target: 'vitals.hp', op: 'set', value: 0 }] as never);
    const gs = store.getState().gameState;
    expect(gs.ending?.text).toBe('');
    // 🔴 真判据：结档时间必须是个**能被解析的时间戳**（生涯页要按它排序）
    expect(Number.isFinite(Date.parse(gs.ending?.at ?? ''))).toBe(true);
  });

  it('理智归零直接结档（不给缓冲）', () => {
    store.setState({ gameState: base() });
    store.getState().applyModelDeltas([{ target: 'vitals.san', op: 'set', value: 0 }] as never);
    expect(store.getState().gameState.ending?.kind).toBe('insanity');
  });

  it('回血能解除濒死（濒死态显式构造 —— 那是引擎给施救留的窗口）', () => {
    store.setState({ gameState: { ...base(), dying: true, vitals: { hp: 0, san: 60, mp: 10 } } });
    store.getState().applyModelDeltas([{ target: 'vitals.hp', op: 'set', value: 5 }] as never);
    expect(store.getState().gameState.dying).toBe(false);
    expect(store.getState().gameState.ending).toBeNull();
  });
});

describe('伤口 / 流血（引擎侧 DOT）：用户"包扎了还掉血、10 滴血太刺激"', () => {
  // `G25`：属性变更要有检定授权（这些用例关心的是伤口与失血）
  beforeEach(() => grantHarmCheck());

  const base = (hp = 8, extra: Record<string, unknown> = {}) =>
    createInitialState({
      vitals: { hp, san: 60, mp: 10 },
      vitalsMax: { hp: 10, san: 99, mp: 10 },
      inventory: [],
      ...extra,
    });

  it('主生命条一次掉 2 点以上 → 记一处伤口，并进状态栏 flags', () => {
    store.setState({ gameState: base() });
    actThen([
      { target: 'vitals.hp', op: 'dec', amount: 3, reason: '被咬中小臂' },
    ] as never);
    const gs = store.getState().gameState;
    expect(gs.wounds).toHaveLength(1);
    expect(gs.wounds![0]!.tier).toBe('wound');
    expect(gs.wounds![0]!.text).toContain('被咬中小臂');
    // 状态栏是动态渲染中文 flags 的 —— 伤口必须出现在里面，否则玩家看不见
    expect(String(gs.flags['伤口'])).toContain('每轮 -1');
  });

  it('掉 1 点不算伤口（小磕碰不该变成持续掉血）', () => {
    store.setState({ gameState: base() });
    actThen([
      { target: 'vitals.hp', op: 'dec', amount: 1, reason: '擦了一下' },
    ] as never);
    expect(store.getState().gameState.wounds).toHaveLength(0);
    expect(store.getState().gameState.flags['伤口']).toBeUndefined();
  });

  it('一次掉 4 点以上 → 重伤档（每轮 -2）', () => {
    store.setState({ gameState: base(10) });
    actThen([
      { target: 'vitals.hp', op: 'dec', amount: 5, reason: '斧头劈进肩膀' },
    ] as never);
    expect(store.getState().gameState.wounds![0]!.tier).toBe('severe');
    expect(String(store.getState().gameState.flags['伤口'])).toContain('每轮 -2');
  });

  it('有伤口后**每一轮**自动失血，且额度固定不变', () => {
    store.setState({ gameState: base(8) });
    // 第一轮：造成伤口 —— 当轮**不再**补失血（那几点已经付过账了）
    actThen([
      { target: 'vitals.hp', op: 'dec', amount: 3, reason: '被划中' },
    ] as never);
    expect(store.getState().gameState.vitals.hp).toBe(5);
    // 第二轮：什么都不做，也该因伤口掉 1 点
    actThen([] as never);
    expect(store.getState().gameState.vitals.hp).toBe(4);
    // 第三轮：还是 1 点（不加速）
    actThen([] as never);
    expect(store.getState().gameState.vitals.hp).toBe(3);
  });

  it('失血会写进"状态变化"提示（玩家看得见"为什么又掉血了"）', () => {
    store.setState({ gameState: base(8) });
    actThen([
      { target: 'vitals.hp', op: 'dec', amount: 3, reason: '被划中' },
    ] as never);
    store.setState({ lastChanges: null });
    actThen([] as never);
    const lines = store.getState().lastChanges?.lines ?? [];
    // 数值条的变化本来就有一条；这里确认"伤口失血"这句也进去了
    expect(lines.length).toBeGreaterThan(0);
    expect(lines.some((l) => l.text.includes('生命') || l.text.includes('伤口'))).toBe(true);
  });

  it('已经濒死就不再因伤口失血（倒地的人不该被继续放血）', () => {
    /*
     * ⚠️ `G27` 之后，"被划中"这类**模型申报的一击**打光剩余血是**当场结档**了，
     * 不再落到濒死态。所以这条用例显式构造濒死（那是引擎自己的账 —— 如伤口渗血 ——
     * 把血磨到 0 时的状态），再验"倒地之后不该被继续放血"这个真正的判据。
     */
    store.setState({ gameState: { ...base(), dying: true, vitals: { hp: 0, san: 60, mp: 10 } } });
    const after = store.getState().gameState;
    expect(after.dying).toBe(true);
    // 就算硬塞一处伤口，也不该再往下扣
    store.setState({
      gameState: { ...after, wounds: [{ id: 'x', text: '伤口', tier: 'wound', turns: 0 }] },
    });
    const before = store.getState().gameState.vitals.hp;
    actThen([] as never);
    expect(store.getState().gameState.vitals.hp).toBe(before);
  });

  it('守密人显式申报 flags.受伤 也会被记下来（旧伤 / 环境所致）', () => {
    store.setState({ gameState: base() });
    actThen([
      { target: 'flags.受伤', op: 'set', value: '左腿的旧伤裂开了' },
    ] as never);
    const gs = store.getState().gameState;
    expect(gs.wounds).toHaveLength(1);
    expect(gs.wounds![0]!.text).toContain('旧伤裂开');
    // 输入通道消费掉：下一轮不会又被当成一次新申报
    expect(gs.flags['受伤']).toBeUndefined();
  });

  it('引擎自己写的 flags.伤口 不会被读回来（否则伤口一轮接一轮自我复制）', () => {
    store.setState({ gameState: base(10) });
    actThen([
      { target: 'vitals.hp', op: 'dec', amount: 3, reason: '被划中' },
    ] as never);
    expect(store.getState().gameState.wounds).toHaveLength(1);
    // 连跑三轮空 delta：伤口数必须一直是 1
    for (let i = 0; i < 3; i++) actThen([] as never);
    expect(store.getState().gameState.wounds).toHaveLength(1);
  });

  it('两样都没有 → 包扎也止不住（用户报的原场景）', () => {
    store.setState({ gameState: base(), character: { ...store.getState().character, skills: {} } });
    actThen([
      { target: 'vitals.hp', op: 'dec', amount: 3, reason: '被划中' },
    ] as never);
    actThen([
      { target: 'flags.伤口处理', op: 'set', value: true },
    ] as never);
    expect(store.getState().gameState.wounds!.length).toBeGreaterThan(0);
    // 🔴 真判据：伤口 flag 写的是**一句话**（界面直接显示它），不是 `true`
    expect(store.getState().gameState.flags['伤口']).toBeTypeOf('string');
  });

  it('有医疗物品 + 有急救技能 → 处理到位就真正止住，flag 一并消失', () => {
    store.setState({
      gameState: base(8, { inventory: [{ id: '绷带', name: '绷带', qty: 2 }] }),
      character: { ...store.getState().character, skills: { 急救: 60 } },
    });
    actThen([
      { target: 'vitals.hp', op: 'dec', amount: 3, reason: '被划中' },
    ] as never);
    expect(store.getState().gameState.wounds).toHaveLength(1);
    actThen([
      { target: 'flags.伤口处理', op: 'set', value: true },
    ] as never);
    const gs = store.getState().gameState;
    expect(gs.wounds).toHaveLength(0);
    // 状态栏不能出现"伤好了但还写着流血"
    expect(gs.flags['伤口']).toBeUndefined();
  });

  it('只有一半依据 → 临时处理降一档，不能一次清零', () => {
    store.setState({
      gameState: base(10, { inventory: [{ id: '绷带', name: '绷带', qty: 2 }] }),
      character: { ...store.getState().character, skills: {} },
    });
    actThen([
      { target: 'vitals.hp', op: 'dec', amount: 5, reason: '斧头劈进肩膀' },
    ] as never);
    expect(store.getState().gameState.wounds![0]!.tier).toBe('severe');
    actThen([
      { target: 'flags.伤口处理', op: 'set', value: true },
    ] as never);
    const gs = store.getState().gameState;
    expect(gs.wounds!.length).toBe(1);
    expect(gs.wounds![0]!.tier).not.toBe('severe');
  });

  it('多轮下来伤口会累计轮数（供界面显示"流了多久"）', () => {
    store.setState({ gameState: base(9) });
    actThen([
      { target: 'vitals.hp', op: 'dec', amount: 3, reason: '被划中' },
    ] as never);
    // 出生那一轮不算流逝（它没流）
    expect(store.getState().gameState.wounds![0]!.turns).toBe(0);
    actThen([] as never);
    actThen([] as never);
    expect(store.getState().gameState.wounds![0]!.turns).toBe(2);
  });

  it('woundStatus() 的提示与引擎判据同源（不各算一遍）', () => {
    store.setState({ gameState: base(8, { inventory: [{ id: '绷带', name: '绷带', qty: 1 }] }) });
    expect(store.getState().woundStatus().note).toBeNull();
    actThen([
      { target: 'vitals.hp', op: 'dec', amount: 3, reason: '被划中' },
    ] as never);
    const st = store.getState().woundStatus();
    expect(st.wounds).toHaveLength(1);
    expect(st.relief).toBe('relief'); // 有物品、无技能
    expect(st.note).toContain('每轮固定 1 点');
  });
});

describe('临时疯狂：有界可恢复的数值惩罚（R37，用户 09-16 拍板）', () => {
  // `G25`：掉理智同样要先过检定（这些用例关心的是疯狂本身）
  beforeEach(() => grantHarmCheck());

  const base = () =>
    createInitialState({
      vitals: { hp: 10, san: 60, mp: 10 },
      vitalsMax: { hp: 10, san: 99, mp: 10 },
    });

  it('理智骤降 ≥5 → 进临时疯狂，并且**检定目标值真的被减了**', () => {
    store.setState({ gameState: base() });
    store.getState().applyModelDeltas([{ target: 'vitals.san', op: 'dec', amount: 6 }] as never);
    // 🔴 真判据：引擎写的是**一句描述**（界面显示的是它），不是布尔 `true`
    expect(store.getState().gameState.flags['临时疯狂']).toBeTypeOf('string');
    const ins = store.getState().insanity();
    expect(ins.active).toBe(true);
    expect(ins.penalty).toBe(-20); // 当前规则包是 COC（d100）
  });

  it('惩罚**有界**：连续发疯罚额不变', () => {
    store.setState({ gameState: base() });
    store.getState().applyModelDeltas([{ target: 'vitals.san', op: 'dec', amount: 6 }] as never);
    const first = store.getState().insanity().penalty;
    store.setState({
      gameState: {
        ...store.getState().gameState,
        vitals: { ...store.getState().gameState.vitals, san: 50 },
      },
    });
    store.getState().applyModelDeltas([{ target: 'vitals.san', op: 'dec', amount: 6 }] as never);
    expect(store.getState().insanity().penalty).toBe(first);
  });

  it('**可恢复**：走满窗口后自动解除，惩罚归零、标签消失', () => {
    store.setState({ gameState: base() });
    store.getState().applyModelDeltas([{ target: 'vitals.san', op: 'dec', amount: 6 }] as never);
    expect(store.getState().insanity().turns).toBeGreaterThan(0);
    // 空 delta 连续推进（模拟过轮）
    for (let i = 0; i < 5; i++) store.getState().applyModelDeltas([] as never);
    const ins = store.getState().insanity();
    expect(ins.active).toBe(false);
    expect(ins.penalty).toBe(0);
    expect(store.getState().gameState.flags['临时疯狂']).toBeUndefined();
    // 引擎内部记的轮数也要清掉，否则读档后会"复活"
    expect(store.getState().gameState.flags['疯狂轮数']).toBeUndefined();
  });

  it('守密人写 `flags.临时疯狂 = false` → 提前解除，**解除即消除**', () => {
    store.setState({ gameState: base() });
    store.getState().applyModelDeltas([{ target: 'vitals.san', op: 'dec', amount: 6 }] as never);
    expect(store.getState().insanity().active).toBe(true);
    store.getState().applyModelDeltas([{ target: 'flags.临时疯狂', op: 'set', value: false }] as never);
    const ins = store.getState().insanity();
    expect(ins.active).toBe(false);
    expect(ins.penalty).toBe(0);
  });

  it('临时疯狂真的进了"状态变化"提示（玩家看得见"为什么骰子难了"）', () => {
    store.setState({ gameState: base(), lastChanges: null });
    store.getState().applyModelDeltas([{ target: 'vitals.san', op: 'dec', amount: 6 }] as never);
    const lines = store.getState().lastChanges?.lines ?? [];
    expect(lines.some((l) => l.text.includes('临时疯狂'))).toBe(true);
  });

  it('永久疯狂（理智归零）不吃临时惩罚 —— 那一局已经结束了', () => {
    store.setState({ gameState: base() });
    store.getState().applyModelDeltas([{ target: 'vitals.san', op: 'set', value: 0 }] as never);
    expect(store.getState().gameState.ending?.kind).toBe('insanity');
  });

  it('insanity() 的提示与惩罚同源（不各算一遍）', () => {
    store.setState({ gameState: base() });
    expect(store.getState().insanity().note).toBeNull();
    store.getState().applyModelDeltas([{ target: 'vitals.san', op: 'dec', amount: 6 }] as never);
    const ins = store.getState().insanity();
    expect(ins.note).toContain('暂时的');
    expect(ins.note).not.toMatch(/-\d+/);
  });
});

describe('怪物图鉴与战斗投放（R38）', () => {
  const TABLE = [
    {
      id: 'm1',
      name: '雾中的巨影',
      look: '湿漉漉的一团',
      hp: 20,
      attack: '爪击 1d8',
      behavior: '受伤后退进雾里',
      weakness: '怕火',
    },
    {
      id: 'm2',
      name: '舱里的东西',
      look: '看不出形状',
      hp: 12,
      attack: '撞击 1d6',
      behavior: '只在暗处动',
      weakness: '强光',
    },
  ];

  const base = () =>
    createInitialState({
      vitals: { hp: 10, san: 60, mp: 10 },
      vitalsMax: { hp: 10, san: 99, mp: 10 },
    });

  /** 装上敌对者表（模组字段），并回到干净状态 */
  const withTable = () => {
    store.setState({
      gameState: base(),
      module: { ...store.getState().module, monsters: TABLE },
    });
  };

  it('startCombatFrom 把表的数值落成 combat.foes（清单里的 castFromBestiary 真实存在了）', () => {
    withTable();
    const names = store.getState().startCombatFrom(TABLE, ['雾中的巨影']);
    expect(names).toEqual(['雾中的巨影']);
    const gs = store.getState().gameState;
    expect(gs.combat.active).toBe(true);
    expect(gs.combat.round).toBe(1);
    expect(gs.combat.foes).toHaveLength(1);
    // 血量是**表里的数字**，不是模型临场写的
    expect(gs.combat.foes[0]!.hp).toBe(20);
    expect(gs.combat.foes[0]!.max).toBe(20);
  });

  it('不点名就投放表里全部', () => {
    withTable();
    store.getState().startCombatFrom(TABLE);
    expect(store.getState().gameState.combat.foes).toHaveLength(2);
  });

  it('敌人一进 combat.foes 就记进 encountered（图鉴的"见过"）', () => {
    withTable();
    store.getState().startCombatFrom(TABLE, ['雾中的巨影']);
    expect(store.getState().gameState.encountered).toContain('雾中的巨影');
    // 只是见过，还没交手 —— fought 不该有它
    expect(store.getState().gameState.fought ?? []).not.toContain('雾中的巨影');
  });

  it('只见过时：图鉴给外观与攻击，**不给弱点**（G5：弱点是活路）', () => {
    withTable();
    store.getState().startCombatFrom(TABLE, ['雾中的巨影']);
    const b = store.getState().bestiary();
    const card = b.cards.find((c) => c.name === '雾中的巨影')!;
    expect(card.level).toBe('seen');
    // 🔴 真判据：给的是**表里那句原话**（'湿漉漉的一团'），不是"有东西就行"
    expect(card.look).toBe(TABLE[0]!.look);
    expect(card.weakness).toBeUndefined();
  });

  it('打中它（dec 掉血）→ 记进 fought，弱点才解锁', () => {
    withTable();
    store.getState().startCombatFrom(TABLE, ['雾中的巨影']);
    store.getState().applyModelDeltas([
      { target: 'combat.foes', op: 'dec', value: '雾中的巨影', amount: 3 },
    ] as never);
    expect(store.getState().gameState.fought).toContain('雾中的巨影');
    const card = store.getState().bestiary().cards.find((c) => c.name === '雾中的巨影')!;
    expect(card.level).toBe('fought');
    expect(card.weakness).toBe('怕火');
  });

  it('只是给它回血（inc）不算交手 —— 弱点不该白给', () => {
    withTable();
    store.getState().startCombatFrom(TABLE, ['雾中的巨影']);
    store.getState().applyModelDeltas([
      { target: 'combat.foes', op: 'inc', value: '雾中的巨影', amount: 3 },
    ] as never);
    expect(store.getState().gameState.fought ?? []).not.toContain('雾中的巨影');
  });

  it('敌人从战斗里移除（多半是死了）也算交手过', () => {
    withTable();
    store.getState().startCombatFrom(TABLE, ['雾中的巨影']);
    store.getState().applyModelDeltas([
      { target: 'combat.foes', op: 'remove', value: '雾中的巨影' },
    ] as never);
    expect(store.getState().gameState.fought).toContain('雾中的巨影');
  });

  it('图鉴**锁着**直到这一局结档（防开局剧透）', () => {
    withTable();
    store.getState().startCombatFrom(TABLE, ['雾中的巨影']);
    expect(store.getState().bestiary().unlocked).toBe(false);
    // 引擎先写空正文的 ending 当信号，这时还不该解锁
    store.getState().forceEnding('death');
    expect(store.getState().bestiary().unlocked).toBe(false);
    // 结局正文写好了 → 解锁
    store.getState().setEnding('death', '意识一层层退下去。');
    expect(store.getState().bestiary().unlocked).toBe(true);
  });

  it('结档后图鉴把"见过/交过手/未遭遇"三档一起摆出来', () => {
    withTable();
    store.getState().startCombatFrom(TABLE, ['雾中的巨影']);
    store.getState().applyModelDeltas([
      { target: 'combat.foes', op: 'dec', value: '雾中的巨影', amount: 3 },
    ] as never);
    store.getState().forceEnding('death');
    store.getState().setEnding('death', '结束了。');
    const b = store.getState().bestiary();
    expect(b.total).toBe(2);
    expect(b.seen).toBe(1);
    expect(b.fought).toBe(1);
    // 交过手的排最前，没遭遇的沉底
    expect(b.cards[0]!.name).toBe('雾中的巨影');
    expect(b.cards[1]!.level).toBe('none');
  });

  it('模型想手写 encountered / fought 一律被拒（这两张表只归引擎）', () => {
    withTable();
    // 两种操作都得拒：add 也不行——模型会用它把"听说过的东西"塞进来
    store.getState().applyModelDeltas([
      { target: 'encountered', op: 'add', value: '它听说过的东西' },
      { target: 'fought', op: 'add', value: '它自称打过的' },
      { target: 'encountered', op: 'remove', value: '雾中的巨影' },
    ] as never);
    const gs = store.getState().gameState;
    expect(gs.encountered ?? []).not.toContain('它听说过的东西');
    expect(gs.fought ?? []).not.toContain('它自称打过的');
    expect(gs.encountered ?? []).toEqual([]);
    // 不要求玩家界面上有提示：引擎静默拒绝即可（这类越权写法不该变成界面噪音）
  });

  it('引擎自己写这两张表照样生效（白名单只管模型）', () => {
    withTable();
    store.getState().startCombatFrom(TABLE, ['雾中的巨影']);
    expect(store.getState().gameState.encountered).toContain('雾中的巨影');
  });

  it('模组没设敌对者表 → 图鉴不占位（total 0）', () => {
    store.setState({
      gameState: base(),
      module: { ...store.getState().module, monsters: [] },
    });
    expect(store.getState().bestiary().total).toBe(0);
  });
});

describe('引擎强制结档（协作方 C/D：求死不走模型）', () => {
  it('forceEnding 直接落结档，且正文留空等结局', () => {
    store.setState({ gameState: createInitialState({ vitals: { hp: 12, san: 60, mp: 10 } }) });
    store.getState().forceEnding('death');
    const gs = store.getState().gameState;
    expect(gs.ending?.kind).toBe('death');
    expect(gs.ending?.text).toBe('');
    expect(gs.dying).toBe(false);
  });

  /*
   * 守密人声明收束（契约里的 ending）。
   * 用户 2026-09-16 实测："我是坐逃生艇下的船，没触发任何结局"——
   * 模组写好了三条 endings，但引擎里没有任何路径能让"达成目标"结束一局。
   */
  it('可以带上"为什么收束"的理由，供结档页展示', () => {
    store.setState({ gameState: createInitialState({ vitals: { hp: 12, san: 60, mp: 10 } }) });
    store.getState().forceEnding('success', '你上了救生艇，驶离了货船');
    const gs = store.getState().gameState;
    expect(gs.ending?.kind).toBe('success');
    expect(gs.ending?.reason).toBe('你上了救生艇，驶离了货船');
    expect(gs.ending?.text).toBe(''); // 正文仍留空 = 等守密人写
  });

  it('之后写结局正文时不会把理由弄丢', () => {
    store.setState({ gameState: createInitialState({ vitals: { hp: 12, san: 60, mp: 10 } }) });
    store.getState().forceEnding('grey', '你逃出来了，但货沉了');
    store.getState().setEnding('grey', '你在救生艇上回头看了一眼，海面上什么都没有了。');
    const gs = store.getState().gameState;
    expect(gs.ending?.reason).toBe('你逃出来了，但货沉了');
    expect(gs.ending?.text).toContain('救生艇');
  });
});

describe('描述加权要进引擎，不能只是界面花招', () => {
  it('skillCheck 的 bonus 会加进目标值（掷骰之前，判定与标签才一致）', () => {
    store.setState({
      character: { ...store.getState().character, skills: { 侦查: 50 } },
    });
    const plain = store.getState().skillCheck('侦查', 'regular', 0);
    const boosted = store.getState().skillCheck('侦查', 'regular', 15);
    expect(plain.target).toBe(50);
    expect(boosted.target).toBe(65);
    expect(boosted.bonus).toBe(15);
  });

  it('未受训技能也能被加权（游泳基础值 20% → +15 = 35%）', () => {
    store.setState({ character: { ...store.getState().character, skills: {} } });
    expect(store.getState().skillCheck('游泳', 'regular', 15).target).toBe(35);
  });
});

describe('检定目标值文案随规则包变化', () => {
  it('d100 显示成功率百分比，d20 显示加值', () => {
    expect(checkTargetText({ target: 65, mainDice: '1d100' })).toBe('目标值 65%');
    expect(checkTargetText({ target: 2, mainDice: '1d20' })).toBe('加值 +2');
    expect(checkTargetText({ target: -1, mainDice: '1d20' })).toBe('加值 -1');
  });

  it('老存档的检定记录没有 mainDice 时按百分比兜底', () => {
    expect(checkTargetText({ target: 40 })).toBe('目标值 40%');
  });
});

describe('待掷检定队列（一轮里多个请求都不能丢）', () => {
  it('可以一次挂多条，逐条移除，也能整体清空', () => {
    store.getState().setPendingChecks([
      { skill: '潜行' },
      { skill: '聆听', difficulty: 'hard', reason: '雾里听不清' },
    ]);
    expect(store.getState().pendingChecks).toHaveLength(2);
    expect(store.getState().pendingChecks[1]!.reason).toBe('雾里听不清');

    store.getState().removePendingCheck(0);
    expect(store.getState().pendingChecks.map((c) => c.skill)).toEqual(['聆听']);

    store.getState().clearPendingChecks();
    expect(store.getState().pendingChecks).toEqual([]);
  });
});

describe('编年史回合号', () => {
  it('折叠掉早期条目后，新条目的编号接在最大号后面而不是 length+1', () => {
    store.setState({ chronicle: [] });
    for (let i = 1; i <= 5; i++) store.getState().addChronicle(`第 ${i} 件事`);
    expect(store.getState().chronicle.map((c) => c.turn)).toEqual([1, 2, 3, 4, 5]);

    // 模拟 foldChronicle：只留最近两条（编号 4、5）
    store.getState().foldChronicle(3, '前情提要');
    expect(store.getState().chronicle.map((c) => c.turn)).toEqual([4, 5]);

    store.getState().addChronicle('折叠之后的新事件');
    // 早期实现用 length+1，这里会得到 3 —— 比现有条目还小，日志在提示词里就乱序了
    expect(store.getState().chronicle.map((c) => c.turn)).toEqual([4, 5, 6]);
  });
});

describe('存档迁移（旧档必须能读）', () => {
  it('补齐后加的 visited / threads / combat，并标上当前版本号', () => {
    const data = migrateSave({
      version: 1,
      character: {
        name: '旧人',
        description: '',
        personality: '',
        mes_example: '',
        characteristics: {},
        skills: {},
      },
      gameState: {
        vitals: { hp: 5 },
        companions: [],
        inventory: [],
        flags: {},
        clues: [],
        location: '旧城区',
        npcsAlive: [],
      },
      messages: [],
    });
    expect(data.version).toBe(SAVE_VERSION);
    expect(data.gameState!.visited).toEqual(['旧城区']);
    expect(data.gameState!.threads).toEqual([]);
    expect(data.gameState!.combat).toEqual({ active: false, round: 0, foes: [] });
    // 缺键的数值条要按规则包补齐，不能留成界面上"显示 0"
    expect(Number.isFinite(data.gameState!.vitals.san)).toBe(true);
  });

  it('把乱序的编年史回合号修正成单调递增（避免 key 撞车与日志乱序）', () => {
    const data = migrateSave({
      chronicle: [
        { turn: 4, text: 'a' },
        { turn: 5, text: 'b' },
        { turn: 2, text: 'c' },
        { turn: 3, text: 'd' },
      ],
    });
    expect(data.chronicle!.map((c) => c.turn)).toEqual([4, 5, 6, 7]);
  });

  it('垃圾输入不抛异常（宁可空档也不能崩）', () => {
    expect(() => migrateSave(null)).not.toThrow();
    expect(() => migrateSave({ gameState: 'not-an-object' })).not.toThrow();
    expect(() => migrateSave(undefined)).not.toThrow();
    expect(migrateSave(null).version).toBe(SAVE_VERSION);
  });

  it('旧档没有 companionCandidates 时补空数组（不丢、也不炸）', () => {
    expect(migrateSave({ gameState: { vitals: {} } }).companionCandidates).toEqual([]);
  });

  it('旧档补出伤口与图鉴台账（两张表都是可选新增字段，不升 SAVE_VERSION）', () => {
    const data = migrateSave({ gameState: { vitals: { hp: 5 } } });
    expect(data.gameState!.wounds).toEqual([]);
    expect(data.gameState!.encountered).toEqual([]);
    expect(data.gameState!.fought).toEqual([]);
    // 判据：可选新增字段不升版本 —— 这三张表都不该把版本推高
    expect(data.version).toBe(SAVE_VERSION);
  });

  /*
   * P2-5 边界（协作方第 21 版）：第 5 轮真机看到「期限： · 还剩 21 天」。
   * 那不是"没修"—— label 回落只在**设新期限**时跑，读档这条路从来没走，
   * 于是旧档那个空 label 永远补不上。这里钉的是**读入之后** label 非空。
   * `remain` 必须原样保留（补 label 不该动倒计时）。
   */
  it('旧档 deadline 的 label 为空 → 读档时回落到模组 urgency（remain 不动）', () => {
    const data = migrateSave({
      module: { urgency: '雨季还有二十三天结束，之后谁都走不了' } as never,
      gameState: {
        vitals: { hp: 5 },
        deadline: { remain: 21 * 24 * 60, label: '' },
      },
    });
    expect(data.gameState!.deadline!.label).toBe('雨季还有二十三天结束，之后谁都走不了');
    expect(data.gameState!.deadline!.remain).toBe(21 * 24 * 60);
    // 可选字段补值不是结构变 —— 版本不许被推高
    expect(data.version).toBe(SAVE_VERSION);
  });

  it('模组里也推不出 urgency 时，label 至少给「期限」而不是空', () => {
    const data = migrateSave({
      module: {} as never,
      gameState: { vitals: { hp: 5 }, deadline: { remain: 60, label: '   ' } },
    });
    expect(data.gameState!.deadline!.label).toBe('期限');
  });

  it('已有的 label 不会被覆盖（只补不删）', () => {
    const data = migrateSave({
      module: { urgency: '雨季还有二十三天结束' } as never,
      gameState: { vitals: { hp: 5 }, deadline: { remain: 60, label: '我自己的期限' } },
    });
    expect(data.gameState!.deadline!.label).toBe('我自己的期限');
  });

  /*
   * P2-5·边界（协作方第 22 版**重开**）：v0.10.6 我把 label 回落只挂在 `migrateSave`
   * （导入存档那条腿），而玩家**正常刷新**走的是 `loadGameState` ——
   * 于是空 label 永远补不上。这两条钉的是"两条腿都得走"。
   */
  it('空 label 在**启动**这条腿上也要补上（loadGameState）', () => {
    const orig = globalThis.localStorage;
    const mem = new MemStorage();
    mem.setItem(
      'trpg.gameState',
      JSON.stringify({
        vitals: { hp: 8, san: 60, mp: 10 },
        deadline: { remain: 21 * 24 * 60, label: '' },
      })
    );
    mem.setItem('trpg.module', JSON.stringify({ urgency: '雨季还有二十三天结束' }));
    vi.stubGlobal('localStorage', mem);
    try {
      const gs = loadGameState();
      expect(gs.deadline!.label).toBe('雨季还有二十三天结束');
      // 倒计时本身一点都不许动 —— 补 label 不是重设期限
      expect(gs.deadline!.remain).toBe(21 * 24 * 60);
    } finally {
      vi.stubGlobal('localStorage', orig);
    }
  });

  it('已有 label 的档，启动时**不许**被覆盖（只补不删）', () => {
    const orig = globalThis.localStorage;
    const mem = new MemStorage();
    mem.setItem(
      'trpg.gameState',
      JSON.stringify({
        vitals: { hp: 8, san: 60, mp: 10 },
        deadline: { remain: 60, label: '我自己的期限' },
      })
    );
    mem.setItem('trpg.module', JSON.stringify({ urgency: '雨季还有二十三天结束' }));
    vi.stubGlobal('localStorage', mem);
    try {
      expect(loadGameState().deadline!.label).toBe('我自己的期限');
    } finally {
      vi.stubGlobal('localStorage', orig);
    }
  });

  it('H16：引擎写进去的轮数键，状态过滤必须认得出来（界面不许露"疯狂轮数：2"）', () => {
    // 引擎（store.ts）自己记的轮数是 `flags['疯狂轮数']`；过滤要认得这一族键
    expect(isTurnsKey('疯狂轮数')).toBe(true);
    expect(isTurnsKey(turnsKeyOf('中毒'))).toBe(true);
    // 端到端：带着记账键走一遍过滤，键要消失、状态本身要留下
    expect(statusFlagLines({ 临时疯狂: '他抓着自己的头发', 疯狂轮数: 2 }).map((l) => l.key)).toEqual(
      ['临时疯狂']
    );
  });

  it('已有的图鉴台账不会被迁移清掉（只补不删）', () => {
    const data = migrateSave({
      gameState: { vitals: { hp: 5 }, encountered: ['雾中的巨影'], fought: ['雾中的巨影'] },
    });
    expect(data.gameState!.encountered).toEqual(['雾中的巨影']);
    expect(data.gameState!.fought).toEqual(['雾中的巨影']);
  });
});

describe('战役数据必须整进整出（B3：消灭半持久化字段）', () => {
  const mkCompanion = (id: string, name: string) => ({
    id,
    name,
    role: 'r',
    personality: 'p',
    skills: {},
    vitals: { hp: 10, san: 50, mp: 10 },
    initiative: 'reactive' as const,
    alive: true,
    present: true,
    met: false,
  });

  it('导出 → 读档：世界书、队友候选、已入队同行者三者都保留', () => {
    const e1 = { id: 'wb-1', keys: ['甲'], content: '关于甲', priority: 50, enabled: true };
    store.setState({
      worldbook: [e1],
      companionCandidates: [mkCompanion('cand-1', '米拉')],
      gameState: {
        ...store.getState().gameState,
        companions: [mkCompanion('jack', '老杰克')],
      },
    });

    const save = store.getState().buildSave();
    expect(save.companionCandidates).toHaveLength(1);
    expect(save.worldbook).toHaveLength(1);
    expect(save.snapshots).toBeDefined();

    // 模拟"切到另一个空档"再读回来
    store.setState({
      worldbook: [],
      companionCandidates: [],
      gameState: { ...store.getState().gameState, companions: [] },
    });
    store.getState().loadSave(save);

    expect(store.getState().companionCandidates.map((c) => c.name)).toEqual(['米拉']);
    expect(store.getState().gameState.companions.map((c) => c.name)).toEqual(['老杰克']);
    expect(store.getState().worldbook.map((e) => e.content)).toContain('关于甲');
  });

  it('读档是世界书**并集**，不会因为读了一个条目更少的档就把现有条目删掉', () => {
    store.setState({
      worldbook: [{ id: 'a', keys: ['a'], content: '现有条目', priority: 50, enabled: true }],
    });
    store.getState().loadSave({
      worldbook: [{ id: 'b', keys: ['b'], content: '档案里的条目', priority: 50, enabled: true }],
      gameState: { vitals: {} },
      messages: [],
    });
    const contents = store.getState().worldbook.map((e) => e.content);
    expect(contents).toContain('现有条目');
    expect(contents).toContain('档案里的条目');
  });

  it('开新团不再删世界书（模组没换，配套条目就不该没）', () => {
    store.setState({
      worldbook: [
        { id: 'wb-mod', keys: ['x'], content: '模组生成', priority: 50, enabled: true, fromModule: true },
      ],
    });
    store.getState().startNewGame();
    expect(store.getState().worldbook.map((e) => e.content)).toContain('模组生成');
  });

  it('换模组（clearModuleDerived）才清 AI 生成条目与队友候选', () => {
    store.setState({
      worldbook: [
        { id: 'wb-ai', keys: ['x'], content: 'AI 生成', priority: 50, enabled: true, fromModule: true },
        { id: 'wb-mine', keys: ['y'], content: '我手写的', priority: 50, enabled: true },
      ],
    });
    store.getState().clearModuleDerived();
    const contents = store.getState().worldbook.map((e) => e.content);
    expect(contents).not.toContain('AI 生成');
    expect(contents).toContain('我手写的');
    expect(store.getState().companionCandidates).toEqual([]);
  });

  it('手动清理只删 AI 生成的世界书条目，不动手写的', () => {
    store.setState({
      worldbook: [
        { id: 'wb-ai2', keys: ['x'], content: 'AI 生成', priority: 50, enabled: true, fromModule: true },
        { id: 'wb-mine2', keys: ['y'], content: '我手写的', priority: 50, enabled: true },
      ],
    });
    store.getState().clearModuleWorldbook();
    expect(store.getState().worldbook.map((e) => e.content)).toEqual(['我手写的']);
  });
});

describe('结档：死亡 / 理智归零（用户定调：死亡 = 结档）', () => {
  // `G25`：属性变更要有检定授权
  beforeEach(() => grantHarmCheck());

  it('🔴 `G27`：足以打光剩余的一击 → 当场结档（正文留空 = 等守密人写结局）', () => {
    store.setState({ gameState: createInitialState({ vitals: { hp: 5, san: 60, mp: 10 } }) });
    store.getState().applyModelDeltas([{ target: 'vitals.hp', op: 'dec', amount: 5 }]);
    expect(store.getState().gameState.vitals.hp).toBe(0);
    const ending = store.getState().gameState.ending;
    expect(ending?.kind).toBe('death');
    // 正文留空 = "结论已定、等守密人写结局"的信号
    expect(ending?.text).toBe('');
  });

  it('理智归零直接结档（永久疯狂）', () => {
    store.setState({ gameState: createInitialState({ vitals: { hp: 10, san: 3, mp: 10 } }) });
    store.getState().applyModelDeltas([{ target: 'vitals.san', op: 'dec', amount: 3 }]);
    expect(store.getState().gameState.ending?.kind).toBe('insanity');
  });

  it('救回来会解除濒死，不结档', () => {
    // 濒死态显式构造（`G27` 之后模型的一击不会再落到这里，那是引擎的账磨出来的）
    store.setState({
      gameState: {
        ...createInitialState({ vitals: { hp: 0, san: 60, mp: 10 } }),
        dying: true,
      },
    });
    expect(store.getState().gameState.dying).toBe(true);
    store.getState().applyModelDeltas([{ target: 'vitals.hp', op: 'inc', amount: 3 }]);
    expect(store.getState().gameState.dying).toBe(false);
    expect(store.getState().gameState.ending ?? null).toBeNull();
  });

  it('结档后不会再被后续回合覆盖', () => {
    store.setState({ gameState: createInitialState({ vitals: { hp: 1, san: 60, mp: 10 } }) });
    store.getState().applyModelDeltas([{ target: 'vitals.hp', op: 'dec', amount: 1 }]);
    store.getState().applyModelDeltas([{ target: 'vitals.hp', op: 'dec', amount: 1 }]);
    const first = store.getState().gameState.ending;
    expect(first?.kind).toBe('death');
    store.getState().applyModelDeltas([{ target: 'vitals.san', op: 'dec', amount: 99 }]);
    expect(store.getState().gameState.ending?.kind).toBe('death');
  });

  it('开新团与回溯都会退掉结档', () => {
    // 先摆一个干净的起点，避免上一个用例留下的 ending 混进来
    store.setState({ gameState: createInitialState({ vitals: { hp: 10, san: 60, mp: 10 } }) });
    const id = store.getState().addMessage({ role: 'player', content: '我推开门' });
    store.getState().snapshotTurn(id);
    store.getState().setEnding('death', '故事在这里断了线。');
    expect(store.getState().gameState.ending?.text).toBe('故事在这里断了线。');

    store.getState().rewindBefore(id);
    expect(store.getState().gameState.ending ?? null).toBeNull();

    store.getState().setEnding('insanity', '他分不清了。');
    store.getState().startNewGame();
    expect(store.getState().gameState.ending ?? null).toBeNull();
  });
});

describe('关键抉择（回溯锚点）', () => {
  it('只有被标记的回合才算锚点，并带一句说明', () => {
    const id = store.getState().addMessage({ role: 'player', content: '我潜行过去' });
    store.getState().snapshotTurn(id);
    expect(store.getState().snapshots[id]!.key).toBeUndefined();

    store.getState().markSnapshotKey(id, '掷骰：潜行');
    expect(store.getState().snapshots[id]!.key).toBe(true);
    expect(store.getState().snapshots[id]!.label).toBe('掷骰：潜行');

    // 已经标过就不再覆盖（同一回合多个理由时以第一个为准）
    store.getState().markSnapshotKey(id, '受伤');
    expect(store.getState().snapshots[id]!.label).toBe('掷骰：潜行');
  });

  it('没有快照的回合不会被标上锚点', () => {
    store.getState().markSnapshotKey('不存在的消息 id', '掷骰：潜行');
    expect(store.getState().snapshots['不存在的消息 id']).toBeUndefined();
  });
});

/*
 * ============================================================
 * 协作方第 7 版的两处补丁（2.1 轮数 / 2.2 结痂）+ 第四节敌人数值兜底
 * 全部走 store 的真实通道验证，不是只测纯函数。
 * ============================================================
 */
describe('临时疯狂轮数：界面报的数要跟着引擎走（§2.1）', () => {
  it('引擎推进一轮后，insanity().turns 跟着减（不是永远 3）', () => {
    const gs = createInitialState({ vitals: { hp: 10, san: 60, mp: 10 } });
    store.setState({ gameState: { ...gs, flags: { 临时疯狂: '理智骤降 6 点，陷入临时疯狂', 疯狂轮数: 3 } } });
    expect(store.getState().insanity().turns).toBe(3);
    expect(store.getState().insanity().label).toContain('还剩 3 轮');

    // 走一轮结算 → 引擎把 疯狂轮数 减到 2
    store.getState().applyModelDeltas([] as never);
    const t2 = store.getState().gameState.flags?.['疯狂轮数'];
    expect(t2).toBe(2);
    expect(store.getState().insanity().turns).toBe(2);
  });
});

describe('结痂：轻伤自己收口，不再流到死（§2.2）', () => {
  const withWound = (tier: string) => {
    const gs = createInitialState({ vitals: { hp: 10, san: 60, mp: 10 } });
    store.setState({
      gameState: { ...gs, wounds: [{ id: 'w1', text: '手臂上的口子', tier, turns: 0 } as never] },
    });
  };

  it('擦伤第 3 轮自己结痂，伤口清空', () => {
    withWound('scratch');
    for (let i = 0; i < 3; i++) actThen([] as never);
    expect(store.getState().gameState.wounds ?? []).toHaveLength(0);
  });

  it('重伤第 6 轮仍在（要有人处理才止得住）', () => {
    withWound('severe');
    for (let i = 0; i < 6; i++) actThen([] as never);
    expect(store.getState().gameState.wounds ?? []).toHaveLength(1);
  });
});

/* ============================================================
 * 🔴 主人 2026-09-27 真机：「敌人血量与状态不符」。
 *
 * 病根在补值：守密人"记一笔血量"时只写 `hp`（他写的是"现在还剩多少"），
 * 而老代码用 `max: givenMax ?? hp` 把**上限补成了当前值** → 血条渲染成 `8/8` 满格，
 * 玩家刚打掉的伤害在界面上凭空消失。
 * 判据改成：上限优先取**表里的满血值**（作者填的、不随战斗漂），最后才退到当前 hp。
 * ============================================================ */
describe('敌人数值兜底，血量与状态必须对得上（主人 2026-09-27 真机）', () => {
  const TABLE = [{ id: 'm1', name: '雾中的巨影', hp: 20 }];
  const setup = () =>
    store.setState({
      gameState: createInitialState({ vitals: { hp: 10, san: 60, mp: 10 } }),
      module: { ...store.getState().module, monsters: TABLE },
    });
  const foes = () => store.getState().gameState.combat.foes;

  it('🔴 打掉血之后守密人只报当前血量 → 上限**不能**塌成当前值（8/20，不是 8/8）', () => {
    setup();
    store.getState().applyModelDeltas([
      { target: 'combat.foes', op: 'add', value: { name: '雾中的巨影' } },
    ] as never);
    expect(foes()[0]!.max).toBe(20);

    store.getState().applyModelDeltas([
      { target: 'combat.foes', op: 'dec', value: '雾中的巨影', amount: 12 },
    ] as never);
    expect(foes()[0]!.hp).toBe(8);

    // 下一轮，守密人"记一笔血量"，只写 hp
    store.getState().applyModelDeltas([
      { target: 'combat.foes', op: 'add', value: { name: '雾中的巨影', hp: 8 } },
    ] as never);
    expect(foes()[0]!.hp).toBe(8);
    expect(foes()[0]!.max).toBe(20); // ← 老代码这里是 8
    // 血条要的是"打掉了多少"，上限塌了就等于把伤害还回去了
    expect(foes()[0]!.hp / foes()[0]!.max).toBeCloseTo(0.4, 5);
  });

  it('模型给了上限就用它的（不抢）', () => {
    setup();
    store.getState().applyModelDeltas([
      { target: 'combat.foes', op: 'add', value: { name: '雾中的巨影', hp: 6, max: 30 } },
    ] as never);
    expect(foes()[0]!.hp).toBe(6);
    expect(foes()[0]!.max).toBe(30);
  });

  it('表里没有的敌人、只给 hp → 上限兜底成当前值，但绝不倒挂', () => {
    setup();
    store.getState().applyModelDeltas([
      { target: 'combat.foes', op: 'add', value: { name: '不知名的东西', hp: 5 } },
    ] as never);
    expect(foes()[0]!.hp).toBe(5);
    expect(foes()[0]!.max).toBe(5);
  });
});

describe('敌人数值兜底：模型即兴开打也吃敌对者表（§4）', () => {
  const TABLE = [{ id: 'm1', name: '雾中的巨影', hp: 20 }];

  it('模型没给血量 → 用表里的 20', () => {
    store.setState({
      gameState: createInitialState({ vitals: { hp: 10, san: 60, mp: 10 } }),
      module: { ...store.getState().module, monsters: TABLE },
    });
    store.getState().applyModelDeltas([
      { target: 'combat.foes', op: 'add', value: { name: '雾中的巨影' } },
    ] as never);
    const foe = store.getState().gameState.combat.foes[0]!;
    expect(foe.hp).toBe(20);
    expect(foe.max).toBe(20);
  });

  it('模型给了血量 → 以模型为准，不被表顶掉', () => {
    store.setState({
      gameState: createInitialState({ vitals: { hp: 10, san: 60, mp: 10 } }),
      module: { ...store.getState().module, monsters: TABLE },
    });
    store.getState().applyModelDeltas([
      { target: 'combat.foes', op: 'add', value: { name: '雾中的巨影', hp: 7, max: 7 } },
    ] as never);
    expect(store.getState().gameState.combat.foes[0]!.hp).toBe(7);
  });

  it('表里没有的东西 → 原样放行（不凭空造数值）', () => {
    store.setState({
      gameState: createInitialState({ vitals: { hp: 10, san: 60, mp: 10 } }),
      module: { ...store.getState().module, monsters: TABLE },
    });
    store.getState().applyModelDeltas([
      { target: 'combat.foes', op: 'add', value: { name: '临时冒出来的东西' } },
    ] as never);
    const foe = store.getState().gameState.combat.foes[0]!;
    expect(foe.name).toBe('临时冒出来的东西');
    expect(foe.hp).not.toBe(20);
  });
});

/*
 * ============================================================
 * 状态变化提示**必须一直有**（2026-09-17 主人当场纠正的回归）
 *
 * 曾经加过一个  开关：守密人声明"这件事我在正文里写过了"，
 * 引擎就不弹这条提示，理由是"同一件事说两遍出戏"。
 * 主人的原话是 ——「获得新物品的提示很朴素一个弹窗啊」。
 *
 * **"状态可见"属于框架，不属于特效。** 少一条提示不会让画面变干净，
 * 只会让玩家不知道东西到底进没进背包、血到底掉没掉。
 * 这组断言就是钉住它：**宁可重复，不可缺失。**
 * ============================================================
 */
describe('状态变化提示永远都在（不许再被"优化"掉）', () => {
  const clean = () =>
    store.setState({
      gameState: createInitialState({ vitals: { hp: 10, san: 60, mp: 10 } }),
      lastChanges: null,
    });
  const texts = () => (store.getState().lastChanges?.lines ?? []).map((l) => l.text);

  it('捡到东西 → 一定有提示（哪怕守密人在正文里写过）', () => {
    clean();
    store.getState().applyModelDeltas([
      { target: 'inventory', op: 'add', value: { id: '钥匙', name: '黄铜钥匙', qty: 1 } },
    ] as never);
    expect(texts().some((t) => t.includes('黄铜钥匙'))).toBe(true);
  });

  it('掉血 → 一定有数值提示', () => {
    clean();
    store.getState().applyModelDeltas([{ target: 'vitals.hp', op: 'dec', amount: 2 }] as never);
    expect(texts().some((t) => t.includes('生命'))).toBe(true);
  });

  it('新线索 → 一定有提示', () => {
    clean();
    store.getState().applyModelDeltas([
      { target: 'clues', op: 'add', value: '门缝里塞着的半张照片' },
    ] as never);
    expect(texts().some((t) => t.includes('门缝里塞着的半张照片'))).toBe(true);
  });

  it('delta 上即使带了未知字段（比如老契约的 announce），提示也照样出', () => {
    clean();
    store.getState().applyModelDeltas([
      { target: 'inventory', op: 'add', value: { id: 'k', name: '铜钥匙', qty: 1 }, announce: true },
    ] as never);
    // 未知字段一律忽略 —— 它**不是**"别提示"的开关
    expect(texts().some((t) => t.includes('铜钥匙'))).toBe(true);
  });
});

/*
 * ============================================================
 * 第 17 版 D：**模型忘了扣，也要说一声**。
 *
 * 玩家写了「把绷带铺在地上」，引擎把"点到了止血绷带"报给守密人（红线二之五），
 * 但契约里忘了写 `inventory dec`。引擎**不替他扣**（A+B 撤掉了本地预扣，
 * 实物的用法引擎猜不出来），但也不能一声不吭 —— 那样玩家会以为这东西是无限的。
 *
 * 判据来源是 `opts.mentionedItems`（`App.sendToGm` 从玩家消息本身算出来的），
 * 所以这几条断言同时钉住了"算没算"和"说没说"两侧。
 * ============================================================
 */
describe('点了名却没扣 → 说一句「还在背包里」（第 17 版 D）', () => {
  const clean = (items: { id: string; name: string; qty: number }[]) =>
    store.setState({
      gameState: {
        ...createInitialState({ vitals: { hp: 10, san: 60, mp: 10 } }),
        inventory: items,
      },
      lastChanges: null,
    });
  const texts = () => (store.getState().lastChanges?.lines ?? []).map((l) => l.text);
  const BANDAGE = { id: 'b1', name: '止血绷带', qty: 3 };
  const POTION = { id: 'p1', name: '治疗药剂', qty: 2 };

  it('点了名、契约没 dec → 出一句「「止血绷带」还在背包里」', () => {
    clean([BANDAGE]);
    store.getState().applyModelDeltas([], { mentionedItems: ['止血绷带'] });
    expect(texts()).toContain('「止血绷带」还在背包里');
  });

  it('契约真的 dec 了 → **不**说那句（免得玩家以为没扣）', () => {
    clean([BANDAGE]);
    store.getState().applyModelDeltas(
      [{ target: 'inventory', op: 'dec', value: '止血绷带', amount: 1 }] as never,
      { mentionedItems: ['止血绷带'] }
    );
    expect(texts()).not.toContain('「止血绷带」还在背包里');
  });

  it('没点名 → 一句话都不多说（不许无中生有）', () => {
    clean([BANDAGE, POTION]);
    store.getState().applyModelDeltas([], { mentionedItems: [] });
    expect(texts().some((t) => t.includes('还在背包里'))).toBe(false);
  });

  it('点了两样、只扣了一样 → 只对没扣的那样说', () => {
    clean([BANDAGE, POTION]);
    store.getState().applyModelDeltas(
      [{ target: 'inventory', op: 'dec', value: '止血绷带', amount: 1 }] as never,
      { mentionedItems: ['止血绷带', '治疗药剂'] }
    );
    expect(texts()).toContain('「治疗药剂」还在背包里');
    expect(texts()).not.toContain('「止血绷带」还在背包里');
  });

  it('**绝不**替玩家扣（点名不给 dec，物品数量分毫不动）', () => {
    clean([BANDAGE]);
    store.getState().applyModelDeltas([], { mentionedItems: ['止血绷带'] });
    const it = store.getState().gameState.inventory.find((i) => i.name === '止血绷带');
    expect(it?.qty).toBe(3); // 还是 3，没被"顺手"扣掉
  });
});

/*
 * ============================================================
 * 世界层（Phase 2）：走 store 的真实通道验证 —— 不是只测纯函数
 *
 * 这里要证明的是那三条铁律在**串起来之后**还成立：
 * 结档能把这一局收回去、开团能把上一个故事带过来、
 * 而"每局账"（伤口/疯狂）永远不过去。
 * ============================================================
 */
describe('世界层：结档收回去，开团带过来', () => {
  const END = '2026-09-17T12:00:00.000Z';

  const worldSnapshot = {
    location: '货船甲板',
    npcsAlive: ['老杰克'],
    threads: [{ name: '查清船长的账', status: '还在查' }],
    flags: { '世界.门开了': true, 伤口: '上一局的伤' },
  };

  const seedWorld = () =>
    store.setState({
      worldName: '雾港',
      worlds: {
        雾港: {
          id: '雾港',
          name: '雾港',
          updatedAt: END,
          runs: [],
          modules: ['雾港'],
          snapshot: worldSnapshot,
        },
      },
    });

  it('结档把这一局收回世界：四样都记上，每局账滤掉', () => {
    store.setState({
      worlds: {},
      worldName: '雾港',
      messages: [],
      chronicle: [],
      gameState: createInitialState({
        vitals: { hp: 10, san: 60, mp: 10 },
        location: '货船甲板',
        npcsAlive: ['老杰克'],
        threads: [{ name: '查清船长的账', status: '还在查' }],
        flags: { '世界.门开了': true, 伤口: '左臂被划开', 疯狂轮数: 2 },
        ending: { kind: 'success', text: '你划着小艇离开了。', at: END },
      }),
    });
    store.getState().recordCurrentRun();

    const w = store.getState().worlds['雾港'];
    expect(w).toBeDefined();
    expect(w!.runs.length).toBe(1);
    expect(w!.snapshot!.location).toBe('货船甲板');
    expect(w!.snapshot!.npcsAlive).toEqual(['老杰克']);
    expect(w!.snapshot!.threads.map((t) => t.name)).toEqual(['查清船长的账']);
    // 伤口与疯狂轮数**不许**进留档 —— 带进新团就是开局流血
    expect(w!.snapshot!.flags).toEqual({ '世界.门开了': true });
  });

  it('没有结局就不收（跑了一半的状态不该被当成世界的现状）', () => {
    store.setState({
      worlds: {},
      worldName: '雾港',
      gameState: createInitialState({ vitals: { hp: 10, san: 60, mp: 10 }, location: '货船甲板' }),
    });
    store.getState().recordCurrentRun();
    expect(Object.keys(store.getState().worlds)).toEqual([]);
  });

  it('开新团接着上次跑：地点、人、未结的支线都带过来', () => {
    seedWorld();
    store.setState({ carryWorld: true });
    store.getState().startNewGame();

    const gs = store.getState().gameState;
    expect(gs.location).toBe('货船甲板');
    expect(gs.npcsAlive).toContain('老杰克');
    expect(gs.threads.map((t) => t.name)).toEqual(['查清船长的账']);
    expect(gs.flags['世界.门开了']).toBe(true);
    // 开局不该带着上一局的伤
    expect(gs.flags['伤口']).toBeUndefined();
    // 无前缀的标记一律不带过局（模型发明的状态词也漏不过去）
    expect(gs.flags['中毒']).toBeUndefined();
    // 剧情是清的 —— 只有"世界记得的东西"被带过来
    expect(store.getState().chronicle).toEqual([]);
  });

  it('关掉开关就不带，但留档**不会被删**（玩家可能只是想重跑一遍）', () => {
    seedWorld();
    store.setState({ carryWorld: false });
    store.getState().startNewGame();

    expect(store.getState().gameState.location).not.toBe('货船甲板');
    expect(store.getState().worlds['雾港']!.snapshot!.location).toBe('货船甲板');
  });

  it('忘掉一个世界：留档与履历一起没，别的世界不受影响', () => {
    seedWorld();
    store.setState((s) => ({
      worlds: {
        ...s.worlds,
        孤岛: { id: '孤岛', name: '孤岛', updatedAt: END, runs: [], modules: [] },
      },
    }));
    store.getState().forgetWorld('雾港');
    expect(store.getState().worlds['雾港']).toBeUndefined();
    expect(store.getState().worlds['孤岛']).toBeDefined();
  });

  it('世界名留空时跟着模组名走（"不填"永远是合理的默认）', async () => {
    const { currentWorldName } = await import('../src/ui/store.js');
    expect(currentWorldName({ worldName: '', module: { title: '雾港' } })).toBe('雾港');
    expect(currentWorldName({ worldName: ' 我的世界 ', module: { title: '雾港' } })).toBe('我的世界');
    expect(currentWorldName({ worldName: '', module: { title: '' } })).toBe('未命名的世界');
  });
});

describe('角色档案库：走 store 通道存取一张卡', () => {
  it('存下当前这张 → 列表里有它；再取用 → 当前角色卡换成它', () => {
    const before = store.getState().character;
    const { entry } = store.getState().archiveCurrentCharacter();
    expect(store.getState().characterArchive.some((c) => c.id === entry.id)).toBe(true);

    // 把当前卡改成别人，再从档案库取回来
    store.getState().setCharacter({ name: '临时改的名字' });
    expect(store.getState().character.name).toBe('临时改的名字');
    expect(store.getState().useArchivedCharacter(entry.id)).toBe(true);
    expect(store.getState().character.name).toBe(before.name);
  });

  it('取一张不存在的卡：返回 false，绝不把当前角色卡改坏', () => {
    store.getState().setCharacter({ name: '还在的人' });
    expect(store.getState().useArchivedCharacter('查无此人')).toBe(false);
    expect(store.getState().character.name).toBe('还在的人');
  });

  it('删掉一张卡之后就取不到了', () => {
    store.getState().setCharacter({ name: '要被删的人' });
    const { entry } = store.getState().archiveCurrentCharacter();
    expect(store.getState().useArchivedCharacter(entry.id)).toBe(true);
    store.getState().deleteArchivedCharacter(entry.id);
    expect(store.getState().useArchivedCharacter(entry.id)).toBe(false);
  });
});

/*
 * 自定义题材的删除。
 * 以前删题材**没有任何入口**（`removeCustomGenre` 写了但没人调）—— 能自建、能选中，就是删不掉。
 * 2026-09-20 在设置页补上按钮后，这里钉住最容易出事的一处：
 * 删掉的**正是当前选中的**那一件时，`genreId` 还指着它 —— 那个 id 已经不存在了，
 * 界面会取到一个谁都不认识的题材。必须退回内置。
 */
describe('自定义题材的删除', () => {
  const custom: Genre = {
    id: 'my-genre',
    name: '我的题材',
    blurb: '一句话简介',
    setting: '某个舞台',
    tone: '某种腔调',
    imageStyle: '某种画风',
    castHint: '某种同伴',
  };

  it('删的不是当前选中的：题材名单里没了，当前选择不受影响', () => {
    const s = () => store.getState();
    s().saveCustomGenre(custom);
    s().setGenre('coc');
    s().removeCustomGenre(custom.id);
    expect(s().customGenres.some((g) => g.id === custom.id)).toBe(false);
    expect(s().genreId).toBe('coc');
  });

  it('删的正是当前选中的：退回内置题材，不留空指向', () => {
    const s = () => store.getState();
    s().saveCustomGenre(custom);
    s().setGenre(custom.id);
    expect(s().genreId).toBe(custom.id);
    s().removeCustomGenre(custom.id);
    expect(s().customGenres.some((g) => g.id === custom.id)).toBe(false);
    // 退回的那一个必须能真的取回一个题材，而不是留个谁都不认识的 id
    expect(s().genreId).toBe('coc');
    expect(getGenre(s().genreId, s().customGenres).id).toBe('coc');
  });
});

/**
 * P2-5（协作方第 20 版）：**期限是引擎的，不是模型的**。
 *
 * 病灶：`setDeadlineDays` 以前无条件接受契约里的 `deadline_days` —— 模型每轮随口报
 * 「还剩 21 天」，玩家就永远卡在 21 天（时钟走了、期限不走；实测 4 轮 09:00→09:03
 * 而期限一步没动）。同时 label 用 `?? ''`，一空永空，界面只能显示
 * 「期限：这件事 · 还剩 21 天」。
 *
 * 新判据两条：① **已经有一个期限对象在**（哪怕已归零）→ 申报**整条忽略**；
 * ② 还没期限 → 才用申报当初值。
 */
describe('期限归引擎：模型只许定初值，不许改现值（P2-5）', () => {
  /** 把期限摆成一个已知状态（绕开模组抽取，直接设） */
  const putDeadline = (remain: number | null, label = '雨季') =>
    store.getState().setDeadline(remain === null ? null : { remain, label });

  // 这个 describe 里会改 module.urgency，写完复位，免得污染后面的用例
  beforeEach(() => {
    store.getState().setDeadline(null);
  });

  it('已有剩余天数时，模型申报的 deadline_days 一律不改 remain（时钟走、期限走）', () => {
    putDeadline(10 * 24 * 60); // 还剩 10 天
    store.getState().setDeadlineDays(21); // 模型喊"还剩 21 天"
    expect(store.getState().gameState.deadline!.remain).toBe(10 * 24 * 60);
    // 报个更大的也不行
    store.getState().setDeadlineDays(99);
    expect(store.getState().gameState.deadline!.remain).toBe(10 * 24 * 60);
    // 报个更小的同样不行（模型无权缩，只能等引擎按 elapsed 扣）
    store.getState().setDeadlineDays(1);
    expect(store.getState().gameState.deadline!.remain).toBe(10 * 24 * 60);
  });

  it('已有期限时，申报连 label 都改不动', () => {
    putDeadline(5 * 24 * 60, '雨季结束');
    store.getState().setDeadlineDays(30);
    expect(store.getState().gameState.deadline!.label).toBe('雨季结束');
  });

  it('反向：还没有期限时，申报**能**当初值（别修死）', () => {
    putDeadline(null);
    store.getState().setDeadlineDays(3);
    const d = store.getState().gameState.deadline;
    expect(d).not.toBeNull();
    expect(d!.remain).toBe(3 * 24 * 60);
  });

  it('无期限时申报的 label 回落模组 urgency 首句，不留空串（不再是 `?? 空`）', () => {
    store.getState().setModule({ urgency: '雨季还有二十三天结束。之后路就断了。' });
    putDeadline(null);
    store.getState().setDeadlineDays(23);
    const d = store.getState().gameState.deadline!;
    expect(d.label).toBe('雨季还有二十三天结束');
    expect(d.label).not.toBe('');
  });

  it('无期限、模组也推不出 label 时，兜底写「期限」而不是空串', () => {
    store.getState().setModule({ urgency: '' });
    putDeadline(null);
    store.getState().setDeadlineDays(7);
    expect(store.getState().gameState.deadline!.label).toBe('期限');
  });

  it('期限已经走到 0（到点了）时，模型申报仍改不动它 —— 不许续命', () => {
    putDeadline(0);
    store.getState().setDeadlineDays(21);
    // remain 仍是 0 —— 到点了就走模组的「结局与失败条件」，模型一句"还剩 21 天"不能续回来
    expect(store.getState().gameState.deadline!.remain).toBe(0);
  });

  it('已有期限时，模型传非正数也清不掉它（要清得走引擎侧的 setDeadline）', () => {
    putDeadline(5 * 24 * 60);
    store.getState().setDeadlineDays(0);
    expect(store.getState().gameState.deadline!.remain).toBe(5 * 24 * 60);
    store.getState().setDeadlineDays(undefined);
    expect(store.getState().gameState.deadline!.remain).toBe(5 * 24 * 60);
    // 引擎侧的口子照常有效
    store.getState().setDeadline(null);
    expect(store.getState().gameState.deadline).toBeNull();
  });

  it('还没有期限时，传非正数 / 非有限数 ＝ 保持无期限', () => {
    putDeadline(null);
    store.getState().setDeadlineDays(0);
    expect(store.getState().gameState.deadline).toBeNull();
    store.getState().setDeadlineDays(Number.NaN);
    expect(store.getState().gameState.deadline).toBeNull();
    store.getState().setDeadlineDays(undefined);
    expect(store.getState().gameState.deadline).toBeNull();
  });
});

/* ============================================================
 * 🔴 `G26`（协28 §F① 第 1 条）：结档必须**立刻**落盘，重开不许复活。
 *
 * 真机：走「主动求死」→ 确认 → `ending` 出现；**一重开，`ending` 变回 `null`**，
 * 结档页不在、故事接着跑 —— 而生涯数据却记住了（成就到手、跑过的局 +1）。
 *
 * 根因：`forceEnding` / `setEnding` / `clearEnding` 走的是**节流 800ms** 的 `saveJson`。
 * 结档是结构性操作（与"清空 / 回溯 / 开新团 / 导入"同类）——必须走 `saveJsonNow`。
 * ============================================================ */
describe('G26：结档立刻落盘，重开不许复活', () => {
  it('🔴 forceEnding 当场写盘（不等节流窗口），重载后仍是已结档', () => {
    localStorage.clear();
    store.getState().forceEnding('death');
    // 直接读盘：没有 flush、没等 800ms —— 旧写法这里读出来是 null
    const raw = localStorage.getItem('trpg.gameState');
    expect(raw, 'forceEnding 没有立刻落盘').toBeTruthy();
    expect(JSON.parse(raw!).ending?.kind).toBe('death');
    expect(Boolean(loadGameState().ending)).toBe(true);
  });

  it('🔴 空正文的 ending 也算已结档（判据不能是"结局正文写好了没"）', () => {
    localStorage.clear();
    store.getState().forceEnding('insanity');
    const gs = loadGameState();
    expect(gs.ending?.text).toBe('');
    expect(Boolean(gs.ending)).toBe(true);
  });

  it('setEnding / clearEnding 同样立刻落盘', () => {
    localStorage.clear();
    store.getState().forceEnding('death');
    store.getState().setEnding('death', '你沉进了黑水里。');
    expect(JSON.parse(localStorage.getItem('trpg.gameState')!).ending.text).toBe(
      '你沉进了黑水里。'
    );
    store.getState().clearEnding();
    expect(JSON.parse(localStorage.getItem('trpg.gameState')!).ending).toBe(null);
  });
});

/* ============================================================
 * 🔴 `G1`（协28 §F① 第 2 条）：**一次玩家行动只推一轮**。
 *
 * 旧判据是「距上次推进够 4 秒了吗」——一次行动里只要有两个相隔 >4 秒的结算点
 * （正文一轮 ＋ 漏契约时"只补契约"的兜底），轮次就 +2。真机跑出 `1→3→5→7`。
 * 现在按**行动**计：玩家消息落盘时置标记，结算点消费。
 * ============================================================ */
describe('G1：一次玩家行动只推一轮', () => {
  const seed = () => {
    resetStatusTickForTest();
    store.setState({
      gameState: {
        ...store.getState().gameState,
        combat: { active: true, round: 1, foes: [{ name: '怪物', hp: 20, max: 20 }] },
      },
    });
  };
  /*
   * 一次"结算"＝守密人回话落地那一刻。**故意不带任何会动到 combat 的 delta** ——
   * 这里要验的是"引擎自己推的轮次"，别让探针自己把 round 改回去。
   */
  const settle = () => store.getState().applyModelDeltas([] as never);

  it('🔴 同一次行动的第二次结算不再 +1（旧写法这里会变 3）', () => {
    seed();
    store.getState().addMessage({ role: 'player', content: '我开枪' });
    settle();
    expect(store.getState().gameState.combat.round).toBe(2);
    settle();
    expect(store.getState().gameState.combat.round).toBe(2);
  });

  it('下一次行动照常 +1', () => {
    seed();
    store.getState().addMessage({ role: 'player', content: '我开枪' });
    settle();
    store.getState().addMessage({ role: 'player', content: '我再打一枪' });
    settle();
    expect(store.getState().gameState.combat.round).toBe(3);
  });

  it('玩家没行动时（引擎自己补一次结算）不推轮次', () => {
    seed();
    settle();
    expect(store.getState().gameState.combat.round).toBe(1);
  });
});


/* ============================================================
 * 🔴 `P2-10`（协28 打回）+ `G21`：**后来加的字段不许在读档时丢掉**。
 *
 * 两个白名单漏键，同一个病：生成侧写了、运行时也读了，
 * 可读档那一步把它们吞了 → 表现成"模组申报的开局时刻/期限刷新后回默认值"、
 * "AI 卡的外貌栏永远是空的"。这就是 `P2-10` 反复复现的根子。
 * ============================================================ */
describe('P2-10 + G21：白名单不许吞掉后来加的字段', () => {
  it('🔴 mergeModule 保住 startClock / deadlineIn', () => {
    const raw = JSON.stringify({
      title: 'T',
      startClock: { day: 3, minute: 15 * 60 },
      deadlineIn: 20160,
    });
    const m = mergeModule(raw);
    expect(m.startClock).toEqual({ day: 3, minute: 15 * 60 });
    expect(m.deadlineIn).toBe(20160);
  });

  it('🔴 migrateCharacter 透传 appearance（外貌栏空掉的那个）', () => {
    const c = migrateCharacter({ name: '测试员', appearance: '黑发，左眉一道旧疤' });
    expect(c.appearance).toBe('黑发，左眉一道旧疤');
  });

  it('没给这些字段时不凭空造（老档照旧）', () => {
    const m = mergeModule(JSON.stringify({ title: 'T' }));
    expect(m.startClock).toBeUndefined();
    expect(m.deadlineIn).toBeUndefined();
  });
});

/* ============================================================
 * 🔴 `G17`（store 层）：玩家说「我等到 X」，守密人只报「一会儿」也不许糊弄过去。
 * 纯函数对 ≠ 接上了线 —— 这里走真实通道：落消息 → 结算 → 看时钟。
 * ============================================================ */
describe('G17：等到某个时刻，时钟真的走到那', () => {
  it('🔴 守密人只报「一会儿」，时钟仍被抬到午夜之后', () => {
    resetStatusTickForTest();
    store.setState({
      gameState: { ...store.getState().gameState, clock: { day: 1, minute: 9 * 60 } },
    });
    store.getState().addMessage({ role: 'player', content: '我在钟楼里等到午夜。' });
    store.getState().applyModelDeltas([], { elapsed: '一会儿' } as never);
    const c = store.getState().gameState.clock!;
    expect(c.day * 1440 + c.minute).toBeGreaterThanOrEqual(2880);
  });

  it('没写「等到」的普通行动不受影响（照模型报的走）', () => {
    resetStatusTickForTest();
    store.setState({
      gameState: { ...store.getState().gameState, clock: { day: 1, minute: 9 * 60 } },
    });
    store.getState().addMessage({ role: 'player', content: '我推开门看看里面。' });
    store.getState().applyModelDeltas([], { elapsed: '一会儿' } as never);
    const c = store.getState().gameState.clock!;
    expect(c.day * 1440 + c.minute).toBe(1980 + 10);
  });
});

/* ============================================================
 * 🔴 `G25` + `G27` **接线**（协28 §F① 第 6b 条）：
 * 纯函数对 ≠ 接上了线 —— 这里走真实通道：掷骰（或没掷）→ 模型申报扣血 → 看引擎收不收。
 * ============================================================ */
describe('G25/G27 接线：没掷检定，模型扣不动玩家', () => {
  const blood = (hp = 10) =>
    store.setState({
      gameState: createInitialState({
        vitals: { hp, san: 60, mp: 10 },
        vitalsMax: { hp: 10, san: 99, mp: 10 },
      }),
    });
  const hit = (amount: number, extra: Record<string, unknown> = {}) =>
    store.getState().applyModelDeltas([
      { target: 'vitals.hp', op: 'dec', amount, ...extra },
    ] as never);

  it('🔴 这一轮没掷过检定 → 申报的伤害被拒，而且玩家看得见那句理由', () => {
    resetCheckGrantForTest();
    blood();
    hit(5);
    expect(store.getState().gameState.vitals.hp).toBe(10);
    const lines = store.getState().lastChanges?.lines ?? [];
    expect(lines.some((l) => l.text.includes('检定'))).toBe(true);
  });

  it('🔴 掷过之后 → 放行（血真的掉）', () => {
    resetCheckGrantForTest();
    blood();
    grantHarmCheck();
    hit(5);
    expect(store.getState().gameState.vitals.hp).toBe(5);
  });

  it('🔴 大失败 → 一次掉到位，并且**当场结档**（不再等下一轮）', () => {
    resetCheckGrantForTest();
    blood();
    // 两颗骰都掷 0 → 百分骰 = 100 = 大失败
    const spy = vi.spyOn(Math, 'random').mockReturnValue(0);
    store.getState().skillCheck('格斗（斗殴）');
    spy.mockRestore();
    hit(1); // 数字很小，但大失败就是"死定了"
    const gs = store.getState().gameState;
    expect(gs.vitals.hp).toBe(0);
    expect(gs.ending?.kind).toBe('death');
  });

  it('环境伤害写清 reason 就不必先掷检定（坠落 / 窒息这类）', () => {
    resetCheckGrantForTest();
    blood();
    hit(4, { reason: '从楼梯上滚下去' });
    expect(store.getState().gameState.vitals.hp).toBe(6);
  });
});

/* ============================================================
 * 🔴 `G10`+`G22`（协30 §2.5）：**AI 生成的技能表落盘前要按预算封顶**。
 *
 * 真机：生成出来「已用 333 / 剩余 −23」（预算 310）。手工加点早有封顶，
 * AI 这条路没有 —— 又一次"写了约束 ≠ 引擎在执行"。
 * ============================================================ */
describe('G10：生成的技能表超支时，落盘前削到预算内', () => {
  // 预算 = edu×4 + int×2 = 50×4 + 50×2 = 300
  const ch = { str: 50, con: 50, siz: 50, dex: 50, app: 50, int: 50, pow: 50, edu: 50 };

  it('🔴 超支的卡会被削到不超（挑投入最多的那些削）', () => {
    // 「会计」基础 5、「图书馆使用」基础 20 —— 都写满 90，投入远超 300
    const wild = { 会计: 90, 图书馆使用: 90, 侦查: 90, 聆听: 90 };
    const capped = capSkillsToBudget(wild, ch, 'coc7');
    // 判据用**同一份"已用"定义**（`skillBudget`）—— 手写减法会把各技能的基础值算错
    const { remaining, total } = skillBudget({ characteristics: ch, skills: capped }, 'coc7');
    expect(remaining).toBeGreaterThanOrEqual(0);
    expect(total).toBe(300);
    // 削的是"投入"，不是把技能清零 —— 每一项都还在，也都没掉到基础值以下
    expect(Object.keys(capped)).toHaveLength(4);
    for (const k of Object.keys(wild)) expect(capped[k]!).toBeGreaterThan(0);
  });

  it('没超支的原样不动（一个数都不改）', () => {
    const ok = { 侦查: 60, 聆听: 40 };
    expect(capSkillsToBudget(ok, ch, 'coc7')).toEqual(ok);
  });
});

/* ============================================================
 * 🔴 `N2` **接线**（协30 §2.3）：一次玩家行动里，状态结算与伤口失血**各只算一次**。
 *
 * 真机：`伤口·每轮 -1` 实际一轮掉 2～3 点，因为一轮里 `applyModelDeltas` 会被调多次
 * （正文一次、地点一次、漏契约补一次），而旧判据是"距上次够 4 秒吗"。
 * 更要紧的是协30 那句提醒：**三个标记要分开消费** —— 共用的话先消费的会把后到的饿死。
 * ============================================================ */
describe('N2 接线：一次行动只算一次（还要求两样都不饿死）', () => {
  it('🔴 一次行动里连调三次 → 伤口只掉 1 点（不是 3 点）', () => {
    resetStatusTickForTest();
    grantHarmCheck();
    // 先造一处伤口（当轮不再补失血：那几点已经付过账了）
    actThen([{ target: 'vitals.hp', op: 'dec', amount: 3, reason: '被划中' }]);
    expect(store.getState().gameState.wounds ?? []).toHaveLength(1);

    const before = store.getState().gameState.vitals.hp ?? 0;
    // 一次玩家行动 → 同一轮的三次结算点
    store.getState().addMessage({ role: 'player', content: '我继续往前走。' });
    store.getState().applyModelDeltas([] as never);
    store.getState().applyModelDeltas([{ target: 'location', op: 'set', value: '别处' }] as never);
    store.getState().applyModelDeltas([] as never);

    expect(before - (store.getState().gameState.vitals.hp ?? 0)).toBe(1);
  });

  it('🔴 状态与伤口**各算一次**（分开消费，谁也不把谁饿死）', () => {
    resetStatusTickForTest();
    grantHarmCheck();
    // 干净的基座（带 vitalsMax）—— 免得 hp 被上限裁到 0 而落进濒死冻结
    store.setState({
      gameState: {
        ...createInitialState({
          vitals: { hp: 10, san: 60, mp: 10 },
          vitalsMax: { hp: 10, san: 99, mp: 10 },
        }),
        flags: {},
      },
    });
    // 先把中毒与伤口都摆上（扣 2 点：够留一道伤口，又不至于落到濒死）
    actThen([
      { target: 'flags.中毒', op: 'set', value: true },
      { target: 'flags.中毒轮数', op: 'set', value: 3 },
      { target: 'vitals.hp', op: 'dec', amount: 2, reason: '被划中' },
    ] as never);

    const hpBefore = store.getState().gameState.vitals.hp ?? 0;
    store.getState().addMessage({ role: 'player', content: '我继续。' });
    // 场景一：状态那次先跑
    store.getState().applyModelDeltas([] as never);
    // 场景二：同一轮里伤口那一段（地点那次）也要能轮到
    store.getState().applyModelDeltas([{ target: 'location', op: 'set', value: '别处' }] as never);
    store.getState().applyModelDeltas([] as never);

    const dropped = hpBefore - (store.getState().gameState.vitals.hp ?? 0);
    // 中毒 −1 与伤口 −1 都要发生（各一次），而不是"先到的把标记吃掉、另一个永远是 0"
    expect(dropped).toBeGreaterThanOrEqual(2);
    expect(store.getState().gameState.flags['中毒轮数']).toBe(2);
  });
});

/* ============================================================
 * 🔴 `N2-余`（协31 §F① 第 1 条 · P3）：**时钟推进也改成一次行动只算一次**。
 *
 * 14.38 自己报备的遗留：`N2` 把状态与伤口改成了行动标记，时钟还留着 4 秒窗。
 * 判据（协31）：同一行动内多次 `applyModelDeltas`（**间隔 >4 秒**）时钟只推一次；
 * 「等到 X」的上下限行为不变（那条在 `clock.test.ts` 单独钉着）。
 * ============================================================ */
describe('N2-余：时钟推进也是一次行动只算一次', () => {
  const minuteOf = () => {
    const c = store.getState().gameState.clock!;
    return c.day * 1440 + c.minute;
  };

  it('🔴 同一行动内两次结算、间隔超过旧的 4 秒窗 → 时钟只走一次', () => {
    vi.useFakeTimers();
    try {
      resetStatusTickForTest();
      store.setState({
        gameState: {
          ...createInitialState({ vitals: { hp: 10, san: 60, mp: 10 } }),
          clock: { day: 1, minute: 9 * 60 },
        },
      });
      store.getState().addMessage({ role: 'player', content: '我出门往码头走。' });
      store.getState().applyModelDeltas([] as never, { elapsed: '十分钟' } as never);
      const after1 = minuteOf();
      expect(after1).toBeGreaterThan(9 * 60); // 这一轮真的走了

      // 同一行动的第二个结算点，**隔了 10 秒**（旧实现的 4 秒窗在这里会放行第二次）
      vi.advanceTimersByTime(10_000);
      store.getState().applyModelDeltas([], { elapsed: '十分钟' } as never);
      expect(minuteOf()).toBe(after1);
    } finally {
      vi.useRealTimers();
    }
  });

  it('下一次玩家行动照常推进（别把时钟锁死）', () => {
    resetStatusTickForTest();
    store.setState({
      gameState: {
        ...createInitialState({ vitals: { hp: 10, san: 60, mp: 10 } }),
        clock: { day: 1, minute: 9 * 60 },
      },
    });
    store.getState().addMessage({ role: 'player', content: '我等着。' });
    store.getState().applyModelDeltas([], { elapsed: '十分钟' } as never);
    const after1 = minuteOf();
    store.getState().addMessage({ role: 'player', content: '我继续等。' });
    store.getState().applyModelDeltas([], { elapsed: '十分钟' } as never);
    expect(minuteOf()).toBeGreaterThan(after1);
  });
});
