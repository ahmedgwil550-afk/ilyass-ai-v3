/**
 * مشغّل الادعاءات: يأخذ ادعاءً قابلاً للفحص (استخرجه نموذج من الإجابة بصيغة JSON) ويحسمه بالحساب العددي.
 * الكود هو الحَكَم لا النموذج. المبدأ: لا حكم "خطأ" إلا عند تعارض واضح؛ كل ما لا يمكن حسمه
 * بثقة يُعاد بحالة unverifiable ولا يُنسب للإجابة.
 */
import { compile, evalConst, tryCompile, type Env, type Compiled } from "./expr";

/** quote: مقطع الإجابة الذي ورد فيه الادعاء (يُستعمل لتحديد موضع الخطأ) */
export type Claim =
  | { type: "equation"; q?: string; quote?: string; lhs: string; rhs: string; variable: string; solutions: string[]; domain?: [string, string]; complete?: boolean }
  | { type: "derivative"; q?: string; quote?: string; f: string; df: string; variable: string }
  | { type: "equality"; q?: string; quote?: string; left: string; right: string }
  | { type: "value"; q?: string; quote?: string; expr: string; value: string; vars?: Record<string, string> }
  | { type: "limit"; q?: string; quote?: string; f: string; variable: string; to: string; side?: "+" | "-"; value: string }
  | { type: "integral"; q?: string; quote?: string; f: string; variable: string; from: string; to: string; value: string };

export type ClaimType = Claim["type"];

export interface ClaimOutcome {
  claim: Claim;
  /** verified: ثبتت | mismatch: تعارض واضح | partial: ما ذُكر صحيح لكن ناقص | unverifiable: لا حكم */
  status: "verified" | "mismatch" | "partial" | "unverifiable";
  ar: string;
  fr: string;
  evidence?: string;
  /** الصحيح كما حسبه الكود (صيغة رياضية بلا كلمات: x ∈ {1 ; 3} ، f'(x=1.2) ≈ 0.48 ، 59500) */
  expected?: string;
}

const fmt = (x: number) => (Number.isFinite(x) ? String(+x.toPrecision(7)) : String(x));
const scale = (...xs: number[]) => 1 + xs.reduce((a, b) => a + (Number.isFinite(b) ? Math.abs(b) : 0), 0);

/** فاصلة عشرية فرنسية 2,5 → 2.5 (للقيم فقط، لأن الفاصلة في التعابير تفصل وسائط الدوال). */
const decimalComma = (s: string) => s.replace(/(\d),(\d)/g, "$1.$2");

/** تسامح التقريب الذي يدل عليه شكل القيمة المكتوبة: 12.50 ← ±0.005 ، 3.0*10^8 ← ±0.05*10^8 */
export function valueTolerance(valueStr: string, claimed: number): number {
  const s = decimalComma(valueStr).trim();
  let m = /^[+-]?\d+(?:\.(\d+))?$/.exec(s);
  if (m) return 0.5 * Math.pow(10, -(m[1]?.length ?? 0)) * 1.000001 + 1e-12 * Math.abs(claimed);
  m = /^[+-]?\d+(?:\.(\d+))?\s*(?:\*|x|×)\s*10\s*\^\s*\(?([+-]?\d+)\)?$/i.exec(s);
  if (m) return 0.5 * Math.pow(10, -(m[1]?.length ?? 0)) * Math.pow(10, parseInt(m[2], 10)) * 1.000001;
  const e = /^[+-]?\d+(?:\.(\d+))?[eE]([+-]?\d+)$/.exec(s);
  if (e) return 0.5 * Math.pow(10, -(e[1]?.length ?? 0)) * Math.pow(10, parseInt(e[2], 10)) * 1.000001;
  return 1e-9 * scale(claimed);
}
const decimalsOfStr = (s: string): number => {
  const m = /^[+-]?\d+\.(\d+)$/.exec(decimalComma(s).trim());
  return m ? m[1].length : 0;
};

/* ---------- عينات ---------- */
const BASE = [0.37, 1.21, 2.13, 0.83, 3.07, 1.77, 0.52, 2.61, 4.3, 0.91, 1.43, 5.2, 0.29, 2.89, 3.71, 6.1, 0.67, 1.09, 7.3, 2.37];
export function sampleEnvs(vars: string[], n = 18): Env[] {
  const out: Env[] = [];
  for (let i = 0; i < n; i++) {
    const env: Env = {};
    vars.forEach((v, k) => {
      const x = BASE[(i * (k + 3) + k * 5) % BASE.length];
      env[v] = i % 3 === 2 ? -x : x;
    });
    out.push(env);
  }
  return out;
}
const envStr = (env: Env) => Object.entries(env).map(([k, v]) => `${k}=${fmt(v)}`).join(", ");

function numDeriv(f: Compiled, env: Env, v: string): number {
  const x = env[v];
  const h = 1e-5 * Math.max(1, Math.abs(x));
  return (f.eval({ ...env, [v]: x + h }) - f.eval({ ...env, [v]: x - h })) / (2 * h);
}

/** أسباب تعذر التحقق بالفرنسية (المفتاح هو النص العربي المستعمل في unver) */
export const REASON_FR: Record<string, string> = {
  "تعذر قراءة المعادلة": "Équation illisible pour le programme",
  "المعادلة فيها وسائط أخرى": "L'équation contient d'autres paramètres",
  "تعذر قراءة الحلول المذكورة": "Solutions données illisibles pour le programme",
  "تعذر قراءة الدالة أو مشتقتها": "Fonction ou dérivée illisible pour le programme",
  "لم تتوفر نقاط كافية لفحص المشتقة": "Pas assez de points valides pour tester la dérivée",
  "نتيجة غير حاسمة": "Résultat non concluant",
  "تعذر قراءة المتساوية": "Égalité illisible pour le programme",
  "قيمة غير معرّفة": "Valeur non définie",
  "لم تتوفر نقاط كافية": "Pas assez de points valides",
  "تعذر قراءة القيمة": "Valeur illisible pour le programme",
  "تعذر قراءة التعبير": "Expression illisible pour le programme",
  "تعذر قراءة المعطيات": "Données illisibles pour le programme",
  "متغيرات بلا قيمة": "Variables sans valeur donnée",
  "تعذر قراءة التكامل": "Intégrale illisible pour le programme",
  "تكامل غير معتاد أو الدالة غير معرّفة على المجال": "Intégrale impropre ou fonction non définie sur l'intervalle",
  "تعذر قراءة النهاية": "Limite illisible pour le programme",
  "تعذر قراءة نقطة النهاية": "Point de la limite illisible pour le programme",
  "تعذر قراءة قيمة النهاية": "Valeur de la limite illisible pour le programme",
  "سلوك النهاية عددياً غير حاسم": "Comportement numérique de la limite non concluant",
  "تقارب بطيء، لا حكم": "Convergence lente, aucun verdict",
  "تعذر الفحص": "Vérification impossible",
  "نوع ادعاء غير معروف": "Type d'énoncé inconnu",
};
const unver = (claim: Claim, why: string): ClaimOutcome => ({ claim, status: "unverifiable", ar: why, fr: REASON_FR[why] ?? "Vérification impossible" });

/* ---------- معادلة ---------- */
function findRoots(g: (x: number) => number, lo: number, hi: number): number[] {
  const N = 4000;
  const xs: number[] = [], gs: number[] = [];
  for (let i = 0; i <= N; i++) { const x = lo + ((hi - lo) * i) / N; xs.push(x); gs.push(g(x)); }
  const roots: number[] = [];
  const accept = (r: number, tolScale: number) => { const v = g(r); if (Number.isFinite(v) && Math.abs(v) <= 1e-6 * tolScale) roots.push(r); };
  for (let i = 0; i < N; i++) {
    const a = gs[i], b = gs[i + 1];
    if (!Number.isFinite(a) || !Number.isFinite(b)) continue;
    if (a === 0) { roots.push(xs[i]); continue; }
    if (a * b < 0) {
      let l = xs[i], r = xs[i + 1], gl = a;
      for (let k = 0; k < 70; k++) { const m = (l + r) / 2, gm = g(m); if (!Number.isFinite(gm)) break; if (gl * gm <= 0) r = m; else { l = m; gl = gm; } }
      accept((l + r) / 2, scale(a, b));
    }
  }
  // جذور مضاعفة (المنحنى يلمس المحور دون أن يقطعه): أصغر محلي للقيمة المطلقة
  for (let i = 1; i < N; i++) {
    const p = Math.abs(gs[i - 1]), c = Math.abs(gs[i]), n = Math.abs(gs[i + 1]);
    if (![p, c, n].every(Number.isFinite) || !(c < p && c <= n) || gs[i - 1] * gs[i + 1] < 0) continue;
    let l = xs[i - 1], r = xs[i + 1];
    const phi = (Math.sqrt(5) - 1) / 2;
    for (let k = 0; k < 80; k++) {
      const m1 = r - phi * (r - l), m2 = l + phi * (r - l);
      if (Math.abs(g(m1)) < Math.abs(g(m2))) r = m2; else l = m1;
    }
    const x = (l + r) / 2;
    const v = Math.abs(g(x));
    if (Number.isFinite(v) && v <= 1e-9 * scale(c)) roots.push(x);
  }
  roots.sort((a, b) => a - b);
  return roots.filter((r, i) => i === 0 || Math.abs(r - roots[i - 1]) > 1e-5 * (1 + Math.abs(r)));
}

function checkEquation(c: Extract<Claim, { type: "equation" }>): ClaimOutcome {
  const L = tryCompile(c.lhs), R = tryCompile(c.rhs);
  const v = c.variable;
  if (!L || !R || !/^[A-Za-z]$/.test(v)) return unver(c, "تعذر قراءة المعادلة");
  if ([...L.vars, ...R.vars].some((x) => x !== v)) return unver(c, "المعادلة فيها وسائط أخرى");
  const g = (x: number) => L.eval({ [v]: x }) - R.eval({ [v]: x });
  const claimed: { s: number; raw: string; d: number }[] = [];
  for (const raw of c.solutions) {
    const s = evalConst(decimalComma(String(raw)).replace(/^\s*\w\s*=\s*/, ""));
    if (s != null) claimed.push({ s, raw: String(raw), d: decimalsOfStr(String(raw)) });
  }
  if (!claimed.length && c.solutions.length) return unver(c, "تعذر قراءة الحلول المذكورة");

  // مجال البحث عن الجذور: المجال الذي ذكره السؤال، وإلا [-50 ; 50] موسَّعاً ليشمل الحلول المذكورة
  const domainOf = (): [number, number] => {
    let lo = -50, hi = 50;
    const dl = c.domain ? evalConst(c.domain[0]) : null, dh = c.domain ? evalConst(c.domain[1]) : null;
    if (dl != null && dh != null && dl < dh) { lo = dl; hi = dh; }
    else for (const { s } of claimed) { lo = Math.min(lo, s - 5); hi = Math.max(hi, s + 5); }
    return [lo, hi];
  };
  /** الحلول الفعلية كما وجدها الكود (لتوضيح الصحيح عند الخطأ)؛ undefined إن كثرت كالمعادلات الدورية */
  const actualRoots = (): string | undefined => {
    const found = findRoots(g, ...domainOf());
    if (found.length > 12) return undefined;
    return found.length ? `${v} ∈ {${found.map(fmt).join(" ; ")}}` : "∅";
  };

  for (const { s, raw, d } of claimed) {
    const gv = g(s);
    const eqStr = `${c.lhs} = ${c.rhs}`;
    if (!Number.isFinite(gv)) {
      return { claim: c, status: "mismatch", ar: `الحل ${v} = ${raw} خارج مجال تعريف المعادلة`, fr: `La solution ${v} = ${raw} est hors du domaine de l'équation`, evidence: `${eqStr} عند ${v}=${raw}: غير معرّفة`, expected: actualRoots() };
    }
    const dg = (g(s + 1e-6 * Math.max(1, Math.abs(s))) - g(s - 1e-6 * Math.max(1, Math.abs(s)))) / (2e-6 * Math.max(1, Math.abs(s)));
    const delta = d > 0 ? 0.5 * Math.pow(10, -d) : 0;
    const tol = 1.001 * (Number.isFinite(dg) ? Math.abs(dg) : 0) * delta + 1e-7 * scale(L.eval({ [v]: s }), R.eval({ [v]: s }));
    if (Math.abs(gv) > tol) {
      return { claim: c, status: "mismatch", ar: `الحل ${v} = ${raw} لا يحقق المعادلة`, fr: `${v} = ${raw} ne vérifie pas l'équation`, evidence: `${eqStr} عند ${v}=${raw}: الطرف الأيسر ${fmt(L.eval({ [v]: s }))} والأيمن ${fmt(R.eval({ [v]: s }))}`, expected: actualRoots() };
    }
  }

  if (c.complete !== false) {
    const [lo, hi] = domainOf();
    const found = findRoots(g, lo, hi);
    // معادلة دورية (جيب، جيب تمام...) بلا مجال محدد: حلولها كثيرة والمطلوب عادة المجال، فلا نحكم على الاكتمال
    if (found.length > 12) return { claim: c, status: claimed.length ? "verified" : "unverifiable", ar: "الحلول المذكورة تحقق المعادلة (لم يُفحص اكتمالها: حلول كثيرة)", fr: "Les solutions données vérifient l'équation (exhaustivité non vérifiée)" };
    const missing = found.filter((r) => !claimed.some(({ s, d }) => Math.abs(s - r) <= Math.max(1e-4 * (1 + Math.abs(r)), d > 0 ? 0.5 * Math.pow(10, -d) : 0)));
    if (!c.solutions.length && found.length) {
      return { claim: c, status: "mismatch", ar: `ذُكر أن المعادلة بلا حل لكن لها حل قريب من ${v} ≈ ${fmt(found[0])}`, fr: `Il est dit que l'équation n'a pas de solution, mais ${v} ≈ ${fmt(found[0])} en est une`, evidence: `${c.lhs} = ${c.rhs}`, expected: `${v} ∈ {${found.map(fmt).join(" ; ")}}` };
    }
    if (missing.length) {
      const list = missing.slice(0, 3).map(fmt).join("، ");
      return { claim: c, status: "partial", ar: `الحلول المذكورة صحيحة لكن قد يوجد حل فائت: ${v} ≈ ${list}`, fr: `Les solutions données sont justes mais il peut en manquer : ${v} ≈ ${list}`, evidence: `${c.lhs} = ${c.rhs} على [${fmt(lo)} ; ${fmt(hi)}]`, expected: `${v} ∈ {${found.map(fmt).join(" ; ")}}` };
    }
  }
  return { claim: c, status: "verified", ar: "الحلول تحقق المعادلة", fr: "Les solutions vérifient l'équation" };
}

/* ---------- مشتقة / متطابقة ---------- */
const failRule = (fails: number, valid: number) => fails >= Math.max(2, Math.ceil(0.25 * valid));

function checkDerivative(c: Extract<Claim, { type: "derivative" }>): ClaimOutcome {
  const f = tryCompile(c.f), df = tryCompile(c.df);
  const v = c.variable;
  if (!f || !df || !/^[A-Za-z]$/.test(v)) return unver(c, "تعذر قراءة الدالة أو مشتقتها");
  const vars = [...new Set([...f.vars, ...df.vars, v])];
  let valid = 0, fails = 0, first = "", firstExpected = "";
  for (const env of sampleEnvs(vars)) {
    const d = numDeriv(f, env, v), claimed = df.eval(env), fv = f.eval(env);
    if (![d, claimed, fv].every(Number.isFinite)) continue;
    valid++;
    if (Math.abs(d - claimed) > 1e-6 * scale(d, claimed) + 1e-9 * Math.abs(fv)) {
      fails++;
      if (!first) { first = `${envStr(env)}: المشتقة الفعلية ≈ ${fmt(d)} بينما المذكورة ${fmt(claimed)}`; firstExpected = `f'(${envStr(env)}) ≈ ${fmt(d)}`; }
    }
  }
  if (valid < 4) return unver(c, "لم تتوفر نقاط كافية لفحص المشتقة");
  if (failRule(fails, valid)) return { claim: c, status: "mismatch", ar: "المشتقة المذكورة لا تطابق مشتقة الدالة", fr: "La dérivée donnée ne correspond pas à celle de la fonction", evidence: `f = ${c.f} ، f' (مذكورة) = ${c.df} ؛ ${first}`, expected: firstExpected };
  if (fails) return unver(c, "نتيجة غير حاسمة");
  return { claim: c, status: "verified", ar: "المشتقة صحيحة", fr: "La dérivée est correcte" };
}

function checkEquality(c: Extract<Claim, { type: "equality" }>): ClaimOutcome {
  const a = tryCompile(c.left), b = tryCompile(c.right);
  if (!a || !b) return unver(c, "تعذر قراءة المتساوية");
  const vars = [...new Set([...a.vars, ...b.vars])];
  if (!vars.length) {
    const x = a.eval(), y = b.eval();
    if (!Number.isFinite(x) || !Number.isFinite(y)) return unver(c, "قيمة غير معرّفة");
    return Math.abs(x - y) <= 1e-9 * scale(x, y)
      ? { claim: c, status: "verified", ar: "المتساوية صحيحة", fr: "L'égalité est juste" }
      : { claim: c, status: "mismatch", ar: "المتساوية غير صحيحة", fr: "L'égalité est fausse", evidence: `${c.left} = ${fmt(x)} ≠ ${c.right} = ${fmt(y)}` };
  }
  let valid = 0, fails = 0, first = "";
  for (const env of sampleEnvs(vars)) {
    const x = a.eval(env), y = b.eval(env);
    if (!Number.isFinite(x) || !Number.isFinite(y)) continue;
    valid++;
    if (Math.abs(x - y) > 1e-7 * scale(x, y)) { fails++; if (!first) first = `${envStr(env)}: الطرف الأيسر ${fmt(x)} والأيمن ${fmt(y)}`; }
  }
  if (valid < 4) return unver(c, "لم تتوفر نقاط كافية");
  if (failRule(fails, valid)) return { claim: c, status: "mismatch", ar: "الطرفان غير متطابقين (المتطابقة المدّعاة غير صحيحة)", fr: "Les deux membres ne sont pas identiques", evidence: `${c.left}  ↔  ${c.right} ؛ ${first}` };
  if (fails) return unver(c, "نتيجة غير حاسمة");
  return { claim: c, status: "verified", ar: "المتطابقة صحيحة", fr: "L'identité est correcte" };
}

/* ---------- قيمة ---------- */
function compareValue(c: Claim, truth: number, valueStr: string, label: string): ClaimOutcome {
  const claimed = evalConst(decimalComma(valueStr));
  if (claimed == null || !Number.isFinite(truth)) return unver(c, "تعذر قراءة القيمة");
  const tol = valueTolerance(valueStr, claimed) + 1e-9 * scale(truth);
  if (Math.abs(truth - claimed) <= tol) return { claim: c, status: "verified", ar: "القيمة صحيحة", fr: "La valeur est correcte" };
  return { claim: c, status: "mismatch", ar: `القيمة المذكورة (${valueStr.trim()}) لا تطابق الحساب (${fmt(truth)})`, fr: `La valeur donnée (${valueStr.trim()}) ne correspond pas au calcul (${fmt(truth)})`, evidence: `${label} = ${fmt(truth)}`, expected: fmt(truth) };
}

function checkValue(c: Extract<Claim, { type: "value" }>): ClaimOutcome {
  const e = tryCompile(c.expr);
  if (!e) return unver(c, "تعذر قراءة التعبير");
  const env: Env = {};
  for (const [k, raw] of Object.entries(c.vars ?? {})) { const n = evalConst(decimalComma(String(raw))); if (n == null) return unver(c, "تعذر قراءة المعطيات"); env[k] = n; }
  if (e.vars.some((x) => !(x in env))) return unver(c, "متغيرات بلا قيمة");
  return compareValue(c, e.eval(env), c.value, c.expr);
}

/* ---------- تكامل ---------- */
function checkIntegral(c: Extract<Claim, { type: "integral" }>): ClaimOutcome {
  const f = tryCompile(c.f), a = evalConst(c.from), b = evalConst(c.to);
  const v = c.variable;
  if (!f || a == null || b == null || !/^[A-Za-z]$/.test(v) || f.vars.some((x) => x !== v)) return unver(c, "تعذر قراءة التكامل");
  const N = 2000, h = (b - a) / N;
  let s = 0;
  for (let i = 0; i <= N; i++) {
    const y = f.eval({ [v]: a + i * h });
    if (!Number.isFinite(y)) return unver(c, "تكامل غير معتاد أو الدالة غير معرّفة على المجال");
    s += y * (i === 0 || i === N ? 1 : i % 2 ? 4 : 2);
  }
  return compareValue(c, (s * h) / 3, c.value, `∫ ${c.f} d${v} من ${c.from} إلى ${c.to}`);
}

/* ---------- نهاية ---------- */
function checkLimit(c: Extract<Claim, { type: "limit" }>): ClaimOutcome {
  const f = tryCompile(c.f);
  const v = c.variable;
  if (!f || !/^[A-Za-z]$/.test(v) || f.vars.some((x) => x !== v)) return unver(c, "تعذر قراءة النهاية");
  const toRaw = String(c.to).trim().toLowerCase().replace(/\s+/g, "");
  const toInf = /^(\+?inf(inity)?|\+∞|∞)$/.test(toRaw) ? 1 : /^(-inf(inity)?|-∞)$/.test(toRaw) ? -1 : 0;
  const a = toInf ? 0 : evalConst(c.to);
  if (!toInf && a == null) return unver(c, "تعذر قراءة نقطة النهاية");
  const claimRaw = String(c.value).trim().toLowerCase().replace(/\s+/g, "");
  const claimInf = /^(\+?inf(inity)?|\+∞|∞)$/.test(claimRaw) ? 1 : /^(-inf(inity)?|-∞)$/.test(claimRaw) ? -1 : 0;
  const claimNum = claimInf ? null : evalConst(decimalComma(c.value));
  if (!claimInf && claimNum == null) return unver(c, "تعذر قراءة قيمة النهاية");

  // سلاسل نقاط تقترب من النهاية
  const seqs: number[][] = [];
  const mk = (pts: number[]) => pts.map((x) => f.eval({ [v]: x }));
  if (toInf) seqs.push(mk([1e2, 1e3, 1e4, 1e5].map((x) => x * toInf)));
  else {
    const hs = [1e-1, 1e-2, 1e-3, 1e-4];
    if (c.side !== "-") seqs.push(mk(hs.map((h) => a! + h)));
    if (c.side !== "+") seqs.push(mk(hs.map((h) => a! - h)));
  }
  type Beh = { kind: "conv"; v: number; trending: boolean; stable: boolean } | { kind: "inf"; sign: 1 | -1 } | { kind: "unclear" };
  const classify = (s: number[]): Beh => {
    if (s.some((x) => Number.isNaN(x))) return { kind: "unclear" };
    const [, v1, v2, v3] = s;
    // تباعد واضح: إشارة ثابتة، قيمة كبيرة في آخر السلسلة، ونمو لا يقل عن الضعف في كل خطوة
    const grows = (big: number, small: number) => !Number.isFinite(big) || Math.abs(big) > 2 * Math.abs(small);
    if (Math.abs(v3) >= 1e3 && Math.sign(v1) === Math.sign(v2) && Math.sign(v2) === Math.sign(v3) && v3 !== 0 && grows(v3, v2) && grows(v2, v1)) {
      return { kind: "inf", sign: v3 > 0 ? 1 : -1 };
    }
    if (!s.every(Number.isFinite)) return { kind: "unclear" };
    const stable = Math.abs(v3 - v2) <= 1e-3 * scale(v3) && Math.abs(v3 - v2) <= Math.abs(v2 - v1) + 1e-12;
    return { kind: "conv", v: v3, trending: Math.abs(v3 - v2) <= Math.abs(v2 - v1), stable };
  };
  const behs = seqs.map(classify);
  if (behs.some((b) => b.kind === "unclear")) return unver(c, "سلوك النهاية عددياً غير حاسم");

  const ok = (b: Beh): boolean | null => {
    if (b.kind === "inf") return claimInf === b.sign ? true : false;
    if (b.kind === "conv") {
      if (claimInf) return b.stable ? false : null;
      const d = Math.abs(b.v - claimNum!);
      if (d <= 2e-3 * scale(claimNum!)) return true;
      return b.stable ? false : null; // تقارب بطيء لا يُحكم عليه
    }
    return null;
  };
  const rs = behs.map(ok);
  if (behs.length === 2) {
    const [l, r] = behs;
    if (l.kind === "conv" && r.kind === "conv" && l.stable && r.stable && Math.abs(l.v - r.v) > 2e-3 * scale(l.v, r.v) && !claimInf) {
      return { claim: c, status: "mismatch", ar: "النهاية من اليمين وعن اليسار مختلفتان، فلا نهاية وحيدة عند هذه النقطة", fr: "Les limites à droite et à gauche diffèrent", evidence: `f(${c.to}+) ≈ ${fmt(r.v)} ، f(${c.to}-) ≈ ${fmt(l.v)}` };
    }
  }
  if (rs.some((x) => x === null)) return unver(c, "تقارب بطيء، لا حكم");
  if (rs.every((x) => x === true)) return { claim: c, status: "verified", ar: "النهاية صحيحة", fr: "La limite est correcte" };
  const b0 = behs.find((_, i) => rs[i] === false)!;
  const est = b0.kind === "inf" ? (b0.sign > 0 ? "+∞" : "-∞") : b0.kind === "conv" ? fmt(b0.v) : "?";
  return { claim: c, status: "mismatch", ar: `النهاية المذكورة (${c.value}) تخالف السلوك العددي (≈ ${est})`, fr: `La limite donnée (${c.value}) contredit le calcul numérique (≈ ${est})`, evidence: `lim ${v}→${c.to}${c.side ? c.side : ""} de ${c.f}`, expected: `≈ ${est}` };
}

export function runClaim(claim: Claim): ClaimOutcome {
  try {
    switch (claim.type) {
      case "equation": return checkEquation(claim);
      case "derivative": return checkDerivative(claim);
      case "equality": return checkEquality(claim);
      case "value": return checkValue(claim);
      case "integral": return checkIntegral(claim);
      case "limit": return checkLimit(claim);
    }
  } catch {
    return unver(claim, "تعذر الفحص");
  }
  return unver(claim, "نوع ادعاء غير معروف");
}
