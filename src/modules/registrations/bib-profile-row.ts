import type { BibDesign, BibProfileFiguresPlace } from "./bib-design";
import { bibProfileChartWidth } from "./bib-geometry";
import type { BibProfileDrawing, BibProfileFigureLines } from "./bib-profile";
import { type BibStrip, bibProfileStrip } from "./bib-profile-strip";

/**
 * The distance and the gain of a profile's row, with the place the club chose for them (§804, amended):
 * `right` — two lines at the strip's right; `below` — one centred line under it; `header` — one line in the
 * header under the date (`bib-geometry.ts#bibHeaderLayout`). A figure that is not known is `null` or empty,
 * its words not printed.
 */
export type BibProfileFigures = BibProfileFigureLines & { place: BibProfileFiguresPlace };

/**
 * What the profile's row under the number holds (§750, amending it §759), decided once for both
 * renderers so the sheet and the picture cannot disagree:
 *
 * - `gpx` — «Desenat din traseul evenimentului (GPX)»: the line drawn from the route's file by the shared
 *   elevation core, with its «Start» and «Sosire», the kilometres and the altitudes (§804), the checkpoints'
 *   pins, and the distance and the gain where the club put them. The core's answer — `strip`, in the strip's
 *   own box — is asked for here, once, and both renderers draw it.
 * - `picture` — «O poză încărcată»: the club's own picture of the profile, fitted whole; no marks (the
 *   club drew what it wanted), the figures where the club put them, when known.
 *
 * Either way the figures stand where «Unde stau cifrele» says (§804, amended; default `right`, the strip's
 * right, as before) only while «Arată distanța și diferența de nivel» is on and there is something to say;
 * the chart or the picture is narrowed for them (`bibProfileChartWidth`) at the right only — under the profile
 * and in the header it takes the whole width. Null when nothing can be drawn: the tick off, no GPX to draw,
 * or a picture the route could not read — the row then takes no height, as on every number before it.
 *
 * Pure: `extras` is what `bib-extras.ts` read, `pictureLoaded` whether the renderer really holds the
 * club's picture.
 */
export type BibProfileRow =
  | { kind: "gpx"; drawing: BibProfileDrawing; chartWidth: number; figures: BibProfileFigures | null; strip: BibStrip }
  | { kind: "picture"; chartWidth: number; figures: BibProfileFigures | null };

export function bibProfileRow(
  design: Pick<BibDesign, "showProfile" | "profileSource" | "showProfileFigures"> &
    Partial<Pick<BibDesign, "showProfileScale" | "showCheckpoints" | "showCheckpointTimes" | "profileFiguresPlace">>,
  extras: { profile: BibProfileDrawing | null; profileFigures: BibProfileFigureLines | null },
  pictureLoaded: boolean,
): BibProfileRow | null {
  if (!design.showProfile) return null;
  const place = design.profileFiguresPlace ?? "right";
  if (design.profileSource === "picture") {
    if (!pictureLoaded) return null;
    const figures = placedFigures(design.showProfileFigures ? extras.profileFigures : null, place);
    return { kind: "picture", chartWidth: bibProfileChartWidth(figures?.place === "right"), figures };
  }
  if (!extras.profile) return null;
  const figures = placedFigures(design.showProfileFigures ? { distance: extras.profile.distance, gain: extras.profile.gain } : null, place);
  const chartWidth = bibProfileChartWidth(figures?.place === "right");
  const strip = bibProfileStrip(extras.profile, {
    chartWidth,
    showScale: design.showProfileScale !== false,
    showCheckpoints: design.showCheckpoints !== false,
    showTimes: design.showCheckpointTimes === true,
  });
  return { kind: "gpx", drawing: extras.profile, chartWidth, figures, strip };
}

/**
 * The figures with their place. At the right they stand as they always did — two lines, the strip narrowed
 * for them even when a line is empty. Under the profile and in the header they are one line (`bibProfileFiguresLine`):
 * with no word to put on it there are no figures, and nothing is made room for.
 */
function placedFigures(lines: BibProfileFigureLines | null, place: BibProfileFiguresPlace): BibProfileFigures | null {
  if (!lines) return null;
  if (place !== "right" && bibProfileFiguresLine(lines) === null) return null;
  return { ...lines, place };
}

/**
 * The two figures as one line — «Distanță: 9,0 km · Diferență de nivel: +400 m» — for under the profile and for the
 * header (§804, amended); one figure alone is that figure alone; `null` when neither is known.
 */
export function bibProfileFiguresLine(lines: BibProfileFigureLines): string | null {
  const line = [lines.distance, lines.gain].filter((part): part is string => Boolean(part)).join(" · ");
  return line === "" ? null : line;
}

/** Whether the row's figures stand under the profile: the row then takes one text line more (`bib-geometry.ts#bibProfileRowHeight`). */
export function bibFiguresBelow(row: BibProfileRow | null): boolean {
  return row?.figures?.place === "below";
}

/** The line the header prints under the date (`bibHeaderLayout`'s `figures`): the figures' one line while they stand in the header, else `null`. */
export function bibHeaderFiguresLine(row: BibProfileRow | null): string | null {
  return row?.figures?.place === "header" ? bibProfileFiguresLine(row.figures) : null;
}

/**
 * Whether the panel's figures stand at the strip's right (the design's tick on and the place `right`): what
 * narrows the profile's chart and picture, and so the shape recommended for the club's picture
 * (`bib-picture-frame.ts#bibProfilePictureRatio`).
 */
export function bibFiguresBeside(design: Pick<BibDesign, "showProfileFigures" | "profileFiguresPlace">): boolean {
  return design.showProfileFigures && design.profileFiguresPlace === "right";
}
