import { eq } from "drizzle-orm";
import { events } from "@/db/schema/events";
import { CLUB_TIME_ZONE, formatDay } from "@/i18n/dates";
import { getPathname } from "@/i18n/navigation";
import type { Locale } from "@/i18n/routing";
import type { OutgoingEmail } from "@/infrastructure/email/adapter";
import { issueActionToken } from "@/modules/action-tokens/repository";
import { type EventNotificationRow, eventNotificationDetailsIn } from "@/modules/events/repository";
import { invitationState } from "@/modules/registrations/domain/invitations";
import { findInvitationById } from "@/modules/registrations/invitation-repository";
import { env } from "@/shared/config/env";
import { readEmailCopyForSending } from "./email-copy";
import { type EmailRenderer, OutboxMessageWithdrawn, type OutboxRow } from "./outbox";
import { buildOutgoingEmail, type TemplateData } from "./templates";

type RendererDb = Parameters<EmailRenderer>[1];

/**
 * How long an invitation's link answers after the invitation's deadline (§647): long enough for its
 * page to say «expired» or «withdrawn» by name rather than the generic refusal, and no longer than the
 * invitation itself is kept after it ends (`jobs/retention.ts`, `endedInvitationDays`). Whether it may
 * still be *accepted* is the invitation's own state, asked under the event lock at the press.
 */
export const INVITATION_LINK_GRACE_DAYS = 30;

/**
 * `EVENT_INVITATION` (§647): one invitation's email, rendered at the send like every message with an
 * action link (§12.8, §14.5). Its own path, as the newsletter's is: there is no registration behind it.
 *
 * - The invitation is read now (`payload.invitationId`): one accepted, withdrawn or past its deadline
 *   since the press is withdrawn (`OutboxMessageWithdrawn`) — nothing is sent for a place no longer
 *   kept (§331's rule at the moment of sending).
 * - The link: a fresh `ACCEPT_INVITATION` token scoped to the invitation and its address's participant,
 *   hashed at rest, the secret only in this message; minting it supersedes the earlier email's link
 *   (§619, «Retrimite»). It opens `/registrations/invitation/[token]`, whose GET only reads.
 * - The words: the event, its start, the club, and until when the place is kept, in the event's own
 *   zone with the month spelled out (§580) — both halves, each in its language (§96).
 */
export async function renderInvitationRow(
  row: OutboxRow,
  db: RendererDb,
  now: Date,
  eventRows: (db: RendererDb, eventId: string) => Promise<readonly EventNotificationRow[]>,
  replyTo: string | undefined,
): Promise<OutgoingEmail> {
  const locale = row.locale as Locale;
  const other: Locale = locale === "ro" ? "en" : "ro";
  const payload = (row.payloadJson ?? {}) as { invitationId?: unknown };
  const invitation = typeof payload.invitationId === "string" ? await findInvitationById(db, payload.invitationId) : undefined;
  if (!invitation) throw new OutboxMessageWithdrawn("invitation: it is gone");
  if (invitationState(invitation, now) !== "sent") throw new OutboxMessageWithdrawn("invitation: no longer open");
  // A race called off or started since the press (§331 at the moment of sending): nothing to invite to.
  const [event] = await db.select({ eventStatus: events.eventStatus, startsAt: events.startsAt }).from(events).where(eq(events.id, invitation.eventId)).limit(1);
  if (!event || event.eventStatus !== "SCHEDULED" || event.startsAt.getTime() <= now.getTime()) throw new OutboxMessageWithdrawn("invitation: the event is over or cancelled");

  const texts = await eventRows(db, invitation.eventId);
  const details = eventNotificationDetailsIn(texts, locale);
  const otherDetails = texts.find((candidate) => candidate.locale === other && candidate.locale !== details?.locale);
  const zone = details?.timezone ?? CLUB_TIME_ZONE;
  const inSentence = (at: Date, inLocale: Locale) => formatDay(at, { locale: inLocale, timeZone: zone, style: "long", withTime: true, position: "inline" });
  const deadline = (inLocale: Locale) => formatDay(invitation.expiresAt, { locale: inLocale, timeZone: zone, style: "long", month: "long", withTime: true, position: "inline" });

  const data: TemplateData = {
    participantName: invitation.name,
    eventTitle: details?.title,
    eventStartsAtFormatted: details ? inSentence(details.startsAt, locale) : undefined,
    eventStartsAtFormattedOther: details ? inSentence(details.startsAt, other) : undefined,
    holdExpiresAtFormatted: deadline(locale),
    holdExpiresAtFormattedOther: deadline(other),
    replyTo,
    eventUrl: details?.slug ? `${env.APP_BASE_URL}${getPathname({ locale, href: { pathname: "/events/[slug]", params: { slug: details.slug } } })}` : undefined,
    contactUrl: `${env.APP_BASE_URL}${getPathname({ locale, href: "/contact" })}`,
  };
  if (otherDetails) data.eventTitleOther = otherDetails.title;

  const issued = await issueActionToken(db, {
    participantId: invitation.participantId,
    registrationId: null,
    invitationId: invitation.id,
    purpose: "ACCEPT_INVITATION",
    expiresAt: new Date(invitation.expiresAt.getTime() + INVITATION_LINK_GRACE_DAYS * 24 * 60 * 60_000),
    now,
  });
  const actionUrl = `${env.APP_BASE_URL}${getPathname({ locale, href: { pathname: "/registrations/invitation/[token]", params: { token: issued.secret } } })}`;

  return buildOutgoingEmail({
    to: row.recipientEmail,
    locale,
    idempotencyKey: row.idempotencyKey,
    messageType: row.messageType,
    data,
    actionUrl,
    overrides: await readEmailCopyForSending(db, now),
  });
}
