import { describe, expect, it } from "vitest";
import { judgeRedraw } from "./diagram";
import {
  bgAround, compareFigures, countInk, distanceMap, eraseKeepingStrokes, estimateStrokeWidth, fillRect, inkMask, percentile,
  rgbaToGray, sharpen, similarity, splitStructure, snapToInk, whitenPaper,
} from "./diagramInk";

const W = 120, H = 80;

/** صورة رمادية بيضاء بحبر داكن حيث يُرسم */
function canvas(w = W, h = H, bg = 240) {
  const g = new Uint8Array(w * h).fill(bg);
  return {
    g, w, h,
    rect(x: number, y: number, rw: number, rh: number, v = 20) {
      for (let yy = y; yy < y + rh; yy++) for (let xx = x; xx < x + rw; xx++) if (xx >= 0 && yy >= 0 && xx < w && yy < h) g[yy * w + xx] = v;
    },
    hline(y: number, x0: number, x1: number, t: number) { this.rect(x0, y - Math.floor(t / 2), x1 - x0, t); },
    vline(x: number, y0: number, y1: number, t: number) { this.rect(x - Math.floor(t / 2), y0, t, y1 - y0); },
  };
}

describe("rgbaToGray / percentile", () => {
  it("الأبيض 255 والأسود 0 والشفاف يُركَّب فوق الأبيض", () => {
    const px = [255, 255, 255, 255, 0, 0, 0, 255, 0, 0, 0, 0];
    const g = rgbaToGray(px, 3, 1);
    expect(Array.from(g)).toEqual([255, 0, 255]);
  });
  it("المئين على مدرّج بسيط", () => {
    const a = new Uint8Array(100);
    for (let i = 0; i < 100; i++) a[i] = i < 90 ? 200 : 10;
    expect(percentile(a, 50)).toBe(200);
    expect(percentile(a, 5)).toBe(10);
  });
});

describe("inkMask", () => {
  it("يلتقط الخط الداكن ولا يلتقط الورقة", () => {
    const c = canvas();
    c.hline(40, 10, 110, 3);
    const m = inkMask(c.g, c.w, c.h);
    expect(countInk(m)).toBe(100 * 3);
  });
  it("ورقة مظلّلة (رمادية فاتحة) بلا حبر = صفر حبر", () => {
    const c = canvas(W, H, 180);
    expect(countInk(inkMask(c.g, c.w, c.h))).toBe(0);
  });
  it("صورة فارغة الأبعاد لا ترمي", () => {
    expect(inkMask(new Uint8Array(0), 0, 0).length).toBe(0);
  });
});

describe("distanceMap", () => {
  it("المسافة أفقياً وقطرياً", () => {
    const m = new Uint8Array(11 * 11);
    m[5 * 11 + 5] = 1;
    const d = distanceMap(m, 11, 11);
    expect(d[5 * 11 + 5]).toBe(0);
    expect(d[5 * 11 + 8]).toBe(3);
    expect(Math.abs(d[8 * 11 + 8] - 3 * Math.SQRT2) < 1e-4).toBe(true);
  });
});

describe("similarity", () => {
  it("رسم مطابق تماماً = 1، ومزاح بكسلين ضمن التسامح = 1 تقريباً", () => {
    const a = canvas(); a.hline(30, 10, 100, 3); a.vline(60, 5, 75, 3);
    const same = similarity(inkMask(a.g, a.w, a.h), inkMask(a.g, a.w, a.h), W, H, 4);
    expect(same.f1).toBe(1);
    const b = canvas(); b.hline(32, 10, 100, 3); b.vline(62, 5, 75, 3);
    const shifted = similarity(inkMask(a.g, W, H), inkMask(b.g, W, H), W, H, 4);
    expect(shifted.f1 > 0.99).toBe(true);
  });

  it("رسم يخالف الأصل بوضوح يسقط تحت العتبة", () => {
    const a = canvas(); a.hline(30, 10, 100, 3); a.vline(60, 5, 75, 3);
    const b = canvas(); b.hline(70, 10, 100, 3); b.vline(15, 5, 75, 3);
    const s = similarity(inkMask(a.g, W, H), inkMask(b.g, W, H), W, H, 4);
    expect(s.f1 < 0.2).toBe(true);
  });

  it("خط مخترَع زائد يخفض precision، وخط ناقص يخفض recall", () => {
    const a = canvas(); a.hline(30, 10, 100, 3); a.vline(60, 5, 75, 3);
    const extra = canvas(); extra.hline(30, 10, 100, 3); extra.vline(60, 5, 75, 3); extra.hline(65, 10, 100, 3);
    const s1 = similarity(inkMask(a.g, W, H), inkMask(extra.g, W, H), W, H, 4);
    expect(s1.recall > 0.99).toBe(true);
    expect(s1.precision < 0.8).toBe(true);
    const missing = canvas(); missing.hline(30, 10, 100, 3);
    const s2 = similarity(inkMask(a.g, W, H), inkMask(missing.g, W, H), W, H, 4);
    expect(s2.precision > 0.99).toBe(true);
    expect(s2.recall < 0.7).toBe(true);
  });

  it("لا حبر في أحد الطرفين = صفر (لا ثقة على فراغ)", () => {
    const a = canvas(); a.hline(30, 10, 100, 3);
    const blank = canvas();
    expect(similarity(inkMask(a.g, W, H), inkMask(blank.g, W, H), W, H, 4).f1).toBe(0);
    expect(similarity(inkMask(blank.g, W, H), inkMask(a.g, W, H), W, H, 4).f1).toBe(0);
  });
});

describe("estimateStrokeWidth", () => {
  it("خط أفقي سُمكه 5 يعطي 5", () => {
    const c = canvas(); c.hline(40, 5, 115, 5);
    expect(estimateStrokeWidth(inkMask(c.g, W, H), W, H)).toBe(5);
  });
  it("خط عمودي سُمكه 3 يعطي 3", () => {
    const c = canvas(); c.vline(60, 3, 77, 3);
    expect(estimateStrokeWidth(inkMask(c.g, W, H), W, H)).toBe(3);
  });
  it("بلا حبر = 1", () => {
    expect(estimateStrokeWidth(new Uint8Array(W * H), W, H)).toBe(1);
  });
});

describe("snapToInk", () => {
  it("يلصق النقطة بمنتصف الخط لا بحافته", () => {
    const c = canvas(); c.hline(40, 5, 115, 5); // الصفوف 38..42، المنتصف y=40
    const s = snapToInk(inkMask(c.g, W, H), W, H, 60, 36, 6, 5);
    expect(s.snapped).toBe(true);
    expect(Math.abs(s.y - 40) < 0.6).toBe(true);
    expect(Math.abs(s.x - 60) < 3).toBe(true);
  });
  it("لا حبر ضمن نصف القطر ⇒ لا التصاق ولا إزاحة", () => {
    const c = canvas(); c.hline(70, 5, 115, 3);
    const s = snapToInk(inkMask(c.g, W, H), W, H, 60, 20, 6);
    expect(s).toEqual({ x: 60, y: 20, snapped: false, moved: 0 });
  });
  it("عند حدود الصورة لا يقرأ خارجها", () => {
    const c = canvas(); c.vline(0, 0, 80, 2);
    const s = snapToInk(inkMask(c.g, W, H), W, H, 1, 1, 5);
    expect(s.snapped === true || s.snapped === false).toBe(true);
  });
});

describe("bgAround / fillRect / whitenPaper", () => {
  const rgbaOf = (w: number, h: number, c: [number, number, number]) => {
    const a = new Uint8ClampedArray(w * h * 4);
    for (let i = 0; i < w * h; i++) { a[i * 4] = c[0]; a[i * 4 + 1] = c[1]; a[i * 4 + 2] = c[2]; a[i * 4 + 3] = 255; }
    return a;
  };

  it("لون الخلفية حول المستطيل يتجاهل الحبر", () => {
    const px = rgbaOf(40, 40, [250, 245, 230]);
    for (let x = 0; x < 40; x++) { const p = (9 * 40 + x) * 4; px[p] = px[p + 1] = px[p + 2] = 0; } // خط حبر فوق المستطيل
    const bg = bgAround(px, 40, 40, { x: 10, y: 10, w: 20, h: 20 }, 4);
    expect(bg).toEqual([250, 245, 230]);
  });

  it("حلقة كلها حبر ⇒ أبيض", () => {
    const px = rgbaOf(40, 40, [0, 0, 0]);
    expect(bgAround(px, 40, 40, { x: 10, y: 10, w: 20, h: 20 })).toEqual([255, 255, 255]);
  });

  it("fillRect يملأ المنطقة ويُقصّ على الحدود", () => {
    const px = rgbaOf(10, 10, [0, 0, 0]);
    fillRect(px, 10, 10, { x: 8, y: 8, w: 10, h: 10 }, [255, 255, 255]);
    expect(px[(9 * 10 + 9) * 4]).toBe(255);
    expect(px[(7 * 10 + 7) * 4]).toBe(0);
  });

  it("تبييض الورقة: الورقة الرمادية تصير بيضاء والحبر يبقى داكناً", () => {
    const w = 60, h = 60;
    const px = rgbaOf(w, h, [190, 190, 185]);
    for (let y = 20; y < 24; y++) for (let x = 5; x < 55; x++) { const p = (y * w + x) * 4; px[p] = px[p + 1] = px[p + 2] = 60; }
    whitenPaper(px, w, h);
    expect(px[0] > 250).toBe(true);
    expect(px[(21 * w + 30) * 4] < 5).toBe(true);
  });

  it("ورقة مسطّحة لا تُغيَّر", () => {
    const px = rgbaOf(20, 20, [200, 200, 200]);
    whitenPaper(px, 20, 20);
    expect(px[0]).toBe(200);
  });
});

describe("sharpen", () => {
  const solid = (w: number, h: number, v: number) => {
    const a = new Uint8ClampedArray(w * h * 4);
    for (let i = 0; i < w * h; i++) { a[i * 4] = a[i * 4 + 1] = a[i * 4 + 2] = v; a[i * 4 + 3] = 255; }
    return a;
  };

  it("منطقة مسطّحة لا تتغير والشفافية لا تُمسّ", () => {
    const a = solid(6, 6, 120);
    a[3] = 77;
    sharpen(a, 6, 6, 0.8);
    expect(a[0]).toBe(120);
    expect(a[3]).toBe(77);
  });

  it("الحافة تزداد حدّة: الداكن يصير أغمق والفاتح أفتح قرب الحدّ", () => {
    const w = 8, h = 4;
    const a = solid(w, h, 200);
    for (let y = 0; y < h; y++) for (let x = 0; x < 4; x++) { const p = (y * w + x) * 4; a[p] = a[p + 1] = a[p + 2] = 60; }
    sharpen(a, w, h, 0.8);
    expect(a[(1 * w + 3) * 4] < 60).toBe(true);
    expect(a[(1 * w + 4) * 4] > 200).toBe(true);
    expect(a[(1 * w + 0) * 4]).toBe(60); // بعيداً عن الحافة لا تغيير
  });

  it("صورة أصغر من 3 بكسل أو مقدار صفر: لا شيء", () => {
    const a = solid(2, 2, 90);
    sharpen(a, 2, 2, 1);
    expect(a[0]).toBe(90);
    const b = solid(5, 5, 90); b[(2 * 5 + 2) * 4] = 0;
    sharpen(b, 5, 5, 0);
    expect(b[(2 * 5 + 2) * 4]).toBe(0);
  });
});

describe("whitenPaper: توازن الأبيض", () => {
  it("ورقة مصفرّة بضجيج خفيف تصير بيضاء محايدة، والحبر يبقى داكناً بلا صبغة", () => {
    const w = 80, h = 60;
    const a = new Uint8ClampedArray(w * h * 4);
    let seed = 3; const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
    for (let i = 0; i < w * h; i++) {
      const k = 1 - rnd() * 0.06; // حبيبات حتى 6% أغمق
      a[i * 4] = 236 * k; a[i * 4 + 1] = 220 * k; a[i * 4 + 2] = 170 * k; a[i * 4 + 3] = 255;
    }
    for (let y = 28; y < 32; y++) for (let x = 5; x < 75; x++) { const p = (y * w + x) * 4; a[p] = 40; a[p + 1] = 38; a[p + 2] = 36; }
    whitenPaper(a, w, h);
    let paperMin = 255;
    for (let i = 0; i < w * h; i++) { const y = Math.floor(i / w); if (y >= 28 && y < 32) continue; paperMin = Math.min(paperMin, a[i * 4], a[i * 4 + 1], a[i * 4 + 2]); }
    expect(paperMin >= 250).toBe(true);
    const ink = (30 * w + 40) * 4;
    expect(a[ink] < 8 && a[ink + 1] < 8 && a[ink + 2] < 8).toBe(true);
  });
});

describe("eraseKeepingStrokes", () => {
  const W = 200, H = 120;
  const base = () => {
    const a = new Uint8ClampedArray(W * H * 4);
    for (let i = 0; i < W * H; i++) { a[i * 4] = 238; a[i * 4 + 1] = 232; a[i * 4 + 2] = 215; a[i * 4 + 3] = 255; }
    return a;
  };
  const dark = (a: Uint8ClampedArray, x: number, y: number) => { const p = (y * W + x) * 4; a[p] = a[p + 1] = a[p + 2] = 20; };
  const block = (a: Uint8ClampedArray, x: number, y: number, bw: number, bh: number) => { for (let yy = y; yy < y + bh; yy++) for (let xx = x; xx < x + bw; xx++) dark(a, xx, yy); };
  const isInk = (a: Uint8ClampedArray, x: number, y: number) => a[(y * W + x) * 4] < 100;

  it("يمسح الحروف الصغيرة داخل المنطقة ويحفظ محوراً يعبرها كاملاً", () => {
    const a = base();
    block(a, 100, 5, 3, 110); // محور عمودي سُمكه 3 يمتد خارج منطقة المسح
    for (let k = 0; k < 8; k++) block(a, 20 + k * 9, 30, 6, 9); // "كلمة" من 8 حروف صغيرة
    const rect = { x: 10, y: 24, w: 160, h: 22 };
    const r = eraseKeepingStrokes(a, W, H, [rect]);
    expect(isInk(a, 22, 33)).toBe(false); // الحروف زالت
    expect(isInk(a, 70, 35)).toBe(false);
    expect(isInk(a, 101, 35)).toBe(true); // المحور داخل المنطقة محفوظ
    expect(isInk(a, 101, 10) && isInk(a, 101, 100)).toBe(true); // وخارجها لم يُمسّ
    expect(r.kept > 0 && r.erased > 0).toBe(true);
    // ولون التعبئة هو لون الورقة لا الأبيض
    const p = (28 * W + 40) * 4;
    expect(a[p]).toBe(238);
  });

  it("خط أفقي يعبر المنطقة محفوظ أيضاً", () => {
    const a = base();
    block(a, 5, 60, 190, 3);
    block(a, 40, 55, 6, 12); // حرف يعبر بجانبه بلا تماس: يسقط معها
    const rect = { x: 30, y: 50, w: 60, h: 20 };
    eraseKeepingStrokes(a, W, H, [rect]);
    expect(isInk(a, 60, 61)).toBe(true);
    expect(isInk(a, 150, 61)).toBe(true);
  });

  it("منطقة بلا حبر تُملأ بلون الورقة وتبقى سليمة", () => {
    const a = base();
    const r = eraseKeepingStrokes(a, W, H, [{ x: 20, y: 20, w: 30, h: 30 }]);
    expect(r.kept).toBe(0);
    expect(a[(30 * W + 30) * 4]).toBe(238);
  });

  it("لا مناطق = لا عمل، ومنطقة خارج الصورة لا ترمي", () => {
    const a = base();
    expect(eraseKeepingStrokes(a, W, H, [])).toEqual({ erased: 0, kept: 0 });
    const r = eraseKeepingStrokes(a, W, H, [{ x: -50, y: -50, w: 30, h: 30 }, { x: 190, y: 110, w: 100, h: 100 }]); // لو رمت لفشل الاختبار
    expect(r.kept).toBe(0);
  });
});

describe("splitStructure", () => {
  it("الخط الطويل هيكل، والحروف الصغيرة نص، والنقطة الضئيلة ضجيج", () => {
    const c = canvas(200, 120);
    c.hline(60, 10, 190, 3); // طويل
    for (let k = 0; k < 4; k++) c.rect(20 + k * 12, 20, 6, 9); // حروف
    c.rect(150, 100, 1, 2); // ضجيج 2 بكسل
    const m = inkMask(c.g, 200, 120);
    const { structure, text } = splitStructure(m, 200, 120, 18);
    expect(countInk(structure)).toBe(180 * 3);
    expect(countInk(text)).toBe(4 * 54);
  });
});

describe("compareFigures: يكشف منحنى مقلوباً مهما كثر المتطابق حوله", () => {
  const W2 = 300, H2 = 200;
  /** محوران + منحنى (قطع مكافئ بسُمك 3) صاعد أو مقلوب، + "أرقام" صغيرة على المحور */
  function fig(curve: "up" | "down" | "none", labels = true) {
    const c = canvas(W2, H2);
    c.hline(150, 20, 285, 3); c.vline(60, 10, 190, 3);
    for (let t = 1; t <= 5; t++) { c.vline(60 + t * 45, 146, 154, 2); if (labels) c.rect(60 + t * 45 - 3, 160, 6, 9); }
    if (curve !== "none") {
      for (let x = 20; x < 285; x += 1) {
        const u = (x - 120) / 100;
        const y = curve === "up" ? 140 - 60 + 60 * u * u * 0.9 : 30 + 60 * (1 - u * u * 0.9) + 40;
        c.rect(x, Math.round(y), 1, 3);
      }
    }
    return inkMask(c.g, W2, H2);
  }
  const tol = 6;

  it("نسخة مطابقة: هيكل وكتل ونص كلها سليمة", () => {
    const m = compareFigures(fig("up"), fig("up"), W2, H2, tol);
    expect(m.structure.f1).toBe(1);
    expect(m.badShare).toBe(0);
    expect(m.usedStructure).toBe(true);
    expect(m.text.checked === false || m.text.recall === 1).toBe(true);
  });

  it("منحنى مقلوب: يُكشف بالكتل المحلية (badShare عالية) حتى لو بقي f1 العام معقولاً", () => {
    const m = compareFigures(fig("up"), fig("down"), W2, H2, tol);
    expect(m.badShare > 0.12).toBe(true);
  });

  it("منحنى ناقص كلياً (محاور فقط): يُرفض حكماً (كتل المنحنى لا نظير لها)", () => {
    const m = compareFigures(fig("up"), fig("none"), W2, H2, tol);
    expect(m.structure.recall < 0.8).toBe(true);
    expect(m.badShare > 0.12).toBe(true);
    expect(judgeRedraw(m).ok).toBe(false);
  });

  it("منحنى مقلوب: الحكم النهائي رفض، لا مجرد رقم", () => {
    expect(judgeRedraw(compareFigures(fig("up"), fig("down"), W2, H2, tol)).ok).toBe(false);
    expect(judgeRedraw(compareFigures(fig("up"), fig("up"), W2, H2, tol)).ok).toBe(true);
  });

  it("انحراف طفيف ضمن التسامح لا يُعاقَب", () => {
    const a = fig("up");
    // نفس الشكل مُزاحاً 3 بكسل
    const b = new Uint8Array(W2 * H2);
    for (let y = 0; y < H2 - 3; y++) for (let x = 0; x < W2 - 3; x++) b[(y + 3) * W2 + (x + 3)] = a[y * W2 + x];
    const m = compareFigures(a, b, W2, H2, tol);
    expect(m.structure.f1 > 0.95).toBe(true);
    expect(m.badShare).toBe(0);
  });

  it("نص صغير مفقود يظهر في text.recall دون أن يمسّ الهيكل", () => {
    const m = compareFigures(fig("up", true), fig("up", false), W2, H2, tol);
    expect(m.structure.f1 > 0.98).toBe(true);
    expect(!m.text.checked || m.text.recall < 0.5).toBe(true);
  });

  it("بلا خطوط طويلة كافية يقيس الحبر كله بدل الهيكل", () => {
    const c = canvas(W2, H2);
    for (let k = 0; k < 10; k++) c.rect(20 + k * 25, 80, 6, 9);
    const m = compareFigures(inkMask(c.g, W2, H2), inkMask(c.g, W2, H2), W2, H2, tol);
    expect(m.usedStructure).toBe(false);
    expect(m.f1).toBe(1);
  });
});
