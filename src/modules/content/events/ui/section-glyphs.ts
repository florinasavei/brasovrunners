import CalendarMonthIcon from "@mui/icons-material/CalendarMonth";
import CategoryIcon from "@mui/icons-material/Category";
import FormatListNumberedIcon from "@mui/icons-material/FormatListNumbered";
import GavelIcon from "@mui/icons-material/Gavel";
import HandshakeIcon from "@mui/icons-material/Handshake";
import HowToRegIcon from "@mui/icons-material/HowToReg";
import LinkIcon from "@mui/icons-material/Link";
import PaymentsIcon from "@mui/icons-material/Payments";
import PlaceIcon from "@mui/icons-material/Place";
import RouteIcon from "@mui/icons-material/Route";
import ScheduleIcon from "@mui/icons-material/Schedule";
import ShareIcon from "@mui/icons-material/Share";
import SmartDisplayIcon from "@mui/icons-material/SmartDisplay";
import SubjectIcon from "@mui/icons-material/Subject";
import TitleIcon from "@mui/icons-material/Title";
import type { SvgIconProps } from "@mui/material/SvgIcon";
import type { ComponentType } from "react";
import type { PageSectionGlyph } from "@/modules/events/domain/page-sections";

/**
 * The event page's sections as the editor's map draws them (§NNN), one glyph per section, looked
 * up **by name** (`PageSectionGlyph`): the list in `events/domain/page-sections.ts` names a picture
 * without importing one, and the map is a client island that makes the element itself, so no
 * element crosses from a Server Component (`AGENTS.md` §14.1, §370). The backoffice's only: no
 * public page imports this. One file per glyph, never the barrel (§90); the same pictures the
 * public page's facts use where it has one — the calendar, the pin, the route, the money, the handshake.
 */
export const SECTION_GLYPHS: Record<PageSectionGlyph, ComponentType<SvgIconProps>> = {
  kind: CategoryIcon,
  title: TitleIcon,
  description: SubjectIcon,
  when: CalendarMonthIcon,
  place: PlaceIcon,
  course: RouteIcon,
  cost: PaymentsIcon,
  registration: HowToRegIcon,
  partner: HandshakeIcon,
  share: ShareIcon,
  links: LinkIcon,
  programme: ScheduleIcon,
  rules: GavelIcon,
  video: SmartDisplayIcon,
  startList: FormatListNumberedIcon,
};
