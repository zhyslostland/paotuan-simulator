/**
 * 关键人物头像提示词（阶段 2 · 计划 2-3）—— **方版**，且"画谁"只认一处。
 *
 * 这一组守三件事：
 *   ① **吃外貌锚点**：有关键人物的 `appearance` 就用它；没有才退回 `role`
 *      （老模组提示词不许因此变味 —— 与主角/队友同一条口径）；
 *   ② **方版取景**：必须带上 `AVATAR_FRAMING_RULE` 的特征词，
 *      且**不许**出现竖版立绘那套（"medium shot"）—— 拿错规格会把脸裁掉；
 *   ③ **画风同源**：与其它品类共用 `styleOf()`（赛璐璐那串英文硬约束必须在）。
 *
 * 纯函数，import 即可测。
 */

import { describe, expect, it } from 'vitest';
import { AVATAR_FRAMING_RULE, PORTRAIT_FRAMING_RULE, npcAvatarPrompt } from '../src/orchestrator/generate.js';
import { getGenre } from '../src/core/genres.js';

const COC = getGenre('coc');

describe('阶段 2 · npcAvatarPrompt：方版头像', () => {
  it('有关键人物的外貌锚点时，逐字进提示词', () => {
    const p = npcAvatarPrompt(
      { name: '老陈', appearance: '五十来岁的瘦高男人，灰白短发，穿洗旧的蓝布工装' },
      COC
    );
    expect(p).toContain('五十来岁的瘦高男人，灰白短发，穿洗旧的蓝布工装');
    expect(p).toContain('老陈');
  });

  it('没有 appearance 时退回 role（老模组不变味，一处取法）', () => {
    const p = npcAvatarPrompt({ name: '老陈', role: '码头工头' }, COC);
    expect(p).toContain('码头工头');
  });

  it('都没有时给一个中性默认，不许拼出空串', () => {
    const p = npcAvatarPrompt({ name: '老陈' }, COC);
    expect(p).toContain('一名人物');
    expect(p.length).toBeGreaterThan(20);
  });

  it('方版取景必须写进提示词', () => {
    const p = npcAvatarPrompt({ name: '老陈', appearance: '瘦高男人' }, COC);
    // 取特征词而不是整串比较：文案可以打磨，规格不许丢
    expect(AVATAR_FRAMING_RULE).toContain('head and shoulders centered');
    expect(p).toContain('只画头部与肩膀');
    expect(p).toContain('not a full body shot');
  });

  it('不许混进竖版立绘那套取景（规格串错会把脸裁掉）', () => {
    const p = npcAvatarPrompt({ name: '老陈', appearance: '瘦高男人' }, COC);
    expect(p).not.toContain('medium shot');
    expect(PORTRAIT_FRAMING_RULE).toContain('medium shot');
  });

  it('画风与其它品类同源（赛璐璐硬约束在）', () => {
    const p = npcAvatarPrompt({ name: '老陈', appearance: '瘦高男人' }, COC);
    expect(p).toContain('cel shading');
    expect(p).toContain('distinct black outline line art');
  });

  it('题材没给时不炸，仍给出可用的提示词', () => {
    const p = npcAvatarPrompt({ name: '老陈', appearance: '瘦高男人' });
    expect(p).toContain('瘦高男人');
    expect(p).toContain('cel shading');
  });
});
