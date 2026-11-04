import Alert from "@mui/material/Alert";
import Box from "@mui/material/Box";
import Stack from "@mui/material/Stack";
import Typography from "@mui/material/Typography";
import { getTranslations } from "next-intl/server";
import { RESERVE_EMAIL_MAX, RESERVE_NAME_MAX, RESERVE_NOTE_MAX } from "@/db/schema/event-reserve-entries";
import { countForm } from "@/i18n/count-form";
import { CLUB_TIME_ZONE, formatDay } from "@/i18n/dates";
import { confirmWords } from "@/shared/feedback/confirm-words";
import type { ConfirmSpec } from "@/shared/feedback/notice";
import ActionForm, { type ActionFormAction } from "@/shared/forms/ActionForm";
import RecallField from "@/shared/forms/recall";
import { refusalMessages } from "@/shared/forms/refusal-messages";
import { ACTION_ICONS } from "@/shared/ui/action-icons";
import { DISCLOSURE_SX, FOLD_GLYPH_SX } from "@/shared/ui/disclosure";
import GlyphButton from "@/shared/ui/GlyphButton";
import { HEADING_SX } from "@/shared/ui/heading-scale";
import Panel from "@/shared/ui/Panel";
import { staffOfferIfMadeNow, waitlistOfferQuestion } from "../give-place-tip";
import type { ReserveEntryRow } from "../reserve-list";

/** The address fold's glyph (§521): the email the official list sends to. */
const AddressIcon = ACTION_ICONS.emailConfirmation;

/**
 * «Lista internă (doar notițe)» (§854, renamed by §888) on one event's registrations list, for the Organizer and
 * above: the people who asked to be kept in mind, told nothing and emailed nothing. Each line: the name, the
 * address when the club has it, the internal note (edited in place) and «Șterge» — the Organizer's three verbs.
 * For the Administrator (`moveAction`, handed down only to that role and only while the event takes a vouched
 * entry), two one-press verbs onto the official waiting list (§888): «Mută pe lista oficială» — the official
 * list's add form, from the line — and «Oferă-i un loc acum», the same entry with §642's offer; each dialog says
 * the consequence, names the address the emails go to and asks for the relay tick (§33); a line without an
 * address shows a box for it. The full form, prefilled, stays one link away (`fullFormHref`). Below, «Adaugă pe
 * lista internă». Presentation only: the page reads the rows and hands in the actions.
 *
 * And for the Administrator alone (`eliteMoveAction`), on every line, address or none: «Mută pe lista de elită»
 * (§903) — the name onto the race's elite list (§895), printed on a bib, nobody registered — asked first, the
 * dialog naming the person and saying what does not happen (no registration, place, email or declaration in the
 * app) and that the internal note is not kept. Under a line's «Email pentru lista oficială», the same role reads
 * that an elite runner needs no address. Back from the move (`eliteCardHref`), the panel's first line links to
 * the editor's elite card.
 */
export default async function ReserveListPanel({
  locale,
  eventId,
  entries,
  fullFormHref,
  addAction,
  saveNoteAction,
  deleteAction,
  moveAction,
  eliteMoveAction,
  listQuery,
  eliteCardHref,
  opened,
}: {
  locale: string;
  eventId: string;
  entries: readonly ReserveEntryRow[];
  /** The staff entry prefilled from one line — the Administrator's, as moving a line is. */
  fullFormHref?: (entryId: string) => string;
  addAction: ActionFormAction;
  saveNoteAction: ActionFormAction;
  deleteAction: ActionFormAction;
  /** «Mută pe lista oficială» and «Oferă-i un loc acum»: absent, no line carries them. */
  moveAction?: ActionFormAction;
  /** «Mută pe lista de elită» (§903), the Administrator's: absent, no line carries it, nor the no-address line. */
  eliteMoveAction?: ActionFormAction;
  /** The list's own query (filters, sort, page), posted by «Mută pe lista de elită» so the press comes back to the same list. */
  listQuery?: string;
  /** Back from «Mută pe lista de elită»: the editor's elite card (`/admin/events/[id]#bib-elite`), linked at the top. */
  eliteCardHref?: string;
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
  // A refused move names the boxes of the move: the address typed for the official list, the dialog's tick.
  const moveRefusal = moveAction
    ? await refusalMessages({
        firstName: t("reserve.firstName"),
        lastName: t("reserve.lastName"),
        email: t("reserve.emailForOfficial"),
        relayedByParticipantRequest: t("registrations.relayConfirmation"),
      })
    : refusal;
  // The offer's question (§642): the supplementary place and the close, read once for every line; null once started.
  const forecast = moveAction ? await staffOfferIfMadeNow(eventId, locale) : null;
  const aside = entries.length === 0 ? t("reserve.none") : t(`reserve.count.${countForm(entries.length, locale)}`, { count: entries.length });
  const when = (value: Date) => formatDay(value, { locale, timeZone: CLUB_TIME_ZONE, style: "short", withTime: true });

  /** The two dialogs of one line: which one asks is the button pressed (`intent`). */
  const moveQuestions = (entry: ReserveEntryRow): ConfirmSpec[] => {
    const name = `${entry.firstName} ${entry.lastName}`;
    // The address the emails go to: the line's, or the one typed beside the buttons (§875's safeguard).
    const email = entry.email ?? "{email}";
    const fillFrom = entry.email ? undefined : ["email"];
    const shared = { cancelLabel: words.cancel, tick: { field: "relayedByParticipantRequest", label: t("registrations.relayConfirmation") }, fillFrom };
    const questions: ConfirmSpec[] = [];
    if (forecast) {
      const offer = waitlistOfferQuestion((key, values) => t(key, values), email, forecast);
      // The line holds a name and an address (§888): the rest the form asks, the person types when they sign (§905).
      questions.push({
        ...shared,
        // The person named, and the email by its outcome (the design «telling the owner about every email a staff press sends», slice 3).
        ...words.mail({ to: name, type: "COMPLETE_DECLARATION", or: "WAITLIST_SPOT_OFFER" }),
        when: [{ field: "intent", equals: "offer" }],
        title: t("confirm.waitlistOfferTitle"),
        body: `${name}: ${offer.body} ${t("reserve.noteFollows")} ${t("reserve.detailsAtSigning")}`,
        confirmLabel: offer.confirmLabel,
      });
    }
    questions.push({
      ...shared,
      ...words.mail({ to: name, type: "WAITLIST_JOINED", or: "COMPLETE_DECLARATION" }),
      title: t("reserve.moveTitle"),
      body: `${name}: ${t("confirm.waitlistAddBody", { email })} ${t("reserve.noteFollows")} ${t("reserve.detailsAtSigning")}`,
      confirmLabel: t("reserve.move"),
    });
    return questions;
  };

  return (
    <Panel glyph="queue" collapsible title={t("reserve.title")} intro={t("reserve.intro")} aside={aside} openWhen={{ saved: opened }} id="registrations-reserve" data-testid="registrations-reserve">
      <Stack spacing={3}>
        {/* Back from «Mută pe lista de elită» (§903): where the name is now, one press away — a plain link, so the editor's fold opens from `#bib-elite`. */}
        {eliteCardHref && (
          <Alert severity="success" data-testid="reserve-moved-to-elite">
            <Box component="p" sx={{ m: 0 }}>
              {t("reserve.movedToElite")}
            </Box>
            <GlyphButton icon="elite" href={eliteCardHref} color="inherit" variant="text" size="small" sx={{ minHeight: 44, mt: 0.5 }} data-testid="reserve-elite-card">
              {t("reserve.eliteCardLink")}
            </GlyphButton>
          </Alert>
        )}
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
                    <GlyphButton icon="save" type="submit" variant="outlined" size="small" sx={{ minHeight: 44 }}>
                      {t("reserve.saveNote")}
                    </GlyphButton>
                  </Stack>
                </ActionForm>
                {moveAction && (
                  <ActionForm action={moveAction} messages={moveRefusal} confirm={moveQuestions(entry)} scope={`reserve-move-${entry.id}`} data-testid="reserve-move-form">
                    <input type="hidden" name="uiLocale" value={locale} />
                    <input type="hidden" name="entryId" value={entry.id} />
                    {/* The relay tick, asked in the dialog (§33): posted empty as drawn, `on` once ticked there. */}
                    <input type="hidden" name="relayedByParticipantRequest" value="" />
                    {/* The capacity the offer's question named (§642): the server adds that one place and no other, and none unasked. */}
                    {forecast && forecast.raisedTo !== null && <input type="hidden" name="addPlace" value={forecast.raisedTo} />}
                    <Stack spacing={1} sx={{ alignItems: "flex-start", mt: 1.5 }}>
                      {!entry.email && (
                        // A line written without an address (§888): its box behind a fold that says so — a press with it empty opens it (`revealField`).
                        <Box component="details" sx={{ ...DISCLOSURE_SX, width: "100%" }} data-testid="reserve-move-email">
                          <Box component="summary">
                            <AddressIcon fontSize="small" aria-hidden sx={FOLD_GLYPH_SX} />
                            <Typography component="span" variant="body2">
                              {t("reserve.emailForOfficialHelp")}
                            </Typography>
                          </Box>
                          <RecallField
                            name="email"
                            type="email"
                            label={t("reserve.emailForOfficial")}
                            required
                            fullWidth
                            size="small"
                            slotProps={{ htmlInput: { maxLength: RESERVE_EMAIL_MAX } }}
                          />
                        </Box>
                      )}
                      {/* An elite runner needs no address: said in sight, beside the fold rather than inside it — the owner asked
                          for a warning, and a closed fold hides one. */}
                      {!entry.email && eliteMoveAction && (
                        <Typography variant="body2" color="text.secondary" data-testid="reserve-elite-no-address">
                          {t("reserve.eliteNoAddress")}
                        </Typography>
                      )}
                      <Stack direction={{ xs: "column", sm: "row" }} spacing={1} sx={{ width: { xs: "100%", sm: "auto" } }}>
                        <GlyphButton icon="waiting" type="submit" name="intent" value="move" variant="contained" size="small" sx={{ minHeight: 44 }} data-testid="reserve-move">
                          {t("reserve.move")}
                        </GlyphButton>
                        {forecast && (
                          <GlyphButton icon="place" type="submit" name="intent" value="offer" variant="outlined" size="small" sx={{ minHeight: 44 }} data-testid="reserve-offer">
                            {t("waitlistAdd.offerNow")}
                          </GlyphButton>
                        )}
                      </Stack>
                    </Stack>
                  </ActionForm>
                )}
                <Stack direction={{ xs: "column", sm: "row" }} spacing={1} sx={{ alignItems: "flex-start", mt: 0.5 }}>
                  {fullFormHref && (
                    <GlyphButton icon="addPerson" href={fullFormHref(entry.id)} variant="text" size="small" sx={{ minHeight: 44 }} data-testid="reserve-full-form">
                      {t("waitlistAdd.longForm")}
                    </GlyphButton>
                  )}
                  {eliteMoveAction && (
                    // «Mută pe lista de elită» (§903): with or without an address — the elite list asks for none.
                    <ActionForm
                      action={eliteMoveAction}
                      messages={refusal}
                      confirm={{
                        title: t("reserve.moveToEliteTitle"),
                        body: t("reserve.moveToEliteBody", { name: `${entry.firstName} ${entry.lastName}` }),
                        confirmLabel: t("reserve.moveToElite"),
                        cancelLabel: words.cancel,
                      }}
                      scope={`reserve-elite-${entry.id}`}
                      data-testid="reserve-elite-form"
                    >
                      <input type="hidden" name="uiLocale" value={locale} />
                      <input type="hidden" name="entryId" value={entry.id} />
                      <input type="hidden" name="listQuery" value={listQuery ?? ""} />
                      <GlyphButton icon="elite" type="submit" variant="text" size="small" sx={{ minHeight: 44 }} data-testid="reserve-elite">
                        {t("reserve.moveToElite")}
                      </GlyphButton>
                    </ActionForm>
                  )}
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
                </Stack>
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
