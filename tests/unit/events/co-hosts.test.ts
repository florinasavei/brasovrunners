import { describe, expect, it } from "vitest";
import {
  coHostDescription,
  coHostLinkHost,
  coHostLinkLabel,
  coHostLinksForPage,
  hasOneLanguageCoHostDescription,
  hasOneLanguageCoHostLabel,
  MAX_CO_HOST_DESCRIPTION,
  MAX_CO_HOST_LINKS,
  MAX_CO_HOSTS,
  primaryCoHostLink,
  readCoHosts,
} from "@/modules/events/domain/co-hosts";

/**
 * BR-REQ-011-01 criterion 16 (`DECISIONS.md` §168, extended by §344 into a card of links each)
 * — an event is held with any number of partners, each carrying any number of links, and a row
 * written before either release still says the one thing it has.
 *
 * The reading rule is the whole of the migration: nothing rewrites `co_host_name` or a stored
 * `{ name, url }` into `{ name, links }`, so every row in the database is one of these three
 * shapes until its next save.
 */
const row = (values: Partial<Parameters<typeof readCoHosts>[0]> = {}) => ({
  coHosts: null,
  coHostName: null,
  coHostUrl: null,
  ...values,
});

/** A site link, the one a bare `url` — old column or old list entry — always meant (§168). */
const site = (url: string) => [{ kind: "SITE", url, labelRo: null, labelEn: null }];

/** A partner as `readCoHosts` answers it: no description unless the row stored one (§352). */
const host = (name: string, links: unknown[] = []) => ({ name, descriptionRo: null, descriptionEn: null, links });

describe("BR-REQ-011-01 criterion 16 reading an event's partners", () => {
  it("reads a row written before the list as the one co-host its two columns hold", () => {
    expect(readCoHosts(row({ coHostName: "Clubul Alpin", coHostUrl: "https://alpin.example.test" }))).toEqual([
      host("Clubul Alpin", site("https://alpin.example.test")),
    ]);
  });

  it("drops a page that is not https, and keeps the name", () => {
    expect(readCoHosts(row({ coHostName: "Clubul Alpin", coHostUrl: "http://alpin.example.test" }))).toEqual([
      host("Clubul Alpin"),
    ]);
  });

  it("has no partners when neither the list nor the old columns say one", () => {
    expect(readCoHosts(row())).toEqual([]);
  });

  it("reads the list, in the order the club wrote it, a page being optional on each", () => {
    expect(
      readCoHosts(
        row({
          coHosts: [{ name: "Brașov Marathon", url: "https://example.test/bm" }, { name: "Salvamont" }],
          coHostName: "Clubul Alpin",
        }),
      ),
    ).toEqual([
      host("Brașov Marathon", site("https://example.test/bm")),
      host("Salvamont"),
    ]);
  });

  it("treats an empty list as an answer: the club removed every partner, so the old column stays unread", () => {
    // The failure this pins: a save that clears the partners leaves `co_host_name` exactly
    // as it was — expand only — and falling back to it would put the deleted name back on
    // the page at the next render.
    expect(readCoHosts(row({ coHosts: [], coHostName: "Clubul Alpin" }))).toEqual([]);
  });

  it("drops a partner that is not one — no name, a shape nobody wrote", () => {
    expect(
      readCoHosts(
        row({
          coHosts: [{ name: "   " }, "Clubul Alpin", { name: "Brașov Marathon", url: "https://example.test/bm" }],
        }),
      ),
    ).toEqual([host("Brașov Marathon", site("https://example.test/bm"))]);
  });

  it("keeps the partner and loses the link when the stored page is not https (§169)", () => {
    // The same failure mode as the two old columns above: the club loses the link, never the
    // partner. Dropping the row would have taken a name the club typed off the page because
    // of an address it did not.
    expect(readCoHosts(row({ coHosts: [{ name: "Salvamont", url: "javascript:alert(1)" }] }))).toEqual([host("Salvamont")]);
  });

  it("ignores a key a later release adds rather than reading the row as having no partners (§169)", () => {
    // Not `.strict()`: mid-release the other deployment still runs today's code, and a row
    // carrying tomorrow's key must still name its partners there.
    expect(readCoHosts(row({ coHosts: [{ name: "Salvamont", url: null, logoUrl: "https://example.test/l.png" }] }))).toEqual([host("Salvamont")]);
  });

  it("keeps at most the eight a form may post, whatever a hand-written UPDATE stored", () => {
    const many = Array.from({ length: 12 }, (_, index) => ({ name: `Partener ${index}` }));
    expect(readCoHosts(row({ coHosts: many }))).toHaveLength(MAX_CO_HOSTS);
  });

  it("reads this release's shape — a card of links, in the club's own order (§344)", () => {
    expect(
      readCoHosts(
        row({
          coHosts: [
            {
              name: "Brașov Marathon",
              links: [
                { kind: "SITE", url: "https://bm.example.test" },
                { kind: "FACEBOOK", url: "https://facebook.com/bm", labelRo: "Pagina noastră" },
              ],
            },
          ],
        }),
      ),
    ).toEqual([
      host("Brașov Marathon", [
        { kind: "SITE", url: "https://bm.example.test", labelRo: null, labelEn: null },
        { kind: "FACEBOOK", url: "https://facebook.com/bm", labelRo: "Pagina noastră", labelEn: null },
      ]),
    ]);
  });

  it("keeps a partner with no links at all — a name is still an answer (§344)", () => {
    expect(readCoHosts(row({ coHosts: [{ name: "Salvamont", links: [] }] }))).toEqual([host("Salvamont")]);
  });

  it("reads an unknown link kind as other rather than dropping the link", () => {
    expect(readCoHosts(row({ coHosts: [{ name: "Salvamont", links: [{ kind: "TIKTOK", url: "https://example.test/s" }] }] }))).toEqual([
      host("Salvamont", [{ kind: "OTHER", url: "https://example.test/s", labelRo: null, labelEn: null }]),
    ]);
  });

  it("drops a link that is not https and keeps the rest of the partner's links", () => {
    expect(
      readCoHosts(
        row({
          coHosts: [
            {
              name: "Salvamont",
              links: [{ kind: "SITE", url: "javascript:alert(1)" }, { kind: "STRAVA", url: "https://strava.com/clubs/1" }],
            },
          ],
        }),
      ),
    ).toEqual([host("Salvamont", [{ kind: "STRAVA", url: "https://strava.com/clubs/1", labelRo: null, labelEn: null }])]);
  });

  it("keeps at most the eight links a form may post on one partner", () => {
    const many = Array.from({ length: 12 }, (_, index) => ({ kind: "OTHER", url: `https://example.test/${index}` }));
    expect(readCoHosts(row({ coHosts: [{ name: "Salvamont", links: many }] }))[0].links).toHaveLength(MAX_CO_HOST_LINKS);
  });
});

describe("BR-REQ-011-01 criterion 16 a partner's one link for a sentence (§344)", () => {
  it("is the site link when the partner named one, whatever order the links are in", () => {
    const [host] = readCoHosts(
      row({ coHosts: [{ name: "Salvamont", links: [{ kind: "FACEBOOK", url: "https://facebook.com/s" }, { kind: "SITE", url: "https://s.example.test" }] }] }),
    );
    expect(primaryCoHostLink(host)).toEqual({ kind: "SITE", url: "https://s.example.test", labelRo: null, labelEn: null });
  });

  it("is the first link when the partner named no site", () => {
    const [host] = readCoHosts(row({ coHosts: [{ name: "Salvamont", links: [{ kind: "STRAVA", url: "https://strava.com/clubs/1" }] }] }));
    expect(primaryCoHostLink(host)).toEqual({ kind: "STRAVA", url: "https://strava.com/clubs/1", labelRo: null, labelEn: null });
  });

  it("is nothing when the partner named no link at all", () => {
    const [host] = readCoHosts(row({ coHosts: [{ name: "Salvamont", links: [] }] }));
    expect(primaryCoHostLink(host)).toBeNull();
  });
});

describe("BR-REQ-011-01 criterion 16 a partner link's label and host, in each language", () => {
  const link = { kind: "SITE" as const, url: "https://www.example.test/parteneri?ref=br", labelRo: "Site-ul lor", labelEn: "Their site" };

  it("is the club's own word in each language when it wrote both", () => {
    expect(coHostLinkLabel(link, "ro")).toBe("Site-ul lor");
    expect(coHostLinkLabel(link, "en")).toBe("Their site");
    expect(hasOneLanguageCoHostLabel(link)).toBe(false);
  });

  it("is null in both languages when the club wrote one only, so both pages show the kind's own word (§354)", () => {
    const half = { ...link, labelEn: null };
    expect(coHostLinkLabel(half, "ro")).toBeNull();
    expect(coHostLinkLabel(half, "en")).toBeNull();
    expect(coHostLinkLabel({ ...link, labelRo: null }, "en")).toBeNull();
    expect(hasOneLanguageCoHostLabel(half)).toBe(true);
    expect(hasOneLanguageCoHostLabel({ ...link, labelRo: null, labelEn: null })).toBe(false);
    expect(hasOneLanguageCoHostDescription({ descriptionRo: "Alergăm împreună.", descriptionEn: null })).toBe(true);
    expect(hasOneLanguageCoHostDescription({ descriptionRo: null, descriptionEn: null })).toBe(false);
  });

  it("reads the host without the leading www, for the small text under the label", () => {
    expect(coHostLinkHost(link.url)).toBe("example.test");
  });
});

/**
 * BR-REQ-011-01 criterion 16 (§352) — what the partnership is, in a sentence or two per language,
 * stored inside the same `co_hosts` list and read as leniently as the rest of the card.
 */
describe("BR-REQ-011-01 criterion 16 a partner's description, as stored", () => {
  const described = (descriptionRo: unknown, descriptionEn: unknown) =>
    readCoHosts(row({ coHosts: [{ name: "Brașov Running Festival", descriptionRo, descriptionEn, links: [] }] }))[0];

  it("reads both languages as written, one paragraph each", () => {
    const partner = described("Alergăm împreună duminică.", "We run together on Sunday.");
    expect(partner.descriptionRo).toBe("Alergăm împreună duminică.");
    expect(partner.descriptionEn).toBe("We run together on Sunday.");
  });

  it("reads every older shape with no description at all — the list's two releases and the two columns", () => {
    const [fromColumns] = readCoHosts(row({ coHostName: "Clubul Alpin", coHostUrl: "https://alpin.example.test" }));
    const [fromUrl] = readCoHosts(row({ coHosts: [{ name: "Salvamont", url: "https://example.test/s" }] }));
    const [fromLinks] = readCoHosts(row({ coHosts: [{ name: "Salvamont", links: [{ kind: "SITE", url: "https://example.test/s" }] }] }));
    for (const partner of [fromColumns, fromUrl, fromLinks]) {
      expect(partner.descriptionRo).toBeNull();
      expect(partner.descriptionEn).toBeNull();
    }
  });

  it("reads anything that is not a usable text as none, and keeps the partner", () => {
    for (const junk of [42, { text: "x" }, ["x"], null, "", "   \n\t  "]) {
      const partner = described(junk, junk);
      expect(partner.name).toBe("Brașov Running Festival");
      expect(partner.descriptionRo).toBeNull();
      expect(partner.descriptionEn).toBeNull();
    }
  });

  it("collapses line breaks and runs of spaces into one paragraph", () => {
    expect(described("Alergăm\r\nîmpreună   duminică.\n", "x").descriptionRo).toBe("Alergăm împreună duminică.");
  });

  it("keeps a text of exactly the ceiling and reads a longer one as none, never cut in the middle", () => {
    const atCeiling = "a".repeat(MAX_CO_HOST_DESCRIPTION);
    expect(described(atCeiling, atCeiling).descriptionRo).toBe(atCeiling);
    expect(described(`${atCeiling}a`, atCeiling).descriptionRo).toBeNull();
  });
});

describe("BR-REQ-011-01 criterion 16 a partner's description on a public page: both languages or neither (§352)", () => {
  it("is the reader's language when the club wrote both", () => {
    const partner = { descriptionRo: "Alergăm împreună.", descriptionEn: "We run together." };
    expect(coHostDescription(partner, "ro")).toBe("Alergăm împreună.");
    expect(coHostDescription(partner, "en")).toBe("We run together.");
  });

  it("is nothing in either language when a stored row holds only one — never the other language's sentence", () => {
    const [partner] = readCoHosts(row({ coHosts: [{ name: "Brașov Running Festival", descriptionRo: "Alergăm împreună.", links: [] }] }));
    // The editor still reads the half, so it can be completed…
    expect(partner.descriptionRo).toBe("Alergăm împreună.");
    expect(partner.descriptionEn).toBeNull();
    // …and no page shows it: not on the English page, and not on the Romanian page either.
    expect(coHostDescription(partner, "en")).toBeNull();
    expect(coHostDescription(partner, "ro")).toBeNull();
    expect(coHostDescription({ descriptionRo: null, descriptionEn: "We run together." }, "en")).toBeNull();
  });
});

describe("BR-REQ-011-01 criterion 16 a partner's links in the page's order (§352)", () => {
  it("puts where to register first, and the rest in the club's own order", () => {
    const links = [
      { kind: "SITE" as const, url: "https://a.test", labelRo: null, labelEn: null },
      { kind: "FACEBOOK" as const, url: "https://b.test", labelRo: null, labelEn: null },
      { kind: "REGISTRATION" as const, url: "https://c.test", labelRo: null, labelEn: null },
      { kind: "EVENT" as const, url: "https://d.test", labelRo: null, labelEn: null },
    ];
    expect(coHostLinksForPage({ links }).map((link) => link.url)).toEqual(["https://c.test", "https://a.test", "https://b.test", "https://d.test"]);
  });

  it("leaves a card with no registration link exactly as ordered", () => {
    const links = [
      { kind: "EVENT" as const, url: "https://d.test", labelRo: null, labelEn: null },
      { kind: "SITE" as const, url: "https://a.test", labelRo: null, labelEn: null },
    ];
    expect(coHostLinksForPage({ links })).toEqual(links);
  });
});
