#!/usr/bin/env node
/**
 * 记忆守卫 —— 检查 L0 / L2 容量、日志是否超期未蒸馏、archive 是否存在。
 * 规则见 .workbuddy/memory/GOVERNANCE.md。超限退出码 1。
 */
import { readFileSync, readdirSync, existsSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';

const ROOT = resolve(process.cwd());
const MEM = join(ROOT, '.workbuddy', 'memory');
const ARCHIVE = join(MEM, 'archive');

const L0_LIMIT = 4000;
const L2_LIMIT = 3000;
const LOG_KEEP_DAYS = 7;

const DAY = 86400000;
const LOG_RE = /^\d{4}-\d{2}-\d{2}\.md$/;

function chars(p) {
  return readFileSync(p, 'utf8').replace(/\r\n/g, '\n').length;
}

const problems = [];
const rows = [];

// ---- L0 ----
const l0 = join(MEM, 'MEMORY.md');
/*
 * 🔴 2026-09-30：**非开发环境没有这层记忆**（`.workbuddy/` 在 `.gitignore` 里）。
 *
 * 以前这里只判 `MEMORY.md` 在不在，于是「整个 `.workbuddy/` 都不存在」也被算成
 * 「L0 缺失」→ `exit(1)` → `npm run build` 直接失败。后果：
 * 部署环境、CI、以及**给协作方/别人的代码包**里都跑不了 build（本次上线就卡在这）。
 *
 * 那不是"体检不通过"，是"这里没有记忆层可体检" —— 放行。
 * 本地开发照旧严格（目录在，就走下面的逐层判据）。
 */
if (!existsSync(MEM)) {
  console.log('未发现 .workbuddy/memory（非开发环境）—— 跳过记忆体检。');
  process.exit(0);
}
if (!existsSync(l0)) {
  problems.push('L0 缺失：memory/MEMORY.md 不存在');
} else {
  const n = chars(l0);
  rows.push(['L0', 'MEMORY.md', n, L0_LIMIT]);
  if (n > L0_LIMIT) problems.push(`L0 超限：MEMORY.md ${n} > ${L0_LIMIT} 字符（预算制：新增一条必须挤掉一条）`);
}

// ---- L2 ----
const logs = readdirSync(MEM).filter((f) => LOG_RE.test(f)).sort();
const now = Date.now();
let stale = 0;
for (const f of logs) {
  const p = join(MEM, f);
  const n = chars(p);
  const age = Math.floor((now - statSync(p).mtimeMs) / DAY);
  rows.push(['L2', f, n, L2_LIMIT]);
  if (n > L2_LIMIT) problems.push(`L2 超限：${f} ${n} > ${L2_LIMIT} 字符`);
  if (age > LOG_KEEP_DAYS) stale++;
}
if (stale > 0) problems.push(`L2 超期：${stale} 份日志超过 ${LOG_KEEP_DAYS} 天未蒸馏（应归档进 archive/ 并按月合并）`);

// ---- L3 ----
if (!existsSync(ARCHIVE)) {
  problems.push('L3 缺失：archive/ 不存在（压缩前必须先备份原文）');
} else {
  const n = readdirSync(ARCHIVE).length;
  rows.push(['L3', `archive/ (${n} 份)`, 0, Infinity]);
}

// ---- L1 提示（不阻断）----
const l1files = ['项目台账.md', '协作清单.md', '规则包指南.md'];
for (const f of l1files) {
  const p = join(ROOT, f);
  if (existsSync(p)) rows.push(['L1', f, chars(p), Infinity]);
}
/*
 * 开发指南也要盯体量（2026-09-30 · 批次 D）。
 *
 * 为什么：这个项目的文档会**越长越没人读**（协作清单瘦身过三次：1302 → 948 → 479 行）。
 * 接入流程的价值全在"短、能照着做"，一旦膨胀成又一份大台账，它就会变成下一条无人核对的约定。
 * 所以给它一个**上限**（不阻断，但超了会在记忆体检里显形）。
 */
const DEV_GUIDE = 'docs/开发指南-加一个新状态.md';
/*
 * 上限取值说明：这份指南第一版 **3467 字符**（8 步走查 + 三份清单 + 三条铁律）。
 * 上限定在 **6000** —— 不是"越小越好"（200 字符装不下走查），而是"别长成又一份大台账"：
 * 它一旦超过这个量，就该把细节挪去别处，只留"照着做"的那几步。
 */
const DEV_GUIDE_LIMIT = 6000;
if (existsSync(join(ROOT, DEV_GUIDE))) {
  const n = chars(join(ROOT, DEV_GUIDE));
  rows.push(['L1', '开发指南-加一个新状态.md', n, DEV_GUIDE_LIMIT]);
  if (n > DEV_GUIDE_LIMIT) {
    problems.push(
      `开发指南超限：${n} > ${DEV_GUIDE_LIMIT} 字符 —— 它必须保持"短到能照着做"；` +
        '要展开的内容放 docs/ 其它文档，别在这里长。'
    );
  }
}
// L1 详版必须有导航表，否则接手只能整读
for (const f of ['项目台账.md', '协作清单.md']) {
  const p = join(ROOT, f);
  if (existsSync(p) && !readFileSync(p, 'utf8').includes('## 📑 导航')) {
    problems.push(`L1 缺导航表：${f} 没有「## 📑 导航」—— 接手会被迫整读`);
  }
}

/*
 * ---- 版本漂移（2026-09-30 架构体检 §2.5 加的判据）----
 *
 * 起因是一条真实、被记录过但一直没人拦的漂移：
 * `协作清单.md` 表头写着「唯一真源 `src/version.ts` 的 `APP_VERSION` → **v1.7.6**」，
 * 而真源早就到 **v1.7.12** —— 表头自己声明了它是真源的镜像，却谁也没核对过。
 *
 * 判据只针对**表头里的「版本号」那一行**（`| 版本号 | ... |`）：
 * 那行是"当前版本"的声明位；文档正文里出现的历史版本号（`v0.10.4` 之类）是**正常叙事**，
 * 一律不管 —— 判据收得太宽，人就学会绕它，闸门就死了。
 *
 * 取法：那一行里**最后一个** `vX.Y.Z` 是"当前"（写法通常是 `…；当前 **v1.7.12**`）。
 * 若它比真源**新**（说明真源被回退过）或不同，都报出来，由人决定谁对。
 */
const versionSrcPath = join(ROOT, 'src', 'version.ts');
if (existsSync(versionSrcPath)) {
  const m = /APP_VERSION\s*=\s*'([^']+)'/.exec(readFileSync(versionSrcPath, 'utf8'));
  const srcVersion = m ? m[1] : null;
  if (!srcVersion) {
    problems.push('版本真源读不出来：src/version.ts 里找不到 APP_VERSION');
  } else {
    for (const f of ['项目台账.md', '协作清单.md']) {
      const p = join(ROOT, f);
      if (!existsSync(p)) continue;
      const line = readFileSync(p, 'utf8')
        .split(/\r?\n/)
        .find((l) => /^\|\s*版本号\s*\|/.test(l));
      if (!line) continue;
      const decls = [...line.matchAll(/v?(\d+\.\d+\.\d+)/g)].map((x) => x[1]);
      const declared = decls.length > 0 ? decls[decls.length - 1] : null;
      if (declared === null) {
        problems.push(`版本漂移：${f} 的「| 版本号 |」那行里找不到 vX.Y.Z，无法核对真源`);
      } else if (declared !== srcVersion) {
        problems.push(
          `版本漂移：${f} 声明当前 v${declared}，而真源 src/version.ts 是 v${srcVersion} —— ` +
            `两者必须一致（表头自己写着"唯一真源 APP_VERSION"）`
        );
      } else {
        rows.push(['VER', `${f} = v${declared}`, 0, Infinity]);
      }
    }
  }
}

// ---- L3 冷存（不阻断，只报数）----
// 2026-09-28 文档整理：docs/ 分成 协作/ 报告/ archive/
const l3files = ['docs/协作/台账-版本史.md', 'docs/协作/协作存档-2026-09.md',
                 'docs/archive/总览.md', 'docs/archive/初期报告.md', 'docs/archive/交接文档.md'];
for (const f of l3files) {
  const p = join(ROOT, f);
  if (existsSync(p)) rows.push(['L3', f, chars(p), Infinity]);
}

const pad = (s, n) => String(s).padEnd(n, ' ');
console.log('');
console.log(pad('层', 4) + pad('文件', 26) + pad('字符数', 10) + '上限');
console.log('-'.repeat(58));
for (const [layer, f, n, lim] of rows) {
  const limTxt = lim === Infinity ? '—' : String(lim);
  const flag = lim !== Infinity && n > lim ? '  ← 超限' : '';
  console.log(pad(layer, 4) + pad(f, 26) + pad(n, 10) + limTxt + flag);
}
console.log('');

if (problems.length === 0) {
  console.log('记忆体检通过：各层均在闸门内。');
  process.exit(0);
}
console.log('记忆体检未通过：');
for (const p of problems) console.log('  - ' + p);
console.log('\n规则见 .workbuddy/memory/GOVERNANCE.md');
process.exit(1);
