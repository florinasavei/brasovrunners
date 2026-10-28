import type { CalendarImagePalette } from "@/theme/brand";
import { FAR, MOUNTAIN_MARK_VIEWBOX, NEAR } from "@/shared/ui/MountainMark";
import { SOCIAL_MARKS } from "@/shared/ui/SocialIcon";
import { type Box, CALENDAR_IMAGE_RATIOS, type CalendarImageRatio, fillSpaced, fitText, LOGO_RATIO, roundRect } from "./calendar-image-canvas";
import type { CalendarImageAssets, CalendarImageFonts, CalendarImageOptions } from "./calendar-image-draw";
import type { CalendarImageData } from "../domain/calendar-image";

/**
 * The frame every picture of «Salvează ca imagine» (§855) is drawn in — the page, the band, the foot and the
 * room between them — once, for the three layouts of «Afiș» and the week, which each drew their own before
 * and drifted apart: three band heights, two compositions, and a story whose band and foot sat under
 * Instagram's own bars. One set of sizes per format, derived from the picture alone, so «Luna» and
 * «Săptămâna», and every «Așezare», share the frame to the pixel.
 *
 * - The band: the club's real logo at the left (or, until it loads, the mountains over the spaced club name),
 *   and at the right «EVENIMENTE» in spaced capitals over the period in italic Black — the month, «IUNIE 2026»,
 *   or the week's range, «1–7 IUNIE 2026» — its year lighter. Its height follows the month word's size, and
 *   the logo stands as tall as the band allows, so the band is never mostly empty.
 * - The foot: «URMĂREȘTE-NE!», each network's mark once, then the club's tags. The club's name is in the logo
 *   and in its tag; the foot does not say it four times more.
 * - The zone a network covers: on a 9:16 story Instagram's bars take the top 250 and the bottom 340 pixels.
 *   There the band's fill runs to the top edge and the foot's to the bottom one, square at the edge, and the
 *   words keep out of the covered zone — a story seen outside Instagram reads as a tall blue header and
 *   footer, not a letterboxed picture. On 4:5, 1:1 and 16:9 the band and the foot are rounded, inside the
 *   margin: a 4:5 post is drawn exactly as the square is, because the profile grid's 3:4 tile loses width,
 *   not height — it keeps every row of the picture and trims about 34 px at each side, the margin and a hair
 *   of the band's edge, never a word (the audit's D20 said the tile cut 67 rows at each end; two verifiers
 *   refuted it against the pixels).
 * - An empty period (the owner's audit, D18: «an empty month is drawn as a bare ruled grid and nothing says
 *   there are no events»): the frame draws the mountains and one line — «Nicio alergare luna aceasta» — in
 *   the body, and hands the caller no body to draw in.
 */

/** What the band's big word says, and whether the body has anything to draw. */
export type FramePeriod = {
  /** The month, «iunie», or the week's range, «1–7 iunie»; the frame sets it in capitals. */
  word: string;
  /** The line the body says when nothing is in it — «Nicio alergare luna aceasta» — or null when something is. */
  empty: string | null;
};

/**
 * What a network covers of each shape with its own bars, in pixels of a 1080-wide picture: Instagram's story
 * UI at the top and the reply bar at the bottom. Zero where every row of the picture shows — a 4:5 post
 * among them: the profile grid's 3:4 tile trims its width inside the margin, never its height.
 */
export const COVERED: Record<CalendarImageRatio, { top: number; bottom: number }> = {
  portrait: { top: 0, bottom: 0 },
  square: { top: 0, bottom: 0 },
  story: { top: 250, bottom: 340 },
  landscape: { top: 0, bottom: 0 },
};

/** The month: its name as the big word, and the empty line when the month has no date. */
export function monthPeriod(data: CalendarImageData): FramePeriod {
  return { word: data.words.monthName, empty: data.entries.length === 0 ? data.words.emptyMonth : null };
}

/**
 * The page, the band and the foot, in the palette; what is left between them for the body — null when the
 * period is empty and the frame has said so in the body. Leaves the context's alignment left, its baseline
 * alphabetic and its alpha whole.
 */
export function drawFrame(
  ctx: CanvasRenderingContext2D,
  data: CalendarImageData,
  options: CalendarImageOptions,
  fonts: CalendarImageFonts,
  assets: CalendarImageAssets,
  palette: CalendarImagePalette,
  period: FramePeriod = monthPeriod(data),
): Box | null {
  const { width: W, height: H } = CALENDAR_IMAGE_RATIOS[options.ratio];
  const unit = Math.min(W, H) / 1080;
  // The words follow the width a little: a 16:9 picture is read at a phone's width like the others, with
  // twice the width for them, so its band and foot are set a sixth larger.
  const tx = unit * (W > H ? 1.15 : 1);
  const pad = 32 * unit;
  const gap = 16 * unit;
  const covered = COVERED[options.ratio];
  /** Whether the band and the foot run to the picture's edge, their words out of the covered zone. */
  const bleed = covered.top > 0 || covered.bottom > 0;
  const face = (size: number, weight: number, italic = false) => `${italic ? "italic " : ""}${weight} ${Math.round(size * 2) / 2}px ${fonts.poster}`;
  const upper = (text: string) => text.toLocaleUpperCase("ro-RO");
  const measure = (text: string, font: string) => {
    ctx.font = font;
    return ctx.measureText(text).width;
  };
  const mountains = (x: number, y: number, w: number, h: number, color: string, far: number, near: number) => {
    ctx.save();
    ctx.translate(x, y);
    ctx.scale(w / MOUNTAIN_MARK_VIEWBOX.width, h / MOUNTAIN_MARK_VIEWBOX.height);
    ctx.fillStyle = color;
    ctx.globalAlpha = far;
    ctx.fill(new Path2D(FAR));
    ctx.globalAlpha = near;
    ctx.fill(new Path2D(NEAR));
    ctx.restore();
  };
  ctx.textBaseline = "alphabetic";
  ctx.textAlign = "left";
  ctx.globalAlpha = 1;

  // The page: the palette's two stops, top to bottom (one colour on «Afiș»).
  const page = ctx.createLinearGradient(0, 0, 0, H);
  page.addColorStop(0, palette.background[0]);
  page.addColorStop(1, palette.background[1]);
  ctx.fillStyle = page;
  ctx.fillRect(0, 0, W, H);

  // ── The band. Its sizes come from the picture alone — the month word, the kicker over it, the inset round
  // them — so the band is the same height for every period and layout; a word too long for its room shrinks
  // inside it. Poppins's capitals stand about 0.7 of the size. The logo stands taller than the words, up to
  // the band's own inset.
  const wordSize = 80 * tx;
  const kickerSize = Math.max(18 * tx, wordSize * 0.28);
  const capK = kickerSize * 0.7;
  const between = kickerSize * 0.55;
  const capW = wordSize * 0.7;
  const bandInset = wordSize * 0.28;
  const bandH = capK + between + capW + 2 * bandInset;
  const bandTop = bleed ? covered.top * unit : pad;
  const bandBottom = bandTop + bandH;
  ctx.fillStyle = palette.band;
  if (bleed) ctx.fillRect(0, 0, W, bandBottom);
  else {
    roundRect(ctx, pad, bandTop, W - 2 * pad, bandH, 24 * unit);
    ctx.fill();
  }
  ctx.fillStyle = palette.bandInk;
  const logoInset = bandInset * 0.4;
  const logoH = bandH - 2 * logoInset;
  const logoW = logoH * LOGO_RATIO;
  const logoX = pad + bandInset;
  if (assets.logo) {
    ctx.drawImage(assets.logo, logoX, bandTop + logoInset, logoW, logoH);
  } else {
    // Until the logo loads: the mountains over the club's name, spaced, in the logo's place.
    const nameSize = logoH * 0.16;
    const markH = logoH - nameSize * 1.7;
    const markW = (markH * MOUNTAIN_MARK_VIEWBOX.width) / MOUNTAIN_MARK_VIEWBOX.height;
    mountains(logoX + (logoW - markW) / 2, bandTop + logoInset, markW, markH, palette.bandInk, 0.55, 1);
    ctx.globalAlpha = 1;
    ctx.fillStyle = palette.bandInk;
    ctx.font = face(nameSize, 500);
    fillSpaced(ctx, upper(data.clubName), logoX + logoW / 2, bandTop + logoInset + logoH - nameSize * 0.1, nameSize * 0.35, logoW);
  }
  // «EVENIMENTE» spaced over the period and its year, both ending at the band's right inset.
  const bandRight = W - pad - bandInset;
  const bandRoom = bandRight - (logoX + logoW + bandInset * 1.5);
  const wordText = upper(period.word);
  const yearText = ` ${data.month.year}`;
  const pairAt = (size: number) => {
    const wordW = measure(wordText, face(size, 900, true));
    return { size, wordW, width: wordW + measure(yearText, face(size * 0.56, 500, true)) };
  };
  let pair = pairAt(wordSize);
  if (pair.width > bandRoom) pair = pairAt((pair.size * bandRoom) / pair.width);
  const blockTop = bandTop + bandInset;
  const wordY = blockTop + capK + between + capW;
  ctx.font = face(pair.size, 900, true);
  ctx.fillText(wordText, bandRight - pair.width, wordY);
  ctx.font = face(pair.size * 0.56, 500, true);
  ctx.globalAlpha = 0.8;
  ctx.fillText(yearText, bandRight - pair.width + pair.wordW, wordY);
  ctx.globalAlpha = 1;
  ctx.font = face(kickerSize, 500);
  const kicker = upper(data.words.heading);
  const tracking = kickerSize * 0.42;
  const kickerW = [...kicker].reduce((sum, letter) => sum + ctx.measureText(letter).width, 0) + tracking * ([...kicker].length - 1);
  fillSpaced(ctx, kicker, bandRight - Math.min(kickerW, bandRoom) / 2, blockTop + capK, tracking, bandRoom);

  // ── The foot: «URMĂREȘTE-NE!», each network's mark once, then the tags — on one line, the words as large
  // as the line holds from 24 down to 16, the tags cut last.
  const footH = 66 * tx;
  const footTop = bleed ? H - covered.bottom * unit - footH : H - pad - footH;
  ctx.fillStyle = palette.band;
  if (bleed) ctx.fillRect(0, footTop, W, H - footTop);
  else {
    roundRect(ctx, pad, footTop, W - 2 * pad, footH, 18 * unit);
    ctx.fill();
  }
  {
    const call = `${upper(data.words.follow)}!`;
    const room = W - 2 * pad - 40 * unit;
    const markOf = (size: number) => size * 1.2;
    /** The call, the marks and the tags across the line at `size`: each one's width, and all of them with their spaces — the marks closer to each other than to the words. */
    const widths = (size: number) => {
      const parts = [measure(call, face(size, 800)), ...data.socials.map(() => markOf(size)), measure(data.words.hashtags, face(size, 500))];
      const spaces = parts.length - 1;
      const betweenMarks = Math.max(0, data.socials.length - 1);
      return { parts, total: parts.reduce((sum, width) => sum + width, 0) + betweenMarks * size * 0.8 + (spaces - betweenMarks) * size * 1.25 };
    };
    let size = 24 * tx;
    while (size > 16 * tx && widths(size).total > room) size -= 0.5 * unit;
    const { parts, total } = widths(size);
    const tagsW = parts[parts.length - 1];
    ctx.font = face(size, 500);
    const tags = fitText(ctx, data.words.hashtags, Math.max(0, room - (total - tagsW)));
    const width = total - tagsW + ctx.measureText(tags).width;
    let x = (W - width) / 2;
    const middle = footTop + footH / 2;
    ctx.fillStyle = palette.bandInk;
    ctx.font = face(size, 800);
    ctx.fillText(call, x, middle + size * 0.36);
    x += parts[0] + size * 1.25;
    data.socials.forEach((network, index) => {
      const mark = markOf(size);
      ctx.save();
      ctx.translate(x, middle - mark / 2);
      ctx.scale(mark / 24, mark / 24);
      ctx.fill(new Path2D(SOCIAL_MARKS[network].path));
      ctx.restore();
      x += mark + (index < data.socials.length - 1 ? size * 0.8 : size * 1.25);
    });
    ctx.font = face(size, 500);
    ctx.fillText(tags, x, middle + size * 0.36);
  }

  const body: Box = { x: pad, y: bandBottom + gap, w: W - 2 * pad, h: footTop - gap - (bandBottom + gap) };
  if (period.empty === null) return body;

  // ── Nothing in the period: a sheet in the body, the mountains over the one line, centred.
  roundRect(ctx, body.x, body.y, body.w, body.h, 18 * unit);
  ctx.fillStyle = palette.cell;
  ctx.fill();
  ctx.strokeStyle = palette.line;
  ctx.lineWidth = 3 * unit;
  ctx.stroke();
  const inset = 24 * unit;
  const lineSize = 34 * tx;
  ctx.font = face(lineSize, 700);
  const line = fitText(ctx, period.empty, body.w - 2 * inset);
  const markW = Math.min(body.w * 0.45, 420 * unit);
  const markH = (markW * MOUNTAIN_MARK_VIEWBOX.height) / MOUNTAIN_MARK_VIEWBOX.width;
  const blockH = markH + lineSize * 0.6 + lineSize * 0.72;
  const top = body.y + (body.h - blockH) / 2;
  mountains(body.x + (body.w - markW) / 2, top, markW, markH, palette.line, 0.6, 0.9);
  ctx.globalAlpha = 1;
  ctx.fillStyle = palette.cellInk;
  ctx.textAlign = "center";
  ctx.fillText(line, body.x + body.w / 2, top + blockH);
  ctx.textAlign = "left";
  return null;
}
