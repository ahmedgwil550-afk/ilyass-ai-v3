import { describe, expect, it } from "vitest";
import {
  chunkDocument,
  chunkPages,
  cleanExtractedText,
  diagnoseExtractedText,
  headingStrength,
  isHeadingLine,
  removeRepeatedLines,
  splitPages,
} from "./curriculumChunker";

// All text below is invented to exercise the chunker; it is not curriculum content.
const RLM = String.fromCharCode(0x200f);
const LAM_ALEF_SHAPED = String.fromCharCode(0xfefb);
const FI_LIGATURE = String.fromCharCode(0xfb01);

describe("cleanExtractedText", () => {
  it("unshapes Arabic presentation forms and Latin ligatures", () => {
    expect(cleanExtractedText(LAM_ALEF_SHAPED + " " + FI_LIGATURE + "n")).toBe("لا fin");
  });

  it("keeps mathematical letters and superscripts untouched", () => {
    expect(cleanExtractedText("x² ∈ ℝ")).toBe("x² ∈ ℝ");
  });

  it("removes invisible direction marks and normalises line endings", () => {
    expect(cleanExtractedText("a" + RLM + "b\r\nc\rd")).toBe("ab\nc\nd");
  });

  it("joins a French word split by a line-end hyphen, but not a minus sign", () => {
    expect(cleanExtractedText("le calcu-\nler et x-\n1")).toBe("le calculer et x-\n1");
  });
});

describe("splitPages", () => {
  it("splits on form feeds and ignores empty trailing pages", () => {
    expect(splitPages("a\fb\f")).toEqual(["a", "b"]);
    expect(splitPages("only")).toEqual(["only"]);
  });
});

describe("removeRepeatedLines", () => {
  const page = (n: number) =>
    "الامتحان الوطني الموحد\nنص فريد للصفحة " + (n + 100) + "\nالصفحة " + n + " / 6";

  it("drops headers, footers and page numbers that repeat across pages", () => {
    const result = removeRepeatedLines([1, 2, 3, 4, 5, 6].map(page));

    expect(result.pages[0]).toBe("نص فريد للصفحة 101");
    expect(result.removed).toHaveLength(2);
    expect(result.removed).toContain("الامتحان الوطني الموحد");
  });

  it("leaves short documents alone", () => {
    const pages = [1, 2, 3].map(page);
    expect(removeRepeatedLines(pages)).toEqual({ pages, removed: [] });
  });

  it("keeps long lines even when they repeat", () => {
    const long = "ملاحظة طويلة ".repeat(12);
    const pages = [1, 2, 3, 4, 5].map((n) => long + "\nسطر " + n * 7777);
    expect(removeRepeatedLines(pages).pages[0]).toContain("ملاحظة طويلة");
  });
});

describe("isHeadingLine", () => {
  it("recognises Arabic and French section and exercise titles", () => {
    for (const line of [
      "التمرين الأول (3 نقط)",
      "Exercice 2 :",
      "Partie A",
      "عناصر الإجابة",
      "Corrigé",
      "الدرس 4",
      "Chapitre 3 - Limites",
    ]) {
      expect(isHeadingLine(line)).toBe(true);
    }
  });

  it("does not take ordinary sentences or long lines as titles", () => {
    expect(isHeadingLine("Le calcul de la limite est simple")).toBe(false);
    expect(isHeadingLine("نحسب نهاية الدالة عند اللانهاية")).toBe(false);
    expect(isHeadingLine("Exercice " + "très long ".repeat(20))).toBe(false);
    expect(isHeadingLine("")).toBe(false);
  });
});

describe("headingStrength", () => {
  it("separates titles that always start a passage from sub-section titles", () => {
    expect(headingStrength("Exercice 3")).toBe("strong");
    expect(headingStrength("التمرين الثاني")).toBe("strong");
    expect(headingStrength("Corrigé")).toBe("strong");
    expect(headingStrength("Partie B")).toBe("weak");
    expect(headingStrength("سلم التنقيط")).toBe("weak");
    expect(headingStrength("Une phrase ordinaire")).toBeNull();
  });
});

describe("chunkPages", () => {
  it("keeps short sub-sections together with the exercise they belong to", () => {
    const { chunks } = chunkPages([
      "Problème (10 points)\n\nPartie A : étude d'une fonction g sur son domaine de définition.\n\nPartie B : calcul d'une aire et d'une intégrale.",
    ]);

    expect(chunks).toHaveLength(1);
    expect(chunks[0].metadata.heading).toBe("Problème (10 points)");
    expect(chunks[0].content).toContain("Partie B");
  });

  it("splits at a sub-section title once the passage is already long", () => {
    const long = "Une phrase de contexte assez longue pour remplir le passage. ".repeat(10).trim();
    const { chunks } = chunkPages([
      "Exercice 1\n\n" + long + "\n\nPartie B : la suite du travail demandé.",
    ]);

    expect(chunks).toHaveLength(2);
    expect(chunks[1].metadata.heading).toBe("Partie B : la suite du travail demandé.");
  });

  it("starts a new passage at each exercise title and records the title and page", () => {
    const pages = [
      "Exercice 1\n\nCalculer la limite de la fonction f en l'infini et interpréter le résultat obtenu.",
      "Exercice 2\n\nÉtudier les variations de la fonction g puis dresser son tableau de variations complet.",
    ];
    const { chunks } = chunkPages(pages);

    expect(chunks).toHaveLength(2);
    expect(chunks[0].metadata).toEqual({ page: 1, heading: "Exercice 1" });
    expect(chunks[1].metadata).toEqual({ page: 2, heading: "Exercice 2" });
    expect(chunks[1].content).toContain("variations de la fonction g");
  });

  it("closes a passage near the target size and never exceeds the maximum", () => {
    const paragraph = (n: number) => "Paragraphe " + n + ". " + "mot ".repeat(90);
    const pages = [Array.from({ length: 20 }, (_, n) => paragraph(n)).join("\n\n")];
    const { chunks } = chunkPages(pages, { targetChars: 1000, maxChars: 1500 });

    expect(chunks.length).toBeGreaterThan(5);
    for (const chunk of chunks) expect(chunk.content.length).toBeLessThanOrEqual(1500);
  });

  it("splits one huge paragraph at sentence ends", () => {
    const sentence = "Voici une phrase complète qui dit quelque chose d'utile sur la fonction. ";
    const { chunks } = chunkPages([sentence.repeat(60)], { targetChars: 800, maxChars: 1000 });

    expect(chunks.length).toBeGreaterThan(3);
    for (const chunk of chunks) {
      expect(chunk.content.length).toBeLessThanOrEqual(1000);
      expect(chunk.content.endsWith("fonction.")).toBe(true);
    }
  });

  it("splits a single endless word run without losing text", () => {
    const run = "x".repeat(5000);
    const { chunks } = chunkPages([run], { maxChars: 1000 });

    expect(chunks.map((chunk) => chunk.content).join("")).toBe(run);
  });

  it("loses no words from the source", () => {
    const words = Array.from({ length: 400 }, (_, n) => "mot" + n);
    const pages = [words.slice(0, 200).join(" "), words.slice(200).join(" ")];
    const found = new Set(chunkPages(pages).chunks.flatMap((chunk) => chunk.content.split(/\s+/)));

    for (const word of words) expect(found.has(word)).toBe(true);
  });

  it("records the last page when a passage spans pages", () => {
    const { chunks } = chunkPages([
      "Première page avec du texte utile.",
      "Seconde page avec la suite du texte.",
    ]);

    expect(chunks).toHaveLength(1);
    expect(chunks[0].metadata).toEqual({ page: 1, pageEnd: 2 });
  });

  it("merges a tiny trailing fragment into the previous passage", () => {
    const body = "Une phrase suffisamment longue pour former un passage. ".repeat(4).trim();
    const { chunks, droppedFragments } = chunkPages([body + "\n\nExercice 2\n\nok"]);

    expect(droppedFragments).toEqual([]);
    expect(chunks.map((chunk) => chunk.content).join(" ")).toContain("ok");
  });

  it("reports a fragment it has to drop instead of dropping it silently", () => {
    const result = chunkPages(["ab"]);

    expect(result.chunks).toEqual([]);
    expect(result.droppedFragments).toEqual(["ab"]);
  });
});

describe("chunkDocument", () => {
  it("cleans, removes page furniture and chunks a whole extracted PDF", () => {
    const header = "المملكة المغربية — الامتحان الوطني";
    const pages = [1, 2, 3, 4, 5].map(
      (n) =>
        header +
        "\nالتمرين " +
        n +
        "\nنص التمرين رقم " +
        n +
        " يطلب حساب نهاية دالة عند اللانهاية وتبرير الجواب.\nصفحة " +
        n,
    );
    const result = chunkDocument(pages.join("\f"));

    expect(result.pages).toBe(5);
    expect(result.chunks).toHaveLength(5);
    expect(result.chunks[2].content).not.toContain("الامتحان الوطني");
    expect(result.chunks[2].content).toContain("نص التمرين رقم 3");
    expect(result.chunks[2].metadata.page).toBe(3);
    expect(result.removedLines).toContain(header);
  });
});

describe("diagnoseExtractedText", () => {
  const codes = (text: string) => diagnoseExtractedText(text).map((warning) => warning.code);
  const normalArabic = "في هذا التمرين نحسب النهاية من جديد على الدالة التي أعطيت. ".repeat(20);

  it("accepts ordinary extracted Arabic", () => {
    expect(codes(normalArabic)).toEqual([]);
  });

  it("flags Arabic that came out with its letters reversed", () => {
    const reversed = Array.from(normalArabic.split(" "), (word) =>
      Array.from(word).reverse().join(""),
    ).join(" ");
    expect(codes(reversed)).toEqual(["reversed-arabic"]);
  });

  it("flags a PDF with no text layer", () => {
    expect(codes("\f\f  \n")).toEqual(["no-text"]);
  });

  it("flags very little text per page", () => {
    expect(codes("صفحة\fصفحة\fصفحة")).toContain("little-text");
  });

  it("flags damaged characters", () => {
    const damaged = String.fromCharCode(0xfffd).repeat(4);
    expect(codes(normalArabic + damaged)).toEqual(["replacement-characters"]);
  });
});
