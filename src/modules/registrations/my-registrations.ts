import { and, asc, desc, eq, gt, inArray, notInArray, or, sql } from "drizzle-orm";
import { declarationAcceptances } from "@/db/schema/declaration-acceptances";
import { pendingFamilyEntries } from "@/db/schema/family-entries";
import { personOfEntry } from "./family-entries";
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
import type { CancelReason } from "./domain/cancel-reason";
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
  /**
   * When an unsigned place lapses — the declaration hold or the waiting-list offer (§104) — so the
   * page can say by when to confirm, "până la start" when it is the start itself (§407).
   */
  holdExpiresAt: Date | null;
  /** The race number, given at the confirmation (§87, §548); shown through `raceNumberOf`. */
  bibNumber: number | null;
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
  /** «Vreau să primesc oferte și beneficii» (§562): the person's own answer, and the switch's side. */
  promoConsent: boolean;
  /**
   * When this person's declaration was signed — on a link, in the family wizard or on paper at the
   * desk (§67) — or null while it is not (§519: «Toate înscrierile mele» says each person's
   * declaration, the owner's «pagina arată starea declarației fiecăruia»).
   */
  declarationSignedAt: Date | null;
};

/**
 * A family's person still waiting for the address's say-so (§446, §519): a kept form, not a
 * registration — the page names them, the event, and until when the email's button can register them.
 */
export type MyPendingPerson = { id: string; name: string; eventTitle: string | null; eventId: string; expiresAt: Date };

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
      holdExpiresAt: registrations.holdExpiresAt,
      bibNumber: registrations.bibNumber,
      listOptOut: registrations.listOptOut,
      // Whether each is set, computed in SQL so the values never leave the database (§322).
      holdsHealthNote: sql<boolean>`(${registrations.healthNotes} IS NOT NULL OR ${registrations.healthConsentAt} IS NOT NULL)`.mapWith(Boolean),
      holdsSocials: sql<boolean>`(${registrations.stravaUrl} IS NOT NULL OR ${registrations.instagramHandle} IS NOT NULL)`.mapWith(Boolean),
      promoConsent: registrations.promoConsent,
      // The latest acceptance's instant, qualified by hand: a bare "id" in the subquery would be the acceptance's own.
      declarationSignedAt: sql<Date | null>`(select max(${declarationAcceptances}."accepted_at") from ${declarationAcceptances} where ${declarationAcceptances}."registration_id" = ${registrations}."id")`.mapWith(
        (value: unknown) => (value === null || value === undefined ? null : value instanceof Date ? value : new Date(String(value))),
      ),
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
    // A family's people in the order their forms were sent (§543), as the family's email lists them.
    .orderBy(asc(events.startsAt), asc(registrations.createdAt), asc(registrations.id));

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
  "id" | "status" | "registeredName" | "eventId" | "eventTitle" | "eventStartsAt" | "eventTimezone" | "holdsHealthNote" | "holdsSocials" | "promoConsent"
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
      // Whose data each button withdraws (§389, §420): a family's two closed registrations at one
      // event would otherwise be two identical cards.
      registeredName: registrations.registeredName,
      eventId: registrations.eventId,
      eventTitle: eventTranslations.title,
      eventStartsAt: events.startsAt,
      eventTimezone: events.timezone,
      holdsHealthNote: holdsHealthNote.mapWith(Boolean),
      holdsSocials: holdsSocials.mapWith(Boolean),
      // A consent to offers and benefits outlives the place (§562): withdrawn from here too.
      promoConsent: registrations.promoConsent,
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
        or(holdsHealthNote, holdsSocials, eq(registrations.promoConsent, true)),
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
  const pending = await listPendingPeopleForParticipant(db, context.token.participantId, locale, now);
  return { ok: true as const, participantId: context.token.participantId, items, closed, pending };
}

/**
 * The address's kept forms still alive (§446, §519): people sent on the form and not yet confirmed
 * from the email — named on the address's own page, behind its own link, which is the one place a
 * name on it may be read. The name as the registration would carry it; nothing else of the form.
 */
export async function listPendingPeopleForParticipant<T extends Record<string, unknown>>(
  db: Database<T>,
  participantId: string,
  locale: Locale,
  now: Date,
): Promise<MyPendingPerson[]> {
  const rows = await db
    .select({
      id: pendingFamilyEntries.id,
      fields: pendingFamilyEntries.fields,
      eventId: pendingFamilyEntries.eventId,
      eventTitle: eventTranslations.title,
      expiresAt: pendingFamilyEntries.expiresAt,
    })
    .from(pendingFamilyEntries)
    .leftJoin(eventTranslations, and(eq(eventTranslations.eventId, pendingFamilyEntries.eventId), eq(eventTranslations.locale, locale)))
    .where(and(eq(pendingFamilyEntries.participantId, participantId), gt(pendingFamilyEntries.expiresAt, now)))
    .orderBy(asc(pendingFamilyEntries.createdAt), asc(pendingFamilyEntries.id));
  return rows.map((row) => ({
    id: row.id,
    name: personOfEntry(row).legalName,
    eventId: row.eventId,
    eventTitle: row.eventTitle,
    expiresAt: row.expiresAt,
  }));
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
    registrationOpensSoon: event.registrationOpensSoon,
    dateToBeAnnounced: event.dateToBeAnnounced,
    timeToBeAnnounced: event.timeToBeAnnounced,
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
  reason: CancelReason,
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
    // The audit row and the per-person cancellation email (§547) ride on `unregister`, whichever door.
    const updated = await unregister(tx, event, registration.id, "PARTICIPANT", now, { via: "MY_REGISTRATIONS", reason });
    return { ok: true as const, registration: updated };
  });
}
