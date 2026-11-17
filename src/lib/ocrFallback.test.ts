import { describe, expect, it } from "vitest";
import { cleanOcrText, joinSpacedArabicLetters } from "./ocrFallback";

describe("joinSpacedArabicLetters", () => {
  it("merges letters that OCR spaced apart", () => {
    expect(joinSpacedArabicLetters("ا ل ك ت ا ب")).toBe("الكتاب");
  });

  it("keeps normal word spaces", () => {
    expect(joinSpacedArabicLetters("ذهب الولد إلى المدرسة")).toBe("ذهب الولد إلى المدرسة");
  });

  it("does not merge one or two stand-alone letters", () => {
    expect(joinSpacedArabicLetters("ذهب و جاء")).toBe("ذهب و جاء");
  });

  it("repairs a spaced word inside a normal sentence", () => {
    expect(joinSpacedArabicLetters("قرأ ا ل ك ت ا ب بسرعة")).toBe("قرأ الكتاب بسرعة");
  });
});

describe("cleanOcrText", () => {
  it("does not glue Arabic words together", () => {
    expect(cleanOcrText("أعرب ما تحته خط\nالعلمُ نورٌ")).toBe("أعرب ما تحته خط\nالعلمُ نورٌ");
  });

  it("leaves French and equations untouched", () => {
    expect(cleanOcrText("Calculer x = 2 + 3")).toBe("Calculer x = 2 + 3");
  });
});
