import AltRouteIcon from "@mui/icons-material/AltRoute";
import AutoAwesomeIcon from "@mui/icons-material/AutoAwesome";
import DirectionsRunIcon from "@mui/icons-material/DirectionsRun";
import EventRepeatIcon from "@mui/icons-material/EventRepeat";
import FlashlightOnIcon from "@mui/icons-material/FlashlightOn";
import GroupsIcon from "@mui/icons-material/Groups";
import HandshakeIcon from "@mui/icons-material/Handshake";
import HikingIcon from "@mui/icons-material/Hiking";
import LocalCafeIcon from "@mui/icons-material/LocalCafe";
import MoneyOffIcon from "@mui/icons-material/MoneyOff";
import OpenInNewIcon from "@mui/icons-material/OpenInNew";
import PaidIcon from "@mui/icons-material/Paid";
import ScienceIcon from "@mui/icons-material/Science";
import SportsScoreIcon from "@mui/icons-material/SportsScore";
import StarIcon from "@mui/icons-material/Star";
import StraightenIcon from "@mui/icons-material/Straighten";
import TerrainIcon from "@mui/icons-material/Terrain";
import TrendingUpIcon from "@mui/icons-material/TrendingUp";
import VolunteerActivismIcon from "@mui/icons-material/VolunteerActivism";
import type { SvgIconProps } from "@mui/material/SvgIcon";
import type { ComponentType } from "react";
import type { EventSurface, EventType } from "../domain/event-type";
import { EASY_DIFFICULTY_ICON, HARD_DIFFICULTY_ICON, MODERATE_DIFFICULTY_ICON } from "./DifficultyIcon";
import RoadIcon from "./RoadIcon";

/** An icon component — Material's, or one drawn here (`RoadIcon`); the barrel is never imported (§90). */
export type Glyph = ComponentType<SvgIconProps>;

/**
 * One glyph per closed set the event page and the listing show as a word (`DECISIONS.md`
 * §112; the owner: "I also need icons for event type, surfaces, etc … these pills should have
 * icons"). The word stays the label — a glyph alone is a riddle, and a screen reader hears the
 * word — the glyph is what the eye finds first on a chip or a card. One file per glyph from
 * `@mui/icons-material` (§90), never the whole barrel.
 *
 * The choices are metaphors, so they are written down: a race is the chequered flag, not a
 * trophy (every runner finishes a race, few win one); a gear test is the flask (something is
 * being tried); "other event" is a group of people; an external event opens elsewhere;
 * asphalt is a road (drawn here — Material has none without a mark on it), trail the mountain,
 * mixed the fork in the path; difficulty is a scale of dumbbells, one through three of them lit
 * (§NNN; the owner, 2026-09-25, of the phone-signal bars this replaces: "I want also for the
 * difficulty to have a better icon system, like weights or something" — drawn in `DifficultyIcon.tsx`);
 * cost is a coin, crossed out when there is none, or a hand holding a heart for a donation — the
 * platform takes none of the three itself.
 */
export const TYPE_GLYPH: Record<EventType, Glyph> = {
  GROUP_RUN: DirectionsRunIcon,
  RACE: SportsScoreIcon,
  HIKE: HikingIcon,
  COFFEE: LocalCafeIcon,
  GEAR_TEST: ScienceIcon,
  MEETUP: GroupsIcon,
  EXTERNAL: OpenInNewIcon,
};

export const SURFACE_GLYPH: Record<EventSurface, Glyph> = {
  ASPHALT: RoadIcon,
  TRAIL: TerrainIcon,
  MIXED: AltRouteIcon,
};

export const DIFFICULTY_GLYPH: Record<"EASY" | "MODERATE" | "HARD", Glyph> = {
  EASY: EASY_DIFFICULTY_ICON,
  MODERATE: MODERATE_DIFFICULTY_ICON,
  HARD: HARD_DIFFICULTY_ICON,
};

export const COST_GLYPH: Record<"FREE" | "PAID" | "DONATION", Glyph> = {
  FREE: MoneyOffIcon,
  PAID: PaidIcon,
  DONATION: VolunteerActivismIcon,
};

/**
 * Every glyph by a name a Server Component can hand to `GlyphChip`: `type:RACE`,
 * `surface:TRAIL`, `difficulty:EASY`, `cost:FREE`, `featured` for the hero's star,
 * `special` for an edition apart (§168), `series` for a repeated event's count (§113), and
 * `distance` and `elevation` for the two numbers of a route (§356).
 *
 * The star is taken: it is the one event the site leads with. A special edition is the
 * sparkle beside it — "this one is not an ordinary Wednesday" — which is a different claim
 * from "read this one first", and any number of events may make it.
 *
 * The two numbers are metaphors too, written down like the rest: the distance is a ruler, the
 * climb a line that rises — the calendar entry writes the same climb with "↗" (`ical.ts`). They
 * exist because the event page's route became a row of pills (§356), and a pill with no glyph
 * beside three that have one was exactly the "some with a glyph, some without" the owner
 * pointed at.
 *
 * `partner` marks an event held with another organization, on the listing card's chip, the
 * calendar entry, the event page's overline and the facts' "Împreună cu" row (§168): Material's
 * `Handshake` glyph everywhere (§NNN, reverting §379/§386's 🤝 emoji — the owner, 2026-09-25:
 * "wow shit handshake icon is super ugly! Use the MUI icon ASAP", of the emoji rendered through
 * a grayscale filter, which read as a dark smudge rather than a desaturated hand). Drawn with no
 * colour of its own, so it takes `currentColor` from wherever it sits — the chip's icon ink, the
 * overline's `text.secondary`, a filled calendar entry's `primary.contrastText` — the way every
 * other glyph in this registry already does; no filter, no dark-scheme override.
 *
 * `headlamp` is a torch that is lit (§382; the owner, 2026-09-25: "a headlamp icon for the events
 * that require a headlamp"): Material has no headlamp, and a lit torch is the nearest single-file
 * glyph that says "bring a light" rather than "it is night" (a moon would read as the time, not
 * the kit). Always beside its word, "Frontală" / "Headlamp", like every other pill.
 *
 * There is no bare `difficulty` entry: every caller reads one value's own level, so only the
 * three `difficulty:*` entries below exist — `DifficultyIcon.tsx`'s own drawing, Material's
 * `FitnessCenterIcon` path repeated one through three times lit, one `<svg>` each so
 * `GlyphChip`'s clone and its `.MuiChip-icon` sizing see exactly what every other glyph here
 * hands them (fix round, finding 2 — a bare `FitnessCenterIcon` registration had no caller).
 */
export const GLYPHS = {
  ...prefixed("type", TYPE_GLYPH),
  ...prefixed("surface", SURFACE_GLYPH),
  ...prefixed("difficulty", DIFFICULTY_GLYPH),
  ...prefixed("cost", COST_GLYPH),
  featured: StarIcon,
  special: AutoAwesomeIcon,
  series: EventRepeatIcon,
  distance: StraightenIcon,
  elevation: TrendingUpIcon,
  headlamp: FlashlightOnIcon,
  partner: HandshakeIcon,
};

export type GlyphName = keyof typeof GLYPHS;

function prefixed<P extends string, K extends string>(prefix: P, record: Record<K, Glyph>) {
  return Object.fromEntries(Object.entries(record).map(([key, glyph]) => [`${prefix}:${key}`, glyph])) as Record<
    `${P}:${K}`,
    Glyph
  >;
}
