export interface ContainGeometry {
  scale: number;
  offsetX: number;
  offsetY: number;
}

const isUsable = (...values: number[]) => values.every((value) => Number.isFinite(value) && value > 0);

/** Maps image coordinates into a viewport using the same fit as object-contain. */
export function getContainGeometry(
  imageWidth: number,
  imageHeight: number,
  viewportWidth: number,
  viewportHeight: number,
): ContainGeometry | null {
  if (!isUsable(imageWidth, imageHeight, viewportWidth, viewportHeight)) return null;

  const scale = Math.min(viewportWidth / imageWidth, viewportHeight / imageHeight);
  return {
    scale,
    offsetX: (viewportWidth - imageWidth * scale) / 2,
    offsetY: (viewportHeight - imageHeight * scale) / 2,
  };
}

export interface CoverGeometry extends ContainGeometry {
  /** The part of the image that is on screen, in image pixels. */
  visible: { x: number; y: number; width: number; height: number };
}

/**
 * Maps image coordinates into a viewport using the same fit as object-cover (centred):
 * the image fills the whole viewport and the overflow is cropped, so there are no bars.
 * Offsets are zero or negative, and `visible` is what the student actually sees.
 */
export function getCoverGeometry(
  imageWidth: number,
  imageHeight: number,
  viewportWidth: number,
  viewportHeight: number,
): CoverGeometry | null {
  if (!isUsable(imageWidth, imageHeight, viewportWidth, viewportHeight)) return null;

  const scale = Math.max(viewportWidth / imageWidth, viewportHeight / imageHeight);
  const offsetX = (viewportWidth - imageWidth * scale) / 2;
  const offsetY = (viewportHeight - imageHeight * scale) / 2;
  return {
    scale,
    offsetX,
    offsetY,
    visible: {
      x: Math.max(0, -offsetX / scale),
      y: Math.max(0, -offsetY / scale),
      width: Math.min(imageWidth, viewportWidth / scale),
      height: Math.min(imageHeight, viewportHeight / scale),
    },
  };
}

export interface CropRect {
  sx: number;
  sy: number;
  sw: number;
  sh: number;
}

/**
 * Whole-pixel crop of the visible part of the image, always inside the image.
 * A capture cut with it matches what the preview showed. Null means "keep the whole frame".
 */
export function getCoverCropRect(
  imageWidth: number,
  imageHeight: number,
  viewportWidth: number,
  viewportHeight: number,
): CropRect | null {
  const geometry = getCoverGeometry(imageWidth, imageHeight, viewportWidth, viewportHeight);
  if (!geometry) return null;
  const sx = Math.min(imageWidth - 1, Math.max(0, Math.round(geometry.visible.x)));
  const sy = Math.min(imageHeight - 1, Math.max(0, Math.round(geometry.visible.y)));
  const sw = Math.max(1, Math.min(imageWidth - sx, Math.round(geometry.visible.width)));
  const sh = Math.max(1, Math.min(imageHeight - sy, Math.round(geometry.visible.height)));
  return { sx, sy, sw, sh };
}
