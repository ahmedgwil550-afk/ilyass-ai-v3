import { describe, it, expect } from "vitest";
import { checkArithmetic } from "./numberCheck";

describe("checkArithmetic", () => {
  it("accepts correct numeric equalities", () => {
    expect(checkArithmetic("$2{,}5 \\times 4 = 10$")).toHaveLength(0);
    expect(checkArithmetic("$\\frac{3}{4} = 0{,}75$")).toHaveLength(0);
    expect(checkArithmetic("$10^{-3} \\times 5 = 5 \\times 10^{-3}$")).toHaveLength(0);
    expect(checkArithmetic("$3{,}14 \\times 2 = 6{,}3 \\approx 6{,}28$")).toHaveLength(0);
  });
  it("flags wrong results", () => {
    expect(checkArithmetic("$2{,}5 \\times 4 = 12$")).toHaveLength(1);
    expect(checkArithmetic("$$12 \\times 3 = 35$$")).toHaveLength(1);
  });
  it("ignores expressions with symbols or units", () => {
    expect(checkArithmetic("$v = \\frac{d}{t} = 4 \\mathrm{m}$")).toHaveLength(0);
  });
});
