import { randomUUID } from "node:crypto";
import { and, count, eq, gt, isNull, lt, lte } from "drizzle-orm";
import { emailActionTokens } from "@/db/schema/email-action-tokens";
import { eventInvitations } from "@/db/schema/event-invitations";
import { staffUsers } from "@/db/schema/staff-users";
import { emailOutbox } from "@/db/schema/email-outbox";
import { type Participant, participants } from "@/db/schema/participants";
import { familyPlaceHolds, familySittings } from "@/db/schema/family-entries";
import type {
  Registration,
  RegistrationKind,
  RegistrationSource,
} from "@/db/schema/registrations";
import { events } from "@/db/schema/events";
import { registrations } from "@/db/schema/registrations";
import type { Database, Transaction } from "@/db/types";
import { startHeldBack } from "@/modules/events/domain/dated";
import { registrationState } from "@/modules/events/domain/registration-window";
import { recordAuditEvent } from "@/modules/audit/repository";
import { findCurrentApprovedDocument, findEventDeclaration, noticeDescribesPromotionalMaterials } from "@/modules/legal-documents/repository";
import { recordFormPromoConsent, setPromoConsent } from "./promo-consent";
import { acceptanceTextHash } from "./signed-declaration";
import { readClubNotices } from "@/modules/notifications/club-notices";
import { confirmationNoticeRecipients, resolveDeclarationCopies } from "@/modules/notifications/domain/club-notices";
import { OFFER_UNTIL_START, startingDeadline } from "@/modules/notifications/domain/deadline-rebase";
import { markedForNow } from "@/modules/notifications/domain/send-at-once";
import { drainOutboxRowsAfterResponse } from "@/modules/notifications/drain";
import { revalidatePublicContent } from "@/modules/public-cache/cache";
import { enqueueEmail, type OutboxRow } from "@/modules/notifications/outbox";
import { outboxIdsForKey } from "@/modules/notifications/send-at-once";
import { bibNumberInUse, isEventSpareNumber, pickBibNumber } from "./bibs";
import { handsSpareAtConfirm } from "./domain/spare-bibs";
import type { CancelReason } from "./domain/cancel-reason";
import { shirtSizeKept } from "./domain/kit";
import { healthNoteKept, withoutHealthNote } from "./domain/health-note";
import { asksForIdDocument, asksForMinorSignature, describesListSocials, describesPromotionalMaterials } from "@/modules/legal-documents/domain/merge-fields";
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
import { type Deadlines, emailLinkExpiresAt, familySittingHeldUntil, familySittingHolds, reminderHoursFor } from "@/modules/deadlines/domain/deadlines";
import { maintenanceDueFor } from "@/modules/jobs/schedule";
import { wakeJobs } from "@/modules/jobs/schedule-cache";
import { CLUB_TIME_ZONE } from "@/i18n/dates";
import { env } from "@/shared/config/env";
import { CLUB_NAME } from "@/theme/brand";
import { DomainError } from "@/shared/errors/domain-error";
import {
  computeOccupied,
  computePublicAvailability,
  confirmsSupplementaryPlace,
  hasDirectAvailability,
  NoFreePlaceError,
  supplementaryPlaceUnconfirmedError,
} from "./domain/capacity";
import { computeDeclarationHoldExpiry, computeFamilyReservationExpiry, computeVouchedPlaceExpiry, computeWaitlistOfferExpiry, confirmationWindow } from "./domain/hold-deadlines";
import { newcomerJoinsLine, occupiedForNewcomer, waitlistFullError, waitlistHasRoom, waitlistLength, waitlistRoom } from "./domain/waitlist";
import { canManageRegistrations, type StaffRole } from "@/modules/staff-identity/domain/roles";
import { deriveAllowedResendMessageType } from "./domain/resend";
import { expectedSignatures, mismatchedSignatures } from "./domain/signature-name";
import { allowedFromStatuses, holdsAPlace, isActiveStatus } from "./domain/state-machine";
import { isUuid } from "@/shared/ids";
import { dayIn, MIN_PARTICIPANT_AGE } from "./domain/age";
import { ADDRESS_AT_CAP, ALREADY_ON_ADDRESS, ANOTHER_LINK_INVALID, decideSubmission } from "./domain/family";
import { registrationNameKey } from "./domain/name-key";
import { forgetRegisteredBadgeCount } from "./nav-count";
import { currentAddressCap } from "./address-cap";
import { familyEntryFields, insertFamilyEntry, liveSittingEntries, personOfEntry, replaceFamilyEntry } from "./family-entries";
import {
  confirmedSittingOf,
  continueFamilySitting,
  findSittingById,
  holdInSitting,
  lockLiveSitting,
  openSitting,
  queueFamilyConfirmed,
  settleSitting,
  sittingHasMessageToLeave,
  sittingPendingRegistrations,
} from "./family-sitting";
import { FAMILY_HELD, familyHeldDeclaration, familyHeldUntil, SITTING_AT_CAP, SITTING_HELD, type SittingSeed, sittingEntryFor } from "./domain/family-sitting";
import { publicFormEvent } from "./public-form-event";
import { familyPlaceSlot } from "./family-place-slot";
import { sameRunner } from "./domain/name-key";
import { addressHasRoom } from "./domain/address-cap";
import { familyRegistrationOpen } from "./family-gate";
import {
  adultOnTheFamilyForm,
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
import { findInvitationById, findLiveInvitationOfParticipant, findOpenInvitation, invitationOpen } from "./invitation-repository";
import { confirmsInvitationRaises, INVITATION_BATCH_MAX, InvitationRefusal, invitationDeadline, invitationFreePlaces, invitationRaises, invitationState, validInvitationDays } from "./domain/invitations";
import { waitlistRefusalOf } from "./domain/waitlist";

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
  /**
   * «Se deschid în curând» (§451): while true nobody registers outside the desk. Every caller that
   * reads the row passes it; absent on a partial row (a fixture) is the column's default, false.
   */
  registrationOpensSoon?: boolean;
  /**
   * The date is to be announced (§533): nobody registers at any door, the desk's included — there
   * is no day to count the minimum age on, and `startsAt` is only the organizer's provisional note.
   * Absent on a partial row (a fixture) is the column's default, false.
   */
  dateToBeAnnounced?: boolean;
  /** Only the time is to be announced (§533): refused at every door, like the date's switch. */
  timeToBeAnnounced?: boolean;
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
   * «Doar pentru membrii BVR» (§552): the public form takes a registration only behind a members'
   * session (`RegistrationOrigin.member`), for the account's own address, one person per account.
   * Asked here before anything is spent and again under the event's lock. Absent on a partial row: false.
   */
  membersOnly?: boolean;
  /**
   * «Informații medicale» (§557): whether the form asks the health note. `false` drops a posted note
   * before the schema reads it, so a stale form is not refused; what is stored is decided off the
   * locked row whatever this says. Absent on a partial row: nothing dropped early, the lock decides.
   */
  askHealthNote?: boolean;
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
  // Before the desk's exception: a date still to be announced (§533) takes nobody anywhere.
  if (startHeldBack(event)) {
    throw new DomainError("VALIDATION_ERROR", "the event's date is to be announced: registration is not open");
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
      registrationOpensSoon: event.registrationOpensSoon ?? false,
      dateToBeAnnounced: event.dateToBeAnnounced ?? false,
      timeToBeAnnounced: event.timeToBeAnnounced ?? false,
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
 * The race number a registration gets at the moment it is confirmed (§548, amending §173, §214,
 * §420; the owner, 2026-09-28: «faza cu numerele de concurs provizorii e ciudată»).
 *
 * A number exists only once a registration is confirmed — the address proved and the declaration
 * signed — and is drawn right here, under the event row's lock the confirmation already holds, the
 * serialization point capacity uses (§10.6). Nothing is drawn, held or shown before: not at the
 * form, not with a declaration hold, not with a waiting-list offer. So the numbers follow the order
 * of confirmation, from the event's own first number, and since none is ever released they are
 * never reused. The confirmation email carries it.
 *
 * A number the row already wears is kept: a cancelled confirmed registration that restarted keeps
 * its retired number and gets it back at its new confirmation (§173), never a second one. A test
 * registration wears none (`AGENTS.md` §12.6).
 */
async function bibAtConfirmation<T extends Record<string, unknown>>(
  tx: Database<T>,
  current: Registration,
): Promise<{ bibNumber: number | null }> {
  if (current.bibNumber !== null) return { bibNumber: current.bibNumber };
  if (current.kind !== "REAL") return { bibNumber: null };
  return { bibNumber: await pickBibNumber(tx, current.eventId) };
}

/**
 * The number the desk handed with the paper (§444): a pre-printed spare, or any free number the
 * volunteer typed, written as the registration's number at the moment it is confirmed, in place of
 * the one the draw would give. A spare is on paper already, so it is marked printed — the next
 * "unprinted" sheet must not print a second 901 with the name on it, and a cancellation later
 * lists it among the bibs that exist (§311).
 *
 * Checked here, under the event lock the confirmation holds, as well as by the desk before the
 * entry: another volunteer may have given the same spare a moment ago. A runner who already wears
 * a number keeps it (§173) and the typed one is refused rather than silently ignored.
 */
async function handedBibAtConfirmation<T extends Record<string, unknown>>(
  tx: Database<T>,
  current: Registration,
  handed: number,
  now: Date,
): Promise<{ bibNumber: number; bibPrintedAt?: Date }> {
  if (current.kind !== "REAL") {
    throw new DomainError("VALIDATION_ERROR", "a test registration wears no race number", ["bibNumber"]);
  }
  // Nobody has a number before the confirmation (§548), so any real registration confirmed at the
  // desk may take the one in the volunteer's hand — unless it already wears one (the same rule the
  // desk's box is drawn by, `handsSpareAtConfirm`, here under the lock).
  if (!handsSpareAtConfirm(current)) {
    throw new DomainError("VALIDATION_ERROR", "this registration already has a race number; it cannot be changed", ["bibNumber"]);
  }
  if (await bibNumberInUse(tx, { eventId: current.eventId, number: handed, exceptRegistrationId: current.id })) {
    throw new DomainError("CONFLICT", `number ${handed} is already somebody's at this event`, ["bibNumber"]);
  }
  const spare = await isEventSpareNumber(tx, current.eventId, handed);
  return { bibNumber: handed, ...(spare ? { bibPrintedAt: current.bibPrintedAt ?? now } : {}) };
}

/**
 * Tell the maintenance job this change may have given it work sooner than it expects (§334).
 *
 * The one call every write path below makes once its transaction has committed. `deadlines` are
 * the holds and offers the change itself created; `maintenanceDueFor` adds the event's own
 * instants, and `wakeJobs` does nothing when all of them are further away than any quiet a run
 * can promise — which is the ordinary case: a race weeks away, a hold that lapses in days. A call
 * this file forgot delays the job's run to the daily window at 04:00 (§577) — at most a day —
 * never the work: every deadline here is also evaluated on every read (§10.6).
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
 * «Trimite-i oferta»'s deadline (§642): the club's offer window capped by the start alone, so an offer
 * the Administrator makes after the close is never born lapsed. The automatic offers keep `offerDeadline`.
 */
function staffOfferDeadline(event: EventForRegistration, now: Date, settings: Deadlines): Date {
  return computeWaitlistOfferExpiry({ now, registrationClosesAt: event.registrationClosesAt, eventStartsAt: event.startsAt, deadlines: settings, capByClose: false });
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
 * Whether a newcomer gets a place now (§10.6): the stale holds expired and the waiting list served
 * first, then the one formula — the allocator's own opening, shared by `allocateOrWaitlist` and a
 * family's reservation (`reserveFamilyPlace`, §543), so the two can never count differently. The
 * caller holds the event-row lock.
 */
async function placeForNewcomer<T extends Record<string, unknown>>(
  db: Transaction<T>,
  event: LockedEventForRegistration,
  now: Date,
  settings: Deadlines,
): Promise<{ free: boolean; counts: repo.OccupiedCountsRow; eligibleWaitlisted: number }> {
  await repo.expireStaleHolds(db, event, now);
  await fillAvailableSpots(db, event, now, settings);
  const counts = await repo.countOccupied(db, event.id, now);
  const eligibleWaitlisted = await repo.countEligibleWaitlisted(db, event.id);
  /*
    Newcomers queue while anybody waits (§615, amending §104 and §587): one `WAITLISTED` row, and the
    newcomer joins the line even with a place free — under the same lock, from the count just taken.
    Unconditional, whatever the event's `waitlist_auto_offer`: with automatic offers on it is almost
    never seen, because a freed place is offered in the transaction that frees it, so nobody is left
    waiting beside a free place (only after the close, when no offer is made, does a desk walk-in now
    queue behind them); with offers off it is the rule that keeps the queue honest, since a place the
    organizer has not handed out yet is not the next stranger's. An open offer is not somebody waiting
    (`newcomerJoinsLine`). A family's form (§543) asks the same question here, so a family that arrives
    while anybody waits reserves nothing and joins the line whole once its address is confirmed. The
    capacity formula is untouched; this only says who a free place is for.
  */
  const lineFirst = newcomerJoinsLine({ waitlisted: eligibleWaitlisted });
  return {
    free: !lineFirst && hasDirectAvailability({ capacity: event.capacity, occupied: computeOccupied(counts), eligibleWaitlisted }),
    counts,
    eligibleWaitlisted,
  };
}

/** What a family's form got (§543): a reserved place, or the waiting list once the address is confirmed. */
export type FamilyPlace = "reserved" | "waitlist";

/**
 * A family's place reserved the moment its form is sent (§543, amending §446 and §519; the owner,
 * 2026-09-28: «să rezerv 3 locuri și așa să se calculeze pe site»). The registration stays
 * `PENDING_EMAIL_CONFIRMATION` — nobody's address is confirmed by a form — and its hold, written on
 * the row, is counted by `countOccupied`, so the public count and «12 înscriși din 50 de locuri» drop
 * at once. Only through the allocator's own opening (`placeForNewcomer`), under the event's lock:
 * with no place free the form reserves nothing and the person joins the waiting list when the
 * address is confirmed, which the screen and the email say. The deadline is the sitting's own
 * (`family_sittings.reserved_until`): the first form's instant, the club's window and hold — written
 * once, and moved by nothing afterwards (the review of 2026-09-28, round three). A reservation this
 * registration already holds is left as it is. A single registration never comes here: it takes its
 * place when its address is confirmed, as before.
 */
async function reserveFamilyPlace<T extends Record<string, unknown>>(
  db: Transaction<T>,
  event: LockedEventForRegistration,
  registrationId: string,
  now: Date,
  settings: Deadlines,
  until: Date,
): Promise<FamilyPlace> {
  if (await repo.holdsFamilyReservation(db, registrationId, now)) return "reserved";
  const { free } = await placeForNewcomer(db, event, now, settings);
  if (!free) return "waitlist";
  return (await repo.writeFamilyReservation(db, registrationId, until, now)) ? "reserved" : "waitlist";
}

/**
 * A place held for a family sitting's form that wrote no registration (§543, the review of 2026-09-28,
 * round three; §39, AGENTS.md §19.4): a kept form, a person the address already holds, an address at
 * the club's limit with registrations made elsewhere, or the opening «Da» of a sitting whose first form
 * wrote none. Through the allocator's own opening (`placeForNewcomer`), under the event's lock, as a
 * fresh address's form reserves its registration's place, and until the same deadline — so the public
 * count drops by one for such a form exactly as for a fresh address, and «N înscriși din M» says
 * nothing about what the address holds. With no place free it holds nothing and reads «pe lista de
 * așteptare», as a fresh address's form would.
 *
 * One hold per person the address sends at the event (`familyPlaceSlot`, the review of 2026-09-28,
 * rounds four and five): a hold still counted under the same slot — in this sitting or an earlier one —
 * is the person's, and the form adds nothing, as a fresh address's form for a person it already
 * reserved adds nothing. A lapsed one under this sitting's key is taken again through the allocator,
 * exactly as a fresh address's lapsed reservation would be (`reserveFamilyPlace`).
 *
 * With no place free the person is still recorded under the slot, holding nothing
 * (`writeFamilyPlaceMarker`, the review of 2026-09-28, round six; §39): a fresh address's form on a
 * full event writes a waiting registration, and this row is its counterpart, so the club's limit counts
 * the people this browser sent from the server's own rows for every address, whether a place was free
 * or not. A later form for the person, once a place is free, turns it into a counted hold.
 */
async function holdFamilyPlace<T extends Record<string, unknown>>(
  db: Transaction<T>,
  event: LockedEventForRegistration,
  hold: { sittingKey: string; slot: string },
  now: Date,
  settings: Deadlines,
  until: Date,
): Promise<FamilyPlace> {
  if (await liveFamilyPlaceHoldOf(db, event.id, hold.slot, now)) return "reserved";
  // A lapsed hold under the same slot counts nowhere already: it goes, and the slot is taken afresh.
  await db
    .delete(familyPlaceHolds)
    .where(and(eq(familyPlaceHolds.sittingKey, hold.sittingKey), eq(familyPlaceHolds.slot, hold.slot), lte(familyPlaceHolds.expiresAt, now)));
  const { free } = await placeForNewcomer(db, event, now, settings);
  const row = { eventId: event.id, sittingKey: hold.sittingKey, slot: hold.slot, until };
  if (!free) {
    await repo.writeFamilyPlaceMarker(db, row, now);
    return "waitlist";
  }
  return (await repo.writeFamilyPlaceHold(db, row, now)) ? "reserved" : "waitlist";
}

/**
 * Whether a sitting ever sent the person of this slot at the event, live or lapsed, in whichever
 * sitting (§543, round five): a place held for them, or — since round six — their record from a form
 * sent while no place was free (`writeFamilyPlaceMarker`), so the answer is the same on a full event as
 * on one with places. Until the day-late sweep (`purgeLapsedFamilySittings`) or the event's own
 * maintenance clears a lapsed row.
 */
async function familyPlaceHoldTaken<T extends Record<string, unknown>>(db: Transaction<T>, eventId: string, slot: string): Promise<boolean> {
  const [row] = await db
    .select({ id: familyPlaceHolds.id })
    .from(familyPlaceHolds)
    .where(and(eq(familyPlaceHolds.eventId, eventId), eq(familyPlaceHolds.slot, slot)))
    .limit(1);
  return row !== undefined;
}

/** Whether the person of this slot holds a live family place at the event, in whichever sitting (§543, round five). */
async function liveFamilyPlaceHoldOf<T extends Record<string, unknown>>(db: Transaction<T>, eventId: string, slot: string, now: Date): Promise<boolean> {
  const [live] = await db
    .select({ id: familyPlaceHolds.id })
    .from(familyPlaceHolds)
    .where(and(eq(familyPlaceHolds.eventId, eventId), eq(familyPlaceHolds.slot, slot), eq(familyPlaceHolds.holdsPlace, true), gt(familyPlaceHolds.expiresAt, now)))
    .limit(1);
  return live !== undefined;
}

/**
 * A registration's place in its family sitting (§543): its reservation while it waits for the address
 * — taken now through the allocator when it holds none, as a person's held place is (`holdFamilyPlace`)
 * — the place it already holds, or the waiting list it is on, once the address is verified. Null for a
 * registration that is over (cancelled, lapsed), which is nobody's place.
 */
async function placeOfRegistration<T extends Record<string, unknown>>(
  tx: Transaction<T>,
  event: LockedEventForRegistration,
  registrationId: string,
  now: Date,
  settings: Deadlines,
  until: Date,
): Promise<FamilyPlace | null> {
  const [row] = await tx.select({ status: registrations.status }).from(registrations).where(eq(registrations.id, registrationId)).limit(1);
  if (row?.status === "PENDING_EMAIL_CONFIRMATION") return reserveFamilyPlace(tx, event, registrationId, now, settings, until);
  if (row?.status === "WAITLISTED") return "waitlist";
  if (row && holdsAPlace(row.status)) return "reserved";
  return null;
}

/**
 * The place of the person a sitting's form names (§543; the review of 2026-09-28, rounds four and five,
 * §39, AGENTS.md §19.4), decided by the server from the address's rows at the event — never by the
 * browser's half, and never by which sitting the half names:
 *
 * - the person is one of this sitting's registrations (a fresh address's earlier form for them, or its
 *   opening press's): that registration's place (`placeOfRegistration`) — nothing is added;
 * - the person already has a live family place at the event, in whichever sitting it was taken: a
 *   reservation on their registration, or their held place (`familyPlaceSlot`, one per person the
 *   address sends) — nothing is added either;
 * - otherwise their held place is taken now under this sitting's key.
 *
 * So a person holds at most one family place at a time, and a form adds it once, whatever the address
 * holds and however often a sealed half is replayed — a half from before a sitting's deadline or from
 * after it alike: a fresh address and one that already holds the person follow the same count and read
 * the same words. Once the person's place has lapsed with its sitting's deadline, the next sitting's
 * form takes it again, for every address alike.
 */
async function sittingPlaceOf<T extends Record<string, unknown>>(
  tx: Transaction<T>,
  event: LockedEventForRegistration,
  scope: { sitting: { registrationIds: readonly string[] } | null; sittingKey: string | null; participantId: string },
  legalName: string,
  now: Date,
  settings: Deadlines,
  until: Date,
): Promise<FamilyPlace | null> {
  const [own] = await tx
    .select({ id: registrations.id, reserved: repo.familyReservationHolds(now) })
    .from(registrations)
    .where(and(eq(registrations.eventId, event.id), eq(registrations.participantId, scope.participantId), eq(registrations.nameKey, registrationNameKey(legalName))))
    .limit(1);
  if (own && scope.sitting?.registrationIds.includes(own.id)) {
    const place = await placeOfRegistration(tx, event, own.id, now, settings, until);
    if (place !== null) return place;
  }
  if (own?.reserved) return "reserved";
  const slot = familyPlaceSlot(event.id, scope.participantId, legalName);
  if (await liveFamilyPlaceHoldOf(tx, event.id, slot, now)) return "reserved";
  if (!scope.sittingKey) return null;
  return holdFamilyPlace(tx, event, { sittingKey: scope.sittingKey, slot }, now, settings, until);
}

/**
 * The first form's place at the press that opens the sitting (§543): its registration's place
 * (`placeOfRegistration`) when it wrote one, and otherwise — a kept form, a person the address already
 * holds, a first form that wrote nothing — the person's place as a later form finds it
 * (`sittingPlaceOf`, from the name the browser's half carries for its first form): a live family
 * place they already have, in whichever sitting, or their held place taken now. Every address reads
 * the same (§39), and a replayed press finds the person's place taken.
 */
async function placeOfFirstForm<T extends Record<string, unknown>>(
  tx: Transaction<T>,
  event: LockedEventForRegistration,
  first: { registrationId: string | null; sittingKey: string | null; participantId: string | null; name: string | null },
  now: Date,
  settings: Deadlines,
  until: Date,
): Promise<FamilyPlace | null> {
  if (first.registrationId) {
    const place = await placeOfRegistration(tx, event, first.registrationId, now, settings, until);
    if (place !== null) return place;
  }
  if (!first.participantId) return null;
  return sittingPlaceOf(tx, event, { sitting: null, sittingKey: first.sittingKey, participantId: first.participantId }, first.name ?? "", now, settings, until);
}

/**
 * «Da, încă o persoană» (§536) with the family's reservations (§543): the sitting opened or its window
 * started again (`continueFamilySitting`).
 *
 * **The press that opens the sitting** (`opening`, the first press on this browser) fixes the
 * sitting's deadline: the first form's instant plus the club's window — the end of the first form's
 * window, which the browser's half carries (`firstWindowEnd`), never later than this press's own —
 * plus the club's declaration hold, capped by the close and the start. Written once on the sitting,
 * and on every place the sitting reserves; nothing moves it afterwards, not a form, not a press, not
 * the email's send (the review of 2026-09-28, round three). Then, under the event's lock, it gives the
 * first form its place (`placeOfFirstForm`) — a held one when that form wrote no registration, under
 * the sitting's id or, with no sitting row, the random id the browser carries.
 *
 * **A later press** reserves nothing and lengthens nothing: a press passes no bot check. Past the
 * deadline it no longer holds the sitting's email back either, and the next form opens a new sitting.
 *
 * Returns the sitting, whether this press opened it, the deadline and the first form's place; a later
 * press returns no place and no deadline.
 */
export async function continueFamilySittingAndReserve<T extends Record<string, unknown>>(
  db: Database<T>,
  press: Parameters<typeof continueFamilySitting>[1],
  heldUntil: Date,
  now: Date,
  /**
   * The press that opens the sitting: the end of the first form's window, and the name its form was
   * sent for and the address it was sent with, as the browser's half carries them (§543) — the two
   * only pick the person's slot.
   */
  opening: { firstWindowEnd: Date; firstName?: string | null; email?: string | null } | null = null,
): Promise<{ sittingId: string | null; opened: boolean; reservedUntil: Date | null; place: FamilyPlace | null }> {
  if (!opening) {
    const continued = await continueFamilySitting(db, press, heldUntil, now, heldUntil);
    return { sittingId: continued?.sittingId ?? null, opened: continued?.opened ?? false, reservedUntil: null, place: null };
  }
  const settings = await currentDeadlines(db);
  const [event] = await db
    .select({ registrationClosesAt: events.registrationClosesAt, startsAt: events.startsAt })
    .from(events)
    .where(eq(events.id, press.eventId))
    .limit(1);
  const from = new Date(Math.min(opening.firstWindowEnd.getTime(), heldUntil.getTime()));
  const until = computeFamilyReservationExpiry({
    from,
    registrationClosesAt: event?.registrationClosesAt ?? null,
    // A start to be announced takes no registration (§533); the hold alone then.
    eventStartsAt: event?.startsAt ?? new Date(from.getTime() + 24 * 60 * 60_000),
    deadlines: settings,
  });
  const continued = await continueFamilySitting(db, press, heldUntil, now, until);
  return db.transaction(async (tx) => {
    const locked = await repo.lockEventForCapacity(tx, press.eventId);
    const sitting = continued ? await findSittingById(tx, continued.sittingId) : undefined;
    const sittingKey = sitting?.id ?? (press.sittingId && isUuid(press.sittingId) ? press.sittingId : null);
    const reservedUntil = sitting?.reservedUntil ?? until;
    if (!locked) return { sittingId: continued?.sittingId ?? null, opened: continued?.opened ?? false, reservedUntil: null, place: null };
    const lockedEvent = withLockedRow(publicFormEvent(locked, locked.publishedAt), locked);
    const seedRegistration = press.seed?.kind === "registration" && sitting?.registrationIds.includes(press.seed.id) ? press.seed.id : null;
    const participantId = await participantIdOfAddress(tx, opening.email ?? null);
    const place = await placeOfFirstForm(tx, lockedEvent, { registrationId: seedRegistration, sittingKey, participantId, name: opening.firstName ?? null }, now, settings, reservedUntil);
    return { sittingId: continued?.sittingId ?? null, opened: continued?.opened ?? false, reservedUntil, place };
  });
}

/**
 * The held place of a registration's own person, released (§543, round five): by their slot, in
 * whichever sitting. Only on an event where a family sitting held or sent somebody (the review of
 * 2026-09-28, round six): there alone can a slot name this registration's person, and there the slot
 * secret was keyed already, by the sitting that wrote the row. A registration on an event with no such
 * row — every single registration's, the common case — reads nothing more and never keys the secret,
 * so a deployment missing it can never fail inside the allocator.
 */
async function releaseOwnFamilyPlaceHold<T extends Record<string, unknown>>(db: Transaction<T>, eventId: string, registrationId: string): Promise<void> {
  if (!(await repo.eventHasFamilyPlaceHolds(db, eventId))) return;
  const [row] = await db
    .select({ participantId: registrations.participantId, registeredName: registrations.registeredName })
    .from(registrations)
    .where(eq(registrations.id, registrationId))
    .limit(1);
  if (!row) return;
  await repo.releaseFamilyPlaceHold(db, { eventId, slot: familyPlaceSlot(eventId, row.participantId, row.registeredName) });
}

/** The participant of the address a sitting's half was sent with (§543, round five): only to pick a person's slot. */
async function participantIdOfAddress<T extends Record<string, unknown>>(tx: Transaction<T>, email: string | null): Promise<string | null> {
  if (!email) return null;
  let canonical: string;
  try {
    canonical = canonicalizeEmail(email).canonicalEmail;
  } catch {
    return null;
  }
  return (await findParticipantByCanonicalEmail(tx, canonical))?.id ?? null;
}

/**
 * The open invitation, before its deadline, of the address a registration belongs to (§NNN), when that
 * registration is about to be given a place by a route other than the invitation's own link. Never for
 * a row in the line (`WAITLISTED`, `WAITLIST_OFFERED`), whose place comes as an offer. Read under the
 * caller's event lock.
 *
 * By the address, not by the name: the invitation is the address's — one open per address per event,
 * refused at the send while the address holds a registration, and its link registers whoever the inbox
 * names — so the first registration of that address to reach a place is the one the club kept it for.
 */
async function invitationToAdopt<T extends Record<string, unknown>>(db: Transaction<T>, eventId: string, registrationId: string, now: Date) {
  const registration = await repo.findRegistrationById(db, registrationId);
  if (!registration || registration.status === "WAITLISTED" || registration.status === "WAITLIST_OFFERED") return undefined;
  return findLiveInvitationOfParticipant(db, eventId, registration.participantId, now);
}

/**
 * An open invitation taken over by its address's registration (§NNN): marked accepted with that
 * registration's id, after the registration took the place — the stamp the link's press writes
 * (`seatInvitedRegistration`) — and audited `event.invitation_accepted` with `adopted: true` (no actor:
 * the route that placed the row writes its own row). The link's page then says it was used.
 */
async function markInvitationAdopted<T extends Record<string, unknown>>(db: Transaction<T>, invitation: { id: string; eventId: string }, registrationId: string, now: Date): Promise<void> {
  const [accepted] = await db
    .update(eventInvitations)
    .set({ acceptedAt: now, acceptedRegistrationId: registrationId })
    .where(and(eq(eventInvitations.id, invitation.id), invitationOpen()))
    .returning({ id: eventInvitations.id });
  if (!accepted) throw new DomainError("CONFLICT", "the invitation changed state concurrently");
  await recordAuditEvent(db, {
    actorStaffUserId: null,
    participantId: null,
    action: "event.invitation_accepted",
    entityType: "event",
    entityId: invitation.eventId,
    metadata: { invitationId: invitation.id, registrationId, adopted: true },
    now,
  });
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
  /**
   * The registration an invitation's link created (§NNN): the invitation holds its place — counted in
   * `countOccupied`'s `invitationHolds` until the caller marks it accepted, after this — so the place is
   * the registration's own, given here like a family's reserved one, never counted against it.
   */
  { invited = false }: { invited?: boolean } = {},
): Promise<Registration> {
  /*
    A family's reserved place (§543): the sitting's form reserved it under this same lock when it was
    sent, and it is counted in `countOccupied` since — so it is this registration's own, given to it
    here rather than counted against it. Read before the sweep below, which clears a lapsed one.
  */
  const reserved = await repo.holdsFamilyReservation(db, registrationId, now);
  /*
    …and a place a family sitting held for this person without a registration of its own (§543, the
    review of 2026-09-28, round five): a later sitting's form for somebody whose earlier reservation
    had lapsed. It goes before the count, so the person's own held place is never counted against them.
  */
  await releaseOwnFamilyPlaceHold(db, event.id, registrationId);
  /*
    The address's own open invitation (§NNN; the invitations review of 2026-10-02): a registration of
    the invited address that reaches the allocator by another route — the public form and its
    confirmation, a staff entry, the desk, a restart, a late signature — takes the invitation over
    rather than waiting behind a place held in its own name. The place is this registration's, as a
    family's reserved one is; the invitation's «În afara locurilor» comes with it, as the link's press
    copies it; and the invitation is marked accepted after the transition, so the place moves from the
    invitation's bucket to the hold with no instant where it is free. Never when the caller is the
    link's press, which marks its own.
  */
  const adopted = invited ? undefined : await invitationToAdopt(db, event.id, registrationId, now);
  if (adopted?.outsideCapacity) {
    await db.update(registrations).set({ outsideCapacity: true, updatedAt: now }).where(eq(registrations.id, registrationId));
  }
  /*
    «În afara locurilor» (§643): a registration the club seats outside the places consumes none, so it
    is given its place directly whatever the counts — never waitlisted for want of one, never refused by
    a full line. The stale holds still expire and the line is still served first (`placeForNewcomer`),
    as in every capacity-changing transaction; the column is the one condition, `kind` none (§30).
  */
  const outside = await repo.isOutsideCapacity(db, registrationId);
  const { free, counts, eligibleWaitlisted } = await placeForNewcomer(db, event, now, settings);
  // An invitation's held place is this registration's (§NNN), as a family's reserved one is.
  let direct = outside || reserved || invited || adopted !== undefined || free;

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
      // Never past somebody waiting (§615): a full line with people waiting in it refuses, as above.
      direct = !newcomerJoinsLine({ waitlisted: eligibleWaitlisted }) && hasDirectAvailability({ capacity: event.capacity, occupied: computeOccupied(after), eligibleWaitlisted });
    }
    if (!direct) throw waitlistFullError(event.waitlistCapacity);
  }

  const updated = direct
    ? await repo.transitionRegistration(db, {
        id: registrationId,
        to: "PENDING_DECLARATION",
        /*
          Out of the line, or out of an open offer, straight to a declaration only outside the places
          (§643): a counted place reaches the line as an offer, and an offer it made is signed or lapses.
        */
        fromStatuses: allowedFromStatuses("PENDING_DECLARATION").filter((from) => outside || (from !== "WAITLISTED" && from !== "WAITLIST_OFFERED")),
        changes: {
          holdExpiresAt: computeDeclarationHoldExpiry({
            now,
            /*
              An invitation's registration (§NNN) is capped by the start alone: the club may invite after
              the public close, and the close is the public door's — as «Dă-i un loc acum»'s place is.
            */
            registrationClosesAt: invited ? null : event.registrationClosesAt,
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
        // A family's lapsed reservation, if any, goes (§543): nothing is held on the waiting list.
        changes: { waitlistedAt: now, holdExpiresAt: null },
        now,
      });

  if (!updated) {
    throw new DomainError("CONFLICT", "this registration changed state concurrently");
  }

  if (adopted) {
    await markInvitationAdopted(db, adopted, updated.id, now);
    /*
      The invitation's place is this registration's now. When the registration needed none of it — a
      row outside the places, a family's own reserved place, a place that was free anyway — the place
      the invitation held is free from here, and it is the line's, as the event's setting says.
    */
    await fillAvailableSpots(db, event, now, settings);
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

  // A held place carries no race number: the number comes with the confirmation (§548).
  return updated;
}

/**
 * The confirmation a signature earns (§91: the QR and the number) — one person's, or, for a person
 * the family's one button confirmed (§519), the family's one confirmation with everybody's QR code,
 * desk code and race number (`queueFamilyConfirmed`), for as long as it has not left. The signed
 * declaration's copies and the club's notice stay one per person, whoever the confirmation names.
 */
async function enqueueConfirmation<T extends Record<string, unknown>>(tx: Transaction<T>, confirmed: Registration, now: Date): Promise<void> {
  const recipientEmail = await deliveryEmailOf(tx, confirmed.participantId);
  const sitting = await confirmedSittingOf(tx, confirmed.id);
  if (sitting && (await queueFamilyConfirmed(tx, sitting, confirmed, recipientEmail, now))) return;
  await enqueueEmail(tx, {
    participantId: confirmed.participantId,
    registrationId: confirmed.id,
    messageType: "REGISTRATION_CONFIRMED",
    locale: confirmed.locale,
    recipientEmail,
    payload: {},
    idempotencyKey: `registration:${confirmed.id}:confirmed:${now.toISOString()}`,
    now,
  });
}

/**
 * The message an allocation's outcome earns (§15.2 step 10): the declaration to sign, or
 * "you are on the waiting list". An offer made on the way (§160) already queued its own.
 *
 * The declaration's message is the one that starts the hold the allocation just wrote, so it is
 * marked as such (§513, `startingDeadline`): its send re-bases the hold once, and while it waits
 * in the queue the hold is not lapsed (`repository.ts#awaitingItsFirstEmail`).
 */
async function enqueueAllocationEmail<T extends Record<string, unknown>>(
  db: Transaction<T>,
  allocated: Registration,
  recipientEmail: string,
  idempotencyKey: string,
  now: Date,
  /**
   * A family confirmed in one press (§519): the declaration request waits this long, while the
   * wizard asks the same signatures on the screen, and goes only to whoever is still unsigned then
   * (`familyHeld`, read by the renderer). The waiting-list message is never held.
   */
  declarationNotBefore?: Date,
): Promise<void> {
  const messageType =
    allocated.status === "WAITLISTED" ? "WAITLIST_JOINED" : allocated.status === "PENDING_DECLARATION" ? "COMPLETE_DECLARATION" : null;
  if (!messageType) return;
  const held = messageType === "COMPLETE_DECLARATION" && declarationNotBefore !== undefined;
  await enqueueEmail(db, {
    participantId: allocated.participantId,
    registrationId: allocated.id,
    messageType,
    locale: allocated.locale,
    recipientEmail,
    // The declaration's message starts the hold (§513); a family's held request says so too (`familyHeld`).
    // Held, with the instant it is let go (`familyHeldUntil`, §623).
    payload: messageType === "COMPLETE_DECLARATION" ? startingDeadline(held ? { [FAMILY_HELD]: true, ...familyHeldUntil(declarationNotBefore) } : {}) : {},
    idempotencyKey,
    now,
    ...(held ? { notBefore: declarationNotBefore } : {}),
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
  /*
    «Locurile din lista de așteptare se alocă automat» — «Nu» (§615, amending §104, §587 and §589): the
    organizer hands out every freed or added place, to the person of their choice («Trimite-i oferta»,
    `offerPlaceToByStaff`) or to a walk-in at the desk («Dă-i un loc»). The one gate, here and nowhere
    else: every path that frees or adds a place — a cancellation, an offer's expiry or decline, an
    erasure, a late signature's release, the capacity raised in the editor (§147), the maintenance
    job's sweep — reaches the line only through this function, so each obeys it with no check of its
    own. Read off the event's row inside the caller's transaction, after the caller took the lock, so
    a setting changed a moment ago is the one obeyed and no caller's copy of the event can be stale.
    What expired above stays expired: a lapsed offer or hold frees its place either way; the place
    then waits for the organizer, and newcomers queue behind the people already waiting
    (`placeForNewcomer`).
  */
  if (!(await repo.offersWaitlistAutomatically(db, event.id))) return 0;

  /*
    The offer's deadline, once for every candidate (§420): the club's offer window (§377) at the
    moment the offer is made, capped by the close and the start (BR-REQ-035-02 criterion 3). Once
    the close or the start has passed, that cap is already behind `now`: an offer made then would be
    born lapsed — occupying nothing (`countOccupied` counts an offer only while its deadline is
    ahead), expired by the next pass and handed on, so the job would work down the whole waiting
    list one dead offer per run, emailing each person "a place is yours". No offer is made after
    the close: the list stays WAITLISTED, and closes with the start (`closeWaitlistForStartedEvent`).
    The desk's own promotion (`promoteFromWaitlistByStaff`) is not this path and still works.
  */
  const holdExpiresAt = computeWaitlistOfferExpiry({
    now,
    registrationClosesAt: event.registrationClosesAt,
    eventStartsAt: event.startsAt,
    deadlines: settings,
  });
  if (holdExpiresAt.getTime() <= now.getTime()) return 0;

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
  // Every offer's email and its club copies, sent past the scheduled pass once this request is out (§596).
  const leaveNow: string[] = [];
  for (const candidate of candidates) {
    const offered = await repo.transitionRegistration(db, {
      id: candidate.id,
      to: "WAITLIST_OFFERED",
      fromStatuses: ["WAITLISTED"],
      changes: { offerCreatedAt: now, holdExpiresAt },
      now,
    });
    if (!offered) continue;
    // An offer carries no race number; accepting it is a confirmation, which draws one (§548).
    leaveNow.push(...(await queueSpotOffer(db, offered, now)));
    offers += 1;
  }
  /*
    After this request's response, once the transaction that made the offers has committed: only these
    rows, through the one worker, the day's allowance asked by the batch as for any send (§40: a spent
    one defers them to the job, never drops them). A caller whose transaction rolls back left no row
    for it to find. Outside a request (a script, the tests) it does nothing and the job sends them.
  */
  drainOutboxRowsAfterResponse(leaveNow);
  return offers;
}

/**
 * The offer's email (`WAITLIST_SPOT_OFFER`, «S-a eliberat un loc pentru tine»), queued in the
 * transaction that made the offer — the one message every offer sends, whoever made it: the line's
 * turn (`fillAvailableSpots`) or the organizer's choice («Trimite-i oferta», `offerPlaceToByStaff`,
 * §615). Returns the outbox rows it wrote, for the caller's drain after the response.
 */
async function queueSpotOffer<T extends Record<string, unknown>>(
  db: Transaction<T>,
  offered: Registration,
  now: Date,
  /** «Trimite-i oferta»'s offer (§642): capped by the start alone, at the send's re-base too (`OFFER_UNTIL_START`). */
  { untilStart = false }: { untilStart?: boolean } = {},
): Promise<string[]> {
  const idempotencyKey = `registration:${offered.id}:waitlist-offered:${now.toISOString()}`;
  await enqueueEmail(db, {
    participantId: offered.participantId,
    registrationId: offered.id,
    messageType: "WAITLIST_SPOT_OFFER",
    locale: offered.locale,
    recipientEmail: await deliveryEmailOf(db, offered.participantId),
    /*
      The offer's own first message: its send re-bases the offer once (§513); a resend never does.
      Marked as leaving now (§540), because it does: a freed place is the waiting runner's the
      moment it frees, and under «La trecerea programată» (QA's and production's default) the offer
      sat in the queue until the outbox job's next pass — up to an hour or two on QA — while the
      backoffice already said «Ofertă activă» (§596; the owner, 2026-09-30: «când anulez pe cineva,
      iau automat pe altcineva de pe lista de așteptare»).
    */
    payload: markedForNow(startingDeadline(untilStart ? { [OFFER_UNTIL_START]: true } : {}), "now"),
    idempotencyKey,
    now,
    // Sent by the caller's drain, whatever the timing says; the timing's own drain is not needed for it.
    drainAfter: false,
  });
  return outboxIdsForKey(db, idempotencyKey);
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
  /** How many are in the line right now (`domain/waitlist.ts#waitlistLength`, §587): 0 for an uncapped event. */
  waiting: number;
  /**
   * The two halves of `waiting` (§612, amending §587): the offers still open — a place promised to
   * the head of the line, counted as occupied (`OccupiedCounts.unexpiredWaitlistOfferedHolds`) — and
   * the `WAITLISTED` rows with no offer yet (`countEligibleWaitlisted`). The same two counts the
   * line's length is made of, so the card can say «1 loc oferit din lista de așteptare» instead of
   * counting the person offered as still waiting. 0 for an uncapped event.
   */
  offered: number;
  waitlisted: number;
  /**
   * The confirmed registrations alone (`OccupiedCounts.confirmed`, §615), from the same count: the
   * rest of the occupied places — a pending declaration, an open offer, a family's hold — are in
   * progress. `kind` is in no condition. 0 for an uncapped event.
   */
  confirmed: number;
  /**
   * The occupied places as `occupiedForNewcomer` counts them (`computeOccupied`, §615, less the lapsed
   * declaration holds when the waiting list has no room): confirmed, a pending declaration, an open
   * offer and a family's hold. The same count `availablePlaces` is built on; the display's first
   * number is this value clamped to the capacity. The places line's «în curs de confirmare» is this
   * minus `confirmed`.
   * 0 for an uncapped event.
   */
  occupied: number;
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
  if (event.capacity === null) return { availablePlaces: null, waitlistRoom: null, waiting: 0, offered: 0, waitlisted: 0, confirmed: 0, occupied: 0 };

  const counts = await repo.countOccupied(db, event.id, now);
  const eligibleWaitlisted = await repo.countEligibleWaitlisted(db, event.id);
  const line = { waitlistCapacity: event.waitlistCapacity, waitlisted: eligibleWaitlisted, openOffers: counts.unexpiredWaitlistOfferedHolds };
  // The count the free places are built on, carried to the display as it is (§615): a lapsed
  // declaration hold the line has no room to wait behind is free, not occupied, so the places
  // line and the free line add up to the capacity.
  const occupied = occupiedForNewcomer({ ...line, occupied: computeOccupied(counts), lapsedDeclarationHolds: counts.lapsedDeclarationHolds });
  return {
    availablePlaces: computePublicAvailability({ capacity: event.capacity, occupied, eligibleWaitlisted }),
    waitlistRoom: waitlistRoom(line),
    waiting: waitlistLength(line),
    // The line's two halves, from the same two counts — no query of their own (§612).
    offered: line.openOffers,
    waitlisted: line.waitlisted,
    confirmed: counts.confirmed,
    occupied,
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
  // Somebody waiting: a newcomer joins the line whatever is free (`newcomerJoinsLine`), and the line is full.
  if (!newcomerJoinsLine({ waitlisted }) && hasDirectAvailability({ capacity: row.capacity, occupied, eligibleWaitlisted: waitlisted })) return;
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

export type SubmitRegistrationResult = {
  ok: true;
  /**
   * The registration a **staff** entry created or restarted (§420), so the desk confirms that row
   * and no other — never re-read by address, which on a family's address (§389) can find another
   * runner's row. Also to the confirmation of another person from the email (§446), which then
   * confirms that row. Absent on every answer the public form gives, which stays the same for
   * everybody (§39).
   */
  registrationId?: string;
  /**
   * The family sitting this public submission held its messages in (§519), for the browser's sealed
   * half — null when it held nothing (a re-send about a registration outside the sitting, the
   * address at the club's limit). Only for the action to keep in that cookie: the screen it renders
   * is the same whatever this says (§39).
   */
  sittingId?: string | null;
  /**
   * What the first form of a would-be sitting left for «Da, încă o persoană» to open it with (§536):
   * the registration or kept form it wrote and the message it queued. Null when it left nothing to
   * hold. Only for the action's sealed cookie, like `sittingId` (§39).
   */
  sittingSeed?: SittingSeed | null;
  /**
   * A family sitting's form (§543): the place this form got — `reserved` (its registration's
   * reservation, or a held place when it wrote no registration), or `waitlist` once the address is
   * confirmed — and the sitting's fixed deadline. Only for the action's sealed cookie. Null outside a
   * sitting, and for a correction of a person typed before, whose place is the one they had.
   */
  sittingPlace?: FamilyPlace | null;
  reservedUntil?: Date | null;
};

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
   * This public submission is another person's registration, confirmed from the email sent to an
   * address that is already registered at the event (§389, §446, `REGISTER_ANOTHER_PERSON`): the
   * fields the public form posted and `family-entries.ts` kept, pressed through by the address's
   * owner. The caller has spent the token in the same transaction and names the participant it was
   * issued to; the address is that participant's, never one typed into the form. It changes:
   * - the throttle's bucket (`registration-link-submit`, §389);
   * - the anti-bot checks, skipped — the submission that kept these fields passed them, and a
   *   press behind a token only the inbox holds is not a form a machine timed;
   * - the decision, the link's (`domain/family.ts`) — create, or refuse out loud, behind the token
   *   — with the registrations-per-address limit enforced here, under the event's lock;
   * - no verification email: the press proved the inbox, so the caller confirms the address in the
   *   same transaction (`confirmEmail`) and the new registration goes straight to its place, or to
   *   the waiting list, with its own declaration email. The registration's id comes back for that.
   */
  anotherPerson?: { participantId: string };
  /**
   * The members' session the public form was sent from (§552), read by the action from the account
   * (`getCurrentAccount`, §524): the only door to an event for the members alone. `email` is the
   * account's address, the one the registration is for; a form for any other address is refused.
   * Ignored on every other event.
   */
  member?: { email: string };
  /**
   * The form an invitation's link opened (§NNN), sent with that link: the club named this person and
   * emailed them, and the press behind the link proves the inbox, as the family's link does (§446). The
   * caller has locked the event, found the invitation open and before its deadline, spent the token in
   * the same transaction, and names the participant the invitation was sent to; the address is that
   * participant's, never one typed. It changes:
   * - the public window: the invitation is the door, so a race whose registration has not opened yet,
   *   or is for the members alone (§552), takes the person — the event must still be local, scheduled
   *   and dated, and the invitation's deadline is never after the close or the start;
   * - the anti-bot checks and the full-line refusal, skipped — a press behind a token only the inbox
   *   holds is not a form a machine timed, and the invitation holds the person's place;
   * - the decision, the staff entry's (`domain/family.ts`, `via: "staff"`): this runner again on the
   *   address is refused out loud, anybody else is registered within the club's limit per address; no
   *   family flow, no sitting, no kept form — one person per invitation;
   * - no verification email: the caller confirms the address and seats the registration in the
   *   invitation's place in the same transaction (`seatInvitedRegistration`). The registration's id
   *   comes back for that.
   * Every consent is the person's, as on the public form: the terms, the privacy notice, the fitness
   * statement, the list, the offers.
   */
  invitation?: { participantId: string };
  /**
   * The public form's family sitting (§519): the form is one of several a browser sends in a row
   * for people on one address, with one email at the end. Present on every public form.
   *
   * `joined` is false on a form sent before any «Da, încă o persoană» (§536: no sitting without a
   * press): an ordinary form — its email due at once, no sitting written — that only hands back
   * what «Da» would open a sitting with (`sittingSeed`). It is true on the forms after «Da»; `id` is
   * then the sitting «Da» or an earlier form opened, from the browser's sealed half, or null. Those
   * forms change what is mailed and nothing else — the decision, the lock, the limit and the
   * throttle are the form's own:
   * - a new registration's verification email, and the confirmation of another person (§446), are
   *   held until «Gata» or the club's window (`family-sitting.ts`); from the second person on they
   *   become the one family message;
   * - the same person as a kept form of this sitting replaces it rather than adding one more;
   * - a re-send about a registration of this sitting queues nothing while the sitting holds its
   *   message: that message says it.
   * Everything else — a re-send about a registration outside the sitting, the address at the
   * limit, a verified runner's restart — is sent at once, as without a sitting.
   */
  sitting?: {
    id: string | null;
    joined: boolean;
    /**
     * The form names a person this browser has not typed in the sitting yet (§543,
     * `isNewSittingPerson`): only such a form takes a place, a correction keeps the one it had.
     */
    newPerson?: boolean;
    /** How many people this browser sent in the sitting before this form (§543): the club's limit counts them. */
    people?: number;
    /** The sitting's deadline as the browser's sealed half carries it (§543), for a sitting no row carries yet. */
    reservedUntil?: Date | null;
  };
};

const PUBLIC_ORIGIN: RegistrationOrigin = { source: "PUBLIC", createdByStaffUserId: null };

/**
 * The door of an event for the members alone (§552), for the public form: a members' session, and
 * never the emailed link for another person — one person per account. The same NOT_FOUND an
 * unknown event gives, so a post says nothing about whether such an event exists. A staff entry
 * and the desk are the backoffice's, and pass.
 */
function assertMembersDoor(membersOnly: boolean, origin: RegistrationOrigin): void {
  if (!membersOnly || origin.source !== "PUBLIC") return;
  if (origin.anotherPerson) {
    throw new DomainError("VALIDATION_ERROR", "a members' event takes one person per account: no link for another person", [ANOTHER_LINK_INVALID]);
  }
  if (!origin.member) throw new DomainError("NOT_FOUND", "no such event");
}

/** The account's address against the form's, as the address's identity compares them (§10.4). */
function sameCanonical(accountEmail: string, canonicalEmail: string): boolean {
  try {
    return canonicalizeEmail(accountEmail).canonicalEmail === canonicalEmail;
  } catch {
    return false;
  }
}

/** The queued row, or null when the idempotency key had already been used (`enqueueEmail`). */
async function enqueueVerificationEmail<T extends Record<string, unknown>>(
  db: Transaction<T>,
  participant: Participant,
  registration: Registration,
  now: Date,
  /**
   * What the message says beside its link: `anotherPersonHint` on a re-send for a slip (§446); the
   * `startingDeadline` mark on the message that starts the link (§513), never on a re-send.
   */
  payload: Record<string, unknown> = {},
  /** Held by a family sitting until «Gata» or the club's window (§519). */
  notBefore?: Date,
): Promise<OutboxRow | null> {
  return enqueueEmail(db, {
    participantId: participant.id,
    registrationId: registration.id,
    messageType: "VERIFY_REGISTRATION_EMAIL",
    locale: registration.locale,
    recipientEmail: participant.deliveryEmail,
    payload,
    idempotencyKey: `registration:${registration.id}:verify-requested:${now.toISOString()}`,
    now,
    ...(notBefore ? { notBefore } : {}),
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
 *    `deriveAllowedResendMessageType` the Administrator resend uses (§15.8), minus the waiting
 *    list's message: a participant cannot conjure a declaration link for a registration that is
 *    merely waitlisted, because nothing is waiting on them.
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

  /*
    Only a person who owes a step is sent a link here. The backoffice may resend a waiting person's
    email (§641), but nothing is waiting on them, and this form answers the throttled, silent «send my
    link» of anybody typing an address: a waiting person who fills the registration form again is
    answered there (§217), so the waiting list is left out of this one.
  */
  const sends = active
    .filter((registration) => registration.status !== "WAITLISTED")
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
  // An invitation's form (§NNN): the invitation is the door, as the desk's is — local, scheduled and dated.
  const invited = origin.source === "PUBLIC" && origin.invitation !== undefined;
  assertRegistrationOpen(event, now, atTheDesk || invited);
  // An event for the members alone (§552), before anything is parsed or spent: asked again under the lock.
  if (!invited) assertMembersDoor(event.membersOnly === true, origin);

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
    Another adult on the address (§389, §421): the consents only that adult can give — the health
    note, the socials, the public list, the first-person fitness statement — are dropped whatever
    was posted, before anything reads them. A minor's parent still consents for the child.
  */
  /*
    An event that does not ask the health note (§557): a posted note and its tick are dropped before
    the schema reads them, so a stale form is never refused for a note without its consent. Only
    when the caller said so (`askHealthNote: false`); the lock below decides what is stored either way.
  */
  const posted = event.askHealthNote === false ? withoutHealthNote(rawInput) : rawInput;
  const parsed = schema.safeParse(origin.anotherPerson ? withoutAnotherAdultsConsents(posted, now) : posted);
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
  // Nor is another person's registration confirmed from the email (§446): the submission that kept
  // its fields passed these checks, and the press is behind a token only the inbox holds.
  // Nor an invitation's form (§NNN): behind a token only the inbox holds, like the family's link.
  if (origin.source === "PUBLIC" && !origin.anotherPerson && !invited) {
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
  // Never for an invitation (§NNN): its place is held for the person, whatever the line holds.
  if (!invited) await assertWaitlistCanTakeOneMore(db, event.id, now);

  const privacyNotice = await findCurrentApprovedDocument(db, "PRIVACY_NOTICE", input.locale, now);
  if (!privacyNotice) {
    throw new DomainError(
      "VALIDATION_ERROR",
      "no approved privacy notice exists yet; registration cannot be accepted",
    );
  }
  /*
    The club's terms, accepted expressly on the form (§421): the version in force now is the one the
    tick names and the one recorded. Only where the tick is asked — the public form and the family
    link; a staff entry or a desk walk-in makes it on paper and records none. With no approved terms
    there is nothing to accept, and the registration is refused like one with no privacy notice.
  */
  const terms = origin.source === "PUBLIC" ? await findCurrentApprovedDocument(db, "TERMS", input.locale, now) : undefined;
  if (origin.source === "PUBLIC" && !terms) {
    throw new DomainError("VALIDATION_ERROR", "no approved terms exist yet; registration cannot be accepted");
  }
  /*
    The version shown and the version about to be recorded can differ (§421, finding (7)): a new
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
    const scope = origin.anotherPerson || invited ? "registration-link-submit" : "registration-submit";
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
  const stravaUrl = minor ? null : (input.stravaUrl ?? null);
  const instagramHandle = minor ? null : (input.instagramHandle ?? null);
  /*
    The socials beside the name on the public list (§500), kept only when every condition holds:
    the runner ticked it; ticked the list too (a tick about a list they are not on is about
    nothing); has a Strava link or an Instagram username to print (so never a minor, §323); and the
    privacy notice this registration records — the one they were just given, in their language —
    names `{{participantListSocials}}`, so the consent is always to a text that described it. The
    public list asks again, of the notice in force, before it prints anything.
  */
  const listSocials =
    input.listSocials && !input.listOptOut && (stravaUrl !== null || instagramHandle !== null) && describesListSocials(privacyNotice.body);
  /*
    «Vreau să primesc oferte și beneficii» (§562), kept only when every condition holds: the
    person ticked it; on a public form — a staff entry or the desk never sets it, because staff
    cannot consent for a person (the staff form has no box; a posted one is ignored here); and the
    privacy notice this registration records — the one they were just given, in their language —
    names `{{promotionalMaterials}}`, so a `true` is always consent to a text that described it
    (AGENTS.md §10.8). Stored with the moment. Another adult's family form keeps none (§421,
    `withoutAnotherAdultsConsents` and `withoutAnotherAdultsDetails`). `kind` plays no part: a test
    registration is kept the same way (AGENTS.md §12.6).
  */
  const promoConsent = origin.source === "PUBLIC" && input.promoConsent && describesPromotionalMaterials(privacyNotice.body);
  const details: RegistrationEntryDetails = {
    firstName: input.firstName,
    lastName: input.lastName,
    displayName: input.displayName ?? null,
    birthDate: input.birthDate ?? null,
    sex: input.sex ?? null,
    nationality: input.nationality ?? null,
    // Never null (§510): a staff entry without one lives in Romania, the column's own default —
    // on a restart too, which writes these fields over the old row.
    country: input.country ?? "RO",
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
    stravaUrl,
    instagramHandle,
    // Always a boolean, so a restart (which spreads these details) rewrites the old answer.
    listSocials,
    // Always a boolean and a moment or null, so a restart rewrites the old answer (§562).
    promoConsent,
    promoConsentAt: promoConsent ? now : null,
    clubMemberDeclared: input.clubMemberDeclared,
    // As posted; decided under the event's lock below (§554): kept only when the event gives a shirt.
    tshirtSize: input.tshirtSize,
    healthNotes,
    healthConsentVersion: healthNotes ? privacyNotice.version : null,
    healthConsentAt: healthNotes ? now : null,
    // The statement itself, with the moment it was made (§171). A staff entry leaves it null:
    // the paper declaration at the desk carries it, and nobody declares it on another's behalf.
    fitnessDeclaredAt: input.fitnessDeclared ? now : null,
    rulesAcknowledgedAt: input.rulesAcknowledged ? now : null,
    // The terms version the tick named and the moment (§421); rewritten with everything else on a
    // restart, like `privacy_notice_version`. Null on a staff entry: the paper carries it.
    termsVersion: terms && input.termsAccepted ? terms.version : null,
    termsAcceptedAt: terms && input.termsAccepted ? now : null,
  };

  /** The deadlines this submission created, for the maintenance job (§334); none on a resend. */
  let createdDeadlines = undefined as (Date | null)[] | undefined;
  /** The registration this submission created or restarted, for a staff caller (§420); none on a resend. */
  let written = undefined as string | undefined;
  /** The family sitting this public form held its messages in (§519), for the browser's sealed half. */
  let sittingResult = null as string | null;
  /** What the first form leaves for «Da, încă o persoană» to open a sitting with (§536), for the same half. */
  let seedResult = null as SittingSeed | null;
  /** A sitting's form (§543): a place free for a newcomer or not, and until when the sitting's places are reserved. */
  let placeResult = null as FamilyPlace | null;
  let reservedUntilResult = null as Date | null;
  /*
    Another adult on a family's address (§389, §421): the consents only that adult can give are not
    kept — the health note, the socials, the public list, the first-person fitness statement. Since
    §543 a sitting's form for another person is a registration rather than a kept form, and the same
    rule is applied to what it writes; the adult makes them when they sign their own declaration.
  */
  const withoutAnotherAdultsDetails = (kept: RegistrationEntryDetails): RegistrationEntryDetails => ({
    ...kept,
    healthNotes: null,
    healthConsentVersion: null,
    healthConsentAt: null,
    stravaUrl: null,
    instagramHandle: null,
    listSocials: false,
    promoConsent: false,
    promoConsentAt: null,
    fitnessDeclaredAt: null,
  });
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
    A staff entry meets it too since §493: it may enter another person on a registered address, and
    the club's limit is the club's at the desk as on the form.
  */
  const cap = await currentAddressCap(db);

  await db.transaction(async (tx) => {
    /*
      The event row, locked, before anything is read about the address (§389). Which runners the
      address already holds is now what decides between a re-send, the email for another person
      and a new registration — and two members of one family pressing at once must not both find
      the address empty. Taken before the participant row, the order `confirmEmail` takes them in
      (event, then participant), so the two cannot deadlock.
      The price, accepted: every public submission to one event now waits on this row — the silent
      re-send and the email for another person included, not only the insert — so a busy event's
      submissions run one at a time, each a few milliseconds long.
    */
    const locked = await repo.lockEventForCapacity(tx, event.id);
    if (!locked) throw new DomainError("NOT_FOUND", "no such event");
    /*
      The T-shirt (§554), off the locked row and never off the caller's: the size is kept only when
      the event gives a shirt («Kit de participare»); for any other event a posted size — a form
      rendered before the tick came off, a script — is ignored, never refused, and the row says NONE.
      Every door passes here: the public form, the family forms, a staff entry, the desk's walk-in.
    */
    details.tshirtSize = shirtSizeKept(locked.kitShirt, input.tshirtSize);
    /*
      The health note (§557), by the same rule off the same locked row: kept only when the event
      asks it («Condiții de participare» → «Informații medicale»); otherwise a posted note is
      ignored, never refused, and the row stores null with no consent. Every door passes here.
    */
    Object.assign(details, healthNoteKept(locked.askHealthNote, { healthNotes: details.healthNotes, healthConsentVersion: details.healthConsentVersion, healthConsentAt: details.healthConsentAt }));
    // Asked again under the lock (§533): the date held back by a save that committed after the
    // caller read the row. The save counts registrations under this same lock, so a submission and
    // the switch cannot both pass — one waits for the other and finds it.
    if (startHeldBack(locked)) {
      throw new DomainError("VALIDATION_ERROR", "the event's date is to be announced: registration is not open");
    }
    // For the members alone (§552), asked under the lock too: the switch turned on by a save that
    // committed after the caller read the row. And for the account's own address only.
    if (!invited) assertMembersDoor(locked.membersOnly, origin);
    if (!invited && locked.membersOnly && origin.source === "PUBLIC" && origin.member && !sameCanonical(origin.member.email, identity.canonicalEmail)) {
      throw new DomainError("VALIDATION_ERROR", "a members' event is registered for with the account's own address", ["email"]);
    }
    /*
      One person per account (§552): on a members' event the public form never opens the family
      flow — no second person on the address, no sitting, no emailed link for another person. The
      address's one registration is the account holder's; a form with another name re-sends it.
    */
    const onePerAccount = locked.membersOnly && origin.source === "PUBLIC" && !invited;

    const participant = await findOrCreateParticipant(tx, identity, legalName, input.locale, now);
    if (origin.anotherPerson && origin.anotherPerson.participantId !== participant.id) {
      // The caller fixes the address from the token; a mismatch is a caller's bug, never a person's.
      throw new DomainError("VALIDATION_ERROR", "the link for another person belongs to another address", [ANOTHER_LINK_INVALID]);
    }
    if (origin.invitation && origin.invitation.participantId !== participant.id) {
      throw new DomainError("VALIDATION_ERROR", "the invitation belongs to another address");
    }
    const rows = await repo.findRegistrationsByEventAndParticipant(tx, event.id, participant.id);
    // An invitation decides as a staff entry does (§NNN): the club named the person, the name decides.
    const via = origin.anotherPerson ? "link" : origin.source === "STAFF" || invited ? "staff" : "form";
    /*
      Whether the schema lets a second runner onto the address yet (`family-gate.ts`). Asked only
      when the answer can change the decision: a first registration on an empty address is decided
      the same way either way, and costs no catalogue read. The same person again is asked too since
      §446 — whether the re-send may say how to register somebody else depends on it.
    */
    const familyOpen = onePerAccount ? false : via === "link" || rows.length > 0 ? await familyRegistrationOpen(tx) : false;
    // The name and the birth date both decide who this is (§446), and the sex on a shared birth date (§576): the owner's rule, `domain/family.ts`.
    const decision = decideSubmission({ rows, legalName, birthDate: input.birthDate ?? null, sex: input.sex ?? null, via, familyOpen, cap });

    /*
      Behind the emailed link only (§389): whoever holds it has read the address's inbox, so the
      refusal may say what it is about — and it rolls the transaction back, the token's spend
      included, so the same link still works once the name is corrected or a place on the address
      frees up. Each is a marker the form's summary turns into a sentence, never a value.
    */
    if (decision.kind === "refuseClosed") {
      throw new DomainError("VALIDATION_ERROR", "a second person on one address is not available yet", [ANOTHER_LINK_INVALID]);
    }
    /*
      A staff entry hears the same two refusals (§493), with the address box named beside the marker:
      the backoffice form points at the box and says the sentence.
    */
    const addressBox = origin.source === "STAFF" ? ["email"] : [];
    if (decision.kind === "refuseAlreadyRegistered") {
      throw new DomainError("VALIDATION_ERROR", "this runner is already registered on this address", [...addressBox, ALREADY_ON_ADDRESS]);
    }
    if (decision.kind === "refuseAtCap") {
      throw new DomainError("VALIDATION_ERROR", "this address already carries the club's limit of registrations at this event", [...addressBox, ADDRESS_AT_CAP]);
    }
    /*
      A staff entry that finds the address registered, here under the lock (§420): the refusal
      `createRegistrationByStaff` gives before calling in, given again where it cannot be raced. The
      pre-check reads outside the lock, so a public submission on the same address can land between
      the two; the re-send below would then create nothing and return as a success, and the desk's
      fast track would confirm *that* runner — somebody who is not there and signed nothing — on the
      paper of the one who is (BR-REQ-037-07). Refused out loud instead, and rolled back whole: no
      re-send, no audit row, nothing confirmed. A staff entry succeeds only by creating or restarting.
      Since §493 a staff entry reaches a re-send only while the schema holds one registration per
      address; with the family open it decides by the name (`decideSubmission`, via `staff`) and is
      refused above when it is this runner again or the address is at the club's limit.
    */
    if (origin.source === "STAFF" && (decision.kind === "resend" || decision.kind === "offerAnother")) {
      throw new DomainError("VALIDATION_ERROR", "this address already has a registration for this event", ["email"]);
    }
    // An invitation creates or restarts, or refuses (§NNN): the address registered since the send.
    if (invited && (decision.kind === "resend" || decision.kind === "offerAnother")) {
      throw new DomainError("VALIDATION_ERROR", "this address already has a registration for this event", [ALREADY_ON_ADDRESS]);
    }

    /*
      The family sitting (§519): the public form, sent again from the screen after it — «Încă o
      persoană» — for somebody else on the same address. Read under the event's lock, like the
      address's rows above, so two forms of one sitting are one after the other. A sitting that no
      longer takes forms (sent by «Gata», past its window, of another address) is none: this form
      opens a new one where it has something to hold. At a window of 0 («Termene») nothing is held:
      every form's email leaves at once, as before the sitting.

      No sitting without a press (§536, amending §519; the owner, 2026-09-28): a form sent before
      «Da, încă o persoană» is not a sitting's. Its email is due at once and nothing is written for a
      sitting; it only remembers, for the browser's sealed half, what «Da» would take in (`offering`).
    */
    const familyWindow = !onePerAccount && origin.source === "PUBLIC" && !origin.anotherPerson && origin.sitting !== undefined && familySittingHolds(settings);
    const inSitting = familyWindow && origin.sitting?.joined === true;
    const offering = familyWindow && !inSitting;
    let sitting =
      inSitting && origin.sitting?.id
        ? await lockLiveSitting(tx, origin.sitting.id, { eventId: event.id, participantId: participant.id }, now)
        : null;
    const heldUntil = familySittingHeldUntil(now, settings);
    const lockedEvent = withLockedRow(event, locked);
    /*
      The id the browser's half carries (§519): the sitting's, or a random one before any sitting row
      exists — under which the opening «Da» of a first form that wrote nothing held its place (§543,
      `family_place_holds`). A form that opens a sitting while such holds are live opens it under that
      id, adopting them and their deadline.
    */
    const cookieKey = inSitting && origin.sitting?.id && isUuid(origin.sitting.id) ? origin.sitting.id : null;
    // The browser's random id, when no sitting row has it yet: a sitting this form opens takes it, and the holds under it.
    const unusedKey = inSitting && !sitting && cookieKey && !(await findSittingById(tx, cookieKey)) ? cookieKey : null;
    /*
      The deadline the browser's half carries (sealed, §39), while no live sitting row does: the opening
      press's, or the one a form wrote after the last deadline (§543, round four) — so a sitting a later
      form opens keeps it rather than starting its own from that form. Only while it is still ahead.
    */
    const pressDeadline = inSitting && !sitting && origin.sitting?.reservedUntil && origin.sitting.reservedUntil.getTime() > now.getTime() ? origin.sitting.reservedUntil : null;
    /*
      The sitting's reservation deadline (§543, the review of 2026-09-28, round three): fixed when the
      sitting opens — the first form's instant, the club's window and hold, capped by the close and the
      start — and moved by nothing afterwards: every later form's place expires at that same instant. A
      sitting the opening press could not open (its first form wrote nothing) carries it in the browser's
      half until a form opens one. A form that opens a new sitting past it fixes its own from now.
    */
    const reservationUntil =
      sitting?.reservedUntil ??
      pressDeadline ??
      computeFamilyReservationExpiry({
        from: heldUntil,
        registrationClosesAt: lockedEvent.registrationClosesAt,
        eventStartsAt: lockedEvent.startsAt,
        deadlines: settings,
      });
    /** A sitting this form opens (§519), with the deadline above and, while no row has it, the browser's id. */
    const newSitting = (registrationId: string) =>
      openSitting(tx, {
        ...(unusedKey ? { id: unusedKey } : {}),
        eventId: event.id,
        participantId: participant.id,
        registrationId,
        locale: input.locale,
        heldUntil,
        reservedUntil: reservationUntil,
        now,
      });
    /** Every public path below ends here: the sitting's window moves on, and the browser keeps its id. */
    const finishSitting = async () => {
      if (!inSitting) return;
      reservedUntilResult = reservationUntil;
      /*
        A form that wrote no registration of its own (§543, the review of 2026-09-28, rounds three and
        four; §39, AGENTS.md §19.4): a kept form at the address's limit, a person the address already
        holds, a re-send. Its person's place is decided here from the sitting's rows (`sittingPlaceOf`):
        the sitting's registration for them, or their one held place — taken now, or found taken — so a
        form adds one counted place per person, once, as a fresh address's form does, and a replayed
        sealed half adds nothing either way. The browser's half only withholds: a form it reads as a
        correction or a birth-date clash (`isNewSittingPerson` false) takes nothing, for every address.
      */
      if (origin.sitting?.newPerson === true && placeResult === null) {
        placeResult = await sittingPlaceOf(tx, lockedEvent, { sitting, sittingKey: sitting?.id ?? cookieKey, participantId: participant.id }, legalName, now, settings, reservationUntil);
      }
      if (!sitting) return;
      await settleSitting(tx, sitting, { heldUntil, recipientEmail: participant.deliveryEmail, now });
      // A sitting opened before the deadline was kept (§543): this form fixes it, once.
      if (sitting.reservedUntil === null) await tx.update(familySittings).set({ reservedUntil: reservationUntil }).where(eq(familySittings.id, sitting.id));
      sittingResult = sitting.id;
    };
    const keptInSitting = sitting ? await liveSittingEntries(tx, sitting.id, now) : [];
    /*
      A form this sitting kept, named again (§519). Asked only where the address's registrations call
      the form another person: a form that is the same as a registration is that registration's
      re-send, sitting or not.

      - The same name (`sameRunner`): the newer form replaces the kept one — a corrected birth date,
        the name's spelling — rather than keeping the person twice for the one button.
      - Another name on a kept form's birth date (§493: twins, or a corrected name): neither replaced
        nor added. Overwriting would drop the first person without a word; the screen after the form
        says what happened and what to do, by the same rule on the browser's own forms
        (`withSittingPerson`), and the held message names the kept person as before.
    */
    const sameKept =
      decision.kind === "offerAnother" && keptInSitting.length > 0
        ? sittingEntryFor(
            keptInSitting.map((entry) => {
              const person = personOfEntry(entry);
              return { entry, registeredName: person.legalName, birthDate: person.birthDate, sex: person.sex };
            }),
            { legalName, birthDate: input.birthDate ?? null, sex: input.sex ?? null },
          )
        : null;
    if (sameKept?.kind === "sameBirthDate") {
      await finishSitting();
      return;
    }
    if (sameKept) {
      const expiresAt = emailLinkExpiresAt(now, settings);
      await replaceFamilyEntry(tx, sameKept.entry.entry.id, {
        fields: familyEntryFields(input as unknown as Record<string, unknown>, now),
        locale: input.locale,
        expiresAt,
      });
      createdDeadlines = [expiresAt];
      await finishSitting();
      return;
    }
    /*
      The club's limit counts the sitting's kept forms too (§519): each is somebody the one button
      will register, and a fifth child typed into a sitting of four would only be refused at the
      press. At the limit the address hears so at once, as without a sitting (§389).
    */
    const atCap =
      decision.kind === "offerAnother" &&
      (decision.atCap || (keptInSitting.length > 0 && !addressHasRoom(rows.filter((row) => isActiveStatus(row.status)).length + keptInSitting.length, cap)));

    /*
      The club's limit, said at the form (§543; the brief's «refused with its sentence at the form»):
      when the people this browser already sent in this sitting fill the limit on their own, the next
      form is refused out loud and nothing is written. Every person it counts was typed on this
      browser, so the refusal says nothing about the address (§39). A limit reached with registrations
      from elsewhere is still told to the address alone, by its email (§389).
    */
    if (inSitting && decision.kind === "offerAnother" && atCap) {
      /*
        The sitting's own people: its registrations waiting for the address, and its held places — one
        for each form that wrote no registration (a kept form among them), so an address that already
        holds people is refused at the same form as a fresh one (§39).
      */
      const holdsKey = sitting?.id ?? cookieKey;
      const written = (sitting ? (await sittingPendingRegistrations(tx, sitting)).length : 0) + (holdsKey ? (await repo.liveFamilyPlaceHolds(tx, holdsKey, now)).count : 0);
      /*
        …and never fewer than the people this browser sent in the sitting (its sealed half). The rows
        count them already, a full event included — a person sent while no place was free is recorded
        under their slot, holding nothing (`writeFamilyPlaceMarker`, round six) — so the half only bounds
        from below: a replayed half counts nothing less.
      */
      const own = Math.max(written, origin.sitting?.people ?? 0);
      /*
        …and never for a person this address already sent in a sitting at this event (§543, the review
        of 2026-09-28, round five; §39): their row, live or lapsed, is there under their slot, in
        whichever sitting — a held place, or the record of a form sent while no place was free (round
        six), so the answer does not depend on whether a place was taken. A fresh address's form for such
        a person is their registration's re-send, which the limit never refuses, so a replayed half —
        from before a sitting's deadline or after it, on a full event or not — is refused for no address.
        The form then adds nothing, or takes the lapsed place once again, as the fresh address's re-send
        does (`sittingPlaceOf`).
      */
      const sentBefore = await familyPlaceHoldTaken(tx, event.id, familyPlaceSlot(event.id, participant.id, legalName));
      if (!sentBefore && !addressHasRoom(own, cap)) {
        throw new DomainError("VALIDATION_ERROR", "this sitting's people already fill the club's limit per address", [SITTING_AT_CAP]);
      }
    }

    /*
      Another person in a family sitting (§543, amending §446 and §519; the owner, 2026-09-28: «în
      ultimul mail primit pentru verificare să am toate înscrierile mele; să rezerv 3 locuri și așa să
      se calculeze pe site» — and «pare că nu se salvează corect»). Since «Da» this browser is registering
      a family, so the form is a registration like the first one, not a kept form: the row is written
      now — the backoffice, «Înscrierile mele», a refresh or a second device see it at once — and it
      reserves its place (`reserveFamilyPlace`). Nothing about the address is confirmed: the row waits
      for the family's one email, whose one button confirms everybody. Another adult's own consents
      are not kept (§421), as the kept form never kept them. The same runner's own cancelled row is
      restarted rather than duplicated, and always to the address's confirmation, never straight to a
      place: a form is not the inbox.
    */
    const anotherInSitting = inSitting && decision.kind === "offerAnother" && !atCap;
    const anotherAdult = anotherInSitting && adultOnTheFamilyForm(input.birthDate, now);
    const restartInSitting = anotherInSitting ? rows.find((row) => !isActiveStatus(row.status) && sameRunner(row.registeredName, legalName)) : undefined;

    if (decision.kind === "offerAnother" && !anotherInSitting) {
      /*
        A different person, on an address that is registered here (§389, §446; the owner,
        2026-09-26: "în mail să îți afișez înscrierile și să zic «confirm că înscriu altă persoană»").

        No registration is created. The screen is the one every submission gets — byte for byte,
        since the action cannot tell this return from any other — because saying anything else would
        tell a stranger which addresses are registered (§39, AGENTS.md §19.4). The answer goes to the
        address: one message listing who the address already holds here and naming the person just
        typed, with one button to confirm them — or, when the address already carries the club's
        limit, the sentence that says so and no button.

        The posted form is kept for that button (`family-entries.ts`): the person's fields, without
        the address and without another adult's own consents (§421), until the club's email-link
        window closes; the maintenance job deletes it then, and the confirmation deletes it when it
        creates the registration. Nothing is kept at the limit — there is nothing to confirm. The
        token is minted at send time and hashed at rest (§12.8, §14.5), scoped to the registration
        the address holds here, and the renderer ties it to this entry, so it names the event, the
        participant and this one person, and nothing a stranger typed can reach another inbox.
      */
      // In a sitting (§519), the kept form joins it, and its message waits with the sitting's others.
      if (inSitting && !atCap && !sitting) sitting = await newSitting(decision.about.id);
      const holding = inSitting && !atCap && sitting !== null;
      const entry = atCap
        ? null
        : await insertFamilyEntry(tx, {
            eventId: event.id,
            participantId: participant.id,
            registrationId: decision.about.id,
            locale: input.locale,
            fields: familyEntryFields(input as unknown as Record<string, unknown>, now),
            expiresAt: emailLinkExpiresAt(now, settings),
            now,
            sittingId: holding && sitting ? sitting.id : null,
          });
      if (entry) createdDeadlines = [entry.expiresAt];
      const queued = await enqueueEmail(tx, {
        participantId: participant.id,
        registrationId: decision.about.id,
        messageType: "REGISTER_ANOTHER_PERSON",
        // The language of the form just filled in: this answers that submission.
        locale: input.locale,
        recipientEmail: participant.deliveryEmail,
        // What was decided now, not what the setting says when the message renders: the email and
        // the decision must agree, and the confirmation asks the limit again under the lock anyway.
        // The entry by its id alone — never a name or a date in the outbox (§12.12).
        // The entry's link starts with this message (§513): each submission is a new entry and its own first send.
        // Held in a live sitting, it says so (`FAMILY_HELD`, §540): the queue panel (§529) counts it as
        // the family's hold, not as a retry. The renderer ignores the flag on this message.
        payload: entry
          ? startingDeadline({
              atCap: false,
              registrationsPerAddress: cap.registrationsPerAddress,
              familyEntryId: entry.id,
              ...(holding ? { [FAMILY_HELD]: true, ...familyHeldUntil(heldUntil) } : {}),
            })
          : { atCap, registrationsPerAddress: cap.registrationsPerAddress },
        idempotencyKey: `registration:${decision.about.id}:another-person:${now.toISOString()}`,
        now,
        // Held with the sitting's others until «Gata» or the window (§519); at the limit, at once.
        ...(holding ? { notBefore: heldUntil } : {}),
      });
      if (holding && sitting) sitting = await holdInSitting(tx, sitting, { outboxId: queued?.id ?? null });
      // Before «Da» (§536): the kept form and its message, due at once, for «Da» to take in.
      if (offering && entry) seedResult = { kind: "entry", id: entry.id, outboxId: queued?.id ?? null };
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
      await finishSitting();
      return;
    }

    const existing = decision.kind === "resend" || decision.kind === "restart" ? decision.registration : restartInSitting;

    /*
      The same person as a registration this sitting created (§519), while the sitting holds its
      message: that message says what a re-send would. Nothing more is queued; the club's record
      still has the line (§312), and says the truth: the held message is the one that will leave,
      once — `held: true` beside its type, so the timeline reads "already waiting to leave" rather
      than "re-sent" or "nothing to re-send". Only inside a sitting, after «Da» (§536): one person
      sent twice before any press is the ordinary re-send below, and so is a sitting that holds
      nothing — «Da» came after the first email had left.
    */
    if (
      existing &&
      isActiveStatus(existing.status) &&
      sitting &&
      sitting.registrationIds.includes(existing.id) &&
      (await sittingHasMessageToLeave(tx, sitting))
    ) {
      /*
        The same name as the sitting's own registration, still waiting for the address (§543): the
        newer form corrects it — a birth date, a phone — as it replaced a kept form before (§519),
        rather than the corrected form being dropped while the screen lists the correction. Another
        adult's own consents stay unkept (§421): a row written without the fitness statement was one.
      */
      if (existing.status === "PENDING_EMAIL_CONFIRMATION" && sameRunner(existing.registeredName, legalName)) {
        const corrected = existing.fitnessDeclaredAt === null && adultOnTheFamilyForm(input.birthDate, now) ? withoutAnotherAdultsDetails(details) : details;
        await tx
          .update(registrations)
          .set({
            ...corrected,
            registeredName: legalName,
            nameKey: registrationNameKey(legalName),
            displayName: resolveDisplayName({ displayName: input.displayName, firstName: input.firstName, lastName: input.lastName, legalName }),
            ...(corrected.fitnessDeclaredAt === null ? { listOptOut: true } : {}),
            updatedAt: now,
          })
          .where(eq(registrations.id, existing.id));
        // The form's answer on «Oferte și beneficii», on the trail with its moment (§562).
        await recordFormPromoConsent(tx, { registrationId: existing.id, participantId: participant.id, kept: corrected.promoConsent === true, before: existing.promoConsent, now });
      }
      /*
        A correction keeps the person's place (§543): reserved while it holds, the waiting list otherwise.
        A form the browser's half reads as a new person — a sealed half replayed from before this person's
        form — finds the same registration and adds nothing, and takes a place only where the person holds
        none, exactly as the same form finds a held place (`sittingPlaceOf`, round four; §39).
      */
      placeResult =
        origin.sitting?.newPerson === true
          ? await sittingPlaceOf(tx, lockedEvent, { sitting, sittingKey: sitting.id, participantId: participant.id }, legalName, now, settings, reservationUntil)
          : (await repo.holdsFamilyReservation(tx, existing.id, now))
            ? "reserved"
            : "waitlist";
      await recordAuditEvent(tx, {
        actorStaffUserId: null,
        participantId: participant.id,
        action: "registration.resubmitted",
        entityType: "registration",
        entityId: existing.id,
        metadata: { status: existing.status, resent: "VERIFY_REGISTRATION_EMAIL", held: true },
        now,
      });
      await finishSitting();
      return;
    }

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
        waiting-list offer, the confirmation with its QR, or the waiting list's own email.

        The throttle in front of the form is what keeps this from being a mailer: the same person
        can only ask so often (§19.4), and each message goes to the address that asked for it.
      */
      /*
        A waiting-list entry has no link to re-send and still owes an answer (§217).

        A person queued for a place has no link and nothing to do, so «send me my link»
        (`requestRegistrationLink`) leaves them out. But this is somebody typing their address
        into the form a second time because they are not sure the first time worked, and
        answering that with the "check your email" screen and no message is the §217 failure
        exactly.

        So the public path sends `WAITLIST_JOINED` again, which is the message that answers the
        question actually being asked: you are on the list, this is your position, nothing is
        owed from you. The throttle above is what keeps this from becoming a mailer. The
        backoffice's resend sends the same message to a waiting row (§641).
      */
      const messageType = deriveAllowedResendMessageType(existing.status);
      // Whether a row was actually queued, for the club's record below: a key already used — two
      // presses in the same millisecond — queues nothing, and the record must not say otherwise.
      let queued: OutboxRow | null = null;
      /*
        Only one of the name and the birth date matched (§446): the owner's rule reads it as a slip,
        so nothing was created — and the message, in the one place it may be said, adds how to
        register somebody else: the form again, with that person's full name and birth date.
      */
      // …and, for another name on a registered birth date, how twins are registered (§493).
      const hint =
        decision.kind === "resend" && decision.notAnotherPerson === true
          ? { anotherPersonHint: true, ...(decision.sameBirthDate === true ? { sameBirthDateHint: true } : {}) }
          : {};
      if (messageType === "VERIFY_REGISTRATION_EMAIL") {
        queued = await enqueueVerificationEmail(tx, participant, existing, now, hint);
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
          payload: { alreadyRegistered: true, ...hint },
          // Per submission, so two genuine attempts an hour apart are two messages; the throttle
          // bounds them rather than a key collision silently swallowing the second.
          idempotencyKey: `registration:${existing.id}:resubmitted:${now.toISOString()}`,
          now,
        });
      }
      /*
        …and the club learns it too (§312).

        A colleague registered with her browser's autofill, twice; she was told in the second
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
        // The person themselves, so no actor. A staff entry never reaches this line since §420: it
        // is refused out loud above, under the lock, as `createRegistrationByStaff` refuses it
        // before calling in. The staff id stays as the truthful answer should that ever change.
        actorStaffUserId: origin.source === "STAFF" ? (origin.createdByStaffUserId ?? null) : null,
        participantId: participant.id,
        action: "registration.resubmitted",
        entityType: "registration",
        entityId: existing.id,
        metadata: { status: existing.status, resent: queued && messageType ? messageType : null },
        now,
      });
      await finishSitting();
      return;
    }

    /*
      A new registration of a sitting (§519): its verification email waits with the sitting's others,
      and the sitting — opened by this form when it is the first to hold anything — names it among
      the registrations its one button confirms. Outside a sitting, the email goes at once; before
      «Da» (§536) it is remembered for that press, unmarked — «Da» marks it held only when it takes
      it in (`continueFamilySitting`; the review of 2026-09-28, nit F1). Either way it is the message
      that starts the link (`startingDeadline`, §513): its send re-bases it.
    */
    const holdVerification = async (registration: Registration) => {
      if (!inSitting) {
        const queued = await enqueueVerificationEmail(tx, participant, registration, now, startingDeadline());
        if (offering) seedResult = { kind: "registration", id: registration.id, outboxId: queued?.id ?? null };
        return;
      }
      sitting ??= await newSitting(registration.id);
      const queued = await enqueueVerificationEmail(tx, participant, registration, now, startingDeadline({ [SITTING_HELD]: true, ...familyHeldUntil(heldUntil) }), heldUntil);
      sitting = await holdInSitting(tx, sitting, { registrationId: registration.id, outboxId: queued?.id ?? null });
      // Its place, reserved now (§543): the family's count drops by one with every form, not at the press.
      placeResult = await reserveFamilyPlace(tx, lockedEvent, registration.id, now, settings, reservationUntil);
    };

    // Another adult of a family sitting (§543, §421): their own consents are not kept.
    const rowDetails = anotherAdult ? withoutAnotherAdultsDetails(details) : details;
    const rowListOptOut = anotherAdult ? true : input.listOptOut;

    const carriedFields = {
      registeredName: legalName,
      // The runner's key follows the name (§389): one address, several runners, told apart by it.
      nameKey: registrationNameKey(legalName),
      // A restart records what the person answered *now*. Carrying last year's t-shirt size
      // forward because a cancelled row happened to hold one is not a kindness.
      ...rowDetails,
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
      listOptOut: rowListOptOut,
      // Carried on a restart too: the row should say who put this registration here *now*, not
      // who put an earlier, cancelled one here months ago.
      source: origin.source,
      createdByStaffUserId: origin.createdByStaffUserId ?? null,
      /*
        «În afara locurilor» does not survive a restart (§643; the review of 2026-10-02, finding 6): the
        mark is an Administrator's audited act on a registration, and a seat beyond the announced places
        is given only by an Administrator acting at the time. A cancelled or expired row the person
        restarts through the form is a new cycle that queues and counts like anybody's; the club marks it
        again if it still wants to.
      */
      outsideCapacity: false,
    };

    if (existing) {
      // The mark's end is written in the journal too, by nobody (the person restarted), never a name.
      if (existing.outsideCapacity) {
        await recordAuditEvent(tx, {
          actorStaffUserId: null,
          participantId: participant.id,
          action: "registration.outside_capacity_changed",
          entityType: "registration",
          entityId: existing.id,
          metadata: { from: true, to: false, status: existing.status, restarted: true },
          now,
        });
      }
      // A restart of a Cancelled or Expired registration (AGENTS.md §10.5). Never leapfrogs
      // the waiting list and never lands directly on Confirmed — `allocateOrWaitlist` is the
      // same allocator a first-time registration uses.
      // Another person in a family sitting always waits for the family's one email (§543): a form is not the inbox.
      // An invitation's restart waits for the caller's confirmation in this transaction (§NNN), as a new one does.
      if (!participant.emailVerifiedAt || anotherInSitting || invited) {
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
          /*
            An old hold goes (§543): a restarted row waiting for its address holds no place, whatever a
            cancelled declaration hold or offer left in the column — only a family sitting's form reserves
            one, below (`holdVerification`), so a single registration is never counted before its address.
          */
          changes: { ...carriedFields, emailLinkExpiresAt: linkExpiresAt, holdExpiresAt: null },
          now,
        });
        // Not for another person confirmed from the email (§446): the caller confirms the address itself.
        // The link of this cycle starts with this message (§513): its send re-bases it, once.
        if (restarted && !atTheDesk && !origin.anotherPerson && !invited) await holdVerification(restarted);
        if (restarted) await recordFormPromoConsent(tx, { registrationId: restarted.id, participantId: participant.id, kept: rowDetails.promoConsent === true, before: existing.promoConsent, now });
        createdDeadlines = [linkExpiresAt];
        written = restarted?.id;
        await finishSitting();
        return;
      }

      await tx
        .update(registrations)
        .set({ ...carriedFields, updatedAt: now })
        .where(eq(registrations.id, existing.id));
      await recordFormPromoConsent(tx, { registrationId: existing.id, participantId: participant.id, kept: rowDetails.promoConsent === true, before: existing.promoConsent, now });

      // The event row first, like every other allocation (rule 1 above, §10.6): a verified
      // participant's restart used to allocate against the capacity the page had read, with
      // no lock — the one door into the allocator that skipped the serialization point
      // (`DECISIONS.md` §151). Held since the transaction's first statement (§389).
      const allocated = await allocateOrWaitlist(tx, withLockedRow(event, locked), existing.id, now, settings);
      // In a sitting (§543): the place the allocator gave, or the line — never a held place besides.
      if (inSitting) placeResult = allocated.status === "WAITLISTED" ? "waitlist" : "reserved";
      await enqueueAllocationEmail(tx, allocated, participant.deliveryEmail, `registration:${allocated.id}:restart:${now.toISOString()}`, now);
      // A hold, a place on the waiting list, or an offer made on the way to somebody else when
      // the allocator released a lapsed hold (§160) — the same deadlines `confirmEmail` wakes for.
      createdDeadlines = [allocated.holdExpiresAt, joinedQueue(allocated) ? offerDeadline(event, now, settings) : null];
      written = allocated.id;
      await finishSitting();
      return;
    }

    // When the link lapses unconfirmed, written on the row (§377): the club's hours now, kept however they change.
    const linkExpiresAt = emailLinkExpiresAt(now, settings);
    const created = await repo.insertPendingEmailRegistration(tx, {
      emailLinkExpiresAt: linkExpiresAt,
      eventId: event.id,
      participantId: participant.id,
      kind,
      locale: input.locale,
      registeredName: legalName,
      details: rowDetails,
      privacyNoticeVersion: privacyNotice.version,
      privacyAcknowledgedAt: now,
      raceId: event.raceId,
      resultsNameConsent: input.resultsNameConsent,
      resultsConsentVersion: privacyNotice.version,
      listOptOut: rowListOptOut,
      source: origin.source,
      createdByStaffUserId: origin.createdByStaffUserId ?? null,
      now,
    });
    // No race number at the form: it is drawn when the registration is confirmed (§548).
    // A tick the form kept, on the trail with its moment (§562): it outlives a later withdrawal.
    await recordFormPromoConsent(tx, { registrationId: created.id, participantId: participant.id, kept: rowDetails.promoConsent === true, before: false, now });

    // At the desk the address is about to be vouched for by the person typing it
    // (BR-REQ-037-07); a verification email to somebody standing in front of them is noise.
    // Nor another person confirmed from the email (§446): the press proved the inbox, and the
    // caller confirms the address in this same transaction (`family-confirm.ts`).
    // The first message of the registration starts its email link (§513): its send re-bases it, once.
    // Nor an invitation's form (§NNN): the link proved the inbox, and the caller seats the registration.
    if (!atTheDesk && !origin.anotherPerson && !invited) await holdVerification(created);
    createdDeadlines = [linkExpiresAt];
    written = created.id;
    await finishSitting();
  });

  // A resend creates nothing; anything else may, and the job is told when it matters (§334).
  // A family's reservation lapses too (§543): the place goes back to whoever waits.
  if (createdDeadlines !== undefined || reservedUntilResult !== null) {
    // A sitting's places lapse at its fixed deadline (§543): the job is told when.
    wakeMaintenance(event, now, settings, ...(createdDeadlines ?? []), reservedUntilResult);
  }

  // To a staff caller (§420), and to the confirmation from the email (§446), which confirms that row
  // and no other: the public form's answer stays byte for byte the same for everybody (§39).
  const answer: SubmitRegistrationResult =
    (origin.source === "STAFF" || origin.anotherPerson || invited) && written !== undefined ? { ok: true, registrationId: written } : { ok: true };
  // The sitting's id for the browser's sealed half (§519) — never for the screen, which is the same for all.
  return origin.sitting !== undefined && origin.source === "PUBLIC" && !origin.anotherPerson && !invited
    ? { ...answer, sittingId: sittingResult, sittingSeed: seedResult, sittingPlace: placeResult, reservedUntil: reservedUntilResult }
    : answer;
}

// --- §15.2 Email confirmation ------------------------------------------------------------------

/** Consumed after the participant's `VERIFY_REGISTRATION_EMAIL` token is spent. */
export async function confirmEmail<T extends Record<string, unknown>>(
  db: Database<T>,
  event: EventForRegistration,
  registrationId: string,
  now: Date,
  /** A family confirmed in one press (§519): the declaration request waits for the wizard (`enqueueAllocationEmail`). */
  options: { declarationNotBefore?: Date } = {},
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
      would allocate a place and send "sign the declaration" for a
      race that will not happen — so nothing is written and nothing is sent. The registration is
      returned still unconfirmed, which is how the confirmation page knows to say why rather
      than "confirmed, now sign" (`registrations/confirm/[token]/actions.ts`), and it lapses with
      the other unconfirmed ones when its link does (§377). Read under the event lock, so a
      cancellation that lands between the click and this line is the one that counts.
    */
    if (lockedEvent.eventStatus !== "SCHEDULED") return { registration: current, allocated: false };

    /*
      The link has lapsed (§377, §420; BR-REQ-031-03 criterion 2): evaluated here against `now`,
      never trusting that the job has run since (§10.6). A click after the lapse and before the next
      sweep used to confirm and allocate a registration its own link had already given up on. It is
      lapsed here exactly as the sweep would lapse it, and
      returned so, which the confirmation page reads as "lapsed, register again", never "confirmed".
    */
    const lapsesAt = current.emailLinkExpiresAt ?? new Date(current.submittedAt.getTime() + settings.confirmationHours * 60 * 60_000);
    if (lapsesAt.getTime() <= now.getTime()) {
      const lapsed = await repo.transitionRegistration(tx, {
        id: current.id,
        to: "EXPIRED",
        fromStatuses: ["PENDING_EMAIL_CONFIRMATION"],
        changes: { expiredAt: now, expiryReason: "EMAIL_CONFIRMATION_LAPSED" },
        now,
      });
      return { registration: lapsed ?? current, allocated: false };
    }

    await markEmailVerified(tx, current.participantId, now);
    let allocated = await allocateOrWaitlist(tx, withLockedRow(event, lockedEvent), current.id, now, settings);
    /*
      A family confirmed in one press (§519): the declaration request waits for the wizard, and the
      hold counts from the moment it can leave, never before — the allocator's own formula at that
      instant, written to the allocator's own column, so the sweep and the message read one value. A
      hold the close or the start cuts before then is not waited on: the request leaves now.
    */
    let declarationNotBefore = options.declarationNotBefore;
    if (declarationNotBefore && allocated.status === "PENDING_DECLARATION") {
      const locked = withLockedRow(event, lockedEvent);
      const held = familyHeldDeclaration({
        holdExpiresAt: allocated.holdExpiresAt,
        releaseAt: declarationNotBefore,
        now,
        computeHold: (at) =>
          computeDeclarationHoldExpiry({
            now: at,
            registrationClosesAt: locked.registrationClosesAt,
            eventStartsAt: locked.startsAt,
            window: confirmationWindow(locked),
            deadlines: settings,
          }),
      });
      declarationNotBefore = held.notBefore;
      if (held.holdExpiresAt && held.holdExpiresAt.getTime() !== allocated.holdExpiresAt?.getTime()) {
        const [moved] = await tx
          .update(registrations)
          .set({ holdExpiresAt: held.holdExpiresAt, updatedAt: now })
          .where(and(eq(registrations.id, allocated.id), eq(registrations.status, "PENDING_DECLARATION")))
          .returning();
        if (moved) allocated = moved;
      }
    }
    await enqueueAllocationEmail(
      tx,
      allocated,
      await deliveryEmailOf(tx, current.participantId),
      `registration:${allocated.id}:email-confirmed:${now.toISOString()}`,
      now,
      declarationNotBefore,
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

/**
 * One click of a verification link proves the inbox, not one person (§588, amending §389, §446 and
 * §543). The registration the link was minted for is confirmed first, exactly as `confirmEmail`
 * always did — its own refusal (no place and the line full, §348) still takes the whole press back,
 * the token spend included. Then every other registration of the same address at the same event
 * still waiting for the address, submitted before this click and with its own link alive, moves on
 * with it, in the order they were submitted: each through `confirmEmail`, so each through the one
 * allocator under the event's lock (AGENTS.md §10.6) — nobody outside the address is leapfrogged,
 * and a full event puts them on the waiting list. One of them refused by a full line stays waiting
 * for its own link; it never undoes the others. A form sent after the click is not read: the event
 * row is locked first, and the query asks `submitted_at <= now` besides, so a stranger typing a proved
 * address still waits for the inbox's own click.
 */
export async function confirmEmailOnAddress<T extends Record<string, unknown>>(
  db: Database<T>,
  event: EventForRegistration,
  registrationId: string,
  now: Date,
): Promise<{ registration: Registration; alsoConfirmed: Registration[] }> {
  const settings = await currentDeadlines(db);
  return db.transaction(async (tx) => {
    // The serialization point first (§10.6): the address's rows are read under it.
    await repo.lockEventForCapacity(tx, event.id);
    const clicked = await repo.findRegistrationById(tx, registrationId);
    const waiting = clicked
      ? await repo.pendingEmailRegistrationsOnAddress(tx, {
          eventId: clicked.eventId,
          participantId: clicked.participantId,
          now,
          confirmationHours: settings.confirmationHours,
        })
      : [];
    // The clicked link itself decides whether anything is proved: lapsed, off or already used, nobody else moves.
    const proves = waiting.some((row) => row.id === registrationId);
    const registration = await confirmEmail(tx, event, registrationId, now);
    if (!proves || registration.status === "PENDING_EMAIL_CONFIRMATION") return { registration, alsoConfirmed: [] };
    const alsoConfirmed: Registration[] = [];
    for (const row of waiting) {
      if (row.id === registrationId) continue;
      try {
        alsoConfirmed.push(await confirmEmail(tx, event, row.id, now));
      } catch (error) {
        // The line full for this one (§348): its savepoint is gone, it waits for its own link.
        if (!waitlistRefusalOf(error)) throw error;
      }
    }
    return { registration, alsoConfirmed };
  });
}

/**
 * The audit action of a supplementary place (§642), one per verb that may add it: «Trimite-i oferta»
 * (`offerPlaceToByStaff`) and «Dă-i un loc acum» (`givePlaceNowByStaff`).
 */
type SupplementaryPlaceAction = "event.capacity_raised_for_offer" | "event.capacity_raised_for_place_now" | "event.capacity_raised_for_invitation";

/**
 * One supplementary place (§642; the owner, 2026-10-02: «Vreau să pot „oferi loc” în orice moment,
 * chiar și pe liste suplimentare»), for an Administrator's press that gives one chosen person a place
 * on a capped event with none free. Called under the event lock the caller holds, after the stale holds
 * were expired and the places counted (`counts`), and only when `computeOccupied(counts) >= capacity`.
 * **Only on a confirmed press** («vreau confirmare când depășesc limita»): `confirmedTo` is the capacity
 * the dialog named and the Administrator pressed through («capacitatea devine {n}», the form's
 * `addPlace`); unless it is exactly `capacity + 1` of the locked row — the page was read while a place
 * was free, so the question and its button were the plain ones, or before another Administrator's raise
 * — the press is refused with `SUPPLEMENTARY_PLACE_UNCONFIRMED` before anything is written, and the
 * page it lands on asks again with the numbers of now. Then `capacity + 1` on this one event row (`addSupplementaryPlace`; a series' other dates keep theirs),
 * the trail row naming the Administrator (the actor), the event (the entity), from, to and the
 * registration the place is for (an id, never a person, §12.12) — in the caller's transaction, whose
 * transition then occupies the place before `fillAvailableSpots` runs. Never overbooking: should the
 * count still be full after the one place (a count above the capacity, which no path writes), §589's
 * `NoFreePlaceError` refuses and the transaction writes nothing. The caller tells the public count after
 * the commit (`revalidatePublicContent("places")`). Returns the new capacity.
 */
async function addOneSupplementaryPlace<T extends Record<string, unknown>>(
  tx: Transaction<T>,
  input: {
    eventId: string;
    capacity: number;
    counts: repo.OccupiedCountsRow;
    /** Whom the place is for: a registration, or — a send of invitations (§NNN) — an invitation. An id, never a person. */
    registrationId?: string;
    invitationId?: string;
    action: SupplementaryPlaceAction;
    /** The capacity the dialog named and the press confirmed, or null when it named none. */
    confirmedTo: number | null;
  },
  actorStaffUserId: string,
  now: Date,
): Promise<number> {
  const from = input.capacity;
  // Never a raise the Administrator was not asked about (§642): the question must have named this one.
  if (!confirmsSupplementaryPlace(from, input.confirmedTo)) throw supplementaryPlaceUnconfirmedError(from, input.confirmedTo);
  const to = await repo.addSupplementaryPlace(tx, input.eventId, actorStaffUserId, now);
  if (to === null) throw new DomainError("CONFLICT", "the event's capacity changed concurrently");
  if (computeOccupied(input.counts) >= to) throw new NoFreePlaceError(from, input.counts);
  await recordAuditEvent(tx, {
    actorStaffUserId,
    // The registration's id, never its person (§12.12): the erasure's scrub reaches rows about a registration only.
    participantId: null,
    action: input.action,
    entityType: "event",
    entityId: input.eventId,
    metadata: { from, to, ...(input.invitationId ? { invitationId: input.invitationId } : { registrationId: input.registrationId }) },
    now,
  });
  return to;
}

/**
 * What an Administrator's press for one chosen person did (§642): the registration, and the capacity
 * a supplementary place raised it to — null when the place was already free or the event uncapped.
 */
export type PlacedByStaff = Registration & { capacityRaisedTo: number | null };

/**
 * What the Administrator's press confirmed (§642): `addPlaceTo`, the capacity the dialog named when it
 * said a supplementary place would be added — the form posts it only then. Absent or null, the press
 * adds no place: a full event refuses it with `SUPPLEMENTARY_PLACE_UNCONFIRMED`. A place found free under
 * the lock is used whatever the press confirmed; a confirmed raise that is no longer needed adds nothing.
 */
export type StaffPlaceOptions = { addPlaceTo?: number | null };

/**
 * «Dă-i un loc acum» (§637; the owner, 2026-10-02: «Nu vreau să mai facă ea nimic!! Nu mai vreau să
 * risc»; «trebuie să avem mereu portițe și scurtături din back-office»). A registration still waiting
 * for its address — the verification email late, in Spam, or pressed when the line was already full
 * (§348) — is given a place by an Administrator, remotely, in one press: the first half of the desk's
 * «Confirmă pe hârtie» (§67), without the paper.
 *
 * Under the event lock, one transaction:
 *
 * 1. **Refused** unless the row is `PENDING_EMAIL_CONFIRMATION` of a local, scheduled event that has
 *    not started (and whose date is not «to be announced», §533) — the desk's own event checks
 *    (`assertRegistrationOpen(…, atTheDesk)`), plus the start: once the gun has gone a place given
 *    remotely could not be signed for anywhere but the desk, which has its own verb. The public
 *    window is not consulted, as at the desk: the club decides.
 * 2. **The address vouched for**, exactly as the desk writes it: `email_confirmed_at` and
 *    `email_confirmed_by_staff_user_id`; the participant's own `email_verified_at` stays unset — an
 *    attestation is not a delivered click (BR-REQ-037-07 criterion 2). The row's live verification
 *    link is spent in the same transaction (`used_at`), so the old email can no longer confirm the
 *    row a second time and its page says where the registration stands — «sign the declaration» —
 *    rather than "invalid" (`link-status.ts`, `ALREADY_USED`; §619's «replaced» needs a newer link of
 *    the same purpose, and none exists: the new email carries the declaration's). A verification
 *    email still waiting in the outbox, never tried, is withdrawn with it, so no late «confirm your
 *    address» follows the declaration's email; a retry of one is withdrawn by the renderer.
 * 3. **The place, ahead of the line.** The stale holds expire first (§10.6). A family's live
 *    reservation (§543) is the row's own place, as the desk's allocator treats it, and the person's
 *    own family-held place is released before the count, never counted against them. Otherwise the
 *    place must be a counted free one — `computeOccupied(counts) < capacity`, or an uncapped event —
 *    with §160's rule for a person wanting a place who is not in the line: one lapsed declaration hold
 *    may go for it, as `allocateOrWaitlist` lets one go for a newcomer the full line refuses. **The
 *    waiting list is not consulted for this row**: «while anybody waits every newcomer joins the line»
 *    (§615 criterion 6) is the public door's rule; this is the club choosing a person, as «Trimite-i
 *    oferta» is (§615 criterion 19). Nobody in the line moves and no place promised to anybody is taken.
 *    A row «În afara locurilor» (§643) needs no counted place at all: like a family's reserved one, it
 *    is given its place whatever the counts.
 * 4. **No counted free place** (§642): one supplementary place, as «Trimite-i oferta» adds it —
 *    `addOneSupplementaryPlace`, `capacity + 1` on this one event row, the trail row
 *    `event.capacity_raised_for_place_now` with who and for which registration — in this transaction,
 *    under this lock, and the transition below occupies it at once, before `fillAvailableSpots`. Only
 *    when the press confirmed it: the question said so before the press, its button named the added
 *    place, and the form posted the capacity it named (`options.addPlaceTo`); a press through the plain
 *    question on a race that filled since the page was read is refused (`SUPPLEMENTARY_PLACE_UNCONFIRMED`)
 *    and writes nothing.
 * 5. The row becomes `PENDING_DECLARATION` with `computeVouchedPlaceExpiry`'s deadline, the ordinary
 *    `COMPLETE_DECLARATION` email is queued — `STARTS_DEADLINE` as anybody's (§513), marked to leave
 *    now and sent by the caller's drain after the response (§596) — one audit row names who vouched,
 *    and the maintenance job is told the deadline. Any other place the expiry released goes to the
 *    line in the same transaction (`fillAvailableSpots`, a no-op on «Nu»), as after an offer.
 *
 * Nobody signs for the participant (`AGENTS.md` §15.11): she signs online from the email, or on
 * paper at the desk, where «Confirmă pe hârtie» on a `PENDING_DECLARATION` row works as for anybody.
 * `kind` is in no condition here (§30). The Administrator's (`canManageRegistrations`), asserted here
 * and by the action: the Organizer reads registrations and changes none (§289).
 */
export async function givePlaceNowByStaff<T extends Record<string, unknown>>(
  db: Database<T>,
  event: EventForRegistration,
  registrationId: string,
  actor: { id: string; role: StaffRole },
  now: Date,
  /** The club's deadlines (§377); read here when the caller has none. */
  given?: Deadlines,
  /** The capacity the question named and the press confirmed (§642; the form's `addPlace`), or none. */
  options: StaffPlaceOptions = {},
): Promise<PlacedByStaff> {
  if (!canManageRegistrations(actor.role)) {
    throw new DomainError("FORBIDDEN", `role ${actor.role} may not give a place to an unconfirmed registration`);
  }
  const settings = given ?? (await currentDeadlines(db));
  const result = await db.transaction(async (tx) => {
    const lockedEvent = await repo.lockEventForCapacity(tx, event.id);
    if (!lockedEvent) throw new DomainError("NOT_FOUND", "no such event");
    let locked = withLockedRow(event, lockedEvent);
    assertRegistrationOpen(locked, now, true);
    if (locked.startsAt.getTime() <= now.getTime()) {
      throw new DomainError("VALIDATION_ERROR", "the event has started: confirm at the desk instead");
    }

    const current = await repo.findRegistrationById(tx, registrationId);
    if (!current || current.eventId !== event.id) throw new DomainError("NOT_FOUND", "no such registration");
    if (current.status !== "PENDING_EMAIL_CONFIRMATION") {
      throw new DomainError("CONFLICT", `only a registration waiting for its email confirmation can be given a place this way; this one is ${current.status}`);
    }

    // The row's own places first, as the allocator reads them (§543): never counted against it.
    const reserved = await repo.holdsFamilyReservation(tx, current.id, now);
    await releaseOwnFamilyPlaceHold(tx, event.id, current.id);
    await repo.expireStaleHolds(tx, locked, now);
    /*
      The address's open invitation (§NNN), taken over as the allocator takes it: its place is this
      row's — no supplementary place is asked or added — and its «În afara locurilor» comes with it.
      Marked accepted after the transition below.
    */
    const adopted = await invitationToAdopt(tx, event.id, current.id, now);
    if (adopted?.outsideCapacity && !current.outsideCapacity) {
      await tx.update(registrations).set({ outsideCapacity: true, updatedAt: now }).where(eq(registrations.id, current.id));
    }
    /*
      A row «În afara locurilor» (§643) takes no counted place — the allocator seats it whatever the
      counts — so, like a family's reserved place, it needs no room and lets no lapsed hold go for it.
    */
    const needsNoRoom = reserved || current.outsideCapacity || adopted !== undefined;
    let counts = await repo.countOccupied(tx, event.id, now);
    const hasRoom = () => locked.capacity === null || computeOccupied(counts) < locked.capacity;
    if (!needsNoRoom && !hasRoom() && counts.lapsedDeclarationHolds > 0) {
      // One more person wanting a place who is not in the line (§160): one lapsed hold may go for her.
      await repo.expireStaleHolds(tx, locked, now, { wanting: 1 });
      counts = await repo.countOccupied(tx, event.id, now);
    }
    let capacityRaisedTo: number | null = null;
    if (!needsNoRoom && !hasRoom() && locked.capacity !== null) {
      // None free (§642): one supplementary place, explicit and audited, which this row takes below.
      capacityRaisedTo = await addOneSupplementaryPlace(
        tx,
        {
          eventId: event.id,
          capacity: locked.capacity,
          counts,
          registrationId: current.id,
          action: "event.capacity_raised_for_place_now",
          confirmedTo: options.addPlaceTo ?? null,
        },
        actor.id,
        now,
      );
      locked = { ...locked, capacity: capacityRaisedTo };
    }
    const waiting = await repo.countEligibleWaitlisted(tx, event.id);

    const holdExpiresAt = computeVouchedPlaceExpiry({
      now,
      registrationClosesAt: locked.registrationClosesAt,
      eventStartsAt: locked.startsAt,
      window: confirmationWindow(locked),
      deadlines: settings,
    });
    const placed = await repo.transitionRegistration(tx, {
      id: current.id,
      to: "PENDING_DECLARATION",
      fromStatuses: ["PENDING_EMAIL_CONFIRMATION"],
      // The desk's vouching, word for word (§67): who vouched, never `email_verified_at`.
      changes: { emailConfirmedAt: now, emailConfirmedByStaffUserId: actor.id, holdExpiresAt },
      now,
    });
    if (!placed) throw new DomainError("CONFLICT", "this registration changed state concurrently");
    // The invitation's place is the row's now (§NNN); one the row did not need goes to the line below.
    if (adopted) await markInvitationAdopted(tx, adopted, placed.id, now);

    // The old verification link is spent: it can no longer confirm, and its page says «sign the declaration».
    await tx
      .update(emailActionTokens)
      .set({ usedAt: now })
      .where(
        and(
          eq(emailActionTokens.registrationId, current.id),
          eq(emailActionTokens.purpose, "VERIFY_REGISTRATION_EMAIL"),
          isNull(emailActionTokens.usedAt),
          isNull(emailActionTokens.invalidatedAt),
        ),
      );
    /*
      And a verification email not yet sent is withdrawn (the review of 2026-10-02, finding 2): one the
      outage, a Mailgun pause, the daily allowance or a family sitting (`SITTING_HELD`) kept waiting would
      mint its link at render time and ask her, after the declaration's email, to confirm an address the
      club has vouched for — the very step the owner wanted gone («Nu vreau să mai facă ea nimic»). Only
      rows still waiting and never tried, as `family-sitting.ts` takes one back: a message that may have
      left is not taken back here; the renderer withdraws a retry of it (`render.ts`, `OutboxMessageWithdrawn`).
      Its club copy goes with it. A family sitting that held it reads the missing row as gone.
    */
    await tx
      .delete(emailOutbox)
      .where(
        and(
          eq(emailOutbox.registrationId, current.id),
          eq(emailOutbox.messageType, "VERIFY_REGISTRATION_EMAIL"),
          eq(emailOutbox.status, "PENDING"),
          eq(emailOutbox.attemptCount, 0),
        ),
      );

    const idempotencyKey = `registration:${placed.id}:address-vouched:${now.toISOString()}`;
    await enqueueEmail(tx, {
      participantId: placed.participantId,
      registrationId: placed.id,
      messageType: "COMPLETE_DECLARATION",
      locale: placed.locale,
      recipientEmail: await deliveryEmailOf(tx, placed.participantId),
      // The message that starts the hold (§513), and leaves now: the owner asked for the place ASAP.
      payload: markedForNow(startingDeadline(), "now"),
      idempotencyKey,
      now,
      drainAfter: false,
    });
    const leaveNow = await outboxIdsForKey(tx, idempotencyKey);

    await recordAuditEvent(tx, {
      actorStaffUserId: actor.id,
      participantId: placed.participantId,
      action: "registration.address_vouched_by_staff",
      entityType: "registration",
      entityId: placed.id,
      // How many waited when the place was given ahead of them, and whether it was a family's own reserved place.
      metadata: { from: current.status, to: placed.status, waiting, ...(reserved ? { familyReservation: true } : {}), ...(adopted ? { invitationId: adopted.id } : {}) },
      now,
    });
    // As after an offer: the expiry above may have freed another place, which is the line's (a no-op on «Nu»).
    const offersMade = await fillAvailableSpots(tx, locked, now, settings);
    return { placed, leaveNow, offersMade, capacityRaisedTo };
  });
  // The capacity is on every public page that counts places (§333): told after the commit, as the editor's save.
  if (result.capacityRaisedTo !== null) revalidatePublicContent("places");
  // After the response, once the place has committed (§596); an email failure never undoes it (§10.5 rule 10).
  drainOutboxRowsAfterResponse(result.leaveNow);
  wakeMaintenance(event, now, settings, result.placed.holdExpiresAt, result.offersMade > 0 ? offerDeadline(event, now, settings) : null);
  return { ...result.placed, capacityRaisedTo: result.capacityRaisedTo };
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

    /*
      «Vreau să primesc oferte și beneficii», ticked while signing (§562): the signer's own yes, in
      this transaction — a signature refused below rolls it back with everything else. Kept only while
      the notice in force describes the materials; otherwise ignored, never a refusal of the signature.
      A no here changes nothing: the page offers only the yes, and the way out is the person's own page.
    */
    if (parsed.data.promoConsent && !before.promoConsent && (await noticeDescribesPromotionalMaterials(tx, now))) {
      await setPromoConsent(tx, { registrationId: before.id, consent: true, via: "DECLARATION", now });
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
      The text this signature binds to: the version current for this registration's language, of
      the event's own declaration — trail or road (§515, `findEventDeclaration`) — read once,
      before anything is compared (§330). Who signs and which documents are asked are
      read from it, so it has to be the text the page showed — and that is checked first: the
      page posts the id and hash of the version it rendered, and a newer version approved in
      between is refused here with CONFLICT (`declarationChanged`, BR-REQ-033-02 criterion 6,
      §57) rather than as a refusal of a box the page never had, or a box the page had ignored.
      Never a flag the page posts: the server reads the text itself.
    */
    const document = await findEventDeclaration(tx, before.eventId, before.locale, now);
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
    const idDocument = needsIdDocument ? (parsed.data.idDocument ?? null) : null;
    const minorIdDocument = signedByMinorToo && needsIdDocument ? (parsed.data.minorIdDocument ?? null) : null;
    await repo.insertDeclarationAcceptance(tx, {
      registrationId: current.id,
      legalDocumentId: document.id,
      declarationVersion: document.version,
      contentSha256: document.contentSha256,
      locale: current.locale,
      typedName: parsed.data.typedName,
      idDocument,
      minorTypedName: signedByMinorToo ? (parsed.data.minorTypedName ?? null) : null,
      minorIdDocument,
      acceptedAt: now,
      // The proof of signing (§556): the exact text this signer's PDF prints, hashed in this transaction.
      textHash: await acceptanceTextHash(tx, {
        eventId: current.eventId,
        document,
        signer: { registeredName: current.registeredName, guardianName: current.guardianName, locale: current.locale, idDocument, minorIdDocument, acceptedAt: now },
      }),
    });

    const confirmed = await repo.transitionRegistration(tx, {
      id: current.id,
      to: "CONFIRMED",
      fromStatuses: ["PENDING_DECLARATION", "WAITLIST_OFFERED"],
      changes: {
        confirmedAt: now,
        holdExpiresAt: null,
        checkinCode: current.checkinCode ?? newCheckinCode(),
        // The race number, drawn now and at no other moment (§548): the next one in confirmation order.
        ...(await bibAtConfirmation(tx, current)),
      },
      now,
    });
    if (!confirmed) throw new DomainError("CONFLICT", "this registration changed state concurrently");

    await enqueueConfirmation(tx, confirmed, now);
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
  /** The number the desk handed with the paper (§444), when it handed one. */
  handedBib?: number,
): Promise<Registration> {
  const document = await findEventDeclaration(tx, current.eventId, current.locale, now);
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
    // The text the paper's record prints (§556): the documents stay on the paper, so their blanks are dotted.
    textHash: await acceptanceTextHash(tx, {
      eventId: current.eventId,
      document,
      signer: { registeredName: current.registeredName, guardianName: current.guardianName, locale: current.locale, idDocument: null, minorIdDocument: null, acceptedAt: now },
    }),
  });
  const confirmed = await repo.transitionRegistration(tx, {
    id: current.id,
    to: "CONFIRMED",
    fromStatuses: ["PENDING_DECLARATION", "WAITLIST_OFFERED"],
    changes: {
      confirmedAt: now,
      holdExpiresAt: null,
      checkinCode: current.checkinCode ?? newCheckinCode(),
      // As in `signDeclaration` (§548): the next number in confirmation order — unless the desk
      // handed one with the paper, a spare above all (§444).
      ...(handedBib !== undefined ? await handedBibAtConfirmation(tx, current, handedBib, now) : await bibAtConfirmation(tx, current)),
    },
    now,
  });
  if (!confirmed) throw new DomainError("CONFLICT", "this registration changed state concurrently");

  await enqueueConfirmation(tx, confirmed, now);
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
  /**
   * The number handed with the paper (§444): a desk spare or any free number the volunteer typed.
   * Written only if the registration ends CONFIRMED here — a walk-in the allocator puts on the
   * waiting list takes no number, and the spare stays in the box for the next person.
   */
  options: { bibNumber?: number } = {},
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
      return acceptDeclarationOnPaper(tx, withLockedRow(event, lockedEvent), current, actor, now, options.bibNumber);
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
    const counts = await repo.countOccupied(tx, event.id, now);
    if (lockedEvent.capacity !== null && computeOccupied(counts) >= lockedEvent.capacity) {
      // Who holds the places, by the same counts (§589): the desk says it instead of "check the data".
      throw new NoFreePlaceError(lockedEvent.capacity, counts);
    }
    const offered = await repo.transitionRegistration(tx, {
      id: current.id,
      to: "WAITLIST_OFFERED",
      fromStatuses: ["WAITLISTED"],
      changes: { offerCreatedAt: now, holdExpiresAt: now },
      now,
    });
    if (!offered) throw new DomainError("CONFLICT", "this registration changed state concurrently");
    // The confirmation below draws the number, under this lock (§548).
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
 * «Trimite-i oferta» (§615, amended by §642): the Administrator sends a place to the waiting-list
 * registration of their choice — the ordinary offer and its email, ahead of the people before them in
 * the line — at any moment before the start, and on a full event by adding the place it needs. The
 * owner, 2026-10-02: «Vreau să pot „oferi loc” în orice moment, chiar și pe liste suplimentare».
 *
 * Under the event lock: a cancelled or finished event refused, the lapsed holds expired (a lapsed
 * declaration hold is released first, as far as the line wants its place, §160), the registration
 * `WAITLISTED`. Then the offer's deadline — the club's offer window (§377) capped by the **start
 * alone** (`capByClose: false`): a staff-chosen offer made after the close is never born lapsed, while
 * the automatic offers keep §420's cap by the close and make none after it. Then a counted place —
 * `computeOccupied(counts) < capacity`, the allocator's own count. **None free** on a capped event, and
 * the press confirmed it — the dialog named the new capacity and the form posted it
 * (`options.addPlaceTo`, exactly `capacity + 1` of the locked row; otherwise `SUPPLEMENTARY_PLACE_UNCONFIRMED`
 * refuses and nothing is written): one supplementary place, `capacity + 1` on this one event row (`addSupplementaryPlace`, never a
 * series' other dates), in this transaction, under this lock, with the trail row
 * `event.capacity_raised_for_offer` (from, to, who, for which registration) and the public count told —
 * and the offer below occupies that place at once, before `fillAvailableSpots` runs, so on «Da» the
 * first in line does not take it. Never overbooking: should the count still be full after the one
 * place (a count above the capacity, which no path writes), §589's `NoFreePlaceError` refuses and the
 * transaction writes nothing. An uncapped event never lacks a place and is never written.
 *
 * Then the row becomes `WAITLIST_OFFERED`, the offer's email is queued exactly as an automatic offer's
 * (`queueSpotOffer`, marked `OFFER_UNTIL_START` so the send's re-base keeps the start as the one cap),
 * the audit row names who offered, to whom and how many waited before them, and the maintenance job is
 * told the deadline. It confirms nothing: the runner signs the declaration from the email, as any
 * offer — the paper confirmation is «Dă-i un loc»'s, which still needs a free place (§589).
 *
 * Never two promises for one place: the offer occupies the place it was given (`countOccupied` counts
 * an open offer), so a second press for another person meets the full count under the same lock and is
 * refused unless its own dialog named the place it would add; a second press for the same person meets a
 * row that is no longer `WAITLISTED`.
 * `kind` is in no condition here (§30). The Administrator's (`canManageRegistrations`, §289): it
 * changes a registration and the event's capacity, which the Organizer reads and does not change —
 * asserted here and again by the action.
 */
export async function offerPlaceToByStaff<T extends Record<string, unknown>>(
  db: Database<T>,
  event: EventForRegistration,
  registrationId: string,
  actor: { id: string; role: StaffRole },
  now: Date,
  /** The capacity the question named and the press confirmed (§642; the form's `addPlace`), or none. */
  options: StaffPlaceOptions = {},
): Promise<PlacedByStaff> {
  if (!canManageRegistrations(actor.role)) {
    throw new DomainError("FORBIDDEN", `role ${actor.role} may not send a waiting-list offer`);
  }
  // The club's offer length (§377), before the lock and from the memo when it is fresh.
  const settings = await currentDeadlines(db);
  const result = await db.transaction(async (tx) => {
    const lockedEvent = await repo.lockEventForCapacity(tx, event.id);
    if (!lockedEvent) throw new DomainError("NOT_FOUND", "no such event");
    let locked = withLockedRow(event, lockedEvent);
    // As «Dă-i un loc» (§331): nobody is offered a place in a race that will not run, or is over.
    if (locked.eventStatus !== "SCHEDULED") {
      throw new DomainError("VALIDATION_ERROR", `the event is ${locked.eventStatus}`);
    }
    await repo.expireStaleHolds(tx, locked, now);

    const current = await repo.findRegistrationById(tx, registrationId);
    if (!current || current.eventId !== event.id) throw new DomainError("NOT_FOUND", "no such registration");
    if (current.status !== "WAITLISTED") {
      throw new DomainError("CONFLICT", `only a waiting-list registration can be offered a place; this one is ${current.status}`);
    }
    // The club's window, capped by the start alone (§642): before the start it is always ahead of now.
    const holdExpiresAt = staffOfferDeadline(locked, now, settings);
    if (holdExpiresAt.getTime() <= now.getTime()) {
      throw new DomainError("VALIDATION_ERROR", "the event has started: an offer made now would already be lapsed");
    }

    // A counted place, else one supplementary place (§642), in this transaction and under this lock.
    let capacityRaisedTo: number | null = null;
    const counts = await repo.countOccupied(tx, event.id, now);
    if (locked.capacity !== null && computeOccupied(counts) >= locked.capacity) {
      capacityRaisedTo = await addOneSupplementaryPlace(
        tx,
        {
          eventId: event.id,
          capacity: locked.capacity,
          counts,
          registrationId: current.id,
          action: "event.capacity_raised_for_offer",
          confirmedTo: options.addPlaceTo ?? null,
        },
        actor.id,
        now,
      );
      locked = { ...locked, capacity: capacityRaisedTo };
    }

    // How many waited before this person, for the trail: the line's own order (`lockOldestWaitlisted`).
    const [ahead] = current.waitlistedAt
      ? await tx
          .select({ count: count() })
          .from(registrations)
          .where(and(eq(registrations.eventId, event.id), eq(registrations.status, "WAITLISTED"), lt(registrations.waitlistedAt, current.waitlistedAt)))
      : [{ count: 0 }];

    const offered = await repo.transitionRegistration(tx, {
      id: current.id,
      to: "WAITLIST_OFFERED",
      fromStatuses: ["WAITLISTED"],
      changes: { offerCreatedAt: now, holdExpiresAt },
      now,
    });
    if (!offered) throw new DomainError("CONFLICT", "this registration changed state concurrently");
    // An offer carries no race number; accepting it is a confirmation, which draws one (§548).
    const leaveNow = await queueSpotOffer(tx, offered, now, { untilStart: true });
    await recordAuditEvent(tx, {
      actorStaffUserId: actor.id,
      participantId: offered.participantId,
      action: "registration.offered_by_staff",
      entityType: "registration",
      entityId: offered.id,
      metadata: { from: current.status, to: offered.status, aheadOf: ahead?.count ?? 0 },
      now,
    });
    // As in `promoteFromWaitlistByStaff`: the expiry above may have released another lapsed hold, and
    // this transaction holds the lock that can offer it; on «Nu» the gate makes it a no-op (§615). The
    // offer above already occupies the supplementary place, so the line's head cannot take it (§642).
    await fillAvailableSpots(tx, locked, now, settings);
    return { offered, leaveNow, holdExpiresAt, capacityRaisedTo };
  });
  // The capacity is on every public page that counts places (§333): told after the commit, as the editor's save.
  if (result.capacityRaisedTo !== null) revalidatePublicContent("places");
  // After this request's response, once the offer has committed (§596), as the automatic offer's.
  drainOutboxRowsAfterResponse(result.leaveNow);
  wakeMaintenance(event, now, settings, result.holdExpiresAt);
  return { ...result.offered, capacityRaisedTo: result.capacityRaisedTo };
}

/**
 * Whether a registration in this state holds, or would hold once counted, one of the event's places:
 * confirmed, a declaration to sign, an offer, or a family's live reservation (§543) — what
 * `countOccupied` counts for a row that is not «În afara locurilor» (§643).
 */
function wouldHoldACountedPlace(registration: Pick<Registration, "status" | "holdExpiresAt">, now: Date): boolean {
  if (registration.status === "CONFIRMED" || registration.status === "PENDING_DECLARATION" || registration.status === "WAITLIST_OFFERED") return true;
  return registration.status === "PENDING_EMAIL_CONFIRMATION" && registration.holdExpiresAt !== null && registration.holdExpiresAt.getTime() > now.getTime();
}

/**
 * «În afara locurilor» set or cleared by an Administrator (§643; the owner, 2026-10-02: «Vreau și o
 * bifă de „ascunde la numărare” per fiecare participant» — for organizers, pacemakers, invited
 * runners). Everything under the event lock, after the stale holds expire and the line is served
 * (§10.6: `fillAvailableSpots`, as `placeForNewcomer`), in one transaction with its audit row (`registration.outside_capacity_changed`, from → to, who):
 *
 * - **Marking** releases a counted place, if the row held one (confirmed, a declaration, an offer, a
 *   family's reservation), and the usual refill follows (`fillAvailableSpots`: with «Da» the first in
 *   line is offered it; with «Nu» it stays free). A confirmed row or a declaration hold keeps its
 *   state, number and emails. A `WAITLISTED` row leaves the line and is given a place outside the
 *   places now, through the one allocator (`allocateOrWaitlist`): a declaration to sign with the
 *   ordinary deadline and email. An open offer the same (the review of 2026-10-02): an offer is a
 *   promise to the line, with the line's short deadline, and `expireStaleHolds` lapses every offer at
 *   it — so the row becomes the declaration hold an outside row is given, its email queued, a queued
 *   offer email never tried withdrawn, and the offer's link replaced by the declaration's when that
 *   email leaves (§619, `issueActionToken`). A row waiting for its address is seated outside when
 *   the address is confirmed.
 * - **Unmarking** a row that would then hold a counted place is allowed only while one is free —
 *   `computeOccupied(counts) < capacity`, the allocator's own count — else `NoFreePlaceError` and
 *   §589's sentence; the row then takes it.
 * - A cancelled or expired row's flag is read, never changed; nor anything on an event not scheduled.
 *
 * The column is the one condition (`kind` none, §30): a `TEST` row is marked exactly as a real one.
 */
export async function setOutsideCapacityByStaff<T extends Record<string, unknown>>(
  db: Database<T>,
  event: EventForRegistration,
  registrationId: string,
  outside: boolean,
  actor: { id: string; role: StaffRole },
  now: Date,
): Promise<Registration> {
  if (!canManageRegistrations(actor.role)) {
    throw new DomainError("FORBIDDEN", `role ${actor.role} may not seat a registration outside the places`);
  }
  const settings = await currentDeadlines(db);
  const result = await db.transaction(async (tx) => {
    const lockedEvent = await repo.lockEventForCapacity(tx, event.id);
    if (!lockedEvent) throw new DomainError("NOT_FOUND", "no such event");
    const locked = withLockedRow(event, lockedEvent);
    if (locked.eventStatus !== "SCHEDULED") {
      throw new DomainError("VALIDATION_ERROR", `the event is ${locked.eventStatus}`);
    }
    /*
      Stale holds first, and the line served at once (§10.6, invariant 7; the review of 2026-10-02,
      finding 1), as `placeForNewcomer` does: a kept declaration hold `expireStaleHolds` lets go
      because somebody waits is that person's place, offered to them in this transaction — so an
      unmarking below can take only a place nobody in line is owed, and even a press that changes
      nothing leaves no lapsed offer's place unoffered. A no-op on «Nu» (§615).
    */
    await repo.expireStaleHolds(tx, locked, now);
    const servedFirst = await fillAvailableSpots(tx, locked, now, settings);

    const current = await repo.findRegistrationById(tx, registrationId);
    if (!current || current.eventId !== event.id) throw new DomainError("NOT_FOUND", "no such registration");
    if (!isActiveStatus(current.status)) {
      throw new DomainError("CONFLICT", `a ${current.status} registration's place cannot be changed`);
    }
    if (current.outsideCapacity === outside) return { registration: current, offered: servedFirst };

    if (!outside && lockedEvent.capacity !== null && wouldHoldACountedPlace(current, now)) {
      const counts = await repo.countOccupied(tx, event.id, now);
      if (computeOccupied(counts) >= lockedEvent.capacity) throw new NoFreePlaceError(lockedEvent.capacity, counts);
    }

    let registration = await repo.writeOutsideCapacity(tx, current.id, outside, now);
    if (!registration) throw new DomainError("CONFLICT", "this registration changed state concurrently");

    // A place the row held is free now: the line's, with «Da»; the organizer's, with «Nu» (§615).
    const refilled = outside ? await fillAvailableSpots(tx, locked, now, settings) : 0;

    /*
      Out of the line, or out of an open offer, into a place outside the places: the one allocator,
      then its declaration email (§643). An offer kept as an offer would lapse at the line's deadline
      (`expireStaleHolds` lapses every offer, §10.5) and end the invited runner's registration; as a
      declaration hold outside the places nothing releases it for anybody. Its offer email, if still
      queued and never tried, is withdrawn — the declaration's email says everything now — as «Dă-i un
      loc acum» withdraws a verification email (§637); the offer's link is replaced when the declaration's
      email leaves (§619, `issueActionToken`), so one link signs. Withdrawn only after the allocator: while
      it is queued an offer past its stored deadline is not lapsed (§520), and the allocator's own sweep
      must still see it so.
    */
    if (outside && (registration.status === "WAITLISTED" || registration.status === "WAITLIST_OFFERED")) {
      registration = await allocateOrWaitlist(tx, locked, registration.id, now, settings);
      if (current.status === "WAITLIST_OFFERED") {
        await tx
          .delete(emailOutbox)
          .where(
            and(
              eq(emailOutbox.registrationId, registration.id),
              eq(emailOutbox.messageType, "WAITLIST_SPOT_OFFER"),
              eq(emailOutbox.status, "PENDING"),
              eq(emailOutbox.attemptCount, 0),
            ),
          );
      }
      await enqueueAllocationEmail(tx, registration, await deliveryEmailOf(tx, registration.participantId), `registration:${registration.id}:outside:${now.toISOString()}`, now);
    }

    await recordAuditEvent(tx, {
      actorStaffUserId: actor.id,
      participantId: current.participantId,
      action: "registration.outside_capacity_changed",
      entityType: "registration",
      entityId: current.id,
      metadata: { from: current.outsideCapacity, to: outside, status: current.status, ...(registration.status !== current.status ? { statusAfter: registration.status } : {}) },
      now,
    });

    return { registration, offered: servedFirst + refilled };
  });
  forgetRegisteredBadgeCount();
  wakeMaintenance(event, now, settings, result.registration.holdExpiresAt, result.offered > 0 ? offerDeadline(event, now, settings) : null);
  return result.registration;
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

/** Where a participant cancelled their own registration from (§547): audit metadata, never a name. */
export type ParticipantCancelDoor = "MANAGE_LINK" | "MY_REGISTRATIONS" | "FAMILY_WIZARD";

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
  options: {
    notify?: boolean;
    /**
     * The door a participant cancelled through (§547): their own manage link, «Înscrierile mele», or
     * «Renunț la înscrierea pentru …» in the family's wizard. Given, the cancellation writes one audit
     * row with no staff actor — the state it left and the door, never a name (AGENTS.md §12.12) — so
     * the club's timeline says the person withdrew themselves, as it says a staff cancellation.
     */
    via?: ParticipantCancelDoor;
    /**
     * The participant's own reason (§558), asked at every door above and required there: stored on
     * the row (the answer, and the words of «Alt motiv»), the answer alone in the audit row — never
     * the words, which are the person's own and may name them.
     */
    reason?: CancelReason;
    /**
     * A staff cancellation that is the club refusing the registration under the terms (§618): the
     * ground the Administrator typed under a box that said it goes to the person. Written into the
     * message's payload, so the cancellation email names it; never on the row.
     */
    refusedGround?: string;
  } = {},
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
      changes: {
        cancelledAt: now,
        cancellationSource: source,
        ...(source === "PARTICIPANT" && options.reason
          ? { cancelReasonKind: options.reason.kind, cancelReason: options.reason.text }
          : {}),
      },
      now,
    });
    if (!cancelled) {
      throw new DomainError("CONFLICT", "this registration changed state concurrently");
    }

    if (source === "PARTICIPANT" && options.via) {
      await recordAuditEvent(tx, {
        actorStaffUserId: null,
        participantId: cancelled.participantId,
        action: "registration.cancelled_by_participant",
        entityType: "registration",
        entityId: cancelled.id,
        metadata: { from: current.status, via: options.via, ...(options.reason ? { reasonKind: options.reason.kind } : {}) },
        now,
      });
    }

    if (options.notify !== false) {
      await enqueueEmail(tx, {
        participantId: cancelled.participantId,
        registrationId: cancelled.id,
        messageType: "REGISTRATION_CANCELLED",
        locale: cancelled.locale,
        recipientEmail: await deliveryEmailOf(tx, cancelled.participantId),
        /*
          The state the registration left (§547): the message says a held place was released, or that
          the person left the waiting list — «Înscrierea pentru <nume> … a fost anulată», one per
          person, whoever pressed it.
        */
        payload: {
          previousStatus: current.status,
          ...(source === "ADMIN" && options.refusedGround ? { refusedGround: options.refusedGround } : {}),
        },
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

// --- §NNN Invitations by email -----------------------------------------------------------------

/** One person of a send: a member picked from the members' zone (§524), or a name and an address typed. */
export type InvitationInvitee = { name: string; email: string; memberStaffUserId?: string | null };

export type InvitationSendInput = {
  people: readonly InvitationInvitee[];
  /** «Zile până expiră» (7 by default): capped by the start (`invitationDeadline`). */
  days: number;
  /** «Pe lista ascunsă» (§643's `outside_capacity`) for the whole send: organizers, volunteers, pacemakers hold no counted place. */
  outsideCapacity: boolean;
  /**
   * «Limba invitației» for a typed address the club has never seen (Romanian by default): a member is
   * written to in the account's language, and an address the club knows in its participant's.
   */
  locale?: "ro" | "en";
  /**
   * The capacity the dialog named when it said supplementary places would be added (§642): exactly the
   * locked capacity plus the places this send needs, or the send is refused and nothing is written.
   */
  addPlaceTo?: number | null;
};

export type InvitationSendResult = { sent: number; capacityRaisedTo: number | null; deadline: Date };

/** An address checked by the canonicalizer (§10.4), or the send's refusal naming the person. */
function invitationIdentity(person: InvitationInvitee) {
  try {
    return canonicalizeEmail(person.email);
  } catch {
    throw new InvitationRefusal("INVITATION_BAD_ADDRESS", person.name);
  }
}

/**
 * «Trimite invitațiile» (§NNN; the owner, 2026-10-02: «vreau să trimit „invitații speciale” pe email
 * pentru membrii BVR, un fel de adaugă manual» — «Dar vreau și pentru non-membrii»). The Administrator's
 * alone (`canManageRegistrations`, asserted here, in the admin service and in the action): the Organizer
 * reads the invitations and changes nothing (§289).
 *
 * Under the event lock, in **one transaction for the whole list** — a refusal names the person and
 * nothing of the send is written:
 *
 * 1. **The event**: local, scheduled, published, dated (§533) and not started — the invitation's deadline
 *    is `min(now + days, start)` (`invitationDeadline`). Neither end of the public window is asked: the
 *    club may invite before it opens and after it closes (organizers, pacemakers, volunteers invited
 *    late), as «Trimite-i oferta» offers after the close (§642).
 * 2. **The line is served first** and the stale holds expire (`fillAvailableSpots`, as `placeForNewcomer`):
 *    a place somebody waiting is owed is offered to them before any invitation counts what is left.
 * 3. **Each person**, in order: the address canonicalized (§10.4); refused when the address already holds
 *    a registration at the event in any live state, or a live invitation, or appears twice in the list.
 *    A member picked from the members' zone is read from the account (name, address, language), never
 *    from what was posted.
 * 4. **The places.** An invitation «În afara locurilor» holds none. Otherwise it holds a counted place
 *    from now to its deadline (`countOccupied`'s `invitationHolds`), and where none is free it gets **one
 *    supplementary place** (§642: `addOneSupplementaryPlace`, `capacity + 1`, audited as
 *    `event.capacity_raised_for_invitation` with the invitation's id) — only when the press confirmed
 *    exactly that many: the dialog said «capacitatea devine {n}» and the form posted it
 *    (`confirmsInvitationRaises`); any other number refuses the whole send with
 *    `SUPPLEMENTARY_PLACE_UNCONFIRMED` before anything is written. Never a lapsed declaration hold taken
 *    for an invitation: that runner may still sign (§160), and the place is the club's addition.
 * 5. **Written**: the address's participant row when the address was never seen (the identity the one
 *    link is scoped to; an existing row is left as it is — never another person's name or language
 *    rewritten), the invitation, its `EVENT_INVITATION` email in the person's language (the member
 *    account's, else the known participant's, else «Limba invitației») — the link minted at the send
 *    (`render.ts`, §12.8) — and one audit row `event.invitation_sent`.
 *
 * After the commit the public count is told (`revalidatePublicContent`) and the job woken for the
 * deadline. `kind` is in no condition (§30).
 */
export async function inviteToEventByStaff<T extends Record<string, unknown>>(
  db: Database<T>,
  event: EventForRegistration,
  input: InvitationSendInput,
  actor: { id: string; role: StaffRole },
  now: Date,
): Promise<InvitationSendResult> {
  if (!canManageRegistrations(actor.role)) {
    throw new DomainError("FORBIDDEN", `role ${actor.role} may not invite anybody`);
  }
  if (input.people.length === 0) throw new InvitationRefusal("INVITATION_NOBODY");
  if (input.people.length > INVITATION_BATCH_MAX) throw new InvitationRefusal("INVITATION_TOO_MANY");
  if (!validInvitationDays(input.days)) throw new InvitationRefusal("INVITATION_BAD_DAYS");
  const settings = await currentDeadlines(db);

  const result = await db.transaction(async (tx) => {
    const lockedEvent = await repo.lockEventForCapacity(tx, event.id);
    if (!lockedEvent) throw new DomainError("NOT_FOUND", "no such event");
    let locked = withLockedRow(event, lockedEvent);
    // Published too: the link opens the event's own registration form, which a draft has none of.
    if (
      locked.registrationMode !== "INTERNAL" ||
      locked.eventStatus !== "SCHEDULED" ||
      lockedEvent.editorialStatus !== "PUBLISHED" ||
      startHeldBack(lockedEvent) ||
      locked.startsAt.getTime() <= now.getTime()
    ) {
      throw new InvitationRefusal("INVITATION_EVENT_CLOSED");
    }
    const deadline = invitationDeadline({ now, days: input.days, startsAt: locked.startsAt });
    if (!deadline) throw new InvitationRefusal("INVITATION_EVENT_CLOSED");

    // The line first, and every stale hold — an invitation past its deadline among them — expired (§10.6).
    const offersMade = await fillAvailableSpots(tx, locked, now, settings);

    // Who, read and refused before anything is written.
    const seen = new Set<string>();
    const invitees: {
      name: string;
      email: string;
      locale: "ro" | "en";
      memberStaffUserId: string | null;
      identity: ReturnType<typeof canonicalizeEmail>;
      known: Awaited<ReturnType<typeof findParticipantByCanonicalEmail>>;
    }[] = [];
    for (const posted of input.people) {
      let person = { name: posted.name.trim().replace(/\s+/g, " "), email: posted.email.trim(), locale: "ro" as "ro" | "en", memberStaffUserId: null as string | null };
      if (posted.memberStaffUserId) {
        const [account] = await tx
          .select({ id: staffUsers.id, name: staffUsers.displayName, email: staffUsers.email, locale: staffUsers.preferredLocale })
          .from(staffUsers)
          .where(eq(staffUsers.id, posted.memberStaffUserId))
          .limit(1);
        // A member's account removed since the page was read is refused by the name the page showed.
        if (!account) throw new InvitationRefusal("INVITATION_BAD_ADDRESS", person.name || null);
        person = { name: account.name.trim() || person.name, email: account.email, locale: account.locale, memberStaffUserId: account.id };
      }
      if (person.name === "" || person.name.length > 200) throw new InvitationRefusal("INVITATION_NO_NAME", person.email || null);
      const identity = invitationIdentity(person);
      if (seen.has(identity.canonicalEmail)) throw new InvitationRefusal("INVITATION_DUPLICATE", person.name);
      seen.add(identity.canonicalEmail);
      const known = await findParticipantByCanonicalEmail(tx, identity.canonicalEmail);
      if (known) {
        const rows = await repo.findRegistrationsByEventAndParticipant(tx, event.id, known.id);
        if (rows.some((row) => isActiveStatus(row.status))) throw new InvitationRefusal("INVITATION_ALREADY_REGISTERED", person.name);
      }
      if (await findOpenInvitation(tx, event.id, identity.canonicalEmail)) throw new InvitationRefusal("INVITATION_ALREADY_INVITED", person.name);
      /*
        The person's language: a member's account says it; an address the club knows says it on its
        participant row — the language that person registered in — and only an address never seen is
        written to in the language the Administrator chose («Limba invitației», Romanian by default).
      */
      const locale = person.memberStaffUserId ? person.locale : (known?.preferredLocale ?? input.locale ?? "ro");
      invitees.push({ ...person, locale, identity, known });
    }

    /*
      The places: one supplementary place per invitation that needs a counted one and finds none free
      for it (§642). Free for an invitation means free after everyone eligible who waits — whatever
      «Oferte automate» says and whether the registration has closed: with offers off (§615) or after the
      close `fillAvailableSpots` above offered nobody, and a place a waiting row is owed is still never
      an invitation's (AGENTS.md §15.11). The line does not move during the send — an invitation is no
      registration — so the count is read once.
    */
    const counts = await repo.countOccupied(tx, event.id, now);
    const waiting = await repo.countEligibleWaitlisted(tx, event.id);
    const needed = input.outsideCapacity ? 0 : invitees.length;
    const raises = invitationRaises({ capacity: locked.capacity, occupied: computeOccupied(counts), waiting, needed });
    if (locked.capacity !== null && !confirmsInvitationRaises(locked.capacity, raises, input.addPlaceTo ?? null)) {
      throw supplementaryPlaceUnconfirmedError(locked.capacity, input.addPlaceTo ?? null);
    }

    let capacityRaisedTo: number | null = null;
    for (const person of invitees) {
      const invitationId = randomUUID();
      let raised = false;
      if (!input.outsideCapacity && locked.capacity !== null) {
        const before = await repo.countOccupied(tx, event.id, now);
        if (invitationFreePlaces({ capacity: locked.capacity, occupied: computeOccupied(before), waiting }) === 0) {
          capacityRaisedTo = await addOneSupplementaryPlace(
            tx,
            { eventId: event.id, capacity: locked.capacity, counts: before, invitationId, action: "event.capacity_raised_for_invitation", confirmedTo: locked.capacity + 1 },
            actor.id,
            now,
          );
          locked = { ...locked, capacity: capacityRaisedTo };
          raised = true;
        }
      }
      /*
        The address's participant row, which the one link is scoped to: an existing one as it is — an
        invitation never rewrites another person's stored name or language, verified or not — and a new
        one only for an address never seen.
      */
      const participant = person.known ?? (await findOrCreateParticipant(tx, person.identity, person.name, person.locale, now));
      await tx.insert(eventInvitations).values({
        id: invitationId,
        eventId: event.id,
        participantId: participant.id,
        name: person.name,
        email: person.identity.deliveryEmail,
        canonicalEmail: person.identity.canonicalEmail,
        locale: person.locale,
        memberStaffUserId: person.memberStaffUserId,
        invitedByStaffUserId: actor.id,
        createdAt: now,
        sentAt: now,
        expiresAt: deadline,
        outsideCapacity: input.outsideCapacity,
        supplementaryRaise: raised,
        lastSentAt: now,
      });
      const idempotencyKey = `invitation:${invitationId}:sent:${now.toISOString()}`;
      await enqueueEmail(tx, {
        participantId: participant.id,
        registrationId: null,
        messageType: "EVENT_INVITATION",
        locale: person.locale,
        recipientEmail: person.identity.deliveryEmail,
        // The invitation by its id alone — never a name or an address in the outbox's payload (§12.12).
        payload: { invitationId },
        idempotencyKey,
        now,
      });
      await recordAuditEvent(tx, {
        actorStaffUserId: actor.id,
        participantId: null,
        action: "event.invitation_sent",
        entityType: "event",
        entityId: event.id,
        metadata: {
          invitationId,
          expiresAt: deadline.toISOString(),
          outsideCapacity: input.outsideCapacity,
          supplementaryRaise: raised,
          ...(person.memberStaffUserId ? { member: true } : {}),
        },
        now,
      });
    }
    return { sent: invitees.length, capacityRaisedTo, deadline, offersMade };
  });
  // The held places are on every public page that counts places (§333), and the capacity too when it moved.
  revalidatePublicContent("places");
  wakeMaintenance(event, now, settings, result.deadline, result.offersMade > 0 ? offerDeadline(event, now, settings) : null);
  return { sent: result.sent, capacityRaisedTo: result.capacityRaisedTo, deadline: result.deadline };
}

/**
 * The invitation an Administrator's press is about, locked behind its event (§NNN): open and still
 * before its deadline, or the press is refused (`INVITATION_NOT_OPEN`) — accepted, withdrawn or expired
 * since the page was read. The stale holds expire first, so an invitation past its deadline is stamped
 * and refused rather than revived.
 */
async function lockOpenInvitation<T extends Record<string, unknown>>(tx: Transaction<T>, invitationId: string, now: Date) {
  const invitation = await findInvitationById(tx, invitationId);
  if (!invitation) throw new DomainError("NOT_FOUND", "no such invitation");
  const lockedEvent = await repo.lockEventForCapacity(tx, invitation.eventId);
  if (!lockedEvent) throw new DomainError("NOT_FOUND", "no such event");
  await repo.expireStaleHolds(tx, lockedEvent, now);
  const current = await findInvitationById(tx, invitationId);
  if (!current || invitationState(current, now) !== "sent") throw new InvitationRefusal("INVITATION_NOT_OPEN", current?.name ?? null);
  return { invitation: current, lockedEvent };
}

/**
 * «Retrimite» (§NNN): the email again, with a new link — the old one superseded when the new is minted
 * (§619: its page says a newer email has it) — and the deadline kept (no `days`) or moved to `days` from
 * now, capped by the start as at the send. Never earlier than it was: a resend does not take time back.
 * `resend_count + 1`, audited. The Administrator's alone.
 */
export async function resendInvitationByStaff<T extends Record<string, unknown>>(
  db: Database<T>,
  invitationId: string,
  input: { days: number | null },
  actor: { id: string; role: StaffRole },
  now: Date,
): Promise<{ expiresAt: Date }> {
  if (!canManageRegistrations(actor.role)) throw new DomainError("FORBIDDEN", `role ${actor.role} may not resend an invitation`);
  if (input.days !== null && !validInvitationDays(input.days)) throw new InvitationRefusal("INVITATION_BAD_DAYS");
  const settings = await currentDeadlines(db);
  const result = await db.transaction(async (tx) => {
    const { invitation, lockedEvent } = await lockOpenInvitation(tx, invitationId, now);
    if (lockedEvent.eventStatus !== "SCHEDULED" || lockedEvent.startsAt.getTime() <= now.getTime()) throw new InvitationRefusal("INVITATION_EVENT_CLOSED", invitation.name);
    const moved = input.days === null ? null : invitationDeadline({ now, days: input.days, startsAt: lockedEvent.startsAt });
    const expiresAt = moved && moved.getTime() > invitation.expiresAt.getTime() ? moved : invitation.expiresAt;
    await tx
      .update(eventInvitations)
      .set({ expiresAt, lastSentAt: now, resendCount: invitation.resendCount + 1 })
      .where(eq(eventInvitations.id, invitation.id));
    await enqueueEmail(tx, {
      participantId: invitation.participantId,
      registrationId: null,
      messageType: "EVENT_INVITATION",
      locale: invitation.locale,
      recipientEmail: invitation.email,
      payload: { invitationId: invitation.id },
      idempotencyKey: `invitation:${invitation.id}:resent:${now.toISOString()}`,
      requestedByStaffUserId: actor.id,
      isManualResend: true,
      now,
    });
    await recordAuditEvent(tx, {
      actorStaffUserId: actor.id,
      participantId: null,
      action: "event.invitation_resent",
      entityType: "event",
      entityId: invitation.eventId,
      metadata: { invitationId: invitation.id, from: invitation.expiresAt.toISOString(), to: expiresAt.toISOString() },
      now,
    });
    return { expiresAt, lockedEvent };
  });
  // The kept place's deadline may have moved: the public count's instants with it (§333).
  revalidatePublicContent("places");
  wakeMaintenance(publicFormEvent(result.lockedEvent, result.lockedEvent.publishedAt), now, settings, result.expiresAt);
  return { expiresAt: result.expiresAt };
}

/**
 * «Retrage» (§NNN): the invitation ends now — its link's page says it was withdrawn — and the place it
 * held is free: offered to the line in the same transaction as the event's setting says
 * (`fillAvailableSpots`, a no-op on «Nu»). Audited. The Administrator's alone.
 */
export async function withdrawInvitationByStaff<T extends Record<string, unknown>>(
  db: Database<T>,
  invitationId: string,
  actor: { id: string; role: StaffRole },
  now: Date,
): Promise<void> {
  if (!canManageRegistrations(actor.role)) throw new DomainError("FORBIDDEN", `role ${actor.role} may not withdraw an invitation`);
  const settings = await currentDeadlines(db);
  const result = await db.transaction(async (tx) => {
    const { invitation, lockedEvent } = await lockOpenInvitation(tx, invitationId, now);
    await tx
      .update(eventInvitations)
      .set({ withdrawnAt: now, withdrawnByStaffUserId: actor.id })
      .where(and(eq(eventInvitations.id, invitation.id), isNull(eventInvitations.acceptedAt), isNull(eventInvitations.withdrawnAt)));
    /*
      Its link accepts nothing from now: the press asks the invitation's state under the lock. The token is
      left as it is, so the link's page can still read the invitation and say it was withdrawn rather than
      the generic «link no longer works» (§13.2's refusal is for a link nobody can read).
    */
    await recordAuditEvent(tx, {
      actorStaffUserId: actor.id,
      participantId: null,
      action: "event.invitation_withdrawn",
      entityType: "event",
      entityId: invitation.eventId,
      metadata: { invitationId: invitation.id, outsideCapacity: invitation.outsideCapacity },
      now,
    });
    const event = publicFormEvent(lockedEvent, lockedEvent.publishedAt);
    const offersMade = await fillAvailableSpots(tx, event, now, settings);
    return { event, offersMade };
  });
  revalidatePublicContent("places");
  wakeMaintenance(result.event, now, settings, result.offersMade > 0 ? offerDeadline(result.event, now, settings) : null);
}

/**
 * The registration an invitation's link created, seated in the invitation's place (§NNN), inside the
 * caller's transaction (`invitations.ts#acceptInvitation`), after `submitRegistration` wrote it waiting
 * for its address:
 *
 * - **the address is proved**: the link only the inbox holds was pressed, so the participant's own
 *   `email_verified_at` is written (`markEmailVerified`, as the address's own link would) and no
 *   verification email is ever queued;
 * - «În afara locurilor» from the invitation (§643) is written on the registration before the allocator;
 * - **the place**: the allocator gives the registration its place directly (`allocateOrWaitlist`'s
 *   `invited`, like a family's reserved place) while the invitation still counts its own — so the line
 *   is served from a count that includes it — and only then is the invitation marked accepted with the
 *   registration's id: the place moves from the invitation's bucket to the declaration hold in one
 *   transaction, with no instant where it is free. The hold has the ordinary deadline (§104), and the
 *   ordinary `COMPLETE_DECLARATION` email is queued — the declaration is the person's to sign;
 * - one audit row `event.invitation_accepted` (no actor: the person, from the link).
 */
export async function seatInvitedRegistration<T extends Record<string, unknown>>(
  tx: Transaction<T>,
  event: EventForRegistration,
  registrationId: string,
  invitation: { id: string; outsideCapacity: boolean; eventId: string },
  now: Date,
  settings: Deadlines,
): Promise<Registration> {
  const lockedEvent = await repo.lockEventForCapacity(tx, event.id);
  if (!lockedEvent) throw new DomainError("NOT_FOUND", "no such event");
  const current = await repo.findRegistrationById(tx, registrationId);
  if (!current || current.eventId !== invitation.eventId || current.status !== "PENDING_EMAIL_CONFIRMATION") {
    throw new DomainError("CONFLICT", "the invitation's registration changed state concurrently");
  }
  if (invitation.outsideCapacity) {
    await tx.update(registrations).set({ outsideCapacity: true, updatedAt: now }).where(eq(registrations.id, current.id));
  }
  await markEmailVerified(tx, current.participantId, now);
  const allocated = await allocateOrWaitlist(tx, withLockedRow(event, lockedEvent), current.id, now, settings, { invited: true });
  const [accepted] = await tx
    .update(eventInvitations)
    .set({ acceptedAt: now, acceptedRegistrationId: allocated.id })
    .where(and(eq(eventInvitations.id, invitation.id), invitationOpen()))
    .returning({ id: eventInvitations.id });
  if (!accepted) throw new InvitationRefusal("INVITATION_NOT_OPEN");
  await enqueueAllocationEmail(tx, allocated, await deliveryEmailOf(tx, current.participantId), `registration:${allocated.id}:invitation-accepted:${now.toISOString()}`, now);
  await recordAuditEvent(tx, {
    actorStaffUserId: null,
    participantId: null,
    action: "event.invitation_accepted",
    entityType: "event",
    entityId: invitation.eventId,
    metadata: { invitationId: invitation.id, registrationId: allocated.id },
    now,
  });
  // The hold's deadline, for the job (§334) — as `confirmEmail` wakes it from inside a caller's transaction.
  wakeMaintenance(event, now, settings, allocated.holdExpiresAt);
  return allocated;
}
