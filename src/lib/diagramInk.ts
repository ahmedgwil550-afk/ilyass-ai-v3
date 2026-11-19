/**
 * رياضيات نقطية بحتة (بلا DOM ولا canvas) لنظام الشكل:
 *  - استخراج قناع الحبر من صورة ورقة مصوَّرة
 *  - قياس سُمك خط الشكل الأصلي كي يُرسم فوقه بسُمك مطابق لا بخط واهٍ
 *  - مقارنة رسم مُعاد بالأصل (precision / recall بتسامح مسافة)
 *  - التصاق نقطة مقترحة بأقرب حبر حقيقي
 *  - تبييض الورقة ولون الخلفية حول منطقة تُمسح
 * كلها دوال على مصفوفات، فتُختبر بصور اصطناعية دقيقة، وتعمل في المتصفح وفي الاختبارات.
 */

export type Mask = Uint8Array; // 0 = خلفية، 1 = حبر

/** RGBA → تدرّج رمادي (الشفافية تُركَّب فوق الأبيض) */
export function rgbaToGray(rgba: ArrayLike<number>, w: number, h: number): Uint8Array {
  const out = new Uint8Array(w * h);
  for (let i = 0, p = 0; i < out.length; i++, p += 4) {
    const a = (rgba[p + 3] ?? 255) / 255;
    const r = rgba[p] * a + 255 * (1 - a);
    const g = rgba[p + 1] * a + 255 * (1 - a);
    const b = rgba[p + 2] * a + 255 * (1 - a);
    out[i] = Math.round(0.299 * r + 0.587 * g + 0.114 * b);
  }
  return out;
}

/** النسبة المئوية p (0..100) من قيم رمادية 0..255 عبر مدرّج تكراري */
export function percentile(gray: ArrayLike<number>, p: number): number {
  const hist = new Uint32Array(256);
  for (let i = 0; i < gray.length; i++) hist[Math.min(255, Math.max(0, gray[i] | 0))]++;
  const target = (Math.min(100, Math.max(0, p)) / 100) * gray.length;
  let acc = 0;
  for (let v = 0; v < 256; v++) {
    acc += hist[v];
    if (acc >= target) return v;
  }
  return 255;
}

/**
 * الحبر = ما هو أغمق بوضوح من لون الورقة (المئين 90).
 * عتبة نسبية لا مطلقة: الورقة في الظل أو المصفرّة تبقى سليمة.
 */
export function inkMask(gray: ArrayLike<number>, w: number, h: number): Mask {
  const n = w * h;
  const out = new Uint8Array(n);
  if (n === 0) return out;
  const bg = percentile(gray, 90);
  const t = Math.min(bg * 0.72, bg - 35);
  for (let i = 0; i < n; i++) out[i] = gray[i] < t ? 1 : 0;
  return out;
}

export function countInk(mask: Mask): number {
  let c = 0;
  for (let i = 0; i < mask.length; i++) c += mask[i];
  return c;
}

/** خريطة المسافة إلى أقرب بكسل حبر (chamfer بمرورين). مسافة الحبر نفسه = 0 */
export function distanceMap(mask: Mask, w: number, h: number): Float32Array {
  const INF = 1e9;
  const D = new Float32Array(w * h);
  for (let i = 0; i < D.length; i++) D[i] = mask[i] ? 0 : INF;
  const S = Math.SQRT2;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = y * w + x;
      let d = D[i];
      if (x > 0) d = Math.min(d, D[i - 1] + 1);
      if (y > 0) {
        d = Math.min(d, D[i - w] + 1);
        if (x > 0) d = Math.min(d, D[i - w - 1] + S);
        if (x < w - 1) d = Math.min(d, D[i - w + 1] + S);
      }
      D[i] = d;
    }
  }
  for (let y = h - 1; y >= 0; y--) {
    for (let x = w - 1; x >= 0; x--) {
      const i = y * w + x;
      let d = D[i];
      if (x < w - 1) d = Math.min(d, D[i + 1] + 1);
      if (y < h - 1) {
        d = Math.min(d, D[i + w] + 1);
        if (x < w - 1) d = Math.min(d, D[i + w + 1] + S);
        if (x > 0) d = Math.min(d, D[i + w - 1] + S);
      }
      D[i] = d;
    }
  }
  return D;
}

export interface Similarity {
  precision: number;
  recall: number;
  f1: number;
  refInk: number;
  candInk: number;
}

/**
 * مقارنة الرسم المُعاد (cand) بالأصل (ref) بتسامح مسافة tol بكسل:
 *  recall    = كم من حبر الأصل وجد له رسمنا نظيراً قريباً
 *  precision = كم من حبر رسمنا له نظير في الأصل (يلتقط الخطوط المخترَعة)
 * أحدهما صفر (أو لا حبر) ⇒ التشابه صفر: لا نعطي ثقة على فراغ.
 */
export function similarity(ref: Mask, cand: Mask, w: number, h: number, tol: number): Similarity {
  const refInk = countInk(ref), candInk = countInk(cand);
  if (refInk === 0 || candInk === 0) return { precision: 0, recall: 0, f1: 0, refInk, candInk };
  const dRef = distanceMap(ref, w, h);
  const dCand = distanceMap(cand, w, h);
  let rHit = 0, cHit = 0;
  for (let i = 0; i < ref.length; i++) {
    if (ref[i] && dCand[i] <= tol) rHit++;
    if (cand[i] && dRef[i] <= tol) cHit++;
  }
  const recall = rHit / refInk, precision = cHit / candInk;
  const f1 = precision + recall === 0 ? 0 : (2 * precision * recall) / (precision + recall);
  return { precision, recall, f1, refInk, candInk };
}

/**
 * مكوّنات الحبر المتصلة (8 جيران): تُقسَم إلى "هيكلية" (خطوط طويلة: محاور، منحنيات، أضلاع، دوائر)
 * و"نصية" (حروف وأرقام وعلامات صغيرة). الهيكل هو ما نتحقق منه بصرامة؛ النص يُفحص موضعاً فقط.
 * مكوّنات أصغر من minArea بكسل تُعدّ ضجيجاً وتُهمَل.
 */
export function splitStructure(mask: Mask, w: number, h: number, minSide: number, minArea = 4): { structure: Mask; text: Mask } {
  const structure = new Uint8Array(w * h), text = new Uint8Array(w * h);
  const seen = new Uint8Array(w * h);
  for (let start = 0; start < mask.length; start++) {
    if (!mask[start] || seen[start]) continue;
    const comp: number[] = [];
    const stack = [start];
    seen[start] = 1;
    const sx = start % w, sy = (start - sx) / w;
    let minX = sx, maxX = sx, minY = sy, maxY = sy;
    while (stack.length) {
      const i = stack.pop()!;
      comp.push(i);
      const cx = i % w, cy = (i - cx) / w;
      if (cx < minX) minX = cx; if (cx > maxX) maxX = cx;
      if (cy < minY) minY = cy; if (cy > maxY) maxY = cy;
      for (let dy = -1; dy <= 1; dy++) {
        const ny = cy + dy;
        if (ny < 0 || ny >= h) continue;
        for (let dx = -1; dx <= 1; dx++) {
          const nx = cx + dx;
          if (nx < 0 || nx >= w || (dx === 0 && dy === 0)) continue;
          const ni = ny * w + nx;
          if (mask[ni] && !seen[ni]) { seen[ni] = 1; stack.push(ni); }
        }
      }
    }
    if (comp.length < minArea) continue;
    const big = Math.max(maxX - minX + 1, maxY - minY + 1) >= minSide;
    const target = big ? structure : text;
    for (const i of comp) target[i] = 1;
  }
  return { structure, text };
}

export interface FigureMatch {
  /** مقارنة الخطوط الطويلة فقط (أو الحبر كله إن لم يوجد هيكل كافٍ) */
  structure: Similarity;
  /** حصة الحبر الهيكلي الواقعة في كتل (شبكة 8×8) لا تتطابق: تكشف منحنى مقلوباً/ناقصاً مهما كثر الحبر المتطابق حوله */
  badShare: number;
  /** النص الصغير (حروف/أرقام): هل مواضعه متوافقة؟ لا يتحقق من هوية الحرف، فقط وجوده في مكانه */
  text: { checked: boolean; recall: number; precision: number };
  /** F1 للهيكل: الرقم الذي يُعرض */
  f1: number;
  /** هل قيس الهيكل فعلاً أم استُعمل الحبر كله لقلة الخطوط الطويلة */
  usedStructure: boolean;
}

const TEXT_MIN_INK = 150;
const STRUCTURE_MIN_INK = 200;

/**
 * مقارنة شكل مُعاد رسمه بالأصل بطريقتين متكاملتين:
 *  - الخطوط الطويلة (الهيكل): f1 عام + كتل محلية، فمنحنى خاطئ لا يضيع وسط محاور متطابقة
 *  - النص الصغير: وجوده في مواضعه (بتسامح مضاعف)
 */
export function compareFigures(ref: Mask, cand: Mask, w: number, h: number, tol: number): FigureMatch {
  const minSide = Math.max(8, Math.round(Math.max(w, h) * 0.06));
  const R = splitStructure(ref, w, h, minSide);
  const C = splitStructure(cand, w, h, minSide);
  const usedStructure = countInk(R.structure) >= STRUCTURE_MIN_INK;
  const rs = usedStructure ? R.structure : ref;
  const cs = usedStructure ? C.structure : cand;
  const structure = similarity(rs, cs, w, h, tol);

  // كتل محلية
  let badShare = 0;
  if (structure.refInk > 0 && structure.candInk > 0) {
    const G = 8;
    const dRef = distanceMap(rs, w, h), dCand = distanceMap(cs, w, h);
    const refTot = new Float64Array(G * G), refHit = new Float64Array(G * G), candTot = new Float64Array(G * G), candHit = new Float64Array(G * G);
    for (let y = 0; y < h; y++) {
      const gy = Math.min(G - 1, Math.floor((y * G) / h));
      for (let x = 0; x < w; x++) {
        const i = y * w + x;
        const b = gy * G + Math.min(G - 1, Math.floor((x * G) / w));
        if (rs[i]) { refTot[b]++; if (dCand[i] <= tol) refHit[b]++; }
        if (cs[i]) { candTot[b]++; if (dRef[i] <= tol) candHit[b]++; }
      }
    }
    const minInk = Math.max(12, 0.012 * Math.max(structure.refInk, structure.candInk));
    let bad = 0;
    for (let b = 0; b < G * G; b++) {
      const badRef = refTot[b] >= minInk && refHit[b] / refTot[b] < 0.5;
      const badCand = candTot[b] >= minInk && candHit[b] / candTot[b] < 0.5;
      if (badRef || badCand) bad += refTot[b] + candTot[b];
    }
    badShare = bad / (structure.refInk + structure.candInk);
  }

  const textSim = similarity(R.text, C.text, w, h, tol * 2);
  const checked = countInk(R.text) >= TEXT_MIN_INK || countInk(C.text) >= TEXT_MIN_INK;
  return {
    structure,
    badShare: Math.round(badShare * 1000) / 1000,
    text: { checked, recall: textSim.recall, precision: textSim.precision },
    f1: structure.f1,
    usedStructure,
  };
}

/**
 * سُمك الخط النموذجي بالبكسل: وسيط أطوال تتابعات الحبر الأفقية والعمودية القصيرة.
 * الخط الأفقي الطويل يعطي تتابعات عمودية بسُمكه الحقيقي (والأفقية الطويلة تُستبعد).
 */
export function estimateStrokeWidth(mask: Mask, w: number, h: number): number {
  const cap = Math.max(4, Math.round(Math.max(w, h) * 0.06));
  const runs: number[] = [];
  const push = (len: number) => { if (len > 0 && len <= cap) runs.push(len); };
  for (let y = 0; y < h; y++) {
    let run = 0;
    for (let x = 0; x < w; x++) {
      if (mask[y * w + x]) run++;
      else { push(run); run = 0; }
    }
    push(run);
  }
  for (let x = 0; x < w; x++) {
    let run = 0;
    for (let y = 0; y < h; y++) {
      if (mask[y * w + x]) run++;
      else { push(run); run = 0; }
    }
    push(run);
  }
  if (!runs.length) return 1;
  runs.sort((a, b) => a - b);
  return Math.max(1, runs[Math.floor(runs.length / 2)]);
}

export interface Snap {
  x: number;
  y: number;
  snapped: boolean;
  moved: number;
}

/**
 * يلصق نقطة (بالبكسل) بمركز أقرب خط حبر ضمن نصف قطر معلوم.
 * لا حبر قريباً ⇒ تبقى النقطة كما هي ولا يُدّعى التصاقها.
 */
export function snapToInk(mask: Mask, w: number, h: number, x: number, y: number, radius: number, stroke = 3): Snap {
  const R = Math.max(1, Math.ceil(radius));
  let bx = -1, by = -1, bd = Infinity;
  const x0 = Math.max(0, Math.floor(x) - R), x1 = Math.min(w - 1, Math.floor(x) + R);
  const y0 = Math.max(0, Math.floor(y) - R), y1 = Math.min(h - 1, Math.floor(y) + R);
  for (let yy = y0; yy <= y1; yy++) {
    for (let xx = x0; xx <= x1; xx++) {
      if (!mask[yy * w + xx]) continue;
      const d = Math.hypot(xx - x, yy - y);
      if (d <= radius && d < bd) { bd = d; bx = xx; by = yy; }
    }
  }
  if (bx < 0) return { x, y, snapped: false, moved: 0 };
  // مركز كتلة الحبر حول أقرب نقطة = منتصف الخط لا حافته
  const r = Math.max(2, Math.ceil(stroke * 1.2));
  let sx = 0, sy = 0, n = 0;
  for (let yy = Math.max(0, by - r); yy <= Math.min(h - 1, by + r); yy++) {
    for (let xx = Math.max(0, bx - r); xx <= Math.min(w - 1, bx + r); xx++) {
      if (mask[yy * w + xx] && Math.hypot(xx - bx, yy - by) <= r) { sx += xx; sy += yy; n++; }
    }
  }
  const nx = n ? sx / n : bx, ny = n ? sy / n : by;
  return { x: nx, y: ny, snapped: true, moved: Math.hypot(nx - x, ny - y) };
}

/**
 * لون الورقة حول مستطيل (حلقة بعرض ring بكسل خارجه) مع تجاهل بكسلات الحبر.
 * لا حلقة صالحة ⇒ أبيض.
 */
export function bgAround(
  rgba: ArrayLike<number>, W: number, H: number,
  rect: { x: number; y: number; w: number; h: number }, ring = 4,
): [number, number, number] {
  let R = 0, G = 0, B = 0, n = 0;
  const add = (sx: number, sy: number, sw: number, sh: number) => {
    const x0 = Math.max(0, Math.floor(sx)), y0 = Math.max(0, Math.floor(sy));
    const x1 = Math.min(W, Math.floor(sx + sw)), y1 = Math.min(H, Math.floor(sy + sh));
    for (let y = y0; y < y1; y++) {
      for (let x = x0; x < x1; x++) {
        const p = (y * W + x) * 4;
        if (rgba[p] + rgba[p + 1] + rgba[p + 2] < 360) continue; // حبر
        R += rgba[p]; G += rgba[p + 1]; B += rgba[p + 2]; n++;
      }
    }
  };
  add(rect.x, rect.y - ring, rect.w, ring);
  add(rect.x, rect.y + rect.h, rect.w, ring);
  add(rect.x - ring, rect.y, ring, rect.h);
  add(rect.x + rect.w, rect.y, ring, rect.h);
  return n ? [Math.round(R / n), Math.round(G / n), Math.round(B / n)] : [255, 255, 255];
}

/** يملأ مستطيلاً بلون ثابت داخل RGBA (يُقصّ على حدود الصورة) */
export function fillRect(
  rgba: Uint8ClampedArray | Uint8Array, W: number, H: number,
  rect: { x: number; y: number; w: number; h: number }, color: [number, number, number],
): void {
  const x0 = Math.max(0, Math.floor(rect.x)), y0 = Math.max(0, Math.floor(rect.y));
  const x1 = Math.min(W, Math.ceil(rect.x + rect.w)), y1 = Math.min(H, Math.ceil(rect.y + rect.h));
  for (let y = y0; y < y1; y++) {
    for (let x = x0; x < x1; x++) {
      const p = (y * W + x) * 4;
      rgba[p] = color[0]; rgba[p + 1] = color[1]; rgba[p + 2] = color[2]; rgba[p + 3] = 255;
    }
  }
}

/**
 * توازن أبيض + مدّ التباين لكل قناة لونية على حدة: لون الورقة ← أبيض، أغمق الحبر ← أسود.
 * نقطة البياض أدنى قليلاً من لون الورقة (86% من المدى) فتتبخّر حبيبات الورق وظلال الإضاءة الخفيفة.
 * على صورة مسطّحة (لا فرق يُذكر بين الورقة والحبر) لا يغيّر شيئاً كي لا يضخّم الضجيج.
 */
export function whitenPaper(rgba: Uint8ClampedArray | Uint8Array, w: number, h: number): void {
  const n = w * h;
  if (n === 0) return;
  const bg = [0, 0, 0], low = [0, 0, 0];
  const ch = new Uint8Array(n);
  let widest = 0;
  for (let c = 0; c < 3; c++) {
    for (let i = 0; i < n; i++) ch[i] = rgba[i * 4 + c];
    bg[c] = percentile(ch, 90);
    low[c] = percentile(ch, 0.3);
    widest = Math.max(widest, bg[c] - low[c]);
  }
  if (widest < 40) return;
  for (let c = 0; c < 3; c++) {
    const span = Math.max(8, (bg[c] - low[c]) * 0.86);
    for (let i = 0; i < n; i++) {
      const p = i * 4 + c;
      const v = ((rgba[p] - low[c]) / span) * 255;
      rgba[p] = v < 0 ? 0 : v > 255 ? 255 : v;
    }
  }
}

/**
 * شحذ خفيف (unsharp mask بمتوسط 3×3) بعد التكبير: يعيد للخط الرفيع حدّته كي لا يبدو الشكل المكبَّر ضبابياً.
 * يعدّل RGB في مكانه ويترك الشفافية.
 */
export function sharpen(rgba: Uint8ClampedArray | Uint8Array, w: number, h: number, amount = 0.6): void {
  if (w < 3 || h < 3 || amount <= 0) return;
  const src = new Uint8ClampedArray(rgba);
  for (let y = 0; y < h; y++) {
    const y0 = Math.max(0, y - 1), y1 = Math.min(h - 1, y + 1);
    for (let x = 0; x < w; x++) {
      const x0 = Math.max(0, x - 1), x1 = Math.min(w - 1, x + 1);
      const p = (y * w + x) * 4;
      for (let c = 0; c < 3; c++) {
        let sum = 0, n = 0;
        for (let yy = y0; yy <= y1; yy++) for (let xx = x0; xx <= x1; xx++) { sum += src[(yy * w + xx) * 4 + c]; n++; }
        const v = src[p + c] + amount * (src[p + c] - sum / n);
        rgba[p + c] = v < 0 ? 0 : v > 255 ? 255 : v;
      }
    }
  }
}

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

/**
 * يمسح نصاً (مناطق rects بالبكسل) بلون الورقة دون أن يقطع خطوط الشكل التي تمرّ بالمنطقة.
 * مكوّنات الحبر المتصلة: ما كان صغيراً داخل المنطقة (حروف) يُمسح، وما يمتد خارجها (محور، منحنى، سهم)
 * يُحفظ مع حافته الناعمة. حروف تلامس خط الشكل تبقى جزءاً منه (حدّ معروف، أفضل من قطع الخط).
 * يعدّل rgba في مكانه ويعيد عدد البكسلات الممسوحة والمحفوظة.
 */
export function eraseKeepingStrokes(
  rgba: Uint8ClampedArray | Uint8Array, W: number, H: number, rects: Rect[], opts: { margin?: number; ring?: number } = {},
): { erased: number; kept: number } {
  if (!rects.length) return { erased: 0, kept: 0 };
  const margin = opts.margin ?? Math.max(4, Math.round(Math.max(W, H) * 0.006));
  const ring = opts.ring ?? Math.max(4, Math.round(W * 0.006));
  const mask = inkMask(rgbaToGray(rgba, W, H), W, H);

  const bounds = rects.map((r) => ({
    x0: Math.max(0, Math.floor(r.x)), y0: Math.max(0, Math.floor(r.y)),
    x1: Math.min(W, Math.ceil(r.x + r.w)), y1: Math.min(H, Math.ceil(r.y + r.h)),
  }));
  const colors = rects.map((r) => bgAround(rgba, W, H, r, ring)); // قبل أي تعديل

  const visited = new Uint8Array(W * H);
  const keep = new Uint8Array(W * H);
  let kept = 0;
  for (const b of bounds) {
    for (let y = b.y0; y < b.y1; y++) {
      for (let x = b.x0; x < b.x1; x++) {
        const i0 = y * W + x;
        if (!mask[i0] || visited[i0]) continue;
        // مكوّن متصل (8 جيران): نجمع حدوده وبكسلاته
        const comp: number[] = [];
        const stack = [i0];
        visited[i0] = 1;
        let minX = x, maxX = x, minY = y, maxY = y;
        while (stack.length) {
          const i = stack.pop()!;
          comp.push(i);
          const cx = i % W, cy = (i - cx) / W;
          if (cx < minX) minX = cx; if (cx > maxX) maxX = cx;
          if (cy < minY) minY = cy; if (cy > maxY) maxY = cy;
          for (let dy = -1; dy <= 1; dy++) {
            const ny = cy + dy;
            if (ny < 0 || ny >= H) continue;
            for (let dx = -1; dx <= 1; dx++) {
              const nx = cx + dx;
              if (nx < 0 || nx >= W || (dx === 0 && dy === 0)) continue;
              const ni = ny * W + nx;
              if (mask[ni] && !visited[ni]) { visited[ni] = 1; stack.push(ni); }
            }
          }
        }
        // هيكلي = يخرج من أي منطقة مسح تلمسه بأكثر من الهامش
        const inside = bounds.some((r) => minX >= r.x0 - margin && maxX < r.x1 + margin && minY >= r.y0 - margin && maxY < r.y1 + margin);
        if (!inside) for (const i of comp) { keep[i] = 1; kept++; }
      }
    }
  }

  // حافة ناعمة: نحمي جوار بكسل واحد حول الحبر الهيكلي
  const protectedPx = new Uint8Array(W * H);
  for (const b of bounds) {
    for (let y = b.y0; y < b.y1; y++) {
      for (let x = b.x0; x < b.x1; x++) {
        if (!keep[y * W + x]) continue;
        for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) {
          const nx = x + dx, ny = y + dy;
          if (nx >= 0 && nx < W && ny >= 0 && ny < H) protectedPx[ny * W + nx] = 1;
        }
      }
    }
  }

  let erased = 0;
  bounds.forEach((b, ri) => {
    const col = colors[ri];
    for (let y = b.y0; y < b.y1; y++) {
      for (let x = b.x0; x < b.x1; x++) {
        const i = y * W + x;
        if (protectedPx[i]) continue;
        const p = i * 4;
        rgba[p] = col[0]; rgba[p + 1] = col[1]; rgba[p + 2] = col[2]; rgba[p + 3] = 255;
        erased++;
      }
    }
  });
  return { erased, kept };
}
