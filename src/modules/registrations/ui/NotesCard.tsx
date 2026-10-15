import Box from "@mui/material/Box";
import Stack from "@mui/material/Stack";
import Typography from "@mui/material/Typography";
import { getTranslations } from "next-intl/server";
import { CLUB_TIME_ZONE, formatDay } from "@/i18n/dates";
import { countForm } from "@/i18n/count-form";
import { confirmWords } from "@/shared/feedback/confirm-words";
import ActionForm, { type ActionFormAction } from "@/shared/forms/ActionForm";
import RecallField from "@/shared/forms/recall";
import { refusalMessages } from "@/shared/forms/refusal-messages";
import GlyphButton from "@/shared/ui/GlyphButton";
import Panel from "@/shared/ui/Panel";
import { REGISTRATION_NOTE_MAX } from "@/db/schema/registration-notes";
import type { RegistrationNoteRow } from "../notes";

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
 * `RecallField`). It opens by itself when a note was just saved or deleted, and for the `#note-interne` link.
 *
 * The actions are handed in by the page, so this stays a presentation of rows and a form: no query, no role
 * test, no link to the registrations module's writers.
 */
export default async function NotesCard({
  locale,
  registrationId,
  notes,
  addAction,
  deleteAction,
  opened,
}: {
  locale: string;
  registrationId: string;
  notes: readonly RegistrationNoteRow[];
  addAction: ActionFormAction;
  deleteAction: ActionFormAction;
  /** A note was just saved or deleted: the card opens to show the result. */
  opened: boolean;
}) {
  const t = await getTranslations("Admin");
  const words = await confirmWords();
  const refusal = await refusalMessages({ body: t("registrations.notes.label") });
  const aside = notes.length === 0 ? t("registrations.notes.none") : t(`registrations.notes.count.${countForm(notes.length, locale)}`, { count: notes.length });
  const when = (value: Date) => formatDay(value, { locale, timeZone: CLUB_TIME_ZONE, style: "short", withTime: true });

  return (
    <Panel glyph="internalNotes" level={3} collapsible title={t("registrations.notes.title")} aside={aside} openWhen={{ saved: opened }} id="note-interne" data-testid="notes-section">
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
                    {t("registrations.notes.by", { name: note.authorName ?? t("registrations.auditActorRemoved"), date: when(note.createdAt) })}
                  </Typography>
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
                      <input type="hidden" name="registrationId" value={registrationId} />
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
          <input type="hidden" name="registrationId" value={registrationId} />
          <Stack spacing={1.5} sx={{ alignItems: "flex-start" }}>
            <RecallField
              name="body"
              label={t("registrations.notes.add")}
              multiline
              minRows={3}
              fullWidth
              required
              helperText={t("registrations.notes.limit", { max: REGISTRATION_NOTE_MAX })}
              slotProps={{ htmlInput: { maxLength: REGISTRATION_NOTE_MAX } }}
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
