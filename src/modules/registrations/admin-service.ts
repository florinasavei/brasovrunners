import { and, asc, count, eq, isNull, or } from "drizzle-orm";
import { declarationAcceptances } from "@/db/schema/declaration-acceptances";
import type { EmailMessageType } from "@/db/schema/email-outbox";
import { events } from "@/db/schema/events";
import { participants } from "@/db/schema/participants";
import { type Registration, registrations } from "@/db/schema/registrations";
import type { StaffUser } from "@/db/schema/staff-users";
import type { Database } from "@/db/types";
import type { Locale } from "@/i18n/routing";
import { recordAuditEvent, scrubParticipantFromAudit, scrubRegistrationFromAudit } from "@/modules/audit/repository";
import { consumeRateLimit } from "@/modules/rate-limit/service";
import { enqueueEmail } from "@/modules/notifications/outbox";
import { drainOutboxAfterResponse, drainOutboxRowsAfterResponse } from "@/modules/notifications/drain";
import { type DeliveryChoice, markedForNow } from "@/modules/notifications/domain/send-at-once";
import { assertRoomToSendNow, clubCopyTypesFor, outboxIdsForKey } from "@/modules/notifications/send-at-once";
import { canonicalizeEmail } from "@/modules/participants/domain/canonical-email";
import { findParticipantByCanonicalEmail } from "@/modules/participants/repository";
import { revalidatePublicContent } from "@/modules/public-cache/cache";
import { canManageRegistrations, canReadRegistrations, canWorkTheDesk } from "@/modules/staff-identity/domain/roles";
import { DomainError, isDomainError } from "@/shared/errors/domain-error";
import {
  type EmergencyDetails,
  type EmergencySheetRow,
  findEmergencyDetails,
  listEmergencySheet,
} from "./admin-repository";
import { clearOptionalData, OPTIONAL_DATA_FIELDS, type OptionalDataField } from "./consent-withdrawal";
import { setPromoConsent } from "./promo-consent";
import { eraseConfirmationMatches } from "./domain/erase-confirmation";
import type { SexChoice } from "./domain/sex";
import { heldRefusal, refuseIfRegistrationHeld, registrationIsHeld } from "./declaration-hold";
import { bibNumberInUse, isEventSpareNumber, retiredBibNumbers } from "./bibs";
import { BIB_NUMBER_MAX, handsSpareAtConfirm } from "./domain/spare-bibs";
import { type BulkResendCounts, canResendDeclarationToAll, canResendReminder, deriveAllowedResendMessageType } from "./domain/resend";
import { listDeclarationResendCandidates, sortCandidates, spentResendLimits } from "./bulk-resend";
import { canTransition, isActiveStatus, isTerminalStatus } from "./domain/state-machine";
import { waitlistRefusalOf, walkInLeftUnconfirmedError } from "./domain/waitlist";
import { registrationNameKey, sameRunner } from "./domain/name-key";
import { ALREADY_ON_ADDRESS } from "./domain/family";
import { composeLegalName } from "./names";
import {
  findEventForAllocation,
  findRegistrationById,
  findRegistrationsByEventAndParticipant,
  lockEventForCapacity,
} from "./repository";
import {
  checkIn,
  confirmByStaff,
  type EventForRegistration,
  offerPlaceToByStaff,
  promoteFromWaitlistByStaff,
  submitRegistration,
  undoCheckIn,
  unregister,
} from "./service";

/**
 * Admin resend (AGENTS.md §15.8; BR-REQ-060-01, BR-REQ-070-01). Administrator only — §10.2
 * reserves "registrations, participants, waitlist... exports" to that role alone.
 *
 * "Resend never changes state or marks declaration accepted": this function's only write is
 * one `enqueueEmail`, which is why it takes no transaction of its own — there is no state
 * change to make atomic with anything.
 */
function assertAdministrator(actor: Pick<StaffUser, "role">): void {
  if (!canManageRegistrations(actor.role)) {
    throw new DomainError(
      "FORBIDDEN",
      `role ${actor.role} may not resend registration email; AGENTS.md §10.2 reserves it to ADMIN`,
    );
  }
}

/** The desk verbs (BR-REQ-037-07, -08): every staff role, so a volunteer can run pickup. */
function assertDesk(actor: Pick<StaffUser, "role">): void {
  if (!canWorkTheDesk(actor.role)) {
    throw new DomainError("FORBIDDEN", `role ${actor.role} may not work the desk`);
  }
}

export async function resendRegistrationMessage<T extends Record<string, unknown>>(
  db: Database<T>,
  actor: Pick<StaffUser, "id" | "role">,
  registrationId: string,
  now: Date,
  /** `EVENT_REMINDER` asks for the reminder instead of the state's own message (§81). */
  wanted?: "EVENT_REMINDER",
  /**
   * «now» sends it after this response, past the scheduled pass (§540); «queue», the default, leaves
   * it to «Când pleacă emailurile», as every resend did before.
   */
  delivery: DeliveryChoice = "queue",
  /** Facts the message reads at send time beside the row's own — a family's confirmed people (§588). */
  extraPayload: Record<string, unknown> = {},
): Promise<void> {
  assertAdministrator(actor);

  const registration = await findRegistrationById(db, registrationId);
  if (!registration) throw new DomainError("NOT_FOUND", "no such registration");

  if (wanted === "EVENT_REMINDER") {
    const [event] = await db
      .select({ startsAt: events.startsAt })
      .from(events)
      .where(eq(events.id, registration.eventId))
      .limit(1);
    if (!event || !canResendReminder(registration.status, event.startsAt, now)) {
      throw new DomainError(
        "VALIDATION_ERROR",
        "the reminder can be sent only for a confirmed registration to an event that has not started",
      );
    }
  }

  const messageType = wanted ?? deriveAllowedResendMessageType(registration.status);
  if (!messageType) {
    throw new DomainError(
      "VALIDATION_ERROR",
      `nothing to resend for a registration in status ${registration.status}`,
    );
  }
  /*
    A cancelled event's links lead nowhere (§331): the declaration refuses, the offer refuses,
    the confirmation's QR opens a desk that is closed. Its participants were told in a message
    of its own, so the one thing still worth sending is where their registration stands.
  */
  if (messageType !== "REGISTRATION_STATE_NOTICE") {
    const event = await findEventForAllocation(db, registration.eventId);
    if (event?.eventStatus === "CANCELLED") {
      throw new DomainError("VALIDATION_ERROR", "the event is cancelled; its participants were told, and there is nothing to resend");
    }
  }

  const [participant] = await db
    .select({ deliveryEmail: participants.deliveryEmail })
    .from(participants)
    .where(eq(participants.id, registration.participantId))
    .limit(1);
  if (!participant) throw new DomainError("NOT_FOUND", "no such participant");

  /*
    «Trimite acum, fără să aștepte trecerea programată» (§540): inside the day's allowance, asked
    before anything is queued, so a refusal leaves nothing behind (§80: refused, never deferred in
    silence). The club's copies ride with it, each on the club group's road, and count too.
  */
  if (delivery === "now") {
    const copies = await clubCopyTypesFor(db, { messageType, recipientEmail: participant.deliveryEmail, real: registration.kind === "REAL" });
    await assertRoomToSendNow(db, [messageType], now, copies);
  }

  const outcome = await queueManualResend(db, actor, registration, participant.deliveryEmail, messageType, now, {
    delivery,
    extraPayload,
    // Sent now by its own drain below, not by the timing's (§540); queued, the timing's as before.
    drainAfter: delivery !== "now",
  });
  if (!outcome.queued) {
    throw new DomainError(
      "VALIDATION_ERROR",
      `this registration has had ${outcome.count} resends in the last hour; wait ${outcome.retryAfter} seconds`,
    );
  }
  // The message and its club copies, after this response, whatever «Când pleacă emailurile» says.
  if (delivery === "now") drainOutboxRowsAfterResponse(await outboxIdsForKey(db, outcome.idempotencyKey));
}

type ManualResendOutcome =
  | { queued: true; idempotencyKey: string }
  | { queued: false; count: number; limit: number; retryAfter: number };

/**
 * One registration's manual resend, past every check that only reads — the one path the single
 * press and the bulk press both take (§606): the registration's hourly limit, the enqueue marked
 * `isManualResend`, and the registration's own trail. A bulk press is exactly N of these.
 *
 * BR-REQ-037-02 criterion 5: "repeated resends... a rate limit applies and the refusal is
 * recorded." Keyed on the registration rather than the administrator, because what is being
 * protected is one participant's inbox — two organizers both clicking resend is exactly the case to
 * catch, and it is invisible if each of them has their own allowance.
 *
 * The caller checks everything that only reads first — the message type, the event, the day's
 * allowance for a «now» (§540) — so a press refused for any of those spends none of the hour's
 * resends and the «Pune la coadă» the allowance's refusal suggests is still allowed; a throttled
 * resend queues nothing at all and answers `queued: false`, which the single press turns into a real
 * error (an authenticated Administrator looking at the screen: nothing to leak, everything to gain
 * from saying what happened) and the bulk press counts as skipped.
 *
 * The idempotency key is the registration and the press's instant: a deliberate resend is a new
 * trigger (§12.11), and the same press never queues one registration twice. Never a state change
 * (§79): the only writes are the limit's counter, the outbox row and an audit row.
 */
async function queueManualResend<T extends Record<string, unknown>>(
  db: Database<T>,
  actor: Pick<StaffUser, "id">,
  registration: Pick<Registration, "id" | "participantId" | "locale">,
  recipientEmail: string,
  messageType: EmailMessageType,
  now: Date,
  options: { delivery: DeliveryChoice; extraPayload: Record<string, unknown>; drainAfter: boolean },
): Promise<ManualResendOutcome> {
  const verdict = await consumeRateLimit(db, "admin-resend", registration.id, now);
  if (!verdict.allowed) {
    await recordAuditEvent(db, {
      actorStaffUserId: actor.id,
      participantId: registration.participantId,
      action: "registration.resend_rate_limited",
      entityType: "registration",
      entityId: registration.id,
      metadata: { count: verdict.count, limit: verdict.limit },
      now,
    });
    return { queued: false, count: verdict.count, limit: verdict.limit, retryAfter: verdict.retryAfter };
  }

  const idempotencyKey = `registration:${registration.id}:manual-resend:${now.toISOString()}`;
  await db.transaction(async (tx) => {
    const queued = await enqueueEmail(tx, {
      participantId: registration.participantId,
      registrationId: registration.id,
      messageType,
      locale: registration.locale,
      recipientEmail,
      // Marked for the queue panel's «Pleacă acum» (§540); the club's copies carry the mark with it.
      payload: markedForNow({ ...options.extraPayload }, options.delivery),
      idempotencyKey,
      requestedByStaffUserId: actor.id,
      isManualResend: true,
      now,
      drainAfter: options.drainAfter,
    });
    // The press, on the registration's trail (§540): who, which message, and that it passed the round.
    if (options.delivery === "now" && queued) {
      await recordAuditEvent(tx, {
        actorStaffUserId: actor.id,
        participantId: registration.participantId,
        action: "registration.sent_now",
        entityType: "registration",
        entityId: registration.id,
        metadata: { outboxId: queued.id, messageType, bypassedSchedule: true },
        now,
      });
    }
  });
  return { queued: true, idempotencyKey };
}

/** The marker on a bulk press refused because nothing can be signed any more (§606). */
export const BULK_RESEND_CLOSED = "bulkResendClosed";
/** The marker on a bulk press refused by the event's own hourly limit (§606). */
export const BULK_RESEND_LIMITED = "bulkResendLimited";

/** What one bulk press did (§606): the real registrations' counts, the test ones apart (§12.6). */
export type BulkResendResult = BulkResendCounts & { test: BulkResendCounts };

/**
 * «Retrimite declarația tuturor care nu au semnat» (§606, amending §540): a fresh signing link to
 * every registration of the event still `PENDING_DECLARATION`, in one press — Administrator only,
 * the single resend's rule, asserted here as in the action.
 *
 * Who is left out, and counted: a registration whose declaration email is still queued or left
 * within the hour (it has an email coming, or just got one — never two in the hour), and one whose
 * own `admin-resend` hour is spent (a spent limit is a spent limit). No condition on `kind`.
 *
 * Refused before anything is written when the declaration can no longer be signed — the event
 * cancelled, completed or started — and when the event's three presses of the hour are spent
 * (`admin-bulk-resend`, counted after the event check and before the candidate reads, so a refusal for a closed event spends none).
 *
 * Each registration goes through `queueManualResend`, the single press's own path; the press adds
 * one audit row with its counts and one drain after the response for the whole press. It queues; the
 * outbox sends at the road's pace (§443, §513). Nothing else moves: no state, hold or deadline (§79).
 */
export async function resendDeclarationToAllPending<T extends Record<string, unknown>>(
  db: Database<T>,
  actor: Pick<StaffUser, "id" | "role">,
  eventId: string,
  now: Date,
): Promise<BulkResendResult> {
  assertAdministrator(actor);
  const event = await findEventForAllocation(db, eventId);
  if (!event) throw new DomainError("NOT_FOUND", "no such event");
  if (!canResendDeclarationToAll(event.eventStatus, event.startsAt, now)) {
    throw new DomainError("VALIDATION_ERROR", `the event is ${event.eventStatus} or has started; nothing can be signed`, [BULK_RESEND_CLOSED]);
  }

  const verdict = await consumeRateLimit(db, "admin-bulk-resend", eventId, now);
  if (!verdict.allowed) {
    await recordAuditEvent(db, {
      actorStaffUserId: actor.id,
      action: "registration.bulk_resend_rate_limited",
      entityType: "event",
      entityId: eventId,
      metadata: { count: verdict.count, limit: verdict.limit },
      now,
    });
    throw new DomainError(
      "VALIDATION_ERROR",
      `this event has had ${verdict.count} resends to everyone in the last hour; wait ${verdict.retryAfter} seconds`,
      [BULK_RESEND_LIMITED],
    );
  }

  const candidates = await listDeclarationResendCandidates(db, eventId, now);
  const spent = await spentResendLimits(
    db,
    candidates.map((candidate) => candidate.registration.id),
    now,
  );
  const { send, recent, limited } = sortCandidates(candidates, spent);
  const queued: typeof send = [];
  for (const candidate of send) {
    const outcome = await queueManualResend(db, actor, candidate.registration, candidate.deliveryEmail, "COMPLETE_DECLARATION", now, {
      delivery: "queue",
      extraPayload: {},
      drainAfter: false,
    });
    // A single press in the moment between the read and this one may have spent the hour: skipped, like the others.
    if (outcome.queued) queued.push(candidate);
    else limited.push(candidate);
  }

  const tally = (kind: "REAL" | "TEST"): BulkResendCounts => {
    const of = (rows: typeof send) => rows.filter((row) => row.registration.kind === kind).length;
    return { queued: of(queued), skippedRecent: of(recent), skippedLimited: of(limited) };
  };
  const result: BulkResendResult = { ...tally("REAL"), test: tally("TEST") };
  // The press, on the event: who, and the counts — never a name or an address.
  await recordAuditEvent(db, {
    actorStaffUserId: actor.id,
    action: "registration.bulk_resend",
    entityType: "event",
    entityId: eventId,
    metadata: { ...result, messageType: "COMPLETE_DECLARATION" },
    now,
  });
  // One drain for the whole press (§68), never one per row; under the scheduled timing it wakes the job.
  if (queued.length > 0) drainOutboxAfterResponse();
  return result;
}

/**
 * «Retrimite familiei» (§588): ONE email to the address for every person it holds at the event, the
 * step the family is at — Administrator only (§289), through the row resend above, so the same
 * checks, the same hourly limit on the row it sends for, the same «Trimite acum» (§540).
 *
 * Which message covers everybody, first that applies:
 * - somebody still waits for the address: that person's verification link, which since §588 confirms
 *   every waiting person on the address in one click; the email names the others with their state;
 * - somebody has a declaration to sign: that person's request, whose one link signs them all (§471);
 * - everybody else confirmed: one confirmation with each confirmed person's QR, desk code and number
 *   (the family's confirmation of §519, for the address's confirmed people rather than a sitting's).
 * A family of waiting-list people only has nothing to send, as a single one has not.
 */
export async function resendFamilyMessage<T extends Record<string, unknown>>(
  db: Database<T>,
  actor: Pick<StaffUser, "id" | "role">,
  registrationId: string,
  now: Date,
  delivery: DeliveryChoice = "queue",
): Promise<void> {
  assertAdministrator(actor);
  const registration = await findRegistrationById(db, registrationId);
  if (!registration) throw new DomainError("NOT_FOUND", "no such registration");
  const family = (await findRegistrationsByEventAndParticipant(db, registration.eventId, registration.participantId))
    .filter((row) => isActiveStatus(row.status))
    .sort((a, b) => a.submittedAt.getTime() - b.submittedAt.getTime());
  if (family.length < 2) throw new DomainError("VALIDATION_ERROR", "the address holds nobody else at this event");
  const target =
    family.find((row) => row.status === "PENDING_EMAIL_CONFIRMATION") ??
    family.find((row) => row.status === "PENDING_DECLARATION" || row.status === "WAITLIST_OFFERED") ??
    family.find((row) => row.status === "CONFIRMED");
  if (!target) throw new DomainError("VALIDATION_ERROR", "everybody on the address is on the waiting list; there is nothing to resend");
  const confirmed = family.filter((row) => row.status === "CONFIRMED").map((row) => row.id);
  const extra = target.status === "CONFIRMED" && confirmed.length > 1 ? { familyRegistrationIds: confirmed } : {};
  await resendRegistrationMessage(db, actor, target.id, now, undefined, delivery, extra);
  // The press on the trail of the row it was made from: who, which message, how many people — never a name.
  await recordAuditEvent(db, {
    actorStaffUserId: actor.id,
    participantId: registration.participantId,
    action: "registration.family_resent",
    entityType: "registration",
    entityId: registration.id,
    metadata: { sentFor: target.id, status: target.status, people: family.length },
    now,
  });
}

// --- The rest of the registration CRUD (BR-REQ-037-03, BR-REQ-037-05) -------------------------

/**
 * What every function below shares, and why it is worth stating once.
 *
 * These are the three administrative changes to a registration that exist: entering one for
 * somebody, correcting the name it carries, and cancelling it. There is deliberately no fourth.
 * There is no verified-email edit and no participant merge (BR-REQ-037-03 criterion 2) — the
 * verified address *is* the identity (AGENTS.md §10.3), and a typo is fixed by cancelling and
 * registering again with the right one. There is no delete: a registration records what
 * somebody agreed to and when, and cancelling is what "remove them" means (§10.5).
 *
 * None of them writes to `registrations` directly except the name correction, which changes one
 * text column and touches no state. Creation and cancellation go through
 * `modules/registrations/service.ts` — the same allocator, the same event-row lock, the same
 * queue order — because a second write path into that table is how an event ends up overbooked
 * by the people running it.
 */

/** The columns the allocator needs, read from an event the backoffice named. */
async function eventForRegistration<T extends Record<string, unknown>>(
  db: Database<T>,
  eventId: string,
): Promise<EventForRegistration> {
  const event = await findEventForAllocation(db, eventId);
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
    publishedAt: event.publishedAt,
    timezone: event.timezone,
    // The event's own minimum age (§329): a staff entry and the desk's walk-in meet the same one.
    minAge: event.minAge,
  };
}

export type CreateRegistrationByStaffInput = {
  eventId: string;
  firstName: string;
  lastName: string;
  /**
   * BR-REQ-031-04 criterion 5. An organizer writes down what somebody said on the telephone;
   * a date of birth they were never told must not cost the club the registration. The row
   * can be completed later, a refusal cannot be undone.
   */
  details?: {
    displayName?: string;
    birthDate?: string;
    sex?: SexChoice;
    nationality?: string;
    country?: string;
    city?: string;
    phone?: string;
    emergencyContactName?: string;
    emergencyContactPhone?: string;
    clubName?: string;
    /**
     * A minor's parent or guardian (§108): required by the staff schema when a birth date is
     * given and says under eighteen, as on the public form, so the desk can enter a fourteen-to-
     * seventeen-year-old with the date (§324). Kept only for a minor.
     */
    guardianName?: string;
    /** BR-REQ-031-06. What the person told the organizer; a claim like every other one. */
    clubMemberDeclared?: boolean;
    tshirtSize?: "NONE" | "XS" | "S" | "M" | "L" | "XL" | "XXL";
  };
  email: string;
  locale: Locale;
  listOptOut: boolean;
  /**
   * The organizer confirming they are relaying somebody's request rather than inventing it
   * (`DECISIONS.md` §33). Not a substitute for consent, and it cannot become one: the
   * declaration is still signed by the participant from the link in their own email, and a
   * registration reaches CONFIRMED no other way.
   */
  relayedByParticipantRequest: boolean;
  /**
   * Fast track (BR-REQ-037-07): the person is at the desk. Their address is vouched for by the
   * member of staff entering it, and the declaration is signed on paper in front of them, so
   * the registration goes through the allocator straight away — to CONFIRMED, or to the
   * waiting list if the event is full, exactly as anyone else's would.
   */
  fastTrack?: boolean;
  /**
   * The number handed to the walk-in with the paper (§444): the desk's next spare, which the form
   * suggests, or any free number the volunteer typed. Only with the fast track — a person who
   * finishes from their own email is not standing at the table holding a bib — and written only
   * if the confirmation gives them a place.
   */
  bibNumber?: number;
};

/**
 * The marker on the walk-in's refusal when the row was entered and the number handed with it was
 * given to somebody else in the moment between the desk's check and the confirmation (§444) —
 * two volunteers, one spare. Like `WALK_IN_LEFT_UNCONFIRMED`, something was written: the entry
 * stands unconfirmed, and the desk confirms it on paper with another spare.
 */
export const WALK_IN_BIB_TAKEN = "walkInBibTaken";

/**
 * The desk's word for a refused handed number (§444): `BIB_NUMBER_TAKEN` when the box itself was
 * refused and nothing was written, `WALK_IN_BIB_TAKEN` when the walk-in was entered first. Null for
 * any other error, which keeps its own code.
 */
export function handedBibRefusalCode(error: unknown): "BIB_NUMBER_TAKEN" | "WALK_IN_BIB_TAKEN" | null {
  if (!isDomainError(error)) return null;
  if (error.fields.includes(WALK_IN_BIB_TAKEN)) return "WALK_IN_BIB_TAKEN";
  if (error.code === "CONFLICT" && error.fields.includes("bibNumber")) return "BIB_NUMBER_TAKEN";
  return null;
}

/** A number typed at the desk is a whole number a bib can carry, or it is refused naming its box. */
function assertHandedBibNumber(bibNumber: number | undefined): void {
  if (bibNumber === undefined) return;
  if (!Number.isInteger(bibNumber) || bibNumber < 1 || bibNumber > BIB_NUMBER_MAX) {
    throw new DomainError("VALIDATION_ERROR", "a race number is a whole number from 1 to 99999", ["bibNumber"]);
  }
}

/**
 * Enter a registration for somebody who asked in person, on the phone, or after a run
 * (BR-REQ-037-05).
 *
 * Identical to a public submission in every way that touches a place: the same
 * `submitRegistration`, so the same locked transaction, the same capacity formula, the same
 * position at the back of the waiting list, and the same PENDING_EMAIL_CONFIRMATION start. The
 * participant gets the ordinary verification email and finishes it themselves — unless
 * `fastTrack` says they are standing at the desk, in which case `confirmRegistrationByStaff`
 * takes it from there (BR-REQ-037-07).
 *
 * A desk verb since `DECISIONS.md` §67: a walk-in on race morning is entered by whoever is at
 * the table, and that is a volunteer.
 */
export async function createRegistrationByStaff<T extends Record<string, unknown>>(
  db: Database<T>,
  actor: Pick<StaffUser, "id" | "role">,
  input: CreateRegistrationByStaffInput,
  now: Date,
): Promise<void> {
  assertDesk(actor);

  if (!input.relayedByParticipantRequest) {
    throw new DomainError(
      "VALIDATION_ERROR",
      "confirm that this person asked to be registered before entering it for them",
      // The box, by the name the form posts, so the refusal can point at it (§315).
      ["relayedByParticipantRequest"],
    );
  }

  const event = await eventForRegistration(db, input.eventId);

  /*
    The number handed with the paper (§444), checked before anything is written: a box that is
    refused leaves no entry behind. Only on the fast track — without it the person finishes from
    their own email, and nobody at a table is holding a bib for them. Checked again under the event
    lock by the confirmation below; this is what makes the ordinary refusal cost nothing.
  */
  /*
    Without the tick the box is ignored rather than refused: the desk prefills it with the next
    spare, and a volunteer who unticks the fast track (the person finishes from their own email)
    must not be trapped behind a refusal about a box they never typed in.
  */
  const handedBib = input.fastTrack ? input.bibNumber : undefined;
  assertHandedBibNumber(handedBib);
  if (handedBib !== undefined) {
    if (await bibNumberInUse(db, { eventId: event.id, number: handedBib })) {
      throw new DomainError("CONFLICT", `number ${handedBib} is already somebody's at this event`, ["bibNumber"]);
    }
  }

  /**
   * The public form answers a duplicate with the same generic success it gives everyone
   * (BR-REQ-031-01 criterion 3), because there the question is "does this address already have
   * a registration" and answering it would say who is signed up. Here it is being answered to
   * an Administrator who can already read the whole list, and "nothing happened, and you were
   * told it worked" is the wrong outcome for somebody standing at a desk.
   */
  /*
    Since §493 the question is "is *this person* already registered on the address", not "is the
    address registered": a family on one address (§389, §446) is entered at the desk one person at a
    time — twins included, whom the public form's rule cannot tell from a slip — and the staff member
    typing the name is the intent the public form has to ask the inbox for. The same runner again
    (the name by the runner's key) is refused here, before anything is written; everything else —
    the club's limit per address, a schema that still holds one registration per address — is
    decided under the event's lock (`decideSubmission`, via `staff`), which refuses out loud too.
  */
  const identity = canonicalizeEmail(input.email);
  const existingParticipant = await findParticipantByCanonicalEmail(db, identity.canonicalEmail);
  if (existingParticipant) {
    const legalName = composeLegalName(input.firstName, input.lastName);
    const rows = await findRegistrationsByEventAndParticipant(db, event.id, existingParticipant.id);
    if (rows.some((row) => isActiveStatus(row.status) && sameRunner(row.registeredName, legalName))) {
      throw new DomainError("VALIDATION_ERROR", "this person is already registered on this address", ["email", ALREADY_ON_ADDRESS]);
    }
  }

  const submitted = await submitRegistration(
    db,
    event,
    {
      firstName: input.firstName,
      lastName: input.lastName,
      ...input.details,
      email: input.email,
      locale: input.locale,
      // The organizer confirmed above that they are relaying a request. That relay is what the
      // acknowledged notice version on the row records, and the audit entry below is what says
      // who made it — the participant's own agreement is the declaration, which only they sign.
      privacyAcknowledged: true,
      // Never assumed on somebody's behalf: results consent is a separate question with its own
      // legal basis, and the answer nobody gave is "no".
      resultsNameConsent: false,
      listOptOut: input.listOptOut,
    },
    now,
    "REAL",
    { source: "STAFF", createdByStaffUserId: actor.id, atTheDesk: input.fastTrack === true },
  );

  const participant = await findParticipantByCanonicalEmail(db, identity.canonicalEmail);
  /*
    The row this entry wrote, by the id the service returned (§420) — never re-read by address:
    on a family's address (§389) the newest active row may be another runner's, entered on the
    public form a moment later, and the fast track below would confirm *them* on this person's paper.
  */
  const created = submitted.registrationId ? await findRegistrationById(db, submitted.registrationId) : undefined;

  await recordAuditEvent(db, {
    actorStaffUserId: actor.id,
    participantId: participant?.id ?? null,
    action: "registration.created_by_staff",
    entityType: "registration",
    entityId: created?.id ?? event.id,
    metadata: { eventId: event.id, status: created?.status ?? null, fastTrack: Boolean(input.fastTrack) },
    now,
  });

  if (input.fastTrack && created) {
    try {
      await confirmRegistrationByStaff(db, actor, created.id, now, { bibNumber: handedBib });
    } catch (error) {
      // The spare went to somebody else between the check above and this lock (§444): the entry
      // stands, unconfirmed and emailed nothing, and the desk is told to confirm it with another.
      if (handedBibRefusalCode(error) === "BIB_NUMBER_TAKEN") {
        throw new DomainError("CONFLICT", `${(error as Error).message} (the walk-in was entered and left unconfirmed)`, [WALK_IN_BIB_TAKEN]);
      }
      /*
        The last place and the last slot in the line taken between the entry above and this
        confirmation (§348) — two transactions, so a window, however small. The entry stands,
        unconfirmed, with its audit row, and no email went to the person (`atTheDesk`); it lapses
        when its link does, like any unconfirmed registration (§377), or the desk confirms it on paper once a slot
        opens. The desk is told exactly that rather than the "nothing changed" of a refusal at the
        entry itself.
      */
      if (error instanceof DomainError && waitlistRefusalOf(error) !== null) throw walkInLeftUnconfirmedError(error);
      throw error;
    }
  }
}

/**
 * Confirm at the desk (BR-REQ-037-07): the address vouched for, the declaration on paper.
 * Through the allocator — a full event answers WAITLISTED — and audited with the outcome.
 */
export async function confirmRegistrationByStaff<T extends Record<string, unknown>>(
  db: Database<T>,
  actor: Pick<StaffUser, "id" | "role">,
  registrationId: string,
  now: Date,
  /** The number handed with the paper (§444): a desk spare, or a free number typed at the table. */
  options: { bibNumber?: number } = {},
): Promise<Registration> {
  assertDesk(actor);
  assertHandedBibNumber(options.bibNumber);
  const current = await findRegistrationById(db, registrationId);
  if (!current) throw new DomainError("NOT_FOUND", "no such registration");
  /*
    A handed number only for a row that wears none yet (§444, §548), the rule the desk's box is
    drawn by: nobody has a number before the confirmation, so it is the number this confirmation
    gives; a row that already wears one keeps it, and a printed bib is never swapped. Refused naming
    the box, before anything is written; checked again under the lock.
  */
  if (options.bibNumber !== undefined && !handsSpareAtConfirm(current)) {
    throw new DomainError("VALIDATION_ERROR", "this registration already has a race number; it cannot be changed", ["bibNumber"]);
  }
  const event = await eventForRegistration(db, current.eventId);

  let result: Registration;
  try {
    result = await confirmByStaff(db, event, registrationId, actor, now, { bibNumber: options.bibNumber });
  } catch (error) {
    /*
      The handed number worn by somebody else after all (§444): the check under the lock makes this
      nearly impossible, and the unique index is the last word when it is not — said as the desk's
      "that number is taken", naming the box, rather than as a 500. Nothing was written.
    */
    const message = error instanceof Error ? `${error.message} ${String((error as { cause?: unknown }).cause ?? "")}` : "";
    if (options.bibNumber !== undefined && /registrations_event_bib_number_unique/.test(message)) {
      throw new DomainError("CONFLICT", `number ${options.bibNumber} is already worn by somebody else at this event`, ["bibNumber"]);
    }
    throw error;
  }
  const handed = options.bibNumber !== undefined && result.status === "CONFIRMED" && result.bibNumber === options.bibNumber;
  await recordAuditEvent(db, {
    actorStaffUserId: actor.id,
    participantId: current.participantId,
    action: "registration.confirmed_by_staff",
    entityType: "registration",
    entityId: registrationId,
    // The number handed with the paper, when one was (§444): the audit says a bib left the box.
    metadata: { from: current.status, to: result.status, ...(handed ? { bibNumber: options.bibNumber } : {}) },
    now,
  });
  return result;
}

/** A place ahead of the queue, into a free one (BR-REQ-037-07); refused when full. */
export async function promoteRegistrationByStaff<T extends Record<string, unknown>>(
  db: Database<T>,
  actor: Pick<StaffUser, "id" | "role">,
  registrationId: string,
  now: Date,
): Promise<Registration> {
  assertDesk(actor);
  const current = await findRegistrationById(db, registrationId);
  if (!current) throw new DomainError("NOT_FOUND", "no such registration");
  const event = await eventForRegistration(db, current.eventId);

  const result = await promoteFromWaitlistByStaff(db, event, registrationId, actor, now);
  await recordAuditEvent(db, {
    actorStaffUserId: actor.id,
    participantId: current.participantId,
    action: "registration.promoted_by_staff",
    entityType: "registration",
    entityId: registrationId,
    metadata: { from: current.status, to: result.status },
    now,
  });
  return result;
}

/**
 * «Trimite-i oferta» (§NNN): a free place offered to the waiting-list registration the organizer
 * chose — the ordinary offer and its email, never a confirmation. The Administrator's
 * (`canManageRegistrations`, §289), not the desk's: it changes a registration the Organizer only
 * reads. Asserted here, before anything is read, and again in the service, which writes the audit
 * row in the offer's own transaction.
 */
export async function offerPlaceByStaff<T extends Record<string, unknown>>(
  db: Database<T>,
  actor: Pick<StaffUser, "id" | "role">,
  registrationId: string,
  now: Date,
): Promise<Registration> {
  if (!canManageRegistrations(actor.role)) {
    throw new DomainError("FORBIDDEN", `role ${actor.role} may not send a waiting-list offer`);
  }
  const current = await findRegistrationById(db, registrationId);
  if (!current) throw new DomainError("NOT_FOUND", "no such registration");
  const event = await eventForRegistration(db, current.eventId);
  return offerPlaceToByStaff(db, event, registrationId, actor, now);
}

/**
 * One race number by hand (BR-REQ-038-01 criterion 7): §105's preferential number, or a desk spare
 * (§444). The partial unique index is what refuses two runners with one number; here that
 * surfaces as a sentence.
 *
 * **On a confirmed registration only** (§548, amending §105 and §173). A number exists only once a
 * registration is confirmed, and the confirmation draws one at once and emails it — so there is
 * nothing to type a number into before then, and the preferential number is a change of the one
 * the confirmation gave. §173's lock ("nu ar trebui să mai pot schimba numărul de concurs odată
 * confirmat!") keeps its reason in two rules instead: a printed number never changes (§311), and
 * the number replaced is **retired**, never given to anybody else, because the runner was already
 * sent it — the audit row carries it (`bibs.ts#replacedBibNumbers`) and the runner is sent the new
 * one with a line saying it replaces any earlier number. A confirmed registration with no number
 * (confirmed before §87) is given one the same way. Clearing a confirmed runner's number is
 * refused: it would be a number retired for nothing and a runner with none.
 */
export async function setBibNumberByStaff<T extends Record<string, unknown>>(
  db: Database<T>,
  actor: Pick<StaffUser, "id" | "role">,
  registrationId: string,
  bibNumber: number | null,
  now: Date,
): Promise<Registration> {
  assertDesk(actor);
  if (bibNumber !== null && (!Number.isInteger(bibNumber) || bibNumber < 1 || bibNumber > 99_999)) {
    throw new DomainError("VALIDATION_ERROR", "a race number is a whole number from 1 to 99999");
  }
  const current = await findRegistrationById(db, registrationId);
  if (!current) throw new DomainError("NOT_FOUND", "no such registration");
  if (current.bibNumber === bibNumber) return current;
  /*
    A registration that is over takes no number change at all (§311; BR-REQ-060-01 — the server
    says it, not the missing field). Its number is retired, not free (§173): replacing it would
    hand 27 back while the bib printed for it is still in the pile.
  */
  if (isTerminalStatus(current.status)) {
    throw new DomainError(
      "VALIDATION_ERROR",
      `this registration is ${current.status.toLowerCase()}; its race number is retired and cannot be changed`,
    );
  }
  // Not confirmed yet: the number comes with the confirmation, in its order (§548).
  if (current.status !== "CONFIRMED") {
    throw new DomainError("VALIDATION_ERROR", "a race number is given when the registration is confirmed, not before");
  }
  if (current.kind !== "REAL") {
    throw new DomainError("VALIDATION_ERROR", "a test registration wears no race number");
  }
  if (bibNumber === null) {
    throw new DomainError("VALIDATION_ERROR", "a confirmed registration keeps its race number; type another one to change it");
  }
  /*
    Replacing a number the runner was already emailed retires it for good (§548), so it is a change
    to a registration, the Administrator's (`canManageRegistrations`, §289) — not a desk verb. The
    desk keeps filling the gap: a confirmed row with no number yet takes one from any desk role.
  */
  if (current.bibNumber !== null && !canManageRegistrations(actor.role)) {
    throw new DomainError(
      "FORBIDDEN",
      `role ${actor.role} may not replace a confirmed registration's race number; AGENTS.md §10.2 reserves it to ADMIN`,
    );
  }
  // A number that is on paper stays on it (§311): moving it would leave the printed bib pointing at nobody.
  if (current.bibNumber !== null && current.bibPrintedAt !== null) {
    throw new DomainError("VALIDATION_ERROR", "this race number is already printed; it cannot be changed");
  }

  let updated: Registration;
  try {
    updated = await db.transaction(async (tx) => {
      /*
        The event row's lock first (§444), the one every confirmation holds when it draws or is
        handed a number and the print holds when it reserves spares: two volunteers giving the same
        spare — one typing it here, one confirming with it — are then one after the other, and the
        second meets the check below rather than the unique index.
      */
      await tx.select({ id: events.id }).from(events).where(eq(events.id, current.eventId)).for("update");
      /*
        The number this change replaces, read again under that lock: `current` was read before it,
        so two volunteers replacing 5 with 9 and 5 with 12 at once would otherwise both record
        `from: 5`, and 9 — already emailed — would be retired by nobody. The second meets a changed
        number here and is told to look again.
      */
      const [locked] = await tx
        .select({ bibNumber: registrations.bibNumber })
        .from(registrations)
        .where(eq(registrations.id, registrationId))
        .limit(1);
      if (!locked) throw new DomainError("NOT_FOUND", "no such registration");
      if (locked.bibNumber !== current.bibNumber) {
        throw new DomainError("CONFLICT", "this race number was changed by somebody else a moment ago; look at it again", ["bibNumber"]);
      }
      const replaced = locked.bibNumber;
      if (await bibNumberInUse(tx, { eventId: current.eventId, number: bibNumber, exceptRegistrationId: registrationId })) {
        throw new DomainError("CONFLICT", `number ${bibNumber} is already somebody's at this event`, ["bibNumber"]);
      }
      /*
        A desk spare is on paper already (§444): printed blank and handed out with the name written
        on. Marked printed, so the next "unprinted" sheet does not print a second one with the name,
        and a cancellation lists it among the bibs that exist (§311).
      */
      const spare = await isEventSpareNumber(tx, current.eventId, bibNumber);
      const [row] = await tx
        .update(registrations)
        .set({ bibNumber, updatedAt: now, ...(spare ? { bibPrintedAt: now } : {}) })
        /*
          The refusals above, again, in the write itself (§311): `current` was read before this
          transaction, so a registration cancelled — or a number printed — in between would
          otherwise still have its number moved. No row back means one of them became true.
        */
        .where(
          and(
            eq(registrations.id, registrationId),
            eq(registrations.status, "CONFIRMED"),
            or(isNull(registrations.bibPrintedAt), isNull(registrations.bibNumber)),
            replaced === null ? isNull(registrations.bibNumber) : eq(registrations.bibNumber, replaced),
          ),
        )
        .returning();
      if (!row) {
        throw new DomainError("VALIDATION_ERROR", "this registration is over or its race number is printed; the number cannot be changed");
      }
      /*
        Nor a number retired here (§311, §548) — erased with its row or replaced by hand. The unique
        index cannot say it, the row that wore 27 being gone or wearing another, so the audit rows
        do, read **after** the write, inside it: an erasure commits its audit row before its row goes.
      */
      if ((await retiredBibNumbers(tx, current.eventId)).includes(bibNumber)) {
        throw new DomainError("CONFLICT", `number ${bibNumber} was worn at this event before and stays retired`);
      }
      /*
        The audit row, in the same transaction: its `from` is what retires the replaced number
        (`bibs.ts#replacedBibNumbers`), so a draw that could see the new number and not the row
        saying the old one is retired must be impossible. The event is named so the read can find it.
      */
      await recordAuditEvent(tx, {
        actorStaffUserId: actor.id,
        participantId: current.participantId,
        action: "registration.bib_set",
        entityType: "registration",
        entityId: registrationId,
        metadata: { eventId: current.eventId, from: replaced, to: bibNumber },
        now,
      });
      return row;
    });
  } catch (error) {
    const message = error instanceof Error ? `${error.message} ${String((error as { cause?: unknown }).cause ?? "")}` : "";
    if (/registrations_event_bib_number_unique/.test(message)) {
      throw new DomainError("CONFLICT", `number ${bibNumber} is already worn by somebody else at this event`);
    }
    throw error;
  }
  /*
    The public list may show this number (§NNN, behind the privacy notice): a number typed by hand
    is a write that is not a change of state, so `transitionRegistration` does not expire the list's
    cached page for it — this does, after the commit, or the old number would stay up for a while.
  */
  revalidatePublicContent("places");
  // The runner is told (§105): the confirmation carried the old number, or none. A number at a
  // race that will not run is not news (§331): it is written, and nobody is mailed.
  const event = await findEventForAllocation(db, updated.eventId);
  if (event?.eventStatus !== "CANCELLED") {
    await db.transaction(async (tx) => {
      await enqueueEmail(tx, {
        participantId: updated.participantId,
        registrationId: updated.id,
        messageType: "BIB_ASSIGNED",
        locale: updated.locale,
        recipientEmail: (await tx.select({ deliveryEmail: participants.deliveryEmail }).from(participants).where(eq(participants.id, updated.participantId)).limit(1))[0]?.deliveryEmail ?? "",
        payload: { bibNumber },
        idempotencyKey: `registration:${updated.id}:bib:${bibNumber}:${now.toISOString()}`,
        now,
      });
    });
  }
  return updated;
}

/** Check a participant in at the desk (BR-REQ-037-08), or take it back. */
export async function checkInByStaff<T extends Record<string, unknown>>(
  db: Database<T>,
  actor: Pick<StaffUser, "id" | "role">,
  registrationId: string,
  direction: "in" | "undo",
  now: Date,
): Promise<Registration> {
  assertDesk(actor);
  const current = await findRegistrationById(db, registrationId);
  if (!current) throw new DomainError("NOT_FOUND", "no such registration");
  const result = direction === "in" ? await checkIn(db, registrationId, actor, now) : await undoCheckIn(db, registrationId, now);
  await recordAuditEvent(db, {
    actorStaffUserId: actor.id,
    participantId: current.participantId,
    action: direction === "in" ? "registration.checked_in" : "registration.checkin_undone",
    entityType: "registration",
    entityId: registrationId,
    metadata: {},
    now,
  });
  return result;
}

/**
 * Correct the name a registration carries (BR-REQ-037-03 criterion 1).
 *
 * The one editable field, and the audit row records what it was before — which is the whole
 * requirement: a correction nobody can trace is indistinguishable from somebody quietly
 * changing who is on a start list.
 */
export async function correctRegisteredName<T extends Record<string, unknown>>(
  db: Database<T>,
  actor: Pick<StaffUser, "id" | "role">,
  registrationId: string,
  newName: string,
  now: Date,
): Promise<Registration> {
  assertAdministrator(actor);

  const trimmed = newName.trim();
  if (trimmed.length === 0 || trimmed.length > 200) {
    throw new DomainError("VALIDATION_ERROR", "a name is between 1 and 200 characters");
  }

  const current = await findRegistrationById(db, registrationId);
  if (!current) throw new DomainError("NOT_FOUND", "no such registration");
  if (current.registeredName === trimmed) return current;

  /*
    The runner's key follows the name (§389): it is what tells two people on one address apart, so
    a corrected name that is another registration's on the same address and event would make one
    person of two. Refused with the name box's own field, before the unique index would refuse it
    as a driver error — and read under the event's lock, the one `submitRegistration` takes before
    it reads the address, so a rename and a new runner on the same address cannot both find the
    name free and meet in the index.
  */
  const nameKey = registrationNameKey(trimmed);
  const updated = await db.transaction(async (tx) => {
    const locked = await lockEventForCapacity(tx, current.eventId);
    if (!locked) throw new DomainError("NOT_FOUND", "no such event");
    const siblings = await findRegistrationsByEventAndParticipant(tx, current.eventId, current.participantId);
    if (siblings.some((row) => row.id !== current.id && registrationNameKey(row.registeredName) === nameKey)) {
      throw new DomainError("VALIDATION_ERROR", "another registration on this address at this event already carries that name", ["registeredName"]);
    }
    const [row] = await tx
      .update(registrations)
      .set({ registeredName: trimmed, nameKey, updatedAt: now })
      .where(eq(registrations.id, registrationId))
      .returning();
    return row;
  });

  await recordAuditEvent(db, {
    actorStaffUserId: actor.id,
    participantId: current.participantId,
    action: "registration.name_corrected",
    entityType: "registration",
    entityId: registrationId,
    metadata: { from: current.registeredName, to: trimmed },
    now,
  });

  return updated;
}

/**
 * Cancel a registration on the club's behalf (AGENTS.md §15.5, §10.5).
 *
 * The same transition a participant makes from their own link, with `cancellation_source =
 * ADMIN`: the place is released inside the locked transaction and offered to the front of the
 * waiting list before anybody new can take it. The reason the organizer typed goes into the
 * audit metadata, because "why is my registration gone" is the question this record exists to
 * answer.
 *
 * Unlike a participant's own cancellation, this is allowed after the event has started. That
 * guard exists so nobody cancels their way out of a race they are running, and an organizer
 * tidying up afterwards is the case it would otherwise block.
 */
export async function cancelRegistrationByStaff<T extends Record<string, unknown>>(
  db: Database<T>,
  actor: Pick<StaffUser, "id" | "role">,
  registrationId: string,
  reason: string,
  now: Date,
): Promise<Registration> {
  assertAdministrator(actor);

  const current = await findRegistrationById(db, registrationId);
  if (!current) throw new DomainError("NOT_FOUND", "no such registration");

  /**
   * AGENTS.md §10.5 has no `PENDING_EMAIL_CONFIRMATION -> CANCELLED` edge, and this does not add
   * one: a registration whose address has never been confirmed lapses on its own when its email
   * link does (`email_link_expires_at`, from the club's "Termene", §377; `expireStalePendingEmailConfirmations`), and it occupies no place in the meantime, so there
   * is nothing for an organizer to release. Refused with a sentence rather than with the bare
   * CONFLICT the guarded UPDATE would produce — the difference matters to whoever is reading it
   * with somebody waiting at a desk. `DECISIONS.md` §33 records this as the club's question to
   * answer if they ever need to discard one sooner.
   */
  if (!canTransition(current.status, "CANCELLED")) {
    throw new DomainError(
      "VALIDATION_ERROR",
      `a registration in status ${current.status} cannot be cancelled; it expires on its own`,
    );
  }

  const event = await eventForRegistration(db, current.eventId);
  const cancelled = await unregister(db, event, registrationId, "ADMIN", now);

  /*
    A printed bib going void is written into the row's own record (§311; the owner: "trebuie sa
    avem mare grija cu cele anulate, mai ales daca BID-ul a fost deja printat!").

    The number stays retired (§173) and the printed mark stays on the row, so `voidBibsFor`
    finds it; this is so the timeline says "cancelled; bib 27 was printed" on its own, without
    a join and after an erasure. The number and the fact — never the name, which the row id
    already reaches and an erased row must not keep (`AGENTS.md` §12.12).
  */
  const printedBib =
    current.bibPrintedAt !== null && current.bibNumber !== null
      ? { bibNumber: current.bibNumber, bibPrinted: true as const }
      : {};

  await recordAuditEvent(db, {
    actorStaffUserId: actor.id,
    participantId: current.participantId,
    action: "registration.cancelled_by_staff",
    entityType: "registration",
    entityId: registrationId,
    metadata: { from: current.status, reason: reason.trim().slice(0, 500), ...printedBib },
    now,
  });

  return cancelled;
}

/**
 * Cancel several registrations with one reason (§67): the bulk form on the registrations list,
 * which on race morning is the path an Administrator reaches for — and so the one most likely to
 * cancel somebody whose bib is already printed (§311).
 *
 * Each row goes through `cancelRegistrationByStaff`, once: the same guard, the same allocator,
 * the same audit row carrying the printed number. A row that refuses is counted and the rest
 * continue, as the bulk erase does: a batch that stops at the first surprise leaves the club not
 * knowing what happened.
 *
 * What it adds is the answer the saved banner needs — **which printed numbers this press has just
 * made void**, lowest first, read from each cancelled row itself (a cancellation keeps the number
 * and the mark, §173) — so the banner names the bibs to pull out of the pile instead of leaving
 * the club to notice them on the bibs panel afterwards.
 */
export async function bulkCancelRegistrationsByStaff<T extends Record<string, unknown>>(
  db: Database<T>,
  actor: Pick<StaffUser, "id" | "role">,
  registrationIds: readonly string[],
  reason: string,
  now: Date,
): Promise<{ cancelled: number; test: number; failed: number; voided: number[] }> {
  assertAdministrator(actor);

  let cancelled = 0;
  // The test rows among `cancelled`: emailed like any other, counted nowhere the club is told (§30).
  let test = 0;
  let failed = 0;
  const voided: number[] = [];
  for (const registrationId of registrationIds) {
    try {
      const row = await cancelRegistrationByStaff(db, actor, registrationId, reason, now);
      cancelled += 1;
      if (row.kind === "TEST") test += 1;
      if (row.bibNumber !== null && row.bibPrintedAt !== null) voided.push(row.bibNumber);
    } catch (error) {
      if (!isDomainError(error)) throw error;
      failed += 1;
    }
  }
  return { cancelled, test, failed, voided: voided.sort((a, b) => a - b) };
}

/**
 * Erase a registration, and everything that points at it (BR-REQ-037-06, `DECISIONS.md` §44).
 *
 * This did not exist, and its absence was itself a defect. §15.11 permitted entering, renaming
 * and cancelling and nothing more, on the reasoning that cancelling is what "remove them"
 * means — true for a runner who withdraws, and not true at all for the case the rule forgot:
 * somebody exercising their right to erasure. A cancelled registration keeps their name, their
 * address and their declaration. "We cannot delete you" is not an answer the club can give.
 *
 * What it is careful about:
 *
 * - **Cancel first, delete second.** A registration that occupied a place has it released to
 *   the front of the waiting list before the row goes, through the ordinary allocator, so the
 *   queue behaves exactly as it would for a withdrawal. Deleting the row alone would strand
 *   the place until the next maintenance sweep noticed the count no longer matched.
 * - **The audit row is written before the delete and survives it.** `audit_logs.entity_id`
 *   carries no foreign key precisely so a record of the deletion outlives the thing deleted.
 *   It records who, when, why, and the status it was in — never the name or the address, which
 *   are what the deletion exists to remove.
 * - **The declaration acceptance goes too.** It is deleted explicitly, in the same
 *   transaction, because its foreign key does not cascade and because a consent record for a
 *   person who no longer exists is the thing being erased, not evidence to keep.
 *
 * Tokens and outbox rows cascade at the database. Nothing here writes email: a deletion is not
 * a message, and the participant who asked for it does not want one.
 *
 * ## `confirmName` (§180)
 *
 * Optional, and supplied by exactly one caller: the erase panel on the registrations *list*.
 * On the registration's own page you arrived by choosing this person and their name is on the
 * screen; in a list of twenty-five rows that re-sort under you, the row you meant and the row
 * above it are one line apart and the menu is identical for both. So the list makes the
 * Administrator transcribe the row's name, and the check happens **here**, against `current` —
 * the same read the deletion itself is built on — rather than in the action against a second
 * fetch that could disagree with it.
 *
 * It is a slip guard, not an authorization one: `assertAdministrator` above is the gate, and
 * this argument cannot be used to grant anything. That is why it is optional and why leaving it
 * out is not an error.
 */
export async function deleteRegistrationByStaff<T extends Record<string, unknown>>(
  db: Database<T>,
  actor: Pick<StaffUser, "id" | "role">,
  registrationId: string,
  reason: string,
  now: Date,
  options: { confirmName?: string } = {},
): Promise<void> {
  assertAdministrator(actor);

  const current = await findRegistrationById(db, registrationId);
  if (!current) throw new DomainError("NOT_FOUND", "no such registration");

  // Order matters: the role first, then existence, then the typed name. A mismatch must not be
  // the way somebody learns a registration exists, and `NOT_FOUND` before this line is the same
  // answer an Administrator gets for a row that is genuinely gone.
  if (options.confirmName !== undefined && !eraseConfirmationMatches(options.confirmName, current.registeredName)) {
    throw new DomainError("VALIDATION_ERROR", "typed name does not match the registration", [
      "confirmName",
    ]);
  }

  await eraseRegistration(db, actor, current, reason, now);
}

/**
 * Erase several registrations at once (`DECISIONS.md` §287; the owner: "stergerea in batch ar
 * trebui sa mearga! dar cu super extra confirmare!").
 *
 * ## Why this was refused until now, and what changed
 *
 * §67 offers cancel in bulk and erase one at a time, and the reason is still true: cancelling is
 * recoverable — the person registers again — and erasing is not. What changed is who has to live
 * with it. A club clearing a test season, or a race that was set up twice, was erasing forty rows
 * one dialog at a time, and the twentieth confirmation is not read by anybody.
 *
 * ## The confirmation is the count, typed
 *
 * A single erase asks for the registered name (`eraseConfirmationMatches`), which cannot scale to
 * forty. So the batch asks for **the number of rows**, typed, and refuses anything else: it is a
 * fact the screen has just shown, it changes with the selection, and it cannot be muscle memory
 * the way a fixed word or a second "yes" becomes. The owner chose it over typing a magic word
 * precisely for that.
 *
 * Checked here rather than in the action, so it is the rule and not the dialog: a caller that
 * forgets the confirmation erases nothing.
 *
 * ## Everything else is the single erase, once per row
 *
 * The same `eraseRegistration` — the audit row first, the declaration acceptance with the row in
 * one transaction, the place released through the allocator (§33, §44, §67). A row that refuses
 * is counted and the rest continue, exactly as the bulk cancel does: a batch that stops halfway
 * on the first surprise leaves the club with no idea what happened.
 */
export async function bulkDeleteRegistrationsByStaff<T extends Record<string, unknown>>(
  db: Database<T>,
  actor: Pick<StaffUser, "id" | "role">,
  registrationIds: readonly string[],
  reason: string,
  now: Date,
  options: { confirmCount: string },
): Promise<{ erased: number; failed: number }> {
  assertAdministrator(actor);

  if (registrationIds.length === 0) {
    throw new DomainError("VALIDATION_ERROR", "nothing selected", ["registrationId"]);
  }
  // Trimmed, because a typed number arrives with whatever the keyboard added; otherwise exact.
  if (options.confirmCount.trim() !== String(registrationIds.length)) {
    throw new DomainError("VALIDATION_ERROR", "the typed count does not match the selection", [
      "confirmCount",
    ]);
  }

  let erased = 0;
  let failed = 0;
  for (const registrationId of registrationIds) {
    try {
      const current = await findRegistrationById(db, registrationId);
      if (!current) {
        failed += 1;
        continue;
      }
      await eraseRegistration(db, actor, current, reason, now);
      erased += 1;
    } catch (error) {
      if (!isDomainError(error)) throw error;
      failed += 1;
    }
  }
  return { erased, failed };
}

/**
 * The erasure itself, with the authorization and the lookup already done by the caller.
 *
 * Split out of `deleteRegistrationByStaff` so that the second caller — erasing a whole event
 * with everyone on it (`content/events/service.ts` `hardDeleteEvent`) — runs the *same* path
 * rather than a second one that reimplements it. Two implementations of "remove a person from
 * the system" is exactly how one of them ends up forgetting the declaration acceptance, or the
 * audit row, or the release of the place.
 *
 * `db` is deliberately a `Database` and not a `Transaction`: a `Transaction` satisfies
 * `Database`, so the single-registration caller passes the pool and gets today's behaviour
 * unchanged, while the event caller passes its open transaction and every write below — the
 * cancellation, the audit row, the deletes — lands inside it. Drizzle turns the inner
 * `transaction()` calls into savepoints when that happens.
 */
async function eraseRegistration<T extends Record<string, unknown>>(
  db: Database<T>,
  actor: Pick<StaffUser, "id" | "role">,
  current: Registration,
  reason: string,
  now: Date,
): Promise<void> {
  // A declaration held for a complaint or a dispute (§556) is kept, the registration with it: every
  // erase — one, the batch, an event's — meets the refusal until an Administrator clears the hold.
  if (await registrationIsHeld(db, current.id)) throw heldRefusal();

  // Releasing the place is a capacity decision, so it goes through `unregister` and takes the
  // event lock the same way every other one does (§10.6). Only for a row that holds a place:
  // a lapsed or already-cancelled registration holds nothing to give back.
  if (canTransition(current.status, "CANCELLED")) {
    const event = await eventForRegistration(db, current.eventId);
    // No "your registration is cancelled" to somebody who asked to be erased (§322).
    await unregister(db, event, current.id, "ADMIN", now, { notify: false });
  }

  /*
    The number goes with the row, and this row is where it survives (§311).

    Every draw learns which numbers are taken from the rows that wear them, so the deleted row
    would take its settled number out of that set — and "the lowest free number" would hand a
    printed 27 to the next runner while the void bib was still in the pile. The event, the number
    and whether it was on paper are written here instead, and `bibs.ts#erasedBibNumbers` reads
    them back into every draw, the hand-typed number and the free-number hints. Written **before**
    the delete, and committed before it when `db` is the pool: that order is what lets a draw
    that no longer sees the row be certain to see this. An event id and a number are not who
    somebody was.
  */
  const worn =
    current.bibNumber !== null
      ? { eventId: current.eventId, bibNumber: current.bibNumber, bibPrinted: current.bibPrintedAt !== null }
      : {};

  await recordAuditEvent(db, {
    actorStaffUserId: actor.id,
    // Nobody, from the start (§322): the row records that a deletion happened and who
    // authorised it, and a participant id pointing at the person erased is the one thing it
    // must not keep.
    participantId: null,
    action: "registration.deleted_by_staff",
    entityType: "registration",
    entityId: current.id,
    // The status it was in, and why — not who it was. The row exists to show that a deletion
    // happened and who authorised it, not to keep a copy of what was deleted.
    metadata: { from: current.status, reason: reason.trim().slice(0, 500), ...worn },
    now,
  });

  await db.transaction(async (tx) => {
    /*
      The trail forgets whom, in the same transaction as the delete (§322): every earlier row
      about this registration loses its participant id and its typed reason, and a name
      correction its before and after. The deletion's own row above keeps its reason — its
      `from` is a status and its reason and number name nobody (§311).
    */
    // The hold asked again under a lock (§556): the check above is the cheap refusal before any
    // write; this one closes the moment between it and the delete.
    await refuseIfRegistrationHeld(tx, current.id);
    await scrubRegistrationFromAudit(tx, current.id);
    await tx.delete(declarationAcceptances).where(eq(declarationAcceptances.registrationId, current.id));
    await tx.delete(registrations).where(eq(registrations.id, current.id));
    // Erased means gone (`DECISIONS.md` §88): when this was the person's last registration,
    // the participant row goes too — and with it, by cascade, their action tokens and outbox
    // rows (the address). The audit row above keeps `participant_id` as null from here, which
    // is the point: nothing left says who. A participant with another registration stays.
    const [remaining] = await tx
      .select({ n: count() })
      .from(registrations)
      .where(eq(registrations.participantId, current.participantId));
    if ((remaining?.n ?? 0) === 0) {
      // A row about the person, not the registration — an access copy made for them — keeps
      // their uuid in `entity_id`, which the foreign key never reaches (§322).
      await scrubParticipantFromAudit(tx, current.participantId);
      await tx.delete(participants).where(eq(participants.id, current.participantId));
    }
  });
  /*
    The release above already told the public cache, through `transitionRegistration`; this says
    it again for the row that held no place, because erasure is the one write where "the start
    list may still show the name for a while" is not an acceptable answer (§333, `AGENTS.md`
    §12.12). Telling it twice costs nothing.
  */
  revalidatePublicContent("places");
}

// --- The emergency details, and withdrawing consent (§322) --------------------------------------

/** Whoever may read the registrations (§289): the Organizer, the Administrator, the Superadministrator. */
function assertMayRead(actor: Pick<StaffUser, "role">): void {
  if (!canReadRegistrations(actor.role)) {
    throw new DomainError("FORBIDDEN", `role ${actor.role} may not read a registration's emergency details`);
  }
}

/**
 * The phone, the emergency contact and the health note of one registration, for the people they
 * are for (§322).
 *
 * The form collected all four "for race day" and nothing in the backoffice could show them — so
 * the club held a health note it could not read, and a telephone nobody could ring. They are
 * read here, by whoever may read the registrations (`canReadRegistrations`: the Organizer
 * organizes the race, §289), and **never at the desk**, which every staff role works and which
 * shows a name, a state and a number (`AGENTS.md` §15.11).
 *
 * Every read is audited before the values are returned — `registration.health_viewed`, the
 * reader as the actor, no value in the metadata — because this is Article 9 data and "who has
 * seen my health note" has to have an answer. A refused reader writes nothing and learns nothing,
 * not even whether the registration exists.
 */
export async function readEmergencyDetails<T extends Record<string, unknown>>(
  db: Database<T>,
  actor: Pick<StaffUser, "id" | "role">,
  registrationId: string,
  now: Date,
): Promise<EmergencyDetails> {
  assertMayRead(actor);
  const current = await findRegistrationById(db, registrationId);
  if (!current) throw new DomainError("NOT_FOUND", "no such registration");

  await recordAuditEvent(db, {
    actorStaffUserId: actor.id,
    participantId: current.participantId,
    action: "registration.health_viewed",
    entityType: "registration",
    entityId: current.id,
    metadata: {},
    now,
  });
  const details = await findEmergencyDetails(db, current.id);
  if (!details) throw new DomainError("NOT_FOUND", "no such registration");
  return details;
}

/**
 * One event's emergency sheet: its rows, and whether the event asks the health note (§557) — the
 * sheet prints the health column only then, and each row's note is null for any other event.
 */
export type EmergencySheet = { asksHealthNote: boolean; rows: EmergencySheetRow[] };

/**
 * One event's emergency sheet (§322), under the same gate and with the same audit, once per
 * render — `event.emergency_sheet_viewed`, the event and the row count, never a value or a name.
 */
export async function readEmergencySheet<T extends Record<string, unknown>>(
  db: Database<T>,
  actor: Pick<StaffUser, "id" | "role">,
  eventId: string,
  now: Date,
): Promise<EmergencySheet> {
  assertMayRead(actor);
  const [event] = await db.select({ id: events.id, askHealthNote: events.askHealthNote }).from(events).where(eq(events.id, eventId)).limit(1);
  if (!event) throw new DomainError("NOT_FOUND", "no such event");

  const rows = await listEmergencySheet(db, event.id);
  await recordAuditEvent(db, {
    actorStaffUserId: actor.id,
    action: "event.emergency_sheet_viewed",
    entityType: "event",
    entityId: event.id,
    metadata: { rowCount: rows.length },
    now,
  });
  return { asksHealthNote: event.askHealthNote, rows };
}

/**
 * Withdraw a participant's optional data on their behalf (§322; `AGENTS.md` §15.11) — the staff
 * verb for the person who wrote to the club rather than pressing the button on their own link.
 *
 * Administrator and Superadministrator only, like every verb that changes a registration
 * (`canManageRegistrations`, §289): the Organizer reads the health note and cannot delete it.
 * The same write as the participant's own press (`consent-withdrawal.ts#clearOptionalData`):
 * the named groups nulled — the health note with its consent, the Strava link and the Instagram
 * username, the results consent set to false — and nothing else. No status moves, no place is
 * released, no message goes out. Audited with the actor, the field names and the reason typed;
 * never what the fields held.
 */
export async function withdrawOptionalData<T extends Record<string, unknown>>(
  db: Database<T>,
  actor: Pick<StaffUser, "id" | "role">,
  registrationId: string,
  fields: { health?: true; socials?: true; results?: true; promo?: true },
  reason: string,
  now: Date,
): Promise<{ cleared: (OptionalDataField | "promo")[] }> {
  if (!canManageRegistrations(actor.role)) {
    throw new DomainError("FORBIDDEN", `role ${actor.role} may not withdraw a participant's consent; AGENTS.md §15.11 reserves it to ADMIN`);
  }
  const named = OPTIONAL_DATA_FIELDS.filter((field) => fields[field] === true);
  if (named.length === 0 && fields.promo !== true) {
    throw new DomainError("VALIDATION_ERROR", "choose what to withdraw", ["fields"]);
  }
  /*
    One transaction for both writes, so a withdrawal of the optional data together with the
    consent to offers and benefits is whole or nothing — never the first committed and the second refused.
    The offers and benefits (§562), for the person who wrote to the club: the one write of
    `promo-consent.ts`, with its own audit row naming the Administrator and the reason. A
    withdrawal only — staff never consent for a person, and the module refuses a yes from here.
  */
  return db.transaction(async (tx) => {
    const cleared: (OptionalDataField | "promo")[] =
      named.length > 0
        ? (
            await clearOptionalData(tx, {
              registrationId,
              fields: named,
              via: "STAFF",
              actorStaffUserId: actor.id,
              reason,
              now,
            })
          ).cleared
        : [];
    if (fields.promo === true) {
      const promo = await setPromoConsent(tx, { registrationId, consent: false, via: "STAFF", actorStaffUserId: actor.id, reason, now });
      if (promo.changed) cleared.push("promo");
    }
    return { cleared };
  });
}

/**
 * Erase every registration of one event, one at a time, through the path a single erasure
 * takes (BR-REQ-037-06). Used only by `hardDeleteEvent`, which calls it inside its own
 * transaction and deletes the event row after it.
 *
 * It asserts nothing and reads no role: the caller has already decided, and its own gate is
 * heavier than this one's would be. Keeping the assertion in one place rather than two is the
 * point of the split — a second `assertAdministrator` here would read as a guard and would in
 * fact be dead code, which is worse than no guard at all.
 *
 * The order is `created_at, id`, which is the order the queue itself is in. That matters only
 * for what happens in between: cancelling a confirmed registration offers its place to whoever
 * is next on the waiting list, and that person is erased a moment later in the same
 * transaction, taking the offer and its queued email with them. The churn is invisible outside
 * the transaction, and going through it is what guarantees nothing is left holding a place.
 */
export async function eraseAllRegistrationsOfEvent<T extends Record<string, unknown>>(
  db: Database<T>,
  actor: Pick<StaffUser, "id" | "role">,
  eventId: string,
  reason: string,
  now: Date,
): Promise<number> {
  const rows = await db
    .select()
    .from(registrations)
    .where(eq(registrations.eventId, eventId))
    .orderBy(asc(registrations.createdAt), asc(registrations.id));

  let erased = 0;
  for (const row of rows) {
    // Re-read: an earlier erasure in this loop may have promoted this row off the waiting
    // list, and the status decides whether a place is released.
    const current = await findRegistrationById(db, row.id);
    if (!current) continue;
    await eraseRegistration(db, actor, current, reason, now);
    erased += 1;
  }

  // What was erased, not what was listed. The two are the same today — nothing else writes
  // inside this transaction — and the number is shown to a person, so it says the true thing
  // rather than the convenient one.
  return erased;
}
