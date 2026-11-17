import { describe, it, expect } from "vitest";
import { splitSections } from "./answerSections";

const md = "intro line\n\n## 3. Montrer que $f$\nOn a :\n$$\nx=1\n# not a heading in math\n$$\n\n```\n# code comment\n```\n\n### ❓ 4. Déduire\n1. a\n2. b\n\n## Conclusion\nok";

describe("splitSections", () => {
  it("splits at headings, ignoring code fences and open $$ math", () => {
    const s = splitSections(md);
    expect(s.map((x) => x.variant)).toEqual(["plain", "question", "question", "plain"]);
    expect(s[1].body).toContain("# not a heading in math");
    expect(s[1].body).toContain("# code comment");
  });
  it("handles empty and single-heading input", () => {
    expect(splitSections("")).toHaveLength(0);
    expect(splitSections("## 1. Seul titre")).toHaveLength(1);
  });
  it("keeps finished sections identical while the answer streams in", () => {
    const early = splitSections(md.slice(0, md.indexOf("### ❓")));
    const full = splitSections(md);
    expect(early[0].body).toBe(full[0].body);
    expect(early[1].body.trimEnd()).toBe(full[1].body.trimEnd());
  });
});
