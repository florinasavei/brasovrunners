import { and, desc, eq, inArray } from "drizzle-orm";
import { auditLogs } from "@/db/schema/audit-logs";
import type { StaffUser } from "@/db/schema/staff-users";
import { staffUsers } from "@/db/schema/staff-users";
import type { Database } from "@/db/types";
import { canEnterResults } from "@/modules/staff-identity/domain/roles";
import { DomainError } from "@/shared/errors/domain-error";
import { isUuid } from "@/shared/ids";
import { FINISH_HISTORY_ACTIONS, FINISH_HISTORY_LIMIT, type FinishHistoryLine, finishHistory, historyBibOf } from "./domain/finish-history";
import { liveNamesByBib } from "./results";

/** A line of the history, with the name its number belongs to today (read live, never stored in the trail). */
export type FinishHistoryEntry = FinishHistoryLine & { liveName: string | null };

/**
 * «Istoricul sosirilor» for one race (§NNN): its audit rows about the results, newest first and at most `limit`, with the staff
 * member's name — a left join, as «Istoric capacitate» reads it (`registrations/capacity-history.ts`): an account removed since
 * leaves none — and, beside each number, the name it belongs to today (`liveNamesByBib`). For whoever enters results
 * (`canEnterResults`, FORBIDDEN otherwise): the fold is «Clasament»'s. Both conditions name the indexed key
 * (`audit_logs_entity_idx`: the entity type, the id, the time), so a read touches this race's rows only; nothing is written.
 */
export async function readFinishHistory<T extends Record<string, unknown>>(
  db: Database<T>,
  actor: Pick<StaffUser, "role">,
  eventId: string,
  limit: number = FINISH_HISTORY_LIMIT,
): Promise<{ lines: FinishHistoryEntry[]; limited: boolean }> {
  if (!canEnterResults(actor.role)) throw new DomainError("FORBIDDEN", `role ${actor.role} may not read a race's finish history`);
  if (!isUuid(eventId)) throw new DomainError("NOT_FOUND", "the event is not there");
  // One row more than shown: whether older rows exist is then a fact, not a guess from a full page.
  const [rows, names] = await Promise.all([
    db
      .select({ id: auditLogs.id, action: auditLogs.action, at: auditLogs.createdAt, metadata: auditLogs.metadataJson, actorName: staffUsers.displayName })
      .from(auditLogs)
      .leftJoin(staffUsers, eq(staffUsers.id, auditLogs.actorStaffUserId))
      .where(and(eq(auditLogs.entityType, "event"), eq(auditLogs.entityId, eventId), inArray(auditLogs.action, [...FINISH_HISTORY_ACTIONS])))
      .orderBy(desc(auditLogs.createdAt), desc(auditLogs.id))
      .limit(limit + 1),
    liveNamesByBib(db, eventId),
  ]);
  const lines = finishHistory(rows.slice(0, limit).map((row) => ({ id: row.id, action: row.action, at: row.at, actorName: row.actorName ?? null, metadata: row.metadata })));
  return {
    lines: lines.map((line) => {
      const bib = historyBibOf(line.what);
      return { ...line, liveName: bib === null ? null : (names.get(bib) ?? null) };
    }),
    limited: rows.length > limit,
  };
}
