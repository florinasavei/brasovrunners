import AccountCircleIcon from "@mui/icons-material/AccountCircle";
import ArrowDownwardIcon from "@mui/icons-material/ArrowDownward";
import ArrowUpwardIcon from "@mui/icons-material/ArrowUpward";
import AssignmentIndIcon from "@mui/icons-material/AssignmentInd";
import CheckCircleIcon from "@mui/icons-material/CheckCircle";
import ConstructionIcon from "@mui/icons-material/Construction";
import DeleteForeverIcon from "@mui/icons-material/DeleteForever";
import DoNotDisturbIcon from "@mui/icons-material/DoNotDisturb";
import DrawIcon from "@mui/icons-material/Draw";
import ErrorOutlinedIcon from "@mui/icons-material/ErrorOutlined";
import EventBusyIcon from "@mui/icons-material/EventBusy";
import EventRepeatIcon from "@mui/icons-material/EventRepeat";
import EventSeatIcon from "@mui/icons-material/EventSeat";
import FamilyRestroomIcon from "@mui/icons-material/FamilyRestroom";
import FlagIcon from "@mui/icons-material/Flag";
import GroupsIcon from "@mui/icons-material/Groups";
import HelpIcon from "@mui/icons-material/Help";
import HistoryIcon from "@mui/icons-material/History";
import HourglassTopIcon from "@mui/icons-material/HourglassTop";
import HowToRegIcon from "@mui/icons-material/HowToReg";
import LinkIcon from "@mui/icons-material/Link";
import LockClockIcon from "@mui/icons-material/LockClock";
import ManageAccountsIcon from "@mui/icons-material/ManageAccounts";
import NoAccountsIcon from "@mui/icons-material/NoAccounts";
import PostAddIcon from "@mui/icons-material/PostAdd";
import MarkEmailUnreadIcon from "@mui/icons-material/MarkEmailUnread";
import PriorityHighIcon from "@mui/icons-material/PriorityHigh";
import ReceiptLongIcon from "@mui/icons-material/ReceiptLong";
import RemoveIcon from "@mui/icons-material/Remove";
import ScheduleIcon from "@mui/icons-material/Schedule";
import ScienceIcon from "@mui/icons-material/Science";
import StarIcon from "@mui/icons-material/Star";
import StorefrontIcon from "@mui/icons-material/Storefront";
import SwapHorizIcon from "@mui/icons-material/SwapHoriz";
import TimerOffIcon from "@mui/icons-material/TimerOff";
import TranslateIcon from "@mui/icons-material/Translate";
import VolunteerActivismIcon from "@mui/icons-material/VolunteerActivism";
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
  // An order's count on a product, an order the club placed for a member (§707).
  orders: ReceiptLongIcon,
  club: GroupsIcon,
  // The shop's product page, a team member's links, a repeated event's count (§113).
  shop: StorefrontIcon,
  // The first picture of a product, its cover (§707). The public table had `featured` — the star on the lead event's chip — until
  // §470 was amended (the lead card wears its frame and no chip): a name no public file draws leaves that table.
  cover: StarIcon,
  link: LinkIcon,
  series: EventRepeatIcon,
  // An event's own to-do's priority (§749): a word and a glyph, never the colour alone.
  priorityUrgent: PriorityHighIcon,
  priorityHigh: ArrowUpwardIcon,
  priorityNormal: RemoveIcon,
  priorityLow: ArrowDownwardIcon,
  // A role a volunteer offered to do (§761): «S-a oferit pentru» on the «Voluntari» card.
  offered: VolunteerActivismIcon,
  // A role the organizers gave a volunteer (§837): «Roluri date» on the same row, one chip per role.
  given: AssignmentIndIcon,
  // «A mai fost voluntar» on the same row (§765): what the person did before, not what they offer now.
  experience: HistoryIcon,
  // «Vrea pe lista publică» on a volunteer's row (§821): the person's wish to be named, not the fact that the page names them — that takes the
  // club's tick, the notice and a confirmation.
  wantsList: HowToRegIcon,
  // A guardian's address that is the volunteer's own (§768): a family on one address, marked on the card, never refused.
  family: FamilyRestroomIcon,
  // A visitor's message in the outbox (§778): a message nobody carried; one that left by the other road; its words kept
  // until it leaves, and gone.
  failed: ErrorOutlinedIcon,
  otherRoad: SwapHorizIcon,
  wordsKept: LockClockIcon,
  wordsGone: DeleteForeverIcon,
  // A runner's race that did not end in a time (§808): did not start, dropped out. A disqualified runner wears `failed`.
  didNotStart: DoNotDisturbIcon,
  droppedOut: FlagIcon,
  // A person's line on «Echipa» (§842): their role (the glyph «Schimbă rolul» wears), the reader's own row («Tu»), and an address
  // on the list with no sign-in account behind it (§288).
  role: ManageAccountsIcon,
  self: AccountCircleIcon,
  noAccount: NoAccountsIcon,
  // A legal text's version a newer one replaced, «Înlocuită»; and «Șablon nou», the platform's template newer than the text in force —
  // the picture «Regenerează din șablon» wears (§NNN, /admin/legal's rows).
  superseded: HistoryIcon,
  newTemplate: PostAddIcon,
  // A registration's state (§NNN, `registrations/ui/RegistrationStatusChip.tsx`): the address to confirm, the declaration to sign,
  // the waiting line, a place offered from it (the seat the «Dă-i un loc» verb wears), the deadline that passed — `done` and
  // `cancelled` above for the confirmed and the cancelled. And a demonstration row (§30), the flask the «Test» card wears.
  awaitingEmail: MarkEmailUnreadIcon,
  awaitingSignature: DrawIcon,
  waitlisted: HourglassTopIcon,
  placeOffered: EventSeatIcon,
  expired: TimerOffIcon,
  test: ScienceIcon,
  // «Prezent la …» on the desk's row: the person-with-tick the «Marchează prezent» verb wears.
  checkedIn: HowToRegIcon,
} satisfies Record<string, ComponentType<SvgIconProps>>;

export type StatusGlyphName = keyof typeof STATUS_GLYPHS;
