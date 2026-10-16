/**
 * The route's profile on a race number (§750; the owner, 2026-10-13: the elevation over distance, with
 * the distance and the gain; amended §NNN: the strip draws from the same elevation core as the event's
 * page — «mi-ar plăcea cumva să refolosesc acel widget … să fie și pe pagină și pe BIB»): the profile
 * read once on the server from the event's route GPX (§718) by the core's own parser
 * (`routes/elevation/parse.ts#parseGpxElevation`), the two facts beside it, and the words the strip is
 * made of, in the sheet's language.
 *
 * Pure, importing only the core's types: no `node:` builtin, no storage, no React — the reader of the file
 * is `bib-extras.ts`, the geometry is the core's (`bib-profile-strip.ts` asks it), and the two renderers
 * draw what that gives them (`bibs-pdf.ts` with vectors, `bib-image.tsx` with an SVG).
 */

import type { ElevationProfileData } from "@/modules/routes/elevation/parse";
import type { BibStripCheckpoint } from "./bib-checkpoints";

/**
 * Which figures the bib prints (§750): **the event's own win** — «Distanță» and «Diferență de nivel»
 * as the club typed them (§598, §585), the numbers its page and its emails say — and the GPX's
 * computed ones fill what the club left empty. A track recorded by a watch carries its own noise;
 * a figure the club typed is a figure it stands behind, and the bib must say what the page says.
 */
export function bibProfileFigures(
  profile: Pick<ElevationProfileData, "distanceMeters" | "gainMeters">,
  own: { distanceMeters?: number | null; elevationGainMeters?: number | null },
): { distanceMeters: number; gainMeters: number } {
  return {
    distanceMeters: own.distanceMeters && own.distanceMeters > 0 ? own.distanceMeters : profile.distanceMeters,
    gainMeters: own.elevationGainMeters !== null && own.elevationGainMeters !== undefined && own.elevationGainMeters >= 0 ? own.elevationGainMeters : profile.gainMeters,
  };
}

/**
 * What a renderer draws, before the core lays it out: the profile, the distance it spans, and the words, already
 * in the sheet's language — «Start» and «Sosire», the two lines beside the strip, the units of the scale and the
 * checkpoints' labels.
 */
export type BibProfileDrawing = {
  /** The route's profile as the core reads it: metres from the start and the altitude there, in metres. */
  profile: ElevationProfileData;
  /** The distance the strip spans, metres — the figure the bib prints (the club's own first, §750) — so the finish is the strip's right end whatever the track's own length. */
  distanceMeters: number;
  /** The sheet's language, for the numbers of the scale. */
  locale: string;
  /** «Start» and «Sosire», under the strip's two ends. */
  start: string;
  finish: string;
  /** «Distanță: 12,4 km» and «Diferență de nivel: +640 m». */
  distance: string;
  gain: string;
  /** The scale's units: «km» after the last kilometre, «m» after an altitude. */
  kmUnit: string;
  altitudeUnit: string;
  /**
   * The route's checkpoints the strip pins (§757, `bib-checkpoints.ts`): only the ones the club left ticked «Arată pe profilul
   * traseului» and that lie within the printed distance, by distance, each with its words. Absent or empty: none drawn.
   */
  checkpoints?: readonly BibStripCheckpoint[] | null;
};

/** The two lines beside the profile, each `null` when its figure is not known (§759). */
export type BibProfileFigureLines = { distance: string | null; gain: string | null };

/** The words a drawing is made of, from the caller's catalogue (`Admin.bibs.profile*`). */
export type BibProfileSay = (key: "start" | "finish" | "distance" | "gain" | "kmUnit" | "altitudeUnit", values?: { km?: string; m?: string }) => string;

export function bibProfileDrawing(
  profile: ElevationProfileData,
  own: { distanceMeters?: number | null; elevationGainMeters?: number | null },
  locale: string,
  say: BibProfileSay,
): BibProfileDrawing {
  const figures = bibProfileFigures(profile, own);
  const words = bibProfileFigureWords(figures, locale, say);
  return {
    profile,
    distanceMeters: figures.distanceMeters,
    locale,
    start: say("start"),
    finish: say("finish"),
    distance: words.distance ?? "",
    gain: words.gain ?? "",
    kmUnit: say("kmUnit"),
    altitudeUnit: say("altitudeUnit"),
  };
}

/**
 * The two lines beside the profile — «Distanță: 12,4 km», «Diferență de nivel: +640 m» — for whichever
 * figures are known (§750; for a picture of the profile, §759, they may be the club's typed figures
 * alone): a figure that is not known is `null`, its line not printed.
 */
export function bibProfileFigureWords(
  figures: { distanceMeters: number | null; gainMeters: number | null },
  locale: string,
  say: BibProfileSay,
): BibProfileFigureLines {
  const km = new Intl.NumberFormat(locale, { minimumFractionDigits: 1, maximumFractionDigits: 1 });
  const metres = new Intl.NumberFormat(locale, { maximumFractionDigits: 0 });
  return {
    distance: figures.distanceMeters !== null && figures.distanceMeters > 0 ? say("distance", { km: km.format(figures.distanceMeters / 1000) }) : null,
    gain: figures.gainMeters !== null && figures.gainMeters >= 0 ? say("gain", { m: metres.format(figures.gainMeters) }) : null,
  };
}
