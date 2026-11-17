export interface ContainGeometry {
  scale: number;
  offsetX: number;
  offsetY: number;
}

/** Maps image coordinates into a viewport using the same fit as object-contain. */
export function getContainGeometry(
  imageWidth: number,
  imageHeight: number,
  viewportWidth: number,
  viewportHeight: number,
): ContainGeometry | null {
  if (
    ![imageWidth, imageHeight, viewportWidth, viewportHeight].every(Number.isFinite) ||
    imageWidth <= 0 || imageHeight <= 0 || viewportWidth <= 0 || viewportHeight <= 0
  ) return null;

  const scale = Math.min(viewportWidth / imageWidth, viewportHeight / imageHeight);
  return {
    scale,
    offsetX: (viewportWidth - imageWidth * scale) / 2,
    offsetY: (viewportHeight - imageHeight * scale) / 2,
  };
}