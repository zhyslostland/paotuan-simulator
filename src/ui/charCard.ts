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

/** 从 PNG 里提取角色卡；不是酒馆卡则返回 null */
export function extractCharacterCard(buf: ArrayBuffer): ImportedCharacter | null {
  const texts = parsePngTextChunks(buf);
  const raw = texts['ccv3'] ?? texts['chara']; // V3 优先，V2 其次
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw);
    const d = (parsed?.spec === 'chara_card_v3' ? parsed.data : parsed) ?? {};
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
