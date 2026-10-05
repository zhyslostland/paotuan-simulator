/**
 * 主题文字对比度（浅底主题的专用守门）。
 *
 * ## 为什么非要有这一条
 * 2026-09-25 主人报「羊皮纸主题文字太淡、读着费劲」。
 * 查下来是**浅底主题的通病**：色值当初是照着暗色主题的**相对关系**配的 ——
 * 暗色里 `--c-text-3` 比 `--c-text` 暗一档就很清楚，浅底上却掉到及格线附近。
 *
 * 实测：羊皮纸 `--c-text-3` 在最差底上只有 **4.13:1**、`--c-muted` 只有 **2.89:1**，
 * 而界面上大量 11-12px 小字用的正是这两档 → 读着当然费劲。
 *
 * ## 为什么测"对比度"而不是测"某个具体色值"
 * 钉死 `#665c4f` 这种写法**管不住以后**：换个人微调色值又被判红，他会把断言删掉。
 * 测**判据本身**（对比度 ≥ 4.5）才是我要守的东西 ——
 * **色值可以改，底线不能破**。
 *
 * ## 判据怎么定
 * - 底取**该主题最不利的那个**（正文可能在 bg / surface / panel 三种底上），
 *   一次过全过，不必逐处判。
 * - 线取 **4.5:1**（WCAG AA 正文）。主线 `--c-text` 与 `--c-text-2` 另设更高线，
 *   它们是**正文**，不该只满足最低档。
 * - `--c-border*` **刻意排除**：边框就该弱，强拉到 4.5 会让界面全是重框。
 *   它另有一条"**别太强**"的护栏（1.05~2.2）。
 *
 * ⚠️ 2026-09-25 主人定：**只留羊皮纸一套**（原来两套暗色已删）。
 * 断言仍按"遍历主题清单"写 —— 加主题时改 `THEMES` 一处即可。
 */
import { readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

/* ── 对比度计算（WCAG 2.x 相对亮度公式，纯函数） ───────────────────────── */

function channelLum(c: number): number {
  const s = c / 255;
  return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
}

function relLum(hex: string): number {
  const h = hex.replace('#', '').trim();
  const r = parseInt(h.slice(0, 2), 16);
  const g = parseInt(h.slice(2, 4), 16);
  const b = parseInt(h.slice(4, 6), 16);
  return 0.2126 * channelLum(r) + 0.7152 * channelLum(g) + 0.0722 * channelLum(b);
}

/** 两色对比度（1 ~ 21） */
export function contrast(a: string, b: string): number {
  const la = relLum(a);
  const lb = relLum(b);
  const hi = Math.max(la, lb);
  const lo = Math.min(la, lb);
  return (hi + 0.05) / (lo + 0.05);
}

/* ── 从 theme.css 里读真源（不硬抄色值，免得两处打架） ────────────────── */

const css = readFileSync(resolve(__dirname, '../src/ui/theme.css'), 'utf8');

/** 抓某个主题块里的一个变量值 */
function varOf(theme: string, name: string): string {
  // 块从 `:root[data-theme='xxx'] {` 起，到下一个顶层 `}` 止
  const blockRe = new RegExp(
    `:root\\[data-theme='${theme}'\\]\\s*\\{([\\s\\S]*?)\\n\\}`,
    'm'
  );
  const block = css.match(blockRe)?.[1];
  if (!block) throw new Error(`theme.css 里找不到主题块：${theme}`);
  const v = block.match(new RegExp(`${name}\\s*:\\s*(#[0-9a-fA-F]{6})`))?.[1];
  if (!v) throw new Error(`主题 ${theme} 里找不到 ${name}`);
  return v;
}

/*
 * 最差底 = 该主题三个底色里"最难看清"的那个。
 * 羊皮纸：bg #f2ece0 最深 → 它就是判据底。
 */
const BACKGROUNDS = ['--c-bg', '--c-surface', '--c-panel'] as const;

/** 取某个文字色在三个底上的**最低**对比度（最坏情况） */
function worstContrast(theme: string, textVar: string): number {
  const fg = varOf(theme, textVar);
  return Math.min(...BACKGROUNDS.map((bgVar) => contrast(fg, varOf(theme, bgVar))));
}

/**
 * 主题清单。
 *
 * ⚠️ **两套**（2026-09-26 主人重申口径）：羊皮纸（浅）+ 午夜（深）。
 * 我曾误读成"只留一套"还删了两套 —— 已恢复。加主题时在这里加，否则新主题不受管。
 */
const THEMES = ['midnight', 'parchment'] as const;

/**
 * 必须达标的**前景色**（除边框外全部）。
 *
 * `--c-border*` 刻意不在里面：边框**就该弱**（有意 1.2~1.8），
 * 强拉到 4.5 会让界面全是重框，那不是"可读"是"刺眼"。
 */
const FG_VARS = [
  '--c-text',
  '--c-text-2',
  '--c-text-3',
  '--c-muted',
  '--c-accent',
  '--c-arcane',
  '--c-danger',
  '--c-success',
] as const;

/* ── 断言 ─────────────────────────────────────────────────────────── */

describe('三套主题 · 每个前景色都要在最差底上 ≥ 4.5:1', () => {
  for (const theme of THEMES) {
    for (const v of FG_VARS) {
      it(`${theme} 的 ${v}`, () => {
        const worst = worstContrast(theme, v);
        /*
         * 失败信息里带上实际值 —— 测试红了要能直接看出"差多少"，
         * 否则还得手算一遍，那就不叫守门叫刁难。
         */
        expect(
          worst,
          `${theme} ${v} = ${varOf(theme, v)}，最差底上只有 ${worst.toFixed(2)}:1`
        ).toBeGreaterThanOrEqual(4.5);
      });
    }
  }
});

describe('羊皮纸（默认主题）的正文档要留余量', () => {
  it('--c-text ≥ 9:1', () => {
    expect(worstContrast('parchment', '--c-text')).toBeGreaterThanOrEqual(9);
  });
  it('--c-text-2 ≥ 6:1', () => {
    expect(worstContrast('parchment', '--c-text-2')).toBeGreaterThanOrEqual(6);
  });
});

describe('三档文字必须确实分出层次（不能为了达标全调成一个颜色）', () => {
  for (const theme of THEMES) {
    it(`${theme} 的三档文字单调且互不相同`, () => {
      const t1 = varOf(theme, '--c-text');
      const t2 = varOf(theme, '--c-text-2');
      const t3 = varOf(theme, '--c-text-3');
      expect(new Set([t1, t2, t3]).size).toBe(3);
      /*
       * 三档亮度**严格单调**（同方向即可）：
       * 浅底是递增（越次要越浅）、暗底是递减（越次要越暗）—— 两套主题方向相反，
       * 所以不写死方向，只要求"确实分了层"。
       * （2026-09-26 恢复午夜时踩的：这断言当年只认浅底方向，午夜一进来就红。）
       */
      const l1 = relLum(t1);
      const l2 = relLum(t2);
      const l3 = relLum(t3);
      const asc = l1 < l2 && l2 < l3;
      const desc = l1 > l2 && l2 > l3;
      expect(asc || desc, '三档文字亮度必须单调（同方向），否则就是没分层').toBe(true);
    });
  }
});

describe('三套主题的语义骨架一致（同一变量名在三套里都存在）', () => {
  /*
   * 这是"统一整理"的**机器判据** —— 以前三套各写各的，缺哪个变量
   * 只会表现为"某个界面切主题后颜色变透明/继承"，很难被发现。
   * 现在缺一个就红。
   */
  const ALL_VARS = [...FG_VARS, '--c-bg', '--c-surface', '--c-panel', '--c-elevated',
    '--c-border', '--c-border-strong'] as const;

  for (const theme of THEMES) {
    it(`${theme} 变量齐全`, () => {
      const missing = ALL_VARS.filter((v) => {
        try {
          varOf(theme, v);
          return false;
        } catch {
          return true;
        }
      });
      expect(missing, `缺：${missing.join(', ')}`).toEqual([]);
    });
  }
});

describe('边框刻意保持弱（有意设计，别"顺手修好"）', () => {
  for (const theme of THEMES) {
    it(`${theme} 的边框对比度在 1.05~2.2 之间`, () => {
      const c = worstContrast(theme, '--c-border');
      expect(c).toBeGreaterThanOrEqual(1.05);
      expect(c).toBeLessThanOrEqual(2.2);
    });
  }
});

describe('对比度算法本身（自检，防公式写错一路绿）', () => {
  it('同色对比度 = 1', () => {
    expect(contrast('#ffffff', '#ffffff')).toBeCloseTo(1, 5);
  });
  it('黑白 = 21', () => {
    expect(contrast('#000000', '#ffffff')).toBeCloseTo(21, 1);
  });
  it('顺序无关', () => {
    expect(contrast('#665c4f', '#f2ece0')).toBeCloseTo(contrast('#f2ece0', '#665c4f'), 10);
  });
});

/*
 * ============================================================
 * 纸纹（阶段 1-2）：强度是**可读性**问题，不是口味问题
 * ============================================================
 *
 * 纸纹铺在 `body` 上，会轻微改变背景的**实际亮度**，压到正文对比度上。
 * 所以这几条钉的不是"它长什么样"，而是"它必须足够轻、并且铺得对"。
 */
/*
 * ============================================================
 * 面板材质（阶段 3 · 2026-10-04 改回内联 SVG）：同理
 * ============================================================
 *
 * `--art-paper` 铺在**面板**上（`.paper-surface`），比整页底纹更靠近正文 ——
 * 强度同理不许超 0.06。它与 `--paper-grain` 是**两个不同的东西**
 * （一个是沙、一个是纤维），所以分开钉，别让将来有人以为"改一个就够"。
 */
describe('面板材质（阶段 3）不许伤到可读性', () => {
  /** 把 `--art-paper` 里那段内联 SVG 抠出来并解码 */
  function panelSvg(): string {
    const m = /--art-paper:\s*url\("data:image\/svg\+xml,([^"]+)"\)/.exec(css);
    const raw = decodeURIComponent(m?.[1] ?? '');
    expect(raw, '找不到 --art-paper 变量（面板材质会静默消失）').toContain('<svg');
    return raw;
  }

  it('🔴 纤维强度 ≤ 0.06（面板比整页底更靠近正文，更不能压对比度）', () => {
    const om = /opacity='([\d.]+)'/.exec(panelSvg());
    expect(om?.[1] ?? '', '面板材质没写 opacity —— 等于全强度').toMatch(/^\d/);
    const alpha = Number(om![1]);
    expect(alpha).toBeGreaterThan(0);
    expect(alpha, `面板材质强度 ${alpha} 太大（上限 0.06）`).toBeLessThanOrEqual(0.06);
  });

  it('用了 stitchTiles=stitch（`.paper-surface` 是平铺的，接缝会露馅）', () => {
    expect(panelSvg()).toContain("stitchTiles='stitch'");
  });

  it('去过色（saturate）—— 默认 feTurbulence 是彩色的，铺在米色纸上像撒彩砂', () => {
    expect(panelSvg()).toContain("type='saturate'");
  });

  it('🔴 午夜主题必须**显式**设 none（漏了会静默继承羊皮纸那张米色纸）', () => {
    /*
     * 2026-10-02 真栽过的坑：`--art-paper` 只在 `:root` 定义过一次，
     * 于是深色主题的每个面板都被糊上一层浅米色，而且**零报错**。
     * 现在它换成了内联 SVG，但"主题专属变量两套都要显式设"这条规矩不变
     * （主题守门第 ③ 条）。
     */
    const midnight = /:root\[data-theme='midnight'\]\s*\{([\s\S]*?)\n\}/.exec(css)?.[1] ?? '';
    expect(midnight, '找不到午夜主题块').toContain('--art-paper: none');
  });

  it('🔴 整页背景图：浓淡两套都要显式设，且不许超过 0.85（它压在正文后面）', () => {
    /*
     * 背景图是**跨主题共用一张**的（`--art-bg` 故意只在 `:root` 定义一次），
     * 但**浓淡**两套各自设 —— 于是按"主题专属变量"那条规矩钉：
     * 漏一套会**静默继承**另一套的值。
     *
     * 🔴 上限为什么是 0.85（2026-10-04 实测改上来的）：
     * 它压在**正文后面**，太浓会把字吃掉 —— 但也不能给太小，因为玩家实际看到的
     * 强度是 `--art-bg-opacity × 面板的不透明度`，**是乘起来**的：
     * 界面几乎全是半透明面板，第一版给了 0.30 × 面板透 10% ≈ 3%，
     * 结果主人反馈「**背景图还是白的**」。所以上限得留出"乘完还看得见"的余地。
     */
    const flat =
      css.match(/:root,\s*\n:root\[data-theme='parchment'\]\s*\{([\s\S]*?)\n\}/)?.[1] ?? '';
    const dark = /:root\[data-theme='midnight'\]\s*\{([\s\S]*?)\n\}/.exec(css)?.[1] ?? '';
    expect(flat, '找不到羊皮纸主题块').not.toBe('');
    expect(dark, '找不到午夜主题块').not.toBe('');
    for (const [name, block] of [
      ['羊皮纸', flat],
      ['午夜', dark],
    ] as const) {
      const v = block.match(/--art-bg-opacity\s*:\s*([\d.]+)/)?.[1] ?? '';
      expect(v, `${name}主题没显式设 --art-bg-opacity（会静默继承另一套）`).not.toBe('');
      const n = Number(v);
      expect(n).toBeGreaterThan(0);
      expect(n, `${name}的背景图浓淡 ${n} 太大（上限 0.85，它在正文后面）`).toBeLessThanOrEqual(0.85);
    }
  });
});

describe('纸纹（阶段 1-2）不许伤到可读性', () => {
  /** 把 `--paper-grain` 里那段内联 SVG 抠出来并解码 */
  function grainSvg(): string {
    const m = /--paper-grain:\s*url\("data:image\/svg\+xml,([^"]+)"\)/.exec(css);
    // 🔴 真判据：抠出来的是**一段真的 SVG**（找不到变量时这里立刻红，不再是"匹配到了就行"）
    const raw = decodeURIComponent(m?.[1] ?? '');
    expect(raw, '找不到 --paper-grain 变量（纸纹会静默消失）').toContain('<svg');
    return raw;
  }

  it('🔴 噪点强度 ≤ 0.06（再高就开始吃正文对比度了）', () => {
    const svg = grainSvg();
    const om = /opacity='([\d.]+)'/.exec(svg);
    // 🔴 真判据：opacity 得是个**数字**（没写 → 这里红，而不是退回 0 把后面两条全掩盖掉）
    expect(om?.[1] ?? '', '纸纹没写 opacity —— 那就等于全强度，会明显压暗背景').toMatch(/^\d/);
    const alpha = Number(om![1]);
    expect(alpha).toBeGreaterThan(0);
    expect(alpha, `纸纹强度 ${alpha} 太大（上限 0.06）`).toBeLessThanOrEqual(0.06);
  });

  it('用了 stitchTiles=stitch（否则平铺会看见方格接缝）', () => {
    expect(grainSvg()).toContain("stitchTiles='stitch'");
  });

  it('噪点去过色（saturate）—— 默认的 feTurbulence 是**彩色**的，铺在米色纸上像撒彩砂', () => {
    expect(grainSvg()).toContain("type='saturate'");
  });

  it('🔴 body 必须用 background-color，不能是简写 background', () => {
    /*
     * `background: var(--c-bg)` 会把 `background-image` 一起重置 → **纸纹静默消失**。
     * 这个错很难发现：页面上看起来只是"没质感"，不像报错。
     */
    const bodyBlock = /body\s*\{[^}]*\}/s.exec(css)?.[0] ?? '';
    // 🔴 真判据：抠到的确实是 **body 的声明块**（找不到 → 后面三条会一起"通过"，那是假绿）
    expect(bodyBlock, '找不到 body 规则').toContain('body');
    expect(bodyBlock).toContain('background-color:');
    expect(bodyBlock).toMatch(/background-image:\s*var\(--paper-/);
    expect(bodyBlock, 'body 用了 background 简写，会把纸纹重置掉').not.toMatch(/(^|\s)background:\s/);
  });

  it('纸纹是内联 SVG，不是位图（位图底纹一张几百 KB，手机端白付）', () => {
    expect(css).toContain('data:image/svg+xml');
    expect(css, '别引位图底纹').not.toMatch(/--paper-[a-z]+:\s*url\("[^"]*\.(png|jpg|jpeg|webp)/);
  });
});

/*
 * ============================================================
 * 两条新守门（2026-09-26 主人点名「你根本没全部查出来」之后的补课）
 * ============================================================
 *
 * 之前这组测试只测「变量 vs 变量」的比值，有两个**大盲区**：
 * ① 源码里用了没在 @theme 定义的色类 → Tailwind v4 不生成 CSS → **继承父色**；
 *    126 处静默失效（属性值用的 mist-200、成就名称用的 gold-300 都在里面），
 *    界面看着淡，但没有任何报错、这里也全绿；
 * ② 文字色带透明度（text-mist-500/70）→ alpha 混底之后对比度直接腰斩，
 *    4.5:1 的 muted 打七折只剩 ~2.6:1，108 处。
 *
 * 下面两条把这两个盲区补上 —— 它们管的是**用法**，不是色值。
 */

/** 递归收集 src 下的 ts/tsx（守门要扫的是**用法**，不是某一个文件） */
function walkSrc(dir: string): string[] {
  const out: string[] = [];
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = resolve(dir, e.name);
    if (e.isDirectory()) out.push(...walkSrc(p));
    else if (/\.(tsx?|css)$/.test(e.name)) out.push(p);
  }
  return out;
}

describe('色类必须在 @theme 里定义（静默失效 = 界面变淡且无报错）', () => {
  const defined = new Set([...css.matchAll(/--color-([a-z]+-\d+):/g)].map((m) => m[1]!));
  const files = walkSrc(resolve(__dirname, '../src'));

  it('🔴 源码里用到的每个色类都已定义', () => {
    const used = new Set<string>();
    for (const f of files) {
      const src = readFileSync(f, 'utf8');
      for (const m of src.matchAll(
        /\b(?:text|bg|border|from|to|via|ring|fill|stroke|decoration|placeholder)-((?:ink|mist|gold|arcane|blood|moss)-\d+)\b/g,
      )) {
        used.add(m[1]!);
      }
    }
    expect(used.size, '一个色类都没扫到 —— 扫描逻辑坏了').toBeGreaterThan(10);
    const missing = [...used].filter((u) => !defined.has(u));
    expect(
      missing,
      `这些色类没在 @theme 里定义，Tailwind 不会生成它们 → 元素继承父色（淡）：${missing.join(', ')}`,
    ).toEqual([]);
  });

  it('🔴 文字色不许带透明度（alpha 混底后对比度腰斩）', () => {
    const offenders: string[] = [];
    for (const f of files) {
      const src = readFileSync(f, 'utf8');
      for (const m of src.matchAll(/\btext-(?:mist|gold|blood|arcane|moss)-\d+\/\d+/g)) {
        offenders.push(`${f.split(/[\\/]/).pop()}: ${m[0]}`);
      }
    }
    expect(
      offenders,
      `文字色带透明度会在浅底上把对比度打穿（4.5 的 muted 打七折只剩 ~2.6）：\n${offenders.join('\n')}`,
    ).toEqual([]);
  });
});
