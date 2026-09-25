import { and, eq, sql } from "drizzle-orm";
import { emailOutbox } from "@/db/schema/email-outbox";
import { events } from "@/db/schema/events";
import { groupRunDeclarations } from "@/db/schema/group-run-declarations";
import type { StaffUser } from "@/db/schema/staff-users";
import type { Database } from "@/db/types";
import type { Locale } from "@/i18n/routing";
import { recordAuditEvent } from "@/modules/audit/repository";
import { offeredGroupRunDeclarationKey } from "@/modules/legal-documents/domain/keys";
import { asksForIdDocument } from "@/modules/legal-documents/domain/merge-fields";
import { findCurrentApprovedDocument } from "@/modules/legal-documents/repository";
import { readClubNotices } from "@/modules/notifications/club-notices";
import { resolveDeclarationCopies } from "@/modules/notifications/domain/club-notices";
import { enqueueEmail } from "@/modules/notifications/outbox";
import { canonicalizeEmail, InvalidEmailError } from "@/modules/participants/domain/canonical-email";
import { emailBucketKey } from "@/modules/rate-limit/domain/key";
import { consumeRateLimit } from "@/modules/rate-limit/service";
import { classifySubmission } from "@/modules/registrations/service";
import { canManageRegistrations } from "@/modules/staff-identity/domain/roles";
import { env } from "@/shared/config/env";
import { DomainError } from "@/shared/errors/domain-error";
import { ERASE_REASON_MAX, ID_DOCUMENT_MAX, signingOpen, TYPED_NAME_MAX } from "./domain";
import { insertGroupRunDeclaration } from "./repository";

/**
 * Signing a group run's optional self-declaration, and erasing one (§NNN).
 *
 * **Never a registration.** A group run is turned up to (§111): signing creates no participant, no
 * registration and no place, touches no capacity and passes through no allocator. It writes one
 * `group_run_declarations` row and queues two messages through the outbox (§68): the signer's copy
 * with the PDF (`GROUP_RUN_DECLARATION_SIGNED`) and, when the club has a declarations mailbox, the
 * archive copy with the identity document masked (`GROUP_RUN_DECLARATION_ARCHIVE`, §99, §320) — in
 * the transaction that writes the row, so a rolled-back signature leaves no message and a message
 * never describes a signature that is not there.
 *
 * **The guards are the public forms'** (§97, §19.4): the honeypot and the timing check answer as a
 * signature would and write nothing (a distinct answer tells a script which check it tripped); the
 * Turnstile verdict is asked by the action; and a throttle keyed on a hash of the signer's
 * canonical address, because every post spends two messages of the club's allowance.
 *
 * **Bound to the text that was read (§57).** The page posts the version's id and hash; a different
 * version in force at the press is refused with `CONFLICT` (`DECLARATION_CHANGED`) and nothing is
 * written. A version's hash covers both languages (§46), so the signer may ask for the PDF in the
 * other language and still sign exactly the version they read.
 */

export type GroupRunSigningInput = {
  eventId: string;
  documentId: string;
  contentSha256: string;
  accepted: boolean;
  typedName: string;
  /** The kind and the series and number, composed by the action (§283); absent or empty when not typed. */
  idDocument?: string;
  email: string;
  /** The language the declaration is signed in, and the PDF and the email are written in (§97). */
  locale: Locale;
  honeypot?: string;
  renderedAt?: string;
};

export type GroupRunSigningOutcome =
  /** Signed: the row and the messages are written. */
  | { outcome: "signed"; id: string }
  /** A bot's post: answered as signed, and nothing written. */
  | { outcome: "ignored" }
  /** Too many from this address this hour. */
  | { outcome: "limited"; retryAfter: number };

/** The event facts that decide whether a signature may be taken now. */
export type SignableEvent = {
  id: string;
  type: string;
  surface: string | null;
  offersGroupRunDeclaration: boolean;
  editorialStatus: string;
  eventStatus: string;
  startsAt: Date;
};

export async function findSignableEvent<T extends Record<string, unknown>>(db: Database<T>, eventId: string): Promise<SignableEvent | undefined> {
  const [row] = await db
    .select({
      id: events.id,
      type: events.type,
      surface: events.surface,
      offersGroupRunDeclaration: events.offersGroupRunDeclaration,
      editorialStatus: events.editorialStatus,
      eventStatus: events.eventStatus,
      startsAt: events.startsAt,
    })
    .from(events)
    .where(eq(events.id, eventId))
    .limit(1);
  return row;
}

function declarationChanged(): DomainError {
  return new DomainError("CONFLICT", "DECLARATION_CHANGED: the text in force is not the one that was read");
}

export async function signGroupRunDeclaration<T extends Record<string, unknown>>(
  db: Database<T>,
  input: GroupRunSigningInput,
  now: Date,
): Promise<GroupRunSigningOutcome> {
  // The form's silence (§19.4): a trap filled with something that is not the signer's own
  // address, or a post faster than a person reads — answered as signed, nothing written.
  // A trap holding the signer's own address or name is a password manager, not a bot (§282).
  const verdict = classifySubmission({ honeypot: input.honeypot, renderedAt: input.renderedAt, email: input.email, firstName: input.typedName }, now);
  if (verdict !== "ok" && verdict !== "autofill") return { outcome: "ignored" };

  const event = await findSignableEvent(db, input.eventId);
  const key = event ? offeredGroupRunDeclarationKey(event) : null;
  if (!event || !key || !signingOpen(event, now)) throw new DomainError("NOT_FOUND", "this run offers no declaration to sign");

  // The text in force, in the language chosen for it — the same version in both (§46).
  const document = await findCurrentApprovedDocument(db, key, input.locale, now);
  if (!document) throw new DomainError("NOT_FOUND", "the club has no approved declaration of this kind");
  if (document.id !== input.documentId || document.contentSha256 !== input.contentSha256) throw declarationChanged();

  // Every box that is wrong at once, so the summary can name each (§47).
  const typedName = input.typedName.trim();
  const idDocument = (input.idDocument ?? "").trim();
  const needsDocument = asksForIdDocument(document.body);
  let canonicalEmail: string | null = null;
  try {
    canonicalEmail = canonicalizeEmail(input.email).canonicalEmail;
  } catch (error) {
    if (!(error instanceof InvalidEmailError)) throw error;
  }
  const invalid = [
    ...(needsDocument && (idDocument === "" || idDocument.length > ID_DOCUMENT_MAX) ? ["idDocument"] : []),
    ...(typedName === "" || typedName.length > TYPED_NAME_MAX ? ["typedName"] : []),
    ...(canonicalEmail === null ? ["email"] : []),
    ...(input.accepted ? [] : ["accepted"]),
  ];
  if (invalid.length > 0) throw new DomainError("VALIDATION_ERROR", `${invalid.join(", ")}: the declaration is incomplete`, invalid);

  // Per address, hashed (§322): the bucket needs equality and nothing else.
  const throttle = await consumeRateLimit(db, "group-run-declaration", emailBucketKey("group-run-declaration", canonicalEmail as string), now);
  if (!throttle.allowed) return { outcome: "limited", retryAfter: throttle.retryAfter };

  const id = await db.transaction(async (tx) => {
    const row = await insertGroupRunDeclaration(tx as unknown as Database<T>, {
      eventId: event.id,
      legalDocumentId: document.id,
      declarationVersion: document.version,
      contentSha256: document.contentSha256,
      locale: input.locale,
      typedName,
      idDocument: needsDocument ? idDocument : null,
      email: input.email.trim(),
      acceptedAt: now,
      createdAt: now,
    });
    // The signer's copy, with the PDF: no participant, no registration, no token (§NNN).
    await enqueueEmail(tx, {
      participantId: null,
      registrationId: null,
      messageType: "GROUP_RUN_DECLARATION_SIGNED",
      locale: input.locale,
      recipientEmail: row.email,
      payload: { groupRunDeclarationId: row.id },
      idempotencyKey: `group-run-declaration:${row.id}:signed`,
      now,
    });
    // The club's archive copy (§99), to the mailbox the club named, with its copies (§244).
    const copies = resolveDeclarationCopies(await readClubNotices(tx), env.DECLARATIONS_ARCHIVE_TO);
    if (copies.to) {
      await enqueueEmail(tx, {
        participantId: null,
        registrationId: null,
        messageType: "GROUP_RUN_DECLARATION_ARCHIVE",
        // The club reads Romanian; the message is bilingual regardless (§96).
        locale: "ro",
        recipientEmail: copies.to,
        payload: { groupRunDeclarationId: row.id, cc: [...copies.cc], bcc: [...copies.bcc] },
        idempotencyKey: `group-run-declaration:${row.id}:archive`,
        now,
      });
    }
    return row.id;
  });
  return { outcome: "signed", id };
}

/**
 * An Administrator erases one group-run declaration (§NNN, the shape of §67 and §88).
 *
 * The audit row first, in the same transaction: who acted, why, and the event — never who had
 * signed (`AGENTS.md` §12.12). Then the messages about it that still hold the signer's address, and
 * the row. A role below Administrator is refused here, whatever the screen drew (BR-REQ-060-01).
 */
export async function eraseGroupRunDeclaration<T extends Record<string, unknown>>(
  db: Database<T>,
  actor: Pick<StaffUser, "id" | "role">,
  input: { id: string; reason: string },
  now: Date,
): Promise<{ eventId: string }> {
  if (!canManageRegistrations(actor.role)) throw new DomainError("FORBIDDEN", "erasing a declaration is an Administrator's");
  const reason = input.reason.trim();
  if (reason === "" || reason.length > ERASE_REASON_MAX) throw new DomainError("VALIDATION_ERROR", "reason: say why", ["reason"]);

  return db.transaction(async (tx) => {
    const [row] = await tx
      .select({ id: groupRunDeclarations.id, eventId: groupRunDeclarations.eventId, version: groupRunDeclarations.declarationVersion })
      .from(groupRunDeclarations)
      .where(eq(groupRunDeclarations.id, input.id))
      .limit(1);
    if (!row) throw new DomainError("NOT_FOUND", "no such declaration");
    await recordAuditEvent(tx, {
      actorStaffUserId: actor.id,
      action: "event.group_run_declaration_erased",
      entityType: "event",
      entityId: row.eventId,
      metadata: { reason, declarationVersion: row.version },
      now,
    });
    // The signer's and the club's messages carry the address and name the row: they go with it.
    await tx.delete(emailOutbox).where(sql`${emailOutbox.payloadJson}->>'groupRunDeclarationId' = ${row.id}`);
    await tx.delete(groupRunDeclarations).where(and(eq(groupRunDeclarations.id, row.id), eq(groupRunDeclarations.eventId, row.eventId)));
    return { eventId: row.eventId };
  });
}
