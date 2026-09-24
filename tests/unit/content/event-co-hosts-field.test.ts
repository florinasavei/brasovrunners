import { describe, expect, it } from "vitest";
import { MAX_CO_HOST_LINKS, MAX_CO_HOSTS } from "@/modules/events/domain/co-hosts";
import { eventFieldsSchema } from "@/modules/content/events/fields";

/**
 * BR-REQ-011-01 criterion 16 (`DECISIONS.md` §168, extended by §344) — the partners' cards, and
 * each one's links, as the editor posts them.
 *
 * The rows arrive as strings from an ordinary form, so everything the column must never hold
 * has to be refused here: a card with nobody's name beside a link, a link that is not https,
 * more cards or more links than either list allows. The spare lines the editor always shows are
 * not an error.
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

/** A card with a name and its links, boxes filled the way `CoHostRowsEditor` posts them. */
const card = (name: string, links: Array<Partial<{ kind: string; url: string; labelRo: string; labelEn: string }>> = []) => ({
  name,
  links: links.map((link) => ({ kind: "SITE", url: "", labelRo: "", labelEn: "", ...link })),
});

describe("BR-REQ-011-01 criterion 16 the partners a form may post", () => {
  it("keeps the order and turns a card with no links into a name alone", () => {
    const parsed = parse([
      card("Brașov Marathon", [{ url: "https://example.test/bm" }]),
      card("Salvamont"),
    ]);
    expect(parsed.success).toBe(true);
    expect(parsed.data?.coHosts).toEqual([
      { name: "Brașov Marathon", links: [{ kind: "SITE", url: "https://example.test/bm", labelRo: null, labelEn: null }] },
      { name: "Salvamont", links: [] },
    ]);
  });

  it("drops the editor's spare card and its spare link row rather than refusing them", () => {
    const parsed = parse([card("Salvamont", [{ url: "" }]), card("")]);
    expect(parsed.success).toBe(true);
    expect(parsed.data?.coHosts).toEqual([{ name: "Salvamont", links: [] }]);
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

  it("refuses a card with a link and nobody's name beside it, naming the card", () => {
    const parsed = parse([card("", [{ url: "https://example.test/bm" }])]);
    expect(parsed.success).toBe(false);
    expect(JSON.stringify(parsed.error?.issues)).toContain("partner 1");
    expect(parsed.error?.issues.some((issue) => issue.path.join(".") === "coHosts.0.name")).toBe(true);
  });

  it("keeps a name with no links at all — a partner's page has always been optional", () => {
    const parsed = parse([card("Salvamont")]);
    expect(parsed.success).toBe(true);
    expect(parsed.data?.coHosts).toEqual([{ name: "Salvamont", links: [] }]);
  });

  it("refuses more partners than one event may name", () => {
    const nine = Array.from({ length: 9 }, (_, index) => card(`Partener ${index}`));
    expect(parse(nine).success).toBe(false);
    expect(parse(nine.slice(0, MAX_CO_HOSTS)).success).toBe(true);
  });
});

describe("BR-REQ-011-01 criterion 16 one partner's links, as the editor posts them (§344)", () => {
  it("keeps the order and the kind, and turns an empty label into none", () => {
    const parsed = parse([
      card("Brașov Marathon", [
        { kind: "SITE", url: "https://bm.example.test" },
        { kind: "FACEBOOK", url: "https://facebook.com/bm", labelRo: "Pagina noastră" },
      ]),
    ]);
    expect(parsed.success).toBe(true);
    expect(parsed.data?.coHosts).toEqual([
      {
        name: "Brașov Marathon",
        links: [
          { kind: "SITE", url: "https://bm.example.test", labelRo: null, labelEn: null },
          { kind: "FACEBOOK", url: "https://facebook.com/bm", labelRo: "Pagina noastră", labelEn: null },
        ],
      },
    ]);
  });

  it("refuses a link that is not https, naming the partner and the link", () => {
    const parsed = parse([card("Salvamont", [{ url: "http://example.test" }])]);
    expect(parsed.success).toBe(false);
    expect(parsed.error?.issues.some((issue) => issue.path.join(".") === "coHosts.0.links.0.url")).toBe(true);
  });

  it("refuses a kind outside the list rather than turning it quietly into another", () => {
    const parsed = parse([card("Salvamont", [{ kind: "TIKTOK", url: "https://example.test/s" }])]);
    expect(parsed.success).toBe(false);
    expect(parsed.error?.issues.some((issue) => issue.path.join(".") === "coHosts.0.links.0.kind")).toBe(true);
  });

  it("refuses a label with no address beside it: somebody meant a link there", () => {
    const parsed = parse([card("Salvamont", [{ labelRo: "Facebook" }])]);
    expect(parsed.success).toBe(false);
  });

  it("refuses more links than one partner may carry, naming the partner", () => {
    const many = Array.from({ length: MAX_CO_HOST_LINKS + 1 }, (_, index) => ({ url: `https://example.test/${index}` }));
    const parsed = parse([card("Salvamont", many)]);
    expect(parsed.success).toBe(false);
    expect(parsed.error?.issues.some((issue) => issue.path.join(".") === "coHosts.0.links")).toBe(true);
    expect(parse([card("Salvamont", many.slice(0, MAX_CO_HOST_LINKS))]).success).toBe(true);
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
