/**
 * 在地人物卡片 —— 点名字就能看到"这人是谁"。
 *
 * 三处查表（协作方 3.10）：
 *   ① 在场名单 `npcsAlive`——谁在这儿的唯一真源；
 *   ② 旁挂档案 `npcNotes`——这局里逐步记下的身份与观察（模型写、引擎存）；
 *   ③ 模组预设 `module.npcs`——开局就定好的人物表。
 *
 * **只给玩家看玩家该知道的**：模组的 `motive`（动机）与 `secret`（秘密）一律不显示，
 * 那是守密人的底牌，摆到卡片上等于开局剧透。玩家能看到的只有身份与"你观察到的"。
 */

import type { GameState } from '../core/state/gameState.js';
import { useStore } from './store.js';
import type { Module } from './store.js';
import { aspectRatioOf } from '../core/artSpec.js';
import { ImageLightbox } from './ImageLightbox';
import { OrnamentCorner } from './ornaments';

/**
 * 四角的定位与镜像。
 *
 * 🔴 四份**是同一个组件**，对称靠这里的 `-scale-*` 做出来 ——
 * 生图那张做不到真正的镜像（四个角四个手感），这正是主人说
 * 「没看到需要调用生图额度的质量」指的一处
 * （`docs/报告/方案-美术资产路数重定.md`）。
 */
const CORNER_POS = [
  '-left-1 -top-1',
  '-right-1 -top-1 -scale-x-100',
  '-bottom-1 -left-1 -scale-y-100',
  '-bottom-1 -right-1 -scale-x-100 -scale-y-100',
] as const;

export interface NpcProfile {
  name: string;
  /** 身份 / 头衔：档案优先，其次模组预设 */
  role?: string;
  /** 一句观察（外貌、举止、口音）——玩家自己看得见的那种 */
  note?: string;
  /** 首次照面的回合数 */
  met?: number;
  /** 模组人物表里早就写了他（只说明"这人是剧本里的角色"，不代表玩家知道他的底细） */
  inModule: boolean;
  /** 已经是同行者 */
  companion: boolean;
  /** 还在场吗（离场/已死的人也可以点开看） */
  present: boolean;
}

/*
 * 名字匹配的两条规则住在 `core/npcNotes.ts`，**这里不另写一份**。
 *
 * 为什么：档案容量淘汰（`pruneNpcNotes`）要用同一个"谁在场"的判据。
 * 若两处各写一份宽松匹配，迟早出现"卡片认得老霍华德、淘汰逻辑不认"的分歧 ——
 * 那样在场者的档案会被当成离场者丢掉，而"在场者永不淘汰"是用户拍板的硬规矩。
 */
import { sameNpcName } from '../core/npcNotes.js';

/**
 * 汇总一个人的档案。
 *
 * 匹配刻意宽松：模型写的名字可能带称呼或前后缀（"老霍华德""霍华德先生"），
 * 严格相等会经常查不到，于是卡片一片空白。
 */
export function npcProfileOf(
  name: string,
  gs: Pick<GameState, 'npcNotes' | 'npcsAlive' | 'companions'>,
  mod?: Pick<Module, 'npcs'>
): NpcProfile {
  const target = name.trim();

  // 档案：先精确，再退到宽松匹配（中文名常常只差一个称呼）
  const notes = gs.npcNotes ?? {};
  const noteKey = Object.keys(notes).find((k) => sameNpcName(k, target));
  const note = noteKey ? notes[noteKey] : undefined;

  const modNpc = (mod?.npcs ?? []).find((n) => sameNpcName(n.name, target));

  const companion = (gs.companions ?? []).some((c) => sameNpcName(c.name, target));

  return {
    name: target,
    role: note?.role?.trim() || modNpc?.role?.trim() || undefined,
    note: note?.note?.trim() || undefined,
    met: typeof note?.met === 'number' ? note.met : undefined,
    inModule: Boolean(modNpc),
    companion,
    present: (gs.npcsAlive ?? []).some((n) => sameNpcName(n, target)),
  };
}

/** 卡片上"这人目前什么情况"的一行小字 */
export function npcStatusText(p: NpcProfile): string {
  if (p.companion) return '同行者';
  if (p.present) return '在场';
  return '已离场';
}

export function NpcCardModal({
  profile,
  onClose,
}: {
  profile: NpcProfile;
  onClose: () => void;
}) {
  const hasBody = Boolean(profile.role || profile.note);
  /*
   * 1-F：关键剧情人物的立绘（旁挂 `gameState.foeArt`，键 = 名字）。
   *
   * 只有**作者点过名**的人物才可能有图（`module.npcs` 是"作者已经点过"的信号），
   * 路人没有 —— 主人原话：「路人不生成啊」。没图时这里什么都不画，
   * 卡片退化成原来那个纯文字形态。
   */
  const art = useStore((s) => s.gameState.foeArt?.[profile.name]);
  return (
    <div
      className="fixed inset-0 z-[90] flex items-end justify-center bg-ink-950/70 p-3 sm:items-center"
      onClick={onClose}
    >
      <div
        className="relative w-full max-w-sm rounded-lg border border-gold-600/40 bg-ink-900 p-4 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        {/*
         * 四角角饰：**手写 SVG，同一个组件镜像四次**（见 `ui/ornaments.tsx`）。
         *
         * 🔴 为什么不用生图那张：生图**做不到真正的镜像对称**（四个角四个手感），
         * 而且位图不随主题变色 —— 主人原话：「目前的美术我没看到需要调用生图额度的质量」。
         * 镜像四份 = 同一个组件，四角必然一致（`docs/报告/方案-美术资产路数重定.md`）。
         */}
        {CORNER_POS.map((pos) => (
          <OrnamentCorner
            key={pos}
            size={32}
            className={`pointer-events-none absolute text-gold-600 opacity-75 ${pos}`}
          />
        ))}
        <div className="flex items-baseline justify-between gap-2">
          <h3 className="text-[15px] font-medium text-mist-100">{profile.name}</h3>
          <span className="shrink-0 text-[10px] text-gold-400">
            {npcStatusText(profile)}
          </span>
        </div>

        {art && (
          <ImageLightbox src={art} className="mt-3 max-w-[10rem]">
            <img
              src={art}
              alt={profile.name}
              // 与生成尺寸同源（阶段 2 起是方版头像 768×768）—— 容器比例错了会把脸裁掉
              style={{ aspectRatio: aspectRatioOf('avatar') }}
              className="w-full rounded border border-ink-600 object-cover"
            />
          </ImageLightbox>
        )}

        {profile.role && (
          <p className="mt-1 text-[12px] text-mist-400">{profile.role}</p>
        )}

        {profile.note ? (
          <p className="mt-3 border-l-2 border-gold-600/50 pl-2.5 text-[12px] leading-relaxed text-mist-300">
            {profile.note}
          </p>
        ) : hasBody ? (
          <p className="mt-3 text-[11px] leading-relaxed text-mist-500">
            你还没来得及看清他是什么人。
          </p>
        ) : (
          <p className="mt-3 text-[11px] leading-relaxed text-mist-500">
            你只知道在场有这么个人，除此之外一无所知 —— 搭话、或者留意他的举动，
            才会慢慢看出端倪。
          </p>
        )}

        {typeof profile.met === 'number' && (
          <p className="mt-3 text-[10px] text-mist-500">第 {profile.met} 回合照面</p>
        )}

        <button
          onClick={onClose}
          className="mt-4 w-full rounded-md border border-ink-700 py-1.5 text-[12px] text-mist-300 transition hover:border-ink-600 hover:text-mist-100"
        >
          知道了
        </button>
      </div>
    </div>
  );
}
