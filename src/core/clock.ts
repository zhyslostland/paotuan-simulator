/**
 * 故事时钟 —— 引擎权威的"现在是什么时候"。
 *
 * ## 为什么要有这一层
 *
 * 主人 2026-09-17 报的：测试模组「雨季结束之前」里**没有时间表、也没有时钟**，
 * 而且"系统似乎没有时间概念"。
 *
 * 这不是显示问题。原来的系统里，时间**只活在守密人的正文和模组的 `urgency` 文字里**：
 *   - 模组写"雨季还有二十三天结束"，但那是一句形容词，没有任何东西在数它；
 *   - 玩家睡一觉、在茶棚坐到天黑、走三小时山道 —— 系统完全不知道过去了多久；
 *   - 于是长篇模组跑到中段，倒计时还是"二十三天"，玩家永远到不了雨季结束。
 *
 * **倒计时必须有人数。** 这个文件就是那个数。
 *
 * ## 三条设计判据
 *
 * ① **引擎是唯一真源，模型只申报"过了多久"。**
 *    模型不许改时钟本身（`clock` 不进 `ALLOWED_ROOTS`），
 *    它只能在契约里写 `elapsed`（如 `"三个小时"` / `"一整夜"`），
 *    由这里的 `parseElapsed()` 折算成分，再由 `advanceClock()` 推。
 *    —— 模型报的是**剧情里的量**，数数的是引擎。这与骰子同一条分工。
 *
 * ② **模糊的量要给合理的默认，绝不拒绝。**
 *    "一会儿""过了很久""折腾了大半天"都要能接住；
 *    认不出来时退到**5 分钟**（`parseElapsed` 末尾那句 `return 5`）——
 *    不是抛错、也不是原地不动。宁可少推一点，也不要把玩家的时间卡住。
 *    ⚠️ 头注释与末尾的 `return 5` **必须一致**（协作方第 18 版 P3-3 点出过：
 *    这里曾写"中性小量（几分钟）"而末尾返回 5，读注释的人会以为另有出处）。
 *
 * ③ **时间要可被剧情推，也要能被剧情需要地往回放。**
 *    模组可以给 `clock.start`（故事从哪天几点开始），
 *    引擎只负责往前走；`urgency` 的倒计时由 `deadlineIn`（还剩几天/几小时）表达，
 *    不从文本里猜日期 —— 猜日期必错。
 */

/** 一个时刻：故事内的第几天 + 当天第几分钟（0-1439） */
export interface StoryClock {
  /** 第几天（1 起）。第 1 天 = 故事开始的那一天 */
  day: number;
  /** 当天第几分钟，0-1439 */
  minute: number;
}

export const MINUTES_PER_DAY = 24 * 60;

/** 一天里的时段划分（给提示词与界面用的人话） */
const PHASES: { until: number; label: string }[] = [
  { until: 5 * 60, label: '深夜' },
  { until: 8 * 60, label: '清晨' },
  { until: 11 * 60, label: '上午' },
  { until: 13 * 60, label: '正午' },
  { until: 17 * 60, label: '下午' },
  { until: 19 * 60, label: '傍晚' },
  { until: 22 * 60, label: '夜里' },
  { until: MINUTES_PER_DAY, label: '深夜' },
];

/** 顺手做出来的默认开局时刻：上午九点。故事多半从"白天开始办事"起步 */
export const DEFAULT_CLOCK: StoryClock = { day: 1, minute: 9 * 60 };

/** 把时刻规整到合法范围（分钟溢出进位到天，天至少为 1） */
export function normalizeClock(c: StoryClock | undefined | null): StoryClock {
  const day = Math.max(1, Math.floor(Number(c?.day) || 1));
  const raw = Math.floor(Number(c?.minute) || 0);
  // 先按绝对分钟折算再夹到 0 起 —— 免得"第 1 天的 -30 分"退成第 1 天 23:30
  const total = Math.max(0, (day - 1) * MINUTES_PER_DAY + raw);
  return {
    day: Math.floor(total / MINUTES_PER_DAY) + 1,
    minute: total % MINUTES_PER_DAY,
  };
}

/** 绝对分钟数（用于算差值与倒计时），第 1 天 00:00 为 0 */
export function absoluteMinutes(c: StoryClock): number {
  return (c.day - 1) * MINUTES_PER_DAY + c.minute;
}

/** 从绝对分钟数还原成时刻（小于 0 一律夹到第 1 天 00:00） */
export function clockFromMinutes(total: number): StoryClock {
  return normalizeClock({ day: 1, minute: Math.max(0, Math.round(total)) });
}

/**
 * 推进时钟。`minutes` 可以是负数（剧情往回放，如"你又花了半小时折返"），
 * 但**结果永远不早于第 1 天 00:00**。
 */
export function advanceClock(c: StoryClock, minutes: number): StoryClock {
  return clockFromMinutes(absoluteMinutes(normalizeClock(c)) + Math.round(minutes || 0));
}

/** 两个时刻相差多少分钟（正数＝后者更晚） */
export function minutesBetween(a: StoryClock, b: StoryClock): number {
  return absoluteMinutes(b) - absoluteMinutes(a);
}

/** 时刻 → "第 3 天 傍晚"（界面与提示词用的人话） */
export function clockLabel(c: StoryClock): string {
  const n = normalizeClock(c);
  const phase = PHASES.find((p) => n.minute < p.until)?.label ?? '深夜';
  return `第 ${n.day} 天 · ${phase}`;
}

/** 时刻 → "第 3 天 18:40"（需要精确时用） */
export function clockDetail(c: StoryClock): string {
  const n = normalizeClock(c);
  const hh = String(Math.floor(n.minute / 60)).padStart(2, '0');
  const mm = String(n.minute % 60).padStart(2, '0');
  return `第 ${n.day} 天 ${hh}:${mm}`;
}

const CN_NUM: Record<string, number> = {
  一: 1, 两: 2, 二: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9, 十: 10,
  半: 0.5,
};

/** 把"三""两""15"这类量词转成数字；认不出返回 null */
function num(s: string | undefined): number | null {
  if (!s) return null;
  const t = s.trim();
  if (/^\d+(\.\d+)?$/.test(t)) return Number(t);
  if (CN_NUM[t] != null) return CN_NUM[t]!;
  // 十一 ~ 十九 / 二十 / 二十一
  const m = /^十([一二三四五六七八九])?$/.exec(t);
  if (m) return 10 + (m[1] ? (CN_NUM[m[1]] ?? 0) : 0);
  const m2 = /^([一二三四五六七八九])十([一二三四五六七八九])?$/.exec(t);
  if (m2) return (CN_NUM[m2[1] ?? '一'] ?? 1) * 10 + (m2[2] ? (CN_NUM[m2[2]] ?? 0) : 0);
  return null;
}

/*
 * 时间量的词表，顺序 = **匹配优先级**，与"从长到短"不完全是一回事：
 *
 *   - `周/星期/礼拜` 一定要先于 `天/日`：否则"两个星期"会被"星期"里的
 *     "期"绕过、被"日"抢走（"星期日"确实含"日"，但那不是 1 天）。
 *   - `小时/钟头` 一定要先于 `天/日`：否则"三个小时"会先撞上"时"后面的东西。
 *   - `天/日` 一定要先于 `分钟/分`：否则"三天"会被"分"?? 不会，但"半天"
 *     里的"天"必须比裸"分"先命中 —— 顺序上本表已保证。
 *
 * 一条纪律：**`分` 这个正则要放在最后**，且 `分钟` 必须写在 `分` 前面
 * （同一正则里 `分钟|分` 的交替顺序已保证左优先）。
 */
const UNITS: { re: RegExp; minutes: (n: number) => number }[] = [
  /*
   * ⚠️ `分钟` 必须排在所有含"钟"的量词**前面**。
   * 「分钟」和「钟头」共享那个"钟"字，谁先匹配谁赢：
   *   若"钟"先匹配 → "十分钟"被当成"10 钟"= 600 分钟（实测差 60 倍）。
   * 所以顺序是：分钟 → 钟头/小时 → 裸钟。
   */
  { re: /(分钟)/, minutes: (n) => n },
  { re: /(小时|钟头|钟)/, minutes: (n) => n * 60 },
  { re: /(周|星期|礼拜)/, minutes: (n) => n * 7 * MINUTES_PER_DAY },
  { re: /(天|日|夜|整天|整夜)/, minutes: (n) => n * MINUTES_PER_DAY },
  { re: /(分)/, minutes: (n) => n },
];

/**
 * 从"量词左边"和"量词右边"各抽一个数，**并把左侧那个尾巴上的"半"也算进去**。
 *
 * 为什么左右都要抽：中文的语序很活，
 *   - 数字在被量词前："三个小时""半小时"（左）
 *   - 数字跟进量词后："钟头两个" 少见，但确实存在（右）
 * 两侧都抽不着时按 1 算 —— **除了"几"**（见下）。
 *
 * ## "几"是个模糊数词，不能当 1（协作方第 18 版 P3-3）
 * 「几分钟」「几个小时」里的"几"是**约数**（三五之间），
 * 早先 `num('几')` 返回 null → 落到默认值 1，于是
 * 「等了几分钟」被算成**只过了 1 分钟**、「几个钟头」算成 1 小时 —— 时间推得太少，
 * 后面所有依赖时钟的东西（期限倒计时、伤口换药窗口）都会跟着偏。
 * 现在认成 **3**（主人裁的口径：`几`＝3）：偏短一点比偏长好，
 * 因为"几分钟"多数时候确实就是个位数。
 *
 * ## "半"的危险在这里
 * `半小时` 的"半"是**唯一的数词**（＝0.5），
 * `一个半钟头` 的"半"是**尾数**（＝1 + 0.5）。
 * 两者字面一样，只能靠"前面有没有数字"区分 —— 所以这个函数
 * **只负责把左侧整数抽出来**，那个"半"要不要补、补多少，
 * 由调用方按"左侧有没有抽到数字"决定（见 `parseElapsed` 里的两处判据）。
 *
 * `head` / `tail` 由调用方按**实际匹配长度**切好
 * （不能用 `at + 1` —— 量词可能是一到三个字，切错就会把"钟头"的"头"
 * 当成数字区，进而把"一个半钟头"算成 1 小时）。
 */
function pickNumber(head: string, tail: string): number {
  const before = /([一二两三四五六七八九十\d]+(?:\.\d+)?)\s*(?:个|整)?\s*$/.exec(head);
  const after = /^\s*(?:个)?\s*([一二两三四五六七八九十\d]+(?:\.\d+)?)/.exec(tail);
  const n = num(before?.[1]) ?? num(after?.[1]);
  if (n !== null) return n;
  // 「几」＝3（模糊约数，别塌成 1）
  if (VAGUE_FEW_RE.test(before?.[1] ?? '') || VAGUE_FEW_RE.test(after?.[1] ?? '')) return 3;
  // 「几」可能因为不在"数字区"而没被上面的正则捕获（如「等了有几分钟」），单独再看一眼
  if (VAGUE_FEW_RE.test(head) || VAGUE_FEW_RE.test(tail)) return 3;
  return 1;
}

/** 模糊数词：几（"十几"这种复合的由 `num` 或下面的单独判据兜住） */
const VAGUE_FEW_RE = /几/;

/** 左侧数字后是否还缀着一个"半"（`一个半钟头` / `一天半`） */
function trailingHalfInHead(head: string): boolean {
  return /[一二两三四五六七八九十\d]\s*(?:个)?\s*半\s*$/.test(head);
}

/**
 * 取"半"这个量 —— 单独一个函数，因为有两个地方要用它，
 * 且必须**在数字抽取阶段**就处理掉：
 * `半小时` / `半个钟头` / `一天半` / `一个半钟头` 里的"半"，
 * 交给后面的 `num()` 是取不出来的（`num('半')` 虽能给 0.5，
 * 但 `半小时` 的数字位置根本没有数字，`num` 会返回 null 然后落到默认值 1 ——
 * 于是"半小时"被算成"1 小时"）。
 */
function hasHalf(s: string | undefined): boolean {
  return !!s && /半/.test(s);
}

/**
 * 把守密人申报的"过了多久"折算成分钟。
 *
 * 认得的东西（都是它实际会写的说法）：
 *   - `"三个小时"` `"半小时"` `"2 小时"` `"一刻钟"` → 小时
 *   - `"一整夜"` `"一夜"` `"第二天"` `"三天"` → 天
 *   - `"十分钟"` `"一会儿"` `"片刻"` `"没多久"` → 分钟量级
 *   - `"一天半"` `"一个半钟头"` → 组合
 *
 * **认不出来时不拒绝**：退到 5 分钟（一个"没什么事发生"的最小推进）。
 * 为什么不退到 0：0 会让长篇的倒计时**永远不动**，那正是要修的毛病。
 */
export function parseElapsed(text: string | undefined | null): number {
  const raw = String(text ?? '').trim();
  if (!raw) return 0;

  // 一整夜 / 一宿 / 通宵 —— 常见且长度明确，先认掉
  if (/通宵|一整夜|整夜|一宿|到天亮/.test(raw)) return 8 * 60;
  if (/睡了一觉|睡了一夜|过夜/.test(raw)) return 8 * 60;
  if (/一整天|一天一夜/.test(raw)) return MINUTES_PER_DAY;
  if (/第二天|次日|隔天|翌日/.test(raw)) return MINUTES_PER_DAY;

  // 模糊的小量：一会儿、片刻、没多久 —— 中间值，别把叙事推得太多
  if (/一会儿|片刻|没多久|不久|略作|稍作|聊了?几句/.test(raw)) return 10;

  /*
   * "半天" 单独认 —— 必须排在单位循环**前面**。
   * 它不是"半天 = 半 + 天"的算法问题，而是语义问题：
   * 中文口语的"折腾了半天""大半天"指的**不是 12 小时**，
   * 而是一段"挺久但没准数"的时间，多半就是几个钟头。
   * 交给循环会先撞上 `天` 的量词、被算出 12 小时（甚至 24），
   * 与说话人的意思差一截。
   */
  if (/大半天|半天工夫/.test(raw)) return 6 * 60;
  if (/半天/.test(raw)) return 4 * 60;

  // 通用：数字 + 单位。取**优先级最高的那个单位**（词表顺序已排好）
  for (const u of UNITS) {
    const m = u.re.exec(raw);
    if (!m || m.index === undefined) continue;

    /*
     * 按**实际匹配长度**切，不能用 `at + 1`：
     * 量词可能是一到三个字（"分"/"分钟"/"钟头"/"礼拜"），
     * 切短了会把量词自己的后半截当成数字区，
     * 于是"一个半钟头"的"头"跑进 tail，`半` 判据落空 → 算成 1 小时。
     */
    const head = raw.slice(0, m.index);
    const tail = raw.slice(m.index + m[0].length);

    /*
     * "半"当数词：`半小时` / `半个钟头` / `半点钟`。
     * 判据收紧成两条同时成立：
     *   ① 量词左邻是"半"（中间只许夹"个/整"）；
     *   ② 再往左**没有数字** —— `一个半钟头` 里也有"半"，
     *      但那是 1 + 0.5 小时，不能整个塌成 0.5。
     */
    const halfAsNumber =
      /半\s*(?:个|整)?\s*$/.test(head) && !/[\d一二两三四五六七八九十]/.test(head);
    if (halfAsNumber) return Math.max(1, Math.round(u.minutes(0.5)));

    const n = pickNumber(head, tail);
    /*
     * "一天半" / "一个半钟头"：还欠半个单位。两种写法都要认 ——
     *   - 半在量词左边当尾数：`一个半 | 钟头`（head 尾巴上是"半"）
     *   - 半在量词右边：`一天 | 半`（tail 开头是"半"）
     * `一个半钟头` 左边抽出 1、head 判据补 0.5 → 90 分钟，正是要的效果。
     */
    const plusHalf = trailingHalfInHead(head) || /^(?:个|整)?\s*半/.test(tail);
    return Math.max(1, Math.round(u.minutes(n) + (plusHalf ? u.minutes(0.5) : 0)));
  }

  // 认不出来：给一个最小推进（5 分钟），而不是原地不动。与文件头 ② 的说法一致。
  return 5;
}

/**
 * 倒计时（`urgency` 的数字版）。
 *
 * 为什么单独存一个而不从 `urgency` 文本里解析：
 * 「雨季还有二十三天结束」这种天文数字，用正则去猜日期**一定会错**
 * （"二十三天"要转中文数字、还要判断是从哪天起算）。与其猜，不如让守密人
 * 在契约里**显式声明** `deadline_days`，引擎只负责减。
 */
export interface Deadline {
  /** 还剩多少分钟（引擎每轮按实际推进量减） */
  remain: number;
  /** 一句话说明这是什么的期限（如"雨季结束"），给玩家看 */
  label: string;
}

/**
 * 把期限折算成"还剩多少分钟"。
 * 只接受**天数**这一个尺度 —— 长篇用天、短篇用小时，都能被它表达。
 */
export function deadlineFromDays(days: number | undefined, label: string): Deadline | null {
  if (!Number.isFinite(days as number) || (days as number) <= 0) return null;
  return { remain: Math.round((days as number) * MINUTES_PER_DAY), label: label.trim() };
}

/** 倒计时 → 人话（"还剩 22 天" / "还剩 6 小时" / "只剩 40 分钟"） */
export function deadlineLabel(d: Deadline | undefined | null): string {
  if (!d || d.remain <= 0) return '';
  const days = Math.floor(d.remain / MINUTES_PER_DAY);
  if (days >= 1) {
    const rest = Math.floor((d.remain % MINUTES_PER_DAY) / 60);
    return rest > 0 && days <= 3 ? `还剩 ${days} 天 ${rest} 小时` : `还剩 ${days} 天`;
  }
  const hours = Math.floor(d.remain / 60);
  if (hours >= 1) return `还剩 ${hours} 小时`;
  return `只剩 ${Math.max(0, Math.round(d.remain))} 分钟`;
}

/**
 * 引擎侧的时钟推进：**一次推进做三件事**。
 *
 * 1. 时钟往前走（`elapsed` 折算出来的分钟）；
 * 2. 倒计时跟着减同样的分钟数；
 * 3. 跨天时告诉调用方"过去了几天"——用来做"日子一天天过去"的叙述回灌。
 *
 * 倒计时**减到 0 就停在 0**（不变成负数）：0 的含义是"期限到了"，
 * 至于是不是真的结束一局，那是守密人的 `ending` 说了算，引擎不越权替它收档。
 */
export function tickClock(
  clock: StoryClock,
  deadline: Deadline | null | undefined,
  elapsedText: string | undefined | null
): {
  clock: StoryClock;
  deadline: Deadline | null;
  elapsedMinutes: number;
  daysPassed: number;
  /** 界面上要不要提一句（变化太小就不吭声，免得每轮都刷） */
  noteworthy: boolean;
} {
  const before = normalizeClock(clock);
  const elapsedMinutes = parseElapsed(elapsedText);
  const after = advanceClock(before, elapsedMinutes);
  const nextDeadline: Deadline | null = deadline
    ? { ...deadline, remain: Math.max(0, deadline.remain - elapsedMinutes) }
    : null;
  // 注意：天数是按"绝对分钟差"算的，跨天才算，同一天内走动不算
  const daysPassed =
    Math.floor(absoluteMinutes(after) / MINUTES_PER_DAY) -
    Math.floor(absoluteMinutes(before) / MINUTES_PER_DAY);
  return {
    clock: after,
    deadline: nextDeadline,
    elapsedMinutes,
    daysPassed,
    // 走到下一个时段、或跨了天，才值得在界面上说一声
    noteworthy: daysPassed > 0 || phaseOf(before) !== phaseOf(after),
  };
}

/** 时刻属于哪个时段（跨时段才值得提示） */
export function phaseOf(c: StoryClock): string {
  const n = normalizeClock(c);
  return PHASES.find((p) => n.minute < p.until)?.label ?? '深夜';
}
