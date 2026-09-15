import { useState } from 'react';
import {
  canonicalSkillName,
  deriveVitalsFor,
  deriveVitalsMax,
  resolveCheckTarget,
  useStore,
} from './store';
import { ImageLightbox } from './ImageLightbox';
import {
  weighDescription,
  DIFFICULTY_LABEL,
  type Difficulty,
} from '../core/description.js';
import { getRuleset } from '../core/rulesets/index.js';
import type { InventoryItem } from '../core/state/gameState.js';

export type { Difficulty };
export { DIFFICULTY_LABEL };

/** 检定面板：一次选好技能、难度、目标，并描述自己想怎么做——行为与检定一起发送 */
export function CheckDialog({
  skill,
  onConfirm,
  onCancel,
}: {
  skill: string;
  onConfirm: (target: string, action: string, difficulty: Difficulty) => void;
  onCancel: () => void;
}) {
  const character = useStore((s) => s.character);
  const gameState = useStore((s) => s.gameState);
  const rulesetId = useStore((s) => s.rulesetId);
  const [target, setTarget] = useState('');
  const [action, setAction] = useState('');
  const [difficulty, setDifficulty] = useState<Difficulty>('regular');

  const rs = getRuleset(rulesetId);
  /*
   * 解析顺序里已经包含"规则包技能表的基础值"，所以未受训技能（角色卡里没写）
   * 会拿到它真实的基础值（如游泳 20%），而不是被兜底成 50%。
   * 只有连名字都对不上的才落到 0 —— 那种情况下 50% 是白送。
   */
  const rawValue = resolveCheckTarget(skill, character, rs) ?? 0;
  // DnD 把属性分值折算成加值（15 → +2）；技能本身已是加值则原样
  const value = rs.toModifier ? rs.toModifier(skill, rawValue) : rawValue;
  const isPercent = rs.mainDice === '1d100';
  // 若检定的是属性（而非技能），取它的简介在面板里科普；技能同理
  const attrDef = rs.characteristicDefs.find(
    (d) => d.key === skill || d.label === skill
  );
  const canon = canonicalSkillName(skill, rs);
  const skillDef = rs.skillCatalog.find((s) => s.name === canon || s.name === skill);
  const checkDesc = attrDef?.desc ?? skillDef?.desc;
  /** 角色卡里没写 → 这是"未受训"，按基础值掷 */
  const untrained =
    Boolean(skillDef) && character.skills[skill] == null && character.skills[skillDef!.name] == null;

  /*
   * 描述加权：**每一次检定都算**，不只是重掷。
   *
   * 只调难度档位（普通 / 困难 / 极难），不动目标值——规则包仍是权威，
   * 模型也看不到这个调整。分值封顶一档，避免"写一段小说就能必过"。
   * 判据只看"有没有提到场上真实存在的东西"和"有没有写明怎么做"，
   * 写得长不等于有分。
   */
  const needsWeapon =
    skillDef && /射击|投掷|弓/.test(skillDef.name) ? skillDef.name : null;
  const weight = weighDescription(action, {
    npcs: gameState.npcsAlive,
    visited: gameState.visited,
    clues: gameState.clues,
    items: gameState.inventory.map((i) => i.name),
    requiredWeapon: needsWeapon,
    hasWeapon: needsWeapon
      ? gameState.inventory.some((i) => i.kind === 'weapon' && i.skill?.trim() === needsWeapon)
      : true,
  }, difficulty);
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
        {untrained && (
          <p className="mt-1.5 rounded-md border border-ink-600 px-2.5 py-1.5 text-[11px] leading-relaxed text-mist-500">
            角色卡里没有专门练过这项 —— 按规则包给出的<span className="text-mist-300">基础值</span>
            掷（未受训就是低，不会白给高成功率）。
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

        {/* 难度：通常由守密人的要求决定，玩家也可以自己选更稳妥/更冒险的做法 */}
        <div className="mt-4">
          <span className="mb-1.5 block text-[11px] text-mist-400">
            难度
          </span>
          <div className="flex flex-wrap gap-1.5">
            {(['regular', 'hard', 'extreme'] as Difficulty[]).map((d) => (
              <button
                key={d}
                onClick={() => setDifficulty(d)}
                className={`rounded-md border px-2.5 py-1 text-[12px] transition ${
                  difficulty === d
                    ? 'border-gold-600/70 text-gold-400'
                    : 'border-ink-600 text-mist-400'
                }`}
              >
                {DIFFICULTY_LABEL[d]}
              </button>
            ))}
          </div>
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
          {/* 描述加权的结果必须让玩家看得见，否则他会以为是系统在偷偷改数值 */}
          <p className="mt-1.5 text-[11px] leading-relaxed">
            <span className={weight.score >= 2 ? 'text-moss-400' : weight.score <= -1 ? 'text-blood-300' : 'text-mist-500'}>
              {weight.score >= 2
                ? `描述加分 +${weight.score} → 难度降到${DIFFICULTY_LABEL[weight.difficulty]}`
                : weight.score <= -1
                  ? `描述 ${weight.score} → 难度升到${DIFFICULTY_LABEL[weight.difficulty]}`
                  : `描述 ${weight.score >= 1 ? `+${weight.score}` : weight.score} → 难度${DIFFICULTY_LABEL[weight.difficulty]}（不变）`}
            </span>
            <span className="ml-1 text-mist-500/70">（{weight.reasons.join('；')}）</span>
          </p>
        </div>

        <div className="mt-3 flex gap-2">
          <button
            onClick={() => onConfirm(target, action, weight.difficulty)}
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
  onAttack,
  onUse,
}: {
  item?: InventoryItem;
  onClose: () => void;
  /** 武器：走对应技能的检定 */
  onAttack?: (skill: string) => void;
  /** 消耗品/其它：本地扣 1，再把"使用意图"发给守密人演出效果 */
  onUse?: (item: InventoryItem) => void;
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

        {/* 用起来：武器走检定，消耗品本地扣 1 再交给守密人演效果 */}
        <div className="mt-3.5 flex flex-wrap gap-2">
          {item.kind === 'weapon' && (
            <button
              onClick={() => {
                const skill = item.skill?.trim() || '格斗（斗殴）';
                onClose();
                onAttack?.(skill);
              }}
              className="rounded-lg bg-gold-500 px-3 py-1.5 text-[12px] font-medium text-ink-950 transition hover:bg-gold-400"
            >
              用此武器攻击
            </button>
          )}
          {(item.kind === 'consumable' || item.kind !== 'weapon') && (
            <button
              onClick={() => {
                onClose();
                onUse?.(item);
              }}
              className="rounded-lg border border-gold-600/60 px-3 py-1.5 text-[12px] text-gold-300 transition hover:border-gold-500 hover:text-gold-200"
            >
              {item.kind === 'consumable' ? `使用（剩 ${item.qty}）` : '使用 / 交出去'}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

export function CharacterSheet({
  onRequestCheck,
  onUseItem,
}: {
  onRequestCheck: (skill: string) => void;
  /** 把"使用某件物品"的意图发给守密人（消耗品会先在本地扣数量） */
  onUseItem?: (text: string) => void;
}) {
  const character = useStore((s) => s.character);
  const gameState = useStore((s) => s.gameState);
  const rulesetId = useStore((s) => s.rulesetId);
  const streaming = useStore((s) => s.streaming);
  const [showFull, setShowFull] = useState(false);
  const [showAllSkills, setShowAllSkills] = useState(false);
  const [openItem, setOpenItem] = useState<string | null>(null);

  const rs = getRuleset(rulesetId);
  // 角色卡上没写的技能（用标准名去重，避免"手枪"与"射击（手枪）"重复出现）
  const ownedCanon = new Set(Object.keys(character.skills).map((k) => canonicalSkillName(k, rs)));
  const restSkills = rs.skillCatalog.filter(
    (s) => !ownedCanon.has(s.name) && character.skills[s.name] == null
  );
  const vitalsMax = deriveVitalsMax(character, rulesetId);
  // 缺键时用属性派生值兜底，而不是显示 0
  const vitalsDerived = deriveVitalsFor(character, rulesetId);
  const maxOf = (key: string) => vitalsMax[key] ?? rs.vitalDefs.find((v) => v.key === key)?.max ?? 99;
  const extras = rs.deriveExtras?.(character.characteristics) ?? {};

  return (
    <div className="space-y-6 p-4">
      <section>
        {character.portrait && (
          <ImageLightbox src={character.portrait} className="mb-3">
            <img
              src={character.portrait}
              alt={character.name}
              className="aspect-square w-full rounded-xl border border-ink-600 object-cover"
            />
          </ImageLightbox>
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
            .map(([skill, value]) => {
            /*
             * 有枪的技能 ≠ 手里有枪。
             * 背包里找不到对应武器时给一句灰字提示（仍可点，玩家知情即可）——
             * 否则会出现"角色卡写着射击 40%，背包里根本没枪"却在剧情里正常开枪。
             */
            const needWeapon = rs.skillCatalog.find(
              (s) => s.name === skill || s.name === canonicalSkillName(skill, rs)
            );
            const weaponMissing =
              needWeapon != null &&
              /射击|投掷|弓/.test(needWeapon.name) &&
              !gameState.inventory.some(
                (i) => i.kind === 'weapon' && i.skill?.trim() === needWeapon.name
              );
            const untrainedSkill = character.skills[skill] == null;
            return (
              <button
                key={skill}
                disabled={streaming}
                onClick={() => onRequestCheck(skill)}
                title={
                  weaponMissing
                    ? '背包里没有可用武器'
                    : `${canonicalSkillName(skill, rs) === skill ? '' : `规范名：${canonicalSkillName(skill, rs)} · `}点击检定`
                }
                className="group flex items-center justify-between rounded-md border border-ink-700 bg-ink-850 px-2.5 py-1.5 text-left transition hover:border-gold-600/50 hover:bg-ink-800 disabled:opacity-40"
              >
                <span className="min-w-0">
                  <span className="block truncate text-[12px] text-mist-300 group-hover:text-mist-100">
                    {skill}
                  </span>
                  {weaponMissing && (
                    <span className="block text-[9px] text-blood-300/80">无可用武器</span>
                  )}
                  {untrainedSkill && (
                    <span className="block text-[9px] text-mist-500/70">未受训</span>
                  )}
                </span>
                <span className="shrink-0 text-[12px] tabular-nums text-gold-500/80">
                  {rs.mainDice === '1d100'
                    ? `${value}%`
                    : `${value >= 0 ? '+' : ''}${value}`}
                </span>
              </button>
            );
          })}
        </div>

        {/*
         * 角色卡上没列的技能也能用——按规则包的基础值掷。
         * 没这个区，玩家会以为"我没这个技能就不能做这件事"，
         * 而 GM 又可能直接要求一次"游泳检定"（基础值 20%），两边对不上。
         */}
        <button
          onClick={() => setShowAllSkills((v) => !v)}
          className="mt-2 text-[11px] text-gold-500/80 transition hover:text-gold-400"
        >
          {showAllSkills ? '收起全部技能' : `全部技能（含基础值 ${restSkills.length} 项）`}
        </button>
        {showAllSkills && (
          <div className="mt-2 grid grid-cols-2 gap-1.5">
            {restSkills.map((s) => (
              <button
                key={s.name}
                disabled={streaming}
                onClick={() => onRequestCheck(s.name)}
                title={s.desc}
                className="group flex items-center justify-between rounded-md border border-dashed border-ink-700 px-2.5 py-1.5 text-left transition hover:border-gold-600/40 disabled:opacity-40"
              >
                <span className="truncate text-[12px] text-mist-400 group-hover:text-mist-200">
                  {s.name}
                </span>
                <span className="shrink-0 text-[12px] tabular-nums text-mist-500">
                  {rs.mainDice === '1d100' ? `${s.base}%` : `+${s.base}`}
                </span>
              </button>
            ))}
          </div>
        )}

        <p className="mt-2 text-[10px] leading-relaxed text-mist-500/70">
          {rs.beginnerGuide || '点击技能即可检定，并可指定对象。'}
          未受训的技能按规则包的基础值掷，只是成功率低。
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
          onAttack={(skill) => onRequestCheck(skill)}
          onUse={(it) => {
            /*
             * 消耗品：**本地先扣 1**（引擎权威），再把"使用意图"发给守密人演出效果。
             * 只发意图不扣数量，就是玩家报的"东西永远用不完"；只扣数量不告诉守密人，
             * 就是"我用了绷带但它没反应"。两件事都要做。
             */
            if (it.kind === 'consumable') {
              useStore
                .getState()
                .applyModelDeltas([
                  { target: 'inventory', op: 'dec', value: it.name, amount: 1 },
                ] as never);
            }
            onUseItem?.(`（使用：${it.name}）`);
          }}
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
