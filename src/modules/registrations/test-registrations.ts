import { and, eq, inArray, sql } from "drizzle-orm";
import { declarationAcceptances } from "@/db/schema/declaration-acceptances";
import { events } from "@/db/schema/events";
import { participants } from "@/db/schema/participants";
import { registrations } from "@/db/schema/registrations";
import type { StaffUser } from "@/db/schema/staff-users";
import type { Database } from "@/db/types";
import { canManageTestRegistrations } from "@/modules/staff-identity/domain/roles";
import { env } from "@/shared/config/env";
import { DomainError } from "@/shared/errors/domain-error";
import { findRegistrationByEventAndParticipant } from "./repository";
import { confirmEmail, type EventForRegistration, submitRegistration } from "./service";

/**
 * Filling an event's queue with synthetic registrations, so it can be watched
 * (`DECISIONS.md` §30).
 *
 * The problem this solves: a waiting list is the part of the registration lifecycle nobody sees
 * until it is too late to find a mistake in it, and exercising it by hand needs ten mailboxes
 * nobody has. The problem it must not create: a demonstration that is indistinguishable from
 * real people, or that reaches one.
 *
 * Three properties carry that, and each is tested:
 *
 *   1. **A test registration is a real registration in every way that affects the queue.**
 *      Everything below goes through `submitRegistration` and `confirmEmail` — the same
 *      allocator, the same holds, the same FIFO promotion. `kind` appears in no condition
 *      inside the allocator or the capacity formula.
 *   2. **It cannot exist in production.** Refused here, and again at the insert in
 *      `repository.ts`. Two guards, because one eventually gets refactored away.
 *   3. **The address can never receive mail.** `@test.invalid` is reserved by RFC 2606 and can
 *      never be registered or delivered to. `kind` carries the meaning; the domain is what makes
 *      a bug in email-mode selection harmless rather than an email to a stranger.
 */

/**
 * RFC 2606 §2 reserves `.invalid` precisely so that a name in it can be used where a domain is
 * needed and delivery must be impossible. The development staff switcher uses `.test` for the
 * same reason; this is the participant-side equivalent.
 */
export const TEST_PARTICIPANT_EMAIL_DOMAIN = "test.invalid";

/** Enough to fill a single-digit capacity and leave a queue behind it, and no more. */
export const MAX_TEST_REGISTRATIONS_PER_BATCH = 25;

export function areTestRegistrationsAvailable(): boolean {
  return env.APP_ENV !== "production";
}

export function assertTestRegistrationsEnabled(): void {
  if (!areTestRegistrationsAvailable()) {
    throw new DomainError(
      "FORBIDDEN",
      `test registrations are not available when APP_ENV=${env.APP_ENV}; they would occupy real places`,
    );
  }
}

function assertMayManage(actor: Pick<StaffUser, "role">): void {
  if (!canManageTestRegistrations(actor.role)) {
    throw new DomainError(
      "FORBIDDEN",
      `role ${actor.role} may not manage test registrations; AGENTS.md §10.2 reserves registrations to ADMIN`,
    );
  }
}

async function loadEvent<T extends Record<string, unknown>>(
  db: Database<T>,
  eventId: string,
): Promise<EventForRegistration> {
  const [event] = await db.select().from(events).where(eq(events.id, eventId)).limit(1);
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

/**
 * The submission timing check treats anything faster than three seconds as a bot
 * (`service.ts#looksLikeSpam`), and it is not bypassed here — the whole point is that these
 * registrations take the ordinary path. The rendered-at stamp is simply backdated past it.
 */
const RENDERED_SECONDS_AGO = 30;

export type AddTestRegistrationsInput = {
  eventId: string;
  count: number;
  locale?: "ro" | "en";
  now?: Date;
};

export type AddTestRegistrationsResult = {
  created: number;
};

/**
 * Push `count` synthetic participants through submission and email confirmation.
 *
 * Each gets its own local part, because `canonicalizeEmail` collapses dots and `+` tags for
 * Gmail and one participant registered ten times is one row, not ten (BR-REQ-032-02) — and
 * because `registrations_event_participant_unique` would refuse the second one anyway.
 *
 * Confirmation is where this stops, deliberately. The next step is signing the declaration, and
 * AGENTS.md §10.8 says staff cannot sign on a participant's behalf — a rule stated flatly, with
 * no exception for a participant who does not exist. So a test registration sits on a
 * declaration hold exactly as a real one does: occupying a place, expiring on the same deadline,
 * releasing it to the front of the queue when it lapses. That is the queue behaviour worth
 * watching anyway.
 */
export async function addTestRegistrations<T extends Record<string, unknown>>(
  db: Database<T>,
  actor: Pick<StaffUser, "id" | "role">,
  input: AddTestRegistrationsInput,
): Promise<AddTestRegistrationsResult> {
  assertTestRegistrationsEnabled();
  assertMayManage(actor);

  if (!Number.isInteger(input.count) || input.count < 1 || input.count > MAX_TEST_REGISTRATIONS_PER_BATCH) {
    throw new DomainError(
      "VALIDATION_ERROR",
      `count: between 1 and ${MAX_TEST_REGISTRATIONS_PER_BATCH}`,
    );
  }

  const now = input.now ?? new Date();
  const locale = input.locale ?? "ro";
  const event = await loadEvent(db, input.eventId);

  // A batch stamp, so two batches on the same event never collide on a local part and the rows
  // of one run are recognisable together in the backoffice list.
  const batch = now.toISOString().replace(/[^0-9]/g, "").slice(0, 14);

  let created = 0;
  for (let index = 1; index <= input.count; index += 1) {
    const email = `test-${batch}-${index}@${TEST_PARTICIPANT_EMAIL_DOMAIN}`;

    /**
     * A synthetic row carries a full set of entry details (BR-REQ-031-04).
     *
     * Not decoration. `kind` appears in no condition in the allocator or the capacity
     * formula, and the point of that rule is that a TEST registration exercises the same
     * code a real one does — including the validation. Feeding these rows through a relaxed
     * schema would mean the queue was being watched through a path no participant takes.
     */
    const firstName = "Test";
    const lastName = `Runner ${batch}-${index}`;

    await submitRegistration(
      db,
      event,
      {
        firstName,
        lastName,
        email,
        locale,
        birthDate: "1990-01-01",
        sex: "UNSPECIFIED",
        nationality: "RO",
        city: "Brașov",
        phone: "+40000000000",
        emergencyContactName: "Test Contact",
        emergencyContactPhone: "+40000000000",
        tshirtSize: "NONE",
        healthConsent: false,
        privacyAcknowledged: true,
        resultsNameConsent: false,
        // A synthetic row is never on a public start list anyway (`listPublicStartList`
        // filters `kind = REAL`), and asking it to opt out would state a preference nobody has.
        listOptOut: false,
        honeypot: "",
        renderedAt: new Date(now.getTime() - RENDERED_SECONDS_AGO * 1000).toISOString(),
      },
      now,
      "TEST",
    );

    const [participant] = await db
      .select({ id: participants.id })
      .from(participants)
      .where(eq(participants.deliveryEmail, email))
      .limit(1);
    if (!participant) continue;

    const registration = await findRegistrationByEventAndParticipant(db, event.id, participant.id);
    if (!registration) continue;

    await confirmEmail(db, event, registration.id, now);
    created += 1;
  }

  return { created };
}

export type RemoveTestRegistrationsResult = {
  registrationsRemoved: number;
  participantsRemoved: number;
};

/**
 * Delete this event's `TEST` registrations and the synthetic participants behind them, and
 * nothing else. This is what makes a demonstration repeatable.
 *
 * Order matters and is not incidental: `declaration_acceptances` references a registration with
 * no `ON DELETE` rule — deliberately, so a real acceptance can never be cascaded away — and has
 * to go first. `email_action_tokens` and `email_outbox` cascade from both parents on their own.
 *
 * A participant is removed only when they have no registration left *and* their address is in
 * the reserved domain. Both conditions, not either: a person who somehow shares an event with a
 * test row is not swept up, and a synthetic participant who has since been used on another
 * event's queue keeps their rows there.
 */
export async function removeTestRegistrations<T extends Record<string, unknown>>(
  db: Database<T>,
  actor: Pick<StaffUser, "role">,
  eventId: string,
): Promise<RemoveTestRegistrationsResult> {
  assertTestRegistrationsEnabled();
  assertMayManage(actor);

  return db.transaction(async (tx) => {
    const rows = await tx
      .select({ id: registrations.id, participantId: registrations.participantId })
      .from(registrations)
      .where(and(eq(registrations.eventId, eventId), eq(registrations.kind, "TEST")));

    if (rows.length === 0) return { registrationsRemoved: 0, participantsRemoved: 0 };

    const registrationIds = rows.map((row) => row.id);
    const participantIds = [...new Set(rows.map((row) => row.participantId))];

    await tx
      .delete(declarationAcceptances)
      .where(inArray(declarationAcceptances.registrationId, registrationIds));
    await tx.delete(registrations).where(inArray(registrations.id, registrationIds));

    const orphaned = await tx
      .select({ id: participants.id })
      .from(participants)
      .where(
        and(
          inArray(participants.id, participantIds),
          sql`${participants.deliveryEmail} LIKE ${`%@${TEST_PARTICIPANT_EMAIL_DOMAIN}`}`,
          sql`NOT EXISTS (SELECT 1 FROM ${registrations} WHERE ${registrations.participantId} = ${participants.id})`,
        ),
      );

    if (orphaned.length > 0) {
      await tx.delete(participants).where(
        inArray(
          participants.id,
          orphaned.map((row) => row.id),
        ),
      );
    }

    return { registrationsRemoved: rows.length, participantsRemoved: orphaned.length };
  });
}
