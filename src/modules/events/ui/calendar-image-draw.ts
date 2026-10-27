import { CALENDAR_IMAGE_THEMES, type CalendarImagePaletteName } from "@/theme/brand";
import { FAR, MOUNTAIN_MARK_VIEWBOX, NEAR } from "@/shared/ui/MountainMark";
import { monthGrid } from "../domain/calendar";
import type { CalendarTone } from "../domain/calendar-kind";
import { type CalendarImageData, type CalendarImageEntry, LEGEND_MAX } from "../domain/calendar-image";

/**
 * «Salvează ca imagine» (§NNN): the month drawn on a `<canvas>`, in the visitor's browser. No server, no
 * function, no library — the 2D context the browser already has. Pure: the same data, options and fonts
 * draw the same picture, and nothing here touches the page.
 */

/** The picture's shapes, by where it is posted: an Instagram post, a square, a story, a Facebook post. */
export const CALENDAR_IMAGE_RATIOS = {
  portrait: { width: 1080, height: 1350 },
  square: { width: 1080, height: 1080 },
  story: { width: 1080, height: 1920 },
  landscape: { width: 1920, height: 1080 },
} as const;
export type CalendarImageRatio = keyof typeof CALENDAR_IMAGE_RATIOS;

/** «Clubul», «Luminos», «Întunecat», «Sezonul lunii». */
export const CALENDAR_IMAGE_THEME_CHOICES = ["club", "light", "dark", "season"] as const;
export type CalendarImageTheme = (typeof CALENDAR_IMAGE_THEME_CHOICES)[number];

export type CalendarImageOptions = {
  theme: CalendarImageTheme;
  ratio: CalendarImageRatio;
  /** «Evenimente recurente» and «Evenimente speciale» beside or under the grid. */
  legend: boolean;
};

/** The two faces the page loaded: the body's, and the club kit's for the name (CSS font-family lists). */
export type CalendarImageFonts = { body: string; display: string };

type Ctx = Pick<CanvasRenderingContext2D, "measureText">;

/** The palette a theme draws in: «Sezon» by the month's season. */
export function paletteFor(theme: CalendarImageTheme, month: number): CalendarImagePaletteName {
  if (theme !== "season") return theme;
  if (month === 12 || month <= 2) return "winter";
  if (month <= 5) return "spring";
  if (month <= 8) return "summer";
  return "autumn";
}

/** The longest start of `text` that fits `width` at the context's font, with «…» when cut. */
export function fitText(ctx: Ctx, text: string, width: number): string {
  if (ctx.measureText(text).width <= width) return text;
  const chars = [...text];
  let low = 0;
  let high = chars.length;
  while (low < high) {
    const mid = Math.ceil((low + high) / 2);
    if (ctx.measureText(`${chars.slice(0, mid).join("").trimEnd()}…`).width <= width) low = mid;
    else high = mid - 1;
  }
  return low === 0 ? "" : `${chars.slice(0, low).join("").trimEnd()}…`;
}

/** `text` broken at spaces into at most `maxLines` lines of `width`, the last cut with «…» when it does not end. */
export function wrapText(ctx: Ctx, text: string, width: number, maxLines: number): string[] {
  const words = text.split(/\s+/).filter(Boolean);
  const lines: string[] = [];
  let current = "";
  for (let index = 0; index < words.length; index += 1) {
    const candidate = current ? `${current} ${words[index]}` : words[index];
    if (ctx.measureText(candidate).width <= width || !current) {
      current = candidate;
      continue;
    }
    // The last line allowed takes every word left, and «…» says where it was cut.
    if (lines.length === maxLines - 1) {
      current = [current, ...words.slice(index)].join(" ");
      break;
    }
    lines.push(current);
    current = words[index];
  }
  if (current) lines.push(current);
  return lines.map((line) => fitText(ctx, line, width));
}

function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  ctx.beginPath();
  ctx.roundRect(x, y, w, h, Math.max(0, Math.min(r, h / 2, w / 2)));
}

type Box = { x: number; y: number; w: number; h: number };

export function drawCalendarImage(ctx: CanvasRenderingContext2D, data: CalendarImageData, options: CalendarImageOptions, fonts: CalendarImageFonts): void {
  const { width: W, height: H } = CALENDAR_IMAGE_RATIOS[options.ratio];
  const palette = CALENDAR_IMAGE_THEMES[paletteFor(options.theme, data.month.month)];
  const tones: Record<CalendarTone, readonly [string, string]> = { weekly: palette.weekly, special: palette.special, other: palette.other };
  const unit = Math.min(W, H) / 1080;
  const pad = 40 * unit;
  const px = (size: number) => Math.round(size * unit);
  const body = (size: number, weight = 400) => `${weight} ${px(size)}px ${fonts.body}`;
  ctx.textBaseline = "alphabetic";
  ctx.textAlign = "left";

  // The page: a gradient top to bottom.
  const gradient = ctx.createLinearGradient(0, 0, 0, H);
  gradient.addColorStop(0, palette.background[0]);
  gradient.addColorStop(1, palette.background[1]);
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, W, H);

  // The band: the mountains, the club's name in the kit's face, «Evenimente · octombrie 2026».
  const story = options.ratio === "story";
  const bandH = (story ? 220 : 170) * unit;
  roundRect(ctx, pad, pad, W - 2 * pad, bandH, 28 * unit);
  ctx.fillStyle = palette.band;
  ctx.fill();
  const markW = 150 * unit;
  const markH = (markW * MOUNTAIN_MARK_VIEWBOX.height) / MOUNTAIN_MARK_VIEWBOX.width;
  ctx.save();
  ctx.translate(pad + 32 * unit, pad + (bandH - markH) / 2);
  ctx.scale(markW / MOUNTAIN_MARK_VIEWBOX.width, markH / MOUNTAIN_MARK_VIEWBOX.height);
  ctx.fillStyle = palette.bandInk;
  ctx.globalAlpha = 0.55;
  ctx.fill(new Path2D(FAR));
  ctx.globalAlpha = 1;
  ctx.fill(new Path2D(NEAR));
  ctx.restore();
  const textX = pad + 32 * unit + markW + 28 * unit;
  const textW = W - pad - 32 * unit - textX;
  ctx.fillStyle = palette.bandInk;
  ctx.font = `italic 900 ${px(story ? 62 : 52)}px ${fonts.display}`;
  ctx.fillText(fitText(ctx, data.clubName.toUpperCase(), textW), textX, pad + bandH / 2 - 4 * unit);
  ctx.font = body(story ? 44 : 38, 700);
  ctx.fillText(fitText(ctx, `${data.words.heading} · ${data.words.monthTitle}`, textW), textX, pad + bandH / 2 + 46 * unit);

  // The foot: «Urmărește-ne · <the site>» on the band's colour, so it reads on every background.
  const footH = 56 * unit;
  ctx.font = body(30, 700);
  const foot = fitText(ctx, `${data.words.follow} · ${data.host}`, W - 2 * pad - 48 * unit);
  const footW = ctx.measureText(foot).width + 48 * unit;
  roundRect(ctx, (W - footW) / 2, H - pad - footH + 4 * unit, footW, footH - 4 * unit, footH);
  ctx.fillStyle = palette.band;
  ctx.fill();
  ctx.textAlign = "center";
  ctx.fillStyle = palette.bandInk;
  ctx.fillText(foot, W / 2, H - pad - 16 * unit);
  ctx.textAlign = "left";

  // Where the grid and the legends go: the legends beside the grid on a wide picture, under it otherwise.
  const content: Box = { x: pad, y: pad + bandH + 24 * unit, w: W - 2 * pad, h: H - pad - footH - 20 * unit - (pad + bandH + 24 * unit) };
  const columns = [
    { title: data.words.recurringTitle, rows: data.recurring.slice(0, LEGEND_MAX).map((row) => ({ lead: row.sentence, title: row.title, tone: row.tone })) },
    { title: data.words.specialTitle, rows: data.specials.slice(0, LEGEND_MAX).map((row) => ({ lead: String(row.day), title: row.title, tone: row.tone })) },
  ].filter((column) => column.rows.length > 0);
  const legend = options.legend && columns.length > 0;
  const beside = legend && options.ratio === "landscape";
  let grid = content;
  if (legend) {
    const rowH = 52 * unit;
    const titleH = 50 * unit;
    if (beside) {
      const legendW = content.w * 0.3;
      grid = { ...content, w: content.w - legendW - 24 * unit };
      drawLegend(ctx, { x: content.x + grid.w + 24 * unit, y: content.y, w: legendW, h: content.h }, [columns], titleH, rowH);
    } else {
      const legendH = titleH + Math.max(...columns.map((column) => column.rows.length)) * rowH + 20 * unit;
      grid = { ...content, h: content.h - legendH - 20 * unit };
      drawLegend(ctx, { x: content.x, y: content.y + grid.h + 20 * unit, w: content.w, h: legendH }, columns.map((column) => [column]), titleH, rowH);
    }
  }

  function drawLegend(c: CanvasRenderingContext2D, box: Box, groups: (typeof columns)[], titleH: number, rowH: number) {
    roundRect(c, box.x, box.y, box.w, box.h, 24 * unit);
    c.fillStyle = palette.cell;
    c.fill();
    const colW = (box.w - 40 * unit) / groups.length;
    groups.forEach((group, index) => {
      const x = box.x + 20 * unit + index * colW;
      let y = box.y;
      for (const column of group) {
        c.fillStyle = palette.title;
        c.font = body(28, 800);
        c.fillText(fitText(c, column.title.toUpperCase(), colW - 20 * unit), x, y + 40 * unit);
        y += titleH;
        for (const row of column.rows) {
          const [fill, ink] = tones[row.tone];
          roundRect(c, x, y + 6 * unit, colW - 20 * unit, rowH - 10 * unit, 12 * unit);
          c.fillStyle = fill;
          c.fill();
          c.fillStyle = ink;
          c.font = body(24, 700);
          const lead = fitText(c, row.lead, (colW - 40 * unit) * 0.5);
          c.fillText(lead, x + 14 * unit, y + 38 * unit);
          const leadW = c.measureText(lead).width + 14 * unit;
          c.font = body(24, 500);
          c.fillText(fitText(c, row.title, colW - 40 * unit - leadW), x + 14 * unit + leadW, y + 38 * unit);
          y += rowH;
        }
        y += 16 * unit;
      }
    });
  }

  // The grid: weekdays, then the weeks, Monday first.
  const weeks = monthGrid(data.month);
  const headH = 48 * unit;
  const gap = 8 * unit;
  const cellW = (grid.w - 6 * gap) / 7;
  const cellH = (grid.h - headH - (weeks.length - 1) * gap) / weeks.length;
  ctx.textAlign = "center";
  ctx.font = body(26, 800);
  data.words.weekdays.forEach((name, index) => {
    const x = grid.x + index * (cellW + gap);
    roundRect(ctx, x, grid.y, cellW, headH - 8 * unit, 12 * unit);
    ctx.fillStyle = palette.band;
    ctx.fill();
    ctx.fillStyle = palette.bandInk;
    ctx.fillText(fitText(ctx, name.toUpperCase(), cellW - 8 * unit), x + cellW / 2, grid.y + 30 * unit);
  });
  ctx.textAlign = "left";

  const byDay = new Map<number, CalendarImageEntry[]>();
  for (const entry of data.entries) byDay.set(entry.day, [...(byDay.get(entry.day) ?? []), entry]);
  // The day's number and the dates' words scale with the cell, within what a phone screen still reads.
  const daySize = Math.max(20, Math.min(30, (cellH / unit) * 0.26));
  const size = Math.max(14, Math.min(22, (cellW / unit) * 0.12));
  const lineH = size * 1.2 * unit;
  weeks.forEach((week, row) => {
    week.forEach((day, column) => {
      const x = grid.x + column * (cellW + gap);
      const y = grid.y + headH + row * (cellH + gap);
      roundRect(ctx, x, y, cellW, cellH, 14 * unit);
      ctx.fillStyle = day.inMonth ? palette.cell : palette.cellMuted;
      ctx.globalAlpha = day.inMonth ? 1 : 0.35;
      ctx.fill();
      ctx.globalAlpha = 1;
      if (!day.inMonth) return;
      // A hairline, so a white cell still reads on «Luminos»'s pale page.
      ctx.strokeStyle = palette.line;
      ctx.lineWidth = 2 * unit;
      ctx.stroke();
      ctx.fillStyle = palette.cellInk;
      ctx.font = body(daySize, 800);
      ctx.fillText(String(day.day), x + 12 * unit, y + (daySize + 6) * unit);
      drawEntries(byDay.get(day.day) ?? [], { x: x + 6 * unit, y: y + (daySize + 14) * unit, w: cellW - 12 * unit, h: cellH - (daySize + 20) * unit });
    });
  });

  /**
   * A day's dates in the room its cell has: each its hour over its title, the title on as many lines as fit
   * (three, then two, then one), then — when even one line each does not fit — the hour and title on one
   * line; what still does not fit is «+2 altele».
   */
  function drawEntries(entries: CalendarImageEntry[], box: Box) {
    if (entries.length === 0 || box.h < lineH) return;
    const textW = box.w - 12 * unit;
    const lead = (entry: CalendarImageEntry) => (entry.cancelled ? data.words.cancelled : (entry.time ?? ""));
    const step = 6 * unit;
    ctx.font = body(size, 600);
    const layouts = [3, 2, 1].map((maxLines) => entries.map((entry) => ({ entry, lines: wrapText(ctx, entry.title, textW, maxLines), stacked: true })));
    const height = (items: { lines: string[]; stacked: boolean }[]) => items.reduce((sum, item) => sum + (item.lines.length + (item.stacked ? 1 : 0)) * lineH + 10 * unit + step, 0);
    let items = layouts.find((candidate) => height(candidate) <= box.h);
    if (!items) items = entries.map((entry) => ({ entry, lines: [fitText(ctx, `${lead(entry)} ${entry.title}`.trim(), textW)], stacked: false }));
    // As many as fit, keeping a line for «+N altele» when some do not.
    const heightOf = (item: { lines: string[]; stacked: boolean }) => (item.lines.length + (item.stacked ? 1 : 0)) * lineH + 10 * unit;
    let fits = items.length;
    const used = (count: number) => items.slice(0, count).reduce((sum, item) => sum + heightOf(item) + step, 0);
    while (fits > 0 && (used(fits) > box.h + step || (fits < items.length && used(fits) + lineH > box.h))) fits -= 1;
    let y = box.y;
    const drawn = fits;
    for (const item of items.slice(0, fits)) {
      const h = heightOf(item);
      const [fill, ink] = tones[item.entry.tone];
      roundRect(ctx, box.x, y, box.w, h, 8 * unit);
      ctx.fillStyle = fill;
      ctx.fill();
      ctx.fillStyle = ink;
      let lineY = y + 5 * unit + lineH * 0.85;
      if (item.stacked && lead(item.entry)) {
        ctx.font = body(size * 0.9, 800);
        ctx.fillText(fitText(ctx, lead(item.entry), textW), box.x + 6 * unit, lineY);
        lineY += lineH;
      }
      ctx.font = body(size, item.stacked ? 600 : 700);
      for (const line of item.lines) {
        ctx.fillText(line, box.x + 6 * unit, lineY);
        lineY += lineH;
      }
      y += h + step;
    }
    if (drawn < entries.length) {
      ctx.fillStyle = palette.cellInk;
      ctx.font = body(size, 700);
      ctx.fillText(fitText(ctx, data.words.more.replace("{count}", String(entries.length - drawn)), textW), box.x + 6 * unit, y + lineH * 0.85);
    }
  }
}
