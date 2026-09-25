import { and, asc, desc, eq, inArray, notInArray, or, sql } from "drizzle-orm";
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
import { emailBucketKey } from "@/modules/rate-limit/domain/key";
import { consumeRateLimit } from "@/modules/rate-limit/service";
import { DomainError } from "@/shared/errors/domain-error";
import { findRegistrationById } from "./repository";
import { checkIn, type EventForRegistration, unregister } from "./service";
import { currentDeadlines } from "@/modules/deadlines/deadlines";
import { selfCheckinOpensAt } from "@/modules/deadlines/domain/deadlines";

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

  // The same hashed bucket as the other link request (§322): one mailbox, one allowance.
  const verdict = await consumeRateLimit(db, "link-request", emailBucketKey("link-request", identity.canonicalEmail), now);
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
  /** Whose registration it is (§389): an address may carry a family, each person their own row. */
  registeredName: string;
  eventId: string;
  eventTitle: string | null;
  eventSlug: string | null;
  eventStartsAt: Date;
  eventTimezone: string;
  checkinCode: string | null;
  checkedInAt: Date | null;
  /** The race number, once given (§87). */
  bibNumber: number | null;
  /** The number held before the settle (§214); what the runner is shown until then. */
  provisionalBibNumber: number | null;
  /** "I am here" is offered from the club's check-in lead before the start ("Termene", §377), confirmed registrations only — never at a cancelled event. */
  selfCheckinOpen: boolean;
  /**
   * The event was cancelled (§331). The registration keeps its own status — it is the record of
   * who had entered — and the page says, beside it, that the race will not run.
   */
  eventCancelled: boolean;
  /** On the public participant list, or not — the participant's own answer (BR-REQ-039-01; §143). */
  listed: boolean;
  /**
   * Whether there is a health note, or a Strava link or Instagram username, to withdraw (§322).
   * Booleans and never the values: the page offers the button and does not print the note.
   */
  holdsHealthNote: boolean;
  holdsSocials: boolean;
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
      registeredName: registrations.registeredName,
      eventId: registrations.eventId,
      eventTitle: eventTranslations.title,
      eventSlug: eventTranslations.slug,
      eventStartsAt: events.startsAt,
      eventTimezone: events.timezone,
      eventStatus: events.eventStatus,
      checkinCode: registrations.checkinCode,
      checkedInAt: registrations.checkedInAt,
      bibNumber: registrations.bibNumber,
      provisionalBibNumber: registrations.provisionalBibNumber,
      listOptOut: registrations.listOptOut,
      // Whether each is set, computed in SQL so the values never leave the database (§322).
      holdsHealthNote: sql<boolean>`(${registrations.healthNotes} IS NOT NULL OR ${registrations.healthConsentAt} IS NOT NULL)`.mapWith(Boolean),
      holdsSocials: sql<boolean>`(${registrations.stravaUrl} IS NOT NULL OR ${registrations.instagramHandle} IS NOT NULL)`.mapWith(Boolean),
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

  // "I am here" opens the club's hours before the start (§377), read once for the whole list.
  const deadlines = rows.length > 0 ? await currentDeadlines(db) : null;
  return rows.map(({ listOptOut, eventStatus, ...row }) => ({
    ...row,
    listed: !listOptOut,
    eventCancelled: eventStatus === "CANCELLED",
    selfCheckinOpen:
      deadlines !== null &&
      row.status === "CONFIRMED" &&
      eventStatus !== "CANCELLED" &&
      now.getTime() >= selfCheckinOpensAt(row.eventStartsAt, deadlines).getTime(),
  }));
}

/**
 * A registration that is no longer active — checked in, cancelled, expired — but still holds
 * something given on consent (§324). The health note stays until seven days after the event and
 * the Strava and Instagram with the registration, three years; "delete them at any time from My
 * registrations" has to be true for these as well, so the page lists them below the active ones
 * with the two withdrawal buttons and nothing else. Whether, never what: the values stay in SQL.
 */
export type ClosedRegistrationWithConsentData = Pick<
  MyRegistration,
  "id" | "status" | "eventId" | "eventTitle" | "eventStartsAt" | "eventTimezone" | "holdsHealthNote" | "holdsSocials"
>;

export async function listClosedRegistrationsHoldingConsentData<T extends Record<string, unknown>>(
  db: Database<T>,
  participantId: string,
  locale: Locale,
): Promise<ClosedRegistrationWithConsentData[]> {
  const holdsHealthNote = sql<boolean>`(${registrations.healthNotes} IS NOT NULL OR ${registrations.healthConsentAt} IS NOT NULL)`;
  const holdsSocials = sql<boolean>`(${registrations.stravaUrl} IS NOT NULL OR ${registrations.instagramHandle} IS NOT NULL)`;
  return db
    .select({
      id: registrations.id,
      status: registrations.status,
      eventId: registrations.eventId,
      eventTitle: eventTranslations.title,
      eventStartsAt: events.startsAt,
      eventTimezone: events.timezone,
      holdsHealthNote: holdsHealthNote.mapWith(Boolean),
      holdsSocials: holdsSocials.mapWith(Boolean),
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
        notInArray(registrations.status, [...ACTIVE_REGISTRATION_STATUSES]),
        or(holdsHealthNote, holdsSocials),
      ),
    )
    .orderBy(desc(events.startsAt), asc(registrations.id));
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
  const closed = await listClosedRegistrationsHoldingConsentData(db, context.token.participantId, locale);
  return { ok: true as const, participantId: context.token.participantId, items, closed };
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
    confirmationOpensDaysBefore: event.confirmationOpensDaysBefore,
    confirmationDeadlineDaysBefore: event.confirmationDeadlineDaysBefore,
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
    throw new DomainError("VALIDATION_ERROR", "self check-in is not open yet: it opens the club's check-in lead before the start");
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
