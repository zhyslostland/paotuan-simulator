/**
 * 回溯锚点的判据（"哪些回合算关键抉择"）。
 *
 * ## 为什么单独一个文件
 * 这段逻辑原来写在 `App.tsx` 的回合收尾里，**没法单测** ——
 * 而"什么算关键抉择"恰恰是最容易越调越宽的东西（宽松到一定程度，
 * 回溯菜单就退化成一列上百条"掷骰失败：侦查"，等于没有）。
 * 与 `snapshotPrune.ts` / `purgeScope.ts` 同一条口径：判据抽出来，喂数组就能测。
 * 放在 `src/` 而非 `core/` 只因为入参形状贴着 UI 的消息与契约，函数本身是纯的。
 *
 * ## 判据（2026-09-17 主人拍板：**精简版**）
 *
 * | 事件 | 记不记 | 为什么 |
 * |---|---|---|
 * | **掷骰** | **只在没过时记** | 想回退的通常是"那一下没掷过去"；成功的那次不需要回到 |
 * | 受伤 / 理智受创 | **不记** | 那是**结果**，不是玩家的选择 —— 回溯的语义是"我在某个决定上走错了" |
 * | 进入 / 结束战斗 | 记 | 局面性质变了，是真岔路口 |
 * | 新线索 | 记 | 拿到新信息 = 视野变了 |
 * | 新支线 | 记 | 故事开了条新线 |
 * | 移步 | **只记首次到访** | 长局里来回跑腿几十次，每次记会把真岔路口淹没 |
 *
 * 一句话：**记"选择"，不记"结算"。**
 */

/** 契约里的一条状态变更（只取判据用得到的字段） */
export interface AnchorDelta {
  target: string;
  op?: string;
  value?: unknown;
  amount?: number | string;
}

export interface AnchorInput {
  /** 玩家这一轮的检定（`success === false` 才算"没过"） */
  check?: { skill?: string; success?: boolean } | null;
  /** 本轮契约里的 state_delta */
  deltas?: readonly AnchorDelta[];
  /** 已经去过的地点（用于判断"是否首次到访"） */
  visited?: readonly string[];
}

/** 掷骰失败时的锚点标签（与其它 reason 拼在一起显示） */
export const ROLL_FAIL_REASON_PREFIX = '掷骰失败：';

/**
 * 算出这一轮该记哪些锚点理由。**空数组 = 不记**。
 *
 * 返回的是"理由"而不是布尔：同一个回合可能同时命中多件，
 * 取第一件当标签（`App.tsx` 里负责拼 `第N回 · 行动 · 理由`）。
 */
export function anchorReasons(input: AnchorInput): string[] {
  const reasons: string[] = [];
  const push = (r: string) => {
    if (r && !reasons.includes(r)) reasons.push(r);
  };

  // 掷骰：**只在没过时记**（成功不记；没有 success 字段的旧消息也当不记，保守）
  const check = input.check;
  if (check && check.success === false && (check.skill ?? '').trim()) {
    push(`${ROLL_FAIL_REASON_PREFIX}${String(check.skill).trim()}`);
  }

  const visited = input.visited ?? [];
  for (const d of input.deltas ?? []) {
    if (!d?.target) continue;
    const t = d.target;

    if (t === 'combat.active') {
      push(d.value ? '进入战斗' : '战斗结束');
    } else if (t === 'location') {
      // 位移与事件分开对待：只有**首次到访**才算岔路口
      const dest = String(d.value ?? '').trim();
      if (dest && !visited.includes(dest)) push(`移步：${dest}`);
    } else if (t === 'clues' && d.op === 'add') {
      push('新线索');
    } else if (t === 'threads' && d.op === 'add') {
      push('新支线');
    }
    // 受伤 / 理智受创**刻意不记** —— 那是结果，不是选择（见文件头）
  }

  return reasons;
}
