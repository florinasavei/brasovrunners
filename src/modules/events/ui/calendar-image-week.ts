import type { CalendarImagePalette } from "@/theme/brand";
import { FAR, MOUNTAIN_MARK_VIEWBOX, NEAR } from "@/shared/ui/MountainMark";
import { SOCIAL_MARKS } from "@/shared/ui/SocialIcon";
import { type Box, CALENDAR_IMAGE_RATIOS, drawGlyphs, eventGlyphs, fillSpaced, fitText, LOGO_RATIO, roundRect, wrapText } from "./calendar-image-canvas";
import type { CalendarImageAssets, CalendarImageFonts, CalendarImageOptions } from "./calendar-image-draw";
import { wrapWhole } from "./calendar-image-poster-heads";
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
 * right, each on its card with its glyphs, its hour and its whole title in capitals. No legend: nothing
 * repeats inside a week. Every size follows the picture's, so the four formats, a week of one day and one of
 * three dates a day are one drawing.
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

/** The titles' sizes on a 1080-wide picture: as large as the room allows, never under 18. */
const TITLE_MAX = 40;
const TITLE_MIN = 18;

/** A date on its card: its title's lines at the size chosen, and the card's height. */
type Card = { entry: CalendarImageEntry; lines: string[]; h: number };

export function drawCalendarImageWeek(ctx: CanvasRenderingContext2D, data: CalendarImageData, options: CalendarImageOptions, fonts: CalendarImageFonts, assets: CalendarImageAssets, palette: CalendarImagePalette): void {
  const { width: W, height: H } = CALENDAR_IMAGE_RATIOS[options.ratio];
  const unit = Math.min(W, H) / 1080;
  const pad = 32 * unit;
  const gap = 14 * unit;
  const px = (size: number) => Math.round(size * unit);
  // The poster's one geometric family: italic Black for the range, ExtraBold for the weekdays and the
  // numbers, Bold for the titles, Medium for «EVENIMENTE» and the hours.
  const face = (size: number, weight: number) => `${weight} ${px(size)}px ${fonts.poster}`;
  const upper = (text: string) => text.toLocaleUpperCase("ro-RO");
  const week = weekOf(data.month, options.week ?? 0);
  const weekdayOf = (day: number) => (new Date(Date.UTC(data.month.year, data.month.month - 1, day)).getUTCDay() + 6) % 7;
  const datesOf = (day: number) => data.entries.filter((entry) => entry.day === day);
  /** A special date's card pale pink, a social one's cream, as the poster marks them; a series' date stays plain. */
  const tintOf = (entry: CalendarImageEntry): "special" | "other" | null => (entry.tone === "other" ? "other" : entry.tone === "special" || entry.special ? "special" : null);
  const hourOf = (entry: CalendarImageEntry) => (entry.cancelled ? upper(data.words.cancelled) : entry.time ? data.words.at.replace("{time}", entry.time) : "");
  ctx.textBaseline = "alphabetic";
  ctx.textAlign = "left";
  // The page: the palette's two stops, top to bottom (one colour on «Afiș»).
  const page = ctx.createLinearGradient(0, 0, 0, H);
  page.addColorStop(0, palette.background[0]);
  page.addColorStop(1, palette.background[1]);
  ctx.fillStyle = page;
  ctx.fillRect(0, 0, W, H);

  // Instagram's own bars cover a story's top 250 and bottom 340 pixels, and the profile grid's crop of a 4:5
  // post loses about 67 at each end: the band and the foot keep inside them.
  const safeTop = options.ratio === "story" ? 250 * unit : options.ratio === "portrait" ? 67 * unit : pad;
  const safeBottom = options.ratio === "story" ? 340 * unit : options.ratio === "portrait" ? 67 * unit : pad;

  // The band, one line: the club's real logo at the left (or, until it loads, the mountains over the
  // spaced name), and at the right «EVENIMENTE» in spaced capitals over the range in italic Black, its
  // year beside it lighter.
  const bandH = clamp(H * 0.105, 118 * unit, 180 * unit);
  const bandY = safeTop;
  roundRect(ctx, pad, bandY, W - 2 * pad, bandH, 24 * unit);
  ctx.fillStyle = palette.band;
  ctx.fill();
  ctx.fillStyle = palette.bandInk;
  const bandInset = bandH * 0.15;
  const logoH = bandH - 2 * bandInset;
  const logoW = logoH * LOGO_RATIO;
  const logoX = pad + bandInset * 1.6;
  if (assets.logo) {
    ctx.drawImage(assets.logo, logoX, bandY + bandInset, logoW, logoH);
  } else {
    const nameSize = (logoH / unit) * 0.17;
    const markH = logoH - nameSize * 1.7 * unit;
    const markW = (markH * MOUNTAIN_MARK_VIEWBOX.width) / MOUNTAIN_MARK_VIEWBOX.height;
    ctx.save();
    ctx.translate(logoX + (logoW - markW) / 2, bandY + bandInset);
    ctx.scale(markW / MOUNTAIN_MARK_VIEWBOX.width, markH / MOUNTAIN_MARK_VIEWBOX.height);
    ctx.globalAlpha = 0.55;
    ctx.fill(new Path2D(FAR));
    ctx.globalAlpha = 1;
    ctx.fill(new Path2D(NEAR));
    ctx.restore();
    ctx.font = face(nameSize, 500);
    fillSpaced(ctx, upper(data.clubName), logoX + logoW / 2, bandY + bandH - bandInset, px(nameSize * 0.35), logoW);
  }
  const bandRight = W - pad - bandInset * 1.8;
  const bandRoom = bandRight - (logoX + logoW + bandInset * 2);
  const rangeText = upper(weekLabel(week, data.words.monthName));
  const yearText = ` ${data.month.year}`;
  const rangePair = (size: number) => {
    ctx.font = `italic ${face(size, 900)}`;
    const rangeW = ctx.measureText(rangeText).width;
    ctx.font = `italic ${face(size * 0.56, 500)}`;
    return { size, rangeW, width: rangeW + ctx.measureText(yearText).width };
  };
  let range = rangePair((bandH / unit) * 0.52);
  if (range.width > bandRoom) range = rangePair((range.size * bandRoom) / range.width);
  const kickerSize = Math.max(14, range.size * 0.29);
  const capK = kickerSize * 0.7 * unit;
  const capR = range.size * 0.7 * unit;
  const between = kickerSize * 0.6 * unit;
  const blockTop = bandY + (bandH - capK - between - capR) / 2;
  const rangeY = blockTop + capK + between + capR;
  ctx.font = `italic ${face(range.size, 900)}`;
  ctx.fillText(rangeText, bandRight - range.width, rangeY);
  ctx.font = `italic ${face(range.size * 0.56, 500)}`;
  ctx.globalAlpha = 0.8;
  ctx.fillText(yearText, bandRight - range.width + range.rangeW, rangeY);
  ctx.globalAlpha = 1;
  ctx.font = face(kickerSize, 500);
  const kicker = upper(data.words.heading);
  const tracking = px(kickerSize * 0.42);
  const kickerW = [...kicker].reduce((sum, letter) => sum + ctx.measureText(letter).width, 0) + tracking * ([...kicker].length - 1);
  fillSpaced(ctx, kicker, bandRight - Math.min(kickerW, bandRoom) / 2, blockTop + capK, tracking, bandRoom);

  // The foot: «URMĂREȘTE-NE!», each network the club has with its name, then the tags.
  const footH = 64 * unit;
  const footY = H - safeBottom - footH;
  roundRect(ctx, pad, footY, W - 2 * pad, footH, 18 * unit);
  ctx.fillStyle = palette.band;
  ctx.fill();
  // Each network beside the club's name while the band holds it; past that, the marks alone.
  const withNames: { text: string; mark?: keyof typeof SOCIAL_MARKS; weight: number }[] = [
    { text: upper(data.words.follow) + "!", weight: 800 },
    ...data.socials.map((network) => ({ text: data.clubName, mark: network, weight: 500 })),
    { text: data.words.hashtags, weight: 500 },
  ];
  const marksOnly = withNames.map((item) => (item.mark ? { ...item, text: "" } : item));
  const markSize = 28 * unit;
  const room = W - 2 * pad - 40 * unit;
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

  // ---- The cards: a date's glyphs and hour on one line, its whole title in capitals under them.
  const hourSizeOf = (size: number) => clamp(size * 0.7, 15, 24);
  const hourLineOf = (size: number) => hourSizeOf(size) * 1.5 * unit;
  const titleLineOf = (size: number) => size * 1.15 * unit;
  const cardPadOf = (size: number) => size * 0.55 * unit;
  const cardGapOf = (size: number) => size * 0.35 * unit;
  const textWidthOf = (cardW: number, size: number) => cardW - 2 * cardPadOf(size) * 1.2;
  /**
   * A day's dates as cards `cardW` wide at `size`, the titles whole — null when a word alone is wider than a
   * card, except at the smallest size, where it is split with «-». With `maxLines`, the titles are cut instead.
   */
  function cardsAt(entries: CalendarImageEntry[], cardW: number, size: number, maxLines = 0): Card[] | null {
    ctx.font = face(size, 700);
    const cards: Card[] = [];
    for (const entry of entries) {
      const title = upper(entry.title);
      const lines = maxLines > 0 ? wrapText(ctx, title, textWidthOf(cardW, size), maxLines) : wrapWhole(ctx, title, textWidthOf(cardW, size), size === TITLE_MIN);
      if (!lines) return null;
      cards.push({ entry, lines, h: 2 * cardPadOf(size) + hourLineOf(size) + lines.length * titleLineOf(size) });
    }
    return cards;
  }
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
    // The first line: the glyphs in the kind's colour, then the hour — or «ANULAT» in its place.
    const hourSize = hourSizeOf(size);
    const glyph = hourSize * 1.25 * unit;
    const middle = y + padY + hourLineOf(size) / 2;
    let lineX = x + padX;
    const lineEnd = x + w - padX;
    lineX += drawGlyphs(ctx, eventGlyphs(entry.type, entry.surface), lineX, middle - glyph / 2, glyph, tint ? palette[tint][1] : palette.weekly[1]) + 8 * unit;
    const hour = hourOf(entry);
    if (hour) {
      ctx.font = face(hourSize, entry.cancelled ? 700 : 500);
      ctx.fillStyle = entry.cancelled ? palette.special[1] : palette.title;
      const shown = fitText(ctx, hour, lineEnd - lineX);
      ctx.fillText(shown, lineX, middle + hourSize * 0.36 * unit);
      lineX += ctx.measureText(shown).width + 14 * unit;
    }
    // ← The detail words go here, after the hour, in the hour's face and colour: the place, the distance,
    //   the climb (a sibling branch prepares them). The line runs on from `lineX` to `lineEnd`, its baseline
    //   at `middle + hourSize * 0.36 * unit`; a word the line has no room for is left out, never cut into
    //   the title.
    // The title, whole, in capitals.
    ctx.font = face(size, 700);
    ctx.fillStyle = palette.cellInk;
    let lineY = y + padY + hourLineOf(size);
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
  const panel: Box = { x: pad, y: bandY + bandH + gap, w: W - 2 * pad, h: footY - gap - (bandY + bandH + gap) };
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
  /** The largest title size at which `fits` holds, else the smallest with the longest titles cut a line at a time. */
  function largest<T>(at: (size: number, maxLines: number) => T | null, fits: (plan: T, size: number) => boolean, max: number): { plan: T; size: number } | null {
    for (let size = max; size >= TITLE_MIN; size -= 1) {
      const plan = at(size, 0);
      if (plan && fits(plan, size)) return { plan, size };
    }
    for (let maxLines = 8; maxLines >= 1; maxLines -= 1) {
      const plan = at(TITLE_MIN, maxLines);
      if (plan && (fits(plan, TITLE_MIN) || maxLines === 1)) return { plan, size: TITLE_MIN };
    }
    return null;
  }

  if (W > H) {
    // 16:9: a column per day, the weekday and the number at its head on the muted row, the dates stacked under.
    const columns = week.days.length;
    const cellW = (panel.w - 2 * inset) / columns;
    const cw = cellW / unit;
    let labelSize = clamp(cw * 0.085, 14, 22);
    ctx.font = face(labelSize, 800);
    const widest = Math.max(...data.words.weekdaysLong.map((name) => ctx.measureText(upper(name)).width));
    if (widest > cellW - 16 * unit) labelSize = Math.max(14, (labelSize * (cellW - 16 * unit)) / widest);
    const numSize = clamp(cw * 0.2, 28, 52);
    const headH = 12 * unit + labelSize * 0.72 * unit + 8 * unit + numSize * 0.72 * unit + 12 * unit;
    const cardInset = 6 * unit;
    const cardW = cellW - 2 * cardInset;
    const stacksTop = panel.y + inset + headH + 8 * unit;
    const room = panel.y + panel.h - inset - stacksTop;
    const stacksAt = (size: number, maxLines: number): Card[][] | null => {
      const stacks: Card[][] = [];
      for (const day of week.days) {
        const cards = cardsAt(datesOf(day), cardW, size, maxLines);
        if (!cards) return null;
        stacks.push(cards);
      }
      return stacks;
    };
    const fitted = largest(stacksAt, (stacks, size) => Math.max(...stacks.map((stack) => stackOf(stack, size))) <= room, Math.floor(clamp(cw * 0.14, TITLE_MIN, TITLE_MAX)));
    const stacks = fitted?.plan ?? week.days.map(() => []);
    const size = fitted?.size ?? TITLE_MIN;
    ctx.fillStyle = palette.cellMuted;
    ctx.fillRect(panel.x, panel.y, panel.w, inset + headH);
    let lowest = stacksTop;
    week.days.forEach((day, column) => {
      const x = panel.x + inset + column * cellW;
      const middle = x + cellW / 2;
      // A day with nothing: its head alone, muted.
      ctx.globalAlpha = stacks[column].length > 0 ? 1 : 0.45;
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
      for (const card of stacks[column]) {
        drawCard(card, x + cardInset, y, cardW, size);
        y += card.h + cardGapOf(size);
      }
      lowest = Math.max(lowest, y);
    });
    // The columns stand on the mountains: their lines end where the skyline begins.
    const skyline = drawMountains({ x: panel.x + inset, y: lowest + gap, w: panel.w - 2 * inset, h: panel.y + panel.h - inset - lowest - gap });
    for (let column = 1; column < columns; column += 1) hairline(panel.x + inset + column * cellW, panel.y + inset, panel.x + inset + column * cellW, skyline ?? panel.y + panel.h - inset);
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
    const rowsAt = (size: number, maxLines: number): Row[] | null => {
      const rows: Row[] = [];
      for (const day of week.days) {
        const cards = cardsAt(datesOf(day), cardsW, size, maxLines);
        if (!cards) return null;
        const need = cards.length === 0 ? slimH : Math.max(stackOf(cards, size), leftBlock) + 2 * rowPad;
        rows.push({ day, cards, need, h: need });
      }
      return rows;
    };
    const totalOf = (rows: Row[]) => rows.reduce((sum, row) => sum + row.h, 0);
    const fitted = largest(rowsAt, (rows) => totalOf(rows) <= room, TITLE_MAX);
    const rows = fitted?.plan ?? [];
    const size = fitted?.size ?? TITLE_MIN;
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
        ctx.globalAlpha = 0.45;
        ctx.font = face(smallNum, 800);
        ctx.fillStyle = palette.cellInk;
        ctx.fillText(String(row.day), left, baseline);
        const numW = ctx.measureText(String(row.day)).width;
        ctx.font = face(labelSize * 0.85, 800);
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
