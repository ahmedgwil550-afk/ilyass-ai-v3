import { describe, expect, it } from "vitest";
import { detectPageBoundaries } from "./opencvPageDetection";

describe("detectPageBoundaries input validation", () => {
  it("rejects malformed pixel buffers without loading the WASM runtime", async () => {
    const malformed = {
      width: 100,
      height: 100,
      data: new Uint8ClampedArray(12),
    } as ImageData;

    await expect(detectPageBoundaries(malformed)).resolves.toBeNull();
  });

  it("rejects images too small for reliable page-boundary analysis", async () => {
    const tiny = {
      width: 64,
      height: 64,
      data: new Uint8ClampedArray(64 * 64 * 4),
    } as ImageData;

    await expect(detectPageBoundaries(tiny)).resolves.toBeNull();
  });
});
