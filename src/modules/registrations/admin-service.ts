import { and, asc, count, eq, isNull, notInArray, or } from "drizzle-orm";
import { declarationAcceptances } from "@/db/schema/declaration-acceptances";
import { events } from "@/db/schema/events";
import { participants } from "@/db/schema/participants";
import { type Registration, registrations } from "@/db/schema/registrations";
import type { StaffUser } from "@/db/schema/staff-users";
import type { Database } from "@/db/types";
import type { Locale } from "@/i18n/routing";
import { recordAuditEvent } from "@/modules/audit/repository";
import { consumeRateLimit } from "@/modules/rate-limit/service";
import { enqueueEmail } from "@/modules/notifications/outbox";
import { canonicalizeEmail } from "@/modules/participants/domain/canonical-email";
import { findParticipantByCanonicalEmail } from "@/modules/participants/repository";
import { canManageRegistrations, canWorkTheDesk } from "@/modules/staff-identity/domain/roles";
import { DomainError, isDomainError } from "@/shared/errors/domain-error";
import { eraseConfirmationMatches } from "./domain/erase-confirmation";
import { erasedBibNumbers } from "./bibs";
import { canResendReminder, deriveAllowedResendMessageType } from "./domain/resend";
import { canTransition, isActiveStatus, isTerminalStatus, TERMINAL_STATUSES } from "./domain/state-machine";
import {
  findEventForAllocation,
  findRegistrationByEventAndParticipant,
  findRegistrationById,
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
    A cancelled event's links lead nowhere (§NNN): the declaration refuses, the offer refuses,
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
};

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
        "this person already has a registration for this event",
        ["email"],
      );
    }
  }

  await submitRegistration(
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
  const created = participant
    ? await findRegistrationByEventAndParticipant(db, event.id, participant.id)
    : undefined;

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
    await confirmRegistrationByStaff(db, actor, created.id, now);
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
): Promise<Registration> {
  assertDesk(actor);
  const current = await findRegistrationById(db, registrationId);
  if (!current) throw new DomainError("NOT_FOUND", "no such registration");
  const event = await eventForRegistration(db, current.eventId);

  const result = await confirmByStaff(db, event, registrationId, actor, now);
  await recordAuditEvent(db, {
    actorStaffUserId: actor.id,
    participantId: current.participantId,
    action: "registration.confirmed_by_staff",
    entityType: "registration",
    entityId: registrationId,
    metadata: { from: current.status, to: result.status },
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
        .set({ bibNumber, provisionalBibNumber: null, updatedAt: now })
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
  // neither is a number at a race that will not run (§NNN): it is written, and nobody is mailed.
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

  const [updated] = await db
    .update(registrations)
    .set({ registeredName: trimmed, updatedAt: now })
    .where(eq(registrations.id, registrationId))
    .returning();

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
   * one: a registration whose address has never been confirmed lapses on its own after 48 hours
   * (`expireStalePendingEmailConfirmations`), and it occupies no place in the meantime, so there
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
): Promise<{ cancelled: number; failed: number; voided: number[] }> {
  assertAdministrator(actor);

  let cancelled = 0;
  let failed = 0;
  const voided: number[] = [];
  for (const registrationId of registrationIds) {
    try {
      const row = await cancelRegistrationByStaff(db, actor, registrationId, reason, now);
      cancelled += 1;
      if (row.bibNumber !== null && row.bibPrintedAt !== null) voided.push(row.bibNumber);
    } catch (error) {
      if (!isDomainError(error)) throw error;
      failed += 1;
    }
  }
  return { cancelled, failed, voided: voided.sort((a, b) => a - b) };
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
    await unregister(db, event, current.id, "ADMIN", now);
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
    participantId: current.participantId,
    action: "registration.deleted_by_staff",
    entityType: "registration",
    entityId: current.id,
    // The status it was in, and why — not who it was. The row exists to show that a deletion
    // happened and who authorised it, not to keep a copy of what was deleted.
    metadata: { from: current.status, reason: reason.trim().slice(0, 500), ...worn },
    now,
  });

  await db.transaction(async (tx) => {
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
      await tx.delete(participants).where(eq(participants.id, current.participantId));
    }
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
