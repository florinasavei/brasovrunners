import type { CalendarImagePalette } from "@/theme/brand";
import { FAR, MOUNTAIN_MARK_VIEWBOX, NEAR } from "@/shared/ui/MountainMark";
import { SOCIAL_MARKS } from "@/shared/ui/SocialIcon";
import { type Box, CALENDAR_IMAGE_RATIOS, type Ctx, drawGlyphs, eventGlyphs, fillSpaced, fitText, glyphsWidth, LOGO_RATIO, roundRect, wrapText } from "./calendar-image-canvas";
import type { CalendarImageAssets, CalendarImageFonts, CalendarImageOptions } from "./calendar-image-draw";
import { monthGrid, type YearMonth } from "../domain/calendar";
import type { CalendarTone } from "../domain/calendar-kind";
import type { EventSurface, EventType } from "../domain/event-type";
import type { CalendarImageData, CalendarImageEntry } from "../domain/calendar-image";

/**
 * «Afiș», «Așezare» → «Seriile în cap» (`heads`, the default): each weekly series written once, under its
 * weekday's column head; its dates are only their marks, and the special dates are listed in the empty days.
 */

/**
 * `text` broken at spaces into as many lines of `width` as it takes, a dash kept with the word before it.
 * A word wider than a line alone makes it null — or, with `hyphenate`, is split with «-» where it must be,
 * so the words stay whole rather than cut.
 */
export function wrapWhole(ctx: Ctx, text: string, width: number, hyphenate = false): string[] | null {
  const words = text
    .replace(/\s+([—–-])\s+/g, "\u00a0$1 ")
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

/** A series as «Afiș» draws it (§855): written once, in its weekday's column head, each date a mark. */
export type PosterLane = {
  title: string;
  type: EventType;
  surface: EventSurface | null;
  tone: CalendarTone;
  /** «În fiecare marți și joi, la 18:30» — the legend's line for a series no head can hold. */
  sentence: string;
  /** Its weekday's column, Monday 0, when every ordinary date falls on that weekday; null when they do not. */
  column: number | null;
  /** The hour most of its dates keep, «19:30»; null when none has one. */
  time: string | null;
  /** Filled, outlined or deep: how its strip and its marks are drawn, so two series in one column read apart. */
  variant: number;
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

/**
 * «Afiș»'s month (§855; the owner, 2026-10-27: «I need to organize it better and use the space more
 * efficiently»): the rhythm belongs to the weekday. A series whose dates share a weekday is written once, in
 * that column's head; each of its dates is a mark with the hour. A series on two weekdays keeps its marks
 * and gets a legend line. Everything else is written in full in its day.
 */
export function posterPlan(data: CalendarImageData): PosterPlan {
  const lanes: PosterLane[] = [];
  const byKey = new Map<string, PosterLane>();
  const touched = new Map<PosterLane, Set<number>>();
  for (const row of data.recurring) {
    const key = laneKey(row.type, row.title);
    const ordinary = data.entries.filter((entry) => !entry.special && laneKey(entry.type, entry.title) === key);
    if (ordinary.length === 0 || byKey.has(key)) continue;
    const columns = new Set(ordinary.map((entry) => weekdayColumn(data.month, entry.day)));
    const lane: PosterLane = { title: row.title, type: row.type, surface: row.surface, tone: row.tone, sentence: row.sentence, column: columns.size === 1 ? [...columns][0] : null, time: commonHour(ordinary), variant: 0 };
    lanes.push(lane);
    byKey.set(key, lane);
    touched.set(lane, columns);
  }
  // In one column the earlier hour comes first, each series in the next look.
  const byHour = (a: PosterLane, b: PosterLane) => (a.time ?? "99").localeCompare(b.time ?? "99");
  for (let column = 0; column < 7; column += 1) {
    lanes
      .filter((lane) => lane.column === column)
      .sort(byHour)
      .forEach((lane, index) => {
        lane.variant = index % 3;
      });
  }
  // A series off the heads takes a look no series of its weekdays wears.
  for (const lane of lanes.filter((candidate) => candidate.column === null)) {
    const columns = touched.get(lane) ?? new Set<number>();
    const worn = new Set(lanes.filter((other) => other !== lane && (other.column !== null || lanes.indexOf(other) < lanes.indexOf(lane)) && [...(touched.get(other) ?? [])].some((column) => columns.has(column))).map((other) => other.variant));
    lane.variant = [0, 1, 2].find((variant) => !worn.has(variant)) ?? 0;
  }
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

/** A series' date as a mark: its series, and whether it is cancelled and at what hour. */
type Mark = { lane: PosterLane; entry: Pick<CalendarImageEntry, "cancelled" | "time"> };
/** A mark placed: a pill with the glyph and the hour, or — `above` set, in a tall day — the glyph large over a pill with the hour. */
type PillPlan = Mark & { x: number; y: number; w: number; h: number; size: number; above?: number };
type Block = { entry: CalendarImageEntry; lines: string[]; hour: string };
type CellPlan = {
  day: number;
  box: Box;
  numSize: number;
  tint: "special" | "other" | null;
  pills: PillPlan[];
  /**
   * The dates written in full (`blocks`); where a day has no room for that, `chips` — glyph and hour — each
   * on a line with as much of its title as the width holds when `inline`, else side by side.
   */
  items: { box: Box; size: number; blocks: Block[]; chips: CalendarImageEntry[]; inline: boolean; more: number; glyph: number };
};
type StripPlan = { lane: PosterLane; lines: string[]; h: number };
type Region = { row: number; from: number; to: number; box: Box };
type LegendItem = { kind: "title"; text: string; fill: string } | { kind: "lane"; lane: PosterLane } | { kind: "date"; entry: CalendarImageEntry };
type Placed = { item: LegendItem; x: number; y: number; w: number; h: number; lines: string[]; notes: string[] };

/**
 * «Afiș» (§855; the owner, 2026-10-27: «vreau să semene cu ce mi-a dat Amalia», then «I need to organize it
 * better and use the space more efficiently») — the club's hand-made monthly poster, its parts rearranged
 * so the month gets the room: a slim blue band, the logo at one end and «EVENIMENTE · IUNIE 2026» at the
 * other; the weekdays in capitals as the column heads, and under a head each series of that weekday once,
 * on its own coloured strip with its whole title and its hour; in the days, a series' date is only its
 * mark — the glyph and the hour, or «Anulat» — and the dates that are not routine are written in full, in
 * capitals, with «ora 18:00», a special one's day pale pink and a social one's pale yellow; the special
 * events listed in the empty days before the first or after the last when they fit there — or, when a title
 * had to be shortened in its day, beside the grid on a wide picture and in a slim strip under it on a tall
 * one; the mountains across empty days nothing else needs; and «URMĂREȘTE-NE!» with the club's networks and
 * its tags on a blue band at the foot. Every size follows the picture's or the day's, so the four formats,
 * five- and six-week months, and a month of two dates or of three a day are one drawing.
 */
export function drawPosterHeads(ctx: CanvasRenderingContext2D, data: CalendarImageData, options: CalendarImageOptions, fonts: CalendarImageFonts, assets: CalendarImageAssets, palette: CalendarImagePalette): void {
  const { width: W, height: H } = CALENDAR_IMAGE_RATIOS[options.ratio];
  const unit = Math.min(W, H) / 1080;
  const pad = 32 * unit;
  const gap = 14 * unit;
  const px = (size: number) => Math.round(size * unit);
  // One geometric family throughout (the owner, 2026-10-27, of the hand-written «Evenimente» over Roboto:
  // «the font is pretty ugly»): italic Black for the month, ExtraBold for the labels and the day numbers,
  // Bold for the titles, Medium for «EVENIMENTE», the hours and the notes.
  const face = (size: number, weight: number) => `${weight} ${px(size)}px ${fonts.poster}`;
  const upper = (text: string) => text.toLocaleUpperCase("ro-RO");
  const plan = posterPlan(data);
  const hourOf = (entry: CalendarImageEntry) => (entry.cancelled ? data.words.cancelled : entry.time ? data.words.at.replace("{time}", entry.time) : "");
  /** A special date's day pale pink, a social one's pale yellow, as the poster marks them; a lone run stays white. */
  const tintOf = (entry: CalendarImageEntry): "special" | "other" | null => (entry.tone === "other" ? "other" : entry.tone === "special" || entry.special ? "special" : null);
  const inkOf = (entry: CalendarImageEntry) => (tintOf(entry) ? palette[tintOf(entry) ?? "special"][1] : palette.title);
  ctx.textBaseline = "alphabetic";
  ctx.textAlign = "left";
  // The page: the palette's two stops, top to bottom (one colour on «Afiș»).
  const page = ctx.createLinearGradient(0, 0, 0, H);
  page.addColorStop(0, palette.background[0]);
  page.addColorStop(1, palette.background[1]);
  ctx.fillStyle = page;
  ctx.fillRect(0, 0, W, H);

  // The band, one line: the club's real logo at the left (or, until it loads, the mountains over the
  // spaced name), and at the right «EVENIMENTE» in spaced capitals over the month in italic Black, its year
  // beside it lighter.
  const bandH = clamp(H * 0.105, 118 * unit, 180 * unit);
  roundRect(ctx, pad, pad, W - 2 * pad, bandH, 24 * unit);
  ctx.fillStyle = palette.band;
  ctx.fill();
  ctx.fillStyle = palette.bandInk;
  const bandInset = bandH * 0.15;
  const logoH = bandH - 2 * bandInset;
  const logoW = logoH * LOGO_RATIO;
  const logoX = pad + bandInset * 1.6;
  if (assets.logo) {
    ctx.drawImage(assets.logo, logoX, pad + bandInset, logoW, logoH);
  } else {
    const nameSize = (logoH / unit) * 0.17;
    const markH = logoH - nameSize * 1.7 * unit;
    const markW = (markH * MOUNTAIN_MARK_VIEWBOX.width) / MOUNTAIN_MARK_VIEWBOX.height;
    ctx.save();
    ctx.translate(logoX + (logoW - markW) / 2, pad + bandInset);
    ctx.scale(markW / MOUNTAIN_MARK_VIEWBOX.width, markH / MOUNTAIN_MARK_VIEWBOX.height);
    ctx.globalAlpha = 0.55;
    ctx.fill(new Path2D(FAR));
    ctx.globalAlpha = 1;
    ctx.fill(new Path2D(NEAR));
    ctx.restore();
    ctx.font = face(nameSize, 500);
    fillSpaced(ctx, upper(data.clubName), logoX + logoW / 2, pad + bandH - bandInset, px(nameSize * 0.35), logoW);
  }
  const bandRight = W - pad - bandInset * 1.8;
  const bandRoom = bandRight - (logoX + logoW + bandInset * 2);
  const monthText = upper(data.words.monthName);
  const yearText = ` ${data.month.year}`;
  const monthPair = (size: number) => {
    ctx.font = `italic ${face(size, 900)}`;
    const monthW = ctx.measureText(monthText).width;
    ctx.font = `italic ${face(size * 0.56, 500)}`;
    return { size, monthW, width: monthW + ctx.measureText(yearText).width };
  };
  let month = monthPair((bandH / unit) * 0.52);
  if (month.width > bandRoom) month = monthPair((month.size * bandRoom) / month.width);
  const kickerSize = Math.max(14, month.size * 0.29);
  const capK = kickerSize * 0.7 * unit;
  const capM = month.size * 0.7 * unit;
  const between = kickerSize * 0.6 * unit;
  const blockTop = pad + (bandH - capK - between - capM) / 2;
  const monthY = blockTop + capK + between + capM;
  ctx.font = `italic ${face(month.size, 900)}`;
  ctx.fillText(monthText, bandRight - month.width, monthY);
  ctx.font = `italic ${face(month.size * 0.56, 500)}`;
  ctx.globalAlpha = 0.8;
  ctx.fillText(yearText, bandRight - month.width + month.monthW, monthY);
  ctx.globalAlpha = 1;
  ctx.font = face(kickerSize, 500);
  const kicker = upper(data.words.heading);
  const tracking = px(kickerSize * 0.42);
  const kickerW = [...kicker].reduce((sum, letter) => sum + ctx.measureText(letter).width, 0) + tracking * ([...kicker].length - 1);
  fillSpaced(ctx, kicker, bandRight - Math.min(kickerW, bandRoom) / 2, blockTop + capK, tracking, bandRoom);

  // The foot: «URMĂREȘTE-NE!», each network the club has with its name, then the tags.
  const footH = 64 * unit;
  const footY = H - pad - footH;
  roundRect(ctx, pad, footY, W - 2 * pad, footH, 18 * unit);
  ctx.fillStyle = palette.band;
  ctx.fill();
  // Each network beside the club's name while the band holds it; past that, the marks alone — four
  // networks with the name four times overflowed a 1080-pixel band and cut the call and the tags.
  const withNames: { text: string; mark?: keyof typeof SOCIAL_MARKS; weight: number }[] = [
    { text: upper(data.words.follow) + "!", weight: 800 },
    ...data.socials.map((network) => ({ text: data.clubName, mark: network, weight: 500 })),
    { text: data.words.hashtags, weight: 500 },
  ];
  const marksOnly = withNames.map((item) => (item.mark ? { ...item, text: "" } : item));
  const markSize = 28 * unit;
  const room = W - 2 * pad - 40 * unit;
  // Each word measured in the weight it is drawn in.
  const widthOf = (items: typeof withNames, size: number) =>
    items.reduce((sum, item) => {
      ctx.font = face(size, item.weight);
      return sum + (item.text ? ctx.measureText(item.text).width : 0) + (item.mark ? markSize + (item.text ? 10 * unit : 0) : 0);
    }, 0) +
    (items.length - 1) * 30 * unit;
  const footItems = widthOf(withNames, 20) <= room ? withNames : marksOnly;
  let footSize = 24;
  while (footSize > 14 && widthOf(footItems, footSize) > room) footSize -= 1;
  let footX = (W - widthOf(footItems, footSize)) / 2;
  for (const item of footItems) {
    if (item.mark) {
      ctx.save();
      ctx.translate(footX, footY + (footH - markSize) / 2);
      ctx.scale(markSize / 24, markSize / 24);
      ctx.fillStyle = palette.bandInk;
      ctx.fill(new Path2D(SOCIAL_MARKS[item.mark].path));
      ctx.restore();
      footX += markSize + (item.text ? 10 * unit : 0);
    }
    ctx.font = face(footSize, item.weight);
    ctx.fillStyle = palette.bandInk;
    if (item.text) ctx.fillText(item.text, footX, footY + footH / 2 + footSize * 0.36 * unit);
    footX += (item.text ? ctx.measureText(item.text).width : 0) + 30 * unit;
  }

  // ---- The marks: a series' date as its glyph and its hour on a pill of the series' look.
  const laneLook = (lane: PosterLane) => {
    const base = lane.tone === "special" ? palette.special[1] : lane.tone === "other" ? palette.other[1] : palette.band;
    const onBase = palette.bandInk;
    const looks = [
      { fill: base, ink: onBase, stroke: null },
      { fill: palette.cell, ink: base, stroke: base },
      { fill: palette.cellInk, ink: palette.bandInk, stroke: null },
    ];
    return looks[lane.variant % looks.length];
  };
  const markText = (entry: Mark["entry"]) => (entry.cancelled ? upper(data.words.cancelled) : (entry.time ?? ""));
  const pillSize = (mark: Mark, size: number, withGlyph = true) => {
    const text = markText(mark.entry);
    ctx.font = face(size, 700);
    const glyph = mark.entry.cancelled || !withGlyph ? 0 : glyphsWidth(eventGlyphs(mark.lane.type, mark.lane.surface).length, size * 1.15 * unit);
    const textW = text ? ctx.measureText(text).width : 0;
    return { w: size * 1.1 * unit + glyph + (glyph && textW ? size * 0.3 * unit : 0) + textW, h: size * 1.75 * unit };
  };
  function drawPill(pill: PillPlan) {
    const look = pill.entry.cancelled ? { fill: palette.cellMuted, ink: palette.title, stroke: null } : laneLook(pill.lane);
    const glyphs = eventGlyphs(pill.lane.type, pill.lane.surface);
    if (pill.above) drawGlyphs(ctx, glyphs, pill.x + (pill.w - glyphsWidth(glyphs.length, pill.above)) / 2, pill.y - (pill.h > 0 ? 6 * unit : 0) - pill.above, pill.above, look.stroke ?? look.fill);
    if (pill.h === 0) return;
    roundRect(ctx, pill.x, pill.y, pill.w, pill.h, pill.h / 2);
    ctx.fillStyle = look.fill;
    ctx.fill();
    if (look.stroke) {
      ctx.strokeStyle = look.stroke;
      ctx.lineWidth = 2.5 * unit;
      ctx.stroke();
    }
    let x = pill.x + pill.size * 0.55 * unit;
    if (!pill.entry.cancelled && !pill.above) {
      const glyph = pill.size * 1.15 * unit;
      x += drawGlyphs(ctx, glyphs, x, pill.y + (pill.h - glyph) / 2, glyph, look.ink) + pill.size * 0.3 * unit;
    }
    const text = markText(pill.entry);
    if (text) {
      ctx.font = face(pill.size, 700);
      ctx.fillStyle = look.ink;
      ctx.fillText(text, x, pill.y + pill.h / 2 + pill.size * 0.36 * unit);
    }
  }

  // ---- The days' words: each date not routine, written whole at the largest size its day holds.
  const lineOf = (size: number) => size * 1.13 * unit;
  const hourSizeOf = (size: number) => Math.max(14, size * 0.8);
  const blocksHeight = (blocks: Block[], size: number) =>
    blocks.reduce((sum, block) => sum + block.lines.length * lineOf(size) + (block.hour ? hourSizeOf(size) * 1.3 * unit : 0), 0) + Math.max(0, blocks.length - 1) * size * 0.75 * unit;
  /** A date too long for its day as a chip: its glyph and its hour, or «ANULAT», in its kind's colour. */
  const chipText = (entry: CalendarImageEntry) => (entry.cancelled ? upper(data.words.cancelled) : (entry.time ?? ""));
  const chipWidth = (entry: CalendarImageEntry, size: number) => {
    ctx.font = face(size, 700);
    const text = chipText(entry);
    return glyphsWidth(eventGlyphs(entry.type, entry.surface).length, size * unit) + (text ? 3 * unit + ctx.measureText(text).width : 0);
  };
  /** The chips in lines of `width`, as many as fit `height`; the rest are «+2 altele». */
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
  function fitItems(dates: CalendarImageEntry[], box: Box, cw: number, cut: Set<CalendarImageEntry>): CellPlan["items"] {
    const none = { box, size: 14, blocks: [], chips: [], inline: false, more: 0, glyph: 0 };
    if (dates.length === 0) return none;
    const withGlyph = (size: number, blocks: Block[]) => {
      const spare = box.h - blocksHeight(blocks, size) - 6 * unit;
      return blocks.length === 1 && spare >= 22 * unit ? Math.min(spare, 46 * unit, box.w * 0.34) : 0;
    };
    // Whole, at the largest size the day holds — a word wider than the day split with «-» only at the smallest.
    for (let size = Math.floor(clamp(cw * 0.15, 14, 28)); size >= 14; size -= 1) {
      ctx.font = face(size, 700);
      const lines = dates.map((entry) => wrapWhole(ctx, upper(entry.title), box.w, size === 14));
      if (lines.some((line) => line === null)) continue;
      const blocks = dates.map((entry, index) => ({ entry, lines: lines[index] ?? [], hour: hourOf(entry) }));
      if (blocksHeight(blocks, size) <= box.h) return { ...none, size, blocks, glyph: withGlyph(size, blocks) };
    }
    // Shortened: the longest title loses a line at a time, while each keeps one line and its hour.
    const size = 14;
    ctx.font = face(size, 700);
    const full = dates.map((entry) => wrapWhole(ctx, upper(entry.title), box.w, true) ?? []);
    const counts = full.map((lines) => lines.length);
    for (;;) {
      ctx.font = face(size, 700);
      const blocks = dates.map((entry, index) => ({ entry, lines: counts[index] === full[index].length ? full[index] : wrapText(ctx, upper(entry.title), box.w, counts[index]), hour: hourOf(entry) }));
      if (blocksHeight(blocks, size) <= box.h) {
        dates.forEach((entry, index) => {
          if (counts[index] < full[index].length) cut.add(entry);
        });
        return { ...none, size, blocks };
      }
      let longest = -1;
      counts.forEach((count, index) => {
        if (count > 1 && (longest < 0 || count > counts[longest])) longest = index;
      });
      if (longest < 0) break;
      counts[longest] -= 1;
    }
    // No room for a title over its hour: each date its chip — the glyph and the hour — on a line with what
    // the width holds of its title when the day is wide, else side by side; the legend says the rest.
    dates.forEach((entry) => cut.add(entry));
    if (box.w >= 200 * unit && dates.length * size * 1.5 * unit <= box.h) return { ...none, size, chips: dates, inline: true };
    for (let chipSize = Math.floor(clamp(cw * 0.12, 14, 20)); chipSize >= 14; chipSize -= 1) {
      if (chipLines(dates, box.w, chipSize).length * chipSize * 1.5 * unit <= box.h) return { ...none, size: chipSize, chips: dates };
    }
    const chipLine = size * 1.5 * unit;
    for (let shown = dates.length - 1; shown >= 0; shown -= 1) {
      const lines = chipLines(dates.slice(0, shown), box.w, size);
      if ((lines.length + 1) * chipLine <= box.h || shown === 0) return { ...none, size, chips: dates.slice(0, shown), more: dates.length - shown };
    }
    return { ...none, more: dates.length };
  }

  function planCell(day: number, box: Box, cw: number, cut: Set<CalendarImageEntry>): CellPlan {
    const marks = plan.marks.get(day) ?? [];
    const dates = plan.dates.get(day) ?? [];
    const inset = 8 * unit;
    const numSize = clamp((Math.min(box.w, box.h) / unit) * 0.19, 18, 32);
    ctx.font = face(numSize, 800);
    const numW = ctx.measureText(String(day)).width;
    const numTop = box.y + inset + 2 * unit;
    const numBottom = numTop + numSize * 0.72 * unit;
    const below: Box = { x: box.x + inset, y: numBottom + 8 * unit, w: box.w - 2 * inset, h: box.y + box.h - inset - (numBottom + 8 * unit) };
    const cell: CellPlan = { day, box, numSize, tint: dates.length > 0 ? tintOf(dates[0]) : null, pills: [], items: { box: below, size: 14, blocks: [], chips: [], inline: false, more: 0, glyph: 0 } };
    if (dates.length === 0 && marks.length > 0) {
      // A series' date alone in its day: the mark centred, as large as the day holds — in a tall day the
      // series' glyph large over the hour, so the column reads as its rhythm.
      const [only] = marks;
      if (marks.length === 1 && !only.entry.cancelled) {
        const size = Math.floor(clamp(cw * 0.15, 14, 26));
        const above = clamp(below.h * 0.38, size * 1.6 * unit, Math.min(below.w * 0.42, 60 * unit));
        // An hour to be announced: the glyph alone, no pill under it.
        const pill = only.entry.time ? pillSize(only, size, false) : { w: above, h: 0 };
        const space = pill.h > 0 ? 6 * unit : 0;
        const height = above + space + pill.h;
        if (height <= below.h && pill.w <= below.w) {
          cell.pills.push({ ...only, ...pill, size, above, x: box.x + (box.w - pill.w) / 2, y: below.y + (below.h - height) / 2 + above + space });
          return cell;
        }
      }
      for (let size = Math.floor(clamp(Math.min(cw, box.h / unit) * 0.15, 14, 26)); size >= 14; size -= 1) {
        const sized = marks.map((mark) => ({ ...mark, ...pillSize(mark, size), size }));
        const height = sized.reduce((sum, pill) => sum + pill.h, 0) + (sized.length - 1) * 6 * unit;
        if (height > below.h || sized.some((pill) => pill.w > below.w)) continue;
        let y = below.y + (below.h - height) / 2;
        for (const pill of sized) {
          cell.pills.push({ ...pill, x: box.x + (box.w - pill.w) / 2, y });
          y += pill.h + 6 * unit;
        }
        return cell;
      }
    }
    // Beside other dates: the marks small, on the number's line when they fit beside it, else under it.
    const size = clamp(cw * 0.1, 14, 17);
    const sized = marks.map((mark) => ({ ...mark, ...pillSize(mark, size), size }));
    let itemsTop = below.y;
    const rowW = sized.reduce((sum, pill) => sum + pill.w, 0) + Math.max(0, sized.length - 1) * 4 * unit;
    if (sized.length > 0 && rowW <= box.w - 2 * inset - numW - 8 * unit) {
      let x = box.x + box.w - inset - rowW;
      const middle = numTop + numSize * 0.36 * unit;
      for (const pill of sized) {
        cell.pills.push({ ...pill, x, y: middle - pill.h / 2 });
        x += pill.w + 4 * unit;
      }
      itemsTop = Math.max(below.y, middle + sized[0].h / 2 + 6 * unit);
    } else if (sized.length > 0) {
      let x = box.x + inset;
      let y = numBottom + 6 * unit;
      for (const pill of sized) {
        if (x + pill.w > box.x + box.w - inset && x > box.x + inset) {
          x = box.x + inset;
          y += pill.h + 4 * unit;
        }
        cell.pills.push({ ...pill, x, y });
        x += pill.w + 4 * unit;
      }
      itemsTop = y + sized[0].h + 6 * unit;
    }
    const itemsBox: Box = { x: box.x + inset, y: itemsTop, w: box.w - 2 * inset, h: box.y + box.h - inset - itemsTop };
    cell.items = fitItems(dates, itemsBox, cw, cut);
    return cell;
  }

  function drawCell(cell: CellPlan) {
    const { box, items } = cell;
    if (cell.tint) {
      ctx.fillStyle = palette[cell.tint][0];
      ctx.fillRect(box.x, box.y, box.w, box.h);
    }
    ctx.fillStyle = palette.cellInk;
    ctx.font = face(cell.numSize, 800);
    ctx.fillText(String(cell.day), box.x + 8 * unit, box.y + 10 * unit + cell.numSize * 0.72 * unit);
    cell.pills.forEach(drawPill);
    if (items.blocks.length === 0 && items.chips.length === 0 && items.more === 0) return;
    const size = items.size;
    const line = lineOf(size);
    const hourSize = hourSizeOf(size);
    const middle = items.box.x + items.box.w / 2;
    if (items.chips.length > 0 || items.blocks.length === 0) {
      const chipLine = size * 1.5 * unit;
      const lines = items.inline ? items.chips.map((entry) => [entry]) : chipLines(items.chips, items.box.w, size);
      let y = items.box.y + Math.max(0, (items.box.h - (lines.length + (items.more ? 1 : 0)) * chipLine) / 2);
      for (const chips of lines) {
        const width = chips.reduce((sum, entry) => sum + chipWidth(entry, size), 0) + (chips.length - 1) * 8 * unit;
        let x = items.inline ? items.box.x : middle - width / 2;
        for (const entry of chips) {
          const ink = entry.cancelled ? palette.special[1] : inkOf(entry);
          const glyphW = drawGlyphs(ctx, eventGlyphs(entry.type, entry.surface), x, y + (chipLine - size * unit) / 2, size * unit, ink);
          ctx.font = face(size, 700);
          ctx.fillStyle = entry.cancelled ? palette.special[1] : palette.title;
          ctx.fillText(chipText(entry), x + glyphW + 3 * unit, y + chipLine / 2 + size * 0.36 * unit);
          x += chipWidth(entry, size) + 8 * unit;
          if (items.inline) {
            ctx.fillStyle = palette.cellInk;
            ctx.fillText(fitText(ctx, upper(entry.title), items.box.x + items.box.w - x), x, y + chipLine / 2 + size * 0.36 * unit);
          }
        }
        y += chipLine;
      }
      if (items.more) {
        ctx.textAlign = "center";
        ctx.font = face(size, 700);
        ctx.fillStyle = palette.cellInk;
        ctx.fillText(fitText(ctx, data.words.more.replace("{count}", String(items.more)), items.box.w), middle, y + chipLine / 2 + size * 0.36 * unit);
        ctx.textAlign = "left";
      }
      return;
    }
    const content = blocksHeight(items.blocks, size) + (items.glyph ? items.glyph + 6 * unit : 0);
    let y = items.box.y + Math.max(0, (items.box.h - content) / 2);
    if (items.glyph) {
      const entry = items.blocks[0].entry;
      const glyphs = eventGlyphs(entry.type, entry.surface);
      drawGlyphs(ctx, glyphs, middle - glyphsWidth(glyphs.length, items.glyph) / 2, y, items.glyph, inkOf(entry));
      y += items.glyph + 6 * unit;
    }
    ctx.textAlign = "center";
    items.blocks.forEach((block, index) => {
      const height = block.lines.length * line + (block.hour ? hourSize * 1.3 * unit : 0);
      // A second date of another kind keeps its own tint inside the day's.
      const tint = tintOf(block.entry);
      if (index > 0) {
        if (tint && tint !== cell.tint) {
          roundRect(ctx, box.x + 4 * unit, y - size * 0.3 * unit, box.w - 8 * unit, height + size * 0.5 * unit, 8 * unit);
          ctx.fillStyle = palette[tint][0];
          ctx.fill();
        } else {
          ctx.strokeStyle = palette.line;
          ctx.lineWidth = 2 * unit;
          ctx.beginPath();
          ctx.moveTo(middle - items.box.w * 0.3, y - size * 0.4 * unit);
          ctx.lineTo(middle + items.box.w * 0.3, y - size * 0.4 * unit);
          ctx.stroke();
        }
      }
      ctx.fillStyle = palette.cellInk;
      ctx.font = face(size, 700);
      for (const text of block.lines) {
        y += line;
        ctx.fillText(text, middle, y - size * 0.22 * unit);
      }
      if (block.hour) {
        y += hourSize * 1.3 * unit;
        ctx.font = face(hourSize, block.entry.cancelled ? 700 : 500);
        ctx.fillStyle = block.entry.cancelled ? palette.special[1] : palette.title;
        ctx.fillText(fitText(ctx, block.hour, items.box.w), middle, y - hourSize * 0.3 * unit);
      }
      y += size * 0.75 * unit;
    });
    ctx.textAlign = "left";
  }

  // ---- The grid: the heads, each with its weekday's series, then the weeks, Monday first.
  const weeks = monthGrid(data.month);
  const lastRow = weeks.length - 1;
  const lead = weeks[0].findIndex((day) => day.inMonth);
  const tail = 6 - [...weeks[lastRow]].reverse().findIndex((day) => day.inMonth);
  function layoutGrid(grid: Box) {
    const cellW = grid.w / 7;
    const cw = cellW / unit;
    let labelSize = Math.min(22, cw * 0.15);
    ctx.font = face(labelSize, 800);
    const widest = Math.max(...data.words.weekdaysLong.map((name) => ctx.measureText(upper(name)).width));
    if (widest > cellW - 12 * unit) labelSize = Math.max(14, (labelSize * (cellW - 12 * unit)) / widest);
    const labelH = labelSize * 2.3 * unit;
    // The strips: the largest size at which every title is whole and no head is taller than a fifth of the
    // grid, and no larger than a week's row can carry beside it.
    const stripInset = 6 * unit;
    const textW = cellW - 2 * stripInset - 12 * unit;
    const byColumn = Array.from({ length: 7 }, (_, column) => plan.lanes.filter((lane) => lane.column === column).sort((a, b) => a.variant - b.variant));
    const stripsAt = (size: number, cutTo = 0): StripPlan[][] | null => {
      ctx.font = face(size, 700);
      const strips: StripPlan[][] = [];
      for (const lanes of byColumn) {
        const column: StripPlan[] = [];
        for (const lane of lanes) {
          const lines = cutTo > 0 ? wrapText(ctx, upper(lane.title), textW, cutTo) : wrapWhole(ctx, upper(lane.title), textW, size === 14);
          if (!lines) return null;
          column.push({ lane, lines, h: 14 * unit + lines.length * lineOf(size) + (lane.time ? hourSizeOf(size) * 1.45 * unit : 0) });
        }
        strips.push(column);
      }
      return strips;
    };
    const stackOf = (strips: StripPlan[][]) => Math.max(0, ...strips.map((column) => column.reduce((sum, strip) => sum + strip.h, 0) + Math.max(0, column.length - 1) * 6 * unit));
    const budget = grid.h * 0.22;
    let stripSize = 14;
    let strips: StripPlan[][] | null = null;
    for (let size = Math.floor(clamp(Math.min(cw * 0.125, (grid.h / weeks.length / unit) * 0.14), 14, 22)); size >= 14 && !strips; size -= 1) {
      const candidate = stripsAt(size);
      if (candidate && stackOf(candidate) <= budget) {
        strips = candidate;
        stripSize = size;
      }
    }
    // Past the budget the heads stay whole at the smallest size; only a head that would take nearly half the
    // grid is cut, on as many lines as that half holds.
    if (!strips) {
      const whole = stripsAt(14);
      if (whole && stackOf(whole) <= grid.h * 0.45) strips = whole;
    }
    for (let lines = 12; !strips && lines >= 1; lines -= 1) {
      const candidate = stripsAt(14, lines);
      if (candidate && (stackOf(candidate) <= grid.h * 0.45 || lines === 1)) strips = candidate;
    }
    const stack = stackOf(strips ?? []);
    const headH = labelH + (stack > 0 ? stack + stripInset : 0);
    const cellH = (grid.h - headH) / weeks.length;
    const cut = new Set<CalendarImageEntry>();
    const cells: CellPlan[] = [];
    weeks.forEach((week, row) =>
      week.forEach((day, column) => {
        if (day.inMonth) cells.push(planCell(day.day, { x: grid.x + column * cellW, y: grid.y + headH + row * cellH, w: cellW, h: cellH }, cw, cut));
      }),
    );
    const regions: Region[] = [
      { row: 0, from: 0, to: lead },
      { row: lastRow, from: tail + 1, to: 7 },
    ]
      .filter((region) => region.to > region.from)
      .map((region) => ({ ...region, box: { x: grid.x + region.from * cellW, y: grid.y + headH + region.row * cellH, w: (region.to - region.from) * cellW, h: cellH } }));
    return { grid, cellW, labelSize, labelH, stripInset, stripSize, strips: strips ?? [], headH, cellH, cells, cut, regions };
  }

  // ---- The legend: the special dates, and a series no head holds, in rows of their own.
  const laneSample = (lane: PosterLane): Mark => ({ lane, entry: { cancelled: false, time: lane.time } });
  /** An item's height in a column `w` wide: its title's lines, then its notes — a date's hour, or a series' rhythm on as many lines as it takes. */
  function measureItem(item: LegendItem, w: number, size: number): { h: number; lines: string[]; notes: string[] } {
    const line = lineOf(size);
    if (item.kind === "title") {
      // A heading is never cut: in a column too narrow for it at this size, it does not fit at all.
      ctx.font = face(size, 800);
      const fits = ctx.measureText(upper(item.text)).width + size * 1.6 * unit <= w + 0.5;
      return { h: fits ? size * 1.9 * unit + 8 * unit : Number.POSITIVE_INFINITY, lines: [], notes: [] };
    }
    const sample = item.kind === "lane" ? pillSize(laneSample(item.lane), size) : null;
    const badge = sample ? sample.w : size * 2.4 * unit;
    const textW = w - badge - 12 * unit;
    ctx.font = face(size, 700);
    const title = upper(item.kind === "date" ? item.entry.title : item.lane.title);
    const lines = wrapWhole(ctx, title, textW, true) ?? [];
    ctx.font = face(hourSizeOf(size), 500);
    const note = item.kind === "date" ? hourOf(item.entry) : item.lane.sentence;
    const notes = !note ? [] : item.kind === "date" ? [note] : (wrapWhole(ctx, note, textW, true) ?? []);
    const height = lines.length * line + notes.length * hourSizeOf(size) * 1.35 * unit;
    return { h: Math.max(height, sample ? sample.h : badge) + 12 * unit, lines, notes };
  }
  const minColW = 260 * unit;
  /**
   * The items in columns, slot by slot, in order. `titleLeft` gives the first title a column of its own at
   * the left — in a wide, low run of empty days it cannot stand over its rows at any readable size.
   */
  function flow(items: LegendItem[], slots: Box[], size: number, titleLeft = false): { placed: Placed[]; complete: boolean } {
    const placed: Placed[] = [];
    const inner = 12 * unit;
    let index = 0;
    for (const slot of slots) {
      let left = slot.x + inner;
      if (titleLeft && index === 0 && items[0]?.kind === "title") {
        ctx.font = face(size, 800);
        const width = ctx.measureText(upper(items[0].text)).width + size * 1.6 * unit;
        placed.push({ item: items[0], x: left, y: slot.y + inner, w: width, h: measureItem(items[0], width, size).h, lines: [], notes: [] });
        left += width + 16 * unit;
        index = 1;
      }
      const room = slot.x + slot.w - inner - left;
      const columns = clamp(Math.floor(room / minColW), 1, 4);
      const colW = (room - (columns - 1) * 16 * unit) / columns;
      for (let column = 0; column < columns && index < items.length; column += 1) {
        let y = slot.y + inner;
        const x = left + column * (colW + 16 * unit);
        while (index < items.length) {
          const measured = measureItem(items[index], colW, size);
          // A title stays with the row after it.
          const need = measured.h + (items[index].kind === "title" && index + 1 < items.length ? measureItem(items[index + 1], colW, size).h : 0);
          if (y + need > slot.y + slot.h - inner + 0.5) break;
          placed.push({ item: items[index], x, y, w: colW, h: measured.h, lines: measured.lines, notes: measured.notes });
          y += measured.h;
          index += 1;
        }
      }
    }
    return { placed, complete: index === items.length };
  }
  function drawLegend(placed: Placed[], size: number) {
    const line = lineOf(size);
    const hourSize = hourSizeOf(size);
    for (const { item, x, y, w, lines, notes } of placed) {
      if (item.kind === "title") {
        ctx.font = face(size, 800);
        const label = fitText(ctx, upper(item.text), w - size * 1.6 * unit);
        roundRect(ctx, x, y, ctx.measureText(label).width + size * 1.6 * unit, size * 1.9 * unit, size * unit);
        ctx.fillStyle = item.fill;
        ctx.fill();
        ctx.fillStyle = palette.bandInk;
        ctx.fillText(label, x + size * 0.8 * unit, y + size * 1.9 * unit * 0.5 + size * 0.36 * unit);
        continue;
      }
      let badgeW: number;
      if (item.kind === "date") {
        const badge = size * 2.4 * unit;
        badgeW = badge;
        const tint = tintOf(item.entry);
        roundRect(ctx, x, y + 2 * unit, badge, badge, 10 * unit);
        ctx.fillStyle = tint ? palette[tint][0] : palette.cellMuted;
        ctx.fill();
        ctx.fillStyle = palette.cellInk;
        ctx.font = face(size * 1.15, 800);
        ctx.textAlign = "center";
        ctx.fillText(String(item.entry.day), x + badge / 2, y + 2 * unit + badge / 2 + size * 1.15 * 0.36 * unit);
        ctx.textAlign = "left";
      } else {
        const pill = { ...laneSample(item.lane), ...pillSize(laneSample(item.lane), size), size };
        badgeW = pill.w;
        drawPill({ ...pill, x, y: y + 2 * unit });
      }
      const textX = x + badgeW + 12 * unit;
      const textW = w - badgeW - 12 * unit;
      let lineY = y;
      ctx.fillStyle = palette.cellInk;
      ctx.font = face(size, 700);
      for (const text of lines) {
        lineY += line;
        ctx.fillText(text, textX, lineY - size * 0.2 * unit);
      }
      for (const note of notes) {
        lineY += hourSize * 1.35 * unit;
        let noteX = textX;
        if (item.kind === "date") {
          const glyph = hourSize * 1.1 * unit;
          noteX += drawGlyphs(ctx, eventGlyphs(item.entry.type, item.entry.surface), noteX, lineY - hourSize * 0.3 * unit - glyph * 0.8, glyph, inkOf(item.entry)) + 6 * unit;
        }
        ctx.font = face(hourSize, 500);
        ctx.fillStyle = item.kind === "date" && item.entry.cancelled ? palette.special[1] : palette.title;
        ctx.fillText(fitText(ctx, note, textW - (noteX - textX)), noteX, lineY - hourSize * 0.3 * unit);
      }
    }
  }

  const area: Box = { x: pad, y: pad + bandH + gap, w: W - 2 * pad, h: footY - gap - (pad + bandH + gap) };
  const irregular = plan.lanes.filter((lane) => lane.column === null);
  const allDates = [...plan.dates.values()].flat();
  const itemsFor = (dates: CalendarImageEntry[]): LegendItem[] => [
    ...(irregular.length > 0 ? [{ kind: "title" as const, text: data.words.recurringTitle, fill: palette.band }, ...irregular.map((lane) => ({ kind: "lane" as const, lane }))] : []),
    ...(dates.length > 0 ? [{ kind: "title" as const, text: data.words.specialTitle, fill: palette.special[1] }, ...dates.map((entry) => ({ kind: "date" as const, entry }))] : []),
  ];
  /** The largest size, from 22 down, at which every item fits the slots; null when none does. */
  function largest(items: LegendItem[], slots: Box[]): { placed: Placed[]; size: number } | null {
    for (let size = 22; size >= 14 && slots.length > 0; size -= 1) {
      for (const titleLeft of [false, true]) {
        const result = flow(items, slots, size, titleLeft);
        if (result.complete) return { placed: result.placed, size };
      }
    }
    return null;
  }
  // Where the legend goes: in the empty days when everything fits there at no cost; when a title was
  // shortened in its day or a series has no head, what adds something — in the empty days, else beside the
  // grid on a wide picture or in a slim strip under it on a tall one.
  let layout = layoutGrid(area);
  let legend: { placed: Placed[]; size: number; strip: Box | null } | null = null;
  const wide = (region: Region) => region.box.w >= 2.5 * layout.cellW && region.box.w >= minColW;
  if (options.legend) {
    const inRegions = (items: LegendItem[]) => {
      const regions = layout.regions.filter(wide).map((region) => region.box);
      if (regions.length === 0) return null;
      // One region rather than two, unless two let the words be clearly larger.
      const roomiest = [...regions].sort((a, b) => b.w * b.h - a.w * a.h)[0];
      const alone = largest(items, [roomiest]);
      const split = regions.length > 1 ? largest(items, regions) : null;
      const best = alone && (!split || alone.size >= split.size - 3) ? alone : split;
      return best ? { ...best, strip: null } : null;
    };
    const needed = () => irregular.length > 0 || layout.cut.size > 0;
    if (allDates.length > 0 || irregular.length > 0) legend = inRegions(itemsFor(allDates));
    if (!legend && needed()) legend = inRegions(itemsFor(allDates.filter((entry) => layout.cut.has(entry))));
    if (!legend && needed()) {
      // The grid gives up the room, which may shorten more titles: the dates shortened are gathered over a
      // few rounds until they hold still.
      const beside = W > H;
      const cut = new Set(layout.cut);
      for (let round = 0; round < 3 && !legend; round += 1) {
        const items = itemsFor(allDates.filter((entry) => cut.has(entry)));
        let strip: Box;
        let grid: Box;
        if (beside) {
          const width = clamp(area.w * 0.25, 360 * unit, 560 * unit);
          grid = { ...area, w: area.w - width - gap };
          strip = { x: grid.x + grid.w + gap, y: area.y, w: width, h: area.h };
        } else {
          let height = 40 * unit;
          while (height < area.h * 0.4 && !flow(items, [{ x: area.x, y: 0, w: area.w, h: height }], 15).complete) height += 6 * unit;
          grid = { ...area, h: area.h - height - gap };
          strip = { x: area.x, y: grid.y + grid.h + gap, w: area.w, h: height };
        }
        const next = layoutGrid(grid);
        const grown = [...next.cut].some((entry) => !cut.has(entry));
        next.cut.forEach((entry) => cut.add(entry));
        if (!grown || round === 2) {
          layout = next;
          const shortened = itemsFor(allDates.filter((entry) => cut.has(entry)));
          // Beside, the column is there anyway: every special date when they all fit, else the shortened ones.
          const fitted = beside ? (largest(itemsFor(allDates), [strip]) ?? largest(shortened, [strip])) : largest(shortened, [strip]);
          legend = { ...(fitted ?? { placed: flow(shortened, [strip], 14).placed, size: 14 }), strip };
        }
      }
    }
  }

  const { grid, cellW, labelSize, labelH, stripInset, stripSize, strips, headH, cellH } = layout;
  roundRect(ctx, grid.x, grid.y, grid.w, grid.h, 18 * unit);
  ctx.fillStyle = palette.cell;
  ctx.fill();
  ctx.save();
  ctx.clip();
  ctx.fillStyle = palette.cellMuted;
  ctx.fillRect(grid.x, grid.y, grid.w, headH);
  ctx.textAlign = "center";
  ctx.font = face(labelSize, 800);
  ctx.fillStyle = palette.title;
  data.words.weekdaysLong.forEach((name, index) => {
    ctx.fillText(fitText(ctx, upper(name), cellW - 8 * unit), grid.x + index * cellW + cellW / 2, grid.y + labelH / 2 + labelSize * 0.36 * unit);
  });
  // Each series under its weekday: the whole title, then its glyph and «ora 19:30».
  strips.forEach((column, index) => {
    let y = grid.y + labelH;
    const x = grid.x + index * cellW + stripInset;
    const w = cellW - 2 * stripInset;
    for (const strip of column) {
      const look = laneLook(strip.lane);
      roundRect(ctx, x, y, w, strip.h, 12 * unit);
      ctx.fillStyle = look.fill;
      ctx.fill();
      if (look.stroke) {
        ctx.strokeStyle = look.stroke;
        ctx.lineWidth = 2.5 * unit;
        ctx.stroke();
      }
      ctx.fillStyle = look.ink;
      ctx.font = face(stripSize, 700);
      let lineY = y + 7 * unit;
      for (const text of strip.lines) {
        lineY += lineOf(stripSize);
        ctx.fillText(text, x + w / 2, lineY - stripSize * 0.22 * unit);
      }
      if (strip.lane.time) {
        const hourSize = hourSizeOf(stripSize);
        lineY += hourSize * 1.45 * unit;
        ctx.font = face(hourSize, 500);
        const hour = data.words.at.replace("{time}", strip.lane.time);
        const glyph = hourSize * 1.15 * unit;
        const glyphs = eventGlyphs(strip.lane.type, strip.lane.surface);
        const glyphW = glyphsWidth(glyphs.length, glyph);
        const width = glyphW + 6 * unit + ctx.measureText(hour).width;
        const left = x + (w - Math.min(width, w - 8 * unit)) / 2;
        drawGlyphs(ctx, glyphs, left, lineY - hourSize * 0.36 * unit - glyph * 0.62, glyph, look.ink);
        ctx.textAlign = "left";
        ctx.fillText(fitText(ctx, hour, w - glyphW - 14 * unit), left + glyphW + 6 * unit, lineY - hourSize * 0.3 * unit);
        ctx.textAlign = "center";
      }
      y += strip.h + 6 * unit;
    }
  });
  ctx.textAlign = "left";
  layout.cells.forEach(drawCell);

  // The empty days: the legend when it went there, else the mountains, as the poster draws them.
  const merged = layout.regions.filter(wide);
  for (const region of merged) {
    const box = region.box;
    if (legend && !legend.strip && legend.placed.some((placed) => placed.x >= box.x && placed.x < box.x + box.w && placed.y >= box.y && placed.y < box.y + box.h)) continue;
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
  if (legend && !legend.strip) drawLegend(legend.placed, legend.size);

  // The grid's lines over the cells, none across the empty days drawn as one.
  ctx.strokeStyle = palette.line;
  ctx.lineWidth = 2 * unit;
  ctx.beginPath();
  weeks.forEach((_, row) => {
    const y = grid.y + headH + row * cellH;
    ctx.moveTo(grid.x, y);
    ctx.lineTo(grid.x + grid.w, y);
    for (let column = 1; column < 7; column += 1) {
      if (merged.some((region) => region.row === row && region.from < column && column < region.to)) continue;
      ctx.moveTo(grid.x + column * cellW, y);
      ctx.lineTo(grid.x + column * cellW, y + cellH);
    }
  });
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
    drawLegend(legend.placed, legend.size);
  }
}
