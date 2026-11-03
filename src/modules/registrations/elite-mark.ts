import { and, eq, ne } from "drizzle-orm";
import { registrations } from "@/db/schema/registrations";
import type { StaffUser } from "@/db/schema/staff-users";
import type { Database } from "@/db/types";
import { recordAuditEvent } from "@/modules/audit/repository";
import { canManageRegistrations } from "@/modules/staff-identity/domain/roles";
import { DomainError } from "@/shared/errors/domain-error";
import { isUuid } from "@/shared/ids";

/**
 * «Marchează ca elită» / «Nu mai e elită» (§897; the owner, 2026-11-03: «ar trebui să pot marca pe cineva ca elită
 * oricând», and asked what happens to the registration, «Rămâne înscris»): a registration whose bib prints as an elite
 * bib — the name where the number goes, laid out and drawn by the elite list's own code (§895: `bib-elite.ts`,
 * `bib-geometry.ts#bibEliteLayout`, `bibs-pdf.ts`, `bib-image.tsx`), its own race number under the name only with
 * «Număr pe BIB-urile de elită» ticked and the sponsors' row only with «Banda de sponsori pe BIB-urile de elită».
 *
 * **A mark on how the bib prints, and nothing else.** No state, no place, no race number (it stays the registration's,
 * never freed or drawn again), no count, no queue and no email: this touches one boolean column and the trail, never
 * the allocator (`AGENTS.md` §10.6) nor the outbox. So it takes no event lock, and asks no date or state: the club
 * marks a runner the day it learns who the elite are, and unmarks them as freely — in any state, a cancelled row too
 * (its bib does not print; the mark waits for a restart, which keeps it, like the number).
 *
 * **Who** — the Administrator (`canManageRegistrations`), asserted here as at the action's door (BR-REQ-060-01);
 * the Organizer reads the chip and the elite card, Tehnic nothing. **The trail** — `registration.elite_marked` or
 * `registration.elite_unmarked` on the registration, its metadata the new value alone. A press that finds the mark
 * already as asked (a stale list, a colleague first) writes nothing and no row.
 */
type Actor = Pick<StaffUser, "id" | "role">;

export async function setRegistrationElite<T extends Record<string, unknown>>(
  db: Database<T>,
  actor: Actor,
  registrationId: string,
  elite: boolean,
  now: Date,
): Promise<{ changed: boolean }> {
  if (!canManageRegistrations(actor.role)) {
    throw new DomainError("FORBIDDEN", `role ${actor.role} may not mark a registration elite`);
  }
  if (!isUuid(registrationId)) throw new DomainError("NOT_FOUND", "no such registration");

  return db.transaction(async (tx) => {
    // One statement: the mark changes only where it says otherwise, so a second press is a no-op and writes no row.
    const [changed] = await tx
      .update(registrations)
      .set({ elite, updatedAt: now })
      .where(and(eq(registrations.id, registrationId), ne(registrations.elite, elite)))
      .returning({ id: registrations.id });
    if (!changed) {
      const [exists] = await tx.select({ id: registrations.id }).from(registrations).where(eq(registrations.id, registrationId)).limit(1);
      if (!exists) throw new DomainError("NOT_FOUND", "no such registration");
      return { changed: false };
    }
    await recordAuditEvent(tx, {
      actorStaffUserId: actor.id,
      action: elite ? "registration.elite_marked" : "registration.elite_unmarked",
      entityType: "registration",
      entityId: changed.id,
      metadata: { elite },
      now,
    });
    return { changed: true };
  });
}
