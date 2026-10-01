/**
 * The large preview's pinch-zoom (§NNN), as plain arithmetic the dialog calls from its Pointer
 * Events: no React, no DOM, so the gestures are proven in a unit test. The owner, 2026-10-01: «Și
 * să pot face zoom pinch pe poze».
 *
 * A zoom is `transform: translate(x, y) scale(scale)` with the origin at the picture box's top left;
 * every point is in that box's own pixels. The scale stays within 1–4, and a pan keeps the box
 * covering the screen's frame, so the picture never leaves it.
 */

export type Point = { x: number; y: number };
export type Size = { width: number; height: number };
export type Zoom = { scale: number; x: number; y: number };
/** One pointer's press or release: where and when (milliseconds). */
export type Touch = Point & { time: number };

export const MIN_SCALE = 1;
export const MAX_SCALE = 4;
export const DOUBLE_TAP_SCALE = 2;
export const TAP_MS = 300;
export const TAP_PX = 10;
export const DOUBLE_TAP_PX = 24;

export const IDENTITY: Zoom = { scale: 1, x: 0, y: 0 };

const distance = (a: Point, b: Point) => Math.hypot(a.x - b.x, a.y - b.y);
const midpoint = (a: Point, b: Point): Point => ({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 });
const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));

export const clampScale = (scale: number) => clamp(scale, MIN_SCALE, MAX_SCALE);

/** Keeps the scaled box covering the frame: at scale 1 it does not move at all. */
export function clampPan(zoom: Zoom, size: Size): Zoom {
  return {
    scale: zoom.scale,
    x: clamp(zoom.x, size.width - size.width * zoom.scale, 0),
    y: clamp(zoom.y, size.height - size.height * zoom.scale, 0),
  };
}

/** A new scale with the picture's point under `at` staying under it, then clamped to the frame. */
export function zoomAbout(zoom: Zoom, scale: number, at: Point, size: Size): Zoom {
  const next = clampScale(scale);
  const ratio = next / zoom.scale;
  return clampPan({ scale: next, x: at.x - (at.x - zoom.x) * ratio, y: at.y - (at.y - zoom.y) * ratio }, size);
}

/**
 * Two fingers: the scale is the distance ratio against the pinch's start, about the start's
 * midpoint, which follows the fingers' current midpoint (two fingers pan as they pinch).
 */
export function pinch(start: Zoom, from: [Point, Point], to: [Point, Point], size: Size): Zoom {
  const before = distance(from[0], from[1]);
  if (before === 0) return start;
  const scale = clampScale(start.scale * (distance(to[0], to[1]) / before));
  const origin = midpoint(from[0], from[1]);
  const now = midpoint(to[0], to[1]);
  // The picture's point under the start's midpoint, in unscaled pixels.
  const px = (origin.x - start.x) / start.scale;
  const py = (origin.y - start.y) / start.scale;
  return clampPan({ scale, x: now.x - px * scale, y: now.y - py * scale }, size);
}

/** One finger at a scale above 1 moves the picture by its own travel. */
export function pan(start: Zoom, from: Point, to: Point, size: Size): Zoom {
  if (start.scale <= MIN_SCALE) return start;
  return clampPan({ scale: start.scale, x: start.x + to.x - from.x, y: start.y + to.y - from.y }, size);
}

/** A double tap: 2× about the tap when the picture is at its size, back to 1× otherwise. */
export function toggleZoom(zoom: Zoom, at: Point, size: Size): Zoom {
  return zoom.scale > MIN_SCALE ? IDENTITY : zoomAbout(zoom, DOUBLE_TAP_SCALE, at, size);
}

/** A trackpad's pinch arrives as a wheel with ctrlKey: zoom around the cursor. */
export function wheelZoom(zoom: Zoom, deltaY: number, at: Point, size: Size): Zoom {
  return zoomAbout(zoom, zoom.scale * Math.exp(-deltaY * 0.01), at, size);
}

/**
 * A tap, and only a tap, closes the preview: one pointer down and up within 300 ms and 10 px. The
 * dialog adds the rest — one pointer only, and the scale unchanged — so a pinch's or a pan's end
 * never closes it.
 */
export function isTap(down: Touch, up: Touch): boolean {
  return up.time - down.time <= TAP_MS && distance(down, up) <= TAP_PX;
}

/** A second tap within 300 ms and 24 px of the first one. */
export function isDoubleTap(first: Touch, second: Touch): boolean {
  return second.time - first.time <= TAP_MS && distance(first, second) <= DOUBLE_TAP_PX;
}

export const zoomTransform = (zoom: Zoom) => `translate(${zoom.x}px, ${zoom.y}px) scale(${zoom.scale})`;
