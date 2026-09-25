import { eq } from "drizzle-orm";
import { type Participant, participants } from "@/db/schema/participants";
import type {
  Registration,
  RegistrationKind,
  RegistrationSource,
} from "@/db/schema/registrations";
import { events } from "@/db/schema/events";
import { registrations } from "@/db/schema/registrations";
import type { Database, Transaction } from "@/db/types";
import { registrationHasClosed, registrationState } from "@/modules/events/domain/registration-window";
import { recordAuditEvent } from "@/modules/audit/repository";
import { findCurrentApprovedDocument } from "@/modules/legal-documents/repository";
import { readClubNotices } from "@/modules/notifications/club-notices";
import { confirmationNoticeRecipients, resolveDeclarationCopies } from "@/modules/notifications/domain/club-notices";
import { enqueueEmail, type OutboxRow } from "@/modules/notifications/outbox";
import { ensureProvisionalBibNumber, pickBibNumber } from "./bibs";
import { asksForIdDocument, asksForMinorSignature } from "@/modules/legal-documents/domain/merge-fields";
import { newCheckinCode } from "./checkin-code";
import { canonicalizeEmail } from "@/modules/participants/domain/canonical-email";
import {
  findOrCreateParticipant,
  findParticipantByCanonicalEmail,
  markEmailVerified,
} from "@/modules/participants/repository";
import { emailBucketKey } from "@/modules/rate-limit/domain/key";
import { consumeRateLimit } from "@/modules/rate-limit/service";
import { currentDeadlines } from "@/modules/deadlines/deadlines";
import { type Deadlines, emailLinkExpiresAt, reminderHoursFor } from "@/modules/deadlines/domain/deadlines";
import { maintenanceDueFor } from "@/modules/jobs/schedule";
import { wakeJobs } from "@/modules/jobs/schedule-cache";
import { CLUB_TIME_ZONE } from "@/i18n/dates";
import { env } from "@/shared/config/env";
import { CLUB_NAME } from "@/theme/brand";
import { DomainError } from "@/shared/errors/domain-error";
import { computeOccupied, computePublicAvailability, hasDirectAvailability } from "./domain/capacity";
import { computeDeclarationHoldExpiry, computeWaitlistOfferExpiry, confirmationWindow } from "./domain/hold-deadlines";
import { occupiedForNewcomer, waitlistFullError, waitlistHasRoom, waitlistRoom } from "./domain/waitlist";
import { deriveAllowedResendMessageType } from "./domain/resend";
import { expectedSignatures, mismatchedSignatures } from "./domain/signature-name";
import { allowedFromStatuses, isActiveStatus } from "./domain/state-machine";
import { dayIn, MIN_PARTICIPANT_AGE } from "./domain/age";
import { DEFAULT_ADDRESS_CAP } from "./domain/address-cap";
import { ADDRESS_AT_CAP, ALREADY_ON_ADDRESS, ANOTHER_LINK_INVALID, decideSubmission } from "./domain/family";
import { registrationNameKey, sameRunner } from "./domain/name-key";
import { currentAddressCap } from "./address-cap";
import { familyRegistrationOpen } from "./family-gate";
import {
  anotherPersonFitnessRule,
  anotherPersonSubmissionSchema,
  declarationSigningSchema,
  isMinorOn,
  minimumAgeRule,
  registrationSubmissionSchema,
  staffRegistrationSubmissionSchema,
  withoutAnotherAdultsConsents,
} from "./fields";
import {
  composeLegalName,
  resolveDisplayName,
  type RegistrationEntryDetails,
} from "./names";
import * as repo from "./repository";

/**
 * The registration lifecycle (AGENTS.md §15.1-§15.7; BR-REQ-030/031/033/034/035/036).
 *
 * Priority-1 code, the same standing as `content/events/service.ts`. Every function is generic
 * over the caller's schema, for the same reason `content/events/service.ts` and
 * `modules/action-tokens/repository.ts` are: this module's transactions cross into
 * `notifications/outbox.ts` and `modules/legal-documents/repository.ts`, each with its own
 * fixed schema type, and one shared type parameter resolved at the outermost call is what lets
 * a single open transaction satisfy all of them — a locally fixed schema here would not
 * structurally match theirs.
 *
 * Two rules run through every exported function below:
 *
 *   1. Every capacity-changing decision runs inside one transaction that locks the `events`
 *      row first (`repo.lockEventForCapacity`) — the serialization point §10.6 requires — and
 *      re-evaluates hold expiry against `now` itself, never trusting that the maintenance job
 *      has run recently. Nothing here opens a second, nested transaction.
 *   2. No function here issues an email action token. A message that carries one is enqueued
 *      with no secret in its payload (`notifications/outbox.ts` explains why); the token is
 *      minted by the renderer at send time.
 */

/** Everything about the event that submission and allocation need beyond the public columns. */
export type EventForRegistration = {
  id: string;
  eventStatus: "SCHEDULED" | "CANCELLED" | "COMPLETED";
  registrationMode: "NONE" | "INTERNAL" | "EXTERNAL";
  startsAt: Date;
  registrationOpensAt: Date | null;
  registrationClosesAt: Date | null;
  capacity: number | null;
  raceId: string | null;
  publishedAt: Date | null;
  /** The participation window (§104); absent on a partial row means the club's declaration hold (§377). */
  confirmationOpensDaysBefore?: number | null;
  confirmationDeadlineDaysBefore?: number | null;
  /**
   * The event's own reminder lead (`events.reminder_hours_before`, §377), for when the job next
   * has work (§334) — null or absent is the club's number. It moves no place and no deadline.
   */
  reminderHoursBefore?: number | null;
  /**
   * The event's own zone (`events.timezone`), for the day the minimum age is counted against
   * (§321). Absent on a partial row means the column's default, `EVENT_TIMEZONE_DEFAULT`.
   */
  timezone?: string;
  /**
   * The event's own minimum age (`events.min_age`, §329), counted on that day at every door.
   * The three callers that submit read it off the row and pass it; absent on a partial row
   * means the column's default, `MIN_PARTICIPANT_AGE` — the same fourteen the column gives an
   * event nobody set a number on, so a fixture built without it counts what the row holds.
   */
  minAge?: number;
};

/** `events.timezone`'s column default: what a partial `EventForRegistration` is read in. */
const EVENT_TIMEZONE_DEFAULT = CLUB_TIME_ZONE;

/**
 * The event as the allocator must see it once the row is locked: the caller's row, with every
 * field a capacity decision rests on as it stands *now*.
 *
 * The caller read the event before the lock. A `capacity` raised in the editor (§147) in
 * between would otherwise waitlist a person against the old number while the new places stood
 * free until the allocator's next visit; and since §160 the `starts_at` and the
 * `event_status` decide whether a lapsed declaration hold is released at all, so a race
 * brought forward or called off between the read and the lock must not be decided against the
 * row the page happened to render.
 */
function withLockedRow(
  event: EventForRegistration,
  locked: {
    capacity: number | null;
    startsAt: Date;
    eventStatus: EventForRegistration["eventStatus"];
    waitlistCapacity: number | null;
  },
): LockedEventForRegistration {
  /*
    The waiting list's length (§348) is only ever read here, off the locked row, and never off
    the caller's: no caller passes it, so none can pass a stale one, and the type below is what
    makes `allocateOrWaitlist` refuse an event that did not come through this function.
  */
  return { ...event, capacity: locked.capacity, startsAt: locked.startsAt, eventStatus: locked.eventStatus, waitlistCapacity: locked.waitlistCapacity };
}

/** The event as `withLockedRow` hands it over: the caller's row, the lock's numbers. */
type LockedEventForRegistration = EventForRegistration & {
  /** `events.waitlist_capacity` as it stands under the lock (§348): null no limit, 0 no waiting list. */
  waitlistCapacity: number | null;
};

function assertRegistrationOpen(event: EventForRegistration, now: Date, atTheDesk = false): void {
  if (event.registrationMode !== "INTERNAL") {
    throw new DomainError("VALIDATION_ERROR", "this event does not accept local registration");
  }
  if (atTheDesk) {
    if (event.eventStatus !== "SCHEDULED") {
      throw new DomainError("VALIDATION_ERROR", `the event is ${event.eventStatus}`);
    }
    return;
  }
  const state = registrationState(
    {
      registrationMode: event.registrationMode,
      eventStatus: event.eventStatus,
      startsAt: event.startsAt,
      registrationOpensAt: event.registrationOpensAt,
      registrationClosesAt: event.registrationClosesAt,
      publishedAt: event.publishedAt,
    },
    now,
  );
  if (state !== "OPEN") {
    throw new DomainError("VALIDATION_ERROR", `registration is not open for this event (${state})`);
  }
}

/**
 * The **final** race number to write when a registration is confirmed (`DECISIONS.md` §214).
 *
 * §87 drew one here, at "the moment the place is certain". That is no longer the moment the
 * number is certain, and the two had been the same thing only because nothing existed earlier.
 * Now a place-holding registration carries a provisional number from submission, and the entry
 * list is still moving — people cancel, holds lapse, the waiting list advances — so a number
 * written at confirmation would be a number printed with gaps in it.
 *
 * So, while the window is open, confirmation writes **nothing**: the provisional number stands,
 * the runner keeps seeing it, and the recompaction at close turns the whole list into one dense
 * sequence and emails it. `REGISTRATION_CONFIRMED` therefore carries no number before the
 * close, which is the trade the owner chose: a number that is emailed is a number that cannot
 * move afterwards.
 *
 * **Once the window has shut it draws immediately**, because by then the sequence is settled
 * and a late confirmation — somebody signing on paper at the desk, a walk-in on race day —
 * needs a bib in their hand within the minute. `pickBibNumber` gives it the lowest free final
 * number, which is the one the recompaction has not used.
 */
async function finalBibAtConfirmation<T extends Record<string, unknown>>(
  tx: Database<T>,
  event: EventForRegistration,
  current: Registration,
  now: Date,
): Promise<{ bibNumber: number | null; provisionalBibNumber?: null }> {
  // Never renumber: a number already given is that runner's, whatever else changes (§173).
  if (current.bibNumber !== null) return { bibNumber: current.bibNumber };
  // A test registration wears none, as in the batch assignment (`AGENTS.md` §12.6).
  if (current.kind !== "REAL") return { bibNumber: null };
  if (!registrationHasClosed(event, now)) return { bibNumber: null };

  /*
    Past the close, the number becomes final — and it is **their own provisional one** where
    they have one (§220).

    Drawing a fresh one would be wrong twice over now that `pickBibNumber` treats a held
    provisional number as taken: it would skip the number this very runner is looking at and
    hand them a different one, leaving their old number reserved to nobody. Adopting it is
    also what the runner expects — the desk screen has been showing it to them.

    The provisional column is emptied in the same statement, so one runner is left holding
    exactly one number, which is the invariant the settle keeps too.
  */
  if (current.provisionalBibNumber !== null) {
    return { bibNumber: current.provisionalBibNumber, provisionalBibNumber: null };
  }
  return { bibNumber: await pickBibNumber(tx, current.eventId), provisionalBibNumber: null };
}

/**
 * Tell the maintenance job this change may have given it work sooner than it expects (§334).
 *
 * The one call every write path below makes once its transaction has committed. `deadlines` are
 * the holds and offers the change itself created; `maintenanceDueFor` adds the event's own
 * instants, and `wakeJobs` does nothing when all of them are further away than any quiet a run
 * can promise — which is the ordinary case: a race weeks away, a hold that lapses in days. A call
 * this file forgot costs the hour-long cap, never the work: every deadline here is also evaluated
 * on every read (§10.6).
 */
function wakeMaintenance(
  event: EventForRegistration,
  now: Date,
  settings: Deadlines,
  ...deadlines: (Date | null | undefined)[]
): void {
  // The event's own reminder lead, or the club's (§377): a partial row without the column reads as the club's.
  const dueAt = maintenanceDueFor({ ...event, reminderHours: reminderHoursFor(event, settings) }, now, ...deadlines);
  if (dueAt) wakeJobs("registration-maintenance", dueAt, now);
}

/**
 * The deadline of any waiting-list offer `fillAvailableSpots` may have made on the way — the
 * same arithmetic it uses, so a place freed an hour before the close wakes the job for an offer
 * that lapses at the close, and one freed a month ahead does not.
 */
function offerDeadline(event: EventForRegistration, now: Date, settings: Deadlines): Date {
  return computeWaitlistOfferExpiry({ now, registrationClosesAt: event.registrationClosesAt, eventStartsAt: event.startsAt, deadlines: settings });
}

/**
 * Whether an allocation ended on the waiting list — the one outcome in which `allocateOrWaitlist`
 * may have released somebody's lapsed hold and offered the place on (§160), so an offer's
 * deadline may exist that the registration itself does not carry.
 */
function joinedQueue(registration: Registration): boolean {
  return registration.status === "WAITLISTED";
}

async function deliveryEmailOf<T extends Record<string, unknown>>(
  db: Database<T>,
  participantId: string,
): Promise<string> {
  const [row] = await db
    .select({ deliveryEmail: participants.deliveryEmail })
    .from(participants)
    .where(eq(participants.id, participantId))
    .limit(1);
  if (!row) throw new DomainError("NOT_FOUND", "no such participant");
  return row.deliveryEmail;
}

/**
 * Allocate a place or add to the waiting list, for one registration already known to be past
 * email confirmation (AGENTS.md §15.2 steps 5-9, reused by the verified-restart path of §15.1
 * step 9 and by re-allocation in `signDeclaration`). The caller must already hold the
 * event-row lock.
 *
 * Returns the registration as it stands when the allocation is over: `PENDING_DECLARATION`
 * with a hold, `WAITLISTED`, or — when this registration is the first to wait behind a lapsed
 * hold that was being kept for want of a queue (§160) — `WAITLIST_OFFERED`, the offer email
 * already queued by `fillAvailableSpots`.
 *
 * **Refuses with `waitlistFullError`** when there is no place and the event's waiting list is
 * at its limit (§348) — nothing is written by the refusal, and the throw takes the caller's
 * whole transaction back with it, the token spend included, as `declarationChanged` does. The
 * count is the one taken just above for the place, under the same lock, so two registrations
 * racing for the last slot in the line are serialised like two racing for the last place, and
 * exactly one of them gets it (`tests/concurrency/capacity.test.ts`). Every door into the queue
 * comes through here — confirmation, restart, the desk, a late signature — so none needs its
 * own check.
 */
async function allocateOrWaitlist<T extends Record<string, unknown>>(
  db: Transaction<T>,
  event: LockedEventForRegistration,
  registrationId: string,
  now: Date,
  /** The club's deadlines (§377), read by the caller before its transaction: a new hold's length comes from here. */
  settings: Deadlines,
): Promise<Registration> {
  await repo.expireStaleHolds(db, event, now);
  await fillAvailableSpots(db, event, now, settings);

  const counts = await repo.countOccupied(db, event.id, now);
  const eligibleWaitlisted = await repo.countEligibleWaitlisted(db, event.id);
  let direct = hasDirectAvailability({ capacity: event.capacity, occupied: computeOccupied(counts), eligibleWaitlisted });

  // No place: this registration would join the line, and the line may be full (§348).
  if (
    !direct &&
    !waitlistHasRoom({ waitlistCapacity: event.waitlistCapacity, waitlisted: eligibleWaitlisted, openOffers: counts.unexpiredWaitlistOfferedHolds })
  ) {
    /*
      The line cannot take this registration, so this registration is itself somebody wanting a
      place who is not in the line (§160): one lapsed declaration hold goes for it, the oldest
      deadline first, under the same lock, and the place is its own — there is nobody `WAITLISTED`
      left to offer it to, or the expiry above would already have released that hold for them.
      Without it, on an event with no waiting list nobody could ever want a kept place, and a
      runner who never signed would hold it until the race while every newcomer was refused.
      With no lapsed hold there is nothing to release and the refusal stands; a refusal after a
      release takes the release back with it, like everything else in the transaction.
    */
    if (counts.lapsedDeclarationHolds > 0) {
      await repo.expireStaleHolds(db, event, now, { wanting: 1 });
      const after = await repo.countOccupied(db, event.id, now);
      direct = hasDirectAvailability({ capacity: event.capacity, occupied: computeOccupied(after), eligibleWaitlisted });
    }
    if (!direct) throw waitlistFullError(event.waitlistCapacity);
  }

  const updated = direct
    ? await repo.transitionRegistration(db, {
        id: registrationId,
        to: "PENDING_DECLARATION",
        changes: {
          holdExpiresAt: computeDeclarationHoldExpiry({
            now,
            registrationClosesAt: event.registrationClosesAt,
            eventStartsAt: event.startsAt,
            // A week-before confirmation for a race still far off (§104); the club's minutes otherwise (§377).
            window: confirmationWindow(event),
            deadlines: settings,
          }),
        },
        now,
      })
    : await repo.transitionRegistration(db, {
        id: registrationId,
        to: "WAITLISTED",
        changes: { waitlistedAt: now },
        now,
      });

  if (!updated) {
    throw new DomainError("CONFLICT", "this registration changed state concurrently");
  }

  // The queue has just grown by one (§160): a declaration hold past its deadline was kept
  // because the place was not wanted, and now one more person wants it. The same expiry and
  // the same allocator, once more under the same lock — one kept hold goes, the oldest
  // deadline first, and the place is offered to the front of the line, which is this
  // registration when it is alone there. Nothing is released when no hold has lapsed, so on
  // an event that is simply full this is one read and no write.
  if (updated.status === "WAITLISTED") {
    await fillAvailableSpots(db, event, now, settings);
    return (await repo.findRegistrationById(db, registrationId)) ?? updated;
  }

  /*
    The place is held, so the number is (§214). Under the lock the caller is holding, which is
    why it is safe here and would not be in the service's outer scope.

    Dani, on why this cannot wait for a confirmation: "procesul trebuie să fie automat… vor fi
    gratis, cu număr limitat de înscrieri… ce discuții și hate ne luăm dacă nu l-am înscris pe
    unul la timp și i-a luat altul locul". The place was already held from submission; what was
    missing was anything the runner or the club could *see*, and a number is that thing.
  */
  await ensureProvisionalBibNumber(db, { eventId: event.id, registrationId, now });
  return (await repo.findRegistrationById(db, registrationId)) ?? updated;
}

/**
 * The message an allocation's outcome earns (§15.2 step 10): the declaration to sign, or
 * "you are on the waiting list". An offer made on the way (§160) already queued its own.
 */
async function enqueueAllocationEmail<T extends Record<string, unknown>>(
  db: Transaction<T>,
  allocated: Registration,
  recipientEmail: string,
  idempotencyKey: string,
  now: Date,
): Promise<void> {
  const messageType =
    allocated.status === "WAITLISTED" ? "WAITLIST_JOINED" : allocated.status === "PENDING_DECLARATION" ? "COMPLETE_DECLARATION" : null;
  if (!messageType) return;
  await enqueueEmail(db, {
    participantId: allocated.participantId,
    registrationId: allocated.id,
    messageType,
    locale: allocated.locale,
    recipientEmail,
    payload: {},
    idempotencyKey,
    now,
  });
}

/**
 * Offer the released or newly available places to the front of the queue (AGENTS.md §15.6).
 *
 * Called from inside every transaction that might free or add capacity: confirmation,
 * cancellation, an offer's decline or expiry, and a capacity raised in the editor (§147). The
 * caller must already hold the event-row lock; this does not take it itself, so it composes
 * safely with `allocateOrWaitlist`, which calls it after locking once. Returns how many offers
 * it made — the editor's "locuri oferite listei de așteptare: N" — which every other caller
 * ignores.
 */
export async function fillAvailableSpots<T extends Record<string, unknown>>(
  db: Transaction<T>,
  event: EventForRegistration,
  now: Date,
  /**
   * The club's deadlines (§377), required: every caller reads them before its transaction and
   * passes them in — each path in this file, the editor's capacity raise before it locks the event,
   * and the maintenance job once per run through `readDeadlinesForRun`. Nothing is read here, so
   * no offer can be dated from a memo older than the caller's own reading.
   */
  settings: Deadlines,
): Promise<number> {
  /*
    A cancelled event's queue stands still (§331). Nobody is offered a place in a race that will
    not run — the offer's email would be a link that answers "cancelled" — and no hold is
    released either: the registrations keep their status as the record of who had entered, and
    a race that is put back on finds its queue where it left it. Every caller passes the row it
    read under the event lock, so the status here is the one a concurrent cancellation left.
  */
  if (event.eventStatus === "CANCELLED") return 0;
  await repo.expireStaleHolds(db, event, now);
  // A completed event is over: its lapsed holds go as before, and nobody is offered a place in it.
  if (event.eventStatus !== "SCHEDULED") return 0;

  // Nothing is ever waitlisted against an uncapped event, so an uncapped event has no queue to
  // fill — unless its cap was just lifted (§147), in which case everyone still waiting is
  // offered a place: the count is what bounds the loop, and it is zero on every other visit.
  const availablePlaces =
    event.capacity === null
      ? await repo.countEligibleWaitlisted(db, event.id)
      : Math.max(event.capacity - computeOccupied(await repo.countOccupied(db, event.id, now)), 0);
  if (availablePlaces <= 0) return 0;

  let offers = 0;
  const candidates = await repo.lockOldestWaitlisted(db, event.id, availablePlaces);
  if (candidates.length === 0) return 0;
  for (const candidate of candidates) {
    const holdExpiresAt = computeWaitlistOfferExpiry({
      now,
      registrationClosesAt: event.registrationClosesAt,
      eventStartsAt: event.startsAt,
      // The club's offer window (§377) at the moment the offer is made; an offer already out keeps its own.
      deadlines: settings,
    });

    const offered = await repo.transitionRegistration(db, {
      id: candidate.id,
      to: "WAITLIST_OFFERED",
      fromStatuses: ["WAITLISTED"],
      changes: { offerCreatedAt: now, holdExpiresAt },
      now,
    });
    if (!offered) continue;

    await enqueueEmail(db, {
      participantId: offered.participantId,
      registrationId: offered.id,
      messageType: "WAITLIST_SPOT_OFFER",
      locale: offered.locale,
      recipientEmail: await deliveryEmailOf(db, offered.participantId),
      payload: {},
      idempotencyKey: `registration:${offered.id}:waitlist-offered:${now.toISOString()}`,
      now,
    });
    offers += 1;
  }
  return offers;
}

// --- §10.6 The public free-place count ---------------------------------------------------------

/**
 * The places a new registrant could receive right now (BR-REQ-034-01).
 *
 * A read, and only a read: §10.6 says the public count "never mutates state", so this does not
 * expire a lapsed hold on the way past — `countOccupied` compares an offer's `hold_expires_at`
 * against `now` itself, and counts a declaration hold for as long as it stands, because a
 * lapsed one is kept until somebody waits for the place (§160): the count says "full" and the
 * door says "waiting list", and the person who joins it is offered that place at once. It
 * takes no lock for the same reason: nothing is being decided here, and a page that blocked
 * behind a confirmation's row lock would be slower for no gain in truth. The number can be one
 * place stale the instant it is rendered, and the allocator is what actually holds the guarantee.
 *
 * This is the same formula the allocator uses, called from the same module, because a second
 * one written for the page is how a site ends up advertising a place that does not exist.
 * `kind` appears in neither: a `TEST` registration occupies a place exactly like a real one, so
 * the count a visitor reads is the count they can actually get (AGENTS.md §12.6).
 */
export async function readPublicAvailability<T extends Record<string, unknown>>(
  db: Database<T>,
  event: { id: string; capacity: number | null },
  now: Date,
): Promise<number | null> {
  return (await readPublicPlaces(db, { ...event, waitlistCapacity: null }, now)).availablePlaces;
}

/** What the event page says about places (§348): the free ones, and the room left in the line. */
export type PublicPlaces = {
  /** `readPublicAvailability`'s number: null for an uncapped event. */
  availablePlaces: number | null;
  /**
   * How many more the waiting list takes (`domain/waitlist.ts#waitlistRoom`), or null when it has
   * no limit — and always null for an uncapped event, which never waitlists anybody.
   */
  waitlistRoom: number | null;
};

/**
 * `readPublicAvailability` and the waiting list's room, from the same two counts (§348).
 *
 * The same read, with the same guarantees and the same absence of a lock: nothing is decided
 * here. A "Mai sunt 3 locuri pe lista de așteptare" can be one slot stale the instant it renders;
 * the allocator counts again, under the lock, when somebody actually joins.
 *
 * When the line has no room, a declaration hold past its deadline is counted as the free place
 * it is for the next newcomer (`occupiedForNewcomer`, §160): the allocator releases one for them
 * rather than refusing, so the page offers the button rather than "full". Where the line has
 * room — and always without a limit — the count is exactly `readPublicAvailability`'s.
 */
export async function readPublicPlaces<T extends Record<string, unknown>>(
  db: Database<T>,
  event: { id: string; capacity: number | null; waitlistCapacity: number | null },
  now: Date,
): Promise<PublicPlaces> {
  if (event.capacity === null) return { availablePlaces: null, waitlistRoom: null };

  const counts = await repo.countOccupied(db, event.id, now);
  const eligibleWaitlisted = await repo.countEligibleWaitlisted(db, event.id);
  const line = { waitlistCapacity: event.waitlistCapacity, waitlisted: eligibleWaitlisted, openOffers: counts.unexpiredWaitlistOfferedHolds };
  return {
    availablePlaces: computePublicAvailability({
      capacity: event.capacity,
      occupied: occupiedForNewcomer({ ...line, occupied: computeOccupied(counts), lapsedDeclarationHolds: counts.lapsedDeclarationHolds }),
      eligibleWaitlisted,
    }),
    waitlistRoom: waitlistRoom(line),
  };
}

/**
 * The door's own answer when the places and the waiting list are both full (§348), before a
 * registration is written at all.
 *
 * Not the decision: a submission takes no place and no slot in the line — the address is still
 * to be confirmed — and the allocator counts again under the lock when it is
 * (`allocateOrWaitlist`). This is what spares a person a verification email for a registration
 * that would be refused the moment they clicked it, and it is the sentence the form answers with
 * while the event page already says the same thing and offers no button.
 *
 * Asked of the event row as it stands, read here, not of the caller's copy — no caller has to
 * remember to pass the limit. And asked **before anything is known about who is submitting**:
 * the answer depends on the event alone, so it cannot say whether an address is registered
 * already (the oracle `AGENTS.md` §19.4 refuses). Two cheap reads when the event has a limit;
 * one, and nothing counted, when it has none.
 *
 * A lapsed declaration hold is a place here when the line is full (`occupiedForNewcomer`, §160),
 * because the allocator gives it to the newcomer rather than refusing them.
 */
async function assertWaitlistCanTakeOneMore<T extends Record<string, unknown>>(
  db: Database<T>,
  eventId: string,
  now: Date,
): Promise<void> {
  const row = await repo.findEventForAllocation(db, eventId);
  if (!row || row.capacity === null || row.waitlistCapacity === null) return;
  const counts = await repo.countOccupied(db, eventId, now);
  const waitlisted = await repo.countEligibleWaitlisted(db, eventId);
  const line = { waitlistCapacity: row.waitlistCapacity, waitlisted, openOffers: counts.unexpiredWaitlistOfferedHolds };
  if (waitlistHasRoom(line)) return;
  const occupied = occupiedForNewcomer({ ...line, occupied: computeOccupied(counts), lapsedDeclarationHolds: counts.lapsedDeclarationHolds });
  if (hasDirectAvailability({ capacity: row.capacity, occupied, eligibleWaitlisted: waitlisted })) return;
  throw waitlistFullError(row.waitlistCapacity);
}

// --- Spam defenses (AGENTS.md §19.4, WEEKEND.md) ---------------------------------------------

/**
 * Below this, a submission is treated as automated (§217).
 *
 * **One second, not three.** The owner, after the second person it cost: "so the anti-spam/bot
 * verification must be way more loose." The asymmetry is the argument — a lost registration is
 * the thing this site exists to prevent, and a spam registration is a row an Administrator
 * deletes in two seconds. Three seconds is well inside what a person with autofill, a saved
 * card of details, or a fast connection takes; one second is not reachable by hand and is still
 * the entire benefit, because a script that waits it out has been slowed exactly as much.
 *
 * The real bot defences on this form are the honeypot, Turnstile (§97, §216) and the
 * per-identity throttle (§19.4). This is the cheapest of the four and the only one that has
 * ever refused a real person.
 */
const MIN_SUBMISSION_SECONDS = 1;

/**
 * What the two public-form defences actually found (§194).
 *
 * They used to answer one question — "is this a bot" — and both answers were discarded in the
 * same silence. That cost a real participant: somebody registered on QA, saw "we have sent you a
 * confirmation link", and afterwards no registration, no outbox row and no log line existed
 * anywhere. Nothing recorded which check had fired, so nothing could be diagnosed; the only way
 * to find it was to read the code and eliminate every other path.
 *
 * They are still separated, because they are not equally certain and the **log** should say
 * which fired:
 *
 * - `trap` — the hidden field was filled. Almost always a machine; rarely a password manager
 *   or an accessibility tool that does not know the field is hidden.
 * - `too-fast` — the form was posted less than three seconds after it was rendered, or arrived
 *   with no render time at all. That is a *guess*, and a wrong guess about a person who typed
 *   quickly, used autofill, or came back to a cached page.
 *
 * **Neither is answered with silence** (§217). They produce the same refusal with the same
 * marker, so the caller — and therefore a script — cannot tell them apart, while the person
 * always gets a sentence and their answers back instead of a promise of an email nobody sent.
 */
export type SubmissionVerdict = "ok" | "trap" | "too-fast" | "autofill";

export function classifySubmission(
  input: { honeypot?: string; renderedAt?: string; email?: string; firstName?: string; lastName?: string },
  now: Date,
): SubmissionVerdict {
  const trap = (input.honeypot ?? "").trim();
  if (trap !== "") {
    /*
      A trap holding the person's **own** details is a password manager, not a bot (§282).

      The owner, 2026-09-22: "we need to test with auto-fill properly … I also want to give real
      people the option to fix it." A browser that autofills a form fills what it believes are
      the name and address fields, and an offscreen input is still an input — so what lands in
      the trap is that person's name or address, spelled exactly as they typed it above. A bot
      has no reason to put the submitted address in a field the form never showed; it puts a
      link, a keyword, or a random string.

      So the value is compared with what was submitted, and a match is reported as `autofill`,
      which the caller does not refuse. Anything else is still `trap`.
    */
    const own = [input.email, input.firstName, input.lastName]
      .filter((value): value is string => typeof value === "string" && value.trim() !== "")
      .map((value) => value.trim().toLowerCase());
    return own.includes(trap.toLowerCase()) ? "autofill" : "trap";
  }
  /*
    A missing or unparseable render time is **not** suspicious any more (§217).

    It used to be treated as a bot, on the reasoning that a submission which lost its timestamp
    had probably been assembled by something other than the form. In practice the things that
    lose it are a page restored from the back-forward cache, a browser extension that rewrites
    the DOM, a proxy that strips a hidden field, and a form posted from a tab open since
    yesterday — all of them people. There is nothing to time, so there is nothing to judge, and
    the honeypot and Turnstile are still in front of this.
  */
  const renderedAt = new Date(input.renderedAt ?? "");
  if (Number.isNaN(renderedAt.getTime())) return "ok";
  return now.getTime() - renderedAt.getTime() < MIN_SUBMISSION_SECONDS * 1000 ? "too-fast" : "ok";
}

/** Shared with the contact and interest forms (§146, §149), which keep the older, single answer. */
export function looksLikeSpam(input: { honeypot?: string; renderedAt?: string }, now: Date): boolean {
  const verdict = classifySubmission(input, now);
  return verdict !== "ok" && verdict !== "autofill";
}

/**
 * Whether a submission this form suspects is actually refused (§282).
 *
 * The suspicion and the consequence are separated because they answer different questions, and
 * only the second one can lose the club an entrant:
 *
 * - **Cloudflare outranks the hidden field.** Turnstile looked at this browser and passed it;
 *   the trap is a guess, and a guess does not overrule a measurement. A bot that can pass
 *   Turnstile was never going to be stopped by an offscreen input.
 * - **A second attempt is let through.** Somebody refused once is now a person who has been
 *   told they looked automated and has pressed the button again. If their browser refills the
 *   trap every time — which is exactly what a password manager does — refusing again would
 *   loop them forever, and the form's whole purpose is to take their entry.
 * - **Otherwise the verdict stands**, which is what still refuses a script that posts once with
 *   no token and a filled trap.
 */
export function refusesSubmission(input: {
  verdict: SubmissionVerdict;
  /** The hidden field's own switch (§282). Off, it suspects nothing. */
  honeypotOn?: boolean;
  /** What Cloudflare said, when it was asked at all. */
  turnstile: "passed" | "failed" | "unavailable" | "not_configured";
  /** This is the try after a refusal. */
  secondAttempt: boolean;
}): boolean {
  if (input.verdict === "ok" || input.verdict === "autofill") return false;
  // Switched off in the backoffice: the field is still rendered and still logged, and it stops
  // refusing anybody (§282). The timing guess and Turnstile are untouched by this switch.
  if (input.verdict === "trap" && input.honeypotOn === false) return false;
  /*
    A token Cloudflare **looked at and rejected** ends it, and no second press undoes that
    (§282; the owner: "nu vreau ca oamenii sa ajunga la ecranul asta si sa fi fost roboti").

    The escape below exists for a person the two guesses caught by accident. It must not become
    a way past the one check that actually measured this browser — otherwise a script posts
    twice and reaches the "check your email" screen, which costs the club a message out of a
    Mailgun allowance that is sixteen registrations a day on the free plan (§100).

    In practice the action refuses a failed token before this is reached; the rule is stated
    here as well because this function is where the decision is written down.
  */
  if (input.turnstile === "failed") return true;
  if (input.turnstile === "passed") return false;
  return !input.secondAttempt;
}

// --- §15.1 Registration submission ------------------------------------------------------------

export type SubmitRegistrationResult = { ok: true };

/**
 * How this submission arrived: the public form, or an organizer entering it for somebody
 * (BR-REQ-037-05, `DECISIONS.md` §33).
 *
 * It changes two things and no others: the spam defenses below, which have nothing to time or
 * to hide a honeypot in when a member of staff types the form; and the two columns that record
 * who put the row there. Every rule about places, order and consent is identical, which is the
 * whole point — a staff-entered registration is that person's registration, and the queue must
 * not be able to tell the difference.
 */
export type RegistrationOrigin = {
  source: RegistrationSource;
  createdByStaffUserId?: string | null;
  /**
   * The desk on race morning (BR-REQ-037-07): the window the public saw is closed, and the
   * person is standing there. Staff only — a public submission can never set it — and it
   * skips the window alone: the mode must still be INTERNAL, the event must still be
   * SCHEDULED, and the capacity lock is exactly the same.
   */
  atTheDesk?: boolean;
  /**
   * What the public form already learned before calling (§282): Cloudflare's verdict, and
   * whether this is the try after a refusal. Both are the caller's to know — the token is
   * verified in the action, over the network, and the attempt is a field on the form — and
   * both are ignored for a staff submission, which has no widget and no hidden field.
   */
  turnstile?: "passed" | "failed" | "unavailable" | "not_configured";
  secondAttempt?: boolean;
  /** Whether the club has the hidden field switched on (§282). */
  honeypotOn?: boolean;
  /**
   * This public submission came through the link emailed to an address that is already registered
   * at the event (§389, `REGISTER_ANOTHER_PERSON`): the form for another person on that address.
   * The caller has spent the token in the same transaction and names the participant it was issued
   * to; the address is that participant's, never one typed into the form. It changes three things:
   * the per-identity throttle is not spent (the token's own throttle bounds this door, §39); the
   * decision is the link's (`domain/family.ts`) — create, or refuse out loud, behind the token —
   * and the registrations-per-address limit is enforced here, under the event's lock.
   */
  anotherPerson?: { participantId: string };
};

const PUBLIC_ORIGIN: RegistrationOrigin = { source: "PUBLIC", createdByStaffUserId: null };

/** The queued row, or null when the idempotency key had already been used (`enqueueEmail`). */
async function enqueueVerificationEmail<T extends Record<string, unknown>>(
  db: Transaction<T>,
  participant: Participant,
  registration: Registration,
  now: Date,
): Promise<OutboxRow | null> {
  return enqueueEmail(db, {
    participantId: participant.id,
    registrationId: registration.id,
    messageType: "VERIFY_REGISTRATION_EMAIL",
    locale: registration.locale,
    recipientEmail: participant.deliveryEmail,
    payload: {},
    idempotencyKey: `registration:${registration.id}:verify-requested:${now.toISOString()}`,
    now,
  });
}

/**
 * "Send me that link again" — §19.4's second surface, the one its table listed as specified
 * and not built.
 *
 * The participant has an address and a problem: nothing arrived, or it arrived and was
 * deleted. Until now the only way back was to fill the whole registration form again, which
 * `submitRegistration` quietly treats as a resend for one status — and which is unreachable
 * once the registration window closes, even though a declaration hold outlives it.
 *
 * Three properties this function must keep, in order of how badly each fails:
 *
 * 1. **It answers identically whatever it finds.** A form that accepts an address nobody has
 *    proven they own is a membership oracle if it ever says "no such registration". So it
 *    returns nothing at all: not found, not active, nothing to resend, throttled — one answer,
 *    the same one, matching §15.1's generic response and §13.2's single invalid-or-expired.
 * 2. **It sends only what the current status allows**, via the same
 *    `deriveAllowedResendMessageType` the Administrator resend uses (§15.8). A participant
 *    cannot conjure a declaration link for a registration that is merely waitlisted, because
 *    nothing is waiting on them.
 * 3. **It never changes state.** No transition, no hold extension, no new token here — the
 *    token is minted by the renderer at send time, as it is for every other message (§14.5).
 */
export async function requestRegistrationLink<T extends Record<string, unknown>>(
  db: Database<T>,
  input: { email: string; eventId?: string },
  now: Date,
): Promise<void> {
  let identity;
  try {
    identity = canonicalizeEmail(input.email);
  } catch {
    // A malformed address is not a registration either, and saying so differently would be a
    // second answer. The form's own `type="email"` catches the honest typo before this.
    return;
  }

  // Counted before anything is looked up, so a script cannot use the lookup itself as the
  // signal, and counted even when refused (`consumeRateLimit`).
  // Hashed (§322): the bucket needs equality, not the address.
  const verdict = await consumeRateLimit(db, "link-request", emailBucketKey("link-request", identity.canonicalEmail), now);
  if (!verdict.allowed) return;

  const participant = await findParticipantByCanonicalEmail(db, identity.canonicalEmail);
  if (!participant) return;

  /*
    Every runner the address holds at the event, each with their own link (§389): a family's
    inbox asking "send it again" gets one message per person still owing a step, never only the
    first one's. Asked without an event, the newest active registration, as before.
  */
  const candidates = input.eventId
    ? await repo.findRegistrationsByEventAndParticipant(db, input.eventId, participant.id)
    : [await repo.findLatestActiveRegistrationForParticipant(db, participant.id)];
  const active = candidates.filter((row): row is Registration => row !== undefined && isActiveStatus(row.status));
  if (active.length === 0) return;
  // A cancelled event hands out no link (§331): each would open onto "this event is cancelled",
  // and its participants were told so in a message of its own. The same silent answer as above.
  // Asked without an event, the lookup has already passed over cancelled ones, so a runner with
  // another race still gets that one's link rather than nothing.
  if (input.eventId) {
    const event = await repo.findEventForAllocation(db, input.eventId);
    if (!event || event.eventStatus === "CANCELLED") return;
  }

  const sends = active
    .map((registration) => ({ registration, messageType: deriveAllowedResendMessageType(registration.status) }))
    .filter((send): send is { registration: Registration; messageType: NonNullable<typeof send.messageType> } => send.messageType !== null);
  if (sends.length === 0) return;

  await db.transaction(async (tx) => {
    for (const { registration, messageType } of sends) {
      await enqueueEmail(tx, {
        participantId: participant.id,
        registrationId: registration.id,
        messageType,
        // The registration's language, not the language of the page they asked from: the row
        // records what they chose when they registered, and that is the one they read.
        locale: registration.locale,
        recipientEmail: participant.deliveryEmail,
        payload: {},
        // Per request, so two genuine asks an hour apart are two messages — the throttle above
        // is what bounds them, not a key collision that would silently swallow the second.
        idempotencyKey: `registration:${registration.id}:link-requested:${now.toISOString()}`,
        now,
      });
    }
  });
}

/**
 * BR-REQ-030-01, BR-REQ-031-01, BR-REQ-033-01 criterion 1. Always answers the same generic
 * success (BR-REQ-031-01 criterion 3): a validation error surfaces only for the form being
 * malformed, never for what the submitted address turns out to mean.
 */
export async function submitRegistration<T extends Record<string, unknown>>(
  db: Database<T>,
  event: EventForRegistration,
  rawInput: unknown,
  now: Date,
  /**
   * `TEST` only ever arrives from `test-registrations.ts`, which is Administrator-only and
   * refused in production. It changes nothing below this line: the same allocator, the same
   * holds, the same queue — that is the entire point of it (AGENTS.md §12.6, `DECISIONS.md`
   * §30). It is carried into the row so the export can leave it out and every list can label it.
   */
  kind: RegistrationKind = "REAL",
  origin: RegistrationOrigin = PUBLIC_ORIGIN,
): Promise<SubmitRegistrationResult> {
  const atTheDesk = origin.source === "STAFF" && origin.atTheDesk === true;
  assertRegistrationOpen(event, now, atTheDesk);

  /**
   * Which details are insisted on depends on who is filling the form in, and on nothing
   * else (BR-REQ-031-04 criterion 5).
   *
   * A person entering their own registration answers every question. An organizer writing
   * down what somebody said on the telephone may not have been told a date of birth, and
   * refusing the row would lose the registration rather than improve the record. `kind` is
   * deliberately not consulted here: a TEST row carries a full set of synthetic details and
   * goes through exactly the path a real one does (AGENTS.md §12.6).
   */
  /*
    …and one rule is added here for every caller alike: the event's own minimum age on the day
    of the event (§321; the number is the event's since §329, fourteen unless set otherwise).

    Here because this is the first line that knows the event, and the one door every
    registration passes — the public form, a staff entry and the desk's walk-in behind it, a
    restart of a cancelled row further down, and a TEST row, which must be refused exactly as a
    real one would (AGENTS.md §12.6). Checked with the rest of the schema rather than after it,
    so a refusal names every field at once instead of one per round trip, and before anything
    is written or the throttle is spent: a refused birth date leaves no trace but the refusal.
  */
  const eventDay = dayIn(event.startsAt, event.timezone ?? EVENT_TIMEZONE_DEFAULT);
  const baseSchema = (
    origin.source === "STAFF"
      ? staffRegistrationSubmissionSchema
      : origin.anotherPerson
        ? anotherPersonSubmissionSchema
        : registrationSubmissionSchema
  ).superRefine(minimumAgeRule(eventDay, event.minAge ?? MIN_PARTICIPANT_AGE));
  // Adult-or-minor decided from this same `now`, the instant `withoutAnotherAdultsConsents` below
  // decides it from as well (finding (9) of the fix round on `feat/registration-consent-and-terms`).
  const schema = origin.anotherPerson ? baseSchema.superRefine(anotherPersonFitnessRule(now)) : baseSchema;
  /*
    Another adult on the address (§389, §NNN): the consents only that adult can give — the health
    note, the socials, the public list, the first-person fitness statement — are dropped whatever
    was posted, before anything reads them. A minor's parent still consents for the child.
  */
  const parsed = schema.safeParse(origin.anotherPerson ? withoutAnotherAdultsConsents(rawInput, now) : rawInput);
  if (!parsed.success) {
    throw new DomainError(
      "VALIDATION_ERROR",
      parsed.error.issues.map((issue) => `${issue.path.join(".")}: ${issue.message}`).join("; "),
      // Paths only. The messages above are for logs; these reach a rendered page.
      [...new Set(parsed.error.issues.map((issue) => issue.path.join(".")))],
    );
  }
  const input = parsed.data;

  // Only the public form is defended this way. A staff-entered registration has no rendered
  // page behind it to have timed and no hidden field for a bot to fill, and the person typing
  // it has already been authenticated and authorized as an Administrator.
  if (origin.source === "PUBLIC") {
    const verdict = classifySubmission(input, now);
    /*
      Neither defence is answered with silence any more (§217, amending §194 and
      BR-REQ-031-01 criterion 3).

      The owner: "people need to know that they were identified as bots! it's very bad for a
      user to tell him he is waiting for an email but he never receives it!" He is right, and
      the rule is worth stating as an invariant rather than as a fix: **nothing may show the
      "check your email" screen unless a message was actually queued.** Telling somebody to
      wait for an email that was never sent is the worst answer this form can give — they wait,
      they give up, and the club never learns they tried.

      §194 kept the trap silent because a distinct error tells a script what to stop doing.
      That argument is sound and it is outweighed. A hidden field is filled by machines and
      *also*, rarely, by a password manager or an accessibility tool that does not know it is
      hidden — and that person was being told a lie with no way out of it. What a bot learns
      from the refusal is only "refused": both verdicts throw the **same** error with the same
      marker, so nothing says which check fired, and a script still has to wait out the timer
      either way. That is the whole of what a timing check ever bought.

      Both are logged with the verdict — the event and nothing about the person (§14.5) — so
      the club can see how often this happens without a database query, which is what made the
      last silent drop so expensive to find.
    */
    const refused = refusesSubmission({
      verdict,
      turnstile: origin.turnstile ?? "not_configured",
      secondAttempt: origin.secondAttempt === true,
      honeypotOn: origin.honeypotOn !== false,
    });
    if (refused) {
      console.warn(`[registration] refused as automated: ${verdict}, event ${event.id}`);
      throw new DomainError("VALIDATION_ERROR", `the submission looked automated (${verdict})`, [
        "tooFast",
      ]);
    }
    if (verdict !== "ok") {
      // Suspected and taken anyway — logged, because how often this happens is the only way to
      // tell a password manager filling the trap from a defence that has stopped working (§282).
      console.warn(
        `[registration] accepted despite ${verdict}: turnstile ${origin.turnstile ?? "not_configured"}, second attempt ${origin.secondAttempt === true}, event ${event.id}`,
      );
    }
  }

  /*
    The places and the waiting list both full (§348): refused here, at every door alike — the
    public form, a staff entry and the desk's walk-in behind it, a restart, a TEST batch — and
    before the throttle is spent or anything is written. Before the participant is looked up
    too, so the answer is the same for an address that is registered already and one that is not
    (§19.4). The allocator asks again under the lock; this only spares the email.
  */
  await assertWaitlistCanTakeOneMore(db, event.id, now);

  const privacyNotice = await findCurrentApprovedDocument(db, "PRIVACY_NOTICE", input.locale, now);
  if (!privacyNotice) {
    throw new DomainError(
      "VALIDATION_ERROR",
      "no approved privacy notice exists yet; registration cannot be accepted",
    );
  }
  /*
    The club's terms, accepted expressly on the form (§NNN): the version in force now is the one the
    tick names and the one recorded. Only where the tick is asked — the public form and the family
    link; a staff entry or a desk walk-in makes it on paper and records none. With no approved terms
    there is nothing to accept, and the registration is refused like one with no privacy notice.
  */
  const terms = origin.source === "PUBLIC" ? await findCurrentApprovedDocument(db, "TERMS", input.locale, now) : undefined;
  if (origin.source === "PUBLIC" && !terms) {
    throw new DomainError("VALIDATION_ERROR", "no approved terms exist yet; registration cannot be accepted");
  }
  /*
    The version shown and the version about to be recorded can differ (§NNN, finding (7)): a new
    TERMS version may be approved between this page's render and this submit. `termsVersionShown`
    is the version the tick actually named — posted only when the page had one to show — so a
    mismatch is refused rather than silently recorded under a tick that never named the newer
    text. The form re-renders and names the current version, which the next tick then agrees
    with. Absent (an older client, or no approved terms at render) is not a mismatch: nothing to
    compare against.
  */
  if (terms && input.termsVersionShown !== undefined && input.termsVersionShown !== terms.version) {
    throw new DomainError("VALIDATION_ERROR", "the terms changed since the form was shown", ["termsAccepted"]);
  }

  const identity = canonicalizeEmail(input.email);

  /**
   * The throttle of AGENTS.md §19.4, keyed on the canonical identity rather than an address as
   * typed — otherwise `ana.pop+1@`, `ana.pop+2@` and `anapop@` are three allowances for one
   * mailbox, which is the flood this exists to stop.
   *
   * **Refused out loud, like everything else on this form since §217** — and this one was
   * missed when the rest was fixed, which is the whole reason it is worth a paragraph.
   *
   * It used to return the generic success, justified in these words: "refused the same way the
   * honeypot and the timing check are refused". §217 reversed both of those, and left this
   * pointing at a rule that no longer existed. So the sixth submission in an hour produced no
   * registration, no email, no log line, and the "check your email" screen — the precise
   * failure that cost two participants, still live on the one guard nobody looked at.
   *
   * It leaks nothing. The bucket is keyed on the canonical identity of the address they have
   * just typed, so being told "you have sent several of these" is being told about themselves;
   * it says nothing about whether anybody else is registered, which is the oracle §19.4
   * actually forbids. The contact form has answered this way from the start, and
   * `rate-limit/service.ts` says why in as many words: "the sixth is told so plainly, because
   * a person is not a bot."
   *
   * Five an hour is also reachable by ordinary use — a re-test, a second family member on one
   * mailbox, somebody who cancelled and signed up again — which is exactly who must not be
   * met with silence.
   *
   * Staff-entered registrations skip it, like the spam checks above: an Administrator adding
   * people at a desk is the case this must not obstruct, and they are already authenticated
   * and authorized.
   */
  // Behind the emailed link for another person (§389) the address is throttled too, in a bucket of
  // its own ("registration-link-submit", ten an hour): sharing this one would let a family of four
  // spend seven of its five — the form, three re-sends for a link, three links.
  if (origin.source === "PUBLIC") {
    const scope = origin.anotherPerson ? "registration-link-submit" : "registration-submit";
    // Hashed (§322): the bucket needs equality, not the address.
    const verdict = await consumeRateLimit(db, scope, emailBucketKey(scope, identity.canonicalEmail), now);
    if (!verdict.allowed) {
      // The event and the verdict, never the address (§14.5) — as the anti-bot refusals log.
      console.warn(`[registration] refused as throttled, event ${event.id}`);
      throw new DomainError(
        "VALIDATION_ERROR",
        `too many submissions from this identity; retry after ${verdict.retryAfter}s`,
        ["throttled"],
      );
    }
  }

  /**
   * The legal name of record, and the details beside it (BR-REQ-031-04, BR-REQ-031-05).
   *
   * Composed once, here, so the declaration, the emails and the backoffice all read one string
   * rather than three call sites each joining the parts their own way. The health consent
   * carries the privacy notice's version, the same way `resultsConsentVersion` does: the
   * wording a person agreed to is a historical fact, not the wording currently approved.
   */
  const legalName = composeLegalName(input.firstName, input.lastName);
  const healthNotes = input.healthConsent && input.healthNotes ? input.healthNotes : null;
  const minor = Boolean(input.birthDate && isMinorOn(input.birthDate, now));
  const details: RegistrationEntryDetails = {
    firstName: input.firstName,
    lastName: input.lastName,
    displayName: input.displayName ?? null,
    birthDate: input.birthDate ?? null,
    sex: input.sex ?? null,
    nationality: input.nationality ?? null,
    city: input.city ?? null,
    phone: input.phone ?? null,
    emergencyContactName: input.emergencyContactName ?? null,
    emergencyContactPhone: input.emergencyContactPhone ?? null,
    /**
     * A member's club is the club's own name (§215).
     *
     * The tick and this box are the same question asked twice (BR-REQ-031-06), and typing the
     * answer by hand is how one club became "BRASOV RUNNERS", "Brasov runners" and "BvR" in the
     * export. The form fills it in and locks it while the tick is on; this is the same rule on
     * the server, so a submission with JavaScript off — or from anything that is not the form —
     * records the same string. The tick still grants nothing (§48): this writes a name, not a
     * capability.
     *
     * The name is the platform's constant rather than the catalogue's: what is stored is a
     * fact about the club, not a translation, and it must not differ between a Romanian and an
     * English submission.
     */
    clubName: input.clubMemberDeclared ? CLUB_NAME : (input.clubName ?? null),
    // Kept only for a minor: an adult who typed a name into the folded field named nobody's guardian.
    guardianName: minor && input.guardianName ? input.guardianName : null,
    /*
      Never for a minor (§323): the privacy notice says the club keeps no Strava or Instagram
      of a child, and the form hides the two boxes once the birth date says under eighteen —
      this is the same rule for a form posted without JavaScript, or typed in before the date.
      Minor on the day of registering, as the guardian rule above: that is when the consent
      would be given, and a runner under eighteen at the race is under eighteen today too.
    */
    stravaUrl: minor ? null : (input.stravaUrl ?? null),
    instagramHandle: minor ? null : (input.instagramHandle ?? null),
    clubMemberDeclared: input.clubMemberDeclared,
    tshirtSize: input.tshirtSize,
    healthNotes,
    healthConsentVersion: healthNotes ? privacyNotice.version : null,
    healthConsentAt: healthNotes ? now : null,
    // The statement itself, with the moment it was made (§171). A staff entry leaves it null:
    // the paper declaration at the desk carries it, and nobody declares it on another's behalf.
    fitnessDeclaredAt: input.fitnessDeclared ? now : null,
    rulesAcknowledgedAt: input.rulesAcknowledged ? now : null,
    // The terms version the tick named and the moment (§NNN); rewritten with everything else on a
    // restart, like `privacy_notice_version`. Null on a staff entry: the paper carries it.
    termsVersion: terms && input.termsAccepted ? terms.version : null,
    termsAcceptedAt: terms && input.termsAccepted ? now : null,
  };

  /** The deadlines this submission created, for the maintenance job (§334); none on a resend. */
  let createdDeadlines = undefined as (Date | null)[] | undefined;
  /*
    The club's deadlines (§377), read before the transaction and from the instance's memo when it
    is fresh, so a registration costs no extra round trip: the email link's lapse is written on
    the row from them, and a hold or an offer the allocator makes on the way takes its length
    from them.
  */
  const settings = await currentDeadlines(db);
  /*
    The club's limit of registrations per address (§389), read the same way and for the same reason
    as the deadlines: before the transaction, from the instance's memo, never under the event's lock.
    A staff entry never meets it — it refuses a registered address out loud before calling in.
  */
  const cap = origin.source === "PUBLIC" ? await currentAddressCap(db) : DEFAULT_ADDRESS_CAP;

  await db.transaction(async (tx) => {
    /*
      The event row, locked, before anything is read about the address (§389; §214 took the lock
      for the insert alone). Which runners the address already holds is now what decides between a
      re-send, the email for another person and a new registration — and two members of one family
      pressing at once must not both find the address empty. Taken before the participant row, the
      order `confirmEmail` takes them in (event, then participant), so the two cannot deadlock.
      The price, accepted: every public submission to one event now waits on this row — the silent
      re-send and the email for another person included, not only the insert — so a busy event's
      submissions run one at a time, each a few milliseconds long.
    */
    const locked = await repo.lockEventForCapacity(tx, event.id);
    if (!locked) throw new DomainError("NOT_FOUND", "no such event");

    const participant = await findOrCreateParticipant(tx, identity, legalName, input.locale, now);
    if (origin.anotherPerson && origin.anotherPerson.participantId !== participant.id) {
      // The caller fixes the address from the token; a mismatch is a caller's bug, never a person's.
      throw new DomainError("VALIDATION_ERROR", "the link for another person belongs to another address", [ANOTHER_LINK_INVALID]);
    }
    const rows = await repo.findRegistrationsByEventAndParticipant(tx, event.id, participant.id);
    const via = origin.anotherPerson ? "link" : origin.source === "STAFF" ? "staff" : "form";
    /*
      Whether the schema lets a second runner onto the address yet (`family-gate.ts`). Asked only
      when the answer can change the decision: a first registration and the same runner again are
      decided the same way either way, and cost no catalogue read.
    */
    const sameAndActive = rows.some((row) => isActiveStatus(row.status) && sameRunner(row.registeredName, legalName));
    const familyOpen = via === "link" || (rows.length > 0 && !sameAndActive) ? await familyRegistrationOpen(tx) : false;
    const decision = decideSubmission({ rows, legalName, via, familyOpen, cap });

    /*
      Behind the emailed link only (§389): whoever holds it has read the address's inbox, so the
      refusal may say what it is about — and it rolls the transaction back, the token's spend
      included, so the same link still works once the name is corrected or a place on the address
      frees up. Each is a marker the form's summary turns into a sentence, never a value.
    */
    if (decision.kind === "refuseClosed") {
      throw new DomainError("VALIDATION_ERROR", "a second person on one address is not available yet", [ANOTHER_LINK_INVALID]);
    }
    if (decision.kind === "refuseAlreadyRegistered") {
      throw new DomainError("VALIDATION_ERROR", "this runner is already registered on this address", [ALREADY_ON_ADDRESS]);
    }
    if (decision.kind === "refuseAtCap") {
      throw new DomainError("VALIDATION_ERROR", "this address already carries the club's limit of registrations at this event", [ADDRESS_AT_CAP]);
    }

    if (decision.kind === "offerAnother") {
      /*
        Another runner, on an address that is registered here (§389; the owner: "people must have
        this in the flow via email, like 'you are already registered, register for another
        person?'").

        Nothing is created. The screen is the one every submission gets — byte for byte, since the
        action cannot tell this return from any other — because saying anything else would tell a
        stranger which addresses are registered (§39, AGENTS.md §19.4). The answer goes to the
        address: one message with a single-use link to the form for the other person, the address
        fixed on it — or, when the address already carries the club's limit, the sentence that says
        so and no link. The token is minted at send time and hashed at rest (§12.8, §14.5), scoped to
        the registration the address holds here, so it names the event and the participant and
        nothing a stranger typed.
      */
      const queued = await enqueueEmail(tx, {
        participantId: participant.id,
        registrationId: decision.about.id,
        messageType: "REGISTER_ANOTHER_PERSON",
        // The language of the form just filled in: this answers that submission.
        locale: input.locale,
        recipientEmail: participant.deliveryEmail,
        // What was decided now, not what the setting says when the message renders: the email and
        // the decision must agree, and the link's page asks the limit again under the lock anyway.
        payload: { atCap: decision.atCap, registrationsPerAddress: cap.registrationsPerAddress },
        idempotencyKey: `registration:${decision.about.id}:another-person:${now.toISOString()}`,
        now,
      });
      // The club's record, as for any re-submission (§312): the state found and the message sent —
      // never the name that was typed (§12.12). The registration's timeline reads it as a line.
      await recordAuditEvent(tx, {
        actorStaffUserId: null,
        participantId: participant.id,
        action: "registration.resubmitted",
        entityType: "registration",
        entityId: decision.about.id,
        metadata: { status: decision.about.status, resent: queued ? "REGISTER_ANOTHER_PERSON" : null },
        now,
      });
      return;
    }

    const existing = decision.kind === "resend" || decision.kind === "restart" ? decision.registration : undefined;

    if (existing && isActiveStatus(existing.status)) {
      /*
        Already registered at some stage (§199).

        The screen's answer is the generic one, always: telling a visitor "this address is
        already registered" would turn the public form into a way to ask who is entered, which
        is the oracle `AGENTS.md` §19.4 exists to refuse. The *useful* answer goes where it can
        safely go — the address itself, which only its owner reads.

        It used to be sent only while the first registration was still waiting for its email
        confirmation, on the reasoning that resubmitting helps only if the first message was
        lost. That leaves everybody else with nothing at all: somebody who confirmed a month ago,
        forgot, and filled the form again sees "we have sent you a confirmation link" and no
        message arrives, which reads exactly like a failure — and it is what happens to anybody
        re-entering a test registration.

        So: whatever the state can offer, it offers, through the same `deriveAllowedResendMessageType`
        the backoffice's "send it again" uses — the verification link, the declaration, the
        waiting-list offer, or the confirmation with its QR. A state with nothing to resend
        (WAITLISTED: nothing is waiting on the participant) still sends nothing, because there is
        nothing to say.

        The throttle in front of the form is what keeps this from being a mailer: the same person
        can only ask so often (§19.4), and each message goes to the address that asked for it.
      */
      /*
        A waiting-list entry has nothing to *re-send* and still owes an answer (§217).

        `deriveAllowedResendMessageType` returns null for WAITLISTED, and it is right to: the
        backoffice's "send it again" hands somebody a link they have to act on, and a person
        queued for a place has no link and nothing to do. But this is not the backoffice — it
        is somebody typing their address into the form a second time because they are not sure
        the first time worked, and answering that with the "check your email" screen and no
        message is the §217 failure exactly.

        So the public path sends `WAITLIST_JOINED` again, which is the message that answers the
        question actually being asked: you are on the list, this is your position, nothing is
        owed from you. The throttle above is what keeps this from becoming a mailer.
      */
      const messageType = existing.status === "WAITLISTED"
        ? ("WAITLIST_JOINED" as const)
        : deriveAllowedResendMessageType(existing.status);
      // Whether a row was actually queued, for the club's record below: a key already used — two
      // presses in the same millisecond — queues nothing, and the record must not say otherwise.
      let queued: OutboxRow | null = null;
      if (messageType === "VERIFY_REGISTRATION_EMAIL") {
        queued = await enqueueVerificationEmail(tx, participant, existing, now);
      } else if (messageType) {
        queued = await enqueueEmail(tx, {
          participantId: participant.id,
          registrationId: existing.id,
          messageType,
          // The registration's language, not the page's: the row records what they chose.
          locale: existing.locale,
          recipientEmail: participant.deliveryEmail,
          // Says, in the one place it may be said, that this is the registration they already
          // have rather than a new one (§235). The screen stays generic for everybody (§19.4).
          payload: { alreadyRegistered: true },
          // Per submission, so two genuine attempts an hour apart are two messages; the throttle
          // bounds them rather than a key collision silently swallowing the second.
          idempotencyKey: `registration:${existing.id}:resubmitted:${now.toISOString()}`,
          now,
        });
      }
      /*
        …and the club learns it too (§312).

        Amalia registered with her browser's autofill, twice; she was told in the second
        message that she already was (§235), and the club was told nothing — "she says she
        registered but I cannot find anything" had no answer on any screen. So every pass through
        this branch leaves one audit row on the registration it found, whatever the state and
        whether or not anything went out: the state it found and the message type re-sent, or
        null. The registration's page reads it as a line of its timeline and the list as a chip.

        What it deliberately is not:
        - *A second answer on the public screen.* The row is read only behind
          `canReadRegistrations`; the visitor's screen is byte for byte the one everybody gets,
          which is the oracle rule (§19.4) and the reason this is an audit row and not a flag
          the confirmation page could consult.
        - *Personal.* The participant is the row's own column; the metadata names a state and a
          message type, never what was typed (§12.12). A second name typed into the form is
          not recorded anywhere — the registration keeps the name it has.
        - *Another throttle.* The public form's per-identity bucket above already bounds how
          often one address reaches this line (§19.4), so the trail cannot be flooded faster
          than the inbox it mirrors.

        In the same transaction as the re-send, so the record and the message cannot disagree:
        either both happened or neither did.
      */
      await recordAuditEvent(tx, {
        // The person themselves, so no actor. A staff entry refuses a duplicate out loud before
        // calling in (`createRegistrationByStaff`) and reaches this line only by racing another
        // entry past that check — and then the row names who typed it, which is the truth.
        actorStaffUserId: origin.source === "STAFF" ? (origin.createdByStaffUserId ?? null) : null,
        participantId: participant.id,
        action: "registration.resubmitted",
        entityType: "registration",
        entityId: existing.id,
        metadata: { status: existing.status, resent: queued && messageType ? messageType : null },
        now,
      });
      return;
    }

    const carriedFields = {
      registeredName: legalName,
      // The runner's key follows the name (§389): one address, several runners, told apart by it.
      nameKey: registrationNameKey(legalName),
      // A restart records what the person answered *now*. Carrying last year's t-shirt size
      // forward because a cancelled row happened to hold one is not a kindness.
      ...details,
      displayName: resolveDisplayName({
        displayName: input.displayName,
        firstName: input.firstName,
        lastName: input.lastName,
        legalName,
      }),
      privacyNoticeVersion: privacyNotice.version,
      privacyAcknowledgedAt: now,
      resultsNameConsent: input.resultsNameConsent,
      resultsConsentVersion: privacyNotice.version,
      listOptOut: input.listOptOut,
      // Carried on a restart too: the row should say who put this registration here *now*, not
      // who put an earlier, cancelled one here months ago.
      source: origin.source,
      createdByStaffUserId: origin.createdByStaffUserId ?? null,
    };

    if (existing) {
      // A restart of a Cancelled or Expired registration (AGENTS.md §10.5). Never leapfrogs
      // the waiting list and never lands directly on Confirmed — `allocateOrWaitlist` is the
      // same allocator a first-time registration uses.
      if (!participant.emailVerifiedAt) {
        /*
          The link of this cycle lapses from now (§377), with the club's hours in force now. Before
          the column, the lapse was measured from `submitted_at`, which a restart does not rewrite —
          so a row restarted days after its first submission lapsed at the very next run of the job,
          minutes after its new verification email went out.
        */
        const linkExpiresAt = emailLinkExpiresAt(now, settings);
        const restarted = await repo.transitionRegistration(tx, {
          id: existing.id,
          to: "PENDING_EMAIL_CONFIRMATION",
          changes: { ...carriedFields, emailLinkExpiresAt: linkExpiresAt },
          now,
        });
        if (restarted && !atTheDesk) await enqueueVerificationEmail(tx, participant, restarted, now);
        createdDeadlines = [linkExpiresAt];
        return;
      }

      await tx
        .update(registrations)
        .set({ ...carriedFields, updatedAt: now })
        .where(eq(registrations.id, existing.id));

      // The event row first, like every other allocation (rule 1 above, §10.6): a verified
      // participant's restart used to allocate against the capacity the page had read, with
      // no lock — the one door into the allocator that skipped the serialization point
      // (`DECISIONS.md` §151). Held since the transaction's first statement (§389).
      const allocated = await allocateOrWaitlist(tx, withLockedRow(event, locked), existing.id, now, settings);
      await enqueueAllocationEmail(tx, allocated, participant.deliveryEmail, `registration:${allocated.id}:restart:${now.toISOString()}`, now);
      // A hold, a place on the waiting list, or an offer made on the way to somebody else when
      // the allocator released a lapsed hold (§160) — the same deadlines `confirmEmail` wakes for.
      createdDeadlines = [allocated.holdExpiresAt, joinedQueue(allocated) ? offerDeadline(event, now, settings) : null];
      return;
    }

    /*
      The event row, locked, before the row that occupies one of its places is written (§214).

      Until now the insert was the one door into the allocator that took no lock, on the
      reasoning that the capacity *decision* happens later, at email confirmation. That is
      still true of the decision — and a `PENDING_EMAIL_CONFIRMATION` row occupies a place
      from the instant it exists (`ACTIVE_REGISTRATION_STATUSES`), so the number that goes
      with the place has to be drawn here, and a draw without the lock is two people reaching
      the same free number.

      It is the same serialization point every other allocation uses (§10.6, §151), so the
      cost is contention this event already has, not a new kind of it. Taken at the top of the
      transaction since §389, where the address's runners are read.
    */
    const lockedForCreate = locked;

    // When the link lapses unconfirmed, written on the row (§377): the club's hours now, kept however they change.
    const linkExpiresAt = emailLinkExpiresAt(now, settings);
    const created = await repo.insertPendingEmailRegistration(tx, {
      emailLinkExpiresAt: linkExpiresAt,
      eventId: event.id,
      participantId: participant.id,
      kind,
      locale: input.locale,
      registeredName: legalName,
      details,
      privacyNoticeVersion: privacyNotice.version,
      privacyAcknowledgedAt: now,
      raceId: event.raceId,
      resultsNameConsent: input.resultsNameConsent,
      resultsConsentVersion: privacyNotice.version,
      listOptOut: input.listOptOut,
      source: origin.source,
      createdByStaffUserId: origin.createdByStaffUserId ?? null,
      now,
    });
    // The number, at the moment the place is taken rather than at the moment it is confirmed
    // (§214). The runner sees it on the screen they land on, and the club sees it in the list
    // before anybody has signed anything — which is what "the process must be automatic" asks
    // for. It is never emailed, because it can still move when the numbers are settled.
    await ensureProvisionalBibNumber(tx, {
      eventId: event.id,
      registrationId: created.id,
      bibStartNumber: lockedForCreate.bibStartNumber,
      now,
    });

    // At the desk the address is about to be vouched for by the person typing it
    // (BR-REQ-037-07); a verification email to somebody standing in front of them is noise.
    if (!atTheDesk) await enqueueVerificationEmail(tx, participant, created, now);
    createdDeadlines = [linkExpiresAt];
  });

  // A resend creates nothing; anything else may, and the job is told when it matters (§334).
  if (createdDeadlines !== undefined) wakeMaintenance(event, now, settings, ...createdDeadlines);

  return { ok: true };
}

// --- §15.2 Email confirmation ------------------------------------------------------------------

/** Consumed after the participant's `VERIFY_REGISTRATION_EMAIL` token is spent. */
export async function confirmEmail<T extends Record<string, unknown>>(
  db: Database<T>,
  event: EventForRegistration,
  registrationId: string,
  now: Date,
): Promise<Registration> {
  // The club's hold and offer lengths (§377), before the lock and from the memo when it is fresh.
  const settings = await currentDeadlines(db);
  const result = await db.transaction(async (tx) => {
    const lockedEvent = await repo.lockEventForCapacity(tx, event.id);
    if (!lockedEvent) throw new DomainError("NOT_FOUND", "no such event");

    const current = await repo.findRegistrationById(tx, registrationId);
    if (!current) throw new DomainError("NOT_FOUND", "no such registration");
    if (current.status !== "PENDING_EMAIL_CONFIRMATION") {
      // Already confirmed by an earlier click of the same link, or moved on since. Idempotent:
      // show the current state rather than erroring.
      return { registration: current, allocated: false };
    }

    /*
      The event is not being run any more (§331): cancelled, or over. Confirming the address
      would allocate a place, draw a provisional number and send "sign the declaration" for a
      race that will not happen — so nothing is written and nothing is sent. The registration is
      returned still unconfirmed, which is how the confirmation page knows to say why rather
      than "confirmed, now sign" (`registrations/confirm/[token]/actions.ts`), and it lapses with
      the other unconfirmed ones when its link does (§377). Read under the event lock, so a
      cancellation that lands between the click and this line is the one that counts.
    */
    if (lockedEvent.eventStatus !== "SCHEDULED") return { registration: current, allocated: false };

    await markEmailVerified(tx, current.participantId, now);
    const allocated = await allocateOrWaitlist(tx, withLockedRow(event, lockedEvent), current.id, now, settings);
    await enqueueAllocationEmail(
      tx,
      allocated,
      await deliveryEmailOf(tx, current.participantId),
      `registration:${allocated.id}:email-confirmed:${now.toISOString()}`,
      now,
    );

    return { registration: allocated, allocated: true };
  });
  // A hold (the club's minutes, or the window's deadline), a place on the waiting list, or an
  // offer made on the way (§160): each is a deadline the job acts on.
  if (result.allocated) {
    wakeMaintenance(event, now, settings, result.registration.holdExpiresAt, joinedQueue(result.registration) ? offerDeadline(event, now, settings) : null);
  }
  return result.registration;
}

// --- §15.3 Declaration signing, and offer acceptance (the same act) ------------------------

/**
 * Bind the signature to the text that was read (BR-REQ-033-02 criterion 6, DECISIONS.md §57).
 * The page posts the id and hash of the version it rendered; a newer version approved in
 * between makes the two disagree, and recording the current one would stamp a text the
 * participant never saw — the defect §53 found. Refused with CONFLICT, which rolls back the
 * whole transaction, token spend included, so the same link re-renders the current text.
 *
 * Asked before anything else is read from the text (§330): who signs and which documents are
 * asked come from it, and must come from the text the page showed.
 */
function declarationChanged(version: number): DomainError {
  return new DomainError(
    "CONFLICT",
    `DECLARATION_CHANGED: the declaration that was read is not the current approved version ${version}; the participant must read the current text and sign again`,
  );
}

export async function signDeclaration<T extends Record<string, unknown>>(
  db: Database<T>,
  event: EventForRegistration,
  registrationId: string,
  rawInput: unknown,
  now: Date,
): Promise<Registration> {
  const parsed = declarationSigningSchema.safeParse(rawInput);
  if (!parsed.success) {
    throw new DomainError(
      "VALIDATION_ERROR",
      parsed.error.issues.map((issue) => `${issue.path.join(".")}: ${issue.message}`).join("; "),
      // The field names, never the values (§14.5): a blank signature is answered on the page as
      // the signature it is, not as a broken link (§314).
      [...new Set(parsed.error.issues.map((issue) => String(issue.path[0] ?? "")).filter(Boolean))],
    );
  }

  // The club's hold and offer lengths (§377), before the lock and from the memo when it is fresh.
  const settings = await currentDeadlines(db);
  const signed = await db.transaction(async (tx) => {
    const lockedEvent = await repo.lockEventForCapacity(tx, event.id);
    if (!lockedEvent) throw new DomainError("NOT_FOUND", "no such event");
    const locked = withLockedRow(event, lockedEvent);

    /**
     * The race is still to be run. A declaration signed against a called-off event would draw
     * a race number and send "you are in" for a race that will not happen — and since §160 the
     * link in the email lives until the start, so the window in which somebody could open it
     * after the cancellation is weeks rather than minutes. The event's own row, under the lock.
     */
    if (locked.eventStatus !== "SCHEDULED") {
      throw new DomainError("VALIDATION_ERROR", `the event is ${locked.eventStatus}`);
    }

    const before = await repo.findRegistrationById(tx, registrationId);
    if (!before) throw new DomainError("NOT_FOUND", "no such registration");
    if (before.status !== "PENDING_DECLARATION" && before.status !== "WAITLIST_OFFERED") {
      throw new DomainError("CONFLICT", `a declaration cannot be signed from status ${before.status}`);
    }

    /**
     * The signature is the declarant's name (§314, reversing that half of §283): the name given
     * at registration, or the parent's for a minor (§108) — the name the text above it already
     * prints as the one who declares. Asserted here, in the transaction that writes the
     * acceptance, and not only in the browser that refuses it first: a form with JavaScript off,
     * or a second caller, meets the same rule. A refusal is a throw, so the whole transaction
     * rolls back with it — the token spend included — and the same link signs with the right
     * name a moment later.
     *
     * Before the hold expiry and the re-allocation below, not after them (found in review): a
     * lapsed hold that re-allocates to the waiting list returns early, so a check placed later
     * never ran on that path, and the early return committed the token spend with a name nobody
     * had compared. Neither name changes under the expiry, so nothing is lost by asking first,
     * and a refused name never reaches the allocator.
     *
     * What is recorded stays what was typed, casing and diacritics and all: the rule decides
     * whether the signature is accepted, never what it says.
     */
    /*
      The text this signature binds to: the version current for this registration's language,
      read once, before anything is compared (§330). Who signs and which documents are asked are
      read from it, so it has to be the text the page showed — and that is checked first: the
      page posts the id and hash of the version it rendered, and a newer version approved in
      between is refused here with CONFLICT (`declarationChanged`, BR-REQ-033-02 criterion 6,
      §57) rather than as a refusal of a box the page never had, or a box the page had ignored.
      Never a flag the page posts: the server reads the text itself.
    */
    const document = await findCurrentApprovedDocument(tx, "EVENT_DECLARATION", before.locale, now);
    if (document && (document.id !== parsed.data.documentId || document.contentSha256 !== parsed.data.contentSha256)) {
      throw declarationChanged(document.version);
    }

    /*
      A minor's declaration is signed twice at this one press (§330) — by the parent, in
      `typedName` as above, and by the minor, in `minorTypedName`, with the name they were
      registered under — when the text asks the minor to sign: when it names the minor's own
      document, `{{participantIdDocument}}` (`asksForMinorSignature`). A text approved before that
      (the parent declares, with the parent's document, §108) is signed as it always was: once, by
      the parent, and the minor's boxes are neither asked nor kept, whatever was posted in them —
      the privacy notice approved beside such a text says nothing of a minor's own identity
      number. Both names are compared here, together, so a press with both wrong is told about
      both boxes at once — `mismatchedSignatures` is the function the page marks the boxes with,
      so the refusal and the red boxes name the same ones.
    */
    const expected = expectedSignatures(before, { minorSigns: document ? asksForMinorSignature(document.body) : false });
    const wrongSignatures = mismatchedSignatures(parsed.data, expected);
    if (wrongSignatures.length > 0) {
      throw new DomainError("VALIDATION_ERROR", `${wrongSignatures.join(", ")}: the signature is not the name expected`, wrongSignatures);
    }
    const signedByMinorToo = expected.minorTypedName !== null;

    /*
      The identity documents, asked for before anything moves too (§330), for the reason the names
      are: a refusal must never reach the allocator. A text naming any of the three document
      fields (`asksForIdDocument`) asks for the declarant's document, and — when the minor signs
      too — the minor's as well. Each missing one is named, so the page can say which box.
    */
    const needsIdDocument = document ? asksForIdDocument(document.body) : false;
    if (needsIdDocument) {
      const missing = [
        ...(signedByMinorToo && !parsed.data.minorIdDocument ? ["minorIdDocument"] : []),
        ...(!parsed.data.idDocument ? ["idDocument"] : []),
      ];
      if (missing.length > 0) {
        throw new DomainError("VALIDATION_ERROR", `${missing.join(", ")}: the declaration names an identity document`, missing);
      }
    }

    // Re-verify the hold is still live at the moment of signing — never trusting that it was
    // live when the page was rendered (§15.3 step 6; §10.6: evaluated against `now`). A hold
    // past its deadline is still live while nobody waits for the place (§160): the signature
    // that comes late is the one the owner asked to be lenient about.
    await repo.expireStaleHolds(tx, locked, now);
    let current = await repo.findRegistrationById(tx, registrationId);
    if (!current) throw new DomainError("NOT_FOUND", "no such registration");

    if (current.status === "EXPIRED") {
      // The hold lapsed at the very moment of signing (§15.3 step 7): re-run allocation
      // rather than simply refusing a place that might still be free.
      current = await allocateOrWaitlist(tx, locked, registrationId, now, settings);
      if (current.status === "WAITLISTED") return { registration: current, offered: 1 }; // no declaration requested yet
    }

    // Read above, before the hold was touched: the registration's language does not change under
    // the expiry, so it is the version current for `current.locale` too — and it was bound to
    // the version the page rendered there (`declarationChanged`).
    if (!document) {
      throw new DomainError("VALIDATION_ERROR", "no approved declaration exists for this locale");
    }

    /*
      The identity documents were required above, when the text names one (§95: the club hands
      out kits against it, so a signature without one is not the declaration the club wrote), and
      are stored only then. The minor's signature and document ride on the same row (§330): one
      acceptance, one instant, one text, signed by both.
    */
    await repo.insertDeclarationAcceptance(tx, {
      registrationId: current.id,
      legalDocumentId: document.id,
      declarationVersion: document.version,
      contentSha256: document.contentSha256,
      locale: current.locale,
      typedName: parsed.data.typedName,
      idDocument: needsIdDocument ? parsed.data.idDocument : null,
      minorTypedName: signedByMinorToo ? (parsed.data.minorTypedName ?? null) : null,
      minorIdDocument: signedByMinorToo && needsIdDocument ? (parsed.data.minorIdDocument ?? null) : null,
      acceptedAt: now,
    });

    const confirmed = await repo.transitionRegistration(tx, {
      id: current.id,
      to: "CONFIRMED",
      fromStatuses: ["PENDING_DECLARATION", "WAITLIST_OFFERED"],
      changes: {
        confirmedAt: now,
        holdExpiresAt: null,
        checkinCode: current.checkinCode ?? newCheckinCode(),
        // The race number, once the list is settled (§214, amending §87): nothing while the
        // window is open — the provisional number stands and the recompaction at close gives
        // the final one — and the next free number immediately once it has shut.
        ...(await finalBibAtConfirmation(tx, event, current, now)),
      },
      now,
    });
    if (!confirmed) throw new DomainError("CONFLICT", "this registration changed state concurrently");

    await enqueueEmail(tx, {
      participantId: confirmed.participantId,
      registrationId: confirmed.id,
      messageType: "REGISTRATION_CONFIRMED",
      locale: confirmed.locale,
      recipientEmail: await deliveryEmailOf(tx, confirmed.participantId),
      payload: {},
      idempotencyKey: `registration:${confirmed.id}:confirmed:${now.toISOString()}`,
      now,
    });
    await enqueueDeclarationCopies(tx, confirmed, now);
    await enqueueClubConfirmationNotice(tx, confirmed, now);

    // The expiry above may have released somebody *else's* lapsed hold to the queue — this
    // signature is the capacity-changing transaction that saw it, and no other will until the
    // job's next tick. Offer what it freed before the lock is let go (AGENTS.md §10.6).
    const offered = await fillAvailableSpots(tx, locked, now, settings);

    return { registration: confirmed, offered };
  });
  // A confirmation is a reminder the club's reminder lead out (§377); a re-allocation onto the waiting list may have
  // made an offer, and so may a released hold (§334).
  wakeMaintenance(event, now, settings, signed.registration.holdExpiresAt, signed.offered > 0 ? offerDeadline(event, now, settings) : null);
  return signed.registration;
}

/**
 * The club's copy of a signed declaration (§99, §244): the same PDF to the mailbox the club
 * named on `/admin/emails`, with the copies it asked for. The participant's own copy rides on
 * the confirmation since §126 — the PDF attached to the one message they keep — rather than as
 * a message of its own (the owner: "we need to minimize the number of emails"). The copy
 * carries no action link (a manage token in the club's mailbox would be a secret handed to the
 * wrong person, §12.8) and is not sent for a test registration: a synthetic runner's
 * declaration is not a record the club keeps.
 *
 * The `cc` and `bcc` lists travel in the payload rather than being looked up at send time, so
 * the row is a faithful record of what this confirmation asked for: a list edited tomorrow
 * changes tomorrow's copies, not the ones already queued.
 */
async function enqueueDeclarationCopies<T extends Record<string, unknown>>(
  tx: Transaction<T>,
  confirmed: Registration,
  now: Date,
): Promise<void> {
  if (confirmed.kind !== "REAL") return;
  const copies = resolveDeclarationCopies(await readClubNotices(tx), env.DECLARATIONS_ARCHIVE_TO);
  if (!copies.to) return;
  await enqueueEmail(tx, {
    participantId: confirmed.participantId,
    registrationId: confirmed.id,
    messageType: "DECLARATION_ARCHIVE",
    // The club reads Romanian; the message is bilingual regardless (§96).
    locale: "ro",
    recipientEmail: copies.to,
    payload: { cc: [...copies.cc], bcc: [...copies.bcc] },
    idempotencyKey: `registration:${confirmed.id}:declaration-archive:${now.toISOString()}`,
    now,
  });
}

/**
 * "Somebody has confirmed" (§245): one message to each mailbox the club named, with the
 * runner's name, the event and the number — and nothing a participant could act on.
 *
 * One row per address rather than one row with copies, unlike the declaration above: these are
 * separate notices to separate people, none of whom needs to see who else was told, and a
 * failure to reach one mailbox should not hold up another. A test registration is invisible
 * here as everywhere the club is told something (§12.6).
 */
async function enqueueClubConfirmationNotice<T extends Record<string, unknown>>(
  tx: Transaction<T>,
  confirmed: Registration,
  now: Date,
): Promise<void> {
  if (confirmed.kind !== "REAL") return;
  const recipients = confirmationNoticeRecipients(await readClubNotices(tx));
  for (const recipient of recipients) {
    await enqueueEmail(tx, {
      participantId: confirmed.participantId,
      registrationId: confirmed.id,
      messageType: "CLUB_CONFIRMATION_NOTICE",
      locale: "ro",
      recipientEmail: recipient,
      payload: {},
      // One notice per mailbox per confirmation: the address is part of the trigger, or the
      // second recipient's row would collide with the first's key and never be written.
      idempotencyKey: `registration:${confirmed.id}:club-confirmed:${recipient.toLowerCase()}:${now.toISOString()}`,
      now,
    });
  }
}

// --- §15.5 Self-unregistration, and offer decline (the same transition) ---------------------

/** A confirmed registration made before codes existed gets one the first time it is needed. */
export async function ensureCheckinCode<T extends Record<string, unknown>>(
  db: Database<T>,
  registrationId: string,
): Promise<string> {
  const current = await repo.findRegistrationById(db, registrationId);
  if (!current) throw new DomainError("NOT_FOUND", "no such registration");
  if (current.checkinCode) return current.checkinCode;
  const code = newCheckinCode();
  await db.update(registrations).set({ checkinCode: code }).where(eq(registrations.id, registrationId));
  return code;
}

type StaffActor = { id: string };

/**
 * The declaration, signed on paper at the desk and recorded by a member of staff
 * (BR-REQ-037-07, `DECISIONS.md` §67).
 *
 * The participant still signs — a printed copy of the current approved version, which the
 * desk holds — and what staff record is that fact, under their own id. The row is the same
 * shape as an email-link acceptance with `method = PAPER`, so everything downstream (the
 * version it binds, the hash, the count on the legal page) reads it identically. No approved
 * declaration means no confirmation, exactly as for the email path.
 */
async function acceptDeclarationOnPaper<T extends Record<string, unknown>>(
  tx: Transaction<T>,
  event: EventForRegistration,
  current: Registration,
  actor: StaffActor,
  now: Date,
): Promise<Registration> {
  const document = await findCurrentApprovedDocument(tx, "EVENT_DECLARATION", current.locale, now);
  if (!document) {
    throw new DomainError("VALIDATION_ERROR", "no approved declaration exists for this locale");
  }
  /*
    Who signed the paper, as the row records it (§330). An adult's paper carries one signature:
    the registered name. A minor's carries the parent's, as the declarant (`typed_name`, the same
    person `expectedSignatures` wants online) — and, when the declaration in effect asks the minor
    to sign (`asksForMinorSignature`, the same gate as online), the minor's beside it
    (`minor_typed_name`): the staff member who presses "Confirmă pe hârtie" attests exactly that,
    and the button says so on a minor's row only then. Under a text that does not ask it the paper
    is the one the parent signed alone, and the row records that and nothing more. Nobody on staff
    signs anything; the documents stay on the paper, as they always have.
  */
  const signers = expectedSignatures(current, { minorSigns: asksForMinorSignature(document.body) });
  await repo.insertDeclarationAcceptance(tx, {
    registrationId: current.id,
    legalDocumentId: document.id,
    declarationVersion: document.version,
    contentSha256: document.contentSha256,
    locale: current.locale,
    typedName: signers.typedName,
    minorTypedName: signers.minorTypedName,
    acceptedAt: now,
    method: "PAPER",
    attestedByStaffUserId: actor.id,
  });
  const confirmed = await repo.transitionRegistration(tx, {
    id: current.id,
    to: "CONFIRMED",
    fromStatuses: ["PENDING_DECLARATION", "WAITLIST_OFFERED"],
    changes: {
      confirmedAt: now,
      holdExpiresAt: null,
      checkinCode: current.checkinCode ?? newCheckinCode(),
      // As in `signDeclaration` (§214): nothing while the window is open, the next free
      // number once it has shut — which is every walk-in confirmed at the desk on race day.
      ...(await finalBibAtConfirmation(tx, event, current, now)),
    },
    now,
  });
  if (!confirmed) throw new DomainError("CONFLICT", "this registration changed state concurrently");

  await enqueueEmail(tx, {
    participantId: confirmed.participantId,
    registrationId: confirmed.id,
    messageType: "REGISTRATION_CONFIRMED",
    locale: confirmed.locale,
    recipientEmail: await deliveryEmailOf(tx, confirmed.participantId),
    payload: {},
    idempotencyKey: `registration:${confirmed.id}:confirmed:${now.toISOString()}`,
    now,
  });
  // The copy of the paper declaration's record, by email, as after an electronic signature (§95).
  await enqueueDeclarationCopies(tx, confirmed, now);
  await enqueueClubConfirmationNotice(tx, confirmed, now);
  return confirmed;
}

/**
 * Confirm a registration at the desk, from whatever pending state it is in (BR-REQ-037-07).
 *
 * The same allocator, the same lock, the same queue: a person whose address was vouched for by
 * staff still waits their turn if the event is full — this returns WAITLISTED then, and says
 * so. What it skips is the two emails: the address is attested by the member of staff whose id
 * goes on the row, and the declaration is on paper in front of them.
 *
 * A declaration hold past its deadline is confirmed like any other (§160): the place was kept
 * for this person and still counts as theirs, so the paper signed at the desk on race morning
 * is exactly the lenience the owner asked for — "they sign it right on race day before picking
 * up the kit". Nothing here re-checks capacity for it, because the hold never stopped
 * occupying the place. And once the gun has gone the same hold *is* released — by the start,
 * not by anybody's fault — while the kit table is still open: that row is re-allocated here
 * rather than refused, so the person standing at the desk with their paper is confirmed if
 * the place is still free and told they are on the list if it is not.
 */
export async function confirmByStaff<T extends Record<string, unknown>>(
  db: Database<T>,
  event: EventForRegistration,
  registrationId: string,
  actor: StaffActor,
  now: Date,
): Promise<Registration> {
  // The club's hold and offer lengths (§377), before the lock and from the memo when it is fresh.
  const settings = await currentDeadlines(db);
  const confirmed = await db.transaction(async (tx) => {
    const lockedEvent = await repo.lockEventForCapacity(tx, event.id);
    if (!lockedEvent) throw new DomainError("NOT_FOUND", "no such event");

    let current = await repo.findRegistrationById(tx, registrationId);
    if (!current) throw new DomainError("NOT_FOUND", "no such registration");
    if (current.status === "CONFIRMED") return current;
    // No desk for a race that will not run (§331): a paper confirmation here would allocate and
    // send "you are in" for a cancelled event, exactly what `signDeclaration` refuses online.
    if (lockedEvent.eventStatus === "CANCELLED") {
      throw new DomainError("VALIDATION_ERROR", "the event is CANCELLED");
    }

    if (current.status === "PENDING_EMAIL_CONFIRMATION") {
      await tx
        .update(registrations)
        .set({ emailConfirmedAt: now, emailConfirmedByStaffUserId: actor.id, updatedAt: now })
        .where(eq(registrations.id, current.id));
      current = await allocateOrWaitlist(tx, withLockedRow(event, lockedEvent), current.id, now, settings);
    }
    // A hold the event's own start released, and nothing else: the allocator decides again,
    // exactly as `signDeclaration` does for a signature that arrives at the same moment.
    if (current.status === "EXPIRED" && current.expiryReason === "DECLARATION_HOLD_LAPSED") {
      current = await allocateOrWaitlist(tx, withLockedRow(event, lockedEvent), current.id, now, settings);
    }
    if (current.status === "PENDING_DECLARATION" || current.status === "WAITLIST_OFFERED") {
      return acceptDeclarationOnPaper(tx, withLockedRow(event, lockedEvent), current, actor, now);
    }
    if (current.status === "WAITLISTED") return current;
    throw new DomainError("CONFLICT", `a registration in status ${current.status} cannot be confirmed`);
  });
  wakeMaintenance(event, now, settings, confirmed.holdExpiresAt, joinedQueue(confirmed) ? offerDeadline(event, now, settings) : null);
  return confirmed;
}

/**
 * Give a waiting-list registration a place ahead of its turn — the exceptional promotion of
 * AGENTS.md §2 (M2) — only into a place that is actually free. Never past capacity: the count
 * is the allocator's own, under the same lock, and "full" is refused with a sentence. The
 * queue is jumped on purpose and the audit row says who did it.
 */
export async function promoteFromWaitlistByStaff<T extends Record<string, unknown>>(
  db: Database<T>,
  event: EventForRegistration,
  registrationId: string,
  actor: StaffActor,
  now: Date,
): Promise<Registration> {
  // The club's hold and offer lengths (§377), before the lock and from the memo when it is fresh.
  const settings = await currentDeadlines(db);
  const promoted = await db.transaction(async (tx) => {
    const lockedEvent = await repo.lockEventForCapacity(tx, event.id);
    if (!lockedEvent) throw new DomainError("NOT_FOUND", "no such event");
    const locked = withLockedRow(event, lockedEvent);
    // As at the desk's confirmation (§331): nobody is given a place in a cancelled race.
    if (locked.eventStatus === "CANCELLED") {
      throw new DomainError("VALIDATION_ERROR", "the event is CANCELLED");
    }
    await repo.expireStaleHolds(tx, locked, now);

    const current = await repo.findRegistrationById(tx, registrationId);
    if (!current) throw new DomainError("NOT_FOUND", "no such registration");
    if (current.status !== "WAITLISTED") {
      throw new DomainError("CONFLICT", `only a waiting-list registration can be promoted; this one is ${current.status}`);
    }
    const occupied = computeOccupied(await repo.countOccupied(tx, event.id, now));
    if (lockedEvent.capacity !== null && occupied >= lockedEvent.capacity) {
      throw new DomainError("VALIDATION_ERROR", "the event is full: no place is free to promote into");
    }
    const offered = await repo.transitionRegistration(tx, {
      id: current.id,
      to: "WAITLIST_OFFERED",
      fromStatuses: ["WAITLISTED"],
      changes: { offerCreatedAt: now, holdExpiresAt: now },
      now,
    });
    if (!offered) throw new DomainError("CONFLICT", "this registration changed state concurrently");
    const confirmed = await acceptDeclarationOnPaper(tx, locked, offered, actor, now);
    // As in `signDeclaration`: the expiry above may have released another person's lapsed
    // hold to the queue, and this transaction is the one holding the lock that can offer it.
    const offersMade = await fillAvailableSpots(tx, locked, now, settings);
    return { registration: confirmed, offersMade };
  });
  wakeMaintenance(event, now, settings, promoted.offersMade > 0 ? offerDeadline(event, now, settings) : null);
  return promoted.registration;
}

/**
 * Check-in (BR-REQ-037-08): the participant is here. By staff at the desk, or by the
 * participant from their own link — `checkedInBy` null. Idempotent; undoing it is its own call.
 */
export async function checkIn<T extends Record<string, unknown>>(
  db: Database<T>,
  registrationId: string,
  checkedInBy: StaffActor | null,
  now: Date,
): Promise<Registration> {
  const current = await repo.findRegistrationById(db, registrationId);
  if (!current) throw new DomainError("NOT_FOUND", "no such registration");
  if (current.status !== "CONFIRMED") {
    throw new DomainError("CONFLICT", `only a confirmed registration can check in; this one is ${current.status}`);
  }
  // The race is over (§82): nobody arrives at a completed event, and a check-in after the
  // organizer closed it would count somebody who was never there.
  const [event] = await db
    .select({ eventStatus: events.eventStatus })
    .from(events)
    .where(eq(events.id, current.eventId))
    .limit(1);
  if (event?.eventStatus === "COMPLETED") {
    throw new DomainError("VALIDATION_ERROR", "the event is completed; the desk is closed");
  }
  // Nor at a race that will not run (§331): a check-in there would put somebody on the
  // thank-you's list for an event that never happened.
  if (event?.eventStatus === "CANCELLED") {
    throw new DomainError("VALIDATION_ERROR", "the event is cancelled; the desk is closed");
  }
  if (current.checkedInAt) return current;
  const [updated] = await db
    .update(registrations)
    .set({ checkedInAt: now, checkedInByStaffUserId: checkedInBy?.id ?? null, updatedAt: now })
    .where(eq(registrations.id, registrationId))
    .returning();
  return updated;
}

export async function undoCheckIn<T extends Record<string, unknown>>(
  db: Database<T>,
  registrationId: string,
  now: Date,
): Promise<Registration> {
  const [updated] = await db
    .update(registrations)
    .set({ checkedInAt: null, checkedInByStaffUserId: null, updatedAt: now })
    .where(eq(registrations.id, registrationId))
    .returning();
  if (!updated) throw new DomainError("NOT_FOUND", "no such registration");
  return updated;
}

export async function unregister<T extends Record<string, unknown>>(
  db: Database<T>,
  event: EventForRegistration,
  registrationId: string,
  source: "PARTICIPANT" | "ADMIN",
  now: Date,
  /**
   * `notify: false` when the cancellation is the first half of an erasure (§322): the place is
   * released exactly as for any cancellation, and no "your registration is cancelled" is queued
   * to a person who asked to be forgotten — a message the erasure would delete a moment later,
   * or that a drain between the two would already have sent.
   */
  options: { notify?: boolean } = {},
): Promise<Registration> {
  // The club's hold and offer lengths (§377), before the lock and from the memo when it is fresh.
  const settings = await currentDeadlines(db);
  const unregistered = await db.transaction(async (tx) => {
    const lockedEvent = await repo.lockEventForCapacity(tx, event.id);
    if (!lockedEvent) throw new DomainError("NOT_FOUND", "no such event");

    const current = await repo.findRegistrationById(tx, registrationId);
    if (!current) throw new DomainError("NOT_FOUND", "no such registration");

    // Idempotent: opening the cancel link twice must not error the second time.
    if (current.status === "CANCELLED") return { registration: current, offered: 0 };

    if (source === "PARTICIPANT" && now >= event.startsAt) {
      throw new DomainError("VALIDATION_ERROR", "this event has already started");
    }

    const cancelled = await repo.transitionRegistration(tx, {
      id: registrationId,
      to: "CANCELLED",
      fromStatuses: allowedFromStatuses("CANCELLED"),
      changes: { cancelledAt: now, cancellationSource: source },
      now,
    });
    if (!cancelled) {
      throw new DomainError("CONFLICT", "this registration changed state concurrently");
    }

    if (options.notify !== false) {
      await enqueueEmail(tx, {
        participantId: cancelled.participantId,
        registrationId: cancelled.id,
        messageType: "REGISTRATION_CANCELLED",
        locale: cancelled.locale,
        recipientEmail: await deliveryEmailOf(tx, cancelled.participantId),
        payload: {},
        idempotencyKey: `registration:${cancelled.id}:cancelled:${now.toISOString()}`,
        now,
      });
    }

    const offered = await fillAvailableSpots(tx, withLockedRow(event, lockedEvent), now, settings);

    return { registration: cancelled, offered };
  });
  // The freed place went to the front of the queue as an offer, whose deadline the job keeps.
  wakeMaintenance(event, now, settings, unregistered.offered > 0 ? offerDeadline(event, now, settings) : null);
  return unregistered.registration;
}
