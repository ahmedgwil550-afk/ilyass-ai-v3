
type Spot = { text: string; x: number; y: number; w: number; h: number };
type Drawing = { kind: "line" | "polyline" | "arrow" | "point" | "circle"; points: { x: number; y: number }[]; label: string; dashed: boolean };
type EraseRegion = { x: number; y: number; w: number; h: number; reason: string };
const toDataUrl = (s: string) => (s.startsWith("data:") ? s : `data:image/jpeg;base64,${s}`);

/* ---------- LaTeX -> نص Unicode بسيط (الكتابة على canvas لا تدعم LaTeX) ---------- */
const SUP: Record<string, string> = { "0": "⁰", "1": "¹", "2": "²", "3": "³", "4": "⁴", "5": "⁵", "6": "⁶", "7": "⁷", "8": "⁸", "9": "⁹", "+": "⁺", "-": "⁻", "−": "⁻", "=": "⁼", "(": "⁽", ")": "⁾", n: "ⁿ" };
const SUB: Record<string, string> = { "0": "₀", "1": "₁", "2": "₂", "3": "₃", "4": "₄", "5": "₅", "6": "₆", "7": "₇", "8": "₈", "9": "₉", "+": "₊", "-": "₋", "−": "₋", "=": "₌", "(": "₍", ")": "₎" };
const GREEK: Record<string, string> = { alpha: "α", beta: "β", gamma: "γ", delta: "δ", Delta: "Δ", lambda: "λ", mu: "μ", nu: "ν", omega: "ω", Omega: "Ω", pi: "π", rho: "ρ", sigma: "σ", theta: "θ", tau: "τ", phi: "φ", varphi: "φ", epsilon: "ε", eta: "η" };
const SYM: Record<string, string> = { times: "×", cdot: "·", approx: "≈", neq: "≠", leq: "≤", geq: "≥", le: "≤", ge: "≥", rightarrow: "→", to: "→", Rightarrow: "⇒", rightleftharpoons: "⇌", pm: "±", infty: "∞", circ: "°", degree: "°" };

const mapAll = (s: string, m: Record<string, string>) => {
  const chars = [...s.trim()];
  return chars.length && chars.every(c => m[c]) ? chars.map(c => m[c]).join("") : null;
};

export function plain(input: string): string {
  let s = input.replace(/\*\*|`/g, "").replace(/\$+/g, "");
  // 1) أُسس وأدلّة أولاً (قبل فكّ \text{...} حتى لا تتداخل الأقواس)
  s = s.replace(/\^\{([^{}]*)\}|\^([0-9+\-−n])/g, (_m, a, b) => { const v = a ?? b; return mapAll(v, SUP) ?? `^(${v})`; });
  s = s.replace(/_\{([^{}]*)\}|_([0-9])/g, (_m, a, b) => { const v = a ?? b; return mapAll(v, SUB) ?? `_${v}`; });
  // 2) فكّ الأوامر النصّية
  s = s.replace(/\\(?:text|mathrm|mathbf|mathit|operatorname)\s*\{([^{}]*)\}/g, "$1");
  // 3) الكسور والجذور
  const wrapTerm = (x: string) => (/^[\w.,°]+$/.test(x.trim()) ? x.trim() : `(${x.trim()})`);
  for (let i = 0; i < 3; i++)
    s = s.replace(/\\d?frac\s*\{([^{}]*)\}\s*\{([^{}]*)\}/g, (_m, a, b) => `${wrapTerm(a)}/${wrapTerm(b)}`);
  s = s.replace(/\\sqrt\s*\{([^{}]*)\}/g, "√($1)");
  // 4) مسافات ورموز
  s = s.replace(/\\[,;:!]/g, " ").replace(/\\q?quad/g, "  ");
  s = s.replace(/\\([a-zA-Z]+)/g, (m, n) => GREEK[n] ?? SYM[n] ?? m);
  return s.replace(/[{}]/g, "").replace(/[ \t]+/g, " ").trim();
}

/* ---------- خط اليد ---------- */
// أضف في index.html:
// <link href="https://fonts.googleapis.com/css2?family=Caveat:wght@500;700&display=swap" rel="stylesheet">
const HAND = `"Kalam", "Caveat", "Segoe Print", "Bradley Hand", "Comic Sans MS", cursive`;
const ARABIC = `"Amiri", "Noto Naskh Arabic", "Segoe UI", Tahoma, sans-serif`;
let fontsReady: Promise<void> | null = null;
const loadFonts = () => {
  if (!fontsReady) {
    fontsReady = (async () => {
      try {
        await Promise.race([
          Promise.all([document.fonts.load('400 32px "Kalam"'), document.fonts.load('700 32px "Kalam"'), document.fonts.load('600 32px "Caveat"')]),
          new Promise(r => setTimeout(r, 2000)),
        ]);
      } catch { /* نستعمل الخط البديل */ }
    })();
  }
  return fontsReady;
};

/* ---------- لون خلفية الورقة حول المنطقة المراد مسحها ---------- */
function sampleBg(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, W: number, H: number): string {
  const r = 4; let R = 0, G = 0, B = 0, n = 0;
  const add = (sx: number, sy: number, sw: number, sh: number) => {
    sx = Math.max(0, Math.floor(sx)); sy = Math.max(0, Math.floor(sy));
    sw = Math.min(W - sx, Math.floor(sw)); sh = Math.min(H - sy, Math.floor(sh));
    if (sw <= 0 || sh <= 0) return;
    const d = ctx.getImageData(sx, sy, sw, sh).data;
    for (let i = 0; i < d.length; i += 4) {
      if (d[i] + d[i + 1] + d[i + 2] < 360) continue; // تجاهل الحبر
      R += d[i]; G += d[i + 1]; B += d[i + 2]; n++;
    }
  };
  try { add(x, y - r, w, r); add(x, y + h, w, r); add(x - r, y, r, h); add(x + w, y, r, h); } catch { return "#ffffff"; }
  return n ? `rgb(${Math.round(R / n)},${Math.round(G / n)},${Math.round(B / n)})` : "#ffffff";
}

function wrapLines(ctx: CanvasRenderingContext2D, text: string, maxW: number): string[] {
  const out: string[] = [];
  for (const para of text.split("\n")) {
    let cur = "";
    for (const word of para.split(/\s+/).filter(Boolean)) {
      const t = cur ? `${cur} ${word}` : word;
      if (!cur || ctx.measureText(t).width <= maxW) cur = t;
      else { out.push(cur); cur = word; }
    }
    if (cur) out.push(cur);
  }
  return out;
}

const loadImg = (src: string) =>
  new Promise<HTMLImageElement>((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = rej; i.src = src; });

/**
 * نسخة من الورقة عليها شبكة إحداثيات حمراء خفيفة (كل 0.1 مع خطوط وسطية كل 0.05).
 * النماذج ضعيفة في تقدير الإحداثيات "بالعين"، لكنها دقيقة جداً عندما تقرأها من شبكة مرسومة.
 * هذه النسخة تُرسل للذكاء الاصطناعي فقط؛ الرسم النهائي يتم على الورقة الأصلية النظيفة.
 */
async function withGrid(src: string): Promise<string> {
  const img = await loadImg(src);
  const k = Math.min(1, 1600 / Math.max(img.naturalWidth, img.naturalHeight));
  const W = Math.round(img.naturalWidth * k), H = Math.round(img.naturalHeight * k);
  const c = document.createElement("canvas");
  c.width = W; c.height = H;
  const ctx = c.getContext("2d")!;
  ctx.drawImage(img, 0, 0, W, H);
  const fs = Math.max(11, Math.round(Math.min(W, H) * 0.014));
  ctx.font = `700 ${fs}px sans-serif`;
  for (let i = 1; i < 20; i++) {
    const major = i % 2 === 0;
    const t = i / 20;
    ctx.strokeStyle = major ? "rgba(220,38,38,0.55)" : "rgba(220,38,38,0.22)";
    ctx.lineWidth = major ? 1.2 : 0.8;
    ctx.setLineDash(major ? [] : [4, 6]);
    ctx.beginPath(); ctx.moveTo(t * W, 0); ctx.lineTo(t * W, H); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(0, t * H); ctx.lineTo(W, t * H); ctx.stroke();
    if (major) {
      const label = t.toFixed(1);
      ctx.setLineDash([]);
      ctx.fillStyle = "rgba(255,255,255,0.85)";
      const tw = ctx.measureText(label).width + 4;
      for (const [x, y] of [[t * W - tw / 2, 1], [t * W - tw / 2, H - fs - 3], [1, t * H - fs / 2 - 1], [W - tw - 1, t * H - fs / 2 - 1]]) {
        ctx.fillRect(x, y, tw, fs + 2);
      }
      ctx.fillStyle = "#b91c1c";
      ctx.textBaseline = "top";
      ctx.fillText(label, t * W - tw / 2 + 2, 2);
      ctx.fillText(label, t * W - tw / 2 + 2, H - fs - 2);
      ctx.fillText(label, 2, t * H - fs / 2);
      ctx.fillText(label, W - tw + 1, t * H - fs / 2);
    }
  }
  ctx.setLineDash([]);
  return c.toDataURL("image/jpeg", 0.88);
}

// الذكاء الاصطناعي يحدد أماكن الإجابات ومناطق المسح؛ الرسم كله محلي على الورقة الأصلية.
export async function annotateSheet(image: string, answer: string): Promise<string> {
  const src = toDataUrl(image);
  const gridded = await withGrid(src);
  const [{ data, error }] = await Promise.all([
    fetch("/api/annotate-sheet", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ image: gridded, answer, grid: true }) }).then(async (r) => ({ data: await r.json().catch(() => null), error: null as Error | null })),
    loadFonts(),
  ]);
  if (error) throw error;
  if (data?.error) throw new Error(data.error);
  const spots: Spot[] = data?.answers ?? [];
  const erase: EraseRegion[] = data?.erase ?? [];
  const drawings: Drawing[] = data?.drawings ?? [];

  const img = await loadImg(src);

  // نكبّر الصور الصغيرة قليلاً ليبقى الخط واضحاً
  const k = Math.min(2, Math.max(1, 1600 / img.naturalWidth));
  const c = document.createElement("canvas");
  c.width = Math.round(img.naturalWidth * k); c.height = Math.round(img.naturalHeight * k);
  const ctx = c.getContext("2d", { willReadFrequently: true })!;
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(img, 0, 0, c.width, c.height);
  const W = c.width, H = c.height;

  const pad = 3 * k;
  const fills = erase.map(e => {
    const x = e.x * W - pad, y = e.y * H - pad, w = e.w * W + pad * 2, h = e.h * H + pad * 2;
    return { x, y, w, h, color: sampleBg(ctx, x, y, w, h, W, H) };
  });
  for (const f of fills) { ctx.fillStyle = f.color; ctx.fillRect(f.x, f.y, f.w, f.h); }

  // خط كبير ومقروء (مثل كتابة التلميذ على الكراس): الحد الأدنى نسبةٌ من عرض الصورة
  const MIN = Math.max(15 * k, W * 0.021);
  spots.forEach((s, idx) => {
    const text = plain(s.text);
    if (!text) return;
    const rtl = /[؀-ۿ]/.test(text);
    const x0 = Math.min(Math.max(0, s.x * W), W - 20);
    const y0 = Math.min(Math.max(0, s.y * H), H - 10);
    const boxW = Math.min(Math.max(s.w * W, 40 * k), W - x0);
    const boxH = Math.max(s.h * H, MIN * 1.4);
    const font = (px: number) => `${rtl ? 500 : 400} ${px}px ${rtl ? ARABIC : HAND}`;
    ctx.direction = rtl ? "rtl" : "ltr";

    // نبدأ بأكبر حجم مناسب ونصغّر حتى يدخل النص (بعدة أسطر) داخل المستطيل
    let size = Math.max(MIN, Math.min(boxH * 0.9, W * 0.032));
    let lines: string[] = [];
    for (; ; size -= 1) {
      ctx.font = font(size);
      lines = wrapLines(ctx, text, boxW);
      if (lines.length * size * 1.3 <= boxH * 1.15 || size <= MIN) break;
    }
    const lh = size * 1.3;

    ctx.save();
    ctx.translate(rtl ? x0 + boxW : x0, y0);
    ctx.rotate((((idx * 7) % 5) - 2) * 0.0035); // ميلان خفيف يشبه خط اليد
    ctx.font = font(size);
    ctx.fillStyle = "#1b1fa8";
    ctx.shadowColor = "rgba(27,31,168,0.3)";
    ctx.shadowBlur = 0.6 * k;
    ctx.textBaseline = "top";
    ctx.textAlign = rtl ? "right" : "left";
    lines.forEach((ln, i) => ctx.fillText(ln, 0, i * lh));
    ctx.restore();
  });
  drawDrawings(ctx, drawings, W, H, k);
  return c.toDataURL("image/png");
}

/* ---------- الرسم فوق الشكل/المنحنى (ماسّ، مستقيم، نقاط، إسقاطات…) بقلم أحمر مثل التصحيح ---------- */
export function drawDrawings(ctx: CanvasRenderingContext2D, drawings: Drawing[], W: number, H: number, k: number) {
  const ink = "#d11a2a";
  const lw = Math.max(2.2 * k, W * 0.0032);
  const px = (p: { x: number; y: number }) => ({ x: p.x * W, y: p.y * H });
  ctx.save();
  ctx.strokeStyle = ink; ctx.fillStyle = ink;
  ctx.lineWidth = lw; ctx.lineCap = "round"; ctx.lineJoin = "round";
  const fs = Math.max(15 * k, W * 0.024);
  const tag = (text: string, at: { x: number; y: number }, dx: number, dy: number) => {
    const t = plain(text);
    if (!t) return;
    ctx.save();
    ctx.setLineDash([]);
    ctx.font = `600 ${fs}px ${HAND}`;
    ctx.textBaseline = "alphabetic";
    ctx.textAlign = "left";
    const w = ctx.measureText(t).width;
    const x = Math.min(Math.max(2, at.x + dx), W - w - 2), y = Math.min(Math.max(fs, at.y + dy), H - 4);
    ctx.lineWidth = fs * 0.25; ctx.strokeStyle = "rgba(255,255,255,0.85)"; ctx.strokeText(t, x, y);
    ctx.fillStyle = ink; ctx.fillText(t, x, y);
    ctx.restore();
  };
  for (const d of drawings) {
    const pts = d.points.map(px);
    if (!pts.length) continue;
    ctx.setLineDash(d.dashed ? [lw * 3, lw * 2.2] : []);
    if (d.kind === "line" || d.kind === "arrow") {
      ctx.beginPath(); ctx.moveTo(pts[0].x, pts[0].y); ctx.lineTo(pts[1].x, pts[1].y); ctx.stroke();
      if (d.kind === "arrow") {
        ctx.setLineDash([]);
        const a = Math.atan2(pts[1].y - pts[0].y, pts[1].x - pts[0].x), hl = lw * 5;
        ctx.beginPath();
        ctx.moveTo(pts[1].x, pts[1].y);
        ctx.lineTo(pts[1].x - hl * Math.cos(a - 0.4), pts[1].y - hl * Math.sin(a - 0.4));
        ctx.moveTo(pts[1].x, pts[1].y);
        ctx.lineTo(pts[1].x - hl * Math.cos(a + 0.4), pts[1].y - hl * Math.sin(a + 0.4));
        ctx.stroke();
      }
    } else if (d.kind === "polyline") {
      ctx.beginPath(); ctx.moveTo(pts[0].x, pts[0].y);
      if (pts.length === 2) ctx.lineTo(pts[1].x, pts[1].y);
      else {
        for (let i = 1; i < pts.length - 1; i++) { // منحنى أملس عبر منتصفات القطع
          const mx = (pts[i].x + pts[i + 1].x) / 2, my = (pts[i].y + pts[i + 1].y) / 2;
          ctx.quadraticCurveTo(pts[i].x, pts[i].y, mx, my);
        }
        ctx.lineTo(pts[pts.length - 1].x, pts[pts.length - 1].y);
      }
      ctx.stroke();
    } else if (d.kind === "circle" && pts.length >= 2) {
      ctx.beginPath(); ctx.arc(pts[0].x, pts[0].y, Math.hypot(pts[1].x - pts[0].x, pts[1].y - pts[0].y), 0, Math.PI * 2); ctx.stroke();
    } else if (d.kind === "point") {
      ctx.setLineDash([]);
      const r = lw * 2.6;
      ctx.beginPath();
      ctx.moveTo(pts[0].x - r, pts[0].y - r); ctx.lineTo(pts[0].x + r, pts[0].y + r);
      ctx.moveTo(pts[0].x + r, pts[0].y - r); ctx.lineTo(pts[0].x - r, pts[0].y + r);
      ctx.stroke();
    }
    if (d.label) {
      const last = d.kind === "point" || d.kind === "circle" ? pts[0] : pts[pts.length - 1];
      tag(d.label, last, lw * 3, -lw * 3);
    }
  }
  ctx.restore();
}
