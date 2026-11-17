/**
 * تجهيز صورة الورقة قبل إرسالها للنموذج.
 * نحافظ على دقة أعلى للرموز الصغيرة، مع تصحيح EXIF وتحسين محافظ للتباين
 * وقصّ الحواف الفارغة فقط. لا نستخدم threshold ثنائياً حتى لا تختفي العلامات
 * الخفيفة أو تفاصيل الرسوم البيانية.
 */

const MAX_SIDE = 2560;
const QUALITY = 0.9;

export interface ImageDimensions {
  width: number;
  height: number;
}

/** Resize without upscaling and preserve the source aspect ratio. */
export function getScaledImageDimensions(
  width: number,
  height: number,
  maxSide = MAX_SIDE,
): ImageDimensions {
  if (
    !Number.isFinite(width) || !Number.isFinite(height) ||
    !Number.isFinite(maxSide) || width <= 0 || height <= 0 || maxSide <= 0
  ) {
    throw new RangeError("Image dimensions and maxSide must be positive finite numbers.");
  }

  const scale = Math.min(1, maxSide / Math.max(width, height));
  return {
    width: Math.max(1, Math.round(width * scale)),
    height: Math.max(1, Math.round(height * scale)),
  };
}

async function decode(file: File): Promise<{ src: CanvasImageSource; w: number; h: number; close: () => void } | null> {
  // createImageBitmap applies EXIF orientation (important for mobile camera photos).
  if (typeof createImageBitmap === "function") {
    try {
      const bmp = await createImageBitmap(file, { imageOrientation: "from-image" } as ImageBitmapOptions);
      return { src: bmp, w: bmp.width, h: bmp.height, close: () => bmp.close() };
    } catch { /* Fall back to HTMLImageElement. */ }
  }

  const url = URL.createObjectURL(file);
  try {
    const img = await new Promise<HTMLImageElement>((resolve, reject) => {
      const element = new Image();
      element.onload = () => resolve(element);
      element.onerror = reject;
      element.src = url;
    });
    return { src: img, w: img.naturalWidth, h: img.naturalHeight, close: () => {} };
  } catch {
    return null;
  } finally {
    URL.revokeObjectURL(url);
  }
}

const lum = (data: Uint8ClampedArray, index: number) =>
  0.299 * data[index] + 0.587 * data[index + 1] + 0.114 * data[index + 2];

/** Conservative auto-levels: enhance low-contrast photos without burning paper or ink. */
function autoLevels(ctx: CanvasRenderingContext2D, width: number, height: number) {
  const image = ctx.getImageData(0, 0, width, height);
  const data = image.data;
  const histogram = new Uint32Array(256);
  let samples = 0;

  // One sample per four pixels keeps this bounded on high-resolution phone photos.
  for (let i = 0; i < data.length; i += 16) {
    histogram[Math.round(lum(data, i))]++;
    samples++;
  }

  let accumulated = 0;
  let low = 0;
  let high = 255;
  for (let value = 0; value < 256; value++) {
    accumulated += histogram[value];
    if (accumulated >= samples * 0.01) {
      low = value;
      break;
    }
  }

  accumulated = 0;
  for (let value = 255; value >= 0; value--) {
    accumulated += histogram[value];
    if (accumulated >= samples * 0.01) {
      high = value;
      break;
    }
  }

  const range = high - low;
  // Already good contrast, or nearly blank/flat image: leave it untouched.
  if (range >= 200 || range < 40) return;

  const gain = Math.min(255 / range, 1.6);
  for (let i = 0; i < data.length; i += 4) {
    data[i] = Math.max(0, Math.min(255, 255 - (high - data[i]) * gain));
    data[i + 1] = Math.max(0, Math.min(255, 255 - (high - data[i + 1]) * gain));
    data[i + 2] = Math.max(0, Math.min(255, 255 - (high - data[i + 2]) * gain));
  }
  ctx.putImageData(image, 0, 0);
}

/** Crop only uniform, bright blank margins; never guess at content boundaries. */
function blankMargins(ctx: CanvasRenderingContext2D, width: number, height: number) {
  const data = ctx.getImageData(0, 0, width, height).data;
  const step = 4;

  const lineStats = (fixed: number, vertical: boolean) => {
    let sum = 0;
    let sumSquares = 0;
    let count = 0;
    const length = vertical ? height : width;

    for (let offset = 0; offset < length; offset += step) {
      const x = vertical ? fixed : offset;
      const y = vertical ? offset : fixed;
      const value = lum(data, (y * width + x) * 4);
      sum += value;
      sumSquares += value * value;
      count++;
    }

    const mean = sum / count;
    return { mean, deviation: Math.sqrt(Math.max(0, sumSquares / count - mean * mean)) };
  };

  const isBlank = (fixed: number, vertical: boolean) => {
    const { mean, deviation } = lineStats(fixed, vertical);
    return deviation < 6 && mean > 200;
  };

  const maxX = Math.floor(width * 0.15);
  const maxY = Math.floor(height * 0.15);
  let left = 0;
  let right = 0;
  let top = 0;
  let bottom = 0;

  while (left < maxX && isBlank(left, true)) left++;
  while (right < maxX && isBlank(width - 1 - right, true)) right++;
  while (top < maxY && isBlank(top, false)) top++;
  while (bottom < maxY && isBlank(height - 1 - bottom, false)) bottom++;

  // Keep a small safety margin around the detected content.
  const marginX = Math.round(width * 0.015);
  const marginY = Math.round(height * 0.015);
  left = Math.max(0, left - marginX);
  right = Math.max(0, right - marginX);
  top = Math.max(0, top - marginY);
  bottom = Math.max(0, bottom - marginY);

  return {
    x: left,
    y: top,
    width: width - left - right,
    height: height - top - bottom,
  };
}

/** Returns a JPEG data URL ready for vision models, or null if decoding fails. */
export async function prepareImage(
  file: File,
  maxSide = MAX_SIDE,
  quality = QUALITY,
): Promise<string | null> {
  const decoded = await decode(file);
  if (!decoded) return null;

  try {
    const dimensions = getScaledImageDimensions(decoded.w, decoded.h, maxSide);
    const canvas = document.createElement("canvas");
    canvas.width = dimensions.width;
    canvas.height = dimensions.height;

    const context = canvas.getContext("2d", { willReadFrequently: true });
    if (!context) return null;

    context.imageSmoothingQuality = "high";
    context.drawImage(decoded.src, 0, 0, dimensions.width, dimensions.height);

    try {
      autoLevels(context, dimensions.width, dimensions.height);
      const crop = blankMargins(context, dimensions.width, dimensions.height);
      const hasMargins = crop.width < dimensions.width || crop.height < dimensions.height;

      // Reject aggressive crops: retain the complete sheet if content bounds are uncertain.
      if (
        hasMargins &&
        crop.width > dimensions.width * 0.5 &&
        crop.height > dimensions.height * 0.5
      ) {
        const output = document.createElement("canvas");
        output.width = crop.width;
        output.height = crop.height;
        const outputContext = output.getContext("2d");
        if (outputContext) {
          outputContext.imageSmoothingQuality = "high";
          outputContext.drawImage(
            canvas,
            crop.x, crop.y, crop.width, crop.height,
            0, 0, crop.width, crop.height,
          );
          return output.toDataURL("image/jpeg", quality);
        }
      }
    } catch (error) {
      console.warn("Image enhancement skipped; using the decoded image:", error);
    }

    return canvas.toDataURL("image/jpeg", quality);
  } catch {
    return null;
  } finally {
    decoded.close();
  }
}


export interface PreparedImageVariants {
  /** Full page image, retained to preserve the exercise's overall context. */
  original: string;
  /** At most two overlapping detail crops, selected only when they contain enough ink. */
  detailCrops: string[];
}

interface CropRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

/**
 * Split only the long axis into two overlapping regions. The original image is
 * always sent as well, so these crops improve small-text visibility without
 * removing the context needed to understand diagrams and question references.
 */
export function getDetailCropRects(width: number, height: number): CropRect[] {
  if (width < 1100 || height < 1100) return [];

  if (height >= width * 1.25) {
    const cropHeight = Math.round(height * 0.62);
    const overlapStart = Math.round(height * 0.38);
    return [
      { x: 0, y: 0, width, height: cropHeight },
      { x: 0, y: overlapStart, width, height: cropHeight },
    ];
  }

  if (width >= height * 1.25) {
    const cropWidth = Math.round(width * 0.62);
    const overlapStart = Math.round(width * 0.38);
    return [
      { x: 0, y: 0, width: cropWidth, height },
      { x: overlapStart, y: 0, width: cropWidth, height },
    ];
  }

  // Nearly square images are not tiled: avoid creating redundant crops.
  return [];
}

/** Fraction of sampled pixels that look like dark printed/handwritten content. */
function inkDensity(ctx: CanvasRenderingContext2D, rect: CropRect): number {
  const sample = ctx.getImageData(rect.x, rect.y, rect.width, rect.height).data;
  let ink = 0;
  let count = 0;
  for (let i = 0; i < sample.length; i += 64) {
    if (lum(sample, i) < 170) ink++;
    count++;
  }
  return count ? ink / count : 0;
}

async function loadPreparedDataUrl(dataUrl: string): Promise<HTMLImageElement | null> {
  try {
    return await new Promise<HTMLImageElement>((resolve, reject) => {
      const image = new Image();
      image.onload = () => resolve(image);
      image.onerror = reject;
      image.src = dataUrl;
    });
  } catch {
    return null;
  }
}

/**
 * Prepares the full image plus up to two detail crops for dense, high-resolution
 * exam sheets. Callers should display only original, not the internal crops.
 */
export async function prepareImageVariants(file: File): Promise<PreparedImageVariants | null> {
  const original = await prepareImage(file);
  if (!original) return null;

  const image = await loadPreparedDataUrl(original);
  if (!image) return { original, detailCrops: [] };

  const rects = getDetailCropRects(image.naturalWidth, image.naturalHeight);
  if (!rects.length) return { original, detailCrops: [] };

  const source = document.createElement("canvas");
  source.width = image.naturalWidth;
  source.height = image.naturalHeight;
  const sourceContext = source.getContext("2d", { willReadFrequently: true });
  if (!sourceContext) return { original, detailCrops: [] };
  sourceContext.drawImage(image, 0, 0);

  const detailCrops: string[] = [];
  for (const rect of rects) {
    try {
      // Skip blank/near-blank tiles so we do not inflate model input unnecessarily.
      if (inkDensity(sourceContext, rect) < 0.0035) continue;

      const cropCanvas = document.createElement("canvas");
      cropCanvas.width = rect.width;
      cropCanvas.height = rect.height;
      const cropContext = cropCanvas.getContext("2d");
      if (!cropContext) continue;
      cropContext.imageSmoothingQuality = "high";
      cropContext.drawImage(
        source,
        rect.x, rect.y, rect.width, rect.height,
        0, 0, rect.width, rect.height,
      );
      detailCrops.push(cropCanvas.toDataURL("image/jpeg", 0.92));
    } catch (error) {
      // A crop is an enhancement, never a reason to reject the original photo.
      console.warn("Detail crop skipped:", error);
    }
  }

  return { original, detailCrops };
}
