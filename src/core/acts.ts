/**
 * 幕结构 —— R14「长模组进章按需展开」的引擎侧。
 *
 * ## 为什么要有这一层
 * 长篇模组**不可能一次性写完**：数周的时间跨度、几十个场景、一群各有动机的人，
 * 一次生成只能给出骨架（生成时也确实是这么要的：`maxTokens` 6144，只够写大纲）。
 * 于是原来的做法是**把整段骨架塞进每一轮的提示词**，让守密人自己从里面挑 ——
 * 结果是长篇跑到中段就开始"记不清前面写过谁、这一章该往哪推"。
 *
 * 这一层把"幕"从一段自由文本变成**可推进的结构**：
 *   - 解析出第几幕、每幕叫什么；
 *   - 记住**当前跑到第几幕**；
 *   - 到新的一幕时，**按需把它展开成导演稿**（只展开这一幕，不展开别的）；
 *   - 展开稿里写明"这一幕要发生什么、谁会先动手、哪些线索该露头、怎么算收束"，
 *     并且**只写这一幕** —— 后面几幕留给后面，免得又一次写空。
 *
 * ## 三条硬规矩
 * 1. **已定事实不得改写**：展开稿只描述"从现在往后"，绝不重写编年史里已经发生过的事。
 * 2. **不剧透**：展开稿是 GM 内部资料，**绝不能给玩家看**（UI 里要遮罩）。
 * 3. **没有幕结构也能玩**：`acts` 为空（手写模组 / 短模组）时整层静默失效，
 *    退回"把 acts 原文塞进提示词"的老行为 —— 绝不能因为解析不出幕就挡住玩家。
 */

/** 一幕 */
export interface ActItem {
  /** 0 起 */
  index: number;
  /** 幕名（"接案与试探"）；解析不出来时用摘要代替 */
  title: string;
  /** 这一幕要发生什么（原文里冒号后面那段） */
  summary: string;
}

/** 中文数字 → 阿拉伯数字（只处理幕序号会用到的一到二十） */
const CN_NUM: Record<string, number> = {
  一: 1, 二: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9, 十: 10,
  十一: 11, 十二: 12, 十三: 13, 十四: 14, 十五: 15,
};

/** 幕标记：第X幕 / 第X章 / Act X —— 后面允许跟 ·、,：: 空格 */
const ACT_MARK = /第\s*([一二三四五六七八九十\d]{1,3})\s*[幕章]|Act\s*(\d{1,2})/gi;

/** 把标出来的序号转成 1 起的数字；认不出就返回 0 */
function markNumber(raw: string): number {
  const t = raw.trim();
  if (/^\d+$/.test(t)) return parseInt(t, 10);
  return CN_NUM[t] ?? 0;
}

/**
 * 从 `module.acts` 那段自由文本里解析出幕列表。
 *
 * 两种写法都得认（作者和模型都这么写过）：
 *   - **一行一幕**：`第一幕 · 接案与试探：委托人有所隐瞒…`
 *   - **挤在一行**：`第一幕：走访码头；第二幕：进小屋找痕迹；第三幕：甲板脱身`
 *
 * 认不出任何幕标记时返回**空数组** —— 调用方据此退回老行为，不是报错。
 */
export function parseActs(text: string | undefined | null): ActItem[] {
  const t = String(text ?? '').trim();
  if (!t) return [];

  // 先按行切；只有一行时再按"分号 / 幕标记"切
  let chunks: string[] = t
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean);

  if (chunks.length <= 1) {
    chunks = t
      .split(/[；;]/)
      .map((l) => l.trim())
      .filter(Boolean);
  }
  // 还是切不开 → 直接在幕标记前面断开
  if (chunks.length <= 1 && (t.match(ACT_MARK) ?? []).length > 1) {
    chunks = t
      .split(/(?=第\s*[一二三四五六七八九十\d]{1,3}\s*[幕章])/)
      .map((l) => l.trim())
      .filter(Boolean);
  }

  const out: ActItem[] = [];
  for (const raw of chunks) {
    ACT_MARK.lastIndex = 0;
    const m = ACT_MARK.exec(raw);
    if (!m) continue;
    const n = markNumber(m[1] ?? m[2] ?? '');
    if (n <= 0) continue;
    // 去掉"第X幕"和紧跟的分隔符，剩下的按第一个冒号切成 标题 / 摘要
    let rest = raw.slice(m.index + m[0].length).replace(/^[\s·、,，.。:：-]+/, '');
    const colon = rest.search(/[:：]/);
    let title = '';
    let summary = rest;
    if (colon > 0) {
      title = rest.slice(0, colon).trim();
      summary = rest.slice(colon + 1).trim();
    }
    if (!title) title = summary.slice(0, 10);
    out.push({ index: n - 1, title: title || `第 ${n} 幕`, summary });
  }

  // 按幕号排好、去重（同一幕写了两遍时保留信息更多的那条）
  out.sort((a, b) => a.index - b.index);
  const dedup = new Map<number, ActItem>();
  for (const a of out) {
    const prev = dedup.get(a.index);
    if (!prev || a.summary.length > prev.summary.length) dedup.set(a.index, a);
  }
  return [...dedup.values()];
}

/** 取第 `index` 幕；越界返回 null（调用方据此判断"跑完了"） */
export function actAt(acts: readonly ActItem[], index: number): ActItem | null {
  if (!Number.isFinite(index) || index < 0) return null;
  return acts.find((a) => a.index === index) ?? null;
}

/** 当前幕号（`undefined` 一律当第一幕）。返回 0 起的下标 */
export function normalizeActIndex(index: number | undefined): number {
  return Number.isFinite(index) && (index as number) > 0 ? Math.floor(index as number) : 0;
}

/** 这一幕展开过没有（空白一律算没展开） */
export function isActExpanded(detail: string | undefined | null): boolean {
  return String(detail ?? '').trim().length > 0;
}

/**
 * 展开稿的"导演稿"要求（喂给模型）。
 *
 * 刻意写得**克制**：只交代"这一幕的走向与终点"，不写台词、不写逐场景脚本 ——
 * 写细了守密人反而会照本宣科，玩家的自由就没了（北极星①）。
 * 它要的是**知道这一幕该往哪走**，而不是**替玩家把这一幕演完**。
 */
export const ACT_EXPAND_SPEC = `你正在为一场已经开跑的长篇跑团做**这一幕的导演稿**。

只写**当前这一幕**，不要写后面几幕的内容。

必须交代清楚（用简洁的分点，不要写成剧本）：
1. **这一幕的走向**：从现在起局面该往哪个方向推，到哪一步算这一幕结束。
2. **谁会先动手**：这一幕里关键人物各自的打算与下一步动作（玩家不动时事情也会往前跑）。
3. **该露头的线索**：这一幕里玩家有机会发现什么（按他的行动给，别硬塞）。
4. **时间与环境的变化**：日子过去多少、什么在恶化、什么在逼近。
5. **收束条件**：什么样的情况算这一幕收束了（之后该进下一幕）。

**三条不许**：
- **不许改写已经发生的事**。前面剧情里定下来的事实（谁死了、拿了什么、去过哪）**必须遵守**，
  只能往后写。
- **不许替玩家做决定**。不要写"玩家会去 X""玩家选择 Y"——只写世界这一侧的动向。
- **不许写成剧本**。不要写台词、不要写逐场景的分镜；给的是方向与终点，不是台词本。`;
