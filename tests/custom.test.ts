import { describe, expect, it } from 'vitest';
import { createCustomRuleset } from '../src/core/rulesets/index.js';

describe('自定义规则包（自由预设）', () => {
  const base = {
    id: 'custom-test',
    name: '测试房规',
    mainDice: '1d100',
    mode: 'under' as const,
    characteristics: [{ key: '力量', label: '力量', default: 50 }],
    skills: [{ name: '侦查', base: 20 }],
    vitals: [{ key: '生命', label: '生命', default: 12 }],
  };

  it('under 模式：点数 ≤ 目标值成功', () => {
    const rs = createCustomRuleset(base);
    expect(rs.mainDice).toBe('1d100');
    expect(rs.resolveCheck(50, 60).success).toBe(true);
    expect(rs.resolveCheck(61, 60).success).toBe(false);
    expect(rs.resolveCheck(1, 60).tier).toBe('critical');
  });

  it('over 模式：点数 + 加值 ≥ DC 成功', () => {
    const rs = createCustomRuleset({ ...base, mainDice: '1d20', mode: 'over' });
    expect(rs.resolveCheck(10, 0, 'regular').success).toBe(true);
    expect(rs.resolveCheck(9, 0, 'regular').success).toBe(false);
    expect(rs.resolveCheck(20, 0).tier).toBe('critical');
  });

  it('数值条由默认值派生', () => {
    const rs = createCustomRuleset(base);
    expect(rs.deriveVitals({})).toEqual({ 生命: 12 });
  });
});
