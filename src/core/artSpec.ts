/**
 * 美术规格真源（阶段 0-1 · 0-2）
 *
 * ## 为什么单独成文件
 * 规格（尺寸、色板）原先散在三处：`Settings.tsx` 的输入框默认值、
 * `store.ts` 里 `config.imageSize || '1024x1024'` 的兜底、以及各 `*ImagePrompt`
 * 里的构图文字。三处各写各的 → **四类图共用一张 1024×1024 方图**：
 * 立绘被裁成半身、场景没有广角。规格必须只有一个真源，改一处全局生效。
 *
 * ## 纯函数、无 IO、不依赖 ui
 * 铁律：`core` 不许反向依赖 `ui`。所以 `ArtKind` 定义在**这里**，
 * `ui/imageJobs.ts` 的 `ImageJobKind` 只是它的别名（方向是 ui → core）。
 *
 * 配套的人读文档＝根目录 `美术规范.md`（色板卡与构图规范的可核对版本）。
 */

/**
 * 一张图是给谁画的 —— 与 `ui/imageJobs.ts` 的 `ImageJobKind` 是同一个东西。
 * 定义放在 core，避免 core 反向依赖 ui。
 */
export type ArtKind =
  /** 某条消息的插画（第三视角，配那一段叙事） */
  | 'action'
  /** 某个地点的场景图 */
  | 'scene'
  /** 整个世界的地图 */
  | 'map'
  /** 角色立绘（玩家 / 同行者 / 关键剧情人物） */
  | 'portrait'
  /**
   * 怪物形象（1-F 新增）。
   *
   * ## 与 `portrait` 分开的理由
   * 尺寸、构图、**存档落点**全都不同：立绘落在 `character.portrait` 或
   * `companions[].portrait`，而怪物形象落在 `gameState.foeArt`（按名字索引）。
   * 合成一类的话 `applyImageResult` 里就得按 target 再分叉一次 ——
   * 那是"加分支"，与「加东西不加分支」相悖。
   *
   * ⚠️ 尺寸与立绘相同（768×1024 竖版）：怪物是**主体**，
   * 该给竖版特写而不是塞进场景广角里（报告 §2.3bis 三条理由）。
   */
  | 'monster'
  /**
   * 人物头像（阶段 2 · 计划 2-3）—— 方版。
   *
   * ## 为什么关键人物不用 `portrait` 的 3:4
   * 这类图的用途是**认人**（档案卡里那 9rem 的小图、以及"谁在这儿"这类位置），
   * 而 3:4 的竖版全身塞进方框会被左右裁掉。方版才是"头像"该有的规格。
   *
   * ## 存哪儿
   * 仍落 `gameState.foeArt`（`npc:<名字>` → 去掉前缀后按名字索引），
   * 与怪物共用同一张表 —— **不新增字段、不升 `SAVE_VERSION`**。
   *
   * ## 与 `portrait` 的关系（**不是二选一**）
   * 玩家与同行者仍走 `portrait`（竖版立绘）；只有**关键剧情人物**走 `avatar`。
   */
  | 'avatar';

/** 六类的全集（新增 kind 时必须同步补 —— 有断言钉着） */
export const ART_KINDS: readonly ArtKind[] = [
  'action',
  'scene',
  'map',
  'portrait',
  'monster',
  'avatar',
] as const;

/**
 * 🔴 **切图规格：按类型分构图**（2026-09-25 主人拍板，2026-09-26 落地）
 *
 * | 类型 | 尺寸 | 比例 | 为什么 |
 * |---|---|---|---|
 * | `portrait` 立绘 | 768×1024 | 3:4 | 竖版半身/全身，方图会把人物裁成半身 |
 * | `monster` 怪物 | 768×1024 | 3:4 | 与立绘同规格：怪物是主体，该给竖版特写 |
 * | `avatar` 头像 | 768×768 | 1:1 | 关键人物**认人**用：方版塞进方框不裁脸 |
 * | `scene` 场景 | 1024×576 | 16:9 | 广角全景，方图没有广角感 |
 * | `map` 地图 | 1024×1024 | 1:1 | 俯视区域图，方形最自然 |
 * | `action` 插画 | 1024×1024 | 1:1 | 正文里的小图，方形嵌在段落间不抢版 |
 *
 * ⚠️ **格式必须是 `1024x576` 这种 ASCII 小写 `x`**，不是 `1024×576`：
 * 这是直接塞进生图接口 `size` 字段的值（见 `providers/model.ts` 的 `generateImage`）。
 * 给人看的乘号版本走 `formatSize()`。
 */
export const ART_SIZES: Record<ArtKind, string> = {
  portrait: '768x1024',
  monster: '768x1024',
  avatar: '768x768',
  scene: '1024x576',
  map: '1024x1024',
  action: '1024x1024',
};

/**
 * 这一类图该用多大。
 *
 * **不认识的 kind 回落到方图**：返回一个能用的值，好过抛异常把生图整条链打断
 * （与 `getGenre` 找不回落克苏鲁同一条口径）。
 */
export function defaultImageSizeFor(kind: ArtKind): string {
  return ART_SIZES[kind] ?? ART_SIZES.action;
}

/** 拆 `1024x576` → `{ w: 1024, h: 576 }`；认不出返回 null（不抛） */
export function sizeParts(size: string): { w: number; h: number } | null {
  const m = /^\s*(\d+)\s*[x×]\s*(\d+)\s*$/i.exec(size ?? '');
  if (!m) return null;
  const w = Number.parseInt(m[1]!, 10);
  const h = Number.parseInt(m[2]!, 10);
  if (!Number.isFinite(w) || !Number.isFinite(h) || w <= 0 || h <= 0) return null;
  return { w, h };
}

/** 给人看的版本：`1024x576` → `1024×576` */
export function formatSize(size: string): string {
  const p = sizeParts(size);
  return p ? `${p.w}×${p.h}` : size;
}

/** 宽高比；认不出返回 null */
export function aspectOf(size: string): number | null {
  const p = sizeParts(size);
  return p ? p.w / p.h : null;
}

/**
 * 这一类图的宽高比，给 **UI 撑容器**用（CSS `aspect-ratio` 的值，如 `3 / 4`）。
 *
 * ## 🔴 为什么这个函数非有不可（2026-09-26 的 bug）
 * 上一步只把**生成尺寸**按类型分开了，**展示容器却还是方框**：
 * 3:4 的竖版立绘塞进 1:1 的框 + `object-cover` → 上下各裁一半 →
 * **玩家看到的是"头顶少一截"**。生成对了、展示没对，等于没对。
 *
 * 所以展示比例必须与生成尺寸**同源** —— 两边都从 `ART_SIZES` 推，改一处两边一起变。
 */
export function aspectRatioOf(kind: ArtKind): string {
  const p = sizeParts(ART_SIZES[kind]);
  return p ? `${p.w} / ${p.h}` : '1 / 1';
}

/**
 * 「这是竖版吗」——UI 上决定用竖框还是横框展示。
 *
 * 不写死比例等于 0.75，只判方向：以后微调尺寸（比如 832×1216）不该让 UI 判断失效。
 */
export function isPortraitSize(size: string): boolean {
  const a = aspectOf(size);
  return a !== null && a < 1;
}

/** 玩家手动填的尺寸能不能用（设置页据此提示，不拦） */
export function isValidSize(size: string): boolean {
  return sizeParts(size) !== null;
}

/* ============================================================
 * 色板（阶段 0-1）
 * ============================================================ */

/**
 * 赛璐璐插画**基准色板** —— 跨题材的中性参照，不是"唯一指定配色"。
 *
 * ## 怎么用（重要，别误读）
 * 它的用途是**给人看的基准**（出图时对照、筛选时判断"像不像同一套"），
 * 以及后续 UI 资产（阶段 1）取色。**刻意不拼进生图提示词**：
 * 1. 提示词里给十六进制值，绘图模型的响应很弱（它按语义画，不按色号调）；
 * 2. 真塞进去反而会**压掉题材差异** —— 克苏鲁该阴郁、奇幻该明亮，
 *    统一色号会让七个题材长得一样。题材色彩由各 `genre.imageStyle` 自己说。
 *
 * ⚠️ 所以：**题材可以用完全不同的色相**，要守的是**明度关系**
 * （阴影比中间调暗、高光比中间调亮、描边最深），那才是"同一质感"的来源。
 */
export const ART_PALETTE = {
  /** 主色：画面里占比最大的中低饱和色（中间调基准） */
  primary: ['#8d879c', '#a8967e', '#7f8f7a', '#9c8a92', '#8a97a8'] as const,
  /** 辅色：与主色相邻、用于区分材质与区域的第二组（比主色亮或饱和一点） */
  secondary: ['#c9622f', '#3f6fa8', '#b8933a', '#5f8f6a', '#a4506f'] as const,
  /**
   * 阴影：**有彩色**的深色 —— 赛璐璐的关键规矩是**不用纯黑压暗**，
   * 而是往冷紫/深蓝偏，这样色块才"干净"而不是"脏"。
   */
  shadow: ['#3a3550', '#2f3a4d', '#403546', '#35403c', '#463d33'] as const,
  /** 高光：偏暖的白，别用纯白（纯白会把色块打穿） */
  highlight: ['#f4efe4', '#f7f0e6', '#f2eee2'] as const,
  /** 描边：近黑但**不是纯黑** —— 纯黑描边在浅底上显硬、在暗底上显脏 */
  line: '#231f2b',
} as const;

/** 色板里所有色值拍平成一个数组（断言与文档核对用） */
export function allPaletteColors(): string[] {
  return [
    ...ART_PALETTE.primary,
    ...ART_PALETTE.secondary,
    ...ART_PALETTE.shadow,
    ...ART_PALETTE.highlight,
    ART_PALETTE.line,
  ];
}
