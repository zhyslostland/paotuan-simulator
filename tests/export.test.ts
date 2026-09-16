import { describe, expect, it } from 'vitest';
import {
  buildArchiveMarkdown,
  buildJourneyMarkdown,
  buildResultMarkdown,
  safeFilename,
  type ExportInput,
} from '../src/ui/exportGame.js';

/**
 * 导出两份 Markdown。
 *
 * 用户 2026-09-16 拍板：Markdown / 文本（不做长图），分"结算分享"与"整体流程分享"。
 * 最要紧的一条断言是**不含 `module.truth`** —— 导出物是会被转发的，
 * 守密人的内部真相绝不能跟着出去。
 */
function makeInput(): ExportInput {
  return {
    character: {
      name: '艾伦·霍尔特',
      gender: '男',
      description: '私家侦探，穿一件下摆磨损的风衣。',
      personality: '话少，认死理。',
      characteristics: { str: 45, con: 62, int: 70 },
      skills: { 侦查: 60, 图书馆使用: 55, 格斗: 40 },
    },
    module: {
      title: '货舱里的东西',
      premise: '你被反锁在一条货船的货舱里，舱门后面有东西在动。',
      goal: '活着离开货舱',
      stakes: '被关在这里，没人知道你上过这条船',
      urgency: '船正在离港，最多四十分钟',
    },
    gameState: {
      vitals: { hp: 8, san: 62, mp: 13 },
      companions: [],
      inventory: [],
      flags: {},
      clues: ['舱门被人从外面锁过', '积水里有不属于海水的东西'],
      threads: [],
      location: '救生艇',
      npcsAlive: [],
      combat: { active: false, round: 0, foes: [] },
      ending: {
        kind: 'success',
        text: '你把桨插进水里，货船的灯在身后一点点变小。',
        at: '2026-09-16T04:00:00.000Z',
        reason: '你上了救生艇，驶离了货船',
      },
    },
    chronicle: [
      { turn: 1, text: '你在货舱里醒来，手边有积水。', location: '货舱' },
      { turn: 2, text: '你摸到了舱门，锁是从外面扣上的。', location: '货舱' },
      { turn: 3, text: '你锯断了锁扣，上了甲板。', location: '甲板' },
    ],
    summary: '你从被反锁的货舱里脱身，抢在船出海前下了救生艇。',
    anchors: [{ label: '第2回 · 摸舱门 · 新线索' }],
    rulesetName: '克苏鲁的呼唤 第七版',
    mainDice: '1d100',
    characteristicLabels: { str: '力量', con: '体质', int: '智力' },
    exportedAt: '2026-09-16T04:00:00.000Z',
  };
}

describe('结算分享（Markdown）', () => {
  it('带模组名、终幕标题、理由与结局正文', () => {
    const md = buildResultMarkdown(makeInput());
    expect(md).toContain('# 《货舱里的东西》· 终幕 · 达成');
    expect(md).toContain('你上了救生艇，驶离了货船');
    expect(md).toContain('你把桨插进水里');
  });

  it('列出这一局的账（角色 / 回合 / 关键抉择 / 线索 / 状态）', () => {
    const md = buildResultMarkdown(makeInput());
    expect(md).toContain('艾伦·霍尔特');
    expect(md).toContain('回合');
    expect(md).toContain('关键抉择');
    expect(md).toContain('HP 8');
  });

  it('短：不把编年史整段搬进来（那是"整体流程"的事）', () => {
    const md = buildResultMarkdown(makeInput());
    expect(md).not.toContain('你锯断了锁扣');
  });
});

describe('整体流程分享（Markdown）', () => {
  it('含角色、目标三件套、编年史、线索与结局', () => {
    const md = buildJourneyMarkdown(makeInput());
    expect(md).toContain('# 《货舱里的东西》· 完整经过');
    expect(md).toContain('艾伦·霍尔特');
    expect(md).toContain('活着离开货舱');
    expect(md).toContain('你锯断了锁扣');
    expect(md).toContain('舱门被人从外面锁过');
    expect(md).toContain('终幕 · 达成');
  });

  it('技能按规则包量纲写：COC 是百分比，DnD 是加值', () => {
    const coc = buildJourneyMarkdown(makeInput());
    expect(coc).toContain('侦查 60%');

    const dnd = buildJourneyMarkdown({
      ...makeInput(),
      mainDice: '1d20',
      character: { ...makeInput().character, skills: { 调查: 5, 潜行: -1 } },
    });
    expect(dnd).toContain('调查 +5');
    expect(dnd).toContain('潜行 -1');
  });

  it('属性写成中文名，且不带百分号（属性不是成功率）', () => {
    const md = buildJourneyMarkdown(makeInput());
    expect(md).toContain('力量 45');
    expect(md).not.toContain('力量 45%');
  });
});

describe('导出不剧透', () => {
  /*
   * 导出物可能被转发，守密人的内部真相绝不能跟着出去。
   * 这条如果坏了，用户发出去的"战报"会直接把模组答案摊开。
   */
  it('两份都不含模组的 truth', () => {
    const withTruth = {
      ...makeInput(),
      module: {
        ...makeInput().module,
        truth: '货舱里运的是走私的活体，押运的人把你当成来接货的人一起锁了进来。',
      },
    } as ExportInput & { module: { truth: string } };
    expect(buildResultMarkdown(withTruth)).not.toContain('走私的活体');
    expect(buildJourneyMarkdown(withTruth)).not.toContain('走私的活体');
  });
});

describe('完整留档（含真相）', () => {
  const withTruth = (): ExportInput => ({
    ...makeInput(),
    module: {
      ...makeInput().module,
      truth: '货舱里运的是走私的活体，押运的人把你当成来接货的人一起锁了进来。',
    },
  });

  /*
   * 用户 09-16 追加的需求：留档要能带真相（自己存着看/发给已跑完的人），
   * 但必须**默认不带**、且放在末尾折叠块里——不能一打开就糊一脸。
   */
  it('完整版含真相', () => {
    expect(buildArchiveMarkdown(withTruth())).toContain('走私的活体');
  });

  it('真相折在 <details> 里，且有剧透提示', () => {
    const md = buildArchiveMarkdown(withTruth());
    expect(md).toContain('<details>');
    expect(md).toContain('守密人真相');
    expect(md).toContain('</details>');
    // 折叠块在末尾——结尾那一段就是它
    expect(md.trimEnd().endsWith('</details>')).toBe(true);
  });

  it('分享版依然不含真相（默认不能被改动）', () => {
    expect(buildJourneyMarkdown(withTruth())).not.toContain('走私的活体');
  });

  it('模组没写真相时，完整版也不凭空造一段', () => {
    const md = buildArchiveMarkdown(makeInput());
    expect(md).not.toContain('<details>');
  });
});

describe('文件名', () => {
  it('把不能出现在文件名里的字符换成下划线', () => {
    expect(safeFilename('货舱/里的:东西')).toBe('货舱_里的_东西');
  });

  it('空名字有兜底', () => {
    expect(safeFilename('')).toBe('跑团');
  });
});
