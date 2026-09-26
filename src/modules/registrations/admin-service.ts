import { and, asc, count, eq, isNull, notInArray, or } from "drizzle-orm";
import { declarationAcceptances } from "@/db/schema/declaration-acceptances";
import { events } from "@/db/schema/events";
import { participants } from "@/db/schema/participants";
import { type Registration, registrations } from "@/db/schema/registrations";
import type { StaffUser } from "@/db/schema/staff-users";
import type { Database } from "@/db/types";
import type { Locale } from "@/i18n/routing";
import { recordAuditEvent, scrubParticipantFromAudit, scrubRegistrationFromAudit } from "@/modules/audit/repository";
import { consumeRateLimit } from "@/modules/rate-limit/service";
import { enqueueEmail } from "@/modules/notifications/outbox";
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
import { eraseConfirmationMatches } from "./domain/erase-confirmation";
import { bibNumberInUse, erasedBibNumbers, isEventSpareNumber } from "./bibs";
import { BIB_NUMBER_MAX, handsSpareAtConfirm } from "./domain/spare-bibs";
import { canResendReminder, deriveAllowedResendMessageType } from "./domain/resend";
import { canTransition, isActiveStatus, isTerminalStatus, TERMINAL_STATUSES } from "./domain/state-machine";
import { waitlistRefusalOf, walkInLeftUnconfirmedError } from "./domain/waitlist";
import { registrationNameKey } from "./domain/name-key";
import {
  findEventForAllocation,
  findRegistrationByEventAndParticipant,
  findRegistrationById,
  findRegistrationsByEventAndParticipant,
  lockEventForCapacity,
} from "./repository";
import {
  checkIn,
  confirmByStaff,
  type EventForRegistration,
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

  /**
   * BR-REQ-037-02 criterion 5: "repeated resends... a rate limit applies and the refusal is
   * recorded."
   *
   * Keyed on the registration rather than the administrator, because what is being protected is
   * one participant's inbox — two organizers both clicking resend is exactly the case to catch,
   * and it is invisible if each of them has their own allowance.
   *
   * Checked before the message type is derived so a throttled resend does nothing at all, and
   * refused with a real error rather than a generic success: this caller is an authenticated
   * Administrator looking at the screen, so there is nothing to leak and everything to gain
   * from saying what happened.
   */
  const verdict = await consumeRateLimit(db, "admin-resend", registrationId, now);
  if (!verdict.allowed) {
    await recordAuditEvent(db, {
      actorStaffUserId: actor.id,
      participantId: registration.participantId,
      action: "registration.resend_rate_limited",
      entityType: "registration",
      entityId: registrationId,
      metadata: { count: verdict.count, limit: verdict.limit },
      now,
    });

    throw new DomainError(
      "VALIDATION_ERROR",
      `this registration has had ${verdict.count} resends in the last hour; wait ${verdict.retryAfter} seconds`,
    );
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

  await db.transaction((tx) =>
    enqueueEmail(tx, {
      participantId: registration.participantId,
      registrationId: registration.id,
      messageType,
      locale: registration.locale,
      recipientEmail: participant.deliveryEmail,
      payload: {},
      idempotencyKey: `registration:${registration.id}:manual-resend:${now.toISOString()}`,
      requestedByStaffUserId: actor.id,
      isManualResend: true,
      now,
    }),
  );
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
    sex?: "FEMALE" | "MALE" | "UNSPECIFIED";
    nationality?: string;
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
   * The number handed to the walk-in with the paper (§NNN): the desk's next spare, which the form
   * suggests, or any free number the volunteer typed. Only with the fast track — a person who
   * finishes from their own email is not standing at the table holding a bib — and written only
   * if the confirmation gives them a place.
   */
  bibNumber?: number;
};

/**
 * The marker on the walk-in's refusal when the row was entered and the number handed with it was
 * given to somebody else in the moment between the desk's check and the confirmation (§NNN) —
 * two volunteers, one spare. Like `WALK_IN_LEFT_UNCONFIRMED`, something was written: the entry
 * stands unconfirmed, and the desk confirms it on paper with another spare.
 */
export const WALK_IN_BIB_TAKEN = "walkInBibTaken";

/**
 * The desk's word for a refused handed number (§NNN): `BIB_NUMBER_TAKEN` when the box itself was
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
    The number handed with the paper (§NNN), checked before anything is written: a box that is
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
  const identity = canonicalizeEmail(input.email);
  const existingParticipant = await findParticipantByCanonicalEmail(db, identity.canonicalEmail);
  if (existingParticipant) {
    const existing = await findRegistrationByEventAndParticipant(
      db,
      event.id,
      existingParticipant.id,
    );
    if (existing && isActiveStatus(existing.status)) {
      throw new DomainError(
        "VALIDATION_ERROR",
        "this address already has a registration for this event",
        ["email"],
      );
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
      // The spare went to somebody else between the check above and this lock (§NNN): the entry
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
  /** The number handed with the paper (§NNN): a desk spare, or a free number typed at the table. */
  options: { bibNumber?: number } = {},
): Promise<Registration> {
  assertDesk(actor);
  assertHandedBibNumber(options.bibNumber);
  const current = await findRegistrationById(db, registrationId);
  if (!current) throw new DomainError("NOT_FOUND", "no such registration");
  /*
    A handed number only for a walk-in (§NNN), the rule the desk's box is drawn by: a runner who
    registered online keeps the provisional number they were shown, and a printed bib is never
    swapped. Refused naming the box, before anything is written; checked again under the lock.
  */
  if (options.bibNumber !== undefined && !handsSpareAtConfirm(current)) {
    throw new DomainError("VALIDATION_ERROR", "a number is handed at the desk only to a walk-in with no printed bib", ["bibNumber"]);
  }
  const event = await eventForRegistration(db, current.eventId);

  let result: Registration;
  try {
    result = await confirmByStaff(db, event, registrationId, actor, now, { bibNumber: options.bibNumber });
  } catch (error) {
    /*
      The handed number worn by somebody else after all (§NNN): the check under the lock makes this
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
    // The number handed with the paper, when one was (§NNN): the audit says a bib left the box.
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
 * One race number by hand, or none (BR-REQ-038-01 criterion 7). The partial unique index is
 * what refuses two runners with one number; here that surfaces as a sentence.
 *
 * **A confirmed registration's number is settled** (§173; the owner: "nu ar trebui să mai pot
 * schimba numărul de concurs odată confirmat!"). §105 put a preferential number in an
 * organizer's hands, and that stays — before confirmation, which is when there is nothing
 * printed and nobody has been told. Once a registration is confirmed the runner has been
 * emailed their number, it is on a sheet, and quite possibly on a bib in an envelope; changing
 * it there produces two runners who each believe they are 214. The one exception is giving a
 * number to a confirmed registration that has none, which is filling a gap rather than moving
 * anybody.
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
  if (current.status === "CONFIRMED" && current.bibNumber !== null) {
    throw new DomainError(
      "VALIDATION_ERROR",
      "this registration is confirmed and already has a race number; it cannot be changed",
    );
  }
  /*
    A registration that is over takes no number change at all (§311; BR-REQ-060-01 — the server
    says it, not the missing field).

    Its settled number is retired, not free (§173): clearing it or replacing it would hand 27 back
    to the draw while the bib printed for it is still in the pile, and the desk verb that reaches
    here is every staff role's. The desk and the registration's page draw no number field on such
    a row, and that is the interface agreeing with this line rather than standing in for it. A
    terminal row with no number is refused too: a number given to nobody is a number retired for
    nothing.
  */
  if (isTerminalStatus(current.status)) {
    throw new DomainError(
      "VALIDATION_ERROR",
      `this registration is ${current.status.toLowerCase()}; its race number is retired and cannot be changed`,
    );
  }
  /*
    And a number that is on paper stays on it, whatever the status (§311). The one way to be
    here with a printed mark is a cancelled entry that restarted — it carries its number and its
    mark back into the queue — and moving that number would leave the printed bib pointing at
    nobody, exactly as clearing it on the cancelled row would have.
  */
  if (current.bibNumber !== null && current.bibPrintedAt !== null) {
    throw new DomainError("VALIDATION_ERROR", "this race number is already printed; it cannot be changed");
  }

  let updated: Registration;
  try {
    updated = await db.transaction(async (tx) => {
      /*
        The event row's lock first (§NNN), the one the confirmation holds when the desk hands a
        spare with the paper and the print holds when it reserves spares: two volunteers giving the
        same spare — one typing it here, one confirming with it — are then one after the other, and
        the second meets the check below rather than the unique index.
      */
      await tx.select({ id: events.id }).from(events).where(eq(events.id, current.eventId)).for("update");
      /*
        Not a number somebody else is holding provisionally (§NNN, found while adding the spares):
        the unique index covers the settled column only, so 57 typed here while another runner is
        looking at a provisional 57 went through — and failed on the index the moment that runner
        was confirmed and adopted it (§220), on the desk, in front of them.
      */
      if (bibNumber !== null && (await bibNumberInUse(tx, { eventId: current.eventId, number: bibNumber, exceptRegistrationId: registrationId }))) {
        throw new DomainError("CONFLICT", `number ${bibNumber} is already somebody's at this event`, ["bibNumber"]);
      }
      /*
        A desk spare is on paper already (§NNN): printed blank and handed out with the name written
        on. Marked printed, so the next "unprinted" sheet does not print a second one with the name,
        and a cancellation lists it among the bibs that exist (§311).
      */
      const spare = bibNumber !== null && (await isEventSpareNumber(tx, current.eventId, bibNumber));
      const [row] = await tx
        .update(registrations)
        /*
          Setting a number by hand **settles** it, so the provisional one goes with it (§230).

          §220 already says the recompaction closes around a number given by hand; it only skips
          rows that have a final number, so a row left holding both columns would keep a
          provisional number reserved to somebody who no longer needs it — a hole in the
          sequence, which is the exact failure §220 fixed in the bulk sweeps. One runner, one
          number, whichever verb produced it.
        */
        .set({ bibNumber, provisionalBibNumber: null, updatedAt: now, ...(spare ? { bibPrintedAt: now } : {}) })
        /*
          The two refusals above, again, in the write itself (§311): `current` was read before
          this transaction, so a registration cancelled or expired — or a number printed — in
          between would otherwise still have its number moved. No row back means one of them
          became true, and it is the same refusal.
        */
        .where(
          and(
            eq(registrations.id, registrationId),
            notInArray(registrations.status, [...TERMINAL_STATUSES]),
            or(isNull(registrations.bibPrintedAt), isNull(registrations.bibNumber)),
          ),
        )
        .returning();
      if (!row) {
        throw new DomainError("VALIDATION_ERROR", "this registration is over or its race number is printed; the number cannot be changed");
      }
      /*
        Nor the number of a registration that was erased here (§311). The unique index cannot
        say it — the row that wore 27 is gone — so the erasure's audit row does, read **after**
        the write, inside it: if the erased row still existed when the UPDATE ran, the index
        refused it; if it was already gone, the audit row was committed before it went, and
        this read sees it and rolls the write back.
      */
      if (bibNumber !== null && (await erasedBibNumbers(tx, current.eventId)).includes(bibNumber)) {
        throw new DomainError("CONFLICT", `number ${bibNumber} was worn by an erased registration at this event and stays retired`);
      }
      return row;
    });
  } catch (error) {
    const message = error instanceof Error ? `${error.message} ${String((error as { cause?: unknown }).cause ?? "")}` : "";
    if (/registrations_event_bib_number_unique/.test(message)) {
      throw new DomainError("CONFLICT", `number ${bibNumber} is already worn by somebody else at this event`);
    }
    throw error;
  }
  await recordAuditEvent(db, {
    actorStaffUserId: actor.id,
    participantId: current.participantId,
    action: "registration.bib_set",
    entityType: "registration",
    entityId: registrationId,
    metadata: { from: current.bibNumber, to: bibNumber },
    now,
  });
  // The runner is told (§105): a number given or changed by hand after the confirmation went
  // out would otherwise live only on the desk's screen. A cleared number is not news, and
  // neither is a number at a race that will not run (§331): it is written, and nobody is mailed.
  const event = bibNumber !== null && updated.status === "CONFIRMED" ? await findEventForAllocation(db, updated.eventId) : undefined;
  if (bibNumber !== null && updated.status === "CONFIRMED" && event?.eventStatus !== "CANCELLED") {
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
 * One event's emergency sheet (§322), under the same gate and with the same audit, once per
 * render — `event.emergency_sheet_viewed`, the event and the row count, never a value or a name.
 */
export async function readEmergencySheet<T extends Record<string, unknown>>(
  db: Database<T>,
  actor: Pick<StaffUser, "id" | "role">,
  eventId: string,
  now: Date,
): Promise<EmergencySheetRow[]> {
  assertMayRead(actor);
  const [event] = await db.select({ id: events.id }).from(events).where(eq(events.id, eventId)).limit(1);
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
  return rows;
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
  fields: { health?: true; socials?: true; results?: true },
  reason: string,
  now: Date,
): Promise<{ cleared: OptionalDataField[] }> {
  if (!canManageRegistrations(actor.role)) {
    throw new DomainError("FORBIDDEN", `role ${actor.role} may not withdraw a participant's consent; AGENTS.md §15.11 reserves it to ADMIN`);
  }
  const named = OPTIONAL_DATA_FIELDS.filter((field) => fields[field] === true);
  if (named.length === 0) {
    throw new DomainError("VALIDATION_ERROR", "choose what to withdraw", ["fields"]);
  }
  return clearOptionalData(db, {
    registrationId,
    fields: named,
    via: "STAFF",
    actorStaffUserId: actor.id,
    reason,
    now,
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
