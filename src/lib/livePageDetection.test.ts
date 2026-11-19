import { describe, expect, it, vi } from "vitest";
import { detectLivePage, smoothCorners, type LivePageDetectors } from "./livePageDetection";
import type { PageBoundaryCandidate, PageBoundaryDetection } from "./opencvPageDetection";
import type { Quadrilateral } from "./perspectiveGeometry";

const image = { width: 200, height: 200, data: new Uint8ClampedArray(200 * 200 * 4) } as ImageData;

function candidate(source: "opencv" | "js"): PageBoundaryCandidate {
  return {
    corners: [
      { x: 10, y: 10 },
      { x: 190, y: 10 },
      { x: 190, y: 190 },
      { x: 10, y: 190 },
    ],
    score: 0.8,
    edgeSupport: 0.8,
    rectangularity: 0.95,
    areaRatio: 0.81,
    requiresConfirmation: true,
    source,
  };
}

function detection(...candidates: PageBoundaryCandidate[]): PageBoundaryDetection {
  return { candidates, analysisWidth: 200, analysisHeight: 200 };
}

function detectors(overrides: Partial<LivePageDetectors> = {}): LivePageDetectors {
  return {
    opencvReady: () => true,
    opencv: vi.fn(async () => detection(candidate("opencv"))),
    js: vi.fn(() => detection(candidate("js"))),
    ...overrides,
  };
}

describe("detectLivePage", () => {
  it("uses OpenCV once it is ready and finds the sheet", async () => {
    const set = detectors();
    const result = await detectLivePage(image, set);

    expect(result.engine).toBe("opencv");
    expect(result.candidate?.source).toBe("opencv");
    expect(set.js).not.toHaveBeenCalled();
  });

  it("does not wait for OpenCV while it is still loading", async () => {
    const set = detectors({ opencvReady: () => false });
    const result = await detectLivePage(image, set);

    expect(result.engine).toBe("js");
    expect(result.candidate?.source).toBe("js");
    expect(set.opencv).not.toHaveBeenCalled();
  });

  it("falls back to the built-in detector and reports the error when OpenCV throws", async () => {
    const failure = new Error("cv.something is not a function");
    const set = detectors({ opencv: vi.fn(async () => { throw failure; }) });
    const result = await detectLivePage(image, set);

    expect(result.engine).toBe("js");
    expect(result.candidate).not.toBeNull();
    expect(result.opencvError).toBe(failure);
  });

  it("falls back when OpenCV runs but finds no sheet", async () => {
    const set = detectors({ opencv: vi.fn(async () => detection()) });
    const result = await detectLivePage(image, set);

    expect(result.engine).toBe("js");
    expect(result.opencvError).toBeNull();
  });

  it("reports no sheet when neither detector finds one", async () => {
    const set = detectors({
      opencv: vi.fn(async () => detection()),
      js: vi.fn(() => detection()),
    });
    const result = await detectLivePage(image, set);

    expect(result.candidate).toBeNull();
    expect(result.engine).toBeNull();
  });

  it("lets an error from the built-in detector reach the caller", async () => {
    const set = detectors({
      opencvReady: () => false,
      js: vi.fn(() => { throw new Error("boom"); }),
    });

    await expect(detectLivePage(image, set)).rejects.toThrow("boom");
  });
});

describe("smoothCorners", () => {
  const previous: Quadrilateral = [
    { x: 0, y: 0 },
    { x: 100, y: 0 },
    { x: 100, y: 100 },
    { x: 0, y: 100 },
  ];

  it("returns the new corners when there is no previous frame", () => {
    expect(smoothCorners(null, previous, { resetDistance: 50 })).toBe(previous);
  });

  it("glides part of the way toward a small movement", () => {
    const next: Quadrilateral = previous.map((point) => ({ x: point.x + 10, y: point.y + 20 })) as Quadrilateral;
    const smoothed = smoothCorners(previous, next, { alpha: 0.5, resetDistance: 50 });

    expect(smoothed[0]).toEqual({ x: 5, y: 10 });
    expect(smoothed[2]).toEqual({ x: 105, y: 110 });
  });

  it("snaps to a different sheet instead of dragging the frame across the screen", () => {
    const next: Quadrilateral = previous.map((point) => ({ x: point.x + 300, y: point.y })) as Quadrilateral;

    expect(smoothCorners(previous, next, { alpha: 0.5, resetDistance: 50 })).toBe(next);
  });
});
