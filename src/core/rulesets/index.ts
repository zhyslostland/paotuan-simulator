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

/** 把 localStorage 里存的自定义规则包都注册进来（浏览器端启动时调用一次） */
export function loadCustomRulesets(): void {
  try {
    if (typeof localStorage === 'undefined') return;
    const raw = localStorage.getItem('trpg.customRulesets');
    if (!raw) return;
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
