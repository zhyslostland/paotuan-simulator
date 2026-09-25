import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { BUILTIN_GENRES, GENRE_COC, getGenre, listGenres, type Genre } from '../src/core/genres.js';
import { getRuleset } from '../src/core/rulesets/index.js';
import {
  characterImagePrompt,
  characterSystemPrompt,
  companionSystemPrompt,
  moduleSystemPrompt,
  moduleUserPrompt,
} from '../src/orchestrator/generate.js';

describe('题材预设（Genre）', () => {
  it('内置题材都有必填字段，且 id 唯一', () => {
    const ids = new Set<string>();
    for (const g of BUILTIN_GENRES) {
      expect(g.id).toBeTruthy();
      expect(g.name).toBeTruthy();
      expect(g.blurb).toBeTruthy();
      expect(g.setting).toBeTruthy();
      expect(g.tone).toBeTruthy();
      expect(g.imageStyle).toBeTruthy();
      expect(g.castHint).toBeTruthy();
      ids.add(g.id);
    }
    expect(ids.size).toBe(BUILTIN_GENRES.length);
  });

  it('未知题材回退到经典克苏鲁，不让提示词变空', () => {
    expect(getGenre('不存在的题材').id).toBe(GENRE_COC.id);
    expect(getGenre(undefined).id).toBe(GENRE_COC.id);
  });

  it('自建题材能按 id 命中，并与内置合并去重', () => {
    const mine: Genre = {
      id: 'cyber',
      name: '赛博朋克',
      blurb: '霓虹与义体',
      setting: '近未来都市',
      tone: '冷硬',
      imageStyle: '霓虹赛璐璐',
      castHint: '黑客、佣兵',
    };
    expect(getGenre('cyber', [mine]).name).toBe('赛博朋克');
    const all = listGenres([mine, { ...mine, id: 'coc', name: '想覆盖内置' }]);
    expect(all.filter((g) => g.id === 'coc')).toHaveLength(1);
    expect(all.find((g) => g.id === 'coc')!.name).toBe('经典克苏鲁');
    expect(all.some((g) => g.id === 'cyber')).toBe(true);
  });

  it('情感线（粉红团）明确写了不露骨的边界', () => {
    const pink = getGenre('pink');
    expect(pink.tone).toContain('绝不写性行为');
    expect(pink.castHint).toContain('女性角色');
  });
});

describe('角色卡提示词由「题材 + 规则」共同决定', () => {
  it('COC：出现八大属性与百分比技能', () => {
    const s = characterSystemPrompt(getGenre('coc'), getRuleset('coc7'));
    expect(s).toContain('str');
    expect(s).toContain('百分比');
    expect(s).toContain('经典克苏鲁');
  });

  it('DnD：讲加值而不是百分比，且不写死 COC 的属性集', () => {
    const s = characterSystemPrompt(getGenre('fantasy'), getRuleset('dnd5e'));
    expect(s).toContain('加值');
    expect(s).toContain('剑与魔法');
    expect(s).not.toContain('克苏鲁');
  });

  it('队友的数值条键名来自当前规则包，DnD 不会给 san/mp', () => {
    const coc = companionSystemPrompt(getGenre('coc'), getRuleset('coc7'));
    expect(coc).toContain('"san"');
    const dnd = companionSystemPrompt(getGenre('fantasy'), getRuleset('dnd5e'));
    expect(dnd).toContain('"hp"');
    expect(dnd).not.toContain('"san"');
  });
});

describe('模组提示词：剧透防护与开局场景', () => {
  it('要求 goal/stakes/urgency 只写玩家开局就知道的事，并禁止提前点名真相', () => {
    const s = moduleSystemPrompt(getGenre('coc'), getRuleset('coc7'));
    expect(s).toContain('start_location');
    expect(s).toContain('绝不透露真相');
    expect(s).toContain('剧透会毁掉整局体验');
  });

  it('地图节点要求双向连线，且起点必须存在', () => {
    const s = moduleSystemPrompt(getGenre('fantasy'), getRuleset('dnd5e'));
    expect(s).toContain('map_nodes');
    expect(s).toContain('双向');
    expect(s).toContain('start_location');
  });
});

/*
 * P2-9（协作方第 24 版 · 主人定「大问题」）：**题材压不过描述与规则包名**。
 *
 * 症状：题材选赛博朋克、描述写赛博朋克，出来的还是克苏鲁底色 ——
 * 因为规则包名（"服务于《COC》"）被系统当成了世界出处，而"严格贴合题材"那句
 * 躺在 system 里，被 user 位置上的描述（任务感最强）盖过。
 *
 * 修法两条：① 规则包降为**机制出处**（只管判定与数值）；② 题材升到 user，与描述并排并写死裁决。
 * 这几条钉的是"题材必须真的说话算数"。
 */
describe('P2-9：题材要压得住，规则包不许当世界出处', () => {
  it('🔴 system 里规则包只作机制出处，并且明说「不是世界出处」', () => {
    const s = moduleSystemPrompt(getGenre('coc'), getRuleset('coc7'));
    expect(s).toContain('只决定怎么掷骰');
    expect(s).toContain('它不是这个世界的出处');
  });

  it('system 里题材三块全部标成【硬约束】', () => {
    const s = moduleSystemPrompt(getGenre('fantasy'), getRuleset('dnd5e'));
    expect(s).toContain('题材 ·【硬约束】');
    expect(s).toContain('叙事风格 ·【硬约束】');
    expect(s).toContain('这个世界里通常有哪些人 ·【硬约束】');
  });

  it('🔴 题材必须进 user（不能只躺 system 里被描述盖过）', () => {
    const u = moduleUserPrompt('赛博朋克都市，一名黑客失踪了', false, getGenre('coc'));
    expect(u).toContain('【世界题材 · 硬约束】');
    expect(u).toContain('经典克苏鲁');
    // 裁决句：冲突时题材赢，但只改包装不删元素
    expect(u).toContain('以题材为准');
    expect(u).toContain('不删元素');
  });

  it('描述里的元素要求全部保留（换个说法也算）', () => {
    const u = moduleUserPrompt('1920 年代新英格兰，摄影师失踪', false, getGenre('coc'));
    expect(u).toContain('元素必须全部保留');
    expect(u).toContain('都要出现在成品里');
    expect(u).toContain('摄影师');
  });

  it('空描述维持现状（C 轮已证明它工作）', () => {
    const u = moduleUserPrompt('   ', false, getGenre('coc'));
    expect(u).toContain('请自由创作一个适合「经典克苏鲁」的短模组');
    // 空描述时不该凭空冒出"元素全保留"的要求（没有元素可保留）
    expect(u).not.toContain('元素必须全部保留');
  });

  it('🔴「完全自由」题材：不设题材硬约束，世界由玩家写的决定', () => {
    const free = getGenre('free');
    expect(free.name).toBe('完全自由');
    const u = moduleUserPrompt('赛博朋克都市，一名黑客失踪了', false, free);
    expect(u).toContain('完全自由');
    expect(u).toContain('以你下面写的设想为准');
    // 关键：自由题材不该再拿某个既定题材去压它
    expect(u).not.toContain('【世界题材 · 硬约束】');
  });

  it('原版（canonical）分支仍在，且题材约束照旧排在前面', () => {
    const u = moduleUserPrompt('敦威治恐怖事件', true, getGenre('coc'));
    expect(u).toContain('已出版模组');
    expect(u).toContain('【世界题材 · 硬约束】');
  });
});

describe('H19：按钮文案不许把「AI 生成」拼两遍', () => {
  it('模组包按钮的 label 是裸名（前缀由 AiGenBox 自己加）', () => {
    /*
     * `Preparation.tsx` 给 `AiGenBox` 的 label 曾写成「AI 生成模组包」，
     * 而 AiGenBox 内部又拼一次「AI 生成」→ 界面上成了「AI 生成AI 生成模组包」。
     * 这里直接读源码钉住：label 里不许再出现「AI 生成」四个字。
     */
    const src = readFileSync(new URL('../src/ui/Preparation.tsx', import.meta.url), 'utf8');
    expect(src).not.toMatch(/label=\{canonical \? 'AI 生成/);
    expect(src).toContain("label={canonical ? '模组包（按原版）' : '模组包'}");
  });
});

describe('生图画风跟着题材走', () => {
  it('情感线的立绘提示词带上题材画风与题材名', () => {
    const p = characterImagePrompt({ name: '神代遥', gender: '女', description: '高中生' }, getGenre('pink'));
    expect(p).toContain('情感线');
    expect(p).toContain('柔和通透');
  });

  it('没给题材时退回默认二次元画风', () => {
    const p = characterImagePrompt({ name: '某人', description: '一个人' });
    expect(p).toContain('anime style');
  });
});
