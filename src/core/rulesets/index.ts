import { coc7 } from './coc7.js';
import type { Ruleset } from './types.js';

const registry = new Map<string, Ruleset>([[coc7.id, coc7]]);

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

export { coc7, rollPercentile, resolveCocCheck, type PercentileRoll } from './coc7.js';
export * from './types.js';
