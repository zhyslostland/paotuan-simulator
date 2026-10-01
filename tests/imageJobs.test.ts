import { describe, expect, it } from 'vitest';
import {
  activeCount,
  badgeText,
  beginJob,
  dropJob,
  enqueueJob,
  failJob,
  failedCount,
  hasRoom,
  jobAt,
  jobKey,
  kindLabel,
  MAX_JOBS,
  nextQueued,
  pruneJobs,
  reviveJobs,
  stalledJobs,
  statusText,
  type ImageJob,
} from '../src/ui/imageJobs.js';

/*
 * ============================================================
 * 生图队列（R40）的判据
 *
 * 这一组要钉住的是"后台任务"最容易被做坏的几件事：
 *   ① 连点三次不该变成三张图（同位置去重）；
 *   ② 失败**留在队列里**（那是玩家最需要看见的状态）；
 *   ③ 读盘回来的 `running` 一律降级（否则角标永远转圈）；
 *   ④ 正在跑的**永不丢**（丢的是排队和已失败的）。
 * ============================================================
 */

const job = (over: Partial<ImageJob> = {}): ImageJob => ({
  id: 'j1',
  kind: 'action',
  target: 'm1',
  prompt: '画一张图',
  label: '第 1 回的分镜',
  status: 'queued',
  at: 1,
  ...over,
});

describe('同位置去重：连点三次得到一张图', () => {
  it('钥匙＝kind + target（不同位置互不影响）', () => {
    expect(jobKey(job())).toBe('action:m1');
    expect(jobKey(job({ kind: 'scene', target: '雾港' }))).toBe('scene:雾港');
  });

  it('新任务排到末尾', () => {
    const list = enqueueJob([job()], job({ id: 'j2', target: 'm2' }));
    expect(list.map((j) => j.id)).toEqual(['j1', 'j2']);
  });

  it('同位置已经排队 / 在跑 → 原样不动（不会多出一张）', () => {
    const queued = enqueueJob([job()], job({ id: 'j9' }));
    expect(queued.length).toBe(1);
    expect(queued[0]!.id).toBe('j1');

    const running = enqueueJob([job({ status: 'running' })], job({ id: 'j9' }));
    expect(running.length).toBe(1);
    expect(running[0]!.id).toBe('j1');
  });

  it('同位置原来是**失败的** → 重新排队（"重试/重新生成"走的就是这条路）', () => {
    const list = enqueueJob(
      [job({ status: 'failed', error: '接口 500' })],
      job({ id: 'j9', prompt: '新提示词' })
    );
    expect(list.length).toBe(1);
    expect(list[0]!.status).toBe('queued');
    expect(list[0]!.error).toBeUndefined();
    // 提示词要换成新的 —— 不然"重新生成"会拿旧提示词再画一遍
    expect(list[0]!.prompt).toBe('新提示词');
  });
});

describe('裁剪：丢失败的与排队的，永不丢正在跑的', () => {
  it('没超上限原样返回', () => {
    expect(pruneJobs([job(), job({ id: 'j2', target: 'm2' })], 5).length).toBe(2);
  });

  it('超上限先丢最旧的失败任务', () => {
    const list = [
      job({ id: 'j1', status: 'failed', error: 'x' }),
      job({ id: 'j2', target: 'm2' }),
      job({ id: 'j3', target: 'm3' }),
    ];
    const out = pruneJobs(list, 2).map((j) => j.id);
    expect(out).toEqual(['j2', 'j3']);
  });

  it('剩下的全是排队时就丢最旧的排队任务', () => {
    const list = [job({ id: 'j1' }), job({ id: 'j2', target: 'm2' }), job({ id: 'j3', target: 'm3' })];
    expect(pruneJobs(list, 2).map((j) => j.id)).toEqual(['j2', 'j3']);
  });

  it('正在跑的一律留住（宁可超一点，也不打断已经在飞的请求）', () => {
    const list = [
      job({ id: 'run', status: 'running' }),
      job({ id: 'q1', target: 'm2' }),
      job({ id: 'q2', target: 'm3' }),
    ];
    const out = pruneJobs(list, 1).map((j) => j.id);
    expect(out).toContain('run');
  });

  it('排满之后再排也不会无限长', () => {
    let list: ImageJob[] = [];
    for (let i = 0; i < MAX_JOBS + 5; i++) {
      list = enqueueJob(list, job({ id: `j${i}`, target: `m${i}` }));
    }
    expect(list.length).toBeLessThanOrEqual(MAX_JOBS);
  });
});

describe('状态流转', () => {
  it('begin → 在跑；fail → 带上人话；drop → 出队', () => {
    const started = beginJob([job()], 'j1');
    expect(started[0]!.status).toBe('running');
    const failed = failJob(started, 'j1', '生图失败 500');
    expect(failed[0]!.status).toBe('failed');
    expect(failed[0]!.error).toBe('生图失败 500');

    expect(dropJob(failed, 'j1')).toEqual([]);
  });

  /* ------------------------------------------------------------
   * 🔴 主人 2026-09-27 真机：一条图"一直不成功也不失败"，还把后面的堵死。
   * 根因是请求没人计时 —— `running` 一旦挂住，并发槽就再也不让出来。
   * 两条防线：① 每条任务自带硬超时；② `stalledJobs` 兜底那条落在缝里的任务。
   * ------------------------------------------------------------ */
  it('🔴 begin 要记下"几点开的工"（超时回收靠它算飞了多久）', () => {
    const started = beginJob([job()], 'j1', 1_000);
    expect(started[0]!.startedAt).toBe(1_000);
    // 排队的那条不该有这个字段 —— 排队等待的时间不算请求耗时
    expect(beginJob([job()], 'nope')[0]!.startedAt).toBeUndefined();
  });

  it('🔴 飞太久的 running 会被点出来；没到点 / 没记时刻的都不动', () => {
    const old = { ...job({ status: 'running' as const }), startedAt: 0 };
    const fresh = { ...job({ id: 'j2' }), status: 'running' as const, startedAt: 1_000 };
    const noStamp = { ...job({ id: 'j3' }), status: 'running' as const };
    expect(stalledJobs([old, fresh, noStamp], 1_500, 1_000).map((j) => j.id)).toEqual(['j1']);
    // 还没到点 → 一条都不回收（不能把正在跑的好请求误杀）
    expect(stalledJobs([fresh], 1_500, 1_000)).toEqual([]);
    // 没记时刻 → 不知道飞了多久，宁可不判也不误杀
    expect(stalledJobs([noStamp], 999_999, 1_000)).toEqual([]);
  });

  it('读盘回来：running 一律降级成"中断"（进程都没了，不可能还在飞）', () => {
    const out = reviveJobs([job({ status: 'running' }), job({ id: 'j2', status: 'queued' })]);
    expect(out[0]!.status).toBe('failed');
    expect(out[0]!.error).toContain('中断');
    // 排队中的原样留着 —— 下次打开还能接着画
    expect(out[1]!.status).toBe('queued');
  });
});

describe('选下一个 + 计数 + 那几行字', () => {
  it('先来先画（取最前面那条排队的）', () => {
    expect(nextQueued([job({ status: 'running' }), job({ id: 'j2' })])?.id).toBe('j2');
    expect(nextQueued([job({ status: 'running' })])).toBeUndefined();
  });

  it('并发满了就不再放活', () => {
    expect(hasRoom([job({ status: 'running' })], 2)).toBe(true);
    expect(hasRoom([job({ status: 'running' }), job({ id: 'j2', status: 'running' })], 2)).toBe(false);
    // 失败的不占并发位
    expect(hasRoom([job({ status: 'failed' }), job({ id: 'j2', status: 'running' })], 2)).toBe(true);
  });

  it('活跃数不含失败的；角标那行字分三种情况', () => {
    const list = [job({ status: 'running' }), job({ id: 'j2', status: 'queued' }), job({ id: 'j3', status: 'failed' })];
    expect(activeCount(list)).toBe(2);
    expect(failedCount(list)).toBe(1);
    expect(badgeText(list)).toContain('正在画 2 张');
    expect(badgeText(list)).toContain('1 张没成');

    expect(badgeText([job({ status: 'running' })])).toBe('正在画 1 张');
    expect(badgeText([job({ status: 'failed' })])).toBe('1 张没画出来');
  });

  it('按位置找任务（组件据此显示"排队中/生成中"）', () => {
    const list = [job({ id: 'j1' }), job({ id: 'j2', kind: 'map', target: 'map' })];
    expect(jobAt(list, 'action', 'm1')?.id).toBe('j1');
    expect(jobAt(list, 'map', 'map')?.id).toBe('j2');
    expect(jobAt(list, 'scene', '雾港')).toBeUndefined();
  });

  it('状态与类别的中文（直接给玩家看）', () => {
    expect(statusText(job({ status: 'queued' }))).toBe('排队中');
    expect(statusText(job({ status: 'running' }))).toBe('正在画');
    expect(statusText(job({ status: 'failed', error: '接口 500' }))).toBe('接口 500');
    // 没写原因时也不能显示成空白
    expect(statusText(job({ status: 'failed' }))).toBe('没能画出来');

    expect(kindLabel('action')).toBe('插画');
    expect(kindLabel('scene')).toBe('场景');
    expect(kindLabel('map')).toBe('地图');
    expect(kindLabel('portrait')).toBe('立绘');
  });
});
