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

interface GrayImage {
  width: number;
  height: number;
  data: Uint8Array;
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
  const counts = new Uint16Array(width * height);
  const { data } = image;

  for (let y = 0; y < image.height; y++) {
    const row = Math.min(height - 1, Math.floor((y * height) / image.height));
    for (let x = 0; x < image.width; x++) {
      const column = Math.min(width - 1, Math.floor((x * width) / image.width));
      const source = (y * image.width + x) * 4;
      const target = row * width + column;
      sums[target] += 0.299 * data[source] + 0.587 * data[source + 1] + 0.114 * data[source + 2];
      counts[target]++;
    }
  }

  const gray = new Uint8Array(width * height);
  for (let i = 0; i < gray.length; i++) {
    gray[i] = counts[i] ? Math.round(sums[i] / counts[i]) : 0;
  }
  return { width, height, data: gray };
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

function triangleArea(a: Point2D, b: Point2D, c: Point2D): number {
  return Math.abs((b.x - a.x) * (c.y - a.y) - (c.x - a.x) * (b.y - a.y)) / 2;
}

/** Repeatedly drops the hull vertex that contributes the least area. */
function reduceToFourCorners(hull: Point2D[]): Point2D[] | null {
  if (hull.length < 4) return null;
  const points = [...hull];
  while (points.length > 4) {
    let weakest = 0;
    let weakestArea = Infinity;
    for (let i = 0; i < points.length; i++) {
      const area = triangleArea(
        points[(i - 1 + points.length) % points.length],
        points[i],
        points[(i + 1) % points.length],
      );
      if (area < weakestArea) {
        weakestArea = area;
        weakest = i;
      }
    }
    points.splice(weakest, 1);
  }
  return points;
}

function sampleGray(gray: Uint8Array, width: number, height: number, x: number, y: number): number | null {
  const px = Math.round(x);
  const py = Math.round(y);
  if (px < 0 || py < 0 || px >= width || py >= height) return null;
  return gray[py * width + px];
}

/**
 * Share of points along the quadrilateral's sides where the inside is clearly
 * brighter than the outside. Outside the frame counts as support because the
 * sheet may simply continue past the edge of the picture.
 */
function contrastSupport(
  gray: Uint8Array,
  width: number,
  height: number,
  corners: Quadrilateral,
): number {
  const center = {
    x: corners.reduce((sum, point) => sum + point.x, 0) / 4,
    y: corners.reduce((sum, point) => sum + point.y, 0) / 4,
  };
  let supported = 0;
  let samples = 0;

  for (let side = 0; side < 4; side++) {
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
      samples++;
      if (outside === null) {
        supported++;
      } else if (inside !== null && inside - outside >= MIN_EDGE_CONTRAST) {
        supported++;
      }
    }
  }
  return samples ? supported / samples : 0;
}

interface ScoredQuad {
  corners: Quadrilateral;
  score: number;
  edgeSupport: number;
  rectangularity: number;
  areaRatio: number;
}

function scoreComponent(
  component: Component,
  gray: Uint8Array,
  width: number,
  height: number,
): ScoredQuad | null {
  const reduced = reduceToFourCorners(convexHull(component.boundary));
  if (!reduced) return null;
  const corners = orderQuadrilateral(reduced);
  if (!corners) return null;

  const area = polygonArea(corners);
  const areaRatio = area / (width * height);
  if (areaRatio < MIN_AREA_RATIO || areaRatio > MAX_AREA_RATIO) return null;

  const pageWidth = (distance(corners[0], corners[1]) + distance(corners[3], corners[2])) / 2;
  const pageHeight = (distance(corners[0], corners[3]) + distance(corners[1], corners[2])) / 2;
  const aspectRatio = pageWidth / pageHeight;
  if (!Number.isFinite(aspectRatio) || aspectRatio < 0.2 || aspectRatio > 5) return null;

  const rectangularity = clamp(component.area / Math.max(area, 1), 0, 1);
  if (rectangularity < MIN_RECTANGULARITY) return null;

  const support = contrastSupport(gray, width, height, corners);
  if (support < MIN_CONTRAST_SUPPORT) return null;

  const areaScore = clamp((areaRatio - MIN_AREA_RATIO) / 0.55, 0, 1);
  const rectangleScore = clamp((rectangularity - MIN_RECTANGULARITY) / (1 - MIN_RECTANGULARITY), 0, 1);
  const score = clamp(0.45 * support + 0.35 * rectangleScore + 0.2 * areaScore, 0, 1);

  return { corners, score, edgeSupport: support, rectangularity, areaRatio };
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

  const otsu = otsuThreshold(gray);
  // A second, lower threshold keeps a shadowed part of the sheet in the region.
  const thresholds = [...new Set([otsu, Math.max(20, Math.round(otsu * 0.8))])];

  const scored: ScoredQuad[] = [];
  for (const threshold of thresholds) {
    const mask = new Uint8Array(gray.length);
    for (let i = 0; i < gray.length; i++) mask[i] = gray[i] > threshold ? 1 : 0;

    for (const component of findComponents(mask, analysisWidth, analysisHeight, minArea).slice(0, 4)) {
      const quad = scoreComponent(component, gray, analysisWidth, analysisHeight);
      if (!quad) continue;
      if (scored.some((existing) => areNearDuplicates(existing.corners, quad.corners, diagonal))) continue;
      scored.push(quad);
    }
  }

  scored.sort((a, b) => b.score - a.score);

  const candidates: PageBoundaryCandidate[] = [];
  for (const quad of scored) {
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
