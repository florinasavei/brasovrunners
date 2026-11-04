import { and, desc, eq, inArray } from "drizzle-orm";
import { auditLogs } from "@/db/schema/audit-logs";
import { registrations } from "@/db/schema/registrations";
import { staffUsers } from "@/db/schema/staff-users";
import type { Database } from "@/db/types";
import {
  CAPACITY_HISTORY_ACTIONS,
  CAPACITY_HISTORY_LIMIT,
  type CapacityAuditRow,
  type CapacityHistory,
  capacityHistory,
  registrationIdOf,
} from "./domain/capacity-history";

/**
 * «Istoric capacitate» for one event (§NNN): its audit rows about the places, newest first and at most
 * `CAPACITY_HISTORY_LIMIT`, with the staff member's name (a left join: the job has none, and an account removed since
 * leaves none) — the same shape as `notifications/participant-messages.ts#listParticipantMessages` — and one more query
 * for which of the registrations they name still exist. `domain/capacity-history.ts` orders them, reads their metadata
 * and finds the gaps against `current`, the capacity of now.
 *
 * The rows are chosen by their plain action strings: `audit_logs.action` is `text`, so a row this screen knows is read
 * whichever release wrote it, and an action no release wrote yet simply matches nothing. Both conditions name the
 * indexed key (`audit_logs_entity_idx`: the entity type, the id and the time), so a view reads this event's rows only.
 * Read only when someone opens «Planul locurilor»; nothing is written.
 */
export async function listCapacityHistory<T extends Record<string, unknown>>(
  db: Database<T>,
  eventId: string,
  current: number | null,
  limit: number = CAPACITY_HISTORY_LIMIT,
): Promise<CapacityHistory> {
  const newestFirst = await db
    .select({ id: auditLogs.id, action: auditLogs.action, at: auditLogs.createdAt, metadata: auditLogs.metadataJson, actorName: staffUsers.displayName })
    .from(auditLogs)
    .leftJoin(staffUsers, eq(staffUsers.id, auditLogs.actorStaffUserId))
    .where(and(eq(auditLogs.entityType, "event"), eq(auditLogs.entityId, eventId), inArray(auditLogs.action, [...CAPACITY_HISTORY_ACTIONS])))
    .orderBy(desc(auditLogs.createdAt), desc(auditLogs.id))
    .limit(limit);
  const rows: CapacityAuditRow[] = newestFirst.map((row) => ({ id: row.id, action: row.action, at: row.at, actorName: row.actorName ?? null, metadata: row.metadata }));

  // «Vezi înscrierea» or «înscriere ștearsă»: one read for every registration the rows name.
  const named = [...new Set(rows.flatMap((row) => registrationIdOf(row.metadata) ?? []))];
  const existing =
    named.length === 0
      ? []
      : await db.select({ id: registrations.id }).from(registrations).where(inArray(registrations.id, named));

  return capacityHistory(rows, { current, existingRegistrations: new Set(existing.map((row) => row.id)), limited: rows.length === limit });
}
