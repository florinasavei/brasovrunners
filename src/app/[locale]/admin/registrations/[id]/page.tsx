import ConfirmationNumberIcon from "@mui/icons-material/ConfirmationNumber";
import DeleteForeverIcon from "@mui/icons-material/DeleteForever";
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
import { noFreePlaceValues, type PlacesTaken } from "@/modules/registrations/domain/capacity";
import { listAuditTrail, listPartnerShares } from "@/modules/audit/repository";
import { declarationAsksMinorToSign, noticeDescribesPromotionalMaterials } from "@/modules/legal-documents/repository";
import {
  findRegistrationDetailForAdmin,
  listDeclarationAcceptances,
  listOutboxHistory,
  termsLineKindFor,
} from "@/modules/registrations/admin-repository";
import { readEmergencyDetails, readRegistrationAnswers } from "@/modules/registrations/admin-service";
import { EDITABLE_ANSWERS, EMERGENCY_ANSWERS } from "@/modules/registrations/answers";
import { countryOptions } from "@/modules/registrations/countries";
import { SHIRT_SIZES } from "@/modules/registrations/domain/kit";
import { SEX_CHOICES, sexShown } from "@/modules/registrations/domain/sex";
import { sealPersonLookup } from "@/modules/registrations/person-data";
import { instagramProfileUrl } from "@/modules/registrations/social-links";
import { suggestFreeBibNumbers } from "@/modules/registrations/bibs";
import { formSentAt, journeyOf } from "@/modules/registrations/domain/journey";
import { deadlineHoldsAPlace, rowDeadlineOf } from "@/modules/registrations/domain/row-deadline";
import { countryName } from "@/modules/registrations/names";
import SexAndShirtLine from "@/modules/registrations/ui/SexAndShirtLine";
import GuardianForMinor from "@/modules/registrations/ui/GuardianForMinor";
import { isMinorOn } from "@/modules/registrations/domain/age";
import { fieldId } from "@/shared/forms/outcome";
import { raceNumberOf } from "@/modules/registrations/domain/race-number";
import { canResendReminder, deriveAllowedResendMessageType } from "@/modules/registrations/domain/resend";
import { canTransition, isTerminalStatus } from "@/modules/registrations/domain/state-machine";
import StaffJourney from "@/modules/registrations/ui/StaffJourney";
import FamilyChip from "@/modules/registrations/ui/FamilyChip";
import HiddenListChip from "@/modules/registrations/ui/HiddenListChip";
import HiddenListRadio from "@/modules/registrations/ui/HiddenListRadio";
import { familyOf } from "@/modules/registrations/family-marker";
import { canManageRegistrations, canReadRegistrations } from "@/modules/staff-identity/domain/roles";
import { REGISTRATION_STATUS_LABEL } from "@/modules/staff-identity/domain/staff-labels";
import { requireStaff } from "@/modules/staff-identity/session";
import { confirmWords } from "@/shared/feedback/confirm-words";
import { isUuid } from "@/shared/ids";
import GlyphButton from "@/shared/ui/GlyphButton";
import GlyphSubmitButton from "@/shared/ui/GlyphSubmitButton";
import { BOXED_DISCLOSURE_SX, FOLD_GLYPH_SX } from "@/shared/ui/disclosure";
import { env } from "@/shared/config/env";
import {
  cancelRegistrationAction,
  checkInAction,
  confirmRegistrationNowAction,
  deleteRegistrationAction,
  editRegistrationAnswersAction,
  givePlaceNowAction,
  offerPlaceAction,
  promoteRegistrationAction,
  setBibNumberAction,
  setOutsideCapacityAction,
  withdrawConsentAction,
  declarationHoldAction,
} from "../actions";
import { CLUB_NAME } from "@/theme/brand";
import { resendRegistrationEmailAction } from "./actions";
import DeclarationHoldForm from "@/modules/registrations/ui/DeclarationHoldForm";
import TextHashTip from "@/modules/registrations/ui/TextHashTip";
import { shortTextHash } from "@/modules/legal-documents/domain/signed-text";
import { withSendNowChoice } from "@/modules/notifications/domain/send-at-once";
import { sendNowChoiceFor } from "@/modules/notifications/send-now-choice";
import GivePlaceButton from "@/modules/registrations/ui/GivePlaceButton";
import PaperConfirmationTip from "@/modules/registrations/ui/PaperConfirmationTip";
import OfferPlaceButton from "@/modules/registrations/ui/OfferPlaceButton";
import { givePlaceNowAhead, staffOfferIfMadeNow, staffOfferQuestion } from "@/modules/registrations/give-place-tip";
import { findInvitationOfRegistration, findLiveInvitationOfParticipant } from "@/modules/registrations/invitation-repository";

type Props = {
  params: Promise<{ locale: string; id: string }>;
  searchParams: Promise<{ resent?: string; saved?: string; error?: string; health?: string; answers?: string; count?: string } & Partial<Record<keyof PlacesTaken, string>>>;
};

export const dynamic = "force-dynamic";

/**
 * The numbers a trail row's label names (§642: «Loc suplimentar adăugat…: {from} → {to}»): `from` and
 * `to` when both are whole numbers, nothing otherwise — a label with no placeholder ignores them, and a
 * name correction's `from` and `to`, which are names, never reach a label.
 */
function auditLabelValues(metadata: unknown): Record<string, string> | undefined {
  const { from, to } = (metadata ?? {}) as { from?: unknown; to?: unknown };
  return Number.isInteger(from) && Number.isInteger(to) ? { from: String(from), to: String(to) } : undefined;
}

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
  // A malformed id is the same 404 an unknown one gets, not the query Postgres refuses (§376).
  if (!isUuid(id)) notFound();
  const mayManage = canManageRegistrations(actor.role);

  const db = getDb();
  // One clock for the page: the detail's «offer email queued» reading and the timeline agree (the batch review of 2026-10-03).
  const timelineNow = new Date();
  const registration = await findRegistrationDetailForAdmin(db, id, timelineNow);
  if (!registration) notFound();

  const [acceptances, outboxHistory, auditTrail, freeBibs, minorSigns, family, partnerShares, invitedBy] = await Promise.all([
    listDeclarationAcceptances(db, id),
    listOutboxHistory(db, id),
    // With its event: the supplementary place added for it is a row about the event (§642), found by the index.
    listAuditTrail(db, "registration", id, registration.eventId),
    // The first free numbers, for a preferential one picked rather than guessed (§105).
    suggestFreeBibNumbers(db, registration.eventId),
    /*
      Whether "Confirmă pe hârtie" on a minor attests the minor's signature too (§330): the
      declaration in effect in this registration's language — the one the press binds to — asks
      the minor to sign. Read only for a minor; an adult's paper carries one signature anyway.
    */
    registration.guardianName ? declarationAsksMinorToSign(db, registration.locale, new Date(), registration.eventId) : false,
    // The family marker (§543): the other people on this address at the event, each a link to their page.
    familyOf(db, [registration]).then((members) => members.get(registration.id) ?? []),
    // Every list for sponsors this registration was in (§570): which partner received it, and when.
    listPartnerShares(db, id),
    // The invitation it came from (§647): who sent it and when, for every role that reads this page.
    findInvitationOfRegistration(db, id),
  ]);

  const query = await searchParams;
  const { resent, saved, error, health } = query;
  const tr = await getTranslations("Admin");
  // «Trimite acum» or «Pune la coadă» on a resend (§540): offered only under the scheduled timing.
  const sendNow = mayManage ? await sendNowChoiceFor(db, locale) : null;
  // Every verb here asks first and says who is emailed (§384); the service decides, as before.
  const words = await confirmWords();
  /*
    «Dă-i un loc acum» (§637): the Administrator's, on a row still waiting for its address, and drawn only
    where the press can succeed — a local, scheduled event with a date that has not started. Its question
    says beforehand when no place is free, and the capacity the supplementary place raises it to (§642) —
    the allocator's counts, read once per event (§592's forecast), a lapsed declaration hold not counted
    against the row (§160); a family's live reservation is the row's own place, so it is never "full" for it;
    nor is a row «În afara locurilor» (§643), which needs no counted place. The server decides.
  */
  const givePlaceNowFacts = mayManage && registration.status === "PENDING_EMAIL_CONFIRMATION" ? await givePlaceNowAhead(registration.eventId) : null;
  // The address's open invitation (§647) is the row's own place: the press takes it over and adds none.
  const heldByInvitation =
    givePlaceNowFacts !== null && (await findLiveInvitationOfParticipant(db, registration.eventId, registration.participantId, new Date())) !== undefined;
  const givePlaceNow = givePlaceNowFacts
    ? {
        raisedTo:
          givePlaceNowFacts.full && !heldByInvitation && !registration.outsideCapacity && !(registration.holdExpiresAt !== null && registration.holdExpiresAt > new Date())
            ? givePlaceNowFacts.raisedTo
            : null,
      }
    : null;
  // «Trimite-i oferta»'s question (§615, §642): the deadline, a supplementary place, the close — read only where the button can be drawn.
  const offerForecast = registration.status === "WAITLISTED" && mayManage ? await staffOfferIfMadeNow(registration.eventId, locale) : null;
  // The timeline's short form with the time (§349): a value beside its label, so capitalised;
  // `dtInline` inside a sentence.
  const dt = (value: Date | null) => (value ? formatDay(value, { locale, timeZone: CLUB_TIME_ZONE, style: "short", withTime: true }) : null);
  const dtInline = (value: Date | null) =>
    value ? formatDay(value, { locale, timeZone: CLUB_TIME_ZONE, style: "short", withTime: true, position: "inline" }) : null;
  /*
    The deadline a live row waits on, in the timeline (§635): «Ține locul până» on a place held for the
    declaration, an open offer or a family's reservation — past a declaration's deadline with the
    journey's kept words, since the place is released only when somebody wants it (§160) — and the
    first email's link on a row still waiting for its address. An ended row keeps «Rezervarea expiră».
    The list's «Până când» reads the same helper (§650, `rowDeadlineOf`): an offer whose first email is
    still queued keeps «Ține locul până» past its stored deadline (§520), and a lapsed one, which holds
    nothing any more (`countOccupied`), reads «Rezervarea expiră» like an ended row.
  */
  const rowDeadline = rowDeadlineOf(registration, timelineNow);
  const holdLine: [string, string | null] = [
    tr(deadlineHoldsAPlace(rowDeadline) ? "registrations.holdKeeps" : "registrations.holdExpires"),
    rowDeadline?.kind === "kept" ? `${dt(registration.holdExpiresAt)} — ${tr("registrations.journey.heldKept")}` : dt(registration.holdExpiresAt),
  ];
  const linkLine: [string, string | null] = [
    tr("registrations.linkExpires"),
    registration.status === "PENDING_EMAIL_CONFIRMATION" ? dt(registration.emailLinkExpiresAt) : null,
  ];

  /*
    The emergency details (§322): the phone, the emergency contact and the health note — what
    the form collected "for race day" and nothing here could show. Read only when asked for
    (`?health=1`, a plain link, so no prefetch opens it on somebody's behalf), and each read is
    recorded before the values come back (`readEmergencyDetails`), because the trail is how the
    club answers "who has seen my health note". The gate is the page's own — whoever may read
    the registrations — asserted again in the service. Never on the desk (§15.11).
  */
  const emergency = health === "1" ? await readEmergencyDetails(db, actor, registration.id, new Date()) : null;
  /*
    «Datele înscrierii» (§645): every answer the person typed, read — and the read recorded — only when
    the section is opened (`?answers=1`, a plain link), as the emergency details above are. Each box's
    value as the form renders it, and the same string in its `was.` twin.
  */
  const answers = query.answers === "1" ? await readRegistrationAnswers(db, actor, registration.id, new Date()) : null;
  const answerFields = EDITABLE_ANSWERS.filter((field) => field !== "tshirtSize" || registration.eventKitShirt);
  const answerLabels = Object.fromEntries(answerFields.map((field) => [field, tr(`registrations.answers.fields.${field}`, { club: CLUB_NAME })])) as Record<string, string>;
  const answerValues: Record<string, string> = answers
    ? Object.fromEntries(
        answerFields.map((field) => {
          if (field === "clubMemberDeclared") return [field, answers.clubMemberDeclared ? "on" : ""];
          if (field === "sex") return [field, sexShown(answers.sex) ?? ""];
          if (field === "tshirtSize") return [field, answers.tshirtSize ?? "NONE"];
          return [field, (answers[field] as string | null) ?? ""];
        }),
      )
    : {};
  const countries = answers ? countryOptions(locale, (code) => countryName(code, locale)) : [];
  /*
    A signed declaration names its declarant and its second signature from the guardian
    (`signed-declaration.ts`), so under one the guardian is the declaration's, not an answer (§645,
    `GUARDIAN_SIGNED`): the box shown greyed with why, and no twin, so nothing posts it.
  */
  const guardianSigned = acceptances.length > 0;
  /*
    Only a minor has a guardian (§108; `answers.ts#GUARDIAN_ADULT`, §645): the box opens when the date in
    the birth-date box made the person a minor on the day the row was written — the server's own test —
    and stays open when the row is a minor's or holds a guardian already, so a guardian a corrected date
    will clear is in view. Without JavaScript it is always there (`GuardianForMinor`).
  */
  const guardianOpen = Boolean(answers?.guardianName) || (typeof answers?.birthDate === "string" && isMinorOn(answers.birthDate, answers.createdAt));
  // An older row kept only the name of record (BR-REQ-031-04 criterion 6): its two boxes start empty and
  // are not required, or the browser would block every other correction until both were typed.
  const namesRequired = Boolean(answers?.firstName || answers?.lastName);
  // The Organizer's read-only list (§289): each answer in words, «—» for none.
  const answerShown = (field: string): string => {
    const value = answerValues[field] ?? "";
    if (field === "clubMemberDeclared") return value === "on" ? tr("registrations.answers.yes") : tr("registrations.answers.no");
    if (field === "sex") return value ? tr(`registrations.answers.sex.${value}`) : "";
    if (field === "tshirtSize") return value === "NONE" ? "" : value;
    if ((field === "nationality" || field === "country") && value) return countryName(value, locale);
    return value;
  };
  const answersRefusal = await refusalMessages(answerLabels);
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
    // The offers and benefits (§562): withdrawn for a person who wrote; never given by staff.
    promo: registration.promoConsent,
  };
  // «Oferte și beneficii» is a line of the page while the notice in force describes it, or while the row says yes (§562).
  const promoShown = registration.promoConsent || (await noticeDescribesPromotionalMaterials(db, new Date()));

  /*
    The form filled again with the same address (§312), out of the trail and into the timeline,
    oldest first like the lines around them. They are what the person did, not what the team
    did, so they leave "Ce a făcut echipa" to the team. Each says the state it found — "still
    waiting for the email link" is usually the whole answer to "they say they registered" — and
    what went out, in the words `/admin/emails` uses for that message.
  */
  const resubmissions = auditTrail
    .filter((entry) => entry.action === "registration.resubmitted")
    .reverse()
    .map((entry) => {
      const metadata = entry.metadataJson as { status?: unknown; resent?: unknown; held?: unknown };
      const status = registrationStatus.enumValues.find((value) => value === metadata.status);
      const resent = emailMessageType.enumValues.find((value) => value === metadata.resent);
      const values = {
        date: dt(entry.createdAt) ?? "",
        state: status ? REGISTRATION_STATUS_LABEL[status] : "—",
      };
      // `held`: sent again inside a family sitting (§519) — nothing new queued, the held email leaves once.
      return {
        text: resent
          ? tr(metadata.held === true ? "registrations.resubmittedHeld" : "registrations.resubmittedSent", {
              ...values,
              message: tr(`emails.types.${resent}`),
            })
          : tr("registrations.resubmittedNothing", values),
        actorName: entry.actorName,
      };
    });
  const staffTrail = auditTrail.filter((entry) => entry.action !== "registration.resubmitted");
  /*
    A corrected answer (§645) names its field in words; its two values are shown, except the phone's and
    the emergency contact's, which only beside the emergency details or the answers opened — both
    recorded reads (§322) — so the trail is not a way round the record.
  */
  const emergencyOpen = emergency !== null || answers !== null;
  const trailLabel = (action: string, metadata: unknown): string => {
    if (action !== "registration.answer_corrected") return tr(`registrations.audit.${action}`, auditLabelValues(metadata));
    const field = String((metadata as { field?: unknown } | null)?.field ?? "");
    const known = (EDITABLE_ANSWERS as readonly string[]).includes(field) || field === "listSocials";
    return tr("registrations.audit.registration.answer_corrected", { field: known ? tr(`registrations.answers.fields.${field}`, { club: CLUB_NAME }) : field });
  };
  const trailMetadata = (action: string, metadata: unknown): Record<string, unknown> => {
    const shown = { ...((metadata ?? {}) as Record<string, unknown>) };
    if (action === "registration.answer_corrected") {
      delete shown.field;
      if (!emergencyOpen && EMERGENCY_ANSWERS.has(String((metadata as { field?: unknown } | null)?.field ?? ""))) {
        delete shown.from;
        delete shown.to;
      }
    }
    return shown;
  };

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
  // «Lista de invitați speciali»'s «i» (§649): who it is for, what they keep, who does not go there — a line each.
  const hiddenListInfo = [tr("registrations.outside.infoFor"), tr("registrations.outside.infoKeeps"), tr("registrations.outside.infoNot")].join("\n");
  // The forms that carry a typed value answer a refusal with the value still in its box (§315).
  const refusal = await refusalMessages({
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
        {/* Sent now, past the scheduled pass (§540), or queued for it, as before. */}
        {resent && <Alert severity="success">{resent === "now" ? tr("registrations.resendSentNow") : tr("registrations.resendSent")}</Alert>}
        {/* «Dă-i un loc acum» (§637): the place given, and until when it waits for the declaration. */}
        {(saved === "placeGiven" || saved === "placeGivenRaised") && registration.holdExpiresAt ? (
          <Alert severity="success" data-testid="place-given">
            {/* On a supplementary place (§642) the alert names the capacity it raised, as the toast does. */}
            {saved === "placeGivenRaised" && typeof query.count === "string" && /^\d{1,6}$/.test(query.count)
              ? tr("registrations.placeGivenRaised", { n: query.count, deadline: dtInline(registration.holdExpiresAt) ?? "" })
              : tr("registrations.placeGiven", { deadline: dtInline(registration.holdExpiresAt) ?? "" })}
          </Alert>
        ) : (
          saved && <Alert severity="success">{tr("saved")}</Alert>
        )}
      {/* The action redirects with a language-neutral code (AGENTS.md 14.3); this is where it
          becomes a sentence. */}
        {error && <Alert severity="error">{tr(`errors.${error}`, noFreePlaceValues(error, query))}</Alert>}
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
        {/* On the hidden list (§643, §647): read by every role that reads this page. */}
        {registration.outsideCapacity && <HiddenListChip label={tr("registrations.outside.chip")} hint={tr("registrations.outside.hint")} testId="outside-chip" />}
        <FamilyChip
          label={tr("registrations.familyChip")}
          members={family.map((member) => ({
            name: member.name,
            href: getPathname({ locale, href: { pathname: "/admin/registrations/[id]", params: { id: member.id } } }),
          }))}
        />
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
      <StaffJourney journey={journeyOf(registration)} bibNumber={raceNumberOf(registration)} variant="full" />
      <Typography variant="body2" color="text.secondary">
        {registration.participantEmail} · {registration.eventTitle ?? registration.eventId}
      </Typography>
      {/* From an invitation by email (§647): who sent it and when, read by every role that reads this page. */}
      {invitedBy && (
        <Typography variant="body2" color="text.secondary" data-testid="registration-invited">
          {tr("registrations.invitedBy", { who: invitedBy.invitedByName ?? tr("invitations.byNobody"), when: dtInline(invitedBy.sentAt) ?? "" })}
        </Typography>
      )}
      {registration.guardianName && (
        <Typography variant="body2" color="text.secondary">
          {tr("desk.guardian", { name: registration.guardianName })}
        </Typography>
      )}
      {/* Where the person lives (§510): the city, then the country named in the reader's language;
          for the club's "where do our runners come from", never shown publicly. */}
      {(registration.city || registration.country) && (
        <Typography variant="body2" color="text.secondary">
          {tr("registrations.livesIn", {
            place: [registration.city, registration.country ? countryName(registration.country, locale) : null].filter(Boolean).join(", "),
          })}
        </Typography>
      )}
      {/* The sex in words (§554), «—» for none — a paper entry left blank, or the retired «Prefer
          să nu spun» of a row stored before it went; and the T-shirt, only for an event that gives one. */}
      <SexAndShirtLine sex={registration.sex} tshirtSize={registration.tshirtSize} kitShirt={registration.eventKitShirt} />
      {/* The socials the person offered (§106): links to follow back — and whether the public
          list prints them beside the name, the runner's own tick (§500). */}
      {(registration.stravaUrl || registration.instagramHandle) && (
        <Typography variant="body2" color="text.secondary">
          {registration.stravaUrl && (
            <MuiLink href={registration.stravaUrl} target="_blank" rel="noopener noreferrer nofollow">
              Strava
            </MuiLink>
          )}
          {registration.stravaUrl && registration.instagramHandle ? " · " : ""}
          {registration.instagramHandle && (
            <MuiLink href={instagramProfileUrl(registration.instagramHandle)} target="_blank" rel="noopener noreferrer nofollow">
              @{registration.instagramHandle}
            </MuiLink>
          )}
          {registration.listSocials && (
            <Box component="span" data-testid="registration-socials-on-list">
              {` — ${tr("registrations.socialsOnList")}`}
            </Box>
          )}
        </Typography>
      )}

      {/* The consent to offers and benefits (§562): yes with its moment, or no — the person's own answer. */}
      {promoShown && (
        <Typography variant="body2" color="text.secondary" data-testid="registration-promo">
          {registration.promoConsent && registration.promoConsentAt
            ? tr("registrations.promo.yes", { date: dtInline(registration.promoConsentAt) ?? "" })
            : tr("registrations.promo.no")}
        </Typography>
      )}

      {/* Sending a participant a message is the Administrator's (§15.8, §289). */}
      <Stack direction="row" spacing={1} sx={{ flexWrap: "wrap", gap: 1 }}>
        {mayManage && (
          <ActionForm
            action={resendRegistrationEmailAction}
            confirm={withSendNowChoice(
              { title: tr("confirm.resendTitle"), body: tr(`confirm.resendWhat.${registration.status}`, { name: registration.registeredName }), ...(registration.kind === "TEST" ? {} : { email: words.email(1) }), confirmLabel: tr("registrations.resend"), cancelLabel: words.cancel },
              sendNow,
            )}
            data-testid="resend-form"
          >
            <input type="hidden" name="uiLocale" value={locale} />
            <input type="hidden" name="registrationId" value={registration.id} />
            {sendNow && <input type="hidden" name={sendNow.field} value={sendNow.value} />}
            <GlyphButton icon="resend" type="submit" variant="outlined" disabled={!canResend}>
              {tr("registrations.resend")}
            </GlyphButton>
          </ActionForm>
        )}
        {/* The reminder by hand (§81): confirmed, and the event still ahead. */}
        {mayManage && canResendReminder(registration.status, registration.eventStartsAt, new Date()) && (
          <ActionForm
            action={resendRegistrationEmailAction}
            confirm={withSendNowChoice(
              { title: tr("confirm.reminderTitle"), body: tr("confirm.reminderBody", { name: registration.registeredName }), ...(registration.kind === "TEST" ? {} : { email: words.email(1) }), confirmLabel: tr("registrations.sendReminder"), cancelLabel: words.cancel },
              sendNow,
            )}
            data-testid="reminder-form"
          >
            <input type="hidden" name="uiLocale" value={locale} />
            <input type="hidden" name="registrationId" value={registration.id} />
            {sendNow && <input type="hidden" name={sendNow.field} value={sendNow.value} />}
            <input type="hidden" name="messageType" value="EVENT_REMINDER" />
            <GlyphButton icon="send" type="submit" variant="outlined">
              {tr("registrations.sendReminder")}
            </GlyphButton>
          </ActionForm>
        )}
        {personHref && (
          <GlyphButton icon="personData" href={personHref} variant="text" sx={{ minHeight: 44 }}>
            {tr("registrations.personThis")}
          </GlyphButton>
        )}
      </Stack>

      {/*
        «Dă-i un loc acum» (§637): the address vouched for by the Administrator and the place given now,
        ahead of the waiting list, for a registration still waiting for its address. The person signs the
        declaration themselves, online or on paper at the desk. Its own block, beside the messages above
        and apart from the race-day box below.
      */}
      {givePlaceNow && (
        <ActionForm
          action={givePlaceNowAction}
          confirm={{
            title: tr("confirm.givePlaceNowTitle"),
            body: [
              tr("confirm.givePlaceNowBody", { email: registration.participantEmail }),
              tr("confirm.givePlaceNowBodyMore"),
              // A full race (§642): the press adds one supplementary place, said beforehand and named on the button.
              ...(givePlaceNow.raisedTo !== null ? [tr("confirm.givePlaceNowFull", { n: String(givePlaceNow.raisedTo) })] : []),
            ].join(" "),
            ...(registration.kind === "TEST" ? {} : { email: words.email(1) }),
            confirmLabel: givePlaceNow.raisedTo !== null ? tr("confirm.givePlaceNowRaiseConfirm") : tr("registrations.givePlaceNow"),
            cancelLabel: words.cancel,
          }}
          data-testid="give-place-now-form"
        >
          {deskHidden}
          {/* The capacity the question named (§642): the server adds that one place and no other, and none unasked. */}
          {givePlaceNow.raisedTo !== null && <input type="hidden" name="addPlace" value={givePlaceNow.raisedTo} />}
          <Stack direction={{ xs: "column", sm: "row" }} spacing={2} sx={{ alignItems: { sm: "center" } }}>
            <GlyphButton icon="place" type="submit" variant="outlined" sx={{ minHeight: 44, flexShrink: 0 }}>
              {tr("registrations.givePlaceNow")}
            </GlyphButton>
            <Typography variant="body2" color="text.secondary">
              {tr("registrations.givePlaceNowHelp")}
            </Typography>
          </Stack>
        </ActionForm>
      )}

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
            {/* The health line only for an event that asks the note (§557, «Informații medicale»). */}
            {emergency.eventAsksHealthNote && (
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
            )}
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
              {tr(registration.eventAsksHealthNote ? "registrations.emergency.show" : "registrations.emergency.showNoHealth")}
            </GlyphButton>
            <Typography variant="caption" color="text.secondary">
              {tr("registrations.emergency.showHelp")}
            </Typography>
          </Stack>
        )}
      </Box>

      {/*
        «Lista ascunsă» (§643, named and redrawn by §647; the owner, 2026-10-02: «Nu îmi place deloc cum arată
        bifa asta, trebuia să fie doar radio» and «Trebuie ca acest feature să se numească „Pune pe lista
        ascunsă” cu o iconiță specială cu un bandit (incognito)»): whether this registration takes one of the
        event's places, as two radios. Drawn while the event's «Folosește lista ascunsă» is on, or for a row
        already on the list — then only «Se numără între locurile evenimentului» means anything, and the line
        says so; the server refuses putting anybody on the list of an event whose switch is off. Every role
        that reads the page reads the state; only the Administrator changes it (`canManageRegistrations`,
        asserted again by the action and the service), and only while the registration is active — an ended
        row's mark is read, never changed. A change asks the dialog that says what it does in this row's state.
        Named «Lista de invitați speciali» on screen since §649, with an «i» beside its heading; the code's
        `hiddenList` / `outsideCapacity` names stay.
      */}
      {(registration.eventHiddenListEnabled || registration.outsideCapacity) && (
        <Box component="section" data-testid="outside-capacity" sx={{ minWidth: 0, maxWidth: "100%" }}>
          {mayManage && !isTerminalStatus(registration.status) ? (
            <ActionForm
              action={setOutsideCapacityAction}
              confirm={
                registration.outsideCapacity
                  ? {
                      title: tr("confirm.outsideUnmarkTitle"),
                      body: tr("confirm.outsideUnmarkBody", { name: registration.registeredName }),
                      confirmLabel: tr("registrations.outside.unmark"),
                      cancelLabel: words.cancel,
                    }
                  : {
                      title: tr("confirm.outsideMarkTitle"),
                      /*
                        A waiting runner, or an open offer (the review of 2026-10-02), is seated now with the
                        declaration's email; a TEST row's dialog names no email, in its body as in its bold line (§384).
                      */
                      body:
                        registration.status === "WAITLISTED"
                          ? registration.kind === "TEST"
                            ? tr("confirm.outsideMarkBodyWaitlistedTest", { name: registration.registeredName })
                            : tr("confirm.outsideMarkBodyWaitlisted", { name: registration.registeredName, message: tr("emails.types.COMPLETE_DECLARATION") })
                          : registration.status === "WAITLIST_OFFERED"
                            ? registration.kind === "TEST"
                              ? tr("confirm.outsideMarkBodyOfferedTest", { name: registration.registeredName })
                              : tr("confirm.outsideMarkBodyOffered", { name: registration.registeredName, message: tr("emails.types.COMPLETE_DECLARATION") })
                            : registration.status === "PENDING_EMAIL_CONFIRMATION"
                              ? tr("confirm.outsideMarkBodyPendingEmail", { name: registration.registeredName })
                              : tr("confirm.outsideMarkBody", { name: registration.registeredName }),
                      ...(registration.status !== "WAITLISTED" && registration.status !== "WAITLIST_OFFERED"
                        ? {}
                        : registration.kind === "TEST" ? {} : { email: words.email(1) }),
                      confirmLabel: tr("registrations.outside.mark"),
                      cancelLabel: words.cancel,
                    }
              }
              data-testid="outside-capacity-form"
            >
              {deskHidden}
              <input type="hidden" name="outside" value={registration.outsideCapacity ? "false" : "true"} />
              <HiddenListRadio
                onList={registration.outsideCapacity}
                headingId="hidden-list-title"
                heading={tr("registrations.outside.title")}
                countedLabel={tr("registrations.outside.optionCounted")}
                hiddenLabel={tr("registrations.outside.optionHidden")}
                info={hiddenListInfo}
              />
            </ActionForm>
          ) : (
            <HiddenListRadio
              onList={registration.outsideCapacity}
              headingId="hidden-list-title"
              heading={tr("registrations.outside.title")}
              countedLabel={tr("registrations.outside.optionCounted")}
              hiddenLabel={tr("registrations.outside.optionHidden")}
              info={hiddenListInfo}
              disabled
            />
          )}
          {!registration.eventHiddenListEnabled && (
            <Typography variant="body2" sx={{ mt: 0.5, overflowWrap: "anywhere" }} data-testid="hidden-list-switch-off">
              {tr("registrations.outside.switchOff")}
            </Typography>
          )}
          {/* A block, so the caption wraps at 320 pixels rather than running past the screen's edge. */}
          <Typography variant="caption" color="text.secondary" component="p" sx={{ mt: 0.5, mb: 0, overflowWrap: "anywhere" }}>
            {tr("registrations.outside.help")}
          </Typography>
        </Box>
      )}

      <Divider />

      {/*
        Race day (BR-REQ-037-07, BR-REQ-037-08). The same verbs the desk offers, on the full
        page: confirm on a paper declaration, give a waiting-list entry a free place, type a
        number, mark them here. The code and its QR are shown so a runner who lost the email
        can be given it again from a screen.
      */}
      <Box component="section">
        <Stack direction="row" spacing={0.5} sx={{ alignItems: "center", mb: 1 }}>
          <Typography variant="h3" sx={{ fontSize: "1rem" }}>
            {tr("registrations.raceDayTitle")}
          </Typography>
          {/* What the paper confirmation is for, does and sends (§640): only where the button is. */}
          {canConfirmNow && <PaperConfirmationTip />}
        </Stack>
        <Stack spacing={2}>
          {canConfirmNow && (
            <ActionForm
              action={confirmRegistrationNowAction}
              confirm={{
                title: tr("desk.confirmOnPaper"),
                body: registration.guardianName && minorSigns ? tr("registrations.confirmOnPaperBodyMinor", { guardian: registration.guardianName }) : tr("registrations.confirmOnPaperBody"),
                ...(registration.kind === "TEST" ? {} : { email: words.email(1) }),
                confirmLabel: tr("desk.confirmHere"),
                cancelLabel: words.cancel,
              }}
              data-testid="confirm-now-form"
            >
              {deskHidden}
              <Stack direction={{ xs: "column", sm: "row" }} spacing={2} sx={{ alignItems: { sm: "center" } }}>
                <GlyphButton icon="confirm" type="submit" variant="contained" color="warning" sx={{ minHeight: 44 }}>
                  {tr("desk.confirmHere")}
                </GlyphButton>
                <Typography variant="body2" color="text.secondary">
                  {/* When, what the person gets, what it is not; the «i» beside the title adds the place's rule (§640). */}
                  {tr("desk.paperWhen")} {tr("desk.paperEmail")} {tr("desk.paperNot")}
                  {/* A minor's paper is signed by the minor and the parent, and the press attests both
                      (§330) — where the declaration in effect asks the minor to sign. */}
                  {registration.guardianName && minorSigns && <> {tr("desk.confirmMinorNote", { guardian: registration.guardianName })}</>}
                </Typography>
              </Stack>
            </ActionForm>
          )}
          {registration.status === "WAITLISTED" && (
            <ActionForm
              action={promoteRegistrationAction}
              confirm={{ title: tr("confirm.givePlaceTitle"), body: tr("confirm.givePlaceBody", { name: registration.registeredName }), ...(registration.kind === "TEST" ? {} : { email: words.email(1) }), confirmLabel: tr("desk.givePlace"), cancelLabel: words.cancel }}
              data-testid="promote-form"
            >
              {deskHidden}
              {/* On a full race, an «i» says why the press will be refused (§592). */}
              <GivePlaceButton eventId={registration.eventId} />
            </ActionForm>
          )}
          {/*
            «Trimite-i oferta» (§615): the ordinary offer, by the organizer's choice — the email and the
            deadline, no confirmation. The Administrator's; offered at any moment before the start, after
            the close too, and on a full event it adds one supplementary place (§642), as the dialog says.
          */}
          {registration.status === "WAITLISTED" && mayManage && offerForecast !== null && (
            <ActionForm
              action={offerPlaceAction}
              confirm={{
                title: tr("confirm.offerPlaceTitle"),
                ...staffOfferQuestion((key, values) => tr(key, values), registration.registeredName, offerForecast),
                ...(registration.kind === "TEST" ? {} : { email: words.email(1) }),
                cancelLabel: words.cancel,
              }}
              data-testid="offer-place-form"
            >
              {deskHidden}
              {/* The capacity the question named (§642): the server adds that one place and no other, and none unasked. */}
              {offerForecast.raisedTo !== null && <input type="hidden" name="addPlace" value={offerForecast.raisedTo} />}
              <OfferPlaceButton />
            </ActionForm>
          )}
          {registration.status === "CONFIRMED" && (
            <>
              {/*
                The number, drawn at the confirmation (§548), and the way to change it folded
                underneath (§232; the owner: "I wanna simplify that part with the BID changing").
                The answer is one line; the change is a `<details>` that opens on the rare occasion
                somebody wants §105's preferential number — the same idiom the list uses for its
                destructive verbs, no client island, opens with JavaScript off. Offered while the
                bib is not printed: `setBibNumberByStaff` refuses a printed one (§311), and a box
                that always refuses invites the press. The old number is retired, never given again.
              */}
              <Stack spacing={1} sx={{ alignItems: "flex-start" }}>
                <Typography variant="body2" color={registration.bibNumber === null ? "text.primary" : "text.secondary"}>
                  {registration.bibNumber === null
                    ? tr("registrations.bibNone")
                    : registration.bibPrintedAt !== null
                      ? tr("registrations.bibSettledPrinted", { number: registration.bibNumber })
                      : tr("registrations.bibSettled", { number: registration.bibNumber })}
                </Typography>
                {/* Replacing a number already emailed is the Administrator's (§548); filling a gap is any desk role's. */}
                {registration.bibPrintedAt === null && (registration.bibNumber === null || mayManage) && (
                  /* The box spans the section. A refused number comes back in its box with the fold open (§315). */
                  <Box sx={{ alignSelf: "stretch" }}>
                    <ActionForm
                      action={setBibNumberAction}
                      messages={bibRefusal}
                      confirm={{ title: tr("confirm.setBibTitle"), body: tr("confirm.setBibBody"), ...(registration.kind === "TEST" ? {} : { email: words.email(1) }), confirmLabel: tr("desk.saveBib"), cancelLabel: words.cancel }}
                      scope="bib"
                      data-testid="set-bib-form"
                    >
                      <RecallDetails sx={BOXED_DISCLOSURE_SX}>
                        <Typography component="summary" variant="body2" color="primary">
                          <ConfirmationNumberIcon aria-hidden sx={FOLD_GLYPH_SX} />
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
                              defaultValue=""
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
                )}
                {registration.bibNumber !== null && (
                  /*
                    This one bib, on its own A4 page (§180). The same route the event's sheet
                    uses, asked for a range of exactly one and the one-per-page layout — so
                    there is one renderer, one authorization check and one design, and a
                    volunteer who has to reprint a single number does not download two hundred.
                  */
                  <GlyphButton
                    icon="print"
                    href={`/api/admin/events/${registration.eventId}/bibs?locale=${locale}&from=${registration.bibNumber}&to=${registration.bibNumber}&layout=one`}
                    variant="outlined"
                    sx={{ minHeight: 44 }}
                  >
                    {tr("registrations.downloadBib")}
                  </GlyphButton>
                )}
              </Stack>
              <ActionForm
                action={checkInAction}
                data-testid="checkin-form"
              >
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
              </ActionForm>
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
        «Datele înscrierii» (§645; the owner, 2026-10-02: «Nu vreau să se numească „curăță”, dar practic
        vreau să pot modifica sau suprascrie orice dată introdusă de utilizator»): every answer the person
        typed — §67's «Corectează numele» and the member tick folded in — behind a plain link, as the
        emergency section is, because the phone and the emergency contact are among them and opening it is
        recorded (`readRegistrationAnswers`). Its own block: never inside «Ziua cursei», the places or the
        offer, since a correction moves no state, no place and no email. The Administrator corrects; the
        Organizer reads the same answers and gets no form (§289); the action and both services refuse
        anybody else (BR-REQ-060-01). The address, the consents and the declaration are named, read-only,
        with why — they stay the person's (`answers.ts`).
      */}
      <Box component="section" id="answers" data-testid="answers" sx={{ scrollMarginTop: 16 }}>
        <Typography variant="h3" sx={{ fontSize: "1rem", mb: 1 }}>
          {tr("registrations.answers.title")}
        </Typography>
        {answers === null ? (
          <Stack spacing={0.5} sx={{ alignItems: "flex-start" }}>
            <GlyphButton icon={mayManage ? "rename" : "preview"} href={`${detailPath}?answers=1#answers`} variant="outlined" sx={{ minHeight: 44 }} data-testid="answers-open">
              {mayManage ? tr("registrations.answers.open") : tr("registrations.answers.openRead")}
            </GlyphButton>
            <Typography variant="caption" color="text.secondary">
              {tr("registrations.answers.openHelp")}
            </Typography>
          </Stack>
        ) : (
          <Stack spacing={2}>
            {mayManage ? (
              <ActionForm
                action={editRegistrationAnswersAction}
                messages={answersRefusal}
                confirm={{
                  title: tr("confirm.answersTitle"),
                  body: tr("confirm.answersBody", { name: registration.registeredName, fields: "{fields}" }),
                  changedFields: { labels: answerLabels, separator: ", " },
                  confirmLabel: tr("registrations.answers.save"),
                  cancelLabel: words.cancel,
                }}
                scope="answers"
                data-testid="answers-form"
              >
                <input type="hidden" name="uiLocale" value={locale} />
                <input type="hidden" name="registrationId" value={registration.id} />
                {/* What the page rendered, beside each box: only what moved is corrected (`changedAnswersOf`). */}
                {Object.entries(answerValues)
                  .filter(([field]) => !(guardianSigned && field === "guardianName"))
                  .map(([field, value]) => (
                    <input key={field} type="hidden" name={`was.${field}`} value={value} />
                  ))}
                <Stack spacing={2}>
                  <Box sx={{ display: "grid", gridTemplateColumns: { xs: "1fr", sm: "1fr 1fr" }, gap: 2 }}>
                    <RecallField name="firstName" label={answerLabels.firstName} defaultValue={answerValues.firstName} required={namesRequired} slotProps={{ htmlInput: { maxLength: 100 } }} />
                    <RecallField name="lastName" label={answerLabels.lastName} defaultValue={answerValues.lastName} required={namesRequired} slotProps={{ htmlInput: { maxLength: 100 } }} />
                    <RecallField
                      name="displayName"
                      label={answerLabels.displayName}
                      defaultValue={answerValues.displayName}
                      helperText={tr("registrations.answers.displayNameHelp")}
                      slotProps={{ htmlInput: { maxLength: 120 } }}
                    />
                    <RecallField
                      name="birthDate"
                      type="date"
                      label={answerLabels.birthDate}
                      defaultValue={answerValues.birthDate}
                      slotProps={{ inputLabel: { shrink: true } }}
                    />
                    <RecallField name="sex" select label={answerLabels.sex} defaultValue={answerValues.sex} slotProps={{ select: { native: true }, inputLabel: { shrink: true } }}>
                      <option value="">{tr("registrations.answers.none")}</option>
                      {SEX_CHOICES.map((sex) => (
                        <option key={sex} value={sex}>
                          {tr(`registrations.answers.sex.${sex}`)}
                        </option>
                      ))}
                    </RecallField>
                    <RecallField
                      name="nationality"
                      select
                      label={answerLabels.nationality}
                      defaultValue={answerValues.nationality}
                      slotProps={{ select: { native: true }, inputLabel: { shrink: true } }}
                    >
                      <option value="">{tr("registrations.answers.none")}</option>
                      {countries.map((country) => (
                        <option key={country.code} value={country.code}>
                          {country.label}
                        </option>
                      ))}
                    </RecallField>
                    <RecallField name="country" select label={answerLabels.country} defaultValue={answerValues.country} required slotProps={{ select: { native: true }, inputLabel: { shrink: true } }}>
                      {countries.map((country) => (
                        <option key={country.code} value={country.code}>
                          {country.label}
                        </option>
                      ))}
                    </RecallField>
                    <RecallField name="city" label={answerLabels.city} defaultValue={answerValues.city} slotProps={{ htmlInput: { maxLength: 120 } }} />
                    <RecallField
                      name="phone"
                      type="tel"
                      label={answerLabels.phone}
                      defaultValue={answerValues.phone}
                      helperText={tr("registrations.answers.phoneHelp")}
                      slotProps={{ htmlInput: { maxLength: 30 } }}
                    />
                    <GuardianForMinor birthDateId={fieldId("birthDate", "answers")} forceOpen={guardianOpen} minorOn={answers.createdAt.toISOString()}>
                      <RecallField
                        name="guardianName"
                        label={answerLabels.guardianName}
                        defaultValue={answerValues.guardianName}
                        disabled={guardianSigned}
                        fullWidth
                        helperText={tr(guardianSigned ? "registrations.answers.guardianSignedHelp" : "registrations.answers.guardianHelp")}
                        slotProps={{ htmlInput: { maxLength: 200 } }}
                      />
                    </GuardianForMinor>
                    <RecallField name="emergencyContactName" label={answerLabels.emergencyContactName} defaultValue={answerValues.emergencyContactName} slotProps={{ htmlInput: { maxLength: 200 } }} />
                    <RecallField
                      name="emergencyContactPhone"
                      type="tel"
                      label={answerLabels.emergencyContactPhone}
                      defaultValue={answerValues.emergencyContactPhone}
                      helperText={tr("registrations.answers.phoneHelp")}
                      slotProps={{ htmlInput: { maxLength: 30 } }}
                    />
                    <RecallField
                      name="clubName"
                      label={answerLabels.clubName}
                      defaultValue={answerValues.clubName}
                      helperText={tr("registrations.answers.clubNameHelp", { club: CLUB_NAME })}
                      slotProps={{ htmlInput: { maxLength: 200 } }}
                    />
                    <RecallField name="stravaUrl" label={answerLabels.stravaUrl} defaultValue={answerValues.stravaUrl} slotProps={{ htmlInput: { maxLength: 200 } }} />
                    <RecallField name="instagramHandle" label={answerLabels.instagramHandle} defaultValue={answerValues.instagramHandle} slotProps={{ htmlInput: { maxLength: 40 } }} />
                    {/* The T-shirt only for an event that gives one (§554); otherwise not on the form, and not corrected. */}
                    {registration.eventKitShirt && (
                      <RecallField name="tshirtSize" select label={answerLabels.tshirtSize} defaultValue={answerValues.tshirtSize} slotProps={{ select: { native: true }, inputLabel: { shrink: true } }}>
                        <option value="NONE">{tr("registrations.answers.noShirt")}</option>
                        {SHIRT_SIZES.map((size) => (
                          <option key={size} value={size}>
                            {size}
                          </option>
                        ))}
                      </RecallField>
                    )}
                  </Box>
                  {/* The member tick (BR-REQ-031-06): a claim the person made, corrected here like any answer. */}
                  <CheckboxField name="clubMemberDeclared" defaultChecked={answers.clubMemberDeclared} help={tr("registrations.answers.memberHelp", { club: CLUB_NAME })}>
                    {answerLabels.clubMemberDeclared}
                  </CheckboxField>
                  <Box>
                    <GlyphSubmitButton label={tr("registrations.answers.save")} pendingLabel={tr("registrations.answers.pending")} icon="save" variant="contained" />
                  </Box>
                </Stack>
              </ActionForm>
            ) : (
              <Stack spacing={0.5} data-testid="answers-read">
                {Object.entries(answerLabels).map(([field, label]) => (
                  <Typography key={field} variant="body2">
                    {label}: {answerShown(field) || tr("registrations.answers.none")}
                  </Typography>
                ))}
              </Stack>
            )}
            {/* What stays the person's, and why (`answers.ts`): one line each, the same for every reader. */}
            <Stack spacing={0.5} data-testid="answers-locked">
              <Typography variant="body2" sx={{ fontWeight: 600 }}>
                {tr("registrations.answers.lockedTitle")}
              </Typography>
              <Typography variant="body2" color="text.secondary">
                {tr("registrations.answers.lockedAddress")}
              </Typography>
              <Typography variant="body2" color="text.secondary">
                {tr("registrations.answers.lockedConsents")}
              </Typography>
              <Typography variant="body2" color="text.secondary">
                {tr("registrations.answers.lockedDeclaration")}
              </Typography>
            </Stack>
            <Typography variant="caption" color="text.secondary">
              {tr("registrations.answers.viewed")}
            </Typography>
            <Box>
              <GlyphButton icon="dismiss" href={`${detailPath}#answers`} variant="text" size="small" sx={{ minHeight: 44 }}>
                {tr("registrations.answers.hide")}
              </GlyphButton>
            </Box>
          </Stack>
        )}
      </Box>

      {/*
        Cancelling is what "remove this registration" means: the row is the record of what
        somebody agreed to, so nothing deletes it. The place is released inside the same locked
        transaction a participant's own cancellation uses, and is offered to the first in line or
        kept free, by the event's waitlist_auto_offer (AGENTS.md 15.5, 15.6; §615).
      */}
      {mayManage && canCancel && (
        <Box component="section">
          <Typography variant="h3" sx={{ fontSize: "1rem", mb: 1 }}>
            {tr("registrations.cancelTitle")}
          </Typography>
          <ActionForm
            action={cancelRegistrationAction}
            messages={refusal}
            confirm={{
              title: tr("confirm.cancelRegistrationTitle"),
              // The printed bib is named before the press (§311), not discovered in the pile.
              body:
                printedBib !== null
                  ? `${tr("confirm.cancelRegistrationPrintedBody", { number: printedBib })} ${tr("confirm.cancelRegistrationBody")}`
                  : tr("confirm.cancelRegistrationBody"),
              ...(registration.kind === "TEST" ? {} : { email: words.email(1) }),
              confirmLabel: tr("registrations.cancelAction"),
              cancelLabel: words.cancel,
              destructive: true,
            }}
            scope="cancel"
            data-testid="cancel-registration-form"
          >
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
              <GlyphButton icon="cancel" type="submit" variant="outlined" color="error" sx={{ minHeight: 44 }}>
                {tr("registrations.cancelAction")}
              </GlyphButton>
            </Stack>
            {/* The club's refusal under the terms (§618): ticked, the reason is the ground and the
                cancellation email names it — the box's own words say so before the press. */}
            <CheckboxField name="refusedByOrganizer" help={tr("registrations.refusedByOrganizerHelp")}>
              {tr("registrations.refusedByOrganizer")}
            </CheckboxField>
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
          {withdrawable.health || withdrawable.socials || withdrawable.results || withdrawable.promo ? (
            <ActionForm
              action={withdrawConsentAction}
              confirm={{ title: tr("confirm.withdrawConsentTitle"), body: tr("confirm.withdrawConsentBody"), confirmLabel: tr("registrations.withdraw.action"), cancelLabel: words.cancel, destructive: true }}
              data-testid="withdraw-consent-form"
            >
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
                  {withdrawable.promo && <CheckboxField name="promo">{tr("registrations.withdraw.promo")}</CheckboxField>}
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
            </ActionForm>
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
          <ActionForm
            action={deleteRegistrationAction}
            messages={eraseRefusal}
            confirm={{ title: tr("confirm.eraseRegistrationTitle"), body: tr("confirm.eraseRegistrationBody"), confirmLabel: tr("registrations.deleteAction"), cancelLabel: words.cancel, destructive: true }}
            scope="erase"
            data-testid="erase-registration-form"
          >
          <RecallDetails sx={{ ...BOXED_DISCLOSURE_SX, mt: 3, borderColor: "error.light" }}>
            <Typography component="summary" variant="subtitle2" color="error.main">
              <DeleteForeverIcon aria-hidden sx={FOLD_GLYPH_SX} />
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
          {tr("registrations.submitted")}: {dt(formSentAt(registration.submittedAt, registration.cycleStartedAt))}
        </Typography>
        {/*
          The two legal texts this cycle's form was sent under (§425), one line each and in the same
          shape: the privacy notice every registration acknowledges, and the club's terms accepted
          expressly on the form (§421). A staff or desk entry records no terms — the paper carries
          them (§67) — and a row sent before the column existed has no number to show; §316's
          window on /admin/legal is what answers for those.
        */}
        <Typography variant="body2" data-testid="timeline-privacy-notice">
          {tr("registrations.privacyNoticeLine", { date: dt(registration.cycleStartedAt) ?? "", version: registration.privacyNoticeVersion })}
        </Typography>
        <Typography variant="body2" data-testid="timeline-terms">
          {(() => {
            const termsLine = termsLineKindFor(registration);
            switch (termsLine.kind) {
              case "accepted":
                return tr("registrations.termsLine", { date: dt(termsLine.acceptedAt) ?? "—", version: termsLine.version });
              case "onPaper":
                return tr("registrations.termsOnPaper");
              case "notRecorded":
                return tr("registrations.termsNotRecorded");
            }
          })()}
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
          linkLine,
          holdLine,
          [tr("registrations.confirmed"), dt(registration.confirmedAt)],
          // "cancelled; bib 27 was printed" on the line itself (§311), whoever cancelled — the
          // participant's link and the job write no audit row, so the row is the record.
          [
            tr("registrations.cancelled"),
            registration.cancelledAt
              ? `${dt(registration.cancelledAt)} (${registration.cancellationSource})${registration.status === "CANCELLED" ? voidSuffix : ""}`
              : null,
          ],
          // Why the participant cancelled (§558), right under when: their answer, and the words of «Alt motiv».
          [
            tr("registrations.cancelReasonLabel"),
            registration.cancelReasonKind
              ? registration.cancelReasonKind === "OTHER" && registration.cancelReason
                ? tr("registrations.cancelReasonOther", {
                    kind: tr(`registrations.cancelReasonKinds.${registration.cancelReasonKind}`),
                    text: registration.cancelReason,
                  })
                : tr(`registrations.cancelReasonKinds.${registration.cancelReasonKind}`)
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
          <Box key={acceptance.id} data-testid="declaration-acceptance">
          <Typography variant="body2">
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
            {/* The proof of signing (§556): the signed text's fingerprint, twelve characters and the whole in a tooltip. */}
            {acceptance.textHash && (
              <>
                {" — "}
                <TextHashTip label={tr("declarationHold.textHash")} hash={acceptance.textHash} short={shortTextHash(acceptance.textHash)} />
              </>
            )}
          </Typography>
          {/* «Păstrează: reclamație / litigiu în curs» (§556): the line for every reader, the form for the Administrator. */}
          <DeclarationHoldForm
            registrationAction={declarationHoldAction}
            hidden={{ uiLocale: locale, registrationId: registration.id, acceptanceId: acceptance.id }}
            held={
              acceptance.retentionHold
                ? { when: dtInline(acceptance.retentionHoldAt) ?? "—", who: acceptance.retentionHoldByName, reason: acceptance.retentionHoldReason ?? "" }
                : null
            }
            mayManage={mayManage}
            scope={`hold-${acceptance.id}`}
          />
          </Box>
          );
        })}
      </Stack>

      {staffTrail.length > 0 && (
        <Stack spacing={1}>
          <Typography variant="h3" sx={{ fontSize: "1rem" }}>
            {tr("registrations.auditTrail")}
          </Typography>
          {staffTrail.map((entry, index) => {
            const metadata = trailMetadata(entry.action, entry.metadataJson);
            return (
              <Typography key={index} variant="body2">
                {dt(entry.createdAt)} · {trailLabel(entry.action, entry.metadataJson)} ·{" "}
                {entry.actorName ??
                  (entry.actorStaffUserId === null
                    ? tr("registrations.auditActorParticipant")
                    : tr("registrations.auditActorRemoved"))}
                {/* Metadata is the shape of the change — a name before and after, a typed reason —
                    never a copy of what the change was about (AGENTS.md 12.12). */}
                {Object.keys(metadata).length > 0 && ` · ${JSON.stringify(metadata)}`}
              </Typography>
            );
          })}
        </Stack>
      )}

      {/*
        «Dată partenerilor» (§570, review finding): the lists for sponsors that held this registration,
        from their audit rows — so a withdrawal or an access request is answered with which partner
        received the data and when, long after the club's own copy of the file is deleted.
      */}
      {partnerShares.length > 0 && (
        <Stack spacing={1} data-testid="partner-shares">
          <Typography variant="h3" sx={{ fontSize: "1rem" }}>
            {tr("registrations.partnerShares.title")}
          </Typography>
          {partnerShares.map((share, index) => (
            <Typography key={index} variant="body2">
              {dt(share.createdAt)} · {share.recipient ?? tr("registrations.partnerShares.noRecipient")} ·{" "}
              {share.actorName ?? tr("registrations.auditActorRemoved")}
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
