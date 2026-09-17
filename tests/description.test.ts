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

describe('【协作方第 6 版 §2.1】判据收紧：只要结构性证据，不要裸词', () => {
  it('【回归】"我走过去，然后看看"不再因"然后"拿分', () => {
    // 旧逻辑里 `然后` 是独立分支 → 这句白拿 +1。现在两支都必须成对出现。
    const w = weighDescription('我走过去，然后看看', ctx);
    expect(w.score).toBe(0);
    expect(w.reasons.join()).not.toContain('步骤');
  });

  it('顺序：成对结构才算，悬置词不算', () => {
    // 真的分步 → 认
    expect(weighDescription('我先看清门缝，再用力', ctx).reasons.join()).toContain('步骤');
    expect(weighDescription('我撬开锁，接着推门', ctx).reasons.join()).toContain('步骤');
    // "回头再说"式 → 不认
    expect(weighDescription('之后再说', ctx).reasons.join()).not.toContain('步骤');
    expect(weighDescription('我看看情况，然后再说', ctx).reasons.join()).not.toContain('步骤');
    expect(weighDescription('之后再看看', ctx).reasons.join()).not.toContain('步骤');
  });

  it('【回归】工具要求动词与物品名**相邻**，不再"同现即得分"', () => {
    // 旧逻辑：句子里有动词 + 物品名同现就 +1（哪怕隔着半句）
    const far = '我打开门，手里拿着枪'; // "打开"与"枪"隔了一句，不是"用枪"
    expect(weighDescription(far, ctx).reasons.join()).not.toContain('撬棍');
    // 真正相邻的用法 → 认
    expect(weighDescription('我用撬棍卡进门缝', ctx).reasons.join()).toContain('撬棍');
  });

  it('工具：动词与物品名隔句读时不算（跨句读不属于同一个动作）', () => {
    // "拿起来" 与 "手枪" 之间隔了逗号与"然后"
    const w1 = weighDescription(
      '我拿起来，然后用手枪指着他',
      { ...ctx, items: ['手枪'] }
    );
    expect(w1.reasons.join()).toContain('手枪'); // "用手枪"本身是相邻的，认它是应该的
    // 但把动词和物品彻底拆到两句里，就不该认
    const w2 = weighDescription(
      '我打开门。那把枪在桌上',
      { ...ctx, items: ['枪'] }
    );
    expect(w2.reasons.join()).not.toContain('用上了「枪」');
  });

  it('风险规避：去掉单字 稳/躲/贴，改双字词', () => {
    // 双字词 → 认（旧逻辑靠单字命中，误伤太广，所以改成这些双字词）
    expect(weighDescription('我稳住呼吸再推门', ctx).reasons.join()).toContain('风险');
    expect(weighDescription('我躲避他的视线往里走', ctx).reasons.join()).toContain('风险');
    expect(weighDescription('我贴着墙慢慢挪过去', ctx).reasons.join()).toContain('风险');
    // 这些单字穿在别的意思里 → 不该算（旧的单字 稳/躲/贴 会误判）
    expect(weighDescription('我把枪贴在他背上', ctx).reasons.join()).not.toContain('风险');
    expect(weighDescription('我躲起来观察一会', ctx).reasons.join()).not.toContain('风险');
  });

  it('【协作方 §3.15 guard】punish 只在"理性是核心"时扣，日常动作不连累', () => {
    const punish = { ...ctx, rationalityBias: 'punish' as const };
    // 纯讲原理 → 扣（这是类型片里最快出事的路）
    expect(weighDescription('我用物理学原理计算受力角度', punish).score).toBe(-1);
    // 讲原理但**同时在动手**（有工具/步骤/风险规避）→ 不扣，日常检定不受连累
    expect(weighDescription('我计算一下角度，用撬棍撬开锁', punish).score).toBeGreaterThanOrEqual(0);
    expect(weighDescription('我先测量门缝宽度，再决定怎么撬', punish).score).toBeGreaterThanOrEqual(0);
    expect(weighDescription('我小心地测量他的脉搏', punish).score).toBeGreaterThanOrEqual(0);
  });

  it('协作方给的验收例子（逐条）', () => {
    expect(weighDescription('我开门', ctx).score).toBe(0);
    // 用撬棍 + 步骤 + 风险规避 = 3 分封顶到 2
    expect(weighDescription('我用撬棍卡进门缝，肩膀顶住慢慢加力', ctx).score).toBe(2);
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

  it('【协作方 §2.4】有 `at` 时比时间戳，不再依赖构建号字符串长度', async () => {
    const { isNewer } = await import('../src/version.js');
    const cur = '2026-09-17T09:00:00.000Z';

    // 线上更新 → newer（与 id 无关）
    expect(
      isNewer({ version: '0.2.3', id: 'aaa', at: '2026-09-17T10:00:00.000Z' }, '0.2.3', 'zzz', cur)
    ).toBe('newer');
    // 线上更旧 → latest
    expect(
      isNewer({ version: '0.2.3', id: 'zzz', at: '2026-09-17T08:00:00.000Z' }, '0.2.3', 'aaa', cur)
    ).toBe('latest');

    /*
     * 关键回归：构建号从 8 位进位到 9 位时，字符串字典序会**判反**
     * （'100000000' < 'zzzzzzzz'，但它其实是更晚的构建）。
     * 时间戳能把它救回来 —— 这正是协作方说"哪年长度进位就失效"的那条。
     */
    expect(
      isNewer({ version: '0.2.3', id: '100000000', at: '2026-09-17T10:00:00.000Z' }, '0.2.3', 'zzzzzzzz', cur)
    ).toBe('newer');
  });

  it('没有 `at` 的老部署退回字符串比较（保持兼容）', async () => {
    const { isNewer } = await import('../src/version.js');
    expect(
      isNewer({ version: '0.2.3', id: 'zzzzzzzz' }, '0.2.3', 'aaaaaaaa', '2026-09-17T09:00:00.000Z')
    ).toBe('newer');
  });

  it('版本号优先于时间戳：线上版本更旧（回滚）时不打扰，哪怕时间戳更新', async () => {
    const { isNewer } = await import('../src/version.js');
    expect(
      isNewer({ version: '0.2.0', id: 'zzz', at: '2030-01-01T00:00:00.000Z' }, '0.2.3', 'aaa', '2026-09-17T09:00:00.000Z')
    ).toBe('latest');
  });
});

describe('更新清理的作用域（协作方 §2.3：别误伤同源下别的东西）', () => {
  it('只清本应用的缓存名，别的一律不动', async () => {
    // 判据住在 purgeScope.ts —— update.ts 带 PWA 虚拟模块，单测 import 不了
    const { isOwnCache } = await import('../src/purgeScope.js');
    // 本应用实际会用到的
    expect(isOwnCache('workbox-precache-v2-http://x/')).toBe(true);
    expect(isOwnCache('workbox-runtime-abc')).toBe(true);
    expect(isOwnCache('html')).toBe(true);
    expect(isOwnCache('paotuan-whatever')).toBe(true);
    // 同域下别人的东西
    expect(isOwnCache('some-other-app-cache')).toBe(false);
    expect(isOwnCache('images')).toBe(false);
    expect(isOwnCache('next-data')).toBe(false);
  });

  it('只注销本应用注册的 SW（按注册文件判，不是按 scope）', async () => {
    const { isOwnRegistration } = await import('../src/purgeScope.js');
    expect(isOwnRegistration('https://x.example/sw.js')).toBe(true);
    expect(isOwnRegistration('https://x.example/sw-v2.js')).toBe(true);
    expect(isOwnRegistration('https://x.example/sub/workbox-abc123.js')).toBe(true);
    // 别人的 SW（scope 可能同样落在根路径，所以不能靠 scope 过滤）
    expect(isOwnRegistration('https://x.example/other-app-sw.js')).toBe(false);
    expect(isOwnRegistration('https://x.example/service-worker.js')).toBe(false);
    // 拿不到 scriptURL 时不许误判
    expect(isOwnRegistration('')).toBe(false);
  });
});
