import { cpSync, existsSync, rmSync, readdirSync, mkdirSync, statSync, copyFileSync } from 'node:fs';
import { resolve, join } from 'node:path';

/**
 * 把 `dist/` 的内容发布到**仓库根**。
 *
 * ## 为什么必须这么做（2026-09-18 钉死的根因）
 *
 * 平台的**文档根写死成仓库根**（应用侧改不了），而 Vite 的产物默认落在 `dist/`。
 * 后果链：
 * ```
 * 浏览器 GET /  →  平台返回 仓库根/index.html（Vite 开发模板）
 *             →  模板引 /src/main.tsx
 *             →  平台按静态文件返回源码，类型 application/octet-stream
 *             →  浏览器拒绝把它当 ES 模块执行  →  白屏
 * ```
 * 既然文档根改不了，就让**产物直接落在文档根**。
 * 本脚本由 `npm run build` 在 `vite build` 之后自动调用。
 *
 * ## 为什么要手写递归复制而不是 `cpSync(src, dst, {recursive:true})`
 *
 * 实测：本机托管 Node **22.22.2-3** 上，`cpSync` 复制**目录**会让进程直接崩
 * （退出码 `3221226505` = `0xC0000409` STATUS_STACK_BUFFER_OVERRUN，无任何输出）。
 * 单个文件的 `cpSync` 正常，`rmSync` / `readdirSync` 正常，Node 24 上目录复制也正常
 * —— 是那个 Node 构建自身的毛病，不是用法问题。
 *
 * 平台在服务端跑的也是 `npm run build`，它的 Node 版本我们**控制不了**：
 * 若同样有这毛病，这一步就会把整个构建带崩。
 * 因此这里**自己走一遍目录**（只依赖单文件 `copyFileSync`）+ `mkdirSync`，
 * 绕开那个会崩的调用 —— 在任何 Node 上行为一致。
 */

const ROOT = process.cwd();
const DIST = resolve(ROOT, 'dist');
if (!existsSync(DIST)) throw new Error('dist 不存在，请先执行 vite build');

/**
 * 递归复制目录树。
 * @param {string} from 源目录
 * @param {string} to   目标目录
 */
function copyTree(from, to) {
  mkdirSync(to, { recursive: true });
  for (const name of readdirSync(from)) {
    const src = join(from, name);
    const dst = join(to, name);
    if (statSync(src).isDirectory()) {
      copyTree(src, dst);
    } else {
      copyFileSync(src, dst);
    }
  }
}

let copied = 0;
for (const name of readdirSync(DIST)) {
  const from = resolve(DIST, name);
  const to = resolve(ROOT, name);
  rmSync(to, { recursive: true, force: true });
  if (statSync(from).isDirectory()) {
    copyTree(from, to);
  } else {
    copyFileSync(from, to);
  }
  copied += 1;
}

console.log(`已将构建产物发布到仓库根（${copied} 项）`);
