import CheckCircleIcon from "@mui/icons-material/CheckCircle";
import ConstructionIcon from "@mui/icons-material/Construction";
import EventBusyIcon from "@mui/icons-material/EventBusy";
import EventRepeatIcon from "@mui/icons-material/EventRepeat";
import HelpIcon from "@mui/icons-material/Help";
import LinkIcon from "@mui/icons-material/Link";
import ScheduleIcon from "@mui/icons-material/Schedule";
import StorefrontIcon from "@mui/icons-material/Storefront";
import TranslateIcon from "@mui/icons-material/Translate";
import VisibilityIcon from "@mui/icons-material/Visibility";
import VisibilityOffIcon from "@mui/icons-material/VisibilityOff";
import type { SvgIconProps } from "@mui/material/SvgIcon";
import type { ComponentType } from "react";

/**
 * The glyphs of the backoffice's status chips, by name (§707, amending §694 and §521): a state's word with its
 * picture — a row shown or hidden on the site, a text in one language only, an order's or a plan's
 * step. `StatusChip` draws them. Kept apart from the public table (`modules/events/ui/glyphs.ts`,
 * drawn by `GlyphChip`) so a visitor never downloads an icon only the backoffice uses; `tests/unit/design/status-chip.test.ts` holds both tables to their own surfaces.
 * One file per glyph from `@mui/icons-material`, never the barrel (§90).
 */
export const STATUS_GLYPHS = {
  // The event that is over or called off, an order's steps, a plan's steps.
  done: CheckCircleIcon,
  cancelled: EventBusyIcon,
  open: HelpIcon,
  planned: ScheduleIcon,
  building: ConstructionIcon,
  // A row shown or hidden on the site; a text in one language only.
  visible: VisibilityIcon,
  hidden: VisibilityOffIcon,
  language: TranslateIcon,
  // The shop's product page, a team member's links, a repeated event's count (§113).
  shop: StorefrontIcon,
  link: LinkIcon,
  series: EventRepeatIcon,
} satisfies Record<string, ComponentType<SvgIconProps>>;

export type StatusGlyphName = keyof typeof STATUS_GLYPHS;
