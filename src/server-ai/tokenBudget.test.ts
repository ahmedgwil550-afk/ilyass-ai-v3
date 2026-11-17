import { describe, expect, it } from "vitest";
import { adaptiveTokenBudget } from "./tokenBudget";

describe("adaptiveTokenBudget", () => {
  it("allocates fewer tokens to a short direct question", () => {
    const short = adaptiveTokenBudget({ mode: "advanced", text: "Définir la mitose.", stage: "solve" });
    const complex = adaptiveTokenBudget({
      mode: "advanced",
      text: "1) Calculer x = 2 + 3.\n2) Démontrer que f est croissante.\n3) Résoudre l'équation et vérifier les unités.",
      imageCount: 2,
      responseLength: "detailed",
      stage: "solve",
    });
    expect(complex.maxOutputTokens).toBeGreaterThan(short.maxOutputTokens);
    expect(complex.complexity).toBeGreaterThan(short.complexity);
  });

  it("keeps token limits within safe bounds", () => {
    const budget = adaptiveTokenBudget({ mode: "panache", text: "Examen complet", imageCount: 12, responseLength: "detailed", stage: "vision" });
    expect(budget.maxOutputTokens).toBeGreaterThanOrEqual(700);
    expect(budget.maxOutputTokens).toBeLessThanOrEqual(5200);
  });

  it("counts Arabic numbering and gives Arabic answers a larger budget", () => {
    const text = "التمرين الأول\nأ- أعرب ما تحته خط.\nب- استخرج صورة بيانية وبيّن أثرها.\nج- حلّل النص.";
    const arabic = adaptiveTokenBudget({ mode: "accurate", text, subject: "arabic", stage: "solve" });
    const forced = adaptiveTokenBudget({ mode: "accurate", text, subject: "math", stage: "solve" });
    const single = adaptiveTokenBudget({ mode: "accurate", text: "ما معنى كلمة الصبر؟", subject: "arabic", stage: "solve" });
    // التمرين + أ- ب- ج-: 4 أسئلة مرقمة، وثلاث تعليمات (أعرب، استخرج، حلّل)
    expect(arabic.complexity).toBeGreaterThanOrEqual(2);
    expect(arabic.maxOutputTokens).toBeGreaterThan(single.maxOutputTokens);
    // نص عربي كثيف يأخذ الزيادة حتى لو اختيرت مادة أخرى
    expect(forced.maxOutputTokens).toBe(arabic.maxOutputTokens);
  });

  it("raises reasoning effort for complex work", () => {
    const budget = adaptiveTokenBudget({
      mode: "advanced",
      text: "1) Calculer la limite et démontrer.\n2) Résoudre le système.\n3) Interpréter le graphique et le tableau.",
      imageCount: 2,
      responseLength: "detailed",
    });
    expect(["medium", "high"]).toContain(budget.reasoningEffort);
  });
});
