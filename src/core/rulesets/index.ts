import { coc7 } from './coc7.js';
import { dnd5e } from './dnd5e.js';
import { createCustomRuleset, type CustomRulesetConfig } from './custom.js';
import type { Ruleset } from './types.js';

const registry = new Map<string, Ruleset>([
  [coc7.id, coc7],
  [dnd5e.id, dnd5e],
]);

export function registerRuleset(ruleset: Ruleset): void {
  registry.set(ruleset.id, ruleset);
}

export function getRuleset(id: string): Ruleset {
  const rs = registry.get(id);
  if (!rs) throw new Error(`未注册的规则包：${id}（已注册：${[...registry.keys()].join(', ')}）`);
  return rs;
}

export function listRulesets(): Ruleset[] {
  return [...registry.values()];
}

/** 内置规则包：能选能换，**不能删** */
const BUILTIN_RULESET_IDS: readonly string[] = [coc7.id, dnd5e.id];

export function isBuiltinRuleset(id: string): boolean {
  return BUILTIN_RULESET_IDS.includes(id);
}

/** 注册一个自定义规则包（第三方自由预设） */
export function registerCustomRuleset(cfg: CustomRulesetConfig): Ruleset {
  const rs = createCustomRuleset(cfg);
  registry.set(rs.id, rs);
  return rs;
}

/**
 * 注销一个自定义规则包 —— **能建就该能删**（协作方第 14 版 §1③）。
 *
 * 以前 `registerCustomRuleset` 是单向的：设置页里能建、能选，**删不掉**，
 * 建错的规则包只能一直挂在列表里。这与"自建题材能删"是对称的两件事。
 *
 * 只动内存里的注册表：localStorage 那份由 UI 层自己写（core 不许有 IO）。
 */
export function unregisterCustomRuleset(id: string): boolean {
  if (isBuiltinRuleset(id)) return false; // 内置的不许删
  if (!registry.has(id)) return false;
  registry.delete(id);
  return true;
}

/**
 * 把一份**原始 JSON 串**里的自定义规则包都注册进来。
 *
 * ## 为什么参数是字符串，而不是自己去读 localStorage
 *
 * 2026-09-30 架构体检：这个函数原来自己在 core 里调 `localStorage.getItem`
 * —— 而同一个文件的 `:45` 还写着「**core 不许有 IO**」。铁律只写在注释里，
 * 编译器看不见，于是它就一直这么活着（体检报告 §3 · S4）。
 *
 * 现在把**读盘**那一半交回 UI 层（`ui/store.ts` 启动时读一次），core 只做
 * **纯解析 + 注册**：没有 IO、没有全局对象、可以脱离浏览器单测。
 * `scripts/check-contract.mjs` 的边界闸门会盯着这件事，写回去就红。
 *
 * 损坏的 JSON / 非法条目一律忽略（自定义规则包坏掉不该让游戏起不来）。
 */
export function registerCustomRulesetsFrom(raw: string | null): void {
  if (!raw) return;
  try {
    const list = JSON.parse(raw) as CustomRulesetConfig[];
    for (const cfg of list) {
      if (cfg && cfg.id && cfg.name) registerCustomRuleset(cfg);
    }
  } catch {
    /* 损坏的自定义规则忽略 */
  }
}

export { coc7, rollPercentile, resolveCocCheck, type PercentileRoll } from './coc7.js';
export { dnd5e, dndModifier, resolveDndCheck } from './dnd5e.js';
export {
  createCustomRuleset,
  parseStatusLines,
  parseWeaponLines,
  type CustomRulesetConfig,
} from './custom.js';
export * from './types.js';
