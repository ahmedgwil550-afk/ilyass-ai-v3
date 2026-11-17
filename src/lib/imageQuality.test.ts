import { describe, expect, it } from "vitest";
import { classifyDocumentPhoto } from "./imageQuality";

const baseline = {
  brightness: 220,
  contrast: 48,
  sharpness: 35,
  brightPixelRatio: 0.2,
};

describe("classifyDocumentPhoto", () => {
  it("does not warn on a well-lit, sharp document", () => {
    expect(classifyDocumentPhoto(baseline)).toEqual([]);
  });

  it("warns when the page is too dark", () => {
    expect(classifyDocumentPhoto({ ...baseline, brightness: 82 })).toContain("low-light");
  });

  it("warns when a page has weak contrast", () => {
    expect(classifyDocumentPhoto({ ...baseline, contrast: 12 })).toContain("low-contrast");
  });

  it("warns about blur only when the image has enough contrast to contain detail", () => {
    expect(classifyDocumentPhoto({ ...baseline, sharpness: 5 })).toContain("blur");
    expect(classifyDocumentPhoto({ ...baseline, sharpness: 5, contrast: 8 })).not.toContain("blur");
  });

  it("flags likely glare when most pixels are clipped and contrast is low", () => {
    expect(classifyDocumentPhoto({ ...baseline, brightPixelRatio: 0.8, contrast: 20 })).toContain("glare");
  });

  it("does not treat a bright white sheet as glare by itself", () => {
    expect(classifyDocumentPhoto({ ...baseline, brightness: 248, contrast: 45, brightPixelRatio: 0.9 })).toEqual([]);
  });
});
