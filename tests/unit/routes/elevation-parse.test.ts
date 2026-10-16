import { describe, expect, it } from "vitest";
import { ELEVATION_MAX_POINTS, MIN_TRACK_METERS, parseGpxElevation } from "@/modules/routes/elevation/parse";
import { parseGpxProfile } from "@/modules/registrations/bib-profile";
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

  it("agrees with the race number's reader on the distance and the climb, within one per cent", () => {
    const bib = parseGpxProfile(elevationGpx())!;
    expect(Math.abs(profile.distanceMeters - bib.distanceMeters) / bib.distanceMeters).toBeLessThan(0.01);
    expect(Math.abs(profile.gainMeters - bib.gainMeters) / bib.gainMeters).toBeLessThan(0.01);
  });

  it("agrees with the race number's reader on a jittery recording with uneven spacing too — the two readers are copies until the number switches to this one", () => {
    // A real watch's track: fixes a few metres apart then a few dozen, the altitude shaking by a metre or two on top of the hill.
    let seed = 7;
    const random = () => {
      seed = (seed * 16807) % 2147483647;
      return seed / 2147483647;
    };
    let lon = 25.5;
    const body = Array.from({ length: 900 }, (_, i) => {
      lon += 0.00002 + random() * 0.00022;
      const share = i / 899;
      const altitude = 620 + 180 * Math.sin(Math.PI * share) ** 1.3 + (random() - 0.5) * 4;
      return `<trkpt lat="45.6" lon="${lon.toFixed(6)}"><ele>${altitude.toFixed(1)}</ele></trkpt>`;
    }).join("");
    const text = `<gpx version="1.1"><trk><trkseg>${body}</trkseg></trk></gpx>`;
    const ours = parseGpxElevation(text)!;
    const bib = parseGpxProfile(text)!;
    expect(Math.abs(ours.distanceMeters - bib.distanceMeters) / bib.distanceMeters).toBeLessThan(0.01);
    expect(Math.abs(ours.gainMeters - bib.gainMeters) / bib.gainMeters).toBeLessThan(0.01);
  });

  it("reads every form of a decimal a GPX may carry — «+600», «.5», «600.», a negative fraction — not only «600» and «600.5»", () => {
    const forms = ["+600", "600.", "600.5", ".5", "-3.5", "+0.25"];
    const point = (i: number, ele: string) => `<trkpt lat="+45.60" lon="${(25.5 + i * 0.0006).toFixed(6)}"><ele>${ele}</ele></trkpt>`;
    // Eighty points, so one skipped for its form would change the count the distance is made of.
    const text = `<gpx><trk><trkseg>${Array.from({ length: 80 }, (_, i) => point(i, forms[i % forms.length])).join("")}</trkseg></trk></gpx>`;
    const read = parseGpxElevation(text)!;
    expect(read.distanceMeters).toBeGreaterThan(3_400);
    expect(read.minAltitude).toBeLessThan(100);
    expect(read.maxAltitude).toBeGreaterThan(300);
    // Every form was read: the same track with each form written plainly has the same length.
    const plain = `<gpx><trk><trkseg>${Array.from({ length: 80 }, (_, i) => `<trkpt lat="45.60" lon="${(25.5 + i * 0.0006).toFixed(6)}"><ele>${Number(forms[i % forms.length])}</ele></trkpt>`).join("")}</trkseg></trk></gpx>`;
    expect(read.distanceMeters).toBe(parseGpxElevation(plain)!.distanceMeters);
  });

  it("keeps a flat track flat: its range is one altitude", () => {
    const flat = parseGpxElevation(elevationGpx({ low: 300, high: 300 }))!;
    expect(flat.minAltitude).toBe(300);
    expect(flat.maxAltitude).toBe(300);
    expect(flat.gainMeters).toBe(0);
  });
});
