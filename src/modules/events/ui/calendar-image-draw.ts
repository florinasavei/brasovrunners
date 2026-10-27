import { CALENDAR_IMAGE_THEMES, type CalendarImagePaletteName } from "@/theme/brand";
import type { CalendarImageRatio } from "./calendar-image-canvas";
import { drawPosterCells } from "./calendar-image-poster-cells";
import { drawPosterFormats } from "./calendar-image-poster-formats";
import { drawPosterHeads } from "./calendar-image-poster-heads";
import type { CalendarImageData } from "../domain/calendar-image";

/**
 * «Salvează ca imagine» (§855): the month drawn on a `<canvas>`, in the visitor's browser. No server, no
 * function, no library — the 2D context the browser already has. Pure: the same data, options and fonts
 * draw the same picture, and nothing here touches the page.
 *
 * One drawing in three layouts (`calendar-image-poster-*.ts`), and the themes are its palettes (the owner,
 * 2026-10-27): «Afiș» is the club's own white poster, and «Clubul», «Luminos», «Întunecat» and «Sezonul
 * lunii» are the same layouts on their own pages and cells — every theme gets «Așezare», and every fix to
 * a layout reaches every theme.
 */

/** «Afiș» (the club's own poster, the default), «Clubul», «Luminos», «Întunecat», «Sezonul lunii». */
export const CALENDAR_IMAGE_THEME_CHOICES = ["poster", "club", "light", "dark", "season"] as const;
export type CalendarImageTheme = (typeof CALENDAR_IMAGE_THEME_CHOICES)[number];

/**
 * How the month is set out (the owner, 2026-10-27: «But I want settings for those layouts»): `heads`, each
 * weekly series written once under its weekday's head; `cells`, each series' dates as chips in its own
 * colour and the key in the empty days; `formats`, chips in the grid and the key below it (beside it on 16:9).
 */
export const CALENDAR_IMAGE_LAYOUT_CHOICES = ["heads", "cells", "formats"] as const;
export type CalendarImageLayout = (typeof CALENDAR_IMAGE_LAYOUT_CHOICES)[number];

export type CalendarImageOptions = {
  theme: CalendarImageTheme;
  ratio: CalendarImageRatio;
  /** «Așezare»: which layout draws the month, whatever the theme. */
  layout: CalendarImageLayout;
  /**
   * «Evenimente recurente» and «Evenimente speciale» beside or under the grid. In `heads` the series are in
   * the column heads either way; this lists the special dates, and a series no head can hold.
   */
  legend: boolean;
};

/**
 * The faces the picture is drawn in, as CSS font-family lists: the body's, the club kit's and the hand-written
 * one, all three the page's own and none drawn by the layouts today; and `poster`, the geometric sans every
 * layout is set in from its band to its foot (Poppins, which the dialog loads for itself).
 */
export type CalendarImageFonts = { body: string; display: string; script: string; poster: string };

/**
 * The club's real logo (the white lockup, `LOGO.lockup.onDark`, served by the site itself so the canvas
 * stays exportable), loaded by the dialog; null until it has loaded or when it cannot, and the band then
 * draws the mountains and the name instead.
 */
export type CalendarImageAssets = { logo: CanvasImageSource | null };

/** The palette a theme draws in: «Sezon» by the month's season. */
export function paletteFor(theme: CalendarImageTheme, month: number): CalendarImagePaletteName {
  if (theme !== "season") return theme;
  if (month === 12 || month <= 2) return "winter";
  if (month <= 5) return "spring";
  if (month <= 8) return "summer";
  return "autumn";
}

/** The layout chosen, in the theme's palette. */
export function drawCalendarImage(
  ctx: CanvasRenderingContext2D,
  data: CalendarImageData,
  options: CalendarImageOptions,
  fonts: CalendarImageFonts,
  assets: CalendarImageAssets = { logo: null },
): void {
  const palette = CALENDAR_IMAGE_THEMES[paletteFor(options.theme, data.month.month)];
  switch (options.layout) {
    case "cells":
      drawPosterCells(ctx, data, options, fonts, assets, palette);
      return;
    case "formats":
      drawPosterFormats(ctx, data, options, fonts, assets, palette);
      return;
    default:
      drawPosterHeads(ctx, data, options, fonts, assets, palette);
      return;
  }
}
