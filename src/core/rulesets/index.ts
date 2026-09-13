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

/** 注册一个自定义规则包（第三方自由预设） */
export function registerCustomRuleset(cfg: CustomRulesetConfig): Ruleset {
  const rs = createCustomRuleset(cfg);
  registry.set(rs.id, rs);
  return rs;
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
export { createCustomRuleset, type CustomRulesetConfig } from './custom.js';
export * from './types.js';
