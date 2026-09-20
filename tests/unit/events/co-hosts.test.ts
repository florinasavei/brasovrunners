import { describe, expect, it } from "vitest";
import { MAX_CO_HOSTS, readCoHosts } from "@/modules/events/domain/co-hosts";

/**
 * BR-REQ-011-01 criterion 16 (`DECISIONS.md` §168) — an event is held with any number of
 * partners, and a row written before the list existed still says the one it has.
 *
 * The reading rule is the whole of the migration: nothing rewrites `co_host_name` into the
 * list, so every row in the database is one of these three cases until its next save.
 */
const row = (values: Partial<Parameters<typeof readCoHosts>[0]> = {}) => ({
  coHosts: null,
  coHostName: null,
  coHostUrl: null,
  ...values,
});

describe("BR-REQ-011-01 criterion 16 reading an event's partners", () => {
  it("reads a row written before the list as the one co-host its two columns hold", () => {
    expect(readCoHosts(row({ coHostName: "Clubul Alpin", coHostUrl: "https://alpin.example.test" }))).toEqual([
      { name: "Clubul Alpin", url: "https://alpin.example.test" },
    ]);
  });

  it("drops a page that is not https, and keeps the name", () => {
    expect(readCoHosts(row({ coHostName: "Clubul Alpin", coHostUrl: "http://alpin.example.test" }))).toEqual([
      { name: "Clubul Alpin", url: null },
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
      { name: "Brașov Marathon", url: "https://example.test/bm" },
      { name: "Salvamont", url: null },
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
    ).toEqual([{ name: "Brașov Marathon", url: "https://example.test/bm" }]);
  });

  it("keeps the partner and loses the link when the stored page is not https (§169)", () => {
    // The same failure mode as the two old columns above: the club loses the link, never the
    // partner. Dropping the row would have taken a name the club typed off the page because
    // of an address it did not.
    expect(readCoHosts(row({ coHosts: [{ name: "Salvamont", url: "javascript:alert(1)" }] }))).toEqual([
      { name: "Salvamont", url: null },
    ]);
  });

  it("ignores a key a later release adds rather than reading the row as having no partners (§169)", () => {
    // Not `.strict()`: mid-release the other deployment still runs today's code, and a row
    // carrying tomorrow's key must still name its partners there.
    expect(readCoHosts(row({ coHosts: [{ name: "Salvamont", url: null, logoUrl: "https://example.test/l.png" }] }))).toEqual([
      { name: "Salvamont", url: null },
    ]);
  });

  it("keeps at most the eight a form may post, whatever a hand-written UPDATE stored", () => {
    const many = Array.from({ length: 12 }, (_, index) => ({ name: `Partener ${index}` }));
    expect(readCoHosts(row({ coHosts: many }))).toHaveLength(MAX_CO_HOSTS);
  });
});
