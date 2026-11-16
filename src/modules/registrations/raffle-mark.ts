import { and, eq, ne } from "drizzle-orm";
import { events } from "@/db/schema/events";
import { registrations } from "@/db/schema/registrations";
import type { StaffUser } from "@/db/schema/staff-users";
import type { Database } from "@/db/types";
import { recordAuditEvent } from "@/modules/audit/repository";
import { canReadRegistrations } from "@/modules/staff-identity/domain/roles";
import { DomainError } from "@/shared/errors/domain-error";
import { isUuid } from "@/shared/ids";

/*
  «Participă la tombolă» on a registration (§949; the owner, 2026-11-16: «o bifă importantă, și coloană peste tot de „participă
  la tombolă" și o setare per eveniment cum ar fi „avem tombolă" dar doar în backoffice vizibil»). An event that holds a raffle
  (`events.has_raffle`, «Avem tombolă» in the editor) draws it among the numbers on «Lista pentru tombolă»
  (`modules/volunteers/raffle-list.ts`); every registration is on that list unless an organizer takes it out here.

  A mark and nothing else: it moves no state, place, number, count, kit, queue or email, and neither the allocator nor the
  capacity formula reads it (`tests/unit/registrations/raffle-never-leaves.test.ts`). It is set at any time and in any state —
  only a confirmed registration with a number is written on the list, whatever the mark says.

  Who may: whoever reads the registrations — the Organizer and the Administrators (`canReadRegistrations`), asserted here. The
  owner, the same day: «toată lumea poate participa la tombolă dar doar adminul și organizatorul pot bifa și vedea asta». It is
  the one thing the Organizer changes on a registration (§289 gave the Organizer the list to read and nothing on it to change):
  the club's own raffle is the organizers' to run, and the tick moves nothing a registration owns. Audited —
  `registration.raffle_included` / `registration.raffle_excluded`, the new value alone — and never public: the person is not
  told, and no page of the site says that a raffle is held.
*/

type Actor = Pick<StaffUser, "id" | "role">;

/** Whether the event holds a raffle («Avem tombolă»): what shows the «Tombolă» column on its lists. False for an event that is not there. */
export async function eventHoldsRaffle<T extends Record<string, unknown>>(db: Database<T>, eventId: string): Promise<boolean> {
  if (!isUuid(eventId)) return false;
  const [event] = await db.select({ on: events.hasRaffle }).from(events).where(eq(events.id, eventId)).limit(1);
  return event?.on === true;
}

/**
 * Puts a registration on the raffle's list or takes it off. One statement: the mark changes only where it says otherwise, so a
 * second press is a no-op and writes no row.
 */
export async function setRegistrationInRaffle<T extends Record<string, unknown>>(db: Database<T>, actor: Actor, registrationId: string, inRaffle: boolean, now: Date): Promise<{ changed: boolean }> {
  if (!canReadRegistrations(actor.role)) throw new DomainError("FORBIDDEN", `role ${actor.role} may not change who is in the raffle`);
  if (!isUuid(registrationId)) throw new DomainError("NOT_FOUND", "no such registration");

  return db.transaction(async (tx) => {
    const [changed] = await tx
      .update(registrations)
      .set({ inRaffle, updatedAt: now })
      .where(and(eq(registrations.id, registrationId), ne(registrations.inRaffle, inRaffle)))
      .returning({ id: registrations.id });
    if (!changed) {
      const [exists] = await tx.select({ id: registrations.id }).from(registrations).where(eq(registrations.id, registrationId)).limit(1);
      if (!exists) throw new DomainError("NOT_FOUND", "no such registration");
      return { changed: false };
    }
    await recordAuditEvent(tx, {
      actorStaffUserId: actor.id,
      action: inRaffle ? "registration.raffle_included" : "registration.raffle_excluded",
      entityType: "registration",
      entityId: changed.id,
      metadata: { inRaffle },
      now,
    });
    return { changed: true };
  });
}
