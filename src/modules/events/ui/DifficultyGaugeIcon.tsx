"use client";

import Box from "@mui/material/Box";
import SvgIcon, { type SvgIconProps } from "@mui/material/SvgIcon";
import { DIFFICULTY_BANDS, DIFFICULTY_STEPS } from "../domain/difficulty";

/**
 * The difficulty as a gauge (§412; the owner, 2026-09-25: "vreau să fie foarte ușor, ușor, mediu,
 * greu și foarte greu — sau un gauge icon custom mai degrabă"), replacing §399's scale of
 * weights. One half-dial on the same 24-unit grid as every other glyph (`RoadIcon`), one
 * `<svg>` — what `GlyphChip`'s clone and `.MuiChip-icon`'s sizing expect — and one icon-width
 * wide, where §399's scale was one icon-width per level and five would have been five.
 *
 * `"use client"` because each faint segment reads the theme through an `sx` callback, and a
 * function cannot cross from a Server Component to MUI's client `Box`; the registry's
 * `difficulty-glyphs.ts` (no directive) is what a Server Component imports.
 *
 * The dial is `DIFFICULTY_BANDS.length` arc segments from left (the easiest) to right (the
 * hardest), with a needle from the hub into the band's own segment. The segments up to the band
 * are in the chip's own ink (`currentColor`, inherited — no colour written here); the rest are
 * faint, at `theme.palette.action.disabledOpacity` (MUI's own 0.38, the fraction a disabled
 * control already uses), so neither scheme needs a value of its own.
 *
 * **Fifteen levels since §NNN** — five bands of three steps. `band` lights the segments; `step`
 * places the needle inside the band's own segment (its easier end, its middle, its harder end) and
 * lights that many of three dots under the hub — «Mediu, treapta 3» is three lit segments, the
 * needle at the right of the third, and three lit dots. Without a `step` (a filter box, the
 * editor's band select — a band, not a level) there are no dots and the needle stands at the
 * band's middle, where step 2 puts it.
 *
 * `aria-hidden` like every glyph in the registry (§112): the pill's word and its visually-hidden
 * `srSuffix` (`route-pills.ts`, `GlyphChip`) are what a screen reader hears, never the needle.
 *
 * One component reading a `band` (and a `step`): the registry's `difficulty:*` entries are mapped
 * over the bands and steps in `difficulty-glyphs.ts`, a module with no `"use client"` of its own,
 * so a Server Component (`EventFacts`) can read one by name — a record exported from *this* client
 * module would reach the server as a client reference it cannot dot into.
 */

const CENTRE_X = 12;
/** The hub, three units above §412's 19, so the step dots fit under it on the 24-unit grid. */
const CENTRE_Y = 16;
const RADIUS = 9.5;
const ARC_WIDTH = 3;
const NEEDLE_LENGTH = 7.5;
const HUB_RADIUS = 2;
/** Degrees left blank at each end of a segment, so five read as five and not one arc. */
const GAP = 3;
const SEGMENT = 180 / DIFFICULTY_BANDS.length;
/** The step dots: one row under the hub, the band's easier end on the left. */
const DOT_Y = 21.5;
const DOT_RADIUS = 1.3;
const DOT_SPACING = 5;

/** A point on a circle round the hub, at `degrees` measured from the right, counter-clockwise (180 is the dial's left end). */
function at(degrees: number, radius: number) {
  const radians = (degrees * Math.PI) / 180;
  const round = (value: number) => Math.round(value * 100) / 100;
  return { x: round(CENTRE_X + radius * Math.cos(radians)), y: round(CENTRE_Y - radius * Math.sin(radians)) };
}

/** The segment of the 1-based `index`, from the dial's left end clockwise over the top. */
function segmentPath(index: number) {
  const from = at(180 - (index - 1) * SEGMENT - GAP, RADIUS);
  const to = at(180 - index * SEGMENT + GAP, RADIUS);
  return `M${from.x} ${from.y}A${RADIUS} ${RADIUS} 0 0 1 ${to.x} ${to.y}`;
}

/**
 * The needle's angle: inside the band's own segment (the part the gaps leave drawn), at the middle
 * of the step's third of it — or at the segment's middle for a band with no step, where step 2 is.
 */
export function needleAngle(band: number, step?: number) {
  const drawn = SEGMENT - 2 * GAP;
  const within = step === undefined ? drawn / 2 : ((step - 0.5) * drawn) / DIFFICULTY_STEPS.length;
  return 180 - (band - 1) * SEGMENT - GAP - within;
}

type Opacity = { palette: { action: { disabledOpacity: number } } };
const FAINT = { opacity: (theme: Opacity) => theme.palette.action.disabledOpacity };

export default function DifficultyGaugeIcon({ band, step, ...props }: SvgIconProps & { band: number; step?: number }) {
  if (!Number.isInteger(band) || band < 1 || band > DIFFICULTY_BANDS.length) {
    throw new RangeError(`DifficultyGaugeIcon: band ${band} is outside 1..${DIFFICULTY_BANDS.length}`);
  }
  if (step !== undefined && (!Number.isInteger(step) || step < 1 || step > DIFFICULTY_STEPS.length)) {
    throw new RangeError(`DifficultyGaugeIcon: step ${step} is outside 1..${DIFFICULTY_STEPS.length}`);
  }
  const tip = at(needleAngle(band, step), NEEDLE_LENGTH);
  const levelData = step === undefined ? {} : { "data-step": step, "data-level": (band - 1) * DIFFICULTY_STEPS.length + step };
  return (
    <SvgIcon {...props} viewBox="0 0 24 24" data-testid="difficulty-gauge" data-band={band} {...levelData}>
      {DIFFICULTY_BANDS.map((name, index) => {
        const on = index < band;
        return (
          <Box
            key={name}
            component="path"
            d={segmentPath(index + 1)}
            fill="none"
            stroke="currentColor"
            strokeWidth={ARC_WIDTH}
            data-testid={on ? "difficulty-gauge-on" : "difficulty-gauge-off"}
            sx={on ? undefined : FAINT}
          />
        );
      })}
      <path
        data-testid="difficulty-gauge-needle"
        d={`M${CENTRE_X} ${CENTRE_Y}L${tip.x} ${tip.y}`}
        fill="none"
        stroke="currentColor"
        strokeWidth={2}
        strokeLinecap="round"
      />
      <circle cx={CENTRE_X} cy={CENTRE_Y} r={HUB_RADIUS} fill="currentColor" />
      {step === undefined
        ? null
        : DIFFICULTY_STEPS.map((dot) => (
            <Box
              key={dot}
              component="circle"
              cx={CENTRE_X + (dot - 2) * DOT_SPACING}
              cy={DOT_Y}
              r={DOT_RADIUS}
              fill="currentColor"
              data-testid={dot <= step ? "difficulty-step-on" : "difficulty-step-off"}
              sx={dot <= step ? undefined : FAINT}
            />
          ))}
    </SvgIcon>
  );
}
