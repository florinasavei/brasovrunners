import { eq } from "drizzle-orm";
import type { EmailActionTokenPurpose } from "@/db/schema/email-action-tokens";
import type { EmailMessageType } from "@/db/schema/email-outbox";
import { participants } from "@/db/schema/participants";
import { registrations } from "@/db/schema/registrations";
import { getPathname } from "@/i18n/navigation";
import type { Locale } from "@/i18n/routing";
import { issueActionToken } from "@/modules/action-tokens/repository";
import { localizedSchedule, programmeLines, readScheduleItems } from "@/modules/events/domain/schedule";
import { findEventNotificationDetails, findEventStartsAt, findPublishedEventBySlug } from "@/modules/events/repository";
import { toCalendarEvent } from "@/modules/events/calendar";
import { calendarLabels } from "@/modules/events/calendar-labels";
import { buildCalendar } from "@/modules/events/ical";
import { newCheckinCode } from "@/modules/registrations/checkin-code";
import { env } from "@/shared/config/env";
import type { OutgoingEmail } from "@/infrastructure/email/adapter";
import { declarationWords } from "@/modules/registrations/declaration-labels";
import { findSignedDeclaration, renderSignedDeclarationPdf } from "@/modules/registrations/signed-declaration";
import { buildOutgoingEmail, type TemplateData } from "./templates";
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
};

const ROUTE_BY_PURPOSE: Record<
  EmailActionTokenPurpose,
  | "/registrations/confirm/[token]"
  | "/registrations/declare/[token]"
  | "/registrations/manage/[token]"
  | "/registrations/mine/[token]"
> = {
  VERIFY_REGISTRATION_EMAIL: "/registrations/confirm/[token]",
  COMPLETE_DECLARATION: "/registrations/declare/[token]",
  WAITLIST_OFFER: "/registrations/declare/[token]",
  MANAGE_REGISTRATION: "/registrations/manage/[token]",
  // "My registrations" (BR-REQ-036-04, `DECISIONS.md` §77); the M4 profile will share the purpose.
  MANAGE_PROFILE: "/registrations/mine/[token]",
};

/** A sensible default when the triggering registration has no deadline of its own to borrow. */
const DEFAULT_TOKEN_HOURS = 14 * 24;

export const renderOutboxMessage: EmailRenderer = async (row: OutboxRow, db, now) => {
  const locale = row.locale as Locale;

  const [participant] = row.participantId
    ? await db.select().from(participants).where(eq(participants.id, row.participantId)).limit(1)
    : [];

  const [registration] = row.registrationId
    ? await db.select().from(registrations).where(eq(registrations.id, row.registrationId)).limit(1)
    : [];

  // The event comes from the registration — or, for the one message about an event and
  // nobody's registration (§146), from the payload's id, so a renamed event renders right.
  const payloadEventId = row.messageType === "REGISTRATION_OPENED" ? (row.payloadJson as { eventId?: unknown } | null)?.eventId : undefined;
  const eventId = registration?.eventId ?? (typeof payloadEventId === "string" ? payloadEventId : undefined);
  const eventDetails = eventId ? await findEventNotificationDetails(db, eventId, locale) : undefined;

  const data: TemplateData = {
    participantName: participant?.defaultName ?? "",
    eventTitle: eventDetails?.title,
    // Nullable on the event row now that the meeting point is one value for the whole event
    // (`DECISIONS.md` §36); the template already renders nothing for an absent field.
    eventLocationName: eventDetails?.locationName ?? undefined,
    eventStartsAtFormatted: formatEventStart(eventDetails, locale),
    // The other language's half of the bilingual message reads its own date (§96).
    eventStartsAtFormattedOther: formatEventStart(eventDetails, locale === "ro" ? "en" : "ro"),
    eventMapUrl: eventDetails?.mapUrl ?? undefined,
    eventStravaEventUrl: eventDetails?.stravaEventUrl ?? undefined,
    eventChecklist: eventDetails?.checklist ?? undefined,
    currentStatus: registration?.status,
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
  if (data.eventUrl && eventDetails?.hasRules) data.eventRulesUrl = `${data.eventUrl}#rules`;
  // The hold's deadline on the declaration email (§104), and whether it is the window's — a
  // deadline more than a day away is the week-before confirmation, not the thirty minutes. A
  // deadline already behind us (a resend after it) is not named: the place is being kept (§160).
  if (row.messageType === "COMPLETE_DECLARATION" && registration?.holdExpiresAt && registration.holdExpiresAt.getTime() > now.getTime()) {
    data.holdExpiresAtFormatted = new Intl.DateTimeFormat(locale === "ro" ? "ro-RO" : "en-GB", {
      dateStyle: "long",
      timeStyle: "short",
      timeZone: eventDetails?.timezone ?? "Europe/Bucharest",
    }).format(registration.holdExpiresAt);
    data.confirmLater = registration.holdExpiresAt.getTime() - now.getTime() > 24 * 60 * 60_000;
  }
  if (data.eventUrl && eventDetails?.hasSchedule) data.eventScheduleUrl = `${data.eventUrl}#schedule`;
  // The programme's rows in the reminder (§117), each half of the bilingual mail in its own words.
  if (row.messageType === "EVENT_REMINDER" && eventDetails) {
    const items = readScheduleItems(eventDetails.scheduleItems);
    if (items.length > 0) {
      const other = locale === "ro" ? "en" : "ro";
      data.eventProgramme = programmeLines(localizedSchedule(items, locale), eventDetails.timezone, locale);
      data.eventProgrammeOther = programmeLines(localizedSchedule(items, other), eventDetails.timezone, other);
    }
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
    let code = registration.checkinCode;
    if (!code) {
      code = newCheckinCode();
      await db.update(registrations).set({ checkinCode: code }).where(eq(registrations.id, registration.id));
    }
    data.checkinCode = code;
    data.checkinQrUrl = `${env.APP_BASE_URL}/api/registrations/qr/${code}.png`;
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

  const purpose = TOKEN_PURPOSE_BY_MESSAGE_TYPE[row.messageType];

  let actionUrl: string | undefined = payloadActionUrl;
  if (purpose && row.participantId) {
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
    const placeUntil = purpose === "COMPLETE_DECLARATION" ? (eventStartsAt ?? holdExpiresAt) : holdExpiresAt;
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
   */
  if (
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

  if (
    (row.messageType === "REGISTRATION_CONFIRMED" || row.messageType === "DECLARATION_SIGNED" || row.messageType === "DECLARATION_ARCHIVE") &&
    registration
  ) {
    const signed = await findSignedDeclaration(db, registration.id);
    if (signed) {
      const pdf = await renderSignedDeclarationPdf(db, signed, registration.eventId, declarationWords(signed.locale, now), now);
      // Beside the calendar file, never instead of it: the confirmation carries both (§174).
      if (pdf) attachments = [...(attachments ?? []), { filename: "declaratie-semnata.pdf", contentType: "application/pdf", data: pdf }];
      data.signedAtFormatted = new Intl.DateTimeFormat(signed.locale === "ro" ? "ro-RO" : "en-GB", {
        dateStyle: "long",
        timeStyle: "short",
        timeZone: eventDetails?.timezone ?? "Europe/Bucharest",
      }).format(signed.acceptedAt);
    }
  }

  /*
    The club's copies of the declaration (§244), as the confirmation asked for them.

    Read from the payload rather than from the setting: the row is what was decided when the
    declaration was signed, and a list edited since must not silently redirect a copy that was
    already queued. Addresses only — `AGENTS.md` §14.5 keeps bodies and tokens out of the row,
    and an address is neither.
  */
  const payload = (row.payloadJson ?? {}) as { cc?: unknown; bcc?: unknown };
  const addresses = (value: unknown): string[] =>
    Array.isArray(value) ? value.filter((entry): entry is string => typeof entry === "string" && entry.trim() !== "") : [];

  return buildOutgoingEmail({
    to: row.recipientEmail,
    locale,
    idempotencyKey: row.idempotencyKey,
    messageType: row.messageType,
    data,
    actionUrl,
    attachments,
    cc: addresses(payload.cc),
    bcc: addresses(payload.bcc),
  });
};

/** "duminică, 11 octombrie 2026, 09:00" / "Sunday 11 October 2026, 09:00", in the event's zone. */
function formatEventStart(event: { startsAt: Date; timezone: string } | undefined, locale: Locale): string | undefined {
  if (!event) return undefined;
  return new Intl.DateTimeFormat(locale === "ro" ? "ro-RO" : "en-GB", {
    dateStyle: "full",
    timeStyle: "short",
    timeZone: event.timezone,
  }).format(event.startsAt);
}
