import { describe, expect, it } from "vitest";
import { detectPageCornerCandidate } from "./pageCornerDetection";

function makeImage(width: number, height: number, background = 30) {
  const data = new Uint8ClampedArray(width * height * 4);
  for (let i = 0; i < width * height; i++) {
    const p = i * 4;
    data[p] = background;
    data[p + 1] = background;
    data[p + 2] = background;
    data[p + 3] = 255;
  }
  return data;
}

function drawLine(data: Uint8ClampedArray, width: number, height: number, x1: number, y1: number, x2: number, y2: number) {
  const steps = Math.max(Math.abs(x2 - x1), Math.abs(y2 - y1));
  for (let i = 0; i <= steps; i++) {
    const x = Math.round(x1 + (x2 - x1) * i / steps);
    const y = Math.round(y1 + (y2 - y1) * i / steps);
    for (let dy = -1; dy <= 1; dy++) {
      for (let dx = -1; dx <= 1; dx++) {
        const px = x + dx, py = y + dy;
        if (px < 0 || py < 0 || px >= width || py >= height) continue;
        const p = (py * width + px) * 4;
        data[p] = data[p + 1] = data[p + 2] = 245;
      }
    }
  }
}

describe("detectPageCornerCandidate", () => {
  it("returns no candidate for a blank image", () => {
    const image = makeImage(240, 320, 220);
    expect(detectPageCornerCandidate(image, 240, 320)).toBeNull();
  });

  it("rejects malformed input and keeps auto-rectification disabled", () => {
    expect(detectPageCornerCandidate(new Uint8ClampedArray(10), 100, 100)).toBeNull();
    const image = makeImage(240, 320);
    drawLine(image, 240, 320, 35, 25, 205, 25);
    drawLine(image, 240, 320, 205, 25, 205, 295);
    drawLine(image, 240, 320, 205, 295, 35, 295);
    drawLine(image, 240, 320, 35, 295, 35, 25);
    const result = detectPageCornerCandidate(image, 240, 320);
    if (result) {
      expect(result.safeToAutoRectify).toBe(false);
      expect(result.score).toBeGreaterThan(0);
      expect(result.corners).toHaveLength(4);
    }
  });
});
