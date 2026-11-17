import { describe, expect, it } from "vitest";
import { convertLatexTableEnvironments } from "./latexTableEnvironments";

describe("convertLatexTableEnvironments", () => {
  it("converts tabular into the app Markdown table block", () => {
    const source = "\\begin{tabular}{|c|r|}\nA & B \\\\\n1 & 2 \\\\\n\\end{tabular}";
    const result = convertLatexTableEnvironments(source);
    expect(result).toContain("mdtable");
    expect(result).toContain("| A | B |");
    expect(result).toContain("| 1 | 2 |");
    expect(result).not.toContain("\\begin{tabular}");
  });

  it("keeps ampersands inside braced cell content", () => {
    const source = "\\begin{tabular}{c}\n\\text{A & B} \\\\\n\\end{tabular}";
    const result = convertLatexTableEnvironments(source);
    expect(result).toContain("\\text{A & B}");
    expect(result).toContain("| :---: |");
  });

  it("converts array and removes surrounding display math delimiters", () => {
    const source = "\\[\n\\begin{array}{c|c}\nx & f(x) \\\\\n1 & 2\n\\end{array}\n\\]";
    const result = convertLatexTableEnvironments(source);
    expect(result).toContain("| $x$ | $f(x)$ |");
    expect(result).toContain("| $1$ | $2$ |");
    expect(result).not.toContain("\\[");
    expect(result).not.toContain("\\]");
  });

  it("leaves malformed environments unchanged", () => {
    const malformed = "\\begin{tabular}{cc}A & B";
    expect(convertLatexTableEnvironments(malformed)).toBe(malformed);
  });

  it("does not change ordinary Markdown", () => {
    const markdown = "| A | B |\n|---|---|\n| 1 | 2 |";
    expect(convertLatexTableEnvironments(markdown)).toBe(markdown);
  });
});
