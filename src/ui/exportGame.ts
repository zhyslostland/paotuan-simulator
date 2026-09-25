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
import { isSelfContainedImage, imageOriginNote, REMOTE_LINK_HOURS } from '../core/imageData.js';
import type { CheckLike } from './runSummary.js';

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
  /**
   * 这一局的**全部对话**（P2-4）。
   *
   * ## 为什么要有它
   * 以前「整体流程」只读 `chronicle` —— 而 `chronicle` 是**引擎侧的事件提要**
   * （每条一句话），玩家自己写的行动原话、骰点明细、守密人的正文**都不在里面**。
   * 于是导出的东西标题写着「完整经过」，打开却只有干巴巴的提要，
   * 玩家想留个念或者复盘"我当时到底怎么说的"，全都没有。
   *
   * 现在按**回目**渲染 `messages`：玩家全文 → 检定（`checksOf`）→ GM 正文。
   *
   * ## 为什么是可选的
   * `scenes`（带图战报）那条路另有渲染方式，别的地方也复用这个接口 ——
   * 没给 `messages` 时**自动退回旧的 `chronicle` 渲染**，不炸、不报错。
   */
  messages?: ExportMessage[];
  /**
   * 关键抉择（直接给显示用的一句话，如"第3回 · 开枪 · 掷骰：射击（手枪）"）。
   *
   * `label` 是**短标签**（生成时截 16 字，见 `App.tsx`），扫一眼认得出是哪个岔路口；
   * `text` 是**玩家当时那句话的全文**（§6.3a：不再只剩 16 字截断）；
   * `checks` 是那一回的检定（§6.3a：关键检定要给出掷出与结果）。
   */
  anchors: { label: string; text?: string; checks?: CheckLike[] }[];
  rulesetName?: string;
  /** 规则包的主骰（'1d100' 走百分比、'1d20' 走加值），决定技能怎么显示 */
  mainDice?: string;
  /**
   * 带图战报用：**配了图的关键节点**，按发生顺序。
   *
   * 只有这一项会进 HTML 战报（Markdown 那三份不带图 —— 把 base64 塞进 .md 会让文件爆掉）。
   * `image` 正常是 data URI，直接内嵌进 HTML、文件自包含；
   * **但也可能是服务商的临时链接**（抓不回来时）。页脚按实际内容判，不写死"已内嵌"。
   */
  /**
   * `player` ＝ 这个画面**那一回玩家说的那句话**（§6.3b）。
   * 画面本身画的是守密人的叙事，挂上"我当时说了什么"，回看才知道这一幕是怎么来的。
   */
  scenes?: { label?: string; text: string; image?: string; player?: string }[];
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

/**
 * 导出用的一条消息（P2-4）。
 *
 * 只取导出要用的字段 —— 刻意**不收** `id` / `ts` / `sceneImage` 那些：
 * 它们进不了文本物，收进来只会让 `ExportInput` 和 `Message` 越绑越紧。
 */
export interface ExportMessage {
  role: string;
  content: string;
  /** 这条消息上挂着的全部检定（单掷 `check` + 一次多掷 `checks`） */
  checks?: CheckLike[];
}

/**
 * 「回目」——把扁平的消息流切成一轮一轮。
 *
 * 一轮 ＝ **一条玩家行动 + 其后跟着的 GM 回复**（直到下一条玩家消息为止）。
 * 为什么按这个切：玩家想复盘时问的是"我当时说了什么、世界怎么答的"，
 * 这两样必须挨在一起；而 `chronicle` 那种逐条提要恰恰把因果拆散了。
 *
 * 开头的 GM 消息（欢迎词 / 开场白）自成一回 —— 那时玩家还没说话。
 */
function roundsOf(messages: readonly ExportMessage[]): { player?: ExportMessage; gms: ExportMessage[] }[] {
  const rounds: { player?: ExportMessage; gms: ExportMessage[] }[] = [];
  for (const m of messages) {
    if (m.role === 'player') {
      rounds.push({ player: m, gms: [] });
      continue;
    }
    if (m.role === 'gm') {
      // 还没有玩家消息时（开场白），单独起一回
      if (rounds.length === 0) rounds.push({ gms: [] });
      rounds[rounds.length - 1]!.gms.push(m);
      continue;
    }
    // system / 其他角色不进「回目」——它们不是故事的一部分
  }
  return rounds;
}

/**
 * 第 `i` 条消息属于哪一回 —— 回看它**之前最近的那条玩家消息**，取它的原文。
 *
 * ## 为什么这两个函数要共用它
 * 「这一回玩家说了什么」有两个用处：带图战报要给**某一个画面**配一句（§6.3b），
 * 编年史要给**第 n 回**配一句（§6.3c）。两处是同一条判据，
 * 各写一遍就会分叉（一个往前找、一个按顺序对齐，迟早对不上）。
 */
function playerLineAt(messages: readonly ExportMessage[], i: number): string | undefined {
  for (let k = i; k >= 0; k--) {
    const m = messages[k];
    if (m && m.role === 'player') return stripContract(m.content).trim() || undefined;
  }
  return undefined;
}

/**
 * 给消息流里**每一条**消息标上"它那一回玩家说了什么"，返回与 `messages` 等长的数组。
 * 开场白那一回还没有玩家发言，值为 `undefined`。
 */
export function roundPlayerLines(
  messages: readonly ExportMessage[]
): (string | undefined)[] {
  return messages.map((_, i) => playerLineAt(messages, i));
}

/**
 * 每一回的玩家原文，**按回目顺序**（第 n 项 ↔ 第 n 回）。
 *
 * 编年史是一个回合一条，玩家消息也是一个回合一条 —— 所以按下标对齐就是按回目对齐
 * （`chronicle[i]` ↔ 第 `i` 条玩家消息）。没有玩家发言的回目留空串，
 * **不下标**：下移会让后面每一回都错位一格。
 */
export function playerLinesByRound(messages: readonly ExportMessage[]): string[] {
  const out: string[] = [];
  messages.forEach((m, i) => {
    if (m.role === 'player') out.push(playerLineAt(messages, i) ?? '');
  });
  return out;
}

/**
 * 把一组检定渲染成一行（骰点明细）。
 *
 * 为什么保留 `roll` / `target`：这是**玩家想复盘的部分** ——
 * "那一把我掷了多少、差多少"是跑团最有实感的东西，只写"成功了"等于没写。
 */
function checkLine(checks: readonly CheckLike[]): string {
  return checks
    .map((c) => {
      const tier = c.tier && c.tier !== c.label ? ` ${c.tier}` : '';
      /*
       * §6.4：带上这次检定**由何而来**。
       * 没有它，记录层里只剩"侦查 60% 掷 22 成功"这一行数字，
       * 玩家看不出自己当时是在听门后的响动、还是在搜抽屉。
       */
      const why = c.reason?.trim();
      const head = `🎲 ${c.skill}：掷 ${c.roll} / 目标 ${c.target} → ${c.label}${tier}`;
      return why ? `${head}\n   　└ ${why}` : head;
    })
    .join('\n');
}

/**
 * 洗掉正文里可能残留的 JSON 契约块。
 *
 * ⚠️ **不要假设调用方已经洗过**：`EndingScreen` 走 `visible()` 出来的内容确实是干净的，
 * 但 `buildJourneyMarkdown` 是个导出纯函数，别的地方（测试、将来的入口）也会直接调它。
 * 契约块里是 `state_delta` 这种给引擎看的字段，漏进玩家留档里就是事故 ——
 * 洗一次的代价极小，漏一次的代价是"内部指令进了纪念物"。
 *
 * 与 `App.tsx` 的 `visible()` 用同一个判据（从 ```json 起全部截掉）。
 */
function stripContract(s: string): string {
  const i = s.search(/```json/i);
  return (i >= 0 ? s.slice(0, i) : s).trim();
}

/**
 * 按**回目**渲染整局的对话（P2-4）。
 *
 * 输出形如：
 * ```
 * ### 第 3 回
 *
 * > 我推开门走进去。
 *
 * 🎲 侦查：掷 42 / 目标 55 → 成功
 *
 * 门后是一条走廊……
 * ```
 * 回调用的 `content` 已经由调用方洗干净（不含 json 契约块）。
 */
function renderRounds(messages: readonly ExportMessage[]): string[] {
  const rounds = roundsOf(messages);
  const out: string[] = [];
  rounds.forEach((r, i) => {
    // 完全空的一回（既没玩家也没 GM）不占编号
    if (!r.player && r.gms.length === 0) return;
    out.push('');
    out.push(`### 第 ${i + 1} 回`);
    if (r.player) {
      out.push('');
      // 玩家原话用引用块：一眼分得清"这是我说的话"
      for (const line of stripContract(r.player.content).split('\n')) out.push(`> ${line}`);
    }
    /*
     * 检定**挂在 GM 那条消息上** —— 玩家点「掷骰」之后，结果写回的是守密人那一轮的回复
     * （单掷进 `check`、一次多掷进 `checks`，见 `runSummary.checksOf`）。
     * 所以要把这一回里**所有**消息的检定都收上来，不能只看玩家的。
     */
    const checks = [...(r.player?.checks ?? []), ...r.gms.flatMap((g) => g.checks ?? [])];
    if (checks.length) {
      out.push('');
      out.push(checkLine(checks));
    }
    for (const g of r.gms) {
      const body = stripContract(g.content);
      if (!body) continue;
      out.push('');
      out.push(body);
    }
  });
  return out;
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

  /*
   * §6.3a：结算分享补上**关键行动的全文** + 关键检定。
   *
   * 以前这一份只有「关键抉择：N 个」一个光秃秃的计数 ——
   * 玩家发出去之后，别人（包括他自己）根本看不出那些岔路口上**他到底做了什么**。
   *
   * 只列**锚点那几条**（不是全部行动），所以信息够了但仍然是短的。
   * 行动用**全文**，不再走 `App.tsx` 生成 label 时的 16 字截断 ——
   * 那 16 字是给"扫一眼认出是哪个岔路口"用的短标签，不是记录。
   */
  const acted = input.anchors.filter((a) => a.text?.trim() || a.checks?.length);
  if (acted.length > 0) {
    lines.push('');
    lines.push(`### 关键行动（${acted.length}）`);
    for (const a of acted) {
      lines.push('');
      lines.push(`**${a.label}**`);
      const said = a.text?.trim();
      if (said) {
        lines.push('');
        for (const ln of said.split('\n')) lines.push(`> ${ln}`);
      }
      if (a.checks?.length) {
        lines.push('');
        lines.push(checkLine(a.checks));
      }
    }
  }

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

  /*
   * 故事（P2-4）。
   *
   * 有 `messages` 就**按回目渲染全文** —— 玩家原话 + 骰点 + GM 正文，这才是
   * "完整经过"该有的样子。编年史提要**照样留着**（放在前面）：它条数少、
   * 一眼能扫完，适合先看个骨架，再往下读每一回的细节。
   *
   * 没有 `messages`（老调用处 / 只想要提要）时**自动退回**旧渲染，行为不变。
   */
  const hasRounds = !!input.messages && input.messages.some((m) => m.role === 'player' || m.role === 'gm');
  if (input.summary?.trim()) {
    lines.push('');
    lines.push(`> 前情提要：${input.summary.trim()}`);
  }
  if (input.chronicle.length > 0) {
    lines.push('');
    lines.push('## 故事梗概');
    lines.push('');
    for (const c of input.chronicle) {
      const loc = c.location ? `（${c.location}）` : '';
      lines.push(`${c.turn}. ${c.text}${loc}`);
    }
  }
  if (hasRounds) {
    lines.push('');
    lines.push('## 逐回经过');
    lines.push(...renderRounds(input.messages!));
  } else if (input.chronicle.length === 0) {
    lines.push('');
    lines.push('_这一局还没有记录。_');
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

/** 触发浏览器下载一个 .html 文件（带图战报用） */
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
 * 生成带图战报（单个 .html 文件）。
 *
 * ## 自包含**不是承诺，是结果**
 * 图是 data URI 时文件才真的自包含；要是哪张图只剩服务商的临时链接
 * （`core/imageData.ts` 判的），页脚会**如实说它会失效**，绝不写"已内嵌"。
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
    <p>${esc(s.text).replace(/\n+/g, '</p><p>')}</p>${
      /*
       * §6.3b：画面下挂**这一回玩家说了什么**。
       * 战报原先只有守密人的叙事，回看时"这一幕是怎么来的"完全靠猜。
       * 玩家原话一律 `esc()` 转义（与正文同一条规矩，战报是自包含 HTML）。
       */
      s.player?.trim()
        ? `
    <blockquote class="said"><span class="who">当时我说</span>${esc(s.player.trim()).replace(/\n+/g, '<br>')}</blockquote>`
        : ''
    }
  </figure>`
        )
        .join('')
    : '<p class="none">这一局没有留下配图。在设置里打开「带图战报」，或对某一条消息手动生成即可。</p>';

  /*
   * 页脚**不许撒谎**（P2-3）。
   *
   * 以前这里写死"本文件自包含，图片已内嵌"—— 可只要有一张图是服务商给的临时链接，
   * 这句话就是把玩家往坑里推：他转发出去，别人打开是一排裂图，而他毫不知情。
   * 现在按实际内容判：只要有一张不是自包含的，就如实说它会失效。
   */
  const linkedCount = scenes.filter((s) => s.image && !isSelfContainedImage(s.image)).length;
  // 一张图都没有时**不提这茬**（"图片已内嵌"在没图的时候是句空话，也容易被误读）
  const footNote =
    scenes.length === 0
      ? '这一局没有配图，可随时回游戏里补几张再导出。'
      : imageOriginNote(linkedCount > 0, REMOTE_LINK_HOURS);

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
  /* §6.3b：画面下挂玩家原话。左边一道金线，一眼分得清"这是我说的话" */
  .scene .said{margin:10px 0 0;padding:2px 0 2px 10px;border-left:2px solid var(--gold);
    color:#4a5462;font-size:13px;line-height:1.7}
  .scene .said .who{display:block;color:var(--gold);font-size:11px;letter-spacing:.04em;
    margin-bottom:2px}
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
    共 ${scenes.length} 个画面 · 由跑团模拟器导出 · ${footNote}
  </div>
</div>
</body>
</html>`;
}
