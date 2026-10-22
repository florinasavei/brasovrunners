import AccessTimeIcon from "@mui/icons-material/AccessTime";
import AddIcon from "@mui/icons-material/Add";
import AlternateEmailIcon from "@mui/icons-material/AlternateEmail";
import AnnouncementIcon from "@mui/icons-material/Announcement";
import AssignmentLateIcon from "@mui/icons-material/AssignmentLate";
import BadgeIcon from "@mui/icons-material/Badge";
import BarChartIcon from "@mui/icons-material/BarChart";
import BorderColorIcon from "@mui/icons-material/BorderColor";
import BrushIcon from "@mui/icons-material/Brush";
import BuildIcon from "@mui/icons-material/Build";
import CampaignIcon from "@mui/icons-material/Campaign";
import CardMembershipIcon from "@mui/icons-material/CardMembership";
import CategoryIcon from "@mui/icons-material/Category";
import CheckroomIcon from "@mui/icons-material/Checkroom";
import ChecklistIcon from "@mui/icons-material/Checklist";
import CloudOffIcon from "@mui/icons-material/CloudOff";
import ConfirmationNumberIcon from "@mui/icons-material/ConfirmationNumber";
import ContactMailIcon from "@mui/icons-material/ContactMail";
import ContentCopyIcon from "@mui/icons-material/ContentCopy";
import ContentCutIcon from "@mui/icons-material/ContentCut";
import DataUsageIcon from "@mui/icons-material/DataUsage";
import DateRangeIcon from "@mui/icons-material/DateRange";
import DeleteForeverIcon from "@mui/icons-material/DeleteForever";
import DeleteSweepIcon from "@mui/icons-material/DeleteSweep";
import DrawIcon from "@mui/icons-material/Draw";
import EmojiEventsIcon from "@mui/icons-material/EmojiEvents";
import EventIcon from "@mui/icons-material/Event";
import EventRepeatIcon from "@mui/icons-material/EventRepeat";
import FeedbackIcon from "@mui/icons-material/Feedback";
import FilterAltIcon from "@mui/icons-material/FilterAlt";
import FlagIcon from "@mui/icons-material/Flag";
import GavelIcon from "@mui/icons-material/Gavel";
import GestureIcon from "@mui/icons-material/Gesture";
import GroupAddIcon from "@mui/icons-material/GroupAdd";
import GroupsIcon from "@mui/icons-material/Groups";
import HandshakeIcon from "@mui/icons-material/Handshake";
import HelpOutlineIcon from "@mui/icons-material/HelpOutlineOutlined";
import HistoryIcon from "@mui/icons-material/History";
import HomeIcon from "@mui/icons-material/Home";
import HourglassTopIcon from "@mui/icons-material/HourglassTop";
import HowToRegIcon from "@mui/icons-material/HowToReg";
import HubIcon from "@mui/icons-material/Hub";
import ImageIcon from "@mui/icons-material/Image";
import LabelIcon from "@mui/icons-material/Label";
import LeaderboardIcon from "@mui/icons-material/Leaderboard";
import LinkIcon from "@mui/icons-material/Link";
import ListAltIcon from "@mui/icons-material/ListAlt";
import LocalOfferIcon from "@mui/icons-material/LocalOffer";
import MailIcon from "@mui/icons-material/Mail";
import ManageHistoryIcon from "@mui/icons-material/ManageHistory";
import MapIcon from "@mui/icons-material/Map";
import MedicalServicesIcon from "@mui/icons-material/MedicalServices";
import NewspaperIcon from "@mui/icons-material/Newspaper";
import NotificationsActiveIcon from "@mui/icons-material/NotificationsActive";
import NotesIcon from "@mui/icons-material/Subject";
import NumbersIcon from "@mui/icons-material/Numbers";
import OutboxIcon from "@mui/icons-material/Outbox";
import PaidIcon from "@mui/icons-material/Paid";
import PinDropIcon from "@mui/icons-material/PinDrop";
import FormatSizeIcon from "@mui/icons-material/FormatSize";
import PaletteIcon from "@mui/icons-material/Palette";
import PaymentsIcon from "@mui/icons-material/Payments";
import PeopleAltIcon from "@mui/icons-material/PeopleAlt";
import PersonAddIcon from "@mui/icons-material/PersonAdd";
import PhoneIcon from "@mui/icons-material/Phone";
import EventAvailableIcon from "@mui/icons-material/EventAvailable";
import PhotoAlbumIcon from "@mui/icons-material/PhotoAlbum";
import PlaceIcon from "@mui/icons-material/Place";
import PlaylistAddCheckIcon from "@mui/icons-material/PlaylistAddCheck";
import PrintIcon from "@mui/icons-material/Print";
import PrivacyTipIcon from "@mui/icons-material/PrivacyTip";
import PublicIcon from "@mui/icons-material/Public";
import RecordVoiceOverIcon from "@mui/icons-material/RecordVoiceOver";
import RemoveCircleIcon from "@mui/icons-material/RemoveCircle";
import ReorderIcon from "@mui/icons-material/Reorder";
import RouteIcon from "@mui/icons-material/Route";
import RuleIcon from "@mui/icons-material/Rule";
import SaveIcon from "@mui/icons-material/Save";
import ScheduleIcon from "@mui/icons-material/Schedule";
import ScheduleSendIcon from "@mui/icons-material/ScheduleSend";
import ScienceIcon from "@mui/icons-material/Science";
import SettingsIcon from "@mui/icons-material/Settings";
import ShieldIcon from "@mui/icons-material/Shield";
import StickyNote2Icon from "@mui/icons-material/StickyNote2";
import ShareIcon from "@mui/icons-material/Share";
import SpeedIcon from "@mui/icons-material/Speed";
import StraightenIcon from "@mui/icons-material/Straighten";
import StorageIcon from "@mui/icons-material/Storage";
import TaskAltIcon from "@mui/icons-material/TaskAlt";
import TimerIcon from "@mui/icons-material/Timer";
import TitleIcon from "@mui/icons-material/Title";
import UploadFileIcon from "@mui/icons-material/UploadFile";
import TranslateIcon from "@mui/icons-material/Translate";
import TerrainIcon from "@mui/icons-material/Terrain";
import TextFieldsIcon from "@mui/icons-material/TextFields";
import UpdateIcon from "@mui/icons-material/Update";
import VerticalAlignBottomIcon from "@mui/icons-material/VerticalAlignBottom";
import VerticalAlignTopIcon from "@mui/icons-material/VerticalAlignTop";
import VisibilityIcon from "@mui/icons-material/Visibility";
import VolunteerActivismIcon from "@mui/icons-material/VolunteerActivism";
import WorkspacePremiumIcon from "@mui/icons-material/WorkspacePremium";
import type { SvgIconProps } from "@mui/material/SvgIcon";
import type { ComponentType } from "react";
import IncognitoIcon from "./IncognitoIcon";

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
 * **Read by `Panel` and by the sub-tab rows (`SettingsSubNav`, `TasksSubNav`, `GallerySubNav`, `ParticipantEmailsPanel`'s language switch), all Server Components** that no client file imports
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
  // The bib designer's sections (§759), top to bottom as the number prints: the header, the number, the
  // name, the profile with the emergency phone, the foot with the sponsors, and the members' number.
  bibHeader: VerticalAlignTopIcon,
  bibNumber: NumbersIcon,
  bibName: BadgeIcon,
  bibProfile: TerrainIcon,
  bibFooter: VerticalAlignBottomIcon,
  bibMembers: CardMembershipIcon,
  print: PrintIcon,
  startList: GroupsIcon,
  promotion: ShareIcon,
  save: SaveIcon,
  // «De făcut pentru pagina evenimentului» (§749): what the page still lacks and the club's own lines.
  todo: ChecklistIcon,
  // The card's two folds (§752): what the page still lacks, and the club's own tasks.
  todoPage: AssignmentLateIcon,
  todoOwn: PlaylistAddCheckIcon,
  // «Adaugă un rând» on that card (§749).
  add: AddIcon,
  // «Voluntari» on an event's editor (§754): the roles and the people.
  volunteers: VolunteerActivismIcon,
  // «Ecusoane pentru voluntari» (§764): the page's designer, and its sections top to bottom as the badge
  // prints — the size of the strip, the header («bibHeader», the bib's own), the role's band and its
  // word, the writing area for the name, the coordinator's telephone («publicPhone»), the cut lines
  // («badgeCut», the scissors — never the print card's own glyph), the print («print»).
  badges: BadgeIcon,
  // §783: one badge for everyone or one per role — the people the badge is for.
  badgeMode: PeopleAltIcon,
  badgeSize: StraightenIcon,
  badgeRole: LabelIcon,
  badgeWriting: BorderColorIcon,
  // §776: the club's free-text line under the role's band, and the second area to write in with the marker.
  badgeFreeText: TextFieldsIcon,
  badgeMarker: GestureIcon,
  badgeCut: ContentCutIcon,
  // «Puncte pe traseu» (§757): the points of the route, a pin on the ground.
  checkpoints: PinDropIcon,
  // The route's elevation profile (§802): the card's preview «Așa apare pe pagină» and the tick on each point — the ground's own outline.
  routeProfile: TerrainIcon,
  // What an event's registrations are, once it has them.
  registrations: ListAltIcon,
  queue: HourglassTopIcon,
  // «Note interne» (§777): what the organizers tell each other about one registration — the sticky note.
  internalNotes: StickyNote2Icon,
  // One registration's page (§NNN), its cards in the page's order: what to tell the person who asks (the voice), race
  // day (the desk's own cup), «Lista de invitați speciali» (the incognito its chip and its verb wear, §647), the answers
  // the person typed (the badge), emergency and health (the kit of «Informații medicale»), what the team did (the
  // clock of a managed history), the consent withdrawn (the privacy shield), cancel and erase (their verbs' glyphs).
  tell: RecordVoiceOverIcon,
  raceDay: EmojiEventsIcon,
  hiddenList: IncognitoIcon,
  answers: BadgeIcon,
  emergency: MedicalServicesIcon,
  auditTrail: ManageHistoryIcon,
  consent: PrivacyTipIcon,
  cancelRegistration: RemoveCircleIcon,
  erase: DeleteForeverIcon,
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
  // «Spune-ne ceva» (§676): the four anonymous forms above the newsletter on «Contact» (§679).
  feedback: FeedbackIcon,
  // «Răspunsurile din calendar» (§672): where an invitation's «Da / Nu / Poate» goes.
  calendarRsvp: EventAvailableIcon,
  notices: AnnouncementIcon,
  plan: CardMembershipIcon,
  transport: HubIcon,
  deadlines: TimerIcon,
  // «Când site-ul nu răspunde» (§657) on «Termene»: the fold of the outage grace — the cloud that cannot be reached.
  outage: CloudOffIcon,
  newsletter: NewspaperIcon,
  // The club and the platform.
  legal: GavelIcon,
  // «Versiuni șterse» (§567): the versions taken off the list, their text kept — the swept bin.
  deletedVersions: DeleteSweepIcon,
  invite: PersonAddIcon,
  members: GroupAddIcon,
  // «Cine e membru al grupului» (§789): the card on «Membri» that says what being a member means.
  memberDefinition: CardMembershipIcon,
  // «Niveluri de membru» (§811): the levels the club names for its members, on «Membri».
  memberTiers: WorkspacePremiumIcon,
  // «Coduri de reducere» (§552): the partners' discount codes, on «Membri» — the price tag the members' zone draws for them too.
  memberCodes: LocalOfferIcon,
  appearance: PaletteIcon,
  // «Setări»' row of tabs (§318 as amended, 2026-10-18) names the two it has no card for: the anti-robot check, a shield, and «Configurație», the platform's own screen, a gear.
  antiBot: ShieldIcon,
  configuration: SettingsIcon,
  // «Sarcini»' tab «Aplicația» (§318 as amended): the app's own work queue, the wrench. Its other three tabs share a card's picture: «Club» the checklist read from the system (`todo`), «De făcut» the club's own lines (`todoOwn`), «Sistem» the gear of «Configurație», where it leads.
  app: BuildIcon,
  // The language switch of «Emailuri» (§318 as amended) takes `translation`, below — never a flag; the two entries differ by their words.
  // «Pagina principală» (§714): the home page at the site's root, under «Aspect».
  home: HomeIcon,
  textSize: FormatSizeIcon,
  costs: PaidIcon,
  database: StorageIcon,
  budget: SpeedIcon,
  limits: DataUsageIcon,
  jobs: UpdateIcon,
  pictures: ImageIcon,
  // «Galerie»' two tabs (§813): the albums, and every stored picture above.
  albums: PhotoAlbumIcon,
  translation: TranslateIcon,
  // «Ordinea meniului» (§571): the site menu's entries, one under the other, in the club's order.
  menuOrder: ReorderIcon,
  // «Previzualizare» (§579): the event's card and page as a visitor will see them, before saving.
  preview: VisibilityIcon,
  // «Răspunsuri „Vin!”» (§811): who said they come to a turn-up event, on the event editor's registration card.
  rsvp: EventAvailableIcon,
  // «Clasament» (§808): a race's results page, its cards and the link to it from the event editor — and its «Importă din CSV» card, the file going up.
  results: LeaderboardIcon,
  importCsv: UploadFileIcon,
} satisfies Record<string, ComponentType<SvgIconProps>>;

export type PanelGlyphName = keyof typeof PANEL_GLYPHS;
