import { and, eq } from "drizzle-orm";
import { declarationAcceptances } from "@/db/schema/declaration-acceptances";
import type { StaffUser } from "@/db/schema/staff-users";
import type { Database } from "@/db/types";
import { recordAuditEvent } from "@/modules/audit/repository";
import { canManageRegistrations } from "@/modules/staff-identity/domain/roles";
import { DomainError } from "@/shared/errors/domain-error";
import { isUuid } from "@/shared/ids";

/**
 * «Păstrează: reclamație / litigiu în curs» (§NNN, amending §85 and §95): an Administrator's hold on a
 * signed declaration, which the retention sweep skips — the declaration and the registration it
 * belongs to — and no erase takes, until the hold is cleared.
 *
 * The second review of 2026-09-29 rewrote the retention sentence of the declarations and of the
 * privacy notice: «Dacă există o reclamație, un litigiu sau o procedură în curs, documentul poate fi
 * păstrat până la soluționarea definitivă a acesteia.» A sentence the code does not keep is a promise
 * nobody can check, so this is it: a boolean, a reason, when and who, on the acceptance row itself.
 *
 * The Administrator's alone (`canManageRegistrations`, §289, §542): the Organizer reads the
 * registrations and changes nothing on them. Asserted here, whatever the screen drew (BR-REQ-060-01).
 * Each set and each clear writes an audit row — who (the actor), why (the typed reason) and which row
 * (the acceptance id) — on the registration's own trail, never the person's name (AGENTS.md §12.12):
 * an erase later scrubs that trail as it scrubs every row about the registration (§324).
 */

/** How long a typed reason may be: the erase's own limit (§67). */
export const HOLD_REASON_MAX = 500;

/** The typed reason, trimmed, or the refusal naming the box. Shared by both kinds of declaration. */
export function holdReason(typed: string): string {
  const reason = typed.trim();
  if (reason === "" || reason.length > HOLD_REASON_MAX) throw new DomainError("VALIDATION_ERROR", "reason: say why", ["reason"]);
  return reason;
}

/**
 * The refusal an erase meets while a hold is set (§NNN): the Administrator clears it first. Its own
 * code, `DECLARATION_HELD`, so the list's erase, an event's erase, an event's delete and every other
 * form reading `Admin.errors` say the declaration is kept — never the generic CONFLICT sentence.
 */
export function heldRefusal(): DomainError {
  return new DomainError("DECLARATION_HELD", "HELD:the declaration is kept for a complaint or a dispute; clear the hold first");
}

type Actor = Pick<StaffUser, "id" | "role">;

async function findAcceptance<T extends Record<string, unknown>>(db: Database<T>, registrationId: string, acceptanceId: string) {
  if (!isUuid(registrationId) || !isUuid(acceptanceId)) throw new DomainError("NOT_FOUND", "no such declaration");
  const [row] = await db
    .select({ id: declarationAcceptances.id, registrationId: declarationAcceptances.registrationId, held: declarationAcceptances.retentionHold })
    .from(declarationAcceptances)
    .where(and(eq(declarationAcceptances.id, acceptanceId), eq(declarationAcceptances.registrationId, registrationId)))
    .limit(1)
    // Locked, as the erase locks it (`refuseIfRegistrationHeld`): a hold and an erase at once are
    // one after the other — the erase refused, or the hold finding no row — never a hold's audit
    // row left beside a deleted declaration.
    .for("update");
  if (!row) throw new DomainError("NOT_FOUND", "no such declaration");
  return row;
}

/** Set the hold on one acceptance of one registration, with the reason; the audit row in the same transaction. */
export async function holdDeclarationAcceptance<T extends Record<string, unknown>>(
  db: Database<T>,
  actor: Actor,
  input: { registrationId: string; acceptanceId: string; reason: string },
  now: Date,
): Promise<void> {
  if (!canManageRegistrations(actor.role)) throw new DomainError("FORBIDDEN", "holding a declaration is an Administrator's");
  const reason = holdReason(input.reason);
  await db.transaction(async (tx) => {
    const row = await findAcceptance(tx, input.registrationId, input.acceptanceId);
    await tx
      .update(declarationAcceptances)
      .set({ retentionHold: true, retentionHoldReason: reason, retentionHoldAt: now, retentionHoldByStaffUserId: actor.id })
      .where(eq(declarationAcceptances.id, row.id));
    await recordAuditEvent(tx, {
      actorStaffUserId: actor.id,
      participantId: null,
      action: "registration.declaration_hold_set",
      entityType: "registration",
      entityId: row.registrationId,
      metadata: { declarationAcceptanceId: row.id, reason },
      now,
    });
  });
}

/** Clear the hold: the row goes back on its ordinary schedule. Why, too — the trail says who lifted it and for what. */
export async function releaseDeclarationAcceptance<T extends Record<string, unknown>>(
  db: Database<T>,
  actor: Actor,
  input: { registrationId: string; acceptanceId: string; reason: string },
  now: Date,
): Promise<void> {
  if (!canManageRegistrations(actor.role)) throw new DomainError("FORBIDDEN", "releasing a declaration is an Administrator's");
  const reason = holdReason(input.reason);
  await db.transaction(async (tx) => {
    const row = await findAcceptance(tx, input.registrationId, input.acceptanceId);
    if (!row.held) return;
    await tx
      .update(declarationAcceptances)
      .set({ retentionHold: false, retentionHoldReason: null, retentionHoldAt: null, retentionHoldByStaffUserId: null })
      .where(eq(declarationAcceptances.id, row.id));
    await recordAuditEvent(tx, {
      actorStaffUserId: actor.id,
      participantId: null,
      action: "registration.declaration_hold_cleared",
      entityType: "registration",
      entityId: row.registrationId,
      metadata: { declarationAcceptanceId: row.id, reason },
      now,
    });
  });
}

/** Whether any declaration of a registration is held (§NNN): what every erase asks before it deletes. */
export async function registrationIsHeld<T extends Record<string, unknown>>(db: Database<T>, registrationId: string): Promise<boolean> {
  const [row] = await db
    .select({ id: declarationAcceptances.id })
    .from(declarationAcceptances)
    .where(and(eq(declarationAcceptances.registrationId, registrationId), eq(declarationAcceptances.retentionHold, true)))
    .limit(1);
  return row !== undefined;
}

/**
 * The same question inside the erase's own transaction, with every acceptance of the registration
 * locked `FOR UPDATE` until it commits (§NNN): a hold set after the early check and before the delete
 * is seen here, and a hold pressed while the erase runs waits for it and then finds no row.
 */
export async function refuseIfRegistrationHeld<T extends Record<string, unknown>>(tx: Database<T>, registrationId: string): Promise<void> {
  const rows = await tx
    .select({ held: declarationAcceptances.retentionHold })
    .from(declarationAcceptances)
    .where(eq(declarationAcceptances.registrationId, registrationId))
    .for("update");
  if (rows.some((row) => row.held)) throw heldRefusal();
}
