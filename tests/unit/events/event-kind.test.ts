import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { coverTag, EVENT_KINDS, eventKind } from "@/modules/events/domain/event-kind";
import { EVENT_TYPES } from "@/modules/events/domain/event-type";
import { REPEAT_CADENCES } from "@/modules/events/domain/repeat";
import { GLYPHS } from "@/modules/events/ui/glyphs";

/**
 * §NNN — the facelift's phase 2: the event's kind for the new look (`docs/REDESIGN.md`, decision 9),
 * derived from the standing series the date belongs to and from nothing typed by hand. Weekly is a
 * date of a series that repeats every week; special is everything else. The photo tag is the kind's
 * word and a glyph of the public registry, so phase 5 can draw it from a Server Component.
 */
const read = (file: string) => readFileSync(path.join(process.cwd(), file), "utf8");
const MESSAGES = (["ro", "en"] as const).map((locale) => [locale, JSON.parse(read(`messages/${locale}.json`))] as const);

describe("§NNN the event's kind", () => {
  it("is weekly only for a date of a weekly series, and special for every other answer", () => {
    expect(eventKind({ seriesCadence: "WEEKLY" })).toBe("weekly");
    // Decision 9: «Evenimente speciale» is everything that is not a weekly series.
    for (const cadence of REPEAT_CADENCES.filter((value) => value !== "WEEKLY")) {
      expect(eventKind({ seriesCadence: cadence }), cadence).toBe("special");
    }
    // No series — a one-off, a race, a stopped series (§275) — and anything that is not a cadence.
    expect(eventKind({ seriesCadence: null })).toBe("special");
    expect(eventKind({ seriesCadence: "weekly" })).toBe("special");
    expect(eventKind({ seriesCadence: "" })).toBe("special");
  });

  it("has two kinds, each named in both catalogues, never an ICU plural", () => {
    expect([...EVENT_KINDS]).toEqual(["weekly", "special"]);
    for (const [locale, messages] of MESSAGES) {
      for (const kind of EVENT_KINDS) {
        const word = messages.Event.kind[kind];
        expect(typeof word, `${locale}: Event.kind.${kind}`).toBe("string");
        expect(word.trim(), `${locale}: Event.kind.${kind}`).not.toBe("");
        expect(word).not.toContain("{");
      }
    }
    // «Ediție specială» keeps its own word (§168): the kind's is a different one.
    for (const [, messages] of MESSAGES) expect(messages.Event.kind.special).not.toBe(messages.Event.special);
  });

  it("gives the photo tag the kind's word and a glyph of the public registry — the repeat arrows, or the type's own", () => {
    expect(coverTag({ seriesCadence: "WEEKLY", type: "GROUP_RUN" })).toEqual({ kind: "weekly", labelKey: "kind.weekly", glyph: "repeat" });
    expect(coverTag({ seriesCadence: null, type: "RACE" })).toEqual({ kind: "special", labelKey: "kind.special", glyph: "type:RACE" });
    for (const type of EVENT_TYPES) {
      for (const seriesCadence of [null, ...REPEAT_CADENCES]) {
        const tag = coverTag({ seriesCadence, type });
        expect(Object.keys(GLYPHS), `${type} ${seriesCadence}`).toContain(tag.glyph);
        expect(tag.labelKey).toBe(`kind.${tag.kind}`);
      }
    }
  });

  it("is derived, never a column: no kind flag in the schema, and the public read carries the series' cadence", () => {
    const schema = read("src/db/schema/events.ts");
    expect(schema).not.toMatch(/\b(kind|eventKind|isWeekly)\s*:\s*(boolean|text|pgEnum|eventKind)\(/);
    const repository = read("src/modules/events/repository.ts");
    expect(repository).toContain("seriesCadence: SERIES_CADENCE,");
    expect(repository).toContain("cover: PUBLIC_COVER,");
  });
});
