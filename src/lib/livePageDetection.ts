import type { PageBoundaryCandidate, PageBoundaryDetection } from "./opencvPageDetection";
import type { Quadrilateral } from "./perspectiveGeometry";

/** Detectors are injected so the orchestration is testable without OpenCV or a camera. */
export interface LivePageDetectors {
  /** True once the OpenCV runtime is loaded and usable. */
  opencvReady: () => boolean;
  opencv: (image: ImageData) => Promise<PageBoundaryDetection | null>;
  js: (image: ImageData) => PageBoundaryDetection | null;
}

export interface LivePageDetectionResult {
  candidate: PageBoundaryCandidate | null;
  engine: "opencv" | "js" | null;
  /** Set when OpenCV was ready but threw; the built-in detector still ran. */
  opencvError: unknown;
}

/**
 * Finds the sheet in one live frame. OpenCV is preferred once it has finished
 * loading, but the first frames never wait for the WASM download, and an
 * OpenCV failure falls back to the built-in detector instead of leaving the
 * camera without a frame. An error from the built-in detector is rethrown.
 */
export async function detectLivePage(
  image: ImageData,
  detectors: LivePageDetectors,
): Promise<LivePageDetectionResult> {
  let opencvError: unknown = null;

  if (detectors.opencvReady()) {
    try {
      const result = await detectors.opencv(image);
      const best = result?.candidates[0];
      if (best) return { candidate: best, engine: "opencv", opencvError: null };
    } catch (error) {
      opencvError = error;
    }
  }

  const fallback = detectors.js(image);
  const best = fallback?.candidates[0] ?? null;
  return { candidate: best, engine: best ? "js" : null, opencvError };
}

export interface SmoothCornersOptions {
  /** Weight of the new frame, 0 to 1. Higher follows the sheet faster. */
  alpha?: number;
  /** A corner that moves farther than this is a different sheet: snap, do not glide. */
  resetDistance: number;
}

/** Blends the previous frame's corners toward the new ones to remove jitter. */
export function smoothCorners(
  previous: Quadrilateral | null,
  next: Quadrilateral,
  { alpha = 0.5, resetDistance }: SmoothCornersOptions,
): Quadrilateral {
  if (!previous) return next;

  const largestJump = next.reduce(
    (largest, point, index) =>
      Math.max(largest, Math.hypot(point.x - previous[index].x, point.y - previous[index].y)),
    0,
  );
  if (largestJump > resetDistance) return next;

  return next.map((point, index) => ({
    x: previous[index].x + (point.x - previous[index].x) * alpha,
    y: previous[index].y + (point.y - previous[index].y) * alpha,
  })) as Quadrilateral;
}
