/**
 * 生图任务队列（R40）：把"生成一张图"从**某个页面里的一次 await**
 * 变成**应用级的后台任务**。
 *
 * ## 为什么非改不可
 * 以前生图是组件里的一次 `await`：按钮转圈，你一翻页签回来，
 * 组件已经卸载了，状态没了、图也不知道落哪儿去了。
 * 自动配图更糟 —— 它躲在回合收尾里跑，一张正在生成的图**完全不可见**，
 * 你想知道"它到底画没画"只能去翻那条消息。
 *
 * ## 现在的四条规矩
 * 1. **任务住在 store 里，不住在组件里** —— 切页签、换面板都不影响它继续跑。
 * 2. **成功即出队**（图已经落到它该在的位置，那才是玩家要看的反馈）；
 *    **失败留在队列里**，带一句人话 + 「重试」。失败是最需要被看见的状态。
 * 3. **同一个位置只留一个任务**（同 `kind` + `target` 去重）：
 *    连点三次"重新生成"应该得到一张图，不是三张。
 * 4. **队列落盘**：应用关掉之后再打开，你还看得见"上次有两张没画完"，
 *    点一下重试就行。读盘时 `running` 一律降级成"中断"——
 *    进程都没了，那条任务不可能还在跑，骗自己比说实话更糟。
 *
 * 与 `snapshotPrune` / `archive` 同一条口径：**纯函数单独成文件**，判据能单测。
 */

import type { ArtKind } from '../core/artSpec.js';

/**
 * 一张图是给谁画的。决定结果落到哪个位置
 *
 * `target` 的落点口径：
 * - `action` → 消息 id
 * - `scene` → 地点名
 * - `map` → `'map'`
 * - `portrait` → `'character'` / 队友 id
 * - `monster` → 怪物名（1-F）
 */
/*
 * 类型定义在 `core/artSpec.ts`（那边还要按 kind 给尺寸）。这里只做别名，
 * 方向是 ui → core —— 铁律：core 不许反向依赖 ui。
 */
export type ImageJobKind = ArtKind;

export interface ImageJob {
  id: string;
  kind: ImageJobKind;
  /** 结果落到哪儿：消息 id / 地点名 / 'map' / 角色或队友 id */
  target: string;
  /** 拿去生图的完整提示词（排队那一刻就定好，之后改配置也不影响已排的队） */
  prompt: string;
  /** 队列里给玩家看的一行字（"第 12 回的插画"） */
  label: string;
  status: ImageJobStatus;
  /** 失败原因（人话，直接显示给玩家） */
  error?: string;
  /** 排队时刻（毫秒）。列表按它排，只有展示意义 */
  at: number;
  /** 开始生成那一刻（毫秒）。**只有 `running` 时有值** —— 超时回收拿它算"已经飞了多久" */
  startedAt?: number;
}

/**
 * `done` 刻意不存在：**成功即出队**。
 * 图已经出现在该在的地方了，再在队列里留一条"已完成"只是噪音。
 */
export type ImageJobStatus = 'queued' | 'running' | 'failed';

/** 队列上限。超了先丢最旧的失败任务（它已经没用了），再丢最旧的排队任务 */
export const MAX_JOBS = 16;

/** 同位置去重的钥匙 */
export function jobKey(job: Pick<ImageJob, 'kind' | 'target'>): string {
  return `${job.kind}:${job.target}`;
}

/**
 * 排入一条任务。
 *
 * 三种情况：
 * - 同位置**已经有在跑或排队的** → 原样返回列表（不让连点变成三张图）；
 * - 同位置**有一条失败的** → 把它重置成排队（这就是"重试"走的那条路）；
 * - 否则新增到**末尾**（先来先画，不插队）。
 */
export function enqueueJob(
  list: readonly ImageJob[],
  job: Omit<ImageJob, 'status'> & { status?: ImageJobStatus }
): ImageJob[] {
  const key = jobKey(job);
  const existing = list.find((j) => jobKey(j) === key);

  if (existing) {
    if (existing.status !== 'failed') return [...list];
    return list.map((j) =>
      jobKey(j) === key
        ? { ...j, status: 'queued' as const, error: undefined, prompt: job.prompt, label: job.label }
        : j
    );
  }

  const next = [...list, { ...job, status: job.status ?? ('queued' as const) }];
  return next.length > MAX_JOBS ? pruneJobs(next) : next;
}

/**
 * 裁剪到上限。
 *
 * 先丢**失败的**（失败任务的价值是"让你知道它没成"，
 * 但堆到上限时它已经在界面上显示过了，留着只会挡住新任务），
 * 再丢最旧的排队任务。**正在跑的永不丢**。
 */
export function pruneJobs(list: readonly ImageJob[], limit: number = MAX_JOBS): ImageJob[] {
  if (list.length <= limit) return [...list];
  const out = [...list];
  while (out.length > limit) {
    const failIdx = out.findIndex((j) => j.status === 'failed');
    if (failIdx >= 0) {
      out.splice(failIdx, 1);
      continue;
    }
    const queuedIdx = out.findIndex((j) => j.status === 'queued');
    if (queuedIdx >= 0) {
      out.splice(queuedIdx, 1);
      continue;
    }
    break; // 剩下的全在跑 —— 宁可超一点，也不打断正在飞的请求
  }
  return out;
}

/**
 * 标成"正在跑"（推队列时调用）。
 *
 * 顺手记下**开始时刻** —— 超时回收（`stalledJobs`）要靠它算"这一条已经飞了多久"；
 * 记的是 `begin` 而不是 `enqueue`，排队等待的时间不该算进请求耗时。
 */
export function beginJob(list: readonly ImageJob[], id: string, now = Date.now()): ImageJob[] {
  return list.map((j) => (j.id === id ? { ...j, status: 'running' as const, startedAt: now } : j));
}

/**
 * 回收**飞太久**的任务（主人 2026-09-27 真机那条："一直不成功也不失败，第二天的才显示失败"）。
 *
 * 每条 `runImageJob` 自己带一道硬超时，所以正常情况下走不到这里；
 * 这一份是**兜底**：定时器被浏览器节流（后台标签页）、或者某个 promise 泄漏到倾泻之外，
 * 那条任务就会永远挂在 `running` —— 占着并发槽不让后面的图开工，
 * 玩家看见的是"还在排队"四个字和一格永远不动的进度。
 *
 * 判据：`running` 且**有开始时刻**且已超过 `limitMs`。
 * 没记 `startedAt` 的老任务**不回收**（不知道它飞了多久，宁可不判也不误杀正在跑的请求）。
 */
export function stalledJobs(list: readonly ImageJob[], now: number, limitMs: number): ImageJob[] {
  return list.filter((j) => j.status === 'running' && j.startedAt !== undefined && now - j.startedAt > limitMs);
}

/** 标成失败，并把原因记下来（界面直接显示这句话） */
export function failJob(list: readonly ImageJob[], id: string, error: string): ImageJob[] {
  return list.map((j) => (j.id === id ? { ...j, status: 'failed' as const, error } : j));
}

/** 出队（成功之后，或玩家点了"不画了"） */
export function dropJob(list: readonly ImageJob[], id: string): ImageJob[] {
  return list.filter((j) => j.id !== id);
}

/**
 * 从盘上读回来时过一遍。
 *
 * **`running` 一律降级成"中断"**：进程已经没了，那条请求不可能还在飞。
 * 把它留在 `running` 会让角标永远转圈 —— 那种"卡住的进度"比一句实话糟得多。
 */
export function reviveJobs(
  list: readonly ImageJob[],
  reason = '页面关掉时中断了，可以重试'
): ImageJob[] {
  return list.map((j) => (j.status === 'running' ? { ...j, status: 'failed' as const, error: reason } : j));
}

/** 下次该开哪一条（先来先画）。没有就返回 undefined */
export function nextQueued(list: readonly ImageJob[]): ImageJob | undefined {
  return list.find((j) => j.status === 'queued');
}

/** 正在跑 / 排队的条数（角标上那个数字） */
export function activeCount(list: readonly ImageJob[]): number {
  return list.filter((j) => j.status !== 'failed').length;
}

/** 失败的条数 */
export function failedCount(list: readonly ImageJob[]): number {
  return list.filter((j) => j.status === 'failed').length;
}

/** 属于某个位置的任务（组件据此显示"排队中 / 生成中"） */
export function jobAt(
  list: readonly ImageJob[],
  kind: ImageJobKind,
  target: string
): ImageJob | undefined {
  return list.find((j) => j.kind === kind && j.target === target);
}

/** 这一类图叫什么（角标与列表里用） */
export function kindLabel(kind: ImageJobKind): string {
  switch (kind) {
    case 'action':
      return '插画';
    case 'scene':
      return '场景';
    case 'map':
      return '地图';
    case 'portrait':
      return '立绘';
    case 'monster':
      return '怪物形象';
    case 'avatar':
      return '人物头像';
  }
}

/** 一条任务现在是什么状态（人话）。直接给玩家看 */
export function statusText(job: ImageJob): string {
  switch (job.status) {
    case 'queued':
      return '排队中';
    case 'running':
      return '正在画';
    case 'failed':
      return job.error || '没能画出来';
  }
}

/** 角标上那行字（0 条时不该被调用，调用方先判空） */
export function badgeText(list: readonly ImageJob[]): string {
  const active = activeCount(list);
  const failed = failedCount(list);
  if (active > 0 && failed > 0) return `正在画 ${active} 张 · ${failed} 张没成`;
  if (active > 0) return `正在画 ${active} 张`;
  return `${failed} 张没画出来`;
}

/** 队列里能不能再加活（并发已经满了就不必再推） */
export function hasRoom(list: readonly ImageJob[], concurrency: number): boolean {
  return list.filter((j) => j.status === 'running').length < concurrency;
}
