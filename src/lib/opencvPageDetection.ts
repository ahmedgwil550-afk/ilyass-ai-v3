import {
  isUsablePageQuadrilateral,
  orderQuadrilateral,
  polygonArea,
  type Point2D,
  type Quadrilateral,
} from "./perspectiveGeometry";

export interface PageBoundaryCandidate {
  corners: Quadrilateral;
  /** Ranking score only. It is not a calibrated probability. */
  score: number;
  edgeSupport: number;
  rectangularity: number;
  areaRatio: number;
  /** Always requires explicit user confirmation until benchmarked on real captures. */
  requiresConfirmation: true;
}

export interface PageBoundaryDetection {
  candidates: PageBoundaryCandidate[];
  analysisWidth: number;
  analysisHeight: number;
}

type OpenCvApi = Record<string, any>;

const MAX_ANALYSIS_SIDE = 1280;
const MAX_CANDIDATES = 3;
let openCvPromise: Promise<OpenCvApi> | null = null;

const clamp = (value: number, min: number, max: number) =>
  Math.max(min, Math.min(max, value));

function loadOpenCv(): Promise<OpenCvApi> {
  if (!openCvPromise) {
    openCvPromise = (async () => {
      const imported = await import("@techstark/opencv-js");
      const exported = (imported as any).default ?? imported;
      const cv: OpenCvApi = exported instanceof Promise
        ? await new Promise((resolve, reject) => exported.then(resolve, reject))
        : exported;

      if (!cv?.Mat) {
        await new Promise<void>((resolve, reject) => {
          const timeout = setTimeout(() => reject(new Error("OpenCV initialization timed out.")), 20_000);
          cv.onRuntimeInitialized = () => {
            clearTimeout(timeout);
            resolve();
          };
        });
      }

      if (!cv?.Mat || !cv?.findContours || !cv?.approxPolyDP) {
        throw new Error("OpenCV.js initialized without the required contour APIs.");
      }
      return cv;
    })().catch((error) => {
      // Do not cache a failed initialization; a later upload may retry.
      openCvPromise = null;
      throw error;
    });
  }
  return openCvPromise;
}

function pointAt(data: Int32Array, index: number): Point2D {
  return { x: data[index * 2], y: data[index * 2 + 1] };
}

function distance(a: Point2D, b: Point2D): number {
  return Math.hypot(b.x - a.x, b.y - a.y);
}

function edgeSupport(
  edgeData: Uint8Array,
  width: number,
  height: number,
  corners: Quadrilateral,
): number {
  let supported = 0;
  let samples = 0;
  const radius = 2;

  for (let side = 0; side < 4; side++) {
    const start = corners[side];
    const end = corners[(side + 1) % 4];
    const length = distance(start, end);
    const count = Math.max(16, Math.min(160, Math.ceil(length / 8)));

    for (let i = 0; i <= count; i++) {
      const t = i / count;
      const x = Math.round(start.x + (end.x - start.x) * t);
      const y = Math.round(start.y + (end.y - start.y) * t);
      let found = false;

      for (let dy = -radius; dy <= radius && !found; dy++) {
        for (let dx = -radius; dx <= radius; dx++) {
          const px = x + dx;
          const py = y + dy;
          if (px >= 0 && py >= 0 && px < width && py < height && edgeData[py * width + px] > 0) {
            found = true;
            break;
          }
        }
      }
      if (found) supported++;
      samples++;
    }
  }
  return samples ? supported / samples : 0;
}

function candidateScore(
  corners: Quadrilateral,
  contourArea: number,
  edgeData: Uint8Array,
  width: number,
  height: number,
): PageBoundaryCandidate | null {
  if (!isUsablePageQuadrilateral(corners, width, height, 0.08)) return null;

  const area = polygonArea(corners);
  const areaRatio = area / (width * height);
  if (areaRatio < 0.08 || areaRatio > 0.985) return null;

  const top = distance(corners[0], corners[1]);
  const bottom = distance(corners[3], corners[2]);
  const left = distance(corners[0], corners[3]);
  const right = distance(corners[1], corners[2]);
  const pageWidth = (top + bottom) / 2;
  const pageHeight = (left + right) / 2;
  const aspectRatio = pageWidth / pageHeight;
  if (!Number.isFinite(aspectRatio) || aspectRatio < 0.2 || aspectRatio > 5) return null;

  const rectangularity = clamp(contourArea / Math.max(area, 1), 0, 1);
  if (rectangularity < 0.72) return null;

  const support = edgeSupport(edgeData, width, height, corners);
  if (support < 0.34) return null;

  const areaScore = clamp((areaRatio - 0.08) / 0.55, 0, 1);
  const rectangleScore = clamp((rectangularity - 0.72) / 0.28, 0, 1);
  const score = clamp(0.58 * support + 0.27 * rectangleScore + 0.15 * areaScore, 0, 1);

  return {
    corners,
    score,
    edgeSupport: support,
    rectangularity,
    areaRatio,
    requiresConfirmation: true,
  };
}

function areNearDuplicates(a: Quadrilateral, b: Quadrilateral, diagonal: number): boolean {
  const tolerance = diagonal * 0.025;
  return a.every((point, index) => distance(point, b[index]) < tolerance);
}

/**
 * Finds page-boundary candidates using OpenCV's Canny, morphology and contour
 * pipeline. This is deliberately separate from rectification: callers must
 * show the proposed boundary and obtain user confirmation before warping.
 */
export async function detectPageBoundaries(
  image: ImageData,
): Promise<PageBoundaryDetection | null> {
  const { width, height, data } = image;
  if (
    !Number.isInteger(width) || !Number.isInteger(height) ||
    width < 96 || height < 96 || data.length !== width * height * 4
  ) return null;

  const scale = Math.min(1, MAX_ANALYSIS_SIDE / Math.max(width, height));
  const analysisWidth = Math.max(96, Math.round(width * scale));
  const analysisHeight = Math.max(96, Math.round(height * scale));
  const cv = await loadOpenCv();

  let source: any;
  let resized: any;
  let gray: any;
  let blurred: any;
  let edges: any;
  let closed: any;
  let kernel: any;
  let contours: any;
  let hierarchy: any;

  try {
    source = cv.matFromImageData(image);
    resized = new cv.Mat();
    gray = new cv.Mat();
    blurred = new cv.Mat();
    edges = new cv.Mat();
    closed = new cv.Mat();
    contours = new cv.MatVector();
    hierarchy = new cv.Mat();

    cv.resize(source, resized, new cv.Size(analysisWidth, analysisHeight), 0, 0, cv.INTER_AREA);
    cv.cvtColor(resized, gray, cv.COLOR_RGBA2GRAY);
    cv.GaussianBlur(gray, blurred, new cv.Size(5, 5), 0, 0, cv.BORDER_DEFAULT);
    cv.Canny(blurred, edges, 45, 135, 3, true);

    kernel = cv.getStructuringElement(cv.MORPH_RECT, new cv.Size(5, 5));
    cv.morphologyEx(edges, closed, cv.MORPH_CLOSE, kernel);
    cv.findContours(closed, contours, hierarchy, cv.RETR_LIST, cv.CHAIN_APPROX_SIMPLE);

    const edgePixels = edges.data as Uint8Array;
    const diagonal = Math.hypot(analysisWidth, analysisHeight);
    const found: PageBoundaryCandidate[] = [];
    const contourCount = Math.min(contours.size(), 2500);

    for (let index = 0; index < contourCount; index++) {
      const contour = contours.get(index);
      let perimeter = 0;
      let approximation: any;
      try {
        const contourArea = Math.abs(cv.contourArea(contour));
        if (contourArea < analysisWidth * analysisHeight * 0.08) continue;

        perimeter = cv.arcLength(contour, true);
        if (!Number.isFinite(perimeter) || perimeter <= 0) continue;

        approximation = new cv.Mat();
        cv.approxPolyDP(contour, approximation, 0.018 * perimeter, true);
        if (approximation.rows !== 4 || approximation.cols !== 1 || approximation.data32S.length !== 8) continue;
        if (!cv.isContourConvex(approximation)) continue;

        const raw = Array.from({ length: 4 }, (_, pointIndex) =>
          pointAt(approximation.data32S as Int32Array, pointIndex),
        );
        const ordered = orderQuadrilateral(raw);
        if (!ordered) continue;

        const candidate = candidateScore(
          ordered,
          contourArea,
          edgePixels,
          analysisWidth,
          analysisHeight,
        );
        if (!candidate) continue;

        const restored = orderQuadrilateral(candidate.corners.map((point) => ({
          x: point.x / scale,
          y: point.y / scale,
        })));
        if (!restored || !isUsablePageQuadrilateral(restored, width, height, 0.08)) continue;

        const result: PageBoundaryCandidate = { ...candidate, corners: restored };
        if (found.some((existing) => areNearDuplicates(existing.corners, result.corners, diagonal / scale))) {
          continue;
        }
        found.push(result);
      } finally {
        approximation?.delete();
        contour.delete();
      }
    }

    found.sort((a, b) => b.score - a.score);
    return {
      candidates: found.slice(0, MAX_CANDIDATES),
      analysisWidth,
      analysisHeight,
    };
  } finally {
    source?.delete();
    resized?.delete();
    gray?.delete();
    blurred?.delete();
    edges?.delete();
    closed?.delete();
    kernel?.delete();
    contours?.delete();
    hierarchy?.delete();
  }
}
