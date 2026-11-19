import { describe, expect, it } from "vitest";
import { extractSvg, sanitizeSvg, SVG_LIMITS } from "./svgSanitize";

const wrap = (inner: string, attrs = "") => `<svg ${attrs} viewBox="0 0 10 10" onload="alert(1)">${inner}</svg>`;
const clean = (s: string | null) => s ?? "";

describe("extractSvg", () => {
  it("يستخرج من سياج Markdown وكلام حوله", () => {
    const t = "إليك:\n```svg\n<svg><line x1='0' y1='0' x2='5' y2='5'/></svg>\n```\nانتهى";
    expect(extractSvg(t)).toBe("<svg><line x1='0' y1='0' x2='5' y2='5'/></svg>");
  });
  it("لا svg = null", () => {
    expect(extractSvg("لا أستطيع")).toBe(null);
    expect(extractSvg("</svg> <svg>")).toBe(null);
  });
});

describe("sanitizeSvg: الحالة السليمة", () => {
  it("يعيد كتابة الجذر بـ viewBox ثابت ويُبقي الأشكال", () => {
    const out = clean(sanitizeSvg(
      `<svg width="9999" height="9999" viewBox="5 5 5 5"><line x1="10" y1="20" x2="300" y2="400" stroke="#000" stroke-width="3"/><circle cx="50" cy="60" r="20"/></svg>`,
      800, 600,
    ));
    expect(out.startsWith('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 800 600" width="800" height="600" preserveAspectRatio="none">')).toBe(true);
    expect(out.includes('x1="10"')).toBe(true);
    expect(out.includes("<circle")).toBe(true);
  });

  it("الافتراضات: بلا fill يصير none (لا أجسام سوداء مملوءة) وبلا stroke يصير داكناً", () => {
    const out = clean(sanitizeSvg(`<svg><circle cx="5" cy="5" r="3"/></svg>`, 100, 100));
    expect(out.includes('fill="none"')).toBe(true);
    expect(out.includes('stroke="#111"')).toBe(true);
    expect(out.includes('stroke-width="2"')).toBe(true);
  });

  it("fill صريح يُحترم (رؤوس الأسهم)", () => {
    const out = clean(sanitizeSvg(`<svg><polygon points="0,0 10,5 0,10" fill="#000"/></svg>`, 100, 100));
    expect(out.includes('fill="#000"')).toBe(true);
  });

  it("النص يمرّ مع الهروب، ويُقصّ طوله", () => {
    const out = clean(sanitizeSvg(`<svg><text x="5" y="5">A &lt;b&gt; &amp; ${"z".repeat(100)}</text></svg>`, 100, 100));
    expect(out.includes("A &lt;b&gt; &amp; ")).toBe(true);
    const inner = out.match(/<text[^>]*>([^<]*)<\/text>/)![1];
    expect(inner.length <= SVG_LIMITS.maxTextChars + 10).toBe(true);
  });

  it("مجموعات متداخلة وtransform آمن", () => {
    const out = clean(sanitizeSvg(`<svg><g transform="translate(10, 20) rotate(45)"><path d="M0 0 L10 10 Q 5 5 0 10 Z"/></g></svg>`, 100, 100));
    expect(out.includes("<g transform=")).toBe(true);
    expect(out.includes("<path")).toBe(true);
  });
});

describe("sanitizeSvg: ما يجب أن يسقط", () => {
  it("سكربتات ومعالجات أحداث لا تصل أبداً", () => {
    const out = clean(sanitizeSvg(wrap(`<script>alert(1)</script><line x1="0" y1="0" x2="5" y2="5" onclick="evil()"/>`), 100, 100));
    expect(out.toLowerCase().includes("script")).toBe(false);
    expect(out.includes("onclick")).toBe(false);
    expect(out.includes("onload")).toBe(false);
    expect(out.includes("<line")).toBe(true);
  });

  it("foreignObject وimage وuse وstyle تُحذف مع ما تحتها", () => {
    const out = clean(sanitizeSvg(
      wrap(`<foreignObject><div><line x1="1" y1="1" x2="2" y2="2"/></div></foreignObject><image href="https://evil/x.png"/><use href="#a"/><style>*{fill:url(http://x)}</style><circle cx="5" cy="5" r="2"/>`),
      100, 100,
    ));
    for (const bad of ["foreignobject", "<image", "<use", "<style", "<div", "evil"]) expect(out.toLowerCase().includes(bad)).toBe(false);
    expect(out.includes("<circle")).toBe(true);
    expect(out.includes("<line")).toBe(false); // الخط كان داخل foreignObject فسقط معه
  });

  it("قيم خطرة في الخصائص تُحذف: url() وjavascript: وتعابير غريبة", () => {
    const out = clean(sanitizeSvg(
      wrap(`<rect x="0" y="0" width="5" height="5" fill="url(#x)" stroke="javascript:alert(1)" transform="translate(1) foo(2)" style="fill:red" href="http://e"/>`),
      100, 100,
    ));
    expect(out.includes("url(")).toBe(false);
    expect(out.includes("javascript")).toBe(false);
    expect(out.includes("foo(")).toBe(false);
    expect(out.includes("style=")).toBe(false);
    expect(out.includes("href")).toBe(false);
    expect(out.includes('fill="none"')).toBe(true);
  });

  it("path.d بمحارف غير مسموحة تُحذف الخاصية", () => {
    const out = clean(sanitizeSvg(wrap(`<path d="M0 0 L10 10 <script>"/><path d="M0 0 L5 5"/>`), 100, 100));
    expect(out.includes("script")).toBe(false);
    expect(out.includes('d="M0 0 L5 5"')).toBe(true);
  });

  it("svg متداخل داخل الجذر يسقط", () => {
    const out = clean(sanitizeSvg(`<svg><svg onload="x"><line x1="0" y1="0" x2="1" y2="1"/></svg><circle cx="1" cy="1" r="1"/></svg>`, 100, 100));
    expect(out.includes("onload")).toBe(false);
    expect(out.includes("<line")).toBe(false);
    expect(out.includes("<circle")).toBe(true);
  });

  it("DOCTYPE وCDATA والتعليقات والمعالجات لا تمرّ", () => {
    const out = clean(sanitizeSvg(`<?xml version="1.0"?><!DOCTYPE svg [<!ENTITY x "y">]><svg><!-- c --><![CDATA[<script>]]><line x1="0" y1="0" x2="5" y2="5"/></svg>`, 100, 100));
    expect(out.includes("ENTITY")).toBe(false);
    expect(out.includes("CDATA")).toBe(false);
    expect(out.includes("<line")).toBe(true);
  });

  it("وسوم غير متوازنة أو معطوبة = null", () => {
    expect(sanitizeSvg(`<svg><g><line x1="0" y1="0" x2="5" y2="5"/></svg>`, 100, 100)).toBe(null);
    expect(sanitizeSvg(`<svg><line x1="0" y1="0" x2="5" y2="5"/></g></svg>`, 100, 100)).toBe(null);
    expect(sanitizeSvg(`<svg><line x1="0" <<< /></svg>`, 100, 100)).toBe(null);
  });

  it("بلا أي شكل مرسوم = null (لا نعرض صفحة بيضاء على أنها نجاح)", () => {
    expect(sanitizeSvg(`<svg></svg>`, 100, 100)).toBe(null);
    expect(sanitizeSvg(`<svg><g></g><desc>x</desc></svg>`, 100, 100)).toBe(null);
  });

  it("مدخلات غير صالحة: أبعاد وحجم وأنواع", () => {
    const ok = `<svg><line x1="0" y1="0" x2="1" y2="1"/></svg>`;
    expect(sanitizeSvg(ok, 0, 100)).toBe(null);
    expect(sanitizeSvg(ok, 100, NaN)).toBe(null);
    expect(sanitizeSvg(ok, 9000, 100)).toBe(null);
    expect(sanitizeSvg("x".repeat(SVG_LIMITS.maxChars + 1), 100, 100)).toBe(null);
    expect(sanitizeSvg(undefined as unknown as string, 100, 100)).toBe(null);
  });

  it("عدد العناصر مسقوف", () => {
    const many = `<svg>${'<line x1="0" y1="0" x2="1" y2="1"/>'.repeat(SVG_LIMITS.maxElements + 5)}</svg>`;
    expect(sanitizeSvg(many, 100, 100)).toBe(null);
  });

  it("خاصية مكررة: الأولى تفوز (لا تحايل بالتكرار)", () => {
    const out = clean(sanitizeSvg(`<svg><line x1="1" x1="999" y1="0" x2="5" y2="5"/></svg>`, 100, 100));
    expect(out.includes('x1="1"')).toBe(true);
    expect(out.includes("999")).toBe(false);
  });

  it("الناتج لا يحوي أي محرف < أو > داخل قيم الخصائص", () => {
    const out = clean(sanitizeSvg(`<svg><text x="1" y="1" font-family="Arial'><script>">t</text></svg>`, 100, 100));
    expect(out.includes("<script")).toBe(false);
  });
});
