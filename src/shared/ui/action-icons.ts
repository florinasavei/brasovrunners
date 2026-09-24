import AddIcon from "@mui/icons-material/Add";
import ArchiveIcon from "@mui/icons-material/Archive";
import CampaignIcon from "@mui/icons-material/Campaign";
import CheckCircleIcon from "@mui/icons-material/CheckCircle";
import CloseIcon from "@mui/icons-material/Close";
import ConfirmationNumberIcon from "@mui/icons-material/ConfirmationNumber";
import ContentCopyIcon from "@mui/icons-material/ContentCopy";
import DeleteIcon from "@mui/icons-material/Delete";
import DeleteForeverIcon from "@mui/icons-material/DeleteForever";
import DoneAllIcon from "@mui/icons-material/DoneAll";
import DownloadIcon from "@mui/icons-material/Download";
import DriveFileRenameOutlineIcon from "@mui/icons-material/DriveFileRenameOutline";
import EditIcon from "@mui/icons-material/Edit";
import EditNoteIcon from "@mui/icons-material/EditNote";
import EmojiEventsIcon from "@mui/icons-material/EmojiEvents";
import EventBusyIcon from "@mui/icons-material/EventBusy";
import EventRepeatIcon from "@mui/icons-material/EventRepeat";
import EventSeatIcon from "@mui/icons-material/EventSeat";
import FilterAltIcon from "@mui/icons-material/FilterAlt";
import FilterAltOffIcon from "@mui/icons-material/FilterAltOff";
import ForwardToInboxIcon from "@mui/icons-material/ForwardToInbox";
import GridOnIcon from "@mui/icons-material/GridOn";
import HowToRegIcon from "@mui/icons-material/HowToReg";
import ImageIcon from "@mui/icons-material/Image";
import ListAltIcon from "@mui/icons-material/ListAlt";
import LogoutIcon from "@mui/icons-material/Logout";
import ManageAccountsIcon from "@mui/icons-material/ManageAccounts";
import MedicalServicesIcon from "@mui/icons-material/MedicalServices";
import PersonAddIcon from "@mui/icons-material/PersonAdd";
import PersonOffIcon from "@mui/icons-material/PersonOff";
import PersonSearchIcon from "@mui/icons-material/PersonSearch";
import PictureAsPdfIcon from "@mui/icons-material/PictureAsPdf";
import PostAddIcon from "@mui/icons-material/PostAdd";
import PrintIcon from "@mui/icons-material/Print";
import PublicIcon from "@mui/icons-material/Public";
import PublicOffIcon from "@mui/icons-material/PublicOff";
import QrCodeScannerIcon from "@mui/icons-material/QrCodeScanner";
import RateReviewIcon from "@mui/icons-material/RateReview";
import RemoveCircleIcon from "@mui/icons-material/RemoveCircle";
import RemoveDoneIcon from "@mui/icons-material/RemoveDone";
import RestartAltIcon from "@mui/icons-material/RestartAlt";
import SaveIcon from "@mui/icons-material/Save";
import SearchIcon from "@mui/icons-material/Search";
import SendIcon from "@mui/icons-material/Send";
import StarIcon from "@mui/icons-material/Star";
import ToggleOffIcon from "@mui/icons-material/ToggleOff";
import ToggleOnIcon from "@mui/icons-material/ToggleOn";
import UndoIcon from "@mui/icons-material/Undo";
import UploadIcon from "@mui/icons-material/Upload";
import VerifiedIcon from "@mui/icons-material/Verified";
import VisibilityIcon from "@mui/icons-material/Visibility";
import type { SvgIconProps } from "@mui/material/SvgIcon";
import type { ComponentType } from "react";

/**
 * A glyph per verb, looked up **by name** (the owner, on the publication row and the bulk bar:
 * "am nevoie de iconițe și aici", "și butoanele astea au nevoie de iconițe"; and on 2026-09-23:
 * "I also need more icons, including on the Printing BID stuff").
 *
 * By name, and never as an element, because these buttons are rendered from Server Components:
 * an icon passed as an element-valued prop across the server/client boundary is the defect
 * `CheckboxField` documents at length — React outlines the subtree and the client receives a
 * lazy reference with no `props`. The name is a string, which crosses safely; the client
 * component makes the element (`GlyphButton`, `GlyphButtonLink`, `GlyphSubmitButton`,
 * `ConfirmSubmitButton`, `RowMenu`, `RegistrationRowMenu`).
 *
 * **One table, so one verb has one glyph everywhere (§318).** The two row menus kept their own
 * tables until now, and a verb could wear one picture in the "⋮" and another on the page's
 * button beside it. They read this one. A navigation button wears its tab's glyph
 * (`AdminTabs`): the desk is the trophy, the registrations are the list.
 * `tests/unit/shared/action-icons.test.ts` holds the rule: every name used in `src/` is here,
 * every name here is used, and a label names the same glyph wherever it is written.
 *
 * **The backoffice's, and never a public page's (§318).** A lookup by a runtime key cannot be
 * tree-shaken, so whatever imports this table ships every glyph in it — some thirty kilobytes
 * of path data, four or five gzipped. That is nothing in the backoffice and a tax on every
 * visitor anywhere else ("the header and the landing page are what every visitor pays for"), so
 * the components a public page renders — `ButtonLink`, `SubmitButton`, `RunnerLoader` — never
 * import it: the send buttons' runner is `SubmitButton`'s own `runner` flag, one glyph imported
 * directly. The test walks the imports from every route and fails if a public one reaches this
 * file through anything.
 *
 * One file per glyph from `@mui/icons-material`, never the barrel (§90). Every glyph is
 * decoration beside a label that already says the verb: `SvgIcon` renders `aria-hidden` unless
 * it is given a title, so none of this changes a button's accessible name.
 */
export type ActionIconName =
  // The publication workflow (§170): back to a draft is the pencil on the page; review is the
  // page somebody reads and marks; publishing is the globe, because that is what it does, and
  // taking something off the site is the globe struck through; archive is the box it goes into.
  | "draft"
  | "review"
  | "publish"
  | "unpublish"
  | "archive"
  | "approve"
  // Making and changing.
  | "add"
  | "addPerson"
  | "template"
  | "save"
  | "edit"
  | "rename"
  | "reset"
  | "upload"
  | "duplicate"
  | "repeat"
  | "repeatStop"
  | "cover"
  // Removing. Deleting is the bin; erasing — the verb that cannot be undone and takes the
  // declaration with it — is the bin with the cross, so the two never look alike in one menu.
  // Cancelling a registration keeps the row, and is a different shape again.
  | "delete"
  | "erase"
  | "cancel"
  | "dismiss"
  // Looking and finding.
  | "preview"
  | "picture"
  | "filter"
  | "clearFilter"
  | "search"
  // The registrations, and race day (BR-REQ-037-07, BR-REQ-037-08).
  | "registrations"
  | "desk"
  | "scan"
  | "confirm"
  | "place"
  | "checkIn"
  | "undo"
  | "number"
  // The emergency details and the emergency sheet (§322): the first-aid case, never on the desk.
  | "emergency"
  // Everything held about one address (§322), the Administrator's page for an access request.
  | "personData"
  // The bibs (§264): a PDF to keep is the PDF; the batch that goes to the printer now — only the
  // unprinted, a single reprint, the blank paper form — is the printer; saying it came out of
  // the printer is the double tick, and taking that back is the tick struck through.
  | "pdf"
  | "print"
  | "markPrinted"
  | "markUnprinted"
  // Files and mail. Sending an email again — a registration's, a staff invitation, a password
  // reset — is one verb and one glyph, the envelope going back out (§318).
  | "spreadsheet"
  | "download"
  | "send"
  | "resend"
  // Writing to an event's participants in the club's own words (§NNN): the loudspeaker, because
  // it is an announcement to many, not one message sent again.
  | "announce"
  // People and settings.
  | "revoke"
  | "role"
  | "turnOn"
  | "turnOff"
  | "signOut";
// No runner here: the public send buttons wear it through `SubmitButton`'s own `runner` flag,
// because this table must never reach a public page (above).

export const ACTION_ICONS: Record<ActionIconName, ComponentType<SvgIconProps>> = {
  draft: EditNoteIcon,
  review: RateReviewIcon,
  publish: PublicIcon,
  unpublish: PublicOffIcon,
  archive: ArchiveIcon,
  approve: VerifiedIcon,

  add: AddIcon,
  addPerson: PersonAddIcon,
  // A new document with a start already on it: the platform's legal templates (§95).
  template: PostAddIcon,
  save: SaveIcon,
  edit: EditIcon,
  rename: DriveFileRenameOutlineIcon,
  reset: RestartAltIcon,
  upload: UploadIcon,
  duplicate: ContentCopyIcon,
  repeat: EventRepeatIcon,
  repeatStop: EventBusyIcon,
  cover: StarIcon,

  delete: DeleteIcon,
  erase: DeleteForeverIcon,
  cancel: RemoveCircleIcon,
  dismiss: CloseIcon,

  preview: VisibilityIcon,
  picture: ImageIcon,
  filter: FilterAltIcon,
  clearFilter: FilterAltOffIcon,
  search: SearchIcon,

  // The list, as the "Înscrieri" tab wears it (`AdminTabs`): the person with the tick is
  // checking in, and a verb and a view must not share a glyph.
  registrations: ListAltIcon,
  desk: EmojiEventsIcon,
  scan: QrCodeScannerIcon,
  confirm: CheckCircleIcon,
  // A seat, not the person-with-tick: giving a place and checking in were the same glyph in the
  // registration's menu, and the desk offers both.
  place: EventSeatIcon,
  checkIn: HowToRegIcon,
  undo: UndoIcon,
  number: ConfirmationNumberIcon,
  emergency: MedicalServicesIcon,
  personData: PersonSearchIcon,

  pdf: PictureAsPdfIcon,
  print: PrintIcon,
  markPrinted: DoneAllIcon,
  markUnprinted: RemoveDoneIcon,

  spreadsheet: GridOnIcon,
  download: DownloadIcon,
  send: SendIcon,
  resend: ForwardToInboxIcon,
  announce: CampaignIcon,

  revoke: PersonOffIcon,
  role: ManageAccountsIcon,
  turnOn: ToggleOnIcon,
  turnOff: ToggleOffIcon,
  signOut: LogoutIcon,
};
