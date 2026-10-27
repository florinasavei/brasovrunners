import { CALENDAR_IMAGE_THEMES } from "@/theme/brand";
import { FAR, MOUNTAIN_MARK_VIEWBOX, NEAR } from "@/shared/ui/MountainMark";
import { SOCIAL_MARKS } from "@/shared/ui/SocialIcon";
import { type Box, CALENDAR_IMAGE_RATIOS, type CalendarImageRatio, type Ctx, drawGlyph, drawGlyphs, eventGlyphs, fitText, glyphsWidth, LOGO_RATIO, roundRect, wrapText } from "./calendar-image-canvas";
import type { CalendarImageAssets, CalendarImageFonts, CalendarImageOptions } from "./calendar-image-draw";
import { SPECIAL_PATH, TYPE_PATHS } from "./calendar-image-glyphs";
import { monthGrid } from "../domain/calendar";
import type { CalendarTone } from "../domain/calendar-kind";
import type { CalendarImageData, CalendarImageEntry } from "../domain/calendar-image";

/**
 * «Afiș», «Așezare» → «Legenda dedesubt» (`formats`): a compact band, chips in the grid, and a key — an agenda —
 * under the grid (beside it on 16:9), each shape composed for itself.
 */

/**
 * `text` broken at spaces into as many lines of `width` as it takes, at the context's font; `fits` is false
 * when one word alone is wider than the line, which a poster then draws another way rather than cut.
 */
export function wrapWords(ctx: Ctx, text: string, width: number): { lines: string[]; fits: boolean } {
  const lines: string[] = [];
  let current = "";
  let fits = true;
  for (const word of text.split(/\s+/).filter(Boolean)) {
    if (ctx.measureText(word).width > width) fits = false;
    const candidate = current ? `${current} ${word}` : word;
    if (!current || ctx.measureText(candidate).width <= width) current = candidate;
    else {
      lines.push(current);
      current = word;
    }
  }
  if (current) lines.push(current);
  return { lines, fits };
}

/**
 * The width of `text` in spaced capitals, `tracking` between letters: drawn letter by letter, because the
 * canvas's own `letterSpacing` is missing from Safari before 18 and, where it exists, counts a space after
 * the last letter too. Kerning does not matter at this spacing.
 */
function trackedWidth(ctx: CanvasRenderingContext2D, text: string, tracking: number): number {
  const letters = [...text.normalize("NFC")];
  return letters.reduce((sum, letter) => sum + ctx.measureText(letter).width, 0) + tracking * Math.max(0, letters.length - 1);
}

/** `text` in spaced capitals from `left`. */
function fillTracked(ctx: CanvasRenderingContext2D, text: string, left: number, y: number, tracking: number) {
  let x = left;
  for (const letter of text.normalize("NFC")) {
    ctx.fillText(letter, x, y);
    x += ctx.measureText(letter).width + tracking;
  }
}

/**
 * One date as «Afiș» draws it: the weekly series it belongs to (an index in `recurring`), its colour, and
 * whether its day names it by its title (a date of its own; every date when the agenda is not drawn).
 */
type PosterDate = CalendarImageEntry & { series: number | null; mark: CalendarTone; titled: boolean };

/** A date's chip: its glyph and its hour (or «Anulat»), solid blue for a weekly date, outlined for the rest. */
type Pill = { glyphs: string[]; text: string; mark: CalendarTone; cancelled: boolean };

/** A horizontal slice of a cell or of the agenda, `h` tall with the room under it, drawn across `w` from (x, y). */
type Row = { h: number; draw: (x: number, y: number, w: number) => void };

/** One item of the agenda's columns: a section's pill, a series, a date, «+2 altele». */
type Block = { h: number; after: number; head: boolean; draw: (x: number, y: number) => void };

/** What the agenda lists: the first `series`, the dates of their own in `own`, and «+N altele» for `hidden` more. */
type Shown = { series: number; own: PosterDate[]; hidden: number };

/** How each shape composes the month (§855, «Afiș»): what the grid may take, and how large the agenda's words grow. */
const POSTER_SHAPES: Record<CalendarImageRatio, { soft: number; hard: number; agendaCap: number; columns: number; inGrid: number }> = {
  // `soft`: the cells' height over their width the grid keeps while the agenda's words grow (a day's chips
  // need less than a square); `hard`: the most it takes when the agenda needs no more. `agendaCap`: the
  // agenda's largest title, in pixels of a 1080-wide picture; `columns`: the agenda's columns while they
  // fit. `inGrid`: the tallest cells (over their width) the grid may have when it fills the picture and the
  // agenda sits in the month's empty days, 0 when it never does.
  portrait: { soft: 0.75, hard: 1.08, agendaCap: 24, columns: 2, inGrid: 1.2 },
  square: { soft: 0.6, hard: 0.92, agendaCap: 20, columns: 2, inGrid: 1.1 },
  story: { soft: 0.85, hard: 1.2, agendaCap: 32, columns: 1, inGrid: 0 },
  landscape: { soft: 1, hard: 1, agendaCap: 24, columns: 1, inGrid: 0 },
};

/**
 * «Afiș» (§855; the owner, 2026-10-27: «vreau să semene cu ce mi-a dat Amalia», then «I need to organize it
 * better and use the space more efficiently») — the club's hand-made monthly poster, composed for each shape
 * rather than one layout stretched to four:
 *
 * - the band is one compact line: the club's real logo, a rule, «EVENIMENTE» spaced over the month in
 *   italic Black;
 * - the grid says *when*: each weekly date is a blue chip with its type's glyph and its hour, never its
 *   series' title again; a date of its own tints its day (pink, pale yellow) and carries its whole title in
 *   capitals when the day holds it, else an outlined chip;
 * - the agenda says *what*: «EVENIMENTE RECURENTE» names each series once, beside the chip the grid wears,
 *   and «EVENIMENTE SPECIALE» every date of its own with its day, weekday, full title and hour, in one or
 *   two columns, its words as large as the room allows;
 * - 4:5 and 1:1 put the agenda under the grid in two columns, 9:16 too as one list with larger words, 16:9
 *   beside it under the band; on 4:5 and 1:1 a month whose first or last week leaves three days or more
 *   empty sets the agenda in them when it fits there whole, and the grid fills the picture; when the
 *   agenda cannot hold every date, those the grid already names in full step out of it before any is left
 *   to «+2 altele»; «URMĂREȘTE-NE!» and the club's networks close every one.
 *
 * Words are at least 14 pixels on a 1080-wide picture (read at a phone's width), more on 16:9; a title is
 * wrapped, then made smaller, never cut while it can fit.
 */
export function drawPosterFormats(ctx: CanvasRenderingContext2D, data: CalendarImageData, options: CalendarImageOptions, fonts: CalendarImageFonts, assets: CalendarImageAssets): void {
  const { width: W, height: H } = CALENDAR_IMAGE_RATIOS[options.ratio];
  const palette = CALENDAR_IMAGE_THEMES.poster;
  const shape = POSTER_SHAPES[options.ratio];
  const wide = options.ratio === "landscape";
  // Lengths follow the short side; words follow the width, since the picture is read at a phone's width —
  // a 16:9 one not quite in proportion, having a square's height for the same month.
  const v = Math.min(W, H) / 1080;
  const u = wide ? W / 1280 : W / 1080;
  const minText = 14 * u;
  const step = 0.5 * u;
  const pad = 32 * v;
  const gap = 18 * v;
  const face = (size: number, weight: number, italic = false) => `${italic ? "italic " : ""}${weight} ${Math.round(size * 10) / 10}px ${fonts.poster}`;
  const upper = (text: string) => text.toLocaleUpperCase("ro-RO");
  const measure = (text: string, font: string) => {
    ctx.font = font;
    return ctx.measureText(text).width;
  };
  const wrap = (text: string, font: string, width: number) => {
    ctx.font = font;
    return wrapWords(ctx, text, width);
  };
  const sum = (items: { h: number }[]) => items.reduce((total, item) => total + item.h, 0);
  const inkOf = (mark: CalendarTone) => (mark === "weekly" ? palette.band : palette[mark][1]);
  ctx.textBaseline = "alphabetic";
  ctx.textAlign = "left";
  ctx.fillStyle = palette.background[0];
  ctx.fillRect(0, 0, W, H);

  // The dates: a weekly one is known by its series (the same type and title, as `groupSeries` tells them).
  const seriesKey = (type: string, title: string) => `${type}\n${title.trim().toLowerCase().replace(/\s+/g, " ")}`;
  const seriesAt = new Map(data.recurring.map((row, index) => [seriesKey(row.type, row.title), index]));
  // Without the agenda nothing names a series, so every date carries its own title.
  const keyed = options.legend;
  const dates: PosterDate[] = data.entries.map((entry) => {
    const series = seriesAt.get(seriesKey(entry.type, entry.title)) ?? null;
    const mark: CalendarTone = series !== null && !entry.special ? "weekly" : entry.tone === "weekly" ? "special" : entry.tone;
    return { ...entry, series, mark, titled: !keyed || series === null };
  });
  const seriesRows = keyed
    ? data.recurring.map((row, index) => {
        const hours = new Set(dates.filter((date) => date.series === index && !date.cancelled).map((date) => date.time));
        return { ...row, hour: hours.size === 1 ? [...hours][0] : null };
      })
    : [];
  const singles = keyed ? dates.filter((date) => date.titled) : [];
  const weekdayOf = (day: number) => (new Date(Date.UTC(data.month.year, data.month.month - 1, day)).getUTCDay() + 6) % 7;
  const metaOf = (date: PosterDate) => (date.cancelled ? data.words.cancelled : date.time ? data.words.at.replace("{time}", date.time) : "");

  // ── Chips ──
  const pillOf = (date: PosterDate, glyph: boolean): Pill => {
    const text = date.cancelled ? data.words.cancelled : (date.time ?? "");
    return { glyphs: glyph || !text ? eventGlyphs(date.type, date.surface, date.series === null && date.special ? SPECIAL_PATH : TYPE_PATHS[date.type]) : [], text, mark: date.mark, cancelled: date.cancelled };
  };
  const pillH = (p: number) => p * 1.6;
  const pillW = (pill: Pill, p: number) => {
    const glyph = glyphsWidth(pill.glyphs.length, p * 1.1);
    const text = pill.text ? measure(pill.text, face(p, 700)) : 0;
    return p * 1.2 + glyph + (glyph && text ? p * 0.3 : 0) + text;
  };
  const drawPill = (pill: Pill, x: number, y: number, p: number, h = pillH(p)) => {
    const w = pillW(pill, p);
    const solid = pill.mark === "weekly" && !pill.cancelled;
    const ink = inkOf(pill.mark);
    roundRect(ctx, x, y, w, h, h / 2);
    ctx.fillStyle = solid ? palette.band : palette.cell;
    ctx.fill();
    if (!solid) {
      ctx.strokeStyle = ink;
      ctx.lineWidth = Math.max(1.5 * v, p * 0.13);
      ctx.stroke();
    }
    let left = x + p * 0.6;
    if (pill.glyphs.length > 0) left += drawGlyphs(ctx, pill.glyphs, left, y + (h - p * 1.1) / 2, p * 1.1, solid ? palette.bandInk : ink) + (pill.text ? p * 0.3 : 0);
    if (pill.text) {
      ctx.font = face(p, 700);
      ctx.fillStyle = solid ? palette.bandInk : pill.cancelled ? ink : palette.cellInk;
      ctx.fillText(pill.text, left, y + h / 2 + p * 0.36);
    }
  };
  /** Chips side by side in lines of `width`, each line centred (`tight`: lower and closer); null when one chip alone is wider. */
  const pillRows = (pills: Pill[], p: number, width: number, tight = false): Row[] | null => {
    const widths = pills.map((pill) => pillW(pill, p));
    if (widths.some((w) => w > width + 0.5)) return null;
    const space = p * 0.35;
    const lines: number[][] = [];
    let used = 0;
    widths.forEach((w, index) => {
      if (lines.length > 0 && used + space + w <= width) {
        lines[lines.length - 1].push(index);
        used += space + w;
      } else {
        lines.push([index]);
        used = w;
      }
    });
    const h = tight ? p * 1.42 : pillH(p);
    return lines.map((line) => ({
      h: h + p * (tight ? 0.14 : 0.3),
      draw: (x, y, w) => {
        let left = x + (w - line.reduce((total, index) => total + widths[index], 0) - space * (line.length - 1)) / 2;
        for (const index of line) {
          drawPill(pills[index], left, y, p, h);
          left += widths[index] + space;
        }
      },
    }));
  };
  const textRow = (text: string, font: string, size: number, color: string, lead: number, glyph?: { paths: string[]; color: string }): Row => ({
    h: size * lead,
    draw: (x, y, w) => {
      ctx.font = font;
      const glyphW = glyph ? glyphsWidth(glyph.paths.length, size * 1.05) + size * 0.3 : 0;
      const textW = text ? ctx.measureText(text).width : 0;
      let left = x + (w - glyphW - textW + (glyph && !text ? size * 0.3 : 0)) / 2;
      if (glyph) {
        drawGlyphs(ctx, glyph.paths, left, y + (size * lead - size * 1.05) / 2, size * 1.05, glyph.color);
        left += glyphW;
      }
      ctx.fillStyle = color;
      if (text) ctx.fillText(text, left, y + size * lead * 0.5 + size * 0.36);
    },
  });
  const moreText = (count: number) => data.words.more.replace("{count}", String(count));

  // ── A day ──
  /** A date's own title in a day, centred in capitals, then its glyph and «ora 18:00»; null when a word is wider than the day. */
  const glyphOf = (date: PosterDate) => (date.series === null && date.special ? SPECIAL_PATH : TYPE_PATHS[date.type]);
  const glyphsOf = (date: PosterDate) => eventGlyphs(date.type, date.surface, glyphOf(date));
  const titleRows = (date: PosterDate, s: number, width: number, inlineGlyph = true): Row[] | null => {
    const font = face(s, 700);
    const { lines, fits } = wrap(upper(date.title), font, width);
    if (!fits) return null;
    const rows = lines.map((line) => textRow(line, font, s, palette.cellInk, 1.16));
    const m = Math.max(minText, s * 0.88);
    const meta = metaOf(date);
    if (meta && measure(meta, face(m, 500)) + m * 1.35 > width) return null;
    if (meta || inlineGlyph) rows.push(textRow(meta, face(m, date.cancelled ? 700 : 500), m, inkOf(date.mark), 1.4, inlineGlyph ? { paths: glyphsOf(date), color: inkOf(date.mark) } : undefined));
    return rows;
  };
  /** A day's one date of its own, with room to spare: its glyph large above its title, as the poster draws it. */
  const withLargeGlyph = (date: PosterDate, rows: Row[], s: number, width: number, height: number): Row[] => {
    const plain = titleRows(date, s, width, false);
    if (!plain) return rows;
    const g = Math.min(height - sum(plain) - s * 0.5, width * 0.34, s * 3.2);
    if (g < s * 1.7) return rows;
    const glyphs = glyphsOf(date);
    return [{ h: g + s * 0.45, draw: (x, y, w) => drawGlyphs(ctx, glyphs, x + (w - glyphsWidth(glyphs.length, g)) / 2, y + s * 0.15, g, inkOf(date.mark)) }, ...plain];
  };
  /**
   * What a day holds in `width` × `height`: the chips of its weekly dates and the titles of the rest, as large
   * as fit; then every date a chip; then chips without glyphs; at last as many as fit and «+2 altele».
   */
  const planDay = (list: PosterDate[], width: number, height: number, sMax: number, pMax: number, titledIn?: Set<PosterDate>): Row[] => {
    if (list.length === 0) return [];
    if (list.some((date) => date.titled)) {
      for (let s = sMax; s >= minText - 1e-6; s -= step) {
        const rows: Row[] = [];
        let run: PosterDate[] = [];
        let ok = true;
        const p = Math.max(minText, Math.min(pMax, s));
        const flush = () => {
          if (run.length === 0) return;
          const chips = pillRows(run.map((date) => pillOf(date, true)), p, width);
          if (chips) rows.push(...chips);
          else ok = false;
          run = [];
        };
        for (const date of list) {
          if (!date.titled) {
            run.push(date);
            continue;
          }
          flush();
          const block = titleRows(date, s, width);
          if (!block) ok = false;
          else rows.push(...block);
        }
        flush();
        if (ok && sum(rows) <= height) {
          for (const date of list) if (date.titled) titledIn?.add(date);
          return list.length === 1 ? withLargeGlyph(list[0], rows, s, width, height) : rows;
        }
      }
    }
    if (!keyed) {
      for (let lines = 3; lines >= 1; lines -= 1) {
        const font = face(minText, 700);
        const rows = list.flatMap((date) => {
          ctx.font = font;
          const title = wrapText(ctx, upper(date.title), width, lines).map((line) => textRow(line, font, minText, palette.cellInk, 1.16));
          const metaFont = face(minText, date.cancelled ? 700 : 500);
          ctx.font = metaFont;
          const meta = metaOf(date);
          return meta ? [...title, textRow(fitText(ctx, meta, width), metaFont, minText, inkOf(date.mark), 1.3)] : title;
        });
        if (sum(rows) <= height) return rows;
      }
    }
    for (const [glyph, tight] of [
      [true, false],
      [false, false],
      [false, true],
    ]) {
      for (let p = pMax; p >= minText - 1e-6; p -= step) {
        const rows = pillRows(list.map((date) => pillOf(date, glyph)), p, width, tight);
        if (rows && sum(rows) <= height) return rows;
      }
    }
    for (let count = list.length - 1; count >= 0; count -= 1) {
      const rows = [...(pillRows(list.slice(0, count).map((date) => pillOf(date, false)), minText, width, true) ?? []), textRow(moreText(list.length - count), face(minText, 700), minText, palette.title, 1.3)];
      if (sum(rows) <= height) return rows;
    }
    return [];
  };

  // ── The band ──
  const drawBand = (box: Box) => {
    roundRect(ctx, box.x, box.y, box.w, box.h, Math.min(24 * v, box.h * 0.2));
    ctx.fillStyle = palette.band;
    ctx.fill();
    const monthText = upper(data.words.monthName);
    const yearText = String(data.month.year);
    const heading = upper(data.words.heading);
    const measureGroup = (scale: number) => {
      const logoH = box.h * 0.62 * scale;
      const ms = box.h * 0.4 * scale;
      const ys = ms * 0.52;
      const hs = Math.max(minText, box.h * 0.12 * scale);
      const tracking = hs * 0.42;
      ctx.font = face(hs, 500);
      const headingW = trackedWidth(ctx, heading, tracking);
      const monthW = measure(monthText, face(ms, 900, true));
      const yearW = measure(yearText, face(ys, 500, true));
      const rule = box.h * 0.17 * scale;
      const textW = Math.max(headingW, monthW + ms * 0.22 + yearW);
      return { logoH, logoW: logoH * LOGO_RATIO, ms, ys, hs, tracking, monthW, rule, textW, width: logoH * LOGO_RATIO + 2 * rule + textW };
    };
    const room = box.w - box.h * 0.36;
    let group = measureGroup(1);
    if (group.width > room) group = measureGroup(room / group.width);
    const left = box.x + (box.w - group.width) / 2;
    const middle = box.y + box.h / 2;
    if (assets.logo) {
      ctx.drawImage(assets.logo, left, middle - group.logoH / 2, group.logoW, group.logoH);
    } else {
      // Until the logo loads: the mountains over the club's name, spaced, in the logo's place.
      const markH = (group.logoW * MOUNTAIN_MARK_VIEWBOX.height) / MOUNTAIN_MARK_VIEWBOX.width;
      ctx.save();
      ctx.translate(left, middle - group.logoH / 2);
      ctx.scale(group.logoW / MOUNTAIN_MARK_VIEWBOX.width, markH / MOUNTAIN_MARK_VIEWBOX.height);
      ctx.fillStyle = palette.bandInk;
      ctx.globalAlpha = 0.55;
      ctx.fill(new Path2D(FAR));
      ctx.globalAlpha = 1;
      ctx.fill(new Path2D(NEAR));
      ctx.restore();
      const nameSize = group.logoH * 0.16;
      ctx.font = face(nameSize, 500);
      ctx.fillStyle = palette.bandInk;
      const name = upper(data.clubName);
      const tracking = Math.max(0, (group.logoW - ctx.measureText(name).width) / Math.max(1, [...name].length - 1));
      fillTracked(ctx, name, left, middle + group.logoH / 2 - nameSize * 0.1, Math.min(tracking, nameSize * 0.6));
    }
    // The rule between the logo and the words.
    const ruleX = left + group.logoW + group.rule;
    ctx.fillStyle = palette.bandInk;
    ctx.globalAlpha = 0.45;
    ctx.fillRect(ruleX - v, middle - box.h * 0.27, 2 * v, box.h * 0.54);
    ctx.globalAlpha = 1;
    // «EVENIMENTE» spaced over «IUNIE 2026», the pair centred on the band's middle.
    const textX = ruleX + group.rule;
    const blockH = group.hs * 0.72 + group.ms * 0.2 + group.ms * 0.74;
    const top = middle - blockH / 2;
    ctx.font = face(group.hs, 500);
    fillTracked(ctx, heading, textX, top + group.hs * 0.72, group.tracking);
    const monthY = top + blockH;
    ctx.font = face(group.ms, 900, true);
    ctx.fillText(monthText, textX, monthY);
    ctx.font = face(group.ys, 500, true);
    ctx.globalAlpha = 0.82;
    ctx.fillText(yearText, textX + group.monthW + group.ms * 0.22, monthY);
    ctx.globalAlpha = 1;
  };

  // ── The foot: «URMĂREȘTE-NE!», each network the club has (with its name while the band holds it), the tags ──
  const footH = 60 * v * (wide ? 1.12 : 1);
  const footY = H - pad - footH;
  {
    roundRect(ctx, pad, footY, W - 2 * pad, footH, Math.min(18 * v, footH / 2));
    ctx.fillStyle = palette.band;
    ctx.fill();
    const withNames: { text: string; mark?: keyof typeof SOCIAL_MARKS; weight: number }[] = [
      { text: upper(data.words.follow) + "!", weight: 800 },
      ...data.socials.map((network) => ({ text: data.clubName, mark: network, weight: 500 })),
      { text: data.words.hashtags, weight: 500 },
    ];
    const marksOnly = withNames.map((item) => (item.mark ? { ...item, text: "" } : item));
    const room = W - 2 * pad - 40 * v;
    const widthOf = (items: typeof withNames, size: number) =>
      items.reduce((total, item) => total + (item.text ? measure(item.text, face(size, item.weight)) : 0) + (item.mark ? size * 1.2 + (item.text ? size * 0.45 : 0) : 0), 0) + (items.length - 1) * size * 1.25;
    const footMax = Math.min(22 * u, footH * 0.4);
    const items = widthOf(withNames, footMax * 0.9) <= room ? withNames : marksOnly;
    let size = footMax;
    while (size > minText && widthOf(items, size) > room) size -= step;
    let x = (W - widthOf(items, size)) / 2;
    for (const item of items) {
      if (item.mark) {
        drawGlyph(ctx, SOCIAL_MARKS[item.mark].path, x, footY + (footH - size * 1.2) / 2, size * 1.2, palette.bandInk);
        x += size * 1.2 + (item.text ? size * 0.45 : 0);
      }
      ctx.font = face(size, item.weight);
      ctx.fillStyle = palette.bandInk;
      if (item.text) ctx.fillText(item.text, x, footY + footH / 2 + size * 0.36);
      x += (item.text ? ctx.measureText(item.text).width : 0) + size * 1.25;
    }
  }

  // ── The agenda ──
  /**
   * The agenda's items at title size `a` in columns `cw` wide, `shown` of each section (the rest «+2 altele»);
   * `dense` sets a date's day and weekday on one line and its hour after its title when it fits. Null when a
   * word does not fit.
   */
  const agendaBlocks = (a: number, cw: number, shown: Shown, dense: boolean): Block[] | null => {
    const blocks: Block[] = [];
    const head = (title: string, fill: string): Block => {
      const hs = Math.max(minText, a * 0.86);
      const font = face(hs, 800);
      const words = upper(title);
      // measure() leaves the pill's font set for fitText.
      const labelW = measure(words, font);
      const label = labelW + hs * 1.7 <= cw ? words : fitText(ctx, words, cw - hs * 1.7);
      const w = Math.min(cw, labelW + hs * 1.7);
      const h = hs * (dense ? 1.75 : 1.95);
      return {
        h: h + a * (dense ? 0.4 : 0.55),
        after: 0,
        head: true,
        draw: (x, y) => {
          roundRect(ctx, x, y, w, h, h / 2);
          ctx.fillStyle = fill;
          ctx.fill();
          ctx.font = font;
          ctx.fillStyle = palette.bandInk;
          ctx.fillText(label, x + hs * 0.85, y + h / 2 + hs * 0.36);
        },
      };
    };
    const more = (count: number): Block => ({
      h: a * 1.5,
      after: 0,
      head: false,
      draw: (x, y) => {
        ctx.font = face(a, 700);
        ctx.fillStyle = palette.title;
        ctx.fillText(moreText(count), x, y + a * 1.05);
      },
    });
    const titleFont = face(a, 700);
    const lineH = a * 1.2;
    if (seriesRows.length > 0 && shown.series > 0) {
      blocks.push(head(data.words.recurringTitle, palette.band));
      const p = Math.max(minText, a * 0.84);
      const pills: Pill[] = seriesRows.map((row) => ({ glyphs: eventGlyphs(row.type, row.surface), text: row.hour ?? "", mark: "weekly", cancelled: false }));
      const chipW = Math.max(...pills.map((pill) => pillW(pill, p)));
      const indent = chipW + a * 0.65;
      const textW = cw - indent;
      const sm = Math.max(minText, a * 0.8);
      const sentenceFont = face(sm, 500);
      for (const [index, row] of seriesRows.slice(0, shown.series).entries()) {
        const title = wrap(upper(row.title), titleFont, textW);
        const sentence = wrap(row.sentence, sentenceFont, textW);
        if (((!title.fits || !sentence.fits) && a > minText + 1e-6) || textW < cw * 0.45) return null;
        const textH = title.lines.length * lineH + sentence.lines.length * sm * 1.3;
        const after = a * (dense ? 0.4 : 0.6);
        blocks.push({
          h: Math.max(pillH(p), textH) + after,
          after,
          head: false,
          draw: (x, y) => {
            drawPill(pills[index], x, y + lineH * 0.5 - pillH(p) / 2, p);
            ctx.font = titleFont;
            ctx.fillStyle = palette.cellInk;
            title.lines.forEach((line, at) => ctx.fillText(fitText(ctx, line, textW), x + indent, y + at * lineH + a * 0.92));
            ctx.font = sentenceFont;
            ctx.fillStyle = palette.title;
            sentence.lines.forEach((line, at) => ctx.fillText(fitText(ctx, line, textW), x + indent, y + title.lines.length * lineH + at * sm * 1.3 + sm * 1.0));
          },
        });
      }
      if (shown.series < seriesRows.length) blocks.push(more(seriesRows.length - shown.series));
    }
    if (shown.own.length > 0 || shown.hidden > 0) {
      if (blocks.length > 0) blocks[blocks.length - 1].h += a * 0.4;
      blocks.push(head(data.words.specialTitle, palette.special[1]));
      const insetX = a * 0.5;
      const insetY = a * (dense ? 0.32 : 0.5);
      const ds = a * (dense ? 1.15 : 1.55);
      const dayFont = face(ds, 800);
      const ws = Math.max(minText, a * (dense ? 0.7 : 0.6));
      const weekdayFont = face(ws, 700);
      const weekday = (day: number) => upper(data.words.weekdays[weekdayOf(day)]).replace(/\.$/, "");
      const dayW = Math.max(0, ...shown.own.map((date) => measure(String(date.day), dayFont)));
      const weekdayW = Math.max(0, ...shown.own.map((date) => measure(weekday(date.day), weekdayFont)));
      // Roomy: the weekday under the day; dense: beside it, the pair one line high.
      const dateW = dense ? dayW + a * 0.3 + weekdayW : Math.max(dayW, weekdayW);
      const dateH = dense ? lineH : ds * 0.78 + ws * 1.45;
      const indent = insetX + dateW + a * 0.7;
      const textW = cw - indent - insetX;
      const m = Math.max(minText, a * 0.84);
      const metaH = m * 1.4;
      for (const date of shown.own) {
        const title = wrap(upper(date.title), titleFont, textW);
        if ((!title.fits && a > minText + 1e-6) || textW < cw * 0.45) return null;
        const meta = metaOf(date);
        const metaFont = face(m, date.cancelled ? 700 : 500);
        const metaW = glyphsWidth(glyphsOf(date).length, m * 1.05) + m * 0.35 + (meta ? measure(meta, metaFont) : 0);
        // Dense: the glyph and the hour after the title's last line when they fit there.
        const lastW = Math.min(textW, measure(title.lines[title.lines.length - 1], titleFont));
        const inline = dense && lastW + a * 0.6 + metaW <= textW;
        const textH = title.lines.length * lineH + (inline ? 0 : metaH);
        const inner = Math.max(textH, dateH);
        const after = a * (dense ? 0.28 : 0.4);
        blocks.push({
          h: inner + 2 * insetY + after,
          after,
          head: false,
          draw: (x, y) => {
            const ink = inkOf(date.mark);
            roundRect(ctx, x, y, cw, inner + 2 * insetY, a * 0.55);
            ctx.fillStyle = palette[date.mark][0];
            ctx.fill();
            const textTop = y + insetY + (inner - textH) / 2;
            ctx.font = dayFont;
            ctx.fillStyle = ink;
            if (dense) {
              // «8 SÂM» on the title's first line.
              const baseline = textTop + a * 0.92;
              ctx.fillText(String(date.day), x + insetX + dayW - measure(String(date.day), dayFont), baseline);
              ctx.font = weekdayFont;
              ctx.fillStyle = palette.cellInk;
              ctx.fillText(weekday(date.day), x + insetX + dayW + a * 0.3, baseline);
            } else {
              // The day and its weekday, centred in their own column.
              const dateTop = y + insetY + (inner - dateH) / 2;
              ctx.textAlign = "center";
              ctx.fillText(String(date.day), x + insetX + dateW / 2, dateTop + ds * 0.78);
              ctx.font = weekdayFont;
              ctx.fillStyle = palette.cellInk;
              ctx.fillText(weekday(date.day), x + insetX + dateW / 2, dateTop + dateH - ws * 0.25);
              ctx.textAlign = "left";
            }
            ctx.font = titleFont;
            ctx.fillStyle = palette.cellInk;
            title.lines.forEach((line, at) => ctx.fillText(fitText(ctx, line, textW), x + indent, textTop + at * lineH + a * 0.92));
            const metaX = inline ? x + indent + lastW + a * 0.6 : x + indent;
            const metaY = inline ? textTop + (title.lines.length - 1) * lineH + (lineH - metaH) / 2 : textTop + title.lines.length * lineH;
            const glyphW = drawGlyphs(ctx, glyphsOf(date), metaX, metaY + (metaH - m * 1.05) / 2, m * 1.05, ink);
            if (meta) {
              ctx.font = metaFont;
              ctx.fillStyle = date.cancelled ? ink : palette.title;
              ctx.fillText(meta, metaX + glyphW + m * 0.35, metaY + metaH / 2 + m * 0.36);
            }
          },
        });
      }
      if (shown.hidden > 0) blocks.push(more(shown.hidden));
    }
    return blocks;
  };
  type Agenda = { a: number; cw: number; colGap: number; inset: number; columns: Block[][]; h: number; complete: boolean };
  /** The items in `count` columns of about the same height; a section's pill never ends a column. */
  const split = (blocks: Block[], count: number): { columns: Block[][]; h: number } => {
    const height = (column: Block[]) => (column.length === 0 ? 0 : sum(column) - column[column.length - 1].after);
    if (count === 1 || blocks.length < 2) return { columns: [blocks], h: height(blocks) };
    let best: { columns: Block[][]; h: number } | null = null;
    let boundary: { columns: Block[][]; h: number } | null = null;
    for (let at = 1; at < blocks.length; at += 1) {
      if (blocks[at - 1].head) continue;
      const columns = [blocks.slice(0, at), blocks.slice(at)];
      const h = Math.max(...columns.map(height));
      if (!best || h < best.h) best = { columns, h };
      // Between the two sections, when that costs little: each column under its own pill.
      if (blocks[at].head && (!boundary || h < boundary.h)) boundary = { columns, h };
    }
    if (best && boundary && boundary.h <= best.h * 1.08) return boundary;
    return best ?? { columns: [blocks], h: height(blocks) };
  };
  /**
   * The agenda in `width` × `height` at the largest title from `cap` down: roomy while that keeps the words
   * within a third of their largest, then dense; one column while it fits, else two (on 9:16 and 16:9, two
   * only when one never fits). When nothing fits, the dates whose whole title the grid shows (`covered`)
   * step out first; at last the other dates of their own and then the series give way to «+2 altele».
   * `shortest` asks the least height at the smallest size instead (what the agenda needs at the least).
   */
  const layoutAgenda = (width: number, height: number, cap: number, shortest = false, covered: ReadonlySet<PosterDate> = new Set()): Agenda | null => {
    if (seriesRows.length === 0 && singles.length === 0) return null;
    const attempt = (a: number, shown: Shown, dense: boolean, columns = shape.columns): Agenda | null => {
      let found: Agenda | null = null;
      const complete = shown.series === seriesRows.length && shown.hidden === 0;
      for (let count = 1; count <= columns; count += 1) {
        const inset = Math.max(16 * v, a * (dense ? 0.65 : 0.8));
        const colGap = a * 1.3;
        const cw = (width - 2 * inset - (count - 1) * colGap) / count;
        if (count > 1 && cw < 330 * u) continue;
        const blocks = agendaBlocks(a, cw, shown, dense);
        if (!blocks) continue;
        const columns = split(blocks, count);
        const h = columns.h + 2 * inset;
        if (h <= height + 0.5 && (!found || h < found.h)) found = { a, cw, colGap, inset, columns: columns.columns, h, complete };
        if (found && !shortest) return found;
      }
      return found;
    };
    const all: Shown = { series: seriesRows.length, own: singles, hidden: 0 };
    if (shortest) return attempt(minText, all, true, 2) ?? attempt(minText, all, false, 2);
    const sizes = (from: number, to: number) => {
      const list: number[] = [];
      for (let a = from; a >= to - 1e-6; a -= step) list.push(a);
      return list;
    };
    const passes: [number[], boolean][] = [
      [sizes(cap, Math.max(minText, cap * 0.7)), false],
      [sizes(cap, minText), true],
    ];
    for (const [list, dense] of passes) {
      for (const a of list) {
        const fit = attempt(a, all, dense);
        if (fit) return fit;
      }
    }
    if (shape.columns < 2) {
      for (const a of sizes(cap, minText)) {
        const fit = attempt(a, all, true, 2);
        if (fit) return fit;
      }
    }
    // The dates the grid already names in full step out of the list, then the rest give way to «+N altele»,
    // the dates of their own before the series.
    const rest = singles.filter((date) => !covered.has(date));
    if (rest.length < singles.length) {
      for (const a of sizes(cap, minText)) {
        const fit = attempt(a, { series: seriesRows.length, own: rest, hidden: 0 }, true, 2);
        if (fit) return fit;
      }
    }
    for (let count = rest.length - 1; count >= 0; count -= 1) {
      const fit = attempt(minText, { series: seriesRows.length, own: rest.slice(0, count), hidden: rest.length - count }, true, 2);
      if (fit) return fit;
    }
    for (let series = seriesRows.length - 1; series >= 1; series -= 1) {
      const fit = attempt(minText, { series, own: [], hidden: rest.length }, true, 2);
      if (fit) return fit;
    }
    return null;
  };
  /** A month of few dates sets them larger: the agenda's largest title grows by a twentieth for each row fewer than six. */
  const agendaCap = shape.agendaCap * u * (1 + Math.max(0, 6 - seriesRows.length - singles.length) * 0.05);
  const drawAgenda = (agenda: Agenda, box: Box, frame = true) => {
    if (frame) {
      roundRect(ctx, box.x, box.y, box.w, box.h, 18 * v);
      ctx.strokeStyle = palette.line;
      ctx.lineWidth = 3 * v;
      ctx.stroke();
    }
    // The columns centred in the frame when it is taller than they are.
    const top = box.y + Math.max(agenda.inset, (box.h - (agenda.h - 2 * agenda.inset)) / 2);
    agenda.columns.forEach((column, index) => {
      const x = box.x + agenda.inset + index * (agenda.cw + agenda.colGap);
      let y = top;
      for (const block of column) {
        block.draw(x, y);
        y += block.h;
      }
    });
  };

  // ── The grid ──
  const weeks = monthGrid(data.month);
  const byDay = new Map<number, PosterDate[]>();
  for (const date of dates) byDay.set(date.day, [...(byDay.get(date.day) ?? []), date]);
  const headSizeOf = (cellW: number) => Math.max(minText, Math.min(19 * u, cellW * 0.115));
  const headHOf = (cellW: number) => headSizeOf(cellW) * 2.3;
  const insetOf = (cellW: number) => Math.max(4 * v, Math.min(10 * v, cellW * 0.05));
  const daySizeOf = (cellW: number, cellH: number) => Math.max(minText * 1.05, Math.min(30 * u, cellW * 0.19, cellH * 0.17));
  /** The least height a day needs: its chips without glyphs at the smallest size. */
  const cellFloor = (cellW: number) => {
    const inset = insetOf(cellW);
    const need = Math.max(0, ...[...byDay.values()].map((list) => sum(pillRows(list.map((date) => pillOf(date, false)), minText, cellW - 2 * inset, true) ?? [])));
    return inset + minText * 1.05 * 1.1 + need + inset * 0.5;
  };
  /** The empty days before the 1st (`lead`) or after the month's last day (`trail`): their week, first column and count. */
  const runOf = (which: "lead" | "trail") => {
    const row = which === "lead" ? 0 : weeks.length - 1;
    const count = weeks[row].filter((day) => !day.inMonth).length;
    return { which, row, first: which === "lead" ? 0 : 7 - count, count };
  };
  type Run = ReturnType<typeof runOf>;
  const runBox = (grid: Box, run: Run): Box => {
    const cellW = grid.w / 7;
    const headH = headHOf(cellW);
    const cellH = (grid.h - headH) / weeks.length;
    return { x: grid.x + run.first * cellW, y: grid.y + headH + run.row * cellH, w: run.count * cellW, h: cellH };
  };
  const cellsOf = (grid: Box) => {
    const cellW = grid.w / 7;
    const headH = headHOf(cellW);
    const cellH = (grid.h - headH) / weeks.length;
    const inset = insetOf(cellW);
    const dn = daySizeOf(cellW, cellH);
    const dayRow = inset + dn * 1.1;
    return {
      cellW,
      headH,
      cellH,
      inset,
      dn,
      dayRow,
      plan: (list: PosterDate[], titledIn?: Set<PosterDate>) =>
        planDay(
          list,
          cellW - 2 * inset,
          cellH - dayRow - inset * 0.5,
          Math.max(minText, Math.min(22 * u, (cellW - 2 * inset) * 0.14, cellH * 0.16)),
          Math.max(minText, Math.min(18 * u, (cellW - 2 * inset) * 0.13, cellH * 0.15)),
          titledIn,
        ),
    };
  };
  /** The dates of their own a grid of `grid`'s size shows with their whole title. */
  const titledIn = (grid: Box) => {
    const cells = cellsOf(grid);
    const titled = new Set<PosterDate>();
    for (const list of byDay.values()) cells.plan(list, titled);
    return titled;
  };
  const drawGrid = (grid: Box, hosted: { run: Run; agenda: Agenda } | null = null) => {
    const { cellW, headH, cellH, inset, dn, dayRow, plan } = cellsOf(grid);
    const inRun = (row: number, column: number) => !!hosted && row === hosted.run.row && column >= hosted.run.first && column < hosted.run.first + hosted.run.count;
    roundRect(ctx, grid.x, grid.y, grid.w, grid.h, 18 * v);
    ctx.fillStyle = palette.cell;
    ctx.fill();
    ctx.save();
    ctx.clip();
    ctx.fillStyle = palette.cellMuted;
    ctx.fillRect(grid.x, grid.y, grid.w, headH);
    // The weekdays in capitals, in full when every one fits its column.
    const hs = headSizeOf(cellW);
    ctx.font = face(hs, 800);
    const long = data.words.weekdaysLong.map(upper);
    const names = long.every((name) => ctx.measureText(name).width <= cellW - 10 * v) ? long : data.words.weekdays.map((name) => upper(name).replace(/\.$/, ""));
    ctx.textAlign = "center";
    ctx.fillStyle = palette.title;
    names.forEach((name, index) => ctx.fillText(fitText(ctx, name, cellW - 6 * v), grid.x + index * cellW + cellW / 2, grid.y + headH / 2 + hs * 0.36));
    ctx.textAlign = "left";

    let trailing: Box | null = null;
    weeks.forEach((week, row) => {
      week.forEach((day, column) => {
        const x = grid.x + column * cellW;
        const y = grid.y + headH + row * cellH;
        if (!day.inMonth) {
          if (inRun(row, column)) return;
          ctx.fillStyle = palette.cellMuted;
          ctx.globalAlpha = 0.45;
          ctx.fillRect(x, y, cellW, cellH);
          ctx.globalAlpha = 1;
          if (row === weeks.length - 1 && !trailing) trailing = { x, y, w: grid.x + grid.w - x, h: cellH };
          return;
        }
        const list = byDay.get(day.day) ?? [];
        // A date of its own tints its day, pale pink or pale yellow, as the poster marks them.
        const own = list.find((date) => date.mark !== "weekly");
        if (own) {
          ctx.fillStyle = palette[own.mark][0];
          ctx.fillRect(x, y, cellW, cellH);
        }
        ctx.fillStyle = palette.cellInk;
        ctx.font = face(dn, 800);
        ctx.fillText(String(day.day), x + inset, y + inset + dn * 0.78);
        let top = y + dayRow;
        for (const rowItem of plan(list)) {
          rowItem.draw(x + inset, top, cellW - 2 * inset);
          top += rowItem.h;
        }
      });
    });
    // The mountains across the empty days after the month, as the poster draws them.
    const tail = trailing as Box | null;
    if (tail && tail.w > cellW * 1.9) {
      const h = Math.min(tail.h * 0.7, (tail.w * MOUNTAIN_MARK_VIEWBOX.height) / MOUNTAIN_MARK_VIEWBOX.width);
      ctx.save();
      ctx.translate(tail.x, tail.y + tail.h - h);
      ctx.scale(tail.w / MOUNTAIN_MARK_VIEWBOX.width, h / MOUNTAIN_MARK_VIEWBOX.height);
      ctx.fillStyle = palette.line;
      ctx.globalAlpha = 0.5;
      ctx.fill(new Path2D(FAR));
      ctx.globalAlpha = 0.8;
      ctx.fill(new Path2D(NEAR));
      ctx.restore();
    }
    // The grid's lines over the cells.
    ctx.strokeStyle = palette.line;
    ctx.lineWidth = 2 * v;
    ctx.beginPath();
    for (let row = 0; row < weeks.length; row += 1) {
      for (let column = 1; column < 7; column += 1) {
        if (inRun(row, column - 1) && inRun(row, column)) continue;
        ctx.moveTo(grid.x + column * cellW, grid.y + headH + row * cellH);
        ctx.lineTo(grid.x + column * cellW, grid.y + headH + (row + 1) * cellH);
      }
    }
    for (let row = 0; row < weeks.length; row += 1) {
      ctx.moveTo(grid.x, grid.y + headH + row * cellH);
      ctx.lineTo(grid.x + grid.w, grid.y + headH + row * cellH);
    }
    ctx.stroke();
    ctx.restore();
    roundRect(ctx, grid.x, grid.y, grid.w, grid.h, 18 * v);
    ctx.strokeStyle = palette.line;
    ctx.lineWidth = 3 * v;
    ctx.stroke();
    if (hosted) drawAgenda(hosted.agenda, runBox(grid, hosted.run), false);
  };

  // ── The composition ──
  const bandH = Math.min(W, H) * 0.12 + Math.max(0, H - W) * 0.04;
  if (wide && keyed && (seriesRows.length > 0 || singles.length > 0)) {
    // 16:9: the grid down the left, its full height; the band and the agenda in the column beside it.
    const content: Box = { x: pad, y: pad, w: W - 2 * pad, h: footY - gap - pad };
    const gridW = content.w * 0.62;
    const side: Box = { x: content.x + gridW + gap, y: content.y, w: content.w - gridW - gap, h: content.h };
    const grid: Box = { x: content.x, y: content.y, w: gridW, h: content.h };
    drawGrid(grid);
    const band: Box = { x: side.x, y: side.y, w: side.w, h: Math.min(bandH * 1.12, side.w * 0.24) };
    drawBand(band);
    const box: Box = { x: side.x, y: band.y + band.h + gap, w: side.w, h: side.h - band.h - gap };
    const agenda = layoutAgenda(box.w, box.h, agendaCap, false, titledIn(grid));
    if (agenda) drawAgenda(agenda, box);
    return;
  }
  const band: Box = { x: pad, y: pad, w: W - 2 * pad, h: bandH };
  drawBand(band);
  const content: Box = { x: pad, y: band.y + band.h + gap, w: W - 2 * pad, h: footY - gap - (band.y + band.h + gap) };
  const cellW = content.w / 7;
  const headH = headHOf(cellW);
  const gridOf = (k: number) => headH + weeks.length * cellW * k;
  const floor = cellFloor(cellW);
  const gridMin = headH + weeks.length * floor;
  // The grid keeps the cells a day's chips need and a little more; the agenda takes at least what it needs
  // at its smallest, then grows its words into what is left; the grid takes back what the agenda leaves
  // unused, up to its most, and the agenda's frame holds the rest.
  const need = layoutAgenda(content.w, Infinity, minText, true);
  // A month with a long run of empty days before or after it: the agenda in them, the grid the whole height,
  // when that keeps the cells within the shape's measure and the agenda whole at a readable size.
  if (need && shape.inGrid > 0 && (content.h - headH) / weeks.length <= cellW * shape.inGrid) {
    const runs = [runOf("trail"), runOf("lead")].filter((run) => run.count >= 3).sort((a, b) => b.count - a.count);
    for (const run of runs) {
      const box = runBox(content, run);
      const hosted = layoutAgenda(box.w, box.h, agendaCap);
      if (hosted?.complete && hosted.a >= minText * 1.1) {
        drawGrid(content, { run, agenda: hosted });
        return;
      }
    }
  }
  const comfort = headH + weeks.length * Math.max(floor, cellW * shape.soft);
  let gridH = need ? Math.max(gridMin, Math.min(comfort, content.h - gap - need.h)) : content.h;
  let agenda: Agenda | null = null;
  if (need) {
    agenda = layoutAgenda(content.w, content.h - gap - gridH, agendaCap, false, titledIn({ ...content, h: gridH }));
    gridH = Math.max(gridH, Math.min(gridOf(shape.hard), content.h - gap - (agenda?.h ?? 0)));
  }
  drawGrid({ x: content.x, y: content.y, w: content.w, h: gridH });
  if (agenda) drawAgenda(agenda, { x: content.x, y: content.y + gridH + gap, w: content.w, h: content.h - gridH - gap });
}
