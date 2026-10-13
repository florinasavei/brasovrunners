import { describe, expect, it } from "vitest";
import { kindsFromWords, MAX_OFF_TRACK_METERS, parseGpxWaypoints } from "@/modules/event-checkpoints/domain/gpx-waypoints";

/**
 * §NNN — the waypoints of a route's GPX, each placed along its track by projecting it on the track:
 * the kilometre, the distance off the track, the guess at what is there. A straight track along a
 * parallel makes the answer checkable by hand: at 45.6° north a thousandth of a degree of longitude is
 * 77.9 m, so 41 points 0.001° apart are a 3.1 km line.
 */

const LAT = 45.6;
/** Metres in a thousandth of a degree of longitude at that latitude, from the same sphere the reader uses. */
const STEP_M = 6_371_000 * (Math.PI / 180) * 0.001 * Math.cos(LAT * (Math.PI / 180));

function gpx(waypoints: string, options: { track?: "trkpt" | "rtept" | "none"; points?: number } = {}): string {
  const kind = options.track ?? "trkpt";
  const count = options.points ?? 41;
  const body = Array.from({ length: count }, (_, i) => `<${kind} lat="${LAT.toFixed(4)}" lon="${(25.5 + i * 0.001).toFixed(5)}"><ele>600</ele></${kind}>`).join("");
  const track = kind === "none" ? "" : kind === "trkpt" ? `<trk><trkseg>${body}</trkseg></trk>` : `<rte>${body}</rte>`;
  return `<?xml version="1.0"?><gpx version="1.1" creator="test">${waypoints}${track}</gpx>`;
}

const wpt = (lat: number, lon: number, inner: string) => `<wpt lat="${lat}" lon="${lon}">${inner}</wpt>`;

describe("§NNN a waypoint placed on its track", () => {
  it("gives the kilometre along the track, computed by projecting the waypoint on it", () => {
    // Over the middle of the 21st point, ten metres north of the line: 20 steps along.
    const parsed = parseGpxWaypoints(gpx(wpt(LAT + 0.0001, 25.52, "<name>Vârf</name>")));
    expect(parsed.trackMeters).toBeCloseTo(40 * STEP_M, 0);
    expect(parsed.waypointCount).toBe(1);
    expect(parsed.proposals).toHaveLength(1);
    expect(parsed.proposals[0].name).toBe("Vârf");
    expect(parsed.proposals[0].km).toBeCloseTo((20 * STEP_M) / 1000, 2);
    expect(parsed.proposals[0].offMeters).toBeGreaterThan(8);
    expect(parsed.proposals[0].offMeters).toBeLessThan(13);
    expect(parsed.proposals[0].tooFar).toBe(false);
  });

  it("projects between two points of the track, not only on them", () => {
    // Half way between the 11th and 12th points: 10.5 steps.
    const parsed = parseGpxWaypoints(gpx(wpt(LAT, 25.5105, "<name>Între</name>")));
    expect(parsed.proposals[0].km).toBeCloseTo((10.5 * STEP_M) / 1000, 2);
    expect(parsed.proposals[0].offMeters).toBeLessThan(1);
  });

  it("puts a waypoint before the start at kilometre 0 and one past the end at the track's length", () => {
    const parsed = parseGpxWaypoints(gpx(wpt(LAT, 25.4995, "<name>Înainte</name>") + wpt(LAT, 25.5405, "<name>După</name>")));
    expect(parsed.proposals.map((p) => p.name)).toEqual(["Înainte", "După"]);
    expect(parsed.proposals[0].km).toBe(0);
    expect(parsed.proposals[1].km).toBeCloseTo((40 * STEP_M) / 1000, 2);
  });

  it("lists the waypoints in the order along the track, whatever order the file has them in", () => {
    const parsed = parseGpxWaypoints(gpx(wpt(LAT, 25.53, "<name>Al treilea</name>") + wpt(LAT, 25.505, "<name>Primul</name>") + wpt(LAT, 25.52, "<name>Al doilea</name>")));
    expect(parsed.proposals.map((p) => p.name)).toEqual(["Primul", "Al doilea", "Al treilea"]);
  });

  it("marks a waypoint far from the track and offers none of those", () => {
    // A thousandth of a degree of latitude is 111 m: 0.004° is 445 m, past the limit.
    const parsed = parseGpxWaypoints(gpx(wpt(LAT + 0.004, 25.52, "<name>Parcare</name>") + wpt(LAT + 0.0005, 25.52, "<name>Aproape</name>")));
    expect(MAX_OFF_TRACK_METERS).toBe(300);
    expect(parsed.proposals.find((p) => p.name === "Parcare")?.tooFar).toBe(true);
    expect(parsed.proposals.find((p) => p.name === "Aproape")?.tooFar).toBe(false);
  });

  it("leaves out a waypoint with no name, which cannot be a checkpoint, and cuts one to sixty characters", () => {
    const parsed = parseGpxWaypoints(gpx(wpt(LAT, 25.52, "") + wpt(LAT, 25.53, `<name>${"x".repeat(80)}</name>`)));
    expect(parsed.waypointCount).toBe(2);
    expect(parsed.proposals).toHaveLength(1);
    expect(parsed.proposals[0].name).toHaveLength(60);
  });

  it("reads the names as text: entities decoded, CDATA unwrapped, whitespace folded", () => {
    const parsed = parseGpxWaypoints(
      gpx(wpt(LAT, 25.51, "<name>Apă &amp; mâncare</name>") + wpt(LAT, 25.52, "<name><![CDATA[Punct <1>]]></name>") + wpt(LAT, 25.53, "<name>  Prim\n  ajutor &#x21; </name>")),
    );
    expect(parsed.proposals.map((p) => p.name)).toEqual(["Apă & mâncare", "Punct <1>", "Prim ajutor !"]);
  });

  it("reads a route's points when the file has no track, and places nothing without either", () => {
    expect(parseGpxWaypoints(gpx(wpt(LAT, 25.52, "<name>A</name>"), { track: "rtept" })).proposals).toHaveLength(1);
    const none = parseGpxWaypoints(gpx(wpt(LAT, 25.52, "<name>A</name>"), { track: "none" }));
    expect(none).toEqual({ trackMeters: 0, waypointCount: 1, proposals: [] });
  });

  it("places nothing on a track too short to have kilometres", () => {
    // Two points 0.0003° apart are 23 m.
    const short = `<gpx>${wpt(LAT, 25.50015, "<name>A</name>")}<trk><trkseg><trkpt lat="${LAT}" lon="25.5000"/><trkpt lat="${LAT}" lon="25.5003"/></trkseg></trk></gpx>`;
    expect(parseGpxWaypoints(short).proposals).toEqual([]);
  });

  it("is nothing for a file with no waypoints at all", () => {
    const parsed = parseGpxWaypoints(gpx(""));
    expect(parsed.waypointCount).toBe(0);
    expect(parsed.proposals).toEqual([]);
    expect(parsed.trackMeters).toBeGreaterThan(3000);
  });

  it("guesses what is there from the name, the symbol and the type", () => {
    const parsed = parseGpxWaypoints(
      gpx(
        wpt(LAT, 25.505, "<name>Izvor</name><sym>Drinking Water</sym>") +
          wpt(LAT, 25.515, "<name>Ravito</name><type>aid station</type>") +
          wpt(LAT, 25.525, "<name>Salvamont</name>") +
          wpt(LAT, 25.535, "<name>Cronometraj</name>") +
          wpt(LAT, 25.54, "<name>Colț</name>"),
      ),
    );
    expect(parsed.proposals.map((p) => p.kinds)).toEqual([["WATER"], ["FOOD"], ["FIRST_AID"], ["TIMING"], []]);
  });
});

describe("§NNN what a waypoint's words say it offers", () => {
  it.each([
    ["Fântână", ["WATER"]],
    ["Apă potabilă", ["WATER"]],
    ["Punct de apă și mâncare", ["WATER", "FOOD"]],
    ["Aid station — snacks", ["FOOD"]],
    ["Prim ajutor", ["FIRST_AID"]],
    ["Control point", ["TIMING"]],
    ["Cabana", []],
    ["", []],
  ])("reads %j as %j", (words, kinds) => expect(kindsFromWords(words)).toEqual(kinds));
});
