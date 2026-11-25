import { describe, expect, it } from "vitest";
import { MAX_Z, MIN_Z, clampZoom, fitAll, pinch, wheelZoomSpeed, zoomAt } from "@/lib/canvas-view";

/** Where a point of the drawing lands on screen. */
const onScreen = (v: { x: number; y: number; z: number }, dx: number, dy: number) => ({ x: v.x + dx * v.z, y: v.y + dy * v.z });

describe("zooming", () => {
  it("keeps the spot under the cursor still", () => {
    const v = { x: 100, y: 50, z: 1 };
    const cursor = { x: 300, y: 200 };
    const drawingPoint = { x: (cursor.x - v.x) / v.z, y: (cursor.y - v.y) / v.z };
    const next = zoomAt(v, cursor.x, cursor.y, 1.5);
    expect(next.z).toBe(1.5);
    expect(onScreen(next, drawingPoint.x, drawingPoint.y)).toEqual(cursor);
  });

  it("stops at the limits", () => {
    expect(clampZoom(10)).toBe(MAX_Z);
    expect(clampZoom(0.01)).toBe(MIN_Z);
    expect(zoomAt({ x: 0, y: 0, z: MAX_Z }, 0, 0, 2).z).toBe(MAX_Z);
  });
});

describe("two-finger pinch", () => {
  const start = { x: 0, y: 0, z: 1 };
  const startMid = { x: 200, y: 200 };

  it("spreading the fingers zooms in around them", () => {
    const next = pinch(start, startMid, 100, startMid, 150);
    expect(next.z).toBe(1.5);
    expect(onScreen(next, 200, 200)).toEqual(startMid);
  });

  it("moving both fingers together pans without zooming", () => {
    const next = pinch(start, startMid, 100, { x: 260, y: 170 }, 100);
    expect(next).toEqual({ z: 1, x: 60, y: -30 });
  });

  it("does both at once, and respects the zoom limits", () => {
    const next = pinch(start, startMid, 100, { x: 220, y: 200 }, 50);
    expect(next.z).toBe(0.5);
    expect(onScreen(next, 200, 200)).toEqual({ x: 220, y: 200 });
    expect(pinch(start, startMid, 100, startMid, 1000).z).toBe(MAX_Z);
  });
});

describe("scroll to zoom", () => {
  it("a pinch is direct, a mouse wheel notch zooms gently", () => {
    const notch = Math.exp(-100 * wheelZoomSpeed({ ctrlKey: false, metaKey: false, deltaMode: 0 }));
    expect(notch).toBeGreaterThan(0.8);
    expect(notch).toBeLessThan(0.85);
    expect(wheelZoomSpeed({ ctrlKey: true, metaKey: false, deltaMode: 0 })).toBe(0.01);
    expect(wheelZoomSpeed({ ctrlKey: false, metaKey: false, deltaMode: 1 })).toBe(0.05);
  });
});

describe("fit the whole workflow", () => {
  it("shrinks a tall workflow until it fits both ways, centred", () => {
    const v = fitAll({ width: 600, height: 1800 }, { width: 1000, height: 764 });
    expect(v.z).toBeCloseTo(700 / 1800, 5);
    expect(v.x + 600 * v.z / 2).toBeCloseTo(500, 5); // centred left to right
    expect(v.y + 1800 * v.z).toBeLessThanOrEqual(764 - 32 + 0.001); // bottom on screen
  });

  it("never enlarges a small one past 100%, and centres it", () => {
    expect(fitAll({ width: 300, height: 200 }, { width: 1000, height: 800 })).toEqual({ z: 1, x: 350, y: 300 });
  });
});
