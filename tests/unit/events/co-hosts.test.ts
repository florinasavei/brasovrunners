import { describe, expect, it } from "vitest";
import { coHostLinkHost, coHostLinkLabel, MAX_CO_HOST_LINKS, MAX_CO_HOSTS, primaryCoHostLink, readCoHosts } from "@/modules/events/domain/co-hosts";

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

describe("BR-REQ-011-01 criterion 16 reading an event's partners", () => {
  it("reads a row written before the list as the one co-host its two columns hold", () => {
    expect(readCoHosts(row({ coHostName: "Clubul Alpin", coHostUrl: "https://alpin.example.test" }))).toEqual([
      { name: "Clubul Alpin", links: site("https://alpin.example.test") },
    ]);
  });

  it("drops a page that is not https, and keeps the name", () => {
    expect(readCoHosts(row({ coHostName: "Clubul Alpin", coHostUrl: "http://alpin.example.test" }))).toEqual([
      { name: "Clubul Alpin", links: [] },
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
      { name: "Brașov Marathon", links: site("https://example.test/bm") },
      { name: "Salvamont", links: [] },
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
    ).toEqual([{ name: "Brașov Marathon", links: site("https://example.test/bm") }]);
  });

  it("keeps the partner and loses the link when the stored page is not https (§169)", () => {
    // The same failure mode as the two old columns above: the club loses the link, never the
    // partner. Dropping the row would have taken a name the club typed off the page because
    // of an address it did not.
    expect(readCoHosts(row({ coHosts: [{ name: "Salvamont", url: "javascript:alert(1)" }] }))).toEqual([
      { name: "Salvamont", links: [] },
    ]);
  });

  it("ignores a key a later release adds rather than reading the row as having no partners (§169)", () => {
    // Not `.strict()`: mid-release the other deployment still runs today's code, and a row
    // carrying tomorrow's key must still name its partners there.
    expect(readCoHosts(row({ coHosts: [{ name: "Salvamont", url: null, logoUrl: "https://example.test/l.png" }] }))).toEqual([
      { name: "Salvamont", links: [] },
    ]);
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
      {
        name: "Brașov Marathon",
        links: [
          { kind: "SITE", url: "https://bm.example.test", labelRo: null, labelEn: null },
          { kind: "FACEBOOK", url: "https://facebook.com/bm", labelRo: "Pagina noastră", labelEn: null },
        ],
      },
    ]);
  });

  it("keeps a partner with no links at all — a name is still an answer (§344)", () => {
    expect(readCoHosts(row({ coHosts: [{ name: "Salvamont", links: [] }] }))).toEqual([{ name: "Salvamont", links: [] }]);
  });

  it("reads an unknown link kind as other rather than dropping the link", () => {
    expect(readCoHosts(row({ coHosts: [{ name: "Salvamont", links: [{ kind: "TIKTOK", url: "https://example.test/s" }] }] }))).toEqual([
      { name: "Salvamont", links: [{ kind: "OTHER", url: "https://example.test/s", labelRo: null, labelEn: null }] },
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
    ).toEqual([{ name: "Salvamont", links: [{ kind: "STRAVA", url: "https://strava.com/clubs/1", labelRo: null, labelEn: null }] }]);
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
  const link = { kind: "SITE" as const, url: "https://www.example.test/parteneri?ref=br", labelRo: "Site-ul lor", labelEn: null };

  it("is the club's own word when it wrote one, in that language only", () => {
    expect(coHostLinkLabel(link, "ro")).toBe("Site-ul lor");
  });

  it("is null in a language the club did not write, so the caller shows the kind's own word", () => {
    expect(coHostLinkLabel(link, "en")).toBeNull();
    expect(coHostLinkLabel({ ...link, labelRo: null }, "ro")).toBeNull();
  });

  it("reads the host without the leading www, for the small text under the label", () => {
    expect(coHostLinkHost(link.url)).toBe("example.test");
  });
});
