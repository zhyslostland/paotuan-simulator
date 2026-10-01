/**
 * 酒馆卡导入（PNG 里的 `chara` / `ccv3` text chunk）。
 *
 * 🔴 `P2-13`（协28 §F① 第 17 条）：这两个 chunk 里装的是 **base64 的 JSON**（V2 起的惯例）。
 * 以前直接 `JSON.parse(raw)` → 标准卡一律解析失败 → 玩家得到的是"读不出角色信息"。
 */
import { describe, expect, it } from 'vitest';
import { decodeCardPayload } from '../src/ui/charCard.js';

const CARD = { name: '测试员', description: '记者', personality: '较真', mes_example: '' };

describe('P2-13：酒馆卡 payload 先按 base64 解', () => {
  it('🔴 base64（标准写法）能解出 JSON', () => {
    const b64 = Buffer.from(JSON.stringify(CARD), 'utf8').toString('base64');
    const out = decodeCardPayload(b64);
    expect(out && JSON.parse(out).name).toBe('测试员');
  });

  it('中文经 base64 往返不坏（别按 latin1 解）', () => {
    const b64 = Buffer.from(JSON.stringify({ name: '张三·夜巡人' }), 'utf8').toString('base64');
    const out = decodeCardPayload(b64);
    expect(out && JSON.parse(out).name).toBe('张三·夜巡人');
  });

  it('明文 JSON 照旧认（也有卡直接塞文本）', () => {
    const out = decodeCardPayload(`  ${JSON.stringify(CARD)}`);
    expect(out && JSON.parse(out).name).toBe('测试员');
  });

  it('空串返回 null（调用方据此判定"这不是酒馆卡"）', () => {
    expect(decodeCardPayload('')).toBeNull();
  });
});
