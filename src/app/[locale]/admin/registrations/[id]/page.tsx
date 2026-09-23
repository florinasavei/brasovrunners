import Alert from "@mui/material/Alert";
import Box from "@mui/material/Box";
import MuiLink from "@mui/material/Link";
import Chip from "@mui/material/Chip";
import Divider from "@mui/material/Divider";
import Stack from "@mui/material/Stack";
import Typography from "@mui/material/Typography";
import CheckboxField from "@/shared/ui/CheckboxField";
import ActionForm from "@/shared/forms/ActionForm";
import RecallField, { RecallDetails } from "@/shared/forms/recall";
import { refusalMessages } from "@/shared/forms/refusal-messages";
import { hasLocale } from "next-intl";
import { getFormatter, getTranslations, setRequestLocale } from "next-intl/server";
import { notFound } from "next/navigation";
import { getDb } from "@/db/client";
import { emailMessageType } from "@/db/schema/email-outbox";
import { registrationStatus } from "@/db/schema/registrations";
import { Link } from "@/i18n/navigation";
import { routing } from "@/i18n/routing";
import { listAuditTrail } from "@/modules/audit/repository";
import {
  findRegistrationDetailForAdmin,
  listDeclarationAcceptances,
  listOutboxHistory,
} from "@/modules/registrations/admin-repository";
import { suggestFreeBibNumbers } from "@/modules/registrations/bibs";
import { journeyOf } from "@/modules/registrations/domain/journey";
import { raceNumberOf } from "@/modules/registrations/domain/race-number";
import { canResendReminder, deriveAllowedResendMessageType } from "@/modules/registrations/domain/resend";
import { canTransition, isTerminalStatus } from "@/modules/registrations/domain/state-machine";
import StaffJourney from "@/modules/registrations/ui/StaffJourney";
import { canManageRegistrations, canReadRegistrations } from "@/modules/staff-identity/domain/roles";
import { REGISTRATION_STATUS_LABEL } from "@/modules/staff-identity/domain/staff-labels";
import { requireStaff } from "@/modules/staff-identity/session";
import ConfirmSubmitButton from "@/shared/ui/ConfirmSubmitButton";
import GlyphButton from "@/shared/ui/GlyphButton";
import { BOXED_DISCLOSURE_SX } from "@/shared/ui/disclosure";
import { env } from "@/shared/config/env";
import {
  cancelRegistrationAction,
  checkInAction,
  confirmRegistrationNowAction,
  correctRegisteredNameAction,
  deleteRegistrationAction,
  promoteRegistrationAction,
  setBibNumberAction,
} from "../actions";
import { resendRegistrationEmailAction } from "./actions";

type Props = {
  params: Promise<{ locale: string; id: string }>;
  searchParams: Promise<{ resent?: string; saved?: string; error?: string }>;
};

export const dynamic = "force-dynamic";

/**
 * One registration's full timeline (AGENTS.md §15.8). The same gate as the list: whoever may
 * read the registrations, which since §289 includes the Organizer. The verbs on it — resend,
 * correct the name, cancel, erase — ask `canManageRegistrations` one at a time below, and each
 * one is refused again in its service (BR-REQ-060-01). The desk's verbs are every staff role's
 * and stay where they are.
 */
export default async function RegistrationDetailPage({ params, searchParams }: Props) {
  const { locale, id } = await params;
  if (!hasLocale(routing.locales, locale)) notFound();
  setRequestLocale(locale);

  const actor = await requireStaff();
  if (!canReadRegistrations(actor.role)) notFound();
  const mayManage = canManageRegistrations(actor.role);

  const db = getDb();
  const registration = await findRegistrationDetailForAdmin(db, id);
  if (!registration) notFound();

  const [acceptances, outboxHistory, auditTrail, freeBibs] = await Promise.all([
    listDeclarationAcceptances(db, id),
    listOutboxHistory(db, id),
    listAuditTrail(db, "registration", id),
    // The first free numbers, for a preferential one picked rather than guessed (§105).
    suggestFreeBibNumbers(db, registration.eventId),
  ]);

  const { resent, saved, error } = await searchParams;
  const tr = await getTranslations("Admin");
  const format = await getFormatter();
  const dt = (value: Date | null) => (value ? format.dateTime(value, { dateStyle: "medium", timeStyle: "short", hourCycle: "h23" }) : null);

  /*
    The form filled again with the same address (§312), out of the trail and into the timeline,
    oldest first like the lines around them. They are what the person did, not what the team
    did, so they leave "Ce a făcut echipa" to the team. Each says the state it found — "still
    waiting for the email link" is usually the whole answer to "she says she registered" — and
    what went out, in the words `/admin/emails` uses for that message.
  */
  const resubmissions = auditTrail
    .filter((entry) => entry.action === "registration.resubmitted")
    .reverse()
    .map((entry) => {
      const metadata = entry.metadataJson as { status?: unknown; resent?: unknown };
      const status = registrationStatus.enumValues.find((value) => value === metadata.status);
      const resent = emailMessageType.enumValues.find((value) => value === metadata.resent);
      const values = {
        date: dt(entry.createdAt) ?? "",
        state: status ? REGISTRATION_STATUS_LABEL[status] : "—",
      };
      return {
        text: resent
          ? tr("registrations.resubmittedSent", { ...values, message: tr(`emails.types.${resent}`) })
          : tr("registrations.resubmittedNothing", values),
        actorName: entry.actorName,
      };
    });
  const staffTrail = auditTrail.filter((entry) => entry.action !== "registration.resubmitted");

  const canResend = deriveAllowedResendMessageType(registration.status) !== null;
  // §10.5 has no edge from PENDING_EMAIL_CONFIRMATION to CANCELLED: an unconfirmed address
  // lapses on its own and holds no place, so there is nothing to release and no form to show.
  const canCancel = canTransition(registration.status, "CANCELLED");
  /*
    A settled number that is on paper (§264), and the same number on a registration that is over
    (§311): the first is what the cancel confirmation warns about before the press, the second is
    a bib in the club's pile that belongs to nobody — said as a chip beside the state, and on the
    timeline's own line, both from the row and without a join.
  */
  const printedBib = registration.bibPrintedAt !== null && registration.bibNumber !== null ? registration.bibNumber : null;
  const voidBib = printedBib !== null && isTerminalStatus(registration.status) ? printedBib : null;
  const voidSuffix = voidBib !== null ? ` · ${tr("registrations.bibVoid", { number: voidBib })}` : "";
  // The desk verbs (BR-REQ-037-07, -08), here too, so an Administrator at a laptop has them.
  const canConfirmNow =
    registration.status === "PENDING_EMAIL_CONFIRMATION" ||
    registration.status === "PENDING_DECLARATION" ||
    registration.status === "WAITLIST_OFFERED";
  const deskHidden = (
    <>
      <input type="hidden" name="uiLocale" value={locale} />
      <input type="hidden" name="registrationId" value={registration.id} />
    </>
  );
  // The three forms that carry a typed value answer a refusal with the value still in its box (§315).
  const refusal = await refusalMessages({
    registeredName: tr("registrations.participantName"),
    reason: tr("registrations.cancelReason"),
    confirm: tr("registrations.deleteConfirm"),
  });
  // The erase's own sentence: its "I understand" tick is asked again, never kept (§315).
  const eraseRefusal = { ...refusal, kept: (await refusalMessages({}, { confirmation: true })).kept };
  // The hand-set number's (§315): a CONFLICT here is a number somebody else wears, so the
  // sentence is "correct it and send again", not a colleague's save to reload for.
  const bibRefusal = await refusalMessages({ bibNumber: tr("registrations.bibNumber") });
  bibRefusal.keptConflict = bibRefusal.kept;

  return (
    <Stack spacing={3}>
      <Typography variant="body2">
        <Link href="/admin/registrations">{tr("registrations.backToList")}</Link>
      </Typography>

      <Box id="admin-alert" tabIndex={-1} sx={{ scrollMarginTop: 16 }}>
        {resent && <Alert severity="success">{tr("registrations.resendSent")}</Alert>}
        {saved && <Alert severity="success">{tr("saved")}</Alert>}
      {/* The action redirects with a language-neutral code (AGENTS.md 14.3); this is where it
          becomes a sentence. */}
        {error && <Alert severity="error">{tr(`errors.${error}`)}</Alert>}
      </Box>

      <Stack direction="row" spacing={1} sx={{ alignItems: "center", flexWrap: "wrap", gap: 1 }}>
        <Typography variant="h2" sx={{ fontSize: "1.25rem" }}>
          {registration.registeredName}
        </Typography>
        <Chip size="small" label={REGISTRATION_STATUS_LABEL[registration.status]} />
        {/* A printed bib nobody may wear (§311): the number stays retired, the paper comes out of the pile. */}
        {voidBib !== null && (
          <Chip size="small" color="error" variant="outlined" label={tr("registrations.bibVoid", { number: voidBib })} data-testid="void-bib" />
        )}
        {registration.kind === "TEST" && (
          <Chip size="small" color="warning" label={tr("registrations.testKind")} />
        )}
        {/* Mailgun bounced or the recipient complained (§76): the reason, so somebody calls. */}
        {registration.emailRejectedReason && (
          <Chip
            size="small"
            color="error"
            variant="outlined"
            label={`${tr("registrations.emailRejected")} — ${registration.emailRejectedReason}`}
            data-testid="email-rejected"
          />
        )}
        {/* BR-REQ-037-05: a staff-entered row behaves exactly like any other, and says so. */}
        {registration.source === "STAFF" && (
          <Chip size="small" variant="outlined" label={tr("registrations.enteredByStaff")} />
        )}
        {/* BR-REQ-031-06. A claim, worded as one wherever it is shown. */}
        {registration.clubMemberDeclared && (
          <Chip size="small" color="info" variant="outlined" label={tr("registrations.clubMemberChip")} />
        )}
      </Stack>
      {/* Where this person is, as steps (§145): the same derivation the list's "Etapă"
          column uses, so the page never contradicts the row that led here. */}
      <StaffJourney journey={journeyOf(registration)} bibNumber={raceNumberOf(registration)?.value ?? null} variant="full" />
      <Typography variant="body2" color="text.secondary">
        {registration.participantEmail} · {registration.eventTitle ?? registration.eventId}
      </Typography>
      {registration.guardianName && (
        <Typography variant="body2" color="text.secondary">
          {tr("desk.guardian", { name: registration.guardianName })}
        </Typography>
      )}
      {/* The socials the person offered (§106): links to follow back, never published here. */}
      {(registration.stravaUrl || registration.instagramHandle) && (
        <Typography variant="body2" color="text.secondary">
          {registration.stravaUrl && (
            <MuiLink href={registration.stravaUrl} target="_blank" rel="noopener noreferrer nofollow">
              Strava
            </MuiLink>
          )}
          {registration.stravaUrl && registration.instagramHandle ? " · " : ""}
          {registration.instagramHandle && (
            <MuiLink href={`https://www.instagram.com/${encodeURIComponent(registration.instagramHandle)}/`} target="_blank" rel="noopener noreferrer nofollow">
              @{registration.instagramHandle}
            </MuiLink>
          )}
        </Typography>
      )}

      {/* Sending a participant a message is the Administrator's (§15.8, §289). */}
      <Stack direction="row" spacing={1} sx={{ flexWrap: "wrap", gap: 1 }}>
        {mayManage && (
          <form action={resendRegistrationEmailAction}>
            <input type="hidden" name="uiLocale" value={locale} />
            <input type="hidden" name="registrationId" value={registration.id} />
            <GlyphButton icon="resend" type="submit" variant="outlined" disabled={!canResend}>
              {tr("registrations.resend")}
            </GlyphButton>
          </form>
        )}
        {/* The reminder by hand (§81): confirmed, and the event still ahead. */}
        {mayManage && canResendReminder(registration.status, registration.eventStartsAt, new Date()) && (
          <form action={resendRegistrationEmailAction}>
            <input type="hidden" name="uiLocale" value={locale} />
            <input type="hidden" name="registrationId" value={registration.id} />
            <input type="hidden" name="messageType" value="EVENT_REMINDER" />
            <GlyphButton icon="send" type="submit" variant="outlined">
              {tr("registrations.sendReminder")}
            </GlyphButton>
          </form>
        )}
      </Stack>

      <Divider />

      {/*
        Race day (BR-REQ-037-07, BR-REQ-037-08). The same verbs the desk offers, on the full
        page: confirm on a paper declaration, give a waiting-list entry a free place, type a
        number, mark them here. The code and its QR are shown so a runner who lost the email
        can be given it again from a screen.
      */}
      <Box component="section">
        <Typography variant="h3" sx={{ fontSize: "1rem", mb: 1 }}>
          {tr("registrations.raceDayTitle")}
        </Typography>
        <Stack spacing={2}>
          {canConfirmNow && (
            <form action={confirmRegistrationNowAction}>
              {deskHidden}
              <Stack direction={{ xs: "column", sm: "row" }} spacing={2} sx={{ alignItems: { sm: "center" } }}>
                <GlyphButton icon="confirm" type="submit" variant="contained" color="warning" sx={{ minHeight: 44 }}>
                  {tr("desk.confirmHere")}
                </GlyphButton>
                <Typography variant="body2" color="text.secondary">
                  {tr("desk.fastTrackHelp")}
                </Typography>
              </Stack>
            </form>
          )}
          {registration.status === "WAITLISTED" && (
            <form action={promoteRegistrationAction}>
              {deskHidden}
              <GlyphButton icon="place" type="submit" variant="outlined" sx={{ minHeight: 44 }}>
                {tr("desk.givePlace")}
              </GlyphButton>
            </form>
          )}
          {registration.status === "CONFIRMED" && (
            <>
              {/* Only where there is a gap to fill (§173): a confirmed runner's number is
                  settled — they have it in their inbox and it may be printed — so the service
                  refuses a change, and a box that always refuses invites the press. The number
                  itself is on the journey above. */}
              {registration.bibNumber === null ? (
                /*
                  The number, and the way to change it folded underneath (§232; the owner: "I
                  wanna simplify that part with the BID changing").

                  It had grown into four things stacked up — a sentence, a prefilled box, a
                  button and a list of every free number at the event — for a screen whose
                  question is almost always just "what number does this person have". So the
                  answer is one line, and the change is a `<details>` that opens on the rare
                  occasion somebody wants it: the same idiom the registrations list uses for
                  its destructive verbs and the public form for its optional groups, which
                  costs no client island and opens with JavaScript off.

                  Changing it by hand is still §105's preferential number, and still settles
                  it (§230) — which is why the free numbers stay, inside, where somebody who
                  has decided to change it can read them.
                */
                <Stack spacing={1} sx={{ alignItems: "flex-start" }}>
                  <Typography variant="body2">
                    {registration.provisionalBibNumber !== null
                      ? tr("registrations.bibHeldNow", { number: registration.provisionalBibNumber })
                      : tr("registrations.bibNone")}
                  </Typography>
                  {/* The box spans the section, whatever the Stack does with its other children.
                      A refused number comes back in its box with the fold open (§315). */}
                  <Box sx={{ alignSelf: "stretch" }}>
                  <ActionForm action={setBibNumberAction} messages={bibRefusal} scope="bib" data-testid="set-bib-form">
                  <RecallDetails sx={BOXED_DISCLOSURE_SX}>
                    <Typography component="summary" variant="body2" color="primary">
                      {tr("registrations.bibChange")}
                    </Typography>
                    <Box>
                      {deskHidden}
                      <Stack direction="row" spacing={1} sx={{ alignItems: "center" }}>
                        <RecallField
                          name="bibNumber"
                          type="number"
                          label={tr("registrations.bibNumber")}
                          size="small"
                          defaultValue={registration.provisionalBibNumber ?? ""}
                          slotProps={{ htmlInput: { min: 1, max: 99999 } }}
                          sx={{ width: 140 }}
                        />
                        <GlyphButton icon="number" type="submit" variant="outlined" sx={{ minHeight: 44 }}>
                          {tr("desk.saveBib")}
                        </GlyphButton>
                      </Stack>
                      <Typography variant="caption" color="text.secondary" sx={{ display: "block", mt: 0.5 }}>
                        {tr("desk.bibFree", { numbers: freeBibs.join(", ") })}
                      </Typography>
                    </Box>
                  </RecallDetails>
                  </ActionForm>
                  </Box>
                </Stack>
              ) : (
                <Stack spacing={1} sx={{ alignItems: "flex-start" }}>
                  <Typography variant="body2" color="text.secondary">
                    {tr("registrations.bibSettled", { number: registration.bibNumber })}
                  </Typography>
                  {/*
                    This one bib, on its own A4 page (§180). The same route the event's sheet
                    uses, asked for a range of exactly one and the one-per-page layout — so
                    there is one renderer, one authorization check and one design, and a
                    volunteer who has to reprint a single number does not download two hundred.
                  */}
                  <GlyphButton
                    icon="print"
                    href={`/api/admin/events/${registration.eventId}/bibs?locale=${locale}&from=${registration.bibNumber}&to=${registration.bibNumber}&layout=one`}
                    variant="outlined"
                    sx={{ minHeight: 44 }}
                  >
                    {tr("registrations.downloadBib")}
                  </GlyphButton>
                </Stack>
              )}
              <form action={checkInAction}>
                {deskHidden}
                <input type="hidden" name="direction" value={registration.checkedInAt ? "undo" : "in"} />
                <Stack direction={{ xs: "column", sm: "row" }} spacing={2} sx={{ alignItems: { sm: "center" } }}>
                  <GlyphButton
                    icon={registration.checkedInAt ? "undo" : "checkIn"}
                    type="submit"
                    variant={registration.checkedInAt ? "outlined" : "contained"}
                    color={registration.checkedInAt ? "inherit" : "success"}
                    sx={{ minHeight: 44 }}
                  >
                    {registration.checkedInAt ? tr("desk.undoCheckIn") : tr("desk.checkIn")}
                  </GlyphButton>
                  <Typography variant="body2" color="text.secondary">
                    {registration.checkedInAt
                      ? tr("registrations.checkedIn", {
                          time: dt(registration.checkedInAt) ?? "",
                          who: registration.checkedInByName ?? tr("desk.bySelf"),
                        })
                      : tr("registrations.notCheckedIn")}
                  </Typography>
                </Stack>
              </form>
              {registration.checkinCode && (
                <Stack direction={{ xs: "column", sm: "row" }} spacing={2} sx={{ alignItems: { sm: "flex-start" } }}>
                  {/* Hosted, not inlined — the same image the email links to, so what the
                      screen shows is what the phone shows. */}
                  <Box
                    component="img"
                    src={`${env.APP_BASE_URL}/api/registrations/qr/${registration.checkinCode}.png`}
                    alt={tr("registrations.qrAlt", { code: registration.checkinCode })}
                    width={160}
                    height={160}
                    sx={{ width: 160, height: 160, border: 1, borderColor: "divider", borderRadius: 1 }}
                  />
                  <Box>
                    <Typography variant="body2">
                      {tr("registrations.checkinCode")}:{" "}
                      <Box component="span" sx={{ fontFamily: "monospace", fontWeight: 700, fontSize: "1.1rem" }}>
                        {registration.checkinCode}
                      </Box>
                    </Typography>
                    <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5 }}>
                      {tr("registrations.checkinCodeHelp")}
                    </Typography>
                    <Typography variant="body2" sx={{ mt: 1 }}>
                      <Link href={{ pathname: "/admin/checkin/[code]", params: { code: registration.checkinCode } }}>
                        {tr("registrations.openDesk")}
                      </Link>
                    </Typography>
                  </Box>
                </Stack>
              )}
            </>
          )}
        </Stack>
      </Box>

      <Divider />

      {/*
        The one editable field (BR-REQ-037-03 criterion 1), and the audit trail below records
        what it was before. There is deliberately no email field here: the verified address is
        the participant's identity (AGENTS.md 10.3), and a typo is fixed by cancelling and
        registering again with the right one — criterion 2 asks for exactly that absence.
      */}
      {mayManage && (
      <Box component="section">
        <Typography variant="h3" sx={{ fontSize: "1rem", mb: 1 }}>
          {tr("registrations.correctName")}
        </Typography>
        <ActionForm action={correctRegisteredNameAction} messages={refusal} scope="rename" data-testid="correct-name-form">
          <input type="hidden" name="uiLocale" value={locale} />
          <input type="hidden" name="registrationId" value={registration.id} />
          <Stack direction={{ xs: "column", sm: "row" }} spacing={2} sx={{ alignItems: "flex-start" }}>
            <RecallField
              name="registeredName"
              label={tr("registrations.participantName")}
              defaultValue={registration.registeredName}
              size="small"
              required
              slotProps={{ htmlInput: { maxLength: 200 } }}
              sx={{ flex: 1 }}
            />
            <GlyphButton icon="rename" type="submit" variant="outlined" sx={{ minHeight: 44 }}>
              {tr("registrations.saveName")}
            </GlyphButton>
          </Stack>
        </ActionForm>
        <Typography variant="body2" color="text.secondary" sx={{ mt: 1 }}>
          {tr("registrations.correctNameHelp")}
        </Typography>
      </Box>
      )}

      {/*
        Cancelling is what "remove this registration" means: the row is the record of what
        somebody agreed to, so nothing deletes it. The place is released inside the same locked
        transaction a participant's own cancellation uses, and goes to the front of the waiting
        list rather than to whoever registers next (AGENTS.md 15.5, 15.6).
      */}
      {mayManage && canCancel && (
        <Box component="section">
          <Typography variant="h3" sx={{ fontSize: "1rem", mb: 1 }}>
            {tr("registrations.cancelTitle")}
          </Typography>
          <ActionForm action={cancelRegistrationAction} messages={refusal} scope="cancel" data-testid="cancel-registration-form">
            <input type="hidden" name="uiLocale" value={locale} />
            <input type="hidden" name="registrationId" value={registration.id} />
            <Stack direction={{ xs: "column", sm: "row" }} spacing={2} sx={{ alignItems: "flex-start" }}>
              <RecallField
                name="reason"
                label={tr("registrations.cancelReason")}
                size="small"
                required
                slotProps={{ htmlInput: { maxLength: 500 } }}
                sx={{ flex: 1 }}
              />
              <ConfirmSubmitButton
                label={tr("registrations.cancelAction")}
                icon="cancel"
                title={tr("confirm.cancelRegistrationTitle")}
                // The printed bib is named before the press (§311), not discovered in the pile.
                body={
                  printedBib !== null
                    ? `${tr("confirm.cancelRegistrationPrintedBody", { number: printedBib })} ${tr("confirm.cancelRegistrationBody")}`
                    : tr("confirm.cancelRegistrationBody")
                }
                confirmLabel={tr("registrations.cancelAction")}
                cancelLabel={tr("confirm.cancel")}
                color="error"
              />
            </Stack>
          </ActionForm>
          <Typography variant="body2" color="text.secondary" sx={{ mt: 1 }}>
            {tr("registrations.cancelHelp")}
          </Typography>
        </Box>
      )}

      {/*
        Erasure, not withdrawal (BR-REQ-037-06), and on its own gate (§179).

        Deliberately below cancel and styled as the heavier of the two: for a runner who simply
        drops out, cancelling is right and keeps the record. This is for the case cancelling
        cannot answer — somebody asking to be removed, or a row somebody made while testing.

        It used to sit inside the cancel section, which is shown only while the registration can
        still be cancelled — so a registration that was already cancelled or expired could never
        be erased, which is exactly the row most likely to need it. The service has always
        handled either case: it releases the place only when there is one to release.
      */}
      {canManageRegistrations(actor.role) && (
        <Box component="section">
          {/* The shared box, red: the one fold on the screen that destroys, and its border says so.
              A refusal keeps the reason and asks for the "I understand" tick again (§315); the
              form holds the fold, so the fold opens with the refusal rather than hiding it. */}
          <ActionForm action={deleteRegistrationAction} messages={eraseRefusal} scope="erase" data-testid="erase-registration-form">
          <RecallDetails sx={{ ...BOXED_DISCLOSURE_SX, mt: 3, borderColor: "error.light" }}>
            <Typography component="summary" variant="subtitle2" color="error.main">
              {tr("registrations.deleteTitle")}
            </Typography>
              <input type="hidden" name="uiLocale" value={locale} />
              <input type="hidden" name="registrationId" value={registration.id} />
              <Stack spacing={2} sx={{ pb: 0.5 }}>
                <Typography variant="body2" color="text.secondary">
                  {tr("registrations.deleteHelp")}
                </Typography>
                <RecallField name="reason" label={tr("registrations.deleteReason")} required slotProps={{ htmlInput: { maxLength: 500 } }} />
                <CheckboxField name="confirm" required>
                  {tr("registrations.deleteConfirm")}
                </CheckboxField>
                <Box>
                  <GlyphButton icon="erase" type="submit" color="error" variant="contained">
                    {tr("registrations.deleteAction")}
                  </GlyphButton>
                </Box>
              </Stack>
          </RecallDetails>
          </ActionForm>
        </Box>
      )}

      <Stack spacing={1}>
        <Typography variant="h3" sx={{ fontSize: "1rem" }}>
          {tr("registrations.timeline")}
        </Typography>
        <Typography variant="body2">
          {tr("registrations.submitted")}: {dt(registration.submittedAt)}
        </Typography>
        {/* Each time the form came back with the same address, right under the first (§312). */}
        {resubmissions.map((line, index) => (
          <Typography key={`resubmitted-${index}`} variant="body2" data-testid="timeline-resubmitted">
            {line.text}
            {line.actorName ? ` · ${line.actorName}` : ""}
          </Typography>
        ))}
        {[
          [
            tr("registrations.emailConfirmed"),
            registration.emailConfirmedAt
              ? `${dt(registration.emailConfirmedAt)}${registration.emailConfirmedByName ? ` (${tr("registrations.emailVouched", { who: registration.emailConfirmedByName })})` : ""}`
              : null,
          ],
          [tr("registrations.waitlisted"), dt(registration.waitlistedAt)],
          [tr("registrations.offerCreated"), dt(registration.offerCreatedAt)],
          [tr("registrations.holdExpires"), dt(registration.holdExpiresAt)],
          [tr("registrations.confirmed"), dt(registration.confirmedAt)],
          // "cancelled; bib 27 was printed" on the line itself (§311), whoever cancelled — the
          // participant's link and the job write no audit row, so the row is the record.
          [
            tr("registrations.cancelled"),
            registration.cancelledAt
              ? `${dt(registration.cancelledAt)} (${registration.cancellationSource})${registration.status === "CANCELLED" ? voidSuffix : ""}`
              : null,
          ],
          [
            tr("registrations.expired"),
            registration.expiredAt
              ? `${dt(registration.expiredAt)} (${registration.expiryReason})${registration.status === "EXPIRED" ? voidSuffix : ""}`
              : null,
          ],
        ]
          .filter(([, value]) => value !== null)
          .map(([label, value]) => (
            <Typography key={label} variant="body2">
              {label}: {value}
            </Typography>
          ))}
        {acceptances.map((acceptance, index) => (
          <Typography key={index} variant="body2">
            {tr("registrations.declaration")}: {dt(acceptance.acceptedAt)} —{" "}
            <Box component="span" sx={{ fontFamily: "var(--font-signature), cursive", fontSize: "1.375rem" }}>
              {acceptance.typedName}
            </Box>{" "}
            (v{acceptance.declarationVersion})
            {acceptance.idDocument && ` — ${tr("registrations.idDocument")}: ${acceptance.idDocument}`}
            {index === 0 && (
              <>
                {" — "}
                <a href={`/api/admin/registrations/${registration.id}/declaration`} target="_blank" rel="noopener">
                  {tr("registrations.declarationPdf")}
                </a>
              </>
            )}
            {acceptance.method === "PAPER" &&
              ` — ${tr("registrations.declarationPaper", { who: acceptance.attestedByName ?? tr("registrations.auditActorRemoved") })}`}
          </Typography>
        ))}
      </Stack>

      {staffTrail.length > 0 && (
        <Stack spacing={1}>
          <Typography variant="h3" sx={{ fontSize: "1rem" }}>
            {tr("registrations.auditTrail")}
          </Typography>
          {staffTrail.map((entry, index) => (
            <Typography key={index} variant="body2">
              {dt(entry.createdAt)} · {tr(`registrations.audit.${entry.action}`)} ·{" "}
              {entry.actorName ??
                (entry.actorStaffUserId === null
                  ? tr("registrations.auditActorParticipant")
                  : tr("registrations.auditActorRemoved"))}
              {/* Metadata is the shape of the change — a name before and after, a typed reason —
                  never a copy of what the change was about (AGENTS.md 12.12). */}
              {Object.keys(entry.metadataJson as object).length > 0 &&
                ` · ${JSON.stringify(entry.metadataJson)}`}
            </Typography>
          ))}
        </Stack>
      )}

      <Stack spacing={1}>
        <Typography variant="h3" sx={{ fontSize: "1rem" }}>
          {tr("registrations.outboxHistory")}
        </Typography>
        {outboxHistory.map((row, index) => (
          <Typography key={index} variant="body2" color="text.secondary">
            {dt(row.createdAt)} · {row.messageType} · {row.status}
            {row.isManualResend ? ` · ${tr("registrations.resend")}` : ""}
            {/* A club mailbox's copy (§320), so it does not read as the participant being sent it twice. */}
            {row.clubCopy ? ` · ${tr("registrations.outboxClubCopy")}` : ""}
          </Typography>
        ))}
      </Stack>
    </Stack>
  );
}
