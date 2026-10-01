/**
 * 契约登记表自检 —— 保证「登记表本身」是可信的，而不是又一份会漂的文档。
 *
 * 与 `scripts/check-contract.mjs` 的分工：
 * - 脚本（挂在 `npm run build`）负责**逐条核对真源/提示词/断言是否存在**，并守棘轮；
 * - 这个测试负责**登记表自身的形状**：字段齐全、id 唯一、分类合法、路径真实、
 *   以及"提示词锚点必须能在 `prompt.ts` 里找到"——把门禁的判据也钉进测试，
 *   这样本地 `vitest` 跑一次就能发现登记表写歪了，不必等构建。
 *
 * 为什么要有它：接线清单当年是**文档**，文档会漂（表头写 v1.7.6、真源是 v1.7.12）。
 * 登记表想不漂，就必须自己也被断言钉住。
 */
import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import {
  FACT_REGISTRY,
  factIds,
  factsByCategory,
  truthSymbols,
  promptAnchors,
  type FactCategory,
} from '../src/core/contract.js';

const ROOT = process.cwd();
const CATEGORIES: FactCategory[] = ['vitals', 'time', 'combat', 'world', 'output'];

/** 该文件里是否定义了这个符号（顶层声明、组件、或对象方法/属性都算）。 */
function declaresSymbol(file: string, symbol: string): boolean {
  const src = readFileSync(join(ROOT, file), 'utf8');
  const s = symbol.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  // 属性/方法写法（store 的 action 就是这种）：`symbol(` / `symbol:` / `symbol =`，后面不许再接单词字符，
  // 否则 `useStore` 会被 `useStore((s) => ...)` 这种**调用点**误判成"定义"。
  const asMember = new RegExp(`(?:^|\\n)\\s*(?:async\\s+)?${s}\\s*[(:]`).test(src);
  const asDecl = new RegExp(
    `(?:^|\\n)\\s*(?:export\\s+)?(?:default\\s+)?(?:async\\s+)?(?:function|const|let|class|interface|type|enum)\\s+${s}\\b`
  ).test(src);
  return asMember || asDecl;
}

describe('契约登记表：形状自检', () => {
  it('登记表非空（登记表的立意就是逐条登记机械事实）', () => {
    expect(FACT_REGISTRY.length).toBeGreaterThan(0);
  });

  it('id 唯一，且分类合法', () => {
    const ids = factIds();
    expect(new Set(ids).size).toBe(ids.length);
    for (const f of FACT_REGISTRY) {
      expect(CATEGORIES).toContain(f.category);
      expect(f.what.length).toBeGreaterThan(4);
      expect(f.truth.role.length).toBeGreaterThan(4);
    }
  });

  it('每条事实都有真源文件 + 真源符号', () => {
    for (const f of FACT_REGISTRY) {
      expect(existsSync(join(ROOT, f.truth.file)), `${f.id} 真源文件缺失`).toBe(true);
      expect(f.truth.symbol.length).toBeGreaterThan(1);
    }
  });

  it('提示词侧要么写清锚点、要么如实写 null（空数组＝假装核对过）', () => {
    for (const f of FACT_REGISTRY) {
      if (f.prompt === null) continue; // 明确声明"这条没有提示词侧"
      expect(f.prompt.anchors.length, `${f.id} 的 anchors 是空的`).toBeGreaterThan(0);
      expect(existsSync(join(ROOT, f.prompt.file)), `${f.id} 提示词文件缺失`).toBe(true);
    }
  });

  it('登记的每一处写点都必须在那个文件里真的定义（或显式承认引擎不管）', () => {
    for (const f of FACT_REGISTRY) {
      if (f.writer === null) {
        // 引擎不管的事实必须显式承认，不能靠"忘了填"
        expect(f.engineFree, `${f.id} 既没有写点也没标 engineFree`).toBe(true);
        continue;
      }
      expect(existsSync(join(ROOT, f.writer.file)), `${f.id} 写点文件缺失`).toBe(true);
      expect(
        declaresSymbol(f.writer.file, f.writer.symbol),
        `${f.id} 的写点符号 ${f.writer.symbol} 不在 ${f.writer.file} 里`
      ).toBe(true);
    }
  });

  it('提示词锚点必须真的出现在 prompt.ts 里（防提示词与引擎脱节）', () => {
    const prompt = readFileSync(join(ROOT, 'src/orchestrator/prompt.ts'), 'utf8');
    // 归一：源码里反引号写作转义序列 `\``，粗体是 `'**A' + 'B**'` 拼出来的
    // （字面文本里不连续）→ 两边统一去掉反斜杠、把 `**` 压成 `*` 再比。
    const flat = prompt.split('\\').join('').split('**').join('*');
    const missing = promptAnchors().filter(
      (a) => !flat.includes(a.split('\\').join('').split('**').join('*'))
    );
    expect(missing, `提示词里找不到这些锚点：${missing.join(' | ')}`).toEqual([]);
  });

  it('pins 指向的测试文件必须真实存在', () => {
    for (const f of FACT_REGISTRY) {
      for (const pin of f.pins) {
        expect(existsSync(join(ROOT, pin.file)), `${f.id} → ${pin.file} 不存在`).toBe(true);
      }
    }
  });

  it('每类机械事实至少登记一条（五类都别留空白）', () => {
    for (const c of CATEGORIES) {
      expect(factsByCategory(c).length, `分类 ${c} 一条都没登记`).toBeGreaterThan(0);
    }
  });

  it('真源符号表可导出（门禁脚本按它核对）', () => {
    const syms = truthSymbols();
    expect(syms.length).toBe(FACT_REGISTRY.length);
    for (const s of syms) expect(s.symbol.length).toBeGreaterThan(1);
  });
});

describe('架构边界：迁移不许回潮（阶段 1 的守门）', () => {
  const readSrc = (rel: string) => readFileSync(join(ROOT, rel), 'utf8');

  it('写档口存在，且是全 src 唯一允许碰 localStorage 的文件', () => {
    const adapter = readSrc('src/ui/state/storage.ts');
    for (const fn of ['readLocal', 'writeLocal', 'removeLocal']) {
      expect(adapter, `写档口缺少 ${fn}`).toContain(`export function ${fn}`);
    }
    // 逐个源文件扫：除写档口外，不许出现真实的 localStorage 调用
    const offenders: string[] = [];
    const walk = (dir: string): void => {
      for (const name of readdirSync(join(ROOT, dir))) {
        const rel = `${dir}/${name}`;
        if (name.endsWith('.ts') || name.endsWith('.tsx')) {
          if (rel === 'src/ui/state/storage.ts') continue;
          readSrc(rel)
            .split('\n')
            .forEach((line, i) => {
              const t = line.trim();
              if (t.startsWith('//') || t.startsWith('*') || t.startsWith('/*')) return;
              if (/localStorage\.(getItem|setItem|removeItem)/.test(line)) offenders.push(`${rel}:${i + 1}`);
            });
        } else if (statSync(join(ROOT, rel)).isDirectory()) {
          walk(rel);
        }
      }
    };
    walk('src');
    expect(offenders, `这些地方绕过了写档口：${offenders.join(' / ')}`).toEqual([]);
  });

  it('core 侧不再有 IO：自定义规则包的读盘搬到了 UI 层', () => {
    const core = readSrc('src/core/rulesets/index.ts');
    // 纯注册函数在
    expect(core).toContain('export function registerCustomRulesetsFrom');
    // 旧的自带 IO 的函数名不该再存在（改回去就是"边界回潮"）
    expect(core).not.toContain('export function loadCustomRulesets');
    // 真实调用（注释里提到不算）
    const realCalls = core
      .split('\n')
      .filter((l) => !/^\s*(\/\/|\*|\/\*)/.test(l))
      .filter((l) => /localStorage\s*\./.test(l));
    expect(realCalls, `core 里又出现了 IO：${realCalls.join(' / ')}`).toEqual([]);
  });
});

describe('契约登记表：真源必须真的定义（和门禁同一把尺子）', () => {
  it('每条事实的真源符号都能在它声明的文件里找到', () => {
    const bad = FACT_REGISTRY.filter((f) => !declaresSymbol(f.truth.file, f.truth.symbol)).map(
      (f) => `${f.id} → ${f.truth.file}:${f.truth.symbol}`
    );
    expect(bad).toEqual([]);
  });

  /**
   * 🔥 **脱节演练（这道闸门的"能拦住"证明）** —— 2026-09-30 加。
   *
   * 光有门禁不够：本项目三次上线事故都发生在"门禁全绿"时，所以**门禁本身也必须被证明能红**。
   * 这里用三个必然脱节的用例，证明判据不是又一次摆设：
   *
   * 1. **真源改名** —— 契约还指着老名字（这正是 `store.ts` 减重时最容易发生的：符号搬走了，
   *    调用点靠 re-export 转发照常能跑，于是"真源不在 import 路径上"，谁也发现不了）；
   * 2. **写点消失** —— 引擎权威空转（`P1-3` 的现场：纯函数在、没人调）；
   * 3. **提示词改了说法** —— 引擎只认 B，提示词还在教 A。
   *
   * ⚠️ 这三个用例是**故意的反例**，不能改成"通过"；它们是闸门的拦截力证据。
   */
  describe('脱节演练：闸门必须能红', () => {
    it('真源符号改了名 → 判为脱节', () => {
      expect(declaresSymbol('src/core/clock.ts', 'tickClockRENAMED_2099')).toBe(false);
    });

    it('写点符号不存在 → 判为脱节（引擎权威空转）', () => {
      expect(declaresSymbol('src/ui/store.ts', 'tickStatusEffectsNEVER_CALLED')).toBe(false);
    });

    it('提示词锚点被改掉 → 判为脱节（提示词与引擎各说一套）', () => {
      const prompt = readFileSync(join(ROOT, 'src/orchestrator/prompt.ts'), 'utf8').split('\\').join('');
      expect(prompt.includes('这条判据已经被删掉了_2099')).toBe(false);
    });

    it('真源实际存在时不能误报（否则闸门会变成噪音）', () => {
      expect(declaresSymbol('src/core/clock.ts', 'tickClock')).toBe(true);
      expect(declaresSymbol('src/ui/store.ts', 'useStore')).toBe(true);
    });
  });
});

/**
 * 🔴 **目标白名单不许分叉 / 不许是空头支票** —— 2026-09-30 基础完善（批次 A）。
 *
 * ## 立这组断言时抓到的两个真实缺陷
 *
 * 1. **引擎有、提示词没有**：`ALLOWED_ROOTS` 里有 `wounds`，而 `prompt.ts:521` 那份手写的
 *    "允许的 target 前缀"列表里**没有它** —— 与 `P2-10` 同形态：**同一份事实两处各写一遍**。
 * 2. **白名单里有、引擎却没有处理分支**（比第一条更严重）：`applyDeltas` 里
 *    **没有任何 `wounds` 分支**，所以模型写 `{target:'wounds', op:'set', value:[...]}` 会
 *    落到「自由字段：flags / npcsAlive」那个兜底分支 → **直接把伤口数组写进状态**，
 *    绕过 `core/wounds.ts` 的档位与流失量真源。即：**白名单上写着"模型可以写"，
 *    而引擎其实"只会照抄"。**
 *
 * 判据因此分成三条，各管一种分叉：
 * - **双向**：提示词里出现每一个 `MODEL_WRITABLE_ROOTS`；且**不出现**任何 `ENGINE_ONLY_ROOTS`；
 * - **不空转**：`MODEL_WRITABLE_ROOTS` 里每个根，都必须在 `applyDeltas` 里有**专属分支**
 *   或落在**明确的自由字段白名单**里 —— 否则就是"接受了却没人处理"；
 * - **不重叠**：两份清单不许有交集（同一个根不能两处声明）。
 *
 * ⚠️ 这几条是**源码级判据**（读文本、找 `root === 'x'` 与声明列表），刻意不依赖 TS 类型：
 * 因为要防的正是"类型对、文本分叉"这类事故。
 */
describe('引擎 ↔ 提示词：目标白名单不许分叉（批次 A 的守门）', () => {
  /** 引擎侧声明的三份清单（从源码文本里抽，避免循环 import 也避免"只信类型"）。 */
  const readEngineLists = (): {
    writable: string[];
    engineOnly: string[];
    freeField: string[];
    rootBranches: Set<string>;
  } => {
    const src = readFileSync(join(ROOT, 'src/core/state/gameState.ts'), 'utf8');
    /**
     * 抠出某个清单常量里的字符串项。
     *
     * ⚠️ 必须**从声明位**开始找，不能 `indexOf(常量名)` —— 上面那段文档表格里
     * 也写着这几个常量名，第一次实现就是这么被自己的文档骗了（`writable` 与
     * `engineOnly` 抠出了同一份列表，于是"重叠"那条跟着误报）。
     */
    const grab = (constName: string): string[] => {
      const decl = new RegExp(`const\\s+${constName}\\s*=\\s*\\[`);
      const m = decl.exec(src);
      expect(m, `gameState.ts 里找不到 ${constName} 的数组声明`).not.toBeNull();
      const from = m!.index + m![0].length - 1;
      let depth = 0;
      let to = from;
      for (let i = from; i < src.length; i += 1) {
        if (src[i] === '[') depth += 1;
        else if (src[i] === ']') {
          depth -= 1;
          if (depth === 0) {
            to = i;
            break;
          }
        }
      }
      const body = src.slice(from, to);
      return [...body.matchAll(/'([A-Za-z][\w]*)'/g)].map((x) => x[1]!);
    };
    const rootBranches = new Set(
      [...src.matchAll(/root === '([A-Za-z][\w]*)'/g)].map((m) => m[1]!)
    );
    return {
      writable: grab('MODEL_WRITABLE_ROOTS'),
      engineOnly: grab('ENGINE_ONLY_ROOTS'),
      freeField: grab('FREE_FIELD_ROOTS'),
      rootBranches,
    };
  };

  /**
   * ⚠️ 判据查的是**真实构造出来的提示词**，不是 `prompt.ts` 的源码文本。
   *
   * 为什么（我第一版就栽这儿）：白名单那段现在写成 `${MODEL_WRITABLE_TARGET_TEXT}` 插值，
   * 源码文本里根本没有 `location.` 这种字面量 —— 查源码只会得到**假红**。
   * 而"玩家那一局实际发出去的提示词"才是要保证的东西（与 `fullGame.test.ts` 口径一致）。
   */
  const buildPromptForCheck = async (): Promise<string> => {
    const { buildSystemPrompt } = await import('../src/orchestrator/prompt.js');
    const { getRuleset } = await import('../src/core/rulesets/index.js');
    const { createInitialState } = await import('../src/core/state/gameState.js');
    return buildSystemPrompt({
      rulesetName: getRuleset('coc7').name,
      ruleset: getRuleset('coc7'),
      genre: { id: 'coc', name: '克苏鲁', blurb: '', setting: '', tone: '', imageStyle: '', castHint: '' },
      module: {
        title: 't', premise: '', opening: '', truth: '', npcs: [], locations: '',
        clueChain: '', acts: '', endings: '', notes: '',
      },
      character: {
        name: '甲', description: '', personality: '', mes_example: '',
        characteristics: { str: 50 }, skills: { 侦查: 50 },
      },
      playerAddress: '甲先生',
      gameState: createInitialState({ vitals: { hp: 10, san: 60, mp: 10 }, location: '走廊' }),
      worldbook: [],
      chronicle: [],
    } as never);
  };

  it('提示词里出现**每一个**可写根（今天 `wounds` 就缺着）', async () => {
    const { writable } = readEngineLists();
    expect(writable.length).toBeGreaterThan(8);
    // 展示串写法是 `vitals.` / `combat.foes` / `inventory / flags.`，所以判据只要求
    // "这个根后面不再接单词字符"（`inventory` 后面可能是 `.` `/` `、` 或行尾）
    const prompt = await buildPromptForCheck();
    const missing = writable.filter((r) => !new RegExp(`${r}(?![\\w])`).test(prompt));
    expect(missing, `提示词里没提这些根（引擎却允许模型写）：${missing.join(', ')}`).toEqual([]);
  });

  it('提示词里**不教模型去写**引擎独占的根（防"只由引擎写"的规则倒退回提示词）', async () => {
    const { engineOnly } = readEngineLists();
    expect(engineOnly.length).toBeGreaterThan(2);
    const prompt = await buildPromptForCheck();
    /*
     * ⚠️ 判据是"**教它写**"，不是"提到这个词"。
     * 反例（必须放过）：提示词里写着「`clock`（故事时钟）不在白名单里，你别去改它」——
     * 那是**阻止**模型写，属于好话。所以只在**契约书写形态**里找该根：
     * `"target": "clock…`（JSON 示例里 target 一定带引号）。
     */
    const leaked = engineOnly.filter((r) =>
      new RegExp(`target["'\`]?\\s*[:=]\\s*["'\`]?${r}[.\\"'\`]`).test(prompt)
    );
    expect(leaked, `提示词在教模型写引擎独占的根：${leaked.join(', ')}`).toEqual([]);
  });

  it('可写根在 applyDeltas 里必须有归宿：专属分支，或明确的自由字段白名单', () => {
    const { writable, freeField, rootBranches } = readEngineLists();
    const orphans = writable.filter((r) => !rootBranches.has(r) && !freeField.includes(r));
    expect(
      orphans,
      '这些根在白名单里、引擎却没有处理分支（会掉进兜底分支被"照抄"）：' + orphans.join(', ')
    ).toEqual([]);
  });

  it('两份清单不许重叠（一个根只能声明一次归属）', () => {
    const { writable, engineOnly } = readEngineLists();
    const both = writable.filter((r) => engineOnly.includes(r));
    expect(both, `同一个根在两份清单里都出现：${both.join(', ')}`).toEqual([]);
  });

  it('演练：白名单里有、却没人处理的根，必须被逮到', () => {
    /*
     * 拿今天的真实形态做反例：把 `wounds` 从自由字段白名单里摘掉、也不给它分支，
     * 判据必须报出来 —— 证明"不空转"这条不是摆设。
     */
    const rootBranches = new Set(['vitals', 'combat', 'location']);
    const writable = ['vitals', 'wounds', 'combat'];
    const freeField = ['flags'];
    const orphans = writable.filter((r) => !rootBranches.has(r) && !freeField.includes(r));
    expect(orphans).toEqual(['wounds']);
  });
});
