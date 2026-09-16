import { describe, expect, it } from 'vitest';
import { npcProfileOf, npcStatusText } from '../src/ui/NpcCard';
import type { GameState } from '../src/core/state/gameState.js';
import type { Module } from '../src/ui/store.js';

const gs = (over: Partial<GameState> = {}): GameState =>
  ({
    vitals: { hp: 10 },
    companions: [],
    inventory: [],
    flags: {},
    clues: [],
    location: '码头',
    npcsAlive: ['老霍华德'],
    ...over,
  }) as GameState;

const mod = (npcs: Module['npcs'] = []): Module =>
  ({ title: '测试', premise: '', opening: '', truth: '', npcs, locations: '', clueChain: '', acts: '', endings: '', notes: '' }) as Module;

describe('在地人物卡片（三处查表）', () => {
  it('档案里有身份和观察时都显示出来', () => {
    const p = npcProfileOf(
      '老霍华德',
      gs({
        npcNotes: {
          老霍华德: { role: '码头工头', note: '右手指节全是老茧', met: 3 },
        },
      }),
      mod()
    );
    expect(p.role).toBe('码头工头');
    expect(p.note).toContain('老茧');
    expect(p.met).toBe(3);
    expect(p.present).toBe(true);
  });

  it('档案没有时退回模组预设的身份（但动机与秘密一律不给）', () => {
    const p = npcProfileOf(
      '老霍华德',
      gs(),
      mod([
        { id: 'n1', name: '老霍华德', role: '工头', motive: '想独吞打捞款', secret: '是他放的火' },
      ])
    );
    expect(p.role).toBe('工头');
    expect(p.inModule).toBe(true);
    // 卡片上不该出现这两样
    expect(JSON.stringify(p)).not.toContain('打捞款');
    expect(JSON.stringify(p)).not.toContain('放的火');
  });

  it('临时登场的 NPC 也能出卡片（只是内容为空，不报错）', () => {
    const p = npcProfileOf('雾中的巨影', gs({ npcsAlive: ['雾中的巨影'] }), mod());
    expect(p.name).toBe('雾中的巨影');
    expect(p.role).toBeUndefined();
    expect(p.inModule).toBe(false);
    expect(p.present).toBe(true);
  });

  it('档案以档案优先于模组预设', () => {
    const p = npcProfileOf(
      '老霍华德',
      gs({ npcNotes: { 老霍华德: { role: '其实是打捞船主' } } }),
      mod([{ id: 'n1', name: '老霍华德', role: '工头', motive: '', secret: '' }])
    );
    expect(p.role).toBe('其实是打捞船主');
  });

  it('名字差一个称呼也能对上（模型写字不总一致）', () => {
    const p = npcProfileOf(
      '霍华德先生',
      gs({ npcNotes: { 老霍华德: { role: '码头工头' } } }),
      mod()
    );
    expect(p.role).toBe('码头工头');
  });

  it('同行者要标出来，离场的人点了也不崩', () => {
    const p = npcProfileOf(
      '米拉',
      gs({
        npcsAlive: [],
        companions: [
          {
            id: 'mira',
            name: '米拉',
            role: '记者',
            personality: '',
            skills: {},
            vitals: { hp: 10 },
            initiative: 'reactive',
            alive: true,
            present: true,
          },
        ],
      }),
      mod()
    );
    expect(p.companion).toBe(true);
    expect(p.present).toBe(false);
    expect(npcStatusText(p)).toBe('同行者');
  });
});
