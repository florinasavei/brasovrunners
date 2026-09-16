import { eq } from "drizzle-orm";
import type { EmailActionTokenPurpose } from "@/db/schema/email-action-tokens";
import type { EmailMessageType } from "@/db/schema/email-outbox";
import { participants } from "@/db/schema/participants";
import { registrations } from "@/db/schema/registrations";
import { getPathname } from "@/i18n/navigation";
import type { Locale } from "@/i18n/routing";
import { issueActionToken } from "@/modules/action-tokens/repository";
import { findEventNotificationDetails } from "@/modules/events/repository";
import { env } from "@/shared/config/env";
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
};

const ROUTE_BY_PURPOSE: Record<
  EmailActionTokenPurpose,
  "/registrations/confirm/[token]" | "/registrations/declare/[token]" | "/registrations/manage/[token]" | null
> = {
  VERIFY_REGISTRATION_EMAIL: "/registrations/confirm/[token]",
  COMPLETE_DECLARATION: "/registrations/declare/[token]",
  WAITLIST_OFFER: "/registrations/declare/[token]",
  MANAGE_REGISTRATION: "/registrations/manage/[token]",
  MANAGE_PROFILE: null, // no public-profile route yet (M4)
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
    eventStartsAtFormatted: eventDetails
      ? new Intl.DateTimeFormat(locale === "ro" ? "ro-RO" : "en-GB", {
          dateStyle: "long",
          timeStyle: "short",
          timeZone: eventDetails.timezone,
        }).format(eventDetails.startsAt)
      : undefined,
    currentStatus: registration?.status,
  };

  const purpose = TOKEN_PURPOSE_BY_MESSAGE_TYPE[row.messageType];
  const route = purpose ? ROUTE_BY_PURPOSE[purpose] : null;

  let actionUrl: string | undefined;
  if (purpose && route && row.participantId) {
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
  }

  return buildOutgoingEmail({
    to: row.recipientEmail,
    locale,
    idempotencyKey: row.idempotencyKey,
    messageType: row.messageType,
    data,
    actionUrl,
  });
};
