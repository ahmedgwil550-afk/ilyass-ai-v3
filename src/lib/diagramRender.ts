/**
 * تنفيذ Raster على canvas المتصفح (قصّ، مسح نصوص، تبييض، شبكة، تركيب).
 * كل ما فيه أعمال بكسلات مباشرة؛ المنطق والقرارات في diagramSolver.ts والرياضيات في diagramInk.ts.
 */
import { eraseKeepingStrokes, sharpen, whitenPaper } from "./diagramInk";
import type { Pixels, Raster, RasterImage } from "./diagramSolver";
import { cropRect, type Box } from "./recognition";

const MAX_CROP_SIDE = 2400;
const toDataUrl = (s: string) => (s.startsWith("data:") ? s : `data:image/jpeg;base64,${s}`);

const cache = new Map<string, Promise<HTMLImageElement>>();
function loadImage(src: string): Promise<HTMLImageElement> {
  const hit = cache.get(src);
  if (hit) return hit;
  const p = new Promise<HTMLImageElement>((resolve, reject) => {
    const el = new Image();
    el.onload = () => resolve(el);
    el.onerror = () => reject(new Error("image-load-failed"));
    el.src = src;
  });
  cache.set(src, p);
  if (cache.size > 8) cache.delete(cache.keys().next().value as string); // لا نحتفظ بصور كثيرة في الذاكرة
  p.catch(() => cache.delete(src));
  return p;
}

function makeCanvas(w: number, h: number): { c: HTMLCanvasElement; ctx: CanvasRenderingContext2D } {
  const c = document.createElement("canvas");
  c.width = Math.max(1, Math.round(w));
  c.height = Math.max(1, Math.round(h));
  const ctx = c.getContext("2d", { willReadFrequently: true });
  if (!ctx) throw new Error("no-canvas");
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = "high";
  return { c, ctx };
}

const svgUrl = (svg: string) => `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;

/** يصغّر (ولا يكبّر) بحيث يكون أطول ضلع ≤ maxSide */
function fitSize(w: number, h: number, maxSide: number): { w: number; h: number } {
  const k = Math.min(1, maxSide / Math.max(w, h));
  return { w: Math.max(1, Math.round(w * k)), h: Math.max(1, Math.round(h * k)) };
}

async function drawFitted(img: RasterImage, maxSide: number) {
  const el = await loadImage(img.dataUrl);
  const s = fitSize(img.w, img.h, maxSide);
  const { c, ctx } = makeCanvas(s.w, s.h);
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, s.w, s.h);
  ctx.drawImage(el, 0, 0, s.w, s.h);
  return { c, ctx, w: s.w, h: s.h };
}

/** شبكة إحداثيات حمراء على الشكل: النماذج ضعيفة في تقدير المواضع بالعين ودقيقة عند قراءتها من شبكة مرسومة */
function drawGrid(ctx: CanvasRenderingContext2D, W: number, H: number) {
  const fs = Math.max(11, Math.round(Math.min(W, H) * 0.028));
  ctx.font = `700 ${fs}px sans-serif`;
  ctx.textBaseline = "top";
  for (let i = 1; i < 10; i++) {
    const major = i % 2 === 0;
    const t = i / 10;
    ctx.strokeStyle = major ? "rgba(220,38,38,0.6)" : "rgba(220,38,38,0.28)";
    ctx.lineWidth = major ? 1.3 : 0.9;
    ctx.setLineDash(major ? [] : [4, 6]);
    ctx.beginPath(); ctx.moveTo(t * W, 0); ctx.lineTo(t * W, H); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(0, t * H); ctx.lineTo(W, t * H); ctx.stroke();
    if (major) {
      const label = t.toFixed(1);
      const tw = ctx.measureText(label).width + 4;
      ctx.setLineDash([]);
      for (const [x, y] of [[t * W - tw / 2, 1], [t * W - tw / 2, H - fs - 3], [1, t * H - fs / 2 - 1], [W - tw - 1, t * H - fs / 2 - 1]]) {
        ctx.fillStyle = "rgba(255,255,255,0.88)";
        ctx.fillRect(x, y, tw, fs + 2);
      }
      ctx.fillStyle = "#b91c1c";
      ctx.fillText(label, t * W - tw / 2 + 2, 2);
      ctx.fillText(label, t * W - tw / 2 + 2, H - fs - 2);
      ctx.fillText(label, 2, t * H - fs / 2);
      ctx.fillText(label, W - tw + 1, t * H - fs / 2);
    }
  }
  ctx.setLineDash([]);
}

async function pixelsOf(img: RasterImage, maxSide: number): Promise<Pixels> {
  const { ctx, w, h } = await drawFitted(img, maxSide);
  return { rgba: ctx.getImageData(0, 0, w, h).data, w, h };
}

export const canvasRaster: Raster = {
  async load(src) {
    const dataUrl = toDataUrl(src);
    const el = await loadImage(dataUrl);
    return { dataUrl, w: el.naturalWidth, h: el.naturalHeight };
  },

  async crop(img, box: Box) {
    const el = await loadImage(img.dataUrl);
    const { sx, sy, sw, sh } = cropRect(box, img.w, img.h, 0);
    if (sw < 40 || sh < 40) throw new Error("crop-too-small");
    const k = Math.min(1, MAX_CROP_SIDE / Math.max(sw, sh));
    const { c, ctx } = makeCanvas(sw * k, sh * k);
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, c.width, c.height);
    ctx.drawImage(el, sx, sy, sw, sh, 0, 0, c.width, c.height);
    return { dataUrl: c.toDataURL("image/jpeg", 0.95), w: c.width, h: c.height };
  },

  pixels: pixelsOf,

  async forModel(img, maxSide) {
    const { c } = await drawFitted(img, maxSide);
    return c.toDataURL("image/jpeg", 0.88);
  },

  async gridded(img, maxSide) {
    const { c, ctx, w, h } = await drawFitted(img, maxSide);
    drawGrid(ctx, w, h);
    return c.toDataURL("image/jpeg", 0.88);
  },

  async clean(img, erase) {
    const el = await loadImage(img.dataUrl);
    const { c, ctx } = makeCanvas(img.w, img.h);
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, img.w, img.h);
    ctx.drawImage(el, 0, 0, img.w, img.h);
    const data = ctx.getImageData(0, 0, c.width, c.height);
    const W = c.width, H = c.height;
    const pad = Math.max(2, Math.round(Math.max(W, H) * 0.004));
    // نوسّع المنطقة قليلاً: خط الكتابة يتجاوز صندوق النموذج بكسلات.
    // المسح يحفظ خطوط الشكل (محور/منحنى) التي تعبر المنطقة ولا يمسح إلا الحروف.
    eraseKeepingStrokes(
      data.data, W, H,
      erase.map((b) => ({ x: b.x * W - pad, y: b.y * H - pad, w: b.w * W + pad * 2, h: b.h * H + pad * 2 })),
    );
    whitenPaper(data.data, W, H);
    ctx.putImageData(data, 0, 0);
    return { dataUrl: c.toDataURL("image/jpeg", 0.95), w: W, h: H };
  },

  async svgPixels(svg, w, h) {
    const el = await loadImage(svgUrl(svg));
    const { ctx, c } = makeCanvas(w, h);
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, c.width, c.height);
    ctx.drawImage(el, 0, 0, c.width, c.height);
    return { rgba: ctx.getImageData(0, 0, c.width, c.height).data, w: c.width, h: c.height };
  },

  async composeRedraw(figureSvg, overlaySvg, w, h) {
    const [fig, over] = await Promise.all([loadImage(svgUrl(figureSvg)), loadImage(svgUrl(overlaySvg))]);
    const { c, ctx } = makeCanvas(w, h);
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, c.width, c.height);
    ctx.drawImage(fig, 0, 0, c.width, c.height);
    ctx.drawImage(over, 0, 0, c.width, c.height);
    return c.toDataURL("image/png");
  },

  async composeEmergency(clean, overlaySvg, w, h) {
    const [base, over] = await Promise.all([loadImage(clean.dataUrl), loadImage(svgUrl(overlaySvg))]);
    const { c, ctx } = makeCanvas(w, h);
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, c.width, c.height);
    ctx.drawImage(base, 0, 0, c.width, c.height);
    if (c.width > clean.w * 1.2) {
      // تكبير: نعيد الحدّة للخطوط قبل رسم الإضافات فوقها (الإضافات تُرسم نقية بلا شحذ)
      const d = ctx.getImageData(0, 0, c.width, c.height);
      sharpen(d.data, c.width, c.height, 0.7);
      ctx.putImageData(d, 0, 0);
    }
    ctx.drawImage(over, 0, 0, c.width, c.height);
    return c.toDataURL("image/png");
  },
};
