/**
 * 调用模型生成结构化 JSON。
 * 模型返回常常被 Markdown 围栏包裹、或夹带前后寒暄，这里做宽容解析。
 */
import { chat, type ModelConfig } from '../providers/model.js';
import type { Ruleset } from '../core/rulesets/types.js';
import type { Genre } from '../core/genres.js';
import { ACT_EXPAND_SPEC } from '../core/acts.js';
import { characteristicBudget } from '../core/skills.js';
import { appearanceOf } from '../core/appearance.js';

/**
 * 模组篇幅。类型定义放在这里（而不是 ui/store），
 * 让 orchestrator 不反向依赖 UI 层——`ui/store` 从这里再导出一次即可。
 */
/* 定义已搬到 core/types.ts（D 档批 0），这里只做转发 —— 老引用不用改 */
import type { ModuleScale } from '../core/types.js';
export type { ModuleScale };

export const SCALE_LABEL: Record<ModuleScale, string> = {
  short: '短篇 · 一夜之间',
  medium: '中篇 · 数日',
  long: '长篇 · 数周以上',
};

function parseLoose<T>(text: string): T | null {
  const t = text.trim();
  try {
    return JSON.parse(t) as T;
  } catch {
    /* 继续尝试 */
  }
  const fence = /```(?:json)?\s*([\s\S]*?)```/g;
  let m: RegExpExecArray | null;
  let last: RegExpExecArray | null = null;
  while ((m = fence.exec(text)) !== null) last = m;
  if (last) {
    try {
      return JSON.parse(last[1]!.trim()) as T;
    } catch {
      /* 继续 */
    }
  }
  const objStart = text.indexOf('{');
  const objEnd = text.lastIndexOf('}');
  if (objStart >= 0 && objEnd > objStart) {
    try {
      return JSON.parse(text.slice(objStart, objEnd + 1)) as T;
    } catch {
      /* 继续 */
    }
  }
  const arrStart = text.indexOf('[');
  const arrEnd = text.lastIndexOf(']');
  if (arrStart >= 0 && arrEnd > arrStart) {
    try {
      return JSON.parse(text.slice(arrStart, arrEnd + 1)) as T;
    } catch {
      /* 放弃 */
    }
  }
  return null;
}

/**
 * `signal` 是**超时与取消**用的（H24）。
 *
 * 第 12 轮实测：点「整理成模组卡」后界面停在「整理中…」**200 秒没有任何反馈**，
 * 只能刷新脱身 —— 而刷新会把这一页填好的东西一起丢掉。
 * `chat()` 早就支持 signal，只是这里一直没传下去。
 */
export async function generateJson<T>(
  system: string,
  user: string,
  cfg: ModelConfig,
  signal?: AbortSignal
): Promise<T | null> {
  const raw = await chat(
    [
      { role: 'system', content: system },
      { role: 'user', content: user },
    ],
    { ...cfg, temperature: Math.min(cfg.temperature, 1.0) },
    signal
  );
  return parseLoose<T>(raw);
}

/* ============================================================
 * 一、数值层的"规格说明" —— 由规则包生成，换规则包不用改提示词
 * ============================================================ */

/** 属性与技能的写法要求（COC 百分比 / DnD 加值 / 自定义规则自动适配） */
function characterNumericSpec(rs: Ruleset): { attrExample: string; rules: string } {
  const keys = rs.characteristicDefs;
  if (keys.length === 0) {
    // 兜底：规则包没定义属性（极端的自定义规则），不写死 COC 的属性
    return {
      attrExample: '{}',
      rules: '- characteristics 给空对象 {} 即可（这套规则没有属性）。',
    };
  }
  const attrExample = `{${keys.map((d) => `"${d.key}":${d.default}`).join(',')}}`;
  const attrDesc = keys.map((d) => `${d.key} ${d.label}`).join(' / ');
  const lo = Math.min(...keys.map((d) => d.min));
  const hi = Math.max(...keys.map((d) => d.max));
  const mid = Math.round((lo + hi) / 2);
  const isPercent = rs.mainDice === '1d100';
  const skillRule = isPercent
    ? `skills 只给 6-9 项，每项是百分比整数（0-95）：核心本职技 65-85，常用辅助 40-60，偏门但契合人设的 30-40。
  **按数值从高到低排列**，第一项就是这个人最拿手的。
  **绝不要列那种只点了几点、一辈子用不上的边缘技能——那是噪声，会让玩家在一堆没用的项里找不到重点。**`
    : `skills 只给 5-8 项，每项是**加值**（整数，通常 0~+6，很少超过 +8）；按加值从高到低排列。
  **不要罗列用不上的技能。**`;
  return {
    attrExample,
    rules: `- characteristics 是本规则包的属性（${attrDesc}），取 ${lo}-${hi} 的整数（常人约 ${mid}），要与人设相符。
- ${skillRule}`,
  };
}

/** 数值条（HP/MP/SAN 等）：键名必须来自规则包，否则引擎收不到 */
function vitalSpec(rs: Ruleset): string {
  return rs.vitalDefs
    .map((v) => `${v.key}（${v.label}，默认 ${v.default}）`)
    .join('、');
}

/* ============================================================
 * 二、角色 / 队友 / 世界书 / 模组 / 模组包
 * ============================================================ */

/**
 * 角色卡生成：题材 + 规则 + **模组**三驱动。
 *
 * `mod` 是可空的最小结构（不引整个 `Module`，免得提示词层反向依赖一大坨状态）。
 * 为什么要多喂一份模组：主人 2026-09-20 实测 —— 用「魔法少女」题材生成，
 * 人设确实是魔法少女，但**属性技能跟人设对不上、跟模组也不搭**。
 * 题材只决定"世界长什么样"，这张卡还得**在这个模组里活得下去**。
 */
export function characterSystemPrompt(
  genre: Genre,
  rs: Ruleset,
  mod?: { title?: string; premise?: string }
): string {
  const spec = characterNumericSpec(rs);
  // 预算只有规则包真给了才算（COC 460；DnD 没有总额规矩 → 一句都不提，不替规则包编）
  const budget = characteristicBudget(rs.id, {}).total;
  const modSec = mod?.title?.trim()
    ? `## 当前模组（这张卡必须在这个故事里活得下去）
《${mod.title.trim()}》${mod.premise?.trim() ? `\n前言：${mod.premise.trim()}` : ''}
如果前言已经交代了玩家是谁、如何被卷入，角色身份必须与之一致，不得另起设定。

`
    : '';
  return `你是 TRPG 角色卡生成助手，服务于《${rs.name}》。当前题材是 **${genre.name}**。

根据玩家的描述生成一张玩家角色卡。**只输出 JSON，不要任何解释文字。**

## 题材（世界观与舞台）
${genre.setting}

## 这个世界的腔调
${genre.tone}

## 这个世界里通常有哪些人
${genre.castHint}

${modSec}
格式：
{"name":"姓名","gender":"男|女","description":"描述","appearance":"外貌","personality":"性格","scenario":"开局处境","characteristics":${spec.attrExample},"skills":{"技能名":数值,...},"items":[{"name":"物品名","desc":"一句话说明它是什么、能干嘛","kind":"weapon|tool|clue|consumable|other","damage":"1d10","skill":"对应检定技能"}]}

要求：
- 全部中文，姓名与身份要贴合上面题材的世界观与时代。
- gender 必填，只写"男"或"女"。
- description 80-150 字：外貌（一眼能记住的特征）+ 年龄 + 身份 + 来历，写成一段连贯的话，不要分点。
- **appearance 20-40 字：只写长相**（发型发色、五官特征、身形、衣着的主色与样式），
  是给"按这张卡画角色立绘"用的 —— 所以**不要写性格、身份与来历**（那些在别处已有，
  混进来会让画出来的脸不固定）。要求具体到"画得出来"：不写"很帅"，写"眉骨一道浅疤"。
- personality 40-80 字：说话方式、性格弱点、在意什么。要具体到"能演出来"的程度。
- scenario 30-60 字：开局时这个人身处何地、正在做什么。
${spec.rules}
${
  budget
    ? `- **八项属性合计要落在 ${budget} 上下（常人水平）**：别把每项都拉满，也别全压到最低 —— 一张全 90 的卡等于没有性格。\n`
    : ''
}- **属性与技能必须自洽**：先想清楚"这个人在上面这个处境里靠什么吃饭"，把那 2-3 项给到最高；
  一个手无缚鸡之力的学者不该有最高的力量，人人都能做的事不必占一条技能。
  **与人设、题材、模组处境无关的技能一律不要给** —— 列一堆用不上的技能不是丰富，是噪声。
- **技能要能解释得通**：每一项都能回答"他是在什么场合学会的"，写不出这句的就不该列。
- items 3-6 项：这个人**随身携带**的物品（要写有用途的随身装备，不要写衣服这种理所当然的东西）。
  **每一项都必须给 desc**（20-35 字，说清"这是什么、能干嘛"）；是武器的还要给 kind:"weapon"、
  damage（伤害骰，如 "1d10"）、skill（对应检定技能）；消耗品给 kind:"consumable"；线索/信物给 kind:"clue"。
- **武器的 skill 必须与上面 skills 里的技能名逐字一致**，否则引擎认不出这把枪归哪个技能管。
- **skills 的技能名只能从下面这张表里挑，一个字都不要改**（引擎靠它查基础值与算技能点预算）：
  ${rs.skillCatalog.map((s) => s.name).join('、')}
  挑 6-9 项，给数值（${rs.mainDice === '1d100' ? '百分比' : '加值'}）。角色卡上没有的技能不代表不会——
  未受训按规则包的基础值掷，所以**不要为了"会用"而把技能表塞满**。
- 🔴 **技能点要有预算意识**：这是硬约束 —— 引擎按属性推算技能点总额，加点时**要用尽、但绝不许超支**
  （超了你给的这张卡会被打回重算，玩家看到的是"预算 340 / 已用 380"）。生成完**自己核算一遍**：
  每项投入 = 数值 − 该技能在规则包里的基础值，总和必须 ≤ 总额。
- 若玩家没给描述，自行创作一个贴合题材的有戏的角色。`;
}

export const FOLD_SYSTEM = `你是跑团记录整理助手，负责把已有的前情提要与新增事件合并成一段连贯的摘要。
要求：
- 中文，不超过 400 字
- 只保留客观事实：去过哪里、见过谁、得到什么线索、发生过什么转折、当前处境是什么
- 专有名词（人名、地名、物品名）必须保留准确写法
- 丢弃无关细节、重复内容和抒情描写
- **用自然叙事，禁止"通过XX检定""极难成功""掷出N"这类游戏术语**，读起来像故事梗概而非规则流水账
- 直接输出摘要正文，不要标题，不要解释`;

/**
 * 道具表生成：**只做这一件事**。
 *
 * 为什么单独拆出来：早期把道具塞进角色生成里，模型一次要想"人设 + 属性 + 技能 + 物品"，
 * 结果物品说明短、作用含糊——玩家捡到一件东西，背包里只有个名字，不知道能干嘛。
 * 单独生成时它只需要想"这个模组里会有什么东西、拿到能干嘛"，准确率明显更高。
 *
 * 这也是和「怪物设定页」一样的思路：**能用独立步骤生成的，就别混在一次生成里**。
 */
export function itemTableSystemPrompt(
  genre: Genre,
  module: { title?: string; premise?: string; locations?: string; truth?: string },
  rs: Ruleset
): string {
  return `你是 TRPG 道具设计助手，服务于《${rs.name}》。当前题材是 **${genre.name}**。

## 世界观与舞台
${genre.setting}

## 这个模组
${module.title ? `《${module.title}》` : ''}
${module.premise ?? ''}
${module.locations ? `\n会出现的地方：\n${module.locations}` : ''}
${module.truth ? `\n（内部真相，用来判断什么东西"看起来普通其实关键"）：${module.truth}` : ''}

**只输出 JSON，不要任何解释文字。**

格式：
{"items":[{"name":"物品名","look":"一句话外观/来历","effect":"作用","kind":"weapon|tool|clue|consumable|other"}]}

要求：
- 4-8 件，全部中文，贴合上面的世界观。
- **name 4-8 字**，像背包里真的会显示的那一行。
- **look 一句话**：它长什么样、从哪来的（20-30 字）。
- **effect 是重点（25-45 字），必须具体到"用了会怎样"**：
  - 消耗品 → 用掉之后发生的**具体变化**（"止血绷带：止住一次流血，生命 +1d4"），并给出可用的次数感；
  - 工具 → 它能让哪一类动作变得更容易（"撬棍：撬开卡死的门窗，本应失败的尝试可重来一次"）；
  - 武器 → 伤害骰与对应检定技能（"消防斧：1d8+2，格斗（斗殴）"）；
  - 线索物 → **它能推进什么**（"未冲洗的底片：送去暗房冲洗，会显出仪式现场"）。
  - 不要写"用途广泛""可能有帮助"这种没有信息量的话。
- kind 按上面四类填，都不是就填 other。
- 不要生成"普通衣服""钥匙串"这种没有玩点的东西；**至少一半的道具要能在模组里真正派上用场**。
- 若模组里本该有一件"关键物品"，请让它**看起来普通**，把真正的作用写进 effect（玩家自己发现才有意思）。`;
}

/**
 * 怪物 / 敌对者表生成：**只做这一件事**（R38）。
 *
 * 和道具表同一思路：能用独立步骤生成的，就别混在一次生成里。
 * 以前怪物的数值靠模型临场发挥，同一个东西前后两轮血量、攻击方式都对不上，
 * 玩家打赢了也不知道赢在哪、输得也不服。定下来之后数值是引擎的事实，模型照此演出。
 */
export function monsterSystemPrompt(
  genre: Genre,
  rs: Ruleset,
  module: { title?: string; premise?: string; truth?: string; locations?: string }
): string {
  return `你是 TRPG 敌对者设计助手，服务于《${rs.name}》。当前题材是 **${genre.name}**。

## 世界观与舞台
${genre.setting}

## 这个模组
${module.title ? `《${module.title}》` : ''}
${module.premise ?? ''}
${module.locations ? `\n会出现的地方：\n${module.locations}` : ''}
${module.truth ? `\n（内部真相，用来判断这些敌对者是什么、从哪来）：${module.truth}` : ''}

**只输出 JSON，不要任何解释文字。**

格式：
{"monsters":[{"name":"名称","look":"外观/声音/气味","hp":12,"attack":"攻击方式与伤害骰","behavior":"怎么打、什么时候退","weakness":"弱点或破解方式"}]}

要求：
- 2-5 个，全部中文，贴合上面的世界观与这个模组的规模。
- **name 2-6 字**，像玩家会在战斗面板里看到的那一行。
- **look 一句话（20-35 字）**：它长什么样、有什么声音或气味——只写玩家用感官能确认的，不要写来历。
- **hp 给一个整数**，按《${rs.name}》的尺度来（${rs.vitalDefs.map((v) => `${v.label}默认 ${v.default}`).join('、')}）。
- **attack 写清方式与伤害骰**（如"爪击 1d6""掐住喉咙 1d4+2"），不要只写"很强"。
- **behavior 30-60 字**：它怎么接近、什么时候退开、会不会追。这条决定战斗的手感。
- **weakness 20-40 字**：**必须给**。玩家永远要有一条活路——怕什么、怎么逼退、怎么让它分神。
  没有弱点的敌人不是难度，是刁难。
- 不要设计"打不死只能逃"的东西，除非这个模组本来就是逃亡向；那种情况在 behavior 里写清楚"它不会被杀死"。`;
}

/**
 * 结局（结档）正文。
 *
 * 用户定调：**死亡 = 结档**，是这段故事的收束，不是"你死了，请重来"。
 * 所以这里要的是一段**有重量的收束叙事**，不是系统提示语，
 * 也不许出现"游戏结束""请重新开局"这类跳出戏外的话。
 */
export function endingSystemPrompt(
  kind: 'death' | 'insanity' | 'success' | 'failure' | 'grey' | 'other',
  genre: Genre,
  module: { title?: string; premise?: string; truth?: string; endings?: string },
  character: { name?: string; gender?: string }
): string {
  const what =
    kind === 'death'
      ? '角色的生命走到了尽头。'
      : kind === 'insanity'
        ? '角色的理智彻底崩塌，他对世界的理解已经回不去了。'
        : kind === 'success'
          ? '**玩家达成了这一局的目标**——模组预设的"成功"结局成立了。'
          : kind === 'failure'
            ? '**玩家没能达成目标，代价落了下来**——模组预设的"失败"结局成立了。'
            : kind === 'grey'
              ? '**玩家逃过了最坏的结果，但也付出了代价**——模组预设的"灰色"结局成立了。'
              : '这段故事走到了它的终点。';
  return `你是这场单人跑团的守密人，现在要为这一局写**结局正文**。

## 题材与舞台
${genre.setting}

## 写法
${genre.tone}

## 发生了什么
${what}

## 模组（你才知道的真相，可以在结局里若隐若现，但不要变成说明文）
${module.title ? `《${module.title}》` : ''}
${module.premise ?? ''}
${module.truth ? `真相：${module.truth}` : ''}
${module.endings ? `模组预设的结局方向：${module.endings}` : ''}

要求：
- 中文，**250-450 字**，第二人称称呼玩家（"你"）。
- 这是一段**收束叙事**：写清楚这个结局是怎么落下来的——最后一刻发生了什么、
  周围的人与世界怎么反应、他留下了什么、这件事之后世界变成了什么样。
- **不要写玩家的台词、动作或念头**（这条红线和正文一样硬）。
- **绝对不要**出现"游戏结束""请重新开局""你可以读档""感谢游玩"这类跳出戏外的话。
  这是故事里的结局，不是程序提示。
- 不要总结、不要升华、不要说教式点评。写完最后一句就停笔。
- 结局可以有余味，但不要廉价鸡汤。${character.name ? `角色名：${character.name}。` : ''}`;
}

/** 队友生成：题材 + 规则双驱动 */
export function companionSystemPrompt(genre: Genre, rs: Ruleset): string {
  const isPercent = rs.mainDice === '1d100';
  return `你是 TRPG 队友生成助手，服务于《${rs.name}》。当前题材是 **${genre.name}**。

根据描述生成一名随行队友。**只输出 JSON，不要任何解释文字。**

## 题材（世界观与舞台）
${genre.setting}

## 队友的倾向（重要）
${genre.castHint}

格式：
{"name":"姓名","role":"身份","personality":"性格与说话方式","appearance":"外貌","initiative":"reactive|balanced|proactive","skills":{"技能名":数值},"vitals":{${rs.vitalDefs
    .map((v) => `"${v.key}":${v.default}`)
    .join(',')}}}

要求：
- 全部中文，贴合上面题材的世界观与时代。
- personality 60-120 字：写说话习惯、口头禅、害怕什么、在紧张时的反应。要具体，能让人一眼看出怎么演这个角色。
- **appearance 20-40 字：只写长相**（发型发色、五官特征、身形、衣着的主色与样式），
  供"按这名队友画立绘"用 —— 同一个角色往后重画都吃这一句，
  所以务必具体到"照着能画出同一张脸"，只写"衣着朴素"等于没写。不要写性格与身份。
- **要写出这个角色对玩家的态度**（是信赖、警惕、好奇，还是嘴上嫌弃）——这决定了他为什么会跟着玩家。
- initiative：话少沉稳或身份低微的选 reactive；好奇外向、职业需要主动追问的选 balanced；有主张、会擅自行动的选 proactive。**默认倾向 reactive，避免抢玩家风头。**
- vitals 只能填这几个键：${vitalSpec(rs)}；各取一个合理整数（参考默认值，**不要超过玩家的水平**）。
- skills 给 6-9 项${isPercent ? '，百分比整数' : '，加值'}，不要超过玩家的水平。`;
}

/** 世界书词条：只写客观事实 */
/*
 * ⚠️ 下面是**模板字符串**：正文里要写反引号必须转义成 \`（否则 TS1005），
 * 而且注释写进去会变成给模型看的正文 —— 要注释就写在这儿。
 *
 * 🔴 我已经在这上面栽了**三次**（H18 的星号不算，这里专指反引号）：
 * 每次都是"顺手给 JSON 字段名加个代码样式"。写提示词时**不要敲反引号**，
 * 要写就写 \` —— 或者干脆像下面那样用中文描述字段。
 */
export function worldbookSystemPrompt(genre: Genre): string {
  return `你是 TRPG 世界设定助手。当前题材：**${genre.name}**。
## 世界观
${genre.setting}

根据描述生成世界书条目。**只输出 JSON 数组，不要任何解释文字。**

格式：
[{"keys":["关键词1","关键词2"],"content":"设定正文","priority":数字,"constant":true或false,"budget":数字}]

要求：
- 每个条目只聚焦一个主题：地点、人物、组织、物品、或传说。
- keys 3-6 个，必须包含简称、别称、可能的错误叫法，这样玩家怎么提都能命中。
- content 100-250 字，**只写客观事实**（是什么、长什么样、有什么规矩），不要写剧情走向或"接下来会发生"。
- priority：核心设定 80-100，次要 30-60，边缘 10-30。
- **constant（要不要常驻）**：这条是不是"**不提也应该生效**"的世界底层——
  这座城/这个组织的规矩、通行货币、这里的信仰与禁忌、主角身份这类 → true；
  只在被提到时才需要的细节（某个具体人物、某件物品）→ false。
  ⚠️ **最多 2-3 条 true**：常驻条目每一轮都会占上下文，给多了会把对话挤没。
- **budget（字数上限）**：常驻的条目**必须**给一个（建议 150-250）；非常驻的写 0（不限制）。
- 生成 3-6 个条目。全部中文，贴合上面的世界观。`;
}

/**
 * 篇幅对应的时间尺度与规模要求。
 *
 * 为什么要写死：早期不分篇幅，模型默认把"紧迫感"写成「只剩 15 分钟 / 天亮之前」——
 * 短篇合适，长篇就完全对不上。横跨几周的调查被塞进 15 分钟，玩家一出门就"时间到"，
 * 而长篇该有的"走访、等待、日子一天天过去"的节奏全没了。
 */
const SCALE_GUIDE: Record<ModuleScale, string> = {
  short: `- **时间尺度以"小时"计**：一夜、一个下午、天亮之前。期限最长不超过 24 小时。
- urgency 写具体时限（"只剩今晚""船四点开"），压力要紧，但**要给玩家喘息的间隙**。
- 地点 3-5 个，三幕结构，一局就能跑完。`,
  medium: `- **时间尺度以"天"计**：3-7 天。可以有等待、走访、睡一觉再来的节奏。
- urgency 写"几天之内"的压力（"三天后船就开了""第七夜之前必须解决"），
  **不要写成"只剩 15 分钟"**——那是短篇的写法，中篇会显得荒谬。
- 地点 5-8 个，四到五幕，允许玩家来回走访、整理线索。`,
  long: `- **时间尺度以"周 / 月"计**：数周乃至数月。日子要一天天过去，允许玩家多次往返、慢慢逼近真相。
- urgency 写**长线的倒计时**（"下一次满月还有二十三天""雨季结束前她必须离开"），
  **绝不能写成"只剩 15 分钟"**。紧迫感来自"事情在恶化"，而不是"马上就到点"。
- 地点 8-12 个，写成**分章**的幕结构（第一章 / 第二章……），每章给一个阶段目标与可能的分支。
- acts 里请明确标出章节分界，并说明各章之间**世界会发生什么变化**（时间推进会让什么恶化、谁会先动手）。
- 这是骨架：每一章的具体场景会在进入该章时再按需展开，所以**不要试图一次写完所有细节**。`,
};

/**
 * 模组（剧本）生成：题材 + 规则双驱动。
 *
 * 注意 start_location / goal / stakes / urgency 都是"给玩家看的"，
 * 只能写玩家开局就能知道的信息——剧透会毁掉整局。
 */
/* ============================================================
 * R14 幕展开：把"当前这一幕"展开成导演稿
 * ============================================================ */

/** 生成"这一幕导演稿"的系统提示词（要求正文见 `core/acts.ts` 的 `ACT_EXPAND_SPEC`） */
export function actExpandSystemPrompt(
  genre: Genre,
  moduleTitle: string,
  skeleton: string,
  actNo: number,
  actTotal: number,
  actTitle: string,
  actSummary: string
): string {
  return [
    '你是这场跑团的守密人，正在为一场**已经开跑的长篇**做幕后功课。',
    `# 题材：${genre.name}`,
    `## 叙事风格（只是基调，别在这里写正文）\n${genre.tone}`,
    `# 模组：${moduleTitle || '（未命名）'}`,
    `## 完整幕结构（共 ${actTotal} 幕）\n${skeleton}`,
    ACT_EXPAND_SPEC,
    `# 你要展开的是：第 ${actNo} 幕 · ${actTitle}`,
    actSummary ? `（骨架里对这一幕的交代：${actSummary}）` : '',
    '**只输出 JSON，不要任何解释文字。**格式：',
    '{ "detail": "这一幕的导演稿，200-400 字，按上面的 1-5 点分条写" }',
  ]
    .filter(Boolean)
    .join('\n\n');
}

/** 幕展开的用户提示词：把"已经发生过什么"喂进去（**不许改写**） */
export function actExpandUserPrompt(
  moduleTitle: string,
  actNo: number,
  recentFacts: string
): string {
  return [
    `请为《${moduleTitle || '这一局'}》的第 ${actNo} 幕写导演稿。`,
    recentFacts
      ? `# 已经发生过的事（**这些是既成事实，只能遵守、不能改写**）\n${recentFacts}`
      : '# 已经发生过的事\n（刚开局，还没有多少既成事实。）',
    '记住：只写这一幕往后的走向，别重写已经发生的事，也别替玩家做决定。',
  ].join('\n\n');
}

/*
 * P2-9（协作方第 24 版 · 主人定「大问题」）：**题材压不过描述与规则包名**。
 *
 * 根因是提示词里的权重错位：
 *   ① 非原版时，user 消息就是描述原文（任务感最强、且位置最靠后）→ 描述成了唯一的"任务"；
 *   ② system 开头「服务于《${rs.name}》」把**规则包名**摆成了"世界出处"
 *      → 模型自述"结合 COC 规则与时代背景"，读的就是这句；
 *   ③ :478 那句"严格贴合题材"躺在 system 里，被 user 的任务感盖过。
 * → 权重变成「描述＞规则包名＞题材」，题材实际上没有说话的份。
 *
 * 修法：**题材升到 user（任务位）+ 规则包降为机制出处**。见下面两处。
 */
export function moduleSystemPrompt(genre: Genre, rs: Ruleset, scale: ModuleScale = 'short'): string {
  /*
   * ⚠️ 这一句以前写「服务于《${rs.name}》」，把**规则包**当成了世界的出处 ——
   * 于是题材=赛博朋克、规则包=COC 时，模型会把世界拉回克苏鲁底色。
   * 现在把它明确降为**只管判定与数值**，世界由题材决定。
   */
  return `你是 TRPG 模组（剧本）创作助手。当前题材是 **${genre.name}**。
你要产出的**不是一份完整剧本，而是一份"故事骨架"** —— AI 守密人会据此即兴生成具体场景与对白。

【机制出处】判定与数值由规则包《${rs.name}》决定；**世界、时代、舞台、风格一律由题材决定**。
《${rs.name}》只决定怎么掷骰、怎么算数值，**它不是这个世界的出处**，别把规则包的招牌当成世界底色。

## 题材 ·【硬约束】（世界观与舞台）
${genre.setting}

## 叙事风格 ·【硬约束】（必须贯穿整份骨架）
${genre.tone}

## 这个世界里通常有哪些人 ·【硬约束】
${genre.castHint}

## 篇幅：**${SCALE_LABEL[scale]}**
${SCALE_GUIDE[scale]}

根据描述创作一个${scale === 'long' ? '长篇' : scale === 'medium' ? '中篇' : '短篇'}模组。**只输出 JSON，不要任何解释文字。**

格式：
{"title":"模组名","premise":"前言","opening":"开场白","start_location":"开局地点","goal":"玩家目标","stakes":"赌注","urgency":"紧迫感","truth":"真相","npcs":[{"name":"","role":"","motive":"","secret":""}],"locations":"关键地点","map_nodes":[{"name":"地点名","links":["与之相通的地点"],"note":"一句话"}],"clueChain":"线索链","acts":"幕结构","endings":"结局与失败条件","notes":"GM 备注","source_note":"来源说明","start_clock":{"day":1,"minute":540},"deadline_in":0}

要求：
- 全部中文，严格贴合上面题材的世界观、时代与风格。
- title 6-15 字，像一部作品的名字。
- premise 120-200 字：玩家能听到的开局引子（时间地点、关键人物、核心悬念、为什么找上玩家）。
- opening 150-300 字：玩家看到的第一幕，第二人称"你"，以一个"等待玩家行动"的悬停点收尾——**不要写玩家的台词或动作，也不要替玩家做决定**。可用占位符 {{称呼}} 指代玩家。**开场必须让玩家看见目标与紧迫感**，不能只写环境描写。
- **start_location 6-15 字**：第一幕玩家**此刻身处**的具体地点。这是开团时"当前地点"的初值，必须写。
- **goal 20-50 字（最重要）**：玩家在这个故事里**要达成什么**，一句话、具体到可执行（如"查出玛乔丽的下落并拿到那卷胶卷"，而不是"调查真相"这种空话）。这是玩家最容易迷茫的一环，必须写死一个明确方向。
- **goal / stakes / urgency 只写玩家开局就能知道的信息**：可以点出"有人失踪了""灯塔不亮""时间紧迫"这类**表层悬念**，
  **绝不透露真相、幕后黑手、关键物品的真实性质**（那是 truth 的内容）。剧透会毁掉整局体验。
- **stakes 20-50 字**：不做、或失败会付出什么代价。给行动以重量，让玩家觉得"这事值得冒险"。
- **urgency 20-50 字**：为什么是**现在**，不能再等。**时间尺度必须与上面的篇幅一致**——
  短篇写"只剩今晚"，中篇写"三天后船就开了"，长篇写"下次满月还有二十三天"。
  写错尺度会让整局的节奏崩掉（长篇被压进 15 分钟，玩家一出门就"时间到"）。
- truth 150-250 字：幕后到底发生了什么。语气客观，这是给 GM 的内部真相。
- npcs：短篇 2-4 个；中篇 3-5 个；长篇 4-6 个（允许分属不同章节）。
  每个含 name（姓名）/ role（身份）/ motive（动机）/ secret（不为人知的秘密）。**每个都要有可被利用的隐瞒或把柄**。
- locations：短篇 3-5 个、中篇 5-8 个、长篇 8-12 个，一行一个。
- **map_nodes 3-6 个**：把上面的地点做成"空间关系图"。每个节点给 name（地点简称，4-6 字）、
  links（**与之能直接走到的地点简称**，双向都要写，比如 A 的 links 里有 B，B 的 links 里也要有 A）、
  note（一句话说明这地方是什么样、有什么风险）。
  **起点 start_location 对应的节点必须存在**，并且要连到至少一个别的节点——这是玩家"从哪出发、能去哪"的依据。
- clueChain 60-150 字（长篇可到 250 字）：用"→"串起线索的推进顺序，保证玩家不会卡死。
- acts：短篇 80-150 字（三幕）；中篇 120-200 字（四到五幕）；
  长篇 200-350 字，**分章写**，每章给阶段目标与分支，并说明章与章之间世界会怎么变。
- endings 60-120 字：成功 / 失败 / 灰色结局各一条。
- notes 40-100 字：基调，以及反复出现的意象。
- source_note：一句话诚实说明这张卡的**来源与忠实度**，例如"已按原版《××》生成"、"未找到原版，按标题风格自创"、"原创模组"。不要夸大对原版的把握。
- **start_clock（故事开场的时刻，必须填）**：day = 第几天（从 1 起），minute = 当天第几分钟（0-1439）。
  按**你自己写的标题与开场白**来定：标题带"今夜/深夜"就是晚上（minute 约 1200-1400），
  "清晨"是早上（约 360-540），"黄昏"约 1020-1140。
  ⚠️ 别一律填上午九点（day 1 / minute 540）—— 那会让"今夜"的模组在上午开场，第一幕立刻穿帮。
  真的看不出来才回退到上午九点。
- **deadline_in（期限还剩多少分钟，可选）**：只有这张卡给了**明确期限**（"雨季还有二十三天结束"）才填，
  换算成分钟（23 天 = 33120）。没有明确期限就填 0 —— **不许凭空造一个期限**。`;
}

/**
 * 模组生成的用户侧提示词。
 * `canonical` = 用户给的是**已出版模组的名字**：让模型尽量按原版设定填卡。
 */
/**
 * 这个题材是不是「完全自由」—— 是的话**不设题材硬约束**，世界完全由玩家写的东西决定。
 * （主人 2026-09-24 裁决：不加"原版优先"分支，改用这个题材给出出口。）
 */
export function isFreeGenre(genre?: Genre): boolean {
  return genre?.id === 'free';
}

export function moduleUserPrompt(desc: string, canonical: boolean, genre?: Genre): string {
  /*
   * P2-9：把**题材从 system 提到 user**，与描述并排，并写死裁决。
   *
   * 以前非原版时 user 只有描述原文 —— 描述是最后一个被读到的、任务感最强的东西，
   * 于是"题材贴合"那句（躺在 system 里）根本压不住它。题材现在必须站在同一个位置。
   */
  const hasDesc = desc.trim() !== '';
  // 「完全自由」题材：不设题材硬约束，玩家写什么世界就是什么
  const free = isFreeGenre(genre);
  const genreName = genre?.name ?? '这个题材';

  const genreBlock = free
    ? '【世界 · 完全自由】本题材不预设任何世界。**以你下面写的设想为准**——你写的时代、风格、世界就是这个世界，不要套用任何现成题材的刻板印象。'
    : `【世界题材 · 硬约束】本模组的世界必须是「${genreName}」。`;

  const base = hasDesc
    ? `${genreBlock}
【玩家想要的故事 · 元素必须全部保留】${desc.trim()}
要求：上面设想里的每个人名 / 地名 / 组织 / 物件 / 事件都要出现在成品里（换个说法也算），
并翻译进${free ? '你写出的这个世界' : `「${genreName}」的世界观`}；
若设想的时代 / 风格 / 世界与${free ? '你的设想本身' : '题材'}冲突，以${free ? '设想' : '题材'}为准，且只改包装、不删元素。`
    : // 空描述维持现状 —— 第 24 版 C 轮已证明它工作正常
      `请自由创作一个适合「${genreName}」的短模组。`;

  if (!canonical) return base;
  return `${base}

【重要】上面给的是一个**已出版模组的名字**。请尽量按你了解的**原版设定**来填这张卡——
原版的背景、关键人物、真相与线索链，不要自创。
并在 source_note 里**如实说明**你对原版的把握：
- 很熟悉 → "已按原版《××》生成"
- 只记得大概 → "部分还原，其余按原作风自创"
- 没把握 / 没听说过 → "未找到原版，已按标题风格自创"（然后按名字暗示的时代与风格创作一个前后一致的版本）
绝不要假装你还原了原版。`;
}

/**
 * 「贴任意文本 → 整理成模组卡」。
 * 注意这不是做格式兼容（市面模组是 PDF/文本，没有通用交换格式），
 * 而是让模型读懂原文、再按我们的骨架填卡。
 */
export function importSystemPrompt(genre: Genre): string {
  return `你是 TRPG 模组整理助手。当前题材：**${genre.name}**。

玩家会贴进来一段**任意格式的文本**（可能是模组原文片段、故事梗概、设定资料、小说，甚至安科）。
你的任务是：**读懂它，把它整理成一张模组卡**。**只输出 JSON，不要任何解释文字。**

格式：
{"title":"模组名","premise":"前言","opening":"开场白","start_location":"开局地点","goal":"玩家目标","stakes":"赌注","urgency":"紧迫感","truth":"真相","npcs":[{"name":"","role":"","motive":"","secret":""}],"locations":"关键地点","map_nodes":[{"name":"地点名","links":["与之相通的地点"],"note":"一句话"}],"clueChain":"线索链","acts":"幕结构","endings":"结局与失败条件","notes":"GM 备注","source_note":"来源说明","start_clock":{"day":1,"minute":540},"deadline_in":0}

要求：
- **忠实于原文**。原文写过的人名、地名、真相、线索链，照搬，不要自创替换。
- 原文**没交代**的部分（玩家目标、赌注、紧迫感、幕结构、结局、开局地点），由你补全——
  按原文的风格与逻辑合理推演，并在 source_note 里说清哪些是你补的。
- **goal 必须写**：一句话、具体到可执行（如"查清 X 的下落"），这是玩家最容易迷茫的一环。
- **start_location 必须写**：第一幕玩家**此刻身处**的具体地点，开团时"当前地点"的初值。
- **goal / stakes / urgency 只能是玩家开局就能知道的信息**，绝不透露真相、幕后黑手或关键物品的真实性质（剧透会毁掉整局）。
- locations 一行一个，3-5 个关键地点。
- map_nodes 3-6 个：把地点做成空间关系图（name / links 双向 / note），起点对应的节点必须存在且至少连一个别的节点。
- 全部中文（原文是外文就译过来）。
- 保持原文的题材与氛围，不要擅自改成别的风格。`;
}

/** 模组包配套生成：基于模组骨架，产出世界书词条与队友候选 */
export function packSystemPrompt(genre: Genre, rs: Ruleset): string {
  return `你是 TRPG 模组配套生成助手。当前题材：**${genre.name}**。
基于给定的模组骨架，产出配套的【世界书词条】与【队友候选】。**只输出 JSON，不要任何解释文字。**

## 世界观
${genre.setting}
## 人物倾向
${genre.castHint}

格式：
{"entries":[{"keys":["关键词"],"content":"设定正文","priority":50}],"companions":[{"name":"姓名","role":"身份","bond":"与玩家的关系","personality":"性格","secret":"他不愿让人知道的","agenda":"他自己的打算","initiative":"reactive","skills":{"技能":数值},"vitals":{${rs.vitalDefs
    .map((v) => `"${v.key}":${v.default}`)
    .join(',')}}}]}

要求：
- entries 4-6 条：模组里的地点 / 组织 / 关键物品 / 背景传说。
  **只写客观事实（是什么、什么样、有什么规矩），绝不透露真相、结局或任何剧透。**
  keys 3-6 个，必须含简称、别称、可能的错误叫法。
- companions 3-4 个：必须符合模组的**时代与地点**，性格写到"能演出来"的程度；
  **bond** 写清"与玩家的关系/入队缘由"，
  **agenda** 写他自己的小目的（不能喧宾夺主、不能替玩家推进主线），
  **secret** 写他不愿让人知道的事；
  initiative 默认 reactive（避免抢玩家风头），最多一个 balanced；
  vitals 只填这些键：${vitalSpec(rs)}（取合理整数，别超过玩家水平）。
- **人名、地名必须与模组完全一致**（同一套世界观）。
- 全部中文。`;
}

/* ============================================================
 * 三、「导入文本 → 一整套游玩预设」
 *
 * 玩家不想一个个调判定条件。这里让模型读懂文本，
 * 直接产出一套能开玩的预设：题材风格 + 模组 + 世界书 + 队友（+ 可选自定义规则）。
 * ============================================================ */
export function presetSystemPrompt(rs: Ruleset): string {
  return `你是 TRPG 预设生成助手。玩家会贴进来一段**任意文本**（跑团模组、小说、安科、设定集……）。
你要读懂它，产出一整套**可以直接开玩的预设**。**只输出 JSON，不要任何解释文字。**

格式：
{
  "name":"预设名（6-15 字）",
  "genre":{
    "name":"题材名（如：赛博朋克侦探）",
    "blurb":"一句话简介（20 字内）",
    "setting":"世界观与舞台（60-120 字：时代、地点、社会背景）",
    "tone":"叙事风格与禁忌（80-150 字：这个题材该怎么写才对味、要避免什么）",
    "imageStyle":"生图画风描述（30-60 字，中文）",
    "castHint":"这个世界里通常有哪些人（40-80 字）"
  },
  "module":{"title":"","premise":"","opening":"","start_location":"","goal":"","stakes":"","urgency":"","truth":"","npcs":[{"name":"","role":"","motive":"","secret":""}],"locations":"","map_nodes":[{"name":"","links":[],"note":""}],"clueChain":"","acts":"","endings":"","notes":"","source_note":"","start_clock":{"day":1,"minute":540},"deadline_in":0},
  "worldbook":[{"keys":["关键词"],"content":"设定正文","priority":50}],
  "companions":[{"name":"","role":"","bond":"","personality":"","secret":"","agenda":"","initiative":"reactive","skills":{"技能":数值},"vitals":{${rs.vitalDefs
    .map((v) => `"${v.key}":${v.default}`)
    .join(',')}}}],
  "ruleset":null
}

要求：
- **忠实于原文**：人名、地名、设定、真相照搬，不要自创替换。原文没写的（目标、赌注、紧迫感、幕结构、结局）由你合理补全。
- **genre 最重要**：它决定这一局整体的味道。要真的从原文里提炼出题材特征，而不是套模板。
  若原文是安科/网文等强烈风格化的作品，genre.tone 要写出它的**味道**（节奏、语气、常用桥段、禁忌）。
- **module 的 goal / stakes / urgency 只能是玩家开局就能知道的信息**，绝不透露真相或关键物品的真实性质（剧透会毁掉整局）。
- module.opening 150-300 字，第二人称"你"，以"等待玩家行动"收尾，不要写玩家的台词或动作；可用 {{称呼}} 指代玩家。
- module.start_location 必须写：第一幕玩家此刻身处何处。
- worldbook 4-6 条，只写客观事实，不剧透。
- companions 2-4 个，符合原文的人物；initiative 默认 reactive（最多一个 balanced）。
  skills 用数值整数 ${rs.mainDice === '1d100' ? '（百分比 0-95）' : '（加值，通常 0~+6）'}；vitals 只填这些键：${vitalSpec(rs)}。
- **ruleset 一般为 null**（沿用当前规则包）。只有当原文的判定方式明显**无法**用当前规则包表达时，
  才给出一个：{"mode":"under|over","mainDice":"1d100|1d20|2d6","attrs":"力量=50\\n敏捷=50","skills":"侦查=25\\n聆听=20","vitals":"生命值=12"}
  （mode=under 表示"点数越小越好"，over 表示"越大越好"；attrs/skills/vitals 每行"名称=默认值"）
- 全部中文（原文是外文就译过来）。`;
}

/* ============================================================
 * 四、生图提示词 —— 画风由题材决定
 * ============================================================ */

/**
 * 默认画风（题材没给时兜底）。
 *
 * 🔴 为什么是「中文题材 + 英文硬约束」两段式（2026-09-26 实测定版，勿改回纯中文）：
 * 原先这段是纯中文（"精细的赛璐璐上色，色彩层次丰富…"），用 WorkBuddy 平台生图与
 * 硅基流动 Qwen/Qwen-Image 各跑了一轮，**中文软形容词压不住画风** —— 模型会自动往
 * "写实厚涂 / 概念设定图"跑，出图偏油画质感，不是动画片。
 * 换成下面这串英文硬约束后，赛璐璐质感稳定复现。原因：这些是绘图模型训练时
 * 见惯的技法词（cel shading / flat color / line art），指向唯一且强。
 *
 * 主人 2026-09-26 看过对比图后拍板用 B 版（本串），原话：「就用B」。
 */
export const IMAGE_STYLE =
  '赛璐璐动画插画，干净的平涂色块，明朗的硬边阴影，清晰的黑色描边线稿，' +
  '无厚涂笔触，无油画质感，无写实渲染；' +
  'anime key visual style, cel shading, clean flat color blocks, ' +
  'crisp hard-edged shadows, distinct black outline line art, ' +
  'no painterly texture, no photorealistic rendering';

/**
 * 背景充实约束（中文）—— 独立于画风，所有品类共用。
 *
 * 单拎出来是因为它跟"怎么画"无关，是"画什么"：模型偷懒时会交一张纯色背景，
 * 立绘尤其常见。放在画风后面会跟英文硬约束混成一句，模型容易只顾质感忘了背景。
 */
export const IMAGE_BACKGROUND_RULE =
  '画面必须有完整而细腻的环境背景（建筑、家具、窗光、地面、装饰），电影感构图，画面干净清晰';

/** 取画风：题材优先，其次默认；两者都拼上背景充实约束 */
function styleOf(genre?: Genre): string {
  const s = genre?.imageStyle?.trim();
  return s ? `${s}，${IMAGE_STYLE}，${IMAGE_BACKGROUND_RULE}` : `${IMAGE_STYLE}，${IMAGE_BACKGROUND_RULE}`;
}

/**
 * 立绘构图约束（中文 + 英文）。
 *
 * ## 🔴 为什么必须显式说"别裁头"（2026-09-26 的 bug）
 * 立绘是 3:4 竖版，模型很容易把人物放到"顶满画幅"——
 * 出图后头顶已经贴着上边缘，稍一裁切就**少一截**。
 * 光说"半身像"不够（模型对"半身"的默认取景比我们要的更满），
 * 得把"**头部完整 + 上方留白 + 不要特写**"明说出来。
 *
 * 英文那串是实测更管用的（与 `IMAGE_STYLE` 同理：技法词指向唯一）。
 * ⚠️ 这是**第二道防线** —— 第一道是 UI 容器比例必须与生成尺寸一致
 * （`ui/ImageField.tsx` 走 `aspectRatioOf`），那道错了，这句写得再好也白搭。
 */
export const PORTRAIT_FRAMING_RULE =
  '半身构图，人物位于画面中间，头顶上方留出空间，头部完整不被裁切，不要特写；' +
  'medium shot, full head visible, comfortable headroom above the head, ' +
  'not cropped at the top, head and shoulders well inside the frame, not a close-up';

/**
 * 角色立绘提示词：第三视角半身/全身，带上性别外貌与服装，并给出具体环境
 *
 * ## 🔴 "画谁"只认一处：外貌锚点（`core/appearance.ts` 的 `appearanceOf`）
 * 以前这里接的是 `c.description`（主角是"外貌+来历"混写的一大段，队友连这段都没有）——
 * 队友只能凭"铁路工 / 话少"让模型自己脑补长相，**每次重生成都是一张陌生的脸**。
 *
 * 现在优先吃 `appearance`（AI 生成角色时一并产出、玩家可在准备页改）；
 * **没有时才退回 `description`** —— 老存档、手写卡的提示词一个字都不变。
 */
export function characterImagePrompt(
  c: {
    name: string;
    gender?: string;
    description?: string;
    /** 外貌锚点（新增，生图专用；没有就退回 description） */
    appearance?: string;
  },
  genre?: Genre
): string {
  const parts = [
    '动漫角色立绘，第三视角半身像',
    appearanceOf(c) || '一名角色',
    c.gender ? `性别为${c.gender}` : '',
    genre ? `题材：${genre.name}` : '',
    '身后是有细节的具体环境（室内或街道等），人物与背景都清晰',
    PORTRAIT_FRAMING_RULE,
    styleOf(genre),
  ];
  return parts.filter(Boolean).join('，');
}

/** 场景立绘提示词：广角全景（establishing shot），把玩家角色也画进去（不是第一视角） */
export function sceneImagePrompt(
  location: string,
  premise?: string,
  player?: { name: string; gender?: string; description?: string },
  genre?: Genre
): string {
  const playerText = player
    ? `画面中要有玩家角色（${player.description?.trim() || '一名角色'}${
        player.gender ? `，${player.gender}性` : ''
      }）全身或半身入镜，采用第三视角的广角全景，视角拉远，展示整个空间`
    : '采用第三视角广角全景，视角拉远，展示整个空间';
  const parts = [
    '动漫场景插画，广角全景（establishing shot），镜头拉远',
    location?.trim() ? `地点：${location.trim()}` : '一个场景',
    genre ? `题材：${genre.name}` : '',
    premise?.trim() ? `背景设定：${premise.trim().slice(0, 120)}` : '',
    playerText,
    '只画设定里明确存在的事物，不要无中生有地添加物品',
    styleOf(genre),
  ];
  return parts.filter(Boolean).join('，');
}

/** 地图总览提示词：俯视手绘区域图，把模组里的关键地点都标进去 */
export function mapImagePrompt(
  title: string,
  locations: string[],
  premise?: string,
  genre?: Genre
): string {
  const parts = [
    '手绘区域地图（羊皮纸 / 地图质感）',
    title?.trim() ? `地图主题：${title.trim()}` : '',
    genre ? `题材：${genre.name}` : '',
    locations.length
      ? `需要能看出这些区域的位置关系：${locations.slice(0, 8).join('、')}`
      : '',
    premise?.trim() ? `背景设定：${premise.trim().slice(0, 100)}` : '',
    '俯视视角，画出街道、房屋轮廓、地形（河/林/码头等），色调统一',
    '画面干净，只保留极少量地名标注，不要出现大段文字说明',
    styleOf(genre),
  ];
  return parts.filter(Boolean).join('，');
}

/** 正文里"动作场景小图"提示词：依据某段正文 + 玩家角色，生成第三视角中景插画 */
export function actionImagePrompt(
  content: string,
  player?: { gender?: string; description?: string },
  genre?: Genre
): string {
  const playerText = player
    ? `玩家角色（${player.description?.trim() || '一名角色'}${
        player.gender ? `，${player.gender}性` : ''
      }）入镜，第三视角`
    : '';
  const parts = [
    '动漫场景插画，第三视角中景',
    `场景内容：${content.trim().slice(0, 120) || '一个场景'}`,
    genre ? `题材：${genre.name}` : '',
    playerText,
    '画面有具体的环境背景与光影，不要无中生有地添加物品',
    styleOf(genre),
  ];
  return parts.filter(Boolean).join('，');
}
