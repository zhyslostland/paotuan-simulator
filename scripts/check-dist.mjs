#!/usr/bin/env node
/**
 * 产物自检 —— **构建完立刻检查"玩家拿到的那份能不能跑"**。
 *
 * ## 为什么必须有它（2026-09-18 那次白屏的真凶）
 * 平台把"文档根"写死成仓库根，而根 `index.html` 一度是**开发模板**：
 * 它引的是 `/src/main.tsx`，浏览器按 `octet-stream` 拒绝执行 ES 模块 → **整页白屏**。
 * 当时所有门禁都是绿的（`tsc` 过、655 测试过、`vite build` 成功）——
 * 因为**没有一条断言在看"产物本身长什么样"**。
 *
 * 这个脚本零浏览器、零网络，纯读文件，几毫秒跑完，挂进 `npm run build` 之后。
 */
import { readFileSync, existsSync } from 'node:fs';
import { join, resolve } from 'node:path';

const ROOT = resolve(process.cwd());
const problems = [];
const ok = [];

function read(p, label) {
  if (!existsSync(p)) {
    problems.push(`${label} 不存在：${p}`);
    return null;
  }
  return readFileSync(p, 'utf8');
}

// ---- 1. 根 index.html（玩家实际拿到的那份）----
const html = read(join(ROOT, 'index.html'), '根 index.html');
if (html !== null) {
  if (html.includes('/src/main.tsx')) {
    problems.push('根 index.html 引了 `/src/main.tsx` —— **这是开发模板，不是构建产物**（2026-09-18 白屏的真凶）');
  } else {
    ok.push('根 index.html 不引开发入口');
  }
  if (/assets\/index-[\w-]+\.js/.test(html)) {
    ok.push('根 index.html 引到了构建产物');
  } else {
    problems.push('根 index.html 里找不到 `assets/index-*.js` 引用');
  }
  // 平台文档根是仓库根 → 相对路径必须能被根路径解析
  if (html.includes('crossorigin')) {
    ok.push('入口 script 带 crossorigin（走 CORS，不会被容器域当 octet-stream）');
  }
}

// ---- 2. version.json ----
const vj = read(join(ROOT, 'version.json'), 'version.json');
let onlineVersion = null;
if (vj !== null) {
  try {
    const parsed = JSON.parse(vj);
    onlineVersion = parsed.version ?? null;
    if (onlineVersion) ok.push(`version.json = ${onlineVersion}`);
    else problems.push('version.json 里没有 version 字段');
  } catch {
    problems.push('version.json 不是合法 JSON');
  }
}

// ---- 3. 产物版本号必须跟源码真源一致（防"发版忘了改"）----
const vsrc = read(join(ROOT, 'src', 'version.ts'), 'src/version.ts');
if (vsrc !== null) {
  const m = vsrc.match(/APP_VERSION\s*=\s*['"]([^'"]+)['"]/);
  const srcVersion = m?.[1] ?? null;
  if (!srcVersion) {
    problems.push('src/version.ts 里读不到 APP_VERSION');
  } else if (onlineVersion && srcVersion !== onlineVersion) {
    problems.push(`版本不一致：源码 ${srcVersion} ≠ version.json ${onlineVersion}（产物是不是旧的？）`);
  } else if (srcVersion) {
    ok.push(`版本与源码真源一致（${srcVersion}）`);
  }
}

// ---- 4. 构建产物目录本身 ----
if (!existsSync(join(ROOT, 'assets'))) {
  problems.push('assets/ 不存在 —— 构建产物没落到仓库根（见 scripts/publish-root.mjs）');
} else {
  ok.push('assets/ 已落在仓库根');
}

// ---- 输出 ----
for (const line of ok) console.log('  ✅ ' + line);
if (problems.length === 0) {
  console.log('\n产物自检通过：玩家拿到的那份能跑。');
  process.exit(0);
}
console.log('');
for (const p of problems) console.log('  ❌ ' + p);
console.log('\n产物自检**未通过** —— 别上线，先修产物。');
process.exit(1);
