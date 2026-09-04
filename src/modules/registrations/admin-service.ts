import { eq } from "drizzle-orm";
import type { StaffUser } from "@/db/schema/staff-users";
import { participants } from "@/db/schema/participants";
import type { Database } from "@/db/types";
import { canManageStaff } from "@/modules/staff-identity/domain/roles";
import { enqueueEmail } from "@/modules/notifications/outbox";
import { DomainError } from "@/shared/errors/domain-error";
import { deriveAllowedResendMessageType } from "./domain/resend";
import { findRegistrationById } from "./repository";

/**
 * Admin resend (AGENTS.md §15.8; BR-REQ-060-01, BR-REQ-070-01). Administrator only — §10.2
 * reserves "registrations, participants, waitlist... exports" to that role alone.
 *
 * "Resend never changes state or marks declaration accepted": this function's only write is
 * one `enqueueEmail`, which is why it takes no transaction of its own — there is no state
 * change to make atomic with anything.
 */
function assertAdministrator(actor: Pick<StaffUser, "role">): void {
  if (!canManageStaff(actor.role)) {
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
