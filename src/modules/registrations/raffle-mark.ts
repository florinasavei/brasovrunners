import { and, eq, inArray, ne } from "drizzle-orm";
import { events } from "@/db/schema/events";
import { registrations } from "@/db/schema/registrations";
import type { StaffUser } from "@/db/schema/staff-users";
import type { Database } from "@/db/types";
import { recordAuditEvent } from "@/modules/audit/repository";
import { canSetRaffleMark, canSetRaffleMarkAtDesk } from "@/modules/staff-identity/domain/roles";
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

  Who may: whoever reads the registrations — the Organizer and the Administrators — asserted here by the tick's own predicate
  (`canSetRaffleMark`, §953: the readers' set, named for this one write so the reading predicate authorizes none). The
  owner, the same day: «toată lumea poate participa la tombolă dar doar adminul și organizatorul pot bifa și vedea asta». It is
  the one thing the Organizer changes on a registration (§289 gave the Organizer the list to read and nothing on it to change):
  the club's own raffle is the organizers' to run, and the tick moves nothing a registration owns. Audited —
  `registration.raffle_included` / `registration.raffle_excluded`, the new value alone — and never public: the person is not
  told, and no page of the site says that a raffle is held.

  The event's own switch, «Avem tombolă», is not pressed here and is not the Organizer's: it is a box of the event editor,
  whose save is the Administrator's (`canEditEventFields`, §542). The Organizer reads it and works the column it shows.

  **A second door, at the race-day desk (§1020; the owner, 2026-11-20: «ar trebui să pot să-l scot de la tombolă ca și voluntar
  dar să fie cu extra confirmare și cu logarea în aplicație cu ce voluntar a decis că X nu participă la tombolă»).** Every desk
  role takes a registration off the raffle, or puts it back, from the desk's raffle line — asked first there, naming the person
  and the number — through `setRegistrationInRaffleAtDesk` below, by a predicate of its own (`canSetRaffleMarkAtDesk`, written
  as `canWorkTheDesk`). The same mark and the same one statement, so it too moves nothing else; only on a registration the line
  is drawn for — a real one, at an event that holds a raffle — and its one audit row says the door (`door: "desk"`) beside
  the new value, so «Ziua cursei» → «Jurnal» and the registration's timeline name who decided. A registration marked «Elită»
  (§897) is a desk row like any other; the elite list's lines and the volunteers are not at the desk and keep their ticks
  where they are (`raffle-entries.ts#setEliteLineRaffleTick`, `volunteers.ts`).
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
  if (!canSetRaffleMark(actor.role)) throw new DomainError("FORBIDDEN", `role ${actor.role} may not change who is in the raffle`);
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

/** What the desk's door writes beside the new value (§1020): the door itself, which the registration's timeline reads back. */
const RAFFLE_DESK_DOOR = "desk";

/**
 * «Scoate de la tombolă» / «Pune înapoi la tombolă» at the race-day desk (§1020): the same mark through a door of its own, for
 * every desk role (`canSetRaffleMarkAtDesk`), on a registration the desk's raffle line is drawn for — a real one, at an event
 * that holds a raffle. One statement, as the organizers' tick: the mark changes only where it says otherwise, so a second press
 * — a colleague's on another phone, or the same one twice — is a no-op and writes no row; otherwise ONE audit row, the staff
 * member its actor and `door: "desk"` beside the new value. Refused, writing nothing: a role that does not work the desk
 * (FORBIDDEN), a registration that is not there (NOT_FOUND), a test registration — in no raffle, drawn no line (§30,
 * RAFFLE_NOT_ELIGIBLE) — and an event that holds no raffle, «Avem tombolă» unticked since the page was drawn (RAFFLE_NOT_HELD).
 */
export async function setRegistrationInRaffleAtDesk<T extends Record<string, unknown>>(db: Database<T>, actor: Actor, registrationId: string, inRaffle: boolean, now: Date): Promise<{ changed: boolean }> {
  if (!canSetRaffleMarkAtDesk(actor.role)) throw new DomainError("FORBIDDEN", `role ${actor.role} does not work the desk`);
  if (!isUuid(registrationId)) throw new DomainError("NOT_FOUND", "no such registration");

  return db.transaction(async (tx) => {
    const [changed] = await tx
      .update(registrations)
      .set({ inRaffle, updatedAt: now })
      .where(
        and(
          eq(registrations.id, registrationId),
          ne(registrations.inRaffle, inRaffle),
          // The line's own two conditions, in the same statement: a real registration, of an event that holds a raffle.
          eq(registrations.kind, "REAL"),
          inArray(registrations.eventId, tx.select({ id: events.id }).from(events).where(eq(events.hasRaffle, true))),
        ),
      )
      .returning({ id: registrations.id });
    if (!changed) {
      const [found] = await tx
        .select({ kind: registrations.kind, hasRaffle: events.hasRaffle })
        .from(registrations)
        .innerJoin(events, eq(events.id, registrations.eventId))
        .where(eq(registrations.id, registrationId))
        .limit(1);
      if (!found) throw new DomainError("NOT_FOUND", "no such registration");
      if (found.kind !== "REAL") throw new DomainError("RAFFLE_NOT_ELIGIBLE", "a test registration takes part in no raffle");
      if (!found.hasRaffle) throw new DomainError("RAFFLE_NOT_HELD", "the event holds no raffle");
      return { changed: false };
    }
    await recordAuditEvent(tx, {
      actorStaffUserId: actor.id,
      action: inRaffle ? "registration.raffle_included" : "registration.raffle_excluded",
      entityType: "registration",
      entityId: changed.id,
      metadata: { inRaffle, door: RAFFLE_DESK_DOOR },
      now,
    });
    return { changed: true };
  });
}
