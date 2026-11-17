import { describe, expect, it } from "vitest";
import { compareReadings, comparisonIssues, readingFeatures, readingSignals, signalIssues, texteSection } from "./reading";
import { REREAD_SYSTEM } from "./prompts";

const SHEET = (body: string, tail = "READABILITY: ok") => `## Texte\n${body}\n\n## Figures\nCourbe ≈ (2,0 ; 3,5) ± 0,1\n\n## Lisibilité\n${tail}`;

describe("إشارات القراءة الأولى", () => {
  it("يلتقط الوضوح و[?] و FIGURE_MISSING", () => {
    const s = readingSignals(SHEET("1) Soit $f(x)=3[?]x$", "READABILITY: partial\nFIGURE_MISSING: la courbe de la question 2"));
    expect(s).toEqual({ readability: "partial", illegible: 1, figureMissing: true });
    expect(signalIssues(s).map((i) => i.kind)).toEqual(["reading_figure", "reading_illegible"]);
    expect(signalIssues(s).every((i) => i.source === "reading")).toBe(true);
  });
  it("قراءة سليمة لا تنتج ملاحظات، و[?] في قسم الأشكال لا يُحسب", () => {
    const s = readingSignals(`## Texte\nSoit $x=2$\n\n## Figures\nvaleur [?] non lisible\n\n## Lisibilité\nREADABILITY: ok`);
    expect(s.illegible).toBe(0);
    expect(signalIssues(s)).toEqual([]);
  });
  it("جودة ضعيفة تحذير، وجزئية وحدها معلومة فقط", () => {
    expect(signalIssues({ readability: "poor", illegible: 0, figureMissing: false })[0].severity).toBe("warn");
    expect(signalIssues({ readability: "partial", illegible: 0, figureMissing: false })[0].severity).toBe("info");
  });
  it("texteSection يقطع عند الترويسة التالية", () => {
    expect(texteSection(SHEET("abc")).trim()).toBe("abc");
    expect(texteSection("بلا ترويسات 12")).toBe("بلا ترويسات 12");
  });
});

describe("استخراج السمات", () => {
  it("أرقام بفاصلة عشرية وسالبة، دون أرقام الأسئلة", () => {
    const f = readingFeatures(SHEET("1) Calculer $2,5 + (-3)$ puis 12 cm\n2.1) Résoudre $x - 4 = 0$"));
    expect(f.numbers).toEqual(["2.5", "-3", "12", "4", "0"]);
  });
  it("كسور وأسس ودلائل لا تُحسب أرقاماً", () => {
    const f = readingFeatures(SHEET("1) $u_{n+1} = \\frac{1}{3} u_n^{2} + 10^{-3}$"));
    expect(f.fractions).toEqual(["1/3"]);
    expect(f.exponents.sort()).toEqual(["-3", "2"]);
    expect(f.indices).toEqual(["n+1", "n"]);
    expect(f.numbers).toEqual(["10"]);
  });
  it("وحدات ورموز وأبعاد الجداول", () => {
    const f = readingFeatures(SHEET("1) $m = 5 \\mathrm{mL}$ et $x \\leq 3$ avec $y > 2$\n| a | b | c |\n|---|---|---|\n| 1 | 2 | 3 |\n| 4 | 5 | 6 |"));
    expect(f.units).toContain("5|mL");
    expect(f.symbols.sort()).toEqual([">", "≤"]);
    expect(f.tables).toEqual(["3x3"]);
  });
});

describe("مقارنة قراءتين", () => {
  const base = "1) Soit $f(x) = \\frac{1}{3}x^{2} + 15$ sur $[0 ; 4]$.\n2) On donne $m = 5 \\mathrm{mL}$ et $x \\leq 3$.\n| a | b |\n|---|---|\n| 1 | 2 |";
  it("قراءتان متطابقتان لا ملاحظات", () => {
    const c = compareReadings(SHEET(base), SHEET(base));
    expect(c.comparable).toBe(true);
    expect(c.diffs).toEqual([]);
    expect(comparisonIssues(c)).toEqual([]);
  });
  it("رقم قُرئ 15 مقابل 16", () => {
    const c = compareReadings(SHEET(base), SHEET(base.replace("15", "16")));
    const issues = comparisonIssues(c);
    expect(issues).toHaveLength(1);
    expect(issues[0].kind).toBe("reading_numbers");
    expect(issues[0].ar).toContain("15");
    expect(issues[0].ar).toContain("16");
    expect(issues[0].severity).toBe("warn");
    expect(issues[0].source).toBe("reading");
  });
  it("أس وكسر ورمز ووحدة وجدول", () => {
    const other = base.replace("x^{2}", "x^{3}").replace("\\frac{1}{3}", "\\frac{1}{2}").replace("\\leq", "<").replace("mL", "L").replace("| a | b |", "| a | b | c |").replace("| 1 | 2 |", "| 1 | 2 | 9 |");
    const kinds = compareReadings(SHEET(base), SHEET(other)).diffs.map((d) => d.kind).sort();
    expect(kinds).toEqual(expect.arrayContaining(["exponents", "fractions", "symbols", "units", "tables"]));
  });
  it("قراءتان متباعدتان جداً = لا ملاحظات (تعذر التحقق)", () => {
    const other = "Exercice autre\n1) Soit $g(x) = 7x + 91$ sur $[2 ; 8]$ avec $a = 31$, $b = 44$, $c = 57$, $d = 68$.";
    const c = compareReadings(SHEET(base), SHEET(other));
    expect(c.divergent).toBe(true);
    expect(comparisonIssues(c)).toEqual([]);
  });
  it("نص قليل الأرقام: لا يصلح للمقارنة", () => {
    const c = compareReadings(SHEET("Lire le texte suivant."), SHEET("Lire le texte suivant."));
    expect(c.comparable).toBe(false);
  });
  it("الإنجليزي/العربي الأرقام الهندية تُطبَّع", () => {
    const f = readingFeatures(SHEET("1) المعادلة $x = ١٢$ و $y = 3,5$"));
    expect(f.numbers).toEqual(["12", "3.5"]);
  });
});

describe("قالب REREAD", () => {
  it("بلا backticks ولا ${ ولا شرطة مائلة عكسية", () => {
    expect(REREAD_SYSTEM).not.toMatch(/`|\$\{|\\/);
  });
});
