/**
 * regen-ledger-nav.mjs —— 重算《项目台账.md》导航表的「行」与「字符」两列。
 *
 * 为什么要有这个脚本：
 *   台账顶部有一张导航表（章节 | 行 | 字符 | 什么时候读），一旦往文档中间插内容，
 *   **其后所有条目的行号都会漂移**。手算必错（2026-09-19 已踩过一次）。
 *   行号必须在所有插入/替换完成**之后**重算。
 *
 * 字符数口径（与历史数据一致）：
 *   「该节含标题行在内，所有**非空行**的原始字符数之和」（保留 markdown 标记）。
 *   校验锚点：空的 `### 3.2.7 …（**…**）` 一节，算出来应为 45。
 *
 * 用法：
 *   node scripts/regen-ledger-nav.mjs [台账路径]
 * 不加路径时默认：仓库根/项目台账.md（本脚本会以自身位置为基准找仓库根）。
 *
 * 行为：
 *   - 只重写已存在的导航行（行号 + 字符两列），标题列与「什么时候读」列**原样保留**；
 *   - 表格里有 `| — |` 的冷存行跳过不动；
 *   - 匹配不上的导航行会报出来并保留原值，交由人处理，不猜。
 */

import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, '..');
const target = process.argv[2] ? resolve(process.argv[2]) : resolve(repoRoot, '项目台账.md');

const src = readFileSync(target, 'utf8');
const lines = src.split('\n');

/** 标题行 → { level, text, line }（line 为 1 基行号） */
const headings = [];
lines.forEach((raw, i) => {
  const m = raw.match(/^#{2,4}[ \t]+/);
  if (!m) return;
  const text = raw.slice(m[0].length).trim();
  headings.push({ level: m[0].trim().length, text, line: i + 1 });
});

/** 归一化：去掉全角/半角空白与 markdown 强调，用于比对标题 */
const norm = (s) => s.replace(/^[　\s]+/, '').replace(/\*\*/g, '').trim();

/** 某一节的正文范围：[标题行, 下一个同级或更高级标题 之前) */
function sectionOf(h, idx) {
  let end = lines.length;
  for (let j = idx + 1; j < headings.length; j++) {
    if (headings[j].level <= h.level) {
      end = headings[j].line - 1;
      break;
    }
  }
  let chars = 0;
  for (let ln = h.line; ln <= end && ln <= lines.length; ln++) {
    const t = lines[ln - 1];
    if (t.trim() === '') continue; // 空行不计
    chars += t.length;
  }
  return chars;
}


// 定位导航表：含 "| 章节 | 行 | 字符 |" 表头，到最后一条表格行
const navStart = lines.findIndex((l) => /^\|\s*章节\s*\|\s*行\s*\|\s*字符\s*\|/.test(l));
if (navStart < 0) {
  console.error('✗ 没找到导航表头（应有 "| 章节 | 行 | 字符 |"）');
  process.exit(1);
}

const missed = [];
let updated = 0;

for (let i = navStart + 1; i < lines.length; i++) {
  const raw = lines[i];
  if (!raw.startsWith('|')) break; // 表格结束
  const cells = raw.split('|');
  if (cells.length < 5) continue; // 分隔行 `|---|---|...`
  const titleCell = cells[1];
  const cellText = titleCell.replace(/^[　\s]+/, '').trim();
  if (!cellText || /^[-:]+$/.test(cellText)) continue; // 空行 / 纯分隔行

  // 冷存行：`| 📦 **版本史** … | — | 46.8K | … |` —— 不是章节，跳过
  if (cells[2].trim() === '—') continue;

  const hit = headings.findIndex((h) => norm(h.text).startsWith(norm(cellText)));
  if (hit < 0) {
    missed.push(cellText);
    continue;
  }
  const chars = sectionOf(headings[hit], hit);
  cells[2] = ` ${headings[hit].line} `;
  cells[3] = ` ${chars} `;
  lines[i] = cells.join('|');
  updated++;
}

if (missed.length) {
  console.error('⚠ 以下导航行没匹配到标题，保留原值，请人工处理：');
  missed.forEach((m) => console.error('  - ' + m));
}

writeFileSync(target, lines.join('\n'), 'utf8');
console.log(`✓ 导航表已重算：${updated} 行更新 · ${missed.length} 行未匹配 · ${target}`);
