import { useEffect, useState } from 'react';
import { useStore, TYPOGRAPHY_PRESETS, checkTargetText, type ThemeName } from './store';
import { ConfirmDialog } from './ConfirmDialog';
import { TestSandbox } from './TestSandbox';
import { ChangelogDialog, hasUnreadChangelog, markChangelogRead } from './Changelog';
import { HelpDialog } from './HelpGuide';
import {
  canInstall,
  isStandalone,
  onInstallAvailable,
  promptInstall,
} from '../pwa.js';
import { applyUpdate, checkForUpdate, versionLabel } from '../update.js';
import {
  AMBIENCE_LABEL,
  AUDIO_SIZE_WARN,
  SFX_LABEL,
  SFX_SLOTS,
  audioUsage,
  delAudio,
  getAudio,
  putAudio,
  type AmbienceKind,
  type SfxSlot,
} from './audio.js';
import { listRulesets, registerCustomRuleset, getRuleset, type CustomRulesetConfig } from '../core/rulesets/index.js';
import { listGenres, type Genre } from '../core/genres.js';
import { generateJson, presetSystemPrompt } from '../orchestrator/generate.js';
import { ModelError } from '../providers/model.js';
import {
  applyPreset,
  readPresets,
  writePresets,
  presetIdFor,
  type GenPreset,
  type StoredPreset,
} from './preset.js';

const PRESETS = [
  {
    name: '硅基流动',
    baseUrl: 'https://api.siliconflow.cn/v1',
    model: 'deepseek-ai/DeepSeek-V3.2',
  },
  {
    name: '硅基流动 Pro',
    baseUrl: 'https://api.siliconflow.cn/v1',
    model: 'Pro/deepseek-ai/DeepSeek-V3.2',
  },
  { name: 'DeepSeek 官方', baseUrl: 'https://api.deepseek.com/v1', model: 'deepseek-chat' },
  {
    name: '智谱 GLM',
    baseUrl: 'https://open.bigmodel.cn/api/paas/v4',
    model: 'glm-4-flash',
  },
  {
    name: '通义千问',
    baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
    model: 'qwen-plus',
  },
  {
    name: '豆包',
    baseUrl: 'https://ark.cn-beijing.volces.com/api/v3',
    model: '（填写接入点 ID）',
  },
  { name: 'OpenAI', baseUrl: 'https://api.openai.com/v1', model: 'gpt-4o-mini' },
  { name: '本地 Ollama', baseUrl: 'http://localhost:11434/v1', model: 'qwen2.5:14b' },
];

const THEMES: { id: ThemeName; name: string; desc: string }[] = [
  { id: 'midnight', name: '午夜 · 暗金', desc: '哥特调查' },
  { id: 'ash', name: '冷灰', desc: '无彩现代' },
  { id: 'parchment', name: '羊皮纸', desc: '浅色复古' },
];

function Field({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <label className="block">
      <span className="mb-1.5 block text-[12px] text-mist-400">{label}</span>
      {children}
      {hint && <span className="mt-1 block text-[11px] leading-relaxed text-mist-500/80">{hint}</span>}
    </label>
  );
}

const inputCls =
  'w-full rounded-lg border border-ink-600 bg-ink-950 px-3 py-2 text-[13px] text-mist-100 outline-none transition focus:border-gold-600/60';

const smallBtn =
  'rounded-lg border border-ink-600 bg-ink-850 px-3 py-1.5 text-[12px] text-mist-300 transition hover:border-gold-600/50 hover:text-mist-100';

/**
 * 音频存储占用。
 * 上传整首歌很容易把 IndexedDB 撑到几十 MB，浏览器给的额度是有限的；
 * 超限时原来只在 console 里 warn，玩家看到的是"点了上传什么都没发生"。
 */
function AudioStorageMeter() {
  const [rows, setRows] = useState<{ key: string; size: number }[]>([]);
  const [tick, setTick] = useState(0);

  useEffect(() => {
    const keys = ['bgm', ...SFX_SLOTS.map((s) => `sfx.${s}`)];
    void audioUsage(keys).then(setRows);
  }, [tick]);

  if (rows.length === 0) return null;
  const total = rows.reduce((n, r) => n + r.size, 0);
  const mb = (n: number) => `${(n / 1024 / 1024).toFixed(2)}MB`;
  const over = rows.filter((r) => r.size > AUDIO_SIZE_WARN);

  return (
    <div className="rounded-lg border border-ink-700 bg-ink-850/60 p-3">
      <div className="flex items-center justify-between">
        <span className="text-[11px] text-mist-400">
          音频占用 <span className="text-mist-300">{mb(total)}</span>
          <span className="text-mist-500/70">（{rows.length} 个文件）</span>
        </span>
        <button
          onClick={() => setTick((t) => t + 1)}
          className="text-[10px] text-mist-500 transition hover:text-mist-300"
        >
          刷新
        </button>
      </div>
      <div className="mt-1.5 space-y-0.5">
        {rows.map((r) => (
          <div key={r.key} className="flex items-center justify-between text-[10px]">
            <span className="truncate text-mist-500">
              {r.key === 'bgm' ? 'BGM' : SFX_LABEL[r.key.replace('sfx.', '') as SfxSlot] ?? r.key}
            </span>
            <span className={r.size > AUDIO_SIZE_WARN ? 'text-blood-300' : 'text-mist-500'}>
              {mb(r.size)}
            </span>
          </div>
        ))}
      </div>
      {over.length > 0 && (
        <p className="mt-1.5 text-[10px] leading-relaxed text-blood-300">
          有 {over.length} 个文件超过 {Math.round(AUDIO_SIZE_WARN / 1024 / 1024)}MB。
          手机上这么大的音频会让应用变慢、也可能存不下——建议换成短一点的片段。
        </p>
      )}
    </div>
  );
}

/** 一行"上传/替换/清除"——用来给某个音效槽位或 BGM 换上自己的音频 */
function AudioFileRow({ label, storageKey }: { label: string; storageKey: string }) {
  const [has, setHas] = useState(false);
  useEffect(() => {
    void getAudio(storageKey).then((b) => setHas(Boolean(b)));
  }, [storageKey]);
  return (
    <div className="flex items-center justify-between gap-2 rounded-md border border-ink-600 bg-ink-850 px-2.5 py-1.5">
      <span className="min-w-0 truncate text-[12px] text-mist-300">{label}</span>
      <div className="flex shrink-0 items-center gap-1.5">
        {has && (
          <button
            onClick={async () => {
              await delAudio(storageKey);
              setHas(false);
            }}
            className="text-[11px] text-mist-500 transition hover:text-blood-400"
          >
            清除
          </button>
        )}
        <label className="cursor-pointer rounded-md border border-ink-600 px-2 py-0.5 text-[11px] text-mist-300 transition hover:border-gold-600/50 hover:text-mist-100">
          {has ? '替换' : '上传'}
          <input
            type="file"
            accept="audio/*"
            className="hidden"
            onChange={async (e) => {
              const f = e.target.files?.[0];
              if (f) {
                await putAudio(storageKey, f);
                setHas(true);
              }
              e.target.value = '';
            }}
          />
        </label>
      </div>
    </div>
  );
}

interface SlotMeta {
  id: string;
  name: string;
  savedAt: string;
  title: string;
}

const SLOTS_KEY = 'trpg.slots';
const slotKey = (id: string) => `trpg.slot.${id}`;

function readSlots(): SlotMeta[] {
  try {
    return JSON.parse(localStorage.getItem(SLOTS_KEY) || '[]') as SlotMeta[];
  } catch {
    return [];
  }
}

const CUSTOM_KEY = 'trpg.customRulesets';

/** 设置页的分组目录（对应下面各节的锚点 id） */
const SECTIONS = [
  { id: 'sec-api', label: '模型与接口' },
  { id: 'sec-rules', label: '规则与题材' },
  { id: 'sec-look', label: '外观与排版' },
  { id: 'sec-audio', label: '音频' },
  { id: 'sec-data', label: '数据与存档' },
  { id: 'sec-install', label: '安装到设备' },
  { id: 'sec-dev', label: '开发者' },
];

/** 设置里的一节标题：带锚点 id，供顶部快速跳转 */
function GroupTitle({ id, title, hint }: { id: string; title: string; hint?: string }) {
  return (
    <div id={id} className="scroll-mt-16 border-b border-ink-700 pb-1.5">
      <h3 className="text-[13px] font-medium tracking-wide text-gold-400">{title}</h3>
      {hint && <p className="mt-0.5 text-[11px] leading-relaxed text-mist-500">{hint}</p>}
    </div>
  );
}

/** 解析"名称=默认值"这种每行一条的文本，返回属性/数值条列表 */
function parseAttrLines(text: string): { key: string; label: string; default: number }[] {
  return text
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean)
    .map((line) => {
      const [rawName, rawVal] = line.split(/[=:：]/, 2);
      const label = (rawName ?? '').trim();
      const def = parseInt(rawVal ?? '50', 10);
      return { key: label, label, default: Number.isFinite(def) ? def : 50 };
    });
}

function parseSkillLines(text: string): { name: string; base: number }[] {
  return text
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean)
    .map((line) => {
      const [rawName, rawVal] = line.split(/[=:：]/, 2);
      const base = parseInt(rawVal ?? '0', 10);
      return { name: (rawName ?? '').trim(), base: Number.isFinite(base) ? base : 0 };
    });
}

function readCustomRulesets(): CustomRulesetConfig[] {
  try {
    return JSON.parse(localStorage.getItem(CUSTOM_KEY) || '[]') as CustomRulesetConfig[];
  } catch {
    return [];
  }
}

/** 自定义规则包编辑器——"第三方自由预设"，不写代码就能定义一套自己的规则 */
function CustomRulesetEditor({ onSaved }: { onSaved: () => void }) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState('');
  const [mainDice, setMainDice] = useState('1d100');
  const [mode, setMode] = useState<'under' | 'over'>('under');
  const [chars, setChars] = useState('力量=50\n敏捷=50\n体质=50\n智力=50\n意志=50');
  const [skills, setSkills] = useState('侦查=20\n聆听=20\n格斗=25\n说服=10');
  const [vitals, setVitals] = useState('生命=12\n理智=70');
  const [msg, setMsg] = useState('');

  if (!open) {
    return (
      <button
        onClick={() => setOpen(true)}
        className="w-full rounded-md border border-dashed border-ink-600 py-1.5 text-[12px] text-mist-400 transition hover:border-gold-600/50 hover:text-mist-100"
      >
        ＋ 新建自定义规则（自由预设）
      </button>
    );
  }

  const save = () => {
    const cfg: CustomRulesetConfig = {
      id: `custom-${Date.now()}`,
      name: name.trim() || '我的规则',
      mainDice,
      mode,
      characteristics: parseAttrLines(chars),
      skills: parseSkillLines(skills),
      vitals: parseAttrLines(vitals),
    };
    if (cfg.characteristics.length === 0) {
      setMsg('至少写一条属性');
      return;
    }
    registerCustomRuleset(cfg);
    const list = [...readCustomRulesets(), cfg];
    try {
      localStorage.setItem(CUSTOM_KEY, JSON.stringify(list));
      setMsg(`已保存「${cfg.name}」，可在上方切换`);
      onSaved();
    } catch {
      setMsg('保存失败（本地存储可能满了）');
    }
  };

  const field = (
    <label className="block">
      <span className="mb-1 block text-[11px] text-mist-500">名称</span>
      <input
        className={inputCls}
        value={name}
        onChange={(e) => setName(e.target.value)}
        placeholder="如：我的房规"
      />
    </label>
  );

  return (
    <div className="space-y-2 rounded-lg border border-ink-700 bg-ink-850/50 p-2.5">
      <div className="flex items-center justify-between gap-2">
        <span className="text-[12px] text-mist-400">自定义规则（自由预设）</span>
        <button onClick={() => setOpen(false)} className="text-[11px] text-mist-500 hover:text-mist-300">
          收起
        </button>
      </div>
      {field}
      <div className="grid grid-cols-2 gap-2">
        <label className="block">
          <span className="mb-1 block text-[11px] text-mist-500">主骰</span>
          <select
            className={inputCls}
            value={mainDice}
            onChange={(e) => setMainDice(e.target.value)}
          >
            <option value="1d100">1d100（百分比）</option>
            <option value="1d20">1d20</option>
            <option value="2d6">2d6</option>
            <option value="1d10">1d10</option>
          </select>
        </label>
        <label className="block">
          <span className="mb-1 block text-[11px] text-mist-500">判定方式</span>
          <select
            className={inputCls}
            value={mode}
            onChange={(e) => setMode(e.target.value as 'under' | 'over')}
          >
            <option value="under">≤ 目标值（点数越小越好）</option>
            <option value="over">≥ 目标值（点数越大越好）</option>
          </select>
        </label>
      </div>
      <label className="block">
        <span className="mb-1 block text-[11px] text-mist-500">属性（每行「名称=默认值」）</span>
        <textarea className={`${inputCls} resize-none`} rows={3} value={chars} onChange={(e) => setChars(e.target.value)} />
      </label>
      <label className="block">
        <span className="mb-1 block text-[11px] text-mist-500">技能（每行「名称=基础值」）</span>
        <textarea className={`${inputCls} resize-none`} rows={3} value={skills} onChange={(e) => setSkills(e.target.value)} />
      </label>
      <label className="block">
        <span className="mb-1 block text-[11px] text-mist-500">数值条（每行「名称=默认值」）</span>
        <textarea className={`${inputCls} resize-none`} rows={2} value={vitals} onChange={(e) => setVitals(e.target.value)} />
      </label>
      <button
        onClick={save}
        className="w-full rounded-lg bg-gold-500 px-3 py-1.5 text-[12px] font-medium text-ink-950 transition hover:bg-gold-400"
      >
        保存并注册
      </button>
      {msg && <p className="text-[11px] text-moss-400">{msg}</p>}
    </div>
  );
}

/**
 * 「导入文本 → 一整套游玩预设」。
 *
 * 取代"让玩家一个个去调判定条件"：贴一段跑团剧本 / 小说 / 安科，
 * 模型读出一整套能开玩的东西（题材 + 模组 + 世界书 + 队友，必要时补一套自定义规则）。
 */
function PresetImporter() {
  const [open, setOpen] = useState(false);
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [msg, setMsg] = useState('');
  const [list, setList] = useState<StoredPreset[]>(readPresets);

  const saveList = (next: StoredPreset[]) => {
    writePresets(next);
    setList(next);
  };

  const run = async () => {
    if (!text.trim()) return;
    setBusy(true);
    setErr('');
    setMsg('');
    try {
      const s = useStore.getState();
      if (!s.config.apiKey) throw new Error('请先在设置里填 API Key');
      const rs = getRuleset(s.rulesetId);
      const data = await generateJson<GenPreset>(
        presetSystemPrompt(rs),
        `请把下面这段文本整理成一整套可以直接开玩的预设：\n\n${text.trim()}`,
        { ...s.config, maxTokens: 6000 }
      );
      if (!data) throw new Error('模型没有返回合法 JSON，请重试（文本可以再长一点）');
      const name = data.name?.trim() || `导入预设 ${new Date().toLocaleDateString()}`;
      applyPreset(data);
      const id = presetIdFor(name);
      saveList([...list.filter((p) => p.id !== id), { id, name, data }]);
      setMsg(`已生成并启用「${name}」：题材 / 模组 / 世界书 / 队友都换好了`);
      setText('');
    } catch (e) {
      setErr(e instanceof ModelError ? e.message : (e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const applyStored = (p: StoredPreset) => {
    try {
      applyPreset(p.data);
      setMsg(`已应用「${p.name}」`);
      setErr('');
    } catch (e) {
      setErr(`应用失败：${(e as Error).message}`);
    }
  };

  const exportAll = () => {
    if (list.length === 0) return;
    const blob = new Blob([JSON.stringify(list, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `跑团游玩预设-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  /** 复制全部预设为 JSON 到剪贴板——纯前端最方便的"分享"方式 */
  const copyAll = async () => {
    if (list.length === 0) return;
    try {
      await navigator.clipboard.writeText(JSON.stringify(list));
      setMsg('已复制全部预设到剪贴板，直接贴给朋友即可');
      setErr('');
    } catch {
      setErr('复制失败，请改用「导出」存成文件');
    }
  };

  /** 从剪贴板粘贴预设 JSON */
  const pasteAll = async () => {
    try {
      const text = await navigator.clipboard.readText();
      const parsed = JSON.parse(text) as StoredPreset[];
      if (!Array.isArray(parsed)) throw new Error('格式不对');
      const merged = [...list];
      for (const p of parsed) {
        if (!p?.data || !p?.name) continue;
        const id = p.id ?? presetIdFor(p.name);
        const idx = merged.findIndex((x) => x.id === id);
        if (idx >= 0) merged[idx] = { ...p, id };
        else merged.push({ ...p, id });
      }
      saveList(merged);
      setMsg(`已从剪贴板导入 ${parsed.length} 份预设`);
      setErr('');
    } catch {
      setErr('剪贴板里没有可识别的预设 JSON');
    }
  };

  const importFile = (file: File) => {
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const parsed = JSON.parse(String(reader.result)) as StoredPreset[];
        if (!Array.isArray(parsed)) throw new Error('格式不对');
        const merged = [...list];
        for (const p of parsed) {
          if (!p?.data || !p?.name) continue;
          const id = p.id ?? presetIdFor(p.name);
          const idx = merged.findIndex((x) => x.id === id);
          if (idx >= 0) merged[idx] = { ...p, id };
          else merged.push({ ...p, id });
        }
        saveList(merged);
        setMsg(`已导入 ${parsed.length} 份预设`);
        setErr('');
      } catch {
        setErr('预设文件格式不正确');
      }
    };
    reader.readAsText(file);
  };

  if (!open) {
    return (
      <button
        onClick={() => setOpen(true)}
        className="w-full rounded-md border border-dashed border-gold-600/50 py-1.5 text-[12px] text-gold-400 transition hover:border-gold-600/80 hover:text-gold-300"
      >
        ＋ 导入剧本 / 小说 / 安科 → 自动生成整套预设
      </button>
    );
  }

  return (
    <div className="space-y-2 rounded-lg border border-ink-700 bg-ink-850/50 p-2.5">
      <div className="flex items-center justify-between gap-2">
        <span className="text-[12px] text-mist-300">导入文本 → 整套预设</span>
        <button
          onClick={() => setOpen(false)}
          className="text-[11px] text-mist-500 hover:text-mist-300"
        >
          收起
        </button>
      </div>
      <p className="text-[10px] leading-relaxed text-mist-500">
        贴一段模组原文、小说或安科（越长越准）。模型会读出一整套预设：
        <span className="text-mist-400">题材风格 + 模组 + 世界书 + 队友</span>
        ，必要时再补一套规则。生成后立即生效，不用你调任何参数。
      </p>
      <textarea
        className={`${inputCls} min-h-[120px] resize-y`}
        value={text}
        onChange={(e) => setText(e.target.value)}
        placeholder="把剧本 / 小说 / 安科正文贴进来……"
      />
      <button
        onClick={run}
        disabled={busy || !text.trim()}
        className="w-full rounded-lg bg-gold-500 px-3 py-1.5 text-[12px] font-medium text-ink-950 transition hover:bg-gold-400 disabled:opacity-40"
      >
        {busy ? '正在读文本、生成预设…' : '生成预设'}
      </button>
      {msg && <p className="text-[11px] text-moss-400">{msg}</p>}
      {err && <p className="text-[11px] text-blood-400">{err}</p>}

      {list.length > 0 && (
        <div className="space-y-1 pt-1">
          <div className="flex items-center justify-between">
            <span className="text-[11px] text-mist-500">我的预设（{list.length}）</span>
            <div className="flex gap-1.5">
              <button
                onClick={copyAll}
                className="rounded-md border border-ink-600 px-2 py-0.5 text-[10px] text-mist-400 hover:border-gold-600/50 hover:text-mist-100"
                title="复制成 JSON 到剪贴板，可直接贴给朋友"
              >
                复制
              </button>
              <button
                onClick={pasteAll}
                className="rounded-md border border-ink-600 px-2 py-0.5 text-[10px] text-mist-400 hover:border-gold-600/50 hover:text-mist-100"
                title="从剪贴板粘贴预设 JSON"
              >
                粘贴
              </button>
              <button
                onClick={exportAll}
                className="rounded-md border border-ink-600 px-2 py-0.5 text-[10px] text-mist-400 hover:border-gold-600/50 hover:text-mist-100"
              >
                导出
              </button>
              <label className="cursor-pointer rounded-md border border-ink-600 px-2 py-0.5 text-[10px] text-mist-400 hover:border-gold-600/50 hover:text-mist-100">
                导入
                <input
                  type="file"
                  accept="application/json"
                  className="hidden"
                  onChange={(e) => {
                    const f = e.target.files?.[0];
                    if (f) importFile(f);
                    e.target.value = '';
                  }}
                />
              </label>
            </div>
          </div>
          {list.map((p) => (
            <div
              key={p.id}
              className="flex items-center justify-between gap-2 rounded-md bg-ink-800 px-2 py-1"
            >
              <span className="min-w-0 truncate text-[11px] text-mist-300">{p.name}</span>
              <span className="flex shrink-0 gap-1.5">
                <button
                  onClick={() => applyStored(p)}
                  className="text-[10px] text-gold-400 hover:text-gold-300"
                >
                  应用
                </button>
                <button
                  onClick={() => saveList(list.filter((x) => x.id !== p.id))}
                  className="text-[10px] text-mist-500 hover:text-blood-400"
                >
                  删除
                </button>
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

export function Settings({ onClose }: { onClose: () => void }) {
  const devMode = useStore((s) => s.devMode);
  const setDevMode = useStore((s) => s.setDevMode);
  const [sandboxOpen, setSandboxOpen] = useState(false);
  const [changelogOpen, setChangelogOpen] = useState(false);
  const [helpOpen, setHelpOpen] = useState(false);
  const [updateState, setUpdateState] = useState<'idle' | 'checking' | 'newer' | 'latest' | 'unknown'>(
    'idle'
  );
  const checkNow = async () => {
    setUpdateState('checking');
    setUpdateState(await checkForUpdate());
  };
  const [changelogNew, setChangelogNew] = useState(hasUnreadChangelog);
  const config = useStore((s) => s.config);
  const setConfig = useStore((s) => s.setConfig);
  const theme = useStore((s) => s.theme);
  const setTheme = useStore((s) => s.setTheme);
  const typography = useStore((s) => s.typography);
  const setTypography = useStore((s) => s.setTypography);
  const audio = useStore((s) => s.audio);
  const setAudio = useStore((s) => s.setAudio);
  const loadSave = useStore((s) => s.loadSave);
  const rulesetId = useStore((s) => s.rulesetId);
  const setRuleset = useStore((s) => s.setRuleset);
  const genreId = useStore((s) => s.genreId);
  const customGenres = useStore((s) => s.customGenres);
  const setGenre = useStore((s) => s.setGenre);

  const [testing, setTesting] = useState<'idle' | 'ok' | 'fail'>('idle');
  const [testMsg, setTestMsg] = useState('');
  const [toast, setToast] = useState('');
  const [confirmReset, setConfirmReset] = useState(false);
  const [slots, setSlots] = useState<SlotMeta[]>(readSlots());
  const [slotName, setSlotName] = useState('');
  const [customVersion, setCustomVersion] = useState(0);
  const [installable, setInstallable] = useState(false);
  const [standalone, setStandalone] = useState(false);

  // 安装可用性由浏览器决定，可能晚于首屏才知道，所以订阅一下
  useEffect(() => {
    const sync = () => {
      setInstallable(canInstall());
      setStandalone(isStandalone());
    };
    sync();
    return onInstallAvailable(sync);
  }, []);

  const flash = (msg: string) => {
    setToast(msg);
    setTimeout(() => setToast(''), 2600);
  };

  const test = async () => {
    setTesting('idle');
    setTestMsg('连接中…');
    try {
      const { streamChat } = await import('../providers/model.js');
      let got = '';
      for await (const chunk of streamChat(
        [{ role: 'user', content: '回复"ok"两个字' }],
        { ...config, maxTokens: 16 }
      )) {
        got += chunk;
        if (got.length > 20) break;
      }
      setTesting('ok');
      setTestMsg(`连接成功，模型回复：${got.trim().slice(0, 20)}`);
    } catch (e) {
      setTesting('fail');
      setTestMsg((e as Error).message);
    }
  };

  /**
   * 导出完整存档（不含 API Key）。
   * 字段清单统一走 store 的 `buildSave()`：导出与存槽共用它，
   * 免得两边各写一份、漏掉某个战役字段（队友候选就是这么漏的）。
   */
  const exportSave = () => {
    const payload = useStore.getState().buildSave();
    const blob = new Blob([JSON.stringify(payload, null, 2)], {
      type: 'application/json',
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    const stamp = new Date().toISOString().slice(0, 16).replace(/[:T]/g, '-');
    a.href = url;
    a.download = `跑团存档-${stamp}.json`;
    a.click();
    URL.revokeObjectURL(url);
    flash('存档已导出到下载目录');
  };

  /** 复制纯文本对话记录 + 状态快照，便于直接粘贴排查 */
  const copyLog = async () => {
    const s = useStore.getState();
    const body = s.messages
      .map((m) => {
        const who = m.role === 'gm' ? '守密人' : m.role === 'player' ? '玩家' : '系统';
        let line = `【${who}】${m.content}`;
        if (m.check) {
          line += `\n  ↳ ${m.check.skill} ${checkTargetText(m.check)} · 掷出 ${m.check.roll} · ${m.check.label}`;
        }
        if (m.npcLines?.length) {
          for (const n of m.npcLines) {
            if (n.action) line += `\n  ◆ ${n.name}：（${n.action}）`;
            if (n.line) line += `\n  ◆ ${n.name}：「${n.line}」`;
          }
        }
        return line;
      })
      .join('\n\n');

    const gs = s.gameState;
    const vitals = Object.entries(gs.vitals)
      .map(([k, v]) => `${k}=${v}`)
      .join(' ');
    const comps = gs.companions
      .map(
        (c) =>
          `${c.name}[${c.initiative}] ${Object.entries(c.vitals)
            .map(([k, v]) => `${k}=${v}`)
            .join(' ')}${c.alive ? '' : ' (已死亡)'}`
      )
      .join(' / ');
    const snapshot = [
      '—— 当前状态 ——',
      `地点：${gs.location}`,
      `玩家：${vitals}`,
      comps ? `同行者：${comps}` : null,
      `线索(${gs.clues.length})：${gs.clues.join(' | ') || '无'}`,
      s.chronicle.length
        ? `事件日志(${s.chronicle.length} 条)：\n${s.chronicle
            .map((c) => `  ${c.turn}. ${c.text}`)
            .join('\n')}`
        : '事件日志：空',
      s.summary ? `远期摘要：${s.summary}` : null,
      `物品：${gs.inventory.map((i) => `${i.name}×${i.qty}`).join('、') || '无'}`,
      `标记：${Object.keys(gs.flags).length ? JSON.stringify(gs.flags) : '无'}`,
      `在场：${gs.npcsAlive.join('、') || '无'}`,
    ]
      .filter(Boolean)
      .join('\n');

    try {
      await navigator.clipboard.writeText(`${body}\n\n${snapshot}`);
      flash(`已复制 ${s.messages.length} 条消息 + 状态快照`);
    } catch {
      flash('复制失败，请手动选择文本');
    }
  };

  const importSave = (file: File) => {
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const data = JSON.parse(String(reader.result));
        loadSave(data);
        flash('存档已导入');
      } catch {
        flash('文件格式不正确');
      }
    };
    reader.readAsText(file);
  };

  const resetAll = () => {
    localStorage.removeItem('trpg.character');
    localStorage.removeItem('trpg.gameState');
    localStorage.removeItem('trpg.messages');
    useStore.getState().clearProgress();
    useStore.getState().clearMessages();
    location.reload();
  };

  /** 把当前进度存进一个命名的槽位（想同时开几局时用） */
  const saveToSlot = () => {
    const s = useStore.getState();
    const id = `slot-${Date.now()}`;
    const meta: SlotMeta = {
      id,
      name: slotName.trim() || s.module.title || '未命名',
      savedAt: new Date().toISOString(),
      title: s.module.title || '（无模组）',
    };
    // 与导出共用 buildSave()，字段不会漏（含队友候选与快照）
    const payload = s.buildSave();
    try {
      localStorage.setItem(slotKey(id), JSON.stringify(payload));
      const next = [...slots.filter((x) => x.name !== meta.name), meta];
      localStorage.setItem(SLOTS_KEY, JSON.stringify(next));
      setSlots(next);
      setSlotName('');
      flash(`已保存到「${meta.name}」`);
    } catch {
      flash('保存失败（可能超出本地存储配额）');
    }
  };

  const loadSlot = (id: string) => {
    try {
      const raw = localStorage.getItem(slotKey(id));
      if (!raw) {
        flash('槽位为空');
        return;
      }
      loadSave(JSON.parse(raw));
      flash('已读取存档');
    } catch {
      flash('读取失败');
    }
  };

  const deleteSlot = (id: string) => {
    localStorage.removeItem(slotKey(id));
    const next = slots.filter((x) => x.id !== id);
    localStorage.setItem(SLOTS_KEY, JSON.stringify(next));
    setSlots(next);
    flash('已删除槽位');
  };

  /** 导出所有自定义规则包为 JSON 文件（分享给第三方） */
  const exportPresets = () => {
    const list = readCustomRulesets();
    if (list.length === 0) {
      flash('还没有自定义规则，先在上面新建一个');
      return;
    }
    const blob = new Blob([JSON.stringify(list, null, 2)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `跑团规则预设-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(a.href);
    flash(`已导出 ${list.length} 个自定义规则`);
  };

  /** 从 JSON 文件导入自定义规则包（第三方预设） */
  const importPresets = (file: File) => {
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const arr = JSON.parse(String(reader.result));
        const list = Array.isArray(arr) ? arr : [arr];
        let added = 0;
        const merged = [...readCustomRulesets()];
        for (const cfg of list) {
          if (cfg && cfg.id && cfg.name && Array.isArray(cfg.skills)) {
            registerCustomRuleset(cfg as CustomRulesetConfig);
            const i = merged.findIndex((x) => x.id === cfg.id);
            if (i >= 0) merged[i] = cfg;
            else merged.push(cfg);
            added++;
          }
        }
        localStorage.setItem(CUSTOM_KEY, JSON.stringify(merged));
        setCustomVersion((v) => v + 1);
        flash(`已导入 ${added} 个规则`);
      } catch {
        flash('文件格式不对');
      }
    };
    reader.readAsText(file);
  };

  return (
    <div
      /* 点外面的遮罩就关：设置项很多，每次都要去找「关闭」按钮很烦。
         用 mousedown + 目标判定，避免在面板里拖选输入框到外面时被误关 */
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
      className="fixed inset-0 z-50 flex items-center justify-center bg-ink-950/80 p-4 backdrop-blur-sm"
    >
      <div
        className="max-h-[85vh] w-full max-w-lg overflow-y-auto rounded-2xl border border-ink-600 bg-ink-900 p-5"
      >
        <div className="mb-3 flex items-center justify-between gap-2">
          <h2 className="font-serif text-lg text-mist-100">设置</h2>
          <div className="flex items-center gap-1.5">
            <button
              onClick={() => setHelpOpen(true)}
              className="rounded-md border border-ink-600 px-2.5 py-1 text-[12px] text-mist-300 transition hover:border-gold-600/50 hover:text-mist-100"
              title="怎么玩：操作、检定、地图、背包、结档"
            >
              帮助
            </button>
            <button
              onClick={() => {
                markChangelogRead();
                setChangelogOpen(true);
                setChangelogNew(false);
              }}
              className="relative rounded-md border border-ink-600 px-2.5 py-1 text-[12px] text-mist-300 transition hover:border-gold-600/50 hover:text-mist-100"
              title="看看这一版改了什么"
            >
              更新日志
              {changelogNew && (
                <span
                  className="absolute -right-1 -top-1 h-2 w-2 rounded-full bg-gold-400"
                  title="有新的更新"
                />
              )}
            </button>
            <button
              onClick={onClose}
              className="rounded-md border border-ink-600 px-2.5 py-1 text-[13px] text-mist-300 transition hover:border-gold-600/50 hover:text-mist-100"
            >
              关闭
            </button>
          </div>
        </div>

        {/* 快速跳转：设置项变多了，先给一张"目录" */}
        <div className="sticky top-0 z-10 -mx-5 mb-4 flex flex-wrap gap-1.5 border-b border-ink-700 bg-ink-900/95 px-5 pb-2.5 pt-1 backdrop-blur">
          {SECTIONS.map((s) => (
            <button
              key={s.id}
              onClick={() => document.getElementById(s.id)?.scrollIntoView({ behavior: 'smooth' })}
              className="rounded-full border border-ink-600 px-2.5 py-1 text-[11px] text-mist-400 transition hover:border-gold-600/50 hover:text-mist-100"
            >
              {s.label}
            </button>
          ))}
        </div>

        {!config.apiKey && (
          <button
            onClick={() => document.getElementById('sec-api')?.scrollIntoView({ behavior: 'smooth' })}
            className="mb-4 flex w-full items-center justify-between gap-2 rounded-lg border border-gold-600/50 bg-gold-500/10 px-3 py-2 text-left text-[12px] text-gold-300 transition hover:bg-gold-500/15"
          >
            <span>还没配置 API Key，配置完就能开团了</span>
            <span className="shrink-0 text-[11px] text-gold-500/80">去配置 ›</span>
          </button>
        )}

        <div className="space-y-5">
          <GroupTitle
            id="sec-rules"
            title="规则与题材"
            hint="题材决定这一局的写法、画风与队友倾向；规则决定怎么算。两者各自独立，可任意搭配。"
          />

          <div>
            <span className="mb-2 block text-[12px] text-mist-400">
              题材预设{' '}
              <span className="text-mist-500/70">（决定守密人怎么写、画风、队友倾向）</span>
            </span>
            <div className="grid grid-cols-2 gap-2">
              {listGenres(customGenres).map((g) => (
                <button
                  key={g.id}
                  onClick={() => setGenre(g.id)}
                  className={`rounded-lg border p-2 text-left transition ${
                    genreId === g.id
                      ? 'border-gold-600/70 bg-gold-500/10'
                      : 'border-ink-600 hover:border-gold-600/40'
                  }`}
                >
                  <span className="block text-[12px] text-mist-100">{g.name}</span>
                  <span className="block text-[10px] leading-snug text-mist-500">{g.blurb}</span>
                </button>
              ))}
            </div>
          </div>

          <div>
            <span className="mb-2 block text-[12px] text-mist-400">
              规则预设 <span className="text-mist-500/70">（换规则会重置属性与技能）</span>
            </span>
            <div className="grid grid-cols-2 gap-2">
              {listRulesets().map((r) => (
                <button
                  key={r.id}
                  onClick={() => {
                    if (r.id !== rulesetId) setRuleset(r.id);
                  }}
                  className={`rounded-lg border p-2 text-left transition ${
                    rulesetId === r.id
                      ? 'border-gold-600/70 bg-gold-500/10'
                      : 'border-ink-600 hover:border-gold-600/40'
                  }`}
                >
                  <span className="block text-[12px] text-mist-100">{r.name}</span>
                  <span className="block text-[10px] text-mist-500">{r.mainDice}</span>
                </button>
              ))}
            </div>
            <div className="mt-2 flex items-center gap-1.5">
              <button
                onClick={exportPresets}
                className="rounded-md border border-ink-600 px-2 py-0.5 text-[11px] text-mist-400 transition hover:border-gold-600/50 hover:text-mist-100"
              >
                导出预设
              </button>
              <label className="cursor-pointer rounded-md border border-ink-600 px-2 py-0.5 text-[11px] text-mist-400 transition hover:border-gold-600/50 hover:text-mist-100">
                导入预设
                <input
                  type="file"
                  accept="application/json"
                  className="hidden"
                  onChange={(e) => {
                    const f = e.target.files?.[0];
                    if (f) importPresets(f);
                    e.target.value = '';
                  }}
                />
              </label>
              <span className="text-[10px] text-mist-500/70">分享第三方自定义规则</span>
            </div>
          </div>

          <PresetImporter />

          <details className="rounded-lg border border-ink-700 bg-ink-850/40 p-2.5">
            <summary className="cursor-pointer text-[11px] text-mist-500">
              高级：手写一套自定义规则（不推荐，一般用上面的导入就行）
            </summary>
            <div className="mt-2">
              <CustomRulesetEditor onSaved={() => setCustomVersion((v) => v + 1)} />
            </div>
          </details>

          <GroupTitle
            id="sec-look"
            title="外观与排版"
            hint="主题换配色，排版只影响故事正文的显示方式。"
          />

          <div>
            <span className="mb-2 block text-[12px] text-mist-400">外观主题</span>
            <div className="grid grid-cols-3 gap-2">
              {THEMES.map((t) => (
                <button
                  key={t.id}
                  onClick={() => setTheme(t.id)}
                  className={`rounded-lg border p-2 text-left transition ${
                    theme === t.id
                      ? 'border-gold-600/70 bg-gold-500/10'
                      : 'border-ink-600 hover:border-gold-600/40'
                  }`}
                >
                  <span className="block text-[12px] text-mist-100">{t.name}</span>
                  <span className="block text-[10px] text-mist-500">{t.desc}</span>
                </button>
              ))}
            </div>
          </div>

          <div>
            <span className="mb-2 block text-[12px] text-mist-400">
              正文排版 <span className="text-mist-500/70">（只影响故事正文的显示）</span>
            </span>
            <div className="grid grid-cols-4 gap-2">
              {TYPOGRAPHY_PRESETS.map((p) => {
                const active =
                  typography.scale === p.value.scale &&
                  typography.lineHeight === p.value.lineHeight &&
                  typography.indent === p.value.indent;
                return (
                  <button
                    key={p.id}
                    onClick={() => setTypography(p.value)}
                    className={`rounded-lg border p-2 text-center transition ${
                      active
                        ? 'border-gold-600/70 bg-gold-500/10'
                        : 'border-ink-600 hover:border-gold-600/40'
                    }`}
                  >
                    <span className="block text-[12px] text-mist-100">{p.name}</span>
                  </button>
                );
              })}
            </div>
            <div className="mt-2 grid grid-cols-2 gap-3">
              <label className="block">
                <span className="mb-1 block text-[11px] text-mist-500">
                  字号 {typography.scale.toFixed(2)}×
                </span>
                <input
                  type="range"
                  min={0.9}
                  max={1.4}
                  step={0.05}
                  value={typography.scale}
                  onChange={(e) => setTypography({ scale: Number(e.target.value) })}
                  className="w-full accent-[#b8953f]"
                />
              </label>
              <label className="block">
                <span className="mb-1 block text-[11px] text-mist-500">
                  行距 {typography.lineHeight.toFixed(2)}
                </span>
                <input
                  type="range"
                  min={1.5}
                  max={2.4}
                  step={0.05}
                  value={typography.lineHeight}
                  onChange={(e) => setTypography({ lineHeight: Number(e.target.value) })}
                  className="w-full accent-[#b8953f]"
                />
              </label>
            </div>
            <label className="mt-1 flex items-center gap-2 text-[11px] text-mist-400">
              <input
                type="checkbox"
                checked={typography.indent}
                onChange={(e) => setTypography({ indent: e.target.checked })}
                className="accent-[#b8953f]"
              />
              段落首行缩进两字
            </label>
          </div>

          <GroupTitle
            id="sec-audio"
            title="音频"
            hint="氛围音由代码生成，不用下载文件；判定音效可以换成你自己的梗曲。"
          />

          <div>
            <span className="mb-2 block text-[12px] text-mist-400">
              音频{' '}
              <span className="text-mist-500/70">
                （BGM 可自配，大成功 / 大失败音效可换成你自己的梗）
              </span>
            </span>
            <label className="flex items-center gap-2 text-[12px] text-mist-300">
              <input
                type="checkbox"
                checked={audio.enabled}
                onChange={(e) => setAudio({ enabled: e.target.checked })}
                className="accent-[#b8953f]"
              />
              开启音频
            </label>
            {!audio.enabled && (
              <p className="mt-1.5 text-[10px] leading-relaxed text-mist-500">
                浏览器不允许自动播放，开启后需要你点一下页面任意位置，声音才会出来。
              </p>
            )}

            {audio.enabled && (
              <div className="mt-3 space-y-3">
                <div>
                  <span className="mb-1.5 block text-[11px] text-mist-500">氛围音（BGM）</span>
                  <div className="grid grid-cols-5 gap-1.5">
                    {(Object.keys(AMBIENCE_LABEL) as AmbienceKind[]).map((k) => (
                      <button
                        key={k}
                        onClick={() => setAudio({ ambience: k })}
                        className={`rounded-md border px-1 py-1.5 text-[11px] transition ${
                          audio.ambience === k
                            ? 'border-gold-600/70 bg-gold-500/10 text-gold-300'
                            : 'border-ink-600 text-mist-400 hover:border-gold-600/40'
                        }`}
                      >
                        {AMBIENCE_LABEL[k]}
                      </button>
                    ))}
                  </div>
                </div>

                <div className="grid grid-cols-3 gap-3">
                  <label className="block">
                    <span className="mb-1 block text-[11px] text-mist-500">
                      总音量 {Math.round(audio.master * 100)}
                    </span>
                    <input
                      type="range"
                      min={0}
                      max={1}
                      step={0.05}
                      value={audio.master}
                      onChange={(e) => setAudio({ master: Number(e.target.value) })}
                      className="w-full accent-[#b8953f]"
                    />
                  </label>
                  <label className="block">
                    <span className="mb-1 block text-[11px] text-mist-500">
                      氛围音 {Math.round(audio.ambienceVol * 100)}
                    </span>
                    <input
                      type="range"
                      min={0}
                      max={1}
                      step={0.05}
                      value={audio.ambienceVol}
                      onChange={(e) => setAudio({ ambienceVol: Number(e.target.value) })}
                      className="w-full accent-[#b8953f]"
                    />
                  </label>
                  <label className="block">
                    <span className="mb-1 block text-[11px] text-mist-500">
                      音效 {Math.round(audio.sfxVol * 100)}
                    </span>
                    <input
                      type="range"
                      min={0}
                      max={1}
                      step={0.05}
                      value={audio.sfxVol}
                      onChange={(e) => setAudio({ sfxVol: Number(e.target.value) })}
                      className="w-full accent-[#b8953f]"
                    />
                  </label>
                </div>

                <div>
                  <span className="mb-1.5 block text-[11px] text-mist-500">
                    判定音效 <span className="text-mist-500/70">（不传就用内置的程序化音效）</span>
                  </span>
                  <div className="space-y-1.5">
                    {/* 全部槽位：每一件事都能配自己的音；不传就用内置的程序化音效 */}
                    {SFX_SLOTS.map((slot) => (
                      <AudioFileRow key={slot} label={SFX_LABEL[slot]} storageKey={`sfx.${slot}`} />
                    ))}
                  </div>
                </div>

                <div>
                  <span className="mb-1.5 block text-[11px] text-mist-500">
                    自配 BGM <span className="text-mist-500/70">（可上传本地文件，或填直链）</span>
                  </span>
                  <div className="space-y-1.5">
                    <AudioFileRow label="本地音乐文件" storageKey="bgm" />
                    <div className="flex gap-1.5">
                      <input
                        className={inputCls}
                        value={audio.bgmUrl === 'idb:bgm' ? '' : audio.bgmUrl}
                        onChange={(e) => setAudio({ bgmUrl: e.target.value.trim() })}
                        placeholder="或填音频直链 https://..."
                      />
                      <button
                        onClick={() => setAudio({ bgmUrl: 'idb:bgm' })}
                        className="shrink-0 rounded-md border border-ink-600 px-2.5 text-[11px] text-mist-400 transition hover:border-gold-600/50 hover:text-mist-100"
                      >
                        用上传的
                      </button>
                    </div>
                  </div>
                </div>

                {/*
                 * 存储占用：上传的音频走 IndexedDB，浏览器给的额度有限。
                 * 以前超限只在 console 里 warn，玩家只看到"上传没反应"——必须说出来。
                 */}
                <AudioStorageMeter />
              </div>
            )}
          </div>

          <GroupTitle
            id="sec-api"
            title="模型与接口"
            hint="填好服务商、API Key 与模型名就能开团。生图是可选功能，留空就关闭。"
          />

          <div>
            <span className="mb-2 block text-[12px] text-mist-400">服务商预设</span>
            <div className="flex flex-wrap gap-1.5">
              {PRESETS.map((p) => (
                <button
                  key={p.name}
                  onClick={() => setConfig({ baseUrl: p.baseUrl, model: p.model })}
                  className="rounded-md border border-ink-600 bg-ink-850 px-2.5 py-1 text-[12px] text-mist-300 transition hover:border-gold-600/50 hover:text-mist-100"
                >
                  {p.name}
                </button>
              ))}
            </div>
          </div>

          <Field label="API 地址">
            <input
              className={inputCls}
              value={config.baseUrl}
              onChange={(e) => setConfig({ baseUrl: e.target.value })}
              placeholder="https://api.deepseek.com/v1"
            />
          </Field>

          <Field label="API Key" hint="保存在本机浏览器，不会上传到任何地方">
            <input
              className={inputCls}
              type="password"
              value={config.apiKey}
              onChange={(e) => setConfig({ apiKey: e.target.value })}
              placeholder="sk-..."
            />
          </Field>

          <Field label="模型名称">
            <input
              className={inputCls}
              value={config.model}
              onChange={(e) => setConfig({ model: e.target.value })}
            />
          </Field>

          <div className="grid grid-cols-2 gap-3">
            <Field label={`温度 ${config.temperature}`}>
              <input
                type="range"
                min={0}
                max={1.5}
                step={0.05}
                value={config.temperature}
                onChange={(e) => setConfig({ temperature: Number(e.target.value) })}
                className="w-full accent-[#b8953f]"
              />
            </Field>
            <Field label="最大输出">
              <input
                className={inputCls}
                type="number"
                value={config.maxTokens}
                onChange={(e) => setConfig({ maxTokens: Number(e.target.value) })}
              />
            </Field>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <Field
              label={
                config.topP == null ? 'top_p（默认）' : `top_p ${config.topP.toFixed(2)}`
              }
            >
              <input
                type="range"
                min={0}
                max={1}
                step={0.05}
                value={config.topP ?? 0}
                onChange={(e) => setConfig({ topP: Number(e.target.value) })}
                className="w-full accent-[#b8953f]"
              />
            </Field>
            <label className="mt-1 flex items-center gap-2 text-[11px] text-mist-400">
              <input
                type="checkbox"
                checked={config.thinking === true}
                onChange={(e) => setConfig({ thinking: e.target.checked })}
                className="accent-[#b8953f]"
              />
              开启思考模式（会慢且费 token）
            </label>
          </div>

          <div className="border-t border-ink-700 pt-4">
            <span className="mb-2 block text-[12px] text-mist-400">生图（立绘）</span>
            <div className="grid grid-cols-2 gap-3">
              <Field label="生图模型">
                <input
                  className={inputCls}
                  value={config.imageModel ?? ''}
                  onChange={(e) => setConfig({ imageModel: e.target.value })}
                  placeholder="black-forest-labs/FLUX.1-schnell"
                />
              </Field>
              <Field label="尺寸">
                <input
                  className={inputCls}
                  value={config.imageSize ?? '1024x1024'}
                  onChange={(e) => setConfig({ imageSize: e.target.value })}
                />
              </Field>
            </div>
            <p className="mt-1.5 text-[11px] leading-relaxed text-mist-500/80">
              生图与对话共用同一个 API 地址和 Key，只是模型不同。硅基流动可用{' '}
              <code className="rounded bg-ink-700 px-1">black-forest-labs/FLUX.1-schnell</code>{' '}
              （快）或{' '}
              <code className="rounded bg-ink-700 px-1">Kwai-Kolors/Kolors</code>。留空则关闭生图。
            </p>
          </div>

          <div className="flex items-center gap-3 rounded-lg border border-ink-700 bg-ink-850 p-3">
            <button
              onClick={test}
              className="shrink-0 rounded-lg border border-gold-600/50 px-3 py-1.5 text-[12px] text-gold-400 transition hover:bg-gold-500/10"
            >
              测试连接
            </button>
            {testMsg && (
              <span
                className={`text-[11px] leading-snug ${
                  testing === 'ok'
                    ? 'text-moss-400'
                    : testing === 'fail'
                      ? 'text-blood-400'
                      : 'text-mist-400'
                }`}
              >
                {testMsg}
              </span>
            )}
          </div>

          <GroupTitle
            id="sec-data"
            title="数据与存档"
            hint="进度存在本机浏览器里。手机长期不访问可能被系统清理，建议定期导出备份。"
          />

          <div>
            <span className="mb-2 block text-[12px] text-mist-400">存档与记录</span>
            <div className="flex flex-wrap gap-2">
              <button className={smallBtn} onClick={copyLog}>
                复制对话记录
              </button>
              <button className={smallBtn} onClick={exportSave}>
                导出存档
              </button>
              <label className={`${smallBtn} cursor-pointer`}>
                导入存档
                <input
                  type="file"
                  accept="application/json"
                  className="hidden"
                  onChange={(e) => {
                    const f = e.target.files?.[0];
                    if (f) importSave(f);
                    e.target.value = '';
                  }}
                />
              </label>
              <button
                className={`${smallBtn} hover:border-blood-400/60 hover:text-blood-400`}
                onClick={() => setConfirmReset(true)}
              >
                清空重开
              </button>
            </div>
            <p className="mt-2 text-[11px] leading-relaxed text-mist-500">
              「复制对话记录」可直接粘贴给开发者排查问题。「导出存档」用于备份——手机浏览器在长期不访问时可能清理本地数据。
            </p>

            <div className="mt-3">
              <span className="mb-1.5 block text-[11px] text-mist-500">
                存档槽 <span className="text-mist-500/70">（想同时开几局，就用槽位切换）</span>
              </span>
              <div className="flex gap-1.5">
                <input
                  className={inputCls}
                  value={slotName}
                  onChange={(e) => setSlotName(e.target.value)}
                  placeholder="给这一局起个名字…"
                />
                <button
                  onClick={saveToSlot}
                  className="shrink-0 rounded-md bg-gold-500 px-3 py-1.5 text-[12px] font-medium text-ink-950 transition hover:bg-gold-400"
                >
                  存当前
                </button>
              </div>
              {slots.length > 0 && (
                <ul className="mt-2 space-y-1">
                  {slots.map((sl) => (
                    <li
                      key={sl.id}
                      className="flex items-center justify-between gap-2 rounded-md bg-ink-850 px-2.5 py-1.5"
                    >
                      <div className="min-w-0">
                        <div className="truncate text-[12px] text-mist-300">{sl.name}</div>
                        <div className="truncate text-[10px] text-mist-500">
                          {sl.title} · {new Date(sl.savedAt).toLocaleString()}
                        </div>
                      </div>
                      <div className="flex shrink-0 gap-1.5">
                        <button
                          onClick={() => loadSlot(sl.id)}
                          className="rounded-md border border-ink-600 px-2 py-0.5 text-[11px] text-mist-300 transition hover:border-gold-600/50 hover:text-mist-100"
                        >
                          读取
                        </button>
                        <button
                          onClick={() => deleteSlot(sl.id)}
                          className="rounded-md border border-ink-600 px-2 py-0.5 text-[11px] text-mist-500 transition hover:border-blood-400/60 hover:text-blood-400"
                        >
                          删
                        </button>
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>

          <GroupTitle
            id="sec-install"
            title="安装到设备"
            hint="装到手机主屏后没有地址栏、能离线打开，也不容易被系统清掉本地存档。"
          />

          <div>
            {standalone ? (
              <p className="rounded-lg border border-moss-400/40 bg-moss-400/10 px-3 py-2 text-[11px] leading-relaxed text-moss-400">
                已经以「独立应用」的方式在运行了，不用再装一次。
              </p>
            ) : (
              <>
                {installable && (
                  <button
                    onClick={() => void promptInstall()}
                    className="w-full rounded-lg bg-gold-500 px-3 py-2 text-[12px] font-medium text-ink-950 transition hover:bg-gold-400"
                  >
                    安装到本机（一键）
                  </button>
                )}
                <div className="mt-2 space-y-1.5 rounded-lg border border-ink-700 bg-ink-850/60 p-3 text-[11px] leading-relaxed text-mist-400">
                  <p className="text-mist-300">手动添加到主屏：</p>
                  <p>
                    <b className="text-mist-200">iPhone / iPad</b>：用 Safari 打开 → 底部「分享」→
                    「添加到主屏幕」。
                  </p>
                  <p>
                    <b className="text-mist-200">Android</b>：用 Chrome 打开 → 右上角「⋮」→
                    「添加到主屏幕 / 安装应用」。
                  </p>
                  <p>
                    <b className="text-mist-200">电脑</b>：Chrome / Edge 地址栏右侧会出现「安装」图标，
                    点一下就变成一个独立窗口的应用。
                  </p>
                </div>
              </>
            )}
          </div>

          {/*
           * 检查更新：不靠"等服务自己刷新"。
           * 应用平时已经在自动探（启动 / 回到前台 / 每 5 分钟），这里是玩家想要时手动来一发。
           */}
          <div className="rounded-lg border border-ink-700 bg-ink-850/60 p-3">
            <div className="flex items-center justify-between gap-2">
              <span className="text-[11px] text-mist-400">
                当前版本 <span className="font-mono text-gold-400">{versionLabel()}</span>
              </span>
              <button
                onClick={void checkNow}
                disabled={updateState === 'checking'}
                className="shrink-0 rounded-md border border-ink-600 px-2.5 py-1 text-[11px] text-mist-300 transition hover:border-gold-600/50 hover:text-mist-100 disabled:opacity-50"
              >
                {updateState === 'checking' ? '检查中…' : '检查更新'}
              </button>
            </div>
            {updateState === 'newer' ? (
              <button
                onClick={() => void applyUpdate()}
                className="mt-2 w-full rounded-lg bg-gold-500 px-3 py-2 text-[12px] font-medium text-ink-950 transition hover:bg-gold-400"
              >
                发现新版本 · 立即更新（页面会重新加载）
              </button>
            ) : (
              <p className="mt-1 text-[10px] leading-relaxed text-mist-500">
                {updateState === 'latest'
                  ? '已经是最新版本。'
                  : updateState === 'unknown'
                    ? '探测不到版本信息（可能离线，或这份部署还没有 version.json）。想强制拿最新的，用下面这个按钮。'
                    : '打开应用时、以及每次切回前台都会自动检查一次。'}
              </p>
            )}
            {updateState === 'unknown' && (
              <button
                onClick={() => location.reload()}
                className="mt-2 w-full rounded-lg border border-ink-600 px-3 py-1.5 text-[11px] text-mist-300 transition hover:border-gold-600/50 hover:text-mist-100"
              >
                强制重新加载页面
              </button>
            )}
          </div>

          <GroupTitle
            id="sec-dev"
            title="开发者"
            hint="测试沙盒：一键把环境摆好，省得每次测功能都要从头建角色、想模组。"
          />

          <div className="space-y-2">
            <label className="flex items-center gap-2 rounded-lg border border-ink-700 bg-ink-850/60 px-3 py-2">
              <input
                type="checkbox"
                checked={devMode}
                onChange={(e) => setDevMode(e.target.checked)}
                className="accent-[#b8953f]"
              />
              <span className="text-[12px] text-mist-300">开发者模式</span>
              <span className="ml-auto text-[10px] text-mist-500">
                打开后顶栏会出现测试入口
              </span>
            </label>
            <button
              onClick={() => setSandboxOpen(true)}
              className="w-full rounded-lg border border-gold-600/50 px-3 py-2 text-[12px] text-gold-400 transition hover:bg-gold-500/10"
            >
              打开测试沙盒
            </button>
            <p className="text-[10px] leading-relaxed text-mist-500/80">
              沙盒只写本地数据、不发请求、不需要 API Key：可一键灌入完整测试局、切换三套脚本化模组、
              把背包塞满、把数值调到濒死或归零、直接触发结档。测完点「回到出厂状态」即可清掉。
            </p>
          </div>

          <GroupTitle id="sec-keys" title="快捷键" />

          <ul className="space-y-1 text-[11px] text-mist-400">
            {[
              ['Enter', '发送这一轮的输入'],
              ['Shift + Enter', '输入里换行'],
              ['↑（输入框为空时）', '取回上一条自己说过的话'],
              ['Esc', '关闭当前弹层（检定 → 准备 → 设置）'],
              ['Cmd / Ctrl + ,', '打开设置'],
              ['Cmd / Ctrl + 1 / 2 / 3', '切换到 角色 / 故事 / 世界'],
            ].map(([k, v]) => (
              <li key={k} className="flex items-baseline gap-2">
                <code className="shrink-0 rounded bg-ink-800 px-1.5 py-0.5 text-[10px] text-mist-300">
                  {k}
                </code>
                <span>{v}</span>
              </li>
            ))}
          </ul>

          <p className="rounded-lg border border-ink-700 bg-ink-850/60 p-3 text-[11px] leading-relaxed text-mist-500">
            浏览器直连模型需要对方允许跨域（CORS）。多数国内服务商支持；本地 Ollama 需先设置
            <code className="mx-1 rounded bg-ink-700 px-1">OLLAMA_ORIGINS=*</code>
            再重启。若报跨域错误，可以改用本地代理或 OneAPI 之类的中转。
          </p>
        </div>

        {toast && (
          <div className="mt-4 rounded-lg border border-moss-400/40 bg-moss-400/10 px-3 py-2 text-[12px] text-moss-400">
            {toast}
          </div>
        )}
        </div>

      {sandboxOpen && <TestSandbox onClose={() => setSandboxOpen(false)} />}
      {changelogOpen && <ChangelogDialog onClose={() => setChangelogOpen(false)} />}
      {helpOpen && <HelpDialog onClose={() => setHelpOpen(false)} />}

      {confirmReset && (
        <ConfirmDialog
          title="清空重开"
          body="会清空当前剧情、角色卡、设置和进度，从头开始。此操作不可撤销。"
          confirmText="清空"
          danger
          onCancel={() => setConfirmReset(false)}
          onConfirm={resetAll}
        />
      )}
    </div>
  );
}
