// Shared geometry types & helpers for AI-powered geometry rendering.

export type GeoPoint = { name: string; x: number; y: number; color?: string };
export type GeoSegment = [string, string];
export type GeoPolygon = { vertices: string[]; label?: string; fill?: string; stroke?: string };
export type GeoCircle = { center: string; radius: number; label?: string; stroke?: string };
export type GeoTransform =
  | { type: "rotation"; center: string; angle: number; point: string; result: string }
  | { type: "reflection"; axis: "x" | "y" | { p1: string; p2: string }; point: string; result: string }
  | { type: "translation"; vector: { x: number; y: number }; point: string; result: string }
  | { type: "homothety"; center: string; ratio: number; point: string; result: string };

export type GeoAngle = { at: string; from: string; to: string; label?: string; right?: boolean };
export type GeoVector = { from: string; to: string; label?: string; color?: string };
export type GeoTick = { segment: GeoSegment; count?: 1 | 2 | 3 };
export type GeoParallel = { segment: GeoSegment; group?: number };

export type Geometry = {
  type: "geometry";
  restated?: string;
  points: GeoPoint[];
  segments?: GeoSegment[];
  polygons?: GeoPolygon[];
  circles?: GeoCircle[];
  angles?: GeoAngle[];
  vectors?: GeoVector[];
  ticks?: GeoTick[];
  parallels?: GeoParallel[];
  transformations?: GeoTransform[];
};

/** Parse a fenced ```geometry / ```json block from AI text. */
export function extractGeometryJSON(text: string): { geometry: Geometry | null; cleaned: string } {
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
    } catch { /* try next */ }
  }
  // Fallback: unterminated fenced block (stream not finished or model forgot ```)
  if (!geometry) {
    const open = text.lastIndexOf("```geometry");
    const altOpen = open === -1 ? text.lastIndexOf("```json") : open;
    if (altOpen !== -1) {
      const after = text.slice(altOpen).replace(/^```(?:geometry|json)\s*\n?/, "");
      const closed = after.indexOf("```");
      const body = closed === -1 ? after : after.slice(0, closed);
      // Try to recover by trimming to last balanced "}"
      const lastBrace = body.lastIndexOf("}");
      if (lastBrace !== -1) {
        const candidate = body.slice(0, lastBrace + 1);
        try {
          const parsed = JSON.parse(candidate);
          if (parsed && parsed.type === "geometry" && Array.isArray(parsed.points)) {
            geometry = parsed as Geometry;
            cleaned = text.slice(0, altOpen).trim();
          }
        } catch { /* still partial */ }
      }
    }
  }
  return { geometry, cleaned };
}

/** Compute every point including transformed ones. */
export function applyTransformations(geo: Geometry): Map<string, GeoPoint> {
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

    nx = Math.round(nx * 1e6) / 1e6;
    ny = Math.round(ny * 1e6) / 1e6;
    map.set(t.result, { name: t.result, x: nx, y: ny, color: "#10b981" });
  }
  return map;
}

export function computeBounds(points: GeoPoint[]) {
  if (points.length === 0) return { minX: -5, maxX: 5, minY: -5, maxY: 5 };
  const xs = points.map((p) => p.x);
  const ys = points.map((p) => p.y);
  return {
    minX: Math.min(...xs),
    maxX: Math.max(...xs),
    minY: Math.min(...ys),
    maxY: Math.max(...ys),
  };
}

/** AI directive instructing the model to emit a geometry JSON block. */
export const GEOMETRY_AI_DIRECTIVE = `
INSTRUCTION CRITIQUE — GÉOMÉTRIE :
Tu es un assistant spécialisé en GÉOMÉTRIE (triangles, quadrilatères, cercles, points, vecteurs, transformations).
1) Résous l'exercice étape par étape, clairement, en utilisant LaTeX ($...$ et $$...$$) pour les longueurs, angles, vecteurs.
2) À la FIN de ta réponse, ajoute OBLIGATOIREMENT un bloc structuré pour permettre l'affichage de la figure :

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
  "circles": [{"center": "A", "radius": 2, "label": "C(A,2)"}],
  "transformations": [
    {"type": "rotation", "center": "A", "angle": 90, "point": "B", "result": "B'"}
  ]
}
\`\`\`

Règles strictes :
- Coordonnées NUMÉRIQUES uniquement (calcule la valeur décimale arrondie au centième si nécessaire).
- "angle" en DEGRÉS (90, 180, -45, ...).
- Types supportés : "rotation" (center, angle, point, result), "reflection" (axis = "x" | "y" | {p1,p2}, point, result), "translation" (vector:{x,y}, point, result), "homothety" (center, ratio, point, result).
- Si l'énoncé ne donne pas de coordonnées, CHOISIS-EN de raisonnables qui respectent les contraintes (ex: triangle équilatéral de côté 4 → A(0,0), B(4,0), C(2, 3.46)).
- Les segments/polygons/circles sont optionnels mais recommandés pour rendre la figure lisible.
- N'omets JAMAIS le bloc geometry.
`;
