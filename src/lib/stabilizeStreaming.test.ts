import { describe, it, expect } from "vitest";
import { stabilizeStreaming } from "./stabilizeStreaming";

describe("stabilizeStreaming", () => {
  it("hides an unclosed inline/block math", () => {
    expect(stabilizeStreaming("a $x_1 = \\frac{v")).toBe("a ");
    expect(stabilizeStreaming("a $$x = 1")).toBe("a ");
  });
  it("hides an unclosed \\( or \\[", () => {
    expect(stabilizeStreaming("a \\(x = 1")).toBe("a ");
    expect(stabilizeStreaming("a \\[x = 1")).toBe("a ");
    expect(stabilizeStreaming("a \\(x\\) b")).toBe("a \\(x\\) b");
  });
  it("hides a partial trailing table row but keeps complete ones", () => {
    const done = "| x | 1 |\n|---|---|\n| f | 2 |";
    expect(stabilizeStreaming(done)).toBe(done);
    expect(stabilizeStreaming(done + "\n| g | 3")).toBe(done + "\n");
    expect(stabilizeStreaming(done + "\n|")).toBe(done + "\n");
  });
});
