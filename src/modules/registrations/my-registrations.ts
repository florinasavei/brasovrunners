import { and, asc, eq, inArray } from "drizzle-orm";
import { eventTranslations, events } from "@/db/schema/events";
import { ACTIVE_REGISTRATION_STATUSES, registrations, type RegistrationStatus } from "@/db/schema/registrations";
import type { Database } from "@/db/types";
import type { Locale } from "@/i18n/routing";
import { TOKEN_NOT_FOUND } from "@/modules/action-tokens/domain/token-state";
import { consumeActionToken, readActionTokenContext } from "@/modules/action-tokens/repository";
import { tokenAttemptAllowed } from "@/modules/action-tokens/throttle";
import { canonicalizeEmail } from "@/modules/participants/domain/canonical-email";
import { findParticipantByCanonicalEmail } from "@/modules/participants/repository";
import { enqueueEmail } from "@/modules/notifications/outbox";
import { consumeRateLimit } from "@/modules/rate-limit/service";
import { DomainError } from "@/shared/errors/domain-error";
import { findRegistrationById } from "./repository";
import { checkIn, type EventForRegistration, unregister } from "./service";
import { SELF_CHECKIN_OPENS_HOURS } from "./token-actions";

/**
 * "My registrations" — one link, every active registration for an address (BR-REQ-036-04;
 * `DECISIONS.md` §77). Participants have no accounts (AGENTS.md §10.3), so the page is
 * reached the way every participant page is: a single-use-minted, hashed action token,
 * purpose `MANAGE_PROFILE` — the one purpose scoped to a participant rather than to one
 * registration, reserved since §12.8 and unused until now. The link lists registrations and
 * never changes an address: §10.3's immutability holds here as everywhere.
 *
 * The request side follows `requestRegistrationLink` exactly (§19.4's second surface): a form
 * anybody can type any address into answers identically whatever the address turns out to
 * mean, is counted before anything is looked up, and queues a message only when a participant
 * exists. The message carries no registration: the renderer mints the token against the
 * participant alone, and the page reads what is active at the moment it is opened.
 */
export async function requestMyRegistrationsLink<T extends Record<string, unknown>>(
  db: Database<T>,
  input: { email: string; locale: Locale },
  now: Date,
): Promise<void> {
  let identity;
  try {
    identity = canonicalizeEmail(input.email);
  } catch {
    return;
  }

  const verdict = await consumeRateLimit(db, "link-request", identity.canonicalEmail, now);
  if (!verdict.allowed) return;

  const participant = await findParticipantByCanonicalEmail(db, identity.canonicalEmail);
  if (!participant) return;

  await db.transaction(async (tx) => {
    await enqueueEmail(tx, {
      participantId: participant.id,
      registrationId: null,
      messageType: "PROFILE_MANAGE_LINK",
      // The language they asked in: there is no one registration to borrow a language from.
      locale: input.locale,
      recipientEmail: participant.deliveryEmail,
      payload: {},
      idempotencyKey: `participant:${participant.id}:registrations-link:${now.toISOString()}`,
      now,
    });
  });
}

export type MyRegistration = {
  id: string;
  status: RegistrationStatus;
  eventId: string;
  eventTitle: string | null;
  eventSlug: string | null;
  eventStartsAt: Date;
  eventTimezone: string;
  checkinCode: string | null;
  checkedInAt: Date | null;
  /** "I am here" is offered from the day before the start, confirmed registrations only. */
  selfCheckinOpen: boolean;
};

/** Every active registration of one participant, soonest event first, with the event as the page names it. */
export async function listActiveRegistrationsForParticipant<T extends Record<string, unknown>>(
  db: Database<T>,
  participantId: string,
  locale: Locale,
  now: Date,
): Promise<MyRegistration[]> {
  const rows = await db
    .select({
      id: registrations.id,
      status: registrations.status,
      eventId: registrations.eventId,
      eventTitle: eventTranslations.title,
      eventSlug: eventTranslations.slug,
      eventStartsAt: events.startsAt,
      eventTimezone: events.timezone,
      checkinCode: registrations.checkinCode,
      checkedInAt: registrations.checkedInAt,
    })
    .from(registrations)
    .innerJoin(events, eq(events.id, registrations.eventId))
    .leftJoin(
      eventTranslations,
      and(eq(eventTranslations.eventId, registrations.eventId), eq(eventTranslations.locale, locale)),
    )
    .where(
      and(
        eq(registrations.participantId, participantId),
        inArray(registrations.status, [...ACTIVE_REGISTRATION_STATUSES]),
      ),
    )
    .orderBy(asc(events.startsAt), asc(registrations.id));

  return rows.map((row) => ({
    ...row,
    selfCheckinOpen:
      row.status === "CONFIRMED" &&
      now.getTime() >= row.eventStartsAt.getTime() - SELF_CHECKIN_OPENS_HOURS * 60 * 60_000,
  }));
}

/** The page's one read: throttled per presented token, `MANAGE_PROFILE` only. */
export async function readMyRegistrations<T extends Record<string, unknown>>(
  db: Database<T>,
  secret: string,
  locale: Locale,
  now: Date,
) {
  if (!(await tokenAttemptAllowed(db, secret, now))) return TOKEN_NOT_FOUND;
  const context = await readActionTokenContext(db, { secret, purpose: "MANAGE_PROFILE", now });
  if (!context.ok) return context;

  const items = await listActiveRegistrationsForParticipant(db, context.token.participantId, locale, now);
  return { ok: true as const, participantId: context.token.participantId, items };
}

async function loadEvent<T extends Record<string, unknown>>(db: Database<T>, eventId: string): Promise<EventForRegistration> {
  const [event] = await db.select().from(events).where(eq(events.id, eventId)).limit(1);
  if (!event) throw new DomainError("NOT_FOUND", "no such event");
  return {
    id: event.id,
    eventStatus: event.eventStatus,
    registrationMode: event.registrationMode,
    startsAt: event.startsAt,
    registrationOpensAt: event.registrationOpensAt,
    registrationClosesAt: event.registrationClosesAt,
    capacity: event.capacity,
    raceId: event.raceId,
    publishedAt: null,
  };
}

/**
 * "I am here" for one of the listed registrations. The token is read, not consumed — arriving
 * is not the end of the link's usefulness — and the registration must be the token holder's
 * own: a registration id is not a secret, and the token is what says who is asking.
 */
export async function checkInSelfFromMyRegistrations<T extends Record<string, unknown>>(
  db: Database<T>,
  secret: string,
  registrationId: string,
  locale: Locale,
  now: Date,
) {
  const context = await readMyRegistrations(db, secret, locale, now);
  if (!context.ok) return context;
  const item = context.items.find((row) => row.id === registrationId);
  if (!item) throw new DomainError("NOT_FOUND", "not one of this participant's registrations");
  if (!item.selfCheckinOpen) {
    throw new DomainError("VALIDATION_ERROR", "self check-in opens the day before the event");
  }
  const registration = await checkIn(db, item.id, null, now);
  return { ok: true as const, registration };
}

/**
 * Cancel one of the listed registrations. Consumes the token (§12.8: an action link is used
 * once) — a second cancellation needs a fresh link, which the page says. The registration
 * must belong to the token's participant, checked inside the same transaction.
 */
export async function consumeAndCancelFromMyRegistrations<T extends Record<string, unknown>>(
  db: Database<T>,
  secret: string,
  registrationId: string,
  now: Date,
) {
  if (!(await tokenAttemptAllowed(db, secret, now))) return TOKEN_NOT_FOUND;

  return db.transaction(async (tx) => {
    const consumed = await consumeActionToken(tx, { secret, purpose: "MANAGE_PROFILE", now });
    if (!consumed.ok) return consumed;

    const registration = await findRegistrationById(tx, registrationId);
    if (!registration || registration.participantId !== consumed.token.participantId) {
      throw new DomainError("NOT_FOUND", "not one of this participant's registrations");
    }
    const event = await loadEvent(tx, registration.eventId);
    const updated = await unregister(tx, event, registration.id, "PARTICIPANT", now);
    return { ok: true as const, registration: updated };
  });
}
