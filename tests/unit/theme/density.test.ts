import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { DENSITY } from "@/theme/density";

/**
 * `DECISIONS.md` §NNN — one phone density scale, used everywhere the public pages set a
 * spacing value below `sm`, rather than a number chosen fresh in each component.
 *
 * A grep-style walk, in the spirit of `tests/unit/theme/surfaces.test.ts`'s own function scan:
 * it reads every `.tsx`/`.ts` source file under the public listing, event-page, calendar and
 * standing-page directories, finds every spacing prop (`py`, `px`, `pt`, `pb`, `pl`, `pr`,
 * `mt`, `mb`, `ml`, `mr`, `my`, `mx`, `gap`, `rowGap`, `columnGap`) written as `{ xs: <value>,
 * … }`, and refuses one whose `xs` side is a bare number rather than a `DENSITY.<name>`
 * identifier — unless the line is on the short, named allowlist below, each entry with the
 * reason it stays a literal. Matching the identifier rather than the number is deliberate
 * (§NNN, review round 2): a match on "does this number equal some `DENSITY` value" lets a
 * revert to the pre-change literal (`xs: 2`, `xs: 1.5`, `xs: 2.5`, …) stay green, because those
 * are exactly the old values the scale replaced. A bare `xs: 0` still passes — zero is not a
 * mobile-only excess in either form.
 */

const TARGET_DIRS = [
  "src/modules/events/ui",
  "src/app/[locale]/events",
  "src/app/[locale]/calendar",
  "src/app/[locale]/pages",
];

const ROOT = join(__dirname, "..", "..", "..");

function walk(dir: string): string[] {
  const entries = readdirSync(dir);
  return entries.flatMap((entry) => {
    const full = join(dir, entry);
    const stats = statSync(full);
    if (stats.isDirectory()) return walk(full);
    if (/\.(tsx|ts)$/.test(entry) && !entry.endsWith(".test.ts") && !entry.endsWith(".test.tsx")) return [full];
    return [];
  });
}

const SPACING_PROPS = "py|px|pt|pb|pl|pr|mt|mb|ml|mr|my|mx|gap|rowGap|columnGap";
// A bare number on the `xs` side of a breakpoint object — `xs: DENSITY.gapSm` never matches this,
// only `xs: 1` or `xs: 1.5` would.
const XS_NUMBER_LITERAL = new RegExp(`\\b(${SPACING_PROPS}):\\s*\\{\\s*xs:\\s*(-?[\\d.]+)`, "g");

/**
 * Pre-existing `xs` literals this pass leaves alone, each for a reason recorded where the code
 * itself lives — not "too much whitespace", the thing this scale fixes:
 *
 * - `CalendarEventChip.tsx` `mr: { xs: 0, sm: 0.5 }` — the xs value is 0, nothing to tighten.
 * - `CalendarSection.tsx` and `share-pill.ts` `px: { xs: 1.5, sm: 1.25 }` — a chip's own tap
 *   padding, already *larger* on a phone than a desktop; not a mobile-only excess.
 * - `EventFacts.tsx`'s `rowGap`, `pl` and `mb` on the event page's own `<dl>` — alignment (the
 *   label column collapsing on a phone, §356), not the padding-and-gaps whitespace the owner
 *   pointed at.
 * - `events/[slug]/register/page.tsx`'s `Container` `py` — the registration form, a distinct
 *   surface the owner did not point at ("the listing and an event page"); left for a pass of
 *   its own rather than folded into this one without being asked.
 */
const ALLOWED_RAW_LINES = [
  'mr: { xs: 0, sm: 0.5 } }>',
  'px: { xs: 1.5, sm: 1.25 },',
  'rowGap: { xs: 0.5, sm: 1.5 },',
  'pl: { xs: 3.5, sm: 0 }, mb: { xs: 1, sm: 0 } }}>',
  'sx={{ py: { xs: 2, sm: 3 } }}>',
];

describe("DECISIONS.md §NNN the public pages share one phone density scale", () => {
  it("defines the scale as MUI spacing units, one step per name", () => {
    expect(DENSITY.pagePadY).toBeLessThan(2);
    expect(DENSITY.cardPadTop).toBeLessThan(2);
    expect(DENSITY.cardGridGap).toBeLessThan(1.5);
    expect(DENSITY.heroPad).toBeLessThan(2.5);
    expect(DENSITY.gapSm).toBeLessThan(2);
    expect(DENSITY.sectionGap).toBeLessThan(3);
    expect(DENSITY.sectionGapLg).toBeLessThan(4);
    // Every value is positive: this is a smaller gap, never a negative margin trick.
    for (const [name, value] of Object.entries(DENSITY) as Array<[string, number]>) {
      expect(value, `${name} must be a positive number`).toBeGreaterThan(0);
    }
  });

  it("leaves no bare-number xs spacing value outside the allowlist or zero", () => {
    const offenders: string[] = [];
    for (const dir of TARGET_DIRS) {
      const files = walk(join(ROOT, dir));
      for (const file of files) {
        const text = readFileSync(file, "utf8");
        for (const match of text.matchAll(XS_NUMBER_LITERAL)) {
          const [whole, , rawValue] = match;
          const value = Number(rawValue);
          if (value === 0) continue;
          if (ALLOWED_RAW_LINES.some((allowed) => text.includes(allowed) && whole.includes(rawValue))) {
            // Confirm the specific match's surrounding line is one of the allowed ones, not
            // merely that the file also happens to contain an allowed line elsewhere.
            const lineStart = text.lastIndexOf("\n", match.index) + 1;
            const lineEnd = text.indexOf("\n", match.index);
            const line = text.slice(lineStart, lineEnd === -1 ? text.length : lineEnd).trim();
            if (ALLOWED_RAW_LINES.some((allowed) => line.includes(allowed))) continue;
          }
          offenders.push(`${file.slice(ROOT.length)}: ${whole}`);
        }
      }
    }
    expect(
      offenders,
      "a phone-only spacing xs value written as a bare number rather than DENSITY.<name>, outside the allowlist or zero — a revert to the old literal must fail this test",
    ).toEqual([]);
  });

  /**
   * Every site this pass (and its follow-up, review round 2) put on the scale, checked both
   * ways: the `xs` side names a `DENSITY` step, and the `sm` side is the exact number the site
   * had before — sm and up were never meant to move. One row per site rather than a handful of
   * `toContain`s, so a new conversion is one line to add here, not a silent gap in the net (the
   * round-1 version of this test asserted only four Containers and one card's `pt`).
   */
  const CONVERTED_SITES: Array<{ file: string; expect: string }> = [
    // Page containers.
    { file: "src/app/[locale]/events/page.tsx", expect: "py: { xs: DENSITY.pagePadY, sm: 3 }" },
    { file: "src/app/[locale]/events/[slug]/page.tsx", expect: "py: { xs: DENSITY.pagePadY, sm: 3 }" },
    { file: "src/app/[locale]/calendar/page.tsx", expect: "py: { xs: DENSITY.pagePadY, sm: 3 }" },
    { file: "src/app/[locale]/pages/[slug]/page.tsx", expect: "py: { xs: DENSITY.pagePadY, sm: 3 }" },
    // The listing.
    { file: "src/app/[locale]/events/page.tsx", expect: "mb: { xs: DENSITY.gapSm, sm: 2.5 }" },
    { file: "src/app/[locale]/events/page.tsx", expect: "mt: { xs: DENSITY.sectionGap, sm: 3 }" },
    { file: "src/app/[locale]/events/page.tsx", expect: "mt: { xs: DENSITY.sectionGapLg, sm: 4 }" },
    { file: "src/app/[locale]/events/page.tsx", expect: "mb: { xs: DENSITY.sectionGap, sm: 3 }" },
    { file: "src/modules/events/ui/card-layout.ts", expect: "pt: { xs: DENSITY.cardPadTop, sm: 2 }" },
    { file: "src/modules/events/ui/FeaturedEventHero.tsx", expect: "p: { xs: DENSITY.heroPad, sm: 4 }" },
    // The calendar page's own intro.
    { file: "src/app/[locale]/calendar/page.tsx", expect: "mb: { xs: DENSITY.gapSm, sm: 2 }" },
    // The event page.
    { file: "src/app/[locale]/events/[slug]/page.tsx", expect: "mb: { xs: DENSITY.gapSm, sm: 2 }" },
    { file: "src/app/[locale]/events/[slug]/page.tsx", expect: "mb: { xs: DENSITY.sectionGap, sm: 3 }" },
    { file: "src/app/[locale]/events/[slug]/page.tsx", expect: "my: { xs: DENSITY.sectionGap, sm: 3 } }} />" },
    { file: "src/app/[locale]/events/[slug]/page.tsx", expect: "mt: { xs: DENSITY.gapSm, sm: 2 }" },
    { file: "src/app/[locale]/events/[slug]/page.tsx", expect: "mt: { xs: DENSITY.sectionGapLg, sm: 4 }" },
    { file: "src/modules/events/ui/EventLinks.tsx", expect: "mt: { xs: DENSITY.sectionGapLg, sm: 4 }" },
    { file: "src/modules/events/ui/EventProgramme.tsx", expect: "mt: { xs: DENSITY.sectionGapLg, sm: 4 }" },
    // Round 2: the door under the facts, the start list, the video, the club's own calendar box.
    { file: "src/modules/events/ui/RegistrationCta.tsx", expect: "mt: { xs: DENSITY.sectionGap, sm: 3 } }}" },
    { file: "src/modules/events/ui/StartList.tsx", expect: "mt: { xs: DENSITY.sectionGapLg, sm: 4 }" },
    { file: "src/modules/events/ui/EventVideo.tsx", expect: "mt: { xs: DENSITY.sectionGap, sm: 3 }" },
    { file: "src/modules/events/ui/CalendarSection.tsx", expect: "mt: { xs: DENSITY.gapSm, sm: 2 }, mb: { xs: DENSITY.sectionGapLg, sm: 4 }" },
    // Round 2: the facts row gap and the calendar's agenda.
    { file: "src/modules/events/ui/EventFacts.tsx", expect: "rowGap: { xs: DENSITY.gapSm, sm: 1 }" },
    { file: "src/modules/events/ui/EventCalendar.tsx", expect: "spacing={dense ? 1 : { xs: DENSITY.gapSm, sm: 1.5 }}" },
    { file: "src/modules/events/ui/EventCalendar.tsx", expect: "gap: { xs: DENSITY.gapSm, sm: 2 }" },
  ];

  it("keeps sm+ unchanged at every site the scale was adopted", () => {
    const cache = new Map<string, string>();
    const readCached = (relative: string) => {
      const cached = cache.get(relative);
      if (cached !== undefined) return cached;
      const text = readFileSync(join(ROOT, relative), "utf8");
      cache.set(relative, text);
      return text;
    };
    for (const site of CONVERTED_SITES) {
      expect(readCached(site.file), `${site.file} — ${site.expect}`).toContain(site.expect);
    }
  });

  it("leaves the listing card's horizontal padding unconditional", () => {
    // The card's horizontal padding — the width budget `EventFacts.tsx` was measured against
    // (§366, §375) — stays the plain, unconditional 16px it always was.
    const cardLayout = readFileSync(join(ROOT, "src/modules/events/ui/card-layout.ts"), "utf8");
    expect(cardLayout).toContain("px: 2,");
  });
});
