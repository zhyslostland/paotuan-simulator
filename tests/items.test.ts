/**
 * 「使用物品」这条路上的两个判据 —— 只准有一份，这里钉住它。
 *
 * 为什么值得单测：主人 2026-09-20 试玩时报「**满血用药白扣一个**」，
 * 协作方落地时又发现更深一层：`CharacterSheet` 是**点下去先扣、再发给守密人**，
 * 而发送那一步在流式期间会被静默丢弃 —— 于是"扣了但没用上"（P1-1）。
 *
 * 主人拍板的判据（原话）：
 * > 物品分两种。**纯消耗品、只能回血**：没掉血就不能用，数量不减（禁用是对的）。
 * > **实物有自由度**：止血绷带功能是止血，归根到底是一卷绷带，能干什么靠玩家想象。
 */
import { describe, expect, it } from 'vitest';
import { isHealOnlyConsumable, itemsMentionedIn } from '../src/core/items.js';

describe('纯回血消耗品 vs 实物（主人 2026-09-20 拍板）', () => {
  it('药类算纯回血：满血禁用、不扣', () => {
    for (const name of ['治疗药水', '急救药剂', '回复药丸', '血瓶', '镇静针剂']) {
      expect(isHealOnlyConsumable({ name, kind: 'consumable' })).toBe(true);
    }
  });

  it('绷带是**实物**，不是纯回血 —— 主人原话点的就是这个例子', () => {
    // 「止血绷带功能是止血，归根到底是一卷绷带」：名字里有"血"但它是东西，不是药
    expect(isHealOnlyConsumable({ name: '止血绷带', desc: '止住一次流血，生命 +1d4。', kind: 'consumable' }))
      .toBe(false);
    for (const name of ['绳子', '灯油', '手电筒', '折叠刀']) {
      expect(isHealOnlyConsumable({ name, kind: 'consumable' })).toBe(false);
    }
  });

  it('只看名字不看说明 —— 说明里写"生命 +1d4"的绷带不能被判成药', () => {
    // 反例钉：如果哪天有人改成扫 desc，这条会红
    expect(
      isHealOnlyConsumable({ name: '医用绷带', desc: '回复生命 1d4，也能包扎伤口。', kind: 'consumable' })
    ).toBe(false);
  });

  it('非消耗品一律不走这条路', () => {
    expect(isHealOnlyConsumable({ name: '治疗药水', kind: 'weapon' })).toBe(false);
    expect(isHealOnlyConsumable({ name: '治疗药水' })).toBe(false);
    expect(isHealOnlyConsumable(undefined)).toBe(false);
    expect(isHealOnlyConsumable(null)).toBe(false);
  });
});

describe('这一句点到了背包里的谁（第 17 版 C：不做动词表）', () => {
  const bag = [
    { name: '止血绷带', kind: 'consumable' },
    { name: '铜制钥匙', kind: 'clue' },
    { name: '手电筒', kind: 'tool' },
  ];

  it('命中全名就报出来 —— 至于扣不扣，交给守密人', () => {
    expect(itemsMentionedIn('我拿出背包里的止血绷带，先止住血', bag)).toEqual(['止血绷带']);
    // 「把绷带铺在地上」也算点了名字（用了这件东西）——引擎不判意图
    expect(itemsMentionedIn('把止血绷带展开铺在地上', bag)).toEqual(['止血绷带']);
  });

  it('只是看一眼也照样报 —— 所以动词表那条路是错的，这里不猜', () => {
    expect(itemsMentionedIn('我看看止血绷带上的字', bag)).toEqual(['止血绷带']);
  });

  it('没点名 / 空文本 → 空名单', () => {
    expect(itemsMentionedIn('我四处张望一下', bag)).toEqual([]);
    expect(itemsMentionedIn('', bag)).toEqual([]);
    expect(itemsMentionedIn('   ', bag)).toEqual([]);
  });

  it('同一个名字只报一次', () => {
    expect(itemsMentionedIn('绷带，还是那卷止血绷带', bag)).toEqual(['止血绷带']);
  });

  it('写在说明里的东西不算（背包里没有"衣服"就不该被编进去）', () => {
    expect(itemsMentionedIn('我撕破衣服给他止血', bag)).toEqual([]);
  });
});
