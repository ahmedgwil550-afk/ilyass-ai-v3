import { afterEach, describe, expect, it, vi } from "vitest";

const REQUIRED = [
  "Mat",
  "MatVector",
  "Size",
  "matFromImageData",
  "resize",
  "cvtColor",
  "GaussianBlur",
  "Canny",
  "getStructuringElement",
  "morphologyEx",
  "findContours",
  "approxPolyDP",
  "arcLength",
  "contourArea",
];

function fakeRuntime(omit: string[] = []): Record<string, any> {
  const runtime: Record<string, any> = {};
  for (const name of REQUIRED) {
    if (!omit.includes(name)) runtime[name] = function fake() {};
  }
  return runtime;
}

async function loadDetector(runtimeExport: unknown) {
  vi.resetModules();
  vi.doMock("@techstark/opencv-js", () => ({ default: runtimeExport }));
  return import("./opencvPageDetection");
}

afterEach(() => {
  vi.doUnmock("@techstark/opencv-js");
  vi.resetModules();
});

describe("OpenCV runtime loading", () => {
  it("loads a runtime that is already initialized", async () => {
    const detector = await loadDetector(fakeRuntime());

    expect(detector.isOpenCvReady()).toBe(false);
    await detector.preloadOpenCv();
    expect(detector.isOpenCvReady()).toBe(true);
  });

  it("loads a runtime exposed as a promise", async () => {
    const detector = await loadDetector(Promise.resolve(fakeRuntime()));

    await detector.preloadOpenCv();
    expect(detector.isOpenCvReady()).toBe(true);
  });

  it("does not hang when the runtime module itself has a then method", async () => {
    // Emscripten modules can resolve with themselves. Passing such an object to
    // resolve() or returning it from an async function would loop forever.
    const runtime = fakeRuntime();
    runtime.then = (onReady: (value: unknown) => void) => onReady(runtime);
    const detector = await loadDetector(runtime);

    await detector.preloadOpenCv();
    expect(detector.isOpenCvReady()).toBe(true);
  });

  it("waits for onRuntimeInitialized when the runtime finishes loading later", async () => {
    const runtime: Record<string, any> = {};
    const poll = setInterval(() => {
      if (typeof runtime.onRuntimeInitialized === "function") {
        clearInterval(poll);
        Object.assign(runtime, fakeRuntime());
        runtime.onRuntimeInitialized();
      }
    }, 5);
    const detector = await loadDetector(runtime);

    await detector.preloadOpenCv();
    expect(detector.isOpenCvReady()).toBe(true);
  });

  it("names the missing functions instead of failing later with a vague error", async () => {
    const detector = await loadDetector(fakeRuntime(["approxPolyDP", "Canny"]));

    await expect(detector.preloadOpenCv()).rejects.toThrow(/missing required APIs: Canny, approxPolyDP/);
    expect(detector.isOpenCvReady()).toBe(false);
  });
});
