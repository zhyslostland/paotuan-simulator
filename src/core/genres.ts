/**
 * 题材预设（Genre）
 *
 * 一个"题材"= 一整套**玩法口味**，而不是只换规则：
 * - setting   世界观与时代（决定模组生成与场景描写）
 * - tone      守密人的叙事风格（决定故事"有没有味"）
 * - imageStyle 生图画风（决定立绘/场景长什么样）
 * - castHint  队友与 NPC 的生成倾向（决定"有没有美少女"）
 * - suggestRuleset 建议搭配的规则包（只是默认值，玩家可自由换）
 *
 * 设计要点：题材与规则**正交**。你可以用 COC 的百分比检定跑东京怪谈，
 * 也可以用 DnD 跑校园日常。换题材不强制换规则。
 */

export interface Genre {
  id: string;
  name: string;
  /** 一句话简介（在选择器里给玩家看） */
  blurb: string;
  /** 世界观 / 时代 / 舞台 */
  setting: string;
  /** 守密人的叙事风格与禁忌 */
  tone: string;
  /** 生图画风后缀 */
  imageStyle: string;
  /** 队友与 NPC 的生成倾向 */
  castHint: string;
  /** 建议搭配的规则包 id */
  suggestRuleset?: string;
  /** 内置题材不可删；自建/导入的为 false */
  builtin?: boolean;
}

export const GENRE_COC: Genre = {
  id: 'coc',
  name: '经典克苏鲁',
  blurb: '1920 年代的欧美，调查员撞上不该知道的事',
  setting:
    '1920 年代（可放宽到 1890s–1930s）的欧美：新英格兰小镇、旧宅、大学、精神病院、私人诊所、海外考察地。有电报、老照片、档案室、私家侦探与禁酒令的时代质感。',
  tone: '克制的悬疑与不安。恐怖来自"未知与无力"——规律失效、熟悉之物变得陌生、理智无法解释，而不是血腥猎奇。语言冷静具体，多用时代细节（档案、电报、旧报纸）建立真实感，少写内脏与残肢。',
  imageStyle: '1920 年代欧美复古色调，阴郁克制的赛璐璐动画插画，服装与建筑有明确的年代感',
  castHint: '同时代的普通人：记者、医生、大学教授、私家侦探、警察、神职人员、落魄贵族。',
  suggestRuleset: 'coc7',
  builtin: true,
};

export const GENRE_TOKYO: Genre = {
  id: 'tokyo',
  name: '东京怪谈',
  blurb: '当代日本都市传说，日常只隔一层纸',
  setting:
    '当代（平成末—令和）的日本都市与近郊：深夜便利店、老旧公寓、废弃医院、学校旧校舍、地铁末班车、地方小城的隧道与神社。手机、监控、社交网络是日常的一部分。',
  tone: '都市传说的湿冷感。日常与非日常只隔一层纸——熟悉的便利店、手机屏幕、电车广播里出现不该有的东西。节奏快、留白狠，用现代生活细节制造错位感；不解释全部，让玩家自己拼。',
  imageStyle: '现代日本都市夜景，霓虹与阴影对比强烈，雨夜湿滑的街道反光，赛璐璐动画插画风格',
  castHint: '现代日本人：高中生、大学生、便利店店员、自由记者、神社巫女、刑警、YouTuber。名字用日式姓名。',
  suggestRuleset: 'coc7',
  builtin: true,
};

export const GENRE_ACG: Genre = {
  id: 'acg',
  name: '二次元日常',
  blurb: '轻快的校园与社团生活，角色关系是核心',
  setting:
    '当代或近未来的日本/架空都市，舞台以学校、社团活动室、咖啡店、合租屋、夏日祭为主。生活气息重于宏大阴谋。',
  tone: '轻快明亮的基调，角色关系与成长是核心。即使有悬疑或超自然，也保持"青春感"——用对话、吐槽与生活细节推进，多用轻喜剧节奏，避免持续压抑。',
  imageStyle: '明亮清新的二次元动漫插画，柔和通透的光影，丰富的日常环境细节与生活小物',
  castHint:
    '同学、社团伙伴、学妹学姐、店长、邻家少女——**以美少女角色为主**，性格反差要大（元气/傲娇/天然/腹黑），每人有口癖与独特反应。',
  suggestRuleset: 'coc7',
  builtin: true,
};

export const GENRE_PINK: Genre = {
  id: 'pink',
  name: '情感线（粉红团）',
  blurb: '心动与距离感是主菜，暧昧但不露骨',
  setting:
    '不限时代与规则，舞台聚焦在能产生亲密互动的场所：校园、职场、合租屋、雨夜的车站、深夜的便利店、旅行途中的旅馆。',
  tone: '**情感张力是主菜**。重点写心动、试探、误会、距离感——眼神、呼吸、犹豫、没说出口的话。每一次互动都要让关系**推进或拉扯**，不能停在原地。**暧昧但不露骨**：可以写心动、牵手、拥抱、脸颊的温度、欲言又止、同处一室的紧张感；**绝不写性行为的细节**，需要时用留白（场景切换 / 天亮之后）带过。不要低俗，要真心动。',
  imageStyle: '柔和通透的二次元插画，暖调光线与浅景深，近距离构图，注重表情与氛围',
  castHint:
    '**默认全部为女性角色**（美少女），性格反差要大：温柔、傲娇、冷淡、元气、大姐姐型……每人都要有**对玩家独有的态度与称呼方式**，并保留一条可推进的关系线。',
  suggestRuleset: 'coc7',
  builtin: true,
};

export const GENRE_FANTASY: Genre = {
  id: 'fantasy',
  name: '剑与魔法',
  blurb: '奇幻冒险，怪物、地城与古代遗迹',
  setting:
    '剑与魔法的奇幻世界：边境城镇、酒馆、地下城、荒野、古代遗迹、法师塔、王国与教团。有诸多族裔（人类、精灵、矮人、半身人）与真实存在的神明与魔法。',
  tone: '冒险与未知的奇幻基调。危险是真实的（怪物、陷阱、诅咒），但勇敢与智谋能得到回报。世界有它的规则（魔法体系、神明、种族关系），要让玩家感到"这个世界真的在运转"，而不只是背景板。',
  imageStyle: '史诗奇幻动漫插画，明亮饱和的色彩，盔甲、长袍与魔法光效，开阔的风景与宏大建筑',
  castHint: '冒险者同伴：战士、法师、游侠、牧师、盗贼、骑士、吟游诗人；可包含精灵、矮人等非人族。',
  suggestRuleset: 'dnd5e',
  builtin: true,
};

export const GENRE_URBAN: Genre = {
  id: 'urban',
  name: '都市异能',
  blurb: '现代都市里的超能力战斗与阴谋',
  setting:
    '表面正常的现代都市（可架空），少数人觉醒异能、或被卷入超自然势力之间。舞台是写字楼、地铁、地下实验室、旧工业区、深夜的便利店。手机与社交媒体照常存在。',
  tone: '快节奏、有张力的都市异能调子：能力要有限制、有代价，战斗靠规则与战术而非嘴炮；势力博弈与身份秘密贯穿始终。用现代生活的细节（消息、监控、社媒）制造真实感与反差。',
  imageStyle: '现代都市背景的动漫插画，强烈的明暗对比与霓虹色，异能光效与动作场面，赛璐璐上色',
  castHint:
    '同为异能者的同伴：格斗系、念动系、情报贩子、能力者组织的联络人……多为年轻人，性格鲜明，有人藏着不可告人的身份。',
  suggestRuleset: 'dnd5e',
  builtin: true,
};

/** 内置题材库（顺序＝选择器里的展示顺序） */
export const BUILTIN_GENRES: Genre[] = [
  GENRE_COC,
  GENRE_TOKYO,
  GENRE_ACG,
  GENRE_PINK,
  GENRE_FANTASY,
  GENRE_URBAN,
];

/** 找不到就回退到经典克苏鲁——绝不让题材缺失把提示词搞空 */
export function getGenre(id: string | undefined, custom: Genre[] = []): Genre {
  return (
    custom.find((g) => g.id === id) ??
    BUILTIN_GENRES.find((g) => g.id === id) ??
    GENRE_COC
  );
}

/** 内置 + 自建，合成完整列表（自建题材排在内置之后） */
export function listGenres(custom: Genre[] = []): Genre[] {
  const builtinIds = new Set(BUILTIN_GENRES.map((g) => g.id));
  return [...BUILTIN_GENRES, ...custom.filter((g) => !builtinIds.has(g.id))];
}
