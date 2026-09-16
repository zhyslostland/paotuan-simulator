import { describe, expect, it } from 'vitest';
import { weighDescription, type WeighContext } from '../src/core/description.js';

const ctx: WeighContext = {
  npcs: ['老霍华德'],
  visited: ['码头'],
  clues: ['灯塔第六夜不亮'],
  items: ['撬棍'],
  features: ['门锁', '通风口'],
};

describe('描述加权（改的是目标值，不是难度档位）', () => {
  it('没有描述 → 不加不减，也不逼玩家写作文', () => {
    expect(weighDescription('', ctx).bonus).toBe(0);
    expect(weighDescription('开门', ctx).bonus).toBe(0);
  });

  it('以可行性为主：写得可行 > 只是写得长', () => {
    const vague = '我开门'; // 短且没说怎么做
    const feasible = '我用撬棍卡进门锁，先慢慢试一下再加力'; // 用工具 + 具体特征 + 步骤 + 谨慎
    expect(weighDescription(feasible, ctx).score).toBeGreaterThan(
      weighDescription(vague, ctx).score
    );
  });

  it('【回归】"我开门"硬凑字数不再拿满分（旧版按长度给分）', () => {
    // 45 字以上、完全没说怎么做，旧逻辑会给 +2；现在不该给高分
    const padded = '我开门我开门我开门我开门我开门我开门我开门我开门我开门我开门我开门我开门我开门我开门我开门';
    const w = weighDescription(padded, ctx);
    expect(w.score).toBeLessThanOrEqual(1);
  });

  it('用到背包里的真实工具 → 加分', () => {
    const w = weighDescription('我用撬棍去别那个锁', ctx);
    expect(w.reasons.join()).toContain('撬棍');
    expect(w.score).toBeGreaterThan(0);
  });

  it('针对环境的具体特征 → 加分', () => {
    const w = weighDescription('我先看看那个通风口能不能钻过去', ctx);
    expect(w.reasons.join()).toContain('通风口');
  });

  it('说清步骤 / 顾及风险 → 各自加分', () => {
    expect(weighDescription('我先摸一摸，然后再推门', ctx).reasons.join()).toContain('步骤');
    expect(weighDescription('我屏住呼吸贴着墙往里挪', ctx).reasons.join()).toContain('风险');
  });

  it('提到场上真实存在的人 / 地 / 线索 → 加分', () => {
    // 只点了地点：应识别为"点到了「码头」"
    const w = weighDescription('我往码头那边走一趟', ctx);
    expect(w.reasons.join()).toContain('码头');
    expect(w.score).toBeGreaterThan(0);
    // 点名人物也一样
    expect(weighDescription('我去找老霍华德聊聊', ctx).reasons.join()).toContain('老霍华德');
  });

  it('题材极性：punish 题材里"用科学原理解题"是减分项', () => {
    const action = '我用物理学原理计算一下这个门的受力角度';
    const punish = weighDescription(action, { ...ctx, rationalityBias: 'punish' });
    const reward = weighDescription(action, { ...ctx, rationalityBias: 'reward' });
    expect(punish.score).toBeLessThan(reward.score);
    expect(punish.reasons.join()).toContain('书本');
  });

  it('题材极性：neutral 不因为"讲理性"加减分', () => {
    const action = '我用物理学原理计算一下受力角度';
    const neutral = weighDescription(action, { ...ctx, rationalityBias: 'neutral' });
    const none = weighDescription(action, ctx); // 不传＝neutral
    expect(neutral.score).toBe(none.score);
  });

  it('百分比规则与加值规则的修正量不同', () => {
    const feat = '我用撬棍卡进门锁，先慢慢试一下再加力';
    expect(weighDescription(feat, ctx, 'percent').bonus).toBe(15);
    expect(weighDescription(feat, ctx, 'modifier').bonus).toBe(2);
  });

  it('手里没有需要的武器 → 直接扣到负', () => {
    /*
     * 注意这句描述里含"慢慢"，会先拿到 +1 的"顾及了风险"，
     * 再被"手里没有武器"的 −2 压下去 —— 结果是 −1（仍然低于任何正分）。
     * 硬伤要压过零星加分，这才是"硬闸门"的意思。
     */
    const w = weighDescription(
      '我举枪瞄准他，慢慢扣下扳机',
      { ...ctx, requiredWeapon: '射击（手枪）', hasWeapon: false },
      'percent'
    );
    expect(w.score).toBeLessThan(0);
    expect(w.bonus).toBeLessThan(0);
    expect(w.reasons.join()).toContain('手里没有');
  });

  it('手里没有武器且没有别的加分 → 直接 −2', () => {
    const w = weighDescription(
      '我掏枪对着他就打过去',
      { ...ctx, requiredWeapon: '射击（手枪）', hasWeapon: false },
      'percent'
    );
    expect(w.score).toBe(-2);
    expect(w.bonus).toBe(-15);
  });

  it('有武器时不因为"提到枪"被扣分', () => {
    const w = weighDescription(
      '我举枪瞄准他，慢慢扣下扳机',
      { ...ctx, requiredWeapon: '射击（手枪）', hasWeapon: true },
      'percent'
    );
    expect(w.bonus).toBeGreaterThanOrEqual(0);
  });

  it('总分封顶 ±2', () => {
    const loaded =
      '我用撬棍卡进门锁，针对通风口，先试探再慢慢加力，同时叫上老霍华德在码头留意灯塔的事，凭物理学原理计算角度';
    const w = weighDescription(loaded, { ...ctx, rationalityBias: 'reward' });
    expect(w.score).toBe(2);
    expect(w.bonus).toBe(15);
  });
});

describe('版本号比较（更新检测用的判据）', () => {
  it('语义化版本能正确比大小', async () => {
    const { compareVersions } = await import('../src/version.js');
    expect(compareVersions('0.1.1', '0.1.0')).toBeGreaterThan(0);
    expect(compareVersions('0.2.0', '0.1.9')).toBeGreaterThan(0);
    expect(compareVersions('1.0.0', '0.99.99')).toBeGreaterThan(0);
    expect(compareVersions('0.1.0', '0.1.0')).toBe(0);
    expect(compareVersions('v0.1.0', '0.1.0')).toBe(0);
    expect(compareVersions('0.0.9', '0.1.0')).toBeLessThan(0);
  });

  it('【P0-1 回归】版本没变但构建号更新 → 仍要提示更新', async () => {
    /*
     * 这是协作方抓到的口径漏洞：如果只比语义化版本，
     * 那么"发布时忘了改 APP_VERSION"的那一次就永远不会被提示，
     * "我改了你还是旧的"会原样复发。构建号必须能兜底。
     */
    const { isNewer } = await import('../src/version.js');
    expect(isNewer({ version: '0.1.0', id: 'zzzzzzzz' }, '0.1.0', 'aaaaaaaa')).toBe('newer');
    // 版本相同、构建号也相同 → 就是同一份，不该提示
    expect(isNewer({ version: '0.1.0', id: 'aaaaaaaa' }, '0.1.0', 'aaaaaaaa')).toBe('latest');
  });

  it('版本变大 / 变小 的方向要判对（回滚不该打扰玩家）', async () => {
    const { isNewer } = await import('../src/version.js');
    expect(isNewer({ version: '0.2.0', id: 'aaaaaaaa' }, '0.1.0', 'bbbbbbbb')).toBe('newer');
    // 线上版本更旧（回滚）→ 即使构建号看起来更大也不提示
    expect(isNewer({ version: '0.0.9', id: 'zzzzzzzz' }, '0.1.0', 'aaaaaaaa')).toBe('latest');
  });

  it('老部署只有构建号也能判断；开发环境判断不了就回 unknown', async () => {
    const { isNewer } = await import('../src/version.js');
    expect(isNewer({ id: 'zzzzzzzz' }, '0.1.0', 'aaaaaaaa')).toBe('newer');
    expect(isNewer({ id: 'aaaaaaaa' }, '0.1.0', 'aaaaaaaa')).toBe('latest');
    // dev 没有真实构建号，又没给 version → 不误报
    expect(isNewer({ id: 'zzzzzzzz' }, '0.1.0', 'dev')).toBe('unknown');
  });
});
