import { describe, expect, it } from 'vitest';
import { BUILTIN_GENRES, GENRE_COC, getGenre, listGenres, type Genre } from '../src/core/genres.js';
import { getRuleset } from '../src/core/rulesets/index.js';
import {
  characterImagePrompt,
  characterSystemPrompt,
  companionSystemPrompt,
  moduleSystemPrompt,
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
