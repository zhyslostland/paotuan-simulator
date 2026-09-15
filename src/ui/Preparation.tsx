import { useEffect, useState } from 'react';
import { useStore, deriveAddress, addressOf, defaultCharacteristics, skillBudget, BUILTIN_MODULES, starterCharacterOf, type CharacterProfile, type Companion, type ModuleItem, type ModuleNpc, type WorldbookEntry } from './store';
import { getRuleset } from '../core/rulesets/index.js';
import type { Ruleset } from '../core/rulesets/types.js';
import { getGenre, listGenres, type Genre } from '../core/genres.js';
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
  SCALE_LABEL,
  type ModuleScale,
} from '../orchestrator/generate.js';
import { ModelError } from '../providers/model.js';
import { extractCharacterCard } from './charCard.js';

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
                  ? 'border-ink-700 text-mist-500/40'
                  : 'border-ink-600 text-mist-300 hover:border-gold-600/50 hover:text-mist-100'
              }`}
            >
              <span className="truncate">{c.name}</span>
              <span className="shrink-0 tabular-nums text-[11px] text-gold-500/70">
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
      <p className="mt-2 text-[10px] leading-relaxed text-mist-500/80">
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
      <p className="mt-1 text-[10px] leading-relaxed text-mist-500/80">
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
      <p className="mt-1 text-[10px] leading-relaxed text-mist-500/80">
        技能点＝技能值减掉基础值后的投入。剩余不够时，加点会自动封顶。
      </p>
    </div>
  );
}

function AiGenBox({
  label,
  placeholder,
  onGenerate,
}: {
  label: string;
  placeholder: string;
  onGenerate: (desc: string) => Promise<void>;
}) {
  const [open, setOpen] = useState(false);
  const [desc, setDesc] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [ok, setOk] = useState('');

  const run = async () => {
    setBusy(true);
    setErr('');
    setOk('');
    try {
      await onGenerate(desc.trim());
      setOk('已生成，记得检查并微调');
      setDesc('');
    } catch (e) {
      setErr(e instanceof ModelError ? e.message : `生成失败：${(e as Error).message}`);
    } finally {
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
            {err && <span className="text-[11px] text-blood-400">{err}</span>}
            {ok && <span className="text-[11px] text-moss-400">{ok}</span>}
          </div>
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
              const skills = Object.fromEntries(
                (rs.starterSkills ?? []).map((sk) => [sk.name, sk.value])
              );
              setCharacter({
                ...starter,
                address: undefined,
                // 数值层按当前规则包重建，别沿用别的规则的数字
                characteristics: defaultCharacteristics(rulesetId),
                skills,
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
        <span className="text-[10px] text-mist-500/70">
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
          称呼 <span className="text-mist-500/70">（NPC 怎么叫你，留空按姓名+性别推导）</span>
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
          描述 <span className="text-mist-500/70">（外貌、年龄、职业、来历）</span>
        </span>
        <textarea
          className={`${inputCls} resize-none`}
          rows={3}
          value={character.description}
          onChange={(e) => setCharacter({ description: e.target.value })}
        />
      </label>

      <ImageField
        label="角色立绘"
        prompt={characterImagePrompt(character, genre)}
        value={character.portrait}
        onSave={(url) => setCharacter({ portrait: url })}
        onClear={() => setCharacter({ portrait: '' })}
      />

      <label className="block">
        <span className="mb-1 block text-[11px] text-mist-400">
          性格 <span className="text-mist-500/70">（说话方式、弱点、在意什么）</span>
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
          对话示例 <span className="text-mist-500/70">（可选，给 GM 参考你说话的风格）</span>
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
        <div className="mb-1.5 flex items-center justify-between">
          <span className="text-[11px] text-mist-400">
            属性 <span className="text-mist-500/70">（由规则包「{rs.name}」定义）</span>
          </span>
          <button
            onClick={() => setCharacter({ characteristics: defaultCharacteristics(rulesetId) })}
            className="text-[11px] text-gold-400 hover:text-gold-500"
          >
            重置
          </button>
        </div>
        <div className="grid grid-cols-4 gap-2">
          {rs.characteristicDefs.map((d) => (
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
                value={character.characteristics[d.key] ?? d.default}
                onChange={(e) =>
                  setCharacter({
                    characteristics: {
                      ...character.characteristics,
                      // 清空时回落到默认值；store 里还会再按 min/max 夹一次
                      [d.key]: e.target.value === '' ? d.default : Number(e.target.value),
                    },
                  })
                }
                title={`范围 ${d.min}–${d.max}`}
              />
            </label>
          ))}
        </div>
        {/* 派生数值：属性一变，血/蓝/理智/伤害加成自动跟着算 */}
        <DerivedPreview characteristics={character.characteristics} rs={rs} />
      </div>

      <div>
        <div className="mb-1.5 flex items-center justify-between gap-2">
          <span className="text-[11px] text-mist-400">
            技能 <span className="text-mist-500/70">（数值＝成功率，越高越好）</span>
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
          随身物品 <span className="text-mist-500/70">（每行一件，开团时会放进背包）</span>
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
        onGenerate={async (desc) => {
          const data = await generateJson<{
            name?: string;
            gender?: string;
            description?: string;
            personality?: string;
            scenario?: string;
            characteristics?: Record<string, number>;
            skills?: Record<string, number>;
            items?: (
              | string
              | { name?: string; desc?: string; kind?: string; damage?: string; skill?: string }
            )[];
          }>(
            characterSystemPrompt(genre, rs),
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
            }
          );
          if (!data) throw new Error('模型没有返回合法 JSON，请重试或换个描述');
          // 物品：兼容"字符串数组"（旧格式/模型偷懒）与"对象数组"（带简介与武器属性）
          const rawItems = data.items ?? [];
          const items = rawItems
            .map((it) => (typeof it === 'string' ? it.trim() : (it?.name ?? '').trim()))
            .filter(Boolean);
          const itemDetails = rawItems
            .filter(
              (it): it is { name?: string; desc?: string; kind?: string; damage?: string; skill?: string } =>
                typeof it === 'object' && it !== null
            )
            .map((it) => ({
              name: (it.name ?? '').trim(),
              desc: it.desc?.trim(),
              kind: it.kind?.trim(),
              damage: it.damage?.trim(),
              skill: it.skill?.trim(),
            }))
            .filter((d) => d.name);
          setCharacter({
            name: data.name ?? character.name,
            gender: data.gender ?? character.gender,
            // 清掉旧的称呼，让它按新姓名/性别重新推导
            address: undefined,
            description: data.description ?? character.description,
            personality: data.personality ?? character.personality,
            scenario: data.scenario ?? character.scenario,
            characteristics: {
              ...character.characteristics,
              ...(data.characteristics ?? {}),
            },
            skills: data.skills ?? character.skills,
            items: items.length ? items : character.items,
            itemDetails: itemDetails.length ? itemDetails : character.itemDetails,
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
              <ImageField
                label="队友头像"
                prompt={characterImagePrompt(
                  {
                    name: c.name,
                    description: `${c.role}。${c.personality}`,
                  },
                  genre
                )}
                value={c.portrait}
                onSave={(url) => patch(c, { portrait: url })}
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
        onGenerate={async (desc) => {
          const data = await generateJson<{
            name?: string;
            role?: string;
            personality?: string;
            initiative?: Companion['initiative'];
            skills?: Record<string, number>;
            vitals?: Record<string, number>;
          }>(companionSystemPrompt(genre, getRuleset(rulesetId)), desc || `请自由创作一名适合「${genre.name}」题材的随行同伴。`, {
            ...config,
            maxTokens: 2048,
          });
          if (!data?.name) throw new Error('模型没有返回合法 JSON，请重试');
          upsert({
            id: uid(),
            name: data.name,
            role: data.role ?? '身份未定',
            personality: data.personality ?? '',
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
        onGenerate={async (desc) => {
          const data = await generateJson<
            { keys?: string[]; content?: string; priority?: number }[]
          >(
            worldbookSystemPrompt(genre),
            desc || `请围绕「${genre.name}」题材自由创作几个世界设定条目。`,
            { ...config, maxTokens: 3072 }
          );
          if (!Array.isArray(data) || data.length === 0)
            throw new Error('模型没有返回合法的条目数组，请重试');
          for (const item of data) {
            if (!item.content) continue;
            upsert({
              id: uid(),
              keys: item.keys?.length ? item.keys : [item.content.slice(0, 6)],
              content: item.content,
              priority: item.priority ?? 50,
              enabled: true,
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
        {label} {hint && <span className="text-mist-500/70">{hint}</span>}
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
  const clearModuleDerived = useStore((s) => s.clearModuleDerived);
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
    try {
      const data = await generateJson<{
        items?: { name?: string; look?: string; effect?: string; kind?: string }[];
      }>(
        itemTableSystemPrompt(genre, gameModule, getRuleset(rulesetId)),
        `请为这个模组设计一张道具表：${gameModule.title}\n\n${gameModule.premise}`,
        { ...config, maxTokens: 2048 }
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
      setGenItemsErr(e instanceof ModelError ? e.message : `生成失败：${(e as Error).message}`);
    } finally {
      setGenItemsBusy(false);
    }
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
        { id: uid(), name: '新人物', role: '', motive: '', secret: '' },
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
              (n) => `- **${n.name}**（${n.role}）\n  - 动机：${n.motive || '未定'}\n  - 秘密：${n.secret || '无'}`
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
          内置模组 <span className="text-mist-500/70">（一键套用成品模组）</span>
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
                    setModule({ ...m, npcs: m.npcs.map((n) => ({ ...n, id: uid() })) });
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
                  {match && <span className="ml-1 text-[9px] text-gold-500/80">适配</span>}
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
          篇幅 <span className="text-mist-500/70">（决定时间尺度与规模，生成时生效）</span>
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
        <p className="mt-1 text-[10px] leading-relaxed text-mist-500/70">
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
          开局地点 <span className="text-mist-500/70">（第一幕玩家身处何处；开团即写进"当前地点"）</span>
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
          <span className="text-gold-500/70">
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
            <span className="text-mist-500/70">
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
            关键人物 <span className="text-mist-500/70">（动机与秘密不会告诉玩家）</span>
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
       * 道具表：**作用单独生成**。
       * 和「怪物设定页」同一个思路——能用独立步骤生成的，就别混在一次生成里。
       * 塞进角色生成时模型一次要想太多东西，结果物品说明短、作用含糊，
       * 玩家捡到一件东西只有个名字，不知道能干嘛。
       */}
      <div className="rounded-lg border border-ink-700 bg-ink-850/40 p-3">
        <div className="flex items-center justify-between gap-2">
          <div>
            <span className="text-[11px] text-mist-400">道具表</span>
            <span className="ml-1.5 text-[10px] text-mist-500/70">
              （这个模组里会出现的东西；作用写好后，玩家拾取时自动带进背包）
            </span>
          </div>
          <button
            onClick={genItems}
            disabled={genItemsBusy}
            className="shrink-0 rounded-md border border-gold-600/50 px-2.5 py-1 text-[11px] text-gold-400 transition hover:bg-gold-500/10 disabled:opacity-50"
            title="单独生成一次道具表：只做这一件事，所以作用写得比混在角色生成里准确得多"
          >
            {genItemsBusy ? '生成中…' : '生成道具表'}
          </button>
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

      <p className="text-[10px] leading-relaxed text-mist-500/80">
        一次生成：模组骨架 + 世界书词条（只含公开事实、不剧透）+ 3-4 个队友候选（到「同行者」里挑）。
        生成后会在上方标注<b className="text-mist-300">来源</b>——按原版还原、还是 AI 自创，一眼便知。
      </p>

      <AiGenBox
        label={canonical ? 'AI 生成模组包（按原版）' : 'AI 生成模组包'}
        placeholder="例如：敦威治恐怖事件　或　1920 年代新英格兰，一名摄影师在小镇失踪"
        onGenerate={async (desc) => {
          const data = await generateJson<{
            title?: string;
            premise?: string;
            opening?: string;
            start_location?: string;
            truth?: string;
            goal?: string;
            stakes?: string;
            urgency?: string;
            npcs?: { name?: string; role?: string; motive?: string; secret?: string }[];
            locations?: string;
            map_nodes?: { name?: string; links?: string[]; note?: string }[];
            clueChain?: string;
            acts?: string;
            endings?: string;
            notes?: string;
            source_note?: string;
          }>(
            // 篇幅决定时间尺度：短篇以小时计，长篇以周/月计（否则一律被压成 15 分钟）
            moduleSystemPrompt(genre, getRuleset(rulesetId), gameModule.scale ?? 'short'),
            moduleUserPrompt(desc, canonical, genre),
            {
              ...config,
              // 长篇要给得下分章的幕结构与 8-12 个地点，token 不够会截断
              maxTokens: (gameModule.scale ?? 'short') === 'long' ? 6144 : 3072,
            }
          );
          if (!data) throw new Error('模型没有返回合法 JSON，请重试');
          setModule({
            title: data.title ?? gameModule.title,
            premise: data.premise ?? gameModule.premise,
            opening: data.opening ?? gameModule.opening,
            startLocation: data.start_location ?? gameModule.startLocation,
            goal: data.goal ?? gameModule.goal,
            stakes: data.stakes ?? gameModule.stakes,
            urgency: data.urgency ?? gameModule.urgency,
            truth: data.truth ?? gameModule.truth,
            npcs: data.npcs?.length
              ? data.npcs.map((n) => ({
                  id: uid(),
                  name: n.name ?? '未命名',
                  role: n.role ?? '',
                  motive: n.motive ?? '',
                  secret: n.secret ?? '',
                }))
              : gameModule.npcs,
            locations: data.locations ?? gameModule.locations,
            /*
             * 地图节点必须接住。
             * 提示词早就在要 map_nodes，但这里以前没把它写进模组，
             * 于是 AI 生成的模组永远没有"可达关系"，地图迷雾被整块关掉，
             * 开局就把所有地点摊开——这正是玩家报的"迷雾失效"。
             */
            mapNodes: data.map_nodes?.length
              ? data.map_nodes
                  .filter((n) => n.name)
                  .map((n) => ({
                    name: n.name!.trim(),
                    links: (n.links ?? []).map((x) => String(x).trim()).filter(Boolean),
                    note: n.note?.trim(),
                  }))
              : gameModule.mapNodes,
            clueChain: data.clueChain ?? gameModule.clueChain,
            acts: data.acts ?? gameModule.acts,
            endings: data.endings ?? gameModule.endings,
            notes: data.notes ?? gameModule.notes,
            sourceNote: data.source_note ?? gameModule.sourceNote,
          });
          /*
           * 模组**真的换了**才清上一套模组的派生数据（世界书 fromModule 条目 + 队友候选）。
           * 触发点只有这里、下面"贴文本导入"、以及应用整套预设三处；
           * 开新团与读档都不清（协作方 N2）。
           */
          clearModuleDerived();

          // 模组包：派生公开词条 + 队友候选。失败不影响已生成的模组。
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
              { ...config, maxTokens: 3072 }
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
                const manual = useStore.getState().worldbook.filter((e) => !e.fromModule);
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
            }
          } catch {
            /* 配套生成失败不影响模组本身 */
          }
        }}
      />

      <div className="rounded-lg border border-ink-700 bg-ink-850/50 p-2.5">
        <div className="mb-1.5 flex items-center justify-between gap-2">
          <span className="text-[11px] text-mist-400">
            从文本导入{' '}
            <span className="text-mist-500/70">（贴模组原文 / 梗概 / 设定，AI 整理成卡）</span>
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
                    npcs?: { name?: string; role?: string; motive?: string; secret?: string }[];
                    locations?: string;
                    map_nodes?: { name?: string; links?: string[]; note?: string }[];
                    clueChain?: string;
                    acts?: string;
                    endings?: string;
                    notes?: string;
                    source_note?: string;
                  }>(
                    importSystemPrompt(genre),
                    `请把下面这段文本整理成模组卡：\n\n${importText.trim()}`,
                    { ...config, maxTokens: 3072 }
                  );
                  if (!data) throw new Error('模型没有返回合法 JSON，请重试');
                  setModule({
                    title: data.title ?? gameModule.title,
                    premise: data.premise ?? gameModule.premise,
                    opening: data.opening ?? gameModule.opening,
                    startLocation: data.start_location ?? gameModule.startLocation,
                    goal: data.goal ?? gameModule.goal,
                    stakes: data.stakes ?? gameModule.stakes,
                    urgency: data.urgency ?? gameModule.urgency,
                    truth: data.truth ?? gameModule.truth,
                    npcs: data.npcs?.length
                      ? data.npcs.map((n) => ({
                          id: uid(),
                          name: n.name ?? '未命名',
                          role: n.role ?? '',
                          motive: n.motive ?? '',
                          secret: n.secret ?? '',
                        }))
                      : gameModule.npcs,
                    locations: data.locations ?? gameModule.locations,
                    // 同上：地图节点要接住，否则地图迷雾没法工作
                    mapNodes: data.map_nodes?.length
                      ? data.map_nodes
                          .filter((n) => n.name)
                          .map((n) => ({
                            name: n.name!.trim(),
                            links: (n.links ?? []).map((x) => String(x).trim()).filter(Boolean),
                            note: n.note?.trim(),
                          }))
                      : gameModule.mapNodes,
                    clueChain: data.clueChain ?? gameModule.clueChain,
                    acts: data.acts ?? gameModule.acts,
                    endings: data.endings ?? gameModule.endings,
                    notes: data.notes ?? gameModule.notes,
                    sourceNote: data.source_note ?? gameModule.sourceNote,
                  });
                  // 同样是"真的换了模组"这一步才清派生数据
                  clearModuleDerived();
                  setImportText('');
                  setImportOpen(false);
                } catch (e) {
                  setImportErr(e instanceof Error ? e.message : String(e));
                } finally {
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

const TABS = [
  { id: 'module', label: '模组' },
  { id: 'character', label: '角色卡' },
  { id: 'companions', label: '同行者' },
  { id: 'worldbook', label: '世界书' },
] as const;

export function Preparation({
  onClose,
  onStartNew,
}: {
  onClose: () => void;
  onStartNew: () => void;
}) {
  const [tab, setTab] = useState<(typeof TABS)[number]['id']>('character');
  const { genre, all } = useGenre();
  const genreId = useStore((s) => s.genreId);
  const setGenre = useStore((s) => s.setGenre);
  const rulesetId = useStore((s) => s.rulesetId);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-ink-950/80 p-4 backdrop-blur-sm">
      <div className="flex max-h-[88vh] w-full max-w-xl flex-col overflow-hidden rounded-2xl border border-ink-600 bg-ink-900">
        <div className="flex shrink-0 items-center justify-between border-b border-ink-700 px-5 py-3">
          <h2 className="font-serif text-lg text-mist-100">前期准备</h2>
          <button
            onClick={onClose}
            className="rounded-md px-2 py-1 text-[13px] text-mist-500 transition hover:text-mist-200"
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
          <span className="ml-auto shrink-0 text-[10px] text-mist-500/70">
            规则：{getRuleset(rulesetId).name}
          </span>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto p-5">
          {tab === 'module' && <ModuleTab />}
          {tab === 'character' && <CharacterTab />}
          {tab === 'companions' && <CompanionsTab />}
          {tab === 'worldbook' && <WorldbookTab />}
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
