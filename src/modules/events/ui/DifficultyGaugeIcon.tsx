"use client";

import Box from "@mui/material/Box";
import SvgIcon, { type SvgIconProps } from "@mui/material/SvgIcon";
import { DIFFICULTY_LEVELS } from "../domain/difficulty";

/**
 * The difficulty as a gauge (§NNN; the owner, 2026-09-25: "vreau să fie foarte ușor, ușor, mediu,
 * greu și foarte greu — sau un gauge icon custom mai degrabă"), replacing §399's scale of
 * weights. One half-dial on the same 24-unit grid as every other glyph (`RoadIcon`), one
 * `<svg>` — what `GlyphChip`'s clone and `.MuiChip-icon`'s sizing expect — and one icon-width
 * wide, where §399's scale was one icon-width per level and five would have been five.
 *
 * `"use client"` because each faint segment reads the theme through an `sx` callback, and a
 * function cannot cross from a Server Component to MUI's client `Box`; the registry's
 * `difficulty-glyphs.ts` (no directive) is what a Server Component imports.
 *
 * The dial is `DIFFICULTY_LEVELS.length` arc segments from left (the easiest) to right (the
 * hardest), with a needle from the hub to the middle of the level's own segment. The segments up
 * to the level are in the chip's own ink (`currentColor`, inherited — no colour written here); the
 * rest are faint, at `theme.palette.action.disabledOpacity` (MUI's own 0.38, the fraction a
 * disabled control already uses), so neither scheme needs a value of its own. The needle is what
 * says the level; the lit arc says it twice, which is what keeps it legible at a pill's 18 px.
 *
 * `aria-hidden` like every glyph in the registry (§112): the pill's word and its visually-hidden
 * `srSuffix` (`route-pills.ts`, `GlyphChip`) are what a screen reader hears, never the needle.
 *
 * One component reading a `level` prop: the registry's `difficulty:*` entries are mapped over
 * `DIFFICULTY_LEVELS` in `difficulty-glyphs.ts`, a module with no `"use client"` of its own, so a
 * Server Component (`EventFacts`) can read one by name — a record exported from *this* client
 * module would reach the server as a client reference it cannot dot into.
 */

const CENTRE_X = 12;
const CENTRE_Y = 19;
const RADIUS = 9.5;
const ARC_WIDTH = 3;
const NEEDLE_LENGTH = 7.5;
const HUB_RADIUS = 2;
/** Degrees left blank at each end of a segment, so five read as five and not one arc. */
const GAP = 3;
const SEGMENT = 180 / DIFFICULTY_LEVELS.length;

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

/** The needle's angle for a level: the middle of the level's own segment. */
export function needleAngle(level: number) {
  return 180 - (level - 0.5) * SEGMENT;
}

export default function DifficultyGaugeIcon({ level, ...props }: SvgIconProps & { level: number }) {
  if (!Number.isInteger(level) || level < 1 || level > DIFFICULTY_LEVELS.length) {
    throw new RangeError(`DifficultyGaugeIcon: level ${level} is outside 1..${DIFFICULTY_LEVELS.length}`);
  }
  const tip = at(needleAngle(level), NEEDLE_LENGTH);
  return (
    <SvgIcon {...props} viewBox="0 0 24 24" data-testid="difficulty-gauge" data-level={level}>
      {DIFFICULTY_LEVELS.map((name, index) => {
        const on = index < level;
        return (
          <Box
            key={name}
            component="path"
            d={segmentPath(index + 1)}
            fill="none"
            stroke="currentColor"
            strokeWidth={ARC_WIDTH}
            data-testid={on ? "difficulty-gauge-on" : "difficulty-gauge-off"}
            sx={on ? undefined : { opacity: (theme) => theme.palette.action.disabledOpacity }}
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
    </SvgIcon>
  );
}
