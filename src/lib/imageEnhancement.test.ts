import { describe, expect, it } from "vitest";
import { getIlluminationGain } from "./imageEnhancement";

describe("getIlluminationGain", () => {
  it("does not amplify already bright paper", () => {
    expect(getIlluminationGain(255)).toBeLessThanOrEqual(1);
    expect(getIlluminationGain(242)).toBe(1);
  });

  it("gently lifts moderate shadows", () => {
    expect(getIlluminationGain(180)).toBeGreaterThan(1);
    expect(getIlluminationGain(180)).toBeLessThanOrEqual(1.32);
  });

  it("caps aggressive correction for very dark backgrounds", () => {
    expect(getIlluminationGain(20)).toBe(1.32);
  });

  it("returns a neutral gain for invalid measurements", () => {
    expect(getIlluminationGain(Number.NaN)).toBe(1);
    expect(getIlluminationGain(Number.POSITIVE_INFINITY)).toBe(1);
  });

  it("never applies an extreme darkening gain", () => {
    expect(getIlluminationGain(255)).toBeGreaterThanOrEqual(0.82);
  });
});
