import { describe, expect, it } from "vitest";
import {
  acceptRedraw, additionsSvg, judgeRedraw, buildLocation, buildPlan, chooseStroke, clipLineToRect, describeDiagramWarning,
  dropEraseOverPoints, padBox, snapAdditions, straighten, toCropSpace, type Addition, type NamedPoint,
} from "./diagram";
import { inkMask } from "./diagramInk";

const near = (a: number, b: number, eps = 0.002) => Math.abs(a - b) <= eps;

/* ---------- مرحلة 1 ---------- */
describe("buildLocation", () => {
  const RAW = {
    found: true,
    figure_box_2d: [400, 100, 700, 600], // ymin,xmin,ymax,xmax بمقياس 1000
    erase_box_2d: [[400, 100, 440, 300]],
    task: "  Tracer   la tangente\nau point A.  ",
    figure_count: 1,
    confidence: "high",
  };

  it("يحوّل الصندوق ويضيف هامشاً ويُبقي نص المطلوب نظيفاً", () => {
    const r = buildLocation(RAW);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const c = r.location.crop;
    expect(near(c.x, 0.08) && near(c.y, 0.38) && near(c.w, 0.54) && near(c.h, 0.34)).toBe(true);
    expect(r.location.task).toBe("Tracer la tangente au point A.");
    expect(r.location.confidence).toBe("high");
    expect(r.location.warnings).toEqual([]);
  });

  it("منطقة المسح تُحوَّل إلى فضاء القصّ", () => {
    const r = buildLocation(RAW);
    if (!r.ok) throw new Error("expected ok");
    const e = r.location.erase[0];
    // المسح: y 0.40..0.44، x 0.10..0.30 على الورقة؛ القصّ يبدأ x=0.08,y=0.38 وأبعاده 0.54×0.34
    expect(near(e.x, 0.02 / 0.54, 0.005) && near(e.y, 0.02 / 0.34, 0.005)).toBe(true);
  });

  it("لا شكل = no_figure؛ شكل ضئيل = figure_too_small؛ نوع خاطئ = bad_shape", () => {
    expect(buildLocation({ found: false })).toEqual({ ok: false, reason: "no_figure" });
    expect(buildLocation({ found: true })).toEqual({ ok: false, reason: "no_figure" });
    expect(buildLocation({ figure_box_2d: [100, 100, 110, 130] })).toEqual({ ok: false, reason: "figure_too_small" });
    expect(buildLocation("x")).toEqual({ ok: false, reason: "bad_shape" });
    expect(buildLocation(null)).toEqual({ ok: false, reason: "bad_shape" });
    expect(buildLocation([1, 2])).toEqual({ ok: false, reason: "bad_shape" });
  });

  it("مناطق مسح خارج القصّ تُسقط مع تحذير", () => {
    const r = buildLocation({ ...RAW, erase_box_2d: [[0, 0, 100, 100], [400, 100, 440, 300]] });
    if (!r.ok) throw new Error("expected ok");
    expect(r.location.erase.length).toBe(1);
    expect(r.location.warnings).toEqual([{ code: "erase_dropped", detail: "1" }]);
  });

  it("منطقة مسح تغطي معظم الشكل = تُلغى كلها (لا نمسح الشكل نفسه)", () => {
    const r = buildLocation({ ...RAW, erase_box_2d: [[400, 100, 700, 600]] });
    if (!r.ok) throw new Error("expected ok");
    expect(r.location.erase).toEqual([]);
    expect(r.location.warnings.length).toBe(1);
  });

  it("مناطق صغيرة كثيرة مجموعها كبير = تُلغى كلها", () => {
    const boxes = [[400, 100, 700, 270], [400, 330, 700, 480]];
    const r = buildLocation({ ...RAW, erase_box_2d: boxes });
    if (!r.ok) throw new Error("expected ok");
    expect(r.location.erase).toEqual([]);
    expect(r.location.warnings[0].code).toBe("erase_too_large");
  });

  it("عدة أشكال تُنبّه، والثقة الغريبة تصير medium", () => {
    const r = buildLocation({ ...RAW, figure_count: 3, confidence: "super" });
    if (!r.ok) throw new Error("expected ok");
    expect(r.location.figureCount).toBe(3);
    expect(r.location.confidence).toBe("medium");
    expect(r.location.warnings).toEqual([{ code: "multiple_figures", detail: "3" }]);
  });
});

describe("toCropSpace / padBox / dropEraseOverPoints", () => {
  it("padBox يبقى داخل الصورة", () => {
    expect(padBox({ x: 0.01, y: 0.99, w: 0.5, h: 0.01 }, 0.05)).toEqual({ x: 0, y: 0.94, w: 0.56, h: 0.06 });
  });
  it("لا تقاطع = undefined", () => {
    expect(toCropSpace({ x: 0.9, y: 0.9, w: 0.05, h: 0.05 }, { x: 0, y: 0, w: 0.5, h: 0.5 })).toBe(undefined);
  });
  it("منطقة مسح فوق نقطة مسمّاة تسقط", () => {
    const pts: NamedPoint[] = [{ id: "A", x: 0.2, y: 0.1, snap: false }];
    const r = dropEraseOverPoints([{ x: 0.1, y: 0.05, w: 0.3, h: 0.1 }, { x: 0.6, y: 0.6, w: 0.2, h: 0.1 }], pts);
    expect(r.dropped).toBe(1);
    expect(r.erase.length).toBe(1);
    expect(r.erase[0].x).toBe(0.6);
  });
});

/* ---------- مرحلة 2 ---------- */
describe("buildPlan", () => {
  const PLAN = {
    figure_kind: "function_graph",
    summary: "منحنى f مع محوري الإحداثيات",
    points: [{ id: "A", x: 0.4, y: 0.5, snap: true }, { id: "B", x: 0.8, y: 0.2 }],
    additions: [
      { id: "t1", kind: "line", points: ["A", [0.7, 0.3]], extend: true, label: "(T)" },
      { kind: "point", points: [{ ref: "B" }], label: "B" },
      { kind: "arrow", points: [[0.1, 0.9], [0.4, 0.6]], dashed: true },
    ],
  };

  it("يقبل خطة سليمة ويحلّ المراجع", () => {
    const p = buildPlan(PLAN)!;
    expect(p.warnings).toEqual([]);
    expect(p.additions.length).toBe(3);
    expect(p.figureKind).toBe("function_graph");
    expect(p.additions[0].points[0]).toEqual({ x: 0.4, y: 0.5, snap: true });
    expect(p.additions[0].extend).toBe(true);
    expect(p.additions[1].points[0]).toEqual({ x: 0.8, y: 0.2, snap: false });
    expect(p.additions[2].dashed).toBe(true);
  });

  it("مرجع غير موجود يُسقط الإضافة كلها بسبب صريح ولا يُخمَّن", () => {
    const p = buildPlan({ ...PLAN, additions: [{ kind: "line", points: ["Z", [0.5, 0.5]] }] })!;
    expect(p.additions.length).toBe(0);
    expect(p.warnings[0]).toEqual({ code: "addition_dropped", detail: "a1: bad_ref" });
    expect(p.warnings[1]).toEqual({ code: "no_additions" });
  });

  it("إحداثيات بعيدة خارج الشكل أو غير رقمية تُسقط، والقريبة تُضبط", () => {
    const p = buildPlan({
      points: [],
      additions: [
        { kind: "point", points: [[1.4, 0.5]] },
        { kind: "point", points: [["a", 0.5]] },
        { kind: "point", points: [[1.05, -0.04]] },
      ],
    })!;
    expect(p.additions.length).toBe(1);
    expect(p.additions[0].points[0]).toEqual({ x: 1, y: 0, snap: false });
    expect(p.warnings.filter((w) => w.code === "addition_dropped").length).toBe(2);
  });

  it("عدد النقاط يُفحص حسب النوع", () => {
    const p = buildPlan({ additions: [
      { kind: "line", points: [[0.1, 0.1]] },
      { kind: "circle", points: [[0.1, 0.1], [0.2, 0.2], [0.3, 0.3]] },
      { kind: "angle", points: [[0.1, 0.1], [0.5, 0.5], [0.9, 0.1]] },
    ] })!;
    expect(p.additions.map((a) => a.kind)).toEqual(["angle"]);
    expect(p.warnings.filter((w) => (w.detail ?? "").includes("bad_arity")).length).toBe(2);
  });

  it("مستقيم/سهم منعدم الطول ودائرة بنصف قطر صفري تسقط", () => {
    const p = buildPlan({ additions: [
      { kind: "line", points: [[0.3, 0.3], [0.3, 0.3]] },
      { kind: "circle", points: [[0.3, 0.3], [0.3, 0.3]] },
      { kind: "arrow", points: [[0.3, 0.3], [0.5, 0.3]] },
    ] })!;
    expect(p.additions.length).toBe(1);
    expect(p.warnings.filter((w) => (w.detail ?? "").includes("degenerate")).length).toBe(2);
  });

  it("الأسماء البديلة للأنواع تُوحَّد، والمجهولة تسقط", () => {
    const p = buildPlan({ additions: [
      { kind: "Tangent", points: [[0.1, 0.1], [0.9, 0.9]] },
      { kind: "vector", points: [[0.1, 0.9], [0.9, 0.1]] },
      { kind: "dot", points: [[0.5, 0.5]] },
      { kind: "hexagon", points: [[0.5, 0.5]] },
    ] })!;
    expect(p.additions.map((a) => a.kind)).toEqual(["line", "arrow", "point"]);
    expect(p.warnings[0].detail).toBe("a4: bad_kind");
  });

  it("label بلا نص يسقط، والنص يمرّ على plain (LaTeX → رموز)", () => {
    const p = buildPlan({ additions: [
      { kind: "label", points: [[0.5, 0.5]], label: "" },
      { kind: "label", points: [[0.5, 0.5]], label: "$x^2$" },
    ] })!;
    expect(p.additions.length).toBe(1);
    expect(p.additions[0].label).toBe("x²");
  });

  it("مسار متعدد النقاط: النقاط المتكررة تُحذف", () => {
    const p = buildPlan({ additions: [{ kind: "polyline", points: [[0.1, 0.1], [0.1, 0.1], [0.5, 0.5], [0.9, 0.2]] }] })!;
    expect(p.additions[0].points.length).toBe(3);
  });

  it("سقف عدد الإضافات، ومعرّفات مكررة تُميَّز", () => {
    const many = Array.from({ length: 30 }, () => ({ id: "x", kind: "point", points: [[0.5, 0.5]] }));
    const p = buildPlan({ additions: many })!;
    expect(p.additions.length).toBe(24);
    expect(new Set(p.additions.map((a) => a.id)).size).toBe(24);
    expect(p.warnings.some((w) => (w.detail ?? "").includes("too_many"))).toBe(true);
  });

  it("extend لا يُحتسب إلا للمستقيم، ونوع الشكل الغريب يصير other", () => {
    const p = buildPlan({ figure_kind: "Weird Kind!", additions: [{ kind: "arrow", extend: true, points: [[0.1, 0.1], [0.5, 0.5]] }] })!;
    expect(p.additions[0].extend).toBe(false);
    expect(p.figureKind).toBe("other");
  });

  it("ليس كائناً = null", () => {
    expect(buildPlan(null)).toBe(null);
    expect(buildPlan("x")).toBe(null);
    expect(buildPlan([])).toBe(null);
  });

  it("المراجع غير حساسة لحالة الأحرف عند غياب تطابق حرفي", () => {
    const p = buildPlan({ points: [{ id: "a", x: 0.2, y: 0.2 }], additions: [{ kind: "point", points: ["A"] }] })!;
    expect(p.additions.length).toBe(1);
  });
});

/* ---------- الالتصاق ---------- */
describe("snapAdditions", () => {
  it("النقطة المعلَّمة snap تلتصق بمنتصف الخط الحقيقي، وغيرها لا تتحرك", () => {
    const W = 200, H = 100;
    const g = new Uint8Array(W * H).fill(240);
    for (let y = 48; y < 53; y++) for (let x = 10; x < 190; x++) g[y * W + x] = 20; // خط أفقي سُمكه 5، منتصفه y=50
    const mask = inkMask(g, W, H);
    const adds: Addition[] = [{
      id: "a", kind: "line", label: "", dashed: false, extend: false,
      points: [{ x: 0.5, y: 0.45, snap: true }, { x: 0.9, y: 0.1, snap: false }],
    }];
    const r = snapAdditions(adds, mask, W, H, 10, 5);
    expect(r.snapped).toBe(1);
    expect(Math.abs(r.additions[0].points[0].y * H - 50.5) < 1.2).toBe(true);
    expect(r.additions[0].points[1]).toEqual({ x: 0.9, y: 0.1, snap: false });
    expect(adds[0].points[0].y).toBe(0.45); // الأصل لا يتغير
  });

  it("لا حبر قريب = لا التصاق", () => {
    const mask = new Uint8Array(100 * 100);
    const adds: Addition[] = [{ id: "a", kind: "point", label: "", dashed: false, extend: false, points: [{ x: 0.5, y: 0.5, snap: true }] }];
    const r = snapAdditions(adds, mask, 100, 100, 8, 3);
    expect(r.snapped).toBe(0);
    expect(r.additions[0].points[0]).toEqual({ x: 0.5, y: 0.5, snap: true });
  });
});

/* ---------- الرسم ---------- */
describe("chooseStroke", () => {
  it("يتبع سُمك الشكل مضروباً بالتكبير، بين حدّ أدنى مرئي وأعلى معقول", () => {
    expect(chooseStroke(2, 2, 1600)).toBe(5.6); // 2*2*1.25=5 → لكن الحدّ الأدنى 1600*0.0035=5.6
    expect(chooseStroke(4, 2, 1600)).toBe(10);
    expect(chooseStroke(40, 4, 1600)).toBe(19.2); // سقف 1.2%
    expect(chooseStroke(0.1, 1, 300)).toBe(3); // شكل رفيع جداً: حدّ مطلق 3
  });
});

describe("clipLineToRect", () => {
  it("يمدّ مائلاً إلى الحافتين", () => {
    const r = clipLineToRect({ x: 40, y: 40 }, { x: 60, y: 60 }, 100, 100)!;
    expect(near(r[0].x, 0, 1e-6) && near(r[0].y, 0, 1e-6) && near(r[1].x, 100, 1e-6) && near(r[1].y, 100, 1e-6)).toBe(true);
  });
  it("أفقي وعمودي", () => {
    const h = clipLineToRect({ x: 10, y: 30 }, { x: 20, y: 30 }, 100, 80)!;
    expect(h[0]).toEqual({ x: 0, y: 30 });
    expect(h[1]).toEqual({ x: 100, y: 30 });
    const v = clipLineToRect({ x: 30, y: 10 }, { x: 30, y: 20 }, 100, 80)!;
    expect(v[0]).toEqual({ x: 30, y: 0 });
    expect(v[1]).toEqual({ x: 30, y: 80 });
  });
  it("نقطتان خارج المستطيل لكن المستقيم يقطعه: يُقصّ", () => {
    const r = clipLineToRect({ x: -50, y: 50 }, { x: -20, y: 50 }, 100, 100)!;
    expect(r[0].x).toBe(0);
    expect(r[1].x).toBe(100);
  });
  it("مستقيم خارج المستطيل = null", () => {
    expect(clipLineToRect({ x: 0, y: 150 }, { x: 100, y: 150 }, 100, 100)).toBe(null);
  });
});

describe("additionsSvg", () => {
  const add = (o: Partial<Addition> & Pick<Addition, "kind" | "points">): Addition => ({ id: "a", label: "", dashed: false, extend: false, ...o });
  const P = (x: number, y: number) => ({ x, y, snap: false });

  it("يرسم كل نوع بسُمك ثابت ولون حبر المصحّح", () => {
    const svg = additionsSvg([
      add({ kind: "line", points: [P(0.1, 0.1), P(0.5, 0.5)] }),
      add({ kind: "arrow", points: [P(0.1, 0.9), P(0.5, 0.6)] }),
      add({ kind: "polyline", points: [P(0.1, 0.5), P(0.3, 0.2), P(0.6, 0.3)] }),
      add({ kind: "point", points: [P(0.5, 0.5)], label: "A" }),
      add({ kind: "circle", points: [P(0.5, 0.5), P(0.6, 0.5)] }),
      add({ kind: "angle", points: [P(0.8, 0.5), P(0.5, 0.5), P(0.7, 0.2)], label: "α" }),
      add({ kind: "label", points: [P(0.2, 0.2)], label: "T" }),
    ], { w: 1000, h: 500, stroke: 6 });
    expect(svg.startsWith('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1000 500" width="1000" height="500">')).toBe(true);
    expect(svg.endsWith("</svg>")).toBe(true);
    for (const needle of ["<line", "<polygon", "<path", "<circle", "<text"]) expect(svg.includes(needle)).toBe(true);
    expect(svg.includes('stroke="#d11a2a" stroke-width="6"')).toBe(true);
    expect(svg.includes("NaN")).toBe(false);
    expect(svg.includes("Infinity")).toBe(false);
  });

  it("الإحداثيات تُحوَّل من 0..1 إلى بكسلات", () => {
    const svg = additionsSvg([add({ kind: "line", points: [P(0.1, 0.2), P(0.5, 0.6)] })], { w: 1000, h: 500, stroke: 4 });
    expect(svg.includes('x1="100" y1="100" x2="500" y2="300"')).toBe(true);
  });

  it("المستقيم الممتد يصل حافتي الشكل", () => {
    const svg = additionsSvg([add({ kind: "line", extend: true, points: [P(0.4, 0.4), P(0.6, 0.6)] })], { w: 1000, h: 1000, stroke: 4 });
    expect(svg.includes('x1="0" y1="0" x2="1000" y2="1000"')).toBe(true);
  });

  it("المتقطع يضيف dasharray، والنص يُهرَّب", () => {
    const svg = additionsSvg([add({ kind: "line", dashed: true, points: [P(0.1, 0.1), P(0.5, 0.5)], label: "<b>&" })], { w: 400, h: 400, stroke: 4 });
    expect(svg.includes("stroke-dasharray")).toBe(true);
    expect(svg.includes("&lt;b&gt;&amp;")).toBe(true);
    expect(svg.includes("<b>")).toBe(false);
  });

  it("النص يبقى داخل حدود الصورة حتى لو النقطة عند الحافة", () => {
    const svg = additionsSvg([add({ kind: "label", points: [P(1, 1)], label: "طويل جداً" })], { w: 300, h: 200, stroke: 4 });
    const m = svg.match(/<text x="([\d.]+)" y="([\d.]+)"/)!;
    expect(Number(m[1]) < 300 && Number(m[2]) < 200).toBe(true);
  });

  it("زاوية: اتجاه القوس يتبع أقصر دوران بين الذراعين", () => {
    const cw = additionsSvg([add({ kind: "angle", points: [P(0.8, 0.5), P(0.5, 0.5), P(0.5, 0.8)] })], { w: 1000, h: 1000, stroke: 4 });
    const ccw = additionsSvg([add({ kind: "angle", points: [P(0.8, 0.5), P(0.5, 0.5), P(0.5, 0.2)] })], { w: 1000, h: 1000, stroke: 4 });
    expect(/ 0 0 1 /.test(cw)).toBe(true); // نحو الأسفل = مع عقارب الساعة على الشاشة
    expect(/ 0 0 0 /.test(ccw)).toBe(true);
  });

  it("قائمة فارغة تعطي SVG فارغاً صالحاً", () => {
    expect(additionsSvg([], { w: 10, h: 10, stroke: 3 })).toBe('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10" width="10" height="10"></svg>');
  });
});

describe("judgeRedraw / التحذيرات", () => {
  const M = (o: { f1?: number; precision?: number; recall?: number; badShare?: number; text?: { checked: boolean; recall: number; precision: number }; refInk?: number; candInk?: number } = {}) => ({
    structure: { f1: o.f1 ?? 0.9, precision: o.precision ?? 0.9, recall: o.recall ?? 0.9, refInk: o.refInk ?? 1000, candInk: o.candInk ?? 1000 },
    badShare: o.badShare ?? 0.02,
    text: o.text ?? { checked: true, recall: 0.8, precision: 0.8 },
    f1: o.f1 ?? 0.9,
    usedStructure: true,
  });

  it("القبول يتطلب الهيكل والكتل والنص معاً", () => {
    expect(judgeRedraw(M())).toEqual({ ok: true });
    expect(acceptRedraw(M())).toBe(true);
    expect(judgeRedraw(M({ recall: 0.5 }))).toEqual({ ok: false, why: "structure" }); // أسقط خطوطاً
    expect(judgeRedraw(M({ precision: 0.5 }))).toEqual({ ok: false, why: "structure" }); // اخترع خطوطاً
    expect(judgeRedraw(M({ f1: 0.6, precision: 0.7, recall: 0.7 }))).toEqual({ ok: false, why: "structure" });
    expect(judgeRedraw(M({ badShare: 0.3 }))).toEqual({ ok: false, why: "blocks" }); // منحنى خاطئ وسط محاور سليمة
    expect(judgeRedraw(M({ text: { checked: true, recall: 0.2, precision: 0.8 } }))).toEqual({ ok: false, why: "text" });
    expect(judgeRedraw(M({ refInk: 0 }))).toEqual({ ok: false, why: "empty" });
    expect(judgeRedraw(M({ candInk: 0 }))).toEqual({ ok: false, why: "empty" });
  });

  it("النص غير المفحوص (قليل) لا يرفض", () => {
    expect(judgeRedraw(M({ text: { checked: false, recall: 0, precision: 0 } }))).toEqual({ ok: true });
  });

  it("كل تحذير له نص بالعربية والفرنسية", () => {
    const codes = ["multiple_figures", "erase_dropped", "erase_too_large", "addition_dropped", "no_additions", "plan_failed", "redraw_failed", "redraw_mismatch", "low_resolution"] as const;
    for (const code of codes) {
      expect(describeDiagramWarning({ code, detail: "x" }, "ar").length > 10).toBe(true);
      expect(describeDiagramWarning({ code, detail: "x" }, "fr").length > 10).toBe(true);
    }
  });
});

describe("straighten", () => {
  const mk = (p: [number, number, boolean], q: [number, number, boolean], o: Partial<Addition> = {}): Addition => ({
    id: "a", kind: "line", label: "", dashed: false, extend: false,
    points: [{ x: p[0], y: p[1], snap: p[2] }, { x: q[0], y: q[1], snap: q[2] }], ...o,
  });

  it("إسقاط شبه عمودي يصير عمودياً تماماً: الطرف الملتصق مرساة والآخر يتبعه", () => {
    const [a] = straighten([mk([0.53, 0.63, true], [0.528, 0.76, false])], 1000, 600);
    expect(a.points[0].x).toBe(0.53);
    expect(a.points[1].x).toBe(0.53);
    expect(a.points[1].y).toBe(0.76); // الطول لا يتغير
  });

  it("المرساة هي الطرف الثاني إن كان هو الملتصق", () => {
    const [a] = straighten([mk([0.5, 0.2, false], [0.52, 0.7, true])], 1000, 600);
    expect(a.points[0].x).toBe(0.52);
  });

  it("شبه أفقي يصير أفقياً (y)", () => {
    const [a] = straighten([mk([0.2, 0.5, true], [0.7, 0.505, false], { arrow: undefined } as Partial<Addition>)], 1000, 600);
    expect(a.points[1].y).toBe(0.5);
  });

  it("الزاوية تُقاس بالبكسل لا بالنسبة: صورة عريضة لا تُربك الحساب", () => {
    // dx=0.01×2000=20px، dy=0.2×500=100px: 11° > 6° فلا تقويم
    const [a] = straighten([mk([0.5, 0.3, true], [0.51, 0.5, false])], 2000, 500);
    expect(a.points[1].x).toBe(0.51);
  });

  it("المماس (ممتد غير متقطع) لا يُقوَّم حتى لو شبه عمودي؛ والمقارب المتقطع الممتد يُقوَّم", () => {
    const tangent = mk([0.5, 0.2, true], [0.51, 0.7, false], { extend: true });
    expect(straighten([tangent], 1000, 600)[0].points[1].x).toBe(0.51);
    const asym = mk([0.5, 0.2, true], [0.51, 0.7, false], { extend: true, dashed: true });
    expect(straighten([asym], 1000, 600)[0].points[1].x).toBe(0.5);
  });

  it("كلا الطرفين ملتصقان بحبر حقيقي = لا تغيير، وميل حقيقي = لا تغيير", () => {
    const both = mk([0.5, 0.2, true], [0.51, 0.7, true]);
    expect(straighten([both], 1000, 600)[0]).toEqual(both);
    const slanted = mk([0.2, 0.2, true], [0.6, 0.7, false]);
    expect(straighten([slanted], 1000, 600)[0]).toEqual(slanted);
  });

  it("لا يمسّ الأنواع الأخرى ولا القطع الضئيلة، ولا يعدّل الأصل", () => {
    const pt: Addition = { id: "p", kind: "point", label: "", dashed: false, extend: false, points: [{ x: 0.5, y: 0.5, snap: true }] };
    const tiny = mk([0.5, 0.5, true], [0.5005, 0.51, false]);
    const orig = mk([0.53, 0.63, true], [0.528, 0.76, false]);
    const out = straighten([pt, tiny, orig], 1000, 600);
    expect(out[0]).toEqual(pt);
    expect(out[1]).toEqual(tiny);
    expect(orig.points[1].x).toBe(0.528);
    expect(out[2].points[1].x).toBe(0.53);
  });
});
