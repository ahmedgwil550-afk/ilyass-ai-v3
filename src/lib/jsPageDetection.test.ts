import { describe, expect, it } from "vitest";
import { detectPageBoundariesJs } from "./jsPageDetection";
import type { Point2D } from "./perspectiveGeometry";

function pointInPolygon(x: number, y: number, polygon: Point2D[]): boolean {
  let inside = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const a = polygon[i];
    const b = polygon[j];
    if (a.y > y !== b.y > y && x < ((b.x - a.x) * (y - a.y)) / (b.y - a.y) + a.x) {
      inside = !inside;
    }
  }
  return inside;
}

interface FrameOptions {
  width: number;
  height: number;
  background?: number;
  page?: Point2D[];
  pageValue?: number;
  /** Dark horizontal rules drawn on the page, like ruled paper. */
  rulingEvery?: number;
  noise?: number;
}

/** Builds a deterministic RGBA frame: a bright polygon on a darker surface. */
function makeFrame({
  width,
  height,
  background = 30,
  page,
  pageValue = 215,
  rulingEvery = 0,
  noise = 0,
}: FrameOptions): ImageData {
  const data = new Uint8ClampedArray(width * height * 4);
  let seed = 12345;
  const random = () => {
    seed = (seed * 1664525 + 1013904223) % 4294967296;
    return seed / 4294967296;
  };

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      let value = background;
      if (page && pointInPolygon(x + 0.5, y + 0.5, page)) {
        value = pageValue;
        if (rulingEvery && y % rulingEvery < 2) value = 100;
      }
      value += (random() - 0.5) * 2 * noise;
      const index = (y * width + x) * 4;
      data[index] = value;
      data[index + 1] = value;
      data[index + 2] = value;
      data[index + 3] = 255;
    }
  }
  return { width, height, data } as ImageData;
}

function maxCornerError(found: Point2D[], expected: Point2D[]): number {
  return Math.max(...found.map((point, index) =>
    Math.hypot(point.x - expected[index].x, point.y - expected[index].y),
  ));
}

const TILTED_PAGE: Point2D[] = [
  { x: 80, y: 50 },
  { x: 330, y: 70 },
  { x: 320, y: 260 },
  { x: 70, y: 240 },
];

describe("detectPageBoundariesJs", () => {
  it("finds a tilted bright sheet on a dark surface", () => {
    const frame = makeFrame({ width: 400, height: 300, page: TILTED_PAGE });
    const detection = detectPageBoundariesJs(frame);

    expect(detection?.candidates.length).toBeGreaterThan(0);
    const best = detection!.candidates[0];
    expect(best.source).toBe("js");
    expect(best.requiresConfirmation).toBe(true);
    // Corners come back in image pixels, ordered top-left, top-right, bottom-right, bottom-left.
    expect(maxCornerError(best.corners, TILTED_PAGE)).toBeLessThan(0.03 * Math.hypot(400, 300));
  });

  it("still finds the sheet with ruled lines and sensor noise on it", () => {
    const frame = makeFrame({
      width: 400,
      height: 300,
      page: TILTED_PAGE,
      rulingEvery: 12,
      noise: 12,
    });
    const detection = detectPageBoundariesJs(frame);

    expect(detection?.candidates.length).toBeGreaterThan(0);
    expect(maxCornerError(detection!.candidates[0].corners, TILTED_PAGE))
      .toBeLessThan(0.04 * Math.hypot(400, 300));
  });

  it("returns corners in the coordinates of a larger input frame", () => {
    const scaled = TILTED_PAGE.map((point) => ({ x: point.x * 2, y: point.y * 2 }));
    const frame = makeFrame({ width: 800, height: 600, page: scaled });
    const detection = detectPageBoundariesJs(frame);

    expect(detection?.candidates.length).toBeGreaterThan(0);
    expect(maxCornerError(detection!.candidates[0].corners, scaled))
      .toBeLessThan(0.03 * Math.hypot(800, 600));
  });

  it("accepts a sheet that runs off the bottom of the frame", () => {
    const page: Point2D[] = [
      { x: 60, y: 40 },
      { x: 340, y: 40 },
      { x: 340, y: 299 },
      { x: 60, y: 299 },
    ];
    const frame = makeFrame({ width: 400, height: 300, page });
    const detection = detectPageBoundariesJs(frame);

    expect(detection?.candidates.length).toBeGreaterThan(0);
    const [topLeft, , bottomRight] = detection!.candidates[0].corners;
    expect(topLeft.y).toBeLessThan(55);
    expect(bottomRight.y).toBeGreaterThan(285);
  });

  it("reports no sheet for a flat noisy frame", () => {
    const frame = makeFrame({ width: 400, height: 300, background: 120, noise: 5 });
    expect(detectPageBoundariesJs(frame)?.candidates).toEqual([]);
  });

  it("ignores a bright patch that is too small to be a sheet", () => {
    const patch: Point2D[] = [
      { x: 100, y: 100 },
      { x: 130, y: 100 },
      { x: 130, y: 130 },
      { x: 100, y: 130 },
    ];
    const frame = makeFrame({ width: 400, height: 300, page: patch });
    expect(detectPageBoundariesJs(frame)?.candidates).toEqual([]);
  });

  it("rejects malformed and too-small images", () => {
    const malformed = { width: 100, height: 100, data: new Uint8ClampedArray(12) } as ImageData;
    const tiny = { width: 64, height: 64, data: new Uint8ClampedArray(64 * 64 * 4) } as ImageData;

    expect(detectPageBoundariesJs(malformed)).toBeNull();
    expect(detectPageBoundariesJs(tiny)).toBeNull();
  });
});
