import { and, desc, eq } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import { auditLogs } from "@/db/schema/audit-logs";
import { staffUsers } from "@/db/schema/staff-users";
import type { Database } from "@/db/types";
import { isUuid } from "@/shared/ids";
import type { CodeScan } from "./domain/code-scans";

const scannedBy = alias(staffUsers, "code_scanned_by");

/**
 * The newest scans of one desk code (§NNN), newest first, with who: one indexed read (`audit_logs_entity_idx`, the registration),
 * one more than «Scanat înainte» names, so the visit's own scan can be left out (`domain/code-scans.ts#earlierScans`). The desk's
 * own read, beside the verb that writes the rows (`admin-service.ts#recordCodeScan`): the scanned page, which every desk role
 * opens, reads nothing of the organizers' «Jurnal» (`race-day/journal.ts`).
 */
export async function listCodeScans<T extends Record<string, unknown>>(db: Database<T>, registrationId: string, limit: number): Promise<CodeScan[]> {
  if (!isUuid(registrationId)) return [];
  return db
    .select({ id: auditLogs.id, at: auditLogs.createdAt, actorId: auditLogs.actorStaffUserId, actorName: scannedBy.displayName })
    .from(auditLogs)
    .leftJoin(scannedBy, eq(scannedBy.id, auditLogs.actorStaffUserId))
    .where(and(eq(auditLogs.entityType, "registration"), eq(auditLogs.entityId, registrationId), eq(auditLogs.action, "registration.code_scanned")))
    .orderBy(desc(auditLogs.createdAt), desc(auditLogs.id))
    .limit(limit);
}
