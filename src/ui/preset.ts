/**
 * 游玩预设（Play Preset）
 *
 * 玩家不想一个个去调判定条件、写属性表。这里的思路是：
 * **贴一段文本（跑团剧本 / 小说 / 安科），让模型读成一个能直接开玩的整套预设**——
 * 题材风格 + 模组 + 世界书 + 队友（必要时再补一套自定义规则）。
 *
 * 预设可命名保存、导出分享、再导入。应用一次，整局的味道就换好了。
 */
import { useStore, normalizeCompanion } from './store.js';
import { registerCustomRuleset, type CustomRulesetConfig } from '../core/rulesets/index.js';
import type { Genre } from '../core/genres.js';
import type { ModuleNpc, WorldbookEntry } from './store.js';
import type { Companion } from '../core/state/gameState.js';

export type GenPresetModule = {
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
};

export type GenPreset = {
  name?: string;
  genre?: Partial<Genre>;
  /**
   * 预设自带的角色（可选）。
   * 剧本/安科里往往已经写好了主角，读进来直接套上比让玩家再建一张卡省事。
   */
  character?: {
    name?: string;
    description?: string;
    personality?: string;
    characteristics?: Record<string, number>;
    skills?: Record<string, number>;
    items?:
      | string[]
      | { name?: string; desc?: string; kind?: string; damage?: string; skill?: string }[];
  };
  module?: GenPresetModule;
  worldbook?: { keys?: string[]; content?: string; priority?: number }[];
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
  ruleset?: { mode?: string; mainDice?: string; attrs?: string; skills?: string; vitals?: string } | null;
};

export type StoredPreset = { id: string; name: string; data: GenPreset };

const PRESET_KEY = 'trpg.presets';
const CUSTOM_KEY = 'trpg.customRulesets';

let seq = 0;
export const uid = (p = 'id') => `${p}-${Date.now().toString(36)}-${(seq++).toString(36)}`;

/** 稳定的 id：同一个题材名重复导入时覆盖，而不是堆一堆 */
const slug = (s: string) =>
  s
    .trim()
    .toLowerCase()
    .replace(/[^\w\u4e00-\u9fa5]+/g, '-')
    .slice(0, 24) || 'x';

/** 解析"名称=默认值"这种每行一条的文本 */
function parseLines(text: string, fallback: number): { key: string; label: string; default: number }[] {
  return text
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean)
    .map((line) => {
      const [rawName, rawVal] = line.split(/[=:：]/, 2);
      const label = (rawName ?? '').trim();
      const def = parseInt(rawVal ?? String(fallback), 10);
      return { key: label, label, default: Number.isFinite(def) ? def : fallback };
    })
    .filter((x) => x.label);
}

function parseSkills(text: string): { name: string; base: number }[] {
  return text
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean)
    .map((line) => {
      const [rawName, rawVal] = line.split(/[=:：]/, 2);
      const base = parseInt(rawVal ?? '0', 10);
      return { name: (rawName ?? '').trim(), base: Number.isFinite(base) ? base : 0 };
    })
    .filter((x) => x.name);
}

export function readPresets(): StoredPreset[] {
  try {
    const list = JSON.parse(localStorage.getItem(PRESET_KEY) || '[]') as StoredPreset[];
    return Array.isArray(list) ? list.filter((p) => p?.id && p?.data) : [];
  } catch {
    return [];
  }
}

export function writePresets(list: StoredPreset[]): void {
  try {
    localStorage.setItem(PRESET_KEY, JSON.stringify(list));
  } catch {
    /* 本地存储满了：不致命，本次仍可用 */
  }
}

export function presetIdFor(name: string): string {
  return `preset-${slug(name)}`;
}

/**
 * 把一份预设应用到当前存档上。
 * 顺序很重要：先题材与规则（它们决定数值与画风），再模组、世界书、队友。
 */
export function applyPreset(data: GenPreset): void {
  const s = useStore.getState();

  // 1. 题材：整套预设的"味道"
  if (data.genre?.name) {
    const gid = `genre-${slug(data.genre.name)}`;
    s.saveCustomGenre({
      id: gid,
      name: data.genre.name,
      blurb: data.genre.blurb ?? '',
      setting: data.genre.setting ?? '',
      tone: data.genre.tone ?? '',
      imageStyle: data.genre.imageStyle ?? '',
      castHint: data.genre.castHint ?? '',
      builtin: false,
    });
    s.setGenre(gid);
  }

  // 2. 规则：只有原文的判定方式内置规则包表达不了时才有
  const rspec = data.ruleset;
  if (rspec?.mode && rspec.mainDice) {
    const cfg: CustomRulesetConfig = {
      id: `custom-${Date.now().toString(36)}`,
      name: `${data.name ?? '导入'}·规则`,
      mainDice: rspec.mainDice,
      mode: rspec.mode === 'over' ? 'over' : 'under',
      characteristics: parseLines(rspec.attrs ?? '', 50),
      skills: parseSkills(rspec.skills ?? ''),
      vitals: parseLines(rspec.vitals ?? '', 10),
    };
    if (cfg.characteristics.length > 0) {
      registerCustomRuleset(cfg);
      try {
        const list = JSON.parse(localStorage.getItem(CUSTOM_KEY) || '[]') as CustomRulesetConfig[];
        localStorage.setItem(CUSTOM_KEY, JSON.stringify([...list, cfg]));
      } catch {
        /* 存不下就算了，本次仍可用 */
      }
      s.setRuleset(cfg.id);
    }
  }

  // 2.5 角色（可选）：剧本里写好主角时一并套上，物品与角色卡同一套合并逻辑
  const pc = data.character;
  if (pc && (pc.name || pc.description || pc.skills)) {
    const itemNames: string[] = [];
    const itemDetails: { name: string; desc?: string; kind?: string; damage?: string; skill?: string }[] =
      [];
    for (const it of pc.items ?? []) {
      if (typeof it === 'string') {
        const n = it.trim();
        if (n) itemNames.push(n);
        continue;
      }
      const n = (it.name ?? '').trim();
      if (!n) continue;
      itemNames.push(n);
      itemDetails.push({ name: n, desc: it.desc, kind: it.kind, damage: it.damage, skill: it.skill });
    }
    s.setCharacter({
      ...(pc.name ? { name: pc.name } : {}),
      ...(pc.description ? { description: pc.description } : {}),
      ...(pc.personality ? { personality: pc.personality } : {}),
      ...(pc.characteristics ? { characteristics: pc.characteristics } : {}),
      ...(pc.skills ? { skills: pc.skills } : {}),
      ...(itemNames.length ? { items: itemNames } : {}),
      ...(itemDetails.length ? { itemDetails } : {}),
    });
  }

  // 3. 模组（故事骨架）
  const m = data.module;
  if (m && typeof m === 'object') {
    const npcs: ModuleNpc[] = (m.npcs ?? [])
      .filter((n) => n.name)
      .map((n) => ({
        id: uid('npc'),
        name: n.name!,
        role: n.role ?? '',
        motive: n.motive ?? '',
        secret: n.secret ?? '',
      }));
    s.setModule({
      title: m.title ?? '未命名模组',
      premise: m.premise ?? '',
      opening: m.opening ?? '',
      startLocation: m.start_location ?? '',
      goal: m.goal,
      stakes: m.stakes,
      urgency: m.urgency,
      truth: m.truth ?? '',
      npcs,
      locations: m.locations ?? '',
      mapNodes: (m.map_nodes ?? [])
        .filter((n) => n.name)
        .map((n) => ({ name: n.name!, links: n.links ?? [], note: n.note })),
      clueChain: m.clueChain ?? '',
      acts: m.acts ?? '',
      endings: m.endings ?? '',
      notes: m.notes ?? '',
      sourceNote: m.source_note,
    });
    // 整套预设里带的是**新模组**，清掉上一个模组的派生数据
    s.clearModuleDerived();
  }

  // 4. 世界书（细节层）
  const entries: WorldbookEntry[] = (data.worldbook ?? [])
    .filter((e) => e.content)
    .map((e) => ({
      id: uid('wb'),
      keys: e.keys?.length ? e.keys : [e.content!.slice(0, 6)],
      content: e.content!,
      priority: e.priority ?? 50,
      enabled: true,
      fromModule: true,
    }));
  if (entries.length) s.setWorldbookEntries(entries);

  // 5. 队友候选（等玩家挑谁入队）
  const candidates: Companion[] = (data.companions ?? [])
    .filter((c) => c.name)
    .map((c) =>
      normalizeCompanion({
        id: uid('cand'),
        name: c.name!,
        role: c.role ?? '',
        personality: c.personality ?? '',
        bond: c.bond,
        secret: c.secret,
        agenda: c.agenda,
        skills: c.skills ?? {},
        vitals: c.vitals ?? {},
        initiative:
          c.initiative === 'balanced' || c.initiative === 'proactive' ? c.initiative : 'reactive',
        alive: true,
        present: true,
        met: false,
      })
    );
  if (candidates.length) s.setCompanionCandidates(candidates);
}
