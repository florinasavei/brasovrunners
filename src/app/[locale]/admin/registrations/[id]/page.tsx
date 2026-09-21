import Alert from "@mui/material/Alert";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import MuiLink from "@mui/material/Link";
import Chip from "@mui/material/Chip";
import Divider from "@mui/material/Divider";
import Stack from "@mui/material/Stack";
import TextField from "@mui/material/TextField";
import Typography from "@mui/material/Typography";
import CheckboxField from "@/shared/ui/CheckboxField";
import { hasLocale } from "next-intl";
import { getFormatter, getTranslations, setRequestLocale } from "next-intl/server";
import { notFound } from "next/navigation";
import { getDb } from "@/db/client";
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
import { canTransition } from "@/modules/registrations/domain/state-machine";
import StaffJourney from "@/modules/registrations/ui/StaffJourney";
import { canManageRegistrations } from "@/modules/staff-identity/domain/roles";
import { REGISTRATION_STATUS_LABEL } from "@/modules/staff-identity/domain/staff-labels";
import { requireStaff } from "@/modules/staff-identity/session";
import ConfirmSubmitButton from "@/shared/ui/ConfirmSubmitButton";
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

/** One registration's full timeline (AGENTS.md §15.8). Administrator only, same gate as the list. */
export default async function RegistrationDetailPage({ params, searchParams }: Props) {
  const { locale, id } = await params;
  if (!hasLocale(routing.locales, locale)) notFound();
  setRequestLocale(locale);

  const actor = await requireStaff();
  if (!canManageRegistrations(actor.role)) notFound();

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

  const canResend = deriveAllowedResendMessageType(registration.status) !== null;
  // §10.5 has no edge from PENDING_EMAIL_CONFIRMATION to CANCELLED: an unconfirmed address
  // lapses on its own and holds no place, so there is nothing to release and no form to show.
  const canCancel = canTransition(registration.status, "CANCELLED");
  const dt = (value: Date | null) => (value ? format.dateTime(value, { dateStyle: "medium", timeStyle: "short", hourCycle: "h23" }) : null);
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

      <Stack direction="row" spacing={1} sx={{ flexWrap: "wrap", gap: 1 }}>
        <form action={resendRegistrationEmailAction}>
          <input type="hidden" name="uiLocale" value={locale} />
          <input type="hidden" name="registrationId" value={registration.id} />
          <Button type="submit" variant="outlined" disabled={!canResend}>
            {tr("registrations.resend")}
          </Button>
        </form>
        {/* The reminder by hand (§81): confirmed, and the event still ahead. */}
        {canResendReminder(registration.status, registration.eventStartsAt, new Date()) && (
          <form action={resendRegistrationEmailAction}>
            <input type="hidden" name="uiLocale" value={locale} />
            <input type="hidden" name="registrationId" value={registration.id} />
            <input type="hidden" name="messageType" value="EVENT_REMINDER" />
            <Button type="submit" variant="outlined">
              {tr("registrations.sendReminder")}
            </Button>
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
                <Button type="submit" variant="contained" color="warning" sx={{ minHeight: 44 }}>
                  {tr("desk.confirmHere")}
                </Button>
                <Typography variant="body2" color="text.secondary">
                  {tr("desk.fastTrackHelp")}
                </Typography>
              </Stack>
            </form>
          )}
          {registration.status === "WAITLISTED" && (
            <form action={promoteRegistrationAction}>
              {deskHidden}
              <Button type="submit" variant="outlined" sx={{ minHeight: 44 }}>
                {tr("desk.givePlace")}
              </Button>
            </form>
          )}
          {registration.status === "CONFIRMED" && (
            <>
              {/* Only where there is a gap to fill (§173): a confirmed runner's number is
                  settled — they have it in their inbox and it may be printed — so the service
                  refuses a change, and a box that always refuses invites the press. The number
                  itself is on the journey above. */}
              {registration.bibNumber === null ? (
                <form action={setBibNumberAction}>
                  {deskHidden}
                  {/*
                    The number this runner already holds, said before the box that changes it
                    (§230; the owner: "this input does not make any sense now! Amalia already
                    has number 2 reserved").

                    Since §214 a place-holding registration carries a **provisional** number
                    from the moment it is made, and `bib_number` stays empty until the window
                    closes — so this branch, which asks "has a number been settled", was
                    rendering an empty "give this runner a number" box to somebody who had one
                    reserved and was showing them the free numbers with theirs left out of the
                    list. The box is right to be here — a preferential number is still typed by
                    hand (§105) — and it is a *change*, not a gift, so it says so and shows
                    what it would replace.
                  */}
                  {registration.provisionalBibNumber !== null && (
                    <Typography variant="body2" sx={{ mb: 1 }}>
                      {tr("registrations.bibHeldNow", { number: registration.provisionalBibNumber })}
                    </Typography>
                  )}
                  <Stack direction="row" spacing={1} sx={{ alignItems: "center" }}>
                    <TextField
                      name="bibNumber"
                      type="number"
                      label={tr("registrations.bibNumber")}
                      size="small"
                      defaultValue={registration.provisionalBibNumber ?? ""}
                      slotProps={{ htmlInput: { min: 1, max: 99999 } }}
                      sx={{ width: 140 }}
                    />
                    <Button type="submit" variant="outlined" sx={{ minHeight: 44 }}>
                      {tr("desk.saveBib")}
                    </Button>
                  </Stack>
                  {/* A preferential number is picked among the free ones (§105): the first free
                      numbers, and the runner is emailed the one that is saved. */}
                  <Typography variant="caption" color="text.secondary" sx={{ display: "block", mt: 0.5 }}>
                    {tr("desk.bibFree", { numbers: freeBibs.join(", ") })}
                  </Typography>
                </form>
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
                  <Button
                    component="a"
                    href={`/api/admin/events/${registration.eventId}/bibs?locale=${locale}&from=${registration.bibNumber}&to=${registration.bibNumber}&layout=one`}
                    variant="outlined"
                    sx={{ minHeight: 44 }}
                  >
                    {tr("registrations.downloadBib")}
                  </Button>
                </Stack>
              )}
              <form action={checkInAction}>
                {deskHidden}
                <input type="hidden" name="direction" value={registration.checkedInAt ? "undo" : "in"} />
                <Stack direction={{ xs: "column", sm: "row" }} spacing={2} sx={{ alignItems: { sm: "center" } }}>
                  <Button
                    type="submit"
                    variant={registration.checkedInAt ? "outlined" : "contained"}
                    color={registration.checkedInAt ? "inherit" : "success"}
                    sx={{ minHeight: 44 }}
                  >
                    {registration.checkedInAt ? tr("desk.undoCheckIn") : tr("desk.checkIn")}
                  </Button>
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
      <Box component="section">
        <Typography variant="h3" sx={{ fontSize: "1rem", mb: 1 }}>
          {tr("registrations.correctName")}
        </Typography>
        <form action={correctRegisteredNameAction}>
          <input type="hidden" name="uiLocale" value={locale} />
          <input type="hidden" name="registrationId" value={registration.id} />
          <Stack direction={{ xs: "column", sm: "row" }} spacing={2} sx={{ alignItems: "flex-start" }}>
            <TextField
              name="registeredName"
              label={tr("registrations.participantName")}
              defaultValue={registration.registeredName}
              size="small"
              required
              sx={{ flex: 1 }}
            />
            <Button type="submit" variant="outlined" sx={{ minHeight: 44 }}>
              {tr("registrations.saveName")}
            </Button>
          </Stack>
        </form>
        <Typography variant="body2" color="text.secondary" sx={{ mt: 1 }}>
          {tr("registrations.correctNameHelp")}
        </Typography>
      </Box>

      {/*
        Cancelling is what "remove this registration" means: the row is the record of what
        somebody agreed to, so nothing deletes it. The place is released inside the same locked
        transaction a participant's own cancellation uses, and goes to the front of the waiting
        list rather than to whoever registers next (AGENTS.md 15.5, 15.6).
      */}
      {canCancel && (
        <Box component="section">
          <Typography variant="h3" sx={{ fontSize: "1rem", mb: 1 }}>
            {tr("registrations.cancelTitle")}
          </Typography>
          <form action={cancelRegistrationAction}>
            <input type="hidden" name="uiLocale" value={locale} />
            <input type="hidden" name="registrationId" value={registration.id} />
            <Stack direction={{ xs: "column", sm: "row" }} spacing={2} sx={{ alignItems: "flex-start" }}>
              <TextField
                name="reason"
                label={tr("registrations.cancelReason")}
                size="small"
                required
                sx={{ flex: 1 }}
              />
              <ConfirmSubmitButton
                label={tr("registrations.cancelAction")}
                title={tr("confirm.cancelRegistrationTitle")}
                body={tr("confirm.cancelRegistrationBody")}
                confirmLabel={tr("registrations.cancelAction")}
                cancelLabel={tr("confirm.cancel")}
                color="error"
              />
            </Stack>
          </form>
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
          <Box component="details" sx={{ mt: 3, border: 1, borderColor: "error.light", borderRadius: 1, px: 2, "& > summary": { cursor: "pointer", py: 1.5, listStyle: "revert" } }}>
            <Typography component="summary" variant="subtitle2" color="error.main">
              {tr("registrations.deleteTitle")}
            </Typography>
            <form action={deleteRegistrationAction}>
              <input type="hidden" name="uiLocale" value={locale} />
              <input type="hidden" name="registrationId" value={registration.id} />
              <Stack spacing={2} sx={{ pb: 2 }}>
                <Typography variant="body2" color="text.secondary">
                  {tr("registrations.deleteHelp")}
                </Typography>
                <TextField name="reason" label={tr("registrations.deleteReason")} required />
                <CheckboxField name="confirm" required>
                  {tr("registrations.deleteConfirm")}
                </CheckboxField>
                <Box>
                  <Button type="submit" color="error" variant="contained">
                    {tr("registrations.deleteAction")}
                  </Button>
                </Box>
              </Stack>
            </form>
          </Box>
        </Box>
      )}

      <Stack spacing={1}>
        <Typography variant="h3" sx={{ fontSize: "1rem" }}>
          {tr("registrations.timeline")}
        </Typography>
        {[
          [tr("registrations.submitted"), dt(registration.submittedAt)],
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
          [tr("registrations.cancelled"), registration.cancelledAt ? `${dt(registration.cancelledAt)} (${registration.cancellationSource})` : null],
          [tr("registrations.expired"), registration.expiredAt ? `${dt(registration.expiredAt)} (${registration.expiryReason})` : null],
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

      {auditTrail.length > 0 && (
        <Stack spacing={1}>
          <Typography variant="h3" sx={{ fontSize: "1rem" }}>
            {tr("registrations.auditTrail")}
          </Typography>
          {auditTrail.map((entry, index) => (
            <Typography key={index} variant="body2">
              {dt(entry.createdAt)} · {tr(`registrations.audit.${entry.action}`)} ·{" "}
              {entry.actorName ?? tr("registrations.auditActorRemoved")}
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
          </Typography>
        ))}
      </Stack>
    </Stack>
  );
}
