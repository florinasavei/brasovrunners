import { and, asc, count, desc, eq, exists, inArray, isNotNull, isNull, lte, or, sql } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import { declarationAcceptances } from "@/db/schema/declaration-acceptances";
import { events } from "@/db/schema/events";
import {
  ACTIVE_REGISTRATION_STATUSES,
  type Registration,
  type RegistrationKind,
  type RegistrationSource,
  type RegistrationStatus,
  registrations,
} from "@/db/schema/registrations";
import type { Database } from "@/db/types";
import type { Locale } from "@/i18n/routing";
import { revalidatePublicContent } from "@/modules/public-cache/cache";
import { env } from "@/shared/config/env";
import { DomainError } from "@/shared/errors/domain-error";
import { computeOccupied } from "./domain/capacity";
import { allowedFromStatuses, holdsAPlace, PLACE_HOLDING_STATUSES } from "./domain/state-machine";
import { resolveDisplayName, type RegistrationEntryDetails } from "./names";

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

/**
 * This participant's most recent registration that is still live, across every event that will
 * still be run.
 *
 * For the participant-facing link request (§19.4), where the person has an address and a
 * problem — "nothing arrived" — and not necessarily the event in hand. Ordered by creation
 * rather than by event date so that the answer is the thing they most recently did, which is
 * what somebody asking for a link again is almost always asking about.
 *
 * Scheduled events only (§331): a cancelled event hands out no link, and a finished one has
 * nothing left to link to. Filtered here rather than after the pick, so a runner whose newest
 * registration is on a race that was called off still gets the link for the one they are going
 * to run, instead of nothing.
 */
export async function findLatestActiveRegistrationForParticipant<
  T extends Record<string, unknown>,
>(db: Database<T>, participantId: string): Promise<Registration | undefined> {
  const [row] = await db
    .select()
    .from(registrations)
    .innerJoin(events, eq(events.id, registrations.eventId))
    .where(
      and(
        eq(registrations.participantId, participantId),
        inArray(registrations.status, [...ACTIVE_REGISTRATION_STATUSES]),
        eq(events.eventStatus, "SCHEDULED"),
      ),
    )
    .orderBy(desc(registrations.createdAt))
    .limit(1);
  return row?.registrations;
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

/**
 * How many of those are test rows (§170).
 *
 * The refusal to delete an event counts every registration, test ones included — the foreign
 * key does not care what kind they are. The editor says so in words, and the number that makes
 * the sentence actionable is this one: "three registrations, all of them test data" has a
 * button beside it ("Șterge înscrierile de test"), where "three registrations" alone reads as
 * a dead end. `AGENTS.md` §12.6 keeps this out of every count the *club* is given; this is the
 * count the person deleting the row is given, which is a different question.
 */
export async function countTestRegistrationsForEvent<T extends Record<string, unknown>>(
  db: Database<T>,
  eventId: string,
): Promise<number> {
  const [row] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(registrations)
    .where(and(eq(registrations.eventId, eventId), eq(registrations.kind, "TEST")));
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
  /** BR-REQ-031-04. Absent for a row an organizer typed from a telephone call. */
  details?: RegistrationEntryDetails;
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

      // BR-REQ-031-04. Every detail may be absent; the display name may not, and is derived
      // rather than defaulted to the legal name — see `resolveDisplayName`.
      firstName: input.details?.firstName ?? null,
      lastName: input.details?.lastName ?? null,
      displayName: resolveDisplayName({
        displayName: input.details?.displayName,
        firstName: input.details?.firstName,
        lastName: input.details?.lastName,
        legalName: input.registeredName,
      }),
      birthDate: input.details?.birthDate ?? null,
      sex: input.details?.sex ?? null,
      nationality: input.details?.nationality ?? null,
      city: input.details?.city ?? null,
      phone: input.details?.phone ?? null,
      emergencyContactName: input.details?.emergencyContactName ?? null,
      emergencyContactPhone: input.details?.emergencyContactPhone ?? null,
      clubName: input.details?.clubName ?? null,
      guardianName: input.details?.guardianName ?? null,
      stravaUrl: input.details?.stravaUrl ?? null,
      instagramHandle: input.details?.instagramHandle ?? null,
      // NOT NULL with a default of false: "did not say" and "said no" are the same answer to
      // a question that grants nothing, unlike the two consents above it, where they are not.
      clubMemberDeclared: input.details?.clubMemberDeclared ?? false,
      tshirtSize: input.details?.tshirtSize ?? null,
      healthNotes: input.details?.healthNotes ?? null,
      healthConsentVersion: input.details?.healthConsentVersion ?? null,
      healthConsentAt: input.details?.healthConsentAt ?? null,
      fitnessDeclaredAt: input.details?.fitnessDeclaredAt ?? null,
      rulesAcknowledgedAt: input.details?.rulesAcknowledgedAt ?? null,

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
    .set({
      /**
       * The provisional number is released here, and here only (§214).
       *
       * It belongs to a registration *while it occupies a place*, so the moment the place goes
       * — cancelled, expired, or pushed back onto the waiting list — the number returns to the
       * pool for the next person. Putting it in the one guarded transition every state change
       * already goes through is the point: there is no path that moves a registration out of a
       * place and forgets, and no second implementation to drift.
       *
       * It cannot be written the other way round — a *draw* needs the event row's lock and a
       * read of the band, which this function has neither of — so the draw lives in the
       * allocator's own paths, which hold both. Releasing needs nothing, and losing a release
       * is the failure that matters: a number nobody holds but nobody can take.
       *
       * `bib_number` is untouched. A cancelled runner keeps the final number they were given,
       * which is how two people avoid both wearing 17.
       */
      ...(holdsAPlace(params.to) ? {} : { provisionalBibNumber: null }),
      ...params.changes,
      status: params.to,
      updatedAt: params.now,
    })
    .where(and(eq(registrations.id, params.id), inArray(registrations.status, fromStatuses)))
    .returning();
  /*
    The free places and the public start list are cached for the public pages (§333), and this is
    the one statement every change of state goes through — the allocator's click and its job, the
    desk, the staff screens, a participant's own link — so the cache is told here, once, rather
    than in each of them. Next applies it when the request ends, which is after the caller's
    transaction has committed; one that rolls back costs a refetch.
  */
  if (row) revalidatePublicContent("places");
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
  /**
   * One page of the list (§250). Absent, the whole of it — which is what every caller before
   * the page existed asked for, and what the privacy test still reads.
   */
  page?: { offset: number; limit: number },
): Promise<Array<{ displayName: string; clubName: string | null }>> {
  const query = db
    // BR-REQ-039-02: the display name, never the legal one, and the club they wrote (§85).
    // The select list is the guarantee — widening it is what
    // tests/privacy/public-surface.test.ts refuses.
    .select({ displayName: registrations.displayName, clubName: registrations.clubName })
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

  // The order is what makes a page meaningful: a runner keeps their position and their page
  // however often the list is read, because both columns of the sort are fixed at confirmation.
  return page ? query.limit(page.limit).offset(page.offset) : query;
}

/**
 * How many runners the list names (§250).
 *
 * A number, so a page of fifty does not have to fetch four hundred rows to know it is the
 * first of eight. The same four conditions as the list itself — anything else would be a page
 * count that disagrees with the page.
 */
export async function countPublicStartList<T extends Record<string, unknown>>(
  db: Database<T>,
  eventId: string,
): Promise<number> {
  const [row] = await db
    .select({ count: count() })
    .from(registrations)
    .where(
      and(
        eq(registrations.eventId, eventId),
        eq(registrations.status, "CONFIRMED"),
        eq(registrations.kind, "REAL"),
        eq(registrations.listOptOut, false),
      ),
    );
  return row?.count ?? 0;
}

/**
 * How many confirmed runners asked to be left off the list (`DECISIONS.md` §186).
 *
 * The owner: "trebuie să văd care participanți sunt vizibili pe site și care nu — și cumva să îi
 * afișez cenzurați… gen «participanți surpriză», sau «participanți anonimi»". A count, never a
 * row: this query selects a number and nothing else, so there is no name, no club and no
 * identifier to leak, and `tests/privacy/public-surface.test.ts` keeps its grip on
 * `listPublicStartList` exactly as it was. What the page gains is honesty about its own total —
 * "42 înscriși" that lists 39 is a page contradicting itself — and what it cannot gain, because
 * the data is not here, is any hint of who the other three are.
 */
export async function countAnonymousStartListEntries<T extends Record<string, unknown>>(
  db: Database<T>,
  eventId: string,
): Promise<number> {
  const [row] = await db
    .select({ count: count() })
    .from(registrations)
    .where(
      and(
        eq(registrations.eventId, eventId),
        eq(registrations.status, "CONFIRMED"),
        eq(registrations.kind, "REAL"),
        eq(registrations.listOptOut, true),
      ),
    );
  return row?.count ?? 0;
}

export type OccupiedCountsRow = {
  confirmed: number;
  pendingDeclarationHolds: number;
  unexpiredWaitlistOfferedHolds: number;
  /**
   * Of `pendingDeclarationHolds`, the ones past their deadline (§160): still occupying, and
   * counted in `computeOccupied` like any other, but a place a newcomer the waiting list cannot
   * take is given (§348, `domain/waitlist.ts#occupiedForNewcomer`).
   */
  lapsedDeclarationHolds: number;
};

/**
 * The counts `domain/capacity.ts#computeOccupied` needs, queried inside the locked transaction.
 *
 * A declaration hold occupies its place by status, deadline or no deadline: since `DECISIONS.md`
 * §160 a lapsed hold is kept — the place stays the person's until the event starts — unless
 * somebody is waiting for it, and it is `expireStaleHolds` that decides, never this count. An
 * offer is a promise to the queue and still occupies only while its deadline is ahead.
 */
export async function countOccupied<T extends Record<string, unknown>>(
  db: Database<T>,
  eventId: string,
  now: Date,
): Promise<OccupiedCountsRow> {
  const [row] = await db
    .select({
      confirmed: sql<number>`count(*) filter (where ${registrations.status} = 'CONFIRMED')::int`,
      pendingDeclarationHolds: sql<number>`count(*) filter (where ${registrations.status} = 'PENDING_DECLARATION')::int`,
      unexpiredWaitlistOfferedHolds: sql<number>`count(*) filter (where ${registrations.status} = 'WAITLIST_OFFERED' and ${registrations.holdExpiresAt} > ${now})::int`,
      lapsedDeclarationHolds: sql<number>`count(*) filter (where ${registrations.status} = 'PENDING_DECLARATION' and ${registrations.holdExpiresAt} <= ${now})::int`,
    })
    .from(registrations)
    .where(eq(registrations.eventId, eventId));

  return row ?? { confirmed: 0, pendingDeclarationHolds: 0, unexpiredWaitlistOfferedHolds: 0, lapsedDeclarationHolds: 0 };
}

/**
 * The instants at which the clock alone changes what the event page is told about places
 * (`DECISIONS.md` §333, and §350 waiting-list length): when each open waiting-list offer lapses,
 * and — on an event whose waiting list has a limit — when each declaration hold does.
 *
 * An offer occupies its place while `hold_expires_at > now` and not a moment after. A declaration
 * hold occupies its place past its deadline too (§160), but once the line has a limit a lapsed
 * one is a place the next newcomer is given when the line cannot take them
 * (`domain/waitlist.ts#occupiedForNewcomer`), so its deadline changes the count as well; without a
 * limit it changes nothing, and is left out rather than splitting the cache for no reason. Both
 * fall on the `reached` side of the instant (`hold_expires_at > now`, `hold_expires_at <= now`).
 * Between two of these instants the count cannot change without a write. The public cache keys the
 * count by the stretch `now` is in (`public-cache/clock.ts`), which is what lets a cached count be
 * the allocator's own answer for this instant rather than a recent one.
 */
export async function listPlaceCountInstants<T extends Record<string, unknown>>(
  db: Database<T>,
  eventId: string,
): Promise<Date[]> {
  const rows = await db
    .select({ holdExpiresAt: registrations.holdExpiresAt })
    .from(registrations)
    .innerJoin(events, eq(events.id, registrations.eventId))
    .where(
      and(
        eq(registrations.eventId, eventId),
        or(
          eq(registrations.status, "WAITLIST_OFFERED"),
          and(eq(registrations.status, "PENDING_DECLARATION"), isNotNull(events.waitlistCapacity)),
        ),
      ),
    );
  return rows.flatMap((row) => (row.holdExpiresAt ? [row.holdExpiresAt] : []));
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
    // The provisional number goes with the place (§214, §220). These bulk sweeps do not go
    // through `transitionRegistration`, which is where the release lives, so each one has to
    // say it — a number held by an expired row is a number nobody can ever be given.
    .set({ status: "EXPIRED", expiredAt: now, expiryReason: "EMAIL_CONFIRMATION_LAPSED", provisionalBibNumber: null, updatedAt: now })
    .where(
      and(
        eq(registrations.status, "PENDING_EMAIL_CONFIRMATION"),
        lte(registrations.submittedAt, staleBefore),
      ),
    )
    .returning({ id: registrations.id });
  return rows.length;
}

/** What `expireStaleHolds` needs to know about the event whose places it is releasing. */
export type EventForExpiry = {
  id: string;
  startsAt: Date;
  eventStatus: "SCHEDULED" | "CANCELLED" | "COMPLETED";
  capacity: number | null;
};

/**
 * Which lapsed declaration holds this event owes the queue right now, oldest deadline first.
 *
 * The whole of `DECISIONS.md` §160 is here. A hold past its deadline is released only when
 * the place it is holding is actually wanted, and then only as many holds as are wanted:
 *
 * - the event has started, or is over (`COMPLETED`) — every hold is over, because nobody may
 *   be left holding a place on a race that has begun. A `CANCELLED` event never reaches here
 *   any more: `fillAvailableSpots` and the job leave its registrations as they stood (§331);
 * - otherwise, the waiting list wants `waiting - free` places, where `free` is what the event
 *   has without touching any hold. One person joining the queue releases one hold, the oldest
 *   deadline first — never the whole event's worth of kept places, which would silently evict
 *   the very people the decision exists to be lenient with.
 *
 * With nobody waiting, or with free places enough for everybody who waits, nothing is
 * released: the rows stay `PENDING_DECLARATION`, keep occupying their places (`countOccupied`)
 * and can still be signed online or on paper at the desk.
 *
 * `wanting` is anybody else who wants a place and is not in the line (§348): the registration
 * the allocator is deciding, when the waiting list's limit leaves no room for it — on an event
 * with no waiting list, every newcomer once the places are gone. Nobody would ever be
 * `WAITLISTED` there to want the place, so without this a runner who never signed would keep it
 * until the race while everybody after them was turned away. Counted like one more person
 * waiting: one newcomer, one hold, the oldest deadline first.
 */
async function lapsedDeclarationHoldsToRelease<T extends Record<string, unknown>>(
  db: Database<T>,
  event: EventForExpiry,
  now: Date,
  wanting: number,
): Promise<string[]> {
  const lapsed = await db
    .select({ id: registrations.id })
    .from(registrations)
    .where(
      and(
        eq(registrations.eventId, event.id),
        eq(registrations.status, "PENDING_DECLARATION"),
        lte(registrations.holdExpiresAt, now),
      ),
    )
    .orderBy(asc(registrations.holdExpiresAt), asc(registrations.id));
  if (lapsed.length === 0) return [];

  if (event.eventStatus !== "SCHEDULED" || event.startsAt <= now) return lapsed.map((row) => row.id);

  const waiting = (await countEligibleWaitlisted(db, event.id)) + wanting;
  if (waiting === 0) return [];
  const free =
    event.capacity === null
      ? Number.POSITIVE_INFINITY
      : Math.max(event.capacity - computeOccupied(await countOccupied(db, event.id, now)), 0);
  const wanted = Math.min(lapsed.length, Math.max(waiting - free, 0));
  return lapsed.slice(0, wanted).map((row) => row.id);
}

/**
 * Expire holds whose deadline has passed, for one event, inside the caller's locked
 * transaction. Two statements — one per originating status — because each needs its own
 * `expiry_reason` (AGENTS.md §10.6: "every capacity-changing transaction expires stale holds
 * ... before giving a place to a later registration").
 *
 * A waiting-list offer expires at its deadline as it always did: it was a promise made to the
 * queue. A declaration hold is released only when, and only as far as, the place is wanted —
 * `lapsedDeclarationHoldsToRelease` above decides, and `DECISIONS.md` §160 says why. Both run
 * under the caller's event lock, so a waiting-list entry arriving at the same moment is
 * serialised against this decision rather than racing it.
 *
 * `wanting` counts a newcomer the waiting list has no room for as one more person wanting a
 * place (§348) — `allocateOrWaitlist` alone passes it; every other caller wants the default.
 */
export async function expireStaleHolds<T extends Record<string, unknown>>(
  db: Database<T>,
  event: EventForExpiry,
  now: Date,
  { wanting = 0 }: { wanting?: number } = {},
): Promise<void> {
  // The offers first: each one released is a place the queue can have without touching a
  // kept declaration hold, and the count below must see it as free.
  const lapsedOffers = await db
    .update(registrations)
    // As above (§220): the place goes, so the number goes.
    .set({ status: "EXPIRED", expiredAt: now, expiryReason: "WAITLIST_OFFER_LAPSED", provisionalBibNumber: null, updatedAt: now })
    .where(
      and(
        eq(registrations.eventId, event.id),
        eq(registrations.status, "WAITLIST_OFFERED"),
        lte(registrations.holdExpiresAt, now),
      ),
    )
    .returning({ id: registrations.id });

  const releasing = await lapsedDeclarationHoldsToRelease(db, event, now, wanting);
  if (releasing.length > 0) {
    await db
      .update(registrations)
      .set({ status: "EXPIRED", expiredAt: now, expiryReason: "DECLARATION_HOLD_LAPSED", updatedAt: now })
      .where(and(eq(registrations.eventId, event.id), inArray(registrations.id, releasing)));
  }
  // A bulk sweep, beside `transitionRegistration` rather than through it, so it tells the public
  // cache itself (§333): the places these rows held are counted as free from now on.
  if (lapsedOffers.length > 0 || releasing.length > 0) revalidatePublicContent("places");
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
 * Every scheduled event with a registration the maintenance job (AGENTS.md §16.2) needs to
 * look at: an offer past its deadline, a lapsed declaration hold that somebody is waiting for
 * (§160 — with nobody waiting the hold is kept, and the job would lock the event to do
 * nothing, on every run until the race), a hold or waiting-list entry left open on an event
 * that has started, or numbers to settle. Never a cancelled or completed event (§331, §82).
 *
 * A liveness query, not a correctness one — §16.2 is explicit that the job exists to send
 * expiry messages and retry delivery, not to make capacity correct, so missing an event here
 * for one run delays a notification rather than causing an overbooking.
 */
export async function findEventsNeedingMaintenance<T extends Record<string, unknown>>(
  db: Database<T>,
  now: Date,
): Promise<string[]> {
  const waiting = alias(registrations, "waiting");
  const somebodyWaits = exists(
    db
      .select({ one: sql`1` })
      .from(waiting)
      .where(and(eq(waiting.eventId, registrations.eventId), eq(waiting.status, "WAITLISTED"))),
  );
  const rows = await db
    .selectDistinct({ eventId: registrations.eventId })
    .from(registrations)
    .innerJoin(events, eq(events.id, registrations.eventId))
    .where(
      and(
        /*
          Only an event that will still be run (§331). A completed event is over: the job
          leaves it alone (§82). A cancelled one is left alone too, since §331: its
          registrations stay as they were when it was cancelled — the record of who had
          entered, which the participants were told in so many words — so nothing about it is
          expired, offered, settled or numbered, and a race put back on finds its queue where it
          left it. It used to be selected so its lapsed holds would expire (§160); that was a
          silent status change on a race nobody can take a place in, and it sent nothing either.
        */
        sql`${events.eventStatus} = 'SCHEDULED'`,
        or(
          and(eq(registrations.status, "WAITLIST_OFFERED"), lte(registrations.holdExpiresAt, now)),
          and(eq(registrations.status, "PENDING_DECLARATION"), lte(registrations.holdExpiresAt, now), somebodyWaits),
          and(inArray(registrations.status, ["PENDING_DECLARATION", "WAITLISTED"]), lte(events.startsAt, now)),
          /*
            An event whose registration has closed and whose numbers have not been settled
            (§214).

            Without this clause the settle would never happen on the event that needs it most:
            a race that filled up cleanly has no expired hold and no waiting list, so none of
            the three conditions above ever names it, and the job would close the window and
            leave everybody holding a provisional number for ever.

            `bibs_settled_at IS NULL` is what keeps this from selecting every past event on
            every run — it is true once per event, and the settle's own write makes it false.
          */
          and(
            isNull(events.bibsSettledAt),
            lte(sql`coalesce(${events.registrationClosesAt}, ${events.startsAt})`, now),
            inArray(registrations.status, [...PLACE_HOLDING_STATUSES]),
          ),
        ),
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
    // As above (§220): the place goes, so the number goes.
    .set({ status: "EXPIRED", expiredAt: now, expiryReason: "EVENT_STARTED", provisionalBibNumber: null, updatedAt: now })
    .where(and(eq(registrations.eventId, eventId), eq(registrations.status, "WAITLISTED")))
    .returning({ id: registrations.id });
  // The waiting list is part of the public count (`computePublicAvailability`) — §333.
  if (rows.length > 0) revalidatePublicContent("places");
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
    idDocument?: string | null;
    /** A minor's own signature and document, beside the parent's (§330); omitted for an adult. */
    minorTypedName?: string | null;
    minorIdDocument?: string | null;
    acceptedAt: Date;
    /** `PAPER` with the staff id that recorded it; omitted for the email link (BR-REQ-037-07). */
    method?: "EMAIL_LINK" | "PAPER";
    attestedByStaffUserId?: string | null;
  },
): Promise<void> {
  await db.insert(declarationAcceptances).values({
    registrationId: input.registrationId,
    legalDocumentId: input.legalDocumentId,
    declarationVersion: input.declarationVersion,
    contentSha256: input.contentSha256,
    locale: input.locale,
    typedName: input.typedName,
    idDocument: input.idDocument ?? null,
    minorTypedName: input.minorTypedName ?? null,
    minorIdDocument: input.minorIdDocument ?? null,
    acceptedAt: input.acceptedAt,
    method: input.method ?? "EMAIL_LINK",
    attestedByStaffUserId: input.attestedByStaffUserId ?? null,
  });
}
