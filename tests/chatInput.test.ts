/**
 * `G8`（协28 §F① 第 9 条 · 协29 表）：**手里还捏着没掷的检定，就先别发下一句**。
 *
 * 这一条上一版是**结构性缺陷**（测试方给的判据，不需要真机复现即可定性）：
 * 待掷队列的消费只发生在 `rollCheck` / `rollAllChecks` 两处，而 `sendToGm` 没有任何门，
 * 于是"不掷骰直接发下一句"→ 队列不被消费 → 那张检定卡**一直挂着**。
 *
 * 判据抽成纯函数是为了它能被盯住（组件里的交互 SSR 测不到，见 `preparationSmoke`）。
 */
import { describe, expect, it } from 'vitest';
import { PENDING_CHECK_BLOCK_NOTE, draftBlockReason } from '../src/ui/chatInput.js';

describe('G8：有待掷检定就先别发下一句', () => {
  const idle = { hasText: true, streaming: false, ended: false, pendingChecks: 0 };

  it('🔴 队列里有没掷的检定 → 拦住，并说人话（不是"按了没反应"）', () => {
    const note = draftBlockReason({ ...idle, pendingChecks: 2 });
    expect(note).toBe(PENDING_CHECK_BLOCK_NOTE);
    // 得告诉玩家出口在哪 —— 那张卡上有「掷骰」和「忽略」
    expect(note).toContain('掷掉');
    expect(note).toContain('忽略');
  });

  it('队列空了 → 放行（返回 null，不弹任何话）', () => {
    expect(draftBlockReason(idle)).toBeNull();
  });

  it('空草稿 / 守密人还在写 / 已结档 → 不出这句（那三种各有各的回执）', () => {
    // 空草稿时按钮本来就是灰的，不需要再压一句
    expect(draftBlockReason({ ...idle, hasText: false, pendingChecks: 1 })).toBeNull();
    // 流式期间有 P1-1 那句回执；结档有输入框自己的说明 —— 别叠着说
    expect(draftBlockReason({ ...idle, streaming: true, pendingChecks: 1 })).toBeNull();
    expect(draftBlockReason({ ...idle, ended: true, pendingChecks: 1 })).toBeNull();
  });
});
