import { describe, expect, it } from "vitest";
import { rerankChunks } from "./curriculumRank";

// Invented sentences used only to exercise ranking; they are not curriculum content.
const chunk = (content: string, source_id = "s1") => ({ content, source_id });

describe("rerankChunks", () => {
  it("puts the passage that covers most of the question first and drops weak overlaps", () => {
    const full = chunk("نهاية دالة عند اللانهاية وحساب النهايات");
    const weak = chunk("الدوال في الفيزياء: حركة وسرعة الدالة", "s2");
    const result = rerankChunks([weak, full], "ما هي نهاية الدالة عند اللانهاية ؟");

    expect(result).toEqual([full]);
  });

  it("matches French plurals and accents against a singular question", () => {
    const match = chunk("Résolution des équations différentielles du premier ordre");
    const other = chunk("Nombres complexes : module et argument", "s2");
    expect(rerankChunks([other, match], "équation différentielle")).toEqual([match]);
  });

  it("accepts a single matching word when the question has only one", () => {
    const match = chunk("Les suites numériques et leurs limites");
    expect(rerankChunks([match], "limites")).toEqual([match]);
  });

  it("returns nothing when no passage shares enough with the question", () => {
    const unrelated = chunk("Nombres complexes : module et argument");
    expect(rerankChunks([unrelated], "dérivée fonction logarithme")).toEqual([]);
  });

  it("returns nothing for an empty candidate list or a question with only filler", () => {
    expect(rerankChunks([], "limite de la fonction")).toEqual([]);
    expect(rerankChunks([chunk("limite de la fonction")], "ما هي هذا")).toEqual([]);
  });

  it("lets one document fill at most two slots", () => {
    const sameSource = [1, 2, 3, 4].map((n) =>
      chunk("fonction exponentielle propriété " + n, "long-file"),
    );
    const elsewhere = chunk("fonction exponentielle définition", "other-file");
    const result = rerankChunks([...sameSource, elsewhere], "fonction exponentielle", { limit: 5 });

    expect(result.filter((item) => item.source_id === "long-file")).toHaveLength(2);
    expect(result).toContain(elsewhere);
  });

  it("respects the limit", () => {
    const many = [1, 2, 3, 4, 5, 6].map((n) => chunk("fonction logarithme " + n, "file-" + n));
    expect(rerankChunks(many, "fonction logarithme", { limit: 3 })).toHaveLength(3);
  });

  it("keeps the database order when passages score the same", () => {
    const first = chunk("fonction logarithme", "a");
    const second = chunk("fonction logarithme", "b");
    expect(rerankChunks([first, second], "fonction logarithme")).toEqual([first, second]);
  });

  it("prefers a focused passage over a long one that mentions the words once", () => {
    const focused = chunk("limite limite en l'infini: définition de la limite d'une fonction", "a");
    const long = chunk("introduction " + "mot ".repeat(120) + "limite fonction", "b");
    expect(rerankChunks([long, focused], "limite fonction")[0]).toBe(focused);
  });

  it("can be told to demand more matches", () => {
    const partial = chunk("limite seulement");
    expect(rerankChunks([partial], "limite fonction logarithme", { minMatchedTerms: 3 })).toEqual(
      [],
    );
    expect(rerankChunks([partial], "limite fonction logarithme", { minMatchedTerms: 1 })).toEqual([
      partial,
    ]);
  });
});
