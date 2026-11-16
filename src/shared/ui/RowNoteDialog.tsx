"use client";

import AddIcon from "@mui/icons-material/Add";
import EditIcon from "@mui/icons-material/Edit";
import Box from "@mui/material/Box";
import Dialog from "@mui/material/Dialog";
import DialogActions from "@mui/material/DialogActions";
import DialogContent from "@mui/material/DialogContent";
import DialogTitle from "@mui/material/DialogTitle";
import { type MouseEvent, useId, useState } from "react";
import ActionFormIsland, { type ActionFormAction, type RefusalMessages } from "@/shared/forms/ActionFormIsland";
import RecallField from "@/shared/forms/recall";
import GlyphButton from "./GlyphButton";

/** The press's glyph, by name: a string is all that crosses from the server (§370). */
const PRESS_GLYPHS = { add: AddIcon, edit: EditIcon } as const;

/**
 * «Adaugă o notă» on a row of a list, without leaving the list: «Note interne» first on the registration's page,
 * and a note from a row of the list, amending the internal notes (the owner: «trebuie sa pot adauga comentarii direct de aici»).
 *
 * One small client island, generic on purpose — the next list that keeps notes (the volunteers') passes its own
 * action, its own hidden fields and its own words and gets the same control. It knows nothing of registrations:
 * everything it says arrives as a string, the action as a Server Action reference, the hidden fields as plain
 * name-and-value pairs (`registrationId`, `uiLocale`, `listQuery` for the registrations' list).
 *
 * Without JavaScript the control is the plain link `fallbackHref` (the person's page at its notes card, where the
 * form is one press away); with it, the press opens a dialog holding the one box and the two buttons. The save is
 * the Server Action behind `ActionFormIsland`: a refusal comes back as the form's own state and is said at the box
 * with the words still in it, and a save redirects the list to itself (its own validated return), whereupon
 * `settledKey` changes — the count the row's marker shows — and the dialog closes. Nothing typed goes in the
 * address. The dialog lists no note: the marker beside the control is the link to the card that reads them.
 *
 * It also serves a row's one line that is written and then changed — «Decizie ziua cursei» on the «Voluntari» list
 * (§NNN) — with other words and three things said by the caller, each a string or a flag: `defaultValue`, what the
 * line holds now, so the box opens on it; `optional`, a box that may be saved empty (which clears the line);
 * `icon: "edit"`, the pencil on a press that changes what is there. A caller that passes none of them gets the
 * notes' control as it was.
 *
 * `useId` keeps every id unique: a list draws each row twice (the table and the phone cards).
 */
export default function RowNoteDialog({
  action,
  actionKey,
  messages,
  fields,
  fallbackHref,
  label,
  ariaLabel,
  title,
  help,
  boxName,
  boxLabel,
  limitText,
  max,
  saveLabel,
  cancelLabel,
  settledKey,
  defaultValue = "",
  optional = false,
  icon = "add",
  testId = "note-add-open",
  dialogTestId = "note-add-dialog",
}: {
  action: ActionFormAction;
  /** The Server Action's key (`actionKeyOf`), for a blocked save to find this form in the page's HTML. */
  actionKey?: string;
  /** The refusal's words, only the sentences this form can meet. */
  messages: RefusalMessages;
  /** The hidden fields the press posts, by name: the row's id, the language, the list's query. */
  fields: Readonly<Record<string, string>>;
  /** Where the control goes without JavaScript. */
  fallbackHref: string;
  label: string;
  /** Names the person, so a screen reader does not hear the same «Adaugă o notă» on every row. */
  ariaLabel: string;
  /** The dialog's title, naming whose note it is. */
  title: string;
  help: string;
  /** The box's `name`, and its label, and the line under it that says the limit. */
  boxName: string;
  boxLabel: string;
  limitText: string;
  max: number;
  saveLabel: string;
  cancelLabel: string;
  /** Changes when a save has landed (the row's count, and the return's own flag): the dialog closes by itself then. The simple way (no JavaScript) is the link, never this form: it exists only in the browser. */
  settledKey: string;
  /** What the box opens on: the row's line as it stands, for a line that is changed in place. Empty for a note, which is always a new one. */
  defaultValue?: string;
  /** The box may be saved empty — for a line the empty box clears. A note needs words: off by default. */
  optional?: boolean;
  /** The press's glyph, by name: the plus of a new note, or the pencil of a line that is changed. */
  icon?: keyof typeof PRESS_GLYPHS;
  testId?: string;
  /** The dialog's own mark; its form and its help line are `<this>-form` and `<this>-help`. */
  dialogTestId?: string;
}) {
  const [open, setOpen] = useState(false);
  // A save landed (the row's count moved): the dialog closes, derived while rendering, not from an effect.
  const [seen, setSeen] = useState(settledKey);
  if (seen !== settledKey) {
    setSeen(settledKey);
    setOpen(false);
  }
  const unique = useId().replace(/[^a-zA-Z0-9_-]/g, "");
  const titleId = `note-dialog-title-${unique}`;
  const PressIcon = PRESS_GLYPHS[icon];

  const press = (event: MouseEvent<HTMLAnchorElement>) => {
    // A new tab or window (a modifier, the middle button) keeps the link's own way.
    if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    event.preventDefault();
    setOpen(true);
  };

  return (
    <>
      <Box
        component="a"
        href={fallbackHref}
        aria-label={ariaLabel}
        aria-haspopup="dialog"
        onClick={press}
        data-testid={testId}
        sx={{
          display: "inline-flex",
          alignItems: "center",
          minHeight: 44,
          color: "text.secondary",
          textDecoration: "none",
          "&:hover, &:focus-visible": { color: "text.primary" },
        }}
      >
        <Box
          component="span"
          sx={{
            display: "inline-flex",
            alignItems: "center",
            gap: 0.5,
            px: 0.5,
            py: 0.25,
            textDecoration: "underline",
            fontSize: "0.8125rem",
            lineHeight: 1.4,
          }}
        >
          <PressIcon aria-hidden="true" sx={{ fontSize: "1rem" }} />
          {label}
        </Box>
      </Box>
      <Dialog open={open} onClose={() => setOpen(false)} fullWidth maxWidth="sm" aria-labelledby={titleId} data-testid={dialogTestId}>
        <DialogTitle id={titleId}>{title}</DialogTitle>
        <ActionFormIsland action={action} actionKey={actionKey} messages={messages} scope={`note-${unique}`} data-testid={`${dialogTestId}-form`}>
          <DialogContent>
            {Object.entries(fields).map(([name, value]) => (
              <input key={name} type="hidden" name={name} value={value} />
            ))}
            <Box sx={{ color: "text.secondary", fontSize: "0.875rem", mb: 2 }} data-testid={`${dialogTestId}-help`}>
              {help}
            </Box>
            <RecallField
              name={boxName}
              label={boxLabel}
              multiline
              minRows={3}
              fullWidth
              required={!optional}
              autoFocus
              defaultValue={defaultValue}
              helperText={limitText}
              slotProps={{ htmlInput: { maxLength: max } }}
            />
          </DialogContent>
          <DialogActions>
            <GlyphButton icon="dismiss" type="button" onClick={() => setOpen(false)} sx={{ minHeight: 44 }}>
              {cancelLabel}
            </GlyphButton>
            <GlyphButton icon="save" type="submit" variant="contained" sx={{ minHeight: 44 }}>
              {saveLabel}
            </GlyphButton>
          </DialogActions>
        </ActionFormIsland>
      </Dialog>
    </>
  );
}
