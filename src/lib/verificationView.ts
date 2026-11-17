/** نصوص عرض حكم التحقق (عربي/فرنسي). منفصلة عن المكوّن ليسهل اختبارها. */
import type { Verdict, VerdictLevel, VerificationIssue } from "./verification";
import type { QLang } from "./thinking";

export type ViewLang = "ar" | "fr";
export const viewLang = (lang: QLang): ViewLang => (lang === "ar" ? "ar" : "fr");

const HEAD: Record<Exclude<VerdictLevel, "unchecked">, Record<ViewLang, string>> = {
  verified: { ar: "اجتازت التحقق الآلي", fr: "Vérifiée automatiquement" },
  checked: { ar: "فحص أساسي: لم يُكتشف خطأ", fr: "Contrôle de base : aucune erreur détectée" },
  warning: { ar: "ملاحظات للمراجعة", fr: "Points à revoir" },
  error: { ar: "يوجد خطأ محتمل، راجع النقاط", fr: "Erreur possible, à revoir" },
};

/** تمييز العدد في العربية: 1 مفرد، 2 مثنى، 3 إلى 10 جمع، وبعد ذلك مفرد منصوب. */
function arNoun(n: number, one: string, two: string, few: string, many: string): string {
  if (n === 1) return one;
  if (n === 2) return two;
  return n <= 10 ? `${n} ${few}` : `${n} ${many}`;
}

/** لا شيء ثبتت صحته لكن هناك ما تعذّر فحصه: نقولها صراحة بدل الصمت */
const HEAD_UNVERIFIED: Record<ViewLang, string> = { ar: "تعذر التحقق من أجزاء من الإجابة", fr: "Vérification impossible pour certaines parties" };

export function headline(v: Verdict, lang: ViewLang): { title: string; sub: string } | null {
  const unver = v.unverified?.length ?? 0;
  if (v.level === "unchecked" && unver === 0) return null;
  const title = v.level === "unchecked" ? HEAD_UNVERIFIED[lang] : HEAD[v.level][lang];
  const issues = v.issues.filter((i) => i.severity !== "info").length;
  const n = v.verifiedCount;
  const parts: string[] = [];
  if (n > 0) {
    parts.push(lang === "ar"
      ? `تم التحقق من ${arNoun(n, "عنصر واحد", "عنصرين", "عناصر", "عنصراً")}`
      : `${n} ${n === 1 ? "élément confirmé" : "éléments confirmés"}`);
  }
  if (issues > 0) {
    parts.push(lang === "ar" ? arNoun(issues, "ملاحظة واحدة", "ملاحظتان", "ملاحظات", "ملاحظة") : `${issues} ${issues === 1 ? "point" : "points"}`);
  }
  if (unver > 0 && v.level !== "unchecked") {
    parts.push(lang === "ar"
      ? `تعذر التحقق من ${arNoun(unver, "جزء واحد", "جزأين", "أجزاء", "جزءاً")}`
      : `${unver} ${unver === 1 ? "partie non vérifiée" : "parties non vérifiées"}`);
  }
  return { title, sub: parts.join(" · ") };
}

export const RUNNING_TEXT: Record<ViewLang, string> = { ar: "جارٍ التحقق من الإجابة…", fr: "Vérification de la réponse…" };

export const SOURCE_LABEL: Record<VerificationIssue["source"], Record<ViewLang, string>> = {
  code: { ar: "أعاد الكود الحساب", fr: "Recalculé par programme" },
  static: { ar: "فحص شكلي", fr: "Contrôle de forme" },
  model: { ar: "اختلاف نموذجين", fr: "Écart entre deux modèles" },
  reading: { ar: "مقارنة قراءتين للصورة", fr: "Comparaison de deux lectures de la photo" },
  method: { ar: "تقدير نموذج للمنهج (اقتراح لا حكم)", fr: "Estimation d'un modèle sur la méthode (suggestion, pas un verdict)" },
};

/** عناوين حقول تفصيل الخطأ ووسوم الأقسام */
export const WHERE_LABEL: Record<ViewLang, string> = { ar: "في إجابتك", fr: "Dans ta réponse" };
export const EXPECTED_LABEL: Record<ViewLang, string> = { ar: "الصواب بحسب إعادة الحساب", fr: "Valeur recalculée" };
export const UNVERIFIED_TITLE: Record<ViewLang, string> = { ar: "تعذر التحقق من", fr: "Non vérifié" };
export const UNVERIFIED_NOTE: Record<ViewLang, string> = { ar: "لم أحكم على هذه الأجزاء بدل تخمين حكم قد يكون خاطئاً.", fr: "Je ne juge pas ces parties plutôt que de risquer un verdict faux." };
export const SKIPPED_LABEL: Record<ViewLang, string> = { ar: "تعذر التحقق", fr: "non vérifié" };
export const METHOD_TITLE: Record<ViewLang, string> = { ar: "ملاحظات على المنهج (اقتراحات)", fr: "Remarques sur la méthode (suggestions)" };

/** يفصل ملاحظات المنهج (رأي نموذج) عن الأخطاء والتنبيهات المثبتة كي لا تختلط الاقتراحات بالأدلة */
export function splitIssues(issues: VerificationIssue[]): { findings: VerificationIssue[]; method: VerificationIssue[] } {
  return { findings: issues.filter((i) => i.source !== "method"), method: issues.filter((i) => i.source === "method") };
}

export const DISCLAIMER: Record<ViewLang, string> = {
  ar: "الفحص الآلي يقلّل الأخطاء لكنه لا يغني عن مراجعة أستاذك، ولا يشمل كل ما في الإجابة.",
  fr: "Le contrôle automatique réduit les erreurs mais ne remplace pas ton professeur et ne couvre pas toute la réponse.",
};

export const issueText = (i: VerificationIssue, lang: ViewLang) => (lang === "ar" ? i.ar : i.fr) || i.ar || i.fr;
