import { describe, expect, it } from "vitest";
import type { Addition, DiagramLocation, DiagramPlan } from "./diagram";
import { DiagramApiError, solveDiagram, type Api, type Pixels, type Raster, type RasterImage } from "./diagramSolver";

const CW = 300, CH = 200;

/** مشهد اصطناعي: محوران (سُمك 3) + اختياري: سطر نص غريب في الأعلى */
function scene(opts: { text?: boolean; shift?: number; extra?: boolean } = {}): Pixels {
  const g = new Uint8ClampedArray(CW * CH * 4);
  for (let i = 0; i < CW * CH; i++) { g[i * 4] = g[i * 4 + 1] = g[i * 4 + 2] = 245; g[i * 4 + 3] = 255; }
  const dark = (x: number, y: number) => {
    if (x < 0 || y < 0 || x >= CW || y >= CH) return;
    const p = (y * CW + x) * 4; g[p] = g[p + 1] = g[p + 2] = 15;
  };
  const s = opts.shift ?? 0;
  for (let x = 10; x < 290; x++) for (let t = -1; t <= 1; t++) dark(x, 100 + t + s);
  for (let y = 10; y < 190; y++) for (let t = -1; t <= 1; t++) dark(150 + t + s, y);
  if (opts.text) for (let x = 20; x < 120; x++) for (let y = 12; y < 22; y++) dark(x, y);
  if (opts.extra) { for (let x = 10; x < 290; x++) for (let t = -1; t <= 1; t++) { dark(x, 40 + t); dark(x, 160 + t); } }
  return { rgba: g, w: CW, h: CH };
}

interface Log { erased: number[]; modelImages: string[]; redrawArgs: Array<{ w: number; h: number; stroke: number }>; planArgs: Array<{ image: string; task: string }> }

/** القصّ الوهمي 900×600 (التحليل يجري على نسخة مصغّرة 300×200، كما يفعل Raster الحقيقي) */
function fakeRaster(log: Log, o: { throwOnCrop?: boolean; cropW?: number; cropH?: number } = {}): Raster {
  const cw = o.cropW ?? 900, ch = o.cropH ?? 600;
  const img = (dataUrl: string): RasterImage => ({ dataUrl, w: cw, h: ch });
  return {
    load: async (src) => ({ dataUrl: src, w: 1000, h: 700 }),
    crop: async () => { if (o.throwOnCrop) throw new Error("canvas dead"); return img("crop"); },
    pixels: async (i) => (i.dataUrl === "clean" ? scene() : scene({ text: true })),
    forModel: async (i) => { log.modelImages.push(i.dataUrl); return "model:" + i.dataUrl; },
    gridded: async (i) => "grid:" + i.dataUrl,
    clean: async (_i, erase) => { log.erased.push(erase.length); return img("clean"); },
    svgPixels: async (svg) => (svg.includes("EXTRA") ? scene({ extra: true }) : svg.includes("GOOD") ? scene() : scene({ shift: 40 })),
    composeRedraw: async (fig, overlay) => `redraw|${fig}|${overlay}`,
    composeEmergency: async (c, overlay) => `emergency|${c.dataUrl}|${overlay}`,
  };
}

const LOCATION: DiagramLocation = {
  crop: { x: 0.1, y: 0.2, w: 0.5, h: 0.4 },
  erase: [{ x: 0.05, y: 0.03, w: 0.35, h: 0.06 }],
  task: "Tracer la tangente (T) au point A.",
  figureCount: 1,
  confidence: "high",
  warnings: [],
};

const ADD: Addition = {
  id: "t", kind: "point", label: "A", dashed: false, extend: false,
  points: [{ x: 0.6, y: 0.52, snap: true }],
};
const PLAN: DiagramPlan = {
  figureKind: "function_graph", summary: "محوران", points: [{ id: "A", x: 0.6, y: 0.52, snap: true }], additions: [ADD], warnings: [],
};

function fakeApi(o: {
  locate?: () => Promise<DiagramLocation>;
  plan?: () => Promise<DiagramPlan>;
  redraw?: () => Promise<string>;
  log?: Log;
} = {}): Api {
  return {
    locate: o.locate ?? (async () => LOCATION),
    plan: async (image, task) => { o.log?.planArgs.push({ image, task }); return (o.plan ?? (async () => PLAN))(); },
    redraw: async (_image, w, h, stroke) => { o.log?.redrawArgs.push({ w, h, stroke }); return (o.redraw ?? (async () => "GOOD"))(); },
  };
}

const newLog = (): Log => ({ erased: [], modelImages: [], redrawArgs: [], planArgs: [] });
const input = { sheet: "SHEET", answer: "y=2x-1", subject: "math" };

describe("solveDiagram: محرك إعادة الرسم", () => {
  it("المسار الكامل: الشكل المُعاد يطابق الأصل فيُقبل، والإضافة تلتصق بالمحور الحقيقي بسُمك مقيس", async () => {
    const log = newLog();
    const r = await solveDiagram(input, fakeApi({ log }), fakeRaster(log));
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.engine).toBe("redraw");
    expect(r.status).toBe("ok");
    expect(r.similarity !== null && r.similarity > 0.9).toBe(true);
    expect(r.drawn).toBe(1);
    expect(r.planned).toBe(1);
    expect(r.snapped >= 1).toBe(true);
    expect(r.width).toBe(1600); // قصّ 900×600 يُكبَّر ليملأ 1600 بكسل
    expect(r.height).toBe(1067);
    expect(r.task).toBe(LOCATION.task);
    expect(r.summary).toBe("محوران");

    // الصورة المركّبة: SVG الشكل الصالح + الإضافات
    expect(r.image.startsWith("redraw|GOOD|")).toBe(true);
    // سُمك حبر الأصل 3 بكسل في التحليل = 9 في القصّ، ×1.78 تكبير ×1.25 = 20 → يُقصّ عند السقف 1.2% من 1600 = 19.2
    // (نصف قطر نقطة الإضافة = 1.9 × سُمك القلم)
    expect(r.image.includes('r="36.48"')).toBe(true);
    // النقطة (0.6,0.52) كانت على بعد 4 بكسل تحت المحور الأفقي، فالتصقت بمنتصفه: y=100 في التحليل = 533 في الإخراج
    const m = r.image.match(/<circle cx="([\d.]+)" cy="([\d.]+)"/)!;
    expect(Math.abs(Number(m[1]) - 960) < 8 && Math.abs(Number(m[2]) - 533.5) < 8).toBe(true);
  });

  it("يرسل للنموذج قصّ الشكل (لا الورقة كلها) وأبعاد viewBox بنسبة القصّ وسُمكه", async () => {
    const log = newLog();
    await solveDiagram(input, fakeApi({ log }), fakeRaster(log));
    expect(log.modelImages).toEqual(["SHEET", "crop"]); // الورقة للتحديد، القصّ لإعادة الرسم
    expect(log.planArgs[0]).toEqual({ image: "grid:crop", task: LOCATION.task });
    expect(log.redrawArgs[0].w).toBe(1000);
    expect(log.redrawArgs[0].h).toBe(667);
    expect(Math.abs(log.redrawArgs[0].stroke - 10) < 1.5).toBe(true); // 3 بكسل × 1000/300
  });

  it("المسح يُطبَّق على النسخة المنظَّفة قبل المقارنة (النص الغريب لا يعاقب إعادة الرسم)", async () => {
    const log = newLog();
    const r = await solveDiagram(input, fakeApi({ log }), fakeRaster(log));
    expect(log.erased).toEqual([1]);
    expect(r.ok && r.engine).toBe("redraw");
  });
});

describe("solveDiagram: محرك الطوارئ", () => {
  it("شكل مُعاد رسمه لا يطابق الأصل ⇒ الصورة الأصلية المنظَّفة، والإضافات تبقى", async () => {
    const log = newLog();
    const r = await solveDiagram(input, fakeApi({ log, redraw: async () => "BAD" }), fakeRaster(log));
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.engine).toBe("emergency");
    expect(r.warnings.some((w) => w.code === "redraw_mismatch")).toBe(true);
    expect(r.image.startsWith("emergency|clean|")).toBe(true);
    expect(r.drawn).toBe(1);
    expect(r.status).toBe("ok"); // الاحتياط المصمَّم لا يخفض الحالة بحد ذاته
    expect(r.similarity !== null && r.similarity < 0.6).toBe(true);
  });

  it("إعادة رسم تخترع خطوطاً زائدة (precision منخفضة) تُرفض أيضاً", async () => {
    const log = newLog();
    const r = await solveDiagram(input, fakeApi({ log, redraw: async () => "GOOD EXTRA" }), fakeRaster(log));
    expect(r.ok && r.engine).toBe("emergency");
  });

  it("إعادة الرسم تفشل أصلاً (خطأ شبكة) ⇒ الطوارئ + redraw_failed", async () => {
    const log = newLog();
    const r = await solveDiagram(input, fakeApi({ log, redraw: async () => { throw new DiagramApiError("bad_svg"); } }), fakeRaster(log));
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.engine).toBe("emergency");
    expect(r.warnings.some((w) => w.code === "redraw_failed")).toBe(true);
    expect(r.similarity).toBe(null);
    expect(r.drawn).toBe(1);
  });
});

describe("solveDiagram: تدهور الخطة", () => {
  it("فشل الخطة (غير قاتل) ⇒ الشكل وحده مكبّراً، حالة partial", async () => {
    const log = newLog();
    const r = await solveDiagram(input, fakeApi({ log, plan: async () => { throw new DiagramApiError("upstream"); } }), fakeRaster(log));
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.status).toBe("partial");
    expect(r.drawn).toBe(0);
    expect(r.warnings.some((w) => w.code === "plan_failed")).toBe(true);
    expect(r.engine).toBe("redraw");
  });

  it("خطة بلا إضافات صالحة ⇒ partial مع تحذيراتها", async () => {
    const plan: DiagramPlan = { ...PLAN, additions: [], warnings: [{ code: "addition_dropped", detail: "a1: bad_ref" }, { code: "no_additions" }] };
    const r = await solveDiagram(input, fakeApi({ plan: async () => plan }), fakeRaster(newLog()));
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.status).toBe("partial");
    expect(r.drawn).toBe(0);
    expect(r.planned).toBe(1);
  });

  it("إضافة مُسقَطة مع أخرى سليمة ⇒ planned > drawn وحالة partial", async () => {
    const plan: DiagramPlan = { ...PLAN, warnings: [{ code: "addition_dropped", detail: "a2: bad_ref" }] };
    const r = await solveDiagram(input, fakeApi({ plan: async () => plan }), fakeRaster(newLog()));
    if (!r.ok) throw new Error("expected ok");
    expect(r.drawn).toBe(1);
    expect(r.planned).toBe(2);
    expect(r.status).toBe("partial");
  });

  it("منطقة مسح فوق نقطة مسمّاة تُسقط قبل المسح الفعلي", async () => {
    const log = newLog();
    const loc: DiagramLocation = { ...LOCATION, erase: [{ x: 0.4, y: 0.45, w: 0.2, h: 0.2 }] }; // تغطي A عند (0.5,0.52)
    const r = await solveDiagram(input, fakeApi({ log, locate: async () => loc }), fakeRaster(log));
    expect(log.erased).toEqual([0]);
    if (!r.ok) throw new Error("expected ok");
    expect(r.warnings.some((w) => w.code === "erase_dropped")).toBe(true);
    expect(r.status).toBe("partial");
  });
});

describe("solveDiagram: الثقة والحالات الفاشلة", () => {
  it("ثقة منخفضة في اختيار الشكل ⇒ unreliable", async () => {
    const r = await solveDiagram(input, fakeApi({ locate: async () => ({ ...LOCATION, confidence: "low" }) }), fakeRaster(newLog()));
    expect(r.ok && r.status).toBe("unreliable");
  });

  it("لا شكل / شكل ضئيل / رصيد / بلا مزوّد: تُمرَّر أسبابها", async () => {
    for (const reason of ["no_figure", "figure_too_small", "credits", "no_provider"] as const) {
      const r = await solveDiagram(input, fakeApi({ locate: async () => { throw new DiagramApiError(reason); } }), fakeRaster(newLog()));
      expect(r).toEqual({ ok: false, reason });
    }
    const other = await solveDiagram(input, fakeApi({ locate: async () => { throw new DiagramApiError("bad_json"); } }), fakeRaster(newLog()));
    expect(other).toEqual({ ok: false, reason: "upstream" });
  });

  it("نفاد الرصيد أثناء الخطة يُسقط العملية كلها (لا نعرض نصف نتيجة بصمت)", async () => {
    const r = await solveDiagram(input, fakeApi({ plan: async () => { throw new DiagramApiError("credits"); } }), fakeRaster(newLog()));
    expect(r).toEqual({ ok: false, reason: "credits" });
  });

  it("الإلغاء قبل البدء أو أثناءه = aborted", async () => {
    const ctl = new AbortController(); ctl.abort();
    expect(await solveDiagram(input, fakeApi(), fakeRaster(newLog()), { signal: ctl.signal })).toEqual({ ok: false, reason: "aborted" });
    const ctl2 = new AbortController();
    const api = fakeApi({ locate: async () => { ctl2.abort(); return LOCATION; } });
    expect(await solveDiagram(input, api, fakeRaster(newLog()), { signal: ctl2.signal })).toEqual({ ok: false, reason: "aborted" });
  });

  it("عطل في canvas = image_failed ولا يرمي", async () => {
    const r = await solveDiagram(input, fakeApi(), fakeRaster(newLog(), { throwOnCrop: true }));
    expect(r).toEqual({ ok: false, reason: "image_failed" });
  });

  it("قصّ صغير يُنبَّه إلى ضعف الدقة", async () => {
    const r = await solveDiagram(input, fakeApi(), fakeRaster(newLog(), { cropW: 300, cropH: 200 }));
    if (!r.ok) throw new Error("expected ok");
    expect(r.warnings.some((w) => w.code === "low_resolution")).toBe(true);
    expect(r.status).toBe("partial");
  });
});

describe("solveDiagram: النسخة البديلة والتقدم", () => {
  it("عند قبول إعادة الرسم تأتي معه صورة الطوارئ (الأصل المكبَّر) للتبديل الفوري", async () => {
    const r = await solveDiagram(input, fakeApi(), fakeRaster(newLog()));
    if (!r.ok) throw new Error("expected ok");
    expect(r.engine).toBe("redraw");
    expect(r.alternate !== null && r.alternate.engine === "emergency").toBe(true);
    expect(r.alternate!.image.startsWith("emergency|clean|")).toBe(true);
    // الإضافات (النقطة) موجودة في النسختين
    expect(r.alternate!.image.includes("<circle")).toBe(true);
  });

  it("عند الطوارئ لا نسخة بديلة", async () => {
    const r = await solveDiagram(input, fakeApi({ redraw: async () => "BAD" }), fakeRaster(newLog()));
    if (!r.ok) throw new Error("expected ok");
    expect(r.engine).toBe("emergency");
    expect(r.alternate).toBe(null);
  });

  it("مراحل التقدم تُبلَّغ بالترتيب، وعطل المراقب لا يُسقط العملية", async () => {
    const seen: string[] = [];
    const r = await solveDiagram(input, fakeApi(), fakeRaster(newLog()), { onStage: (s) => seen.push(s) });
    expect(r.ok).toBe(true);
    expect(seen).toEqual(["locating", "cropping", "drawing", "finishing"]);
    const r2 = await solveDiagram(input, fakeApi(), fakeRaster(newLog()), { onStage: () => { throw new Error("ui bug"); } });
    expect(r2.ok).toBe(true);
  });
});
