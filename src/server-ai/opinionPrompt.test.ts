import { describe, expect, it } from "vitest";
import { OPINION_STYLE_PROMPT, opinionPromptFor } from "./opinionPrompt";

describe("opinionPromptFor", () => {
  it("applies to the literary subjects", () => {
    for (const subject of ["arabic", "french", "english", "philosophy", "history"]) {
      expect(opinionPromptFor(subject)).toBe(OPINION_STYLE_PROMPT);
    }
  });

  it("does not apply to scientific subjects or Islamic education", () => {
    for (const subject of ["math", "physics", "chemistry", "biology", "islamic", "other", "", undefined, null]) {
      expect(opinionPromptFor(subject as string | undefined | null)).toBe("");
    }
  });

  it("asks for a clear, specific stance instead of the stock answer", () => {
    expect(OPINION_STYLE_PROMPT).toContain("موقف واضح");
    expect(OPINION_STYLE_PROMPT).toContain("الأكثر تداولاً");
    expect(OPINION_STYLE_PROMPT).toContain("لا تتخذ موقفاً غريباً لمجرد المخالفة");
  });

  it("forbids stock openers and closers in Arabic, French and English", () => {
    for (const phrase of ["في عالمنا اليوم", "وفي الختام", "Il est indéniable que", "In today's world"]) {
      expect(OPINION_STYLE_PROMPT).toContain(phrase);
    }
  });

  it("does not invite invented personal stories", () => {
    expect(OPINION_STYLE_PROMPT).toContain("لا تؤلف قصصاً شخصية");
  });

  it("is safe inside a template literal (no stray escapes or interpolation)", () => {
    expect(OPINION_STYLE_PROMPT).not.toContain("\\");
    expect(OPINION_STYLE_PROMPT).not.toContain("${");
    expect(OPINION_STYLE_PROMPT).not.toContain("`");
  });
});
