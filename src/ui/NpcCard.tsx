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
import type { Module } from './store.js';

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

/** 名字上常见的称呼后缀（"霍华德先生"）*/
const NAME_SUFFIX_RE =
  /(先生|女士|小姐|太太|夫人|老板|师傅|大叔|大婶|大妈|大爷|大娘|同学|老师|医生|探长|警长|队长|先生)$/;
/** 名字上常见的亲昵前缀（"老霍华德""小王"）*/
const NAME_PREFIX_RE = /^(老|小|阿)/;

/**
 * 名字的"核心"，用来做宽松匹配。
 *
 * 模型写人名很不统一：同一轮里可能一会儿"老霍华德"、一会儿"霍华德先生"。
 * 严格相等会让卡片经常查不到人（玩家点开一片空白，还以为功能坏了）。
 * 这里剥掉前后缀再比；核心太短（一两个字）时不比"包含"，避免"王"对上"汪三"。
 */
function nameKey(raw: string): string {
  return raw.trim().replace(NAME_PREFIX_RE, '').replace(NAME_SUFFIX_RE, '').trim();
}

/** 两个名字指的是不是同一个人 */
function sameName(a: string, b: string): boolean {
  if (a === b) return true;
  const ka = nameKey(a);
  const kb = nameKey(b);
  if (ka === kb) return true;
  if (ka.length < 2 || kb.length < 2) return false;
  return ka.includes(kb) || kb.includes(ka);
}

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
  const noteKey = Object.keys(notes).find((k) => sameName(k, target));
  const note = noteKey ? notes[noteKey] : undefined;

  const modNpc = (mod?.npcs ?? []).find((n) => sameName(n.name, target));

  const companion = (gs.companions ?? []).some((c) => sameName(c.name, target));

  return {
    name: target,
    role: note?.role?.trim() || modNpc?.role?.trim() || undefined,
    note: note?.note?.trim() || undefined,
    met: typeof note?.met === 'number' ? note.met : undefined,
    inModule: Boolean(modNpc),
    companion,
    present: (gs.npcsAlive ?? []).includes(target),
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
  return (
    <div
      className="fixed inset-0 z-[90] flex items-end justify-center bg-ink-950/70 p-3 sm:items-center"
      onClick={onClose}
    >
      <div
        className="w-full max-w-sm rounded-lg border border-gold-600/40 bg-ink-900 p-4 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-baseline justify-between gap-2">
          <h3 className="text-[15px] font-medium text-mist-100">{profile.name}</h3>
          <span className="shrink-0 text-[10px] text-gold-400">
            {npcStatusText(profile)}
          </span>
        </div>

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
