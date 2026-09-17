/**
 * 回合快照的裁剪（G1）。
 *
 * ## 为什么要单独一个纯函数
 * 与 `purgeScope.ts` / `wounds.ts` 同一条口径：**判据要能单测**。
 * 它住在 `src/`（而不是 `core/`）只因为 `TurnSnapshot` 这个类型属于 UI 层，
 * 但函数本身是纯的、没有 IO、不 import store —— 可以直接喂数组测。
 *
 * ## 原来的问题（G1）
 * 裁剪是"超过上限就从最旧的开始丢"。这在长局里是错的：
 * **早期锚点会被裁掉**，而锚点恰恰是玩家最想回去的那几个岔路口
 * （"我好像在第三章那个决定上走错了"）—— 一局玩到六七十回合，
 * 前二十回合的关键抉择就全没了，回溯功能等于只对最近的一截有效。
 *
 * ## 现在的规矩
 * 1. **锚点豁免**：先从最旧的**非锚点**开刀，锚点尽量留。
 * 2. **但上限仍然是硬的**：极端情况（锚点多到超过上限）仍只保留**最近的** `limit` 条
 *    —— 内存与落盘不能无界。这条是兜底，不是常态；真撞上说明锚点判据太宽了（见台账 J 条）。
 * 3. **顺序不变**：输入是什么顺序，输出还是什么顺序（调用方按时间序给的）。
 */
export interface PrunableSnapshot {
  /** 关键抉择锚点。`true` 表示这一回合是个该长期留住的岔路口 */
  key?: boolean;
}

/** 是不是锚点。抽出来是为了"锚点"的定义只有一处 */
export function isAnchor(snap: PrunableSnapshot | undefined): boolean {
  return snap?.key === true;
}

/**
 * 按上限裁剪。**输入应为时间序（最旧在前）**，输出保持同一顺序。
 *
 * @param entries 已经过滤掉"消息已删除"的那些快照
 * @param limit   上限（含锚点）
 */
export function pruneSnapshots<T extends PrunableSnapshot>(
  entries: [string, T][],
  limit: number
): [string, T][] {
  if (limit <= 0) return [];
  if (entries.length <= limit) return entries;

  // ① 先从最旧的**非锚点**开刀
  const over = entries.length - limit;
  const drop = new Set<string>();
  for (const [id, snap] of entries) {
    if (drop.size >= over) break;
    if (isAnchor(snap)) continue; // 锚点豁免
    drop.add(id);
  }
  let kept = drop.size > 0 ? entries.filter(([id]) => !drop.has(id)) : entries;

  // ② 兜底：锚点自己就超上限了，只能保留最近的 limit 条（总得有个界）
  if (kept.length > limit) kept = kept.slice(kept.length - limit);
  return kept;
}
