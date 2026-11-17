import {
  computeHomography,
  isUsablePageQuadrilateral,
  orderQuadrilateral,
  transformPoint,
  type Point2D,
  type Quadrilateral,
} from "./perspectiveGeometry";

export interface RectifiedDimensions {
  width: number;
  height: number;
}

export interface PerspectiveRectificationOptions {
  /** Detector confidence must be high; uncertain corners must never alter a page. */
  confidence: number;
  minConfidence?: number;
  /** Hard cap keeps mobile memory and CPU usage bounded. */
  maxSide?: number;
}

const DEFAULT_MIN_CONFIDENCE = 0.92;
const DEFAULT_MAX_SIDE = 1800;
const MAX_ALLOWED_SIDE = 2000;

function distance(a: Point2D, b: Point2D): number {
  return Math.hypot(b.x - a.x, b.y - a.y);
}

/**
 * Estimates a rectified output size from the average lengths of opposite
 * edges. It preserves the page's measured aspect ratio and never upscales.
 */
export function getRectifiedDimensions(
  corners: Quadrilateral,
  maxSide = DEFAULT_MAX_SIDE,
): RectifiedDimensions | null {
  if (!Number.isFinite(maxSide) || maxSide < 64) return null;

  const top = distance(corners[0], corners[1]);
  const bottom = distance(corners[3], corners[2]);
  const left = distance(corners[0], corners[3]);
  const right = distance(corners[1], corners[2]);
  const measuredWidth = (top + bottom) / 2;
  const measuredHeight = (left + right) / 2;

  if (
    ![measuredWidth, measuredHeight].every(Number.isFinite) ||
    measuredWidth < 1 || measuredHeight < 1
  ) return null;

  const cap = Math.min(Math.floor(maxSide), MAX_ALLOWED_SIDE);
  const scale = Math.min(1, cap / Math.max(measuredWidth, measuredHeight));
  const width = Math.max(1, Math.round(measuredWidth * scale));
  const height = Math.max(1, Math.round(measuredHeight * scale));

  // Extremely thin or malformed quadrilaterals are not page-like.
  const ratio = width / height;
  if (ratio < 0.2 || ratio > 5) return null;
  return { width, height };
}

function sampleBilinear(
  data: Uint8ClampedArray,
  width: number,
  height: number,
  x: number,
  y: number,
  target: Uint8ClampedArray,
  targetIndex: number,
): void {
  const clampedX = Math.max(0, Math.min(width - 1, x));
  const clampedY = Math.max(0, Math.min(height - 1, y));
  const x0 = Math.floor(clampedX);
  const y0 = Math.floor(clampedY);
  const x1 = Math.min(width - 1, x0 + 1);
  const y1 = Math.min(height - 1, y0 + 1);
  const dx = clampedX - x0;
  const dy = clampedY - y0;
  const topLeft = (y0 * width + x0) * 4;
  const topRight = (y0 * width + x1) * 4;
  const bottomLeft = (y1 * width + x0) * 4;
  const bottomRight = (y1 * width + x1) * 4;

  for (let channel = 0; channel < 4; channel++) {
    const topValue = data[topLeft + channel] * (1 - dx) + data[topRight + channel] * dx;
    const bottomValue = data[bottomLeft + channel] * (1 - dx) + data[bottomRight + channel] * dx;
    target[targetIndex + channel] = topValue * (1 - dy) + bottomValue * dy;
  }
}

/**
 * Rectifies a page only when a caller supplies a validated four-corner
 * detection with sufficiently high confidence. Returns null on every
 * uncertain/unsupported case so callers can retain and send the original.
 *
 * This function deliberately does not detect corners and must not be treated
 * as a detector. The caller should always preserve the original canvas.
 */
export function rectifyPagePerspective(
  source: HTMLCanvasElement,
  corners: Quadrilateral,
  options: PerspectiveRectificationOptions,
): HTMLCanvasElement | null {
  const { confidence, minConfidence = DEFAULT_MIN_CONFIDENCE, maxSide = DEFAULT_MAX_SIDE } = options;

  const orderedCorners = orderQuadrilateral(corners);
  if (
    !orderedCorners ||
    !Number.isFinite(confidence) ||
    !Number.isFinite(minConfidence) ||
    minConfidence < 0 || minConfidence > 1 ||
    confidence < minConfidence ||
    !source || source.width < 2 || source.height < 2 ||
    !isUsablePageQuadrilateral(orderedCorners, source.width, source.height)
  ) return null;

  const dimensions = getRectifiedDimensions(orderedCorners, maxSide);
  if (!dimensions) return null;

  const destination: Quadrilateral = [
    { x: 0, y: 0 },
    { x: dimensions.width - 1, y: 0 },
    { x: dimensions.width - 1, y: dimensions.height - 1 },
    { x: 0, y: dimensions.height - 1 },
  ];

  // Inverse mapping avoids holes: each output pixel samples the source page.
  const inverse = computeHomography(destination, orderedCorners);
  if (!inverse) return null;

  try {
    const sourceContext = source.getContext("2d", { willReadFrequently: true });
    if (!sourceContext) return null;
    const sourceImage = sourceContext.getImageData(0, 0, source.width, source.height);

    const output = document.createElement("canvas");
    output.width = dimensions.width;
    output.height = dimensions.height;
    const outputContext = output.getContext("2d", { willReadFrequently: true });
    if (!outputContext) return null;

    const outputImage = outputContext.createImageData(dimensions.width, dimensions.height);
    const sourceData = sourceImage.data;
    const outputData = outputImage.data;

    for (let y = 0; y < dimensions.height; y++) {
      for (let x = 0; x < dimensions.width; x++) {
        const mapped = transformPoint({ x, y }, inverse);
        if (!mapped) return null;
        const index = (y * dimensions.width + x) * 4;
        sampleBilinear(
          sourceData,
          source.width,
          source.height,
          mapped.x,
          mapped.y,
          outputData,
          index,
        );
      }
    }

    outputContext.putImageData(outputImage, 0, 0);
    return output;
  } catch {
    // Security restrictions, memory pressure, or canvas failures must not
    // prevent the caller from using the untouched original image.
    return null;
  }
}
