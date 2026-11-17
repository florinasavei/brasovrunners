import Box from "@mui/material/Box";
import Stack from "@mui/material/Stack";
import Typography from "@mui/material/Typography";
import { getTranslations } from "next-intl/server";
import { CLUB_TIME_ZONE, formatDay } from "@/i18n/dates";
import { countForm } from "@/i18n/count-form";
import { confirmWords } from "@/shared/feedback/confirm-words";
import ActionForm, { type ActionFormAction } from "@/shared/forms/ActionForm";
import RecallField, { RecallDetails } from "@/shared/forms/recall";
import { refusalMessages } from "@/shared/forms/refusal-messages";
import { ACTION_ICONS } from "@/shared/ui/action-icons";
import GlyphButton from "@/shared/ui/GlyphButton";
import Panel from "@/shared/ui/Panel";
import { TAP_TARGET } from "@/shared/ui/tap-target";

/** One note as the card draws it — a registration's (`RegistrationNoteRow`) or a volunteer's (`VolunteerNoteRow`), the same shape. */
export type NotesCardRow = {
  id: string;
  body: string;
  createdAt: Date;
  /** The author's display name; null when nobody can be named (the card then says `authorGone`). */
  authorName: string | null;
  /** Whether the reader may delete it (the service decides; the card draws «Șterge» only where it would succeed). */
  deletable: boolean;
  /** Whether the reader may change its words (§NNN; a volunteer's note): «Modifică» is drawn only with it and an `editAction`. */
  editable?: boolean;
};

/** «Modifică»'s pencil, by its name in the backoffice's registry; named `…Icon`, as §521's guard reads a fold's glyph by its tag. */
const EditIcon = ACTION_ICONS.edit;

/**
 * «Modifică» beside «Șterge» (§NNN): a native fold — it opens without a script, and by itself after a refusal (`RecallDetails`) —
 * whose line is drawn as the row's other press, a small press with its glyph, 44 pixels tall, the marker gone (the pencil is the
 * picture, §521). Open, it takes the whole width under the note's line (`EDIT_ITEM_SX`), «Șterge» after it.
 */
const EDIT_FOLD_SX = {
  "& > summary": {
    display: "inline-flex",
    alignItems: "center",
    gap: 0.5,
    ...TAP_TARGET,
    boxSizing: "border-box",
    px: 0.5,
    cursor: "pointer",
    listStyle: "none",
    "&::-webkit-details-marker": { display: "none" },
    "&::marker": { content: '""' },
    // The words as «Șterge»'s beside it: the theme's button type at a small button's size.
    typography: "button",
    fontSize: "0.8125rem",
    color: "primary.main",
    "&:hover, &:focus-visible": { textDecoration: "underline" },
  },
} as const;

/** The fold's place in the note's line: beside the byline while closed, the whole width under it while open. */
const EDIT_ITEM_SX = { minWidth: 0, "&:has(details[open])": { flexBasis: "100%" } } as const;

/**
 * «Note interne» on a registration's page (§777): what the organizers tell each other about one registration,
 * seen by the Organizer and above and by nobody else — the page draws this card only for a role that may keep
 * notes, and `notes.ts` refuses every other role again (BR-REQ-060-01).
 *
 * A named, folded card (`Panel`, §336) whose closed line counts the notes — «3 note» / «nicio notă» — so a
 * registration with notes says so before anybody opens it. Inside: the one-line help (who sees them, and
 * not to write health data), the notes newest first with their author's display name and when, «Șterge» on
 * the ones the reader may delete (its own; any, for an Administrator — the service decides), and «Adaugă o
 * notă», a textarea that comes back filled after a refusal and works with JavaScript off (`ActionForm`,
 * `RecallField`). It opens by itself when it holds a note (the page's first card, read without a press), when a note was just saved or
 * deleted, and for the `#note-interne` link; with no note it stays closed on «nicio notă».
 *
 * The actions are handed in by the page, so this stays a presentation of rows and a form: no query, no role
 * test, no link to the registrations module's writers. Generic in what tied it to a registration («Note interne» for
 * volunteers): the hidden field naming whose notes they are (`owner`: `registrationId` or `volunteerId`, and the id), the
 * limit (`max`, each table's own constant) and the words for a note nobody can be named for (`authorGone`: «cont șters» on
 * a registration, «autor necunoscut» on a volunteer, whose carried notes may never have had an author). It imports neither
 * kind of note: the pages that hand it the rows are the readers `notes-never-leave.test.ts` and its volunteers' twin list.
 *
 * «Modifică» (§NNN; a volunteer's notes alone: the owner, 2026-11-17, «lasă-mă să editez și nota internă»): with an `editAction`,
 * each note the reader may change (`editable`, the service's answer) has, beside «Șterge», a fold holding its words in a box and
 * «Salvează nota». A fold rather than a dialog: the «Voluntari» list's «Modifică nota» lands here when no script runs, so the form
 * must work without one. The registration's page hands no `editAction`, and its card is as it was.
 */
export default async function NotesCard({
  locale,
  owner,
  max,
  authorGone,
  notes,
  addAction,
  deleteAction,
  editAction,
  opened,
}: {
  locale: string;
  /** The hidden field every form posts: whose notes these are. */
  owner: { field: "registrationId" | "volunteerId"; id: string };
  /** The longest note, in characters: the table's own constant. */
  max: number;
  /** What a note's line says for an author nobody can name. */
  authorGone: string;
  notes: readonly NotesCardRow[];
  addAction: ActionFormAction;
  deleteAction: ActionFormAction;
  /** «Modifică» on the notes the reader may change (§NNN); absent, no note is changed here. */
  editAction?: ActionFormAction;
  /** A note was just saved, changed or deleted: the card opens to show the result. */
  opened: boolean;
}) {
  const t = await getTranslations("Admin");
  const words = await confirmWords();
  const refusal = await refusalMessages({ body: t("registrations.notes.label") });
  const aside = notes.length === 0 ? t("registrations.notes.none") : t(`registrations.notes.count.${countForm(notes.length, locale)}`, { count: notes.length });
  const when = (value: Date) => formatDay(value, { locale, timeZone: CLUB_TIME_ZONE, style: "short", withTime: true });

  return (
    <Panel glyph="internalNotes" level={3} collapsible title={t("registrations.notes.title")} aside={aside} openWhen={{ saved: opened, holds: notes.length > 0 }} id="note-interne" data-testid="notes-section">
      <Stack spacing={2}>
        {/* Who sees the notes, and what never to write in one (a note is personal data about the participant). */}
        <Typography variant="body2" color="text.secondary" data-testid="notes-help">
          {t("registrations.notes.help")}
        </Typography>

        {notes.length === 0 ? (
          <Typography variant="body2" data-testid="notes-empty">
            {t("registrations.notes.empty")}
          </Typography>
        ) : (
          <Stack component="ul" spacing={1.5} sx={{ listStyle: "none", m: 0, p: 0 }} data-testid="notes-list">
            {notes.map((note) => (
              <Box key={note.id} component="li" data-testid="note" sx={{ borderLeft: 3, borderColor: "divider", pl: 1.5 }}>
                {/* Plain text, line breaks kept; a long word never widens the card. */}
                <Typography variant="body2" sx={{ whiteSpace: "pre-wrap", overflowWrap: "anywhere" }} data-testid="note-body">
                  {note.body}
                </Typography>
                <Stack direction="row" spacing={1} sx={{ alignItems: "center", flexWrap: "wrap", columnGap: 1 }}>
                  <Typography variant="caption" color="text.secondary" data-testid="note-by">
                    {t("registrations.notes.by", { name: note.authorName ?? authorGone, date: when(note.createdAt) })}
                  </Typography>
                  {editAction && note.editable && (
                    <Box sx={EDIT_ITEM_SX} data-testid="note-edit">
                      <ActionForm action={editAction} messages={refusal} scope={`note-edit-${note.id}`} data-testid="note-edit-form">
                        <input type="hidden" name="uiLocale" value={locale} />
                        <input type="hidden" name={owner.field} value={owner.id} />
                        <input type="hidden" name="noteId" value={note.id} />
                        <RecallDetails sx={EDIT_FOLD_SX}>
                          <Box component="summary" data-testid="note-edit-toggle">
                            <EditIcon aria-hidden sx={{ fontSize: "1rem" }} />
                            {t("registrations.notes.edit")}
                          </Box>
                          <Stack spacing={1.5} sx={{ alignItems: "flex-start", mt: 1, mb: 1 }}>
                            <RecallField
                              name="body"
                              label={t("registrations.notes.label")}
                              defaultValue={note.body}
                              multiline
                              minRows={3}
                              fullWidth
                              required
                              helperText={t("registrations.notes.limit", { max })}
                              slotProps={{ htmlInput: { maxLength: max } }}
                            />
                            <GlyphButton icon="save" type="submit" variant="contained" sx={{ minHeight: 44 }}>
                              {t("registrations.notes.save")}
                            </GlyphButton>
                          </Stack>
                        </RecallDetails>
                      </ActionForm>
                    </Box>
                  )}
                  {note.deletable && (
                    <ActionForm
                      action={deleteAction}
                      messages={refusal}
                      confirm={{
                        title: t("confirm.noteDeleteTitle"),
                        body: t("confirm.noteDeleteBody"),
                        confirmLabel: t("registrations.notes.delete"),
                        cancelLabel: words.cancel,
                        destructive: true,
                      }}
                      scope={`note-delete-${note.id}`}
                      data-testid="note-delete-form"
                    >
                      <input type="hidden" name="uiLocale" value={locale} />
                      <input type="hidden" name={owner.field} value={owner.id} />
                      <input type="hidden" name="noteId" value={note.id} />
                      <GlyphButton icon="delete" type="submit" variant="text" color="error" size="small" sx={{ minHeight: 44 }}>
                        {t("registrations.notes.delete")}
                      </GlyphButton>
                    </ActionForm>
                  )}
                </Stack>
              </Box>
            ))}
          </Stack>
        )}

        <ActionForm action={addAction} messages={refusal} scope="note" data-testid="note-add-form">
          <input type="hidden" name="uiLocale" value={locale} />
          <input type="hidden" name={owner.field} value={owner.id} />
          <Stack spacing={1.5} sx={{ alignItems: "flex-start" }}>
            <RecallField
              name="body"
              label={t("registrations.notes.add")}
              multiline
              minRows={3}
              fullWidth
              required
              helperText={t("registrations.notes.limit", { max })}
              slotProps={{ htmlInput: { maxLength: max } }}
            />
            <GlyphButton icon="save" type="submit" variant="contained" sx={{ minHeight: 44 }}>
              {t("registrations.notes.save")}
            </GlyphButton>
          </Stack>
        </ActionForm>
      </Stack>
    </Panel>
  );
}
