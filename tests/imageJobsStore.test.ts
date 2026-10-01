/**
 * 生图队列走 store 真实通道的验证（R40）。
 *
 * 纯函数那一份在 `imageJobs.test.ts`；这里证明的是**串起来**之后对：
 * 排进去 → 真的调用生图接口 → 结果落到**正确的位置** → 出队；
 * 失败 → 留在队列里带人话 → 能重试。
 *
 * 真实网络当然要挡掉：把 `generateImage` 换成 mock（它本来就只是个 fetch）。
 * 单独一个文件是因为要 `vi.mock` 掉 provider —— 混进 `store.test.ts` 会污染别处。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ImageJob } from '../src/ui/imageJobs.js';

vi.mock('../src/providers/model.js', () => {
  class ModelError extends Error {
    status?: number;
    constructor(message: string, status?: number) {
      super(message);
      this.status = status;
    }
  }
  return {
    ModelError,
    generateImage: vi.fn(),
    // P2-3：生图接口只给链接时走它。默认"抓不回来"（跨源被 CORS 挡的常态）
    fetchImageAsLocal: vi.fn(async (url: string) => ({ kind: 'remote', value: url })),
    streamChat: vi.fn(),
    chat: vi.fn(),
  };
});



type StoreMod = typeof import('../src/ui/store.js');
let mod: StoreMod;
let store: StoreMod['useStore'];
let createInitialState: typeof import('../src/core/state/gameState.js').createInitialState;
let gen: ReturnType<typeof vi.fn>;
let grab: ReturnType<typeof vi.fn>;
let IMAGE_TIMEOUT_MS: typeof import('../src/ui/store.js').IMAGE_TIMEOUT_MS;

/* 一份**真正的**图数据。以前这里用 'IMG' 这种占位串 —— 新的自包含闸门会把它拒掉，
 * 那是对的：假数据不该混进落盘通道。*/
const IMG = 'data:image/png;base64,IMG';

/** 等队列把活干完（它是异步的，而且跑完一条还会自己续下一条，所以多等几拍） */
const flush = async () => {
  for (let i = 0; i < 6; i++) await new Promise((r) => setTimeout(r, 0));
};

beforeEach(async () => {
  if (!mod) {
    mod = await import('../src/ui/store.js');
    store = mod.useStore;
    createInitialState = (await import('../src/core/state/gameState.js')).createInitialState;
    const model = await import('../src/providers/model.js');
    gen = model.generateImage as unknown as ReturnType<typeof vi.fn>;
    grab = model.fetchImageAsLocal as unknown as ReturnType<typeof vi.fn>;
    IMAGE_TIMEOUT_MS = mod.IMAGE_TIMEOUT_MS;
  }
  gen.mockReset();
  grab.mockReset();
  // 默认：抓不回来（跨源 CORS 的常态）
  grab.mockImplementation(async (url: string) => ({ kind: 'remote', value: url }));
  store.setState({
    imageJobs: [],
    messages: [{ id: 'm1', role: 'gm', content: '甲板上很冷。', ts: 1 }],
    sceneImages: {},
    messageImages: {},
    mapImage: '',
    uiNotice: null,
    gameState: createInitialState({ vitals: { hp: 10, san: 60, mp: 10 } }),
    character: { ...store.getState().character, portrait: '' },
  });
});

const withKey = () =>
  store.setState({
    config: {
      ...store.getState().config,
      apiKey: 'sk-test',
      imageModel: 'flux',
    },
  });

const noKey = () =>
  store.setState({ config: { ...store.getState().config, apiKey: '', imageModel: 'flux' } });

describe('排不进去的情况：不排空任务', () => {
  it('没配 API Key → 返回 null，队列里一条都不留', () => {
    noKey();
    const job = store.getState().queueImage({
      kind: 'action',
      target: 'm1',
      prompt: 'p',
      label: '这一段的插画',
    });
    expect(job).toBeNull();
    expect(store.getState().imageJobs).toEqual([]);
    expect(gen).not.toHaveBeenCalled();
  });

  it('没填生图模型 → 同样返回 null', () => {
    store.setState({ config: { ...store.getState().config, apiKey: 'sk-test', imageModel: '  ' } });
    expect(
      store.getState().queueImage({ kind: 'action', target: 'm1', prompt: 'p', label: 'x' })
    ).toBeNull();
    expect(store.getState().imageJobs).toEqual([]);
  });
});

describe('成功：图落到该在的位置，然后出队', () => {
  it('插画 → messageImages[消息 id]，队列清空', async () => {
    withKey();
    gen.mockResolvedValue('data:image/png;base64,AAA');
    store.getState().queueImage({ kind: 'action', target: 'm1', prompt: 'p', label: '插画' });
    // 排队那一刻就已经在队列里了（角标立刻能显示）
    expect(store.getState().imageJobs.length).toBe(1);

    await flush();
    expect(gen).toHaveBeenCalledTimes(1);
    expect(store.getState().messageImages['m1']).toBe('data:image/png;base64,AAA');
    expect(store.getState().imageJobs).toEqual([]);
  });

  it('地点场景 → sceneImages[地点]，地图 → mapImage，立绘 → 角色卡', async () => {
    withKey();
    gen.mockResolvedValue(IMG);

    store.getState().queueImage({ kind: 'scene', target: '老码头', prompt: 'p', label: '场景' });
    store.getState().queueImage({ kind: 'map', target: 'map', prompt: 'p', label: '地图' });
    store.getState().queueImage({ kind: 'portrait', target: 'character', prompt: 'p', label: '立绘' });
    await flush();

    expect(store.getState().sceneImages['老码头']).toBe(IMG);
    expect(store.getState().mapImage).toBe(IMG);
    expect(store.getState().character.portrait).toBe(IMG);
    expect(store.getState().imageJobs).toEqual([]);
  });

  it('队友立绘：两个名单都要打（已入队的 + 还没入队的候选）', async () => {
    withKey();
    gen.mockResolvedValue(IMG);
    const mate = {
      id: 'c1',
      name: '米拉',
      role: '记者',
      personality: '爱追问',
      skills: {},
      vitals: { hp: 10 },
      initiative: 'balanced' as const,
      alive: true,
      present: true,
    };
    store.setState({
      gameState: createInitialState({ vitals: { hp: 10, san: 60, mp: 10 }, companions: [mate] }),
      companionCandidates: [{ ...mate, id: 'c2', name: '还没入队的人' }],
    });

    store.getState().queueImage({ kind: 'portrait', target: 'c1', prompt: 'p', label: '立绘' });
    store.getState().queueImage({ kind: 'portrait', target: 'c2', prompt: 'p', label: '立绘' });
    await flush();

    expect(store.getState().gameState.companions[0]!.portrait).toBe(IMG);
    expect(store.getState().companionCandidates[0]!.portrait).toBe(IMG);
  });
});

describe('失败：留在队列里，带一句人话，能重试', () => {
  it('接口报错 → 任务还在，error 是人话', async () => {
    withKey();
    gen.mockRejectedValue(new Error('connect timeout'));
    store.getState().queueImage({ kind: 'action', target: 'm1', prompt: 'p', label: '插画' });
    await flush();

    const jobs = store.getState().imageJobs;
    expect(jobs.length).toBe(1);
    expect(jobs[0]!.status).toBe('failed');
    expect(jobs[0]!.error).toContain('生图失败');
    // 没画出来就别在消息上留一张空图
    expect(store.getState().messageImages['m1']).toBeUndefined();
  });

  it('接口没返回图片（url 为空）也算失败，而且给的是那条提示', async () => {
    withKey();
    gen.mockResolvedValue(null);
    store.getState().queueImage({ kind: 'action', target: 'm1', prompt: 'p', label: '插画' });
    await flush();
    expect(store.getState().imageJobs[0]!.error).toContain('没有返回图片');
  });

  it('重试会再跑一次，成功之后才出队', async () => {
    withKey();
    gen.mockRejectedValueOnce(new Error('第一次挂了'));
    store.getState().queueImage({ kind: 'action', target: 'm1', prompt: 'p', label: '插画' });
    await flush();
    const failed = store.getState().imageJobs[0]!;
    expect(failed.status).toBe('failed');

    gen.mockResolvedValue(IMG);
    store.getState().retryImageJob(failed.id);
    await flush();

    expect(gen).toHaveBeenCalledTimes(2);
    expect(store.getState().messageImages['m1']).toBe(IMG);
    expect(store.getState().imageJobs).toEqual([]);
  });

  it('"不画了" → 直接从队列去掉', async () => {
    withKey();
    gen.mockRejectedValue(new Error('挂了'));
    store.getState().queueImage({ kind: 'action', target: 'm1', prompt: 'p', label: '插画' });
    await flush();
    const id = store.getState().imageJobs[0]!.id;
    store.getState().dismissImageJob(id);
    expect(store.getState().imageJobs).toEqual([]);
  });
});

describe('同位置连点不会变成多张图', () => {
  it('连排三次只调用一次接口', async () => {
    withKey();
    gen.mockResolvedValue(IMG);
    for (let i = 0; i < 3; i++) {
      store.getState().queueImage({ kind: 'action', target: 'm1', prompt: 'p', label: '插画' });
    }
    expect(store.getState().imageJobs.length).toBe(1);
    await flush();
    expect(gen).toHaveBeenCalledTimes(1);
    expect(store.getState().imageJobs).toEqual([]);
  });
});

describe('P2-3：落盘前归一化，链接抓不回来就如实降级', () => {
  it('接口只给链接、能抓回来 → 存的是 data URI（自包含）', async () => {
    withKey();
    gen.mockResolvedValue('https://cdn.example.com/tmp.png');
    grab.mockResolvedValue({ kind: 'self', value: 'data:image/png;base64,LOCAL' });

    store.getState().queueImage({ kind: 'action', target: 'm1', prompt: 'p', label: '插画' });
    await flush();

    expect(grab).toHaveBeenCalledWith('https://cdn.example.com/tmp.png');
    // 落在消息上的必须是能离线打开的那份，不是那个会过期的链接
    expect(store.getState().messageImages['m1']).toBe('data:image/png;base64,LOCAL');
    // 抓回来了就不该再唠叨
    expect(store.getState().uiNotice).toBeNull();
  });

  it('抓不回来（跨源 CORS）→ **不算失败**，照常落链接，但要说清楚它会失效', async () => {
    withKey();
    gen.mockResolvedValue('https://cdn.example.com/tmp.png');
    // beforeEach 已默认 remote

    store.getState().queueImage({ kind: 'action', target: 'm1', prompt: 'p', label: '插画' });
    await flush();

    // 图看得见，所以出队（不是失败）
    expect(store.getState().imageJobs).toEqual([]);
    expect(store.getState().messageImages['m1']).toBe('https://cdn.example.com/tmp.png');
    // 但必须留下一句话 —— 玩家得知道这张图会失效
    expect(store.getState().uiNotice).toContain('临时链接');
  });

  it('已经是 data URI 的图不再多跑一趟 fetch', async () => {
    withKey();
    gen.mockResolvedValue('data:image/png;base64,AAA');
    store.getState().queueImage({ kind: 'action', target: 'm1', prompt: 'p', label: '插画' });
    await flush();
    expect(grab).not.toHaveBeenCalled();
    expect(store.getState().messageImages['m1']).toBe('data:image/png;base64,AAA');
  });

  it('接口不认 response_format（仍返回 url）也不该报错', async () => {
    withKey();
    // 服务商忽略参数、照旧给链接 —— 这正是硅基流动那一类的兼容性风险
    gen.mockResolvedValue('https://cdn.example.com/a.png');
    store.getState().queueImage({ kind: 'map', target: 'map', prompt: 'p', label: '地图' });
    await flush();
    expect(store.getState().mapImage).toBe('https://cdn.example.com/a.png');
    expect(store.getState().imageJobs).toEqual([]);
  });
});

/*
 * P1-2（协作方第 22 版）：**生图失败对玩家完全不可见**。
 *
 * 以前 `applyImageResult` 拒落时 `console.warn` + `Promise.resolve()`，
 * 而 `runImageJob` 紧接着照常 `dropJob` —— 拒落和成功在调用方看来一模一样。
 * 玩家视角：点了生成 → 转 40 秒 → 队列空了、图没了、零提示、零重试。
 *
 * 这两条钉的是"失败必须留下来"，与上一条「抓不回来不算失败」是**相反的两种结果**，
 * 别让它们混 —— 抓不回来是降级（图还在），拒落是失败（图没了）。
 */
describe('P1-2：闸门拒落 = 失败，必须留队并说人话（不能静默出队）', () => {
  it('🔴 返回的不是图（落盘闸门拒了）→ 留在队列里并可重试，不是悄悄消失', async () => {
    withKey();
    // 一个连"今天都显示不出来"的脏串：不是 data URI、不是 http
    gen.mockResolvedValue('NOT_AN_IMAGE');
    grab.mockResolvedValue({ kind: 'remote', value: 'NOT_AN_IMAGE' });

    store.getState().queueImage({ kind: 'action', target: 'm1', prompt: 'p', label: '插画' });
    await flush();

    // 关键：**没有**出队 —— 以前这里 imageJobs 会是 []
    expect(store.getState().imageJobs).toHaveLength(1);
    const job = store.getState().imageJobs[0]!;
    // 🔴 真判据：留队原因要**说中这件事**（不是"有个 error 字段"就算数）
    expect(job.error ?? '').toContain('不是图片数据');
    // 图当然也没落上去
    expect(store.getState().messageImages['m1']).toBeUndefined();
  });

  it('拒落时给玩家留一句话（不是只有 console.warn）', async () => {
    withKey();
    gen.mockResolvedValue('NOT_AN_IMAGE');
    grab.mockResolvedValue({ kind: 'remote', value: 'NOT_AN_IMAGE' });

    store.getState().queueImage({ kind: 'portrait', target: 'character', prompt: 'p', label: '立绘' });
    await flush();

    expect(store.getState().uiNotice).toContain('没能保存下来');
    // 而且提示里要给出下一步：重试或换模型
    expect(store.getState().uiNotice).toContain('重试');
  });
});

describe('消息已经不在的任务：悄悄出队，不浪费一次调用', () => {
  it('目标消息已经不在了 → 不调用接口，直接出队', async () => {
    withKey();
    gen.mockResolvedValue(IMG);
    /*
     * 直接喂一条"目标已经不存在"的任务给它跑：
     * 那个检查发生在**开跑的那一刻**（不是排队那一刻）——
     * 排队期间玩家回溯、清空消息，正是要靠它兜住。
     */
    await store.getState().runImageJob({
      id: 'gone',
      kind: 'action',
      target: '已经不存在的消息',
      prompt: 'p',
      label: '插画',
      status: 'queued',
      at: 1,
    });
    expect(gen).not.toHaveBeenCalled();
    expect(store.getState().imageJobs).toEqual([]);
  });

  it('目标消息还在 → 正常画（别把这条守卫做成"永远不会跑"）', async () => {
    withKey();
    gen.mockResolvedValue(IMG);
    await store.getState().runImageJob({
      id: 'alive',
      kind: 'action',
      target: 'm1',
      prompt: 'p',
      label: '插画',
      status: 'queued',
      at: 1,
    });
    expect(gen).toHaveBeenCalledTimes(1);
    expect(store.getState().messageImages['m1']).toBe(IMG);
  });
});

/* ============================================================
 * 🔴 主人 2026-09-27 真机：一生图就卡死。
 *
 * 现象三条，其实是同一个病：
 *   ① 一张图"一直不成功也不失败"，隔夜才冒出一句失败；
 *   ② 第二张画出来了，队列却不散，角标说"正在画 2 张"；
 *   ③ 第三张永远"排队中"，再也没开工。
 * 根因：请求发出去之后**没有人给它计时** —— `running` 一旦挂住，
 * 那两个并发槽就再也不让出来，排在后面的图全饿死。
 *
 * 这里用**永不 settle 的 mock** 复现"服务端连上了但不回话"，
 * 断的是：到点自己变失败（看得见、能重试）+ 后面的图立刻接班。
 * ============================================================ */
describe('挂住的请求不许占着槽位（主人 2026-09-27 真机）', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('🔴 超过 3 分钟 → 当失败处理，留给玩家一句话 + 能重试', async () => {
    vi.useFakeTimers();
    withKey();
    // 永不 settle：模拟"连上了、服务器却不回话"
    gen.mockReturnValue(new Promise(() => {}));
    store.getState().queueImage({ kind: 'action', target: 'm1', prompt: 'p', label: '插画' });
    await vi.advanceTimersByTimeAsync(0);
    expect(store.getState().imageJobs[0]!.status).toBe('running');

    await vi.advanceTimersByTimeAsync(IMAGE_TIMEOUT_MS + 10);
    const jobs = store.getState().imageJobs;
    expect(jobs).toHaveLength(1);
    expect(jobs[0]!.status).toBe('failed');
    // 人话 + 下一步能照着做（不是一句干巴巴的"失败"）
    expect(jobs[0]!.error).toContain('3 分钟');
    expect(jobs[0]!.error).toContain('重试');
  });

  it('🔴 超时时那个请求真的被掐掉了（不是放着不管）', async () => {
    vi.useFakeTimers();
    withKey();
    let seen: { signal?: AbortSignal } | undefined;
    gen.mockImplementation((_prompt: string, cfg: { signal?: AbortSignal }) => {
      seen = cfg;
      return new Promise(() => {});
    });
    store.getState().queueImage({ kind: 'action', target: 'm1', prompt: 'p', label: '插画' });
    await vi.advanceTimersByTimeAsync(0);
    expect(seen?.signal?.aborted).toBe(false);

    await vi.advanceTimersByTimeAsync(IMAGE_TIMEOUT_MS + 10);
    expect(seen?.signal?.aborted).toBe(true);
  });

  it('🔴 卡住的那条被收走之后，排在后面的图立刻开工（不再原地等到第二天）', async () => {
    withKey();
    store.setState({
      messages: [
        { id: 'm1', role: 'gm', content: '甲板上很冷。', ts: 1 },
        { id: 'm2', role: 'gm', content: '雾里有个影子。', ts: 2 },
      ],
    });
    /*
     * 塞一条"已经飞了一小时"的 running —— 模拟定时器被浏览器节流之后
     * 那条 promise 没能自己停下来的漏网情况（第二条防线）。
     */
    const stuck: ImageJob = {
      id: 'stuck',
      kind: 'action',
      target: 'm1',
      prompt: 'p1',
      label: '插画',
      status: 'running',
      at: 0,
      startedAt: Date.now() - IMAGE_TIMEOUT_MS - 60_000,
    };
    store.setState({ imageJobs: [stuck] });
    // 第二条排队等着；它也挂着（只要证明它**开工了**，不是还堵在后面）
    gen.mockReturnValue(new Promise(() => {}));
    store.getState().queueImage({ kind: 'action', target: 'm2', prompt: 'p2', label: '插画' });

    await flush();
    // 卡住的那条 → 失败得看得见
    const stuckNow = store.getState().imageJobs.find((j) => j.id === 'stuck');
    expect(stuckNow?.status).toBe('failed');
    // 后面那条拿了刚空出来的槽位，**真的开工了**（不再是永远的"排队中"）
    expect(store.getState().imageJobs.find((j) => j.target === 'm2')?.status).toBe('running');
    expect(gen).toHaveBeenCalledTimes(1);
    expect(gen.mock.calls[0]![0]).toBe('p2');
  });
});

/* ============================================================
 * 🔴 `H26`（协28 §F① 第 20 条 · 协29 补裁）：**正在跑的那张也能当场停**。
 *
 * 排队中的 `dismissImageJob` 一直能用；`running` 那条以前只有角标上一句「画着…」，
 * 玩家只能干等（或等 3 分钟硬闸）—— 自动配图连着画、他突然改主意时没有出口。
 * 判据（协29 §3 H26）：点「不画了」→ 该条从 `running` 消失；后面排队的**立刻开工**。
 * ============================================================ */
describe('H26：正在跑的那张也能停', () => {
  /** 三条待画：并发是 2，所以第三条一定排在后面等着 */
  const seedThree = () => {
    store.setState({
      messages: [
        { id: 'm1', role: 'gm', content: '甲板上很冷。', ts: 1 },
        { id: 'm2', role: 'gm', content: '雾里有个影子。', ts: 2 },
        { id: 'm3', role: 'gm', content: '缆绳在响。', ts: 3 },
      ],
    });
    gen.mockReturnValue(new Promise(() => {})); // 永不 settle：模拟"一直在画"
    for (const m of ['m1', 'm2', 'm3']) {
      store.getState().queueImage({ kind: 'action', target: m, prompt: 'p', label: '插画' });
    }
  };
  const at = (target: string) =>
    store.getState().imageJobs.find((j) => j.target === target);

  it('🔴 取消 → 那条出队，而且请求真的被掐掉（不是放着不管）', async () => {
    withKey();
    let seen: AbortSignal | undefined;
    gen.mockImplementation((_p: string, cfg: { signal?: AbortSignal }) => {
      seen = cfg.signal;
      return new Promise(() => {});
    });
    store.getState().queueImage({ kind: 'action', target: 'm1', prompt: 'p', label: '插画' });
    await flush();
    const running = at('m1')!;
    expect(running.status).toBe('running');
    expect(seen?.aborted).toBe(false);

    store.getState().cancelImageJob(running.id);

    expect(seen?.aborted).toBe(true); // 连接不在后台白挂着
    expect(at('m1')).toBeUndefined(); // 玩家说不要了就是不要了
  });

  it('🔴 停掉之后，排在后面的那张**立刻开工**（不用等到下一次交互）', async () => {
    withKey();
    seedThree();
    await flush();
    expect(at('m1')?.status).toBe('running');
    expect(at('m2')?.status).toBe('running');
    expect(at('m3')?.status).toBe('queued'); // 并发只有 2 个槽，它得等着

    store.getState().cancelImageJob(at('m1')!.id);
    await flush();

    expect(at('m3')?.status).toBe('running'); // 槽位当场让出来
    expect(gen).toHaveBeenCalledTimes(3);
  });

  it('取消之后那条不会被"标红复活"（catch 里 failJob 找不到它，就原样返回）', async () => {
    withKey();
    let rejectIt: ((e: unknown) => void) | undefined;
    gen.mockImplementation((_p: string, cfg: { signal?: AbortSignal }) => {
      // 真的像 fetch 一样：abort 时把自己的 promise 拒掉
      return new Promise((_res, rej) => {
        rejectIt = rej;
        cfg.signal?.addEventListener('abort', () => rej(new Error('aborted')));
      });
    });
    store.getState().queueImage({ kind: 'action', target: 'm1', prompt: 'p', label: '插画' });
    await flush();
    const running = at('m1')!;
    store.getState().cancelImageJob(running.id);
    rejectIt?.(new Error('aborted')); // 请求那边也顺着把错误抛出来
    await flush();

    // 队列里干干净净：既没留一条红着的，也没多出一条
    expect(store.getState().imageJobs).toHaveLength(0);
  });

  it('排队中的那条照旧走 dismiss（两条路各管各的，没打架）', async () => {
    withKey();
    seedThree();
    await flush();
    store.getState().dismissImageJob(at('m3')!.id);
    await flush();
    expect(at('m3')).toBeUndefined();
    expect(gen).toHaveBeenCalledTimes(2); // 它压根没被发出去
  });
});
