import { and, desc, eq } from "drizzle-orm";
import { type AuditLog, auditLogs } from "@/db/schema/audit-logs";
import { staffUsers } from "@/db/schema/staff-users";
import type { Database } from "@/db/types";

/**
 * Writing and reading the audit trail (AGENTS.md §12.12; BR-REQ-037-03 criterion 3).
 *
 * One writer, and it is deliberately the only one: every administrative change to a
 * registration goes through `modules/registrations/admin-service.ts`, which calls this
 * immediately after the change it describes.
 *
 * Not inside the same transaction, and that is a trade rather than an oversight. Each of those
 * changes runs through the registration allocator, which owns its own transaction around the
 * event-row lock (§10.6); reaching inside it would mean either nesting transactions or writing
 * a second path into `registrations`, and a second write path into that table is the thing the
 * whole module exists to prevent. The consequence is bounded and worth naming: a process that
 * dies in the microseconds between the two leaves a change with no audit row — never an audit
 * row for a change that did not happen.
 *
 * `AuditAction` is a closed union rather than free text so the trail can be read months later
 * by somebody who was not here: a typo'd action string is a row nothing will ever find.
 */
export type AuditAction =
  | "registration.created_by_staff"
  | "registration.name_corrected"
  | "registration.cancelled_by_staff"
  /** A refusal rather than a change — BR-REQ-037-02 criterion 5 requires it be recorded. */
  | "registration.resend_rate_limited";

export type RecordAuditInput = {
  actorStaffUserId: string | null;
  participantId?: string | null;
  action: AuditAction;
  entityType: "registration";
  entityId: string;
  /**
   * The shape of the change, never a copy of what it was about. §12.12: no email body, no raw
   * token, no declaration text, no participant export. A name before and after, a status, a
   * reason an organizer typed — those are the whole of what belongs here.
   */
  metadata?: Record<string, unknown>;
  now: Date;
};

export async function recordAuditEvent<T extends Record<string, unknown>>(
  db: Database<T>,
  input: RecordAuditInput,
): Promise<void> {
  await db.insert(auditLogs).values({
    actorStaffUserId: input.actorStaffUserId,
    participantId: input.participantId ?? null,
    action: input.action,
    entityType: input.entityType,
    entityId: input.entityId,
    metadataJson: input.metadata ?? {},
    createdAt: input.now,
  });
}

export type AuditEntry = Pick<AuditLog, "action" | "metadataJson" | "createdAt"> & {
  actorName: string | null;
};

/** Everything that happened to one entity, newest first, with the actor named where there is one. */
export async function listAuditTrail<T extends Record<string, unknown>>(
  db: Database<T>,
  entityType: "registration",
  entityId: string,
): Promise<AuditEntry[]> {
  return db
    .select({
      action: auditLogs.action,
      metadataJson: auditLogs.metadataJson,
      createdAt: auditLogs.createdAt,
      actorName: staffUsers.displayName,
    })
    .from(auditLogs)
    .leftJoin(staffUsers, eq(staffUsers.id, auditLogs.actorStaffUserId))
    .where(and(eq(auditLogs.entityType, entityType), eq(auditLogs.entityId, entityId)))
    .orderBy(desc(auditLogs.createdAt));
}
