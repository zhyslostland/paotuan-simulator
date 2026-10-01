/**
 * 酒馆角色卡（SillyTavern Character Card V2/V3）导入
 *
 * 角色卡规范是把 JSON 嵌进 PNG 的 tEXt 数据块里：
 * - V2：关键字 "chara"，值是扁平的字段对象
 * - V3：关键字 "ccv3"，值是 { spec: "chara_card_v3", data: {...} }
 * 兼容它们就等于白捡现成卡库（几千张现成卡）。
 */

export interface ImportedCharacter {
  name: string;
  gender?: string;
  description: string;
  personality: string;
  mes_example: string;
}

/** 解析 PNG 的 tEXt 数据块，返回「关键字 → 文本」 */
function parsePngTextChunks(buf: ArrayBuffer): Record<string, string> {
  const bytes = new Uint8Array(buf);
  // PNG 固定签名 89 50 4E 47 0D 0A 1A 0A
  const sig = [137, 80, 78, 71, 13, 10, 26, 10];
  for (let i = 0; i < 8; i++) if (bytes[i] !== sig[i]) return {};

  const texts: Record<string, string> = {};
  const view = new DataView(buf);
  let offset = 8;
  while (offset + 8 <= bytes.length) {
    const length = view.getUint32(offset);
    const type = String.fromCharCode(
      bytes[offset + 4]!,
      bytes[offset + 5]!,
      bytes[offset + 6]!,
      bytes[offset + 7]!
    );
    const dataStart = offset + 8;
    if (dataStart + length > bytes.length) break;
    if (type === 'tEXt') {
      const data = bytes.subarray(dataStart, dataStart + length);
      const nul = data.indexOf(0);
      if (nul > 0) {
        const keyword = String.fromCharCode(...data.subarray(0, nul));
        const text = String.fromCharCode(...data.subarray(nul + 1));
        texts[keyword] = text;
      }
    }
    offset = dataStart + length + 4; // 跳过 CRC
  }
  return texts;
}

/** base64 → UTF-8 字符串；不是合法 base64 时返回 null */
function decodeBase64Utf8(b64: string): string | null {
  try {
    const bin = atob(b64.replace(/\s+/g, ''));
    const bytes = Uint8Array.from(bin, (c) => c.charCodeAt(0));
    return new TextDecoder().decode(bytes);
  } catch {
    return null;
  }
}

/**
 * 🔴 `P2-13`：酒馆卡的 `chara` / `ccv3` 里装的是 **base64 的 JSON**（V2 起的惯例），
 * 直接 `JSON.parse` 必失败 —— 玩家导入一张标准卡，只会得到"读不出角色信息"。
 * 先按 base64 解（顺带还原 UTF-8），解不出来再当明文试（也有卡直接塞 JSON 文本）。
 */
export function decodeCardPayload(raw: string): string | null {
  const t = raw.trim();
  if (!t) return null;
  if (t.startsWith('{') || t.startsWith('[')) return t;
  const decoded = decodeBase64Utf8(t)?.trim();
  if (decoded && (decoded.startsWith('{') || decoded.startsWith('['))) return decoded;
  return t;
}

/** 从 PNG 里提取角色卡；不是酒馆卡则返回 null */
export function extractCharacterCard(buf: ArrayBuffer): ImportedCharacter | null {
  const texts = parsePngTextChunks(buf);
  const raw = texts['ccv3'] ?? texts['chara']; // V3 优先，V2 其次
  if (!raw) return null;
  const payload = decodeCardPayload(raw);
  if (!payload) return null;
  try {
    const parsed = JSON.parse(payload);
    // V3 卡把字段包在 `data` 层；有 `data` 就取它（比认 `spec` 字符串稳）
    const d = (parsed?.data && typeof parsed.data === 'object' ? parsed.data : parsed) ?? {};
    if (!d || typeof d.name !== 'string' || !d.name.trim()) return null;
    return {
      name: d.name.trim(),
      gender: typeof d.gender === 'string' ? d.gender : undefined,
      description: typeof d.description === 'string' ? d.description : '',
      personality: typeof d.personality === 'string' ? d.personality : '',
      mes_example: typeof d.mes_example === 'string' ? d.mes_example : '',
    };
  } catch {
    return null;
  }
}
