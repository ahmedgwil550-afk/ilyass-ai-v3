import { describe, expect, it } from "vitest";
import {
  CURRICULUM_STOPWORDS,
  MAX_SEARCH_TERMS,
  normalizeCurriculumText,
  rankingTerms,
  selectSearchTerms,
  stemLatin,
  tokenizeCurriculumText,
} from "./curriculumText";

const RLM = String.fromCharCode(0x200f);
const LAM_ALEF_LIGATURE = String.fromCharCode(0xfefb);
const FATHA = String.fromCharCode(0x064e);

describe("normalizeCurriculumText", () => {
  // The same pairs were run against public.normalize_curriculum_text on PostgreSQL 17.
  const SHARED_WITH_SQL: Array<[string, string]> = [
    ["المَعادَلة", "معادله"],
    ["أَحْمَد", "احمد"],
    ["Équation Différentielle", "equation differentielle"],
    ["ŒUVRE", "oeuvre"],
    ["٢٠٢٦", "2026"],
    [LAM_ALEF_LIGATURE, "لا"],
    ["والمعادلة", "معادله"],
    ["الله", "الله"],
    ["كتاب", "كتاب"],
    ["التزام", "تزام"],
    ["x" + RLM + "y", "xy"],
    ["مسألة", "مساله"],
    ["Ça va très bien", "ca va tres bien"],
  ];

  for (const [input, expected] of SHARED_WITH_SQL) {
    it("folds " + JSON.stringify(input) + " like the database does", () => {
      expect(normalizeCurriculumText(input)).toBe(expected);
    });
  }

  it("makes spelling variants of one Arabic word comparable", () => {
    const forms = ["الدالة", "دالة", "دالَة", "الدّالة"].map(normalizeCurriculumText);
    expect(new Set(forms).size).toBe(1);
  });

  it("makes French accent and case variants comparable", () => {
    expect(normalizeCurriculumText("DÉRIVÉE")).toBe(normalizeCurriculumText("derivee"));
  });

  it("keeps a short word that only starts like the article", () => {
    expect(normalizeCurriculumText("الم")).toBe("الم");
    expect(normalizeCurriculumText("ال" + FATHA)).toBe("ال");
  });
});

describe("stemLatin", () => {
  it("folds a plural ending on longer Latin words only", () => {
    expect(stemLatin("equations")).toBe("equation");
    expect(stemLatin("axes")).toBe("axes");
    expect(stemLatin("nombres")).toBe("nombre");
    expect(stemLatin("دوال")).toBe("دوال");
  });
});

describe("selectSearchTerms", () => {
  it("keeps the subject words of an Arabic question and drops the filler", () => {
    expect(selectSearchTerms("ما هي نهاية الدالة عند اللانهاية ؟")).toEqual([
      "اللانهاية",
      "الدالة",
      "نهاية",
    ]);
  });

  it("keeps the original spelling, because the database normalises exactly once", () => {
    const terms = selectSearchTerms("Peux-tu m'expliquer les équations différentielles ?");
    expect(terms).toContain("équations");
    expect(terms).toContain("différentielles");
  });

  it("adds the singular of Latin plurals so a prefix search finds both", () => {
    expect(selectSearchTerms("Peux-tu m'expliquer les équations différentielles ?")).toEqual([
      "différentielles",
      "équations",
      "differentielle",
      "equation",
    ]);
  });

  it("drops Darija filler written in Arabic letters", () => {
    const terms = selectSearchTerms("بغيت نفهم الاشتقاق ديال الدالة");
    expect(terms).toContain("الاشتقاق");
    expect(terms).toContain("الدالة");
    expect(terms).not.toContain("بغيت");
    expect(terms).not.toContain("ديال");
  });

  it("keeps a four-digit year but not a bare small number", () => {
    const terms = selectSearchTerms("exercice 2024 question 3 limites");
    expect(terms).toContain("2024");
    expect(terms).not.toContain("3");
  });

  it("returns nothing when the question is only filler", () => {
    expect(selectSearchTerms("ما هي هذا ؟")).toEqual([]);
    expect(selectSearchTerms("")).toEqual([]);
  });

  it("never returns more terms than the database accepts", () => {
    const question = Array.from(
      { length: 60 },
      (_, index) => "terme" + "abcdefghij"[index % 10] + index + "s",
    ).join(" ");
    expect(selectSearchTerms(question).length).toBeLessThanOrEqual(MAX_SEARCH_TERMS);
  });

  it("does not repeat a word", () => {
    const terms = selectSearchTerms("limite limite LIMITE");
    expect(terms).toEqual(["limite"]);
  });
});

describe("rankingTerms and stopwords", () => {
  it("returns normalised, stemmed, de-duplicated terms in question order", () => {
    expect(rankingTerms("Équations différentielles, équation")).toEqual([
      "equation",
      "differentielle",
    ]);
  });

  it("normalises the stopword list the same way as the text", () => {
    expect(CURRICULUM_STOPWORDS.has(normalizeCurriculumText("إلى"))).toBe(true);
    expect(CURRICULUM_STOPWORDS.has("equations")).toBe(false);
  });

  it("tokenises across Arabic and French punctuation", () => {
    expect(tokenizeCurriculumText("نهاية، الدالة؟ l'équation:")).toEqual([
      "نهايه",
      "داله",
      "l",
      "equation",
    ]);
  });
});
