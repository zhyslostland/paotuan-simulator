/**
 * 图片落地的判据（P2-3）。
 *
 * 这一份守的是一个**曾经撒谎的地方**：战报导出写死"图片已内嵌、本文件自包含"，
 * 可服务商给的 url 是临时的 —— 玩家转发出去，别人打开是一排裂图。
 *
 * 所以判据只有一句：**"我手里真有这张图"和"我只有一个链接"不能混为一谈。**
 */
import { describe, expect, it } from 'vitest';
import {
  imageOriginNote,
  isRemoteLink,
  isSelfContainedImage,
  isStoreableImage,
  REMOTE_LINK_HOURS,
  toDataUri,
  mimeFromBytes,
  STORAGE_WARN_RATIO,
  storageTight,
} from '../src/core/imageData.js';

describe('自包含判据：data URI / blob / 同源 http 才算真有图', () => {
  it('data URI 是自包含的（生图接口要来的 base64 走这条）', () => {
    expect(isSelfContainedImage('data:image/png;base64,AAAA')).toBe(true);
    expect(isSelfContainedImage('data:image/jpeg;base64,/9j/4AAQ')).toBe(true);
  });

  it('blob: 是自包含的', () => {
    expect(isSelfContainedImage('blob:https://x/y')).toBe(true);
  });

  it('跨源 http 链接**不算** —— 这正是会失效的那种', () => {
    expect(isSelfContainedImage('https://cdn.example.com/a.png')).toBe(false);
    expect(isSelfContainedImage('http://img.example.com/a.png')).toBe(false);
  });

  it('空串 / 非图片 data URI 不算', () => {
    expect(isSelfContainedImage('')).toBe(false);
    expect(isSelfContainedImage('   ')).toBe(false);
    expect(isSelfContainedImage('data:text/plain;base64,AAAA')).toBe(false);
  });

  it('isRemoteLink 只认跨源 http（同源与 data 都不算链接）', () => {
    expect(isRemoteLink('https://cdn.example.com/a.png')).toBe(true);
    expect(isRemoteLink('data:image/png;base64,AA')).toBe(false);
  });
});

describe('落闸：拦"根本不像图"的，放"降级态"的', () => {
  it('http 链接**可以**落 —— 抓不回来是正当降级，不是失败', () => {
    // 这条最要紧：拿 isSelfContainedImage 当闸门会把正常降级判成落盘失败
    expect(isStoreableImage('https://cdn.example.com/a.png')).toBe(true);
  });

  it('data URI / blob 当然可以落', () => {
    expect(isStoreableImage('data:image/png;base64,AA')).toBe(true);
    expect(isStoreableImage('blob:https://x/y')).toBe(true);
  });

  it('落闸：跟"自包含"不是一回事', () => {
    // 大写无协议的串是真脏数据
    expect(isStoreableImage('IMG')).toBe(false);
    expect(isStoreableImage('')).toBe(false);
    // 但有协议/有路径的那些都能落
    expect(isStoreableImage('https://cdn.example.com/a.png')).toBe(true);
    expect(isStoreableImage('/a.png')).toBe(true);
    expect(isStoreableImage('./a.png')).toBe(true);
  });
});

describe('交代话必须跟着事实走', () => {
  it('全是自包含 → 可以说"已内嵌、能转发"', () => {
    const s = imageOriginNote(false);
    expect(s).toContain('已内嵌');
    expect(s).not.toContain('失效');
  });

  it('有一张是链接 → **必须**说它会失效，且不许再说"已内嵌"', () => {
    const s = imageOriginNote(true);
    expect(s).toContain(`${REMOTE_LINK_HOURS}`);
    expect(s).toContain('失效');
    expect(s).not.toContain('已内嵌');
  });
});

describe('二进制转 data URI', () => {
  it('按 mime 写进前缀', () => {
    const uri = toDataUri('image/webp', new Uint8Array([1, 2, 3]));
    expect(uri.startsWith('data:image/webp;base64,')).toBe(true);
  });

  it('mime 缺失 / 带参数时退回 png 并去掉参数部分', () => {
    expect(toDataUri('', new Uint8Array([1])).startsWith('data:image/png;base64,')).toBe(true);
    expect(toDataUri('image/png; charset=x', new Uint8Array([1]))).toBe(
      'data:image/png;base64,AQ=='
    );
  });

  it('长内容不丢字节（分块拼接那段）', () => {
    // 8 万字节跨过拼接的块边界，解出来必须一模一样
    const bytes = new Uint8Array(80000).map((_, i) => i % 256);
    const uri = toDataUri('image/png', bytes);
    const b64 = uri.split(',')[1]!;
    const back = Buffer.from(b64, 'base64');
    expect(back.length).toBe(bytes.length);
    expect(back[0]).toBe(0);
    expect(back[79999]).toBe(79999 % 256);
  });
});

describe('空间告警的判据', () => {
  it('用了九成以上才叫紧（拿不到配额就不拦）', () => {
    expect(storageTight({ usage: 100, quota: 100 })).toBe(true);
    expect(storageTight({ usage: 89, quota: 100 })).toBe(false);
    expect(storageTight(null)).toBe(false);
    expect(storageTight({})).toBe(false);
    expect(storageTight({ usage: 0, quota: 0 })).toBe(false);
  });

  it('阈值本身是个明数（改它要过这一条）', () => {
    expect(STORAGE_WARN_RATIO).toBe(0.9);
  });
});

/*
 * P2-3·必现（协作方第 22 版）：**图根本落不下**。
 *
 * 服务商返回的字节确实是 PNG，但响应头给 `application/octet-stream`
 * （对象存储的通病）→ `blob.type` 也就是 octet-stream →
 * 转出来的 data URI 是 `data:application/octet-stream;base64,...` →
 * `isSelfContainedImage` 不认（只认 `data:image/`）→ 落盘闸门判 false → **图被静默丢掉**。
 *
 * 修法：**按魔数定 MIME** —— 字节在自己手里，不信响应头。
 */
describe('按魔数定 MIME（P2-3·必现）', () => {
  const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3]);
  const JPEG = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10]);
  const GIF = new Uint8Array([0x47, 0x49, 0x46, 0x38, 0x39, 0x61]);
  // 'RIFF' + 4 字节长度 + 'WEBP'
  const WEBP = new Uint8Array([0x52, 0x49, 0x46, 0x46, 0, 0, 0, 0, 0x57, 0x45, 0x42, 0x50]);
  // 也是 RIFF 开头，但不是 WEBP（AVI 同理）—— 不许误判
  const AVI = new Uint8Array([0x52, 0x49, 0x46, 0x46, 0, 0, 0, 0, 0x41, 0x56, 0x49, 0x20]);

  it('四种格式都认得出来', () => {
    expect(mimeFromBytes(PNG)).toBe('image/png');
    expect(mimeFromBytes(JPEG)).toBe('image/jpeg');
    expect(mimeFromBytes(GIF)).toBe('image/gif');
    expect(mimeFromBytes(WEBP)).toBe('image/webp');
  });

  it('认不出就返回 null（别瞎猜）', () => {
    expect(mimeFromBytes(new Uint8Array([1, 2, 3, 4, 5]))).toBeNull();
    expect(mimeFromBytes(new Uint8Array([]))).toBeNull();
  });

  it('RIFF 但不是 WEBP → 不算 webp（AVI 也是 RIFF 开头）', () => {
    expect(mimeFromBytes(AVI)).toBeNull();
  });

  it('字节不够长时不越界', () => {
    expect(mimeFromBytes(new Uint8Array([0x89, 0x50]))).toBeNull();
  });

  /*
   * 🔴 回归断言（协作方点名要的这一条）：
   * 头是 octet-stream、字节是 PNG 时，必须落成 `data:image/png`。
   * 这条一红，就意味着"图又落不下了"。
   */
  it('🔴 响应头是 application/octet-stream 的 PNG → 仍然落成 data:image/png', () => {
    const uri = toDataUri('application/octet-stream', PNG);
    expect(uri.startsWith('data:image/png;base64,')).toBe(true);
    // 而且它必须过得了"自包含"与"落盘"两道判据 —— 否则等于白修
    expect(isSelfContainedImage(uri)).toBe(true);
    expect(isStoreableImage(uri)).toBe(true);
  });

  it('魔数**优先于**传入的 mime（字节说了算）', () => {
    // 嘴上说是 jpeg，字节明明是 PNG → 听字节的
    expect(toDataUri('image/jpeg', PNG).startsWith('data:image/png;base64,')).toBe(true);
  });

  it('认不出魔数时：传入的是 image/* 就沿用，否则兜底 png', () => {
    const junk = new Uint8Array([1, 2, 3, 4, 5]);
    expect(toDataUri('image/webp', junk).startsWith('data:image/webp;base64,')).toBe(true);
    expect(toDataUri('application/octet-stream', junk).startsWith('data:image/png;base64,')).toBe(
      true
    );
  });

  it('魔数认出的 WEBP 不会被 RIFF 之外的东西误伤', () => {
    expect(toDataUri('application/octet-stream', WEBP).startsWith('data:image/webp;base64,')).toBe(
      true
    );
  });
});
