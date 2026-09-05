import { eq } from "drizzle-orm";
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
import { canManageRegistrations } from "@/modules/staff-identity/domain/roles";
import { DomainError } from "@/shared/errors/domain-error";
import { deriveAllowedResendMessageType } from "./domain/resend";
import { canTransition, isActiveStatus } from "./domain/state-machine";
import {
  findEventForAllocation,
  findRegistrationByEventAndParticipant,
  findRegistrationById,
} from "./repository";
import { type EventForRegistration, submitRegistration, unregister } from "./service";

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

export async function resendRegistrationMessage<T extends Record<string, unknown>>(
  db: Database<T>,
  actor: Pick<StaffUser, "id" | "role">,
  registrationId: string,
  now: Date,
): Promise<void> {
  assertAdministrator(actor);

  const registration = await findRegistrationById(db, registrationId);
  if (!registration) throw new DomainError("NOT_FOUND", "no such registration");

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

  const messageType = deriveAllowedResendMessageType(registration.status);
  if (!messageType) {
    throw new DomainError(
      "VALIDATION_ERROR",
      `nothing to resend for a registration in status ${registration.status}`,
    );
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
    capacity: event.capacity,
    raceId: event.raceId,
    publishedAt: event.publishedAt,
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
};

/**
 * Enter a registration for somebody who asked in person, on the phone, or after a run
 * (BR-REQ-037-05).
 *
 * Identical to a public submission in every way that touches a place: the same
 * `submitRegistration`, so the same locked transaction, the same capacity formula, the same
 * position at the back of the waiting list, and the same PENDING_EMAIL_CONFIRMATION start. The
 * participant gets the ordinary verification email and finishes it themselves. Nothing here can
 * confirm anybody.
 */
export async function createRegistrationByStaff<T extends Record<string, unknown>>(
  db: Database<T>,
  actor: Pick<StaffUser, "id" | "role">,
  input: CreateRegistrationByStaffInput,
  now: Date,
): Promise<void> {
  assertAdministrator(actor);

  if (!input.relayedByParticipantRequest) {
    throw new DomainError(
      "VALIDATION_ERROR",
      "confirm that this person asked to be registered before entering it for them",
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
    { source: "STAFF", createdByStaffUserId: actor.id },
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
    metadata: { eventId: event.id, status: created?.status ?? null },
    now,
  });
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

  await recordAuditEvent(db, {
    actorStaffUserId: actor.id,
    participantId: current.participantId,
    action: "registration.cancelled_by_staff",
    entityType: "registration",
    entityId: registrationId,
    metadata: { from: current.status, reason: reason.trim().slice(0, 500) },
    now,
  });

  return cancelled;
}
