import { describe, expect, it } from "vitest";
import { PHILOSOPHY_LANG_PROMPT, philosophyPromptFor } from "./philosophyPrompt";

describe("philosophyPromptFor", () => {
  it("returns the philosophy methodology only for the philosophy subject", () => {
    expect(philosophyPromptFor("philosophy")).toBe(PHILOSOPHY_LANG_PROMPT);
    for (const subject of ["math", "physics", "french", "arabic", "islamic", "history", "other", "", undefined, null]) {
      expect(philosophyPromptFor(subject as string | undefined | null)).toBe("");
    }
  });

  it("follows the national exam grid: understanding, analysis, discussion, synthesis, form (4+5+5+3+3 = 20)", () => {
    for (const axis of ["الفهم (4 من 20)", "التحليل (5 من 20)", "المناقشة (5 من 20)", "التركيب (3 من 20)", "الجوانب الشكلية (3 من 20)"]) {
      expect(PHILOSOPHY_LANG_PROMPT).toContain(axis);
    }
  });

  it("handles the three exam topics and short lesson questions", () => {
    for (const keyword of ["سؤال فلسفي", "قولة", "نص فلسفي", "صياغة الإشكال", "الأطروحة", "رأي شخصي مبني", "سؤال درس مباشر"]) {
      expect(PHILOSOPHY_LANG_PROMPT).toContain(keyword);
    }
  });

  it("overrides the French/scientific templates", () => {
    expect(PHILOSOPHY_LANG_PROMPT).toContain("يتقدم على كل قالب فرنسي أو علمي");
    expect(PHILOSOPHY_LANG_PROMPT).toContain("Réponse / Étape / Résultat");
  });

  it("forbids inventing quotations or attributions", () => {
    expect(PHILOSOPHY_LANG_PROMPT).toContain("لا تخترع اقتباساً");
    expect(PHILOSOPHY_LANG_PROMPT).toContain("يرى بعض الفلاسفة");
  });

  it("is safe inside a template literal (no stray escapes or interpolation)", () => {
    expect(PHILOSOPHY_LANG_PROMPT).not.toContain("\\");
    expect(PHILOSOPHY_LANG_PROMPT).not.toContain("${");
    expect(PHILOSOPHY_LANG_PROMPT).not.toContain("`");
  });
});
