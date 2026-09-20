import { describe, expect, it } from "vitest";
import { eventFieldsSchema } from "@/modules/content/events/fields";

/**
 * BR-REQ-011-01 criterion 16 (`DECISIONS.md` §168) — the partners as the editor posts them.
 *
 * The rows arrive as strings from an ordinary form, so everything the column must never hold
 * has to be refused here: a page with nobody's name beside it, a link that is not https, more
 * partners than the list allows. The spare line the editor always shows is not an error.
 */
const BASE = {
  type: "GROUP_RUN",
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

const parse = (coHosts: unknown) => eventFieldsSchema.safeParse({ ...BASE, coHosts });

describe("BR-REQ-011-01 criterion 16 the partners a form may post", () => {
  it("keeps the order and turns an empty page into no page", () => {
    const parsed = parse([
      { name: "Brașov Marathon", url: "https://example.test/bm" },
      { name: "Salvamont", url: "" },
    ]);
    expect(parsed.success).toBe(true);
    expect(parsed.data?.coHosts).toEqual([
      { name: "Brașov Marathon", url: "https://example.test/bm" },
      { name: "Salvamont", url: null },
    ]);
  });

  it("drops the editor's spare line rather than refusing it", () => {
    const parsed = parse([{ name: "Salvamont", url: "" }, { name: "", url: "" }]);
    expect(parsed.success).toBe(true);
    expect(parsed.data?.coHosts).toEqual([{ name: "Salvamont", url: null }]);
  });

  it("says nothing about the partners when the form posts nothing at all — an older caller, a fixture (§169)", () => {
    // Absent is not `[]`. `[]` is the editor having removed every partner, which the save
    // writes; absent leaves the column alone, so an update that never mentioned the partners
    // cannot erase the one a row saved before the list still holds in `co_host_name`.
    const parsed = eventFieldsSchema.safeParse(BASE);
    expect(parsed.success).toBe(true);
    expect(parsed.data?.coHosts).toBeUndefined();
  });

  it("means no partners when the editor posts an empty list", () => {
    const parsed = parse([]);
    expect(parsed.success).toBe(true);
    expect(parsed.data?.coHosts).toEqual([]);
  });

  it("refuses a page with nobody's name beside it, saying which row", () => {
    const parsed = parse([{ name: "", url: "https://example.test/bm" }]);
    expect(parsed.success).toBe(false);
    expect(JSON.stringify(parsed.error?.issues)).toContain("co-host 1");
  });

  it("refuses a page that is not https", () => {
    expect(parse([{ name: "Salvamont", url: "http://example.test" }]).success).toBe(false);
    expect(parse([{ name: "Salvamont", url: "javascript:alert(1)" }]).success).toBe(false);
  });

  it("refuses more partners than one event may name", () => {
    const nine = Array.from({ length: 9 }, (_, index) => ({ name: `Partener ${index}`, url: "" }));
    expect(parse(nine).success).toBe(false);
    expect(parse(nine.slice(0, 8)).success).toBe(true);
  });
});

describe("BR-REQ-011-01 criterion 15 the special mark a form may post", () => {
  it("is an ordinary event when the box is not ticked, and absent from an older caller", () => {
    expect(eventFieldsSchema.safeParse(BASE).data?.isSpecial).toBe(false);
    expect(eventFieldsSchema.safeParse({ ...BASE, isSpecial: false }).data?.isSpecial).toBe(false);
  });

  it("is special when the box is ticked, with nothing else to say about it", () => {
    expect(eventFieldsSchema.safeParse({ ...BASE, isSpecial: true }).data?.isSpecial).toBe(true);
  });
});
