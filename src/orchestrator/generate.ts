/**
 * 调用模型生成结构化 JSON。
 * 模型返回常常被 Markdown 围栏包裹、或夹带前后寒暄，这里做宽容解析。
 */
import { chat, type ModelConfig } from '../providers/model.js';
import type { Ruleset } from '../core/rulesets/types.js';
import type { Genre } from '../core/genres.js';

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

export async function generateJson<T>(
  system: string,
  user: string,
  cfg: ModelConfig
): Promise<T | null> {
  const raw = await chat(
    [
      { role: 'system', content: system },
      { role: 'user', content: user },
    ],
    { ...cfg, temperature: Math.min(cfg.temperature, 1.0) }
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

/** 角色卡生成：题材 + 规则双驱动 */
export function characterSystemPrompt(genre: Genre, rs: Ruleset): string {
  const spec = characterNumericSpec(rs);
  return `你是 TRPG 角色卡生成助手，服务于《${rs.name}》。当前题材是 **${genre.name}**。

根据玩家的描述生成一张玩家角色卡。**只输出 JSON，不要任何解释文字。**

## 题材（世界观与舞台）
${genre.setting}

## 这个世界里通常有哪些人
${genre.castHint}

格式：
{"name":"姓名","gender":"男|女","description":"描述","personality":"性格","scenario":"开局处境","characteristics":${spec.attrExample},"skills":{"技能名":数值,...},"items":[{"name":"物品名","desc":"一句话说明它是什么、能干嘛","kind":"weapon|tool|clue|consumable|other","damage":"1d10","skill":"对应检定技能"}]}

要求：
- 全部中文，姓名与身份要贴合上面题材的世界观与时代。
- gender 必填，只写"男"或"女"。
- description 80-150 字：外貌（一眼能记住的特征）+ 年龄 + 身份 + 来历，写成一段连贯的话，不要分点。
- personality 40-80 字：说话方式、性格弱点、在意什么。要具体到"能演出来"的程度。
- scenario 30-60 字：开局时这个人身处何地、正在做什么。
${spec.rules}
- items 3-6 项：这个人**随身携带**的物品（要写有用途的随身装备，不要写衣服这种理所当然的东西）。
  **每一项都必须给 desc**（20-35 字，说清"这是什么、能干嘛"）；是武器的还要给 kind:"weapon"、
  damage（伤害骰，如 "1d10"）、skill（对应检定技能）；消耗品给 kind:"consumable"；线索/信物给 kind:"clue"。
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
{"name":"姓名","role":"身份","personality":"性格与说话方式","initiative":"reactive|balanced|proactive","skills":{"技能名":数值},"vitals":{${rs.vitalDefs
    .map((v) => `"${v.key}":${v.default}`)
    .join(',')}}}

要求：
- 全部中文，贴合上面题材的世界观与时代。
- personality 60-120 字：写说话习惯、口头禅、害怕什么、在紧张时的反应。要具体，能让人一眼看出怎么演这个角色。
- **要写出这个角色对玩家的态度**（是信赖、警惕、好奇，还是嘴上嫌弃）——这决定了他为什么会跟着玩家。
- initiative：话少沉稳或身份低微的选 reactive；好奇外向、职业需要主动追问的选 balanced；有主张、会擅自行动的选 proactive。**默认倾向 reactive，避免抢玩家风头。**
- vitals 只能填这几个键：${vitalSpec(rs)}；各取一个合理整数（参考默认值，**不要超过玩家的水平**）。
- skills 给 6-9 项${isPercent ? '，百分比整数' : '，加值'}，不要超过玩家的水平。`;
}

/** 世界书词条：只写客观事实 */
export function worldbookSystemPrompt(genre: Genre): string {
  return `你是 TRPG 世界设定助手。当前题材：**${genre.name}**。
## 世界观
${genre.setting}

根据描述生成世界书条目。**只输出 JSON 数组，不要任何解释文字。**

格式：
[{"keys":["关键词1","关键词2"],"content":"设定正文","priority":数字}]

要求：
- 每个条目只聚焦一个主题：地点、人物、组织、物品、或传说。
- keys 3-6 个，必须包含简称、别称、可能的错误叫法，这样玩家怎么提都能命中。
- content 100-250 字，**只写客观事实**（是什么、长什么样、有什么规矩），不要写剧情走向或"接下来会发生"。
- priority：核心设定 80-100，次要 30-60，边缘 10-30。
- 生成 3-6 个条目。全部中文，贴合上面的世界观。`;
}

/**
 * 模组（剧本）生成：题材 + 规则双驱动。
 *
 * 注意 start_location / goal / stakes / urgency 都是"给玩家看的"，
 * 只能写玩家开局就能知道的信息——剧透会毁掉整局。
 */
export function moduleSystemPrompt(genre: Genre, rs: Ruleset): string {
  return `你是 TRPG 模组（剧本）创作助手，服务于《${rs.name}》。当前题材是 **${genre.name}**。
你要产出的**不是一份完整剧本，而是一份"故事骨架"** —— AI 守密人会据此即兴生成具体场景与对白。

## 题材（世界观与舞台）
${genre.setting}

## 叙事风格（必须贯穿整份骨架）
${genre.tone}

## 这个世界里通常有哪些人
${genre.castHint}

根据描述创作一个短模组。**只输出 JSON，不要任何解释文字。**

格式：
{"title":"模组名","premise":"前言","opening":"开场白","start_location":"开局地点","goal":"玩家目标","stakes":"赌注","urgency":"紧迫感","truth":"真相","npcs":[{"name":"","role":"","motive":"","secret":""}],"locations":"关键地点","map_nodes":[{"name":"地点名","links":["与之相通的地点"],"note":"一句话"}],"clueChain":"线索链","acts":"幕结构","endings":"结局与失败条件","notes":"GM 备注","source_note":"来源说明"}

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
- **urgency 20-50 字**：为什么是**现在**，不能再等。要给具体的时间压力（如"已失踪十一天""三天后船就开了"），逼着玩家往前走。
- truth 150-250 字：幕后到底发生了什么。语气客观，这是给 GM 的内部真相。
- npcs 2-4 个：每个含 name（姓名）/ role（身份）/ motive（动机）/ secret（不为人知的秘密）。**每个都要有可被利用的隐瞒或把柄**。
- locations 60-150 字：3-5 个关键地点，一行一个。
- **map_nodes 3-6 个**：把上面的地点做成"空间关系图"。每个节点给 name（地点简称，4-6 字）、
  links（**与之能直接走到的地点简称**，双向都要写，比如 A 的 links 里有 B，B 的 links 里也要有 A）、
  note（一句话说明这地方是什么样、有什么风险）。
  **起点 start_location 对应的节点必须存在**，并且要连到至少一个别的节点——这是玩家"从哪出发、能去哪"的依据。
- clueChain 60-150 字：用"→"串起线索的推进顺序，保证玩家不会卡死。
- acts 80-150 字：三幕结构与每幕的推进节点。
- endings 60-120 字：成功 / 失败 / 灰色结局各一条。
- notes 40-100 字：基调，以及反复出现的意象。
- source_note：一句话诚实说明这张卡的**来源与忠实度**，例如"已按原版《××》生成"、"未找到原版，按标题风格自创"、"原创模组"。不要夸大对原版的把握。`;
}

/**
 * 模组生成的用户侧提示词。
 * `canonical` = 用户给的是**已出版模组的名字**：让模型尽量按原版设定填卡。
 */
export function moduleUserPrompt(desc: string, canonical: boolean, genre?: Genre): string {
  const base =
    desc.trim() ||
    `请自由创作一个适合「${genre?.name ?? '这个题材'}」的短模组。`;
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
{"title":"模组名","premise":"前言","opening":"开场白","start_location":"开局地点","goal":"玩家目标","stakes":"赌注","urgency":"紧迫感","truth":"真相","npcs":[{"name":"","role":"","motive":"","secret":""}],"locations":"关键地点","map_nodes":[{"name":"地点名","links":["与之相通的地点"],"note":"一句话"}],"clueChain":"线索链","acts":"幕结构","endings":"结局与失败条件","notes":"GM 备注","source_note":"来源说明"}

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
  "module":{"title":"","premise":"","opening":"","start_location":"","goal":"","stakes":"","urgency":"","truth":"","npcs":[{"name":"","role":"","motive":"","secret":""}],"locations":"","map_nodes":[{"name":"","links":[],"note":""}],"clueChain":"","acts":"","endings":"","notes":"","source_note":""},
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

/** 默认画风（题材没给时兜底）：二次元动漫插画，强调必须有完整背景 */
export const IMAGE_STYLE =
  '二次元动漫插画风格（anime style），精细的赛璐璐上色，色彩层次丰富，画面有完整而细腻的环境背景，室内或户外的场景细节充实（建筑、家具、窗光、地面、装饰），电影感构图，画面干净清晰';

/** 取画风：题材优先，其次默认 */
function styleOf(genre?: Genre): string {
  const s = genre?.imageStyle?.trim();
  return s ? `${s}，${IMAGE_STYLE}` : IMAGE_STYLE;
}

/** 角色立绘提示词：第三视角半身/全身，带上性别外貌与服装，并给出具体环境 */
export function characterImagePrompt(
  c: {
    name: string;
    gender?: string;
    description?: string;
  },
  genre?: Genre
): string {
  const parts = [
    '二次元动漫角色立绘，第三视角半身像',
    c.description?.trim() || '一名角色',
    c.gender ? `性别为${c.gender}` : '',
    genre ? `题材：${genre.name}` : '',
    '身后是有细节的具体环境（室内或街道等），人物与背景都清晰',
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
    '二次元动漫场景插画，广角全景（establishing shot），镜头拉远',
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
    '二次元动漫风格的手绘区域地图（羊皮纸 / 地图质感）',
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
    '二次元动漫场景插画，第三视角中景',
    `场景内容：${content.trim().slice(0, 120) || '一个场景'}`,
    genre ? `题材：${genre.name}` : '',
    playerText,
    '画面有具体的环境背景与光影，不要无中生有地添加物品',
    styleOf(genre),
  ];
  return parts.filter(Boolean).join('，');
}
