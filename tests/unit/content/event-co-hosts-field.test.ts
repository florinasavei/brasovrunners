import { describe, expect, it } from "vitest";
import { MAX_CO_HOST_DESCRIPTION, MAX_CO_HOST_LINKS, MAX_CO_HOSTS } from "@/modules/events/domain/co-hosts";
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
const card = (
  name: string,
  links: Array<Partial<{ kind: string; url: string; labelRo: string; labelEn: string }>> = [],
  description: Partial<{ descriptionRo: string; descriptionEn: string }> = {},
) => ({
  name,
  descriptionRo: "",
  descriptionEn: "",
  ...description,
  links: links.map((link) => ({ kind: "SITE", url: "", labelRo: "", labelEn: "", ...link })),
});

/** A partner as the schema hands it to the service: no description unless one was typed (§NNN). */
const saved = (name: string, links: unknown[] = []) => ({ name, descriptionRo: null, descriptionEn: null, links });

const pathsOf = (parsed: ReturnType<typeof parse>) => (parsed.error?.issues ?? []).map((issue) => issue.path.join("."));

describe("BR-REQ-011-01 criterion 16 the partners a form may post", () => {
  it("keeps the order and turns a card with no links into a name alone", () => {
    const parsed = parse([
      card("Brașov Marathon", [{ url: "https://example.test/bm" }]),
      card("Salvamont"),
    ]);
    expect(parsed.success).toBe(true);
    expect(parsed.data?.coHosts).toEqual([
      saved("Brașov Marathon", [{ kind: "SITE", url: "https://example.test/bm", labelRo: null, labelEn: null }]),
      saved("Salvamont"),
    ]);
  });

  it("drops the editor's spare card and its spare link row rather than refusing them", () => {
    const parsed = parse([card("Salvamont", [{ url: "" }]), card("")]);
    expect(parsed.success).toBe(true);
    expect(parsed.data?.coHosts).toEqual([saved("Salvamont")]);
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
    expect(parsed.data?.coHosts).toEqual([saved("Salvamont")]);
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
        { kind: "FACEBOOK", url: "https://facebook.com/bm", labelRo: "Pagina noastră", labelEn: "Our page" },
      ]),
    ]);
    expect(parsed.success).toBe(true);
    expect(parsed.data?.coHosts).toEqual([
      saved("Brașov Marathon", [
        { kind: "SITE", url: "https://bm.example.test", labelRo: null, labelEn: null },
        { kind: "FACEBOOK", url: "https://facebook.com/bm", labelRo: "Pagina noastră", labelEn: "Our page" },
      ]),
    ]);
  });

  it("refuses a label of the club's own in one language only, on the empty side — both or neither (§NNN)", () => {
    const englishMissing = parse([card("Salvamont", [{ url: "https://example.test/s" }, { url: "https://facebook.com/s", labelRo: "Pagina noastră" }])]);
    expect(englishMissing.success).toBe(false);
    expect(pathsOf(englishMissing)).toEqual(["coHosts.0.links.1.labelEn"]);
    expect(JSON.stringify(englishMissing.error?.issues)).toContain("partner 1, link 2");

    const romanianMissing = parse([card("Salvamont", [{ url: "https://facebook.com/s", labelEn: "Our page" }])]);
    expect(romanianMissing.success).toBe(false);
    expect(pathsOf(romanianMissing)).toEqual(["coHosts.0.links.0.labelRo"]);
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

/**
 * BR-REQ-011-01 criterion 16 (§NNN) — what the partnership is, one short paragraph in each
 * language, and never in one language alone.
 */
describe("BR-REQ-011-01 criterion 16 a partner's description, as the editor posts it (§NNN)", () => {
  it("keeps a description written in both languages, as one paragraph each", () => {
    const parsed = parse([
      card("Brașov Running Festival", [{ kind: "REGISTRATION", url: "https://festival.example.test/inscriere" }], {
        descriptionRo: "Alergăm împreună\r\nduminică,   la festival.",
        descriptionEn: "  We run together on Sunday, at the festival. ",
      }),
    ]);
    expect(parsed.success).toBe(true);
    expect(parsed.data?.coHosts).toEqual([
      {
        name: "Brașov Running Festival",
        descriptionRo: "Alergăm împreună duminică, la festival.",
        descriptionEn: "We run together on Sunday, at the festival.",
        links: [{ kind: "REGISTRATION", url: "https://festival.example.test/inscriere", labelRo: null, labelEn: null }],
      },
    ]);
  });

  it("refuses a description in Romanian only, naming the English box", () => {
    const parsed = parse([card("Brașov Running Festival", [], { descriptionRo: "Alergăm împreună." })]);
    expect(parsed.success).toBe(false);
    expect(pathsOf(parsed)).toEqual(["coHosts.0.descriptionEn"]);
    expect(JSON.stringify(parsed.error?.issues)).toContain("partner 1");
  });

  it("refuses a description in English only, naming the Romanian box — on the card the editor numbered", () => {
    const parsed = parse([card("Salvamont"), card("Brașov Running Festival", [], { descriptionEn: "We run together." })]);
    expect(parsed.success).toBe(false);
    expect(pathsOf(parsed)).toEqual(["coHosts.1.descriptionRo"]);
  });

  it("treats a box of spaces and line breaks as empty, so it is neither a description nor half of one", () => {
    const parsed = parse([card("Salvamont", [], { descriptionRo: " \n ", descriptionEn: "" })]);
    expect(parsed.success).toBe(true);
    expect(parsed.data?.coHosts).toEqual([saved("Salvamont")]);
  });

  it("refuses a description longer than the ceiling, counted after the line breaks are collapsed", () => {
    const atCeiling = "a".repeat(MAX_CO_HOST_DESCRIPTION);
    expect(parse([card("Salvamont", [], { descriptionRo: atCeiling, descriptionEn: atCeiling })]).success).toBe(true);
    // A line break the browser counts as one character posts as two; collapsed, it fits.
    const withBreak = `${"a".repeat(MAX_CO_HOST_DESCRIPTION - 2)}\r\na`;
    expect(parse([card("Salvamont", [], { descriptionRo: withBreak, descriptionEn: atCeiling })]).success).toBe(true);
    const tooLong = parse([card("Salvamont", [], { descriptionRo: `${atCeiling}a`, descriptionEn: atCeiling })]);
    expect(tooLong.success).toBe(false);
    expect(pathsOf(tooLong)).toEqual(["coHosts.0.descriptionRo"]);
  });

  it("refuses a description with nobody's name above it: somebody meant a partner there", () => {
    const parsed = parse([card("", [], { descriptionRo: "Alergăm împreună.", descriptionEn: "We run together." })]);
    expect(parsed.success).toBe(false);
    expect(pathsOf(parsed)).toEqual(["coHosts.0.name"]);
  });
});
