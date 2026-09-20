import ArchiveIcon from "@mui/icons-material/Archive";
import DeleteIcon from "@mui/icons-material/Delete";
import ContentCopyIcon from "@mui/icons-material/ContentCopy";
import EditNoteIcon from "@mui/icons-material/EditNote";
import EventRepeatIcon from "@mui/icons-material/EventRepeat";
import PublicIcon from "@mui/icons-material/Public";
import RateReviewIcon from "@mui/icons-material/RateReview";
import type { SvgIconProps } from "@mui/material/SvgIcon";
import type { ComponentType } from "react";

/**
 * A glyph per backoffice verb, looked up **by name** (the owner, on the publication row and
 * the bulk bar: "am nevoie de iconițe și aici", "și butoanele astea au nevoie de iconițe").
 *
 * By name, and never as an element, because these buttons are rendered from Server Components:
 * an icon passed as an element-valued prop across the server/client boundary is the defect
 * `CheckboxField` documents at length — React outlines the subtree and the client receives a
 * lazy reference with no `props`. The name is a string, which crosses safely; the client
 * component makes the element. `EventRowMenu` already worked this way for the row's "⋮", and
 * this is the same registry where more than one component needs it.
 *
 * One file per glyph from `@mui/icons-material`, never the barrel (§90).
 */
export type ActionIconName =
  | "draft"
  | "review"
  | "publish"
  | "archive"
  | "delete"
  | "duplicate"
  | "repeat";

export const ACTION_ICONS: Record<ActionIconName, ComponentType<SvgIconProps>> = {
  // Back to a draft is the pencil; review is the page somebody reads and marks; publishing is
  // the globe, because that is what it does; archive is the box it goes into.
  draft: EditNoteIcon,
  review: RateReviewIcon,
  publish: PublicIcon,
  archive: ArchiveIcon,
  delete: DeleteIcon,
  duplicate: ContentCopyIcon,
  repeat: EventRepeatIcon,
};
