import Box from "@mui/material/Box";
import Stack from "@mui/material/Stack";
import Typography from "@mui/material/Typography";
import { getTranslations } from "next-intl/server";
import { RESERVE_EMAIL_MAX, RESERVE_NAME_MAX, RESERVE_NOTE_MAX } from "@/db/schema/event-reserve-entries";
import { countForm } from "@/i18n/count-form";
import { CLUB_TIME_ZONE, formatDay } from "@/i18n/dates";
import { confirmWords } from "@/shared/feedback/confirm-words";
import ActionForm, { type ActionFormAction } from "@/shared/forms/ActionForm";
import RecallField from "@/shared/forms/recall";
import { refusalMessages } from "@/shared/forms/refusal-messages";
import GlyphButton from "@/shared/ui/GlyphButton";
import { HEADING_SX } from "@/shared/ui/heading-scale";
import Panel from "@/shared/ui/Panel";
import type { ReserveEntryRow } from "../reserve-list";

/**
 * «Lista internă de așteptare» (§854) on one event's registrations list, for the Organizer and above: the
 * people who asked to be kept in mind, told nothing and emailed nothing. Each line: the name, the address
 * when the club has it, the internal note (edited in place), «Trece pe lista oficială» — the ordinary staff
 * entry, prefilled; the note follows the registration — and «Șterge». Below, «Adaugă pe lista internă». The
 * official list's own one-press entry is the panel beside this one («Adaugă pe lista de așteptare», §872).
 * Presentation only: the page reads the rows and hands in the actions.
 */
export default async function ReserveListPanel({
  locale,
  eventId,
  entries,
  officialHref,
  addAction,
  saveNoteAction,
  deleteAction,
  opened,
}: {
  locale: string;
  eventId: string;
  entries: readonly ReserveEntryRow[];
  /** The staff entry prefilled from one line. */
  officialHref: (entryId: string) => string;
  addAction: ActionFormAction;
  saveNoteAction: ActionFormAction;
  deleteAction: ActionFormAction;
  opened: boolean;
}) {
  const t = await getTranslations("Admin");
  const words = await confirmWords();
  const refusal = await refusalMessages({
    firstName: t("reserve.firstName"),
    lastName: t("reserve.lastName"),
    email: t("reserve.email"),
    note: t("reserve.note"),
  });
  const aside = entries.length === 0 ? t("reserve.none") : t(`reserve.count.${countForm(entries.length, locale)}`, { count: entries.length });
  const when = (value: Date) => formatDay(value, { locale, timeZone: CLUB_TIME_ZONE, style: "short", withTime: true });

  return (
    <Panel glyph="queue" collapsible title={t("reserve.title")} intro={t("reserve.intro")} aside={aside} openWhen={{ saved: opened }} id="registrations-reserve" data-testid="registrations-reserve">
      <Stack spacing={3}>
        {entries.length === 0 ? (
          <Typography variant="body2" color="text.secondary" data-testid="reserve-empty">
            {t("reserve.empty")}
          </Typography>
        ) : (
          <Stack component="ol" spacing={2} sx={{ m: 0, pl: 3 }} data-testid="reserve-list">
            {entries.map((entry) => (
              <Box key={entry.id} component="li" data-testid="reserve-entry">
                <Typography sx={{ fontWeight: 600 }}>{`${entry.firstName} ${entry.lastName}`}</Typography>
                {entry.email && (
                  <Typography variant="body2" sx={{ wordBreak: "break-all" }}>
                    {entry.email}
                  </Typography>
                )}
                <Typography variant="caption" color="text.secondary" component="p">
                  {t("reserve.by", { name: entry.createdByName ?? t("registrations.auditActorRemoved"), date: when(entry.createdAt) })}
                </Typography>
                <ActionForm action={saveNoteAction} messages={refusal} scope={`reserve-note-${entry.id}`} data-testid="reserve-note-form">
                  <input type="hidden" name="uiLocale" value={locale} />
                  <input type="hidden" name="entryId" value={entry.id} />
                  <Stack spacing={1} sx={{ alignItems: "flex-start", mt: 1 }}>
                    <RecallField
                      name="note"
                      label={t("reserve.note")}
                      defaultValue={entry.note ?? ""}
                      multiline
                      minRows={2}
                      fullWidth
                      size="small"
                      slotProps={{ htmlInput: { maxLength: RESERVE_NOTE_MAX } }}
                    />
                    <Stack direction={{ xs: "column", sm: "row" }} spacing={1}>
                      <GlyphButton icon="save" type="submit" variant="outlined" size="small" sx={{ minHeight: 44 }}>
                        {t("reserve.saveNote")}
                      </GlyphButton>
                      <GlyphButton icon="addPerson" href={officialHref(entry.id)} variant="contained" size="small" sx={{ minHeight: 44 }} data-testid="reserve-official">
                        {t("reserve.official")}
                      </GlyphButton>
                    </Stack>
                  </Stack>
                </ActionForm>
                <ActionForm
                  action={deleteAction}
                  messages={refusal}
                  confirm={{
                    title: t("reserve.deleteTitle"),
                    body: t("reserve.deleteBody", { name: `${entry.firstName} ${entry.lastName}` }),
                    confirmLabel: t("reserve.delete"),
                    cancelLabel: words.cancel,
                    destructive: true,
                  }}
                  scope={`reserve-delete-${entry.id}`}
                  data-testid="reserve-delete-form"
                >
                  <input type="hidden" name="uiLocale" value={locale} />
                  <input type="hidden" name="entryId" value={entry.id} />
                  <GlyphButton icon="delete" type="submit" variant="text" color="error" size="small" sx={{ minHeight: 44 }}>
                    {t("reserve.delete")}
                  </GlyphButton>
                </ActionForm>
              </Box>
            ))}
          </Stack>
        )}

        <Box component="section" aria-labelledby="reserve-add-title" sx={{ pt: 2, borderTop: 1, borderColor: "divider" }}>
          <Typography id="reserve-add-title" variant="h3" sx={{ ...HEADING_SX[3], mb: 1.5 }}>
            {t("reserve.addTitle")}
          </Typography>

          <ActionForm action={addAction} messages={refusal} scope="reserve-add" data-testid="reserve-add-form">
            <input type="hidden" name="uiLocale" value={locale} />
            <input type="hidden" name="eventId" value={eventId} />
            <Stack spacing={1.5} sx={{ alignItems: "flex-start" }}>
              <Stack direction={{ xs: "column", sm: "row" }} spacing={1.5} sx={{ width: "100%" }}>
                <RecallField name="firstName" label={t("reserve.firstName")} required fullWidth slotProps={{ htmlInput: { maxLength: RESERVE_NAME_MAX } }} />
                <RecallField name="lastName" label={t("reserve.lastName")} required fullWidth slotProps={{ htmlInput: { maxLength: RESERVE_NAME_MAX } }} />
              </Stack>
              <RecallField name="email" type="email" label={t("reserve.email")} helperText={t("reserve.emailHelp")} fullWidth slotProps={{ htmlInput: { maxLength: RESERVE_EMAIL_MAX } }} />
              <RecallField name="note" label={t("reserve.note")} helperText={t("reserve.noteHelp")} multiline minRows={2} fullWidth slotProps={{ htmlInput: { maxLength: RESERVE_NOTE_MAX } }} />
              <GlyphButton icon="add" type="submit" variant="contained" sx={{ minHeight: 44 }}>
                {t("reserve.add")}
              </GlyphButton>
            </Stack>
          </ActionForm>
        </Box>
      </Stack>
    </Panel>
  );
}
