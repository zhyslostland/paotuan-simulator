/**
 * 怪物图鉴（R38 后半）+ 统一剧透约定 G5 的**界面落点**。
 *
 * ## 为什么要有这一页
 * 敌对者表（准备页）解决的是"作者的数值别飘"，但那是**给作者看的**。
 * 玩家这边一直缺一块：打完一场，除了几行编年史什么都没留下——
 * "我打过什么、它怕什么"全散了。图鉴把这部分攒起来，**给成长感**。
 *
 * ## 为什么默认锁着
 * 图鉴里的"弱点 / 怎么退"就是**活路**。这一局还在跑，把这些摊给玩家看
 * 等于把明天的答案递过去。所以总开关是**结档**（`bestiaryUnlocked`）。
 *
 * ## G5：全项目的剧透约定（这一页是它的样板）
 * | 对象 | 什么时候可以给玩家看 |
 * |---|---|
 * | 地名 | 去过、或故事里听说过（地图迷雾） |
 * | 人物身份 / 观察 | 见着了就记（`npcNotes` 只写看得见的，不写动机与秘密） |
 * | 怪物名 / 外观 / 数值 | **照面**即可见 |
 * | 怪物**弱点** | **交过手**才给 |
 * | 模组真相 | **结档之后**（导出默认还不含） |
 * 一句话：**玩家此刻能感知到的才给，其余一律等。**
 * R30（生涯 / 成就）以后复用同一套口径，不要另立一份。
 */

import { useMemo } from 'react';
import { useStore } from './store';
import { buildBestiary } from '../core/bestiary.js';

/** 三档可见度对应的视觉与文案。`none` 也画出来——"这里还有东西你没见过"本身就是信息 */
const LEVEL_STYLE: Record<
  string,
  { chip: string; border: string; label: string }
> = {
  fought: {
    chip: 'border-blood-400/60 bg-blood-400/10 text-blood-300',
    border: 'border-l-blood-400/70',
    label: '交过手',
  },
  seen: {
    chip: 'border-gold-600/50 bg-gold-500/10 text-gold-400',
    border: 'border-l-gold-600/60',
    label: '见过',
  },
  none: {
    chip: 'border-ink-600 text-mist-500',
    border: 'border-l-ink-600',
    label: '未遭遇',
  },
};

function Row({ label, value }: { label: string; value?: string | number }) {
  if (value === undefined || value === '') return null;
  return (
    <p className="text-[11px] leading-relaxed text-mist-400">
      <span className="text-mist-500">{label}：</span>
      {value}
    </p>
  );
}

export function BestiaryPanel() {
  /*
   * ⚠️ 这里**必须选稳定切片**，绝不能写 `useStore((s) => s.bestiary())`。
   *
   * 那个写法会在每次渲染时返回一个**新对象**，zustand 按 `Object.is` 比引用，
   * 于是永远判定"变了" → 无限重渲染 → React 抛 `#185`（超出最大更新深度）
   * → 根节点被卸载 → **整页空白**。2026-09-17 线上真出过一次：
   * PC 打开全白、手机卡在自动更新里。
   *
   * 正确姿势：选下面的稳定切片（都是 state 里的原始引用），
   * 再用 `useMemo` 走 `buildBestiary` 纯函数。
   */
  const monsters = useStore((s) => s.module.monsters);
  const encountered = useStore((s) => s.gameState.encountered);
  const fought = useStore((s) => s.gameState.fought);
  const ending = useStore((s) => s.gameState.ending);
  const moduleTitle = useStore((s) => s.module.title);

  const bestiary = useMemo(
    () =>
      buildBestiary(
        (monsters ?? []).map((m) => ({
          id: m.id,
          name: m.name,
          look: m.look,
          hp: m.hp,
          attack: m.attack,
          behavior: m.behavior,
          weakness: m.weakness,
        })),
        encountered ?? [],
        fought ?? [],
        ending
      ),
    [monsters, encountered, fought, ending]
  );
  const endingText = ending?.text ?? '';

  // 表里根本没设过敌对者 —— 这一页没有存在的意义，别占着位置
  if (bestiary.total === 0) return null;

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between gap-2">
        <h3 className="text-[11px] tracking-wider text-mist-500">
          图鉴{bestiary.unlocked ? '' : '（未解锁）'}
        </h3>
        {bestiary.unlocked && (
          <span className="shrink-0 text-[10px] tabular-nums text-mist-500">
            见过 {bestiary.seen}/{bestiary.total}
            {bestiary.fought > 0 && ` · 交过手 ${bestiary.fought}`}
          </span>
        )}
      </div>

      {!bestiary.unlocked ? (
        /*
         * 未解锁时**给出确切条件**，而不是一句"暂不可用"。
         * 玩家看到"跑完这一局就解锁"才知道这是奖励，不是 bug。
         */
        <div className="rounded-md border border-ink-700 bg-ink-850/60 px-2.5 py-2">
          <p className="text-[12px] leading-relaxed text-mist-400">
            这一局还开着，图鉴暂时锁着。
          </p>
          {/*
           * 协作方第 7 版 §3.3②：只给一个**纯事实计数**，不出名字、不出数值、不出弱点。
           * "我确实见过东西"需要正反馈，否则玩家中途完全不知道自己攒到了什么进度。
           */}
          {bestiary.seen > 0 && (
            <p className="mt-1 text-[10px] tabular-nums text-gold-400/90">
              这一局你已经遭遇过 {bestiary.seen} 种 —— 名字与弱点要等这一局走完才翻开。
            </p>
          )}
          <p className="mt-1 text-[10px] leading-relaxed text-mist-500/80">
            里面写着这些东西怕什么、怎么脱身 —— 现在就翻等于提前看答案。
            {endingText ? '' : '这一局跑完（或走到结局）就会解锁。'}
          </p>
        </div>
      ) : (
        <div className="space-y-2">
          {bestiary.cards.map((c) => {
            const st = LEVEL_STYLE[c.level] ?? LEVEL_STYLE.none!;
            const locked = c.level === 'none';
            return (
              <div
                key={c.name}
                className={`rounded-md border-l-2 bg-ink-850 px-2.5 py-2 ${st.border}`}
              >
                <div className="flex items-baseline justify-between gap-2">
                  <span
                    className={`min-w-0 truncate text-[13px] ${
                      locked ? 'text-mist-500' : 'text-mist-100'
                    }`}
                  >
                    {locked ? '？' : c.name}
                  </span>
                  <span
                    className={`shrink-0 rounded border px-1.5 py-0.5 text-[9px] ${st.chip}`}
                  >
                    {st.label}
                  </span>
                </div>

                {locked ? (
                  <p className="mt-1 text-[10px] leading-relaxed text-mist-500/70">
                    这一局里你还没碰上它。
                  </p>
                ) : (
                  <div className="mt-1 space-y-0.5">
                    <Row label="样子" value={c.look} />
                    {/* 血量只在真打过之后才给具体数 —— 只是照面不该知道"它还有几滴" */}
                    {c.level === 'fought' && <Row label="生命" value={c.hp} />}
                    <Row label="攻击" value={c.attack} />
                    <Row label="习性" value={c.behavior} />
                    {c.weakness ? (
                      <p className="mt-1 border-t border-ink-700 pt-1 text-[11px] leading-relaxed text-gold-300">
                        <span className="text-gold-500/80">弱点：</span>
                        {c.weakness}
                      </p>
                    ) : (
                      <p className="mt-1 border-t border-ink-700 pt-1 text-[10px] leading-relaxed text-mist-500/70">
                        只知道它不好惹 —— 真跟它交过手，才看得出它怕什么。
                      </p>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      <p className="text-[10px] leading-relaxed text-mist-500/70">
        图鉴只记这一局模组的对手{moduleTitle ? `（${moduleTitle}）` : ''}。
        未遭遇的先不显示名字 —— 报出名字本身就已经剧透了。
      </p>
    </div>
  );
}
