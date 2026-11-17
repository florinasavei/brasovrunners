import { elevationGeometry, type ElevationGeometry, type ElevationLabel, type ElevationMarkerInput } from "@/modules/routes/elevation/geometry";
import { COLOR, contrastRatio, HEX_COLOR, mix } from "@/theme/brand";
import type { BibStripCheckpoint } from "./bib-checkpoints";
import { BIB_MEMBER_CARD, type BibMemberCardBackground } from "./bib-design";
import { BIB_LAYOUT } from "./bib-geometry";
import type { BibProfileDrawing } from "./bib-profile";

/**
 * The strip on a race number laid out **once** by the shared elevation core (§804, amending §750, §757, §759; the
 * owner, 2026-10-16: «I like how it looks when we display from GPX but I want to show the KM & Elevation and
 * hydration points» and «mi-ar plăcea cumva să refolosesc acel widget … să fie și pe pagină și pe BIB»): the line, the
 * area under it, the kilometre scale, the highest and the lowest altitude, the pins and the words in the foot row, all
 * in the strip's own box — `chartWidth` × `profileHeight` points — as `routes/elevation/geometry.ts` decides them for
 * the event's page. Both renderers draw what this returns (`bibs-pdf.ts` with vectors, `bib-image.tsx` with an SVG)
 * at the same points, so the sheet and the picture cannot disagree (`tests/unit/registrations/bib-checkpoints.test.ts`).
 *
 * Pure: the core, the layout constants, the palette's contrast, the members' card's grounds and the drawing's own words; no
 * storage, no React.
 *
 * What the bib asks of the core, and why:
 *
 * - **No `compact`**: compact is for a picture with no room for words; the strip keeps its labels («km 12 · 11:30»),
 *   and asks for the same economy through the single options (no altitude ticks, `extremes`, `clearExtremes`).
 * - **`clearExtremes`**: the lowest altitude's label stands in the foot row; the end words and the checkpoints' words win
 *   over it, and the kilometres give way to it.
 * - **`minAltitudeGapMeters: 5`**: within a few metres only the highest is said.
 * - **The checkpoints' pins never overlap** (a strip 380 points wide holds at most `chartWidth / 7.5` heads in a row, and
 *   it has one row): the ones that would touch are thinned before the core is asked — the first of two stays, unless
 *   the later is an aid station and the earlier is not (§757's rule, kept) — and the highest altitude's label, which
 *   stands above its point, is moved beside a pin it would cover (or its stem), or not drawn where there is no room.
 */

/** What the design asks of the strip, and the width the row decided (`bib-profile-row.ts`). */
export type BibStripOptions = {
  chartWidth: number;
  /** «Kilometrii și altitudinile pe profil» (§804): the kilometre ticks and labels, the highest and the lowest altitude. */
  showScale: boolean;
  /** «Punctele de pe traseu pe profil» (§757): the pins of the checkpoints the drawing carries. */
  showCheckpoints: boolean;
  /** «…cu orele limită» (§757): the cut-offs beside the points, where every one fits. */
  showTimes: boolean;
};

/**
 * A piece of text and where it stands in the strip's box: `baseline` is the text's baseline, `anchor` says which end of the text `x`
 * is. `altitude` marks the highest and the lowest altitude («622 m», «815 m»), the words drawn in their own ink (`bibAltitudeInk`).
 */
export type BibStripText = { text: string; x: number; baseline: number; anchor: "start" | "middle" | "end"; altitude: boolean };

export type BibStrip = {
  /** The core's answer in the strip's box, in points from the box's top left: the line, the area, the ticks, the pins. */
  geometry: ElevationGeometry;
  /** The checkpoints the pins stand for, in `geometry.markers`' order (a marker's `index` is its place here). */
  checkpoints: readonly BibStripCheckpoint[];
  /** Whether the cut-offs are printed: asked for, at least one exists and every label fits. */
  timesShown: boolean;
  /** Whether the scale is drawn: the foot rule, the ticks. */
  scale: boolean;
  /** Every piece of text, in drawing order: «Start» and «Sosire», the points' words, the kilometres and their unit, the altitudes. */
  texts: readonly BibStripText[];
};

/** The glyph's scale inside a pin's ring: the core's glyphs are drawn in a 16-unit box (`glyphs.ts`), about 1.56 times the ring's radius across. */
export const bibPinGlyphScale = (pinRadius: number): number => (pinRadius * 0.78) / 7.5;

/** What the strip's highest and lowest altitude are drawn in: a colour, and the opacity it is laid on the paper at. */
export type BibAltitudeInk = { colour: string; opacity: number };

/**
 * The ink of the strip's highest and lowest altitude, decided once for the sheet and the picture so they cannot disagree (§968;
 * the owner, 2026-11-17, of «815 m» under the curve reading like one more distance: «aș vrea ca numerele de la elevație să fie un
 * pic colorate diferit, să nu se confunde cu markerii de distanță»).
 *
 * - **The band's colour**: the colour this bib's own header band is drawn in — the event's, or the members' on a member's bib —
 *   as the renderer already holds it (`band`; under the club's header picture, the colour the band would have), where it reads
 *   on the white paper at `profileAltitudeContrast` : 1 or more against white (`COLOR.surface`), as WCAG computes it. The club's
 *   own blue and each colour the editor offers (`BIB_COLOURS`) read so.
 * - **Else the ink, faded**: at `profileAltitudeOpacity` (60 %), or stronger by `profileAltitudeOpacityStep` (5 %) at a time up to
 *   the full ink, the first strength that still reads at `profileAltitudeContrast` : 1 on every ground the strip can stand on —
 *   so the altitudes stand apart from the kilometres and still read. On the white paper that is 60 %: a colour too light for
 *   small type on white — a yellow an event's file may carry; the editor offers none — never prints it. A member's card
 *   (§695, `card`: its background as `bibMemberCardBackground` gives it to the renderer) has no band, and its strip stands in white
 *   on the card's own ground (`cardGrounds`): its altitudes are always the card's white, at 60 % on the kit's gradient, on the
 *   veiled photograph and on the editor's purple and black, and stronger on a colour where 60 % would read under that bar — the
 *   red at 65 %, the teal at 70 %.
 *
 * Only the two altitudes take it: the kilometres and their unit, «Start» and «Sosire», the points' words and glyphs, the curve and
 * its area keep `ink`, and the altitudes keep their size, weight and place.
 */
export function bibAltitudeInk(bib: { band: string; ink: string; card: BibMemberCardBackground | null }): BibAltitudeInk {
  const L = BIB_LAYOUT;
  if (!bib.card && HEX_COLOR.test(bib.band) && contrastRatio(bib.band, COLOR.surface) >= L.profileAltitudeContrast) return { colour: bib.band, opacity: 1 };
  const grounds = bib.card ? cardGrounds(bib.card) : [COLOR.surface];
  // `ink` laid at `opacity` on a ground is the two mixed channel by channel, as pdfkit's and Satori's compositing lays it.
  const reads = (opacity: number) => grounds.every((ground) => contrastRatio(mix(ground, bib.ink, opacity), ground) >= L.profileAltitudeContrast);
  let opacity: number = L.profileAltitudeOpacity;
  while (opacity < 1 && !reads(opacity)) opacity = Math.min(1, Math.round((opacity + L.profileAltitudeOpacityStep) * 100) / 100);
  return { colour: bib.ink, opacity };
}

/**
 * What a member's card's strip stands on (§695), from its background as the renderer holds it: the members' colour; the kit's
 * gradient, both its stops; their photograph under the veil — over a white photograph, the lightest ground the veil can give, as
 * `member-bib-card.test.ts` measures the number's white on it.
 */
function cardGrounds(card: BibMemberCardBackground): readonly string[] {
  if (card.kind === "colour") return [card.colour];
  if (card.kind === "gradient") return card.stops;
  return [mix(COLOR.surface, BIB_MEMBER_CARD.veil, BIB_MEMBER_CARD.veilOpacity)];
}

const isAid = (kinds: readonly string[]): boolean => kinds.includes("WATER") || kinds.includes("FOOD");

/**
 * The pins that fit side by side: one that would touch the one kept before it — less than a head's diameter and its gap
 * away — is not drawn, and the aid station takes the place of a point that is not one. Two aid stations that touch are one
 * pin that says both («km 4 · apă + hrană»), so a water point followed by a food point never reads as «no food here». A «Regrupare»
 * point (§824) is first among one point's own glyphs, but between two points that touch the aid station's rule stands: a regroup
 * point within a pin's reach of an aid station gives way to it, while a point that is both keeps the group's glyph.
 * `checkpoints` are by distance.
 */
export function thinBibCheckpoints(checkpoints: readonly BibStripCheckpoint[], chartWidth: number, distanceMeters: number, pinRadius: number): BibStripCheckpoint[] {
  const reach = pinRadius * 2 + pinRadius * 0.5;
  const kept: { x: number; checkpoint: BibStripCheckpoint }[] = [];
  for (const checkpoint of checkpoints) {
    const x = distanceMeters > 0 ? Math.min(1, (checkpoint.km * 1000) / distanceMeters) * chartWidth : 0;
    const last = kept[kept.length - 1];
    if (last && x - last.x < reach) {
      if (isAid(checkpoint.kinds) && !isAid(last.checkpoint.kinds)) kept[kept.length - 1] = { x, checkpoint };
      else if (isAid(checkpoint.kinds)) {
        const kinds = [...new Set([...last.checkpoint.kinds, ...checkpoint.kinds])];
        const says = (k: readonly string[]) => k.includes("WATER") && k.includes("FOOD");
        // The kept pin's own words, unless the two together are a water and a food station and it alone is not.
        if (says(kinds) && !says(last.checkpoint.kinds)) last.checkpoint = { ...last.checkpoint, kinds, label: last.checkpoint.bothLabel };
      }
      continue;
    }
    kept.push({ x, checkpoint });
  }
  return kept.map((item) => item.checkpoint);
}

/**
 * The altitude label that stands above the line (the highest point's) kept off the pins: not over a head, and not across a stem
 * (a stem runs from its head down to the foot, so it crosses whatever stands above the line at its x). Where the label's own place
 * touches one it moves to the side of that pin — its end against the pin's left, else its start against the pin's right — and
 * where neither is free it is not drawn. A label in the foot row (the lowest point's) is the core's to keep clear (`clearExtremes`).
 */
function clearOfPins(label: ElevationLabel, geometry: ElevationGeometry, textSize: number): ElevationLabel | null {
  if (label.y > geometry.plot.bottom) return label;
  const width = label.text.length * textSize * 0.6 + textSize * 0.2;
  const room = geometry.pinRadius + 1;
  const boxOf = (candidate: ElevationLabel): [number, number] =>
    candidate.anchor === "start" ? [candidate.x, candidate.x + width] : candidate.anchor === "end" ? [candidate.x - width, candidate.x] : [candidate.x - width / 2, candidate.x + width / 2];
  const free = (candidate: ElevationLabel): boolean => {
    const [from, to] = boxOf(candidate);
    return from >= 0 && to <= geometry.width && geometry.markers.every((marker) => marker.headX + room <= from || marker.headX - room >= to);
  };
  if (free(label)) return label;
  const beside = geometry.markers.flatMap((marker): ElevationLabel[] => [
    { ...label, anchor: "end", x: Math.round((marker.headX - room) * 100) / 100 },
    { ...label, anchor: "start", x: Math.round((marker.headX + room) * 100) / 100 },
  ]);
  const [centre] = boxOf(label);
  const nearest = beside.filter(free).sort((a, b) => Math.abs(boxOf(a)[0] - centre) - Math.abs(boxOf(b)[0] - centre))[0];
  return nearest ?? null;
}

const asText = (label: ElevationLabel, altitude: boolean): BibStripText => ({ text: label.text, x: label.x, baseline: label.y, anchor: label.anchor, altitude });

export function bibProfileStrip(drawing: BibProfileDrawing, options: BibStripOptions): BibStrip {
  const L = BIB_LAYOUT;
  const textSize = L.profileLabelSize;
  const checkpoints = options.showCheckpoints ? thinBibCheckpoints(drawing.checkpoints ?? [], options.chartWidth, drawing.distanceMeters, L.profilePinRadius) : [];
  const whole = new Intl.NumberFormat(drawing.locale, { maximumFractionDigits: 0, useGrouping: false });
  // The top holds the pins' row, or the highest altitude's label; a strip with neither keeps the room it always had.
  const top = checkpoints.length > 0 || options.showScale ? L.profileTopRoom : L.profileTopBare;
  const geometryWith = (label: (checkpoint: BibStripCheckpoint) => string): ElevationGeometry => {
    const markers: ElevationMarkerInput[] = checkpoints.map((checkpoint) => ({ km: checkpoint.km, kinds: checkpoint.kinds, label: label(checkpoint) }));
    return elevationGeometry(drawing.profile, markers, {
      width: options.chartWidth,
      height: L.profileHeight,
      inset: { top, bottom: L.profileFootRoom },
      textSize,
      minGap: L.checkpointTimeGap,
      distanceMeters: drawing.distanceMeters,
      format: { km: (km) => whole.format(km), altitude: (meters) => `${whole.format(meters)} ${drawing.altitudeUnit}` },
      kmScale: options.showScale,
      kmUnit: options.showScale ? drawing.kmUnit : null,
      extremes: options.showScale,
      clearExtremes: true,
      minAltitudeGapMeters: 5,
      endWords: { start: drawing.start, finish: drawing.finish },
      pinRadius: L.profilePinRadius,
      // The event page's rule (§881): a checkpoint offering food and water draws the fork.
      foodBeforeWater: true,
    });
  };

  // The words: the plain ones, or — «…cu orele limită» — each with its cut-off, where every one of them fits (§757's rule).
  let geometry = geometryWith((checkpoint) => checkpoint.label);
  let timesShown = false;
  if (options.showTimes && checkpoints.some((checkpoint) => checkpoint.timeLabel !== null)) {
    const timed = geometryWith((checkpoint) => checkpoint.timeLabel ?? checkpoint.kmLabel);
    if (timed.markers.every((marker) => marker.label !== null)) {
      geometry = timed;
      timesShown = true;
    }
  }

  const extremes = geometry.extremes.flatMap((extreme) => {
    const label = clearOfPins(extreme.label, geometry, textSize);
    return label ? [{ ...extreme, label }] : [];
  });

  const texts: BibStripText[] = [];
  if (geometry.endWords) texts.push(asText(geometry.endWords.start, false), asText(geometry.endWords.finish, false));
  for (const marker of geometry.markers) if (marker.label) texts.push(asText(marker.label, false));
  for (const label of geometry.kmLabels) texts.push(asText(label, false));
  if (geometry.kmUnit) texts.push(asText(geometry.kmUnit, false));
  // The altitudes last, as ever: the only words of the strip in their own ink (`bibAltitudeInk`).
  for (const extreme of extremes) texts.push(asText(extreme.label, true));

  return { geometry: { ...geometry, extremes }, checkpoints, timesShown, scale: options.showScale, texts };
}
