import {
  isUsablePageQuadrilateral,
  orderQuadrilateral,
  polygonArea,
  type Point2D,
  type Quadrilateral,
} from "./perspectiveGeometry";
import type { PageBoundaryCandidate, PageBoundaryDetection } from "./opencvPageDetection";

/**
 * Dependency-free page detector used while OpenCV is still loading and whenever
 * OpenCV fails. It looks for the largest bright region (a sheet on a darker
 * surface), takes its convex hull, reduces the hull to four corners and keeps
 * the result only if the region really fills the quadrilateral and the sheet
 * edge shows real brightness contrast. It is intentionally simple and fast
 * enough to run on every live-camera frame.
 */

const ANALYSIS_SIDE = 256;
const MIN_AREA_RATIO = 0.08;
const MAX_AREA_RATIO = 0.985;
const MIN_RECTANGULARITY = 0.72;
const MIN_CONTRAST_SUPPORT = 0.45;
const MIN_EDGE_CONTRAST = 10;
const CONTRAST_OFFSET = 3;
const MAX_CANDIDATES = 3;
/** Corners of a sheet, even in perspective, stay within these angles. */
const MIN_CORNER_ANGLE = 55;
const MAX_CORNER_ANGLE = 125;
/** Hull vertices closer than this (share of the frame diagonal) to a straight side are merged into it. */
const HULL_SIMPLIFY_TOLERANCE = 0.012;
/** Hull sides shorter than this share of the diagonal are too short to define a sheet edge. */
const MIN_SIDE_LENGTH = 0.03;
const MAX_SIDES = 12;
const MIN_LADDER_STEP = 2;
/** A fold is searched for between these shares of the frame's width. */
const SPINE_MIN_POSITION = 0.2;
const SPINE_MAX_POSITION = 0.8;
const SPINE_ROWS = 48;
const SPINE_GAP = 2;
const SPINE_SIDE = 5;
/** How much darker than the paper beside it a fold line must be, as a share of the paper's brightness. */
const SPINE_PRESENT_DEPTH = 0.03;
const MIN_SPINE_STRENGTH = 0.03;
/** Pixels darker than this share of the sheet's brightness are not paper (for the fold search). */
const PAPER_LEVEL_SHARE = 0.45;
const MIN_SPINE_PRESENCE = 0.7;
/** The fold must be this many times stronger than the typical line (squared paper has many faint ones). */
const MIN_SPINE_CONTRAST = 2.5;
/** Two portrait pages side by side are at least this wide compared to their height. */
const MIN_SPREAD_ASPECT = 0.9;

/** Paper is nearly colourless: above PALE it is penalised, above MAX it is rejected (share of full colour). */
const PALE_SATURATION = 0.18;
const MAX_SHEET_SATURATION = 0.3;
/** Frames scoring below this are noise, not a sheet worth outlining. */
const MIN_SCORE = 0.4;
/** Cut-offs between the frame split and the sheet's brightness, as fractions of the latter. */
const LADDER_FRACTIONS = [0.6, 0.68, 0.76, 0.82, 0.86, 0.89, 0.915, 0.94, 0.955, 0.97];

interface GrayImage {
  width: number;
  height: number;
  data: Uint8Array;
  /** Colourfulness per pixel, 0 (grey or white) to 255 (a pure colour). */
  saturation: Uint8Array;
}

interface Component {
  area: number;
  boundary: Point2D[];
}

const clamp = (value: number, min: number, max: number) =>
  Math.max(min, Math.min(max, value));

function distance(a: Point2D, b: Point2D): number {
  return Math.hypot(b.x - a.x, b.y - a.y);
}

/** Area-averaged grayscale downscale so thin ruled lines blend into the page. */
function toGrayscale(image: ImageData, maxSide: number): GrayImage {
  const scale = Math.min(1, maxSide / Math.max(image.width, image.height));
  const width = Math.max(1, Math.round(image.width * scale));
  const height = Math.max(1, Math.round(image.height * scale));
  const sums = new Float32Array(width * height);
  const chromaSums = new Float32Array(width * height);
  const valueSums = new Float32Array(width * height);
  const counts = new Uint16Array(width * height);
  const { data } = image;

  for (let y = 0; y < image.height; y++) {
    const row = Math.min(height - 1, Math.floor((y * height) / image.height));
    for (let x = 0; x < image.width; x++) {
      const column = Math.min(width - 1, Math.floor((x * width) / image.width));
      const source = (y * image.width + x) * 4;
      const target = row * width + column;
      const red = data[source];
      const green = data[source + 1];
      const blue = data[source + 2];
      const high = Math.max(red, green, blue);
      sums[target] += 0.299 * red + 0.587 * green + 0.114 * blue;
      chromaSums[target] += high - Math.min(red, green, blue);
      valueSums[target] += high;
      counts[target]++;
    }
  }

  const gray = new Uint8Array(width * height);
  const saturation = new Uint8Array(width * height);
  for (let i = 0; i < gray.length; i++) {
    gray[i] = counts[i] ? Math.round(sums[i] / counts[i]) : 0;
    saturation[i] = valueSums[i] > 0 ? Math.round((255 * chromaSums[i]) / valueSums[i]) : 0;
  }
  return { width, height, data: gray, saturation };
}

function blur3(image: GrayImage): Uint8Array {
  const { width, height, data } = image;
  const out = new Uint8Array(data.length);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      let sum = 0;
      let count = 0;
      for (let dy = -1; dy <= 1; dy++) {
        const yy = y + dy;
        if (yy < 0 || yy >= height) continue;
        for (let dx = -1; dx <= 1; dx++) {
          const xx = x + dx;
          if (xx < 0 || xx >= width) continue;
          sum += data[yy * width + xx];
          count++;
        }
      }
      out[y * width + x] = Math.round(sum / count);
    }
  }
  return out;
}

function otsuThreshold(data: Uint8Array): number {
  const histogram = new Uint32Array(256);
  let sum = 0;
  for (let i = 0; i < data.length; i++) {
    histogram[data[i]]++;
    sum += data[i];
  }

  let backgroundWeight = 0;
  let backgroundSum = 0;
  let bestVariance = -1;
  let threshold = 127;
  for (let level = 0; level < 256; level++) {
    backgroundWeight += histogram[level];
    if (backgroundWeight === 0) continue;
    const foregroundWeight = data.length - backgroundWeight;
    if (foregroundWeight === 0) break;

    backgroundSum += level * histogram[level];
    const backgroundMean = backgroundSum / backgroundWeight;
    const foregroundMean = (sum - backgroundSum) / foregroundWeight;
    const variance =
      backgroundWeight * foregroundWeight * (backgroundMean - foregroundMean) ** 2;
    if (variance > bestVariance) {
      bestVariance = variance;
      threshold = level;
    }
  }
  return threshold;
}

/** 4-connected regions of set pixels, largest first, each with its boundary pixels. */
function findComponents(
  mask: Uint8Array,
  width: number,
  height: number,
  minArea: number,
): Component[] {
  const visited = new Uint8Array(width * height);
  const queue = new Int32Array(width * height);
  const components: Component[] = [];

  for (let start = 0; start < mask.length; start++) {
    if (!mask[start] || visited[start]) continue;

    let head = 0;
    let tail = 0;
    queue[tail++] = start;
    visited[start] = 1;

    while (head < tail) {
      const index = queue[head++];
      const x = index % width;
      const y = (index - x) / width;
      if (x > 0 && mask[index - 1] && !visited[index - 1]) {
        visited[index - 1] = 1;
        queue[tail++] = index - 1;
      }
      if (x < width - 1 && mask[index + 1] && !visited[index + 1]) {
        visited[index + 1] = 1;
        queue[tail++] = index + 1;
      }
      if (y > 0 && mask[index - width] && !visited[index - width]) {
        visited[index - width] = 1;
        queue[tail++] = index - width;
      }
      if (y < height - 1 && mask[index + width] && !visited[index + width]) {
        visited[index + width] = 1;
        queue[tail++] = index + width;
      }
    }

    const area = tail;
    if (area < minArea) continue;

    const boundary: Point2D[] = [];
    for (let i = 0; i < tail; i++) {
      const index = queue[i];
      const x = index % width;
      const y = (index - x) / width;
      const onBorder = x === 0 || y === 0 || x === width - 1 || y === height - 1;
      if (
        onBorder ||
        !mask[index - 1] || !mask[index + 1] ||
        !mask[index - width] || !mask[index + width]
      ) {
        boundary.push({ x, y });
      }
    }
    components.push({ area, boundary });
  }

  return components.sort((a, b) => b.area - a.area);
}

function convexHull(points: Point2D[]): Point2D[] {
  if (points.length < 3) return [...points];
  const sorted = [...points].sort((a, b) => a.x - b.x || a.y - b.y);
  const cross = (o: Point2D, a: Point2D, b: Point2D) =>
    (a.x - o.x) * (b.y - o.y) - (a.y - o.y) * (b.x - o.x);

  const lower: Point2D[] = [];
  for (const point of sorted) {
    while (lower.length >= 2 && cross(lower[lower.length - 2], lower[lower.length - 1], point) <= 0) {
      lower.pop();
    }
    lower.push(point);
  }
  const upper: Point2D[] = [];
  for (let i = sorted.length - 1; i >= 0; i--) {
    const point = sorted[i];
    while (upper.length >= 2 && cross(upper[upper.length - 2], upper[upper.length - 1], point) <= 0) {
      upper.pop();
    }
    upper.push(point);
  }
  lower.pop();
  upper.pop();
  return lower.concat(upper);
}

/** Where line a->b meets line c->d, or null when they are (nearly) parallel. */
function lineIntersection(a: Point2D, b: Point2D, c: Point2D, d: Point2D): Point2D | null {
  const r = { x: b.x - a.x, y: b.y - a.y };
  const s = { x: d.x - c.x, y: d.y - c.y };
  const denominator = r.x * s.y - r.y * s.x;
  if (Math.abs(denominator) < 1e-9) return null;
  const t = ((c.x - a.x) * s.y - (c.y - a.y) * s.x) / denominator;
  return { x: a.x + r.x * t, y: a.y + r.y * t };
}

function distanceToLine(point: Point2D, a: Point2D, b: Point2D): number {
  const length = distance(a, b);
  if (length < 1e-9) return distance(point, a);
  return Math.abs((b.x - a.x) * (a.y - point.y) - (a.x - point.x) * (b.y - a.y)) / length;
}

/** Drops hull vertices that sit within `tolerance` of the line through their neighbours. */
function simplifyHull(hull: Point2D[], tolerance: number): Point2D[] {
  const points = [...hull];
  while (points.length > 3) {
    let flattest = -1;
    let flattestDistance = tolerance;
    for (let i = 0; i < points.length; i++) {
      const offset = distanceToLine(
        points[i],
        points[(i - 1 + points.length) % points.length],
        points[(i + 1) % points.length],
      );
      if (offset < flattestDistance) {
        flattestDistance = offset;
        flattest = i;
      }
    }
    if (flattest < 0) break;
    points.splice(flattest, 1);
  }
  return points;
}

/** Interior angle at `corner`, in degrees. */
function cornerAngle(before: Point2D, corner: Point2D, after: Point2D): number {
  const ax = before.x - corner.x;
  const ay = before.y - corner.y;
  const bx = after.x - corner.x;
  const by = after.y - corner.y;
  const length = Math.hypot(ax, ay) * Math.hypot(bx, by);
  if (length < 1e-9) return 0;
  return (Math.acos(clamp((ax * bx + ay * by) / length, -1, 1)) * 180) / Math.PI;
}

function looksLikeSheetCorners(corners: readonly Point2D[]): boolean {
  return corners.every((corner, index) => {
    const angle = cornerAngle(corners[(index + 3) % 4], corner, corners[(index + 1) % 4]);
    return angle >= MIN_CORNER_ANGLE && angle <= MAX_CORNER_ANGLE;
  });
}

/**
 * Finds the four corners of the sheet that contains a region. The region's
 * convex hull is reduced to its straight sides, and every way of picking four of
 * them is tried: each pick is the quadrilateral those four side lines enclose.
 * Picks that do not contain the whole hull, or whose corners are not close to
 * right angles (a sheet seen in perspective keeps roughly 55 to 125 degrees),
 * are discarded and the smallest remaining one wins. That is what lets a sheet
 * that is partly in shadow keep its true corner: cutting the shadow off with a
 * diagonal side is cheaper, but a diagonal gives a corner no sheet has.
 */
function enclosingQuadrilateral(
  hull: Point2D[],
  bounds: { width: number; height: number },
): Point2D[] | null {
  const diagonal = Math.hypot(bounds.width, bounds.height);
  const polygon = simplifyHull(hull, diagonal * HULL_SIMPLIFY_TOLERANCE);
  if (polygon.length < 4) return null;
  if (polygon.length === 4) return looksLikeSheetCorners(polygon) ? polygon : null;

  const count = polygon.length;
  let sides = polygon
    .map((start, index) => ({ index, length: distance(start, polygon[(index + 1) % count]) }))
    .filter((side) => side.length >= diagonal * MIN_SIDE_LENGTH);
  if (sides.length < 4) {
    if (count > MAX_SIDES) return null;
    sides = polygon.map((start, index) => ({ index, length: distance(start, polygon[(index + 1) % count]) }));
  }
  // The longest sides carry the most evidence; cap the work on very ragged regions.
  if (sides.length > MAX_SIDES) {
    sides = sides.sort((a, b) => b.length - a.length).slice(0, MAX_SIDES).sort((a, b) => a.index - b.index);
  }

  const start = (side: { index: number }) => polygon[side.index];
  const end = (side: { index: number }) => polygon[(side.index + 1) % count];
  const containmentSlack = diagonal * HULL_SIMPLIFY_TOLERANCE * 1.5;
  const limitX = bounds.width * 0.5;
  const limitY = bounds.height * 0.5;

  let best: Point2D[] | null = null;
  let bestArea = Infinity;

  for (let a = 0; a < sides.length - 3; a++) {
    for (let b = a + 1; b < sides.length - 2; b++) {
      const first = lineIntersection(start(sides[a]), end(sides[a]), start(sides[b]), end(sides[b]));
      if (!first) continue;
      for (let c = b + 1; c < sides.length - 1; c++) {
        const second = lineIntersection(start(sides[b]), end(sides[b]), start(sides[c]), end(sides[c]));
        if (!second) continue;
        for (let d = c + 1; d < sides.length; d++) {
          const third = lineIntersection(start(sides[c]), end(sides[c]), start(sides[d]), end(sides[d]));
          const fourth = lineIntersection(start(sides[d]), end(sides[d]), start(sides[a]), end(sides[a]));
          if (!third || !fourth) continue;

          const corners = [first, second, third, fourth];
          if (corners.some((corner) =>
            corner.x < -limitX || corner.y < -limitY ||
            corner.x > bounds.width + limitX || corner.y > bounds.height + limitY
          )) continue;

          const area = polygonArea(corners);
          if (area >= bestArea || area < 1) continue;
          if (!looksLikeSheetCorners(corners)) continue;
          // Every hull vertex must lie inside (or on) the four side lines.
          const orientation = Math.sign(
            (corners[1].x - corners[0].x) * (corners[2].y - corners[1].y) -
            (corners[1].y - corners[0].y) * (corners[2].x - corners[1].x),
          );
          if (orientation === 0) continue;
          const containsHull = polygon.every((vertex) =>
            corners.every((corner, index) => {
              const next = corners[(index + 1) % 4];
              const side = (next.x - corner.x) * (vertex.y - corner.y) - (next.y - corner.y) * (vertex.x - corner.x);
              return (orientation * side) / Math.max(distance(corner, next), 1e-9) >= -containmentSlack;
            }),
          );
          if (!containsHull) continue;

          best = corners;
          bestArea = area;
        }
      }
    }
  }
  return best;
}

function sampleGray(gray: Uint8Array, width: number, height: number, x: number, y: number): number | null {
  const px = Math.round(x);
  const py = Math.round(y);
  if (px < 0 || py < 0 || px >= width || py >= height) return null;
  return gray[py * width + px];
}

/**
 * Share of points along the quadrilateral's sides where the inside is clearly
 * brighter than the outside. Points on the picture's own border are left out of
 * the count: the sheet may simply continue past the edge, which says nothing
 * about whether the side is a real edge, and counting them as support let a
 * frame-sized blob score well on two sides it does not have.
 */
function contrastSupport(
  gray: Uint8Array,
  width: number,
  height: number,
  corners: Quadrilateral,
  /** Sides that need no edge of their own (the fold between two pages): left out of the count. */
  skipSides: readonly boolean[] = [],
): number {
  const center = {
    x: corners.reduce((sum, point) => sum + point.x, 0) / 4,
    y: corners.reduce((sum, point) => sum + point.y, 0) / 4,
  };
  let supported = 0;
  let samples = 0;
  let borderSamples = 0;

  for (let side = 0; side < 4; side++) {
    if (skipSides[side]) continue;
    const start = corners[side];
    const end = corners[(side + 1) % 4];
    const length = distance(start, end);
    if (length < 1) continue;

    const dx = end.x - start.x;
    const dy = end.y - start.y;
    let nx = -dy / length;
    let ny = dx / length;
    const midX = (start.x + end.x) / 2;
    const midY = (start.y + end.y) / 2;
    if ((center.x - midX) * nx + (center.y - midY) * ny < 0) {
      nx = -nx;
      ny = -ny;
    }

    const count = Math.max(8, Math.min(80, Math.ceil(length / 3)));
    for (let i = 0; i <= count; i++) {
      const t = 0.05 + (0.9 * i) / count;
      const px = start.x + dx * t;
      const py = start.y + dy * t;
      const inside = sampleGray(gray, width, height, px + nx * CONTRAST_OFFSET, py + ny * CONTRAST_OFFSET);
      const outside = sampleGray(gray, width, height, px - nx * CONTRAST_OFFSET, py - ny * CONTRAST_OFFSET);
      if (outside === null) {
        borderSamples++;
        continue;
      }
      samples++;
      if (inside !== null && inside - outside >= MIN_EDGE_CONTRAST) supported++;
    }
  }
  // Almost no free side to judge (the sheet fills the picture): neither good nor bad evidence.
  if (samples < 12 || samples < borderSamples * 0.15) return 0.5;
  return supported / samples;
}

/** Average colourfulness (0 to 255) of the picture inside the quadrilateral, sampled on a grid. */
function meanSaturation(
  saturation: Uint8Array,
  width: number,
  height: number,
  corners: Quadrilateral,
): number {
  const minX = Math.max(0, Math.floor(Math.min(...corners.map((p) => p.x))));
  const maxX = Math.min(width - 1, Math.ceil(Math.max(...corners.map((p) => p.x))));
  const minY = Math.max(0, Math.floor(Math.min(...corners.map((p) => p.y))));
  const maxY = Math.min(height - 1, Math.ceil(Math.max(...corners.map((p) => p.y))));
  const stepX = Math.max(1, (maxX - minX) / 24);
  const stepY = Math.max(1, (maxY - minY) / 24);

  let sum = 0;
  let count = 0;
  for (let y = minY; y <= maxY; y += stepY) {
    for (let x = minX; x <= maxX; x += stepX) {
      let inside = true;
      for (let side = 0; side < 4 && inside; side++) {
        const a = corners[side];
        const b = corners[(side + 1) % 4];
        // Corners are ordered clockwise on screen, so the inside is where this is >= 0.
        if ((b.x - a.x) * (y - a.y) - (b.y - a.y) * (x - a.x) < 0) inside = false;
      }
      if (!inside) continue;
      sum += saturation[Math.round(y) * width + Math.round(x)];
      count++;
    }
  }
  return count ? sum / count : 0;
}

interface ScoredQuad {
  corners: Quadrilateral;
  score: number;
  edgeSupport: number;
  rectangularity: number;
  areaRatio: number;
}

/** Everything the scorer reads from the analysed frame. */
interface Analysis {
  width: number;
  height: number;
  /** Area-averaged brightness (kept sharp, for thin features such as a fold). */
  sharp: Uint8Array;
  /** Brightness after a light blur (for edges and regions). */
  gray: Uint8Array;
  saturation: Uint8Array;
}

function scoreCorners(
  corners: Quadrilateral,
  regionArea: number,
  analysis: Analysis,
  skipSides: readonly boolean[] = [],
): ScoredQuad | null {
  const { width, height, gray, saturation } = analysis;
  const area = polygonArea(corners);
  const areaRatio = area / (width * height);
  if (areaRatio < MIN_AREA_RATIO || areaRatio > MAX_AREA_RATIO) return null;

  const pageWidth = (distance(corners[0], corners[1]) + distance(corners[3], corners[2])) / 2;
  const pageHeight = (distance(corners[0], corners[3]) + distance(corners[1], corners[2])) / 2;
  const aspectRatio = pageWidth / pageHeight;
  if (!Number.isFinite(aspectRatio) || aspectRatio < 0.2 || aspectRatio > 5) return null;

  const rectangularity = clamp(regionArea / Math.max(area, 1), 0, 1);
  if (rectangularity < MIN_RECTANGULARITY) return null;

  const support = contrastSupport(gray, width, height, corners, skipSides);
  if (support < MIN_CONTRAST_SUPPORT) return null;

  const areaScore = clamp((areaRatio - MIN_AREA_RATIO) / 0.55, 0, 1);
  const rectangleScore = clamp((rectangularity - MIN_RECTANGULARITY) / (1 - MIN_RECTANGULARITY), 0, 1);
  // A strongly coloured region (an olive cushion, a wooden desk, a blanket) is not paper.
  const colour = meanSaturation(saturation, width, height, corners) / 255;
  if (colour > MAX_SHEET_SATURATION) return null;
  const colourFactor = colour <= PALE_SATURATION
    ? 1
    : 1 - 0.6 * ((colour - PALE_SATURATION) / (MAX_SHEET_SATURATION - PALE_SATURATION));

  // Edge support decides first: a sheet is a region with a real edge all round it.
  const score = clamp(
    support * support * (0.55 + 0.25 * rectangleScore + 0.2 * areaScore) * colourFactor,
    0,
    1,
  );

  return { corners, score, edgeSupport: support, rectangularity, areaRatio };
}

function scoreComponent(component: Component, analysis: Analysis): ScoredQuad | null {
  const { width, height } = analysis;
  const reduced = enclosingQuadrilateral(convexHull(component.boundary), { width, height });
  if (!reduced) return null;
  // The circumscribing corners can fall just outside the picture (a sheet cut off by the frame).
  const inFrame = reduced.map((point) => ({
    x: clamp(point.x, 0, width - 1),
    y: clamp(point.y, 0, height - 1),
  }));
  const corners = orderQuadrilateral(inFrame);
  if (!corners) return null;
  return scoreCorners(corners, component.area, analysis);
}

interface Spread {
  /** The two pages, each already scored. */
  pages: ScoredQuad[];
  /** 0 to 1: how clear the fold is. */
  confidence: number;
}

const lerpPoint = (a: Point2D, b: Point2D, t: number): Point2D => ({
  x: a.x + (b.x - a.x) * t,
  y: a.y + (b.y - a.y) * t,
});

/**
 * Looks for the fold of an open notebook inside a quadrilateral: a thin line,
 * darker than the paper on both sides, that runs most of the way from the top
 * edge to the bottom edge. Squared or ruled paper is covered in faint parallel
 * lines, so a fold only counts when it stands well clear of the typical line.
 */
function findSpine(
  analysis: Analysis,
  corners: Quadrilateral,
  paperLevel: number,
): { top: Point2D; bottom: Point2D; confidence: number } | null {
  const { width, height, sharp } = analysis;
  const [topLeft, topRight, bottomRight, bottomLeft] = corners;
  const across = {
    x: topRight.x - topLeft.x + bottomRight.x - bottomLeft.x,
    y: topRight.y - topLeft.y + bottomRight.y - bottomLeft.y,
  };
  const acrossLength = Math.hypot(across.x, across.y);
  if (acrossLength < 1) return null;
  const hx = across.x / acrossLength;
  const hy = across.y / acrossLength;
  const quadWidth = acrossLength / 2;

  const read = (x: number, y: number): number | null => {
    const px = Math.round(x);
    const py = Math.round(y);
    if (px < 0 || py < 0 || px >= width || py >= height) return null;
    return sharp[py * width + px];
  };

  const lines = Math.max(12, Math.round(quadWidth * (SPINE_MAX_POSITION - SPINE_MIN_POSITION)));
  const strengths: number[] = [];
  const fractions: number[] = [];
  for (let k = 0; k <= lines; k++) {
    const u = SPINE_MIN_POSITION + ((SPINE_MAX_POSITION - SPINE_MIN_POSITION) * k) / lines;
    const top = lerpPoint(topLeft, topRight, u);
    const bottom = lerpPoint(bottomLeft, bottomRight, u);
    let valid = 0;
    let present = 0;
    let sum = 0;

    for (let row = 0; row < SPINE_ROWS; row++) {
      const v = 0.08 + (0.84 * row) / (SPINE_ROWS - 1);
      const x = top.x + (bottom.x - top.x) * v;
      const y = top.y + (bottom.y - top.y) * v;
      let before = 0;
      let after = 0;
      let complete = true;
      for (let offset = SPINE_GAP + 1; offset <= SPINE_GAP + SPINE_SIDE; offset++) {
        const a = read(x - hx * offset, y - hy * offset);
        const b = read(x + hx * offset, y + hy * offset);
        if (a === null || b === null) {
          complete = false;
          break;
        }
        before += a;
        after += b;
      }
      const middle = read(x, y);
      const near = read(x - hx, y - hy);
      const far = read(x + hx, y + hy);
      if (!complete || middle === null || near === null || far === null) continue;

      const side = Math.min(before, after) / SPINE_SIDE;
      if (side < paperLevel) continue;
      valid++;
      // A fold is only a pixel or two wide at this resolution and may fall between two pixels.
      const depth = (side - Math.min((near + middle) / 2, (middle + far) / 2)) / side;
      if (depth >= SPINE_PRESENT_DEPTH) present++;
      sum += clamp(depth, 0, 0.3);
    }

    const enough = valid >= SPINE_ROWS * 0.6;
    fractions.push(enough ? present / valid : 0);
    strengths.push(enough ? (sum / valid) * (present / valid) : 0);
  }

  let bestIndex = 0;
  for (let i = 1; i < strengths.length; i++) if (strengths[i] > strengths[bestIndex]) bestIndex = i;
  const best = strengths[bestIndex];
  const typical = [...strengths].sort((a, b) => a - b)[Math.floor(strengths.length / 2)];
  if (
    best < MIN_SPINE_STRENGTH ||
    fractions[bestIndex] < MIN_SPINE_PRESENCE ||
    best < typical * MIN_SPINE_CONTRAST
  ) return null;

  const u = SPINE_MIN_POSITION + ((SPINE_MAX_POSITION - SPINE_MIN_POSITION) * bestIndex) / lines;
  return {
    top: lerpPoint(topLeft, topRight, u),
    bottom: lerpPoint(bottomLeft, bottomRight, u),
    confidence: clamp(best / 0.08, 0, 1),
  };
}

/** Sides of the quadrilateral that lie along the picture's own border. */
function borderSides(corners: Quadrilateral, width: number, height: number): boolean[] {
  const slack = 1.5;
  return corners.map((start, index) => {
    const end = corners[(index + 1) % 4];
    return (
      (start.x <= slack && end.x <= slack) ||
      (start.x >= width - 1 - slack && end.x >= width - 1 - slack) ||
      (start.y <= slack && end.y <= slack) ||
      (start.y >= height - 1 - slack && end.y >= height - 1 - slack)
    );
  });
}

/**
 * Splits a frame that holds two pages side by side at the notebook's fold. The
 * page that is whole (not cut off by the edge of the picture) is preferred, the
 * way a scanner outlines the page you are pointing at rather than the book.
 */
function splitOpenSpread(
  quad: ScoredQuad,
  analysis: Analysis,
  paperLevel: number,
): Spread | null {
  const [topLeft, topRight, bottomRight, bottomLeft] = quad.corners;
  const pageWidth = (distance(topLeft, topRight) + distance(bottomLeft, bottomRight)) / 2;
  const pageHeight = (distance(topLeft, bottomLeft) + distance(topRight, bottomRight)) / 2;
  if (pageWidth / pageHeight < MIN_SPREAD_ASPECT) return null;

  const spine = findSpine(analysis, quad.corners, paperLevel);
  if (!spine) return null;

  const halves: { corners: Quadrilateral; spineSide: number }[] = [
    { corners: [topLeft, spine.top, spine.bottom, bottomLeft], spineSide: 1 },
    { corners: [spine.top, topRight, bottomRight, spine.bottom], spineSide: 3 },
  ];
  const quadArea = polygonArea(quad.corners);
  const pages: ScoredQuad[] = [];
  for (const half of halves) {
    const skip = [false, false, false, false];
    skip[half.spineSide] = true;
    const regionArea = quad.rectangularity * polygonArea(half.corners);
    const scored = scoreCorners(half.corners, regionArea, analysis, skip);
    if (!scored) continue;
    const touching = borderSides(half.corners, analysis.width, analysis.height)
      .filter((onBorder, side) => onBorder && side !== half.spineSide).length;
    pages.push({ ...scored, score: scored.score * (1 - 0.12 * touching) });
  }
  if (!pages.length || polygonArea(quad.corners) < 1 || quadArea < 1) return null;
  return { pages, confidence: spine.confidence };
}

/** Brightness at or below which `fraction` of the pixels lie. */
function percentile(data: Uint8Array, fraction: number): number {
  const histogram = new Uint32Array(256);
  for (let i = 0; i < data.length; i++) histogram[data[i]]++;
  const target = data.length * fraction;
  let seen = 0;
  for (let level = 0; level < 256; level++) {
    seen += histogram[level];
    if (seen >= target) return level;
  }
  return 255;
}

/**
 * Brightness cut-offs to try, from the whole-frame split (Otsu) up to just
 * under the sheet's own brightness. A single cut-off cannot work everywhere: a
 * pale cushion or desk next to the sheet joins it when the cut is low, and a
 * shadow across the sheet drops out of it when the cut is high.
 */
function thresholdLadder(gray: Uint8Array): number[] {
  const otsu = otsuThreshold(gray);
  const bright = percentile(gray, 0.97);
  const levels = [
    Math.round(otsu * 0.8),
    otsu,
    ...LADDER_FRACTIONS.map((fraction) => Math.round(bright * fraction)),
  ]
    .map((level) => clamp(level, 20, Math.max(20, bright - 12)))
    .sort((a, b) => a - b);

  const ladder: number[] = [];
  for (const level of levels) {
    if (!ladder.length || level - ladder[ladder.length - 1] >= MIN_LADDER_STEP) ladder.push(level);
  }
  return ladder;
}

interface RegionSignature {
  area: number;
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

function regionSignature(component: Component): RegionSignature {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const point of component.boundary) {
    if (point.x < minX) minX = point.x;
    if (point.x > maxX) maxX = point.x;
    if (point.y < minY) minY = point.y;
    if (point.y > maxY) maxY = point.y;
  }
  return { area: component.area, minX, minY, maxX, maxY };
}

function isSameRegion(a: RegionSignature, b: RegionSignature): boolean {
  return (
    Math.abs(a.area - b.area) <= a.area * 0.015 &&
    Math.abs(a.minX - b.minX) <= 2 && Math.abs(a.maxX - b.maxX) <= 2 &&
    Math.abs(a.minY - b.minY) <= 2 && Math.abs(a.maxY - b.maxY) <= 2
  );
}

function areNearDuplicates(a: Quadrilateral, b: Quadrilateral, diagonal: number): boolean {
  const tolerance = diagonal * 0.025;
  return a.every((point, index) => distance(point, b[index]) < tolerance);
}

/**
 * Detects the sheet in an RGBA frame without OpenCV. Returns the same shape as
 * the OpenCV detector (corners in the input image's pixel coordinates), or null
 * for a malformed or too-small image. An empty candidate list means no sheet.
 */
export function detectPageBoundariesJs(image: ImageData): PageBoundaryDetection | null {
  const { width, height, data } = image;
  if (
    !Number.isInteger(width) || !Number.isInteger(height) ||
    width < 96 || height < 96 || data.length !== width * height * 4
  ) return null;

  const grayImage = toGrayscale(image, ANALYSIS_SIDE);
  const gray = blur3(grayImage);
  const analysisWidth = grayImage.width;
  const analysisHeight = grayImage.height;
  const minArea = analysisWidth * analysisHeight * MIN_AREA_RATIO;
  const scaleX = width / analysisWidth;
  const scaleY = height / analysisHeight;
  const diagonal = Math.hypot(analysisWidth, analysisHeight);

  const thresholds = thresholdLadder(gray);
  const analysis: Analysis = {
    width: analysisWidth,
    height: analysisHeight,
    sharp: grayImage.data,
    gray,
    saturation: grayImage.saturation,
  };

  const scored: ScoredQuad[] = [];
  const seenRegions: RegionSignature[] = [];
  for (const threshold of thresholds) {
    const mask = new Uint8Array(gray.length);
    for (let i = 0; i < gray.length; i++) mask[i] = gray[i] > threshold ? 1 : 0;

    for (const component of findComponents(mask, analysisWidth, analysisHeight, minArea).slice(0, 4)) {
      // The same region shows up at neighbouring cut-offs; judge it once.
      const signature = regionSignature(component);
      if (seenRegions.some((seen) => isSameRegion(seen, signature))) continue;
      seenRegions.push(signature);
      const quad = scoreComponent(component, analysis);
      if (!quad || quad.score < MIN_SCORE) continue;
      if (scored.some((existing) => areNearDuplicates(existing.corners, quad.corners, diagonal))) continue;
      scored.push(quad);
    }
  }

  scored.sort((a, b) => b.score - a.score);

  // Two pages of an open notebook lit alike merge into one region; outline one page instead.
  const paperLevel = percentile(gray, 0.97) * PAPER_LEVEL_SHARE;
  for (const quad of scored.slice(0, 2)) {
    const spread = splitOpenSpread(quad, analysis, paperLevel);
    if (!spread) continue;
    quad.score *= 1 - 0.3 * spread.confidence;
    for (const page of spread.pages) {
      const same = scored.find((existing) => areNearDuplicates(existing.corners, page.corners, diagonal));
      if (same) same.score = Math.max(same.score, page.score);
      else scored.push(page);
    }
  }
  scored.sort((a, b) => b.score - a.score);

  const candidates: PageBoundaryCandidate[] = [];
  for (const quad of scored) {
    if (quad.score < MIN_SCORE) continue;
    const restored = orderQuadrilateral(quad.corners.map((point) => ({
      x: point.x * scaleX,
      y: point.y * scaleY,
    })));
    if (!restored || !isUsablePageQuadrilateral(restored, width, height, MIN_AREA_RATIO)) continue;
    candidates.push({
      corners: restored,
      score: quad.score,
      edgeSupport: quad.edgeSupport,
      rectangularity: quad.rectangularity,
      areaRatio: quad.areaRatio,
      requiresConfirmation: true,
      source: "js",
    });
    if (candidates.length >= MAX_CANDIDATES) break;
  }

  return { candidates, analysisWidth, analysisHeight };
}
