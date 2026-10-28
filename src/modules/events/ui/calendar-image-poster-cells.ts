import type { CalendarImagePalette } from "@/theme/brand";
import { FAR, MOUNTAIN_MARK_VIEWBOX, NEAR } from "@/shared/ui/MountainMark";
import { type Box, CALENDAR_IMAGE_RATIOS, detailWords, drawGlyphs, eventGlyphs, fitText, glyphsWidth, roundRect, wrapBalanced } from "./calendar-image-canvas";
import { drawFrame } from "./calendar-image-frame";
import { SPECIAL_PATH } from "./calendar-image-glyphs";
import type { CalendarImageAssets, CalendarImageFonts, CalendarImageOptions } from "./calendar-image-draw";
import { monthGrid } from "../domain/calendar";
import type { CalendarTone } from "../domain/calendar-kind";
import type { EventType } from "../domain/event-type";
import { type CalendarImageData, type CalendarImageEntry, LEGEND_MAX } from "../domain/calendar-image";

/**
 * «Afiș», «Așezare» → «Legenda în celule» (`cells`): a compact band, each weekly series' dates as chips in the
 * series' own colour, and the month's key — every series and every special date — drawn inside the empty days
 * of the last or the first week.
 */

/** `value` within [low, high]; the floor wins where the two cross, so a readable minimum is never given up. */
const clamp = (value: number, low: number, high: number) => Math.max(low, Math.min(high, value));
const sum = (values: readonly number[]) => values.reduce((total, value) => total + value, 0);

/** Each of `floors` raised to one level, so that together they fill `room` — or, when they overflow it, all cut alike. */
function level(floors: readonly number[], room: number): number[] {
  const total = sum(floors);
  if (total > room) return floors.map((floor) => (floor * Math.max(0, room)) / total);
  // The tallest floors stand on their own while they are over the share of what they leave.
  let rest = room;
  let count = floors.length;
  for (const floor of [...floors].sort((a, b) => b - a)) {
    if (floor <= rest / count) break;
    rest -= floor;
    count -= 1;
  }
  const height = count > 0 ? rest / count : 0;
  return floors.map((floor) => Math.max(floor, height));
}

/**
 * The weeks' heights in `room`: every week at least what it `asks`, the others level — as tall as each would be
 * if none asked more. When the asks overflow the room, a `hard` week (the one holding the key) keeps its ask and
 * each other week gets its `least` and the same share of what it asks beyond it, so the weeks whose days need
 * room get the most of it; when not even the least fits, all are cut alike.
 */
export function weekHeights(asks: readonly number[], room: number, hard: readonly boolean[] = [], least: readonly number[] = []): number[] {
  if (sum(asks) <= room) return level(asks, room);
  const soft = asks.map((_, index) => index).filter((index) => !hard[index]);
  const rest = Math.max(0, room - sum(asks.filter((_, index) => hard[index])));
  const floors = soft.map((index) => Math.min(least[index] ?? 0, asks[index]));
  const wants = soft.map((index, at) => asks[index] - floors[at]);
  // The soft asks overflow `rest` whenever all of them do, so the share is under one.
  const share = sum(floors) >= rest ? 0 : (rest - sum(floors)) / Math.max(1e-9, sum(wants));
  const shared = sum(floors) >= rest ? floors.map((floor) => (floor * rest) / Math.max(1e-9, sum(floors))) : floors.map((floor, at) => floor + wants[at] * Math.min(1, share));
  return asks.map((ask, index) => (hard[index] ? ask : shared[soft.indexOf(index)]));
}

/** The empty days' mountains: the club's ridge across `box`, from its foot, as the poster draws them. */
function drawRidge(ctx: CanvasRenderingContext2D, box: Box, color: string, far: number, near: number) {
  const h = Math.min(box.h * 0.8, (box.w * MOUNTAIN_MARK_VIEWBOX.height) / MOUNTAIN_MARK_VIEWBOX.width);
  ctx.save();
  ctx.translate(box.x, box.y + box.h - h);
  ctx.scale(box.w / MOUNTAIN_MARK_VIEWBOX.width, h / MOUNTAIN_MARK_VIEWBOX.height);
  ctx.fillStyle = color;
  ctx.globalAlpha = far;
  ctx.fill(new Path2D(FAR));
  ctx.globalAlpha = near;
  ctx.fill(new Path2D(NEAR));
  ctx.restore();
}

/**
 * «Afiș» (§855; the owner, 2026-10-27: «vreau să semene cu ce mi-a dat Amalia», then «I need to organize it
 * better and use the space more efficiently») — the club's hand-made monthly poster, its order kept and every
 * part made to earn its pixels:
 *
 * - the grid: a weekly series' date is a chip in the series' own colour, its glyphs and its hour — alone in its
 *   day, in a week whose days hold one, a tile, the glyphs over the hour; the series' name is said once, in the
 *   key; beside a number the glyphs go before the hour. A date
 *   that stands alone keeps its whole title, as large as its day allows, with its glyphs, its hour and its
 *   details («Tâmpa · 6 km»); the details go first, then the glyphs, then a size, before a title is cut;
 * - the key sits inside the grid, in the empty days after the last, else before the 1st, one panel (the
 *   mountains once on the sheet): «EVENIMENTE RECURENTE», each series' chip, name, rhythm and details, then
 *   «EVENIMENTE SPECIALE», every special date of the month with its day, glyphs, title, hour and details. That
 *   week grows to hold it; when no run holds it without squeezing the weeks or naming fewer dates, a strip
 *   under the grid. The weeks share the rest, each its least and the same share of what it asks beyond. When
 *   the month is too full for all of it, the key gives the days room — its details, then the dates their days
 *   show whole, with «+3 altele» — and names first the race, then what a day had to cut or draw without its
 *   hour; and where even so a date would be named nowhere whole, the weekly rhythm gives way to it (the
 *   owner's order): the series' rhythm — each series then its chip and its name, side by side on a wide
 *   panel, the pills beside the rows — and the days' lines for what the key names, a day keeping «+1 altele»
 *   or, at the last, the sparkle by its number. The series are always named in the key, the one place they
 *   are. Every special date is named whole, with its hour, in its day or in the key — but in a month too full
 *   even for that, whose key counts the fewest in its «+3 altele», never the race; the race is always whole in
 *   its day, with its hour.
 *
 * The readable floor (the audit's D17, D31): a feed shows the picture about 400 px wide, so nothing a reader
 * needs is under 17 px on a 1080-wide picture (16 for an hour or a detail line, 18 for a day number and a
 * glyph), and a 16:9 picture's words a third larger, so nothing on it is under 21.
 */
export function drawPosterCells(ctx: CanvasRenderingContext2D, data: CalendarImageData, options: CalendarImageOptions, fonts: CalendarImageFonts, assets: CalendarImageAssets, palette: CalendarImagePalette): void {
  const { width: W, height: H } = CALENDAR_IMAGE_RATIOS[options.ratio];
  const u = Math.min(W, H) / 1080;
  /** The words' unit: a 16:9 picture is read at a phone's width like the others, so its words are set larger. */
  const t = W > H ? (u * 21) / 16 : u;
  const TITLE = 17 * t;
  const NOTE = 16 * t;
  const GLYPH = 18 * t;
  // One geometric family throughout: ExtraBold for the labels and the day numbers, Bold for the titles and the
  // chips, Medium for the hours and the notes.
  const face = (size: number, weight: number) => `${weight} ${Math.round(size * 2) / 2}px ${fonts.poster}`;
  const upper = (text: string) => text.toLocaleUpperCase("ro-RO");
  const toneOf = (tone: CalendarTone) => palette[tone];
  // The key's places and the weeks' heights are tried many ways, and each way measures and wraps the same words
  // at the same widths again: each is worked out once.
  const widths = new Map<string, number>();
  const measure = (text: string, font: string) => {
    const key = `${font}\n${text}`;
    let width = widths.get(key);
    if (width === undefined) {
      ctx.font = font;
      width = ctx.measureText(text).width;
      widths.set(key, width);
    }
    return width;
  };
  const wraps = new Map<string, string[]>();
  /** `text` at `font` broken into lines of `width` by the shared balanced wrap, a word too long split with «-» when `hyphenate`. */
  const wrapLines = (text: string, width: number, font: string, hyphenate = true) => {
    const key = `${font}\n${width.toFixed(2)}\n${hyphenate}\n${text}`;
    let wrapped = wraps.get(key);
    if (!wrapped) {
      ctx.font = font;
      wrapped = wrapBalanced(ctx, text, width, { hyphenate });
      wraps.set(key, wrapped);
    }
    return wrapped;
  };
  /** `text` at `font` in lines of `width`, a word too long split with «-»; null when a line still overflows. */
  const wrap = (text: string, width: number, font: string): string[] | null => {
    const wrapped = wrapLines(text, width, font);
    return wrapped.every((line) => measure(line, font) <= width + 0.5) ? wrapped : null;
  };
  /** From `from` down to `to` in steps of `step` (half a pixel unless told), `to` itself last, so the floor is always tried. */
  const sizesFrom = (from: number, to: number, step = 0.5 * u) => {
    const sizes: number[] = [];
    for (let size = from; size > to + 0.01; size -= step) sizes.push(size);
    return [...sizes, to];
  };
  /**
   * `lines` with the first of `details` that fit after the last line, « · » between, else on a line of their own
   * — the climb dropped first, then the distance, then the place; nothing when not even the place fits. The
   * first line is `lead` narrower (the glyphs before an hour).
   */
  const withDetails = (lines: string[], details: string[], width: number, font: string, lead = 0): string[] => {
    const room = (index: number) => width - (index === 0 ? lead : 0);
    for (let count = details.length; count > 0; count -= 1) {
      const words = details.slice(0, count).join(" · ");
      const last = lines.length - 1;
      if (last >= 0 && measure(`${lines[last]} · ${words}`, font) <= room(last)) return [...lines.slice(0, -1), `${lines[last]} · ${words}`];
      if (measure(words, font) <= room(lines.length)) return [...lines, words];
    }
    return lines;
  };
  // The page, the band and the foot are the frame's (`calendar-image-frame.ts`); what is left is the body's.
  const content = drawFrame(ctx, data, options, fonts, assets, palette);
  if (!content) return;

  // ── What the days say. A weekly series (one the key names, up to its colours) is a chip; the rest stand alone
  // with their titles. A title that repeats is the poster's plain white day; the rest are marked.
  const weeks = monthGrid(data.month);
  const byDay = new Map<number, CalendarImageEntry[]>();
  for (const entry of data.entries) byDay.set(entry.day, [...(byDay.get(entry.day) ?? []), entry]);
  const keyOf = (type: EventType, title: string) => `${type} ${title}`;
  const chipSeries = data.recurring.slice(0, Math.min(LEGEND_MAX, palette.series.length));
  const seriesOf = new Map(chipSeries.map((row, index) => [keyOf(row.type, row.title), index]));
  const repeating = new Set(data.recurring.map((row) => keyOf(row.type, row.title)));
  const markOf = (entry: CalendarImageEntry): CalendarTone => (repeating.has(keyOf(entry.type, entry.title)) ? "weekly" : entry.tone === "weekly" ? "special" : entry.tone);
  /** Where a date's hour goes: «ora 18:00», «Anulat», or «ora se anunță» while it is not set. */
  const hourOf = (entry: CalendarImageEntry) => (entry.cancelled ? data.words.cancelled : entry.time ? data.words.at.replace("{time}", entry.time) : data.words.tba);

  /**
   * A series' date: its glyphs and its hour — «Anulat» when cancelled, «ora se anunță» when not set. `hour` says
   * the text is the plain hour, which the key's rhythm says again, so a narrow place may leave it out.
   */
  type Chip = { series: number; text: string; glyphs: string[]; cancelled: boolean; special: boolean; hour: boolean };
  const chipOf = (entry: CalendarImageEntry, series: number): Chip => ({
    series,
    text: entry.cancelled ? data.words.cancelled : (entry.time ?? data.words.tba),
    glyphs: eventGlyphs(entry.type, entry.surface),
    cancelled: entry.cancelled,
    special: entry.special,
    hour: !entry.cancelled && entry.time !== null && options.legend,
  });
  const pillFont = (h: number) => face(Math.max(TITLE, h * 0.5), 700);
  const pillW = (chip: Chip, h: number) => h * 0.56 + glyphsWidth(chip.glyphs.length, h * 0.6) + (chip.text ? h * 0.18 + measure(chip.text, pillFont(h)) : 0);
  /** The chip's shape in its series' colour — a cancelled date's outline only — and the colour its words take. */
  const chipShape = (chip: Chip, x: number, y: number, w: number, h: number, radius: number) => {
    const [fill, ink] = palette.series[chip.series];
    roundRect(ctx, x, y, w, h, radius);
    ctx.fillStyle = chip.cancelled ? palette.cell : fill;
    ctx.fill();
    if (chip.cancelled) {
      ctx.strokeStyle = fill;
      ctx.lineWidth = 2 * u;
      ctx.stroke();
    }
    return chip.cancelled ? fill : ink;
  };
  /** A chip as a pill `h` tall: the glyphs, then the hour. */
  const drawPill = (chip: Chip, x: number, y: number, h: number) => {
    const color = chipShape(chip, x, y, pillW(chip, h), h, h / 2);
    const glyphW = drawGlyphs(ctx, chip.glyphs, x + h * 0.28, y + h * 0.2, h * 0.6, color);
    if (!chip.text) return;
    ctx.font = pillFont(h);
    ctx.fillStyle = color;
    ctx.textAlign = "left";
    ctx.fillText(chip.text, x + h * 0.28 + glyphW + h * 0.18, y + h / 2 + Math.max(TITLE, h * 0.5) * 0.36);
  };

  // ── The days' sizes, one set for the picture: from the cell's width and the ordinary week's height, so the
  // number, the chips and a lone title's glyphs are alike in every day, whatever its week grew to.
  const cellW = content.w / 7;
  const weekdayH = clamp(cellW * 0.26, 34 * u, 44 * u);
  const ordinary = (content.h - weekdayH) / weeks.length;
  const p = clamp(cellW * 0.055, 6 * u, 12 * u);
  const innerW = cellW - 2 * p;
  const number = clamp(Math.min(cellW, ordinary) * 0.2, 18 * t, 46 * u);
  const numberFont = face(number, 800);
  const headChipH = clamp(number * 1.05, 30 * t, 38 * u);
  const pillH = clamp(Math.min(cellW * 0.28, ordinary * 0.2), 30 * t, 48 * u);
  const loneGlyph = clamp(Math.min(cellW * 0.2, ordinary * 0.16), GLYPH, 40 * u);
  const gap = 6 * u;
  const cardPad = 5 * u;
  /** A chip alone in its day: a tile, its glyphs over its hour, as large as the ordinary week's chips allow. */
  const tileGlyph = Math.max(GLYPH, pillH * 0.9);
  const tileText = Math.max(TITLE, pillH * 0.5);
  const tileH = tileGlyph * 1.82 + tileText * 0.72;
  const tileW = (chip: Chip) => Math.max(glyphsWidth(chip.glyphs.length, tileGlyph), measure(chip.text, face(tileText, 700))) + tileGlyph * 0.6;
  const drawTile = (chip: Chip, x: number, y: number) => {
    const w = tileW(chip);
    const color = chipShape(chip, x, y, w, tileH, tileGlyph * 0.3);
    drawGlyphs(ctx, chip.glyphs, x + (w - glyphsWidth(chip.glyphs.length, tileGlyph)) / 2, y + tileGlyph * 0.3, tileGlyph, color);
    ctx.font = face(tileText, 700);
    ctx.fillStyle = color;
    ctx.textAlign = "center";
    ctx.fillText(chip.text, x + w / 2, y + tileGlyph * 1.52 + tileText * 0.72);
    ctx.textAlign = "left";
  };
  /** The pill as tall as the day's room gives, a step smaller while it is wider than the day. */
  const pillFit = (chip: Chip) => {
    let h = pillH;
    while (h > 30 * t && pillW(chip, h) > innerW) h -= u;
    return h;
  };
  /** A pill still wider than its day: its ground's glyph left out, then its type's — «Anulat» is never cut while a glyph can go — and only then its word cut. */
  const narrowed = (chip: Chip, h: number): Chip => {
    for (const glyphs of [chip.glyphs, chip.glyphs.slice(0, 1), []]) {
      const each = { ...chip, glyphs };
      if (pillW(each, h) <= innerW) return each;
    }
    ctx.font = pillFont(h);
    return { ...chip, glyphs: [], text: fitText(ctx, chip.text, innerW - h * 0.56) };
  };
  const areaTopOf = (headH: number) => p * 0.75 + headH + p * 0.6;
  /** How wide chips are side by side beside the number. */
  const headWidth = (list: Chip[]) => sum(list.map((chip) => pillW(chip, headChipH))) + Math.max(0, list.length - 1) * 4 * u;
  /**
   * As many of `chips` as fit beside a two-figure number, pared alike on every such day (D41): the ground's
   * glyph goes first, then the type's, and only then the plain hour the key's rhythm says again — its type's
   * glyph back in its place; the rest stay for the room under it.
   */
  const beside = (chips: Chip[]): { head: Chip[]; rest: Chip[] } => {
    const room = innerW - measure("28", numberFont) - 6 * u;
    const steps: ((chip: Chip) => Chip)[] = [
      (chip) => chip,
      (chip) => ({ ...chip, glyphs: chip.glyphs.slice(0, 1) }),
      (chip) => ({ ...chip, glyphs: chip.text ? [] : chip.glyphs.slice(0, 1) }),
      (chip) => (chip.hour ? { ...chip, glyphs: chip.glyphs.slice(0, 1), text: "" } : { ...chip, glyphs: chip.text ? [] : chip.glyphs.slice(0, 1) }),
    ];
    for (const step of steps) {
      const head = chips.map(step);
      if (headWidth(head) <= room) return { head, rest: [] };
    }
    const last = steps[steps.length - 1];
    const head: Chip[] = [];
    for (const chip of chips) {
      if (headWidth([...head, last(chip)]) > room) break;
      head.push(last(chip));
    }
    return { head, rest: chips.slice(head.length) };
  };
  /** The sparkle a special edition wears in the calendar (§168): beside a day's number, for the dates its day has no line for. */
  const markSize = Math.max(GLYPH, number * 0.8);
  /** Whether the sparkle goes between a two-figure number and `head`, the chips beside it as `beside` pared them. */
  const markFits = (head: Chip[]) => measure("28", numberFont) + 6 * u + markSize + 6 * u + headWidth(head) <= innerW;

  /** A date that stands alone: its title in capitals, its hour, its details and its glyphs. */
  const isRace = (item: { entry: CalendarImageEntry }) => item.entry.type === "RACE";
  type Titled = { entry: CalendarImageEntry; tone: CalendarTone; title: string; hour: string; details: string[]; glyphs: string[] };
  type Block = { item: Titled; lines: string[]; size: number; glyph: number; notes: string[]; inline: boolean; h: number };
  /** What a day's room holds: a chip as a pill or a tile (`from`, the date's own, before it was narrowed), or a title. */
  type Piece = { kind: "pill" | "tile"; chip: Chip; from: Chip; h: number } | ({ kind: "titled" } & Block);
  /** `mark`: the tone of the sparkle beside the number, for a special the day has not even a «+N altele» line for. */
  type DayPlan = { headH: number; head: Chip[]; areaTop: number; areaH: number; card: boolean; pieces: Piece[]; more: number; mark: CalendarTone | null; tint: CalendarTone | null; cut: CalendarImageEntry[]; lost: number };
  const lineStep = (size: number) => size * 1.14;
  const noteSize = (size: number) => Math.max(NOTE, size * 0.9);
  const noteStep = (size: number) => noteSize(size) * 1.25;
  const split = (entries: CalendarImageEntry[]) => {
    const chips: Chip[] = [];
    const titled: Titled[] = [];
    const order: (Chip | Titled)[] = [];
    for (const entry of entries) {
      const series = seriesOf.get(keyOf(entry.type, entry.title));
      const item: Chip | Titled =
        series === undefined
          ? { entry, tone: markOf(entry), title: upper(entry.title), hour: hourOf(entry), details: entry.cancelled ? [] : detailWords(entry, options.details), glyphs: eventGlyphs(entry.type, entry.surface) }
          : chipOf(entry, series);
      if ("series" in item) chips.push(item);
      else titled.push(item);
      order.push(item);
    }
    return { chips, titled, order };
  };
  /** The hour's lines under a title at `size`, with the first `keep` details where they fit. */
  const notesOf = (item: Titled, size: number, keep: number, width: number) => {
    const font = face(noteSize(size), item.entry.cancelled ? 800 : 500);
    const hour = wrapLines(item.hour, width, font, false).map((line) => {
      if (measure(line, font) <= width) return line;
      ctx.font = font;
      return fitText(ctx, line, width);
    });
    return withDetails(hour, item.details.slice(0, keep), width, font);
  };
  /** Every title whole at `size` in lines of `width`, each with its hour and `keep` details; null when a word will not go. */
  const blocksAt = (titled: Titled[], size: number, keep: number, glyph: number, width: number, pad: number): Block[] | null => {
    const blocks: Block[] = [];
    for (const item of titled) {
      const lines = wrap(item.title, width, face(size, 700));
      if (!lines) return null;
      const notes = notesOf(item, size, keep, width);
      blocks.push({ item, lines, size, glyph, notes, inline: false, h: (glyph ? glyph * 1.25 : 0) + lines.length * lineStep(size) + notes.length * noteStep(size) + 2 * pad });
    }
    return blocks;
  };
  /** The first `count` of `lines`, the last cut with «…» when there were more. */
  const clampLines = (lines: string[], count: number, width: number, font: string) => {
    if (lines.length <= count) return lines;
    ctx.font = font;
    return [...lines.slice(0, count - 1), fitText(ctx, `${lines[count - 1].replace(/-$/, "")}…`, width)];
  };

  /**
   * A day's dates in its cell, `ch` tall: the chips beside the number when titles share the day; a chip alone a
   * tile when `tiles` says its week's days hold one; each title whole at the largest size its day allows — with
   * its glyphs and details while they cost it no more than a step or two, then without — and only when none is
   * whole at the floor, cut with «…», each still with its hour, over it or leading its line, and at the very
   * last one line each and «+2 altele», never hiding the month's race nor its hour.
   */
  const planDay = (entries: CalendarImageEntry[], ch: number, tiles: boolean): DayPlan => {
    const memo = `${entries[0]?.day ?? 0} ${ch.toFixed(2)} ${tiles}`;
    const known = planned.get(memo);
    if (known) return known;
    const plan = planDayAt(entries, ch, tiles);
    planned.set(memo, plan);
    return plan;
  };
  /** The same day at the same height is planned once: the key's placements try many weeks' heights. */
  const planned = new Map<string, DayPlan>();
  const planDayAt = (entries: CalendarImageEntry[], ch: number, tiles: boolean): DayPlan => {
    const { chips, titled, order } = split(entries);
    const card = titled.length > 1;
    const pad = card ? cardPad : 0;
    const textW = innerW - 2 * pad;
    const tint: CalendarTone | null =
      titled.length === 1 ? (titled[0].tone === "weekly" ? null : titled[0].tone) : titled.length === 0 && chips.some((chip) => chip.special) ? "special" : null;
    let { head, rest } = titled.length > 0 ? beside(chips) : { head: [] as Chip[], rest: chips };
    const pillOf = (chip: Chip): Piece => ({ kind: "pill", chip: narrowed(chip, pillFit(chip)), from: chip, h: pillFit(chip) });
    const chipPieces = (list: Chip[]): Piece[] => (tiles && titled.length === 0 && list.length === 1 && tileW(list[0]) <= innerW ? [{ kind: "tile", chip: list[0], from: list[0], h: tileH }] : list.map(pillOf));
    const stackH = (pieces: Piece[]) => sum(pieces.map((piece) => piece.h)) + Math.max(0, pieces.length - 1) * gap;
    let pieces = chipPieces(rest);
    // A day whose room cannot stack its chips puts what it can beside the number.
    if (titled.length === 0 && stackH(pieces) > ch - areaTopOf(number * 0.74) - p) {
      ({ head, rest } = beside(chips));
      pieces = rest.map(pillOf);
    }
    const headH = Math.max(number * 0.74, head.length > 0 ? headChipH : 0);
    const areaTop = areaTopOf(headH);
    const areaH = ch - areaTop - p;
    const chipsH = stackH(pieces);
    // A hundredth of a pixel over is not over: a week as tall as its day asked must hold it.
    const room = areaH - chipsH - (pieces.length > 0 && titled.length > 0 ? gap : 0) - Math.max(0, titled.length - 1) * gap + 0.01;
    /** `lost`: how much of the day's titles the reader does not get, a whole title counting one. */
    const build = (blocks: Block[], more: number, cut: Titled[], lost = 0, mark: CalendarTone | null = null): DayPlan => {
      const placed: Piece[] = [];
      for (const item of order) {
        if ("series" in item) {
          const piece = pieces.find((each) => each.kind !== "titled" && each.from === item);
          if (piece) placed.push(piece);
        } else {
          const block = blocks.find((each) => each.item === item);
          if (block) placed.push({ kind: "titled", ...block });
        }
      }
      return { headH, head, areaTop, areaH, card, pieces: placed, more, mark, tint, cut: cut.map((item) => item.entry), lost };
    };
    if (titled.length === 0) return build([], 0, []);

    // Every title whole: the glyphs and all the details first, a detail at a time less, then no glyphs — each
    // richer setting only while the title keeps 85 % of its largest size (to the floor in a day as tall as the
    // richest needs); the plainest down to the floor.
    const cap = Math.max(TITLE, Math.min(textW * 0.18, ch * 0.11, 30 * u));
    const lone = titled.length === 1;
    const most = Math.max(...titled.map((item) => item.details.length));
    const levels = [...Array.from({ length: most + 1 }, (_, index) => ({ keep: most - index, glyph: lone })), ...(lone ? [{ keep: 0, glyph: false }] : [])];
    for (const [index, level] of levels.entries()) {
      // A day its week grew for the glyphs and details takes them down to the floor.
      const lowest = index === levels.length - 1 || ch + 0.5 >= needOf(entries, tiles, true) ? TITLE : Math.max(TITLE, cap * 0.85);
      for (const size of sizesFrom(cap, lowest)) {
        const blocks = blocksAt(titled, size, level.keep, level.glyph ? loneGlyph : 0, textW, pad);
        if (blocks && sum(blocks.map((block) => block.h)) <= room) return build(blocks, 0, []);
      }
    }

    // Cut, at the floor, three ways: each title over its hour (the poster's own); the hour leading the title's
    // first line; or, when the hour would leave the title too little of it, the title alone (the key says the
    // hour) — but the month's race keeps its hour whatever the others do, over it (`bare`) or, where that line
    // is not there, leading it (`lean`): the race, then its hour, is what the sheet says after the month. Each
    // title gets one line, then more go round to whichever is cut.
    type Mode = "stacked" | "inline" | "bare" | "lean";
    const font = face(TITLE, 700);
    const leadOf = (item: Titled) => (item.entry.cancelled ? data.words.cancelled : (item.entry.time ?? ""));
    const modeOf = (item: Titled, mode: Mode): Mode => (!isRace(item) ? (mode === "lean" ? "bare" : mode) : mode === "bare" || (mode === "lean" && !leadOf(item)) ? "stacked" : mode === "lean" ? "inline" : mode);
    const textOf = (item: Titled, mode: Mode) => (modeOf(item, mode) === "inline" && leadOf(item) ? `${leadOf(item)} ${item.title}` : item.title);
    const linesOf = (item: Titled, mode: Mode) => wrapLines(textOf(item, mode), textW, font);
    const notesFor = (item: Titled, mode: Mode) => (modeOf(item, mode) === "stacked" ? notesOf(item, TITLE, 0, textW) : []);
    const heightOf = (item: Titled, lines: number, mode: Mode) => lines * lineStep(TITLE) + notesFor(item, mode).length * noteStep(TITLE) + 2 * pad;
    const letters = (text: string) => text.replace(/[\s…-]/g, "").length;
    /** The title's letters a cut line keeps, its hour's left out. */
    const kept = (item: Titled, lines: string[], mode: Mode) => letters(lines.join("")) - (modeOf(item, mode) === "inline" ? letters(leadOf(item)) : 0);
    const blockOf = (item: Titled, count: number, mode: Mode): Block => ({
      item,
      lines: clampLines(linesOf(item, mode), count, textW, font),
      size: TITLE,
      glyph: 0,
      notes: notesFor(item, mode),
      inline: modeOf(item, mode) === "inline",
      h: heightOf(item, count, mode),
    });
    /** Whether a title is drawn without its hour — bare, or «inline» with no hour to lead it: the key owes the date its hour. */
    const hourless = (item: Titled, mode: Mode) => modeOf(item, mode) === "bare" || (modeOf(item, mode) === "inline" && !leadOf(item));
    /** How much of a date its day does not say: the title's letters cut, and a quarter of a title for a missing hour. */
    const lostOf = (block: Block) => {
      const cutOff = 1 - Math.min(1, kept(block.item, block.lines, block.inline ? "inline" : "bare") / Math.max(1, letters(block.item.title)));
      const hour = block.notes.length > 0 || (block.inline && leadOf(block.item) !== "");
      return Math.min(1, cutOff + (hour ? 0 : 0.25));
    };
    const share = (mode: Mode) => {
      const need = titled.map((item) => linesOf(item, mode).length);
      const counts = titled.map(() => 1);
      const total = () => sum(titled.map((item, index) => heightOf(item, counts[index], mode)));
      if (total() > room) return null;
      // The race takes all its lines first; then the others a line at a time, round.
      titled.forEach((item, index) => {
        while (isRace(item) && counts[index] < need[index]) {
          counts[index] += 1;
          if (total() > room) {
            counts[index] -= 1;
            break;
          }
        }
      });
      for (let grew = true; grew; ) {
        grew = false;
        titled.forEach((_, index) => {
          if (counts[index] >= need[index]) return;
          counts[index] += 1;
          if (total() <= room) grew = true;
          else counts[index] -= 1;
        });
      }
      return { mode, counts, need };
    };
    // Over its hour while every title keeps two lines at least; else the hour leading while it leaves each title
    // eight letters at least; else the titles alone — of those, first one that keeps the race whole.
    const ways = (["stacked", "inline", "bare", "lean"] as const).map(share);
    type Way = NonNullable<ReturnType<typeof share>>;
    const enough = (way: Way) =>
      way.mode === "stacked"
        ? way.counts.every((count, index) => count >= Math.min(2, way.need[index]))
        : way.mode === "bare" || way.mode === "lean" || titled.every((item, index) => kept(item, blockOf(item, way.counts[index], "inline").lines.slice(0, 1), "inline") >= 8);
    const raceWhole = (way: Way) => titled.every((item, index) => !isRace(item) || way.counts[index] >= way.need[index]);
    const way = ways.find((each) => each && enough(each) && raceWhole(each)) ?? ways.find((each) => each && enough(each)) ?? ways.find((each) => each);
    if (way) {
      const blocks = titled.map((item, index) => blockOf(item, way.counts[index], way.mode));
      // What the day cut, or drew without its hour, the key names first, whole and with its hour.
      return build(
        blocks,
        0,
        titled.filter((item, index) => way.counts[index] < way.need[index] || hourless(item, way.mode)),
        sum(blocks.map(lostOf)),
      );
    }
    // At the very last: the race whole, its hour leading it, the others one line each, as many as fit, then «+2 altele».
    const moreH = TITLE * 1.2;
    const raceFirst = [...titled].sort((a, b) => Number(isRace(b)) - Number(isRace(a)));
    const linesFor = (item: Titled) => (isRace(item) ? linesOf(item, "lean").length : 1);
    const fits = (count: number, more = count < titled.length) => {
      const shownH = sum(raceFirst.slice(0, count).map((item) => heightOf(item, linesFor(item), "lean")));
      const lines = count + (more ? 1 : 0);
      if (lines === 0) return true;
      return chipsH + shownH + (more ? moreH : 0) + Math.max(0, pieces.length + lines - 1) * gap <= areaH + 0.01;
    };
    let shown = titled.length;
    while (shown > 0 && !fits(shown)) shown -= 1;
    // The race stays in its day where it fits without the «+2 altele» beside it.
    if (shown === 0 && isRace(raceFirst[0]) && fits(1, false)) shown = 1;
    const first = new Set(raceFirst.slice(0, shown));
    const blocks = titled.filter((item) => first.has(item)).map((item) => blockOf(item, linesFor(item), "lean"));
    // A day too short even for «+2 altele» wears the sparkle beside its number, so the reader knows a special
    // date is there; it never spills out of its cell. The key owes every date but the race, which stands whole
    // with its hour.
    const more = shown < titled.length && fits(shown, true) ? titled.length - shown : 0;
    const unshown = titled.find((item) => !first.has(item) && item.entry.special) ?? titled.find((item) => !first.has(item));
    const mark = shown < titled.length && more === 0 && unshown && markFits(head) ? unshown.tone : null;
    return build(blocks, more, titled.filter((item) => !(isRace(item) && first.has(item))), sum(blocks.map(lostOf)) + titled.length - shown, mark);
  };

  /**
   * The least a day may be: its chips beside its number as far as they go, the rest stacked, then a race's title
   * whole with its hour — the month's race is never cut nor hidden in its day — and a line of each other title; or,
   * `tight` 1, for a month that cannot give its weeks even that, one «+N altele» line for the others; or, `tight`
   * 2, for one whose key cannot name its dates even so, the sparkle beside the number where it goes there (else
   * still the «+N altele» line): a day never hides that a special date is in it, and the key names it.
   */
  const leastOf = (entries: CalendarImageEntry[], tight: number) => {
    const { chips, titled } = split(entries);
    const { head, rest } = beside(chips);
    const pills = rest.map(pillFit);
    const pad = titled.length > 1 ? cardPad : 0;
    const race = titled.find(isRace);
    const others = titled.length - (race ? 1 : 0);
    // The race over its hour, or its hour leading it where that is a line less.
    const raceW = innerW - 2 * pad;
    const linesAt = (text: string) => wrap(text, raceW, face(TITLE, 700))?.length ?? 1;
    const lead = race ? (race.entry.cancelled ? data.words.cancelled : (race.entry.time ?? "")) : "";
    const raceH = race
      ? Math.min(linesAt(race.title) * lineStep(TITLE) + notesOf(race, TITLE, 0, raceW).length * noteStep(TITLE), lead ? linesAt(`${lead} ${race.title}`) * lineStep(TITLE) : Infinity) + 2 * pad
      : 0;
    const said = others > 0 && !(tight >= 2 && markFits(head));
    const othersH = !said ? 0 : tight >= 1 ? TITLE * 1.2 : others * (lineStep(TITLE) + 2 * pad) + (others - 1) * gap;
    const pieces = pills.length + (race ? 1 : 0) + (said ? 1 : 0);
    return areaTopOf(Math.max(number * 0.74, head.length > 0 ? headChipH : 0)) + sum(pills) + raceH + othersH + Math.max(0, pieces - 1) * gap + p;
  };
  /**
   * How tall a day must be for its dates to be whole at the floor, its chips a tile when `tiles` says so — and,
   * when `rich`, each with all its details and a lone title with its glyphs, at the least size its day takes
   * them down to (85 % of what its width allows), so a week grown for them does not set its title smaller
   * than a neighbour's.
   */
  const needOf = (entries: CalendarImageEntry[], tiles: boolean, rich = false) => {
    const memo = `${entries[0]?.day ?? 0} ${tiles} ${rich}`;
    const known = needs.get(memo);
    if (known !== undefined) return known;
    const need = needAt(entries, tiles, rich);
    needs.set(memo, need);
    return need;
  };
  const needs = new Map<string, number>();
  const needAt = (entries: CalendarImageEntry[], tiles: boolean, rich: boolean) => {
    const { chips, titled } = split(entries);
    const { head, rest } = titled.length > 0 ? beside(chips) : { head: [] as Chip[], rest: chips };
    const tile = tiles && titled.length === 0 && rest.length === 1 && tileW(rest[0]) <= innerW;
    let h = tile ? tileH : sum(rest.map(pillFit)) + Math.max(0, rest.length - 1) * gap;
    let least = 0;
    if (titled.length > 0) {
      const pad = titled.length > 1 ? cardPad : 0;
      const textW = innerW - 2 * pad;
      const keep = rich ? Math.max(...titled.map((item) => item.details.length)) : 0;
      const glyph = rich && titled.length === 1 ? loneGlyph : 0;
      // planDay's cap is a tenth and a bit of the day's height: a day that size can hold its titles at `size`.
      const size = rich ? Math.max(TITLE, Math.min(textW * 0.18, 30 * u) * 0.85) : TITLE;
      const blocks = blocksAt(titled, size, keep, glyph, textW, pad) ?? blocksAt(titled, TITLE, keep, glyph, textW, pad);
      if (blocks?.[0].size === size) least = size / 0.11;
      h += (rest.length > 0 ? gap : 0) + (titled.length - 1) * gap + (blocks ? sum(blocks.map((block) => block.h)) : 0);
    }
    return Math.max(least, areaTopOf(Math.max(number * 0.74, head.length > 0 ? headChipH : 0)) + h + p);
  };

  /** Draws a day's plan in its cell. */
  const drawDay = (plan: DayPlan, day: number, x: number, y: number) => {
    if (plan.tint) {
      ctx.fillStyle = toneOf(plan.tint)[0];
      ctx.fillRect(x, y, cellW, plan.areaTop + plan.areaH + p);
    }
    // A quiet day's number is lighter, still 3.8:1 on the poster's white (D27).
    const quiet = plan.pieces.length === 0 && plan.head.length === 0 && plan.more === 0 && !plan.mark;
    ctx.fillStyle = palette.cellInk;
    ctx.globalAlpha = quiet ? 0.62 : 1;
    ctx.font = numberFont;
    ctx.textAlign = "left";
    const headTop = y + p * 0.75;
    ctx.fillText(String(day), x + p, headTop + (plan.headH + number * 0.72) / 2);
    ctx.globalAlpha = 1;
    if (plan.mark) drawGlyphs(ctx, [SPECIAL_PATH], x + p + measure(String(day), numberFont) + 6 * u, headTop + (plan.headH - markSize) / 2, markSize, toneOf(plan.mark)[1]);
    // The chips beside the number, right-aligned.
    let chipX = x + cellW - p;
    for (const chip of [...plan.head].reverse()) {
      chipX -= pillW(chip, headChipH);
      drawPill(chip, chipX, headTop + (plan.headH - headChipH) / 2, headChipH);
      chipX -= 4 * u;
    }
    if (plan.pieces.length === 0 && plan.more === 0) return;
    const moreH = plan.more ? TITLE * 1.2 : 0;
    const total = sum(plan.pieces.map((piece) => piece.h)) + Math.max(0, plan.pieces.length - 1) * gap + (moreH ? gap + moreH : 0);
    let cy = y + plan.areaTop + Math.max(0, (plan.areaH - total) / 2);
    const cx = x + cellW / 2;
    for (const piece of plan.pieces) {
      if (piece.kind === "titled") drawBlock(piece, plan.card, x, cy, cx);
      else if (piece.kind === "tile") drawTile(piece.chip, cx - tileW(piece.chip) / 2, cy);
      else drawPill(piece.chip, cx - pillW(piece.chip, piece.h) / 2, cy, piece.h);
      cy += piece.h + gap;
    }
    if (plan.more) {
      ctx.textAlign = "center";
      ctx.fillStyle = palette.title;
      ctx.font = face(TITLE, 700);
      ctx.fillText(fitText(ctx, data.words.more.replace("{count}", String(plan.more)), innerW), cx, cy + TITLE * 0.9);
      ctx.textAlign = "left";
    }
  };
  /** A date that stands alone: its card when the day has several, its glyphs, its title, its hour and details. */
  const drawBlock = (block: Block, card: boolean, x: number, top: number, cx: number) => {
    const [fill, ink] = toneOf(block.item.tone);
    const pad = card ? cardPad : 0;
    if (card) {
      roundRect(ctx, x + p, top, innerW, block.h, 8 * u);
      ctx.fillStyle = fill;
      ctx.fill();
    }
    let ly = top + pad;
    if (block.glyph) {
      drawGlyphs(ctx, block.item.glyphs, cx - glyphsWidth(block.item.glyphs.length, block.glyph) / 2, ly, block.glyph, ink);
      ly += block.glyph * 1.25;
    }
    ctx.font = face(block.size, 700);
    const { entry } = block.item;
    const lead = block.inline ? (entry.cancelled ? data.words.cancelled : (entry.time ?? "")) : "";
    block.lines.forEach((line, index) => {
      const baseline = ly + block.size * 0.88;
      ly += lineStep(block.size);
      // The hour leading the first line in the hour's colour, the title after it in the cell's ink.
      if (index === 0 && lead && (line === lead || line.startsWith(`${lead} `))) {
        const left = cx - ctx.measureText(line).width / 2;
        ctx.textAlign = "left";
        ctx.fillStyle = entry.cancelled ? palette.special[1] : palette.title;
        ctx.fillText(lead, left, baseline);
        ctx.fillStyle = palette.cellInk;
        if (line !== lead) ctx.fillText(line.slice(lead.length + 1), left + ctx.measureText(`${lead} `).width, baseline);
        return;
      }
      ctx.textAlign = "center";
      ctx.fillStyle = palette.cellInk;
      ctx.fillText(line, cx, baseline);
    });
    const size = noteSize(block.size);
    ctx.textAlign = "center";
    ctx.fillStyle = entry.cancelled ? palette.special[1] : palette.title;
    block.notes.forEach((line, index) => {
      ctx.font = face(size, entry.cancelled && index === 0 ? 800 : 500);
      ctx.fillText(line, cx, ly + size * 1.02);
      ly += noteStep(block.size);
    });
    ctx.textAlign = "left";
  };

  // ── The key: what repeats (each series' chip, its name, its rhythm and details), then every special date.
  type KeyRow =
    | { kind: "series"; chip: Chip; name: string; note: string; details: string[] }
    | { kind: "special"; day: number; title: string; race: boolean; tone: CalendarTone; glyphs: string[]; name: string; note: string; details: string[]; entry: CalendarImageEntry | undefined }
    | { kind: "more"; count: number };
  type Section = { title: string; fill: string; rows: KeyRow[] };
  const recurring: Section | null =
    options.legend && chipSeries.length > 0
      ? {
          title: data.words.recurringTitle,
          fill: palette.band,
          rows: chipSeries.map((row, index) => ({
            kind: "series",
            chip: { series: index, text: "", glyphs: eventGlyphs(row.type, row.surface), cancelled: false, special: false, hour: false },
            name: upper(row.title),
            note: row.sentence,
            details: detailWords(row, options.details),
          })),
        }
      : null;
  const specials: KeyRow[] = [...data.specials]
    .sort((a, b) => a.day - b.day)
    .map((row) => {
      const entry = data.entries.find((each) => each.day === row.day && each.title === row.title);
      return {
        kind: "special",
        day: row.day,
        title: row.title,
        race: row.type === "RACE",
        tone: entry ? markOf(entry) : row.tone === "weekly" ? "special" : row.tone,
        glyphs: eventGlyphs(row.type, row.surface),
        name: upper(row.title),
        note: entry ? hourOf(entry) : "",
        details: entry?.cancelled ? [] : detailWords(row, options.details),
        entry,
      };
    });
  const specialSection = (rows: KeyRow[]): Section => ({ title: data.words.specialTitle, fill: palette.special[1], rows });

  /** The key's measures at `size`: the inset round and between everything, the notes, the leads, the pills. */
  const keyMetrics = (size: number) => {
    const note = Math.max(NOTE, size * 0.86);
    return { inset: size * 0.5, note, glyph: Math.max(GLYPH, note * 1.15), chip: Math.max(30 * t, size * 1.5), badge: size * 2, pill: size * 1.6, pad: size * 0.35 };
  };
  type KeyMetrics = ReturnType<typeof keyMetrics>;
  /**
   * How much the key says: each series' rhythm and details, and the special dates' details. The series give way
   * first (the owner's order: the special dates outrank the weekly rhythm) — their details, then the specials'
   * details, then their rhythm, the row its chip and its name on a line, side by side where the panel is wide.
   * The series' rows themselves never go: the key is the one place a series is named. The last (`rescue`) only to
   * name a date that would be named nowhere whole, or to squeeze a week less.
   */
  type Trim = { name: string; rhythm: boolean; series: boolean; special: boolean; rescue: boolean };
  const TRIMS: readonly Trim[] = [
    { name: "all", rhythm: true, series: true, special: true, rescue: false },
    { name: "special details", rhythm: true, series: false, special: true, rescue: false },
    { name: "rhythm", rhythm: true, series: false, special: false, rescue: false },
    { name: "names", rhythm: false, series: false, special: false, rescue: true },
  ];
  type KeyItem = { row: KeyRow; lines: string[]; notes: string[]; h: number };
  /**
   * A section set out: its pill, then its rows poured left to right, then down, `columns` across, from (x, y) —
   * or, `aside` the width of the pills (the plainest key, on a wide panel), its pill at the left with its «+N
   * altele» under it, and its rows beside them: a pill's line given to the rows.
   */
  type KeyBlock = { section: Section; leadW: number; items: KeyItem[]; more: KeyItem | null; aside: number; heights: number[]; columns: number; colW: number; x: number; y: number; h: number };
  type KeyLayout = { size: number; trim: Trim; blocks: KeyBlock[]; h: number };
  const leadWidth = (row: KeyRow, m: KeyMetrics) => (row.kind === "series" ? pillW(row.chip, m.chip) : row.kind === "special" ? m.badge : 0);
  /** A row of the key in a column: its name's lines, then its note's — null when a word or the note will not go. */
  const keyItem = (row: KeyRow, colW: number, leadW: number, size: number, m: KeyMetrics, trim: Trim): KeyItem | null => {
    if (row.kind === "more") return { row, lines: [data.words.more.replace("{count}", String(row.count))], notes: [], h: size * 1.4 };
    const textW = colW - 2 * m.pad - leadW - size * 0.5;
    if (textW < 90 * u) return null;
    const lines = wrap(row.name, textW, face(size, 700));
    if (!lines || lines.length > 4) return null;
    const noteFont = face(m.note, 500);
    let notes: string[] = [];
    let lead = 0;
    if (row.kind === "series") {
      // A series without its rhythm is its chip and its name: the grid's chips say the weekday and the hour.
      const sentence = trim.rhythm ? wrap(row.note, textW, noteFont) : [];
      if (!sentence || sentence.length > 2) return null;
      notes = sentence;
    } else {
      lead = glyphsWidth(row.glyphs.length, m.glyph) + m.note * 0.4;
      if (measure(row.note, noteFont) > textW - lead) return null;
      notes = row.note ? [row.note] : [];
    }
    if (row.kind === "series" ? trim.series : trim.special) notes = withDetails(notes, row.details, textW, noteFont, lead);
    const textH = lines.length * size * 1.16 + notes.length * m.note * 1.3;
    return { row, lines, notes, h: Math.max(row.kind === "series" ? m.chip : m.badge, textH) + 2 * m.pad };
  };
  const rowIds = new Map<KeyRow, number>();
  const sectionBlocks = new Map<string, Omit<KeyBlock, "x" | "y"> | null>();
  /** One section across `w`, its pill over its rows or `aside` wide beside them: of the column counts whose rows fit, the one that sets it lowest. */
  const sectionBlock = (section: Section, w: number, size: number, m: KeyMetrics, trim: Trim, aside = 0): Omit<KeyBlock, "x" | "y"> | null => {
    const rowsKey = section.rows.map((row) => (row.kind === "more" ? `+${row.count}` : (rowIds.get(row) ?? rowIds.set(row, rowIds.size).size - 1))).join(",");
    const memo = `${section.title}|${rowsKey}|${w.toFixed(2)}|${size}|${trim.name}|${aside.toFixed(2)}`;
    if (!sectionBlocks.has(memo)) sectionBlocks.set(memo, sectionBlockAt(section, w, size, m, trim, aside));
    const known = sectionBlocks.get(memo) ?? null;
    // The rows of a section made anew are the same rows: the block names the section it was asked for.
    return known && { ...known, section };
  };
  const sectionBlockAt = (section: Section, w: number, size: number, m: KeyMetrics, trim: Trim, aside: number): Omit<KeyBlock, "x" | "y"> | null => {
    let best: Omit<KeyBlock, "x" | "y"> | null = null;
    // Beside the rows, the «+N altele» goes under the pill, where it takes none of their columns.
    const moreRow = aside ? section.rows.find((row) => row.kind === "more") : undefined;
    const rows = section.rows.filter((row) => row !== moreRow);
    const more = moreRow ? keyItem(moreRow, aside, 0, size, m, trim) : null;
    if (more && measure(more.lines[0], face(size, 700)) + m.pad > aside) return null;
    const leadW = Math.max(...rows.map((row) => leadWidth(row, m)));
    const across = aside ? w - aside - m.inset : w;
    for (let columns = 1; columns <= Math.min(3, rows.length); columns += 1) {
      const colW = (across - (columns - 1) * m.inset) / columns;
      if (columns > 1 && colW < 250 * u) break;
      const items = rows.map((row) => keyItem(row, colW, leadW, size, m, trim));
      if (items.some((item) => !item)) continue;
      const placed = items as KeyItem[];
      const heights: number[] = [];
      for (let index = 0; index < placed.length; index += columns) heights.push(Math.max(...placed.slice(index, index + columns).map((item) => item.h)));
      const grid = sum(heights) + (heights.length - 1) * m.inset;
      const h = aside ? Math.max(m.pill + (more ? m.inset * 0.5 + more.h : 0), grid) : m.pill + m.inset + grid;
      if (!best || h < best.h - 0.5) best = { section, leadW, items: placed, more, aside, heights, columns, colW, h };
    }
    return best;
  };
  const pillSizeOf = (size: number) => Math.max(TITLE, size * 0.9);
  /** How wide a section's pill is: its title in capitals, and its round ends. */
  const pillWidth = (section: Section, size: number) => measure(upper(section.title), face(pillSizeOf(size), 800)) + size * 1.3;
  /**
   * The key across `w` at `size`, the same inset round it and between everything: its sections one under the
   * other, or — two of them, where that sets the key lower (a wide strip) — side by side; and, in the plainest
   * key (`rescue`), one under the other with their pills beside their rows, where that sets it lower still.
   */
  const keyLayout = (sections: Section[], w: number, size: number, trim: Trim): KeyLayout | null => {
    const m = keyMetrics(size);
    const inner = w - 2 * m.inset;
    let best: KeyLayout | null = null;
    const asides = trim.rescue ? [0, Math.max(...sections.map((section) => pillWidth(section, size)))] : [0];
    for (const aside of asides) {
      const stacked = sections.map((section) => sectionBlock(section, inner, size, m, trim, aside));
      if (!stacked.every((block) => block)) continue;
      let y = m.inset;
      const blocks = (stacked as Omit<KeyBlock, "x" | "y">[]).map((block) => {
        const placed = { ...block, x: m.inset, y };
        y += block.h + m.inset * 1.4;
        return placed;
      });
      const h = y - m.inset * 0.4;
      if (!best || h < best.h - 0.5) best = { size, trim, blocks, h };
    }
    if (sections.length === 2) {
      const half = (inner - m.inset * 1.4) / 2;
      const side = sections.map((section) => sectionBlock(section, half, size, m, trim));
      const h = Math.max(...side.map((block) => block?.h ?? Infinity)) + 2 * m.inset;
      if (side.every((block) => block) && (!best || h < best.h - 0.5)) {
        best = { size, trim, blocks: (side as Omit<KeyBlock, "x" | "y">[]).map((block, index) => ({ ...block, x: m.inset + index * (half + m.inset * 1.4), y: m.inset })), h };
      }
    }
    return best;
  };
  /** The largest size from `from` down to the floor, a pixel at a time, at which the key fits `maxH`; null when none does. */
  const fitKey = (sections: Section[], w: number, maxH: number, from: number, trim: Trim): KeyLayout | null => {
    for (const size of sizesFrom(from, TITLE, u)) {
      const layout = keyLayout(sections, w, size, trim);
      if (layout && layout.h <= maxH + 0.01) return layout;
    }
    return null;
  };
  const drawKey = (layout: KeyLayout, x0: number, y0: number) => {
    const { size } = layout;
    const m = keyMetrics(size);
    const pillSize = pillSizeOf(size);
    for (const block of layout.blocks) {
      const x = x0 + block.x;
      let y = y0 + block.y;
      // The section's pill, over its rows or beside them with its «+N altele» under it.
      ctx.font = face(pillSize, 800);
      const label = fitText(ctx, upper(block.section.title), (block.aside || block.colW * block.columns) - size * 1.3);
      roundRect(ctx, x, y, ctx.measureText(label).width + size * 1.3, m.pill, m.pill / 2);
      ctx.fillStyle = block.section.fill;
      ctx.fill();
      ctx.fillStyle = palette.bandInk;
      ctx.textAlign = "left";
      ctx.fillText(label, x + size * 0.65, y + m.pill / 2 + pillSize * 0.36);
      if (block.more) drawKeyItem(block.more, 0, x, y + m.pill + m.inset * 0.5, block.aside, block.more.h, size, m);
      const rowsX = x + (block.aside ? block.aside + m.inset : 0);
      if (!block.aside) y += m.pill + m.inset;
      block.heights.forEach((rowH, line) => {
        block.items.slice(line * block.columns, (line + 1) * block.columns).forEach((item, column) => {
          drawKeyItem(item, block.leadW, rowsX + column * (block.colW + m.inset), y, block.colW, rowH, size, m);
        });
        y += rowH + m.inset;
      });
    }
  };
  const drawKeyItem = (item: KeyItem, leadW: number, x: number, y: number, w: number, h: number, size: number, m: KeyMetrics) => {
    const { row } = item;
    const mid = y + h / 2;
    if (row.kind === "more") {
      ctx.font = face(size, 700);
      ctx.fillStyle = palette.title;
      ctx.textAlign = "left";
      ctx.fillText(item.lines[0], x + m.pad, mid + size * 0.36);
      return;
    }
    if (row.kind === "special") {
      roundRect(ctx, x, y, w, h, 10 * u);
      ctx.fillStyle = toneOf(row.tone)[0];
      ctx.fill();
      roundRect(ctx, x + m.pad, mid - m.badge / 2, m.badge, m.badge, 9 * u);
      ctx.fillStyle = palette.cell;
      ctx.fill();
      ctx.fillStyle = palette.cellInk;
      ctx.font = face(Math.max(18 * t, size * 1.05), 800);
      ctx.textAlign = "center";
      ctx.fillText(String(row.day), x + m.pad + m.badge / 2, mid + size * 0.38);
      ctx.textAlign = "left";
    } else {
      drawPill(row.chip, x + m.pad, mid - m.chip / 2, m.chip);
    }
    const textX = x + m.pad + leadW + size * 0.5;
    let ty = mid - (item.lines.length * size * 1.16 + item.notes.length * m.note * 1.3) / 2;
    ctx.fillStyle = palette.cellInk;
    ctx.font = face(size, 700);
    for (const line of item.lines) {
      ctx.fillText(line, textX, ty + size * 0.88);
      ty += size * 1.16;
    }
    item.notes.forEach((line, index) => {
      let noteX = textX;
      // A special's glyphs lead its hour, in its day's ink.
      if (index === 0 && row.kind === "special") {
        noteX += drawGlyphs(ctx, row.glyphs, textX, ty + (m.note * 1.3 - m.glyph) / 2, m.glyph, toneOf(row.tone)[1]) + m.note * 0.4;
      }
      ctx.font = face(m.note, row.kind === "special" && row.entry?.cancelled && index === 0 ? 800 : 500);
      ctx.fillStyle = palette.title;
      ctx.fillText(line, noteX, ty + m.note * 1.02);
      ty += m.note * 1.3;
    });
  };

  // ── Where everything goes. The key goes, whole, into a run of empty days — the last week's, then the first
  // week's — and that week grows to hold it; or into a strip under the grid. The weeks share what is left, a
  // week whose titles need more taking it from the quiet ones, none under what its days need at the least. Of
  // the places, the first in that order that squeezes no week and leaves no date named nowhere whole that
  // another would name — so the key keeps its place on every format a month allows.
  const leadCount = weeks[0].findIndex((day) => day.inMonth);
  const lastWeek = weeks[weeks.length - 1];
  let trailCount = 0;
  while (trailCount < 7 && !lastWeek[6 - trailCount].inMonth) trailCount += 1;
  type Run = { row: number; first: number; count: number };
  const leadRun: Run | null = leadCount > 0 ? { row: 0, first: 0, count: leadCount } : null;
  const trailRun: Run | null = trailCount > 0 ? { row: weeks.length - 1, first: 7 - trailCount, count: trailCount } : null;
  const margin = 4 * u;
  /** The least each week may be: what its days need at the very least. */
  const leastFor = (tight: number) => weeks.map((week) => Math.max(0, ...week.filter((day) => day.inMonth).map((day) => leastOf(byDay.get(day.day) ?? [], tight))));
  let leastWeek = leastFor(0);
  const stripGap = 16 * u;
  const room = content.h - weekdayH;
  const allSpecials = options.legend && specials.length > 0 ? specialSection(specials) : null;
  const sections = [recurring, allSpecials].filter((section): section is Section => section !== null);
  /** Part of the key in a run (`run`) or in the strip (`run` null). */
  type Place = { run: Run | null; sections: Section[] };
  const placements: Place[][] = [];
  if (sections.length > 0) {
    for (const run of [trailRun, leadRun]) if (run && run.count >= 2) placements.push([{ run, sections }]);
    placements.push([{ run: null, sections }]);
  } else placements.push([]);

  const nameOf = (row: KeyRow) => (row.kind === "special" ? `${row.day} ${row.title}` : "");
  type Fitted = { place: Place; layout: KeyLayout; hidden: KeyRow[] };
  /**
   * A place's key with `keep` of the specials — the race first, then the ones their day `cut` or drew without
   * their hour, then by day — and a «+N» row for the rest, as much of each row as `trim`
   * says; as large as it fits: a strip within a fifth of the body, else at the
   * floor within three tenths; a run from 18 px within its week's bound. Null when it does not fit.
   */
  const fitPlace = (place: Place, cut: ReadonlySet<string>, keep: number, trim: Trim, taken: ReadonlyMap<number, number>): Fitted | null => {
    const w = place.run ? place.run.count * cellW - 2 * margin : content.w;
    // A run's week to about twice the others; when not even the series fit so, what the other weeks can spare
    // over their least — a week already holding part of the key at its height. The strip within three tenths of
    // the body, else what the weeks can spare, else whatever it takes: the key is never left out.
    const spare = (except: number) => room - sum(leastWeek.map((least, row) => (row === except ? 0 : (taken.get(row) ?? least))));
    const bounds = place.run ? [Math.min(ordinary * 2.2, spare(place.run.row)), spare(place.run.row)].map((h) => h - 2 * margin) : [content.h * 0.3, spare(-1) - stripGap, Infinity];
    const special = place.sections.find((section) => section === allSpecials);
    const all = special?.rows ?? [];
    // The race first — its day holds it whole over its hour, but after the month it is what the sheet says
    // first, and «+N altele» never stands for it; then what a day cut, so it is named whole somewhere; then the
    // rest by day.
    const rank = (row: KeyRow) => (row.kind === "special" && row.race ? 0 : cut.has(nameOf(row)) ? 1 : 2);
    const shown = new Set([...all].sort((a, b) => rank(a) - rank(b)).slice(0, keep));
    const rows = all.filter((row) => shown.has(row));
    // A section that would name none of them is left out, rather than a lone «+5 altele».
    const list = place.sections
      .filter((section) => section !== special || rows.length > 0)
      .map((section) => (section === special ? specialSection(rows.length < all.length ? [...rows, { kind: "more", count: all.length - rows.length }] : rows) : section));
    if (list.length === 0) return null;
    for (const maxH of bounds) {
      const layout = (!place.run && rows.length === all.length ? fitKey(list, w, content.h * 0.2, 22 * t, trim) : null) ?? fitKey(list, w, maxH, place.run ? 18 * t : TITLE, trim);
      if (layout) return { place, layout, hidden: all.filter((row) => !shown.has(row)) };
    }
    return null;
  };

  /** `tiles`: the weeks whose lone chips are tiles. */
  type Arranged = { fitted: Fitted[]; rows: number[]; tiles: ReadonlySet<number> };
  const daysOf = (row: number) => weeks[row].filter((day) => day.inMonth).map((day) => byDay.get(day.day) ?? []);
  /** The weeks' heights: a week holding the key keeps its height, every week asks what its days need whole. */
  const arrange = (fitted: Fitted[]): Arranged => {
    const strip = fitted.find((each) => !each.place.run);
    const available = room - (strip ? strip.layout.h + stripGap : 0);
    const keyAsk = new Map<number, number>();
    for (const { place, layout } of fitted) if (place.run) keyAsk.set(place.run.row, Math.max(keyAsk.get(place.run.row) ?? 0, layout.h + 2 * margin));
    const asks = (tiles: ReadonlySet<number>, rich: boolean) => weeks.map((_, row) => Math.max(keyAsk.get(row) ?? 0, ...daysOf(row).map((entries) => needOf(entries, tiles.has(row), rich))));
    const hard = weeks.map((_, row) => keyAsk.has(row));
    const heights = (tiles: ReadonlySet<number>) => {
      // The weeks ask for the dates' glyphs and details too while that costs a week that gains nothing by them
      // under a sixth of its height — a week with no date gives up nothing its days need.
      const plainAsks = asks(tiles, false);
      const richAsks = asks(tiles, true);
      const plain = weekHeights(plainAsks, available, hard, leastWeek);
      if (sum(richAsks) > available) return plain;
      const richer = weekHeights(richAsks, available, hard, leastWeek);
      const paying = weeks.map((_, row) => row).filter((row) => !hard[row] && richAsks[row] <= plainAsks[row] + 0.5 && daysOf(row).some((entries) => entries.length > 0));
      return paying.every((row) => richer[row] >= plain[row] * 0.85) ? richer : plain;
    };
    // A lone chip is a tile in a week whose every day holds one — its need with the tile no more than its week;
    // the weeks that do not are given pills, and the heights worked out again, until they hold still.
    const tiles = new Set(weeks.map((_, row) => row));
    for (;;) {
      const rows = heights(tiles);
      const failing = [...tiles].filter((row) => daysOf(row).some((entries) => needOf(entries, true) > Math.max(rows[row], needOf(entries, false)) + 0.5));
      if (failing.length === 0) return { fitted, rows, tiles };
      for (const row of failing) tiles.delete(row);
    }
  };
  const planAll = (arranged: Arranged) => {
    const plans = new Map<number, DayPlan>();
    weeks.forEach((week, row) => {
      for (const day of week) if (day.inMonth) plans.set(day.day, planDay(byDay.get(day.day) ?? [], arranged.rows[row], arranged.tiles.has(row)));
    });
    return plans;
  };
  type Outcome = { arranged: Arranged; plans: Map<number, DayPlan>; score: number[] };
  /**
   * Whether score `a` is the better: fewer weeks squeezed under what their days need at the least (only the
   * key's last resort does that), then fewer dates named nowhere whole (cut in their day and left out of the
   * key), then less of the titles lost in the days — a title under «+N» all of it — then fewer key rows left out.
   */
  const better = (a: number[], b: number[]) => {
    for (let index = 0; index < a.length; index += 1) if (Math.abs(a[index] - b[index]) > 0.01) return a[index] < b[index];
    return false;
  };
  /** The key's places filled, the weeks set and the days planned, and how well the reader is served. */
  const evaluate = (placement: Place[], cut: ReadonlySet<string>, keep: number, trim: Trim): (Outcome & { cut: Set<string> }) | null => {
    // The places in turn, each bounded by what the ones before it left.
    const taken = new Map<number, number>();
    const fitted: Fitted[] = [];
    for (const place of placement) {
      const each = fitPlace(place, cut, keep, trim, taken);
      if (!each) return null;
      if (place.run) taken.set(place.run.row, each.layout.h + 2 * margin);
      fitted.push(each);
    }
    const arranged = arrange(fitted);
    const plans = planAll(arranged);
    const nowCut = new Set(data.specials.filter((row) => plans.get(row.day)?.cut.some((entry) => entry.title === row.title)).map((row) => `${row.day} ${row.title}`));
    const hidden = arranged.fitted.flatMap((each) => each.hidden);
    const lost = sum([...plans.values()].map((plan) => plan.lost));
    const squeezed = arranged.rows.filter((height, row) => height < leastWeek[row] - 0.5).length;
    const score = [squeezed, hidden.filter((row) => nowCut.has(nameOf(row))).length, lost, hidden.length];
    return { arranged, plans, score, cut: nowCut };
  };
  /**
   * A placement, the whole key first, as much of its rows as it holds; while a day cuts a title or leaves out
   * its hour, the key gives the days room — the series' details, the specials' details, then the dates their
   * days show whole («+3 altele») — naming first what a day owes it, until it serves them best. The `rescue`
   * trim, the series' rhythm, only where that names a date otherwise named nowhere whole, or squeezes a week
   * less.
   */
  const tryPlacement = (placement: Place[], trims: readonly Trim[]): Outcome | null => {
    const count = allSpecials?.rows.length ?? 0;
    let whole: ReturnType<typeof evaluate> = null;
    for (const trim of trims) {
      for (let keep = count; keep >= 0 && !whole; keep -= 1) whole = evaluate(placement, new Set(), keep, trim);
      if (whole) break;
    }
    if (!whole || whole.score.slice(0, 3).every((value) => value === 0)) return whole;
    let best: Outcome = whole;
    for (const trim of trims) {
      for (let keep = count; keep >= 0; keep -= 1) {
        let cut = whole.cut;
        let outcome = evaluate(placement, cut, keep, trim);
        // A date the smaller key let its day cut is named first too, and the key set again: the list only grows,
        // so this ends.
        while (outcome && [...outcome.cut].some((name) => !cut.has(name))) {
          cut = new Set([...cut, ...outcome.cut]);
          outcome = evaluate(placement, cut, keep, trim);
        }
        if (!outcome) continue;
        if (trim.rescue ? better(outcome.score.slice(0, 2), best.score.slice(0, 2)) : better(outcome.score, best.score)) best = outcome;
        // A smaller key gives the days more room, so their titles may yet come whole: only once nothing is
        // squeezed, named nowhere whole or lost does a smaller key have nothing left to give but rows.
        if (outcome.score[0] === 0 && outcome.score[1] === 0 && outcome.score[2] === 0) break;
      }
    }
    return best;
  };
  let chosen: Outcome | null = null;
  // A line for every title while the month allows it beside its key; else «+N altele» where it must, then the
  // sparkle beside the number — where the weeks would be squeezed, or a date named nowhere whole that the room
  // so given lets the key name. The key has one place, the first in the order — the last week's empty days, the
  // first week's, the strip — that squeezes no more weeks and leaves no more dates named nowhere whole than
  // another would.
  for (const tight of [0, 1, 2]) {
    if (chosen && chosen.score[0] === 0 && chosen.score[1] === 0) break;
    leastWeek = leastFor(tight);
    for (const placement of placements) {
      const outcome = tryPlacement(placement, TRIMS);
      if (outcome && (!chosen || better(outcome.score.slice(0, 2), chosen.score.slice(0, 2)))) chosen = outcome;
    }
  }
  const fallback: Arranged = { fitted: [], rows: weekHeights(weeks.map(() => 0), room), tiles: new Set() };
  const { arranged, plans } = chosen ?? { arranged: fallback, plans: planAll(fallback) };
  const { rows } = arranged;
  const stripFit = arranged.fitted.find((each) => !each.place.run) ?? null;
  const rowTop = rows.map((_, row) => content.y + weekdayH + sum(rows.slice(0, row)));
  const grid: Box = { x: content.x, y: content.y, w: content.w, h: weekdayH + sum(rows) };
  const panels = arranged.fitted.flatMap(({ place, layout }) => {
    const { run } = place;
    if (!run) return [];
    const box: Box = { x: content.x + run.first * cellW + margin, y: rowTop[run.row] + margin, w: run.count * cellW - 2 * margin, h: rows[run.row] - 2 * margin };
    // As large as the run allows, up to 26 px; the panel as tall as its rows, centred in the run.
    const grown = fitKey(layout.blocks.map((block) => block.section), box.w, box.h, 26 * u, layout.trim) ?? layout;
    return [{ run, layout: grown, panel: { x: box.x, y: box.y + Math.max(0, (box.h - grown.h) / 2), w: box.w, h: Math.min(box.h, grown.h) } }];
  });

  // ── The grid: the weekdays in full on a pale row, then the weeks, Monday first.
  roundRect(ctx, grid.x, grid.y, grid.w, grid.h, 18 * u);
  ctx.fillStyle = palette.cell;
  ctx.fill();
  ctx.save();
  ctx.clip();
  ctx.fillStyle = palette.cellMuted;
  ctx.fillRect(grid.x, grid.y, grid.w, weekdayH);
  const weekdaySize = clamp(cellW * 0.13, TITLE, 21 * t);
  ctx.textAlign = "center";
  ctx.font = face(weekdaySize, 800);
  ctx.fillStyle = palette.title;
  data.words.weekdaysLong.forEach((name, index) => {
    ctx.fillText(fitText(ctx, upper(name), cellW - 8 * u), grid.x + index * cellW + cellW / 2, grid.y + weekdayH / 2 + weekdaySize * 0.36);
  });
  ctx.textAlign = "left";

  // The mountains once on the sheet: across a run of empty days the key left free, else quiet behind the key.
  const freeRun = [trailRun, leadRun].find((run) => run && !panels.some((each) => each.run === run)) ?? null;
  if (freeRun) drawRidge(ctx, { x: content.x + freeRun.first * cellW, y: rowTop[freeRun.row], w: freeRun.count * cellW, h: rows[freeRun.row] }, palette.line, 0.6, 0.9);
  panels.forEach(({ panel, layout }, index) => {
    roundRect(ctx, panel.x, panel.y, panel.w, panel.h, 14 * u);
    ctx.fillStyle = palette.cellMuted;
    ctx.fill();
    if (!freeRun && index === 0) {
      ctx.save();
      ctx.clip();
      drawRidge(ctx, panel, palette.line, 0.35, 0.6);
      ctx.restore();
    }
    drawKey(layout, panel.x, panel.y);
  });
  weeks.forEach((week, row) => {
    week.forEach((day, column) => {
      const plan = day.inMonth ? plans.get(day.day) : undefined;
      if (plan) drawDay(plan, day.day, grid.x + column * cellW, rowTop[row]);
    });
  });

  // The grid's lines over the cells, none inside a run of empty days.
  ctx.strokeStyle = palette.line;
  ctx.lineWidth = 2 * u;
  ctx.beginPath();
  weeks.forEach((_, row) => {
    const top = rowTop[row];
    for (let column = 1; column < 7; column += 1) {
      const insideLead = row === 0 && column < leadCount;
      const insideTrail = row === weeks.length - 1 && column > 7 - trailCount;
      if (insideLead || insideTrail) continue;
      ctx.moveTo(grid.x + column * cellW, top);
      ctx.lineTo(grid.x + column * cellW, top + rows[row]);
    }
    ctx.moveTo(grid.x, top);
    ctx.lineTo(grid.x + grid.w, top);
  });
  ctx.stroke();
  ctx.restore();
  roundRect(ctx, grid.x, grid.y, grid.w, grid.h, 18 * u);
  ctx.strokeStyle = palette.line;
  ctx.lineWidth = 3 * u;
  ctx.stroke();

  // The strip, when no run serves the days as well.
  if (stripFit) {
    const box = { x: content.x, y: content.y + content.h - stripFit.layout.h, w: content.w, h: stripFit.layout.h };
    roundRect(ctx, box.x, box.y, box.w, box.h, 18 * u);
    ctx.fillStyle = palette.cellMuted;
    ctx.fill();
    if (!freeRun && panels.length === 0) {
      ctx.save();
      ctx.clip();
      drawRidge(ctx, box, palette.line, 0.35, 0.6);
      ctx.restore();
    }
    drawKey(stripFit.layout, box.x, box.y);
  }
}
