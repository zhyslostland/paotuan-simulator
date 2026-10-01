#!/usr/bin/env node
/**
 * 机械事实契约门禁 —— **检查「提示词 / 引擎 / 断言」说的是不是同一件事**。
 *
 * ## 为什么必须挂在 `npm run build` 里（2026-09-30 架构体检的结论）
 *
 * 这个项目三次上线事故（v0.3.0 白屏、生图必失败、状态不推进）**全都发生在门禁全绿时**：
 * `tsc` 0 错、上千测试全过、构建成功 —— 却没有**一条断言**在看
 * 「提示词教的做法 ↔ 引擎实际的做法 ↔ 有没有测试钉住」这三者是否一致。
 * 项目自己的定论（`docs/协作/协作存档-2026-09.md:1207`）：
 *
 * > 骰子/状态的权威在 `core/`，提示词是字符串，UI 是可选回调。**编译器看不见「三处是否同一件事」。**
 *
 * 这个脚本把 `src/core/contract.ts` 那份**机器可读的登记表**逐条核对：
 *
 * | # | 核对项 | 挡住什么事故 |
 * |---|---|---|
 * | 1 | 真源符号在该文件里**真的定义了** | 改名/搬走后静默失效（"修在另一条腿上"的前提就是找不到真源） |
 * | 2 | 写点符号在该文件里**真的定义了** | 同上；写点消失等于"引擎权威空转"（`P1-3`） |
 * | 3 | 提示词锚点在 `prompt.ts` 里**真的出现了** | 提示词与引擎脱节（教做法 A、引擎只认 B） |
 * | 4 | 至少一个测试文件**点名了这条事实** | "纯函数对但没接线"漏过门禁（`P1-3` 的测试层根因） |
 *
 * ## 缺口允许存在，但**棘轮不许增加**
 *
 * 存量缺口太多，一次补不完。所以：首次运行把缺口数写进仓库根 `contract-baseline.json`；
 * 此后 `缺口数 > 基线` 即**构建失败**，`< 基线` 则自动下调基线并打印进度。
 * **要让门禁通过就修事实或补断言，不是改基线** —— 改基线会在输出里留下痕迹。
 *
 * 零浏览器、零网络、纯读文本，几百毫秒跑完。
 */
import { readFileSync, writeFileSync, existsSync, readdirSync } from 'node:fs';
import { join, resolve } from 'node:path';

const ROOT = resolve(process.cwd());
const CONTRACT = join(ROOT, 'src', 'core', 'contract.ts');
const PROMPT = join(ROOT, 'src', 'orchestrator', 'prompt.ts');
const TESTS = join(ROOT, 'tests');
const BASELINE_FILE = join(ROOT, 'contract-baseline.json');
const UPDATE_BASELINE = process.argv.includes('--update-baseline');

const problems = [];
const ok = [];
const gaps = [];

function read(path, label) {
  if (!existsSync(path)) {
    problems.push(`${label} 不存在：${path}`);
    return null;
  }
  return readFileSync(path, 'utf8');
}

/**
 * 从源码文本里抠出 `FACT_REGISTRY` 的字面量并求值。
 *
 * 它是**纯数据**（零 import、零调用），所以不需要 TypeScript 编译器 ——
 * 门禁因此可以只靠 node 跑，不引任何依赖。
 */
function parseRegistry(src) {
  const start = src.indexOf('export const FACT_REGISTRY');
  if (start < 0) throw new Error('contract.ts 里找不到 `export const FACT_REGISTRY`');
  const eq = src.indexOf('= [', start);
  if (eq < 0) throw new Error('FACT_REGISTRY 不是数组字面量');
  const from = src.indexOf('[', eq);
  // 括号配平找数组结尾（中括号只出现在字面量里，字符串内的括号要跳过）
  let depth = 0;
  let inStr = null;
  let end = -1;
  for (let i = from; i < src.length; i += 1) {
    const ch = src[i];
    if (inStr) {
      if (ch === '\\') i += 1;
      else if (ch === inStr) inStr = null;
      continue;
    }
    if (ch === '"' || ch === "'" || ch === '`') inStr = ch;
    else if (ch === '[') depth += 1;
    else if (ch === ']') {
      depth -= 1;
      if (depth === 0) {
        end = i;
        break;
      }
    }
  }
  if (end < 0) throw new Error('FACT_REGISTRY 数组没有闭合');
  const literal = src.slice(from, end + 1);
  // eslint-disable-next-line no-new-func -- 求值的是本仓库自己的纯字面量
  return new Function(`return (${literal});`)();
}

/** 该文件里是否**定义**了这个符号（顶层声明、组件、或对象方法/属性都算）。 */
function declaresSymbol(src, symbol) {
  const s = symbol.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  // 属性/方法写法（store 的 action 就是这种）：`symbol(` / `symbol:` / `symbol =`。
  // ⚠️ 必须排除"调用点"：`useStore((s) => ...)` 里 `useStore` 后面直接跟着 `((`，
  // 那种写法是**用**不是**定义** —— 所以这里只认 `symbol(` 或 `symbol:`，不认 `symbol =`。
  const asMember = new RegExp(`(?:^|\\n)\\s*(?:async\\s+)?${s}\\s*[(:]`).test(src);
  const asDecl = new RegExp(
    `(?:^|\\n)\\s*(?:export\\s+)?(?:default\\s+)?(?:async\\s+)?(?:function|const|let|class|interface|type|enum)\\s+${s}\\b`
  ).test(src);
  return asMember || asDecl;
}

const contractSrc = read(CONTRACT, '契约登记表 src/core/contract.ts');
const promptSrc = read(PROMPT, '提示词 src/orchestrator/prompt.ts');

if (contractSrc !== null) {
  let registry;
  try {
    registry = parseRegistry(contractSrc);
  } catch (err) {
    problems.push(`契约登记表解析失败：${err.message}`);
  }

  if (registry) {
    if (!Array.isArray(registry) || registry.length === 0) {
      problems.push('FACT_REGISTRY 必须是**非空数组**（登记表的立意就是逐条登记机械事实）');
    }

    const ids = new Set();
    const testFiles = existsSync(TESTS)
      ? readdirSync(TESTS).filter((f) => /\.test\.tsx?$/.test(f))
      : [];
    const testText = new Map(
      testFiles.map((f) => [f, readFileSync(join(TESTS, f), 'utf8')])
    );

    for (const fact of registry) {
      const where = fact?.id ? `事实 ${fact.id}` : '（无 id 的登记项）';
      for (const key of ['id', 'category', 'what', 'truth', 'visible', 'pins']) {
        if (fact?.[key] === undefined) problems.push(`${where} 缺少必填字段 \`${key}\``);
      }
      // `prompt` 允许 `null`（= 明确声明"这条没有提示词侧"），但不许漏填、
      // 也不许写成"空 anchors 数组"——那看着像接好了、其实什么都没核对。
      if (fact?.prompt === undefined) {
        problems.push(`${where} 缺少必填字段 \`prompt\`（没有提示词侧就写 null，别漏）`);
      } else if (fact.prompt !== null && (fact.prompt.anchors ?? []).length === 0) {
        problems.push(`${where} 的 prompt.anchors 是空的 —— 要么写锚点、要么写 null`);
      }
      if (!fact?.id || !fact?.truth?.file || !fact?.truth?.symbol) continue;
      if (ids.has(fact.id)) problems.push(`${where} 重复登记`);
      ids.add(fact.id);

      const missing = [];

      // ---- 1. 真源真的定义在那里 ----
      const truthPath = join(ROOT, fact.truth.file);
      if (!existsSync(truthPath)) {
        missing.push(`真源文件不存在（${fact.truth.file}）`);
      } else if (!declaresSymbol(readFileSync(truthPath, 'utf8'), fact.truth.symbol)) {
        missing.push(`真源符号 \`${fact.truth.symbol}\` 不在 ${fact.truth.file} 里定义（改名/搬走？）`);
      }

      // ---- 2. 写点真的定义在那里（或明确登记为"引擎不管"） ----
      if (fact.writer) {
        const wPath = join(ROOT, fact.writer.file);
        if (!existsSync(wPath)) {
          missing.push(`写点文件不存在（${fact.writer.file}）`);
        } else if (!declaresSymbol(readFileSync(wPath, 'utf8'), fact.writer.symbol)) {
          missing.push(`写点符号 \`${fact.writer.symbol}\` 不在 ${fact.writer.file} 里定义`);
        }
      } else if (fact.engineFree !== true) {
        missing.push('既没有写点，也没标 `engineFree: true`（引擎不管的事实必须显式承认）');
      }

      // ---- 3. 提示词锚点真的在提示词里 ----
      //
      // ⚠️ 归一：`prompt.ts` 的源码里写的是**转义序列 / 拼接**，构造出来的是真实字符：
      //   - 反引号：源码 `\``（模板字符串里转义）→ 值是 `` ` ``；
      //   - 粗体：源码 `**AB**` 是 `'**A' + 'B**'` 拼出来的，**字面文本里根本不连续**
      //     → 所以比较前统一把 `**` 压成 `*`。
      // 不归一就会假红（第一版就踩了反引号那一次）。
      if (promptSrc !== null && fact.prompt !== null) {
        const flatPrompt = promptSrc.split('\\').join('').split('**').join('*');
        for (const anchor of fact.prompt?.anchors ?? []) {
          const flatAnchor = anchor.split('\\').join('').split('**').join('*');
          if (!flatPrompt.includes(flatAnchor)) {
            missing.push(`提示词锚点不见了（${fact.prompt.file}）：${JSON.stringify(anchor)}`);
          }
        }
      }

      // ---- 4. 至少一个测试点名了这条事实或其真源 ----
      const tokens = [fact.id, fact.id.split('.').pop(), fact.truth.symbol, ...(fact.prompt?.anchors ?? [])];
      const named = testFiles.filter((f) => tokens.some((t) => t && testText.get(f).includes(t)));
      if (named.length === 0) {
        missing.push(`没有任何测试点名它（试过：${tokens.filter(Boolean).join(' / ')}）`);
      }

      if (missing.length === 0) ok.push(fact.id);
      else gaps.push({ id: fact.id, missing });
    }

    // 登记表自检：pins 必须指向真实存在的测试文件
    for (const fact of registry) {
      for (const pin of fact?.pins ?? []) {
        if (!existsSync(join(ROOT, pin.file))) {
          problems.push(`事实 ${fact.id} 的断言指向不存在的文件：${pin.file}`);
        }
      }
    }
  }
}

// ---- 棘轮：缺口只许降不许升 ----
// ⚠️ 基线文件可能被人用带 BOM 的编辑器（Windows 记事本 / PowerShell `-Encoding utf8`）改过，
// 所以先剥 BOM；解析失败**当成问题报出来**，而不是抛栈把门禁搞崩（门禁自己崩了就没人信了）。
let baseline = null;
if (existsSync(BASELINE_FILE)) {
  const raw = readFileSync(BASELINE_FILE, 'utf8').replace(/^\uFEFF/, '').trim();
  try {
    baseline = JSON.parse(raw);
  } catch (err) {
    problems.push(
      `contract-baseline.json 解析失败（${err.message}）：请删掉它再跑一次（会自动重建），或用 ` +
        '`npm run lint:contract:baseline` 重写。'
    );
  }
}
if (baseline !== null && typeof baseline.gaps !== 'number') {
  problems.push('contract-baseline.json 缺少 `gaps` 数字：请用 `npm run lint:contract:baseline` 重建。');
  baseline = null;
}

const current = { gaps: gaps.length, facts: ok.length + gaps.length, ids: gaps.map((g) => g.id) };

if (UPDATE_BASELINE || !baseline) {
  writeFileSync(
    BASELINE_FILE,
    `${JSON.stringify({ ...current, updatedAt: new Date().toISOString() }, null, 2)}\n`,
    'utf8'
  );
  console.log(`📝 契约基线已写入 contract-baseline.json：${current.gaps} 条缺口 / 共 ${current.facts} 条事实`);
} else if (current.gaps > baseline.gaps) {
  problems.push(
    `契约缺口**变多了**：${baseline.gaps} → ${current.gaps}（棘轮只许降不许升）。` +
      `新增的缺口：${current.ids.filter((id) => !baseline.ids.includes(id)).join(' / ') || '（同一条事实新增了核对项）'}`
  );
} else if (current.gaps < baseline.gaps) {
  writeFileSync(
    BASELINE_FILE,
    `${JSON.stringify({ ...current, updatedAt: new Date().toISOString() }, null, 2)}\n`,
    'utf8'
  );
  console.log(`✅ 契约缺口下降：${baseline.gaps} → ${current.gaps}（基线已同步下调）`);
}

// ---- 输出 ----
console.log('');
console.log(`契约登记表：${current.facts} 条机械事实，已接好 ${ok.length} 条，缺口 ${current.gaps} 条`);
if (gaps.length > 0) {
  console.log('');
  console.log('缺口明细（每条都是"某层与另一层脱节"的现场，按优先级修）：');
  for (const g of gaps) {
    console.log(`  · ${g.id}`);
    for (const m of g.missing) console.log(`      - ${m}`);
  }
}

if (problems.length > 0) {
  console.error('');
  console.error('❌ 契约门禁未通过：');
  for (const p of problems) console.error(`  · ${p}`);
  process.exit(1);
}

console.log('');
console.log('契约门禁通过：登记的事实都对得上真源、提示词与断言。');
