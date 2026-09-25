/**
 * 图片数据的落盘判据（P2-3）。
 *
 * ## 为什么非要这一份
 * 生图接口有两种返回：**`b64_json`**（图就在响应体里，拿到即拥有）
 * 和 **`url`**（一个**临时**地址，服务商过一阵子就删）。
 *
 * 我们以前只管把那个字符串存下来 —— 结果战报导出里写着"图片已内嵌、本文件自包含"，
 * 打开的却是一排裂图；隔天回来看立绘，人也裂了。
 * 根因不是网络，是**把"链接"当成了"图"本身**。
 *
 * 所以规矩定死在代码里，而不是靠注释提醒：
 *
 * 1. **只有前三种形态才叫"我手里有这张图"**：data URI / blob / 同源 http。
 *    其余（跨源 http、相对路径）都可能是随时会消失的临时链接。
 * 2. **拿不准就落成"临时链接"**，并且**不许**再说"自包含 / 已内嵌"。
 *    说一句"这个链接 24 小时后可能失效"，比给玩家一个永远打不开的文件诚实。
 * 3. **能救则救**：拿到 url 时先试着 `fetch` 回来转成 data URI
 *    （同源 / 允许 CORS 就能成功）；失败不重试、不绕代理 —— 直接降级说实话。
 *
 * 纯函数、无 IO。真正的 `fetch` 与落盘在 `ui/store.ts`（core 不许有 IO）。
 */

/** 一张图**怎么来的**。决定导出时能不能说"自包含" */
export type ImageSource =
  /** 服务商直接给了 base64，图已经在手里 */
  | 'b64'
  /** 从链接抓回来了，转成 data URI */
  | 'fetched'
  /** 只有链接 —— 随时可能失效 */
  | 'url'
  /**
   * 旧数据：盘上存的字符串看不出出处。
   * 判据按**内容**给（data URI 就是自包含的），这个标记只用于旧数据统计。
   */
  | 'legacy';

/** 跨源 / 相对路径的图，默认按这个时长向玩家交代 */
export const REMOTE_LINK_HOURS = 24;

/** 「我手里真有这张图」的判据 —— 只有这些形态可离线打开 */
export function isSelfContainedImage(s: string): boolean {
  const v = (s ?? '').trim();
  if (!v) return false;
  if (/^data:image\//i.test(v)) return true;
  if (/^blob:/i.test(v)) return true;
  // 同源 http：下载/离线缓存能拿到。相对路径（'IMG' 这种）不算 ——
  // 我们自己的接口从来不发相对路径，出现它多半是别处的脏数据
  if (typeof window !== 'undefined' && v.startsWith(window.location.origin)) return true;
  if (/^(?:\/|\.\/|\.\.\/)[^\s]/i.test(v)) return true;
  return false;
}

/** 这条字符串看着像个会过期的远端链接吗 */
export function isRemoteLink(s: string): boolean {
  const v = (s ?? '').trim();
  return /^https?:\/\//i.test(v) && !isSelfContainedImage(v);
}

/**
 * 能不能把这条字符串**当图存下来**。
 *
 * 比 `isSelfContainedImage` 宽 —— 它允许 http 链接（那是正当的降级态：
 * 图今天看得见，只是过一阵会失效，导出侧会如实说明）。
 * 它拦的是"连今天都显示不出来"的东西：相对路径、纯文本。
 *
 * 这个分别很要紧：要是拿 `isSelfContainedImage` 当闸门，
 * 一次正常的降级就会被判成落盘失败 —— 把小问题放大成大问题。
 */
export function isStoreableImage(s: string): boolean {
  const v = (s ?? '').trim();
  if (!v) return false;
  if (isSelfContainedImage(v)) return true;
  if (/^https?:\/\//i.test(v)) return true;
  return false;
}

/**
 * 导出与界面共用的一句人话。**两种语气必须分得清**：
 * 全自包含 → 可以承诺"能离线打开"；有一张是链接 → 必须说清楚会失效。
 */
export function imageOriginNote(
  hasLinks: boolean,
  hours: number = REMOTE_LINK_HOURS
): string {
  return hasLinks
    ? `其中部分图片是服务商提供的临时链接（约 ${hours} 小时后可能失效）；如需长期保存，请重新生成一次。`
    : '图片已内嵌，单个文件即可保存或转发。';
}

/**
 * 一次生图调用拿回来的东西 —— 落盘前先归一化成这个。
 * `local` 为 null 时表示"没抓回来"，只有 `remote` 可用。
 */
export type ImageFetchResult =
  | { kind: 'self'; value: string }
  | { kind: 'remote'; value: string }
  | { kind: 'fail'; reason: string };

/**
 * 常见图片格式的**魔数**签名（文件头的头几个字节）。
 *
 * ## 为什么要靠它，而不是 `blob.type`（P2-3·必现）
 * 服务商返回的图**字节确实是 PNG**，但响应头给的是
 * `application/octet-stream`（对象存储的通病）。
 * 于是 `blob.type` 也就是 `application/octet-stream` →
 * 转出来的 data URI 是 `data:application/octet-stream;base64,...` →
 * `isSelfContainedImage` 不认（它只认 `data:image/`）→ 落盘闸门判 false → **图被静默丢掉**。
 *
 * 判据不能交给响应头 —— **字节在自己手里，自己看头几个字节最可靠**。
 */
const MAGIC_SIGS: { sig: number[]; mime: string }[] = [
  { sig: [0x89, 0x50, 0x4e, 0x47], mime: 'image/png' }, // ‰PNG
  { sig: [0xff, 0xd8, 0xff], mime: 'image/jpeg' }, // JPEG SOI
  { sig: [0x47, 0x49, 0x46, 0x38], mime: 'image/gif' }, // GIF8
  { sig: [0x52, 0x49, 0x46, 0x46], mime: 'image/webp' }, // RIFF…WEBP
];

/** 按魔数判断这是哪种图；认不出返回 `null` */
export function mimeFromBytes(bytes: Uint8Array | ArrayBuffer): string | null {
  const b = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  for (const m of MAGIC_SIGS) {
    if (b.length < m.sig.length) continue;
    let ok = true;
    for (let i = 0; i < m.sig.length; i++) {
      if (b[i] !== m.sig[i]!) {
        ok = false;
        break;
      }
    }
    if (!ok) continue;
    // `RIFF` 还得多看一眼：第 8–11 字节得是 `WEBP`（AVI 也是 RIFF 开头）
    if (m.mime === 'image/webp') {
      if (b.length < 12) continue;
      if (String.fromCharCode(...b.subarray(8, 12)) !== 'WEBP') continue;
    }
    return m.mime;
  }
  return null;
}

/**
 * 把一张图的二进制转成 data URI。
 *
 * MIME 的优先级：**魔数 > 传入的 `mime` > `image/png`**。
 * 兜底成 `image/png` 而不是留空：宁可标错格式（浏览器照样按内容渲染），
 * 也不留一个没有类型的 `data:;base64,...` —— 那种在一些阅读器里直接不显示。
 */
export function toDataUri(mime: string, bytes: Uint8Array | ArrayBuffer): string {
  const buf = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  let bin = '';
  // 分块拼接：一张 1024×1024 的图有几万个字节，逐个字符串相加会卡住主线程
  const CHUNK = 0x8000;
  for (let i = 0; i < buf.length; i += CHUNK) {
    bin += String.fromCharCode(...buf.subarray(i, i + CHUNK));
  }
  const byMagic = mimeFromBytes(buf);
  const given = (mime || '').split(';')[0]!.trim();
  const type = byMagic ?? (/^image\//i.test(given) ? given : 'image/png');
  return `data:${type};base64,${btoa(bin)}`;
}

/** 空间够不够存下这一张（IndexedDB 拿不到精确值，能拿到就判，拿不到就放行） */
export interface StorageEstimate {
  usage?: number;
  quota?: number;
}

/** 已经用了九成以上就别再往里塞了 —— 塞进去也是白崩一次 */
export const STORAGE_WARN_RATIO = 0.9;

export function storageTight(est: StorageEstimate | null | undefined): boolean {
  if (!est) return false;
  const { usage, quota } = est;
  if (!usage || !quota || quota <= 0) return false;
  return usage / quota >= STORAGE_WARN_RATIO;
}

/** 存不下时给玩家看的那句话（**必须提到"临时链接"**，否则玩家不知道为什么裂了） */
export const STORAGE_FULL_NOTE =
  '本地存储快满了，这张图只能留临时链接（可能失效）。清一些旧局或旧图片再试。';
