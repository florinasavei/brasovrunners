import type { BibDesign } from "./bib-design";
import { bibProfileChartWidth } from "./bib-geometry";
import type { BibProfileDrawing, BibProfileFigureLines } from "./bib-profile";
import { type BibStrip, bibProfileStrip } from "./bib-profile-strip";

/**
 * What the profile's row under the number holds (§750, amending it §759), decided once for both
 * renderers so the sheet and the picture cannot disagree:
 *
 * - `gpx` — «Desenat din traseul evenimentului (GPX)»: the line drawn from the route's file by the shared
 *   elevation core, with its «Start» and «Sosire», the kilometres and the altitudes (§804), the checkpoints'
 *   pins, and the distance and the gain beside it. The core's answer — `strip`, in the strip's own box — is
 *   asked for here, once, and both renderers draw it.
 * - `picture` — «O poză încărcată»: the club's own picture of the profile, fitted whole; no marks (the
 *   club drew what it wanted), the figures beside it when known.
 *
 * Either way the figures stand at the strip's right only while «Arată distanța și diferența de nivel
 * lângă profil» is on and there is something to say; otherwise the chart or the picture takes the whole
 * width (`bibProfileChartWidth`). Null when nothing can be drawn: the tick off, no GPX to draw, or a
 * picture the route could not read — the row then takes no height, as on every number before it.
 *
 * Pure: `extras` is what `bib-extras.ts` read, `pictureLoaded` whether the renderer really holds the
 * club's picture.
 */
export type BibProfileRow =
  | { kind: "gpx"; drawing: BibProfileDrawing; chartWidth: number; figures: BibProfileFigureLines | null; strip: BibStrip }
  | { kind: "picture"; chartWidth: number; figures: BibProfileFigureLines | null };

export function bibProfileRow(
  design: Pick<BibDesign, "showProfile" | "profileSource" | "showProfileFigures"> & Partial<Pick<BibDesign, "showProfileScale" | "showCheckpoints" | "showCheckpointTimes">>,
  extras: { profile: BibProfileDrawing | null; profileFigures: BibProfileFigureLines | null },
  pictureLoaded: boolean,
): BibProfileRow | null {
  if (!design.showProfile) return null;
  if (design.profileSource === "picture") {
    if (!pictureLoaded) return null;
    const figures = design.showProfileFigures ? extras.profileFigures : null;
    return { kind: "picture", chartWidth: bibProfileChartWidth(figures !== null), figures };
  }
  if (!extras.profile) return null;
  const figures = design.showProfileFigures ? { distance: extras.profile.distance, gain: extras.profile.gain } : null;
  const chartWidth = bibProfileChartWidth(figures !== null);
  const strip = bibProfileStrip(extras.profile, {
    chartWidth,
    showScale: design.showProfileScale !== false,
    showCheckpoints: design.showCheckpoints !== false,
    showTimes: design.showCheckpointTimes === true,
  });
  return { kind: "gpx", drawing: extras.profile, chartWidth, figures, strip };
}
