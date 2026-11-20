import { describe, expect, it } from "vitest";
import { getDetailCropRects, getScaledImageDimensions, scalePageBoundaryDetection } from "./imagePrep";
import type { PageBoundaryDetection } from "./opencvPageDetection";

describe("getScaledImageDimensions", () => {
  it("keeps small images at their original dimensions", () => {
    expect(getScaledImageDimensions(1200, 800)).toEqual({ width: 1200, height: 800 });
  });

  it("scales a large portrait image without changing its aspect ratio", () => {
    expect(getScaledImageDimensions(3000, 4500, 2560)).toEqual({ width: 1707, height: 2560 });
  });

  it("scales a large landscape image to the maximum side", () => {
    expect(getScaledImageDimensions(4032, 3024, 2560)).toEqual({ width: 2560, height: 1920 });
  });

  it("never upscales an image", () => {
    expect(getScaledImageDimensions(320, 240, 2560)).toEqual({ width: 320, height: 240 });
  });

  it("rejects invalid dimensions", () => {
    expect(() => getScaledImageDimensions(0, 800)).toThrow(RangeError);
    expect(() => getScaledImageDimensions(1200, Number.NaN)).toThrow(RangeError);
    expect(() => getScaledImageDimensions(1200, 800, -1)).toThrow(RangeError);
  });
});

describe("getDetailCropRects", () => {
  it("creates two overlapping vertical crops for a tall exam sheet", () => {
    const crops = getDetailCropRects(1600, 2560);
    expect(crops).toHaveLength(2);
    expect(crops[0]).toEqual({ x: 0, y: 0, width: 1600, height: 1587 });
    expect(crops[1]).toEqual({ x: 0, y: 973, width: 1600, height: 1587 });
    expect(crops[1].y).toBeLessThan(crops[0].height);
  });

  it("creates two overlapping horizontal crops for a wide sheet", () => {
    const crops = getDetailCropRects(2560, 1600);
    expect(crops).toHaveLength(2);
    expect(crops[0].width).toBe(1587);
    expect(crops[1].x).toBe(973);
  });

  it("does not create crops for small images", () => {
    expect(getDetailCropRects(900, 1400)).toEqual([]);
  });

  it("does not create redundant crops for nearly square images", () => {
    expect(getDetailCropRects(1600, 1500)).toEqual([]);
  });
});

describe("scalePageBoundaryDetection", () => {
  const detection: PageBoundaryDetection = {
    candidates: [{
      corners: [
        { x: 10, y: 20 },
        { x: 110, y: 20 },
        { x: 110, y: 180 },
        { x: 10, y: 180 },
      ],
      score: 0.7,
      edgeSupport: 0.9,
      rectangularity: 0.95,
      areaRatio: 0.5,
      requiresConfirmation: true,
      source: "js",
    }],
    analysisWidth: 256,
    analysisHeight: 192,
  };

  it("moves the corners from the analysed copy to the full-size image", () => {
    const scaled = scalePageBoundaryDetection(detection, 4);

    expect(scaled.candidates[0].corners).toEqual([
      { x: 40, y: 80 },
      { x: 440, y: 80 },
      { x: 440, y: 720 },
      { x: 40, y: 720 },
    ]);
    expect(scaled.candidates[0].score).toBe(0.7);
  });

  it("returns the detection untouched when the image was not shrunk", () => {
    expect(scalePageBoundaryDetection(detection, 1)).toBe(detection);
  });
});
