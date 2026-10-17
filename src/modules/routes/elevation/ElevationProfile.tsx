import Box from "@mui/material/Box";
import ElevationPointer, { type PointerChart } from "./ElevationPointer";
import { elevationGeometry, type ElevationGeometry, type ElevationMarkerInput, pathOf } from "./geometry";
import { ELEVATION_GLYPH_PATHS, GLYPH_EVEN_ODD } from "./glyphs";
import type { ElevationProfileData } from "./parse";
import { fill } from "./pointer";
import { VISUALLY_HIDDEN } from "@/shared/ui/visually-hidden";

/**
 * The route's elevation profile as a picture (§802, amending §718 and §757; the owner, 2026-10-16: «I would like to have a
 * widget actually! And read it from the GPX»): the one chart of the event page and of the editor's «Puncte de control»
 * preview, drawn from `geometry.ts` — the same core the race number's strip draws from.
 *
 * A **Server Component** with plain-data props: the profile (`parse.ts`), the checkpoints to draw (the caller has already
 * left out the ones the club unticked), the words as the catalogue's templates (`Event.profile`) and the language.
 * Everything is inline SVG: the area under the line in the theme's primary at a light tint and the line in primary
 * (CSS variables, so both looks — «Tema v1», «Tema v2» — and both colour schemes follow, and the line is held at AA
 * against the page by the theme, the tint being only a wash), the altitude axis at the left with its «Alt» caption and a
 * faint grid, the kilometre axis at the foot with «km» once after the last label, and the checkpoints as **pins** — an
 * accent head in a band above the plot, the kind's glyph in the head (`glyphs.ts`; no MUI icon inside an SVG; a point that
 * offers food and water pins the fork, the drop being implied — the owner, 2026-10-17), the point's name as the pin's
 * `<title>`, and — on the page's two charts — **a dotted vertical line from the pin down to the kilometre axis at the
 * point's exact kilometre** (the owner, 2026-10-17: «a dotted vertical line across the chart to show exactly where these
 * points are»), drawn under the curve and its tint, with the small dot where it meets the line. A pin is never the only way
 * to learn a point: the visually hidden list under the chart names each, and the table «Puncte de control» says what it offers.
 *
 * **Three sizes for the page** (`variant: "page"`), the one that fits shown by CSS alone — a single viewBox would scale its
 * labels with the screen, 11 px on a phone and 30 px on a desktop — and each **spanning the section's whole width** (the
 * event page's container is the theme's `xl`, 2040 px, less 16 px gutters under 600 px and 24 px above; the chart is `width:
 * 100%` of it, with no cap beyond the phone's): a narrow chart (360 × 240, labels 14 units, 11 px at a 320 px phone, capped at
 * 480 px), a wide one (1000 × 280, labels 19 units, from 700 px of screen: 12.4 px at 700, 20 px at 1099) and a full one
 * (1600 × 320, labels 19 units, from 1100 px: 12.5 px at 1100, 14.6 px at 1280, 22.2 px at 1920, 23.7 px at the container's
 * cap). The frames are fixed so that the labels stay between 12 and 24 px across the screens; a frame as wide as the
 * screen would need the width measured in the browser, which a Server Component cannot do. Each is decided by the core
 * for its own box, so the labels dropped by crowding on the phone are the phone's. `variant: "compact"` is the editor's
 * preview: one small chart (300 × 160, labels 17 units: 11.6 px in the editor's card at a 320 px phone, where the chart is about
 * 204 px wide), the core's compact mode (no marker words, two altitude ticks, no dotted lines). The race number's strip does not
 * draw from this component: it draws from the same core in its own units (§804) and is unchanged by every line above.
 * The page's chart is wrapped in the pointer island (`ElevationPointer`, which reads the point under a finger or key); the
 * preview is not interactive.
 *
 * Roles: the SVG is `role="img"` with «Profilul traseului: 9,0 km, de la 608 la 828 m»; the island's wrapper is a group
 * whose label says the arrow keys work. Without scripts the static chart stands as it is.
 */

/** The words, as the catalogue's templates (`Event.profile`): `{placeholders}` are filled here, never in the caller. */
export type ElevationProfileWords = {
  alt: string;
  km: string;
  start: string;
  finish: string;
  label: string;
  points: string;
  point: string;
  readout: string;
  readoutNamed: string;
  pointer: string;
};

/** One checkpoint to draw: the club's kilometre, what it offers, and its name in the page's language. */
export type ElevationProfileMarker = { km: number; kinds: readonly string[]; name: string };

type Frame = { width: number; height: number; textSize: number; altitudeTicks: number };

/** The boxes the charts are drawn in, and their label sizes (see the component's note on the three sizes). */
const FRAMES = {
  narrow: { width: 360, height: 240, textSize: 14, altitudeTicks: 4 },
  wide: { width: 1000, height: 280, textSize: 19, altitudeTicks: 5 },
  full: { width: 1600, height: 320, textSize: 19, altitudeTicks: 5 },
  compact: { width: 300, height: 160, textSize: 17, altitudeTicks: 2 },
} as const satisfies Record<string, Frame>;

/** The screen width, in CSS pixels, from which the wide chart is shown instead of the narrow one. */
const WIDE_FROM_PX = 700;
/** The screen width, in CSS pixels, from which the full chart is shown instead of the wide one. */
const FULL_FROM_PX = 1100;

/** The geometry of one chart: passes until the room it leaves — the band of pin rows above, the width of the altitude labels at the left — is the room its own result needed. */
function chartOf(
  frame: Frame,
  profile: ElevationProfileData,
  distanceMeters: number,
  markers: readonly ElevationProfileMarker[],
  words: ElevationProfileWords,
  locale: string,
  compact: boolean,
): ElevationGeometry {
  const whole = new Intl.NumberFormat(locale, { maximumFractionDigits: 0, useGrouping: false });
  const textSize = frame.textSize;
  const unitWidth = textSize * 0.6 * words.km.length;
  const widestAltitude = Math.max(whole.format(profile.minAltitude).length, whole.format(profile.maxAltitude).length);
  const widestKm = whole.format(Math.floor(distanceMeters / 1000)).length;
  const radius = textSize * 0.75;
  const gap = radius / 2;
  const rowStep = radius * 2 + gap;
  const input: ElevationMarkerInput[] = markers.map((marker) => ({ km: marker.km, kinds: marker.kinds, label: null }));
  const leftFor = (digits: number) => Math.ceil(digits * textSize * 0.6 + textSize * 0.4 + 4);
  const options = (top: number, left: number) => ({
    width: frame.width,
    height: frame.height,
    inset: {
      top,
      left,
      // Room for the last kilometre label's right half, the gap and the unit word.
      right: Math.ceil((widestKm * textSize * 0.6) / 2 + textSize * 0.3 + unitWidth + 3),
      bottom: Math.ceil(textSize * 1.5 + 4),
    },
    textSize,
    minGap: textSize * 0.4,
    format: { km: (km: number) => whole.format(km), altitude: (meters: number) => whole.format(meters) },
    kmUnit: words.km,
    altitudeTicks: frame.altitudeTicks,
    distanceMeters,
    pinRadius: radius,
    compact,
    // The page's chart and the editor's preview: food implies water, so a point with both pins the fork (the race number's strip keeps its glyphs).
    foodBeforeWater: true,
  });
  // Without pins the top holds the «Alt» caption's line (the page's charts), so the caption never meets the highest altitude label.
  const topFor = (rows: number) => (markers.length === 0 ? Math.ceil(textSize * (compact ? 0.8 : 1.7)) : Math.ceil(gap + rows * rowStep + 1));
  // The altitude labels are the round values the core drew — a top tick one digit longer than the route's highest («1000» over a 990 m summit) is common — so the left room follows them.
  const leftOf = (drawn: ElevationGeometry) => leftFor(Math.max(...drawn.altitudeTicks.map((tick) => tick.label.text.length)));
  let top = topFor(3);
  let left = leftFor(widestAltitude);
  let drawn = elevationGeometry(profile, input, options(top, left));
  for (let pass = 0; pass < 3; pass++) {
    const nextTop = topFor(drawn.pinRows);
    const nextLeft = drawn.altitudeTicks.length > 0 ? leftOf(drawn) : left;
    if (nextTop === top && nextLeft === left) break;
    top = nextTop;
    left = nextLeft;
    drawn = elevationGeometry(profile, input, options(top, left));
  }
  return drawn;
}

const INK = { fill: "currentColor" } as const;

/** One chart's SVG. `size` names it for the CSS that shows the right one and for the pointer island that finds it. */
function ProfileSvg({
  geometry,
  size,
  label,
  markers,
  words,
  sx,
}: {
  geometry: ElevationGeometry;
  size: "narrow" | "wide" | "full" | "compact";
  label: string;
  markers: readonly ElevationProfileMarker[];
  words: ElevationProfileWords;
  sx: object;
}) {
  const g = geometry;
  const textSize = FRAMES[size].textSize;
  const stroke = size === "wide" || size === "full" ? 3 : 2.5;
  const glyphScale = (g.pinRadius * 0.66) / 7.5;
  // The dotted guides (the page's charts only): one per kilometre drawn, from the base of the highest pin standing there down to the axis.
  const guides = new Map<number, number>();
  if (size !== "compact") for (const pin of g.markers) guides.set(pin.x, Math.min(guides.get(pin.x) ?? Infinity, Math.round((pin.headY + g.pinRadius) * 100) / 100));
  return (
    <Box
      component="svg"
      viewBox={`0 0 ${g.width} ${g.height}`}
      role="img"
      aria-label={label}
      data-size={size}
      data-testid="elevation-chart"
      sx={{ display: "block", width: "100%", height: "auto", color: "text.secondary", ...sx }}
      style={{ fontFamily: "inherit", fontSize: textSize }}
    >
      {g.altitudeTicks.map((tick) => (
        <line key={`grid-${tick.altitude}`} x1={tick.gridFrom} x2={tick.gridTo} y1={tick.y} y2={tick.y} style={{ stroke: "var(--mui-palette-divider)" }} strokeWidth={1} />
      ))}
      {[...guides].map(([x, from]) => (
        <line
          key={`guide-${x}`}
          data-testid="elevation-guide"
          x1={x}
          x2={x}
          y1={from}
          y2={g.plot.bottom}
          strokeWidth={1.25}
          strokeDasharray="1.5 3.5"
          style={{ stroke: "var(--mui-palette-text-secondary)" }}
        />
      ))}
      <path d={pathOf(g.area, true)} style={{ fill: "var(--mui-palette-primary-main)", fillOpacity: 0.16 }} />
      <path d={pathOf(g.line)} fill="none" strokeLinejoin="round" strokeLinecap="round" strokeWidth={stroke} style={{ stroke: "var(--mui-palette-primary-main)" }} />
      <line x1={g.plot.left} x2={g.plot.right} y1={g.plot.bottom} y2={g.plot.bottom} style={{ stroke: "var(--mui-palette-text-secondary)" }} strokeWidth={1} />
      {g.kmTicks.map((tick) => (
        <line key={`tick-${tick.km}`} x1={tick.x} x2={tick.x} y1={g.plot.bottom} y2={g.plot.bottom + 4} style={{ stroke: "var(--mui-palette-text-secondary)" }} strokeWidth={1} />
      ))}
      {g.altitudeTicks.map((tick) => (
        <text key={`alt-${tick.altitude}`} x={tick.label.x} y={tick.label.y} textAnchor={tick.label.anchor} {...INK}>
          {tick.label.text}
        </text>
      ))}
      {g.kmLabels.map((label) => (
        <text key={`km-${label.text}`} x={label.x} y={label.y} textAnchor={label.anchor} {...INK}>
          {label.text}
        </text>
      ))}
      {g.kmUnit && (
        <text x={g.kmUnit.x} y={g.kmUnit.y} textAnchor={g.kmUnit.anchor} {...INK}>
          {g.kmUnit.text}
        </text>
      )}
      {size !== "compact" && (
        <text x={0} y={textSize} textAnchor="start" fontWeight={600} {...INK}>
          {words.alt}
        </text>
      )}
      {g.markers.map((pin) => (
        <g key={pin.index} data-testid="elevation-pin" data-glyph={pin.glyph}>
          <title>{markers[pin.index].name}</title>
          {/* The preview has no dotted guide, so its pin keeps the short stem down to the curve. */}
          {size === "compact" && <line x1={pin.headX} x2={pin.x} y1={pin.headY + g.pinRadius} y2={pin.y} strokeWidth={1.25} style={{ stroke: "var(--mui-palette-text-secondary)" }} />}
          <circle cx={pin.x} cy={pin.y} r={3.2} strokeWidth={1.25} style={{ fill: "var(--mui-palette-secondary-main)", stroke: "var(--mui-palette-text-primary)" }} />
          <circle cx={pin.headX} cy={pin.headY} r={g.pinRadius} strokeWidth={1.25} style={{ fill: "var(--mui-palette-secondary-main)", stroke: "var(--mui-palette-text-primary)" }} />
          <path
            d={ELEVATION_GLYPH_PATHS[pin.glyph]}
            transform={`translate(${pin.headX} ${pin.headY}) scale(${glyphScale.toFixed(3)})`}
            fillRule={GLYPH_EVEN_ODD[pin.glyph] ? "evenodd" : "nonzero"}
            style={{ fill: "var(--mui-palette-secondary-contrastText)" }}
          />
        </g>
      ))}
    </Box>
  );
}

export default function ElevationProfile({
  variant,
  profile,
  distanceMeters,
  markers,
  locale,
  words,
}: {
  variant: "page" | "compact";
  profile: ElevationProfileData;
  /** The route's length the club typed, in metres, or null/absent for the track's own: the plot spans it, and the pins' kilometres are measured on it. */
  distanceMeters?: number | null;
  /** The checkpoints to draw — the caller has left out the ones unticked — by distance. */
  markers: readonly ElevationProfileMarker[];
  locale: "ro" | "en";
  words: ElevationProfileWords;
}) {
  const distance = distanceMeters && distanceMeters > 0 ? distanceMeters : profile.distanceMeters;
  const oneDecimal = new Intl.NumberFormat(locale, { minimumFractionDigits: 1, maximumFractionDigits: 1 });
  const whole = new Intl.NumberFormat(locale, { maximumFractionDigits: 0, useGrouping: false });
  const label = fill(words.label, { km: oneDecimal.format(distance / 1000), low: whole.format(profile.minAltitude), high: whole.format(profile.maxAltitude) });

  // The picture's own list for a screen reader, outside the SVG: the start, each pin by distance, the finish.
  const kmWords = new Intl.NumberFormat(locale, { maximumFractionDigits: 2 });
  const list = (
    <Box component="ul" aria-label={words.points} data-testid="elevation-points" sx={VISUALLY_HIDDEN}>
      <li>{fill(words.point, { name: words.start, km: kmWords.format(0) })}</li>
      {markers.map((marker, index) => (
        <li key={index}>{fill(words.point, { name: marker.name, km: kmWords.format(marker.km) })}</li>
      ))}
      <li>{fill(words.point, { name: words.finish, km: kmWords.format(distance / 1000) })}</li>
    </Box>
  );

  if (variant === "compact") {
    const geometry = chartOf(FRAMES.compact, profile, distance, markers, words, locale, true);
    return (
      <Box component="figure" data-testid="elevation-profile" data-variant="compact" data-pins={markers.length} sx={{ m: 0, maxWidth: FRAMES.compact.width, position: "relative" }}>
        <ProfileSvg geometry={geometry} size="compact" label={label} markers={markers} words={words} sx={{}} />
        {list}
      </Box>
    );
  }

  const narrow = chartOf(FRAMES.narrow, profile, distance, markers, words, locale, false);
  const wide = chartOf(FRAMES.wide, profile, distance, markers, words, locale, false);
  const full = chartOf(FRAMES.full, profile, distance, markers, words, locale, false);
  const frame = (g: ElevationGeometry, size: "narrow" | "wide" | "full"): PointerChart => ({
    size,
    viewWidth: g.width,
    viewHeight: g.height,
    plotLeft: g.plot.left,
    plotRight: g.plot.right,
    plotTop: g.plot.top,
    plotBottom: g.plot.bottom,
    altitudeMin: g.altitude.min,
    altitudeMax: g.altitude.max,
  });
  // The one chart that fits, by CSS alone: narrow under 700 px, wide from 700 up to the full one's 1100, full beyond.
  const fromWide = `@media (min-width:${WIDE_FROM_PX}px)`;
  const wideRange = `@media (min-width:${WIDE_FROM_PX}px) and (max-width:${FULL_FROM_PX - 0.05}px)`;
  const fromFull = `@media (min-width:${FULL_FROM_PX}px)`;
  return (
    <Box component="figure" data-testid="elevation-profile" data-variant="page" data-pins={markers.length} sx={{ m: 0 }}>
      <ElevationPointer
        charts={[frame(narrow, "narrow"), frame(wide, "wide"), frame(full, "full")]}
        points={profile.points}
        distanceMeters={distance}
        markers={markers.map((marker) => ({ km: marker.km, name: marker.name }))}
        locale={locale}
        words={{ readout: words.readout, readoutNamed: words.readoutNamed, hint: words.pointer }}
      >
        <ProfileSvg geometry={narrow} size="narrow" label={label} markers={markers} words={words} sx={{ maxWidth: 480, [fromWide]: { display: "none" } }} />
        <ProfileSvg geometry={wide} size="wide" label={label} markers={markers} words={words} sx={{ display: "none", [wideRange]: { display: "block" } }} />
        <ProfileSvg geometry={full} size="full" label={label} markers={markers} words={words} sx={{ display: "none", [fromFull]: { display: "block" } }} />
      </ElevationPointer>
      {list}
    </Box>
  );
}
