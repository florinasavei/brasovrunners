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
 * `mt`, `mb`, `ml`, `mr`, `my`, `mx`, `gap`, `rowGap`, `columnGap`) written as `{ xs: <number>,
 * … }`, and refuses one whose `xs` number is not `0` and not a `DENSITY` value — unless the
 * line is on the short, named allowlist below, each entry with the reason it stays a literal.
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
const XS_LITERAL = new RegExp(`\\b(${SPACING_PROPS}):\\s*\\{\\s*xs:\\s*(-?[\\d.]+)`, "g");

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

  const densityValues = new Set<number>(Object.values(DENSITY));

  it("leaves no stray literal xs spacing value outside the scale, the allowlist or zero", () => {
    const offenders: string[] = [];
    for (const dir of TARGET_DIRS) {
      const files = walk(join(ROOT, dir));
      for (const file of files) {
        const text = readFileSync(file, "utf8");
        for (const match of text.matchAll(XS_LITERAL)) {
          const [whole, , rawValue] = match;
          const value = Number(rawValue);
          if (value === 0) continue;
          if (densityValues.has(value)) continue;
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
    expect(offenders, "a phone-only spacing literal outside DENSITY, 0 or the named allowlist").toEqual([]);
  });

  it("keeps sm+ unchanged wherever a page container adopted the scale", () => {
    const events = readFileSync(join(ROOT, "src/app/[locale]/events/page.tsx"), "utf8");
    expect(events).toContain("py: { xs: DENSITY.pagePadY, sm: 3 }");
    const eventPage = readFileSync(join(ROOT, "src/app/[locale]/events/[slug]/page.tsx"), "utf8");
    expect(eventPage).toContain("py: { xs: DENSITY.pagePadY, sm: 3 }");
    const calendar = readFileSync(join(ROOT, "src/app/[locale]/calendar/page.tsx"), "utf8");
    expect(calendar).toContain("py: { xs: DENSITY.pagePadY, sm: 3 }");
    const standing = readFileSync(join(ROOT, "src/app/[locale]/pages/[slug]/page.tsx"), "utf8");
    expect(standing).toContain("py: { xs: DENSITY.pagePadY, sm: 3 }");
    const cardLayout = readFileSync(join(ROOT, "src/modules/events/ui/card-layout.ts"), "utf8");
    expect(cardLayout).toContain("pt: { xs: DENSITY.cardPadTop, sm: 2 }");
    // The card's horizontal padding — the width budget `EventFacts.tsx` was measured against
    // (§366, §375) — stays the plain, unconditional 16px it always was.
    expect(cardLayout).toContain("px: 2,");
  });
});
