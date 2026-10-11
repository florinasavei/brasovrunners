import DirectionsRunIcon from "@mui/icons-material/DirectionsRun";
import EmojiPeopleIcon from "@mui/icons-material/EmojiPeople";
import EventAvailableIcon from "@mui/icons-material/EventAvailable";
import GroupsIcon from "@mui/icons-material/Groups";
import LocalCafeIcon from "@mui/icons-material/LocalCafe";
import MoneyOffIcon from "@mui/icons-material/MoneyOff";
import PlaceIcon from "@mui/icons-material/Place";
import TerrainIcon from "@mui/icons-material/Terrain";
import WavingHandIcon from "@mui/icons-material/WavingHand";
import type { SvgIconProps } from "@mui/material/SvgIcon";
import type { ComponentType } from "react";
import type { StepGlyph } from "../domain/steps";
import type { WhyGlyph } from "../domain/why";

/**
 * The home page's glyphs, by name (§714; §318, §521, §694): the five steps of «Prima dată» and the
 * four reasons of «De ce». The domain names them (`STEP_GLYPHS`, `WHY_GLYPHS`); this table is the one
 * place the icon files are imported, one file per glyph, never the barrel (§90), and the sections —
 * Server Components — draw them on the server, so no element ever crosses into a client component
 * (§370). The filled Material family, like every glyph of the site (decision 11).
 *
 * A registry of its own, listed in `ICON_REGISTRIES` (`tests/unit/design/guards-allowlist.ts`), and
 * not the public `GLYPHS` table: a name added there ships to every public chip island (§694, §707),
 * and these are drawn by the home page alone.
 */
export type HomeGlyph = StepGlyph | WhyGlyph;

export const HOME_GLYPHS: Record<HomeGlyph, ComponentType<SvgIconProps>> = {
  // «Prima dată»: the calendar, the meeting place, a hello, the run, the coffee after.
  calendar: EventAvailableIcon,
  place: PlaceIcon,
  hello: WavingHandIcon,
  run: DirectionsRunIcon,
  coffee: LocalCafeIcon,
  // «De ce»: together, the mountains around the city, no fee, everyone welcome.
  together: GroupsIcon,
  mountains: TerrainIcon,
  free: MoneyOffIcon,
  everyone: EmojiPeopleIcon,
};
