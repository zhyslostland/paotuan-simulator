import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { getRuleset } from '../src/core/rulesets/index.js';

/**
 * 回溯/重掷依赖 localStorage。node 环境没有它，这里放一个最小桩，
 * 必须在 import store 之前装好——store 在模块加载时就会读盘。
 */
class MemStorage {
  private m = new Map<string, string>();
  getItem(k: string) {
    return this.m.has(k) ? this.m.get(k)! : null;
  }
  setItem(k: string, v: string) {
    this.m.set(k, String(v));
  }
  removeItem(k: string) {
    this.m.delete(k);
  }
  clear() {
    this.m.clear();
  }
  key(i: number) {
    return [...this.m.keys()][i] ?? null;
  }
  get length() {
    return this.m.size;
  }
}

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

beforeAll(async () => {
  vi.stubGlobal('localStorage', new MemStorage());
  const mod = await import('../src/ui/store.js');
  store = mod.useStore;
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

  it('改角色名会按新名字重推导称呼，写进开场白', () => {
    store.setState({
      messages: [{ id: 'welcome', role: 'gm', content: '老的开场白，称呼是霍尔特。', ts: 0 }],
    });

    store.getState().setCharacter({ name: '卢卡斯' });

    expect(store.getState().messages[0]!.content).toContain('卢卡斯先生');
    expect(store.getState().messages[0]!.content).not.toContain('霍尔特');
  });

  it('手填的称呼优先于推导值', () => {
    store.setState({
      messages: [{ id: 'welcome', role: 'gm', content: '开场白。', ts: 0 }],
    });

    store.getState().setCharacter({ address: '陈小姐' });

    expect(store.getState().messages[0]!.content).toContain('陈小姐');
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
      expect(c?.name).toBeTruthy();
      expect(c?.description).toBeTruthy();
    }
  });

  it('没有示例角色的题材返回 undefined（界面不显示按钮）', () => {
    expect(starterCharacterOf('not-a-genre')).toBeUndefined();
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

  it('第一次归零只进"濒死"，不给 ending（留一轮演出的机会）', () => {
    store.setState({ gameState: base() });
    store.getState().applyModelDeltas([{ target: 'vitals.hp', op: 'set', value: 0 }] as never);
    expect(store.getState().gameState.vitals.hp).toBe(0);
    expect(store.getState().gameState.dying).toBe(true);
    expect(store.getState().gameState.ending).toBeNull();
  });

  it('第二次结算才给出 ending，且**正文留空**（由 App 去要结局）', () => {
    store.setState({ gameState: base() });
    store.getState().applyModelDeltas([{ target: 'vitals.hp', op: 'set', value: 0 }] as never);
    store.getState().applyModelDeltas([{ target: 'vitals.hp', op: 'dec', amount: 1 }] as never);
    const gs = store.getState().gameState;
    expect(gs.ending?.kind).toBe('death');
    expect(gs.ending?.text).toBe('');
    expect(gs.ending?.at).toBeTruthy();
  });

  it('理智归零直接结档（不给缓冲）', () => {
    store.setState({ gameState: base() });
    store.getState().applyModelDeltas([{ target: 'vitals.san', op: 'set', value: 0 }] as never);
    expect(store.getState().gameState.ending?.kind).toBe('insanity');
  });

  it('回血能解除濒死', () => {
    store.setState({ gameState: base() });
    store.getState().applyModelDeltas([{ target: 'vitals.hp', op: 'set', value: 0 }] as never);
    store.getState().applyModelDeltas([{ target: 'vitals.hp', op: 'set', value: 5 }] as never);
    expect(store.getState().gameState.dying).toBe(false);
    expect(store.getState().gameState.ending).toBeNull();
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
  it('生命归零先算濒死，下一个结算点仍是 0 才结档', () => {
    store.setState({ gameState: createInitialState({ vitals: { hp: 5, san: 60, mp: 10 } }) });
    store.getState().applyModelDeltas([{ target: 'vitals.hp', op: 'dec', amount: 5 }]);
    expect(store.getState().gameState.vitals.hp).toBe(0);
    expect(store.getState().gameState.dying).toBe(true);
    expect(store.getState().gameState.ending ?? null).toBeNull();

    store.getState().applyModelDeltas([{ target: 'vitals.hp', op: 'dec', amount: 1 }]);
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
    store.setState({ gameState: createInitialState({ vitals: { hp: 5, san: 60, mp: 10 } }) });
    store.getState().applyModelDeltas([{ target: 'vitals.hp', op: 'dec', amount: 5 }]);
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
