import { describe, expect, it } from "vitest";
import { constantTimeTextEqual } from "./unlock";

describe("constantTimeTextEqual", () => {
  it("accepts only the exact configured code", () => {
    expect(constantTimeTextEqual("correct-code", "correct-code")).toBe(true);
    expect(constantTimeTextEqual("correct-code ", "correct-code")).toBe(false);
    expect(constantTimeTextEqual("wrong-code", "correct-code")).toBe(false);
  });
});