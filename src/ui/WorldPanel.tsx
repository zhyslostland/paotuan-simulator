import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { useStore, mapNodesOf, type MapNode } from './store';
import { LineArt, OrnamentDice } from './ornaments';
import { actAt, normalizeActIndex, parseActs, type ActItem } from '../core/acts.js';
import {
  clockDetail,
  clockLabel,
  deadlineLabel,
  normalizeClock,
  type Deadline,
  type StoryClock,
} from '../core/clock.js';
import { ImageField } from './ImageField';
import { ICONS, type IconName } from './icons';
import { checksOf } from './runSummary.js';
import { playerLinesByRound } from './exportGame.js';
import { declaredStatusLines } from '../core/statusEffects.js';
import { NpcCardModal, npcProfileOf, type NpcProfile } from './NpcCard';
import { BestiaryPanel } from './Bestiary';
import { AnchorList } from './EndingScreen';
import { mapImagePrompt, sceneImagePrompt } from '../orchestrator/generate.js';
import { getGenre } from '../core/genres.js';
import { getRuleset } from '../core/rulesets/index.js';
import { occupantsOf } from '../core/state/gameState.js';
import { selectWorldbook } from '../core/worldbook.js';

const INITIATIVE_LABEL: Record<string, string> = {
  reactive: '被动',
  balanced: '均衡',
  proactive: '主动',
};

function CompanionCard({
  name,
  role,
  initiative,
  vitals,
  vitalsMax,
  bond,
  agenda,
  dead,
  away,
  onClick,
}: {
  name: string;
  role: string;
  initiative: string;
  vitals: Record<string, number>;
  vitalsMax?: Record<string, number>;
  bond?: string;
  agenda?: string;
  dead: boolean;
  away: boolean;
  onClick: () => void;
}) {
  const dim = dead || away;
  const maxFor = (k: string, v: number) => vitalsMax?.[k] ?? Math.max(v, 1);
  return (
    <button
      onClick={onClick}
      className={`w-full rounded-md border-l-2 bg-ink-850 px-2.5 py-2 text-left transition ${
        dead
          ? 'border-l-blood-400/60 opacity-50'
          : 'border-l-arcane-600/60 hover:bg-ink-800'
      }`}
    >
      <div className="flex items-baseline justify-between gap-2">
        <span className="text-[13px] font-medium text-mist-100">{name}</span>
        <span className="shrink-0 text-[10px] text-mist-400">
          {dead ? '已死亡' : away ? '离队' : INITIATIVE_LABEL[initiative] ?? initiative}
        </span>
      </div>
      <div className="mt-0.5 text-[11px] text-mist-400">{role}</div>
      {bond && <div className="mt-0.5 text-[10px] text-mist-500">与你的关系：{bond}</div>}
      {!dim && (
        <div className="mt-1.5 space-y-1">
          {Object.entries(vitals).map(([k, v]) => {
            const pct = Math.max(0, Math.min(100, (v / maxFor(k, v)) * 100));
            return (
              <div key={k} className="flex items-center gap-1.5">
                <span className="w-8 shrink-0 font-mono text-[9px] text-mist-400">
                  {k.toUpperCase()}
                </span>
                <div className="h-1 flex-1 overflow-hidden rounded-full bg-ink-700">
                  <div
                    className={`h-full rounded-full ${
                      pct <= 25 ? 'bg-blood-400' : 'bg-arcane-400/70'
                    }`}
                    style={{ width: `${pct}%` }}
                  />
                </div>
                <span className="w-9 shrink-0 text-right text-[9px] tabular-nums text-mist-400">
                  {v}/{maxFor(k, v)}
                </span>
              </div>
            );
          })}
        </div>
      )}
      {!dim && agenda && (
        <div className="mt-1.5 border-t border-ink-700 pt-1.5 text-[10px] leading-snug text-mist-500">
          <span className="text-mist-400">他的打算：</span>
          {agenda}
        </div>
      )}
    </button>
  );
}

/**
 * 世界面板里的一节（标题 + 内容）。
 *
 * `icon` 是可选的 —— 但**实际每一处都传了**：这些区块（场景 / 同行者 / 线索 / 检定记录…）
 * 在一条长滚动里挨着，光靠小字标题容易看混，图标能帮忙扫。
 * 图标是同一套手写 SVG（`ui/icons.tsx`），颜色跟随标题文字色。
 */
function Section({
  title,
  icon,
  children,
  action,
}: {
  title: string;
  icon?: IconName;
  children: React.ReactNode;
  /**
   * 标题右侧的一个小动作（1-B：世界书/角色卡的「全部 ›」深链）。
   *
   * **可选**：不传就是原来的样子，几十处老调用一行都不用改。
   * 刻意不做成"通用 children 塞按钮"—— 那样每个调用处都能往标题里塞东西，
   * 标题栏迟早变成第二个工具栏。这里只开一条通路：**一个入口，带个名字**。
   */
  action?: { label: string; onClick: () => void };
}) {
  const Icon = icon ? ICONS[icon] : null;
  return (
    <section>
      <h3 className="mb-2 flex items-center gap-1.5 text-[11px] tracking-wider text-mist-500">
        {Icon && <Icon size={13} className="shrink-0" />}
        {title}
        {action && (
          <button
            onClick={action.onClick}
            className="ml-auto shrink-0 text-[10px] text-mist-500 transition hover:text-gold-400"
          >
            {action.label}
          </button>
        )}
      </h3>
      {/*
       * ⚠️ 这里**曾经**放了一条"章节标题装饰带"（第二批资产）——**已撤**。
       * 主人 2026-10-02：「**右边无意义的花纹占用版面了**」。
       *
       * 它 `h-3 w-full`，看着只占 12px，但**每一节都占一次** —— 世界页有十来节，
       * 加起来是真版面。而且它只是装饰，不传递任何信息。
       * 教训：**装饰若占版面，就该让位给内容**（这一条与"看得见"并不矛盾 ——
       * 看得见靠"位置与对比"，不靠"占地方"）。
       *
       * 分节仍然分得清：`Section` 的标题本身有字距与图标。
       */}
      {children}
    </section>
  );
}

/**
 * 空态那一行话。
 *
 * 空屏只有一句话会像"坏了"，一枚安静的线稿既说明"这儿现在确实没东西"，又不喧哗（美术规范 §八）。
 *
 * ⚠️ 尺寸**调过一次**：第一版做成 28px／60% 后主人说**"感觉没什么变化"** ——
 * 太淡就等于没做（铁律：玩家看不见＝没做）。现在 40px。
 *
 * 🔴 图形从生图换成了**手写 SVG**（2026-10-04）：线稿这种东西
 * **需求与生图能力正相反** —— 要的是"干净、纤细、可换色、当衬底"，
 * 生图给的却是"细节、光影、质感"（见 `ui/ornaments.tsx` 顶部四条理由）。
 * 换完之后它还能跟着主题变色，这一点位图做不到。
 */
function Empty({ text, art }: { text: string; art?: ReactNode }) {
  return (
    <div className="flex items-center gap-2.5">
      <span className="shrink-0 text-mist-600">{art ?? <LineArt name="notes" size={40} />}</span>
      <p className="text-[12px] text-mist-500">{text}</p>
    </div>
  );
}

/**
 * 「这一幕」（R14）。
 *
 * 两件事分开对待，这是刻意的：
 *   - **幕名与骨架**是玩家可以看的（"你正在第三幕 · 暗房"，这是节奏感，不是剧透）；
 *   - **导演稿**是 GM 内部资料（写着这一幕谁会先动手、哪些线索该露头）——**默认遮罩**，
 *     点一下才显示，且按钮上写明"含剧透"。
 * 与 `ModuleTab` 的真相遮罩同一条口径：**别让玩家顺手看到谜底**。
 */
function ActSection({
  acts,
  index,
  detail,
  busy,
  onExpand,
}: {
  acts: ActItem[];
  index: number;
  detail?: string;
  busy: boolean;
  onExpand: () => void;
}) {
  const [revealed, setRevealed] = useState(false);
  const cur = actAt(acts, index);
  if (!cur) return null;
  // `G5`：没有独立幕名时 `title` 就是摘要的前 10 字 —— 两行都渲染＝同一句话印两遍
  const showTitle = cur.titled !== false && cur.title.trim().length > 0;
  return (
    <Section icon="book" title={`这一幕（第 ${index + 1} / ${acts.length} 幕）`}>
      <div className="rounded-md border-l-2 border-arcane-400/60 bg-ink-850 px-2.5 py-1.5">
        {showTitle ? (
          <>
            <span className="block text-[12px] text-mist-200">{cur.title}</span>
            {cur.summary && (
              <span className="mt-0.5 block text-[11px] leading-relaxed text-mist-500">
                {cur.summary}
              </span>
            )}
          </>
        ) : (
          <span className="block text-[12px] leading-relaxed text-mist-200">
            {cur.summary || cur.title}
          </span>
        )}
      </div>

      {detail ? (
        revealed ? (
          <div className="mt-1.5 rounded-md border border-ink-700 bg-ink-900/70 px-2.5 py-2">
            <div className="mb-1 flex items-center justify-between gap-2">
              <span className="text-[10px] tracking-wider text-blood-300">
                导演稿 · 给守密人看的，含剧透
              </span>
              {/*
               * 打开之后要能关掉（主人 2026-09-17 报的"导演稿没有关闭按钮"）。
               * 剧透是**开了就后悔**的东西：想核对的时候打开，
               * 核对完必须能立刻盖回去 —— 否则一页剧透就一直摊在那儿，
               * 玩家（也是本人）下一眼又被迫看见。
               */}
              <button
                type="button"
                onClick={() => setRevealed(false)}
                className="shrink-0 rounded-md border border-ink-600 px-2 py-0.5 text-[10px] text-mist-500 transition hover:border-blood-300/50 hover:text-mist-300"
              >
                收起
              </button>
            </div>
            <p className="whitespace-pre-wrap text-[11px] leading-relaxed text-mist-400">
              {detail}
            </p>
          </div>
        ) : (
          <button
            type="button"
            onClick={() => setRevealed(true)}
            className="mt-1.5 rounded-md border border-ink-600 px-2 py-1 text-[11px] text-mist-500 transition hover:border-blood-300/50 hover:text-mist-300"
          >
            显示导演稿（含剧透）
          </button>
        )
      ) : (
        <button
          type="button"
          disabled={busy}
          onClick={onExpand}
          className="mt-1.5 rounded-md border border-ink-600 px-2 py-1 text-[11px] text-mist-400 transition hover:border-gold-600/50 hover:text-mist-100 disabled:opacity-40"
        >
          {busy ? '正在展开…' : '展开这一幕（生成幕后走向）'}
        </button>
      )}
    </Section>
  );
}

/**
 * 故事时钟 + 期限倒计时。
 *
 * 三档呈现（按"还剩多少"变色）：
 *   - 宽裕（> 3 天）→ 常规色，只报还剩多少；
 *   - 紧张（≤ 3 天）→ 金色；
 *   - 到点（0）→ 血色，并明说"该收束了"。
 *
 * `deadline` 为空时只显示日期与时段 —— 没有期限的模组照样要有"现在是第几天"。
 */
function ClockSection({
  clock,
  deadline,
}: {
  clock?: StoryClock;
  deadline?: Deadline | null;
}) {
  const now = normalizeClock(clock);
  const remain = deadline?.remain ?? null;
  const urgent = remain !== null && remain <= 3 * 24 * 60;
  const over = remain !== null && remain <= 0;
  return (
    <section>
      <h3 className="mb-2 text-[11px] tracking-wider text-arcane-400">时间</h3>
      <div className="rounded-md border border-arcane-400/40 bg-arcane-400/5 px-2.5 py-2">
        <div className="flex items-baseline justify-between gap-2">
          <span className="text-[13px] text-mist-100">{clockLabel(now)}</span>
          <span className="shrink-0 text-[10px] tabular-nums text-mist-500">
            {clockDetail(now)}
          </span>
        </div>
        {deadline && (
          <p
            className={`mt-1.5 border-t border-arcane-400/25 pt-1.5 text-[11px] leading-relaxed ${
              over ? 'text-blood-300' : urgent ? 'text-gold-300' : 'text-mist-400'
            }`}
          >
            <span className="text-arcane-400">
              {over ? '期限已到：' : '期限：'}
            </span>
            {deadline.label || '这件事'}
            {!over && <span className="ml-1">· {deadlineLabel(deadline)}</span>}
          </p>
        )}
      </div>
    </section>
  );
}

/**
 * 「当前目标」—— 回答玩家最容易迷茫的那一问：我要干嘛？
 * goal 常驻显示；赌注与紧迫感是"我为什么要这么做"，可折叠。
 */
function GoalSection({
  goal,
  stakes,
  urgency,
}: {
  goal?: string;
  stakes?: string;
  urgency?: string;
}) {
  const [open, setOpen] = useState(true);
  if (!goal && !stakes && !urgency) return null;
  const hasExtra = Boolean(stakes || urgency);
  return (
    <section>
      <div className="mb-2 flex items-center justify-between gap-2">
        <h3 className="text-[11px] tracking-wider text-gold-400">当前目标</h3>
        {hasExtra && (
          <button
            onClick={() => setOpen((v) => !v)}
            className="text-[10px] text-mist-500 transition hover:text-mist-300"
          >
            {open ? '收起理由' : '为什么？'}
          </button>
        )}
      </div>
      <div className="rounded-md border border-gold-600/40 bg-gold-500/5 px-2.5 py-2">
        {goal && <p className="text-[13px] leading-relaxed text-gold-200">{goal}</p>}
        {open && hasExtra && (
          <div className="mt-2 space-y-1.5 border-t border-gold-600/25 pt-2">
            {stakes && (
              <p className="text-[11px] leading-relaxed text-mist-400">
                <span className="text-gold-500">赌注：</span>
                {stakes}
              </p>
            )}
            {urgency && (
              <p className="text-[11px] leading-relaxed text-mist-400">
                <span className="text-gold-500">紧迫：</span>
                {urgency}
              </p>
            )}
          </div>
        )}
      </div>
    </section>
  );
}

/**
 * 地图迷雾：算出玩家"应该知道"的地点。
 *
 * 规则（按宽严顺序）：去过的 → 与去过的地方直接相连的 → 故事里提到过的名字。
 * 为什么不直接全画：开局把整张地点图摊开，等于把模组结构剧透了
 * （"礁石滩""封石神殿"一摆出来，玩家立刻知道后面要去哪）。
 */
function revealedNodeNames(
  nodes: MapNode[],
  visited: string[],
  current: string,
  knownText: string
): Set<string> {
  const find = (name: string) => {
    const t = name.trim();
    if (!t) return undefined;
    return nodes.find((x) => x.name === t || x.name.includes(t) || t.includes(x.name));
  };
  const seed = new Set<string>();
  for (const v of [...visited, current]) {
    const m = find(v);
    if (m) seed.add(m.name);
  }
  /*
   * 兜底：当前位置跟任何一个节点都对不上时（AI 写的 start_location 与地图简称不一致），
   * 至少把第一个节点亮出来。否则玩家看到的是一张全"？"的图、无处可去——
   * 那比剧透更糟。
   */
  if (seed.size === 0 && nodes.length > 0) {
    const first = nodes.find((x) => x.name.trim());
    if (first) seed.add(first.name);
  }
  const out = new Set<string>();
  for (const name of seed) {
    out.add(name);
    const node = nodes.find((x) => x.name === name);
    for (const link of node?.links ?? []) {
      const m = find(link);
      if (m) out.add(m.name);
    }
  }
  // 故事里被点名过的地方也算"听说过"
  for (const nd of nodes) if (knownText.includes(nd.name)) out.add(nd.name);
  return out;
}

/**
 * 地图节点名折行。
 *
 * 为什么必须折行：侧栏太窄，节点名一长就只剩"霍尔特的侦…"，
 * 玩家根本认不出那是哪（用户报的"地图名字显示不全"）。
 * 这里折成最多两行，每行 5-6 个字，再长才截断。
 */
function splitLabel(name: string): string[] {
  const n = name.trim();
  if (n.length <= 5) return [n];
  if (n.length <= 12) {
    const mid = Math.ceil(n.length / 2);
    return [n.slice(0, mid), n.slice(mid)];
  }
  return [n.slice(0, 6), `${n.slice(6, 11)}…`];
}

/**
 * 地图节点底下那行人名（1-E）：`你 · 老陈 · 玛丽`，太长就 `…`。
 *
 * 节点宽度只有几十像素，人一多必然溢出画布 —— 必须截。
 * 截的时候**保留前两个**：玩家最关心的是"这儿有几个人、都是谁"，
 * 而不是完整名单（完整名单在下面那块文字版里，那里不截）。
 */
function peopleLabel(names: string[]): string {
  if (names.length === 0) return '';
  if (names.length <= 2) return names.join(' · ');
  return `${names.slice(0, 2).join(' · ')} +${names.length - 2}`;
}

/**
 * 地图节点关系图：节点＝地点、连线＝走得通。
 *
 * 三件事必须做到：**空间信息**（谁挨着谁）、**可缩放拖拽**（侧栏太小看不清）、
 * **迷雾**（没去过的地方不摊开，否则等于剧透）。
 */
function MapGraph({
  nodes,
  current,
  revealed,
  visited,
  occupants,
  onTravel,
  onOpenNpc,
}: {
  nodes: MapNode[];
  current: string;
  revealed: Set<string>;
  /** 真正去过的地方（"只是听说过"的不算）——用来区分实心与虚线两种亮度 */
  visited?: Set<string>;
  /** 每个地点上有谁（1-E 合并：人物画在节点上） */
  occupants: Map<string, string[]>;
  /** 必传：`WorldPanel` 两个挂载点都传了。留成可选会让漏传变成"点了没反应"的静默空操作 */
  onTravel: (location: string) => void;
  onOpenNpc: (name: string) => void;
}) {
  const [zoom, setZoom] = useState(1);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const dragRef = useRef<{ x: number; y: number; moved: boolean } | null>(null);
  // 守密人还在写的时候别让玩家搬家：点了会发出一个被静默吞掉的请求（P1-1 家族）。
  // 直接读 store，不再加 prop —— 两个挂载点都省得改。
  const streaming = useStore((s) => s.streaming);
  const [dragging, setDragging] = useState(false);
  const surfaceRef = useRef<HTMLDivElement>(null);
  /**
   * "刚才是不是拖过"的抑制标志。
   *
   * 不能复用 `dragRef.current?.moved`：click 在 pointerup **之后**才派发，
   * 而 endDrag 已经在 pointerup 里把 dragRef 清成 null 了，守卫会恒为假——
   * 于是"拖着地图在另一个地点上松手"会误触发一次移动（协作方 N3）。
   */
  const suppressClick = useRef(false);

  // 放在最前面：下面的滚轮监听闭包要用到它（组件可能提前 return，晚定义会踩 TDZ）
  const clampZoom = (z: number) => Math.max(0.7, Math.min(3, Number(z.toFixed(2))));

  /*
   * 拖拽收尾必须清掉 dragRef。
   * 早期 onPointerUp 只 setDragging(false)，dragRef 一直还在，
   * 于是松手后任何一次 pointermove（连单纯悬停都算）都会继续平移——地图"粘"在鼠标上；
   * 更糟的是 moved=true 永不复位，之后点任何地点都会被当成"刚拖过"而忽略，
   * 表现为"点地图没反应"。
   */
  const endDrag = () => {
    // 把"拖过"这件事先存下来，供随后的 click 判断（dragRef 马上就要被清掉）
    suppressClick.current = Boolean(dragRef.current?.moved);
    dragRef.current = null;
    setDragging(false);
    // click 紧跟在 pointerup 之后同步派发，下一轮宏任务再放开
    setTimeout(() => {
      suppressClick.current = false;
    }, 0);
  };

  /*
   * 滚轮缩放。React 的 onWheel 是**被动监听**，里面 preventDefault 无效，
   * 所以这里手动挂一个 passive:false 的原生监听。
   *
   * 但**不能无条件 preventDefault**：地图占满侧栏宽度，用户把鼠标放在上面想滚页面时会发现滚不动（协作方 N4）。
   * 折中：按住 Ctrl / ⌘ 才缩放，裸滚轮交还给页面；可发现路径交给右上角的 ＋/－ 按钮（现在真的能点了）。
   */
  useEffect(() => {
    const el = surfaceRef.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      if (!e.ctrlKey && !e.metaKey) return;
      e.preventDefault();
      setZoom((z) => clampZoom(z - e.deltaY * 0.002));
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, []);

  const n = nodes.length;
  if (n === 0) return null;

  const W = 360;
  const H = 316;
  const cx = W / 2;
  const cy = H / 2;
  const radius = n <= 1 ? 0 : Math.min(100, 30 + n * 11);
  const pos = new Map<string, { x: number; y: number }>();
  nodes.forEach((nd, i) => {
    const a = -Math.PI / 2 + (i / n) * Math.PI * 2;
    pos.set(nd.name, { x: cx + radius * Math.cos(a), y: cy + radius * Math.sin(a) });
  });

  const isHere = (name: string) =>
    !!current && (name === current || name.includes(current) || current.includes(name));

  // 去重：A→B 与 B→A 只画一条
  const edges = new Map<string, [string, string]>();
  for (const nd of nodes) {
    for (const link of nd.links ?? []) {
      const target = nodes.find((x) => x.name === link);
      if (!target) continue;
      edges.set([nd.name, target.name].sort().join('\u0000'), [nd.name, target.name]);
    }
  }

  const reset = () => {
    setZoom(1);
    setPan({ x: 0, y: 0 });
  };

  return (
    <div className="relative">
      <div
        ref={surfaceRef}
        className={`relative aspect-[17/15] w-full touch-none overflow-hidden rounded-lg border border-ink-700 bg-ink-850/60 ${
          dragging ? 'cursor-grabbing' : 'cursor-grab'
        }`}
        onPointerDown={(e) => {
          // 鼠标只认左键；右键/中键不要启动拖动
          if (e.pointerType === 'mouse' && e.button !== 0) return;
          dragRef.current = { x: e.clientX, y: e.clientY, moved: false };
          setDragging(true);
          (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
        }}
        onPointerMove={(e) => {
          const d = dragRef.current;
          if (!d) return;
          const dx = e.clientX - d.x;
          const dy = e.clientY - d.y;
          if (Math.abs(dx) + Math.abs(dy) > 3) d.moved = true;
          d.x = e.clientX;
          d.y = e.clientY;
          setPan((p) => ({ x: p.x + dx, y: p.y + dy }));
        }}
        onPointerUp={endDrag}
        onPointerCancel={endDrag}
        onLostPointerCapture={endDrag}
      >
        {/*
         * ⚠️ 这里**曾经**铺过一枚罗盘纹（同心圆环）——**已撤**。
         * 原因：节点图本身就是环形布局 + 圆形节点，再垫一层同心圆，
         * 两套圆叠在一起像靶子（主人 2026-10-02：「地图那几个圈丑的要死」）。
         * 教训记在 `docs/报告/复盘-界面美术为什么像半成品.md`：
         * **要加的是"纸面的材质"，不是"再画一个圆"** —— 材质与图案是两回事。
         */}
        <div
          className="h-full w-full"
          style={{
            transform: `translate(${pan.x}px, ${pan.y}px) scale(${zoom})`,
            transformOrigin: '50% 50%',
            transition: dragging ? 'none' : 'transform 0.18s ease-out',
          }}
        >
          <svg
            viewBox={`0 0 ${W} ${H}`}
            className="h-full w-full select-none"
            role="img"
            aria-label="地点关系图"
          >
            {[...edges.values()].map(([a, b]) => {
              if (!revealed.has(a) || !revealed.has(b)) return null;
              const pa = pos.get(a)!;
              const pb = pos.get(b)!;
              const active = isHere(a) || isHere(b);
              return (
                <line
                  key={`${a}|${b}`}
                  x1={pa.x}
                  y1={pa.y}
                  x2={pb.x}
                  y2={pb.y}
                  stroke={active ? 'var(--c-accent)' : 'var(--c-border-strong)'}
                  strokeWidth={active ? 1.8 : 1.1}
                  strokeDasharray={active ? undefined : '3 4'}
                />
              );
            })}
            {nodes.map((nd) => {
              const p = pos.get(nd.name)!;
              const here = isHere(nd.name);
              const known = revealed.has(nd.name);
              // 三档亮度：**在这儿 > 去过 > 只是听说过**（听说过的画虚线空心，信息不丢也不算探索过）
              const been = visited?.has(nd.name) ?? false;
              // 名字折成最多两行，别再只显示"霍尔特的侦…"
              const lines = known ? splitLabel(nd.name) : ['？'];
              const twoLine = lines.length > 1;
              return (
              <g
                key={nd.name}
                onClick={() => {
                  // 刚拖过就不算点击，避免松手时压在某个地点上误搬家
                  if (suppressClick.current) return;
                  if (streaming) return; // 守密人还在写：点了也发不出去，别装作能走
                  if (known) onTravel(nd.name);
                }}
                style={{
                  cursor: known && !streaming ? 'pointer' : 'default',
                  // 流式期间整组压暗，让"现在走不了"是看得见的，而不是只能靠点一下才知道
                  opacity: streaming ? 0.45 : 1,
                  transition: 'opacity 150ms',
                }}
              >
                <title>
                  {!known
                    ? '还没听说过这个地方'
                    : streaming
                      ? '守密人还在写 —— 写完了再走'
                      : nd.note
                        ? `${nd.name}：${nd.note}`
                        : nd.name}
                </title>
                  {/*
                   * 🔴 去掉描边、只留色块（2026-10-02）。
                   *
                   * 以前是「描边大圆 + 圈里塞两行字」，一个节点上压着好几层线；
                   * 环形布局排开之后，看上去就是"几个圈"（主人原话：**「那几个圈丑的要死」**）。
                   *
                   * 现在：**已探索的一律实心、无描边** —— 像地图上的墨点／盖上去的印记；
                   * 只有"只听说过、没去过"的才保留**虚线**，因为那层线是**信息**（没去过），不是装饰。
                   * 当前所在多一圈**柔和光晕**（就这一层，不再叠同心圆）。
                   */}
                  {here && (
                    <circle cx={p.x} cy={p.y} r={36} fill="var(--c-accent)" opacity={0.13} />
                  )}
                  <circle
                    cx={p.x}
                    cy={p.y}
                    r={here ? 24 : 21}
                    fill={
                      here
                        ? 'var(--c-accent)'
                        : been
                          ? 'var(--c-elevated)'
                          : 'transparent'
                    }
                    stroke={known ? 'none' : 'var(--c-border)'}
                    strokeWidth={1.2}
                    strokeDasharray={known ? undefined : '3 3'}
                  />
                  {/*
                   * 地点名挂在**点位下方**（在地图上这是"地名标签"的画法），
                   * 不再塞进圆里 —— 圆小了之后，圈内文字必然溢出（"霍尔特的侦探事务所"折两行有 60px 宽）。
                   */}
                  <text
                    x={p.x}
                    y={p.y + (twoLine ? 18 : 23)}
                    textAnchor="middle"
                    fontSize={twoLine ? 10 : 11.5}
                    fill={here ? 'var(--c-accent)' : known ? 'var(--c-text)' : 'var(--c-muted)'}
                  >
                    {lines.map((ln, li) => (
                      <tspan key={li} x={p.x} dy={li === 0 ? 0 : 11.5}>
                        {ln}
                      </tspan>
                    ))}
                  </text>
                  {/*
                   * 1-E：谁在这个地点 —— 画在**节点下方**的小名字串。
                   *
                   * 为什么不画进圆圈里：圈里已经被地点名占满（还可能折两行），
                   * 再塞人的名字两边都看不清。挂在下面既不动布局，也不挡住地点名。
                   *
                   * 只画**已知地点**上的人：没听说过的地方不该冒出人名（那是剧透）。
                   *
                   * 名字串**可点**（跳档案卡）—— 节点组的 onClick 在祖先上，
                   * 所以这里要 stopPropagation，否则点人名会顺带触发一次搬家。
                   * 配色按主题变量走：玩家所在处用 `--c-accent`，其余用 `--c-text`
                   * （🔥 浅底铁律：功能色不许带透明度，否则在羊皮纸上淡到看不见）。
                   */}
                  {known && (occupants.get(nd.name)?.length ?? 0) > 0 && (
                    <text
                      x={p.x}
                      y={p.y + (twoLine ? 38 : 34)}
                      textAnchor="middle"
                      fontSize={9}
                      fill={here ? 'var(--c-accent)' : 'var(--c-text)'}
                      style={{ cursor: 'pointer' }}
                      onClick={(e) => {
                        e.stopPropagation();
                        if (suppressClick.current) return;
                        const who = occupants.get(nd.name);
                        if (who?.[0]) onOpenNpc(who[0]);
                      }}
                    >
                      {peopleLabel(occupants.get(nd.name)!)}
                    </text>
                  )}
                </g>
              );
            })}
          </svg>
        </div>

        <span className="pointer-events-none absolute bottom-1.5 right-2 text-[10px] tabular-nums text-mist-500">
          {Math.round(zoom * 100)}%
        </span>
      </div>

      {/*
       * 缩放控件必须放在**可拖动容器外面**。
       * 放在里面时，在按钮上按下会冒泡到容器 → 启动拖动 + setPointerCapture 夺走指针
       * → 按钮的 click 再也收不到，表现为"点了没反应"。
       */}
      <div
        onPointerDown={(e) => e.stopPropagation()}
        className="absolute right-1.5 top-1.5 z-10 flex flex-col overflow-hidden rounded-md border border-ink-600 bg-ink-900/90"
      >
        <button
          onClick={() => setZoom((z) => clampZoom(z + 0.35))}
          className="h-8 w-8 text-[15px] leading-none text-mist-300 transition hover:bg-ink-800 hover:text-mist-100"
          title="放大"
        >
          ＋
        </button>
        <button
          onClick={() => setZoom((z) => clampZoom(z - 0.35))}
          className="h-8 w-8 border-t border-ink-700 text-[15px] leading-none text-mist-300 transition hover:bg-ink-800 hover:text-mist-100"
          title="缩小"
        >
          －
        </button>
        <button
          onClick={reset}
          className="h-8 w-8 border-t border-ink-700 text-[12px] leading-none text-mist-400 transition hover:bg-ink-800 hover:text-mist-100"
          title="复位"
        >
          ⤢
        </button>
      </div>
    </div>
  );
}

/**
 * 地图区块：节点关系图（带迷雾与缩放）＋ 可选的手绘区域图（生图）。
 *
 * ## 1-E 地图合并（主人 2026-10-01 拍板）
 * 「在地人物」原先是一块独立面板，把地图节点上的人**又列了一遍** ——
 * 两块信息重叠、两边都要滚（压测铁律：**左右栏信息不许重叠**）。
 * 现在人物**点画在节点上**：一眼看到「塔内楼梯：你 · 老陈 · 玛丽」。
 */
function MapSection({
  nodes,
  current,
  revealed,
  visited,
  mapImage,
  occupants,
  onTravel,
  onOpenNpc,
}: {
  nodes: MapNode[];
  current: string;
  revealed: Set<string>;
  visited?: Set<string>;
  mapImage: string;
  /** 每个地点上有谁（键＝地点名）。合并后人物画在节点上，不再单列一块 */
  occupants: Map<string, string[]>;
  /** 必传：同上。地图搬家是玩家的主动操作，静默失败＝玩家以为点了没用 */
  onTravel: (location: string) => void;
  /** 点地图上的人名看他的档案（与旧「在地人物」同一个出口） */
  onOpenNpc: (name: string) => void;
}) {
  const module = useStore((s) => s.module);
  // 同 MapGraph：流式期间地点钮也要禁用（否则点了发不出去，见 P1-1 家族）
  const streaming = useStore((s) => s.streaming);
  const setMapImage = useStore((s) => s.setMapImage);
  const genreId = useStore((s) => s.genreId);
  const rulesetId = useStore((s) => s.rulesetId);
  const customGenres = useStore((s) => s.customGenres);
  const [showMap, setShowMap] = useState(false);
  const [showAll, setShowAll] = useState(false);

  if (nodes.length === 0) return null;
  const here = current.trim();
  const hasLinks = nodes.some((nd) => (nd.links ?? []).length > 0);
  const hereNode = nodes.find(
    (nd) => here && (nd.name === here || nd.name.includes(here) || here.includes(nd.name))
  );
  // 打开"显示全部"＝玩家自己要看全图（少数人不在意剧透）
  const shown = showAll ? new Set(nodes.map((nd) => nd.name)) : revealed;
  const hiddenCount = nodes.length - shown.size;

  return (
    <section>
      <div className="mb-2 flex items-center justify-between gap-2">
        <h3 className="text-[11px] tracking-wider text-mist-500">地图</h3>
        <div className="flex items-center gap-2">
          <button
            onClick={() => setShowAll((v) => !v)}
            className="text-[10px] text-mist-500 transition hover:text-mist-300"
            title="把还没听说过的地方也显示出来（会剧透模组结构）"
          >
            {showAll ? '隐藏未知' : '显示全部'}
          </button>
          <button
            onClick={() => setShowMap((v) => !v)}
            className="text-[10px] text-mist-500 transition hover:text-mist-300"
          >
            {showMap ? '收起手绘图' : '手绘区域图'}
          </button>
        </div>
      </div>

      <MapGraph
        nodes={nodes}
        current={here}
        revealed={shown}
        visited={visited}
        occupants={occupants}
        onTravel={onTravel}
        onOpenNpc={onOpenNpc}
      />

      {hereNode && (
        <p className="mt-2 rounded-md border-l-2 border-gold-600/60 bg-ink-850 px-2.5 py-1.5 text-[11px] leading-relaxed text-mist-300">
          你在这里：<span className="text-gold-200">{hereNode.name}</span>
          {hereNode.note ? ` · ${hereNode.note}` : ''}
          {(hereNode.links ?? []).length > 0 && (
            <span className="block text-[10px] text-mist-500">
              可去：{(hereNode.links ?? []).join(' / ')}
            </span>
          )}
        </p>
      )}

      {/*
       * 「谁在哪」的**文字版**：图上节点名字是折行截断的，人多时也挤。
       * 这里按地点把名字列全（与图上的人是同一份数据，不是第二处真源）。
       */}
      {occupants.size > 0 && (
        <div className="mt-2 space-y-1">
          {[...occupants.entries()].map(([place, who]) => (
            <div key={place} className="flex items-start gap-2 text-[11px]">
              <span className="shrink-0 text-mist-500">{place}</span>
              <span className="min-w-0 flex-1 flex flex-wrap gap-1">
                {who.map((n) => (
                  <button
                    key={n}
                    onClick={() => onOpenNpc(n)}
                    className="rounded border border-ink-600 px-1.5 py-0.5 text-[10px] text-mist-300 transition hover:border-gold-600/50 hover:text-mist-100"
                    title={`看${n}是什么人`}
                  >
                    {n}
                  </button>
                ))}
              </span>
            </div>
          ))}
        </div>
      )}

      {/* 已知地点用完整名字列一遍：图上的节点名是折行/截断的，这里补全 */}
      <div className="mt-2 flex flex-wrap gap-1.5">
        {nodes
          .filter((nd) => shown.has(nd.name))
          .map((nd) => {
            const isCurrent =
              Boolean(here) && (nd.name === here || nd.name.includes(here) || here.includes(nd.name));
            return (
              <button
                key={nd.name}
                disabled={isCurrent || streaming}
                onClick={() => onTravel(nd.name)}
                title={
                  isCurrent
                    ? '你就在这里'
                    : streaming
                      ? '守密人还在写 —— 写完了再走'
                      : nd.note || `前往${nd.name}`
                }
                className={`max-w-full truncate rounded-md border px-2 py-0.5 text-[11px] transition ${
                  isCurrent
                    ? 'border-gold-600/70 bg-gold-500/10 text-gold-300'
                    : streaming
                      ? 'cursor-not-allowed border-ink-700 text-mist-600 opacity-50'
                      : 'border-ink-600 text-mist-300 hover:border-gold-600/50 hover:text-mist-100'
                }`}
              >
                {nd.name}
                {isCurrent && <span className="ml-1 text-[9px] text-gold-500">你在这里</span>}
              </button>
            );
          })}
      </div>

      <p className="mt-1.5 text-[10px] leading-relaxed text-mist-500">
        {hasLinks
          ? '连线表示走得通。拖动可平移，右上角加减缩放（按住 Ctrl 滚滚轮也行）。' +
            '实心地点的你去过，虚线的只是听说过。' +
            '点地点即动身——守密人若认为此刻去不了，会用剧情里的理由拦下你。'
          : '点地点即动身。（这个模组没有给出地点间的可达关系，已按地点顺序连成一条线。）'}
        {hiddenCount > 0 && !showAll && ` 还有 ${hiddenCount} 个地方你还没听说过。`}
      </p>

      {showMap && (
        <div className="mt-2">
          <ImageField
            label="区域地图"
            prompt={mapImagePrompt(
              module.title,
              nodes.map((nd) => nd.name),
              module.premise,
              getGenre(genreId, customGenres)
            )}
            value={mapImage}
            job={{ kind: 'map', target: 'map' }}
            onClear={() => setMapImage('')}
          />
        </div>
      )}
    </section>
  );
}

export function WorldPanel({
  onPromptCompanion,
  onTravel,
  onRewind,
  onOpenPrep,
}: {
  /** 三个回调全部必传：`App.tsx` 的两处挂载（移动端 `:1194` / 桌面侧栏 `:1204`）都传了。
   *  留成可选＝漏传时点击静默空操作（当年 `onUseItem` 就是这么栽的）。 */
  onPromptCompanion: (name: string) => void;
  onTravel: (location: string) => void;
  onRewind: (msgId: string) => void;
  /**
   * 1-B：打开准备页并落在指定页签（「全部 ›」深链）。
   *
   * 主人要求「世界书/角色卡等大信息量部件**主界面必须有入口（三次点击内可达）**」。
   * 这里只负责**传页签名**，怎么打开是 `App.tsx` 的事 ——
   * 面板不该知道准备页是个弹层还是整页（那是布局，不是它的职责）。
   */
  onOpenPrep: (tab: 'module' | 'character' | 'companions' | 'worldbook' | 'world') => void;
}) {
  const gameState = useStore((s) => s.gameState);
  // P3-8：判据要看规则包（它声明了哪些状态）
  const rulesetId = useStore((s) => s.rulesetId);
  const snapshots = useStore((s) => s.snapshots);
  const chronicle = useStore((s) => s.chronicle);
  const summary = useStore((s) => s.summary);
  const sceneImages = useStore((s) => s.sceneImages);
  const setSceneImage = useStore((s) => s.setSceneImage);
  const module = useStore((s) => s.module);
  const character = useStore((s) => s.character);
  const messages = useStore((s) => s.messages);
  const mapImage = useStore((s) => s.mapImage);
  const genreId = useStore((s) => s.genreId);
  const customGenres = useStore((s) => s.customGenres);
  /*
   * 1-B：世界书的**生效条目**（常驻入口要显示"这一轮真被注进去的几条"）。
   *
   * ⚠️ 选的是稳定切片（整份数组 / 稳定引用），派生走 `useMemo` ——
   * `selectWorldbook` 每次返回新数组，直接进选择器就是那个 `#185` 无限重渲染。
   * 判据与提示词**同源**（`core/worldbook.ts` 那一份），界面不另立一套，
   * 否则"界面说生效了、模型没收到"这类分歧迟早出现。
   */
  const worldbook = useStore((s) => s.worldbook);
  /*
   * 订阅的是**函数引用**（稳定），不是在选择器里调用它 ——
   * `useStore((s) => s.insanity())` 每次返回新对象会无限重渲染，那样写是错的。
   * H16·残留：世界页「剧情标记」要跟状态栏说同一句话。
   */
  const insanity = useStore((s) => s.insanity);
  // 点击在地人物弹出的档案卡
  const [npcCard, setNpcCard] = useState<NpcProfile | null>(null);
  /**
   * 1-C：编年史「看更早的」是否展开。
   *
   * 组件本地状态、**不进存档**：它是"我现在想看什么"，不是这一局的事实。
   * 重开一局时组件本来就重挂载，状态自然回到折叠 —— 那正是想要的行为。
   */
  const [chronicleExpanded, setChronicleExpanded] = useState(false);
  /*
   * ---------------------------------------------------------------------
   * 下面这几份派生数据全部用 `useMemo` 包住（协作方 §五 性能三连 ③）
   *
   * 为什么必须包：世界面板每次渲染都要它们，而其中两件在长局里是**重活** ——
   *   - `knownText` 要把**整份编年史 + 全部线索 + 摘要**拼成一个大字符串；
   *   - `revealed` 再在那个大字符串上逐节点做子串匹配；
   *   - `anchors` 每次都要扫一遍**全部消息**。
   * 一局玩到几百条消息时，这一串会随每帧重算，滚动和打字都发涩。
   *
   * 依赖都是 store 里的**稳定引用**（`gameState` / `chronicle` / `messages` …），
   * 没变就不会重算 —— 这跟"选择器不许返回新对象"是同一条规矩的两个面。
   * ---------------------------------------------------------------------
   */

  /*
   * H16 / H20：`<名字>轮数` 是**引擎自己记的账**，不是玩家的状态 ——
   * 甩一句「疯狂轮数：2」「中毒轮数：2」等于让玩家自己拼"还剩几轮"。
   * 以前这里只认字面 `INSANITY_TURNS_FLAG`，于是中毒那类照样漏出来（H20）。
   * 现在统一走 `statusFlagLines()`：过滤**所有**「轮数」结尾的键，
   * 与 `CharacterSheet` 的状态栏、与 `statusNote` 三处共用同一份判据。
   *
   * 🔴 `P3-7`（协作方第 26 版）：这里**曾经多一层「只留含汉字的键」的过滤** ——
   * 规则包给 `poisoned` / `bleeding` 这类 ASCII 状态名时，世界页**一条都不显**，
   * 而角色卡照显 —— 同一状态两处一有一无，`H16·残留` 换个方向复发。
   * 键名用什么语言是**写法**问题，不构成隐藏理由（`SEVERE_FLAG_TONE` 只影响配色）。
   * 两侧必须同一份：这里不再自己加过滤。
   */
  /*
   * 🔴 `P3-8`（主人 2026-09-28 拍板「按是不是状态过滤」）：这一份按**语义**过滤，不按语言。
   *
   * `P3-7` 撤掉「只留中文键」是对的，但那层过滤顺带还在挡"模型顺手写进 flags 的
   * 非状态键"（`notes:`、`quest:` 这类）。判据＝声明过 / 有配对轮数 / 引擎自己写的 /
   * 布尔真 —— 四条任一；规则包没有状态表时一律显示（安全阀，见 `statusEffects.ts`）。
   *
   * ⚠️ 角色卡状态栏**刻意不走这一份**：那里永远显示玩家的全部状态
   * （早期痛点就是"流血状态界面不显示"，宁可多显示也不能藏）。
   */
  const flags = useMemo(
    () => declaredStatusLines(gameState.flags, getRuleset(rulesetId)),
    [gameState.flags, rulesetId]
  );



  const location = gameState.location?.trim();

  /* R14：幕结构。解析是纯函数，包在 useMemo 里（`parseActs` 每次返回新数组，不进选择器） */
  const acts = useMemo(() => parseActs(module.acts), [module]);
  const actIndex = normalizeActIndex(gameState.actIndex);
  const actDetail = gameState.actDetails?.[String(actIndex)];
  const [actBusy, setActBusy] = useState(false);
  const expandCurrentAct = async () => {
    setActBusy(true);
    try {
      await useStore.getState().expandAct(actIndex);
    } finally {
      setActBusy(false);
    }
  };

  /* 地图节点：优先用模组给的"可达关系图"，没有就从「关键地点」兜底生成
   *
   * 地点**软同步**（协作方 E）：
   * 守密人经常把玩家带到地图上没写的地方（"河边""那间废弃的澡堂"）。
   * 那种时候不能阻断叙事，也不该让玩家在地图上找不到自己——
   * 把去过但不在图上的地点作为**孤立节点**补进来，并注明"图上原本没有"。
   */
  const mapNodes = useMemo(() => {
    const baseNodes = mapNodesOf(module);
    const namesOnMap = baseNodes.map((n) => n.name);
    const extraNodes: MapNode[] = [];
    for (const v of gameState.visited ?? []) {
      const t = v.trim();
      if (!t) continue;
      if (namesOnMap.some((n) => n === t || n.includes(t) || t.includes(n))) continue;
      if (extraNodes.some((n) => n.name === t)) continue;
      extraNodes.push({ name: t, links: [], note: '图上原本没有这个地点' });
    }
    return [...baseNodes, ...extraNodes] as MapNode[];
  }, [module, gameState.visited]);

  /*
   * 地图迷雾：只画玩家"知道"的地方，避免开局把整张图摊开剧透。
   * 但**没有可达关系时不启用迷雾**——那样玩家会被锁死在原地（不知道任何别的地方，
   * 也就无处可去），反而更糟。这时按老行为全显示。
   */
  const hasLinks = useMemo(
    () => mapNodes.some((nd) => (nd.links ?? []).length > 0),
    [mapNodes]
  );
  const knownText = useMemo(
    () => [...chronicle.map((c) => c.text), ...gameState.clues, summary].join('\n'),
    [chronicle, gameState.clues, summary]
  );
  /*
   * §6.3c：编年史每一回下挂**玩家当时那一句**。
   *
   * 编年史是守密人写的"发生了什么"，玩家那句"我做了什么"一直不在里面 ——
   * 回头看时，"我推门进去"和"门自己开了"读起来是一样的。
   *
   * 对齐判据在 `exportGame.playerLinesByRound`（只有那一份）：
   * 编年史一个回合一条、玩家消息一个回合一条，按下标对齐就是按回目对齐。
   * `messages` 很长，所以包 `useMemo`。
   */
  const saidByTurn = useMemo(() => {
    const lines = playerLinesByRound(messages);
    const m = new Map<number, string>();
    chronicle.forEach((c, i) => {
      const line = lines[i];
      if (line?.trim()) m.set(c.turn, line.trim());
    });
    return m;
  }, [chronicle, messages]);
  const revealed = useMemo(
    () =>
      hasLinks
        ? revealedNodeNames(mapNodes, gameState.visited ?? [], location ?? '', knownText)
        : new Set(mapNodes.map((nd) => nd.name)),
    [hasLinks, mapNodes, gameState.visited, location, knownText]
  );

  /*
   * 「去过」与「只是听说过」要能一眼分开（协作方建议，采纳）：
   * 去过的画实心，只是听说的画虚线空心——信息不丢，探索感也不被稀释。
   * visited 里存的可能是完整地点名（"霍尔特的侦探事务所"），节点名是简称，这里模糊匹配。
   */
  // 关键抉择（回溯锚点）：倒序，最近的岔路口排最前（要扫全部消息，所以包住）
  const anchors = useMemo(
    () =>
      messages
        .filter((m) => m.role === 'player' && snapshots[m.id]?.key)
        .map((m) => ({ id: m.id, label: snapshots[m.id]!.label, snap: snapshots[m.id]! }))
        .reverse(),
    [messages, snapshots]
  );

  const visitedNames = useMemo(() => {
    const set = new Set<string>();
    for (const v of gameState.visited ?? []) {
      const t = v.trim();
      if (!t) continue;
      const m = mapNodes.find((x) => x.name === t || x.name.includes(t) || t.includes(x.name));
      if (m) set.add(m.name);
    }
    return set;
  }, [gameState.visited, mapNodes]);

  /*
   * 谁在哪（1-E）—— 地图上直接看得出"这个地点有谁"，不必再单开一块「在地人物」。
   *
   * 🔴 取法是**纯函数 `occupantsOf()`**（`core/state/gameState.ts`），不在这里就地拼。
   * 原因是一次真事故（2026-10-02 主人报「地图看不见人名」）：
   * 这里曾经**按 `location` 原文做键**（如"霍尔特的侦探事务所"），
   * 而地图是按**节点名**取值（`occupants.get(nd.name)`，如"事务所"）——
   * 建键与取值口径不一致，于是玩家自己和同行者的名字**一次都没画出来过**
   * （只有走过归并的关键人物画得出）。抽成纯函数后这条口径能被断言钉住。
   *
   * 归并规则与地图迷雾同一套：全等 > 节点名含它 > 它含节点名；归并不上就原样成键
   * （宁可让它在下面「谁在哪」文字表里单独一行，也不硬塞到某个节点上指错地方）。
   */
  const occupants = useMemo(
    () => occupantsOf(gameState, character.name, mapNodes),
    [gameState, character.name, mapNodes]
  );

  /** 点地图上的人名 → 弹出同一张档案卡（旧「在地人物」的出口，原样保留） */
  const openNpc = (name: string) => setNpcCard(npcProfileOf(name, gameState, module));

  /*
   * 1-B：这一轮**真正会被注进提示词**的世界书条目。
   *
   * ## 为什么显示"生效的"而不是"全部"
   * 世界书是关键词触发的：一局跑下来累积几十条，但**每一轮最多只吃 8 条**
   * （`selectWorldbook` 的默认 `limit`）。全摊出来玩家看到的是"我有 42 条设定"，
   * 而实际影响这一轮的可能只有 2 条 —— 那个数字对他没有意义，这个才有。
   *
   * ## 上下文口径与提示词一致
   * 取最近 4 条消息（`App.tsx` 里 `snapshot.slice(-4)`），不把整局塞进去。
   * 两处口径若不同，界面会显示"生效 A 条"而模型收到别的 —— 比不显示更坏。
   */
  const liveWorldbook = useMemo(
    () =>
      selectWorldbook(
        worldbook,
        messages.slice(-4).map((m) => m.content)
      ),
    [worldbook, messages]
  );

  return (
    <div className="space-y-6 p-4">
      {/*
       * 故事时钟 —— 摆在最前面。
       * 为什么它在"当前目标"之上：目标回答"我要干嘛"，
       * 时钟回答"现在还有多少时间"，而后者才决定前者急不急。
       * 以前系统里根本没有时间概念（主人 2026-09-17 报的），
       * 长篇的"二十三天"就永远停在二十三天。
       */}
      <ClockSection clock={gameState.clock} deadline={gameState.deadline} />

      <GoalSection goal={module.goal} stakes={module.stakes} urgency={module.urgency} />

      {acts.length > 0 && (
        <ActSection
          acts={acts}
          index={actIndex}
          detail={actDetail}
          busy={actBusy}
          onExpand={expandCurrentAct}
        />
      )}

      {(gameState.threads ?? []).length > 0 && (
        <Section icon="quest" title="进行中的线">
          <ul className="space-y-1.5">
            {(gameState.threads ?? []).map((t) => (
              <li
                key={t.name}
                className="rounded-md border-l-2 border-arcane-400/60 bg-ink-850 px-2.5 py-1.5"
              >
                <span className="block text-[12px] text-mist-200">{t.name}</span>
                {t.status && (
                  <span className="block text-[11px] leading-relaxed text-mist-500">
                    {t.status}
                  </span>
                )}
              </li>
            ))}
          </ul>
        </Section>
      )}

      <MapSection
        nodes={mapNodes}
        current={location ?? ''}
        revealed={revealed}
        visited={visitedNames}
        occupants={occupants}
        onOpenNpc={openNpc}
        mapImage={mapImage}
        onTravel={onTravel}
      />

      {/*
       * 关键节点（回溯锚点）。
       * 结档页里能回溯，但平常也得有个入口——不然玩家只记得"某一步好像走错了"，
       * 却要在一百多条消息里翻。这里只列被标为关键的那几个岔路口。
       */}
      <Section icon="warning" title={`关键抉择${anchors.length ? `（${anchors.length}）` : ''}`}>
        {anchors.length > 0 ? (
          <AnchorList anchors={anchors} onRewind={onRewind} />
        ) : (
          <Empty text="还没有关键抉择——检定没过、进入战斗、首次到某地、拿到新线索或新支线时，会自动记一个。" />
        )}
      </Section>

      {module.premise && (
        <Section icon="book" title="剧情简介">
          <p className="rounded-md border-l-2 border-ink-500 bg-ink-850/70 px-2.5 py-2 text-[12px] leading-relaxed text-mist-400">
            {module.premise}
          </p>
        </Section>
      )}

      <Section icon="location" title="场景">
        {location ? (
          <ImageField
            label={location}
            prompt={sceneImagePrompt(
              location,
              module.premise,
              character,
              getGenre(genreId, customGenres)
            )}
            value={sceneImages[location]}
            job={{ kind: 'scene', target: location }}
            onClear={() => setSceneImage(location, '')}
          />
        ) : (
          <Empty text="尚未进入具体场景" />
        )}
      </Section>

      {gameState.companions.length > 0 && (
        <Section icon="companions" title="同行者">
          <div className="space-y-1.5">
            {gameState.companions.map((c) => (
              <CompanionCard
                key={c.id}
                name={c.name}
                role={c.role}
                initiative={c.initiative}
                vitals={c.vitals}
                vitalsMax={c.vitalsMax}
                bond={c.bond}
                agenda={c.agenda}
                dead={!c.alive}
                away={!c.present && c.alive}
                onClick={() => onPromptCompanion(c.name)}
              />
            ))}
          </div>
          <p className="mt-2 text-[10px] leading-relaxed text-mist-500">
            点击队友可在输入框中唤起 TA
          </p>
        </Section>
      )}

      {/* 「在地人物」已并入上方地图（1-E）：人和地点在同一张图上，不另开一块。 */}

      {/*
       * 1-C 侧栏抗压：线索改成**单行**（标题 + 右侧短标注）。
       *
       * ## 为什么
       * 压测结论（报告 §三）：右栏四块堆叠的总高会超过一屏，要滚动才看得到线索。
       * 线索原本每条 `py-2` + `leading-relaxed`，一条能占三行 —— 七条就吃掉半屏。
       * 但**信息不能减**：线索全文是这个游戏的核心资产，砍了就等于没显示。
       * 所以压的是**排版**不是内容：一行一条，`truncate` 掉溢出部分，
       * 鼠标悬停看全文（`title`），想看完整就走上面的编年史（那里有上下文）。
       *
       * ⚠️ 与「太稀，再塞」是同一条方向的两面：**塞信息，不塞留白**。
       */}
      <Section icon="clue" title={`线索${gameState.clues.length ? `（${gameState.clues.length}）` : ''}`}>
        {gameState.clues.length === 0 ? (
          <Empty text="尚未发现任何线索" art={<LineArt name="clues" size={40} />} />
        ) : (
          <ul className="space-y-0.5">
            {gameState.clues.map((clue, i) => (
              <li
                key={i}
                title={clue}
                className="flex items-center gap-2 rounded border-l-2 border-gold-600/60 bg-ink-850 px-2 py-1"
              >
                <span className="min-w-0 flex-1 truncate text-[12px] text-mist-300">
                  {clue}
                </span>
              </li>
            ))}
          </ul>
        )}
      </Section>

      {/* 图鉴（R38）。模组没设敌对者表时 BestiaryPanel 自己 return null，不会占位 */}
      <BestiaryPanel />

      <Section icon="dice" title="检定记录">
        {(() => {
          /*
           * P2-1：读 `checksOf(m)` 而不是只读 `m.check`。
           * 以前「一次全掷」掷出来的那几条**一条都不进这张表** ——
           * 同一个玩家会在生涯里看到"这一局掷了 6 次"，记录里却只有 2 条。
           */
          const checks = messages
            .filter((m) => m.check || m.checks?.length)
            .flatMap((m) => checksOf(m))
            .reverse();
          if (checks.length === 0) return <Empty text="还没有检定过" art={<OrnamentDice size={34} />} />;
          return (
            <ul className="space-y-1">
              {checks.slice(0, 20).map((c, i) => (
                <li
                  key={`${c.skill}-${i}`}
                  className="flex items-center justify-between rounded-md bg-ink-850 px-2.5 py-1.5"
                >
                  <span className="truncate text-[12px] text-mist-300">{c.skill}</span>
                  <span className="shrink-0 text-[11px] tabular-nums text-mist-400">
                    {c.roll} · <b className="text-mist-200">{c.label}</b>
                  </span>
                </li>
              ))}
            </ul>
          );
        })()}
      </Section>

      <Section icon="quest" title="剧情标记">
        {flags.length === 0 ? (
          <Empty text="无" />
        ) : (
          <ul className="space-y-1">
            {flags.map(({ key, text, severe }) => {
              /*
               * H16·残留（协作方第 23 版）：同一状态不许两种说法。
               *
               * 这里以前对 `临时疯狂` 走 `${key}：${value}`，于是显示成
               * 「临时疯狂：理智骤降 6 点，陷入临时疯狂」—— 复读了一遍原始描述；
               * 而状态栏已经是「临时疯狂（还剩 2 轮）」。玩家不知道该信哪句。
               *
               * `临时疯狂` 是**被引擎解释过的状态**（不是模型留的叙事），
               * 所以取 `insanityOf().label` —— 与 `CharacterSheet` 共用同一处算出来的那句。
               */
              const mad = key === '临时疯狂' && insanity().active;
              return (
                <li
                  key={key}
                  className="flex items-center justify-between rounded-md bg-ink-850 px-2.5 py-1.5"
                >
                  {/* H20：`text` 已经是"拼好轮数的人话"，布尔状态不会露出 `true` */}
                  <span className="font-mono text-[11px] text-mist-400">
                    {mad ? insanity().label : text}
                  </span>
                  {!mad && (
                    <span
                      className={`text-[11px] ${severe ? 'text-moss-400' : 'text-mist-500'}`}
                    >
                      {severe ? '生效中' : '已记下'}
                    </span>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </Section>

      <Section icon="book" title={`编年史${chronicle.length ? `（${chronicle.length}）` : ''}`}>
        {summary && (
          <div className="mb-2.5 rounded-md border-l-2 border-ink-500 bg-ink-850/70 px-2.5 py-2">
            <div className="mb-0.5 text-[10px] tracking-wider text-mist-500">
              前情提要
            </div>
            <p className="text-[12px] leading-relaxed text-mist-400">{summary}</p>
          </div>
        )}
        {chronicle.length === 0 ? (
          <Empty text="尚无记录，跑几轮后这里会按回合列出剧情要点" />
        ) : (
          <>
            {/*
             * 1-C 侧栏抗压：编年史**不能压成一行** —— 它是玩家回看"当初到底发生了什么"
             * 的唯一全文入口（结档页只给摘要）。所以压的是**视野**不是内容：
             * 默认只铺最近 8 条，更早的一条按钮展开。
             *
             * 🔴 为什么不做"限高 + 内部滚动"：侧栏整体本来就在滚，
             * 里面再套一个滚动区会出现**滚轮陷阱**（鼠标停在上面，页面滚不动）
             * —— 玩家会以为界面卡住了。加一个「看更早的」按钮是**加东西不加分支**。
             */}
            <ol className="space-y-2">
              {(chronicleExpanded ? [...chronicle].reverse() : [...chronicle].reverse().slice(0, 8)).map(
                (c) => (
                  <li key={c.turn} className="flex gap-2.5">
                    <span className="mt-0.5 w-5 shrink-0 text-right font-mono text-[10px] text-mist-500">
                      {c.turn}
                    </span>
                    <div className="min-w-0 flex-1 border-l border-ink-700 pl-2.5">
                      {saidByTurn.get(c.turn) && (
                        <p className="mb-1 border-l-2 border-gold-600/50 pl-2 text-[11px] leading-relaxed text-gold-400">
                          我说：{saidByTurn.get(c.turn)}
                        </p>
                      )}
                      <p className="text-[12px] leading-relaxed text-mist-300">{c.text}</p>
                      {c.location && (
                        <p className="mt-0.5 text-[10px] text-mist-500">{c.location}</p>
                      )}
                    </div>
                  </li>
                )
              )}
            </ol>
            {chronicle.length > 8 && (
              <button
                onClick={() => setChronicleExpanded((v) => !v)}
                className="mt-2 w-full rounded-md border border-ink-700 py-1 text-[11px] text-mist-500 transition hover:border-gold-600/50 hover:text-gold-400"
              >
                {chronicleExpanded
                  ? '收起早先的'
                  : `看更早的 ${chronicle.length - 8} 条 ›`}
              </button>
            )}
          </>
        )}
      </Section>

      {/*
       * 1-B：世界书 · 生效 N（常驻入口）。
       *
       * 主人要求「世界书和角色卡等含大量信息的部件**需要在主界面有入口**」。
       * 这里给的是**摘要 + 直达**：看得见"现在哪几条正在生效"，
       * 点「全部 ›」一步跳到准备页的世界书页签（整页编辑）。
       *
       * 为什么压缩成一行一条：协作方压测的结论是"侧栏不许假设内容很少"，
       * 而世界书条目正文动辄几百字 —— 铺开就是侧栏被一块吃掉。
       * **塞信息，不塞留白**：关键词给全，正文不给（正文去准备页看）。
       */}
      <Section
        icon="book"
        title={`世界书${liveWorldbook.length ? ` · 生效 ${liveWorldbook.length}` : ''}`}
        action={{ label: '全部 ›', onClick: () => onOpenPrep('worldbook') }}
      >
        {liveWorldbook.length === 0 ? (
          <Empty
            text={
              worldbook.length > 0
                ? `共 ${worldbook.length} 条，这一轮没有关键词命中`
                : '还没写过世界书条目 —— 点「全部 ›」去加'
            }
          />
        ) : (
          <ul className="space-y-1">
            {liveWorldbook.map((e) => (
              <li
                key={e.id}
                className="flex items-center gap-2 rounded-md bg-ink-850 px-2.5 py-1.5"
              >
                <span className="min-w-0 flex-1 truncate font-mono text-[11px] text-mist-400">
                  {e.keys.join('、') || e.content.slice(0, 20)}
                </span>
                {e.constant && (
                  <span className="shrink-0 rounded border border-gold-600/50 px-1 text-[9px] text-gold-400">
                    常驻
                  </span>
                )}
              </li>
            ))}
          </ul>
        )}
      </Section>

      {/*
       * 1-B：角色卡 · 全文（常驻入口）。
       *
       * 「角色卡」不是只有属性 —— 名字 / 外貌 / 来历这三样**撑起了守密人对你的全部称呼**，
       * 而它们原先只躺在准备页里。这里给摘要（三行内），全文去准备页。
       *
       * 属性/技能那些已经常驻在**左栏**（`CharacterSheet`），所以这里**刻意不重复**：
       * 左右栏信息不许重叠（压测铁律）—— 重叠＝两边都在滚。
       */}
      <Section
        icon="profile"
        title="角色卡"
        action={{ label: '全文 ›', onClick: () => onOpenPrep('character') }}
      >
        <div className="space-y-1">
          <p className="text-[12px] text-mist-200">{character.name || '未命名'}</p>
          {character.gender && (
            <p className="text-[11px] text-mist-500">{character.gender}</p>
          )}
          {character.appearance?.trim() ? (
            <p className="text-[11px] leading-relaxed text-mist-400">
              {character.appearance.trim()}
            </p>
          ) : (
            <p className="text-[11px] leading-relaxed text-mist-500">
              还没写外貌 —— 守密人只能自己脑补你长什么样。
            </p>
          )}
        </div>
      </Section>

      {npcCard && <NpcCardModal profile={npcCard} onClose={() => setNpcCard(null)} />}
    </div>
  );
}
