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
import { getTranslations, setRequestLocale } from "next-intl/server";
import { CLUB_TIME_ZONE, formatDay } from "@/i18n/dates";
import { notFound } from "next/navigation";
import { getDb } from "@/db/client";
import { emailMessageType } from "@/db/schema/email-outbox";
import { registrationStatus } from "@/db/schema/registrations";
import { getPathname, Link } from "@/i18n/navigation";
import { routing } from "@/i18n/routing";
import { listAuditTrail } from "@/modules/audit/repository";
import { declarationAsksMinorToSign } from "@/modules/legal-documents/repository";
import {
  findRegistrationDetailForAdmin,
  listDeclarationAcceptances,
  listOutboxHistory,
} from "@/modules/registrations/admin-repository";
import { readEmergencyDetails } from "@/modules/registrations/admin-service";
import { sealPersonLookup } from "@/modules/registrations/person-data";
import { suggestFreeBibNumbers } from "@/modules/registrations/bibs";
import { journeyOf } from "@/modules/registrations/domain/journey";
import { raceNumberOf } from "@/modules/registrations/domain/race-number";
import { canResendReminder, deriveAllowedResendMessageType } from "@/modules/registrations/domain/resend";
import { canTransition, isTerminalStatus } from "@/modules/registrations/domain/state-machine";
import StaffJourney from "@/modules/registrations/ui/StaffJourney";
import { canManageRegistrations, canReadRegistrations } from "@/modules/staff-identity/domain/roles";
import { REGISTRATION_STATUS_LABEL } from "@/modules/staff-identity/domain/staff-labels";
import { requireStaff } from "@/modules/staff-identity/session";
import { isUuid } from "@/shared/ids";
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
  withdrawConsentAction,
} from "../actions";
import { resendRegistrationEmailAction } from "./actions";

type Props = {
  params: Promise<{ locale: string; id: string }>;
  searchParams: Promise<{ resent?: string; saved?: string; error?: string; health?: string }>;
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
  // A malformed id is the same 404 an unknown one gets, not the query Postgres refuses (§NNN).
  if (!isUuid(id)) notFound();
  const mayManage = canManageRegistrations(actor.role);

  const db = getDb();
  const registration = await findRegistrationDetailForAdmin(db, id);
  if (!registration) notFound();

  const [acceptances, outboxHistory, auditTrail, freeBibs, minorSigns] = await Promise.all([
    listDeclarationAcceptances(db, id),
    listOutboxHistory(db, id),
    listAuditTrail(db, "registration", id),
    // The first free numbers, for a preferential one picked rather than guessed (§105).
    suggestFreeBibNumbers(db, registration.eventId),
    /*
      Whether "Confirmă pe hârtie" on a minor attests the minor's signature too (§330): the
      declaration in effect in this registration's language — the one the press binds to — asks
      the minor to sign. Read only for a minor; an adult's paper carries one signature anyway.
    */
    registration.guardianName ? declarationAsksMinorToSign(db, registration.locale, new Date()) : false,
  ]);

  const { resent, saved, error, health } = await searchParams;
  const tr = await getTranslations("Admin");
  // The timeline's short form with the time (§349): a value beside its label, so capitalised;
  // `dtInline` inside a sentence.
  const dt = (value: Date | null) => (value ? formatDay(value, { locale, timeZone: CLUB_TIME_ZONE, style: "short", withTime: true }) : null);
  const dtInline = (value: Date | null) =>
    value ? formatDay(value, { locale, timeZone: CLUB_TIME_ZONE, style: "short", withTime: true, position: "inline" }) : null;

  /*
    The emergency details (§322): the phone, the emergency contact and the health note — what
    the form collected "for race day" and nothing here could show. Read only when asked for
    (`?health=1`, a plain link, so no prefetch opens it on somebody's behalf), and each read is
    recorded before the values come back (`readEmergencyDetails`), because the trail is how the
    club answers "who has seen my health note". The gate is the page's own — whoever may read
    the registrations — asserted again in the service. Never on the desk (§15.11).
  */
  const emergency = health === "1" ? await readEmergencyDetails(db, actor, registration.id, new Date()) : null;
  const detailPath = getPathname({ locale, href: { pathname: "/admin/registrations/[id]", params: { id: registration.id } } });
  // Everything held about this person, one link away for the Administrator (§322) — the address
  // sealed, never written into the URL (`person-data.ts`).
  const personLookup = mayManage ? sealPersonLookup(registration.participantCanonicalEmail, new Date()) : null;
  const personHref = personLookup
    ? `${getPathname({ locale, href: "/admin/registrations/person" })}?q=${encodeURIComponent(personLookup)}`
    : null;
  // What the withdrawal panel can clear (§322): the groups this row still holds, as booleans.
  const withdrawable = {
    health: registration.holdsHealthNote,
    socials: registration.stravaUrl !== null || registration.instagramHandle !== null,
    results: registration.resultsNameConsent,
  };

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
        {personHref && (
          <GlyphButton icon="personData" href={personHref} variant="text" sx={{ minHeight: 44 }}>
            {tr("registrations.personThis")}
          </GlyphButton>
        )}
      </Stack>

      {/*
        Emergency and health (§322): for the people they are for, and only when asked. Folded
        behind a plain link rather than rendered with the page, so opening a registration to fix
        a name does not read — and record reading — somebody's health note.
      */}
      <Box component="section" id="emergency" sx={{ scrollMarginTop: 16 }}>
        <Typography variant="h3" sx={{ fontSize: "1rem", mb: 1 }}>
          {tr("registrations.emergency.title")}
        </Typography>
        {emergency ? (
          <Stack spacing={1}>
            <Typography variant="body2">
              {tr("registrations.emergency.phone")}: {emergency.phone ?? tr("registrations.emergency.none")}
            </Typography>
            <Typography variant="body2">
              {tr("registrations.emergency.contact")}:{" "}
              {emergency.emergencyContactName || emergency.emergencyContactPhone
                ? [emergency.emergencyContactName, emergency.emergencyContactPhone].filter(Boolean).join(" · ")
                : tr("registrations.emergency.none")}
            </Typography>
            <Typography variant="body2" component="div">
              {tr("registrations.emergency.health")}:{" "}
              {emergency.healthNotes ? (
                <>
                  <Box component="span" sx={{ whiteSpace: "pre-wrap" }}>
                    {emergency.healthNotes}
                  </Box>
                  {emergency.healthConsentAt && (
                    <Typography variant="caption" color="text.secondary" sx={{ display: "block" }}>
                      {tr("registrations.emergency.healthConsented", { date: dtInline(emergency.healthConsentAt) ?? "" })}
                    </Typography>
                  )}
                </>
              ) : (
                tr("registrations.emergency.healthNone")
              )}
            </Typography>
            <Typography variant="caption" color="text.secondary">
              {tr("registrations.emergency.viewed")}
            </Typography>
            <Box>
              <GlyphButton icon="dismiss" href={`${detailPath}#emergency`} variant="text" size="small" sx={{ minHeight: 44 }}>
                {tr("registrations.emergency.hide")}
              </GlyphButton>
            </Box>
          </Stack>
        ) : (
          <Stack spacing={0.5} sx={{ alignItems: "flex-start" }}>
            <GlyphButton icon="emergency" href={`${detailPath}?health=1#emergency`} variant="outlined" sx={{ minHeight: 44 }}>
              {tr("registrations.emergency.show")}
            </GlyphButton>
            <Typography variant="caption" color="text.secondary">
              {tr("registrations.emergency.showHelp")}
            </Typography>
          </Stack>
        )}
      </Box>

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
                  {/* A minor's paper is signed by the minor and the parent, and the press attests both
                      (§330) — where the declaration in effect asks the minor to sign. */}
                  {registration.guardianName && minorSigns && <> {tr("desk.confirmMinorNote", { guardian: registration.guardianName })}</>}
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
                // The reason is kept in the trail for three years (§322): it says why, never who.
                helperText={tr("registrations.reasonNoIdentity")}
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
        Withdraw consent (§322; `AGENTS.md` §15.11): the staff verb for the person who wrote to
        the club instead of pressing the button on their own link. The Administrator's, like
        every verb that changes a registration (§289) — an Organizer reads the health note above
        and has no control here — and asserted again in the service. Only the groups the row
        still holds are offered; the status, the place and the number do not move.
      */}
      {mayManage && (
        <Box component="section">
          <Typography variant="h3" sx={{ fontSize: "1rem", mb: 1 }}>
            {tr("registrations.withdraw.title")}
          </Typography>
          {withdrawable.health || withdrawable.socials || withdrawable.results ? (
            <form action={withdrawConsentAction}>
              <input type="hidden" name="uiLocale" value={locale} />
              <input type="hidden" name="registrationId" value={registration.id} />
              <Stack spacing={1.5}>
                <Typography variant="body2" color="text.secondary">
                  {tr("registrations.withdraw.help")}
                </Typography>
                <Box>
                  {withdrawable.health && <CheckboxField name="health">{tr("registrations.withdraw.health")}</CheckboxField>}
                  {withdrawable.socials && <CheckboxField name="socials">{tr("registrations.withdraw.socials")}</CheckboxField>}
                  {withdrawable.results && <CheckboxField name="results">{tr("registrations.withdraw.results")}</CheckboxField>}
                </Box>
                <Stack direction={{ xs: "column", sm: "row" }} spacing={2} sx={{ alignItems: "flex-start" }}>
                  <RecallField
                    name="reason"
                    label={tr("registrations.withdraw.reason")}
                    helperText={tr("registrations.reasonNoIdentity")}
                    size="small"
                    required
                    slotProps={{ htmlInput: { maxLength: 500 } }}
                    sx={{ flex: 1 }}
                  />
                  <GlyphButton icon="delete" type="submit" variant="outlined" color="warning" sx={{ minHeight: 44 }}>
                    {tr("registrations.withdraw.action")}
                  </GlyphButton>
                </Stack>
              </Stack>
            </form>
          ) : (
            <Typography variant="body2" color="text.secondary">
              {tr("registrations.withdraw.nothing")}
            </Typography>
          )}
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
                {/* What the erase cannot reach (§322), read before the press as well as after it. */}
                <Typography variant="body2" color="text.secondary" data-testid="erase-leftovers-before">
                  {tr("registrations.eraseLeftovers")}
                </Typography>
                {/* The one line that outlives the erasure (§322): why, never who. */}
                <RecallField
                  name="reason"
                  label={tr("registrations.deleteReason")}
                  helperText={tr("registrations.reasonNoIdentity")}
                  required
                  slotProps={{ htmlInput: { maxLength: 500 } }}
                />
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
        {acceptances.map((acceptance, index) => {
          /*
            A minor's declaration is signed by two (§330): the minor's signature and document, then
            the parent's — each in the hand, each named. An adult's, and a minor's signed before two
            signatures were asked, read as they always did.
          */
          const twoSigners = Boolean(registration.guardianName) && acceptance.minorTypedName !== null;
          const hand = { fontFamily: "var(--font-signature), cursive", fontSize: "1.375rem" };
          return (
          <Typography key={index} variant="body2">
            {tr("registrations.declaration")}: {dt(acceptance.acceptedAt)} —{" "}
            {twoSigners && (
              <>
                <Box component="span" sx={hand}>
                  {acceptance.minorTypedName}
                </Box>{" "}
                ({tr("registrations.signedByMinor")}) ·{" "}
              </>
            )}
            <Box component="span" sx={hand}>
              {acceptance.typedName}
            </Box>{" "}
            {twoSigners && <>({tr("registrations.signedByGuardian")}) </>}
            (v{acceptance.declarationVersion})
            {twoSigners ? (
              <>
                {acceptance.minorIdDocument && ` — ${tr("desk.idDocumentMinor")}: ${acceptance.minorIdDocument}`}
                {acceptance.idDocument && ` — ${tr("desk.idDocumentGuardian")}: ${acceptance.idDocument}`}
              </>
            ) : (
              acceptance.idDocument && ` — ${tr("registrations.idDocument")}: ${acceptance.idDocument}`
            )}
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
          );
        })}
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
