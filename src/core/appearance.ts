/**
 * 外貌锚点 —— **角色立绘画的是"谁的哪张脸"**（美术阶段 2 的地基）。
 *
 * ## 以前是什么样
 * 「画什么」是每次**临时拼**出来的，两个地方各拼一套：
 *
 * | 谁 | 立绘提示词吃的是什么 |
 * |---|---|
 * | 主角 | `character.description`（外貌 + 年龄 + 身份 + 来历混在同一段里） |
 * | 队友 | `${role}。${personality}` —— **里面一个字的长相都没有** |
 *
 * 后果有两层：
 * 1. **队友每次重生成都是陌生人** —— 模型只能从"铁路工 / 话少"脑补一张脸；
 * 2. **外貌与扮演搅在一起** —— 玩家想改"他长什么样"，只能去改性格描述，
 *    改完连 GM 的扮演依据也跟着变了。
 *
 * ## 现在
 * 外貌有**一个字段**（`appearance`）、**一处取法**（`appearanceOf`）：
 * - 它进**契约**（AI 生成角色 / 队友时一并产出，见 `generate.ts`）；
 * - 它进**界面**（准备页能看能改）；
 * - 它跟着**角色档案库**走 —— 同名角色再取出来时，外貌还是那份，
 *   所以同一个角色跨局再画，用的是同一套外貌描述。
 *
 * ⚠️ **两条刻意的口径**：
 * 1. **旧档不吃亏**：没有 `appearance` 的老角色，走完全一样的兜底拼法（见下面优先级），
 *    既有提示词一个字都不变 —— 所以这是**可选新增字段，不升 `SAVE_VERSION`**。
 * 2. **改了外貌不会自动重画**：画不画仍然由玩家手里的「重新生成」决定。
 *    外貌改了但没重画，是"改了还没画"，不是 bug ——
 *    自动替玩家重画会盖住他的显式意图（阶段 0-3 的教训）。
 */

/** 能说出长相的角色形态。主角、队友都落得进来 */
export interface AppearanceSource {
  /** 专门写外貌的短句（新增字段，AI 生成或玩家手填） */
  appearance?: string;
  /** 老口径：主角那段描述（外貌混在里面） */
  description?: string;
  /** 老口径：队友的身份（凑不出长相，但撑得住"这是个什么人"） */
  role?: string;
  /** 老口径：队友的性格与说话方式 */
  personality?: string;
}

/**
 * 取这张脸的**描述串** —— 立绘提示词里"画谁"那一句。
 *
 * 优先级：**`appearance` > `description` > `role` + `personality`**。
 *
 * 为什么是这个顺序：`appearance` 是专门写给生图看的；`description` 里混着来历
 * （"曾是战地记者"这类进不了画面）；`role`/`personality` 根本不是外貌，
 * 但它们是老队友唯一的信息来源 —— 放在最后兜底，保证旧档提示词**一个字都不变**。
 *
 * 返回空串表示"连凑都凑不出来"，默认值由调用方给
 * （"默认画什么样的人"是调用方的口径，这里不替它决定）。
 */
export function appearanceOf(c: AppearanceSource): string {
  const own = c.appearance?.trim();
  if (own) return own;
  const desc = c.description?.trim();
  if (desc) return desc;
  const role = c.role?.trim();
  const personality = c.personality?.trim();
  if (role && personality) return `${role}。${personality}`;
  return role || personality || '';
}

/** 这个人有没有能画脸的素材（界面据此提示"填了外貌再画会更像"） */
export function hasAppearance(c: AppearanceSource): boolean {
  return (c.appearance ?? '').trim() !== '';
}
