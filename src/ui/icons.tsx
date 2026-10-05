/**
 * 功能图标集（阶段 1-1）
 *
 * ## 为什么是**手写 SVG**，不是 AI 生图
 * 计划给了两条路（"简单几何图标可由实现方直接手写 SVG（更锐利且改起来快）"），选这条：
 * - **不糊**：矢量，24/32/48px 都一样锐利（位图缩放必糊）
 * - **跟随主题**：用 `currentColor`，羊皮纸改了色自动跟上，不用重出一套
 * - **体积极小**：20 个图标加起来不到 4KB（生图一张就几百 KB）
 * - **可微调**：改一根线是改一行数字，不是重新生成碰运气
 *
 * ## 一条统一画法（"同一套线条与圆角"就是这个意思）
 * 全部 24 格坐标系、`stroke-width: 1.75`、圆头圆角、不填充。
 * 想加新图标就照抄这个骨架 —— 偏离了整页观感就会散。
 *
 * ⚠️ **不要用 emoji 当图标**：各平台字形不同、无法统一线条与颜色，
 * 在羊皮纸这种单一色调的界面上尤其出戏。
 */
import type { ReactNode } from 'react';

export interface IconProps {
  /** 边长（px）。默认 20 —— 与正文小字（12px）搭配的比例 */
  size?: number;
  className?: string;
}

/** 统一画法。**改这里等于改一整套**，别在单个图标里写死 */
const BASE = {
  viewBox: '0 0 24 24',
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 1.75,
  strokeLinecap: 'round' as const,
  strokeLinejoin: 'round' as const,
} as const;

function Svg({ size = 20, className, children }: IconProps & { children: ReactNode }) {
  return (
    // aria-hidden：图标是装饰，语义由旁边的文字承担（读屏不重复念）
    <svg width={size} height={size} className={className} aria-hidden="true" {...BASE}>
      {children}
    </svg>
  );
}

/** 实心小点（骰子点数、感叹号那种）—— 描边会显得糊，单独用填充 */
const dot = (cx: number, cy: number, r: number) => (
  <circle cx={cx} cy={cy} r={r} fill="currentColor" stroke="none" />
);

export const IconProfile = (p: IconProps) => (
  <Svg {...p}>
    <circle cx="12" cy="8" r="3.5" />
    <path d="M5 20c1.5-3.8 4-5.5 7-5.5s5.5 1.7 7 5.5" />
  </Svg>
);

export const IconSkills = (p: IconProps) => (
  <Svg {...p}>
    <path d="M12 3.5l2.6 5.6 6 .7-4.4 4.1 1.2 5.9L12 16.9 6.6 19.8l1.2-5.9L3.4 9.8l6-.7z" />
  </Svg>
);

export const IconBag = (p: IconProps) => (
  <Svg {...p}>
    <path d="M4 8.5h16v11a1.5 1.5 0 0 1-1.5 1.5h-13A1.5 1.5 0 0 1 4 19.5z" />
    <path d="M8.5 8.5V6a3.5 3.5 0 0 1 7 0v2.5" />
    <path d="M4 13h16" />
  </Svg>
);

export const IconMap = (p: IconProps) => (
  <Svg {...p}>
    <path d="M3 6.5 9 4l6 2.5L21 4v13.5L15 20l-6-2.5L3 20z" />
    <path d="M9 4v13.5M15 6.5V20" />
  </Svg>
);

export const IconLocation = (p: IconProps) => (
  <Svg {...p}>
    <path d="M12 21.5s7-6.2 7-11a7 7 0 1 0-14 0c0 4.8 7 11 7 11z" />
    <circle cx="12" cy="10.2" r="2.6" />
  </Svg>
);

export const IconClue = (p: IconProps) => (
  <Svg {...p}>
    <circle cx="10.5" cy="10.5" r="6" />
    <path d="m15.2 15.2 4.3 4.3" />
  </Svg>
);

export const IconDice = (p: IconProps) => (
  <Svg {...p}>
    <rect x="4" y="4" width="16" height="16" rx="3.5" />
    {dot(9, 9, 1.3)}
    {dot(15, 15, 1.3)}
    {dot(12, 12, 1.3)}
  </Svg>
);

export const IconQuest = (p: IconProps) => (
  <Svg {...p}>
    <circle cx="12" cy="12" r="8.5" />
    <path d="M9.6 9.6a2.5 2.5 0 1 1 3.3 2.4c-.7.3-1.1.9-1.1 1.7v.3" />
    {dot(12, 16.8, 1.1)}
  </Svg>
);

export const IconSettings = (p: IconProps) => (
  <Svg {...p}>
    <circle cx="12" cy="12" r="3" />
    <path d="M12 2.5v3M12 18.5v3M2.5 12h3M18.5 12h3M5.3 5.3l2.1 2.1M16.6 16.6l2.1 2.1M18.7 5.3l-2.1 2.1M7.4 16.6l-2.1 2.1" />
  </Svg>
);

export const IconSave = (p: IconProps) => (
  <Svg {...p}>
    <path d="M5 3.5h11L20.5 8v12a1.5 1.5 0 0 1-1.5 1.5H5A1.5 1.5 0 0 1 3.5 20V5A1.5 1.5 0 0 1 5 3.5z" />
    <path d="M8 3.5v6h8v-6M8 21.5v-6h8v6" />
  </Svg>
);

export const IconCompanions = (p: IconProps) => (
  <Svg {...p}>
    <circle cx="9" cy="9" r="3" />
    <path d="M3.5 19c.8-2.8 2.9-4.3 5.5-4.3s4.7 1.5 5.5 4.3" />
    <circle cx="17" cy="9.8" r="2.3" />
    <path d="M15.7 14.6c2.3.2 3.9 1.7 4.4 4.4" />
  </Svg>
);

export const IconCombat = (p: IconProps) => (
  <Svg {...p}>
    <path d="M12 3 20 6v6.2c0 4.9-3.3 7.9-8 9.3-4.7-1.4-8-4.4-8-9.3V6z" />
    <path d="m9 12 6-6M9 6l6 6" />
  </Svg>
);

export const IconBook = (p: IconProps) => (
  <Svg {...p}>
    <path d="M4 4.5h5.5a3 3 0 0 1 2.5 3v12a2.4 2.4 0 0 0-2-2.2H4z" />
    <path d="M20 4.5h-5.5a3 3 0 0 0-2.5 3v12a2.4 2.4 0 0 1 2-2.2H20z" />
  </Svg>
);

export const IconCard = (p: IconProps) => (
  <Svg {...p}>
    <rect x="3.5" y="5" width="17" height="14" rx="2.5" />
    <circle cx="9" cy="10.5" r="2.2" />
    <path d="M5.6 16.5c.7-1.7 2-2.6 3.4-2.6s2.7.9 3.4 2.6" />
    <path d="M15 10h3.5M15 13.5h3.5" />
  </Svg>
);

export const IconTrophy = (p: IconProps) => (
  <Svg {...p}>
    <path d="M8 3.5h8v5.2a4 4 0 0 1-8 0z" />
    <path d="M8 5.5H5.5a2.5 2.5 0 0 0 2.5 4.6M16 5.5h2.5a2.5 2.5 0 0 1-2.5 4.6" />
    <path d="M12 12.7v4.8M8.5 20.5h7" />
  </Svg>
);

export const IconImage = (p: IconProps) => (
  <Svg {...p}>
    <rect x="3.5" y="4.5" width="17" height="15" rx="2.5" />
    <circle cx="9" cy="9.8" r="1.8" />
    <path d="m5 17.4 4.6-4.6 3.4 3.4 3-3 4 4" />
  </Svg>
);

export const IconUpdate = (p: IconProps) => (
  <Svg {...p}>
    <path d="M20.5 12a8.5 8.5 0 1 1-2.6-6.1" />
    <path d="M20.5 4.5v5.5H15" />
  </Svg>
);

export const IconWarning = (p: IconProps) => (
  <Svg {...p}>
    <path d="M12 3.8 21 19.5H3z" />
    <path d="M12 9.6v4.3" />
    {dot(12, 16.9, 1.05)}
  </Svg>
);

export const IconClose = (p: IconProps) => (
  <Svg {...p}>
    <path d="m6.2 6.2 11.6 11.6M17.8 6.2 6.2 17.8" />
  </Svg>
);

export const IconFolder = (p: IconProps) => (
  <Svg {...p}>
    <path d="M3.5 7.5a2 2 0 0 1 2-2h3.2l2 2.5h7.8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2h-13a2 2 0 0 1-2-2z" />
  </Svg>
);

/** 烧瓶 —— 测试沙盒（开发者工具）。换掉原来的 🧪，免得一排线稿里冒出一个彩色 emoji */
export const IconFlask = (p: IconProps) => (
  <Svg {...p}>
    <path d="M9 3.5h6M10.5 3.5v4.8L5.6 17.4A2 2 0 0 0 7.3 20.5h9.4a2 2 0 0 0 1.7-3.1l-4.9-9.1V3.5" />
    <path d="M7.6 14.5h8.8" />
  </Svg>
);

/** 音量（开 / 关两态）。换掉 🔊 / 🔈 —— emoji 各平台字形不同，一排按钮里最出戏 */
export const IconVolumeOn = (p: IconProps) => (
  <Svg {...p}>
    <path d="M4 9.5h3.5L12 5.5v13L7.5 14.5H4z" />
    <path d="M15.5 9.6a3.4 3.4 0 0 1 0 4.8M18 7a7 7 0 0 1 0 10" />
  </Svg>
);

export const IconVolumeOff = (p: IconProps) => (
  <Svg {...p}>
    <path d="M4 9.5h3.5L12 5.5v13L7.5 14.5H4z" />
    <path d="m16 10 4 4M20 10l-4 4" />
  </Svg>
);

/** 停止（掐掉正在播的音效）。换掉 ⏹ */
export const IconStop = (p: IconProps) => (
  <Svg {...p}>
    <rect x="6.5" y="6.5" width="11" height="11" rx="2" />
  </Svg>
);

/** 帮助。换掉裸文字「?」—— 问号不是图标，跟旁边的按钮对不齐 */
export const IconHelp = (p: IconProps) => (
  <Svg {...p}>
    <circle cx="12" cy="12" r="8.5" />
    <path d="M9.6 9.7a2.5 2.5 0 1 1 3.4 2.3c-.7.3-1.1.9-1.1 1.7v.3" />
    {dot(12, 16.8, 1.1)}
  </Svg>
);

/**
 * 更多（⋮）。顶栏把 12 个入口收进一个菜单用（1-D 主命令）。
 *
 * 三个点**竖排**：横排在中文界面里会和「…省略号」混淆，
 * 而它点开的是菜单、不是"内容被省略了"。
 */
export const IconMore = (p: IconProps) => (
  <Svg {...p}>
    {dot(12, 5.6, 1.5)}
    {dot(12, 12, 1.5)}
    {dot(12, 18.4, 1.5)}
  </Svg>
);

/**
 * 按名字取图标（界面按字符串取用）。
 *
 * 用具名映射而不是 `import * as`：**打包时只带上真正用到的那几个**，
 * 而且拼错名字会在 TS 层被拦住。
 */
export const ICONS = {
  profile: IconProfile,
  skills: IconSkills,
  bag: IconBag,
  map: IconMap,
  location: IconLocation,
  clue: IconClue,
  dice: IconDice,
  quest: IconQuest,
  settings: IconSettings,
  save: IconSave,
  companions: IconCompanions,
  combat: IconCombat,
  book: IconBook,
  card: IconCard,
  trophy: IconTrophy,
  image: IconImage,
  update: IconUpdate,
  warning: IconWarning,
  close: IconClose,
  folder: IconFolder,
  // 下面 5 个是"接界面"时才需要、原先靠 emoji 顶着的（v1.4.0 收尾补）
  flask: IconFlask,
  volumeOn: IconVolumeOn,
  volumeOff: IconVolumeOff,
  stop: IconStop,
  help: IconHelp,
  more: IconMore,
} as const;

export type IconName = keyof typeof ICONS;

/** 图标总数（断言与文档核对用） */
export const ICON_COUNT = Object.keys(ICONS).length;
