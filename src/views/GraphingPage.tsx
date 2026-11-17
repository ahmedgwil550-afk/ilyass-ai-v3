import { useState, useEffect, useRef, useCallback, useMemo } from "react";
import { Link } from "@tanstack/react-router";
import { ArrowLeft, ZoomIn, ZoomOut, RotateCcw, Grid, Move, Sparkles, Send, Loader2, Shapes, LineChart } from "lucide-react";
import { useLanguage } from "@/hooks/use-language";
import { streamChat, type Msg } from "@/lib/streamChat";
import MarkdownRenderer from "@/components/MarkdownRenderer";
import { toast } from "@/hooks/use-toast";

// ---------- Types ----------
type PlotPoint = { x: number; y: number; label?: string; color?: string };
type PlotFunction = { expr: string; color: string };

type GeoPoint = { name: string; x: number; y: number; color?: string };
type GeoSegment = [string, string];
type GeoPolygon = { vertices: string[]; label?: string; fill?: string; stroke?: string };
type GeoTransform =
  | { type: "rotation"; center: string; angle: number; point: string; result: string }
  | { type: "reflection"; axis: "x" | "y" | { p1: string; p2: string }; point: string; result: string }
  | { type: "translation"; vector: { x: number; y: number }; point: string; result: string }
  | { type: "homothety"; center: string; ratio: number; point: string; result: string };

type Geometry = {
  type: "geometry";
  points: GeoPoint[];
  segments?: GeoSegment[];
  polygons?: GeoPolygon[];
  transformations?: GeoTransform[];
};

// ---------- Geometry JSON extraction ----------
/**
 * Extracts a fenced ```geometry ... ``` or ```json ... ``` block describing geometry.
 * Returns the parsed Geometry and a cleaned text (with the block removed for display).
 */
function extractGeometryJSON(text: string): { geometry: Geometry | null; cleaned: string } {
  // Match ```geometry ... ```  OR  ```json ... ``` containing "type":"geometry"
  const fenceRegex = /```(?:geometry|json)\s*\n([\s\S]*?)```/gi;
  let m: RegExpExecArray | null;
  let geometry: Geometry | null = null;
  let cleaned = text;
  while ((m = fenceRegex.exec(text)) !== null) {
    const raw = m[1].trim();
    try {
      const parsed = JSON.parse(raw);
      if (parsed && parsed.type === "geometry" && Array.isArray(parsed.points)) {
        geometry = parsed as Geometry;
        cleaned = cleaned.replace(m[0], "").trim();
        break;
      }
    } catch {
      /* not our block, ignore */
    }
  }
  return { geometry, cleaned };
}

/** Apply transformations to enrich the points map. */
function applyTransformations(geo: Geometry): Map<string, GeoPoint> {
  const map = new Map<string, GeoPoint>();
  for (const p of geo.points) map.set(p.name, { ...p });
  if (!geo.transformations) return map;

  for (const t of geo.transformations) {
    const src = map.get(t.point);
    if (!src) continue;
    let nx = src.x;
    let ny = src.y;

    if (t.type === "rotation") {
      const c = map.get(t.center);
      if (!c) continue;
      const rad = (t.angle * Math.PI) / 180;
      const dx = src.x - c.x;
      const dy = src.y - c.y;
      nx = c.x + dx * Math.cos(rad) - dy * Math.sin(rad);
      ny = c.y + dx * Math.sin(rad) + dy * Math.cos(rad);
    } else if (t.type === "reflection") {
      if (t.axis === "x") { nx = src.x; ny = -src.y; }
      else if (t.axis === "y") { nx = -src.x; ny = src.y; }
      else {
        const a = map.get(t.axis.p1);
        const b = map.get(t.axis.p2);
        if (!a || !b) continue;
        // Reflect src across line AB
        const dx = b.x - a.x, dy = b.y - a.y;
        const denom = dx * dx + dy * dy;
        if (denom === 0) continue;
        const t0 = ((src.x - a.x) * dx + (src.y - a.y) * dy) / denom;
        const px = a.x + t0 * dx;
        const py = a.y + t0 * dy;
        nx = 2 * px - src.x;
        ny = 2 * py - src.y;
      }
    } else if (t.type === "translation") {
      nx = src.x + t.vector.x;
      ny = src.y + t.vector.y;
    } else if (t.type === "homothety") {
      const c = map.get(t.center);
      if (!c) continue;
      nx = c.x + t.ratio * (src.x - c.x);
      ny = c.y + t.ratio * (src.y - c.y);
    }

    // Round small float noise
    nx = Math.round(nx * 1e6) / 1e6;
    ny = Math.round(ny * 1e6) / 1e6;
    map.set(t.result, { name: t.result, x: nx, y: ny, color: "#10b981" });
  }
  return map;
}

// ---------- Function extraction (kept for graph mode) ----------
function extractFunctions(text: string): PlotFunction[] {
  const functions: PlotFunction[] = [];
  const colors = ["#a78bfa", "#10b981", "#f59e0b", "#ef4444", "#06b6d4"];
  const cleaned = text
    .replace(/\$\$([\s\S]*?)\$\$/g, " $1 ")
    .replace(/\$([^\$\n]+?)\$/g, " $1 ")
    .replace(/\\\(|\\\)|\\\[|\\\]/g, " ")
    .replace(/\\left|\\right/g, "")
    .replace(/\\cdot|\\times/g, "*")
    .replace(/\\frac\s*\{([^}]+)\}\s*\{([^}]+)\}/g, "($1)/($2)")
    .replace(/\\sqrt\s*\{([^}]+)\}/g, "sqrt($1)")
    .replace(/\\(sin|cos|tan|log|ln|exp|abs)/g, "$1")
    .replace(/\\pi/g, "pi")
    .replace(/\^\{([^}]+)\}/g, "^($1)")
    .replace(/\{([^{}]+)\}/g, "$1");

  const fnRegex = /(?:^|[\s,;])(?:y|[fghpq])\s*(?:\(\s*x\s*\))?\s*=\s*([^\n,;=]+?)(?=$|[\n;]|\.\s|,\s+(?:[A-Z]|y\s*=|[fghpq]\s*\())/gim;
  let m: RegExpExecArray | null;
  const seen = new Set<string>();
  while ((m = fnRegex.exec(cleaned)) !== null) {
    let expr = m[1].trim().replace(/\s+/g, "").replace(/[.,;:]+$/, "");
    if (!expr || expr.length > 80) continue;
    if (!/^[\d\sx+\-*/^().,piesqrtcoabnlgxe√π]+$/i.test(expr)) continue;
    if (!seen.has(expr)) {
      seen.add(expr);
      functions.push({ expr, color: colors[functions.length % colors.length] });
    }
    if (functions.length >= 4) break;
  }
  return functions;
}

// ---------- Expression compiler ----------
function compileExpr(expr: string): ((x: number) => number) | null {
  if (!expr.trim()) return null;
  try {
    let js = expr
      .replace(/√/g, "sqrt").replace(/π/g, "pi").replace(/\^/g, "**")
      .replace(/\bsin\b/g, "Math.sin").replace(/\bcos\b/g, "Math.cos").replace(/\btan\b/g, "Math.tan")
      .replace(/\bsqrt\b/g, "Math.sqrt").replace(/\babs\b/g, "Math.abs")
      .replace(/\blog\b/g, "Math.log10").replace(/\bln\b/g, "Math.log").replace(/\bexp\b/g, "Math.exp")
      .replace(/\bpi\b/gi, "Math.PI").replace(/\be(?![xpa-zA-Z])/g, "Math.E")
      .replace(/(\d)([x(])/g, "$1*$2").replace(/\)([x(\d])/g, ")*$1").replace(/x(\()/g, "x*$1");
    const fn = new Function("x", `"use strict"; return (${js})`);
    fn(1);
    return fn as (x: number) => number;
  } catch {
    return null;
  }
}

// ---------- AI directive (instructs the model to emit structured JSON when geometric) ----------
const GEOMETRY_DIRECTIVE = `
INSTRUCTION CRITIQUE POUR L'AFFICHAGE GRAPHIQUE :
Si l'exercice est une étude de fonction, donne ta solution normalement.
Si l'exercice est de la GÉOMÉTRIE (points, triangles, polygones, rotations, symétries, translations, vecteurs, homothéties), tu DOIS ajouter à la FIN de ta réponse un bloc structuré exactement dans ce format (sans le traduire, sans modifier les clés) :

\`\`\`geometry
{
  "type": "geometry",
  "points": [
    {"name": "A", "x": 0, "y": 0},
    {"name": "B", "x": 4, "y": 0},
    {"name": "C", "x": 0, "y": 3}
  ],
  "segments": [["A","B"],["B","C"],["C","A"]],
  "polygons": [{"vertices": ["A","B","C"], "label": "ABC"}],
  "transformations": [
    {"type": "rotation", "center": "A", "angle": 90, "point": "B", "result": "B'"}
  ]
}
\`\`\`

Règles strictes :
- Coordonnées numériques uniquement (pas de fractions textuelles, calcule la valeur décimale).
- "angle" en DEGRÉS (90, 180, -45, ...).
- Types de transformations supportés : "rotation" (center, angle, point, result), "reflection" (axis = "x" | "y" | {p1,p2}, point, result), "translation" (vector:{x,y}, point, result), "homothety" (center, ratio, point, result).
- N'inclus le bloc QUE pour les exercices géométriques. Pour une étude de fonction n'inclus rien de spécial.
`;

const GraphingPage = () => {
  const { lang } = useLanguage();
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const resultsRef = useRef<HTMLDivElement>(null);

  // AI state
  const [prompt, setPrompt] = useState("");
  const [aiAnswer, setAiAnswer] = useState("");
  const [displayAnswer, setDisplayAnswer] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const abortRef = useRef<AbortController | null>(null);

  // Mode
  const [mode, setMode] = useState<"function" | "geometry">("function");

  // Function plot state
  const [functions, setFunctions] = useState<PlotFunction[]>([{ expr: "x^2", color: "#a78bfa" }]);
  const [points, setPoints] = useState<PlotPoint[]>([]);

  // Geometry state
  const [geometry, setGeometry] = useState<Geometry | null>(null);

  // Viewport
  const [scale, setScale] = useState(40);
  const [offsetX, setOffsetX] = useState(0);
  const [offsetY, setOffsetY] = useState(0);
  const [showGrid, setShowGrid] = useState(true);
  const [isDragging, setIsDragging] = useState(false);
  const [dragStart, setDragStart] = useState({ x: 0, y: 0 });

  const compiled = useMemo(
    () => functions.map((f) => ({ ...f, fn: compileExpr(f.expr) })),
    [functions],
  );

  const geoPoints = useMemo(() => (geometry ? applyTransformations(geometry) : new Map<string, GeoPoint>()), [geometry]);

  // Auto-fit viewport when geometry loads
  const fitToGeometry = useCallback(() => {
    if (!geometry) return;
    const all = Array.from(geoPoints.values());
    if (all.length === 0) return;
    const xs = all.map((p) => p.x);
    const ys = all.map((p) => p.y);
    const minX = Math.min(...xs), maxX = Math.max(...xs);
    const minY = Math.min(...ys), maxY = Math.max(...ys);
    const spanX = Math.max(1, maxX - minX);
    const spanY = Math.max(1, maxY - minY);
    const canvas = canvasRef.current;
    if (!canvas) return;
    const padding = 80;
    const sx = (canvas.width - padding * 2) / spanX;
    const sy = (canvas.height - padding * 2) / spanY;
    const newScale = Math.max(20, Math.min(120, Math.min(sx, sy)));
    setScale(newScale);
    // Center on midpoint
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
    ctx.fillText("0", cx + 10, cy + 15);

    const toPx = (p: { x: number; y: number }) => ({ x: cx + p.x * scale, y: cy - p.y * scale });

    if (mode === "geometry" && geometry) {
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
      });

      // Segments
      ctx.strokeStyle = "#a78bfa";
      ctx.lineWidth = 2;
      (geometry.segments || []).forEach(([a, b]) => {
        const pa = geoPoints.get(a); const pb = geoPoints.get(b);
        if (!pa || !pb) return;
        const A = toPx(pa); const B = toPx(pb);
        ctx.beginPath(); ctx.moveTo(A.x, A.y); ctx.lineTo(B.x, B.y); ctx.stroke();
        // midpoint label of segment length
        const len = Math.hypot(pb.x - pa.x, pb.y - pa.y);
        ctx.fillStyle = "#9ca3af";
        ctx.font = "10px monospace";
        ctx.textAlign = "center";
        ctx.fillText(len.toFixed(2), (A.x + B.x) / 2, (A.y + B.y) / 2 - 6);
      });

      // Transformation arrows (point → result)
      (geometry.transformations || []).forEach((t) => {
        const a = geoPoints.get(t.point); const b = geoPoints.get(t.result);
        if (!a || !b) return;
        const A = toPx(a); const B = toPx(b);
        ctx.strokeStyle = "#10b981";
        ctx.setLineDash([5, 4]);
        ctx.lineWidth = 1.5;
        ctx.beginPath(); ctx.moveTo(A.x, A.y); ctx.lineTo(B.x, B.y); ctx.stroke();
        ctx.setLineDash([]);
        // arrowhead
        const ang = Math.atan2(B.y - A.y, B.x - A.x);
        const ah = 8;
        ctx.beginPath();
        ctx.moveTo(B.x, B.y);
        ctx.lineTo(B.x - ah * Math.cos(ang - 0.4), B.y - ah * Math.sin(ang - 0.4));
        ctx.lineTo(B.x - ah * Math.cos(ang + 0.4), B.y - ah * Math.sin(ang + 0.4));
        ctx.closePath();
        ctx.fillStyle = "#10b981";
        ctx.fill();
      });

      // Points
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
      return;
    }

    // ---- Function mode ----
    for (const f of compiled) {
      if (!f.fn) continue;
      ctx.strokeStyle = f.color;
      ctx.lineWidth = 2.5;
      ctx.beginPath();
      let started = false;
      for (let px = 0; px < width; px++) {
        const x = (px - cx) / scale;
        let y: number;
        try { y = f.fn(x); } catch { started = false; continue; }
        const py = cy - y * scale;
        if (!isFinite(y) || isNaN(y) || py < -2000 || py > height + 2000) { started = false; continue; }
        if (!started) { ctx.moveTo(px, py); started = true; }
        else { ctx.lineTo(px, py); }
      }
      ctx.stroke();
    }
    for (const p of points) {
      const px = cx + p.x * scale;
      const py = cy - p.y * scale;
      ctx.fillStyle = p.color || "#ef4444";
      ctx.beginPath(); ctx.arc(px, py, 5, 0, Math.PI * 2); ctx.fill();
      if (p.label) {
        ctx.fillStyle = "#fafafa";
        ctx.font = "bold 13px sans-serif";
        ctx.textAlign = "left";
        ctx.fillText(`${p.label}(${p.x}, ${p.y})`, px + 8, py - 8);
      }
    }
  }, [compiled, points, scale, offsetX, offsetY, showGrid, mode, geometry, geoPoints]);

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
  const zoomIn = () => setScale((s) => Math.min(160, s * 1.25));
  const zoomOut = () => setScale((s) => Math.max(8, s / 1.25));
  const reset = () => {
    if (mode === "geometry" && geometry) fitToGeometry();
    else { setScale(40); setOffsetX(0); setOffsetY(0); }
  };

  // ---------- AI submit ----------
  const handleAsk = useCallback(async () => {
    const q = prompt.trim();
    if (!q || isLoading) return;

    setIsLoading(true);
    setAiAnswer("");
    setDisplayAnswer("");
    abortRef.current = new AbortController();

    let acc = "";
    const messages: Msg[] = [
      { role: "user", content: `${q}\n\n${GEOMETRY_DIRECTIVE}` },
    ];

    await streamChat({
      messages,
      subject: "math",
      modelMode: "accurate",
      responseLength: "detailed",
      examMode: false,
      signal: abortRef.current.signal,
      onDelta: (chunk) => {
        acc += chunk;
        setAiAnswer(acc);
        // hide a partial geometry block while streaming
        const stripped = acc.replace(/```(?:geometry|json)\s*\n[\s\S]*?(?:```|$)/gi, "");
        setDisplayAnswer(stripped);
      },
      onDone: () => {
        setIsLoading(false);
        const { geometry: geo, cleaned } = extractGeometryJSON(acc);
        setDisplayAnswer(cleaned);
        if (geo) {
          setGeometry(geo);
          setMode("geometry");
          setPoints([]);
        } else {
          setGeometry(null);
          setMode("function");
          const fns = extractFunctions(acc);
          if (fns.length > 0) setFunctions(fns);
          setPoints([]);
        }
        setTimeout(() => resultsRef.current?.scrollIntoView({ behavior: "smooth", block: "start" }), 80);
      },
      onError: (msg) => {
        setIsLoading(false);
        toast({ title: lang === "ar" ? "خطأ" : "Erreur", description: msg, variant: "destructive" });
      },
    });
  }, [prompt, isLoading, lang]);

  const stopGeneration = () => {
    abortRef.current?.abort();
    setIsLoading(false);
  };

  const examples = lang === "ar"
    ? [
        "ادرس الدالة f(x) = x^2 - 4x + 3",
        "ABC مثلث متساوي الأضلاع، طول ضلعه 4، أنشئ B' صورة B بالدوران بزاوية 90° ومركز A",
        "ارسم المثلث ABC حيث A(0,0)، B(4,0)، C(0,3)",
      ]
    : [
        "Étudie la fonction f(x) = x^2 - 4x + 3",
        "Construis le triangle ABC avec A(0,0), B(4,0), C(0,3) puis B' image de B par la rotation de centre A et d'angle 90°",
        "Trace les fonctions sin(x) et cos(x)",
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
          <Sparkles className="h-4 w-4 text-primary" />
          {lang === "ar" ? "Graph AI ذكي" : "Graph AI"}
        </h1>
        <div className="w-16" />
      </div>

      <div className="flex-1 space-y-4 p-4">
        {/* Input card */}
        <div className="rounded-2xl border border-border bg-card/60 p-4 shadow-sm backdrop-blur-sm">
          <label className="mb-2 block text-xs font-medium text-muted-foreground">
            {lang === "ar" ? "اكتب تمرينك (دالة أو هندسة)" : "Décris ton exercice (fonction ou géométrie)"}
          </label>
          <div className="flex gap-2">
            <textarea
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); handleAsk(); }
              }}
              dir={lang === "ar" ? "rtl" : "ltr"}
              placeholder={lang === "ar" ? "مثال: مثلث ABC والدوران بزاوية 90°" : "Ex: Triangle ABC, rotation d'angle 90°"}
              rows={2}
              className="flex-1 resize-none rounded-xl border border-border bg-muted/30 px-3 py-2.5 text-sm text-foreground placeholder:text-muted-foreground/60 focus:outline-none focus:ring-2 focus:ring-primary"
            />
            <button
              onClick={isLoading ? stopGeneration : handleAsk}
              disabled={!isLoading && !prompt.trim()}
              className="shrink-0 self-stretch rounded-xl bg-gradient-to-br from-primary to-secondary px-4 text-primary-foreground shadow-lg transition-all hover:opacity-90 active:scale-95 disabled:cursor-not-allowed disabled:opacity-40"
            >
              {isLoading ? <Loader2 className="h-5 w-5 animate-spin" /> : <Send className="h-5 w-5" />}
            </button>
          </div>

          {!aiAnswer && !isLoading && (
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

        {/* Explanation card */}
        {(displayAnswer || isLoading) && (
          <div ref={resultsRef} className="rounded-2xl border border-border bg-card/60 p-4 shadow-sm backdrop-blur-sm">
            <div className="mb-2 flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-primary">
              <Sparkles className="h-3.5 w-3.5" />
              {lang === "ar" ? "الشرح والحل" : "Explication & Solution"}
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

        {/* Graph / Geometry card */}
        <div className="rounded-2xl border border-border bg-card/60 p-3 shadow-sm backdrop-blur-sm">
          <div className="mb-2 flex items-center justify-between gap-2 px-1">
            <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-primary">
              {mode === "geometry" ? <Shapes className="h-3.5 w-3.5" /> : <LineChart className="h-3.5 w-3.5" />}
              {mode === "geometry"
                ? (lang === "ar" ? "الرسم الهندسي" : "Géométrie")
                : (lang === "ar" ? "الرسم البياني" : "Graphique")}
            </div>
            {/* Mode toggle */}
            <div className="flex rounded-full border border-border bg-muted/30 p-0.5 text-xs">
              <button
                onClick={() => setMode("function")}
                className={`flex items-center gap-1 rounded-full px-2.5 py-1 transition-colors ${mode === "function" ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground"}`}
              >
                <LineChart className="h-3 w-3" /> {lang === "ar" ? "دالة" : "Fonction"}
              </button>
              <button
                onClick={() => geometry && setMode("geometry")}
                disabled={!geometry}
                className={`flex items-center gap-1 rounded-full px-2.5 py-1 transition-colors disabled:opacity-40 ${mode === "geometry" ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground"}`}
              >
                <Shapes className="h-3 w-3" /> {lang === "ar" ? "هندسة" : "Géométrie"}
              </button>
            </div>
          </div>

          {/* Legend */}
          <div className="mb-2 flex flex-wrap gap-1.5 px-1">
            {mode === "function" && functions.map((f, i) => (
              <span key={i} className="inline-flex items-center gap-1 rounded-full bg-muted/40 px-2 py-0.5 text-xs font-mono">
                <span className="h-2 w-2 rounded-full" style={{ background: f.color }} />
                {f.expr}
              </span>
            ))}
            {mode === "geometry" && geometry && (
              <>
                {Array.from(geoPoints.values()).map((p) => (
                  <span key={p.name} className="inline-flex items-center gap-1 rounded-full bg-muted/40 px-2 py-0.5 text-xs font-mono">
                    <span className="h-2 w-2 rounded-full" style={{ background: p.color || "#ef4444" }} />
                    {p.name}({p.x}, {p.y})
                  </span>
                ))}
              </>
            )}
          </div>

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
              <button onClick={() => setShowGrid((s) => !s)} className={`rounded-lg border border-border p-2 shadow-lg transition-colors ${showGrid ? "bg-primary text-primary-foreground" : "bg-card/90 text-foreground hover:bg-muted/80"}`}>
                <Grid className="h-4 w-4" />
              </button>
            </div>

            <div className="absolute bottom-3 left-3 flex items-center gap-1.5 rounded-lg border border-border bg-card/80 px-2.5 py-1 text-xs text-muted-foreground shadow-lg">
              <Move className="h-3 w-3" />
              {lang === "ar" ? "اسحب للتحريك" : "Glisser"}
            </div>
          </div>

          {/* Manual function override (function mode only) */}
          {mode === "function" && (
            <div className="mt-3 flex gap-2">
              <input
                type="text"
                value={functions[0]?.expr || ""}
                onChange={(e) => setFunctions((prev) => {
                  const next = [...prev];
                  if (next[0]) next[0] = { ...next[0], expr: e.target.value };
                  else next.push({ expr: e.target.value, color: "#a78bfa" });
                  return next;
                })}
                placeholder="f(x) = x^2"
                className="flex-1 rounded-lg border border-border bg-muted/40 px-3 py-2 text-sm font-mono text-foreground placeholder:text-muted-foreground/50 focus:outline-none focus:ring-2 focus:ring-primary"
              />
            </div>
          )}

          {/* Geometry transformations summary */}
          {mode === "geometry" && geometry?.transformations && geometry.transformations.length > 0 && (
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

export default GraphingPage;
