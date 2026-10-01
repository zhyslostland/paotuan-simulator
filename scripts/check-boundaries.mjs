#!/usr/bin/env node
/**
 * 架构边界闸门 —— 把**只写在注释里的铁律**变成构建期会红的东西。
 *
 * ## 为什么必须存在（2026-09-30 架构体检 §3 · S1 / S4）
 *
 * 这个项目有三条铁律，全部只以注释形式存在：
 *
 * | 铁律 | 原文出处 | 实测现状 |
 * |---|---|---|
 * | `core` 不许有 IO | `core/rulesets/index.ts:45`「core 不许有 IO」 | 同文件 `:57` 就在读 `localStorage` |
 * | `core` 不许反向依赖 `ui` / `orchestrator` | 协作存档多处 | 靠人自觉 |
 * | 「唯一写档口」 | `store.ts:570`「只有 `saveJson`/`flushSaves` 该调它」 | 实测 **7 文件 31 处**直接写 |
 *
 * 规矩写在注释里 = 编译器看不见 = 迟早被违反，而且**违反时不会有人知道**。
 * 体检报告把这类叫"约定不是机制"，它就是本项目反复复发的病根之一。
 *
 * ## 三条规则（都会让 `npm run build` 失败）
 *
 * 1. **`core/**` 不许 import `ui/**` 或 `orchestrator/**`** —— 依赖方向单向。
 * 2. **`core/**` 不许出现 `localStorage` / `sessionStorage` / `indexedDB` / `fetch(`**
 *    —— 引擎必须是纯的，否则没法脱离浏览器单测（`P2-5·边界` 那种"两条腿只修一条"
 *    就是因为判据在带 IO 的层里）。
 * 3. **`src/**`（除 `ui/state/storage.ts` 与测试）不许直接碰 `localStorage`**
 *    —— 写盘只有那一个入口。
 *
 * ## 豁免怎么写
 *
 * 用**行内注释** `boundary-allow: <理由>`（同一行或上一行）。理由是必填的：
 * 闸门会把它打印出来 —— 豁免要留痕，不许默默放过。
 *
 * ## 顺带：文件体量预算
 *
 * 逐个盯 `src/` 的大文件（`ui/store.ts` 体检时 **3185 行 / 123K 字符**），
 * 超预算只**警告不失败**：体量不该一次性卡死，但必须可见，而且改大到超限时会提醒。
 * 预算表在 `boundary-budget.json`（自动生成，可手工上调——上调会在 diff 里留痕）。
 */
import { readFileSync, writeFileSync, existsSync, readdirSync, statSync } from 'node:fs';
import { join, resolve, relative } from 'node:path';

const ROOT = resolve(process.cwd());
const SRC = join(ROOT, 'src');
const BUDGET_FILE = join(ROOT, 'boundary-budget.json');

/** 唯一允许直接碰 localStorage 的文件（写档口本体）。 */
const STORAGE_ADAPTER = 'src/ui/state/storage.ts';

const problems = [];
const notes = [];

/** 递归收集 src 下的源码文件（跳过测试与声明文件）。 */
function walk(dir, out = []) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    const st = statSync(p);
    if (st.isDirectory()) walk(p, out);
    else if (/\.(ts|tsx)$/.test(name) && !/\.d\.ts$/.test(name)) out.push(p);
  }
  return out;
}

if (!existsSync(SRC)) {
  console.error('❌ 找不到 src/ 目录');
  process.exit(1);
}

const files = walk(SRC);

/** 该行是否被行内豁免（`boundary-allow: 理由`，同上一行也算）。 */
function allowed(lines, i) {
  const self = lines[i] ?? '';
  const prev = lines[i - 1] ?? '';
  const m = /boundary-allow:\s*(.+)/.exec(self) || /boundary-allow:\s*(.+)/.exec(prev);
  return m ? m[1].trim() : null;
}

/**
 * 这一行是不是**纯注释**（`//` 开头或 `*` 续行）。
 *
 * 为什么必须跳过：注释里写「别在这里再写一遍 `localStorage.setItem`」是**好注释**，
 * 它不该把闸门搞红 —— 闸门假红一次，人就会开始绕它，那这条闸门就死了。
 */
function isComment(line) {
  const t = line.trim();
  return t.startsWith('//') || t.startsWith('*') || t.startsWith('/*');
}

for (const abs of files) {
  const rel = relative(ROOT, abs).replace(/\\/g, '/');
  const text = readFileSync(abs, 'utf8');
  const lines = text.split(/\r?\n/);
  const isCore = rel.startsWith('src/core/');
  const isAdapter = rel === STORAGE_ADAPTER;

  // ---- 规则 1：core 不许反向依赖 ui / orchestrator ----
  if (isCore) {
    lines.forEach((line, i) => {
      if (isComment(line)) return;
      const m = /from\s+'(\.\.\/)+(ui|orchestrator)\//.exec(line);
      if (m && !allowed(lines, i)) {
        problems.push(
          `${rel}:${i + 1} core 反向依赖了 ${m[2]}/ —— 依赖方向必须单向（core ← ui/orchestrator）。` +
            ` 确实必要就写 \`boundary-allow: 理由\`。`
        );
      }
    });
  }

  // ---- 规则 2：core 不许有 IO ----
  if (isCore) {
    lines.forEach((line, i) => {
      if (isComment(line)) return;
      // 只看真实调用：`localStorage.` / `indexedDB.` / `fetch(`
      const m = /\b(localStorage|sessionStorage|indexedDB)\s*\.|\bfetch\s*\(/.exec(line);
      if (m && !allowed(lines, i)) {
        problems.push(
          `${rel}:${i + 1} core 里出现了 IO（${m[0].trim()}）—— 引擎必须是纯的。` +
            ` 把读盘那一半搬到 UI 层（参考 \`registerCustomRulesetsFrom\`），或写 \`boundary-allow: 理由\`。`
        );
      }
    });
  }

  // ---- 规则 3：只有写档口能碰 localStorage ----
  if (!isAdapter) {
    lines.forEach((line, i) => {
      if (isComment(line)) return;
      const m = /\b(localStorage|sessionStorage)\s*\./.exec(line);
      if (m && !allowed(lines, i)) {
        problems.push(
          `${rel}:${i + 1} 直接调了 ${m[1]} —— 写盘只有 \`${STORAGE_ADAPTER}\` 一个入口。` +
            ` 改走 \`readLocal\` / \`writeLocal\` / \`removeLocal\`。`
        );
      }
    });
  }
}

// ---- 顺带：失败不许静默（2026-09-30 基础完善 · 批次 C）----
/*
 * 为什么要有这一节：体检实测 `src/` 里有 **30 处空 catch**（`audio.ts` 6 · `loaders.ts` 5 ·
 * `generate.ts` 4 · `update.ts` 3 …），而手机上**连 console 都看不到** ——
 * 出了事既查不出、玩家也蒙。规矩得是可数的，不然"注意别静默"永远只是口号。
 *
 * 判据：一个 catch 块要么**有代码**（真的处理了），要么**写明为什么可以不管**
 * （`/* 静默：理由 *\/`）。两者都不满足 = **未登记的静默失败**。
 *
 * 存量不动（一次改 30 处风险太大），改用**棘轮**：基线记进 `boundary-budget.json`
 * 的 `silentCatch`，只许降不许增。想让门禁过就写理由或真的处理，不是改基线。
 */
function findSilentCatches(text) {
  const lines = text.split(/\r?\n/);
  const out = [];
  for (let i = 0; i < lines.length; i += 1) {
    if (!/catch\s*(\([^)]*\))?\s*\{/.test(lines[i])) continue;
    // 单行 catch（`} catch { ... }`）直接看整行
    const singleLine = /\}\s*$/.test(lines[i]) && /\{.*\S.*\}\s*$/.test(lines[i]);
    const body = [];
    if (singleLine) {
      body.push(lines[i].slice(lines[i].indexOf('{') + 1));
    } else {
      for (let j = i + 1; j < lines.length; j += 1) {
        if (/^\s*\}/.test(lines[j])) break;
        body.push(lines[j]);
      }
    }
    const isComment = (l) => /^\s*(\/\/|\*|\/\*)/.test(l) || l.trim() === '';
    const code = body.filter((l) => !isComment(l));
    const registered = body.some((l) => /静默：\S/.test(l));
    if (code.length === 0 && !registered) out.push(i + 1);
  }
  return out;
}

const silent = files.flatMap((abs) => {
  const rel = relative(ROOT, abs).replace(/\\/g, '/');
  if (rel === 'src/ui/state/storage.ts') return []; // 写档口自己吞配额异常是刻意的（下面有理由注释）
  return findSilentCatches(readFileSync(abs, 'utf8')).map((line) => `${rel}:${line}`);
});

// ---- 顺带：文件体量预算（警告，不失败） ----
const sizes = files
  .map((abs) => ({
    rel: relative(ROOT, abs).replace(/\\/g, '/'),
    chars: readFileSync(abs, 'utf8').length,
    lines: readFileSync(abs, 'utf8').split(/\r?\n/).length,
  }))
  .sort((a, b) => b.chars - a.chars);

const budgets = existsSync(BUDGET_FILE)
  ? JSON.parse(readFileSync(BUDGET_FILE, 'utf8').replace(/^\uFEFF/, ''))
  : null;

if (budgets === null) {
  const seed = { note: '体检 §3 的体量基线（阶段 1 落盘）。上调会在 diff 里留痕。', files: {}, silentCatch: silent.length };
  for (const s of sizes.slice(0, 12)) seed.files[s.rel] = { chars: s.chars, lines: s.lines };
  writeFileSync(BUDGET_FILE, `${JSON.stringify(seed, null, 2)}\n`, 'utf8');
  notes.push(`体量预算基线已写入 boundary-budget.json（取最大的 12 个文件）`);
} else {
  for (const s of sizes.slice(0, 12)) {
    const cap = budgets.files?.[s.rel];
    if (cap && s.chars > cap.chars) {
      notes.push(
        `⚠️ ${s.rel} 长到 ${s.chars} 字符（基线 ${cap.chars}）—— ` +
          `超过预算了。这条只警告不失败，但**别默默上调基线**：先问一句"它是不是该拆了"。`
      );
    }
  }

  // ---- 静默失败棘轮 ----
  const cap = budgets.silentCatch;
  if (typeof cap !== 'number') {
    budgets.silentCatch = silent.length;
    writeFileSync(BUDGET_FILE, `${JSON.stringify(budgets, null, 2)}\n`, 'utf8');
    notes.push(`静默失败基线已补写：${silent.length} 处（只许降不许增）`);
  } else if (silent.length > cap) {
    problems.push(
      `**未登记的静默失败变多了**：${cap} → ${silent.length}（棘轮只许降不许增）。` +
        ` 新增的：${silent.slice(cap).join(' / ')}。` +
        ` 修法：要么真的处理失败，要么在 catch 里写一行 \`/* 静默：<理由> */\`（理由必填）。`
    );
  } else if (silent.length < cap) {
    budgets.silentCatch = silent.length;
    writeFileSync(BUDGET_FILE, `${JSON.stringify(budgets, null, 2)}\n`, 'utf8');
    notes.push(`✅ 未登记的静默失败下降：${cap} → ${silent.length}（基线已同步下调）`);
  } else {
    // 持平时不刷屏：要明细就用 `--list-silent`
    if (process.argv.includes('--list-silent')) {
      notes.push(`未登记的静默失败（${silent.length} 处）：\n  ${silent.join('\n  ')}`);
    } else {
      notes.push(`未登记的静默失败 ${silent.length} 处（与基线持平；明细：` + ' `node scripts/check-boundaries.mjs --list-silent`）');
    }
  }
}

// ---- 输出 ----
for (const n of notes) console.log(n);

if (problems.length > 0) {
  console.error('');
  console.error('❌ 架构边界闸门未通过：');
  for (const p of problems) console.error(`  · ${p}`);
  console.error('');
  console.error(`（扫了 ${files.length} 个源文件。豁免写法：行内 \`boundary-allow: 理由\`）`);
  process.exit(1);
}

console.log('');
console.log(
  `边界闸门通过：扫 ${files.length} 个源文件 —— core 无 IO / 无反向依赖，` +
    `写盘只经 ${STORAGE_ADAPTER}。`
);
