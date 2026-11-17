/**
 * Conservative document-photo enhancement.
 *
 * Estimates the slowly varying paper illumination on a tiny blurred preview,
 * then applies a bounded luminance gain to the full-resolution image. This
 * reduces broad shadows while preserving ink, color, diagrams and gray detail.
 * It deliberately does not threshold or invent missing image information.
 */

const GRID_SIZE = 48;
const MIN_BACKGROUND = 92;
const MIN_GAIN = 0.82;
const MAX_GAIN = 1.32;

export function getIlluminationGain(backgroundLuminance: number): number {
  if (!Number.isFinite(backgroundLuminance)) return 1;
  const safeBackground = Math.max(MIN_BACKGROUND, Math.min(255, backgroundLuminance));
  // Normalize toward clean paper, but cap the lift to avoid blowing out faint ink.
  return Math.max(MIN_GAIN, Math.min(MAX_GAIN, 242 / safeBackground));
}

const luminance = (r: number, g: number, b: number) =>
  0.299 * r + 0.587 * g + 0.114 * b;

function sampleGridValue(
  values: Float32Array,
  x: number,
  y: number,
): number {
  const gx = Math.max(0, Math.min(GRID_SIZE - 1, x));
  const gy = Math.max(0, Math.min(GRID_SIZE - 1, y));
  const x0 = Math.floor(gx);
  const y0 = Math.floor(gy);
  const x1 = Math.min(GRID_SIZE - 1, x0 + 1);
  const y1 = Math.min(GRID_SIZE - 1, y0 + 1);
  const tx = gx - x0;
  const ty = gy - y0;
  const top = values[y0 * GRID_SIZE + x0] * (1 - tx) + values[y0 * GRID_SIZE + x1] * tx;
  const bottom = values[y1 * GRID_SIZE + x0] * (1 - tx) + values[y1 * GRID_SIZE + x1] * tx;
  return top * (1 - ty) + bottom * ty;
}

/**
 * Corrects uneven lighting using a low-resolution illumination field.
 * Work is bounded to a 48x48 preview plus one full-resolution pixel pass.
 */
export function normalizeUnevenLighting(
  context: CanvasRenderingContext2D,
  width: number,
  height: number,
): void {
  if (width < 2 || height < 2) return;

  const preview = document.createElement("canvas");
  preview.width = GRID_SIZE;
  preview.height = GRID_SIZE;
  const previewContext = preview.getContext("2d", { willReadFrequently: true });
  if (!previewContext) return;

  previewContext.imageSmoothingEnabled = true;
  previewContext.drawImage(context.canvas, 0, 0, GRID_SIZE, GRID_SIZE);
  // Blur the thumbnail so text strokes do not become part of the illumination map.
  const blurred = document.createElement("canvas");
  blurred.width = GRID_SIZE;
  blurred.height = GRID_SIZE;
  const blurredContext = blurred.getContext("2d", { willReadFrequently: true });
  if (!blurredContext) return;
  blurredContext.filter = "blur(2.5px)";
  blurredContext.drawImage(preview, 0, 0);
  blurredContext.filter = "none";

  const fieldData = blurredContext.getImageData(0, 0, GRID_SIZE, GRID_SIZE).data;
  const field = new Float32Array(GRID_SIZE * GRID_SIZE);
  for (let i = 0; i < field.length; i++) {
    field[i] = luminance(fieldData[i * 4], fieldData[i * 4 + 1], fieldData[i * 4 + 2]);
  }

  const image = context.getImageData(0, 0, width, height);
  const pixels = image.data;
  const scaleX = (GRID_SIZE - 1) / Math.max(1, width - 1);
  const scaleY = (GRID_SIZE - 1) / Math.max(1, height - 1);

  for (let y = 0; y < height; y++) {
    const gy = y * scaleY;
    for (let x = 0; x < width; x++) {
      const index = (y * width + x) * 4;
      const paper = sampleGridValue(field, x * scaleX, gy);
      const gain = getIlluminationGain(paper);
      const current = luminance(pixels[index], pixels[index + 1], pixels[index + 2]);

      // Leave dark ink and near-white highlights nearly untouched.
      const inkProtection = Math.max(0, Math.min(1, (current - 28) / 112));
      const highlightProtection = Math.max(0, Math.min(1, (250 - current) / 24));
      const strength = inkProtection * highlightProtection;
      const effectiveGain = 1 + (gain - 1) * strength;
      pixels[index] = Math.min(255, pixels[index] * effectiveGain);
      pixels[index + 1] = Math.min(255, pixels[index + 1] * effectiveGain);
      pixels[index + 2] = Math.min(255, pixels[index + 2] * effectiveGain);
    }
  }

  context.putImageData(image, 0, 0);
}
