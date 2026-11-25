// Pan and zoom for the workflow canvas. `x`/`y` is where the drawing's top-left
// sits on screen, `z` its scale. Every zoom keeps the point under the cursor
// (or between the fingers) still, the way Figma and maps do. Pure.

export interface View {
  x: number;
  y: number;
  z: number;
}

export const MIN_Z = 0.35;
export const MAX_Z = 1.6;

export function clampZoom(z: number): number {
  return Math.max(MIN_Z, Math.min(MAX_Z, z));
}

/** Zoom by `factor` keeping the screen point (px, py) over the same spot of the drawing. */
export function zoomAt(v: View, px: number, py: number, factor: number): View {
  const z = clampZoom(v.z * factor);
  return { z, x: px - ((px - v.x) / v.z) * z, y: py - ((py - v.y) / v.z) * z };
}

export interface Point {
  x: number;
  y: number;
}

export function midpoint(a: Point, b: Point): Point {
  return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
}

export function distance(a: Point, b: Point): number {
  return Math.hypot(a.x - b.x, a.y - b.y) || 1;
}

/**
 * Two fingers: the spread sets the zoom, and the spot that was between the
 * fingers when they landed stays between them as they move (zoom + pan at once).
 */
export function pinch(start: View, startMid: Point, startDist: number, mid: Point, dist: number): View {
  const z = clampZoom(start.z * (dist / startDist));
  const drawingX = (startMid.x - start.x) / start.z;
  const drawingY = (startMid.y - start.y) / start.z;
  return { z, x: mid.x - drawingX * z, y: mid.y - drawingY * z };
}

/** How far a press must travel before it's a drag rather than a click. */
export const DRAG_THRESHOLD = 4;
