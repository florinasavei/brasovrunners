import { describe, expect, it } from "vitest";
import { declarationWords } from "@/modules/registrations/declaration-labels";
import { declarationFooterLine, declarationVersionLine, pageOwners } from "@/modules/registrations/declaration-pdf";

/**
 * §499 — every declaration document says which version it is: under each entry's title and in
 * the footer of every page, the version's number and the day it took effect — the signing pages'
 * own «Versiunea N, în vigoare din …» — so a page that travels alone still names the approved text
 * it carries, and a signed page says when it was signed.
 */
const HASH = "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";
const NOW = new Date("2026-09-27T10:00:00.000Z");
/**
 * 22:30 UTC on Friday 11 September is 01:30 on Saturday 12 September in Brașov: the day the club
 * reads is the club's clock's (`CLUB_TIME_ZONE`), never the server's UTC one.
 */
const EFFECTIVE = new Date("2026-09-11T22:30:00.000Z");

describe("§499 the declaration's version line", () => {
  it("names the version and the day it took effect, the whole date with the month in words and no weekday (§NNN), on the club's clock, in both languages", () => {
    expect(declarationWords("ro", NOW).versionInForce(3, EFFECTIVE)).toBe("Versiunea 3, în vigoare din 12 septembrie 2026");
    expect(declarationWords("en", NOW).versionInForce(3, EFFECTIVE)).toBe("Version 3, in force since 12 September 2026");
  });

  it("puts the start of the hash after it under the title", () => {
    const entry = { version: 3, contentSha256: HASH, effectiveAt: EFFECTIVE };
    expect(declarationVersionLine(entry, declarationWords("ro", NOW))).toBe("Versiunea 3, în vigoare din 12 septembrie 2026 · sha256 0123456789abcdef…");
    expect(declarationVersionLine(entry, declarationWords("en", NOW))).toBe("Version 3, in force since 12 September 2026 · sha256 0123456789abcdef…");
  });

  it("says in a signed page's footer the club, the page's own version in force and when it was signed", () => {
    const signature = { signedAtInline: "joi, 24 sept. 2026, la 18:05" };
    expect(declarationFooterLine({ version: 7, effectiveAt: EFFECTIVE, signature }, declarationWords("ro", NOW))).toBe(
      `${declarationWords("ro", NOW).organization} · Versiunea 7, în vigoare din 12 septembrie 2026 · semnată joi, 24 sept. 2026, la 18:05`,
    );
    expect(declarationFooterLine({ version: 7, effectiveAt: EFFECTIVE, signature: { signedAtInline: "Thursday, 24 Sept 2026, at 18:05" } }, declarationWords("en", NOW))).toBe(
      `${declarationWords("en", NOW).organization} · Version 7, in force since 12 September 2026 · signed on Thursday, 24 Sept 2026, at 18:05`,
    );
  });

  it("says on the blank form's footer when the file was drawn, the form having no signature", () => {
    const labels = declarationWords("ro", NOW);
    expect(declarationFooterLine({ version: 2, effectiveAt: EFFECTIVE }, labels)).toBe(
      `${labels.organization} · Versiunea 2, în vigoare din 12 septembrie 2026 · ${labels.generatedOn}`,
    );
  });

  it("says what it said before on a page that holds no declaration (the empty bundle)", () => {
    const labels = declarationWords("en", NOW);
    expect(declarationFooterLine(undefined, labels)).toBe(`${labels.organization} · ${labels.generatedOn}`);
  });
});

describe("§499 each page's footer names its own entry's version", () => {
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
