/**
 * 骰子表达式 AST 与解析器
 *
 * 支持语法：
 *   2d6        NdM（N 可省略，默认 1）
 *   d%         等价于 1d100
 *   2d6+3      加减
 *   3d6*5      乘除
 *   (1d4+1)*2  括号
 *   -1d6       单目负号
 *
 * 设计约束：纯函数、无 IO、无随机数。随机性由 roll.ts 注入。
 */

export type Ast =
  | { type: 'num'; value: number }
  | { type: 'dice'; count: number; sides: number }
  | { type: 'bin'; op: '+' | '-' | '*' | '/'; left: Ast; right: Ast }
  | { type: 'neg'; operand: Ast };

type Token =
  | { kind: 'num'; value: number }
  | { kind: 'd' }
  | { kind: 'op'; value: '+' | '-' | '*' | '/' }
  | { kind: 'lparen' }
  | { kind: 'rparen' };

export class DiceParseError extends Error {
  constructor(message: string, readonly source: string) {
    super(`${message}（表达式：${source}）`);
    this.name = 'DiceParseError';
  }
}

/** 单颗骰子上限，防止 1d99999999 之类的输入把内存打爆 */
export const MAX_SIDES = 1_000_000;
export const MAX_COUNT = 1_000;

function tokenize(src: string): Token[] {
  const s = src.replace(/\s+/g, '').toLowerCase();
  const tokens: Token[] = [];
  let i = 0;

  while (i < s.length) {
    const ch = s[i]!;

    if (ch >= '0' && ch <= '9') {
      let j = i;
      while (j < s.length && s[j]! >= '0' && s[j]! <= '9') j++;
      tokens.push({ kind: 'num', value: Number(s.slice(i, j)) });
      i = j;
      continue;
    }

    if (ch === 'd') {
      // d% => 1d100
      if (s[i + 1] === '%') {
        tokens.push({ kind: 'd' });
        tokens.push({ kind: 'num', value: 100 });
        i += 2;
        continue;
      }
      tokens.push({ kind: 'd' });
      i++;
      continue;
    }

    if (ch === '+' || ch === '-' || ch === '*' || ch === '/') {
      tokens.push({ kind: 'op', value: ch });
      i++;
      continue;
    }

    if (ch === '(') {
      tokens.push({ kind: 'lparen' });
      i++;
      continue;
    }
    if (ch === ')') {
      tokens.push({ kind: 'rparen' });
      i++;
      continue;
    }

    throw new DiceParseError(`无法识别的字符 "${ch}"`, src);
  }

  return tokens;
}

export function parseDice(src: string): Ast {
  const tokens = tokenize(src);
  if (tokens.length === 0) throw new DiceParseError('表达式为空', src);

  let pos = 0;
  const peek = (): Token | undefined => tokens[pos];
  const next = (): Token => {
    const t = tokens[pos++];
    if (!t) throw new DiceParseError('表达式意外结束', src);
    return t;
  };

  function parseExpr(): Ast {
    let left = parseTerm();
    for (;;) {
      const t = peek();
      if (t?.kind === 'op' && (t.value === '+' || t.value === '-')) {
        next();
        left = { type: 'bin', op: t.value, left, right: parseTerm() };
      } else break;
    }
    return left;
  }

  function parseTerm(): Ast {
    let left = parseUnary();
    for (;;) {
      const t = peek();
      if (t?.kind === 'op' && (t.value === '*' || t.value === '/')) {
        next();
        left = { type: 'bin', op: t.value, left, right: parseUnary() };
      } else break;
    }
    return left;
  }

  function parseUnary(): Ast {
    const t = peek();
    if (t?.kind === 'op' && (t.value === '-' || t.value === '+')) {
      next();
      const operand = parseUnary();
      return t.value === '-' ? { type: 'neg', operand } : operand;
    }
    return parsePrimary();
  }

  function parsePrimary(): Ast {
    const t = next();

    if (t.kind === 'lparen') {
      const inner = parseExpr();
      const close = next();
      if (close.kind !== 'rparen') throw new DiceParseError('括号未闭合', src);
      return inner;
    }

    if (t.kind === 'num') {
      // 数字后面紧跟 d => 这是骰子颗数
      const after = peek();
      if (after?.kind === 'd') {
        next();
        const sidesTok = next();
        if (sidesTok.kind !== 'num') throw new DiceParseError('骰子面数缺失', src);
        validate(t.value, sidesTok.value, src);
        return { type: 'dice', count: t.value, sides: sidesTok.value };
      }
      return { type: 'num', value: t.value };
    }

    if (t.kind === 'd') {
      // 裸 d20 => 1d20
      const sidesTok = next();
      if (sidesTok.kind !== 'num') throw new DiceParseError('骰子面数缺失', src);
      validate(1, sidesTok.value, src);
      return { type: 'dice', count: 1, sides: sidesTok.value };
    }

    throw new DiceParseError('语法错误', src);
  }

  const ast = parseExpr();
  if (pos < tokens.length) throw new DiceParseError('表达式尾部有多余内容', src);
  return ast;
}

function validate(count: number, sides: number, src: string): void {
  if (sides < 1) throw new DiceParseError(`骰子面数必须 >= 1，收到 ${sides}`, src);
  if (count < 0) throw new DiceParseError('骰子颗数不能为负', src);
  if (sides > MAX_SIDES) throw new DiceParseError(`骰子面数超过上限 ${MAX_SIDES}`, src);
  if (count > MAX_COUNT) throw new DiceParseError(`骰子颗数超过上限 ${MAX_COUNT}`, src);
}

/** 把 AST 还原成规范化的表达式字符串，便于日志与回显 */
export function stringifyAst(ast: Ast): string {
  switch (ast.type) {
    case 'num':
      return String(ast.value);
    case 'dice':
      return `${ast.count}d${ast.sides}`;
    case 'neg':
      return `-${stringifyAst(ast.operand)}`;
    case 'bin': {
      const wrap = (child: Ast, needParen: boolean) => {
        const s = stringifyAst(child);
        return needParen ? `(${s})` : s;
      };
      const lp = ast.left.type === 'bin' && precedence(ast.left.op) < precedence(ast.op);
      const rp =
        ast.right.type === 'bin' && precedence(ast.right.op) <= precedence(ast.op);
      return `${wrap(ast.left, lp)}${ast.op}${wrap(ast.right, rp)}`;
    }
  }
}

function precedence(op: '+' | '-' | '*' | '/'): number {
  return op === '+' || op === '-' ? 1 : 2;
}
