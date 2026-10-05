/**
 * 形象体系（1-F）：**谁该被画**的判据断言。
 *
 * 这一组守的是**四件容易飘的事**：
 *   ① 四条自动线各自的准入判据（玩家 / 同行者 / 关键人物 / 怪物）；
 *   ② **关键判据**：路人（名字不在 `module.npcs` 里）**不出专属图** ——
 *      主人原话：「路人不生成啊」。松了这一条，`npcsAlive` 里冒出的
 *      "码头工人甲"会各占一张图，既没上限也没价值；
 *   ③ 12 张的防呆闸（`AUTO_ART_CAP`）—— 松了就是几十次真实计费；
 *   ④ 上限判据数的是**已经落地的图**，不是队列里的任务（任务会失败/取消，会漂）。
 *
 * 全是纯函数，import 即可测（不碰 store、不碰网络）。
 */

import { describe, expect, it } from 'vitest';
import {
  AUTO_ART_CAP,
  artCandidates,
  autoArtCount,
  createInitialState,
  type Companion,
} from '../src/core/state/gameState.js';

function mate(over: Partial<Companion> = {}): Companion {
  return {
    id: 'c1',
    name: '米拉',
    role: '记者',
    personality: '爱追问',
    skills: {},
    vitals: { hp: 10 },
    initiative: 'balanced',
    alive: true,
    present: true,
    ...over,
  };
}

const EMPTY = createInitialState({ location: '老码头' });

describe('1-F · artCandidates：四条自动线', () => {
  it('玩家没立绘时排第一条，有立绘就一条都不排', () => {
    const out = artCandidates(EMPTY, [], '霍华德', { hasPlayerArt: false });
    expect(out).toEqual([
      { kind: 'portrait', target: 'character', name: '霍华德', label: '你自己的立绘' },
    ]);
    expect(artCandidates(EMPTY, [], '霍华德', { hasPlayerArt: true })).toEqual([]);
  });

  it('同行者：活人且没图的排；有图的、死了的都不排', () => {
    const st = createInitialState({
      location: '老码头',
      companions: [
        mate({ id: 'a', name: '有图的', portrait: 'data:image/png;base64,X' }),
        mate({ id: 'b', name: '要画的' }),
        mate({ id: 'c', name: '死了的', alive: false }),
      ],
    });
    const out = artCandidates(st, [], '霍华德', { hasPlayerArt: true });
    expect(out.map((c) => c.target)).toEqual(['b']);
  });

  it('🔴 路人不出图：名字不在模组人物表里的人一个都不画', () => {
    /*
     * 这是 1-F 的**核心判据**。`module.npcs` 是唯一一个"作者已经点过名"的信号，
     * 照抄既有信号（`npcProfileOf()` 里已经在查同一份表），不新增字段。
     */
    const st = createInitialState({
      location: '老码头',
      npcsAlive: ['老陈', '码头工人甲', '安德鲁神父'],
    });
    const out = artCandidates(st, ['老陈', '安德鲁神父'], '霍华德', { hasPlayerArt: true });
    expect(out.map((c) => c.target)).toEqual(['npc:老陈', 'npc:安德鲁神父']);
    expect(out.some((c) => c.name === '码头工人甲')).toBe(false);
  });

  it('关键人物走「头像」（方版 `avatar`），不再是竖版立绘（阶段 2 · 计划 2-3）', () => {
    /*
     * 为什么要钉这一条：这类图的用途是**认人**（档案卡里那张小图）。
     * 3:4 的竖版塞进方框会被左右裁 —— 规格错了，容器再对也白搭。
     * 落点**没变**（仍是 `foeArt`，target 带 `npc:` 前缀），变的只有 kind。
     */
    const st = createInitialState({ location: '老码头', npcsAlive: ['老陈'] });
    const out = artCandidates(st, ['老陈'], '霍华德', { hasPlayerArt: true });
    expect(out).toEqual([
      { kind: 'avatar', target: 'npc:老陈', name: '老陈', label: '关键人物「老陈」的头像' },
    ]);
  });

  it('已经画过的人不重复排（人回来了、再进一次战斗都不重画）', () => {
    const st = createInitialState({
      location: '老码头',
      npcsAlive: ['老陈'],
      combat: { active: true, round: 1, foes: [{ name: '雾中的巨影', hp: 5, max: 10 }] },
      foeArt: { 老陈: 'data:image/png;base64,X', 雾中的巨影: 'data:image/png;base64,Y' },
    });
    expect(artCandidates(st, ['老陈'], '霍华德', { hasPlayerArt: true })).toEqual([]);
  });

  it('怪物：只在战斗进行中排（没进战斗轮＝还没照面，一行判据，与图鉴 G5 对齐）', () => {
    const idle = createInitialState({
      location: '老码头',
      combat: { active: false, round: 0, foes: [{ name: '雾中的巨影', hp: 10, max: 10 }] },
    });
    expect(artCandidates(idle, [], '霍华德', { hasPlayerArt: true })).toEqual([]);

    const fighting = createInitialState({
      location: '老码头',
      combat: { active: true, round: 1, foes: [{ name: '雾中的巨影', hp: 10, max: 10 }] },
    });
    const out = artCandidates(fighting, [], '霍华德', { hasPlayerArt: true });
    expect(out).toEqual([
      { kind: 'monster', target: '雾中的巨影', name: '雾中的巨影', label: '怪物「雾中的巨影」的形象' },
    ]);
  });
});

describe('1-F · autoArtCount：数已经落地的图，不数队列', () => {
  it('玩家立绘 / 队友立绘 / foeArt 三处都算进去', () => {
    const st = createInitialState({
      location: '老码头',
      companions: [mate({ portrait: 'x' }), mate({ id: 'b', name: '没图的' })],
      foeArt: { 甲: 'x', 乙: 'x' },
    });
    // 2 个 foeArt + 1 个队友 + 玩家 1 = 4
    expect(autoArtCount(st, true)).toBe(4);
    // 玩家没立绘 → 3
    expect(autoArtCount(st, false)).toBe(3);
  });

  it('空值不算数（`setFoeArt` 传空串是删，但旧档里可能有脏数据）', () => {
    const st = createInitialState({ location: '老码头', foeArt: { 甲: '', 乙: 'x' } });
    expect(autoArtCount(st, false)).toBe(1);
  });

  it('防呆闸是 12 —— 一局自动排的图不会失控', () => {
    expect(AUTO_ART_CAP).toBe(12);
  });
});
