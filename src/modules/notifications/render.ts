import { eq } from "drizzle-orm";
import type { EmailActionTokenPurpose } from "@/db/schema/email-action-tokens";
import type { EmailMessageType } from "@/db/schema/email-outbox";
import { participants } from "@/db/schema/participants";
import { registrations } from "@/db/schema/registrations";
import { getPathname } from "@/i18n/navigation";
import type { Locale } from "@/i18n/routing";
import { issueActionToken } from "@/modules/action-tokens/repository";
import { findEventNotificationDetails } from "@/modules/events/repository";
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

  const eventDetails = registration
    ? await findEventNotificationDetails(db, registration.eventId, locale)
    : undefined;

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
  };
  if (data.eventUrl && eventDetails?.hasRules) data.eventRulesUrl = `${data.eventUrl}#rules`;
  if (data.eventUrl && eventDetails?.hasSchedule) data.eventScheduleUrl = `${data.eventUrl}#schedule`;
  // The thank-you's optional link (§82) rides in the payload; it is the action, and not a token.
  let payloadActionUrl: string | undefined;
  if (row.messageType === "EVENT_THANKS") {
    const url = (row.payloadJson as { url?: unknown } | null)?.url;
    if (typeof url === "string" && url.startsWith("https://")) {
      data.thanksUrl = url;
      payloadActionUrl = url;
    }
  }
  // The desk code on the confirmation and the reminder (BR-REQ-037-08). A confirmed
  // registration made before codes existed gets one here, so a resent confirmation carries it too.
  if (
    (row.messageType === "REGISTRATION_CONFIRMED" || row.messageType === "EVENT_REMINDER") &&
    registration?.status === "CONFIRMED"
  ) {
    let code = registration.checkinCode;
    if (!code) {
      code = newCheckinCode();
      await db.update(registrations).set({ checkinCode: code }).where(eq(registrations.id, registration.id));
    }
    data.checkinCode = code;
    data.checkinQrUrl = `${env.APP_BASE_URL}/api/registrations/qr/${code}.png`;
    data.bibNumber = registration.bibNumber ?? undefined;
  }

  const purpose = TOKEN_PURPOSE_BY_MESSAGE_TYPE[row.messageType];

  let actionUrl: string | undefined = payloadActionUrl;
  if (purpose && row.participantId) {
    const route = ROUTE_BY_PURPOSE[purpose];
    const defaultExpiresAt = new Date(now.getTime() + DEFAULT_TOKEN_HOURS * 60 * 60_000);
    // Borrow the registration's own hold deadline so the token dies exactly when the hold
    // does — but only while that deadline is still ahead of `now`. A hold can lapse between
    // this message being queued and a delayed batch actually rendering it; issuing a token
    // that expires in the past would fail outright, and the registration's own status guard
    // is what correctly refuses a stale click regardless of how long the token stays valid.
    const holdExpiresAt = registration?.holdExpiresAt;
    const expiresAt = holdExpiresAt && holdExpiresAt.getTime() > now.getTime() ? holdExpiresAt : defaultExpiresAt;
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
  // (§95): a copy the participant keeps, in the language they signed in.
  let attachments: OutgoingEmail["attachments"];
  if (row.messageType === "DECLARATION_SIGNED" && registration) {
    const signed = await findSignedDeclaration(db, registration.id);
    if (signed) {
      const pdf = await renderSignedDeclarationPdf(db, signed, registration.eventId, declarationWords(signed.locale, now), now);
      if (pdf) attachments = [{ filename: "declaratie-semnata.pdf", contentType: "application/pdf", data: pdf }];
      data.signedAtFormatted = new Intl.DateTimeFormat(signed.locale === "ro" ? "ro-RO" : "en-GB", {
        dateStyle: "long",
        timeStyle: "short",
        timeZone: eventDetails?.timezone ?? "Europe/Bucharest",
      }).format(signed.acceptedAt);
    }
  }

  return buildOutgoingEmail({
    to: row.recipientEmail,
    locale,
    idempotencyKey: row.idempotencyKey,
    messageType: row.messageType,
    data,
    actionUrl,
    attachments,
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
