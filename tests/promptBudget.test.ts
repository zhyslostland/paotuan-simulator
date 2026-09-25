/**
 * 系统提示词的超预算裁剪（优化计划 C″）。
 *
 * ## 为什么要有它
 * `prompt.ts` 文件头一直写着"超预算时从下往上砍"，但**从没实现过**：`sections` 只是
 * 数组拼接、没有上限。长局里编年史攒到 60 条、世界书命中一堆，提示词只涨不缩 ——
 * 而那些 token 是**玩家自己付的**。
 *
 * ## 判据
 * 1. **超限时「模组真相」仍在**（协作方第 9 版 §3 定）；
 * 2. **「编年史」先没** —— 事件日志排在尾部区域，是第一个让位的；
 * 3. **模组段本身超预算时也照样不许砍**（协作方第 12 版补的漏洞）——
 *    原先我以为"真相排在最前面、从尾砍天然碰不到"，**错了**：它实际在**下标 3**，
 *    裁剪循环只保下标 0。极端长局（规则+题材+口吻撑满预算）会一路砍到下标 1 把它砍掉。
 *    现在靠 `isProtectedSection` 显式保护 —— **宁可超预算，也不能丢真相**。
 *
 * 这里刻意不测"砍到第几段"这种实现细节（改顺序就红、没意义），
 * 只钉那两条**业务判据**。
 */
import { describe, expect, it } from 'vitest';
import {
  buildSystemPrompt,
  OUTPUT_CONTRACT,
  PROMPT_BUDGET_CHARS,
  trimToBudget,
} from '../src/orchestrator/prompt.js';
import { coc7 } from '../src/core/rulesets/index.js';

const ctx = () => ({
  rulesetName: 'COC 7th',
  ruleset: coc7,
  genre: {
    id: 'coc', name: '经典克苏鲁', blurb: '', setting: '', tone: '', imageStyle: '', castHint: '',
  },
  module: {
    title: '雾港',
    premise: '一艘停在港外的货船',
    opening: '',
    truth: '船主其实早就死了，是船员在轮流扮演他',
    npcs: [],
    locations: '码头',
    clueChain: '货单 → 船长室 → 底舱',
    acts: '',
    endings: '',
    notes: '',
  },
  character: {
    name: '甲', description: '', personality: '', mes_example: '',
    characteristics: { str: 50 }, skills: { 侦查: 50 },
  },
  playerAddress: '甲先生',
  gameState: {
    vitals: { hp: 10, san: 60, mp: 10 },
    companions: [], inventory: [], flags: {}, clues: [], threads: [],
    location: '老码头', npcsAlive: [],
    combat: { active: false, round: 0, foes: [] },
  },
  worldbook: [],
  chronicle: Array.from({ length: 60 }, (_, i) => ({ turn: i + 1, text: '这一轮发生了一些事'.repeat(3) })),
});

describe('超预算裁剪（trimToBudget）', () => {
  it('预算够 → 一个字都不动（正常局不受影响）', () => {
    const sections = ['A'.repeat(100), 'B'.repeat(100), OUTPUT_CONTRACT];
    const out = trimToBudget(sections, 10000);
    expect(out).toBe(sections.join('\n\n---\n\n'));
  });

  it('超预算 → 从尾部往前砍，但**输出契约永远在**', () => {
    const sections = ['开头'.repeat(50), '中间'.repeat(50), '尾巴'.repeat(50), OUTPUT_CONTRACT];
    const out = trimToBudget(sections, 300);
    expect(out).toContain('开头');
    expect(out).toContain(OUTPUT_CONTRACT);
    expect(out).not.toContain('尾巴');
  });

  it('预算小到极限时，至少留下开头与契约，不返回空串', () => {
    const sections = ['开头', '中间', '尾巴', OUTPUT_CONTRACT];
    const out = trimToBudget(sections, 1);
    expect(out.length).toBeGreaterThan(0);
    expect(out).toContain(OUTPUT_CONTRACT);
  });

  it('空数组给空串，不炸', () => {
    expect(trimToBudget([])).toBe('');
  });

  it('真实提示词：正常局不触发裁剪（预算只是保险丝）', () => {
    const p = buildSystemPrompt(ctx());
    expect(p.length).toBeLessThan(PROMPT_BUDGET_CHARS);
    expect(p).toContain('雾港');
  });

  it('🔥 长局超限时：模组真相还在，编年史先没', () => {
    const long = {
      ...ctx(),
      // 编年史拉到离谱的长度，逼出裁剪
      chronicle: Array.from({ length: 60 }, (_, i) => ({
        turn: i + 1,
        text: `第 ${i + 1} 轮：${'他们在底舱里翻找货物的记录'.repeat(40)}`,
      })),
    };
    const p = buildSystemPrompt(long);

    // ① 模组真相必须活着
    expect(p).toContain('船主其实早就死了');
    // ② 编年史被砍掉了（它是最先让位的那一批）
    expect(p).not.toContain('## 事件日志');
    // ③ 契约永远在
    expect(p).toContain(OUTPUT_CONTRACT);
    // ④ 而且真的压回预算内了
    expect(p.length).toBeLessThanOrEqual(PROMPT_BUDGET_CHARS);
  });

  it('🔥 模组段本身撑满预算：模组与真相仍不许砍（宁可超预算）', () => {
    const huge = {
      ...ctx(),
      module: {
        ...ctx().module,
        // 真相长到单独就超过整个预算 → 裁剪循环会一路砍到下标 1
        truth: `船主其实早就死了。${'他在底舱留了一本账，记着每一笔不该记的货。'.repeat(3000)}`,
      },
    };
    const p = buildSystemPrompt(huge);

    // 模组段被 `isProtectedSection` 护住 —— 砍到它时跳过，不砍
    expect(p).toContain('# 模组：雾港');
    expect(p).toContain('## 真相');
    expect(p).toContain('船主其实早就死了');
    // 契约同样在
    expect(p).toContain(OUTPUT_CONTRACT);
    // 且**承认会超预算** —— 这是有意的取舍：丢真相（模型瞎编）比多花钱糟得多
    expect(p.length).toBeGreaterThan(PROMPT_BUDGET_CHARS);
  });
});
