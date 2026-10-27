import type { CalendarImagePalette } from "@/theme/brand";
import { FAR, MOUNTAIN_MARK_VIEWBOX, NEAR } from "@/shared/ui/MountainMark";
import { type Box, CALENDAR_IMAGE_RATIOS, type Ctx, drawGlyphs, eventGlyphs, fitText, glyphsWidth, roundRect, wrapText } from "./calendar-image-canvas";
import { drawFrame } from "./calendar-image-frame";
import type { CalendarImageAssets, CalendarImageFonts, CalendarImageOptions } from "./calendar-image-draw";
import { SPECIAL_PATH, TYPE_PATHS } from "./calendar-image-glyphs";
import { monthGrid } from "../domain/calendar";
import type { CalendarTone } from "../domain/calendar-kind";
import type { EventType } from "../domain/event-type";
import { type CalendarImageData, type CalendarImageEntry, LEGEND_MAX } from "../domain/calendar-image";

/**
 * «Afiș», «Așezare» → «Legenda în celule» (`cells`): a compact band, each weekly series' dates as chips in the
 * series' own colour, and the series' key drawn inside the empty days of the first or the last week.
 */

const clamp =(value: number, min: number, max: number) => Math.min(max, Math.max(min, value));

/**
 * `text` broken at spaces into lines no wider than `width` at the context's font, nothing cut: a word wider
 * than the line stands alone on its own line (the caller sees it is too wide). A lone dash stays with the
 * word before it, so no line starts with «—».
 */
export function breakLines(ctx: Ctx, text: string, width: number): string[] {
  const words: string[] = [];
  for (const word of text.split(" ").filter(Boolean)) {
    if (words.length > 0 && /^[—–-]$/.test(word)) words[words.length - 1] += ` ${word}`;
    else words.push(word);
  }
  const lines: string[] = [];
  let current = "";
  for (const word of words) {
    const candidate = current ? `${current} ${word}` : word;
    if (!current || ctx.measureText(candidate).width <= width) current = candidate;
    else {
      lines.push(current);
      current = word;
    }
  }
  if (current) lines.push(current);
  return lines;
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
 * - the band, one compact row: the club's real logo on the left, «EVENIMENTE» and «IUNIE 2026» on the right;
 * - the grid takes every pixel the band gave back. A weekly series' date is a chip in the series' own colour,
 *   its glyph and its hour — the series' name is said once, in the legend; a date that stands alone keeps its
 *   whole title, a little smaller or on more lines before anything is cut, on its pale pink or cream, with its
 *   hour; several dates on one day stack, each with its hour;
 * - the legend sits inside the grid, in the empty days before the 1st or after the last, as one panel over the
 *   mountains; that week grows a little when its legend needs it, and only when no run holds it does it take a
 *   strip under the grid. The specials' half lists only the titles a day had to cut — and, in a run nothing
 *   else uses (or under a story's tall grid), every special date, so a quiet month still says what is coming;
 * - «URMĂREȘTE-NE!» with the club's networks and its tags on the blue foot.
 */
export function drawPosterCells(ctx: CanvasRenderingContext2D, data: CalendarImageData, options: CalendarImageOptions, fonts: CalendarImageFonts, assets: CalendarImageAssets, palette: CalendarImagePalette): void {
  const { width: W, height: H } = CALENDAR_IMAGE_RATIOS[options.ratio];
  const u = Math.min(W, H) / 1080;
  /** The smallest words the poster draws: what a phone still reads in a feed. */
  const MIN = 14 * u;
  const gap = 16 * u;
  const story = options.ratio === "story";
  // One geometric family throughout: italic Black for the month, ExtraBold for the labels and the day
  // numbers, Bold for the titles and the chips, Medium for «EVENIMENTE», the hours and the notes.
  const face = (size: number, weight: number, italic = false) => `${italic ? "italic " : ""}${weight} ${Math.round(size * 2) / 2}px ${fonts.poster}`;
  const upper = (text: string) => text.toLocaleUpperCase("ro-RO");
  const toneOf = (tone: CalendarTone) => palette[tone];
  const measure = (text: string, font: string) => {
    ctx.font = font;
    return ctx.measureText(text).width;
  };
  // The page, the band and the foot are the frame's (`calendar-image-frame.ts`); what is left is the body's.
  const content = drawFrame(ctx, data, options, fonts, assets, palette);
  if (!content) return;

  // ── What the days say. A weekly series (one the legend names, up to its colours) is a chip; the rest
  // stand alone with their titles. A title that repeats is the poster's plain white day; the rest are marked.
  const weeks = monthGrid(data.month);
  const byDay = new Map<number, CalendarImageEntry[]>();
  for (const entry of data.entries) byDay.set(entry.day, [...(byDay.get(entry.day) ?? []), entry]);
  const sparse = byDay.size <= 5;
  const keyOf = (type: EventType, title: string) => `${type} ${title}`;
  const seriesColours = palette.series;
  const chipSeries = data.recurring.slice(0, Math.min(LEGEND_MAX, seriesColours.length));
  const seriesOf = new Map(chipSeries.map((row, index) => [keyOf(row.type, row.title), index]));
  const repeating = new Set(data.recurring.map((row) => keyOf(row.type, row.title)));
  const markOf = (entry: CalendarImageEntry): CalendarTone => (repeating.has(keyOf(entry.type, entry.title)) ? "weekly" : entry.tone === "weekly" ? "special" : entry.tone);
  const hourOf = (entry: CalendarImageEntry) => (entry.cancelled ? data.words.cancelled : entry.time ? data.words.at.replace("{time}", entry.time) : "");

  /** A series' date: its glyph and its hour («Anulat» when cancelled, nothing when not yet set). */
  type Chip = { series: number; text: string; glyphs: string[]; cancelled: boolean; special: boolean };
  const chipOf = (entry: CalendarImageEntry, series: number): Chip => ({
    series,
    text: entry.cancelled ? data.words.cancelled : (entry.time ?? ""),
    glyphs: eventGlyphs(entry.type, entry.surface, entry.special ? SPECIAL_PATH : TYPE_PATHS[entry.type]),
    cancelled: entry.cancelled,
    special: entry.special,
  });
  const chipText = (h: number) => Math.max(MIN, h * 0.5);
  const chipW = (chip: Chip, h: number) => h * 0.3 + glyphsWidth(chip.glyphs.length, h * 0.6) + (chip.text ? h * 0.18 + measure(chip.text, face(chipText(h), 700)) : 0) + h * 0.32;
  const drawChip = (chip: Chip, x: number, y: number, h: number) => {
    const [fill, ink] = seriesColours[chip.series];
    roundRect(ctx, x, y, chipW(chip, h), h, h / 2);
    // A cancelled date: the chip's outline only, «Anulat» in the series' colour.
    if (chip.cancelled) {
      ctx.fillStyle = palette.cell;
      ctx.fill();
      ctx.strokeStyle = fill;
      ctx.lineWidth = 2 * u;
      ctx.stroke();
    } else {
      ctx.fillStyle = fill;
      ctx.fill();
    }
    const color = chip.cancelled ? fill : ink;
    const g = h * 0.6;
    const glyphW = drawGlyphs(ctx, chip.glyphs, x + h * 0.3, y + (h - g) / 2, g, color);
    if (!chip.text) return;
    ctx.font = face(chipText(h), 700);
    ctx.fillStyle = color;
    ctx.textAlign = "left";
    ctx.fillText(chip.text, x + h * 0.3 + glyphW + h * 0.18, y + h / 2 + chipText(h) * 0.36);
  };

  /** A date that stands alone: its title in capitals, its hour line. */
  type Titled = { entry: CalendarImageEntry; tone: CalendarTone; title: string; hour: string };
  type Placed =
    | { kind: "chip"; chip: Chip; h: number }
    | { kind: "titled"; item: Titled; lines: string[]; size: number; glyph: number; inline: boolean; h: number };
  type TitledPlan = Omit<Extract<Placed, { kind: "titled" }>, "kind" | "item">;
  type DayPlan = {
    p: number;
    number: number;
    headH: number;
    head: Chip[];
    headChipH: number;
    areaTop: number;
    areaH: number;
    /** Between the dates stacked in the day. */
    gap: number;
    /** Inside a date's own card, when the day has several. */
    cardPad: number;
    card: boolean;
    placed: Placed[];
    more: number;
    tint: CalendarTone | null;
    cut: CalendarImageEntry[];
  };
  const linesAt = (title: string, size: number, width: number) => {
    ctx.font = face(size, 700);
    const lines = breakLines(ctx, title, width);
    return lines.every((line) => ctx.measureText(line).width <= width + 0.5) ? lines : null;
  };
  const hourSize = (size: number) => Math.max(MIN, size * 0.86);
  const lineStep = (size: number) => size * 1.14;

  /**
   * A day's dates in its cell `cw`×`ch`: the chips beside the number when titles share the day; each title
   * whole at the largest size that lets every title on the day be whole (four lines, six in a story's tall
   * cell); only when none does, the titles cut with «…», still each with its hour — over it, or leading the
   * line when that leaves the title more — and at the very last, one line each and «+2 altele».
   */
  const planDay = (day: number, entries: CalendarImageEntry[], cw: number, ch: number, ordinary: number): DayPlan => {
    const p = clamp(cw * 0.055, 6 * u, 12 * u);
    // The numbers and the chips are sized by the ordinary week, so a week grown for the legend matches the rest.
    const number = clamp(Math.min(cw, ordinary) * (sparse ? 0.25 : 0.2), 18 * u, 46 * u);
    const innerW = cw - 2 * p;
    const chips: Chip[] = [];
    const titled: Titled[] = [];
    const order: (Chip | Titled)[] = [];
    for (const entry of entries) {
      const series = seriesOf.get(keyOf(entry.type, entry.title));
      const item = series === undefined ? { entry, tone: markOf(entry), title: upper(entry.title), hour: hourOf(entry) } : chipOf(entry, series);
      if ("series" in item) chips.push(item);
      else titled.push(item);
      order.push(item);
    }
    const card = titled.length > 1;
    const textW = innerW - (card ? 10 * u : 0);
    // A tall cell (a story's) holds a title on more, larger lines.
    const maxLines = ch >= 1.6 * cw ? 6 : 4;
    const tint: CalendarTone | null =
      titled.length === 1 ? (titled[0].tone === "weekly" ? null : titled[0].tone) : titled.length === 0 && chips.some((chip) => chip.special) ? "special" : null;
    // The chips' height in the day's room, and beside its number.
    let areaChip = clamp(Math.min(cw * 0.28, ordinary * 0.28), 28 * u, 42 * u);
    if (titled.length > 0) areaChip = Math.min(areaChip, 34 * u);
    while (areaChip > 28 * u && chips.some((chip) => chipW(chip, areaChip) > innerW)) areaChip -= u;
    const headChipH = clamp(number * 1.05, 26 * u, 38 * u);
    const numberW = measure(String(day), face(number, 800));
    // As many chips as fit beside the number go there whenever titles share the day — every such day alike —
    // or when the day's room cannot stack them all; the rest stack in the room.
    let fitHead = 0;
    for (let width = numberW + 6 * u; fitHead < chips.length; fitHead += 1) {
      width += chipW(chips[fitHead], headChipH) + (fitHead > 0 ? 4 * u : 0);
      if (width > innerW) break;
    }
    const stackRoom = ch - (p * 0.75 + number * 0.74 + p * 0.6) - p;
    const headCount = titled.length > 0 || chips.length * areaChip + (chips.length - 1) * 6 * u > stackRoom ? fitHead : 0;
    const head = chips.slice(0, headCount);
    const inHead = headCount > 0;
    const headH = Math.max(number * 0.74, inHead ? headChipH : 0);
    const areaTop = p * 0.75 + headH + p * 0.6;
    const areaH = ch - areaTop - p;
    const shownChips = chips.length - headCount;
    const chipsH = shownChips * areaChip;
    const build = (plans: Map<Titled, TitledPlan>, more: number, gap: number, cardPad: number): DayPlan => {
      const placed: Placed[] = [];
      for (const item of order) {
        if ("series" in item) {
          if (!head.includes(item)) placed.push({ kind: "chip", chip: item, h: areaChip });
        } else {
          const plan = plans.get(item);
          if (plan) placed.push({ kind: "titled", item, ...plan });
        }
      }
      const cut = titled.filter((item) => {
        const plan = plans.get(item);
        return !plan || plan.inline || plan.lines.join(" ") !== item.title.split(" ").filter(Boolean).join(" ");
      });
      return { p, number, headH, head, headChipH, areaTop, areaH, gap, cardPad, card, placed, more, tint, cut: cut.map((item) => item.entry) };
    };

    // Every title whole, at the largest size that holds them all.
    {
      const gap = 6 * u;
      const cardPad = card ? 5 * u : 0;
      const blockH = (item: Titled, lines: number, size: number) => lines * lineStep(size) + (item.hour ? hourSize(size) * 1.3 : 0) + 2 * cardPad;
      const room = areaH - chipsH - Math.max(0, shownChips + titled.length - 1) * gap;
      const sMax = sparse ? Math.min(textW * 0.18, 30 * u) : Math.min(textW * 0.15, 21 * u);
      for (let size = sMax; room >= 0 && size >= MIN - 0.01; size -= 0.5 * u) {
        const lines = titled.map((item) => linesAt(item.title, size, textW));
        if (lines.some((each) => !each || each.length > maxLines)) continue;
        const whole = lines as string[][];
        const total = titled.reduce((sum, item, index) => sum + blockH(item, whole[index].length, size), 0);
        if (total > room) continue;
        // A lone title with room to spare wears its glyph over it, as the poster draws them.
        const glyphSize = titled.length === 1 ? Math.min(clamp(size * 1.9, 22 * u, 52 * u), room - total - 4 * u) : 0;
        const glyph = glyphSize >= 22 * u ? glyphSize : 0;
        const plans = new Map<Titled, TitledPlan>(
          titled.map((item, index) => [item, { lines: whole[index], size, glyph, inline: false, h: blockH(item, whole[index].length, size) + (glyph ? glyph + 4 * u : 0) }]),
        );
        return build(plans, 0, gap, cardPad);
      }
    }

    // The titles cut, at the smallest size, two ways: each title over its hour line (the poster's own), or the
    // hour leading the title's first line. Each title gets one line, then more go round to whichever is cut.
    const gap = 4 * u;
    const cardPad = card ? 3 * u : 0;
    const room = areaH - chipsH - Math.max(0, shownChips + titled.length - 1) * gap;
    const leadOf = (item: Titled) => (item.entry.cancelled ? data.words.cancelled : (item.entry.time ?? ""));
    const textOf = (item: Titled, inline: boolean) => (inline && leadOf(item) ? `${leadOf(item)} ${item.title}` : item.title);
    const heightOf = (item: Titled, lines: number, inline: boolean) => lines * lineStep(MIN) + (!inline && item.hour ? hourSize(MIN) * 1.15 : 0) + 2 * cardPad;
    const share = (inline: boolean) => {
      ctx.font = face(MIN, 700);
      const need = titled.map((item) => Math.min(maxLines, breakLines(ctx, textOf(item, inline), textW).length));
      const counts = titled.map(() => 1);
      const total = () => titled.reduce((sum, item, index) => sum + heightOf(item, counts[index], inline), 0);
      if (total() > room) return null;
      for (let grew = true; grew; ) {
        grew = false;
        titled.forEach((_, index) => {
          if (counts[index] >= need[index]) return;
          counts[index] += 1;
          if (total() <= room) grew = true;
          else counts[index] -= 1;
        });
      }
      return counts;
    };
    const stacked = share(false);
    const inlined = share(true);
    // Over its hour while every title keeps two lines at least; else the hour leads, which leaves the title more.
    const inline = !(stacked && (stacked.every((count) => count >= 2) || !inlined));
    const counts = inline ? inlined : stacked;
    if (counts) {
      ctx.font = face(MIN, 700);
      const plans = new Map<Titled, TitledPlan>(
        titled.map((item, index) => [item, { lines: wrapText(ctx, textOf(item, inline), textW, counts[index]), size: MIN, glyph: 0, inline, h: heightOf(item, counts[index], inline) }]),
      );
      return build(plans, 0, gap, cardPad);
    }
    // At the very last: «18:00 GIRLS ONLY…», one line each, as many as fit, then «+2 altele».
    const fitsInline = (count: number) => {
      const lines = count + (count < titled.length ? 1 : 0);
      return chipsH + count * heightOf(titled[0], 1, true) + (lines - count) * MIN * 1.2 + Math.max(0, shownChips + lines - 1) * gap <= areaH;
    };
    let shown = titled.length;
    while (shown > 0 && !fitsInline(shown)) shown -= 1;
    ctx.font = face(MIN, 700);
    const plans = new Map<Titled, TitledPlan>(
      titled.slice(0, shown).map((item) => [item, { lines: [fitText(ctx, textOf(item, true), textW)], size: MIN, glyph: 0, inline: true, h: heightOf(item, 1, true) }]),
    );
    return build(plans, titled.length - shown, gap, cardPad);
  };

  /** Draws a day's plan in its cell. */
  const drawDay = (plan: DayPlan, day: number, x: number, y: number, cw: number, ch: number) => {
    if (plan.tint) {
      ctx.fillStyle = toneOf(plan.tint)[0];
      ctx.fillRect(x, y, cw, ch);
    }
    const empty = plan.placed.length === 0 && plan.head.length === 0 && plan.more === 0;
    ctx.fillStyle = palette.cellInk;
    ctx.globalAlpha = empty ? 0.42 : 1;
    ctx.font = face(plan.number, 800);
    ctx.textAlign = "left";
    const headTop = y + plan.p * 0.75;
    ctx.fillText(String(day), x + plan.p, headTop + (plan.headH + plan.number * 0.72) / 2);
    ctx.globalAlpha = 1;
    // The chips beside the number, right-aligned.
    let chipX = x + cw - plan.p;
    for (const chip of [...plan.head].reverse()) {
      chipX -= chipW(chip, plan.headChipH);
      drawChip(chip, chipX, headTop + (plan.headH - plan.headChipH) / 2, plan.headChipH);
      chipX -= 4 * u;
    }
    if (plan.placed.length === 0 && plan.more === 0) return;
    const innerW = cw - 2 * plan.p;
    const moreH = plan.more ? MIN * 1.2 : 0;
    const total = plan.placed.reduce((sum, item) => sum + item.h, 0) + Math.max(0, plan.placed.length - 1) * plan.gap + (moreH ? plan.gap + moreH : 0);
    let cy = y + plan.areaTop + Math.max(0, (plan.areaH - total) / 2);
    const cx = x + cw / 2;
    for (const item of plan.placed) {
      if (item.kind === "chip") {
        drawChip(item.chip, cx - chipW(item.chip, item.h) / 2, cy, item.h);
        cy += item.h + plan.gap;
        continue;
      }
      const [fill, ink] = toneOf(item.item.tone);
      if (plan.card) {
        roundRect(ctx, x + plan.p, cy, innerW, item.h, 8 * u);
        ctx.fillStyle = fill;
        ctx.fill();
      }
      let ly = cy + plan.cardPad;
      if (item.glyph) {
        const { entry } = item.item;
        const glyphs = eventGlyphs(entry.type, entry.surface, entry.special ? SPECIAL_PATH : TYPE_PATHS[entry.type]);
        drawGlyphs(ctx, glyphs, cx - glyphsWidth(glyphs.length, item.glyph) / 2, ly, item.glyph, ink);
        ly += item.glyph + 4 * u;
      }
      ctx.font = face(item.size, 700);
      const lead = item.inline ? (item.item.entry.cancelled ? data.words.cancelled : (item.item.entry.time ?? "")) : "";
      item.lines.forEach((line, index) => {
        const baseline = ly + item.size * 0.88;
        ly += lineStep(item.size);
        // The hour leading the first line in the hour's colour, the title after it in the cell's ink.
        if (index === 0 && lead && line.startsWith(`${lead} `)) {
          const left = cx - ctx.measureText(line).width / 2;
          ctx.textAlign = "left";
          ctx.fillStyle = item.item.entry.cancelled ? palette.special[1] : palette.title;
          ctx.fillText(lead, left, baseline);
          ctx.fillStyle = palette.cellInk;
          ctx.fillText(line.slice(lead.length + 1), left + ctx.measureText(`${lead} `).width, baseline);
          return;
        }
        ctx.textAlign = "center";
        ctx.fillStyle = palette.cellInk;
        ctx.fillText(line, cx, baseline);
      });
      if (!item.inline && item.item.hour) {
        const size = hourSize(item.size);
        ctx.textAlign = "center";
        ctx.font = face(size, item.item.entry.cancelled ? 800 : 500);
        ctx.fillStyle = item.item.entry.cancelled ? palette.special[1] : palette.title;
        ctx.fillText(fitText(ctx, item.item.hour, innerW), cx, ly + size * 1.02);
      }
      ctx.textAlign = "left";
      cy += item.h + plan.gap;
    }
    if (plan.more) {
      ctx.textAlign = "center";
      ctx.fillStyle = palette.title;
      ctx.font = face(MIN, 700);
      ctx.fillText(fitText(ctx, data.words.more.replace("{count}", String(plan.more)), innerW), cx, cy + MIN);
      ctx.textAlign = "left";
    }
  };

  // ── The legend: what repeats (each series' chip, its name, its rhythm), then what stands alone.
  type LegendRow = { chip?: Chip; day?: number; name: string; note: string; tone: CalendarTone | null };
  type Section = { kind: "recurring" | "special"; title: string; fill: string; rows: LegendRow[] };
  const recurring: Section | null =
    options.legend && chipSeries.length > 0
      ? {
          kind: "recurring",
          title: data.words.recurringTitle,
          fill: palette.band,
          rows: chipSeries.map((row, index) => {
            const members = data.entries.filter((entry) => keyOf(entry.type, entry.title) === keyOf(row.type, row.title));
            const time = members.find((entry) => !entry.cancelled && entry.time)?.time ?? "";
            return { chip: { series: index, text: time, glyphs: eventGlyphs(row.type, row.surface), cancelled: false, special: false }, name: upper(row.title), note: row.sentence, tone: null };
          }),
        }
      : null;
  const specialSection = (rows: CalendarImageData["specials"]): Section => ({
    kind: "special",
    title: data.words.specialTitle,
    fill: palette.special[1],
    rows: rows.map((row) => {
      const entry = data.entries.find((each) => each.day === row.day && each.title === row.title);
      return { day: row.day, name: upper(row.title), note: entry ? hourOf(entry) : "", tone: entry ? markOf(entry) : row.tone === "weekly" ? "special" : row.tone };
    }),
  });

  /**
   * How a legend is set: its pills over their rows or (one section alone) beside them; each row its name
   * over its note, or both on one line where the column is wide.
   */
  type LegendStyle = { side: boolean; line: boolean };
  type LegendItem = { kind: "head"; section: Section; h: number } | { kind: "row"; row: LegendRow; lines: string[]; leadW: number; h: number };
  type LegendFit = { sections: Section[]; size: number; style: LegendStyle; colW: number; pillW: number; columns: LegendItem[][]; height: number };
  const columnGap = 20 * u;
  /** The room around a legend: in a run of empty days, and in the strip under the grid. */
  const runPad = 8 * u;
  const stripPad = 12 * u;
  const legendNote = (size: number) => Math.max(MIN, size * 0.86);
  const legendChip = (size: number) => Math.max(28 * u, size * 1.6);
  const badge = (size: number) => size * 2.1;
  const pillH = (size: number) => size * 1.65;
  const pillFont = (size: number) => Math.max(MIN, size * 0.9);
  const pillW = (section: Section, size: number) => measure(upper(section.title), face(pillFont(size), 800)) + size * 1.3;
  const rowInset = (row: LegendRow, size: number) => (row.tone ? size * 0.3 : 0);
  const rowGap = (size: number) => size * 0.3;
  /** The legend's pieces at `size` in a column `colW` wide; null when a name would need a fourth line or a word does not fit. */
  const legendItems = (sections: Section[], colW: number, size: number, style: LegendStyle): LegendItem[] | null => {
    const items: LegendItem[] = [];
    for (const section of sections) {
      if (!style.side) items.push({ kind: "head", section, h: pillH(size) + size * 0.45 });
      const leadW = Math.max(...section.rows.map((row) => (row.chip ? chipW(row.chip, legendChip(size)) : badge(size))));
      for (const row of section.rows) {
        const inset = rowInset(row, size);
        const textW = colW - 2 * inset - leadW - size * 0.55;
        if (textW < 80 * u) return null;
        const leadH = row.chip ? legendChip(size) : badge(size);
        if (style.line) {
          const nameW = measure(row.name, face(size, 700));
          const noteW = row.note ? size * 0.7 + measure(row.note, face(legendNote(size), 500)) : 0;
          if (nameW + noteW > textW) return null;
          items.push({ kind: "row", row, lines: [row.name], leadW, h: Math.max(leadH, size * 1.3) + 2 * inset + rowGap(size) });
          continue;
        }
        const lines = linesAt(row.name, size, textW);
        if (!lines || lines.length > 3) return null;
        if (row.note && measure(row.note, face(legendNote(size), 500)) > textW) return null;
        const textH = lines.length * size * 1.16 + (row.note ? legendNote(size) * 1.25 : 0);
        items.push({ kind: "row", row, lines, leadW, h: Math.max(leadH, textH) + 2 * inset + rowGap(size) });
      }
    }
    return items;
  };
  /** The pieces poured into at most `count` columns of about equal height; a pill never ends a column. */
  const pour = (items: LegendItem[], count: number) => {
    const fill = (limit: number) => {
      const columns: LegendItem[][] = [[]];
      let height = 0;
      // A pill and the row under it go into a column together.
      for (let index = 0; index < items.length; index += 1) {
        const group = items[index].kind === "head" && items[index + 1] ? [items[index], items[index + 1]] : [items[index]];
        const need = group.reduce((sum, item) => sum + item.h, 0);
        if (height + need > limit + 0.01 && columns[columns.length - 1].length > 0) {
          columns.push([]);
          height = 0;
        }
        columns[columns.length - 1].push(...group);
        height += need;
        index += group.length - 1;
      }
      return columns;
    };
    let low = Math.max(...items.map((item) => item.h));
    let high = items.reduce((sum, item) => sum + item.h, 0);
    for (let step = 0; step < 24; step += 1) {
      const middle = (low + high) / 2;
      if (fill(middle).length <= count) high = middle;
      else low = middle;
    }
    const columns = fill(high);
    return { columns, height: Math.max(...columns.map((column) => column.reduce((sum, item) => sum + item.h, 0))) };
  };
  /** Every way `sections` can be set across `w` at `size`, each with its height. */
  const legendWays = (sections: Section[], w: number, size: number): LegendFit[] => {
    const ways: LegendFit[] = [];
    for (const side of sections.length === 1 ? [false, true] : [false]) {
      const pill = side ? pillW(sections[0], size) + size * 0.7 : 0;
      for (const line of [false, true]) {
        for (let count = 1; count <= 3; count += 1) {
          const colW = (w - pill - (count - 1) * columnGap) / count;
          if (count > 1 && colW < 260 * u) break;
          const items = legendItems(sections, colW, size, { side, line });
          if (!items) continue;
          const poured = pour(items, count);
          // The last row's gap is not the legend's height.
          const height = Math.max(poured.height - rowGap(size), side ? pillH(size) : 0);
          ways.push({ sections, size, style: { side, line }, colW, pillW: pill, columns: poured.columns, height });
        }
      }
    }
    return ways;
  };
  /** The largest size, then the lowest setting, at which `sections` fit `box` whole; null when none does at the smallest size. */
  const fitLegend = (sections: Section[], box: Box, maxSize: number, padding: number): LegendFit | null => {
    for (let size = maxSize; size >= MIN - 0.01; size -= 0.5 * u) {
      const ways = legendWays(sections, box.w - 2 * padding, size).filter((way) => way.height <= box.h - 2 * padding);
      if (ways.length > 0) return ways.reduce((best, way) => (way.height < best.height - 0.5 ? way : best));
    }
    return null;
  };
  const drawPill = (section: Section, x: number, y: number, size: number, maxW: number) => {
    ctx.font = face(pillFont(size), 800);
    const label = fitText(ctx, upper(section.title), maxW - size * 1.3);
    roundRect(ctx, x, y, ctx.measureText(label).width + size * 1.3, pillH(size), pillH(size) / 2);
    ctx.fillStyle = section.fill;
    ctx.fill();
    ctx.fillStyle = palette.bandInk;
    ctx.fillText(label, x + size * 0.65, y + pillH(size) / 2 + pillFont(size) * 0.36);
  };
  const drawLegend = (box: Box, fit: LegendFit, padding: number) => {
    const { size, style } = fit;
    const top = box.y + padding + Math.max(0, (box.h - 2 * padding - fit.height) / 2);
    let x = box.x + padding;
    if (style.side) {
      drawPill(fit.sections[0], x, top, size, fit.pillW);
      x += fit.pillW;
    }
    for (const column of fit.columns) {
      let y = top;
      for (const item of column) {
        if (item.kind === "head") {
          drawPill(item.section, x, y, size, fit.colW);
          y += item.h;
          continue;
        }
        const { row } = item;
        const inset = rowInset(row, size);
        const rowH = item.h - rowGap(size);
        if (row.tone) {
          roundRect(ctx, x, y, fit.colW, rowH, 10 * u);
          ctx.fillStyle = toneOf(row.tone)[0];
          ctx.fill();
        }
        const mid = y + rowH / 2;
        if (row.chip) {
          drawChip(row.chip, x + inset, mid - legendChip(size) / 2, legendChip(size));
        } else if (row.day !== undefined) {
          const side = badge(size);
          roundRect(ctx, x + inset, mid - side / 2, side, side, 9 * u);
          ctx.fillStyle = palette.cell;
          ctx.fill();
          ctx.fillStyle = palette.cellInk;
          ctx.font = face(size * 1.05, 800);
          ctx.textAlign = "center";
          ctx.fillText(String(row.day), x + inset + side / 2, mid + size * 0.38);
          ctx.textAlign = "left";
        }
        const textX = x + inset + item.leadW + size * 0.55;
        ctx.fillStyle = palette.cellInk;
        ctx.font = face(size, 700);
        if (style.line) {
          ctx.fillText(row.name, textX, mid + size * 0.36);
          if (row.note) {
            const noteX = textX + ctx.measureText(row.name).width + size * 0.7;
            ctx.font = face(legendNote(size), 500);
            ctx.fillStyle = palette.title;
            ctx.fillText(row.note, noteX, mid + size * 0.36);
          }
        } else {
          const textH = item.lines.length * size * 1.16 + (row.note ? legendNote(size) * 1.25 : 0);
          let ty = mid - textH / 2;
          for (const line of item.lines) {
            ctx.fillText(line, textX, ty + size * 0.88);
            ty += size * 1.16;
          }
          if (row.note) {
            ctx.font = face(legendNote(size), 500);
            ctx.fillStyle = palette.title;
            ctx.fillText(row.note, textX, ty + legendNote(size) * 0.98);
          }
        }
        y += item.h;
      }
      x += fit.colW + columnGap;
    }
  };

  // ── Where everything goes. The legend goes inside the grid, into the runs of empty days before the 1st and
  // after the last; a week whose run holds more than its share of height grows to hold it, and the other
  // weeks share what is left. Only what no run can hold takes a strip under the grid.
  const cellW = content.w / 7;
  const headH = clamp(cellW * 0.26, 34 * u, 44 * u);
  const leadCount = weeks[0].findIndex((day) => day.inMonth);
  const lastWeek = weeks[weeks.length - 1];
  let trailCount = 0;
  while (trailCount < 7 && !lastWeek[6 - trailCount].inMonth) trailCount += 1;
  type Run = { row: number; first: number; count: number };
  const runs: Run[] = [];
  if (leadCount > 0) runs.push({ row: 0, first: 0, count: leadCount });
  if (trailCount > 0) runs.push({ row: weeks.length - 1, first: 7 - trailCount, count: trailCount });
  const legendRuns = runs.filter((run) => run.count >= 2);
  const panelOf = (run: Run, top: number, height: number): Box => ({ x: content.x + run.first * cellW + 4 * u, y: top + 4 * u, w: run.count * cellW - 8 * u, h: height - 8 * u });
  const runMax = (story ? 26 : 24) * u;
  /** The size a run's legend is set at when its week has to grow for it. */
  const runSize = (story ? 17 : 15) * u;
  const stripSize = (story ? 18 : 16) * u;
  /** The lowest setting of `sections` across `w` at `size`. */
  const lowestAt = (sections: Section[], w: number, size: number): LegendFit | null => {
    const ways = legendWays(sections, w, size);
    return ways.length > 0 ? ways.reduce((best, way) => (way.height < best.height - 0.5 ? way : best)) : null;
  };
  /** The strip: its largest size from `largest` down while it stays within a fifth of the room. */
  const stripFor = (sections: Section[], largest = stripSize): LegendFit | null => {
    for (let size = largest; size > MIN + 0.01; size -= 0.5 * u) {
      const fit = lowestAt(sections, content.w - 2 * stripPad, size);
      if (fit && fit.height + 2 * stripPad <= content.h * 0.2) return fit;
    }
    return lowestAt(sections, content.w - 2 * stripPad, MIN);
  };

  type Arranged = { rows: number[]; strip: LegendFit | null; stripH: number; inRuns: { run: Run; sections: Section[] }[]; base: number; inStrip: number; size: number };
  /**
   * Every way of putting each section in a run or in the strip; for each, the weeks' heights. The best keeps
   * the ordinary weeks tallest, then leaves the least for the strip.
   */
  const arrange = (sections: Section[], forced: Section[] = []): Arranged => {
    const choices = [...legendRuns.keys(), -1];
    const combos = sections.reduce<number[][]>((all) => all.flatMap((combo) => choices.map((choice) => [...combo, choice])), [[]]);
    let best: Arranged | null = null;
    for (const combo of combos) {
      const stripSections = [...sections.filter((_, at) => combo[at] === -1), ...forced];
      // The month's highlights alone under a story's grid are set as large as a run's legend.
      const strip = stripSections.length > 0 ? stripFor(stripSections, stripSections.length === forced.length ? runMax : stripSize) : null;
      if (stripSections.length > 0 && !strip) continue;
      const stripH = strip ? strip.height + 2 * stripPad + gap : 0;
      const room = content.h - headH - stripH;
      const inRuns = legendRuns.map((run, index) => ({ run, sections: sections.filter((_, at) => combo[at] === index) })).filter((each) => each.sections.length > 0);
      const need = inRuns.map((each) => {
        const fit = lowestAt(each.sections, each.run.count * cellW - 8 * u - 2 * runPad, runSize);
        return fit ? fit.height + 2 * runPad + 8 * u : Infinity;
      });
      let base = room / weeks.length;
      for (let step = 0; step < 4; step += 1) {
        const grown = need.filter((height) => height > base);
        const next = (room - grown.reduce((sum, height) => sum + height, 0)) / (weeks.length - grown.length);
        if (Math.abs(next - base) < 0.5) break;
        base = next;
      }
      // A week may grow to about twice the others, never more: past that the strip reads better.
      if (need.some((height) => height > Math.max(base, 0) * 2.2) || base < 48 * u) continue;
      const rows = weeks.map(() => base);
      inRuns.forEach((each, index) => {
        if (need[index] > base) rows[each.run.row] = need[index];
      });
      // How large the runs' legends read at their weeks' heights: between equals, the larger.
      const size = Math.min(runMax, ...inRuns.map((each) => fitLegend(each.sections, panelOf(each.run, 0, rows[each.run.row]), runMax, runPad)?.size ?? 0));
      const candidate = { rows, strip, stripH, inRuns, base, inStrip: stripSections.length, size };
      const better =
        !best ||
        base > best.base + 0.5 ||
        (Math.abs(base - best.base) <= 0.5 && (candidate.inStrip < best.inStrip || (candidate.inStrip === best.inStrip && size > best.size + 0.25)));
      if (better) best = candidate;
    }
    if (best) return best;
    // Nothing held it: everything in the strip.
    const all = [...sections, ...forced];
    const fit = all.length > 0 ? stripFor(all) : null;
    const stripH = fit ? fit.height + 2 * stripPad + gap : 0;
    const base = (content.h - headH - stripH) / weeks.length;
    return { rows: weeks.map(() => base), strip: fit, stripH, inRuns: [], base, inStrip: all.length, size: 0 };
  };

  const planAll = (rows: number[]) => {
    const plans = new Map<number, DayPlan>();
    const ordinary = Math.min(...rows);
    weeks.forEach((week, row) => {
      for (const day of week) if (day.inMonth) plans.set(day.day, planDay(day.day, byDay.get(day.day) ?? [], cellW, rows[row], ordinary));
    });
    return plans;
  };
  // The specials' legend lists the titles a day had to cut, which depends on the weeks' heights, which depend
  // on the legend: laid out again until no more are cut. The list only grows, so this ends.
  const specialKey = (day: number, title: string) => `${day} ${title}`;
  let listed = new Set<string>();
  let arranged = arrange(recurring ? [recurring] : []);
  let plans = planAll(arranged.rows);
  let special: Section | null = null;
  for (let round = 0; round <= data.specials.length; round += 1) {
    const cut = data.specials.filter((row) => plans.get(row.day)?.cut.some((entry) => entry.title === row.title)).map((row) => specialKey(row.day, row.title));
    const grown = new Set([...listed, ...cut]);
    if (grown.size === listed.size && round > 0) break;
    listed = grown;
    const rows = data.specials.filter((row) => listed.has(specialKey(row.day, row.title))).slice(0, LEGEND_MAX + 2);
    special = options.legend && rows.length > 0 ? specialSection(rows) : null;
    arranged = arrange([recurring, special].filter((section): section is Section => section !== null));
    plans = planAll(arranged.rows);
  }
  // A run nothing else uses, in a month whose special dates are all whole in their days: those dates again,
  // larger. Without such a run, on a picture whose weeks would stand far taller than wide (a story's), they go
  // under the grid instead, and the weeks give up the height.
  const sections = [recurring, special].filter((section): section is Section => section !== null);
  const highlights = options.legend && !special && data.specials.length > 0 ? specialSection(data.specials.slice(0, LEGEND_MAX)) : null;
  const usedRuns = new Set(arranged.inRuns.map((each) => each.run));
  const free = legendRuns.find((run) => !usedRuns.has(run));
  let highlightRun: { run: Run; fit: LegendFit } | null = null;
  if (highlights && free) {
    const fit = fitLegend([highlights], panelOf(free, 0, arranged.rows[free.row]), runMax, runPad);
    if (fit && fit.size >= 16 * u) highlightRun = { run: free, fit };
  }
  if (highlights && !highlightRun && arranged.base > 1.5 * cellW) {
    const again = arrange(sections, [highlights]);
    if (again.base >= 1.2 * cellW) {
      arranged = again;
      plans = planAll(arranged.rows);
    }
  }
  const { rows, strip, stripH } = arranged;
  const rowTop = rows.map((_, row) => content.y + headH + rows.slice(0, row).reduce((sum, height) => sum + height, 0));
  const grid: Box = { x: content.x, y: content.y, w: content.w, h: headH + rows.reduce((sum, height) => sum + height, 0) };
  const inRuns: { run: Run; panel: Box; fit: LegendFit }[] = [];
  for (const each of arranged.inRuns) {
    const panel = panelOf(each.run, rowTop[each.run.row], rows[each.run.row]);
    const fit = fitLegend(each.sections, panel, runMax, runPad);
    if (fit) inRuns.push({ run: each.run, panel, fit });
  }
  if (highlightRun) {
    const panel = panelOf(highlightRun.run, rowTop[highlightRun.run.row], rows[highlightRun.run.row]);
    inRuns.push({ run: highlightRun.run, panel, fit: highlightRun.fit });
  }

  // ── The grid: the weekdays in full on a pale blue row, then the weeks, Monday first.
  roundRect(ctx, grid.x, grid.y, grid.w, grid.h, 18 * u);
  ctx.fillStyle = palette.cell;
  ctx.fill();
  ctx.save();
  ctx.clip();
  ctx.fillStyle = palette.cellMuted;
  ctx.fillRect(grid.x, grid.y, grid.w, headH);
  const weekdaySize = clamp(cellW * 0.13, MIN, 21 * u);
  ctx.textAlign = "center";
  ctx.font = face(weekdaySize, 800);
  ctx.fillStyle = palette.title;
  data.words.weekdaysLong.forEach((name, index) => {
    ctx.fillText(fitText(ctx, upper(name), cellW - 8 * u), grid.x + index * cellW + cellW / 2, grid.y + headH / 2 + weekdaySize * 0.36);
  });
  ctx.textAlign = "left";

  // The runs of empty days: the mountains, quiet behind a legend panel, as the poster draws them otherwise.
  for (const run of runs) {
    const used = inRuns.find((each) => each.run === run);
    if (used) {
      roundRect(ctx, used.panel.x, used.panel.y, used.panel.w, used.panel.h, 14 * u);
      ctx.fillStyle = palette.cellMuted;
      ctx.fill();
      ctx.save();
      ctx.clip();
      drawRidge(ctx, used.panel, palette.line, 0.35, 0.6);
      ctx.restore();
      drawLegend(used.panel, used.fit, runPad);
    } else {
      drawRidge(ctx, { x: content.x + run.first * cellW, y: rowTop[run.row], w: run.count * cellW, h: rows[run.row] }, palette.line, 0.6, 0.9);
    }
  }
  weeks.forEach((week, row) => {
    week.forEach((day, column) => {
      const plan = day.inMonth ? plans.get(day.day) : undefined;
      if (plan) drawDay(plan, day.day, grid.x + column * cellW, rowTop[row], cellW, rows[row]);
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

  // The strip, when no run could hold the legend.
  if (strip) {
    const box = { x: content.x, y: content.y + content.h - (stripH - gap), w: content.w, h: stripH - gap };
    roundRect(ctx, box.x, box.y, box.w, box.h, 18 * u);
    ctx.fillStyle = palette.cellMuted;
    ctx.fill();
    drawLegend(box, strip, stripPad);
  }
}
