import { describe, expect, it } from "vitest";
import { ELEVATION_MAX_POINTS, MIN_TRACK_METERS, parseGpxElevation } from "@/modules/routes/elevation/parse";
import { elevationGpx } from "../../helpers/elevation-gpx";

/**
 * §NNN (amending §718, §750, §757) — the elevation profile's reader, `routes/elevation/parse.ts`: the distance along the
 * track and the altitude at that distance, from the GPX's text, for the page's chart, the editor's preview and the race
 * number's strip.
 */
describe("§NNN the GPX's elevation profile", () => {
  const profile = parseGpxElevation(elevationGpx())!;

  it("reads the distance, the altitude range and the climb of a 9 km track", () => {
    expect(profile).not.toBeNull();
    expect(profile.distanceMeters).toBeGreaterThan(8_900);
    expect(profile.distanceMeters).toBeLessThan(9_100);
    expect(profile.minAltitude).toBeGreaterThanOrEqual(607);
    expect(profile.minAltitude).toBeLessThanOrEqual(615);
    expect(profile.maxAltitude).toBeGreaterThan(800);
    expect(profile.maxAltitude).toBeLessThanOrEqual(830);
    expect(profile.gainMeters).toBeGreaterThan(200);
  });

  it("hands over at most 400 points, evenly by distance, the first at 0 and the last at the track's end", () => {
    expect(profile.points.length).toBeLessThanOrEqual(ELEVATION_MAX_POINTS);
    expect(profile.points[0][0]).toBe(0);
    expect(profile.points[profile.points.length - 1][0]).toBeCloseTo(profile.distanceMeters, -1);
    const steps = profile.points.slice(1).map((point, i) => point[0] - profile.points[i][0]);
    const mean = steps.reduce((sum, step) => sum + step, 0) / steps.length;
    for (const step of steps) expect(Math.abs(step - mean)).toBeLessThan(0.2 + mean * 0.001);
    // The lowest and highest points of the series are the range's.
    expect(Math.min(...profile.points.map((point) => point[1]))).toBe(profile.minAltitude);
    expect(Math.max(...profile.points.map((point) => point[1]))).toBe(profile.maxAltitude);
  });

  it("thins a long recording to 400 points and never more", () => {
    const long = parseGpxElevation(elevationGpx({ points: 5_000 }))!;
    expect(long.points).toHaveLength(ELEVATION_MAX_POINTS);
    expect(long.distanceMeters).toBeCloseTo(profile.distanceMeters, -2);
  });

  it("gives a track of a few fixes a line that still has enough points to follow them", () => {
    const short = parseGpxElevation(elevationGpx({ points: 5 }))!;
    expect(short.points.length).toBeGreaterThanOrEqual(64);
  });

  it("reads a route file's `rtept` when there is no track", () => {
    const route = parseGpxElevation(elevationGpx({ element: "rtept" }))!;
    expect(route.distanceMeters).toBe(profile.distanceMeters);
  });

  it("has no profile without altitudes, with fewer than two points or on a track shorter than 50 m", () => {
    expect(parseGpxElevation(elevationGpx({ withoutElevation: true }))).toBeNull();
    expect(parseGpxElevation(elevationGpx({ points: 1 }))).toBeNull();
    expect(parseGpxElevation(elevationGpx({ km: (MIN_TRACK_METERS - 10) / 1000 }))).toBeNull();
    expect(parseGpxElevation("")).toBeNull();
    expect(parseGpxElevation("<gpx><trk><trkseg></trkseg></trk></gpx>")).toBeNull();
  });

  it("skips a point without an altitude or outside the globe instead of refusing the file", () => {
    const text = elevationGpx().replace("</trkseg>", '<trkpt lat="95" lon="25"><ele>5</ele></trkpt><trkpt lat="45.6" lon="25.9"/></trkseg>');
    expect(parseGpxElevation(text)?.distanceMeters).toBe(profile.distanceMeters);
  });

  it("keeps a flat track flat: its range is one altitude", () => {
    const flat = parseGpxElevation(elevationGpx({ low: 300, high: 300 }))!;
    expect(flat.minAltitude).toBe(300);
    expect(flat.maxAltitude).toBe(300);
    expect(flat.gainMeters).toBe(0);
  });
});
