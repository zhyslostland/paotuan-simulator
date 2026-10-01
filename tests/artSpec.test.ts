import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import {
  ART_KINDS,
  ART_PALETTE,
  ART_SIZES,
  allPaletteColors,
  aspectOf,
  aspectRatioOf,
  defaultImageSizeFor,
  formatSize,
  isPortraitSize,
  isValidSize,
  sizeParts,
  type ArtKind,
} from '../src/core/artSpec.js';
import { kindLabel, type ImageJobKind } from '../src/ui/imageJobs.js';
import { characterImagePrompt } from '../src/orchestrator/generate.js';
import { getGenre } from '../src/core/genres.js';

/*
 * 阶段 0-2：切图规格守门。
 *
 * 背景：改之前四类图**共用一张 1024×1024 方图** —— 立绘被裁成半身、场景没有广角。
 * 根因不是"忘了传尺寸"，是**规格真源有三处**（Settings 默认值 / store 兜底 / 提示词里的构图文字），
 * 三处各写各的。这组断言钉的是"规格只有一个真源，且四类都对得上"。
 */

describe('H21：切图规格按类型分构图', () => {
  it('每一类都有尺寸，一条不漏（新增 kind 必须补规格）', () => {
    for (const k of ART_KINDS) {
      // 🔴 真判据：不是"有值"，是**真的长成 `768x1024`**（接口 size 字段直接吃这个串）
      expect(ART_SIZES[k], `缺少 ${k} 的尺寸`).toMatch(/^\d+x\d+$/);
    }
    // 反向：规格表里也不该有已经不存在的 kind
    expect(Object.keys(ART_SIZES).sort()).toEqual([...ART_KINDS].sort());
  });

  it('尺寸格式必须是 ASCII 小写 x（直接塞进接口 size 字段）', () => {
    /*
     * 接口要的是 `768x1024`。写成 `768×1024`（乘号）或 `768X1024`（大写）
     * 服务商会当成非法值 —— 而且**未必报错**，可能直接忽略、回一张默认尺寸的图。
     * 这种"看着没错、结果错了"最难查，所以在出门口就钉住。
     */
    for (const k of ART_KINDS) {
      expect(ART_SIZES[k], `${k} 的尺寸格式不对`).toMatch(/^\d+x\d+$/);
    }
  });

  it('三类构图方向正确：立绘竖版 / 场景横版 / 地图与插画方版', () => {
    const portrait = aspectOf(ART_SIZES.portrait)!;
    const scene = aspectOf(ART_SIZES.scene)!;
    const map = aspectOf(ART_SIZES.map)!;
    const action = aspectOf(ART_SIZES.action)!;

    expect(portrait, '立绘必须是竖版').toBeLessThan(1);
    expect(scene, '场景必须是横版').toBeGreaterThan(1);
    expect(map, '地图必须是方版').toBe(1);
    expect(action, '动作插画必须是方版').toBe(1);

    // 具体比例：3:4 与 16:9（不是"差不多"就行 —— 生成器与裁切都按这个走）
    expect(portrait).toBeCloseTo(3 / 4, 5);
    expect(scene).toBeCloseTo(16 / 9, 4);
  });

  it('定版尺寸就是计划里那几个（改了要有意识，别悄悄漂）', () => {
    expect(ART_SIZES.portrait).toBe('768x1024');
    expect(ART_SIZES.scene).toBe('1024x576');
    expect(ART_SIZES.map).toBe('1024x1024');
    expect(ART_SIZES.action).toBe('1024x1024');
  });

  it('defaultImageSizeFor 认得每一类，且不认识的 kind 回落而不抛', () => {
    for (const k of ART_KINDS) expect(defaultImageSizeFor(k)).toBe(ART_SIZES[k]);
    // 兜底：宁可给一张方图，也不许抛异常把整条生图链打断
    expect(defaultImageSizeFor('nope' as ArtKind)).toBe('1024x1024');
  });

  it('🔴 aspectRatioOf：展示比例必须与生成尺寸同源（立绘被裁头顶的根因）', () => {
    /*
     * 事故：生成尺寸换成了 3:4 竖版，**UI 容器却还是 1:1 方框**
     * → `object-cover` 上下各裁一半 → 玩家看到「头顶少一截」。
     * 生成对了、展示没对，等于没对。
     *
     * 这条断言钉的是"两边同源"：展示比例不能各自写死。
     */
    expect(aspectRatioOf('portrait')).toBe('768 / 1024');
    expect(aspectRatioOf('scene')).toBe('1024 / 576');
    expect(aspectRatioOf('map')).toBe('1024 / 1024');
    expect(aspectRatioOf('action')).toBe('1024 / 1024');

    // 每一类的展示比例都必须与它自己的尺寸算出来的比例一致
    for (const k of ART_KINDS) {
      const p = sizeParts(ART_SIZES[k])!;
      expect(aspectRatioOf(k)).toBe(`${p.w} / ${p.h}`);
    }
    // 立绘必须是竖的（方框就是那个 bug）
    const [pw, ph] = aspectRatioOf('portrait').split('/').map((s) => Number(s.trim()));
    expect(pw! / ph!).toBeCloseTo(3 / 4, 5);
  });

  it('UI 的 ImageJobKind 与 core 的 ArtKind 是同一套（两边不许各写各的）', () => {
    /*
     * 这一条是**编译期就该拦住的错**（类型别名），这里再跑一遍是为了防
     * "有人把 imageJobs 改回自己定义 union" —— 那种情况下 core 加一个 kind、
     * ui 不知道 → 新类型没有尺寸、静默拿方图。
     */
    const all: ImageJobKind[] = ['action', 'scene', 'map', 'portrait'];
    for (const k of all) expect(ART_SIZES[k], `${k} 在 core 里没有尺寸`).toMatch(/^\d+x\d+$/);
    expect(all.sort()).toEqual([...ART_KINDS].sort());
  });

  it('每一类都有中文名（队列角标要显示）', () => {
    // 🔴 真判据：角标上写的是给人看的中文，不许退化成裸 key
    for (const k of ART_KINDS) expect(kindLabel(k), `${k} 没有中文名`).toMatch(/[\u4e00-\u9fa5]/);
  });
});

describe('H21 附：尺寸解析与展示', () => {
  it('sizeParts 认得 x 与 ×，认不出返回 null 而不抛', () => {
    expect(sizeParts('1024x576')).toEqual({ w: 1024, h: 576 });
    expect(sizeParts('1024×576')).toEqual({ w: 1024, h: 576 });
    expect(sizeParts('1024 X 576')).toEqual({ w: 1024, h: 576 });
    expect(sizeParts('')).toBeNull();
    expect(sizeParts('auto')).toBeNull();
    expect(sizeParts('1024')).toBeNull();
    expect(sizeParts('0x100')).toBeNull();
    expect(sizeParts('-100x100')).toBeNull();
  });

  it('formatSize 给人看的是乘号，认不出就原样返回', () => {
    expect(formatSize('1024x576')).toBe('1024×576');
    expect(formatSize('auto')).toBe('auto');
  });

  it('isPortraitSize 只判方向，不写死比例（以后微调尺寸不该失效）', () => {
    expect(isPortraitSize('768x1024')).toBe(true);
    expect(isPortraitSize('832x1216')).toBe(true);
    expect(isPortraitSize('1024x576')).toBe(false);
    expect(isPortraitSize('1024x1024')).toBe(false);
    expect(isPortraitSize('乱写')).toBe(false);
  });

  it('isValidSize 是设置页判据（脏数据不该被判成合法）', () => {
    for (const k of ART_KINDS) expect(isValidSize(ART_SIZES[k])).toBe(true);
    expect(isValidSize('')).toBe(false);
    expect(isValidSize('很大')).toBe(false);
  });
});

describe('H23：立绘不许被裁头顶（2026-09-26 的 bug）', () => {
  /**
   * 把注释剥掉再扫。
   *
   * 🔥 H20 的教训：我写过一条"扫整份源码"的断言，结果被**自己写的解释性注释**
   * （"以前这里写死 `aspect-square`…"）判了假红。**注释里提旧代码是正常的**，
   * 所以扫源码前必须先剥注释。
   */
  const stripComments = (s: string) =>
    s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');

  const read = (p: string) => readFileSync(new URL(`../src/ui/${p}`, import.meta.url), 'utf8');

  it('第一道防线：ImageField 的展示比例按图类型算，不写死', () => {
    const src = stripComments(read('ImageField.tsx'));
    expect(src, 'ImageField 必须用 aspectRatioOf 算比例').toContain('aspectRatioOf(');
    // 不许再有写死的方框类名
    expect(src).not.toContain('aspect-square');
  });

  it('第一道防线：角色卡的主角立绘是 3:4（不是方框）', () => {
    const src = stripComments(read('CharacterSheet.tsx'));
    expect(src).toContain('aspect-[3/4]');
    expect(src).not.toMatch(/portrait[\s\S]{0,400}aspect-square/);
  });

  it('第二道防线：立绘提示词明说"头部完整、上方留白、不要特写"', () => {
    const p = characterImagePrompt(
      { name: '阿岚', gender: '女', description: '短发少女' },
      getGenre('coc')
    );
    expect(p).toContain('头部完整不被裁切');
    expect(p).toContain('headroom');
    expect(p).toContain('not cropped at the top');
    expect(p).toContain('not a close-up');
  });

  it('两道防线是**同源**的：展示比例必须等于生成比例', () => {
    // 立绘生成 3:4 → 展示也必须是 3:4（写死 1:1 就是那个 bug）
    const [w, h] = aspectRatioOf('portrait').split('/').map((s) => Number(s.trim()));
    expect(w! / h!).toBeCloseTo(3 / 4, 5);
    expect(ART_SIZES.portrait).toBe('768x1024');
  });
});

describe('H21 附：色板（阶段 0-1）', () => {
  it('所有色值都是合法 6 位十六进制', () => {
    for (const c of allPaletteColors()) {
      expect(c, `${c} 不是合法色值`).toMatch(/^#[0-9a-f]{6}$/i);
    }
  });

  it('主色 / 辅色 / 阴影各 3-5 色（计划里的交付口径）', () => {
    expect(ART_PALETTE.primary.length).toBeGreaterThanOrEqual(3);
    expect(ART_PALETTE.primary.length).toBeLessThanOrEqual(5);
    expect(ART_PALETTE.secondary.length).toBeGreaterThanOrEqual(3);
    expect(ART_PALETTE.secondary.length).toBeLessThanOrEqual(5);
    expect(ART_PALETTE.shadow.length).toBeGreaterThanOrEqual(3);
    expect(ART_PALETTE.shadow.length).toBeLessThanOrEqual(5);
  });

  it('描边不是纯黑、高光不是纯白（赛璐璐的关键规矩）', () => {
    /*
     * 纯黑描边在浅底上显硬、在暗底上显脏；纯白高光会把色块打穿。
     * 这是"同一质感"的来源之一，别被人"顺手改成 #000 / #fff"。
     */
    expect(ART_PALETTE.line.toLowerCase()).not.toBe('#000000');
    for (const h of ART_PALETTE.highlight) expect(h.toLowerCase()).not.toBe('#ffffff');
  });

  it('阴影是**有彩色**的深色，不是灰阶（不用纯黑压暗）', () => {
    for (const s of ART_PALETTE.shadow) {
      const r = Number.parseInt(s.slice(1, 3), 16);
      const g = Number.parseInt(s.slice(3, 5), 16);
      const b = Number.parseInt(s.slice(5, 7), 16);
      // 有彩色：RGB 三通道不全等（灰阶的判据）
      expect(Math.max(r, g, b) - Math.min(r, g, b), `${s} 看着是灰阶`).toBeGreaterThan(8);
      // 深色：亮度明显低于中间调
      expect((r + g + b) / 3, `${s} 不够深`).toBeLessThan(120);
    }
  });

  it('色板刻意不进生图提示词（进了会压掉题材差异）', () => {
    /*
     * 这条守的是**设计决定**，不是实现细节：
     * 提示词里塞十六进制值，模型的响应很弱，却会把七个题材拉成同一个色调。
     * 题材色彩归各 `genre.imageStyle` 管 —— 谁要是把色板拼进 `styleOf()`，这条会红。
     */
    const gen = readFileSync(new URL('../src/orchestrator/generate.ts', import.meta.url), 'utf8');
    expect(gen).not.toContain('ART_PALETTE');
    expect(gen).not.toMatch(/#[0-9a-f]{6}/i);
  });
});
