import { describe, expect, it } from "vitest";
import { getContainGeometry, getCoverCropRect, getCoverGeometry } from "./cameraOverlayGeometry";

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

describe("getCoverGeometry", () => {
  it("fills a portrait screen with a portrait image and crops only the overflow", () => {
    const g = getCoverGeometry(1080, 1920, 390, 844)!;
    expect(g.scale).toBeCloseTo(844 / 1920, 10); // height is the tight side
    expect(g.offsetY).toBeCloseTo(0, 10);
    expect(g.offsetX).toBeLessThan(0);
    // Nothing is left empty: the scaled image covers the viewport on both axes.
    expect(1080 * g.scale + 2 * g.offsetX).toBeCloseTo(390, 6);
    expect(g.visible.width).toBeCloseTo(390 / g.scale, 6);
    expect(g.visible.height).toBeCloseTo(1920, 6);
  });

  it("fills a portrait screen with a landscape image by cropping the sides, with no bars", () => {
    const g = getCoverGeometry(1920, 1080, 390, 844)!;
    expect(g.scale).toBeCloseTo(844 / 1080, 10);
    expect(g.offsetY).toBeCloseTo(0, 10);
    expect(g.visible.height).toBeCloseTo(1080, 6);
    expect(g.visible.width).toBeCloseTo(390 / g.scale, 6);
    expect(g.visible.x).toBeCloseTo((1920 - g.visible.width) / 2, 6);
  });

  it("has no crop and no offset when the aspect ratios match", () => {
    const g = getCoverGeometry(1080, 1920, 540, 960)!;
    expect(g.scale).toBeCloseTo(0.5, 10);
    expect(Math.abs(g.offsetX)).toBeLessThan(1e-9);
    expect(Math.abs(g.offsetY)).toBeLessThan(1e-9);
    expect(g.visible).toEqual({ x: 0, y: 0, width: 1080, height: 1920 });
  });

  it("maps the corners of the visible region exactly to the corners of the viewport", () => {
    const g = getCoverGeometry(1920, 1080, 390, 844)!;
    const toScreen = (x: number, y: number) => ({ x: x * g.scale + g.offsetX, y: y * g.scale + g.offsetY });
    const topLeft = toScreen(g.visible.x, g.visible.y);
    const bottomRight = toScreen(g.visible.x + g.visible.width, g.visible.y + g.visible.height);
    expect(topLeft.x).toBeCloseTo(0, 6);
    expect(topLeft.y).toBeCloseTo(0, 6);
    expect(bottomRight.x).toBeCloseTo(390, 6);
    expect(bottomRight.y).toBeCloseTo(844, 6);
  });

  it("rejects zero and non-finite dimensions", () => {
    expect(getCoverGeometry(0, 1080, 400, 800)).toBeNull();
    expect(getCoverGeometry(1920, 1080, 400, Number.NaN)).toBeNull();
    expect(getCoverGeometry(1920, 1080, -1, 800)).toBeNull();
  });
});

describe("getCoverCropRect", () => {
  it("cuts the part of the frame that was on screen", () => {
    const rect = getCoverCropRect(1920, 1080, 390, 844)!;
    expect(rect.sy).toBe(0);
    expect(rect.sh).toBe(1080);
    expect(rect.sw).toBe(Math.round((1080 * 390) / 844));
    expect(rect.sx).toBe(Math.round((1920 - (1080 * 390) / 844) / 2));
  });

  it("keeps the whole frame when nothing is cropped", () => {
    expect(getCoverCropRect(1080, 1920, 540, 960)).toEqual({ sx: 0, sy: 0, sw: 1080, sh: 1920 });
  });

  it("always stays inside the frame, whatever the viewport", () => {
    for (const [iw, ih] of [[1920, 1080], [1080, 1920], [1280, 720], [640, 480]]) {
      for (const [vw, vh] of [[390, 844], [844, 390], [1024, 768], [320, 2000], [2000, 320], [1, 1]]) {
        const r = getCoverCropRect(iw, ih, vw, vh)!;
        expect(r.sx).toBeGreaterThanOrEqual(0);
        expect(r.sy).toBeGreaterThanOrEqual(0);
        expect(r.sw).toBeGreaterThanOrEqual(1);
        expect(r.sh).toBeGreaterThanOrEqual(1);
        expect(r.sx + r.sw).toBeLessThanOrEqual(iw);
        expect(r.sy + r.sh).toBeLessThanOrEqual(ih);
        // The cut has the viewport's shape (within a pixel of rounding).
        expect(Math.abs(r.sw / r.sh - vw / vh)).toBeLessThan(Math.max(1.5 / r.sh, 1.5 / r.sw) * (vw / vh + 1));
      }
    }
  });

  it("returns null for unusable sizes so the caller keeps the whole frame", () => {
    expect(getCoverCropRect(0, 0, 390, 844)).toBeNull();
    expect(getCoverCropRect(1920, 1080, 0, 0)).toBeNull();
  });
});
