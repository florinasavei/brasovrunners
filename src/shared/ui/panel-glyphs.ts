import AccessTimeIcon from "@mui/icons-material/AccessTime";
import AlternateEmailIcon from "@mui/icons-material/AlternateEmail";
import AnnouncementIcon from "@mui/icons-material/Announcement";
import BarChartIcon from "@mui/icons-material/BarChart";
import BrushIcon from "@mui/icons-material/Brush";
import CampaignIcon from "@mui/icons-material/Campaign";
import CardMembershipIcon from "@mui/icons-material/CardMembership";
import CategoryIcon from "@mui/icons-material/Category";
import CheckroomIcon from "@mui/icons-material/Checkroom";
import ConfirmationNumberIcon from "@mui/icons-material/ConfirmationNumber";
import ContactMailIcon from "@mui/icons-material/ContactMail";
import ContentCopyIcon from "@mui/icons-material/ContentCopy";
import DataUsageIcon from "@mui/icons-material/DataUsage";
import DateRangeIcon from "@mui/icons-material/DateRange";
import DeleteSweepIcon from "@mui/icons-material/DeleteSweep";
import DrawIcon from "@mui/icons-material/Draw";
import EventIcon from "@mui/icons-material/Event";
import EventRepeatIcon from "@mui/icons-material/EventRepeat";
import FilterAltIcon from "@mui/icons-material/FilterAlt";
import FlagIcon from "@mui/icons-material/Flag";
import GavelIcon from "@mui/icons-material/Gavel";
import GroupAddIcon from "@mui/icons-material/GroupAdd";
import GroupsIcon from "@mui/icons-material/Groups";
import HandshakeIcon from "@mui/icons-material/Handshake";
import HelpOutlineIcon from "@mui/icons-material/HelpOutlineOutlined";
import HistoryIcon from "@mui/icons-material/History";
import HourglassTopIcon from "@mui/icons-material/HourglassTop";
import HowToRegIcon from "@mui/icons-material/HowToReg";
import HubIcon from "@mui/icons-material/Hub";
import ImageIcon from "@mui/icons-material/Image";
import LinkIcon from "@mui/icons-material/Link";
import ListAltIcon from "@mui/icons-material/ListAlt";
import MailIcon from "@mui/icons-material/Mail";
import MapIcon from "@mui/icons-material/Map";
import MedicalServicesIcon from "@mui/icons-material/MedicalServices";
import NewspaperIcon from "@mui/icons-material/Newspaper";
import NotificationsActiveIcon from "@mui/icons-material/NotificationsActive";
import NotesIcon from "@mui/icons-material/Subject";
import OutboxIcon from "@mui/icons-material/Outbox";
import PaidIcon from "@mui/icons-material/Paid";
import FormatSizeIcon from "@mui/icons-material/FormatSize";
import PaletteIcon from "@mui/icons-material/Palette";
import PaymentsIcon from "@mui/icons-material/Payments";
import PersonAddIcon from "@mui/icons-material/PersonAdd";
import PhoneIcon from "@mui/icons-material/Phone";
import PlaceIcon from "@mui/icons-material/Place";
import PrintIcon from "@mui/icons-material/Print";
import PublicIcon from "@mui/icons-material/Public";
import ReorderIcon from "@mui/icons-material/Reorder";
import RouteIcon from "@mui/icons-material/Route";
import RuleIcon from "@mui/icons-material/Rule";
import SaveIcon from "@mui/icons-material/Save";
import ScheduleIcon from "@mui/icons-material/Schedule";
import ScheduleSendIcon from "@mui/icons-material/ScheduleSend";
import ScienceIcon from "@mui/icons-material/Science";
import ShareIcon from "@mui/icons-material/Share";
import SpeedIcon from "@mui/icons-material/Speed";
import StorageIcon from "@mui/icons-material/Storage";
import TaskAltIcon from "@mui/icons-material/TaskAlt";
import TimerIcon from "@mui/icons-material/Timer";
import TitleIcon from "@mui/icons-material/Title";
import TranslateIcon from "@mui/icons-material/Translate";
import UpdateIcon from "@mui/icons-material/Update";
import type { SvgIconProps } from "@mui/material/SvgIcon";
import type { ComponentType } from "react";

/**
 * A backoffice box's glyph, by name (§521; the owner, 2026-09-27: a glyph on every button and
 * every fold header).
 *
 * `action-icons.ts` names **verbs** — what a button does. A box names a **subject** — what is
 * inside it: the course, the costs, the outbox — so its pictures are a table of their own, and a
 * verb's glyph and a subject's never have to agree on one name. Where a subject is the thing a
 * verb acts on, the two share the picture (the bibs are the ticket on both, printing is the
 * printer), so the screen reads as one system.
 *
 * **Read by `Panel` alone, and `Panel` is a Server Component** that no client file imports
 * (`tests/unit/shared/glyph-on-every-button-and-fold.test.ts` holds it): the lookup by name
 * happens on the server and only the drawn `<svg>` reaches the browser, so this table costs a
 * visitor nothing and the backoffice nothing but the paths it draws. One file per glyph, never
 * the barrel (§90). Every glyph is `aria-hidden` beside a heading that already says the subject.
 */
export const PANEL_GLYPHS = {
  // The event editor's boxes, in the page's order (§406).
  publication: PublicIcon,
  recurrence: EventRepeatIcon,
  help: HelpOutlineIcon,
  map: MapIcon,
  status: FlagIcon,
  kind: CategoryIcon,
  title: TitleIcon,
  description: NotesIcon,
  when: EventIcon,
  timezone: AccessTimeIcon,
  address: PlaceIcon,
  course: RouteIcon,
  cost: PaymentsIcon,
  programme: ScheduleIcon,
  rules: RuleIcon,
  declaration: DrawIcon,
  links: LinkIcon,
  partners: HandshakeIcon,
  registration: HowToRegIcon,
  window: DateRangeIcon,
  confirmation: TaskAltIcon,
  reminder: NotificationsActiveIcon,
  bibs: ConfirmationNumberIcon,
  // «Kit de participare» (§554): what the runners are handed — for now, the T-shirt.
  kit: CheckroomIcon,
  // «Condiții de participare» (§557): what the form asks beyond the person — for now, the health note.
  conditions: MedicalServicesIcon,
  bibDesign: BrushIcon,
  print: PrintIcon,
  startList: GroupsIcon,
  promotion: ShareIcon,
  save: SaveIcon,
  // What an event's registrations are, once it has them.
  registrations: ListAltIcon,
  queue: HourglassTopIcon,
  thanks: MailIcon,
  test: ScienceIcon,
  copy: ContentCopyIcon,
  summary: BarChartIcon,
  filters: FilterAltIcon,
  // Mail.
  outbox: OutboxIcon,
  forecast: ScheduleSendIcon,
  compose: CampaignIcon,
  history: HistoryIcon,
  email: MailIcon,
  contacts: ContactMailIcon,
  shownAddress: AlternateEmailIcon,
  publicPhone: PhoneIcon,
  notices: AnnouncementIcon,
  plan: CardMembershipIcon,
  transport: HubIcon,
  deadlines: TimerIcon,
  newsletter: NewspaperIcon,
  // The club and the platform.
  legal: GavelIcon,
  // «Versiuni șterse» (§567): the versions taken off the list, their text kept — the swept bin.
  deletedVersions: DeleteSweepIcon,
  invite: PersonAddIcon,
  members: GroupAddIcon,
  appearance: PaletteIcon,
  textSize: FormatSizeIcon,
  costs: PaidIcon,
  database: StorageIcon,
  budget: SpeedIcon,
  limits: DataUsageIcon,
  jobs: UpdateIcon,
  pictures: ImageIcon,
  translation: TranslateIcon,
  // «Ordinea meniului» (§NNN): the site menu's entries, one under the other, in the club's order.
  menuOrder: ReorderIcon,
} satisfies Record<string, ComponentType<SvgIconProps>>;

export type PanelGlyphName = keyof typeof PANEL_GLYPHS;
