import { useState, useEffect, useRef, useCallback, useMemo } from "react";
import { Link } from "@tanstack/react-router";
import { ArrowLeft, ZoomIn, ZoomOut, RotateCcw, Grid, Move, Sparkles, Send, Loader2, Shapes, ImagePlus, X, BookOpen, Eye } from "lucide-react";
import { useLanguage } from "@/hooks/use-language";
import { streamGeometry, type GeoMsg } from "@/lib/streamGeometry";
import MarkdownRenderer from "@/components/MarkdownRenderer";
import { toast } from "@/hooks/use-toast";
import {
  type GeoPoint,
  type Geometry,
  extractGeometryJSON,
  applyTransformations,
  computeBounds,
} from "@/lib/geometry";

const GeometryPage = () => {
  const { lang } = useLanguage();
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const resultsRef = useRef<HTMLDivElement>(null);

  const [prompt, setPrompt] = useState("");
  const [aiAnswer, setAiAnswer] = useState("");
  const [displayAnswer, setDisplayAnswer] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const abortRef = useRef<AbortController | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Image upload (for OCR-like extraction of points/coordinates)
  const [imagePreviews, setImagePreviews] = useState<string[]>([]);
  const [imageBase64s, setImageBase64s] = useState<string[]>([]);

  const [geometry, setGeometry] = useState<Geometry | null>(null);

  const [scale, setScale] = useState(50);
  const [offsetX, setOffsetX] = useState(0);
  const [offsetY, setOffsetY] = useState(0);
  const [showGrid, setShowGrid] = useState(true);
  const [isDragging, setIsDragging] = useState(false);
  const [dragStart, setDragStart] = useState({ x: 0, y: 0 });

  const geoPoints = useMemo(
    () => (geometry ? applyTransformations(geometry) : new Map<string, GeoPoint>()),
    [geometry],
  );

  const fitToGeometry = useCallback(() => {
    if (!geometry) return;
    const all = Array.from(geoPoints.values());
    if (all.length === 0) return;
    const { minX, maxX, minY, maxY } = computeBounds(all);
    const spanX = Math.max(1, maxX - minX);
    const spanY = Math.max(1, maxY - minY);
    const canvas = canvasRef.current;
    if (!canvas) return;
    const padding = 80;
    const sx = (canvas.width - padding * 2) / spanX;
    const sy = (canvas.height - padding * 2) / spanY;
    const newScale = Math.max(20, Math.min(140, Math.min(sx, sy)));
    setScale(newScale);
    const midX = (minX + maxX) / 2;
    const midY = (minY + maxY) / 2;
    setOffsetX(-midX * newScale);
    setOffsetY(midY * newScale);
  }, [geometry, geoPoints]);

  useEffect(() => {
    if (geometry) fitToGeometry();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [geometry]);

  // ---------- Drawing ----------
  const draw = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const width = canvas.width;
    const height = canvas.height;
    const cx = width / 2 + offsetX;
    const cy = height / 2 + offsetY;

    ctx.fillStyle = "#0a0a0f";
    ctx.fillRect(0, 0, width, height);

    if (showGrid) {
      ctx.strokeStyle = "#1a1a2e";
      ctx.lineWidth = 1;
      for (let x = cx % scale; x < width; x += scale) {
        ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, height); ctx.stroke();
      }
      for (let y = cy % scale; y < height; y += scale) {
        ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(width, y); ctx.stroke();
      }
    }

    // Axes
    ctx.strokeStyle = "#4a4a6a";
    ctx.lineWidth = 2;
    ctx.beginPath(); ctx.moveTo(0, cy); ctx.lineTo(width, cy); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(cx, 0); ctx.lineTo(cx, height); ctx.stroke();

    ctx.fillStyle = "#6a6a8a";
    ctx.font = "11px monospace";
    ctx.textAlign = "center";
    const step = scale >= 30 ? 1 : scale >= 15 ? 2 : 5;
    for (let i = -Math.ceil(cx / scale); i <= Math.ceil((width - cx) / scale); i += step) {
      if (i === 0) continue;
      ctx.fillText(i.toString(), cx + i * scale, cy + 15);
    }
    for (let i = -Math.ceil((height - cy) / scale); i <= Math.ceil(cy / scale); i += step) {
      if (i === 0) continue;
      ctx.fillText(i.toString(), cx + 15, cy - i * scale + 4);
    }

    if (!geometry) {
      // Empty placeholder
      ctx.fillStyle = "#6b7280";
      ctx.font = "13px sans-serif";
      ctx.textAlign = "center";
      ctx.fillText(
        lang === "ar" ? "اطرح سؤالاً هندسياً لرؤية الشكل" : "Pose un exercice de géométrie pour voir la figure",
        width / 2,
        height / 2,
      );
      return;
    }

    const toPx = (p: { x: number; y: number }) => ({ x: cx + p.x * scale, y: cy - p.y * scale });

    // Circles
    (geometry.circles || []).forEach((circ) => {
      const c = geoPoints.get(circ.center);
      if (!c) return;
      const C = toPx(c);
      ctx.strokeStyle = circ.stroke || "#06b6d4";
      ctx.lineWidth = 2;
      ctx.setLineDash([]);
      ctx.beginPath();
      ctx.arc(C.x, C.y, circ.radius * scale, 0, Math.PI * 2);
      ctx.stroke();
      if (circ.label) {
        ctx.fillStyle = "#06b6d4";
        ctx.font = "11px sans-serif";
        ctx.textAlign = "left";
        ctx.fillText(circ.label, C.x + circ.radius * scale + 4, C.y);
      }
    });

    // Polygons (filled)
    const polyColors = ["rgba(167,139,250,0.18)", "rgba(16,185,129,0.18)", "rgba(245,158,11,0.18)"];
    const polyStrokes = ["#a78bfa", "#10b981", "#f59e0b"];
    (geometry.polygons || []).forEach((poly, i) => {
      const verts = poly.vertices.map((v) => geoPoints.get(v)).filter(Boolean) as GeoPoint[];
      if (verts.length < 3) return;
      ctx.beginPath();
      verts.forEach((v, idx) => {
        const { x, y } = toPx(v);
        if (idx === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
      });
      ctx.closePath();
      ctx.fillStyle = poly.fill || polyColors[i % polyColors.length];
      ctx.fill();
      ctx.strokeStyle = poly.stroke || polyStrokes[i % polyStrokes.length];
      ctx.lineWidth = 2.5;
      ctx.stroke();
      if (poly.label) {
        const mx = verts.reduce((s, v) => s + v.x, 0) / verts.length;
        const my = verts.reduce((s, v) => s + v.y, 0) / verts.length;
        const M = toPx({ x: mx, y: my });
        ctx.fillStyle = poly.stroke || polyStrokes[i % polyStrokes.length];
        ctx.font = "bold 12px sans-serif";
        ctx.textAlign = "center";
        ctx.fillText(poly.label, M.x, M.y);
      }
    });

    // Segments with length labels
    ctx.strokeStyle = "#a78bfa";
    ctx.lineWidth = 2;
    (geometry.segments || []).forEach(([a, b]) => {
      const pa = geoPoints.get(a); const pb = geoPoints.get(b);
      if (!pa || !pb) return;
      const A = toPx(pa); const B = toPx(pb);
      ctx.beginPath(); ctx.moveTo(A.x, A.y); ctx.lineTo(B.x, B.y); ctx.stroke();
      const len = Math.hypot(pb.x - pa.x, pb.y - pa.y);
      ctx.fillStyle = "#9ca3af";
      ctx.font = "10px monospace";
      ctx.textAlign = "center";
      ctx.fillText(len.toFixed(2), (A.x + B.x) / 2, (A.y + B.y) / 2 - 6);
    });

    // Transformation arrows
    (geometry.transformations || []).forEach((t) => {
      const a = geoPoints.get(t.point); const b = geoPoints.get(t.result);
      if (!a || !b) return;
      const A = toPx(a); const B = toPx(b);
      ctx.strokeStyle = "#10b981";
      ctx.setLineDash([5, 4]);
      ctx.lineWidth = 1.5;
      ctx.beginPath(); ctx.moveTo(A.x, A.y); ctx.lineTo(B.x, B.y); ctx.stroke();
      ctx.setLineDash([]);
      const ang = Math.atan2(B.y - A.y, B.x - A.x);
      const ah = 8;
      ctx.beginPath();
      ctx.moveTo(B.x, B.y);
      ctx.lineTo(B.x - ah * Math.cos(ang - 0.4), B.y - ah * Math.sin(ang - 0.4));
      ctx.lineTo(B.x - ah * Math.cos(ang + 0.4), B.y - ah * Math.sin(ang + 0.4));
      ctx.closePath();
      ctx.fillStyle = "#10b981";
      ctx.fill();
      // small type label at midpoint
      ctx.fillStyle = "#10b981";
      ctx.font = "italic 10px sans-serif";
      ctx.textAlign = "center";
      ctx.fillText(t.type, (A.x + B.x) / 2, (A.y + B.y) / 2 + 12);
    });

    // Tick marks for equal-length segments
    (geometry.ticks || []).forEach((tk) => {
      const pa = geoPoints.get(tk.segment[0]);
      const pb = geoPoints.get(tk.segment[1]);
      if (!pa || !pb) return;
      const A = toPx(pa), B = toPx(pb);
      const mx = (A.x + B.x) / 2, my = (A.y + B.y) / 2;
      const ang = Math.atan2(B.y - A.y, B.x - A.x);
      const perp = ang + Math.PI / 2;
      const count = tk.count || 1;
      const spacing = 5;
      ctx.strokeStyle = "#fafafa";
      ctx.lineWidth = 2;
      for (let i = 0; i < count; i++) {
        const off = (i - (count - 1) / 2) * spacing;
        const cx2 = mx + Math.cos(ang) * off;
        const cy2 = my + Math.sin(ang) * off;
        ctx.beginPath();
        ctx.moveTo(cx2 + Math.cos(perp) * 5, cy2 + Math.sin(perp) * 5);
        ctx.lineTo(cx2 - Math.cos(perp) * 5, cy2 - Math.sin(perp) * 5);
        ctx.stroke();
      }
    });

    // Parallel chevron marks
    (geometry.parallels || []).forEach((pl) => {
      const pa = geoPoints.get(pl.segment[0]);
      const pb = geoPoints.get(pl.segment[1]);
      if (!pa || !pb) return;
      const A = toPx(pa), B = toPx(pb);
      const mx = (A.x + B.x) / 2, my = (A.y + B.y) / 2;
      const ang = Math.atan2(B.y - A.y, B.x - A.x);
      const count = pl.group || 1;
      ctx.strokeStyle = "#fbbf24";
      ctx.lineWidth = 2;
      for (let i = 0; i < count; i++) {
        const off = (i - (count - 1) / 2) * 6;
        const bx = mx + Math.cos(ang) * off;
        const by = my + Math.sin(ang) * off;
        ctx.beginPath();
        ctx.moveTo(bx - Math.cos(ang - 0.6) * 6, by - Math.sin(ang - 0.6) * 6);
        ctx.lineTo(bx, by);
        ctx.lineTo(bx - Math.cos(ang + 0.6) * 6, by - Math.sin(ang + 0.6) * 6);
        ctx.stroke();
      }
    });

    // Angle marks (right-angle squares + arcs with labels)
    (geometry.angles || []).forEach((a) => {
      const at = geoPoints.get(a.at);
      const from = geoPoints.get(a.from);
      const to = geoPoints.get(a.to);
      if (!at || !from || !to) return;
      const O = toPx(at), F = toPx(from), T = toPx(to);
      const a1 = Math.atan2(F.y - O.y, F.x - O.x);
      const a2 = Math.atan2(T.y - O.y, T.x - O.x);
      if (a.right) {
        const s = 14;
        const ux = Math.cos(a1) * s, uy = Math.sin(a1) * s;
        const vx = Math.cos(a2) * s, vy = Math.sin(a2) * s;
        ctx.strokeStyle = "#f59e0b";
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.moveTo(O.x + ux, O.y + uy);
        ctx.lineTo(O.x + ux + vx, O.y + uy + vy);
        ctx.lineTo(O.x + vx, O.y + vy);
        ctx.stroke();
      } else {
        const r = 22;
        let start = a1, end = a2;
        let diff = end - start;
        while (diff <= -Math.PI) diff += 2 * Math.PI;
        while (diff > Math.PI) diff -= 2 * Math.PI;
        const ccw = diff < 0;
        ctx.strokeStyle = "#f59e0b";
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.arc(O.x, O.y, r, start, end, ccw);
        ctx.stroke();
        if (a.label) {
          const mid = start + diff / 2;
          ctx.fillStyle = "#f59e0b";
          ctx.font = "bold 11px sans-serif";
          ctx.textAlign = "center";
          ctx.fillText(a.label, O.x + Math.cos(mid) * (r + 12), O.y + Math.sin(mid) * (r + 12) + 3);
        }
      }
    });

    // Vectors (solid arrows)
    (geometry.vectors || []).forEach((v) => {
      const pa = geoPoints.get(v.from), pb = geoPoints.get(v.to);
      if (!pa || !pb) return;
      const A = toPx(pa), B = toPx(pb);
      const color = v.color || "#3b82f6";
      ctx.strokeStyle = color;
      ctx.lineWidth = 2.5;
      ctx.setLineDash([]);
      ctx.beginPath(); ctx.moveTo(A.x, A.y); ctx.lineTo(B.x, B.y); ctx.stroke();
      const ang = Math.atan2(B.y - A.y, B.x - A.x);
      ctx.fillStyle = color;
      ctx.beginPath();
      ctx.moveTo(B.x, B.y);
      ctx.lineTo(B.x - 10 * Math.cos(ang - 0.4), B.y - 10 * Math.sin(ang - 0.4));
      ctx.lineTo(B.x - 10 * Math.cos(ang + 0.4), B.y - 10 * Math.sin(ang + 0.4));
      ctx.closePath(); ctx.fill();
      if (v.label) {
        ctx.font = "italic 11px serif";
        ctx.textAlign = "center";
        ctx.fillStyle = color;
        ctx.fillText(v.label.replace(/\\\\?vec\{(.+?)\}/g, "$1→"), (A.x + B.x) / 2, (A.y + B.y) / 2 - 8);
      }
    });
    geoPoints.forEach((p) => {
      const P = toPx(p);
      ctx.fillStyle = p.color || "#ef4444";
      ctx.beginPath(); ctx.arc(P.x, P.y, 5, 0, Math.PI * 2); ctx.fill();
      ctx.strokeStyle = "#0a0a0f";
      ctx.lineWidth = 2;
      ctx.stroke();
      ctx.fillStyle = "#fafafa";
      ctx.font = "bold 13px sans-serif";
      ctx.textAlign = "left";
      ctx.fillText(`${p.name}(${p.x}, ${p.y})`, P.x + 8, P.y - 8);
    });
  }, [scale, offsetX, offsetY, showGrid, geometry, geoPoints, lang]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const resize = () => {
      const c = canvas.parentElement;
      if (!c) return;
      canvas.width = c.clientWidth;
      canvas.height = c.clientHeight;
      draw();
    };
    resize();
    window.addEventListener("resize", resize);
    return () => window.removeEventListener("resize", resize);
  }, [draw]);

  useEffect(() => { draw(); }, [draw]);

  // ---------- Pan / Zoom ----------
  const onDown = (cx: number, cy: number) => { setIsDragging(true); setDragStart({ x: cx - offsetX, y: cy - offsetY }); };
  const onMove = (cx: number, cy: number) => { if (!isDragging) return; setOffsetX(cx - dragStart.x); setOffsetY(cy - dragStart.y); };
  const onUp = () => setIsDragging(false);
  const zoomIn = () => setScale((s) => Math.min(200, s * 1.25));
  const zoomOut = () => setScale((s) => Math.max(8, s / 1.25));
  const reset = () => {
    if (geometry) fitToGeometry();
    else { setScale(50); setOffsetX(0); setOffsetY(0); }
  };

  // ---------- Image upload ----------
  const compressImage = (file: File, maxWidth = 1400, quality = 0.8): Promise<string> =>
    new Promise((resolve) => {
      const img = new Image();
      img.onload = () => {
        const canvas = document.createElement("canvas");
        const ratio = Math.min(maxWidth / img.width, 1);
        canvas.width = img.width * ratio;
        canvas.height = img.height * ratio;
        const ctx = canvas.getContext("2d")!;
        ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
        URL.revokeObjectURL(img.src);
        resolve(canvas.toDataURL("image/jpeg", quality));
      };
      img.src = URL.createObjectURL(file);
    });

  const handleImageUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files || files.length === 0) return;
    const newPreviews: string[] = [];
    const newBase64s: string[] = [];
    for (const file of Array.from(files)) {
      if (file.size > 10 * 1024 * 1024) {
        toast({
          title: lang === "ar" ? "خطأ" : "Erreur",
          description: lang === "ar" ? "حجم الصورة كبير جداً (حد أقصى 10MB)" : "Image trop volumineuse (max 10MB)",
          variant: "destructive",
        });
        continue;
      }
      const compressed = await compressImage(file);
      newPreviews.push(compressed);
      newBase64s.push(compressed.split(",")[1]);
    }
    setImagePreviews((prev) => [...prev, ...newPreviews]);
    setImageBase64s((prev) => [...prev, ...newBase64s]);
    if (e.target) e.target.value = "";
  };

  const removeImage = (idx: number) => {
    setImagePreviews((prev) => prev.filter((_, i) => i !== idx));
    setImageBase64s((prev) => prev.filter((_, i) => i !== idx));
  };

  // ---------- AI submit ----------
  const handleAsk = useCallback(async () => {
    const q = prompt.trim();
    const hasImages = imageBase64s.length > 0;
    if ((!q && !hasImages) || isLoading) return;

    setIsLoading(true);
    setAiAnswer("");
    setDisplayAnswer("");
    abortRef.current = new AbortController();

    const userText = q || (lang === "ar"
      ? "اقرأ تمرين الهندسة من الصورة بدقة، استخرج كل النقاط والإحداثيات والأشكال والتحويلات المذكورة، ثم حلّه."
      : "Lis attentivement l'exercice de géométrie sur l'image, extrais tous les points, coordonnées, figures et transformations, puis résous-le.");

    let acc = "";
    const messages: GeoMsg[] = [
      hasImages
        ? { role: "user", content: userText, imageBase64s }
        : { role: "user", content: userText },
    ];

    await streamGeometry({
      messages,
      modelMode: "accurate",
      signal: abortRef.current.signal,
      onDelta: (chunk) => {
        acc += chunk;
        setAiAnswer(acc);
        const stripped = acc.replace(/```(?:geometry|json)\s*\n[\s\S]*?(?:```|$)/gi, "");
        setDisplayAnswer(stripped);
      },
      onDone: () => {
        setIsLoading(false);
        const { geometry: geo, cleaned } = extractGeometryJSON(acc);
        setDisplayAnswer(cleaned);
        if (geo) {
          setGeometry(geo);
        } else {
          toast({
            title: lang === "ar" ? "لم يتم الكشف عن شكل" : "Aucune figure détectée",
            description: lang === "ar"
              ? "أعد صياغة السؤال أو أرفق صورة أوضح"
              : "Reformule l'énoncé ou joins une image plus claire",
          });
        }
        setTimeout(() => resultsRef.current?.scrollIntoView({ behavior: "smooth", block: "start" }), 80);
      },
      onError: (msg) => {
        setIsLoading(false);
        toast({ title: lang === "ar" ? "خطأ" : "Erreur", description: msg, variant: "destructive" });
      },
    });
  }, [prompt, imageBase64s, isLoading, lang]);

  const stopGeneration = () => {
    abortRef.current?.abort();
    setIsLoading(false);
  };

  const examples = lang === "ar"
    ? [
        "ABC مثلث متساوي الأضلاع طول ضلعه 4. أنشئ B' صورة B بالدوران بزاوية 90° ومركز A",
        "ارسم المثلث ABC حيث A(0,0)، B(4,0)، C(0,3) ثم أوجد مماثل C بالنسبة للمحور (AB)",
        "ABCD مربع طول ضلعه 3 ومركزه O. أنشئ صورة A بالتحاكي مركزه O ونسبته 2",
        "ادرس المثلث ABC حيث A(-2,0)، B(2,0)، C(0,3): هل هو متساوي الساقين؟",
      ]
    : [
        "ABC est un triangle équilatéral de côté 4. Construis B' image de B par la rotation de centre A et d'angle 90°",
        "Trace le triangle ABC avec A(0,0), B(4,0), C(0,3) puis le symétrique de C par rapport à (AB)",
        "ABCD est un carré de côté 3 et de centre O. Construis l'image de A par l'homothétie de centre O et de rapport 2",
        "Étudie le triangle ABC avec A(-2,0), B(2,0), C(0,3) : est-il isocèle ?",
      ];

  return (
    <div className="flex min-h-screen flex-col bg-background">
      {/* Header */}
      <div className="sticky top-0 z-10 flex items-center justify-between border-b border-border bg-background/80 px-4 py-3 backdrop-blur-md">
        <Link to="/" className="flex items-center gap-2 text-sm text-muted-foreground transition-colors hover:text-foreground">
          <ArrowLeft className="h-4 w-4" />
          {lang === "ar" ? "الرجوع" : "Retour"}
        </Link>
        <h1 className="flex items-center gap-1.5 text-sm font-bold">
          <Shapes className="h-4 w-4 text-primary" />
          {lang === "ar" ? "Geometry AI ذكي" : "Geometry AI"}
        </h1>
        <div className="w-16" />
      </div>

      <div className="flex-1 space-y-4 p-4">
        {/* Input card */}
        <div className="rounded-2xl border border-border bg-card/60 p-4 shadow-sm backdrop-blur-sm">
          <label className="mb-2 block text-xs font-medium text-muted-foreground">
            {lang === "ar"
              ? "اكتب تمرين الهندسة (مثلث، دائرة، تحويل…)"
              : "Décris ton exercice de géométrie (triangle, cercle, transformation…)"}
          </label>
          <div className="flex gap-2">
            <textarea
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); handleAsk(); }
              }}
              dir={lang === "ar" ? "rtl" : "ltr"}
              placeholder={lang === "ar" ? "اكتب أو ارفق صورة التمرين…" : "Écris ou joins une photo de l'exercice…"}
              rows={2}
              className="flex-1 resize-none rounded-xl border border-border bg-muted/30 px-3 py-2.5 text-sm text-foreground placeholder:text-muted-foreground/60 focus:outline-none focus:ring-2 focus:ring-primary"
            />
            <div className="flex shrink-0 flex-col gap-2">
              <button
                onClick={() => fileInputRef.current?.click()}
                disabled={isLoading}
                title={lang === "ar" ? "إرفاق صورة" : "Joindre une image"}
                className="rounded-xl border border-border bg-muted/40 px-3 py-2 text-foreground transition-colors hover:border-primary/50 hover:bg-muted/70 disabled:opacity-40"
              >
                <ImagePlus className="h-5 w-5" />
              </button>
              <button
                onClick={isLoading ? stopGeneration : handleAsk}
                disabled={!isLoading && !prompt.trim() && imageBase64s.length === 0}
                className="rounded-xl bg-gradient-to-br from-primary to-secondary px-3 py-2 text-primary-foreground shadow-lg transition-all hover:opacity-90 active:scale-95 disabled:cursor-not-allowed disabled:opacity-40"
              >
                {isLoading ? <Loader2 className="h-5 w-5 animate-spin" /> : <Send className="h-5 w-5" />}
              </button>
            </div>
            <input
              ref={fileInputRef}
              type="file"
              accept="image/*"
              multiple
              onChange={handleImageUpload}
              className="hidden"
            />
          </div>

          {imagePreviews.length > 0 && (
            <div className="mt-3 flex flex-wrap gap-2">
              {imagePreviews.map((src, idx) => (
                <div key={idx} className="relative h-20 w-20 overflow-hidden rounded-lg border border-border">
                  <img src={src} alt={`upload-${idx}`} className="h-full w-full object-cover" />
                  <button
                    onClick={() => removeImage(idx)}
                    className="absolute right-0.5 top-0.5 rounded-full bg-black/60 p-0.5 text-white hover:bg-black/80"
                    aria-label="remove"
                  >
                    <X className="h-3 w-3" />
                  </button>
                </div>
              ))}
              <p className="w-full text-xs text-muted-foreground">
                {lang === "ar"
                  ? "سيتم استخراج النقاط والإحداثيات من الصورة تلقائياً."
                  : "Les points et coordonnées seront extraits automatiquement de l'image."}
              </p>
            </div>
          )}

          {!aiAnswer && !isLoading && imagePreviews.length === 0 && (
            <div className="mt-3 flex flex-wrap gap-1.5">
              {examples.map((ex) => (
                <button
                  key={ex}
                  onClick={() => setPrompt(ex)}
                  className="rounded-full border border-border bg-muted/30 px-3 py-1 text-xs text-muted-foreground transition-colors hover:border-primary/50 hover:text-foreground"
                >
                  {ex}
                </button>
              ))}
            </div>
          )}
        </div>

        {/* Restated problem ("compris" — GPAI-style transparency) */}
        {geometry?.restated && (
          <div className="rounded-2xl border border-amber-500/30 bg-amber-500/5 p-3 text-sm shadow-sm backdrop-blur-sm">
            <div className="mb-1 flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-amber-400">
              <Eye className="h-3.5 w-3.5" />
              {lang === "ar" ? "الفهم" : "Énoncé compris"}
            </div>
            <p className="leading-relaxed text-foreground/90">{geometry.restated}</p>
          </div>
        )}

        {/* Solution card */}
        {(displayAnswer || isLoading) && (
          <div ref={resultsRef} className="rounded-2xl border border-border bg-card/60 p-4 shadow-sm backdrop-blur-sm">
            <div className="mb-2 flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-primary">
              <Sparkles className="h-3.5 w-3.5" />
              {lang === "ar" ? "الحل خطوة بخطوة" : "Solution pas à pas"}
            </div>
            <div className="min-h-[60px] text-sm leading-relaxed">
              {displayAnswer ? (
                <MarkdownRenderer content={displayAnswer} />
              ) : (
                <div className="flex items-center gap-2 text-muted-foreground">
                  <Loader2 className="h-4 w-4 animate-spin" />
                  {lang === "ar" ? "جاري التحليل..." : "Analyse en cours..."}
                </div>
              )}
              {isLoading && displayAnswer && (
                <span className="ml-1 inline-block h-4 w-1.5 animate-pulse bg-primary align-middle" />
              )}
            </div>
          </div>
        )}

        {/* Figure card */}
        <div className="rounded-2xl border border-border bg-card/60 p-3 shadow-sm backdrop-blur-sm">
          <div className="mb-2 flex items-center justify-between gap-2 px-1">
            <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-primary">
              <Shapes className="h-3.5 w-3.5" />
              {lang === "ar" ? "الشكل الهندسي" : "Figure géométrique"}
            </div>
          </div>

          {/* Legend */}
          {geometry && (
            <div className="mb-2 flex flex-wrap gap-1.5 px-1">
              {Array.from(geoPoints.values()).map((p) => (
                <span
                  key={p.name}
                  className="inline-flex items-center gap-1 rounded-full bg-muted/40 px-2 py-0.5 text-xs font-mono"
                >
                  <span className="h-2 w-2 rounded-full" style={{ background: p.color || "#ef4444" }} />
                  {p.name}({p.x}, {p.y})
                </span>
              ))}
            </div>
          )}

          <div className="relative h-[360px] overflow-hidden rounded-xl border border-border" style={{ touchAction: "none" }}>
            <canvas
              ref={canvasRef}
              onMouseDown={(e) => onDown(e.clientX, e.clientY)}
              onMouseMove={(e) => onMove(e.clientX, e.clientY)}
              onMouseUp={onUp}
              onMouseLeave={onUp}
              onTouchStart={(e) => { const t = e.touches[0]; onDown(t.clientX, t.clientY); }}
              onTouchMove={(e) => { const t = e.touches[0]; onMove(t.clientX, t.clientY); }}
              onTouchEnd={onUp}
              className="h-full w-full cursor-grab active:cursor-grabbing"
            />

            <div className="absolute bottom-3 right-3 flex flex-col gap-1.5">
              <button onClick={zoomIn} className="rounded-lg border border-border bg-card/90 p-2 text-foreground shadow-lg transition-colors hover:bg-muted/80">
                <ZoomIn className="h-4 w-4" />
              </button>
              <button onClick={zoomOut} className="rounded-lg border border-border bg-card/90 p-2 text-foreground shadow-lg transition-colors hover:bg-muted/80">
                <ZoomOut className="h-4 w-4" />
              </button>
              <button onClick={reset} className="rounded-lg border border-border bg-card/90 p-2 text-foreground shadow-lg transition-colors hover:bg-muted/80">
                <RotateCcw className="h-4 w-4" />
              </button>
              <button
                onClick={() => setShowGrid((s) => !s)}
                className={`rounded-lg border border-border p-2 shadow-lg transition-colors ${showGrid ? "bg-primary text-primary-foreground" : "bg-card/90 text-foreground hover:bg-muted/80"}`}
              >
                <Grid className="h-4 w-4" />
              </button>
            </div>

            <div className="absolute bottom-3 left-3 flex items-center gap-1.5 rounded-lg border border-border bg-card/80 px-2.5 py-1 text-xs text-muted-foreground shadow-lg">
              <Move className="h-3 w-3" />
              {lang === "ar" ? "اسحب للتحريك" : "Glisser"}
            </div>
          </div>

          {/* Transformations summary */}
          {geometry?.transformations && geometry.transformations.length > 0 && (
            <div className="mt-3 space-y-1 rounded-lg border border-border bg-muted/20 p-2.5 text-xs">
              <div className="mb-1 font-semibold text-muted-foreground">
                {lang === "ar" ? "التحويلات" : "Transformations"}
              </div>
              {geometry.transformations.map((t, i) => (
                <div key={i} className="flex items-center gap-2 font-mono text-foreground/80">
                  <span className="rounded bg-emerald-500/15 px-1.5 py-0.5 text-emerald-400">{t.type}</span>
                  <span>
                    {t.point} → {t.result}
                    {t.type === "rotation" && ` (centre: ${t.center}, ${t.angle}°)`}
                    {t.type === "translation" && ` (v: (${t.vector.x}, ${t.vector.y}))`}
                    {t.type === "homothety" && ` (centre: ${t.center}, k=${t.ratio})`}
                    {t.type === "reflection" && ` (axe: ${typeof t.axis === "string" ? t.axis : `(${t.axis.p1}${t.axis.p2})`})`}
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default GeometryPage;
