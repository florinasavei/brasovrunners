import type { CalendarImagePalette } from "@/theme/brand";
import { FAR, MOUNTAIN_MARK_VIEWBOX, NEAR } from "@/shared/ui/MountainMark";
import { type Box, CALENDAR_IMAGE_RATIOS, detailWords, drawGlyphs, eventGlyphs, fitText, glyphsWidth, roundRect, wrapBalanced, wrapText } from "./calendar-image-canvas";
import { drawFrame } from "./calendar-image-frame";
import type { CalendarImageAssets, CalendarImageFonts, CalendarImageOptions } from "./calendar-image-draw";
import { monthGrid, type YearMonth } from "../domain/calendar";
import type { CalendarImageData, CalendarImageEntry } from "../domain/calendar-image";

/**
 * «Perioada» → «Săptămâna» (the owner, 2026-10-27, after the month picture: «I also need a weeks view»): one
 * week of the month as an agenda, for the member who posts the week's events on Monday — a story, a WhatsApp
 * square, a feed post — and finds the month's picture too much for it.
 *
 * Drawn from the month the page already carries (§489: nothing new is read, nothing new rides in the page),
 * so a week that runs into the neighbouring month shows this month's days alone, named honestly («29–30
 * iunie»). The same frame as the month pictures — the band with the logo, «EVENIMENTE» and the range in
 * italic Black, the foot with the networks and the tags — and in the body one row per day, Monday first (a
 * column per day on 16:9): the weekday in capitals over the day's number at the left, the day's dates at the
 * right, each on its card. A card's head is the date's glyphs and its hour — «ora se anunță» while the hour is
 * not set, «ANULAT» when it is off — with the details «Detalii» has on after it, «ora 19:30 · Parc · 8 km»,
 * on a second line when the card is narrow; under the head the whole title in capitals, its lines balanced.
 * No legend: nothing repeats inside a week. Every size follows the picture's, so the four formats, a week of
 * one day and one of three dates a day are one drawing.
 */

/** A week of the month: a row of `monthGrid`, Monday first, kept to this month's days. */
export type CalendarWeek = { index: number; from: number; to: number; days: number[] };

/** The month's weeks, each with the days of this month it holds. */
export function weeksOf(month: YearMonth): CalendarWeek[] {
  return monthGrid(month).map((row, index) => {
    const days = row.filter((day) => day.inMonth).map((day) => day.day);
    return { index, from: days[0], to: days[days.length - 1], days };
  });
}

/** The week at `index`, or the nearest one the month has. */
export function weekOf(month: YearMonth, index: number): CalendarWeek {
  const weeks = weeksOf(month);
  return weeks[Math.max(0, Math.min(weeks.length - 1, Math.floor(index)))];
}

/** «1–7 iunie», or «1 noiembrie» for a week with one day in the month. */
export function weekLabel({ from, to }: Pick<CalendarWeek, "from" | "to">, monthName: string): string {
  return `${from === to ? from : `${from}–${to}`} ${monthName}`;
}

/** «2026-06-01-07», the week's part of a file name. */
export function weekSlug({ year, month }: YearMonth, { from, to }: Pick<CalendarWeek, "from" | "to">): string {
  const two = (value: number) => String(value).padStart(2, "0");
  return `${year}-${two(month)}-${two(from)}-${two(to)}`;
}

/** The week the dialog offers first: today's when today is in this month, else the first with a date, else the first. */
export function initialWeek(data: Pick<CalendarImageData, "month" | "entries">, now: Date): number {
  const weeks = weeksOf(data.month);
  if (now.getFullYear() === data.month.year && now.getMonth() + 1 === data.month.month) {
    const today = now.getDate();
    return weeks.find((week) => week.days.includes(today))?.index ?? 0;
  }
  return weeks.find((week) => data.entries.some((entry) => week.days.includes(entry.day)))?.index ?? 0;
}

const clamp = (value: number, low: number, high: number) => Math.max(low, Math.min(high, value));

/**
 * The sizes on a 1080-wide picture. The titles as large as the room allows, never under 18; the hours, the
 * details and the weekday labels never under 17, the smallest a feed still reads. Every word whole while the
 * title is 26 or more, in pieces before it drops lower: under `WHOLE_MIN` a title's word wider than its card
 * is split with «-» after a vowel, and an hour too long for its line at `WHOLE_MIN` breaks at its spaces.
 */
const TITLE_MAX = 40;
const TITLE_MIN = 18;
const WHOLE_MIN = 26;
const TEXT_MIN = 17;
/** A card's head — the hour and the details — takes one line, two on a narrow card, never a third: the details past it are dropped. */
const HEAD_LINES = 2;

/** A date on its card: its head's lines (the hour, the details) and its title's at the size chosen, and the card's height. */
type Card = { entry: CalendarImageEntry; head: string[]; lines: string[]; h: number };

export function drawCalendarImageWeek(ctx: CanvasRenderingContext2D, data: CalendarImageData, options: CalendarImageOptions, fonts: CalendarImageFonts, assets: CalendarImageAssets, palette: CalendarImagePalette): void {
  const { width: W, height: H } = CALENDAR_IMAGE_RATIOS[options.ratio];
  const unit = Math.min(W, H) / 1080;
  const gap = 14 * unit;
  const px = (size: number) => Math.round(size * unit);
  // The poster's one geometric family: italic Black for the range, ExtraBold for the weekdays, the numbers
  // and «ANULAT», Bold for the titles, Medium for «EVENIMENTE», the hours and the details.
  const face = (size: number, weight: number) => `${weight} ${px(size)}px ${fonts.poster}`;
  const upper = (text: string) => text.toLocaleUpperCase("ro-RO");
  const week = weekOf(data.month, options.week ?? 0);
  /** The weekday a day of the week falls on, Monday 0: its column in the week's row of `monthGrid`. */
  const row = monthGrid(data.month)[week.index];
  const weekdayOf = (day: number) => row.findIndex((cell) => cell.inMonth && cell.day === day);
  const datesOf = (day: number) => data.entries.filter((entry) => entry.day === day);
  /** A special date's card pale pink, a social one's cream, as the poster marks them; a series' date stays plain. */
  const tintOf = (entry: CalendarImageEntry): "special" | "other" | null => (entry.tone === "other" ? "other" : entry.tone === "special" || entry.special ? "special" : null);
  /** What stands where the hour goes: «ora 19:30»; «ora se anunță» while the hour is not set; «ANULAT» for a date that is off. */
  const hourOf = (entry: CalendarImageEntry) => (entry.cancelled ? upper(data.words.cancelled) : entry.time ? data.words.at.replace("{time}", entry.time) : data.words.tba);
  const glyphsOf = (entry: CalendarImageEntry) => eventGlyphs(entry.type, entry.surface);
  // The page, the band and the foot are the frame's (`calendar-image-frame.ts`): the week's range as the big
  // word, and its empty line when none of its days has a date; what is left is the body's.
  const panel = drawFrame(ctx, data, options, fonts, assets, palette, {
    word: weekLabel(week, data.words.monthName),
    empty: week.days.some((day) => datesOf(day).length > 0) ? null : data.words.emptyWeek,
  });
  if (!panel) return;

  // ---- The cards: a date's glyphs, hour and details on the head's line or two, its whole title in capitals under them.
  const hourSizeOf = (size: number) => clamp(size * 0.7, TEXT_MIN, 24);
  const hourFace = (entry: CalendarImageEntry, size: number) => face(hourSizeOf(size), entry.cancelled ? 800 : 500);
  const hourLineOf = (size: number) => hourSizeOf(size) * 1.5 * unit;
  const glyphSizeOf = (size: number) => hourSizeOf(size) * 1.25 * unit;
  const titleLineOf = (size: number) => size * 1.15 * unit;
  const cardPadOf = (size: number) => size * 0.55 * unit;
  const cardGapOf = (size: number) => size * 0.35 * unit;
  const textWidthOf = (cardW: number, size: number) => cardW - 2 * cardPadOf(size) * 1.2;
  /** The head's first line: the card's width less the glyphs and the gap behind them. */
  const headRoomOf = (entry: CalendarImageEntry, cardW: number, size: number) => textWidthOf(cardW, size) - glyphsWidth(glyphsOf(entry).length, glyphSizeOf(size)) - 8 * unit;
  const cardOf = (entry: CalendarImageEntry, head: string[], lines: string[], size: number): Card => ({ entry, head, lines, h: 2 * cardPadOf(size) + head.length * hourLineOf(size) + lines.length * titleLineOf(size) });
  /** Whether the hour stands whole after the glyphs, on the head's first line, at `size`. */
  const hourFits = (entry: CalendarImageEntry, cardW: number, size: number) => {
    ctx.font = hourFace(entry, size);
    return ctx.measureText(hourOf(entry)).width <= headRoomOf(entry, cardW, size);
  };
  /**
   * A card's head at `size`, in at most `HEAD_LINES` lines of the card's width, the first shorter by the
   * glyphs: the hour whole on the first line, then the details «Detalii» has on after it — «ora 19:30 · Parc
   * · 8 km» — running on to the second line, a detail never broken, and those with no room dropped from the
   * end: the climb first, the place last. A cancelled date's head is «ANULAT» alone.
   *
   * Null when the hour is too long for the first line at this size, for a smaller size to try — unless it is
   * too long at `WHOLE_MIN` too (English «time to be announced» on a 16:9 column), and the title is not
   * shrunk to the floor for it: then it breaks at its spaces over the head's lines and the details give it
   * their room, so none of them is glued to the end of a broken hour. A word that cannot break («CANCELLED»)
   * stays null until the size below holds it.
   */
  function headOf(entry: CalendarImageEntry, cardW: number, size: number): string[] | null {
    const hour = hourOf(entry);
    const whole = hourFits(entry, cardW, size);
    if (!whole && hourFits(entry, cardW, WHOLE_MIN)) return null;
    ctx.font = hourFace(entry, size);
    const width = textWidthOf(cardW, size);
    const fits = (text: string, line: number) => ctx.measureText(text).width <= (line === 0 ? headRoomOf(entry, cardW, size) : width);
    const lines: string[] = [];
    /** `word` after the last line, `glue` between, or opening the next line while there is one: whether it found room. */
    const add = (word: string, glue: string) => {
      const last = lines.length - 1;
      if (last >= 0 && fits(`${lines[last]}${glue}${word}`, last)) lines[last] += `${glue}${word}`;
      else if (lines.length < HEAD_LINES && fits(word, lines.length)) lines.push(word);
      else return false;
      return true;
    };
    if (!whole) return hour.split(" ").every((word) => add(word, " ")) ? lines : null;
    lines.push(hour);
    for (const word of entry.cancelled ? [] : detailWords(entry, options.details)) if (!add(word, " · ")) break;
    return lines;
  }
  /**
   * A day's dates as cards `cardW` wide at `size`, the heads and the titles whole — null when the hour does not
   * fit its line or a word alone is wider than a card: under `WHOLE_MIN` the title is split with «-» after a
   * vowel, but a word too short to split stays wider than the line, and the size below is tried.
   */
  function cardsWhole(entries: CalendarImageEntry[], cardW: number, size: number): Card[] | null {
    const cards: Card[] = [];
    const width = textWidthOf(cardW, size);
    for (const entry of entries) {
      const head = headOf(entry, cardW, size);
      if (!head) return null;
      ctx.font = face(size, 700);
      const lines = wrapBalanced(ctx, upper(entry.title), width, { hyphenate: size < WHOLE_MIN });
      if (lines.some((line) => ctx.measureText(line).width > width)) return null;
      cards.push(cardOf(entry, head, lines, size));
    }
    return cards;
  }
  /** The same at the smallest size, each title cut to `maxLines` with «…» — and the hour too, when even it is long: what remains when nothing whole fits. */
  const cardsCut = (entries: CalendarImageEntry[], cardW: number, maxLines: number): Card[] =>
    entries.map((entry) => {
      const head =
        headOf(entry, cardW, TITLE_MIN) ??
        (() => {
          ctx.font = hourFace(entry, TITLE_MIN);
          return [fitText(ctx, hourOf(entry), headRoomOf(entry, cardW, TITLE_MIN))];
        })();
      ctx.font = face(TITLE_MIN, 700);
      return cardOf(entry, head, wrapText(ctx, upper(entry.title), textWidthOf(cardW, TITLE_MIN), maxLines), TITLE_MIN);
    });
  const stackOf = (cards: Card[], size: number) => cards.reduce((sum, card) => sum + card.h, 0) + Math.max(0, cards.length - 1) * cardGapOf(size);
  function drawCard(card: Card, x: number, y: number, w: number, size: number) {
    const { entry } = card;
    const tint = tintOf(entry);
    const padX = cardPadOf(size) * 1.2;
    const padY = cardPadOf(size);
    roundRect(ctx, x, y, w, card.h, 14 * unit);
    ctx.fillStyle = tint ? palette[tint][0] : palette.weekly[0];
    ctx.fill();
    if (!tint) {
      ctx.strokeStyle = palette.line;
      ctx.lineWidth = 2 * unit;
      ctx.stroke();
    }
    // The head: the glyphs in the kind's colour, then the hour and the details in the hour's ink — or «ANULAT»
    // in its place — the second line, when there is one, starting under the glyphs.
    const hourSize = hourSizeOf(size);
    const glyph = glyphSizeOf(size);
    const lineH = hourLineOf(size);
    const middle = y + padY + lineH / 2;
    const glyphsW = drawGlyphs(ctx, glyphsOf(entry), x + padX, middle - glyph / 2, glyph, tint ? palette[tint][1] : palette.weekly[1]);
    ctx.font = hourFace(entry, size);
    ctx.fillStyle = entry.cancelled ? palette.special[1] : palette.title;
    card.head.forEach((line, index) => ctx.fillText(line, x + padX + (index === 0 ? glyphsW + 8 * unit : 0), middle + index * lineH + hourSize * 0.36 * unit));
    // The title, whole, in capitals.
    ctx.font = face(size, 700);
    ctx.fillStyle = palette.cellInk;
    let lineY = y + padY + card.head.length * lineH;
    for (const text of card.lines) {
      lineY += titleLineOf(size);
      ctx.fillText(text, x + padX, lineY - size * 0.25 * unit);
    }
  }

  /**
   * The mountains low in `box`, as the month pictures draw them across empty days, and where their skyline
   * begins; null, and nothing drawn, when the room is slight.
   */
  function drawMountains(box: Box): number | null {
    if (box.h < 90 * unit) return null;
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
    return box.y + box.h - h;
  }

  // ---- The body: the panel between the band and the foot, the week inside it.
  const inset = 14 * unit;
  roundRect(ctx, panel.x, panel.y, panel.w, panel.h, 18 * unit);
  ctx.fillStyle = palette.cell;
  ctx.fill();
  ctx.save();
  ctx.clip();
  const hairline = (x1: number, y1: number, x2: number, y2: number) => {
    ctx.strokeStyle = palette.line;
    ctx.lineWidth = 2 * unit;
    ctx.beginPath();
    ctx.moveTo(x1, y1);
    ctx.lineTo(x2, y2);
    ctx.stroke();
  };
  /**
   * The largest title size at which `fits` holds with the titles whole, else the smallest with the titles cut a
   * line at a time — down to one line each, which is drawn whether it fits or not: a day of many dates comes to
   * that, and the overflow test says where.
   */
  function largest<T>(whole: (size: number) => T | null, cut: (maxLines: number) => T, fits: (plan: T, size: number) => boolean, max: number): { plan: T; size: number } {
    for (let size = max; size >= TITLE_MIN; size -= 1) {
      const plan = whole(size);
      if (plan && fits(plan, size)) return { plan, size };
    }
    for (let maxLines = 8; maxLines >= 2; maxLines -= 1) {
      const plan = cut(maxLines);
      if (fits(plan, TITLE_MIN)) return { plan, size: TITLE_MIN };
    }
    return { plan: cut(1), size: TITLE_MIN };
  }

  if (W > H) {
    // 16:9: a column per day, the weekday and the number at its head on the muted row, the dates stacked under.
    const count = week.days.length;
    const cellW = (panel.w - 2 * inset) / count;
    const cw = cellW / unit;
    let labelSize = clamp(cw * 0.085, TEXT_MIN, 22);
    ctx.font = face(labelSize, 800);
    const widest = Math.max(...data.words.weekdaysLong.map((name) => ctx.measureText(upper(name)).width));
    if (widest > cellW - 16 * unit) labelSize = Math.max(TEXT_MIN, (labelSize * (cellW - 16 * unit)) / widest);
    const numSize = clamp(cw * 0.2, 28, 52);
    const headH = 12 * unit + labelSize * 0.72 * unit + 8 * unit + numSize * 0.72 * unit + 12 * unit;
    const cardInset = 6 * unit;
    const cardW = cellW - 2 * cardInset;
    const stacksTop = panel.y + inset + headH + 8 * unit;
    const room = panel.y + panel.h - inset - stacksTop;
    // Each column at the largest size its own dates allow in the same room: one long word on Saturday must not
    // shrink Tuesday's two-word title to the floor beside 70 % of empty column.
    const max = Math.floor(clamp(cw * 0.14, TITLE_MIN, TITLE_MAX));
    const columns = week.days.map((day) => {
      const entries = datesOf(day);
      return largest((size) => cardsWhole(entries, cardW, size), (maxLines) => cardsCut(entries, cardW, maxLines), (cards, size) => stackOf(cards, size) <= room, max);
    });
    ctx.fillStyle = palette.cellMuted;
    ctx.fillRect(panel.x, panel.y, panel.w, inset + headH);
    let lowest = stacksTop;
    week.days.forEach((day, column) => {
      const { plan: cards, size } = columns[column];
      const x = panel.x + inset + column * cellW;
      const middle = x + cellW / 2;
      // A day with nothing: its head alone, muted.
      ctx.globalAlpha = cards.length > 0 ? 1 : 0.6;
      ctx.textAlign = "center";
      ctx.font = face(labelSize, 800);
      ctx.fillStyle = palette.title;
      ctx.fillText(fitText(ctx, upper(data.words.weekdaysLong[weekdayOf(day)]), cellW - 16 * unit), middle, panel.y + inset + 12 * unit + labelSize * 0.72 * unit);
      ctx.font = face(numSize, 800);
      ctx.fillStyle = palette.cellInk;
      ctx.fillText(String(day), middle, panel.y + inset + headH - 12 * unit);
      ctx.textAlign = "left";
      ctx.globalAlpha = 1;
      let y = stacksTop;
      for (const card of cards) {
        drawCard(card, x + cardInset, y, cardW, size);
        y += card.h + cardGapOf(size);
      }
      lowest = Math.max(lowest, y);
    });
    // The columns stand on the mountains: their lines end where the skyline begins.
    const skyline = drawMountains({ x: panel.x + inset, y: lowest + gap, w: panel.w - 2 * inset, h: panel.y + panel.h - inset - lowest - gap });
    for (let column = 1; column < count; column += 1) hairline(panel.x + inset + column * cellW, panel.y + inset, panel.x + inset + column * cellW, skyline ?? panel.y + panel.h - inset);
  } else {
    // Portrait, square and story: a row per day. At the left the weekday over the number; at the right the
    // cards. The rows share the height by their content — a day with nothing stays slim and muted.
    const rowPad = 10 * unit;
    const labelSize = clamp((panel.w / unit) * 0.024, 18, 26);
    const numSize = clamp((panel.w / unit) * 0.052, 34, 56);
    ctx.font = face(labelSize, 800);
    const widestLabel = Math.max(...data.words.weekdaysLong.map((name) => ctx.measureText(upper(name)).width));
    ctx.font = face(numSize, 800);
    const leftW = Math.max(widestLabel, ctx.measureText("30").width) + 2 * inset;
    const cardsX = panel.x + inset + leftW;
    const cardsW = panel.x + panel.w - inset - cardsX;
    const slimH = clamp(panel.h * 0.065, 40 * unit, 60 * unit);
    const leftBlock = labelSize * 0.72 * unit + 8 * unit + numSize * 0.72 * unit;
    const room = panel.h - 2 * inset;
    type Row = { day: number; cards: Card[]; need: number; h: number };
    const rowOf = (day: number, cards: Card[], size: number): Row => {
      const need = cards.length === 0 ? slimH : Math.max(stackOf(cards, size), leftBlock) + 2 * rowPad;
      return { day, cards, need, h: need };
    };
    const rowsWhole = (size: number): Row[] | null => {
      const rows: Row[] = [];
      for (const day of week.days) {
        const cards = cardsWhole(datesOf(day), cardsW, size);
        if (!cards) return null;
        rows.push(rowOf(day, cards, size));
      }
      return rows;
    };
    const rowsCut = (maxLines: number): Row[] => week.days.map((day) => rowOf(day, cardsCut(datesOf(day), cardsW, maxLines), TITLE_MIN));
    const totalOf = (rows: Row[]) => rows.reduce((sum, row) => sum + row.h, 0);
    // One size for the whole agenda: the rows are the panel's width, so a long word costs them little.
    const { plan: rows, size } = largest(rowsWhole, rowsCut, (plan) => totalOf(plan) <= room, TITLE_MAX);
    // What is left goes to the rows with content, each by its need and at most half as much again, so the
    // week never looks like a form; past that the room stays low, for the mountains.
    const content = rows.filter((row) => row.cards.length > 0);
    const needs = content.reduce((sum, row) => sum + row.need, 0);
    const extra = Math.max(0, room - totalOf(rows));
    for (const row of content) row.h = row.need + Math.min(row.need * 0.5, (extra * row.need) / needs);
    let y = panel.y + inset;
    rows.forEach((row, index) => {
      if (index > 0) hairline(panel.x + inset, y, panel.x + panel.w - inset, y);
      const weekday = upper(data.words.weekdaysLong[weekdayOf(row.day)]);
      const left = panel.x + inset;
      if (row.cards.length === 0) {
        // Slim and muted: the number small at the left, the weekday beside it, on one line.
        const smallNum = numSize * 0.5;
        const baseline = y + row.h / 2 + smallNum * 0.36 * unit;
        ctx.globalAlpha = 0.6;
        ctx.font = face(smallNum, 800);
        ctx.fillStyle = palette.cellInk;
        ctx.fillText(String(row.day), left, baseline);
        const numW = ctx.measureText(String(row.day)).width;
        ctx.font = face(Math.max(TEXT_MIN, labelSize * 0.85), 800);
        ctx.fillStyle = palette.title;
        ctx.fillText(fitText(ctx, weekday, panel.w - 2 * inset - numW - 12 * unit), left + numW + 12 * unit, baseline);
        ctx.globalAlpha = 1;
      } else {
        const top = y + (row.h - leftBlock) / 2;
        ctx.font = face(labelSize, 800);
        ctx.fillStyle = palette.title;
        ctx.fillText(weekday, left, top + labelSize * 0.72 * unit);
        ctx.font = face(numSize, 800);
        ctx.fillStyle = palette.cellInk;
        ctx.fillText(String(row.day), left, top + leftBlock);
        let cardY = y + (row.h - stackOf(row.cards, size)) / 2;
        for (const card of row.cards) {
          drawCard(card, cardsX, cardY, cardsW, size);
          cardY += card.h + cardGapOf(size);
        }
      }
      y += row.h;
    });
    drawMountains({ x: panel.x + inset, y: y + gap, w: panel.w - 2 * inset, h: panel.y + panel.h - inset - y - gap });
  }
  ctx.restore();
  roundRect(ctx, panel.x, panel.y, panel.w, panel.h, 18 * unit);
  ctx.strokeStyle = palette.line;
  ctx.lineWidth = 3 * unit;
  ctx.stroke();
}
