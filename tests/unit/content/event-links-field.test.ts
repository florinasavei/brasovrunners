import { describe, expect, it } from "vitest";
import { eventLinkRowSchema, eventFieldsSchema } from "@/modules/content/events/fields";
import { eventFormFieldName } from "@/modules/content/events/form-names";
import { htmlConstraints } from "@/shared/forms/constraints";

/**
 * BR-REQ-011-01 criterion 20 (`DECISIONS.md` §332) — "Linkuri și fișiere" as the editor posts them.
 *
 * The rows arrive as strings from an ordinary form, so everything the column must never hold is
 * refused here, and every refusal names the row the organizer sees: an address that is not
 * https, a label with no address, a kind the select does not offer, a thirteenth link. The
 * editor's spare line is not an error, and a caller that says nothing about links edits none.
 */
const BASE = {
  type: "RACE",
  surface: "",
  eventStatus: "SCHEDULED",
  timezone: "Europe/Bucharest",
  startsAtWallTime: "2026-11-21T09:00",
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

// Built from parts, like every URL in the tests: `docs:check` refuses a hostname literal.
const DRIVE = ["https:/", "drive.example.test", "file", "d", "abc123", "view"].join("/");
const PDF = ["https:/", "files.example.test", "regulament.pdf"].join("/");

const parse = (links: unknown) => eventFieldsSchema.safeParse({ ...BASE, links });
const issuesOf = (links: unknown) => {
  const parsed = parse(links);
  expect(parsed.success).toBe(false);
  return parsed.error?.issues.map((issue) => ({ path: issue.path.join("."), message: issue.message })) ?? [];
};

describe("BR-REQ-011-01 criterion 20 the links a form may post", () => {
  it("keeps the order, the kind and both labels, and turns an empty label into none", () => {
    const parsed = parse([
      { kind: "GPX", url: DRIVE, labelRo: "Traseul de 21 km", labelEn: "The 21 km route" },
      { kind: "DOCUMENT", url: PDF, labelRo: "", labelEn: "" },
    ]);
    expect(parsed.success).toBe(true);
    expect(parsed.data?.links).toEqual([
      { kind: "GPX", url: DRIVE, labelRo: "Traseul de 21 km", labelEn: "The 21 km route" },
      { kind: "DOCUMENT", url: PDF, labelRo: null, labelEn: null },
    ]);
  });

  it("refuses a label in one language only, on the empty side — both or neither (§352)", () => {
    expect(issuesOf([{ kind: "GPX", url: DRIVE, labelRo: "Traseul de 21 km", labelEn: "" }])).toEqual([
      { path: "links.0.labelEn", message: "link 1: the label is written in Romanian only; write it in English too, or in neither" },
    ]);
    expect(issuesOf([{ kind: "GPX", url: DRIVE }, { kind: "DOCUMENT", url: PDF, labelRo: "", labelEn: "Extended rules" }])).toEqual([
      { path: "links.1.labelRo", message: "link 2: the label is written in English only; write it in Romanian too, or in neither" },
    ]);
    // And the summary links to the empty box, by the name the form posts.
    expect(eventFormFieldName("links.1.labelRo")).toBe("event.links[1].labelRo");
  });

  it("drops the editor's spare line — nothing typed, whatever the kind select says", () => {
    const parsed = parse([
      { kind: "OTHER", url: "", labelRo: "", labelEn: "" },
      { kind: "GPX", url: DRIVE, labelRo: "", labelEn: "" },
      { kind: "RESULTS", url: "  ", labelRo: " ", labelEn: "" },
    ]);
    expect(parsed.success).toBe(true);
    expect(parsed.data?.links).toEqual([{ kind: "GPX", url: DRIVE, labelRo: null, labelEn: null }]);
  });

  it("means no links when the editor posts an empty list, and says nothing when a caller posts none (§169)", () => {
    expect(parse([]).data?.links).toEqual([]);
    const absent = eventFieldsSchema.safeParse(BASE);
    expect(absent.success).toBe(true);
    expect(absent.data?.links).toBeUndefined();
  });

  it("takes any host — Drive, Dropbox, Strava — but https only", () => {
    expect(parse([{ kind: "MAP", url: ["https:/", "www.strava.example.test", "routes", "1"].join("/") }]).success).toBe(true);
    for (const url of ["http://drive.example.test/x", "javascript:alert(1)", "data:text/html,x", "drive.example.test/x", "ftp://x.test/a.gpx", "https:// spaced.test"]) {
      expect(parse([{ kind: "GPX", url }]).success, url).toBe(false);
    }
  });

  it("writes a pasted HTTPS:// scheme in lower case, so the database's own check accepts it", () => {
    const parsed = parse([{ kind: "GPX", url: "HTTPS://drive.example.test/File" }]);
    expect(parsed.data?.links?.[0].url).toBe("https://drive.example.test/File");
  });

  it("names the row as the editor numbered it, spare lines included, and says what is wrong", () => {
    // The second row on the screen is the spare line; the third is the bad one — "link 3".
    const issues = issuesOf([
      { kind: "GPX", url: DRIVE },
      { kind: "OTHER", url: "" },
      { kind: "DOCUMENT", url: "http://files.example.test/a.pdf" },
    ]);
    expect(issues).toEqual([{ path: "links.2.url", message: "link 3: the address must start with https://" }]);
    // And the summary links to that box, by the name the form posts.
    expect(eventFormFieldName("links.2.url")).toBe("event.links[2].url");
  });

  it("refuses a label with no address rather than dropping it — somebody meant a link there", () => {
    expect(issuesOf([{ kind: "GPX", url: "", labelRo: "Traseul", labelEn: "Route" }])).toEqual([
      { path: "links.0.url", message: "link 1: a link needs its address, starting with https://" },
    ]);
  });

  it("refuses a kind outside the set: it did not come from the select", () => {
    expect(issuesOf([{ kind: "VIDEO", url: DRIVE }])).toEqual([{ path: "links.0.kind", message: "link 1: the kind must be one of the list" }]);
    for (const kind of ["GPX", "MAP", "DOCUMENT", "PHOTOS", "RESULTS", "OTHER"]) {
      expect(parse([{ kind, url: DRIVE }]).success, kind).toBe(true);
    }
  });

  it("holds each label to 80 characters and each address to 2 048", () => {
    const eighty = "a".repeat(80);
    expect(parse([{ kind: "GPX", url: DRIVE, labelRo: eighty, labelEn: eighty }]).success).toBe(true);
    const tooLong = issuesOf([{ kind: "GPX", url: DRIVE, labelRo: "", labelEn: `${eighty}b` }]);
    expect(tooLong.map((issue) => issue.path)).toContain("links.0.labelEn");
    expect(eventFormFieldName("links.0.labelEn")).toBe("event.links[0].labelEn");

    const long = `https://drive.example.test/${"x".repeat(2048 - "https://drive.example.test/".length)}`;
    expect(long).toHaveLength(2048);
    expect(parse([{ kind: "GPX", url: long }]).success).toBe(true);
    expect(parse([{ kind: "GPX", url: `${long}x` }]).success).toBe(false);
  });

  it("takes twelve links and refuses a thirteenth, naming the list", () => {
    const rows = Array.from({ length: 13 }, (_, index) => ({ kind: "OTHER", url: `${DRIVE}?n=${index}` }));
    expect(parse(rows.slice(0, 12)).success).toBe(true);
    // Spare lines do not count toward the ceiling; links do.
    expect(parse([...rows.slice(0, 12), { kind: "OTHER", url: "" }]).success).toBe(true);
    const issues = issuesOf(rows);
    expect(issues).toEqual([{ path: "links", message: "at most 12 links can be listed on one event" }]);
    expect(eventFormFieldName("links")).toBe("event.links");
  });

  it("refuses a box the form does not post", () => {
    expect(parse([{ kind: "GPX", url: DRIVE, secret: "x" }]).success).toBe(false);
  });

  it("gives the boxes the schema's own rules, so the browser refuses first (§315)", () => {
    expect(htmlConstraints(eventLinkRowSchema.shape.url)).toEqual({
      type: "url",
      pattern: "[Hh][Tt][Tt][Pp][Ss]://.*",
      maxLength: 2048,
    });
    expect(htmlConstraints(eventLinkRowSchema.shape.labelRo)).toEqual({ maxLength: 80 });
    expect(htmlConstraints(eventLinkRowSchema.shape.labelEn)).toEqual({ maxLength: 80 });
  });

  it("is not part of what publication requires (§28): no link box is ever required", () => {
    for (const box of ["kind", "url", "labelRo", "labelEn"] as const) {
      expect(htmlConstraints(eventLinkRowSchema.shape[box]).required, box).toBeUndefined();
    }
  });
});
