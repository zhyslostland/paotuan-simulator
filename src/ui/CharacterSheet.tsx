import { useState } from 'react';
import { deriveVitalsFor, deriveVitalsMax, resolveCheckTarget, useStore } from './store';
import { getRuleset } from '../core/rulesets/index.js';
import type { InventoryItem } from '../core/state/gameState.js';

export type Difficulty = 'regular' | 'hard' | 'extreme';

/** 检定面板：一次选好技能、难度、目标，并描述自己想怎么做——行为与检定一起发送 */
export function CheckDialog({
  skill,
  onConfirm,
  onCancel,
}: {
  skill: string;
  onConfirm: (target: string, action: string) => void;
  onCancel: () => void;
}) {
  const character = useStore((s) => s.character);
  const gameState = useStore((s) => s.gameState);
  const rulesetId = useStore((s) => s.rulesetId);
  const [target, setTarget] = useState('');
  const [action, setAction] = useState('');

  const rs = getRuleset(rulesetId);
  const rawValue = resolveCheckTarget(skill, character, rs) ?? 50;
  // DnD 把属性分值折算成加值（15 → +2）；技能本身已是加值则原样
  const value = rs.toModifier ? rs.toModifier(skill, rawValue) : rawValue;
  const isPercent = rs.mainDice === '1d100';
  // 若检定的是属性（而非技能），取它的简介在面板里科普；技能同理
  const attrDef = rs.characteristicDefs.find(
    (d) => d.key === skill || d.label === skill
  );
  const skillDef = rs.skillCatalog.find((s) => s.name === skill);
  const checkDesc = attrDef?.desc ?? skillDef?.desc;
  const npcTargets = gameState.npcsAlive;
  const mateTargets = gameState.companions
    .filter((c) => c.alive && c.present)
    .map((c) => c.name);

  const valueText = isPercent ? `${value}%` : `${value >= 0 ? '+' : ''}${value}`;

  const targetBtn = (t: string, label?: string) => (
    <button
      key={t}
      onClick={() => setTarget(t)}
      className={`rounded-md border px-2.5 py-1 text-[12px] transition ${
        target === t
          ? 'border-gold-600/70 text-gold-400'
          : 'border-ink-600 text-mist-400'
      }`}
    >
      {label ?? t}
    </button>
  );

  return (
    /*
     * 检定面板：右侧浮动、**不模糊也不透**。
     *
     * 早期用了 `backdrop-blur-sm` + 半透明底，结果背后的故事正文被糊成一团，
     * 玩家读不到"自己正在回应什么"，等于边看边瞎。
     * 现在改成不透明底色（把正文完全挡住而不是糊掉），并在宽屏上收窄，
     * 好让左边的正文仍然看得见。
     */
    <div className="pointer-events-none fixed inset-y-0 right-0 z-50 flex items-center justify-end p-4">
      <div className="pointer-events-auto max-h-[92vh] w-full max-w-sm overflow-y-auto rounded-2xl border border-ink-600 bg-ink-900 p-5 shadow-2xl lg:max-w-xs">
        <h3 className="font-serif text-[15px] text-mist-100">
          {skill} 检定
          <span className="ml-2 text-[12px] text-gold-500/80">{valueText}</span>
        </h3>
        {rs.beginnerGuide && (
          <p className="mt-1.5 rounded-md bg-ink-850 px-2.5 py-1.5 text-[10px] leading-relaxed text-mist-500">
            {rs.beginnerGuide}
          </p>
        )}
        {checkDesc && (
          <p className="mt-1.5 rounded-md bg-ink-850 px-2.5 py-1.5 text-[11px] leading-relaxed text-mist-400">
            {checkDesc}
          </p>
        )}

        <div className="mt-4">
          <span className="mb-1.5 block text-[11px] text-mist-400">
            对象 <span className="text-mist-500/70">（可选，也可自己填）</span>
          </span>
          <div className="flex flex-wrap gap-1.5">
            {targetBtn('', '环境／无特定')}
          </div>
          {npcTargets.length > 0 && (
            <div className="mt-2">
              <span className="mb-1 block text-[10px] text-mist-500/80">在场人物</span>
              <div className="flex flex-wrap gap-1.5">
                {npcTargets.map((t) => targetBtn(t))}
              </div>
            </div>
          )}
          {mateTargets.length > 0 && (
            <div className="mt-2">
              <span className="mb-1 block text-[10px] text-mist-500/80">
                同行者 <span className="text-mist-500/60">（你的队友）</span>
              </span>
              <div className="flex flex-wrap gap-1.5">
                {mateTargets.map((t) => targetBtn(t))}
              </div>
            </div>
          )}
          <input
            className="mt-2 w-full rounded-md border border-ink-600 bg-ink-950 px-2.5 py-1.5 text-[12px] text-mist-100 outline-none transition focus:border-gold-600/60"
            value={target}
            onChange={(e) => setTarget(e.target.value)}
            placeholder="也可直接填写对象（如：扑来的怪物、雾里的东西、那封信）"
          />
        </div>

        <div className="mt-4">
          <span className="mb-1.5 block text-[11px] text-mist-400">
            你想怎么做 <span className="text-mist-500/70">（行为描述，会一起发给守密人）</span>
          </span>
          <textarea
            className="w-full resize-none rounded-lg border border-ink-600 bg-ink-950 px-3 py-2 text-[13px] text-mist-100 outline-none transition focus:border-gold-600/60"
            rows={2}
            value={action}
            onChange={(e) => setAction(e.target.value)}
            placeholder={`例如：我${skill}，试着……`}
          />
        </div>

        <div className="mt-3 flex gap-2">
          <button
            onClick={() => onConfirm(target, action)}
            className="flex-1 rounded-lg bg-gold-500 px-4 py-2 text-[13px] font-medium text-ink-950 transition hover:bg-gold-400"
          >
            掷骰检定
          </button>
          <button
            onClick={onCancel}
            className="rounded-lg border border-ink-600 px-4 py-2 text-[13px] text-mist-400 transition hover:text-mist-100"
          >
            取消
          </button>
        </div>
      </div>
    </div>
  );
}

function VitalBar({
  label,
  value,
  max,
  tone,
}: {
  label: string;
  value: number;
  max: number;
  tone: 'hp' | 'san' | 'mp';
}) {
  const pct = max > 0 ? Math.max(0, Math.min(100, (value / max) * 100)) : 0;
  const fill =
    tone === 'hp'
      ? 'bg-blood-400'
      : tone === 'san'
        ? 'bg-arcane-400'
        : 'bg-moss-400';
  const danger = pct <= 25;
  return (
    <div>
      <div className="mb-1 flex items-baseline justify-between">
        <span className="text-[11px] tracking-wider text-mist-500">{label}</span>
        <span
          className={`text-[12px] tabular-nums ${danger ? 'text-blood-400' : 'text-mist-300'}`}
        >
          {value} / {max}
        </span>
      </div>
      <div className="h-1.5 overflow-hidden rounded-full bg-ink-700">
        <div
          className={`h-full rounded-full transition-all duration-500 ${fill} ${
            danger ? 'opacity-100' : 'opacity-80'
          }`}
          style={{ width: `${pct}%` }}
        />
      </div>
    </div>
  );
}

/**
 * 物品详情弹窗：点背包里的一件东西，弹出它"是什么、能干嘛"。
 * 用弹窗而不是行内展开——行内展开会把下面的物品顶下去，读起来很跳。
 */
function ItemDialog({
  item,
  onClose,
}: {
  item?: InventoryItem;
  onClose: () => void;
}) {
  if (!item) return null;
  const KIND_LABEL: Record<string, string> = {
    weapon: '武器',
    tool: '工具',
    clue: '线索物',
    consumable: '消耗品',
    other: '物品',
  };
  return (
    <div
      onClick={onClose}
      className="fixed inset-0 z-[80] flex items-end justify-center bg-black/50 px-4 pb-6 sm:items-center sm:pb-0"
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-sm rounded-xl border border-ink-600 bg-ink-900 p-4 shadow-2xl"
      >
        <div className="flex items-start justify-between gap-2">
          <h3 className="font-serif text-[15px] text-mist-100">{item.name}</h3>
          <button
            onClick={onClose}
            className="shrink-0 text-[13px] text-mist-500 transition hover:text-mist-300"
          >
            ✕
          </button>
        </div>
        <div className="mt-1 flex flex-wrap items-center gap-2 text-[10px]">
          {item.kind && (
            <span className="rounded bg-ink-700 px-1.5 py-0.5 text-mist-400">
              {KIND_LABEL[item.kind] ?? '物品'}
            </span>
          )}
          {item.qty > 1 && <span className="text-mist-500">数量 ×{item.qty}</span>}
        </div>

        {item.desc ? (
          <p className="mt-2.5 text-[12px] leading-relaxed text-mist-300">{item.desc}</p>
        ) : (
          <p className="mt-2.5 text-[12px] leading-relaxed text-mist-500/70">
            还没有简介——AI 生成的角色卡会带物品说明，也可以自己在准备页补一句。
          </p>
        )}

        {item.kind === 'weapon' && (
          <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1.5 rounded-md bg-ink-850 px-3 py-2 text-[11px] text-mist-400">
            {item.damage && (
              <span>
                伤害 <b className="text-blood-300">{item.damage}</b>
              </span>
            )}
            {item.skill && (
              <span>
                检定技能 <b className="text-gold-400">{item.skill}</b>
              </span>
            )}
          </div>
        )}

        {item.note && <p className="mt-2 text-[11px] text-mist-500">{item.note}</p>}
      </div>
    </div>
  );
}

export function CharacterSheet({
  onRequestCheck,
}: {
  onRequestCheck: (skill: string) => void;
}) {
  const character = useStore((s) => s.character);
  const gameState = useStore((s) => s.gameState);
  const rulesetId = useStore((s) => s.rulesetId);
  const streaming = useStore((s) => s.streaming);
  const [showFull, setShowFull] = useState(false);
  const [openItem, setOpenItem] = useState<string | null>(null);

  const rs = getRuleset(rulesetId);
  const vitalsMax = deriveVitalsMax(character, rulesetId);
  // 缺键时用属性派生值兜底，而不是显示 0
  const vitalsDerived = deriveVitalsFor(character, rulesetId);
  const maxOf = (key: string) => vitalsMax[key] ?? rs.vitalDefs.find((v) => v.key === key)?.max ?? 99;
  const extras = rs.deriveExtras?.(character.characteristics) ?? {};

  return (
    <div className="space-y-6 p-4">
      <section>
        {character.portrait && (
          <img
            src={character.portrait}
            alt={character.name}
            className="mb-3 aspect-square w-full rounded-xl border border-ink-600 object-cover"
          />
        )}
        <div className="flex items-baseline justify-between gap-2">
          <h2 className="font-serif text-lg text-mist-100">{character.name}</h2>
          {character.gender && (
            <span className="text-[12px] text-mist-500">{character.gender}</span>
          )}
        </div>
        {character.description && !showFull && (
          <p className="mt-2 text-[12px] leading-relaxed text-mist-400">
            {character.description.slice(0, 42)}
            {character.description.length > 42 ? '…' : ''}
          </p>
        )}
        {showFull && (
          <>
            {character.description && (
              <p className="mt-2 text-[12px] leading-relaxed text-mist-400">
                {character.description}
              </p>
            )}
            {character.personality && (
              <p className="mt-2 text-[12px] leading-relaxed text-mist-500">
                {character.personality}
              </p>
            )}
            {character.items && character.items.length > 0 && (
              <p className="mt-2 text-[11px] leading-relaxed text-mist-500">
                随身：{character.items.join('、')}
              </p>
            )}
          </>
        )}
        <button
          onClick={() => setShowFull((v) => !v)}
          className="mt-1.5 text-[11px] text-gold-500/80 transition hover:text-gold-400"
        >
          {showFull ? '收起简介' : '展开简介'}
        </button>
      </section>

      {gameState.companions.length > 0 && (
        <section>
          <h3 className="mb-2 text-[11px] tracking-wider text-mist-500">同行者</h3>
          <div className="space-y-2">
            {gameState.companions.map((c) => (
              <div key={c.id} className="flex items-center gap-2.5">
                {c.portrait ? (
                  <img
                    src={c.portrait}
                    alt={c.name}
                    className="h-11 w-11 shrink-0 rounded-lg border border-ink-600 object-cover"
                  />
                ) : (
                  <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-lg border border-ink-600 bg-ink-850 font-serif text-[15px] text-mist-400">
                    {c.name.slice(0, 1)}
                  </div>
                )}
                <div className="min-w-0 flex-1">
                  <div className="flex items-baseline gap-1.5">
                    <span
                      className={`truncate text-[12px] ${
                        c.alive && c.present ? 'text-mist-100' : 'text-mist-500 line-through'
                      }`}
                    >
                      {c.name}
                    </span>
                    {!c.present && c.alive && (
                      <span className="shrink-0 text-[9px] text-mist-500">离队</span>
                    )}
                    {!c.alive && <span className="shrink-0 text-[9px] text-blood-400">已死亡</span>}
                  </div>
                  <div className="truncate text-[10px] text-mist-500">{c.role}</div>
                </div>
              </div>
            ))}
          </div>
        </section>
      )}

      <section>
        <h3 className="mb-2 text-[11px] tracking-wider text-mist-500">
          属性 <span className="text-mist-500/60">（点击检定）</span>
        </h3>
        <div className="grid grid-cols-4 gap-1.5">
          {rs.characteristicDefs.map((d) => (
            <button
              key={d.key}
              disabled={streaming}
              onClick={() => onRequestCheck(d.label)}
              title={d.desc}
              className="rounded-md bg-ink-850 px-1 py-1.5 text-center transition hover:border hover:border-gold-600/50 hover:bg-ink-800 disabled:opacity-40"
            >
              <div className="text-[10px] text-mist-500">{d.label}</div>
              <div className="text-[13px] tabular-nums text-mist-200">
                {character.characteristics[d.key] ?? d.default}
              </div>
            </button>
          ))}
        </div>
        {Object.keys(extras).length > 0 && (
          <div className="mt-2 flex flex-wrap gap-1.5">
            {Object.entries(extras).map(([label, v]) => (
              <div
                key={label}
                className="rounded-md bg-ink-850 px-2 py-1 text-[11px] text-mist-400"
              >
                {label} <span className="text-mist-200">{v}</span>
              </div>
            ))}
          </div>
        )}
      </section>

      <section className="space-y-3">
        <h3 className="text-[11px] tracking-wider text-mist-500">状态</h3>
        {(Boolean(gameState.flags['永久疯狂']) ||
          Boolean(gameState.flags['濒临死亡']) ||
          Boolean(gameState.flags['濒死']) ||
          Boolean(gameState.flags['临时疯狂'])) && (
          <div className="flex flex-wrap gap-1.5">
            {Boolean(gameState.flags['永久疯狂']) && (
              <span className="rounded-md bg-blood-400/15 px-2 py-0.5 text-[10px] text-blood-300">
                永久疯狂
              </span>
            )}
            {Boolean(gameState.flags['濒临死亡']) && (
              <span className="rounded-md bg-blood-400/15 px-2 py-0.5 text-[10px] text-blood-300">
                濒临死亡
              </span>
            )}
            {Boolean(gameState.flags['濒死']) && (
              <span className="rounded-md bg-blood-400/15 px-2 py-0.5 text-[10px] text-blood-300">
                濒死
              </span>
            )}
            {Boolean(gameState.flags['临时疯狂']) && (
              <span className="rounded-md bg-arcane-400/15 px-2 py-0.5 text-[10px] text-arcane-300">
                临时疯狂
              </span>
            )}
          </div>
        )}
        {rs.vitalDefs.map((v) => (
          <VitalBar
            key={v.key}
            label={`${v.label} · ${v.key.toUpperCase()}`}
            value={Math.min(
              gameState.vitals[v.key] ?? vitalsDerived[v.key] ?? v.default,
              maxOf(v.key)
            )}
            max={maxOf(v.key)}
            tone={v.key as 'hp' | 'san' | 'mp'}
          />
        ))}
      </section>

      <section>
        <h3 className="mb-2 text-[11px] tracking-wider text-mist-500">
          技能 <span className="text-mist-500/60">（点击检定）</span>
        </h3>
        <div className="grid grid-cols-2 gap-1.5">
          {Object.entries(character.skills)
            // 由高到低：一眼看到自己最擅长什么，不用在几十项里找
            .sort((a, b) => b[1] - a[1])
            .map(([skill, value]) => (
            <button
              key={skill}
              disabled={streaming}
              onClick={() => onRequestCheck(skill)}
              className="group flex items-center justify-between rounded-md border border-ink-700 bg-ink-850 px-2.5 py-1.5 text-left transition hover:border-gold-600/50 hover:bg-ink-800 disabled:opacity-40"
            >
              <span className="text-[12px] text-mist-300 group-hover:text-mist-100">
                {skill}
              </span>
              <span className="text-[12px] tabular-nums text-gold-500/80">
                {rs.mainDice === '1d100'
                  ? `${value}%`
                  : `${value >= 0 ? '+' : ''}${value}`}
              </span>
            </button>
          ))}
        </div>
        <p className="mt-2 text-[10px] leading-relaxed text-mist-500/70">
          {rs.beginnerGuide || '点击技能即可检定，并可指定对象。'}
        </p>
      </section>

      <section>
        <h3 className="mb-2 text-[11px] tracking-wider text-mist-500">
          背包 <span className="text-mist-500/70">（点击查看详情）</span>
        </h3>
        {gameState.inventory.length === 0 ? (
          <p className="text-[12px] text-mist-500/70">空空如也</p>
        ) : (
          <ul className="space-y-1">
            {gameState.inventory.map((item) => {
              const isWeapon = item.kind === 'weapon' && Boolean(item.damage);
              return (
                <li key={item.id}>
                  <button
                    onClick={() => setOpenItem(item.id)}
                    className="flex w-full items-center justify-between gap-2 rounded-md bg-ink-850 px-2.5 py-1.5 text-left transition hover:bg-ink-800"
                  >
                    <span className="flex min-w-0 items-center gap-1.5">
                      <span className="truncate text-[12px] text-mist-300">{item.name}</span>
                      {isWeapon && (
                        <span className="shrink-0 rounded bg-blood-400/15 px-1 py-0.5 text-[9px] text-blood-300">
                          {item.damage}
                        </span>
                      )}
                    </span>
                    {item.qty > 1 && (
                      <span className="shrink-0 text-[11px] tabular-nums text-mist-500">
                        ×{item.qty}
                      </span>
                    )}
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </section>

      {openItem && (
        <ItemDialog
          item={gameState.inventory.find((i) => i.id === openItem)}
          onClose={() => setOpenItem(null)}
        />
      )}

      <section>
        <h3 className="mb-2 text-[11px] tracking-wider text-mist-500">当前地点</h3>
        <p className="rounded-md bg-ink-850 px-2.5 py-2 text-[12px] text-mist-300">
          {gameState.location || '未知'}
        </p>
      </section>
    </div>
  );
}
