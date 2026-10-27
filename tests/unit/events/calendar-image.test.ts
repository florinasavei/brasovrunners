import { createTranslator } from "next-intl";
import { describe, expect, it, vi } from "vitest";
import ro from "../../../messages/ro.json";
import type { PublicEvent } from "@/modules/events/repository";
import type { CalendarImageData, CalendarImageEntry } from "@/modules/events/domain/calendar-image";
import { type CalendarImageFormat, calendarImageRows } from "@/modules/events/domain/calendar-image-rows";
import { distanceWords } from "@/modules/events/domain/distance";
import { elevationWords } from "@/modules/events/domain/elevation";
import { detailWords, eventGlyphs, fitText, glyphsWidth, wrapBalanced, wrapText } from "@/modules/events/ui/calendar-image-canvas";
import { SPECIAL_PATH, SURFACE_PATHS, TYPE_PATHS } from "@/modules/events/ui/calendar-image-glyphs";
import { CALENDAR_IMAGE_LAYOUT_CHOICES, CALENDAR_IMAGE_THEME_CHOICES, drawCalendarImage, paletteFor } from "@/modules/events/ui/calendar-image-draw";
import { CALENDAR_IMAGE_THEMES } from "@/theme/brand";
import { breakLines } from "@/modules/events/ui/calendar-image-poster-cells";
import { wrapWords } from "@/modules/events/ui/calendar-image-poster-formats";
import { posterPlan, weekdayColumn, wrapWhole } from "@/modules/events/ui/calendar-image-poster-heads";
import { initialWeek, weekLabel, weekOf, weeksOf, weekSlug } from "@/modules/events/ui/calendar-image-week";

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

  it("on «Afiș», breaks a title on as many lines as it takes, and says when one word alone is wider than the line", () => {
    expect(wrapWords(ctx, "Happy Monday with Brașov Runners", 130)).toEqual({ lines: ["Happy Monday", "with Brașov", "Runners"], fits: true });
    expect(wrapWords(ctx, "Course reconnaissance", 100)).toEqual({ lines: ["Course", "reconnaissance"], fits: false });
    expect(wrapWords(ctx, "  ", 100)).toEqual({ lines: [], fits: true });
  });
});

describe("a title on «Afiș», whole", () => {
  it("breaks at spaces without cutting, a lone dash staying with the word before it", () => {
    expect(breakLines(ctx, "Crosul Brașov Runners — ediția a III-a", 100)).toEqual(["Crosul", "Brașov", "Runners —", "ediția a", "III-a"]);
  });

  it("leaves a word wider than the line alone on its own, for the caller to see it does not fit", () => {
    expect(breakLines(ctx, "a reconnaissance b", 60)).toEqual(["a", "reconnaissance", "b"]);
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
    // Greedy, the ordinal stands alone; balanced, the line before gives it «EDIȚIA A».
    expect(breakLines(ctx, title, 330).at(-1)).toBe("III-A");
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
    expect(plan.lanes.map((lane) => [lane.title, lane.column, lane.time, lane.variant])).toEqual([
      ["Happy Monday", 0, "19:30", 0],
      ["Hill run", 2, "19:00", 0],
    ]);
    expect([...plan.marks.keys()]).toEqual([1, 3, 8, 10, 15, 17]);
    expect([...plan.dates.values()].flat().map((date) => date.title)).toEqual(["Girls only"]);
  });

  it("stacks two series of one weekday, the earlier first, and gives a series on two weekdays a look of its own", () => {
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
    expect(plan.lanes.map((lane) => [lane.title, lane.column, lane.variant])).toEqual([
      ["Track", 1, 1],
      ["Tempo", 1, 0],
      ["Intervals", null, 2],
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
