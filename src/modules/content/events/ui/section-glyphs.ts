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
import SubjectIcon from "@mui/icons-material/Subject";
import TitleIcon from "@mui/icons-material/Title";
import type { SvgIconProps } from "@mui/material/SvgIcon";
import type { ComponentType } from "react";
import type { PageSectionGlyph } from "@/modules/events/domain/page-sections";

/**
 * One glyph per event-page section for the editor's map (§406), looked up by name
 * (`PageSectionGlyph`) so no element crosses from a Server Component (`AGENTS.md` §14.1, §370).
 * Backoffice only; one file per glyph, never the barrel (§90).
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
  startList: FormatListNumberedIcon,
};
