import type { CalendarImagePalette } from "@/theme/brand";
import { FAR, MOUNTAIN_MARK_VIEWBOX, NEAR } from "@/shared/ui/MountainMark";
import { type Box, CALENDAR_IMAGE_RATIOS, type Ctx, detailWords, drawGlyphs, eventGlyphs, fitText, glyphsWidth, roundRect, wrapBalanced } from "./calendar-image-canvas";
import { drawFrame } from "./calendar-image-frame";
import type { CalendarImageAssets, CalendarImageFonts, CalendarImageOptions } from "./calendar-image-draw";
import { monthGrid, type YearMonth } from "../domain/calendar";
import type { CalendarTone } from "../domain/calendar-kind";
import type { EventSurface, EventType } from "../domain/event-type";
import type { CalendarImageData, CalendarImageDetails, CalendarImageEntry } from "../domain/calendar-image";

/**
 * «Afiș», «Așezare» → «Seriile în cap» (`heads`, the default): each weekly series written once, in its
 * weekday's head; its dates are only their marks, and the special dates are written in their days and
 * listed in the empty ones.
 */

/**
 * `text` broken at spaces into as many lines of `width` as it takes, a dash kept with the word before it.
 * A word wider than a line alone makes it null — or, with `hyphenate`, is split with «-» where it must be,
 * so the words stay whole rather than cut. The week's agenda (`calendar-image-week.ts`) wraps with it.
 */
export function wrapWhole(ctx: Ctx, text: string, width: number, hyphenate = false): string[] | null {
  const words = text
    .replace(/\s+([—–-])\s+/g, " $1 ")
    .split(/[ \t\n\r]+/)
    .filter(Boolean);
  const lines: string[] = [];
  let current = "";
  for (let word of words) {
    if (ctx.measureText(word).width > width) {
      if (!hyphenate) return null;
      if (current) lines.push(current);
      current = "";
      let letters = [...word];
      while (letters.length > 1 && ctx.measureText(letters.join("")).width > width) {
        let take = letters.length - 1;
        while (take > 1 && ctx.measureText(`${letters.slice(0, take).join("")}-`).width > width) take -= 1;
        // Three letters at least on the next line, where the word allows it.
        if (letters.length - take < 3 && take > 3) take = Math.max(3, letters.length - 3);
        lines.push(`${letters.slice(0, take).join("")}-`);
        letters = letters.slice(take);
      }
      word = letters.join("");
    }
    const candidate = current ? `${current} ${word}` : word;
    if (ctx.measureText(candidate).width <= width) current = candidate;
    else {
      lines.push(current);
      current = word;
    }
  }
  if (current) lines.push(current);
  return lines;
}

/** The most weekdays a series may fall on and still be written in each of their heads (the audit, D09); on more, the legend says its rhythm. */
const HEAD_DAYS_MAX = 3;
/** The most columns a head's strip may take — its own and the free heads beside it (D03). */
const SPAN_MAX = 3;
/** Between a date's hour and its details, and between the details. */
const SEP = " · ";

/** A series as «Afiș» draws it (§855): written once in each of its weekdays' heads, each date a mark. */
export type PosterLane = {
  title: string;
  type: EventType;
  surface: EventSurface | null;
  tone: CalendarTone;
  /** «O dată la două săptămâni, duminica, la 08:00»: what its strip says when it does not keep every one of its weekdays, and the legend's line. */
  sentence: string;
  /** The weekdays its ordinary dates fall on, Monday 0, in order. */
  columns: number[];
  /** On at most `HEAD_DAYS_MAX` weekdays: a strip in each of their heads; on more, a line in the legend. */
  inHeads: boolean;
  /**
   * Every one of its weekdays in the month has a date of it, so «ora 19:30» says the rest. False for a
   * fortnightly series, or one that starts or stops inside the month: its strip then writes `sentence` (D10).
   */
  weekly: boolean;
  /** The hour most of its dates keep, «19:30»; null when none has one. */
  time: string | null;
  /** Filled, outlined or deep: how its strip and its marks are drawn, so two series on one weekday read apart. */
  variant: number;
  /** The words after its hour — the place, the distance, the climb — as its first date has them (`data.recurring`). */
  details: CalendarImageDetails;
};

export type PosterPlan = {
  lanes: PosterLane[];
  /** A series' ordinary dates, by day: a mark in the cell, the words in the head. */
  marks: Map<number, { lane: PosterLane; entry: CalendarImageEntry }[]>;
  /** The rest, by day — a date that stands alone, a series' special edition: written in full. */
  dates: Map<number, CalendarImageEntry[]>;
};

/** The weekday's column a day of the month falls in, Monday 0. */
export function weekdayColumn({ year, month }: YearMonth, day: number): number {
  return (new Date(Date.UTC(year, month - 1, day)).getUTCDay() + 6) % 7;
}

/** A series is its type and its title, whatever the case and the spacing (`seriesKey`, which the browser does not load). */
const laneKey = (type: string, title: string) => `${type}\n${title.trim().toLowerCase().replace(/\s+/g, " ")}`;

/** The hour most of the dates keep, those held before those cancelled. */
function commonHour(entries: CalendarImageEntry[]): string | null {
  const held = entries.filter((entry) => !entry.cancelled);
  const counts = new Map<string, number>();
  for (const entry of held.length > 0 ? held : entries) if (entry.time) counts.set(entry.time, (counts.get(entry.time) ?? 0) + 1);
  let best: string | null = null;
  for (const [time, count] of counts) if (best === null || count > (counts.get(best) ?? 0)) best = time;
  return best;
}

/** The earlier hour first; a series with none last. */
const earlierFirst = (a: PosterLane, b: PosterLane) => (a.time ?? "99").localeCompare(b.time ?? "99");

/**
 * «Afiș»'s month (§855; the owner, 2026-10-27: «I need to organize it better and use the space more
 * efficiently»): the rhythm belongs to the weekday. A series whose dates fall on one, two or three weekdays
 * is written in each of their heads; each of its dates is a mark with the hour. A series on more keeps its
 * marks and gets a legend line. Everything else is written in full in its day.
 */
export function posterPlan(data: CalendarImageData): PosterPlan {
  const lanes: PosterLane[] = [];
  const byKey = new Map<string, PosterLane>();
  const length = new Date(Date.UTC(data.month.year, data.month.month, 0)).getUTCDate();
  const days = Array.from({ length }, (_, index) => index + 1);
  for (const row of data.recurring) {
    const key = laneKey(row.type, row.title);
    const all = data.entries.filter((entry) => laneKey(entry.type, entry.title) === key);
    const ordinary = all.filter((entry) => !entry.special);
    if (ordinary.length === 0 || byKey.has(key)) continue;
    const columns = [...new Set(ordinary.map((entry) => weekdayColumn(data.month, entry.day)))].sort((a, b) => a - b);
    // Weekly in this month when each of its weekdays has a date of it — a special edition is the series kept.
    const kept = new Set(all.map((entry) => entry.day));
    const weekly = columns.every((column) => days.every((day) => weekdayColumn(data.month, day) !== column || kept.has(day)));
    const details = { place: row.place ?? null, placeName: row.placeName ?? null, distance: row.distance ?? null, elevation: row.elevation ?? null };
    const lane: PosterLane = { title: row.title, type: row.type, surface: row.surface, tone: row.tone, sentence: row.sentence, columns, inHeads: columns.length <= HEAD_DAYS_MAX, weekly, time: commonHour(ordinary), variant: 0, details };
    lanes.push(lane);
    byKey.set(key, lane);
  }
  // The looks, the earlier hour first: each series the first look no earlier series on one of its weekdays wears.
  const byHour = [...lanes].sort(earlierFirst);
  byHour.forEach((lane, index) => {
    const worn = new Set(
      byHour
        .slice(0, index)
        .filter((other) => other.columns.some((column) => lane.columns.includes(column)))
        .map((other) => other.variant),
    );
    lane.variant = [0, 1, 2].find((variant) => !worn.has(variant)) ?? index % 3;
  });
  const marks: PosterPlan["marks"] = new Map();
  const dates: PosterPlan["dates"] = new Map();
  for (const entry of data.entries) {
    const lane = entry.special ? undefined : byKey.get(laneKey(entry.type, entry.title));
    if (lane) marks.set(entry.day, [...(marks.get(entry.day) ?? []), { lane, entry }]);
    else dates.set(entry.day, [...(dates.get(entry.day) ?? []), entry]);
  }
  return { lanes, marks, dates };
}

const clamp = (value: number, low: number, high: number) => Math.max(low, Math.min(high, value));

/** Sizes from `high` down to `low` a pixel apart, `low` last: the first that works is the largest. */
function sizesDown(high: number, low: number): number[] {
  const sizes: number[] = [];
  for (let size = Math.floor(high); size > low; size -= 1) sizes.push(size);
  sizes.push(low);
  return sizes;
}

type Tint = "special" | "other";
/** A series' date as a mark: its series, and whether it is cancelled and at what hour. */
type Mark = { lane: PosterLane; entry: Pick<CalendarImageEntry, "cancelled" | "time"> };
/**
 * A mark placed: a pill with its glyphs and its hour — or, `above` set, in a day of its own, the series'
 * glyphs large over a pill with the hour alone; `raised`, the glyphs on the number's line, clear of it.
 */
type Pill = Mark & { x: number; y: number; w: number; h: number; size: number; glyphs: string[]; glyph: number; above: number; raised?: boolean };
/** A date written in full: its title's lines — `whole`, or shortened with «…» — then its hour and its details. */
type Block = { entry: CalendarImageEntry; lines: string[]; notes: string[]; whole: boolean };
/**
 * A day's dates: written in full (`blocks`, the glyphs over a lone one when the month gives them room), or —
 * where the day has no room for a title over its hour — `chips`, the glyph and the hour, each on a line with
 * as much of its title as the width holds when `inline`; `more` the dates no chip shows.
 */
type Items = { box: Box; size: number; blocks: Block[]; glyph: number; chips: CalendarImageEntry[]; chipSize: number; inline: boolean; more: number };
/** A day planned: its marks placed — `hidden` the marks no pill shows, «+1 altele» under the one that does — and its dates' words; `loss` what their forms give up (`marksAlone`). */
type CellPlan = { day: number; box: Box; tint: Tint | null; pills: Pill[]; hidden: { count: number; x: number; y: number } | null; dates: CalendarImageEntry[]; items: Items; loss: number };
/**
 * A series' strip: its title's lines, its notes — `glyphs` before the first (the type's alone when both do not
 * leave the hour its line), or on a line of their own `above` it when not even the type's does.
 */
type StripPlan = { lane: PosterLane; lines: string[]; notes: string[]; size: number; note: number; glyphs: string[]; glyph: number; above: boolean; h: number; cut: boolean };
/** A weekday's head that holds series: its strips, on the columns from `from` to `to` — its own and the free ones it widened over. */
type Group = { home: number; from: number; to: number; strips: StripPlan[]; h: number };
type Region = { row: number; from: number; to: number; box: Box };
type LegendItem = { kind: "title"; text: string; fill: string } | { kind: "lane"; lane: PosterLane } | { kind: "date"; entry: CalendarImageEntry };
type Placed = { item: LegendItem; x: number; y: number; w: number; h: number; lines: string[]; notes: string[] };
type Legend = { placed: Placed[]; size: number };

/**
 * «Afiș» (§855; the owner, 2026-10-27: «vreau să semene cu ce mi-a dat Amalia», then «I need to organize it
 * better and use the space more efficiently») — the club's hand-made monthly poster, its parts rearranged
 * so the month gets the room: the weekdays in capitals as the column heads, and under a head each series of
 * that weekday — or of two or three weekdays, under each — on its own coloured strip: its glyphs, its whole
 * title, its hour and its details, and its rhythm when it is not every week. A strip widens over the free
 * heads beside its own when its title needs the room, and only a head that holds one is taller than its
 * label: the days under the others start right under the weekdays (the owner's audit, D02/D03). In the days
 * a series' date is only its mark — the glyph and the hour, or «Anulat» — and the dates that are not routine
 * are written in full, in capitals, with «ora 18:00» and their details, a special one's day pale pink and a
 * social one's pale yellow, at one size for every date alone in its day; a week's height follows what its
 * days hold, each week given the pixels where they save the most — a race's title made whole before a
 * routine week's glyphs grow. The special dates are listed, every one in day order, where that costs the
 * month least: the empty days at the month's end or start, the month's last week grown for them, beside the
 * grid on a wide picture or in a strip under it — the whole list wherever a place holds it, else the race
 * and the dates not whole in their days, never a list without the race; the mountains across empty days
 * nothing else needs. Every size follows the picture's or the day's, with a floor a phone's feed still reads
 * and a least no week falls under, so the four formats, five- and six-week months, and a month of two dates
 * or of three a day are one drawing.
 */
export function drawPosterHeads(ctx: CanvasRenderingContext2D, data: CalendarImageData, options: CalendarImageOptions, fonts: CalendarImageFonts, assets: CalendarImageAssets, palette: CalendarImagePalette): void {
  const { width: W, height: H } = CALENDAR_IMAGE_RATIOS[options.ratio];
  const unit = Math.min(W, H) / 1080;
  // The floors (the owner's audit, D17/D31): a feed shows the picture about 400 px wide, so 14 px at 1080 is
  // 5 px there. A title or a key line no smaller than 17, an hour or a detail line 16, a day's number 18, a
  // glyph 18 — and on 16:9, which a feed shrinks the more, nothing but the month under 21. The other sizes
  // there are a quarter larger too.
  const boost = W > H ? 1.25 : 1;
  const floor = W > H ? { title: 21, note: 21, number: 22, glyph: 22 } : { title: 17, note: 16, number: 18, glyph: 18 };
  const gap = 14 * unit;
  const px = (size: number) => Math.round(size * unit);
  // One geometric family throughout (the owner, 2026-10-27, of the hand-written «Evenimente» over Roboto:
  // «the font is pretty ugly»): ExtraBold for the labels and the day numbers, Bold for the titles and the
  // marks, Medium for the hours, the details and the rhythms.
  const face = (size: number, weight: number) => `${weight} ${px(size)}px ${fonts.poster}`;
  const upper = (text: string) => text.toLocaleUpperCase("ro-RO");
  const fits = (text: string, room: number) => ctx.measureText(text).width <= room + 0.5;
  const plan = posterPlan(data);
  const at = (time: string) => data.words.at.replace("{time}", time);
  /** Where a date's hour goes: «ora 18:00», «Anulat», or «ora se anunță» while it is not set. */
  const hourOf = (entry: Pick<CalendarImageEntry, "cancelled" | "time">) => (entry.cancelled ? data.words.cancelled : entry.time ? at(entry.time) : data.words.tba);
  const detailsOf = (details: CalendarImageDetails) => detailWords(details, options.details);
  const lineOf = (size: number) => size * 1.13 * unit;
  const noteSizeOf = (size: number) => Math.max(floor.note, size * 0.8);
  const noteLineOf = (size: number) => size * 1.32 * unit;
  /** A special date's day pale pink, a social one's pale yellow, as the poster marks them; a lone run stays white. */
  const tintOf = (entry: CalendarImageEntry): Tint | null => (entry.tone === "other" ? "other" : entry.tone === "special" || entry.special ? "special" : null);
  /** A day's tint: the special date's pink before the social one's yellow, whatever their hours (D39). */
  const dayTint = (dates: CalendarImageEntry[]): Tint | null => (dates.some((entry) => tintOf(entry) === "special") ? "special" : dates.some((entry) => tintOf(entry) === "other") ? "other" : null);
  const inkOf = (entry: CalendarImageEntry) => {
    const tint = tintOf(entry);
    return tint ? palette[tint][1] : palette.title;
  };
  // The page, the band and the foot are the frame's (`calendar-image-frame.ts`); what is left is the body's.
  const area = drawFrame(ctx, data, options, fonts, assets, palette);
  if (!area) return;

  /**
   * What a measure gave, kept by what it measured (a date, a series, a day) and how: each place the legend
   * may go lays the month out again, at the same widths and mostly the same heights, and the dialog draws on
   * every change of an option — a phone pays for every wrap measured twice.
   */
  const kept = new WeakMap<object, Map<string, unknown>>();
  function remember<T>(owner: object, key: string, make: () => T): T {
    let known = kept.get(owner);
    if (!known) kept.set(owner, (known = new Map()));
    if (known.has(key)) return known.get(key) as T;
    const value = make();
    known.set(key, value);
    return value;
  }
  /** A length as a key, a quarter-pixel close. */
  const q = (value: number) => Math.round(value * 4);
  /**
   * The longest start of `text` that fits `room` with «…» after it — a title shortened on purpose, the legend
   * saying it whole: cut after its last whole word that fits, «NIGHT RUN…», never «NIGHT RUN O…» — and not
   * after a word of one or two letters when a shorter start fits, «NIGHT RUN…» before «NIGHT RUN ON…»; as many
   * of its letters only when not even its first word does.
   */
  const ellipsize = (text: string, room: number) => {
    const bare = text.replace(/-$/, "");
    // No dash, no dot, no comma and no space before the «…»: «MARATHON…», never «MARATHON —…».
    const trim = (start: string) => start.replace(/[\s—–·,-]+$/, "");
    // A line ending in «-» ends in the start of a word split over two lines: not a whole word.
    const ends = [...bare.matchAll(/\s+/g)].map((space) => bare.slice(0, space.index)).reverse();
    const starts = bare === text ? [bare, ...ends] : ends;
    const words = starts.map(trim).filter((start) => start !== "");
    // Longest first: every start after the first that fits is shorter, and fits too.
    const first = words.findIndex((start) => fits(`${start}…`, room));
    if (first >= 0) return `${words.slice(first).find((start) => !/(^|\s)\p{L}{1,2}$/u.test(start)) ?? words[first]}…`;
    const chars = [...bare];
    while (chars.length > 0 && !fits(`${trim(chars.join(""))}…`, room)) chars.pop();
    return `${trim(chars.join(""))}…`;
  };
  /** The letters a shortened title still shows: «BRAȘOV…» six. */
  const lettersOf = (text: string) => text.replace(/[…\s—–-]/g, "").length;
  /** `lines` kept to `count`, the last cut with «…» when lines were left out. */
  const cutTo = (lines: string[], count: number, room: number) => (lines.length <= count ? lines : [...lines.slice(0, count - 1), ellipsize(lines[count - 1], room)]);
  /**
   * The words under a title, at the context's font: `heads` (the hour, a rhythm) on as many lines of `room`
   * as each takes, then the details after the last, « · » between them — on its line while they fit, else on
   * at most `spare` lines more; a word that fits nowhere is dropped with every word after it, so the climb
   * goes first, then the distance, then the place. The first line may be shorter, `firstRoom`, for the glyphs
   * before it. Null when a word of `heads` is wider than its line.
   */
  function noteLines(heads: string[], details: string[], room: number, spare: number, firstRoom = room): string[] | null {
    const roomOf = (index: number) => (index === 0 ? firstRoom : room);
    const lines: string[] = [];
    for (const head of heads) {
      if (lines.length > 0) {
        lines.push(...wrapBalanced(ctx, head, room));
        continue;
      }
      // Only the first line is the shorter one: what is left of the head wraps at the whole room.
      const [first, ...more] = wrapBalanced(ctx, head, firstRoom);
      if (first === undefined) continue;
      lines.push(first);
      const words = head.replace(/\s+([—–-])\s+/g, "\u00a0$1 ").split(" ");
      if (more.length > 0) lines.push(...wrapBalanced(ctx, words.slice(first.split(" ").length).join(" "), room));
    }
    if (lines.some((line, index) => !fits(line, roomOf(index)))) return null;
    let extra = 0;
    for (const word of details) {
      const last = lines[lines.length - 1];
      if (last !== undefined && fits(`${last}${SEP}${word}`, roomOf(lines.length - 1))) lines[lines.length - 1] = `${last}${SEP}${word}`;
      else if (extra < spare && fits(word, roomOf(lines.length))) {
        lines.push(word);
        extra += 1;
      } else break;
    }
    return lines;
  }

  // ---- The marks: a series' date as its glyphs and its hour on a pill of the series' look.
  const laneLook = (lane: PosterLane) => {
    const base = lane.tone === "special" ? palette.special[1] : lane.tone === "other" ? palette.other[1] : palette.band;
    const looks = [
      { fill: base, ink: palette.bandInk, stroke: null },
      { fill: palette.cell, ink: base, stroke: base },
      { fill: palette.cellInk, ink: palette.bandInk, stroke: null },
    ];
    return looks[lane.variant % looks.length];
  };
  const cancelledLook = { fill: palette.cellMuted, ink: palette.title, stroke: null };
  const markText = (entry: Mark["entry"]) => (entry.cancelled ? upper(data.words.cancelled) : (entry.time ?? data.words.tba));
  /** A mark's pill at `size`: `count` of its glyphs, the type's first — kept on a cancelled date too, «ANULAT» after them (D39) — then the hour. */
  function pillAt(mark: Mark, size: number, count: number) {
    const glyphs = eventGlyphs(mark.lane.type, mark.lane.surface).slice(0, count);
    const glyph = Math.max(floor.glyph, size * 1.1);
    const textW = remember(mark.lane, `mark|${markText(mark.entry)}|${size}`, () => {
      ctx.font = face(size, 700);
      return ctx.measureText(markText(mark.entry)).width;
    });
    const glyphW = glyphsWidth(glyphs.length, glyph * unit);
    return { size, glyphs, glyph, w: size * 1.1 * unit + glyphW + (glyphW && textW ? size * 0.3 * unit : 0) + textW, h: size * 1.75 * unit };
  }
  function drawPill(pill: Pill) {
    const look = pill.entry.cancelled ? cancelledLook : laneLook(pill.lane);
    if (pill.above > 0) {
      const glyphs = eventGlyphs(pill.lane.type, pill.lane.surface);
      drawGlyphs(ctx, glyphs, pill.x + (pill.w - glyphsWidth(glyphs.length, pill.above)) / 2, pill.y - 6 * unit - pill.above, pill.above, pill.entry.cancelled ? palette.title : (look.stroke ?? look.fill));
    }
    roundRect(ctx, pill.x, pill.y, pill.w, pill.h, pill.h / 2);
    ctx.fillStyle = look.fill;
    ctx.fill();
    if (look.stroke) {
      ctx.strokeStyle = look.stroke;
      ctx.lineWidth = 2.5 * unit;
      ctx.stroke();
    }
    let x = pill.x + pill.size * 0.55 * unit;
    if (pill.glyphs.length > 0) {
      const glyph = pill.glyph * unit;
      x += drawGlyphs(ctx, pill.glyphs, x, pill.y + (pill.h - glyph) / 2, glyph, look.ink) + pill.size * 0.3 * unit;
    }
    ctx.font = face(pill.size, 700);
    ctx.fillStyle = look.ink;
    ctx.fillText(markText(pill.entry), x, pill.y + pill.h / 2 + pill.size * 0.36 * unit);
  }

  // ---- The days' words: each date not routine, written whole at the largest size its day holds.
  /**
   * A date written in full at `size`: its title whole, then its hour — and its details on `spare` lines more
   * (null: none). Null when a word of its title is wider than `room` — even split, with `hyphenate`.
   */
  function blockAt(entry: CalendarImageEntry, room: number, size: number, spare: number | null, hyphenate = true): Block | null {
    return remember(entry, `block|${q(room)}|${size}|${spare}|${hyphenate}`, () => {
      ctx.font = face(size, 700);
      const lines = wrapBalanced(ctx, upper(entry.title), room, { hyphenate });
      if (lines.some((line) => !fits(line, room))) return null;
      ctx.font = face(noteSizeOf(size), 500);
      const notes = noteLines([hourOf(entry)], spare === null ? [] : detailsOf(entry), room, spare ?? 0);
      return notes && { entry, lines, notes, whole: true };
    });
  }
  const blockHeight = (block: Block, size: number) => block.lines.length * lineOf(size) + block.notes.length * noteLineOf(noteSizeOf(size));
  const between = (size: number) => size * 0.7 * unit;
  const stackHeight = (blocks: Block[], size: number) => blocks.reduce((sum, block) => sum + blockHeight(block, size), 0) + Math.max(0, blocks.length - 1) * between(size);
  /**
   * The largest size up to `cap` at which every date of the day is written whole over its hour — every word
   * whole when some size allows it, a word split with «-» only when none does (D23) — and no title takes more
   * than a line over what it takes at the floor, so a tall narrow day reads «DYNAFIT SHOE / TESTING X …», not a
   * word a line (D19); null when none does.
   */
  function wholeSize(dates: CalendarImageEntry[], box: Box, cap: number): number | null {
    for (const hyphenate of [false, true]) {
      const least = dates.map((entry) => blockAt(entry, box.w, floor.title, null, hyphenate)?.lines.length ?? 0);
      for (const size of sizesDown(cap, floor.title)) {
        const blocks = dates.map((entry) => blockAt(entry, box.w, size, null, hyphenate));
        if (!blocks.every((block): block is Block => block !== null) || blocks.some((block, index) => block.lines.length > least[index] + 1)) continue;
        if (stackHeight(blocks, size) <= box.h + 0.5) return size;
      }
    }
    return null;
  }
  const isRace = (entry: CalendarImageEntry) => entry.type === "RACE";
  /** A date too long for its day as a chip: its type's glyph and its hour, or «ANULAT», or «ora se anunță». */
  const chipText = (entry: CalendarImageEntry) => (entry.cancelled ? upper(data.words.cancelled) : (entry.time ?? data.words.tba));
  const chipGlyph = (size: number) => Math.max(floor.glyph, size * 1.1) * unit;
  const chipLineOf = (size: number) => Math.max(size * 1.3 * unit, chipGlyph(size) + 3 * unit);
  const chipWidth = (entry: CalendarImageEntry, size: number) =>
    remember(entry, `chip|${size}`, () => {
      ctx.font = face(size, 700);
      return chipGlyph(size) + 4 * unit + ctx.measureText(chipText(entry)).width;
    });
  const moreText = (count: number) => data.words.more.replace("{count}", String(count));
  /** Whether «+2 altele» fits on the line of `chips`, after them. */
  const moreFits = (chips: CalendarImageEntry[], count: number, width: number, size: number) => {
    const used = chips.reduce((sum, entry) => sum + chipWidth(entry, size) + 8 * unit, 0);
    ctx.font = face(Math.max(size, floor.title), 700);
    return used + ctx.measureText(moreText(count)).width <= width + 0.5;
  };
  /** The chips side by side in lines of `width`. */
  function chipLines(dates: CalendarImageEntry[], width: number, size: number) {
    const lines: CalendarImageEntry[][] = [];
    let used = 0;
    for (const entry of dates) {
      const w = chipWidth(entry, size);
      if (lines.length === 0 || used + 8 * unit + w > width) {
        lines.push([entry]);
        used = w;
      } else {
        lines[lines.length - 1].push(entry);
        used += 8 * unit + w;
      }
    }
    return lines;
  }
  /**
   * A day's dates in `box`, in the first form it holds (the audit, D04/D17/D23): whole, at the largest size
   * up to `cap` — the glyphs over a lone date at `glyph` when it was given one, then its details as the room
   * allows; else at the floor, every title whole and the hours given up — the others' before a race's — while
   * they do not fit, a title being the date and the legend giving its hour; else the longest title losing a
   * line at a time — a race's last — over its hour, then alone; never a title cut to under ten letters, which
   * says less than its chip; else each date its chip; else as many chips as fit and «+2 altele», a race, then a
   * special date, never the one left out.
   */
  function fitDates(dates: CalendarImageEntry[], box: Box, cap: number, glyph: number): Items {
    const items: Items = { box, size: floor.title, blocks: [], glyph: 0, chips: [], chipSize: floor.title, inline: false, more: 0 };
    if (dates.length === 0) return items;
    const whole = wholeSize(dates, box, cap);
    if (whole !== null) {
      const bare = dates.map((entry) => blockAt(entry, box.w, whole, null) as Block);
      const pair = dates.length === 1 && glyph > 0 && stackHeight(bare, whole) + glyph + 6 * unit <= box.h + 0.5 ? glyph : 0;
      const room = box.h - (pair ? pair + 6 * unit : 0);
      // The details as the day allows — on the hour's line and one more, on the hour's line, or none: never at the title's cost.
      for (const spare of [1, 0]) {
        const blocks = dates.map((entry) => blockAt(entry, box.w, whole, spare));
        if (blocks.every((block): block is Block => block !== null) && stackHeight(blocks, whole) <= room + 0.5) return { ...items, size: whole, blocks, glyph: pair };
      }
      return { ...items, size: whole, blocks: bare, glyph: pair };
    }
    const size = floor.title;
    const note = noteSizeOf(size);
    // Each title at the floor, a word too wide cut (`wide`); the hour on one line, or left to the legend when
    // it takes two here («time to be / announced»), the title keeping the room.
    const floored = dates.map((entry) =>
      remember(entry, `floor|${q(box.w)}`, () => {
        ctx.font = face(size, 700);
        const full = wrapBalanced(ctx, upper(entry.title), box.w, { hyphenate: true });
        const lines = full.map((line) => (fits(line, box.w) ? line : ellipsize(line, box.w)));
        ctx.font = face(note, 500);
        const hour = noteLines([hourOf(entry)], [], box.w, 0);
        return { full, lines, wide: full.some((line) => !fits(line, box.w)), hour: hour && hour.length === 1 ? hour : [] };
      }),
    );
    const full = floored.map((entry) => entry.full);
    const wide = floored.map((entry) => entry.wide);
    const lines = floored.map((entry) => entry.lines);
    const hours = floored.map((entry) => entry.hour);
    // The title's face, for the titles shortened below.
    ctx.font = face(size, 700);
    const heightOf = (counts: number[], notes: string[][]) => counts.reduce((sum, count, index) => sum + count * lineOf(size) + notes[index].length * noteLineOf(note), 0) + (dates.length - 1) * between(size);
    const blocksOf = (counts: number[], notes: string[][]): Items => ({
      ...items,
      size,
      blocks: dates.map((entry, index) => ({ entry, lines: cutTo(lines[index], counts[index], box.w), notes: notes[index], whole: !wide[index] && counts[index] >= lines[index].length })),
    });
    if (!wide.some(Boolean)) {
      const counts = full.map((title) => title.length);
      const notes = hours.map((hour) => [...hour]);
      const order = dates.map((_, index) => index).sort((a, b) => Number(isRace(dates[a])) - Number(isRace(dates[b])) || counts[b] - counts[a]);
      for (let dropped = 0; dropped <= order.length; dropped += 1) {
        if (dropped > 0) notes[order[dropped - 1]] = [];
        if (heightOf(counts, notes) <= box.h + 0.5) return blocksOf(counts, notes);
      }
    }
    for (const notes of [hours, dates.map((): string[] => [])]) {
      const counts = lines.map((title) => title.length);
      while (heightOf(counts, notes) > box.h + 0.5) {
        let longest = -1;
        counts.forEach((count, index) => {
          if (count <= 1) return;
          const raceFirst = longest < 0 ? -1 : Number(isRace(dates[index])) - Number(isRace(dates[longest]));
          if (raceFirst < 0 || (raceFirst === 0 && count > counts[longest])) longest = index;
        });
        if (longest < 0) break;
        counts[longest] -= 1;
      }
      if (heightOf(counts, notes) > box.h + 0.5) continue;
      const short = (index: number) => counts[index] === 1 && (wide[index] || lines[index].length > 1) && lettersOf(cutTo(lines[index], 1, box.w)[0]) < 10 && chipWidth(dates[index], floor.note) <= box.w;
      if (dates.some((_, index) => short(index))) continue;
      return blocksOf(counts, notes);
    }
    // Else each date its chip, on a line with what the width holds of its title when the day is wide; the
    // chips are hours, and their floor is the hour's.
    for (const chipSize of sizesDown(Math.min(cap, 22 * boost), floor.note)) {
      const line = chipLineOf(chipSize);
      const widest = Math.max(...dates.map((entry) => chipWidth(entry, chipSize)));
      if (box.w >= 200 * unit * boost && widest <= box.w && dates.length * line <= box.h + 0.5) return { ...items, chips: dates, chipSize, inline: true };
      if (widest <= box.w && chipLines(dates, box.w, chipSize).length * line <= box.h + 0.5) return { ...items, chips: dates, chipSize };
    }
    const chipSize = floor.note;
    const line = chipLineOf(chipSize);
    const rank = (entry: CalendarImageEntry) => (isRace(entry) ? 0 : tintOf(entry) === "special" ? 1 : 2);
    const ranked = [...dates].sort((a, b) => rank(a) - rank(b));
    for (let shown = dates.length - 1; shown > 0; shown -= 1) {
      const kept = dates.filter((entry) => ranked.slice(0, shown).includes(entry));
      const rows = chipLines(kept, box.w, chipSize);
      const inline = moreFits(rows[rows.length - 1], dates.length - shown, box.w, chipSize);
      if ((rows.length + (inline ? 0 : 1)) * line <= box.h + 0.5) return { ...items, chips: kept, chipSize, more: dates.length - shown };
    }
    return { ...items, chipSize, more: dates.length };
  }
  /**
   * What a date gives up in `items`, the race twice: nothing whole over its hour, 3 without it, 12–20 shortened,
   * 25–30 as a chip, 80 in «+2 altele» — how the weeks' heights and the legend's place are chosen.
   */
  function dateLoss(items: Items, entry: CalendarImageEntry): number {
    const block = items.blocks.find((candidate) => candidate.entry === entry);
    // A title shortened costs the more the less of it shows: «RECUNOAȘTE…» alone more than two lines of it.
    const shown = (lines: string[]) => Math.min(1, lines.reduce((sum, line) => sum + lettersOf(line), 0) / Math.max(1, lettersOf(entry.title)));
    const own = block ? (block.whole ? 0 : 12 + 8 * (1 - shown(block.lines))) + (block.notes.length === 0 ? 3 : 0) : items.chips.includes(entry) ? (items.inline ? 25 : 30) : 80;
    return own * (isRace(entry) ? 2 : 1);
  }
  const itemsLoss = (items: Items, dates: CalendarImageEntry[]) => dates.reduce((sum, entry) => sum + dateLoss(items, entry), 0);
  /** How a date reads in its day: whole over its hour, whole alone, shortened, a chip, or among «+2 altele». */
  function stateIn(items: Items, entry: CalendarImageEntry): "whole" | "hourless" | "cut" | "chip" | "more" {
    const block = items.blocks.find((candidate) => candidate.entry === entry);
    if (block) return !block.whole ? "cut" : block.notes.length === 0 ? "hourless" : "whole";
    return items.chips.includes(entry) ? "chip" : "more";
  }

  // ---- The heads: each weekday's series on strips, a head widening over the free ones beside it.
  /**
   * A series' strip `room` wide at `size`: its title whole, then its glyphs before its hour or its rhythm, then
   * its details on `spare` lines more (null: none). Null when a word does not fit even split — unless `cut`,
   * the last resort, which also keeps the title to `maxLines` (0: all of it) and the words under it to two.
   */
  function stripAt(lane: PosterLane, room: number, size: number, spare: number | null, cut = false, maxLines = 0): StripPlan | null {
    return remember(lane, `strip|${q(room)}|${size}|${spare}|${cut}|${maxLines}`, () => measureStrip(lane, room, size, spare, cut, maxLines));
  }
  function measureStrip(lane: PosterLane, room: number, size: number, spare: number | null, cut: boolean, maxLines: number): StripPlan | null {
    const pad = 9 * unit;
    const inner = room - 2 * pad;
    ctx.font = face(size, 700);
    // A strip is centred: its last line half a line wide at least, «INTERVALE / PE PISTĂ», not «… PE / PISTĂ».
    let lines = wrapBalanced(ctx, upper(lane.title), inner, { hyphenate: true, minLastRatio: 0.5 });
    let shortened = false;
    if (lines.some((line) => !fits(line, inner))) {
      if (!cut) return null;
      lines = lines.map((line) => (fits(line, inner) ? line : ellipsize(line, inner)));
      shortened = true;
    }
    if (maxLines > 0 && lines.length > maxLines) {
      lines = cutTo(lines, maxLines, inner);
      shortened = true;
    }
    // The hour once, where the rhythm is stated (the owner's hierarchy) — and the rhythm itself when the series
    // does not keep every one of its weekdays, «O dată la două săptămâni, duminica, la 08:00» (D10).
    const note = Math.max(17 * boost, size * 0.8);
    const glyph = Math.max(floor.glyph, note * 1.15) * unit;
    ctx.font = face(note, 500);
    const said = !lane.weekly && lane.time !== null && lane.sentence.includes(lane.time);
    const heads = [...(said ? [] : [lane.time ? at(lane.time) : data.words.tba]), ...(lane.weekly ? [] : [lane.sentence])];
    // In a narrow strip «ora 18:30» does not break round the glyphs: the type's alone before it, else both on a
    // line of their own over it — the marks under the head carry the ground's glyph either way.
    const all = eventGlyphs(lane.type, lane.surface);
    const besideW = (count: number) => glyphsWidth(count, glyph) + 6 * unit;
    const count = [all.length, 1].find((candidate) => fits(heads[0], inner - besideW(candidate)) || !fits(heads[0], inner)) ?? 0;
    const above = count === 0;
    const glyphs = above ? all : all.slice(0, count);
    const firstRoom = above ? inner : inner - besideW(glyphs.length);
    let notes = noteLines(heads, spare === null ? [] : detailsOf(lane.details), inner, spare ?? 0, firstRoom);
    if (!notes) {
      if (!cut) return null;
      notes = heads.flatMap((head) => wrapBalanced(ctx, head, firstRoom)).map((line) => (fits(line, firstRoom) ? line : ellipsize(line, firstRoom)));
      shortened = true;
    }
    if (maxLines > 0 && notes.length > 2) {
      notes = cutTo(notes, 2, firstRoom);
      shortened = true;
    }
    return { lane, lines, notes, size, note, glyphs, glyph, above, h: 2 * pad + lines.length * lineOf(size) + 2 * unit + (above ? glyph + 4 * unit : 0) + notes.length * noteLineOf(note), cut: shortened };
  }
  const byColumn = Array.from({ length: 7 }, (_, column) => plan.lanes.filter((lane) => lane.inHeads && lane.columns.includes(column)).sort(earlierFirst));
  const stripInset = 6 * unit;
  /**
   * The heads at `size`: each weekday that holds series, its strips stacked, over its own column and the free
   * heads beside it — at most `SPAN_MAX` columns (D03). Of every way to share the free heads out, the one where
   * the fewest strips are cut, then the fewest take more than two lines for their title (more than one where
   * two series share the head, or past `maxLines`) or more than two for their hour and rhythm, then the
   * shortest tallest head, then the least pale ground over the days, then the fewest columns taken: a strip
   * widens before it is cut (the review of 2026-10-28), and toward the free head no other strip wants.
   */
  function groupsAt(cellW: number, size: number, spare: number | null, cut = false, maxLines = 0): Group[] | null {
    const homes = byColumn.flatMap((lanes, column) => (lanes.length > 0 ? [column] : []));
    const stripsOf = (home: number, span: number) => byColumn[home].map((lane) => stripAt(lane, span * cellW - 2 * stripInset, size, spare, cut, maxLines));
    const heightOf = (strips: StripPlan[]) => 5 * unit + strips.reduce((sum, strip) => sum + strip.h, 0) + (strips.length - 1) * 6 * unit + 7 * unit;
    type Option = { from: number; to: number; strips: StripPlan[]; h: number; cuts: number; over: number };
    const options = homes.map((home, index) => {
      const most = maxLines || (byColumn[home].length > 1 ? 1 : 2);
      const left = index > 0 ? homes[index - 1] + 1 : 0;
      const right = index < homes.length - 1 ? homes[index + 1] - 1 : 6;
      const found: Option[] = [];
      for (let from = Math.max(left, home - SPAN_MAX + 1); from <= home; from += 1) {
        for (let to = home; to <= Math.min(right, from + SPAN_MAX - 1); to += 1) {
          const strips = stripsOf(home, to - from + 1);
          if (!strips.every((strip): strip is StripPlan => strip !== null)) continue;
          const cuts = strips.filter((strip) => strip.cut).length;
          const over = strips.filter((strip) => strip.lines.length > most || strip.notes.length > 2).length;
          found.push({ from, to, strips, h: heightOf(strips), cuts, over });
        }
      }
      return found;
    });
    if (options.some((found) => found.length === 0)) return null;
    // Every way to share the free heads out — a handful: a head may only widen over the free ones beside it.
    let best: { picks: Option[]; score: number[] } | null = null;
    const better = (a: number[], b: number[]) => {
      for (let index = 0; index < a.length; index += 1) if (Math.abs(a[index] - b[index]) > 1e-6) return a[index] < b[index];
      return false;
    };
    const walk = (index: number, picks: Option[]) => {
      if (index === homes.length) {
        const score = [
          picks.reduce((sum, pick) => sum + pick.cuts, 0),
          picks.reduce((sum, pick) => sum + pick.over, 0),
          Math.round(Math.max(...picks.map((pick) => pick.h))),
          Math.round(picks.reduce((sum, pick) => sum + pick.h * (pick.to - pick.from + 1), 0)),
          picks.reduce((sum, pick) => sum + pick.to - pick.from + 1, 0),
        ];
        if (!best || better(score, best.score)) best = { picks: [...picks], score };
        return;
      }
      for (const option of options[index]) {
        if (index > 0 && option.from <= picks[index - 1].to) continue;
        picks.push(option);
        walk(index + 1, picks);
        picks.pop();
      }
    };
    walk(0, []);
    const chosen = best as { picks: Option[] } | null;
    return chosen && chosen.picks.map((pick, index) => ({ home: homes[index], from: pick.from, to: pick.to, strips: pick.strips, h: pick.h }));
  }
  const tallest = (groups: Group[]) => Math.max(0, ...groups.map((group) => group.h));
  /**
   * The strips' size and words: the rhythm read at a phone's width — 20 px at least — and no head taller than
   * `cap`, a week's row, so the weeks keep their room (D02/D03). At 20 the details go from the end before the
   * size falls under it; above 20, larger while no head grows taller than at 20, or than a seventh of the grid.
   * Past `cap` at the floor, the titles shortened to two lines, then one, until the head is no taller than
   * `room`, what the weeks leave it.
   */
  function chooseStrips(grid: Box, cellW: number, cap: number, room: number): Group[] {
    const least = 20 * boost;
    const most = Math.max(least, Math.min((cellW / unit) * 0.16, 26 * boost));
    for (const spare of [1, 0, null]) {
      const atLeast = groupsAt(cellW, least, spare);
      if (!atLeast || tallest(atLeast) > cap + 0.5) continue;
      const budget = Math.min(cap, Math.max(tallest(atLeast), grid.h * 0.14));
      for (const size of sizesDown(most, least)) {
        const groups = size === least ? atLeast : groupsAt(cellW, size, spare);
        if (groups && tallest(groups) <= budget + 0.5) return groups;
      }
    }
    for (const size of sizesDown(least - 1, floor.title)) {
      const groups = groupsAt(cellW, size, null);
      if (groups && tallest(groups) <= cap + 0.5) return groups;
    }
    for (const maxLines of [0, 2]) {
      const groups = groupsAt(cellW, floor.title, null, true, maxLines);
      if (groups && tallest(groups) <= Math.max(cap, room) + 0.5) return groups;
    }
    return groupsAt(cellW, floor.title, null, true, 1) ?? [];
  }

  // ---- The grid: the heads, then the weeks, Monday first.
  const weeks = monthGrid(data.month);
  const lastRow = weeks.length - 1;
  const lead = weeks[0].findIndex((day) => day.inMonth);
  const tail = 6 - [...weeks[lastRow]].reverse().findIndex((day) => day.inMonth);
  const inset = 8 * unit;
  const cellLosses = new Map<string, number>();
  /**
   * The grid in `grid`: the heads, then the weeks — the last at least `lastH` tall, for the legend in its empty
   * days. Null when the weeks cannot keep their least beside a last week that tall.
   */
  function layoutGrid(grid: Box, lastH = 0) {
    const cellW = grid.w / 7;
    const cw = cellW / unit;
    // The weekdays at one size, each inside its cell with a margin — and inside its tab, the cell less 5 px a side.
    let labelSize = Math.min(22 * boost, cw * 0.15);
    ctx.font = face(labelSize, 800);
    const labelRoom = cellW - 24 * unit;
    const widest = Math.max(...data.words.weekdaysLong.map((name) => ctx.measureText(upper(name)).width));
    if (widest > labelRoom) labelSize = Math.max(floor.title, (labelSize * labelRoom) / widest);
    const labelH = labelSize * 2.3 * unit;
    const total = grid.h - labelH;
    const even = total / weeks.length;
    // Whole sizes, so the places the legend tries measure the same words at the same sizes.
    const numberAt = (row: number) => Math.round(clamp(Math.min(cw, row / unit) * 0.19, floor.number, 32 * boost));
    const numberedAt = (size: number) => 2 * inset + 10 * unit + size * 0.72 * unit;
    // A week's least: its days' numbers and one line under them — a title's, or a mark's on the number's line —
    // what no head and no legend may take from it.
    const leastRow = numberedAt(numberAt(even)) + 8 * unit + lineOf(floor.title);
    // The heads no taller than a week's row — the rows left when the last week is grown for the legend — and
    // never so tall that a week falls under its least.
    const cap = lastH > even ? (total - lastH) / (weeks.length - 1) : even;
    const groups = chooseStrips(grid, cellW, cap, total - even * 0.8 - Math.max(lastH, leastRow) - (weeks.length - 2) * leastRow);
    const tabs = tallest(groups);
    // Each head its own height (D02): a weekday with no series is its label alone, and its first day starts
    // under it; under a head with series its first day starts under the strips.
    const groupOf = (column: number) => groups.find((group) => group.from <= column && column <= group.to);
    const colTop = (column: number) => labelH + (groupOf(column)?.h ?? 0);
    // The sizes in the days follow a week's typical height: what is left once the heads and the legend's week have theirs.
    const typical = Math.max(leastRow, lastH > 0 ? (total - tabs - lastH) / (weeks.length - 1) : (total - tabs) / weeks.length);
    const rows = typical / unit;
    const pillCap = Math.round(clamp(Math.min(cw, rows) * 0.14, floor.title, 22 * boost));
    const titleCap = Math.round(clamp(Math.min(cw * 0.16, rows * 0.13), floor.title, 28 * boost));

    // The marks beside a day's dates: one place and one size on every such day (D41) — 17 px words, 18 px
    // glyphs, on the number's line after a two-digit number when the widest row of them fits there with both
    // glyphs, else with the type's alone — the day's number a little smaller for it, a fifth at most, rather
    // than the pill under it taking a line from the date's title (the review of 2026-10-28) — else under the
    // number with both.
    const numberW = (size: number) =>
      remember(plan, `number|${size}`, () => {
        ctx.font = face(size, 800);
        return ctx.measureText("28").width;
      });
    const besideRows = [...plan.dates.keys()].flatMap((day) => (plan.marks.has(day) ? [plan.marks.get(day) ?? []] : []));
    const rowWidth = (marks: Mark[], count: number) => marks.reduce((sum, mark) => sum + pillAt(mark, floor.title, count).w, 0) + (marks.length - 1) * 4 * unit;
    const largest = numberAt(typical);
    const smaller = sizesDown(largest, Math.max(floor.number, Math.ceil(largest * 0.8)));
    const onLineAt = (count: number) => smaller.find((size) => besideRows.every((marks) => rowWidth(marks, count) <= cellW - 2 * inset - numberW(size) - 8 * unit + 0.5));
    const counts = [2, 1].map((count) => ({ count, size: onLineAt(count) }));
    const fitting = counts.find((candidate) => candidate.size !== undefined);
    const beside = { count: fitting?.count ?? 2, onLine: fitting !== undefined };
    const numSize = fitting?.size ?? largest;
    const numW = numberW(numSize);
    const minRow = numberedAt(numSize) + 8 * unit + lineOf(floor.title);

    // A week's height follows what its days hold (the audit, D04): each week starts at its least — the first
    // under the tallest head, the last as tall as `lastH` asks — and the rest goes, a few pixels at a time, to
    // the week where it saves the most per pixel: a «+2 altele» turned into chips, a race's title made whole, a
    // shortened title given its lines; what is left after that, to the lowest weeks first, so the others stay even.
    const heights = weeks.map((_, row) => (row === 0 ? tabs : 0) + (row === lastRow ? Math.max(minRow, lastH) : minRow));
    let budget = total - heights.reduce((sum, height) => sum + height, 0);
    if (budget < -0.5) {
      if (lastH > 0) return null;
      const scale = total / (total - budget);
      heights.forEach((height, row) => (heights[row] = height * scale));
      budget = 0;
    }
    const cellAt = (row: number, column: number, top: number, height: number): Box => {
      const x = grid.x + column * cellW;
      if (row > 0) return { x, y: top, w: cellW, h: height };
      const y = grid.y + colTop(column);
      return { x, y, w: cellW, h: grid.y + labelH + height - y };
    };
    // Each day's loss as its week grows, as steps: from each height on, what it gives up — found by halving,
    // a few pixels close, the loss never rising as the day grows.
    const step = 4 * unit;
    type Step = { h: number; loss: number };
    const lossAt = (steps: Step[], height: number) => steps.reduce((loss, candidate) => (candidate.h <= height + 1e-6 ? candidate.loss : loss), steps[0].loss);
    const stepsOf = (row: number, column: number, day: number): Step[] => {
      // At the even pixel under the day's height — what a day gives up never rises as it grows — so the places
      // the legend tries share what they measured.
      const evaluate = (height: number) => {
        const box = cellAt(row, column, 0, height);
        box.h = 2 * unit * Math.floor((box.h + 1e-6) / (2 * unit));
        const key = `${day}|${q(box.w)}|${q(box.h)}|${numSize}|${q(numW)}|${beside.count}|${beside.onLine}|${pillCap}`;
        let loss = cellLosses.get(key);
        if (loss === undefined) {
          const cell = planCell(day, box, numSize, numW, beside, pillCap);
          loss = cell.loss + itemsLoss(fitDates(cell.dates, cell.items.box, floor.title, 0), cell.dates);
          cellLosses.set(key, loss);
        }
        return loss;
      };
      const from = heights[row];
      const to = from + Math.max(0, budget);
      const steps: Step[] = [{ h: from, loss: evaluate(from) }];
      const most = evaluate(to);
      while (steps.length < 10 && steps[steps.length - 1].loss > most + 1e-6) {
        const last = steps[steps.length - 1];
        let low = last.h;
        let high = to;
        while (high - low > step) {
          const middle = (low + high) / 2;
          if (evaluate(middle) < last.loss - 1e-6) high = middle;
          else low = middle;
        }
        steps.push({ h: high, loss: evaluate(high) });
      }
      return steps;
    };
    const daySteps = weeks.map((week, row) => week.flatMap((day, column) => (day.inMonth && (plan.dates.has(day.day) || plan.marks.has(day.day)) ? [stepsOf(row, column, day.day)] : [])));
    const rowLoss = (row: number, height: number) => daySteps[row].reduce((sum, steps) => sum + lossAt(steps, height), 0);
    const marks = daySteps.map((days) => [...new Set(days.flatMap((steps) => steps.map((candidate) => candidate.h)))].sort((a, b) => a - b));
    for (let round = 0; round < 64 && budget > 0.5; round += 1) {
      let best: { row: number; add: number; gain: number } | null = null;
      for (let row = 0; row < weeks.length; row += 1) {
        const now = rowLoss(row, heights[row]);
        for (const height of marks[row]) {
          const add = height - heights[row];
          if (add <= 0.5 || add > budget + 0.5) continue;
          const gain = (now - rowLoss(row, height)) / add;
          if (gain > 1e-6 && (!best || gain > best.gain + 1e-9)) best = { row, add, gain };
        }
      }
      if (!best) break;
      heights[best.row] += best.add;
      budget -= best.add;
    }
    // The rest to the lowest weeks first — under its head for the first — until they are even.
    const own = (row: number) => heights[row] - (row === 0 ? tabs : 0);
    const levels = weeks.map((_, row) => own(row)).sort((a, b) => a - b);
    let level = levels[0];
    for (let index = 0, left = Math.max(0, budget); index < levels.length && left > 0; index += 1) {
      const next = index + 1 < levels.length ? levels[index + 1] : Infinity;
      const room = (next - level) * (index + 1);
      if (room >= left) {
        level += left / (index + 1);
        left = 0;
      } else {
        left -= room;
        level = next;
      }
    }
    weeks.forEach((_, row) => (heights[row] += Math.max(0, level - own(row))));

    const heightOf = (row: number) => heights[row];
    const rowTop = (row: number) => grid.y + labelH + heights.slice(0, row).reduce((sum, height) => sum + height, 0);
    const cells: CellPlan[] = [];
    weeks.forEach((week, row) =>
      week.forEach((day, column) => {
        if (day.inMonth) cells.push(planCell(day.day, cellAt(row, column, rowTop(row), heights[row]), numSize, numW, beside, pillCap));
      }),
    );
    // One size for every date alone in its day — the size the most crowded of them allows — and its glyphs
    // over it on every one of them, whole with the room, or on none (D29); a day of two or three dates no larger.
    // A day whose title is whole only at the floor, its hour given up, counts at the floor: one size for every
    // date alone in its day whose title is whole, the review's «RECUNOAȘTEREA» at 17 beside «ȘEDINȚA» at 20.
    const single = cells.filter((cell) => cell.dates.length === 1);
    const wholes = single.map((cell) => wholeSize(cell.dates, cell.items.box, titleCap));
    const floored = single.map((cell, index) => wholes[index] === null && stateIn(fitDates(cell.dates, cell.items.box, floor.title, 0), cell.dates[0]) === "hourless");
    const common = Math.min(titleCap, ...wholes.filter((size): size is number => size !== null), ...(floored.some(Boolean) ? [floor.title] : []));
    const spares = single.map((cell, index) => {
      const block = wholes[index] === null ? null : blockAt(cell.dates[0], cell.items.box.w, common, null);
      return block ? cell.items.box.h - blockHeight(block, common) - 6 * unit : 0;
    });
    const room = Math.min(1.8 * common * unit, 46 * boost * unit, cellW * 0.4, ...spares);
    const glyph = single.length > 0 && room >= floor.glyph * unit ? room : 0;
    for (const cell of cells) cell.items = fitDates(cell.dates, cell.items.box, common, glyph);
    // A series' glyphs over its hour at one size on every day that has them, the smallest's (D29) — and a
    // series' mark alone in its day at one size, glyphs over it or not, the smallest's too.
    // (Centred under the number: a pill on the number's line keeps its place, and so do glyphs raised to it.)
    const lone = cells.filter((cell) => cell.dates.length === 0 && cell.pills.length === 1 && !cell.pills[0].raised && Math.abs(cell.pills[0].x + cell.pills[0].w / 2 - (cell.box.x + cell.box.w / 2)) < unit);
    const above = Math.min(...lone.flatMap((cell) => (cell.pills[0].above > 0 ? [cell.pills[0].above] : [])));
    const pillSize = Math.min(...lone.map((cell) => cell.pills[0].size));
    for (const cell of lone) {
      const pill = cell.pills[0];
      const middle = pill.y + pill.h / 2;
      Object.assign(pill, pillAt(pill, pillSize, pill.above > 0 ? 0 : pill.glyphs.length));
      pill.x = cell.box.x + (cell.box.w - pill.w) / 2;
      if (pill.above === 0) {
        pill.y = middle - pill.h / 2;
        continue;
      }
      const below = cell.items.box;
      pill.above = above;
      pill.y = below.y + (below.h - (above + 6 * unit + pill.h)) / 2 + above + 6 * unit;
    }
    const stateOf = (entry: CalendarImageEntry) => {
      const cell = cells.find((candidate) => candidate.dates.includes(entry));
      return cell ? stateIn(cell.items, entry) : "more";
    };
    // What the month gives up — and a race not whole while another date is (the owner's hierarchy).
    const titled = (entry: CalendarImageEntry) => stateOf(entry) === "whole" || stateOf(entry) === "hourless";
    const dates = [...plan.dates.values()].flat();
    const raceLeft = dates.some((entry) => isRace(entry) && !titled(entry)) && dates.some((entry) => !isRace(entry) && titled(entry));
    // A series' strip cut costs like a special date shortened twice: no list says the series whole.
    const stripsCut = groups.reduce((sum, group) => sum + group.strips.filter((strip) => strip.cut).length, 0);
    const loss = cells.reduce((sum, cell) => sum + cell.loss + itemsLoss(cell.items, cell.dates), 0) + (raceLeft ? 40 : 0) + stripsCut * 25;

    const regions: Region[] = [];
    if (lead > 0) {
      const top = grid.y + Math.max(...Array.from({ length: lead }, (_, column) => colTop(column)));
      regions.push({ row: 0, from: 0, to: lead, box: { x: grid.x, y: top, w: lead * cellW, h: grid.y + labelH + heights[0] - top } });
    }
    if (tail < 6) regions.push({ row: lastRow, from: tail + 1, to: 7, box: { x: grid.x + (tail + 1) * cellW, y: rowTop(lastRow), w: (6 - tail) * cellW, h: heights[lastRow] } });
    return { grid, cellW, labelSize, labelH, groups, groupOf, colTop, heightOf, rowTop, numSize, cells, regions, stateOf, loss };
  }
  type Layout = NonNullable<ReturnType<typeof layoutGrid>>;

  function planCell(day: number, box: Box, numSize: number, numW: number, beside: { count: number; onLine: boolean }, pillCap: number): CellPlan {
    const marks = plan.marks.get(day) ?? [];
    const dates = plan.dates.get(day) ?? [];
    const numTop = box.y + inset + 2 * unit;
    const numBottom = numTop + numSize * 0.72 * unit;
    const below: Box = { x: box.x + inset, y: numBottom + 8 * unit, w: box.w - 2 * inset, h: box.y + box.h - inset - (numBottom + 8 * unit) };
    const empty: Items = { box: below, size: floor.title, blocks: [], glyph: 0, chips: [], chipSize: floor.title, inline: false, more: 0 };
    const cell: CellPlan = { day, box, tint: dayTint(dates), pills: [], hidden: null, dates, items: empty, loss: 0 };
    if (dates.length === 0) {
      const alone = marksAlone(marks, below, box, pillCap, { x: box.x + inset + numW + 8 * unit, top: numTop, bottom: numBottom, middle: numTop + numSize * 0.36 * unit });
      cell.pills = alone.pills;
      cell.hidden = alone.hidden;
      cell.loss = alone.loss;
      return cell;
    }
    let top = below.y;
    if (marks.length > 0) {
      const sized = marks.map((mark) => ({ ...mark, ...pillAt(mark, floor.title, beside.count), above: 0 }));
      if (beside.onLine) {
        let x = box.x + inset + numW + 8 * unit;
        const middle = numTop + numSize * 0.36 * unit;
        for (const pill of sized) {
          cell.pills.push({ ...pill, x, y: middle - pill.h / 2 });
          x += pill.w + 4 * unit;
        }
        top = Math.max(below.y, middle + sized[0].h / 2 + 6 * unit);
      } else {
        let x = box.x + inset;
        let y = numBottom + 8 * unit;
        for (const pill of sized) {
          if (x + pill.w > box.x + box.w - inset + 0.5 && x > box.x + inset) {
            x = box.x + inset;
            y += pill.h + 4 * unit;
          }
          cell.pills.push({ ...pill, x, y });
          x += pill.w + 4 * unit;
        }
        top = y + sized[0].h + 6 * unit;
      }
    }
    cell.items = { ...empty, box: { x: box.x + inset, y: top, w: box.w - 2 * inset, h: box.y + box.h - inset - top } };
    return cell;
  }

  /**
   * A series' dates alone in their day: one, its glyphs large over a pill with the hour, centred — no larger
   * than twice the hour's words (D30), the strip being where the rhythm is said; several, or a day too short
   * for that, each a pill with its glyphs, stacked; a day too short for a pill under its number, the pills on
   * the number's line, as beside a date, the rest on the lines under it; a day too short for that, the first
   * on the number's line and «+1 altele» under it — never a day of runs drawn bare (the review of 2026-10-28).
   * `loss` what the form gives up: nothing for the first, a little for each step down, as much as a date's
   * chip for each mark only counted, more than a «+2 altele» for one not even counted. A cancelled date's pill
   * is grey, so its glyphs are what say whose date it was: every form that keeps them — the glyphs beside the
   * number over the pill under it among them — comes before any form that drops them, and dropping them costs more.
   */
  function marksAlone(marks: Mark[], below: Box, box: Box, pillCap: number, line: { x: number; top: number; bottom: number; middle: number }): { pills: Pill[]; hidden: CellPlan["hidden"]; loss: number } {
    if (marks.length === 0) return { pills: [], hidden: null, loss: 0 };
    if (marks.length === 1) {
      for (const size of sizesDown(pillCap, floor.title)) {
        const pill = pillAt(marks[0], size, 0);
        const above = Math.min(2 * size * unit, below.w * 0.42, Math.max(size * 1.6 * unit, below.h * 0.38), below.h - pill.h - 6 * unit);
        if (above < floor.glyph * unit || pill.w > below.w) continue;
        const height = above + 6 * unit + pill.h;
        return { pills: [{ ...marks[0], ...pill, above, x: box.x + (box.w - pill.w) / 2, y: below.y + (below.h - height) / 2 + above + 6 * unit }], hidden: null, loss: 0 };
      }
    }
    const right = box.x + box.w - inset + 0.5;
    const bottom = box.y + box.h - inset + 0.5;
    const cancelled = marks.some((mark) => mark.entry.cancelled);
    const bare = (count: number) => (cancelled && count === 0 ? 1 : 0);
    type Found = { pills: Pill[]; hidden: CellPlan["hidden"]; loss: number } | null;
    /** The pills stacked and centred under the number. */
    const centred = (count: number): Found => {
      for (const size of sizesDown(pillCap, floor.title)) {
        const sized = marks.map((mark) => ({ ...mark, ...pillAt(mark, size, count), above: 0 }));
        const height = sized.reduce((sum, pill) => sum + pill.h, 0) + (sized.length - 1) * 6 * unit;
        if (height > below.h + 0.5 || sized.some((pill) => pill.w > below.w + 0.5)) continue;
        let y = below.y + (below.h - height) / 2;
        const pills = sized.map((pill) => {
          const placed = { ...pill, x: box.x + (box.w - pill.w) / 2, y };
          y += pill.h + 6 * unit;
          return placed;
        });
        return { pills, hidden: null, loss: (marks.length === 1 ? 0.3 : 0) + (2 - count) * 0.1 + bare(count) };
      }
      return null;
    };
    /** One mark's glyphs centred on the number's line, clear of the number, and its pill under the number. */
    const raised = (): Found => {
      if (marks.length !== 1) return null;
      const count = eventGlyphs(marks[0].lane.type, marks[0].lane.surface).length;
      for (const size of sizesDown(pillCap, floor.title)) {
        const pill = pillAt(marks[0], size, 0);
        if (pill.w > below.w + 0.5) continue;
        for (let above = Math.min(2 * size * unit, below.w * 0.42, Math.max(size * 1.6 * unit, below.h * 0.38)); above >= floor.glyph * unit - 1e-6; above -= unit) {
          const height = above + 6 * unit + pill.h;
          const y = Math.max(below.y, line.top + (bottom - line.top - height) / 2 + above + 6 * unit);
          const glyphTop = y - 6 * unit - above;
          const clear = box.x + (box.w - glyphsWidth(count, above)) / 2 >= line.x - 0.5 || glyphTop >= line.bottom;
          if (y + pill.h > bottom || glyphTop < line.top - 0.5 || !clear) continue;
          return { pills: [{ ...marks[0], ...pill, above, raised: true, x: box.x + (box.w - pill.w) / 2, y }], hidden: null, loss: 0.4 };
        }
      }
      return null;
    };
    /** The pills side by side on the number's line. */
    const onLine = (count: number): Found => {
      const sized = marks.map((mark) => ({ ...mark, ...pillAt(mark, floor.title, count), above: 0 }));
      if (line.x + sized.reduce((sum, pill) => sum + pill.w + 4 * unit, 0) - 4 * unit > right) return null;
      let x = line.x;
      const pills = sized.map((pill) => {
        const placed = { ...pill, x, y: line.middle - pill.h / 2 };
        x += pill.w + 4 * unit;
        return placed;
      });
      return { pills, hidden: null, loss: 0.6 + (2 - count) * 0.1 + bare(count) };
    };
    /** The number's line, then the lines under it. */
    const flowed = (count: number): Found => {
      const placed: Pill[] = [];
      let x = line.x;
      let y = line.middle - pillAt(marks[0], floor.title, count).h / 2;
      for (const mark of marks) {
        const pill = { ...mark, ...pillAt(mark, floor.title, count), above: 0 };
        if (x + pill.w > right && placed.length > 0) {
          x = box.x + inset;
          y += pill.h + 4 * unit;
        }
        if (x + pill.w > right || y + pill.h > bottom) break;
        placed.push({ ...pill, x, y });
        x += pill.w + 4 * unit;
      }
      return placed.length === marks.length ? { pills: placed, hidden: null, loss: 1 + (2 - count) * 0.1 + bare(count) } : null;
    };
    // Each form with both glyphs, the type's, or none — a cancelled date's glyphs kept by every form before any
    // drops them, both raised over its pill before the type's alone in it.
    const forms: (() => Found)[] = cancelled
      ? [() => centred(2), raised, () => centred(1), () => onLine(2), () => onLine(1), () => flowed(2), () => flowed(1), () => centred(0), () => onLine(0), () => flowed(0)]
      : [...[2, 1, 0].map((count) => () => centred(count)), ...[2, 1, 0].map((count) => () => onLine(count)), ...[2, 1, 0].map((count) => () => flowed(count))];
    for (const form of forms) {
      const found = form();
      if (found) return found;
    }
    const flat = marks.map((mark) => ({ ...mark, ...pillAt(mark, floor.title, 0), above: 0 }));
    const first = { ...flat[0], x: line.x, y: line.middle - flat[0].h / 2 };
    if (first.x + first.w > right) return { pills: [], hidden: null, loss: 100 * marks.length };
    const under = first.y + first.h + 4 * unit + lineOf(floor.title);
    const hidden = marks.length > 1 && under <= bottom ? { count: marks.length - 1, x: box.x + inset, y: under - floor.title * 0.22 * unit } : null;
    return { pills: [first], hidden, loss: (hidden ? 30 : 100) * (marks.length - 1) };
  }

  function drawCell(cell: CellPlan, numSize: number) {
    const { box, items } = cell;
    if (cell.tint) {
      ctx.fillStyle = palette[cell.tint][0];
      ctx.fillRect(box.x, box.y, box.w, box.h);
    }
    ctx.fillStyle = palette.cellInk;
    ctx.font = face(numSize, 800);
    ctx.fillText(String(cell.day), box.x + inset, box.y + inset + 2 * unit + numSize * 0.72 * unit);
    cell.pills.forEach(drawPill);
    if (cell.hidden) {
      ctx.font = face(floor.title, 700);
      ctx.fillStyle = palette.title;
      ctx.fillText(fitText(ctx, moreText(cell.hidden.count), box.w - 2 * inset), cell.hidden.x, cell.hidden.y);
    }
    const middle = items.box.x + items.box.w / 2;
    if (items.blocks.length > 0) {
      const { size } = items;
      const note = noteSizeOf(size);
      const content = stackHeight(items.blocks, size) + (items.glyph ? items.glyph + 6 * unit : 0);
      let y = items.box.y + Math.max(0, (items.box.h - content) / 2);
      if (items.glyph) {
        const entry = items.blocks[0].entry;
        const glyphs = eventGlyphs(entry.type, entry.surface);
        drawGlyphs(ctx, glyphs, middle - glyphsWidth(glyphs.length, items.glyph) / 2, y, items.glyph, inkOf(entry));
        y += items.glyph + 6 * unit;
      }
      ctx.textAlign = "center";
      items.blocks.forEach((block, index) => {
        const height = blockHeight(block, size);
        // A date of another kind keeps its own tint inside the day's, as far above its words as below (D42).
        const tint = tintOf(block.entry);
        if (tint && tint !== cell.tint) {
          const pad = 0.3 * size * unit;
          roundRect(ctx, box.x + 4 * unit, y - pad, box.w - 8 * unit, height + 2 * pad, 8 * unit);
          ctx.fillStyle = palette[tint][0];
          ctx.fill();
        } else if (index > 0) {
          ctx.strokeStyle = palette.line;
          ctx.lineWidth = 2 * unit;
          ctx.beginPath();
          ctx.moveTo(middle - items.box.w * 0.3, y - between(size) / 2);
          ctx.lineTo(middle + items.box.w * 0.3, y - between(size) / 2);
          ctx.stroke();
        }
        ctx.fillStyle = palette.cellInk;
        ctx.font = face(size, 700);
        for (const text of block.lines) {
          y += lineOf(size);
          ctx.fillText(text, middle, y - size * 0.22 * unit);
        }
        ctx.font = face(note, block.entry.cancelled ? 700 : 500);
        ctx.fillStyle = block.entry.cancelled ? palette.special[1] : palette.title;
        for (const text of block.notes) {
          y += noteLineOf(note);
          ctx.fillText(text, middle, y - note * 0.3 * unit);
        }
        y += between(size);
      });
      ctx.textAlign = "left";
      return;
    }
    if (items.chips.length === 0 && items.more === 0) return;
    const size = items.chipSize;
    const line = chipLineOf(size);
    const glyph = chipGlyph(size);
    const lines = items.inline ? items.chips.map((entry) => [entry]) : chipLines(items.chips, items.box.w, size);
    // «+2 altele» after the last chips when it fits there, else on a line of its own.
    const moreInline = items.more > 0 && lines.length > 0 && !items.inline && moreFits(lines[lines.length - 1], items.more, items.box.w, size);
    ctx.font = face(Math.max(size, floor.title), 700);
    const moreW = items.more > 0 ? ctx.measureText(moreText(items.more)).width + 8 * unit : 0;
    let y = items.box.y + Math.max(0, (items.box.h - (lines.length + (items.more && !moreInline ? 1 : 0)) * line) / 2);
    lines.forEach((chips, row) => {
      const trailing = moreInline && row === lines.length - 1 ? moreW : 0;
      const width = chips.reduce((sum, entry) => sum + chipWidth(entry, size), 0) + (chips.length - 1) * 8 * unit + trailing;
      let x = items.inline ? items.box.x : middle - width / 2;
      for (const entry of chips) {
        const ink = entry.cancelled ? palette.special[1] : inkOf(entry);
        drawGlyphs(ctx, eventGlyphs(entry.type, null), x, y + (line - glyph) / 2, glyph, ink);
        ctx.font = face(size, 700);
        ctx.fillStyle = entry.cancelled ? palette.special[1] : palette.title;
        ctx.fillText(chipText(entry), x + glyph + 4 * unit, y + line / 2 + size * 0.36 * unit);
        x += chipWidth(entry, size) + 8 * unit;
        if (items.inline) {
          // A title, at a title's floor even beside a chip at an hour's.
          ctx.font = face(Math.max(size, floor.title), 700);
          const title = fits(upper(entry.title), items.box.x + items.box.w - x) ? upper(entry.title) : ellipsize(upper(entry.title), items.box.x + items.box.w - x);
          ctx.fillStyle = palette.cellInk;
          // Not a stub of three letters, unless it is a whole word: «5K…» is drawn, «MA…» is not.
          const atWord = title.endsWith("…") && /^[^\p{L}\p{N}]/u.test(upper(entry.title).slice(title.length - 1));
          if ([...title].length > 3 || atWord) ctx.fillText(title, x, y + line / 2 + size * 0.36 * unit);
        }
      }
      if (trailing) {
        ctx.font = face(Math.max(size, floor.title), 700);
        ctx.fillStyle = palette.cellInk;
        ctx.fillText(moreText(items.more), x, y + line / 2 + size * 0.36 * unit);
      }
      y += line;
    });
    if (items.more && !moreInline && y + line <= items.box.y + items.box.h + inset) {
      ctx.textAlign = "center";
      ctx.font = face(Math.max(size, floor.title), 700);
      ctx.fillStyle = palette.cellInk;
      ctx.fillText(fitText(ctx, moreText(items.more), items.box.w), middle, y + line / 2 + size * 0.36 * unit);
      ctx.textAlign = "left";
    }
  }

  function drawStrip(strip: StripPlan, x: number, y: number, w: number) {
    const look = laneLook(strip.lane);
    roundRect(ctx, x, y, w, strip.h, 12 * unit);
    ctx.fillStyle = look.fill;
    ctx.fill();
    if (look.stroke) {
      ctx.strokeStyle = look.stroke;
      ctx.lineWidth = 2.5 * unit;
      ctx.stroke();
    }
    const middle = x + w / 2;
    let lineY = y + 9 * unit;
    ctx.textAlign = "center";
    ctx.fillStyle = look.ink;
    ctx.font = face(strip.size, 700);
    for (const text of strip.lines) {
      lineY += lineOf(strip.size);
      ctx.fillText(text, middle, lineY - strip.size * 0.22 * unit);
    }
    lineY += 2 * unit;
    ctx.font = face(strip.note, 500);
    const { glyphs } = strip;
    if (strip.above) {
      drawGlyphs(ctx, glyphs, middle - glyphsWidth(glyphs.length, strip.glyph) / 2, lineY + 2 * unit, strip.glyph, look.ink);
      lineY += strip.glyph + 4 * unit;
    }
    strip.notes.forEach((text, index) => {
      if (index === 0 && !strip.above) {
        // The series' glyphs before its hour, the two centred together.
        const glyphW = glyphsWidth(glyphs.length, strip.glyph) + 6 * unit;
        const left = middle - (glyphW + ctx.measureText(text).width) / 2;
        drawGlyphs(ctx, glyphs, left, lineY + (noteLineOf(strip.note) - strip.glyph) / 2, strip.glyph, look.ink);
        ctx.textAlign = "left";
        ctx.fillText(text, left + glyphW, lineY + noteLineOf(strip.note) - strip.note * 0.3 * unit);
        ctx.textAlign = "center";
      } else ctx.fillText(text, middle, lineY + noteLineOf(strip.note) - strip.note * 0.3 * unit);
      lineY += noteLineOf(strip.note);
    });
    ctx.textAlign = "left";
  }

  // ---- The legend: every special date in day order, and a series no head holds, in rows of their own.
  const laneSample = (lane: PosterLane): Mark => ({ lane, entry: { cancelled: false, time: lane.time } });
  const inner = 12 * unit;
  const gutter = 18 * unit;
  const badgeOf = (size: number) => size * 2.1 * unit;
  const legendGlyph = (size: number) => Math.max(floor.glyph, noteSizeOf(size) * 1.15) * unit;
  const headingH = (size: number) => size * 1.9 * unit + 8 * unit;
  /**
   * An item `w` wide at `size`: the day's badge or the series' pill, then the title whole, then the hour or the
   * rhythm with the details — on `spare` lines more. Null when it does not fit. Kept: the places tried measure
   * the same items at the same widths again.
   */
  const measured = new Map<object, Map<string, { h: number; lines: string[]; notes: string[] } | null>>();
  function measureItem(item: Exclude<LegendItem, { kind: "title" }>, w: number, size: number, spare: number): { h: number; lines: string[]; notes: string[] } | null {
    const owner = item.kind === "date" ? item.entry : item.lane;
    const key = `${Math.round(w * 4)}|${size}|${spare}`;
    const known = measured.get(owner)?.get(key);
    if (known !== undefined) return known;
    const note = noteSizeOf(size);
    const date = item.kind === "date" ? item.entry : null;
    const sample = item.kind === "lane" ? pillAt(laneSample(item.lane), note, 2) : null;
    const room = w - (sample ? sample.w : badgeOf(size)) - 10 * unit;
    let result: { h: number; lines: string[]; notes: string[] } | null = null;
    if (room >= size * 4 * unit) {
      ctx.font = face(size, 700);
      const lines = wrapBalanced(ctx, upper(date ? date.title : item.kind === "lane" ? item.lane.title : ""), room, { hyphenate: true });
      const whole = lines.every((line) => fits(line, room));
      const glyphW = date ? glyphsWidth(eventGlyphs(date.type, date.surface).length, legendGlyph(size)) + 6 * unit : 0;
      ctx.font = face(note, 500);
      const notes = !whole ? null : date ? noteLines([hourOf(date)], detailsOf(date), room - glyphW, spare) : item.kind === "lane" ? noteLines([item.lane.sentence], detailsOf(item.lane.details), room, spare) : null;
      if (notes) {
        const height = lines.length * lineOf(size) + notes.length * noteLineOf(note);
        result = { h: Math.max(height, sample ? sample.h : badgeOf(size)) + 10 * unit, lines, notes };
      }
    }
    if (!measured.has(owner)) measured.set(owner, new Map());
    measured.get(owner)?.set(key, result);
    return result;
  }
  /**
   * The items in `box` at `size`: each heading on a line of its own across the box, then its rows — `columns`
   * items a row, left to right and then down, so the list reads in order (D28) — and the height they take.
   * Null when it does not all fit.
   */
  function flowLegend(items: LegendItem[], box: Box, size: number, columns: number, spare: number): { placed: Placed[]; h: number } | null {
    const placed: Placed[] = [];
    const left = box.x + inner;
    const width = box.w - 2 * inner;
    const colW = (width - (columns - 1) * gutter) / columns;
    const bottom = box.y + box.h - inner;
    let y = box.y + inner;
    for (let index = 0; index < items.length; ) {
      const item = items[index];
      if (item.kind === "title") {
        ctx.font = face(size, 800);
        if (!fits(upper(item.text), width - size * 1.6 * unit) || y + headingH(size) > bottom + 0.5) return null;
        placed.push({ item, x: left, y, w: width, h: headingH(size), lines: [], notes: [] });
        y += headingH(size);
        index += 1;
        continue;
      }
      const row: Exclude<LegendItem, { kind: "title" }>[] = [];
      for (let next = items[index]; row.length < columns && next && next.kind !== "title"; next = items[index]) {
        row.push(next);
        index += 1;
      }
      const sizes = row.map((entry) => measureItem(entry, colW, size, spare));
      if (!sizes.every((entry): entry is NonNullable<typeof entry> => entry !== null)) return null;
      const rowH = Math.max(...sizes.map((entry) => entry.h));
      if (y + rowH > bottom + 0.5) return null;
      sizes.forEach((entry, column) => placed.push({ item: row[column], x: left + column * (colW + gutter), y, w: colW, h: entry.h, lines: entry.lines, notes: entry.notes }));
      y += rowH;
    }
    return { placed, h: y + inner - box.y };
  }
  /** The column counts a legend `w` wide may take at `size`: each column nine of its letters wide at least. */
  const columnsFor = (w: number, size: number) => [1, 2, 3, 4].filter((columns) => columns === 1 || (w - 2 * inner - (columns - 1) * gutter) / columns >= size * 9 * unit);
  /**
   * The largest size, from 26 down to the floor, at which every item fits `box` — the details on a line of
   * their own, else on the hour's alone, before the size goes down — in the fewest columns; null when none does.
   */
  function legendIn(items: LegendItem[], box: Box): Legend | null {
    // For each column count, the largest size it holds — halving the sizes, a smaller size never holding less
    // — then the details on a line of their own there if they fit: the largest size wins, then the details,
    // then the fewer columns.
    const sizes = sizesDown(26 * boost, floor.title).reverse();
    let best: (Legend & { spare: number }) | null = null;
    for (const columns of [1, 2, 3, 4]) {
      const allowed = sizes.filter((size) => columnsFor(box.w, size).includes(columns));
      const at = (index: number) => flowLegend(items, box, allowed[index], columns, 0);
      if (allowed.length === 0 || (best && allowed[allowed.length - 1] < best.size) || !at(0)) continue;
      let low = 0;
      let high = allowed.length - 1;
      if (at(high)) low = high;
      while (low < high) {
        const middle = Math.ceil((low + high) / 2);
        if (at(middle)) low = middle;
        else high = middle - 1;
      }
      const size = allowed[low];
      if (best && (size < best.size || (size === best.size && best.spare === 1))) continue;
      const roomy = flowLegend(items, box, size, columns, 1);
      const flowed = roomy ?? at(low);
      if (flowed && (!best || size > best.size || (roomy && best.spare === 0))) best = { placed: flowed.placed, size, spare: roomy ? 1 : 0 };
    }
    return best && { placed: best.placed, size: best.size };
  }
  /** The least height `items` take `w` wide, at the floor; null when one of them fits no column. */
  function legendHeight(items: LegendItem[], w: number): number | null {
    const heights = columnsFor(w, floor.title).flatMap((columns) => flowLegend(items, { x: 0, y: 0, w, h: Infinity }, floor.title, columns, 0)?.h ?? []);
    return heights.length > 0 ? Math.min(...heights) : null;
  }
  function drawLegend({ placed, size }: Legend) {
    const note = noteSizeOf(size);
    for (const { item, x, y, lines, notes } of placed) {
      if (item.kind === "title") {
        ctx.font = face(size, 800);
        const label = upper(item.text);
        roundRect(ctx, x, y, ctx.measureText(label).width + size * 1.6 * unit, size * 1.9 * unit, size * unit);
        ctx.fillStyle = item.fill;
        ctx.fill();
        ctx.fillStyle = palette.bandInk;
        ctx.fillText(label, x + size * 0.8 * unit, y + size * 0.95 * unit + size * 0.36 * unit);
        continue;
      }
      let leadW: number;
      if (item.kind === "date") {
        // The day on a square of its tint, then the title, then its glyphs, the hour and the details (D32/D36).
        const badge = badgeOf(size);
        leadW = badge;
        const tint = tintOf(item.entry);
        roundRect(ctx, x, y + 2 * unit, badge, badge, 10 * unit);
        ctx.fillStyle = tint ? palette[tint][0] : palette.cellMuted;
        ctx.fill();
        ctx.fillStyle = palette.cellInk;
        ctx.font = face(size * 1.1, 800);
        ctx.textAlign = "center";
        ctx.fillText(String(item.entry.day), x + badge / 2, y + 2 * unit + badge / 2 + size * 1.1 * 0.36 * unit);
        ctx.textAlign = "left";
      } else {
        const pill: Pill = { ...laneSample(item.lane), ...pillAt(laneSample(item.lane), note, 2), above: 0, x, y: y + 2 * unit };
        leadW = pill.w;
        drawPill(pill);
      }
      const textX = x + leadW + 10 * unit;
      let lineY = y;
      ctx.fillStyle = palette.cellInk;
      ctx.font = face(size, 700);
      for (const text of lines) {
        lineY += lineOf(size);
        ctx.fillText(text, textX, lineY - size * 0.2 * unit);
      }
      let noteX = textX;
      if (item.kind === "date") {
        const glyph = legendGlyph(size);
        noteX += drawGlyphs(ctx, eventGlyphs(item.entry.type, item.entry.surface), textX, lineY + (noteLineOf(note) - glyph) / 2, glyph, inkOf(item.entry)) + 6 * unit;
      }
      ctx.font = face(note, 500);
      ctx.fillStyle = item.kind === "date" && item.entry.cancelled ? palette.special[1] : palette.title;
      for (const text of notes) {
        lineY += noteLineOf(note);
        ctx.fillText(text, noteX, lineY - note * 0.3 * unit);
      }
    }
  }

  const irregular = plan.lanes.filter((lane) => !lane.inHeads);
  const allDates = [...plan.dates.values()].flat().sort((a, b) => a.day - b.day || (a.time ?? "99").localeCompare(b.time ?? "99"));
  const itemsOf = (dates: CalendarImageEntry[]): LegendItem[] => [
    ...(irregular.length > 0 ? [{ kind: "title" as const, text: data.words.recurringTitle, fill: palette.band }, ...irregular.map((lane) => ({ kind: "lane" as const, lane }))] : []),
    ...(dates.length > 0 ? [{ kind: "title" as const, text: data.words.specialTitle, fill: palette.special[1] }, ...dates.map((entry) => ({ kind: "date" as const, entry }))] : []),
  ];
  const legendItems = itemsOf(allDates);
  // Where the legend goes, of the places it may (D11/D12/D35): the empty days at the month's end or at its
  // start as they are; the month's last week grown for it; beside the grid on a wide picture, or in a strip
  // under it on a tall one. In each, every special date when they all fit, else the race, the dates not
  // written whole over their hours in their days and a series no head holds, else as many of those as fit, the
  // race first. Of the places that hold every date, or of all when none does, the one that costs the month
  // least: a «+2 altele» or a chip no list names far worst, then a race's title shortened where another date's
  // is whole, a title shortened, an hour left out; a little the room taken from the weeks, a date the list
  // leaves out though it is whole in its day, a smaller size, the month's start.
  const runs = (regions: Region[]) => [...regions].reverse().filter((candidate) => candidate.to - candidate.from >= 3);
  const natural = layoutGrid(area) as Layout;
  type Choice = { layout: Layout; legend: Legend | null; strip: Box | null; region: Region | null; full: boolean; cost: number };
  const costOf = (layout: Layout, legend: Legend | null, taken: number, start: boolean) => {
    const dates = new Set(legend?.placed.flatMap((placed) => (placed.item.kind === "date" ? [placed.item.entry] : [])));
    const lanes = new Set(legend?.placed.flatMap((placed) => (placed.item.kind === "lane" ? [placed.item.lane] : [])));
    let cost = layout.loss + (10 * taken) / (area.w * area.h) + irregular.filter((lane) => !lanes.has(lane)).length * 200;
    for (const entry of allDates) {
      if (dates.has(entry)) continue;
      const state = layout.stateOf(entry);
      cost += state === "whole" ? 12 : state === "hourless" ? 30 : state === "cut" ? 100 : 1000;
    }
    return cost + (legend ? (26 * boost - legend.size) * 0.1 + (start ? 5 : 0) : 0);
  };
  // A strip under the grid while the month's last empty days hold only the mountains wastes them (D35).
  const wasted = runs(natural.regions).some((region) => region.row === lastRow) ? 20 : 0;
  const choices: Choice[] = [{ layout: natural, legend: null, strip: null, region: null, full: false, cost: options.legend ? costOf(natural, null, 0, false) : 0 }];
  if (options.legend && legendItems.length > 0) {
    // A list never leaves out the month's race; shortened, it keeps the races, then the special dates, then the
    // others — the rank of a day's «+2 altele» — each kept date in its day's order on the page.
    const rank = (entry: CalendarImageEntry) => (isRace(entry) ? 0 : tintOf(entry) === "special" ? 1 : 2);
    const races = allDates.filter(isRace).length;
    /** What the list must say in `layout`: the races, the dates not whole over their hours there, and a series no head holds. */
    const neededOf = (layout: Layout) => allDates.filter((entry) => isRace(entry) || layout.stateOf(entry) !== "whole");
    const neededIn = (layout: Layout) => itemsOf(neededOf(layout));
    const consider = (layout: Layout | null, place: { region?: Region; strip?: Box }, taken: number, extra = 0) => {
      const box = place.region?.box ?? place.strip;
      if (!layout || !box) return;
      const whole = legendIn(legendItems, box);
      const needed = neededOf(layout);
      let legend = whole ?? (needed.length < allDates.length && itemsOf(needed).length > 0 ? legendIn(itemsOf(needed), box) : null);
      const ranked = [...needed].sort((a, b) => rank(a) - rank(b));
      for (let kept = needed.length - 1; !legend && kept >= Math.max(races, irregular.length > 0 ? 0 : 1); kept -= 1) {
        const items = itemsOf(allDates.filter((entry) => ranked.slice(0, kept).includes(entry)));
        const flowed = columnsFor(box.w, floor.title).map((columns) => flowLegend(items, box, floor.title, columns, 0)).find((found) => found !== null);
        if (flowed) legend = { placed: flowed.placed, size: floor.title };
      }
      if (legend) choices.push({ layout, legend, strip: place.strip ?? null, region: place.region ?? null, full: whole !== null, cost: costOf(layout, legend, taken, place.region?.row === 0) + extra });
    };
    for (const region of runs(natural.regions)) consider(natural, { region }, 0);
    const trailingOf = (layout: Layout | null) => (layout ? runs(layout.regions).find((region) => region.row === lastRow) : undefined);
    const trailing = trailingOf(natural);
    if (trailing) {
      // The last week as tall as the whole list needs, or as the dates not whole need — gathered again once
      // the room the list takes has shortened more of them.
      const tried = new Set<number>();
      const grow = (items: LegendItem[], rounds: number) => {
        const height = legendHeight(items, trailing.box.w);
        if (height === null || height <= trailing.box.h + 0.5 || height > area.h * 0.5 || tried.has(Math.round(height))) return;
        tried.add(Math.round(height));
        const grown = layoutGrid(area, height);
        consider(grown, { region: trailingOf(grown) }, (height - trailing.box.h) * trailing.box.w);
        if (grown && rounds > 0) grow(neededIn(grown), rounds - 1);
      };
      grow(legendItems, 0);
      grow(neededIn(natural), 2);
    }
    if (W > H) {
      const besideW = clamp(area.w * 0.25, 360 * unit, 560 * unit);
      consider(layoutGrid({ ...area, w: area.w - besideW - gap }), { strip: { x: area.x + area.w - besideW, y: area.y, w: besideW, h: area.h } }, (besideW + gap) * area.h);
    } else {
      for (const items of [legendItems, neededIn(natural)]) {
        const height = items.length > 0 ? legendHeight(items, area.w) : null;
        if (height === null || height > area.h * 0.42) continue;
        consider(layoutGrid({ ...area, h: area.h - height - gap }), { strip: { x: area.x, y: area.y + area.h - height, w: area.w, h: height } }, (height + gap) * area.w, wasted);
      }
    }
  }
  // The whole list wherever a place holds it: of those places, the one that costs the month least.
  const listed = choices.filter((choice) => choice.full);
  const chosen = (listed.length > 0 ? listed : choices).reduce((best, next) => (next.cost < best.cost - 1e-6 ? next : best));
  const layout = chosen.layout;
  const legend = chosen.legend && { ...chosen.legend, strip: chosen.strip, region: chosen.region };

  const { grid, cellW, labelSize, labelH, groups, groupOf, colTop, heightOf, rowTop, numSize } = layout;
  roundRect(ctx, grid.x, grid.y, grid.w, grid.h, 18 * unit);
  ctx.fillStyle = palette.cell;
  ctx.fill();
  ctx.save();
  ctx.clip();
  // The weekdays' row, pale across; under a head with series its tab, as tall as its strips and no taller.
  ctx.fillStyle = palette.cellMuted;
  ctx.fillRect(grid.x, grid.y, grid.w, labelH);
  for (const group of groups) ctx.fillRect(grid.x + group.from * cellW, grid.y + labelH - 0.5 * unit, (group.to - group.from + 1) * cellW, group.h + 0.5 * unit);
  // The weekday a strip belongs to wears the strip's colour down to it, so a strip widened over a free head
  // still reads as its own weekday's.
  for (const group of groups) {
    const look = laneLook(group.strips[0].lane);
    roundRect(ctx, grid.x + group.home * cellW + 5 * unit, grid.y + 6 * unit, cellW - 10 * unit, labelH + 7 * unit, 10 * unit);
    ctx.fillStyle = look.fill;
    ctx.fill();
    if (look.stroke) {
      ctx.strokeStyle = look.stroke;
      ctx.lineWidth = 2.5 * unit;
      ctx.stroke();
    }
  }
  ctx.textAlign = "center";
  ctx.font = face(labelSize, 800);
  data.words.weekdaysLong.forEach((name, column) => {
    const home = groups.find((group) => group.home === column);
    ctx.fillStyle = home ? laneLook(home.strips[0].lane).ink : palette.title;
    ctx.fillText(fitText(ctx, upper(name), cellW - 14 * unit), grid.x + column * cellW + cellW / 2, grid.y + labelH / 2 + labelSize * 0.36 * unit);
  });
  ctx.textAlign = "left";
  for (const group of groups) {
    let y = grid.y + labelH + 5 * unit;
    for (const strip of group.strips) {
      drawStrip(strip, grid.x + group.from * cellW + stripInset, y, (group.to - group.from + 1) * cellW - 2 * stripInset);
      y += strip.h + 6 * unit;
    }
  }
  layout.cells.forEach((cell) => drawCell(cell, numSize));

  // The empty days: the legend when it went there, else the mountains, as the poster draws them.
  const merged = layout.regions.filter((region) => region.to - region.from >= 3);
  for (const region of merged) {
    if (legend?.region === region) continue;
    const box = region.box;
    const h = Math.min(box.h * 0.8, (box.w * MOUNTAIN_MARK_VIEWBOX.height) / MOUNTAIN_MARK_VIEWBOX.width);
    ctx.save();
    ctx.translate(box.x, box.y + box.h - h);
    ctx.scale(box.w / MOUNTAIN_MARK_VIEWBOX.width, h / MOUNTAIN_MARK_VIEWBOX.height);
    ctx.fillStyle = palette.line;
    ctx.globalAlpha = 0.6;
    ctx.fill(new Path2D(FAR));
    ctx.globalAlpha = 0.9;
    ctx.fill(new Path2D(NEAR));
    ctx.restore();
  }
  if (legend?.region) drawLegend(legend);

  // The grid's lines over the cells: under each head its foot — the label's, or its tab's — none inside a
  // tab, and none across the empty days drawn as one.
  const inside = (row: number, column: number) => merged.some((region) => region.row === row && region.from < column && column < region.to);
  ctx.strokeStyle = palette.line;
  ctx.lineWidth = 2 * unit;
  ctx.beginPath();
  for (let column = 0; column < 7; column += 1) {
    const x = grid.x + column * cellW;
    ctx.moveTo(x, grid.y + colTop(column));
    ctx.lineTo(x + cellW, grid.y + colTop(column));
    if (column === 0) continue;
    const same = groupOf(column) !== undefined && groupOf(column) === groupOf(column - 1);
    const top = grid.y + (same ? colTop(column) : labelH);
    const bottom = inside(0, column) ? grid.y + Math.max(colTop(column), colTop(column - 1)) : grid.y + labelH + heightOf(0);
    if (bottom > top) {
      ctx.moveTo(x, top);
      ctx.lineTo(x, bottom);
    }
  }
  for (let row = 1; row < weeks.length; row += 1) {
    const y = rowTop(row);
    ctx.moveTo(grid.x, y);
    ctx.lineTo(grid.x + grid.w, y);
    for (let column = 1; column < 7; column += 1) {
      if (inside(row, column)) continue;
      ctx.moveTo(grid.x + column * cellW, y);
      ctx.lineTo(grid.x + column * cellW, y + heightOf(row));
    }
  }
  ctx.stroke();
  ctx.restore();
  roundRect(ctx, grid.x, grid.y, grid.w, grid.h, 18 * unit);
  ctx.strokeStyle = palette.line;
  ctx.lineWidth = 3 * unit;
  ctx.stroke();

  if (legend?.strip) {
    const strip = legend.strip;
    roundRect(ctx, strip.x, strip.y, strip.w, strip.h, 18 * unit);
    // A cell's colour under the words, so a palette whose page is not the cell's colour keeps them readable.
    ctx.fillStyle = palette.cell;
    ctx.fill();
    ctx.strokeStyle = palette.line;
    ctx.lineWidth = 3 * unit;
    ctx.stroke();
    drawLegend(legend);
  }
}
