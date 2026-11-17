/**
 * مدقق حسابي برمجي (لا يعتمد على نموذج لغوي): يستخرج المتساويات العددية الصرفة من معادلات LaTeX
 * مثل  $2{,}5 \times 4 = 10$  ويعيد حسابها بمحلّل آمن (بدون eval). يُبلّغ فقط عن تعارض واضح (> 1.5%).
 * أي تعبير فيه رموز أو وحدات أو ضرب ضمني يُتجاهل بدل المخاطرة بحكم خاطئ.
 */

class ParseError extends Error {}

function parseExpr(src: string): number {
  let i = 0;
  const peek = () => src[i];
  const ws = () => { while (i < src.length && src[i] === " ") i++; };
  const num = (): number => {
    ws();
    const m = /^\d+(\.\d+)?/.exec(src.slice(i));
    if (m) { i += m[0].length; return parseFloat(m[0]); }
    if (src.startsWith("pi", i)) { i += 2; return Math.PI; }
    if (src.startsWith("sqrt", i)) {
      i += 4; ws();
      if (peek() !== "(") throw new ParseError();
      i++; const v = add(); ws();
      if (peek() !== ")") throw new ParseError();
      i++;
      if (v < 0) throw new ParseError();
      return Math.sqrt(v);
    }
    if (peek() === "(") {
      i++; const v = add(); ws();
      if (peek() !== ")") throw new ParseError();
      i++; return v;
    }
    throw new ParseError();
  };
  const unary = (): number => { ws(); if (peek() === "-") { i++; return -pow(); } if (peek() === "+") { i++; return pow(); } return pow(); };
  const pow = (): number => {
    const b = num(); ws();
    if (peek() === "^") { i++; const e = unary(); return Math.pow(b, e); }
    return b;
  };
  const mul = (): number => {
    let v = unary();
    for (;;) {
      ws();
      if (peek() === "*") { i++; v *= unary(); }
      else if (peek() === "/") { i++; const d = unary(); if (d === 0) throw new ParseError(); v /= d; }
      else return v;
    }
  };
  const add = (): number => {
    let v = mul();
    for (;;) {
      ws();
      if (peek() === "+") { i++; v += mul(); }
      else if (peek() === "-") { i++; v -= mul(); }
      else return v;
    }
  };
  const v = add(); ws();
  if (i !== src.length || !Number.isFinite(v)) throw new ParseError();
  return v;
}

/** LaTeX عددي → تعبير بسيط، أو null إن لم يكن عددياً صرفاً. */
function normalize(latex: string): string | null {
  let s = latex
    .replace(/\\left|\\right|\\displaystyle|\\[,;:! ]|~|\\quad|\\qquad/g, " ")
    .replace(/\{,\}/g, ".")
    .replace(/(\d),(\d)/g, "$1.$2")
    .replace(/\\times|\\cdot/g, "*")
    .replace(/\\div/g, "/")
    .replace(/\\pi/g, "pi")
    .replace(/−/g, "-");
  for (let k = 0; k < 6; k++) {
    s = s.replace(/\\[dt]?frac\s*\{([^{}]*)\}\s*\{([^{}]*)\}/g, "(($1)/($2))")
         .replace(/\\sqrt\s*\{([^{}]*)\}/g, "sqrt($1)")
         .replace(/\^\s*\{([^{}]*)\}/g, "^($1)");
  }
  s = s.replace(/\^\s*(-?\d+(\.\d+)?)/g, "^($1)").replace(/\s+/g, " ").trim();
  if (/\\|[a-oq-zA-Z]|_|%|\{|\}|[°]/.test(s.replace(/sqrt|pi/g, ""))) return null;
  if (/\d\s+\d/.test(s) || /\)\s*\(|\d\s*\(|\)\s*\d/.test(s)) return null; // ضرب ضمني: نتجاهل
  return s || null;
}

function evalSide(latex: string): number | null {
  const n = normalize(latex);
  if (!n) return null;
  try { return parseExpr(n); } catch { return null; }
}

export interface ArithIssue { expr: string; left: number; right: number }

/** يعيد الأخطاء وعدد المتساويات العددية التي فُحصت فعلاً (لتعرف طبقة التحقق كم نتيجة ثبتت). */
export function arithmeticStats(text: string): { issues: ArithIssue[]; checked: number } {
  const issues: ArithIssue[] = [];
  let checked = 0;
  const segs = [...text.matchAll(/\$\$([\s\S]+?)\$\$|\$([^$\n]+?)\$/g)].map((m) => m[1] ?? m[2]);
  for (const seg of segs) {
    const parts = seg.split(/=|\\approx|\\simeq/).map((p) => p.trim());
    const vals = parts.map(evalSide);
    for (let k = 0; k + 1 < parts.length; k++) {
      const a = vals[k], b = vals[k + 1];
      if (a == null || b == null) continue;
      checked++;
      const tol = Math.max(0.015 * Math.max(Math.abs(a), Math.abs(b)), 1e-9);
      if (Math.abs(a - b) > tol) issues.push({ expr: `${parts[k]} = ${parts[k + 1]}`, left: a, right: b });
    }
  }
  return { issues: issues.slice(0, 12), checked };
}

export function checkArithmetic(text: string): ArithIssue[] {
  return arithmeticStats(text).issues;
}

export function arithmeticReport(text: string): string {
  const issues = checkArithmetic(text);
  if (!issues.length) return "لم يجد المدقق الحسابي البرمجي أي خطأ عددي صريح (تحقق فقط من المتساويات العددية الصرفة).";
  return "أخطاء عددية وجدها المدقق الحسابي البرمجي (محسوبة آلياً، موثوقة):\n" +
    issues.map((x) => `- $${x.expr}$ : الطرف الأيسر يساوي فعلاً ${+x.left.toPrecision(6)} والأيمن ${+x.right.toPrecision(6)}`).join("\n");
}
