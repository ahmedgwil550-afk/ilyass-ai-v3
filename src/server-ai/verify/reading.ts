/**
 * التحقق من قراءة الصورة. الإجابة تُبنى على قراءة أولى للورقة، وأي رقم أو أس أو رمز أخطأت قراءتَه يفسد الحل كله
 * دون أن يظهر ذلك في الإجابة نفسها. لذلك نعيد القراءة بنموذج مستقل (REREAD_SYSTEM) ثم يقارن الكود بين القراءتين:
 * أرقام، كسور، أسس، دلائل (indices)، وحدات، رموز علاقات، وأبعاد الجداول.
 *
 * المبادئ نفسها: الكود هو الحكم؛ اختلاف القراءتين لا يعني أيهما الصحيحة فلا نتّهم الإجابة بل ننبّه التلميذ إلى المقطع المختلَف عليه؛
 * وإذا تباعدت القراءتان كثيراً (ترتيب صفحات مختلف مثلاً) نقول «تعذر التحقق» بدل سيل من الملاحظات.
 */
import type { VerificationIssue } from "../../lib/verification";

/* ---------- إشارات القراءة الأولى (مجانية) ---------- */
export interface ReadingSignals {
  readability: "ok" | "partial" | "poor" | null;
  /** عدد [?] في قسم النص */
  illegible: number;
  figureMissing: boolean;
}

const toLatinDigits = (s: string) => s.replace(/[٠-٩]/g, (d) => String(d.charCodeAt(0) - 0x0660));

/** قسم "## Texte" وحده (القيم التقديرية للأشكال لا تُقارن). بلا ترويسة: النص كله. */
export function texteSection(t: string): string {
  const lines = t.split("\n");
  const start = lines.findIndex((l) => /^#{1,3}\s*Texte\b/i.test(l.trim()));
  if (start === -1) return t;
  const out: string[] = [];
  for (let i = start + 1; i < lines.length; i++) {
    if (/^#{1,3}\s+\S/.test(lines[i].trim())) break;
    out.push(lines[i]);
  }
  return out.join("\n");
}

export function readingSignals(transcript: string): ReadingSignals {
  const r = /READABILITY\s*:\s*(ok|partial|poor)/i.exec(transcript)?.[1]?.toLowerCase() as ReadingSignals["readability"] | undefined;
  return {
    readability: r ?? null,
    illegible: (texteSection(transcript).match(/\[\?\]/g) ?? []).length,
    figureMissing: /FIGURE_MISSING\s*:/i.test(transcript),
  };
}

/** ملاحظات القراءة الأولى وحدها (لا تحتاج نموذجاً ثانياً). */
export function signalIssues(sig: ReadingSignals): VerificationIssue[] {
  const out: VerificationIssue[] = [];
  if (sig.figureMissing) {
    out.push({
      severity: "warn", kind: "reading_figure", source: "reading",
      ar: "سؤال يحتاج شكلاً أو منحنى غير ظاهر في الصورة، فكل ما يعتمد عليه غير مؤكد. أرسل صورة تُظهره كاملاً.",
      fr: "Une question demande une figure ou une courbe qui n'est pas visible sur la photo : tout ce qui en dépend est incertain. Envoie une photo qui la montre en entier.",
    });
  }
  if (sig.illegible > 0) {
    out.push({
      severity: "warn", kind: "reading_illegible", source: "reading",
      ar: `${sig.illegible} ${sig.illegible > 10 ? "موضعاً" : "مواضع"} غير مقروءة في الصورة، وأي نتيجة تعتمد عليها غير مؤكدة. جرّب صورة أوضح أو مقرّبة.`,
      fr: `${sig.illegible} endroit${sig.illegible > 1 ? "s" : ""} illisible${sig.illegible > 1 ? "s" : ""} sur la photo : tout résultat qui en dépend est incertain. Essaie une photo plus nette ou plus proche.`,
    });
  }
  if (sig.readability === "poor") {
    out.push({
      severity: "warn", kind: "reading_quality", source: "reading",
      ar: "جودة الصورة ضعيفة، وقد تكون بعض المعطيات قُرئت خطأً. قارن الأرقام بورقتك.",
      fr: "La qualité de la photo est faible : certaines données ont pu être mal lues. Compare les chiffres avec ta feuille.",
    });
  } else if (sig.readability === "partial" && !sig.illegible && !sig.figureMissing) {
    out.push({
      severity: "info", kind: "reading_quality", source: "reading",
      ar: "الصورة مقروءة جزئياً فقط؛ قارن الأرقام بورقتك.",
      fr: "La photo n'est lisible que partiellement : compare les chiffres avec ta feuille.",
    });
  }
  return out;
}

/* ---------- استخراج السمات القابلة للمقارنة ---------- */
export interface ReadingFeatures {
  numbers: string[];
  fractions: string[];
  exponents: string[];
  indices: string[];
  /** أزواج "رقم|وحدة" */
  units: string[];
  symbols: string[];
  /** أبعاد كل جدول بالترتيب: "3x4" */
  tables: string[];
}

const SYMBOLS: [RegExp, string][] = [
  [/\\leq?(?![a-z])|≤|⩽/g, "≤"],
  [/\\geq?(?![a-z])|≥|⩾/g, "≥"],
  [/\\neq?(?![a-z])|≠/g, "≠"],
  [/\\infty|∞/g, "∞"],
  [/\\sqrt|√/g, "√"],
  [/\\int(?![a-z])|∫/g, "∫"],
  [/\\sum|∑/g, "∑"],
  [/\\in(?![a-z])|∈/g, "∈"],
  [/\\lim(?![a-z])/g, "lim"],
  [/</g, "<"],
  [/>/g, ">"],
];

const UNIT_SRC = String.raw`(?:°C|°|%|Ω|(?:[kKMGmcdµn])?(?:mol|Hz|Pa|eV|min|mL|ml|[gmsAKLlNJWVCFHhT])(?:\s?[./·*]\s?[A-Za-zµΩ]+(?:\^?-?\d)?|\^?-?\d)?)(?![A-Za-zµΩ])`;
const NUM_UNIT = new RegExp(String.raw`(-?\d+(?:\.\d+)?)\s*(${UNIT_SRC})`, "g");

function normalizeLatex(raw: string): string {
  return toLatinDigits(raw)
    .replace(/<br\s*\/?>/gi, " ")
    .replace(/\\(?:left|right|displaystyle|textstyle|,|;|:|!|quad|qquad)\b|\\[ ,;:!]/g, " ")
    .replace(/\\(?:dfrac|tfrac)/g, "\\frac")
    .replace(/\\(?:mathrm|text|textrm|mathbf)\{([^{}]*)\}/g, "$1")
    .replace(/\{,\}/g, ",")
    .replace(/\\(?:times|cdot)(?![a-z])/g, "*")
    .replace(/μ/g, "µ") // الميكرو اليوناني → ميكرو
    .replace(/[−–—‑]/g, "-")
    .replace(/(\d),(\d)/g, "$1.$2")
    .replace(/[$~]/g, " ");
}

const LABEL_PREFIX = /^(?:[#>*\-\s]*)(?:(?:question|q|exercice|exercise|partie|السؤال|التمرين|س)\s*)?\(?\d{1,2}(?:\s*[-.]\s*\d{1,2})?\s*[.)\-–:](?!\d)/i;
const isSeparator = (l: string) => /^\|?[\s:|-]+\|?$/.test(l) && l.includes("-");

function tableDims(lines: string[]): string[] {
  const dims: string[] = [];
  let cur: string[] = [];
  const flush = () => {
    if (cur.length) {
      const rows = cur.filter((l) => !isSeparator(l));
      const cols = (rows[0] ?? "").split("|").map((c) => c.trim()).filter((c, i, a) => c || (i > 0 && i < a.length - 1)).length;
      if (rows.length && cols) dims.push(`${rows.length}x${cols}`);
    }
    cur = [];
  };
  for (const l of lines) { if (/^\s*\|/.test(l)) cur.push(l.trim()); else flush(); }
  flush();
  return dims;
}

export function readingFeatures(transcript: string): ReadingFeatures {
  const lines = texteSection(transcript).split("\n");
  const f: ReadingFeatures = { numbers: [], fractions: [], exponents: [], indices: [], units: [], symbols: [], tables: tableDims(lines) };
  for (const raw of lines) {
    if (isSeparator(raw.trim())) continue;
    let s = normalizeLatex(raw.replace(/\*\*|__/g, ""));
    s = s.replace(LABEL_PREFIX, " ");
    s = s.replace(/\\frac\s*\{([^{}]{1,14})\}\s*\{([^{}]{1,14})\}/g, (_m, a: string, b: string) => { f.fractions.push(`${a.replace(/\s/g, "")}/${b.replace(/\s/g, "")}`); return " "; });
    s = s.replace(/\^\s*\{?\s*(-?[0-9a-zA-Z.]{1,4})\s*\}?/g, (_m, e: string) => { f.exponents.push(e); return " "; });
    s = s.replace(/_\s*\{?\s*([0-9a-zA-Z+\-]{1,5})\s*\}?/g, (_m, i: string) => { f.indices.push(i); return " "; });
    for (const m of s.matchAll(NUM_UNIT)) f.units.push(`${m[1]}|${m[2].replace(/\s/g, "").replace(/[·*]/g, ".").replace(/^ml$/, "mL").replace(/^l$/, "L")}`);
    for (const [re, name] of SYMBOLS) { const k = s.match(re)?.length ?? 0; for (let i = 0; i < k; i++) f.symbols.push(name); s = s.replace(re, " "); }
    s.replace(/(-?)(\d+(?:\.\d+)?)/g, (m: string, sign: string, num: string, off: number) => {
      const prev = off > 0 ? s[off - 1] : "";
      // "-" علامة سالبة فقط إن لم يسبقها حرف/رقم/قوس مغلق (وإلا فهي عملية طرح)
      f.numbers.push(sign && !/[\w)\]}]/.test(prev) ? `-${num}` : num);
      return m;
    });
  }
  return f;
}

/* ---------- المقارنة ---------- */
const bag = (xs: string[]) => { const m = new Map<string, number>(); for (const x of xs) m.set(x, (m.get(x) ?? 0) + 1); return m; };

function multisetDiff(a: string[], b: string[]): { onlyFirst: string[]; onlySecond: string[]; common: number } {
  const A = bag(a), B = bag(b);
  const onlyFirst: string[] = [], onlySecond: string[] = [];
  let common = 0;
  for (const [k, n] of A) { const m = B.get(k) ?? 0; common += Math.min(n, m); for (let i = 0; i < n - m; i++) onlyFirst.push(k); }
  for (const [k, n] of B) { const m = A.get(k) ?? 0; for (let i = 0; i < n - m; i++) onlySecond.push(k); }
  return { onlyFirst, onlySecond, common };
}

export interface ReadingDiffKind { kind: "numbers" | "fractions" | "exponents" | "indices" | "units" | "symbols" | "tables"; onlyFirst: string[]; onlySecond: string[] }
export interface ReadingComparison {
  /** false إن لم تكفِ السمات المشتركة للحكم */
  comparable: boolean;
  /** تباعدت القراءتان كثيراً: لا يُحكم */
  divergent: boolean;
  matched: number;
  diffs: ReadingDiffKind[];
}

const MIN_TOKENS = 4;

export function compareReadings(first: string, second: string): ReadingComparison {
  const A = readingFeatures(first), B = readingFeatures(second);
  const diffs: ReadingDiffKind[] = [];
  let matched = 0, total = 0, differing = 0;
  const kinds = ["numbers", "fractions", "exponents", "indices", "symbols", "tables"] as const;
  for (const k of kinds) {
    const d = multisetDiff(A[k], B[k]);
    matched += d.common; total += d.common + Math.max(d.onlyFirst.length, d.onlySecond.length); differing += Math.max(d.onlyFirst.length, d.onlySecond.length);
    if (d.onlyFirst.length || d.onlySecond.length) diffs.push({ kind: k, onlyFirst: d.onlyFirst, onlySecond: d.onlySecond });
  }
  // الوحدات: نقارن فقط الأرقام الحاضرة في القراءتين بعدد متساوٍ، فنكشف "5 mL" مقابل "5 L" لا اختلاف عدد الأرقام
  const unitsOf = (xs: string[]) => { const m = new Map<string, string[]>(); for (const x of xs) { const [n, u] = x.split("|"); m.set(n, [...(m.get(n) ?? []), u]); } return m; };
  const ua = unitsOf(A.units), ub = unitsOf(B.units);
  const unitFirst: string[] = [], unitSecond: string[] = [];
  for (const [n, us] of ua) {
    const vs = ub.get(n);
    if (!vs || vs.length !== us.length) continue;
    const d = multisetDiff(us, vs);
    for (const u of d.onlyFirst) unitFirst.push(`${n} ${u}`);
    for (const u of d.onlySecond) unitSecond.push(`${n} ${u}`);
  }
  if (unitFirst.length || unitSecond.length) { diffs.push({ kind: "units", onlyFirst: unitFirst, onlySecond: unitSecond }); differing += Math.max(unitFirst.length, unitSecond.length); total += Math.max(unitFirst.length, unitSecond.length); }
  const comparable = matched + differing >= MIN_TOKENS;
  const divergent = comparable && total >= 8 && differing / total > 0.35;
  return { comparable, divergent, matched, diffs };
}

/* ---------- تحويل المقارنة إلى ملاحظات ---------- */
const AR_KIND: Record<ReadingDiffKind["kind"], string> = { numbers: "رقم", fractions: "كسر", exponents: "أس", indices: "دليل (index)", units: "وحدة", symbols: "رمز", tables: "جدول" };
const FR_KIND: Record<ReadingDiffKind["kind"], string> = { numbers: "nombre", fractions: "fraction", exponents: "exposant", indices: "indice", units: "unité", symbols: "symbole", tables: "tableau" };

const show = (xs: string[], kind: ReadingDiffKind["kind"]) => xs.slice(0, 4).map((x) => (kind === "exponents" ? `^${x}` : kind === "indices" ? `_${x}` : x)).join("، ");
const showFr = (xs: string[], kind: ReadingDiffKind["kind"]) => xs.slice(0, 4).map((x) => (kind === "exponents" ? `^${x}` : kind === "indices" ? `_${x}` : x)).join(", ");

export function comparisonIssues(c: ReadingComparison): VerificationIssue[] {
  if (!c.comparable || c.divergent) return [];
  return c.diffs.slice(0, 4).map((d) => {
    const a = show(d.onlyFirst, d.kind), b = show(d.onlySecond, d.kind);
    const af = showFr(d.onlyFirst, d.kind), bf = showFr(d.onlySecond, d.kind);
    return {
      severity: "warn" as const, kind: `reading_${d.kind}`, source: "reading" as const,
      ar: `قراءتان مستقلتان للصورة اختلفتا في ${AR_KIND[d.kind]}: «${a || "—"}» مقابل «${b || "—"}». تأكد من القيمة الصحيحة في ورقتك لأن الحل بُني على القراءة الأولى.`,
      fr: `Deux lectures indépendantes de la photo divergent sur ${d.kind === "units" || d.kind === "fractions" ? "une" : "un"} ${FR_KIND[d.kind]} : « ${af || "—"} » contre « ${bf || "—"} ». Vérifie la bonne valeur sur ta feuille : la solution repose sur la première lecture.`,
      evidence: `${a || "—"} ≠ ${b || "—"}`,
    };
  });
}
