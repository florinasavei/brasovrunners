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
  /**
   * Erasure (BR-REQ-037-06). The one action whose audit row outlives the thing it describes:
   * `entity_id` carries no foreign key, so this survives the delete and is the only remaining
   * evidence that the registration existed and who authorised its removal.
   */
  | "registration.deleted_by_staff"
  /** A refusal rather than a change — BR-REQ-037-02 criterion 5 requires it be recorded. */
  | "registration.resend_rate_limited"
  /** Race numbers given to an event's confirmed registrations, as a batch (BR-REQ-038-01). */
  | "registration.bibs_assigned"
  /** One number typed by hand, or cleared (BR-REQ-038-01 criterion 7). */
  | "registration.bib_set"
  /** Confirmed at the desk: address vouched for, declaration on paper (BR-REQ-037-07). */
  | "registration.confirmed_by_staff"
  /** Given a place ahead of the queue, into a free one (BR-REQ-037-07). */
  | "registration.promoted_by_staff"
  /** The participant is here (BR-REQ-037-08); by staff, or by themselves. */
  | "registration.checked_in"
  | "registration.checkin_undone"
  /** The outbox drained by hand from the backoffice, within the day's allowance (`DECISIONS.md` §80). */
  | "outbox.sent_by_staff"
  /** The thank-you sent once per event to everyone checked in — the event and the count, never who (§82). */
  | "event.thanks_sent"
  /** The Mailgun plan the club says it is on, from and to, with the note (§100). */
  | "email_plan.changed"
  | "contact_recipients.changed"
  /**
   * An approved legal version taken out of circulation (`DECISIONS.md` §46, §53).
   *
   * The second action whose row outlives what it describes, in the sense that matters: the
   * `legal_documents` row stays, but nothing in the application will offer, render or resolve
   * it again, so this is the only place that still says the club once published those words,
   * under that number, and who decided it should stop. The metadata carries the key, the
   * version, its effective date and the content hashes — never the text itself (§12.12).
   */
  | "legal_document.withdrawn";

export type RecordAuditInput = {
  actorStaffUserId: string | null;
  participantId?: string | null;
  action: AuditAction;
  // `event` for the one action that is about a whole event's registrations at once;
  // `email_outbox` for the one that is about the queue itself; `legal_document` for the one
  // that is about a version of the club's own text.
  entityType: "registration" | "event" | "email_outbox" | "platform_setting" | "legal_document";
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
