import { describe, expect, it } from 'vitest';
import type {
  CharacterProfile,
  Module,
  ModuleItem,
  ModuleMonster,
  ModuleNpc,
  SaveFile,
  WorldbookEntry,
  MapNode,
  Message,
} from '../src/core/types.js';
import type { StoryClock } from '../src/core/clock.js';
import type { GameState } from '../src/core/state/gameState.js';import { mergeCharacter, mergeModule, migrateSave, SAVE_VERSION } from '../src/ui/state/loaders.js';

/**
 * 🔴 **读档不许丢字段** —— 2026-09-30 加，针对本项目**复发次数最多**的那个 bug 家族。
 *
 * ## 这个病长什么样（真机记录）
 *
 * `docs/报告/游玩测试报告-历史归档-截至第16轮.md:600` 写得很清楚：
 *
 * > `ui/state/loaders.ts:874 mergeModule()` 是**显式字段白名单** ——
 * > 把 `Module` 的 21 个字段逐一对比过，只丢了 `startClock` 与 `deadlineIn`。
 * > ⇒ **只要走一次读盘**（刷新 / 重开 / 任何 `loadModule()`），内存里的 module 就少这两个键。
 * >
 * > 🔴 同文件注释还写着「**以下是后来陆续加的字段，同样不能在这里丢**」—— 这次新加的两个就丢了。
 *
 * 而当时的三条"静态核对"**同时成立却照样不工作**：
 * **类型里有 ✓ · schema 里有 ✓ · 开团时会读 ✓ —— 唯独 `mergeModule` 这一环没有。**
 * 报告给它的结论是：**静态核对看的是"有没有"，真机测的是"接没接上"。**
 *
 * 同族还有 `migrateCharacter` 漏 `appearance`（`G21`）、`migrateSave` 漏 label（`P2-5·边界`）。
 *
 * ## 这个文件怎么拦住它
 *
 * 1. **fixture 用 `satisfies Module`**：类型加了字段而 fixture 没跟上，**`tsc` 当场报错** ——
 *    所以这份清单不可能悄悄过期（这正是"人肉清单"和"类型钉住"的区别）。
 * 2. **逐键核对**：喂一个"每个字段都有值"的对象进 `mergeModule` / `mergeCharacter` / `migrateSave`，
 *    断言**每一个键都还在，且值没被换掉**。
 *
 * 也就是说：以后谁再往 `Module` 加一个字段却忘了在 `mergeModule` 里放行，
 * **这里会红**，而不是等玩家刷新一次才发现"我模组里设的东西没了"。
 */
const expectNoFieldLost = (input: object, output: object, label: string) => {
  const keys = Object.keys(input);
  expect(keys.length, `${label}: fixture 是空的，这条断言就没意义了`).toBeGreaterThan(5);
  const lost = keys.filter((k) => !(k in output));
  expect(lost, `${label}: 这些字段在读档时被吞了 → ${lost.join(', ')}`).toEqual([]);
  const changed = keys.filter(
    (k) => JSON.stringify((output as Record<string, unknown>)[k]) !== JSON.stringify((input as Record<string, unknown>)[k])
  );
  expect(changed, `${label}: 这些字段的值被改写了 → ${changed.join(', ')}`).toEqual([]);
};

/**
 * 数值表（`characteristics` / `skills`）的口径不同：
 * `migrateCharacter` 会把它们**并到规则包默认值之上**（补全缺失的键），
 * 所以那是**超集**、不是改写。判据要按真实语义写，不能为了好看把断言改成"随便"。
 */
const expectSuperset = (input: Record<string, number>, output: Record<string, number>, label: string) => {
  for (const [k, v] of Object.entries(input)) {
    expect(output[k], `${label}: 键 ${k} 的值被改了（${v} → ${output[k]}）`).toBe(v);
  }
  expect(
    Object.keys(output).length,
    `${label}: 输出居然比输入还少，说明有键被丢了`
  ).toBeGreaterThanOrEqual(Object.keys(input).length);
};

/** 每个字段都给真值，否则"没丢"可能只是因为两边都是 undefined。 */
const npc: ModuleNpc = { id: 'npc-1', name: '汉克', role: '灯塔看守', motive: '掩护弟弟', secret: '他才是纵火者' };
const node: MapNode = { name: '码头', links: ['仓库'], note: '夜里没人敢去' };
const monster: ModuleMonster = { id: 'm-1', name: '雾中的巨影', look: '湿漉漉的轮廓', hp: 20, attack: '爪击 1d6', behavior: '先伏击', weakness: '怕光' };
const item: ModuleItem = { id: 'i-1', name: '黄铜钥匙', look: '冰凉的', effect: '能开仓库门', kind: 'tool' };
const wb: WorldbookEntry = { id: 'wb-1', keys: ['灯塔'], content: '灯塔 1873 年建的', priority: 5, enabled: true, fromModule: true };
const clock: StoryClock = { day: 3, minute: 1380 };

const richModule = {
  title: '银月下的灾影',
  premise: '引子',
  opening: '开场白',
  truth: '真相：镇长是幕后',
  npcs: [npc],
  locations: '码头\n灯塔',
  startLocation: '码头',
  mapNodes: [node],
  clueChain: '线索一 → 线索二',
  acts: '第一幕 / 第二幕',
  endings: '成功：逃出；失败：被献祭',
  notes: 'GM 备注',
  goal: '找出失踪的渔民',
  stakes: '再拖一晚就死人',
  urgency: '满月就在今夜',
  startClock: clock,
  deadlineIn: 360,
  sourceNote: 'AI 自创',
  genre: 'coc',
  scale: 'short',
  monsters: [monster],
  items: [item],
  worldbook: [wb],
} satisfies Module;

const richCharacter = {
  name: '艾弗·格雷森',
  gender: '男',
  description: '战地记者',
  personality: '嘴硬心软',
  mes_example: '「先说好，我不欠人情。」',
  scenario: '刚下船，行李还在手上',
  appearance: '高瘦，灰白短发，左眼戴黄铜单片眼镜',
  characteristics: { str: 50, con: 60 },
  skills: { 侦查: 60 },
  items: ['相机'],
  itemDetails: [{ name: '相机', desc: '老式折叠机', kind: 'tool', damage: '', skill: '' }],
  address: '格雷森先生',
  portrait: 'data:image/png;base64,AAAA',
} satisfies CharacterProfile;

/**
 * **运行时键集校验（比逐条写断言更强的一层）**
 *
 * 逐条断言是"我手写的清单"，而本项目出事最多的地方恰恰是**手写清单过期**
 * （`mergeModule` 那句注释写着"后来加的字段不能在这里丢"，下一次加字段又丢了）。
 *
 * ⚠️ 第一版我把判据写反了：以为"空档读出来的键集 = merger 认得的全集"。
 * 但**可选字段在空档里本来就不出现**（`...(s.x !== undefined ? {x} : {})`），
 * 所以那个"全集"其实只是**最小键集**（永远有兜底的那些）。
 *
 * 正确的判据两条，各管一半：
 * - `expectMinimalKeysSurvive`：空档能写出来的**最小键集**，必须在真实 fixture 上全部活下来
 *   → 抓"merger 里某个兜底字段被删了"；
 * - 逐键核对（`expectNoFieldLost`）：真实 fixture 的**每个**键都要活着出来
 *   → 抓"新增字段没放行"。
 *
 * 另外，fixture 用 `satisfies Module` / `satisfies CharacterProfile` 声明 ——
 * **类型加了字段而 fixture 没跟上，`tsc` 会当场报错**，所以这份清单不会过期。
 */
const expectMinimalKeysSurvive = (fixture: object, emptyFallback: object, label: string) => {
  const minimal = Object.keys(emptyFallback);
  expect(minimal.length, `${label}: 空档啥都没写出来，这条判据就没意义了`).toBeGreaterThan(5);
  const fixtureKeys = new Set(Object.keys(fixture));
  const notCovered = minimal.filter((k) => !fixtureKeys.has(k));
  expect(
    notCovered,
    `${label}: 空档会写出来的键，在 fixture 里没有 → 这些字段没被测到：${notCovered.join(', ')}`
  ).toEqual([]);
};

describe('读档不许丢字段（P2-10 / G21 / P2-5·边界 的复发拦截）', () => {
  it('mergeModule：每个字段都活着穿过读档（含后加的 startClock / deadlineIn）', () => {
    const out = mergeModule(JSON.stringify(richModule));
    expectNoFieldLost(richModule, out, 'mergeModule');
    // 这两条单独点名：它们就是真机漏过的那两个
    expect(out.startClock).toEqual(clock);
    expect(out.deadlineIn).toBe(360);
  });

  it('mergeModule：空档会写出的最小键集，必须全部被测到（防"兜底字段被删"）', () => {
    expectMinimalKeysSurvive(richModule, mergeModule('{}'), 'mergeModule');
  });

  it('mergeCharacter：空档会写出的最小键集，必须全部被测到', () => {
    expectMinimalKeysSurvive(richCharacter, mergeCharacter('{}'), 'mergeCharacter');
  });

  /**
   * 🔥 **演练：这两条判据真的会红吗？**
   *
   * 拿一个"故意漏掉某字段"的假 merger 跑同一条判据 —— 必须报出来。
   * 不演练的话，判据有可能只是"永远为真"的摆设（本项目栽过这种跟头）。
   */
  it('演练：漏字段的 merger 必须被逮到', () => {
    // ① 漏一个**可选字段** → 该被"逐键核对"逮到（P2-10 真机的形态）
    const leakyOptional = (raw: string) => {
      const full = mergeModule(raw) as unknown as Record<string, unknown>;
      const { deadlineIn: _dropped, ...rest } = full;
      return rest;
    };
    const out = leakyOptional(JSON.stringify(richModule));
    const lost = Object.keys(richModule).filter((k) => !(k in out));
    expect(lost, '漏可选字段必须被"逐键核对"逮到').toContain('deadlineIn');

    // ② 漏一个**兜底字段**（永远有默认值的那个）→ 该被"最小键集"那条逮到
    const leakyBacked = (raw: string) => {
      const full = mergeModule(raw) as unknown as Record<string, unknown>;
      const { title: _dropped, ...rest } = full;
      return rest;
    };
    const minimalBefore = Object.keys(mergeModule('{}'));
    const minimalAfter = Object.keys(leakyBacked('{}'));
    expect(minimalAfter, '漏兜底字段必须让最小键集变小').not.toEqual(minimalBefore);
    expect(minimalBefore.filter((k) => !minimalAfter.includes(k))).toContain('title');
  });

  it('mergeModule：读档一次与读档两次结果一致（不做有损归一）', () => {
    const once = mergeModule(JSON.stringify(richModule));
    const twice = mergeModule(JSON.stringify(once));
    expect(twice).toEqual(once);
  });

  it('mergeCharacter：每个字段都活着穿过读档（含后加的 appearance / portrait）', () => {
    const out = mergeCharacter(JSON.stringify(richCharacter));
    // 数值表单独按"超集"判（迁移会补全到规则包全集），其余字段逐键核对
    expectSuperset(richCharacter.characteristics, out.characteristics, 'mergeCharacter.characteristics');
    expectSuperset(richCharacter.skills, out.skills, 'mergeCharacter.skills');
    const { characteristics: _c, skills: _s, ...restIn } = richCharacter;
    const { characteristics: _oc, skills: _os, ...restOut } = out;
    expectNoFieldLost(restIn, restOut, 'mergeCharacter');
    expect(out.appearance).toBe(richCharacter.appearance);
    expect(out.portrait).toBe(richCharacter.portrait);
  });

  it('migrateSave：存档顶层字段一个都不丢，数值条也对齐到规则包', () => {
    const richSave = {
      version: SAVE_VERSION,
      exportedAt: '2026-09-30T00:00:00.000Z',
      character: richCharacter,
      module: richModule,
      gameState: { vitals: { hp: 9 }, flags: { 中毒: true } } as unknown as GameState,
      messages: [] as Message[],
      chronicle: [{ turn: 1, text: '开场', location: '码头' }],
      summary: '前情提要',
      worldbook: [wb],
      companionCandidates: [],
      snapshots: {},
    } satisfies SaveFile;

    const out = migrateSave(richSave);
    // `migrateSave` 的语义是"补默认 + 迁移"，它**不该**丢掉任何顶层键
    const lost = Object.keys(richSave).filter((k) => !(k in out));
    expect(lost, `migrateSave 丢掉了顶层字段 → ${lost.join(', ')}`).toEqual([]);
    // 迁移后模组的后加字段仍要在（这正是 P2-10 真机漏掉的那一环）
    expect((out.module as Module).startClock).toEqual(clock);
    expect((out.module as Module).deadlineIn).toBe(360);
    // 旧档（缺数值条）要被补齐成当前规则包的全集，而不是留在那里当 0
    expect(Object.keys(out.gameState?.vitals ?? {}).length).toBeGreaterThan(1);
  });

  it('fixture 必须真的覆盖了类型（防"清单过期"）', () => {
    /*
     * 这条断言本身很弱，它的价值在于：**上面那两个 fixture 用 `satisfies` 声明**，
     * 所以"类型加了字段、fixture 没跟上"会在 `tsc --noEmit` 阶段就红。
     * 这里再确认一下它们确实不是空壳。
     */
    expect(Object.keys(richModule).length).toBeGreaterThan(15);
    expect(Object.keys(richCharacter).length).toBeGreaterThan(8);
  });
});

/**
 * 🔴 **`GameState` 也不许丢字段** —— 2026-09-30 基础完善（批次 B）。
 *
 * ## 为什么单独为 `GameState` 写一组
 *
 * 上一轮补的 fixture 覆盖了 `Module` / `CharacterProfile` / `SaveFile` 顶层，
 * **唯独漏了 `GameState`** —— 而它偏偏是**最大（22 个字段）且被后加字段踩得最多**的那块：
 * `npcNotes` / `wounds` / `encountered` / `fought` / `actIndex` / `actDetails` /
 * `carriedFrom` / `clock` / `deadline` 全是"后来陆续加的"，每一个都写着
 * "可选新增字段，不升 `SAVE_VERSION`"。
 *
 * `P2-10` 的现场正是这一族：类型里有、schema 里有、开团时会读，**唯独读档那一环没放行**，
 * 于是玩家刷新一次，模组申报的开局时刻与期限就没了。
 *
 * ## 判据
 *
 * 1. **fixture 用 `satisfies GameState`** → 类型加字段而 fixture 没跟上，`tsc` 当场红；
 * 2. **逐键核对**：`migrateSave` 走一遍，每个字段都要在、值不能被改写；
 * 3. **嵌套结构**也要核（`combat.foes` / `npcNotes` 子键 / `wounds` 数组 / `companions`）；
 * 4. **迁移契约**分两种如实写：只补键的必须补上；已给定的值不许被默认值顶掉；
 * 5. **幂等**：迁移两次 == 迁移一次（否则每读一次档就漂一点）；
 * 6. **演练**：故意少一个键的迁移必须被逮到。
 */
const richGameState = {
  vitals: { hp: 9, san: 42, mp: 7 },
  vitalsMax: { hp: 12, san: 65, mp: 13 },
  dying: false,
  ending: { kind: 'success', text: '你带着真相走出灯塔。', at: '2026-09-30T10:00:00.000Z', reason: '上了救生艇' },
  companions: [
    {
      id: 'jack',
      name: '老杰克',
      role: '退休铁路工',
      personality: '话少',
      skills: { 体格: 65 },
      vitals: { hp: 11, san: 55, mp: 10 },
      vitalsMax: { hp: 14, san: 55, mp: 10 },
      initiative: 'reactive',
      alive: true,
      present: true,
      met: true,
      bond: '旧识',
      agenda: '想找回女儿',
      secret: '他知道谁放的火',
      appearance: '花白络腮胡，右腿有点跛',
      portrait: 'data:image/png;base64,AAAA',
      fromModule: true,
    },
  ],
  inventory: [
    { id: 'i-1', name: '黄铜钥匙', qty: 2, weight: 1, desc: '冰凉', kind: 'tool', note: '船长的' },
    { id: 'i-2', name: '柯尔特左轮', qty: 1, weight: 2, kind: 'weapon', damage: '1d10', skill: '射击（手枪）' },
  ],
  flags: { 中毒: true, 中毒轮数: 2, 世界: { 欠了船长一个人情: true } },
  clues: ['灯塔的钥匙', '被烧掉的航海日志'],
  threads: [{ name: '找回失踪的渔民', status: '刚接下的委托' }],
  location: '码头7号仓库',
  visited: ['码头7号仓库', '灯塔'],
  npcsAlive: ['汉克', '码头工头'],
  npcNotes: { 汉克: { role: '灯塔看守', note: '左手指节有老茧', met: 3, seen: 7 } },
  wounds: [{ id: 'w-1', text: '左臂被划开的口子', tier: 'severe', turns: 2 }],
  encountered: ['雾中的巨影'],
  fought: ['雾中的巨影'],
  actIndex: 1,
  actDetails: { 1: '第二幕：码头夜谈，工头会先动手' },
  carriedFrom: '银月下的灾影',
  clock: clock,
  deadline: { remain: 360, label: '天亮之前' },
  combat: { active: true, round: 4, foes: [{ name: '雾中的巨影', hp: 20, max: 20 }] },
} satisfies GameState;

describe('GameState 字段不变量（P2-10 / G21 家族的第四块，批次 B）', () => {
  it('fixture 覆盖了每一个字段（含后加的 12 个可选字段）', () => {
    // 类型层由 `satisfies` 保证；这里只确认它确实不是空壳
    expect(Object.keys(richGameState).length).toBeGreaterThanOrEqual(22);
  });

  it('migrateSave：每个字段都活着穿过读档', () => {
    const out = migrateSave({ gameState: richGameState });
    const gs = out.gameState as GameState;
    expect(gs, 'migrateSave 后 gameState 整个不见了').toBeTruthy();
    expectNoFieldLost(richGameState, gs, 'migrateSave.gameState');
  });

  it('migrateSave：嵌套结构逐项核对（战斗 / 档案 / 伤口 / 队友）', () => {
    const gs = migrateSave({ gameState: richGameState }).gameState as GameState;
    // 战斗：敌人血量与轮次是引擎的事实，读档不许抹平
    expect(gs.combat).toEqual(richGameState.combat);
    // 档案：稀疏映射的子键不能丢（`seen` 是后加的，最容易被漏）
    expect(gs.npcNotes?.['汉克']).toEqual(richGameState.npcNotes['汉克']);
    // 伤口：引擎的账，读档不许清空或改档位
    expect(gs.wounds).toEqual(richGameState.wounds);
    // 队友：vitalsMax 与 appearance 都是后加的
    expect(gs.companions[0]?.vitalsMax).toEqual(richGameState.companions[0]!.vitalsMax);
    expect(gs.companions[0]?.appearance).toBe(richGameState.companions[0]!.appearance);
    // 物品：weight 是 v4 加的（缺了会被兜底成 1，但已有的值不许被覆盖）
    expect(gs.inventory.find((i) => i.id === 'i-2')?.weight).toBe(2);
  });

  it('migrateSave：只补该补的 —— 旧档形态的默认值齐了，而玩家已有的值没被顶掉', () => {
    const legacy = { gameState: { vitals: { hp: 9 }, flags: { 中毒: true } } };
    const gs = migrateSave(legacy).gameState as GameState;

    // ① 默认值补齐（旧档缺这些键时下游会当 0 / undefined 用，界面上就出怪东西）
    for (const key of [
      'visited',
      'threads',
      'combat',
      'companions',
      'inventory',
      'clues',
      'npcsAlive',
      'wounds',
      'encountered',
      'fought',
    ] as const) {
      expect(Array.isArray(gs[key]) || typeof gs[key] === 'object', `${key} 没被补上`).toBe(true);
    }
    expect(gs.clock).toBeTruthy();
    expect(gs.deadline).toBeDefined();
    expect(gs.flags).toBeDefined();
    expect(typeof gs.dying).toBe('boolean');
    expect(gs.ending).toBeDefined();

    // ② 玩家已有的值不许被默认值顶掉
    expect(gs.vitals.hp).toBe(9);
    expect(gs.flags['中毒']).toBe(true);
  });

  it('migrateSave 是幂等的：迁移两次 == 迁移一次（否则每读一次档就漂一点）', () => {
    const once = migrateSave({ gameState: richGameState }).gameState as GameState;
    const twice = migrateSave({ gameState: once }).gameState as GameState;
    expect(twice).toEqual(once);
  });

  it('演练：少一个键的迁移必须被逮到', () => {
    const leaky = (raw: unknown) => {
      const gs = migrateSave(raw).gameState as GameState;
      const { wounds: _dropped, ...rest } = gs;
      return { gameState: rest } as Partial<SaveFile>;
    };
    const out = leaky({ gameState: richGameState });
    const gs = out.gameState as GameState;
    const lost = Object.keys(richGameState).filter((k) => !(k in gs));
    expect(lost, '少键的迁移必须被"逐键核对"逮到').toContain('wounds');
  });
});
