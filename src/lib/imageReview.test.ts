import { describe, expect, it } from "vitest";
import { needsImageReview } from "./imageReview";

describe("needsImageReview", () => {
  it("does not interrupt when the transcription is clearly readable", () => {
    expect(needsImageReview("READABILITY: ok\n$2x + 3 = 7$")).toBe(false);
  });

  it("requests review when a mathematical symbol is marked uncertain", () => {
    expect(needsImageReview("Equation: $x^{[?]} = 4$")).toBe(true);
  });

  it("requests review for partial or poor readability", () => {
    expect(needsImageReview("READABILITY: partial — question 2 is blurred")).toBe(true);
    expect(needsImageReview("READABILITY: poor")).toBe(true);
  });

  it("requests review for missing figures or low confidence notes", () => {
    expect(needsImageReview("FIGURE_MISSING: graph for question 2")).toBe(true);
    expect(needsImageReview("Confidence: low for question 3")).toBe(true);
  });

  it("fails safely for an empty transcription", () => {
    expect(needsImageReview("  ")).toBe(true);
  });
});
