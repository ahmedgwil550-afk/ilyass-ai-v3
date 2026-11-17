export type DocumentPhotoWarning = "low-light" | "low-contrast" | "blur";

export interface DocumentPhotoMetrics {
  brightness: number;
  contrast: number;
  sharpness: number;
}

/** Pure classifier so thresholds can be tested without browser canvas APIs. */
export function classifyDocumentPhoto(metrics: DocumentPhotoMetrics): DocumentPhotoWarning[] {
  const warnings: DocumentPhotoWarning[] = [];
  if (metrics.brightness < 105) warnings.push("low-light");
  if (metrics.contrast < 19 && metrics.brightness < 238) warnings.push("low-contrast");
  if (metrics.sharpness < 13 && metrics.contrast > 17) warnings.push("blur");
  return warnings;
}

/**
 * Samples a small, aspect-ratio-preserving preview. The full-resolution source
 * is never changed; this is a diagnostic pass only.
 */
export function analyzeDocumentPhoto(
  context: CanvasRenderingContext2D,
  width: number,
  height: number,
): DocumentPhotoWarning[] {
  if (width < 2 || height < 2) return [];

  const scale = Math.min(1, 256 / Math.max(width, height));
  const sampleWidth = Math.max(2, Math.round(width * scale));
  const sampleHeight = Math.max(2, Math.round(height * scale));
  const sample = document.createElement("canvas");
  sample.width = sampleWidth;
  sample.height = sampleHeight;
  const sampleContext = sample.getContext("2d", { willReadFrequently: true });
  if (!sampleContext) return [];

  sampleContext.drawImage(context.canvas, 0, 0, sampleWidth, sampleHeight);
  const pixels = sampleContext.getImageData(0, 0, sampleWidth, sampleHeight).data;
  const gray = new Uint8Array(sampleWidth * sampleHeight);
  let sum = 0;
  let sumSquares = 0;

  for (let i = 0, p = 0; i < pixels.length; i += 4, p++) {
    const value = Math.round(0.299 * pixels[i] + 0.587 * pixels[i + 1] + 0.114 * pixels[i + 2]);
    gray[p] = value;
    sum += value;
    sumSquares += value * value;
  }

  const count = gray.length;
  const brightness = sum / count;
  const contrast = Math.sqrt(Math.max(0, sumSquares / count - brightness * brightness));
  let laplacianSum = 0;
  let laplacianSquares = 0;
  let edgeCount = 0;

  for (let y = 1; y < sampleHeight - 1; y++) {
    for (let x = 1; x < sampleWidth - 1; x++) {
      const i = y * sampleWidth + x;
      const laplacian = 4 * gray[i] - gray[i - 1] - gray[i + 1] -
        gray[i - sampleWidth] - gray[i + sampleWidth];
      laplacianSum += laplacian;
      laplacianSquares += laplacian * laplacian;
      edgeCount++;
    }
  }

  const laplacianMean = edgeCount ? laplacianSum / edgeCount : 0;
  const sharpness = edgeCount
    ? Math.max(0, laplacianSquares / edgeCount - laplacianMean * laplacianMean)
    : 0;

  return classifyDocumentPhoto({
    brightness,
    contrast,
    sharpness,
  });
}
