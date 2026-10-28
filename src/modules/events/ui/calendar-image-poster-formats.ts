import type { CalendarImagePalette } from "@/theme/brand";
import { FAR, MOUNTAIN_MARK_VIEWBOX, NEAR } from "@/shared/ui/MountainMark";
import { type Box, CALENDAR_IMAGE_RATIOS, type CalendarImageRatio, type Ctx, detailWords, drawGlyphs, eventGlyphs, fitText, glyphsWidth, roundRect, wrapBalanced } from "./calendar-image-canvas";
import { drawFrame } from "./calendar-image-frame";
import type { CalendarImageAssets, CalendarImageFonts, CalendarImageOptions } from "./calendar-image-draw";
import { monthGrid } from "../domain/calendar";
import type { CalendarTone } from "../domain/calendar-kind";
import type { CalendarImageData, CalendarImageDetails, CalendarImageEntry } from "../domain/calendar-image";

/**
 * «Afiș», «Așezare» → «Legenda dedesubt» (`formats`): chips in the grid and a key — an agenda — in the month's
 * empty days and under the grid, or beside it on 16:9.
 */

/**
 * One date as this layout draws it: the weekly series it belongs to (an index in `recurring`), its colour,
 * whether it is a date of its own (`own`: no series names it), and whether its day names it by its title (a
 * date of its own; every date when the agenda is not drawn, a weekly one only after the dates of their own).
 */
type PosterDate = CalendarImageEntry & { series: number | null; mark: CalendarTone; own: boolean; titled: boolean };

/**
 * A date's chip: its glyphs and its words — the hour, «Anulat» or «ora se anunță» — beside them on one line or
 * two, or (`stacked`) the glyphs over the words when the day is too narrow for both side by side. A series'
 * chip in the agenda has the glyphs alone: the sentence beside it states the hour. Never words without glyphs.
 */
type Pill = { glyphs: string[]; lines: string[]; stacked: boolean; mark: CalendarTone; cancelled: boolean };

/** A horizontal slice of a cell, `h` tall, drawn across `w` from (x, y). */
type Row = { h: number; draw: (x: number, y: number, w: number) => void };

/** How a date's hour is written under its title in a day (`hourRows`). */
type HourForm = "details" | "inline" | "over" | "bare" | "plain";

/** The forms that keep the glyphs beside the hour, the richest first; at the floor, the closest with the glyphs, then without. */
const BESIDE_GLYPHS: HourForm[] = ["details", "inline"];
const FLOOR_FORMS: HourForm[] = ["inline", "over", "bare"];

/** Something laid out — an item of the agenda, a section, the agenda in a box: its height, drawn from its top-left corner. */
type Laid = { h: number; draw: (x: number, y: number) => void };

/**
 * The agenda's sections in a box, stacked or (`beside`) side by side — and, where a section's columns split a
 * day's dates, the same with none split (`edge`), a little taller, for a box that turns out to have the room.
 */
type Boxed = Laid & { beside: boolean; edge: Laid | null };

/**
 * An item of the agenda — a series, a date of its own, «+2 altele» — as it stands at the top of a column or
 * after another day's date (`badged`); (`bare`) under a date of the same `day`, its square not repeated; and
 * (`continued`) at the top of a column after one that ended on a date of the same day: level with a square,
 * but without it — the day's square is at the foot of the column before.
 */
type Entry = { day: number | null; badged: Laid; bare: Laid; continued: Laid };

/** A colour of the palette, read when it is drawn: a composition is drawn in every palette. */
type Paint = () => string;

/** A section of the agenda: its pill's words and colour, and its items. */
type Section = { title: string; fill: Paint; entries: Entry[] };

/** What a section lists: the first `count` series, or the dates of their own and «+N altele» for `hidden` more. */
type Part = { kind: "series"; count: number } | { kind: "own"; dates: PosterDate[]; hidden: number };

/**
 * How the agenda's words are set: its titles' size `a`, how many of a date's details it writes (`level`, 3 for
 * all; `LEAN`, none, nor a date's glyphs and weekday), and `cut`, the most lines a title keeps at the floor
 * before «…» — 0 for every title whole.
 */
type Fit = { a: number; level: number; cut: number };

/** The leanest agenda: no details, and a date of its own without its glyphs and weekday — the grid's chip and the square's tint say them. */
const LEAN = -1;

/**
 * The month composed in full: its plan — none without an agenda — and how far down the composition went for
 * it (`stage`), whether it gave nothing up (`kept`), the grid, and the grid's own words: the weekdays' size and
 * their row's height, the days' numbers' size and their row's.
 */
type Composed = { plan: Plan | null; stage: number; kept: boolean; grid: Grid; headSize: number; headH: number; dn: number; dayRow: number };

/** The empty days before the 1st (`lead`) or after the month's last day (`trail`): their week, first column and count. */
type Run = { which: "lead" | "trail"; row: number; first: number; count: number };

/** Where a section of the agenda goes: an empty run of the grid, or the panel under the grid (beside it on 16:9). */
type Place = Run["which"] | "panel";

/** The grid as drawn: its box, and each week's top and height. */
type Grid = { box: Box; tops: number[]; heights: number[] };

/**
 * The month composed: the grid and its weeks' even share, the agenda's words (`fit`) and parts (`shown`),
 * whether the weeks kept their floor (`strict`), where each part went (`choice`), the sections each run holds
 * and the panel's — and what each place was given to set (`sets`: its width and its parts) — and the
 * wishes granted: `rank` weighing those for a title whole at the floor, `extra` the bonus ones (a title
 * larger, or with the agenda a special's two lines), each wish more than every one after it.
 */
type Plan = { grid: Grid; base: number; fit: Fit; shown: Part[]; strict: boolean; choice: Place[]; hosted: Map<Run["which"], Boxed>; panel: { box: Box; laid: Boxed } | null; sets: Map<Place, { width: number; parts: Part[] }>; granted: number[]; rank: number; extra: number };

/**
 * How each shape composes the month (§855, «Afiș»), as a week's height over a day's width: `soft`, the least a
 * week gets while the whole agenda can be had above it — the readable floor of the grid, under which the
 * agenda's words shrink instead; `hard`, what a week has grown to when the agenda's titles reach `cap`, their
 * largest in pixels of a 1080-wide picture — the two grow together, so neither outranks the other. 16:9 sets
 * the agenda beside the grid, whose weeks share the body's height whatever the agenda's size.
 *
 * `keep` is what of `soft` a week keeps while another week's wish is granted (audit D08): one of bare days —
 * half, a week that needs only its numbers' row giving the special dates the height rather than standing
 * blank — one of chips alone, one with a date of its own; on 1:1 the whole of it but for the bare, the
 * brief's readable rows. `tallest` is the most a wish may raise a week to, over the even week: the race's,
 * any other.
 */
const POSTER_SHAPES: Record<CalendarImageRatio, { soft: number; hard: number; cap: number; keep: { bare: number; chips: number; titled: number }; tallest: { race: number; other: number } }> = {
  portrait: { soft: 0.75, hard: 1.1, cap: 24, keep: { bare: 0.5, chips: 0.8, titled: 0.9 }, tallest: { race: 2.2, other: 1.7 } },
  square: { soft: 0.76, hard: 0.92, cap: 22, keep: { bare: 0.5, chips: 1, titled: 1 }, tallest: { race: 2.2, other: 1.7 } },
  story: { soft: 0.85, hard: 1.4, cap: 40, keep: { bare: 0.5, chips: 0.8, titled: 0.9 }, tallest: { race: 2.2, other: 1.7 } },
  landscape: { soft: 0.68, hard: 0.68, cap: 30, keep: { bare: 0.5, chips: 0.8, titled: 0.9 }, tallest: { race: 2.2, other: 1.7 } },
};

/** The narrowest column the agenda sets its items in, in pixels of a 1080-wide picture. */
const COLUMN_MIN = 330;

/** The grid's share of the body's width on 16:9, the agenda's column taking the rest. */
const WIDE_GRID = 0.62;

/** The words after an hour, « · » apart, the dot kept with the word before it so no line starts with it. */
const DOT = "\u00a0· ";

/** A detail kept on one line: «≈ 350 m D+» never broken after its «≈». */
const unbroken = (word: string) => word.replace(/ /g, "\u00a0");

/**
 * «Afiș» (§855; the owner, 2026-10-27: «vreau să semene cu ce mi-a dat Amalia», then «I need to organize it
 * better and use the space more efficiently») — the club's hand-made monthly poster, composed for each shape
 * rather than one layout stretched to four:
 *
 * - the band and the foot are the frame's (`calendar-image-frame.ts`); the body between them is the grid's
 *   and the agenda's;
 * - the grid says *when*: each weekly date is a blue chip with its glyphs and its hour, never its series'
 *   title again; a date of its own tints its day and carries its whole title in capitals when the day holds
 *   it, then its glyphs, hour and details — cut to three lines, then two, before it falls to a chip with its
 *   glyphs; a race keeps two lines of its title while its week can give them;
 * - the agenda says *what*: «EVENIMENTE RECURENTE» names each series once, beside the glyphs the grid's chip
 *   wears, with its rhythm and details; «EVENIMENTE SPECIALE» every date of its own with its day in a square of
 *   its tint and its weekday beside it, its full title, hour and details;
 * - one budget (the owner's audit, D06–D08, and his hierarchy: the month, the special dates, the weekly
 *   rhythm, the routine marks): a week is never lower than its busiest day needs, nor than the shape's `soft`
 *   measure while the whole agenda can be had above it; the special dates' weeks are then given their titles
 *   whole — the race's first — the other weeks keeping most of that measure, a week of bare days less; and
 *   only then does the agenda grow, each of its two sections where it costs the weeks least — the month's
 *   empty days before the 1st or after its last, their week growing to hold it, or the panel under the grid.
 *   On 16:9 the panel is the column beside the grid;
 * - in a box, the two sections stand side by side, each under its own pill, when that costs no more than a
 *   quarter over stacking them; stacked, each pill spans the box and its items read down as many columns as
 *   set it lowest. A day's dates stay in one column where the same places and words still grant the grid every
 *   title they did, else the next column's top leaves the day's square out rather than repeat it; and a box
 *   with lines to spare gives them to its titles cut at the floor;
 * - with the «Legendă» unticked nothing names a series, so every date carries its title — the weeks budgeted
 *   the same way: every special named on one line first, the race's week first, then the race's two lines,
 *   then every other special in two, whole — in the lowest forms, then with their glyphs, then with their
 *   days' weekly chips — and only then the weekly dates' titles, at the floor. A special is never smaller
 *   than a routine date; in a week whose special is cut or a chip the weekly dates are chips, and on a
 *   special's day the weekly chips fold into «+1 altele» before the special is cut or falls to a chip (never
 *   a race); a day's last resort keeps the race's chip.
 *
 * Words are at least 17 pixels on a 1080-wide picture — 16 for an hour or a detail line, 18 for a day's number
 * — read at a phone's width; 21 on 16:9. A title is wrapped whole, split with «-» only when a word is wider
 * than its line at every size, and made smaller before it is ever cut. The agenda keeps every detail — the
 * place, the distance, the climb — above the floor; at it they are dropped from the end, then a date's glyphs
 * and weekday, before a title in the grid is cut. When even that cannot hold it all, the grid's own words —
 * the weekdays and the days' numbers — go to the floor, the weeks give up their measure, the dates whose
 * whole title the grid shows step out of the agenda, then its titles keep two lines, then one, cut after a
 * whole word; «+2 altele» comes last, and never instead of a race.
 */
export function drawPosterFormats(ctx: CanvasRenderingContext2D, data: CalendarImageData, options: CalendarImageOptions, fonts: CalendarImageFonts, assets: CalendarImageAssets, palette: CalendarImagePalette): void {
  // The page, the band and the foot are the frame's (`calendar-image-frame.ts`); what is left is the body's.
  const body = drawFrame(ctx, data, options, fonts, assets, palette);
  if (!body) return;
  // The faces as this canvas measures them: one that has loaded since measures otherwise, and is composed anew.
  const faces = [500, 700, 800]
    .map((weight) => {
      ctx.font = `${weight} 40px ${fonts.poster}`;
      return ctx.measureText("ĂȘȚ Wg 0123").width;
    })
    .join(",");
  let made = COMPOSED.get(ctx);
  if (!made || made.faces !== `${fonts.poster}|${faces}`) {
    made = { faces: `${fonts.poster}|${faces}`, widths: new Map(), byData: new WeakMap() };
    COMPOSED.set(ctx, made);
  }
  const byData = made.byData.get(data) ?? new Map<string, (palette: CalendarImagePalette) => void>();
  made.byData.set(data, byData);
  const key = [options.ratio, options.legend, options.details.place, options.details.distance, options.details.elevation, body.x, body.y, body.w, body.h].join("|");
  const draw = byData.get(key) ?? composePosterFormats(ctx, data, options, fonts, body, made.widths);
  byData.set(key, draw);
  draw(palette);
}

/**
 * The compositions drawn on a canvas, by the faces it measured them in, the month's data and what shapes them
 * — the format, «Legendă», «Detalii», the body's box — with the widths it measured: the dialog draws again on
 * each change, and a change of «Temă», or the logo arriving, only paints again; the palette never moves a word.
 */
const COMPOSED = new WeakMap<CanvasRenderingContext2D, { faces: string; widths: Map<string, Map<string, number>>; byData: WeakMap<CalendarImageData, Map<string, (palette: CalendarImagePalette) => void>> }>();

/** The month composed on `ctx` in `body`, its words measured into `widths`: what draws it in a palette. */
function composePosterFormats(ctx: CanvasRenderingContext2D, data: CalendarImageData, options: CalendarImageOptions, fonts: CalendarImageFonts, body: Box, widths: Map<string, Map<string, number>>): (palette: CalendarImagePalette) => void {
  /** The palette the composition is drawn in, given at each drawing: nothing composed reads it. */
  let palette!: CalendarImagePalette;
  const { width: W, height: H } = CALENDAR_IMAGE_RATIOS[options.ratio];
  const shape = POSTER_SHAPES[options.ratio];
  const wide = options.ratio === "landscape";
  // Lengths follow the short side; words follow the width, since the picture is read at a phone's width —
  // a 16:9 one not quite in proportion, having a square's height for the same month.
  const v = Math.min(W, H) / 1080;
  const u = wide ? W / 1280 : W / 1080;
  // The floors (audit D17, D31): a title, a chip or a key line; an hour or a detail line; a day's number; a
  // chip's glyphs and any other — on 16:9 nothing but the month under 21 pixels.
  const minText = (wide ? 14 : 17) * u;
  const minHour = (wide ? 14 : 16) * u;
  const minDay = (wide ? 15 : 18) * u;
  const minChipGlyph = (wide ? 14 : 20) * u;
  const minGlyph = (wide ? 14 : 18) * u;
  const step = u;
  const gap = 18 * v;
  /** The font at `size` and `weight`, the same string each time it is asked, so the width cache finds it at once. */
  const faces = new Map<number, string>();
  const face = (size: number, weight: number) => {
    const tenths = Math.round(size * 10);
    const key = tenths * 10 + weight / 100;
    let named = faces.get(key);
    if (named === undefined) {
      named = `${weight} ${tenths / 10}px ${fonts.poster}`;
      faces.set(key, named);
    }
    return named;
  };
  const upper = (text: string) => text.toLocaleUpperCase("ro-RO");
  /**
   * The words' font, set on the context only when a width not yet known is measured or a word is drawn: a
   * canvas parses a font each time it is given one and spells it out each time it is asked, and the
   * composition changes it far more often than it measures anything new.
   */
  let current = "";
  let applied: string | null = null;
  let known = new Map<string, number>();
  const setFont = (next: string) => {
    if (next === current) return;
    current = next;
    known = widths.get(next) ?? new Map<string, number>();
    widths.set(next, known);
  };
  const apply = () => {
    if (applied === current) return;
    ctx.font = current;
    applied = current;
  };
  const fill = (text: string, x: number, y: number) => {
    apply();
    ctx.fillText(text, x, y);
  };
  /**
   * The context's `measureText`, remembered by font and text: the composition sets the same words at the same
   * sizes in several boxes before it draws them once, and a canvas measures each time it is asked.
   */
  const sized: Ctx = {
    measureText: (text: string) => {
      let width = known.get(text);
      if (width === undefined) {
        apply();
        width = ctx.measureText(text).width;
        known.set(text, width);
      }
      return { width } as TextMetrics;
    },
  };
  const measure = (text: string, at: string) => {
    setFont(at);
    return sized.measureText(text).width;
  };
  const sum = (items: { h: number }[]) => items.reduce((total, item) => total + item.h, 0);
  const clamp = (value: number, low: number, high: number) => Math.max(low, Math.min(high, value));
  /** The sizes from `from` down to `to`, a step apart, `to` itself last. */
  const sizes = (from: number, to: number) => {
    const list: number[] = [];
    for (let size = from; size >= to - 1e-6; size -= step) list.push(size);
    if (list.length === 0 || list[list.length - 1] > to + 1e-6) list.push(to);
    return list;
  };
  /**
   * `text` cut with «…» to `width` at the context's font after its last whole word, a dash before the cut
   * dropped, when that keeps most of what a cut inside a word would — «NIGHT RUN ON…», not «NIGHT RUN ON TÂM…».
   */
  const fitWords = (text: string, width: number) => {
    const inside = fitText(sized, text, width);
    if (inside === text) return text;
    const words = text.split(" ");
    for (let count = words.length - 1; count >= 1; count -= 1) {
      const kept = `${words.slice(0, count).join(" ").replace(/[\s—–-]+$/u, "")}…`;
      if (sized.measureText(kept).width <= width) return kept.length >= inside.length * 0.6 ? kept : inside;
    }
    return inside;
  };
  /**
   * A title's lines at `font` in `width`: with `cut` 0, whole — a word wider than the line split with «-»
   * unless `hyphenate` is false — or null when a line is still wider; else at most `cut` lines, each fitted,
   * the last ending in «…» when the title goes on (`Infinity`: every line, a word that cannot be split cut).
   */
  const wrapped = new Map<string, string[] | null>();
  const titleLines = (text: string, font: string, width: number, cut: number, hyphenate = true): string[] | null => {
    // Remembered: the composition wraps the same title in the same width many times over.
    const key = `${font}|${width}|${cut}|${hyphenate}|${text}`;
    const remembered = wrapped.get(key);
    if (remembered !== undefined) return remembered;
    setFont(font);
    const lines = wrapBalanced(sized, text, width, { hyphenate });
    let result: string[] | null;
    if (cut === 0) result = lines.every((line) => sized.measureText(line).width <= width + 0.5) ? lines : null;
    else {
      const kept = lines.slice(0, cut).map((line) => fitText(sized, line, width));
      if (lines.length > cut) kept[cut - 1] = fitWords(`${kept[cut - 1].replace(/[-…]$/, "")}…`, width);
      result = kept;
    }
    wrapped.set(key, result);
    return result;
  };
  const inkOf = (mark: CalendarTone) => (mark === "weekly" ? palette.band : palette[mark][1]);

  // ── The dates: a weekly one is known by its series (the same type and title, as `groupSeries` tells them).
  const seriesKey = (type: string, title: string) => `${type}\n${title.trim().toLowerCase().replace(/\s+/g, " ")}`;
  const seriesAt = new Map(data.recurring.map((row, index) => [seriesKey(row.type, row.title), index]));
  // Without the agenda nothing names a series, so every date carries its own title — a weekly one after the
  // dates of their own, and no larger than the floor (the owner's hierarchy: the special dates, then the
  // weekly rhythm, then the routine marks).
  const keyed = options.legend;
  const dates: PosterDate[] = data.entries.map((entry) => {
    const series = seriesAt.get(seriesKey(entry.type, entry.title)) ?? null;
    const mark: CalendarTone = series !== null && !entry.special ? "weekly" : entry.tone === "weekly" ? "special" : entry.tone;
    return { ...entry, series, mark, own: series === null, titled: !keyed || series === null };
  });
  /** A weekly date that carries its title only because no agenda names its series. */
  const routine = (date: PosterDate) => date.titled && !date.own;
  const seriesRows = keyed ? data.recurring : [];
  const singles = keyed ? dates.filter((date) => date.titled) : [];
  const isRace = (date: PosterDate) => date.type === "RACE";
  const weekdayOf = (day: number) => (new Date(Date.UTC(data.month.year, data.month.month - 1, day)).getUTCDay() + 6) % 7;
  const weekdayName = (day: number) => upper(data.words.weekdays[weekdayOf(day)]).replace(/\.$/, "");
  /** «ora 18:00», «Anulat», or «ora se anunță»: what goes where a date's hour is written. */
  const hourOf = (date: PosterDate) => (date.cancelled ? data.words.cancelled : date.time ? data.words.at.replace("{time}", date.time) : data.words.tba);
  /** The same on a chip: the hour bare. */
  const chipText = (date: PosterDate) => (date.cancelled ? data.words.cancelled : (date.time ?? data.words.tba));
  const moreText = (count: number) => data.words.more.replace("{count}", String(count));
  /** The first `level` of a date's details, in order, each kept on one line (`LEAN`: none). */
  const detailsOf = (entry: CalendarImageDetails, level = 3) => detailWords(entry, options.details).slice(0, Math.max(0, level)).map(unbroken);

  // ── Chips ──
  const glyphSize = (p: number) => Math.max(minChipGlyph, p * 1.1);
  const padOf = (p: number) => p * 0.55;
  const lineBoxOf = (p: number, tight: boolean) => p * (tight ? 1.42 : 1.6);
  const linesW = (pill: Pill, p: number) => Math.max(0, ...pill.lines.map((line) => measure(line, face(p, 700))));
  const pillW = (pill: Pill, p: number) => {
    const glyphs = glyphsWidth(pill.glyphs.length, glyphSize(p));
    if (pill.stacked) return 2 * padOf(p) + Math.max(glyphs, linesW(pill, p));
    return 2 * padOf(p) + glyphs + (pill.lines.length > 0 ? p * 0.3 + linesW(pill, p) : 0);
  };
  const pillH = (pill: Pill, p: number, tight = false) => {
    const words = pill.lines.length * p * 1.15;
    if (pill.stacked) return lineBoxOf(p, tight) * 0.6 + glyphSize(p) + p * 0.15 + words;
    return Math.max(lineBoxOf(p, tight) + Math.max(0, words - p * 1.15), glyphSize(p) + p * 0.4);
  };
  /**
   * A date's chip at `p` within `width`: its glyphs and words on one line, or the words on two beside them —
   * and while that fits at the floor, null rather than another shape, so the day takes a smaller chip of the
   * same shape; else the glyphs over the words, at last a word split with «-» under them. Null when none fits:
   * never the words or the glyphs alone (audit D33).
   */
  const pillOf = (date: PosterDate, p: number, width: number): Pill | null => {
    const glyphs = eventGlyphs(date.type, date.surface);
    const shaped = (size: number, stacked: boolean, hyphenate: boolean): Pill | null => {
      setFont(face(size, 700));
      const room = width - 2 * padOf(size) - (stacked ? 0 : glyphsWidth(glyphs.length, glyphSize(size)) + size * 0.3);
      const pill: Pill = { glyphs, lines: wrapBalanced(sized, chipText(date), room, { hyphenate }), stacked, mark: date.mark, cancelled: date.cancelled };
      return pill.lines.length <= 2 && pillW(pill, size) <= width + 0.5 ? pill : null;
    };
    const beside = shaped(p, false, false);
    if (beside || shaped(minText, false, false)) return beside;
    return shaped(p, true, false) ?? shaped(p, true, true);
  };
  const drawPill = (pill: Pill, x: number, y: number, p: number, tight = false) => {
    const w = pillW(pill, p);
    const h = pillH(pill, p, tight);
    const solid = pill.mark === "weekly" && !pill.cancelled;
    const ink = inkOf(pill.mark);
    roundRect(ctx, x, y, w, h, p * 0.8);
    ctx.fillStyle = solid ? palette.band : palette.cell;
    ctx.fill();
    if (!solid) {
      ctx.strokeStyle = ink;
      ctx.lineWidth = Math.max(1.5 * v, p * 0.13);
      ctx.stroke();
    }
    const g = glyphSize(p);
    const glyphsW = glyphsWidth(pill.glyphs.length, g);
    // The words in the day's ink, as the heads and the cells write an hour; only the glyphs and «Anulat» wear
    // the date's colour (audit D15).
    setFont(face(p, 700));
    ctx.fillStyle = solid ? palette.bandInk : pill.cancelled ? ink : palette.cellInk;
    if (pill.stacked) {
      const top = y + lineBoxOf(p, tight) * 0.3;
      drawGlyphs(ctx, pill.glyphs, x + (w - glyphsW) / 2, top, g, solid ? palette.bandInk : ink);
      ctx.textAlign = "center";
      pill.lines.forEach((line, index) => fill(line, x + w / 2, top + g + p * 0.15 + index * p * 1.15 + p * 0.93));
      ctx.textAlign = "left";
      return;
    }
    drawGlyphs(ctx, pill.glyphs, x + padOf(p), y + (h - g) / 2, g, solid ? palette.bandInk : ink);
    const left = x + padOf(p) + glyphsW + p * 0.3;
    const top = y + (h - (pill.lines.length - 1) * p * 1.15) / 2;
    pill.lines.forEach((line, index) => fill(line, left, top + index * p * 1.15 + p * 0.36));
  };
  /** Chips side by side in lines of `width`, each line centred (`tight`: lower and closer). */
  const pillRows = (pills: Pill[], p: number, width: number, tight = false): Row[] => {
    const pillWidths = pills.map((pill) => pillW(pill, p));
    const space = p * 0.35;
    const lines: number[][] = [];
    let used = 0;
    pillWidths.forEach((w, index) => {
      if (lines.length > 0 && used + space + w <= width) {
        lines[lines.length - 1].push(index);
        used += space + w;
      } else {
        lines.push([index]);
        used = w;
      }
    });
    return lines.map((line) => ({
      h: Math.max(...line.map((index) => pillH(pills[index], p, tight))) + p * (tight ? 0.14 : 0.3),
      draw: (x, y, w) => {
        let left = x + (w - line.reduce((total, index) => total + pillWidths[index], 0) - space * (line.length - 1)) / 2;
        for (const index of line) {
          drawPill(pills[index], left, y, p, tight);
          left += pillWidths[index] + space;
        }
      },
    }));
  };
  /** One line of words centred in a cell at `size`, `lead` times as tall, after the glyphs when it has them; its colours read when it is drawn. */
  const textRow = (text: string, font: string, size: number, color: Paint, lead: number, glyph?: { paths: string[]; color: Paint; size: number }): Row => ({
    h: size * lead,
    draw: (x, y, w) => {
      setFont(font);
      const glyphW = glyph ? glyphsWidth(glyph.paths.length, glyph.size) + (text ? size * 0.3 : 0) : 0;
      let left = x + (w - glyphW - (text ? sized.measureText(text).width : 0)) / 2;
      if (glyph) {
        drawGlyphs(ctx, glyph.paths, left, y + (size * lead - glyph.size) / 2, glyph.size, glyph.color());
        left += glyphW;
      }
      ctx.fillStyle = color();
      if (text) fill(text, left, y + size * lead * 0.5 + size * 0.36);
    },
  });

  // ── A day ──
  /**
   * The hour and as many of a date's details as fit `room` beside it at `font`, the climb dropped first; and
   * those left over that fit `width` on a line of their own (`rest`, the climb again the first to go).
   */
  const hourSplit = (date: PosterDate, font: string, room: number, width: number) => {
    const words = detailsOf(date);
    let level = words.length;
    while (level > 0 && measure([hourOf(date), ...words.slice(0, level)].join(DOT), font) > room) level -= 1;
    const rest = words.slice(level);
    while (rest.length > 0 && measure(rest.join(DOT), font) > width) rest.pop();
    return { text: [hourOf(date), ...words.slice(0, level)].join(DOT), rest, dropped: words.length - level - rest.length };
  };
  /**
   * The glyphs and «ora 18:00 · Tâmpa · 6 km» under a title in a day, at `m`, the hour's words in the hours' ink
   * and only the glyphs in the date's colour (audit D15): `inline`, the glyphs and the hour on one line with as
   * many details as fit, the climb dropped first; `details`, the same with the details left over on a line of
   * their own; `over`, the glyphs on a line of their own over the hour and its details, two lines at most;
   * `bare`, the hour and the details that fit without the glyphs — the title says what the date is; `plain`,
   * the same with the details left over on a line of their own, under the large glyphs (`withLargeGlyph`). Null
   * when the form does not fit `width`.
   */
  const hourRows = (date: PosterDate, m: number, width: number, form: HourForm): Row[] | null => {
    const font = face(m, date.cancelled ? 700 : 500);
    const ink = () => inkOf(date.mark);
    const color = date.cancelled ? ink : () => palette.title;
    const glyph = { paths: eventGlyphs(date.type, date.surface), color: ink, size: Math.max(minGlyph, m * 1.1) };
    const besideGlyphs = form === "inline" || form === "details";
    const room = width - (besideGlyphs ? glyphsWidth(glyph.paths.length, glyph.size) + m * 0.3 : 0);
    const { text, rest } = hourSplit(date, font, room, width);
    if (form === "over") {
      setFont(font);
      const lines = wrapBalanced(sized, text, width);
      if (lines.length > 2 || lines.some((line) => sized.measureText(line).width > width + 0.5)) return null;
      return [textRow("", font, m, color, 1.4, glyph), ...lines.map((line) => textRow(line, font, m, color, 1.3))];
    }
    if (measure(text, font) > room) return null;
    // The glyphs (1.1 times the hour, at least the floor's) stand in the hour's own line: beside it they cost
    // the day no height, so a date keeps them wherever its width does.
    const rows = [textRow(text, font, m, color, 1.3, besideGlyphs ? glyph : undefined)];
    if ((form === "details" || form === "plain") && rest.length > 0) rows.push(textRow(rest.join(DOT), face(m, 500), m, () => palette.title, 1.3));
    return rows;
  };
  /** A date's own title in a day, centred in capitals — whole, or at most `cut` lines with «…» — then its hour in `form`; null when either does not fit. */
  const titleRows = (date: PosterDate, s: number, width: number, cut: number, form: HourForm, hyphenate = true): Row[] | null => {
    const font = face(s, 700);
    const lines = titleLines(upper(date.title), font, width, cut, hyphenate);
    const hour = lines && hourRows(date, Math.max(minHour, s * 0.85), width, form);
    return lines && hour ? [...lines.map((line) => textRow(line, font, s, () => palette.cellInk, 1.16)), ...hour] : null;
  };
  /**
   * The day's dates in order as chips at `p`, closer when `tight` — but a date `title` gives rows for stands as
   * those rows (undefined: a chip); null when a chip or a title does not fit.
   */
  const dayRows = (list: PosterDate[], width: number, p: number, tight: boolean, title?: (date: PosterDate) => Row[] | null | undefined): Row[] | null => {
    const rows: Row[] = [];
    let run: PosterDate[] = [];
    const flush = () => {
      const pills = run.map((date) => pillOf(date, p, width));
      run = [];
      if (pills.some((pill) => pill === null)) return false;
      rows.push(...pillRows(pills as Pill[], p, width, tight));
      return true;
    };
    for (const date of list) {
      const block = title?.(date);
      if (block === undefined) run.push(date);
      else if (block === null || !flush()) return null;
      else rows.push(...block);
    }
    return flush() ? rows : null;
  };
  /** Which of a day's dates carry their title: every titled one, or (`own`) the dates of their own, or (`race`) the race, the others chips. */
  type Who = (date: PosterDate) => boolean;
  const everyTitled: Who = (date) => date.titled;
  const ownTitled: Who = (date) => date.titled && date.own;
  /** How many lines a date's title keeps at the floor — 0 whole — or null for its chip. */
  type CutOf = (date: PosterDate) => 0 | 1 | 2 | 3 | null;
  const by =
    (cut: 0 | 1 | 2 | 3, who: Who = everyTitled): CutOf =>
    (date) =>
      who(date) ? cut : null;
  /**
   * Without the agenda, a day's race at two lines and its other dates of their own at one: the race first, and
   * no other special a bare chip for it.
   */
  const raceFirst: CutOf = (date) => (isRace(date) ? 2 : ownTitled(date) ? 1 : null);
  /**
   * A day at the floor, closest: each title `cutOf` names in that many lines at most with its hour — 0 whole —
   * the other dates chips. Each title's hour in the first form that fits its width, the glyphs kept — or
   * (`low`) in the lowest, what a week must give for the title at the least, but for the race, whose flag is
   * kept. Null when a title or a chip does not fit.
   */
  const floorRows = (list: PosterDate[], width: number, cutOf: CutOf | null, low = false): Row[] | null => {
    const titleOf = (date: PosterDate, cut: 0 | 1 | 2 | 3) => {
      const forms = FLOOR_FORMS.map((form) => titleRows(date, minText, width, cut, form)).filter((rows): rows is Row[] => rows !== null);
      return forms.length === 0 ? null : low && !isRace(date) ? forms.reduce((lowest, rows) => (sum(rows) < sum(lowest) - 0.5 ? rows : lowest)) : forms[0];
    };
    return dayRows(list, width, minText, true, (date) => {
      const cut = cutOf?.(date) ?? null;
      return cut === null ? undefined : titleOf(date, cut);
    });
  };
  /** «+2 altele» under a day's dates. */
  const moreRow = (count: number) => textRow(moreText(count), face(minText, 700), minText, () => palette.title, 1.3);
  /**
   * A day's dates as `planDay` may set them: all of them, and — without the agenda, on a day with a date of its
   * own — its weekly dates folded into «+N» under the others, which a special's title is worth (never a race).
   */
  type Way = { shown: PosterDate[]; tail: Row[] };
  const waysOf = (list: PosterDate[]): Way[] => {
    const folded = !keyed && list.some(ownTitled) ? list.filter((date) => !date.own && !isRace(date)) : [];
    return [{ shown: list, tail: [] }, ...(folded.length > 0 ? [{ shown: list.filter((date) => !folded.includes(date)), tail: [moreRow(folded.length)] }] : [])];
  };
  /**
   * A day's dates with every title `who` names whole at `s` — a routine one's at the floor — the chips a step
   * under, in the first of `forms` that fits `height`, as `planDay` tries them at that size (`hyphenate` false:
   * no word split); null when none fits.
   */
  const wholeRows = (list: PosterDate[], width: number, s: number, forms: HourForm[], hyphenate = true, height = Infinity, who: Who = everyTitled): Row[] | null => {
    for (const form of forms) {
      const rows = dayRows(list, width, clamp(s, minText, pMax), false, (date) => (who(date) ? titleRows(date, routine(date) ? Math.min(s, minText) : s, width, 0, form, hyphenate) : undefined));
      if (rows && sum(rows) <= height + 0.5) return rows;
    }
    return null;
  };
  /**
   * A day as drawn: its rows; `whole` when every title it carries is whole, `kept` when every date of its own
   * it names is (a day without one keeps nothing back).
   */
  type DayPlan = { rows: Row[]; whole: boolean; kept: boolean };
  /**
   * What a day `height` tall (its week `rowH`) shows in `width`, best first: the titles of its dates of their
   * own whole at the largest size that fits, from the week's size down to the floor, their hours beside their
   * glyphs — the details on a line of their own while there is room — then over the glyphs, and only then
   * without them, with the chips of its weekly dates a step under, a size with no word split with «-» before
   * one with; the same at the floor with the chips closer; then the titles cut to three lines, two; then a
   * race's two lines and every other date a chip — without the agenda, every other date of its own on one
   * line; then, without the agenda, the titles of its dates of their own on one line, a special named rather
   * than a bare chip; then every date a chip with its glyphs, closer when it must be; at last as many chips as
   * fit, the race first, and «+2 altele» — the race never counted in it.
   *
   * Without the agenda a weekly date's title gives way first (the owner's hierarchy): a special whole and the
   * weekly a chip before either is cut — and `plain`, in a week whose special is not whole, the weekly dates'
   * titles are not drawn at all — then the weekly chips folded into «+N» before a special is cut or falls to a
   * bare chip, a special's glyphs kept before its weekly chips.
   */
  const planDay = (all: PosterDate[], width: number, height: number, rowH: number, plain = false): DayPlan => {
    const list = plain ? all.map((date) => (routine(date) ? { ...date, titled: false } : date)) : all;
    const titled = list.some((date) => date.titled);
    const own = list.some(ownTitled);
    const sMax = clamp(rowH * 0.15, wide ? minText : 20 * u, 24 * u);
    const mixed = list.some(routine) && own;
    const ways = waysOf(list);
    const done = (rows: Row[], way: Way, whole: boolean, who: Who = everyTitled): DayPlan => ({ rows: [...rows, ...way.tail], whole: whole && who === everyTitled && way.tail.length === 0, kept: whole || !own });
    /** The day's titles `who` names whole in `forms`, the largest size first, a size with no word split before one with. */
    const wholeIn = (way: Way, forms: HourForm[], who: Who) => {
      const room = height - sum(way.tail);
      for (const hyphenate of [false, true]) {
        for (const s of sizes(sMax, minText)) {
          const rows = wholeRows(way.shown, width, s, forms, hyphenate, room, who);
          if (rows) return way.shown.length === 1 && way.tail.length === 0 ? withLargeGlyph(way.shown[0], rows, s, width, room) : rows;
        }
      }
      return null;
    };
    /** The same at the floor, closest, each title cut as `cutOf` says: the glyphs kept in every way before none. */
    const floorIn = (group: Way[], cutOf: CutOf) => {
      for (const low of [false, true]) {
        for (const way of group) {
          const rows = floorRows(way.shown, width, cutOf, low);
          if (rows && sum(rows) + sum(way.tail) <= height + 0.5) return { rows, way };
        }
      }
      return null;
    };
    // The glyphs beside the hour at every size before the glyphs over it, and over it before none (D33): first
    // with the weekly dates' titles, then with their chips, then with them folded — the glyphs, at the floor
    // with the chips closer if need be, before the weekly chips, and the weekly chips before none.
    const groups: [Way[], Who][] = !titled ? [] : mixed ? [[[ways[0]], everyTitled], [ways, ownTitled]] : [[ways, everyTitled]];
    for (const [group, who] of groups) {
      if (group.length === 1) {
        for (const forms of [BESIDE_GLYPHS, ["over"], ["bare"]] as HourForm[][]) {
          const rows = wholeIn(group[0], forms, who);
          if (rows) return done(rows, group[0], true, who);
        }
        const close = floorIn(group, by(0, who));
        if (close) return done(close.rows, close.way, true, who);
        continue;
      }
      for (const low of [false, true]) {
        for (const way of group) {
          for (const forms of (low ? [["bare"]] : [BESIDE_GLYPHS, ["over"]]) as HourForm[][]) {
            const rows = wholeIn(way, forms, who);
            if (rows) return done(rows, way, true, who);
          }
          const rows = floorRows(way.shown, width, by(0, who), low);
          if (rows && sum(rows) + sum(way.tail) <= height + 0.5) return done(rows, way, true, who);
        }
      }
    }
    // Cut, the weekly dates' titles given up first.
    const who = mixed ? ownTitled : everyTitled;
    for (const cut of [3, 2] as const) {
      if (!titled) break;
      for (const form of FLOOR_FORMS) {
        for (const way of ways) {
          const rows = dayRows(way.shown, width, minText, true, (date) => (who(date) ? titleRows(date, minText, width, cut, form) : undefined));
          if (rows && sum(rows) + sum(way.tail) <= height + 0.5) return done(rows, way, false);
        }
      }
    }
    const race = list.some(isRace) ? floorIn(ways, keyed ? by(2, isRace) : raceFirst) : null;
    if (race) return done(race.rows, race.way, false);
    // Without the agenda, one line names a date of its own (a weekly one's single word and «…» would name
    // nothing); with it, the agenda names the date whole and the day keeps its chip.
    const oneLine = !keyed && own ? floorIn(ways, by(1, ownTitled)) : null;
    if (oneLine) return done(oneLine.rows, oneLine.way, false);
    const fits = (rows: Row[] | null): rows is Row[] => rows !== null && sum(rows) <= height + 0.5;
    for (const tight of [false, true]) {
      for (const p of sizes(pMax, minText)) {
        const rows = dayRows(list, width, p, tight);
        if (fits(rows)) return { rows, whole: !titled, kept: !own };
      }
    }
    // Too many for the day: the race first, the other dates of their own, the weekly last, and the count of the
    // rest — never the race, whose chip stands even where the count no longer fits under it.
    const rank = (date: PosterDate) => (isRace(date) ? 0 : date.own ? 1 : 2);
    const first = [...list].sort((a, b) => rank(a) - rank(b));
    for (let count = list.length - 1; count >= 1; count -= 1) {
      const rows = [...(dayRows(first.slice(0, count), width, minText, true) ?? []), moreRow(list.length - count)];
      if (rows.length > 1 && fits(rows)) return { rows, whole: false, kept: !own };
    }
    const races = first.filter(isRace);
    return { rows: [...(dayRows(races, width, minText, true) ?? []), ...(list.length > races.length ? [moreRow(list.length - races.length)] : [])], whole: false, kept: !own };
  };
  /**
   * A day's one date of its own, with room to spare: its glyphs large above its title, as the poster draws it,
   * and not again beside its hour — its details kept, those that do not fit after the hour on a line of their
   * own; never when that costs one of them.
   */
  const withLargeGlyph = (date: PosterDate, rows: Row[], s: number, width: number, height: number): Row[] => {
    const m = Math.max(minHour, s * 0.85);
    const plain = date.titled && hourSplit(date, face(m, date.cancelled ? 700 : 500), width, width).dropped === 0 ? titleRows(date, s, width, 0, "plain") : null;
    const g = plain ? Math.min(height - sum(plain) - s * 0.5, width * 0.3, s * 3) : 0;
    if (!plain || g < s * 1.8) return rows;
    const glyphs = eventGlyphs(date.type, date.surface);
    return [{ h: g + s * 0.45, draw: (x, y, w) => drawGlyphs(ctx, glyphs, x + (w - glyphsWidth(glyphs.length, g)) / 2, y + s * 0.15, g, inkOf(date.mark)) }, ...plain];
  };

  // ── The agenda ──
  /**
   * The agenda's sections set by `fit` in columns `cw` wide, listing `parts`; `dn` is the grid's day-number
   * size, which a date's square never outgrows by much. Null when a column cannot hold the words: above the
   * floor a title is whole or the size is too large; at the floor a title keeps `fit.cut` lines — two at the
   * least for a race — and a word that cannot be split is cut.
   */
  const sectionsAt = (fit: Fit, cw: number, parts: Part[], dn: number): Section[] | null => {
    const sections: Section[] = [];
    for (const part of parts) {
      // Remembered by its words and its width: a section stands in several boxes, alone or with the other.
      const key = `${fit.a}|${fit.level}|${fit.cut}|${cw}|${dn}|${partKey(part)}`;
      if (!sectionMemo.has(key)) sectionMemo.set(key, partSections(fit, cw, [part], dn)?.[0] ?? null);
      const section = sectionMemo.get(key);
      if (!section) return null;
      sections.push(section);
    }
    return sections;
  };
  const sectionMemo = new Map<string, Section | null>();
  const partKey = (part: Part) => (part.kind === "series" ? `s${part.count}` : `o${part.dates.map((date) => dates.indexOf(date)).join(".")}+${part.hidden}`);
  const partSections = ({ a, level, cut }: Fit, cw: number, parts: Part[], dn: number): Section[] | null => {
    const titleFont = face(a, 700);
    const lineH = a * 1.2;
    const title = (text: string, width: number, race = false) => titleLines(upper(text), titleFont, width, a > minText + 1e-6 ? 0 : cut === 0 ? Infinity : race ? Math.max(2, cut) : cut);
    // The rhythm, the hour and the details a step under the title, in the hours' ink.
    const m = Math.max(minHour, a * 0.8);
    const noteH = m * 1.3;
    const once = (laid: Laid): Entry => ({ day: null, badged: laid, bare: laid, continued: laid });
    const more = (count: number) =>
      once({
        h: a * 1.5,
        draw: (x, y) => {
          setFont(face(a, 700));
          ctx.fillStyle = palette.title;
          fill(moreText(count), x, y + a * 1.05);
        },
      });
    const sections: Section[] = [];
    for (const part of parts) {
      if (part.kind === "series") {
        // Each series: the glyphs its chips wear, its title, and its rhythm — «În fiecare luni, la 19:30 · Parc · 8 km».
        const p = Math.max(minText, a * 0.8);
        const pills: Pill[] = seriesRows.map((row) => ({ glyphs: eventGlyphs(row.type, row.surface), lines: [], stacked: false, mark: "weekly", cancelled: false }));
        const indent = Math.max(...pills.map((pill) => pillW(pill, p))) + a * 0.45;
        const textW = cw - indent;
        if (textW < cw * 0.5) return null;
        const entries: Entry[] = [];
        for (const [index, row] of seriesRows.slice(0, part.count).entries()) {
          // «la 19:30» kept on one line: the hour never starts a line without the word that brings it.
          const rhythm = [row.sentence.replace(/ (?=\d{1,2}:\d{2})/g, "\u00a0"), ...detailsOf(row, level)].join(DOT);
          // At the densest, the title cut to leave its rhythm room beside it, on one line.
          const room = textW - a * 0.6 - measure(rhythm, face(m, 500));
          setFont(titleFont);
          const lines = cut === 1 && room >= textW * 0.6 ? [fitWords(upper(row.title), room)] : title(row.title, textW);
          if (!lines) return null;
          // The rhythm after the title's last line when it fits there, else under it.
          const lastW = measure(lines[lines.length - 1], titleFont);
          const inline = lastW + a * 0.6 + measure(rhythm, face(m, 500)) <= textW + 0.5;
          setFont(face(m, 500));
          const sentence = inline ? [rhythm] : wrapBalanced(sized, rhythm, textW).map((line) => fitText(sized, line, textW));
          const chipH = pillH(pills[index], p);
          const top = Math.max(0, (chipH - lineH) / 2);
          const draw = (x: number, y: number) => {
            drawPill(pills[index], x, y + top + (lineH - chipH) / 2, p);
            setFont(titleFont);
            ctx.fillStyle = palette.cellInk;
            lines.forEach((line, at) => fill(line, x + indent, y + top + at * lineH + a * 0.92));
            setFont(face(m, 500));
            ctx.fillStyle = palette.title;
            if (inline) fill(rhythm, x + indent + lastW + a * 0.6, y + top + (lines.length - 1) * lineH + a * 0.92);
            else sentence.forEach((line, at) => fill(line, x + indent, y + top + lines.length * lineH + at * noteH + m * 0.98));
          };
          entries.push(once({ h: Math.max(chipH, top + lines.length * lineH + (inline ? 0 : sentence.length * noteH)), draw }));
        }
        if (part.count < seriesRows.length) entries.push(more(seriesRows.length - part.count));
        sections.push({ title: data.words.recurringTitle, fill: () => palette.band, entries });
        continue;
      }
      // Each date of its own: its day in a square of its tint and its weekday beside it, the date as the heads
      // mark one; then its title and, after it or under it, its glyphs, hour and details; a day's second date in
      // the same column stands under the first's square rather than repeat it (audit D29, D34). At the leanest,
      // the square alone: no weekday, no glyphs — its tint and the grid's chip say what the date is.
      const lean = level === LEAN;
      const ds = clamp(a * (a <= minText * 1.1 ? 1 : 1.2), minDay, Math.max(minDay, dn * 1.4));
      const dayFont = face(ds, 800);
      const ws = Math.max(minText, a * 0.62);
      const weekdayFont = face(ws, 700);
      const square = Math.max(ds * 1.4, ...part.dates.map((date) => measure(String(date.day), dayFont) + ds * 0.5));
      const weekdayW = lean ? 0 : Math.max(0, ...part.dates.map((date) => measure(weekdayName(date.day), weekdayFont)));
      const indent = square + (lean ? 0 : a * 0.25 + weekdayW) + a * 0.45;
      const textW = cw - indent;
      if (textW < cw * 0.5) return null;
      const g = Math.max(minGlyph, m * 1.1);
      const metaH = Math.max(noteH, g);
      const entries: Entry[] = [];
      for (const date of part.dates) {
        const glyphs = lean ? [] : eventGlyphs(date.type, date.surface);
        const glyphW = lean ? 0 : glyphsWidth(glyphs.length, g) + m * 0.3;
        const metaFont = face(m, date.cancelled ? 700 : 500);
        // The hour and the details that fit beside the glyphs; above the floor those left over on a line of
        // their own under the hour, so a detail is given up only at the floor — by `level`, and by the line.
        const words = detailsOf(date, level);
        let first = words.length;
        while (first > 0 && measure([hourOf(date), ...words.slice(0, first)].join(DOT), metaFont) + glyphW > textW) first -= 1;
        const rest = a > minText + 1e-6 ? words.slice(first) : [];
        while (rest.length > 0 && measure(rest.join(DOT), metaFont) + glyphW > textW) rest.pop();
        setFont(metaFont);
        const meta = fitText(sized, [hourOf(date), ...words.slice(0, first)].join(DOT), textW - glyphW);
        const spill = rest.join(DOT);
        // At the densest, a title other than a race's cut to leave its hour room beside it, on one line.
        const room = textW - a * 0.6 - glyphW - measure(meta, metaFont);
        setFont(titleFont);
        const lines = cut === 1 && !isRace(date) && !spill && room >= textW * (lean ? 0.4 : 0.6) ? [fitWords(upper(date.title), room)] : title(date.title, textW, isRace(date));
        if (!lines) return null;
        const lastW = measure(lines[lines.length - 1], titleFont);
        const inline = !spill && lastW + a * 0.6 + glyphW + measure(meta, metaFont) <= textW;
        const textH = lines.length * lineH + (inline ? 0 : metaH + (spill ? noteH : 0));
        const laid = (badge: boolean, level = badge): Laid => {
          const top = level ? Math.max(0, (square - lineH) / 2) : 0;
          const draw = (x: number, y: number) => {
            if (badge) {
              roundRect(ctx, x, y, square, square, square * 0.22);
              ctx.fillStyle = palette[date.mark][0];
              ctx.fill();
              ctx.fillStyle = palette.cellInk;
              setFont(dayFont);
              ctx.textAlign = "center";
              fill(String(date.day), x + square / 2, y + square / 2 + ds * 0.36);
              ctx.textAlign = "left";
              setFont(weekdayFont);
              ctx.fillStyle = palette.title;
              if (!lean) fill(weekdayName(date.day), x + square + a * 0.25, y + square / 2 + ws * 0.36);
            }
            setFont(titleFont);
            ctx.fillStyle = palette.cellInk;
            lines.forEach((line, at) => fill(line, x + indent, y + top + at * lineH + a * 0.92));
            const metaX = inline ? x + indent + lastW + a * 0.6 : x + indent;
            const metaTop = inline ? y + top + (lines.length - 1) * lineH + (lineH - metaH) / 2 : y + top + lines.length * lineH;
            drawGlyphs(ctx, glyphs, metaX, metaTop + (metaH - g) / 2, g, inkOf(date.mark));
            setFont(metaFont);
            ctx.fillStyle = date.cancelled ? inkOf(date.mark) : palette.title;
            fill(meta, metaX + glyphW, metaTop + metaH / 2 + m * 0.36);
            setFont(face(m, 500));
            ctx.fillStyle = palette.title;
            if (spill) fill(spill, metaX + glyphW, metaTop + metaH + noteH / 2 + m * 0.36);
          };
          return { h: Math.max(badge ? square : 0, top + textH), draw };
        };
        entries.push({ day: date.day, badged: laid(true), bare: laid(false), continued: laid(false, true) });
      }
      if (part.hidden > 0) entries.push(more(part.hidden));
      sections.push({ title: data.words.specialTitle, fill: () => palette.special[1], entries });
    }
    return sections;
  };
  /** A section's pill across at most `width`, its words smaller down to the floor before they are cut. */
  const headOf = (section: Section, width: number, a: number): Laid => {
    const words = upper(section.title);
    const most = Math.max(minText, a * 0.86);
    const whole = measure(words, face(most, 800)) + most * 1.7;
    const hs = whole <= width ? most : Math.max(minText, (most * width * 0.98) / whole);
    const font = face(hs, 800);
    setFont(font);
    const label = fitText(sized, words, width - hs * 1.7);
    const w = Math.min(width, measure(label, font) + hs * 1.7);
    const h = hs * 1.8;
    return {
      h: h + a * 0.4,
      draw: (x, y) => {
        roundRect(ctx, x, y, w, h, h / 2);
        ctx.fillStyle = section.fill();
        ctx.fill();
        setFont(font);
        ctx.fillStyle = palette.bandInk;
        fill(label, x + hs * 0.85, y + h / 2 + hs * 0.36);
      },
    };
  };
  const colGap = (a: number) => a * 1.3;
  const insetOf = (a: number) => Math.max(14 * v, a * 0.6);
  /**
   * Items one under another, `a * 0.3` apart; a date under another of the same day stands bare, under its
   * square — and the first, when the column before ended on its day (`continues`), level with a square it
   * leaves out.
   */
  const columnOf = (entries: Entry[], a: number, continues = false): Laid => {
    const items = entries.map((entry, index) => (index > 0 && entry.day !== null && entries[index - 1].day === entry.day ? entry.bare : index === 0 && continues ? entry.continued : entry.badged));
    const tops = items.map((_, index) => sum(items.slice(0, index)) + index * a * 0.3);
    return { h: sum(items) + Math.max(0, items.length - 1) * a * 0.3, draw: (x, y) => items.forEach((item, index) => item.draw(x, y + tops[index])) };
  };
  /** Laid side by side, `cw` and a gap apart, as tall as the tallest. */
  const sideBySide = (laid: Laid[], cw: number, a: number): Laid => ({ h: Math.max(...laid.map((column) => column.h)), draw: (x, y) => laid.forEach((column, index) => column.draw(x + index * (cw + colGap(a)), y)) });
  /**
   * A section's pill over its entries read down `n` columns `cw` wide at most — of every way to cut them, the
   * one whose tallest column is shortest, one at days' edges when it is no taller. A cut between two dates of
   * the same day leaves the day's square out at the next column's top, rather than repeat it; and `edge` is
   * the lowest cut at days' edges while it is no more than a quarter taller, for `settle` to take where its
   * box has the room — the composition does not grow a box for it.
   */
  const sectionOf = (section: Section, width: number, n: number, cw: number, a: number): Laid & { split: boolean; edge: Laid | null } => {
    const { entries } = section;
    const whole = [columnOf(entries, a)];
    let columns = whole;
    let atEdges = whole;
    const tallest = (laid: Laid[]) => Math.max(...laid.map((column) => column.h));
    const splits = (cut: number) => entries[cut].day !== null && entries[cut].day === entries[cut - 1].day;
    const tryCuts = (cuts: number[]) => {
      const bounds = [0, ...cuts, entries.length];
      const laid = bounds.slice(1).map((end, index) => columnOf(entries.slice(bounds[index], end), a, index > 0 && splits(bounds[index])));
      if (tallest(laid) < tallest(columns) - 1e-6) columns = laid;
      if (!cuts.some(splits) && tallest(laid) < tallest(atEdges) - 1e-6) atEdges = laid;
    };
    for (let first = 1; n >= 2 && first < entries.length; first += 1) {
      tryCuts([first]);
      for (let second = first + 1; n >= 3 && second < entries.length; second += 1) tryCuts([first, second]);
    }
    if (tallest(atEdges) <= tallest(columns) + 1e-6) columns = atEdges;
    const head = headOf(section, width, a);
    const laidOf = (cut: Laid[]): Laid => {
      const body = sideBySide(cut, cw, a);
      return {
        h: head.h + body.h,
        draw: (x, y) => {
          head.draw(x, y);
          body.draw(x, y + head.h);
        },
      };
    };
    const split = columns !== atEdges;
    return { ...laidOf(columns), split, edge: split && tallest(atEdges) <= tallest(columns) * 1.25 + 1e-6 ? laidOf(atEdges) : null };
  };
  /** Sections one under another, `a * 0.6` apart. */
  const pile = (laid: Laid[], a: number): Laid => {
    const tops = laid.map((_, index) => sum(laid.slice(0, index)) + index * a * 0.6);
    return { h: sum(laid) + (laid.length - 1) * a * 0.6, draw: (x, y) => laid.forEach((section, index) => section.draw(x, y + tops[index])) };
  };
  /**
   * The sections stacked in `width`, each pill across it and its items read down one to three columns, as many
   * as set it lowest — and, as `edge`, the same with each section whose columns split a day in the count of
   * columns that splits none, while that is no more than a quarter taller.
   */
  const stacked = (fit: Fit, width: number, parts: Part[], dn: number): Boxed | null => {
    const { a } = fit;
    let most = 3;
    while (most > 1 && (width - (most - 1) * colGap(a)) / most < COLUMN_MIN * u) most -= 1;
    // Each section in as many columns as set it lowest: a title on one line across the box rather than on
    // three in a third of it, or the items side by side when they are short.
    const ways = Array.from({ length: most }, (_, index) => {
      const cw = (width - index * colGap(a)) / (index + 1);
      return sectionsAt(fit, cw, parts, dn)?.map((section) => sectionOf(section, width, index + 1, cw, a));
    });
    type Laying = NonNullable<(typeof ways)[number]>[number];
    const lowest = parts.map((_, index) => ways.reduce<Laying | null>((best, way) => (way && (!best || way[index].h < best.h - 0.5) ? way[index] : best), null));
    if (lowest.some((section) => section === null)) return null;
    const laid = lowest as Laying[];
    // The lowest way that splits no day: a count of columns that splits none, or one's own cut at days' edges.
    const whole = (index: number) =>
      ways.reduce<Laid | null>((best, way) => {
        const one = way && (way[index].split ? way[index].edge : way[index]);
        return one && (!best || one.h < best.h - 0.5) ? one : best;
      }, null);
    const kept = laid.map((section, index) => {
      const one = section.split ? whole(index) : null;
      return one && one.h <= section.h * 1.25 + 1e-6 ? one : section;
    });
    return { ...pile(laid, a), beside: false, edge: kept.some((section, index) => section !== laid[index]) ? pile(kept, a) : null };
  };
  /** The two sections side by side in `width`, each its own column under its own pill; null with one section or narrow columns. */
  const beside = (fit: Fit, width: number, parts: Part[], dn: number): Boxed | null => {
    const cw = (width - colGap(fit.a)) / 2;
    if (parts.length !== 2 || cw < COLUMN_MIN * u) return null;
    const laid = sectionsAt(fit, cw, parts, dn)?.map((section) => sectionOf(section, cw, 1, cw, fit.a));
    return laid ? { ...sideBySide(laid, cw, fit.a), beside: true, edge: null } : null;
  };
  const partsOf = (series: number, own: PosterDate[], hidden: number): Part[] => [...(series > 0 ? [{ kind: "series", count: series } as const] : []), ...(own.length > 0 || hidden > 0 ? [{ kind: "own", dates: own, hidden } as const] : [])];
  /** The sections in a box `width` wide — side by side when that costs no more than a quarter over stacking them — remembered, since the composition asks again. */
  const laidIn = new Map<string, Boxed | null>();
  const inBox = (fit: Fit, width: number, parts: Part[], dn: number): Boxed | null => {
    const key = [fit.a, fit.level, fit.cut, width, dn, ...parts.map(partKey)].join("|");
    if (!laidIn.has(key)) {
      const s = stacked(fit, width, parts, dn);
      const b = beside(fit, width, parts, dn);
      laidIn.set(key, b && (!s || b.h <= s.h * 1.25) ? b : s);
    }
    return laidIn.get(key) ?? null;
  };
  /**
   * A box of the chosen plan set again in the `room` its place gave it, which the composition does not change:
   * at the floor, where its titles are cut, they keep more lines — whole, three, two — while the box has them,
   * side by side each section in its own column, which the other's height may leave room in; and a day's two
   * dates kept in one column where that fits (`edge`).
   */
  const settle = (fit: Fit, width: number, parts: Part[], laid: Boxed, room: number, dn: number): Laid => {
    const looser = fit.a <= minText + 1e-6 && fit.cut > 0 ? [0, 3, 2].filter((cut) => cut === 0 || cut > fit.cut).map((cut) => ({ ...fit, cut })) : [];
    const fits = (one: Laid | null | undefined): one is Laid => !!one && one.h <= room + 0.5;
    if (laid.beside) {
      const cw = (width - colGap(fit.a)) / 2;
      let loosened = false;
      const sections = parts.map((part) => {
        for (const loose of [...looser, fit]) {
          const section = sectionsAt(loose, cw, [part], dn)?.[0];
          const one = section ? sectionOf(section, cw, 1, cw, fit.a) : null;
          if (!fits(one)) continue;
          loosened ||= loose !== fit;
          return one;
        }
        return null;
      });
      return loosened && sections.every((section) => section !== null) ? sideBySide(sections as Laid[], cw, fit.a) : laid;
    }
    for (const loose of looser) {
      const one = stacked(loose, width, parts, dn);
      if (fits(one?.edge)) return one.edge;
      if (fits(one)) return one;
    }
    return fits(laid.edge) ? laid.edge : laid;
  };

  // ── The grid ──
  const weeks = monthGrid(data.month);
  const byDay = new Map<number, PosterDate[]>();
  for (const date of dates) byDay.set(date.day, [...(byDay.get(date.day) ?? []), date]);
  const runOf = (which: Run["which"]): Run => {
    const row = which === "lead" ? 0 : weeks.length - 1;
    const count = weeks[row].filter((day) => !day.inMonth).length;
    return { which, row, first: which === "lead" ? 0 : 7 - count, count };
  };
  /** The empty runs of two days or more: the agenda may sit in them; a single empty day is only tinted. */
  const runs = [runOf("lead"), runOf("trail")].filter((run) => run.count >= 2);
  const parts = partsOf(seriesRows.length, singles, 0);
  const gridW = wide && parts.length > 0 ? body.w * WIDE_GRID : body.w;
  const cellW = gridW / 7;
  const inset = Math.max(4 * v, Math.min(10 * v, cellW * 0.05));
  const innerW = cellW - 2 * inset;
  /** A chip's largest size in a day. */
  const pMax = clamp(cellW * 0.125, minText, 18 * u);
  /** The weeks' heights in `avail` under the head, each at least `mins`, the rest shared evenly: the even share, or null when even the least does not fit. */
  const heightsFor = (avail: number, mins: number[]): { base: number; heights: number[] } | null => {
    if (mins.reduce((total, least) => total + least, 0) > avail + 0.5) return null;
    let low = 0;
    let high = avail;
    for (let i = 0; i < 40; i += 1) {
      const mid = (low + high) / 2;
      if (mins.reduce((total, least) => total + Math.max(mid, least), 0) <= avail) low = mid;
      else high = mid;
    }
    return { base: low, heights: mins.map((least) => Math.max(low, least)) };
  };
  /** The same, or null when the even share is under `floor`. */
  const shareAbove = (avail: number, mins: number[], floor: number) => {
    const shared = heightsFor(avail, mins);
    return shared && shared.base + 1e-6 >= floor ? shared : null;
  };
  const runBox = (grid: Grid, run: Run): Box => ({ x: grid.box.x + run.first * cellW, y: grid.tops[run.row], w: run.count * cellW, h: grid.heights[run.row] });

  // ── The composition ──
  // On 16:9 a week's measure is the agenda-wide grid's even without the agenda: wider days are no taller a week.
  const rowUnit = wide ? (body.w * WIDE_GRID) / 7 : cellW;
  const floorRow = shape.soft * rowUnit;
  const hardRow = Math.max(floorRow, shape.hard * rowUnit);
  const cap = shape.cap * u;
  /**
   * The least a week may have with the agenda's titles at `a`: the floor, and more as the agenda grows towards
   * its cap — or, not `strict`, when the whole agenda cannot be had above the floor, six tenths of it: every
   * series and every date of its own named comes first (the audit's «must not break»).
   */
  const rowFor = (a: number, strict: boolean) => (strict ? floorRow + (hardRow - floorRow) * clamp((a - minText) / Math.max(1e-6, cap - minText), 0, 1) : floorRow * 0.6);
  const places: Place[] = [...runs.map((run) => run.which), "panel"];
  const panelW = wide ? body.w - gridW - gap : body.w;
  /** Whether `plan` is better than `other`: it grants more of the wishes, the earlier first, then leaves the weeks more. */
  const better = (plan: Plan, other: Plan | null) => {
    if (!other || Math.abs(plan.rank - other.rank) > 1e-12) return !other || plan.rank > other.rank;
    if (Math.abs(plan.extra - other.extra) > 1e-12) return plan.extra > other.extra;
    return plan.base > other.base + 0.5;
  };
  /**
   * The month composed with the grid's own words — the weekdays over the columns and the days' numbers — at
   * their size, or (`compact`) at the floor and closer, for a month whose agenda cannot be had whole otherwise:
   * the grid's furniture gives way before a title does.
   */
  const composeAt = (compact: boolean): ((limit: number) => Composed) => {
    const headSize = compact ? minText : Math.max(minText, Math.min(21 * u, cellW * 0.14));
    const headH = headSize * (compact ? 2 : 2.3);
    const dn = compact ? minDay : Math.max(minDay, Math.min(26 * u, cellW * 0.15));
    const dayRow = inset + dn * (compact ? 1.05 : 1.1);
    /**
     * What each week's busiest day needs at the floor for the titles `cutOf` gives (`floorRows`): their glyphs
     * kept, or (`low`) in the lowest forms — what a wish falls back to only when that is what grants the title —
     * and, without the agenda, the day's weekly dates folded into «+N» when that costs less (`waysOf`, not for
     * a weekly date's own title); with a title that cannot be had so, `Infinity`.
     */
    const needsOf = (cutOf: CutOf | null, low = false, fold = true) =>
      weeks.map((week) =>
        Math.max(
          0,
          ...week.map((day) => {
            const list = day.inMonth ? byDay.get(day.day) : undefined;
            if (!list) return 0;
            const least = Math.min(
              ...(cutOf && fold ? waysOf(list) : [{ shown: list, tail: [] }]).map((way) => {
                const rows = floorRows(way.shown, innerW, cutOf, low);
                return rows ? sum(rows) + sum(way.tail) : Infinity;
              }),
            );
            return Number.isFinite(least) ? dayRow + least + inset * 0.5 : Infinity;
          }),
        ),
      );
    /** The weeks' least: every date a chip with its glyphs. */
    const needs = needsOf(null);
    /** Whether a week holds a date of its own, whose title its day shows when the week gives it the room. */
    const ownWeek = weeks.map((week) => week.some((day) => day.inMonth && (byDay.get(day.day) ?? []).some(ownTitled)));
    /** What of the shape's floor a week keeps while another's wish is granted (`POSTER_SHAPES`, `keep`). */
    const keeps = weeks.map((week, row) => (!week.some((day) => day.inMonth && byDay.has(day.day)) ? shape.keep.bare : ownWeek[row] ? shape.keep.titled : shape.keep.chips));
    /** What each week needs for its titles whole at `s`, the chips a step under, as `planDay` sets them (`wholeRows`); `Infinity` when a title cannot be had so. */
    const largeOf = (s: number) =>
      weeks.map((week) =>
        Math.max(
          0,
          ...week.map((day) => {
            const list = day.inMonth ? byDay.get(day.day) : undefined;
            if (!list?.some((date) => date.titled)) return 0;
            const rows = wholeRows(list, innerW, s, [...BESIDE_GLYPHS, "over", "bare"]);
            return rows ? dayRow + sum(rows) + inset * 0.5 : Infinity;
          }),
        ),
      );
    /**
     * What the weeks would rather have, in the order they are given it before the agenda grows: a race's week
     * the titles of its dates of their own whole, else each in two lines, else its race's two lines; then the
     * other weeks their dates' titles whole, the cheapest first — the special dates before the blank days
     * (audit D08) — then in two lines (D22: a special falls to a chip only when not even that fits); without
     * the agenda, where nothing else names a date, every special on one line first, the race's week first,
     * then the race's lines, then the others' in two and whole — each in the lowest forms, then with the
     * glyphs, then with the weekly chips — and then each week its weekly dates' titles too; then, but on
     * 16:9, every titled week its titles at 20 pixels, the race's first, so a day and its card in the agenda do
     * not read at two sizes.
     */
    // Each at its glyphs' height; without the agenda also with the weekly dates folded, and in the lowest forms.
    const levels = (cutOf: CutOf, fold = true) => (keyed ? [needsOf(cutOf)] : [needsOf(cutOf, false, false), needsOf(cutOf, false, fold), needsOf(cutOf, true, fold)]);
    const whole = levels(by(0, ownTitled));
    const twoLines = levels(by(2, ownTitled));
    const raceLines = levels(keyed ? by(2, isRace) : raceFirst);
    const oneLine = keyed ? whole : levels(by(1, ownTitled));
    const named = keyed ? whole : levels(by(0), false);
    const large = wide ? weeks.map(() => Infinity) : largeOf(20 * u);
    const raceWeek = (row: number) => weeks[row].some((day) => day.inMonth && (byDay.get(day.day) ?? []).some(isRace));
    const rows = weeks.map((_, row) => row);
    const races = rows.filter(raceWeek);
    const others = rows.filter((row) => !raceWeek(row)).sort((a, b) => whole[0][a] - whole[0][b]);
    // With the agenda every special is named there: a week's title whole comes before another's two lines, and
    // those two lines are a bonus (weighed after the others), never worth the agenda's glyphs nor its growing
    // (not `held`). Without it every special named on one line comes first, the race's week first; then the
    // race's lines, then the others' — each in the lowest forms and the weekly dates folded, a line of a title
    // being worth more than a glyph and a glyph more than a weekly chip; then the same with the glyphs; then
    // with the weekly chips; then the weekly dates' titles.
    const wish = (row: number, h: number[], bonus = false, held = true) => ({ row, h: h[row], bonus, held });
    const chips = (level: number[][]) => level[0];
    const glyphs = (level: number[][]) => level[1];
    const lowest = (level: number[][]) => level[2];
    const titles = (at: (level: number[][]) => number[]) => [
      ...[...races, ...others].map((row) => wish(row, at(oneLine))),
      ...races.flatMap((row) => [whole, twoLines, raceLines].map((level) => wish(row, at(level)))),
      ...[twoLines, whole].flatMap((level) => others.map((row) => wish(row, at(level)))),
    ];
    const wishes = [
      ...(keyed
        ? [...races.flatMap((row) => [whole, twoLines, raceLines, oneLine].map((level) => wish(row, level[0]))), ...others.map((row) => wish(row, whole[0])), ...others.map((row) => wish(row, twoLines[0], true, false))]
        : [
            ...titles(lowest),
            ...titles(glyphs).filter((one, index) => one.h > titles(lowest)[index].h + 0.5),
            ...titles(chips).filter((one, index) => one.h > titles(glyphs)[index].h + 0.5),
            ...[...rows].sort((a, b) => named[0][a] - named[0][b]).flatMap((row) => [wish(row, glyphs(named)), wish(row, lowest(named))]),
          ]),
      ...[...rows].sort((a, b) => Number(raceWeek(b)) - Number(raceWeek(a)) || large[a] - large[b]).map((row) => wish(row, large, true)),
    ].filter(({ row, h }) => Number.isFinite(h) && h > needs[row]);
    const gridOf = (heights: number[]): Grid => {
      const tops = heights.map((_, index) => body.y + headH + heights.slice(0, index).reduce((total, h) => total + h, 0));
      return { box: { x: body.x, y: body.y, w: gridW, h: headH + heights.reduce((total, h) => total + h, 0) }, tops, heights };
    };
    /**
     * The month composed with the agenda set by `fit`, listing `shown`: every way of putting its one or two
     * sections in the runs and the panel (on 16:9 the panel always holds one), each week at least its least
     * and the even share at least `rowFor(a, strict)`; then the wishes granted in turn while every other week
     * keeps what `keeps` says of the shape's floor (audit D08), none taller than the shape's `tallest` times the
     * even week; the rest shared evenly. The one that grants the most wishes, the earlier first, then leaves
     * the weeks the most; null when none does, or none grants every wish `required`. Without the agenda
     * (`shown` empty) the same, for the weeks alone. With `only`, that placement alone, each box with no day's
     * dates split between two columns where it has a way to (`edge`).
     */
    const planAt = (fit: Fit, shown: Part[], strict: boolean, required: number[] = [], only?: Place[]): Plan | null => {
      const pad = insetOf(fit.a);
      const choices: Place[][] = only ? [only] : shown.length === 0 ? [[]] : shown.length === 1 ? places.map((place) => [place]) : places.flatMap((first) => places.map((second) => [first, second]));
      const needed = needs.reduce((total, need) => total + need, 0);
      let best: Plan | null = null;
      for (const choice of choices) {
        if (wide && shown.length > 0 && !choice.includes("panel")) continue;
        const held = new Map<Place, Boxed | null>();
        const sets = new Map<Place, { width: number; parts: Part[] }>();
        // The panel first: a choice whose panel alone leaves the weeks less than their least is not set further.
        for (const place of [...new Set(choice)].sort((one, other) => Number(other === "panel") - Number(one === "panel"))) {
          const width = (place === "panel" ? panelW : runOf(place).count * cellW) - 2 * pad;
          const set = { width, parts: shown.filter((_, index) => choice[index] === place) };
          const boxed = inBox(fit, set.width, set.parts, dn);
          const laid = only && boxed?.edge ? { ...boxed.edge, beside: boxed.beside, edge: null } : boxed;
          held.set(place, laid);
          sets.set(place, set);
          if (!laid) break;
          if (place === "panel" && (wide ? laid.h + 2 * pad > body.h + 0.5 : needed > body.h - gap - laid.h - 2 * pad - headH + 0.5)) {
            held.set(place, null);
            break;
          }
        }
        if ([...held.values()].some((laid) => laid === null)) continue;
        const panel = held.get("panel");
        const panelH = panel ? panel.h + 2 * pad : 0;
        if (wide && panelH > body.h + 0.5) continue;
        const avail = (wide ? body.h : body.h - (panel ? gap + panelH : 0)) - headH;
        const hosted = new Map<Run["which"], Boxed>();
        for (const run of runs) {
          const laid = held.get(run.which);
          if (laid) hosted.set(run.which, laid);
        }
        const hostedH = (row: number) => Math.max(0, ...runs.filter((run) => run.row === row && hosted.has(run.which)).map((run) => (hosted.get(run.which)?.h ?? 0) + 2 * pad));
        const least = needs.map((need, row) => Math.max(need, hostedH(row)));
        const even = shareAbove(avail, least, rowFor(fit.a, strict));
        if (!even) continue;
        const stage = strict ? floorRow : rowFor(fit.a, false);
        const floors = keeps.map((share) => stage * share);
        const granted: number[] = [];
        wishes.forEach(({ row, h }, index) => {
          const raised = least.map((need, at) => (at === row ? Math.max(need, h) : need));
          if (h > even.base * (raceWeek(row) ? shape.tallest.race : shape.tallest.other) || raised.reduce((total, need, at) => total + Math.max(need, floors[at]), 0) > avail + 0.5) return;
          least.splice(0, least.length, ...raised);
          granted.push(index);
        });
        if (required.some((index) => !granted.includes(index))) continue;
        const weigh = (bonus: boolean) => granted.reduce((total, index) => total + (wishes[index].bonus === bonus ? 2 ** -index : 0), 0);
        // The rest shared evenly, a week with a date of its own kept at the floor while the others can give it.
        const shared =
          heightsFor(
            avail,
            least.map((need, row) => Math.max(need, ownWeek[row] ? stage : 0)),
          ) ??
          heightsFor(avail, least) ??
          even;
        const grid = gridOf(shared.heights);
        const box: Box = wide ? { x: body.x + gridW + gap, y: body.y, w: panelW, h: body.h } : { x: body.x, y: grid.box.y + grid.box.h + gap, w: body.w, h: panelH };
        const plan: Plan = { grid, fit, shown, strict, choice, hosted, panel: panel ? { box, laid: panel } : null, sets, base: even.base, granted, rank: weigh(false), extra: weigh(true) };
        if (better(plan, best)) best = plan;
      }
      return best;
    };
    /**
     * The agenda at the largest title from `from` down to the floor that `planAt` finds room for once the weeks
     * have every wish they are granted with the agenda at the floor — the special dates' titles in the grid
     * before the agenda's words grow (the owner's hierarchy). Every detail above the floor; at it, the most
     * details that grant as many wishes as any — the climb dropped first, then the distance, then the place,
     * then the dates' glyphs and weekday (`LEAN`) — before a title in the grid is cut, and under the weeks'
     * floor (`strict` false) the details that leave the weeks the most. The room only grows as the words
     * shrink, so the largest is found by halving the sizes rather than by trying each.
     */
    const search = (shown: Part[], from: number, strict: boolean, cut = 0): Plan | null => {
      const list = sizes(from, minText);
      const at = (a: number, required: number[] = []) => {
        let best: Plan | null = null;
        for (const level of [3, 2, 1, 0, LEAN]) {
          if (a > minText + 1e-6 && level < 3) break;
          const plan = planAt({ a, level, cut }, shown, strict, required);
          if (!plan) continue;
          // Under the weeks' floor the agenda's details give way to the weeks; its glyphs only to a title.
          const roomier = !strict && level !== LEAN && best !== null && Math.abs(plan.rank - best.rank) <= 1e-12 && plan.base > best.base + 0.5;
          if (!best || plan.rank > best.rank + 1e-12 || roomier) best = plan;
        }
        return best;
      };
      let high = list.length - 1;
      let found = at(list[high]);
      if (!found) return null;
      const required = found.granted.filter((index) => wishes[index].held);
      let low = 0;
      while (low < high) {
        const middle = Math.floor((low + high) / 2);
        const plan = at(list[middle], required);
        if (plan) [found, high] = [plan, middle];
        else low = middle + 1;
      }
      return found;
    };
    /**
     * The whole agenda above the grid's floor when it fits (stage 0); else at the floor's words above its days'
     * least (1; on 16:9, where the column beside costs the weeks nothing, as large as it fits); else the dates
     * whose whole title the grid shows step out of it (2); else its titles kept to two lines at the floor (3),
     * then one (4); then the other dates of their own give way to «+N altele», the last first and never a race
     * (10 and more); the series last (100 and more).
     */
    let strictFound: Plan | null | undefined;
    const compose = (limit: number): { plan: Plan | null; stage: number } => {
      const none = { plan: null, stage: 1000 };
      if (parts.length === 0) {
        // No agenda: the weeks alone, their least, then the wishes — the race's and the special dates' titles
        // before the weekly ones — then the rest shared.
        // The grid's floor is no agenda's to keep: under it when that grants more of the wishes.
        const fit: Fit = { a: minText, level: 3, cut: 0 };
        const strict = planAt(fit, [], true);
        const loose = planAt(fit, [], false);
        if (strict && (!loose || loose.rank <= strict.rank + 1e-12)) return { plan: strict, stage: 0 };
        return loose ? { plan: loose, stage: 0 } : { plan: null, stage: 1000 };
      }
      if (strictFound === undefined) strictFound = search(parts, cap, true);
      if (strictFound) return { plan: strictFound, stage: 0 };
      if (limit < 1) return none;
      const loose = search(parts, wide ? cap : minText, false);
      if (loose) return { plan: loose, stage: 1 };
      if (limit < 2) return none;
      // A date is left to its day only when the week, at its least, still shows its whole title.
      const covered = new Set<PosterDate>();
      weeks.forEach((week, row) => {
        const h = Math.max(needs[row], rowFor(minText, false));
        for (const day of week) {
          const list = day.inMonth ? byDay.get(day.day) : undefined;
          if (list && planDay(list, innerW, h - dayRow - inset * 0.5, h).whole) for (const date of list) covered.add(date);
        }
      });
      const rest = singles.filter((date) => !covered.has(date));
      const below = (shown: Part[], most = Infinity): { plan: Plan; stage: number } | null => {
        const steps: [number, () => Plan | null][] = [
          [2, () => (rest.length < singles.length ? search(shown, wide ? cap : minText, false) : null)],
          [3, () => search(shown, minText, false, 2)],
          [4, () => search(shown, minText, false, 1)],
        ];
        for (const [stage, step] of steps) {
          if (stage > most) break;
          const plan = step();
          if (plan) return { plan, stage };
        }
        return null;
      };
      const fewer = below(partsOf(seriesRows.length, rest, 0), limit);
      if (fewer) return fewer;
      const hideable = rest.filter((date) => !isRace(date)).reverse();
      for (let count = 1; count <= hideable.length; count += 1) {
        if (10 + count > limit) return none;
        const shown = rest.filter((date) => !hideable.slice(0, count).includes(date));
        const plan = below(partsOf(seriesRows.length, shown, count));
        if (plan) return { plan: plan.plan, stage: 10 + count };
      }
      const races = rest.filter(isRace);
      for (let series = seriesRows.length - 1; series >= 1; series -= 1) {
        if (100 + seriesRows.length - series > limit) return none;
        const plan = below(partsOf(series, races, rest.length - races.length));
        if (plan) return { plan: plan.plan, stage: 100 + seriesRows.length - series };
      }
      return none;
    };
    /** The month composed down to the stage `limit` at most: a stage past it is no better than none. */
    return (limit: number): Composed => {
      const found = compose(limit);
      const { stage } = found;
      // A day's dates in one column of the agenda (audit D29), where the same places and words still grant
      // every title the grid was granted — a bonus (a title larger) is worth less: the composition cuts the
      // columns where they are lowest, and a day split costs nothing but its square at the next column's top.
      const split = found.plan && [...found.plan.hosted.values(), ...(found.plan.panel ? [found.plan.panel.laid] : [])].some((laid) => laid.edge);
      const whole = split && found.plan ? planAt(found.plan.fit, found.plan.shown, found.plan.strict, [], found.plan.choice) : null;
      const plan = whole && found.plan && Math.abs(whole.rank - found.plan.rank) <= 1e-12 ? whole : found.plan;
      const grid = plan?.grid ?? gridOf(heightsFor(body.h - headH, needs)?.heights ?? weeks.map(() => (body.h - headH) / weeks.length));
      // Whether nothing was given up: the whole agenda above the floor, every detail, every title the grid wishes for whole.
      const kept = stage === 0 && plan?.fit.level === 3 && wishes.every((wish, index) => wish.bonus || plan.granted.includes(index));
      return { plan, stage, kept, grid, headSize, headH, dn, dayRow };
    };
  };
  /**
   * How much a composition gives up, the least first: its stage, then the wishes it grants, then — the weeks at
   * their floor — the dates' glyphs in the agenda (not its details: those are not worth the grid's words), or,
   * under the floor, the weeks' even share in steps of 8 pixels.
   */
  const costOf = ({ plan, stage }: Composed) => [stage, -(plan?.rank ?? 0), !plan ? 0 : stage === 0 ? Number(plan.fit.level === LEAN) : -Math.round(plan.base / 8)];
  const cheaper = (one: number[], other: number[]) => {
    const at = one.findIndex((value, index) => Math.abs(value - other[index]) > 1e-12);
    return at >= 0 && one[at] < other[at];
  };
  // The grid's words at their size when nothing need be given up; else at the floor too, and at their size
  // only down to the stage the floor reached — a later stage is never the cheaper.
  const roomyUpTo = composeAt(false);
  const first = roomyUpTo(0);
  const close = first.kept ? null : composeAt(true)(Infinity);
  const roomy = !close || first.stage === 0 ? first : roomyUpTo(close.stage);
  const { plan, grid, headSize, headH, dn, dayRow } = close && cheaper(costOf(close), costOf(roomy)) ? close : roomy;
  // Each box of the agenda set again in the room its place has, which the composition does not change: a run
  // its week's height, the column beside the grid the body's; the panel under the grid is as tall as its words.
  const pad = plan ? insetOf(plan.fit.a) : 0;
  const settled = (place: Place, laid: Boxed, room: number) => {
    const set = plan?.sets.get(place);
    return plan && set ? settle(plan.fit, set.width, set.parts, laid, room, dn) : laid;
  };
  const used = new Map<Run["which"], Laid>();
  for (const run of runs) {
    const laid = plan?.hosted.get(run.which);
    if (laid) used.set(run.which, settled(run.which, laid, grid.heights[run.row] - 2 * pad));
  }
  const panel = plan?.panel ? { box: plan.panel.box, laid: settled("panel", plan.panel.laid, wide ? plan.panel.box.h - 2 * pad : plan.panel.laid.h) } : null;
  // The boxes tried on the way are not drawn: let them go.
  laidIn.clear();
  sectionMemo.clear();

  // ── The drawing ──
  /**
   * Each day as drawn, by week, worked out at the first drawing. Without the agenda a weekly date's title
   * gives way to a special's: in a week whose special is cut or a chip, the weekly dates are chips (the
   * owner's hierarchy, the special dates before the weekly rhythm).
   */
  let days: (DayPlan | null)[][] | null = null;
  const daysOf = () =>
    weeks.map((week, row) => {
      const h = grid.heights[row];
      const room = h - dayRow - inset * 0.5;
      const plans = week.map((day) => {
        const list = day.inMonth ? byDay.get(day.day) : undefined;
        return list ? planDay(list, innerW, room, h) : null;
      });
      const yielding = !keyed && plans.some((one) => one !== null && !one.kept);
      return week.map((day, column) => {
        const list = day.inMonth ? byDay.get(day.day) : undefined;
        return yielding && list?.some(routine) ? planDay(list, innerW, room, h, true) : plans[column];
      });
    });
  return (next: CalendarImagePalette) => {
    palette = next;
    applied = null;
    days ??= daysOf();
    const shown = days;
    const runAt = (row: number, column: number) => runs.find((run) => run.row === row && column >= run.first && column < run.first + run.count);
    roundRect(ctx, grid.box.x, grid.box.y, grid.box.w, grid.box.h, 18 * v);
    ctx.fillStyle = palette.cell;
    ctx.fill();
    ctx.save();
    ctx.clip();
    ctx.fillStyle = palette.cellMuted;
    ctx.fillRect(grid.box.x, grid.box.y, grid.box.w, headH);
    // The weekdays in capitals, in full when every one fits its column.
    setFont(face(headSize, 800));
    const long = data.words.weekdaysLong.map(upper);
    const names = long.every((name) => sized.measureText(name).width <= cellW - 10 * v) ? long : data.words.weekdays.map((name) => upper(name).replace(/\.$/, ""));
    ctx.textAlign = "center";
    ctx.fillStyle = palette.title;
    names.forEach((name, index) => fill(fitText(sized, name, cellW - 6 * v), grid.box.x + index * cellW + cellW / 2, grid.box.y + headH / 2 + headSize * 0.36));
    ctx.textAlign = "left";
    weeks.forEach((week, row) => {
      const y = grid.tops[row];
      const h = grid.heights[row];
      week.forEach((day, column) => {
        const x = grid.box.x + column * cellW;
        if (!day.inMonth) {
          const run = runAt(row, column);
          if (run && used.has(run.which)) return;
          ctx.fillStyle = palette.cellMuted;
          ctx.globalAlpha = 0.45;
          ctx.fillRect(x, y, cellW, h);
          ctx.globalAlpha = 1;
          return;
        }
        const list = byDay.get(day.day) ?? [];
        // A date of its own tints its day, pale pink or pale yellow, as the poster marks them.
        const own = list.find((date) => date.mark !== "weekly");
        if (own) {
          ctx.fillStyle = palette[own.mark][0];
          ctx.fillRect(x, y, cellW, h);
        }
        ctx.fillStyle = palette.cellInk;
        setFont(face(dn, 800));
        fill(String(day.day), x + inset, y + inset + dn * 0.78);
        let top = y + dayRow;
        for (const item of shown[row][column]?.rows ?? []) {
          item.draw(x + inset, top, innerW);
          top += item.h;
        }
      });
    });
    // The mountains across an empty run the agenda does not use, as the poster draws them (audit D44).
    for (const run of runs) {
      if (used.has(run.which)) continue;
      const box = runBox(grid, run);
      const h = Math.min(box.h * 0.7, (box.w * MOUNTAIN_MARK_VIEWBOX.height) / MOUNTAIN_MARK_VIEWBOX.width);
      ctx.save();
      ctx.translate(box.x, box.y + box.h - h);
      ctx.scale(box.w / MOUNTAIN_MARK_VIEWBOX.width, h / MOUNTAIN_MARK_VIEWBOX.height);
      ctx.fillStyle = palette.line;
      ctx.globalAlpha = 0.5;
      ctx.fill(new Path2D(FAR));
      ctx.globalAlpha = 0.8;
      ctx.fill(new Path2D(NEAR));
      ctx.restore();
      applied = null;
    }
    // The grid's lines over the cells — none inside a run, which reads as one strip.
    ctx.strokeStyle = palette.line;
    ctx.lineWidth = 2 * v;
    ctx.beginPath();
    weeks.forEach((_, row) => {
      for (let column = 1; column < 7; column += 1) {
        const run = runAt(row, column);
        if (run && run === runAt(row, column - 1)) continue;
        ctx.moveTo(grid.box.x + column * cellW, grid.tops[row]);
        ctx.lineTo(grid.box.x + column * cellW, grid.tops[row] + grid.heights[row]);
      }
      ctx.moveTo(grid.box.x, grid.tops[row]);
      ctx.lineTo(grid.box.x + grid.box.w, grid.tops[row]);
    });
    ctx.stroke();
    ctx.restore();
    applied = null;
    roundRect(ctx, grid.box.x, grid.box.y, grid.box.w, grid.box.h, 18 * v);
    ctx.strokeStyle = palette.line;
    ctx.lineWidth = 3 * v;
    ctx.stroke();
    // The agenda: bare in a run of the grid, in the middle of its week; on a framed panel under the grid or beside it.
    for (const run of runs) {
      const laid = used.get(run.which);
      if (!laid) continue;
      const box = runBox(grid, run);
      laid.draw(box.x + pad, box.y + (box.h - laid.h) / 2);
    }
    if (panel) {
      const { box, laid } = panel;
      roundRect(ctx, box.x, box.y, box.w, box.h, 18 * v);
      // A cell's colour under the words, so a palette whose page is not the cell's colour keeps them readable.
      ctx.fillStyle = palette.cell;
      ctx.fill();
      ctx.strokeStyle = palette.line;
      ctx.lineWidth = 3 * v;
      ctx.stroke();
      laid.draw(box.x + pad, box.y + pad);
    }
  };
}
