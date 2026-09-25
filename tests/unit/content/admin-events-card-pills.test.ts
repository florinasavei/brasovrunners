import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

/**
 * `DECISIONS.md` §NNN — the backoffice event cards wear the public card's chips and pills. The
 * owner, 2026-09-25, on `/admin` on his phone, of a series card (the bare runner glyph, the
 * title, the "9 date" chip, the recurrence line, the fold, Stare, Data, Înscrieri, the actions):
 * "I want the same small icons for the event types, trail, distance, etc. on the back-office
 * cards as well, people will get used to them."
 *
 * The page reads events from the database and next-intl translations resolved at request time,
 * which the unit suite cannot render (the same reason `series-drafts-line.test.ts` pins its
 * wiring at the source rather than rendering `AdminEventsPage`). `buildRoutePills` and
 * `RoutePills` are proven directly, in isolation, by `route-pills-build.test.ts`; this file
 * proves the list calls them, and calls `GlyphChip` and `PartnerChip` the way the public card
 * does, rather than rendering its own copy of either.
 */
const ROOT = process.cwd();
const read = (relative: string) => readFileSync(path.join(ROOT, relative), "utf8").replace(/\r\n/g, "\n");
const page = read("src/app/[locale]/admin/(list)/page.tsx");

describe("§NNN the backoffice event list wears the public card's type chip, route pills and partner marker", () => {
  it("replaces the bare type glyph with the public type chip — the same glyph name and the same word the listing card wears", () => {
    expect(page).not.toContain("const TypeGlyph = TYPE_GLYPH[event.type]");
    expect(page).not.toContain('import { TYPE_GLYPH } from "@/modules/events/ui/glyphs"');
    expect(page).toContain('<GlyphChip glyph={`type:${event.type}`} label={tEvent(`type.${event.type}`)} />');
  });

  it("draws the route's pills under the title through the one shared function and component, never a copy of its own", () => {
    expect(page).toContain('import { buildRoutePills } from "@/modules/events/ui/route-pills"');
    expect(page).toContain('import RoutePills from "@/modules/events/ui/RoutePills"');
    expect(page).toContain("<RoutePills pills={buildRoutePills(event, tEvent, format)} />");
    // Once per line, from the next occurrence's own row — a series shares one route.
    expect(page.match(/<RoutePills pills=/g)).toHaveLength(1);
  });

  it("gets the formatter `buildRoutePills` needs for the distance and the climb", () => {
    expect(page).toContain('import { getFormatter, getTranslations, setRequestLocale } from "next-intl/server"');
    expect(page).toContain("const format = await getFormatter();");
  });

  it("wears the 🤝 partner marker through the same `PartnerChip` the listing card renders, never a list of partner names", () => {
    expect(page).toContain('import PartnerChip from "@/modules/events/ui/PartnerChip"');
    expect(page).toContain("<PartnerChip event={event} />");
  });

  it("keeps the type chip and the partner marker in the title row, beside the series and featured chips", () => {
    const titleColumn = page.slice(page.indexOf('key: "title"'), page.indexOf('key: "status"'));
    expect(titleColumn).toContain('<GlyphChip glyph={`type:${event.type}`}');
    expect(titleColumn).toContain("<PartnerChip event={event} />");
    expect(titleColumn.indexOf('<GlyphChip glyph={`type:${event.type}`}')).toBeLessThan(titleColumn.indexOf("<Link"));
  });
});
