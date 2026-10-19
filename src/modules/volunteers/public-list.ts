import { and, asc, count, eq, gt, sql } from "drizzle-orm";
import { eventVolunteerRoles, eventVolunteers } from "@/db/schema/event-volunteers";
import { events } from "@/db/schema/events";
import type { StaffUser } from "@/db/schema/staff-users";
import type { Database } from "@/db/types";
import { recordAuditEvent } from "@/modules/audit/repository";
import { revalidatePublicContent } from "@/modules/public-cache/cache";
import { canManageVolunteers } from "@/modules/staff-identity/domain/roles";
import { DomainError } from "@/shared/errors/domain-error";
import { isUuid } from "@/shared/ids";
import { type PublicVolunteersList, type VolunteerListRow, volunteersListView } from "./domain/public-list";

/**
 * The volunteers' public list (§NNN, amending §754 and §143/§396; the owner, 2026-10-19: «private vs public lists of volunteers») — the
 * reads and the one switch behind it. The rule itself is pure and lives in `domain/public-list.ts`; this file only selects the rows it
 * judges, and **selects nothing a public page could leak**: the name, the state, the tick, the notice version of the tick, the age and the guardian's name
 * (only to keep a minor off the page — they never leave `volunteersListView`), and the name of the role given — never an address, a telephone number, a city, a
 * date of birth, a message, a note, the roles ticked.
 */

/**
 * What the event page's card «Voluntarii» reads: whether the event still takes volunteers (the master switch, `events.accepts_volunteers`)
 * and the people the rule lets through (`volunteersListView`). Rows in the order of the sign-ups, oldest first, so a list does not reshuffle
 * when somebody joins. Names, never addresses — the select below is the whole disclosure. Filed under "places" and "events" by the public
 * cache, so every write to the people expires it.
 */
export async function readPublicVolunteersList<T extends Record<string, unknown>>(
  db: Database<T>,
  eventId: string,
  options: { firstListNoticeVersion: number | null },
): Promise<{ acceptsVolunteers: boolean; list: PublicVolunteersList }> {
  const [event] = await db.select({ accepts: events.acceptsVolunteers }).from(events).where(eq(events.id, eventId)).limit(1);
  const empty: PublicVolunteersList = { count: 0, named: [], others: 0 };
  if (!event?.accepts) return { acceptsVolunteers: false, list: empty };
  const rows = await db
    .select({
      state: eventVolunteers.state,
      name: eventVolunteers.name,
      listOptIn: eventVolunteers.listOptIn,
      listNoticeVersion: eventVolunteers.listOptInNoticeVersion,
      // Read only to keep a minor off the page (`publicVolunteerName`); never part of what `volunteersListView` returns.
      age: eventVolunteers.age,
      guardianName: eventVolunteers.guardianName,
      roleNameRo: eventVolunteerRoles.nameRo,
      roleNameEn: eventVolunteerRoles.nameEn,
    })
    .from(eventVolunteers)
    .leftJoin(eventVolunteerRoles, eq(eventVolunteerRoles.id, eventVolunteers.roleId))
    // Only the confirmed are ever counted or named (`volunteersListView` asks again).
    .where(and(eq(eventVolunteers.eventId, eventId), eq(eventVolunteers.state, "CONFIRMED")))
    .orderBy(asc(eventVolunteers.createdAt), asc(eventVolunteers.id));
  const view: VolunteerListRow[] = rows.map((row) => ({
    state: row.state,
    name: row.name,
    listOptIn: row.listOptIn,
    listNoticeVersion: row.listNoticeVersion,
    age: row.age,
    guardianName: row.guardianName,
    roleNameRo: row.roleNameRo,
    roleNameEn: row.roleNameEn,
  }));
  return { acceptsVolunteers: true, list: volunteersListView(view, options.firstListNoticeVersion) };
}

/**
 * How many events still ahead have their volunteers' list public and take volunteers: what `/admin/tasks`' row `volunteersListNotice` waits
 * on (it is open only while there is one and the notice in force is silent).
 */
export async function countVolunteersListEvents<T extends Record<string, unknown>>(db: Database<T>, now: Date): Promise<number> {
  const [row] = await db
    .select({ n: count() })
    .from(events)
    .where(
      and(
        eq(events.volunteersListPublic, true),
        eq(events.acceptsVolunteers, true),
        eq(events.eventStatus, "SCHEDULED"),
        eq(events.editorialStatus, "PUBLISHED"),
        eq(events.membersOnly, false),
        gt(sql`coalesce(${events.endsAt}, ${events.startsAt})`, now),
      ),
    );
  return row?.n ?? 0;
}

type Actor = Pick<StaffUser, "id" | "role">;

/**
 * «Lista voluntarilor e publică pe pagina evenimentului» on or off (§NNN): the event's own tick, saved by the «Voluntari» card's own form
 * like «Arată public câți voluntari mai sunt necesari» — never by the editor's save. Off by default. Ticking it shows nothing by itself:
 * the page names only the confirmed volunteers who ticked, under a notice that describes the list (`volunteersListState`,
 * `publicVolunteerName`). Unticking takes every name off the page at the next read; nothing is deleted. The public cache is told once the
 * write has committed.
 */
export async function setVolunteersListPublic<T extends Record<string, unknown>>(
  db: Database<T>,
  actor: Actor,
  request: { eventId: string; on: boolean },
  now: Date,
): Promise<{ changed: boolean }> {
  if (!canManageVolunteers(actor.role)) {
    throw new DomainError("FORBIDDEN", `role ${actor.role} may not read or change an event's volunteers`);
  }
  if (!isUuid(request.eventId)) throw new DomainError("NOT_FOUND", "the event is not there");
  const result = await db.transaction(async (tx) => {
    const [event] = await tx.select({ on: events.volunteersListPublic }).from(events).where(eq(events.id, request.eventId)).for("no key update").limit(1);
    if (!event) throw new DomainError("NOT_FOUND", "the event is not there");
    if (event.on === request.on) return { changed: false };
    // Not `events.version`, like the ticks beside it: it is no edit of the page's text and must not make an open editor's save stale.
    await tx.update(events).set({ volunteersListPublic: request.on }).where(eq(events.id, request.eventId));
    await recordAuditEvent(tx, {
      actorStaffUserId: actor.id,
      action: "event.volunteers_list_switched",
      entityType: "event",
      entityId: request.eventId,
      metadata: { on: request.on },
      now,
    });
    return { changed: true };
  });
  if (result.changed) revalidatePublicContent("events", "places");
  return result;
}
