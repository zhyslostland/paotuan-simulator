/**
 * **玩家称呼占位符**（`{{称呼}}` / `{{name}}`）的填充。
 *
 * 从 `ui/store.ts` 搬出（E 档 E1b）。为什么单独成文件：它与持久化无关，
 * 是**渲染侧**的纯函数；但读档链路（`loaders.ts` 的 `sanitizeModuleTokens` /
 * `openingText`）要用它，不一起搬就会 store ↔ loaders 循环 import。
 *
 * 纯函数：无 IO、不碰 store。
 */

import type { CharacterProfile } from '../../core/types.js';


export const FEMALE_RE = /女|female|woman|girl|^f$/i;

/**
 * 从姓名 + 性别推一个得体的默认称呼。
 * 西式译名按"名字·姓氏"取最后一段作姓："艾伦·霍尔特" → "霍尔特先生"。
 * 单名直接用："卢卡斯" → "卢卡斯先生"。用户可随时手动改。
 */
export function deriveAddress(name: string, gender?: string): string {
  const honorific = FEMALE_RE.test((gender ?? '').trim()) ? '女士' : '先生';
  const n = name.trim();
  if (!n) return honorific;
  const parts = n.split(/[·・.\s]+/).filter(Boolean);
  const surname = parts.length > 1 ? parts[parts.length - 1]! : n;
  return `${surname}${honorific}`;
}

/** 取角色的称呼：优先用用户自定义的，没有就从姓名 + 性别推导 */
export function addressOf(c: CharacterProfile): string {
  return c.address?.trim() || deriveAddress(c.name, c.gender);
}

/**
 * 把模组/模型文本里残留的占位符替换成真实值。
 *
 * 为什么需要：模组开场白支持 `{{称呼}}` 占位符，但模型有时会把它**漏到状态里**
 * （用户报过"当前地点：{{称呼}}的公寓房间"）。凡是模型产出的文本进入
 * 显示或状态之前，都要过一遍这里。
 */
export function fillPlayerTokens(text: string, c: CharacterProfile): string {
  if (!text || !text.includes('{{')) return text;
  return text
    .replace(/\{\{\s*称呼\s*\}\}/g, addressOf(c))
    .replace(/\{\{\s*(name|玩家名|姓名|char)\s*\}\}/gi, c.name);
}
