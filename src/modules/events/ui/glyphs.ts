import AltRouteIcon from "@mui/icons-material/AltRoute";
import DirectionsRunIcon from "@mui/icons-material/DirectionsRun";
import GroupsIcon from "@mui/icons-material/Groups";
import HikingIcon from "@mui/icons-material/Hiking";
import LocalCafeIcon from "@mui/icons-material/LocalCafe";
import LocationCityIcon from "@mui/icons-material/LocationCity";
import MoneyOffIcon from "@mui/icons-material/MoneyOff";
import PaidIcon from "@mui/icons-material/Paid";
import SignalCellularAltIcon from "@mui/icons-material/SignalCellularAlt";
import SignalCellularAlt1BarIcon from "@mui/icons-material/SignalCellularAlt1Bar";
import SignalCellularAlt2BarIcon from "@mui/icons-material/SignalCellularAlt2Bar";
import SportsScoreIcon from "@mui/icons-material/SportsScore";
import StarIcon from "@mui/icons-material/Star";
import TerrainIcon from "@mui/icons-material/Terrain";
import type { EventSurface, EventType } from "../domain/event-type";

/** An icon component, named from one of them so the barrel is never imported (§90). */
export type Glyph = typeof DirectionsRunIcon;

/**
 * One glyph per closed set the event page and the listing show as a word (`DECISIONS.md`
 * §112; the owner: "I also need icons for event type, surfaces, etc … these pills should have
 * icons"). The word stays the label — a glyph alone is a riddle, and a screen reader hears the
 * word — the glyph is what the eye finds first on a chip or a card. One file per glyph from
 * `@mui/icons-material` (§90), never the whole barrel.
 *
 * The choices are metaphors, so they are written down: a race is the chequered flag, not a
 * trophy (every runner finishes a race, few win one); asphalt is the city, trail the mountain,
 * mixed the fork in the path; difficulty is one, two or three bars — the shape a phone's signal
 * uses for "how much", which needs no legend; cost is a coin, crossed out when there is none.
 */
export const TYPE_GLYPH: Record<EventType, Glyph> = {
  GROUP_RUN: DirectionsRunIcon,
  RACE: SportsScoreIcon,
  HIKE: HikingIcon,
  COFFEE: LocalCafeIcon,
  MEETUP: GroupsIcon,
};

export const SURFACE_GLYPH: Record<EventSurface, Glyph> = {
  ASPHALT: LocationCityIcon,
  TRAIL: TerrainIcon,
  MIXED: AltRouteIcon,
};

export const DIFFICULTY_GLYPH: Record<"EASY" | "MODERATE" | "HARD", Glyph> = {
  EASY: SignalCellularAlt1BarIcon,
  MODERATE: SignalCellularAlt2BarIcon,
  HARD: SignalCellularAltIcon,
};

export const COST_GLYPH: Record<"FREE" | "PAID", Glyph> = {
  FREE: MoneyOffIcon,
  PAID: PaidIcon,
};

/**
 * Every glyph by a name a Server Component can hand to `GlyphChip`: `type:RACE`,
 * `surface:TRAIL`, `difficulty:EASY`, `cost:FREE`, and `featured` for the hero's star.
 */
export const GLYPHS = {
  ...prefixed("type", TYPE_GLYPH),
  ...prefixed("surface", SURFACE_GLYPH),
  ...prefixed("difficulty", DIFFICULTY_GLYPH),
  ...prefixed("cost", COST_GLYPH),
  featured: StarIcon,
};

export type GlyphName = keyof typeof GLYPHS;

function prefixed<P extends string, K extends string>(prefix: P, record: Record<K, Glyph>) {
  return Object.fromEntries(Object.entries(record).map(([key, glyph]) => [`${prefix}:${key}`, glyph])) as Record<
    `${P}:${K}`,
    Glyph
  >;
}
