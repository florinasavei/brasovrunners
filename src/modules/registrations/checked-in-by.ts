import { sql } from "drizzle-orm";
import { auditLogs } from "@/db/schema/audit-logs";
import { registrations } from "@/db/schema/registrations";

/**
 * Who marked a runner present, as the desk and the registration's page say it beside «Prezent la HH:MM» (§NNN; the owner,
 * 2026-11-19: «vreau si tracing pentru voluntarim [voluntari] gen cine a scanat, cine a marcat prezent»): the staff account by its name, the
 * person themselves by «Am ajuns» (BR-REQ-037-08 criterion 5: `checked_in_by_staff_user_id` null), or an account deleted since.
 *
 * The column alone cannot tell the last two apart — a deleted account leaves it null (`ON DELETE SET NULL`), as the person's own
 * press does — so the registration's trail says which: a staff check-in writes its `registration.checked_in` row with the very
 * instant it sets (`admin-service.ts#checkInByStaff`), and the person's own «Am ajuns» writes none. One probe on
 * `audit_logs_entity_idx` (entity, id, `created_at`), inside the query that reads the row — never a query per row.
 */
export const CHECKED_IN_BY_SELF = sql<boolean>`(${registrations.checkedInAt} IS NOT NULL AND ${registrations.checkedInByStaffUserId} IS NULL AND NOT EXISTS (SELECT 1 FROM ${auditLogs} WHERE ${auditLogs.entityType} = 'registration' AND ${auditLogs.entityId} = ${registrations.id} AND ${auditLogs.createdAt} = ${registrations.checkedInAt} AND ${auditLogs.action} = 'registration.checked_in'))`.mapWith(Boolean);
