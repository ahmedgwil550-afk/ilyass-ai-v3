/**
 * أنواع حكم التحقق وترميزه داخل بث الإجابة. بدون أي اعتماديات: يستعمله الخادم والواجهة معاً.
 *
 * الحكم يُلحَق بآخر الإجابة ككتلة  <verification>{json}</verification>  (مثل كتلة <thinking>)،
 * والواجهة تفصله عن النص فلا يظهر في الإجابة ولا في النسخ ولا في السجل المُرسل للخادم.
 */
export type Severity = "info" | "warn" | "error";
export type CheckStatus = "pass" | "warn" | "fail" | "skip";
/** verified: فُحص شيء فعلاً ونجح | checked: لم يُكتشف خطأ لكن الأدلة قليلة | warning/error: ملاحظات | unchecked: لم يُفحص شيء */
export type VerdictLevel = "verified" | "checked" | "warning" | "error" | "unchecked";

export interface VerificationIssue {
  severity: Severity;
  /** معرّف آلي للنوع: arithmetic, equation_root, equation_missing, derivative, quote ... */
  kind: string;
  /** رقم السؤال إن عُرف */
  q?: string;
  ar: string;
  fr: string;
  /** ما قورن بالضبط (يُعرض للتلميذ ليحكم بنفسه) */
  evidence?: string;
  /** مقطع الإجابة الذي فيه الخطأ (منقول حرفياً منها) */
  where?: string;
  /** القيمة أو الحل الصحيح كما حسبه الكود (صيغة رياضية محايدة اللغة) */
  expected?: string;
  /**
   * code: حسمه الكود حسابياً | static: فحص شكلي | model: اختلاف مع نموذج آخر
   * reading: اختلاف بين قراءتين للصورة | method: ملاحظة منهجية بتقدير نموذج (اقتراح لا حكم)
   */
  source: "code" | "static" | "model" | "reading" | "method";
}

/** ما تعذّر التحقق منه، مع السبب: يُعرض صراحةً بدل حكم مخمَّن. */
export interface UnverifiedItem {
  q?: string;
  ar: string;
  fr: string;
  /** المقطع أو الصيغة المعنية */
  what?: string;
}

export interface VerificationCheck {
  id: string;
  status: CheckStatus;
  ar: string;
  fr: string;
  count?: number;
}

export interface Verdict {
  v: 1;
  state: "running" | "done";
  level: VerdictLevel;
  /** عدد النتائج التي ثبتت صحتها (بالكود أو بتطابق حل مستقل) */
  verifiedCount: number;
  checks: VerificationCheck[];
  issues: VerificationIssue[];
  /** أجزاء تعذّر التحقق منها (مبدأ: لا حكم مخمَّن) */
  unverified: UnverifiedItem[];
}

const OPEN = "<verification>";
const CLOSE = "</verification>";

/** كتلة جاهزة للبث. يُهرَّب "<" داخل JSON كي لا يظهر وسم الإغلاق داخل المحتوى. */
export function encodeVerification(v: Verdict): string {
  return `\n${OPEN}${JSON.stringify(v).replace(/</g, "\\u003c")}${CLOSE}\n`;
}

const SEVERITIES = new Set(["info", "warn", "error"]);
const STATUSES = new Set(["pass", "warn", "fail", "skip"]);
const LEVELS = new Set(["verified", "checked", "warning", "error", "unchecked"]);
const SOURCES = new Set(["code", "static", "model", "reading", "method"]);

/** يتحقق من شكل الحكم القادم من الشبكة؛ يعيد null إن لم يكن صالحاً. */
export function parseVerdict(json: string): Verdict | null {
  try {
    const o = JSON.parse(json);
    if (!o || o.v !== 1 || (o.state !== "running" && o.state !== "done") || !LEVELS.has(o.level)) return null;
    if (!Array.isArray(o.checks) || !Array.isArray(o.issues)) return null;
    const str = (x: unknown) => (typeof x === "string" ? x : "");
    return {
      v: 1,
      state: o.state,
      level: o.level,
      verifiedCount: Number.isFinite(o.verifiedCount) ? Math.max(0, Math.floor(o.verifiedCount)) : 0,
      checks: o.checks
        .filter((c: any) => c && typeof c.id === "string" && STATUSES.has(c.status))
        .map((c: any) => ({ id: c.id, status: c.status, ar: str(c.ar), fr: str(c.fr), ...(Number.isFinite(c.count) ? { count: c.count } : {}) })),
      issues: o.issues
        .filter((i: any) => i && SEVERITIES.has(i.severity))
        .map((i: any) => ({
          severity: i.severity,
          kind: str(i.kind),
          ...(typeof i.q === "string" ? { q: i.q } : {}),
          ar: str(i.ar),
          fr: str(i.fr),
          ...(typeof i.evidence === "string" ? { evidence: i.evidence } : {}),
          ...(typeof i.where === "string" ? { where: i.where } : {}),
          ...(typeof i.expected === "string" ? { expected: i.expected } : {}),
          source: SOURCES.has(i.source) ? i.source : "static",
        })),
      unverified: (Array.isArray(o.unverified) ? o.unverified : [])
        .filter((u: any) => u && (typeof u.ar === "string" || typeof u.fr === "string"))
        .slice(0, 12)
        .map((u: any) => ({
          ...(typeof u.q === "string" ? { q: u.q } : {}),
          ar: str(u.ar),
          fr: str(u.fr),
          ...(typeof u.what === "string" ? { what: u.what } : {}),
        })),
    };
  } catch {
    return null;
  }
}

// يحذف من آخر النص جزءاً من وسم الفتح لم يكتمل بعد، مثل "<verif"
function dropPartialOpen(s: string): string {
  for (let n = Math.min(OPEN.length - 1, s.length); n > 0; n--) {
    if (s.endsWith(OPEN.slice(0, n))) return s.slice(0, s.length - n);
  }
  return s;
}

export interface SplitVerification {
  /** النص بدون أي كتلة تحقق (كاملة أو ناقصة) */
  text: string;
  /** آخر كتلة صالحة، أو null */
  verification: Verdict | null;
}

/** يفصل كتل التحقق عن النص؛ يعمل أثناء البث (كتلة لم تُغلق بعد لا تظهر أبداً). */
export function splitVerification(raw: string): SplitVerification {
  if (!raw.includes("<")) return { text: raw, verification: null };
  let verification: Verdict | null = null;
  let text = raw.replace(/<verification>([\s\S]*?)<\/verification>/g, (_m, body: string) => {
    const parsed = parseVerdict(body);
    if (parsed) verification = parsed;
    return "";
  });
  const openAt = text.lastIndexOf(OPEN);
  if (openAt !== -1) text = text.slice(0, openAt);
  else text = dropPartialOpen(text);
  const changed = text !== raw;
  return { text: changed ? text.trimEnd() : text, verification };
}

export const stripVerification = (raw: string): string => splitVerification(raw).text;
