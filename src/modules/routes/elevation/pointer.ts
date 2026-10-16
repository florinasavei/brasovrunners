/**
 * What the chart's pointer reads (§NNN): the arithmetic behind «4,5 km · 712 m» — which point of the profile is nearest
 * to a position on the chart, how far along the route that is, what a key moves it by, and which checkpoint stands close
 * enough to name. Pure numbers in and out, so `ElevationPointer.tsx` (the client island, which only listens and draws)
 * and its test share one rule, and nothing here needs a DOM.
 */

/** A checkpoint is named by the pointer when it stands within this many kilometres of it. */
export const POINTER_MARKER_REACH_KM = 0.2;

/** Where the plot stands in the chart's own box, and which way it runs. */
export type PointerScale = { plotLeft: number; plotRight: number; mirrored: boolean };

/** The share (0 to 1) of the route's length a position on the chart stands at, clamped to the plot. */
export function shareAtX(scale: PointerScale, x: number): number {
  const width = scale.plotRight - scale.plotLeft;
  if (!(width > 0)) return 0;
  const share = Math.min(1, Math.max(0, (x - scale.plotLeft) / width));
  return scale.mirrored ? 1 - share : share;
}

/** The position on the chart of a share of the route: the inverse of `shareAtX`. */
export function xAtShare(scale: PointerScale, share: number): number {
  const along = scale.mirrored ? 1 - share : share;
  return scale.plotLeft + along * (scale.plotRight - scale.plotLeft);
}

/** The profile point nearest a share of its length: the points are evenly spaced by distance, so this is a rounding. */
export function indexAtShare(count: number, share: number): number {
  return Math.min(count - 1, Math.max(0, Math.round(share * (count - 1))));
}

/**
 * What the readout says at a profile point: the kilometre it stands at on the **plot's** distance (the figure the axis
 * is drawn to, which is the club's typed distance when it typed one) and the altitude there, in metres.
 */
export function readoutAt(
  profile: { points: ReadonlyArray<readonly [number, number]>; distanceMeters: number },
  index: number,
): { index: number; share: number; km: number; altitude: number } {
  const { points } = profile;
  const i = Math.min(points.length - 1, Math.max(0, index));
  const end = points[points.length - 1][0] || 1;
  const share = points[i][0] / end;
  return { index: i, share, km: (share * profile.distanceMeters) / 1000, altitude: points[i][1] };
}

/** The key that moves the pointer: arrows by a hundredth of the route, page keys by a tenth, home and end to the ends. */
export function stepIndex(index: number, count: number, key: string): number | null {
  const last = count - 1;
  const small = Math.max(1, Math.round(last / 100));
  const large = Math.max(1, Math.round(last / 10));
  const moved: Record<string, number> = {
    ArrowRight: index + small,
    ArrowUp: index + small,
    ArrowLeft: index - small,
    ArrowDown: index - small,
    PageUp: index + large,
    PageDown: index - large,
    Home: 0,
    End: last,
  };
  return key in moved ? Math.min(last, Math.max(0, moved[key])) : null;
}

/** The name of the checkpoint nearest the pointer, when one stands within `POINTER_MARKER_REACH_KM` of it; else null. */
export function nearestMarkerName(markers: ReadonlyArray<{ km: number; name: string }>, km: number): string | null {
  let best: { name: string; gap: number } | null = null;
  for (const marker of markers) {
    const gap = Math.abs(marker.km - km);
    // A hair of slack: 4.5 − 4.3 is 0.2000000000000002 in floating point and is two hundred metres all the same.
    if (gap <= POINTER_MARKER_REACH_KM + 1e-9 &&(best === null || gap < best.gap)) best = { name: marker.name, gap };
  }
  return best?.name ?? null;
}
