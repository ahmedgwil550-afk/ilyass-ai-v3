import { describe, expect, it } from "vitest";
import { findUnitMismatches, parseUnitDimension, unitsHaveSameDimension } from "./unitEngine";

describe("unitEngine", () => {
  it("parses base and derived SI dimensions", () => {
    expect(parseUnitDimension("m")).not.toBeNull();
    expect(unitsHaveSameDimension("N", "kg.m.s^-2")).toBe(true);
    expect(unitsHaveSameDimension("J", "N.m")).toBe(true);
    expect(unitsHaveSameDimension("W", "J/s")).toBe(true);
  });

  it("recognizes equivalent prefixed units by dimension", () => {
    expect(unitsHaveSameDimension("cm", "m")).toBe(true);
    expect(unitsHaveSameDimension("mL", "cm^3")).toBe(true);
    expect(unitsHaveSameDimension("ms", "h")).toBe(true);
  });

  it("rejects different dimensions and skips unknown expressions", () => {
    expect(unitsHaveSameDimension("m", "s")).toBe(false);
    expect(unitsHaveSameDimension("foo", "m")).toBeNull();
    expect(unitsHaveSameDimension("m//s", "m")).toBeNull();
  });

  it("only reports explicit two-unit equalities", () => {
    const answer = "Résultat : $v = 3\\,\\mathrm{m} = 3\\,\\mathrm{s}$\nCorrect : $d = 3\\,\\mathrm{m} = 300\\,\\mathrm{cm}$";
    expect(findUnitMismatches(answer)).toHaveLength(1);
    expect(findUnitMismatches(answer)[0]).toMatchObject({ left: "m", right: "s" });
  });
});
