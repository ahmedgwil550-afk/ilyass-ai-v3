/**
 * Adaptive output-token budget shared by Avancee and Pananachi.
 * This is a conservative heuristic, not a claim that token count guarantees correctness.
 */
export interface BudgetInput {
  mode?: unknown;
  text?: string;
  imageCount?: number;
  subject?: string;
  responseLength?: string;
  examMode?: boolean;
  stage?: "solve" | "vision" | "writer" | "review" | "final";
}

export interface AdaptiveBudget {
  maxOutputTokens: number;
  complexity: number;
  reasoningEffort: "low" | "medium" | "high";
}

const clamp = (n: number, min: number, max: number) => Math.max(min, Math.min(max, n));

export function adaptiveTokenBudget(input: BudgetInput = {}): AdaptiveBudget {
  const text = input.text || "";
  const imageCount = clamp(input.imageCount || 0, 0, 12);
  // ترقيم لاتيني (1) a)) أو عربي (أ- ب) ١- السؤال 2 التمرين الأول ...)
  const questionCount = Math.max(1, (text.match(/(?:^|\n)\s*(?:[\d٠-٩]+[.)\-–]|[a-zأ-ي][.)\-–]|(?:السؤال|التمرين|الجزء|المحور)\s)/gim) || []).length);
  // أفعال التعليمات في مادة العربية (الإعراب والصرف والبلاغة والتحليل والإنشاء)
  const arabicTaskSignals = (text.match(/أعرب|حلّ?ل|ناقش|استخرج|اشرح|علّل|بيّن|قارن|أنشئ|اكتب|استنتج|وظّف|لخّص|ما دلالة|ما الصورة|ما نوع/g) || []).length;
  const isArabicHeavy = (text.match(/[؀-ۿ]/g) || []).length > Math.max(20, text.length * 0.4);
  const mathSignals = (text.match(/(?:=|\\frac|\\sqrt|\\int|\\sum|\\lim|\b(?:calculer|déterminer|démontrer|résoudre|calculate|prove|solve)\b)/gi) || []).length;
  const scienceSignals = (text.match(/(?:ATP|mitochond|document|courbe|graphique|tableau|circuit|mécanisme|expérience)/gi) || []).length;
  const longInput = Math.ceil(text.length / 4500);
  const complexity = clamp(
    (questionCount >= 5 ? 2 : questionCount >= 3 ? 1 : 0) +
    (mathSignals >= 5 ? 2 : mathSignals >= 2 ? 1 : 0) +
    (scienceSignals >= 3 ? 1 : 0) +
    (arabicTaskSignals >= 4 ? 2 : arabicTaskSignals >= 2 ? 1 : 0) +
    (imageCount > 0 ? 1 : 0) +
    (imageCount > 2 ? 1 : 0) +
    (longInput > 1 ? 1 : 0) +
    (input.responseLength === "detailed" ? 1 : 0),
    0, 6,
  );

  const mode = input.mode === "fast" || input.mode === "accurate" || input.mode === "advanced" || input.mode === "panache"
    ? input.mode : "accurate";
  let base = mode === "fast" ? 900 : mode === "accurate" ? 1700 : 2100;
  if (input.examMode) base += 250;
  // العربية تستهلك رموزاً أكثر لكل كلمة، وأجوبة العربية (إعراب، تحليل، إنشاء) نصية طويلة
  if (input.subject === "arabic" || isArabicHeavy) base += 400;
  if (input.responseLength === "short") base -= 300;
  if (input.responseLength === "detailed") base += 500;
  base += questionCount * 180 + complexity * 260 + imageCount * 120 + Math.min(longInput, 4) * 160;

  const stageFactor = input.stage === "vision" ? 1.25
    : input.stage === "writer" ? 0.72
    : input.stage === "review" ? 0.8
    : input.stage === "final" ? 1
    : 1;
  const maxOutputTokens = clamp(Math.round(base * stageFactor), 700, input.stage === "vision" ? 5200 : 7000);
  const reasoningEffort = complexity >= 4 ? "high" : complexity >= 2 ? "medium" : "low";
  return { maxOutputTokens, complexity, reasoningEffort };
}
