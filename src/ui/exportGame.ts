/**
 * 导出这一局。
 *
 * 用户 2026-09-16 拍板：做成 **Markdown / 文本**（不做长图），
 * 并且**分成两份**：
 * - **结算分享**（短）：结局、这一局的账——发给别人看结果用；
 * - **整体流程分享**（长）：角色、模组、编年史、关键抉择、结局——完整经过。
 *
 * **两份都不含 `module.truth`**。那是守密人的内部真相，导出物有可能被转发，
 * 默认不剧透（与"剧情保密"这条约定一致）。
 */
import type { GameState, Ending } from '../core/state/gameState.js';

/** 导出所需的最小输入。字段都取自 store，不在这里做任何 IO */
export interface ExportInput {
  character: {
    name?: string;
    gender?: string;
    description?: string;
    personality?: string;
    characteristics: Record<string, number>;
    skills: Record<string, number>;
  };
  module: {
    title?: string;
    premise?: string;
    goal?: string;
    stakes?: string;
    urgency?: string;
    scale?: string;
    /**
     * 守密人真相。**只有"完整留档"才会带出去**，且放在末尾的折叠块里。
     * 默认导出一律不含它——导出物可能被转发，剧透一次就收不回来。
     */
    truth?: string;
  };
  gameState: GameState;
  chronicle: { turn: number; text: string; location?: string }[];
  summary: string;
  /** 关键抉择（直接给显示用的一句话，如"第3回 · 开枪 · 掷骰：射击（手枪）"） */
  anchors: { label: string }[];
  rulesetName?: string;
  /** 规则包的主骰（'1d100' 走百分比、'1d20' 走加值），决定技能怎么显示 */
  mainDice?: string;
  /**
   * 带图战报用：**配了图的关键节点**，按发生顺序。
   *
   * 只有这一项会进 HTML 战报（Markdown 那三份不带图 —— 把 base64 塞进 .md 会让文件爆掉）。
   * `image` 是生成时拿到的 data URI，直接内嵌进 HTML，导出的文件是**自包含**的。
   */
  scenes?: { label?: string; text: string; image?: string }[];
  /** 属性中文名（如 { str: '力量' }），用于把属性写成中文 */
  characteristicLabels?: Record<string, string>;
  exportedAt?: string;
}

const KIND_TITLE: Record<string, string> = {
  death: '终幕 · 殒命',
  insanity: '终幕 · 理智尽头',
  success: '终幕 · 达成',
  failure: '终幕 · 失守',
  grey: '终幕 · 灰色',
  other: '终幕',
};

function kindTitle(kind?: Ending['kind']): string {
  return (kind && KIND_TITLE[kind]) || '终幕';
}

/** 本机日期，形如 2026-09-16 */
function today(at?: string): string {
  return (at ?? new Date().toISOString()).slice(0, 10);
}

/** 把属性/技能表写成一行，值按量纲加后缀 */
function statLine(
  entries: [string, number][],
  unit: 'raw' | 'percent' | 'modifier',
  empty: string
): string {
  if (entries.length === 0) return empty;
  return entries
    .map(([k, v]) => {
      if (unit === 'percent') return `${k} ${v}%`;
      if (unit === 'modifier') return `${k} ${v >= 0 ? '+' : ''}${v}`;
      return `${k} ${v}`;
    })
    .join(' · ');
}

/**
 * 结算分享：一屏能读完，重点是"这局怎么结束的"。
 * 不写编年史——那是"整体流程"的事。
 */
export function buildResultMarkdown(input: ExportInput): string {
  const { gameState, character, module } = input;
  const ending = gameState.ending;
  const lines: string[] = [];

  lines.push(`# 《${module.title?.trim() || '无名模组'}》· ${kindTitle(ending?.kind)}`);
  lines.push('');
  lines.push(
    [kindTitle(ending?.kind), today(ending?.at ?? input.exportedAt)]
      .filter(Boolean)
      .join(' · ')
  );
  if (ending?.reason) {
    lines.push('');
    lines.push(`> ${ending.reason}`);
  }
  if (ending?.text) {
    lines.push('');
    lines.push(ending.text);
  }

  lines.push('');
  lines.push('---');
  lines.push('');
  const vitalLine = Object.entries(gameState.vitals)
    .map(([k, v]) => `${k.toUpperCase()} ${v}`)
    .join(' · ');
  const cells: string[] = [
    `- **角色**：${character.name?.trim() || '（未命名）'}`,
    `- **回合**：${input.chronicle.length > 0 ? input.chronicle[input.chronicle.length - 1]!.turn : 0}`,
    `- **关键抉择**：${input.anchors.length} 个`,
    `- **线索**：${gameState.clues.length} 条`,
    `- **结局时的状态**：${vitalLine}`,
  ];
  if (input.rulesetName) cells.splice(1, 0, `- **规则**：${input.rulesetName}`);
  lines.push(...cells);

  return lines.join('\n');
}

/**
 * 末尾的「守密人真相」折叠块。
 *
 * 用 `<details>` 而不是直接铺开：这一份是**留档**，玩家自己多半也还没走到真相，
 * 一打开就被糊一脸等于自毁体验；折叠起来，想看再点开。
 * 平台不支持 details 时（少数 Markdown 阅读器）它会退化成普通文本，内容不丢。
 */
function truthBlock(truth?: string): string[] {
  const t = truth?.trim();
  if (!t) return [];
  return [
    '',
    '---',
    '',
    '<details>',
    '<summary>守密人真相（剧透：展开前请确认这一局已经结束）</summary>',
    '',
    t,
    '',
    '</details>',
  ];
}

/**
 * 整体流程分享：完整经过。编年史是 GM 每轮写的客观事实，最适合拿来讲故事。
 *
 * `withTruth` 为真时才在末尾附真相（`buildArchiveMarkdown` 走这条），
 * 默认分享版永远不带。
 */
export function buildJourneyMarkdown(
  input: ExportInput,
  opts: { withTruth?: boolean } = {}
): string {
  const { gameState, character, module } = input;
  const ending = gameState.ending;
  // 技能按规则包的量纲写：COC 是百分比，DnD 是加值
  const skillUnit: 'percent' | 'modifier' = input.mainDice === '1d100' ? 'percent' : 'modifier';
  const lines: string[] = [];

  lines.push(`# 《${module.title?.trim() || '无名模组'}》· 完整经过`);
  lines.push('');
  if (module.premise?.trim()) {
    lines.push(`> ${module.premise.trim()}`);
    lines.push('');
  }

  // 角色
  lines.push('## 角色');
  lines.push('');
  lines.push(`**${character.name?.trim() || '（未命名）'}**${character.gender ? `（${character.gender}）` : ''}`);
  if (character.description?.trim()) lines.push('');
  if (character.description?.trim()) lines.push(character.description.trim());
  if (character.personality?.trim()) {
    lines.push('');
    lines.push(`性格：${character.personality.trim()}`);
  }
  const chEntries = Object.entries(character.characteristics);
  if (chEntries.length > 0) {
    lines.push('');
    lines.push(
      statLine(
        chEntries.map(([k, v]) => [input.characteristicLabels?.[k] ?? k, v] as [string, number]),
        'raw',
        '（无）'
      )
    );
  }
  const skEntries = Object.entries(character.skills).sort((a, b) => b[1] - a[1]);
  lines.push('');
  lines.push(`技能：${statLine(skEntries, skillUnit, '（无）')}`);

  // 这一局要做什么
  if (module.goal?.trim() || module.stakes?.trim() || module.urgency?.trim()) {
    lines.push('');
    lines.push('## 这一局要做什么');
    lines.push('');
    if (module.goal?.trim()) lines.push(`- **目标**：${module.goal.trim()}`);
    if (module.stakes?.trim()) lines.push(`- **赌注**：${module.stakes.trim()}`);
    if (module.urgency?.trim()) lines.push(`- **时间**：${module.urgency.trim()}`);
  }

  // 编年史
  lines.push('');
  lines.push('## 故事');
  lines.push('');
  if (input.summary?.trim()) {
    lines.push(`> 前情提要：${input.summary.trim()}`);
    lines.push('');
  }
  if (input.chronicle.length === 0) {
    lines.push('_这一局还没有记录。_');
  } else {
    for (const c of input.chronicle) {
      const loc = c.location ? `（${c.location}）` : '';
      lines.push(`${c.turn}. ${c.text}${loc}`);
    }
  }

  // 关键抉择
  if (input.anchors.length > 0) {
    lines.push('');
    lines.push('## 关键抉择');
    lines.push('');
    for (const a of input.anchors) lines.push(`- ${a.label}`);
  }

  // 线索
  if (gameState.clues.length > 0) {
    lines.push('');
    lines.push('## 找到的线索');
    lines.push('');
    for (const c of gameState.clues) lines.push(`- ${c}`);
  }

  // 结局
  if (ending) {
    lines.push('');
    lines.push('## 结局');
    lines.push('');
    lines.push(`**${kindTitle(ending.kind)}**${ending.reason ? ` · ${ending.reason}` : ''}`);
    if (ending.text) {
      lines.push('');
      lines.push(ending.text);
    }
  }

  lines.push('');
  lines.push('---');
  lines.push('');
  lines.push(
    `_由「跑团模拟器」导出${input.rulesetName ? ` · ${input.rulesetName}` : ''} · ${today(input.exportedAt)}_`
  );

  // 真相放最末尾：折叠块，且只有完整留档才有
  if (opts.withTruth) lines.push(...truthBlock(input.module.truth));

  return lines.join('\n');
}

/**
 * 完整留档 = 整体流程 + 末尾的真相折叠块。
 *
 * 这一份是给**自己**存的（或发给已经跑完这一局的人），所以带真相；
 * 对外分享请继续用 `buildJourneyMarkdown()`。
 */
export function buildArchiveMarkdown(input: ExportInput): string {
  return buildJourneyMarkdown(input, { withTruth: true });
}

/** 触发浏览器下载一个 .html 文件（带图战报用；图已内嵌，文件自包含） */
export function downloadHtml(filename: string, content: string): void {
  const blob = new Blob([content], { type: 'text/html;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/** 触发浏览器下载一个 .md 文件 */
export function downloadMarkdown(filename: string, content: string): void {
  const blob = new Blob([content], { type: 'text/markdown;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  // 立刻 revoke 会让部分浏览器来不及下载，延后释放
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/** 复制到剪贴板。失败时返回 false（调用方给降级提示） */
export async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}

/** 文件名里不能出现的字符统一换成下划线 */
export function safeFilename(name: string): string {
  return (name || '跑团').replace(/[\\/:*?"<>|]/g, '_').slice(0, 40);
}

/* ============================================================
 * 带图战报（G）
 * ============================================================ */

/** HTML 转义。战报里全是玩家和模型写的自由文本，**必须转义**后再拼 */
function esc(s: string): string {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/**
 * 生成**自包含**的带图战报（单个 .html 文件，图直接内嵌）。
 *
 * ## 为什么是 HTML 而不是 Markdown
 * 图片是 base64 data URI，塞进 Markdown 会让 .md 变成十几 MB 的怪物，
 * 而且多数 Markdown 阅读器渲染不出来。HTML 一个文件自带图、自带版式、能直接发给人看、也能打印。
 *
 * ## 两条照旧的红线
 * - **不含 `module.truth`**：战报是会被转发的，默认不剧透（完整留档那条路才带真相）。
 * - **只放配了图的节点**：这不是"完整流程导出"（那个有 Markdown 版），
 *   战报的定位是"这一局最值得回看的几个画面"。
 */
export function buildIllustratedReportHtml(input: ExportInput): string {
  const { character, module, gameState } = input;
  const scenes = input.scenes ?? [];
  const ending = gameState.ending;
  const title = esc(module.title || '跑团战报');
  const who = esc(character.name || '无名者');
  const endTitle = ending
    ? esc(
        (
          {
            death: '终幕 · 殒命',
            insanity: '终幕 · 理智尽头',
            success: '终幕 · 达成',
            failure: '终幕 · 失守',
            grey: '终幕 · 灰色',
            other: '终幕',
          } as Record<string, string>
        )[ending.kind] ?? '终幕'
      )
    : '';

  const sceneHtml = scenes.length
    ? scenes
        .map(
          (s, i) => `
  <figure class="scene">
    <figcaption>${esc(s.label || `第 ${i + 1} 幕画面`)}</figcaption>
    ${s.image ? `<img src="${s.image}" alt="">` : ''}
    <p>${esc(s.text).replace(/\n+/g, '</p><p>')}</p>
  </figure>`
        )
        .join('')
    : '<p class="none">这一局没有留下配图。在设置里打开「带图战报」，或对某一条消息手动生成即可。</p>';

  return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${title} · 战报</title>
<style>
  :root{--bg:#f6f7f9;--card:#fff;--ink:#1b1f26;--muted:#6b7684;--line:#e3e7ec;--gold:#9a7b28}
  *{box-sizing:border-box}
  body{margin:0;background:var(--bg);color:var(--ink);
    font:15px/1.85 -apple-system,BlinkMacSystemFont,"PingFang SC","Microsoft YaHei",sans-serif}
  .wrap{max-width:760px;margin:0 auto;padding:36px 20px 72px}
  h1{font-size:24px;margin:0 0 4px}
  .sub{color:var(--muted);font-size:13px;margin-bottom:26px}
  .scene{background:var(--card);border:1px solid var(--line);border-radius:12px;
    padding:14px;margin:0 0 20px}
  .scene figcaption{font-size:12px;color:var(--gold);letter-spacing:.04em;margin-bottom:8px}
  .scene img{width:100%;border-radius:8px;display:block;margin-bottom:10px}
  .scene p{margin:0 0 10px}
  .none{color:var(--muted);font-size:13px}
  .foot{margin-top:34px;padding-top:14px;border-top:1px solid var(--line);
    color:var(--muted);font-size:12px}
  @media print{body{background:#fff}.wrap{max-width:none;padding:0}
    .scene{break-inside:avoid}}
</style>
</head>
<body>
<div class="wrap">
  <h1>${title}</h1>
  <div class="sub">${who} 的这一局${endTitle ? ` · ${endTitle}` : ''}</div>
  ${sceneHtml}
  <div class="foot">
    共 ${scenes.length} 个画面 · 由跑团模拟器导出 · 本文件自包含，图片已内嵌，可直接保存或转发。
  </div>
</div>
</body>
</html>`;
}
