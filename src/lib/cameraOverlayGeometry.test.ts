import { describe, expect, it } from "vitest";
import { getContainGeometry } from "./cameraOverlayGeometry";

describe("getContainGeometry", () => {
  it("centers a portrait camera image in a wider preview", () => {
    expect(getContainGeometry(1080, 1920, 390, 700)).toEqual({
      scale: 390 / 1080,
      offsetX: 0,
      offsetY: (700 - (1920 * 390) / 1080) / 2,
    });
  });

  it("centers a landscape camera image in a taller preview", () => {
    expect(getContainGeometry(1920, 1080, 400, 800)).toEqual({
      scale: 400 / 1920,
      offsetX: 0,
      offsetY: (800 - (1080 * 400) / 1920) / 2,
    });
  });

  it("rejects zero and non-finite dimensions", () => {
    expect(getContainGeometry(0, 1080, 400, 800)).toBeNull();
    expect(getContainGeometry(1920, Number.NaN, 400, 800)).toBeNull();
  });
});