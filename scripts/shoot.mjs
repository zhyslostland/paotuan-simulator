#!/usr/bin/env node
/**
 * 真实截图：headless Chrome + CDP。
 *
 * ## 为什么不用 `chrome --screenshot`
 * 那条路有两个坑，都在本机踩过：
 * 1. **首次运行引导会把 headless 卡住** —— 只生成 profile 目录、不出图。
 *    解法是 `--no-first-run` 等一串参数（本脚本已带）。
 * 2. **一次性截图没法在"截图之前"操作页面** ——
 *    比如这个应用的欢迎弹窗会盖满全屏（`localStorage['trpg.welcomed']` 没置位时），
 *    截出来的图全被黑遮罩压着，看不出界面。
 *
 * 走 CDP 就都能做：**先注入脚本 / 执行交互，再截**。
 *
 * ## 用法
 *
 *     node scripts/shoot.mjs <url> <out.png> [宽] [高] [--pre "js"] [--after "js"]
 *
 * - `--pre`  ：在**页面自己的脚本之前**执行（`addScriptToEvaluateOnNewDocument`）。
 *              例：`--pre "localStorage.setItem('trpg.welcomed','1')"` 跳过欢迎弹窗。
 * - `--after`：等页面渲染完再执行（`Runtime.evaluate`），用来点开某个面板。
 *              例：`--after "document.querySelector('button[data-tab=world]')?.click()"`。
 *
 * 例：
 *     node scripts/shoot.mjs https://paotuan-sim-79663.app.workbuddy.host/ shot.png 1280 900 \
 *       --pre "localStorage.setItem('trpg.welcomed','1')"
 *
 * ## 注意
 * 这是**实现方自查用**（确认自己的改动在真渲染里是什么样）；
 * 体验验收与真机证据仍归测试方（`trpg-play-and-test`）。
 */
import { spawn } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const argv = process.argv.slice(2);
const flag = (name) => {
  const i = argv.indexOf(name);
  return i >= 0 ? argv[i + 1] : '';
};
const positional = argv.filter((a, i) => !a.startsWith('--') && argv[i - 1] !== '--pre' && argv[i - 1] !== '--after');

const [url, out, wArg, hArg] = positional;
if (!url || !out) {
  console.error('用法: node scripts/shoot.mjs <url> <out.png> [宽] [高] [--pre "js"] [--after "js"]');
  process.exit(2);
}
const width = Number(wArg) || 1280;
const height = Number(hArg) || 900;
const preJs = flag('--pre');
const afterJs = flag('--after');

const CHROME_CANDIDATES = [
  process.env.CHROME_PATH,
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
].filter(Boolean);
const chromePath = CHROME_CANDIDATES.find((p) => existsSync(p));
if (!chromePath) {
  console.error('找不到 Chrome / Edge');
  process.exit(2);
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const profile = mkdtempSync(join(tmpdir(), 'shoot-'));
let chrome;

try {
  chrome = spawn(
    chromePath,
    [
      '--headless=new',
      '--disable-gpu',
      '--no-sandbox',
      '--no-first-run',
      '--no-default-browser-check',
      '--disable-extensions',
      '--disable-background-networking',
      '--hide-scrollbars',
      `--user-data-dir=${profile}`,
      `--window-size=${width},${height}`,
      '--remote-debugging-port=0',
      'about:blank',
    ],
    { stdio: 'ignore' }
  );

  // 等 DevToolsActivePort（Chrome 把实际端口写在里面）
  const portFile = join(profile, 'DevToolsActivePort');
  const t0 = Date.now();
  while (!existsSync(portFile)) {
    if (Date.now() - t0 > 20000) throw new Error('Chrome 没起来（DevToolsActivePort 未出现）');
    await sleep(120);
  }
  const port = readFileSync(portFile, 'utf8').split('\n')[0].trim();

  const list = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
  const page = list.find((t) => t.type === 'page');
  if (!page) throw new Error('没有可用的 page target');

  const ws = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise((res, rej) => {
    ws.addEventListener('open', res, { once: true });
    ws.addEventListener('error', () => rej(new Error('CDP 连接失败')), { once: true });
  });

  let seq = 0;
  const pending = new Map();
  ws.addEventListener('message', (ev) => {
    const m = JSON.parse(ev.data);
    if (m.id && pending.has(m.id)) {
      const { res, rej } = pending.get(m.id);
      pending.delete(m.id);
      if (m.error) rej(new Error(m.error.message));
      else res(m.result);
    }
  });
  const send = (method, params = {}) =>
    new Promise((res, rej) => {
      const id = ++seq;
      pending.set(id, { res, rej });
      ws.send(JSON.stringify({ id, method, params }));
    });

  await send('Page.enable');
  if (preJs) await send('Page.addScriptToEvaluateOnNewDocument', { source: preJs });
  await send('Page.navigate', { url });

  // 等文档加载完
  for (let i = 0; i < 80; i++) {
    await sleep(200);
    try {
      const r = await send('Runtime.evaluate', { expression: 'document.readyState', returnByValue: true });
      if (r?.result?.value === 'complete') break;
    } catch {
      /* 还没开始导航，忽略 */
    }
  }

  if (afterJs) {
    await sleep(600);
    const r = await send('Runtime.evaluate', {
      expression: afterJs,
      awaitPromise: false,
      returnByValue: true,
    });
    // 把结果打出来 —— 这样 `--after` 也能当"探针"用（读计算样式、量尺寸、数元素）
    if (r?.exceptionDetails) {
      console.error('--after 里报错：', r.exceptionDetails.text, r.exceptionDetails.exception?.description ?? '');
    } else {
      const v = r?.result?.value;
      if (v !== undefined) console.log('after →', typeof v === 'string' ? v : JSON.stringify(v));
    }
  }
  // 等 React 渲染 / 字体 / 图片（背景图是异步的，给足）
  await sleep(1800);

  const shot = await send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false });
  writeFileSync(out, Buffer.from(shot.data, 'base64'));
  const kb = (readFileSync(out).length / 1024).toFixed(0);
  console.log(`已截图 ${out}（${width}x${height} · ${kb} KB）`);
} finally {
  try {
    chrome?.kill();
  } catch {
    /* 忽略 */
  }
  await sleep(300);
  try {
    rmSync(profile, { recursive: true, force: true });
  } catch {
    /* profile 删不掉不影响结果 */
  }
}
