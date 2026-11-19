/**
 * منسّق نظام الشكل في المتصفح: يربط الخادم (يقترح) بالكود (يتحقق ويرسم) ويختار المحرك.
 *
 *   تحديد الشكل ─┐
 *                 ├─ قصّ الشكل ─┬─ خطة الرسم   (نموذج) ──────────────┐
 *                                └─ إعادة الرسم (نموذج، SVG) ─┐      │
 *   محرك إعادة الرسم: يُقبل فقط إن طابق حبرُه حبرَ الأصل ضمن تسامح مقيس      │
 *   محرك الطوارئ:     بكسلات الصورة الأصلية، تُمسح منها النصوص الأخرى وتُكبَّر  │
 *   كلاهما: الإضافات (ماسّ، نقاط، أسهم…) من رسّامنا بسُمك مقيس من الشكل نفسه ◄┘
 *
 * كل ما يخص DOM/canvas يمرّ عبر واجهة Raster، وكل ما يخص الشبكة عبر Api،
 * فيُختبر المنسّق بتبعيات وهمية وبصور اصطناعية دون متصفح ولا نموذج.
 */
import {
  additionsSvg, chooseStroke, dropEraseOverPoints, judgeRedraw, snapAdditions, straighten,
  type Addition, type Box, type Confidence, type DiagramLocation, type DiagramPlan, type DiagramWarning,
} from "./diagram";
import { compareFigures, estimateStrokeWidth, inkMask, rgbaToGray, type Mask } from "./diagramInk";

export interface RasterImage {
  dataUrl: string;
  w: number;
  h: number;
}

export interface Pixels {
  rgba: Uint8ClampedArray | Uint8Array;
  w: number;
  h: number;
}

export interface Raster {
  load(src: string): Promise<RasterImage>;
  /** يقصّ منطقة نسبية بدقتها الأصلية (مع سقف أعلى للحجم) */
  crop(img: RasterImage, box: Box): Promise<RasterImage>;
  /** بكسلات مصغَّرة للتحليل (أطول ضلع ≤ maxSide) */
  pixels(img: RasterImage, maxSide: number): Promise<Pixels>;
  /** نسخة مضغوطة للإرسال إلى النموذج */
  forModel(img: RasterImage, maxSide: number): Promise<string>;
  /** نسخة عليها شبكة إحداثيات حمراء (للنموذج فقط) */
  gridded(img: RasterImage, maxSide: number): Promise<string>;
  /** يمسح المناطق (نسبةً إلى الصورة) بلون الورقة ويبيّضها ويقوّي الحبر */
  clean(img: RasterImage, erase: Box[]): Promise<RasterImage>;
  /** يرسم SVG على خلفية بيضاء بحجم w×h ويعيد بكسلاته */
  svgPixels(svg: string, w: number, h: number): Promise<Pixels>;
  composeRedraw(figureSvg: string, overlaySvg: string, w: number, h: number): Promise<string>;
  composeEmergency(clean: RasterImage, overlaySvg: string, w: number, h: number): Promise<string>;
}

export interface Api {
  locate(image: string, answer: string, subject: string | undefined, signal?: AbortSignal): Promise<DiagramLocation>;
  plan(image: string, task: string, answer: string, signal?: AbortSignal): Promise<DiagramPlan>;
  redraw(image: string, w: number, h: number, stroke: number, signal?: AbortSignal): Promise<string>;
}

export class DiagramApiError extends Error {
  constructor(public reason: string, public status?: number) {
    super(`diagram api: ${reason}`);
    this.name = "DiagramApiError";
  }
}

export type DiagramFailReason = "no_figure" | "figure_too_small" | "no_provider" | "credits" | "aborted" | "upstream" | "image_failed";
export type DiagramStatus = "ok" | "partial" | "unreliable";
export type DiagramEngine = "redraw" | "emergency";

export type DiagramStage = "locating" | "cropping" | "drawing" | "finishing";

export type DiagramResult =
  | { ok: false; reason: DiagramFailReason }
  | {
      ok: true;
      engine: DiagramEngine;
      status: DiagramStatus;
      image: string;
      /** النسخة الأخرى لتبديل فوري دون استدعاء جديد: عند قبول إعادة الرسم تكون صورة الطوارئ (الأصل المكبَّر) */
      alternate: { engine: DiagramEngine; image: string } | null;
      width: number;
      height: number;
      drawn: number;
      planned: number;
      snapped: number;
      /** F1 بين الشكل المُعاد رسمه والأصل (null إن لم يُجرَّب محرك إعادة الرسم) */
      similarity: number | null;
      warnings: DiagramWarning[];
      summary: string;
      figureKind: string;
      confidence: Confidence;
      task: string;
    };

export const ANALYSIS_SIDE = 900;
export const OUTPUT_SIDE = 1600;
const MODEL_SIDE = 1400;

const FATAL = new Set(["credits", "no_provider", "aborted"]);

function failReason(e: unknown, signal?: AbortSignal): DiagramFailReason {
  if (signal?.aborted) return "aborted";
  if (e instanceof DiagramApiError) {
    const r = e.reason;
    if (r === "no_figure" || r === "figure_too_small" || r === "no_provider" || r === "credits" || r === "aborted") return r;
    return "upstream";
  }
  return "image_failed";
}

const maskOf = (p: Pixels): Mask => inkMask(rgbaToGray(p.rgba, p.w, p.h), p.w, p.h);

const DEGRADING = new Set<DiagramWarning["code"]>([
  "addition_dropped", "no_additions", "plan_failed", "erase_dropped", "erase_too_large", "multiple_figures", "low_resolution",
]);

export async function solveDiagram(
  input: { sheet: string; answer: string; subject?: string },
  api: Api,
  raster: Raster,
  opts: { signal?: AbortSignal; onStage?: (s: DiagramStage) => void } = {},
): Promise<DiagramResult> {
  const { signal } = opts;
  const stage = (s: DiagramStage) => { try { opts.onStage?.(s); } catch { /* مراقب التقدم لا يُسقط العملية */ } };
  const aborted = () => signal?.aborted === true;
  try {
    /* 1) أين الشكل؟ */
    stage("locating");
    const sheet = await raster.load(input.sheet);
    let loc: DiagramLocation;
    try {
      loc = await api.locate(await raster.forModel(sheet, OUTPUT_SIDE), input.answer, input.subject, signal);
    } catch (e) {
      return { ok: false, reason: failReason(e, signal) };
    }
    if (aborted()) return { ok: false, reason: "aborted" };

    stage("cropping");
    const warnings: DiagramWarning[] = [...loc.warnings];
    const crop = await raster.crop(sheet, loc.crop);
    if (Math.max(crop.w, crop.h) < 500) warnings.push({ code: "low_resolution" });

    /* 2) قياس الشكل الخام: سُمك خطه لطلب إعادة الرسم بسُمك مطابق */
    const rawPx = await raster.pixels(crop, ANALYSIS_SIDE);
    const rawStrokeCrop = estimateStrokeWidth(maskOf(rawPx), rawPx.w, rawPx.h) / (rawPx.w / crop.w);
    const vs = 1000 / Math.max(crop.w, crop.h);
    const vw = Math.max(50, Math.round(crop.w * vs)), vh = Math.max(50, Math.round(crop.h * vs));

    stage("drawing");
    /* 3) الخطة وإعادة الرسم بالتوازي؛ فشل أيٍّ منهما لا يُسقط الآخر */
    const [planR, redrawR] = await Promise.allSettled([
      (async () => api.plan(await raster.gridded(crop, MODEL_SIDE), loc.task, input.answer, signal))(),
      (async () => api.redraw(await raster.forModel(crop, MODEL_SIDE), vw, vh, Math.max(0.5, Math.min(40, rawStrokeCrop * vs)), signal))(),
    ]);
    if (aborted()) return { ok: false, reason: "aborted" };
    for (const r of [planR, redrawR]) {
      if (r.status === "rejected" && r.reason instanceof DiagramApiError && FATAL.has(r.reason.reason)) {
        return { ok: false, reason: failReason(r.reason, signal) };
      }
    }

    let plan: DiagramPlan | null = null;
    if (planR.status === "fulfilled") {
      plan = planR.value;
      warnings.push(...plan.warnings);
    } else {
      warnings.push({ code: "plan_failed" });
    }

    /* 4) المسح: لا نمسح فوق نقطة مسمّاة من الشكل */
    let erase = loc.erase;
    if (plan && erase.length) {
      const g = dropEraseOverPoints(erase, plan.points);
      erase = g.erase;
      if (g.dropped) warnings.push({ code: "erase_dropped", detail: String(g.dropped) });
    }
    const clean = await raster.clean(crop, erase);
    const refPx = await raster.pixels(clean, ANALYSIS_SIDE);
    const refMask = maskOf(refPx);
    const refStrokeAn = estimateStrokeWidth(refMask, refPx.w, refPx.h);
    const aScale = refPx.w / crop.w;

    /* 5) قياسات الإخراج: تكبير الشكل ليملأ الصورة، وقلم بسُمك الشكل نفسه */
    const k = Math.min(3, Math.max(0.5, OUTPUT_SIDE / Math.max(crop.w, crop.h)));
    const outW = Math.round(crop.w * k), outH = Math.round(crop.h * k);
    const stroke = chooseStroke(refStrokeAn / aScale, k, Math.max(outW, outH));

    /* 6) إلصاق نقاط الإضافات بالحبر الحقيقي */
    const radius = Math.max(6, 0.025 * Math.max(refPx.w, refPx.h));
    let additions: Addition[] = plan?.additions ?? [];
    const snapRef = snapAdditions(additions, refMask, refPx.w, refPx.h, radius, refStrokeAn);
    additions = snapRef.additions;
    const additionsOnOriginal = additions; // للنسخة البديلة: ملتصقة بحبر الأصل لا بحبر المُعاد رسمه
    let snapped = snapRef.snapped;

    /* 7) محرك إعادة الرسم: يُقبل فقط إن طابق الأصل، وإلا محرك الطوارئ */
    let engine: DiagramEngine = "emergency";
    let simF1: number | null = null;
    let figureSvg: string | null = null;
    if (redrawR.status === "fulfilled") {
      try {
        const cand = await raster.svgPixels(redrawR.value, refPx.w, refPx.h);
        const candMask = maskOf(cand);
        const tol = Math.max(3, 0.015 * Math.max(refPx.w, refPx.h));
        const match = compareFigures(refMask, candMask, refPx.w, refPx.h, tol);
        simF1 = Math.round(match.f1 * 1000) / 1000;
        const verdict = judgeRedraw(match);
        if (verdict.ok) {
          engine = "redraw";
          figureSvg = redrawR.value;
          // الإضافات تلتصق أيضاً بخطوط الشكل المُعاد رسمه كي تلامسه لا تقاربه
          const again = snapAdditions(additions, candMask, refPx.w, refPx.h, tol + 2, refStrokeAn);
          additions = again.additions;
          snapped = Math.max(snapped, again.snapped);
        } else {
          warnings.push({ code: "redraw_mismatch", detail: verdict.why });
        }
      } catch {
        warnings.push({ code: "redraw_failed" });
      }
    } else {
      warnings.push({ code: "redraw_failed" });
    }
    if (aborted()) return { ok: false, reason: "aborted" };

    /* 8) التركيب: خطوط الإرشاد المائلة قليلاً تُقوَّم ثم تُرسم */
    stage("finishing");
    additions = straighten(additions, refPx.w, refPx.h);
    const overlay = additionsSvg(additions, { w: outW, h: outH, stroke });
    const image = engine === "redraw" && figureSvg
      ? await raster.composeRedraw(figureSvg, overlay, outW, outH)
      : await raster.composeEmergency(clean, overlay, outW, outH);
    let alternate: { engine: DiagramEngine; image: string } | null = null;
    if (engine === "redraw") {
      // الأصل المكبَّر جاهز دائماً بجانب المُعاد رسمه: التلميذ يقارن ويبدّل بلا انتظار
      const altOverlay = additionsSvg(straighten(additionsOnOriginal, refPx.w, refPx.h), { w: outW, h: outH, stroke });
      alternate = { engine: "emergency", image: await raster.composeEmergency(clean, altOverlay, outW, outH) };
    }

    const dropped = warnings.filter((w) => w.code === "addition_dropped").length;
    let status: DiagramStatus = "ok";
    if (loc.confidence === "low") status = "unreliable";
    else if (!plan || additions.length === 0 || warnings.some((w) => DEGRADING.has(w.code))) status = "partial";

    return {
      ok: true,
      engine,
      status,
      image,
      alternate,
      width: outW,
      height: outH,
      drawn: additions.length,
      planned: additions.length + dropped,
      snapped,
      similarity: simF1,
      warnings,
      summary: plan?.summary ?? "",
      figureKind: plan?.figureKind ?? "other",
      confidence: loc.confidence,
      task: loc.task,
    };
  } catch (e) {
    console.error("diagram solver failed:", e);
    return { ok: false, reason: failReason(e, signal) };
  }
}
