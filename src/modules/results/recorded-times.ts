import { and, asc, eq, inArray, or, sql } from "drizzle-orm";
import { auditLogs } from "@/db/schema/audit-logs";
import { type StaffUser, staffUsers } from "@/db/schema/staff-users";
import type { Database } from "@/db/types";
import { canEnterResults } from "@/modules/staff-identity/domain/roles";
import { DomainError } from "@/shared/errors/domain-error";
import { isUuid } from "@/shared/ids";
import { RECORDED_TIME_ACTIONS, type RecordedTime, type RecordedTimeRow, recordedFinishTimes } from "./domain/recorded-times";

/**
 * The race's trail as «Timpi la sosire» reads it (§NNN): its presses at the line — the rows marked `finishLine` — and its resets,
 * oldest first, each with the staff member's display name (a left join, as «Istoricul sosirilor» reads it: an account removed since
 * leaves none). **One query for the whole race**, never one per line: both conditions name the indexed key (`audit_logs_entity_idx`:
 * the entity type, the id, the time), so it touches this race's rows only; a «Clasament» save's rows, which carry no `finishLine`,
 * are left in the table. Nothing is written. Read by the page with its data (`readRecordedFinishTimes`) and by «Folosește» inside
 * its transaction (`results.ts#chooseRecordedFinishTime`), so both read the same times.
 */
export async function loadRecordedTimesTrail<T extends Record<string, unknown>>(db: Database<T>, eventId: string): Promise<RecordedTimeRow[]> {
  const rows = await db
    .select({ id: auditLogs.id, action: auditLogs.action, at: auditLogs.createdAt, metadata: auditLogs.metadataJson, actorName: staffUsers.displayName })
    .from(auditLogs)
    .leftJoin(staffUsers, eq(staffUsers.id, auditLogs.actorStaffUserId))
    .where(
      and(
        eq(auditLogs.entityType, "event"),
        eq(auditLogs.entityId, eventId),
        inArray(auditLogs.action, [...RECORDED_TIME_ACTIONS]),
        or(eq(auditLogs.action, "event.results_reset"), sql`${auditLogs.metadataJson} ->> 'finishLine' = 'true'`),
      ),
    )
    .orderBy(asc(auditLogs.createdAt), asc(auditLogs.id));
  return rows.map((row) => ({ id: row.id, action: row.action, at: row.at, actorName: row.actorName ?? null, metadata: row.metadata }));
}

/**
 * «Clasament»'s «Timpi la sosire» (§NNN): every number's times recorded at «Cronometrare» since the last reset
 * (`domain/recorded-times.ts#recordedFinishTimes`), for whoever enters results (`canEnterResults`, FORBIDDEN otherwise) — the
 * page draws them under each line's «Timp» when there is a choice. An id that is no event reads nothing.
 */
export async function readRecordedFinishTimes<T extends Record<string, unknown>>(db: Database<T>, actor: Pick<StaffUser, "role">, eventId: string): Promise<Map<number, RecordedTime[]>> {
  if (!canEnterResults(actor.role)) throw new DomainError("FORBIDDEN", `role ${actor.role} may not read a race's recorded times`);
  if (!isUuid(eventId)) throw new DomainError("NOT_FOUND", "the event is not there");
  return recordedFinishTimes(await loadRecordedTimesTrail(db, eventId));
}
