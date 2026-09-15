import { useEffect, useRef, useState } from 'react';
import { useStore, mapNodesOf, type MapNode } from './store';
import { ImageField } from './ImageField';
import { AnchorList } from './EndingScreen';
import { mapImagePrompt, sceneImagePrompt } from '../orchestrator/generate.js';
import { getGenre } from '../core/genres.js';

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

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section>
      <h3 className="mb-2 text-[11px] tracking-wider text-mist-500">{title}</h3>
      {children}
    </section>
  );
}

function Empty({ text }: { text: string }) {
  return <p className="text-[12px] text-mist-500/70">{text}</p>;
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
                <span className="text-gold-500/80">赌注：</span>
                {stakes}
              </p>
            )}
            {urgency && (
              <p className="text-[11px] leading-relaxed text-mist-400">
                <span className="text-gold-500/80">紧迫：</span>
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
  onTravel,
}: {
  nodes: MapNode[];
  current: string;
  revealed: Set<string>;
  /** 真正去过的地方（"只是听说过"的不算）——用来区分实心与虚线两种亮度 */
  visited?: Set<string>;
  onTravel?: (location: string) => void;
}) {
  const [zoom, setZoom] = useState(1);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const dragRef = useRef<{ x: number; y: number; moved: boolean } | null>(null);
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
  const radius = n <= 1 ? 0 : Math.min(118, 34 + n * 13);
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
                    if (known) onTravel?.(nd.name);
                  }}
                  style={{ cursor: known && onTravel ? 'pointer' : 'default' }}
                >
                  <title>
                    {!known ? '还没听说过这个地方' : nd.note ? `${nd.name}：${nd.note}` : nd.name}
                  </title>
                  <circle
                    cx={p.x}
                    cy={p.y}
                    r={here ? 26 : 23}
                    fill={
                      here
                        ? 'var(--c-accent)'
                        : been
                          ? 'var(--c-elevated)'
                          : 'transparent'
                    }
                    stroke={
                      here
                        ? 'var(--c-accent)'
                        : known
                          ? 'var(--c-border-strong)'
                          : 'var(--c-border)'
                    }
                    strokeWidth={1.4}
                    strokeDasharray={!known ? '3 3' : been || here ? undefined : '3 4'}
                  />
                  <text
                    x={p.x}
                    y={twoLine ? p.y - 1 : p.y + 4}
                    textAnchor="middle"
                    fontSize={twoLine ? 9.5 : 11}
                    fill={here ? '#14171d' : known ? 'var(--c-text)' : 'var(--c-muted)'}
                  >
                    {lines.map((ln, li) => (
                      <tspan key={li} x={p.x} dy={li === 0 ? 0 : 11.5}>
                        {ln}
                      </tspan>
                    ))}
                  </text>
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
 */
function MapSection({
  nodes,
  current,
  revealed,
  visited,
  mapImage,
  onTravel,
}: {
  nodes: MapNode[];
  current: string;
  revealed: Set<string>;
  visited?: Set<string>;
  mapImage: string;
  onTravel?: (location: string) => void;
}) {
  const module = useStore((s) => s.module);
  const setMapImage = useStore((s) => s.setMapImage);
  const genreId = useStore((s) => s.genreId);
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
        onTravel={onTravel}
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
                disabled={isCurrent || !onTravel}
                onClick={() => onTravel?.(nd.name)}
                title={isCurrent ? '你就在这里' : nd.note || `前往${nd.name}`}
                className={`max-w-full truncate rounded-md border px-2 py-0.5 text-[11px] transition ${
                  isCurrent
                    ? 'border-gold-600/70 bg-gold-500/10 text-gold-300'
                    : 'border-ink-600 text-mist-300 hover:border-gold-600/50 hover:text-mist-100'
                }`}
              >
                {nd.name}
                {isCurrent && <span className="ml-1 text-[9px] text-gold-500/80">你在这里</span>}
              </button>
            );
          })}
      </div>

      <p className="mt-1.5 text-[10px] leading-relaxed text-mist-500/70">
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
            onSave={setMapImage}
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
}: {
  onPromptCompanion?: (name: string) => void;
  onTravel?: (location: string) => void;
  onRewind?: (msgId: string) => void;
}) {
  const gameState = useStore((s) => s.gameState);
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
  // 剧情标记是给玩家看的，只显示中文键名；模型漏填的英文 key 直接藏起来
  const flags = Object.entries(gameState.flags).filter(([k]) => /[\u4e00-\u9fa5]/.test(k));
  const location = gameState.location?.trim();

  // 地图节点：优先用模组给的"可达关系图"，没有就从「关键地点」兜底生成
  const baseNodes = mapNodesOf(module);
  /*
   * 地点**软同步**（协作方 E）：
   * 守密人经常把玩家带到地图上没写的地方（"河边""那间废弃的澡堂"）。
   * 那种时候不能阻断叙事，也不该让玩家在地图上找不到自己——
   * 把去过但不在图上的地点作为**孤立节点**补进来，并注明"图上原本没有"。
   */
  const namesOnMap = baseNodes.map((n) => n.name);
  const extraNodes: MapNode[] = [];
  for (const v of gameState.visited ?? []) {
    const t = v.trim();
    if (!t) continue;
    if (namesOnMap.some((n) => n === t || n.includes(t) || t.includes(n))) continue;
    if (extraNodes.some((n) => n.name === t)) continue;
    extraNodes.push({ name: t, links: [], note: '图上原本没有这个地点' });
  }
  const mapNodes: MapNode[] = [...baseNodes, ...extraNodes];
  /*
   * 地图迷雾：只画玩家"知道"的地方，避免开局把整张图摊开剧透。
   * 但**没有可达关系时不启用迷雾**——那样玩家会被锁死在原地（不知道任何别的地方，
   * 也就无处可去），反而更糟。这时按老行为全显示。
   */
  const hasLinks = mapNodes.some((nd) => (nd.links ?? []).length > 0);
  const knownText = [...chronicle.map((c) => c.text), ...gameState.clues, summary].join('\n');
  const revealed = hasLinks
    ? revealedNodeNames(mapNodes, gameState.visited ?? [], location ?? '', knownText)
    : new Set(mapNodes.map((nd) => nd.name));

  /*
   * 「去过」与「只是听说过」要能一眼分开（协作方建议，采纳）：
   * 去过的画实心，只是听说的画虚线空心——信息不丢，探索感也不被稀释。
   * visited 里存的可能是完整地点名（"霍尔特的侦探事务所"），节点名是简称，这里模糊匹配。
   */
  // 关键抉择（回溯锚点）：倒序，最近的岔路口排最前
  const anchors = messages
    .filter((m) => m.role === 'player' && snapshots[m.id]?.key)
    .map((m) => ({ id: m.id, label: snapshots[m.id]!.label, snap: snapshots[m.id]! }))
    .reverse();

  const visitedNames = new Set<string>();
  for (const v of gameState.visited ?? []) {
    const t = v.trim();
    if (!t) continue;
    const m = mapNodes.find((x) => x.name === t || x.name.includes(t) || t.includes(x.name));
    if (m) visitedNames.add(m.name);
  }

  return (
    <div className="space-y-6 p-4">
      <GoalSection goal={module.goal} stakes={module.stakes} urgency={module.urgency} />

      {(gameState.threads ?? []).length > 0 && (
        <Section title="进行中的线">
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
        mapImage={mapImage}
        onTravel={onTravel}
      />

      {/*
       * 关键节点（回溯锚点）。
       * 结档页里能回溯，但平常也得有个入口——不然玩家只记得"某一步好像走错了"，
       * 却要在一百多条消息里翻。这里只列被标为关键的那几个岔路口。
       */}
      <Section title={`关键抉择${anchors.length ? `（${anchors.length}）` : ''}`}>
        {anchors.length > 0 ? (
          <AnchorList anchors={anchors} onRewind={(id) => onRewind?.(id)} />
        ) : (
          <Empty text="还没有关键抉择——掷骰、进入战斗、转移地点、拿到新线索都会自动记一个。" />
        )}
      </Section>

      {module.premise && (
        <Section title="剧情简介">
          <p className="rounded-md border-l-2 border-ink-500 bg-ink-850/70 px-2.5 py-2 text-[12px] leading-relaxed text-mist-400">
            {module.premise}
          </p>
        </Section>
      )}

      <Section title="场景">
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
            onSave={(url) => setSceneImage(location, url)}
            onClear={() => setSceneImage(location, '')}
          />
        ) : (
          <Empty text="尚未进入具体场景" />
        )}
      </Section>

      {gameState.companions.length > 0 && (
        <Section title="同行者">
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
                onClick={() => onPromptCompanion?.(c.name)}
              />
            ))}
          </div>
          <p className="mt-2 text-[10px] leading-relaxed text-mist-500/70">
            点击队友可在输入框中唤起 TA
          </p>
        </Section>
      )}

      <Section title="在地人物">
        <ul className="space-y-1">
          <li className="rounded-md border-l-2 border-gold-600/60 bg-ink-850 px-2.5 py-1.5 text-[12px] text-mist-300">
            {character.name}（你）
          </li>
          {gameState.companions
            .filter((c) => c.alive && c.present)
            .map((c) => (
              <li
                key={c.id}
                className="rounded-md border-l-2 border-arcane-600/60 bg-ink-850 px-2.5 py-1.5 text-[12px] text-mist-300"
              >
                {c.name}
              </li>
            ))}
          {gameState.npcsAlive.map((npc) => (
            <li
              key={npc}
              className="rounded-md border-l-2 border-blood-400/50 bg-ink-850 px-2.5 py-1.5 text-[12px] text-mist-300"
            >
              {npc}
            </li>
          ))}
        </ul>
      </Section>

      <Section title="线索">
        {gameState.clues.length === 0 ? (
          <Empty text="尚未发现任何线索" />
        ) : (
          <ul className="space-y-1.5">
            {gameState.clues.map((clue, i) => (
              <li
                key={i}
                className="rounded-md border-l-2 border-gold-600/60 bg-ink-850 px-2.5 py-2 text-[12px] leading-relaxed text-mist-300"
              >
                {clue}
              </li>
            ))}
          </ul>
        )}
      </Section>

      <Section title="检定记录">
        {(() => {
          const checks = messages
            .filter((m) => m.check)
            .map((m) => m.check!)
            .reverse();
          if (checks.length === 0) return <Empty text="还没有检定过" />;
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

      <Section title="剧情标记">
        {flags.length === 0 ? (
          <Empty text="无" />
        ) : (
          <ul className="space-y-1">
            {flags.map(([key, value]) => (
              <li
                key={key}
                className="flex items-center justify-between rounded-md bg-ink-850 px-2.5 py-1.5"
              >
                <span className="font-mono text-[11px] text-mist-400">{key}</span>
                <span
                  className={`text-[11px] ${
                    value ? 'text-moss-400' : 'text-mist-500'
                  }`}
                >
                  {String(value)}
                </span>
              </li>
            ))}
          </ul>
        )}
      </Section>

      <Section title={`编年史${chronicle.length ? `（${chronicle.length}）` : ''}`}>
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
          <ol className="space-y-2">
            {[...chronicle].reverse().map((c) => (
              <li key={c.turn} className="flex gap-2.5">
                <span className="mt-0.5 w-5 shrink-0 text-right font-mono text-[10px] text-mist-500">
                  {c.turn}
                </span>
                <div className="min-w-0 flex-1 border-l border-ink-700 pl-2.5">
                  <p className="text-[12px] leading-relaxed text-mist-300">{c.text}</p>
                  {c.location && (
                    <p className="mt-0.5 text-[10px] text-mist-500/70">{c.location}</p>
                  )}
                </div>
              </li>
            ))}
          </ol>
        )}
      </Section>
    </div>
  );
}
