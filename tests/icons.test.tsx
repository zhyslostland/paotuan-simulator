/**
 * 图标集的一致性守门（阶段 1-1）
 *
 * ## 为什么这套东西值得一整个测试文件
 * 图标集的价值**全部在"一致性"上** —— 20 个图标线条粗细不同、圆角半径不同，
 * 摆在一条页签里比没有图标更难看。而一致性是最容易在后续"随手加一个图标"时被破坏的：
 * 新来的人 copy 一个旧图标改了路径，顺手把 `strokeWidth` 写成了 2，
 * **没有任何测试会红，但界面从此就不齐了**。
 *
 * 所以这里逐条钉住"同一套线条与圆角"：渲染出来**每一个**图标，
 * 检查它带的是同一组属性。加新图标忘了照抄骨架 → 立刻红。
 *
 * 用 SSR 渲染**真实产物**（不是扫源码）：扫源码会被注释和换行骗到，
 * 渲染出来的属性才是玩家真正看到的。
 */
import { describe, expect, it } from 'vitest';
import { ICONS, ICON_COUNT, type IconName } from '../src/ui/icons.js';

const { renderToStaticMarkup } = await import('react-dom/server.browser');

/** 渲一个图标，返回它的 svg 标签串 */
function render(name: IconName, size?: number): string {
  const Icon = ICONS[name];
  return renderToStaticMarkup(<Icon size={size} />);
}

const ALL = Object.keys(ICONS) as IconName[];

/**
 * 计划（`美术制作计划.md` 1-1）里**点名要**的那 20 个。
 * 它们一个都不能少 —— 后来接界面时又补了 5 个（烧瓶/音量/停止/帮助），
 * 所以总数是 `>=`，但**这 20 个是硬底线**。
 */
const PLANNED_ICONS = [
  'bag',
  'map',
  'clue',
  'skills',
  'dice',
  'quest',
  'settings',
  'save',
  'companions',
  'combat',
  'profile',
  'location',
  'book',
  'card',
  'trophy',
  'image',
  'update',
  'warning',
  'close',
  'folder',
] as const;

describe('H24：图标集是"同一套线条与圆角"', () => {
  it('计划点名的 20 个一个不缺', () => {
    for (const n of PLANNED_ICONS) {
      expect(ALL, `${n} 不在图标集里`).toContain(n);
    }
    expect(ICON_COUNT).toBeGreaterThanOrEqual(20);
  });

  it('每个都能画出来（不是空壳）', () => {
    for (const name of ALL) {
      const html = render(name);
      expect(html, `${name} 没渲染出 svg`).toContain('<svg');
      // 至少要有一笔几何（circle / path / rect）
      expect(html, `${name} 是空的`).toMatch(/<(path|circle|rect)/);
    }
  });

  it('🔴 全部共用同一个坐标系 0 0 24 24', () => {
    for (const name of ALL) {
      expect(render(name), `${name} 的 viewBox 不一致`).toContain('viewBox="0 0 24 24"');
    }
  });

  it('🔴 全部同一个线宽（1.75）—— 粗细不一是最难看的失衡', () => {
    for (const name of ALL) {
      expect(render(name), `${name} 的 stroke-width 不一致`).toContain('stroke-width="1.75"');
    }
  });

  it('🔴 全部圆头圆角（这是"圆角一致"的实际含义）', () => {
    for (const name of ALL) {
      const html = render(name);
      expect(html, `${name} 的 linecap 不一致`).toContain('stroke-linecap="round"');
      expect(html, `${name} 的 linejoin 不一致`).toContain('stroke-linejoin="round"');
    }
  });

  it('🔴 全部默认不填充 + 走 currentColor（主题改了自动跟）', () => {
    for (const name of ALL) {
      const html = render(name);
      expect(html, `${name} 的 fill 不一致`).toContain('fill="none"');
      expect(html, `${name} 没跟随文字色`).toContain('stroke="currentColor"');
    }
  });

  it('尺寸可调：默认 20，传了就用传的（三档都不糊是矢量的天然优势）', () => {
    for (const name of ALL) {
      expect(render(name)).toContain('width="20"');
      expect(render(name)).toContain('height="20"');
      for (const size of [24, 32, 48]) {
        const html = render(name, size);
        expect(html, `${name} 在 ${size}px 下尺寸不对`).toContain(`width="${size}"`);
        expect(html).toContain(`height="${size}"`);
      }
    }
  });

  it('🔴 没有硬编码颜色 —— 有一个就会在换主题时变成"钉死的色块"', () => {
    for (const name of ALL) {
      const html = render(name);
      // 允许 `fill="currentColor"`（实心小点），但不许出现具体色值
      expect(html, `${name} 里写了硬编码颜色`).not.toMatch(/(?:fill|stroke)="#/i);
    }
  });

  it('图标是装饰：带 aria-hidden（语义由旁边的文字承担）', () => {
    for (const name of ALL) {
      expect(render(name), `${name} 缺 aria-hidden`).toContain('aria-hidden="true"');
    }
  });

  it('不是 emoji（各平台字形不同、无法统一线条与颜色）', () => {
    for (const name of ALL) {
      const html = render(name);
      // emoji 会以文本节点形式出现；这些图标里不该有任何非 ASCII 文本
      const text = html.replace(/<[^>]*>/g, '');
      expect(text, `${name} 里混进了文字/emoji`).toBe('');
    }
  });
});

describe('H24 附：图标已接进界面', () => {
  it('角色卡的技能 / 背包区块标题用上了图标', async () => {
    const { readFileSync } = await import('node:fs');
    const src = readFileSync(new URL('../src/ui/CharacterSheet.tsx', import.meta.url), 'utf8');
    expect(src).toContain('<SectionTitle icon="dice"');
    expect(src).toContain('<SectionTitle icon="bag"');
  });

  it('顶栏的 emoji / 裸字符已换成图标（🔊🔈⏹🧪 与孤零零的问号）', async () => {
    const { readFileSync } = await import('node:fs');
    const src = readFileSync(new URL('../src/ui/App.tsx', import.meta.url), 'utf8');
    expect(src).toContain('<IconHelp');
    expect(src).toContain('<IconVolumeOn');
    expect(src).toContain('<IconStop');
    expect(src).toContain('<IconFlask');
    /*
     * 剥注释再查 —— H20/H23 的教训：**注释里提旧写法是正常的**，
     * 不剥会把"以前这里写的是 🔊"判成假红。
     */
    const code = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');
    for (const emoji of ['🔊', '🔈', '⏹', '🧪']) {
      expect(code, `顶栏还留着 emoji ${emoji}`).not.toContain(emoji);
    }
  });

  it('三个页签已经去掉（主人 2026-09-26 拍板全部展开），别再回来', async () => {
    const { readFileSync } = await import('node:fs');
    const src = readFileSync(new URL('../src/ui/CharacterSheet.tsx', import.meta.url), 'utf8');
    const code = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');
    // 页签的骨架：常量表 + 切换函数 + 条件渲染
    expect(code, 'SHEET_TABS 又回来了').not.toContain('SHEET_TABS');
    expect(code, 'setTab 又回来了').not.toContain('setTab');
  });
});
