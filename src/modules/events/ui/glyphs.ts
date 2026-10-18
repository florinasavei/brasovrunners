import AltRouteIcon from "@mui/icons-material/AltRoute";
import AutoAwesomeIcon from "@mui/icons-material/AutoAwesome";
import AutorenewIcon from "@mui/icons-material/Autorenew";
import CardMembershipIcon from "@mui/icons-material/CardMembership";
import CheckCircleIcon from "@mui/icons-material/CheckCircle";
import DirectionsIcon from "@mui/icons-material/Directions";
import DirectionsRunIcon from "@mui/icons-material/DirectionsRun";
import EventAvailableIcon from "@mui/icons-material/EventAvailable";
import EventBusyIcon from "@mui/icons-material/EventBusy";
import GroupsIcon from "@mui/icons-material/Groups";
import HandshakeIcon from "@mui/icons-material/Handshake";
import HikingIcon from "@mui/icons-material/Hiking";
import LeaderboardIcon from "@mui/icons-material/Leaderboard";
import LocalCafeIcon from "@mui/icons-material/LocalCafe";
import LocalOfferIcon from "@mui/icons-material/LocalOffer";
import MedicalServicesIcon from "@mui/icons-material/MedicalServices";
import ModeNightIcon from "@mui/icons-material/ModeNight";
import MoneyOffIcon from "@mui/icons-material/MoneyOff";
import OpenInNewIcon from "@mui/icons-material/OpenInNew";
import PaidIcon from "@mui/icons-material/Paid";
import PersonOutlinedIcon from "@mui/icons-material/PersonOutlined";
import RestaurantIcon from "@mui/icons-material/Restaurant";
import ScheduleIcon from "@mui/icons-material/Schedule";
import ScienceIcon from "@mui/icons-material/Science";
import SportsScoreIcon from "@mui/icons-material/SportsScore";
import StraightenIcon from "@mui/icons-material/Straighten";
import TerrainIcon from "@mui/icons-material/Terrain";
import TimerIcon from "@mui/icons-material/Timer";
import TrendingUpIcon from "@mui/icons-material/TrendingUp";
import TuneIcon from "@mui/icons-material/Tune";
import VolunteerActivismIcon from "@mui/icons-material/VolunteerActivism";
import WaterDropIcon from "@mui/icons-material/WaterDrop";
import type { SvgIconProps } from "@mui/material/SvgIcon";
import type { ComponentType } from "react";
import type { CheckpointKind } from "@/modules/event-checkpoints/domain/checkpoint";
import type { EventSurface, EventType } from "../domain/event-type";
import { DIFFICULTY_ICONS, DIFFICULTY_LEVEL_ICONS } from "./difficulty-glyphs";
import { TIER_GLYPH } from "./tier-glyphs";
import type { DifficultyBand } from "../domain/difficulty";
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
 * mixed the fork in the path; difficulty is a gauge, its needle in one of five bands and, since
 * §526 (the owner's «ușor, mediu, greuț, greu, foarte greu»), at one of three steps inside it, the
 * step as dots (§412: "un gauge icon custom mai degrabă", replacing §399's scale of weights — drawn
 * in `DifficultyGaugeIcon.tsx`);
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

/** One gauge per band, mapped over `DIFFICULTY_BANDS` in `difficulty-glyphs.ts` — a band added
 * there is registered here with no edit of its own. */
export const DIFFICULTY_GLYPH: Record<DifficultyBand, Glyph> = DIFFICULTY_ICONS;

export const COST_GLYPH: Record<"FREE" | "PAID" | "DONATION", Glyph> = {
  FREE: MoneyOffIcon,
  PAID: PaidIcon,
  DONATION: VolunteerActivismIcon,
};

/**
 * What a checkpoint has (§757), one metaphor each, written down: water is a drop, food the cutlery,
 * first aid the medical case, timing the stopwatch, direction the road sign with its arrow (§770).
 * Always beside the word — «Apă», «Mâncare», «Direcționare» —
 * on the event page's table (`EventCheckpoints`); never the glyph alone.
 */
export const CHECKPOINT_GLYPH: Record<CheckpointKind, Glyph> = {
  WATER: WaterDropIcon,
  FOOD: RestaurantIcon,
  FIRST_AID: MedicalServicesIcon,
  TIMING: TimerIcon,
  DIRECTION: DirectionsIcon,
};

/**
 * Every glyph by a name a Server Component can hand to `GlyphChip`: `type:RACE`,
 * `surface:TRAIL`, `difficulty:EASY`, `cost:FREE`,
 * `special` for an edition apart (§168), and
 * `distance` and `elevation` for the two numbers of a route (§356).
 *
 * A special edition is the sparkle — "this one is not an ordinary Wednesday" — and any number of events may
 * wear it. (The lead event wears no chip: its frame says it, §470 amended.)
 *
 * The two numbers are metaphors too, written down like the rest: the distance is a ruler, the
 * climb a line that rises — the calendar entry writes the same climb with "↗" (`ical.ts`). They
 * exist because the event page's route became a row of pills (§356), and a pill with no glyph
 * beside three that have one was exactly the "some with a glyph, some without" the owner
 * pointed at.
 *
 * `partner` marks an event held with another organization, on the listing card's chip, the
 * calendar entry, the event page's overline and the facts' "Împreună cu" row (§168): Material's
 * `Handshake` glyph everywhere (§391, reverting §379/§386's 🤝 emoji — the owner, 2026-09-25:
 * "wow shit handshake icon is super ugly! Use the MUI icon ASAP", of the emoji rendered through
 * a grayscale filter, which read as a dark smudge rather than a desaturated hand). Drawn with no
 * colour of its own, so it takes `currentColor` from wherever it sits — the chip's icon ink, the
 * overline's `text.secondary`, a filled calendar entry's `primary.contrastText` — the way every
 * other glyph in this registry already does; no filter, no dark-scheme override.
 *
 * `night` is a crescent moon (§428, replacing §382's lit torch; the owner, 2026-09-26: "change that
 * flashlight icon"). The torch was chosen when the pill was a stored "Necesită frontală" — the kit
 * to bring. Since §394 the pill is computed from the sun and says a fact about the date, «Noapte»,
 * and a moon is what reads as the time rather than the kit. Material's `ModeNight`, one file, not
 * `DarkMode`: that crescent-in-a-disc is the header's light/dark switch (`ThemeModeToggle`), and
 * one picture meaning two things on one screen is what §318 refused. Always beside its word,
 * «Noapte» / «Night», like every other pill.
 *
 * There is no bare `difficulty` entry: every caller reads one value's own band or level, so only
 * the `difficulty:*` entries exist — one per band of `DIFFICULTY_BANDS` (`difficulty:MEDIUM`, the
 * needle at the band's middle, §412: a filter box, the editor's band select) and one per level of
 * the club's scale of fifteen (`difficulty:MEDIUM-3`, the needle at the step and the step's dots
 * lit, §526: an event's own pill) — a half-dial drawn by `DifficultyGaugeIcon.tsx`, one `<svg>` each
 * so `GlyphChip`'s clone and its `.MuiChip-icon` sizing see exactly what every other glyph here
 * hands them.
 */
export const GLYPHS = {
  ...prefixed("type", TYPE_GLYPH),
  ...prefixed("surface", SURFACE_GLYPH),
  ...prefixed("difficulty", DIFFICULTY_GLYPH),
  ...prefixed("difficulty", DIFFICULTY_LEVEL_ICONS),
  ...prefixed("cost", COST_GLYPH),
  ...prefixed("checkpoint", CHECKPOINT_GLYPH),
  // A member's level (§811), the club's pick from a closed set: `tier:star`, `tier:medal`… (`tier-glyphs.ts`).
  ...prefixed("tier", TIER_GLYPH),
  special: AutoAwesomeIcon,
  // The repeat chip on a listing card (§486) — the single date of a series, the series card and
  // the featured card alike: a wheel of arrows, «ca o rotiță» (the owner), not the calendar
  // glyph the backoffice's `series` chip draws (`status-glyphs.ts`), which reads as one more date at 16–20 pixels.
  repeat: AutorenewIcon,
  distance: StraightenIcon,
  elevation: TrendingUpIcon,
  night: ModeNightIcon,
  // The club's discount on an external event's own fee (§394): a price tag, under the cost row.
  discount: LocalOfferIcon,
  partner: HandshakeIcon,
  // «Doar pentru membrii BVR» (§552): the members' card, the glyph «Pagini» → «Membri» already wears
  // (§524) — only on the members' own page, the zone and the backoffice, never on a public surface.
  membersOnly: CardMembershipIcon,
  // The filter button's own glyph (§413) — a tuning icon, not the funnel `FilterListIcon`, and
  // "registration open" among the filter's boxes (§413): a calendar with a tick, the same
  // metaphor a confirmed place gets elsewhere.
  filters: TuneIcon,
  registration: EventAvailableIcon,
  // «Mai multe» on a team card's fold (§701): the person, what the fold holds more of — the fold's
  // own arrow already says "this opens" (`disclosure.ts`), so never a second chevron here.
  person: PersonOutlinedIcon,
  // The members' zone's order chip (`members-area/MembersShop.tsx`, public) draws these three; the
  // backoffice draws them through `StatusChip` from its own table (BOTH_SURFACES in the tripwire, §707).
  done: CheckCircleIcon,
  cancelled: EventBusyIcon,
  planned: ScheduleIcon,
  // «Toate evenimentele» on the calendar's kind chips (`KindChips.tsx`, public); the backoffice's «placed by the club» chip draws it through `StatusChip` (§707).
  club: GroupsIcon,
  // «Clasament» on a finished race's card (§809): a ranked list, the way the results are drawn — not a trophy, which says one winner
  // where the table has every finisher (the chequered flag is the race itself, above). Always beside its word.
  results: LeaderboardIcon,
  // «N vin» on an upcoming turn-up event's card (§812): the group of people the page's own count «Vin (N)» draws (`RsvpCount`) — the
  // same glyph for the same number. Always beside its word.
  coming: GroupsIcon,
};

export type GlyphName = keyof typeof GLYPHS;

function prefixed<P extends string, K extends string>(prefix: P, record: Record<K, Glyph>) {
  return Object.fromEntries(Object.entries(record).map(([key, glyph]) => [`${prefix}:${key}`, glyph])) as Record<
    `${P}:${K}`,
    Glyph
  >;
}
