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
  /** Which detector produced the candidate. Optional so older callers keep compiling. */
  source?: "opencv" | "js";
}

export interface PageBoundaryDetection {
  candidates: PageBoundaryCandidate[];
  analysisWidth: number;
  analysisHeight: number;
}

type OpenCvApi = Record<string, any>;

/**
 * The OpenCV runtime is always carried inside this box. Emscripten builds can
 * expose a `then` method on the module itself, and resolving or returning such
 * an object from a promise makes the promise machinery call `then` again
 * forever, so the runtime must never be a promise's resolution value.
 */
interface OpenCvBox {
  cv: OpenCvApi;
}

const MAX_ANALYSIS_SIDE = 1280;
const MAX_CANDIDATES = 3;
const OPENCV_INIT_TIMEOUT_MS = 30_000;
const APPROX_EPSILONS = [0.012, 0.018, 0.026, 0.036, 0.05];

/** Functions the main edge pipeline calls. Anything else is feature-detected. */
const REQUIRED_OPENCV_APIS = [
  "Mat",
  "MatVector",
  "Size",
  "matFromImageData",
  "resize",
  "cvtColor",
  "GaussianBlur",
  "Canny",
  "getStructuringElement",
  "morphologyEx",
  "findContours",
  "approxPolyDP",
  "arcLength",
  "contourArea",
] as const;

let openCvPromise: Promise<OpenCvBox> | null = null;
let openCvInstance: OpenCvApi | null = null;

const clamp = (value: number, min: number, max: number) =>
  Math.max(min, Math.min(max, value));

function withTimeout<T>(promise: Promise<T>, ms: number, message: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(message)), ms);
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error) => {
        clearTimeout(timer);
        reject(error);
      },
    );
  });
}

function missingOpenCvApis(cv: OpenCvApi | null | undefined): string[] {
  if (!cv) return [...REQUIRED_OPENCV_APIS];
  return REQUIRED_OPENCV_APIS.filter((name) => typeof cv[name] !== "function");
}

async function importOpenCvRuntime(): Promise<OpenCvBox> {
  const namespace: any = await import("@techstark/opencv-js");
  let runtime: any = namespace?.default ?? namespace;

  // Newer builds export a promise (or a thenable module) for the ready runtime.
  if (runtime && typeof runtime.then === "function") {
    const settled = await new Promise<{ value: any }>((resolve, reject) => {
      runtime.then((value: any) => resolve({ value }), reject);
    });
    runtime = settled.value;
  }

  if (!runtime) throw new Error("OpenCV.js did not export a runtime object.");

  // Older builds finish initializing after the import has already returned.
  if (typeof runtime.Mat !== "function") {
    await new Promise<void>((resolve) => {
      const previous = runtime.onRuntimeInitialized;
      runtime.onRuntimeInitialized = () => {
        try {
          previous?.call(runtime);
        } finally {
          resolve();
        }
      };
    });
  }

  return { cv: runtime };
}

function loadOpenCv(): Promise<OpenCvBox> {
  if (!openCvPromise) {
    openCvPromise = withTimeout(
      importOpenCvRuntime(),
      OPENCV_INIT_TIMEOUT_MS,
      "OpenCV initialization timed out.",
    )
      .then((box) => {
        const missing = missingOpenCvApis(box.cv);
        if (missing.length) {
          throw new Error(`OpenCV.js is missing required APIs: ${missing.join(", ")}.`);
        }
        openCvInstance = box.cv;
        return box;
      })
      .catch((error) => {
        // Do not cache a failed initialization; a later call may retry.
        openCvPromise = null;
        openCvInstance = null;
        throw error;
      });
  }
  return openCvPromise;
}

/** True once the WASM runtime has finished initializing and passed its API check. */
export function isOpenCvReady(): boolean {
  return openCvInstance !== null;
}

/** Starts loading the WASM runtime in the background. Rejects if it cannot load. */
export async function preloadOpenCv(): Promise<void> {
  await loadOpenCv();
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
  const radius = 3;

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
  if (support < 0.3) return null;

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
    source: "opencv",
  };
}

function areNearDuplicates(a: Quadrilateral, b: Quadrilateral, diagonal: number): boolean {
  const tolerance = diagonal * 0.025;
  return a.every((point, index) => distance(point, b[index]) < tolerance);
}

/**
 * Reduces a contour to four corners. The convex hull is simplified with a
 * growing tolerance, so a page with slightly bowed edges, a shadow or a thumb
 * on it still yields a quadrilateral instead of being dropped.
 */
function approximateQuadrilateral(cv: OpenCvApi, contour: any): Point2D[] | null {
  let hull: any;
  try {
    let shape = contour;
    if (typeof cv.convexHull === "function") {
      hull = new cv.Mat();
      cv.convexHull(contour, hull, false, true);
      if (hull.rows >= 4) shape = hull;
    }

    const perimeter = cv.arcLength(shape, true);
    if (!Number.isFinite(perimeter) || perimeter <= 0) return null;

    for (const epsilon of APPROX_EPSILONS) {
      const approximation = new cv.Mat();
      try {
        cv.approxPolyDP(shape, approximation, epsilon * perimeter, true);
        if (approximation.rows < 4) return null;
        if (
          approximation.rows === 4 &&
          approximation.cols === 1 &&
          approximation.data32S.length === 8
        ) {
          return Array.from({ length: 4 }, (_, pointIndex) =>
            pointAt(approximation.data32S as Int32Array, pointIndex),
          );
        }
      } finally {
        approximation.delete();
      }
    }
    return null;
  } finally {
    hull?.delete();
  }
}

interface CollectContext {
  analysisWidth: number;
  analysisHeight: number;
  width: number;
  height: number;
  scale: number;
  diagonal: number;
  edgePixels: Uint8Array;
}

function collectCandidates(
  cv: OpenCvApi,
  binary: any,
  retrievalMode: number,
  context: CollectContext,
  found: PageBoundaryCandidate[],
): void {
  const contours = new cv.MatVector();
  const hierarchy = new cv.Mat();
  try {
    cv.findContours(binary, contours, hierarchy, retrievalMode, cv.CHAIN_APPROX_SIMPLE);
    const contourCount = Math.min(contours.size(), 2500);

    for (let index = 0; index < contourCount; index++) {
      const contour = contours.get(index);
      try {
        const contourArea = Math.abs(cv.contourArea(contour));
        if (contourArea < context.analysisWidth * context.analysisHeight * 0.08) continue;

        const raw = approximateQuadrilateral(cv, contour);
        if (!raw) continue;

        const ordered = orderQuadrilateral(raw);
        if (!ordered) continue;

        const candidate = candidateScore(
          ordered,
          contourArea,
          context.edgePixels,
          context.analysisWidth,
          context.analysisHeight,
        );
        if (!candidate) continue;

        const restored = orderQuadrilateral(candidate.corners.map((point) => ({
          x: point.x / context.scale,
          y: point.y / context.scale,
        })));
        if (!restored || !isUsablePageQuadrilateral(restored, context.width, context.height, 0.08)) continue;

        const result: PageBoundaryCandidate = { ...candidate, corners: restored };
        if (found.some((existing) => areNearDuplicates(existing.corners, result.corners, context.diagonal / context.scale))) {
          continue;
        }
        found.push(result);
      } finally {
        contour.delete();
      }
    }
  } finally {
    contours.delete();
    hierarchy.delete();
  }
}

/**
 * Finds page-boundary candidates using OpenCV's Canny, morphology and contour
 * pipeline, with a brightness-mask pass when the edge pass finds nothing (a
 * page with dense print or a grid merges into one bright region). This is
 * deliberately separate from rectification: callers must show the proposed
 * boundary and obtain user confirmation before warping.
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
  const { cv } = await loadOpenCv();

  let source: any;
  let resized: any;
  let gray: any;
  let blurred: any;
  let edges: any;
  let closed: any;
  let kernel: any;
  let mask: any;
  let cleaned: any;
  let maskKernel: any;

  try {
    source = cv.matFromImageData(image);
    resized = new cv.Mat();
    gray = new cv.Mat();
    blurred = new cv.Mat();
    edges = new cv.Mat();
    closed = new cv.Mat();

    cv.resize(source, resized, new cv.Size(analysisWidth, analysisHeight), 0, 0, cv.INTER_AREA);
    cv.cvtColor(resized, gray, cv.COLOR_RGBA2GRAY);
    cv.GaussianBlur(gray, blurred, new cv.Size(5, 5), 0, 0, cv.BORDER_DEFAULT);
    cv.Canny(blurred, edges, 45, 135, 3, true);

    kernel = cv.getStructuringElement(cv.MORPH_RECT, new cv.Size(5, 5));
    cv.morphologyEx(edges, closed, cv.MORPH_CLOSE, kernel);

    const context: CollectContext = {
      analysisWidth,
      analysisHeight,
      width,
      height,
      scale,
      diagonal: Math.hypot(analysisWidth, analysisHeight),
      edgePixels: edges.data as Uint8Array,
    };
    const found: PageBoundaryCandidate[] = [];

    collectCandidates(cv, closed, cv.RETR_LIST, context, found);

    if (!found.length && typeof cv.threshold === "function") {
      mask = new cv.Mat();
      cleaned = new cv.Mat();
      maskKernel = cv.getStructuringElement(cv.MORPH_RECT, new cv.Size(9, 9));
      cv.threshold(blurred, mask, 0, 255, cv.THRESH_BINARY + cv.THRESH_OTSU);
      cv.morphologyEx(mask, cleaned, cv.MORPH_CLOSE, maskKernel);
      collectCandidates(cv, cleaned, cv.RETR_EXTERNAL, context, found);
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
    mask?.delete();
    cleaned?.delete();
    maskKernel?.delete();
  }
}
