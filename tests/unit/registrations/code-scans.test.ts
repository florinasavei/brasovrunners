import { describe, expect, it } from "vitest";
import { type CodeScan, EARLIER_SCANS_SHOWN, earlierScans, OPENED_FROM_REGISTRATION, OPENED_IN_THE_OTHER_LANGUAGE } from "@/modules/registrations/domain/code-scans";

/**
 * §996 — «Scanat înainte» under the scanned row, the pure half (`registrations/domain/code-scans.ts`, the desk's own module, never
 * the organizers' «Jurnal»): the newest three earlier scans of a code, oldest first, never the one this visit counts as — the row it
 * wrote or repeated, or, on the same visit again (back from a desk verb, or switched to the other language), the viewer's newest;
 * and the two marks of an address that opens the page without a scan.
 */
describe("§996 «Scanat înainte»", () => {
  const scan = (id: string, minute: number, actorId: string | null): CodeScan => ({ id, at: new Date(Date.UTC(2099, 10, 21, 6, minute)), actorId, actorName: actorId });
  // The code's newest scans, newest first, as `listCodeScans` reads them.
  const scans = [scan("d", 12, "qr2"), scan("c", 9, "admin"), scan("b", 7, "qr3"), scan("a", 5, "qr1")];

  it("names the newest three but the visit's own, oldest first", () => {
    expect(EARLIER_SCANS_SHOWN).toBe(3);
    expect(earlierScans(scans, { ownScanId: "d", sameVisit: false, viewerId: "qr2" }).map((one) => one.id)).toEqual(["a", "b", "c"]);
    // A visit that recorded nothing (a prefetch is never drawn; the registration's own link): the newest three.
    expect(earlierScans(scans, { ownScanId: null, sameVisit: false, viewerId: "admin" }).map((one) => one.id)).toEqual(["b", "c", "d"]);
  });

  it("on the same visit again — back from a verb, or in the other language — leaves out the viewer's newest scan, and only that one", () => {
    expect(earlierScans(scans, { ownScanId: null, sameVisit: true, viewerId: "qr2" }).map((one) => one.id)).toEqual(["a", "b", "c"]);
    expect(earlierScans([scan("e", 20, "qr1"), ...scans], { ownScanId: null, sameVisit: true, viewerId: "qr1" }).map((one) => one.id)).toEqual(["b", "c", "d"]);
    // A viewer who never scanned it: nothing to leave out.
    expect(earlierScans(scans, { ownScanId: null, sameVisit: true, viewerId: "nobody" }).map((one) => one.id)).toEqual(["b", "c", "d"]);
  });

  it("is empty with no earlier scan", () => {
    expect(earlierScans([scan("d", 12, "qr2")], { ownScanId: "d", sameVisit: false, viewerId: "qr2" })).toEqual([]);
    expect(earlierScans([], { ownScanId: null, sameVisit: true, viewerId: "qr2" })).toEqual([]);
  });

  it("knows the two addresses that open the page without a scan by two words of their own", () => {
    expect(OPENED_FROM_REGISTRATION).toBe("registration");
    expect(OPENED_IN_THE_OTHER_LANGUAGE).toBe("language");
  });
});
