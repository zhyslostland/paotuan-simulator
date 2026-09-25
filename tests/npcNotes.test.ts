import { describe, expect, it } from 'vitest';
import {
  NPC_NOTES_LIMIT,
  lastContact,
  npcNameKey,
  presentNpcNames,
  pruneNpcNotes,
  sameNpcName,
  touchNpcNotes,
} from '../src/core/npcNotes.js';
import type { NpcNote } from '../src/core/state/gameState.js';

/** 造 n 条档案，`seen` 按下标递增（下标越小 = 越久没接触） */
function notes(n: number): Record<string, NpcNote> {
  const out: Record<string, NpcNote> = {};
  for (let i = 0; i < n; i++) out[`人物${i}`] = { role: `身份${i}`, seen: i };
  return out;
}

describe('名字匹配（卡片与淘汰共用同一套，不许两份）', () => {
  it('剥掉前后缀后认作同一个人', () => {
    expect(npcNameKey('老霍华德')).toBe('霍华德');
    expect(npcNameKey('霍华德先生')).toBe('霍华德');
    expect(sameNpcName('老霍华德', '霍华德先生')).toBe(true);
  });

  it('核心太短时不比包含，避免张冠李戴', () => {
    expect(sameNpcName('王', '汪三')).toBe(false);
  });
});

describe('lastContact —— 谁最久没接触', () => {
  it('有 seen 就用 seen，没有就退回 met', () => {
    expect(lastContact({ met: 3, seen: 9 })).toBe(9);
    expect(lastContact({ met: 3 })).toBe(3);
  });

  it('两个都没有 = 最久（先淘汰）', () => {
    expect(lastContact({ role: '路人' })).toBe(Number.NEGATIVE_INFINITY);
    expect(lastContact(undefined)).toBe(Number.NEGATIVE_INFINITY);
  });
});

describe('touchNpcNotes —— 给在场的人打时间戳', () => {
  it('在场的更新 seen，不在场的不动', () => {
    const src: Record<string, NpcNote> = {
      霍华德: { role: '工头', seen: 1 },
      离场的人: { role: '船东', seen: 2 },
    };
    const out = touchNpcNotes(src, ['老霍华德'], 10);
    expect(out['霍华德']?.seen).toBe(10);
    expect(out['离场的人']?.seen).toBe(2);
  });

  it('没有变化就返回原引用（免得每轮无谓重渲染）', () => {
    const src: Record<string, NpcNote> = { 霍华德: { role: '工头', seen: 10 } };
    expect(touchNpcNotes(src, ['霍华德'], 10)).toBe(src);
  });
});

describe('pruneNpcNotes —— 上限淘汰（用户 09-17 拍板）', () => {
  it('没超限就一个都不动', () => {
    const src = notes(NPC_NOTES_LIMIT);
    const out = pruneNpcNotes(src, []);
    expect(out.dropped).toEqual([]);
    expect(out.notes).toBe(src);
  });

  it('超限淘汰最久未接触的那条', () => {
    const src = notes(NPC_NOTES_LIMIT + 1);
    const out = pruneNpcNotes(src, []);
    expect(out.dropped).toEqual(['人物0']);
    expect(Object.keys(out.notes)).toHaveLength(NPC_NOTES_LIMIT);
    expect(out.notes['人物0']).toBeUndefined();
  });

  it('🔥 在场者永不淘汰：全员在场时宁可超限也不删', () => {
    const src = notes(NPC_NOTES_LIMIT + 5);
    const out = pruneNpcNotes(src, Object.keys(src));
    expect(out.dropped).toEqual([]);
    expect(Object.keys(out.notes)).toHaveLength(NPC_NOTES_LIMIT + 5);
  });

  it('只淘汰离场的，把在场的留下来', () => {
    const src = notes(NPC_NOTES_LIMIT + 3);
    // 最久的三条（人物0/1/2）都在场 → 只能从离场的里挑最久的
    const present = ['人物0', '人物1', '人物2'];
    const out = pruneNpcNotes(src, present);
    expect(out.dropped).toEqual(['人物3', '人物4', '人物5']);
    for (const p of present) expect(out.notes[p]).toBeDefined();
    expect(Object.keys(out.notes)).toHaveLength(NPC_NOTES_LIMIT);
  });

  it('在场判定认宽松写法（"老霍华德"在场上，档案键是"霍华德先生"）', () => {
    const src: Record<string, NpcNote> = {};
    src['霍华德先生'] = { role: '工头', seen: 1 };
    for (let i = 0; i < NPC_NOTES_LIMIT; i++) src[`别人${i}`] = { role: 'x', seen: 100 + i };
    const out = pruneNpcNotes(src, ['老霍华德']);
    expect(out.dropped).not.toContain('霍华德先生');
    expect(out.notes['霍华德先生']).toBeDefined();
  });

  it('同一个输入两次算出来的顺序一致（界面上不会乱跳）', () => {
    const a = pruneNpcNotes(notes(NPC_NOTES_LIMIT + 4), ['人物0']);
    const b = pruneNpcNotes(notes(NPC_NOTES_LIMIT + 4), ['人物0']);
    expect(Object.keys(a.notes)).toEqual(Object.keys(b.notes));
  });
});

describe('presentNpcNames —— 谁算在场', () => {
  it('在场名单 + 在世的同行者', () => {
    const names = presentNpcNames({
      npcsAlive: ['霍华德'],
      companions: [
        { id: 'a', name: '阿雅', alive: true, present: true },
        { id: 'b', name: '死者', alive: false },
        { id: 'c', name: '掉队的', alive: true, present: false },
      ] as never,
    });
    expect(names).toContain('霍华德');
    expect(names).toContain('阿雅');
    expect(names).not.toContain('死者');
    expect(names).not.toContain('掉队的');
  });
});
