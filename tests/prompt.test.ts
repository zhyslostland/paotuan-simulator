import { describe, expect, it } from 'vitest';
import {
  buildSystemPrompt,
  DYING_NOTE,
  dedupeNpcLines,
  extractContract,
  isCheckLeak,
  isRefusal,
  stripMeta,
  stripTravelEcho,
} from '../src/orchestrator/prompt.js';

describe('stripMeta 兜底过滤', () => {
  it('清掉"指令解析 / 系统 / 逻辑检查 / 叙事目标"这类过程性行', () => {
    const raw = `（系统：正在执行指令）

指令解析：
"倒立洗头" → 玩家的动作描述（非台词）
逻辑检查：室内应有盥洗设施
叙事目标：保持克苏鲁氛围
（开始场景构建）

你撑着皮沙发的扶手倒立起来。
老霍华德猛地往后一缩。`;

    const out = stripMeta(raw);
    expect(out).toContain('你撑着皮沙发的扶手倒立起来。');
    expect(out).toContain('老霍华德猛地往后一缩。');
    expect(out).not.toContain('指令解析');
    expect(out).not.toContain('逻辑检查');
    expect(out).not.toContain('叙事目标');
    expect(out).not.toContain('系统：');
    expect(out).not.toContain('场景构建');
  });

  it('正常叙事原样保留（不会被误伤）', () => {
    const raw = '壁炉里的火早就熄了。\n\n他停顿了一下，指节发白。';
    expect(stripMeta(raw)).toBe(raw);
  });

  it('把删除后残留的连续空行压平', () => {
    const raw = '第一段。\n指令解析：foo\n\n\n\n第二段。';
    expect(stripMeta(raw)).toBe('第一段。\n\n第二段。');
  });
});

describe('isRefusal 识别拒绝 / 说教式回复', () => {
  it('能识别"无法执行 / 请重新输入 / 不符合氛围 / 选项菜单"', () => {
    expect(
      isRefusal('你的指令无法执行。这个行为不符合角色的设定、场合的逻辑，也严重偏离了氛围。')
    ).toBe(true);
    expect(isRefusal('请重新输入一个符合角色与情境的行动。')).toBe(true);
    expect(isRefusal('你可以尝试：1. 慢慢放下枪 2. 用话术周旋')).toBe(true);
  });

  it('正常叙事不会被误判', () => {
    expect(isRefusal('你举起枪，老霍华德脸色骤变，椅子向后刮出一声刺响。')).toBe(false);
    expect(isRefusal('老霍华德压低声音："把枪收起来，我们还能谈。"')).toBe(false);
  });
});

describe('dedupeNpcLines 去掉正文里重复的 NPC 对白', () => {
  it('删除与 npc_lines 重复、且被引号包裹的台词', () => {
    const body = '米拉脸色煞白，目光乱移。\u201C你疯了？\u201D她从牙缝里挤出几个字。';
    const out = dedupeNpcLines(body, [{ id: 'mira', name: '米拉', line: '你疯了？' }]);
    expect(out).not.toContain('你疯了？');
    expect(out).toContain('米拉脸色煞白');
    expect(out).toContain('她从牙缝里挤出几个字');
  });

  it('直角引号「」也认得', () => {
    const out = dedupeNpcLines('他冷冷地开口。「把枪放下。」', [
      { id: 'x', name: '某人', line: '把枪放下。' },
    ]);
    expect(out).not.toContain('把枪放下');
  });

  it('正文没有重复时原样保留', () => {
    const body = '米拉脸色煞白，往后退了半步，几乎碰到文件柜。';
    expect(dedupeNpcLines(body, [{ id: 'mira', name: '米拉', line: '你疯了？' }])).toBe(body);
  });
});

describe('isCheckLeak 识别正文里泄漏的检定结果', () => {
  it('能识别"外貌检定（APP）失败"这类抢引擎的写法', () => {
    expect(isCheckLeak('你进行外貌检定（APP）失败。')).toBe(true);
    expect(isCheckLeak('进行一次侦查检定，结果是困难成功。')).toBe(true);
  });

  it('结论标签与掷骰字样都算泄漏（结果只由本地卡片呈现）', () => {
    expect(isCheckLeak('这一下大成功。')).toBe(true);
    expect(isCheckLeak('你掷出 23，极难成功。')).toBe(true);
    expect(isCheckLeak('骰出 7 点。')).toBe(true);
    expect(isCheckLeak('投掷结果：失败。')).toBe(true);
  });

  it('正常叙事不会误判', () => {
    expect(isCheckLeak('你推开那扇吱呀作响的木门。')).toBe(false);
    expect(isCheckLeak('他盯着你，眼神里满是怀疑。')).toBe(false);
    expect(isCheckLeak('地板接缝处有几道新鲜的刮痕。')).toBe(false);
  });
});

describe('输出契约里的状态白名单不能和战斗规则自相矛盾', () => {
  /** 一份最小可用的提示词上下文：这些用例只关心"提示词里到底说了什么" */
  const buildPrompt = () =>
    buildSystemPrompt({
      rulesetName: 'COC 7th',
      genre: {
        id: 'coc',
        name: '经典克苏鲁',
        blurb: '',
        setting: '',
        tone: '',
        imageStyle: '',
        castHint: '',
      },
      module: {
        title: 't',
        premise: '',
        opening: '',
        truth: '',
        npcs: [],
        locations: '',
        clueChain: '',
        acts: '',
        endings: '',
        notes: '',
      },
      character: {
        name: '甲',
        description: '',
        personality: '',
        mes_example: '',
        characteristics: { str: 50 },
        skills: { 侦查: 50 },
      },
      playerAddress: '甲先生',
      gameState: {
        vitals: { hp: 10, san: 60, mp: 10 },
        companions: [],
        inventory: [],
        flags: {},
        clues: [],
        threads: [],
        location: '走廊',
        npcsAlive: [],
        combat: { active: false, round: 0, foes: [] },
      },
      worldbook: [],
      chronicle: [],
    });

  it('combat.active / round / foes 都写在允许的 target 前缀里', () => {
    const prompt = buildPrompt();
    // 战斗规则让模型写 combat.*，白名单里就必须有，否则写多少被拒多少
    expect(prompt).toContain('combat.active');
    expect(prompt).toContain('combat.round');
    expect(prompt).toContain('combat.foes');
    // 检定结论不许写进正文，这条红线要在提示词里
    expect(prompt).toContain('检定结论只由引擎的卡片呈现');
  });

  /*
   * 下面这些是**用户实测踩过的坑**，每条都对应过一次真实的坏体验。
   * 写成断言是为了防止以后改提示词时不小心把它们删掉——
   * 提示词删一行不会有任何报错，但游戏会立刻变回原来的样子。
   */
  it('武器不被当作消耗品（"开一枪把手枪消耗掉"）', () => {
    const prompt = buildPrompt();
    expect(prompt).toContain('武器本身不是消耗品');
  });

  it('敌人必须有名字（"敌对生物没有命名"）', () => {
    const prompt = buildPrompt();
    expect(prompt).toContain('name 是必填的');
  });

  it('剧透控制 G5：一次定好，全项目复用', () => {
    const prompt = buildPrompt();
    expect(prompt).toContain('剧透控制');
    // 定调那句（带加粗，断言核心片段即可）
    expect(prompt).toContain('你不是作者，你是那个不肯多说的守密人');
    // 分层表：地点 / 身份 / 怪物名 / 弱点 / 真相，五档都在
    expect(prompt).toContain('他去过，或故事里明确提到过');
    expect(prompt).toContain('当场照面');
    expect(prompt).toContain('**交过手之后**');
    // 弱点是活路，交手过才给 —— 图鉴那套判据的提示词侧
    expect(prompt).toContain('弱点不白给');
    // 不许借旁白替玩家总结结论
    expect(prompt).toContain('别在正文里替玩家总结');
  });

  it('空间连贯：移动必须走 location（"一会在房间外，一会在房间内"）', () => {
    const prompt = buildPrompt();
    expect(prompt).toContain('空间与位置');
    expect(prompt).toContain('移动必须走 location');
  });

  it('不得替玩家编造身体特征（"给我加了右腿有旧伤的设定"）', () => {
    const prompt = buildPrompt();
    expect(prompt).toContain('不要替玩家编造他自己');
    expect(prompt).toContain('身体特征或病史');
  });

  it('负面状态必须进 flags（"流血状态界面不显示"）', () => {
    const prompt = buildPrompt();
    expect(prompt).toContain('持续的负面状态一律写进 flags');
  });

  it('伤口由引擎接管：模型不许自己扣血（"包扎了还隔段时间掉血"）', () => {
    const prompt = buildPrompt();
    // 引擎按轮结算，模型只演出 —— 否则同一次流血会被扣两遍
    expect(prompt).toContain('伤口（含流血）现在由引擎接管');
    expect(prompt).toContain('你不要自己扣血');
    expect(prompt).toContain('那是引擎的活，你再发一次就变成扣两遍');
  });

  it('旧伤/环境所致的伤走 flags.受伤 显式申报，且只申报一次', () => {
    const prompt = buildPrompt();
    expect(prompt).toContain('flags.受伤');
    expect(prompt).toContain('只申报一次');
    // 输出通道（flags.伤口）不能被守密人读回来，否则伤口会自我复制
    expect(prompt).toContain('是**引擎自己写的显示文案**');
  });

  it('止血三依据写进了提示词，且"两样都没有"时不要求掷骰', () => {
    const prompt = buildPrompt();
    expect(prompt).toContain('止血要有依据');
    expect(prompt).toContain('真正止住');
    expect(prompt).toContain('临时处理');
    expect(prompt).toContain('不要要求他掷骰');
  });

  it('处理到位走 flags.伤口处理，避免"说止住了还在渗"', () => {
    const prompt = buildPrompt();
    expect(prompt).toContain('flags.伤口处理');
    expect(prompt).toContain('别一边说');
  });

  it('临时疯狂有数值后果，但模型不许自己扣（R37）', () => {
    const prompt = buildPrompt();
    expect(prompt).toContain('这条状态**有数值后果**');
    expect(prompt).toContain('有界、不叠加');
    // 提前解除的口子要写清楚，否则守密人只能干等
    expect(prompt).toContain('"target": "flags.临时疯狂"');
  });

  it('能声明结局收束（"上了救生艇却没触发任何结局"）', () => {
    const prompt = buildPrompt();
    expect(prompt).toContain('宣告结局');
    expect(prompt).toContain('success | failure | grey');
  });

  it('物品要带重量（负重系统的输入全靠它）', () => {
    const prompt = buildPrompt();
    expect(prompt).toContain('weight');
    expect(prompt).toContain('负重');
  });

  it('人物档案要写进 npcNotes，且不许剧透动机与秘密', () => {
    const prompt = buildPrompt();
    expect(prompt).toContain('npcNotes.老霍华德.role');
    expect(prompt).toContain('npcNotes.');
    // 卡片是给玩家看的：底牌不能摆上来
    expect(prompt).toContain('不要写进来');
  });
});

describe('敌对者表要告诉守密人"别提前讲"（R38 + G5）', () => {
  const buildWithMonsters = () =>
    buildSystemPrompt({
      rulesetName: 'COC 7th',
      genre: {
        id: 'coc',
        name: '经典克苏鲁',
        blurb: '',
        setting: '',
        tone: '',
        imageStyle: '',
        castHint: '',
      },
      module: {
        title: 't',
        premise: '',
        opening: '',
        truth: '',
        npcs: [],
        locations: '',
        clueChain: '',
        acts: '',
        endings: '',
        notes: '',
        monsters: [
          {
            id: 'm1',
            name: '雾中的巨影',
            look: '湿漉漉的一团',
            hp: 20,
            attack: '爪击 1d8',
            behavior: '受伤后退进雾里',
            weakness: '怕火',
          },
        ],
      },
      character: {
        name: '甲',
        description: '',
        personality: '',
        mes_example: '',
        characteristics: { str: 50 },
        skills: { 侦查: 50 },
      },
      playerAddress: '甲先生',
      gameState: {
        vitals: { hp: 10, san: 60, mp: 10 },
        companions: [],
        inventory: [],
        flags: {},
        clues: [],
        threads: [],
        location: '走廊',
        npcsAlive: [],
        combat: { active: false, round: 0, foes: [] },
      },
      worldbook: [],
      chronicle: [],
    });

  it('表里的数值照旧交给守密人（它得按这个演）', () => {
    const p = buildWithMonsters();
    expect(p).toContain('雾中的巨影');
    expect(p).toContain('生命 20');
    expect(p).toContain('怕火');
  });

  it('但明确告诉它"这一节只有你知道"、玩家那边按遭遇逐条解锁', () => {
    const p = buildWithMonsters();
    expect(p).toContain('这一节只有你知道');
    expect(p).toContain('图鉴');
    // 名字要跟表里的叫法一致，图鉴才认得出来是同一只
    expect(p).toContain('尽量用上面这个叫法');
  });

  it('模型不许自己写 encountered / fought（那是引擎按真实遭遇记的）', () => {
    const p = buildWithMonsters();
    const allowed = p.match(/state_delta 允许的 target 前缀[^\n]*/)?.[0] ?? '';
    expect(allowed).not.toContain('encountered');
    expect(allowed).not.toContain('fought');
  });
});

describe('濒死一次性引导（DYING_NOTE）', () => {
  /*
   * 提示词删一行不会报错，但游戏立刻变回原样。
   * 濒死那一轮守密人要么直接收尸、要么列一屏选项菜单，
   * 这两条都是用户明确反感的，用断言钉住。
   */
  it('要求给出生路而不是收束', () => {
    expect(DYING_NOTE).toContain('一线生机');
    expect(DYING_NOTE).toContain('施救');
  });

  it('不许列菜单、不许替玩家定成败', () => {
    expect(DYING_NOTE).toContain('不要列选项菜单');
    expect(DYING_NOTE).toContain('不要替玩家定成败');
  });

  it('不许写跳出故事的话，也不许再扣血（引擎已冻结）', () => {
    expect(DYING_NOTE).toContain('游戏结束');
    expect(DYING_NOTE).toContain('不要再扣他的生命');
  });
});

describe('stripMeta 顺带清掉思考块（模型把思维链写进 content 的兜底）', () => {
  it('删掉 ＜think＞…＜/think＞ 整块', () => {
    const raw =
      '<think>用户想自杀，我需要考虑安全策略……</think>\n\n雨敲在窗上。老霍华德没有说话。';
    const out = stripMeta(raw);
    expect(out).not.toContain('安全策略');
    expect(out).toContain('雨敲在窗上');
  });

  it('残留的孤立标签也清掉', () => {
    expect(stripMeta('</thinking>\n他抬起头。')).toBe('他抬起头。');
  });

  it('正常叙事不受影响', () => {
    const raw = '他抬起头，看了你一眼，又低下头去。';
    expect(stripMeta(raw)).toBe(raw);
  });
});

describe('stripTravelEcho 去掉被抄进正文的"移动意图"模板', () => {
  it('删掉整段括号模板', () => {
    const raw =
      '你站在巷口。\n\n（我打算前往「码头区」。这只是我此刻的打算，还不是已经发生的事——如果现在去不了，请用剧情里的理由把我拦下，并给我一个能继续往下走的线索。）\n\n雾更浓了。';
    const out = stripTravelEcho(raw);
    expect(out).not.toContain('我打算前往');
    expect(out).not.toContain('请用剧情里的理由把我拦下');
    expect(out).toContain('你站在巷口。');
    expect(out).toContain('雾更浓了。');
  });

  it('正常叙事原样返回（不会被误伤）', () => {
    const raw = '你推开那扇吱呀作响的木门，走廊尽头有人在等你。';
    expect(stripTravelEcho(raw)).toBe(raw);
  });

  it('玩家自己写的"打算"不算模板（不匹配就不动）', () => {
    const raw = '他打量着你，似乎在打算什么。';
    expect(stripTravelEcho(raw)).toBe(raw);
  });
});

describe('extractContract', () => {
  it('从尾部 JSON 块提取契约，并保留前面的正文', () => {
    const raw = '故事正文。\n\n```json\n{"summary_delta":"一句话","state_delta":[]}\n```';
    const { body, contract } = extractContract(raw);
    expect(body).toBe('故事正文。');
    expect(contract?.summary_delta).toBe('一句话');
  });

  it('没有 JSON 块时契约返回 null', () => {
    const { body, contract } = extractContract('只有正文');
    expect(body).toBe('只有正文');
    expect(contract).toBeNull();
  });

  /*
   * 收束声明。
   * 用户 2026-09-16 实测："我是坐逃生艇下的船，没触发任何结局"——
   * 模组里写好了"成功：跳船逃生"，但引擎**没有任何路径**能让"达成目标"结束一局。
   */
  it('能解析 ending（守密人声明收束）', () => {
    const raw =
      '你翻过船舷，落在救生艇里。\n\n```json\n' +
      '{"summary_delta":"你上了救生艇并划离货船","state_delta":[],' +
      '"ending":{"kind":"success","reason":"你离开了这条船，目标达成"}}\n```';
    const { contract } = extractContract(raw);
    expect(contract?.ending?.kind).toBe('success');
    expect(contract?.ending?.reason).toBe('你离开了这条船，目标达成');
  });

  it('不填 ending 时是 undefined（绝大多数回合都不该填）', () => {
    const raw = '正文。\n\n```json\n{"summary_delta":"一句话"}\n```';
    const { contract } = extractContract(raw);
    expect(contract?.ending).toBeUndefined();
  });
});
