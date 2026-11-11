"use client";

import Box from "@mui/material/Box";
import Dialog from "@mui/material/Dialog";
import DialogActions from "@mui/material/DialogActions";
import DialogContent from "@mui/material/DialogContent";
import DialogTitle from "@mui/material/DialogTitle";
import Stack from "@mui/material/Stack";
import { useId, useState } from "react";
import ActionFormIsland, { type ActionFormAction, type RefusalMessages } from "@/shared/forms/ActionFormIsland";
import RecallField from "@/shared/forms/recall";
import GlyphButton from "@/shared/ui/GlyphButton";

/**
 * The partner of one row of the registrations list, set without leaving the list (the list's column «Partener»; the owner,
 * 2026-11-11: «unde sa pot selecta si sa pot vedea in gridul cu toti participantii cine de la ce partener e»).
 *
 * One small client island, in the shape of `shared/ui/RowNoteDialog.tsx`: a press in the row's «Partener» cell — a real
 * button whose accessible name says whose partner it is — opens a dialog with a native select of the event's partners
 * («Fără partener» first) and a short box for a partner not yet in it. Everything it says arrives as a string, the action as a
 * Server Action reference, the hidden fields and the boxes' names as plain strings: it imports nothing of the label's module,
 * which is the server's. The server decides what the two mean (a name typed wins, `partner-mark.ts#partnerMarkOfRow`) and
 * whether the actor may (`setRegistrationPartner`); a refusal comes back as the form's own state, said at the box with what
 * was typed kept, and a save redirects the list to itself, whereupon `settledKey` changes and the dialog closes.
 *
 * The suggestions are the page's one read (`listPartnerSuggestions`), handed to every row as the same array of strings.
 * `useId` keeps every id unique: the list draws each row twice (the table and the phone cards).
 */
export default function RowPartnerDialog({
  action,
  actionKey,
  messages,
  fields,
  label,
  ariaLabel,
  title,
  help,
  choiceName,
  choiceLabel,
  noneLabel,
  partners,
  current,
  boxName,
  boxLabel,
  boxHelp,
  max,
  saveLabel,
  cancelLabel,
  settledKey,
}: {
  action: ActionFormAction;
  /** The Server Action's key (`actionKeyOf`), for a blocked save to find this form in the page's HTML. */
  actionKey?: string;
  /** The refusal's words, only the sentences this form can meet. */
  messages: RefusalMessages;
  /** The hidden fields the press posts, by name: the row's id, the language, the list's query. */
  fields: Readonly<Record<string, string>>;
  /** The press's visible words. */
  label: string;
  /** Names the person, so a screen reader does not hear the same press on every row. */
  ariaLabel: string;
  /** The dialog's title, naming whose partner it is. */
  title: string;
  help: string;
  /** The select's `name` and label, and its first option's words («Fără partener», posted empty). */
  choiceName: string;
  choiceLabel: string;
  noneLabel: string;
  /** The event's partners already used, each once. */
  partners: readonly string[];
  /** The row's partner now, or null. */
  current: string | null;
  /** The box for a new partner: its `name`, label, help and limit. */
  boxName: string;
  boxLabel: string;
  boxHelp: string;
  max: number;
  saveLabel: string;
  cancelLabel: string;
  /** Changes when a save has landed — the row's partner, the return's flag and the page's render instant, so two «unchanged» in a row still differ — and the dialog closes by itself then. A refusal draws no new page: it stays open. */
  settledKey: string;
}) {
  const [open, setOpen] = useState(false);
  // A save landed (the row's partner or the outcome moved): the dialog closes, derived while rendering, not from an effect.
  const [seen, setSeen] = useState(settledKey);
  if (seen !== settledKey) {
    setSeen(settledKey);
    setOpen(false);
  }
  const unique = useId().replace(/[^a-zA-Z0-9_-]/g, "");
  const titleId = `partner-dialog-title-${unique}`;
  // The row's own partner is always an option, even beyond the suggestions' window.
  const options = current !== null && !partners.includes(current) ? [current, ...partners] : partners;

  return (
    <>
      <GlyphButton
        icon="edit"
        type="button"
        size="small"
        variant="text"
        aria-label={ariaLabel}
        aria-haspopup="dialog"
        onClick={() => setOpen(true)}
        data-testid="partner-row-open"
        sx={{ minHeight: 44, minWidth: 44, px: 1 }}
      >
        {label}
      </GlyphButton>
      <Dialog open={open} onClose={() => setOpen(false)} fullWidth maxWidth="sm" aria-labelledby={titleId} data-testid="partner-row-dialog">
        <DialogTitle id={titleId} sx={{ overflowWrap: "anywhere" }}>
          {title}
        </DialogTitle>
        <ActionFormIsland action={action} actionKey={actionKey} messages={messages} scope={`partner-${unique}`} data-testid="partner-row-form">
          <DialogContent>
            {Object.entries(fields).map(([name, value]) => (
              <input key={name} type="hidden" name={name} value={value} />
            ))}
            <Box sx={{ color: "text.secondary", fontSize: "0.875rem", mb: 2 }} data-testid="partner-row-help">
              {help}
            </Box>
            <Stack spacing={2}>
              <RecallField
                name={choiceName}
                label={choiceLabel}
                select
                fullWidth
                defaultValue={current ?? ""}
                slotProps={{ select: { native: true }, inputLabel: { shrink: true }, htmlInput: { "data-testid": "partner-row-choice" } }}
              >
                <option value="">{noneLabel}</option>
                {options.map((name) => (
                  <option key={name} value={name}>
                    {name}
                  </option>
                ))}
              </RecallField>
              <RecallField
                name={boxName}
                label={boxLabel}
                helperText={boxHelp}
                fullWidth
                defaultValue=""
                slotProps={{ htmlInput: { maxLength: max, autoComplete: "off", "data-testid": "partner-row-new" } }}
              />
            </Stack>
          </DialogContent>
          <DialogActions>
            <GlyphButton icon="dismiss" type="button" onClick={() => setOpen(false)} sx={{ minHeight: 44 }}>
              {cancelLabel}
            </GlyphButton>
            <GlyphButton icon="save" type="submit" variant="contained" sx={{ minHeight: 44 }} data-testid="partner-row-save">
              {saveLabel}
            </GlyphButton>
          </DialogActions>
        </ActionFormIsland>
      </Dialog>
    </>
  );
}
