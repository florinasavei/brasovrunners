import { describe, expect, it } from "vitest";
import { declarationWords } from "@/modules/registrations/declaration-labels";
import { declarationFooterLine, declarationVersionLine, pageOwners } from "@/modules/registrations/declaration-pdf";

/**
 * §NNN — every declaration document says which version it is: under each entry's title and in
 * the footer of every page, the version's number and the start of its hash, so a page that
 * travels alone still names the approved text it carries.
 */
const HASH = "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";
const NOW = new Date("2026-09-27T10:00:00.000Z");

describe("§NNN the declaration's version line", () => {
  it("names the version and the first sixteen characters of the hash, in the declaration's language", () => {
    expect(declarationVersionLine({ version: 3, contentSha256: HASH }, declarationWords("ro", NOW).version)).toBe("Versiunea 3 · sha256 0123456789abcdef…");
    expect(declarationVersionLine({ version: 3, contentSha256: HASH }, declarationWords("en", NOW).version)).toBe("Version 3 · sha256 0123456789abcdef…");
  });

  it("puts the page's own version between the club and the date in the footer", () => {
    const labels = declarationWords("ro", NOW);
    const line = declarationFooterLine({ version: 7, contentSha256: HASH }, labels);
    expect(line).toBe(`${labels.organization} · Versiunea 7 · sha256 0123456789abcdef… · ${labels.generatedOn}`);
  });

  it("says what it said before on a page that holds no declaration (the empty bundle)", () => {
    const labels = declarationWords("en", NOW);
    expect(declarationFooterLine(undefined, labels)).toBe(`${labels.organization} · ${labels.generatedOn}`);
  });
});

describe("§NNN each page's footer names its own entry's version", () => {
  it("gives every page to the entry drawn on it, however many pages each took", () => {
    const older = { version: 1 };
    const newer = { version: 2 };
    // Two pages of the first entry, one of the second, two of a third.
    expect(pageOwners([older, newer, older], [2, 3, 5]).map((entry) => entry.version)).toEqual([1, 1, 2, 1, 1]);
  });

  it("is empty for a file with no entries", () => {
    expect(pageOwners([], [])).toEqual([]);
  });
});
