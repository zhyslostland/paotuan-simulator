/**
 * 测试沙盒（开发者模式）。
 *
 * 为什么要这个：测一个功能之前要先建角色、想模组、跑几轮剧情，
 * 每次都从头来一遍，光是准备工作就比要测的东西还久——结果就是懒得测、问题拖到上线才被发现。
 *
 * 这里提供「一键把环境摆好」的几个按钮：
 * 灌一套完整可玩的测试局、切换脚本化模组、把背包塞满、把数值调到濒死/归零、直接触发结档。
 * **一切都写在本地，不发任何请求，也不依赖 API Key。**
 */
import { useState } from 'react';
import {
  useStore,
  defaultCharacteristics,
  type Companion,
  type ModuleItem,
} from './store';
import { createInitialState } from '../core/state/gameState.js';
import { getRuleset } from '../core/rulesets/index.js';

const uid = (p = 't') => `${p}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;

/** 模组常量是只读的，拷一份可变副本再写进 store */
const cloneNodes = (m: { mapNodes: readonly { name: string; links: readonly string[]; note: string }[] }) =>
  m.mapNodes.map((n) => ({ name: n.name, links: [...n.links], note: n.note }));

/** 三套脚本化测试模组：覆盖解谜 / 战斗 / 长篇三种节奏 */
const SCRIPTED_MODULES = {
  puzzle: {
    title: '【测试】灯塔第七夜',
    premise:
      '测试用解谜模组：海雾里的小镇，灯塔已经六夜不亮。你要在第七夜之前查明守塔人去了哪里。',
    goal: '查清守塔人失踪的真相，并让灯塔重新亮起来',
    stakes: '第七夜之前灯塔不亮，返航的渔船会撞上礁石',
    urgency: '第六夜已经过去，你只剩今天一个白天',
    truth: '守塔人发现有人在塔下走私，被扣在货舱里；走私犯每晚熄灯是为了卸货。',
    startLocation: '码头',
    locations: '码头\n守塔人的小屋\n灯塔\n镇上的杂货铺\n礁石滩',
    mapNodes: [
      { name: '码头', links: ['杂货铺'], note: '停着几条渔船' },
      { name: '杂货铺', links: ['码头', '守塔人的小屋'], note: '老板娘什么都知道' },
      { name: '守塔人的小屋', links: ['杂货铺', '灯塔'], note: '门锁着' },
      { name: '灯塔', links: ['守塔人的小屋', '礁石滩'], note: '灯是灭的' },
      { name: '礁石滩', links: ['灯塔'], note: '退潮后有脚印' },
    ],
    npcs: [
      { id: uid('npc'), name: '老板娘', role: '杂货铺老板', motive: '想知道到底出了什么事', secret: '她给走私犯送过饭' },
      { id: uid('npc'), name: '老周', role: '渔民', motive: '保住自己的船', secret: '他看见过卸货但没敢说' },
    ],
    clueChain: '灯灭了 → 守塔人不在 → 小屋有打斗痕迹 → 礁石滩的脚印 → 货舱',
    acts: '第一幕：走访码头与杂货铺；第二幕：进小屋找痕迹；第三幕：礁石滩与货舱对峙',
    endings: '成功：救出守塔人并点亮灯塔；失败：第七夜船撞礁；灰色：救了人但走私犯跑了',
    scale: 'short' as const,
    items: [
      { id: uid('item'), name: '生锈的钥匙', look: '从守塔人门口的垫子下找到', effect: '能打开小屋的门；撬不动别的锁', kind: 'tool' as const },
      { id: uid('item'), name: '备用灯油', look: '杂货铺货架最底下的一桶', effect: '给灯塔的灯加满油，可让它亮一整夜', kind: 'consumable' as const },
      { id: uid('item'), name: '湿透的账本', look: '礁石滩上捡到的', effect: '记着走私的日期与数量，可用来逼问老周', kind: 'clue' as const },
    ] as ModuleItem[],
  },
  combat: {
    title: '【测试】货舱里的东西',
    premise: '测试用战斗模组：你被反锁在一条货船的货舱里，舱门后面有东西在动。',
    goal: '活着离开货舱，并弄清船上运的是什么',
    stakes: '被关在这里，没人知道你上过这条船',
    urgency: '船正在离港，最多四十分钟就出海了',
    truth: '货舱里运的是走私的活体，押运的人把你当成来收货的人一起锁了进来。',
    startLocation: '货舱',
    locations: '货舱\n狭窄的通道\n机舱\n甲板',
    mapNodes: [
      { name: '货舱', links: ['通道'], note: '黑，有腥味' },
      { name: '通道', links: ['货舱', '机舱'], note: '只容一人通过' },
      { name: '机舱', links: ['通道', '甲板'], note: '噪音巨大' },
      { name: '甲板', links: ['机舱'], note: '风很大，岸边已经远了' },
    ],
    npcs: [
      { id: uid('npc'), name: '押运员', role: '船上的打手', motive: '把货送到', secret: '他自己也怕舱里的东西' },
    ],
    clueChain: '舱里有动静 → 找到出口 → 通道尽头的血迹 → 机舱的求救信号 → 甲板',
    acts: '第一幕：摸清货舱；第二幕：通道遭遇；第三幕：甲板脱身',
    endings: '成功：跳船逃生；失败：随船出海；灰色：逃了但货也沉了',
    scale: 'short' as const,
    items: [
      { id: uid('item'), name: '撬棍', look: '货舱角落里的一根铁棍', effect: '撬开卡死的舱门；本应失败的尝试可再来一次', kind: 'tool' as const },
      { id: uid('item'), name: '消防斧', look: '挂在舱壁上的', effect: '伤害 1d8+2，格斗（斗殴）', kind: 'weapon' as const },
    ] as ModuleItem[],
  },
  long: {
    title: '【测试】雨季结束之前',
    premise:
      '测试用长篇模组：一座终年下雨的山城，接连有人"走进雾里再没回来"。这件事拖了两个月，雨季还有二十三天结束。',
    goal: '查清雾里到底是什么，并在雨季结束前带回一个活人',
    stakes: '雨季一结束，山下的村子就会断水，而雾会跟着水一起下来',
    urgency: '下一次满月还有二十三天，那是雨季结束的日子',
    truth: '山上的旧水库里沉着一座被淹没的村子，雾是水在找它原来的路。',
    startLocation: '山城的旅店',
    locations: '山城的旅店\n旧水库\n淹没的村子（传说）\n水务局\n山道\n雾里的茶棚\n村子的祠堂\n水文站的旧办公室',
    mapNodes: [
      { name: '山城的旅店', links: ['水务局', '山道'], note: '住着三个外来的调查者' },
      { name: '水务局', links: ['山城的旅店'], note: '档案室不对陌生人开放' },
      { name: '山道', links: ['山城的旅店', '旧水库', '雾里的茶棚'], note: '一下雨就塌方' },
      { name: '旧水库', links: ['山道', '水文站的旧办公室'], note: '水位比记录上低了一大截' },
      { name: '雾里的茶棚', links: ['山道'], note: '只在起雾时出现' },
      { name: '水文站的旧办公室', links: ['旧水库'], note: '墙上贴着一九七八年的水位图' },
      { name: '淹没的村子', links: ['旧水库'], note: '传说里在水库底下' },
      { name: '村子的祠堂', links: ['淹没的村子'], note: '只有退水时才露出来' },
    ],
    npcs: [
      { id: uid('npc'), name: '水务局的老陈', role: '档案员', motive: '保住自己的退休金', secret: '他改过水位记录' },
      { id: uid('npc'), name: '茶棚的老板娘', role: '不知道活了多久的人', motive: '让人别往上走', secret: '她是当年村里唯一没搬走的人' },
      { id: uid('npc'), name: '外来的调查者', role: '同行', motive: '抢先一步', secret: '他手上有一张真的水位图' },
    ],
    clueChain:
      '有人走进雾里 → 水务局的档案缺了几年 → 老陈改过记录 → 茶棚老板娘认得旧村的人 → 水位比记录低 → 退水后祠堂露出来 → 水库底下',
    acts:
      '第一章：落脚山城，摸清失踪的规律（走访旅店与水务局）\n' +
      '第二章：档案与旧图（老陈、外来的调查者；世界变化：雨停了一天，山道可以走了）\n' +
      '第三章：雾里的茶棚（老板娘开口；世界变化：又有两个人失踪，水务局开始封山）\n' +
      '第四章：退水（水位图应验，祠堂露出来；世界变化：雨停了三天，山下的水开始变浑）\n' +
      '第五章：水库（终局；世界变化：雨季结束，雾开始下山）',
    endings: '成功：带回活人并封住水库；失败：雨季结束，雾跟着水下山；灰色：人带回来了，但山城空了',
    scale: 'long' as const,
    items: [
      { id: uid('item'), name: '一九七八年的水位图', look: '从旧办公室墙上揭下来的', effect: '能推算出下一次退水的日期与时间', kind: 'clue' as const },
      { id: uid('item'), name: '铜钥匙', look: '祠堂门槛下挖出来的', effect: '能打开水文站旧办公室的抽屉', kind: 'tool' as const },
      { id: uid('item'), name: '干粮三份', look: '旅店给的', effect: '每份恢复 1d4 生命，只在休整时可用', kind: 'consumable' as const },
      { id: uid('item'), name: '铜锣', look: '祠堂里的旧物', effect: '在雾里敲响，能让人循声走回来一次', kind: 'tool' as const },
    ] as ModuleItem[],
  },
} as const;

/**
 * 一套完整可玩的测试局。
 * 摆出来的东西刻意"什么都有"：地图、道具、队友候选、世界书、支线、快照锚点、待掷队列、背包各类物品。
 */
function fillTestSave() {
  const s = useStore.getState();
  const rs = getRuleset(s.rulesetId);
  const mod = SCRIPTED_MODULES.puzzle;

  s.setCharacter({
    name: '测试员',
    gender: '女',
    description: '测试用角色：三十岁上下，穿着不合身的雨衣，口袋里塞满了没用的收据。',
    personality: '谨慎、话少，遇到说不通的事一定要弄明白。',
    characteristics: defaultCharacteristics(s.rulesetId),
    skills: Object.fromEntries(
      (rs.starterSkills ?? []).slice(0, 6).map((sk) => [sk.name, sk.value])
    ),
    items: ['笔记本', '.38 左轮手枪', '手电筒'],
    itemDetails: [
      { name: '笔记本', desc: '测试用：记着两页看不懂的数字。', kind: 'clue' },
      {
        name: '.38 左轮手枪',
        desc: '测试用：六发装填。',
        kind: 'weapon',
        damage: '1d10',
        skill: '射击（手枪）',
      },
      { name: '手电筒', desc: '测试用：光照三米。', kind: 'tool' },
    ],
  });

  s.setModule({
    title: mod.title,
    premise: mod.premise,
    opening: '',
    startLocation: mod.startLocation,
    goal: mod.goal,
    stakes: mod.stakes,
    urgency: mod.urgency,
    truth: mod.truth,
    locations: mod.locations,
    mapNodes: cloneNodes(mod),
    npcs: mod.npcs.map((n) => ({ ...n })),
    clueChain: mod.clueChain,
    acts: mod.acts,
    endings: mod.endings,
    notes: '测试用模组。',
    scale: mod.scale,
    items: mod.items.map((i) => ({ ...i })),
  });

  s.startNewGame();

  // 背包各类物品各来一件，测「使用 / 扣数量 / 无可用武器」
  s.applyModelDeltas([
    { target: 'inventory', op: 'add', value: { name: '撬棍', desc: '测试用：撬开卡死的东西。', kind: 'tool' } },
    { target: 'inventory', op: 'add', value: { name: '止血绷带', desc: '测试用：止住一次流血，生命 +1d4。', kind: 'consumable', qty: 3 } },
    { target: 'inventory', op: 'add', value: { name: '湿透的账本', desc: '测试用：记着走私的日期。', kind: 'clue' } },
    { target: 'clues', op: 'add', value: '灯塔第六夜不亮' },
    { target: 'clues', op: 'add', value: '守塔人不在屋里' },
    { target: 'npcsAlive', op: 'add', value: '老板娘' },
    { target: 'threads', op: 'add', value: { name: '守塔人的下落', status: '只知道他不在屋里' } },
    { target: 'threads', op: 'add', value: { name: '为什么熄灯', status: '还没有头绪' } },
  ] as never);

  s.setWorldbookEntries([
    { id: uid('wb'), keys: ['灯塔', '守塔人'], content: '测试用：灯塔建于 1902 年，守塔人姓周。', priority: 60, enabled: true },
    { id: uid('wb'), keys: ['老板娘'], content: '测试用：老板娘的丈夫也是渔民，三年前出了海。', priority: 50, enabled: true },
  ]);

  s.setCompanionCandidates([
    mkCompanion('测试的搭档', '同行的记者'),
    mkCompanion('测试的老周', '本地渔民'),
  ]);

  // 两条待掷检定：测「一次全掷」与「回溯后队列恢复」
  s.setPendingChecks([
    { skill: '侦查', reason: '看看屋里有没有被翻动过' },
    { skill: '图书馆使用', reason: '查查灯塔的记录' },
  ]);

  // 一个关键抉择锚点：测结档页与「关键抉择」区块
  const pid = s.addMessage({ role: 'player', content: '我先去杂货铺问问老板娘。' });
  s.snapshotTurn(pid);
  s.markSnapshotKey(pid, '第1回 · 去杂货铺 · 新线索');
}

function mkCompanion(name: string, role: string): Companion {
  return {
    id: uid('cand'),
    name,
    role,
    personality: '测试用：话不多。',
    skills: {},
    vitals: { hp: 10, san: 50, mp: 10 },
    initiative: 'reactive',
    alive: true,
    present: false,
    met: false,
  };
}

export function TestSandbox({ onClose }: { onClose: () => void }) {
  const [msg, setMsg] = useState('');
  const run = (label: string, fn: () => void) => {
    try {
      fn();
      setMsg(`已执行：${label}`);
    } catch (e) {
      setMsg(`失败：${(e as Error).message}`);
    }
  };

  const btn =
    'rounded-lg border border-ink-600 px-3 py-2 text-left text-[12px] text-mist-300 transition hover:border-gold-600/50 hover:text-mist-100';
  const danger =
    'rounded-lg border border-blood-400/50 px-3 py-2 text-left text-[12px] text-blood-300 transition hover:bg-blood-400/10';

  return (
    <div className="fixed inset-0 z-[70] flex items-end justify-center bg-ink-950/85 p-3 sm:items-center">
      <div className="max-h-[88vh] w-full max-w-md overflow-y-auto rounded-2xl border border-ink-600 bg-ink-900 p-4">
        <div className="flex items-center justify-between">
          <h2 className="font-serif text-[15px] text-mist-100">测试沙盒</h2>
          <button onClick={onClose} className="text-[13px] text-mist-500 hover:text-mist-200">
            ✕
          </button>
        </div>
        <p className="mt-1 text-[10px] leading-relaxed text-mist-500">
          只写本地数据，不发请求、不需要 API Key。测完点「灌入完整测试存档」可随时重来。
        </p>

        <h3 className="mt-3 text-[11px] tracking-wider text-mist-500">一键环境</h3>
        <div className="mt-1.5 grid gap-1.5">
          <button
            className={btn}
            onClick={() => run('灌入完整测试存档', fillTestSave)}
          >
            灌入完整测试存档（角色 + 模组 + 背包 + 队友 + 锚点 + 待掷队列）
          </button>
        </div>

        <h3 className="mt-3 text-[11px] tracking-wider text-mist-500">脚本化模组</h3>
        <div className="mt-1.5 grid gap-1.5">
          <button
            className={btn}
            onClick={() =>
              run('解谜短篇', () => {
                const m = SCRIPTED_MODULES.puzzle;
                useStore.getState().setModule({
                  title: m.title,
                  premise: m.premise,
                  startLocation: m.startLocation,
                  goal: m.goal,
                  stakes: m.stakes,
                  urgency: m.urgency,
                  truth: m.truth,
                  locations: m.locations,
                  mapNodes: cloneNodes(m),
                  npcs: m.npcs.map((n) => ({ ...n })),
                  clueChain: m.clueChain,
                  acts: m.acts,
                  endings: m.endings,
                  scale: m.scale,
                  items: m.items.map((i) => ({ ...i })),
                });
              })
            }
          >
            解谜短篇《灯塔第七夜》（含地图与道具表）
          </button>
          <button
            className={btn}
            onClick={() =>
              run('战斗向', () => {
                const m = SCRIPTED_MODULES.combat;
                useStore.getState().setModule({
                  title: m.title,
                  premise: m.premise,
                  startLocation: m.startLocation,
                  goal: m.goal,
                  stakes: m.stakes,
                  urgency: m.urgency,
                  truth: m.truth,
                  locations: m.locations,
                  mapNodes: cloneNodes(m),
                  npcs: m.npcs.map((n) => ({ ...n })),
                  clueChain: m.clueChain,
                  acts: m.acts,
                  endings: m.endings,
                  scale: m.scale,
                  items: m.items.map((i) => ({ ...i })),
                });
              })
            }
          >
            战斗向《货舱里的东西》
          </button>
          <button
            className={btn}
            onClick={() =>
              run('长篇多日', () => {
                const m = SCRIPTED_MODULES.long;
                useStore.getState().setModule({
                  title: m.title,
                  premise: m.premise,
                  startLocation: m.startLocation,
                  goal: m.goal,
                  stakes: m.stakes,
                  urgency: m.urgency,
                  truth: m.truth,
                  locations: m.locations,
                  mapNodes: cloneNodes(m),
                  npcs: m.npcs.map((n) => ({ ...n })),
                  clueChain: m.clueChain,
                  acts: m.acts,
                  endings: m.endings,
                  scale: m.scale,
                  items: m.items.map((i) => ({ ...i })),
                });
              })
            }
          >
            长篇《雨季结束之前》（分章、二十三天）
          </button>
        </div>

        <h3 className="mt-3 text-[11px] tracking-wider text-mist-500">数值 / 结档</h3>
        <div className="mt-1.5 grid grid-cols-2 gap-1.5">
          <button
            className={btn}
            onClick={() =>
              run('数值回满', () => {
                const s = useStore.getState();
                const rs = getRuleset(s.rulesetId);
                s.applyModelDeltas(
                  rs.vitalDefs.map((v) => ({
                    target: `vitals.${v.key}`,
                    op: 'set',
                    value: v.default,
                  })) as never
                );
              })
            }
          >
            数值回满
          </button>
          <button
            className={btn}
            onClick={() =>
              run('生命置 1（测濒死）', () => {
                useStore
                  .getState()
                  .applyModelDeltas([{ target: 'vitals.hp', op: 'set', value: 1 }] as never);
              })
            }
          >
            生命置 1（濒死）
          </button>
          <button
            className={danger}
            onClick={() =>
              run('生命归零（下一轮结档）', () => {
                const s = useStore.getState();
                s.applyModelDeltas([{ target: 'vitals.hp', op: 'set', value: 0 }] as never);
                // 再动一次触发"濒死 → 死亡"的第二次结算
                s.applyModelDeltas([{ target: 'vitals.hp', op: 'dec', amount: 1 }] as never);
              })
            }
          >
            生命归零 → 结档
          </button>
          <button
            className={danger}
            onClick={() =>
              run('直接结档（测结档页）', () => {
                useStore.getState().forceEnding('death');
                useStore.getState().setEnding(
                  'death',
                  '测试用结局正文：意识一层层退下去，最后剩下的是很远处的声音。故事在这里断了线。'
                );
              })
            }
          >
            直接结档
          </button>
        </div>

        <h3 className="mt-3 text-[11px] tracking-wider text-mist-500">其它</h3>
        <div className="mt-1.5 grid gap-1.5">
          <button
            className={btn}
            onClick={() =>
              run('塞 2 个待掷检定', () => {
                useStore.getState().setPendingChecks([
                  { skill: '侦查', reason: '测试：看看屋里' },
                  { skill: '心理学', reason: '测试：判断他有没有说谎' },
                ]);
              })
            }
          >
            塞 2 个待掷检定（测一次全掷 / 回溯恢复）
          </button>
          <button
            className={btn}
            onClick={() =>
              run('背包塞满各类物品', () => {
                useStore.getState().applyModelDeltas([
                  { target: 'inventory', op: 'add', value: { name: '撬棍', desc: '测试用工具。', kind: 'tool' } },
                  { target: 'inventory', op: 'add', value: { name: '止血绷带', desc: '测试用消耗品。', kind: 'consumable', qty: 3 } },
                  { target: 'inventory', op: 'add', value: { name: '消防斧', desc: '伤害 1d8+2。', kind: 'weapon', damage: '1d8+2', skill: '格斗（斗殴）' } },
                  { target: 'inventory', op: 'add', value: { name: '湿透的账本', desc: '测试用线索物。', kind: 'clue' } },
                ] as never);
              })
            }
          >
            背包塞满各类物品
          </button>
          <button
            className={danger}
            onClick={() =>
              run('回到出厂状态', () => {
                const s = useStore.getState();
                s.startNewGame();
                // 连游戏状态一起重置
                useStore.setState({
                  gameState: createInitialState(),
                  messages: [],
                  chronicle: [],
                  summary: '',
                  snapshots: {},
                  pendingChecks: [],
                });
              })
            }
          >
            回到出厂状态（清掉测试局）
          </button>
        </div>

        {msg && (
          <p className="mt-3 rounded-md border border-ink-600 bg-ink-850 px-2.5 py-1.5 text-[11px] text-mist-300">
            {msg}
          </p>
        )}
      </div>
    </div>
  );
}
