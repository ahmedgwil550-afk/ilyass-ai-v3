import { describe, expect, it } from "vitest";
import {
  getRectifiedDimensions,
} from "./perspectiveRectification";
import type { Quadrilateral } from "./perspectiveGeometry";

const rectangle: Quadrilateral = [
  { x: 10, y: 10 },
  { x: 610, y: 10 },
  { x: 610, y: 810 },
  { x: 10, y: 810 },
];

describe("getRectifiedDimensions", () => {
  it("preserves the measured page aspect ratio", () => {
    expect(getRectifiedDimensions(rectangle)).toEqual({ width: 600, height: 800 });
  });

  it("caps output dimensions without upscaling", () => {
    const large: Quadrilateral = [
      { x: 0, y: 0 },
      { x: 4000, y: 0 },
      { x: 4000, y: 6000 },
      { x: 0, y: 6000 },
    ];
    expect(getRectifiedDimensions(large, 1600)).toEqual({ width: 1067, height: 1600 });
    expect(getRectifiedDimensions(large, 9000)).toEqual({ width: 1200, height: 1800 });
  });

  it("rejects invalid caps and implausibly thin page shapes", () => {
    expect(getRectifiedDimensions(rectangle, 32)).toBeNull();
    const thin: Quadrilateral = [
      { x: 0, y: 0 },
      { x: 1000, y: 0 },
      { x: 1000, y: 100 },
      { x: 0, y: 100 },
    ];
    expect(getRectifiedDimensions(thin)).toBeNull();
  });
});
