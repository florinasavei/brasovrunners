import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { describe, expect, it } from "vitest";
import { DENSITY } from "@/theme/density";

/**
 * `DECISIONS.md` §380 — one phone density scale, used everywhere the public pages set a
 * spacing value below `sm`, rather than a number chosen fresh in each component.
 *
 * Three checks, each a walk over the source in the spirit of `tests/unit/theme/surfaces.test.ts`:
 *
 * 1. **No stray literal.** Every spacing prop (`p`, `m` and their sides, the three gaps,
 *    `spacing`) written as `{ xs: <number>, … }` is refused unless its line is on the short,
 *    named allowlist below, each entry with the reason it stays a literal. The xs side must be
 *    the identifier `DENSITY.<name>`; matching the identifier rather than "a number equal to
 *    some step" is what makes a revert to the old literal (`xs: 2`, `xs: 1.5`, …) fail.
 * 2. **Every conversion on the record.** Every `{ xs: DENSITY.<name>, sm: <n> }` in the source
 *    is a row of `CONVERTED_SITES` — file, prop, step, the `sm` value the site had before this
 *    change (asserted: sm and up never move) and the xs value it had (the step must be smaller).
 *    A new conversion without a row, or a row whose site is gone, fails.
 * 3. The scale itself: eight positive steps, each smaller than what it replaced.
 */

const ROOT = join(__dirname, "..", "..", "..");

/** The public pages and the event components they are built from; the backoffice is not public. */
const TARGET_DIRS = ["src/app/[locale]", "src/modules/events/ui"];
const EXCLUDED_DIRS = ["src/app/[locale]/admin", "src/app/[locale]/devs"];

const posix = (path: string) => relative(ROOT, path).split(sep).join("/");

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((entry) => {
    const full = join(dir, entry);
    if (EXCLUDED_DIRS.includes(posix(full))) return [];
    if (statSync(full).isDirectory()) return walk(full);
    if (/\.(tsx|ts)$/.test(entry) && !/\.test\.tsx?$/.test(entry)) return [full];
    return [];
  });
}

const FILES = TARGET_DIRS.flatMap((dir) => walk(join(ROOT, dir))).map((full) => ({ file: posix(full), text: readFileSync(full, "utf8") }));

const SPACING_PROPS = "p|m|py|px|pt|pb|pl|pr|mt|mb|ml|mr|my|mx|gap|rowGap|columnGap|spacing";
// `prop: { xs: 1` in an `sx`, or `spacing={{ xs: 1` / `spacing={cond ? a : { xs: 1` as a prop.
const PROP_THEN_XS = `\\b(${SPACING_PROPS})(?::\\s*|=\\{[^{}]*?)\\{\\s*xs:\\s*`;
const XS_NUMBER_LITERAL = new RegExp(`${PROP_THEN_XS}(-?[\\d.]+)`, "g");
const XS_DENSITY = new RegExp(`${PROP_THEN_XS}DENSITY\\.(\\w+),\\s*sm:\\s*(-?[\\d.]+)\\s*\\}`, "g");

/**
 * The `xs` literals that stay, each for a reason — none of them the "too much whitespace" the
 * scale answers. Matched by file and by the text of the line, so an allowed line in one file
 * never excuses a literal in another.
 */
const ALLOWED: Array<{ file: string; line: string; reason: string }> = [
  {
    file: "src/modules/events/ui/CalendarEventChip.tsx",
    line: "mr: { xs: 0, sm: 0.5 }",
    reason: "zero on a phone already",
  },
  {
    file: "src/modules/events/ui/CalendarSection.tsx",
    line: "px: { xs: 1.5, sm: 1.25 },",
    reason: "a chip's tap padding, larger on a phone than on a desktop on purpose",
  },
  {
    file: "src/modules/events/ui/share-pill.ts",
    line: "px: { xs: 1.5, sm: 1.25 },",
    reason: "a chip's tap padding, larger on a phone than on a desktop on purpose",
  },
  {
    file: "src/modules/events/ui/EventCalendar.tsx",
    line: "p: { xs: 0.25, sm: 0.5 },",
    reason: "a month-grid day cell's two pixels — already the tight end",
  },
  {
    file: "src/modules/events/ui/EventFacts.tsx",
    line: "rowGap: { xs: 0.5, sm: 1.5 },",
    reason: "four pixels between a question and its answer on the stacked facts — already the tight end (§380)",
  },
  {
    file: "src/modules/events/ui/EventFacts.tsx",
    line: "pl: { xs: 3.5, sm: 0 }",
    reason: "the answer's indent to the label's first letter (20px glyph + 8px gap, §356) — alignment, not whitespace",
  },
  {
    file: "src/app/[locale]/gallery/[slug]/page.tsx",
    line: "gap: { xs: 1, sm: 1.5 },",
    reason: "eight pixels between two photos, already at the listing grid's own phone step",
  },
  {
    file: "src/app/[locale]/error.tsx",
    line: "py: { xs: 4, sm: 8 } }}>",
    reason: "one sentence centred on an otherwise empty page; the room is the layout",
  },
  {
    file: "src/app/[locale]/not-found.tsx",
    line: "py: { xs: 4, sm: 8 } }}>",
    reason: "one sentence centred on an otherwise empty page; the room is the layout",
  },
];

type DensityStep = keyof typeof DENSITY;

/**
 * Every site on the scale: the step it uses on a phone, the `sm` value (unchanged by this work —
 * the value the site had before), the `xs` value it had before (flat sites: the same number),
 * and how many times the file carries it.
 */
const CONVERTED_SITES: Array<{ file: string; prop: string; step: DensityStep; sm: number; xsBefore: number; count?: number }> = [
  // Page containers — every public page, 16px → 12px on a phone.
  { file: "src/app/[locale]/events/page.tsx", prop: "py", step: "pagePadY", sm: 3, xsBefore: 2 },
  { file: "src/app/[locale]/events/[slug]/page.tsx", prop: "py", step: "pagePadY", sm: 3, xsBefore: 2 },
  { file: "src/app/[locale]/events/[slug]/register/page.tsx", prop: "py", step: "pagePadY", sm: 3, xsBefore: 2 },
  // A group run's self-declaration (§393): born on the scale, the declare page's three containers.
  { file: "src/app/[locale]/events/[slug]/declaration/page.tsx", prop: "py", step: "pagePadY", sm: 3, xsBefore: 2, count: 3 },
  { file: "src/app/[locale]/calendar/page.tsx", prop: "py", step: "pagePadY", sm: 3, xsBefore: 2 },
  { file: "src/app/[locale]/pages/[slug]/page.tsx", prop: "py", step: "pagePadY", sm: 3, xsBefore: 2 },
  { file: "src/app/[locale]/contact/page.tsx", prop: "py", step: "pagePadY", sm: 3, xsBefore: 2 },
  { file: "src/app/[locale]/gallery/page.tsx", prop: "py", step: "pagePadY", sm: 3, xsBefore: 2 },
  { file: "src/app/[locale]/gallery/[slug]/page.tsx", prop: "py", step: "pagePadY", sm: 3, xsBefore: 2 },
  { file: "src/app/[locale]/legal/privacy/page.tsx", prop: "py", step: "pagePadY", sm: 3, xsBefore: 2 },
  { file: "src/app/[locale]/legal/terms/page.tsx", prop: "py", step: "pagePadY", sm: 3, xsBefore: 2 },
  { file: "src/app/[locale]/preview/events/[id]/page.tsx", prop: "py", step: "pagePadY", sm: 3, xsBefore: 2 },
  { file: "src/app/[locale]/registrations/confirm/[token]/page.tsx", prop: "py", step: "pagePadY", sm: 3, xsBefore: 2, count: 4 },
  { file: "src/app/[locale]/registrations/declare/[token]/page.tsx", prop: "py", step: "pagePadY", sm: 3, xsBefore: 2, count: 3 },
  { file: "src/app/[locale]/registrations/list/[token]/page.tsx", prop: "py", step: "pagePadY", sm: 3, xsBefore: 2 },
  { file: "src/app/[locale]/registrations/manage/[token]/page.tsx", prop: "py", step: "pagePadY", sm: 3, xsBefore: 2, count: 2 },
  { file: "src/app/[locale]/registrations/mine/page.tsx", prop: "py", step: "pagePadY", sm: 3, xsBefore: 2 },
  { file: "src/app/[locale]/registrations/mine/[token]/page.tsx", prop: "py", step: "pagePadY", sm: 3, xsBefore: 2, count: 2 },
  { file: "src/app/[locale]/registrations/resend/page.tsx", prop: "py", step: "pagePadY", sm: 3, xsBefore: 2 },
  // The newsletter's two link pages (§NNN), born on the scale: the confirmation, and the
  // subscriber's own page (its "unsubscribed" state is a container of its own).
  { file: "src/app/[locale]/newsletter/confirm/[token]/page.tsx", prop: "py", step: "pagePadY", sm: 3, xsBefore: 2 },
  { file: "src/app/[locale]/newsletter/manage/[token]/page.tsx", prop: "py", step: "pagePadY", sm: 3, xsBefore: 2, count: 2 },
  { file: "src/app/[locale]/sign-in/page.tsx", prop: "py", step: "pagePadY", sm: 3, xsBefore: 2 },
  // The listing.
  { file: "src/app/[locale]/events/page.tsx", prop: "mb", step: "gapSm", sm: 2.5, xsBefore: 2.5 },
  // Filter row: `mt` above it (unchanged), plus three more below it (§401 — the owner:
  // "filters still need to be a bit above the grid"), one on each of `ListingBody`'s three
  // return shapes so the grid, the empty notice and the "Alte evenimente" fold each keep the
  // same gap under the row whichever one follows it — the filter row carried no `mb` and the
  // grid no `mt` before, so this is a genuinely new gap rather than a literal being converted.
  { file: "src/app/[locale]/events/page.tsx", prop: "mt", step: "sectionGap", sm: 3, xsBefore: 3 },
  { file: "src/app/[locale]/events/page.tsx", prop: "mb", step: "sectionGap", sm: 3, xsBefore: 3, count: 2 },
  { file: "src/app/[locale]/events/page.tsx", prop: "mt", step: "sectionGapLg", sm: 4, xsBefore: 4 },
  { file: "src/app/[locale]/events/page.tsx", prop: "gap", step: "cardGridGap", sm: 1.5, xsBefore: 1.5, count: 3 },
  { file: "src/modules/events/ui/card-layout.ts", prop: "pt", step: "cardPadTop", sm: 2, xsBefore: 2 },
  { file: "src/modules/events/ui/FeaturedEventHero.tsx", prop: "p", step: "heroPad", sm: 4, xsBefore: 2.5 },
  { file: "src/modules/events/ui/FeaturedEventHero.tsx", prop: "mb", step: "sectionGapLg", sm: 4, xsBefore: 4 },
  { file: "src/modules/events/ui/EventFacts.tsx", prop: "rowGap", step: "gapXs", sm: 1, xsBefore: 1 },
  // The calendar.
  { file: "src/app/[locale]/calendar/page.tsx", prop: "mb", step: "gapSm", sm: 2, xsBefore: 2 },
  { file: "src/modules/events/ui/CalendarSection.tsx", prop: "mt", step: "gapSm", sm: 2, xsBefore: 2 },
  { file: "src/modules/events/ui/CalendarSection.tsx", prop: "mb", step: "sectionGapLg", sm: 4, xsBefore: 4 },
  { file: "src/modules/events/ui/EventCalendar.tsx", prop: "spacing", step: "gapSm", sm: 1.5, xsBefore: 1.5 },
  { file: "src/modules/events/ui/EventCalendar.tsx", prop: "gap", step: "gapSm", sm: 2, xsBefore: 2 },
  // The event page.
  { file: "src/app/[locale]/events/[slug]/page.tsx", prop: "mb", step: "gapSm", sm: 2, xsBefore: 2 },
  { file: "src/app/[locale]/events/[slug]/page.tsx", prop: "mb", step: "sectionGap", sm: 3, xsBefore: 3, count: 2 },
  { file: "src/app/[locale]/events/[slug]/page.tsx", prop: "my", step: "sectionGap", sm: 3, xsBefore: 3 },
  { file: "src/app/[locale]/events/[slug]/page.tsx", prop: "mt", step: "gapSm", sm: 2, xsBefore: 2, count: 2 },
  { file: "src/app/[locale]/events/[slug]/page.tsx", prop: "mt", step: "sectionGapLg", sm: 4, xsBefore: 4 },
  { file: "src/modules/events/ui/EventFacts.tsx", prop: "mb", step: "gapXs", sm: 0, xsBefore: 1 },
  { file: "src/modules/events/ui/EventFacts.tsx", prop: "rowGap", step: "gapSm", sm: 1.5, xsBefore: 1.5 },
  // The partners section (§401 — "this should be block, and collapsible"): its own gap under
  // the `<dl>`, new rather than converted — a section that did not exist before this change.
  { file: "src/modules/events/ui/EventFacts.tsx", prop: "mt", step: "sectionGap", sm: 3, xsBefore: 3 },
  { file: "src/modules/events/ui/EventLinks.tsx", prop: "mt", step: "sectionGapLg", sm: 4, xsBefore: 4 },
  // The photographs notice (§323, the photographs amendment's item 6), born on the scale.
  { file: "src/modules/events/ui/EventPhotosNotice.tsx", prop: "mb", step: "gapSm", sm: 2, xsBefore: 2 },
  { file: "src/modules/events/ui/EventProgramme.tsx", prop: "mt", step: "sectionGapLg", sm: 4, xsBefore: 4 },
  // The route section (§387), born on the scale, spaced like "Linkuri și fișiere" beside it.
  { file: "src/modules/events/ui/EventRoute.tsx", prop: "mt", step: "sectionGapLg", sm: 4, xsBefore: 4 },
  { file: "src/modules/events/ui/EventVideo.tsx", prop: "mt", step: "sectionGap", sm: 3, xsBefore: 3 },
  { file: "src/modules/events/ui/RegistrationCta.tsx", prop: "mt", step: "sectionGap", sm: 3, xsBefore: 3, count: 6 },
  { file: "src/modules/events/ui/StartList.tsx", prop: "mt", step: "sectionGapLg", sm: 4, xsBefore: 4 },
];

const siteKey = (site: { file: string; prop: string; step: string; sm: number }) => `${site.file} ${site.prop}: { xs: DENSITY.${site.step}, sm: ${site.sm} }`;

describe("DECISIONS.md §380 the public pages share one phone density scale", () => {
  it("defines eight positive steps, each tighter than every value it replaced", () => {
    expect(Object.keys(DENSITY)).toHaveLength(8);
    for (const [name, value] of Object.entries(DENSITY) as Array<[string, number]>) {
      expect(value, `${name} must be a positive number`).toBeGreaterThan(0);
    }
    for (const site of CONVERTED_SITES) {
      expect(DENSITY[site.step], `${siteKey(site)} must be tighter than its old xs ${site.xsBefore}`).toBeLessThan(site.xsBefore);
    }
  });

  it("leaves no bare-number xs spacing value outside the named allowlist", () => {
    const offenders: string[] = [];
    for (const { file, text } of FILES) {
      for (const match of text.matchAll(XS_NUMBER_LITERAL)) {
        const lineStart = text.lastIndexOf("\n", match.index) + 1;
        const lineEnd = text.indexOf("\n", match.index);
        const line = text.slice(lineStart, lineEnd === -1 ? text.length : lineEnd);
        if (ALLOWED.some((allowed) => allowed.file === file && line.includes(allowed.line))) continue;
        offenders.push(`${file}: ${line.trim()}`);
      }
    }
    expect(offenders, "a phone-only spacing value written as a number rather than DENSITY.<name>, outside the allowlist — a revert to the old literal must fail here").toEqual([]);
  });

  it("names every allowlisted line where it still stands", () => {
    for (const allowed of ALLOWED) {
      const source = FILES.find((f) => f.file === allowed.file);
      expect(source?.text, `${allowed.file} (${allowed.reason})`).toContain(allowed.line);
    }
  });

  it("records every DENSITY site with its unchanged sm value, and nothing else", () => {
    const found = new Map<string, number>();
    let usages = 0;
    for (const { file, text } of FILES) {
      usages += text.match(/xs:\s*DENSITY\./g)?.length ?? 0;
      for (const match of text.matchAll(XS_DENSITY)) {
        const key = siteKey({ file, prop: match[1], step: match[2], sm: Number(match[3]) });
        found.set(key, (found.get(key) ?? 0) + 1);
      }
    }
    const expected = new Map<string, number>();
    for (const site of CONVERTED_SITES) expected.set(siteKey(site), (expected.get(siteKey(site)) ?? 0) + (site.count ?? 1));
    // Every `xs: DENSITY.x` carries its `sm` beside it in the one shape the table can check.
    expect([...found.values()].reduce((a, b) => a + b, 0), "an xs: DENSITY.<name> without `, sm: <n> }` beside it").toBe(usages);
    expect(Object.fromEntries([...found].sort())).toEqual(Object.fromEntries([...expected].sort()));
  });

  it("leaves the listing card's horizontal padding unconditional", () => {
    // The card's horizontal padding — the width budget `EventFacts.tsx` was measured against
    // (§366, §375) — stays the plain, unconditional 16px it always was.
    const cardLayout = FILES.find((f) => f.file === "src/modules/events/ui/card-layout.ts");
    expect(cardLayout?.text).toContain("px: 2,");
  });
});
