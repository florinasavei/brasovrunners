import { and, eq, inArray, sql } from "drizzle-orm";
import { emailOutbox } from "@/db/schema/email-outbox";
import { events } from "@/db/schema/events";
import { groupRunDeclarations } from "@/db/schema/group-run-declarations";
import type { StaffUser } from "@/db/schema/staff-users";
import type { Database } from "@/db/types";
import type { Locale } from "@/i18n/routing";
import { startHeldBack } from "@/modules/events/domain/dated";
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
import { isUuid } from "@/shared/ids";
import { birthDateRefusal, ERASE_REASON_MAX, ID_DOCUMENT_MAX, keptSignature, signerIdentity, signingOpen, TYPED_NAME_MAX } from "./domain";
import { groupRunMergeValues } from "./facts";
import { insertGroupRunDeclaration, listCoveringSignatures, listSeriesDatesOf } from "./repository";
import { factsToKeep } from "./series";

/**
 * Signing a group run's optional self-declaration, and erasing one (§393).
 *
 * Never a registration (§111): no participant, place or allocator — one row plus the signer's and
 * the archive's messages (§99, §320), queued in the row's transaction (§68).
 *
 * Guards as the public forms (§97, AGENTS.md §19.4): bot posts answer as signed and write nothing;
 * a throttle on the hashed address, since each post spends two messages.
 *
 * One row per person, series and version (§523, `keptSignature`, a unique index); an unverified
 * press never deletes. Bound to the version read (§57): another in force is `DECLARATION_CHANGED`;
 * the hash covers both languages (§46).
 */

export type GroupRunSigningInput = {
  eventId: string;
  documentId: string;
  contentSha256: string;
  accepted: boolean;
  typedName: string;
  /** The kind and the series and number, composed by the action (§283); absent or empty when not typed. */
  idDocument?: string;
  /** `YYYY-MM-DD`, checked against the minimum age and never stored (§440). */
  birthDate?: string;
  email: string;
  /** Also the PDF's and the email's language (§97). */
  locale: Locale;
  honeypot?: string;
  renderedAt?: string;
};

export type GroupRunSigningOutcome =
  /** `kept`: an existing signature's copy was resent (§523); for tests and logs, never the visitor. */
  | { outcome: "signed"; id: string; kept: boolean }
  /** A bot's post: answered as signed, and nothing written. */
  | { outcome: "ignored" }
  | { outcome: "limited"; retryAfter: number };

export type SignableEvent = {
  id: string;
  type: string;
  surface: string | null;
  offersGroupRunDeclaration: boolean;
  editorialStatus: string;
  eventStatus: string;
  startsAt: Date;
  /** Zero for none (§329, §440). */
  minAge: number;
  /** The minimum age is counted on the run's day in this zone (§321). */
  timezone: string;
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
      minAge: events.minAge,
      timezone: events.timezone,
      dateToBeAnnounced: events.dateToBeAnnounced,
      timeToBeAnnounced: events.timeToBeAnnounced,
    })
    .from(events)
    .where(eq(events.id, eventId))
    .limit(1);
  // A date to be announced (§533) is only provisional and the PDF would print it; checked here too
  // for a stale form.
  if (!row || startHeldBack(row)) return undefined;
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
  // Bots are answered as signed (AGENTS.md §19.4); a trap holding the signer's own address or name
  // is a password manager, not a bot (§282).
  const verdict = classifySubmission({ honeypot: input.honeypot, renderedAt: input.renderedAt, email: input.email, firstName: input.typedName }, now);
  if (verdict !== "ok" && verdict !== "autofill") return { outcome: "ignored" };

  // A non-uuid must not reach a uuid column: 22P02 would be a 500 (§376).
  if (!isUuid(input.eventId)) throw new DomainError("NOT_FOUND", "this run offers no declaration to sign");
  if (!isUuid(input.documentId)) throw declarationChanged();

  const event = await findSignableEvent(db, input.eventId);
  const key = event ? offeredGroupRunDeclarationKey(event) : null;
  if (!event || !key || !signingOpen(event, now)) throw new DomainError("NOT_FOUND", "this run offers no declaration to sign");

  const document = await findCurrentApprovedDocument(db, key, input.locale, now);
  if (!document) throw new DomainError("NOT_FOUND", "the club has no approved declaration of this kind");

  // No personal data without an approved privacy notice in force, as for a registration (BR-REQ-053-01).
  const privacyNotice = await findCurrentApprovedDocument(db, "PRIVACY_NOTICE", input.locale, now);
  if (!privacyNotice) {
    throw new DomainError("NOT_FOUND", "no approved privacy notice exists yet; the declaration cannot be signed");
  }
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
    ...birthDateRefusal(event, input.birthDate),
    ...(typedName === "" || typedName.length > TYPED_NAME_MAX ? ["typedName"] : []),
    ...(canonicalEmail === null ? ["email"] : []),
    ...(input.accepted ? [] : ["accepted"]),
  ];
  if (invalid.length > 0) throw new DomainError("VALIDATION_ERROR", `${invalid.join(", ")}: the declaration is incomplete`, invalid);

  // Keyed on the hashed address (§322).
  const throttle = await consumeRateLimit(db, "group-run-declaration", emailBucketKey("group-run-declaration", canonicalEmail as string), now);
  if (!throttle.allowed) return { outcome: "limited", retryAfter: throttle.retryAfter };

  // Kept on the row as the signer read them, for the PDF (§523).
  const facts = await groupRunMergeValues(db, event.id, input.locale, document.body);
  const signerKey = signerIdentity(input.email, typedName) as string;

  return db.transaction(async (tx) => {
    const txDb = tx as unknown as Database<T>;
    // One declaration per person, series and version (§523): an existing one is resent, never replaced (§53).
    const dates = (await listSeriesDatesOf(txDb, event.id)).map((date) => date.id);
    const existing = keptSignature(await listCoveringSignatures(txDb, event.id, dates, document.id), { email: input.email, typedName }, document.id);
    const resend = async (kept: { id: string; email: string }) => {
      // No second archive copy; the page answers as for a new signature (§39).
      await enqueueEmail(tx, {
        participantId: null,
        registrationId: null,
        messageType: "GROUP_RUN_DECLARATION_SIGNED",
        locale: input.locale,
        recipientEmail: kept.email,
        payload: { groupRunDeclarationId: kept.id },
        idempotencyKey: `group-run-declaration:${kept.id}:signed:${now.getTime()}`,
        now,
      });
      return { outcome: "signed" as const, id: kept.id, kept: true };
    };
    if (existing) return resend(existing);
    const row = await insertGroupRunDeclaration(txDb, {
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
      seriesKey: facts?.seriesKey ?? null,
      signerKey,
      signedFacts: facts ? factsToKeep(facts.values) : null,
    });
    if (!row) {
      // A concurrent press won the unique index (§523); resend its row.
      const [raced] = await listCoveringSignatures(txDb, event.id, dates, document.id).then((rows) =>
        rows.filter((candidate) => signerIdentity(candidate.email, candidate.typedName) === signerKey),
      );
      if (!raced) throw new Error("the declaration was not written");
      return resend(raced);
    }
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
    // The club's archive copy (§99, §244).
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
    return { outcome: "signed" as const, id: row.id, kept: false };
  });
}

/** An Administrator erases one group-run declaration (§393, as §67 and §88; BR-REQ-060-01). */
export async function eraseGroupRunDeclaration<T extends Record<string, unknown>>(
  db: Database<T>,
  actor: Pick<StaffUser, "id" | "role">,
  input: { id: string; reason: string },
  now: Date,
): Promise<{ eventId: string }> {
  const reason = assertMayErase(actor, input.reason);
  if (!isUuid(input.id)) throw new DomainError("NOT_FOUND", "no such declaration");

  return db.transaction(async (tx) => {
    const [row] = await tx
      .select({ id: groupRunDeclarations.id, eventId: groupRunDeclarations.eventId, version: groupRunDeclarations.declarationVersion })
      .from(groupRunDeclarations)
      .where(eq(groupRunDeclarations.id, input.id))
      .limit(1);
    if (!row) throw new DomainError("NOT_FOUND", "no such declaration");
    await eraseSignature(tx, actor, row, reason, now);
    return { eventId: row.eventId };
  });
}

/**
 * Erases the ticked signatures of one run, each through `eraseSignature`, one reason for all (§532).
 * All-or-nothing: if any id is gone or not this run's, `CONFLICT` — the Administrator confirmed N,
 * not N − 1. Rows locked in one transaction.
 */
export async function eraseGroupRunDeclarations<T extends Record<string, unknown>>(
  db: Database<T>,
  actor: Pick<StaffUser, "id" | "role">,
  input: { eventId: string; ids: readonly string[]; reason: string },
  now: Date,
): Promise<{ erased: number }> {
  const reason = assertMayErase(actor, input.reason);
  const ids = [...new Set(input.ids)];
  if (ids.length === 0) throw new DomainError("VALIDATION_ERROR", "no declaration was ticked", ["declarationIds"]);
  if (!isUuid(input.eventId)) throw new DomainError("NOT_FOUND", "no such event");
  if (!ids.every(isUuid)) throw new DomainError("CONFLICT", "the ticked declarations changed; nothing was erased");

  return db.transaction(async (tx) => {
    const dates = (await listSeriesDatesOf(tx, input.eventId)).map((date) => date.id);
    if (dates.length === 0) throw new DomainError("NOT_FOUND", "no such event");
    const rows = await tx
      .select({ id: groupRunDeclarations.id, eventId: groupRunDeclarations.eventId, version: groupRunDeclarations.declarationVersion })
      .from(groupRunDeclarations)
      .where(and(inArray(groupRunDeclarations.id, ids), inArray(groupRunDeclarations.eventId, dates)))
      .for("update");
    if (rows.length !== ids.length) {
      throw new DomainError("CONFLICT", `the ticked declarations changed (${rows.length} of ${ids.length} still there); nothing was erased`);
    }
    for (const row of rows) await eraseSignature(tx, actor, row, reason, now);
    return { erased: rows.length };
  });
}

/** Returns the trimmed reason, or refuses (§393, §67). */
function assertMayErase(actor: Pick<StaffUser, "role">, typed: string): string {
  if (!canManageRegistrations(actor.role)) throw new DomainError("FORBIDDEN", "erasing a declaration is an Administrator's");
  const reason = typed.trim();
  if (reason === "" || reason.length > ERASE_REASON_MAX) throw new DomainError("VALIDATION_ERROR", "reason: say why", ["reason"]);
  return reason;
}

/**
 * The one erase path, in the caller's transaction: audit row first, never naming the signer
 * (AGENTS.md §12.12); then its outbox rows, which carry the address; then the row.
 */
async function eraseSignature<T extends Record<string, unknown>>(
  tx: Database<T>,
  actor: Pick<StaffUser, "id">,
  row: { id: string; eventId: string; version: number },
  reason: string,
  now: Date,
): Promise<void> {
  await recordAuditEvent(tx, {
    actorStaffUserId: actor.id,
    action: "event.group_run_declaration_erased",
    entityType: "event",
    entityId: row.eventId,
    metadata: { reason, declarationVersion: row.version },
    now,
  });
  await tx.delete(emailOutbox).where(sql`${emailOutbox.payloadJson}->>'groupRunDeclarationId' = ${row.id}`);
  await tx.delete(groupRunDeclarations).where(and(eq(groupRunDeclarations.id, row.id), eq(groupRunDeclarations.eventId, row.eventId)));
}
