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
// L1 详版必须有导航表，否则接手只能整读
for (const f of ['项目台账.md', '协作清单.md']) {
  const p = join(ROOT, f);
  if (existsSync(p) && !readFileSync(p, 'utf8').includes('## 📑 导航')) {
    problems.push(`L1 缺导航表：${f} 没有「## 📑 导航」—— 接手会被迫整读`);
  }
}

// ---- L3 冷存（不阻断，只报数）----
const l3files = ['docs/台账-版本史.md', 'docs/协作存档-2026-09.md',
                 'docs/总览.md', 'docs/初期报告.md', 'docs/交接文档.md'];
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
