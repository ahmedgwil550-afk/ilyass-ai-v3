import { describe, it, expect } from "vitest";
import { rehypeMathBlocks } from "./rehypeMathBlocks";

const el = (tagName: string, className: string[], children: any[] = []) => ({ type: "element", tagName, properties: { className }, children });

describe("rehypeMathBlocks", () => {
  it("wraps display math, leaves inline math untouched and does not descend into KaTeX output", () => {
    const tree: any = {
      type: "root",
      children: [
        el("p", [], [el("span", ["katex"], [el("span", ["katex-display"])])]),
        el("span", ["katex-display"], [el("span", ["katex"])]),
        el("div", [], [el("span", ["katex-display"])]),
      ],
    };
    rehypeMathBlocks()(tree);
    expect(tree.children[0].children[0].tagName).toBe("span");
    expect(tree.children[1].tagName).toBe("mathblock");
    expect(tree.children[1].children[0].tagName).toBe("span");
    expect(tree.children[2].children[0].tagName).toBe("mathblock");
  });
});
