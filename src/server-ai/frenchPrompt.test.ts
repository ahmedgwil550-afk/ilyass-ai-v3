import { describe, expect, it } from "vitest";
import { FRENCH_LANG_PROMPT, frenchPromptFor } from "./frenchPrompt";

describe("frenchPromptFor", () => {
  it("returns the French methodology only for the french subject", () => {
    expect(frenchPromptFor("french")).toBe(FRENCH_LANG_PROMPT);
    for (const subject of ["math", "physics", "chemistry", "biology", "arabic", "english", "philosophy", "other", "", undefined, null]) {
      expect(frenchPromptFor(subject as string | undefined | null)).toBe("");
    }
  });

  it("covers the three parts of the written exam", () => {
    for (const keyword of ["Étude de texte", "Contextualiser", "Analyser", "Réagir", "Langue", "Production écrite", "texte argumentatif"]) {
      expect(FRENCH_LANG_PROMPT).toContain(keyword);
    }
  });

  it("covers the main language skills", () => {
    for (const keyword of ["Nature ثم fonction", "Transformation", "Conjugaison", "Vocabulaire", "subjonctif", "participe passé"]) {
      expect(FRENCH_LANG_PROMPT).toContain(keyword);
    }
  });

  it("overrides the scientific templates", () => {
    expect(FRENCH_LANG_PROMPT).toContain("Priorité à la matière français");
    expect(FRENCH_LANG_PROMPT).toContain("Application numérique");
    expect(FRENCH_LANG_PROMPT).toContain("boxed");
  });

  it("is not a literary dissertation and forbids invented quotations and personal stories", () => {
    expect(FRENCH_LANG_PROMPT).toContain("وليس dissertation littéraire");
    expect(FRENCH_LANG_PROMPT).toContain("لا تخترع اقتباساً");
    expect(FRENCH_LANG_PROMPT).toContain("لا تؤلف قصصاً شخصية");
  });

  it("bans the stock French AI phrases it tells the model to avoid", () => {
    for (const phrase of ["De nos jours", "Il est indéniable que", "Force est de constater", "Il convient de souligner"]) {
      expect(FRENCH_LANG_PROMPT).toContain(phrase);
    }
  });

  it("does not use the long dash itself", () => {
    expect(FRENCH_LANG_PROMPT).not.toContain("—");
  });

  it("is safe inside a template literal (no stray escapes or interpolation)", () => {
    expect(FRENCH_LANG_PROMPT).not.toContain("\\");
    expect(FRENCH_LANG_PROMPT).not.toContain("${");
    expect(FRENCH_LANG_PROMPT).not.toContain("`");
  });
});
