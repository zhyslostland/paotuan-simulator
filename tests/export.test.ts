import { describe, expect, it } from 'vitest';
import {
  buildArchiveMarkdown,
  buildIllustratedReportHtml,
  buildJourneyMarkdown,
  buildResultMarkdown,
  playerLinesByRound,
  roundPlayerLines,
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

/**
 * P2-4（协作方第 20 版）：**「整体流程」与「完整留档」要读 `messages`，不能再只读 `chronicle`。**
 *
 * ## 病灶
 * `chronicle` 是引擎侧的**一句话提要**（"你锯断了锁扣，上了甲板。"）。玩家自己写的行动原话、
 * 骰点明细、守密人的正文**都不在里面**。标题写着「完整经过」，打开却只有提要 ——
 * 玩家想复盘"我当时到底怎么说的""那一把掷了多少"，一条都找不到。
 *
 * ## 这一刀的范围（原文明确划了）
 * **只改「整体流程」+「完整留档」**。结算分享 / 带图战报 / 结档页回目是**下一刀**。
 * 真相分层（`module.truth` 只进完整留档）**不动**。
 */
describe('按回目渲染 messages（P2-4）', () => {
  /** 一份带对话的输入：3 回，其中第 2 回带两个检定（单掷 + 一次多掷） */
  const withMessages = (): ExportInput => ({
    ...makeInput(),
    messages: [
      { role: 'gm', content: '你在货舱里醒来，手边有积水。', checks: [] },
      { role: 'player', content: '我摸黑去摸舱门。', checks: [] },
      {
        role: 'gm',
        content: '锁是从外面扣上的，铁扣锈得很厉害。',
        checks: [
          { skill: '侦查', target: 60, roll: 22, label: '成功', tier: '成功', success: true },
        ],
      },
      { role: 'player', content: '我用锯条锯那个锁扣。', checks: [] },
      {
        role: 'gm',
        content: '金属发出刺耳的呻吟，然后断了。',
        checks: [
          { skill: '力量', target: 45, roll: 71, label: '失败', tier: '失败', success: false },
          { skill: '幸运', target: 50, roll: 12, label: '成功', tier: '成功', success: true },
        ],
      },
    ],
  });

  it('整体流程里出现玩家原话（引用块），不只是提要', () => {
    const md = buildJourneyMarkdown(withMessages());
    expect(md).toContain('> 我摸黑去摸舱门。');
    expect(md).toContain('> 我用锯条锯那个锁扣。');
  });

  it('GM 正文进导出（提要里根本没有这些句子）', () => {
    const md = buildJourneyMarkdown(withMessages());
    expect(md).toContain('锁是从外面扣上的，铁扣锈得很厉害。');
    expect(md).toContain('金属发出刺耳的呻吟，然后断了。');
  });

  it('检定带骰点明细：掷了多少 / 目标多少 / 结果', () => {
    const md = buildJourneyMarkdown(withMessages());
    expect(md).toContain('侦查');
    expect(md).toContain('掷 22');
    expect(md).toContain('目标 60');
    expect(md).toContain('失败');
    expect(md).toContain('掷 71');
    expect(md).toContain('目标 45');
  });

  it('一次多掷的两个检定都要出现（checksOf 是唯一真源）', () => {
    const md = buildJourneyMarkdown(withMessages());
    // 同一条消息上的 check 与 checks 都不能漏
    expect(md).toContain('力量');
    expect(md).toContain('幸运');
    expect(md).toContain('掷 12');
  });

  it('按回目切：第 1 回是开场，第 2 回起一玩家一答复', () => {
    const md = buildJourneyMarkdown(withMessages());
    expect(md).toContain('### 第 1 回');
    expect(md).toContain('### 第 2 回');
    expect(md).toContain('### 第 3 回');
  });

  it('编年史提要**照样留着**（玩家可能就想扫一眼骨架）', () => {
    const md = buildJourneyMarkdown(withMessages());
    expect(md).toContain('## 故事梗概');
    expect(md).toContain('你锯断了锁扣，上了甲板。');
  });

  it('没给 messages 时退回旧渲染，行为不变（老调用处不炸）', () => {
    const md = buildJourneyMarkdown(makeInput()); // makeInput 没有 messages
    expect(md).toContain('你锯断了锁扣，上了甲板。');
    expect(md).not.toContain('## 逐回经过');
  });

  it('messages 里只有开场白（玩家还没说话）时，也能出来，不返回空', () => {
    const md = buildJourneyMarkdown({
      ...makeInput(),
      messages: [{ role: 'gm', content: '故事从这里开始。', checks: [] }],
    });
    expect(md).toContain('## 逐回经过');
    expect(md).toContain('故事从这里开始。');
  });

  it('system 消息不进回目（它不是故事的一部分）', () => {
    const md = buildJourneyMarkdown({
      ...makeInput(),
      messages: [
        { role: 'system', content: '这是一条系统提示，不该出现在故事里。', checks: [] },
        { role: 'player', content: '我往前走。', checks: [] },
      ],
    });
    expect(md).not.toContain('不该出现在故事里');
    expect(md).toContain('我往前走。');
  });

  it('契约块（```json）不会漏进导出正文', () => {
    const md = buildJourneyMarkdown({
      ...makeInput(),
      messages: [
        {
          role: 'gm',
          content: '门开了。\n```json\n{"state_delta":[]}\n```',
          checks: [],
        },
      ],
    });
    expect(md).toContain('门开了。');
    expect(md).not.toContain('state_delta');
  });

  it('🔴 完整留档带真相 —— 但**只带真相，不带别的**（分层不能被这次改动破坏）', () => {
    const input = { ...withMessages(), module: { ...withMessages().module, truth: '舱里运的是走私的活体。' } };
    const archive = buildArchiveMarkdown(input);
    expect(archive).toContain('走私的活体');
    // 分享版依然不含真相
    expect(buildJourneyMarkdown(input)).not.toContain('走私的活体');
  });

  it('🔴 加了 messages 之后，分享版**仍然不含** truth（这是最要紧的一条）', () => {
    const input = {
      ...withMessages(),
      module: { ...withMessages().module, truth: '绝不能外泄的那句话。' },
      messages: [
        { role: 'player', content: '我搜他的口袋。', checks: [] },
        { role: 'gm', content: '你摸到一张票根。', checks: [] },
      ],
    };
    const md = buildJourneyMarkdown(input);
    expect(md).toContain('你摸到一张票根。'); // 正文照常进来
    expect(md).not.toContain('绝不能外泄的那句话。'); // 真相一步都没跟出来
  });
});

/*
 * §6.3（协作方第 21 版 · 报告 §6 采纳后拆刀）：把玩家的行动还给**剩下的三处**。
 * 上一刀（P2-4）只做了整体流程 + 完整留档，这一刀是 a/b/c。
 * 仍是纯渲染改动：不升 `SAVE_VERSION`、不动 `prompt.ts:474` 红线。
 */
describe('§6.3 把玩家行动还给其余三处', () => {
  const MSGS: ExportInput['messages'] = [
    { role: 'gm', content: '你在货舱里醒来。', checks: [] },
    { role: 'player', content: '我摸黑去摸舱门，看锁是不是从外面扣上的。', checks: [] },
    {
      role: 'gm',
      content: '锁是从外面扣上的。',
      checks: [{ skill: '侦查', target: 60, roll: 22, label: '成功', tier: '成功', success: true }],
    },
    { role: 'player', content: '我用锯条锯那个锁扣。', checks: [] },
    { role: 'gm', content: '金属断了。', checks: [] },
  ];

  // ---- a. 结算分享 ----

  it('a·结算分享有「关键行动」，且是**全文**不是 16 字截断', () => {
    const md = buildResultMarkdown({
      ...makeInput(),
      messages: MSGS,
      anchors: [
        {
          label: '第1回 · 我摸黑去摸舱门 · 新线索',
          text: '我摸黑去摸舱门，看锁是不是从外面扣上的。',
        },
      ],
    });
    expect(md).toContain('关键行动');
    // 全文 —— 被截成 16 字的话这句不会完整出现
    expect(md).toContain('我摸黑去摸舱门，看锁是不是从外面扣上的。');
  });

  it('a·关键行动带上关键检定的掷出与结果', () => {
    const md = buildResultMarkdown({
      ...makeInput(),
      messages: MSGS,
      anchors: [
        {
          label: '第1回 · 摸舱门 · 新线索',
          text: '我摸黑去摸舱门。',
          checks: [
            { skill: '侦查', target: 60, roll: 98, label: '失败', tier: '失败', success: false },
          ],
        },
      ],
    });
    expect(md).toContain('侦查');
    expect(md).toContain('掷 98');
    expect(md).toContain('目标 60');
    expect(md).toContain('失败');
  });

  it('a·只列锚点那几条，不把整局行动都塞进来（长度仍要短）', () => {
    const md = buildResultMarkdown({
      ...makeInput(),
      messages: MSGS,
      anchors: [{ label: '第1回 · 摸舱门 · 新线索', text: '我摸黑去摸舱门。' }],
    });
    // 没被标成锚点的那一句不该出现
    expect(md).not.toContain('我用锯条锯那个锁扣。');
    // 也不该出现「逐回经过」那种整局回放
    expect(md).not.toContain('### 第 1 回');
  });

  it('a·锚点没有正文也没有检定时，不空挂一个「关键行动」标题', () => {
    const md = buildResultMarkdown({ ...makeInput(), messages: MSGS });
    expect(md).not.toContain('关键行动');
  });

  // ---- b. 带图战报 ----

  it('b·画面下挂上「当时我说」那句话（`player` 由调用方按回目挂上）', () => {
    const html = buildIllustratedReportHtml({
      ...makeInput(),
      messages: MSGS,
      scenes: [
        {
          label: '第 1 个画面',
          text: '锁是从外面扣上的。',
          image: 'data:image/png;base64,AAA',
          player: '我摸黑去摸舱门，看锁是不是从外面扣上的。',
        },
      ],
    });
    expect(html).toContain('我摸黑去摸舱门，看锁是不是从外面扣上的。');
    expect(html).toContain('锁是从外面扣上的。');
    expect(html).toContain('当时我说');
  });

  it('b·两个画面各挂各的那一句，顺序不串', () => {
    const html = buildIllustratedReportHtml({
      ...makeInput(),
      messages: MSGS,
      scenes: [
        {
          label: '画面一',
          text: '锁是从外面扣上的。',
          image: 'data:image/png;base64,AAA',
          player: '我摸黑去摸舱门。',
        },
        {
          label: '画面二',
          text: '金属断了。',
          image: 'data:image/png;base64,BBB',
          player: '我用锯条锯那个锁扣。',
        },
      ],
    });
    expect(html.indexOf('我摸黑去摸舱门')).toBeLessThan(html.indexOf('我用锯条锯那个锁扣'));
  });

  it('b·画面没配到玩家那句时，不空挂一个引用块', () => {
    const html = buildIllustratedReportHtml({
      ...makeInput(),
      messages: MSGS,
      scenes: [{ label: '画面', text: '开场。', image: 'data:image/png;base64,AAA' }],
    });
    expect(html).not.toContain('当时我说');
  });

  it('🔴 b·玩家原话在自包含 HTML 里**必须转义**（战报是单文件，注入就是事故）', () => {
    const html = buildIllustratedReportHtml({
      ...makeInput(),
      scenes: [
        {
          label: '画面',
          text: '没人回应。',
          image: 'data:image/png;base64,AAA',
          player: '我喊：<script>alert(1)</script>',
        },
      ],
    });
    expect(html).not.toContain('<script>');
    expect(html).toContain('&lt;script&gt;');
  });

  // ---- c. 编年史（世界页「每一回」）----

  it('c·编年史按回目顺序对齐玩家那句（第 n 条 ↔ 第 n 条玩家消息）', () => {
    const lines = playerLinesByRound(MSGS!);
    expect(lines).toEqual([
      '我摸黑去摸舱门，看锁是不是从外面扣上的。',
      '我用锯条锯那个锁扣。',
    ]);
  });

  it('c·开场白那一回没有玩家发言 → 不占位、不下移（下移会让后面全错一格）', () => {
    const lines = playerLinesByRound([
      { role: 'gm', content: '故事开始。', checks: [] },
      { role: 'player', content: '我往前走。', checks: [] },
    ]);
    expect(lines).toEqual(['我往前走。']);
  });

  it('c·system 消息不参与对齐（它不是一回）', () => {
    const lines = playerLinesByRound([
      { role: 'system', content: '系统提示。', checks: [] },
      { role: 'player', content: '我往前走。', checks: [] },
    ]);
    expect(lines).toEqual(['我往前走。']);
  });

  it('§6.4：检定带上"由何而来"（reason），不再只剩一行数字', () => {
    const md = buildJourneyMarkdown({
      ...makeInput(),
      messages: [
        { role: 'player', content: '我贴着门听。', checks: [] },
        {
          role: 'gm',
          content: '门后传来缓慢的呼吸声。',
          checks: [
            {
              skill: '侦查',
              target: 60,
              roll: 22,
              label: '成功',
              tier: '成功',
              success: true,
              reason: '门后有响动，先听听是什么',
            },
          ],
        },
      ],
    });
    expect(md).toContain('门后有响动，先听听是什么');
    // 数字部分照样在 —— 加了理由不代表把骰点挤掉
    expect(md).toContain('掷 22');
  });

  it('c·单条消息维度的取值（`roundPlayerLines`）与上面同一条判据', () => {
    const per = roundPlayerLines(MSGS!);
    // 开场白那一条还没有玩家
    expect(per[0]).toBeUndefined();
    // 之后每条都属于最近的那条玩家消息所在的回目
    expect(per[1]).toBe('我摸黑去摸舱门，看锁是不是从外面扣上的。');
    expect(per[2]).toBe('我摸黑去摸舱门，看锁是不是从外面扣上的。');
    expect(per[3]).toBe('我用锯条锯那个锁扣。');
    expect(per[4]).toBe('我用锯条锯那个锁扣。');
  });
});
