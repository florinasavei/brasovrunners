import { LOGO } from "@/theme/brand";
import type { EventSurface, EventType } from "../domain/event-type";
import { SURFACE_PATHS, TYPE_PATHS } from "./calendar-image-glyphs";

/**
 * What every drawing of «Salvează ca imagine» (§855) shares — the picture's shapes and the canvas's small
 * helpers — so `calendar-image-draw.ts` and each of «Afiș»'s layouts (`calendar-image-poster-*.ts`) import
 * them from one place, and none imports another.
 */

/** The picture's shapes, by where it is posted: an Instagram post, a square, a story, a Facebook post. */
export const CALENDAR_IMAGE_RATIOS = {
  portrait: { width: 1080, height: 1350 },
  square: { width: 1080, height: 1080 },
  story: { width: 1080, height: 1920 },
  landscape: { width: 1920, height: 1080 },
} as const;
export type CalendarImageRatio = keyof typeof CALENDAR_IMAGE_RATIOS;

/** The lockup's own proportions, width over height. */
export const LOGO_RATIO = LOGO.lockup.width / LOGO.lockup.height;

export type Ctx = Pick<CanvasRenderingContext2D, "measureText">;

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

export function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  ctx.beginPath();
  ctx.roundRect(x, y, w, h, Math.max(0, Math.min(r, h / 2, w / 2)));
}

export type Box = { x: number; y: number; w: number; h: number };

/**
 * `text` in spaced capitals, centred on `x`: letter by letter, `tracking` apart (less when `maxWidth` is
 * short), because the canvas's own `letterSpacing` is missing from Safari before 18 and, where it exists,
 * counts a space after the last letter too. Kerning does not matter at this spacing.
 */
export function fillSpaced(ctx: CanvasRenderingContext2D, text: string, x: number, y: number, tracking: number, maxWidth: number) {
  const letters = [...text.normalize("NFC")];
  const widths = letters.map((letter) => ctx.measureText(letter).width);
  const inked = widths.reduce((sum, width) => sum + width, 0);
  const gap = letters.length > 1 ? Math.max(0, Math.min(tracking, (maxWidth - inked) / (letters.length - 1))) : 0;
  let left = x - (inked + gap * (letters.length - 1)) / 2;
  const align = ctx.textAlign;
  ctx.textAlign = "left";
  letters.forEach((letter, index) => {
    ctx.fillText(letter, left, y);
    left += widths[index] + gap;
  });
  ctx.textAlign = align;
}

/** A 24-unit glyph path, drawn `size` wide with its top-left at (x, y). */
export function drawGlyph(ctx: CanvasRenderingContext2D, path: string, x: number, y: number, size: number, color: string) {
  ctx.save();
  ctx.translate(x, y);
  ctx.scale(size / 24, size / 24);
  ctx.fillStyle = color;
  ctx.fill(new Path2D(path));
  ctx.restore();
}

/**
 * An event's glyphs, as the app's chips show them (§858): its type's — or `typePath` where a layout marks it
 * otherwise — then its ground's when it has one: the road, the mountain, the fork.
 */
export function eventGlyphs(type: EventType, surface: EventSurface | null, typePath = TYPE_PATHS[type]): string[] {
  return surface ? [typePath, SURFACE_PATHS[surface]] : [typePath];
}

/** How wide `count` glyphs of `size` are side by side, a fifth of one apart. */
export function glyphsWidth(count: number, size: number): number {
  return count > 0 ? size * (count * 1.2 - 0.2) : 0;
}

/** Glyphs side by side from `x`; the width they took. */
export function drawGlyphs(ctx: CanvasRenderingContext2D, paths: readonly string[], x: number, y: number, size: number, color: string): number {
  paths.forEach((path, index) => drawGlyph(ctx, path, x + index * size * 1.2, y, size, color));
  return glyphsWidth(paths.length, size);
}
