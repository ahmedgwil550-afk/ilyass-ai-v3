import { describe, expect, it } from "vitest";
import {
  computeHomography,
  isUsablePageQuadrilateral,
  orderQuadrilateral,
  polygonArea,
  transformPoint,
  type Quadrilateral,
} from "./perspectiveGeometry";

const rectangle: Quadrilateral = [
  { x: 0, y: 0 },
  { x: 100, y: 0 },
  { x: 100, y: 200 },
  { x: 0, y: 200 },
];

describe("orderQuadrilateral", () => {
  it("orders shuffled corners clockwise from the top-left", () => {
    expect(orderQuadrilateral([rectangle[2], rectangle[0], rectangle[3], rectangle[1]])).toEqual(rectangle);
  });

  it("rejects missing, duplicate, and non-finite points", () => {
    expect(orderQuadrilateral(rectangle.slice(0, 3))).toBeNull();
    expect(orderQuadrilateral([rectangle[0], rectangle[0], rectangle[2], rectangle[3]])).toBeNull();
    expect(orderQuadrilateral([{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 1, y: Number.NaN }, { x: 0, y: 1 }])).toBeNull();
  });

  it("rejects a concave set of corners", () => {
    expect(orderQuadrilateral([
      { x: 0, y: 0 }, { x: 100, y: 0 }, { x: 30, y: 30 }, { x: 0, y: 100 },
    ])).toBeNull();
  });
});

describe("isUsablePageQuadrilateral", () => {
  it("accepts a page-shaped quadrilateral within the image", () => {
    expect(isUsablePageQuadrilateral([
      { x: 30, y: 20 }, { x: 370, y: 35 }, { x: 350, y: 480 }, { x: 15, y: 460 },
    ], 400, 500)).toBe(true);
  });

  it("rejects tiny, out-of-frame, and invalid detections", () => {
    expect(isUsablePageQuadrilateral([
      { x: 100, y: 100 }, { x: 120, y: 100 }, { x: 120, y: 120 }, { x: 100, y: 120 },
    ], 400, 500)).toBe(false);
    expect(isUsablePageQuadrilateral([
      { x: -100, y: 0 }, { x: 300, y: 0 }, { x: 300, y: 450 }, { x: -100, y: 450 },
    ], 400, 500)).toBe(false);
    expect(isUsablePageQuadrilateral([], 400, 500)).toBe(false);
  });
});

describe("homography", () => {
  it("maps rectangle corners to a destination rectangle", () => {
    const destination: Quadrilateral = [
      { x: 0, y: 0 }, { x: 300, y: 0 }, { x: 300, y: 600 }, { x: 0, y: 600 },
    ];
    const transform = computeHomography(rectangle, destination);
    expect(transform).not.toBeNull();
    rectangle.forEach((point, index) => {
      const mapped = transformPoint(point, transform!);
      expect(mapped?.x).toBeCloseTo(destination[index].x, 7);
      expect(mapped?.y).toBeCloseTo(destination[index].y, 7);
    });
  });

  it("maps a skewed page's four corners to a flat rectangle", () => {
    const skewed: Quadrilateral = [
      { x: 35, y: 15 }, { x: 270, y: 40 }, { x: 245, y: 360 }, { x: 10, y: 330 },
    ];
    const flat: Quadrilateral = [
      { x: 0, y: 0 }, { x: 240, y: 0 }, { x: 240, y: 330 }, { x: 0, y: 330 },
    ];
    const transform = computeHomography(skewed, flat);
    expect(transform).not.toBeNull();
    skewed.forEach((point, index) => {
      const mapped = transformPoint(point, transform!);
      expect(mapped?.x).toBeCloseTo(flat[index].x, 6);
      expect(mapped?.y).toBeCloseTo(flat[index].y, 6);
    });
  });

  it("returns null for a singular transform and points at infinity", () => {
    const degenerate: Quadrilateral = [
      { x: 0, y: 0 }, { x: 1, y: 0 }, { x: 2, y: 0 }, { x: 3, y: 0 },
    ];
    expect(computeHomography(degenerate, rectangle)).toBeNull();
    expect(transformPoint({ x: 0, y: 0 }, [1, 0, 0, 0, 1, 0, 1, 0, 0])).toBeNull();
  });
});

describe("polygonArea", () => {
  it("calculates area independently of point winding", () => {
    expect(polygonArea(rectangle)).toBe(20000);
    expect(polygonArea([...rectangle].reverse())).toBe(20000);
  });
});
