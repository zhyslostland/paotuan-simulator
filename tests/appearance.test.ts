/**
 * 守门：外貌锚点（美术阶段 2 · 角色立绘的地基）
 *
 * 这组断言盯的是**"画谁"只有一处说法**：
 * 1. `appearance` 优先 —— 它才是专门写给生图看的；
 * 2. 没有它时**退回老拼法，一个字都不许变** —— 老存档的既有立绘靠这条保住；
 * 3. 同一个角色两次取提示词**完全相同** —— 这是"同一张脸"的前提
 *    （模型会随机，但至少喂进去的不能每次都不一样）。
 *
 * ⚠️ 与 H20 同一条教训：**盯真实调用返回值，别扫整份源码**
 * （这么想过一次，结果被自己的注释判了假红）。
 */
import { describe, it, expect } from 'vitest';
import { appearanceOf, hasAppearance } from '../src/core/appearance.js';
import { characterImagePrompt, characterSystemPrompt, companionSystemPrompt } from '../src/orchestrator/generate.js';
import { getGenre } from '../src/core/genres.js';
import { getRuleset } from '../src/core/rulesets/index.js';

/** 一名**老存档**里的队友：压根没有 `appearance` 字段（改之前生成的那种） */
const LEGACY_COMPANION = {
  role: '铁路工',
  personality: '话不多，怕黑但要面子',
};

describe('外貌锚点：优先级', () => {
  it('有 appearance 时吃 appearance（不是混着来历的 description）', () => {
    expect(
      appearanceOf({
        appearance: '寸头，左眉一道疤',
        description: '29 岁的流浪剑客，前王国斥候，因违抗命令被除名',
      })
    ).toBe('寸头，左眉一道疤');
  });

  it('没有 appearance 时退回 description', () => {
    expect(appearanceOf({ description: '29 岁的流浪剑客' })).toBe('29 岁的流浪剑客');
  });

  it('description 也没有时退回「身份。性格」（老队友唯一的信息）', () => {
    expect(appearanceOf(LEGACY_COMPANION)).toBe('铁路工。话不多，怕黑但要面子');
  });

  it('只有身份或只有性格时，有的那半边照用', () => {
    expect(appearanceOf({ role: '老板娘' })).toBe('老板娘');
    expect(appearanceOf({ personality: '爱打听' })).toBe('爱打听');
  });

  it('一片空白就返回空串，让调用方决定画什么样的人', () => {
    expect(appearanceOf({})).toBe('');
    expect(appearanceOf({ appearance: '   ' })).toBe('');
    expect(appearanceOf({ description: '  \n ' })).toBe('');
  });

  it('hasAppearance 只认专门写的那一句', () => {
    expect(hasAppearance({ appearance: '短发' })).toBe(true);
    expect(hasAppearance({ appearance: '  ' })).toBe(false);
    expect(hasAppearance({ description: '短发的侦探' })).toBe(false);
  });
});

describe('立绘提示词：队友不再是"模型脑补的脸"', () => {
  it('老队友（无 appearance）的提示词与改动前逐字一致', () => {
    const before = '铁路工。话不多，怕黑但要面子';
    const p = characterImagePrompt({ name: '老周', description: before }, getGenre('coc'));
    expect(p).toContain(before);
    expect(p).toContain('动漫角色立绘，第三视角半身像');
  });

  it('有外貌锚点时，画的是锚点描述的那个人', () => {
    const p = characterImagePrompt(
      { name: '老周', appearance: '灰白寸头，右脸一道旧疤', description: '铁路工。话不多' },
      getGenre('coc')
    );
    expect(p).toContain('灰白寸头，右脸一道旧疤');
    // 性格不该混进画面描述里 —— 掺一句非外貌的描述，模型每次就会脑补出不同的脸
    expect(p).not.toContain('话不多');
  });

  it('同一个角色两次取提示词完全相同（同一张脸的前提）', () => {
    const c = { name: '阿岚', gender: '女', appearance: '齐肩黑发，眉上有疤', description: '一名侦探' };
    expect(characterImagePrompt(c, getGenre('coc'))).toBe(characterImagePrompt(c, getGenre('coc')));
  });

  it('换了题材会换画风，但画的人还是那句外貌', () => {
    const c = { name: '阿岚', appearance: '齐肩黑发' };
    const coc = characterImagePrompt(c, getGenre('coc'));
    const fantasy = characterImagePrompt(c, getGenre('fantasy'));
    expect(coc).toContain('齐肩黑发');
    expect(fantasy).toContain('齐肩黑发');
    expect(coc).not.toBe(fantasy); // 题材画风不同，不是同一句话
  });
});

describe('AI 生成契约：外貌随卡一并产出', () => {
  it('角色卡契约里要了 appearance，并写明"只写长相、不要写性格身份"', () => {
    const s = characterSystemPrompt(getGenre('coc'), getRuleset('coc7'));
    expect(s).toContain('"appearance":"外貌"');
    expect(s).toContain('appearance 20-40 字');
    expect(s).toContain('不要写性格、身份与来历');
  });

  it('队友契约同样要了 appearance', () => {
    const s = companionSystemPrompt(getGenre('tokyo'), getRuleset('coc7'));
    expect(s).toContain('"appearance":"外貌"');
    expect(s).toContain('appearance 20-40 字');
  });

  it('加了外貌不是把老字段顶掉（description / personality 都还在）', () => {
    const c = characterSystemPrompt(getGenre('fantasy'), getRuleset('dnd5e'));
    expect(c).toContain('"description":"描述"');
    expect(c).toContain('"personality":"性格"');
  });
});
