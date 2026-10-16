import type { ElevationProfileData } from "./parse";

/**
 * The geometry of an elevation profile, decided once (§NNN; the owner, 2026-10-16: «mi-ar plăcea cumva să refolosesc acel
 * widget … adică să fie și pe pagină și pe BIB»): where the line, the area under it, the scales, the labels and the
 * checkpoints' pins stand in a box of **any aspect and any unit** — the event page's SVG at 1000 × 240, the editor's preview
 * at 400 × 150, a race number's strip at 380 × 38 points — and nothing about how they are drawn.
 *
 * **Pure and free of React, the DOM and the database**, importing only the profile's type: every text is a plain string the
 * caller formatted (the caller hands the `format` callbacks, so «4,5» and «4.5» live outside the core), every position is
 * a number in the caller's own units, and the line and the area come as **point arrays**, not SVG path data, because a PDF
 * draws points and an SVG joins them (`pathOf` below does it for the one that needs a string).
 *
 * What it decides, in this order:
 *
 * - **The plot** — the box minus the caller's insets, where the line lives. The profile is stretched to the distance the
 *   caller says the route is (`distanceMeters`: the figure the club typed, else the track's own), so a checkpoint's kilometre
 *   and the line agree whatever the GPX's own length.
 * - **The altitude range** — the profile's lowest and highest altitude with a little room, and a **route that climbs less than
 *   `minSpanMeters` is drawn flat** (centred in a range that wide), never stretched to the box.
 * - **The kilometre scale** — a tick every 1 km up to 12 km, every 2 km up to 25 km, every 5 km beyond. Its labels are kept
 *   from the left, each clear of the one kept before it, of the marker labels and of the two end words by `minGap`; the rest
 *   are dropped, the ticks stay. The unit word goes after the last label kept.
 * - **The altitude ticks** — at most `altitudeTicks` round values (steps of 10, 25, 50, 100, 200, 500 m …) inside the range,
 *   each with its grid line, fewer where the labels would touch.
 * - **The extremes** — the highest and the lowest point's altitude where they are, anchored so the words stay in the box; only
 *   the highest when the two are within `minAltitudeGapMeters` of one another (the few-metres rule).
 * - **The markers** — one per checkpoint handed in, **never dropped**: the point on the line, the kind's glyph, a pin head
 *   in the band above the plot, **raised** to the next row up when two heads would touch (`raised`), and optionally a label
 *   in the foot row that is dropped (the marker is not) when it would touch a label kept before it or an end word.
 * - **Compact** — for a small picture: no marker labels, at most two altitude ticks, only the highest extreme.
 * - **Mirrored** — every x flipped across the box, the anchors with them.
 */

/** What a checkpoint's pin shows: one glyph, or a plain dot. */
export type ElevationGlyph = "water" | "food" | "firstAid" | "timing" | "direction" | "none";

/** The glyph a point's kinds give it, most useful to a runner first: water, food, first aid, timing, direction. */
const GLYPH_OF_KIND: ReadonlyArray<readonly [string, ElevationGlyph]> = [
  ["WATER", "water"],
  ["FOOD", "food"],
  ["FIRST_AID", "firstAid"],
  ["TIMING", "timing"],
  ["DIRECTION", "direction"],
];

export function glyphForKinds(kinds: readonly string[]): ElevationGlyph {
  for (const [kind, glyph] of GLYPH_OF_KIND) if (kinds.includes(kind)) return glyph;
  return "none";
}

/** One checkpoint as the core reads it: its kilometre, what it offers, and the words to print under its pin (or none). */
export type ElevationMarkerInput = { km: number; kinds: readonly string[]; label?: string | null };

/** A point in the caller's box units. */
export type ElevationPoint = readonly [number, number];

/** A piece of text and where it stands: `y` is the baseline; `anchor` says which end of the text `x` is. */
export type ElevationLabel = { x: number; y: number; text: string; anchor: "start" | "middle" | "end" };

export type ElevationMarker = {
  /** The marker's place in the array the caller handed in. */
  index: number;
  /** The point on the line. */
  x: number;
  y: number;
  glyph: ElevationGlyph;
  /** The pin head's centre, in the band above the plot. */
  headX: number;
  headY: number;
  /** Which row of heads: 0 the nearest the plot, 1 the next up, … — a head that would touch another is raised. */
  raised: number;
  /** The words in the foot row, or null: none given, dropped for crowding, or compact. */
  label: ElevationLabel | null;
  /** Where the tick from the line down to the foot ends. */
  tickTo: number;
};

export type ElevationGeometry = {
  width: number;
  height: number;
  /** The plot's edges, `left` < `right` and `top` < `bottom`, whichever way it is mirrored. */
  plot: { left: number; right: number; top: number; bottom: number };
  orientation: "normal" | "mirrored";
  /** The distance the plot spans, metres. */
  distanceMeters: number;
  /** The altitude range the plot spans, metres: `max` is at `plot.top`, `min` at `plot.bottom`. */
  altitude: { min: number; max: number };
  /** One point per profile point, in the profile's own order (so index i is `points[i]`); x runs right to left when mirrored. */
  line: ElevationPoint[];
  /** The closed polygon under the line: the line, then the plot's foot under its last point and under its first. */
  area: ElevationPoint[];
  kmTicks: { x: number; km: number }[];
  kmLabels: ElevationLabel[];
  /** The unit word after the last kilometre label, or null (none wanted, or no room). */
  kmUnit: ElevationLabel | null;
  altitudeTicks: { y: number; altitude: number; label: ElevationLabel; gridFrom: number; gridTo: number }[];
  extremes: { kind: "min" | "max"; x: number; y: number; label: ElevationLabel }[];
  markers: ElevationMarker[];
  /** The pin heads' radius and how many rows of them the markers needed. */
  pinRadius: number;
  pinRows: number;
  endWords: { start: ElevationLabel; finish: ElevationLabel } | null;
};

export type ElevationOptions = {
  /** The box, in the caller's units. */
  width: number;
  height: number;
  /** Room left round the plot for labels and pins; each defaults to 0. */
  inset?: { top?: number; right?: number; bottom?: number; left?: number };
  /** The labels' type size in the same units, which every width and height estimate follows. */
  textSize: number;
  /** The least free space between two labels, in the same units. */
  minGap: number;
  /** The width of an average character as a share of `textSize`: 0.6 by default (Roboto's digits and small letters, about). */
  charEm?: number;
  /** The distance the plot spans: the club's typed figure, else the track's own (the profile's) — the default. */
  distanceMeters?: number;
  orientation?: "normal" | "mirrored";
  /** The caller's words for a number: the language's decimal mark and unit live there, never in the core. */
  format: { km: (km: number) => string; altitude: (meters: number) => string };
  /** Draw the kilometre scale: true by default. */
  kmScale?: boolean;
  /** The word after the last kilometre label («km»), or none. */
  kmUnit?: string | null;
  /** At most this many altitude ticks; none by default. */
  altitudeTicks?: number;
  /** Label the highest and the lowest point; off by default. */
  extremes?: boolean;
  /** Two extremes closer than this, in metres, are one: only the highest is labelled. 20 by default. */
  minAltitudeGapMeters?: number;
  /**
   * An extreme's label that stands in the foot row (the lowest point's, under the line near the plot's foot) keeps clear of the end
   * words and the marker labels — dropped when it would touch one — and the kilometre labels then give way to it, so «608 m» is
   * never printed over «3». Off by default: the labels are then placed where their points are, whatever else stands there (a chart
   * with room round the plot, like the page's, has no such crowd). A small strip turns it on (§NNN, the race number).
   */
  clearExtremes?: boolean;
  /** A route that climbs less than this is drawn flat in a range this wide, in metres. 20 by default. */
  minSpanMeters?: number;
  /** Room above and below the line, as a share of the span; 0.06 by default. */
  verticalPadding?: number;
  /** «Start» and «Sosire» under the two ends, whose room the other labels leave alone. */
  endWords?: { start: string; finish: string } | null;
  /** The pin heads: their radius in the box's units (a third of `textSize`'s double by default). */
  pinRadius?: number;
  /** A small picture: no marker labels, at most two altitude ticks, only the highest extreme. */
  compact?: boolean;
};

/** The round steps an altitude scale is cut in, metres. */
export const ALTITUDE_STEPS: readonly number[] = [10, 25, 50, 100, 200, 500, 1000, 2000, 5000];

/** The distance between two kilometre ticks for a route this long (§NNN): 1 km up to 12, 2 km up to 25, 5 km beyond. */
export function kmStep(totalKm: number): number {
  return totalKm <= 12 ? 1 : totalKm <= 25 ? 2 : 5;
}

/** The round altitudes inside `[low, high]`, at most `count` of them, in the smallest step that keeps within that. */
export function niceAltitudes(low: number, high: number, count: number): number[] {
  if (count < 1 || !(high > low)) return [];
  let best: number[] = [];
  for (const step of ALTITUDE_STEPS) {
    const values: number[] = [];
    for (let value = Math.ceil(low / step) * step; value <= high + 1e-9; value += step) values.push(Math.round(value * 1000) / 1000 + 0); // + 0: a rounded −0.0004 is −0, which prints as «-0»
    best = values;
    if (values.length <= count) return values;
  }
  return best.slice(0, count);
}

/** The altitude of a profile at a share (0 to 1) of its length, by linear interpolation between its points. */
export function altitudeAtShare(profile: Pick<ElevationProfileData, "points" | "distanceMeters">, share: number): number {
  const { points } = profile;
  const target = Math.min(1, Math.max(0, share)) * points[points.length - 1][0];
  for (let i = 1; i < points.length; i++) {
    const [m0, a0] = points[i - 1];
    const [m1, a1] = points[i];
    if (target <= m1) return m1 === m0 ? a1 : a0 + ((a1 - a0) * (target - m0)) / (m1 - m0);
  }
  return points[points.length - 1][1];
}

const round = (value: number): number => Math.round(value * 100) / 100;

/** The line or the area as SVG path data — what an SVG draws; a PDF takes the points as they are. */
export function pathOf(points: readonly ElevationPoint[], closed = false): string {
  const body = points.map(([x, y], i) => `${i === 0 ? "M" : "L"}${round(x)} ${round(y)}`).join(" ");
  return closed ? `${body} Z` : body;
}

type Span = { from: number; to: number };

export function elevationGeometry(profile: ElevationProfileData, markers: readonly ElevationMarkerInput[], options: ElevationOptions): ElevationGeometry {
  const { width, height, textSize, minGap } = options;
  const compact = options.compact === true;
  const mirrored = options.orientation === "mirrored";
  const charEm = options.charEm ?? 0.6;
  const textWidth = (text: string): number => text.length * textSize * charEm;
  const flipX = (x: number): number => (mirrored ? width - x : x);

  const inset = { top: options.inset?.top ?? 0, right: options.inset?.right ?? 0, bottom: options.inset?.bottom ?? 0, left: options.inset?.left ?? 0 };
  // The plot, in normal reading order first; mirrored flips it below.
  const normal = { left: inset.left, right: Math.max(inset.left + 1, width - inset.right), top: inset.top, bottom: Math.max(inset.top + 1, height - inset.bottom) };
  const plot = mirrored ? { ...normal, left: width - normal.right, right: width - normal.left } : normal;
  const plotWidth = normal.right - normal.left;
  const plotHeight = normal.bottom - normal.top;
  const distance = options.distanceMeters !== undefined && options.distanceMeters > 0 ? options.distanceMeters : profile.distanceMeters;
  const profileEnd = profile.points[profile.points.length - 1][0] || 1;

  // The altitude range.
  const altitudes = profile.points.map((point) => point[1]);
  const lowest = Math.min(...altitudes);
  const highest = Math.max(...altitudes);
  const minSpan = options.minSpanMeters ?? 20;
  const span = highest - lowest;
  const padding = options.verticalPadding ?? 0.06;
  const range =
    span < minSpan
      ? { min: (lowest + highest) / 2 - minSpan / 2, max: (lowest + highest) / 2 + minSpan / 2 }
      : { min: lowest - span * padding, max: highest + span * padding };
  const yOf = (altitude: number): number => normal.bottom - ((altitude - range.min) / (range.max - range.min)) * plotHeight;
  const xOfShare = (share: number): number => flipX(normal.left + Math.min(1, Math.max(0, share)) * plotWidth);

  // The line and the area.
  const line: ElevationPoint[] = profile.points.map(([meters, altitude]) => [round(xOfShare(meters / profileEnd)), round(yOf(altitude))]);
  const area: ElevationPoint[] = [...line, [line[line.length - 1][0], round(normal.bottom)], [line[0][0], round(normal.bottom)]];

  // The foot row's baseline: under the plot, inside the box.
  const labelGap = textSize * 0.4;
  const footY = round(Math.min(height - textSize * 0.2, normal.bottom + labelGap + textSize * 0.8));

  // Spans already taken in the foot row: the end words first, then the marker labels, then the kilometres.
  const taken: Span[] = [];
  const touches = (box: Span): boolean => taken.some((other) => box.from < other.to + minGap && box.to > other.from - minGap);
  const boxOf = (label: ElevationLabel): Span => {
    const w = textWidth(label.text);
    return label.anchor === "start" ? { from: label.x, to: label.x + w } : label.anchor === "end" ? { from: label.x - w, to: label.x } : { from: label.x - w / 2, to: label.x + w / 2 };
  };
  /** A label centred on `x`, anchored to an end instead where the centred one would leave the box. */
  const centred = (x: number, text: string, y: number): ElevationLabel => {
    const half = textWidth(text) / 2;
    if (x - half < 0) return { x: round(Math.max(0, x)), y, text, anchor: "start" };
    if (x + half > width) return { x: round(Math.min(width, x)), y, text, anchor: "end" };
    return { x: round(x), y, text, anchor: "middle" };
  };

  // The end words.
  let endWords: ElevationGeometry["endWords"] = null;
  if (options.endWords) {
    const left: ElevationLabel = { x: round(plot.left), y: footY, text: mirrored ? options.endWords.finish : options.endWords.start, anchor: "start" };
    const right: ElevationLabel = { x: round(plot.right), y: footY, text: mirrored ? options.endWords.start : options.endWords.finish, anchor: "end" };
    endWords = mirrored ? { start: right, finish: left } : { start: left, finish: right };
    taken.push(boxOf(left), boxOf(right));
  }

  // The markers: the point on the line, its glyph, its pin head's row, and its label where there is room.
  const pinRadius = options.pinRadius ?? textSize * 0.6;
  const pinGap = pinRadius * 0.5;
  const rowStep = pinRadius * 2 + pinGap;
  const maxRows = Math.max(1, Math.floor((normal.top - pinGap) / rowStep));
  const placed = markers.map((marker, index) => {
    const share = distance > 0 ? Math.min(1, Math.max(0, (marker.km * 1000) / distance)) : 0;
    return { marker, index, share, x: xOfShare(share), y: yOf(altitudeAtShare(profile, share)) };
  });
  const rows: { x: number }[][] = [];
  const rowOf = new Map<number, number>();
  for (const item of [...placed].sort((a, b) => a.x - b.x || a.index - b.index)) {
    let row = 0;
    // The lowest row where no head stands within a head's reach; where all the rows are taken, the one with the most room.
    let roomiest = { row: 0, room: -1 };
    for (; row < maxRows; row++) {
      const room = Math.min(Infinity, ...(rows[row] ?? []).map((other) => Math.abs(other.x - item.x)));
      if (room >= pinRadius * 2 + pinGap) break;
      if (room > roomiest.room) roomiest = { row, room };
    }
    const chosen = row < maxRows ? row : roomiest.row;
    (rows[chosen] ??= []).push({ x: item.x });
    rowOf.set(item.index, chosen);
  }
  const pinRows = Math.max(1, rows.length);

  // Marker labels, left to right: kept unless they touch the end words or a label kept before.
  const labelOf = new Map<number, ElevationLabel>();
  if (!compact) {
    for (const item of [...placed].sort((a, b) => a.x - b.x || a.index - b.index)) {
      const text = item.marker.label;
      if (!text) continue;
      const label = centred(item.x, text, footY);
      const box = boxOf(label);
      if (touches(box)) continue;
      taken.push(box);
      labelOf.set(item.index, label);
    }
  }
  const markerOut: ElevationMarker[] = placed.map((item) => {
    const row = rowOf.get(item.index) ?? 0;
    return {
      index: item.index,
      x: round(item.x),
      y: round(item.y),
      glyph: glyphForKinds(item.marker.kinds),
      headX: round(item.x),
      headY: round(Math.max(pinRadius, normal.top - pinGap - pinRadius - row * rowStep)),
      raised: row,
      label: labelOf.get(item.index) ?? null,
      tickTo: round(normal.bottom),
    };
  });

  // The extremes, placed before the kilometre scale so that, with `clearExtremes`, the kilometres give way to a label in the foot row.
  const extremes: ElevationGeometry["extremes"] = [];
  if (options.extremes) {
    const gap = options.minAltitudeGapMeters ?? 20;
    const place = (kind: "min" | "max", altitude: number) => {
      const [x, y] = line[altitudes.indexOf(altitude)];
      const text = options.format.altitude(altitude);
      // The highest above its point, the lowest under it; the other side where the first would leave the box.
      let baseline = kind === "max" ? y - labelGap : y + labelGap + textSize * 0.8;
      if (baseline - textSize < 0) baseline = y + labelGap + textSize * 0.8;
      else if (baseline > height) baseline = y - labelGap;
      const label = centred(x, text, round(baseline));
      if (options.clearExtremes === true && baseline > normal.bottom) {
        // In the foot row: clear of the end words, the marker labels and what was kept before — or not drawn at all.
        const box = boxOf(label);
        if (touches(box)) return;
        taken.push(box);
      }
      extremes.push({ kind, x, y, label });
    };
    place("max", highest);
    if (!compact && highest - lowest >= gap) place("min", lowest);
  }

  // The kilometre scale.
  const kmTicks: ElevationGeometry["kmTicks"] = [];
  const kmLabels: ElevationLabel[] = [];
  let kmUnit: ElevationLabel | null = null;
  if (options.kmScale !== false && distance > 0) {
    const totalKm = distance / 1000;
    const step = kmStep(totalKm);
    const keptBoxes: Span[] = [];
    for (let km = 0; km <= totalKm + 1e-9; km += step) {
      const x = round(xOfShare((km * 1000) / distance));
      kmTicks.push({ x, km });
      const label = centred(x, options.format.km(km), footY);
      const box = boxOf(label);
      if (touches(box)) continue;
      taken.push(box);
      keptBoxes.push(box);
      kmLabels.push(label);
    }
    if (options.kmUnit && kmLabels.length > 0) {
      const last = mirrored ? keptBoxes.reduce((a, b) => (b.from < a.from ? b : a)) : keptBoxes.reduce((a, b) => (b.to > a.to ? b : a));
      const unit: ElevationLabel = mirrored
        ? { x: round(last.from - textSize * 0.3), y: footY, text: options.kmUnit, anchor: "end" }
        : { x: round(last.to + textSize * 0.3), y: footY, text: options.kmUnit, anchor: "start" };
      // The word is kept clear of everything but the label it follows: that one it stands beside on purpose.
      const box = boxOf(unit);
      const crowded = taken.some((other) => other !== last && box.from < other.to + minGap && box.to > other.from - minGap);
      if (box.from >= 0 && box.to <= width && !crowded) kmUnit = unit;
    }
  }

  // The altitude ticks.
  const altitudeTicks: ElevationGeometry["altitudeTicks"] = [];
  const wanted = Math.min(options.altitudeTicks ?? 0, compact ? 2 : Infinity);
  if (wanted > 0) {
    let count = wanted;
    let values = niceAltitudes(range.min, range.max, count);
    // Fewer ticks while any two labels would touch: a tick takes a line of text, and the plot is only so tall.
    while (values.length > 1 && (plotHeight * (values[1] - values[0])) / (range.max - range.min) < textSize * 1.5 && count > 1) {
      count -= 1;
      values = niceAltitudes(range.min, range.max, count);
    }
    for (const value of values) {
      const y = round(yOf(value));
      altitudeTicks.push({
        y,
        altitude: value,
        label: {
          x: round(mirrored ? plot.right + labelGap : plot.left - labelGap),
          y: round(y + textSize * 0.35),
          text: options.format.altitude(value),
          anchor: mirrored ? "start" : "end",
        },
        gridFrom: round(plot.left),
        gridTo: round(plot.right),
      });
    }
  }

  return {
    width,
    height,
    plot: { left: round(plot.left), right: round(plot.right), top: round(plot.top), bottom: round(plot.bottom) },
    orientation: mirrored ? "mirrored" : "normal",
    distanceMeters: distance,
    altitude: { min: round(range.min), max: round(range.max) },
    line,
    area,
    kmTicks,
    kmLabels,
    kmUnit,
    altitudeTicks,
    extremes,
    markers: markerOut,
    pinRadius: round(pinRadius),
    pinRows,
    endWords,
  };
}
