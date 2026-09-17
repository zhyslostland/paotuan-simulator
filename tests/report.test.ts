/**
 * 带图战报（G）的断言。
 *
 * 两条是硬红线，必须钉死：
 *   ① **不含 `module.truth`** —— 战报是会被转发的，默认不剧透；
 *   ② **转义** —— 里面的文本是玩家和模型写的自由内容，直接拼进 HTML 就是 XSS。
 */
import { describe, expect, it } from 'vitest';
import { buildIllustratedReportHtml, type ExportInput } from '../src/ui/exportGame.js';
import type { GameState } from '../src/core/state/gameState.js';

const gs = (ending?: GameState['ending']): GameState =>
  ({ clues: [], fought: [], vitals: {}, inventory: [], companions: [], npcsAlive: [], threads: [], flags: {}, visited: [], location: '', combat: { active: false, round: 0, foes: [] }, ending } as unknown as GameState);

const base = (patch: Partial<ExportInput> = {}): ExportInput => ({
  character: { name: '林砚', characteristics: {}, skills: {} },
  module: { title: '雾港的灯', truth: '**这是守密人的真相，绝不该出现在战报里**' },
  gameState: gs({ kind: 'success', text: '结局正文', at: '2026-09-17T12:00:00.000Z' }),
  chronicle: [],
  summary: '',
  anchors: [],
  ...patch,
});

describe('带图战报：内容与红线', () => {
  it('出的是完整 HTML 文档，带模组名与角色名', () => {
    const html = buildIllustratedReportHtml(base());
    expect(html.startsWith('<!DOCTYPE html>')).toBe(true);
    expect(html).toContain('雾港的灯');
    expect(html).toContain('林砚');
  });

  it('**绝不包含守密人真相**（导出物会被转发）', () => {
    const html = buildIllustratedReportHtml(base());
    expect(html).not.toContain('守密人的真相');
    expect(html).not.toContain('绝不该出现在战报里');
  });

  it('画面被串进来，图片内嵌（自包含）', () => {
    const html = buildIllustratedReportHtml(
      base({
        scenes: [
          { label: '第 1 个画面', text: '门开了。', image: 'data:image/png;base64,AAAA' },
          { label: '第 2 个画面', text: '走廊尽头有人。' },
        ],
      })
    );
    expect(html).toContain('data:image/png;base64,AAAA');
    expect(html).toContain('门开了。');
    expect(html).toContain('共 2 个画面');
  });

  it('没有配图时给一句人话，而不是空白', () => {
    const html = buildIllustratedReportHtml(base());
    expect(html).toContain('没有留下配图');
  });

  it('**转义**：正文里的尖括号不会被当成标签执行', () => {
    const html = buildIllustratedReportHtml(
      base({ scenes: [{ text: '<script>alert(1)</script>' }] })
    );
    expect(html).not.toContain('<script>alert(1)</script>');
    expect(html).toContain('&lt;script&gt;');
  });

  it('模组标题里的尖括号同样转义（标题也是自由文本）', () => {
    const html = buildIllustratedReportHtml(base({ module: { title: '<b>x</b>' } }));
    expect(html).toContain('&lt;b&gt;');
  });

  it('段落：正文里的换行会被拆成真正的 <p>', () => {
    const html = buildIllustratedReportHtml(base({ scenes: [{ text: '第一段\n第二段' }] }));
    expect(html).toContain('第一段</p><p>第二段');
  });

  it('没有结局时不硬编一个"终幕"', () => {
    const html = buildIllustratedReportHtml(base({ gameState: gs(undefined) }));
    expect(html).not.toContain('终幕 ·');
  });
});
