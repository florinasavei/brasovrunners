import { and, desc, eq } from "drizzle-orm";
import { type AuditLog, auditLogs } from "@/db/schema/audit-logs";
import { staffUsers } from "@/db/schema/staff-users";
import type { Database } from "@/db/types";

/**
 * Writing and reading the audit trail (AGENTS.md §12.12; BR-REQ-037-03 criterion 3).
 *
 * One writer, and it is deliberately the only one: every administrative change to a
 * registration goes through `modules/registrations/admin-service.ts`, which calls this
 * immediately after the change it describes. The two rows that record what a participant did
 * rather than what staff did — the public-list answer changed from their own link, and the
 * form filled a second time (§312) — are written by the participant's own path, with no actor.
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
  /**
   * Bibs the club says are on paper, or no longer are (§264).
   *
   * The batch's row names the event, the scope and the count and no participant — a printing
   * record is not a record of who was printed, and the count is what answers "did somebody
   * already print these".
   */
  | "registration.bibs_printed"
  | "registration.bibs_unprinted"
  /** Confirmed at the desk: address vouched for, declaration on paper (BR-REQ-037-07). */
  | "registration.confirmed_by_staff"
  /** Given a place ahead of the queue, into a free one (BR-REQ-037-07). */
  | "registration.promoted_by_staff"
  /** The participant is here (BR-REQ-037-08); by staff, or by themselves. */
  | "registration.checked_in"
  | "registration.checkin_undone"
  /**
   * The participant's own answer to the public list, changed after registration
   * (BR-REQ-039-01; `registrations/list-consent.ts`). The one action with no staff actor: the
   * person did it themselves, from a link. Metadata is the shape — LISTED or NOT_LISTED, before
   * and after, and which door — never the name that went on or came off the list.
   */
  | "registration.list_consent_changed"
  /**
   * The public form filled again, with the same address, for a registration that is still
   * active (§312). Written by `submitRegistration` itself, inside the transaction that queues
   * the re-send, with no staff actor: nobody at the club did anything, the person did. It is
   * here so the club can answer "she says she registered twice" from the screen — the
   * participant is told in the re-sent message (§235), and the public screen stays generic for
   * everybody (§19.4). Metadata is the state it found and the message type re-sent, or null;
   * never the address or the name that was typed.
   */
  | "registration.resubmitted"
  /** The outbox drained by hand from the backoffice, within the day's allowance (`DECISIONS.md` §80). */
  | "outbox.sent_by_staff"
  /** The thank-you sent once per event to everyone checked in — the event and the count, never who (§82). */
  | "event.thanks_sent"
  /**
   * The event cancelled in the editor (§NNN): the reason the organizer typed, whether the
   * participants were told and how many were — never who they are. One row per date the save
   * cancelled, a date of the series that had already begun included: that one is marked
   * `alreadyStarted` and told nobody.
   */
  | "event.cancelled"
  /** "Detalii actualizate" queued (§NNN): which facts changed, the organizer's note and the count. */
  | "event.update_notice_sent"
  /**
   * An event erased outright, with everyone registered for it (BR-REQ-037-06). Like
   * `registration.deleted_by_staff` it outlives what it describes, and like it, it names the
   * thing and never the people: the event's title and date, how many registrations went with
   * it, and the reason the Administrator typed. One of these, plus one
   * `registration.deleted_by_staff` per registration, is the whole record that the event and
   * its queue ever existed.
   */
  | "event.hard_deleted"
  /** The Mailgun plan the club says it is on, from and to, with the note (§100). */
  | "email_plan.changed"
  /** The Neon plan the club says it is on — Free or Launch — from and to, with the note (§280's follow-up). */
  | "neon_plan.changed"
  | "delivery_timing.changed"
  | "contact_recipients.changed"
  /** The anti-bot challenge switched on or off from the backoffice (§254). */
  | "bot_check.changed"
  /** A message's own words, rewritten by the club (§247). */
  | "email_copy.changed"
  /** Who at the club receives the declaration copies and the confirmation notices (§244, §245). */
  | "club_notices.changed"
  /**
   * An approved legal version taken out of circulation (`DECISIONS.md` §46, §53).
   *
   * The second action whose row outlives what it describes, in the sense that matters: the
   * `legal_documents` row stays, but nothing in the application will offer, render or resolve
   * it again, so this is the only place that still says the club once published those words,
   * under that number, and who decided it should stop. The metadata carries the key, the
   * version, its effective date and the content hashes — never the text itself (§12.12).
   */
  | "legal_document.withdrawn"
  /**
   * An approved legal version deleted outright (`DECISIONS.md` §151).
   *
   * The strongest case of a row that outlives what it describes: the `legal_documents` row, its
   * text and both translations are gone, so this entry is the *only* record that the club ever
   * published those words under that number — the key, the version, the date it took effect,
   * who approved it, the SHA-256 of each language's text and the reason typed by the person who
   * removed it. Never the text itself (§12.12): the hash is what makes the row checkable
   * against a copy rather than a copy in its own right.
   *
   * The number is retired in the same transaction, so nothing will ever be issued this
   * version's number again; `versionNumberRetired` says so on the row rather than leaving it to
   * be inferred from another table.
   */
  | "legal_document.deleted";

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

export type AuditEntry = Pick<AuditLog, "action" | "metadataJson" | "createdAt" | "actorStaffUserId"> & {
  /**
   * Null in two cases the timeline must tell apart: the staff account was removed
   * (`actorStaffUserId` set, no row to join), or there never was one — the participant acted
   * from their own link (`actorStaffUserId` null).
   */
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
      actorStaffUserId: auditLogs.actorStaffUserId,
      actorName: staffUsers.displayName,
    })
    .from(auditLogs)
    .leftJoin(staffUsers, eq(staffUsers.id, auditLogs.actorStaffUserId))
    .where(and(eq(auditLogs.entityType, entityType), eq(auditLogs.entityId, entityId)))
    .orderBy(desc(auditLogs.createdAt));
}
