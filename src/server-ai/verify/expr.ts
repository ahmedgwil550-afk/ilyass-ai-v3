/**
 * محلّل تعابير رياضية بصيغة نصية بسيطة (ASCII) مع متغيرات ودوال، بدون eval.
 * يُستعمل لإعادة حساب ادعاءات الإجابة (جذور، مشتقات، نهايات، تكاملات) بالكود لا بالنموذج.
 *
 * الصيغة: + - * / ^  وأقواس، ضرب ضمني (2x، 2(x+1)، (x+1)(x-1))، ثوابت pi و e،
 * دوال: sqrt cbrt root(n,x) exp ln log10 log2 logb(b,x) sin cos tan asin acos atan sinh cosh tanh
 *       abs floor ceil sgn min max pow fact comb perm   وعامل المضروب n!
 * أي شيء غير مفهوم يرمي ParseError فيُعدّ الادعاء "غير قابل للتحقق" ولا يُحكم عليه.
 */
export class ParseError extends Error {}

export type Env = Record<string, number>;
export interface Compiled {
  /** يحسب القيمة؛ NaN إن خرجت النقطة عن المجال (ln(-1) مثلاً). */
  eval: (env?: Env) => number;
  /** المتغيرات الحرة في التعبير */
  vars: string[];
}

const MAX_LEN = 600;
const MAX_DEPTH = 48;

const fact = (n: number): number => {
  if (!Number.isInteger(n) || n < 0 || n > 170) return NaN;
  let r = 1;
  for (let i = 2; i <= n; i++) r *= i;
  return r;
};
const comb = (n: number, k: number): number => {
  if (![n, k].every(Number.isInteger) || k < 0 || n < 0 || k > n || n > 170) return NaN;
  return Math.round(fact(n) / (fact(k) * fact(n - k)));
};
const perm = (n: number, k: number): number => {
  if (![n, k].every(Number.isInteger) || k < 0 || n < 0 || k > n || n > 170) return NaN;
  return Math.round(fact(n) / fact(n - k));
};
const nthRoot = (n: number, x: number): number => {
  if (!Number.isInteger(n) || n === 0) return NaN;
  if (x < 0) return n % 2 !== 0 ? -Math.pow(-x, 1 / n) : NaN;
  return Math.pow(x, 1 / n);
};

type Fn = (...a: number[]) => number;
const FUNCS: Record<string, { arity: number; f: Fn }> = {
  sqrt: { arity: 1, f: (x) => (x < 0 ? NaN : Math.sqrt(x)) },
  cbrt: { arity: 1, f: Math.cbrt },
  root: { arity: 2, f: nthRoot },
  exp: { arity: 1, f: Math.exp },
  ln: { arity: 1, f: (x) => (x > 0 ? Math.log(x) : NaN) },
  log10: { arity: 1, f: (x) => (x > 0 ? Math.log10(x) : NaN) },
  log2: { arity: 1, f: (x) => (x > 0 ? Math.log2(x) : NaN) },
  logb: { arity: 2, f: (b, x) => (b > 0 && b !== 1 && x > 0 ? Math.log(x) / Math.log(b) : NaN) },
  sin: { arity: 1, f: Math.sin },
  cos: { arity: 1, f: Math.cos },
  tan: { arity: 1, f: Math.tan },
  asin: { arity: 1, f: Math.asin },
  arcsin: { arity: 1, f: Math.asin },
  acos: { arity: 1, f: Math.acos },
  arccos: { arity: 1, f: Math.acos },
  atan: { arity: 1, f: Math.atan },
  arctan: { arity: 1, f: Math.atan },
  sinh: { arity: 1, f: Math.sinh },
  cosh: { arity: 1, f: Math.cosh },
  tanh: { arity: 1, f: Math.tanh },
  abs: { arity: 1, f: Math.abs },
  floor: { arity: 1, f: Math.floor },
  ceil: { arity: 1, f: Math.ceil },
  sgn: { arity: 1, f: Math.sign },
  min: { arity: 2, f: Math.min },
  max: { arity: 2, f: Math.max },
  pow: { arity: 2, f: Math.pow },
  fact: { arity: 1, f: fact },
  comb: { arity: 2, f: comb },
  perm: { arity: 2, f: perm },
};
const CONSTS: Record<string, number> = { pi: Math.PI, e: Math.E };
// بحث بالمفاتيح الخاصة فقط: لا تُحلّ أسماء مثل constructor أو toString من Object.prototype
const own = (o: object, k: string) => Object.prototype.hasOwnProperty.call(o, k);

type Node = (env: Env) => number;
type Tok =
  | { t: "num"; v: number }
  | { t: "id"; v: string }
  | { t: "op"; v: string };

function tokenize(src: string): Tok[] {
  const out: Tok[] = [];
  let i = 0;
  while (i < src.length) {
    const c = src[i];
    if (c === " " || c === "\t" || c === "\n") { i++; continue; }
    if (/[0-9.]/.test(c)) {
      const m = /^(\d+\.?\d*|\.\d+)(?:[eE]([+-]?\d+)(?![A-Za-z(]))?/.exec(src.slice(i));
      if (!m) throw new ParseError("number");
      out.push({ t: "num", v: parseFloat(m[1]) * (m[2] ? Math.pow(10, parseInt(m[2], 10)) : 1) });
      i += m[0].length;
      continue;
    }
    if (/[A-Za-z]/.test(c)) {
      const m = /^[A-Za-z][A-Za-z0-9]*/.exec(src.slice(i))!;
      out.push({ t: "id", v: m[0] });
      i += m[0].length;
      continue;
    }
    if ("+-*/^(),!".includes(c)) { out.push({ t: "op", v: c }); i++; continue; }
    if (c === "×" || c === "·") { out.push({ t: "op", v: "*" }); i++; continue; }
    if (c === "−" || c === "–") { out.push({ t: "op", v: "-" }); i++; continue; }
    if (c === "÷") { out.push({ t: "op", v: "/" }); i++; continue; }
    if (c === "π") { out.push({ t: "id", v: "pi" }); i++; continue; }
    if (c === "√") { out.push({ t: "id", v: "sqrt" }); i++; continue; }
    throw new ParseError(`char ${c}`);
  }
  return out;
}

export function compile(src: string): Compiled {
  if (typeof src !== "string" || !src.trim() || src.length > MAX_LEN) throw new ParseError("size");
  const toks = tokenize(src);
  const vars = new Set<string>();
  let p = 0;
  let depth = 0;
  const peek = () => toks[p];
  const isOp = (v: string) => { const t = toks[p]; return !!t && t.t === "op" && t.v === v; };
  const eat = (v: string) => { if (!isOp(v)) throw new ParseError(`expected ${v}`); p++; };

  const startsPrimary = (): boolean => {
    const t = peek();
    if (!t) return false;
    return t.t === "num" || t.t === "id" || (t.t === "op" && t.v === "(");
  };

  const expr = (): Node => {
    if (++depth > MAX_DEPTH) throw new ParseError("depth");
    let left = term();
    while (isOp("+") || isOp("-")) {
      const plus = isOp("+"); p++;
      const l = left, r = term();
      left = plus ? (env) => l(env) + r(env) : (env) => l(env) - r(env);
    }
    depth--;
    return left;
  };
  const term = (): Node => {
    let left = unary();
    for (;;) {
      if (isOp("*")) { p++; const l = left, r = unary(); left = (env) => l(env) * r(env); }
      else if (isOp("/")) { p++; const l = left, r = unary(); left = (env) => l(env) / r(env); }
      else if (startsPrimary()) { const l = left, r = unary(); left = (env) => l(env) * r(env); } // ضرب ضمني
      else return left;
    }
  };
  const unary = (): Node => {
    if (isOp("-")) { p++; const x = unary(); return (env) => -x(env); }
    if (isOp("+")) { p++; return unary(); }
    return power();
  };
  const power = (): Node => {
    const base = postfix();
    if (isOp("^")) { p++; const ex = unary(); return (env) => Math.pow(base(env), ex(env)); }
    return base;
  };
  const postfix = (): Node => {
    let x = primary();
    while (isOp("!")) { p++; const y = x; x = (env) => fact(y(env)); }
    return x;
  };
  const primary = (): Node => {
    const t = peek();
    if (!t) throw new ParseError("end");
    if (t.t === "num") { p++; const v = t.v; return () => v; }
    if (t.t === "op" && t.v === "(") {
      p++; const x = expr(); eat(")"); return x;
    }
    if (t.t === "id") {
      p++;
      const name = t.v;
      const lower = name.toLowerCase();
      const isFn = own(FUNCS, lower);
      if (isFn && isOp("(")) {
        p++;
        const args: Node[] = [expr()];
        while (isOp(",")) { p++; args.push(expr()); }
        eat(")");
        const { arity, f } = FUNCS[lower];
        if (args.length !== arity) throw new ParseError(`arity ${name}`);
        return arity === 1 ? (env) => f(args[0](env)) : (env) => f(args[0](env), args[1](env));
      }
      if (isFn && !isOp("(")) {
        // دالة بلا أقواس مثل sin x: نقبلها للحالة البسيطة فقط (حجة واحدة أولية)
        const { arity, f } = FUNCS[lower];
        if (arity !== 1 || !startsPrimary()) throw new ParseError(`call ${name}`);
        const arg = power();
        return (env) => f(arg(env));
      }
      if (name === "log") throw new ParseError("ambiguous log"); // ln أو log10 صراحةً
      if (own(CONSTS, lower) && name.length <= 2) return () => CONSTS[lower];
      if (name.length === 1) { vars.add(name); return (env) => (name in env ? env[name] : NaN); }
      // اسم متعدد الأحرف غير معروف: ضرب ضمني بين متغيرات من حرف واحد (ab = a*b)، ولا نقبل f(...) مجهولة
      if (isOp("(")) throw new ParseError(`unknown function ${name}`);
      const letters = name.split("");
      if (letters.some((ch) => !/[A-Za-z]/.test(ch))) throw new ParseError(`name ${name}`);
      for (const ch of letters) if (ch !== "e") vars.add(ch); // e هنا ثابت أويلر
      return (env) => letters.reduce((acc, ch) => acc * (ch === "e" ? Math.E : ch in env ? env[ch] : NaN), 1);
    }
    throw new ParseError(`unexpected ${t.v}`);
  };

  const root = expr();
  if (p !== toks.length) throw new ParseError("trailing");
  return { eval: (env = {}) => root(env), vars: [...vars] };
}

/** يحاول التحليل؛ null بدل رمي الخطأ. */
export function tryCompile(src: unknown): Compiled | null {
  if (typeof src !== "string") return null;
  try { return compile(src); } catch { return null; }
}

/** تعبير بلا متغيرات → رقم، وإلا null. */
export function evalConst(src: unknown): number | null {
  const c = tryCompile(src);
  if (!c || c.vars.length) return null;
  const v = c.eval();
  return Number.isFinite(v) ? v : null;
}
