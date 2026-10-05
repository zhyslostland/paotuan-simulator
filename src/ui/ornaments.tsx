/**
 * 装饰件（阶段 3 · 路数重定，2026-10-02）。
 *
 * ## 为什么是手写 SVG，不是生图（主人原话）
 * 「**目前的美术我没看到需要调用生图额度的质量**」。
 * 四条理由，写在这里免得下次又走回头路：
 *
 * 1. **需求与生图能力相斥**：这些件要的是「自然 > 不突兀 > 耐看 > 清爽」＝
 *    **低对比、无细节、当衬底**；生图擅长的是细节/光影/质感。
 *    等我们把它压到 18% 透明度、24px 大小，它的细节**全丢了** ——
 *    花额度买细节，再把细节扔掉，只留下"一团形状"。而形状，矢量做得更准。
 * 2. **位图不随主题变色**（结构性缺陷）：项目有两套主题（羊皮纸浅 / 午夜深）。
 *    这里全部用 `currentColor`，**一套代码两套主题各自成立**；位图做不到 ——
 *    一张 WebP 只能有一个颜色，在午夜主题里就是"深色界面贴着一片米黄"。
 * 3. **装饰的本质是几何**：线宽、对称、圆角、角度。生图在"猜"精确几何上必输
 *    （角饰不对称、线不匀、框不齐、边缘有毛点）—— 那跟提示词无关。
 * 4. **同一套画法**：线宽与 `icons.tsx` 共享（1.15 / 1.25），
 *    这正是复盘里说的「归属属性」—— 装饰与图标看起来是**同一只手做的**。
 *
 * ## 用法
 * 颜色一律由调用处的 `className` 给（如 `text-gold-600`），
 * 组件内部只用 `currentColor` —— **别在这里写死颜色**。
 *
 * 方案与取舍：`docs/报告/方案-美术资产路数重定.md`
 */
import type { ReactNode } from 'react';

export interface OrnamentProps {
  /** 边长（px）。默认按各件形状给 —— 都接近它的"自然尺寸" */
  size?: number;
  className?: string;
}

/**
 * 统一画法。**改这里等于改一整套**，别在单个件里写死。
 *
 * 线宽比 `icons.tsx`（1.75）细一档：图标是信息（要看清），
 * 装饰是衬底（要退后）—— 同一个人干活，但轻重不同。
 */
const BASE = {
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 1.15,
  strokeLinecap: 'round' as const,
  strokeLinejoin: 'round' as const,
} as const;

function Svg({
  w,
  h,
  size,
  className,
  children,
  strokeWidth,
}: {
  w: number;
  h: number;
  size?: number;
  className?: string;
  children: ReactNode;
  strokeWidth?: number;
}) {
  // 等比：只给宽，高按 viewBox 比例走
  const width = size ?? w;
  return (
    <svg
      width={width}
      height={(width / w) * h}
      viewBox={`0 0 ${w} ${h}`}
      className={className}
      aria-hidden="true"
      {...BASE}
      {...(strokeWidth ? { strokeWidth } : {})}
    >
      {children}
    </svg>
  );
}

/* ────────────────────────────────────────────────────────────────────────
 * 分隔线：一条会自己收尾的细线 + 中央一枚小菱点
 *
 * ⚠️ 它是**纯 CSS**（不是 SVG），因为要铺满任意宽度：
 * 用 SVG 就得 `preserveAspectRatio="none"`，中央那枚菱形会被横向拉扁。
 * 两端用渐变**收尾**（不是硬切）—— 这比生图画的"对称卷叶"安静，也更像真的排版件。
 * 高度只有 6px：**装饰不许占版面**（主人 2026-10-02：「右边无意义的花纹占用版面了」）。
 * ──────────────────────────────────────────────────────────────────────── */
export function OrnamentRule({ className }: { className?: string }) {
  return (
    <div className={`flex items-center gap-2 ${className ?? ''}`} aria-hidden="true">
      <span className="h-px flex-1 bg-gradient-to-r from-transparent to-gold-600/45" />
      <span className="h-1.5 w-1.5 shrink-0 rotate-45 border border-gold-600/55" />
      <span className="h-px flex-1 bg-gradient-to-l from-transparent to-gold-600/45" />
    </div>
  );
}

/* ────────────────────────────────────────────────────────────────────────
 * 角饰：右上角一个直角压印线，配一枚小菱
 *
 * **只画一个角**，调用处用 `scale-x-100` / `-scale-y-100` 等镜像出四角 ——
 * 这保证四角**真的对称**（生图那张做不到，这是主人说的"没那个质量"之一）。
 * 镜像时把 `size` 与 `className` 一起传，四份是同一个组件。
 * ──────────────────────────────────────────────────────────────────────── */
export function OrnamentCorner({ size = 32, className }: OrnamentProps) {
  return (
    <Svg w={24} h={24} size={size} className={className}>
      {/* 外层直角（朝内的那一面），转角带一点圆 */}
      <path d="M13.5 0.7H1.6a0.9 0.9 0 0 0-0.9 0.9V13.5" />
      {/* 内层短直角：压印的"第二道线"，让角有厚度 */}
      <path d="M8.6 4.4H4.4v4.2" opacity="0.55" />
      {/* 收束的小菱 */}
      <path d="M10.6 3.3l1.5 1.5-1.5 1.5-1.5-1.5z" />
    </Svg>
  );
}

/* ────────────────────────────────────────────────────────────────────────
 * 应用章纹：外环 + 内环 + 四向刻度 + 中央摊开的书 + 星芒
 *
 * 符号是**中性的**（书 / 星 / 骰点）—— 不指向任何题材
 * （主人：「不用出七版」；与「不为某一题材写死界面」同一条铁律）。
 * ──────────────────────────────────────────────────────────────────────── */
export function OrnamentEmblem({ size = 26, className }: OrnamentProps) {
  return (
    <Svg w={48} h={48} size={size} className={className}>
      <circle cx="24" cy="24" r="21.4" />
      <circle cx="24" cy="24" r="17.6" opacity="0.5" />
      {/* 四向刻度：把"环"变成"刻度盘"，比光秃秃两个圈有内容 */}
      <path d="M24 3.2v4M24 44.8v-4M3.2 24h4M44.8 24h-4" opacity="0.7" />
      {/* 中央：一本摊开的书（一局的开始，永远是最先被读到的东西） */}
      <path d="M24 19.4c-2.7-1.7-5.8-2.2-8.8-1.7v10.5c3-.5 6.1 0 8.8 1.7 2.7-1.7 5.8-2.2 8.8-1.7V17.7c-3-.5-6.1 0-8.8 1.7z" />
      <path d="M24 19.4v10.5" opacity="0.75" />
      {/* 上方星芒 */}
      <path d="M24 7.4v4.2M21.9 9.5h4.2" />
      {/* 下方骰点 */}
      <circle cx="24" cy="36.4" r="1.25" fill="currentColor" stroke="none" />
    </Svg>
  );
}

/* ────────────────────────────────────────────────────────────────────────
 * 骰子：六面骰（"检定"这个动作最直白的记号）
 *
 * 没用 d20 —— 二十面体的轮廓在 24px 下会糊成一团，六面骰一样达意。
 * ──────────────────────────────────────────────────────────────────────── */
export function OrnamentDice({ size = 28, className }: OrnamentProps) {
  return (
    <Svg w={24} h={24} size={size} className={className}>
      <rect x="3.6" y="3.6" width="16.8" height="16.8" rx="3" />
      {[
        [8.4, 8.4],
        [15.6, 8.4],
        [12, 12],
        [8.4, 15.6],
        [15.6, 15.6],
      ].map(([cx, cy]) => (
        <circle key={`${cx}-${cy}`} cx={cx} cy={cy} r="1.2" fill="currentColor" stroke="none" />
      ))}
    </Svg>
  );
}

/* ────────────────────────────────────────────────────────────────────────
 * 火漆印：结档 / 重要标记
 *
 * 一局只看一次（曝光排序里排最后），所以它可以是这几个件里最"实"的一个。
 * ──────────────────────────────────────────────────────────────────────── */
export function OrnamentSeal({ size = 28, className }: OrnamentProps) {
  return (
    <Svg w={24} h={24} size={size} className={className}>
      <circle cx="12" cy="12" r="9.2" />
      <circle cx="12" cy="12" r="6.4" opacity="0.5" />
      <path d="M12 8.6l0.88 2.39 2.42 0.1-1.86 1.57 0.63 2.35L12 13.7l-2.07 1.31 0.63-2.35-1.86-1.57 2.42-0.1z" />
    </Svg>
  );
}

/* ────────────────────────────────────────────────────────────────────────
 * 缎带：故事收尾的"打了个结"
 * ──────────────────────────────────────────────────────────────────────── */
export function OrnamentRibbon({ size = 44, className }: OrnamentProps) {
  return (
    <Svg w={48} h={12} size={size} className={className}>
      <path d="M4 6h10.5M33.5 6h10.5" />
      <path d="M18 3.1l2.6 2.9-2.6 2.9-2.6-2.9z" />
      <path d="M30 3.1l2.6 2.9-2.6 2.9-2.6-2.9z" />
      <circle cx="24" cy="6" r="2.3" />
    </Svg>
  );
}

/* ────────────────────────────────────────────────────────────────────────
 * 极简线稿（空态 / 加载页）
 *
 * 线宽比上面那几件再细一点点：这几张要"一整天看着都不烦"，
 * 靠的是**留白**，不是内容（美术规范 §八：清爽）。
 * ──────────────────────────────────────────────────────────────────────── */

export type LineArtName =
  /** 还没有线索：一本摊开的本子 + 一支羽毛笔 */
  | 'notes'
  /** 还没有关键抉择 / 尚未发现线索：一枚放大镜 */
  | 'clues'
  /** 加载中：沙漏 */
  | 'hourglass';

export function LineArt({
  name,
  size = 40,
  className,
}: OrnamentProps & { name: LineArtName }) {
  const art = (() => {
    switch (name) {
      case 'notes':
        return (
          <>
            <path d="M11.6 7.6C9.4 6.2 6.9 5.8 4.4 6.2v10c2.5-.4 5 0 7.2 1.4 2.2-1.4 4.7-1.8 7.2-1.4v-10c-2.5-.4-5 0-7.2 1.4z" />
            <path d="M11.6 7.6v10" opacity="0.6" />
            {/* 羽毛笔：斜插在本子上方 */}
            <path d="M19.2 3.6l1.4 1.4-4.2 5-2.4.8.8-2.4z" />
          </>
        );
      case 'clues':
        return (
          <>
            <circle cx="10.4" cy="10" r="5.2" />
            <path d="M14.2 13.8l4.4 4.4" />
            {/* 压着的几张纸片（两条错开的边，比画矩形干净） */}
            <path d="M3.6 20.4h6.8M14.2 20.4h6.2" opacity="0.6" />
          </>
        );
      case 'hourglass':
        return (
          <>
            <path d="M7 4.5h10M7 19.5h10" />
            <path d="M8.4 4.5c0 3 3.6 4.4 3.6 7.5s-3.6 4.5-3.6 7.5" />
            <path d="M15.6 4.5c0 3-3.6 4.4-3.6 7.5s3.6 4.5 3.6 7.5" />
            <path d="M9.5 17.2h5" opacity="0.6" />
          </>
        );
    }
  })();

  return (
    <Svg w={24} h={24} size={size} className={className} strokeWidth={1.25}>
      {art}
    </Svg>
  );
}
