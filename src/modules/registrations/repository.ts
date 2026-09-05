import { and, asc, eq, inArray, lte, or, sql } from "drizzle-orm";
import { declarationAcceptances } from "@/db/schema/declaration-acceptances";
import { events } from "@/db/schema/events";
import {
  type Registration,
  type RegistrationKind,
  type RegistrationSource,
  type RegistrationStatus,
  registrations,
} from "@/db/schema/registrations";
import type { Database } from "@/db/types";
import type { Locale } from "@/i18n/routing";
import { env } from "@/shared/config/env";
import { DomainError } from "@/shared/errors/domain-error";
import { allowedFromStatuses } from "./domain/state-machine";

/**
 * A `TEST` registration cannot be written in production, and this is the second place that is
 * refused rather than the only one.
 *
 * The environment is the whole rule: a synthetic queue is a thing to look at on a system nobody
 * has entered a real race on. In production the same row would occupy a place a person wanted,
 * and would be indistinguishable from theirs on the start line.
 */
function assertKindIsAllowedHere(kind: RegistrationKind): void {
  if (kind === "TEST" && env.APP_ENV === "production") {
    throw new DomainError(
      "FORBIDDEN",
      "a test registration cannot be created in production; it would occupy a real place",
    );
  }
}

/**
 * Reading and writing `registrations` (AGENTS.md §12.6, §15).
 *
 * Priority-1 code, the same standing as `modules/action-tokens/repository.ts`: every write here
 * is one statement whose WHERE clause is the concurrency guard, never a read followed by a
 * write. `transitionRegistration` is the single function every state change in `service.ts`
 * goes through, the way `updateWithVersionGuard` is for event translations — except the guard
 * here is the status column itself (only one allowed *from* status ever matches), not a
 * separate version counter.
 *
 * Every function is generic over the caller's schema, exactly like
 * `modules/content/events/repository.ts` and `modules/action-tokens/repository.ts`: a fixed
 * local schema type here would not structurally match the equally fixed, differently-scoped
 * schema types other modules' functions declare (`enqueueEmail`, `findCurrentApprovedDocument`),
 * so passing one open transaction through a call chain that touches several modules needs one
 * shared type parameter, resolved once at the outermost call site, rather than several
 * independently-inferred narrow ones. `db` may be an open transaction — and in every call from
 * `service.ts`, it is.
 */

export async function findRegistrationById<T extends Record<string, unknown>>(
  db: Database<T>,
  id: string,
): Promise<Registration | undefined> {
  const [row] = await db.select().from(registrations).where(eq(registrations.id, id)).limit(1);
  return row;
}

export async function findRegistrationByEventAndParticipant<T extends Record<string, unknown>>(
  db: Database<T>,
  eventId: string,
  participantId: string,
): Promise<Registration | undefined> {
  const [row] = await db
    .select()
    .from(registrations)
    .where(and(eq(registrations.eventId, eventId), eq(registrations.participantId, participantId)))
    .limit(1);
  return row;
}

/** The event row locked for the length of the caller's transaction — the serialization point
 * AGENTS.md §10.6 requires around every capacity-changing decision. */
export async function lockEventForCapacity<T extends Record<string, unknown>>(
  db: Database<T>,
  eventId: string,
) {
  const [row] = await db.select().from(events).where(eq(events.id, eventId)).for("update");
  return row;
}

/**
 * One event's row, unlocked — what the backoffice needs to build an `EventForRegistration`
 * before handing it to the allocator.
 *
 * Deliberately not `lockEventForCapacity`: that takes `FOR UPDATE` for the length of the
 * caller's transaction, and a page or an action that is only *about* to call the allocator has
 * no transaction to hold it in and nothing to serialize yet. The lock is taken inside the
 * allocator, where the decision is made.
 */
export async function findEventForAllocation<T extends Record<string, unknown>>(
  db: Database<T>,
  eventId: string,
) {
  const [row] = await db.select().from(events).where(eq(events.id, eventId)).limit(1);
  return row;
}

/** Every registration against one event, whatever its status or kind — what deletion asks. */
export async function countRegistrationsForEvent<T extends Record<string, unknown>>(
  db: Database<T>,
  eventId: string,
): Promise<number> {
  const [row] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(registrations)
    .where(eq(registrations.eventId, eventId));
  return row?.count ?? 0;
}

export type InsertPendingRegistrationInput = {
  id?: string;
  eventId: string;
  participantId: string;
  kind?: RegistrationKind;
  source?: RegistrationSource;
  createdByStaffUserId?: string | null;
  locale: "ro" | "en";
  registeredName: string;
  privacyNoticeVersion: number;
  privacyAcknowledgedAt: Date;
  raceId: string | null;
  resultsNameConsent: boolean;
  resultsConsentVersion: number;
  listOptOut: boolean;
  now: Date;
};

export async function insertPendingEmailRegistration<T extends Record<string, unknown>>(
  db: Database<T>,
  input: InsertPendingRegistrationInput,
): Promise<Registration> {
  // The second of the two guards on `TEST` (`db/schema/registrations.ts`). The first is in
  // `test-registrations.ts`, at the feature's own entrance; this one is at the only statement
  // that can put such a row in the table at all, so a future caller that reaches the insert by
  // some other path is refused too. One guard eventually gets refactored away.
  assertKindIsAllowedHere(input.kind ?? "REAL");

  const [row] = await db
    .insert(registrations)
    .values({
      id: input.id,
      eventId: input.eventId,
      participantId: input.participantId,
      status: "PENDING_EMAIL_CONFIRMATION",
      kind: input.kind ?? "REAL",
      source: input.source ?? "PUBLIC",
      createdByStaffUserId: input.createdByStaffUserId ?? null,
      locale: input.locale,
      registeredName: input.registeredName,
      privacyNoticeVersion: input.privacyNoticeVersion,
      privacyAcknowledgedAt: input.privacyAcknowledgedAt,
      raceId: input.raceId,
      resultsNameConsent: input.resultsNameConsent,
      resultsConsentVersion: input.resultsConsentVersion,
      listOptOut: input.listOptOut,
      submittedAt: input.now,
      createdAt: input.now,
      updatedAt: input.now,
    })
    .returning();
  return row;
}

/**
 * The single guarded transition every state change goes through.
 *
 * `WHERE id = ? AND status = ANY(fromStatuses)` is the whole guard: at most one of the allowed
 * origins can ever match the committed row, so two concurrent attempts to move the same
 * registration — a confirmation racing an expiry, a decline racing an accept — settle the same
 * way `updateWithVersionGuard` settles two organizers' saves. `RETURNING` empty means either the
 * row does not exist or it was not in an allowed state; the caller distinguishes those the same
 * way `content/events/service.ts` does.
 */
export async function transitionRegistration<T extends Record<string, unknown>>(
  db: Database<T>,
  params: {
    id: string;
    to: RegistrationStatus;
    fromStatuses?: RegistrationStatus[];
    changes?: Partial<typeof registrations.$inferInsert>;
    now: Date;
  },
): Promise<Registration | undefined> {
  const fromStatuses = params.fromStatuses ?? allowedFromStatuses(params.to);
  const [row] = await db
    .update(registrations)
    .set({ ...params.changes, status: params.to, updatedAt: params.now })
    .where(and(eq(registrations.id, params.id), inArray(registrations.status, fromStatuses)))
    .returning();
  return row;
}

/**
 * The public start list of one event (BR-REQ-039-01).
 *
 * Four filters, and each one is a rule rather than a preference:
 *
 *   - `CONFIRMED` only. Anything earlier is somebody who has not finished registering, and
 *     publishing that they tried is a disclosure they never completed. It is also why no count
 *     of anything unconfirmed is returned here — there is nothing to count it from.
 *   - `REAL` only. A synthetic row demonstrating the queue is not a person and must never
 *     appear on a page a person reads (AGENTS.md §12.6).
 *   - not opted out. The participant's own refusal, and it is checked in the query rather than
 *     filtered afterwards, so a caller cannot forget.
 *   - the registered name, and nothing else. No email, no status, no identifier — the select
 *     list is the guarantee, the same discipline `events/repository.ts#PUBLIC_COLUMNS` uses,
 *     and `tests/privacy/public-surface.test.ts` asserts it stays that way.
 *
 * Ordered by when each person confirmed, which is the one order that is a fact about them
 * rather than an accident of the database, and stable — `id` breaks a tie between two
 * confirmations in the same instant.
 */
export async function listPublicStartList<T extends Record<string, unknown>>(
  db: Database<T>,
  eventId: string,
): Promise<Array<{ registeredName: string }>> {
  return db
    .select({ registeredName: registrations.registeredName })
    .from(registrations)
    .where(
      and(
        eq(registrations.eventId, eventId),
        eq(registrations.status, "CONFIRMED"),
        eq(registrations.kind, "REAL"),
        eq(registrations.listOptOut, false),
      ),
    )
    .orderBy(asc(registrations.confirmedAt), asc(registrations.id));
}

export type OccupiedCountsRow = {
  confirmed: number;
  unexpiredPendingDeclarationHolds: number;
  unexpiredWaitlistOfferedHolds: number;
};

/** The counts `domain/capacity.ts#computeOccupied` needs, queried inside the locked transaction. */
export async function countOccupied<T extends Record<string, unknown>>(
  db: Database<T>,
  eventId: string,
  now: Date,
): Promise<OccupiedCountsRow> {
  const [row] = await db
    .select({
      confirmed: sql<number>`count(*) filter (where ${registrations.status} = 'CONFIRMED')::int`,
      unexpiredPendingDeclarationHolds: sql<number>`count(*) filter (where ${registrations.status} = 'PENDING_DECLARATION' and ${registrations.holdExpiresAt} > ${now})::int`,
      unexpiredWaitlistOfferedHolds: sql<number>`count(*) filter (where ${registrations.status} = 'WAITLIST_OFFERED' and ${registrations.holdExpiresAt} > ${now})::int`,
    })
    .from(registrations)
    .where(eq(registrations.eventId, eventId));

  return row ?? { confirmed: 0, unexpiredPendingDeclarationHolds: 0, unexpiredWaitlistOfferedHolds: 0 };
}

export async function countEligibleWaitlisted<T extends Record<string, unknown>>(
  db: Database<T>,
  eventId: string,
): Promise<number> {
  const [row] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(registrations)
    .where(and(eq(registrations.eventId, eventId), eq(registrations.status, "WAITLISTED")));
  return row?.count ?? 0;
}

/** WEEKEND.md's registration lifecycle diagram: an unconfirmed email link expires after 48h. */
export const EMAIL_CONFIRMATION_HOLD_HOURS = 48;

/**
 * Expire registrations still waiting on email confirmation 48h after submission.
 *
 * Global, not per-event: `PENDING_EMAIL_CONFIRMATION` never occupies capacity (§10.6 rule 6),
 * so there is no allocation to serialize and no event-row lock to take — unlike
 * `expireStaleHolds`, which guards a decision about a place.
 */
export async function expireStalePendingEmailConfirmations<T extends Record<string, unknown>>(
  db: Database<T>,
  now: Date,
): Promise<number> {
  const staleBefore = new Date(now.getTime() - EMAIL_CONFIRMATION_HOLD_HOURS * 60 * 60_000);
  const rows = await db
    .update(registrations)
    .set({ status: "EXPIRED", expiredAt: now, expiryReason: "EMAIL_CONFIRMATION_LAPSED", updatedAt: now })
    .where(
      and(
        eq(registrations.status, "PENDING_EMAIL_CONFIRMATION"),
        lte(registrations.submittedAt, staleBefore),
      ),
    )
    .returning({ id: registrations.id });
  return rows.length;
}

/**
 * Expire holds whose deadline has passed, for one event, inside the caller's locked
 * transaction. Two statements — one per originating status — because each needs its own
 * `expiry_reason` (AGENTS.md §10.6: "every capacity-changing transaction expires stale holds
 * ... before giving a place to a later registration").
 */
export async function expireStaleHolds<T extends Record<string, unknown>>(
  db: Database<T>,
  eventId: string,
  now: Date,
): Promise<void> {
  await db
    .update(registrations)
    .set({ status: "EXPIRED", expiredAt: now, expiryReason: "DECLARATION_HOLD_LAPSED", updatedAt: now })
    .where(
      and(
        eq(registrations.eventId, eventId),
        eq(registrations.status, "PENDING_DECLARATION"),
        lte(registrations.holdExpiresAt, now),
      ),
    );

  await db
    .update(registrations)
    .set({ status: "EXPIRED", expiredAt: now, expiryReason: "WAITLIST_OFFER_LAPSED", updatedAt: now })
    .where(
      and(
        eq(registrations.eventId, eventId),
        eq(registrations.status, "WAITLIST_OFFERED"),
        lte(registrations.holdExpiresAt, now),
      ),
    );
}

/**
 * The oldest eligible waiting-list entries, locked for allocation.
 *
 * `FOR UPDATE SKIP LOCKED` is what `claimOutboxBatch` uses for the same primitive: a concurrent
 * allocator (a cancellation and a capacity increase, both trying to fill the same event's
 * queue) locks disjoint rows instead of blocking on each other, and the caller's own event-row
 * lock is what actually prevents two allocators from running at once here — this additionally
 * protects against a promotion path that does not take that lock.
 */
export async function lockOldestWaitlisted<T extends Record<string, unknown>>(
  db: Database<T>,
  eventId: string,
  limit: number,
): Promise<Registration[]> {
  return db
    .select()
    .from(registrations)
    .where(and(eq(registrations.eventId, eventId), eq(registrations.status, "WAITLISTED")))
    .orderBy(asc(registrations.waitlistedAt), asc(registrations.id))
    .limit(limit)
    .for("update", { skipLocked: true });
}

/**
 * Every event with a registration the maintenance job (AGENTS.md §16.2) needs to look at: a
 * hold past its deadline, or a still-open waiting-list entry for an event that has started.
 *
 * A liveness query, not a correctness one — §16.2 is explicit that the job exists to send
 * expiry messages and retry delivery, not to make capacity correct, so missing an event here
 * for one run delays a notification rather than causing an overbooking.
 */
export async function findEventsNeedingMaintenance<T extends Record<string, unknown>>(
  db: Database<T>,
  now: Date,
): Promise<string[]> {
  const rows = await db
    .selectDistinct({ eventId: registrations.eventId })
    .from(registrations)
    .innerJoin(events, eq(events.id, registrations.eventId))
    .where(
      or(
        and(
          inArray(registrations.status, ["PENDING_DECLARATION", "WAITLIST_OFFERED"]),
          lte(registrations.holdExpiresAt, now),
        ),
        and(eq(registrations.status, "WAITLISTED"), lte(events.startsAt, now)),
      ),
    );
  return rows.map((row) => row.eventId);
}

/**
 * Close every remaining waiting-list entry once an event has started (AGENTS.md §10.5:
 * `WAITLISTED -> EXPIRED` with `expiry_reason = EVENT_STARTED`, no message sent).
 */
export async function closeWaitlistForStartedEvent<T extends Record<string, unknown>>(
  db: Database<T>,
  eventId: string,
  now: Date,
): Promise<number> {
  const rows = await db
    .update(registrations)
    .set({ status: "EXPIRED", expiredAt: now, expiryReason: "EVENT_STARTED", updatedAt: now })
    .where(and(eq(registrations.eventId, eventId), eq(registrations.status, "WAITLISTED")))
    .returning({ id: registrations.id });
  return rows.length;
}

/**
 * Record a declaration acceptance (AGENTS.md §12.7, §10.8). Insert-only — a restart that
 * re-signs gets a new row, never an overwrite of the historical one.
 */
export async function insertDeclarationAcceptance<T extends Record<string, unknown>>(
  db: Database<T>,
  input: {
    registrationId: string;
    legalDocumentId: string;
    declarationVersion: number;
    contentSha256: string;
    locale: Locale;
    typedName: string;
    acceptedAt: Date;
  },
): Promise<void> {
  await db.insert(declarationAcceptances).values({
    registrationId: input.registrationId,
    legalDocumentId: input.legalDocumentId,
    declarationVersion: input.declarationVersion,
    contentSha256: input.contentSha256,
    locale: input.locale,
    typedName: input.typedName,
    acceptedAt: input.acceptedAt,
  });
}
