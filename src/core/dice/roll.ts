/**
 * 骰子求值器
 *
 * 铁律：所有随机数都在这里产生，且 RNG 可注入。
 * 模型永远不参与随机数的生成 —— 这是防止数值漂移的第一道防线。
 */

import { parseDice, stringifyAst, type Ast } from './parse.js';

export type Rng = () => number;

/** 可复现的伪随机数发生器，用于测试与"重掷/回溯"场景 */
export function seededRng(seed: number): Rng {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export interface DieGroup {
  count: number;
  sides: number;
  results: number[];
  sum: number;
}

export interface RollOutcome {
  /** 规范化后的表达式 */
  expression: string;
  /** 原始输入 */
  source: string;
  total: number;
  /** 按出现顺序记录的每一组骰子，便于做骰点动画与审计 */
  groups: DieGroup[];
}

function collect(ast: Ast, rng: Rng, groups: DieGroup[]): number {
  switch (ast.type) {
    case 'num':
      return ast.value;

    case 'dice': {
      const results: number[] = [];
      let sum = 0;
      for (let i = 0; i < ast.count; i++) {
        const r = 1 + Math.floor(rng() * ast.sides);
        results.push(r);
        sum += r;
      }
      groups.push({ count: ast.count, sides: ast.sides, results, sum });
      return sum;
    }

    case 'neg':
      return -collect(ast.operand, rng, groups);

    case 'bin': {
      const l = collect(ast.left, rng, groups);
      const r = collect(ast.right, rng, groups);
      switch (ast.op) {
        case '+':
          return l + r;
        case '-':
          return l - r;
        case '*':
          return l * r;
        case '/':
          if (r === 0) return 0;
          // TRPG 惯例：除法向下取整
          return Math.floor(l / r);
      }
    }
  }
}

/** 掷一个表达式。rng 省略时用 Math.random。 */
export function roll(expression: string, rng: Rng = Math.random): RollOutcome {
  const ast = parseDice(expression);
  const groups: DieGroup[] = [];
  const total = collect(ast, rng, groups);
  return { expression: stringifyAst(ast), source: expression, total, groups };
}

/** 掷一个已解析的 AST */
export function rollAst(ast: Ast, rng: Rng = Math.random): RollOutcome {
  const groups: DieGroup[] = [];
  const total = collect(ast, rng, groups);
  return { expression: stringifyAst(ast), source: stringifyAst(ast), total, groups };
}

/**
 * 枚举表达式的完整概率分布：value -> 出现次数（组合数）
 * 用于骰子公平性检验、期望值计算、以及给玩家展示"这一刀期望多少伤害"。
 */
export function distribution(expression: string): Map<number, number> {
  return distributionAst(parseDice(expression));
}

const MAX_COMBINATIONS = 5_000_000;

export function distributionAst(ast: Ast): Map<number, number> {
  const [dist, combos] = enumerate(ast);
  if (combos > MAX_COMBINATIONS) {
    throw new Error(
      `分布规模过大（${combos} 种组合，上限 ${MAX_COMBINATIONS}），无法完整枚举`
    );
  }
  return dist;
}

function enumerate(ast: Ast): [Map<number, number>, number] {
  switch (ast.type) {
    case 'num':
      return [new Map([[ast.value, 1]]), 1];

    case 'dice': {
      let dist = new Map<number, number>();
      for (let v = 1; v <= ast.sides; v++) dist.set(v, 1);
      let combos = ast.sides;
      for (let i = 1; i < ast.count; i++) {
        dist = convolve(dist, dist);
        combos *= ast.sides;
        if (combos > MAX_COMBINATIONS) break;
      }
      return [dist, combos];
    }

    case 'neg': {
      const [inner, combos] = enumerate(ast.operand);
      const out = new Map<number, number>();
      for (const [v, n] of inner) out.set(-v, n);
      return [out, combos];
    }

    case 'bin': {
      const [ld, lc] = enumerate(ast.left);
      const [rd, rc] = enumerate(ast.right);
      const out = new Map<number, number>();
      for (const [lv, ln] of ld) {
        for (const [rv, rn] of rd) {
          let v: number;
          switch (ast.op) {
            case '+':
              v = lv + rv;
              break;
            case '-':
              v = lv - rv;
              break;
            case '*':
              v = lv * rv;
              break;
            case '/':
              v = rv === 0 ? 0 : Math.floor(lv / rv);
              break;
          }
          out.set(v, (out.get(v) ?? 0) + ln * rn);
        }
      }
      return [out, lc * rc];
    }
  }
}

function convolve(a: Map<number, number>, b: Map<number, number>): Map<number, number> {
  const out = new Map<number, number>();
  for (const [av, an] of a) {
    for (const [bv, bn] of b) {
      out.set(av + bv, (out.get(av + bv) ?? 0) + an * bn);
    }
  }
  return out;
}

/** 期望值 */
export function expectedValue(expression: string): number {
  const dist = distribution(expression);
  let sum = 0;
  let total = 0;
  for (const [v, n] of dist) {
    sum += v * n;
    total += n;
  }
  return total === 0 ? 0 : sum / total;
}
