import { useEffect, useMemo, useRef, useState } from 'react';
import { capSkillsToBudget } from '../core/skills.js';
import { useStore, deriveAddress, addressOf, defaultCharacteristics, characteristicBudget, skillBudget, BUILTIN_MODULES, starterCharacterOf, starterSkillsFor, type CharacterProfile, type Companion, type ModuleItem, type ModuleMonster, type ModuleNpc, type WorldbookEntry } from './store';
import { getRuleset } from '../core/rulesets/index.js';
import type { Ruleset } from '../core/rulesets/types.js';
import { getGenre, listGenres, type Genre } from '../core/genres.js';
import { stripModuleWorldbook } from '../core/worldbook.js';
import { normalizeDeadlineIn, normalizeStartClock } from '../core/clock.js';
import { ImageField } from './ImageField';
import {
  characterSystemPrompt,
  companionSystemPrompt,
  importSystemPrompt,
  moduleSystemPrompt,
  packSystemPrompt,
  presetSystemPrompt,
  worldbookSystemPrompt,
  characterImagePrompt,
  generateJson,
  moduleUserPrompt,
  itemTableSystemPrompt,
  monsterSystemPrompt,
  SCALE_LABEL,
  type ModuleScale,
} from '../orchestrator/generate.js';
import { ModelError } from '../providers/model.js';
import { extractCharacterCard } from './charCard.js';
import {
  carryPreview,
  defaultWorldName,
  findWorld,
  listWorlds,
  runLabel,
} from '../core/campaign.js';
import { archiveBlurb, listArchive, matchesRuleset } from './archive.js';

/** 当前题材（内置或自建） */
function useGenre(): { genre: Genre; all: Genre[] } {
  const genreId = useStore((s) => s.genreId);
  const customGenres = useStore((s) => s.customGenres);
  return { genre: getGenre(genreId, customGenres), all: listGenres(customGenres) };
}

const inputCls =
  'w-full rounded-lg border border-ink-600 bg-ink-950 px-3 py-2 text-[13px] text-mist-100 outline-none transition focus:border-gold-600/60';

/**
 * 放在 flex 行里、要占满剩余宽度的输入框。
 *
 * 注意：不能复用 inputCls —— 它带 w-full，而 Tailwind 生成的 CSS 里 w-full 排在
 * w-20 / w-16 之后，会在同一个元素上覆盖掉定宽；再叠加 shrink-0，定宽那个元素反而
 * 会霸占整行、把旁边的输入框挤成一条缝（技能名就是这么被挤没的）。
 */
const inputFlex =
  'min-w-0 flex-1 rounded-lg border border-ink-600 bg-ink-950 px-3 py-2 text-[13px] text-mist-100 outline-none transition focus:border-gold-600/60';
/** 定宽小数值输入框（技能值、队友 HP 等） */
const inputNum =
  'w-[72px] shrink-0 rounded-lg border border-ink-600 bg-ink-950 px-2 py-2 text-center text-[13px] text-mist-100 outline-none transition focus:border-gold-600/60';

const smallBtn =
  'shrink-0 rounded-lg border border-ink-600 bg-ink-850 px-3 py-1.5 text-[12px] text-mist-300 transition hover:border-gold-600/50 hover:text-mist-100 disabled:opacity-40';

const uid = () => Math.random().toString(36).slice(2, 10);

/**
 * 技能编辑行。
 *
 * 技能名用本地草稿，**失焦 / 回车才提交改名** —— 否则每敲一个字都会重建对象、
 * 触发列表重排和输入框失焦，看起来就像"整排技能被重掷了"。
 */
function SkillRow({
  name,
  value,
  onRename,
  onValue,
  onRemove,
}: {
  name: string;
  value: number;
  onRename: (from: string, to: string) => void;
  onValue: (name: string, value: number) => void;
  onRemove: (name: string) => void;
}) {
  const [draft, setDraft] = useState(name);
  useEffect(() => setDraft(name), [name]);

  const commit = () => {
    const t = draft.trim();
    if (!t) {
      setDraft(name); // 名字不能为空，还原
      return;
    }
    if (t !== name) onRename(name, t);
  };

  return (
    <div className="flex items-center gap-2">
      <input
        className={inputFlex}
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
        }}
      />
      <input
        className={inputNum}
        type="number"
        min={0}
        max={99}
        value={Number.isFinite(value) ? value : 0}
        onChange={(e) =>
          onValue(name, e.target.value === '' ? 0 : Number(e.target.value))
        }
      />
      <button
        onClick={() => onRemove(name)}
        className="shrink-0 rounded-md border border-ink-600 px-2 py-2 text-[11px] text-mist-500 transition hover:border-blood-400/60 hover:text-blood-400"
      >
        删
      </button>
    </div>
  );
}

function SkillPicker({
  catalog,
  existing,
  onAdd,
}: {
  catalog: { name: string; base: number }[];
  existing: string[];
  onAdd: (name: string, base: number) => void;
}) {
  const [q, setQ] = useState('');
  const list = q.trim() ? catalog.filter((c) => c.name.includes(q.trim())) : catalog;
  return (
    <div className="rounded-lg border border-ink-700 bg-ink-850/60 p-2.5">
      <input
        className={inputCls}
        value={q}
        onChange={(e) => setQ(e.target.value)}
        placeholder="搜索技能名，如：侦查、聆听、说服"
      />
      <div className="mt-2 grid max-h-52 grid-cols-2 gap-1.5 overflow-y-auto pr-0.5">
        {list.map((c) => {
          const has = existing.includes(c.name);
          return (
            <button
              key={c.name}
              disabled={has}
              onClick={() => onAdd(c.name, c.base)}
              className={`flex items-center justify-between gap-2 rounded-md border px-2 py-1.5 text-left text-[12px] transition ${
                has
                  ? 'border-ink-700 text-mist-500'
                  : 'border-ink-600 text-mist-300 hover:border-gold-600/50 hover:text-mist-100'
              }`}
            >
              <span className="truncate">{c.name}</span>
              <span className="shrink-0 tabular-nums text-[11px] text-gold-500">
                {has ? '已选' : `${c.base}%`}
              </span>
            </button>
          );
        })}
        {list.length === 0 && (
          <p className="col-span-2 py-2 text-center text-[11px] text-mist-500">
            没有匹配的技能
          </p>
        )}
      </div>
      <p className="mt-2 text-[10px] leading-relaxed text-mist-500">
        右侧百分比是规则书里的<b>基础值</b>（没专门练过时也有的成功率）。选中即按基础值加入，再往上加点。
      </p>
    </div>
  );
}

/** 派生数值预览：属性一变，血/蓝/理智/伤害加成自动跟着算 */
function DerivedPreview({
  characteristics,
  rs,
}: {
  characteristics: Record<string, number>;
  rs: Ruleset;
}) {
  const vitals = rs.deriveVitals(characteristics);
  const extras = rs.deriveExtras?.(characteristics) ?? {};
  const vitalLabel: Record<string, string> = {};
  for (const v of rs.vitalDefs) vitalLabel[v.key] = v.label;
  return (
    <div className="mt-2 rounded-lg border border-ink-700 bg-ink-850/60 px-2.5 py-2">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <span className="text-[10px] text-mist-500">派生：</span>
        {Object.entries(vitals).map(([k, v]) => (
          <span key={k} className="text-[11px] text-mist-300">
            {vitalLabel[k] ?? k.toUpperCase()} <b className="text-mist-100">{v}</b>
          </span>
        ))}
        {Object.entries(extras).map(([k, v]) => (
          <span key={k} className="text-[11px] text-mist-300">
            {k} <b className="text-mist-100">{v}</b>
          </span>
        ))}
      </div>
      <p className="mt-1 text-[10px] leading-relaxed text-mist-500">
        生命值＝(体质＋体型)/10，魔法值＝意志/5，理智起始＝意志。开团时会按这些自动填满状态。
      </p>
    </div>
  );
}

/** 技能点预算条：实时显示已用/剩余，超了标红 */
function BudgetBar({
  character,
  rulesetId,
}: {
  character: CharacterProfile;
  rulesetId: string;
}) {
  const { total, spent, remaining } = skillBudget(character, rulesetId);
  const over = remaining < 0;
  return (
    <div className="mb-2 rounded-md border border-ink-700 bg-ink-850/60 px-2.5 py-1.5">
      <div className="flex items-baseline justify-between">
        <span className="text-[10px] text-mist-500">
          技能点（教育×4 + 智力×2）＝ {total}
        </span>
        <span className={`text-[11px] tabular-nums ${over ? 'text-blood-400' : 'text-mist-300'}`}>
          已用 {spent} / 剩余 <b className={over ? 'text-blood-400' : 'text-gold-400'}>{remaining}</b>
        </span>
      </div>
      <div className="mt-1 h-1 overflow-hidden rounded-full bg-ink-700">
        <div
          className={`h-full rounded-full ${over ? 'bg-blood-400' : 'bg-gold-500/80'}`}
          style={{ width: `${Math.max(0, Math.min(100, (spent / total) * 100))}%` }}
        />
      </div>
      <p className="mt-1 text-[10px] leading-relaxed text-mist-500">
        技能点＝技能值减掉基础值后的投入。剩余不够时，加点会自动封顶。
      </p>
    </div>
  );
}

/**
 * 生成类请求的**兜底超时**（H24）。
 *
 * ⚠️ 别定短了：第 9 轮实测长篇模组生成要 **220 秒**，第 12 轮那次更是 200 秒没回。
 * 定 2 分钟会把正常的慢请求误杀 —— 所以这里给 5 分钟当**兜底**，
 * 真正给玩家出口的是旁边那个「取消」按钮（随时可点）。
 */
const GEN_TIMEOUT_MS = 5 * 60 * 1000;

/**
 * 给**不在 `AiGenBox` 里**的那些生成点（一键生成两张表、整理成模组卡）用的超时兜底。
 * 用完必须调 `done()`，否则定时器会漏在那儿。
 */
function genTimeout() {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), GEN_TIMEOUT_MS);
  return { signal: ctl.signal, done: () => clearTimeout(timer) };
}

/*
 * `H23`（协28 §F① 第 19 条 · 协29 补裁）：生成**可以分几通**，界面得跟着说。
 *
 * 两通（模组骨架 → 世界书 + 队友）原来只报最后一次结果，而且是在第一通结束时就报
 * —— 主人看到「已生成，记得检查并微调」，接着发现世界书是空的、同行者没生成。
 * 所以这里给调用方两个口子：
 *   - `onStage(msg)`：**进行中的改口**（"模组已好，正在生成世界书与队友…"）；
 *   - **返回值**：这一趟的收尾话术（不返回就用默认那句"已生成，记得检查并微调"）——
 *     第二通失败时调用方就能说"模组已好，但世界书/队友没生成上"，而不是假装全成了。
 */
/**
 * `H23`：模组包**第二通没成**时的说法。
 *
 * 单独抽出来（而不是内联在 JSX 里）是为了让"**不许说全好了**"这条能被断言 ——
 * 原来是空 catch，界面上照样写「已生成，记得检查并微调」，
 * 主人看到的就是"已生成 + 世界书空的 + 同行者没有"。
 */
export function modulePackPartialNote(detail?: string): string {
  return detail
    ? `模组已好，但世界书 / 队友没生成上（${detail}）。可以再点一次生成，或手填。`
    : '模组已好，但世界书 / 队友这一次没生成上（模型没给出可用的结果）。可以再点一次生成，或手填。';
}

/** `H23`：第二通被**停下**（超时 / 玩家点停止）时的说法 —— 与"失败"分开说，免得像坏了 */
export function modulePackStoppedNote(): string {
  return '模组已好。世界书 / 队友那一步停下了（你点了停止，或等太久）—— 可以再点一次生成，或手填。';
}

function AiGenBox({
  label,
  placeholder,
  onGenerate,
}: {
  label: string;
  placeholder: string;
  onGenerate: (
    desc: string,
    signal?: AbortSignal,
    onStage?: (msg: string) => void
  ) => Promise<string | void>;
}) {
  const [open, setOpen] = useState(false);
  const [desc, setDesc] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [ok, setOk] = useState('');
  /** `H23`：多通生成时"现在进行到哪一步"（一句话，随第一通结束改口） */
  const [stage, setStage] = useState('');
  /** 正在跑的那一通（给「取消」按钮用） */
  const ctlRef = useRef<AbortController | null>(null);

  const run = async () => {
    const ctl = new AbortController();
    ctlRef.current = ctl;
    const timer = setTimeout(() => ctl.abort(), GEN_TIMEOUT_MS);
    setBusy(true);
    setErr('');
    setOk('');
    setStage('');
    try {
      // `H23`：收尾话术由调用方决定（多通生成时它才知道"到哪一步算成了"）
      const doneMsg = await onGenerate(desc.trim(), ctl.signal, setStage);
      setOk(doneMsg && doneMsg.trim() ? doneMsg.trim() : '已生成，记得检查并微调');
      setDesc('');
    } catch (e) {
      if (ctl.signal.aborted) {
        // 超时或玩家点了取消 —— 都要说清楚"不是坏了，是可以再试"
        setErr('生成时间太长，已经停下了（内容没丢）。可以换个说法重试，或等网络好一点再来。');
      } else {
        setErr(e instanceof ModelError ? e.message : `生成失败：${(e as Error).message}`);
      }
    } finally {
      clearTimeout(timer);
      ctlRef.current = null;
      setStage('');
      setBusy(false);
    }
  };

  return (
    <div className="rounded-lg border border-ink-700 bg-ink-850/60 p-3">
      <button
        onClick={() => setOpen((v) => !v)}
        className="text-[12px] text-gold-400 transition hover:text-gold-500"
      >
        {open ? '收起' : `AI 生成${label}`}
      </button>
      {open && (
        <div className="mt-2.5 space-y-2">
          <textarea
            value={desc}
            onChange={(e) => setDesc(e.target.value)}
            rows={2}
            placeholder={placeholder}
            className={`${inputCls} resize-none`}
          />
          <div className="flex items-center gap-2">
            <button onClick={run} disabled={busy} className={smallBtn}>
              {busy ? '生成中…' : '开始生成'}
            </button>
            {/*
             * H24：**生成时给一个出口**。
             *
             * 以前只能干等（第 12 轮实测卡了 200 秒）或刷新脱身 ——
             * 而刷新会把这一页填好的东西一起丢掉。现在随时能停，且**内容不丢**。
             */}
            {busy && (
              <button
                onClick={() => ctlRef.current?.abort()}
                className="shrink-0 rounded-md border border-ink-600 px-2.5 py-1 text-[11px] text-mist-400 transition hover:border-blood-400/60 hover:text-blood-400"
              >
                停止
              </button>
            )}
            {err && <span className="text-[11px] text-blood-400">{err}</span>}
            {ok && <span className="text-[11px] text-moss-400">{ok}</span>}
          </div>
          {/* `H23`：多通生成时把"现在到哪一步"写出来，别让玩家以为已经全好了 */}
          {stage && <p className="text-[11px] text-gold-400">{stage}</p>}
          <p className="text-[10px] leading-relaxed text-mist-500">
            留空则完全由模型自由发挥。生成结果会直接覆盖当前字段。
          </p>
        </div>
      )}
    </div>
  );
}

function CharacterTab() {
  const character = useStore((s) => s.character);
  const setCharacter = useStore((s) => s.setCharacter);
  const config = useStore((s) => s.config);
  const gameModule = useStore((s) => s.module);
  const rulesetId = useStore((s) => s.rulesetId);
  const rs = getRuleset(rulesetId);
  const { genre } = useGenre();
  const starter = starterCharacterOf(genre.id);
  // 属性点预算（COC 八项共 460）：规则包没给总额就是 null，界面不显示
  const budget = useMemo(
    () => characteristicBudget(rulesetId, character.characteristics),
    [rulesetId, character.characteristics]
  );
  const [showPicker, setShowPicker] = useState(false);
  const [growth, setGrowth] = useState(false);
  const [importMsg, setImportMsg] = useState('');

  /** 从标准技能表加入：按规则书基础值起步 */
  const addFromCatalog = (name: string, base: number) => {
    if (character.skills[name] !== undefined) return;
    setCharacter({ skills: { ...character.skills, [name]: base } });
  };

  /** 改名：保持原有顺序，不把技能挪到末尾 */
  const renameSkill = (from: string, to: string) => {
    const next: Record<string, number> = {};
    for (const [k, v] of Object.entries(character.skills)) {
      next[k === from ? to : k] = v;
    }
    setCharacter({ skills: next });
  };

  /** 改数值：原地更新，绝不动顺序；受技能点预算约束（超了不能加；幕间成长模式下放宽） */
  const setSkillValue = (k: string, v: number) => {
    const next = { ...character.skills, [k]: v };
    if (!growth) {
      const base = rs.skillCatalog.find((s) => s.name === k)?.base ?? 0;
      const oldSpent = Math.max(0, (character.skills[k] ?? 0) - base);
      const newSpent = Math.max(0, v - base);
      const { remaining } = skillBudget(character, rulesetId);
      // 加点超出剩余预算 → 拦住，只加到预算允许的上限
      if (newSpent > oldSpent && newSpent - oldSpent > remaining) {
        next[k] = base + oldSpent + remaining;
      }
    }
    setCharacter({ skills: next });
  };

  const removeSkill = (k: string) => {
    const next: Record<string, number> = {};
    for (const [key, v] of Object.entries(character.skills)) {
      if (key !== k) next[key] = v;
    }
    setCharacter({ skills: next });
  };

  const addSkill = () => {
    setCharacter({
      skills: {
        ...character.skills,
        [`新技能${Object.keys(character.skills).length + 1}`]: 50,
      },
    });
  };

  /** 导入酒馆角色卡（PNG 里嵌的 V2/V3 JSON）：只取叙事层，数值层按当前规则重建 */
  const importCharCard = (file: File) => {
    const reader = new FileReader();
    reader.onload = () => {
      const card = extractCharacterCard(reader.result as ArrayBuffer);
      if (!card) {
        setImportMsg('这不是酒馆角色卡 PNG，或卡里没有数据');
        return;
      }
      setCharacter({
        name: card.name,
        gender: card.gender,
        description: card.description,
        personality: card.personality,
        mes_example: card.mes_example,
        // 数值层按当前规则包重建，别沿用卡里的（酒馆卡没有 COC/DnD 数值）
        characteristics: defaultCharacteristics(rulesetId),
        skills: {},
      });
      setImportMsg(`已导入「${card.name}」的设定（数值请按当前规则手动补）`);
    };
    reader.readAsArrayBuffer(file);
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-1.5">
        <span className="text-[11px] text-mist-400">角色卡：</span>
        <label className="cursor-pointer rounded-md border border-ink-600 px-2.5 py-1 text-[11px] text-mist-300 transition hover:border-gold-600/50 hover:text-mist-100">
          导入酒馆卡（PNG）
          <input
            type="file"
            accept="image/png"
            className="hidden"
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) importCharCard(f);
              e.target.value = '';
            }}
          />
        </label>
        {starter && (
          <button
            onClick={() => {
              setCharacter({
                ...starter,
                address: undefined,
                // 数值层按当前规则包重建，别沿用别的规则的数字
                characteristics: defaultCharacteristics(rulesetId),
                /*
                 * 技能跟着**人设**走，不跟着规则包走。
                 *
                 * 原来这里取 `rs.starterSkills`（规则包通用 8 项），
                 * 于是"流浪剑客"的技能表里是侦查 / 图书馆使用 —— 人设直接塌掉
                 * （用户 2026-09-17 报「属性技能与人设不匹配」）。
                 * `starterSkillsFor` 会把题材配方适配到当前规则包的词汇表上，
                 * 名不合法就退回通用项（见函数头注释）。
                 */
                skills: starterSkillsFor(genre.id, rulesetId),
                /*
                 * 随身物品**保留示例角色自带的**。
                 * 早期这里显式清成空数组，于是"套用示例角色"之后背包永远是空的——
                 * 人设写着私家侦探、手里没有相机也没有枪（协作方 B）。
                 */
                items: starter.items ?? character.items ?? [],
                itemDetails: starter.itemDetails ?? character.itemDetails,
              });
            }}
            className="rounded-md border border-ink-600 px-2.5 py-1 text-[11px] text-mist-300 transition hover:border-gold-600/50 hover:text-mist-100"
            title={`套用一份现成的「${genre.name}」角色，省得想人设`}
          >
            套用示例角色
          </button>
        )}
        <span className="text-[10px] text-mist-500">
          酒馆卡只取设定，数值按当前规则重建
        </span>
      </div>
      {importMsg && (
        <p className="rounded-md border border-moss-400/40 bg-moss-400/10 px-2.5 py-1.5 text-[11px] text-moss-400">
          {importMsg}
        </p>
      )}

      <div className="grid grid-cols-3 gap-2">
        <label className="col-span-2">
          <span className="mb-1 block text-[11px] text-mist-400">姓名</span>
          <input
            className={inputCls}
            value={character.name}
            onChange={(e) => setCharacter({ name: e.target.value })}
          />
        </label>
        <label className="col-span-1">
          <span className="mb-1 block text-[11px] text-mist-400">性别</span>
          <select
            className={inputCls}
            value={character.gender ?? ''}
            onChange={(e) => setCharacter({ gender: e.target.value })}
          >
            <option value="">未设置</option>
            <option value="男">男</option>
            <option value="女">女</option>
            <option value="其他">其他</option>
          </select>
        </label>
      </div>

      <label className="block">
        <span className="mb-1 block text-[11px] text-mist-400">
          称呼 <span className="text-mist-500">（NPC 怎么叫你，留空按姓名+性别推导）</span>
        </span>
        <input
          className={inputCls}
          value={character.address ?? ''}
          onChange={(e) => setCharacter({ address: e.target.value })}
          placeholder={deriveAddress(character.name, character.gender) || '霍尔特先生'}
        />
      </label>

      <label className="block">
        <span className="mb-1 block text-[11px] text-mist-400">
          描述 <span className="text-mist-500">（外貌、年龄、职业、来历）</span>
        </span>
        <textarea
          className={`${inputCls} resize-none`}
          rows={3}
          value={character.description}
          onChange={(e) => setCharacter({ description: e.target.value })}
        />
      </label>

      <label className="block">
        <span className="mb-1 block text-[11px] text-mist-400">
          外貌 <span className="text-mist-500">（只写长相，角色立绘按这句画；改完要重新生成才生效）</span>
        </span>
        <textarea
          className={`${inputCls} resize-none`}
          rows={2}
          value={character.appearance ?? ''}
          onChange={(e) => setCharacter({ appearance: e.target.value })}
          placeholder="例如：齐肩的黑发，左眉一道浅疤，常年穿一件洗得发白的风衣"
        />
      </label>

              <ImageField
                label="角色立绘"
                prompt={characterImagePrompt(character, genre)}
                value={character.portrait}
                job={{ kind: 'portrait', target: 'character' }}
                onClear={() => setCharacter({ portrait: '' })}
              />

      <label className="block">
        <span className="mb-1 block text-[11px] text-mist-400">
          性格 <span className="text-mist-500">（说话方式、弱点、在意什么）</span>
        </span>
        <textarea
          className={`${inputCls} resize-none`}
          rows={3}
          value={character.personality}
          onChange={(e) => setCharacter({ personality: e.target.value })}
        />
      </label>

      <label className="block">
        <span className="mb-1 block text-[11px] text-mist-400">
          对话示例 <span className="text-mist-500">（可选，给 GM 参考你说话的风格）</span>
        </span>
        <textarea
          className={`${inputCls} resize-none`}
          rows={2}
          value={character.mes_example}
          onChange={(e) => setCharacter({ mes_example: e.target.value })}
          placeholder="例如：你{{char}}？我从不说废话。"
        />
      </label>

      <div>
        <div className="mb-1.5 flex items-center justify-between gap-2">
          <span className="text-[11px] text-mist-400">
            属性 <span className="text-mist-500">（由规则包「{rs.name}」定义）</span>
          </span>
          <div className="flex shrink-0 items-center gap-3">
            {/*
              点预算：规则包给了才显示（COC＝八项共 460）。
              用户 2026-09-17 报「属性上限/总额设定」—— 原来一排数字没有任何总额概念，
              玩家把每项都拉到 90 也不知道自己超了规则。
            */}
            {budget.total !== null && (
              <span
                className={`text-[11px] ${
                  (budget.remaining ?? 0) < 0 ? 'text-ember-400' : 'text-mist-500'
                }`}
                title={`规则包「${rs.name}」的属性总额是 ${budget.total} 点`}
              >
                总计 <b className="text-mist-200">{budget.spent}</b>
                <span className="text-mist-500"> / {budget.total}</span>
                {(budget.remaining ?? 0) < 0 && (
                  <span className="ml-1">超 {Math.abs(budget.remaining!)}</span>
                )}
              </span>
            )}
            {(budget.total === null || budget.spent !== budget.total) && (
              <button
                onClick={() => setCharacter({ characteristics: defaultCharacteristics(rulesetId) })}
                className="text-[11px] text-gold-400 hover:text-gold-500"
              >
                重置
              </button>
            )}
          </div>
        </div>
        <div className="grid grid-cols-4 gap-2">
          {rs.characteristicDefs.map((d) => {
            const v = character.characteristics[d.key] ?? d.default;
            return (
              <label key={d.key} className="block">
                <span className="mb-0.5 block text-[10px] text-mist-500">
                  {d.label} <span className="font-mono">{d.key.toUpperCase()}</span>
                </span>
                <input
                  className={`${inputCls} text-center`}
                  type="number"
                  min={d.min}
                  max={d.max}
                  step={1}
                  value={v}
                  onChange={(e) =>
                    setCharacter({
                      characteristics: {
                        ...character.characteristics,
                        // 清空时回落到默认值；store 里还会再按 min/max 夹一次
                        [d.key]: e.target.value === '' ? d.default : Number(e.target.value),
                      },
                    })
                  }
                  title={`范围 ${d.min}–${d.max}${
                    budget.total !== null ? `，八项总计 ${budget.total}` : ''
                  }`}
                />
              </label>
            );
          })}
        </div>
        {/* 派生数值：属性一变，血/蓝/理智/伤害加成自动跟着算 */}
        <DerivedPreview characteristics={character.characteristics} rs={rs} />
      </div>

      <div>
        <div className="mb-1.5 flex items-center justify-between gap-2">
          <span className="text-[11px] text-mist-400">
            技能 <span className="text-mist-500">（数值＝成功率，越高越好）</span>
          </span>
          <div className="flex shrink-0 gap-3">
            <button
              onClick={() => setShowPicker((v) => !v)}
              className="text-[11px] text-gold-400 hover:text-gold-500"
            >
              {showPicker ? '收起技能表' : '从技能表选择'}
            </button>
            <button onClick={addSkill} className="text-[11px] text-mist-400 hover:text-mist-200">
              自定义
            </button>
            <button
              onClick={() => setGrowth((v) => !v)}
              title="幕间成长：一章结束后可用，暂时解除技能点上限"
              className={`text-[11px] transition ${
                growth ? 'text-moss-400' : 'text-mist-400 hover:text-mist-200'
              }`}
            >
              {growth ? '幕间成长 ✓' : '幕间成长'}
            </button>
          </div>
        </div>

        {showPicker && (
          <div className="mb-2">
            <SkillPicker
              catalog={rs.skillCatalog}
              existing={Object.keys(character.skills)}
              onAdd={addFromCatalog}
            />
          </div>
        )}

        {rulesetId === 'coc7' && <BudgetBar character={character} rulesetId={rulesetId} />}

        <div className="space-y-1.5">
          {Object.entries(character.skills).map(([k, v]) => (
            <SkillRow
              key={k}
              name={k}
              value={v}
              onRename={renameSkill}
              onValue={setSkillValue}
              onRemove={removeSkill}
            />
          ))}
        </div>
      </div>

      <label className="block">
        <span className="mb-1 block text-[11px] text-mist-400">
          随身物品 <span className="text-mist-500">（每行一件，开团时会放进背包）</span>
        </span>
        <textarea
          className={`${inputCls} resize-none`}
          rows={3}
          value={(character.items ?? []).join('\n')}
          onChange={(e) =>
            setCharacter({
              items: e.target.value.split('\n').map((s) => s.trim()).filter(Boolean),
            })
          }
          placeholder={'笔记本\n.38 左轮手枪\n禄来福来双反相机'}
        />
      </label>

      <AiGenBox
        label="角色"
        placeholder="例如：一个因伤退役的战地记者，左腿有旧伤，对无法解释的事有偏执的兴趣"
        onGenerate={async (desc, signal) => {
          const data = await generateJson<{
            name?: string;
            gender?: string;
            description?: string;
            /** 外貌锚点：AI 生成时一并产出，画这张卡的立绘就看这一句 */
            appearance?: string;
            personality?: string;
            scenario?: string;
            characteristics?: Record<string, number>;
            skills?: Record<string, number>;
            items?: (
              | string
              | { name?: string; desc?: string; kind?: string; damage?: string; skill?: string }
            )[];
          }>(
            // 把当前模组一起喂进去：题材决定"世界长什么样"，模组决定"这张卡要在什么处境里活下去"
            characterSystemPrompt(genre, rs, {
              title: gameModule.title,
              premise: gameModule.premise,
            }),
            desc ||
              `请自由创作一名贴合「${genre.name}」题材的角色。` +
                (gameModule.title
                  ? `\n\n【必须契合当前模组】模组《${gameModule.title}》的前言如下：\n${
                      gameModule.premise
                    }\n\n要求：**如果前言里已经交代了玩家是谁、如何被卷入，角色的身份与来历必须与之一致，不得另起设定**；随身物品与技能也要贴合这个模组可能遇到的场景。`
                  : ''),
            {
              ...config,
              maxTokens: 2048,
            },
            signal
          );
          if (!data) throw new Error('模型没有返回合法 JSON，请重试或换个描述');
          /*
           * 物品：兼容"字符串数组"（旧格式 / 模型偷懒）与"对象数组"（带简介与武器属性）。
           *
           * 以前 `itemDetails` 只在**对象数组**那一条路上生成，模型一旦偷懒只给名字，
           * 详情就是空的，于是走 `?? character.itemDetails` **把上一张角色卡的物品说明原样接过来** ——
           * 名字是新的、说明是旧的，玩家看到的就是"一件只有名字的东西"
           * （主人 2026-09-20 报的"生成角色卡后物品没有描述"）。
           *
           * 现在：字符串也建一条详情（名字有、说明可能没有），
           * 并且**两条路都不再回退到旧卡** —— 缺说明是这一轮没生成好，串味才是真错。
           */
          const rawItems = data.items ?? [];
          const itemDetails = rawItems
            .map((it) =>
              typeof it === 'string'
                ? { name: it.trim(), desc: undefined, kind: undefined, damage: undefined, skill: undefined }
                : {
                    name: (it?.name ?? '').trim(),
                    desc: it?.desc?.trim(),
                    kind: it?.kind?.trim(),
                    damage: it?.damage?.trim(),
                    skill: it?.skill?.trim(),
                  }
            )
            .filter((d) => d.name);
          const items = itemDetails.map((d) => d.name);
          setCharacter({
            name: data.name ?? character.name,
            gender: data.gender ?? character.gender,
            // 清掉旧的称呼，让它按新姓名/性别重新推导
            address: undefined,
            /*
             * 外貌随这一轮的卡走，**不串上一张卡**（与上面 itemDetails 同一条口径）：
             * 模型没给出外貌＝这一轮没生成好，立绘届时退回 description；
             * 沿用旧卡的外貌会让"换了个角色、脸还是上一张卡"这种错更难发现。
             */
            appearance: data.appearance?.trim() || undefined,
            description: data.description ?? character.description,
            personality: data.personality ?? character.personality,
            scenario: data.scenario ?? character.scenario,
            characteristics: {
              ...character.characteristics,
              ...(data.characteristics ?? {}),
            },
            /*
             * 🔴 `G10`+`G22`（协30 §2.5）：**落盘前按预算封顶**。
             *
             * 提示词里那条"用尽但绝不超支"只是软约束 —— 真机生成出来的是
             * 「已用 333 / 剩余 −23」（预算 310）。手工加点走 `setSkillValue` 的
             * `skillBudget` 封顶，AI 这条路以前没有，所以这里补上：
             * **写了约束 ≠ 引擎在执行**（与 `P2-10` / `G1` 同一类坑）。
             * 属性要在同一批里一起算（预算＝教育×4＋智力×2，生成的属性会改它）。
             */
            skills: data.skills
              ? capSkillsToBudget(
                  data.skills,
                  { ...character.characteristics, ...(data.characteristics ?? {}) },
                  rulesetId
                )
              : character.skills,
            // 两张表都只认这一轮生成的（名字与详情一一对应，不会串到上一张卡）
            items,
            itemDetails,
          });
        }}
      />
    </div>
  );
}

function CompanionsTab() {
  const companions = useStore((s) => s.gameState.companions);
  const upsert = useStore((s) => s.upsertCompanion);
  const remove = useStore((s) => s.removeCompanion);
  const config = useStore((s) => s.config);
  const candidates = useStore((s) => s.companionCandidates);
  const recruit = useStore((s) => s.recruitCompanion);
  const dismiss = useStore((s) => s.dismissCompanionCandidate);
  const rulesetId = useStore((s) => s.rulesetId);
  const { genre } = useGenre();
  const [editing, setEditing] = useState<string | null>(null);

  const patch = (c: Companion, p: Partial<Companion>) => upsert({ ...c, ...p });

  return (
    <div className="space-y-3">
      {candidates.length > 0 && (
        <div className="rounded-lg border border-gold-600/40 bg-gold-500/5 p-3">
          <div className="mb-2 flex items-center justify-between gap-2">
            <span className="text-[12px] text-gold-400">按模组推荐的队友候选</span>
            <span className="text-[10px] text-mist-500">挑谁入队，其余忽略</span>
          </div>
          <div className="space-y-2">
            {candidates.map((c) => (
              <div key={c.id} className="rounded-md border border-ink-700 bg-ink-850 p-2.5">
                <div className="flex items-center justify-between gap-2">
                  <div className="min-w-0">
                    <span className="block truncate text-[13px] text-mist-100">
                      {c.name}
                      {c.met ? (
                        <span className="ml-1.5 rounded bg-moss-400/15 px-1 text-[9px] text-moss-400">
                          已登场
                        </span>
                      ) : (
                        <span className="ml-1.5 rounded bg-ink-700 px-1 text-[9px] text-mist-500">
                          尚未登场
                        </span>
                      )}
                    </span>
                    <span className="block truncate text-[11px] text-mist-500">{c.role}</span>
                  </div>
                  <div className="flex shrink-0 gap-1.5">
                    <button
                      onClick={() => recruit(c.id)}
                      disabled={c.met === false}
                      title={c.met === false ? '在剧情里遇到 TA 之后才能入队' : '拉进队伍'}
                      className={`${smallBtn} ${c.met === false ? 'cursor-not-allowed opacity-40' : ''}`}
                    >
                      入队
                    </button>
                    <button
                      onClick={() => dismiss(c.id)}
                      className="rounded-lg border border-ink-600 bg-ink-850 px-3 py-1.5 text-[12px] text-mist-500 transition hover:text-mist-200"
                    >
                      忽略
                    </button>
                  </div>
                </div>
                {c.personality && (
                  <p className="mt-1.5 text-[11px] leading-relaxed text-mist-400">
                    {c.personality}
                  </p>
                )}
                {c.bond && (
                  <p className="mt-1 text-[11px] text-mist-500">与你的关系：{c.bond}</p>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {companions.map((c) => (
        <div key={c.id} className="rounded-lg border border-ink-700 bg-ink-850 p-3">
          <div className="flex items-center justify-between gap-2">
            <button
              onClick={() => setEditing(editing === c.id ? null : c.id)}
              className="min-w-0 flex-1 text-left"
            >
              <span className="block truncate text-[13px] text-mist-100">{c.name}</span>
              <span className="block text-[11px] text-mist-500">
                {c.role} ·{' '}
                {c.initiative === 'reactive'
                  ? '被动'
                  : c.initiative === 'balanced'
                    ? '均衡'
                    : '主动'}
                {!c.alive && ' · 已死亡'}
              </span>
            </button>
            <div className="flex shrink-0 gap-1">
              <button
                onClick={() => patch(c, { alive: !c.alive })}
                className="rounded-md border border-ink-600 px-2 py-1 text-[11px] text-mist-400 hover:text-mist-100"
              >
                {c.alive ? '标记死亡' : '复活'}
              </button>
              <button
                onClick={() => remove(c.id)}
                className="rounded-md border border-ink-600 px-2 py-1 text-[11px] text-mist-500 transition hover:border-blood-400/60 hover:text-blood-400"
              >
                移除
              </button>
            </div>
          </div>

          {editing === c.id && (
            <div className="mt-3 space-y-2 border-t border-ink-700 pt-3">
              <input
                className={inputCls}
                value={c.name}
                onChange={(e) => patch(c, { name: e.target.value })}
                placeholder="姓名"
              />
              <input
                className={inputCls}
                value={c.role}
                onChange={(e) => patch(c, { role: e.target.value })}
                placeholder="身份"
              />
              <input
                className={inputCls}
                value={c.bond ?? ''}
                onChange={(e) => patch(c, { bond: e.target.value })}
                placeholder="与你的关系（如：雇主、旧识、临时搭档）"
              />
              <textarea
                className={`${inputCls} resize-none`}
                rows={3}
                value={c.personality}
                onChange={(e) => patch(c, { personality: e.target.value })}
                placeholder="性格与说话方式"
              />
              <textarea
                className={`${inputCls} resize-none`}
                rows={2}
                value={c.agenda ?? ''}
                onChange={(e) => patch(c, { agenda: e.target.value })}
                placeholder="他自己的打算（不喧宾夺主）"
              />
              <textarea
                className={`${inputCls} resize-none`}
                rows={2}
                value={c.appearance ?? ''}
                onChange={(e) => patch(c, { appearance: e.target.value })}
                placeholder="外貌：只写长相（发型发色、五官、身形、衣着），立绘按这句画"
              />
              <ImageField
                label="队友头像"
                prompt={characterImagePrompt(
                  {
                    name: c.name,
                    /*
                     * 以前这里喂的是 `${role}。${personality}` —— **一个字写长相的都没有**，
                     * 于是每次重生成都是模型脑补的新脸。
                     * 现在优先吃 `appearance`；老存档没有它，就还是原来那句（一个字都不变）。
                     */
                    appearance: c.appearance,
                    description: `${c.role}。${c.personality}`,
                  },
                  genre
                )}
                value={c.portrait}
                job={{ kind: 'portrait', target: c.id }}
                onClear={() => patch(c, { portrait: '' })}
              />
              <div className="flex items-center gap-2">
                <span className="text-[11px] text-mist-400">主动性</span>
                {(['reactive', 'balanced', 'proactive'] as const).map((v) => (
                  <button
                    key={v}
                    onClick={() => patch(c, { initiative: v })}
                    className={`rounded-md border px-2 py-1 text-[11px] transition ${
                      c.initiative === v
                        ? 'border-gold-600/70 text-gold-400'
                        : 'border-ink-600 text-mist-400'
                    }`}
                  >
                    {v === 'reactive' ? '被动' : v === 'balanced' ? '均衡' : '主动'}
                  </button>
                ))}
              </div>
              <div className="flex flex-wrap gap-2">
                {Object.entries(c.vitals).map(([k, v]) => (
                  <label key={k} className="flex items-center gap-1.5">
                    <span className="font-mono text-[11px] text-mist-500">
                      {k.toUpperCase()}
                    </span>
                    <input
                      className={inputNum}
                      type="number"
                      value={v}
                      onChange={(e) =>
                        patch(c, { vitals: { ...c.vitals, [k]: Number(e.target.value) } })
                      }
                    />
                  </label>
                ))}
              </div>
            </div>
          )}
        </div>
      ))}

      <button
        onClick={() => {
          const id = uid();
          upsert({
            id,
            name: '新队友',
            role: '身份未定',
            personality: '',
            skills: {},
            // 数值条按当前规则包给默认值，别写死 COC 的 hp/san/mp
            vitals: Object.fromEntries(
              getRuleset(rulesetId).vitalDefs.map((v) => [v.key, v.default])
            ),
            initiative: 'reactive',
            alive: true,
            present: true,
          });
          setEditing(id);
        }}
        className="w-full rounded-lg border border-dashed border-ink-600 py-2.5 text-[12px] text-mist-400 transition hover:border-gold-600/50 hover:text-mist-200"
      >
        + 添加队友
      </button>

      <AiGenBox
        label="队友"
        placeholder="例如：一个话不多的老铁路工，怕黑但要面子，不识字"
        onGenerate={async (desc, signal) => {
          const data = await generateJson<{
            name?: string;
            role?: string;
            personality?: string;
            /** 外貌锚点：AI 生成时一并产出，画这名队友的立绘就看这一句 */
            appearance?: string;
            initiative?: Companion['initiative'];
            skills?: Record<string, number>;
            vitals?: Record<string, number>;
          }>(companionSystemPrompt(genre, getRuleset(rulesetId)), desc || `请自由创作一名适合「${genre.name}」题材的随行同伴。`, {
            ...config,
            maxTokens: 2048,
          },
          signal);
          if (!data?.name) throw new Error('模型没有返回合法 JSON，请重试');
            upsert({
              id: uid(),
              name: data.name,
              role: data.role ?? '身份未定',
              personality: data.personality ?? '',
              // 没有外貌时留空 → 立绘退回 `${role}。${personality}` 的老拼法（见 ImageField 的 prompt）
              appearance: data.appearance?.trim() || undefined,
            skills: data.skills ?? {},
            vitals: data.vitals ?? { hp: 12, san: 60, mp: 12 },
            initiative:
              data.initiative === 'balanced' || data.initiative === 'proactive'
                ? data.initiative
                : 'reactive',
            alive: true,
            present: true,
          });
        }}
      />
    </div>
  );
}

function WorldbookTab() {
  const worldbook = useStore((s) => s.worldbook);
  const upsert = useStore((s) => s.upsertWorldbookEntry);
  const remove = useStore((s) => s.removeWorldbookEntry);
  const clearGenerated = useStore((s) => s.clearModuleWorldbook);
  const config = useStore((s) => s.config);
  const { genre } = useGenre();
  const generatedCount = worldbook.filter((e) => e.fromModule).length;

  return (
    <div className="space-y-3">
      <p className="text-[11px] leading-relaxed text-mist-500">
        条目只在玩家或 GM 提到关键词时注入提示词。写法上，关键词要覆盖简称和别称，正文只放客观事实。
      </p>

      {/*
       * 手动清理 AI 生成条目（协作方 N6）：跨档读档时世界书取并集，
       * 换过几个模组之后会累积不少不属于当前模组的条目，需要一个口子清掉。
       * 用户手写的条目一律保留。
       */}
      {generatedCount > 0 && (
        <div className="flex items-center justify-between gap-2 rounded-lg border border-ink-700 bg-ink-850 px-3 py-2">
          <span className="text-[11px] text-mist-400">
            其中 {generatedCount} 条是 AI 随模组生成的
          </span>
          <button
            onClick={clearGenerated}
            className="shrink-0 rounded-md border border-ink-600 px-2.5 py-1 text-[11px] text-mist-400 transition hover:border-blood-400/60 hover:text-blood-400"
            title="只删 AI 生成的条目，你手写的保留"
          >
            清理这些
          </button>
        </div>
      )}

      {worldbook.map((e) => (
        <div key={e.id} className="rounded-lg border border-ink-700 bg-ink-850 p-3">
          <div className="flex items-center gap-2">
            <input
              className={`${inputCls} flex-1`}
              value={e.keys.join('、')}
              placeholder="关键词，用顿号分隔"
              onChange={(ev) =>
                upsert({
                  ...e,
                  keys: ev.target.value
                    .split(/[、,，\s]+/)
                    .map((s) => s.trim())
                    .filter(Boolean),
                })
              }
            />
            <label className="flex shrink-0 items-center gap-1">
              <input
                type="checkbox"
                checked={e.enabled}
                onChange={(ev) => upsert({ ...e, enabled: ev.target.checked })}
                className="accent-[#b8953f]"
              />
              <span className="text-[11px] text-mist-400">启用</span>
            </label>
            <button
              onClick={() => remove(e.id)}
              className="shrink-0 rounded-md border border-ink-600 px-2 py-2 text-[11px] text-mist-500 transition hover:border-blood-400/60 hover:text-blood-400"
            >
              删
            </button>
          </div>
          <textarea
            className={`${inputCls} mt-2 resize-none`}
            rows={4}
            value={e.content}
            placeholder="设定正文：只写客观事实，不写剧情走向"
            onChange={(ev) => upsert({ ...e, content: ev.target.value })}
          />
          <div className="mt-2 flex items-center gap-2">
            <span className="text-[11px] text-mist-500">优先级</span>
            <input
              type="range"
              min={0}
              max={100}
              value={e.priority}
              onChange={(ev) => upsert({ ...e, priority: Number(ev.target.value) })}
              className="flex-1 accent-[#b8953f]"
            />
            <span className="w-8 text-right text-[11px] tabular-nums text-mist-400">
              {e.priority}
            </span>
          </div>

          {/*
           * 1.0 阶段 A：**注入的时机与位置由玩家说了算**。
           *
           * 「常驻」是这一刀最要紧的一个 —— 没有它，玩家写了「这个世界的魔法规则」，
           * 却只能等正文里出现"魔法"两个字才生效：世界的底层设定居然是"提起来才在"。
           *
           * ⚠️ 常驻不看关键词、全都进 → 必须与「字数」预算同刀，否则长局撑爆上下文。
           */}
          <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1.5">
            <label className="flex items-center gap-1">
              <input
                type="checkbox"
                checked={!!e.constant}
                onChange={(ev) => upsert({ ...e, constant: ev.target.checked })}
                className="accent-[#b8953f]"
              />
              <span className="text-[11px] text-mist-400">常驻</span>
            </label>
            <span
              className="text-[10px] text-mist-500"
              title="勾上后这一条不看关键词，每轮都在 —— 用来放世界的底层设定"
            >
              （每轮都注入）
            </span>

            <label className="flex items-center gap-1">
              <span className="text-[11px] text-mist-500">字数上限</span>
              <input
                type="number"
                min={0}
                value={e.budget ?? 0}
                onChange={(ev) => upsert({ ...e, budget: Number(ev.target.value) || 0 })}
                className={`${inputCls} w-20`}
                title="0 ＝不限制。总字数超预算时先裁优先级低的"
              />
            </label>

            <label className="flex items-center gap-1">
              <span className="text-[11px] text-mist-500">插入深度</span>
              <input
                type="number"
                min={0}
                max={5}
                value={e.depth ?? 0}
                onChange={(ev) => upsert({ ...e, depth: Number(ev.target.value) || 0 })}
                className={`${inputCls} w-16`}
                title="0 ＝贴着守密人的设定（最不容易被盖过）；越大越靠近当前对话"
              />
            </label>

            <label className="flex items-center gap-1">
              <span className="text-[11px] text-mist-500">分组</span>
              <input
                className={`${inputCls} w-24`}
                value={e.group ?? ''}
                placeholder="可留空"
                onChange={(ev) => upsert({ ...e, group: ev.target.value })}
              />
            </label>
          </div>
        </div>
      ))}

      <button
        onClick={() =>
          upsert({
            id: uid(),
            keys: [],
            content: '',
            priority: 50,
            enabled: true,
          })
        }
        className="w-full rounded-lg border border-dashed border-ink-600 py-2.5 text-[12px] text-mist-400 transition hover:border-gold-600/50 hover:text-mist-200"
      >
        + 新增条目
      </button>

      <AiGenBox
        label="世界书"
        placeholder="例如：一个封闭的渔业小镇，居民信奉某种海洋信仰，对外人极度警惕"
        onGenerate={async (desc, signal) => {
          const data = await generateJson<
            {
              keys?: string[];
              content?: string;
              priority?: number;
              constant?: boolean;
              budget?: number;
            }[]
          >(
            worldbookSystemPrompt(genre),
            desc || `请围绕「${genre.name}」题材自由创作几个世界设定条目。`,
            { ...config, maxTokens: 3072 }, signal
          );
          if (!Array.isArray(data) || data.length === 0)
            throw new Error('模型没有返回合法的条目数组，请重试');
          for (const item of data) {
            if (!item.content) continue;
            /*
             * 1.0 阶段 A：**AI 生成的条目也要带上常驻与预算**。
             *
             * 以前这里只落 keys / content / priority —— 于是 AI 生成的世界条目
             * 全是"提起来才在"，而它们偏偏多半是**世界的底层设定**（这座城的规矩、
             * 通行货币、这里的信仰），恰恰是最该常驻的那类。手写那条腿有常驻、AI 这条没有，
             * 同一件事两条腿不一致。
             */
            upsert({
              id: uid(),
              keys: item.keys?.length ? item.keys : [item.content.slice(0, 6)],
              content: item.content,
              priority: item.priority ?? 50,
              enabled: true,
              constant: item.constant === true,
              budget: Number.isFinite(item.budget) ? Number(item.budget) : 0,
            });
          }
        }}
      />
    </div>
  );
}

/** 带标签的多行文本框，模组页签里反复用到 */
function Area({
  label,
  hint,
  value,
  onChange,
  rows = 4,
  placeholder,
}: {
  label: string;
  hint?: string;
  value: string;
  onChange: (v: string) => void;
  rows?: number;
  placeholder?: string;
}) {
  return (
    <label className="block">
      <span className="mb-1 block text-[11px] text-mist-400">
        {label} {hint && <span className="text-mist-500">{hint}</span>}
      </span>
      <textarea
        className={`${inputCls} resize-none`}
        rows={rows}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
      />
    </label>
  );
}

function ModuleTab() {
  const gameModule = useStore((s) => s.module);
  const setModule = useStore((s) => s.setModule);
  const applyModule = useStore((s) => s.applyModule);
  const config = useStore((s) => s.config);
  const character = useStore((s) => s.character);
  const rulesetId = useStore((s) => s.rulesetId);
  const { genre } = useGenre();
  const setGenre = useStore((s) => s.setGenre);
  /** 剧透默认隐藏：玩家自己也会看到这个界面，先看到真相就没惊喜了 */
  const [revealed, setRevealed] = useState(false);
  /** 「报个名字就开团」：给的是已出版模组的名字，让模型按原版设定生成 */
  const [canonical, setCanonical] = useState(false);
  /** 从文本导入：贴任意文本让 AI 整理成模组卡 */
  const [importOpen, setImportOpen] = useState(false);
  const [importText, setImportText] = useState('');
  const [importing, setImporting] = useState(false);
  const [importErr, setImportErr] = useState('');
  /** 道具表单独生成 */
  const [genItemsBusy, setGenItemsBusy] = useState(false);
  const [genItemsErr, setGenItemsErr] = useState('');

  const genItems = async () => {
    setGenItemsBusy(true);
    setGenItemsErr('');
    // H24：给这一通也装个超时兜底（它不在 `AiGenBox` 里，拿不到那边的 controller）
    const t = genTimeout();
    try {
      const data = await generateJson<{
        items?: { name?: string; look?: string; effect?: string; kind?: string }[];
      }>(
        itemTableSystemPrompt(genre, gameModule, getRuleset(rulesetId)),
        `请为这个模组设计一张道具表：${gameModule.title}\n\n${gameModule.premise}`,
        { ...config, maxTokens: 2048 },
        t.signal
      );
      const items: ModuleItem[] = (data?.items ?? [])
        .filter((it) => it.name?.trim())
        .map((it) => ({
          id: uid(),
          name: it.name!.trim(),
          look: it.look?.trim() || '',
          effect: it.effect?.trim() || '',
          kind: (['weapon', 'tool', 'clue', 'consumable', 'other'].includes(it.kind ?? '')
            ? it.kind
            : 'other') as ModuleItem['kind'],
        }));
      if (!items.length) throw new Error('模型没有返回道具，请重试');
      setModule({ items });
      setGenItemsErr('');
    } catch (e) {
      const msg = e instanceof ModelError ? e.message : `生成失败：${(e as Error).message}`;
      setGenItemsErr(
        t.signal.aborted ? '生成时间太长，已经停下了（内容没丢）。可以重试一次。' : msg
      );
      // 往上抛：`genTables()` 要靠它知道"这一半失败了"（会自己 catch 记一笔）
      throw e;
    } finally {
      t.done();
      setGenItemsBusy(false);
    }
  };

  /** 敌对者表：默认遮住（剧透），可单独生成 */
  const monsters = gameModule.monsters ?? [];
  // 遮罩外面那个「投入战斗」只认**起了名字的** —— 没名字的也进不了战斗（引擎同样不收）
  const namedMonsters = monsters.filter((m) => m.name.trim().length > 0);
  const [castPick, setCastPick] = useState(0);
  const [castNote, setCastNote] = useState('');
  const [monstersRevealed, setMonstersRevealed] = useState(false);
  const [genMonstersBusy, setGenMonstersBusy] = useState(false);
  const [genMonstersErr, setGenMonstersErr] = useState('');

  const genMonsters = async () => {
    setGenMonstersBusy(true);
    setGenMonstersErr('');
    // H24：同样装一个超时兜底
    const t = genTimeout();
    try {
      const data = await generateJson<{
        monsters?: {
          name?: string;
          look?: string;
          hp?: number;
          attack?: string;
          behavior?: string;
          weakness?: string;
        }[];
      }>(
        monsterSystemPrompt(genre, getRuleset(rulesetId), gameModule),
        `请为这个模组设计敌对者：${gameModule.title}\n\n${gameModule.premise}`,
        { ...config, maxTokens: 2048 },
        t.signal
      );
      const list: ModuleMonster[] = (data?.monsters ?? [])
        .filter((m) => m.name?.trim())
        .map((m) => ({
          id: uid(),
          name: m.name!.trim(),
          look: m.look?.trim() || '',
          hp: typeof m.hp === 'number' ? m.hp : undefined,
          attack: m.attack?.trim() || '',
          behavior: m.behavior?.trim() || '',
          weakness: m.weakness?.trim() || '',
        }));
      if (!list.length) throw new Error('模型没有返回敌对者，请重试');
      setModule({ monsters: list });
      setMonstersRevealed(true);
    } catch (e) {
      const msg = e instanceof ModelError ? e.message : `生成失败：${(e as Error).message}`;
      setGenMonstersErr(
        t.signal.aborted ? '生成时间太长，已经停下了（内容没丢）。可以重试一次。' : msg
      );
      // 同上：`genTables()` 靠抛出来分辨哪一半失败
      throw e;
    } finally {
      t.done();
      setGenMonstersBusy(false);
    }
  };

  const upsertMonster = (m: ModuleMonster) => {
    const list = gameModule.monsters ?? [];
    const idx = list.findIndex((x) => x.id === m.id);
    setModule({ monsters: idx >= 0 ? list.map((x) => (x.id === m.id ? m : x)) : [...list, m] });
  };
  const removeMonster = (id: string) =>
    setModule({ monsters: (gameModule.monsters ?? []).filter((x) => x.id !== id) });

  /**
   * 一键生成**敌对者 + 道具表**（用户 2026-09-17 报的"需要手动生成"）。
   *
   * ## 为什么要有这个按钮
   * 原来两张表各有一个生成按钮，玩家/AI 生成完模组包之后要**记得点两次**。
   * 漏点一次，那一局就会出现"战斗里敌人没有数值"或者"拾取的东西没有作用"——
   * 而这恰恰是框架该替玩家兜住的事，不是靠他记性。
   *
   * ## 为什么是"并发两次调用"而不是"一次要两张表"
   * 两个提示词（`itemTableSystemPrompt` / `monsterSystemPrompt`）是分别调好的，
   * 各自**只做一件事**，作用与数值都写得比混在一起时准确（各自的注释里说过）。
   * 所以这里保持两个提示词不变，只是把"点两次"变成"点一次"：
   * 并发发出去，各自失败互不影响 —— 一边失败另一半照样落地。
   *
   * 这也符合"一次多做点"的偏好：玩家只看见一个按钮，引擎负责把两件事办完。
   */
  const [genAllBusy, setGenAllBusy] = useState(false);
  const [genAllErr, setGenAllErr] = useState('');

  const genTables = async () => {
    setGenAllBusy(true);
    setGenAllErr('');
    const failed: string[] = [];
    // 两张表并发：一张慢不会拖住另一张
    await Promise.all([
      genItems().catch(() => failed.push('道具表')),
      genMonsters().catch(() => failed.push('敌对者')),
    ]);
    if (failed.length) {
      setGenAllErr(`${failed.join(' 与 ')} 没生成成功，可以单独再点一次对应的按钮。`);
    }
    setGenAllBusy(false);
  };

  /**
   * 按表里的数值把它放进战斗 —— 引擎初始化，模型只负责演。
   *
   * 走 `startCombatFrom`（→ `castFromBestiary`）：它会一并把
   * `combat.active` / `combat.round` 打开、把血量 clamp、并在图鉴台账里记一笔
   * `encountered`（玩家见到它了）。以前这里手写两个 delta，
   * 图鉴就永远记不上账。
   */
  const throwIntoCombat = (m: ModuleMonster) => () => {
    const name = m.name.trim();
    if (!name) return;
    useStore.getState().startCombatFrom(gameModule.monsters ?? [], [name]);
  };

  const upsertItem = (it: ModuleItem) => {
    const list = gameModule.items ?? [];
    const idx = list.findIndex((x) => x.id === it.id);
    setModule({ items: idx >= 0 ? list.map((x) => (x.id === it.id ? it : x)) : [...list, it] });
  };
  const removeItem = (id: string) =>
    setModule({ items: (gameModule.items ?? []).filter((x) => x.id !== id) });

  const upsertNpc = (n: ModuleNpc) => {
    const idx = gameModule.npcs.findIndex((x) => x.id === n.id);
    const npcs =
      idx >= 0 ? gameModule.npcs.map((x) => (x.id === n.id ? n : x)) : [...gameModule.npcs, n];
    setModule({ npcs });
  };
  const removeNpc = (id: string) =>
    setModule({ npcs: gameModule.npcs.filter((x) => x.id !== id) });
  const addNpc = () =>
    setModule({
      npcs: [
        ...gameModule.npcs,
        { id: uid(), name: '新人物', role: '', motive: '', secret: '', appearance: '' },
      ],
    });

  /** 导出这张模组卡（不含玩家角色与进度）——JSON 给本应用复用，Markdown 给人/别的 AI 读 */
  const exportModule = (fmt: 'json' | 'md') => {
    const stamp = new Date().toISOString().slice(0, 10);
    const safe = (gameModule.title || '模组').replace(/[\\/:*?"<>|]/g, '_');
    const m = gameModule;
    const content =
      fmt === 'json'
        ? JSON.stringify(m, null, 2)
        : [
            `# ${m.title}`,
            '',
            m.sourceNote ? `> 来源：${m.sourceNote}` : '',
            '',
            '## 前言',
            m.premise,
            '',
            '## 开场白',
            m.opening || '（空）',
            '',
            '## 玩家目标',
            m.goal || '（未填）',
            '',
            '## 赌注',
            m.stakes || '（未填）',
            '',
            '## 紧迫感',
            m.urgency || '（未填）',
            '',
            '## 真相（GM 专用，勿剧透）',
            m.truth,
            '',
            '## 关键人物',
            ...m.npcs.map(
              (n) =>
                `- **${n.name}**（${n.role}）\n  - 动机：${n.motive || '未定'}\n  - 秘密：${n.secret || '无'}${
                  n.appearance?.trim() ? `\n  - 外貌：${n.appearance.trim()}` : ''
                }`
            ),
            '',
            '## 关键地点',
            m.locations,
            '',
            '## 线索链',
            m.clueChain,
            '',
            '## 幕结构',
            m.acts,
            '',
            '## 结局与失败条件',
            m.endings,
            '',
            '## GM 备注',
            m.notes,
            '',
          ].join('\n');
    const type = fmt === 'json' ? 'application/json' : 'text/markdown;charset=utf-8';
    const blob = new Blob([content], { type });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `${safe}-模组-${stamp}.${fmt === 'json' ? 'json' : 'md'}`;
    a.click();
    URL.revokeObjectURL(a.href);
  };

  return (
    <div className="space-y-4">
      <p className="text-[11px] leading-relaxed text-mist-500">
        模组＝这一局的<span className="text-mist-300">故事骨架</span>，不是完整剧本。AI
        守密人据此即兴生成场景与对白；骨架越清楚，长局越不容易跑偏。世界书是它的细节层。
      </p>

      <div className="rounded-lg border border-ink-700 bg-ink-850/50 p-2.5">
        <span className="mb-1.5 block text-[11px] text-mist-400">
          内置模组 <span className="text-mist-500">（一键套用成品模组）</span>
        </span>
        <div className="flex flex-wrap gap-1.5">
          {/* 与当前题材匹配的模组排前面——选了「剑与魔法」就别老把克苏鲁的模组推给玩家 */}
          {[...BUILTIN_MODULES]
            .sort((a, b) => Number(b.genre === genre.id) - Number(a.genre === genre.id))
            .map((m) => {
              const active = gameModule.title === m.title;
              const match = m.genre === genre.id;
              return (
                <button
                  key={m.title}
                  onClick={() => {
                    if (active) return;
                    /*
                     * 走 `applyModule()` 而不是 `setModule()`：
                     * 一键套用内置模组＝**真的换了一个模组**，必须一并
                     * ①撤掉上一个模组的世界书 ②装上这个模组自带的那份
                     *  ③清掉上一个模组推荐的队友候选 ④重算开场白。
                     *
                     * 以前这里只调 `setModule`，于是套用《枯井之约》之后
                     * 屏幕上飘的还是上一个世界的设定（主人 2026-09-17 报的）。
                     */
                    applyModule({ ...m, npcs: m.npcs.map((n) => ({ ...n, id: uid() })) });
                    // 套用内置模组时，把题材也切到它的归属——否则会拿克苏鲁的写法跑奇幻模组
                    if (m.genre) setGenre(m.genre);
                  }}
                  className={`rounded-md border px-2.5 py-1 text-[12px] transition ${
                    active
                      ? 'border-gold-600/70 bg-gold-500/10 text-gold-300'
                      : match
                        ? 'border-gold-600/40 text-mist-200 hover:border-gold-600/70 hover:text-mist-100'
                        : 'border-ink-600 text-mist-400 hover:border-gold-600/50 hover:text-mist-200'
                  }`}
                  title={match ? `适配当前题材「${genre.name}」` : ''}
                >
                  {m.title}
                  {match && <span className="ml-1 text-[9px] text-gold-500">适配</span>}
                </button>
              );
            })}
        </div>
      </div>

      {gameModule.sourceNote && (
        <div className="rounded-lg border border-gold-600/40 bg-gold-500/5 px-3 py-2 text-[11px] leading-relaxed text-gold-300">
          来源：{gameModule.sourceNote}
        </div>
      )}

      <div className="flex items-center gap-1.5">
        <span className="text-[11px] text-mist-400">导出模组：</span>
        <button
          onClick={() => exportModule('json')}
          className="rounded-md border border-ink-600 px-2.5 py-1 text-[11px] text-mist-300 transition hover:border-gold-600/50 hover:text-mist-100"
        >
          JSON
        </button>
        <button
          onClick={() => exportModule('md')}
          className="rounded-md border border-ink-600 px-2.5 py-1 text-[11px] text-mist-300 transition hover:border-gold-600/50 hover:text-mist-100"
        >
          Markdown
        </button>
      </div>

      <label className="block">
        <span className="mb-1 block text-[11px] text-mist-400">模组名</span>
        <input
          className={inputCls}
          value={gameModule.title}
          onChange={(e) => setModule({ title: e.target.value })}
        />
      </label>

      {/*
       * 篇幅：**决定时间尺度**。
       * 早期不分篇幅，模型一律把紧迫感写成"只剩 15 分钟"——短篇合适，
       * 长篇就荒谬了：横跨几周的调查被压进一晚上，玩家一出门就"时间到"。
       */}
      <div>
        <span className="mb-1 block text-[11px] text-mist-400">
          篇幅 <span className="text-mist-500">（决定时间尺度与规模，生成时生效）</span>
        </span>
        <div className="flex flex-wrap gap-1.5">
          {(['short', 'medium', 'long'] as ModuleScale[]).map((sc) => (
            <button
              key={sc}
              onClick={() => setModule({ scale: sc })}
              className={`rounded-md border px-2.5 py-1 text-[11px] transition ${
                (gameModule.scale ?? 'short') === sc
                  ? 'border-gold-600/70 bg-gold-500/10 text-gold-400'
                  : 'border-ink-600 text-mist-400 hover:border-gold-600/40'
              }`}
            >
              {SCALE_LABEL[sc]}
            </button>
          ))}
        </div>
        <p className="mt-1 text-[10px] leading-relaxed text-mist-500">
          {SCALE_LABEL[gameModule.scale ?? 'short']} ——{' '}
          {(gameModule.scale ?? 'short') === 'short'
            ? '时间压力以小时计，三幕，一局跑完。'
            : (gameModule.scale ?? 'short') === 'medium'
              ? '时间压力以天计（3-7 天），四到五幕，可以来回走访。'
              : '时间压力以周/月计，分章推进，日子一天天过去；具体场景会在进章时再展开。'}
        </p>
      </div>

      <Area
        label="前言"
        hint="（玩家能听到的开局引子）"
        value={gameModule.premise}
        onChange={(v) => setModule({ premise: v })}
        rows={5}
      />

      <Area
        label="开场白"
        hint={`（留空则用内置场景，会按称呼「${addressOf(character)}」生成）`}
        value={gameModule.opening}
        onChange={(v) => setModule({ opening: v })}
        rows={5}
        placeholder="可用 {{称呼}} 指代玩家"
      />

      <label className="block">
        <span className="mb-1 block text-[11px] text-mist-400">
          开局地点 <span className="text-mist-500">（第一幕玩家身处何处；开团即写进"当前地点"）</span>
        </span>
        <input
          className={inputCls}
          value={gameModule.startLocation ?? ''}
          onChange={(e) => setModule({ startLocation: e.target.value })}
          placeholder="如：霍尔特的侦探事务所"
        />
      </label>

      <div className="space-y-2 rounded-lg border border-gold-600/30 bg-gold-500/5 p-2.5">
        <span className="block text-[11px] text-gold-300">
          玩家目标{' '}
          <span className="text-gold-500">
            （回答"我要干嘛"——开场就会展示给玩家，最重要的一项）
          </span>
        </span>
        <Area
          label="目标"
          hint="（玩家要达成什么；一句话，具体到可执行）"
          value={gameModule.goal ?? ''}
          onChange={(v) => setModule({ goal: v })}
          rows={2}
          placeholder="如：查出玛乔丽的下落，并拿到那卷未冲洗的胶卷"
        />
        <Area
          label="赌注"
          hint="（不做、或失败会付出什么代价）"
          value={gameModule.stakes ?? ''}
          onChange={(v) => setModule({ stakes: v })}
          rows={2}
          placeholder="如：底片会被销毁，玛乔丽活不过这个月"
        />
        <Area
          label="紧迫感"
          hint="（为什么是现在，不能再等）"
          value={gameModule.urgency ?? ''}
          onChange={(v) => setModule({ urgency: v })}
          rows={2}
          placeholder="如：已失踪十一天，对方正在清理痕迹"
        />
      </div>

      <div className="rounded-lg border border-ink-700 bg-ink-850/50 p-2.5">
        <div className="flex items-center justify-between gap-2">
          <span className="text-[11px] text-mist-400">
            GM 内部资料{' '}
            <span className="text-mist-500">
              （真相 / 人物秘密 / 线索链 / 幕结构 / 结局）
            </span>
          </span>
          <button
            onClick={() => setRevealed((v) => !v)}
            className="shrink-0 text-[11px] text-gold-400 hover:text-gold-500"
          >
            {revealed ? '隐藏剧透' : '显示剧透'}
          </button>
        </div>
        {!revealed && (
          <p className="mt-1.5 text-[11px] leading-relaxed text-mist-500">
            已隐藏，免得你（也是玩家）提前看到真相和线索、玩的时候没惊喜。AI
            生成之后也会保持隐藏——要核对或修改时再点「显示剧透」。
          </p>
        )}
      </div>

      {/*
       * 两张表的生成入口 —— **故意放在剧透遮罩外面**。
       *
       * 用户 2026-09-17：「敌对者 + 道具表需要手动生成」。
       * 生成完模组包之后，绝大多数人的下一步就是"把这两张表补上"，
       * 这是**常规路径**，不是"核对剧透时才做的事"。
       * 从前它们落在 `{revealed && …}` 里，玩家不点「显示剧透」根本看不见按钮
       * ——等于没有。生成按钮属于**操作**，表的内容才属于剧透，两者要分开。
       */}
      <div className="rounded-lg border border-gold-600/40 bg-gold-500/[0.04] p-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="min-w-0">
            <span className="text-[11px] text-gold-300">敌对者与道具</span>
            <span className="ml-1.5 text-[10px] text-gold-500">
              （两张表各自单独生成，内容默认遮住，不剧透）
            </span>
          </div>
          <div className="flex shrink-0 flex-wrap gap-1.5">
            <button
              onClick={genTables}
              disabled={genAllBusy || genItemsBusy || genMonstersBusy}
              className="rounded-md border border-gold-600/60 bg-gold-500/10 px-2.5 py-1 text-[11px] text-gold-400 transition hover:bg-gold-600/20 disabled:opacity-50"
              title="一次把敌对者表与道具表都生成出来（两张表并发，互不影响）"
            >
              {genAllBusy ? '生成中…' : '一键生成两张表'}
            </button>
            <button
              onClick={genMonsters}
              disabled={genMonstersBusy}
              className="rounded-md border border-blood-400/50 px-2.5 py-1 text-[11px] text-blood-300 transition hover:bg-blood-400/10 disabled:opacity-50"
              title="单独生成一次敌对者表：数值定死，之后战斗照此演出"
            >
              {genMonstersBusy ? '生成中…' : '生成敌对者'}
            </button>
            <button
              onClick={genItems}
              disabled={genItemsBusy}
              className="rounded-md border border-gold-600/50 px-2.5 py-1 text-[11px] text-gold-400 transition hover:bg-gold-500/10 disabled:opacity-50"
              title="单独生成一次道具表：只做这一件事，所以作用写得比混在角色生成里准确得多"
            >
              {genItemsBusy ? '生成中…' : '生成道具表'}
            </button>
          </div>
        </div>
        {genAllErr && <p className="mt-1.5 text-[10px] text-gold-400">{genAllErr}</p>}
        {genMonstersErr && <p className="mt-1.5 text-[10px] text-blood-400">{genMonstersErr}</p>}
        {genItemsErr && <p className="mt-1.5 text-[10px] text-blood-400">{genItemsErr}</p>}
        <p className="mt-1.5 text-[11px] text-mist-500">
          已设定 {monsters.length} 个敌对者、{(gameModule.items ?? []).length} 件道具 ——
          两张表的具体内容在下面「显示剧透」之后可查可改。
        </p>

        {/*
         * 🔴 H13：「投入战斗」的**操作**入口 —— 与上面那排生成按钮同一个理由，
         * 放在两层剧透遮罩（「显示剧透」＋敌对者表的「查看」）**外面**。
         *
         * 原来它只在遮罩里、每一只身上各挂一个按钮（下面 `1848` 那处），
         * 于是玩家不先点两次「显示剧透」根本不知道有这条路 ——
         * 「引擎权威」那条路被藏死，正踩用户拍板的「玩家看不见＝没做」。
         *
         * 这里**只出操作、不出内容**：选项写「第 N 个」，不列名字、不列数值，
         * 遮罩本身的意义（别提前看见"这东西 12 血、怕火"）一点没破。
         */}
        <div className="mt-2 border-t border-gold-600/20 pt-2">
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="text-[10px] text-gold-500">投入战斗</span>
            {namedMonsters.length === 0 ? (
              <span className="text-[10px] text-mist-500">
                还没有敌对者 —— 先生成敌对者表
              </span>
            ) : (
              <>
                <select
                  value={castPick}
                  onChange={(e) => setCastPick(Number(e.target.value))}
                  className="rounded-md border border-ink-600 bg-ink-900 px-1.5 py-1 text-[11px] text-mist-200"
                  title="只写序号，不写名字与数值 —— 免得提前剧透"
                >
                  {namedMonsters.map((m, i) => (
                    <option key={m.id} value={i}>
                      第 {i + 1} 个
                    </option>
                  ))}
                </select>
                <button
                  onClick={() => {
                    const m = namedMonsters[castPick];
                    if (!m) return;
                    // 与遮罩里那个按钮同一条路：走 startCombatFrom，引擎按表落数值
                    useStore.getState().startCombatFrom(gameModule.monsters ?? [], [m.name]);
                    // 只报"第几个"，不报名字 —— 这里不剧透
                    setCastNote(`第 ${castPick + 1} 个敌对者已按模组数值投入战斗`);
                  }}
                  className="rounded-md border border-blood-400/50 px-2.5 py-1 text-[11px] text-blood-300 transition hover:bg-blood-400/10"
                  title="按模组表里的数值把它放进战斗（引擎开 combat.foes，模型只负责演）"
                >
                  投入战斗
                </button>
              </>
            )}
          </div>
          <p className="mt-1 text-[10px] text-mist-500">
            这里只给操作、不给名字与数值 —— 想知道具体是哪一只，到下面「显示剧透 → 查看」。
          </p>
          {castNote && <p className="mt-1 text-[10px] text-blood-300">{castNote}</p>}
        </div>
      </div>

      {revealed && (
        <>
      <Area
        label="真相"
        hint="（幕后发生了什么；绝不可直接告诉玩家）"
        value={gameModule.truth}
        onChange={(v) => setModule({ truth: v })}
        rows={5}
      />

      <div>
        <div className="mb-1.5 flex items-center justify-between">
          <span className="text-[11px] text-mist-400">
            关键人物 <span className="text-mist-500">（动机与秘密不会告诉玩家）</span>
          </span>
          <button onClick={addNpc} className="text-[11px] text-gold-400 hover:text-gold-500">
            添加
          </button>
        </div>
        <div className="space-y-2">
          {gameModule.npcs.map((n) => (
            <div key={n.id} className="space-y-2 rounded-lg border border-ink-700 bg-ink-850/60 p-2.5">
              <div className="flex items-center gap-2">
                <label className="block min-w-0 flex-1">
                  <span className="mb-0.5 block text-[10px] text-mist-500">姓名</span>
                  <input
                    className={inputFlex}
                    value={n.name}
                    placeholder="如：老霍华德"
                    onChange={(e) => upsertNpc({ ...n, name: e.target.value })}
                  />
                </label>
                <button
                  onClick={() => removeNpc(n.id)}
                  className="mt-4 shrink-0 rounded-md border border-ink-600 px-2 py-2 text-[11px] text-mist-500 transition hover:border-blood-400/60 hover:text-blood-400"
                >
                  删
                </button>
              </div>
              <label className="block">
                <span className="mb-0.5 block text-[10px] text-mist-500">身份</span>
                <input
                  className={inputCls}
                  value={n.role}
                  placeholder="如：委托人 / 工厂主"
                  onChange={(e) => upsertNpc({ ...n, role: e.target.value })}
                />
              </label>
              <label className="block">
                <span className="mb-0.5 block text-[10px] text-mist-500">
                  外貌 <span className="text-mist-600">（画头像用，只写长相）</span>
                </span>
                <input
                  className={inputCls}
                  value={n.appearance ?? ''}
                  placeholder="如：五十来岁的瘦高男人，灰白短发，洗旧的蓝布工装"
                  onChange={(e) => upsertNpc({ ...n, appearance: e.target.value })}
                />
              </label>
              <label className="block">
                <span className="mb-0.5 block text-[10px] text-mist-500">动机（他想要什么）</span>
                <input
                  className={inputCls}
                  value={n.motive}
                  placeholder="如：找回女儿，同时掩盖旧交情"
                  onChange={(e) => upsertNpc({ ...n, motive: e.target.value })}
                />
              </label>
              <label className="block">
                <span className="mb-0.5 block text-[10px] text-mist-500">
                  秘密（他不愿让人知道的）
                </span>
                <input
                  className={inputCls}
                  value={n.secret}
                  placeholder="如：他早就知道「暗房冲洗服务」是什么"
                  onChange={(e) => upsertNpc({ ...n, secret: e.target.value })}
                />
              </label>
            </div>
          ))}
        </div>
      </div>

      <Area
        label="关键地点"
        hint="（一行一个）"
        value={gameModule.locations}
        onChange={(v) => setModule({ locations: v })}
        rows={4}
      />
      {/*
       * 怪物 / 敌对者表（R38）。
       * 默认**遮罩**：玩家自己也会翻到准备页，先看见"这东西 12 血、怕火"就没得玩了。
       * 数值定下来之后由引擎在战斗开始时初始化 `combat.foes`，模型只负责演出。
       */}
      <div className="rounded-lg border border-blood-400/30 bg-blood-400/[0.03] p-3">
        <div className="flex items-center justify-between gap-2">
          <div>
            <span className="text-[11px] text-mist-400">敌对者</span>
            <span className="ml-1.5 text-[10px] text-mist-500">
              （数值定下来后战斗照此演出；含剧透，默认遮住）
            </span>
          </div>
          <div className="flex shrink-0 gap-1.5">
            <button
              onClick={() => setMonstersRevealed((v) => !v)}
              className="rounded-md border border-ink-600 px-2 py-1 text-[10px] text-mist-400 transition hover:border-gold-600/50 hover:text-mist-100"
            >
              {monstersRevealed ? '遮住' : '查看'}
            </button>
            {/*
              生成按钮不在这里 —— 它们已经挪到上面「敌对者与道具」那一块（剧透遮罩**外面**）。
              理由见那里的注释：生成是常规操作，不该藏在"显示剧透"后面。
            */}
          </div>
        </div>
        {genMonstersErr && <p className="mt-1.5 text-[10px] text-blood-400">{genMonstersErr}</p>}

        {!monstersRevealed ? (
          <p className="mt-2 text-[11px] text-mist-500">
            已设定 {monsters.length} 个敌对者（点「查看」显示，会剧透）
          </p>
        ) : (
          <div className="mt-2 space-y-2">
            {monsters.map((m) => (
              <div key={m.id} className="rounded-md border border-ink-700 bg-ink-900 p-2">
                <div className="flex items-center gap-1.5">
                  <input
                    className={`${inputCls} flex-1`}
                    value={m.name}
                    placeholder="名称"
                    onChange={(e) => upsertMonster({ ...m, name: e.target.value })}
                  />
                  <input
                    type="number"
                    className={`${inputCls} w-16 shrink-0`}
                    value={m.hp ?? ''}
                    placeholder="生命"
                    onChange={(e) =>
                      upsertMonster({ ...m, hp: Number(e.target.value) || undefined })
                    }
                  />
                  <button
                    onClick={() => removeMonster(m.id)}
                    className="shrink-0 rounded-md border border-ink-600 px-2 py-1.5 text-[11px] text-mist-500 transition hover:border-blood-400/60 hover:text-blood-400"
                  >
                    删
                  </button>
                </div>
                <input
                  className={`${inputCls} mt-1.5`}
                  value={m.look ?? ''}
                  placeholder="外观 / 声音 / 气味（只写玩家能感知的）"
                  onChange={(e) => upsertMonster({ ...m, look: e.target.value })}
                />
                <input
                  className={`${inputCls} mt-1.5`}
                  value={m.attack ?? ''}
                  placeholder="攻击方式与伤害骰（如：爪击 1d6）"
                  onChange={(e) => upsertMonster({ ...m, attack: e.target.value })}
                />
                <input
                  className={`${inputCls} mt-1.5`}
                  value={m.behavior ?? ''}
                  placeholder="行为：怎么接近、什么时候退"
                  onChange={(e) => upsertMonster({ ...m, behavior: e.target.value })}
                />
                <input
                  className={`${inputCls} mt-1.5`}
                  value={m.weakness ?? ''}
                  placeholder="弱点 / 破解方式（玩家的活路，必须给）"
                  onChange={(e) => upsertMonster({ ...m, weakness: e.target.value })}
                />
                <button
                  onClick={throwIntoCombat(m)}
                  className="mt-1.5 w-full rounded-md border border-blood-400/40 py-1 text-[11px] text-blood-300 transition hover:bg-blood-400/10"
                  title="按这里的数值把它放进战斗（引擎初始化 combat.foes）"
                >
                  投入战斗（按此数值）
                </button>
              </div>
            ))}
            <button
              onClick={() =>
                upsertMonster({ id: uid(), name: '', hp: undefined, attack: '', behavior: '', weakness: '' })
              }
              className="w-full rounded-md border border-dashed border-ink-600 py-1.5 text-[11px] text-mist-400 transition hover:border-blood-400/50 hover:text-mist-200"
            >
              ＋ 手动加一个
            </button>
          </div>
        )}
      </div>

      {/*
       * 道具表：**作用单独生成**。
       * 和「怪物设定页」同一个思路——能用独立步骤生成的，就别混在一次生成里。
       * 塞进角色生成时模型一次要想太多东西，结果物品说明短、作用含糊，
       * 玩家捡到一件东西只有个名字，不知道能干嘛。
       */}
      <div className="rounded-lg border border-ink-700 bg-ink-850/40 p-3">
        <div className="flex items-center justify-between gap-2">
          <div>
            <span className="text-[11px] text-mist-400">道具表</span>
            <span className="ml-1.5 text-[10px] text-mist-500">
              （这个模组里会出现的东西；作用写好后，玩家拾取时自动带进背包）
            </span>
          </div>
          {/* 生成按钮在上面「敌对者与道具」那一块（剧透遮罩外），这里只放内容 */}
        </div>
        {genItemsErr && <p className="mt-1.5 text-[10px] text-blood-400">{genItemsErr}</p>}
        <div className="mt-2 space-y-2">
          {(gameModule.items ?? []).map((it) => (
            <div key={it.id} className="rounded-md border border-ink-700 bg-ink-900 p-2">
              <div className="flex items-center gap-1.5">
                <input
                  className={`${inputCls} flex-1`}
                  value={it.name}
                  placeholder="物品名"
                  onChange={(e) => upsertItem({ ...it, name: e.target.value })}
                />
                <button
                  onClick={() => removeItem(it.id)}
                  className="shrink-0 rounded-md border border-ink-600 px-2 py-1.5 text-[11px] text-mist-500 transition hover:border-blood-400/60 hover:text-blood-400"
                >
                  删
                </button>
              </div>
              <input
                className={`${inputCls} mt-1.5`}
                value={it.look ?? ''}
                placeholder="外观 / 来历（一句话）"
                onChange={(e) => upsertItem({ ...it, look: e.target.value })}
              />
              <textarea
                className={`${inputCls} mt-1.5 resize-none`}
                rows={2}
                value={it.effect ?? ''}
                placeholder="作用：用了会发生什么具体变化（这一条最重要）"
                onChange={(e) => upsertItem({ ...it, effect: e.target.value })}
              />
            </div>
          ))}
        </div>
        <button
          onClick={() =>
            upsertItem({
              id: uid(),
              name: '',
              look: '',
              effect: '',
              kind: 'other',
            })
          }
          className="mt-2 w-full rounded-md border border-dashed border-ink-600 py-1.5 text-[11px] text-mist-400 transition hover:border-gold-600/50 hover:text-mist-200"
        >
          ＋ 手动加一件
        </button>
      </div>

      <Area
        label="线索链"
        hint="（哪条线索通向哪，用 → 串起来，防止卡关）"
        value={gameModule.clueChain}
        onChange={(v) => setModule({ clueChain: v })}
        rows={4}
      />
      <Area
        label="幕结构"
        hint="（三幕 / 推进节点）"
        value={gameModule.acts}
        onChange={(v) => setModule({ acts: v })}
        rows={4}
      />
      <Area
        label="结局与失败条件"
        value={gameModule.endings}
        onChange={(v) => setModule({ endings: v })}
        rows={3}
      />
      <Area
        label="GM 备注"
        hint="（基调、反复出现的意象等）"
        value={gameModule.notes}
        onChange={(v) => setModule({ notes: v })}
        rows={2}
      />
        </>
      )}

      <label className="flex items-start gap-2 rounded-lg border border-ink-700 bg-ink-850/50 p-2.5 text-[11px] leading-relaxed text-mist-400">
        <input
          type="checkbox"
          checked={canonical}
          onChange={(e) => setCanonical(e.target.checked)}
          className="mt-0.5 shrink-0 accent-[#b8953f]"
        />
        <span>
          这是<b className="text-mist-200">已出版模组</b>的名字 —— 尽量按原版设定生成。
          这就是「报个名字就开团」；模型不认识的话，会按名字的风格自创一个一致的版本。
        </span>
      </label>

      <p className="text-[10px] leading-relaxed text-mist-500">
        一次生成：模组骨架 + 世界书词条（只含公开事实、不剧透）+ 3-4 个队友候选（到「同行者」里挑）。
        生成后会在上方标注<b className="text-mist-300">来源</b>——按原版还原、还是 AI 自创，一眼便知。
      </p>

      <AiGenBox
        label={canonical ? '模组包（按原版）' : '模组包'}
        placeholder="例如：敦威治恐怖事件　或　1920 年代新英格兰，一名摄影师在小镇失踪"
        onGenerate={async (desc, signal, onStage) => {
          const data = await generateJson<{
            title?: string;
            premise?: string;
            opening?: string;
            start_location?: string;
            truth?: string;
            goal?: string;
            stakes?: string;
            urgency?: string;
            npcs?: { name?: string; role?: string; motive?: string; secret?: string; appearance?: string }[];
            locations?: string;
            map_nodes?: { name?: string; links?: string[]; note?: string }[];
            clueChain?: string;
            acts?: string;
            endings?: string;
            notes?: string;
            source_note?: string;
            /*
             * P2-10 / H22 的**中段**（第 12 轮测出我漏了这一段）：
             * 字段在 `types.ts` 里加了、引擎也会读，但**提示词没告诉模型** → 恒为 undefined，
             * 于是开团时刻永远是上午 9:00（"今夜"的模组在上午开场）。
             * 现在契约里有，这里就要接住。
             */
            start_clock?: { day?: number; minute?: number };
            deadline_in?: number;
          }>(
            // 篇幅决定时间尺度：短篇以小时计，长篇以周/月计（否则一律被压成 15 分钟）
            moduleSystemPrompt(genre, getRuleset(rulesetId), gameModule.scale ?? 'short'),
            moduleUserPrompt(desc, canonical, genre),
            {
              ...config,
              /*
               * 长篇要给得下分章的幕结构与 8-12 个地点，token 不够会截断。
               *
               * `canonical`（按原版还原）也要多给：它比自创多写一大块
               * （原版背景 / 关键人物 / 真相 / 线索链），3072 常常不够 ——
               * 第 12 轮 `A3` 就是勾了「已出版模组」生成 64 秒后**没落地**，
               * 八成是内容被截断、JSON 就不合法了（`generateJson` 只能返回 null）。
               */
              maxTokens:
                (gameModule.scale ?? 'short') === 'long' ? 6144 : canonical ? 4096 : 3072,
            },
            signal
          );
          if (!data) throw new Error('模型没有返回合法 JSON，请重试');
          /*
           * 走 `applyModule()`：AI 生成模组＝真的换了一个模组，
           * 撤旧世界书 + 清旧队友候选 + 重算开场白都在里面做，不必再手动调
           * `clearModuleDerived()`（从前是两步，少一步就留下上一个模组的残留）。
           */
          /*
           * 一键生成＝**真的换了一个模组**：AI 没给的东西一律留空，**一个字都不许回退到上一个模组**。
           *
           * 以前这里写的是 `data.X ?? gameModule.X`，于是模型只要漏一个字段
           * （它最常漏的正是 `start_location` 与 `map_nodes`），新模组就沿用旧模组的
           * 开局地点、地点表与地图 —— 主人 2026-09-20 实测到的
           * "开局显示角色在上个模组的地点（系统自动新建）"就是这样来的。
           * 缺了就是这一轮没生成好，串味比残缺更糟：残缺看得出来，串味要到玩进去才发现。
           */
          applyModule({
            title: data.title ?? '',
            premise: data.premise ?? '',
            opening: data.opening ?? '',
            startLocation: data.start_location ?? '',
            goal: data.goal ?? '',
            stakes: data.stakes ?? '',
            urgency: data.urgency ?? '',
            truth: data.truth ?? '',
            /*
             * P2-10 / H22：开局时刻与期限**由模型申报**（snake → camel）。
             * 校验要严：给的不是合法数字就当没给，退回引擎的默认值 ——
             * 宁可用上午九点，也不能让 `day:0 / minute:9999` 把时钟搞乱。
             */
            startClock: normalizeStartClock(data.start_clock),
            deadlineIn: normalizeDeadlineIn(data.deadline_in),
            worldbook: [],
            npcs: (data.npcs ?? [])
              .filter((n) => n?.name)
              .map((n) => ({
                id: uid(),
                name: n.name ?? '未命名',
                role: n.role ?? '',
                motive: n.motive ?? '',
                secret: n.secret ?? '',
                // 外貌锚点（阶段 2）：只写长相，供人物头像用；没给就不写这个键
                ...(n.appearance?.trim() ? { appearance: n.appearance.trim() } : {}),
              })),
            locations: data.locations ?? '',
            /*
             * 地图节点必须接住。
             * 提示词早就在要 map_nodes，但这里以前没把它写进模组，
             * 于是 AI 生成的模组永远没有"可达关系"，地图迷雾被整块关掉，
             * 开局就把所有地点摊开——这正是玩家报的"迷雾失效"。
             */
            mapNodes: (data.map_nodes ?? [])
              .filter((n) => n?.name)
              .map((n) => ({
                name: n.name!.trim(),
                links: (n.links ?? []).map((x) => String(x).trim()).filter(Boolean),
                note: n.note?.trim(),
              })),
            clueChain: data.clueChain ?? '',
            acts: data.acts ?? '',
            endings: data.endings ?? '',
            notes: data.notes ?? '',
            sourceNote: data.source_note ?? '',
          });

          /*
           * 🔴 `H23`：**第一通落盘了，但活还没干完** —— 这时候要改口，不能报"已生成"。
           * 第二通（世界书 + 队友）还要一分多钟，期间界面得一直写着还在忙。
           */
          onStage?.('模组已好，正在生成世界书与队友…（大约还要一分钟）');

          // 模组包：派生公开词条 + 队友候选。失败不影响骨架（但**失败要说出来**，见下面的 catch）
          try {
            const pack = await generateJson<{
              entries?: { keys?: string[]; content?: string; priority?: number }[];
              companions?: {
                name?: string;
                role?: string;
                bond?: string;
                personality?: string;
                secret?: string;
                agenda?: string;
                initiative?: string;
                skills?: Record<string, number>;
                vitals?: Record<string, number>;
              }[];
            }>(
              packSystemPrompt(genre, getRuleset(rulesetId)),
              JSON.stringify({
                title: data.title ?? gameModule.title,
                premise: data.premise ?? gameModule.premise,
                goal: data.goal ?? gameModule.goal,
                locations: data.locations ?? gameModule.locations,
                npcs: (data.npcs ?? []).map((n) => n.name).filter(Boolean),
                notes: data.notes ?? gameModule.notes,
              }),
              { ...config, maxTokens: 3072 }, signal
            );
            if (pack) {
              // 世界书：只替换 AI 派生的词条，用户手写的不动
              const generated = (pack.entries ?? [])
                .filter((e) => e.content)
                .map((e) => ({
                  id: uid(),
                  keys: e.keys?.length ? e.keys : [e.content!.slice(0, 6)],
                  content: e.content!,
                  priority: e.priority ?? 50,
                  enabled: true,
                  fromModule: true,
                }));
              if (generated.length) {
                /*
                 * 只保住**玩家自己手加**的那部分（判据在 `core/worldbook.ts`，与 `applyModule` 共用一份）。
                 * 以前这里只按 `!e.fromModule` 过滤，于是刚装上的 `mw-` 条目（模组自带的）
                 * 也被当成"手写"留了下来 —— 换模组时撤掉、紧接着又加回去，
                 * 这是"上个模组的地点没删"的第二个成因（第一个在 `applyModule` 里）。
                 */
                const manual = stripModuleWorldbook(useStore.getState().worldbook);
                useStore.getState().setWorldbookEntries([...manual, ...generated]);
              }

              // 队友候选：等玩家挑谁入队
              const candidates = (pack.companions ?? [])
                .filter((c) => c.name)
                .map((c) => {
                  const initiative: Companion['initiative'] =
                    c.initiative === 'balanced' || c.initiative === 'proactive'
                      ? c.initiative
                      : 'reactive';
                  return {
                    id: uid(),
                    name: c.name!,
                    role: c.role ?? '',
                    personality: c.personality ?? '',
                    secret: c.secret ?? '',
                    agenda: c.agenda ?? '',
                    bond: c.bond ?? '',
                    skills: c.skills ?? {},
                    vitals: c.vitals ?? { hp: 12, san: 60, mp: 10 },
                    initiative,
                    alive: true,
                    present: true,
                    met: false,
                    fromModule: true,
                  };
                });
              if (candidates.length) useStore.getState().setCompanionCandidates(candidates);
            } else {
              // 模型没给出可用的包（解析失败时 `generateJson` 返回 null）—— 同样是"配套没生成上"
              return modulePackPartialNote();
            }
          } catch (e) {
            /*
             * 🔴 `H23`：**配套那一通失败必须翻给人看**。
             *
             * 这一格以前是空 catch（"配套生成失败不影响模组本身"）—— 骨架确实还在，
             * 但玩家零提示，表现就是「已生成，记得检查并微调」+ 世界书空的 + 同行者没有
             * （主人原话）。与 P1-2 同族：**失败要可见**，哪怕它不影响主体。
             */
            if (signal?.aborted) {
              return modulePackStoppedNote();
            }
            return modulePackPartialNote(
              e instanceof ModelError ? e.message : (e as Error).message
            );
          }
        }}
      />

      <div className="rounded-lg border border-ink-700 bg-ink-850/50 p-2.5">
        <div className="mb-1.5 flex items-center justify-between gap-2">
          <span className="text-[11px] text-mist-400">
            从文本导入{' '}
            <span className="text-mist-500">（贴模组原文 / 梗概 / 设定，AI 整理成卡）</span>
          </span>
          {importOpen && (
            <button
              onClick={() => {
                setImportOpen(false);
                setImportText('');
              }}
              className="shrink-0 text-[11px] text-mist-500 hover:text-mist-300"
            >
              收起
            </button>
          )}
        </div>
        {!importOpen ? (
          <button
            onClick={() => setImportOpen(true)}
            className="w-full rounded-md border border-ink-600 py-1.5 text-[12px] text-mist-400 transition hover:border-gold-600/50 hover:text-mist-100"
          >
            粘贴文本…
          </button>
        ) : (
          <div className="space-y-2">
            <textarea
              className={`${inputCls} min-h-[120px] resize-y`}
              value={importText}
              onChange={(e) => setImportText(e.target.value)}
              placeholder="把模组原文、故事梗概、设定资料贴进来……（越长越准，几百字就够）"
            />
            <button
              disabled={importing || !importText.trim()}
              onClick={async () => {
                if (!importText.trim()) return;
                setImporting(true);
                setImportErr('');
                // H24：这条是第 12 轮实测卡了 200 秒的那条（A11），超时兜底必须装上
                const t = genTimeout();
                try {
                  const data = await generateJson<{
                    title?: string;
                    premise?: string;
                    opening?: string;
                    start_location?: string;
                    goal?: string;
                    stakes?: string;
                    urgency?: string;
                    truth?: string;
                    npcs?: { name?: string; role?: string; motive?: string; secret?: string; appearance?: string }[];
                    locations?: string;
                    map_nodes?: { name?: string; links?: string[]; note?: string }[];
                    clueChain?: string;
                    acts?: string;
                    endings?: string;
                    notes?: string;
                    source_note?: string;
                    start_clock?: { day?: number; minute?: number };
                    deadline_in?: number;
                  }>(
                    importSystemPrompt(genre),
                    `请把下面这段文本整理成模组卡：\n\n${importText.trim()}`,
                    { ...config, maxTokens: 3072 },
                    t.signal
                  );
                  if (!data) throw new Error('模型没有返回合法 JSON，请重试');
                  // 同样是"真的换了模组"——走 applyModule，自带世界书一起装上
                  // 与「AI 一键生成」同一条规矩：导入＝换模组，没给的就留空，不回退上一个模组
                  applyModule({
                    title: data.title ?? '',
                    premise: data.premise ?? '',
                    opening: data.opening ?? '',
                    startLocation: data.start_location ?? '',
                    goal: data.goal ?? '',
                    stakes: data.stakes ?? '',
                    urgency: data.urgency ?? '',
                    truth: data.truth ?? '',
                    startClock: normalizeStartClock(data.start_clock),
                    deadlineIn: normalizeDeadlineIn(data.deadline_in),
                    worldbook: [],
                    npcs: (data.npcs ?? [])
                      .filter((n) => n?.name)
                      .map((n) => ({
                        id: uid(),
                        name: n.name ?? '未命名',
                        role: n.role ?? '',
                        motive: n.motive ?? '',
                        secret: n.secret ?? '',
                        // 外貌锚点（阶段 2）：同上，只写长相
                        ...(n.appearance?.trim() ? { appearance: n.appearance.trim() } : {}),
                      })),
                    locations: data.locations ?? '',
                    // 同上：地图节点要接住，否则地图迷雾没法工作
                    mapNodes: (data.map_nodes ?? [])
                      .filter((n) => n?.name)
                      .map((n) => ({
                        name: n.name!.trim(),
                        links: (n.links ?? []).map((x) => String(x).trim()).filter(Boolean),
                        note: n.note?.trim(),
                      })),
                    clueChain: data.clueChain ?? '',
                    acts: data.acts ?? '',
                    endings: data.endings ?? '',
                    notes: data.notes ?? '',
                    sourceNote: data.source_note ?? '',
                  });
                  setImportText('');
                  setImportOpen(false);
                } catch (e) {
                  setImportErr(
                    t.signal.aborted
                      ? '整理时间太长，已经停下了（你贴的原文还在）。可以重试一次。'
                      : e instanceof Error
                        ? e.message
                        : String(e)
                  );
                } finally {
                  t.done();
                  setImporting(false);
                }
              }}
              className="w-full rounded-lg bg-gold-500 px-3 py-1.5 text-[12px] font-medium text-ink-950 transition hover:bg-gold-400 disabled:opacity-40"
            >
              {importing ? '整理中…' : '整理成模组卡'}
            </button>
            {importErr && <p className="text-[11px] text-blood-400">{importErr}</p>}
          </div>
        )}
      </div>
    </div>
  );
}

/** 履历里的短日期：`9月17日 20:41`（本地时区；认不出来就把原文还回去） */
function shortDate(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  const hh = `${d.getHours()}`.padStart(2, '0');
  const mm = `${d.getMinutes()}`.padStart(2, '0');
  return `${d.getMonth() + 1}月${d.getDate()}日 ${hh}:${mm}`;
}

/**
 * 「世界」一页（Phase 2）。
 *
 * 这里放的是**跨局留存**的两样东西：**世界**与**角色档案库**。
 * 它们都不在单局存档里 —— 开新团清的是这一局的剧情，
 * 而"这个世界记得什么""我捏过哪几张卡"该一直留着。
 *
 * 界面上只做两件事：**让玩家看得见会带什么过去**，以及**随时能反悔**。
 */
function WorldTab() {
  const worlds = useStore((s) => s.worlds);
  const worldName = useStore((s) => s.worldName);
  const setWorldName = useStore((s) => s.setWorldName);
  const carryWorld = useStore((s) => s.carryWorld);
  const setCarryWorld = useStore((s) => s.setCarryWorld);
  const forgetWorld = useStore((s) => s.forgetWorld);
  const moduleTitle = useStore((s) => s.module.title);
  const rulesetId = useStore((s) => s.rulesetId);
  const archive = useStore((s) => s.characterArchive);
  const character = useStore((s) => s.character);
  const archiveCurrent = useStore((s) => s.archiveCurrentCharacter);
  const useArchived = useStore((s) => s.useArchivedCharacter);
  const deleteArchived = useStore((s) => s.deleteArchivedCharacter);
  const [msg, setMsg] = useState('');

  /*
   * 派生数据都包 useMemo（WorldPanel 那条教训）：
   * 排序 / 找留档 / 拼预览在长局里同样是每帧重算的活儿。
   */
  const all = useMemo(() => listWorlds(worlds), [worlds]);
  const effective = worldName.trim() || defaultWorldName(moduleTitle);
  const current = useMemo(() => findWorld(all, effective), [all, effective]);
  const preview = useMemo(() => carryPreview(current), [current]);
  const cards = useMemo(() => listArchive(archive), [archive]);

  const flash = (t: string) => {
    setMsg(t);
    setTimeout(() => setMsg(''), 2400);
  };

  return (
    <div className="space-y-6">
      {/* ── 世界名 ──────────────────────────────────────────── */}
      <Area
        label="这一局的世界"
        hint="留空就跟着模组名走 · 换个名字就换一个世界（新名字底下是空的，不会串到别的世界）"
        rows={1}
        value={worldName}
        onChange={setWorldName}
        placeholder={defaultWorldName(moduleTitle)}
      />

      {all.length > 0 && (
        <div>
          <p className="mb-1.5 text-[11px] text-mist-400">
            已经有留档的世界 <span className="text-mist-500">（点一下切过去）</span>
          </p>
          <div className="flex flex-wrap gap-1.5">
            {all.map((w) => (
              <button
                key={w.id}
                onClick={() => setWorldName(w.name)}
                className={`rounded-full border px-2.5 py-1 text-[11px] transition ${
                  w.id === current?.id
                    ? 'border-gold-600/70 bg-gold-500/10 text-gold-300'
                    : 'border-ink-600 text-mist-400 hover:border-gold-600/40 hover:text-mist-200'
                }`}
              >
                {w.name}
                <span className="ml-1 text-mist-500">{w.runs.length} 局</span>
              </button>
            ))}
          </div>
        </div>
      )}

      {/* ── 接着上一次跑 ────────────────────────────────────── */}
      <div className="rounded-lg border border-ink-700 bg-ink-850/40 p-3">
        <div className="flex items-center justify-between gap-3">
          <div className="min-w-0">
            <p className="text-[12px] text-mist-100">接着上一次跑</p>
            <p className="mt-0.5 text-[10px] leading-relaxed text-mist-500">
              开团时把上个故事留下的东西带进来：去过的地方、还活着的人、没办完的事。
            </p>
          </div>
          <button
            onClick={() => setCarryWorld(!carryWorld)}
            className={`shrink-0 rounded-lg border px-3 py-1.5 text-[12px] transition ${
              carryWorld
                ? 'border-gold-600/70 bg-gold-500/10 text-gold-300'
                : 'border-ink-600 text-mist-400 hover:text-mist-200'
            }`}
          >
            {carryWorld ? '开着' : '关着'}
          </button>
        </div>

        {preview ? (
          <ul className="mt-3 space-y-1 border-t border-ink-700 pt-2.5 text-[11px] leading-relaxed text-mist-300">
            <li>
              <span className="text-mist-500">上次最后的落脚点：</span>
              {preview.location || preview.fallbackLocation}
            </li>
            <li>
              <span className="text-mist-500">这个世界还记得的人：</span>
              {preview.npcs.length === 0 ? (
                <span className="text-mist-500">（没有记下谁）</span>
              ) : (
                <>
                  {preview.npcs.join('、')}
                  {preview.npcsMore > 0 ? ` 等 ${preview.npcs.length + preview.npcsMore} 人` : ''}
                </>
              )}
            </li>
            <li>
              <span className="text-mist-500">还挂着的事：</span>
              {preview.threads.length === 0 ? (
                <span className="text-mist-500">（上一局的事了结了）</span>
              ) : (
                preview.threads.map((t) => t.name).join('、')
              )}
            </li>
          </ul>
        ) : (
          <p className="mt-3 border-t border-ink-700 pt-2.5 text-[11px] leading-relaxed text-mist-500">
            这个世界还没有留档 —— 跑完一局之后才有东西可带。
            身上带的东西、伤势、疯狂不会带过去：那些是上一局的事，不是世界的事。
          </p>
        )}

        {current && (
          <div className="mt-3 flex flex-wrap items-center gap-3 border-t border-ink-700 pt-2.5">
            <span className="text-[11px] text-mist-500">
              这个世界跑过 <span className="text-mist-200">{current.runs.length}</span> 局
            </span>
            {current.runs.length > 0 && (
              <button
                onClick={() => {
                  forgetWorld(current.id);
                  flash('已忘掉这个世界的留档');
                }}
                className="rounded-md border border-blood-700/60 px-2 py-1 text-[11px] text-blood-300 transition hover:bg-blood-700/15"
              >
                忘掉这个世界的留档
              </button>
            )}
          </div>
        )}

        {current && current.runs.length > 0 && (
          <ul className="mt-2 space-y-1">
            {current.runs.slice(0, 4).map((r) => (
              <li key={r.at} className="flex items-baseline gap-2 text-[11px] text-mist-400">
                <span className="shrink-0 text-mist-500">{shortDate(r.at)}</span>
                <span className="min-w-0 flex-1 truncate">{runLabel(r)}</span>
                <span className="shrink-0 text-mist-500">{r.turns} 回</span>
              </li>
            ))}
          </ul>
        )}
        {msg && <p className="mt-2 text-[11px] text-moss-400">{msg}</p>}
      </div>

      {/* ── 角色档案库 ─────────────────────────────────────── */}
      <div className="rounded-lg border border-ink-700 bg-ink-850/40 p-3">
        <div className="flex items-center justify-between gap-3">
          <div className="min-w-0">
            <p className="text-[12px] text-mist-100">角色档案库</p>
            <p className="mt-0.5 text-[10px] leading-relaxed text-mist-500">
              把捏好的人存下来，换团也丢不了。同一个名字再存一次，就是更新那张卡。
            </p>
          </div>
          <button
            onClick={() => {
              const { replaced } = archiveCurrent();
              flash(replaced ? `已更新《${character.name}》` : `已存下《${character.name}》`);
            }}
            className={smallBtn}
          >
            存下当前这张
          </button>
        </div>

        {cards.length === 0 ? (
          <p className="mt-3 border-t border-ink-700 pt-2.5 text-[11px] text-mist-500">
            档案库还是空的。
          </p>
        ) : (
          <ul className="mt-3 space-y-2 border-t border-ink-700 pt-2.5">
            {cards.map((c) => (
              <li key={c.id} className="flex items-start gap-2">
                <div className="min-w-0 flex-1">
                  <p className="text-[12px] text-mist-200">{c.name}</p>
                  <p className="mt-0.5 text-[10px] leading-snug text-mist-500">
                    {archiveBlurb(c)}
                  </p>
                  {!matchesRuleset(c, rulesetId) && (
                    <p className="mt-0.5 text-[10px] text-gold-400">
                      这张卡是按另一个规则包捏的，技能名可能对不上。
                    </p>
                  )}
                </div>
                <button
                  onClick={() => {
                    if (useArchived(c.id)) flash(`已换成《${c.name}》`);
                  }}
                  className={smallBtn}
                >
                  用这张
                </button>
                <button
                  onClick={() => deleteArchived(c.id)}
                  className="shrink-0 rounded-lg border border-ink-600 px-2 py-1.5 text-[12px] text-mist-500 transition hover:border-blood-700/60 hover:text-blood-300"
                >
                  删
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>

      <p className="text-[10px] leading-relaxed text-mist-500">
        这两样都存在单局存档之外：开新团不会清掉它们，回溯更不会。
      </p>
    </div>
  );
}

const TABS = [
  { id: 'module', label: '模组' },
  { id: 'character', label: '角色卡' },
  { id: 'companions', label: '同行者' },
  { id: 'worldbook', label: '世界书' },
  { id: 'world', label: '世界' },
] as const;

export function Preparation({
  onClose,
  onStartNew,
  initialTab,
}: {
  onClose: () => void;
  onStartNew: () => void;
  /**
   * 打开时默认停在哪个页签（缺省＝角色卡）。
   *
   * 存在的理由有两个，都不是"灵活"：
   * ① 冒烟测试要能**直接渲染「世界」那一页** —— 弹层界面 `--dump-dom` 抓不到，
   *    只渲染默认页签等于没测到新加的界面（0.3.0 白屏那次的教训）；
   * ② 以后从结档页点"开新团"进来时，可以顺势落在该看的页签上。
   */
  initialTab?: (typeof TABS)[number]['id'];
}) {
  const [tab, setTab] = useState<(typeof TABS)[number]['id']>(initialTab ?? 'character');
  const { genre, all } = useGenre();
  const genreId = useStore((s) => s.genreId);
  const setGenre = useStore((s) => s.setGenre);
  const rulesetId = useStore((s) => s.rulesetId);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-ink-950/80 p-4 backdrop-blur-sm">
      <div className="flex max-h-[88vh] w-full max-w-xl flex-col overflow-hidden rounded-2xl border border-ink-600 bg-ink-900">
        <div className="relative flex shrink-0 items-center justify-between overflow-hidden border-b border-ink-700 px-5 py-3">
          {/*
           * 🔴 这里原来铺着一张"书桌一角"的题图（生图），**已撤**（2026-10-04）。
           *
           * 两条理由，记下来免得下次又加回来：
           * 1. 主人 2026-10-02：「**右边无意义的花纹占用版面了**」——
           *    从 85% 收到 42% 也仍然占着右边那一块（「完成」按钮就在那儿）；
           * 2. 它的性质是**装饰**，而装饰不该生图（主人 2026-10-04：
           *    「目前的美术我没看到需要调用生图额度的质量」）。
           *
           * 页头现在只有标题与「完成」—— **装饰让位给内容**。
           * 详见 `docs/报告/方案-美术资产路数重定.md`。
           */}
          <h2 className="relative font-serif text-lg text-mist-100">前期准备</h2>
          <button
            onClick={onClose}
            className="relative rounded-md px-2 py-1 text-[13px] text-mist-500 transition hover:text-mist-200"
          >
            完成
          </button>
        </div>

        <div className="flex shrink-0 gap-1 border-b border-ink-700 px-3 pt-2">
          {TABS.map((t) => (
            <button
              key={t.id}
              onClick={() => setTab(t.id)}
              className={`rounded-t-lg px-3 py-2 text-[12px] transition ${
                tab === t.id
                  ? 'border-b-2 border-gold-500 text-mist-100'
                  : 'text-mist-500 hover:text-mist-300'
              }`}
            >
              {t.label}
            </button>
          ))}
        </div>

        {/* 题材选择：换题材 = 换这一局的味道（写法 / 画风 / 队友倾向），与规则包各自独立 */}
        <div className="flex shrink-0 flex-wrap items-center gap-x-2 gap-y-1.5 border-b border-ink-700 px-5 py-2">
          <span className="text-[11px] text-mist-500">题材</span>
          <div className="flex flex-wrap gap-1">
            {all.map((g) => (
              <button
                key={g.id}
                onClick={() => setGenre(g.id)}
                title={g.blurb}
                className={`rounded-full border px-2 py-0.5 text-[11px] transition ${
                  genreId === g.id
                    ? 'border-gold-600/70 bg-gold-500/10 text-gold-300'
                    : 'border-ink-600 text-mist-400 hover:border-gold-600/40 hover:text-mist-200'
                }`}
              >
                {g.name}
              </button>
            ))}
          </div>
          <span className="ml-auto shrink-0 text-[10px] text-mist-500">
            规则：{getRuleset(rulesetId).name}
          </span>
          {/*
           * E3（主人 2026-09-24 点头）：解释「题材」与「描述」各管什么。
           *
           * 没有这句，玩家会把"我想要赛博朋克"写进描述里 —— 然后被题材（克苏鲁）盖掉，
           * 他完全不知道为什么。**想换世界，出路是改题材，不是写在描述里。**
           *
           * 措辞是主人定的：描述那一栏＝**写你想要一个什么样的故事**（第二人称，对玩家说）。
           */}
          <p className="w-full text-[10px] leading-relaxed text-mist-500">
            题材决定这个<strong className="text-mist-400">世界</strong>长什么样；下面的描述就写你
            <strong className="text-mist-400">想要一个什么样的故事</strong>——
            里面的人名、地名、点子都会保留下来，并翻译进这个世界。想换个世界，改上面的题材。
          </p>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto p-5">
          {tab === 'module' && <ModuleTab />}
          {tab === 'character' && <CharacterTab />}
          {tab === 'companions' && <CompanionsTab />}
          {tab === 'worldbook' && <WorldbookTab />}
          {tab === 'world' && <WorldTab />}
        </div>

        <div className="shrink-0 border-t border-ink-700 px-5 py-3">
          <button
            onClick={onStartNew}
            className="w-full rounded-lg bg-gold-500 py-2.5 text-[13px] font-medium text-ink-950 transition hover:bg-gold-400"
          >
            用这个模组开团
          </button>
          <p className="mt-1.5 text-center text-[10px] text-mist-500">
            会清空当前剧情与线索，按上面的模组和角色卡从头开始
          </p>
        </div>
      </div>
    </div>
  );
}
