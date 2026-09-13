/**
 * 音频：程序化氛围音（BGM）+ 判定音效
 *
 * 为什么默认是"用代码生成"而不是打包音频文件：
 *  1. **版权**——不能内置任何有版权的音乐或音效；
 *  2. **体积**——这是要装到手机上离线跑的 PWA，塞音频会撑爆缓存；
 *  3. **可靠**——代码生成的雨声/风声/心跳永远可用，不依赖外链是否失效。
 *
 * 想听自己的曲子时，用户可以上传本地文件（存 IndexedDB）或填直链来覆盖。
 */

export type AmbienceKind = 'none' | 'rain' | 'wind' | 'heart' | 'drone';
export type SfxSlot = 'critical' | 'fumble';

export const AMBIENCE_LABEL: Record<AmbienceKind, string> = {
  none: '关闭',
  rain: '雨声',
  wind: '风声',
  heart: '心跳',
  drone: '低频嗡鸣',
};

export interface AudioConfig {
  enabled: boolean;
  ambience: AmbienceKind;
  master: number;
  ambienceVol: number;
  sfxVol: number;
  bgmVol: number;
  /** 用户自配 BGM：直链，或 'idb:bgm' 表示用 IndexedDB 里上传的文件 */
  bgmUrl: string;
}

export const DEFAULT_AUDIO: AudioConfig = {
  enabled: false,
  ambience: 'none',
  master: 0.7,
  ambienceVol: 0.5,
  sfxVol: 0.8,
  bgmVol: 0.35,
  bgmUrl: '',
};

const CFG_KEY = 'trpg.audio';

export function loadAudioConfig(): AudioConfig {
  try {
    const raw = localStorage.getItem(CFG_KEY);
    if (!raw) return { ...DEFAULT_AUDIO };
    return { ...DEFAULT_AUDIO, ...(JSON.parse(raw) as Partial<AudioConfig>) };
  } catch {
    return { ...DEFAULT_AUDIO };
  }
}

export function saveAudioConfig(c: AudioConfig): void {
  try {
    localStorage.setItem(CFG_KEY, JSON.stringify(c));
  } catch {
    /* 隐私模式下写不了就算了，不影响玩 */
  }
}

/* ---------------- 音频文件存储（IndexedDB） ---------------- */

const IDB_NAME = 'trpg-audio';
const IDB_STORE = 'files';

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(IDB_NAME, 1);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(IDB_STORE)) db.createObjectStore(IDB_STORE);
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

export async function putAudio(key: string, blob: Blob): Promise<void> {
  const db = await openDb();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(IDB_STORE, 'readwrite');
    tx.objectStore(IDB_STORE).put(blob, key);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

export async function getAudio(key: string): Promise<Blob | null> {
  try {
    const db = await openDb();
    return await new Promise<Blob | null>((resolve, reject) => {
      const tx = db.transaction(IDB_STORE, 'readonly');
      const req = tx.objectStore(IDB_STORE).get(key);
      req.onsuccess = () => resolve((req.result as Blob) ?? null);
      req.onerror = () => reject(req.error);
    });
  } catch {
    return null;
  }
}

export async function delAudio(key: string): Promise<void> {
  const db = await openDb();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(IDB_STORE, 'readwrite');
    tx.objectStore(IDB_STORE).delete(key);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

/* ---------------- Web Audio 引擎 ---------------- */

let ctx: AudioContext | null = null;
let master: GainNode | null = null;
let ambienceGain: GainNode | null = null;
let ambienceNodes: AudioNode[] = [];
let heartTimer: number | null = null;
let bgmEl: HTMLAudioElement | null = null;
let bgmObjectUrl = '';

type WindowWithLegacyAudio = Window & { webkitAudioContext?: typeof AudioContext };

function getCtx(): AudioContext | null {
  if (typeof window === 'undefined') return null;
  if (!ctx) {
    const AC =
      window.AudioContext ?? (window as WindowWithLegacyAudio).webkitAudioContext;
    if (!AC) return null;
    ctx = new AC();
    master = ctx.createGain();
    master.gain.value = 1;
    master.connect(ctx.destination);
  }
  return ctx;
}

/** 浏览器禁止无交互自动播放——任何用户手势后调一次这个把音频唤醒 */
export async function resumeAudio(): Promise<void> {
  const c = getCtx();
  if (c && c.state === 'suspended') {
    try {
      await c.resume();
    } catch {
      /* 用户还没交互过，下次手势再试 */
    }
  }
}

export function setMasterVolume(v: number): void {
  if (master) master.gain.value = Math.max(0, Math.min(1, v));
}

function noiseBuffer(c: AudioContext, seconds = 3): AudioBuffer {
  const len = Math.floor(c.sampleRate * seconds);
  const buf = c.createBuffer(1, len, c.sampleRate);
  const data = buf.getChannelData(0);
  for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;
  return buf;
}

function stopAmbienceNodes(): void {
  ambienceNodes.forEach((n) => {
    try {
      (n as AudioScheduledSourceNode).stop?.();
    } catch {
      /* 已经停了 */
    }
    try {
      n.disconnect();
    } catch {
      /* 已经断了 */
    }
  });
  ambienceNodes = [];
  if (heartTimer !== null) {
    clearInterval(heartTimer);
    heartTimer = null;
  }
  ambienceGain = null;
}

export function stopAmbience(): void {
  stopAmbienceNodes();
}

/** 启动程序化氛围音（BGM）。kind='none' 即停止 */
export function startAmbience(kind: AmbienceKind, vol: number): void {
  const c = getCtx();
  if (!c || !master) return;
  stopAmbienceNodes();
  if (kind === 'none') return;

  const g = c.createGain();
  g.gain.value = Math.max(0, Math.min(1, vol));
  g.connect(master);
  ambienceGain = g;
  ambienceNodes.push(g);

  if (kind === 'rain' || kind === 'wind') {
    const src = c.createBufferSource();
    src.buffer = noiseBuffer(c);
    src.loop = true;
    const filt = c.createBiquadFilter();

    if (kind === 'rain') {
      // 雨：高通滤掉低频轰鸣，再低通柔化刺耳的嘶声
      filt.type = 'highpass';
      filt.frequency.value = 900;
      const lp = c.createBiquadFilter();
      lp.type = 'lowpass';
      lp.frequency.value = 6000;
      src.connect(filt);
      filt.connect(lp);
      lp.connect(g);
      ambienceNodes.push(filt, lp);
    } else {
      // 风：低通 + 极慢 LFO 让呼啸声起伏，不至于像白噪音
      filt.type = 'lowpass';
      filt.frequency.value = 420;
      const lfo = c.createOscillator();
      lfo.frequency.value = 0.08;
      const lfoGain = c.createGain();
      lfoGain.gain.value = 220;
      lfo.connect(lfoGain);
      lfoGain.connect(filt.frequency);
      src.connect(filt);
      filt.connect(g);
      ambienceNodes.push(filt, lfo, lfoGain);
    }
    src.start();
    ambienceNodes.push(src);
    return;
  }

  if (kind === 'drone') {
    // 低频嗡鸣：三个轻微失谐的振荡器，制造"有什么东西在 beneath"的压迫感
    [
      { f: 55, type: 'sawtooth' as OscillatorType, gain: 0.06 },
      { f: 55.6, type: 'sawtooth' as OscillatorType, gain: 0.06 },
      { f: 82.5, type: 'sine' as OscillatorType, gain: 0.12 },
    ].forEach(({ f, type, gain }) => {
      const o = c.createOscillator();
      o.type = type;
      o.frequency.value = f;
      const og = c.createGain();
      og.gain.value = gain;
      const lp = c.createBiquadFilter();
      lp.type = 'lowpass';
      lp.frequency.value = 300;
      o.connect(og);
      og.connect(lp);
      lp.connect(g);
      o.start();
      ambienceNodes.push(o, og, lp);
    });
    return;
  }

  if (kind === 'heart') {
    // 心跳：每 ~850ms 一组"咚—咚"，紧张时会不自觉跟着急
    const beat = () => {
      const c2 = getCtx();
      if (!c2 || !ambienceGain) return;
      [0, 0.16].forEach((off, i) => {
        const t = c2.currentTime + off;
        const o = c2.createOscillator();
        o.type = 'sine';
        const eg = c2.createGain();
        o.frequency.setValueAtTime(64, t);
        o.frequency.exponentialRampToValueAtTime(38, t + 0.12);
        eg.gain.setValueAtTime(0.0001, t);
        eg.gain.exponentialRampToValueAtTime(i === 0 ? 0.9 : 0.6, t + 0.015);
        eg.gain.exponentialRampToValueAtTime(0.0001, t + 0.18);
        o.connect(eg);
        eg.connect(ambienceGain!);
        o.start(t);
        o.stop(t + 0.22);
      });
    };
    beat();
    heartTimer = window.setInterval(beat, 850);
  }
}

/* ---------------- 判定音效 ---------------- */

/** 程序化兜底音效：没上传文件时用这个，保证"有反馈"而不是静悄悄 */
export function playSfxFallback(slot: SfxSlot, vol: number): void {
  const c = getCtx();
  if (!c || !master) return;
  const g = c.createGain();
  g.gain.value = Math.max(0, Math.min(1, vol));
  g.connect(master);
  const t0 = c.currentTime;

  if (slot === 'critical') {
    // 大成功：上扬的大三和弦琶音，明亮得意
    [523.25, 659.25, 783.99, 1046.5].forEach((f, i) => {
      const t = t0 + i * 0.075;
      const o = c.createOscillator();
      o.type = 'triangle';
      o.frequency.value = f;
      const eg = c.createGain();
      eg.gain.setValueAtTime(0.0001, t);
      eg.gain.exponentialRampToValueAtTime(0.5, t + 0.02);
      eg.gain.exponentialRampToValueAtTime(0.0001, t + 0.28);
      o.connect(eg);
      eg.connect(g);
      o.start(t);
      o.stop(t + 0.3);
    });
  } else {
    // 大失败：一路下滑的"哇——"，带点自嘲的滑稽
    const o = c.createOscillator();
    o.type = 'sawtooth';
    const eg = c.createGain();
    o.frequency.setValueAtTime(320, t0);
    o.frequency.exponentialRampToValueAtTime(70, t0 + 0.7);
    const lp = c.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 1200;
    eg.gain.setValueAtTime(0.0001, t0);
    eg.gain.exponentialRampToValueAtTime(0.45, t0 + 0.05);
    eg.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.75);
    o.connect(eg);
    eg.connect(lp);
    lp.connect(g);
    o.start(t0);
    o.stop(t0 + 0.8);
  }
}

/** 播放判定音效：优先用用户上传的文件，没有就退回程序化音效 */
export async function playSfx(slot: SfxSlot, vol: number): Promise<void> {
  await resumeAudio();
  const blob = await getAudio(`sfx.${slot}`);
  if (blob) {
    try {
      const url = URL.createObjectURL(blob);
      const el = new Audio(url);
      el.volume = Math.max(0, Math.min(1, vol));
      el.onended = () => URL.revokeObjectURL(url);
      await el.play();
      return;
    } catch {
      /* 文件坏了就兜底 */
    }
  }
  playSfxFallback(slot, vol);
}

/* ---------------- 用户自配 BGM ---------------- */

export function stopBgm(): void {
  if (bgmEl) {
    bgmEl.pause();
    bgmEl.src = '';
    bgmEl = null;
  }
  if (bgmObjectUrl) {
    URL.revokeObjectURL(bgmObjectUrl);
    bgmObjectUrl = '';
  }
}

/** cfg.bgmUrl 可以是直链，也可以是 'idb:bgm'（用上传的文件） */
export async function startBgm(cfg: AudioConfig): Promise<void> {
  stopBgm();
  if (!cfg.enabled || !cfg.bgmUrl) return;
  let url = cfg.bgmUrl;
  if (url === 'idb:bgm') {
    const blob = await getAudio('bgm');
    if (!blob) return;
    url = URL.createObjectURL(blob);
    bgmObjectUrl = url;
  }
  const el = new Audio(url);
  el.loop = true;
  el.volume = Math.max(0, Math.min(1, cfg.bgmVol));
  try {
    await el.play();
    bgmEl = el;
  } catch {
    /* 自动播放被拦：等下一次用户手势 */
  }
}

export function setBgmVolume(v: number): void {
  if (bgmEl) bgmEl.volume = Math.max(0, Math.min(1, v));
}
