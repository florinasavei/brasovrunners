import AltRouteIcon from "@mui/icons-material/AltRoute";
import AutoAwesomeIcon from "@mui/icons-material/AutoAwesome";
import DirectionsRunIcon from "@mui/icons-material/DirectionsRun";
import EventRepeatIcon from "@mui/icons-material/EventRepeat";
import GroupsIcon from "@mui/icons-material/Groups";
import HikingIcon from "@mui/icons-material/Hiking";
import LocalCafeIcon from "@mui/icons-material/LocalCafe";
import MoneyOffIcon from "@mui/icons-material/MoneyOff";
import OpenInNewIcon from "@mui/icons-material/OpenInNew";
import PaidIcon from "@mui/icons-material/Paid";
import ScienceIcon from "@mui/icons-material/Science";
import SignalCellularAltIcon from "@mui/icons-material/SignalCellularAlt";
import SignalCellularAlt1BarIcon from "@mui/icons-material/SignalCellularAlt1Bar";
import SignalCellularAlt2BarIcon from "@mui/icons-material/SignalCellularAlt2Bar";
import SportsScoreIcon from "@mui/icons-material/SportsScore";
import StarIcon from "@mui/icons-material/Star";
import StraightenIcon from "@mui/icons-material/Straighten";
import TerrainIcon from "@mui/icons-material/Terrain";
import TrendingUpIcon from "@mui/icons-material/TrendingUp";
import VolunteerActivismIcon from "@mui/icons-material/VolunteerActivism";
import type { SvgIconProps } from "@mui/material/SvgIcon";
import type { ComponentType } from "react";
import type { EventSurface, EventType } from "../domain/event-type";
import PartnerEmoji from "./PartnerEmoji";
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
 * mixed the fork in the path; difficulty is one, two or three bars — the shape a phone's
 * signal uses for "how much", which needs no legend; cost is a coin, crossed out when there is
 * none, or a hand holding a heart for a donation — the platform takes none of the three itself.
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
  EASY: SignalCellularAlt1BarIcon,
  MODERATE: SignalCellularAlt2BarIcon,
  HARD: SignalCellularAltIcon,
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
 * calendar entry, the event page's overline and the facts' "Împreună cu" row (§168): the 🤝
 * emoji everywhere (§379, replacing the `Handshake` glyph §367 chose and §375 kept to one icon,
 * and the facts row's own copy of it — the owner hates the icon on every surface, not some).
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
  partner: PartnerEmoji as Glyph,
};

export type GlyphName = keyof typeof GLYPHS;

function prefixed<P extends string, K extends string>(prefix: P, record: Record<K, Glyph>) {
  return Object.fromEntries(Object.entries(record).map(([key, glyph]) => [`${prefix}:${key}`, glyph])) as Record<
    `${P}:${K}`,
    Glyph
  >;
}
