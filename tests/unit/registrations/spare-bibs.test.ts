import { describe, expect, it } from "vitest";
import { eventFieldsSchema } from "@/modules/content/events/fields";
import {
  freeSpareNumbers,
  isSpareNumber,
  SPARE_BIBS_MAX,
  spareBandOf,
  spareBandRefusal,
  spareCountOf,
  spareNumbersOf,
} from "@/modules/registrations/domain/spare-bibs";

/**
 * §NNN — the desk's spare bibs as a band: what the allocator steps over, what the sheet prints
 * blank, and what the editor's two boxes may hold.
 */
describe("§NNN the spare band", () => {
  it("reads the event's two columns as a band, or none", () => {
    expect(spareBandOf({ bibSpareFrom: 900, bibSpareTo: 949 })).toEqual({ from: 900, to: 949 });
    expect(spareBandOf({ bibSpareFrom: null, bibSpareTo: null })).toBeNull();
    // Half a band, or one backwards, is no band: never a reason to reserve anything.
    expect(spareBandOf({ bibSpareFrom: 900, bibSpareTo: null })).toBeNull();
    expect(spareBandOf({ bibSpareFrom: 950, bibSpareTo: 900 })).toBeNull();
  });

  it("knows its numbers, both ends included", () => {
    const band = { from: 900, to: 903 };
    expect(spareNumbersOf(band)).toEqual([900, 901, 902, 903]);
    expect(spareCountOf(band)).toBe(4);
    expect([899, 900, 903, 904].map((n) => isSpareNumber(band, n))).toEqual([false, true, true, false]);
    expect(isSpareNumber(null, 900)).toBe(false);
    expect(spareNumbersOf(null)).toEqual([]);
  });

  it("offers only the ones nobody has", () => {
    expect(freeSpareNumbers({ from: 900, to: 903 }, new Set([901, 5]))).toEqual([900, 902, 903]);
    expect(freeSpareNumbers(null, new Set())).toEqual([]);
  });

  it("refuses half a band, a band backwards and one larger than a sheet, naming the box", () => {
    expect(spareBandRefusal(null, null)).toBeNull();
    expect(spareBandRefusal(900, 949)).toBeNull();
    expect(spareBandRefusal(900, null)).toEqual({ field: "bibSpareTo", reason: "half" });
    expect(spareBandRefusal(null, 949)).toEqual({ field: "bibSpareFrom", reason: "half" });
    expect(spareBandRefusal(949, 900)).toEqual({ field: "bibSpareTo", reason: "order" });
    expect(spareBandRefusal(1, SPARE_BIBS_MAX)).toBeNull();
    expect(spareBandRefusal(1, SPARE_BIBS_MAX + 1)).toEqual({ field: "bibSpareTo", reason: "size" });
  });
});

describe("§NNN the editor's two boxes", () => {
  /** An event the schema takes whole, as an ordinary form posts it: the boxes are the only variable. */
  const BASE = {
    type: "RACE",
    surface: "",
    eventStatus: "SCHEDULED",
    timezone: "Europe/Bucharest",
    startsAtWallTime: "2026-10-01T09:00",
    endsAtWallTime: "",
    raceStartsAtWallTime: "",
    locationName: "Parcul Tractorul",
    locationAddress: "",
    difficulty: "",
    costType: "",
    mapUrl: "",
    routeUrl: "",
    distanceMeters: "",
    elevationGainMeters: "",
    featured: false,
    registrationMode: "NONE",
    capacity: "",
    registrationOpensAtWallTime: "",
    registrationClosesAtWallTime: "",
    declarationDocumentId: "",
    externalProvider: "",
    externalRegistrationUrl: "",
    participantListVisibility: "HIDDEN",
  } as const;
  const issuesFor = (bibSpareFrom?: string, bibSpareTo?: string) => {
    const parsed = eventFieldsSchema.safeParse({ ...BASE, bibSpareFrom, bibSpareTo });
    return parsed.success ? [] : parsed.error.issues.map((issue) => String(issue.path[0]));
  };

  it("accepts both or neither, and names the box that is wrong", () => {
    expect(eventFieldsSchema.safeParse(BASE).success).toBe(true);
    // Absent is "not editing them", and the save writes nothing (the waiting list's discipline).
    expect(eventFieldsSchema.safeParse(BASE).data?.bibSpareFrom).toBeUndefined();
    expect(eventFieldsSchema.safeParse({ ...BASE, bibSpareFrom: "900", bibSpareTo: "949" }).data).toMatchObject({
      bibSpareFrom: 900,
      bibSpareTo: 949,
    });
    expect(issuesFor(undefined, undefined)).toEqual([]);
    expect(issuesFor("", "")).toEqual([]);
    expect(issuesFor("900", "949")).toEqual([]);
    expect(issuesFor("900", "")).toEqual(["bibSpareTo"]);
    expect(issuesFor("", "949")).toEqual(["bibSpareFrom"]);
    expect(issuesFor("949", "900")).toEqual(["bibSpareTo"]);
    expect(issuesFor("1", "501")).toEqual(["bibSpareTo"]);
    expect(issuesFor("0", "10")).toEqual(["bibSpareFrom"]);
  });
});
