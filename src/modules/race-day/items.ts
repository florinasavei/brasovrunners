import { and, asc, eq, sql } from "drizzle-orm";
import { events } from "@/db/schema/events";
import { eventRaceDayItems } from "@/db/schema/race-day-items";
import { staffUsers } from "@/db/schema/staff-users";
import type { StaffUser } from "@/db/schema/staff-users";
import type { Database } from "@/db/types";
import { type AuditAction, recordAuditEvent } from "@/modules/audit/repository";
import { canManageVolunteers, canWorkTheDesk, type StaffSubject } from "@/modules/staff-identity/domain/roles";
import { DomainError } from "@/shared/errors/domain-error";
import { isUuid } from "@/shared/ids";

/*
  «Lucruri de adus» (§NNN; the owner, 2026-11-18, three days before the race: «un alt tab pentru ziua cursei unde sa bifam
  "lucruri de adus" un fel de inventar, unde sa punem: prelungitoare, markere, etc»): one event's checklist of the things the
  organizers bring to the race, on its own tab of «Ziua cursei» (`/admin/checkin/lucruri`).

  **Two gates, asserted here and again at each action's door (BR-REQ-060-01).** Reading the list and ticking a thing as
  brought is the desk's own gate (`canWorkTheDesk`: every staff role that works the desk — the volunteer with the box of
  numbers is the one who sees the extension cords are in the van). Writing the list — adding, changing the words, deleting —
  is the Organizer's and the Administrators' (`canManageVolunteers`: whoever runs the race's people and its plan; the Tehnic
  role, the Redactor and the desk Volunteer read and tick only).

  **A tick posts the state it wants, never a toggle**: a double press saves the same, and the second writes nothing. Ticked,
  the row says who and when; unticked, both are cleared.

  At most `RACE_DAY_ITEMS_MAX` things an event. One audit row a change, the item's id alone. Nothing public reads these rows,
  and nothing copies them: no series edit, repeat, duplicate or event file carries a list — it belongs to one date, and goes
  with it (`ON DELETE CASCADE`).
*/

type Actor = Pick<StaffUser, "id" | "role">;

/** More things than this on one event's list is a list nobody ticks on a race morning; the 201st is refused. */
export const RACE_DAY_ITEMS_MAX = 200;
/** A thing's name, at most this long («Prelungitoare»); checked at the database too. */
export const RACE_DAY_ITEM_LABEL_MAX = 120;
/** Its note («3 bucăți», «le aduce Ana»), at most this long. */
export const RACE_DAY_ITEM_NOTE_MAX = 200;

/** Who reads the list and ticks it: whoever works the desk. */
export const mayReadRaceDayItems = (subject: StaffSubject): boolean => canWorkTheDesk(subject);
/** Who adds, changes and deletes its things: the Organizer and the Administrators (`canManageVolunteers`). */
export const mayWriteRaceDayItems = (subject: StaffSubject): boolean => canWorkTheDesk(subject) && canManageVolunteers(subject);

/** One thing as the page draws it. */
export type RaceDayItem = {
  id: string;
  label: string;
  note: string | null;
  brought: boolean;
  broughtAt: Date | null;
  /** The display name of whoever ticked it; null when nobody did, or their account is gone. */
  broughtByName: string | null;
  position: number;
};

/** The list of one event, in its order, for whoever works the desk. */
export async function listRaceDayItems<T extends Record<string, unknown>>(db: Database<T>, actor: Actor, eventId: string): Promise<RaceDayItem[]> {
  if (!mayReadRaceDayItems(actor.role)) throw new DomainError("FORBIDDEN", `role ${actor.role} does not work the desk`);
  if (!isUuid(eventId)) return [];
  const rows = await db
    .select({ row: eventRaceDayItems, broughtByName: staffUsers.displayName })
    .from(eventRaceDayItems)
    .leftJoin(staffUsers, eq(staffUsers.id, eventRaceDayItems.broughtByStaffUserId))
    .where(eq(eventRaceDayItems.eventId, eventId))
    .orderBy(asc(eventRaceDayItems.position), asc(eventRaceDayItems.createdAt), asc(eventRaceDayItems.id));
  return rows.map(({ row, broughtByName }) => ({
    id: row.id,
    label: row.label,
    note: row.note,
    brought: row.brought,
    broughtAt: row.broughtAt,
    broughtByName: row.brought ? broughtByName : null,
    position: row.position,
  }));
}

export type RaceDayItemRequest =
  | { kind: "add"; eventId: string; label: string; note: string }
  | { kind: "edit"; eventId: string; id: string; label: string; note: string }
  | { kind: "remove"; eventId: string; id: string }
  | { kind: "setBrought"; eventId: string; id: string; brought: boolean };

export type RaceDayItemResult = { changed: boolean; item: { id: string; label: string } };

/** The words as typed, trimmed and held to their bounds — the refusal names the box. */
function wordsOf(request: { label: string; note: string }): { label: string; note: string | null } {
  const label = request.label.trim();
  const note = request.note.trim();
  if (label.length === 0 || label.length > RACE_DAY_ITEM_LABEL_MAX) {
    throw new DomainError("VALIDATION_ERROR", `a thing to bring is named in 1 to ${RACE_DAY_ITEM_LABEL_MAX} characters`, ["label"]);
  }
  if (note.length > RACE_DAY_ITEM_NOTE_MAX) {
    throw new DomainError("VALIDATION_ERROR", `a note is at most ${RACE_DAY_ITEM_NOTE_MAX} characters`, ["note"]);
  }
  return { label, note: note === "" ? null : note };
}

/**
 * One change to one event's list, by one staff member. Refuses a role that may not (FORBIDDEN: a tick from somebody who does
 * not work the desk, a write from anybody but the Organizer and the Administrators), words out of bounds (VALIDATION_ERROR,
 * naming the box), a 201st thing (`RACE_DAY_ITEMS_FULL`), and an event or a thing that is not there — or a thing of another
 * event (NOT_FOUND). A press that changes nothing — a tick on a ticked thing, a save of the same words — writes nothing and
 * records nothing.
 */
export async function changeRaceDayItem<T extends Record<string, unknown>>(
  db: Database<T>,
  actor: Actor,
  request: RaceDayItemRequest,
  now: Date,
): Promise<RaceDayItemResult> {
  const allowed = request.kind === "setBrought" ? mayReadRaceDayItems(actor.role) : mayWriteRaceDayItems(actor.role);
  if (!allowed) throw new DomainError("FORBIDDEN", `role ${actor.role} may not ${request.kind} a thing to bring`);
  // A forged form's malformed id is the refusal an unknown one gets, not a database error.
  if (!isUuid(request.eventId) || (request.kind !== "add" && !isUuid(request.id))) {
    throw new DomainError("NOT_FOUND", "the event or the thing to bring is not there");
  }
  const words = request.kind === "add" || request.kind === "edit" ? wordsOf(request) : null;

  return db.transaction(async (tx) => {
    // The event's row, locked: two «Adaugă» at once count and number the list one after the other.
    const [event] = await tx.select({ id: events.id }).from(events).where(eq(events.id, request.eventId)).limit(1).for("update");
    if (!event) throw new DomainError("NOT_FOUND", "the event is not there");

    const audit = (action: AuditAction, itemId: string) =>
      recordAuditEvent(tx, { actorStaffUserId: actor.id, action, entityType: "event", entityId: event.id, metadata: { itemId }, now });

    if (request.kind === "add" && words) {
      const [list] = await tx
        .select({ count: sql<number>`count(*)::int`, last: sql<number | null>`max(${eventRaceDayItems.position})` })
        .from(eventRaceDayItems)
        .where(eq(eventRaceDayItems.eventId, event.id));
      if (list.count >= RACE_DAY_ITEMS_MAX) throw new DomainError("RACE_DAY_ITEMS_FULL", `a list holds at most ${RACE_DAY_ITEMS_MAX} things`);
      const [row] = await tx
        .insert(eventRaceDayItems)
        .values({ eventId: event.id, label: words.label, note: words.note, position: (list.last ?? 0) + 1, createdAt: now })
        .returning({ id: eventRaceDayItems.id });
      await audit("event.race_day_item_added", row.id);
      return { changed: true, item: { id: row.id, label: words.label } };
    }

    const itemId = request.kind === "add" ? "" : request.id;
    const [current] = await tx
      .select()
      .from(eventRaceDayItems)
      .where(and(eq(eventRaceDayItems.id, itemId), eq(eventRaceDayItems.eventId, event.id)))
      .for("update");
    if (!current) throw new DomainError("NOT_FOUND", "the thing to bring is not there");
    const item = { id: current.id, label: current.label };

    if (request.kind === "remove") {
      await tx.delete(eventRaceDayItems).where(eq(eventRaceDayItems.id, current.id));
      await audit("event.race_day_item_removed", current.id);
      return { changed: true, item };
    }

    if (request.kind === "setBrought") {
      if (current.brought === request.brought) return { changed: false, item };
      await tx
        .update(eventRaceDayItems)
        .set(request.brought ? { brought: true, broughtAt: now, broughtByStaffUserId: actor.id } : { brought: false, broughtAt: null, broughtByStaffUserId: null })
        .where(eq(eventRaceDayItems.id, current.id));
      await audit(request.brought ? "event.race_day_item_brought" : "event.race_day_item_unbrought", current.id);
      return { changed: true, item };
    }

    if (!words) throw new DomainError("VALIDATION_ERROR", "nothing to save");
    if (current.label === words.label && current.note === words.note) return { changed: false, item };
    await tx.update(eventRaceDayItems).set({ label: words.label, note: words.note }).where(eq(eventRaceDayItems.id, current.id));
    await audit("event.race_day_item_edited", current.id);
    return { changed: true, item: { id: current.id, label: words.label } };
  });
}
