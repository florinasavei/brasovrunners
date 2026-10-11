import { describe, expect, it } from "vitest";
import { homeTextSchema, pickText } from "@/modules/home/domain/home-text";
import { homeFigures, numbersContentSchema, readNumbersContent, yearsSince, type NumbersEvent } from "@/modules/home/domain/numbers";
import { MAX_STRIP_PICTURES, orderStripPictures, readStripContent, stripContentSchema } from "@/modules/home/domain/photo-strip";
import { EMPTY_STEPS, readStepsContent, STEP_COUNT, stepsContentSchema } from "@/modules/home/domain/steps";
import { EMPTY_WHY, readWhyContent, WHY_COUNT, whyContentSchema } from "@/modules/home/domain/why";
import { STRIP_TILE_RATIO, stripPictures } from "@/modules/home/strip-pictures";
import { HOME_GLYPHS } from "@/modules/home/ui/home-glyphs";
import { coverMagnification, pictureSizes } from "@/modules/media/ladder";

/**
 * BR-REQ-041-01 (§NNN) — the home page's four sections, their domain: what the club may type for
 * «Prima dată», «De ce», the photo strip and the numbers band, both languages or neither (§352), and
 * the figures the band reads off the events, never invented (decision 8, BUSINESS.md §7).
 */
const PAGE_ID = "6f1c2e1a-3b4d-4e5f-8a6b-7c8d9e0f1a2b";
const PICTURE = (n: number) => `0b6f3f9e-2a41-8c3d-9e5f-1a2b3c4d5e${String(n).padStart(2, "0")}`;

describe("§NNN a home text is Romanian and English, or neither", () => {
  const schema = homeTextSchema(20);

  it("keeps a pair written in both, trimmed, and reads neither as the default (null)", () => {
    expect(schema.parse({ ro: " Bună ", en: "Hello" })).toEqual({ ro: "Bună", en: "Hello" });
    expect(schema.parse({ ro: "", en: "  " })).toBeNull();
    expect(schema.parse(null)).toBeNull();
    expect(schema.parse(undefined)).toBeNull();
  });

  it("refuses one side alone, on the empty side's path, and a text over its length", () => {
    const one = schema.safeParse({ ro: "Bună", en: "" });
    expect(one.success).toBe(false);
    expect(one.error?.issues[0]?.path).toEqual(["en"]);
    expect(schema.safeParse({ ro: "", en: "Hello" }).error?.issues[0]?.path).toEqual(["ro"]);
    expect(schema.safeParse({ ro: "x".repeat(21), en: "y" }).success).toBe(false);
  });

  it("picks the reader's half, or null for the default", () => {
    expect(pickText({ ro: "Bună", en: "Hello" }, "en")).toBe("Hello");
    expect(pickText({ ro: "Bună", en: "Hello" }, "ro")).toBe("Bună");
    expect(pickText(null, "ro")).toBeNull();
  });
});

describe("§NNN «Prima dată», «De ce» and the strip: the stored shapes", () => {
  it("has five steps and four reasons, each with a glyph of the home registry", () => {
    expect(EMPTY_STEPS.steps).toHaveLength(STEP_COUNT);
    expect(STEP_COUNT).toBe(5);
    expect(EMPTY_WHY.items).toHaveLength(WHY_COUNT);
    expect(WHY_COUNT).toBe(4);
    for (const name of ["calendar", "place", "hello", "run", "coffee", "together", "mountains", "free", "everyone"] as const) expect(HOME_GLYPHS[name], name).toBeTruthy();
  });

  it("reads a band the club wrote, and refuses a step in one language or a page that is not one", () => {
    const steps = Array.from({ length: STEP_COUNT }, () => ({ ro: "", en: "" }));
    steps[2] = { ro: "Salut", en: "Hi" };
    const parsed = stepsContentSchema.parse({ title: { ro: "Prima dată?", en: "First time?" }, steps, targetPageId: PAGE_ID });
    expect(parsed.title).toEqual({ ro: "Prima dată?", en: "First time?" });
    expect(parsed.steps[2]).toEqual({ ro: "Salut", en: "Hi" });
    expect(parsed.steps[0]).toBeNull();
    expect(parsed.lead).toBeNull();
    expect(parsed.targetPageId).toBe(PAGE_ID);

    const oneSided = [...steps];
    oneSided[4] = { ro: "Cafea", en: "" };
    expect(stepsContentSchema.safeParse({ steps: oneSided }).error?.issues[0]?.path).toEqual(["steps", 4, "en"]);
    expect(stepsContentSchema.safeParse({ steps, targetPageId: "not-a-page" }).success).toBe(false);
    expect(stepsContentSchema.safeParse({ steps: steps.slice(0, 4) }).success).toBe(false);
  });

  it("reads a stored value that no longer parses as the empty section, never a throw", () => {
    for (const value of [null, undefined, 42, "x", { steps: [] }]) expect(readStepsContent(value)).toEqual(EMPTY_STEPS);
    expect(readWhyContent({ items: [] })).toEqual(EMPTY_WHY);
    expect(readStripContent({ pictureIds: ["nope"] })).toEqual({ title: null, pictureIds: [] });
    expect(readNumbersContent({ foundedOn: "2019-02-30" })).toEqual({ foundedOn: null, activeRunners: null });
  });

  it("keeps the quote both-or-neither like every other box", () => {
    const items = Array.from({ length: WHY_COUNT }, () => ({ title: null, body: null }));
    expect(whyContentSchema.parse({ items, quote: { ro: "Vorbe", en: "Words" } }).quote).toEqual({ ro: "Vorbe", en: "Words" });
    expect(whyContentSchema.safeParse({ items, quote: { ro: "Vorbe", en: "" } }).success).toBe(false);
  });

  it("holds the strip to stored pictures, at most twelve, each once, in the club's order", () => {
    expect(stripContentSchema.parse({ pictureIds: [PICTURE(1), PICTURE(2)] }).pictureIds).toEqual([PICTURE(1), PICTURE(2)]);
    expect(stripContentSchema.safeParse({ pictureIds: [PICTURE(1), PICTURE(1)] }).success).toBe(false);
    expect(stripContentSchema.safeParse({ pictureIds: Array.from({ length: MAX_STRIP_PICTURES + 1 }, (_, i) => PICTURE(i)) }).success).toBe(false);
    expect(stripContentSchema.safeParse({ pictureIds: ["https://example.org/stock.jpg"] }).success).toBe(false);

    // The store answers in its own order and without a picture deleted since: the club's order, no hole.
    const found = [{ id: PICTURE(3) }, { id: PICTURE(1) }];
    expect(orderStripPictures([PICTURE(1), PICTURE(2), PICTURE(3), PICTURE(1)], found).map((p) => p.id)).toEqual([PICTURE(1), PICTURE(3)]);
  });

  it("gives a strip picture the ladder's srcset for its square tile, and an older picture its thumbnail alone", () => {
    const [laddered, older, poster] = stripPictures([
      { id: "a", keyPrefix: PICTURE(1), width: 2400, height: 1600, alt: " Start " },
      { id: "b", keyPrefix: "0b6f3f9e-2a41-4c3d-9e5f-1a2b3c4d5e6f", width: 2400, height: 1600 },
      { id: "c", keyPrefix: "yt-abc", width: 480, height: 360 },
    ]);
    expect(laddered.src).toMatch(/\/thumb\.webp$/);
    expect(laddered.srcSet).toContain("/480w.webp 480w");
    expect(laddered.sizes).toBe(pictureSizes("strip", 100, coverMagnification(2400, 1600, STRIP_TILE_RATIO)));
    expect(laddered.alt).toBe("Start");
    expect(older.srcSet).toBeUndefined();
    expect(older.sizes).toBeUndefined();
    expect(older.src).toMatch(/\/thumb\.webp$/);
    expect(older.alt).toBe("");
    // A film's poster is never a strip picture.
    expect(poster).toBeUndefined();
  });
});

describe("§NNN the numbers band reads its figures, never invents one", () => {
  const NOW = new Date("2026-10-11T10:00:00Z");
  const run = (startsAt: string, overrides: Partial<NumbersEvent> = {}): NumbersEvent => ({
    type: "GROUP_RUN",
    title: "Alergarea de marți",
    startsAt: new Date(startsAt),
    timezone: "Europe/Bucharest",
    eventStatus: "SCHEDULED",
    costType: "FREE",
    ...overrides,
  });
  const tuesdays = ["2026-10-13T15:30:00Z", "2026-10-20T15:30:00Z", "2026-10-27T16:30:00Z"].map((at) => run(at));
  const thursdays = ["2026-10-15T15:30:00Z", "2026-10-22T15:30:00Z"].map((at) => run(at, { title: "Alergarea de joi" }));

  it("counts whole years to today on the club's calendar, none before the first anniversary or for a day to come", () => {
    expect(yearsSince("2016-10-11", NOW)).toBe(10);
    expect(yearsSince("2016-10-12", NOW)).toBe(9);
    expect(yearsSince("2026-01-01", NOW)).toBeNull();
    expect(yearsSince("2027-01-01", NOW)).toBeNull();
    // 23:30 in Bucharest on the 11th is still the 11th, whatever UTC says.
    expect(yearsSince("2016-10-12", new Date("2026-10-11T21:30:00Z"))).toBe(10);
  });

  it("draws the four figures from the club's two facts and the weekly runs", () => {
    const figures = homeFigures({ foundedOn: "2016-05-01", activeRunners: 120 }, [...tuesdays, ...thursdays], NOW);
    expect(figures).toEqual([
      { id: "years", count: 10 },
      { id: "runners", count: 120 },
      { id: "perWeek", count: 2 },
      { id: "free", count: 100 },
    ]);
  });

  it("leaves out a figure without its fact, and has none with no fact at all", () => {
    expect(homeFigures({ foundedOn: null, activeRunners: null }, [], NOW)).toEqual([]);
    // A race, a one-off and a fortnightly series are no weekly run.
    const fortnightly = ["2026-10-13T15:30:00Z", "2026-10-27T15:30:00Z"].map((at) => run(at, { title: "La două săptămâni" }));
    const race = run("2026-11-21T08:00:00Z", { type: "RACE", title: "Cursa", costType: "PAID" });
    expect(homeFigures({ foundedOn: null, activeRunners: null }, [...fortnightly, race], NOW)).toEqual([]);
  });

  it("says «100%» free only when every coming weekly date is free, a cancelled one aside", () => {
    const paidOnce = [...tuesdays.slice(0, 2), run("2026-10-27T16:30:00Z", { costType: "DONATION" })];
    expect(homeFigures({ foundedOn: null, activeRunners: null }, paidOnce, NOW).map((f) => f.id)).toEqual(["perWeek"]);
    const cancelledPaid = [...tuesdays.slice(0, 2), run("2026-10-27T16:30:00Z", { costType: "PAID", eventStatus: "CANCELLED" })];
    expect(homeFigures({ foundedOn: null, activeRunners: null }, cancelledPaid, NOW).map((f) => f.id)).toEqual(["perWeek", "free"]);
    const unstated = tuesdays.map((event) => ({ ...event, costType: null }));
    expect(homeFigures({ foundedOn: null, activeRunners: null }, unstated, NOW).map((f) => f.id)).toEqual(["perWeek"]);
  });

  it("refuses a founding day that is not a day and a runners' count that is not a count", () => {
    expect(numbersContentSchema.safeParse({ foundedOn: "2019-13-01" }).success).toBe(false);
    expect(numbersContentSchema.safeParse({ foundedOn: "1 May 2019" }).success).toBe(false);
    expect(numbersContentSchema.safeParse({ activeRunners: 0 }).success).toBe(false);
    expect(numbersContentSchema.safeParse({ activeRunners: 12.5 }).success).toBe(false);
    expect(numbersContentSchema.parse({ foundedOn: "2016-02-29", activeRunners: 80 })).toEqual({ foundedOn: "2016-02-29", activeRunners: 80 });
  });
});
