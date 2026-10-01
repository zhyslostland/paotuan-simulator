/**
 * 幕结构解析与推进（R14）。
 *
 * 这一层最容易出的错不是"解析得不够聪明"，而是**解析不出来时把东西弄丢**：
 * `acts` 一旦返回空数组，调用方就该老老实实退回"把原文塞进提示词"的老行为，
 * 绝不能因为认不出"第几幕"就让守密人少看到一段结构。
 */
import { describe, expect, it } from 'vitest';
import {
  ACT_EXPAND_SPEC,
  actAt,
  isActExpanded,
  normalizeActIndex,
  parseActs,
} from '../src/core/acts.js';

describe('parseActs：两种常见写法都要认', () => {
  it('一行一幕（换行分隔）', () => {
    const acts = parseActs(
      '第一幕 · 接案与试探：委托人有所隐瞒\n第二幕 · 追查：线索指向旧城区\n第三幕 · 暗房：直面真相'
    );
    expect(acts).toHaveLength(3);
    expect(acts[0]!.index).toBe(0);
    expect(acts[0]!.title).toBe('接案与试探');
    expect(acts[0]!.summary).toContain('委托人有所隐瞒');
    expect(acts[2]!.title).toBe('暗房');
  });

  it('挤在一行（分号分隔）', () => {
    const acts = parseActs('第一幕：走访码头与杂货铺；第二幕：进小屋找痕迹；第三幕：甲板脱身');
    expect(acts).toHaveLength(3);
    expect(acts[1]!.index).toBe(1);
    expect(acts[1]!.summary).toContain('进小屋找痕迹');
  });

  it('没有分隔符、只有一连串幕标记 → 也能切开', () => {
    const acts = parseActs('第一幕·登塔 第二幕·真相浮现 第三幕·雾夜');
    expect(acts.map((a) => a.index)).toEqual([0, 1, 2]);
  });

  it('阿拉伯数字写法与"章"也认', () => {
    const acts = parseActs('第1章：开场\n第2章：深入');
    expect(acts.map((a) => a.index)).toEqual([0, 1]);
  });

  it('认不出任何幕标记 → 返回空数组（调用方据此退回老行为）', () => {
    expect(parseActs('一个短篇，没有分幕')).toEqual([]);
    expect(parseActs('')).toEqual([]);
    expect(parseActs(undefined)).toEqual([]);
    expect(parseActs(null)).toEqual([]);
  });

  it('同一幕写了两遍 → 只留信息更多的那条', () => {
    const acts = parseActs('第一幕：短\n第一幕：长一点的交代');
    expect(acts).toHaveLength(1);
    expect(acts[0]!.summary).toBe('长一点的交代');
  });

  it('按幕号排好序（原文顺序乱了也不怕）', () => {
    const acts = parseActs('第三幕：丙\n第一幕：甲\n第二幕：乙');
    expect(acts.map((a) => a.index)).toEqual([0, 1, 2]);
  });

  it('没有冒号时，拿开头当标题，别把标题留空', () => {
    const acts = parseActs('第一幕 走进雾里');
    expect(acts).toHaveLength(1);
    expect(acts[0]!.title.length).toBeGreaterThan(0);
  });
});

describe('actAt / normalizeActIndex / isActExpanded', () => {
  const acts = parseActs('第一幕：甲\n第二幕：乙');

  it('actAt 取得到、越界返回 null', () => {
    expect(actAt(acts, 0)?.summary).toBe('甲');
    expect(actAt(acts, 1)?.summary).toBe('乙');
    expect(actAt(acts, 2)).toBeNull();
    expect(actAt(acts, -1)).toBeNull();
  });

  it('normalizeActIndex：undefined / 负数一律当第一幕', () => {
    expect(normalizeActIndex(undefined)).toBe(0);
    expect(normalizeActIndex(-3)).toBe(0);
    expect(normalizeActIndex(2)).toBe(2);
  });

  it('isActExpanded：空白一律算没展开（免得把空稿当成已展开，白等一场）', () => {
    expect(isActExpanded('导演稿')).toBe(true);
    expect(isActExpanded('   ')).toBe(false);
    expect(isActExpanded('')).toBe(false);
    expect(isActExpanded(undefined)).toBe(false);
  });
});

describe('导演稿要求：三条不许必须写在里面', () => {
  it('写明不许改写已发生的事 / 不许替玩家决定 / 不许写成剧本', () => {
    expect(ACT_EXPAND_SPEC).toContain('不许改写已经发生的事');
    expect(ACT_EXPAND_SPEC).toContain('不许替玩家做决定');
    expect(ACT_EXPAND_SPEC).toContain('不许写成剧本');
  });

  it('明确"只写当前这一幕"', () => {
    expect(ACT_EXPAND_SPEC).toContain('只写**当前这一幕**');
  });
});


/* ============================================================
 * 🔴 `G18`（协28 §F① 第 5 条）：切分顺序是**幕标记 > 换行 > 分号**。
 *
 * 真机：AI 生成的三幕模组，界面上写「第 1 / 2 幕」—— 老写法先按 `；;` 切，
 * 而**分号在幕内部也会出现**（那条模组的第二幕里就有一个），于是第 1 块把"第二幕"整段吞掉，
 * 块内又只认第一个幕标记 → `[第1幕, 第3幕]`，第 2 幕凭空消失（连 R14 的按幕展开也带错）。
 * ============================================================ */
describe('G18：先按幕标记切（幕内分号不再吞掉一幕）', () => {
  const REAL =
    '第一幕（码头与村里探访）：走访码头与村子，得知退潮时间关键性。' +
    '第二幕（灯塔与礁石洞）：在灯塔与礁石洞发现家族秘密线索；待午夜后退潮，探索暴露的礁石洞。' +
    '第三幕（退潮那一夜）：面对真相。';

  it('🔴 一行 + 幕内分号 → 三幕都在（老写法这里只剩第 1、3 幕）', () => {
    const acts = parseActs(REAL);
    expect(acts.map((a) => a.index)).toEqual([0, 1, 2]);
    expect(acts[1]!.summary).toContain('家族秘密线索');
  });

  it('🔴 只有一幕时**不许**按分号切（切了会把摘要后半截丢掉）', () => {
    const acts = parseActs('第一幕：走访码头；问了老板娘几句');
    expect(acts.map((a) => a.index)).toEqual([0]);
    expect(acts[0]!.summary).toContain('问了老板娘几句');
  });

  it('一行一幕的老写法不受影响', () => {
    const acts = parseActs('第一幕 · 接案：委托人有所隐瞒\n第二幕 · 查访：线索指向码头');
    expect(acts.map((a) => a.index)).toEqual([0, 1]);
  });
});

/* ============================================================
 * `G5`：没有独立幕名时 `title` 只是摘要前 10 字 —— 界面两行都渲染就是印两遍。
 * `titled` 就是给界面看的那个开关。
 * ============================================================ */
describe('G5：标题是兜底还是真幕名', () => {
  it('有独立幕名（冒号切得出）→ titled=true', () => {
    const a = parseActs('第一幕 · 接案与试探：委托人有所隐瞒').at(0)!;
    expect(a.titled).toBe(true);
    expect(a.title).toBe('接案与试探');
    expect(a.summary).toBe('委托人有所隐瞒');
  });

  it('没有独立幕名 → titled=false（界面只渲染一行）', () => {
    const a = parseActs('第一幕 委托人有所隐瞒但他没说完').at(0)!;
    expect(a.titled).toBe(false);
    expect(a.title).toBe(a.summary.slice(0, 10));
  });
});
