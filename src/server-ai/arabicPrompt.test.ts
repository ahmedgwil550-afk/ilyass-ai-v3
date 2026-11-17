import { describe, expect, it } from "vitest";
import { ARABIC_LANG_PROMPT, arabicPromptFor } from "./arabicPrompt";

describe("arabicPromptFor", () => {
  it("returns the Arabic methodology only for the arabic subject", () => {
    expect(arabicPromptFor("arabic")).toBe(ARABIC_LANG_PROMPT);
    for (const subject of ["math", "physics", "french", "islamic", "other", "", undefined, null]) {
      expect(arabicPromptFor(subject as string | undefined | null)).toBe("");
    }
  });

  it("covers the main Arabic exam skills", () => {
    for (const keyword of ["الإعراب", "الصرف", "البلاغة", "تحليل النص", "الإنتاج الكتابي", "الاستعارة", "التشبيه"]) {
      expect(ARABIC_LANG_PROMPT).toContain(keyword);
    }
  });

  it("overrides the French/scientific templates", () => {
    expect(ARABIC_LANG_PROMPT).toContain("أولوية مادة العربية");
    expect(ARABIC_LANG_PROMPT).toContain("Rédige en français");
  });

  it("forbids inventing quotations", () => {
    expect(ARABIC_LANG_PROMPT).toContain("لا تخترع");
  });

  it("is safe inside a template literal (no stray escapes or interpolation)", () => {
    expect(ARABIC_LANG_PROMPT).not.toContain("\\");
    expect(ARABIC_LANG_PROMPT).not.toContain("${");
    expect(ARABIC_LANG_PROMPT).not.toContain("`");
  });
});
