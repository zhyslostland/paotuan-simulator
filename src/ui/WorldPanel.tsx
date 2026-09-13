import { useRef, useState } from 'react';
import { useStore, mapNodesOf, type MapNode } from './store';
import { ImageField } from './ImageField';
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
 * 地图节点关系图：节点＝地点、连线＝走得通。
 *
 * 三件事必须做到：**空间信息**（谁挨着谁）、**可缩放拖拽**（侧栏太小看不清）、
 * **迷雾**（没去过的地方不摊开，否则等于剧透）。
 */
function MapGraph({
  nodes,
  current,
  revealed,
  onTravel,
}: {
  nodes: MapNode[];
  current: string;
  revealed: Set<string>;
  onTravel?: (location: string) => void;
}) {
  const [zoom, setZoom] = useState(1);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const dragRef = useRef<{ x: number; y: number; moved: boolean } | null>(null);
  const [dragging, setDragging] = useState(false);

  const n = nodes.length;
  if (n === 0) return null;

  const W = 340;
  const H = 300;
  const cx = W / 2;
  const cy = H / 2;
  const radius = n <= 1 ? 0 : Math.min(112, 30 + n * 11);
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

  const clampZoom = (z: number) => Math.max(0.7, Math.min(3, Number(z.toFixed(2))));
  const reset = () => {
    setZoom(1);
    setPan({ x: 0, y: 0 });
  };

  return (
    <div className="relative">
      <div
        className="relative aspect-[17/15] w-full touch-none overflow-hidden rounded-lg border border-ink-700 bg-ink-850/60"
        onPointerDown={(e) => {
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
        onPointerUp={() => {
          setDragging(false);
        }}
        onPointerCancel={() => {
          setDragging(false);
        }}
        onWheel={(e) => {
          if (!e.ctrlKey && !e.metaKey) return;
          e.preventDefault();
          setZoom((z) => clampZoom(z - e.deltaY * 0.002));
        }}
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
              const label = known
                ? nd.name.length > 6
                  ? `${nd.name.slice(0, 6)}…`
                  : nd.name
                : '？';
              return (
                <g
                  key={nd.name}
                  onClick={() => {
                    // 拖动过就不算点击，避免平移地图时不慎搬家
                    if (dragRef.current?.moved) return;
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
                    r={here ? 25 : 21}
                    fill={here ? 'var(--c-accent)' : known ? 'var(--c-elevated)' : 'transparent'}
                    stroke={
                      here ? 'var(--c-accent)' : known ? 'var(--c-border-strong)' : 'var(--c-border)'
                    }
                    strokeWidth={1.4}
                    strokeDasharray={known ? undefined : '3 3'}
                  />
                  <text
                    x={p.x}
                    y={p.y + 4}
                    textAnchor="middle"
                    fontSize={known ? 11 : 12}
                    fill={here ? '#14171d' : known ? 'var(--c-text)' : 'var(--c-muted)'}
                  >
                    {label}
                  </text>
                </g>
              );
            })}
          </svg>
        </div>

        {/* 缩放控件：侧栏里挤一张关系图，必须能放大看 */}
        <div className="absolute right-1.5 top-1.5 flex flex-col overflow-hidden rounded-md border border-ink-600 bg-ink-900/90">
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
        <span className="pointer-events-none absolute bottom-1.5 right-2 text-[10px] tabular-nums text-mist-500">
          {Math.round(zoom * 100)}%
        </span>
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
  mapImage,
  onTravel,
}: {
  nodes: MapNode[];
  current: string;
  revealed: Set<string>;
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

      <MapGraph nodes={nodes} current={here} revealed={shown} onTravel={onTravel} />

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

      <p className="mt-1.5 text-[10px] leading-relaxed text-mist-500/70">
        {hasLinks
          ? '连线表示走得通。拖动可平移，右上角加减放大。点地点即动身，转场由守密人替你演。'
          : '点地点即动身，路上的转场由守密人替你演。（这个模组还没给出地点间的可达关系）'}
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
}: {
  onPromptCompanion?: (name: string) => void;
  onTravel?: (location: string) => void;
}) {
  const gameState = useStore((s) => s.gameState);
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
  const mapNodes = mapNodesOf(module);
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
        mapImage={mapImage}
        onTravel={onTravel}
      />

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
