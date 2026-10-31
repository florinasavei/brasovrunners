import { LOGO } from "@/theme/brand";
import type { CalendarImageDetails } from "../domain/calendar-image";
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

/**
 * The words a layout writes after a date's hour — «Detalii» (the owner, 2026-10-27): the short place, then the
 * distance, then the climb, each only when the dialog has it on and the date has it. `["Tâmpa", "6 km",
 * "≈ 350 m D+"]`, or nothing at all; how they are set is each layout's.
 *
 * A date with no short place says its place's name under «Locul» instead (§NNN), after the climb: every layout
 * drops the words from the end when a cell is short, so a long name goes first and never takes the distance or
 * the climb with it — `["6 km", "Parcul Tractorul"]`.
 *
 * `details` is spelt inline rather than as `CalendarImageOptions["details"]`: `calendar-image-draw.ts`, which
 * declares the options, imports this module, and the reverse import would be a cycle.
 */
export function detailWords(entry: CalendarImageDetails, details: { place: boolean; distance: boolean; elevation: boolean }): string[] {
  const name = details.place && !entry.place ? (entry.placeName ?? null) : null;
  return [details.place && entry.place, details.distance && entry.distance, details.elevation && entry.elevation, name].filter(
    (word): word is string => typeof word === "string" && word !== "",
  );
}

/** A vowel in either case, where a hyphen may follow: a, e, i, o, u, y and the Romanian ă, â, î. */
const VOWEL = /[aeiouyăâî]/i;

/**
 * `word`, wider than `width`, in pieces for one line each, every piece but the last ending in «-»: the widest
 * prefix that fits with its hyphen and ends after a vowel, three letters at least on each side — or, when no
 * such break exists, the widest prefix with three letters each side; the rest goes through the same rule
 * again, so a 17-letter word may take two hyphens. A hyphen the word already has («SHAKE-OUT», «III-A») is
 * the first choice, the prefix ending in it taking no second one, and no piece starts with one. A word too
 * short to split at all stays one piece, wider than the line.
 */
function hyphenated(ctx: Ctx, word: string, width: number): string[] {
  const pieces: string[] = [];
  let letters = [...word.normalize("NFC")];
  while (ctx.measureText(letters.join("")).width > width) {
    const piece = (take: number) => letters.slice(0, take).join("") + (letters[take - 1] === "-" ? "" : "-");
    const fits = (take: number) => letters[take] !== "-" && ctx.measureText(piece(take)).width <= width;
    const widest = (allowed: (take: number) => boolean) => {
      for (let take = letters.length - 3; take >= 3; take -= 1) if (allowed(take)) return take;
      return 0;
    };
    const take = widest((n) => fits(n) && letters[n - 1] === "-") || widest((n) => fits(n) && VOWEL.test(letters[n - 1])) || widest(fits);
    if (take === 0) break;
    pieces.push(piece(take));
    letters = letters.slice(take);
  }
  pieces.push(letters.join(""));
  return pieces;
}

/**
 * `text` broken at spaces into lines of at most `width` at the context's font, nothing cut — the one wrap the
 * layouts and the week share (the audit of 2026-10-27, D23 and D40), a lone dash kept with the word before it
 * as `wrapWhole` keeps it, so no line starts with «—». Two rules over the greedy break:
 *
 * - One short word is not left alone on the last line when the line before can give it one: while the last
 *   line is narrower than `minLastRatio` of `width` (0.35 unless told), the line before has a word to give and
 *   keeps more than the last line had, and the longer last line still fits, that word moves down — «EDIȚIA A
 *   III-A», not «III-A»; never «ab» / «cdefghijklmn op», the orphan merely changing ends.
 * - A word wider than the line: with `hyphenate`, split with «-» after a vowel, three letters at least on each
 *   side (`hyphenated`); without it, alone on its own line, for the caller to see it does not fit. The dash
 *   glued behind a word is not the word: «Marathon» is measured and split bare and its « —» goes back on the
 *   last piece, so a word that fits is never split for its dash — «Marathon —» may then stand one dash wider
 *   than the line, for the caller to see. Nothing is ever cut with «…» here — that is `wrapText`'s.
 *
 * The empty string gives no line.
 */
export function wrapBalanced(ctx: Ctx, text: string, width: number, options: { hyphenate?: boolean; minLastRatio?: number } = {}): string[] {
  const { hyphenate = false, minLastRatio = 0.35 } = options;
  const fits = (line: string) => ctx.measureText(line).width <= width;
  const words = text
    .replace(/\s+([—–-])\s+/g, "\u00a0$1 ")
    .split(/[ \t\n\r]+/)
    .filter(Boolean);
  const lines: string[] = [];
  let current = "";
  for (const word of words) {
    const tail = /\u00a0[—–-]$/.exec(word)?.[0] ?? "";
    const bare = word.slice(0, word.length - tail.length);
    const pieces = hyphenate && !fits(bare) ? hyphenated(ctx, bare, width) : [bare];
    pieces[pieces.length - 1] += tail;
    if (pieces.length > 1 && current) {
      lines.push(current);
      current = "";
    }
    lines.push(...pieces.slice(0, -1));
    const last = pieces[pieces.length - 1];
    const candidate = current ? `${current} ${last}` : last;
    if (!current || fits(candidate)) current = candidate;
    else {
      lines.push(current);
      current = last;
    }
  }
  if (current) lines.push(current);
  const narrow = width * minLastRatio;
  while (lines.length > 1) {
    const before = lines[lines.length - 2].split(" ");
    const last = ctx.measureText(lines[lines.length - 1]).width;
    if (before.length < 2 || last >= narrow) break;
    const kept = before.slice(0, -1).join(" ");
    const moved = `${before[before.length - 1]} ${lines[lines.length - 1]}`;
    if (!fits(moved) || ctx.measureText(kept).width <= last) break;
    lines.splice(-2, 2, kept, moved);
  }
  return lines;
}
