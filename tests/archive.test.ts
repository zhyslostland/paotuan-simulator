import { describe, expect, it } from 'vitest';
import type { CharacterProfile } from '../src/ui/store.js';
import {
  ARCHIVE_LIMIT,
  archiveBlurb,
  characterKey,
  findCharacter,
  listArchive,
  matchesRuleset,
  pruneArchive,
  removeCharacter,
  upsertCharacter,
  type ArchivedCharacter,
} from '../src/ui/archive.js';

/*
 * ============================================================
 * 角色档案库（Phase 2）的判据
 *
 * 三条要钉住的：
 *   ① **同一个名字＝同一张卡**（再存是更新，不是新开一张）；
 *   ② **存的是快照**：之后改当前角色卡，不许改到档案库里那张；
 *   ③ 超上限丢**最久没动过**的，不是丢最旧的。
 * ============================================================
 */

const profile = (name: string, over: Partial<CharacterProfile> = {}): CharacterProfile => ({
  name,
  description: '码头工头，左手有旧疤。',
  personality: '话少',
  mes_example: '',
  characteristics: { str: 60, con: 55 },
  skills: { 侦查: 45 },
  items: ['撬棍'],
  ...over,
});

const T1 = '2026-09-17T10:00:00.000Z';
const T2 = '2026-09-17T11:00:00.000Z';
const T3 = '2026-09-17T12:00:00.000Z';

describe('名字就是钥匙', () => {
  it('首尾空白、连续空白、大小写都不算区别', () => {
    expect(characterKey('  霍尔特 ')).toBe('霍尔特');
    expect(characterKey('A  B')).toBe('a b');
    expect(characterKey('Holt')).toBe(characterKey('holt'));
  });
});

describe('存一张卡', () => {
  it('第一次存：id 由名字来，创建与更新同一时刻', () => {
    const { entry, replaced } = upsertCharacter([], profile('霍尔特'), { now: T1 });
    expect(entry.id).toBe('霍尔特');
    expect(entry.name).toBe('霍尔特');
    expect(entry.createdAt).toBe(T1);
    expect(entry.savedAt).toBe(T1);
    expect(entry.rulesetId).toBeUndefined();
    expect(replaced).toBe(false);
  });

  it('名字全空也给个占位名（不产生一张没有名字的卡）', () => {
    const { entry } = upsertCharacter([], profile('   '), { now: T1 });
    expect(entry.name).toBe('无名的调查员');
  });

  it('存的是**快照**：之后改当前角色卡，不会改到档案库里那张', () => {
    const live = profile('霍尔特');
    const { list } = upsertCharacter([], live, { now: T1 });
    // 准备页继续改这张活卡
    live.characteristics.str = 99;
    live.skills.侦查 = 80;
    live.items?.push('手电');
    const saved = findCharacter(list, '霍尔特')!;
    expect(saved.profile.characteristics.str).toBe(60);
    expect(saved.profile.skills.侦查).toBe(45);
    expect(saved.profile.items).toEqual(['撬棍']);
  });

  it('反过来也成立：改档案库里那份，不影响传进来的原对象', () => {
    const live = profile('霍尔特');
    const { list } = upsertCharacter([], live, { now: T1 });
    list[0]!.profile.characteristics.str = 5;
    expect(live.characteristics.str).toBe(60);
  });

  it('同名再存＝更新：id 不变、创建时间保留、数量不涨', () => {
    const first = upsertCharacter([], profile('霍尔特'), { now: T1 });
    const second = upsertCharacter(first.list, profile('霍尔特', { personality: '改过了' }), {
      now: T2,
      rulesetId: 'coc7',
    });
    expect(second.list.length).toBe(1);
    expect(second.replaced).toBe(true);
    expect(second.entry.createdAt).toBe(T1);
    expect(second.entry.savedAt).toBe(T2);
    expect(second.entry.rulesetId).toBe('coc7');
    expect(second.entry.profile.personality).toBe('改过了');
  });

  it('大小写/空白不同的同名也认作同一张（否则改一个字就多出一张重名卡）', () => {
    const first = upsertCharacter([], profile('Holt'), { now: T1 });
    const second = upsertCharacter(first.list, profile(' holt  '), { now: T2 });
    expect(second.list.length).toBe(1);
    expect(second.replaced).toBe(true);
  });

  it('不同的名字＝并排两张，刚存的在最前', () => {
    const a = upsertCharacter([], profile('霍尔特'), { now: T1 });
    const b = upsertCharacter(a.list, profile('艾琳'), { now: T2 });
    expect(b.list.map((c) => c.name)).toEqual(['艾琳', '霍尔特']);
  });
});

describe('裁剪：丢最久没动过的', () => {
  const card = (name: string, savedAt: string): ArchivedCharacter => ({
    id: characterKey(name),
    name,
    createdAt: savedAt,
    savedAt,
    profile: profile(name),
  });

  it('没超上限就原样返回', () => {
    const list = [card('甲', T1), card('乙', T2)];
    expect(pruneArchive(list, 5).length).toBe(2);
  });

  it('超上限时留下最近动过的（常用的那张不该被挤掉）', () => {
    const list = [card('老卡', T1), card('常用', T3), card('中间', T2)];
    const out = pruneArchive(list, 2).map((c) => c.name);
    expect(out).toEqual(['常用', '中间']);
  });

  it('存进第 25 张时自动掉一张（不会无限长）', () => {
    let list: ArchivedCharacter[] = [];
    for (let i = 0; i < ARCHIVE_LIMIT + 1; i++) {
      const at = `2026-09-${(i + 1).toString().padStart(2, '0')}T00:00:00.000Z`;
      list = upsertCharacter(list, profile(`调查员${i}`), { now: at }).list;
    }
    expect(list.length).toBe(ARCHIVE_LIMIT);
    // 最早那张（调查员0）被丢了，最新那张还在
    expect(findCharacter(list, '调查员0')).toBeUndefined();
    expect(findCharacter(list, `调查员${ARCHIVE_LIMIT}`)).toBeDefined();
  });
});

describe('取用、删除与排序', () => {
  it('按 id 取卡，认不出来返回 undefined（调用方据此不换卡）', () => {
    const { list } = upsertCharacter([], profile('霍尔特'), { now: T1 });
    expect(findCharacter(list, '霍尔特')?.name).toBe('霍尔特');
    expect(findCharacter(list, '没这个人')).toBeUndefined();
  });

  it('删掉一张（不碰其他卡）', () => {
    const a = upsertCharacter([], profile('霍尔特'), { now: T1 });
    const b = upsertCharacter(a.list, profile('艾琳'), { now: T2 });
    const left = removeCharacter(b.list, '霍尔特');
    expect(left.map((c) => c.name)).toEqual(['艾琳']);
  });

  it('列表按最近动过的排在前', () => {
    const list = [
      { id: 'a', name: '甲', createdAt: T1, savedAt: T1, profile: profile('甲') },
      { id: 'b', name: '乙', createdAt: T3, savedAt: T3, profile: profile('乙') },
    ];
    expect(listArchive(list).map((c) => c.name)).toEqual(['乙', '甲']);
  });
});

describe('卡片上那句话与规则包提示', () => {
  it('取描述开头，太长就截断', () => {
    const entry: ArchivedCharacter = {
      id: 'x',
      name: 'x',
      createdAt: T1,
      savedAt: T1,
      profile: profile('x', { description: '一二三四五六七八九十' }),
    };
    expect(archiveBlurb(entry, 4)).toBe('一二三四…');
  });

  it('没有描述时给一句人话，不显示空白', () => {
    const entry: ArchivedCharacter = {
      id: 'x',
      name: 'x',
      createdAt: T1,
      savedAt: T1,
      profile: profile('x', { description: '  ' }),
    };
    expect(archiveBlurb(entry)).toContain('没有写描述');
  });

  it('规则包对不上时给提示条件，但**不阻止**用（那是玩家的卡）', () => {
    const coc: ArchivedCharacter = {
      id: 'x',
      name: 'x',
      createdAt: T1,
      savedAt: T1,
      rulesetId: 'coc7',
      profile: profile('x'),
    };
    expect(matchesRuleset(coc, 'coc7')).toBe(true);
    expect(matchesRuleset(coc, 'dnd5e')).toBe(false);
    // 老卡没记规则包 → 一律当作能对得上（不冤枉它）
    expect(matchesRuleset({ ...coc, rulesetId: undefined }, 'dnd5e')).toBe(true);
  });
});
