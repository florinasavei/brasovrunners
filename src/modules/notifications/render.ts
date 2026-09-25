import { eq } from "drizzle-orm";
import type { EmailActionTokenPurpose } from "@/db/schema/email-action-tokens";
import type { EmailMessageType } from "@/db/schema/email-outbox";
import { participants } from "@/db/schema/participants";
import { registrations } from "@/db/schema/registrations";
import { CLUB_TIME_ZONE, formatDay, formatTime } from "@/i18n/dates";
import { getPathname } from "@/i18n/navigation";
import type { Locale } from "@/i18n/routing";
import { issueActionToken } from "@/modules/action-tokens/repository";
import { readEventChanges, readEventNoticeWords } from "@/modules/events/domain/event-changes";
import { hasRouteDescription, partitionEventLinks } from "@/modules/events/domain/route-section";
import { localizedSchedule, programmeLines, readScheduleItems } from "@/modules/events/domain/schedule";
import {
  type EventNotificationRow,
  eventNotificationDetailsIn,
  findEventNotificationRows,
  findEventStartsAt,
  findPublishedEventBySlug,
} from "@/modules/events/repository";
import { toCalendarEvent } from "@/modules/events/calendar";
import { calendarLabels, placeToBeAnnouncedWords } from "@/modules/events/calendar-labels";
import { buildCalendar } from "@/modules/events/ical";
import { nightShape } from "@/modules/events/domain/night";
import { clubNightEvent } from "@/modules/events/night-event";
import { newCheckinCode } from "@/modules/registrations/checkin-code";
import { LIST_CONSENT_TOKEN_HOURS } from "@/modules/registrations/list-consent";
import { env } from "@/shared/config/env";
import type { OutgoingEmail } from "@/infrastructure/email/adapter";
import { declarationWords } from "@/modules/registrations/declaration-labels";
import { findSignedDeclaration, renderSignedDeclarationPdf } from "@/modules/registrations/signed-declaration";
import { renderGroupRunDeclarationPdf } from "@/modules/group-run-declarations/pdf";
import { findSignedGroupRunDeclaration, groupRunDeclarationIdOf } from "@/modules/group-run-declarations/repository";
import { bulkCopyRecipients, declarationPdfAudience, isClubCopy, isParticipantMessage } from "./domain/club-notices";
import { declarationAsksMinorToSign } from "@/modules/legal-documents/repository";
import { readOrganizerMessagePayload } from "./domain/organizer-message";
import { registrationStatusWords } from "./domain/registration-status-words";
import { readEmailCopyForSending } from "./email-copy";
import { DEFAULT_TOKEN_HOURS } from "./domain/token-lifetime";
import { currentDeadlines } from "@/modules/deadlines/deadlines";
import { emailLinkExpiresAt, reminderHoursFor } from "@/modules/deadlines/domain/deadlines";
import { ANOTHER_PERSON_PARAM } from "@/modules/registrations/domain/family";
import { confirmationDueMoment, participationWindowOpen } from "@/modules/registrations/domain/hold-deadlines";
import { weatherForEvent } from "@/modules/weather/source";
import { buildOutgoingEmail, type TemplateData } from "./templates";
import type { EmailEventFacts } from "./domain/event-facts";
import type { EmailRenderer, OutboxRow } from "./outbox";

/**
 * Turns one outbox row into the message to send (AGENTS.md §16.1, §16.3; BR-REQ-080-01).
 *
 * Fills the seam `notifications/outbox.ts` left for exactly this: looks up the participant,
 * registration and event the row points at, and — for a message type that carries an action
 * link — mints a fresh token right here, at send time, via the real `issueActionToken` (which
 * also invalidates whatever it is superseding, scoped exactly as every other caller of it is).
 * See `outbox.ts`'s `EmailRenderer` doc for why token issuance belongs here and not at enqueue
 * time: §14.5 forbids a secret anywhere durable and backed up, `email_outbox` included.
 */

const TOKEN_PURPOSE_BY_MESSAGE_TYPE: Partial<Record<EmailMessageType, EmailActionTokenPurpose>> = {
  VERIFY_REGISTRATION_EMAIL: "VERIFY_REGISTRATION_EMAIL",
  COMPLETE_DECLARATION: "COMPLETE_DECLARATION",
  WAITLIST_SPOT_OFFER: "WAITLIST_OFFER",
  REGISTRATION_CONFIRMED: "MANAGE_REGISTRATION",
  REGISTRATION_MANAGE_LINK: "MANAGE_REGISTRATION",
  // The participant's copy of the signed declaration (§95): the PDF attached, and the same
  // manage link the confirmation carries, so the PDF is also one click away when a mail client
  // strips attachments.
  DECLARATION_SIGNED: "MANAGE_REGISTRATION",
  // "Can't come? cancel here" (§81): the same manage link the confirmation carries.
  EVENT_REMINDER: "MANAGE_REGISTRATION",
  // The number given by hand (§105): the confirmation's facts and link, with the new number.
  BIB_ASSIGNED: "MANAGE_REGISTRATION",
  // Scoped to the participant, never to a registration (§12.8): the "my registrations" link.
  PROFILE_MANAGE_LINK: "MANAGE_PROFILE",
  // The form for another person on the same address (§389) — only while the address has room; at
  // the club's limit the message carries no link, and nothing is minted for it.
  REGISTER_ANOTHER_PERSON: "REGISTER_ANOTHER_PERSON",
};

/**
 * Where each purpose's link opens: a page of its own, the secret in its path — except the form for
 * another person on one address (§389), which is the event's own registration form with the secret
 * in `?another=` (`ANOTHER_PERSON_PARAM`), built below with the event's slug.
 */
const ROUTE_BY_PURPOSE: Record<
  Exclude<EmailActionTokenPurpose, "REGISTER_ANOTHER_PERSON">,
  | "/registrations/confirm/[token]"
  | "/registrations/declare/[token]"
  | "/registrations/manage/[token]"
  | "/registrations/mine/[token]"
  | "/registrations/list/[token]"
> = {
  VERIFY_REGISTRATION_EMAIL: "/registrations/confirm/[token]",
  COMPLETE_DECLARATION: "/registrations/declare/[token]",
  WAITLIST_OFFER: "/registrations/declare/[token]",
  MANAGE_REGISTRATION: "/registrations/manage/[token]",
  // "My registrations" (BR-REQ-036-04, `DECISIONS.md` §77); the M4 profile will share the purpose.
  MANAGE_PROFILE: "/registrations/mine/[token]",
  // The public list's own switch (BR-REQ-039-01): never a message's main action, always the
  // confirmation's second token — see below.
  LIST_CONSENT: "/registrations/list/[token]",
};


type RendererDb = Parameters<EmailRenderer>[1];

/** Every language's row of what a message needs about one event (`findEventNotificationRows`). */
export type EventRowsReader = (db: RendererDb, eventId: string) => Promise<readonly EventNotificationRow[]>;

/**
 * The renderer for one batch of the outbox (§373, email follow-up): `renderOutboxMessage`, with
 * each event's texts read once for the whole batch rather than once per message.
 *
 * Both halves of a message need the event's words — the registration's language first, the other
 * language after the rule (§96) — and one query already brings every language's row
 * (`findEventNotificationRows`). A batch of twenty reminders for one race is then one read, not
 * twenty, and not the forty a second read per half would have been. Everything else stays per
 * message: the registration, the participant and the token are the row's own.
 *
 * One renderer per `processOutboxBatch` call, never a module-level memo: the event's words are
 * read at send time (§331 — nothing an event held before a save reaches a runner), and a batch
 * lasts seconds, so the reads a batch shares are as fresh as the batch. A read that fails is not
 * remembered — the next row of the batch asks again — because a failed render is final
 * (`AGENTS.md` §16.1, `processOutboxBatch`).
 *
 * `readEventRows` is the seam a test counts reads through; the send path passes nothing.
 */
export function createOutboxRenderer(options: { readEventRows?: EventRowsReader } = {}): EmailRenderer {
  const read: EventRowsReader = options.readEventRows ?? ((db, eventId) => findEventNotificationRows(db, eventId));
  const byEvent = new Map<string, Promise<readonly EventNotificationRow[]>>();
  const eventRows = (db: RendererDb, eventId: string) => {
    let rows = byEvent.get(eventId);
    if (!rows) {
      rows = read(db, eventId);
      rows.catch(() => byEvent.delete(eventId));
      byEvent.set(eventId, rows);
    }
    return rows;
  };
  return (row, db, now) => renderRow(row, db, now, eventRows);
}

/** One message on its own — a renderer whose batch is this one row (tests, one-off callers). */
export const renderOutboxMessage: EmailRenderer = (row, db, now) => createOutboxRenderer()(row, db, now);

async function renderRow(
  row: OutboxRow,
  db: RendererDb,
  now: Date,
  eventRows: (db: RendererDb, eventId: string) => Promise<readonly EventNotificationRow[]>,
): Promise<OutgoingEmail> {
  const locale = row.locale as Locale;

  // A group run's self-declaration (§393) is about no registration: its own, shorter path.
  if (row.messageType === "GROUP_RUN_DECLARATION_SIGNED" || row.messageType === "GROUP_RUN_DECLARATION_ARCHIVE") {
    return renderGroupRunDeclarationRow(row, db, now, eventRows);
  }

  /*
    The club's copy of a participant's message (§320; `enqueueClubCopies` in `outbox.ts`).

    The same words the participant read, for a club mailbox — and nothing the participant alone
    may hold: no token is minted, so there is no action button, no manage link, no "take me off
    the list" link and no PDF-by-link; no check-in code or QR, which is what the desk hands a
    race number against; and no attachment, neither the signed declaration nor the calendar
    file. The subject and the first line say it is the club's copy and that the personal links
    were taken out. Its row carries no `participantId`, which on its own already keeps the token
    branches below shut; the flag closes them again explicitly, so a hand-made row that named a
    participant would still mint nothing.
  */
  const clubCopy = isClubCopy(row.payloadJson);
  /*
    A bulk send's one club copy (§NNN, `enqueueBulkClubCopies`): no registration and no participant
    behind it, the event's id and the number of recipients in its payload. It greets the club and
    names nobody.
  */
  const bulkRecipients = row.registrationId ? null : bulkCopyRecipients(row.payloadJson);

  const [registration] = row.registrationId
    ? await db.select().from(registrations).where(eq(registrations.id, row.registrationId)).limit(1)
    : [];

  // A club copy's greeting still names the runner, read through the registration it is about.
  const participantId = row.participantId ?? (clubCopy ? registration?.participantId : undefined);
  const [participant] = participantId
    ? await db.select().from(participants).where(eq(participants.id, participantId)).limit(1)
    : [];

  // The event comes from the registration — or, for the one message about an event and
  // nobody's registration (§146), from the payload's id, so a renamed event renders right.
  // A bulk send's club copy names its event the same way (§NNN).
  const payloadEventId =
    row.messageType === "REGISTRATION_OPENED" || bulkRecipients !== null ? (row.payloadJson as { eventId?: unknown } | null)?.eventId : undefined;
  const eventId = registration?.eventId ?? (typeof payloadEventId === "string" ? payloadEventId : undefined);
  // Every language's texts of the event, from the batch's one read of it (`createOutboxRenderer`).
  const eventTexts = eventId ? await eventRows(db, eventId) : [];
  const eventDetails = eventId ? eventNotificationDetailsIn(eventTexts, locale) : undefined;
  /*
    The other language's own row, for the second half (§373, email follow-up). None when the event
    has no text in that language — then the row this message reads may itself be the other
    language's (the fallback above), and both halves read it, as every message did before.
  */
  const otherDetails = eventTexts.find((candidate) => candidate.locale === otherLocale(locale) && candidate.locale !== eventDetails?.locale);
  // The place is not announced yet (§328): the query has withheld the place and the map, and the
  // facts line — and a `{eventLocationName}` in the club's own copy — says so in the page's words,
  // each half of the bilingual message in its own language.
  const placeLater = eventDetails?.locationToBeAnnounced === true;

  const data: TemplateData = {
    /*
      The runner this message is about: the registration's own name when there is one (§389). One
      address may carry a family, and the participant's `default_name` is only whoever filled the
      form first — the confirmation of a second child must greet that child, and the club's archive
      copy must name who signed. Without a registration (the "my registrations" link), the address's
      name. The one bulk club copy of an organizer's message reads it too — blank, as before — and
      `organizerMessageParts` (`templates.ts`) is what turns that blank into a neutral word wherever
      the organizer's own body used `{participantName}` (§NNN, review finding).
    */
    participantName: registration?.registeredName ?? participant?.defaultName ?? "",
    eventTitle: eventDetails?.title,
    // The place in the runner's language (§362), nullable on an event row from before the column
    // (`DECISIONS.md` §36); the template already renders nothing for an absent field.
    eventLocationName: placeLater ? placeToBeAnnouncedWords(locale) : (eventDetails?.locationName ?? undefined),
    // And in the other language, for the second half of the bilingual message: its own name for
    // the place, never the first half's words — or the sentence while it is to be announced (§328).
    eventLocationNameOther: placeLater
      ? placeToBeAnnouncedWords(otherLocale(locale))
      : (eventDetails?.locationNames[otherLocale(locale)] ?? undefined),
    eventStartsAtFormatted: formatEventStart(eventDetails, locale),
    // The other language's half of the bilingual message reads its own date (§96).
    eventStartsAtFormattedOther: formatEventStart(eventDetails, locale === "ro" ? "en" : "ro"),
    eventMapUrl: eventDetails?.mapUrl ?? undefined,
    eventStravaEventUrl: eventDetails?.stravaEventUrl ?? undefined,
    eventChecklist: eventDetails?.checklist ?? undefined,
    // In words, never the raw enum (§373, email follow-up review): the same table the sample and
    // the legend read (`registrationStatusWords`), so a runner never reads "CONFIRMED".
    currentStatus: registration ? registrationStatusWords(registration.status, locale) : undefined,
    // The other language's own words, for the bilingual message's second half — never the first
    // half's language repeated under the other language's sentence (§373, email follow-up).
    currentStatusOther: registration ? registrationStatusWords(registration.status, otherLocale(locale)) : undefined,
    // The footer line is there whenever somebody can answer (§81).
    replyTo: env.EMAIL_REPLY_TO ?? undefined,
    // The event's own page, for the deep link every message carries (§96).
    eventUrl: eventDetails?.slug
      ? `${env.APP_BASE_URL}${getPathname({ locale, href: { pathname: "/events/[slug]", params: { slug: eventDetails.slug } } })}`
      : undefined,
    /*
      The listing and the contact page, on every participant message (§239; the owner: "I
      need more links in that email").

      Unconditional, unlike the ones above: they do not depend on an event, on a token or on
      anything the organizer wrote, so there is no state in which the reader cannot use them.
      Both go through `getPathname` in the message's own language, so a Romanian message
      links to /evenimente and an English one to /events (`AGENTS.md` §8: the host comes from
      `APP_BASE_URL` and appears nowhere in `src/`).
    */
    eventsUrl: `${env.APP_BASE_URL}${getPathname({ locale, href: "/events" })}`,
    contactUrl: `${env.APP_BASE_URL}${getPathname({ locale, href: "/contact" })}`,
  };
  /*
    The deadlines the words state (§377), as numbers — the club's "Termene" in force now, this
    event's own reminder lead, its window's opening and the link's lifetime — so a message never
    promises "48 de ore" when the club chose otherwise. From the instance's minute-long memo: a
    batch of twenty rows reads the setting once, not twenty times.
  */
  const settings = await currentDeadlines(db);
  data.timings = {
    confirmationHours: settings.confirmationHours,
    holdMinutes: settings.holdMinutes,
    offerHours: settings.offerHours,
    reminderHours: reminderHoursFor({ reminderHoursBefore: eventDetails?.reminderHoursBefore ?? null }, settings),
    ...(eventDetails ? { confirmationOpensDays: eventDetails.confirmationOpensDaysBefore } : {}),
    linkDays: DEFAULT_TOKEN_HOURS / 24,
  };
  /*
    The second half in its own language's words (§373, email follow-up; the owner: "multi-lingual,
    always"). The title, "what to bring" and the place's name are the translation's, so the English
    half of a Romanian registrant's message read the Romanian checklist until now. The other
    language's own values, and nothing else: a checklist written in one language only is said in
    that language's half and left out of the other (`null`), never repeated in the wrong language.
    A place to be announced is the sentence above, in each half's own words (§328); a place with no
    name in the other language keeps the row's.
  */
  if (otherDetails) {
    data.eventTitleOther = otherDetails.title;
    data.eventChecklistOther = otherDetails.checklist ?? null;
    if (!placeLater && otherDetails.locationName) data.eventLocationNameOther = otherDetails.locationName;
  }
  // The subject's "[Copie club]" and the line that says the personal links were taken out.
  if (clubCopy) data.clubCopy = true;
  // A bulk send's one copy: how many it went to, and nobody's name (§NNN).
  if (bulkRecipients !== null) data.clubCopyRecipients = bulkRecipients;
  /*
    A minor's registration (§108): the address is the parent's or guardian's, so the message greets
    them and says whose registration it is about (§NNN; GDPR art. 12(1), 14; Codul civil art.
    41–43). "A minor" is `guardian_name` set, the truthiness every other part of the platform reads.
    The declaration request also says who signs: both, when the declaration in force in the
    registration's language asks the minor to sign as well (§330), else the parent alone.
  */
  if (registration?.guardianName) {
    data.guardianName = registration.guardianName;
    if (row.messageType === "COMPLETE_DECLARATION" || row.messageType === "WAITLIST_SPOT_OFFER") {
      data.minorSigns = await declarationAsksMinorToSign(db, registration.locale as Locale, now);
    }
  }
  if (data.eventUrl && eventDetails?.hasRules) data.eventRulesUrl = `${data.eventUrl}#rules`;
  /*
    The hold's deadline on the declaration email (§104), and whether it is the window's — a
    deadline more than a day away is the week-before confirmation, not the club's hold (§377) — and
    the offer's on the freed place (§NNN: the message that starts the clock names when it stops;
    Codul civil art. 1191, 1193). A deadline already behind us (a resend after it) is not named:
    the declaration's place is being kept (§160), and the offer says its length instead.
  */
  if (
    (row.messageType === "COMPLETE_DECLARATION" || row.messageType === "WAITLIST_SPOT_OFFER") &&
    registration?.holdExpiresAt &&
    registration.holdExpiresAt.getTime() > now.getTime()
  ) {
    // Each half of the bilingual message in its own words (§96, §349).
    const holdZone = eventDetails?.timezone ?? CLUB_TIME_ZONE;
    /*
      A hold that ends at the start itself — a deadline of zero days (§407) — reads "până la start,
      sâm., 21 nov. 2026, 09:00" / "by the start, Sat, 21 Nov 2026, 09:00": the "until the start"
      form beside the date, decided by the one helper, in the value itself, so a text the club
      wrote with `{holdExpiresAtFormatted}` (§359) says it too. An offer capped at the start
      (`capHoldExpiry`) reads the same way.
    */
    const holdEndsAt = registration.holdExpiresAt;
    const due = eventDetails ? { at: holdEndsAt, startsAt: eventDetails.startsAt } : null;
    const dated = (inLocale: Locale) => {
      const formatted = formatInSentence(holdEndsAt, holdZone, inLocale);
      return due ? confirmationDueMoment(inLocale, due, formatted) : formatted;
    };
    data.holdExpiresAtFormatted = dated(locale);
    data.holdExpiresAtFormattedOther = dated(otherLocale(locale));
    if (row.messageType === "COMPLETE_DECLARATION") {
      data.confirmLater = holdEndsAt.getTime() - now.getTime() > 24 * 60 * 60_000;
      // Once the participation window is open this message is itself the reminder (the send when
      // the window opens, or a resend after it), so it must not promise "or when we remind you".
      if (eventDetails) {
        data.windowOpen = participationWindowOpen(eventDetails.startsAt, eventDetails.confirmationOpensDaysBefore, now);
      }
    }
    /*
      An offer's stated length must agree with its stated moment (§NNN, following the finding
      raised in review: counsel's own citation, Codul civil art. 1191, 1193, is contradicted by a
      message that names a deadline and then a length that does not reach it). `holdExpiresAt` is
      already capped at registration close or the event start (`capHoldExpiry`), and the club's
      "Termene" may since have changed (§377 applies a change to new offers only) — so the words
      are worked out from this offer's own span, `offerCreatedAt` to `holdExpiresAt`, never from
      the setting in force now: whole hours only when the span is exactly that many, minutes
      otherwise (`minutesPhrase`, `timingWords`) — so a 20-minute offer never says "o oră" and a
      1 h 31 min one never says "2 ore" either; the stated length never claims more than the real
      span, so it is floored, never rounded — 90 minutes 40 seconds still reads "90 de minute",
      not 91. Without an `offerCreatedAt` (a row from before this column, or a test fixture) the
      club's current setting is kept, as before.
    */
    if (row.messageType === "WAITLIST_SPOT_OFFER" && registration.offerCreatedAt && data.timings) {
      const offerMinutes = Math.max(1, Math.floor((holdEndsAt.getTime() - registration.offerCreatedAt.getTime()) / 60_000));
      data.timings = { ...data.timings, offerMinutes };
    }
  }
  if (data.eventUrl && eventDetails?.hasSchedule) data.eventScheduleUrl = `${data.eventUrl}#schedule`;
  /*
    "Detalii actualizate" (§331): which facts the save changed, from the payload; the facts
    themselves are the ones above, read now. Nothing the event held before the save is in the
    row, so nothing it held before can reach the runner — a place corrected twice before this
    batch runs is sent once, as it now stands.
  */
  const updateChanges = row.messageType === "EVENT_UPDATE_NOTICE" ? readEventChanges((row.payloadJson as { changes?: unknown } | null)?.changes) : [];
  if (row.messageType === "EVENT_UPDATE_NOTICE") {
    data.updateChanges = updateChanges;
    /*
      The organizer's note in this registrant's language, and the other half's in the other
      (§354, bilingual everywhere). A row queued before carries one string: both halves read it,
      as they always did (`readEventNoticeWords`).
    */
    const note = readEventNoticeWords((row.payloadJson as { note?: unknown } | null)?.note, locale);
    if (note.text) data.organizerNote = note.text;
    if (note.other) data.organizerNoteOther = note.other;
    if (updateChanges.includes("time") && eventDetails?.raceStartsAt) {
      data.eventRaceStartsAtFormatted = formatTime(eventDetails.raceStartsAt, { locale, timeZone: eventDetails.timezone });
    }
  }
  // "{event} a fost anulat" (§331): the reason the organizer typed, and nothing to act on — each
  // half of the message in its own language (§354), or an older row's one text in both.
  if (row.messageType === "EVENT_CANCELLED") {
    const reason = readEventNoticeWords((row.payloadJson as { reason?: unknown } | null)?.reason, locale);
    if (reason.text) data.cancellationReason = reason.text;
    if (reason.other) data.cancellationReasonOther = reason.other;
  }
  /*
    "Trimite un mesaj participanților" (§364): the organizer's subject and body, this registrant's
    language first and the other language's own words in the second half (§354). A row whose
    payload cannot be read goes with the platform's subject and framing sentence alone.
  */
  if (row.messageType === "ORGANIZER_MESSAGE") {
    const words = readOrganizerMessagePayload(row.payloadJson);
    const other = otherLocale(locale);
    if (words) {
      data.organizerSubject = words.subject[locale];
      data.organizerSubjectOther = words.subject[other];
      data.organizerBody = words.body[locale];
      data.organizerBodyOther = words.body[other];
    }
    // The settled number only (`ORGANIZER_MESSAGE_PLACEHOLDERS`): a provisional one would print
    // without the line that says it can still move (§237).
    if (registration?.status === "CONFIRMED" && registration.bibNumber !== null) data.bibNumber = registration.bibNumber;
  }
  /*
    "Înscrierile mele" by address, not by token: neither message mints anything (§77). On the
    update notice too (§NNN): a runner whom the new date or place does not suit withdraws there, so
    the place goes to the waiting list instead of staying blocked.
  */
  if (row.messageType === "ORGANIZER_MESSAGE" || row.messageType === "EVENT_UPDATE_NOTICE") {
    data.myRegistrationsUrl = `${env.APP_BASE_URL}${getPathname({ locale, href: "/registrations/mine" })}`;
  }
  // "Linkuri și fișiere" (§332): one line pointing at `#links`, only when the page has one — the
  // anchor exists only then (`EventLinks`), and a route section (§387) can take every link of the
  // route's own kinds out of it, so the page's own split (`partitionEventLinks`) decides, not a
  // raw count of the event's links. The addresses themselves stay on the page: the email names
  // where they are, never a raw Drive link in a message that is forwarded.
  if (data.eventUrl && eventDetails) {
    const routeSection = hasRouteDescription(eventDetails.routeDescriptionJson);
    if (partitionEventLinks(eventDetails.links, routeSection).other.length > 0) data.eventLinksUrl = `${data.eventUrl}#links`;
  }
  /*
    The event's facts block (§392): each half in its own language, from its own row — its place's
    name, its page and that page's sections — with the event's own facts (the start, the address,
    the route, the cost, the programme's rows) shared. The template draws it on the three messages
    that carry it; the rows here are read once per event per batch already.
  */
  if (eventDetails) {
    data.eventFacts = emailEventFacts(eventDetails, data.eventUrl ?? null);
    if (otherDetails) {
      const otherUrl = otherDetails.slug
        ? `${env.APP_BASE_URL}${getPathname({ locale: otherLocale(locale), href: { pathname: "/events/[slug]", params: { slug: otherDetails.slug } } })}`
        : null;
      data.eventFactsOther = emailEventFacts(otherDetails, otherUrl);
    }
  }
  // A night event (§394, the question §382 left open): the reminder says the sunset and to bring a
  // light — only when this date, the one being reminded of, is one; the same function as the pill.
  if (row.messageType === "EVENT_REMINDER" && eventDetails) {
    const night = clubNightEvent(eventDetails);
    if (night.night) {
      data.nightEventSunset = night.sunset ?? "";
      data.nightEventIsGroupRun = eventDetails.type === "GROUP_RUN";
      // The start named before the sunset, and the end when it is the reason (§404) — the shape
      // decided by `nightShape`, the same rule as the calendar and the `.ics`; the pill's tooltip
      // names only the sunset (§415) and does not ask it.
      if (night.start) data.nightEventStart = night.start;
      const shape = nightShape(night);
      if ((shape?.suffix === "End" || shape?.suffix === "EndProgramme") && night.end) {
        data.nightEventEnd = night.end;
        data.nightEventEndSource = shape.suffix === "EndProgramme" ? "programme" : "event";
      } else if (shape?.suffix === "After") {
        // No end was ever named: the sun alone made the call and the start was already past
        // sunset (§404) — say so, instead of leaving the sunset looking like the reason alone.
        data.nightEventAfter = true;
      } else if (shape?.suffix === "Dawn" && night.sunrise) {
        // An early-morning start before that day's sunrise (§404): the line names the sunrise,
        // never «după apusul» of the evening before it.
        data.nightEventSunrise = night.sunrise;
      }
    }
  }
  // The programme's rows in the update notice when the programme is what changed (§331), each half
  // of the bilingual mail in its own words; the reminder carries them in the facts block (§392).
  if (updateChanges.includes("programme") && eventDetails) {
    const items = readScheduleItems(eventDetails.scheduleItems);
    if (items.length > 0) {
      const other = locale === "ro" ? "en" : "ro";
      data.eventProgramme = programmeLines(localizedSchedule(items, locale), eventDetails.timezone, locale);
      data.eventProgrammeOther = programmeLines(localizedSchedule(items, other), eventDetails.timezone, other);
    }
  }
  /*
    The forecast for the start on the reminder (§402), read at send time — the reminder goes out a
    day or two before, inside the seven days a forecast is shown for — through the same cached
    request the event page makes. Each half words it in its own language (`templates.ts`). Nothing
    when Open-Meteo did not answer within its three seconds: the reminder goes out without the line,
    never later for it.
  */
  if (row.messageType === "EVENT_REMINDER" && eventDetails) {
    const weather = await weatherForEvent(eventDetails, now);
    if (weather) data.eventWeather = weather;
  }
  // The thank-you's optional link (§82) rides in the payload; it is the action, and not a token.
  let payloadActionUrl: string | undefined;
  if (row.messageType === "EVENT_THANKS") {
    const url = (row.payloadJson as { url?: unknown } | null)?.url;
    if (typeof url === "string" && url.startsWith("https://")) {
      data.thanksUrl = url;
      payloadActionUrl = url;
    }
  }
  /*
    A message re-sent because the form was filled in again (§199, §235). The flag is in the
    payload rather than derived here: only the caller knows why this row was queued, and the
    row is the record of that.
  */
  if ((row.payloadJson as { alreadyRegistered?: unknown } | null)?.alreadyRegistered === true) {
    data.alreadyRegistered = true;
  }
  // The staff invitation (§141): everything it says is in the payload — there is no
  // participant and no token; the action is the sign-in page, which asserts who they are.
  if (row.messageType === "STAFF_INVITATION") {
    const payload = (row.payloadJson ?? {}) as { displayName?: unknown; role?: unknown; inviterName?: unknown };
    data.participantName = typeof payload.displayName === "string" ? payload.displayName : "";
    data.staffRole = typeof payload.role === "string" ? payload.role : undefined;
    data.inviterName = typeof payload.inviterName === "string" ? payload.inviterName : undefined;
    data.staffEmail = row.recipientEmail;
    data.signInUrl = `${env.APP_BASE_URL}${getPathname({ locale, href: "/sign-in" })}`;
    payloadActionUrl = data.signInUrl;
  }
  // The update's one button is the event's own page (§331): public, no token — and, like every
  // action, absent from a club copy.
  // The organizer's message too (§364): the one place a runner checks what the message is about.
  if ((row.messageType === "EVENT_UPDATE_NOTICE" || row.messageType === "ORGANIZER_MESSAGE") && data.eventUrl) payloadActionUrl = data.eventUrl;
  // "Registration is open" (§146): no participant, no token; the action is the ordinary
  // registration page, which asks everything itself.
  if (row.messageType === "REGISTRATION_OPENED" && eventDetails?.slug) {
    payloadActionUrl = `${env.APP_BASE_URL}${getPathname({ locale, href: { pathname: "/events/[slug]/register", params: { slug: eventDetails.slug } } })}`;
  }
  // The desk code on the confirmation and the reminder (BR-REQ-037-08). A confirmed
  // registration made before codes existed gets one here, so a resent confirmation carries it too.
  // The club's own notice (§245) needs the number and nothing else the runner's copy carries:
  // no check-in code and no QR, because neither means anything in a club mailbox.
  if (row.messageType === "CLUB_CONFIRMATION_NOTICE" && registration) {
    data.bibNumber = registration.bibNumber ?? undefined;
  }

  if (
    (row.messageType === "REGISTRATION_CONFIRMED" || row.messageType === "EVENT_REMINDER" || row.messageType === "BIB_ASSIGNED") &&
    registration?.status === "CONFIRMED"
  ) {
    // The desk hands the number against this code; a club mailbox has no use for it (§245's
    // reasoning for the club's own notice, and §320's for the club copy).
    if (!clubCopy) {
      let code = registration.checkinCode;
      if (!code) {
        code = newCheckinCode();
        await db.update(registrations).set({ checkinCode: code }).where(eq(registrations.id, registration.id));
      }
      data.checkinCode = code;
      data.checkinQrUrl = `${env.APP_BASE_URL}/api/registrations/qr/${code}.png`;
    }
    /*
      The number the runner has, settled or not (§237; the owner: "peste tot trebuie să
      apară BID-ul!!").

      §214 stopped writing `bib_number` until the window closes, and this line read only
      that column — so the confirmation went out with a QR, a check-in code and no number,
      for a runner who had been looking at number 2 on their own page since they
      registered. Absent is worse than provisional: it reads as "you have not been given
      one", and the desk is where they find out otherwise.

      So it is sent, and it is **labelled** when it can still move — which is the condition
      §214 attached to emailing it at all. The settle sends `BIB_ASSIGNED` with the final
      one, so nobody is left holding only the provisional figure.
    */
    data.bibNumber = registration.bibNumber ?? registration.provisionalBibNumber ?? undefined;
    data.bibProvisional = registration.bibNumber === null && registration.provisionalBibNumber !== null;
  }

  /*
    The link for another person on one address (§389): what the submission decided, from the row —
    the club's limit as it stood then, and whether the address had reached it. At the limit the
    message is the sentence that says so, and no token is minted for a link it does not carry.
  */
  let anotherPersonLink = false;
  if (row.messageType === "REGISTER_ANOTHER_PERSON") {
    const payload = (row.payloadJson ?? {}) as { atCap?: unknown; registrationsPerAddress?: unknown };
    data.addressAtCap = payload.atCap === true;
    if (typeof payload.registrationsPerAddress === "number") data.addressCap = payload.registrationsPerAddress;
    anotherPersonLink = !data.addressAtCap && Boolean(eventDetails?.slug);
  }

  const purpose = TOKEN_PURPOSE_BY_MESSAGE_TYPE[row.messageType];

  // A club copy has no action button at all — not even the thank-you's public link — so there is
  // one rule to check rather than a list of which actions are safe to copy (§320).
  let actionUrl: string | undefined = clubCopy ? undefined : payloadActionUrl;
  if (purpose === "REGISTER_ANOTHER_PERSON") {
    if (anotherPersonLink && eventDetails && row.participantId && row.registrationId && !clubCopy) {
      /*
        Single use, hashed at rest, minted here at send time like every link (§12.8, §14.5), and
        alive for the club's email-link window ("Termene", §377) — the same hours the other person's
        own confirmation link will get. Scoped to the registration the address already holds here,
        which names the event and the participant; opening the page reads it, only the submission
        spends it. The form is the event's own, in the language its slug belongs to.
      */
      const issued = await issueActionToken(db, {
        participantId: row.participantId,
        registrationId: row.registrationId,
        purpose,
        expiresAt: emailLinkExpiresAt(now, settings),
        now,
      });
      const formPath = getPathname({
        locale: eventDetails.locale,
        href: { pathname: "/events/[slug]/register", params: { slug: eventDetails.slug } },
      });
      actionUrl = `${env.APP_BASE_URL}${formPath}?${ANOTHER_PERSON_PARAM}=${issued.secret}`;
    }
  } else if (purpose && row.participantId && !clubCopy) {
    const route = ROUTE_BY_PURPOSE[purpose];
    const defaultExpiresAt = new Date(now.getTime() + DEFAULT_TOKEN_HOURS * 60 * 60_000);
    // Borrow the registration's own deadline so the token dies when the place does — but only
    // while that deadline is still ahead of `now`. A hold can lapse between this message being
    // queued and a delayed batch actually rendering it; issuing a token that expires in the
    // past would fail outright, and the registration's own status guard is what correctly
    // refuses a stale click regardless of how long the token stays valid. For the declaration
    // that deadline is the event's start, not the hold's (§160): a hold past its deadline is
    // kept while nobody waits, and the link in the email must still open the declaration then.
    //
    // The start is read from the event's own row rather than from `eventDetails`, which is a
    // join through `event_translations`: how long a secret lives must not depend on whether
    // somebody has written the event's text in a locale (AGENTS.md §12.8).
    const holdExpiresAt = registration?.holdExpiresAt;
    const eventStartsAt =
      purpose === "COMPLETE_DECLARATION" && eventId
        ? (eventDetails?.startsAt ?? (await findEventStartsAt(db, eventId)))
        : undefined;
    /*
      The verification link dies when the registration's own link does (§377, §NNN): the lapse
      written on the row when it entered `PENDING_EMAIL_CONFIRMATION`, or — on a row written before
      the column — the club's hours from now. It used to borrow `holdExpiresAt`, which that state
      never has, and so lived the fourteen-day default: after the job had lapsed the row at 48 hours,
      the link was still good, was spent on a click, and the page said "confirmed, now sign" to a
      registration that no longer existed (BR-REQ-031-03 criterion 2).
    */
    const placeUntil =
      purpose === "COMPLETE_DECLARATION"
        ? (eventStartsAt ?? holdExpiresAt)
        : purpose === "VERIFY_REGISTRATION_EMAIL"
          ? (registration?.emailLinkExpiresAt ?? emailLinkExpiresAt(now, settings))
          : holdExpiresAt;
    const expiresAt = placeUntil && placeUntil.getTime() > now.getTime() ? placeUntil : defaultExpiresAt;
    const issued = await issueActionToken(db, {
      participantId: row.participantId,
      registrationId: row.registrationId,
      purpose,
      expiresAt,
      now,
    });
    const path = getPathname({ locale, href: { pathname: route, params: { token: issued.secret } } });
    actionUrl = `${env.APP_BASE_URL}${path}`;
    // The confirmation's second use of the same manage token: the signed declaration as a
    // PDF (§95), read without spending it.
    if (row.messageType === "REGISTRATION_CONFIRMED" || row.messageType === "DECLARATION_SIGNED") {
      data.declarationPdfUrl = `${env.APP_BASE_URL}/api/registrations/declaration/${issued.secret}`;
    }
    // "I can't make it any more" is the manage page's cancel section, one tap from the mail (§96).
    if (purpose === "MANAGE_REGISTRATION") data.manageUrl = actionUrl;
  }

  /*
    The confirmation's second token: the public participant list, the participant's own switch
    (BR-REQ-039-01; `DECISIONS.md` §143). "Nu vreau să apar pe lista publică" when the name is
    on it, "Vreau să apar" when it is not — the link reads the row as it stands at send time.

    Its own purpose, `LIST_CONSENT`, rather than a second use of the manage token above:
    spending one must not spend the other, and one active token per (registration, purpose) is
    what the table enforces. The lifetime is the same fortnight the manage link gets; after it,
    "Înscrierile mele" and the manage page carry the same button under their own links.
  */
  if (row.messageType === "REGISTRATION_CONFIRMED" && row.participantId && registration && !clubCopy) {
    const issued = await issueActionToken(db, {
      participantId: row.participantId,
      registrationId: registration.id,
      purpose: "LIST_CONSENT",
      expiresAt: new Date(now.getTime() + LIST_CONSENT_TOKEN_HOURS * 60 * 60_000),
      now,
    });
    const path = getPathname({ locale, href: { pathname: ROUTE_BY_PURPOSE.LIST_CONSENT, params: { token: issued.secret } } });
    data.listConsentUrl = `${env.APP_BASE_URL}${path}`;
    data.listed = !registration.listOptOut;
  }

  // The signed declaration itself, rendered now from the rows and never stored as a file
  // (§95): a copy the participant keeps, in the language they signed in — on the confirmation
  // since §126, on the club's archive copy, and on the older message type for a resend.
  let attachments: OutgoingEmail["attachments"];

  /**
   * The event in the runner's own calendar, attached (§174; the owner: "și de iCal ca să poată
   * pune în calendar").
   *
   * On the confirmation and the reminder, which are the two messages somebody acts on. Every
   * phone and desktop client opens an `.ics` attachment with one tap — including the ones that
   * will not follow a link out to the site, which on race week is the point. It is the same
   * file the event page offers (§107, §159), built from the same function, so what lands in a
   * calendar says exactly what the page says.
   *
   * A published event only: an `.ics` for a draft would leak an unpublished page's details into
   * somebody's calendar. When there is no published row the message simply goes without it.
   *
   * Never on a club copy (§320), which attaches nothing: the rule is "no attachment", not a list.
   */
  if (
    !clubCopy &&
    (row.messageType === "REGISTRATION_CONFIRMED" || row.messageType === "EVENT_REMINDER") &&
    eventDetails?.slug
  ) {
    const published = await findPublishedEventBySlug(db, locale, eventDetails.slug);
    if (published) {
      const ics = buildCalendar({
        events: [toCalendarEvent(published, locale, now)],
        baseUrl: env.APP_BASE_URL,
        name: published.title,
        labels: calendarLabels(locale),
      });
      attachments = [
        { filename: `${eventDetails.slug}.ics`, contentType: "text/calendar; charset=utf-8", data: Buffer.from(ics, "utf8") },
      ];
    }
  }

  /*
    Which copy of the PDF, if any (§320): the whole document on the participant's own messages;
    on the club's archive copy (§99, §244) the identity document masked, because that copy leaves
    the platform for mailboxes nobody sweeps after seven days as the database is swept (§95) —
    the whole document stays in the event's bundle in the backoffice for those seven days. A
    club copy of a participant's message attaches nothing, and says when it was signed anyway.
  */
  const pdfAudience = declarationPdfAudience(row.messageType, clubCopy);
  if (
    (row.messageType === "REGISTRATION_CONFIRMED" || row.messageType === "DECLARATION_SIGNED" || row.messageType === "DECLARATION_ARCHIVE") &&
    registration
  ) {
    const signed = await findSignedDeclaration(db, registration.id);
    if (signed) {
      const pdf = pdfAudience
        ? await renderSignedDeclarationPdf(db, signed, registration.eventId, declarationWords(signed.locale, now), now, pdfAudience)
        : undefined;
      // Beside the calendar file, never instead of it: the confirmation carries both (§174).
      if (pdf) attachments = [...(attachments ?? []), { filename: "declaratie-semnata.pdf", contentType: "application/pdf", data: pdf }];
      // In the message's language — the registration's — and the other half in its own (§349);
      // the PDF beside it is in the declaration's.
      const signedZone = eventDetails?.timezone ?? CLUB_TIME_ZONE;
      data.signedAtFormatted = formatInSentence(signed.acceptedAt, signedZone, locale);
      data.signedAtFormattedOther = formatInSentence(signed.acceptedAt, signedZone, otherLocale(locale));
    }
  }

  /*
    The club's copies of the declaration (§244), as the confirmation asked for them.

    Read from the payload rather than from the setting: the row is what was decided when the
    declaration was signed, and a list edited since must not silently redirect a copy that was
    already queued. Addresses only — `AGENTS.md` §14.5 keeps bodies and tokens out of the row,
    and an address is neither.

    Only the club's own messages carry copies on their envelope (§320). A participant's message
    never does — including a row queued before §320 with the old participant Bcc in its payload,
    which now goes to the participant alone rather than handing that mailbox the runner's live
    links — and a club copy goes to the one address its row is for.
  */
  const envelopeCopies = !clubCopy && !isParticipantMessage(row.messageType);
  const payload = (envelopeCopies ? (row.payloadJson ?? {}) : {}) as { cc?: unknown; bcc?: unknown };
  const addresses = (value: unknown): string[] =>
    Array.isArray(value) ? value.filter((entry): entry is string => typeof entry === "string" && entry.trim() !== "") : [];

  return buildOutgoingEmail({
    to: row.recipientEmail,
    locale,
    idempotencyKey: row.idempotencyKey,
    messageType: row.messageType,
    data,
    actionUrl,
    attachments: clubCopy ? undefined : attachments,
    // The club's own words, when it has written any (§247). Memoized for half a minute, so a
    // batch of twenty reads the setting once rather than twenty times.
    overrides: await readEmailCopyForSending(db, now),
    cc: addresses(payload.cc),
    bcc: addresses(payload.bcc),
  });
}

/**
 * A group run's optional self-declaration (§393): the signer's copy or the club's archive copy.
 *
 * About a declaration row, not a registration: no participant, no token, no manage link — there is
 * nothing to manage — and the PDF is drawn from the row at send time, never stored (§95), the
 * identity document masked on both copies (§320; the signer's since §NNN). A row whose declaration is
 * gone (erased, or swept seven days after the run) cannot be rendered, and says so: a failed render
 * is final (`AGENTS.md` §16.1), which is right — there is nothing left to send.
 */
async function renderGroupRunDeclarationRow(
  row: OutboxRow,
  db: RendererDb,
  now: Date,
  eventRows: (db: RendererDb, eventId: string) => Promise<readonly EventNotificationRow[]>,
): Promise<OutgoingEmail> {
  const locale = row.locale as Locale;
  const archive = row.messageType === "GROUP_RUN_DECLARATION_ARCHIVE";
  const id = groupRunDeclarationIdOf(row.payloadJson);
  const signed = id ? await findSignedGroupRunDeclaration(db, id) : undefined;
  if (!signed) throw new Error("the group-run declaration this message is about no longer exists");

  const eventTexts = await eventRows(db, signed.eventId);
  const eventDetails = eventNotificationDetailsIn(eventTexts, locale);
  const otherDetails = eventTexts.find((candidate) => candidate.locale === otherLocale(locale) && candidate.locale !== eventDetails?.locale);
  const placeLater = eventDetails?.locationToBeAnnounced === true;
  const zone = eventDetails?.timezone ?? CLUB_TIME_ZONE;

  const data: TemplateData = {
    participantName: signed.typedName,
    eventTitle: eventDetails?.title,
    eventLocationName: placeLater ? placeToBeAnnouncedWords(locale) : (eventDetails?.locationName ?? undefined),
    eventLocationNameOther: placeLater ? placeToBeAnnouncedWords(otherLocale(locale)) : (eventDetails?.locationNames[otherLocale(locale)] ?? undefined),
    eventStartsAtFormatted: formatEventStart(eventDetails, locale),
    eventStartsAtFormattedOther: formatEventStart(eventDetails, otherLocale(locale)),
    signedAtFormatted: formatInSentence(signed.acceptedAt, zone, locale),
    signedAtFormattedOther: formatInSentence(signed.acceptedAt, zone, otherLocale(locale)),
    replyTo: env.EMAIL_REPLY_TO ?? undefined,
    eventUrl: eventDetails?.slug
      ? `${env.APP_BASE_URL}${getPathname({ locale, href: { pathname: "/events/[slug]", params: { slug: eventDetails.slug } } })}`
      : undefined,
    eventsUrl: `${env.APP_BASE_URL}${getPathname({ locale, href: "/events" })}`,
    contactUrl: `${env.APP_BASE_URL}${getPathname({ locale, href: "/contact" })}`,
  };
  if (otherDetails) {
    data.eventTitleOther = otherDetails.title;
    if (!placeLater && otherDetails.locationName) data.eventLocationNameOther = otherDetails.locationName;
  }

  /*
    Both emailed copies with the identity document masked (§NNN; GDPR art. 5(1)(f), 25, 32): the
    signer's address was never confirmed — the declaration is signed on a page, no link is sent
    first — so one typo hands a stranger a national identification number. The backoffice keeps the
    whole document for its seven days (`participant`). The signer's message says so, and only when
    the text asked for a document at all; it always says how to have a declaration one did not
    sign deleted.
  */
  const pdf = await renderGroupRunDeclarationPdf(db, signed, declarationPdfAudience(row.messageType, false) ?? "club", now);
  if (!archive && signed.idDocument !== null) data.idDocumentMasked = true;
  // The archive copy's own copies (§244), read from the payload as the race's archive reads them.
  const payload = (archive ? (row.payloadJson ?? {}) : {}) as { cc?: unknown; bcc?: unknown };
  const addresses = (value: unknown): string[] =>
    Array.isArray(value) ? value.filter((entry): entry is string => typeof entry === "string" && entry.trim() !== "") : [];

  return buildOutgoingEmail({
    to: row.recipientEmail,
    locale,
    idempotencyKey: row.idempotencyKey,
    messageType: row.messageType,
    data,
    actionUrl: undefined,
    attachments: pdf ? [{ filename: "declaratie-semnata.pdf", contentType: "application/pdf", data: pdf }] : undefined,
    overrides: await readEmailCopyForSending(db, now),
    cc: addresses(payload.cc),
    bcc: addresses(payload.bcc),
  });
}

/**
 * "duminică, 11 oct. 2026, 09:00" / "Sunday, 11 Oct 2026, 09:00", in the event's zone (§349).
 *
 * In the language's own case: nearly every template sets it inside a sentence ("programat
 * duminică, …"); the one line it starts — the facts under the heading — capitalises it there.
 */
function formatEventStart(event: { startsAt: Date; timezone: string } | undefined, locale: Locale): string | undefined {
  if (!event) return undefined;
  return formatInSentence(event.startsAt, event.timezone, locale);
}

/** The long form with its time, inside a sentence of a message (§349). */
function formatInSentence(at: Date, timeZone: string, locale: Locale): string {
  return formatDay(at, { locale, timeZone, style: "long", withTime: true, position: "inline" });
}

/**
 * One language's row of the event as the facts block reads it (§392): the anchors of that
 * language's page by the page's own rules — `#route` only with a route description in that
 * language (§387), `#links` only when the page's own split leaves "Linkuri și fișiere" something
 * to show (`partitionEventLinks`, the rule `EventLinks` draws by).
 */
function emailEventFacts(row: EventNotificationRow, pageUrl: string | null): EmailEventFacts {
  const routeSection = hasRouteDescription(row.routeDescriptionJson);
  return {
    startsAt: row.startsAt,
    raceStartsAt: row.raceStartsAt,
    timezone: row.timezone,
    locationToBeAnnounced: row.locationToBeAnnounced,
    locationName: row.locationName,
    locationAddress: row.locationAddress,
    mapUrl: row.mapUrl,
    scheduleItems: row.scheduleItems,
    surface: row.surface,
    difficulty: row.difficulty,
    distanceMeters: row.distanceMeters,
    elevationGainMeters: row.elevationGainMeters,
    type: row.type,
    endsAt: row.endsAt,
    nightOverride: row.nightOverride,
    registrationMode: row.registrationMode,
    routeUrl: row.routeUrl,
    stravaEventUrl: row.stravaEventUrl,
    facebookEventUrl: row.facebookEventUrl,
    costType: row.costType,
    costAmount: row.costAmount,
    costUrl: row.costUrl,
    pageUrl,
    hasRules: row.hasRules === true,
    hasSchedule: row.hasSchedule === true,
    hasRouteDescription: routeSection,
    hasOtherLinks: partitionEventLinks(row.links, routeSection).other.length > 0,
  };
}

function otherLocale(locale: Locale): Locale {
  return locale === "ro" ? "en" : "ro";
}
