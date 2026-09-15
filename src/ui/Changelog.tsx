/**
 * 内置更新日志。
 *
 * 为什么要有：这是一个单页面的本地应用，改了什么玩家看不见——
 * 尤其是"某个 bug 修好了"，他会以为还在。这里放一份随应用一起发布的清单，
 * 新版本进来时打个「新」标记，点开就能看到这一轮改了什么。
 */
export interface ChangelogEntry {
  /** 版本标识（用来比对"读没读过"，只增不改） */
  id: string;
  date: string;
  items: string[];
}

/**
 * 更新记录，**新版本加在最前面**。
 * `id` 一旦发布就不要再改——它决定玩家那边的"未读"提示是否正确。
 */
export const CHANGELOG: ChangelogEntry[] = [
  {
    id: '2026-09-15d',
    date: '2026-09-15',
    items: [
      '新：更新检测 —— 打开应用时、每次切回前台、以及每 5 分钟都会自动看一眼有没有新版本，有就弹「有新版本 · 点击立即更新」',
      '新：设置里的「检查更新」按钮（在「安装到设备」一节），并显示当前版本号 —— 以后遇到"我改了你怎么还是旧的"，看一眼版本号就知道',
      '修：测试沙盒里把生命清零没有触发结档结算 —— 结档以前只从两条路走（守密人回合、主动求死），其它来源置上结档信号时会静默什么都不发生。现在统一成一个出口',
      '改：更新横幅多了「稍后」，可以先跑完这一轮再更新',
    ],
  },
  {
    id: '2026-09-15c',
    date: '2026-09-15',
    items: [
      '新：音效槽位补齐 —— 大成功 / 大失败 / 进入战斗 / 受伤 / 理智受创 / 结档 / 开团，七件事都能配自己的音（不传就用内置的）',
      '新：音频控制坞（顶栏 🔊 / ⏹）—— 玩的时候不用翻设置就能一键静音、掐掉正在播的音效（上传了整首歌时很有用）',
      '新：设置里显示音频占用与单文件大小，超过 15MB 会提醒（以前超限只写进控制台，玩家看到的是"上传没反应"）',
      '新：帮助常驻入口（顶栏 ? 与设置里）—— 以前新手说明只在首次进入弹一次，点掉就再也找不到了',
      '改：帮助内容重写并补全（检定怎么算、描述为什么让检定更容易、地图与移动、背包、结档与回溯）',
    ],
  },
  {
    id: '2026-09-15b',
    date: '2026-09-15',
    items: [
      '修：背包里普通物品点「使用」没反应（消耗品只有数量在减，守密人收不到使用的意图）',
      '修：使用物品后没有对应的效果描述 —— 现在会把"用了什么"发给守密人，由它演出结果',
      '修：检定面板不该由玩家选难度（难度由这次行动本身决定，不该让玩家宣布"这次是极难"），已移除',
      '改：描述加权不再调难度档位，改成在引擎算出的**目标值**上加一个封顶的修正量（面板与结果卡片都会显示）',
      '改：描述加权的打分改成"写得越多分越高"——以前判据太取巧，会出现写两句 +1、写一堆 +0',
      '新：内置更新日志（就是这一页），设置里可随时打开，新版本会有「新」标记',
    ],
  },
  {
    id: '2026-09-15a',
    date: '2026-09-15',
    items: [
      '新：测试沙盒（设置 → 开发者）一键灌入测试局、切换脚本化模组、调数值、触发结档',
      '新：模组篇幅选择（短篇·一夜 / 中篇·数日 / 长篇·数周以上），时间尺度不再一律是 15 分钟',
      '新：道具表单独生成（准备页），作用写好后玩家拾取时自动带进背包说明',
      '新：描述加权（每一次检定都算）',
      '新：图片点击放大（立绘 / 场景图 / 区域图 / 随身照）',
      '新：连续检定「一次全掷」',
      '修：未受训技能按规则包基础值掷（游泳 20%，不再是白送 50%）',
      '修：套用示例角色后背包是空的',
      '修：回溯后连续检定队列会消失',
      '新：主动求死由引擎直接结算，不再发给模型（模型会劝诫或让旁人"刚好"救人）',
    ],
  },
  {
    id: '2026-09-14b',
    date: '2026-09-14',
    items: [
      '新：结档结算 —— 死亡 / 理智归零 = 这段故事收束，守密人会写一段结局正文',
      '新：关键抉择（回溯锚点），入口在结档页与世界面板',
      '修：地图拖动后"粘鼠标"、缩放按钮点不动、滚轮会抢走页面滚动',
      '修：移动意图被抄进正文',
      '修：世界书与同行者在换档后会消失',
      '修：网络重试会把已经显示出来的正文删掉',
    ],
  },
  {
    id: '2026-09-14a',
    date: '2026-09-14',
    items: [
      '修：3d6 及以上的骰子概率分布算错（3d6 被算成 8d6）',
      '修：一轮里多个检定只跑第一个',
      '修：非 COC 规则的目标值显示成 %',
      '修：背包不能按数量消耗（用掉的东西永远用不完）',
      '修：属性可以填 9999、清空输入框会变成 NaN',
      '修：检定结论泄漏进正文（"你的侦查成功了"）',
      '修：地图迷雾失效（AI 生成的模组没有可达关系，开局就把地点全摊开）',
      '修：点地图上的地点会瞬移（现在只是"意图"，去不去由守密人按剧情决定）',
      '新：状态变化提示（掉了几点血、拿到什么线索，主页面会告诉你）',
    ],
  },
];

const READ_KEY = 'trpg.changelogRead';

/** 最新版本的 id（用来判断有没有新东西） */
export const LATEST_CHANGELOG_ID = CHANGELOG[0]?.id ?? '';

export function hasUnreadChangelog(): boolean {
  try {
    return localStorage.getItem(READ_KEY) !== LATEST_CHANGELOG_ID;
  } catch {
    return false;
  }
}

export function markChangelogRead(): void {
  try {
    localStorage.setItem(READ_KEY, LATEST_CHANGELOG_ID);
  } catch {
    /* 存不下就算了，下次还会提示 */
  }
}

/** 更新日志弹窗。只写本地一个"已读"标记，不做别的。 */
export function ChangelogDialog({ onClose }: { onClose: () => void }) {
  return (
    <div
      className="fixed inset-0 z-[65] flex items-end justify-center bg-ink-950/85 p-3 sm:items-center"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="max-h-[85vh] w-full max-w-lg overflow-y-auto rounded-2xl border border-ink-600 bg-ink-900 p-4">
        <div className="flex items-center justify-between">
          <h2 className="font-serif text-[15px] text-mist-100">更新日志</h2>
          <button onClick={onClose} className="text-[13px] text-mist-500 hover:text-mist-200">
            ✕
          </button>
        </div>
        <p className="mt-1 text-[10px] text-mist-500">
          按时间倒序。改了什么、修了什么都记在这里，不用猜。
        </p>

        <div className="mt-3 space-y-4">
          {CHANGELOG.map((entry, i) => (
            <div key={entry.id}>
              <div className="flex items-baseline gap-2">
                <span className="text-[12px] text-mist-300">{entry.date}</span>
                {i === 0 && (
                  <span className="rounded-full border border-gold-600/60 px-1.5 py-0.5 text-[9px] text-gold-400">
                    最新
                  </span>
                )}
              </div>
              <ul className="mt-1.5 space-y-1">
                {entry.items.map((it, k) => (
                  <li
                    key={k}
                    className="flex gap-1.5 text-[11px] leading-relaxed text-mist-400"
                  >
                    <span className="mt-[3px] h-1 w-1 shrink-0 rounded-full bg-mist-600" />
                    <span>{it}</span>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>

        <button
          onClick={onClose}
          className="mt-4 w-full rounded-lg bg-gold-500 px-3 py-2 text-[12px] font-medium text-ink-950 transition hover:bg-gold-400"
        >
          知道了
        </button>
      </div>
    </div>
  );
}
