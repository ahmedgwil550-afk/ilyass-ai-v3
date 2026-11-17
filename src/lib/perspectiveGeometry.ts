export interface Point2D {
  x: number;
  y: number;
}

export type Quadrilateral = [Point2D, Point2D, Point2D, Point2D];
export type Homography = [number, number, number, number, number, number, number, number, number];

const EPSILON = 1e-9;

function cross(a: Point2D, b: Point2D, c: Point2D): number {
  return (b.x - a.x) * (c.y - b.y) - (b.y - a.y) * (c.x - b.x);
}

function distance(a: Point2D, b: Point2D): number {
  return Math.hypot(b.x - a.x, b.y - a.y);
}

export function polygonArea(points: readonly Point2D[]): number {
  if (points.length < 3) return 0;
  let twiceArea = 0;
  for (let i = 0; i < points.length; i++) {
    const current = points[i];
    const next = points[(i + 1) % points.length];
    twiceArea += current.x * next.y - next.x * current.y;
  }
  return Math.abs(twiceArea) / 2;
}

/**
 * Orders four detected corners clockwise in image coordinates, starting at
 * the top-left. Returns null for duplicate, non-finite, or non-convex points.
 */
export function orderQuadrilateral(points: readonly Point2D[]): Quadrilateral | null {
  if (points.length !== 4 || points.some((p) => !Number.isFinite(p.x) || !Number.isFinite(p.y))) {
    return null;
  }

  for (let i = 0; i < 4; i++) {
    for (let j = i + 1; j < 4; j++) {
      if (distance(points[i], points[j]) < EPSILON) return null;
    }
  }

  const center = points.reduce(
    (sum, point) => ({ x: sum.x + point.x / 4, y: sum.y + point.y / 4 }),
    { x: 0, y: 0 },
  );
  const sorted = [...points].sort(
    (a, b) => Math.atan2(a.y - center.y, a.x - center.x) -
      Math.atan2(b.y - center.y, b.x - center.x),
  );

  // In screen coordinates (y grows down), angular order is clockwise.
  const startIndex = sorted.reduce(
    (best, point, index) =>
      point.x + point.y < sorted[best].x + sorted[best].y ? index : best,
    0,
  );
  const ordered = [...sorted.slice(startIndex), ...sorted.slice(0, startIndex)] as Quadrilateral;

  const turns = ordered.map((point, index) =>
    cross(point, ordered[(index + 1) % 4], ordered[(index + 2) % 4]),
  );
  if (turns.some((turn) => Math.abs(turn) < EPSILON)) return null;
  if (!turns.every((turn) => turn > 0) && !turns.every((turn) => turn < 0)) return null;

  // Ensure the expected top-left, top-right, bottom-right, bottom-left order.
  if (ordered[1].x < ordered[3].x) {
    return [ordered[0], ordered[3], ordered[2], ordered[1]];
  }
  return ordered;
}

/** Conservative geometry gate; it does not attempt to detect page corners. */
export function isUsablePageQuadrilateral(
  points: readonly Point2D[],
  imageWidth: number,
  imageHeight: number,
  minAreaRatio = 0.08,
): points is Quadrilateral {
  if (
    !Number.isFinite(imageWidth) || !Number.isFinite(imageHeight) ||
    imageWidth <= 0 || imageHeight <= 0 ||
    !Number.isFinite(minAreaRatio) || minAreaRatio <= 0 || minAreaRatio >= 1
  ) return false;

  const ordered = orderQuadrilateral(points);
  if (!ordered) return false;
  const tolerance = Math.max(imageWidth, imageHeight) * 0.002;
  if (ordered.some((p) =>
    p.x < -tolerance || p.y < -tolerance ||
    p.x > imageWidth + tolerance || p.y > imageHeight + tolerance
  )) return false;

  const areaRatio = polygonArea(ordered) / (imageWidth * imageHeight);
  if (areaRatio < minAreaRatio || areaRatio > 0.995) return false;

  const shortestEdge = Math.min(
    ...ordered.map((point, index) => distance(point, ordered[(index + 1) % 4])),
  );
  return shortestEdge >= Math.min(imageWidth, imageHeight) * 0.04;
}

function solveLinearSystem(matrix: number[][], values: number[]): number[] | null {
  const size = values.length;
  const augmented = matrix.map((row, index) => [...row, values[index]]);

  for (let column = 0; column < size; column++) {
    let pivot = column;
    for (let row = column + 1; row < size; row++) {
      if (Math.abs(augmented[row][column]) > Math.abs(augmented[pivot][column])) pivot = row;
    }
    if (Math.abs(augmented[pivot][column]) < EPSILON) return null;

    [augmented[column], augmented[pivot]] = [augmented[pivot], augmented[column]];
    const divisor = augmented[column][column];
    for (let j = column; j <= size; j++) augmented[column][j] /= divisor;

    for (let row = 0; row < size; row++) {
      if (row === column) continue;
      const factor = augmented[row][column];
      for (let j = column; j <= size; j++) {
        augmented[row][j] -= factor * augmented[column][j];
      }
    }
  }

  const solution = augmented.map((row) => row[size]);
  return solution.every(Number.isFinite) ? solution : null;
}

/**
 * Computes a source-to-destination projective transform from four
 * corresponding corners. Returns null for singular or unstable inputs.
 */
export function computeHomography(
  source: Quadrilateral,
  destination: Quadrilateral,
): Homography | null {
  const matrix: number[][] = [];
  const values: number[] = [];

  for (let i = 0; i < 4; i++) {
    const { x, y } = source[i];
    const { x: u, y: v } = destination[i];
    if (![x, y, u, v].every(Number.isFinite)) return null;

    matrix.push([x, y, 1, 0, 0, 0, -u * x, -u * y]);
    values.push(u);
    matrix.push([0, 0, 0, x, y, 1, -v * x, -v * y]);
    values.push(v);
  }

  const solved = solveLinearSystem(matrix, values);
  if (!solved) return null;
  return [...solved, 1] as Homography;
}

/** Maps one point through a homography; null means the point is at infinity. */
export function transformPoint(point: Point2D, transform: Homography): Point2D | null {
  const [h0, h1, h2, h3, h4, h5, h6, h7, h8] = transform;
  const denominator = h6 * point.x + h7 * point.y + h8;
  if (!Number.isFinite(denominator) || Math.abs(denominator) < EPSILON) return null;

  const x = (h0 * point.x + h1 * point.y + h2) / denominator;
  const y = (h3 * point.x + h4 * point.y + h5) / denominator;
  return Number.isFinite(x) && Number.isFinite(y) ? { x, y } : null;
}
