/**
 * M0 演示：不接模型，纯本地跑一次完整的"回合"
 * 运行：npm run demo
 */

import { createInitialState, applyDeltas, type GameState } from './core/state/gameState.js';
import { coc7 } from './core/rulesets/index.js';

const state: GameState = createInitialState({
  vitals: { hp: 12, san: 65, mp: 13 },
  inventory: [{ id: 'flashlight', name: '手电筒', qty: 1 }],
  flags: { basementUnlocked: false },
  clues: [],
  location: '米斯卡托尼克大学图书馆',
  npcsAlive: ['管理员汉克'],
});

console.log('=== 跑团模拟器 M0：核心引擎自检 ===\n');

// 1. 百分骰检定（带一颗奖励骰）
const { rollPercentile } = await import('./core/rulesets/coc7.js');
const pr = rollPercentile({ bonus: 1 });
const check = coc7.resolveCheck(pr.value, 55);

console.log('【检定】调查员「图书馆学 55%」，获得 1 颗奖励骰');
console.log(`  十位骰：${pr.tens.map((t) => String(t).padStart(2, '0')).join(' / ')}`);
console.log(`  个位骰：${pr.ones}  →  最终 ${pr.value}`);
console.log(`  判定：${check.label}（通过线 ${check.effectiveTarget}）\n`);

// 2. 模拟模型返回的 state_delta（注意：模型给的永远是"意图"，数值由本地算）
const modelDeltas = [
  { target: 'vitals.san', op: 'dec' as const, amount: '1d6', reason: '目睹非欧几何的浮雕' },
  { target: 'clues', op: 'add' as const, value: '浮雕上的星象图案与 1923 年的失踪案吻合' },
  { target: 'flags.basementUnlocked', op: 'set' as const, value: true },
  { target: 'vitals.gold', op: 'inc' as const, amount: 9999, reason: '模型瞎编的字段' },
];

const report = applyDeltas(state, modelDeltas, { ruleset: coc7 });

console.log('【状态回写】模型提交 4 条 delta');
for (const a of report.applied) {
  const amt = a.resolvedAmount !== undefined ? ` (掷出 ${a.resolvedAmount})` : '';
  console.log(`  ✓ ${a.delta.target} ${a.delta.op}${amt}  ${a.before} → ${a.after}`);
}
for (const r of report.rejected) {
  console.log(`  ✗ ${r.delta.target} 被拒绝：${r.reason}`);
}
console.log(`\n  理智值：${state.vitals.san} → ${report.state.vitals.san}`);
console.log(`  线索：${JSON.stringify(report.state.clues)}`);
console.log(`  原状态未被修改：${state.vitals.san === 65}\n`);

// 3. 骰子分布（给玩家看期望，也给开发者做公平性检验）
const { expectedValue, distribution } = await import('./core/dice/index.js');
console.log('【分布自检】');
console.log(`  1d6 期望 = ${expectedValue('1d6')}`);
console.log(`  2d6+1 期望 = ${expectedValue('2d6+1')}`);
const d = distribution('2d6');
console.log(`  2d6 组合总数 = ${[...d.values()].reduce((a, b) => a + b, 0)}，掷出 7 的组合数 = ${d.get(7)}`);

console.log('\n=== 地基就绪。下一步：编排层（提示词组装 + 上下文预算） ===');
