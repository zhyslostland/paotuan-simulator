/**
 * 世界书条目的来源判据 —— 换模组时谁该撤、谁该留。
 *
 * 为什么值得单测：主人 2026-09-20 试玩时报「**上个模组的地点没删**」。
 * 根因不是"忘了清"，而是**清了又加回来** —— `applyModule` 撤 `mw-`，
 * `Preparation` 却只按 `!fromModule` 过滤，把那批 `mw-` 当成"玩家手写"装了回去。
 * 两处各写一份判据、口径还不一样。现在判据只有一份，这里钉住它。
 */
import { describe, expect, it } from 'vitest';
import {
  MODULE_WB_PREFIX,
  SAMPLE_WB_PREFIX,
  isManualWorldbookEntry,
  stripModuleWorldbook,
  selectWorldbook,
  worldbookByDepth,
  worldbookGroups,
} from '../src/core/worldbook.js';
import type { WorldbookEntry } from '../src/core/types.js';

function entry(over: Partial<WorldbookEntry> = {}): WorldbookEntry {
  return {
    id: 'wb-1',
    keys: ['老宅'],
    content: '一栋空了很久的房子',
    priority: 50,
    enabled: true,
    ...over,
  };
}

describe('换模组时世界书该撤谁', () => {
  it('AI 生成的模组包（fromModule）要撤 —— 它属于上一个模组', () => {
    expect(stripModuleWorldbook([entry({ fromModule: true })])).toHaveLength(0);
  });

  it('模组自带的（mw- 前缀）要撤 —— 主人报的"上个模组的地点"就是这一类', () => {
    expect(
      stripModuleWorldbook([entry({ id: `${MODULE_WB_PREFIX}0-老宅` }), entry({ id: 'mw-3-码头' })])
    ).toHaveLength(0);
  });

  it('内置示例（sample-）也要撤 —— 它属于开局那个示例世界，不是玩家写的', () => {
    expect(stripModuleWorldbook([entry({ id: `${SAMPLE_WB_PREFIX}town` })])).toHaveLength(0);
  });

  it('玩家自己手加的不动 —— "开新团不清世界书"保的就是它', () => {
    const mine = entry({ id: 'wb-9', content: '我写的备注' });
    expect(stripModuleWorldbook([mine])).toEqual([mine]);
  });

  it('混在一起时只留玩家手写的', () => {
    const list = [
      entry({ id: 'wb-1', fromModule: true }),
      entry({ id: 'mw-0-地点' }),
      entry({ id: 'sample-town' }),
      entry({ id: 'wb-2' }),
    ];
    expect(stripModuleWorldbook(list).map((e) => e.id)).toEqual(['wb-2']);
  });

  it('isManualWorldbookEntry 与 stripModuleWorldbook 是同一套判据（两处调用点必须一致）', () => {
    const list = [entry({ fromModule: true }), entry({ id: 'mw-1' }), entry({ id: 'wb-1' })];
    expect(stripModuleWorldbook(list)).toEqual(list.filter(isManualWorldbookEntry));
  });
});

/*
 * 1.0 阶段 A：**注入的时机与位置由玩家说了算**。
 *
 * 以前只有「关键词命中 + 优先级 + 上限 8 条」一种玩法，最反直觉的一处是：
 * 玩家写了「这个世界的魔法规则」，却只能等正文里出现"魔法"两个字才生效 ——
 * **世界的底层设定居然是"提起来才在"**。
 */
describe('阶段 A：常驻（constant）', () => {
  it('🔴 常驻条目**不看关键词**，每轮都在', () => {
    const list = [entry({ id: 'a', constant: true, keys: ['魔法'] })];
    const got = selectWorldbook(list, ['今天天气不错']);
    expect(got.map((e) => e.id)).toEqual(['a']);
  });

  it('没勾常驻的条目，仍然只在命中关键词时才注入（老行为不能丢）', () => {
    const list = [entry({ id: 'a', keys: ['老宅'] })];
    expect(selectWorldbook(list, ['去了趟镇上'])).toEqual([]);
    expect(selectWorldbook(list, ['老宅的门开了']).map((e) => e.id)).toEqual(['a']);
  });

  it('同优先级时**常驻优先**（世界的底层设定不该被临时条目挤掉）', () => {
    const list = [
      entry({ id: 'temp', keys: ['老宅'], priority: 50 }),
      entry({ id: 'base', constant: true, priority: 50 }),
    ];
    const got = selectWorldbook(list, ['老宅'], 1);
    expect(got.map((e) => e.id)).toEqual(['base']);
  });
});

describe('阶段 A：预算（budget）', () => {
  it('🔴 总预算用尽时，先裁优先级低的', () => {
    const list = [
      entry({ id: 'low', priority: 10, constant: true, content: 'x'.repeat(100) }),
      entry({ id: 'high', priority: 90, constant: true, content: 'y'.repeat(100) }),
    ];
    const got = selectWorldbook(list, [], 8, 120);
    expect(got.map((e) => e.id)).toEqual(['high']);
  });

  it('条目自己的 budget 会按字数上限计（不是按整条实际长度）', () => {
    const list = [entry({ id: 'a', constant: true, content: 'z'.repeat(500), budget: 50 })];
    // 总预算 80：条目自己限到 50，能进
    expect(selectWorldbook(list, [], 8, 80).map((e) => e.id)).toEqual(['a']);
    // 总预算 40：即使限到 50 还是超 → 不进
    expect(selectWorldbook(list, [], 8, 40)).toEqual([]);
  });

  it('预算为 0 = 不限制（老行为）', () => {
    const list = [entry({ id: 'a', constant: true, content: 'w'.repeat(9999) })];
    expect(selectWorldbook(list, [], 8, 0).map((e) => e.id)).toEqual(['a']);
  });

  it('limit 仍然是**条数**上限（与字数预算是两回事）', () => {
    const list = [
      entry({ id: 'a', constant: true }),
      entry({ id: 'b', constant: true }),
      entry({ id: 'c', constant: true }),
    ];
    expect(selectWorldbook(list, [], 2)).toHaveLength(2);
  });
});

describe('阶段 A：插入深度与分组', () => {
  it('按 depth 分层，0 在最前（贴 system）', () => {
    const list = [
      entry({ id: 'far', depth: 2, constant: true }),
      entry({ id: 'near', depth: 0, constant: true }),
      entry({ id: 'mid', depth: 1, constant: true }),
    ];
    const layers = worldbookByDepth(selectWorldbook(list, [], 8));
    expect(layers.map((l) => l[0]!.id)).toEqual(['near', 'mid', 'far']);
  });

  it('没写 depth 的按 0 算（老数据不掉队）', () => {
    expect(worldbookByDepth([entry({ id: 'a' })])[0]![0]!.id).toBe('a');
  });

  it('分组名能列出来，空的不算', () => {
    const list = [
      entry({ id: 'a', group: '这个模组' }),
      entry({ id: 'b', group: '主角的过去' }),
      entry({ id: 'c', group: '   ' }),
      entry({ id: 'd' }),
    ];
    expect(worldbookGroups(list).sort()).toEqual(['主角的过去', '这个模组']);
  });
});
