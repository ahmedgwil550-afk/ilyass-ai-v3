import {
  isUsablePageQuadrilateral,
  orderQuadrilateral,
  polygonArea,
  type Point2D,
  type Quadrilateral,
} from "./perspectiveGeometry";

export interface PageCornerCandidate {
  corners: Quadrilateral;
  /** Heuristic ranking only; this is NOT a calibrated probability. */
  score: number;
  /** Always false until validated against a representative real-photo dataset. */
  safeToAutoRectify: false;
}

export interface PageCornerDetectionOptions {
  maxAnalysisSide?: number;
  edgeThreshold?: number;
  maxLines?: number;
}

interface EdgePoint { x: number; y: number; strength: number }
interface HoughLine { theta: number; rho: number; votes: number }

const DEG = Math.PI / 180;
const clamp = (value: number, min: number, max: number) =>
  Math.max(min, Math.min(max, value));

function angleDistance(a: number, b: number): number {
  let difference = Math.abs(a - b) % Math.PI;
  if (difference > Math.PI / 2) difference = Math.PI - difference;
  return difference;
}

function intersection(a: HoughLine, b: HoughLine): Point2D | null {
  const ax = Math.cos(a.theta), ay = Math.sin(a.theta);
  const bx = Math.cos(b.theta), by = Math.sin(b.theta);
  const determinant = ax * by - ay * bx;
  if (Math.abs(determinant) < 0.12) return null;
  return {
    x: (a.rho * by - ay * b.rho) / determinant,
    y: (ax * b.rho - a.rho * bx) / determinant,
  };
}

function makeEdges(
  rgba: Uint8ClampedArray,
  width: number,
  height: number,
  threshold: number,
): EdgePoint[] {
  const gray = new Float32Array(width * height);
  for (let i = 0; i < width * height; i++) {
    const p = i * 4;
    gray[i] = 0.299 * rgba[p] + 0.587 * rgba[p + 1] + 0.114 * rgba[p + 2];
  }

  const edges: EdgePoint[] = [];
  for (let y = 1; y < height - 1; y++) {
    for (let x = 1; x < width - 1; x++) {
      const i = y * width + x;
      const gx =
        -gray[i - width - 1] + gray[i - width + 1] -
        2 * gray[i - 1] + 2 * gray[i + 1] -
        gray[i + width - 1] + gray[i + width + 1];
      const gy =
        -gray[i - width - 1] - 2 * gray[i - width] - gray[i - width + 1] +
        gray[i + width - 1] + 2 * gray[i + width] + gray[i + width + 1];
      const strength = Math.hypot(gx, gy);
      if (strength >= threshold) edges.push({ x, y, strength });
    }
  }
  return edges;
}

function houghLines(
  edges: EdgePoint[],
  width: number,
  height: number,
  maxLines: number,
): HoughLine[] {
  const diagonal = Math.ceil(Math.hypot(width, height));
  const rhoBins = diagonal * 2 + 1;
  const thetaBins = 180;
  const accumulator = new Uint32Array(thetaBins * rhoBins);
  const cos = new Float32Array(thetaBins);
  const sin = new Float32Array(thetaBins);
  for (let t = 0; t < thetaBins; t++) {
    cos[t] = Math.cos(t * DEG);
    sin[t] = Math.sin(t * DEG);
  }

  // Bound work on noisy photos while spreading samples over the full edge set.
  const stride = Math.max(1, Math.ceil(edges.length / 10000));
  for (let index = 0; index < edges.length; index += stride) {
    const point = edges[index];
    for (let t = 0; t < thetaBins; t++) {
      const rho = Math.round(point.x * cos[t] + point.y * sin[t]) + diagonal;
      accumulator[t * rhoBins + rho]++;
    }
  }

  const peaks: HoughLine[] = [];
  const suppressionTheta = 5;
  const suppressionRho = Math.max(3, Math.round(Math.min(width, height) * 0.025));
  for (let count = 0; count < maxLines; count++) {
    let bestVotes = 0, bestTheta = -1, bestRho = -1;
    for (let t = 0; t < thetaBins; t++) {
      for (let r = 0; r < rhoBins; r++) {
        const votes = accumulator[t * rhoBins + r];
        if (votes > bestVotes) {
          bestVotes = votes; bestTheta = t; bestRho = r;
        }
      }
    }
    if (bestTheta < 0 || bestVotes < Math.max(8, Math.min(width, height) * 0.12 / stride)) break;
    peaks.push({ theta: bestTheta * DEG, rho: bestRho - diagonal, votes: bestVotes });

    for (let dt = -suppressionTheta; dt <= suppressionTheta; dt++) {
      const t = (bestTheta + dt + thetaBins) % thetaBins;
      for (let dr = -suppressionRho; dr <= suppressionRho; dr++) {
        const r = bestRho + dr;
        if (r >= 0 && r < rhoBins) accumulator[t * rhoBins + r] = 0;
      }
    }
  }
  return peaks;
}

function scoreQuad(
  lines: [HoughLine, HoughLine, HoughLine, HoughLine],
  width: number,
  height: number,
): PageCornerCandidate | null {
  const [a, b, c, d] = lines;
  const parallelA = angleDistance(a.theta, b.theta);
  const parallelB = angleDistance(c.theta, d.theta);
  const perpendicular = Math.abs(Math.PI / 2 - angleDistance(a.theta, c.theta));
  if (parallelA > 12 * DEG || parallelB > 12 * DEG || perpendicular > 16 * DEG) return null;

  const points = [
    intersection(a, c), intersection(a, d),
    intersection(b, d), intersection(b, c),
  ];
  if (points.some((point) => point === null)) return null;
  const ordered = orderQuadrilateral(points as Point2D[]);
  if (!ordered || !isUsablePageQuadrilateral(ordered, width, height, 0.12)) return null;

  const areaRatio = polygonArea(ordered) / (width * height);
  const lineSupport = Math.min(a.votes, b.votes, c.votes, d.votes);
  const supportScore = clamp(lineSupport / (Math.min(width, height) * 0.42), 0, 1);
  const areaScore = clamp((areaRatio - 0.12) / 0.45, 0, 1);
  const geometryScore = 1 - (parallelA + parallelB + perpendicular) / (40 * DEG);
  const score = clamp(0.55 * supportScore + 0.25 * areaScore + 0.20 * geometryScore, 0, 0.99);

  return { corners: ordered, score, safeToAutoRectify: false };
}

/**
 * Experimental Hough-based page-boundary candidate finder.
 * Input is a downsampled RGBA image (not a canvas). The score is a ranking
 * heuristic, not a probability; candidates must not trigger automatic warping.
 */
export function detectPageCornerCandidate(
  rgba: Uint8ClampedArray,
  width: number,
  height: number,
  options: PageCornerDetectionOptions = {},
): PageCornerCandidate | null {
  if (
    !Number.isInteger(width) || !Number.isInteger(height) ||
    width < 32 || height < 32 || rgba.length !== width * height * 4
  ) return null;

  const maxSide = clamp(Math.floor(options.maxAnalysisSide ?? 320), 64, 480);
  const scale = Math.min(1, maxSide / Math.max(width, height));
  const analysisWidth = Math.max(32, Math.round(width * scale));
  const analysisHeight = Math.max(32, Math.round(height * scale));

  // Nearest-neighbour downsampling is sufficient for line voting and avoids
  // allocating a second full-resolution image.
  let analysis = rgba;
  if (analysisWidth !== width || analysisHeight !== height) {
    analysis = new Uint8ClampedArray(analysisWidth * analysisHeight * 4);
    for (let y = 0; y < analysisHeight; y++) {
      for (let x = 0; x < analysisWidth; x++) {
        const sx = Math.min(width - 1, Math.floor(x / scale));
        const sy = Math.min(height - 1, Math.floor(y / scale));
        const from = (sy * width + sx) * 4;
        const to = (y * analysisWidth + x) * 4;
        analysis[to] = rgba[from];
        analysis[to + 1] = rgba[from + 1];
        analysis[to + 2] = rgba[from + 2];
        analysis[to + 3] = rgba[from + 3];
      }
    }
  }

  const edges = makeEdges(analysis, analysisWidth, analysisHeight, options.edgeThreshold ?? 70);
  if (edges.length < 40) return null;
  const lines = houghLines(edges, analysisWidth, analysisHeight, clamp(options.maxLines ?? 20, 8, 32));

  let best: PageCornerCandidate | null = null;
  for (let i = 0; i < lines.length; i++) {
    for (let j = i + 1; j < lines.length; j++) {
      for (let k = 0; k < lines.length; k++) {
        if (k === i || k === j) continue;
        for (let l = k + 1; l < lines.length; l++) {
          if (l === i || l === j) continue;
          const candidate = scoreQuad(
            [lines[i], lines[j], lines[k], lines[l]],
            analysisWidth,
            analysisHeight,
          );
          if (candidate && (!best || candidate.score > best.score)) best = candidate;
        }
      }
    }
  }

  if (!best) return null;
  const restored = best.corners.map((point) => ({
    x: point.x / scale,
    y: point.y / scale,
  })) as Quadrilateral;
  const corners = orderQuadrilateral(restored);
  if (!corners || !isUsablePageQuadrilateral(corners, width, height, 0.12)) return null;
  return { corners, score: best.score, safeToAutoRectify: false };
}
