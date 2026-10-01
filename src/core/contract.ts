/**
 * 机械事实登记表 —— **engine 权威的唯一台账**。
 *
 * ## 为什么要有这个文件（2026-09-30 架构体检的结论）
 *
 * 这个项目出过的反复性缺陷，根因是同一句：
 *
 * > **机械事实没有唯一真源** —— 同一个事实在 `提示词 / 引擎 / UI / 存档` 四处各写一份，
 * > 靠"约定 + 人肉清单"同步；而编译器看不见它们是不是同一件事。
 *
 * 历史上三次上线事故（v0.3.0 白屏、生图必失败、状态不推进）**全都发生在门禁全绿时**：
 * `tsc` 过、上千测试过、构建过 —— 因为**没有一条断言在看"这几层说的是不是同一件事"**。
 * 项目自己在 `docs/协作/协作存档-2026-09.md:1207` 写过同一句：
 *
 * > 骰子/状态的权威在 `core/`，提示词是字符串，UI 是可选回调。**编译器看不见「三处是否同一件事」。**
 *
 * 当时的补救是「接线清单」—— 一份**人肉文档**。人肉清单能提高认真程度，但它本身也是约定，
 * 所以病根没消：`P2-5·边界`（修在另一条腿上）、`P1-3`（纯函数对但没接线）、
 * `P2-3·必现`（MIME 判据两份）都是它的复发形态。
 *
 * ## 这个文件做什么
 *
 * 把"接线清单"从文档变成**机器可读的登记表**，并由 `scripts/check-contract.mjs`
 * 挂进 `npm run build` 逐条核对：每条事实必须
 *
 * 1. **真源真实存在**（声明的文件里确实定义了这个符号）—— 防改名/搬走后静默失效；
 * 2. **写点真实存在**（或显式承认"引擎不管"）—— 防"引擎权威空转"；
 * 3. **提示词锚点真实存在**（`prompt.ts` 里确实有这句话）—— 防提示词与引擎脱节；
 * 4. **有断言钉住**（某个测试文件点名了这条事实、其真源符号或锚点）—— 防"纯函数对但没接线"。
 *
 * 缺口**允许存在**（存量太多，一次补不完），但**棘轮不许增加**：基线记在仓库根
 * `contract-baseline.json`，只许降不许升。要让门禁通过就**修事实或补断言**，不是改基线。
 *
 * ## 怎么加一条事实
 *
 * 照下面 `Fact` 的形状追加一项。`truth.symbol` / `writer.symbol` 必须是**该文件里真的定义了的名字**
 * （脚本与 `tests/contract.test.ts` 都会核对），`anchors` 用**足够独特的短句**，
 * 且必须是 `prompt.ts` 里的**原文子串**（别改成自己的转述）。
 * 新功能落地时**必须**在这里登记 —— 这就是"接线清单填写率 100%"的机器版。
 *
 * ⚠️ 本文件是**纯数据**（零 import、零副作用），所以：
 * - `tests/contract.test.ts` 可以直接 import 它做自检；
 * - `scripts/check-contract.mjs` 可以把它当源码文本读进来 `new Function` 求值，
 *   不需要 TypeScript 编译器就能核对 —— 门禁因此能挂在 `build` 里、零浏览器零网络。
 */

/** 机械事实的分类：玩家身上 / 时间 / 对手 / 世界层 / 输出与存档。 */
export type FactCategory = 'vitals' | 'time' | 'combat' | 'world' | 'output';

/**
 * 一条机械事实。
 *
 * - `truth`  —— 谁说了算（引擎里的真源符号）。`role` 只是给人看的说明。
 * - `prompt` —— 提示词里**教模型的那句话**（原文锚点子串）。模型不照做时，这条就是护栏的依据。
 * - `writer` —— **谁真的把引擎的裁决落到状态上**。`null` = 目前**没有引擎写点**（纯约定），
 *              这类必须同时标 `engineFree: true` 显式承认，因为"提示词在教、引擎没管"正是权威空转的现场。
 * - `visible` —— 玩家在哪看得见（"状态可见"是框架，不是特效）。
 * - `pins`   —— 已有的断言（测试文件 + 它钉的判据）。
 */
export interface Fact {
  id: string;
  category: FactCategory;
  /** 一句话说明这条事实是什么。 */
  what: string;
  truth: { file: string; symbol: string; role: string };
  /**
   * 提示词侧。`{ file, anchors }` = 提示词里必须存在这些原句；
   * **`null` = 这条事实没有提示词侧**（例如图片落盘：玩家点按钮 → App 调接口 → 落盘，
   * 全程不经过模型）。如实写 `null`，别硬凑一个锚点 —— 那是把门禁变成噪音。
   */
  prompt: { file: string; anchors: string[] } | null;
  writer: { file: string; symbol: string } | null;
  visible: string[];
  pins: { file: string; note: string }[];
  /**
   * `true` = 引擎目前**不管**这条（纯约定），因此它天然是缺口。
   * 登记它是为了让它可见，不是为了假装它已经接好。
   */
  engineFree?: boolean;
}

/**
 * 登记表本体。
 *
 * ⚠️ **纯字面量**（没有变量引用、没有函数调用）：`scripts/check-contract.mjs`
 * 会把这段文本抠出来求值来核对，所以这里不许出现任何需要求值上下文的东西。
 */
export const FACT_REGISTRY: Fact[] = [
  {
    id: 'vitals.hp',
    category: 'vitals',
    what: '生命与其它数值条的扣减：必须先掷过检定，引擎才认；没掷就拒掉',
    truth: {
      file: 'src/core/state/gameState.ts',
      symbol: 'applyDeltas',
      role: 'vitals 的加减只有这一条路，拒落与接受都从这里出',
    },
    prompt: {
      file: 'src/orchestrator/prompt.ts',
      anchors: ['要扣 `vitals.` 就得先要检定', '引擎只认这条：没掷过检定的扣减会被'],
    },
    writer: { file: 'src/ui/store.ts', symbol: 'useStore' },
    visible: ['状态变化卡片（describeChanges）', 'CharacterSheet 数值条'],
    pins: [
      { file: 'tests/state.test.ts', note: 'vitals 扣减与授权窗口' },
      { file: 'tests/store.test.ts', note: 'G25/G27 接线：没掷检定，模型扣不动玩家' },
    ],
  },
  {
    id: 'vitals.status',
    category: 'vitals',
    what: '持续负面状态（中毒等）按"一次行动算一次"推进；轮数由引擎记账',
    truth: {
      file: 'src/core/statusEffects.ts',
      symbol: 'tickStatusEffects',
      role: '状态的推进与到期只由它算',
    },
    prompt: {
      file: 'src/orchestrator/prompt.ts',
      anchors: ['持续的负面状态一律写进 flags'],
    },
    writer: { file: 'src/ui/store.ts', symbol: 'useStore' },
    visible: ['statusFlagLines（状态栏与世界页共用）'],
    pins: [
      { file: 'tests/statusEffects.test.ts', note: 'P1-3 接线：状态结算必须真的接线' },
      { file: 'tests/store.test.ts', note: 'N2 接线：一次行动只算一次' },
    ],
  },
  {
    id: 'vitals.wounds',
    category: 'vitals',
    what: '伤口的失血与自愈：按档位定时扣，重伤不自愈',
    truth: {
      file: 'src/core/wounds.ts',
      symbol: 'bleedDelta',
      role: '失血量与自愈时限只在 core/wounds 里算',
    },
    prompt: {
      file: 'src/orchestrator/prompt.ts',
      anchors: ['把 `flags.伤口` 写进状态栏'],
    },
    writer: { file: 'src/ui/store.ts', symbol: 'useStore' },
    visible: ['状态栏伤口档位', 'WorldPanel 剧情标记'],
    pins: [{ file: 'tests/wounds.test.ts', note: '伤口档位与失血' }],
  },
  {
    id: 'vitals.dying',
    category: 'vitals',
    what: '濒死冻结：生命归零当轮不再继续扣血，施救只给一次机会',
    truth: {
      file: 'src/core/state/gameState.ts',
      symbol: 'DYING_FREEZE_REASON',
      role: '濒死那一轮的扣血拒绝理由（引擎说了算）',
    },
    prompt: {
      file: 'src/orchestrator/prompt.ts',
      /**
       * ⚠️ 这条锚点是**条件出现**的：`DYING_NOTE` 只在 `dying: true`（生命归零）时才拼进提示词。
       * 所以 `tests/fullGame.test.ts` 那条"全链路锚点"用例只断普通状态下的锚点；
       * 这一条由 `state.test.ts` 的濒死冻结判据负责。
       */
      anchors: ['濒死'],
    },
    writer: { file: 'src/ui/store.ts', symbol: 'useStore' },
    visible: ['状态变化卡片里的一句理由'],
    pins: [{ file: 'tests/state.test.ts', note: '濒死冻结拒落' }],
  },
  {
    id: 'vitals.sanity',
    category: 'vitals',
    what: '理智（SAN）骤降与临时疯狂的轮数惩罚：有界、不叠加，轮数由引擎记账',
    truth: {
      file: 'src/core/insanity.ts',
      symbol: 'insanityOf',
      role: '临时疯狂的唯一判据（提示文案与检定惩罚同源）',
    },
    prompt: {
      file: 'src/orchestrator/prompt.ts',
      anchors: ['临时疯狂', '引擎会在他检定上吃一段惩罚（有界、不叠加）'],
    },
    writer: { file: 'src/ui/store.ts', symbol: 'useStore' },
    visible: ['状态栏「临时疯狂（还剩 N 轮）」'],
    pins: [{ file: 'tests/insanity.test.ts', note: '疯狂惩罚与轮数' }],
  },
  {
    id: 'time.clock',
    category: 'time',
    what: '故事时钟只由 elapsed 申报推进；clock 不在契约白名单里，模型不许直接改',
    truth: {
      file: 'src/core/clock.ts',
      symbol: 'tickClock',
      role: '时间推进的唯一入口（含玩家申报目标时刻的上下限）',
    },
    prompt: {
      file: 'src/orchestrator/prompt.ts',
      anchors: ['不在白名单里，你别去改它'],
    },
    writer: { file: 'src/ui/store.ts', symbol: 'useStore' },
    visible: ['顶栏时钟', '世界页时钟明细'],
    pins: [{ file: 'tests/clock.test.ts', note: '时钟推进与封顶' }],
  },
  {
    id: 'time.deadline',
    category: 'time',
    what: '期限：已有期限时忽略模型申报；label 由模组 urgency 生成，一处真源',
    truth: {
      file: 'src/core/clock.ts',
      symbol: 'deadlineFromDays',
      role: '期限的构造与折算',
    },
    prompt: {
      file: 'src/orchestrator/prompt.ts',
      anchors: ['deadline_days', '结局与失败条件'],
    },
    writer: { file: 'src/ui/store.ts', symbol: 'useStore' },
    visible: ['顶栏期限条（含到点/归零表述）'],
    pins: [{ file: 'tests/clock.test.ts', note: '期限与归零' }],
  },
  {
    id: 'time.startClock',
    category: 'time',
    what: '开局时刻由模组申报（start_clock），引擎不再写死上午 9:00',
    truth: {
      file: 'src/core/clock.ts',
      symbol: 'normalizeStartClock',
      role: '模组开局时刻的校验与归一',
    },
    prompt: {
      file: 'src/orchestrator/prompt.ts',
      anchors: ['elapsed'],
    },
    writer: { file: 'src/ui/Preparation.tsx', symbol: 'Preparation' },
    visible: ['开团后顶栏时钟'],
    pins: [{ file: 'tests/clock.test.ts', note: '开局时刻归一' }],
  },
  {
    id: 'combat.turn',
    category: 'combat',
    what: '战斗轮次由引擎按"上一拍"推进；模型写的 combat.round 一律忽略（0 是合法轮次）',
    truth: {
      file: 'src/core/state/gameState.ts',
      symbol: 'applyDeltas',
      role: '轮次唯一推进点（不再取模型申报值）',
    },
    prompt: {
      file: 'src/orchestrator/prompt.ts',
      anchors: ['轮次不用你管', '你不要再写 `combat.round`'],
    },
    writer: { file: 'src/ui/store.ts', symbol: 'useStore' },
    visible: ['战斗横幅「第 N 轮」'],
    pins: [{ file: 'tests/state.test.ts', note: 'G1 轮次取引擎上一拍' }],
  },
  {
    id: 'combat.end',
    category: 'combat',
    what: '战斗收场：敌人死光/被 remove 即收场；空场不许 active=true',
    truth: {
      file: 'src/core/state/gameState.ts',
      symbol: 'applyDeltas',
      role: 'combat.active 与 foes 的收口归一',
    },
    prompt: {
      file: 'src/orchestrator/prompt.ts',
      anchors: ['提前**结束战斗', '不要写任何 `combat.foes dec`'],
    },
    writer: { file: 'src/ui/store.ts', symbol: 'useStore' },
    visible: ['战斗横幅消失'],
    pins: [{ file: 'tests/state.test.ts', note: 'G24 反面：空场必须关战斗' }],
  },
  {
    id: 'combat.foes',
    category: 'combat',
    what: '敌人血量只有一个真源：同名 add 取 min、max 不缩，绝不回血',
    truth: {
      file: 'src/core/state/gameState.ts',
      symbol: 'applyDeltas',
      role: 'foes 的新增/扣血/移除都从这里过',
    },
    prompt: {
      file: 'src/orchestrator/prompt.ts',
      anchors: ['敌人的血量要走 combat.foes'],
    },
    writer: { file: 'src/ui/store.ts', symbol: 'useStore' },
    visible: ['图鉴血量', '战斗横幅敌人数'],
    pins: [{ file: 'tests/state.test.ts', note: 'P2-7 同名取 min，不回血' }],
  },
  {
    id: 'items.consumable',
    category: 'world',
    what: '消耗品按数量扣，扣到 0 从背包消失；模型只管申报、数量由引擎算',
    truth: {
      file: 'src/core/state/gameState.ts',
      symbol: 'applyDeltas',
      role: 'inventory 的 add/dec/remove 唯一入口',
    },
    prompt: {
      file: 'src/orchestrator/prompt.ts',
      anchors: ['用掉的东西按数量扣一处 state_delta'],
    },
    writer: { file: 'src/ui/store.ts', symbol: 'useStore' },
    visible: ['背包页数量'],
    pins: [{ file: 'tests/items.test.ts', note: '消耗与归零移除' }],
  },
  {
    id: 'items.weapon',
    category: 'world',
    what: '武器不是消耗品：不许因为"用了一次"就扣掉；用武器检定前必须真有这件武器',
    truth: {
      file: 'src/core/skills.ts',
      symbol: 'requiredWeaponFor',
      role: '武器需求与缺件判据（界面与引擎共用一处）',
    },
    prompt: {
      file: 'src/orchestrator/prompt.ts',
      anchors: ['武器本身不是消耗品', '绝不要因为"玩家用了一次"就把武器扣掉'],
    },
    writer: { file: 'src/ui/CharacterSheet.tsx', symbol: 'CharacterSheet' },
    visible: ['检定面板的缺件提示'],
    pins: [{ file: 'tests/state.test.ts', note: '武器不被当消耗品扣掉' }],
  },
  {
    id: 'world.carryFlags',
    category: 'world',
    what: '跨局标记：只有带 `世界.` 前缀的 flags 才带过局，其余留在本局',
    truth: {
      file: 'src/core/campaign.ts',
      symbol: 'carriedFlags',
      role: '世界层的唯一搬运口（白名单=前缀）',
    },
    prompt: {
      file: 'src/orchestrator/prompt.ts',
      anchors: ['键名要带 `世界.` 前缀'],
    },
    writer: { file: 'src/ui/store.ts', symbol: 'useStore' },
    visible: ['开团 toast「接上了《X》上次的事」'],
    pins: [
      { file: 'tests/campaign.test.ts', note: '前缀才带过局' },
      { file: 'tests/prompt.test.ts', note: '提示词前缀与代码常量一致' },
    ],
  },
  {
    id: 'world.cast',
    category: 'world',
    what: '在场人物 npcsAlive 是"界面在地人物 + 检定可选对象"的唯一来源',
    truth: {
      file: 'src/core/state/gameState.ts',
      symbol: 'applyDeltas',
      role: 'npcsAlive 的唯一写点',
    },
    prompt: {
      file: 'src/orchestrator/prompt.ts',
      anchors: ['它是两样东西的唯一来源'],
    },
    writer: { file: 'src/ui/store.ts', symbol: 'useStore' },
    visible: ['世界页在地人物', '检定面板对象候选'],
    pins: [{ file: 'tests/state.test.ts', note: 'npcsAlive 增删' }],
  },
  {
    id: 'output.ending',
    category: 'output',
    what: '结档只有一个出口：引擎写 ending（at 为 ISO 串），App 侧统一再去要一段结局正文',
    truth: {
      file: 'src/core/state/gameState.ts',
      symbol: 'applyDeltas',
      role: 'ending 的唯一写点',
    },
    prompt: {
      file: 'src/orchestrator/prompt.ts',
      anchors: ['宣告结局（可选键 `ending`）'],
    },
    writer: { file: 'src/ui/App.tsx', symbol: 'App' },
    visible: ['结档页', '顶栏「终幕 · 结档」'],
    pins: [
      { file: 'tests/state.test.ts', note: 'ending 形状与两次归零' },
      { file: 'tests/export.test.ts', note: '结档导出' },
    ],
  },
  {
    id: 'output.contract',
    category: 'output',
    what: '输出契约：模型只交 JSON 契约，数值由引擎算；超预算从尾砍但契约段永不删',
    truth: {
      file: 'src/orchestrator/prompt.ts',
      symbol: 'OUTPUT_CONTRACT',
      role: '契约文本的唯一真源',
    },
    prompt: {
      file: 'src/orchestrator/prompt.ts',
      /**
       * 这条锚点取的是 `OUTPUT_CONTRACT` 正文里的原句（契约块永远进提示词，
       * 因为它被列在"保护段"里 —— 超预算砍序也砍不到它）。
       */
      anchors: ['JSON 块必须是回复的最后一部分'],
    },
    writer: { file: 'src/ui/store.ts', symbol: 'useStore' },
    visible: ['（不直接可见）出问题会以"没算数"提示玩家'],
    pins: [
      { file: 'tests/prompt.test.ts', note: '契约文本与红线' },
      { file: 'tests/promptBudget.test.ts', note: '超预算砍序，契约段保命' },
    ],
  },
  {
    id: 'output.save',
    category: 'output',
    what: '存档：版本迁移只认 SAVE_VERSION；可选新增字段不升版本，替换/重命名才升',
    truth: {
      file: 'src/ui/state/loaders.ts',
      symbol: 'SAVE_VERSION',
      role: '存档版本真源',
    },
    prompt: {
      file: 'src/orchestrator/prompt.ts',
      anchors: ['当前状态（唯一真相，以这里为准）'],
    },
    writer: { file: 'src/ui/store.ts', symbol: 'flushSaves' },
    visible: ['设置页数据与存档', '导入失败时的可见提示'],
    pins: [{ file: 'tests/persist.test.ts', note: '存档往返与迁移' }],
  },
  {
    id: 'output.image_store',
    category: 'output',
    what: '立绘/配图落盘闸门：只认自包含图片（data:image 或同源 http），MIME 按魔数定',
    truth: {
      file: 'src/core/imageData.ts',
      symbol: 'isSelfContainedImage',
      role: '导出/界面/落盘三处共用的唯一判据',
    },
    /*
     * ⚠️ `prompt: null` —— **这条事实没有提示词侧**。
     *
     * 图片链路不经过模型：「玩家点按钮 → App 调生图接口 → 落盘」。
     * `prompt.ts` 里**一个字都没提图片**（图片提示词在 `orchestrator/generate.ts`）。
     * 于是它的正确性只能靠**落盘闸门自己的断言**守：
     * `isSelfContainedImage` + 按魔数定 MIME —— `P2-3·必现`（4/4 复现）的根因就在这儿。
     */
    prompt: null,
    writer: { file: 'src/ui/store.ts', symbol: 'useStore' },
    visible: ['立绘框', '生图队列徽标与失败提示'],
    pins: [{ file: 'tests/imageData.test.ts', note: '数据与魔数判据' }],
  },
  {
    id: 'output.storage_adapter',
    category: 'output',
    what: '写盘只有一个入口：全 src 里只有 ui/state/storage.ts 碰 localStorage',
    truth: {
      file: 'src/ui/state/storage.ts',
      symbol: 'writeLocal',
      role: '唯一写档口（readLocal / writeLocal / removeLocal）',
    },
    prompt: null,
    writer: { file: 'src/ui/store.ts', symbol: 'flushSaves' },
    visible: ['（不直接可见）存档/配置能不能活过刷新就靠它'],
    pins: [
      { file: 'tests/contract.test.ts', note: '写档口唯一性（扫全 src）' },
      { file: 'tests/persist.test.ts', note: '存档往返' },
    ],
  },
  {
    id: 'output.save_version',
    category: 'output',
    what: '存档版本迁移：可选新增字段不升版本，替换/重命名才升；读档时补默认值',
    truth: {
      file: 'src/ui/state/loaders.ts',
      symbol: 'SAVE_VERSION',
      role: '存档版本真源',
    },
    prompt: null,
    writer: { file: 'src/ui/state/loaders.ts', symbol: 'migrateSave' },
    visible: ['设置页数据与存档（导入旧档能否读出来）'],
    pins: [{ file: 'tests/store.test.ts', note: 'migrateSave 与 merge* 的默认值补齐' }],
  },
  {
    id: 'output.delta_roots',
    category: 'output',
    what:
      'state_delta 目标白名单：可写 / 自由字段 / 引擎独占三份清单只在 core/state/gameState.ts 声明一处；' +
      '提示词由派生串自动带上，可写根必须有专属处理分支',
    truth: {
      file: 'src/core/state/gameState.ts',
      symbol: 'ALLOWED_ROOTS',
      role:
        '由 MODEL_WRITABLE_ROOTS + FREE_FIELD_ROOTS 派生；ENGINE_ONLY_ROOTS 是禁入清单（含 wounds）',
    },
    prompt: {
      file: 'src/orchestrator/prompt.ts',
      /**
       * ⚠️ 锚点特意选**不经插值**的原句：白名单正文现在是
       * `允许的 target 前缀只有：${MODEL_WRITABLE_TARGET_TEXT}`，
       * 拿它当锚点会让门禁在源码文本里找不到（源码里是 `location.` 之类都不存在）。
       * 而"引擎会拒并说明原因"这句是稳定的人话，且它正是**模型走错根时唯一的自救线索**。
       */
      anchors: ['名单之外的根一律会被**拒掉并告诉你原因**'],
    },
    writer: { file: 'src/core/state/gameState.ts', symbol: 'applyDeltas' },
    visible: ['状态变化卡片里的「不允许修改的路径根：xxx —— <该怎么办>」'],
    pins: [
      { file: 'tests/contract.test.ts', note: '引擎↔提示词白名单双向一致 / 可写根必须有归宿 / 无重叠' },
      { file: 'tests/state.test.ts', note: '路径根拒绝与各分支行为' },
    ],
  },
];

/** 所有登记的事实 id（供自检与脚本使用）。 */
export function factIds(): string[] {
  return FACT_REGISTRY.map((f) => f.id);
}

/** 按分类取事实。 */
export function factsByCategory(category: FactCategory): Fact[] {
  return FACT_REGISTRY.filter((f) => f.category === category);
}

/** 目前**没有引擎写点**的事实（纯约定，天然缺口）。 */
export function engineFreeFacts(): Fact[] {
  return FACT_REGISTRY.filter((f) => f.writer === null || f.engineFree === true);
}

/** 所有被登记的真源符号（`文件:符号`），用于核对真源是否真的定义。 */
export function truthSymbols(): { file: string; symbol: string }[] {
  return FACT_REGISTRY.map((f) => ({ file: f.truth.file, symbol: f.truth.symbol }));
}

/** 所有提示词锚点（`prompt: null` 的事实没有提示词侧，跳过）。 */
export function promptAnchors(): string[] {
  return FACT_REGISTRY.flatMap((f) => f.prompt?.anchors ?? []);
}

/** 明确登记为"没有提示词侧"的事实（prompt 链路根本不经过模型的那种）。 */
export function promptFreeFacts(): Fact[] {
  return FACT_REGISTRY.filter((f) => f.prompt === null);
}
