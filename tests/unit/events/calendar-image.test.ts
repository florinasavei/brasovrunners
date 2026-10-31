import { readdirSync, readFileSync } from "node:fs";
import { createTranslator } from "next-intl";
import { describe, expect, it, vi } from "vitest";
import ro from "../../../messages/ro.json";
import type { PublicEvent } from "@/modules/events/repository";
import { type CalendarImageData, type CalendarImageEntry, LEGEND_MAX, periodHasPlace } from "@/modules/events/domain/calendar-image";
import { type CalendarImageFormat, calendarImageRows, placeHead } from "@/modules/events/domain/calendar-image-rows";
import { distanceWords } from "@/modules/events/domain/distance";
import { elevationWords } from "@/modules/events/domain/elevation";
import { detailWords, eventGlyphs, fitText, glyphsWidth, wrapBalanced, wrapText } from "@/modules/events/ui/calendar-image-canvas";
import { SPECIAL_PATH, SURFACE_PATHS, TYPE_PATHS } from "@/modules/events/ui/calendar-image-glyphs";
import { CALENDAR_IMAGE_RATIOS } from "@/modules/events/ui/calendar-image-canvas";
import { CALENDAR_IMAGE_LAYOUT_CHOICES, CALENDAR_IMAGE_THEME_CHOICES, type CalendarImageAssets, type CalendarImageOptions, drawCalendarImage, paletteFor } from "@/modules/events/ui/calendar-image-draw";
import { CALENDAR_IMAGE_THEMES } from "@/theme/brand";
import { weekHeights } from "@/modules/events/ui/calendar-image-poster-cells";
import { posterPlan, weekdayColumn, wrapWhole } from "@/modules/events/ui/calendar-image-poster-heads";
import { COVERED, drawFrame } from "@/modules/events/ui/calendar-image-frame";
import { initialWeek, weekLabel, weekOf, weeksOf, weekSlug } from "@/modules/events/ui/calendar-image-week";
import { monthGrid } from "@/modules/events/domain/calendar";
import { stubCanvas } from "./calendar-image-stub-canvas";
import busy from "../../../scripts/calendar-image-preview/busy.json";
import fortnight from "../../../scripts/calendar-image-preview/fortnight.json";
import june from "../../../scripts/calendar-image-preview/june.json";
import sparse from "../../../scripts/calendar-image-preview/sparse.json";

/**
 * «Salvează ca imagine» (§855; the owner, 2026-10-27): the month as a picture, drawn in the browser. The pure
 * halves: which day each date falls on and what repeats, and the words cut to the room a cell gives them.
 */

/** A measure of ten units per character: a line of `width` holds `width / 10` characters. */
const ctx = { measureText: (text: string) => ({ width: [...text].length * 10 }) as TextMetrics };

function event(startsAt: string, title: string, overrides: Partial<PublicEvent> = {}): PublicEvent {
  return {
    startsAt: new Date(startsAt),
    timezone: "Europe/Bucharest",
    title,
    type: "GROUP_RUN",
    isSpecial: false,
    eventStatus: "SCHEDULED",
    timeToBeAnnounced: false,
    locationShort: null,
    ...overrides,
  } as PublicEvent;
}

/** The hour alone, no route words: what the rows tests need. */
const hourOnly: CalendarImageFormat = { time: () => "18:30", distance: () => null, elevation: () => null };
/** A date with no details to draw, and the dialog with every detail on. */
const NO_DETAILS = { place: null, distance: null, elevation: null };
const ALL_DETAILS = { place: true, distance: true, elevation: true };

describe("the month's rows", () => {
  const rows = calendarImageRows(
    { year: 2026, month: 6 },
    [
      event("2026-06-08T15:30:00Z", "Happy Monday"),
      event("2026-06-01T15:30:00Z", "Happy Monday"),
      event("2026-06-05T15:00:00Z", "Girls only shake out run", { isSpecial: true }),
      // The club's day, not UTC's: 23:30 UTC on 30 June is 1 July in Brașov — next month's.
      event("2026-06-30T23:30:00Z", "Night run"),
      event("2026-07-02T15:00:00Z", "July"),
    ],
    hourOnly,
  );

  it("puts each date on its day in the club's zone, soonest first, and leaves out the other months", () => {
    expect(rows.entries.map((entry) => [entry.day, entry.title])).toEqual([
      [1, "Happy Monday"],
      [5, "Girls only shake out run"],
      [8, "Happy Monday"],
    ]);
  });

  it("tells what repeats in the month from what stands alone", () => {
    expect(rows.series.map((members) => members.map((member) => member.title))).toEqual([["Happy Monday", "Happy Monday"]]);
    expect(rows.singles.map((member) => member.title)).toEqual(["Girls only shake out run"]);
  });

  it("says no hour for a date whose hour is to be announced, and marks a cancelled one", () => {
    const [entry] = calendarImageRows({ year: 2026, month: 6 }, [event("2026-06-03T09:00:00Z", "Tură", { timeToBeAnnounced: true, eventStatus: "CANCELLED" })], hourOnly).entries;
    expect(entry).toMatchObject({ time: null, cancelled: true });
  });
});

describe("a date's details (the owner, 2026-10-27: «short location … and also elevation»)", () => {
  // The site's own words for the route, in Romanian, as the page's pills and the picture's data say them.
  const translator = createTranslator({ locale: "ro", messages: ro, namespace: "Event" });
  const t = (key: string, values?: Record<string, string | number>) => translator(key as never, values as never);
  const format: CalendarImageFormat = {
    time: () => "19:00",
    distance: (row) => distanceWords(row, t, (km) => new Intl.NumberFormat("ro", { maximumFractionDigits: 1 }).format(km))?.short ?? null,
    elevation: (row) => elevationWords(row, t, (value) => new Intl.NumberFormat("ro").format(value))?.short ?? null,
  };
  const june = { year: 2026, month: 6 };

  it("copies the short place as the public read gives it, null when the event has none", () => {
    const [tampa, none] = calendarImageRows(june, [event("2026-06-03T16:00:00Z", "Tură", { locationShort: "Tâmpa" }), event("2026-06-05T16:00:00Z", "Shake out")], hourOnly).entries;
    expect(tampa.place).toBe("Tâmpa");
    expect(none.place).toBeNull();
  });

  // The owner, 2026-10-31, of «Locul» greyed for want of a short place: «ar trebui să facă totuși ceva» (§873).
  it("gives a date with no short place its place's name up to the first comma, and none while the place is to be announced", () => {
    const [typed, named, plain, tba] = calendarImageRows(
      june,
      [
        event("2026-06-03T16:00:00Z", "Tură", { locationShort: "Tâmpa", locationName: "Stația de telecabină Tâmpa" }),
        event("2026-06-05T16:00:00Z", "Shake out", { locationName: "Parcul Tractorul, intrarea principală" }),
        event("2026-06-07T16:00:00Z", "Intervale", { locationName: "  Stadionul   Olimpia " }),
        // The public read gives no name while the place is to be announced (§328).
        event("2026-06-09T16:00:00Z", "Cros", { locationName: null }),
      ],
      hourOnly,
    ).entries;
    expect([typed.place, typed.placeName]).toEqual(["Tâmpa", null]);
    expect([named.place, named.placeName]).toEqual([null, "Parcul Tractorul"]);
    expect(plain.placeName).toBe("Stadionul Olimpia");
    expect([tba.place, tba.placeName]).toEqual([null, null]);
    expect(placeHead("Sub Tâmpa, lângă Apeduct, Aleea Tiberiu Brediceanu, Brașov")).toBe("Sub Tâmpa");
    expect(placeHead(", Brașov")).toBeNull();
    expect(placeHead(undefined)).toBeNull();
  });

  it("says the distance and the climb in the pills' short words, «≈» when estimated, and nothing when the event states none", () => {
    const rows = calendarImageRows(
      june,
      [
        event("2026-06-01T16:30:00Z", "Happy Monday", { distanceMeters: 8000, distanceEstimated: false, elevationGainMeters: null, elevationGainEstimated: false }),
        event("2026-06-03T16:00:00Z", "Tură", { locationShort: "Tâmpa", distanceMeters: 6000, distanceEstimated: false, elevationGainMeters: 350, elevationGainEstimated: true }),
        event("2026-06-21T06:00:00Z", "Crosul", { locationShort: "Parc", distanceMeters: 10500, distanceEstimated: true, elevationGainMeters: 150, elevationGainEstimated: true }),
        event("2026-06-26T06:00:00Z", "Ședință"),
      ],
      format,
    ).entries;
    expect(rows.map((row) => [row.place, row.distance, row.elevation])).toEqual([
      [null, "8 km", null],
      ["Tâmpa", "6 km", "≈ 350 m D+"],
      ["Parc", "≈ 10,5 km", "≈ 150 m D+"],
      [null, null, null],
    ]);
  });

  it("lists the words to draw after the hour — the place, the distance, the climb — only those switched on and present", () => {
    const entry = { place: "Tâmpa", distance: "6 km", elevation: "≈ 350 m D+" };
    const all = { place: true, distance: true, elevation: true };
    expect(detailWords(entry, all)).toEqual(["Tâmpa", "6 km", "≈ 350 m D+"]);
    expect(detailWords(entry, { place: false, distance: true, elevation: false })).toEqual(["6 km"]);
    expect(detailWords({ place: null, distance: "8 km", elevation: null }, all)).toEqual(["8 km"]);
    expect(detailWords({ place: "", distance: null, elevation: null }, all)).toEqual([]);
    expect(detailWords(entry, { place: false, distance: false, elevation: false })).toEqual([]);
    // No short place (§873): the place's name, after the climb — the first word a short cell drops — and only under «Locul».
    const named = { place: null, placeName: "Parcul Tractorul", distance: "6 km", elevation: "≈ 350 m D+" };
    expect(detailWords(named, all)).toEqual(["6 km", "≈ 350 m D+", "Parcul Tractorul"]);
    expect(detailWords(named, { place: true, distance: false, elevation: false })).toEqual(["Parcul Tractorul"]);
    expect(detailWords(named, { place: false, distance: true, elevation: true })).toEqual(["6 km", "≈ 350 m D+"]);
    // A typed short place wins, and keeps its place first.
    expect(detailWords({ ...named, place: "Parc" }, all)).toEqual(["Parc", "6 km", "≈ 350 m D+"]);
  });

  // The owner, 2026-10-28: «this first check for "Locul" does not change anything!!» — no date had a short place yet (§863).
  it("says whether «Locul» has anything to draw in the month or the week, so the dialog can grey its tick", () => {
    const entry = (day: number, place: string | null): CalendarImageEntry => ({ day, time: "19:00", title: "Happy Monday", tone: "weekly", type: "GROUP_RUN", surface: null, special: false, cancelled: false, place, distance: null, elevation: null });
    expect(periodHasPlace([], null)).toBe(false);
    expect(periodHasPlace([entry(5, null), entry(12, " ")], null)).toBe(false);
    expect(periodHasPlace([entry(5, null), entry(12, "Tâmpa")], null)).toBe(true);
    // A week counts its own days only.
    expect(periodHasPlace([entry(5, null), entry(12, "Tâmpa")], [5, 6, 7, 8, 9, 10, 11])).toBe(false);
    expect(periodHasPlace([entry(5, null), entry(12, "Tâmpa")], [12, 13, 14, 15, 16, 17, 18])).toBe(true);
    // The place's name counts as well (§873): greyed only while no date of the period has its place announced.
    expect(periodHasPlace([{ ...entry(5, null), placeName: "Parcul Tractorul" }], null)).toBe(true);
    expect(periodHasPlace([{ ...entry(5, null), placeName: " " }], null)).toBe(false);
    expect(periodHasPlace([{ ...entry(5, null), placeName: "Parcul Tractorul" }], [12, 13, 14, 15, 16, 17, 18])).toBe(false);
  });
});

describe("the words in a cell", () => {
  it("keeps what fits and cuts the rest with «…»", () => {
    expect(fitText(ctx, "Happy Monday", 200)).toBe("Happy Monday");
    expect(fitText(ctx, "Happy Monday", 60)).toBe("Happy…");
  });

  it("breaks a title at spaces, and the last line allowed says it was cut", () => {
    expect(wrapText(ctx, "Happy Monday with Brașov Runners", 130, 3)).toEqual(["Happy Monday", "with Brașov", "Runners"]);
    expect(wrapText(ctx, "Happy Monday with Brașov Runners", 130, 2)).toEqual(["Happy Monday", "with Brașov…"]);
    expect(wrapText(ctx, "Happy Monday with Brașov Runners", 130, 1)).toEqual(["Happy Monday…"]);
  });
});

describe("a title kept whole", () => {
  it("breaks at spaces and keeps a dash with the word before it", () => {
    expect(wrapWhole(ctx, "Happy Monday with Brașov Runners", 130)).toEqual(["Happy Monday", "with Brașov", "Runners"]);
    expect(wrapWhole(ctx, "Trail Marathon — briefing", 160)).toEqual(["Trail Marathon\u00a0—", "briefing"]);
  });

  it("says a word wider than the line does not fit, or splits it with «-» when asked", () => {
    expect(wrapWhole(ctx, "Reconnaissance run", 80)).toBeNull();
    expect(wrapWhole(ctx, "Reconnaissance run", 80, true)).toEqual(["Reconna-", "issance", "run"]);
  });
});

describe("the one wrap the layouts share (the audit of 2026-10-27, D23 and D40)", () => {
  const fitsAll = (lines: string[], width: number) => lines.every((line) => ctx.measureText(line).width <= width);

  it("breaks at spaces like the greedy wraps when the lines end balanced, a dash staying with the word before it", () => {
    expect(wrapBalanced(ctx, "Happy Monday with Brașov Runners", 130)).toEqual(["Happy Monday", "with Brașov", "Runners"]);
    expect(wrapBalanced(ctx, "Trail Marathon — briefing", 160)).toEqual(["Trail Marathon\u00a0—", "briefing"]);
    expect(wrapBalanced(ctx, "", 100)).toEqual([]);
    expect(wrapBalanced(ctx, "  ", 100)).toEqual([]);
  });

  it("never leaves one short word alone on the last line when the line before can give it one", () => {
    const title = "CROSUL BRAȘOV RUNNERS — EDIȚIA A III-A";
    // Greedy, the ordinal would stand alone; balanced, the line before gives it «EDIȚIA A».
    expect(wrapBalanced(ctx, title, 330)).toEqual(["CROSUL BRAȘOV RUNNERS\u00a0—", "EDIȚIA A III-A"]);
    expect(wrapBalanced(ctx, title, 300)).toEqual(["CROSUL BRAȘOV RUNNERS\u00a0—", "EDIȚIA A III-A"]);
    expect(wrapBalanced(ctx, "Girls only shake out run", 200)).toEqual(["Girls only shake", "out run"]);
    for (let width = 70; width <= 240; width += 10) {
      const lines = wrapBalanced(ctx, "Girls only shake out run", width);
      expect(fitsAll(lines, width), `${width}: ${lines.join(" / ")}`).toBe(true);
      // «run» ends a line alone only when the line before is one word and cannot give «out».
      if (lines.at(-1) === "run") expect(lines.at(-2), `${width}: ${lines.join(" / ")}`).toBe("out");
    }
    // The orphan does not change ends: «ab» alone on the first line is no better than «op» alone on the last.
    expect(wrapBalanced(ctx, "ab cdefghijklmn op", 150)).toEqual(["ab cdefghijklmn", "op"]);
  });

  it("moves words down only while the last line stays narrower than the ratio asked, and the moved line fits", () => {
    expect(wrapBalanced(ctx, "Girls only shake out run", 160)).toEqual(["Girls only shake", "out run"]);
    expect(wrapBalanced(ctx, "Girls only shake out run", 160, { minLastRatio: 0.6 })).toEqual(["Girls only", "shake out run"]);
    // «Brașov Runners» would be wider than the line: «Runners» stays, however short.
    expect(wrapBalanced(ctx, "Happy Monday with Brașov Runners", 130, { minLastRatio: 0.9 })).toEqual(["Happy Monday", "with Brașov", "Runners"]);
  });

  it("hyphenates a word wider than the line after a vowel, three letters at least on each side, when asked", () => {
    const pieces = wrapBalanced(ctx, "RECONNAISSANCE", 100, { hyphenate: true });
    expect(pieces).toEqual(["RECONNAI-", "SSANCE"]);
    expect(fitsAll(pieces, 100)).toBe(true);
    expect(pieces[0]).toMatch(/^.{3,}[AEIOUY]-$/);
    expect(pieces[1].length).toBeGreaterThanOrEqual(3);
    expect(wrapBalanced(ctx, "ULTRAMARATONIȘTII", 120, { hyphenate: true })).toEqual(["ULTRAMARATO-", "NIȘTII"]);
    // A 17-letter word on a narrow line takes two hyphens, each break after a vowel.
    expect(wrapBalanced(ctx, "ULTRAMARATONIȘTII", 70, { hyphenate: true })).toEqual(["ULTRA-", "MARATO-", "NIȘTII"]);
    // The Romanian vowels count, in capitals too; «Ș» does not.
    expect(wrapBalanced(ctx, "ALERGĂTORII", 80, { hyphenate: true })).toEqual(["ALERGĂ-", "TORII"]);
    expect(wrapBalanced(ctx, "RECUNOAȘTEREA", 100, { hyphenate: true })).toEqual(["RECUNOA-", "ȘTEREA"]);
    // The rest of the title joins the word's last piece.
    expect(wrapBalanced(ctx, "Course reconnaissance run", 100, { hyphenate: true })).toEqual(["Course", "reconnai-", "ssance run"]);
    // The dash glued behind a word is not the word: «Marathon» fits bare, so it is not split for its dash and
    // stands one dash wider than the line; split, the dash goes on the last piece, never on a line of its own.
    expect(wrapBalanced(ctx, "Trail Marathon — briefing", 90, { hyphenate: true })).toEqual(["Trail", "Marathon\u00a0—", "briefing"]);
    expect(wrapBalanced(ctx, "Trail Marathon — briefing", 60, { hyphenate: true })).toEqual(["Trail", "Mara-", "thon\u00a0—", "brie-", "fing"]);
    for (let width = 60; width <= 120; width += 10) {
      const lines = wrapBalanced(ctx, "CROSUL BRAȘOV RUNNERS — EDIȚIA A III-A", width, { hyphenate: true });
      for (const line of lines) {
        expect(line, `${width}: ${lines.join(" / ")}`).not.toMatch(/^[\u00a0 ]?[—–-]/);
        // Three letters at least before a glued dash: «ERS —», never «RS —».
        if (line.endsWith("\u00a0—")) expect(line, `${width}: ${lines.join(" / ")}`).toMatch(/^[^\s-]{3,}\u00a0—$/);
      }
    }
  });

  it("breaks at a hyphen the word already has first, adding none, and starts no piece with one", () => {
    expect(wrapBalanced(ctx, "SHAKE-OUT", 60, { hyphenate: true })).toEqual(["SHAKE-", "OUT"]);
    expect(wrapBalanced(ctx, "TÂMPA-BRAȘOV-POIANA", 80, { hyphenate: true })).toEqual(["TÂMPA-", "BRAȘOV-", "POIANA"]);
  });

  it("falls back to the widest prefix with three letters each side when no break after a vowel fits, and leaves a word too short to split", () => {
    expect(wrapBalanced(ctx, "BRRRRRRRRRRR", 80, { hyphenate: true })).toEqual(["BRRRRRR-", "RRRRR"]);
    expect(wrapBalanced(ctx, "ABCDE", 30, { hyphenate: true })).toEqual(["ABCDE"]);
  });

  it("leaves a word wider than the line alone on its own line without `hyphenate`, never cut with «…»", () => {
    expect(wrapBalanced(ctx, "a reconnaissance b", 60)).toEqual(["a", "reconnaissance", "b"]);
    expect(wrapBalanced(ctx, "RECONNAISSANCE", 100)).toEqual(["RECONNAISSANCE"]);
  });
});

describe("«Afiș»: each series under its weekday", () => {
  const entry = (day: number, title: string, overrides: Partial<CalendarImageEntry> = {}): CalendarImageEntry => ({
    day,
    time: "19:30",
    title,
    tone: "weekly",
    type: "GROUP_RUN",
    surface: null,
    special: false,
    cancelled: false,
    ...NO_DETAILS,
    ...overrides,
  });
  const recurring = (title: string, type: CalendarImageEntry["type"] = "GROUP_RUN") => ({ title, sentence: `${title}, every week`, tone: "weekly" as const, type, surface: null, ...NO_DETAILS });
  // June 2026: the 1st is a Monday.
  const data = (entries: CalendarImageEntry[], rows: ReturnType<typeof recurring>[]) => ({ month: { year: 2026, month: 6 }, entries, recurring: rows }) as unknown as CalendarImageData;

  it("counts the columns from Monday", () => {
    expect([1, 3, 7, 30].map((day) => weekdayColumn({ year: 2026, month: 6 }, day))).toEqual([0, 2, 6, 1]);
  });

  it("puts a series in its weekday's head with the hour most of its dates keep, and its dates become marks", () => {
    const plan = posterPlan(
      data(
        [
          entry(1, "Happy Monday"),
          entry(3, "Hill run", { time: "19:00" }),
          entry(5, "Girls only", { tone: "special", special: true, time: "18:00" }),
          entry(8, "Happy Monday", { time: "20:00" }),
          entry(10, "Hill run", { time: "19:00", cancelled: true }),
          entry(15, "happy monday "),
          entry(17, "Hill run", { time: "19:00" }),
        ],
        [recurring("Happy Monday"), recurring("Hill run")],
      ),
    );
    expect(plan.lanes.map((lane) => [lane.title, lane.columns, lane.inHeads, lane.time, lane.variant])).toEqual([
      ["Happy Monday", [0], true, "19:30", 0],
      ["Hill run", [2], true, "19:00", 0],
    ]);
    expect([...plan.marks.keys()]).toEqual([1, 3, 8, 10, 15, 17]);
    expect([...plan.dates.values()].flat().map((date) => date.title)).toEqual(["Girls only"]);
  });

  it("stacks two series of one weekday, the earlier first, and puts a series on two weekdays in both heads in a look of its own (D09)", () => {
    const plan = posterPlan(
      data(
        [
          entry(2, "Track", { time: "18:30" }),
          entry(2, "Tempo", { time: "07:00" }),
          entry(9, "Track", { time: "18:30" }),
          entry(9, "Tempo", { time: "07:00" }),
          entry(9, "Intervals"),
          entry(11, "Intervals"),
        ],
        [recurring("Track"), recurring("Tempo"), recurring("Intervals")],
      ),
    );
    expect(plan.lanes.map((lane) => [lane.title, lane.columns, lane.inHeads, lane.variant])).toEqual([
      ["Track", [1], true, 1],
      ["Tempo", [1], true, 0],
      ["Intervals", [1, 3], true, 2],
    ]);
  });

  it("leaves a series on more than three weekdays to the legend", () => {
    const plan = posterPlan(data([1, 2, 3, 4].map((day) => entry(day, "Daily")), [recurring("Daily")]));
    expect(plan.lanes.map((lane) => [lane.columns, lane.inHeads])).toEqual([[[0, 1, 2, 3], false]]);
  });

  it("tells a series that keeps every one of its weekdays from one that does not, a special edition counting as kept (D10)", () => {
    // June 2026 has five Mondays (1–29) and four Wednesdays (3–24).
    const plan = posterPlan(
      data(
        [
          ...[1, 8, 15, 22, 29].map((day) => entry(day, "Happy Monday", day === 15 ? { special: true, tone: "special" } : {})),
          ...[3, 17].map((day) => entry(day, "Fortnightly")),
        ],
        [recurring("Happy Monday"), recurring("Fortnightly")],
      ),
    );
    expect(plan.lanes.map((lane) => [lane.title, lane.weekly])).toEqual([
      ["Happy Monday", true],
      ["Fortnightly", false],
    ]);
  });

  it("writes a series' special edition in full, and keeps a series of another type apart", () => {
    const plan = posterPlan(
      data(
        [entry(1, "Happy Monday"), entry(8, "Happy Monday", { special: true, tone: "special" }), entry(15, "Happy Monday"), entry(6, "Happy Monday", { type: "HIKE" })],
        [recurring("Happy Monday")],
      ),
    );
    expect([...plan.marks.keys()]).toEqual([1, 15]);
    expect([...plan.dates.keys()]).toEqual([8, 6]);
  });
});

describe("«Seriile în cap» drawn: the sample months of `yarn calendar:preview`", () => {
  const samples = { june, busy, sparse, fortnight } as unknown as Record<string, CalendarImageData>;
  const fonts = { body: "Roboto", display: "Facon", script: "Caveat", poster: "Poppins" };
  /** The month on the stub canvas in «Afiș», every detail on: what it wrote, where and at what size. */
  function draw(name: string, ratio: CalendarImageOptions["ratio"]) {
    const { ctx, records } = stubCanvas();
    drawCalendarImage(ctx, samples[name], { theme: "poster", ratio, layout: "heads", week: null, legend: true, details: ALL_DETAILS }, fonts, { logo: null });
    return records.texts;
  }
  const plain = (text: string) => text.replace(/\u00a0/g, " ");

  it("writes a series on two weekdays in both heads, and a fortnightly one's rhythm under its title (D09, D10)", () => {
    const texts = draw("fortnight", "portrait");
    const firstDay = Math.min(...texts.filter((text) => text.text === "1").map((text) => text.top));
    expect(texts.filter((text) => text.text.startsWith("INTERVALE") && text.top < firstDay)).toHaveLength(2);
    expect(texts.some((text) => text.text.startsWith("O dată la două săptămâni"))).toBe(true);
  });

  it("starts a weekday with no series right under its label: June's Saturday above its Monday under a strip (D02)", () => {
    const texts = draw("june", "portrait");
    const top = (day: string) => Math.min(...texts.filter((text) => text.text === day).map((text) => text.top));
    expect(top("6")).toBeLessThan(top("1"));
    // The strips' titles read at a phone's width: 20 px at least.
    expect(texts.filter((text) => text.text.startsWith("HAPPY MONDAY")).every((text) => text.size >= 20)).toBe(true);
  });

  /**
   * The list's day badges in reading order — the numbers drawn after its heading, which the list draws last —
   * or null when the picture has no list.
   */
  function listedDays(texts: ReturnType<typeof draw>, name: string): number[] | null {
    const at = texts.findIndex((text) => text.text === samples[name].words.specialTitle.toLocaleUpperCase("ro-RO"));
    if (at < 0) return null;
    const badges = texts.slice(at + 1).filter((text) => /^\d{1,2}$/.test(text.text));
    return badges.sort((a, b) => Math.round(a.top / 8) - Math.round(b.top / 8) || a.left - b.left).map((text) => Number(text.text));
  }

  it("lists every special date in day order, left to right and then down (D11, D28), the hourless one with «time to be announced» (D36) — and no list without the month's race", () => {
    for (const [name, data] of Object.entries(samples)) {
      const race = data.specials.find((special) => special.type === "RACE");
      for (const ratio of ["portrait", "square", "story", "landscape"] as const) {
        const texts = draw(name, ratio);
        const days = listedDays(texts, name);
        if (name === "busy" || name === "fortnight") expect(days, `${name} · ${ratio}`).toEqual(data.specials.map((special) => special.day).sort((a, b) => a - b));
        if (name === "busy") expect(texts.some((text) => text.text.startsWith("time to be announced")), ratio).toBe(true);
        // The race in the list wherever a list is drawn, on every sample month and format.
        if (race && days) expect(days, `${name} · ${ratio}: the race listed`).toContain(race.day);
      }
    }
  });

  /**
   * The most of `title` that consecutive drawn lines read as its start — «BRAȘOV» then «RUNNERS HAL…» reads
   * «BRAȘOV RUNNERS HAL», «RECUNOAȘTE-» then «REA TRASEULUI» reads «RECUNOAȘTEREA TRASEULUI» — or "".
   */
  function reads(lines: string[], title: string): string {
    let best = "";
    lines.forEach((_, start) => {
      let text = "";
      for (let index = start; index < lines.length; index += 1) {
        const line = lines[index];
        const joined = text === "" ? [line] : text.endsWith("-") ? [text.slice(0, -1) + line, text + line] : [`${text} ${line}`];
        const next = joined.find((candidate) => title.startsWith(candidate.replace(/[-…]$/, "")));
        if (next === undefined) break;
        text = next;
        const bare = next.replace(/[-…]$/, "");
        if (bare.length > best.length) best = bare;
        if (next.endsWith("…")) break;
      }
    });
    return best;
  }

  it("names every special date on every picture, and the race whole in its day whenever another date is whole in its own (D04)", () => {
    for (const [name, data] of Object.entries(samples)) {
      for (const ratio of ["portrait", "square", "story", "landscape"] as const) {
        const drawn = draw(name, ratio).map((text) => plain(text.text));
        // The days are drawn after the heads — from the first day's number — and before the list, which
        // starts at its heading: a strip's «BRAȘOV RUNNERS» is not the race named.
        const heading = drawn.indexOf(data.words.specialTitle.toLocaleUpperCase("ro-RO"));
        const days = drawn.slice(drawn.indexOf("1"), heading < 0 ? drawn.length : heading);
        const list = heading < 0 ? [] : drawn.slice(heading + 1);
        const titleOf = (special: { title: string }) => plain(special.title.toLocaleUpperCase("ro-RO"));
        const wholeInDay = (special: { title: string }) => reads(days, titleOf(special)) === titleOf(special);
        const wordsOf = (text: string) => (text === "" ? 0 : text.split(" ").length);
        for (const special of data.specials) {
          const title = titleOf(special);
          // Whole in the list, or two words of it at least in its day — never only its chip or a «+2 altele».
          expect(reads(list, title) === title || wordsOf(reads(days, title)) >= Math.min(2, wordsOf(title)), `${name} · ${ratio} · ${special.title}`).toBe(true);
        }
        const race = data.specials.find((special) => special.type === "RACE");
        if (!race) continue;
        const another = data.specials.some((special) => special !== race && wholeInDay(special));
        if (another) expect(reads(days, titleOf(race)), `${name} · ${ratio}: the race whole in its day`).toBe(titleOf(race));
        else expect(wordsOf(reads(days, titleOf(race))), `${name} · ${ratio}: two words of the race in its day`).toBeGreaterThanOrEqual(2);
      }
    }
  });

  it("keeps a cancelled date's glyphs with its grey pill — both of its series' on fortnight's 17th and busy's 19th, on square and portrait (the review of 2026-10-28)", () => {
    const glyphPaths = new Set<string>([...Object.values(TYPE_PATHS), ...Object.values(SURFACE_PATHS)]);
    // The stub's capitals are wider than Poppins's: «CANCELLED» does not fit busy's narrow days there at all.
    // «CANCELED» leaves the room «CANCELLED» has on the picture — the pill alone fits, not with a glyph in it.
    const months = { ...samples, busyCanceled: { ...samples.busy, words: { ...samples.busy.words, cancelled: "Canceled" } } };
    for (const [name, data] of Object.entries(months)) {
      const plan = posterPlan(data);
      const length = new Date(Date.UTC(data.month.year, data.month.month, 0)).getUTCDate();
      const label = data.words.cancelled.toLocaleUpperCase("ro-RO");
      for (const ratio of ["portrait", "square", "story", "landscape"] as const) {
        const { ctx, records } = stubCanvas();
        drawCalendarImage(ctx, data, { theme: "poster", ratio, layout: "heads", week: null, legend: true, details: ALL_DETAILS }, fonts, { logo: null });
        // The days are drawn in order, each from its number: what a day drew comes before the next day's number.
        const numbers: number[] = [];
        let at = records.texts.findIndex((text) => text.text === "1");
        for (let day = 1; day <= length && at >= 0; day += 1) {
          numbers.push(records.texts[at].order);
          at = records.texts.findIndex((text, index) => index > at && text.text === String(day + 1));
        }
        expect(numbers, `${name} · ${ratio}: every day's number`).toHaveLength(length);
        for (const [day, marks] of plan.marks) {
          const cancelled = marks.find((mark) => mark.entry.cancelled);
          if (!cancelled || marks.length > 1 || plan.dates.has(day)) continue;
          const within = (order: number) => order > numbers[day - 1] && order < (numbers[day] ?? Infinity);
          if (!records.texts.some((text) => within(text.order) && text.text === label)) continue;
          const drawn = records.shapes.filter((shape) => within(shape.order) && glyphPaths.has(shape.d)).map((shape) => shape.d);
          expect(drawn.length, `${name} · ${ratio} · day ${day}: a cancelled date's glyphs`).toBeGreaterThan(0);
          if (name !== "busy" && (ratio === "square" || ratio === "portrait")) expect(drawn, `${name} · ${ratio} · day ${day}: both glyphs`).toEqual(eventGlyphs(cancelled.lane.type, cancelled.lane.surface));
        }
      }
    }
  });

  it("cuts a shortened title after a whole word — «NIGHT RUN…», never «NIGHT RUN O…» nor «NIGHT RUN ON…» — by letters only when its first word does not fit (the review of 2026-10-28)", () => {
    for (const [name, data] of Object.entries(samples)) {
      const titles = [...data.entries, ...data.recurring].map((entry) => plain(entry.title.toLocaleUpperCase("ro-RO")));
      for (const ratio of ["portrait", "square", "story", "landscape"] as const) {
        for (const text of draw(name, ratio).map((record) => plain(record.text))) {
          if (!text.endsWith("…") || text !== text.toLocaleUpperCase("ro-RO")) continue;
          const stem = text.slice(0, -1);
          // A start of two words or more is cut where a word ends; a single word may be its own first letters.
          if (!stem.includes(" ")) continue;
          const atWord = titles.some((title) => {
            for (let from = title.indexOf(stem); from >= 0; from = title.indexOf(stem, from + 1)) if (!/^[\p{L}\p{N}]/u.test(title.slice(from + stem.length))) return true;
            return false;
          });
          expect(atWord, `${name} · ${ratio}: «${text}»`).toBe(true);
          // Nor on a word of one or two letters, when the words before it fit: «NIGHT RUN…», not «NIGHT RUN ON…».
          expect(/\s\p{L}{1,2}$/u.test(stem), `${name} · ${ratio}: «${text}»`).toBe(false);
        }
      }
    }
  });

  it("draws every run of a day with two series — a pill each, or «+1 altele» counting one — and widens a strip over the free heads before it cuts it (the review of 2026-10-28)", () => {
    // September's fortnight and a Thursday series at 07:00: Thursdays 3, 10, 17 and 24 hold two marks each,
    // the 17th's second one cancelled. Its own month here, not a sample of `yarn calendar:preview`.
    const base = samples.fortnight;
    const morning = { title: "Alergare de dimineață la Olimpia", tone: "weekly", type: "GROUP_RUN", surface: "ASPHALT", place: "Olimpia", distance: null, elevation: null } as const;
    const entries = [...base.entries, ...[3, 10, 17, 24].map((day) => ({ ...morning, day, time: "07:00", special: false, cancelled: false }))];
    const month = { ...base, entries: entries.sort((a, b) => a.day - b.day || (a.time ?? "99").localeCompare(b.time ?? "99")), recurring: [...base.recurring, { ...morning, sentence: "În fiecare joi, la 07:00" }] } as CalendarImageData;
    const plan = posterPlan(month);
    const { words } = month;
    for (const theme of ["poster", "dark"] as const) {
      for (const ratio of ["portrait", "square", "story", "landscape"] as const) {
        const { ctx, records } = stubCanvas();
        drawCalendarImage(ctx, month, { theme, ratio, layout: "heads", week: null, legend: true, details: ALL_DETAILS }, fonts, { logo: null });
        const texts = records.texts.map((text) => text.text);
        // The days are drawn in order, each from its number: what a day wrote is what comes before the next one's.
        let at = texts.indexOf("1");
        // No strip shortened while a free head is left beside it: the heads come before the first day.
        expect(texts.slice(0, at).filter((text) => text.includes("…")), `${theme} · ${ratio}`).toEqual([]);
        for (let day = 1; day <= 30; day += 1) {
          const next = day < 30 ? texts.indexOf(String(day + 1), at + 1) : texts.length;
          const drawn = texts.slice(at + 1, next);
          const marks = plan.marks.get(day) ?? [];
          const counted = drawn.reduce((sum, text) => sum + Number(/^\+(\d+) /.exec(text)?.[1] ?? 0), 0);
          const pills = marks.filter(({ entry }) => {
            const index = drawn.indexOf(entry.cancelled ? words.cancelled.toLocaleUpperCase("ro-RO") : (entry.time ?? ""));
            if (index >= 0) drawn.splice(index, 1);
            return index >= 0;
          }).length;
          if (marks.length > 0) {
            expect(pills, `${theme} · ${ratio} · day ${day}: a pill`).toBeGreaterThan(0);
            expect(pills + counted, `${theme} · ${ratio} · day ${day}: every run`).toBe(marks.length);
          }
          at = next;
        }
      }
    }
  });
});

describe("«Perioada» → «Săptămâna»: a week of the month, kept to this month's days", () => {
  const days = (month: number) => weeksOf({ year: 2026, month }).map((week) => week.days);

  it("cuts June 2026 (a Monday start) into five weeks, the last of two days", () => {
    expect(days(6)).toEqual([
      [1, 2, 3, 4, 5, 6, 7],
      [8, 9, 10, 11, 12, 13, 14],
      [15, 16, 17, 18, 19, 20, 21],
      [22, 23, 24, 25, 26, 27, 28],
      [29, 30],
    ]);
  });

  it("gives August 2026 six weeks, the first a weekend and the last a Monday, and November six, the first a Sunday alone", () => {
    expect(days(8)).toEqual([[1, 2], [3, 4, 5, 6, 7, 8, 9], [10, 11, 12, 13, 14, 15, 16], [17, 18, 19, 20, 21, 22, 23], [24, 25, 26, 27, 28, 29, 30], [31]]);
    expect(days(11)).toEqual([[1], [2, 3, 4, 5, 6, 7, 8], [9, 10, 11, 12, 13, 14, 15], [16, 17, 18, 19, 20, 21, 22], [23, 24, 25, 26, 27, 28, 29], [30]]);
  });

  it("names the week by its days in the month, with an en dash, and a lone day alone", () => {
    expect(weekLabel(weekOf({ year: 2026, month: 6 }, 0), "iunie")).toBe("1–7 iunie");
    expect(weekLabel(weekOf({ year: 2026, month: 6 }, 4), "iunie")).toBe("29–30 iunie");
    expect(weekLabel(weekOf({ year: 2026, month: 11 }, 0), "noiembrie")).toBe("1 noiembrie");
    expect(weekLabel(weekOf({ year: 2026, month: 8 }, 1), "August")).toBe("3–9 August");
  });

  it("keeps an index past the month's weeks on the last one, and under them on the first", () => {
    expect(weekOf({ year: 2026, month: 6 }, 9).from).toBe(29);
    expect(weekOf({ year: 2026, month: 6 }, -1).from).toBe(1);
  });

  it("puts the week's range in the file name", () => {
    expect(weekSlug({ year: 2026, month: 6 }, weekOf({ year: 2026, month: 6 }, 0))).toBe("2026-06-01-07");
    expect(weekSlug({ year: 2026, month: 11 }, weekOf({ year: 2026, month: 11 }, 0))).toBe("2026-11-01-01");
  });

  it("offers today's week when today is in the month, else the first week with a date, else the first", () => {
    const data = { month: { year: 2026, month: 6 }, entries: [{ day: 17 }, { day: 24 }] as CalendarImageData["entries"] };
    expect(initialWeek(data, new Date(2026, 5, 30, 9))).toBe(4);
    expect(initialWeek(data, new Date(2026, 5, 1, 9))).toBe(0);
    expect(initialWeek(data, new Date(2026, 9, 27, 9))).toBe(2);
    expect(initialWeek({ ...data, entries: [] }, new Date(2026, 9, 27, 9))).toBe(0);
  });
});

describe("a week's cards: the glyphs and the hour, the details after it, the title under them", () => {
  const fonts = { body: "sans-serif", display: "sans-serif", script: "cursive", poster: "Poppins" };
  const words: CalendarImageData["words"] = {
    heading: "Evenimente",
    monthTitle: "iunie 2026",
    monthName: "iunie",
    weekdays: ["lun.", "mar.", "mie.", "joi", "vin.", "sâm.", "dum."],
    weekdaysLong: ["luni", "marți", "miercuri", "joi", "vineri", "sâmbătă", "duminică"],
    at: "ora {time}",
    hashtags: "#brasovrunners",
    recurringTitle: "Evenimente recurente",
    specialTitle: "Evenimente speciale",
    cancelled: "Anulat",
    tba: "ora se anunță",
    follow: "Urmărește-ne",
    more: "+{count} altele",
    emptyMonth: "Nicio alergare luna aceasta",
    emptyWeek: "Nicio alergare săptămâna aceasta",
  };
  const entry = (overrides: Partial<CalendarImageEntry> = {}): CalendarImageEntry => ({ day: 1, time: "19:30", title: "Happy Monday", tone: "weekly", type: "GROUP_RUN", surface: "ASPHALT", special: false, cancelled: false, place: "Parc", distance: "8 km", elevation: "≈ 350 m D+", ...overrides });
  /** The first week of June 2026 with `entries` on Monday the 1st, drawn on the stub: its texts, in the order drawn. */
  function week(entries: CalendarImageEntry[], details = ALL_DETAILS, ratio: CalendarImageOptions["ratio"] = "portrait") {
    const data: CalendarImageData = { month: { year: 2026, month: 6 }, entries, recurring: [], specials: [], socials: ["instagram"], host: "example.test", clubName: "Brașov Runners", words };
    const { ctx, records } = stubCanvas();
    drawCalendarImage(ctx, data, { theme: "poster", ratio, layout: "heads", week: 0, legend: true, details }, fonts, { logo: null });
    return records.texts;
  }
  const texts = (...args: Parameters<typeof week>) => week(...args).map((text) => text.text);

  it("writes the details after the hour, « · » between them, only those «Detalii» has on, at the hour's size and in the hour's face", () => {
    const all = week([entry()]);
    const head = all.find((text) => text.text.startsWith("ora"));
    expect(head?.text).toBe("ora 19:30 · Parc · 8 km · ≈ 350 m D+");
    const title = all.find((text) => text.text === "HAPPY MONDAY");
    expect(head?.font).toMatch(/^500 /);
    expect(title?.font).toMatch(/^700 /);
    expect(head?.size).toBeLessThan(title?.size ?? 0);
    expect(texts([entry()], { place: true, distance: false, elevation: false })).toContain("ora 19:30 · Parc");
    expect(texts([entry()], { place: false, distance: true, elevation: true })).toContain("ora 19:30 · 8 km · ≈ 350 m D+");
    expect(texts([entry({ distance: null, elevation: null })])).toContain("ora 19:30 · Parc");
    const none = texts([entry()], { place: false, distance: false, elevation: false });
    expect(none).toContain("ora 19:30");
    expect(none.some((text) => /Parc|8 km|D\+/.test(text))).toBe(false);
  });

  it("says «ora se anunță» where the hour goes for a date whose hour is not set, the details after it as after an hour", () => {
    expect(texts([entry({ time: null })])).toContain("ora se anunță · Parc · 8 km · ≈ 350 m D+");
    expect(texts([entry({ time: null, ...NO_DETAILS })])).toContain("ora se anunță");
  });

  it("keeps «ora se anunță» whole on a 16:9 column, the title a little smaller for it, and runs the details on to the second line", () => {
    // At the column's largest size the words do not fit after the glyphs; a few pixels down they do.
    const all = week([entry({ time: null })], ALL_DETAILS, "landscape");
    const lines = all.map((text) => text.text);
    expect(lines).toContain("ora se anunță");
    expect(lines).toContain("Parc · 8 km");
    expect(lines.some((text) => /^(ora se|anunță)/.test(text) && text !== "ora se anunță")).toBe(false);
    const title = all.find((text) => text.text === "HAPPY");
    expect(title?.size).toBeGreaterThanOrEqual(26);
    expect(title?.size).toBeLessThan(36);
  });

  it("breaks an hour no size from 26 up holds — English «time to be announced» on a 16:9 column — over the head's two lines, with no detail glued to its end", () => {
    const english = { ...words, at: "at {time}", tba: "time to be announced" };
    const data: CalendarImageData = { month: { year: 2026, month: 6 }, entries: [entry({ time: null })], recurring: [], specials: [], socials: [], host: "example.test", clubName: "Brașov Runners", words: english };
    const { ctx, records } = stubCanvas();
    drawCalendarImage(ctx, data, { theme: "poster", ratio: "landscape", layout: "heads", week: 0, legend: true, details: ALL_DETAILS }, fonts, { logo: null });
    const lines = records.texts.map((text) => text.text);
    expect(lines).toEqual(expect.arrayContaining(["time to be", "announced"]));
    expect(lines.some((text) => /Parc|8 km|D\+/.test(text))).toBe(false);
    // The title keeps the column's largest size: the hour did not shrink it.
    expect(records.texts.find((text) => text.text === "HAPPY")?.size).toBe(36);
  });

  it("writes «ANULAT» alone for a cancelled date, in a weight no title has, and none of its details", () => {
    const all = week([entry({ cancelled: true })]);
    const off = all.find((text) => text.text === "ANULAT");
    expect(off?.font).toMatch(/^800 /);
    expect(all.some((text) => /Parc|8 km|D\+/.test(text.text))).toBe(false);
    expect(all.map((text) => text.text)).toContain("HAPPY MONDAY");
  });

  it("wraps the details to a second line on a 16:9 column, and drops them from the end rather than run to a third", () => {
    // A 16:9 column of a seven-day week is about 249 px wide: after the two glyphs, «ora 19:30» alone fills
    // the first line; «Poiana Brașov» opens the second and leaves no room for «≈ 12 km», let alone the climb.
    const all = texts([entry({ place: "Poiana Brașov", distance: "≈ 12 km", elevation: "≈ 700 m D+" })], ALL_DETAILS, "landscape");
    expect(all).toContain("ora 19:30");
    expect(all).toContain("Poiana Brașov");
    expect(all.some((text) => /12 km|700 m/.test(text))).toBe(false);
    // The same date on the portrait's wide card: one line, every detail.
    expect(texts([entry({ place: "Poiana Brașov", distance: "≈ 12 km", elevation: "≈ 700 m D+" })])).toContain("ora 19:30 · Poiana Brașov · ≈ 12 km · ≈ 700 m D+");
  });

  it("balances a title's lines: no short word left alone on the last one", () => {
    // On the portrait's wide card the greedy break leaves «RUNNERS» alone under «HAPPY MONDAY WITH BRAȘOV».
    const all = texts([entry({ title: "Happy Monday with Brașov Runners" })]);
    expect(all).toContain("HAPPY MONDAY WITH");
    expect(all).toContain("BRAȘOV RUNNERS");
  });

  it("splits a word no card holds whole with «-» after a vowel, rather than cut the title with «…»", () => {
    // Four of them on one day of a 16:9 week: no 249-px card holds «ULTRAMARATONIȘTII» whole at 26 px or more,
    // so under 26 it goes in pieces, each but the last ending in a vowel and «-».
    const long = Array.from({ length: 4 }, () => entry({ title: "Recunoașterea traseului pentru ultramaratoniștii clubului" }));
    const all = texts(long, ALL_DETAILS, "landscape");
    const pieces = all.filter((text) => /^[A-ZĂÂÎȘȚ]+-$/.test(text));
    expect(pieces.length).toBeGreaterThan(0);
    for (const piece of pieces) expect(piece, piece).toMatch(/[AEIOUYĂÂÎ]-$/);
    expect(all.some((text) => text.includes("…"))).toBe(false);
  });

  it("sets the titles of a week of four dates — June's first — at 26 px or more in every format, over the floor of 18", () => {
    const june = [
      entry({ day: 1, title: "Happy Monday with Brașov Runners" }),
      entry({ day: 3, time: "19:00", title: "Running up that hilly Tâmpa with Brașov Runners", surface: "TRAIL", place: "Tâmpa", distance: "6 km" }),
      entry({ day: 5, time: "18:00", title: "Girls only shake out run", tone: "special", special: true, distance: "5 km", elevation: null }),
      entry({ day: 7, time: "10:00", title: "Dynafit shoe testing x Coffee social event", tone: "other", type: "GEAR_TEST", surface: "TRAIL", place: "Tâmpa", distance: null, elevation: null }),
    ];
    for (const ratio of ["portrait", "square", "story", "landscape"] as const) {
      const titles = week(june, ALL_DETAILS, ratio).filter((text) => /^700 /.test(text.font));
      expect(titles.length, ratio).toBeGreaterThanOrEqual(4);
      expect(Math.min(...titles.map((text) => text.size)), ratio).toBeGreaterThanOrEqual(26);
    }
  });

  it("names each day by its own weekday: the first week of August 2026 is a Saturday and a Sunday, the last a Monday", () => {
    const august = (index: number) => {
      const data: CalendarImageData = { month: { year: 2026, month: 8 }, entries: [entry({ day: index === 0 ? 1 : 31 })], recurring: [], specials: [], socials: [], host: "example.test", clubName: "Brașov Runners", words };
      const { ctx, records } = stubCanvas();
      drawCalendarImage(ctx, data, { theme: "poster", ratio: "portrait", layout: "heads", week: index, legend: true, details: ALL_DETAILS }, fonts, { logo: null });
      return records.texts.map((text) => text.text);
    };
    expect(august(0)).toEqual(expect.arrayContaining(["SÂMBĂTĂ", "DUMINICĂ"]));
    expect(august(0)).not.toContain("LUNI");
    expect(august(5)).toContain("LUNI");
    expect(august(5)).not.toContain("SÂMBĂTĂ");
  });
});

describe("«Sezonul lunii»", () => {
  it("draws each month in its season's palette", () => {
    expect([1, 3, 6, 9, 12].map((month) => paletteFor("season", month))).toEqual(["winter", "spring", "summer", "autumn", "winter"]);
    expect(paletteFor("dark", 6)).toBe("dark");
  });
});

describe("the themes are palettes of the layouts", () => {
  /** A context that measures nine units a character, remembers the page's gradient and the words, and draws nothing. */
  function stubContext() {
    const stops: string[] = [];
    const texts: string[] = [];
    const state: Record<string | symbol, unknown> = {};
    const nothing = () => undefined;
    const ctx = new Proxy({} as CanvasRenderingContext2D, {
      get: (_, key) => {
        if (key === "measureText") return (text: string) => ({ width: [...text].length * 9 });
        if (key === "fillText") return (text: string) => void texts.push(text);
        if (key === "createLinearGradient") return () => ({ addColorStop: (_offset: number, colour: string) => void stops.push(colour) });
        return key in state ? state[key] : nothing;
      },
      set: (_, key, value) => {
        state[key] = value;
        return true;
      },
    });
    return { ctx, stops, texts };
  }
  const entry = (day: number, title: string, overrides: Partial<CalendarImageEntry> = {}): CalendarImageEntry => ({ day, time: "19:30", title, tone: "weekly", type: "GROUP_RUN", surface: "ASPHALT", special: false, cancelled: false, place: "Parc", distance: "8 km", elevation: null, ...overrides });
  const data: CalendarImageData = {
    month: { year: 2026, month: 6 },
    entries: [entry(1, "Happy Monday"), entry(8, "Happy Monday"), entry(5, "Girls only shake out run", { tone: "special", special: true, time: "18:00" }), entry(7, "Coffee social", { tone: "other", type: "COFFEE", surface: null, time: "10:00", ...NO_DETAILS })],
    recurring: [{ title: "Happy Monday", sentence: "În fiecare luni, la 19:30", tone: "weekly", type: "GROUP_RUN", surface: "ASPHALT", place: "Parc", distance: "8 km", elevation: null }],
    specials: [
      { day: 5, title: "Girls only shake out run", tone: "special", type: "GROUP_RUN", surface: "ASPHALT", place: "Parc", distance: "5 km", elevation: null },
      { day: 7, title: "Coffee social", tone: "other", type: "COFFEE", surface: null, ...NO_DETAILS },
    ],
    socials: ["instagram"],
    host: "example.test",
    clubName: "Brașov Runners",
    words: {
      heading: "Evenimente",
      monthTitle: "iunie 2026",
      monthName: "iunie",
      weekdays: ["lun.", "mar.", "mie.", "joi", "vin.", "sâm.", "dum."],
      weekdaysLong: ["luni", "marți", "miercuri", "joi", "vineri", "sâmbătă", "duminică"],
      at: "ora {time}",
      hashtags: "#brasovrunners",
      recurringTitle: "Evenimente recurente",
      specialTitle: "Evenimente speciale",
      cancelled: "Anulat",
      tba: "ora se anunță",
      follow: "Urmărește-ne",
      more: "+{count} altele",
      emptyMonth: "Nicio alergare luna aceasta",
      emptyWeek: "Nicio alergare săptămâna aceasta",
    },
  };
  const fonts = { body: "sans-serif", display: "sans-serif", script: "cursive", poster: "Poppins" };

  it("draws every theme in every layout, on the page the theme's palette names", () => {
    // The layouts draw the mountains and the glyphs as paths, which Node does not have.
    vi.stubGlobal("Path2D", class {});
    try {
      for (const theme of CALENDAR_IMAGE_THEME_CHOICES) {
        for (const layout of CALENDAR_IMAGE_LAYOUT_CHOICES) {
          const { ctx, stops, texts } = stubContext();
          drawCalendarImage(ctx, data, { theme, ratio: "portrait", layout, week: null, legend: true, details: ALL_DETAILS }, fonts);
          expect(stops.slice(0, 2), `${theme} in ${layout}`).toEqual([...CALENDAR_IMAGE_THEMES[paletteFor(theme, 6)].background]);
          expect(texts, `${theme} in ${layout}`).toContain("IUNIE");
        }
      }
    } finally {
      vi.unstubAllGlobals();
    }
  });
});

describe("the frame every picture shares (the owner's audit: D01, D20, D24, D25, D43, D18)", () => {
  const fonts = { body: "sans-serif", display: "sans-serif", script: "cursive", poster: "Poppins" };
  const words: CalendarImageData["words"] = {
    heading: "Evenimente",
    monthTitle: "iunie 2026",
    monthName: "iunie",
    weekdays: ["lun.", "mar.", "mie.", "joi", "vin.", "sâm.", "dum."],
    weekdaysLong: ["luni", "marți", "miercuri", "joi", "vineri", "sâmbătă", "duminică"],
    at: "ora {time}",
    hashtags: "#NoOneLeftBehind #brasovrunners",
    recurringTitle: "Evenimente recurente",
    specialTitle: "Evenimente speciale",
    cancelled: "Anulat",
    tba: "ora se anunță",
    follow: "Urmărește-ne",
    more: "+{count} altele",
    emptyMonth: "Nicio alergare luna aceasta",
    emptyWeek: "Nicio alergare săptămâna aceasta",
  };
  const entry: CalendarImageEntry = { day: 1, time: "19:30", title: "Happy Monday", tone: "weekly", type: "GROUP_RUN", surface: "ASPHALT", special: false, cancelled: false, ...NO_DETAILS };
  const june: CalendarImageData = { month: { year: 2026, month: 6 }, entries: [entry], recurring: [], specials: [], socials: ["facebook", "instagram", "strava", "youtube"], host: "example.test", clubName: "Brașov Runners", words };
  const options = (ratio: CalendarImageOptions["ratio"]): CalendarImageOptions => ({ theme: "poster", ratio, layout: "heads", week: null, legend: true, details: ALL_DETAILS });
  const logo: CalendarImageAssets = { logo: {} as CanvasImageSource };
  const palette = CALENDAR_IMAGE_THEMES.poster;
  /** The frame alone on the stub: its texts, its boxes (the band's and the foot's fills, the logo), and the body it hands back. */
  function frame(data: CalendarImageData, ratio: CalendarImageOptions["ratio"], assets = logo) {
    const { ctx, records } = stubCanvas();
    const body = drawFrame(ctx, data, options(ratio), fonts, assets, palette);
    return { body, texts: records.texts, boxes: records.boxes };
  }

  it("keeps a story's words out of Instagram's bars — below 250 and above H − 340 — while the band's and the foot's fills run to the edges", () => {
    const { body, texts, boxes } = frame(june, "story");
    const H = CALENDAR_IMAGE_RATIOS.story.height;
    for (const text of texts) {
      expect(text.top, text.text).toBeGreaterThanOrEqual(COVERED.story.top);
      expect(text.bottom, text.text).toBeLessThanOrEqual(H - COVERED.story.bottom);
    }
    const image = boxes.find((box) => box.how === "image");
    expect(image?.top).toBeGreaterThanOrEqual(COVERED.story.top);
    const fills = boxes.filter((box) => box.how === "fillRect" && box.left === 0 && box.right === CALENDAR_IMAGE_RATIOS.story.width);
    // The page, the band to the top edge, the foot to the bottom edge.
    expect(fills.some((box) => box.top === 0 && box.bottom > COVERED.story.top && box.bottom < H / 2)).toBe(true);
    expect(fills.some((box) => box.bottom === H && box.top < H - COVERED.story.bottom && box.top > H / 2)).toBe(true);
    expect(body).not.toBeNull();
    expect(body?.y).toBeGreaterThan(COVERED.story.top);
    expect((body?.y ?? 0) + (body?.h ?? 0)).toBeLessThan(H - COVERED.story.bottom);
  });

  it("draws a 4:5 post as it draws the square — the band and the foot rounded inside the 32-px margin, no fill to an edge but the page's — because the profile grid's 3:4 tile trims width, never height", () => {
    expect(COVERED.portrait).toEqual(COVERED.square);
    /** The band's box, the foot's height, and the body's distances from them: the same on both shapes. */
    const geometry = (ratio: "portrait" | "square") => {
      const { body, boxes } = frame(june, ratio);
      const { width: W, height: H } = CALENDAR_IMAGE_RATIOS[ratio];
      // The page alone runs edge to edge; the band and the foot are the two rounded fills, in that order.
      expect(boxes.filter((box) => box.how === "fillRect" && box.left === 0 && box.right === W).map((box) => [box.top, box.bottom])).toEqual([[0, H]]);
      const [band, foot] = boxes.filter((box) => box.how === "roundRect" && box.filled);
      expect([band.left, band.top, band.right]).toEqual([32, 32, W - 32]);
      expect([foot.left, foot.right]).toEqual([32, W - 32]);
      expect(foot.bottom).toBeCloseTo(H - 32);
      expect(body).not.toBeNull();
      return { band: [band.left, band.top, band.right, band.bottom], footH: foot.bottom - foot.top, bodyTop: body?.y, bodyBottomGap: H - ((body?.y ?? 0) + (body?.h ?? 0)) };
    };
    expect(geometry("portrait")).toEqual(geometry("square"));
  });

  it("writes the club's name at most once — in the logo's place until it loads, never after each network's mark — and «EVENIMENTE» no smaller than 18 px", () => {
    const names = (texts: { text: string }[]) => texts.filter((text) => /RUNNERS/.test(text.text)).length;
    expect(names(frame(june, "portrait").texts)).toBe(0);
    expect(names(frame(june, "portrait", { logo: null }).texts)).toBeLessThanOrEqual(1);
    for (const ratio of ["portrait", "square", "story", "landscape"] as const) {
      const { texts } = frame(june, ratio);
      const kicker = texts.find((text) => text.text === "EVENIMENTE");
      expect(kicker?.size, ratio).toBeGreaterThanOrEqual(18);
      expect(texts.map((text) => text.text)).toContain("IUNIE");
      expect(texts.map((text) => text.text)).toContain("URMĂREȘTE-NE!");
    }
  });

  it("is the same frame for every layout and the week: the band's words stand where they stand, whatever draws the body", () => {
    vi.stubGlobal("Path2D", class {});
    try {
      for (const ratio of ["portrait", "story"] as const) {
        const kickers = [
          ...CALENDAR_IMAGE_LAYOUT_CHOICES.map((layout) => ({ ...options(ratio), layout })),
          { ...options(ratio), week: 0 },
        ].map((picture) => {
          const { ctx, records } = stubCanvas();
          drawCalendarImage(ctx, june, picture, fonts, logo);
          const kicker = records.texts.find((text) => text.text === "EVENIMENTE");
          const call = records.texts.find((text) => text.text === "URMĂREȘTE-NE!");
          return [kicker?.left, kicker?.top, call?.left, call?.top];
        });
        expect(new Set(kickers.map((at) => at.join(","))).size, ratio).toBe(1);
      }
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("says in words that an empty month, or an empty week, has no run, and hands the layout no body to draw in", () => {
    const empty = { ...june, entries: [] };
    const { body, texts } = frame(empty, "portrait");
    expect(body).toBeNull();
    expect(texts.map((text) => text.text)).toContain("Nicio alergare luna aceasta");
    vi.stubGlobal("Path2D", class {});
    try {
      // The week of 29–30 June has no date: the week's line, under the week's own range.
      const { ctx, records } = stubCanvas();
      drawCalendarImage(ctx, june, { ...options("square"), week: 4 }, fonts, logo);
      expect(records.texts.map((text) => text.text)).toContain("Nicio alergare săptămâna aceasta");
      expect(records.texts.map((text) => text.text)).toContain("29–30 IUNIE");
      // The first week has the date: the body is drawn, the line is not.
      const first = stubCanvas();
      drawCalendarImage(first.ctx, june, { ...options("square"), week: 0 }, fonts, logo);
      expect(first.records.texts.map((text) => text.text)).not.toContain("Nicio alergare săptămâna aceasta");
      expect(first.records.texts.map((text) => text.text)).toContain("HAPPY MONDAY");
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("offers «Monocrom» and «Cald» after the season, each its own palette", () => {
    expect(CALENDAR_IMAGE_THEME_CHOICES.slice(-2)).toEqual(["mono", "warm"]);
    expect(paletteFor("mono", 6)).toBe("mono");
    expect(paletteFor("warm", 1)).toBe("warm");
    expect(CALENDAR_IMAGE_THEMES.mono.background).toEqual(["#ffffff", "#ffffff"]);
    expect(CALENDAR_IMAGE_THEMES.warm.band).not.toBe(CALENDAR_IMAGE_THEMES.poster.band);
  });
});

describe("«Afiș»: an event's glyphs, as the app's chips show them (§858)", () => {
  it("draws the type's glyph, then the ground's when it has one", () => {
    expect(eventGlyphs("GROUP_RUN", null)).toEqual([TYPE_PATHS.GROUP_RUN]);
    expect(eventGlyphs("GROUP_RUN", "TRAIL")).toEqual([TYPE_PATHS.GROUP_RUN, SURFACE_PATHS.TRAIL]);
    expect(eventGlyphs("RACE", "ASPHALT", SPECIAL_PATH)).toEqual([SPECIAL_PATH, SURFACE_PATHS.ASPHALT]);
  });

  it("measures glyphs side by side, a fifth of one apart", () => {
    expect(glyphsWidth(0, 10)).toBe(0);
    expect(glyphsWidth(1, 10)).toBeCloseTo(10);
    expect(glyphsWidth(2, 10)).toBeCloseTo(22);
  });
});

describe("«Legenda în celule»: the weeks' heights (the audit's D16, D19)", () => {
  it("keeps the weeks level while none asks more than its share", () => {
    expect(weekHeights([100, 120, 90], 600)).toEqual([200, 200, 200]);
  });

  it("gives a week what its titles ask, the quiet weeks sharing the rest alike", () => {
    expect(weekHeights([100, 300, 90, 0], 800)).toEqual([166.66666666666666, 300, 166.66666666666666, 166.66666666666666]);
    // Two that ask more than the share of what is left both stand on their own.
    expect(weekHeights([350, 300, 0, 0], 800)).toEqual([350, 300, 75, 75]);
  });

  it("keeps the key's week when the asks overflow, each other week its least and the same share of what it asks beyond", () => {
    const heights = weekHeights([400, 300, 300, 300], 800, [true, false, false, false], [0, 100, 150, 100]);
    // 400 left over the key's week, 350 of it the least, 50 shared over the 550 asked beyond: a tenth and a bit each.
    [400, 100 + 200 / 11, 150 + 150 / 11, 100 + 200 / 11].forEach((height, index) => expect(heights[index]).toBeCloseTo(height));
    // When not even the least fits, all are cut alike rather than the grid spilling out of the body.
    expect(weekHeights([400, 300, 300], 500, [true, false, false], [0, 100, 150])).toEqual([400, 40, 60]);
  });

  it("gives the weeks whose days need room the most of it, not one level for all (the review of 2026-10-28: fortnight, 9:16)", () => {
    const asks = [121, 215, 121, 297, 127];
    const least = [49, 60, 73, 140, 69];
    const heights = weekHeights(asks, 740, [], least);
    expect(heights.reduce((total, height) => total + height, 0)).toBeCloseTo(740);
    heights.forEach((height, index) => {
      expect(height).toBeGreaterThanOrEqual(least[index]);
      expect(height).toBeLessThanOrEqual(asks[index]);
    });
    // The 26th's week, which asks the most, gets the most; the quiet weeks no more than they ask.
    expect(Math.max(...heights)).toBe(heights[3]);
    expect(heights[3]).toBeGreaterThan(240);
    expect(heights[1]).toBeGreaterThan(160);
  });
});

describe("«Legenda în celule»: the sample months (the audit's D05, D11, D40)", () => {
  const samples = new URL("../../../scripts/calendar-image-preview/", import.meta.url);
  const month = (name: string) => JSON.parse(readFileSync(new URL(`${name}.json`, samples), "utf8")) as CalendarImageData;
  const fonts = { body: "sans-serif", display: "sans-serif", script: "cursive", poster: "Poppins" };
  const ratios = Object.keys(CALENDAR_IMAGE_RATIOS) as CalendarImageOptions["ratio"][];
  /** Every word the picture draws, in the order drawn: a title's lines follow each other, so a whole title reads as one run. */
  function drawn(data: CalendarImageData, ratio: CalendarImageOptions["ratio"], theme: CalendarImageOptions["theme"] = "poster") {
    const { ctx, records } = stubCanvas();
    drawCalendarImage(ctx, data, { theme, ratio, layout: "cells", week: null, legend: true, details: ALL_DETAILS }, fonts, { logo: null });
    return records.texts.map((text) => text.text);
  }
  const named = (texts: string[], title: string) => texts.join(" ").replace(/\u00a0/g, " ").includes(title.toLocaleUpperCase("ro-RO"));
  /**
   * What the picture says where: the texts drawn in each day's cell, in the order drawn — the sparkle by a day's
   * number (§168), a shape, as «✦» — the key's rows of special dates \u2014 each its day's badge, its name's lines
   * and its notes — and how many its «+N altele» counts. Told apart by where they stand (the grid's lines give
   * the weeks and the columns; a text in an empty day or under the grid is the key's) and by the order drawn,
   * so a title the key alone names whole is not taken for one its day names.
   */
  function places(data: CalendarImageData, ratio: CalendarImageOptions["ratio"], theme: CalendarImageOptions["theme"] = "poster") {
    const options: CalendarImageOptions = { theme, ratio, layout: "cells", week: null, legend: true, details: ALL_DETAILS };
    const { ctx, records } = stubCanvas();
    // A glyph is drawn translated to its top-left: the sparkle's is recorded there.
    const sparkles: { x: number; y: number }[] = [];
    let at = { x: 0, y: 0 };
    const translate = records.translate.bind(records);
    const fill = records.fill.bind(records);
    records.translate = (x: number, y: number) => {
      at = { x, y };
      translate(x, y);
    };
    records.fill = (path?: unknown) => {
      if ((path as { d?: string } | undefined)?.d === SPECIAL_PATH) sparkles.push(at);
      fill(path);
    };
    drawCalendarImage(ctx, data, options, fonts, { logo: null });
    const body = drawFrame(stubCanvas().ctx, data, options, fonts, { logo: null }, CALENDAR_IMAGE_THEMES[paletteFor(theme, data.month.month)]);
    if (!body) throw new Error(`${ratio}: no body`);
    const right = body.x + body.w;
    // A week's top runs across the whole grid; a column's edge runs down its week, the last one's to the grid's foot.
    const tops = records.segments
      .filter((line) => line.y1 === line.y2 && Math.abs(Math.min(line.x1, line.x2) - body.x) < 0.5 && Math.abs(Math.max(line.x1, line.x2) - right) < 0.5)
      .map((line) => line.y1)
      .sort((a, b) => a - b);
    const foot = Math.max(...records.segments.filter((line) => line.x1 === line.x2 && line.x1 > body.x && line.x1 < right).map((line) => Math.max(line.y1, line.y2)));
    const weeks = monthGrid(data.month);
    const days = new Map<number, string[]>();
    const key: string[] = [];
    const dayAt = (x: number, y: number) => (y > foot ? undefined : weeks[tops.filter((top) => top <= y).length - 1]?.[Math.floor(((x - body.x) * 7) / body.w)]);
    for (const text of records.texts) {
      const x = (text.left + text.right) / 2;
      const y = (text.top + text.bottom) / 2;
      // The weekdays' row, the band and the foot say nothing of a date.
      if (y < tops[0] || y > body.y + body.h) continue;
      const day = dayAt(x, y);
      if (day?.inMonth) days.set(day.day, [...(days.get(day.day) ?? []), text.text]);
      else key.push(text.text);
    }
    for (const { x, y } of sparkles) {
      const day = dayAt(x + 1, y + 1);
      if (day?.inMonth) days.set(day.day, [...(days.get(day.day) ?? []), "✦"]);
    }
    const rows: string[][] = [];
    const from = key.indexOf(data.words.specialTitle.toLocaleUpperCase("ro-RO"));
    const moreOf = (text: string) => new RegExp(`^${data.words.more.replace(/[.*+?^$()|[\]\\]/g, "\\$&").replace("{count}", "(\\d+)")}$`).exec(text);
    let more = 0;
    if (from >= 0) {
      for (const text of key.slice(from + 1)) {
        const counted = moreOf(text);
        if (counted) more = Number(counted[1]);
        else if (/^\d{1,2}$/.test(text) || rows.length === 0) rows.push([text]);
        else rows[rows.length - 1].push(text);
      }
    }
    return { days, rows, more, key, moreOf };
  }
  const flat = (text: string) => text.toLocaleUpperCase("ro-RO").replace(/[\s\u00a0-]/g, "");
  /** Whether `texts` say the date's title whole and its hour with it: under it (\u00abora 09:00\u00bb), or leading it (\u00ab09:00 TITLU\u00bb). */
  const sayWhole = (texts: readonly string[], entry: CalendarImageEntry, words: CalendarImageData["words"]) => {
    const all = flat(texts.join(" "));
    const title = flat(entry.title);
    const hour = entry.cancelled ? words.cancelled : entry.time ? words.at.replace("{time}", entry.time) : words.tba;
    const lead = entry.cancelled ? words.cancelled : entry.time;
    return all.includes(title + flat(hour)) || (lead !== null && all.includes(flat(lead) + title));
  };
  const entryOf = (data: CalendarImageData, special: CalendarImageData["specials"][number]) => {
    const entry = data.entries.find((each) => each.day === special.day && each.title === special.title);
    if (!entry) throw new Error(`${special.day} ${special.title} has no date`);
    return entry;
  };

  it("names every special date of a quiet month whole, cuts nothing and splits a long word rather than cut it", () => {
    for (const name of ["june", "sparse"]) {
      const data = month(name);
      for (const ratio of ratios) {
        const texts = drawn(data, ratio);
        expect(texts.filter((text) => text.includes("…")), `${name} · ${ratio}`).toEqual([]);
        for (const special of data.specials) expect(named(texts, special.title), `${name} · ${ratio}: ${special.title}`).toBe(true);
      }
    }
  });

  it("lists every special date in the key, day by day, where the grid has room for them all (june, every format)", () => {
    const data = month("june");
    for (const ratio of ratios) {
      const texts = drawn(data, ratio);
      expect(texts, ratio).toContain("EVENIMENTE SPECIALE");
      // Each special twice: in its day, and in the key with its day's badge.
      for (const special of data.specials) expect(texts.filter((text) => text === String(special.day)).length, `${ratio}: ${special.day}`).toBe(2);
    }
  });

  it("names the month's race whole in its own day, with its hour over it or leading it, on every format and theme", () => {
    // Its day's cell, not the whole picture: the key names the race too, and must not stand in for its day.
    for (const name of ["busy", "sparse"]) {
      const data = month(name);
      const race = data.specials.find((special) => special.type === "RACE");
      if (!race) throw new Error(`${name}.json has no race`);
      for (const theme of CALENDAR_IMAGE_THEME_CHOICES) {
        for (const ratio of ratios) expect(sayWhole(places(data, ratio, theme).days.get(race.day) ?? [], entryOf(data, race), data.words), `${name} · ${theme} · ${ratio}`).toBe(true);
      }
    }
  });

  const names = readdirSync(samples).filter((file) => file.endsWith(".json")).map((file) => file.replace(/\.json$/, ""));
  /** Whether a special is named whole with its hour in its own day's cell, or in its own day's row of the key. */
  const namedWhole = (place: ReturnType<typeof places>, data: CalendarImageData, special: CalendarImageData["specials"][number]) => {
    const entry = entryOf(data, special);
    return sayWhole(place.days.get(special.day) ?? [], entry, data.words) || place.rows.some((row) => row[0] === String(special.day) && sayWhole(row, entry, data.words));
  };

  it("names every special date whole with its hour somewhere — in its day or in its own day's row of the key — on every month, format and theme (the review of 2026-10-28)", () => {
    // A title its day cuts, or draws without its hour, is owed to the key: never left out of both — but in a
    // month too full even for that (busy: six weeks, five specials, three series), the key counts the fewest in
    // its «+N altele», and never the race, which it names whenever it names any.
    for (const file of names) {
      const data = month(file);
      // The empty month has no grid and nothing to name.
      if (data.specials.length === 0) continue;
      const name = data.words.monthTitle;
      const race = data.specials.find((special) => special.type === "RACE");
      for (const theme of CALENDAR_IMAGE_THEME_CHOICES) {
        for (const ratio of ratios) {
          const place = places(data, ratio, theme);
          const nowhere = data.specials.filter((special) => !namedWhole(place, data, special)).map((special) => `${special.day} ${special.title}`);
          if (file !== "busy") expect(nowhere, `${name} · ${theme} · ${ratio}`).toEqual([]);
          expect(nowhere.length, `${name} · ${theme} · ${ratio}: ${nowhere.join(", ")} named nowhere whole, the key's «+N» counts ${place.more}`).toBeLessThanOrEqual(place.more);
          if (race && place.rows.length > 0) {
            expect(
              place.rows.some((row) => row[0] === String(race.day) && sayWhole(row, entryOf(data, race), data.words)),
              `${name} · ${theme} · ${ratio}: the race in the key`,
            ).toBe(true);
          }
        }
      }
    }
  });

  it("tells in every day that a special date is in it — its title begun, «+N altele», or the sparkle by its number — on every month, format and theme (the review of 2026-10-28)", () => {
    for (const data of names.map(month).filter((each) => each.specials.length > 0)) {
      const name = data.words.monthTitle;
      for (const theme of CALENDAR_IMAGE_THEME_CHOICES) {
        for (const ratio of ratios) {
          const place = places(data, ratio, theme);
          for (const special of data.specials) {
            const entry = entryOf(data, special);
            const texts = place.days.get(special.day) ?? [];
            const lead = entry.cancelled ? data.words.cancelled : entry.time;
            // A title's first line, cut or not, begins it — after its hour, where the hour leads it.
            const begun = texts.some((text) => {
              const bare = flat((lead && text.startsWith(`${lead} `) ? text.slice(lead.length + 1) : text).replace(/…$/, ""));
              return /\p{Lu}{2}/u.test(bare) && flat(entry.title).startsWith(bare);
            });
            const said = begun || texts.some((text) => place.moreOf(text) !== null) || texts.includes("✦");
            expect(said, `${name} · ${theme} · ${ratio}: ${special.day} ${special.title} — ${texts.join(" | ")}`).toBe(true);
          }
        }
      }
    }
  });

  it("names every weekly series in the key on every picture of a month that has one: the key is the one place a series is named (the review of 2026-10-28)", () => {
    for (const data of names.map(month).filter((each) => each.recurring.length > 0)) {
      const name = data.words.monthTitle;
      for (const theme of CALENDAR_IMAGE_THEME_CHOICES) {
        const chips = Math.min(LEGEND_MAX, CALENDAR_IMAGE_THEMES[paletteFor(theme, data.month.month)].series.length);
        for (const ratio of ratios) {
          const { key } = places(data, ratio, theme);
          expect(key, `${name} · ${theme} · ${ratio}`).toContain(data.words.recurringTitle.toLocaleUpperCase("ro-RO"));
          const said = flat(key.join(" "));
          for (const series of data.recurring.slice(0, chips)) expect(said.includes(flat(series.title)), `${name} · ${theme} · ${ratio}: ${series.title}`).toBe(true);
        }
      }
    }
  });

  it("writes «ora se anunță» where an hour is not set, and every series' rhythm in the key", () => {
    const data = month("busy");
    for (const ratio of ["portrait", "story"] as const) {
      const texts = drawn(data, ratio);
      expect(texts.some((text) => text.startsWith(data.words.tba)), ratio).toBe(true);
      for (const series of data.recurring) expect(named(texts, series.title) || texts.join(" ").includes(series.sentence), `${ratio}: ${series.title}`).toBe(true);
    }
  });
});
