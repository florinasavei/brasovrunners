import { and, asc, eq, isNull, sql } from "drizzle-orm";
import { auditLogs } from "@/db/schema/audit-logs";
import { eventVolunteers } from "@/db/schema/event-volunteers";
import type { Database } from "@/db/types";
import { recordAuditEvent } from "@/modules/audit/repository";
import { lockEventForCapacity } from "@/modules/registrations/repository";

/*
  The volunteers' V numbers (§NNN, amending §948; the owner, 2026-11-20: «vreau sa le dai numar de voluntar V001 V002 la toti
  voluntarii automat!»): every event numbers its volunteers 1, 2, 3, … — written «V001», «V002», «V003»
  (`domain/volunteer-number.ts`) — by itself, the moment the organizers confirm a person, in the order they confirm them.

  - **Its own series.** `event_volunteers.volunteer_number`, compared with nothing of the runners': no race number, elite line or
    desk spare is read, so the series needs no start, nothing a runner does moves it and it moves nothing of a runner's.
  - **Never reissued.** The next number is one above the highest the event ever gave — on a row in any state, a cancelled one's
    included, or written in a deleted volunteer's trail row (`volunteer.deleted`, `volunteerNumber`) — so a badge or a list
    handed out with V007 never names somebody else, as a runner's 27 is never given again (§173).
  - **Under the event row's lock**, the one serialization point of every number given at an event (`AGENTS.md` §10.6): two
    confirmations at the same instant wait in a line and draw two numbers; the table's own index refuses one number twice.

  Who is numbered without a press: the migration that added the column numbered every volunteer then confirmed, and
  `numberWaitingVolunteers` — a step of the maintenance job — numbers anybody the code still serving during that migration
  confirmed without one. Nobody presses anything.
*/

/**
 * The highest V number the event ever gave (0 for none): on any of its rows, whatever the state, and in the trail of the ones
 * deleted. Two reads; the caller holds the event row's lock when it means to draw after it.
 */
export async function highestVolunteerNumber<T extends Record<string, unknown>>(db: Database<T>, eventId: string): Promise<number> {
  const [rows] = await db
    .select({ highest: sql<number | null>`max(${eventVolunteers.volunteerNumber})` })
    .from(eventVolunteers)
    .where(eq(eventVolunteers.eventId, eventId));
  const [deleted] = await db
    .select({ highest: sql<number | null>`max((${auditLogs.metadataJson} ->> 'volunteerNumber')::integer)` })
    .from(auditLogs)
    .where(
      and(
        eq(auditLogs.action, "volunteer.deleted"),
        eq(auditLogs.entityType, "event"),
        eq(auditLogs.entityId, eventId),
        sql`${auditLogs.metadataJson} ->> 'volunteerNumber' ~ '^[0-9]{1,9}$'`,
      ),
    );
  return Math.max(Number(rows?.highest ?? 0), Number(deleted?.highest ?? 0));
}

/**
 * One volunteer's V number, for a caller inside a transaction that **holds the event row's lock** (`lockEventForCapacity`) — a
 * confirmation (`volunteers.ts#changeVolunteer`): the next number the event never gave.
 */
export async function drawVolunteerNumber<T extends Record<string, unknown>>(tx: Database<T>, eventId: string): Promise<number> {
  return (await highestVolunteerNumber(tx, eventId)) + 1;
}

/**
 * When a volunteer was first confirmed: the trail's earliest `volunteer.state_changed` row that made them CONFIRMED — the order the
 * migration numbered them in, and this sweep does. Null for a row with no such trail row (one written straight into the table).
 */
const FIRST_CONFIRMED_AT = sql<Date | null>`(
  SELECT min(${auditLogs.createdAt}) FROM ${auditLogs}
  WHERE ${auditLogs.entityType} = 'event' AND ${auditLogs.entityId} = ${eventVolunteers.eventId} AND ${auditLogs.action} = 'volunteer.state_changed'
    AND ${auditLogs.metadataJson} ->> 'volunteerId' = ${eventVolunteers.id}::text AND ${auditLogs.metadataJson} ->> 'to' = 'CONFIRMED'
)`;

/**
 * The maintenance job's step (§NNN): every confirmed volunteer who has no V number yet is given one — event by event, each in its
 * own transaction under the event row's lock, in the order they were first confirmed, then added, then by id (the migration's
 * own order), after the highest the event ever gave. Idempotent: a run that finds nobody writes nothing — one read of a small
 * table — and a person numbered meanwhile by a confirmation is not found again. Who it finds: a volunteer the code serving while
 * migration `0224` ran confirmed (it knew no such column). One audit row per event numbered — how many, the first and the last
 * number — never a person. Nobody is told: the number shows where the organizers read the person.
 */
export async function numberWaitingVolunteers<T extends Record<string, unknown>>(db: Database<T>, now: Date): Promise<{ events: number; given: number }> {
  const waiting = await db
    .selectDistinct({ eventId: eventVolunteers.eventId })
    .from(eventVolunteers)
    .where(and(eq(eventVolunteers.state, "CONFIRMED"), isNull(eventVolunteers.volunteerNumber)));
  let given = 0;
  for (const { eventId } of waiting) {
    given += await db.transaction(async (tx) => {
      const event = await lockEventForCapacity(tx, eventId);
      if (!event) return 0;
      // Read again under the lock: a confirmation that drew meanwhile has its number, and is not given a second.
      const people = await tx
        .select({ id: eventVolunteers.id })
        .from(eventVolunteers)
        .where(and(eq(eventVolunteers.eventId, eventId), eq(eventVolunteers.state, "CONFIRMED"), isNull(eventVolunteers.volunteerNumber)))
        .orderBy(sql`${FIRST_CONFIRMED_AT} ASC NULLS LAST`, asc(eventVolunteers.createdAt), asc(eventVolunteers.id));
      if (people.length === 0) return 0;
      const highest = await highestVolunteerNumber(tx, eventId);
      for (const [index, person] of people.entries()) {
        await tx.update(eventVolunteers).set({ volunteerNumber: highest + index + 1, updatedAt: now }).where(eq(eventVolunteers.id, person.id));
      }
      await recordAuditEvent(tx, {
        actorStaffUserId: null,
        action: "event.volunteer_numbers_given",
        entityType: "event",
        entityId: eventId,
        metadata: { given: people.length, from: highest + 1, to: highest + people.length },
        now,
      });
      return people.length;
    });
  }
  return { events: waiting.length, given };
}
