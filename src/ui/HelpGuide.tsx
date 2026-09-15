/**
 * 新手说明 / 帮助。
 *
 * 以前这段内容只写在"首次进入"的欢迎弹窗里，点掉就再也找不到了——
 * 玩了三天想问"回溯在哪"，只能翻设置里那几行快捷键。
 * 现在抽成常驻组件：首次仍自动弹，之后在设置里、以及顶栏的「?」都能随时打开。
 */
const SECTIONS: { title: string; rows: string[] }[] = [
  {
    title: '先做两件事',
    rows: [
      '**准备**：建一张角色卡（或点「套用示例角色」），再生成一个模组——给个名字就行，也可以贴一段小说／剧本让它整理成模组。',
      '**设置**：填 API Key 与模型。默认接的是硅基流动，不填什么都跑不起来。',
    ],
  },
  {
    title: '怎么玩',
    rows: [
      '直接用大白话行动："我推门进去""我问他女儿什么时候失踪的"。**不需要任何标记或格式**。',
      '想做一件事但没把握 → 点角色卡里的技能掷骰。想掷哪一个由你决定，掷之前可以写一句"你想怎么做"。',
      '**描述写得越具体，这次越容易**：点到了场上的人、地方、线索，或者在 15 字以上写明做法，目标值都会往好的方向走，面板上会直接显示改了多少。',
      '守密人也会要求检定（世界面板会弹出「掷骰」按钮）。一次要求多个时，可以「一次全掷」。',
    ],
  },
  {
    title: '地图与移动',
    rows: [
      '在「世界」面板点地图上的地点，只是告诉守密人"我想去那儿"——去不去得成由剧情决定（路封了、天黑了都可能被拦下）。',
      '地图只画你知道的地方：实心＝去过，虚线空心＝只是听说过，问号＝还不清楚。',
      '守密人把你带到地图上没有的地方时，会自动补一个节点，不会把你卡在原地。',
    ],
  },
  {
    title: '背包',
    rows: [
      '点背包里的东西看详情。武器有「用此武器攻击」，消耗品有「使用」——**数量会真的减掉**，用掉的东西不会再回来。',
      '手里没有对应的武器时，技能按钮上会标「无可用武器」——技能值不等于手里有东西。',
    ],
  },
  {
    title: '迷失方向时',
    rows: [
      '看「世界」面板顶部的**当前目标**：你要做什么、失败了会怎样、为什么是现在，都写在那儿。',
      '「关键抉择」那里记着你走过的岔路口，随时可以退回去重来——系统一直保留这个能力。',
    ],
  },
  {
    title: '死亡与结局',
    rows: [
      '生命或理智走到尽头，这一局就**结档**了：守密人会给一段结局正文，不是弹一个"你死了"。',
      '结档页上有「回到某个关键抉择」，退回去那一步就还能继续。',
      '主动放弃、求死也是可以的——引擎会直接结算，不会有人劝你回头。',
    ],
  },
  {
    title: '其它',
    rows: [
      '更新日志在设置里（有新版本时会自动弹一次）。',
      '存档在本机浏览器里，**建议偶尔导出备份**（设置 → 数据与存档）。',
      '手机可以「添加到主屏」当成应用用，离线也能打开。',
    ],
  },
];

/** 行内 **强调** 极简渲染：够用就好，不引 markdown 库 */
function Inline({ text }: { text: string }) {
  const parts = text.split(/(\*\*[^*]+\*\*)/g);
  return (
    <>
      {parts.map((p, i) =>
        p.startsWith('**') && p.endsWith('**') ? (
          <b key={i} className="text-mist-200">
            {p.slice(2, -2)}
          </b>
        ) : (
          <span key={i}>{p}</span>
        )
      )}
    </>
  );
}

export function HelpDialog({
  onClose,
  firstTime = false,
}: {
  onClose: () => void;
  /** 首次进入时用欢迎的口吻与按钮文案 */
  firstTime?: boolean;
}) {
  return (
    <div
      className="fixed inset-0 z-[80] flex items-center justify-center bg-black/70 p-4"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="max-h-[90vh] w-full max-w-md overflow-y-auto rounded-2xl border border-ink-600 bg-ink-900 p-5 shadow-2xl">
        <div className="flex items-baseline justify-between">
          <h2 className="font-serif text-lg text-gold-300">
            {firstTime ? '欢迎来到跑团模拟器' : '怎么玩'}
          </h2>
          <button onClick={onClose} className="text-[13px] text-mist-500 hover:text-mist-200">
            ✕
          </button>
        </div>
        <p className="mt-1.5 text-[13px] leading-relaxed text-mist-300">
          你是唯一的玩家，AI 当守密人。用自然语言描述你的行动，它把故事接下去。
        </p>

        <div className="mt-3 space-y-3.5">
          {SECTIONS.map((s) => (
            <div key={s.title}>
              <h3 className="text-[11px] tracking-wider text-mist-500">{s.title}</h3>
              <ul className="mt-1.5 space-y-1.5">
                {s.rows.map((r, i) => (
                  <li key={i} className="flex gap-1.5 text-[12px] leading-relaxed text-mist-400">
                    <span className="mt-[6px] h-1 w-1 shrink-0 rounded-full bg-mist-600" />
                    <span>
                      <Inline text={r} />
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>

        <button
          onClick={onClose}
          className="mt-4 w-full rounded-lg bg-gold-500 px-4 py-2 text-[13px] font-medium text-ink-950 transition hover:bg-gold-400"
        >
          {firstTime ? '开始冒险' : '知道了'}
        </button>
      </div>
    </div>
  );
}
