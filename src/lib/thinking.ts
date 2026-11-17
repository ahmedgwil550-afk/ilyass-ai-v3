/**
 * النموذج يبدأ ردّه بكتلة قصيرة:  <thinking> - ما رأيته … - الأسئلة … </thinking>  ثم الإجابة.
 * هذه الدوال تفصل الكتلة عن الإجابة، وتعمل أثناء البث (وسم ناقص أو كتلة لم تُغلق بعد).
 */
import { splitVerification, type Verdict } from "./verification";

const OPEN = "<thinking>";
const CLOSE = "</thinking>";

export type SplitResult = {
  /** نص كتلة التفكير (قد يكون ناقصاً أثناء البث) */
  thinking: string;
  /** الإجابة الفعلية بعد الكتلة، بدون كتلة التحقق */
  answer: string;
  /** هل أُغلقت كتلة التفكير؟ (أو لا توجد كتلة أصلاً) */
  closed: boolean;
  /** حكم التحقق من الإجابة إن وصل (آخر كتلة <verification> صالحة) */
  verification: Verdict | null;
};

// يحذف من آخر النص جزءاً من وسم الإغلاق لم يكتمل بعد، مثل "</think"
function dropPartialTail(s: string, tag: string): string {
  for (let n = Math.min(tag.length - 1, s.length); n > 0; n--) {
    if (s.endsWith(tag.slice(0, n))) return s.slice(0, s.length - n);
  }
  return s;
}

function splitThinkingBlock(raw: string): Omit<SplitResult, "verification"> {
  const t = raw.trimStart();
  if (!t) return { thinking: "", answer: "", closed: true };
  // وسم الفتح لم يكتمل بعد ("<thin") — لا نعرض شيئاً حتى يتضح
  if (t.length < OPEN.length && OPEN.startsWith(t)) return { thinking: "", answer: "", closed: false };
  if (!t.startsWith(OPEN)) return { thinking: "", answer: raw, closed: true };
  const end = t.indexOf(CLOSE);
  if (end === -1) {
    return { thinking: dropPartialTail(t.slice(OPEN.length), CLOSE).trim(), answer: "", closed: false };
  }
  return { thinking: t.slice(OPEN.length, end).trim(), answer: t.slice(end + CLOSE.length).trimStart(), closed: true };
}

/** يفصل كتلة التفكير وكتلة التحقق عن الإجابة. كل من يستعمل .answer (نسخ، تصدير، سجل) يحصل على نص نظيف. */
export function splitThinking(raw: string): SplitResult {
  const base = splitThinkingBlock(raw);
  const { text, verification } = splitVerification(base.answer);
  return { ...base, answer: text, verification };
}

/** للسجل المُرسل إلى الخادم وللنسخ والتصدير: الإجابة فقط بدون كتلة التفكير */
export const stripThinking = (raw: string): string => splitThinking(raw).answer;

/** أسطر الكتلة جاهزة للعرض (بدون "- " ولا **) */
export const thinkingLines = (thinking: string): string[] =>
  thinking
    .split("\n")
    .map((l) => l.replace(/^\s*[-•*]\s*/, "").replace(/\*\*/g, "").trim())
    .filter(Boolean);

/* ---------- لغة السؤال ---------- */
export type QLang = "ar" | "fr" | "en";

/** لغة افتراضية حسب المادة عندما لا يوجد نص في رسالة الطالب (صورة فقط) */
export function fallbackLangForSubject(subject: string): QLang {
  if (subject === "english") return "en";
  if (["math", "physics", "chemistry", "biology", "french"].includes(subject)) return "fr";
  return "ar";
}

/** يكتشف لغة نص السؤال (عربية / فرنسية / إنجليزية) */
export function detectLang(text: string, fallback: QLang = "fr"): QLang {
  const ar = (text.match(/[؀-ۿ]/g) ?? []).length;
  const lat = (text.match(/[A-Za-zÀ-ÿ]/g) ?? []).length;
  if (ar + lat < 3) return fallback;
  if (ar >= lat) return "ar";
  const fr = (text.match(/\b(le|la|les|des|du|de|un|une|est|sont|et|que|qui|pour|dans|sur|calculer|montrer|déterminer|exercice|donc|on|d'où)\b|[éèêàùçôîû]/gi) ?? []).length;
  const en = (text.match(/\b(the|is|are|and|of|to|in|that|what|which|calculate|find|show|exercise|with)\b/gi) ?? []).length;
  return fr >= en ? "fr" : "en";
}
