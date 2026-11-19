/**
 * نظام الشكل (Smart Diagram Solver): طبقة التحقق والرسم النقية.
 *
 * النموذج يقترح (أين الشكل؟ ماذا نمسح؟ ماذا يطلب السؤال أن يُرسم؟ بأي إحداثيات؟)،
 * والكود هو من يتحقق ويرسم: كل إحداثية تُفحص، كل مرجع نقطة يُحَلّ أو تسقط الإضافة،
 * والرسم النهائي يخرجه رسّامنا بسُمك مقيس من الشكل الأصلي، لا ما يتخيله النموذج.
 * الملف نقي (بلا DOM) ليستعمله الخادم والواجهة والاختبارات.
 */
import { plain } from "./annotateSheet";
import { snapToInk, type FigureMatch, type Mask } from "./diagramInk";
import { toBox, type Box } from "./recognition";

export type { Box };

/* ===================== الأنواع ===================== */

export type DiagramWarningCode =
  | "multiple_figures"
  | "erase_dropped"
  | "erase_too_large"
  | "addition_dropped"
  | "no_additions"
  | "plan_failed"
  | "redraw_failed"
  | "redraw_mismatch"
  | "low_resolution";

export interface DiagramWarning {
  code: DiagramWarningCode;
  detail?: string;
}

export type Confidence = "high" | "medium" | "low";

export interface DiagramLocation {
  /** المنطقة المقصوصة من الورقة (الشكل + هامش)، نسبةً إلى الورقة */
  crop: Box;
  /** مناطق نصوص تُمسح من القصّ (أسئلة/عناوين تداخلت مع الإطار)، نسبةً إلى القصّ نفسه */
  erase: Box[];
  /** المطلوب من السؤال بخصوص الشكل كما هو مكتوب (قصير) */
  task: string;
  figureCount: number;
  confidence: Confidence;
  warnings: DiagramWarning[];
}

export type LocationResult =
  | { ok: true; location: DiagramLocation }
  | { ok: false; reason: "no_figure" | "figure_too_small" | "bad_shape" };

export interface NamedPoint {
  id: string;
  /** نسبةً إلى القصّ، 0..1 */
  x: number;
  y: number;
  /** هل تقع على خط/منحنى حقيقي في الشكل (تُلصق بالحبر) */
  snap: boolean;
}

export type AdditionKind = "line" | "arrow" | "polyline" | "point" | "circle" | "angle" | "label";

export interface PlanPoint {
  x: number;
  y: number;
  snap: boolean;
}

export interface Addition {
  id: string;
  kind: AdditionKind;
  points: PlanPoint[];
  label: string;
  dashed: boolean;
  /** للمستقيم فقط: يمتد عبر النقطتين إلى حافتي الشكل (ماسّ، مقارب…) */
  extend: boolean;
}

export interface DiagramPlan {
  figureKind: string;
  summary: string;
  points: NamedPoint[];
  additions: Addition[];
  warnings: DiagramWarning[];
}

/* ===================== أدوات صغيرة ===================== */

const clamp01 = (v: number) => Math.min(1, Math.max(0, v));
const round3 = (v: number) => Math.round(v * 1000) / 1000;
const isObj = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const num = (v: unknown): number | null => {
  const n = typeof v === "number" ? v : typeof v === "string" && v.trim() !== "" ? Number(v) : NaN;
  return Number.isFinite(n) ? n : null;
};
const cleanText = (v: unknown, max: number): string =>
  typeof v === "string" ? v.replace(/[\u0000-\u001f]+/g, " ").replace(/\s+/g, " ").trim().slice(0, max) : "";

const area = (b: Box) => b.w * b.h;

/** صندوق + هامش مطلق (بنسبة الورقة)، داخل حدود الصورة */
export function padBox(b: Box, pad: number): Box {
  const x0 = clamp01(b.x - pad), y0 = clamp01(b.y - pad);
  const x1 = clamp01(b.x + b.w + pad), y1 = clamp01(b.y + b.h + pad);
  return { x: round3(x0), y: round3(y0), w: round3(x1 - x0), h: round3(y1 - y0) };
}

/** صندوق من فضاء الورقة إلى فضاء القصّ (مقطوعاً على حدوده)، أو undefined إن لم يتقاطعا */
export function toCropSpace(b: Box, crop: Box): Box | undefined {
  const x0 = Math.max(b.x, crop.x), y0 = Math.max(b.y, crop.y);
  const x1 = Math.min(b.x + b.w, crop.x + crop.w), y1 = Math.min(b.y + b.h, crop.y + crop.h);
  if (x1 <= x0 || y1 <= y0 || crop.w <= 0 || crop.h <= 0) return undefined;
  return { x: round3((x0 - crop.x) / crop.w), y: round3((y0 - crop.y) / crop.h), w: round3((x1 - x0) / crop.w), h: round3((y1 - y0) / crop.h) };
}

/* ===================== مرحلة 1: تحديد مكان الشكل ===================== */

export const FIGURE_MIN = { w: 0.06, h: 0.04 };
/** مجموع مناطق المسح لا يتجاوز هذه النسبة من القصّ، وإلا فالنموذج يمسح الشكل نفسه */
export const ERASE_MAX_FRACTION = 0.35;
export const ERASE_MAX_SINGLE = 0.6;
export const CROP_PAD = 0.02;

/**
 * يفحص ما اقترحه النموذج لمكان الشكل. لا يرمي.
 * الشكل غير موجود/ضئيل/مشوَّه ⇒ فشل صريح (لا قصّ على التخمين).
 */
export function buildLocation(raw: unknown): LocationResult {
  if (!isObj(raw)) return { ok: false, reason: "bad_shape" };
  if (raw["found"] === false) return { ok: false, reason: "no_figure" };
  const fig = toBox(raw["figure_box_2d"]);
  if (!fig) return { ok: false, reason: "no_figure" };
  if (fig.w < FIGURE_MIN.w || fig.h < FIGURE_MIN.h) return { ok: false, reason: "figure_too_small" };

  const warnings: DiagramWarning[] = [];
  const crop = padBox(fig, CROP_PAD);

  const eraseRaw = Array.isArray(raw["erase_box_2d"]) ? (raw["erase_box_2d"] as unknown[]).slice(0, 20) : [];
  let erase: Box[] = [];
  let dropped = 0;
  for (const e of eraseRaw) {
    const b = toBox(e);
    const inCrop = b ? toCropSpace(b, crop) : undefined;
    if (!inCrop || area(inCrop) > ERASE_MAX_SINGLE) { dropped++; continue; }
    erase.push(inCrop);
  }
  if (erase.reduce((s, b) => s + area(b), 0) > ERASE_MAX_FRACTION) {
    warnings.push({ code: "erase_too_large" });
    erase = [];
  } else if (dropped) {
    warnings.push({ code: "erase_dropped", detail: String(dropped) });
  }

  const count = Math.min(20, Math.max(1, Math.round(num(raw["figure_count"]) ?? 1)));
  if (count > 1) warnings.push({ code: "multiple_figures", detail: String(count) });

  const conf = raw["confidence"];
  const confidence: Confidence = conf === "high" || conf === "low" ? conf : "medium";

  return {
    ok: true,
    location: { crop, erase, task: cleanText(raw["task"], 400), figureCount: count, confidence, warnings },
  };
}

/** يُسقط مناطق المسح التي تغطي نقطة مسمّاة من الشكل (تسمية نقطة ≠ سؤال يُمسح) */
export function dropEraseOverPoints(erase: Box[], points: NamedPoint[], margin = 0.01): { erase: Box[]; dropped: number } {
  const keep = erase.filter(
    (b) => !points.some((p) => p.x >= b.x - margin && p.x <= b.x + b.w + margin && p.y >= b.y - margin && p.y <= b.y + b.h + margin),
  );
  return { erase: keep, dropped: erase.length - keep.length };
}

/* ===================== مرحلة 2: خطة الرسم ===================== */

export const MAX_ADDITIONS = 24;
export const MAX_NAMED_POINTS = 40;
const OVERFLOW = 0.15; // خارج القصّ بأكثر من هذا = إحداثية خاطئة لا ضبط

const ALIASES: Record<string, AdditionKind> = {
  line: "line", segment: "line", tangent: "line", straight: "line",
  arrow: "arrow", vector: "arrow", ray: "arrow", force: "arrow",
  polyline: "polyline", curve: "polyline", path: "polyline",
  point: "point", dot: "point", mark: "point",
  circle: "circle",
  angle: "angle", arc: "angle",
  label: "label", text: "label",
};

const ARITY: Record<AdditionKind, [number, number]> = {
  line: [2, 2], arrow: [2, 2], polyline: [2, 60], point: [1, 1], circle: [2, 2], angle: [3, 3], label: [1, 1],
};

function readCoords(v: unknown): { x: number; y: number } | null {
  if (Array.isArray(v) && v.length === 2) {
    const x = num(v[0]), y = num(v[1]);
    return x === null || y === null ? null : { x, y };
  }
  if (isObj(v)) {
    const x = num(v["x"]), y = num(v["y"]);
    return x === null || y === null ? null : { x, y };
  }
  return null;
}

type PointResult = { ok: true; p: PlanPoint } | { ok: false; why: string };

function resolvePoint(v: unknown, named: Map<string, NamedPoint>): PointResult {
  const ref = typeof v === "string" ? v : isObj(v) && typeof v["ref"] === "string" ? (v["ref"] as string) : null;
  if (ref !== null) {
    const key = ref.trim();
    const hit = named.get(key) ?? named.get(key.toLowerCase());
    return hit ? { ok: true, p: { x: hit.x, y: hit.y, snap: hit.snap } } : { ok: false, why: "bad_ref" };
  }
  const c = readCoords(v);
  if (!c) return { ok: false, why: "bad_point" };
  if (c.x < -OVERFLOW || c.x > 1 + OVERFLOW || c.y < -OVERFLOW || c.y > 1 + OVERFLOW) return { ok: false, why: "out_of_figure" };
  return { ok: true, p: { x: round3(clamp01(c.x)), y: round3(clamp01(c.y)), snap: isObj(v) && v["snap"] === true } };
}

const dist = (a: { x: number; y: number }, b: { x: number; y: number }) => Math.hypot(a.x - b.x, a.y - b.y);

function buildAddition(raw: unknown, index: number, named: Map<string, NamedPoint>): { add: Addition } | { why: string; id: string } {
  const fallbackId = `a${index + 1}`;
  if (!isObj(raw)) return { why: "bad_shape", id: fallbackId };
  const id = cleanText(raw["id"], 16) || fallbackId;
  const kindKey = cleanText(raw["kind"], 20).toLowerCase();
  const kind = ALIASES[kindKey];
  if (!kind) return { why: "bad_kind", id };
  const rawPts = Array.isArray(raw["points"]) ? (raw["points"] as unknown[]) : [];
  const [lo, hi] = ARITY[kind];
  if (rawPts.length < lo || rawPts.length > hi) return { why: "bad_arity", id };

  let points: PlanPoint[] = [];
  for (const rp of rawPts) {
    const r = resolvePoint(rp, named);
    if (!r.ok) return { why: r.why, id };
    points.push(r.p);
  }

  if (kind === "polyline") {
    points = points.filter((p, i) => i === 0 || dist(p, points[i - 1]) > 0.002);
    if (points.length < 2) return { why: "degenerate", id };
  }
  if ((kind === "line" || kind === "arrow") && dist(points[0], points[1]) < 0.008) return { why: "degenerate", id };
  if (kind === "circle") {
    const r = dist(points[0], points[1]);
    if (r < 0.004 || r > 1.5) return { why: "degenerate", id };
  }
  if (kind === "angle" && (dist(points[1], points[0]) < 0.008 || dist(points[1], points[2]) < 0.008)) return { why: "degenerate", id };

  const label = plain(cleanText(raw["label"], 60)).slice(0, 24);
  if (kind === "label" && !label) return { why: "empty_label", id };

  return {
    add: { id, kind, points, label, dashed: raw["dashed"] === true, extend: kind === "line" && raw["extend"] === true },
  };
}

/** يفحص خطة الرسم: يُسقط كل إضافة معطوبة مع سبب ظاهر، ولا شيء يُخمَّن. لا يرمي */
export function buildPlan(raw: unknown): DiagramPlan | null {
  if (!isObj(raw)) return null;
  const warnings: DiagramWarning[] = [];

  const named = new Map<string, NamedPoint>();
  const rawPoints = Array.isArray(raw["points"]) ? (raw["points"] as unknown[]).slice(0, MAX_NAMED_POINTS) : [];
  for (const rp of rawPoints) {
    if (!isObj(rp)) continue;
    const id = cleanText(rp["id"], 12);
    const c = readCoords(rp) ?? readCoords(rp["at"]);
    if (!id || !c || named.has(id)) continue;
    if (c.x < -OVERFLOW || c.x > 1 + OVERFLOW || c.y < -OVERFLOW || c.y > 1 + OVERFLOW) continue;
    const np: NamedPoint = { id, x: round3(clamp01(c.x)), y: round3(clamp01(c.y)), snap: rp["snap"] === true };
    named.set(id, np);
    if (!named.has(id.toLowerCase())) named.set(id.toLowerCase(), np);
  }
  const points = [...new Map([...named.values()].map((p) => [p.id, p])).values()];

  const rawAdds = Array.isArray(raw["additions"]) ? (raw["additions"] as unknown[]) : [];
  const additions: Addition[] = [];
  const seen = new Set<string>();
  rawAdds.slice(0, MAX_ADDITIONS).forEach((ra, i) => {
    const r = buildAddition(ra, i, named);
    if ("add" in r) {
      let id = r.add.id;
      while (seen.has(id)) id += "_";
      seen.add(id);
      additions.push({ ...r.add, id });
    } else {
      warnings.push({ code: "addition_dropped", detail: `${r.id}: ${r.why}` });
    }
  });
  if (rawAdds.length > MAX_ADDITIONS) warnings.push({ code: "addition_dropped", detail: `+${rawAdds.length - MAX_ADDITIONS}: too_many` });
  if (!additions.length) warnings.push({ code: "no_additions" });

  const kindRaw = cleanText(raw["figure_kind"], 30).toLowerCase();
  return {
    figureKind: /^[a-z_]+$/.test(kindRaw) ? kindRaw : "other",
    summary: plain(cleanText(raw["summary"], 220)),
    points,
    additions,
    warnings,
  };
}

/* ===================== الالتصاق بالحبر ===================== */

export interface SnapReport {
  additions: Addition[];
  snapped: number;
  maxMovedPx: number;
}

/**
 * النقاط التي علّمها النموذج `snap` (تقع على خط/منحنى الشكل) تُلصق بمركز أقرب حبر حقيقي
 * ضمن نصف قطر صغير؛ فتصيب الماسّ والتقاطعات والنقاط المسمّاة الأصل لا تقديرَ النموذج.
 */
export function snapAdditions(adds: Addition[], mask: Mask, w: number, h: number, radiusPx: number, strokePx: number): SnapReport {
  let snapped = 0, maxMovedPx = 0;
  const out = adds.map((a) => ({
    ...a,
    points: a.points.map((p) => {
      if (!p.snap) return p;
      const s = snapToInk(mask, w, h, p.x * w, p.y * h, radiusPx, strokePx);
      if (!s.snapped) return p;
      snapped++;
      maxMovedPx = Math.max(maxMovedPx, s.moved);
      return { ...p, x: round3(clamp01(s.x / w)), y: round3(clamp01(s.y / h)) };
    }),
  }));
  return { additions: out, snapped, maxMovedPx };
}

/**
 * خطوط الإرشاد (إسقاط على محور، مقارب، قطعة أفقية/عمودية) التي قرأها النموذج مائلة قليلاً
 * من خطأ في قراءة الشبكة تُجعل عمودية/أفقية تماماً، فيتعامد الإسقاط مع المحور حقاً.
 * الطرف الملتصق بالحبر هو المرساة (يبقى في مكانه) والطرف الآخر يتبعه.
 * المماسات والقواطع (مستقيم ممتد غير متقطع) لا تُمسّ: ميلها هو المطلوب نفسه.
 * w و h: أبعاد الصورة بالبكسل لقياس الزاوية في فضاء متساوي الأبعاد.
 */
export function straighten(adds: Addition[], w: number, h: number, maxAngleDeg = 6, maxOffset = 0.035): Addition[] {
  const side = Math.max(w, h);
  const tan = Math.tan((maxAngleDeg * Math.PI) / 180);
  return adds.map((a) => {
    if ((a.kind !== "line" && a.kind !== "arrow") || a.points.length !== 2) return a;
    if (a.extend && !a.dashed) return a;
    const [p, q] = a.points;
    const dx = (q.x - p.x) * w, dy = (q.y - p.y) * h;
    if (Math.hypot(dx, dy) < 0.02 * side) return a;
    if (p.snap && q.snap) return a; // كلاهما ملتصق بحبر حقيقي: لا نحرّك أيّاً منهما
    const anchorFirst = p.snap || !q.snap;
    if (Math.abs(dx) <= tan * Math.abs(dy) && Math.abs(dx) <= maxOffset * side) {
      const x = anchorFirst ? p.x : q.x;
      return { ...a, points: [{ ...p, x }, { ...q, x }] };
    }
    if (Math.abs(dy) <= tan * Math.abs(dx) && Math.abs(dy) <= maxOffset * side) {
      const y = anchorFirst ? p.y : q.y;
      return { ...a, points: [{ ...p, y }, { ...q, y }] };
    }
    return a;
  });
}

/* ===================== الرسم: SVG بسُمك مقيس ===================== */

export const INK = "#d11a2a";

/**
 * سُمك قلم الإضافات: من سُمك خط الشكل الأصلي مضروباً بمعامل التكبير، لا أقل من حدّ أدنى
 * يبقى مرئياً حتى لو الشكل رفيع، ولا أكثر من حدّ أعلى يغطي الشكل.
 */
export function chooseStroke(measuredPx: number, scale: number, outMaxSide: number): number {
  const lo = Math.max(3, outMaxSide * 0.0035);
  const hi = Math.max(lo, outMaxSide * 0.012);
  const v = measuredPx * scale * 1.25;
  return Math.round(Math.min(hi, Math.max(lo, v)) * 100) / 100;
}

/** يمدّ المستقيم المارّ بالنقطتين إلى حافتي المستطيل [0,w]×[0,h]؛ null إن لم يقطعه */
export function clipLineToRect(p: { x: number; y: number }, q: { x: number; y: number }, w: number, h: number): [{ x: number; y: number }, { x: number; y: number }] | null {
  const dx = q.x - p.x, dy = q.y - p.y;
  let t0 = -Infinity, t1 = Infinity;
  const test = (pn: number, qn: number): boolean => {
    // pn·t <= qn
    if (pn === 0) return qn >= 0;
    const r = qn / pn;
    if (pn < 0) { if (r > t1) return false; if (r > t0) t0 = r; }
    else { if (r < t0) return false; if (r < t1) t1 = r; }
    return true;
  };
  if (!test(-dx, p.x - 0) || !test(dx, w - p.x) || !test(-dy, p.y - 0) || !test(dy, h - p.y)) return null;
  if (!Number.isFinite(t0) || !Number.isFinite(t1)) return null;
  return [{ x: p.x + t0 * dx, y: p.y + t0 * dy }, { x: p.x + t1 * dx, y: p.y + t1 * dy }];
}

const f = (n: number) => String(Math.round(n * 100) / 100);
const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

/**
 * SVG مستقل بحجم الصورة (w×h بكسل) فيه الإضافات فقط على خلفية شفافة، بقلم أحمر ثابت السُمك.
 * يُرسم فوق أي قاعدة (الشكل المُعاد رسمه أو الصورة الأصلية المكبَّرة).
 */
export function additionsSvg(adds: Addition[], o: { w: number; h: number; stroke: number }): string {
  const { w, h, stroke } = o;
  const side = Math.max(w, h);
  const fs = Math.max(14, stroke * 5, side * 0.03);
  const dash = (a: Addition) => (a.dashed ? ` stroke-dasharray="${f(stroke * 3)} ${f(stroke * 2.2)}"` : "");
  const base = `fill="none" stroke="${INK}" stroke-width="${f(stroke)}" stroke-linecap="round" stroke-linejoin="round"`;
  const px = (p: { x: number; y: number }) => ({ x: p.x * w, y: p.y * h });
  const parts: string[] = [];

  const text = (t: string, x: number, y: number) => {
    if (!t) return;
    const estW = t.length * fs * 0.62;
    const cx = Math.min(Math.max(3, x), Math.max(3, w - estW - 3));
    const cy = Math.min(Math.max(fs + 2, y), h - 4);
    parts.push(
      `<text x="${f(cx)}" y="${f(cy)}" font-family="Segoe UI, Tahoma, Arial, sans-serif" font-weight="700" font-size="${f(fs)}" ` +
      `fill="${INK}" stroke="#ffffff" stroke-width="${f(fs * 0.3)}" paint-order="stroke" stroke-linejoin="round">${esc(t)}</text>`,
    );
  };
  const near = (p: { x: number; y: number }, label: string) => text(label, p.x + stroke * 2.5 + fs * 0.25, p.y - stroke * 2.5);

  for (const a of adds) {
    const P = a.points.map(px);
    if (a.kind === "line") {
      const seg = a.extend ? clipLineToRect(P[0], P[1], w, h) ?? [P[0], P[1]] : [P[0], P[1]];
      parts.push(`<line x1="${f(seg[0].x)}" y1="${f(seg[0].y)}" x2="${f(seg[1].x)}" y2="${f(seg[1].y)}" ${base}${dash(a)}/>`);
      near(a.extend ? seg[1] : P[1], a.label);
    } else if (a.kind === "arrow") {
      const [p, q] = P;
      const len = Math.hypot(q.x - p.x, q.y - p.y) || 1;
      const ux = (q.x - p.x) / len, uy = (q.y - p.y) / len;
      const hl = Math.min(len * 0.6, Math.max(stroke * 5, side * 0.025)), hw = hl * 0.42;
      const bx = q.x - ux * hl, by = q.y - uy * hl;
      parts.push(`<line x1="${f(p.x)}" y1="${f(p.y)}" x2="${f(bx + ux * hl * 0.5)}" y2="${f(by + uy * hl * 0.5)}" ${base}${dash(a)}/>`);
      parts.push(`<polygon points="${f(q.x)},${f(q.y)} ${f(bx - uy * hw)},${f(by + ux * hw)} ${f(bx + uy * hw)},${f(by - ux * hw)}" fill="${INK}" stroke="${INK}" stroke-width="${f(stroke * 0.4)}" stroke-linejoin="round"/>`);
      near(q, a.label);
    } else if (a.kind === "polyline") {
      let d = `M${f(P[0].x)} ${f(P[0].y)}`;
      if (P.length === 2) d += ` L${f(P[1].x)} ${f(P[1].y)}`;
      else {
        for (let i = 1; i < P.length - 1; i++) d += ` Q${f(P[i].x)} ${f(P[i].y)} ${f((P[i].x + P[i + 1].x) / 2)} ${f((P[i].y + P[i + 1].y) / 2)}`;
        d += ` L${f(P[P.length - 1].x)} ${f(P[P.length - 1].y)}`;
      }
      parts.push(`<path d="${d}" ${base}${dash(a)}/>`);
      near(P[P.length - 1], a.label);
    } else if (a.kind === "point") {
      parts.push(`<circle cx="${f(P[0].x)}" cy="${f(P[0].y)}" r="${f(stroke * 1.9)}" fill="${INK}" stroke="#ffffff" stroke-width="${f(stroke * 0.6)}"/>`);
      near(P[0], a.label);
    } else if (a.kind === "circle") {
      const r = Math.hypot(P[1].x - P[0].x, P[1].y - P[0].y);
      parts.push(`<circle cx="${f(P[0].x)}" cy="${f(P[0].y)}" r="${f(r)}" ${base}${dash(a)}/>`);
      near(P[0], a.label);
    } else if (a.kind === "angle") {
      const [A, V, B] = P;
      const a1 = Math.atan2(A.y - V.y, A.x - V.x), a2 = Math.atan2(B.y - V.y, B.x - V.x);
      let d = a2 - a1;
      while (d > Math.PI) d -= 2 * Math.PI;
      while (d <= -Math.PI) d += 2 * Math.PI;
      const arm = Math.min(Math.hypot(A.x - V.x, A.y - V.y), Math.hypot(B.x - V.x, B.y - V.y));
      const r = Math.max(stroke * 3, Math.min(arm * 0.35, side * 0.07));
      const sx = V.x + r * Math.cos(a1), sy = V.y + r * Math.sin(a1);
      const ex = V.x + r * Math.cos(a2), ey = V.y + r * Math.sin(a2);
      parts.push(`<path d="M${f(sx)} ${f(sy)} A${f(r)} ${f(r)} 0 0 ${d > 0 ? 1 : 0} ${f(ex)} ${f(ey)}" ${base}${dash(a)}/>`);
      const mid = a1 + d / 2;
      text(a.label, V.x + Math.cos(mid) * r * 1.8 - (a.label.length * fs * 0.3), V.y + Math.sin(mid) * r * 1.8 + fs * 0.35);
    } else if (a.kind === "label") {
      text(a.label, P[0].x, P[0].y);
    }
  }
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${f(w)} ${f(h)}" width="${f(w)}" height="${f(h)}">${parts.join("")}</svg>`;
}

/* ===================== قبول إعادة الرسم ===================== */

/**
 * عتبات قبول الشكل المُعاد رسمه. إعادة الرسم المرفوضة تكلّف فقط الانتقال للصورة الأصلية (دقيقة دائماً)،
 * أما المقبولة الخاطئة فتُري التلميذ شكلاً غير شكله؛ لذلك العتبات صارمة.
 *  structure: الخطوط الطويلة (محاور/منحنيات) f1 وrecall وprecision
 *  badShare:  أقصى حصة من الحبر الهيكلي تقع في كتل غير متطابقة (تكشف منحنى مقلوباً ضمن محاور سليمة)
 *  text:      مواضع النص الصغير (لا هويته) بتسامح مضاعف
 */
export const REDRAW_THRESHOLDS = { f1: 0.7, recall: 0.62, precision: 0.62, badShare: 0.12, textRecall: 0.5, textPrecision: 0.5 } as const;

export type RedrawVerdict = { ok: true } | { ok: false; why: "empty" | "structure" | "blocks" | "text" };

export function judgeRedraw(m: FigureMatch): RedrawVerdict {
  const s = m.structure;
  if (s.refInk === 0 || s.candInk === 0) return { ok: false, why: "empty" };
  if (s.f1 < REDRAW_THRESHOLDS.f1 || s.recall < REDRAW_THRESHOLDS.recall || s.precision < REDRAW_THRESHOLDS.precision) return { ok: false, why: "structure" };
  if (m.badShare > REDRAW_THRESHOLDS.badShare) return { ok: false, why: "blocks" };
  if (m.text.checked && (m.text.recall < REDRAW_THRESHOLDS.textRecall || m.text.precision < REDRAW_THRESHOLDS.textPrecision)) return { ok: false, why: "text" };
  return { ok: true };
}

export const acceptRedraw = (m: FigureMatch): boolean => judgeRedraw(m).ok;

/* ===================== نصوص التحذيرات ===================== */

export function describeDiagramWarning(w: DiagramWarning, lang: "ar" | "fr"): string {
  const ar = lang === "ar";
  switch (w.code) {
    case "multiple_figures":
      return ar ? `في الورقة ${w.detail} أشكال؛ اخترتُ الأقرب للإجابة، تأكد منه.` : `La feuille contient ${w.detail} figures ; j’ai choisi la plus proche de la réponse, à vérifier.`;
    case "erase_dropped":
      return ar ? "تجاهلتُ مناطق مسح غير موثوقة، فقد يبقى نص صغير حول الشكل." : "Zones d’effacement douteuses ignorées : du texte peut rester autour de la figure.";
    case "erase_too_large":
      return ar ? "منطقة المسح المقترحة تغطي معظم الشكل فلم أمسح شيئاً." : "La zone d’effacement proposée couvrait presque toute la figure : rien n’a été effacé.";
    case "addition_dropped":
      return ar ? `تعذر رسم عنصر مما يطلبه السؤال (${w.detail}).` : `Un élément demandé n’a pas pu être tracé (${w.detail}).`;
    case "no_additions":
      return ar ? "لم أستطع تحديد ما يجب رسمه فوق الشكل بدقة، فعرضتُ الشكل وحده." : "Impossible de déterminer précisément quoi tracer : la figure seule est affichée.";
    case "plan_failed":
      return ar ? "تعذر تحليل ما يطلبه السؤال من الشكل، فعرضتُ الشكل وحده مكبّراً." : "L’analyse de la consigne a échoué : figure seule, agrandie.";
    case "redraw_failed":
      return ar ? "تعذرت إعادة رسم الشكل، فاستعملتُ نظام الطوارئ على الصورة الأصلية." : "Le redessin a échoué : mode de secours sur l’image d’origine.";
    case "redraw_mismatch":
      return ar ? "الشكل المُعاد رسمه لا يطابق الأصل بما يكفي، فاستعملتُ الصورة الأصلية." : "Le redessin ne correspond pas assez à l’original : image d’origine utilisée.";
    case "low_resolution":
      return ar ? "الشكل صغير في الصورة فقد يبدو غير حاد بعد التكبير؛ صوّره من أقرب لنتيجة أدق." : "La figure est petite sur la photo : l’agrandissement peut être flou ; rapprochez-vous pour plus de précision.";
  }
}
