import { and, asc, count, desc, eq, exists, gt, gte, inArray, isNotNull, lte, not, or, type SQL, sql } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import { declarationAcceptances } from "@/db/schema/declaration-acceptances";
import { emailOutbox } from "@/db/schema/email-outbox";
import { events } from "@/db/schema/events";
import { familyPlaceHolds } from "@/db/schema/family-entries";
import { eventInvitations } from "@/db/schema/event-invitations";
import { eventsWithLapsedInvitations, expireLapsedInvitations, invitationHoldsCount, invitationOpen } from "./invitation-repository";
import {
  ACTIVE_REGISTRATION_STATUSES,
  type Registration,
  type RegistrationKind,
  type RegistrationSource,
  type RegistrationStatus,
  registrations,
} from "@/db/schema/registrations";
import type { Database, Transaction } from "@/db/types";
import type { Locale } from "@/i18n/routing";
import { OFFER_UNTIL_START, STARTS_DEADLINE } from "@/modules/notifications/domain/deadline-rebase";
import { revalidatePublicContent } from "@/modules/public-cache/cache";
import { env } from "@/shared/config/env";
import { DomainError } from "@/shared/errors/domain-error";
import { computeOccupied, wantedLapsedHoldReleases } from "./domain/capacity";
import { registrationNameKey } from "./domain/name-key";
import { PENDING_LIST_STATUSES, WAITLISTED_LIST_STATUSES } from "./domain/public-list-states";
import { allowedFromStatuses } from "./domain/state-machine";
import { queueHoldLapsedEmails } from "./hold-lapsed-email";
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

/**
 * One registration of this address at this event — the active one when there is one, else the
 * newest (§389).
 *
 * Until the contract release there is at most one row to find (`registrations_event_participant_unique`),
 * and this returns it as it always did. Once an address may carry a family, a caller that asks for
 * "the" registration — the staff entry's duplicate check, the test batch reading back what it just
 * made — gets the one that matters, deterministically, rather than whichever row the planner reads
 * first. A caller that needs every runner on the address reads `findRegistrationsByEventAndParticipant`.
 */
export async function findRegistrationByEventAndParticipant<T extends Record<string, unknown>>(
  db: Database<T>,
  eventId: string,
  participantId: string,
): Promise<Registration | undefined> {
  const [row] = await db
    .select()
    .from(registrations)
    .where(and(eq(registrations.eventId, eventId), eq(registrations.participantId, participantId)))
    .orderBy(
      desc(inArray(registrations.status, [...ACTIVE_REGISTRATION_STATUSES])),
      desc(registrations.updatedAt),
      desc(registrations.id),
    )
    .limit(1);
  return row;
}

/**
 * Every registration of this address at this event, oldest first (§389): the runners a family
 * entered on one address, each their own row, whatever their state. `submitRegistration` reads it
 * under the event's lock and decides by the runner's name (`domain/name-key.ts`) whether a
 * submission is somebody already there or another person.
 */
export async function findRegistrationsByEventAndParticipant<T extends Record<string, unknown>>(
  db: Database<T>,
  eventId: string,
  participantId: string,
): Promise<Registration[]> {
  return db
    .select()
    .from(registrations)
    .where(and(eq(registrations.eventId, eventId), eq(registrations.participantId, participantId)))
    .orderBy(asc(registrations.createdAt), asc(registrations.id));
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
 * «Trimite-i oferta» on a full event (§642): one supplementary place, on this one event row — never a
 * series' other dates — written by the caller under the event lock it already holds, in the
 * transaction that then makes the offer into it. `capacity + 1` in SQL, so the number written is the
 * locked row's plus one whatever the caller's copy says; the row's `version` moves like any save's
 * (AGENTS.md §11.5), so an editor opened before the press is told the event changed rather than
 * writing the old capacity back. The new capacity, or null for an uncapped event, which never lacks a
 * place and is never written.
 */
export async function addSupplementaryPlace<T extends Record<string, unknown>>(
  db: Database<T>,
  eventId: string,
  actorStaffUserId: string,
  now: Date,
): Promise<number | null> {
  const [row] = await db
    .update(events)
    .set({ capacity: sql`${events.capacity} + 1`, version: sql`${events.version} + 1`, updatedAt: now, updatedByStaffUserId: actorStaffUserId })
    .where(and(eq(events.id, eventId), isNotNull(events.capacity)))
    .returning({ capacity: events.capacity });
  return row?.capacity ?? null;
}

/**
 * Whether the event offers its freed and added places to the waiting list on its own (§615):
 * `events.waitlist_auto_offer`, read by `fillAvailableSpots` inside the caller's transaction, after
 * the caller locked the row — so the answer is the row's as it stands under the lock, whatever copy
 * of the event the caller carries (a fixture's partial row, the editor's row from before the save).
 * A row that does not exist offers nothing.
 */
export async function offersWaitlistAutomatically<T extends Record<string, unknown>>(db: Database<T>, eventId: string): Promise<boolean> {
  const [row] = await db.select({ auto: events.waitlistAutoOffer }).from(events).where(eq(events.id, eventId)).limit(1);
  return row?.auto ?? false;
}

/**
 * Where a waiting registration stands in its event's line, and how long the line is (§629; the owner:
 * „Ești pe locul 3 din 10”): the one reader behind the registration's own page,
 * «Toate înscrierile mele» and the `WAITLIST_JOINED` email, so the three can never say different numbers.
 *
 * **The order is `lockOldestWaitlisted`'s own** — `waitlisted_at` ascending, `id` for a tie — the order
 * the allocator offers places by (`fillAvailableSpots`), taken as a window over the same rows, so the
 * position is the number of `WAITLISTED` rows ahead plus one with no second statement of the rule. The
 * length is every `WAITLISTED` row of the event. A person offered a place (`WAITLIST_OFFERED`) has left
 * the line and is not in either number; a cancelled or expired row never was. `kind` appears in no
 * condition: a `TEST` row stands in the line exactly as a real one does (`AGENTS.md` §12.6), as
 * `countEligibleWaitlisted` counts it.
 *
 * `autoOffer` is the event's `waitlist_auto_offer` (§615), so the sentence can say whether freed places
 * go in order or the club chooses — one read of the event, in the same call, rather than a second one
 * per page. Null when the registration is not `WAITLISTED` (or does not exist): nobody stands anywhere.
 * Null too when the event is cancelled: a cancellation keeps every registration in its state (§331) and
 * the allocator offers nothing (`fillAvailableSpots`), so a sentence about a place in a line, or about
 * freed places going in order, would promise what will not happen — the page already says the event is
 * cancelled, and the three surfaces say nothing of the line.
 * Two statements, no lock: a number that is one place stale the instant it renders is the same as the
 * public counts, and nothing is decided from it.
 */
export async function readWaitlistPosition<T extends Record<string, unknown>>(
  db: Database<T>,
  registrationId: string,
): Promise<{ position: number; length: number; autoOffer: boolean; countPublic: boolean } | null> {
  const [own] = await db
    .select({
      eventId: registrations.eventId,
      status: registrations.status,
      autoOffer: events.waitlistAutoOffer,
      // «Arată public câți așteaptă» (§634), from the same read of the event row: whether the sentence may say the line's length.
      countPublic: events.waitlistCountPublic,
      eventStatus: events.eventStatus,
    })
    .from(registrations)
    .innerJoin(events, eq(events.id, registrations.eventId))
    .where(eq(registrations.id, registrationId))
    .limit(1);
  if (!own || own.status !== "WAITLISTED" || own.eventStatus === "CANCELLED") return null;
  const line = db
    .select({
      id: registrations.id,
      position: sql<number>`(row_number() over (order by ${registrations.waitlistedAt} asc, ${registrations.id} asc))::int`.as("position"),
      length: sql<number>`(count(*) over ())::int`.as("length"),
    })
    .from(registrations)
    .where(and(eq(registrations.eventId, own.eventId), eq(registrations.status, "WAITLISTED")))
    .as("waitlist_line");
  const [row] = await db.select({ position: line.position, length: line.length }).from(line).where(eq(line.id, registrationId));
  // The row left the line between the two statements: it is no longer waiting.
  return row ? { position: row.position, length: row.length, autoOffer: own.autoOffer, countPublic: own.countPublic } : null;
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
  /**
   * When this registration's email link lapses unconfirmed (§377) — the club's hours at the moment
   * of submission. Absent, the row lapses at `submitted_at` plus the setting in force, as rows
   * written before the column do.
   */
  emailLinkExpiresAt?: Date | null;
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
      // Whose registration this is on the address (§389): the name folded, what the unique index keeps.
      nameKey: registrationNameKey(input.registeredName),

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
      // Never null (§510): a staff entry or a kept family entry without one lives in Romania,
      // the column's own default, said here so the insert never names a null.
      country: input.details?.country ?? "RO",
      city: input.details?.city ?? null,
      phone: input.details?.phone ?? null,
      emergencyContactName: input.details?.emergencyContactName ?? null,
      emergencyContactPhone: input.details?.emergencyContactPhone ?? null,
      clubName: input.details?.clubName ?? null,
      guardianName: input.details?.guardianName ?? null,
      stravaUrl: input.details?.stravaUrl ?? null,
      instagramHandle: input.details?.instagramHandle ?? null,
      // The socials beside the name on the public list (§500): decided by the service, false unless said.
      listSocials: input.details?.listSocials ?? false,
      // The offers and benefits (§562): decided by the service, false and never dated unless said.
      promoConsent: input.details?.promoConsent ?? false,
      promoConsentAt: input.details?.promoConsentAt ?? null,
      // NOT NULL with a default of false: "did not say" and "said no" are the same answer to
      // a question that grants nothing, unlike the two consents above it, where they are not.
      clubMemberDeclared: input.details?.clubMemberDeclared ?? false,
      tshirtSize: input.details?.tshirtSize ?? null,
      healthNotes: input.details?.healthNotes ?? null,
      healthConsentVersion: input.details?.healthConsentVersion ?? null,
      healthConsentAt: input.details?.healthConsentAt ?? null,
      fitnessDeclaredAt: input.details?.fitnessDeclaredAt ?? null,
      rulesAcknowledgedAt: input.details?.rulesAcknowledgedAt ?? null,
      termsVersion: input.details?.termsVersion ?? null,
      termsAcceptedAt: input.details?.termsAcceptedAt ?? null,

      privacyNoticeVersion: input.privacyNoticeVersion,
      privacyAcknowledgedAt: input.privacyAcknowledgedAt,
      raceId: input.raceId,
      resultsNameConsent: input.resultsNameConsent,
      resultsConsentVersion: input.resultsConsentVersion,
      listOptOut: input.listOptOut,
      submittedAt: input.now,
      emailLinkExpiresAt: input.emailLinkExpiresAt ?? null,
      // The answers' own instant (§654): a restart moves it, `created_at` stays.
      answersWrittenAt: input.now,
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
 * A row of the public list: the display name and the club — and, only when the caller asked for
 * the socials behind the notice's gate (§500), the runner's Strava link and Instagram username,
 * each null unless that runner ticked «Arată și Strava și Instagram» (`registrations.list_socials`);
 * and, only when the caller asked for the numbers behind theirs (§613), a confirmed runner's race
 * number, null while it has none.
 */
export type PublicStartListRow = {
  displayName: string;
  clubName: string | null;
  stravaUrl?: string | null;
  instagramHandle?: string | null;
  bibNumber?: number | null;
};

/**
 * The two socials columns a public list may add (§500, widening §106), or none.
 *
 * Asked for only by `StartList`, only while the privacy notice in force names
 * `{{participantListSocials}}` (`cachedListSocialsDisclosed`). Even then each value is gated in
 * the SQL on the runner's own tick, so an unticked runner's link never leaves the database — a
 * caller cannot print what the query did not return. `list_socials` is only ever true for an
 * adult who ticked the list too, typed at least one of the two, and was given a notice that
 * described it (`service.ts`); a minor has neither column at all (§323).
 */
function publicSocialColumns(socials: boolean | undefined): Record<string, SQL<string | null>> {
  if (!socials) return {};
  return {
    stravaUrl: sql<string | null>`case when ${registrations.listSocials} then ${registrations.stravaUrl} end`,
    instagramHandle: sql<string | null>`case when ${registrations.listSocials} then ${registrations.instagramHandle} end`,
  };
}

/**
 * The race-number column a public list may add (§613, amending §396), or none.
 *
 * Asked for only by `StartList`, only while the privacy notice in force names
 * `{{participantListNumbers}}` (`cachedListNumbersDisclosed`), and only on the confirmed list —
 * `listPublicStartListOthers` never selects it: a pending or waiting registration has no number
 * (§548). It is selected for every confirmed runner, whichever privacy notice their registration
 * recorded: the owner decided so on 2026-10-01 (§613), the club telling the earlier registrations
 * beforehand, where §421's per-runner line still holds for the states. **`bib_number` and never
 * `provisional_bib_number`** (§214): the provisional number was printed nowhere and emailed to
 * nobody precisely so that it could move, and a number published beside a name is a number that
 * cannot. Since §548 nothing writes the provisional column any more, which changes nothing here:
 * the public select never names it (`tests/privacy/public-surface.test.ts`).
 */
function publicNumberColumns(numbers: boolean | undefined): Record<string, typeof registrations.bibNumber> {
  return numbers ? { bibNumber: registrations.bibNumber } : {};
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
  /**
   * Only behind the notice's gates: the socials (§500, `publicSocialColumns`) and the race number
   * (§613, `publicNumberColumns`). Without either, the select is exactly the name and the club.
   */
  options: { socials?: boolean; numbers?: boolean } = {},
): Promise<PublicStartListRow[]> {
  const query = db
    // BR-REQ-039-02: the display name, never the legal one, and the club they wrote (§85).
    // The select list is the guarantee — widening it is what
    // tests/privacy/public-surface.test.ts refuses.
    .select({
      displayName: registrations.displayName,
      clubName: registrations.clubName,
      ...publicSocialColumns(options.socials),
      ...publicNumberColumns(options.numbers),
    })
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
  const rows = await (page ? query.limit(page.limit).offset(page.offset) : query);
  // The gated spreads widen Drizzle's inferred row to an index signature; the select above is
  // exactly `PublicStartListRow`'s keys, the two socials and the number present only when asked for.
  return rows as unknown as PublicStartListRow[];
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
        // A runner seated outside the places (§643) appears only as a ticked runner does: unticked, not at all.
        eq(registrations.outsideCapacity, false),
      ),
    );
  return row?.count ?? 0;
}

/**
 * Of `countPublicStartList`'s named rows, those seated «În afara locurilor» (§643): they stay in the
 * table — the person ticked, and the list is a disclosure they chose — and leave the title's and the
 * summary line's numbers, which count the places. A number, never a row: which rows they are is not said.
 */
export async function countOutsideOnPublicStartList<T extends Record<string, unknown>>(
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
        eq(registrations.outsideCapacity, true),
      ),
    );
  return row?.count ?? 0;
}

/**
 * Everybody on the hidden list with a place outside the places (§647, amending §643): the confirmed
 * and the holds (a declaration to sign; an offer, which marking turns into one), real rows only,
 * ticked «Vreau să apar» or not. Two numbers, never a row: they enter «Cine vine» and «confirmați»
 * only where the event's «Numără și lista ascunsă» is on, and the table never gains a row for them —
 * an unticked runner on the hidden list is not even a «Participant (nume ascuns)» row (§643).
 */
export async function countHiddenListWithPlace<T extends Record<string, unknown>>(
  db: Database<T>,
  eventId: string,
): Promise<{ confirmed: number; held: number }> {
  const [row] = await db
    .select({
      confirmed: sql<number>`cast(count(*) filter (where ${registrations.status} = 'CONFIRMED') as int)`,
      held: sql<number>`cast(count(*) filter (where ${inArray(registrations.status, ["PENDING_DECLARATION", "WAITLIST_OFFERED"])}) as int)`,
    })
    .from(registrations)
    .where(
      and(
        eq(registrations.eventId, eventId),
        eq(registrations.kind, "REAL"),
        eq(registrations.outsideCapacity, true),
        inArray(registrations.status, ["CONFIRMED", "PENDING_DECLARATION", "WAITLIST_OFFERED"]),
      ),
    );
  return { confirmed: Number(row?.confirmed ?? 0), held: Number(row?.held ?? 0) };
}

/**
 * The rows the public list gains once the privacy notice in force describes the states
 * (`DECISIONS.md` §396, amending §32 and §143): the registered who have not confirmed yet, then
 * the waiting list.
 *
 * Only ever called behind that gate — `StartList` asks `cachedListStatesDisclosed` first — and
 * built so that the gate is the only thing it depends on:
 *
 *   - the two groups' states and nothing else (`public-list-states.ts`): `PENDING_DECLARATION`
 *     and `WAITLIST_OFFERED` as "pending", `WAITLISTED` as the waiting list. An unconfirmed
 *     address, a cancellation, an expiry are in no condition here, so no caller can publish one.
 *   - `REAL` only, in the SQL (§30, AGENTS.md §12.6), as the confirmed list.
 *   - ticked «Vreau să apar» only (§143): nobody unconfirmed is ever counted anonymously either —
 *     a count of who is still deciding is the disclosure §32 refused, and it stays refused for
 *     anybody who did not ask to be on the list.
 *   - the select list is the display name, the club and the **group** — never the lifecycle's
 *     own state, never a date, a position or an identifier. `tests/privacy/public-surface.test.ts`
 *     holds it there, as it holds `listPublicStartList`.
 *
 * Ordered by group, then as the queue orders each: the pending by when their address was
 * confirmed (the one rule the allocator hands places out by), the waiting list by
 * `waitlisted_at` — `lockOldestWaitlisted`'s own order — and `id` for a tie. The page prints no
 * position for either; the order is what a reader can see for themselves.
 */
export async function listPublicStartListOthers<T extends Record<string, unknown>>(
  db: Database<T>,
  eventId: string,
  /**
   * The first privacy notice that described the states (`findFirstStatesNoticeVersion`, §421):
   * only a registration that recorded it or a later one is listed here. A tick given under an
   * older notice agreed to a list of confirmed names, and that is where such a runner appears —
   * once confirmed, as before. Required, so no caller can forget it.
   */
  firstStatesNoticeVersion: number,
  /**
   * The event's «Lista de așteptare e publică» (§628, `events.waitlist_public`): false, and the
   * waiting list is in no condition here — not a row, not a count — so an event that keeps it
   * private never reads one. A narrowing on top of the notice's gates, never a way round them.
   * Required, like the version above, so no caller can forget it.
   */
  includeWaitlisted: boolean,
  page?: { offset: number; limit: number },
  /** Only behind the notice's gate (§500): see `publicSocialColumns`. */
  options: { socials?: boolean } = {},
): Promise<Array<PublicStartListRow & { group: "PENDING" | "WAITLISTED" }>> {
  const waiting = inArray(registrations.status, [...WAITLISTED_LIST_STATUSES]);
  const query = db
    .select({
      displayName: registrations.displayName,
      clubName: registrations.clubName,
      group: sql<"PENDING" | "WAITLISTED">`case when ${waiting} then 'WAITLISTED' else 'PENDING' end`,
      ...publicSocialColumns(options.socials),
    })
    .from(registrations)
    .where(
      and(
        eq(registrations.eventId, eventId),
        inArray(registrations.status, publicOtherStatuses(includeWaitlisted)),
        eq(registrations.kind, "REAL"),
        eq(registrations.listOptOut, false),
        gte(registrations.privacyNoticeVersion, firstStatesNoticeVersion),
      ),
    )
    .orderBy(
      sql`case when ${waiting} then 1 else 0 end`,
      sql`case when ${waiting} then ${registrations.waitlistedAt} else coalesce(${registrations.emailConfirmedAt}, ${registrations.submittedAt}) end`,
      asc(registrations.id),
    );
  const rows = await (page ? query.limit(page.limit).offset(page.offset) : query);
  // As `listPublicStartList`: the select is exactly these keys, the socials only when asked for.
  return rows as unknown as Array<PublicStartListRow & { group: "PENDING" | "WAITLISTED" }>;
}

/**
 * How many rows `listPublicStartListOthers` holds, in each group — the same conditions, so the
 * page count and the page cannot disagree (§250). Only the ticked ones: see above.
 */
export async function countPublicStartListOthers<T extends Record<string, unknown>>(
  db: Database<T>,
  eventId: string,
  /** As `listPublicStartListOthers` (§421): consent given under an older notice is not counted here. */
  firstStatesNoticeVersion: number,
  /** As `listPublicStartListOthers` (§628): false, and the waiting list is not counted either — `waitlisted` is 0. */
  includeWaitlisted: boolean,
): Promise<{ pending: number; waitlisted: number; outsidePending: number }> {
  const [row] = await db
    .select({
      pending: sql<number>`cast(count(*) filter (where ${inArray(registrations.status, [...PENDING_LIST_STATUSES])}) as int)`,
      waitlisted: sql<number>`cast(count(*) filter (where ${inArray(registrations.status, [...WAITLISTED_LIST_STATUSES])}) as int)`,
      // Of the pending, those seated outside the places (§643): rows of the table, out of its counted words.
      outsidePending: sql<number>`cast(count(*) filter (where ${inArray(registrations.status, [...PENDING_LIST_STATUSES])} and ${registrations.outsideCapacity}) as int)`,
    })
    .from(registrations)
    .where(
      and(
        eq(registrations.eventId, eventId),
        inArray(registrations.status, publicOtherStatuses(includeWaitlisted)),
        eq(registrations.kind, "REAL"),
        eq(registrations.listOptOut, false),
        gte(registrations.privacyNoticeVersion, firstStatesNoticeVersion),
      ),
    );
  return { pending: Number(row?.pending ?? 0), waitlisted: Number(row?.waitlisted ?? 0), outsidePending: Number(row?.outsidePending ?? 0) };
}

/**
 * The states the two queries above may read (§396): the pending always, the waiting list only for
 * an event whose «Lista de așteptare e publică» is on (§628). One list, so the page and its count
 * cannot disagree about who is in it.
 */
function publicOtherStatuses(includeWaitlisted: boolean): RegistrationStatus[] {
  return includeWaitlisted ? [...PENDING_LIST_STATUSES, ...WAITLISTED_LIST_STATUSES] : [...PENDING_LIST_STATUSES];
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
  /** A family's reserved places (§543): `domain/capacity.ts#OccupiedCounts.familyReservations`. */
  familyReservations: number;
  /** A family sitting's holds for forms that wrote no registration (§543): `domain/capacity.ts#OccupiedCounts.familyPlaceHolds`. */
  familyPlaceHolds: number;
  /** Live invitations holding a counted place (§647): `domain/capacity.ts#OccupiedCounts.invitationHolds`. */
  invitationHolds: number;
};

/**
 * The family sitting that holds this registration still has its one email queued (§543): held for
 * «Gata» or the club's window, or waiting for the outbox job's pass. Only a fact for the queue panel
 * («emailul familiei nu a plecat încă»): it keeps no place past the deadline (the review of
 * 2026-09-28, round three: the deadline is the sitting's, fixed by its first form, and nothing moves
 * it — not a form, not a press, not the email's send, not the job's lateness).
 */
export function familyEmailQueued(): SQL {
  return sql`exists (select 1 from family_sittings fs join ${emailOutbox} eo on fs.held_outbox_ids @> jsonb_build_array(eo.id::text) where fs.registration_ids @> jsonb_build_array(${registrations.id}::text) and fs.confirmed_at is null and eo.status in ('PENDING', 'PROCESSING'))`;
}

/**
 * A family's reservation that still holds its place (§543): a registration waiting for its address
 * whose deadline — the sitting's `reserved_until`, written on the row by its form — is ahead. A hard
 * ceiling: past it the place is free, whatever the family's email is doing.
 */
export function familyReservationHolds(now: Date): SQL {
  return sql`(${registrations.status} = 'PENDING_EMAIL_CONFIRMATION' and ${registrations.holdExpiresAt} is not null and ${registrations.holdExpiresAt} > ${now})`;
}

/**
 * Whether this registration holds a family's reservation right now (§543): its own place, counted in
 * `countOccupied`, which the allocator gives it when the address is confirmed rather than counting it
 * against itself. Read under the caller's event lock.
 */
export async function holdsFamilyReservation<T extends Record<string, unknown>>(db: Database<T>, registrationId: string, now: Date): Promise<boolean> {
  const [row] = await db
    .select({ id: registrations.id })
    .from(registrations)
    .where(and(eq(registrations.id, registrationId), familyReservationHolds(now)))
    .limit(1);
  return row !== undefined;
}

/**
 * A family's reservation written (§543): only on a registration still waiting for its address, under
 * the caller's event lock, after the allocator's own count said a place is free, until the sitting's
 * fixed deadline. Tells the public cache: one place fewer from now on (§333).
 */
export async function writeFamilyReservation<T extends Record<string, unknown>>(db: Database<T>, registrationId: string, until: Date, now: Date): Promise<boolean> {
  if (until.getTime() <= now.getTime()) return false;
  const rows = await db
    .update(registrations)
    .set({ holdExpiresAt: until, updatedAt: now })
    .where(and(eq(registrations.id, registrationId), eq(registrations.status, "PENDING_EMAIL_CONFIRMATION")))
    .returning({ id: registrations.id });
  if (rows.length > 0) revalidatePublicContent("places");
  return rows.length > 0;
}

/**
 * A family sitting's hold for a form that wrote no registration (§543; §39, AGENTS.md §19.4): one row
 * of `family_place_holds`, under the caller's event lock, after the allocator's own count said a place
 * is free, until the sitting's fixed deadline. One per `slot`: a replayed press adds nothing. The
 * sitting's record of a person sent while no place was free (`writeFamilyPlaceMarker`) becomes the
 * counted hold (round six). Returns whether the hold is there now (written, or already written by the
 * same slot).
 */
export async function writeFamilyPlaceHold<T extends Record<string, unknown>>(
  db: Database<T>,
  hold: { eventId: string; sittingKey: string; slot: string; until: Date },
  now: Date,
): Promise<boolean> {
  if (hold.until.getTime() <= now.getTime()) return false;
  const rows = await db
    .insert(familyPlaceHolds)
    .values({ eventId: hold.eventId, sittingKey: hold.sittingKey, slot: hold.slot, expiresAt: hold.until, holdsPlace: true, createdAt: now })
    .onConflictDoUpdate({
      target: [familyPlaceHolds.sittingKey, familyPlaceHolds.slot],
      set: { holdsPlace: true, expiresAt: hold.until },
      setWhere: eq(familyPlaceHolds.holdsPlace, false),
    })
    .returning({ id: familyPlaceHolds.id });
  if (rows.length > 0) {
    revalidatePublicContent("places");
    return true;
  }
  const [already] = await db
    .select({ id: familyPlaceHolds.id })
    .from(familyPlaceHolds)
    .where(
      and(eq(familyPlaceHolds.sittingKey, hold.sittingKey), eq(familyPlaceHolds.slot, hold.slot), eq(familyPlaceHolds.holdsPlace, true), gt(familyPlaceHolds.expiresAt, now)),
    )
    .limit(1);
  return already !== undefined;
}

/**
 * A person a family sitting sent while no place was free (§543, the review of 2026-09-28, round six;
 * §39, AGENTS.md §19.4): a row of `family_place_holds` that holds no place (`holds_place` false) and
 * counts in no capacity, until the sitting's fixed deadline. It is what a fresh address's waiting
 * registration is for the club's limit: the server's own record that this browser sent the person in
 * the sitting, so an address that holds people already is refused at the same form as a fresh one on a
 * full event too, and a replayed form for the person is refused for no address. One per `slot`; a
 * counted hold under the slot is left as it is. Nothing is revalidated: no place changed.
 */
export async function writeFamilyPlaceMarker<T extends Record<string, unknown>>(
  db: Database<T>,
  hold: { eventId: string; sittingKey: string; slot: string; until: Date },
  now: Date,
): Promise<void> {
  if (hold.until.getTime() <= now.getTime()) return;
  await db
    .insert(familyPlaceHolds)
    .values({ eventId: hold.eventId, sittingKey: hold.sittingKey, slot: hold.slot, expiresAt: hold.until, holdsPlace: false, createdAt: now })
    .onConflictDoNothing();
}

/**
 * Whether the event has any row of `family_place_holds`, live or lapsed, held or only sent (§543, round
 * six): an event without one — every single registration's — never keys the slot secret on allocation.
 */
export async function eventHasFamilyPlaceHolds<T extends Record<string, unknown>>(db: Database<T>, eventId: string): Promise<boolean> {
  const [row] = await db.select({ id: familyPlaceHolds.id }).from(familyPlaceHolds).where(eq(familyPlaceHolds.eventId, eventId)).limit(1);
  return row !== undefined;
}

/**
 * A sitting key's people still recorded (§543): how many, and until when (they share the sitting's
 * deadline) — its counted holds and, since round six, the people it sent while no place was free
 * (`writeFamilyPlaceMarker`), as a fresh address's waiting registrations count for the club's limit.
 */
export async function liveFamilyPlaceHolds<T extends Record<string, unknown>>(
  db: Database<T>,
  sittingKey: string,
  now: Date,
): Promise<{ count: number; until: Date | null }> {
  const [row] = await db
    .select({ count: sql<number>`count(*)::int`, until: sql<string | null>`max(${familyPlaceHolds.expiresAt})` })
    .from(familyPlaceHolds)
    .where(and(eq(familyPlaceHolds.sittingKey, sittingKey), gt(familyPlaceHolds.expiresAt, now)));
  return { count: Number(row?.count ?? 0), until: row?.until ? new Date(row.until) : null };
}

/**
 * A sitting's holds released (§543): the family's email was confirmed, and every person it names now
 * has a registration of their own, allocated like any other. Tells the public cache.
 */
export async function releaseFamilyPlaceHolds<T extends Record<string, unknown>>(db: Database<T>, sittingKey: string): Promise<number> {
  const gone = await db.delete(familyPlaceHolds).where(eq(familyPlaceHolds.sittingKey, sittingKey)).returning({ id: familyPlaceHolds.id });
  if (gone.length > 0) revalidatePublicContent("places");
  return gone.length;
}

/**
 * One person's held places released (§543): a kept form confirmed on its own, whose person now has a
 * registration allocated like any other. By the person's slot at the event (`familyPlaceSlot`), in
 * whichever sitting it was taken (the review of 2026-09-28, round five).
 */
export async function releaseFamilyPlaceHold<T extends Record<string, unknown>>(db: Database<T>, hold: { eventId: string; slot: string }): Promise<boolean> {
  const gone = await db
    .delete(familyPlaceHolds)
    .where(and(eq(familyPlaceHolds.eventId, hold.eventId), eq(familyPlaceHolds.slot, hold.slot)))
    .returning({ id: familyPlaceHolds.id });
  if (gone.length > 0) revalidatePublicContent("places");
  return gone.length > 0;
}

/** The count of an event's sitting holds still counted (§543), as a scalar subquery for `countOccupied`. */
function familyPlaceHoldsCount(eventId: string, now: Date): SQL<number> {
  return sql<number>`(select count(*)::int from ${familyPlaceHolds} where ${familyPlaceHolds.eventId} = ${eventId} and ${familyPlaceHolds.holdsPlace} and ${familyPlaceHolds.expiresAt} > ${now})`;
}

/**
 * A declaration hold whose clock has not started yet (§513): the message that starts it — the
 * participant's own `COMPLETE_DECLARATION`, marked `startsDeadline` by the allocation that wrote
 * the hold (`notifications/domain/deadline-rebase.ts#STARTS_DEADLINE`) — is still in the queue,
 * waiting for the scheduler's tick, a deferral or a retry (`PENDING`), or claimed and not yet out
 * (`PROCESSING`). Such a hold is not lapsed, whatever its stored deadline says: its send re-bases
 * the deadline by the time it waited, and a sweep that ran first — the night's hourly tick against
 * a thirty-minute hold, or any hold under the budget governor's floor (§447) — would have given the
 * place away before the runner had even been told they held it. A resend, a reminder or a club
 * copy carries no mark and keeps nothing; a message that failed for good is final, and the hold
 * lapses on its stored deadline as before.
 *
 * **The waiting-list offer the same (§520):** its `WAITLIST_SPOT_OFFER` starts its deadline too, and
 * an offer given at 23:05 under the hourly night tick would otherwise lapse — and pass to the next in
 * line — before its email left. While that email is queued the offer is not lapsed: it keeps
 * occupying its place (`countOccupied`), the sweep leaves it (`expireStaleHolds`), the job does not
 * wake for it (`findEventsNeedingMaintenance`), and the forecast does not foresee its lapse. Its send
 * re-bases the deadline from the send (`notifications/domain/deadline-rebase.ts`), which is what
 * makes keeping it safe: the place was never counted free, so nobody else can have been given it.
 *
 * One `EXISTS` on `email_outbox_registration_created_idx`, correlated on the registration row, and
 * read under whatever lock the caller holds — the sweep's event lock among them.
 */
export function awaitingItsFirstEmail(): SQL {
  return firstEmailQueued("COMPLETE_DECLARATION");
}

function firstEmailQueued(messageType: "COMPLETE_DECLARATION" | "WAITLIST_SPOT_OFFER", { untilStart = false }: { untilStart?: boolean } = {}): SQL {
  // `untilStart`: only «Trimite-i oferta»'s message, the offer capped by the start alone (§642).
  const staffChosen = untilStart ? sql` and (${emailOutbox.payloadJson} ->> ${OFFER_UNTIL_START}) = 'true'` : sql``;
  return sql`exists (select 1 from ${emailOutbox} where ${emailOutbox.registrationId} = ${registrations.id} and ${emailOutbox.messageType} = ${messageType} and ${emailOutbox.participantId} is not null and ${emailOutbox.status} in ('PENDING', 'PROCESSING') and (${emailOutbox.payloadJson} ->> ${STARTS_DEADLINE}) = 'true'${staffChosen})`;
}

/**
 * The offer's guard (§520): its `WAITLIST_SPOT_OFFER` still queued — and only while the send could
 * still move the deadline. An automatic offer never outlives the close or the start (`capHoldExpiry`),
 * so from that instant on its send re-bases nothing and keeping it would only delay a lapse that is
 * final: at the close it lapses and is handed to nobody (§420), as before. «Trimite-i oferta»'s offer
 * is capped by the start alone (§642, `OFFER_UNTIL_START` in its message), so its guard holds until
 * the start: made after the close, its send still moves its deadline.
 */
export function offerAwaitingItsFirstEmail(now: Date): SQL {
  return sql`(${firstEmailQueued("WAITLIST_SPOT_OFFER")} and exists (select 1 from ${events} where ${events.id} = ${registrations.eventId} and (${now} < least(coalesce(${events.registrationClosesAt}, ${events.startsAt}), ${events.startsAt}) or (${now} < ${events.startsAt} and ${firstEmailQueued("WAITLIST_SPOT_OFFER", { untilStart: true })}))))`;
}

/** Either hold whose first email is still queued (§520): the declaration hold's or the offer's own message. */
export function holdAwaitingItsFirstEmail(now: Date): SQL {
  return sql`((${registrations.status} = 'PENDING_DECLARATION' and ${awaitingItsFirstEmail()}) or (${registrations.status} = 'WAITLIST_OFFERED' and ${offerAwaitingItsFirstEmail(now)}))`;
}

/**
 * The counts `domain/capacity.ts#computeOccupied` needs, queried inside the locked transaction.
 *
 * A declaration hold occupies its place by status, deadline or no deadline: since `DECISIONS.md`
 * §160 a lapsed hold is kept — the place stays the person's until the event starts — unless
 * somebody is waiting for it, and it is `expireStaleHolds` that decides, never this count. An
 * offer is a promise to the queue and still occupies only while its deadline is ahead — or while
 * the email that starts that deadline is still queued (§520, `offerAwaitingItsFirstEmail`).
 *
 * **A registration «În afara locurilor» is in no bucket (§643, `AGENTS.md` §10.6):** an organizer, a
 * pacemaker, an invited runner the club seats outside the places consumes none, in any state — confirmed,
 * held, offered or reserved. The formula's one explicit exclusion, on that audited column alone; `kind`
 * stays in no condition (§30), so a `TEST` row is counted unless it too is marked outside.
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
      // An offer whose email is still queued occupies past its stored deadline (§520): its clock has not started.
      unexpiredWaitlistOfferedHolds: sql<number>`count(*) filter (where ${registrations.status} = 'WAITLIST_OFFERED' and (${registrations.holdExpiresAt} > ${now} or ${offerAwaitingItsFirstEmail(now)}))::int`,
      // Not a hold whose first email is still queued (§513): its clock has not started.
      lapsedDeclarationHolds: sql<number>`count(*) filter (where ${registrations.status} = 'PENDING_DECLARATION' and ${registrations.holdExpiresAt} <= ${now} and not ${awaitingItsFirstEmail()})::int`,
      // A family's reserved places (§543): the sitting's forms, before the address is confirmed.
      familyReservations: sql<number>`count(*) filter (where ${familyReservationHolds(now)})::int`,
      // …and the sitting's holds for forms that wrote no registration (§543), counted the same.
      familyPlaceHolds: familyPlaceHoldsCount(eventId, now),
      // …and the places the club keeps for the people it invited (§647), until each deadline.
      invitationHolds: invitationHoldsCount(eventId, now),
    })
    .from(registrations)
    // Outside the places (§643): counted in no bucket.
    .where(and(eq(registrations.eventId, eventId), eq(registrations.outsideCapacity, false)));

  // An aggregate without a grouping always answers one row; the fallback is the type's, never a read.
  return row ?? { confirmed: 0, pendingDeclarationHolds: 0, unexpiredWaitlistOfferedHolds: 0, lapsedDeclarationHolds: 0, familyReservations: 0, familyPlaceHolds: 0, invitationHolds: 0 };
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
        // A row outside the places (§643) changes no count when its deadline passes.
        eq(registrations.outsideCapacity, false),
        or(
          eq(registrations.status, "WAITLIST_OFFERED"),
          and(eq(registrations.status, "PENDING_DECLARATION"), isNotNull(events.waitlistCapacity)),
          // A family's reservation frees its place at its deadline (§543).
          and(eq(registrations.status, "PENDING_EMAIL_CONFIRMATION"), isNotNull(registrations.holdExpiresAt)),
        ),
      ),
    )
    // …and a family sitting's hold for a form that wrote no registration, at the same deadline (§543): one statement still (§489).
    // A person sent while no place was free holds none, so frees none (round six).
    .unionAll(
      db
        .select({ holdExpiresAt: familyPlaceHolds.expiresAt })
        .from(familyPlaceHolds)
        .where(and(eq(familyPlaceHolds.eventId, eventId), eq(familyPlaceHolds.holdsPlace, true))),
    )
    // …and an invitation's held place, at its deadline (§647): not one «În afara locurilor», which holds none.
    .unionAll(
      db
        .select({ holdExpiresAt: eventInvitations.expiresAt })
        .from(eventInvitations)
        .where(and(eq(eventInvitations.eventId, eventId), eq(eventInvitations.outsideCapacity, false), invitationOpen())),
    );
  return rows.flatMap((row) => (row.holdExpiresAt ? [new Date(row.holdExpiresAt)] : []));
}

export async function countEligibleWaitlisted<T extends Record<string, unknown>>(
  db: Database<T>,
  eventId: string,
): Promise<number> {
  const [row] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(registrations)
    // A row outside the places (§643) is never in the line; the condition only says so.
    .where(and(eq(registrations.eventId, eventId), eq(registrations.status, "WAITLISTED"), eq(registrations.outsideCapacity, false)));
  return row?.count ?? 0;
}

/** Whether a registration is seated outside the places (§643), read under the caller's event lock. */
export async function isOutsideCapacity<T extends Record<string, unknown>>(db: Database<T>, registrationId: string): Promise<boolean> {
  const [row] = await db.select({ outside: registrations.outsideCapacity }).from(registrations).where(eq(registrations.id, registrationId)).limit(1);
  return row?.outside ?? false;
}

/**
 * The real registrations of an event seated outside the places with a place outside them (§643):
 * confirmed, a declaration to sign, an offer — the editor's «în afara locurilor: N» beside the occupied
 * places, which leave them out. A display count, never the allocator's: a test row is in no number the
 * club is given (§12.6).
 */
export async function countOutsideCapacity<T extends Record<string, unknown>>(db: Database<T>, eventId: string): Promise<number> {
  const [row] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(registrations)
    .where(
      and(
        eq(registrations.eventId, eventId),
        eq(registrations.outsideCapacity, true),
        eq(registrations.kind, "REAL"),
        inArray(registrations.status, ["CONFIRMED", "PENDING_DECLARATION", "WAITLIST_OFFERED"]),
      ),
    );
  return row?.count ?? 0;
}

/**
 * «În afara locurilor» set or cleared (§643), under the caller's event lock, after the caller decided
 * the change is allowed. Only on a registration still active: an ended row's flag is read, never
 * changed. Tells the public cache — the counts move, the person's row does not.
 */
export async function writeOutsideCapacity<T extends Record<string, unknown>>(
  db: Database<T>,
  registrationId: string,
  outside: boolean,
  now: Date,
): Promise<Registration | undefined> {
  const [row] = await db
    .update(registrations)
    .set({ outsideCapacity: outside, updatedAt: now })
    .where(and(eq(registrations.id, registrationId), inArray(registrations.status, [...ACTIVE_REGISTRATION_STATUSES])))
    .returning();
  if (row) revalidatePublicContent("places");
  return row;
}

/**
 * When a `PENDING_EMAIL_CONFIRMATION` row's link lapses, as SQL (§377): the instant written on the
 * row when it entered the state, or — for a row written before the column existed — its
 * submission plus the club's hours in force. One expression, so the sweep below and the job's
 * plan (`jobs/next-work.ts`) cannot disagree about when a link lapses.
 */
export function emailLinkLapseSql(confirmationHours: number) {
  return sql<Date>`coalesce(${registrations.emailLinkExpiresAt}, ${registrations.submittedAt} + make_interval(hours => ${confirmationHours}))`;
}

/**
 * The address's other registrations at an event still waiting for the address (§588, amending §389,
 * §446 and §543): a verification link proves the inbox, not one person, so the click that confirms
 * one of them moves these on with it. Only rows submitted at or before the click (`now`) and whose
 * own link is still alive — a lapsed one is the sweep's (§377) — in the order they were submitted,
 * which is the order the allocator serves them in (§10.6: nobody leapfrogs). The caller holds the
 * event row's lock, so a form sent after the click is not here yet; the instant says so as well.
 */
export async function pendingEmailRegistrationsOnAddress<T extends Record<string, unknown>>(
  db: Database<T>,
  scope: { eventId: string; participantId: string; now: Date; confirmationHours: number },
): Promise<Registration[]> {
  return db
    .select()
    .from(registrations)
    .where(
      and(
        eq(registrations.eventId, scope.eventId),
        eq(registrations.participantId, scope.participantId),
        eq(registrations.status, "PENDING_EMAIL_CONFIRMATION"),
        lte(registrations.submittedAt, scope.now),
        gt(emailLinkLapseSql(scope.confirmationHours), scope.now),
      ),
    )
    .orderBy(asc(registrations.submittedAt), asc(registrations.createdAt), asc(registrations.id));
}

/**
 * Expire registrations still waiting on email confirmation once their link has lapsed — the
 * club's hours after the submission (48 unless changed, §377), as written on the row.
 *
 * Global, not per-event: `PENDING_EMAIL_CONFIRMATION` never occupies capacity (§10.6 rule 6),
 * so there is no allocation to serialize and no event-row lock to take — unlike
 * `expireStaleHolds`, which guards a decision about a place.
 */
export async function expireStalePendingEmailConfirmations<T extends Record<string, unknown>>(
  db: Database<T>,
  now: Date,
  deadlines: { confirmationHours: number },
): Promise<number> {
  const rows = await db
    .update(registrations)
    // A family's reservation goes with it (§543): an expired registration is counted nowhere.
    .set({ status: "EXPIRED", expiredAt: now, expiryReason: "EMAIL_CONFIRMATION_LAPSED", updatedAt: now })
    .where(
      and(
        eq(registrations.status, "PENDING_EMAIL_CONFIRMATION"),
        sql`${emailLinkLapseSql(deadlines.confirmationHours)} <= ${now.toISOString()}::timestamptz`,
      ),
    )
    .returning({ id: registrations.id, reserved: sql<boolean>`${registrations.holdExpiresAt} is not null` });
  // The list and the count read reservations (§543): tell the cache when one went with its row.
  if (rows.some((row) => row.reserved)) revalidatePublicContent("places");
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
 *
 * The same after registration has closed (§420). `fillAvailableSpots` then makes no offer — one
 * would be born lapsed — but the place a lapsed hold gives back is still wanted: the desk gives it
 * to somebody waiting (`promoteFromWaitlistByStaff`) or to the runner standing there with a paper
 * (`confirmByStaff`), both under the same lock and both after this sweep. Keeping the hold here
 * would leave them "the event is full" for a place nobody is holding. The guard against dead
 * offers lives in `fillAvailableSpots` alone.
 */
async function lapsedDeclarationHoldsToRelease<T extends Record<string, unknown>>(
  db: Database<T>,
  event: EventForExpiry,
  now: Date,
  wanting: number,
): Promise<string[]> {
  const over = event.eventStatus !== "SCHEDULED" || event.startsAt <= now;
  const lapsed = await db
    .select({ id: registrations.id })
    .from(registrations)
    .where(
      and(
        eq(registrations.eventId, event.id),
        eq(registrations.status, "PENDING_DECLARATION"),
        lte(registrations.holdExpiresAt, now),
        // A hold whose first email is still queued has not started (§513) — unless the race has.
        over ? undefined : not(awaitingItsFirstEmail()),
        // A hold outside the places (§643) holds no counted place, so releasing it gives nobody one:
        // it is kept until the start, like any hold nobody wants (§160).
        over ? undefined : eq(registrations.outsideCapacity, false),
      ),
    )
    .orderBy(asc(registrations.holdExpiresAt), asc(registrations.id));
  if (lapsed.length === 0) return [];

  if (over) return lapsed.map((row) => row.id);

  const waiting = (await countEligibleWaitlisted(db, event.id)) + wanting;
  if (waiting === 0) return [];
  const free =
    event.capacity === null
      ? Number.POSITIVE_INFINITY
      : Math.max(event.capacity - computeOccupied(await countOccupied(db, event.id, now)), 0);
  // Shared with the forecast (`notifications/domain/automatic-sends.ts` and `forecast.ts`), so
  // the page never promises a last call the job is about to release out from under it.
  const wanted = wantedLapsedHoldReleases({ lapsed: lapsed.length, waiting, free });
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
 *
 * A declaration hold released here queues its one «Locul tău … a expirat» (§638,
 * `hold-lapsed-email.ts`) in the same transaction — which is why this takes a `Transaction`: every
 * path that releases one comes through here, so every one of them tells the person. A lapsed offer
 * stays silent (§331).
 */
export async function expireStaleHolds<T extends Record<string, unknown>>(
  db: Transaction<T>,
  event: EventForExpiry,
  now: Date,
  { wanting = 0 }: { wanting?: number } = {},
): Promise<void> {
  // The offers first: each one released is a place the queue can have without touching a
  // kept declaration hold, and the count below must see it as free. Not an offer whose email is
  // still queued (§520) — unless the race has started or the event is no longer scheduled. An
  // Administrator never leaves an offer «În afara locurilor» (§643): marking an open offer makes it a
  // declaration hold in the same transaction (`setOutsideCapacityByStaff`), and the line never offers
  // an outside row. The one outside offer is one the door revived after its place was given (§NNN,
  // `door-shut.ts`): it lapses here at its moved deadline like any other, and frees no counted place.
  const over = event.eventStatus !== "SCHEDULED" || event.startsAt <= now;
  const lapsedOffers = await db
    .update(registrations)
    .set({ status: "EXPIRED", expiredAt: now, expiryReason: "WAITLIST_OFFER_LAPSED", updatedAt: now })
    .where(
      and(
        eq(registrations.eventId, event.id),
        eq(registrations.status, "WAITLIST_OFFERED"),
        lte(registrations.holdExpiresAt, now),
        over ? undefined : not(offerAwaitingItsFirstEmail(now)),
      ),
    )
    .returning({ id: registrations.id });

  /*
    A family's reservation past its deadline (§543), whatever its email is doing: the place goes back to the count
    — the registration itself stays, waiting for its address, and is allocated like any other when the
    address is confirmed. Cleared rather than left to lapse in the count alone, so the job does not
    find it again on every run (`findEventsNeedingMaintenance`).
  */
  const lapsedReservations = await db
    .update(registrations)
    .set({ holdExpiresAt: null, updatedAt: now })
    .where(
      and(
        eq(registrations.eventId, event.id),
        eq(registrations.status, "PENDING_EMAIL_CONFIRMATION"),
        lte(registrations.holdExpiresAt, now),
      ),
    )
    .returning({ id: registrations.id });
  // …and a family sitting's holds past the same deadline (§543): nobody's, so simply gone — a person sent while none was free too (round six).
  const lapsedPlaceHolds = await db
    .delete(familyPlaceHolds)
    .where(and(eq(familyPlaceHolds.eventId, event.id), lte(familyPlaceHolds.expiresAt, now)))
    .returning({ id: familyPlaceHolds.id, holdsPlace: familyPlaceHolds.holdsPlace });

  /*
    …and an invitation past its deadline (§647): stamped expired, its place free for the count below — the
    club's word to a named person ends at its deadline and not before (the club's choice, like a family's
    reservation: never released for somebody waiting while it runs).
  */
  const lapsedInvitations = await expireLapsedInvitations(db, event.id, now);

  const releasing = await lapsedDeclarationHoldsToRelease(db, event, now, wanting);
  if (releasing.length > 0) {
    const released = await db
      .update(registrations)
      .set({ status: "EXPIRED", expiredAt: now, expiryReason: "DECLARATION_HOLD_LAPSED", updatedAt: now })
      .where(and(eq(registrations.eventId, event.id), inArray(registrations.id, releasing)))
      .returning({
        id: registrations.id,
        participantId: registrations.participantId,
        locale: registrations.locale,
        holdExpiresAt: registrations.holdExpiresAt,
      });
    /*
      The person who held the place is told (§638), in this transaction, once per lapsed hold — but
      not when the race has started or the event is no longer scheduled (`over`): every hold goes
      then, nobody wanted the place, and there is nothing left to do about it. A cancelled event is
      quiet (§331), and a hold that lapses with the start is the end of the event's registration,
      not a place taken by somebody else.
    */
    if (!over) {
      await queueHoldLapsedEmails(db, {
        eventId: event.id,
        released,
        // Somebody in the line wanted it, rather than a newcomer the line had no room for (§348).
        toWaitlist: (await countEligibleWaitlisted(db, event.id)) > 0,
        now,
      });
    }
  }
  // A bulk sweep, beside `transitionRegistration` rather than through it, so it tells the public
  // cache itself (§333): the places these rows held are counted as free from now on.
  if (lapsedOffers.length > 0 || releasing.length > 0 || lapsedReservations.length > 0 || lapsedPlaceHolds.some((row) => row.holdsPlace) || lapsedInvitations > 0) revalidatePublicContent("places");
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
    // Never a row outside the places (§643): it is not in the line, so it is offered nothing.
    .where(and(eq(registrations.eventId, eventId), eq(registrations.status, "WAITLISTED"), eq(registrations.outsideCapacity, false)))
    .orderBy(asc(registrations.waitlistedAt), asc(registrations.id))
    .limit(limit)
    .for("update", { skipLocked: true });
}

/**
 * Every scheduled event with a registration the maintenance job (AGENTS.md §16.2) needs to
 * look at: an offer past its deadline, a lapsed declaration hold that somebody is waiting for
 * (§160 — with nobody waiting the hold is kept, and the job would lock the event to do
 * nothing, on every run until the race), a hold or waiting-list entry left open on an event
 * that has started, or numbers to settle — and, since §612, a free place on a capped event before
 * its close while somebody waits. Never a cancelled or completed event (§331, §82).
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
          // An offer whose email is still queued is not lapsed (§520) — until the close or the start.
          and(
            eq(registrations.status, "WAITLIST_OFFERED"),
            lte(registrations.holdExpiresAt, now),
            not(offerAwaitingItsFirstEmail(now)),
          ),
          // Not a hold outside the places (§643): the sweep would release nothing for it.
          and(
            eq(registrations.status, "PENDING_DECLARATION"),
            lte(registrations.holdExpiresAt, now),
            eq(registrations.outsideCapacity, false),
            somebodyWaits,
            not(awaitingItsFirstEmail()),
          ),
          // A family's reservation past its deadline, while somebody waits (§543): a hard ceiling.
          and(eq(registrations.status, "PENDING_EMAIL_CONFIRMATION"), lte(registrations.holdExpiresAt, now), somebodyWaits),
          // …and a family sitting's hold past it, on an event somebody waits for (§543).
          and(
            eq(registrations.status, "WAITLISTED"),
            sql`exists (select 1 from ${familyPlaceHolds} where ${familyPlaceHolds.eventId} = ${registrations.eventId} and ${familyPlaceHolds.holdsPlace} and ${familyPlaceHolds.expiresAt} <= ${now})`,
          ),
          and(inArray(registrations.status, ["PENDING_DECLARATION", "WAITLISTED"]), lte(events.startsAt, now)),
          // No clause for the registration close since §548: nothing is numbered then — a number
          // is drawn by each confirmation, under its own lock.
        ),
      ),
    );
  const due = new Set(rows.map((row) => row.eventId));
  // An invitation past its deadline (§647): the sweep stamps it and offers its place to the line.
  for (const eventId of await eventsWithLapsedInvitations(db, now)) due.add(eventId);

  /*
    A free place while somebody waits (§612, amending §104 and §587): a scheduled, capped event,
    before its close, with a `WAITLISTED` row and fewer places occupied than its capacity. Every
    clause above names a row whose deadline has passed; this one names the result — a place nobody
    holds and nobody was offered — whatever freed it: a family's reservation or held place that lapsed
    with no write (§543, cleared only by a sweep), or a place given back while the event was cancelled,
    when `fillAvailableSpots` offers nothing (§331), and found free once the race is put back on. Such
    an event goes through the same locked `fillAvailableSpots` as every other (`maintenance.ts`), which
    counts again under the lock and keeps every rule: no offer after the close, none on a cancelled
    event, never more offers than free places. Nothing is decided here; this only says where to look.

    The occupied count is the allocator's own (`countOccupied` → `computeOccupied`), read without the
    lock, never a second formula in SQL. **What it costs:** one read per scheduled capped event with
    somebody waiting, per run — on a full race with a waiting list, one `countOccupied` each run while
    the line stands; on every other event, nothing. `kind` is in no condition here (§30).

    Only an event that offers on its own (`waitlist_auto_offer`, §615): on one whose organizer hands
    out the places («Nu»), a free place while people wait is the organizer's to give and
    `fillAvailableSpots` would offer nothing — so the sweep does not select it, rather than locking it
    on every run to do nothing.
  */
  const waitedFor = await db
    .selectDistinct({ eventId: events.id, capacity: events.capacity })
    .from(events)
    .innerJoin(registrations, and(eq(registrations.eventId, events.id), eq(registrations.status, "WAITLISTED")))
    .where(
      and(
        sql`${events.eventStatus} = 'SCHEDULED'`,
        eq(events.waitlistAutoOffer, true),
        isNotNull(events.capacity),
        // Before the close — or the start, when there is no close or it is later (`capHoldExpiry`'s instant, §420).
        sql`${now} < least(coalesce(${events.registrationClosesAt}, ${events.startsAt}), ${events.startsAt})`,
      ),
    );
  for (const candidate of waitedFor) {
    if (due.has(candidate.eventId) || candidate.capacity === null) continue;
    const occupied = computeOccupied(await countOccupied(db, candidate.eventId, now));
    if (occupied < candidate.capacity) due.add(candidate.eventId);
  }
  return [...due];
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
    /** The SHA-256 of the exact text signed (§556, `acceptanceTextHash`), computed in the caller's transaction. */
    textHash: string | null;
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
    textHash: input.textHash,
  });
}
