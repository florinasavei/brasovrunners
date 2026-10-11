import { describe, expect, it } from "vitest";
import {
  checkGpx,
  cleanGpxName,
  gpxFileStem,
  gpxSizeWords,
  isRouteGpxKey,
  MAX_GPX_BYTES,
  readPostedRouteGpx,
  readRouteGpx,
  routeGpxFileName,
  routeGpxHeaders,
  routeGpxKey,
} from "@/modules/events/domain/route-gpx";

/**
 * BR-REQ-011-01 (§718) — «Traseul»'s GPX file: checked for what it is — an XML document whose root
 * is `<gpx>` — never by its extension; stored under a key of its own; served as a file to save under
 * its own name. The tracks here are made up.
 */
const bytes = (text: string) => new TextEncoder().encode(text);
const TRACK = `<?xml version="1.0" encoding="UTF-8"?>
<!-- exported -->
<gpx version="1.1" creator="test" xmlns="http://www.topografix.com/GPX/1/1">
  <trk><name>Tâmpa</name><trkseg><trkpt lat="45.63" lon="25.59"><ele>600</ele></trkpt></trkseg></trk>
</gpx>
`;
const ID = "0123abcd-0123-4abc-8def-0123456789ab";

describe("BR-REQ-011-01 a GPX is checked by what it is (§718)", () => {
  it("accepts a GPX document: the declaration, a comment, the root, a byte-order mark, a namespace prefix", () => {
    expect(checkGpx(bytes(TRACK))).toEqual({ ok: true });
    expect(checkGpx(bytes(`\uFEFF${TRACK}`))).toEqual({ ok: true });
    expect(checkGpx(bytes(`<gpx:gpx xmlns:gpx="http://www.topografix.com/GPX/1/1"><gpx:trk/></gpx:gpx>`))).toEqual({ ok: true });
    expect(checkGpx(bytes(`<gpx version="1.1"/>`.replace("/>", "></gpx>")))).toEqual({ ok: true });
  });

  it("refuses what is not XML, a root that is not gpx, a doctype, an empty file and one over four megabytes", () => {
    expect(checkGpx(bytes(""))).toEqual({ ok: false, reason: "empty" });
    expect(checkGpx(bytes("lat,lon\n45.6,25.5\n"))).toEqual({ ok: false, reason: "notXml" });
    expect(checkGpx(bytes(`<?xml version="1.0"?><kml><Document/></kml>`))).toEqual({ ok: false, reason: "notGpx" });
    expect(checkGpx(bytes(`<html><body>gpx</body></html>`))).toEqual({ ok: false, reason: "notGpx" });
    expect(checkGpx(bytes(`<gpxtrack></gpxtrack>`))).toEqual({ ok: false, reason: "notGpx" });
    expect(checkGpx(bytes(`<?xml version="1.0"?><!DOCTYPE gpx [<!ENTITY x "y">]><gpx>&x;</gpx>`))).toEqual({ ok: false, reason: "notGpx" });
    // Opened and never closed: cut off half-way.
    expect(checkGpx(bytes(`<gpx version="1.1"><trk>`))).toEqual({ ok: false, reason: "notXml" });
    // Not UTF-8 text at all.
    expect(checkGpx(new Uint8Array([0x3c, 0x67, 0x70, 0x78, 0xff, 0xfe, 0x3e]))).toEqual({ ok: false, reason: "notXml" });
    // Named .gpx means nothing: a PNG's bytes are refused whatever the file was called.
    expect(checkGpx(new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))).toEqual({ ok: false, reason: "notXml" });
    const huge = new Uint8Array(MAX_GPX_BYTES + 1).fill(0x20);
    expect(checkGpx(huge)).toEqual({ ok: false, reason: "tooLarge" });
  });
});

describe("BR-REQ-011-01 the GPX's key, name and headers (§718)", () => {
  it("keys it by environment and a fresh id, and downloads it under the club's name, plain", () => {
    const key = routeGpxKey("qa", ID, "Traseu Tâmpa — 2026.GPX");
    expect(key).toBe(`qa/route-gpx/${ID}/traseu-tampa-2026.gpx`);
    expect(isRouteGpxKey(key)).toBe(true);
    expect(routeGpxFileName(key)).toBe("traseu-tampa-2026.gpx");
    expect(routeGpxHeaders(key)).toEqual({ contentType: "application/gpx+xml", contentDisposition: 'attachment; filename="traseu-tampa-2026.gpx"' });
    expect(gpxFileStem("…")).toBe("traseu");
    expect(gpxFileStem("a".repeat(100)).length).toBe(60);
  });

  it("never takes a path, a quote or a control character into the name it shows", () => {
    expect(cleanGpxName("C:\\Users\\x\\Downloads\\ruta.gpx")).toBe("ruta.gpx");
    expect(cleanGpxName("../../etc/ruta\u0007.gpx")).toBe("ruta.gpx");
    expect(isRouteGpxKey(`qa/route-gpx/${ID}/a"b.gpx`)).toBe(false);
    expect(isRouteGpxKey(`qa/${ID}/web.webp`)).toBe(false);
  });

  it("reads the stored column and the editor's hidden input; refuses another environment's key and what is not JSON", () => {
    const stored = { key: `test/route-gpx/${ID}/tampa.gpx`, name: "Tâmpa.gpx", size: 2048, uploadedAt: "2026-10-11T10:00:00.000Z" };
    expect(readRouteGpx(stored)).toEqual(stored);
    expect(readRouteGpx({ key: "test/elsewhere.gpx" })).toBeNull();
    expect(readRouteGpx(null)).toBeNull();
    expect(readPostedRouteGpx("")).toBeNull();
    expect(readPostedRouteGpx(JSON.stringify(stored), "test")).toEqual(stored);
    expect(readPostedRouteGpx(JSON.stringify(stored), "production")).toBeUndefined();
    expect(readPostedRouteGpx("not json")).toBeUndefined();
    expect(readPostedRouteGpx(JSON.stringify({ key: "https://evil.example.test/x.gpx" }))).toBeUndefined();
  });

  it("says the size in the reader's language", () => {
    expect(gpxSizeWords(850 * 1024, "ro")).toBe("850 KB");
    expect(gpxSizeWords(1.25 * 1024 * 1024, "ro")).toBe("1,3 MB");
    expect(gpxSizeWords(1.25 * 1024 * 1024, "en")).toBe("1.3 MB");
    expect(gpxSizeWords(10, "en")).toBe("1 KB");
  });
});
